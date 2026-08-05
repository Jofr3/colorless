// Card model + metadata for the deck builder. The card *data* comes from the
// live catalog api (fetched by useCardSearch, adapted in catalog.ts); this
// module holds the types, the energy-type palette, the format definitions,
// and small pure helpers shared across the builder. Kept pixi-free and
// side-effect-free so the pure logic (deckMath, decklistText) and their
// tests can import it freely.

import { BASIC_ENERGY_TYPES, type BasicEnergyType } from "@luminous/schema";
import { ENERGY_COLORS } from "../../lib/energyPalette";

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
  /** The catalog's structured format-legality verdict — the app's ONE legality
      mechanism (D191). REQUIRED, and that is the point: the wire schema's
      `legal` is non-optional and `toBuilderCard` passes it straight through, so
      no api-sourced card can lack it, and hand-built fixtures now derive theirs
      from the printed mark in one place (`builderCard`, src/test/fixtures.ts).
      While this was optional a second, independently-maintained regulation-mark
      allow-list lived inside {@link isLegalInFormat} to cover the gap — two
      mechanisms a rotation had to be applied to twice, with nothing to fail if
      only one was. */
  legal: { standard: boolean; expanded: boolean };
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

/** Whether a card is legal in a format: the catalog's structured verdict
    (`card.legal`), keyed by the format's {@link Format.legalFlag}. That is the
    whole rule — there is no printed-mark fallback any more (D191), so the
    rail's legal-only filter (same flag, applied server-side) and this
    validator read the same bit and cannot disagree, and the next rotation
    reaches the app as DATA (tcgdex → the catalog's legal_standard /
    legal_expanded columns) with no allow-list here to bump. A format without a
    flag is unrestricted (none modelled today). */
export function isLegalInFormat(card: BuilderCard, format: Format): boolean {
  if (format.legalFlag === undefined) return true;
  return card.legal[format.legalFlag];
}

// --- Card kinds --------------------------------------------------------------
// The rail's contextual filter offers card "kinds" once a supertype is chosen:
// stages / trainer subtypes / energy subtypes, all from the catalog's facets,
// all filtered SERVER-side (catalog.filtersToCardsQuery maps them to the
// stage/trainerType/energyType params). The rule-box markers (ex / V / VMAX /
// MEGA / …) are a SECOND, independent dimension — facets.suffixes → the
// `?suffix=` param — not extra chips in this one.
//
// NOTE (D198): there used to be a third category here, DERIVED_KINDS — "EX"
// and "Mega" chips matched by NAME REGEX on the client, because tcgdex's
// `suffix` was parsed and then dropped at ingest so no column existed to
// query. They are gone, and their removal is a bug fix twice over, measured
// against the live catalog (3,786 rows):
//   - "EX" (/\bex\b/i) matched 627 rows, and matched them CLIENT-side over a
//     server-paged list, so the whole dimension had to come off the wire and
//     be re-applied per page: a 50-card page of the 3,233 Pokémon rendered
//     ~10 tiles while the total said 3,233. That is the recorded symptom, and
//     no client-side filter over a server-paged list can avoid it.
//   - "Mega" (/\bmega\b/i) matched ZERO of the 3,786 rows. It was already the
//     thing this codebase refuses to ship: a chip that returns an empty grid
//     with no signal why.
// Both are now answered by the server or not offered at all — the vocabulary
// decides, and an empty vocabulary renders no chip.

// --- Energy-type palette ---------------------------------------------------
// One accent per type for the pips on Pokémon tiles and the type-distribution
// bar in the deck stats. The hex values live in the shared app-wide palette
// (src/lib/energyPalette.ts — also behind the game HUD's cost dots) so the
// colors can't drift between features; the one-letter `code` is the game's
// own energy abbreviation (Grass G, Fire R, Water W, …).

export interface EnergyTypeMeta {
  type: EnergyType;
  /** Single-letter energy abbreviation used on compact chips. */
  code: string;
  /** Accent colour (hex) for pips and the distribution bar. */
  color: string;
}

export const ENERGY_TYPE_META: Record<EnergyType, EnergyTypeMeta> = {
  Grass: { type: "Grass", code: "G", color: ENERGY_COLORS.Grass },
  Fire: { type: "Fire", code: "R", color: ENERGY_COLORS.Fire },
  Water: { type: "Water", code: "W", color: ENERGY_COLORS.Water },
  Lightning: { type: "Lightning", code: "L", color: ENERGY_COLORS.Lightning },
  Psychic: { type: "Psychic", code: "P", color: ENERGY_COLORS.Psychic },
  Fighting: { type: "Fighting", code: "F", color: ENERGY_COLORS.Fighting },
  Darkness: { type: "Darkness", code: "D", color: ENERGY_COLORS.Darkness },
  Metal: { type: "Metal", code: "M", color: ENERGY_COLORS.Metal },
  Dragon: { type: "Dragon", code: "N", color: ENERGY_COLORS.Dragon },
  Colorless: { type: "Colorless", code: "C", color: ENERGY_COLORS.Colorless },
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
  description: string;
}

// NOTE (D191): Standard used to carry a `legalRegulationMarks: ["H","I","J"]`
// allow-list as well, consulted by isLegalInFormat for cards with no `legal`
// block. Nothing in the app could reach it — `legal` is required on the wire
// and BuilderCard now requires it too — so it survived only as a fixture
// convenience while being a second thing a rotation had to touch. The
// mark→verdict derivation moved to the fixture factory (src/test/fixtures.ts),
// its one reader; formats know only their `legalFlag`.
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
