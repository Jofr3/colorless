// The builder ↔ catalog boundary: adapts the api's canonical card shapes to
// the builder's BuilderCard view, translates the rail's Filters into the
// api's query vocabulary, and resolves decklist names against the live
// catalog. Everything vocabulary-shaped lives here so the rest of the
// builder keeps speaking its own dialect (accented "Pokémon", "Stage 1",
// "Pokémon Tool", …) unchanged.

import { type Format, isBasicEnergy, isSpecialEnergy } from "@colorless/engine/rules";
import {
  type Card,
  type CardBrief,
  type CardCategory,
  type CardIndex,
  type CardIndexPayload,
  type CardIndexRow,
  type CardsQueryParams,
  type CatalogFacets,
  cardIndexBrief,
  cardIndexSteps,
  cardsQuerySchema,
  searchCardIndex,
} from "@colorless/schema";
import { getCardIndex, getCards, getFacets, getSeries, getSets } from "../lib/api";
import {
  type BuilderCard,
  CATEGORY_BY_SUPERTYPE,
  ENERGY_TYPES,
  type EnergyType,
  type Supertype,
} from "./cards";
import {
  type ImportResult,
  MAX_DECKLIST_LINES,
  nameKey,
  parseDecklist,
  resolveDecklist,
} from "./decklistText";
import type { Filters } from "./poolFilter";

const SUPERTYPE_BY_CATEGORY: Record<CardCategory, Supertype> = {
  Pokemon: "Pokémon",
  Trainer: "Trainer",
  Energy: "Energy",
};

// The catalog's subtype vocabulary (tcgdex: "Stage1", "Tool", "Normal"/
// "Special" energies) renamed to the labels the builder's predicates and
// kind filters key on (cards.ts). Values missing here pass through verbatim
// — a future printed subtype shows honestly instead of vanishing.
const SUBTYPE_LABELS: Record<string, string> = {
  Stage1: "Stage 1",
  Stage2: "Stage 2",
  Tool: "Pokémon Tool",
  Normal: "Basic Energy",
  Special: "Special Energy",
};

/** A wire subtype value as the builder shows it. */
function subtypeLabelOf(raw: string): string {
  return SUBTYPE_LABELS[raw] ?? raw;
}

// The inverse map, for the rail's kind chips travelling back to the wire
// (labels without a rename pass through verbatim, mirroring subtypeLabelOf).
const WIRE_SUBTYPE_BY_LABEL = new Map(
  Object.entries(SUBTYPE_LABELS).map(([wire, label]) => [label, wire]),
);

function wireSubtypeOf(label: string): string {
  return WIRE_SUBTYPE_BY_LABEL.get(label) ?? label;
}

function isEnergyType(value: string): value is EnergyType {
  return (ENERGY_TYPES as readonly string[]).includes(value);
}

/** The category-specific subtype column, renamed to builder vocabulary. */
function subtypeOf(card: CardBrief | Card): string {
  const raw =
    card.category === "Pokemon"
      ? card.stage
      : card.category === "Trainer"
        ? card.trainerType
        : energySubtypeOf(card);
  if (raw === null) return "";
  return subtypeLabelOf(raw);
}

/**
 * An Energy's subtype as the engine classifies it, not the raw tcgdex tag, which labels some
 * Special Energies "Normal". A full `Card` is classified from its rules text; a brief carries the
 * API's answer to the same test.
 */
function energySubtypeOf(card: CardBrief | Card): string | null {
  const face = {
    category: card.category,
    energyType: card.energyType,
    effect: "effect" in card ? card.effect : undefined,
  };
  if (isSpecialEnergy(face)) return "Special";
  return isBasicEnergy(face) ? "Normal" : card.energyType;
}

/** A catalog card (brief or full — both carry the fields this view needs) as
    the builder sees it. Off-category nulls become absent fields; unknown
    energy-type strings are dropped rather than invented (the palette and
    stats bar only know the canonical ten). */
export function toBuilderCard(card: CardBrief | Card): BuilderCard {
  const types = card.types?.filter(isEnergyType) ?? [];
  return {
    cardId: card.id,
    name: card.name,
    supertype: SUPERTYPE_BY_CATEGORY[card.category],
    subtype: subtypeOf(card),
    types: types.length > 0 ? types : undefined,
    hp: card.hp ?? undefined,
    regulationMark: card.regulationMark ?? undefined,
    rarity: card.rarity ?? undefined,
    number: card.localId,
    hasImage: card.image !== null,
    legal: card.legal,
  };
}

/**
 * The card-kind chip labels for a supertype, from the matching facet vocabulary. With no facets
 * (still loading or failed) there are no chips. Every label filters server-side.
 */
export function kindOptions(supertype: "all" | Supertype, facets: CatalogFacets | null): string[] {
  if (supertype === "Pokémon") return (facets?.stages ?? []).map(subtypeLabelOf);
  if (supertype === "Trainer") return (facets?.trainerTypes ?? []).map(subtypeLabelOf);
  if (supertype === "Energy") return (facets?.energyTypes ?? []).map(subtypeLabelOf);
  return [];
}

/**
 * The rule-box chip labels for a supertype: the catalog's `suffixes` vocabulary verbatim, because
 * the wire value must equal the chip for `?suffix=` to match.
 */
export function suffixOptions(
  supertype: "all" | Supertype,
  facets: CatalogFacets | null,
): string[] {
  if (supertype !== "all" && supertype !== "Pokémon") return [];
  return facets?.suffixes ?? [];
}

/** A rail HP bound as a wire param: "" (unset), non-numeric or negative
    input maps to "no bound" rather than a query the server would 400. */
function hpBound(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Translate the rail's Filters into a page-less GET /cards query. Every dimension goes on the wire,
 * so the grid and the reported total always answer the same query.
 */
export function filtersToCardsQuery(filters: Filters, format: Format): CardsQueryParams {
  const name = filters.query.trim();
  const text = filters.text.trim();
  const serverKinds = filters.subtypes.length > 0 ? filters.subtypes.map(wireSubtypeOf) : undefined;
  return {
    name: name === "" ? undefined : name,
    category: filters.supertype === "all" ? undefined : CATEGORY_BY_SUPERTYPE[filters.supertype],
    type: filters.types.length > 0 ? [...filters.types] : undefined,
    rarity: filters.rarities.length > 0 ? [...filters.rarities] : undefined,
    // Kinds are only offered once a supertype is chosen, so the selection
    // belongs to exactly that supertype's subtype dimension.
    stage: filters.supertype === "Pokémon" ? serverKinds : undefined,
    trainerType: filters.supertype === "Trainer" ? serverKinds : undefined,
    energyType: filters.supertype === "Energy" ? serverKinds : undefined,
    // Rule box is its own dimension (ANDs with the kind chips), and the rail
    // only offers it where a suffix can exist — so an unsendable selection
    // can't survive a supertype switch (the builder clears it with the kinds).
    suffix: filters.suffixes.length > 0 ? [...filters.suffixes] : undefined,
    set: filters.setId === "" ? undefined : filters.setId,
    serie: filters.serieId === "" ? undefined : filters.serieId,
    illustrator: filters.illustrator === "" ? undefined : filters.illustrator,
    text: text === "" ? undefined : text,
    regulationMark: filters.regulationMark === "" ? undefined : filters.regulationMark,
    hpMin: hpBound(filters.hpMin),
    hpMax: hpBound(filters.hpMax),
    // `legalOnly` maps to the ACTIVE format's legality flag — the same
    // `card.legal` key validateDeck reads (cards.ts legalFlag), so the grid's
    // "legal only" and the panel's verdict can't disagree. A format without a
    // flag (none modelled today) sends no legality filter.
    legal: filters.legalOnly ? format.legalFlag : undefined,
    sort: filters.sort,
  };
}

// ---- The card index: every card, searched in the browser -------------------------------------
// GET /cards/index loads once and is searched here, so the builder's name and rules-text searches
// and the decklist import's name lookups cost the API no D1 reads (security audit CA1). Searching
// applies GET /cards' own semantics (@colorless/schema `searchCardIndex`, held to the API's
// answers by apps/api/src/catalog/cardIndex.d1.test.ts).

/** How long a loaded index is reused before it is fetched again. An ingest changes it; while the
    API's copy is unchanged the browser's HTTP cache answers the refetch. */
const INDEX_REUSE_MS = 60 * 60 * 1000;

/** The prepared index, with each row's BuilderCard made the first time a search returns it. */
export interface LoadedCardIndex {
  index: CardIndex;
  cards: Map<CardIndexRow, BuilderCard>;
  /** Rows by card id, built on the first `indexedCard` lookup. */
  byId?: Map<string, CardIndexRow>;
}

let loadedIndex: { at: number; index: Promise<LoadedCardIndex> } | undefined;
/** The last index that finished loading, for lookups that must not wait or fetch. */
let settledIndex: LoadedCardIndex | undefined;

/** How long preparing the index holds the main thread before it gives the thread back. */
const PREPARE_SLICE_MS = 8;

/** Gives the thread back for a moment: scheduler.yield where the browser has it, else a timer. */
function yieldThread(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === "function") return scheduler.yield();
  return new Promise((done) => setTimeout(done, 0));
}

/** The payload prepared for search (prepareCardIndex) in slices of about `sliceMs`, giving the
    thread back between sets, so a frame never waits on the whole index. */
export async function prepareInSlices(
  payload: CardIndexPayload,
  sliceMs = PREPARE_SLICE_MS,
): Promise<CardIndex> {
  const steps = cardIndexSteps(payload);
  let sliceStart = performance.now();
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    if (performance.now() - sliceStart >= sliceMs) {
      await yieldThread();
      sliceStart = performance.now();
    }
  }
}

/** The card index, fetched on first use and shared by every caller. A failed load is forgotten,
    so the next call retries. `sliceMs` is prepareInSlices'. */
export function loadCardIndex(
  now = Date.now(),
  sliceMs = PREPARE_SLICE_MS,
): Promise<LoadedCardIndex> {
  if (loadedIndex === undefined || now - loadedIndex.at > INDEX_REUSE_MS) {
    const index = getCardIndex().then(async (payload) => {
      const loaded = {
        index: await prepareInSlices(payload, sliceMs),
        cards: new Map<CardIndexRow, BuilderCard>(),
      };
      settledIndex = loaded;
      return loaded;
    });
    const entry = { at: now, index };
    loadedIndex = entry;
    index.catch(() => {
      if (loadedIndex === entry) loadedIndex = undefined;
    });
  }
  return loadedIndex.index;
}

/** Drop the loaded index, so the next search fetches it again. */
export function forgetCardIndex(): void {
  loadedIndex = undefined;
  settledIndex = undefined;
}

// ---- Filter options: facets, sets and series, shared like the index ----------------------------

type Memo<T> = { at: number; value: Promise<T> };
const optionMemos: { clear(): void }[] = [];

/** `load`, made once and shared by every caller for INDEX_REUSE_MS, like loadCardIndex. A failed
    load is forgotten, so the next call retries. */
function memoised<T>(load: () => Promise<T>): (now?: number) => Promise<T> {
  let memo: Memo<T> | undefined;
  optionMemos.push({
    clear: () => {
      memo = undefined;
    },
  });
  return (now = Date.now()) => {
    if (memo === undefined || now - memo.at > INDEX_REUSE_MS) {
      const entry = { at: now, value: load() };
      memo = entry;
      entry.value.catch(() => {
        if (memo === entry) memo = undefined;
      });
    }
    return memo.value;
  };
}

/** The catalog's filter vocabularies (GET /facets). */
export const loadFacets = memoised(getFacets);
/** Every set (GET /sets): the builder's Set filter and the decklist import's set codes. */
export const loadSets = memoised(() => getSets());
/** Every series (GET /series). */
export const loadSeries = memoised(getSeries);

/** Drop the loaded filter options, so the next call fetches them again. */
export function forgetCatalogOptions(): void {
  for (const memo of optionMemos) memo.clear();
}

function rowCard(loaded: LoadedCardIndex, row: CardIndexRow): BuilderCard {
  let card = loaded.cards.get(row);
  if (card === undefined) {
    card = toBuilderCard(cardIndexBrief(row));
    loaded.cards.set(row, card);
  }
  return card;
}

/** `id`'s card from an index that has already loaded; undefined when none has or it lacks the id.
    Never starts a load. */
export function indexedCard(id: string): BuilderCard | undefined {
  const loaded = settledIndex;
  if (loaded === undefined) return undefined;
  loaded.byId ??= new Map(loaded.index.cards.map(({ row }) => [row[0], row]));
  const row = loaded.byId.get(id);
  return row === undefined ? undefined : rowCard(loaded, row);
}

/** Every card GET /cards would answer `query` with, in its order; paging params are ignored. A
    query the API would refuse throws, as its request would have failed. */
export function searchCards(loaded: LoadedCardIndex, query: CardsQueryParams): BuilderCard[] {
  return searchCardIndex(loaded.index, cardsQuerySchema.parse(query)).map((row) =>
    rowCard(loaded, row),
  );
}

/** A catalog search for the decklist import: the loaded index, or GET /cards. */
type CardSearch = (query: CardsQueryParams) => Promise<BuilderCard[]>;

/** One GET /cards page of 100. */
const apiSearch: CardSearch = async (query) =>
  (await getCards({ ...query, pageSize: 100 })).items.map(toBuilderCard);

/**
 * Resolve a decklist name against the catalog by exact name: the normalized key, its "Basic …"
 * Energy form and the raw spelling, unioned. On the API each is one indexed lookup.
 */
export async function findCardsByName(
  name: string,
  search: CardSearch = apiSearch,
): Promise<BuilderCard[]> {
  const key = nameKey(name);
  if (key === "") return [];
  const raw = name.replace(/\s+/g, " ").trim();
  // The exact layers are UNIONED: a name's prints can be stored under forms
  // that share one key — the energy-only sets print "Fire Energy", the sv
  // full-art energies "Basic Fire Energy" — and the import wants them all.
  const terms = [key];
  if (key.endsWith(" energy")) terms.push(`basic ${key}`);
  if (!terms.includes(raw.toLowerCase())) terms.push(raw);
  const found = new Map<string, BuilderCard>();
  for (const term of terms) {
    for (const card of await search({ nameExact: term })) {
      if (nameKey(card.name) === key) found.set(card.cardId, card);
    }
  }
  return [...found.values()];
}

/**
 * The last resort for a decklist name: a substring search kept to cards whose normalized key is
 * the name's, for a stored spelling only the key bridges (stray outer whitespace, a "Basic "
 * prefix outside Energy). Nothing in today's catalog needs it. On the API it scans the table, so
 * the import runs it only after every exact lookup missed, and `total: 0` spares the count
 * statement, which would scan it again for a total the import never reads.
 */
export async function findCardsBySubstring(
  name: string,
  search: CardSearch = async (query) =>
    (await getCards({ ...query, pageSize: 100, total: 0 })).items.map(toBuilderCard),
): Promise<BuilderCard[]> {
  const key = nameKey(name);
  if (key === "") return [];
  return (await search({ name: key })).filter((card) => nameKey(card.name) === key);
}

/** Decklist set code → set id, from the sets the builder loaded (GET /sets): the official
    abbreviation ("PRE") and the upper-cased id our own export writes ("SV08.5"). */
async function setIdsByCode(): Promise<(code: string) => string | undefined> {
  const byCode = new Map<string, string>();
  for (const set of await loadSets()) {
    if (set.abbreviation) byCode.set(set.abbreviation.toUpperCase(), set.id);
    byCode.set(set.id.toUpperCase(), set.id);
  }
  return (code) => byCode.get(code.toUpperCase());
}

/** Parse + resolve a pasted decklist against the catalog: the card index when it loads, else one
    API lookup per name. Rejects on an api/network failure (the dialog reports it); mere unknown
    names come back as `unmatched`. A list of more than MAX_DECKLIST_LINES card lines is refused
    before any lookup. */
export async function importDecklist(text: string): Promise<ImportResult> {
  const lines = parseDecklist(text);
  if (lines.length > MAX_DECKLIST_LINES) return { entries: [], unmatched: [], tooManyLines: true };
  // The set map loads alongside the name lookups and is only awaited for a
  // line that names a set among reprints; its failure still rejects there.
  const codes = setIdsByCode();
  codes.catch(() => {});
  const search = await loadCardIndex().then(
    (loaded): CardSearch =>
      async (query) =>
        searchCards(loaded, query),
    () => undefined,
  );
  return resolveDecklist(lines, (name) => findCardsByName(name, search), {
    setIdForCode: async (code) => (await codes)(code),
    findLoosely: (name) => findCardsBySubstring(name, search),
  });
}
