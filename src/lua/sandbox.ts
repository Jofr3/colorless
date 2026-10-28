import { DECK_SIZE } from "@colorless/engine/rules";
import * as api from "../lib/api";
import type { Deck } from "../decks/data";
import type { LocalGameSetup } from "../game/localHost";
import { SandboxSetupError } from "../game/sandboxSetupError";
import { validSandboxDecks } from "../game/sandboxDecks";
import { decodeFields, encodeFields } from "./wire";
import { WIRE_ROWS, wireRow } from "./wireFields";
import type { AccountStatus } from "./account";
import { epochGuard, sessionUser } from "./epochGuard";

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

  constructor(
    private publish: (snapshot: string) => void,
    /** Resolves to the synchronous handoff, so nothing async sits between the last check and it. */
    private loadLaunch: () => Promise<(setup: LocalGameSetup) => void>,
  ) {}

  session(status: AccountStatus, id: string) {
    const user = sessionUser(status, id, this.user);
    if (user === undefined) return;
    this.epoch.invalidate();
    this.user = user;
    this.decks = [];
    this.selected = ["", ""];
    this.busy = false;
    this.message = "";
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

  async load() {
    if (!this.user) {
      this.emit();
      return;
    }
    const live = this.epoch.next();
    this.busy = true;
    this.phase = "loading";
    this.message = "";
    this.emit();
    try {
      const summaries = await api.listDecks();
      if (!live()) return;
      const decks = await validSandboxDecks(summaries, live);
      if (!live()) return;
      // Include decks in existing folders, without bringing folder management here.
      this.decks = decks.sort((a, b) => a.name.localeCompare(b.name));
      this.selected = this.selected.map((id) =>
        decks.some((d) => d.id === id) ? id : (decks[0]?.id ?? ""),
      ) as [string, string];
      this.phase = "ready";
    } catch (error) {
      if (!live()) return;
      this.phase = error instanceof api.ApiError && error.status === 401 ? "anonymous" : "error";
      this.decks = [];
      this.selected = ["", ""];
      this.message =
        this.phase === "anonymous"
          ? "Sign in to choose your decks."
          : "Could not load your decks. Try again.";
    } finally {
      if (live()) {
        this.busy = false;
        this.emit();
      }
    }
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
