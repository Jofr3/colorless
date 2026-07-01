// Card model + metadata for the deck builder. The card *data* (the browsable
// pool) lives in cardPool.ts; this module holds the types, the energy-type
// palette, the format definitions, and small pure helpers shared across the
// builder. Kept pixi-free and side-effect-free so the pure logic (deckMath,
// decklistText) and their tests can import it freely.

/** The Pokémon TCG energy types, in the canonical wheel order. */
export const ENERGY_TYPES = [
  "Grass",
  "Fire",
  "Water",
  "Lightning",
  "Psychic",
  "Fighting",
  "Darkness",
  "Metal",
  "Dragon",
  "Colorless",
] as const;

export type EnergyType = (typeof ENERGY_TYPES)[number];

/** Top-level card category — drives the deck-list grouping (Pokémon / Trainer /
    Energy) and the right-panel split. Uses the accented "Pokémon" spelling the
    game itself uses. */
export type Supertype = "Pokémon" | "Trainer" | "Energy";

export const SUPERTYPES: Supertype[] = ["Pokémon", "Trainer", "Energy"];

/** Pokémon stage labels (also the subtype values for Pokémon cards). */
export const POKEMON_STAGES = ["Basic", "Stage 1", "Stage 2"] as const;
export type PokemonStage = (typeof POKEMON_STAGES)[number];

/** Trainer subtypes. "Pokémon Tool" is a Trainer in modern rules. */
export const TRAINER_SUBTYPES = ["Item", "Supporter", "Stadium", "Pokémon Tool"] as const;
export type TrainerSubtype = (typeof TRAINER_SUBTYPES)[number];

/** Energy subtypes. */
export const ENERGY_SUBTYPES = ["Basic Energy", "Special Energy"] as const;
export type EnergySubtype = (typeof ENERGY_SUBTYPES)[number];

/** Every printed card subtype — the union of the Pokémon-stage, Trainer and
    Energy subtype tuples. Narrower than the deck-builder's card-"kind" filter
    labels, which also include derived labels (Evolution / EX / Mega). */
export type Subtype = PokemonStage | TrainerSubtype | EnergySubtype;

/** Card rarities present in the pool, ordered low → high tier. Drives the
    rarity filter; the printed cards carry these exact strings. */
export const RARITIES = ["Common", "Uncommon", "Rare", "Double Rare", "ACE SPEC Rare"] as const;
export type Rarity = (typeof RARITIES)[number];

/** A single browsable card. `cardId` is a Scrydex id (set code + number) used
    for the art; the rest is the metadata the filters, stats and validation read.
    Optional fields are absent for categories they don't apply to (a Trainer has
    no `types`/`hp`, an Energy no `hp`, etc.). */
export interface BuilderCard {
  cardId: string;
  name: string;
  supertype: Supertype;
  /** Basic | Stage 1 | Stage 2 | Item | Supporter | Stadium | Pokémon Tool |
      Basic Energy | Special Energy. */
  subtype: Subtype;
  /** Energy type(s) — Pokémon (its type) and most Energy cards. */
  types?: EnergyType[];
  hp?: number;
  /** Regulation mark (e.g. "H", "I"), the basis of Standard-format legality. */
  regulationMark?: string;
  rarity?: Rarity;
  setName?: string;
  /** Collector number within its set. */
  number?: string;
}

/** Scrydex art for a card id, at the requested size. The image CDN serves every
    Scarlet & Violet-era id; {@link CardImage} falls back to a neutral tile when
    a particular id 404s, so a stale id never breaks layout. */
export function cardImageUrl(cardId: string, size: "small" | "large" = "large"): string {
  return `https://images.scrydex.com/pokemon/${cardId}/${size}`;
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
    which is how the printed cards mark themselves. */
export function isAceSpec(card: BuilderCard): boolean {
  return (card.rarity ?? "").includes("ACE SPEC");
}

/** Whether a card is legal in a format, by its printed regulation mark. Formats
    with no `legalRegulationMarks` (Expanded) impose no mark cutoff; an unmarked
    card (basic Energy) is always legal. */
export function isLegalInFormat(card: BuilderCard, format: Format): boolean {
  if (!format.legalRegulationMarks) return true;
  if (!card.regulationMark) return true;
  return format.legalRegulationMarks.includes(card.regulationMark);
}

// --- Card-kind categories --------------------------------------------------
// The rail's contextual filter offers card "kinds" once a supertype is chosen.
// For Trainers/Energy these are just the printed subtypes, but Pokémon kinds are
// partly derived: "Evolution" unions the two evolved stages, and "EX"/"Mega" are
// read off the card name (the pool has no dedicated field for either).

export interface CardCategory {
  label: string;
  match: (card: BuilderCard) => boolean;
}

const bySubtype = (subtype: string): CardCategory => ({
  label: subtype,
  match: (c) => c.subtype === subtype,
});

export const POKEMON_CATEGORIES: CardCategory[] = [
  { label: "Basic", match: (c) => c.subtype === "Basic" },
  { label: "Evolution", match: (c) => c.subtype === "Stage 1" || c.subtype === "Stage 2" },
  { label: "EX", match: (c) => /\bex\b/i.test(c.name) },
  { label: "Mega", match: (c) => /\bmega\b/i.test(c.name) },
];

export const TRAINER_CATEGORIES: CardCategory[] = TRAINER_SUBTYPES.map(bySubtype);

export const ENERGY_CATEGORIES: CardCategory[] = ENERGY_SUBTYPES.map(bySubtype);

/** The card-kind options offered for a chosen supertype ("all" → none). */
export function cardCategories(supertype: "all" | Supertype): CardCategory[] {
  if (supertype === "Pokémon") return POKEMON_CATEGORIES;
  if (supertype === "Trainer") return TRAINER_CATEGORIES;
  if (supertype === "Energy") return ENERGY_CATEGORIES;
  return [];
}

const CATEGORY_BY_LABEL = new Map<string, CardCategory>(
  [...POKEMON_CATEGORIES, ...TRAINER_CATEGORIES, ...ENERGY_CATEGORIES].map((c) => [c.label, c]),
);

/** OR within the card-kind dimension: keep a card if it matches any selected
    label. Unknown labels match nothing. */
export function cardMatchesCategories(card: BuilderCard, labels: string[]): boolean {
  return labels.some((label) => CATEGORY_BY_LABEL.get(label)?.match(card) ?? false);
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
  /** Regulation marks legal in this format; undefined = no mark restriction
      (Expanded spans far more sets than we model, so we don't gate on marks). */
  legalRegulationMarks?: string[];
  description: string;
}

// Standard's legal regulation marks rotate each year; the set here is filled
// from the rules research and is easy to bump when the next rotation lands.
export const FORMATS: Format[] = [
  {
    id: "standard",
    name: "Standard",
    deckSize: 60,
    maxCopiesByName: 4,
    minBasicPokemon: 1,
    // Legal marks after the April 2026 rotation (G rotated out); bump this list
    // when the next rotation lands.
    legalRegulationMarks: ["H", "I", "J"],
    description: "Most recent sets — the default tournament format.",
  },
  {
    id: "expanded",
    name: "Expanded",
    deckSize: 60,
    maxCopiesByName: 4,
    minBasicPokemon: 1,
    description: "Black & White onward — a far wider card pool.",
  },
];

export const DEFAULT_FORMAT = FORMATS[0];

export function formatById(id: string): Format {
  return FORMATS.find((f) => f.id === id) ?? DEFAULT_FORMAT;
}
