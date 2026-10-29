import { DECK_SIZE } from "@colorless/engine/rules";
import { DECK_NAME_MAX, MAX_DECKS_PER_USER } from "@colorless/schema";
import * as api from "../lib/api";
import type { Deck } from "../decks/data";
import { deckLegality } from "../game/sandboxDecks";
import { decodeFields, encodeFields } from "./wire";
import { WIRE_ROWS, wireRow } from "./wireFields";
import { reportError } from "../lib/reportError";
import { readPersisted, writePersisted } from "../lib/persistedState";
import type { AccountStatus } from "./account";
import { DECKS_UNREACHABLE, epochGuard, sessionUser } from "./epochGuard";

const sorts = ["name-asc", "name-desc", "cards-desc"];
const SORT_KEY = "decks.sortKey";

/** Data/session adapter only. Layout, card physics and all controls live in Lua. */
export class LuaLibrary {
  decks: Deck[] = [];
  /** Deck id → legal, for the "!" alert on a pile; absent while unchecked. */
  legality = new Map<string, boolean>();
  query = "";
  sort = readPersisted(SORT_KEY, (raw) => (sorts.includes(raw) ? raw : undefined), "name-asc");
  page = 1;
  size = 12;
  phase = "loading";
  busy = false;
  message = "";
  result = "";
  active = false;
  private user = "";
  private readonly epoch = epochGuard();
  private revision = 0;
  constructor(
    private publish: (snapshot: string) => void,
    private openDeck: (id: string) => void,
  ) {}

  session(status: AccountStatus, id: string) {
    const user = sessionUser(status, id, this.user);
    if (user === undefined) return;
    this.epoch.invalidate();
    this.user = user;
    this.decks = [];
    this.legality = new Map();
    this.busy = false;
    this.message = status === "error" ? DECKS_UNREACHABLE : "";
    this.result = "";
    this.phase = status === "error" ? "error" : this.user ? "loading" : "anonymous";
    if (this.active && this.user) void this.load();
    else this.emit();
  }

  visible() {
    const q = this.query.trim().toLocaleLowerCase();
    // Include decks from every existing folder without modifying their ownership.
    const decks = this.decks.filter((d) => !q || d.name.toLocaleLowerCase().includes(q));
    const compare = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name) * (this.sort === "name-desc" ? -1 : 1);
    decks.sort(
      this.sort === "cards-desc"
        ? (a, b) => b.cardCount - a.cardCount || a.name.localeCompare(b.name)
        : compare,
    );
    return { decks };
  }

  emit() {
    const { decks } = this.visible();
    const pages = Math.max(1, Math.ceil(decks.length / this.size));
    this.page = Math.max(1, Math.min(pages, this.page));
    this.publish(
      [
        encodeFields(
          wireRow(WIRE_ROWS.library.header, {
            revision: ++this.revision,
            phase: this.phase,
            busy: +this.busy,
            message: this.message,
            query: this.query,
            sort: this.sort,
            page: this.page,
            pages,
            total: decks.length,
            result: this.result,
          }),
        ),
        ...decks.slice((this.page - 1) * this.size, this.page * this.size).map((d) => {
          const legal = this.legality.get(d.id);
          return encodeFields(
            wireRow(WIRE_ROWS.library.deck, {
              id: d.id,
              name: d.name,
              count: d.cardCount,
              tint: d.tint,
              illegal: legal === undefined ? "" : +!legal,
            }),
          );
        }),
      ].join("\n"),
    );
  }

  /** Reloads the decks; the returned check stays true until something newer starts. */
  async load(): Promise<(() => boolean) | undefined> {
    if (!this.user || this.busy) {
      this.emit();
      return;
    }
    const live = this.epoch.next();
    this.busy = true;
    this.message = "";
    this.emit();
    try {
      const decks = await api.listDecks();
      if (!live()) return live;
      this.decks = decks;
      // Incomplete decks are illegal on sight; complete ones are judged below.
      this.legality = new Map(
        decks.filter((d) => d.cardCount !== DECK_SIZE).map((d) => [d.id, false] as const),
      );
      this.phase = "ready";
      void this.judge(live);
    } catch (error) {
      if (!live()) return live;
      this.phase = error instanceof api.ApiError && error.status === 401 ? "anonymous" : "error";
      if (this.phase === "anonymous") {
        this.decks = [];
      }
      this.message =
        this.phase === "anonymous" ? "Your session expired. Sign in again." : DECKS_UNREACHABLE;
    } finally {
      if (live()) {
        this.busy = false;
        this.emit();
      }
    }
    return live;
  }

  /** Judge the loaded decks in the background and republish the alerts. A
      failed check leaves the piles unmarked rather than surfacing an error:
      the library itself loaded, and the next load retries. */
  private async judge(live: () => boolean) {
    try {
      const legality = await deckLegality(this.decks, live);
      if (!live()) return;
      this.legality = legality;
      this.emit();
    } catch (error) {
      reportError("judge deck legality", error);
    }
  }

  private async mutate(work: () => Promise<unknown>) {
    const live = this.epoch.current();
    this.busy = true;
    this.message = "";
    this.result = "";
    this.emit();
    let succeeded = false;
    let failure = "";
    try {
      await work();
      succeeded = true;
    } catch (error) {
      const status = error instanceof api.ApiError ? error.status : 0;
      // Only a create answers 409 here: renames send no version, so they never conflict.
      failure =
        status === 401
          ? "Your session expired. Sign in again."
          : status === 409
            ? `Your library is full (${MAX_DECKS_PER_USER} decks). Delete one to make room.`
            : "Could not save the change. Please try again.";
    }
    if (!live()) return;
    this.busy = false;
    // Reconcile with the server even when the write fails.
    const loaded = await this.load();
    if (!loaded?.()) return;
    this.result = succeeded ? "ok" : "error";
    if (failure) this.message = failure;
    this.emit();
  }

  async command(raw: string) {
    const fields = decodeFields(raw);
    if (!fields) return;
    const [action, a = "", b = "", c = ""] = fields;
    if (action === "open") {
      this.active = true;
      await this.load();
      return;
    }
    if (action === "close") {
      this.active = false;
      return;
    }
    if (action === "size") {
      this.size = a === "4" ? 4 : 12;
      this.emit();
      return;
    }
    if (this.busy) return;
    if (action === "refresh") {
      await this.load();
      return;
    }
    this.result = "";
    this.message = "";
    if (action === "search") {
      this.query = a.slice(0, 100);
      this.page = 1;
    }
    if (action === "sort" && sorts.includes(a)) {
      this.sort = a;
      this.page = 1;
      writePersisted(SORT_KEY, a);
    }
    if (action === "page") {
      const pages = Math.max(1, Math.ceil(this.visible().decks.length / this.size));
      this.page = ((this.page - 1 + (a === "-1" ? -1 : 1) + pages) % pages) + 1;
    }
    if (this.phase !== "ready") {
      this.emit();
      return;
    }
    if (action === "edit" && this.decks.some((d) => d.id === a)) this.openDeck(a);
    // Folder commands from stale clients cannot create, move or delete folders.
    const item = a === "deck" ? this.decks.find((d) => d.id === b) : undefined;
    if (a !== "deck") {
      this.emit();
      return;
    }
    if (action === "create" || (action === "rename" && item)) {
      const name = (action === "create" ? b : c).trim();
      if (!name || name.length > DECK_NAME_MAX) {
        this.message = `Use 1 to ${DECK_NAME_MAX} characters for the name.`;
        this.emit();
        return;
      }
      await this.mutate(() =>
        action === "create"
          ? api.createDeck({
              name,
              folderId: null,
              tint: Math.floor(Math.random() * 360),
              cards: [],
            })
          : api.patchDeck(b, { name }),
      );
      return;
    }
    if (action === "delete" && item) {
      await this.mutate(() => api.deleteDeck(b));
      return;
    }
    this.emit();
  }
}
