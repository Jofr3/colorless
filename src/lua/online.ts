import {
  isValidLobbyCode,
  LOBBY_CODE_LENGTH,
  normalizeLobbyCode,
  type User,
} from "@colorless/schema";
import * as api from "../lib/api";
import { createLobbyCode } from "../online/createLobby";
import {
  countdownSeconds,
  LobbyClient,
  type LobbyClientOptions,
  versusStatus,
} from "../online/lobbyClient";
import {
  clearIdentity,
  type LobbyIdentity,
  loadPlayerName,
  resolveIdentity,
  savePlayerName,
  stakeIdentity,
} from "../online/session";
import { type DeckVerdict, type PlayableDeck, playableDecksFrom } from "../game/sandboxDecks";
import { type DeckList, deckStore } from "../decks/deckStore";
import { decodeFields, encodeFields } from "./wire";
import { WIRE_ROWS, wireRow } from "./wireFields";
import type { CardPool, LuaOnlineMatch } from "./onlineTable";
import { reportError } from "../lib/reportError";
import type { AccountStatus } from "./account";
import { epochGuard } from "./epochGuard";

export type OnlineStep =
  | "menu"
  | "joining"
  | "waiting"
  | "versus"
  | "countdown"
  | "starting"
  | "full"
  | "not-found"
  | "unreachable"
  | "invalid";

type Surface = "none" | "modal" | "match";

export const NOTICE_MS = 1600;
const TICK_MS = 200;

const PHASE_STEP = {
  waiting: "waiting",
  selecting: "versus",
  countdown: "countdown",
  "in-game": "starting",
} as const;
const SEATED = new Set<OnlineStep>(["waiting", "versus", "countdown", "starting"]);

/** The online modal's data side over one LobbyClient; Lua owns all layout,
 * controls and motion. A full lobby is an info step. */
/** How long a live match waits for the table to take its client (see `release`). */
export const TABLE_CLAIM_MS = 30_000;

export class LuaOnline {
  client: LobbyClient | null = null;
  surface: Surface = "none";
  decks: PlayableDeck[] = [];
  deckPhase = "idle";
  busy = false;
  message = "";
  notice = "";
  private invalid = false;
  private identity: LobbyIdentity | null = null;
  private account: AccountStatus = "loading";
  private userId = "";
  private decksWanted = false;
  /** Whose decks `decks` holds. */
  private decksUser = "";
  /** The store revision the picker shows, -1 for none. */
  private decksShown = -1;
  private readonly deckEpoch = epochGuard();
  private revision = 0;
  private op = 0;
  private seconds = -1;
  private routed = "";
  private serial = 0;
  private inGame = false;
  /** The last match frame showed a result: a rematch waits on the table. */
  private over = false;
  private stale = false;
  private fallbackName = "";
  private unsubscribe = () => {};
  private ticker: ReturnType<typeof setInterval> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private publish: (snapshot: string) => void,
    private route: (page: string, id: string, replace: boolean) => void,
    private deps: {
      user?: () => User | null;
      client?: (opts: LobbyClientOptions) => LobbyClient;
      now?: () => number;
      cards?: CardPool;
      /** Starts loading the game table's code, which a countdown is about to need. */
      warmTable?: () => void;
    } = {},
  ) {}

  get code() {
    return this.client?.code ?? "";
  }

  step(): OnlineStep {
    if (this.invalid) return "invalid";
    const c = this.client;
    if (!c) return "menu";
    const { status, snapshot } = c.state;
    if (status === "not-found" || status === "unreachable" || status === "full") return status;
    if (!snapshot || !c.self) return "joining";
    return PHASE_STEP[snapshot.phase];
  }

  name() {
    const display = this.deps.user?.()?.displayName.trim();
    if (display) return display;
    if (this.identity) return this.identity.name;
    if (!this.fallbackName) {
      // loadPlayerName rolls a new "Player NNNN" until one is stored; keep the
      // shown name and the one stakeIdentity announces the same.
      this.fallbackName = loadPlayerName();
      savePlayerName(this.fallbackName);
    }
    return this.fallbackName;
  }

  emit() {
    const c = this.client;
    const step = this.step();
    const now = (this.deps.now ?? Date.now)();
    const started = c?.state.snapshot?.countdownStartedAt;
    this.seconds = step === "countdown" && started != null ? countdownSeconds(started, now) : -1;
    const error = c?.state.matchError;
    const self = c?.self ?? null;
    const opponent = c?.opponent ?? null;
    // A refused socket still holds the public snapshot: never render its seats.
    const seated = SEATED.has(step);
    const W = WIRE_ROWS.online;
    const seat = (tag: string, p: typeof self, own: boolean) =>
      encodeFields(
        wireRow(W.seat, {
          seat: tag,
          present: +!!p,
          name: p?.name ?? "",
          connected: +!!p?.connected,
          ready: +!!p?.ready,
          // The server sends no seat's deck id: yours is the client's memory of its pick,
          // unknown after a reload, so whether a deck is picked rides on its own.
          deckId: (own && p?.hasDeck && c?.state.deckId) || "",
          deckName: (own && p?.deckName) || "",
          hasDeck: +!!p?.hasDeck,
        }),
      );
    this.publish(
      [
        encodeFields(
          wireRow(W.header, {
            revision: ++this.revision,
            step,
            busy: +this.busy,
            message: this.message || (error ? `Couldn't start the match - ${error}` : ""),
            code: this.code,
            role: c?.role ?? "",
            link: c ? (c.state.status === "connecting" ? "connecting" : "connected") : "",
            countdown: this.seconds < 0 ? "" : this.seconds,
            notice: this.notice,
            deckPhase: this.deckPhase,
            name: this.name(),
            account: this.account,
            status: step === "versus" || step === "countdown" ? versusStatus(self, opponent) : "",
          }),
        ),
        ...(seated ? [seat("you", self, true), seat("opponent", opponent, false)] : []),
        ...(this.deckPhase === "ready"
          ? this.decks.map((d) =>
              encodeFields(
                wireRow(W.deck, {
                  id: d.id,
                  name: d.name,
                  count: d.cardCount,
                  standard: +d.standard,
                  expanded: +d.expanded,
                  online: +d.online,
                  formatName: d.formatName,
                }),
              ),
            )
          : []),
      ].join("\n"),
    );
    this.sync(step);
  }

  /** The live client, if `code` is the lobby being played (the match surface). */
  attach(code: string): LobbyClient | null {
    if (!this.client || this.client.code !== code) return null;
    this.surface = "match";
    this.routed = "";
    return this.client;
  }

  detach() {
    if (this.surface === "match") this.release();
  }

  /** The table source for the live match on `code`, built with the table's `Match` class (loaded
   * with the table); null sends the simulator back to the modal, which resumes the lobby and
   * routes again. */
  matchSource(code: string, Match: typeof LuaOnlineMatch): LuaOnlineMatch | null {
    const c = this.client;
    if (!c || c.code !== code || !this.live(c)) return null;
    const client = this.attach(code);
    if (!client) return null;
    return new Match(
      client,
      {
        serial: () => this.serial,
        release: () => this.detach(),
        leave: () => {
          this.leave();
          this.emit();
        },
      },
      { cards: this.deps.cards },
    );
  }

  session(status: AccountStatus, id: string) {
    // "error": the check could not reach the server, which Lua must not answer with Sign in.
    const account = status;
    const user = account === "authenticated" ? id : "";
    // Every account publish reaches every screen; only a new status or user is news here.
    if (account === this.account && (account === "loading" || user === this.userId)) return;
    const changed = this.account !== "loading" && account !== "loading" && user !== this.userId;
    const resolved = this.account === "loading" && account !== "loading";
    this.account = account;
    if (account !== "loading") this.userId = user;
    if (changed && this.client) {
      // A table holds this client: reopen once the modal takes it back.
      this.stale = true;
      if (this.surface !== "match") this.reopen();
    }
    if (this.decksWanted && (changed || resolved)) void this.loadDecks();
    else this.emit();
  }

  /** The page can no longer run the game: close the lobby link without a bye, as a closed tab's
   * would, so the opponent's grace and forfeit clock start. The seat's identity is kept, so a
   * reload takes the seat back. */
  halt() {
    this.unsubscribe();
    this.unsubscribe = () => {};
    this.client?.dispose({ bye: false });
    this.client = null;
    this.identity = null;
  }

  /** Leave the lobby for good: bye, forget the seat. */
  leave() {
    const code = this.code;
    this.op++;
    this.drop();
    if (code) clearIdentity(code);
    this.invalid = false;
    this.message = "";
  }

  async command(raw: string) {
    const fields = decodeFields(raw);
    if (!fields) return;
    const [action, a] = fields;
    if (action === "open") {
      this.surface = "modal";
      this.routed = "";
      this.message = "";
      const code = a ?? "";
      this.invalid = code !== "" && !isValidLobbyCode(code);
      if (this.client && this.client.code !== code) this.drop();
      if (code && !this.invalid && !this.client) this.connect(code, resolveIdentity(code, null));
      else if (this.stale) this.reopen();
      this.emit();
    } else if (action === "close") {
      this.release();
    } else if (action === "create") {
      if (this.busy || this.client) return;
      const op = ++this.op;
      this.busy = true;
      this.message = "";
      this.emit();
      let code = "";
      try {
        code = await createLobbyCode();
      } catch (error) {
        reportError("create lobby code", error);
        if (op === this.op)
          this.message =
            error instanceof api.ApiError && error.status === 429
              ? "Too many new lobbies. Try again in a minute."
              : "Couldn't reach the lobby server. Try again in a moment.";
      }
      this.busy = false;
      const live = code !== "" && op === this.op && this.surface === "modal" && !this.client;
      if (live) this.connect(code, stakeIdentity(code, "host"));
      this.emit();
      if (live) this.route("online", code, true);
    } else if (action === "join") {
      if (this.busy || this.client) return;
      const code = normalizeLobbyCode(a ?? "");
      if (!isValidLobbyCode(code)) {
        this.message = `Enter the full ${LOBBY_CODE_LENGTH}-character code.`;
        this.emit();
        return;
      }
      this.message = "";
      this.connect(code, stakeIdentity(code, "guest"));
      this.emit();
      this.route("online", code, true);
    } else if (action === "leave") {
      const lobby = this.code !== "" || this.invalid;
      this.leave();
      this.emit();
      // `leave\thome`: Lua navigates home itself.
      if (lobby && a !== "home" && this.surface === "modal") this.route("online", "", true);
    } else if (action === "decks") {
      this.decksWanted = true;
      await this.loadDecks();
    } else if (action === "select") {
      const deck = this.decks.find((d) => d.id === a);
      if (
        this.deckPhase === "ready" &&
        deck?.online &&
        this.client?.self &&
        !this.client.self.ready
      )
        this.client.selectDeck({ id: deck.id, name: deck.name });
    } else if (action === "ready") {
      const self = this.client?.self;
      if (self && (a !== "1" || self.hasDeck)) this.client?.setReady(a === "1");
    } else if (action === "copy" && this.code) {
      const text =
        a === "link" ? `${globalThis.location?.origin ?? ""}/online/${this.code}` : this.code;
      let ok = true;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        ok = false;
      }
      this.flash(ok ? "Copied" : "Copy failed");
    }
  }

  /** The cookie rides only the WS upgrade: reopen with the SAME identity so
   * the server reseats us under the new account. */
  private reopen() {
    this.stale = false;
    if (!this.client || !this.identity) return;
    const { code, self } = this.client;
    const { snapshot, status, deckId } = this.client.state;
    this.client.dispose({ bye: false });
    // Hold the seat on screen: a fresh client's first state would flash
    // joining/waiting, close the picker and replay the join cues.
    const seated = self && (status === "connected" || status === "connecting");
    this.connect(code, this.identity, seated ? { snapshot, status, deckId } : undefined);
  }

  private connect(code: string, identity: LobbyIdentity, resume?: LobbyClientOptions["resume"]) {
    this.unsubscribe();
    this.stale = false;
    this.identity = identity;
    const opts = {
      code,
      role: identity.role,
      secret: identity.secret,
      name: this.name(),
      resume,
    };
    const c = this.deps.client?.(opts) ?? new LobbyClient(opts);
    this.client = c;
    this.unsubscribe = c.subscribe(() => this.changed());
  }

  /** Bye now, keep the identity (an unmount, not a leave). */
  private drop() {
    this.unsubscribe();
    this.unsubscribe = () => {};
    this.client?.dispose();
    this.client = null;
    this.identity = null;
    this.routed = "";
    this.inGame = false;
    this.over = false;
  }

  /** A surface let go: unless another takes the client, bye. Another surface gets this tick,
   * except when the modal just routed a live match to the table: the table loads with `import()`
   * on first use, so it gets TABLE_CLAIM_MS, and a bye before then would concede the match. */
  private release() {
    this.surface = "none";
    this.op++;
    const handoff = this.routed === "match" && this.client !== null && this.live(this.client);
    setTimeout(
      () => {
        if (this.surface === "none" && this.client) {
          this.drop();
          this.emit();
        }
      },
      handoff ? TABLE_CLAIM_MS : 0,
    );
  }

  private changed() {
    const c = this.client;
    if (!c) return;
    const inGame = this.live(c);
    // Every in-game flip is a new match id (a rematch is a fresh table).
    if (inGame && !this.inGame) this.serial++;
    this.inGame = inGame;
    if (inGame) this.over = !!c.state.match?.outcome;
    if (this.surface === "modal" && c.state.status === "connected" && this.live(c))
      this.go("match");
    else if (
      this.surface === "match" &&
      !this.live(c) &&
      !this.rematching(c) &&
      !this.watchingFinished(c)
    )
      this.go("online");
    this.emit();
  }

  /** A finished game handed back for a rematch: both players stay at the table
   * until the next game starts, unless the opponent goes. */
  private rematching(c: LobbyClient) {
    const { status, snapshot } = c.state;
    return (
      this.over &&
      (status === "connected" || status === "connecting") &&
      // …through the countdown and the gap before the new game's first frame.
      (snapshot?.phase === "selecting" ||
        snapshot?.phase === "countdown" ||
        snapshot?.phase === "in-game") &&
      !!c.opponent?.connected
    );
  }

  /** A finished game whose seat was refused on reconnect (its account signed out): the tab stays
   * at the table as a watcher, where the result and the reason are, rather than "Lobby is full". */
  private watchingFinished(c: LobbyClient) {
    const { status } = c.state;
    return this.over && status === "full";
  }

  /** A seated match is running; a reconnecting link still counts. */
  private live(c: LobbyClient) {
    const { status, snapshot, match } = c.state;
    return (
      (status === "connected" || status === "connecting") &&
      snapshot?.phase === "in-game" &&
      match !== null
    );
  }

  private go(page: string) {
    if (this.routed === page) return;
    this.routed = page;
    this.route(page, this.code, true);
  }

  private sync(step: OnlineStep) {
    if (step === "countdown" && this.ticker === null) this.deps.warmTable?.();
    if (step !== "countdown") {
      if (this.ticker !== null) clearInterval(this.ticker);
      this.ticker = null;
      return;
    }
    this.ticker ??= setInterval(() => {
      const started = this.client?.state.snapshot?.countdownStartedAt;
      if (started == null) return;
      if (countdownSeconds(started, (this.deps.now ?? Date.now)()) !== this.seconds) this.emit();
    }, TICK_MS);
  }

  private flash(notice: string) {
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    this.notice = notice;
    this.emit();
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      this.notice = "";
      this.emit();
    }, NOTICE_MS);
  }

  /** Loads the picker's decks. The picker keeps the decks it shows this user (or what the deck
   * store already judged) while the list is checked again, and says loading only with nothing to
   * show. */
  private async loadDecks() {
    const live = this.deckEpoch.next();
    if (this.decksUser !== this.userId) {
      this.decks = [];
      this.decksShown = -1;
      this.deckPhase = "idle";
    }
    if (!this.userId) {
      this.deckPhase =
        this.account === "loading" ? "loading" : this.account === "error" ? "error" : "anonymous";
      this.emit();
      return;
    }
    // A failed check settles the picker on its error: a late judgement of the held list stays off.
    let failed = false;
    const cached = deckStore.peek(this.userId);
    const judged = cached && deckStore.peekVerdicts(cached);
    if (cached && judged) this.showDecks(cached, judged);
    else {
      if (this.deckPhase !== "ready") this.deckPhase = "loading";
      // A list the store holds unjudged is judged while it is checked again, not after.
      if (cached) void this.showJudged(cached, () => live() && !failed);
    }
    this.emit();
    try {
      const list = await deckStore.revalidate(this.userId);
      if (!live()) return;
      const verdicts = await deckStore.judge(list);
      if (!live()) return;
      this.showDecks(list, verdicts);
    } catch (error) {
      if (!live()) return;
      failed = true;
      this.decks = [];
      this.decksShown = -1;
      this.deckPhase =
        error instanceof api.ApiError && error.status === 401 ? "anonymous" : "error";
    }
    this.emit();
  }

  /** Shows `list` once judged, unless something newer is on screen by then. A failure here says
   * nothing: the revalidation that runs alongside reports its own. */
  private async showJudged(list: DeckList, live: () => boolean) {
    try {
      const verdicts = await deckStore.judge(list);
      if (!live() || list.revision <= this.decksShown) return;
      this.showDecks(list, verdicts);
      this.emit();
    } catch {}
  }

  private showDecks(list: DeckList, verdicts: Map<string, DeckVerdict>) {
    this.decks = playableDecksFrom([...list.decks], verdicts).sort((x, y) =>
      x.name.localeCompare(y.name),
    );
    this.decksShown = list.revision;
    this.decksUser = this.userId;
    this.deckPhase = "ready";
  }
}
