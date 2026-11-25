// The sandbox table's edit mode: a catalog gallery in the sidebar and free board edits that skip
// the rules. The gallery's search runs over the card index in the browser, like the builder's;
// a dropped card becomes a `sandboxEdit` action, so undo, redo and the saved game replay it.

import type { PokemonTarget, SandboxDestination, SandboxEdit } from "@colorless/engine";
import type { Card } from "@colorless/schema";
import { cachedCard, fetchCard, fetchCardPool } from "../game/cardPool";
import { loadCardIndex, searchCards } from "../decks/catalog";
import type { BuilderCard } from "../decks/cards";
import { cardImageUrl } from "../lib/api";
import { reportError } from "../lib/reportError";

/** Pages prefetched on each side of the visible one, as the builder does, so paging never waits. */
export const GALLERY_PREFETCH_PAGES = 2;

const SIMPLE_DESTINATIONS = ["deck", "hand", "discard", "prizes", "active", "bench", "stadium"];

/** Lua's drop: a zone name, and for `onto` the Pokémon (`-1` the Active, else a Bench index). */
export function editDestination(
  zone: string,
  index: string | undefined,
): SandboxDestination | null {
  if (SIMPLE_DESTINATIONS.includes(zone)) return { zone } as SandboxDestination;
  if (zone !== "onto") return null;
  const at = Number(index);
  if (!Number.isInteger(at) || at < -1) return null;
  const target: PokemonTarget = at === -1 ? { spot: "active" } : { spot: "bench", index: at };
  return { zone: "onto", target };
}

export class SimulatorEdit {
  on = false;
  query = "";
  page = 1;
  perPage = 12;
  busy = false;
  failed = false;
  private results: BuilderCard[] = [];
  private searches = 0;
  constructor(private changed: () => void) {}

  get pages() {
    return Math.max(1, Math.ceil(this.results.length / this.perPage));
  }
  get total() {
    return this.results.length;
  }
  open() {
    this.on = true;
    if (this.results.length === 0) void this.search();
  }
  close() {
    this.on = false;
  }
  setQuery(query: string) {
    if (query === this.query) return;
    this.query = query;
    this.page = 1;
    void this.search();
  }
  setPage(page: number, perPage: number) {
    if (Number.isInteger(perPage) && perPage > 0) this.perPage = perPage;
    const next = Math.max(1, Math.min(this.pages, Number.isInteger(page) ? page : 1));
    if (next === this.page && !this.missingCards()) return;
    this.page = next;
    void this.loadPage(this.searches);
  }
  /** The cards on the page Lua shows. */
  pageCards(page = this.page): BuilderCard[] {
    if (page < 1 || page > this.pages) return [];
    const first = (page - 1) * this.perPage;
    return this.results.slice(first, first + this.perPage);
  }
  /** The cards on the prefetched pages, nearest first, for Lua to draw ahead of a turn. */
  nearbyCards(): BuilderCard[] {
    const nearby: BuilderCard[] = [];
    for (let d = 1; d <= GALLERY_PREFETCH_PAGES; d++)
      for (const page of [this.page + d, this.page - d]) nearby.push(...this.pageCards(page));
    return nearby;
  }
  /** The full card behind a gallery id, once its page has loaded. */
  card(cardId: string): Card | undefined {
    return cachedCard(cardId);
  }
  /** The full card for a drop, fetched if its page has not loaded it yet. */
  fullCard(cardId: string): Promise<Card> {
    return fetchCard(cardId);
  }
  /** The visible page's artwork first, then the prefetched pages' nearest first. */
  art(): [string, string][] {
    return [...this.pageCards(), ...this.nearbyCards()]
      .filter((c) => c.hasImage !== false)
      .map((c) => [c.cardId, cardImageUrl(c.cardId, "high")]);
  }
  private missingCards() {
    return this.pageCards().some((c) => !cachedCard(c.cardId));
  }
  private async search() {
    const id = ++this.searches;
    this.busy = true;
    this.failed = false;
    this.changed();
    try {
      const loaded = await loadCardIndex();
      if (id !== this.searches) return;
      const name = this.query.trim();
      this.results = searchCards(loaded, name ? { name, sort: "name" } : { sort: "set" });
      this.page = Math.min(this.page, this.pages);
      await this.loadPage(id);
    } catch (error) {
      if (id !== this.searches) return;
      reportError("search the edit-mode gallery", error);
      this.busy = false;
      this.failed = true;
      this.changed();
    }
  }
  private async loadPage(id: number) {
    this.busy = true;
    this.changed();
    try {
      await fetchCardPool(this.pageCards().map((c) => c.cardId));
    } catch (error) {
      reportError("load the edit-mode gallery", error);
    }
    if (id !== this.searches) return;
    this.busy = false;
    this.changed();
    void this.prefetch(id);
  }
  /** The prefetched pages' full cards, so their faces and text are ready before a turn. */
  private async prefetch(id: number) {
    const ids = this.nearbyCards()
      .map((c) => c.cardId)
      .filter((cardId) => !cachedCard(cardId));
    if (ids.length === 0) return;
    try {
      await fetchCardPool(ids);
    } catch (error) {
      reportError("prefetch the edit-mode gallery", error);
      return;
    }
    if (id === this.searches && this.on) this.changed();
  }
}

/** The edit an `edit` command asks for, or null for a malformed one. */
export function editFromCommand(
  args: string[],
  prizeUid: (index: number) => string | undefined,
): { edit: SandboxEdit } | { add: string; to: SandboxDestination } | null {
  const [op = "", first = "", zone = "", index] = args;
  if (op === "remove" && first) return { edit: { kind: "remove", uid: first } };
  if (op === "flip") {
    const uid = prizeUid(Number(first));
    return uid ? { edit: { kind: "flipPrize", uid } } : null;
  }
  const to = editDestination(zone, index);
  if (!to || !first) return null;
  if (op === "move") return { edit: { kind: "move", uid: first, to } };
  if (op === "add") return { add: first, to };
  return null;
}
