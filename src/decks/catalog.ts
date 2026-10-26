// The builder ↔ catalog boundary: adapts the api's canonical card shapes to
// the builder's BuilderCard view, translates the rail's Filters into the
// api's query vocabulary, and resolves decklist names against the live
// catalog. Everything vocabulary-shaped lives here so the rest of the
// builder keeps speaking its own dialect (accented "Pokémon", "Stage 1",
// "Pokémon Tool", …) unchanged.

import { type Format, isBasicEnergy, isSpecialEnergy } from "@colorless/engine";
import type { Card, CardBrief, CardCategory, CatalogFacets } from "@colorless/schema";
import { type CardsQuery, getCards, getSets } from "../lib/api";
import {
  type BuilderCard,
  CATEGORY_BY_SUPERTYPE,
  ENERGY_TYPES,
  type EnergyType,
  type Supertype,
} from "./cards";
import { type ImportResult, nameKey, parseDecklist, resolveDecklist } from "./decklistText";
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
export function filtersToCardsQuery(filters: Filters, format: Format): CardsQuery {
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

/**
 * Resolve a decklist name against the catalog in layers, each a server query, stopping at the first
 * hit (first in collector order).
 */
export async function findCardsByName(name: string): Promise<BuilderCard[]> {
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
    const { items } = await getCards({ nameExact: term, pageSize: 100 });
    for (const item of items) {
      if (nameKey(item.name) === key) found.set(item.id, toBuilderCard(item));
    }
  }
  if (found.size > 0) return [...found.values()];
  const { items } = await getCards({ name: key, pageSize: 100 });
  return items.filter((item) => nameKey(item.name) === key).map(toBuilderCard);
}

/** Decklist set code → set id, from GET /sets: the official abbreviation
    ("PRE") and the upper-cased id our own export writes ("SV08.5"). */
async function setIdsByCode(): Promise<(code: string) => string | undefined> {
  const byCode = new Map<string, string>();
  for (const set of await getSets()) {
    if (set.abbreviation) byCode.set(set.abbreviation.toUpperCase(), set.id);
    byCode.set(set.id.toUpperCase(), set.id);
  }
  return (code) => byCode.get(code.toUpperCase());
}

/** Parse + resolve a pasted decklist against the live catalog. Rejects on an
    api/network failure (the dialog reports it); mere unknown names come back
    as `unmatched`. */
export function importDecklist(text: string): Promise<ImportResult> {
  // The set map loads alongside the name lookups and is only awaited for a
  // line that names a set among reprints; its failure still rejects there.
  const codes = setIdsByCode();
  codes.catch(() => {});
  return resolveDecklist(parseDecklist(text), findCardsByName, {
    setIdForCode: async (code) => (await codes)(code),
  });
}
