import { DECK_NAME_MAX, MAX_DECKS_PER_USER } from "@colorless/schema";
import * as api from "../lib/api";
import type { Deck } from "../decks/data";
import { legalityFrom } from "../game/sandboxDecks";
import { deckNameOrNull } from "../decks/deckSnapshot";
import { type DeckList, deckStore } from "../decks/deckStore";
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

  /** Reloads the decks; the returned check stays true until something newer starts. A list the
   * store already holds (another screen's, or the sign-in prefetch) shows at once meanwhile. */
  async load(): Promise<(() => boolean) | undefined> {
    if (!this.user || this.busy) {
      this.emit();
      return;
    }
    const live = this.epoch.next();
    const cached = deckStore.peek(this.user);
    if (cached) this.show(cached);
    this.busy = true;
    this.message = "";
    this.emit();
    try {
      const list = await deckStore.revalidate(this.user);
      if (!live()) return live;
      this.show(list);
      void this.judge(live, list);
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

  /** `list` on the piles. Incomplete decks are illegal on sight; complete ones keep the verdicts
   * already judged for this revision, or are judged by `judge`. */
  private show(list: DeckList) {
    this.decks = [...list.decks];
    this.legality = legalityFrom(this.decks, deckStore.peekVerdicts(list));
    this.phase = "ready";
  }

  /** Judge the loaded decks in the background and republish the alerts. A
      failed check leaves the piles unmarked rather than surfacing an error:
      the library itself loaded, and the next load retries. */
  private async judge(live: () => boolean, list: DeckList) {
    try {
      const verdicts = await deckStore.judge(list);
      if (!live()) return;
      this.legality = legalityFrom(this.decks, verdicts);
      this.emit();
    } catch (error) {
      reportError("judge deck legality", error);
    }
  }

  /** Runs a deck write, puts the server's answer on the piles and says how it went at once, then
   * reconciles with the server's list behind it, even when the write failed. */
  private async mutate(work: () => Promise<void>) {
    const live = this.epoch.next();
    this.busy = true;
    this.message = "";
    this.result = "";
    this.emit();
    let failure = "";
    try {
      await work();
      const list = deckStore.peek(this.user);
      if (live() && list) this.show(list);
    } catch (error) {
      const status = error instanceof api.ApiError ? error.status : 0;
      // Only a create answers 409 here: renames send no version, so they never conflict.
      failure =
        status === 401
          ? "Your session expired. Sign in again."
          : status === 409
            ? `Your library is full (${MAX_DECKS_PER_USER} decks). Delete one to make room.`
            : status === 429
              ? "Too many changes. Wait a minute."
              : "Could not save the change. Please try again.";
    }
    if (!live()) return;
    this.busy = false;
    this.result = failure ? "error" : "ok";
    if (failure) this.message = failure;
    this.emit();
    await this.reconcile(live);
  }

  /** The server's list after a write, without holding up the result or the page: a list that
   * answers as the piles already are publishes nothing new. */
  private async reconcile(live: () => boolean) {
    try {
      const list = await deckStore.revalidate(this.user);
      if (!live()) return;
      this.show(list);
      this.emit();
      void this.judge(live, list);
    } catch (error) {
      if (!live()) return;
      if (error instanceof api.ApiError && error.status === 401) {
        this.phase = "anonymous";
        this.decks = [];
        this.message = "Your session expired. Sign in again.";
        this.emit();
      } else reportError("reconcile the deck library", error);
    }
  }

  async command(raw: string) {
    const fields = decodeFields(raw);
    if (!fields) return;
    const [action, a = "", b = ""] = fields;
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
    const item = this.decks.find((d) => d.id === a);
    if (action === "edit" && item) this.openDeck(a);
    if (action === "create" || (action === "rename" && item)) {
      const name = deckNameOrNull(action === "create" ? a : b);
      if (!name) {
        this.message = `Use 1 to ${DECK_NAME_MAX} characters for the name.`;
        this.emit();
        return;
      }
      await this.mutate(async () => {
        const deck =
          action === "create"
            ? await api.createDeck({
                name,
                folderId: null,
                tint: Math.floor(Math.random() * 360),
                cards: [],
              })
            : await api.patchDeck(a, { name });
        deckStore.put(this.user, deck);
      });
      return;
    }
    if (action === "delete" && item) {
      await this.mutate(async () => {
        await api.deleteDeck(a);
        deckStore.remove(this.user, a);
      });
      return;
    }
    this.emit();
  }
}
