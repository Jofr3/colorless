// Card model + metadata for the deck builder. The card *data* comes from the
// live catalog api (fetched by src/lua/builder.ts, adapted in catalog.ts); this
// module holds the types and small pure helpers shared across the builder; the
// formats and construction rules are the engine's (deckRules.ts). Kept
// side-effect-free so the pure logic (deckMath, decklistText) and their tests
// can import it freely.

import type { DeckRuleCard } from "@colorless/engine";
import { BASIC_ENERGY_TYPES, type BasicEnergyType, type CardCategory } from "@colorless/schema";

/** The energy types the builder filters and paints, in the canonical wheel
    order. Derived from the shared basic-energy vocabulary (@colorless/schema)
    minus the retired Fairy — old Fairy prints keep adapting to typeless
    tiles rather than growing a palette entry — plus Dragon (a Pokémon type
    with no Basic Energy) and Colorless (a cost symbol), which exist only in
    this UI palette. */
export type EnergyType = Exclude<BasicEnergyType, "Fairy"> | "Dragon" | "Colorless";

export const ENERGY_TYPES: readonly EnergyType[] = [
  ...BASIC_ENERGY_TYPES.filter(
    (type): type is Exclude<BasicEnergyType, "Fairy"> => type !== "Fairy",
  ),
  "Dragon",
  "Colorless",
];

/** Top-level card category — drives the deck-list grouping (Pokémon / Trainer /
    Energy) and the right-panel split. Uses the accented "Pokémon" spelling the
    game itself uses. */
export type Supertype = "Pokémon" | "Trainer" | "Energy";

export const SUPERTYPES: Supertype[] = ["Pokémon", "Trainer", "Energy"];

/** The catalog's category for each supertype: the same three values, unaccented. */
export const CATEGORY_BY_SUPERTYPE: Record<Supertype, CardCategory> = {
  Pokémon: "Pokemon",
  Trainer: "Trainer",
  Energy: "Energy",
};

// The printed-subtype and rarity vocabularies come from the live catalog
// (GET /facets, loaded by the builder), not hardcoded tuples, so a card's
// `subtype` and `rarity` stay plain strings and the builder's filters reflect
// what is actually ingested.

/**
 * A single browsable card, the builder's view of a catalog card. `cardId` is the tcgdex id
 * ("sv06.5-001") and the key of the api's art mirror. Optional fields are absent for categories
 * they don't apply to.
 */
export interface BuilderCard {
  cardId: string;
  name: string;
  supertype: Supertype;
  /** Basic | Stage 1 | Stage 2 | Item | Supporter | Stadium | Pokémon Tool |
      Basic Energy | Special Energy — or a newer printed subtype the catalog
      knows and this build's tuples don't. */
  subtype: string;
  /** Energy type(s) — Pokémon (its type) and most Energy cards. */
  types?: EnergyType[];
  hp?: number;
  /** Regulation mark (e.g. "H", "I"), the basis of Standard-format legality. */
  regulationMark?: string;
  /** Exact catalog rarity string, e.g. "Double rare". */
  rarity?: string;
  /** Collector number within its set (the catalog's localId, e.g. "081"). */
  number?: string;
  /** Whether the catalog has a scan for this card — when false, tiles render
      the neutral fallback instead of requesting art that would 404. */
  hasImage?: boolean;
  /**
   * The catalog's structured format-legality verdict, the app's only legality mechanism. Required:
   * the wire schema always sends it, and hand-built fixtures derive it from the printed mark in
   * `builderCard`.
   */
  legal: { standard: boolean; expanded: boolean };
}

/** True for a Basic Pokémon — the card a legal deck must contain at least one
    of, and the only Pokémon that can start play. */
export function isBasicPokemon(card: BuilderCard): boolean {
  return card.supertype === "Pokémon" && card.subtype === "Basic";
}

/**
 * True for a basic Energy, the one exception to the 4-copies-per-name rule. The subtype is the
 * engine's Basic/Special classification, not the raw tcgdex tag, so Special Energies tagged
 * "Normal" still count toward the limit.
 */
export function isBasicEnergy(card: BuilderCard): boolean {
  return card.supertype === "Energy" && card.subtype === "Basic Energy";
}

/**
 * The fields the engine's deck rules read, from the builder's view. The rules single out only Basic
 * Pokémon and Basic Energy, so those are the stage and energy subtype carried across.
 */
export function deckRuleCardOf(card: BuilderCard): DeckRuleCard {
  return {
    name: card.name,
    category: CATEGORY_BY_SUPERTYPE[card.supertype],
    stage: isBasicPokemon(card) ? "Basic" : null,
    energyType: card.supertype !== "Energy" ? null : isBasicEnergy(card) ? "Normal" : "Special",
    rarity: card.rarity ?? null,
    legal: card.legal,
  };
}

// Card kinds (stages, trainer subtypes, energy subtypes) come from the catalog's facets and are
// filtered server-side. Rule-box markers (ex, V, VMAX, …) are a separate dimension.
