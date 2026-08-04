// The builder ↔ catalog boundary: adapts the api's canonical card shapes to
// the builder's BuilderCard view, translates the rail's Filters into the
// api's query vocabulary, and resolves decklist names against the live
// catalog. Everything vocabulary-shaped lives here so the rest of the
// builder keeps speaking its own dialect (accented "Pokémon", "Stage 1",
// "Pokémon Tool", …) unchanged.

import type { Card, CardBrief, CardCategory, CatalogFacets } from "@luminous/schema";
import { type CardsQuery, getCards } from "../../lib/api";
import {
  type BuilderCard,
  ENERGY_TYPES,
  type EnergyType,
  type Format,
  type Supertype,
} from "./cards";
import { type ImportResult, nameKey, parseDecklist, resolveDecklist } from "./decklistText";
import type { Filters } from "./poolFilter";

// Builder supertype ↔ api category: the same three values, but the builder
// uses the accented spelling the game prints and the DB stores ASCII.
const CATEGORY_BY_SUPERTYPE: Record<Supertype, CardCategory> = {
  Pokémon: "Pokemon",
  Trainer: "Trainer",
  Energy: "Energy",
};

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
        : card.energyType;
  if (raw === null) return "";
  return subtypeLabelOf(raw);
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

/** The card-kind chip labels offered for a supertype: the matching facet
    vocabulary, builder-labelled. No facets (still loading, or the fetch
    failed) means no chips — the rail hides an empty section.

    Every label here filters SERVER-side. It used to append the derived
    name-regex kinds (EX/Mega) for Pokémon; those moved to their own
    dimension, {@link suffixOptions}, when the server learned `?suffix=`
    (D198 — see the note in cards.ts for what they were costing). */
export function kindOptions(supertype: "all" | Supertype, facets: CatalogFacets | null): string[] {
  if (supertype === "Pokémon") return (facets?.stages ?? []).map(subtypeLabelOf);
  if (supertype === "Trainer") return (facets?.trainerTypes ?? []).map(subtypeLabelOf);
  if (supertype === "Energy") return (facets?.energyTypes ?? []).map(subtypeLabelOf);
  return [];
}

/** The rule-box chip labels offered for a supertype: the catalog's `suffixes`
    vocabulary VERBATIM (no renaming — "ex" and "VMAX" are printed exactly as
    stored, and the wire value must equal the chip for `?suffix=` to agree
    with the list it came from).

    EMPTY TODAY, and that is the design: `cards.suffix` is NULL on every
    production row until an ingest fills it, so /facets serves `suffixes: []`,
    this returns `[]`, and FilterRail renders no section. No chip means the
    filter cannot be reached from the UI, which is what makes shipping it
    against an unpopulated column safe rather than a trap.

    Offered only where a suffix can EXIST: the ingest writes the column from
    the tcgdex Pokémon payload alone and NULL for Trainer/Energy rows
    (apps/api/src/ingest/map.ts), so under those supertypes every value would
    match nothing — an empty grid with no explanation, the exact failure the
    derived "Mega" chip used to produce. Under "all" the chips are honest:
    they narrow to Pokémon, which is what the data says they mean. */
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

/** Translate the rail's Filters into a GET /cards query (page-less — the
    search hook adds pagination). EVERY dimension goes on the wire: `subtypes`
    (card kinds) map to the supertype's own subtype param (stage /
    trainerType / energyType, P2 task 9) and `suffixes` to `?suffix=` (D198).
    Nothing is left for the client to re-apply per page, so the grid and the
    reported total always answer the same query. */
export function filtersToCardsQuery(filters: Filters, format: Format): CardsQuery {
  const name = filters.query.trim();
  const text = filters.text.trim();
  const serverKinds =
    filters.subtypes.length > 0 ? filters.subtypes.map(wireSubtypeOf) : undefined;
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
    // can't survive a supertype switch (FilterRail.setSupertype clears it).
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

/** Resolve a decklist name against the catalog, in layers — each a server
    query, stopping at the first hit (first in collector order, mirroring the
    old "first pool card with that name" rule):
    1. `nameExact` on the normalized key (nameKey strips a leading "Basic "
       and collapses whitespace — the exporters' usual noise);
    2. `nameExact` on the raw name (trimmed, whitespace-collapsed) when that
       still differs from the key — a print STORED with the "Basic " prefix
       can't equal the stripped key (case alone never warrants this retry:
       nameExact ignores it either way);
    3. the old substring search, for stored names neither equality can reach
       (only nameKey-level normalization bridges e.g. a doubled space in the
       stored name).
    Every layer keeps only a normalized-key match, so a substring over-match
    can't smuggle in the wrong card. */
export async function findCardByName(name: string): Promise<BuilderCard | undefined> {
  const key = nameKey(name);
  if (key === "") return undefined;
  const raw = name.replace(/\s+/g, " ").trim();
  const queries: CardsQuery[] = [{ nameExact: key, pageSize: 100 }];
  if (raw.toLowerCase() !== key) queries.push({ nameExact: raw, pageSize: 100 });
  queries.push({ name: key, pageSize: 100 });
  for (const query of queries) {
    const { items } = await getCards(query);
    const exact = items.find((item) => nameKey(item.name) === key);
    if (exact !== undefined) return toBuilderCard(exact);
  }
  return undefined;
}

/** Parse + resolve a pasted decklist against the live catalog. Rejects on an
    api/network failure (the dialog reports it); mere unknown names come back
    as `unmatched`. */
export function importDecklist(text: string): Promise<ImportResult> {
  return resolveDecklist(parseDecklist(text), findCardByName);
}
