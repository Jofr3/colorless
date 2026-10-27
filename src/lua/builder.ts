import type { SimulationGap } from "@colorless/engine";
import * as api from "../lib/api";
import {
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
  toBuilderCard,
  importDecklist,
  kindOptions,
  loadCardIndex,
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
import { createDeckSaver, type DeckSaver } from "../decks/deckSaver";
import { toSnapshot, type DeckSnapshot } from "../decks/deckSnapshot";
import { formatDecklist } from "../decks/decklistText";
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
const DECK_CONFLICT = "Deck changed elsewhere; reloaded the latest.";
const SAVE_FAILED = "Could not save. Your edits are kept. Retry.";
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
  private facets: CatalogFacets | null = null;
  private sets: { id: string; name: string; serie?: { id: string } }[] = [];
  private series: { id: string; name: string }[] = [];
  private pendingExit?: () => void;
  private acknowledged = "";
  private dirty = false;
  private leaving = false;
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
  ) {}
  session(status: AccountStatus, user: string) {
    const next = sessionUser(status, user, this.user);
    if (next === undefined) return;
    this.epoch.invalidate();
    this.searches.invalidate();
    clearTimeout(this.searchTimer);
    clearTimeout(this.savedTimer);
    this.pendingExit = undefined;
    this.leaving = false;
    this.importing = false;
    this.saver?.dispose();
    this.saver = undefined;
    this.user = next;
    this.entries.clear();
    this.cards.clear();
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
    const missing = [...this.entries.keys()].filter((id) => !this.cards.has(id)).length;
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
        message: missing
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
        this.message = "Choose a deck from your library.";
      }
      this.emit();
      return;
    }
    clearTimeout(this.savedTimer);
    clearTimeout(this.searchTimer);
    this.searches.invalidate();
    this.busy = false;
    this.previewIds = [];
    this.results = [];
    const live = this.epoch.next();
    const id = this.id;
    this.phase = "loading";
    this.message = "";
    this.emit();
    try {
      const data = current?.id === id ? current : await api.getDeck(id);
      if (!live()) return;
      this.message = notice;
      this.name = data.name;
      this.format = data.format ?? "standard";
      this.cover = data.chosenCoverCardId;
      this.entries = new Map(data.cards.map((c) => [c.cardId, c.count]));
      this.selected = "";
      this.details = "";
      this.saver?.dispose();
      const initial = this.snapshot();
      this.acknowledged = JSON.stringify(initial);
      this.dirty = false;
      this.saveStatus = "";
      // Saves are serialized, so each one is made from the version the previous one left.
      let version = data.version;
      this.saver = createDeckSaver({
        initial,
        save: async (snapshot) => {
          if (!live() || !this.user) throw new Error("Session changed");
          try {
            const result = await api.patchDeck(id, {
              ...snapshot,
              name: snapshot.name || undefined,
              version,
            });
            version = result.version;
            if (live()) this.acknowledged = JSON.stringify(snapshot);
            return result;
          } catch (error) {
            // Another tab or device saved first. Its copy wins and this one's unsaved edits go
            // (the user's call, over offering to overwrite). The reload starts a new epoch, which
            // silences this saver's status callback and any save queued behind this one.
            const latest = conflictingDeck(error);
            if (latest !== undefined && live() && this.active) {
              this.pendingExit = undefined;
              this.leaving = false;
              void this.load(latest ?? undefined, DECK_CONFLICT);
            }
            throw error;
          }
        },
        onStatus: (status) => {
          if (!live()) return;
          this.saveStatus = status;
          clearTimeout(this.savedTimer);
          if (status === "saved") {
            if (this.message === SAVE_FAILED) this.message = "";
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
            this.message = SAVE_FAILED;
          }
          this.emit();
        },
      });
      this.phase = "ready";
      this.emit();
      await Promise.all([this.hydrate(live), this.search(), this.loadOptions(live)]);
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
  private async hydrate(live: () => boolean) {
    try {
      const ids = [...this.entries.keys()].filter((id) => !this.cards.has(id));
      for (let start = 0; start < ids.length; start += 100) {
        const data = await api.getCards({ id: ids.slice(start, start + 100), pageSize: 100 });
        if (!live()) return;
        for (const item of data.items) {
          const c = toBuilderCard(item);
          this.cards.set(c.cardId, c);
        }
      }
      this.emit();
    } catch (error) {
      reportError("hydrate deck cards", error);
      if (live()) {
        this.message = LOAD_FAILED.cards;
        this.emit();
      }
    }
  }
  private async loadOptions(live: () => boolean) {
    try {
      const [facets, sets, series] = await Promise.all([
        api.getFacets(),
        api.getSets(),
        api.getSeries(),
      ]);
      if (!live()) return;
      this.facets = facets;
      this.sets = sets;
      this.series = series;
      this.emit();
    } catch (error) {
      reportError("load filter options", error);
      if (live()) {
        this.message = LOAD_FAILED.options;
        this.emit();
      }
    }
  }
  async search() {
    clearTimeout(this.searchTimer);
    if (this.phase !== "ready") return;
    const live = this.epoch.current();
    const latest = this.searches.next();
    const current = () => live() && latest();
    this.busy = true;
    this.results = [];
    this.emit();
    const catalog = this.catalog();
    try {
      const data = await this.fetchPage(catalog, this.page, true);
      if (!current()) return;
      this.results = data.items;
      this.total = data.total;
      if (this.message === LOAD_FAILED.search) this.message = "";
    } catch (error) {
      reportError("search cards", error);
      if (current()) this.message = LOAD_FAILED.search;
    }
    if (current()) {
      this.busy = false;
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
    this.saveStatus = this.dirty ? "pending" : "";
    this.saver?.schedule(this.snapshot());
    this.emit();
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
    ["retry-save", () => this.saver?.flush()],
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
  private onAdd(id: string) {
    const c = this.cards.get(id);
    if ([...this.entries.keys()].some((entry) => !this.cards.has(entry))) {
      this.message = "Resolve unavailable cards before adding more.";
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
      this.message = "This card has reached its copy limit.";
      this.emit();
    }
  }
  /** Drops an entry whose card no longer resolves. */
  private onDiscard(id: string) {
    if (this.cards.has(id)) return;
    this.entries.delete(id);
    this.changed();
  }
  private onRemove(id: string) {
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
  private async onDetail(id: string) {
    const live = this.epoch.current();
    this.selected = id;
    this.details = "Loading card details...";
    this.emit();
    try {
      // The rules engine loads with the first card shown, not with the page.
      const [c, { simulationGaps }] = await Promise.all([
        api.getCard(id),
        import("@colorless/engine"),
      ]);
      if (!live() || this.selected !== id) return;
      this.cards.set(c.id, toBuilderCard(c));
      this.gaps.set(c.id, simulationGaps(c));
      this.details =
        [
          c.effect,
          ...(c.abilities ?? []).map((x) => `${x.name}: ${x.effect ?? ""}`),
          ...(c.attacks ?? []).map(
            (x) => `${x.name}${x.damage ? `  ${x.damage}` : ""}\n${x.effect ?? ""}`,
          ),
        ]
          .filter(Boolean)
          .join("\n\n") || "No additional rules text.";
    } catch (error) {
      reportError("load card details", error);
      if (!live() || this.selected !== id) return;
      this.details = "Details could not load. Close and reopen to retry.";
    }
    this.emit();
  }
  private onExport() {
    const deck = this.deck();
    this.transfer = deck.length ? formatDecklist(deck) : "";
    const missing = [...this.entries.keys()].some((id) => !this.cards.has(id));
    this.message = missing ? "Resolve unavailable cards before exporting." : "";
    this.emit();
  }
  private onCancelImport() {
    if (!this.importing) return;
    this.importGeneration++;
    this.importing = false;
    this.message = "Import cancelled. Deck unchanged.";
    this.emit();
  }
  private async onImport(text: string) {
    if (this.importing) return;
    const generation = ++this.importGeneration;
    const live = this.epoch.current();
    this.importing = true;
    this.message = "Resolving decklist...";
    this.emit();
    try {
      const result = await importDecklist(text);
      if (!live() || generation !== this.importGeneration || !this.active) return;
      if (result.tooManyLines) {
        this.message = "Too many card lines. Deck unchanged.";
      } else if (
        result.unmatched.length ||
        result.entries.length === 0 ||
        result.entries.length > MAX_DECK_CARD_ENTRIES
      ) {
        this.message = result.unmatched.length
          ? unresolvedMessage(result.unmatched.map((x) => x.name))
          : "No usable decklist, or too long. Deck unchanged.";
      } else {
        for (const e of result.entries) this.cards.set(e.card.cardId, e.card);
        this.entries = new Map(
          result.entries.map((e) => [e.card.cardId, Math.min(MAX_IMPORT_COPIES, e.quantity)]),
        );
        this.transfer = text;
        this.changed();
        this.message = "Deck imported.";
      }
    } catch (error) {
      reportError("import decklist", error);
      if (!live() || generation !== this.importGeneration || !this.active) return;
      this.message = "Import failed. Your deck is unchanged. Try again.";
    }
    if (live()) {
      this.importing = false;
      this.emit();
    }
  }
}
