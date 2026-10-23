// Card model + metadata for the deck builder. The card *data* comes from the
// live catalog api (fetched by src/lua/builder.ts, adapted in catalog.ts); this
// module holds the types, the format definitions, and small pure helpers
// shared across the builder. Kept side-effect-free so the pure logic
// (deckMath, decklistText) and their tests can import it freely.

import { BASIC_ENERGY_TYPES, type BasicEnergyType } from "@colorless/schema";

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

// NOTE (P2 task 10): the printed-subtype and rarity vocabularies used to be
// hardcoded tuples here (POKEMON_STAGES, TRAINER_SUBTYPES, RARITIES, …). They
// now come from the live catalog — GET /facets, loaded by the builder — so a
// card's `subtype` and `rarity` stay plain strings and the rail's chips
// reflect what is actually ingested.

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

/** The most copies of any one ACE SPEC card — and of all ACE SPECs combined —
    a deck may hold. */
export const ACE_SPEC_LIMIT = 1;

/** True for an ACE SPEC card. A deck may contain only one ACE SPEC in total
    (across every name), enforced in {@link validateDeck}. Identified by rarity,
    which is how the printed cards mark themselves — the catalog's exact string
    is "ACE SPEC Rare" (verified against the live facets vocabulary); the
    substring match keeps older fixture spellings working too. */
export function isAceSpec(card: BuilderCard): boolean {
  return (card.rarity ?? "").includes("ACE SPEC");
}

// Radiant and Prism Star are NAME-defined card classes — the game names every
// member "Radiant X" / "X ◇" and hangs the deck rule off that name — so a name
// check IS the structured detection, not a stand-in for missing data.

/** The most Radiant Pokémon — across every name — a deck may hold. */
export const RADIANT_LIMIT = 1;

/** True for a Radiant Pokémon ("Radiant Greninja", …) — like ACE SPEC, a deck
    may contain only one Radiant Pokémon in total, across every name
    ({@link validateDeck}). */
export function isRadiantPokemon(card: BuilderCard): boolean {
  return card.supertype === "Pokémon" && card.name.startsWith("Radiant ");
}

/** True for a Prism Star card — tcgdex prints the "◇" suffix in the name
    ("Diancie ◇"); the spelled-out form covers other decklist sources. Limited
    to one copy of a given name per deck ({@link validateDeck}). */
export function isPrismStar(card: BuilderCard): boolean {
  return card.name.includes("◇") || card.name.endsWith(" Prism Star");
}

/**
 * Whether a card is legal in a format: the catalog's verdict keyed by `Format.legalFlag`. There is
 * no printed-mark fallback, so this validator and the rail's server-side legal filter read the same
 * bit.
 */
export function isLegalInFormat(card: BuilderCard, format: Format): boolean {
  if (format.legalFlag === undefined) return true;
  return card.legal[format.legalFlag];
}

// Card kinds (stages, trainer subtypes, energy subtypes) come from the catalog's facets and are
// filtered server-side. Rule-box markers (ex, V, VMAX, …) are a separate dimension.

// --- Formats ---------------------------------------------------------------

export interface Format {
  id: string;
  name: string;
  /** Required deck size (constructed Pokémon TCG is 60). */
  deckSize: number;
  /** Max copies of any one card by name (basic Energy is always exempt). */
  maxCopiesByName: number;
  /** Minimum Basic Pokémon a legal deck must contain. */
  minBasicPokemon: number;
  /** The card-legality flag this format reads — the key into the catalog's
      structured `card.legal` verdict, and the value of GET /cards' `legal`
      param. Undefined = an unrestricted format (none modelled today). One
      field feeds both the validator and the rail's legal-only filter, so the
      two can't disagree (the P2 task 13 unification). */
  legalFlag?: "standard" | "expanded";
  description: string;
}

const STANDARD_FORMAT: Format = {
  id: "standard",
  name: "Standard",
  deckSize: 60,
  maxCopiesByName: 4,
  minBasicPokemon: 1,
  legalFlag: "standard",
  description: "Most recent sets — the default tournament format.",
};

export const FORMATS: Format[] = [
  STANDARD_FORMAT,
  {
    id: "expanded",
    name: "Expanded",
    deckSize: 60,
    maxCopiesByName: 4,
    minBasicPokemon: 1,
    legalFlag: "expanded",
    description: "Black & White onward — a far wider card pool.",
  },
];

export const DEFAULT_FORMAT = STANDARD_FORMAT;

export function formatById(id: string): Format {
  return FORMATS.find((f) => f.id === id) ?? DEFAULT_FORMAT;
}
