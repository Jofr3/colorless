import type { SimulationGap } from "@colorless/engine";
type Engine = Pick<typeof import("@colorless/engine"), "simulationGaps">;
import * as api from "../lib/api";
import {
  type Card,
  type CardsQueryParams,
  DECK_NAME_MAX,
  MAX_DECK_CARD_ENTRIES,
  type CatalogFacets,
  type Deck as SavedDeck,
  deckConflictSchema,
  MAX_CACHED_CARDS_PAGE,
  UNCACHED_CATALOG_PARAMS,
} from "@colorless/schema";
import { decodeFields, encodeRows } from "./wire";
import { WIRE_ROWS, type WireValue, wireRow } from "./wireFields";

const W = WIRE_ROWS.builder;
import { DEFAULT_FILTERS, type Filters } from "../decks/poolFilter";
import { formatById } from "@colorless/engine/rules";
import { ENERGY_TYPES, type BuilderCard } from "../decks/cards";
import {
  filtersToCardsQuery,
  indexedCard,
  toBuilderCard,
  importDecklist,
  kindOptions,
  loadCardIndex,
  loadFacets,
  loadSeries,
  loadSets,
  searchCards,
  suffixOptions,
} from "../decks/catalog";
import {
  remainingAllowedFor,
  validateDeck,
  countsBySupertype,
  illegalCardNames,
  type Deck,
} from "../decks/deckMath";
import { createDeckSaver, type DeckSaver, outcomeUnknown } from "../decks/deckSaver";
import { savedSnapshot, toSnapshot, type DeckSnapshot } from "../decks/deckSnapshot";
import { formatDecklist } from "../decks/decklistText";
import { cachedCard, fetchCard } from "../game/cardPool";
import { LUA_ART_SLOTS } from "./artworkCache";
import { reportError } from "../lib/reportError";
import type { AccountStatus } from "./account";
import { epochGuard, sessionUser } from "./epochGuard";

type Option = { key: string; label: string; values: string[]; labels?: string[] };
type CatalogPage = { items: BuilderCard[]; total: number };
type Catalog = { query: ReturnType<typeof filtersToCardsQuery>; size: number; key: string };
type Command = (a: string, b: string) => void | Promise<void>;
/** Pages fetched on each side of the visible one, so paging never waits. */
const PREFETCH_PAGES = 2;
const SEARCH_DEBOUNCE_MS = 250;
/** How long a search may take before the results on screen show as busy (Lua dims them). A page
    that lands sooner, as every card-index search does, replaces them in one emit. */
const SEARCH_BUSY_MS = 150;
const MAX_IMPORT_COPIES = 99;
const MAX_CACHED_PAGES = 40;
/** Browser data adapter. Lua owns the editor, its dialogs, and card interaction. */
/** Messages for a failed load, the ones the Retry button answers. */
const LOAD_FAILED = {
  deck: "Could not open this deck. Try again.",
  cards: "Some cards did not load. Retry before adding.",
  options: "Filter options did not load. Retry to reconnect.",
  search: "Card search failed. Try again.",
} as const;
const LOAD_FAILURES = new Set<string>(Object.values(LOAD_FAILED));
// Messages show on one 294 px line beside Retry, shrunk to size 14 at most: a longer one wraps
// under the Back bar, so every message stays within MESSAGE_MAX_PX at that size (builder.test.ts).
const MESSAGE = {
  chooseDeck: "Choose a deck from your library.",
  deckConflict: "Deck changed elsewhere; reloaded the latest.",
  saveFailed: "Could not save. Your edits are kept. Retry.",
  resolveBeforeAdding: "Resolve unavailable cards before adding more.",
  cardsLoading: "Deck cards are still loading.",
  copyLimit: "This card has reached its copy limit.",
  resolveBeforeExporting: "Resolve unavailable cards before exporting.",
  importCancelled: "Import cancelled. Deck unchanged.",
  resolving: "Resolving decklist...",
  tooManyLines: "Too many card lines. Deck unchanged.",
  noDecklist: "No usable decklist, or too long. Deck unchanged.",
  imported: "Deck imported.",
  importFailed: "Import failed. Your deck is unchanged. Try again.",
} as const;
/** Every message the builder shows other than the unknown-card count (`unresolvedMessage`). */
export const FIXED_MESSAGES: readonly string[] = [
  ...Object.values(LOAD_FAILED),
  ...Object.values(MESSAGE),
];
/** m6x11plus advances at size 14 for ASCII 32-126, in 7/8 px steps minus 3 (read with fontTools;
    the font has no kerning). Other characters count as 4, the width of most letters. */
const MESSAGE_GLYPHS =
  "40354470223404044444444444003434744444444444464445444446544242444444444440240644444444465443034";
/** The width a message's caption needs at its smallest size, size 14. */
export function messageWidth(text: string): number {
  let steps = 0;
  for (const ch of text) steps += Number(MESSAGE_GLYPHS[(ch.codePointAt(0) ?? 0) - 32] ?? 4) + 3;
  return steps * 0.875;
}
const MESSAGE_MAX_PX = 280;

/** Why an import was refused over unknown lines, naming as many of them as fit one line. */
export function unresolvedMessage(lines: readonly string[]): string {
  const unchanged = ". Deck unchanged.";
  for (let shown = lines.length; shown > 0; shown--) {
    const more = shown < lines.length ? ` +${lines.length - shown} more` : "";
    const text = `Unknown: ${lines.slice(0, shown).join(", ")}${more}${unchanged}`;
    if (messageWidth(text) <= MESSAGE_MAX_PX) return text;
  }
  return `${lines.length} unknown ${lines.length === 1 ? "card" : "cards"}${unchanged}`;
}

/** For a save refused as a version conflict, the deck as the server now holds it, or null when the
    409 did not carry it; undefined for any other failure. */
function conflictingDeck(error: unknown): SavedDeck | null | undefined {
  if (!(error instanceof api.ApiError) || error.status !== 409) return undefined;
  const parsed = deckConflictSchema.safeParse(error.body);
  return parsed.success ? parsed.data.deck : null;
}

/** What the card details panel shows: the card's effect, abilities and attacks. */
function rulesText(c: Card): string {
  return (
    [
      c.effect,
      ...(c.abilities ?? []).map((x) => `${x.name}: ${x.effect ?? ""}`),
      ...(c.attacks ?? []).map(
        (x) => `${x.name}${x.damage ? `  ${x.damage}` : ""}\n${x.effect ?? ""}`,
      ),
    ]
      .filter(Boolean)
      .join("\n\n") || "No additional rules text."
  );
}

/** The filter options, each shared module-wide (catalog.ts). */
function catalogOptions() {
  return Promise.all([loadFacets(), loadSets(), loadSeries()]);
}

/** Whether the builder serves `page` of `query` from the card index rather than GET /cards: any
    page the API would not cache. */
function fromIndex(query: CardsQueryParams, page: number): boolean {
  return (
    page > MAX_CACHED_CARDS_PAGE ||
    UNCACHED_CATALOG_PARAMS.some((param) => query[param] !== undefined)
  );
}
export class LuaBuilder {
  id = "";
  name = "";
  format = "standard";
  phase = "loading";
  message = "";
  saveStatus = "";
  entries = new Map<string, number>();
  cards = new Map<string, BuilderCard>();
  /** Entries whose card details have been asked for and not answered. Until then they publish as
      loading rather than unavailable, and nothing may discard them. */
  pending = new Set<string>();
  private hydrating: Promise<void> = Promise.resolve();
  /** What each card whose details loaded prints that the simulator cannot play. */
  gaps = new Map<string, readonly SimulationGap[]>();
  cover: string | null = null;
  filters: Filters = { ...DEFAULT_FILTERS };
  results: BuilderCard[] = [];
  private previewIds: string[] = [];
  // Deck cards on the pages either side of the visible deck page.
  private nearbyPreviewIds: string[] = [];
  optionKey = "";
  optionQuery = "";
  optionPage = 1;
  page = 1;
  size = 8;
  total = 0;
  busy = false;
  selected = "";
  details = "";
  transfer = "";
  private user = "";
  private active = false;
  private readonly epoch = epochGuard();
  private readonly searches = epochGuard();
  private revision = 0;
  private saver?: DeckSaver<DeckSnapshot>;
  private savedTimer?: ReturnType<typeof setTimeout>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private busyTimer?: ReturnType<typeof setTimeout>;
  private facets: CatalogFacets | null = null;
  private sets: { id: string; name: string; serie?: { id: string } }[] = [];
  private series: { id: string; name: string }[] = [];
  private pendingExit?: () => void;
  private acknowledged = "";
  private dirty = false;
  private leaving = false;
  /** Set while persistNow() fires a save, which then outlives the page. */
  private keepalive = false;
  private importing = false;
  private importGeneration = 0;
  // Catalog pages for the current query, keyed by page; cleared when it changes.
  private pageKey = "";
  // The query `total` was counted for.
  private pages = new Map<number, CatalogPage>();
  // In-flight page requests by page.
  private pageRequests = new Map<number, Promise<CatalogPage>>();
  // Every match of the current free-text query, found in the card index.
  private indexMatches?: { key: string; cards: Promise<BuilderCard[]> };
  constructor(
    private publish: (raw: string) => void,
    private back: () => void,
    private images: (cards: { id: string; url: string }[]) => void = () => {},
    /** The rules engine, a separate chunk; loaded with the first card details. */
    private engine: () => Promise<Engine> = () => import("@colorless/engine"),
  ) {}
  session(status: AccountStatus, user: string) {
    const next = sessionUser(status, user, this.user);
    if (next === undefined) return;
    this.epoch.invalidate();
    this.searches.invalidate();
    clearTimeout(this.searchTimer);
    clearTimeout(this.busyTimer);
    clearTimeout(this.savedTimer);
    this.pendingExit = undefined;
    this.leaving = false;
    this.importing = false;
    this.saver?.dispose();
    this.saver = undefined;
    this.user = next;
    this.entries.clear();
    this.cards.clear();
    this.pending.clear();
    this.previewIds = [];
    this.results = [];
    this.name = "";
    this.dirty = false;
    this.message = "";
    this.saveStatus = "";
    this.details = "";
    this.transfer = "";
    this.selected = "";
    this.cover = null;
    this.phase = this.user ? "loading" : status === "error" ? "error" : "anonymous";
    if (this.active && this.user) void this.load();
    else this.emit();
  }
  deck(): Deck {
    return [...this.entries].flatMap(([id, quantity]) => {
      const card = this.cards.get(id);
      return card ? [{ card, quantity }] : [];
    });
  }
  snapshot() {
    return toSnapshot(this.name, this.format, this.entries, this.cover);
  }
  options(): Option[] {
    return [
      {
        key: "supertype",
        label: "Category",
        values: ["all", "Pokémon", "Trainer", "Energy"],
        labels: ["All", "Pokemon", "Trainer", "Energy"],
      },
      { key: "types", label: "Energy type", values: ["", ...ENERGY_TYPES] },
      {
        key: "subtypes",
        label: "Card kind",
        values: ["", ...kindOptions(this.filters.supertype, this.facets)],
      },
      {
        key: "suffixes",
        label: "Rule box",
        values: ["", ...suffixOptions(this.filters.supertype, this.facets)],
      },
      { key: "rarities", label: "Rarity", values: ["", ...(this.facets?.rarities ?? [])] },
      { key: "legalOnly", label: "Legal cards only", values: ["1", "0"], labels: ["On", "Off"] },
      {
        key: "setId",
        label: "Set",
        values: ["", ...this.sets.map((s) => s.id)],
        labels: ["All", ...this.sets.map((s) => s.name)],
      },
      {
        key: "serieId",
        label: "Series",
        values: ["", ...this.series.map((s) => s.id)],
        labels: ["All", ...this.series.map((s) => s.name)],
      },
      {
        key: "illustrator",
        label: "Illustrator",
        values: ["", ...(this.facets?.illustrators ?? [])],
      },
      {
        key: "regulationMark",
        label: "Regulation mark",
        values: ["", ...(this.facets?.regulationMarks ?? [])],
      },
    ];
  }
  value(key: string): string {
    const value = this.filters[key as keyof Filters];
    return Array.isArray(value)
      ? (value[0] ?? "")
      : typeof value === "boolean"
        ? String(+value)
        : String(value ?? "");
  }
  emit() {
    const deck = this.deck();
    const remaining = remainingAllowedFor(deck, formatById(this.format));
    const copyLimit = remainingAllowedFor([], formatById(this.format));
    const count = [...this.entries.values()].reduce((a, b) => a + b, 0);
    const validation = validateDeck(deck, formatById(this.format));
    const illegal = illegalCardNames(deck, formatById(this.format));
    const loading = this.loadingCount();
    const missing = [...this.entries.keys()].filter((id) => !this.cards.has(id)).length - loading;
    const groups = countsBySupertype(deck);
    const rows: WireValue[][] = [
      wireRow(W.header, {
        revision: ++this.revision,
        phase: this.phase,
        name: this.name,
        format: this.format,
        saveStatus: this.saveStatus,
        message: this.message,
        busy: +this.busy,
        page: this.page,
        pages: this.lastPage(),
        total: this.total,
        count,
        selected: this.selected,
        details: this.details,
        transfer: this.transfer,
        cover: this.cover ?? "",
        importing: +this.importing,
        dirty: +this.dirty,
        retry: +LOAD_FAILURES.has(this.message),
      }),
    ];
    const row = (tag: "C" | "D" | "S", c: BuilderCard) =>
      wireRow(
        W.card,
        {
          cardId: c.cardId,
          name: c.name,
          supertype: c.supertype,
          subtype: c.subtype,
          quantity: this.entries.get(c.cardId) ?? 0,
          remaining: remaining(c),
          hp: c.hp ?? "",
          mark: c.regulationMark ?? "",
          number: c.number ?? "",
          copyLimit: copyLimit(c),
          illegal: +illegal.has(c.name),
          gaps: (this.gaps.get(c.cardId) ?? []).join(","),
        },
        tag,
      );
    for (const c of this.results) rows.push(row("C", c));
    for (const [id, quantity] of this.entries) {
      const c = this.cards.get(id);
      rows.push(
        c
          ? row("D", c)
          : this.pending.has(id)
            ? wireRow(W.pending, { cardId: id, name: "Loading card...", quantity })
            : wireRow(
                W.card,
                {
                  cardId: id,
                  name: "Unavailable card",
                  supertype: "",
                  subtype: "",
                  quantity,
                  remaining: 0,
                  hp: "",
                  mark: "",
                  number: "",
                  copyLimit: "",
                  illegal: "",
                  gaps: "",
                },
                "D",
              ),
      );
    }
    const selectedCard = this.cards.get(this.selected);
    if (selectedCard) rows.push(row("S", selectedCard));
    rows.push(
      wireRow(W.validation, {
        message: loading
          ? "Loading cards..."
          : missing
            ? `${missing} card(s) unavailable. Remove them or retry loading.`
            : validation.legal
              ? "Ready to play"
              : validation.issues.map((i) => i.message).join("\n"),
        pokemon: groups.Pokémon,
        trainer: groups.Trainer,
        energy: groups.Energy,
      }),
    );
    for (const o of this.options()) {
      const value = this.value(o.key);
      const i = o.values.indexOf(value);
      const selected = this.filters[o.key as keyof Filters];
      rows.push(
        wireRow(W.option, {
          key: o.key,
          label: o.label,
          value:
            Array.isArray(selected) && selected.length > 1
              ? `${selected.length} selected`
              : (o.labels?.[i] ?? (value || "All")),
          count: o.values.length,
          index: i + 1,
          selected:
            Array.isArray(selected) && selected.length > 0
              ? o.values
                  .flatMap((v, index) => (selected.includes(v as never) ? [index + 1] : []))
                  .join(",")
              : String(i + 1),
        }),
      );
    }
    const option = this.options().find((o) => o.key === this.optionKey);
    if (option) {
      const choices = option.values
        .map((v, i) => ({ value: v, label: option.labels?.[i] ?? (v || "All") }))
        .filter((c) => c.label.toLocaleLowerCase().includes(this.optionQuery.toLocaleLowerCase()));
      this.optionPage = Math.max(
        1,
        Math.min(Math.max(1, Math.ceil(choices.length / 7)), this.optionPage),
      );
      rows.push(
        wireRow(W.picker, {
          key: this.optionKey,
          label: option.label,
          page: this.optionPage,
          pages: Math.max(1, Math.ceil(choices.length / 7)),
          query: this.optionQuery,
        }),
      );
      const selected = this.filters[this.optionKey as keyof Filters];
      for (const c of choices.slice((this.optionPage - 1) * 7, this.optionPage * 7)) {
        rows.push(
          wireRow(W.choice, {
            value: c.value,
            label: c.label,
            selected: +(Array.isArray(selected)
              ? c.value === ""
                ? selected.length === 0
                : selected.includes(c.value as never)
              : this.value(this.optionKey) === c.value),
          }),
        );
      }
    }
    for (const k of ["query", "text", "hpMin", "hpMax", "sort"])
      rows.push(wireRow(W.field, { key: k, value: this.value(k) }));
    this.publish(encodeRows(rows));
    this.publishImages();
  }
  /** Visible artwork first, then the prefetched pages nearest to this one. */
  private publishImages() {
    const selectedCard = this.cards.get(this.selected);
    const nearby: BuilderCard[] = [];
    for (let d = 1; d <= PREFETCH_PAGES; d++)
      for (const page of [this.page + d, this.page - d])
        nearby.push(...(this.pages.get(page)?.items ?? []));
    const art = [
      ...this.results,
      ...this.previewIds.flatMap((id) => {
        const card = this.cards.get(id);
        return card && this.entries.has(id) ? [card] : [];
      }),
      ...(selectedCard ? [selectedCard] : []),
      ...nearby,
      ...this.nearbyPreviewIds.flatMap((id) => {
        const card = this.cards.get(id);
        return card ? [card] : [];
      }),
    ];
    this.images(
      [
        ...new Map(
          art
            .filter((c) => c.hasImage !== false)
            .map((c) => [c.cardId, { id: c.cardId, url: api.cardImageUrl(c.cardId, "high") }]),
        ).values(),
      ].slice(0, LUA_ART_SLOTS),
    );
  }
  /** Open the deck. `current` is a copy of it already in hand (a conflict's), and `notice` the
      message to show once it is open. */
  async load(current?: SavedDeck, notice = "") {
    if (!this.user || !this.id) {
      if (!this.id) {
        this.phase = "error";
        this.message = MESSAGE.chooseDeck;
      }
      this.emit();
      return;
    }
    clearTimeout(this.savedTimer);
    clearTimeout(this.searchTimer);
    clearTimeout(this.busyTimer);
    this.searches.invalidate();
    this.busy = false;
    this.previewIds = [];
    this.results = [];
    const live = this.epoch.next();
    const id = this.id;
    this.phase = "loading";
    this.message = "";
    this.emit();
    // The filter options do not depend on the deck, so they load alongside it.
    const options = catalogOptions();
    options.catch(() => {});
    try {
      const data = current?.id === id ? current : await api.getDeck(id);
      if (!live()) return;
      this.message = notice;
      this.name = data.name;
      this.format = data.format ?? "standard";
      this.cover = data.chosenCoverCardId;
      this.entries = new Map(data.cards.map((c) => [c.cardId, c.count]));
      this.pending.clear();
      this.selected = "";
      this.details = "";
      this.saver?.dispose();
      const initial = savedSnapshot(data);
      this.acknowledged = JSON.stringify(initial);
      this.dirty = false;
      this.saveStatus = "";
      // Saves are serialized, so each one is made from the version the previous one left.
      let version = data.version;
      // The saves since the last acknowledged one that got no answer: the server may hold any of them.
      const unconfirmed = new Set<string>();
      const patch = (snapshot: DeckSnapshot) =>
        api.patchDeck(
          id,
          { ...snapshot, name: snapshot.name || undefined, version },
          { keepalive: this.keepalive },
        );
      this.saver = createDeckSaver({
        initial,
        save: async (snapshot) => {
          if (!live() || !this.user) throw new Error("Session changed");
          const key = JSON.stringify(snapshot);
          try {
            let result: SavedDeck;
            try {
              result = await patch(snapshot);
            } catch (error) {
              // A 409 carrying one of this tab's unanswered saves is that save landing, not
              // another device: take its version and send the current edits on top of it,
              // unless they are what landed.
              const latest = conflictingDeck(error);
              const landed = latest ? JSON.stringify(savedSnapshot(latest)) : "";
              if (!latest || !unconfirmed.has(landed) || !live()) throw error;
              version = latest.version;
              unconfirmed.clear();
              this.acknowledged = landed;
              result = landed === key ? latest : await patch(snapshot);
            }
            version = result.version;
            unconfirmed.clear();
            if (live()) this.acknowledged = key;
            return result;
          } catch (error) {
            // The server may or may not hold this snapshot, so every state counts as unsaved.
            if (outcomeUnknown(error)) {
              unconfirmed.add(key);
              if (live()) this.acknowledged = "";
            }
            // Another tab or device saved first. Its copy wins and this one's unsaved edits go
            // (the user's call, over offering to overwrite). The reload starts a new epoch, which
            // silences this saver's status callback and any save queued behind this one.
            const latest = conflictingDeck(error);
            if (latest !== undefined && live() && this.active) {
              this.pendingExit = undefined;
              this.leaving = false;
              void this.load(latest ?? undefined, MESSAGE.deckConflict);
            }
            throw error;
          }
        },
        onStatus: (status) => {
          if (!live()) return;
          this.saveStatus = status;
          clearTimeout(this.savedTimer);
          if (status === "saved") {
            if (this.message === MESSAGE.saveFailed) this.message = "";
            this.dirty = JSON.stringify(this.snapshot()) !== this.acknowledged;
            if (this.leaving && !this.dirty) {
              this.exit();
              return;
            }
            this.savedTimer = setTimeout(() => {
              this.saveStatus = "";
              this.emit();
            }, 2200);
          }
          if (status === "failed") {
            this.pendingExit = undefined;
            this.leaving = false;
            this.message = MESSAGE.saveFailed;
          }
          this.emit();
        },
      });
      this.phase = "ready";
      // Cards the page already holds are filled in before the first ready emit; the rest publish
      // as loading until their request answers, so the deck shows without waiting for it.
      const hydrated = this.hydrate(live);
      this.emit();
      await Promise.all([hydrated, this.search(), this.loadOptions(live, options)]);
      // Name and rules-text searches run over the card index; load it once the deck has shown, so
      // the first search does not wait for it.
      if (live()) loadCardIndex().catch((error) => reportError("load card index", error));
    } catch (error) {
      reportError("open deck", error);
      if (live()) {
        this.phase = "error";
        this.message = LOAD_FAILED.deck;
        this.emit();
      }
    }
  }
  /** Entries still waiting for their card details. */
  private loadingCount(): number {
    let count = 0;
    for (const id of this.entries.keys()) if (!this.cards.has(id) && this.pending.has(id)) count++;
    return count;
  }
  /** Fill in the deck's cards from what the page already holds (cards fetched for the library's
      checks, the card index), synchronously, and ask GET /cards for the rest. */
  private hydrate(live: () => boolean): Promise<void> {
    const ids: string[] = [];
    for (const id of this.entries.keys()) {
      if (this.cards.has(id)) continue;
      const full = cachedCard(id);
      const known = full ? toBuilderCard(full) : indexedCard(id);
      if (known) this.cards.set(id, known);
      else ids.push(id);
    }
    if (ids.length === 0) {
      if (this.message === LOAD_FAILED.cards) {
        this.message = "";
        this.emit();
      }
      return Promise.resolve();
    }
    for (const id of ids) this.pending.add(id);
    this.hydrating = this.fetchDeckCards(ids, live);
    return this.hydrating;
  }
  /** An id GET /cards answers without is unavailable; so is every id of a request that failed. */
  private async fetchDeckCards(ids: string[], live: () => boolean) {
    try {
      for (let start = 0; start < ids.length; start += 100) {
        const batch = ids.slice(start, start + 100);
        const data = await api.getCards({ id: batch, pageSize: 100 });
        if (!live()) return;
        for (const item of data.items) {
          const c = toBuilderCard(item);
          this.cards.set(c.cardId, c);
        }
        for (const id of batch) this.pending.delete(id);
      }
      if (this.message === LOAD_FAILED.cards) this.message = "";
      this.emit();
    } catch (error) {
      reportError("hydrate deck cards", error);
      if (live()) {
        for (const id of ids) this.pending.delete(id);
        this.message = LOAD_FAILED.cards;
        this.emit();
      }
    }
  }
  /** Wait out the deck cards' request; false when the deck changed meanwhile. */
  private async settled(): Promise<boolean> {
    if (this.loadingCount() === 0) return true;
    const live = this.epoch.current();
    await this.hydrating;
    return live();
  }
  private async loadOptions(live: () => boolean, options = catalogOptions()) {
    try {
      const [facets, sets, series] = await options;
      if (!live()) return;
      this.facets = facets;
      this.sets = sets;
      this.series = series;
      if (this.message === LOAD_FAILED.options) this.message = "";
      this.emit();
    } catch (error) {
      reportError("load filter options", error);
      if (live()) {
        this.message = LOAD_FAILED.options;
        this.emit();
      }
    }
  }
  /** The results on screen stay there while the next page loads, and are replaced when it lands;
      only a failure or no match clears them. Their ids stay valid, so they still take adds and
      details meanwhile. */
  async search() {
    clearTimeout(this.searchTimer);
    clearTimeout(this.busyTimer);
    if (this.phase !== "ready") return;
    const live = this.epoch.current();
    const latest = this.searches.next();
    const current = () => live() && latest();
    this.busy = true;
    // An empty grid says it is loading at once; results on screen dim only for a slow answer.
    if (this.results.length === 0) this.emit();
    else
      this.busyTimer = setTimeout(() => {
        if (current() && this.busy) this.emit();
      }, SEARCH_BUSY_MS);
    const catalog = this.catalog();
    try {
      const data = await this.fetchPage(catalog, this.page, true);
      if (!current()) return;
      this.results = data.items;
      this.total = data.total;
      if (this.message === LOAD_FAILED.search) this.message = "";
    } catch (error) {
      reportError("search cards", error);
      if (current()) {
        this.results = [];
        this.message = LOAD_FAILED.search;
      }
    }
    if (current()) {
      this.busy = false;
      clearTimeout(this.busyTimer);
      this.emit();
      this.prefetch(catalog);
    }
  }
  /** The last page the pager reaches. Only pages the API caches are requested from it (see
      `fromIndex`), so every result pages to its end. */
  private lastPage(): number {
    return Math.max(1, Math.ceil(this.total / this.size));
  }
  private catalog(): Catalog {
    const query = filtersToCardsQuery(this.filters, formatById(this.format));
    return { query, size: this.size, key: JSON.stringify([query, this.size]) };
  }
  /** One request per page and query for the pages the API caches in KV; every other page comes
      from the card index, searched once per query in the browser. An uncached page (free text, an
      HP bound, or past MAX_CACHED_CARDS_PAGE) would read much of the table and spend the API's
      per-address search limit, which brisk paging would exhaust. `fresh` refetches a cached
      page. */
  private fetchPage(catalog: Catalog, page: number, fresh = false): Promise<CatalogPage> {
    const { query, key } = catalog;
    if (key !== this.pageKey) {
      this.pageKey = key;
      this.pages.clear();
      this.pageRequests.clear();
    }
    const cached = this.pages.get(page);
    if (cached && !fresh) return Promise.resolve(cached);
    if (fromIndex(query, page)) return this.indexPage(catalog, page);
    const pending = this.pageRequests.get(page);
    if (pending) return pending;
    const request = api
      .getCards({ ...query, page, pageSize: catalog.size })
      .then((data) => {
        const result = { items: data.items.map(toBuilderCard), total: data.total };
        if (key === this.pageKey) this.keepPage(page, result);
        return result;
      })
      .finally(() => {
        if (this.pageRequests.get(page) === request) this.pageRequests.delete(page);
      });
    if (key === this.pageKey) this.pageRequests.set(page, request);
    return request;
  }
  /** A free-text query's page, sliced from every match the card index finds for it. */
  private indexPage({ query, size, key }: Catalog, page: number): Promise<CatalogPage> {
    if (this.indexMatches?.key !== key) {
      const entry = { key, cards: loadCardIndex().then((loaded) => searchCards(loaded, query)) };
      this.indexMatches = entry;
      // A failed load is forgotten, so Retry loads the index again.
      entry.cards.catch(() => {
        if (this.indexMatches === entry) this.indexMatches = undefined;
      });
    }
    return this.indexMatches.cards.then((matches) => {
      const result = {
        items: matches.slice((page - 1) * size, page * size),
        total: matches.length,
      };
      if (key === this.pageKey) this.keepPage(page, result);
      return result;
    });
  }
  /** Cache a page of the current query, keeping only the pages nearest the visible one. */
  private keepPage(page: number, result: CatalogPage) {
    for (const c of result.items) this.cards.set(c.cardId, c);
    this.pages.set(page, result);
    while (this.pages.size > MAX_CACHED_PAGES) {
      const far = [...this.pages.keys()].reduce((a, b) =>
        Math.abs(a - this.page) >= Math.abs(b - this.page) ? a : b,
      );
      this.pages.delete(far);
    }
  }
  /** Warm the neighbouring pages and queue their artwork behind this page's. */
  private prefetch(catalog: Catalog) {
    if (catalog.key !== this.pageKey) return;
    const live = this.epoch.current();
    const last = this.lastPage();
    for (let d = 1; d <= PREFETCH_PAGES; d++)
      for (const page of [this.page + d, this.page - d]) {
        if (page < 1 || page > last || this.pages.has(page)) continue;
        this.fetchPage(catalog, page)
          .then(() => {
            if (live() && catalog.key === this.pageKey) this.publishImages();
          })
          .catch((error) => reportError("prefetch card page", error));
      }
  }
  private changed() {
    this.message = "";
    this.cover = this.snapshot().chosenCoverCardId;
    this.dirty = JSON.stringify(this.snapshot()) !== this.acknowledged;
    // An edit made while a failed save waits to be sent again joins that retry.
    this.saveStatus = !this.dirty ? "" : this.saveStatus === "retrying" ? "retrying" : "pending";
    this.saver?.schedule(this.snapshot());
    this.emit();
  }
  /** Whether leaving the page now could lose edits: some are unsaved, or a save is still on its way. */
  hasUnsavedEdits() {
    return this.id !== "" && this.phase === "ready" && (this.dirty || this.saver?.idle() === false);
  }
  /** Send the pending edits now, in a request that outlives the page: it is being hidden, and may be
      discarded, or closed. A save already in flight or backing off is left to finish. */
  persistNow() {
    this.keepalive = true;
    try {
      this.saver?.flush();
    } finally {
      this.keepalive = false;
    }
  }
  /** Send edits whose save failed again, as when the network comes back. */
  retrySave() {
    this.saver?.flush();
  }
  navigate(done: () => void) {
    if (this.dirty) {
      this.pendingExit = done;
      this.leaving = true;
      this.saver?.flush();
    } else done();
  }
  private exit() {
    this.leaving = false;
    this.active = false;
    const done = this.pendingExit;
    this.pendingExit = undefined;
    if (done) done();
    else this.back();
  }
  /** Commands that apply in every phase. */
  private readonly anytimeCommands = new Map<string, Command>([
    ["open", (a) => this.onOpen(a)],
    ["size", (a) => this.onSize(a)],
    ["leave", () => this.onLeave()],
    ["close", () => this.onClose()],
  ]);
  /** Commands that need a loaded deck; while it loads only `retry` applies. */
  private readonly readyCommands = new Map<string, Command>([
    ["preview-cards", (a, b) => this.onPreviewCards(a, b)],
    ["retry-save", () => this.retrySave()],
    ["retry", () => this.onRetry()],
    ["name", (a) => this.onName(a)],
    ["format", () => this.onFormat()],
    ["add", (a) => this.onAdd(a)],
    ["discard", (a) => this.onDiscard(a)],
    ["remove", (a) => this.onRemove(a)],
    ["clear", () => this.onClear()],
    ["cover", (a) => this.onCover(a)],
    ["page", (a) => this.onPage(a)],
    ["sort", () => this.onSort()],
    ["options", (a) => this.onOptions(a)],
    ["option-query", (a) => this.onOptionQuery(a)],
    ["option-page", (a) => this.onOptionPage(a)],
    ["option-pick", (a) => this.onOptionPick(a)],
    ["reset", () => this.onReset()],
    ["filter", (a, b) => this.onFilter("filter", a, b)],
    ["cycle", (a, b) => this.onFilter("cycle", a, b)],
    ["detail", (a) => this.onDetail(a)],
    ["export", () => this.onExport()],
    ["cancel-import", () => this.onCancelImport()],
    ["import", (a) => this.onImport(a)],
  ]);
  async command(raw: string) {
    const fields = decodeFields(raw);
    if (!fields) return;
    const [action = "", a = "", b = ""] = fields;
    const anytime = this.anytimeCommands.get(action);
    if (anytime) {
      await anytime(a, b);
      return;
    }
    if (this.phase !== "ready") {
      if (action === "retry") await this.load();
      return;
    }
    await this.readyCommands.get(action)?.(a, b);
  }
  private async onOpen(id: string) {
    if (this.active && this.id === id && this.phase === "ready") return;
    this.active = true;
    this.id = id;
    this.leaving = false;
    this.page = 1;
    this.filters = { ...DEFAULT_FILTERS };
    await this.load();
  }
  private async onSize(size: string) {
    this.size = Number(size) === 4 ? 4 : 8;
    // The results kept on screen while page 1 loads fit the grid they draw in.
    this.results = this.results.slice(0, this.size);
    this.page = 1;
    await this.search();
  }
  private onLeave() {
    if (this.dirty) {
      this.pendingExit = undefined;
      this.leaving = true;
      this.saver?.flush();
    } else this.exit();
  }
  private onClose() {
    this.importGeneration++;
    this.importing = false;
    this.saver?.flush();
    this.active = false;
  }
  private onPreviewCards(visible: string, nearby: string) {
    this.previewIds = visible
      .split("\n")
      .filter((id) => this.entries.has(id))
      .slice(0, 6);
    this.nearbyPreviewIds = nearby
      .split("\n")
      .filter((id) => this.entries.has(id))
      .slice(0, 6 * 2 * PREFETCH_PAGES);
    this.emit();
  }
  private async onRetry() {
    const live = this.epoch.current();
    await Promise.all([this.hydrate(live), this.search(), this.loadOptions(live)]);
  }
  private onName(name: string) {
    this.name = name.slice(0, DECK_NAME_MAX);
    this.changed();
  }
  private async onFormat() {
    this.format = this.format === "standard" ? "expanded" : "standard";
    this.changed();
    this.page = 1;
    await this.search();
  }
  /** An add made while the deck's cards load waits for them, so its copy limit counts every copy. */
  private async onAdd(id: string) {
    if (this.loadingCount() > 0 && !(await this.settled())) return;
    const c = this.cards.get(id);
    if (this.loadingCount() > 0) {
      this.message = MESSAGE.cardsLoading;
      this.emit();
      return;
    }
    if ([...this.entries.keys()].some((entry) => !this.cards.has(entry))) {
      this.message = MESSAGE.resolveBeforeAdding;
      this.emit();
      return;
    }
    if (
      c &&
      remainingAllowedFor(this.deck(), formatById(this.format))(c) > 0 &&
      (this.entries.has(id) || this.entries.size < MAX_DECK_CARD_ENTRIES)
    ) {
      this.entries.set(id, (this.entries.get(id) ?? 0) + 1);
      this.changed();
    } else {
      this.message = MESSAGE.copyLimit;
      this.emit();
    }
  }
  /** Drops an entry whose card no longer resolves. One still loading is not known to be gone. */
  private onDiscard(id: string) {
    if (this.cards.has(id) || this.pending.has(id)) return;
    this.entries.delete(id);
    this.changed();
  }
  /** A loading entry shows no card, so what a removal would take from it is not known yet. */
  private onRemove(id: string) {
    if (!this.cards.has(id) && this.pending.has(id)) return;
    const n = this.entries.get(id) ?? 0;
    if (n <= 1) this.entries.delete(id);
    else this.entries.set(id, n - 1);
    this.changed();
  }
  private onClear() {
    this.entries.clear();
    this.changed();
  }
  private onCover(id: string) {
    this.cover = this.entries.has(id) ? id : null;
    this.changed();
  }
  private async onPage(delta: string) {
    this.page = Math.max(1, Math.min(this.lastPage(), this.page + Number(delta)));
    // A prefetched page shows at once, with no loading state.
    const catalog = this.catalog();
    const cached = catalog.key === this.pageKey ? this.pages.get(this.page) : undefined;
    if (!cached || this.phase !== "ready") {
      await this.search();
      return;
    }
    clearTimeout(this.searchTimer);
    clearTimeout(this.busyTimer);
    this.searches.invalidate();
    this.busy = false;
    this.results = cached.items;
    this.total = cached.total;
    this.emit();
    this.prefetch(catalog);
  }
  private async onSort() {
    const sorts: Filters["sort"][] = ["name", "hp-desc", "set"];
    this.filters = {
      ...this.filters,
      sort: sorts[(sorts.indexOf(this.filters.sort) + 1) % sorts.length] ?? "name",
    };
    this.page = 1;
    await this.search();
  }
  private onOptions(key: string) {
    this.optionKey = key;
    this.optionQuery = "";
    this.optionPage = 1;
    this.emit();
  }
  private onOptionQuery(query: string) {
    this.optionQuery = query;
    this.optionPage = 1;
    this.emit();
  }
  private onOptionPage(delta: string) {
    this.optionPage += Number(delta);
    this.emit();
  }
  private async onOptionPick(value: string) {
    const option = this.options().find((o) => o.key === this.optionKey);
    if (!option?.values.includes(value)) return;
    const current = this.filters[this.optionKey as keyof Filters];
    this.setFilter(
      this.optionKey,
      Array.isArray(current)
        ? value === ""
          ? []
          : current.includes(value as never)
            ? current.filter((v) => v !== value)
            : [...current, value]
        : typeof current === "boolean"
          ? value === "1"
          : value,
    );
    this.page = 1;
    await this.search();
  }
  private async onReset() {
    this.filters = { ...DEFAULT_FILTERS };
    this.page = 1;
    await this.search();
  }
  /** `filter` sets a value and debounces the search; `cycle` steps an option by `step`. */
  private async onFilter(action: "filter" | "cycle", key: string, arg: string) {
    const option = this.options().find((o) => o.key === key);
    const value =
      action === "cycle" && option
        ? (option.values[
            (option.values.indexOf(this.value(key)) + Number(arg || 1) + option.values.length) %
              option.values.length
          ] ?? "")
        : arg;
    if (!option && !["query", "text", "hpMin", "hpMax"].includes(key)) return;
    const current = this.filters[key as keyof Filters];
    const next = Array.isArray(current)
      ? value
        ? [value]
        : []
      : typeof current === "boolean"
        ? value === "1"
        : value;
    // The text field reports its value again when an edit starts or ends unchanged; refetching
    // then would only repeat the search on screen.
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    this.setFilter(key, next);
    this.page = 1;
    this.searches.invalidate();
    clearTimeout(this.searchTimer);
    if (action === "filter")
      this.searchTimer = setTimeout(() => void this.search(), SEARCH_DEBOUNCE_MS);
    else await this.search();
  }
  /** Changing the supertype clears the kind and rule-box chips, which depend on it. */
  private setFilter(key: string, value: string | string[] | boolean) {
    this.filters = { ...this.filters, [key]: value };
    if (key === "supertype") this.filters = { ...this.filters, subtypes: [], suffixes: [] };
  }
  /** Shows the card's rules text as soon as it arrives, and what the simulator cannot play of it
      once the rules engine has loaded: the engine loads with the first card shown, not with the
      page, and the text does not wait for it. */
  private async onDetail(id: string) {
    const live = this.epoch.current();
    this.selected = id;
    this.details = "Loading card details...";
    this.emit();
    const engine = this.engine();
    // A failed engine load is reported where its gaps are awaited.
    engine.catch(() => {});
    let c: Card;
    try {
      c = await fetchCard(id);
    } catch (error) {
      reportError("load card details", error);
      if (!live() || this.selected !== id) return;
      this.details = "Details could not load. Close and reopen to retry.";
      this.emit();
      return;
    }
    if (!live() || this.selected !== id) return;
    this.cards.set(c.id, toBuilderCard(c));
    this.details = rulesText(c);
    this.emit();
    void this.addGaps(c, engine, live);
  }
  private async addGaps(c: Card, engine: Promise<Engine>, live: () => boolean) {
    if (this.gaps.has(c.id)) return;
    try {
      const { simulationGaps } = await engine;
      if (!live()) return;
      this.gaps.set(c.id, simulationGaps(c));
      this.emit();
    } catch (error) {
      reportError("load rules engine", error);
    }
  }
  /** The decklist waits for the deck's cards, so it never leaves out the ones still loading. */
  private async onExport() {
    if (this.loadingCount() > 0 && !(await this.settled())) return;
    const deck = this.deck();
    this.transfer = deck.length ? formatDecklist(deck) : "";
    const missing = [...this.entries.keys()].some((id) => !this.cards.has(id));
    this.message = missing ? MESSAGE.resolveBeforeExporting : "";
    this.emit();
  }
  private onCancelImport() {
    if (!this.importing) return;
    this.importGeneration++;
    this.importing = false;
    this.message = MESSAGE.importCancelled;
    this.emit();
  }
  private async onImport(text: string) {
    if (this.importing) return;
    const generation = ++this.importGeneration;
    const live = this.epoch.current();
    this.importing = true;
    this.message = MESSAGE.resolving;
    this.emit();
    try {
      const result = await importDecklist(text);
      if (!live() || generation !== this.importGeneration || !this.active) return;
      if (result.tooManyLines) {
        this.message = MESSAGE.tooManyLines;
      } else if (
        result.unmatched.length ||
        result.entries.length === 0 ||
        result.entries.length > MAX_DECK_CARD_ENTRIES
      ) {
        this.message = result.unmatched.length
          ? unresolvedMessage(result.unmatched.map((x) => x.name))
          : MESSAGE.noDecklist;
      } else {
        for (const e of result.entries) this.cards.set(e.card.cardId, e.card);
        this.entries = new Map(
          result.entries.map((e) => [e.card.cardId, Math.min(MAX_IMPORT_COPIES, e.quantity)]),
        );
        this.transfer = text;
        this.changed();
        this.message = MESSAGE.imported;
      }
    } catch (error) {
      reportError("import decklist", error);
      if (!live() || generation !== this.importGeneration || !this.active) return;
      this.message = MESSAGE.importFailed;
    }
    if (live()) {
      this.importing = false;
      this.emit();
    }
  }
}
