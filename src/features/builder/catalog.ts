// The builder ↔ catalog boundary: adapts the api's canonical card shapes to
// the builder's BuilderCard view, translates the rail's Filters into the
// api's query vocabulary, and resolves decklist names against the live
// catalog. Everything vocabulary-shaped lives here so the rest of the
// builder keeps speaking its own dialect (accented "Pokémon", "Stage 1",
// "Pokémon Tool", …) unchanged.

import type { Card, CardBrief, CardCategory } from "@luminous/schema";
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
  return SUBTYPE_LABELS[raw] ?? raw;
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
  };
}

/** Translate the rail's Filters into a GET /cards query (page-less — the
    search hook adds pagination). `subtypes` (card kinds) are deliberately
    absent: kinds mix printed subtypes with derived labels (Evolution, EX/Mega
    read off the name), which the server can't express as one OR — they stay
    a client-side per-page filter (poolFilter.filterVisibleCards). */
export function filtersToCardsQuery(filters: Filters, format: Format): CardsQuery {
  const name = filters.query.trim();
  return {
    name: name === "" ? undefined : name,
    category: filters.supertype === "all" ? undefined : CATEGORY_BY_SUPERTYPE[filters.supertype],
    type: filters.types.length > 0 ? [...filters.types] : undefined,
    rarity: filters.rarities.length > 0 ? [...filters.rarities] : undefined,
    // `legalOnly` maps to the server's own Standard-legality flag — Standard
    // is the only format whose toggle the rail shows (it alone restricts
    // regulation marks). Any other format sends no legality filter.
    legal: filters.legalOnly && format.id === "standard" ? "standard" : undefined,
    sort: filters.sort,
  };
}

/** Resolve a decklist name against the catalog: substring-search the
    normalized name, then keep only an exact (normalized) match — the first
    hit in collector order wins, mirroring the old "first pool card with that
    name" rule. */
export async function findCardByName(name: string): Promise<BuilderCard | undefined> {
  const key = nameKey(name);
  if (key === "") return undefined;
  const { items } = await getCards({ name: key, pageSize: 100 });
  const exact = items.find((item) => nameKey(item.name) === key);
  return exact === undefined ? undefined : toBuilderCard(exact);
}

/** Parse + resolve a pasted decklist against the live catalog. Rejects on an
    api/network failure (the dialog reports it); mere unknown names come back
    as `unmatched`. */
export function importDecklist(text: string): Promise<ImportResult> {
  return resolveDecklist(parseDecklist(text), findCardByName);
}
