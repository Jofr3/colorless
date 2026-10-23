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
import { type PlayableDeck, playableDecks } from "../game/sandboxDecks";
import { decodeFields, encodeFields } from "./wire";
import { type CardPool, LuaOnlineMatch } from "./onlineTable";

export type OnlineStep =
  | "menu"
  | "joining"
  | "waiting"
  | "versus"
  | "countdown"
  | "starting"
  | "full"
  | "not-found"
  | "kicked"
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
 * controls and motion. Spectating is not offered: a full lobby is an info step. */
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
  private account = "loading";
  private userId = "";
  private decksWanted = false;
  private deckEpoch = 0;
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
    if (status === "kicked" || status === "not-found") return status;
    if (status === "full" || status === "spectating") return "full";
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
    const seat = (tag: string, p: typeof self, own: boolean) =>
      encodeFields([
        "P",
        tag,
        +!!p,
        p?.name ?? "",
        +!!p?.connected,
        +!!p?.ready,
        (own && p?.deckId) || "",
        (own && p?.deckName) || "",
      ]);
    this.publish(
      [
        encodeFields([
          ++this.revision,
          step,
          +this.busy,
          this.message || (error ? `Couldn't start the match - ${error}` : ""),
          this.code,
          c?.role ?? "",
          c ? (c.state.status === "connecting" ? "connecting" : "connected") : "",
          this.seconds < 0 ? "" : this.seconds,
          this.notice,
          this.deckPhase,
          this.name(),
          this.account,
          +(c?.role === "host" && !!opponent),
          step === "versus" || step === "countdown" ? versusStatus(self, opponent) : "",
        ]),
        ...(seated ? [seat("you", self, true), seat("opponent", opponent, false)] : []),
        ...(this.deckPhase === "ready"
          ? this.decks.map((d) =>
              encodeFields(["D", d.id, d.name, d.cardCount, +d.standard, +d.expanded]),
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

  /** The table source for the live match on `code`; null sends the simulator
   * back to the modal, which resumes the lobby and routes again. */
  matchSource(code: string): LuaOnlineMatch | null {
    const c = this.client;
    if (!c || c.code !== code || !this.live(c)) return null;
    const client = this.attach(code);
    if (!client) return null;
    return new LuaOnlineMatch(
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

  session(status: string, id: string) {
    const account =
      status === "authenticated" ? status : status === "loading" ? status : "anonymous";
    const user = account === "authenticated" ? id : "";
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
      } catch {
        if (op === this.op)
          this.message = "Couldn't reach the lobby server. Try again in a moment.";
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
      if (this.deckPhase === "ready" && deck && this.client?.self && !this.client.self.ready)
        this.client.selectDeck({ id: deck.id, name: deck.name });
    } else if (action === "ready") {
      const self = this.client?.self;
      if (self && (a !== "1" || self.deckId)) this.client?.setReady(a === "1");
    } else if (action === "kick") {
      if (this.client?.role === "host" && this.client.opponent) this.client.kick();
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
    const { snapshot, status } = this.client.state;
    this.client.dispose({ bye: false });
    // Hold the seat on screen: a fresh client's first state would flash
    // joining/waiting, close the picker and replay the join cues.
    const seated = self && (status === "connected" || status === "connecting");
    this.connect(code, this.identity, seated ? { snapshot, status } : undefined);
  }

  private connect(code: string, identity: LobbyIdentity, resume?: LobbyClientOptions["resume"]) {
    this.unsubscribe();
    this.stale = false;
    this.identity = identity;
    const opts = {
      code,
      role: identity.role,
      playerId: identity.playerId,
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

  /** A surface let go: unless another takes the client this tick, bye. */
  private release() {
    this.surface = "none";
    this.op++;
    setTimeout(() => {
      if (this.surface === "none" && this.client) {
        this.drop();
        this.emit();
      }
    }, 0);
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
    else if (this.surface === "match" && !this.live(c) && !this.rematching(c)) this.go("online");
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

  private async loadDecks() {
    const epoch = ++this.deckEpoch;
    this.decks = [];
    if (!this.userId) {
      this.deckPhase = this.account === "loading" ? "loading" : "anonymous";
      this.emit();
      return;
    }
    this.deckPhase = "loading";
    this.emit();
    try {
      const summaries = await api.listDecks();
      if (epoch !== this.deckEpoch) return;
      const decks = await playableDecks(summaries, () => epoch === this.deckEpoch);
      if (epoch !== this.deckEpoch) return;
      this.decks = decks.sort((x, y) => x.name.localeCompare(y.name));
      this.deckPhase = "ready";
    } catch (error) {
      if (epoch !== this.deckEpoch) return;
      this.deckPhase =
        error instanceof api.ApiError && error.status === 401 ? "anonymous" : "error";
    }
    this.emit();
  }
}
