// Card model + metadata for the deck builder. The card *data* comes from the
// live catalog api (fetched by useCardSearch, adapted in catalog.ts); this
// module holds the types, the energy-type palette, the format definitions,
// and small pure helpers shared across the builder. Kept pixi-free and
// side-effect-free so the pure logic (deckMath, decklistText) and their
// tests can import it freely.

import { BASIC_ENERGY_TYPES, type BasicEnergyType } from "@luminous/schema";

/** The energy types the builder filters and paints, in the canonical wheel
    order. Derived from the shared basic-energy vocabulary (@luminous/schema)
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
// now come from the live catalog — GET /facets via useCatalogOptions — so a
// card's `subtype` and `rarity` stay plain strings and the rail's chips
// reflect what is actually ingested.

/** A single browsable card — the builder's view of a catalog card (adapted
    from the api shapes in catalog.ts). `cardId` is the tcgdex id ("sv06.5-001"),
    also the key of the api's art mirror. Optional fields are absent for
    categories they don't apply to (a Trainer has no `types`/`hp`, an Energy
    no `hp`, etc.). */
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
  /** The catalog's structured format-legality verdict (P2) — present on every
      api-adapted card; optional only for hand-built fixtures. Groundwork for
      validateDeck to stop inferring legality from regulation marks. */
  legal?: { standard: boolean; expanded: boolean };
}

/** True for a Basic Pokémon — the card a legal deck must contain at least one
    of, and the only Pokémon that can start play. */
export function isBasicPokemon(card: BuilderCard): boolean {
  return card.supertype === "Pokémon" && card.subtype === "Basic";
}

/** True for a basic Energy — the lone exception to the 4-copies-per-name rule. */
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

/** Whether a card is legal in a format. The catalog's structured verdict
    (`card.legal`, keyed by the format's {@link Format.legalFlag}) is the
    source of truth — every api-sourced card carries it. Cards without it
    (hand-built fixtures, pre-P2 data) degrade to the printed regulation-mark
    check: formats with no `legalRegulationMarks` impose no mark cutoff, and
    an unmarked card (basic Energy) is always legal. */
export function isLegalInFormat(card: BuilderCard, format: Format): boolean {
  if (format.legalFlag === undefined) return true;
  if (card.legal) return card.legal[format.legalFlag];
  if (!format.legalRegulationMarks) return true;
  if (!card.regulationMark) return true;
  return format.legalRegulationMarks.includes(card.regulationMark);
}

// --- Card kinds --------------------------------------------------------------
// The rail's contextual filter offers card "kinds" once a supertype is chosen.
// Printed kinds (stages / trainer subtypes / energy subtypes) come from the
// catalog's facets and filter SERVER-side (catalog.filtersToCardsQuery maps
// them to the stage/trainerType/energyType params). Only the DERIVED kinds
// below stay client-side: they're read off the card NAME because tcgdex's
// `suffix` field isn't persisted — there is no structured column to query.

export interface DerivedKind {
  label: string;
  match: (card: BuilderCard) => boolean;
}

export const DERIVED_KINDS: DerivedKind[] = [
  { label: "EX", match: (c) => /\bex\b/i.test(c.name) },
  { label: "Mega", match: (c) => /\bmega\b/i.test(c.name) },
];

/** True for a kind label the server can't express (name-regex kinds). */
export function isDerivedKind(label: string): boolean {
  return DERIVED_KINDS.some((kind) => kind.label === label);
}

/** OR within the card-kind dimension: derived kinds match by name regex,
    printed kinds by subtype equality (builder labels — "Stage 1", "Pokémon
    Tool", …). Only consulted when a derived kind is selected; otherwise the
    whole dimension filtered server-side (poolFilter.filterVisibleCards). */
export function cardMatchesKinds(card: BuilderCard, labels: string[]): boolean {
  return labels.some((label) => {
    const derived = DERIVED_KINDS.find((kind) => kind.label === label);
    return derived ? derived.match(card) : card.subtype === label;
  });
}

// --- Energy-type palette ---------------------------------------------------
// One accent per type for the pips on Pokémon tiles and the type-distribution
// bar in the deck stats. Tuned to read on the app's dark glass while staying
// recognisably "Fire = red, Water = blue, …"; the one-letter `code` is the
// game's own energy abbreviation (Grass G, Fire R, Water W, …).

export interface EnergyTypeMeta {
  type: EnergyType;
  /** Single-letter energy abbreviation used on compact chips. */
  code: string;
  /** Accent colour (hex) for pips and the distribution bar. */
  color: string;
}

export const ENERGY_TYPE_META: Record<EnergyType, EnergyTypeMeta> = {
  Grass: { type: "Grass", code: "G", color: "#5bbd6b" },
  Fire: { type: "Fire", code: "R", color: "#ef5a3c" },
  Water: { type: "Water", code: "W", color: "#3ba3e6" },
  Lightning: { type: "Lightning", code: "L", color: "#f1c640" },
  Psychic: { type: "Psychic", code: "P", color: "#b964cc" },
  Fighting: { type: "Fighting", code: "F", color: "#d07a3a" },
  Darkness: { type: "Darkness", code: "D", color: "#5a6072" },
  Metal: { type: "Metal", code: "M", color: "#9aa3b2" },
  Dragon: { type: "Dragon", code: "N", color: "#caa12c" },
  Colorless: { type: "Colorless", code: "C", color: "#cfcfda" },
};

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
  /** Regulation marks legal in this format; undefined = no mark restriction.
      FALLBACK ONLY — consulted for cards without the structured `legal` block
      (hand-built fixtures); api-sourced cards always carry the verdict. */
  legalRegulationMarks?: string[];
  description: string;
}

// Standard's legal regulation marks rotate each year; the set here is filled
// from the rules research and is easy to bump when the next rotation lands.
// Named (not FORMATS[0]) so DEFAULT_FORMAT is statically known to exist — under
// noUncheckedIndexedAccess an index access would widen to `Format | undefined`
// and ripple through everything that reads the default.
const STANDARD_FORMAT: Format = {
  id: "standard",
  name: "Standard",
  deckSize: 60,
  maxCopiesByName: 4,
  minBasicPokemon: 1,
  legalFlag: "standard",
  // Mark-check fallback for cards without `legal`: the marks after the April
  // 2026 rotation (G rotated out); bump this list when the next rotation lands.
  legalRegulationMarks: ["H", "I", "J"],
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
    // Structured legality only — no mark fallback (Expanded spans far more
    // sets than the mark system covers), so a card without `legal` passes.
    legalFlag: "expanded",
    description: "Black & White onward — a far wider card pool.",
  },
];

export const DEFAULT_FORMAT = STANDARD_FORMAT;

export function formatById(id: string): Format {
  return FORMATS.find((f) => f.id === id) ?? DEFAULT_FORMAT;
}
