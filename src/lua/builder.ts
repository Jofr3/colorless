import * as api from "../lib/api";
import { DECK_NAME_MAX, MAX_DECK_CARD_ENTRIES, type CatalogFacets } from "@colorless/schema";
import { decodeFields, encodeRows } from "./wire";
import { DEFAULT_FILTERS, type Filters } from "../decks/poolFilter";
import { formatById, ENERGY_TYPES, type BuilderCard } from "../decks/cards";
import {
  filtersToCardsQuery,
  toBuilderCard,
  importDecklist,
  kindOptions,
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

type Option = { key: string; label: string; values: string[]; labels?: string[] };
type CatalogPage = { items: BuilderCard[]; total: number };
type Catalog = { query: ReturnType<typeof filtersToCardsQuery>; size: number; key: string };
/** Pages fetched on each side of the visible one, so paging never waits. */
const PREFETCH_PAGES = 2;
const SEARCH_DEBOUNCE_MS = 250;
const MAX_IMPORT_COPIES = 99;
const MAX_CACHED_PAGES = 40;
/** Browser data adapter. Lua owns the editor, its dialogs, and card interaction. */
export class LuaBuilder {
  id = "";
  name = "";
  format = "standard";
  phase = "loading";
  message = "";
  saveStatus = "";
  entries = new Map<string, number>();
  cards = new Map<string, BuilderCard>();
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
  private epoch = 0;
  private searchEpoch = 0;
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
  private pages = new Map<number, CatalogPage>();
  private pageRequests = new Map<number, Promise<CatalogPage>>();
  constructor(
    private publish: (raw: string) => void,
    private back: () => void,
    private images: (cards: { id: string; url: string }[]) => void = () => {},
  ) {}
  session(status: AccountStatus, user: string) {
    if (status === "loading" || (status === "authenticated" && user === this.user)) return;
    this.epoch++;
    this.searchEpoch++;
    clearTimeout(this.searchTimer);
    clearTimeout(this.savedTimer);
    this.pendingExit = undefined;
    this.leaving = false;
    this.importing = false;
    this.saver?.dispose();
    this.saver = undefined;
    this.user = status === "authenticated" ? user : "";
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
    const rows: (string | number)[][] = [
      [
        ++this.revision,
        this.phase,
        this.name,
        this.format,
        this.saveStatus,
        this.message,
        +this.busy,
        this.page,
        Math.max(1, Math.ceil(this.total / this.size)),
        this.total,
        count,
        this.selected,
        this.details,
        this.transfer,
        this.cover ?? "",
        +this.importing,
        +this.dirty,
      ],
    ];
    const row = (tag: string, c: BuilderCard) => [
      tag,
      c.cardId,
      c.name,
      c.supertype,
      c.subtype,
      this.entries.get(c.cardId) ?? 0,
      remaining(c),
      c.hp ?? "",
      c.regulationMark ?? "",
      c.number ?? "",
      c.hasImage === false ? 0 : 1,
      copyLimit(c),
      +illegal.has(c.name),
    ];
    for (const c of this.results) rows.push(row("C", c));
    for (const [id, quantity] of this.entries) {
      const c = this.cards.get(id);
      rows.push(c ? row("D", c) : ["D", id, "Unavailable card", "", "", quantity, 0]);
    }
    const selectedCard = this.cards.get(this.selected);
    if (selectedCard) rows.push(row("S", selectedCard));
    rows.push([
      "V",
      missing
        ? `${missing} card(s) unavailable. Remove them or retry loading.`
        : validation.legal
          ? "Ready to play"
          : validation.issues.map((i) => i.message).join("\n"),
      groups.Pokémon,
      groups.Trainer,
      groups.Energy,
    ]);
    for (const o of this.options()) {
      const value = this.value(o.key);
      const i = o.values.indexOf(value);
      const selected = this.filters[o.key as keyof Filters];
      rows.push([
        "O",
        o.key,
        o.label,
        Array.isArray(selected) && selected.length > 1
          ? `${selected.length} selected`
          : (o.labels?.[i] ?? (value || "All")),
        o.values.length,
        i + 1,
        Array.isArray(selected) && selected.length > 0
          ? o.values
              .flatMap((v, index) => (selected.includes(v as never) ? [index + 1] : []))
              .join(",")
          : String(i + 1),
      ]);
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
      rows.push([
        "P",
        this.optionKey,
        option.label,
        this.optionPage,
        Math.max(1, Math.ceil(choices.length / 7)),
        this.optionQuery,
      ]);
      const selected = this.filters[this.optionKey as keyof Filters];
      for (const c of choices.slice((this.optionPage - 1) * 7, this.optionPage * 7)) {
        rows.push([
          "Q",
          c.value,
          c.label,
          +(Array.isArray(selected)
            ? c.value === ""
              ? selected.length === 0
              : selected.includes(c.value as never)
            : this.value(this.optionKey) === c.value),
        ]);
      }
    }
    for (const k of ["query", "text", "hpMin", "hpMax", "sort"]) rows.push(["F", k, this.value(k)]);
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
            .map((c) => [
              c.cardId,
              { id: c.cardId, url: api.cardImageUrl(c.cardId, "high", "png") },
            ]),
        ).values(),
      ].slice(0, LUA_ART_SLOTS),
    );
  }
  async load() {
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
    this.searchEpoch++;
    this.busy = false;
    this.previewIds = [];
    this.results = [];
    const epoch = ++this.epoch;
    const id = this.id;
    this.phase = "loading";
    this.message = "";
    this.emit();
    try {
      const data = await api.getDeck(id);
      if (epoch !== this.epoch) return;
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
      this.saver = createDeckSaver({
        initial,
        save: async (snapshot) => {
          if (epoch !== this.epoch || !this.user) throw new Error("Session changed");
          const result = await api.patchDeck(id, { ...snapshot, name: snapshot.name || undefined });
          if (epoch === this.epoch) this.acknowledged = JSON.stringify(snapshot);
          return result;
        },
        onStatus: (status) => {
          if (epoch !== this.epoch) return;
          this.saveStatus = status;
          clearTimeout(this.savedTimer);
          if (status === "saved") {
            if (this.message.startsWith("Could not save.")) this.message = "";
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
            this.message = "Could not save. Your edits are still here. Retry save.";
          }
          this.emit();
        },
      });
      this.phase = "ready";
      this.emit();
      await Promise.all([this.hydrate(epoch), this.search(), this.loadOptions(epoch)]);
    } catch (error) {
      reportError("open deck", error);
      if (epoch === this.epoch) {
        this.phase = "error";
        this.message = "Could not open this deck. Try again.";
        this.emit();
      }
    }
  }
  private async hydrate(epoch: number) {
    try {
      const ids = [...this.entries.keys()].filter((id) => !this.cards.has(id));
      for (let start = 0; start < ids.length; start += 100) {
        const data = await api.getCards({ id: ids.slice(start, start + 100), pageSize: 100 });
        if (epoch !== this.epoch) return;
        for (const item of data.items) {
          const c = toBuilderCard(item);
          this.cards.set(c.cardId, c);
        }
      }
      this.emit();
    } catch (error) {
      reportError("hydrate deck cards", error);
      if (epoch === this.epoch) {
        this.message = "Some cards could not load. Retry loading before adding cards.";
        this.emit();
      }
    }
  }
  private async loadOptions(epoch: number) {
    try {
      const [facets, sets, series] = await Promise.all([
        api.getFacets(),
        api.getSets(),
        api.getSeries(),
      ]);
      if (epoch !== this.epoch) return;
      this.facets = facets;
      this.sets = sets;
      this.series = series;
      this.emit();
    } catch (error) {
      reportError("load filter options", error);
      if (epoch === this.epoch) {
        this.message = "Filter options could not load. Retry loading to reconnect.";
        this.emit();
      }
    }
  }
  async search() {
    clearTimeout(this.searchTimer);
    if (this.phase !== "ready") return;
    const epoch = this.epoch;
    const request = ++this.searchEpoch;
    this.busy = true;
    this.results = [];
    this.emit();
    const catalog = this.catalog();
    try {
      const data = await this.fetchPage(catalog, this.page, true);
      if (epoch !== this.epoch || request !== this.searchEpoch) return;
      this.results = data.items;
      this.total = data.total;
    } catch (error) {
      reportError("search cards", error);
      if (epoch === this.epoch && request === this.searchEpoch)
        this.message = "Card search failed. Try again.";
    }
    if (epoch === this.epoch && request === this.searchEpoch) {
      this.busy = false;
      this.emit();
      this.prefetch(catalog);
    }
  }
  private catalog(): Catalog {
    const query = filtersToCardsQuery(this.filters, formatById(this.format));
    return { query, size: this.size, key: JSON.stringify([query, this.size]) };
  }
  /** One request per page and query; `fresh` refetches a cached page. */
  private fetchPage(
    { query, size, key }: Catalog,
    page: number,
    fresh = false,
  ): Promise<CatalogPage> {
    if (key !== this.pageKey) {
      this.pageKey = key;
      this.pages.clear();
      this.pageRequests.clear();
    }
    const cached = this.pages.get(page);
    if (cached && !fresh) return Promise.resolve(cached);
    const pending = this.pageRequests.get(page);
    if (pending) return pending;
    const request = api
      .getCards({ ...query, page, pageSize: size })
      .then((data) => {
        const result = { items: data.items.map(toBuilderCard), total: data.total };
        if (key === this.pageKey) {
          for (const c of result.items) this.cards.set(c.cardId, c);
          this.pages.set(page, result);
          // Keep the pages nearest the visible one.
          while (this.pages.size > MAX_CACHED_PAGES) {
            const far = [...this.pages.keys()].reduce((a, b) =>
              Math.abs(a - this.page) >= Math.abs(b - this.page) ? a : b,
            );
            this.pages.delete(far);
          }
        }
        return result;
      })
      .finally(() => {
        if (this.pageRequests.get(page) === request) this.pageRequests.delete(page);
      });
    if (key === this.pageKey) this.pageRequests.set(page, request);
    return request;
  }
  /** Warm the neighbouring pages and queue their artwork behind this page's. */
  private prefetch(catalog: Catalog) {
    if (catalog.key !== this.pageKey) return;
    const epoch = this.epoch;
    const last = Math.max(1, Math.ceil(this.total / this.size));
    for (let d = 1; d <= PREFETCH_PAGES; d++)
      for (const page of [this.page + d, this.page - d]) {
        if (page < 1 || page > last || this.pages.has(page)) continue;
        this.fetchPage(catalog, page)
          .then(() => {
            if (epoch === this.epoch && catalog.key === this.pageKey) this.publishImages();
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
  async command(raw: string) {
    const fields = decodeFields(raw);
    if (!fields) return;
    const [action, a = "", b = ""] = fields;
    if (action === "open") {
      if (this.active && this.id === a && this.phase === "ready") return;
      this.active = true;
      this.id = a;
      this.leaving = false;
      this.page = 1;
      this.filters = { ...DEFAULT_FILTERS };
      await this.load();
      return;
    }
    if (action === "size") {
      this.size = Number(a) === 4 ? 4 : 8;
      this.page = 1;
      await this.search();
      return;
    }
    if (action === "leave") {
      if (this.dirty) {
        this.pendingExit = undefined;
        this.leaving = true;
        this.saver?.flush();
      } else this.exit();
      return;
    }
    if (action === "close") {
      this.importGeneration++;
      this.importing = false;
      this.saver?.flush();
      this.active = false;
      return;
    }
    if (this.phase !== "ready") {
      if (action === "retry") await this.load();
      return;
    }
    if (action === "preview-cards") {
      this.previewIds = a
        .split("\n")
        .filter((id) => this.entries.has(id))
        .slice(0, 6);
      this.nearbyPreviewIds = b
        .split("\n")
        .filter((id) => this.entries.has(id))
        .slice(0, 6 * 2 * PREFETCH_PAGES);
      this.emit();
      return;
    }
    if (action === "retry-save") {
      this.saver?.flush();
      return;
    }
    if (action === "retry") {
      await Promise.all([this.hydrate(this.epoch), this.search(), this.loadOptions(this.epoch)]);
      return;
    }
    if (action === "name") {
      this.name = a.slice(0, DECK_NAME_MAX);
      this.changed();
      return;
    }
    if (action === "format") {
      this.format = this.format === "standard" ? "expanded" : "standard";
      this.changed();
      this.page = 1;
      await this.search();
      return;
    }
    if (action === "add") {
      const c = this.cards.get(a);
      if ([...this.entries.keys()].some((id) => !this.cards.has(id))) {
        this.message = "Resolve unavailable deck cards before adding more.";
        this.emit();
        return;
      }
      if (
        c &&
        remainingAllowedFor(this.deck(), formatById(this.format))(c) > 0 &&
        (this.entries.has(a) || this.entries.size < MAX_DECK_CARD_ENTRIES)
      ) {
        this.entries.set(a, (this.entries.get(a) ?? 0) + 1);
        this.changed();
      } else {
        this.message = "This card has reached its copy limit.";
        this.emit();
      }
      return;
    }
    if (action === "discard" && !this.cards.has(a)) {
      this.entries.delete(a);
      this.changed();
      return;
    }
    if (action === "remove") {
      const n = this.entries.get(a) ?? 0;
      if (n <= 1) this.entries.delete(a);
      else this.entries.set(a, n - 1);
      this.changed();
      return;
    }
    if (action === "clear") {
      this.entries.clear();
      this.changed();
      return;
    }
    if (action === "cover") {
      this.cover = this.entries.has(a) ? a : null;
      this.changed();
      return;
    }
    if (action === "page") {
      this.page = Math.max(
        1,
        Math.min(Math.max(1, Math.ceil(this.total / this.size)), this.page + Number(a)),
      );
      // A prefetched page shows at once, with no loading state.
      const catalog = this.catalog();
      const cached = catalog.key === this.pageKey ? this.pages.get(this.page) : undefined;
      if (!cached || this.phase !== "ready") {
        await this.search();
        return;
      }
      clearTimeout(this.searchTimer);
      this.searchEpoch++;
      this.busy = false;
      this.results = cached.items;
      this.total = cached.total;
      this.emit();
      this.prefetch(catalog);
      return;
    }
    if (action === "sort") {
      const sorts: Filters["sort"][] = ["name", "hp-desc", "set"];
      this.filters = {
        ...this.filters,
        sort: sorts[(sorts.indexOf(this.filters.sort) + 1) % sorts.length] ?? "name",
      };
      this.page = 1;
      await this.search();
      return;
    }
    if (action === "options") {
      this.optionKey = a;
      this.optionQuery = "";
      this.optionPage = 1;
      this.emit();
      return;
    }
    if (action === "option-query") {
      this.optionQuery = a;
      this.optionPage = 1;
      this.emit();
      return;
    }
    if (action === "option-page") {
      this.optionPage += Number(a);
      this.emit();
      return;
    }
    if (action === "option-pick") {
      const option = this.options().find((o) => o.key === this.optionKey);
      if (!option?.values.includes(a)) return;
      const current = this.filters[this.optionKey as keyof Filters];
      const value = Array.isArray(current)
        ? a === ""
          ? []
          : current.includes(a as never)
            ? current.filter((v) => v !== a)
            : [...current, a]
        : typeof current === "boolean"
          ? a === "1"
          : a;
      this.filters = { ...this.filters, [this.optionKey]: value };
      if (this.optionKey === "supertype")
        this.filters = { ...this.filters, subtypes: [], suffixes: [] };
      this.page = 1;
      await this.search();
      return;
    }
    if (action === "reset") {
      this.filters = { ...DEFAULT_FILTERS };
      this.page = 1;
      await this.search();
      return;
    }
    if (action === "filter" || action === "cycle") {
      const option = this.options().find((o) => o.key === a);
      const value =
        action === "cycle" && option
          ? (option.values[
              (option.values.indexOf(this.value(a)) + Number(b || 1) + option.values.length) %
                option.values.length
            ] ?? "")
          : b;
      if (option || ["query", "text", "hpMin", "hpMax"].includes(a)) {
        const current = this.filters[a as keyof Filters];
        this.filters = {
          ...this.filters,
          [a]: Array.isArray(current)
            ? value
              ? [value]
              : []
            : typeof current === "boolean"
              ? value === "1"
              : value,
        };
        if (a === "supertype") this.filters = { ...this.filters, subtypes: [], suffixes: [] };
        this.page = 1;
        this.searchEpoch++;
        clearTimeout(this.searchTimer);
        if (action === "filter")
          this.searchTimer = setTimeout(() => void this.search(), SEARCH_DEBOUNCE_MS);
        else await this.search();
      }
      return;
    }
    if (action === "detail") {
      const epoch = this.epoch;
      this.selected = a;
      this.details = "Loading card details...";
      this.emit();
      try {
        const c = await api.getCard(a);
        if (epoch !== this.epoch || this.selected !== a) return;
        this.cards.set(c.id, toBuilderCard(c));
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
        if (epoch !== this.epoch || this.selected !== a) return;
        this.details = "Details could not load. Close and reopen to retry.";
      }
      this.emit();
      return;
    }
    if (action === "export") {
      const deck = this.deck();
      this.transfer = deck.length ? formatDecklist(deck) : "";
      const missing = [...this.entries.keys()].some((id) => !this.cards.has(id));
      this.message = missing ? "Unavailable cards cannot be exported. Resolve them first." : "";
      this.emit();
      return;
    }
    if (action === "cancel-import") {
      if (this.importing) {
        this.importGeneration++;
        this.importing = false;
        this.message = "Import cancelled. Deck unchanged.";
        this.emit();
      }
      return;
    }
    if (action === "import" && !this.importing) {
      const generation = ++this.importGeneration;
      const epoch = this.epoch;
      this.importing = true;
      this.message = "Resolving decklist...";
      this.emit();
      try {
        const result = await importDecklist(a);
        if (epoch !== this.epoch || generation !== this.importGeneration || !this.active) return;
        if (
          result.unmatched.length ||
          result.entries.length === 0 ||
          result.entries.length > MAX_DECK_CARD_ENTRIES
        ) {
          this.message = result.unmatched.length
            ? `Could not resolve: ${result.unmatched.map((x) => x.raw).join(", ")}. Deck unchanged.`
            : "No usable decklist, or too many entries. Deck unchanged.";
        } else {
          for (const e of result.entries) this.cards.set(e.card.cardId, e.card);
          this.entries = new Map(
            result.entries.map((e) => [e.card.cardId, Math.min(MAX_IMPORT_COPIES, e.quantity)]),
          );
          this.transfer = a;
          this.changed();
          this.message = "Deck imported.";
        }
      } catch (error) {
        reportError("import decklist", error);
        if (epoch !== this.epoch || generation !== this.importGeneration || !this.active) return;
        this.message = "Import failed. Your deck is unchanged. Try again.";
      }
      if (epoch === this.epoch) {
        this.importing = false;
        this.emit();
      }
      return;
    }
  }
}
