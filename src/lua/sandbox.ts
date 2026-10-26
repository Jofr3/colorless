import { DECK_SIZE } from "@colorless/engine";
import * as api from "../lib/api";
import type { Deck } from "../decks/data";
import type { LocalGameSetup } from "../game/localHost";
import { prepareSandbox, SandboxSetupError } from "../game/prepareSandbox";
import { validSandboxDecks } from "../game/sandboxDecks";
import { decodeFields, encodeFields } from "./wire";
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
    private launch: (setup: LocalGameSetup) => void,
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
        encodeFields([++this.revision, this.phase, +this.busy, this.message, ...this.selected]),
        ...this.decks.map((d) => encodeFields(["D", d.id, d.name, d.cardCount])),
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
    } else if (
      action === "start" &&
      this.selected.every((id) => this.decks.some((d) => d.id === id && d.cardCount === DECK_SIZE))
    ) {
      const live = this.epoch.next();
      this.busy = true;
      this.message = "";
      this.emit();
      try {
        // Fetch fresh contents and rerun the deck validation.
        const setup = await prepareSandbox([...this.selected]);
        if (live() && this.active) this.launch(setup);
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
