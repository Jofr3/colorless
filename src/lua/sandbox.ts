import { DECK_SIZE } from "@colorless/engine/rules";
import * as api from "../lib/api";
import type { Deck } from "../decks/data";
import type { LocalGameSetup } from "../game/localHost";
import { SandboxSetupError } from "../game/sandboxSetupError";
import { sandboxDecksFrom } from "../game/sandboxDecks";
import { type DeckList, deckStore } from "../decks/deckStore";
import { decodeFields, encodeFields } from "./wire";
import { WIRE_ROWS, wireRow } from "./wireFields";
import type { AccountStatus } from "./account";
import { DECKS_UNREACHABLE, epochGuard, sessionUser } from "./epochGuard";

/** Read-only deck selection; Lua owns all layout, controls and animation. */
export class LuaSandbox {
  decks: Deck[] = [];
  selected: [string, string] = ["", ""];
  phase = "loading";
  busy = false;
  message = "";
  active = false;
  private user = "";
  private readonly epoch = epochGuard();
  private revision = 0;
  /** The store revision on screen, -1 for none. */
  private shown = -1;

  constructor(
    private publish: (snapshot: string) => void,
    /** Resolves to the synchronous handoff, so nothing async sits between the last check and it. */
    private loadLaunch: () => Promise<(setup: LocalGameSetup) => void>,
    /** Starts loading the game table's code, which a Play from this picker will need. */
    private warm: () => void = () => {},
  ) {}

  session(status: AccountStatus, id: string) {
    const user = sessionUser(status, id, this.user);
    if (user === undefined) return;
    this.epoch.invalidate();
    this.user = user;
    this.decks = [];
    this.shown = -1;
    this.selected = ["", ""];
    this.busy = false;
    this.message = status === "error" ? DECKS_UNREACHABLE : "";
    this.phase = status === "error" ? "error" : this.user ? "loading" : "anonymous";
    if (this.active && this.user) void this.load();
    else this.emit();
  }

  emit() {
    this.publish(
      [
        encodeFields(
          wireRow(WIRE_ROWS.sandbox.header, {
            revision: ++this.revision,
            phase: this.phase,
            busy: +this.busy,
            message: this.message,
            first: this.selected[0],
            second: this.selected[1],
          }),
        ),
        ...this.decks.map((d) =>
          encodeFields(
            wireRow(WIRE_ROWS.sandbox.deck, { id: d.id, name: d.name, count: d.cardCount }),
          ),
        ),
      ].join("\n"),
    );
  }

  /** Loads the decks. The picker stays on what it shows (or on what the deck store already
   * judged) while the list is checked again, and says loading only with nothing to show.
   * Selecting stays live meanwhile: Play re-validates the chosen decks' contents anyway. */
  async load() {
    if (!this.user) {
      this.emit();
      return;
    }
    const live = this.epoch.next();
    // A failed check settles the picker on its error: a late judgement of the held list stays off.
    let failed = false;
    const cached = deckStore.peek(this.user);
    const judged = cached && deckStore.peekVerdicts(cached);
    if (cached && judged) this.show(sandboxDecksFrom([...cached.decks], judged), cached.revision);
    else {
      if (this.phase !== "ready") this.phase = "loading";
      // A list the store holds unjudged is judged while it is checked again, not after.
      if (cached) void this.showJudged(cached, () => live() && !failed);
    }
    this.message = "";
    this.emit();
    try {
      const list = await deckStore.revalidate(this.user);
      if (!live()) return;
      const verdicts = await deckStore.judge(list);
      if (!live()) return;
      this.show(sandboxDecksFrom([...list.decks], verdicts), list.revision);
    } catch (error) {
      if (!live()) return;
      failed = true;
      this.phase = error instanceof api.ApiError && error.status === 401 ? "anonymous" : "error";
      this.decks = [];
      this.shown = -1;
      this.selected = ["", ""];
      this.message =
        this.phase === "anonymous" ? "Sign in to choose your decks." : DECKS_UNREACHABLE;
    }
    if (live()) this.emit();
  }

  /** Shows `list` once judged, unless something newer is on screen by then. A failure here says
   * nothing: the revalidation that runs alongside reports its own. */
  private async showJudged(list: DeckList, live: () => boolean) {
    try {
      const verdicts = await deckStore.judge(list);
      if (!live() || list.revision <= this.shown) return;
      this.show(sandboxDecksFrom([...list.decks], verdicts), list.revision);
      this.emit();
    } catch {}
  }

  private show(decks: Deck[], revision: number) {
    this.shown = revision;
    // Include decks in existing folders, without bringing folder management here.
    this.decks = decks.sort((a, b) => a.name.localeCompare(b.name));
    this.selected = this.selected.map((id) =>
      decks.some((d) => d.id === id) ? id : (decks[0]?.id ?? ""),
    ) as [string, string];
    this.phase = "ready";
  }

  async command(raw: string) {
    const fields = decodeFields(raw);
    if (!fields) return;
    const [action, a, b] = fields;
    if (action === "close") {
      this.active = false;
      this.epoch.invalidate();
      this.busy = false;
      return;
    }
    if (action === "open" || action === "refresh") {
      this.active = true;
      await this.load();
      // After the decks, so a slow link fetches them first.
      if (action === "open" && this.active) this.warm();
      return;
    }
    if (!this.active || this.phase !== "ready" || this.busy) return;
    if (
      action === "select" &&
      (a === "1" || a === "2") &&
      b &&
      this.decks.some((deck) => deck.id === b)
    ) {
      this.selected[a === "1" ? 0 : 1] = b;
      this.message = "";
    } else if (action === "start") {
      const [first, second] = this.selected.map((id) =>
        this.decks.find((d) => d.id === id && d.cardCount === DECK_SIZE),
      );
      if (first === undefined || second === undefined) {
        this.emit();
        return;
      }
      const live = this.epoch.next();
      this.busy = true;
      this.message = "";
      this.emit();
      try {
        // Rerun the deck validation on the contents the picker judged, which the session's deck
        // cache serves while their summaries' `updated` matches.
        const [{ prepareSandbox }, launch] = await Promise.all([
          import("../game/prepareSandbox"),
          this.loadLaunch(),
        ]);
        const setup = await prepareSandbox([first, second]);
        if (live() && this.active) launch(setup);
      } catch (error) {
        if (!live()) return;
        this.message =
          error instanceof SandboxSetupError
            ? error.message
            : "Could not prepare the game. Try again.";
      } finally {
        if (live()) {
          this.busy = false;
          this.emit();
        }
      }
      return;
    }
    this.emit();
  }
}
