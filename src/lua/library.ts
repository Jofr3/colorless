import * as api from "../lib/api";
import type { Deck } from "../decks/data";
import { deckLegality } from "../game/sandboxDecks";
import { encodeFields } from "./account";

const sorts: [string, ...string[]] = ["name-asc", "name-desc", "cards-desc"];
const stored = (key: string, allowed: [string, ...string[]]) => {
  try {
    const value = localStorage.getItem(key);
    return value && allowed.includes(value) ? value : allowed[0];
  } catch {
    return allowed[0];
  }
};

/** Data/session adapter only. Layout, card physics and all controls live in Lua. */
export class LuaLibrary {
  decks: Deck[] = [];
  /** Deck id → legal, for the "!" alert on a pile; absent while unchecked. */
  legality = new Map<string, boolean>();
  query = "";
  sort = stored("decks.sortKey", sorts);
  page = 1;
  size = 12;
  phase = "loading";
  busy = false;
  message = "";
  result = "";
  active = false;
  private user = "";
  private epoch = 0;
  private revision = 0;
  constructor(
    private publish: (snapshot: string) => void,
    private openDeck: (id: string) => void,
  ) {}

  session(status: string, id: string) {
    if (id === this.user && status === "authenticated") return;
    if (status === "loading") return;
    this.epoch++;
    this.user = status === "authenticated" ? id : "";
    this.decks = [];
    this.legality = new Map();
    this.busy = false;
    this.message = "";
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
    // Retain reserved mailbox slots so a rebuilt host can boot an older WASM cache.
    this.publish(
      [
        encodeFields([
          ++this.revision,
          this.phase,
          +this.busy,
          this.message,
          "",
          this.query,
          "decks",
          this.sort,
          this.page,
          pages,
          decks.length,
          "",
          0,
          this.result,
        ]),
        ...decks
          .slice((this.page - 1) * this.size, this.page * this.size)
          .map((d) => {
            const legal = this.legality.get(d.id);
            return encodeFields([
              "D",
              d.id,
              d.name,
              "",
              d.cardCount,
              d.tint,
              "",
              legal === undefined ? "" : +!legal,
            ]);
          }),
      ].join("\n"),
    );
  }

  async load() {
    if (!this.user || this.busy) {
      this.emit();
      return;
    }
    const epoch = ++this.epoch;
    this.busy = true;
    this.message = "";
    this.emit();
    try {
      const decks = await api.listDecks();
      if (epoch !== this.epoch) return;
      this.decks = decks;
      // Incomplete decks are illegal on sight; complete ones are judged below.
      this.legality = new Map(
        decks.filter((d) => d.cardCount !== 60).map((d) => [d.id, false] as const),
      );
      this.phase = "ready";
      void this.judge(epoch);
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.phase = error instanceof api.ApiError && error.status === 401 ? "anonymous" : "error";
      if (this.phase === "anonymous") {
        this.decks = [];
      }
      this.message =
        this.phase === "anonymous"
          ? "Your session expired. Sign in again."
          : "Could not load your library. Try again.";
    } finally {
      if (epoch === this.epoch) {
        this.busy = false;
        this.emit();
      }
    }
  }

  /** Judge the loaded decks in the background and republish the alerts. A
      failed check leaves the piles unmarked rather than surfacing an error:
      the library itself loaded, and the next load retries. */
  private async judge(epoch: number) {
    const current = () => epoch === this.epoch;
    try {
      const legality = await deckLegality(this.decks, current);
      if (!current()) return;
      this.legality = legality;
      this.emit();
    } catch {
      /* Left unmarked; see above. */
    }
  }

  private async mutate(work: () => Promise<unknown>) {
    const epoch = this.epoch;
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
      failure =
        error instanceof api.ApiError && error.status === 401
          ? "Your session expired. Sign in again."
          : "Could not save the change. Please try again.";
    }
    if (epoch !== this.epoch) return;
    this.busy = false;
    // Reconcile with the server even when the write fails.
    await this.load();
    if (epoch + 1 !== this.epoch) return;
    this.result = succeeded ? "ok" : "error";
    if (failure) this.message = failure;
    this.emit();
  }

  async command(raw: string) {
    let fields: string[];
    try {
      fields = raw.split("\t").map(decodeURIComponent);
    } catch {
      return;
    }
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
      try {
        localStorage.setItem("decks.sortKey", a);
      } catch {
        /* Optional preference. */
      }
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
      if (!name || name.length > 100) {
        this.message = "Use 1 to 100 characters for the name.";
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
