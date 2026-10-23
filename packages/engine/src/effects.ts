// The conservative text-to-ops deriver. This module is pure data; interpreter.ts owns every state
// transition. Registry-authored programs are hand-written op arrays that take precedence over the
// deriver. The op contract itself lives in effectTypes.ts and is re-exported here.

import { BASIC_ENERGY_TYPES, type BasicEnergyType } from "@colorless/schema";

import type { StatusName } from "./events";

import { BENCH_MAX, HP_PER_COUNTER, type SpecialConditions } from "./types";

import type { CoinFace } from "./rng";

import type {
  AttackCopy,
  AttackTimingGate,
  AttackerClass,
  BoardCondition,
  CardFilter,
  DamageCountSource,
  DiscardPileSeat,
  EffectOp,
  EffectSlot,
  InPlayAttackCopy,
  OpOf,
  OpponentEnergyZone,
  PokemonType,
  ResolvedAttackCopy,
  StampedHandPlayClass,
} from "./effectTypes";

import { POKEMON_TYPES } from "./effectTypes";

export type {
  AttachTargetRiders,
  AttackCopy,
  AttackerClass,
  BoardCondition,
  CardFilter,
  CountSeat,
  DamageCountSource,
  DiscardPileSeat,
  EffectOp,
  EffectSlot,
  HandPlayClass,
  HandRefreshDraw,
  InPlayAttackCopy,
  OpOf,
  OpponentEnergyZone,
  PokemonPlayAct,
  PokemonType,
  ResolvedAttackCopy,
  StampedHandPlayClass,
  StampedPlayLockKey,
  StampedPokemonPlayAct,
} from "./effectTypes";

export { POKEMON_TYPES } from "./effectTypes";

/**
 * A printed count, or null when it is below 1 (or not a number). A printed 0 would build an op that
 * does nothing, or spend a flip to add nothing, so the sentence refuses instead.
 */
function positiveInt(digits: string | undefined): number | null {
  const n = Number(digits);
  return n >= 1 ? n : null;
}

// Gate-op builders. Each returns a fresh object with the fields in the order the hand-written
// literals used, and leaves optional fields absent rather than undefined.
function headsGate(then: EffectOp[], otherwise?: EffectOp[]): OpOf<"coinFlipGate"> {
  return otherwise === undefined
    ? { op: "coinFlipGate", then }
    : { op: "coinFlipGate", then, otherwise };
}

function tailsGate(then: EffectOp[], coins?: number): OpOf<"coinFlipGate"> {
  return coins === undefined
    ? { op: "coinFlipGate", onTails: true, then }
    : { op: "coinFlipGate", coins, onTails: true, then };
}

function conditionGate(
  cond: BoardCondition,
  then: EffectOp[],
  otherwise?: EffectOp[],
): OpOf<"conditionGate"> {
  return otherwise === undefined
    ? { op: "conditionGate", cond, then }
    : { op: "conditionGate", cond, then, otherwise };
}

function optionalStep(note: string, then: EffectOp[], otherwise?: EffectOp[]): OpOf<"optional"> {
  return otherwise === undefined
    ? { op: "optional", note, then }
    : { op: "optional", note, then, otherwise };
}

function recordGate(slot: EffectSlot, then: EffectOp[]): OpOf<"recordGate"> {
  return { op: "recordGate", slot, then };
}

type StatusWord = "Asleep" | "Burned" | "Confused" | "Paralyzed" | "Poisoned";

/** A Special Condition as the CARDS print it — capitalized, the form the deriver
    reads out of attack text and the form a prompt has to put back ("it is now
    Poisoned", Janine's Secret Art). The inverse of `STATUS_OF_WORD` below (the
    deriver's own `STATUS_WORDS` is a different thing — a regex alternation); both
    tables are exhaustive `Record`s over their key type, so a new condition is a
    compile error in two places rather than a silent gap in one, and a test pins
    them mutually inverse (the one drift the types cannot catch). */
export const STATUS_WORD_OF: Record<StatusName, StatusWord> = {
  asleep: "Asleep",
  burned: "Burned",
  confused: "Confused",
  paralyzed: "Paralyzed",
  poisoned: "Poisoned",
};

const STATUS_OF_WORD: Record<StatusWord, StatusName> = {
  Asleep: "asleep",
  Burned: "burned",
  Confused: "confused",
  Paralyzed: "paralyzed",
  Poisoned: "poisoned",
};

// The recognized sentence shapes, anchored end to end and compiled once
// (no /g flag — exec is stateless, so module scope is safe). Catalog rows use
// the straight apostrophe ("opponent's"); the character class also admits
// the typographic one so a re-ingest changing only punctuation cannot
// silently un-derive every status attack. {X} = the five status words;
// {N} = a positive integer.
const STATUS_WORDS = "Asleep|Burned|Confused|Paralyzed|Poisoned";

// Self-inflicted statuses exclude Paralyzed: self-applied paralysis should survive the next Checkup
// (§12), but the engine's Checkup clear is unconditional for the ended seat, so such text stays
// unbuilt.
const SELF_STATUS_WORDS = "Asleep|Burned|Confused|Poisoned";

/** The two riders the printed adjective can set, taken OFF the op with `Pick` rather
    than re-declared, so a field rename cannot leave this map behind still compiling. */
type HealEachScope = Pick<OpOf<"healEach">, "basicOnly" | "benchOnly">;

/** The captured class word → the `StampedHandPlayClass` key `preventHandPlay`
    carries.
    Written once for the three anchors above rather than spelled at each `exec`
    (the EXTRACT rule): a widened alternation that forgot one site would be a
    silent mis-classification, and here it is a compile error instead. Both arms
    are reachable off printed text — `Supporter` from Scream Tail ex, `Item` from
    the other six printings — so neither is a branch no board can take. */
function handPlayClassOf(word: string | undefined): StampedHandPlayClass {
  return word === "Supporter" ? "Supporter" : "Item";
}

// "This attack (also) does N damage to C of your (opponent's) Benched Pokémon [class] [that has any
// damage counters on it]." Shared by several readers, so widening it widens all of them. Groups:
// [1] amount, [2] count, [3] side, [4] class, [5] damaged-only narrowing. The whole-sentence `\.`
// after the noun is what keeps sentences that continue (e.g. "for each Prize card…") off this path.
const BENCHED_SNIPE_CLASS_NOUNS: ReadonlyMap<string, CardFilter> = new Map<string, CardFilter>([
  ["ex", { kind: "suffixPokemon", suffix: "ex" }],
  [
    "ex or Benched Pokémon V",
    {
      kind: "anyOf",
      filters: [
        { kind: "suffixPokemon", suffix: "ex" },
        { kind: "suffixPokemon", suffix: "V" },
      ],
    },
  ],
]);

// The class alternation, built from the map's keys longest-first.
const BENCHED_SNIPE_CLASS_GROUP = `(?: (${[...BENCHED_SNIPE_CLASS_NOUNS.keys()]
  .sort((a, b) => b.length - a.length)
  .join("|")}))?`;

// The pieces are kept as a concatenation rather than one long template literal for readability, so
// the style rule is suppressed here.
const ALSO_BENCHED_SNIPE_BODY =
  // biome-ignore lint/style/useTemplate: see the note above — collapsing this chain would destroy four mutation anchors.
  `attack (?:also )?does (\\d+) damage to (\\d+) of (your opponent['’]s|your) Benched Pokémon` +
  BENCHED_SNIPE_CLASS_GROUP +
  "( that has any damage counters on it)?\\." +
  `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?`;

/**
 * "this Pokémon has at least N extra Energy attached (in addition to this attack's cost)" →
 * `extraEnergyBeyondAttackCost`, or null. Fallback for `CONDITIONAL_BENCH_SNIPE` only.
 */
const EXTRA_ENERGY_GATE_CLAUSE =
  /^this Pokémon has at least (\d+) extra Energy attached \(in addition to this attack['’]s cost\)$/;

function extraEnergyGateForClause(clause: string): BoardCondition | null {
  const extra = Number(EXTRA_ENERGY_GATE_CLAUSE.exec(clause)?.[1] ?? 0);
  return extra >= 1 ? { kind: "extraEnergyBeyondAttackCost", extra } : null;
}

/**
 * The same head with "This attack's damage isn't affected by Weakness." appended. Read by two
 * readers: `deriveAttackDamageMultiplier` for the fold and `deriveAttackDamageSuppression` for `{
 * weakness: true }`, the latter gated on the multiplier also claiming the sentence so the pair
 * cannot half-build.
 */
const BENCH_COUNTER_FILTERED_SUPPRESSED =
  /^This attack does (\d+) damage for each damage counter on all of your Benched ([^.]+ Pokémon)\. This attack['’]s damage isn['’]t affected by Weakness\.$/;

/** The three printed nouns with no parameter, mapped to the `CardFilter` members
    that already spell them. A MAP and not a regex alternation, for
    `CLAUSE_ENERGY_TOKENS`' reason: the accepted vocabulary is a single list rather
    than something somebody edits by hand in two places. */
const IN_PLAY_BODY_NOUNS: ReadonlyMap<string, CardFilter> = new Map<string, CardFilter>([
  ["Pokémon", { kind: "anyPokemon" }],
  ["Basic Pokémon", { kind: "basicPokemon" }],
  ["Evolution Pokémon", { kind: "evolutionPokemon" }],
  // Rule-box nouns are exact map rows rather than a capture over suffixes. "Pokémon ex and Pokémon
  // V" is an `anyOf`: "and" names a set, not an intersection.
  ["Pokémon ex", { kind: "suffixPokemon", suffix: "ex" }],
  [
    "Pokémon ex and Pokémon V",
    {
      kind: "anyOf",
      filters: [
        { kind: "suffixPokemon", suffix: "ex" },
        { kind: "suffixPokemon", suffix: "V" },
      ],
    },
  ],
  // Stage-ordinal nouns as exact map rows.
  ["Stage 1 Pokémon", { kind: "stagePokemon", stage: "Stage1" }],
  ["Stage 2 Pokémon", { kind: "stagePokemon", stage: "Stage2" }],
  // A card-name key, as a literal row: a captured name handed to an exact-name match would silently
  // match nothing for non-name tokens.
  ["Charjabug", { kind: "byName", name: "Charjabug" }],
  // A pair of card names in an `anyOf`: "and" names a set, not an intersection. Exact keys must not
  // end in a possessive, so `IN_PLAY_OWNER_NOUN` cannot reach them.
  [
    "Drifloon and Drifblim",
    {
      kind: "anyOf",
      filters: [
        { kind: "byName", name: "Drifloon" },
        { kind: "byName", name: "Drifblim" },
      ],
    },
  ],
  // The Ancient banner, resolved by printing id through `banners.ts` (`bannerPokemon`), never by
  // species name.
  ["Ancient Pokémon", { kind: "bannerPokemon", banner: "Ancient" }],
  // A name pair ("Beedrill ex" is the printed card name), a bare card name, and a quoted name
  // fragment (`pokemonNameContaining`). None carries an apostrophe.
  [
    "Beedrill and Beedrill ex",
    {
      kind: "anyOf",
      filters: [
        { kind: "byName", name: "Beedrill" },
        { kind: "byName", name: "Beedrill ex" },
      ],
    },
  ],
  ["Rattata", { kind: "byName", name: "Rattata" }],
  ['Pokémon that has "Tauros" in its name', { kind: "pokemonNameContaining", fragment: "Tauros" }],
  // A benched Antique Fossil is read through its in-play face (`inPlayCardOf`).
  [
    'Pokémon that has "Antique" in its name',
    { kind: "pokemonNameContaining", fragment: "Antique" },
  ],
  // "Pikachu ex" is the printed card name.
  [
    "Pikachu and Pikachu ex",
    {
      kind: "anyOf",
      filters: [
        { kind: "byName", name: "Pikachu" },
        { kind: "byName", name: "Pikachu ex" },
      ],
    },
  ],
]);

/**
 * The class nouns a whole-side spread can target, a shortlist of `IN_PLAY_BODY_NOUNS` keys so both
 * readers answer the same filter. A key missing from the map leaves the sentence on the skipped
 * path.
 */
const SPREAD_EACH_CLASS_NOUNS: readonly string[] = ["Pokémon ex and Pokémon V", "Pokémon ex"];

/**
 * "This attack does N damage for each of your X in play. This attack also does M damage to each of
 * your X." Two readers claim this one sentence: the multiplier folds the count and the effect
 * reader emits the own-side spread. The `\2` backreference makes the counted and the damaged bodies
 * the same population, and `(?!opponent)` keeps an opponent noun from being counted off the
 * attacker's board.
 */
const NAMED_BODIES_MULTIPLY_SPREAD =
  /^This attack does (\d+) damage for each of your ((?!opponent)[^.]+) in play\. This attack also does (\d+) damage to each of your \2\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/;

/**
 * An owner-prefixed noun such as "Team Rocket's Pokémon". The owner is captured rather than listed,
 * so new owner prefixes need no code change.
 */
const IN_PLAY_OWNER_NOUN = /^(.+)['’]s Pokémon$/;

/** The TYPED noun ("{G} Pokémon", and the spelled-out "Grass Pokémon" the older
    prints carry). Resolved through `CLAUSE_POKEMON_TYPES` — the map that is TOTAL
    over `POKEMON_TYPES` in BOTH notations and already pinned against it — rather
    than through a fresh table, so a type meaning Grass in one clause of this file
    means Grass in every other one. */
const IN_PLAY_TYPED_NOUN = /^(.+) Pokémon$/;

/**
 * Resolves the printed noun between "for each of your " and " in play." (or "on your Bench.") to a
 * `CardFilter`, or `null` when it cannot be spelled, which keeps the sentence on the loud skipped
 * path. The branches are disjoint (no exact key or type name carries a possessive), so their order
 * does not matter; the typed branch only returns when `CLAUSE_POKEMON_TYPES` resolves the token.
 */
function inPlayBodyFilter(noun: string): CardFilter | null {
  const exact = IN_PLAY_BODY_NOUNS.get(noun);
  if (exact !== undefined) return exact;
  const owner = IN_PLAY_OWNER_NOUN.exec(noun);
  if (owner !== null && owner[1] !== undefined) {
    return { kind: "ownerPokemon", owner: owner[1] };
  }
  const typed = IN_PLAY_TYPED_NOUN.exec(noun);
  if (typed !== null) {
    const pokemonType = literalClauseRow(CLAUSE_POKEMON_TYPES, typed[1] ?? "");
    if (pokemonType !== undefined) return { kind: "typedPokemon", pokemonType };
  }
  return null;
}

/**
 * Printed discard-pile nouns mapped to their `CardFilter`. Read through `literalClauseRow` because
 * a key spells an apostrophe, and a curly-apostrophe re-ingest would otherwise miss it.
 */
const DISCARD_PILE_NOUNS: ReadonlyMap<string, CardFilter> = new Map<string, CardFilter>([
  // "Energy card" is Basic OR Special (`isEnergyCard`), the printed noun with no class
  // adjective — the widest of the three Energy readings this union spells.
  ["Energy card", { kind: "anyEnergy" }],
  // Untyped: absent `energyType` means every Basic Energy.
  ["Basic Energy card", { kind: "basicEnergy" }],
  // A Pokémon Tool is not an Item.
  ["Item card", { kind: "item" }],
  // `byName` is exact equality on `Card.name`.
  ["Ethan's Adventure card", { kind: "byName", name: "Ethan's Adventure" }],
  // `bannerCard` counts Ancient cards of any category, including Ancient Trainers.
  ["Ancient card", { kind: "bannerCard", banner: "Ancient" }],
]);

/**
 * "Supporter card that has "X" in its name". The capture is delimited by the printed quotes and
 * cannot be empty, so it can never match every Supporter.
 */
const PILE_SUPPORTER_NAME_FRAGMENT = /^Supporter card that has "([^"]+)" in its name$/;

/**
 * Resolves the printed discard-pile noun to a `CardFilter`, or `null` to keep the sentence on the
 * loud skipped path. Literal map rows are checked before the name-fragment pattern.
 */
function discardPileFilter(noun: string): CardFilter | null {
  const literal = literalClauseRow(DISCARD_PILE_NOUNS, noun);
  if (literal !== undefined) return literal;
  const fragment = PILE_SUPPORTER_NAME_FRAGMENT.exec(noun);
  return fragment === null
    ? null
    : { kind: "supporterNameContaining", fragment: fragment[1] ?? "" };
}

const MILLED_TYPED_BASIC_NOUN = /^Basic \{([A-Z])\} Energy card$/;

/**
 * Resolves the milled-card noun to a `CardFilter`, or `null` to stay loud. Reuses
 * `discardPileFilter` but does not add rows to its map, since that would also widen the
 * discard-pile anchors to sentences no card prints.
 */
function milledCardFilter(noun: string): CardFilter | null {
  const zoneNoun = discardPileFilter(noun);
  if (zoneNoun !== null) return zoneNoun;
  // "Basic {X} Energy card" is mill-only; adding it to `DISCARD_PILE_NOUNS` would widen the
  // discard-pile anchors.
  const typedBasic = MILLED_TYPED_BASIC_NOUN.exec(noun);
  const milledType = typedBasic === null ? undefined : ENERGY_TYPE_BY_CODE[typedBasic[1] ?? ""];
  if (milledType !== undefined) return { kind: "basicEnergy", energyType: milledType };
  const owner = IN_PLAY_OWNER_NOUN.exec(noun);
  if (owner !== null && owner[1] !== undefined) return { kind: "ownerPokemon", owner: owner[1] };
  return null;
}

// Also matches the comma-joined wording "…reveals their hand, and this attack does…".
const ATTACK_REVEAL_AND_TRAINER_SCALE =
  /^Your opponent reveals their hand(?:\. This|, and this) attack does (\d+) damage for each ([^.]+) you find there\.$/;

/**
 * Printed opponent-hand nouns mapped to their `CardFilter`. A closed map rather than a capture, so
 * an unknown noun stays loud instead of counting zero.
 */
const OPPONENT_HAND_NOUNS: ReadonlyMap<string, CardFilter> = new Map<string, CardFilter>([
  // Corpus 675's printed noun. `trainerCard` is the catalog's `category: "Trainer"`
  // — Item, Supporter, Stadium and Tool alike, which is what the printed word means
  // and what `matchesFilter` already answers.
  ["Trainer card", { kind: "trainerCard" }],
  // Corpus 564's printed noun: the BARE "each card", every card in the zone.
  // `anyCard` is the member that already spells "no narrowing at all", and it is a
  // real member rather than an absent filter because this count's payload is
  // REQUIRED — see the union member's own block for why.
  ["card", { kind: "anyCard" }],
  ["Energy card", { kind: "anyEnergy" }],
]);

/** Resolves the printed opponent-hand noun to a `CardFilter`, or `null` to stay loud. */
function opponentHandFilter(noun: string): CardFilter | null {
  return literalClauseRow(OPPONENT_HAND_NOUNS, noun) ?? null;
}

// Read by two readers: the multiplier folds the discard-pile count and the effect reader shuffles
// those same cards back. The fold lands before the program (§8), so the count is taken before the
// shuffle.
const DISCARD_PILE_COUNT_THEN_SHUFFLE =
  /^This attack does (\d+) damage for each Basic \{W\} Energy card in your discard pile\. Then, shuffle those cards into your deck\.$/;

const RIPTIDE_PILE_FILTER: CardFilter = { kind: "basicEnergy", energyType: "Water" };

/**
 * The conditional bonus with a Weakness-only suppression rider. Capture groups match
 * `CONDITIONAL_DAMAGE_BONUS` so one arm reads both; the bonus and suppression readers both read
 * this anchor.
 */
const CONDITIONAL_BONUS_SUPPRESSED =
  /^If (.+), this attack does (\d+) more damage\. This attack['’]s damage isn['’]t affected by Weakness\.$/;

// Both printed energy notations: brace codes ({L}) and spelled-out names (Fire). {C} and {N} are
// absent (§6.1): Colorless is the provision fallback for unauthored Special Energy, so a {C} filter
// would match cards nobody meant.
export const ENERGY_TYPE_BY_CODE: Readonly<Record<string, BasicEnergyType>> = {
  G: "Grass",
  R: "Fire",
  W: "Water",
  L: "Lightning",
  P: "Psychic",
  F: "Fighting",
  D: "Darkness",
  M: "Metal",
  Y: "Fairy",
};

/** The spelled-out notation, keyed straight off BASIC_ENERGY_TYPES rather than
    re-listed — so the two notations cannot resolve to different vocabularies, and
    a type added to the schema is admitted here by construction. */
const ENERGY_TYPE_BY_NAME: Readonly<Record<string, BasicEnergyType>> = Object.fromEntries(
  BASIC_ENERGY_TYPES.map((type) => [type, type]),
);

/**
 * Brace code read as a Pokémon type rather than a payable Energy. Extends `ENERGY_TYPE_BY_CODE`
 * with `N` (Dragon, which has no Basic Energy) and `C` (Colorless, excluded from the energy map
 * because `{C}` there is the Special Energy fallback).
 */
export const POKEMON_TYPE_BY_CODE: Readonly<Record<string, PokemonType>> = {
  ...ENERGY_TYPE_BY_CODE,
  N: "Dragon",
  C: "Colorless",
};

const CLAUSE_ENERGY_TOKENS: ReadonlyMap<string, BasicEnergyType | "special" | "basic"> = new Map([
  ...Object.entries(ENERGY_TYPE_BY_CODE).map(
    ([code, type]) => [`{${code}}`, type] as [string, BasicEnergyType | "special" | "basic"],
  ),
  ...Object.entries(ENERGY_TYPE_BY_NAME).map(
    ([name, type]) => [name, type] as [string, BasicEnergyType | "special" | "basic"],
  ),
  ["Special", "special"] as [string, BasicEnergyType | "special" | "basic"],
  // `Basic` is a card category, the complement of `Special`, not a tenth type.
  ["Basic", "basic"] as [string, BasicEnergyType | "special" | "basic"],
]);

/** Accepts both the type name and its brace code, since the catalog prints both notations. */
const CLAUSE_POKEMON_TYPES: ReadonlyMap<string, PokemonType> = new Map([
  ...POKEMON_TYPES.map((type) => [type, type] as [string, PokemonType]),
  ...Object.entries(POKEMON_TYPE_BY_CODE).map(
    ([code, type]) => [`{${code}}`, type] as [string, PokemonType],
  ),
]);

/**
 * Every exact lookup on printed text goes through this fold so curly and straight apostrophes match
 * the same key.
 */
const CURLY_APOSTROPHE = "’";

const STRAIGHT_APOSTROPHE = "'";

/**
 * The same apostrophe fold applied to a captured value rather than a table key; exported for use in
 * another file.
 */
export function foldApostrophes(text: string): string {
  return text.includes(CURLY_APOSTROPHE)
    ? text.replaceAll(CURLY_APOSTROPHE, STRAIGHT_APOSTROPHE)
    : text;
}

function literalClauseRow<T>(table: ReadonlyMap<string, T>, clause: string): T | undefined {
  const exact = table.get(clause);
  if (exact !== undefined) return exact;
  // The `includes` guard is not an optimisation: it states that the second lookup
  // exists ONLY for text carrying a curly apostrophe, so a clause that misses for
  // any other reason misses exactly once and stays LOUD.
  return clause.includes(CURLY_APOSTROPHE)
    ? table.get(clause.replaceAll(CURLY_APOSTROPHE, STRAIGHT_APOSTROPHE))
    : undefined;
}

/**
 * Printed conditional clauses keyed on the exact text between "If " and ", this attack does". A Map
 * so arbitrary text cannot hit `Object.prototype` keys. "this Pokémon" resolves to the attacker's
 * Active here. Lookups go through `literalClauseRow`, which retries with curly apostrophes folded;
 * literal rows win over templates.
 */
const CONDITIONAL_DAMAGE_CLAUSES = new Map<string, BoardCondition>([
  // Palossand sv02-096 "Earthen Power" (+80) and its siblings — §7.3 OWNERSHIP,
  // not mere presence: the opponent's Stadium in the shared zone does not count.
  ["you have a Stadium in play", { kind: "yourStadiumInPlay" }],
  // No possessive: any Stadium in play counts (§7.3 presence), unlike the row above.
  ["a Stadium is in play", { kind: "stadiumInPlay" }],
  // Gyarados sv02-043 "Revengeful Storm" (+100) — §14, the comeback clause: you
  // have MORE prizes left, i.e. you are BEHIND on prizes taken.
  ["you have more Prize cards remaining than your opponent", { kind: "morePrizesThanOpponent" }],
  // Gyarados ex sv01-045/-225 "Tyrannical Tail" (+180), Meowscarada ex
  // sv02-015/-231/-256/-271 "Scratching Nails" (+120) — "already", read at
  // declaration.
  [
    "your opponent's Active Pokémon already has any damage counters on it",
    { kind: "opponentActiveDamaged" },
  ],
  ["your opponent's Active Pokémon is an Evolution Pokémon", { kind: "opponentActiveIsEvolution" }],
  // Talonflame sv02-030 "Fiery Breeze" (+90), Darmanitan sv03-035 "Damage
  // Counterpunch" (+60) — the printed "this Pokémon" resolving to the attacker's
  // own Active (see the pronoun note above). Note the missing "already": that
  // word appears ONLY on the opponent-facing twin two rows up, and is the sole
  // lexical discriminator between the two damage-counter clauses.
  ["this Pokémon has any damage counters on it", { kind: "yourActiveDamaged" }],
  // Complement of the row above ("any" vs "no").
  ["this Pokémon has no damage counters on it", { kind: "yourActiveUndamaged" }],
  [
    "this Pokémon has 2 or more damage counters on it",
    { kind: "yourActiveDamageCountersAtLeast", count: 2 },
  ],
  // Tyranitar ex sv03-066/-211 "Lightning Rampage" (+100) — the two printings are
  // byte-identical in rules text, so one fixture serves both ids.
  ["your Benched Pokémon have any damage counters on them", { kind: "yourBenchDamaged" }],
  // Every benched Pokémon damaged, versus any in the row above. A literal row: the threshold is
  // printed only at 1.
  [
    "all of your Benched Pokémon have at least 1 damage counter on them",
    { kind: "yourBenchAllDamaged" },
  ],
  // Literal row: the token after "Benched" is not a closed vocabulary (banners, owners, type codes
  // appear there).
  [
    "any of your Benched Cubone have any damage counters on them",
    { kind: "yourBenchNamedDamaged", name: "Cubone" },
  ],
  [
    "any of your Benched Pancham have any damage counters on them",
    { kind: "yourBenchNamedDamaged", name: "Pancham" },
  ],
  // Seviper sv01-128 "Venoshock" (+120) and Paldean Clodsire sv03-129, same
  // attack NAME and same clause on two different cards. NOT the same clause as
  // Okidogi ex sv06.5-036/-082/-090's "If THIS Pokémon is Poisoned" (+130), which
  // is a different, still-unmapped member.
  ["your opponent's Active Pokémon is Poisoned", { kind: "opponentActivePoisoned" }],
  // Sableye sv02-136 "Unseen Claw" (+70) — the pool's only "is affected by"
  // clause. The setter form ("is now affected by that Special Condition",
  // Vivillon sv01-010) reads similarly and is a different sentence entirely; the
  // whole-sentence anchor is what keeps it off this path.
  [
    "your opponent's Active Pokémon is affected by a Special Condition",
    { kind: "opponentActiveHasSpecialCondition" },
  ],
  // Okidogi ex sv06.5-036/-082/-090 "Chain-Crazed" (+130) — the three printings
  // are byte-identical in rules text, so one fixture serves all three. The
  // printed "this Pokémon" resolves to the attacker's own Active here, exactly
  // as Talonflame's does four rows up; the CROSS-BOARD twin two rows up is one
  // possessive apart, and the pool prints no third reading of "is Poisoned".
  ["this Pokémon is Poisoned", { kind: "yourActivePoisoned" }],
  ["this Pokémon is Burned or Poisoned", { kind: "yourActiveBurnedOrPoisoned" }],
  ["your opponent's Active Pokémon is Burned", { kind: "opponentActiveBurned" }],
  ["your opponent's Active Pokémon is Confused", { kind: "opponentActiveConfused" }],
  // Ceruledge sv02-098 "Fighting Sword" (+100) — the pool's only printing of the
  // rule-box clause, and NOT a `hasRuleBox` read: the sentence names ex and V and
  // nothing else, so a VMAX/VSTAR Active does not satisfy it.
  [
    "your opponent's Active Pokémon is a Pokémon ex or Pokémon V",
    { kind: "opponentActiveIsExOrV" },
  ],
  // Differs from the row above only by " or Pokémon V"; the amount is captured by the outer
  // pattern.
  ["your opponent's Active Pokémon is a Pokémon ex", { kind: "opponentActiveIsEx" }],
  // A separate member, not a narrowing of `opponentActiveIsEvolution`. This literal row must win
  // over `OPPONENT_ACTIVE_TYPE_CLAUSE`, which also matches it.
  ["your opponent's Active Pokémon is a Stage 1 Pokémon", { kind: "opponentActiveIsStage1" }],
  // Reads the printed `stage`, so a VSTAR is not a Stage 2.
  ["your opponent's Active Pokémon is a Stage 2 Pokémon", { kind: "opponentActiveIsStage2" }],
  // Tera is a banner, not a type: the type templates match these clauses but miss, so the literal
  // rows win.
  [
    "your opponent's Active Pokémon is a Tera Pokémon",
    { kind: "opponentActiveIsBanner", banner: "Tera" },
  ],
  ["you have any Tera Pokémon on your Bench", { kind: "yourBannerPokemonOnBench", banner: "Tera" }],
  [
    "you played a Future Supporter card from your hand during this turn",
    { kind: "yourPlayedBannerSupporterThisTurn", banner: "Future" },
  ],
  [
    "your opponent has any Future Pokémon in play",
    { kind: "opponentBannerPokemonInPlay", banner: "Future" },
  ],
  // Reads the effective Retreat Cost, matching how `opponentActiveRetreatCost` reads the same noun
  // phrase.
  [
    "the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more",
    { kind: "opponentActiveRetreatCostAtLeast", count: 2 },
  ],
  // Literal rows rather than a template: both the count list and the noun's grammatical number
  // vary.
  [
    "your opponent has exactly 1 Prize card remaining",
    { kind: "opponentPrizesRemaining", counts: [1] },
  ],
  [
    "your opponent has exactly 2 or 4 Prize cards remaining",
    { kind: "opponentPrizesRemaining", counts: [2, 4] },
  ],
  // "N or fewer" is enumerated as a set including 0, which is exact since prize counts are 0-6.
  // "Remaining" counts cards in `prizes`, not prizes taken.
  [
    "your opponent has 4 or fewer Prize cards remaining",
    { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3, 4] },
  ],
  [
    "your opponent has 3 or fewer Prize cards remaining",
    { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] },
  ],
  [
    "your opponent has 2 or fewer Prize cards remaining",
    { kind: "opponentPrizesRemaining", counts: [0, 1, 2] },
  ],
  ["you have exactly 6 Prize cards remaining", { kind: "yourPrizesRemaining", counts: [6] }],
  ["you have no cards in your hand", { kind: "yourHandExactly", count: 0 }],
  // Absol ex sv03-135/-214 "Cursed Slug" (+120) — the two printings are
  // byte-identical in rules text, so one fixture serves both ids. "their hand",
  // possessive, is the cross-board half of the pair; the own-hand clause below
  // reads BOTH hands and neither reads a hand's contents.
  ["your opponent has 3 or fewer cards in their hand", { kind: "opponentHandAtMost", count: 3 }],
  ["your opponent has 5 or fewer cards in their hand", { kind: "opponentHandAtMost", count: 5 }],
  ["your opponent has 3 or more Benched Pokémon", { kind: "opponentBenchAtLeast", count: 3 }],
  // Literal row: a numeric threshold has no closed vocabulary to fail against.
  ["there are 3 or fewer cards in your deck", { kind: "yourDeckAtMost", count: 3 }],
  // Bronzong sv03-145 "Extrasensory" (+90). Bronzor sv03-144 "Mirror Draw"
  // prints this clause's exact words ("Draw cards until you have the same number
  // of cards in your hand as your opponent.") as a DRAW effect — a substring
  // matcher would score a damage bonus off the pre-evolution; the whole-sentence
  // anchor is what keeps it off this path.
  ["you have the same number of cards in your hand as your opponent", { kind: "handSizesEqual" }],
  [
    "this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached",
    { kind: "activeEnergyCountsEqual" },
  ],
  [
    "this Pokémon has more Energy attached than your opponent's Active Pokémon",
    { kind: "moreActiveEnergyThanOpponent" },
  ],
  [
    "any of your Pokémon in play are the same type as any of your opponent's Pokémon in play",
    { kind: "inPlayTypesIntersect" },
  ],
  // Card names are an open vocabulary, so each name gets a literal row; a template would silently
  // answer false for any unrecognised phrase.
  ["Falinks is on your Bench", { kind: "yourBenchHasNamed", name: "Falinks" }],
  // Bench-only matters: Durant and Mightyena name themselves, so an "in play" reading would let the
  // attacker satisfy its own clause.
  ["Durant is on your Bench", { kind: "yourBenchHasNamed", name: "Durant" }],
  ["Illumise is on your Bench", { kind: "yourBenchHasNamed", name: "Illumise" }],
  ["Mightyena is on your Bench", { kind: "yourBenchHasNamed", name: "Mightyena" }],
  [
    'a Pokémon that has "Nidoking" in its name is on your Bench',
    { kind: "yourBenchHasNameContaining", fragment: "Nidoking" },
  ],
  [
    "Beldum and Metang are on your Bench",
    {
      kind: "allOf",
      conditions: [
        { kind: "yourBenchHasNamed", name: "Beldum" },
        { kind: "yourBenchHasNamed", name: "Metang" },
      ],
    },
  ],
  [
    "you have at least 3 {D} Energy in play",
    { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 },
  ],
  // Counts Energy cards of any type, unlike the row above, which counts provision of one type.
  [
    "you have 3 or more Energy in play",
    { kind: "yourEnergyInPlayAtLeast", energy: null, count: 3 },
  ],
  [
    "you have at least 4 {L} Energy in play",
    { kind: "yourEnergyInPlayAtLeast", energy: "Lightning", count: 4 },
  ],
  [
    "you have at least 4 {R} Energy in play",
    { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 4 },
  ],
  [
    "you have at least 4 {W} Energy in play",
    { kind: "yourEnergyInPlayAtLeast", energy: "Water", count: 4 },
  ],
  // Counts printed Basic Energy cards in the discard pile, not provision (§6.5).
  [
    "you have 10 or more Basic {R} Energy cards in your discard pile",
    { kind: "yourBasicEnergyInDiscardAtLeast", energy: "Fire", count: 10 },
  ],
  [
    "this Pokémon has 2 or more {G} Energy attached",
    { kind: "yourActiveEnergyAtLeast", energy: "Grass", count: 2 },
  ],
  // Literal row; it must win over `SELF_ENERGY_ATTACHED_CLAUSE`, which also matches this clause.
  [
    "this Pokémon has any Team Rocket's Energy attached",
    { kind: "yourActiveHasNamedEnergyAttached", name: "Team Rocket's Energy" },
  ],
  ["this Pokémon has a Pokémon Tool attached", { kind: "yourActiveHasToolAttached" }],
  [
    "your opponent's Active Pokémon has a Pokémon Tool attached",
    { kind: "opponentActiveHasToolAttached" },
  ],
  // Reads `state.allowances.supporterPlayed`, whose lifetime is the turn.
  [
    "you played a Supporter card from your hand during this turn",
    { kind: "youPlayedSupporterThisTurn" },
  ],
  [
    "this Pokémon moved from your Bench to the Active Spot this turn",
    { kind: "yourActivePromotedThisTurn" },
  ],
  ["this Pokémon was healed during this turn", { kind: "yourActiveHealedThisTurn" }],
  // Literal rows: the evolved-from name is an open vocabulary.
  [
    "this Pokémon evolved from Gimmighoul during this turn",
    { kind: "yourActiveEvolvedFromThisTurn", name: "Gimmighoul" },
  ],
  [
    "this Pokémon evolved from Misty's Staryu during this turn",
    { kind: "yourActiveEvolvedFromThisTurn", name: "Misty's Staryu" },
  ],
  // Also read by `ATTACK_OPPONENT_DISCARDS_HAND_MORE` through `boardConditionForClause`.
  [
    "this Pokémon evolved from Salandit during this turn",
    { kind: "yourActiveEvolvedFromThisTurn", name: "Salandit" },
  ],
  [
    "this Pokémon evolved from Magneton during this turn",
    { kind: "yourActiveEvolvedFromThisTurn", name: "Magneton" },
  ],
  // Literal rows: the attack name is an open vocabulary. A departed Ancient attacker still counts
  // toward the banner row, which reads `GameState.recentAttackers`.
  [
    "1 of your other Ancient Pokémon used an attack during your last turn",
    { kind: "yourOtherBannerPokemonAttackedLastTurn", banner: "Ancient" },
  ],
  [
    "this Pokémon used Form Ranks during your last turn",
    { kind: "yourActiveUsedAttackLastTurn", attack: "Form Ranks" },
  ],
  [
    "this Pokémon used Pervasive Gas during your last turn",
    { kind: "yourActiveUsedAttackLastTurn", attack: "Pervasive Gas" },
  ],
  [
    "this Pokémon used Spiky Rolling during your last turn",
    { kind: "yourActiveUsedAttackLastTurn", attack: "Spiky Rolling" },
  ],
  // `byAttack` matters: a Pokémon Knocked Out by Poison during Checkup does not satisfy "by damage
  // from an attack".
  [
    "any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn",
    { kind: "yourPokemonKoedOnOpponentsLastTurn", byAttack: true },
  ],
  [
    "any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn",
    { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Ethan", byAttack: true },
  ],
  [
    "any of your Hop's Pokémon were Knocked Out by damage from an attack during your opponent's last turn",
    { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Hop", byAttack: true },
  ],
  ["this Pokémon's remaining HP is 50 or less", { kind: "yourActiveRemainingHpAtMost", hp: 50 }],
  ["your opponent's Active Pokémon has no Retreat Cost", { kind: "opponentActiveNoRetreatCost" }],
  [
    "Rosa's Encouragement is in your discard pile",
    { kind: "yourDiscardHasNamed", name: "Rosa's Encouragement" },
  ],
  [
    "you have any Stage 2 {D} Pokémon on your Bench",
    { kind: "yourBenchHasStage2OfType", type: "Darkness" },
  ],
  [
    "your Benched Pokémon have any Shadowy {D} Energy attached",
    { kind: "yourBenchHasNamedEnergyAttached", name: "Shadowy Darkness Energy" },
  ],
  // Literal rows, not a name template: a template would read any name, an Item's included, as a
  // played Supporter.
  [
    'you played a Supporter card that has "Team Rocket" in its name from your hand during this turn',
    { kind: "youPlayedSupporterNamedThisTurn", nameContains: "Team Rocket" },
  ],
  [
    "you played Emma from your hand during this turn",
    { kind: "youPlayedSupporterNamedThisTurn", name: "Emma" },
  ],
  [
    "you played Tarragon from your hand during this turn",
    { kind: "youPlayedSupporterNamedThisTurn", name: "Tarragon" },
  ],
  [
    "you have 4 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile",
    { kind: "yourDiscardPokemonWithAbilityNamedAtLeast", ability: "Hide 'n' Sneak", count: 4 },
  ],
  [
    "you have 6 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile",
    { kind: "yourDiscardPokemonWithAbilityNamedAtLeast", ability: "Hide 'n' Sneak", count: 6 },
  ],
  [
    "you have 13 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile",
    { kind: "yourDiscardPokemonWithAbilityNamedAtLeast", ability: "Hide 'n' Sneak", count: 13 },
  ],
]);

/** "If this Pokémon has any <energy> Energy attached, this attack does N more damage." */
const SELF_ENERGY_ATTACHED_CLAUSE = /^this Pokémon has any (.+) Energy attached$/;

/** "If your opponent's Active Pokémon is a <type> Pokémon, this attack does N more damage." */
const OPPONENT_ACTIVE_TYPE_CLAUSE = /^your opponent['’]s Active Pokémon is a (.+) Pokémon$/;

/** "If you have any <type> Pokémon on your Bench, this attack does N more damage." */
const YOUR_BENCH_TYPE_CLAUSE = /^you have any (.+) Pokémon on your Bench$/;

/** "If your opponent's Active Pokémon has <type> Resistance, this attack does N more damage." */
const OPPONENT_ACTIVE_RESISTANCE_CLAUSE = /^your opponent['’]s Active Pokémon has (.+) Resistance$/;

/** "If your opponent has any <type> Pokémon in play, this attack does N more damage." */
const OPPONENT_IN_PLAY_TYPE_CLAUSE = /^your opponent has any (.+) Pokémon in play$/;

/**
 * The clause between "If " and ", this attack does" as a `BoardCondition`, or null so the sentence
 * stays on the loud ATTACK_EFFECT_SKIPPED path. The literal table is checked before the patterns.
 */
function boardConditionForClause(clause: string): BoardCondition | null {
  const literal = literalClauseRow(CONDITIONAL_DAMAGE_CLAUSES, clause);
  if (literal !== undefined) return literal;
  const selfEnergy = SELF_ENERGY_ATTACHED_CLAUSE.exec(clause);
  if (selfEnergy !== null) {
    const energy = literalClauseRow(CLAUSE_ENERGY_TOKENS, selfEnergy[1] ?? "");
    if (energy !== undefined) return { kind: "yourActiveHasEnergyAttached", energy };
  }
  const activeType = OPPONENT_ACTIVE_TYPE_CLAUSE.exec(clause);
  if (activeType !== null) {
    const type = literalClauseRow(CLAUSE_POKEMON_TYPES, activeType[1] ?? "");
    if (type !== undefined) return { kind: "opponentActiveHasType", type };
  }
  // The patterns are mutually exclusive at their anchors, so their order does not matter.
  const benchType = YOUR_BENCH_TYPE_CLAUSE.exec(clause);
  if (benchType !== null) {
    const type = literalClauseRow(CLAUSE_POKEMON_TYPES, benchType[1] ?? "");
    if (type !== undefined) return { kind: "yourBenchHasType", type };
  }
  const activeResistance = OPPONENT_ACTIVE_RESISTANCE_CLAUSE.exec(clause);
  if (activeResistance !== null) {
    const type = literalClauseRow(CLAUSE_POKEMON_TYPES, activeResistance[1] ?? "");
    if (type !== undefined) return { kind: "opponentActiveHasResistance", type };
  }
  const inPlayType = OPPONENT_IN_PLAY_TYPE_CLAUSE.exec(clause);
  if (inPlayType !== null) {
    const type = literalClauseRow(CLAUSE_POKEMON_TYPES, inPlayType[1] ?? "");
    if (type !== undefined) return { kind: "opponentInPlayHasType", type };
  }
  return null;
}

// "If <clause>, this attack does nothing." The whole attack is cancelled when the clause holds; the
// negation lives in the skeleton, so the table maps each printed negative clause to the positive
// condition required.
const ATTACK_DOES_NOTHING = /^If (.+?), this attack does nothing\.(?: (.+))?$/;

/**
 * The requirement printed second, as on Coalossal — Tar Cannon. Group 1 is the single "This attack
 * does …" sentence, group 2 the clause, group 3 the optional Benched clarifier, which stays with
 * the body.
 */
const ATTACK_DOES_NOTHING_SECOND =
  /^(This attack does [^.]+\.) If (.+?), this attack does nothing\.( \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;

/**
 * Printed negative clauses mapped to the positive board fact the attack requires. A Map so
 * arbitrary printed text cannot reach `Object.prototype`.
 */
const ATTACK_REQUIREMENT_CLAUSES = new Map<string, BoardCondition>([
  // Palafin — Justice Kick. "This Pokémon" on an attack is the attacking Active.
  [
    "this Pokémon didn't move from the Bench to the Active Spot this turn",
    { kind: "yourActivePromotedThisTurn" },
  ],
  // Lycanroc — Finishing Fang. "Before this attack does damage" is satisfied by the site, which
  // checks the condition at declaration.
  [
    "your opponent's Active Pokémon has no damage counters on it before this attack does damage",
    { kind: "opponentActiveDamaged" },
  ],
  // Sawk — Rising Chop.
  ["your opponent's Active Pokémon isn't a Pokémon ex", { kind: "opponentActiveIsEx" }],
  // Iron Boulder — Adjusted Horn.
  [
    "you don't have the same number of cards in your hand as your opponent",
    { kind: "handSizesEqual" },
  ],
  // Hop's Cramorant — Fickle Spitting.
  [
    "your opponent doesn't have exactly 3 or 4 Prize cards remaining",
    { kind: "opponentPrizesRemaining", counts: [3, 4] },
  ],
  // Mesprit — Guardian Burst.
  [
    "you don't have Uxie and Azelf on your Bench",
    {
      kind: "allOf",
      conditions: [
        { kind: "yourBenchHasNamed", name: "Uxie" },
        { kind: "yourBenchHasNamed", name: "Azelf" },
      ],
    },
  ],
  // Victini — V-Force: 4 or fewer Benched means the requirement is at least 5.
  ["you have 4 or fewer Benched Pokémon", { kind: "yourBenchAtLeast", count: 5 }],
  // Centiskorch — Charring Breath.
  ["your opponent's Active Pokémon isn't Burned", { kind: "opponentActiveBurned" }],
  // Fan Rotom — Assault Landing.
  ["there is no Stadium in play", { kind: "stadiumInPlay" }],
  // Alolan Dugtrio — Trio-Cheehoo.
  ["you don't have exactly 3 cards in your hand", { kind: "yourHandExactly", count: 3 }],
  // Medicham — Seventh Kick.
  ["you don't have exactly 7 cards in your hand", { kind: "yourHandExactly", count: 7 }],
  // Vikavolt — Giga Railgun. "Voltaic {L} Energy" is the card name Voltaic Lightning Energy,
  // compared by name.
  [
    "this Pokémon has no Voltaic {L} Energy attached",
    { kind: "yourActiveHasNamedEnergyAttached", name: "Voltaic Lightning Energy" },
  ],
  // Malamar — Brain Crush.
  ["your opponent's Active Pokémon isn't Confused", { kind: "opponentActiveConfused" }],
  // Solrock — Cosmic Beam.
  ["you don't have Lunatone on your Bench", { kind: "yourBenchHasNamed", name: "Lunatone" }],
  // Coalossal — Tar Cannon. Printed as the second sentence, so it is matched by
  // `ATTACK_DOES_NOTHING_SECOND`.
  [
    "you don't have 10 or more Basic {F} Energy cards in your discard pile",
    { kind: "yourBasicEnergyInDiscardAtLeast", energy: "Fighting", count: 10 },
  ],
]);

/**
 * The board fact an attack requires in order to do anything, or null when the text is not a
 * recognised "does nothing" sentence. Returns the positive condition; `attack.ts` cancels when it
 * does not hold.
 */
export function deriveAttackRequirement(text: string): BoardCondition | null {
  const nothing = ATTACK_DOES_NOTHING.exec(text.trim());
  if (nothing === null) {
    const second = ATTACK_DOES_NOTHING_SECOND.exec(text.trim());
    return second === null
      ? null
      : (literalClauseRow(ATTACK_REQUIREMENT_CLAUSES, second[2] ?? "") ?? null);
  }
  return literalClauseRow(ATTACK_REQUIREMENT_CLAUSES, nothing[1] ?? "") ?? null;
}

/**
 * Takes a leading "If <clause>, this attack does nothing." off an attack's text and returns the
 * sentence behind it, or null when the clause is not one this engine can account for.
 */
export function splitAttackRequirementClause(
  text: string,
): { clause: string; body: string } | null {
  const trimmed = text.trim();
  const nothing = ATTACK_DOES_NOTHING.exec(trimmed);
  // Requirement printed second: the body is the sentence before it plus the clarifier after it.
  if (nothing === null) {
    const second = ATTACK_DOES_NOTHING_SECOND.exec(trimmed);
    if (
      second === null ||
      literalClauseRow(ATTACK_REQUIREMENT_CLAUSES, second[2] ?? "") === undefined
    )
      return null;
    return {
      clause: `If ${second[2] ?? ""}, this attack does nothing.`,
      body: `${second[1] ?? ""}${second[3] ?? ""}`,
    };
  }
  const body = (nothing[2] ?? "").trim();
  // A leading sentence with nothing behind it is not a split — the whole string
  // already IS the clause and `deriveAttackRequirement` reads it unchanged. This
  // is the branch every single-sentence printing in the pool takes.
  if (body === "") return null;
  // Without this guard an unrecognised requirement would be stripped and silently ignored.
  if (literalClauseRow(ATTACK_REQUIREMENT_CLAUSES, nothing[1] ?? "") === undefined) return null;
  return { clause: `If ${nothing[1] ?? ""}, this attack does nothing.`, body };
}

// Discarding Basic Energy from hand as an attack cost (§7.5), always printed with a trailing cancel
// and reached behind `splitAttackCancelClause`.
const ENERGY_CODES = Object.keys(ENERGY_TYPE_BY_CODE).join("");

/**
 * The head sentence an anaphoric "If you can't," points back at, mapped to the positive board fact
 * that head's action requires. Keyed on the head because the clause is identical on every printing.
 */
const ATTACK_CANCEL_HEADS = new Map<string, BoardCondition>([
  // Eternatus — World Ender.
  ["Discard a Stadium in play.", { kind: "stadiumInPlay" }],
  // Discard Basic Energy from hand, keyed by count and type.
  [
    "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon.",
    { kind: "yourBasicEnergyInHandAtLeast", energy: "Grass", count: 6 },
  ],
  [
    "Discard 2 Basic {G} Energy cards from your hand.",
    { kind: "yourBasicEnergyInHandAtLeast", energy: "Grass", count: 2 },
  ],
  [
    "Discard a Basic {G} Energy card from your hand.",
    { kind: "yourBasicEnergyInHandAtLeast", energy: "Grass", count: 1 },
  ],
  // Ceruledge — Infernal Slash.
  [
    "Discard 4 Basic {R} Energy cards from your hand.",
    { kind: "yourBasicEnergyInHandAtLeast", energy: "Fire", count: 4 },
  ],
]);

/**
 * `ATTACK_CANCEL_HEADS` as an ordered row list, so a guard can read the table instead of copying
 * it.
 */
export function attackCancelHeadRows(): readonly (readonly [string, BoardCondition])[] {
  return [...ATTACK_CANCEL_HEADS];
}

// Trailing cancel: "If you can't, this attack does nothing." printed after the body, pointing back
// at the sentence in front of it.
const ATTACK_CANCEL_TRAILING =
  /^(.+\.) (If you can['’]t(?: discard \d+ cards in this way)?, this attack does nothing\.)$/;

/**
 * Takes a trailing "If you can't, this attack does nothing." off an attack's text and returns the
 * head sentence it points at, or null when the head is not one this engine can account for.
 */
export function splitAttackCancelClause(text: string): { head: string; clause: string } | null {
  const trimmed = text.trim();
  const cancel = ATTACK_CANCEL_TRAILING.exec(trimmed);
  if (cancel === null) return null;
  const head = (cancel[1] ?? "").trim();
  // A clause with nothing in front of it is not a split, and it is not anaphoric
  // either — there is nothing for the "can't" to point back at. Unreachable
  // through the anchor above (`.+\.` cannot match empty), and spelled anyway so
  // the guard survives a widened head group.
  if (head === "") return null;
  // Keeps an unrecognised cancel loud instead of deleting it.
  if (literalClauseRow(ATTACK_CANCEL_HEADS, head) === undefined) return null;
  return { head, clause: cancel[2] ?? "" };
}

/**
 * The board fact an attack requires, read from a trailing anaphoric cancel, or null to keep the
 * attack on the loud ATTACK_EFFECT_SKIPPED path.
 */
export function deriveAttackCancelRequirement(text: string): BoardCondition | null {
  const split = splitAttackCancelClause(text);
  if (split === null) return null;
  return literalClauseRow(ATTACK_CANCEL_HEADS, split.head) ?? null;
}

// "Your opponent flips a coin for each of their Benched Pokémon. This attack does N damage to your
// opponent's Active Pokémon for each tails." plus the Weakness and Resistance clause.
const ATTACK_OPPONENT_BENCH_TAILS =
  /^Your opponent flips a coin for each of their Benched Pokémon\. This attack does (\d+) damage to your opponent['’]s Active Pokémon for each tails\. This attack['’]s damage isn['’]t affected by Weakness or Resistance\.$/;

/**
 * How many times an attack's printed sentence calls for a coin flip. Only `printed` is known at
 * derivation; the others are counted from the board at resolution.
 */
export type AttackFlipCount =
  | { kind: "printed"; count: number }
  | {
      kind: "attachedEnergy";
      /**
       * `"basic"` is possible because this resolves through `CLAUSE_ENERGY_TOKENS`, but no printing
       * uses it here.
       */
      energy: BasicEnergyType | "special" | "basic" | null;
    }
  | { kind: "pokemonInPlay"; filter: CardFilter }
  | { kind: "bothActivesEnergy" }
  // The opponent's Benched Pokémon.
  | { kind: "opponentBench" }
  | { kind: "untilTails" };

/**
 * `count(face) >= atLeast`: "either of them is heads" is `{ face: "heads", atLeast: 1 }`, "both of
 * them are tails" is `{ face: "tails", atLeast: 2 }`.
 */
export type AttackFlipThreshold = { face: CoinFace; atLeast: number };

/**
 * What the pre-damage coin flip printed on an attack does with its faces; a printing is exactly one
 * of these.
 */
export type AttackCoinFlip =
  | { kind: "bonusOnHeads"; flips: AttackFlipCount; per: number }
  | { kind: "cancelOnTails" }
  // Separate from `cancelOnTails` because the bare cancel carries no payload and this one carries a
  // program.
  | { kind: "cancelOnTailsElseProgram"; ops: EffectOp[] }
  | { kind: "perHeads"; flips: AttackFlipCount; per: number }
  | { kind: "programPerHeads"; flips: AttackFlipCount; ops: EffectOp[]; face: CoinFace }
  // The heads count as the `max` of a discard-pile retrieval; it cannot be fixed in `ops` because
  // heads is unknown until resolution.
  | { kind: "retrievalUpToHeads"; flips: AttackFlipCount; filter: CardFilter; dest: "hand" }
  // Three-tier heads ladder; `flips` is always 3 printed coins.
  | { kind: "bonusLadder"; flips: AttackFlipCount; ladder: readonly [number, number, number] }
  // The opponent takes the flips, and the damage is `per` times the number of tails, replacing the
  // printed base.
  | { kind: "opponentPerTails"; flips: AttackFlipCount; per: number }
  // `bonus` more damage only when every flipped coin is heads, keeping the printed base.
  | { kind: "bonusOnAllHeads"; flips: AttackFlipCount; bonus: number }
  // The heads count as a deck search's `max`: `to: "hand"` searches into hand, `to: "self"`
  // attaches to this Pokémon, each followed by a shuffle. Zero heads appends nothing.
  | { kind: "deckUpToHeads"; flips: AttackFlipCount; filter: CardFilter; to: "hand" | "self" }
  | {
      kind: "perHeadsThenThreshold";
      flips: AttackFlipCount;
      per: number;
      threshold: AttackFlipThreshold;
      ops: EffectOp[];
    };

// "Flip a coin. If heads, this attack does N more damage." and "Flip a coin. If tails, this attack
// does nothing." are one flip taken before the §8.5 damage pipeline, read from either face.
const ATTACK_COIN_BONUS = /^Flip a coin\. If heads, this attack does (\d+) more damage\.$/;

const ATTACK_COIN_CANCEL = /^Flip a coin\. If tails, this attack does nothing\.$/;

// Cancel on tails with a heads consequent on the same flip.
const ATTACK_COIN_CANCEL_THEN_PREVENT =
  /^Flip a coin\. If tails, this attack does nothing\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/;

// "Flip N coins. This attack does D damage for each heads." N flips are announced in order as N
// `ATTACK_EFFECT_COIN_FLIP` events.
const ATTACK_COIN_MULTI = /^Flip (\d+) coins\. This attack does (\d+) damage for each heads\.$/;

// "Flip N coins. This attack does D more damage for each heads."
const ATTACK_COIN_MULTI_BONUS =
  /^Flip (\d+) coins\. This attack does (\d+) more damage for each heads\.$/;

// "Flip N coins. This attack does D damage for each heads. If <threshold>, your opponent's Active
// Pokémon is now <Status>."
const ATTACK_COIN_MULTI_THRESHOLD_STATUS = new RegExp(
  `^Flip (\\d+) coins\\. This attack does (\\d+) damage for each heads\\. If (?:(either|both)|at least (\\d+)) of them (?:is|are) (heads|tails),\\s+your opponent['’]s Active Pokémon is now (${STATUS_WORDS})\\.$`,
);

/**
 * A closed map rather than a capture: "either" and "both" only make sense for two coins, and a
 * capture would accept quantifiers nothing printed.
 */
const FLIP_THRESHOLD_WORDS: Record<string, number> = { either: 1, both: 2 };

// "Flip a coin for each [{X}] Energy attached to this Pokémon. This attack does D damage for each
// heads."
const ATTACK_COIN_PER_ENERGY =
  /^Flip a coin for each (?:(.+) )?Energy attached to this Pokémon\. This attack does (\d+) damage for each heads\.$/;

// "Flip a coin for each Energy attached to both Active Pokémon. This attack does N damage for each
// heads."
const ATTACK_COIN_PER_BOTH_ACTIVES_ENERGY =
  /^Flip a coin for each Energy attached to both Active Pokémon\. This attack does (\d+) damage for each heads\.$/;

// "Flip a coin for each <kind of Pokémon> you have in play. This attack does N damage for each
// heads."
const ATTACK_COIN_PER_BODY_IN_PLAY =
  /^Flip a coin for each ([^.]+) you have in play\. This attack does (\d+) damage for each heads\.$/;

// "Flip a coin until you get tails. This attack does D [more] damage for each heads."
const ATTACK_COIN_UNTIL_TAILS_BONUS =
  /^Flip a coin until you get tails\. This attack does (\d+) more damage for each heads\.$/;

const ATTACK_COIN_UNTIL_TAILS_MULTI =
  /^Flip a coin until you get tails\. This attack does (\d+) damage for each heads\.$/;

// "Flip N coins|a coin until you get tails. For each heads, discard the top M cards of your
// opponent's deck."
const ATTACK_COIN_MILL_PRINTED =
  /^Flip (\d+) coins\. For each heads, discard the top (\d+) cards of your opponent['’]s deck\.$/;

const ATTACK_COIN_MILL_UNTIL_TAILS =
  /^Flip a coin until you get tails\. For each heads, discard the top (\d+) cards of your opponent['’]s deck\.$/;

// Per-heads consequents built from ops `deriveAttackEffect` already emits for the bare sentence.
const ATTACK_COIN_MILL_ONE_PRINTED =
  /^Flip (\d+) coins\. For each heads, discard the top card of your opponent['’]s deck\.$/;

const ATTACK_COIN_HAND_PRINTED =
  /^Flip (\d+) coins\. For each heads, discard a random card from your opponent['’]s hand\.$/;

// "For each heads, discard an Energy from your opponent's Active Pokémon", in both flip counts it
// is printed with.
const ATTACK_COIN_ENERGY_PRINTED =
  /^Flip (\d+) coins\. For each heads, discard an Energy from your opponent['’]s Active Pokémon\.$/;

const ATTACK_COIN_ENERGY_UNTIL_TAILS =
  /^Flip a coin until you get tails\. For each heads, discard an Energy from your opponent['’]s Active Pokémon\.$/;

// "Flip N coins. For each tails, discard an Energy from this Pokémon."
const ATTACK_COIN_SELF_ENERGY_PER_TAILS =
  /^Flip (\d+) coins\. For each tails, discard an Energy from this Pokémon\.$/;

// "Flip N coins. Put a number of cards up to the number of heads from your discard pile into your
// hand." The heads count is the retrieval ceiling.
const ATTACK_COIN_RETRIEVAL_UP_TO_HEADS =
  /^Flip (\d+) coins\. Put a number of cards up to the number of heads from your discard pile into your hand\.$/;

// "Flip N coins. Attach a number of Basic {X} Energy cards up to the number of heads from your
// discard pile to your Benched Pokémon in any way you like."
const ATTACK_COIN_ATTACH_UP_TO_HEADS =
  /^Flip (\d+) coins\. Attach a number of Basic \{([A-Z])\} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like\.$/;

/**
 * Coin sentences read as `programPerHeads` over existing ops. The untyped attach omits
 * `energyType`, as the bare attach sentence does.
 */
const ATTACK_COIN_ATTACH_ANY_UP_TO_HEADS =
  /^Flip (\d+) coins\. Attach an amount of Basic Energy up to the number of heads from your discard pile to your Benched Pokémon in any way you like\.$/;

const ATTACK_COIN_MILL_ONE_UNTIL_TAILS =
  /^Flip a coin until you get tails\. For each heads, discard the top card of your opponent['’]s deck\.$/;

const ATTACK_COIN_HAND_TO_DECK_UNTIL_TAILS =
  /^Flip a coin until you get tails\. For each heads, choose a random card from your opponent['’]s hand\. Your opponent reveals those cards and shuffles them into their deck\.$/;

/**
 * Coin sentences read as `programPerHeads` over existing ops. The named-in-play count takes one
 * capitalised word, so "Pokémon" and class nouns stay on the body-count anchor.
 */
const ATTACK_COIN_MILL_PER_NAMED_IN_PLAY =
  /^Flip a coin for each ([A-Z][a-z]+) you have in play\. For each heads, discard the top (\d+) cards of your opponent['’]s deck\.$/;

const ATTACK_COIN_DECK_ATTACH_PER_HEADS =
  /^Flip (\d+) coins\. For each heads, search your deck for up to (\d+) Basic Energy cards and attach them to your Pokémon in any way you like\. Then, shuffle your deck\.$/;

/** `ATTACK_COIN_BOTH_HEADS_BONUS` pays its bonus only when both coins are heads. */
const ATTACK_COIN_BOTH_HEADS_BONUS =
  /^Flip 2 coins\. If both of them are heads, this attack does (\d+) more damage\.$/;

const ATTACK_COIN_UNTIL_TAILS_DECK_TO_HAND =
  /^Flip a coin until you get tails\. Search your deck for a number of cards up to the number of heads and put them into your hand\. Then, shuffle your deck\.$/;

const ATTACK_COIN_UNTIL_TAILS_DECK_ATTACH_SELF =
  /^Flip a coin until you get tails\. Search your deck for an amount of Basic (?:\{([A-Z])\} )?Energy up to the number of heads and attach it to this Pokémon\. Then, shuffle your deck\.$/;

const ATTACK_COIN_REVEALED_HAND_TO_DECK =
  /^Flip (\d+) coins\. If any of them are heads, your opponent reveals their hand\. For each heads, choose a card you find there and shuffle it into your opponent['’]s deck\.$/;

// "Flip 3 coins. If 1 of them is heads, … 20 more … If 2 …, 50 more … If all …, 80 more damage."
// The payoff is a table rather than per-heads scaling.
const ATTACK_COIN_BONUS_LADDER =
  /^Flip 3 coins\. If 1 of them is heads, this attack does (\d+) more damage\. If 2 of them are heads, this attack does (\d+) more damage\. If all of them are heads, this attack does (\d+) more damage\.$/;

/**
 * Upper bound on printed flip counts; the digits come from ingested third-party text and an
 * unbounded count could spin the resolution loop. Exceeding it refuses the sentence loudly.
 */
const MAX_PRINTED_FLIPS = 10;

/**
 * A printed "Flip N coins" count, or null. The plural "coins" means at least 2 (one coin is printed
 * "Flip a coin." and read by its own anchors), and `MAX_PRINTED_FLIPS` is the ingested-text ceiling.
 */
function printedFlipCount(digits: string | undefined): number | null {
  const n = Number(digits);
  return n >= 2 && n <= MAX_PRINTED_FLIPS ? n : null;
}

function printedFlips(count: number): AttackFlipCount {
  return { kind: "printed", count };
}

/** Until-tails flips need no ceiling: `MAX_UNTIL_TAILS_FLIPS` in the RNG bounds them. */
function untilTails(): AttackFlipCount {
  return { kind: "untilTails" };
}

function programPerHeads(
  flips: AttackFlipCount,
  ops: EffectOp[],
  face: CoinFace = "heads",
): AttackCoinFlip {
  return { kind: "programPerHeads", flips, ops, face };
}

/**
 * The coin flip an attack's printed text calls for, or null when the text is not a recognised whole
 * sentence, keeping the attack on the loud ATTACK_EFFECT_SKIPPED path.
 */
export function deriveAttackCoinFlip(text: string): AttackCoinFlip | null {
  const effect = text.trim();
  const bonus = ATTACK_COIN_BONUS.exec(effect);
  if (bonus !== null) {
    const per = positiveInt(bonus[1]);
    return per !== null ? { kind: "bonusOnHeads", flips: printedFlips(1), per } : null;
  }
  const multi = ATTACK_COIN_MULTI.exec(effect);
  if (multi !== null) {
    const flips = printedFlipCount(multi[1]);
    const per = positiveInt(multi[2]);
    return flips !== null && per !== null
      ? { kind: "perHeads", flips: printedFlips(flips), per }
      : null;
  }
  const multiBonus = ATTACK_COIN_MULTI_BONUS.exec(effect);
  if (multiBonus !== null) {
    const flips = printedFlipCount(multiBonus[1]);
    const per = positiveInt(multiBonus[2]);
    return flips !== null && per !== null
      ? { kind: "bonusOnHeads", flips: printedFlips(flips), per }
      : null;
  }
  // "Flip N coins. If M or more of them are heads, …": the threshold must be between 1 and the flip
  // count, since a threshold of 0 decides nothing and one above the flip count can never be met.
  // The word forms ("either"/"both of them") only apply to 2 coins.
  const multiThreshold = ATTACK_COIN_MULTI_THRESHOLD_STATUS.exec(effect);
  if (multiThreshold !== null) {
    const flips = printedFlipCount(multiThreshold[1]);
    const per = positiveInt(multiThreshold[2]);
    const word = multiThreshold[3];
    // The alternation defines exactly one of the word and digit groups.
    const atLeast = word === undefined ? Number(multiThreshold[4]) : FLIP_THRESHOLD_WORDS[word];
    const face = multiThreshold[5] === "tails" ? "tails" : "heads";
    if (atLeast === undefined) return null;
    return flips !== null &&
      per !== null &&
      atLeast >= 1 &&
      atLeast <= flips &&
      (word === undefined || flips === 2)
      ? {
          kind: "perHeadsThenThreshold",
          flips: printedFlips(flips),
          per,
          threshold: { face, atLeast },
          ops: [{ op: "applyStatus", target: "defender", status: statusOf(multiThreshold[6]) }],
        }
      : null;
  }
  // Board-counted flips (this arm and the next two) need no ceiling.
  const perEnergy = ATTACK_COIN_PER_ENERGY.exec(effect);
  if (perEnergy !== null) {
    const token = perEnergy[1];
    const per = positiveInt(perEnergy[2]);
    // An undefined token is the unfiltered sentence ("for each Energy attached") and resolves to
    // `energy: null`. An unresolvable token must refuse rather than count every attached card, so
    // the two are told apart by the token, not the lookup.
    if (token !== undefined) {
      const energy = literalClauseRow(CLAUSE_ENERGY_TOKENS, token);
      return energy !== undefined && per !== null
        ? { kind: "perHeads", flips: { kind: "attachedEnergy", energy }, per }
        : null;
    }
    return per !== null
      ? { kind: "perHeads", flips: { kind: "attachedEnergy", energy: null }, per }
      : null;
  }
  // Counts Pokémon in play rather than Energy attached. An unresolvable body noun refuses rather
  // than counting zero forever.
  const inPlayBodies = ATTACK_COIN_PER_BODY_IN_PLAY.exec(effect);
  if (inPlayBodies !== null) {
    const per = positiveInt(inPlayBodies[2]);
    const filter = inPlayBodyFilter(inPlayBodies[1] ?? "");
    return filter !== null && per !== null
      ? { kind: "perHeads", flips: { kind: "pokemonInPlay", filter }, per }
      : null;
  }
  const bothActivesFlip = ATTACK_COIN_PER_BOTH_ACTIVES_ENERGY.exec(effect);
  if (bothActivesFlip !== null) {
    const per = positiveInt(bothActivesFlip[1]);
    return per !== null ? { kind: "perHeads", flips: { kind: "bothActivesEnergy" }, per } : null;
  }
  const untilBonus = ATTACK_COIN_UNTIL_TAILS_BONUS.exec(effect);
  if (untilBonus !== null) {
    const per = positiveInt(untilBonus[1]);
    return per !== null ? { kind: "bonusOnHeads", flips: untilTails(), per } : null;
  }
  const untilMulti = ATTACK_COIN_UNTIL_TAILS_MULTI.exec(effect);
  if (untilMulti !== null) {
    const per = positiveInt(untilMulti[1]);
    return per !== null ? { kind: "perHeads", flips: untilTails(), per } : null;
  }
  // The program grows one copy per heads, which is the other reason printed flips are capped.
  const millPrinted = ATTACK_COIN_MILL_PRINTED.exec(effect);
  if (millPrinted !== null) {
    const flips = printedFlipCount(millPrinted[1]);
    const count = positiveInt(millPrinted[2]);
    return flips !== null && count !== null
      ? programPerHeads(printedFlips(flips), [{ op: "discardDeckTop", whose: "opponent", count }])
      : null;
  }
  const millUntil = ATTACK_COIN_MILL_UNTIL_TAILS.exec(effect);
  if (millUntil !== null) {
    const count = positiveInt(millUntil[1]);
    return count !== null
      ? programPerHeads(untilTails(), [{ op: "discardDeckTop", whose: "opponent", count }])
      : null;
  }
  // The singular "discard the top card" form: the count is the article, so the op is built with a
  // literal 1.
  const millOnePrinted = ATTACK_COIN_MILL_ONE_PRINTED.exec(effect);
  if (millOnePrinted !== null) {
    const flips = printedFlipCount(millOnePrinted[1]);
    return flips !== null
      ? programPerHeads(printedFlips(flips), [
          { op: "discardDeckTop", whose: "opponent", count: 1 },
        ])
      : null;
  }
  // The op carries no count; each heads appends one copy, so every discard is an independent random
  // pick from the shrinking hand.
  const handPrinted = ATTACK_COIN_HAND_PRINTED.exec(effect);
  if (handPrinted !== null) {
    const flips = printedFlipCount(handPrinted[1]);
    return flips !== null
      ? programPerHeads(printedFlips(flips), [{ op: "randomFromOpponentHand", to: "discard" }])
      : null;
  }
  const energyPrinted = ATTACK_COIN_ENERGY_PRINTED.exec(effect);
  if (energyPrinted !== null) {
    const flips = printedFlipCount(energyPrinted[1]);
    return flips !== null
      ? programPerHeads(printedFlips(flips), [
          { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
        ])
      : null;
  }
  if (ATTACK_COIN_ENERGY_UNTIL_TAILS.test(effect)) {
    return programPerHeads(untilTails(), [
      { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
    ]);
  }
  // The opponent flips one coin per Benched Pokémon. `deriveAttackDamageSuppression` is gated on
  // this return, so refusing here also refuses the suppression half.
  const opponentBenchTails = ATTACK_OPPONENT_BENCH_TAILS.exec(effect);
  if (opponentBenchTails !== null) {
    const per = positiveInt(opponentBenchTails[1]);
    return per !== null
      ? { kind: "opponentPerTails", flips: { kind: "opponentBench" }, per }
      : null;
  }
  // `face: "tails"` is stated here so the flip site counts tails directly rather than deriving them
  // from heads.
  const selfEnergyTails = ATTACK_COIN_SELF_ENERGY_PER_TAILS.exec(effect);
  if (selfEnergyTails !== null) {
    const flips = printedFlipCount(selfEnergyTails[1]);
    return flips !== null
      ? programPerHeads(
          printedFlips(flips),
          [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
          "tails",
        )
      : null;
  }
  // "Put up to that many cards": one park with `max` set to the heads count at the fold, not one
  // park per heads.
  const upToHeads = ATTACK_COIN_RETRIEVAL_UP_TO_HEADS.exec(effect);
  if (upToHeads !== null) {
    const flips = printedFlipCount(upToHeads[1]);
    if (flips === null) return null;
    return {
      kind: "retrievalUpToHeads",
      flips: printedFlips(flips),
      filter: { kind: "anyCard" },
      dest: "hand",
    };
  }
  // Each heads adds one declinable attach park over the Bench, since "in any way you like"
  // distributes the cards independently. An unmapped Energy code refuses.
  const attachUpToHeads = ATTACK_COIN_ATTACH_UP_TO_HEADS.exec(effect);
  if (attachUpToHeads !== null) {
    const flips = printedFlipCount(attachUpToHeads[1]);
    if (flips === null) return null;
    const attachType = ENERGY_TYPE_BY_CODE[attachUpToHeads[2] ?? ""];
    if (attachType === undefined) return null;
    return programPerHeads(printedFlips(flips), [
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: attachType,
        benchOnly: true,
        declinable: true,
      },
    ]);
  }
  const attachAnyUpToHeads = ATTACK_COIN_ATTACH_ANY_UP_TO_HEADS.exec(effect);
  if (attachAnyUpToHeads !== null) {
    const flips = printedFlipCount(attachAnyUpToHeads[1]);
    if (flips === null) return null;
    return programPerHeads(printedFlips(flips), [
      { op: "attachEnergyFrom", source: "discard", benchOnly: true, declinable: true },
    ]);
  }
  if (ATTACK_COIN_MILL_ONE_UNTIL_TAILS.test(effect)) {
    return programPerHeads(untilTails(), [{ op: "discardDeckTop", whose: "opponent", count: 1 }]);
  }
  if (ATTACK_COIN_HAND_TO_DECK_UNTIL_TAILS.test(effect)) {
    return programPerHeads(untilTails(), [{ op: "randomFromOpponentHand", to: "deck" }]);
  }
  // The board-counted flip count needs no ceiling.
  const millPerNamed = ATTACK_COIN_MILL_PER_NAMED_IN_PLAY.exec(effect);
  if (millPerNamed !== null) {
    const count = positiveInt(millPerNamed[2]);
    if (count === null) return null;
    return programPerHeads(
      { kind: "pokemonInPlay", filter: { kind: "byName", name: millPerNamed[1] ?? "" } },
      [{ op: "discardDeckTop", whose: "opponent", count }],
    );
  }
  const deckAttachPerHeads = ATTACK_COIN_DECK_ATTACH_PER_HEADS.exec(effect);
  if (deckAttachPerHeads !== null) {
    const flips = printedFlipCount(deckAttachPerHeads[1]);
    const max = positiveInt(deckAttachPerHeads[2]);
    if (flips === null || max === null) return null;
    return programPerHeads(printedFlips(flips), [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max },
      { op: "shuffleDeck" },
    ]);
  }
  const bothHeads = ATTACK_COIN_BOTH_HEADS_BONUS.exec(effect);
  if (bothHeads !== null) {
    const bonus = positiveInt(bothHeads[1]);
    return bonus !== null ? { kind: "bonusOnAllHeads", flips: printedFlips(2), bonus } : null;
  }
  if (ATTACK_COIN_UNTIL_TAILS_DECK_TO_HAND.test(effect)) {
    return {
      kind: "deckUpToHeads",
      flips: untilTails(),
      filter: { kind: "anyCard" },
      to: "hand",
    };
  }
  const deckAttachSelf = ATTACK_COIN_UNTIL_TAILS_DECK_ATTACH_SELF.exec(effect);
  if (deckAttachSelf !== null) {
    const code = deckAttachSelf[1];
    if (code === undefined) {
      return {
        kind: "deckUpToHeads",
        flips: untilTails(),
        filter: { kind: "basicEnergy" },
        to: "self",
      };
    }
    const energyType = ENERGY_TYPE_BY_CODE[code];
    if (energyType === undefined) return null;
    return {
      kind: "deckUpToHeads",
      flips: untilTails(),
      filter: { kind: "basicEnergy", energyType },
      to: "self",
    };
  }
  const revealedHandToDeck = ATTACK_COIN_REVEALED_HAND_TO_DECK.exec(effect);
  if (revealedHandToDeck !== null) {
    const flips = printedFlipCount(revealedHandToDeck[1]);
    if (flips === null) return null;
    return programPerHeads(printedFlips(flips), [{ op: "bottomFromOpponentHand", dest: "deck" }]);
  }
  // The coin count is fixed at 3 by the anchor, and the tuple holds the printed tiers in order;
  // `attack.ts` indexes it by `heads - 1`. A zero tier refuses the whole sentence.
  const ladder = ATTACK_COIN_BONUS_LADDER.exec(effect);
  if (ladder !== null) {
    const t1 = positiveInt(ladder[1]);
    const t2 = positiveInt(ladder[2]);
    const t3 = positiveInt(ladder[3]);
    if (t1 === null || t2 === null || t3 === null) return null;
    return { kind: "bonusLadder", flips: printedFlips(3), ladder: [t1, t2, t3] };
  }
  // The bare cancel runs first so that if its `$` were lost, it would claim the compound sentence
  // observably rather than silently.
  if (ATTACK_COIN_CANCEL.test(effect)) return { kind: "cancelOnTails" };
  // The ops match what `FLIP_PREVENT_DAMAGE_AND_EFFECTS` puts in its `coinFlipGate.then`; only the
  // gate differs.
  if (ATTACK_COIN_CANCEL_THEN_PREVENT.test(effect)) {
    return {
      kind: "cancelOnTailsElseProgram",
      ops: [{ op: "preventDamage", effects: true }],
    };
  }
  return null;
}

// Shared self-switch clause. The verb is spelled at each call site because the capital and
// lowercase forms must not be folded into `[Ss]`. The count is literal: a printed 2 would need a
// different op.
const SELF_SWITCH_CLAUSE = "this Pokémon with 1 of your Benched Pokémon\\.";

/**
 * Each `yes` applies the named condition and each `no` asks the next; the last confirm's two
 * buttons are the last two conditions.
 */
function chooseSpecialConditionProgram(): EffectOp[] {
  const words = Object.values(STATUS_WORD_OF);
  const apply = (word: StatusWord): EffectOp[] => [
    { op: "applyStatus", target: "defender", status: STATUS_OF_WORD[word] },
  ];
  const ask = (index: number): EffectOp[] => {
    const word = words[index] as StatusWord;
    const rest = words.slice(index + 1);
    const last = rest.length === 1;
    return [
      {
        op: "optional",
        note: "Choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition.",
        then: apply(word),
        otherwise: last ? apply(rest[0] as StatusWord) : ask(index + 1),
        labels: {
          yes: word,
          no: `${rest.slice(0, -1).join(", ")}${last ? "" : " or "}${rest.at(-1) ?? ""}`,
        },
      },
    ];
  };
  return ask(0);
}

// A printed noun phrase carrying a brace type code, resolved to its filter, or `undefined`
// (including for a code neither map spells, such as "{N} Energy"). `plural` fixes the grammatical
// number, which only the Energy noun marks. The article is optional because some anchors spell it
// outside the noun group.
const TYPED_NOUN = /^(?:a )?(Basic )?\{([A-Z])\} (Pokémon|Energy cards?)$/;

function typedNounFilter(phrase: string, plural: boolean): CardFilter | undefined {
  const match = TYPED_NOUN.exec(phrase);
  if (match === null) return undefined;
  const basic = match[1] !== undefined;
  const code = match[2] ?? "";
  if (match[3] === "Pokémon") {
    const pokemonType = POKEMON_TYPE_BY_CODE[code];
    return pokemonType === undefined
      ? undefined
      : { kind: "typedPokemon", pokemonType, ...(basic ? { stage: "basic" as const } : {}) };
  }
  // "Basic" is required on the Energy noun: an unqualified "{R} Energy card" would be a provision
  // phrase, which no card in a deck matches.
  if (!basic || match[3] !== (plural ? "Energy cards" : "Energy card")) return undefined;
  const energyType = ENERGY_TYPE_BY_CODE[code];
  return energyType === undefined ? undefined : { kind: "basicEnergy", energyType };
}

/**
 * A printed proper name with "cards" ("Fennel cards"), resolved to `byName`, or `undefined`. Face
 * banners are refused because they are not card names, so `byName` would never match.
 */
const NAMED_CARD_NOUN = /^([A-Z][a-zé]+) cards$/;

/** Printed face banners that must not be read as card names. */
const PRINTED_CARD_BANNERS: ReadonlySet<string> = new Set(["Ancient", "Future", "Tera"]);

function namedCardNounFilter(phrase: string): CardFilter | undefined {
  const match = NAMED_CARD_NOUN.exec(phrase);
  if (match === null) return undefined;
  const name = match[1] ?? "";
  return PRINTED_CARD_BANNERS.has(name) ? undefined : { kind: "byName", name, cardNoun: true };
}

/**
 * The same phrases as a regex fragment, per grammatical number and per anchor, since each anchor
 * places the article differently. The article is a literal "a" because no type name starts with a
 * vowel.
 */
const TYPED_NOUN_SINGULAR = "a (?:Basic )?\\{[A-Z]\\} Pokémon|a Basic \\{[A-Z]\\} Energy card";

const TYPED_NOUN_PLURAL = "(?:Basic )?\\{[A-Z]\\} Pokémon|Basic \\{[A-Z]\\} Energy cards";

/** The BENCH anchor's form: no article (the anchor spells it), and no Energy —
    a Bench holds Pokémon, so "Basic {G} Energy card" has no business in a group
    whose every match is benched. The alternative is `stage: "basic"`'s only
    printed witness in the whole catalog, which is why this 0-legal / 1-catalog
    sentence is read rather than deferred: without it the rider would be a field
    no printing drives, and this repo does not ship those. */
const BENCH_TYPED_NOUN = "Basic \\{[A-Z]\\} Pokémon";

const BENCH_SEARCH_NOUN = `(?:(Basic Pokémon)|(${BENCH_TYPED_NOUN})|([A-Z][a-zé]+))`;

const BENCH_SEARCH_TAIL = " onto your Bench\\. Then, shuffle your deck\\.$";

// Printed noun phrases this reader can resolve, singular and plural, with their filters. The
// strings must match `retrieveNoun`'s output in promptText.ts so the search prompt uses the
// printed noun.
const HAND_SEARCH_NOUNS: readonly (readonly [string, string, CardFilter])[] = [
  ["a card", "cards", { kind: "anyCard" }],
  ["a Pokémon", "Pokémon", { kind: "anyPokemon" }],
  ["an Item card", "Item cards", { kind: "item" }],
  ["a Supporter card", "Supporter cards", { kind: "supporter" }],
  ["a Stadium card", "Stadium cards", { kind: "stadium" }],
  ["a Pokémon Tool card", "Pokémon Tool cards", { kind: "toolCard" }],
  ["a Trainer card", "Trainer cards", { kind: "trainerCard" }],
  ["a Basic Energy card", "Basic Energy cards", { kind: "basicEnergy" }],
  ["an Energy card", "Energy cards", { kind: "anyEnergy" }],
];

// Attach from the discard pile. The arm reads destinations beyond the legal pool. `count` pins the
// whole batch onto one chosen body ("up to 2 … to 1 of your Benched Pokémon"), while "in any way
// you like" is separate ops that may land on different bodies.
const MAX_PRINTED_ATTACH_COUNT = 10;

/**
 * Printed destination phrases for the attach family, with their target riders and whether "in any
 * way you like" makes the batch separate decisions. A `Map` so arbitrary printed text cannot hit
 * `Object.prototype`. An unknown phrase yields `undefined` and the effect is skipped.
 */
interface DiscardAttachDestination {
  readonly riders: { toSelf?: true; benchOnly?: true; targetType?: PokemonType };
  readonly anyWay: boolean;
  /**
   * The printed "each of" spread: the attach goes to every eligible body with no choice. Mutually
   * exclusive with `anyWay` and a builder `count`.
   */
  readonly toEach?: true;
}

const DISCARD_ATTACH_DESTINATIONS: ReadonlyMap<string, DiscardAttachDestination> = new Map<
  string,
  DiscardAttachDestination
>([
  // "To this Pokémon" is a UID rider, not a class rider: with two matching bodies a class rider
  // could land on the wrong one.
  ["this Pokémon", { riders: { toSelf: true }, anyWay: false }],
  // Un-narrowed: every own in-play Pokémon. 0 legal, 5 catalog — see the note above.
  ["1 of your Pokémon", { riders: {}, anyWay: false }],
  ["1 of your Benched Pokémon", { riders: { benchOnly: true }, anyWay: false }],
  ["your Pokémon in any way you like", { riders: {}, anyWay: true }],
  ["your Benched Pokémon in any way you like", { riders: { benchOnly: true }, anyWay: true }],
  // The spread prints no number, so the eligible set is the count.
  ["each of your Benched Pokémon", { riders: { benchOnly: true }, anyWay: false, toEach: true }],
  ["each of your Pokémon", { riders: {}, anyWay: false, toEach: true }],
  ...Object.entries(POKEMON_TYPE_BY_CODE).map(
    ([code, type]) =>
      [`1 of your {${code}} Pokémon`, { riders: { targetType: type }, anyWay: false }] as [
        string,
        DiscardAttachDestination,
      ],
  ),
]);

// The source-zone phrase shared by the discard and hand attach anchors.
const SOURCE_ZONE_PHRASE = " from your discard pile";

const HAND_SOURCE_ZONE_PHRASE = " from your hand";

/**
 * Builds the attach clause for a source zone, so the discard, hand and gated anchors share one
 * grammar. Groups: 1 bare-noun marker ("an"), 2 singular brace code, 3 printed count, 4 plural
 * brace code, 5 destination phrase; `tail` groups follow at 6+. The article is welded to the
 * number, and "an Energy card" (unlike "a Basic Energy card") admits Special Energy.
 */
function attachFromZoneClause(zonePhrase: string, tail: string): string {
  return (
    `(?:(an) Energy card|a Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy card` +
    `|up to (\\d+) Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy cards)` +
    `${zonePhrase} to ([^.]+)\\.${tail}`
  );
}

function attachFromZoneAnchor(zonePhrase: string, tail: string): RegExp {
  return new RegExp(`^Attach ${attachFromZoneClause(zonePhrase, tail)}$`);
}

// The printed §9.2 tail of the deck-search attach, already regex-escaped. It is an optional group
// rather than a second anchor because it modifies the same attach, and the gate is a plain
// `recordGate`.
const DECK_SEARCH_POISON_TAIL =
  "If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned\\.";

/**
 * Destination phrases for `attachFromDeck`, kept separate from `DISCARD_ATTACH_DESTINATIONS`
 * because the two ops interpret the phrases differently. `batch: false` means every card lands on
 * one chosen body ("attach them to 1 of your …"). `toSelf` is `batch: true` since it has exactly
 * one body.
 */
interface DeckSearchAttachDestination {
  readonly riders: { toSelf?: true; benchOnly?: true; targetType?: PokemonType };
  readonly batch: boolean;
}

// Optional heal tail on the hand attach: an amount (`all` or a number) and a pronoun. "That
// Pokémon" is the body the attach chose; "this Pokémon" is the attacker and is accepted only when
// the attach targets the attacker. The amount needs no ceiling because the heal is clamped to the
// damage present.
const HAND_ATTACH_HEAL_TAIL = "If you do, heal (?:all|(\\d+)) damage from (that|this) Pokémon\\.";

/**
 * Shared reader for every anchor built from `attachFromZoneClause`. Returns null for an unknown
 * destination or brace code, an out-of-range count, or a heal pronoun that does not refer to the
 * attached body. `heal` is the parsed heal tail and is checked here because it depends on the
 * destination.
 */
function attachFromZoneProgram(
  match: RegExpExecArray,
  source: "hand" | "discard",
  heal?: { amount: number | "all"; pronoun: string },
): EffectOp[] | null {
  const destination = DISCARD_ATTACH_DESTINATIONS.get(match[5] ?? "");
  // Exactly one of the three branches matched, so at most one code group is set.
  const code = match[2] ?? match[4];
  const energyType = code === undefined ? undefined : ENERGY_TYPE_BY_CODE[code];
  // The bare noun "an Energy card" admits any Energy, not only Basic.
  const anyEnergy = match[1] !== undefined;
  // A singular printing emits no `count` (absent means 1) so derived ops compare equal to
  // hand-authored ones.
  const count = match[3] === undefined ? 1 : Number(match[3]);
  if (destination === undefined) return null;
  if (code !== undefined && energyType === undefined) return null;
  // A printed 0 is not a real card and would derive to a silent no-op; the
  // ceiling is the ingested-text guard `MAX_PRINTED_FLIPS` carries one reader
  // over, and it is load-bearing on the `anyWay` branch specifically — that
  // branch grows the PROGRAM one op per printed unit, so an unbounded `\d+`
  // would let one malformed third-party row build an arbitrarily long program.
  // Applied to every branch so the three anchors cannot disagree about what
  // counts as a printed number.
  if (count < 1 || count > MAX_PRINTED_ATTACH_COUNT) return null;
  // A heal names one body, so it is refused on a multi-op distribution, and "this Pokémon" must
  // refer to the attach target (`toSelf`).
  if (heal !== undefined && destination.anyWay && count > 1) return null;
  if (heal !== undefined && heal.pronoun === "this" && destination.riders.toSelf !== true) {
    return null;
  }
  // "Up to N … to each of them" is ambiguous in print, and a heal tail has no single referent on a
  // spread, so both are refused.
  if (destination.toEach === true && count > 1) return null;
  if (destination.toEach === true && heal !== undefined) return null;
  const base: OpOf<"attachEnergyFrom"> = {
    op: "attachEnergyFrom",
    source,
    ...(energyType === undefined ? {} : { energyType }),
    ...(anyEnergy ? { anyEnergy: true as const } : {}),
    ...destination.riders,
    ...(destination.toEach === true ? { toEach: true as const } : {}),
    ...(heal === undefined ? {} : { healTarget: heal.amount }),
  };
  // "In any way you like" emits one op per card, each choosing its own target; otherwise one op
  // whose `count` pins the batch to one body. A printed "up to" (read from `match[3]`, not the
  // derived count) makes each op declinable.
  return destination.anyWay
    ? Array.from({ length: count }, () => ({
        ...base,
        ...(match[3] === undefined ? {} : { declinable: true as const }),
      }))
    : [count === 1 ? base : { ...base, count }];
}

/**
 * Noun alternations built from `HAND_SEARCH_NOUNS`. Table phrases come first so "Pokémon" resolves
 * to `anyPokemon` rather than a proper name, and the brace-coded fragment is appended after them.
 */
const RETRIEVAL_SINGULAR_ALT = `${HAND_SEARCH_NOUNS.map(([one]) => one).join("|")}|${TYPED_NOUN_SINGULAR}`;

const RETRIEVAL_PLURAL_ALT = `${HAND_SEARCH_NOUNS.map(([, many]) => many).join("|")}|${TYPED_NOUN_PLURAL}`;

/**
 * Shared program for the attack and Supporter printings of this sentence. `shuffleDeck` leads
 * despite the printed order because the search answer is a set of cards, so shuffling before or
 * after removing them is equivalent. `reorderTop` is a separate op because the order is a second
 * decision.
 */
export function searchTopOrderProgram(n: number): EffectOp[] {
  return [
    { op: "shuffleDeck" },
    {
      op: "searchDeck",
      // The printed noun is plain "cards", so any card is a legal find.
      filter: { kind: "anyCard" },
      max: n,
      // Without `exact`, a short pick would let the next op reorder cards that were never searched.
      exact: true,
      dest: "deckTop",
    },
    // The reorder window is exactly what the search placed.
    { op: "reorderTop", n },
  ];
}

/**
 * Rewrites Mega Evolution wording variants to the equivalent Scarlet & Violet wording so the
 * existing anchors read them. Each pattern is anchored so it cannot change an `sv` sentence.
 */
const ME_WORDING_SYNONYMS: readonly (readonly [RegExp, string])[] = [
  // "Place … damage counters on" becomes "Put …". Only the capitalised form also takes the singular
  // "counter".
  [/\bPlace (?=(?:\d+ )?damage counters? on )/g, "Put "],
  [/\bplace (?=(?:\d+ )?damage counters on )/g, "put "],
  // Claw of Darkness ×3: ", and you discard a card you find there." → ". Discard a card …".
  [
    /(?<=^Your opponent reveals their hand), and you discard a card you find there\.$/,
    ". Discard a card you find there.",
  ],
  // Astonish: ", and your opponent reveals that card …" → ". Your opponent reveals that card …".
  [
    /(?<=^Choose a random card from your opponent['’]s hand), and your opponent reveals that card and shuffles it into their deck\.$/,
    ". Your opponent reveals that card and shuffles it into their deck.",
  ],
  // Thunder (Miraidon): "This Pokémon does N damage to itself." → "This Pokémon also does …".
  [/^This Pokémon does (?=\d+ damage to itself\.$)/, "This Pokémon also does "],
  // Power Rush (Eternatus): the coin-flipped "can't use attacks." → "can't attack."
  [
    /(?<=^Flip a coin\. If tails, during your next turn, )this Pokémon can['’]t use attacks\.$/,
    "this Pokémon can't attack.",
  ],
];

export function normaliseMeWording(text: string): string {
  let out = text;
  for (const [pattern, synonym] of ME_WORDING_SYNONYMS) out = out.replace(pattern, synonym);
  return out;
}

const DEFENDER_NOW = new RegExp(`^Your opponent['’]s Active Pokémon is now (${STATUS_WORDS})\\.$`);

const FLIP_DEFENDER_NOW = new RegExp(
  `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${STATUS_WORDS})\\.$`,
);

// Two statuses on the defender, plus the coin-flipped form. Collisions between the two words are
// refused by `defenderStatusOps`, not by the regex.
const DEFENDER_STATUS_PAIR = new RegExp(
  `^Your opponent['’]s Active Pokémon is now (${STATUS_WORDS}) and (${STATUS_WORDS})\\.$`,
);

const FLIP_DEFENDER_STATUS_PAIR = new RegExp(
  `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${STATUS_WORDS}) and (${STATUS_WORDS})\\.$`,
);

// "Flip a coin. If heads, ... is now X and Y. If tails, ... is now Z." The arms are exclusive, so
// only the heads list is checked for slot collisions.
const FLIP_DEFENDER_PAIR_OR_TAILS_STATUS = new RegExp(
  `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${STATUS_WORDS}) and (${STATUS_WORDS})\\. If tails, your opponent['’]s Active Pokémon is now (${STATUS_WORDS})\\.$`,
);

// Three statuses in an Oxford list. The slots stay open so `defenderStatusOps` can still refuse
// colliding words.
const DEFENDER_STATUS_TRIPLE = new RegExp(
  `^Your opponent['’]s Active Pokémon is now (${STATUS_WORDS}), (${STATUS_WORDS}), and (${STATUS_WORDS})\\.$`,
);

// Flip-gated status that also discards an Energy from the opponent's Active; "that Pokémon" is the
// opponent's Active.
const FLIP_DEFENDER_STATUS_THEN_DISCARD = new RegExp(
  `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${STATUS_WORDS}), and discard an Energy from that Pokémon\\.$`,
);

// "If your opponent's Active Pokémon is a ... Pokémon, it is now X." The subject is spelled out
// because "it" must refer to the opponent's Active for a defender status to be correct.
const CLAUSE_GATED_DEFENDER_NOW = new RegExp(
  `^If (your opponent['’]s Active Pokémon is a .+ Pokémon), it is now (${STATUS_WORDS})\\.$`,
);

const SELF_NOW = new RegExp(`^This Pokémon is now (${SELF_STATUS_WORDS})\\.$`);

const SELF_SLEEP_HEAL = /^This Pokémon is now Asleep\. Heal (\d+) damage from it\.$/;

// "Heal N damage from this Pokémon." No /i: the capital first word plus `^...$` keeps mid-sentence
// heals off this path.
const SELF_HEAL = /^Heal (\d+) damage from this Pokémon\.$/;

// "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."
const SELF_HEAL_DEALT =
  /^Heal from this Pokémon the same amount of damage you did to your opponent['’]s Active Pokémon\.$/;

// "Heal N damage from each of your Pokémon." This includes the Active.
const OWN_BOARD_HEAL = /^Heal (\d+) damage from each of your Pokémon\.$/;

// "Heal N damage from each of your <adjective> Pokémon." The adjective is read through
// `OWN_BOARD_HEAL_NOUNS`, so an unknown one stays unbuilt rather than healing everything.
// `(?!opponent)` keeps an opponent-side heal from being read as own-side.
const OWN_BOARD_HEAL_NARROWED =
  /^Heal (\d+) damage from each of your ((?!opponent)[^.]+) Pokémon\.$/;

/**
 * Printed adjectives accepted by `OWN_BOARD_HEAL_NARROWED`. `Basic` narrows by card and `Benched`
 * by board position, so they set different fields.
 */
const OWN_BOARD_HEAL_NOUNS: ReadonlyMap<string, HealEachScope> = new Map<string, HealEachScope>([
  ["Basic", { basicOnly: true }],
  ["Benched", { benchOnly: true }],
]);

// "Heal N (or all) damage from 1 of your [Benched] Pokémon."
const CHOSEN_HEAL = /^Heal (\d+|all) damage from 1 of your (Benched )?Pokémon\.$/;

// Flip-gated self-heal. Each flip-gated consequent gets its own literal regex because the
// consequent is open-ended.
const FLIP_SELF_HEAL = /^Flip a coin\. If heads, heal (\d+) damage from this Pokémon\.$/;

// Only the singular, opponent-side mill is printed in gated form.
const FLIP_DECK_TOP_MILL =
  /^Flip a coin\. If heads, discard the top card of your opponent['’]s deck\.$/;

// Flip-gated prevent. "From and effects of attacks" and "damage ... by attacks" are different
// readings, carried by the op's `effects` field.
const FLIP_PREVENT_DAMAGE_AND_EFFECTS =
  /^Flip a coin\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/;

const FLIP_PREVENT_DAMAGE =
  /^Flip a coin\. If heads, during your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks\.$/;

// "Prevent all damage ... by attacks from Basic [non-{X}] Pokémon." The optional excluded type is a
// single code letter read through `POKEMON_TYPE_BY_CODE`; an unknown letter stays unbuilt.
const PREVENT_DAMAGE_FROM_CLASS =
  /^During your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks from Basic (?:non-\{([A-Z])\} )?Pokémon\.$/;

// Iron Moth "Anachronism Repulsor".
const PREVENT_DAMAGE_FROM_ANCIENT =
  /^During your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon\.$/;

// Miraidon "C.O.D.E.: Protect": a side-wide block over the controller's Future Pokémon.
const PREVENT_DAMAGE_FUTURE_SIDE_FROM_EX =
  /^During your opponent['’]s next turn, prevent all damage done to each of your Future Pokémon by attacks from Pokémon ex\. If this Pokémon is no longer your Active Pokémon, this effect ends\.$/;

// Glimmora "Corrosive Shards".
const POISON_AND_BAR_HAND_ATTACH =
  /^Your opponent['’]s Active Pokémon is now Poisoned\. During your opponent['’]s next turn, Energy cards can['’]t be attached from your opponent['’]s hand to that Pokémon\.$/;

// Hypno "Daydream".
const HAND_ATTACH_ENDS_TURN =
  /^During your opponent['’]s next turn, if they attach an Energy card from their hand to the Defending Pokémon, their turn ends\.$/;

// Trevenant "Cursed Roots".
const BAR_HAND_ATTACH_DEFENDER =
  /^During your opponent['’]s next turn, Energy can['’]t be attached from your opponent['’]s hand to the Defending Pokémon\.$/;

// Pachirisu "Electrified Incisors". The printed "place" is normalised to "put", so the anchor
// spells "put".
const HAND_ATTACH_COUNTERS =
  /^During your opponent['’]s next turn, whenever they attach an Energy card from their hand to the Defending Pokémon, put (\d+) damage counters on that Pokémon\.$/;

// Octillery "Jet of Ink".
const DEFENDER_TWO_COIN_ATTACK_LOCK =
  /^During your opponent['’]s next turn, if the Defending Pokémon tries to use an attack, your opponent flips 2 coins\. If either of them is tails, that attack doesn['’]t happen\.$/;

const TRAINER_PLAY_FLIP_LOCK =
  /^During your opponent['’]s next turn, whenever they try to use a Trainer card from their hand, they flip a coin\. If tails, your opponent discards that Trainer card instead of using it\.$/;

const DISCARD_OPPONENT_STADIUM_AND_BAR =
  /^If your opponent has a Stadium in play, discard it\. If you do, your opponent can['’]t play any Stadium cards from their hand during their next turn\.$/;

const LOOK_AT_OPPONENT_PRIZE = /^Look at 1 of your opponent['’]s face-down Prize cards\.$/;

const WIN_AT_ONE_PRIZE =
  /^If you use this attack when you have exactly 1 Prize card remaining, you win this game\.$/;

const PREVENT_DAMAGE_FROM_CLASS_D630 =
  /^During your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks from (Burned Pokémon|Evolution Pokémon|Pokémon that have an Ability)\.$/;

//   • Bronzong `me05-064` "Metal Block" (index 1) — arm 19d's `reduceDamage` with the NEW optional
//     `fromClass` (`DamageReduction.fromClass`); the class noun is a closed capture of one member.
const SELF_DAMAGE_REDUCTION_FROM_EVOLUTION =
  /^During your opponent['’]s next turn, this Pokémon takes (\d+) less damage from attacks from Evolution Pokémon \(after applying Weakness and Resistance\)\.$/;

const SELF_VULNERABLE_NEXT_TURN =
  /^During your opponent['’]s next turn, this Pokémon takes (\d+) more damage from attacks \(after applying Weakness and Resistance\)\.$/;

/**
 * Maps the printed class noun to the `AttackerClass` it names. A noun missing from the map derives
 * nothing.
 */
const ATTACKER_CLASS_BY_NOUN_D630: Readonly<Record<string, AttackerClass>> = {
  "Burned Pokémon": { stage: "burned" },
  "Evolution Pokémon": { stage: "evolution" },
  "Pokémon that have an Ability": { stage: "hasAbility" },
};

// The comparator is captured so that the arm can refuse "or more", which is a different mechanism.
const PREVENT_DAMAGE_UP_TO_CAP =
  /^During your opponent['’]s next turn, prevent all damage done to this Pokémon by attacks if that damage is (\d+) or (less|more)\.$/;

// The parenthetical is part of the rule: the reduction applies after Weakness and Resistance (§8).
// The "before" wording is a different mechanism, a debuff on the attacker.
const SELF_DAMAGE_REDUCTION =
  /^During your opponent['’]s next turn, this Pokémon takes (\d+) less damage from attacks \(after applying Weakness and Resistance\)\.$/;

// The compound is anchored as one sentence so that the discard cost never derives without the
// protection it pays for.
const SELF_NO_WEAKNESS = /^During your opponent['’]s next turn, this Pokémon has no Weakness\.$/;

const SELF_DISCARD_ALL_THEN_REDUCTION =
  /^Discard all Energy from this Pokémon\. During your opponent['’]s next turn, this Pokémon takes (\d+) less damage from attacks \(after applying Weakness and Resistance\)\.$/;

// "Before applying Weakness and Resistance" makes this a debuff on the Defending Pokémon's attacks,
// not a reduction on this Pokémon.
const DEFENDER_ATTACKS_WEAKENED =
  /^During your opponent['’]s next turn, the Defending Pokémon['’]s attacks do (\d+) less damage \(before applying Weakness and Resistance\)\.$/;

const ATTACKS_BY_DEFENDER_WEAKENED =
  /^During your opponent['’]s next turn, attacks used by the Defending Pokémon do (\d+) less damage \(before applying Weakness and Resistance\)\.$/;

const DEFENDER_VULNERABLE_NEXT_TURN =
  /^During your next turn, the Defending Pokémon takes (\d+) more damage from attacks \(after applying Weakness and Resistance\)\.$/;

// The reminder parenthetical is required because it states the amount-unchanged rule that the op
// implements.
const DEFENDER_WEAKNESS_RETYPED =
  /^Until the end of your next turn, the Defending Pokémon['’]s Weakness is now \{C\}\. \(The amount of Weakness doesn['’]t change\.\)$/;

const HAND_EXACTLY_TAKE_PRIZES_THEN_SHUFFLE =
  /^If you have exactly 30 cards in your hand, take 2 Prize cards\. If you do, shuffle your hand into your deck\.$/;

const DEFENDER_WEAKNESS_OVERWRITTEN =
  /^The Defending Pokémon['’]s Weakness is now \{L\} until the end of your next turn\. \(Apply Weakness as ×2\.\)$/;

const DEFENDER_KO_BOUNTY_NEXT_TURN =
  /^During your next turn, if the Defending Pokémon is Knocked Out, take (\d+) more Prize cards\.$/;

// The capture counts damage counters, and the arm converts it to HP (x10). The "even if Knocked
// Out" parenthetical restates that recoil runs before the Knock Out sweep.
const SELF_INSTALLED_RECOIL =
  /^During your opponent['’]s next turn, if this Pokémon is damaged by an attack \(even if (?:it|this Pokémon) is Knocked Out\), put (\d+) damage counters on the Attacking Pokémon\.$/;

// The amount is the damage done to this Pokémon, so there is no capture.
const SELF_INSTALLED_RECOIL_TAKEN =
  /^During your opponent['’]s next turn, if this Pokémon is damaged by an attack \(even if (?:it|this Pokémon) is Knocked Out\), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon\.$/;

// The optional capture is an owner prefix such as "Team Rocket's". The `é` in "Pokémon" falls
// outside `[A-Za-z]`, so the plain sentence never matches the group.
const COUNTER_MOVE_TO_DEFENDER =
  /^Move all damage counters from 1 of your Benched (?:([A-Z][A-Za-z ]*)['’]s )?Pokémon to your opponent['’]s Active Pokémon\.$/;

const COUNTER_MOVE_TO_CHOSEN =
  /^Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent['’]s Pokémon\.$/;

// Both ends are on the opponent's board, so these derive `moveCountersOpponentAnyWay`, not
// `moveCountersChosen`.
const COUNTER_MOVE_OPPONENT_BENCH_TO_ACTIVE =
  /^You may move any number of damage counters from your opponent['’]s Benched Pokémon to their Active Pokémon\.$/;

const COUNTER_MOVE_OPPONENT_ANY_WAY =
  /^You may move any number of damage counters from your opponent['’]s Pokémon to their other Pokémon in any way you like\.$/;

const COUNTER_PUT_ON_DEFENDER =
  /^Put (?:(\d+) damage counters|(1) damage counter) on your opponent['’]s Active Pokémon\.$/;

const COUNTER_PUT_ON_DEFENDER_PER_HAND_CARD =
  /^Put (\d+) damage counters on your opponent['’]s Active Pokémon for each card in your hand\.$/;

const COUNTER_PUT_ON_OPPONENT_BENCH =
  /^Put (\d+) damage counters on 1 of your opponent['’]s Benched Pokémon\.$/;

// N printed counters become N independent picks. This matches simultaneous placement because
// targets are not HP-filtered and Knock Outs are swept only after the attack. Without "Benched",
// any of the opponent's Pokémon can be picked.
const COUNTER_SPREAD_ON_OPPONENT =
  /^Put (\d+) damage counters on your opponent['’]s (Benched )?Pokémon in any way you like\.$/;

// The `$` matters: this sentence is a strict prefix of the scaled and self-lock compound sentences.
const COUNTER_PUT_ON_OPPONENT_ANY =
  /^Put (?:(\d+) damage counters|(1) damage counter) on 1 of your opponent['’]s Pokémon\.$/;

// Group 1 is how many Pokémon are chosen; group 2 is the number of counters placed on each.
const COUNTER_PUT_ON_CHOSEN_OPPONENTS =
  /^Choose (\d+) of your opponent['’]s Pokémon and put (\d+) damage counters on each of them\.$/;

// One filter both counts the discard pile and selects the cards to shuffle back. The noun must
// resolve to basic Energy because the tail says "those Energy cards".
const COUNTER_PUT_SCALED_BY_PILE =
  /^Put (\d+) damage counters on 1 of your opponent['’]s Pokémon for each (.+) in your discard pile\. Then, shuffle those Energy cards into your deck\.$/;

// There is no pick: the board decides which Pokémon are hit (`counterEachAll`).
const COUNTER_FOLD_ON_ABILITY_BODIES =
  /^Put (\d+) damage counters on each Pokémon that has an Ability \(both yours and your opponent['’]s\)\.$/;

const COUNTER_FOLD_ON_OPPONENT_ALL =
  /^Put (\d+) damage counters on each of your opponent['’]s Pokémon\.$/;

const COUNTER_FOLD_ON_OPPONENT_DAMAGED =
  /^Put (\d+) damage counters on each of your opponent['’]s Pokémon that has any damage counters on it\.$/;

// The captured number is HP as printed and is not multiplied by 10. These are two anchors because
// the determiner and the zone word vary together.
const COUNTER_UNTIL_REMAINING_HP_ACTIVE =
  /^Put damage counters on your opponent['’]s Active Pokémon until its remaining HP is (\d+)\.$/;

const COUNTER_UNTIL_REMAINING_HP_BENCH =
  /^Put damage counters on each of your opponent['’]s Benched Pokémon until its remaining HP is (\d+)\.$/;

const SELF_CANT_ATTACK_NEXT_TURN = /^During your next turn, this Pokémon can['’]t attack\.$/;

// The reminder parenthetical is required. It is why the lock is a side record that also covers
// Pokémon entering play later.
const SIDE_CANT_ATTACK_NEXT_TURN =
  /^During your next turn, your Pokémon can['’]t attack\. \(This includes new Pokémon that come into play\.\)$/;

const OPPONENT_LOW_ENERGY_CANT_ATTACK =
  /^During your opponent['’]s next turn, Pokémon that have (\d+) or less Energy attached can['’]t attack\. \(This includes new Pokémon that come into play\.\)$/;

// Both sentences are in one anchor so that the drawback can never be dropped.
const COUNTER_PUT_ANY_THEN_SELF_LOCK =
  /^Put (\d+) damage counters on 1 of your opponent['’]s Pokémon\. During your next turn, this Pokémon can['’]t attack\.$/;

const FLIP_TAILS_SELF_CANT_ATTACK =
  /^Flip a coin\. If tails, during your next turn, this Pokémon can['’]t attack\.$/;

// The name must start with a capital so that the plural "attacks" falls through to
// `SELF_CANT_USE_ATTACKS`. The name is resolved against the holder's printed attacks at install,
// and nothing is installed if it matches none.
const SELF_CANT_USE_ATTACK = /^During your next turn, this Pokémon can['’]t use ([A-Z].+?)\.$/;

const SELF_CANT_USE_ATTACKS = /^During your next turn, this Pokémon can['’]t use attacks\.$/;

const SELF_CANT_USE_NAMED_UNTIL_LEAVES_ACTIVE =
  /^This Pokémon can['’]t use Blaze Blitz again until it leaves the Active Spot\.$/;

// The name is resolved against the holder's printed attacks at install, and nothing is installed if
// it matches none.
const SELF_ATTACK_BOOST =
  /^During your next turn, this Pokémon['’]s (.+?) attack does (\d+) more damage \(before applying Weakness and Resistance\)\.$/;

// Replaces the attack's base damage rather than adding to it.
const SELF_ATTACK_BASE_SET =
  /^During your next turn, this Pokémon['’]s (.+?) attack['’]s base damage is (\d+)\.$/;

// The optional prefix derives Asleep on the defender first, then on this Pokémon.
const SELF_EVERY_ATTACK_BOOST =
  /^(Both Active Pokémon are now Asleep\. )?During your next turn, attacks used by this Pokémon do (\d+) more damage to your opponent['’]s Active Pokémon \(before applying Weakness and Resistance\)\.$/;

// There is no capture because "that attack" is chosen by the player through a prompt.
const OPPONENT_CHOSEN_ATTACK_LOCK =
  /^Choose 1 of your opponent['’]s Active Pokémon['’]s attacks\. During your opponent['’]s next turn, that Pokémon can['’]t use that attack\.$/;

const SELF_DISCARD_ONE_THEN_DEFENDER_LOCK =
  /^Discard an Energy from this Pokémon\. During your opponent['’]s next turn, the Defending Pokémon can['’]t attack\.$/;

const DEFENDER_BASIC_CANT_ATTACK =
  /^If the Defending Pokémon is a Basic Pokémon, it can['’]t attack during your opponent['’]s next turn\.$/;

const DEFENDER_CANT_ATTACK_NEXT_TURN =
  /^During your opponent['’]s next turn, the Defending Pokémon can['’]t (?:attack|use attacks)\.$/;

const FLIP_HEADS_DEFENDER_CANT_ATTACK =
  /^Flip a coin\. If heads, during your opponent['’]s next turn, the Defending Pokémon can['’]t attack\.$/;

// The opponent flips on their own turn when declaring an attack, so this is a durated install, not
// a `coinFlipGate`.
const DEFENDER_FLIP_ATTACK_LOCK =
  /^During your opponent['’]s next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin\. If tails, that attack doesn['’]t happen\.$/;

const DEFENDER_COSTS_TAXED =
  /^During your opponent['’]s next turn, attacks used by the Defending Pokémon cost \{C\} more, and its Retreat Cost is \{C\} more\.$/;

const FLIP_TAILS_SELF_DISCARD_ALL =
  /^Flip a coin\. If tails, discard all Energy from this Pokémon\.$/;

const FLIP_TAILS_SELF_DAMAGE =
  /^Flip a coin\. If tails, this Pokémon also does (\d+) damage to itself\.$/;

const FLIP_TWO_BOTH_TAILS_SELF_DAMAGE =
  /^Flip 2 coins\. If both of them are tails, this Pokémon also does (\d+) damage to itself\.$/;

const DEFENDER_POISON_N =
  /^Your opponent['’]s Active Pokémon is now Poisoned\. During Pokémon Checkup, put (\d+) damage counters on that Pokémon instead of 1\.$/;

// Anchored whole because the tail refers back to the head ("that Pokémon", "this Special
// Condition"). Composed as a tail, it could attach to any status head.
const DEFENDER_CONFUSION_N =
  /^Your opponent['’]s Active Pokémon is now Confused\. Put (\d+) damage counters instead of 3 on that Pokémon for this Special Condition\.$/;

// The Poison compound has its own anchor so that matching only the lock clause never drops the
// Poison. "that Pokémon" is only printed after a clause naming the opponent's Active Pokémon, so it
// is read as the Defending Pokémon; that form is reached through `splitAttackTrailingClause`.
const DEFENDER_CANT_RETREAT =
  /^During your opponent['’]s next turn, (?:the Defending|that) Pokémon can['’]t retreat\.$/;

const DEFENDER_POISON_CANT_RETREAT =
  /^Your opponent['’]s Active Pokémon is now Poisoned\. During your opponent['’]s next turn, that Pokémon can['’]t retreat\.$/;

// Only printed as the tail of a heal compound. It is kept bare so that `splitAttackTrailingClause`
// composes it after `SELF_HEAL`.
const SELF_CANT_RETREAT = /^During your next turn, this Pokémon can['’]t retreat\.$/;

const DELAYED_DEFENDER_COUNTERS =
  /^At the end of your opponent['’]s next turn, put (\d+) damage counters on the Defending Pokémon\.$/;

// A discard, not a Knock Out, so no Prize is taken (§8.1).
const DELAYED_DEFENDER_DISCARD =
  /^At the end of your opponent['’]s next turn, discard the Defending Pokémon and all attached cards\.$/;

// Only printed as a tail. It is kept bare so that `splitAttackTrailingClause` composes it after the
// claimed head.
const DELAYED_DEFENDER_KO =
  /^At the end of your opponent['’]s next turn, the Defending Pokémon will be Knocked Out\.$/;

// The class alternation is closed so that other hand-play bars stay unread.
const OPPONENT_CANT_PLAY =
  /^During your opponent['’]s next turn, they can['’]t play any (Item|Supporter) cards from their hand\.$/;

const OPPONENT_CANT_PLAY_TRAILING =
  /^Your opponent can['’]t play any (Item|Supporter) cards from their hand during their next turn\.$/;

// The COMPOUND, and it is `SELF_DISCARD_ALL_THEN_REDUCTION`'s exact twin one
// family over: the same printed cost, the same `^…$` mutual exclusion against
// arm 9's bare `SELF_DISCARD_ALL`, and the same reason for existing at all —
// matching the lock clause alone would silently swallow the discard, which is
// `DEFENDER_POISON_CANT_RETREAT`'s stated ground two lines up.
const SELF_DISCARD_ALL_THEN_HAND_LOCK =
  /^Discard all Energy from this Pokémon\. During your opponent['’]s next turn, they can['’]t play any (Item|Supporter) cards from their hand\.$/;

const OPPONENT_CANT_EVOLVE_FROM_HAND =
  /^During your opponent['’]s next turn, they can['’]t play any Pokémon from their hand to evolve their Pokémon\.$/;

const SELF_RECOVERS_ALL = /^This Pokémon recovers from all Special Conditions\.$/;

// The optional "also" is only emphasis: the main hit rides the attack's `damage` field. The
// Weakness/Resistance parenthetical is optional because §8.5 makes it true regardless.
const SPREAD_EACH_BENCH = new RegExp(
  `^This attack (?:also )?does (\\d+) damage to each of (your opponent['’]s|your) Benched Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

// A separate anchor, so that plain bench spreads are never given a per-Prize scale.
const SPREAD_EACH_BENCH_TAKEN_PRIZES = new RegExp(
  `^This attack (?:also )?does (\\d+) damage to each of your opponent['’]s Benched Pokémon ` +
    "for each Prize card your opponent has taken\\." +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

// Both benches are hit by two `spreadDamage` ops, your bench first in printed order. The order is
// observable because each hit can draw shield coins.
const SPREAD_EACH_BOTH_BENCH = new RegExp(
  "^This attack (?:also )?does (\\d+) damage to each Benched Pokémon" +
    "( that has any damage counters on it)?" +
    ` \\(both yours and your opponent['’]s\\)\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

// "This attack does N damage to each Pokémon that has any damage counters on it (both yours and
// your opponent's), except for this Pokémon." Built as a gated `damageDefender` on the opponent's
// Active (W/R applied) followed by `damagedOnly` spreads on your Bench then the opponent's Bench;
// the attacker is excluded because no op names its spot. The order Active, own Bench, opponent
// Bench is observable in the log and in shield coin draws. The gate reads the board before this
// attack's hit, so the printing must have no base damage.
const SPREAD_EACH_DAMAGED_FOUR_ZONE = new RegExp(
  "^This attack does (\\d+) damage to each Pokémon that has any damage counters on it" +
    ` \\(both yours and your opponent['’]s\\), except for this Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

// "This attack does N damage to each of your opponent's Pokémon." The Active takes W/R through
// `damageDefender` and the Bench takes flat `spreadDamage`, so the sentence is a two-op program. No
// "also" form is admitted: emitting `damageDefender` replaces the printed base damage, so an "also"
// wording would silently drop the main hit.
const SPREAD_EACH_OPPONENT_POKEMON = new RegExp(
  `^This attack does (\\d+) damage to each of your opponent['’]s Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

// The CHOSEN-single benched hit SCALED by the opponent's taken Prizes — Wo-Chien
// ex sv02-027 "Covetous Ivy". The "×"/multiply sibling of the Prize-count family
// (Pecharunt ex, effects.ts's OPPONENT_PRIZES_MULTIPLY), but its target is one
// CHOSEN Benched Pokémon rather than the Defender, so it is a `damageChosen` op
// (count 1, `deals` + `perTakenPrize`) and not a pre-W/R damage fold. The "1 of"
// is what distinguishes it from SPREAD_EACH_BENCH's "each of"; the optional W/R
// clarifier tail is the spread family's, and true here for the same §8.5 reason.
const BENCHED_SNIPE_TAKEN_PRIZES = new RegExp(
  `^This attack does (\\d+) damage to 1 of your opponent['’]s Benched Pokémon ` +
    "for each Prize card your opponent has taken\\." +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

// A chosen Benched hit scaled by the damage counters on the chosen Pokémon
// (`damageChosen.perDamageCounterOnTarget`). Without "Benched " the target is any of the opponent's
// Pokémon (`opponentAny`), and the Active takes W/R.
const BENCHED_SNIPE_TARGET_COUNTERS = new RegExp(
  `^This attack does (\\d+) damage to 1 of your opponent['’]s (Benched )?Pokémon ` +
    "for each damage counter on that Pokémon\\." +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

const ALSO_BENCHED_SNIPE = new RegExp(`^This ${ALSO_BENCHED_SNIPE_BODY}$`);

/**
 * The same benched rider behind a board-condition clause, e.g. "If there are 3 or fewer cards in
 * your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon." The clause
 * is resolved through `CONDITIONAL_DAMAGE_CLAUSES`, so an unmapped clause returns null and the
 * sentence stays on the skipped path.
 */
const CONDITIONAL_BENCH_SNIPE = new RegExp(`^If (.+), this ${ALSO_BENCHED_SNIPE_BODY}$`);

// "This attack does N damage to C of your opponent's Pokémon." A chosen hit on the Active or a
// Benched Pokémon (`opponentAny`), with W/R applying to the Active (§8.5). The tail is either the
// Benched clarifier or "This attack's damage isn't affected by Weakness or Resistance[, or by any
// effects on that Pokémon].", which sets `ignoreWR` (the bare form also sets `wrOnly`). The tail's
// "that"/"those" must agree with the count; that check and the refusal of a per-Energy count
// combined with the W/R tail happen at the read site. Also admits "each of C of" for counts of 2 or
// more.
const CHOSEN_ANY_TARGET = new RegExp(
  `^This attack does (\\d+) damage to (?:each of (?=[2-9]))?(\\d+) of your opponent['’]s Pokémon` +
    "( for each Energy attached to this Pokémon)?\\." +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\)` +
    `|( This attack['’]s damage isn['’]t affected by Weakness or Resistance` +
    "(?:, or by any effects on (that|those) Pokémon)?\\.))?$",
);

// "Choose 1 of your opponent's Pokémon N times. (You can choose the same Pokémon more than once.)
// For each time you chose a Pokémon, do M damage to it. This damage isn't affected by Weakness or
// Resistance." Derived as N separate single-pick `damageChosen` parks, because a multi-pick prompt
// rejects repeated picks; each park re-reads the candidate set. `deals: true` because the card says
// "do damage" rather than placing counters. A count of 0 is refused so it does not emit an empty
// program.
const ATTACK_PICK_WITH_REPLACEMENT_SNIPE = new RegExp(
  `^Choose 1 of your opponent['’]s Pokémon (\\d+) times\\. ` +
    "\\(You can choose the same Pokémon more than once\\.\\) " +
    "For each time you chose a Pokémon, do (\\d+) damage to it\\. " +
    `This damage isn['’]t affected by Weakness or Resistance\\.$`,
);

// The self-discard attack cost (§8): "an" lets the player pick one Energy, "{N}" asks for exactly
// that many, "all" strips the lot. Typed variants ("Discard a {L} Energy…") are not matched here
// because they need an Energy-provides-type filter. "this Pokémon" is the Active (§8).
const SELF_DISCARD_ONE = /^Discard an Energy from this Pokémon\.$/;

const SELF_DISCARD_N = /^Discard (\d+) Energy from this Pokémon\.$/;

// The whole-sentence anchor keeps compound printings that add a second sentence after the discard
// off this path.
const SELF_DISCARD_ALL = /^Discard all Energy from this Pokémon\.$/;

// Self-discard cost followed by an any-target snipe, e.g. "Discard all Energy from this Pokémon.
// This attack does 120 damage to 1 of your opponent's Pokémon." The join is either ". This" or ",
// and this". No W/R tail is admitted because no compound prints one. Also admits the "each of"
// spelling.
const SELF_DISCARD_THEN_ANY_TARGET = new RegExp(
  "^Discard (all|\\d+) Energy from this Pokémon(?:\\. This|, and this) " +
    `attack does (\\d+) damage to (?:each of (?=[2-9]))?(\\d+) of your opponent['’]s Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

// Literal anchors: a shuffle-all cost then an any-target hit; an any-target hit narrowed to Pokémon
// with Special Energy attached; and a discard-all cost then counters placed on any target
// (`damageChosen` without `deals`). The counter anchor spells "put" because `normaliseMeWording`
// rewrites the printed "place" first.
const SELF_SHUFFLE_ALL_THEN_ANY_TARGET = new RegExp(
  "^Shuffle all Energy attached to this Pokémon into your deck, and this attack does (\\d+) damage to 1 of " +
    `your opponent['’]s Pokémon\\.(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

const CHOSEN_ANY_TARGET_SPECIAL_ENERGY = new RegExp(
  `^This attack does (\\d+) damage to 1 of your opponent['’]s Pokémon that has any Special Energy attached\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

const SELF_DISCARD_ALL_THEN_COUNTERS =
  /^Discard all Energy from this Pokémon and put (\d+) damage counters on 1 of your opponent['’]s Pokémon\.$/;

// "Discard up to N Energy cards from your hand. This attack does M damage to 1 of your opponent's
// Pokémon for each Energy card you discarded in this way." [1] is the discard ceiling
// (`payFromHand.cap`) and [2] the per-card damage.
const HAND_DISCARD_THEN_SCALED_ANY_TARGET = new RegExp(
  "^Discard up to (\\d+) Energy cards from your hand\\. " +
    `This attack does (\\d+) damage to 1 of your opponent['’]s Pokémon` +
    " for each Energy card you discarded in this way\\." +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

// Self-discard cost joined with ", and" to taking a Prize card. This has to be a single anchor
// because the clause splitter refuses this sentence.
const SELF_DISCARD_ALL_THEN_TAKE_PRIZE =
  /^Discard all Energy from this Pokémon, and take a Prize card\.$/;

// "You may put an Energy attached to your opponent's Active Pokémon into their hand." "You may " is
// required: the mandatory form has no legal printing.
const MAY_PUT_OPPONENT_ACTIVE_ENERGY_TO_HAND =
  /^You may put (an|\d+) Energy attached to your opponent['’]s Active (Stage 2 )?Pokémon into their hand\.$/;

// "Put an Energy attached to this Pokémon into your hand." Mandatory (no "You may"), so it is not
// wrapped in `optional`; the only decision is which Energy.
const PUT_SELF_ENERGY_TO_HAND = /^Put an Energy attached to this Pokémon into your hand\.$/;

const FLIP_OPPONENT_ACTIVE_DISCARD =
  /^Flip a coin\. If heads, discard an Energy from your opponent['’]s Active Pokémon\.$/;

// The reveal-and-bottom attack sentence (Greavard "Underworld Stroll") — the
// whole effect, anchored end to end like every rule here. Only the SUPPORTER
// narrowing is derived: Ortega's unfiltered Supporter form carries a second
// sentence (an opponent draw behind a §9.2 gate) that no attack prints, so it
// is registry-authored and this anchor must not loosen toward it.
const REVEAL_BOTTOM_SUPPORTER =
  /^Your opponent reveals their hand\. Choose a Supporter card you find there and put it on the bottom of their deck\.$/;

// Recoil: "This Pokémon also does N damage to itself." A self-damage in addition to the main
// damage. No /i: the capital and the anchors keep a mid-sentence clause off this path.
const SELF_DAMAGE = /^This Pokémon also does (\d+) damage to itself\.$/;

// Recoil scaled by the attacker's own damage counters. Mutually exclusive with `SELF_DAMAGE` by
// `\.$`, so the order of the two checks does not matter.
const SELF_DAMAGE_PER_COUNTER =
  /^This Pokémon also does (\d+) damage to itself for each damage counter on it\.$/;

// Knock Out sentences whose targets are named by the text, resolving to `knockOutDefender`.
// Sentences that choose a target need a park and are handled separately.
const OPPONENT_ACTIVE_BASIC_KO =
  /^If your opponent['’]s Active Pokémon is a Basic Pokémon, it is Knocked Out\.$/;

const BOTH_ACTIVES_KO = /^Both Active Pokémon are Knocked Out\.$/;

const OPPONENT_ACTIVE_SPECIAL_ENERGY_KO =
  /^If your opponent['’]s Active Pokémon has any Special Energy attached, it is Knocked Out\.$/;

// The same shape gated on `opponentActiveHasSpecialCondition` before `knockOutDefender`.
const OPPONENT_ACTIVE_SPECIAL_CONDITION_KO =
  /^If your opponent['’]s Active Pokémon is affected by a Special Condition, it is Knocked Out\.$/;

// "If <clause>, your opponent's Active Pokémon is now Paralyzed." The clause is spelled into the
// anchor rather than looked up in the damage-bonus clause table, so that table stays unreachable
// from a status consequent.
const SELF_PRIZE_GATE_PARALYZE =
  /^If you have exactly 1 Prize card remaining, your opponent['’]s Active Pokémon is now Paralyzed\.$/;

const SELF_DAMAGE_THEN_COIN_KO =
  /^This Pokémon does (\d+) damage to itself\. Flip a coin\. If heads, your opponent['’]s Active Pokémon is Knocked Out\.$/;

// The two pick sentences of the Knock Out family, one op (`knockOutChosen`) with two riders.
const FLIP_KO_ACTIVE_OR_BENCHED_BASIC =
  /^Flip a coin\. If heads, Knock Out your opponent['’]s Active Basic Pokémon\. If tails, Knock Out 1 of your opponent['’]s Benched Basic Pokémon\.$/;

// The count is captured and guarded `>= 1`: a printed 0 would admit every undamaged Pokémon.
const KO_EXACT_DAMAGE_COUNTERS =
  /^Knock Out 1 of your opponent['’]s Pokémon that has exactly (\d+) damage counters on it\.$/;

// Gate on `opponentActiveDamageCountersExactly`; the count is captured (`>= 1`).
const OPPONENT_ACTIVE_EXACT_COUNTERS_KO =
  /^If your opponent['’]s Active Pokémon has exactly (\d+) damage counters on it, that Pokémon is Knocked Out\.$/;

// Inteleon "Bring Down" ×3: `knockOutChosen` over `anyExceptSelf` with `leastHpRemaining`.
const LEAST_HP_ANY_KO =
  /^Choose a Pokémon in play \(yours or your opponent['’]s\) that has the least HP remaining, except for this Pokémon, and it is Knocked Out\.$/;

// N's Vanilluxe "Snow Coating": `counterEachAll` with `perDamageCounterOnTarget` (10 per counter).
const DOUBLE_OPPONENT_COUNTERS =
  /^Double the number of damage counters on each of your opponent['’]s Pokémon\.$/;

// `conditionGate { opponentKnockedOutByDamage }` over `preventDamage { effects }`.
const KO_BY_THIS_ATTACK_PREVENT_ALL =
  /^If your opponent['’]s Pokémon is Knocked Out by damage from this attack, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/;

// `bountyThisAttack`; the count is captured (`>= 1`) and the noun agrees with it ("1 … card", "2 …
// cards").
const KO_BY_THIS_ATTACK_MORE_PRIZES =
  /^If your opponent['’]s Pokémon is Knocked Out by damage from this attack, take (\d+) more Prize card(s?)\.$/;

// `knockOutEach`; the HP is captured (`>= 10`).
const KO_EACH_AT_REMAINING_HP =
  /^Knock Out each of your opponent['’]s Pokémon that has (\d+) HP or less remaining\.$/;

// `coinFlipGate` over `switchWithDeckChosen`.
const FLIP_SWITCH_WITH_DECK_POKEMON =
  /^Flip a coin\. If heads, search your deck for a Pokémon and switch it with this Pokémon\. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon\. If you switched a Pokémon in this way, put this card into your deck\. Then, shuffle your deck\.$/;

// `revealDeckBottomCount` filing Pokémon with the named attack, then `damageDefender { per, count
// }`. The window, per-card damage and attack name are captured.
const BOTTOM_REVEAL_NAMED_ATTACK_SCALE =
  /^Reveal the bottom (\d+) cards of your deck, and this attack does (\d+) damage for each Pokémon you find there that has the ([A-Z][A-Za-z'’ -]*) attack\. Then, shuffle any revealed Pokémon back into your deck\. Discard the other cards\.$/;

// Two `attachFromHand { max }` ops, the opponent's first.
const EACH_PLAYER_HAND_ATTACH =
  /^Each player may attach up to (\d+) Basic Energy cards from their hand to their Pokémon in any way they like\. Your opponent does this first\.$/;

// `ATTACK_LOOK_TOP_BENCH`'s sentence with a comma join.
const LOOK_TOP_COMMA_BENCH =
  /^Look at the top (\d+) cards of your deck, and you may put any number of Pokémon you find there onto your Bench\. Shuffle the other cards back into your deck\.$/;

// Tropius "Fruity Aroma": the same look into the HAND, revealed (Roto-Stick's `max: "any"` + `reveal`).
const LOOK_TOP_COMMA_REVEAL_HAND =
  /^Look at the top (\d+) cards of your deck, and you may reveal any number of Pokémon you find there and put them into your hand\. Shuffle the other cards back into your deck\.$/;

// Pikachu ex "Pika-Pika Parade" ×3: Precious Trolley's program (`searchDeck` Basic → Bench, `max: "any"`).
const SEARCH_ANY_BASIC_TO_BENCH =
  /^Search your deck for any number of Basic Pokémon and put them onto your Bench\. Then, shuffle your deck\.$/;

// `healEachAll`.
const HEAL_EACH_BOTH_SIDES =
  /^Heal (\d+) damage from each Pokémon \(both yours and your opponent['’]s\)\.$/;

// Scraggy "Nitpick" ×2: `handRefresh` on the opponent alone (Distorted Future's `who`), a fixed draw.
const OPPONENT_SHUFFLES_HAND_DRAWS =
  /^Your opponent shuffles their hand into their deck and draws (\d+) cards\.$/;

// Ho-Oh "Flames of Revival": `discardPileRetrieval` of Basic Pokémon onto the Bench.
const RETRIEVE_BASIC_TO_BENCH =
  /^Put up to (\d+) Basic Pokémon from your discard pile onto your Bench\.$/;

// `DEVOLVE_EACH_TO_DECK`'s sweep into the hand (`devolveEach.toHand`).
const DEVOLVE_EACH_TO_HAND =
  /^Devolve each of your opponent['’]s evolved Pokémon by putting the highest Stage Evolution card on it into your opponent['’]s hand\.$/;

// Frosmoth "Cold Cyclone": `ATTACK_MOVE_BASIC_ENERGY_SELF_TO_BENCH` with a typed noun (`providesEnergy`).
const MOVE_TYPED_ENERGY_SELF_TO_BENCH =
  /^Move a \{([A-Z])\} Energy from this Pokémon to 1 of your Benched Pokémon\.$/;

// The self-discard, then Paralysis.
const SELF_DISCARD_THEN_PARALYZE =
  /^Discard (\d+) Energy from this Pokémon, and your opponent['’]s Active Pokémon is now Paralyzed\.$/;

// Volcanion "Backfire": `PUT_SELF_ENERGY_TO_HAND`'s op at a printed typed count.
const PUT_TYPED_SELF_ENERGY_TO_HAND =
  /^Put (\d+) \{([A-Z])\} Energy attached to this Pokémon into your hand\.$/;

// `healChosen` on the Bench with a typed candidate filter.
const HEAL_ONE_BENCHED_TYPED = /^Heal (\d+) damage from 1 of your Benched \{([A-Z])\} Pokémon\.$/;

// Claydol "Devolution Ray" ×2: `devolveChosen` narrowed to the Defending Pokémon (`defenderOnly`, NEW).
const DEVOLVE_ACTIVE_TO_HAND =
  /^If your opponent['’]s Active Pokémon is an evolved Pokémon, devolve it by putting the highest Stage Evolution card on it into your opponent['’]s hand\.$/;

// Sudowoodo "Trials and Trip-ulations": a two-word card name (`NAMED_CARD_NOUN` takes one word), so a literal.
const SEARCH_TRANSFORMATION_TOME =
  /^Search your deck for up to (\d+) Transformation Tome cards, reveal them, and put them into your hand\. Then, shuffle your deck\.$/;

// Rotom "Roto Call": a name-fragment Bench search behind the printed "You may" (`optional`).
const MAY_SEARCH_NAMED_FRAGMENT_TO_BENCH =
  /^You may search your deck for any number of Pokémon that have ["“]([A-Z][a-z]+)["”] in their name and put them onto your Bench\. Then, shuffle your deck\.$/;

// Dialga "Reversed Clock": Super Rod's program (`pokemonOrBasicEnergy` → deck, then shuffle).
const SHUFFLE_POKEMON_OR_BASIC_ENERGY_FROM_DISCARD =
  /^Shuffle up to (\d+) in any combination of Pokémon and Basic Energy cards from your discard pile into your deck\.$/;

// Celebi "Traverse Time": a revealed hand search over `anyOf` a typed Pokémon and a Stadium.
const SEARCH_TYPED_POKEMON_OR_STADIUM =
  /^Search your deck for up to (\d+) in any combination of \{([A-Z])\} Pokémon and Stadium cards, reveal them, and put them into your hand\. Then, shuffle your deck\.$/;

// Eevee "Fetch and Hide": `REVEAL_BOTTOM_SUPPORTER`'s op over an Item.
const REVEAL_BOTTOM_ITEM =
  /^Your opponent reveals their hand, and you put an Item card you find there on the bottom of your opponent['’]s deck\.$/;

// A clause-table gate over the opponent-side mill. The clause is looked up, not captured.
const CLAUSE_GATED_OPPONENT_MILL =
  /^If (.+), discard the top (\d+) cards of your opponent['’]s deck\.$/;

// Clause-table gate over the opponent-side counter fold; the printed "place" is read as "put" by
// `normaliseMeWording`.
const CLAUSE_GATED_OPPONENT_COUNTER_FOLD =
  /^If (.+), put (\d+) damage counters on each of your opponent['’]s Pokémon\.$/;

// "quadruple the number of damage counters" is `damageChosen.perDamageCounterOnTarget` placing 3
// more per counter already there.
const CLAUSE_GATED_CHOSEN_QUADRUPLE =
  /^If (.+), choose (\d+) of your opponent['’]s Pokémon and quadruple the number of damage counters on each of them\.$/;

// Benched counter placement behind a clause-table gate; "place" is read as "put"
// (`normaliseMeWording`).
const CLAUSE_GATED_BENCH_COUNTERS =
  /^If (.+), put (\d+) damage counters on 1 of your opponent['’]s Benched Pokémon\.$/;

// `attachFromDiscard` at a count-scaled ceiling.
const DISCARD_ATTACH_UP_TO_OPPONENT_ENERGY =
  /^Choose Basic \{([A-Z])\} Energy cards from your discard pile up to the amount of Energy attached to all of your opponent['’]s Pokémon and attach them to your \{([A-Z])\} Pokémon in any way you like\.$/;

// Furfrou "Hand Trim": the random discard down to a printed hand size (`untilHandSize`, NEW).
const RANDOM_DISCARD_OPPONENT_HAND_DOWN_TO =
  /^Discard random cards from your opponent['’]s hand until they have (\d+) cards in their hand\.$/;

// `lookAtTopN` exact with the rest discarded; the kept card is revealed.
const MILL_TOP_KEEP_ONE =
  /^Discard the top (\d+) cards of your deck and put 1 of them into your hand\.$/;

// Shaymin "Send Flowers": `attachFromDeck` of ANY Energy card onto a typed Benched body.
const SEARCH_ENERGY_ATTACH_BENCHED_TYPED =
  /^Search your deck for an Energy card and attach it to 1 of your Benched \{([A-Z])\} Pokémon\. Then, shuffle your deck\.$/;

// Fletchling "Chirp": a revealed hand search over the NEW `pokemonWithResistance` filter.
const SEARCH_POKEMON_WITH_RESISTANCE =
  /^Search your deck for up to (\d+) Pokémon with \{([A-Z])\} Resistance, reveal them, and put them into your hand\. Then, shuffle your deck\.$/;

// Unconditional mill in both directions: "Discard the top [N cards|card] of your [opponent's]
// deck." The captures fill `count` and `whose`. The singular is a separate branch because "the top
// card" carries no digits; the undefined capture means one.
const DECK_TOP_MILL = /^Discard the top (?:(\d+) cards|card) of your (opponent['’]s )?deck\.$/;

/**
 * "This attack does N damage to each of your opponent's <class>. This attack's damage isn't
 * affected by Weakness or Resistance." Declared here because it reads `IN_PLAY_BODY_NOUNS`, which
 * would be in the temporal dead zone further up. The W/R sentence is mandatory and sets `ignoreWR`
 * (with `wrOnly`).
 */
const SPREAD_EACH_CLASSED_OPPONENT_POKEMON = new RegExp(
  `^This attack does (\\d+) damage to each of your opponent['’]s (${SPREAD_EACH_CLASS_NOUNS.join(
    "|",
  )})\\. This attack['’]s damage isn['’]t affected by Weakness or Resistance\\.$`,
);

// "Discard the top N cards of your deck, and this attack does P damage for each <noun> [that] you
// discarded in this way." The noun group is lazy so an optional "that" is not swallowed into the
// noun ("Misty's Pokémon that").
const DECK_MILL_FILTERED_SCALED_DAMAGE =
  /^Discard the top (\d+) cards of your deck, and this attack does (\d+) damage for each (.+?) (?:that )?you discarded in this way\.$/;

// "Discard up to N Pokémon Tools from your opponent's Pokémon." Claimed whole, at the program tail.
const ATTACK_DISCARD_TOOLS_UP_TO =
  /^Discard up to (\d+) Pokémon Tools from your opponent['’]s Pokémon\.$/;

const HAND_BASIC_ENERGY_COST = new RegExp(
  `^Discard (?:(\\d+) Basic \\{([${ENERGY_CODES}])\\} Energy cards|(a) Basic \\{([${ENERGY_CODES}])\\} Energy card) from your hand\\.$`,
);

const HAND_BASIC_ENERGY_COST_KO = new RegExp(
  `^Discard (\\d+) Basic \\{([${ENERGY_CODES}])\\} Energy cards from your hand, and Knock Out your opponent['’]s Active Pokémon\\.$`,
);

// Opponent-side Energy discard from the Active. The leading `^` and the capital "Discard" keep
// mid-sentence clauses such as Krookodile's "…For each heads, discard an Energy…" off this arm,
// which would otherwise discard once on top of the per-heads reading; do not add /i. The "ex"
// variant wraps the op in a `conditionGate` on `opponentActiveIsEx` and is tested first.
const OPPONENT_ACTIVE_EX_DISCARD =
  /^Discard an Energy from your opponent['’]s Active Pokémon ex\.$/;

const OPPONENT_ACTIVE_DISCARD = new RegExp(
  `^Discard (?:an|a (Special)|a (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\}` +
    `|(${Object.keys(ENERGY_TYPE_BY_NAME).join("|")}))) Energy from your opponent['’]s Active Pokémon\\.$`,
);

// Must not match the "each of your opponent's Pokémon" wording (Giacomo), which discards one per
// body.
const OPPONENT_EACH_SPECIAL_DISCARD =
  /^Discard all Special Energy from all of your opponent['’]s Pokémon\.$/;

// Typed self-discard cost. Both alternations are built from the maps, so the regex cannot admit a
// code or name the map won't resolve. Whole-sentence anchoring refuses near-misses with rider
// clauses, "You may", or other zones. Do not add /i: the capital first word helps keep mid-sentence
// clauses off this path.
const TYPED_SELF_DISCARD = new RegExp(
  `^Discard (all|a|\\d+) (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\}` +
    `|(${Object.keys(ENERGY_TYPE_BY_NAME).join("|")})) Energy from this Pokémon\\.$`,
);

// Self-discard cost followed by a Benched snipe. Map-built, so it must follow
// `ENERGY_TYPE_BY_CODE`. Captures: [1] quantifier, [2] optional Energy code, then the shared body's
// [3] amount, [4] arity, [5] side, [6] damage narrowing.
const SELF_DISCARD_THEN_BENCH_SNIPE = new RegExp(
  `^Discard (all|\\d+)(?: \\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\})?` +
    ` Energy from this Pokémon(?:\\. This|, and this) ${ALSO_BENCHED_SNIPE_BODY}$`,
);

// Map-built, so these follow `ENERGY_TYPE_BY_CODE`.
const CHOSEN_ANY_TARGET_PER_TYPED_ENERGY = new RegExp(
  `^This attack does (\\d+) damage to 1 of your opponent['’]s Pokémon for each \\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} Energy attached to this Pokémon\\.(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

const SELF_DISCARD_TYPED_ALL_THEN_ANY_TARGET = new RegExp(
  `^Discard all \\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} Energy from this Pokémon, and this attack does (\\d+) damage to 1 of your opponent['’]s Pokémon\\.(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

// "Discard … Energy. This attack does N damage for each card you discarded in this way." The
// printed N is the per-card amount and the base is dropped. The "N more damage" form is a separate
// reader. Captures: 1–3 quantifier, 4–6 filter, 7 zone, 8 per-card damage. "Basic Energy" names the
// card, so it maps to `basicEnergy`, not a provision filter.
const ENERGY_DISCARD_SCALED_DAMAGE = new RegExp(
  `^(?:You may discard (any amount) of|Discard (all)|Discard up to (\\d+)) (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\}` +
    `|(${Object.keys(ENERGY_TYPE_BY_NAME).join("|")})|(Basic)) Energy(?: cards)? from (this|your) Pokémon\\. This attack does (\\d+) damage for each card you discarded in this way\\.$`,
);

// Comma spelling of the same fold. "your hand" uses the declinable `payFromHand`, which requires
// "up to N". Captures: [1] "any amount", [2] cap, [3] "Basic", [4] code, [5] zone, [6] per-card
// amount.
const COMMA_DISCARD_SCALED_DAMAGE = new RegExp(
  `^Discard (?:(any amount) of|up to (\\d+)) (?:(Basic) )?(?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy(?: cards)? from (among your Pokémon|this Pokémon|your hand), and this attack does (\\d+) damage for each card you discarded in this way\\.$`,
);

// Uncapped declinable `payFromHand`; "You may" makes 0 a valid answer. Captures: [1] the Team
// Rocket noun, [2] the per-card amount (absent without the damage tail).
const HAND_DISCARD_ANY_NUMBER =
  /^You may discard any number of (?:cards|(Supporter) cards that have ["“]Team Rocket["”] in their name) from your hand(?:, and this attack does (\d+) damage for each card you discarded in this way)?\.$/;

// Nothing moves; the revealed uids are recorded as "revealed". Captures: [1] the printed name list,
// [2] the per-card amount.
const HAND_REVEAL_NAMED_SCALED =
  /^Reveal any number of ((?:[A-Z][A-Za-z'’é-]*, )+and [A-Z][A-Za-z'’é-]*) from your hand, and this attack does (\d+) damage for each card you revealed in this way\.$/;

// The self-damage is a downside, so "You may" is a confirm over both ops.
const SELF_DAMAGE_AND_PARALYZE_OPTIONAL =
  /^You may have this Pokémon also do (\d+) damage to itself and make your opponent['’]s Active Pokémon Paralyzed\.$/;

// SELF_DISCARD_THREE_TYPED: three `discardEnergy` count-1 ops off the Active in printed order, each but the
// last carrying `reserve` (the types still owed), so a multi-type Energy (Legacy Energy) cannot fill one slot
// and dodge a later one. Captures: the three codes.
const SELF_DISCARD_THREE_TYPED = new RegExp(
  `^Discard a \\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} Energy, a \\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} Energy, and a \\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} Energy from this Pokémon\\.$`,
);

const MILL_TOP_USE_SUPPORTER_EFFECT =
  /^Discard the top card of your deck, and if that card is a Supporter card, use the effect of that card as the effect of this attack\.$/;

// Whole-string anchored so compound sentences that begin with one of these clauses are not read as
// their first clause. The singular branch leaves the count undefined and the site uses 1.
const ATTACK_DRAW = /^Draw (?:(\d+) cards|a card)\.$/;

const ATTACK_DRAW_UNTIL = /^Draw cards until you have (\d+) cards in your hand\.$/;

const ATTACK_DRAW_BOTTOM = /^Draw (\d+) cards from the bottom of your deck\.$/;

// The mood is part of the anchor: a "may" draw would need a question, not an automatic op.
const ATTACK_EACH_PLAYER_DRAW = /^Each player draws (\d+) cards\.$/;

// An attack-derived self-switch moves the attacker off the Active Spot, so `finishAttack` addresses
// the attacker by uid. The gust moves the opponent's Active, whose defender is captured by uid
// before the program runs.
const ATTACK_GUST = /^Switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\.$/;

const ATTACK_FLIP_GUST =
  /^Flip a coin\. If heads, switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\.$/;

const ATTACK_SELF_SWITCH = new RegExp(`^Switch ${SELF_SWITCH_CLAUSE}$`);

/**
 * `returnSelf` to the deck, mandatory. The printed damage lands first and the emptied Active Spot
 * is promoted afterwards.
 */
const ATTACK_RETURN_SELF_TO_DECK = /^Shuffle this Pokémon and all attached cards into your deck\.$/;

/** `discardTools` then the opponent-wide Special Energy discard, in printed order. */
const ATTACK_DISCARD_ALL_TOOLS_AND_SPECIAL =
  /^Discard all Pokémon Tools and Special Energy from all of your opponent['’]s Pokémon\.$/;

/**
 * A coin gate over a known consequent: the head sets `coinFlipGate.coins` and the consequent is
 * looked up in the closed `COIN_GATED_CONSEQUENTS` table. Every head/consequent crossing derives,
 * including unprinted ones.
 */
const COIN_GATE_HEAD =
  /^(Flip a coin\. If heads|Flip 2 coins\. If both of them are heads|Flip 3 coins\. If all of them are heads), (.+)$/;

const COIN_GATE_COINS: Readonly<Record<string, number | undefined>> = {
  "Flip a coin. If heads": undefined,
  "Flip 2 coins. If both of them are heads": 2,
  "Flip 3 coins. If all of them are heads": 3,
};

const COIN_GATED_CONSEQUENTS: ReadonlyMap<string, readonly EffectOp[]> = new Map<
  string,
  readonly EffectOp[]
>([
  // Miltank `me01-106` "Bellyful of Milk" (2 coins) — "Heal all damage from 1 of your Pokémon."
  ["heal all damage from 1 of your Pokémon.", [{ op: "healChosen", amount: "all" }]],
  ["Knock Out 1 of your opponent's Pokémon.", [{ op: "knockOutChosen", target: "opponentAny" }]],
  // Murkrow `30th-093` "Clumsily Clutch" — "During your opponent's next turn, the Defending Pokémon can't retreat."
  [
    "during your opponent's next turn, the Defending Pokémon can't retreat.",
    [{ op: "preventRetreat" }],
  ],
  // Gimmighoul `30th-081` "Strolls So Much" — "Search your deck for a card and put it into your hand. …"
  [
    "search your deck for a card and put it into your hand. Then, shuffle your deck.",
    [
      { op: "searchDeck", filter: { kind: "anyCard" }, dest: "hand", max: 1 },
      { op: "shuffleDeck" },
    ],
  ],
  // Drifloon `mep-005` "Pull" — the attacker's pick, `ATTACK_FLIP_GUST`'s op.
  ["switch 1 of your opponent's Benched Pokémon with their Active Pokémon.", [{ op: "gust" }]],
  // The five-way choice is asked as a chain of labelled `optional` confirms, since no five-option
  // prompt exists. Every path applies exactly one condition.
  [
    "choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition.",
    chooseSpecialConditionProgram(),
  ],
  // "a Pokémon" is `anyPokemon`, so only Basic Pokémon can be benched.
  [
    "search your deck for a Pokémon and put it onto your Bench. Then, shuffle your deck.",
    [
      { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "bench", max: 1 },
      { op: "shuffleDeck" },
    ],
  ],
  // "1 of your opponent's Pokémon" includes the Active; the emptied spot is promoted.
  [
    "choose 1 of your opponent's Pokémon. Shuffle that Pokémon and all attached cards into their deck.",
    [{ op: "returnBenched", whose: "opponent", dest: "deck", includeActive: true }],
  ],
]);

const CHOSEN_PER_HEADS_IN_PLAY =
  /^Choose 1 of your opponent['’]s Pokémon and flip a coin for each of your Pokémon in play that has "([^"]+)" in its name\. This attack does (\d+) damage to the chosen Pokémon for each heads\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/;

const FLIP_EACH_OPPONENT_SNIPE =
  /^For each of your opponent['’]s Pokémon, flip a coin\. If heads, this attack does (\d+) damage to that Pokémon\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/;

const ATTACK_FLIP_SELF_SWITCH = new RegExp(
  `^Flip a coin\\. If heads, switch ${SELF_SWITCH_CLAUSE}$`,
);

/**
 * A separate anchor rather than an optional "You may" group because the bare sentence capitalises
 * "Switch" and this one does not.
 */
const ATTACK_MAY_SELF_SWITCH = new RegExp(`^You may switch ${SELF_SWITCH_CLAUSE}$`);

/**
 * A separate anchor rather than a widening of `SELF_SWITCH_CLAUSE`. The capture is a single letter
 * so it cannot swallow a clause; a code the map does not know stays unbuilt.
 */
const ATTACK_SELF_SWITCH_TYPED =
  /^Switch this Pokémon with 1 of your Benched \{([A-Z])\} Pokémon\.$/;

// The parenthetical is the only thing that distinguishes this from a gust (the opponent chooses the
// new Active), so it is part of the anchor.
const ATTACK_OPPONENT_SWITCH_OUT =
  /^Switch out your opponent['’]s Active Pokémon to the Bench\. \(Your opponent chooses the new Active Pokémon\.\)$/;

// The "You may" sibling — a SEPARATE whole-string anchor rather than an optional
// `(?:You may )?` group, following the four draw anchors' rule exactly: the bare
// sentence starts "Switch" and this one "switch", so the shared body is not
// shared BYTES and folding them would need an `/i` these readers deliberately do
// not have (`clauseApostrophe.test.ts` pins that they commit to case).
const ATTACK_MAY_OPPONENT_SWITCH_OUT =
  /^You may switch out your opponent['’]s Active Pokémon to the Bench\. \(Your opponent chooses the new Active Pokémon\.\)$/;

// Self-switch, then "If you do," a switch-out: `switchActive { recordAs: "moved" }` plus
// `recordGate`.
const ATTACK_SELF_SWITCH_THEN_OPPONENT_SWITCH_OUT = new RegExp(
  `^Switch ${SELF_SWITCH_CLAUSE} If you do, switch out your opponent['’]s Active Pokémon to the Bench\\. \\(Your opponent chooses the new Active Pokémon\\.\\)$`,
);

// Two anchors because two programs: the gust form damages whoever is Active even if the gust did
// nothing, while the "If you do" form is a `recordGate` and deals nothing when the switch-out
// fails.
const ATTACK_GUST_THEN_DAMAGE_NEW_ACTIVE =
  /^Switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\. This attack does (\d+) damage to the new Active Pokémon\.$/;

const ATTACK_OPPONENT_SWITCH_OUT_THEN_DAMAGE_NEW_ACTIVE =
  /^Switch out your opponent['’]s Active Pokémon to the Bench\. \(Your opponent chooses the new Active Pokémon\.\) If you do, this attack does (\d+) damage to the new Active Pokémon\.$/;

// The noun is bare so a typed noun ("Move 2 {D} Energy …") is refused rather than moving any
// Energy.
const ATTACK_MOVE_ENERGY_SELF_TO_BENCH =
  /^Move (?:(\d+)|an) Energy from this Pokémon to 1 of your Benched Pokémon\.$/;

// A separate anchor because the article changes with the noun ("an Energy" vs "a Basic Energy").
const ATTACK_MOVE_BASIC_ENERGY_SELF_TO_BENCH =
  /^Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon\.$/;

// A separate anchor because "all" is a different kind of `max` than a number or the article.
const ATTACK_MOVE_ALL_ENERGY_SELF_TO_BENCH =
  /^Move all Energy from this Pokémon to 1 of your Benched Pokémon\.$/;

// The "in any way you like" form spreads over many bodies, so it is a separate anchor.
const ATTACK_MOVE_ALL_ENERGY_SELF_TO_BENCH_SPREAD =
  /^Move all Energy from this Pokémon to your Benched Pokémon in any way you like\.$/;

/**
 * The optional brace group switches the filter between `anyEnergy` and `providesEnergy`. "from your
 * Pokémon" means any source body; "your other Pokémon" is enforced per pick by `validateChoice`.
 */
const ATTACK_MOVE_ANY_AMOUNT_SPREAD = new RegExp(
  `^You may move any amount of (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy from your Pokémon to your other Pokémon in any way you like\\.$`,
);

/**
 * Moving Energy on the opponent's board. The possessives are literal on both ends so the own-board
 * Energy Switch wording cannot match.
 */
const ATTACK_MOVE_ENERGY_OPPONENT_FREE =
  /^Move an Energy from 1 of your opponent['’]s Pokémon to another of their Pokémon\.$/;

const ATTACK_MOVE_ENERGY_OPPONENT_ACTIVE_TO_BENCH =
  /^You may move an Energy from your opponent['’]s Active Pokémon to 1 of their Benched Pokémon\.$/;

// Separate from the bare draw anchors because the case differs ("You may draw" vs "Draw") and the
// readers do not use /i.
const ATTACK_MAY_DRAW = /^You may draw (\d+) cards\.$/;

const ATTACK_MAY_DRAW_UNTIL = /^You may draw cards until you have (\d+) cards in your hand\.$/;

const ATTACK_BENCH_SEARCH = new RegExp(
  `^Search your deck for (?:a ${BENCH_SEARCH_NOUN} and put it|up to (\\d+) ${BENCH_SEARCH_NOUN} and put them)${BENCH_SEARCH_TAIL}`,
);

/**
 * Bench search followed by "If you put any Pokémon onto your Bench in this way, move an Energy from
 * this Pokémon to the new Benched Pokémon."
 */
const ATTACK_BENCH_SEARCH_THEN_MOVE = new RegExp(
  "^Search your deck for a Basic Pokémon and put it onto your Bench\\. Then, shuffle your deck\\." +
    " If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon" +
    " to the new Benched Pokémon\\.$",
);

const HAND_SEARCH_SINGULAR = new Map(HAND_SEARCH_NOUNS.map(([one, , filter]) => [one, filter]));

const HAND_SEARCH_PLURAL = new Map(HAND_SEARCH_NOUNS.map(([, many, filter]) => [many, filter]));

// Groups: 1 singular noun phrase with article, 2 singular reveal clause, 3 count, 4 "any number
// of", 5 plural noun phrase, 6 "of different types", 7 plural reveal clause. The pronoun is tied to
// the number so crossed forms cannot match. The lazy noun group lets group 6 take the distinctness
// phrase.
const ATTACK_HAND_SEARCH = new RegExp(
  "^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +
    "|(?:up to (\\d+)|(any number of)) ([^,.]+?)( of different types)?(, reveal them,)? and put them)" +
    " into your hand\\. Then, shuffle your deck\\.$",
);

// No captures: the max is resolved at the park as `yourBenchCount`.
const ATTACK_HAND_SEARCH_BENCH_COUNT =
  /^Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand\. Then, shuffle your deck\.$/;

// The type is resolved at the park from the attacker's Basic Energy, since a `CardFilter` cannot
// read the board.
const ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED =
  /^Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand\. Then, shuffle your deck\.$/;

/**
 * The `^…$` keeps the "If you do, search your deck…" compound unbuilt, since evolving without the
 * switch would be wrong.
 */
const ATTACK_EVOLVE_FROM_DECK =
  /^Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it\. Then, shuffle your deck\.$/;

/** The `$` and `^` keep Nidorina's "Choose up to 2 of your {D} Pokémon." variant off this arm. */
const ATTACK_EVOLVE_FROM_DECK_EACH_BENCHED =
  /^For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it\. Then, shuffle your deck\.$/;

/**
 * Differs from `ATTACK_EVOLVE_FROM_DECK` only in the middle ("this Pokémon" vs "1 of your
 * Pokémon"), so both ends must be anchored.
 */
const ATTACK_EVOLVE_FROM_DECK_BODY_CHOICE =
  /^Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it\. Then, shuffle your deck\.$/;

/**
 * Evolution cards are not fungible, so unlike Janine's Secret Art (same head, attaches Energy) each
 * chosen body needs its own pick.
 */
const ATTACK_EVOLVE_FROM_DECK_EACH_CHOSEN =
  /^Choose up to (\d+) of your \{(\w)\} Pokémon\. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it\. Then, shuffle your deck\.$/;

const ATTACK_REVEAL_OPPONENT_HAND = /^Your opponent reveals their hand\.$/;

const ATTACK_RANDOM_DISCARD_FROM_HAND = /^Discard a random card from your opponent['’]s hand\.$/;

// The one sentence in this family printed as TWO sentences, and it is still one
// op: the "reveals that card" is the `RANDOM_CARD_TAKEN` event naming the uid and
// the "shuffles it into their deck" is the route — see the op's doc for why the
// pair cannot be split without inventing a card nobody prints.
const ATTACK_RANDOM_SHUFFLE_FROM_HAND =
  /^Choose a random card from your opponent['’]s hand\. Your opponent reveals that card and shuffles it into their deck\.$/;

const ATTACK_REVEAL_AND_BOTTOM =
  /^Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck\.$/;

// A separate anchor because this is two sentences, not the joined "…, and you choose…" form. The
// count is bounded by `BENCH_MAX` as a printed-number guard; the park also clamps to the live bench
// space.
const ATTACK_REVEAL_AND_BENCH_UP_TO =
  /^Your opponent reveals their hand\. Put up to (\d+) Basic Pokémon you find there onto your opponent['’]s Bench\.$/;

// The pick is mandatory and exactly one card, with no filter.
const ATTACK_REVEAL_AND_DISCARD =
  /^Your opponent reveals their hand\. Discard a card you find there\.$/;

// Anchored whole with the reveal: "you find there" refers to the reveal, so a tail-only anchor
// would let the splitter attach it to any head.
const ATTACK_REVEAL_AND_SWEEP =
  /^Your opponent reveals their hand\. Discard all Item cards and Pokémon Tool cards you find there\.$/;

// The singular branch leaves group 1 undefined and the site uses 1.
const ATTACK_OPPONENT_DISCARDS_HAND =
  /^Your opponent discards (?:(\d+) cards|a card) from their hand\.$/;

// A compound anchor rather than a tail arm: "2 more" refers to the head's discard, and a tail-only
// arm could be composed behind any head.
const ATTACK_OPPONENT_DISCARDS_HAND_MORE =
  /^Your opponent discards a card from their hand\. If (.+), your opponent discards (\d+) more cards\.$/;

// A separate anchor because the verb phrase differs from the discard form.
const ATTACK_OPPONENT_CHOOSES_SHUFFLE_HAND =
  /^Your opponent chooses 3 cards from their hand and shuffles those cards into their deck\.$/;

/**
 * The largest deck-top look window believed from a printed number. It is separate from
 * `MAX_PRINTED_ATTACH_COUNT` because it bounds how deep a look reaches (Lapras ex looks at 20), not
 * how many cards move. 30 is a guard against malformed rows.
 */
const MAX_PRINTED_LOOK_WINDOW = 30;

const DISCARD_ATTACH = attachFromZoneAnchor(SOURCE_ZONE_PHRASE, "");

// Grafaiai: "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any
// way you like." Kept separate from `attachFromZoneClause` so that factory's capture groups do not
// shift.
const ATTACK_OPPONENT_DISCARD_ATTACH =
  /^Attach up to 3 Energy cards from your opponent['’]s discard pile to their Pokémon in any way you like\.$/;

const DECK_SEARCH_ATTACH_DESTINATIONS: ReadonlyMap<string, DeckSearchAttachDestination> = new Map<
  string,
  DeckSearchAttachDestination
>([
  ["this Pokémon", { riders: { toSelf: true }, batch: true }],
  ["1 of your Pokémon", { riders: {}, batch: false }],
  ["1 of your Benched Pokémon", { riders: { benchOnly: true }, batch: false }],
  ["your Pokémon in any way you like", { riders: {}, batch: true }],
  ["your Benched Pokémon in any way you like", { riders: { benchOnly: true }, batch: true }],
  // Generated from the schema's type table so a new type is admitted automatically.
  ...Object.entries(POKEMON_TYPE_BY_CODE).flatMap(
    ([code, type]) =>
      [
        [`1 of your {${code}} Pokémon`, { riders: { targetType: type }, batch: false }],
        [
          `your {${code}} Pokémon in any way you like`,
          { riders: { targetType: type }, batch: true },
        ],
      ] as [string, DeckSearchAttachDestination][],
  ),
]);

// Groups: 1 singular brace code, 2 count, 3 plural brace code, 4 second count, 5 its brace code, 6
// destination phrase, 7 poison tail. The pronoun is welded to the number ("attach it" / "attach
// them"). The `$` matters: without it a trailing unread clause would be silently dropped.
const DECK_SEARCH_ATTACH = new RegExp(
  `^Search your deck for (?:a Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy card and attach it` +
    `|up to (\\d+) Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy cards` +
    `(?: and up to (\\d+) Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy cards)?` +
    ` and attach them) to ([^.]+)\\. Then, shuffle your deck\\.(?: (${DECK_SEARCH_POISON_TAIL}))?$`,
);

/**
 * Mega Gardevoir ex: "For each of your Benched Pokémon, search your deck for a Basic {P} Energy
 * card and attach it to that Pokémon." Group 1 is the optional brace code. One answer maps up to
 * one card onto each Benched body.
 */
const EACH_BENCHED_DECK_ATTACH = new RegExp(
  `^For each of your Benched Pokémon, search your deck for a Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy card and attach it to that Pokémon\\. Then, shuffle your deck\\.$`,
);

const HAND_ATTACH = attachFromZoneAnchor(
  HAND_SOURCE_ZONE_PHRASE,
  `(?: (${HAND_ATTACH_HEAL_TAIL}))?`,
);

/**
 * Alolan Exeggutor ex: "You may attach any number of Basic Energy cards from your hand to your
 * Pokémon in any way you like." It has its own anchor because it emits `attachFromHand`, not
 * `attachEnergyFrom`. Destinations naming a single body are refused. Group 1 is the brace code,
 * group 2 the destination phrase.
 */
const ATTACK_HAND_ANY_NUMBER_ATTACH = new RegExp(
  `^You may attach any number of Basic (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\} )?Energy cards${HAND_SOURCE_ZONE_PHRASE} to ([^.]+)\\.$`,
);

/**
 * Kilowattrel ex: "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach …". The
 * attach targets the attacker after it has moved to the Bench. With an empty Bench the switch fails
 * and nothing is attached.
 */
const ATTACK_SELF_SWITCH_THEN_HAND_ATTACH = new RegExp(
  `^Switch ${SELF_SWITCH_CLAUSE} If you do, attach ${attachFromZoneClause(HAND_SOURCE_ZONE_PHRASE, "")}$`,
);

// Printed destinations for the discard-pile retrieval. A `Map` so arbitrary printed text cannot hit
// `Object.prototype`. The deck destination is printed with the Shuffle verb and has its own anchor.
const DISCARD_RETRIEVAL_DESTINATIONS: ReadonlyMap<string, "hand" | "bench"> = new Map([
  ["into your hand", "hand" as const],
  ["onto your Bench", "bench" as const],
]);

/**
 * Filter kinds a Bench destination may carry. Nothing downstream checks that a benched card is a
 * Pokémon, so a derived "Put a Supporter card … onto your Bench." must be refused here.
 */
const BENCHABLE_RETRIEVAL_KINDS: ReadonlySet<CardFilter["kind"]> = new Set<CardFilter["kind"]>([
  "anyPokemon",
  "basicPokemon",
  "evolutionPokemon",
  "ownerPokemon",
  "typedPokemon",
  "byName",
  "suffixPokemon",
  "attackNamePokemon",
  "stagePokemon",
  "pokemonNameContaining",
  // `supporterNameContaining` is deliberately excluded: it only matches Trainers, which can never
  // go on the Bench.
]);

/**
 * Groups: 1 singular noun phrase, 2 count, 3 plural table phrase, 4 plural proper name (one
 * capitalised word), 5 destination phrase. The `[^.]` class keeps the capture inside the sentence
 * so the `$` refuses trailing clauses.
 */
const ATTACK_DISCARD_RETRIEVAL = new RegExp(
  `^Put (?:(${RETRIEVAL_SINGULAR_ALT})` +
    `|up to (\\d+) (?:(${RETRIEVAL_PLURAL_ALT})|([A-Z][a-zé]+)))` +
    `${SOURCE_ZONE_PHRASE} ([^.]+)\\.$`,
);

/**
 * "Shuffle up to N … from your discard pile into your deck." The trailing `shuffleDeck` is required
 * because the retrieval appends to the bottom of the deck. Only the plural form is printed, so
 * there is no singular branch.
 */
const ATTACK_DISCARD_SHUFFLE_BACK = new RegExp(
  `^Shuffle up to (\\d+) (${RETRIEVAL_PLURAL_ALT})` + `${SOURCE_ZONE_PHRASE} into your deck\\.$`,
);

// The window is `\d+` because `Number` would also accept "4e1" or "0x28". The `$` refuses trailing
// clauses.
const ATTACK_LOOK_TOP_BENCH =
  /^Look at the top (\d+) cards of your deck\. You may put any number of Pokémon you find there onto your Bench\. Shuffle the other cards back into your deck\.$/;

/**
 * `attachFromTop`. "To your Pokémon" prints no Bench or type narrowing, so the op carries no
 * riders.
 */
const ATTACK_LOOK_TOP_ATTACH =
  /^Look at the top (\d+) cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like\. Shuffle the other cards back into your deck\.$/;

/** Nothing in the sentence varies, so it uses `test` and captures nothing. */
const ATTACK_LOOK_TOP_DISCARD = /^Look at the top card of your deck\. You may discard that card\.$/;

/**
 * "Look at the top N cards of your [opponent's] deck and put them back in any order." One capture
 * group per possessive. The `$` keeps Deduction Kit's and Raifort's longer sentences off this
 * anchor.
 */
const ATTACK_REORDER_TOP = new RegExp(
  "^Look at the top (?:" +
    "(\\d+) cards of your deck" +
    `|(\\d+) cards of your opponent['’]s deck` +
    ") and put them back in any order\\.$",
);

/**
 * Inkay: the look is a one-card `reorderTop` on the opponent's deck, and the printed "you may"
 * shuffle is its `otherwise` arm, so the player sees the card before choosing.
 */
const ATTACK_OPPONENT_TOP_LOOK_SHUFFLE =
  /^Look at the top card of your opponent['’]s deck\. You may have your opponent shuffle their deck\.$/;

/**
 * Dialga "Time Manipulation", the same sentence as Ciphermaniac's Codebreaking. The `$` keeps
 * longer neighbouring sentences off this anchor.
 */
const ATTACK_SEARCH_TOP_ORDER = new RegExp(
  "^Search your deck for (\\d+) cards, shuffle your deck, " +
    "then put those cards on top of it in any order\\.$",
);

/**
 * "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on
 * it into your opponent's deck." Nothing is captured.
 */
const DEVOLVE_EACH_TO_DECK = new RegExp(
  `^Devolve each of your opponent['’]s evolved Pokémon by shuffling the highest ` +
    `Stage Evolution card on it into your opponent['’]s deck\\.$`,
);

// "Devolve 1 of your opponent's evolved Pokémon … into your opponent's hand." A separate op from
// the sweep: there is a choice, no shuffle and no "you may".
const DEVOLVE_CHOSEN_TO_HAND = new RegExp(
  `^Devolve 1 of your opponent['’]s evolved Pokémon by putting the highest ` +
    `Stage Evolution card on it into your opponent['’]s hand\\.$`,
);

const RETURN_BENCHED = new RegExp(
  "^(?:" +
    `(Shuffle 1 of your opponent['’]s Benched Pokémon and all attached cards into their deck)` +
    "|(Shuffle 1 of your Benched Pokémon and all attached cards into your deck)" +
    "|(Put 1 of your Benched Pokémon and all attached cards into your hand)" +
    `|(Flip a coin\\. If heads, choose 1 of your opponent['’]s Benched Pokémon\\. ` +
    "Shuffle that Pokémon and all attached cards into their deck)" +
    ")\\.$",
);

/**
 * Keeps the chosen Benched Pokémon and shuffles the rest of the opponent's Bench into their deck.
 * The capture is the number kept, not removed.
 */
const CHOOSE_KEEP_SHUFFLE_REST = new RegExp(
  `^Choose (\\d+) of your opponent['’]s Benched Pokémon\\. If you do, shuffle all of ` +
    `your opponent['’]s Benched Pokémon that you didn['’]t choose, and all cards ` +
    "attached to those Pokémon, into their deck\\.$",
);

/**
 * Sylveon ex "Angelite", with its trailing gate clause already removed by `splitAttackGateClause`.
 * The capture is the number of Benched Pokémon removed.
 */
const CHOOSE_SHUFFLE_CHOSEN = new RegExp(
  `^Choose (\\d+) of your opponent['’]s Benched Pokémon\\. Shuffle those Pokémon ` +
    `and all attached cards into your opponent['’]s deck\\.$`,
);

/**
 * Two anchors rather than an optional "You may" because the optional form is a different program (a
 * gate plus an `optional`).
 */
const DISCARD_STADIUM = /^Discard a Stadium in play\.$/;

const MAY_DISCARD_STADIUM = /^You may discard a Stadium in play\.$/;

/**
 * Ting-Lu "Ground Crasher": a `conditionGate` on `stadiumInPlay` over the Bench spread and then the
 * Stadium discard, in printed order. The order matters when a damage-reducing Stadium such as Full
 * Metal Lab is in play.
 */
const STADIUM_GATED_BENCH_SPREAD =
  /^If a Stadium is in play, this attack also does (\d+) damage to each of your opponent['’]s Benched Pokémon, and discard that Stadium\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/;

/**
 * The count is captured because the same skeleton prints other counts elsewhere (Professor's
 * Research 7, Carmine 5).
 */
const DISCARD_HAND_DRAW = /^Discard your hand and draw (\d+) cards\.$/;

const SHUFFLE_HAND_DRAW = /^Shuffle your hand into your deck\. Then, draw (\d+) cards\.$/;

/**
 * The count reads the opponent's hand, which shuffling your own hand does not change, so the order
 * of the two steps does not matter.
 */
const SHUFFLE_HAND_DRAW_PER_OPPONENT_HAND =
  /^Shuffle your hand into your deck\. Then, draw a card for each card in your opponent's hand\.$/;

/**
 * Pays with `payFromHand` behind a `recordGate`, so with an empty hand nothing is discarded and
 * nothing is drawn.
 */
const HAND_COST_THEN_DRAW = /^Discard a card from your hand\. If you do, draw (\d+) cards\.$/;

const HAND_COST_THEN_OPPONENT_DISCARD =
  /^Discard a card from your hand\. If you do, your opponent discards a card from their hand\.$/;

/** Moltres ex: the cost is an attached Team Rocket's Energy rather than a card in hand. */
const TR_ENERGY_COST_THEN_DISCARD_DEFENDER =
  /^Discard a Team Rocket['’]s Energy from this Pokémon\. If you do, discard your opponent['’]s Active Pokémon and all attached cards\.$/;

/**
 * Parse printed attack text into ops, or null unless the whole trimmed text is one recognized
 * sentence; null keeps the attack on the skipped-effect path. Mega Evolution wording is normalised
 * first.
 */
export function deriveAttackEffect(text: string): EffectOp[] | null {
  const effect = normaliseMeWording(text.trim());

  // 1. "Your opponent's Active Pokémon is now {X}."
  let match = DEFENDER_NOW.exec(effect);
  if (match !== null) {
    return [{ op: "applyStatus", target: "defender", status: statusOf(match[1]) }];
  }

  // 2. "Flip a coin. If heads, your opponent's Active Pokémon is now {X}."
  match = FLIP_DEFENDER_NOW.exec(effect);
  if (match !== null) {
    return [headsGate([{ op: "applyStatus", target: "defender", status: statusOf(match[1]) }])];
  }

  // 2b. Two statuses in printed order. `defenderStatusOps` returns null when both share a
  // `SpecialConditions` field.
  match = DEFENDER_STATUS_PAIR.exec(effect);
  if (match !== null) {
    return defenderStatusOps([match[1], match[2]]);
  }

  match = FLIP_DEFENDER_STATUS_PAIR.exec(effect);
  if (match !== null) {
    const then = defenderStatusOps([match[1], match[2]]);
    return then === null ? null : [headsGate(then)];
  }

  // 2b-bis. One coin with both arms. The collision check applies only to the heads pair, since the
  // two arms are never applied together.
  match = FLIP_DEFENDER_PAIR_OR_TAILS_STATUS.exec(effect);
  if (match !== null) {
    const heads = defenderStatusOps([match[1], match[2]]);
    return heads === null
      ? null
      : [headsGate(heads, [{ op: "applyStatus", target: "defender", status: statusOf(match[3]) }])];
  }

  // 2c. Three statuses in printed order, checked pairwise for collisions.
  match = DEFENDER_STATUS_TRIPLE.exec(effect);
  if (match !== null) {
    return defenderStatusOps([match[1], match[2], match[3]]);
  }

  // 2d. Both consequents sit inside one coin gate, as the printed ", and" says.
  match = FLIP_DEFENDER_STATUS_THEN_DISCARD.exec(effect);
  if (match !== null) {
    return [
      headsGate([
        { op: "applyStatus", target: "defender", status: statusOf(match[1]) },
        { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
      ]),
    ];
  }

  // 2e. Arm 1's status inside a board-condition gate. An unrecognised clause falls through.
  match = CLAUSE_GATED_DEFENDER_NOW.exec(effect);
  if (match !== null) {
    const gate = boardConditionForClause(match[1] ?? "");
    if (gate !== null) {
      return [
        conditionGate(gate, [
          { op: "applyStatus", target: "defender", status: statusOf(match[2]) },
        ]),
      ];
    }
  }

  // 3. "This Pokémon is now {X}." — {X} excludes Paralyzed (see
  //    SELF_STATUS_WORDS: the §13.4 self-paralysis timing gap).
  match = SELF_NOW.exec(effect);
  if (match !== null) {
    return [{ op: "applyStatus", target: "self", status: statusOf(match[1]) }];
  }

  // 4. "This Pokémon is now Asleep. Heal {N} damage from it."
  match = SELF_SLEEP_HEAL.exec(effect);
  if (match !== null) {
    return [
      { op: "applyStatus", target: "self", status: "asleep" },
      { op: "heal", target: "self", amount: Number(match[1]) },
    ];
  }

  // 5. "Your opponent's Active Pokémon is now Poisoned. During Pokémon
  //    Checkup, put {N} damage counters on that Pokémon instead of 1."
  match = DEFENDER_POISON_N.exec(effect);
  if (match !== null) {
    // Counters → HP (one counter = 10, §12).
    return [
      {
        op: "applyStatus",
        target: "defender",
        status: "poisoned",
        poisonDamage: Number(match[1]) * HP_PER_COUNTER,
      },
    ];
  }

  // 5a. Counters convert to HP here (one counter = 10, §12). A printed 0 is refused.
  match = DEFENDER_CONFUSION_N.exec(effect);
  if (match !== null) {
    const counters = positiveInt(match[1]);
    if (counters !== null) {
      return [
        {
          op: "applyStatus",
          target: "defender",
          status: "confused",
          confusionDamage: counters * HP_PER_COUNTER,
        },
      ];
    }
  }

  // 5b. "During your opponent's next turn, the Defending Pokémon can't retreat.", or "that Pokémon"
  //     as the tail of a compound.
  if (DEFENDER_CANT_RETREAT.test(effect)) {
    return [{ op: "preventRetreat" }];
  }

  // 5c. "Your opponent's Active Pokémon is now Poisoned. During your opponent's
  //     next turn, that Pokémon can't retreat." (Paldean Clodsire "Poison
  //     Ring") — the same lock behind a Poison clause; ops in printed order.
  if (DEFENDER_POISON_CANT_RETREAT.test(effect)) {
    return [
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "preventRetreat" },
    ];
  }

  // 5e. Self retreat lock. It needs both `target` and a turn stamp, because the paralysis clock
  // (§13.4) would clear the flag at the end of the attacker's own turn, before the lock applies.
  if (SELF_CANT_RETREAT.test(effect)) {
    return [{ op: "preventRetreat", target: "self" }];
  }

  // 5f. A delayed effect: the op writes a stamp and the Checkup (§13) fires it. Counters convert to
  // HP here, and a printed 0 is refused.
  match = DELAYED_DEFENDER_COUNTERS.exec(effect);
  if (match !== null) {
    const counters = positiveInt(match[1]);
    if (counters !== null) return [{ op: "scheduleCounters", amount: counters * HP_PER_COUNTER }];
  }

  // 5g. Discards the Defending Pokémon without a Knock Out, so no Prize is taken. A separate op
  // from 5h for that reason.
  if (DELAYED_DEFENDER_DISCARD.test(effect)) {
    return [{ op: "scheduleDiscard" }];
  }

  // 5h. A delayed Knock Out, which does award a Prize.
  if (DELAYED_DEFENDER_KO.test(effect)) {
    return [{ op: "scheduleKnockOut" }];
  }

  // 6a.
  if (OPPONENT_ACTIVE_BASIC_KO.test(effect)) {
    return [conditionGate({ kind: "opponentActiveIsBasic" }, [{ op: "knockOutDefender" }])];
  }

  // 6a-ii.
  if (OPPONENT_ACTIVE_SPECIAL_ENERGY_KO.test(effect)) {
    return [
      conditionGate({ kind: "opponentActiveHasEnergyAttached", energy: "special" }, [
        { op: "knockOutDefender" },
      ]),
    ];
  }

  // 6a-ii-b.
  if (OPPONENT_ACTIVE_SPECIAL_CONDITION_KO.test(effect)) {
    return [
      conditionGate({ kind: "opponentActiveHasSpecialCondition" }, [{ op: "knockOutDefender" }]),
    ];
  }

  // 6a-iii.
  if (SELF_PRIZE_GATE_PARALYZE.test(effect)) {
    return [
      conditionGate({ kind: "yourPrizesRemaining", counts: [1] }, [
        { op: "applyStatus", target: "defender", status: "paralyzed" },
      ]),
    ];
  }

  // 6b. Both Knock Outs resolve in one instant (§8.1), which also orders the Prizes.
  if (BOTH_ACTIVES_KO.test(effect)) {
    return [{ op: "knockOutDefender" }, { op: "knockOutSelf" }];
  }

  // 6c. The self-damage is unconditional and comes before the coin.
  match = SELF_DAMAGE_THEN_COIN_KO.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every self-damage arm carries — a printed 0 is
    // not a cost and would derive a silent no-op.
    if (amount >= 1) {
      return [{ op: "damageSelf", amount }, headsGate([{ op: "knockOutDefender" }])];
    }
  }

  // 6d. One coin with both arms. The heads arm keeps the Basic restriction because
  // `knockOutDefender` only checks that an Active exists.
  if (FLIP_KO_ACTIVE_OR_BENCHED_BASIC.test(effect)) {
    return [
      headsGate(
        [conditionGate({ kind: "opponentActiveIsBasic" }, [{ op: "knockOutDefender" }])],
        [{ op: "knockOutChosen", target: "opponentBench", basicOnly: true }],
      ),
    ];
  }

  // 6e. `opponentAny` covers the Active and the Bench. A printed 0 is refused.
  match = KO_EXACT_DAMAGE_COUNTERS.exec(effect);
  if (match !== null) {
    const counters = positiveInt(match[1]);
    if (counters !== null) {
      return [{ op: "knockOutChosen", target: "opponentAny", damageCountersExactly: counters }];
    }
  }

  match = OPPONENT_ACTIVE_EXACT_COUNTERS_KO.exec(effect);
  if (match !== null) {
    const exactCounters = positiveInt(match[1]);
    if (exactCounters !== null) {
      return [
        conditionGate({ kind: "opponentActiveDamageCountersExactly", count: exactCounters }, [
          { op: "knockOutDefender" },
        ]),
      ];
    }
  }
  if (LEAST_HP_ANY_KO.test(effect)) {
    return [{ op: "knockOutChosen", target: "anyExceptSelf", leastHpRemaining: true }];
  }
  if (KO_BY_THIS_ATTACK_PREVENT_ALL.test(effect)) {
    return [
      conditionGate({ kind: "opponentKnockedOutByDamage" }, [
        { op: "preventDamage", effects: true },
      ]),
    ];
  }
  match = KO_BY_THIS_ATTACK_MORE_PRIZES.exec(effect);
  if (match !== null) {
    const more = Number(match[1]);
    if (more >= 1 && (more === 1) === (match[2] === ""))
      return [{ op: "bountyThisAttack", amount: more }];
  }
  match = KO_EACH_AT_REMAINING_HP.exec(effect);
  if (match !== null) {
    const hp = Number(match[1]);
    if (hp >= 10) return [{ op: "knockOutEach", remainingHpAtMost: hp }];
  }
  if (FLIP_SWITCH_WITH_DECK_POKEMON.test(effect)) {
    return [headsGate([{ op: "switchWithDeckChosen", filter: { kind: "anyPokemon" } }])];
  }
  match = BOTTOM_REVEAL_NAMED_ATTACK_SCALE.exec(effect);
  if (match !== null) {
    const n = Number(match[1]);
    const each = Number(match[2]);
    const attack = match[3] ?? "";
    if (n >= 1 && each >= 10) {
      return [
        {
          op: "revealDeckBottomCount",
          n,
          filter: { kind: "attackNamePokemon", attack },
          recordAs: "revealed",
        },
        { op: "damageDefender", per: each, count: "revealed" },
      ];
    }
  }
  match = EACH_PLAYER_HAND_ATTACH.exec(effect);
  if (match !== null) {
    const max = positiveInt(match[1]);
    if (max !== null) {
      return [
        { op: "attachFromHand", filter: { kind: "basicEnergy" }, max, whose: "opponent" },
        { op: "attachFromHand", filter: { kind: "basicEnergy" }, max },
      ];
    }
  }
  if (DOUBLE_OPPONENT_COUNTERS.test(effect)) {
    return [
      {
        op: "counterEachAll",
        amount: 10,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
        perDamageCounterOnTarget: true,
      },
    ];
  }

  match = LOOK_TOP_COMMA_BENCH.exec(effect);
  if (match !== null) {
    const benchWindow = Number(match[1]);
    if (benchWindow >= 1 && benchWindow <= MAX_PRINTED_LOOK_WINDOW) {
      return [
        {
          op: "lookAtTopN",
          n: benchWindow,
          filter: { kind: "anyPokemon" },
          max: "any",
          dest: "bench",
        },
        { op: "shuffleDeck" },
      ];
    }
  }
  match = LOOK_TOP_COMMA_REVEAL_HAND.exec(effect);
  if (match !== null) {
    const handWindow = Number(match[1]);
    if (handWindow >= 1 && handWindow <= MAX_PRINTED_LOOK_WINDOW) {
      return [
        {
          op: "lookAtTopN",
          n: handWindow,
          filter: { kind: "anyPokemon" },
          max: "any",
          reveal: true,
        },
        { op: "shuffleDeck" },
      ];
    }
  }
  if (SEARCH_ANY_BASIC_TO_BENCH.test(effect)) {
    return [
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: "any" },
      { op: "shuffleDeck" },
    ];
  }
  match = HEAL_EACH_BOTH_SIDES.exec(effect);
  if (match !== null) {
    const healedEach = positiveInt(match[1]);
    if (healedEach !== null) return [{ op: "healEachAll", amount: healedEach }];
  }
  match = OPPONENT_SHUFFLES_HAND_DRAWS.exec(effect);
  if (match !== null) {
    const opponentDraws = positiveInt(match[1]);
    if (opponentDraws !== null) {
      return [
        { op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: opponentDraws } },
      ];
    }
  }
  match = RETRIEVE_BASIC_TO_BENCH.exec(effect);
  if (match !== null) {
    const revived = Number(match[1]);
    if (revived >= 1 && revived <= MAX_PRINTED_ATTACH_COUNT) {
      return [
        {
          op: "discardPileRetrieval",
          filter: { kind: "basicPokemon" },
          dest: "bench",
          max: revived,
        },
      ];
    }
  }
  if (DEVOLVE_EACH_TO_HAND.test(effect)) return [{ op: "devolveEach", toHand: true }];
  match = MOVE_TYPED_ENERGY_SELF_TO_BENCH.exec(effect);
  if (match !== null) {
    const movedType = ENERGY_TYPE_BY_CODE[match[1] ?? ""];
    if (movedType !== undefined) {
      return [
        {
          op: "moveEnergy",
          filter: { kind: "providesEnergy", energyType: movedType },
          max: 1,
          route: "selfToBench",
        },
      ];
    }
  }

  match = SELF_DISCARD_THEN_PARALYZE.exec(effect);
  if (match !== null) {
    const shed = Number(match[1]);
    if (shed >= 1 && shed <= MAX_PRINTED_ATTACH_COUNT) {
      return [
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: shed },
        { op: "applyStatus", target: "defender", status: "paralyzed" },
      ];
    }
  }
  match = PUT_TYPED_SELF_ENERGY_TO_HAND.exec(effect);
  if (match !== null) {
    const returned = Number(match[1]);
    const returnedType = ENERGY_TYPE_BY_CODE[match[2] ?? ""];
    if (returnedType !== undefined && returned >= 1 && returned <= MAX_PRINTED_ATTACH_COUNT) {
      return [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "providesEnergy", energyType: returnedType },
          count: returned,
          to: "hand",
        },
      ];
    }
  }
  match = HEAL_ONE_BENCHED_TYPED.exec(effect);
  if (match !== null) {
    const healed = Number(match[1]);
    const healedType = POKEMON_TYPE_BY_CODE[match[2] ?? ""];
    if (healedType !== undefined && healed >= 1) {
      return [
        {
          op: "healChosen",
          amount: healed,
          zone: "bench",
          filter: { kind: "typedPokemon", pokemonType: healedType },
        },
      ];
    }
  }
  if (DEVOLVE_ACTIVE_TO_HAND.test(effect)) return [{ op: "devolveChosen", defenderOnly: true }];
  match = SEARCH_TRANSFORMATION_TOME.exec(effect);
  if (match !== null) {
    const tomes = Number(match[1]);
    if (tomes >= 1 && tomes <= MAX_PRINTED_ATTACH_COUNT) {
      return [
        {
          op: "searchDeck",
          filter: { kind: "byName", name: "Transformation Tome", cardNoun: true },
          dest: "hand",
          max: tomes,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ];
    }
  }
  match = MAY_SEARCH_NAMED_FRAGMENT_TO_BENCH.exec(effect);
  if (match !== null) {
    return [
      optionalStep(effect, [
        {
          op: "searchDeck",
          filter: { kind: "pokemonNameContaining", fragment: match[1] ?? "" },
          dest: "bench",
          max: "any",
        },
        { op: "shuffleDeck" },
      ]),
    ];
  }
  match = SHUFFLE_POKEMON_OR_BASIC_ENERGY_FROM_DISCARD.exec(effect);
  if (match !== null) {
    const shuffledBack = Number(match[1]);
    if (shuffledBack >= 1 && shuffledBack <= MAX_PRINTED_ATTACH_COUNT) {
      return [
        {
          op: "discardPileRetrieval",
          filter: { kind: "pokemonOrBasicEnergy" },
          dest: "deck",
          max: shuffledBack,
        },
        { op: "shuffleDeck" },
      ];
    }
  }
  match = SEARCH_TYPED_POKEMON_OR_STADIUM.exec(effect);
  if (match !== null) {
    const found = Number(match[1]);
    const foundType = POKEMON_TYPE_BY_CODE[match[2] ?? ""];
    if (foundType !== undefined && found >= 1 && found <= MAX_PRINTED_ATTACH_COUNT) {
      return [
        {
          op: "searchDeck",
          filter: {
            kind: "anyOf",
            filters: [{ kind: "typedPokemon", pokemonType: foundType }, { kind: "stadium" }],
          },
          dest: "hand",
          max: found,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ];
    }
  }
  if (REVEAL_BOTTOM_ITEM.test(effect))
    return [{ op: "bottomFromOpponentHand", filter: { kind: "item" } }];

  // An unrecognised condition clause leaves the sentence unread.
  match = CLAUSE_GATED_OPPONENT_MILL.exec(effect);
  if (match !== null) {
    const millGate = boardConditionForClause(match[1] ?? "");
    const milled = Number(match[2]);
    if (millGate !== null && milled >= 1) {
      return [
        conditionGate(millGate, [{ op: "discardDeckTop", whose: "opponent", count: milled }]),
      ];
    }
  }

  match = CLAUSE_GATED_OPPONENT_COUNTER_FOLD.exec(effect);
  if (match !== null) {
    const foldGate = boardConditionForClause(match[1] ?? "");
    const foldCounters = Number(match[2]);
    if (foldGate !== null && foldCounters >= 1) {
      return [
        conditionGate(foldGate, [
          {
            op: "counterEachAll",
            amount: foldCounters * HP_PER_COUNTER,
            filter: { kind: "anyPokemon" },
            side: "opponent",
            source: "attack",
          },
        ]),
      ];
    }
  }
  match = CLAUSE_GATED_CHOSEN_QUADRUPLE.exec(effect);
  if (match !== null) {
    const quadrupleGate = boardConditionForClause(match[1] ?? "");
    const quadrupled = Number(match[2]);
    if (quadrupleGate !== null && quadrupled >= 1) {
      return [
        conditionGate(quadrupleGate, [
          {
            op: "damageChosen",
            target: "opponentAny",
            // 3 more counters per counter already on the pick: four times the number.
            amount: 30,
            count: quadrupled,
            source: "attack",
            perDamageCounterOnTarget: true,
          },
        ]),
      ];
    }
  }
  match = CLAUSE_GATED_BENCH_COUNTERS.exec(effect);
  if (match !== null) {
    const benchCounterGate = boardConditionForClause(match[1] ?? "");
    const benchCounters = Number(match[2]);
    if (benchCounterGate !== null && benchCounters >= 1) {
      return [
        conditionGate(benchCounterGate, [
          {
            op: "damageChosen",
            target: "opponentBench",
            amount: benchCounters * HP_PER_COUNTER,
            count: 1,
            source: "attack",
          },
        ]),
      ];
    }
  }

  match = DISCARD_ATTACH_UP_TO_OPPONENT_ENERGY.exec(effect);
  if (match !== null) {
    const attachedType = ENERGY_TYPE_BY_CODE[match[1] ?? ""];
    const hostType = POKEMON_TYPE_BY_CODE[match[2] ?? ""];
    if (attachedType !== undefined && hostType !== undefined) {
      return [
        {
          op: "attachFromDiscard",
          filter: { kind: "basicEnergy", energyType: attachedType },
          max: "opponentEnergyInPlay",
          targetType: hostType,
        },
      ];
    }
  }
  match = RANDOM_DISCARD_OPPONENT_HAND_DOWN_TO.exec(effect);
  if (match !== null) {
    const keptInHand = positiveInt(match[1]);
    if (keptInHand !== null)
      return [{ op: "randomFromOpponentHand", to: "discard", untilHandSize: keptInHand }];
  }
  match = MILL_TOP_KEEP_ONE.exec(effect);
  if (match !== null) {
    const window = Number(match[1]);
    if (window >= 2 && window <= MAX_PRINTED_ATTACH_COUNT) {
      return [
        {
          op: "lookAtTopN",
          n: window,
          filter: { kind: "anyCard" },
          max: 1,
          exact: true,
          reveal: true,
          restTo: "discard",
        },
      ];
    }
  }
  match = SEARCH_ENERGY_ATTACH_BENCHED_TYPED.exec(effect);
  if (match !== null) {
    const benchedType = POKEMON_TYPE_BY_CODE[match[1] ?? ""];
    if (benchedType !== undefined) {
      return [
        {
          op: "attachFromDeck",
          filter: { kind: "anyEnergy" },
          max: 1,
          benchOnly: true,
          targetType: benchedType,
        },
        { op: "shuffleDeck" },
      ];
    }
  }
  match = SEARCH_POKEMON_WITH_RESISTANCE.exec(effect);
  if (match !== null) {
    const found = Number(match[1]);
    const resisted = POKEMON_TYPE_BY_CODE[match[2] ?? ""];
    if (resisted !== undefined && found >= 1 && found <= MAX_PRINTED_ATTACH_COUNT) {
      return [
        {
          op: "searchDeck",
          filter: { kind: "pokemonWithResistance", type: resisted },
          dest: "hand",
          max: found,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ];
    }
  }

  // "Discard {N} Basic {X} Energy cards from your hand." Only reached as the head of a
  // `splitAttackCancelClause` split: `payFromHand` in an attack pays what it can and refuses
  // nothing, so an unpayable hand cost must be caught by the sentence's cancel row before §8.5,
  // never inside the program.
  match = HAND_BASIC_ENERGY_COST.exec(effect);
  if (match !== null) {
    // The plural branch captures a digit in [1] and its code in [2]; the singular
    // branch captures the literal "a" in [3] and its code in [4]. Exactly one pair is
    // defined, which is what the closed alternation buys.
    const count = match[1] === undefined ? 1 : Number(match[1]);
    const energyType = ENERGY_TYPE_BY_CODE[match[2] ?? match[4] ?? ""];
    // `>= 1` is the guard every capturing arm here carries — a printed 0 would derive
    // a cost that costs nothing. `energyType !== undefined` cannot fail through the
    // anchor (the class is built from the map's keys) and is spelled anyway, so a
    // widened class refuses LOUDLY rather than filing `undefined` into a filter.
    if (count >= 1 && energyType !== undefined) {
      return [
        {
          op: "payFromHand",
          count,
          to: "discard",
          filter: { kind: "basicEnergy", energyType },
        },
      ];
    }
  }

  // "Discard {N} Basic {X} Energy cards from your hand, and Knock Out your opponent's Active
  // Pokémon." Claimed whole because the sentence splitter only breaks on sentence boundaries. The
  // cost is paid before the Knock Out, and no `conditionGate` wraps the KO since affordability is
  // checked by the cancel row.
  match = HAND_BASIC_ENERGY_COST_KO.exec(effect);
  if (match !== null) {
    const count = Number(match[1]);
    const energyType = ENERGY_TYPE_BY_CODE[match[2] ?? ""];
    if (count >= 1 && energyType !== undefined) {
      return [
        {
          op: "payFromHand",
          count,
          to: "discard",
          filter: { kind: "basicEnergy", energyType },
        },
        { op: "knockOutDefender" },
      ];
    }
  }

  // Turn-scoped hand-play lock (§7.1/§7.2). The trailing form is reached only through
  // `splitAttackGateClause`, which hands this deriver the remainder after a gate sentence.
  match = OPPONENT_CANT_PLAY.exec(effect);
  if (match !== null) {
    return [{ op: "preventHandPlay", bars: handPlayClassOf(match[1]) }];
  }
  match = OPPONENT_CANT_PLAY_TRAILING.exec(effect);
  if (match !== null) {
    return [{ op: "preventHandPlay", bars: handPlayClassOf(match[1]) }];
  }
  // The same lock on Pokémon plays (Evolution Jammer); the `"evolve"` key reaches turn.ts's evolve
  // gate, not `playTrainer`.
  if (OPPONENT_CANT_EVOLVE_FROM_HAND.test(effect)) {
    return [{ op: "preventHandPlay", bars: "evolve" }];
  }
  // The same lock behind a printed discard cost; ops in printed order because the discard is paid
  // first.
  match = SELF_DISCARD_ALL_THEN_HAND_LOCK.exec(effect);
  if (match !== null) {
    return [
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "preventHandPlay", bars: handPlayClassOf(match[1]) },
    ];
  }

  // "This Pokémon recovers from all Special Conditions." `clearStatus` reads `ctx.seat`'s Active,
  // which in an attack program is the attacker, so no `target` is needed.
  if (SELF_RECOVERS_ALL.test(effect)) {
    return [{ op: "clearStatus" }];
  }

  // "This attack does {N} damage to each of your opponent's Benched Pokémon for each Prize card
  // your opponent has taken." The amount is folded by `snipeAmount`; 0 Prizes taken is a silent
  // no-op via `spreadDamage`'s `amount <= 0` early return.
  match = SPREAD_EACH_BENCH_TAKEN_PRIZES.exec(effect);
  if (match !== null) {
    return [
      {
        op: "spreadDamage",
        target: "opponentBench",
        amount: Number(match[1]),
        perTakenPrize: true,
      },
    ];
  }

  // "This attack (also) does {N} damage to each of your opponent's (or your) Benched Pokémon."
  // `damage` is HP; the main hit rides the attack's `damage` field. The own-side form can Knock Out
  // the attacker's own Pokémon and give the opponent a Prize.
  match = SPREAD_EACH_BENCH.exec(effect);
  if (match !== null) {
    // The side is read from the printed possessive.
    const side = match[2] === "your" ? ("yourBench" as const) : ("opponentBench" as const);
    return [{ op: "spreadDamage", target: side, amount: Number(match[1]) }];
  }

  // "This attack does {N} damage to each Benched Pokémon[ that has any damage counters on it] (both
  // yours and your opponent's)." One spread per bench, each taking the full printed amount; the
  // optional clause sets `damagedOnly`.
  match = SPREAD_EACH_BOTH_BENCH.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `damagedOnly` is set only when the optional printed clause matched.
    const damagedOnly = match[2] !== undefined;
    return [
      damagedOnly
        ? { op: "spreadDamage", target: "yourBench", amount, damagedOnly: true }
        : { op: "spreadDamage", target: "yourBench", amount },
      damagedOnly
        ? { op: "spreadDamage", target: "opponentBench", amount, damagedOnly: true }
        : { op: "spreadDamage", target: "opponentBench", amount },
    ];
  }

  // "This attack does {N} damage to each Pokémon that has any damage counters on it (both yours and
  // your opponent's), except for this Pokémon." The gate is first, so damage is read before this
  // attack's own hit. The attacker is excluded structurally: none of the ops targets its own
  // Active.
  match = SPREAD_EACH_DAMAGED_FOUR_ZONE.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[1]);
    if (amount !== null) {
      return [
        conditionGate({ kind: "opponentActiveDamaged" }, [{ op: "damageDefender", amount }]),
        { op: "spreadDamage", target: "yourBench", amount, damagedOnly: true },
        { op: "spreadDamage", target: "opponentBench", amount, damagedOnly: true },
      ];
    }
  }

  // "This attack does {N} damage to each of your opponent's Pokémon." The Active hit (with
  // Weakness/Resistance) comes first, then the flat bench spread at the same amount; the order is
  // observable in the log and in shield coin flips.
  match = SPREAD_EACH_OPPONENT_POKEMON.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    return [
      { op: "damageDefender", amount },
      { op: "spreadDamage", target: "opponentBench", amount },
    ];
  }

  // "This attack does {N} damage to each of your opponent's Pokémon ex[ and Pokémon V]. This
  // attack's damage isn't affected by Weakness or Resistance." One filtered `damageChosen` with
  // `count: "all"`, because the Active is hit only if it matches the filter and W/R must be ignored
  // on it.
  match = SPREAD_EACH_CLASSED_OPPONENT_POKEMON.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    const classFilter = IN_PLAY_BODY_NOUNS.get(match[2] ?? "");
    // A printed 0 is not a real card — left on the loud path, `BENCHED_SNIPE_TAKEN_
    // PRIZES`' rule verbatim one arm down.
    if (amount >= 1 && classFilter !== undefined) {
      return [
        {
          op: "damageChosen",
          target: "opponentAny",
          amount,
          count: "all",
          source: "attack",
          // Bare tail: ignores Weakness/Resistance only; effects on the target still apply.
          wrOnly: true,
          deals: true,
          ignoreWR: true,
          filter: classFilter,
        },
      ];
    }
  }

  // Drifloon/Drifblim own-side spread. `target: "yourAny"` because the printed noun has no zone
  // word, so the attacker itself is hit. No `ignoreWR`: the parenthetical is only the standard
  // bench reminder.
  match = NAMED_BODIES_MULTIPLY_SPREAD.exec(effect);
  if (match !== null) {
    const amount = Number(match[3]);
    const namedFilter = inPlayBodyFilter(match[2] ?? "");
    // A printed 0 is not a real card — left on the loud path, 6a-ter's rule verbatim
    // one arm up.
    if (amount >= 1 && namedFilter !== null) {
      return [
        {
          op: "damageChosen",
          target: "yourAny",
          amount,
          count: "all",
          source: "attack",
          deals: true,
          filter: namedFilter,
        },
      ];
    }
  }

  // 6b. "This attack does N damage to 1 of your opponent's Benched Pokémon for
  //     each Prize card your opponent has taken. (Don't apply Weakness and
  //     Resistance for Benched Pokémon.)" — Wo-Chien ex "Covetous Ivy". A CHOSEN
  //     single benched target (damageChosen's count-1 park), the amount SCALED by
  //     the opponent's TAKEN Prizes and dealt as attack damage (`deals`), not a
  //     placed counter. A printed 0-per is not a real card — left on the loud path.
  match = BENCHED_SNIPE_TAKEN_PRIZES.exec(effect);
  if (match !== null) {
    const per = positiveInt(match[1]);
    if (per !== null) {
      return [
        {
          op: "damageChosen",
          target: "opponentBench",
          amount: per,
          count: 1,
          // Attack damage, so this never reaches the COUNTERS_PLACED path, but the field is
          // required.
          source: "attack",
          deals: true,
          perTakenPrize: true,
        },
      ];
    }
  }

  // "This attack does N damage to 1 of your opponent's Benched Pokémon for each damage counter on
  // that Pokémon." The multiplier is read per target at the answer, not at the park. Without
  // `Benched` the target is `opponentAny`.
  match = BENCHED_SNIPE_TARGET_COUNTERS.exec(effect);
  if (match !== null) {
    const per = positiveInt(match[1]);
    if (per !== null) {
      return [
        {
          op: "damageChosen",
          target: match[2] === undefined ? "opponentAny" : "opponentBench",
          amount: per,
          count: 1,
          source: "attack",
          deals: true,
          perDamageCounterOnTarget: true,
        },
      ];
    }
  }

  // "This attack also does N damage to M of your opponent's Benched Pokémon." The main hit rides
  // the `damage` field. An optional "that has any damage counters on it" narrowing sets
  // `damagedOnly`; it is singular, so it must agree with a count of 1 or the sentence stays loud.
  match = ALSO_BENCHED_SNIPE.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    const count = Number(match[2]);
    // The side is read from the printed possessive.
    const snipeSide = match[3] === "your" ? ("yourBench" as const) : ("opponentBench" as const);
    // An unmapped class noun is treated as a refusal, not as no narrowing, so the sentence stays
    // loud rather than widening the hit.
    const classNoun = match[4];
    const narrowing =
      classNoun === undefined ? undefined : BENCHED_SNIPE_CLASS_NOUNS.get(classNoun);
    const damagedOnly = match[5] !== undefined;
    // The two riders are never co-printed, so the pair is refused rather than resolved.
    const bothRiders = damagedOnly && classNoun !== undefined;
    const readable = classNoun === undefined || narrowing !== undefined;
    const agrees = !damagedOnly || count === 1;
    if (amount >= 1 && count >= 1 && agrees && readable && !bothRiders) {
      if (narrowing !== undefined) {
        return [
          {
            op: "damageChosen",
            target: snipeSide,
            amount,
            count,
            source: "attack",
            deals: true,
            filter: narrowing,
          },
        ];
      }
      // Whole literals rather than a conditional spread: this op is persisted, and an absent key
      // differs from one set to `undefined` on the wire.
      return damagedOnly
        ? [
            {
              op: "damageChosen",
              target: snipeSide,
              amount,
              count,
              source: "attack",
              deals: true,
              damagedOnly: true,
            },
          ]
        : [
            {
              op: "damageChosen",
              target: snipeSide,
              amount,
              count,
              source: "attack",
              deals: true,
            },
          ];
    }
  }

  // "If {clause}, this attack also does N damage to M of your opponent's Benched Pokémon." The
  // clause goes through `boardConditionForClause` so an unmapped clause stays loud. No `otherwise`:
  // the base damage lands regardless.
  match = CONDITIONAL_BENCH_SNIPE.exec(effect);
  if (match !== null) {
    // Psyspear's declaration-time extra-Energy clause is read only here; attack.ts
    // `resolveDeclarationGates` answers it.
    const cond =
      boardConditionForClause(match[1] ?? "") ?? extraEnergyGateForClause(match[1] ?? "");
    const amount = Number(match[2]);
    const count = Number(match[3]);
    // The antecedent's `(.+)` opens first, so the body's groups are `[2]`..`[5]`.
    const gatedSide = match[4] === "your" ? ("yourBench" as const) : ("opponentBench" as const);
    // The narrowing and class groups shift by one here because the antecedent's `(.+)` opens first.
    const gatedClassNoun = match[5];
    const gatedNarrowing =
      gatedClassNoun === undefined ? undefined : BENCHED_SNIPE_CLASS_NOUNS.get(gatedClassNoun);
    const damagedOnly = match[6] !== undefined;
    if (
      cond !== null &&
      amount >= 1 &&
      count >= 1 &&
      (!damagedOnly || count === 1) &&
      (gatedClassNoun === undefined || gatedNarrowing !== undefined) &&
      !(damagedOnly && gatedClassNoun !== undefined)
    ) {
      if (gatedNarrowing !== undefined) {
        return [
          conditionGate(cond, [
            {
              op: "damageChosen",
              target: gatedSide,
              amount,
              count,
              source: "attack",
              deals: true,
              filter: gatedNarrowing,
            },
          ]),
        ];
      }
      return [
        conditionGate(
          cond,
          damagedOnly
            ? [
                {
                  op: "damageChosen",
                  target: gatedSide,
                  amount,
                  count,
                  source: "attack",
                  deals: true,
                  damagedOnly: true,
                },
              ]
            : [
                {
                  op: "damageChosen",
                  target: gatedSide,
                  amount,
                  count,
                  source: "attack",
                  deals: true,
                },
              ],
        ),
      ];
    }
  }

  // "This attack does N damage to M of your opponent's Pokémon." A chosen hit on the Active or
  // Bench; a hit on the Active takes W/R (§8.5). The tail's number word must agree with the count,
  // and "isn't affected by Weakness or Resistance" sets `ignoreWR`.
  match = CHOSEN_ANY_TARGET.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    const count = Number(match[2]);
    const perEnergyOnSelf = match[3] !== undefined;
    const ignoreWR = match[4] !== undefined;
    const number = match[5];
    const agrees = number === undefined || (number === "those") === count > 1;
    // The two riders are never co-printed, so the pair is refused.
    const bothRiders = perEnergyOnSelf && ignoreWR;
    if (amount >= 1 && count >= 1 && agrees && !bothRiders) {
      // Whole literals rather than a spread: this op is persisted, and an absent key differs from
      // one set to `undefined` on the wire.
      if (perEnergyOnSelf) {
        return [
          {
            op: "damageChosen",
            target: "opponentAny",
            amount,
            count,
            source: "attack",
            deals: true,
            perEnergyOnSelf: true,
          },
        ];
      }
      return match[4] === undefined
        ? [
            {
              op: "damageChosen",
              target: "opponentAny",
              amount,
              count,
              source: "attack",
              deals: true,
            },
          ]
        : [
            {
              op: "damageChosen",
              target: "opponentAny",
              amount,
              count,
              source: "attack",
              deals: true,
              ignoreWR: true,
              // Bare tail without "or by any effects on that Pokémon": ignores W/R only.
              ...(number === undefined ? { wrOnly: true as const } : {}),
            },
          ];
    }
  }

  // "Choose 1 of your opponent's Pokémon 6 times... For each time you chose a Pokémon, do 20 damage
  // to it." Six `damageChosen` ops. The print picks all six then damages; the engine interleaves,
  // which yields the same final board because no KO sweep runs mid-program. Only event order
  // differs.
  match = ATTACK_PICK_WITH_REPLACEMENT_SNIPE.exec(effect);
  if (match !== null) {
    const count = Number(match[1]);
    const amount = Number(match[2]);
    // The `>= 1` floor both siblings carry: `COUNTER_SPREAD_ON_OPPONENT` guards
    // `counters >= 1` and `CHOSEN_ANY_TARGET` guards `amount >= 1 && count >= 1`. A
    // printed 0 on either number would emit an EMPTY program — an attack silently
    // reporting an effect that moved nothing — so it falls to the loud
    // `ATTACK_EFFECT_SKIPPED` path instead. Leave it loud.
    if (count >= 1 && amount >= 1) {
      // ONE HIT PER OP — the repetition IS the sequence, so the per-op amount is the
      // PRINTED amount and never the printed total. `amount: amount * count` on one op
      // is the exact direction the sibling's comment names as the way this family goes
      // wrong, and it is a DIFFERENT ACTION here rather than a different number: one op
      // parks once, cannot be answered with a repeat (`cardplay.ts:1419`), and hands a
      // single body 120 in one blow instead of six 20s.
      return Array.from({ length: count }, () => ({
        op: "damageChosen" as const,
        // `opponentAny`, not `opponentBench`: the print says "your opponent's Pokémon"
        // with no zone word, so the ACTIVE is a candidate too.
        target: "opponentAny" as const,
        amount,
        count: 1,
        source: "attack" as const,
        // "do 20 damage to it" is ATTACK DAMAGE (`DAMAGE_DEALT`), not a placed counter
        // (`COUNTERS_PLACED`) — effects.ts:5438.
        deals: true as const,
        // Bare tail: ignores Weakness/Resistance only.
        ignoreWR: true as const,
        wrOnly: true as const,
      }));
    }
  }
  // 7/8/9. "Discard an Energy from this Pokémon." / "Discard {N} Energy from this
  //        Pokémon." / "Discard all Energy from this Pokémon." — the self-discard
  //        attack cost (§8), the first DERIVED attack effect that can PARK: with
  //        two different Energy attached, which one goes is a real decision, so
  //        the attack resolves through the attackEpilogue stage (attack.ts).
  //        "all" has no decision and resolves inline.
  if (SELF_DISCARD_ONE.test(effect)) {
    return [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }];
  }
  match = SELF_DISCARD_N.exec(effect);
  if (match !== null) {
    const count = Number(match[1]);
    // A printed 0 is not a real card and would derive to a silent no-op; leave
    // anything but a positive count on the loud skipped path.
    if (count >= 1) {
      return [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count }];
    }
  }
  if (SELF_DISCARD_ALL.test(effect)) {
    return [
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ];
  }

  // "Discard {all|N} Energy from this Pokémon[. |, and ]this attack does A damage to C of your
  // opponent's Pokémon." The self-discard cost then the snipe, in printed order; both halves may
  // park.
  match = SELF_DISCARD_THEN_ANY_TARGET.exec(effect);
  if (match !== null) {
    const discard = match[1] === "all" ? ("all" as const) : Number(match[1]);
    const amount = Number(match[2]);
    const count = Number(match[3]);
    // A printed 0 in any of the three numbers would be a silent no-op, so each is refused to the
    // loud path.
    if ((discard === "all" || discard >= 1) && amount >= 1 && count >= 1) {
      return [
        // The cost, first, because that is the printed order — and because the
        // snipe's candidates must be read AFTER the discard has run (a Pokémon
        // the cost knocked out of the picture is not a target this op may offer).
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: discard },
        { op: "damageChosen", target: "opponentAny", amount, count, source: "attack", deals: true },
      ];
    }
  }

  // Literal snipe compounds; cost first, in printed order. A printed 0 stays loud.
  match = SELF_SHUFFLE_ALL_THEN_ANY_TARGET.exec(effect);
  if (match !== null && Number(match[1]) >= 1) {
    return [
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "anyEnergy" },
        count: "all",
        to: "deck",
      },
      { op: "shuffleDeck" },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: Number(match[1]),
        count: 1,
        source: "attack",
        deals: true,
      },
    ];
  }
  match = CHOSEN_ANY_TARGET_SPECIAL_ENERGY.exec(effect);
  if (match !== null && Number(match[1]) >= 1) {
    return [
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: Number(match[1]),
        count: 1,
        source: "attack",
        deals: true,
        specialEnergyOnly: true,
      },
    ];
  }
  match = SELF_DISCARD_ALL_THEN_COUNTERS.exec(effect);
  if (match !== null && Number(match[1]) >= 1) {
    return [
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: Number(match[1]) * HP_PER_COUNTER,
        count: 1,
        source: "attack",
      },
    ];
  }

  // Typed snipe anchors. The class is built from the map's keys, so the lookup cannot miss; the
  // check satisfies `noUncheckedIndexedAccess`. A printed 0 stays loud.
  match = CHOSEN_ANY_TARGET_PER_TYPED_ENERGY.exec(effect);
  if (match !== null) {
    const perType = ENERGY_TYPE_BY_CODE[match[2] ?? ""];
    if (perType !== undefined && Number(match[1]) >= 1) {
      return [
        {
          op: "damageChosen",
          target: "opponentAny",
          amount: Number(match[1]),
          count: 1,
          source: "attack",
          deals: true,
          perTypedEnergyOnSelf: perType,
        },
      ];
    }
  }
  match = SELF_DISCARD_TYPED_ALL_THEN_ANY_TARGET.exec(effect);
  if (match !== null) {
    const shedType = ENERGY_TYPE_BY_CODE[match[1] ?? ""];
    if (shedType !== undefined && Number(match[2]) >= 1) {
      return [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "providesEnergy", energyType: shedType },
          count: "all",
        },
        {
          op: "damageChosen",
          target: "opponentAny",
          amount: Number(match[2]),
          count: 1,
          source: "attack",
          deals: true,
        },
      ];
    }
  }

  // "Discard up to N Energy cards from your hand. This attack does A damage to 1 of your opponent's
  // Pokémon for each Energy card you discarded in this way." Uses `payFromHand` (hand cards have no
  // board ref) and `damageChosen.perRecorded`. Discarding nothing folds to 0 and asks for no
  // target, so no cancel clause is needed.
  match = HAND_DISCARD_THEN_SCALED_ANY_TARGET.exec(effect);
  if (match !== null) {
    const cap = Number(match[1]);
    const per = Number(match[2]);
    if (cap >= 1 && per >= 1) {
      return [
        // The discard first, because that is the printed order AND because the fold
        // reads the slot this op files — an op that ran second would score an empty
        // record and deal nothing.
        {
          op: "payFromHand",
          count: "any",
          cap,
          to: "discard",
          filter: { kind: "anyEnergy" },
          recordAs: "discarded",
        },
        {
          op: "damageChosen",
          target: "opponentAny",
          amount: per,
          count: 1,
          source: "attack",
          deals: true,
          perRecorded: "discarded",
        },
      ];
    }
  }

  // "Discard {all|N} [{X}] Energy from this Pokémon[. |, and ]this attack [also ]does A damage to C
  // of your opponent's Benched Pokémon." Cost then bench snipe, in printed order; both halves may
  // park.
  match = SELF_DISCARD_THEN_BENCH_SNIPE.exec(effect);
  if (match !== null) {
    const cost = match[1] === "all" ? ("all" as const) : Number(match[1]);
    // An unreadable type must leave the sentence loud rather than count every attached card. Named
    // `typeCode` to keep this line distinct from its sibling arms.
    const typeCode = match[2];
    const energyType = typeCode === undefined ? undefined : ENERGY_TYPE_BY_CODE[typeCode];
    const hit = Number(match[3]);
    const bodies = Number(match[4]);
    // The side is read from the printed possessive.
    const benchSide = match[5] === "your" ? ("yourBench" as const) : ("opponentBench" as const);
    const costClassNoun = match[6];
    const costNarrowing =
      costClassNoun === undefined ? undefined : BENCHED_SNIPE_CLASS_NOUNS.get(costClassNoun);
    const damagedOnly = match[7] !== undefined;
    const agrees = !damagedOnly || bodies === 1;
    if (
      (cost === "all" || cost >= 1) &&
      hit >= 1 &&
      bodies >= 1 &&
      agrees &&
      (costClassNoun === undefined || costNarrowing !== undefined) &&
      !(damagedOnly && costClassNoun !== undefined) &&
      (typeCode === undefined || energyType !== undefined)
    ) {
      // Whole literals rather than spreads: both ops are persisted, and an absent key differs from
      // one set to `undefined` on the wire.
      const filter =
        energyType === undefined
          ? ({ kind: "anyEnergy" } as const)
          : ({ kind: "providesEnergy", energyType } as const);
      if (costNarrowing !== undefined) {
        return [
          { op: "discardEnergy", from: "yourActive", filter, count: cost },
          {
            op: "damageChosen",
            target: benchSide,
            amount: hit,
            count: bodies,
            source: "attack",
            deals: true,
            filter: costNarrowing,
          },
        ];
      }
      return [
        // The cost, first, because that is the printed order — arm 9b's rule inherited,
        // and load-bearing for the same reason: the snipe's candidates are read AFTER
        // the discard has run.
        { op: "discardEnergy", from: "yourActive", filter, count: cost },
        damagedOnly
          ? {
              op: "damageChosen",
              target: benchSide,
              amount: hit,
              count: bodies,
              source: "attack",
              deals: true,
              damagedOnly: true,
            }
          : {
              op: "damageChosen",
              target: benchSide,
              amount: hit,
              count: bodies,
              source: "attack",
              deals: true,
            },
      ];
    }
  }

  // "Discard all Energy from this Pokémon, and take a Prize card." The discard comes first as
  // printed; the prize parks, so the reverse order would ask for the prize before paying the cost.
  if (SELF_DISCARD_ALL_THEN_TAKE_PRIZE.test(effect)) {
    return [
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "takePrize" },
    ];
  }

  // 10. "Discard a|all|{N} {type} Energy from this Pokémon." — the TYPED
  //     self-discard, the same §8 cost narrowed to one energy type. `{L}` means
  //     an Energy that PROVIDES {L}, not a Basic Lightning card, which is the
  //     whole reason this needs `providesEnergy` rather than `basicEnergy`: a
  //     Luminous Energy attached to Kilowattrel IS a {L} Energy (until another
  //     Special Energy demotes it to {C}), and the attack that just paid its
  //     {L} cost with it must be able to discard it.
  match = TYPED_SELF_DISCARD.exec(effect);
  if (match !== null) {
    // Exactly one of the two notation groups matched; an unmapped brace code
    // cannot reach here (the character class is built from the map's keys).
    const energyType =
      match[2] === undefined ? ENERGY_TYPE_BY_NAME[match[3] ?? ""] : ENERGY_TYPE_BY_CODE[match[2]];
    const amount = match[1];
    if (energyType !== undefined && amount !== undefined) {
      const filter = { kind: "providesEnergy", energyType } as const;
      if (amount === "all") {
        return [{ op: "discardEnergy", from: "yourActive", filter, count: "all" }];
      }
      if (amount === "a") {
        return [{ op: "discardEnergy", from: "yourActive", filter }];
      }
      const count = Number(amount);
      // A printed 0 is not a real card and would derive to a silent no-op —
      // the same guard the untyped exact-N rule carries.
      if (count >= 1) {
        return [{ op: "discardEnergy", from: "yourActive", filter, count }];
      }
    }
  }

  // "<You may discard any amount of|Discard all|Discard up to N> Energy from <this|your> Pokémon.
  // This attack does P damage for each card you discarded in this way." The §9.2 record read as a
  // damage multiplier, two ops in printed order.
  match = ENERGY_DISCARD_SCALED_DAMAGE.exec(effect);
  if (match !== null) {
    // Exactly one of the three filter groups matched, and an unmapped brace code
    // cannot reach here (both alternations are built FROM the maps).
    const energyType =
      match[4] === undefined ? ENERGY_TYPE_BY_NAME[match[5] ?? ""] : ENERGY_TYPE_BY_CODE[match[4]];
    const filter: CardFilter | undefined =
      match[6] !== undefined
        ? { kind: "basicEnergy" }
        : energyType === undefined
          ? undefined
          : { kind: "providesEnergy", energyType };
    const per = Number(match[8]);
    // A printed 0 per-unit or "up to 0" would be a silent no-op, so both stay loud.
    const cap = match[3] === undefined ? undefined : Number(match[3]);
    if (filter !== undefined && per >= 1 && (cap === undefined || cap >= 1)) {
      // "all" strips everything and asks nothing; "any amount" and "up to N" are the same
      // declinable mode with `cap` as the ceiling.
      const count = match[2] === undefined ? ("any" as const) : ("all" as const);
      return [
        // The discard, first, because that is the printed order — and because the
        // damage READS what it filed: `recordAs: "discarded"` is the printed "in
        // this way", an op→op §9.2 record and not a re-scan of the board.
        {
          op: "discardEnergy",
          from: match[7] === "this" ? "yourActive" : "yours",
          filter,
          count,
          ...(cap === undefined ? {} : { cap }),
          recordAs: "discarded" as const,
        },
        { op: "damageDefender", per, count: "discarded" },
      ];
    }
  }

  // "Discard the top N cards of your deck, and this attack does P damage for each <noun> you
  // discarded in this way." The mill records into a slot and the damage counts the filtered subset.
  match = DECK_MILL_FILTERED_SCALED_DAMAGE.exec(effect);
  if (match !== null) {
    const count = Number(match[1]);
    const per = Number(match[2]);
    const filter = milledCardFilter(match[3] ?? "");
    // A printed 0 mill or per-unit stays loud, and an unspellable noun must not derive to an
    // unfiltered count that would multiply the damage.
    if (count >= 1 && per >= 1 && filter !== null) {
      return [
        // The mill first, because that is the printed order — and because the damage
        // READS what it filed: `recordAs: "discarded"` is the printed "in this way",
        // an op→op §9.2 record and not a re-scan of the pile. The distinction is
        // load-bearing rather than stylistic: a pile scan would also count what was
        // already there, which is a different number on every board whose discard
        // pile is not empty.
        { op: "discardDeckTop", whose: "self" as const, count, recordAs: "discarded" as const },
        { op: "damageDefender", per, count: "discarded" as const, countFilter: filter },
      ];
    }
  }

  // "Discard <any amount of | up to N> <noun> from <among your Pokémon | this Pokémon | your hand>,
  // and this attack does P damage for each card you discarded in this way."
  match = COMMA_DISCARD_SCALED_DAMAGE.exec(effect);
  if (match !== null) {
    const commaCap = match[2] === undefined ? undefined : Number(match[2]);
    const commaPer = Number(match[6]);
    const commaType = match[4] === undefined ? undefined : ENERGY_TYPE_BY_CODE[match[4]];
    const commaFilter: CardFilter =
      match[3] !== undefined
        ? { kind: "basicEnergy", ...(commaType === undefined ? {} : { energyType: commaType }) }
        : commaType !== undefined
          ? { kind: "providesEnergy", energyType: commaType }
          : { kind: "anyEnergy" };
    // A printed 0 per card or "up to 0" stays loud.
    if (commaPer >= 1 && (commaCap === undefined || commaCap >= 1)) {
      const commaHit = { op: "damageDefender", per: commaPer, count: "discarded" } as const;
      if (match[5] !== "your hand") {
        return [
          {
            op: "discardEnergy",
            from: match[5] === "this Pokémon" ? "yourActive" : "yours",
            filter: commaFilter,
            count: "any",
            ...(commaCap === undefined ? {} : { cap: commaCap }),
            recordAs: "discarded",
          },
          commaHit,
        ];
      }
      // The declinable hand form requires its printed ceiling; "any amount of … from your hand" is
      // not printed and stays loud.
      if (commaCap !== undefined) {
        return [
          {
            op: "payFromHand",
            count: "any",
            cap: commaCap,
            to: "discard",
            filter: commaFilter,
            recordAs: "discarded",
          },
          commaHit,
        ];
      }
    }
  }

  // All-You-Can-Yeet / Rocket Feathers (uncapped declinable hand discard), Weaponized Swords
  // (`revealFromHand`), Voltaic Fist (a confirm) and Elemental Blast (matched three-type discard).
  match = HAND_DISCARD_ANY_NUMBER.exec(effect);
  if (match !== null) {
    const pay: EffectOp = {
      op: "payFromHand",
      count: "any",
      cap: "any",
      to: "discard",
      ...(match[1] === undefined
        ? {}
        : { filter: { kind: "supporterNameContaining", fragment: "Team Rocket" } }),
      ...(match[2] === undefined ? {} : { recordAs: "discarded" }),
    };
    if (match[2] === undefined) return [pay];
    const per = positiveInt(match[2]);
    if (per !== null) return [pay, { op: "damageDefender", per, count: "discarded" }];
  }
  match = HAND_REVEAL_NAMED_SCALED.exec(effect);
  if (match !== null) {
    const names = (match[1] ?? "").split(/, (?:and )?/);
    const per = Number(match[2]);
    if (per >= 1 && names.length >= 2 && names.every((name) => name.length > 0)) {
      return [
        {
          op: "revealFromHand",
          filter: { kind: "anyOf", filters: names.map((name) => ({ kind: "byName", name })) },
          note: `Reveal any number of ${match[1]} from your hand.`,
          recordAs: "revealed",
        },
        { op: "damageDefender", per, count: "revealed" },
      ];
    }
  }
  match = SELF_DAMAGE_AND_PARALYZE_OPTIONAL.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[1]);
    if (amount !== null) {
      return [
        optionalStep(effect, [
          { op: "damageSelf", amount },
          { op: "applyStatus", target: "defender", status: "paralyzed" },
        ]),
      ];
    }
  }
  match = SELF_DISCARD_THREE_TYPED.exec(effect);
  if (match !== null) {
    const types = [match[1], match[2], match[3]].map((code) => ENERGY_TYPE_BY_CODE[code ?? ""]);
    const [first, second, third] = types;
    if (first !== undefined && second !== undefined && third !== undefined) {
      const typed = (energyType: BasicEnergyType, reserve: BasicEnergyType[]): EffectOp => ({
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType },
        count: 1,
        ...(reserve.length === 0 ? {} : { reserve }),
      });
      return [typed(first, [second, third]), typed(second, [third]), typed(third, [])];
    }
  }

  // Supernatural Shapeshifter: uses the milled Supporter's effect.
  if (MILL_TOP_USE_SUPPORTER_EFFECT.test(effect)) return [{ op: "useMilledSupporterEffect" }];

  // "Discard a[n] [Special|{X}] Energy from your opponent's Active Pokémon", bare and behind a coin
  // flip; the capture decides only the filter. The "Pokémon ex" form is tried first as the more
  // specific sentence and wraps the same op in a condition gate.
  if (OPPONENT_ACTIVE_EX_DISCARD.test(effect)) {
    return [
      conditionGate({ kind: "opponentActiveIsEx" }, [
        { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
      ]),
    ];
  }
  match = OPPONENT_ACTIVE_DISCARD.exec(effect);
  if (match !== null) {
    // Exactly one branch of the alternation matched, and the two notation groups
    // are mutually exclusive — the same read `TYPED_SELF_DISCARD` makes, and an
    // unmapped brace code cannot reach here (the character class is built from
    // the map's keys). `undefined` on all three is the BARE printed article,
    // whose program must stay byte-identical to what it was before this widening.
    const energyType =
      match[2] === undefined ? ENERGY_TYPE_BY_NAME[match[3] ?? ""] : ENERGY_TYPE_BY_CODE[match[2]];
    const filter: CardFilter | undefined =
      match[1] !== undefined
        ? { kind: "specialEnergy" }
        : match[2] === undefined && match[3] === undefined
          ? { kind: "anyEnergy" }
          : // The map lookup cannot fail for a code the alternation admits; the
            // guard exists so a future map edit degrades to the LOUD skipped path
            // rather than to a silently untyped discard, which is the wrong card
            // coming off a real board.
            energyType === undefined
            ? undefined
            : { kind: "providesEnergy", energyType };
    if (filter !== undefined) {
      return [{ op: "discardEnergy", from: "opponentActive", filter }];
    }
  }
  // "Discard all Special Energy from all of your opponent's Pokémon." `count: "all"` resolves
  // inline and never parks.
  if (OPPONENT_EACH_SPECIAL_DISCARD.test(effect)) {
    return [
      {
        op: "discardEnergy",
        from: "opponentEach",
        filter: { kind: "specialEnergy" },
        count: "all",
      },
    ];
  }
  if (FLIP_OPPONENT_ACTIVE_DISCARD.test(effect)) {
    return [
      headsGate([{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }]),
    ];
  }

  // "You may put an|N Energy attached to your opponent's Active [Stage 2 ]Pokémon into their hand."
  // Uses the `optional` wrapper rather than `count: "any"`, which would allow taking one of two.
  // The Stage 2 gate sits outside the "may" so the player is not asked when the answer cannot
  // matter.
  match = MAY_PUT_OPPONENT_ACTIVE_ENERGY_TO_HAND.exec(effect);
  if (match !== null) {
    const amount = match[1];
    // "an" is the printed article and derives to the op's absent-count default
    // of one; anything else is the numeric capture. A printed 0 is not a real
    // card and would derive to a silent no-op behind a real prompt — the `>= 1`
    // guard every sibling numeric arm in this function carries.
    const count = amount === "an" ? undefined : Number(amount);
    if (count === undefined || count >= 1) {
      const put: EffectOp = {
        op: "discardEnergy",
        from: "opponentActive",
        filter: { kind: "anyEnergy" },
        to: "hand",
        // Spread rather than set to `undefined`, so the "an" program is
        // byte-identical to the countless one the bare arm above produces.
        ...(count === undefined ? {} : { count }),
      };
      // `note` is the whole matched sentence, so the prompt shows the printed text.
      const ask: EffectOp = optionalStep(effect, [put]);
      // The Stage 2 gate is the outer op so no Yes/No is asked on a board where it would do
      // nothing.
      return match[2] === undefined
        ? [ask]
        : [conditionGate({ kind: "opponentActiveIsStage2" }, [ask])];
    }
  }

  // "Put an Energy attached to this Pokémon into your hand." Mandatory, so no `optional` wrapper;
  // absent `count` means one.
  if (PUT_SELF_ENERGY_TO_HAND.test(effect)) {
    return [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, to: "hand" }];
  }

  // 13. "Your opponent reveals their hand. Choose a Supporter card you find
  //     there and put it on the bottom of their deck." — Greavard "Underworld
  //     Stroll", the attack twin of Ortega's Supporter sentence (which is
  //     registry-authored: its second sentence gates an opponent draw no attack
  //     prints). Derived rather than registry-authored because CardProgram's
  //     `attack` field is per-CARD and Greavard has a second, effect-less
  //     attack it must not leak onto.
  if (REVEAL_BOTTOM_SUPPORTER.test(effect)) {
    return [{ op: "bottomFromOpponentHand", filter: { kind: "supporter" } }];
  }

  // "This Pokémon also does {N} damage to itself." Never parks. The scaled form's anchor cannot
  // match the flat sentence, so the two arms are mutually exclusive.
  match = SELF_DAMAGE_PER_COUNTER.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[1]);
    if (amount !== null) return [{ op: "damageSelf", amount, perDamageCounterOnSelf: true }];
  }

  match = SELF_DAMAGE.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // A printed 0 is not a real card and would derive to a silent no-op — the
    // same guard the exact-N discard rules carry; leave it on the loud path.
    if (amount >= 1) return [{ op: "damageSelf", amount }];
  }

  // "Discard the top [N cards|card] of your [opponent's] deck." Runs after the attack's damage.
  match = DECK_TOP_MILL.exec(effect);
  if (match !== null) {
    // The singular branch leaves group 1 undefined and means exactly one card.
    const count = match[1] === undefined ? 1 : Number(match[1]);
    const whose = match[2] === undefined ? "self" : "opponent";
    // `count >= 1` is the guard every arm here carries: a printed "top 0 cards" is
    // not a real card and would derive to a silent no-op. No ceiling — the count
    // is CLAMPED to the deck by the op (§8.6), so a malformed 999 mills a deck and
    // stops, which is a legal board state rather than a runaway loop.
    if (count >= 1) return [{ op: "discardDeckTop", whose, count }];
  }

  // "Heal {N} damage from this Pokémon."
  match = SELF_HEAL.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every arm here carries: a printed "Heal 0
    // damage" is not a real card and would derive to a silent no-op — an attack
    // reporting a simulated effect that moved nothing. Leave it loud. No CEILING
    // and no clamp, by contrast: the interpreter clamps the heal to the damage
    // actually present (`healSelf`, Math.min), so a malformed large amount heals
    // an Active to full and stops, which is a legal board state.
    if (amount >= 1) return [{ op: "heal", target: "self", amount }];
  }

  // "Heal {N} damage from each of your Pokémon." `healEach` heals the Active and the Bench.
  match = OWN_BOARD_HEAL.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every arm here carries: a printed "Heal 0
    // damage" is not a real card and would derive to a whole board's worth of
    // silent no-ops. No CEILING, same as the bare self-heal: the interpreter
    // clamps PER POKÉMON to the damage actually present, so a malformed large
    // amount heals the board to full and stops — a legal state.
    if (amount >= 1) return [{ op: "healEach", amount }];
  }

  // "Heal {N} damage from each of your {Basic|Benched} Pokémon." An unknown adjective falls through
  // to the loud path rather than healing every Pokémon.
  match = OWN_BOARD_HEAL_NARROWED.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    const scope = OWN_BOARD_HEAL_NOUNS.get(match[2] ?? "");
    if (amount >= 1 && scope !== undefined) return [{ op: "healEach", amount, ...scope }];
  }

  // "Flip a coin. If heads, <action>." `coinFlipGate` splices `then` only on heads; a tails is a
  // resolved attack, not a skipped effect.
  match = FLIP_SELF_HEAL.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every arm here carries, and it sits OUTSIDE the
    // gate on purpose: a printed "heal 0" would derive to an attack that flips a
    // coin and then does nothing on either face, which is worse than an unread
    // sentence because the flip makes it look like something happened.
    if (amount >= 1) {
      return [headsGate([{ op: "heal", target: "self", amount }])];
    }
  }
  if (FLIP_DECK_TOP_MILL.test(effect)) {
    // No capture at all — the one printing is the SINGULAR, and the `count: 1` is
    // invented at the site exactly as `DECK_TOP_MILL`'s singular branch invents it.
    return [headsGate([{ op: "discardDeckTop", whose: "opponent", count: 1 }])];
  }
  // Coin-gated damage prevention for "this Pokémon" during the opponent's next turn; "from and
  // effects of" sets `effects`.
  if (FLIP_PREVENT_DAMAGE_AND_EFFECTS.test(effect)) {
    return [headsGate([{ op: "preventDamage", effects: true }])];
  }
  if (FLIP_PREVENT_DAMAGE.test(effect)) {
    // `effects` is absent, not `false`, when the sentence does not say "from and effects of".
    return [headsGate([{ op: "preventDamage" }])];
  }
  // Ungated prevention narrowed to an attacker class, with an optional `non-{X}` exclusion. An
  // unresolvable code falls through to the loud path rather than installing a wider block.
  match = PREVENT_DAMAGE_FROM_CLASS.exec(effect);
  if (match !== null) {
    const code = match[1];
    if (code === undefined) return [{ op: "preventDamage", fromClass: { stage: "basic" } }];
    const excludingType = POKEMON_TYPE_BY_CODE[code];
    if (excludingType !== undefined) {
      return [{ op: "preventDamage", fromClass: { stage: "basic", excludingType } }];
    }
  }
  if (PREVENT_DAMAGE_FROM_ANCIENT.test(effect)) {
    return [{ op: "preventDamage", fromClass: { stage: "ancient" } }];
  }
  if (PREVENT_DAMAGE_FUTURE_SIDE_FROM_EX.test(effect)) {
    return [{ op: "installSideAttackBlock", banner: "Future", fromClass: { stage: "ex" } }];
  }
  if (POISON_AND_BAR_HAND_ATTACH.test(effect)) {
    return [
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "markHandAttach", barred: true },
    ];
  }
  if (HAND_ATTACH_ENDS_TURN.test(effect)) return [{ op: "markHandAttach", endsTurn: true }];
  if (BAR_HAND_ATTACH_DEFENDER.test(effect)) return [{ op: "markHandAttach", barred: true }];
  match = HAND_ATTACH_COUNTERS.exec(effect);
  if (match !== null) {
    const counters = positiveInt(match[1]);
    if (counters !== null) return [{ op: "markHandAttach", counters }];
  }
  if (DEFENDER_TWO_COIN_ATTACK_LOCK.test(effect)) return [{ op: "flipLockAttack", coins: 2 }];
  if (TRAINER_PLAY_FLIP_LOCK.test(effect)) return [{ op: "flipLockTrainerPlay" }];
  if (DISCARD_OPPONENT_STADIUM_AND_BAR.test(effect)) {
    return [
      conditionGate({ kind: "opponentStadiumInPlay" }, [
        { op: "discardStadium" },
        { op: "preventHandPlay", bars: "Stadium" },
      ]),
    ];
  }
  match = PREVENT_DAMAGE_FROM_CLASS_D630.exec(effect);
  if (match !== null) {
    const cls = ATTACKER_CLASS_BY_NOUN_D630[match[1] ?? ""];
    if (cls !== undefined) return [{ op: "preventDamage", fromClass: { ...cls } }];
  }
  match = SELF_DAMAGE_REDUCTION_FROM_EVOLUTION.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[1]);
    if (amount !== null) return [{ op: "reduceDamage", amount, fromClass: { stage: "evolution" } }];
  }
  match = SELF_VULNERABLE_NEXT_TURN.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[1]);
    if (amount !== null) return [{ op: "exposeSelf", amount }];
  }
  if (LOOK_AT_OPPONENT_PRIZE.test(effect)) return [{ op: "lookAtPrize", side: "opponent" }];
  if (WIN_AT_ONE_PRIZE.test(effect)) {
    // Bound once so this arm's text stays distinct from the paralyze arm's `cond:` line.
    const atOnePrize: BoardCondition = { kind: "yourPrizesRemaining", counts: [1] };
    return [conditionGate(atOnePrize, [{ op: "winGame" }])];
  }
  // Damage cap: `maxDamage` is an upper bound, so an "or more" sentence is refused rather than
  // installed as an inverted cap.
  match = PREVENT_DAMAGE_UP_TO_CAP.exec(effect);
  if (match !== null && match[2] === "less") {
    const maxDamage = Number(match[1]);
    // `>= 1` is arm 19d's guard verbatim and for its reason: a printed cap of 0
    // would install a record that refuses an attack doing no damage at all — a
    // protection that protects against nothing, announced in the log as though it
    // did. Leave it LOUD rather than record it.
    if (maxDamage >= 1) return [{ op: "preventDamage", maxDamage }];
  }
  // Damage reduction during the opponent's next turn; the only capture is the amount.
  match = SELF_DAMAGE_REDUCTION.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every arm here carries: a printed "takes 0 less
    // damage" would install a record that changes no arithmetic anywhere and emit
    // a row announcing it, which is worse than an unread sentence — it claims a
    // protection that does not exist. Leave it LOUD.
    if (amount >= 1) return [{ op: "reduceDamage", amount }];
  }
  // The compound form (Frigid Block): the discard cost then the reduction, in printed order. The
  // no-Weakness bar has no varying token, so it is a plain `test`.
  if (SELF_NO_WEAKNESS.test(effect)) return [{ op: "installNoWeakness" }];
  match = SELF_DISCARD_ALL_THEN_REDUCTION.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[1]);
    if (amount !== null) {
      return [
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
        { op: "reduceDamage", amount },
      ];
    }
  }
  // Attacker-side damage debuff: two anchors for the two printed subject phrasings, sharing one op.
  match = DEFENDER_ATTACKS_WEAKENED.exec(effect) ?? ATTACKS_BY_DEFENDER_WEAKENED.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // `amount >= 1` is the guard every arm here carries: a printed "do 0 less
    // damage" would install a record that changes no arithmetic anywhere and emit
    // a row announcing a drawback that does not exist. Leave it LOUD.
    if (amount >= 1) return [{ op: "weakenDefenderAttacks", amount }];
  }
  // "During your next turn, the Defending Pokémon takes {N} more damage from attacks (after
  // applying Weakness and Resistance)."
  match = DEFENDER_VULNERABLE_NEXT_TURN.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[1]);
    if (amount !== null) return [{ op: "exposeDefender", amount }];
  }
  // "Until the end of your next turn, the Defending Pokémon's Weakness is now {C}." The printed
  // `{C}` is the op's `type`.
  if (DEFENDER_WEAKNESS_RETYPED.test(effect))
    return [{ op: "retypeDefenderWeakness", type: "Colorless" }];
  // Celebration: the Prize stage, then the shuffle.
  if (HAND_EXACTLY_TAKE_PRIZES_THEN_SHUFFLE.test(effect)) {
    return [
      conditionGate({ kind: "yourHandExactly", count: 30 }, [
        { op: "takePrize", count: 2, thenShuffleHand: true },
      ]),
    ];
  }
  // Overwriting Bolt: the same op with the printed `{L}`, applied as ×2.
  if (DEFENDER_WEAKNESS_OVERWRITTEN.test(effect)) {
    return [{ op: "retypeDefenderWeakness", type: "Lightning", asTimesTwo: true }];
  }
  // "During your next turn, if the Defending Pokémon is Knocked Out, take {N} more Prize cards."
  match = DEFENDER_KO_BOUNTY_NEXT_TURN.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[1]);
    if (amount !== null) return [{ op: "bountyDefender", amount }];
  }
  // Reactive recoil installed by an attack: the trigger is the §9 site's `dealt > 0` gate. The
  // printed counters are converted to HP (× 10) here.
  match = SELF_INSTALLED_RECOIL.exec(effect);
  if (match !== null) {
    const counters = Number(match[1]);
    // `counters >= 1` is the guard every arm here carries: a printed "put 0
    // damage counters" would arm a trap that changes no arithmetic anywhere and
    // emit a row announcing it, which is worse than an unread sentence — it
    // claims a threat that does not exist. Leave it LOUD.
    if (counters >= 1) return [{ op: "installRecoil", amount: counters * HP_PER_COUNTER }];
  }
  // The same trap with `amount: "damageTaken"`: the damage the holder took, resolved at the §9
  // recoil site a turn later. Deliberately not `heal`'s `"dealt"`, which is the attacker's own
  // damage from `ctx.dealt`.
  if (SELF_INSTALLED_RECOIL_TAKEN.test(effect)) {
    // No `>= 1` guard and nothing to guard: there is no capture. The amount is a
    // channel and its zero case is the read site's own `dealt > 0` gate, which has
    // stood since 0.x — an attack that deals nothing triggers no recoil at all.
    return [{ op: "installRecoil", amount: "damageTaken" }];
  }

  // "Heal {N|all} damage from 1 of your [Benched] Pokémon." `zone` carries "Benched". The heal
  // parks and the KO sweep, prizes and turn end still run after it.
  match = CHOSEN_HEAL.exec(effect);
  if (match !== null) {
    const raw = match[1] as string;
    const amount = raw === "all" ? "all" : Number(raw);
    // `amount >= 1` is the guard every arm here carries: a printed "Heal 0
    // damage" would derive to a PROMPT that heals nothing — worse than an unread
    // sentence, because parking a player on a decision with no possible outcome
    // is a lie the loud path never tells. "all" is exempt by construction: it is
    // not a number and cannot be zero, and it whiffs only on an undamaged pick,
    // silently (the single-arm rule). No CEILING, same as the two heal arms
    // above — the interpreter clamps to the damage actually present.
    if (amount === "all" || amount >= 1) {
      // The zone field is OMITTED rather than set to undefined when the printing
      // does not carry the word: the derived op is compared by value against
      // hand-authored registry rows (Potion's `{ op: "healChosen", amount: 30 }`),
      // and an explicit `zone: undefined` key is not `toEqual`-identical to an
      // absent one under the suite's stricter comparisons.
      return [
        match[2] === undefined
          ? { op: "healChosen", amount }
          : { op: "healChosen", amount, zone: "bench" },
      ];
    }
  }

  // "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon."
  // Tried before the fixed-destination arm so a loosened tail here would be observable. `fromBench`
  // is absent: the deriver emits the question, not its answer.
  if (COUNTER_MOVE_TO_CHOSEN.test(effect)) return [{ op: "moveCountersChosen" }];
  // Opponent-to-opponent moves (Sableye; Alakazam). Only the printed zone is a field; budget,
  // source and count come from the engine.
  if (COUNTER_MOVE_OPPONENT_BENCH_TO_ACTIVE.test(effect)) {
    return [{ op: "moveCountersOpponentAnyWay", from: "bench" }];
  }
  if (COUNTER_MOVE_OPPONENT_ANY_WAY.test(effect))
    return [{ op: "moveCountersOpponentAnyWay", from: "any" }];

  // "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon." No
  // capture.
  match = COUNTER_MOVE_TO_DEFENDER.exec(effect);
  if (match !== null) {
    // "all" cannot be zero, so no amount guard; a pick with no counters is a silent whiff. The
    // owner key is omitted rather than set to `undefined` so derived ops compare equal to registry
    // rows.
    return [
      match[1] === undefined
        ? { op: "moveCountersToDefender" }
        : { op: "moveCountersToDefender", ownerPokemon: match[1] },
    ];
  }

  // "Put {N} damage counters on your opponent's Active Pokémon." `source` marks the placement as
  // from an attack.
  match = COUNTER_PUT_ON_DEFENDER.exec(effect);
  if (match !== null) {
    // Counters to HP (one counter = 10, §12). Uses the plural's count, or the singular's literal 1.
    const counters = Number(match[1] ?? match[2]);
    // `counters >= 1` is the guard every arm here carries: a printed "Put 0
    // damage counters" is not a real card and would derive to a silent no-op —
    // an attack reporting a simulated effect that moved nothing. Leave it loud.
    // No CEILING: the op only RAISES damage and the epilogue's sweep resolves
    // whatever it Knocks Out, so a malformed 999 counters KOs the defender and
    // stops, which is a legal board state rather than a runaway.
    if (counters >= 1) {
      return [{ op: "damageActive", amount: counters * HP_PER_COUNTER, source: "attack" }];
    }
  }

  // Arm 22 multiplied by the controller's hand size, read at resolve (`damageActive.per`).
  match = COUNTER_PUT_ON_DEFENDER_PER_HAND_CARD.exec(effect);
  if (match !== null && Number(match[1]) >= 1) {
    return [
      {
        op: "damageActive",
        amount: Number(match[1]) * HP_PER_COUNTER,
        source: "attack",
        per: { kind: "cardsInYourHand" },
      },
    ];
  }

  // "Put {N} damage counters on 1 of your opponent's Benched Pokémon." Must not set `deals`: these
  // are placed counters, not attack damage, so no W/R or damage reduction applies and the event is
  // COUNTERS_PLACED.
  match = COUNTER_PUT_ON_OPPONENT_BENCH.exec(effect);
  if (match !== null) {
    // Counters to HP (one counter = 10, §12), at the producer; the interpreter never sees counters.
    const counters = Number(match[1]);
    // `counters >= 1` is the guard every arm here carries: a printed "Put 0 damage
    // counters" would PARK the attacker on a choice with no possible outcome,
    // which is worse than an unread sentence. Leave it loud.
    if (counters >= 1) {
      return [
        {
          op: "damageChosen",
          target: "opponentBench",
          amount: counters * HP_PER_COUNTER,
          // EXACT, not a ceiling: the printed "1 of" carries no "up to" (the op's
          // own doc block), so the park asks for one on the nose and §8.6 is the
          // only thing that softens it — an empty Bench places nothing.
          count: 1,
          // Provenance printed on the COUNTERS_PLACED row.
          source: "attack",
        },
      ];
    }
  }

  // "Put {N} damage counters on your opponent's [Benched] Pokémon in any way you like." N repeated
  // single-counter ops. Must not set `deals`, so placements on the Active stay flat.
  match = COUNTER_SPREAD_ON_OPPONENT.exec(effect);
  if (match !== null) {
    // Counters to HP at the producer: `amount: 10` on N ops, never one op with `counters * 10`.
    const counters = Number(match[1]);
    // `counters >= 1` is the guard every arm here carries: a printed "Put 0 damage
    // counters" would emit an EMPTY program — an attack silently reporting an
    // effect that moved nothing. Leave it loud.
    if (counters >= 1) {
      // The ZONE is the optional capture and nothing else. `opponentAny` offers the
      // Active TOO (Sinistcha, which omits the word "Benched"); `opponentBench` is
      // Dragapult ex's and Flutter Mane's printed restriction.
      const target = match[2] === undefined ? "opponentAny" : "opponentBench";
      return Array.from({ length: counters }, () => ({
        op: "damageChosen" as const,
        target,
        // ONE counter per op — the distribution IS the sequence, so the per-op
        // amount is the §12 unit and never the printed total.
        amount: 10,
        // EXACT at 1, not a ceiling: each placement is mandatory (no printed "up
        // to", no "you may"), and §8.6 is the only thing that softens it — an empty
        // candidate set places nothing, N times over, which is the printed reading
        // on a board with no legal target.
        count: 1,
        source: "attack" as const,
      }));
    }
  }

  // "Put {N} damage counters on 1 of your opponent's Pokémon for each {noun} in your discard pile.
  // Then, shuffle those Energy cards into your deck." One filter shared by both ops. The placement
  // must run before the retrieval, which empties the pile it counts. Must not set `deals`. A
  // whiffed retrieval still shuffles.
  match = COUNTER_PUT_SCALED_BY_PILE.exec(effect);
  if (match !== null) {
    const pileCounters = Number(match[1]);
    const pileNoun = match[2] ?? "";
    // The printed noun is singular here, so the singular map is used.
    const pileFilter = HAND_SEARCH_SINGULAR.get(pileNoun) ?? typedNounFilter(pileNoun, false);
    if (
      // The family's printed-zero guard, arm 23b's rule verbatim: a printed 0 would park
      // the attacker on a choice with no possible outcome. Leave it loud.
      pileCounters >= 1 &&
      pileFilter !== undefined &&
      // The tail says "those Energy cards", so a head noun that is not a Basic Energy card is
      // refused.
      pileFilter.kind === "basicEnergy"
    ) {
      return [
        {
          op: "damageChosen",
          target: "opponentAny",
          amount: pileCounters * HP_PER_COUNTER,
          count: 1,
          source: "attack",
          // The printed "for each …" as a PAYLOAD and not a flag: the multiplier is a
          // count of matching cards, so what the fold needs handed to it is the filter.
          perDiscardPileCard: pileFilter,
        },
        // "Then, shuffle those Energy cards into your deck." — the SAME filter object, the
        // whole matching pile (`max: "all"`, which resolves FORCED: the clause prints no
        // quantifier and is mandatory), and the trailing shuffle the deck destination
        // requires (`retrieveMove`'s deck arm APPENDS).
        { op: "discardPileRetrieval", filter: pileFilter, dest: "deck", max: "all" },
        { op: "shuffleDeck" },
      ];
    }
  }

  // "Put {N} damage counters on 1 of your opponent's Pokémon." A strict prefix of arm 25's
  // sentence, so the `$` is what keeps it from dropping Nine-Tailed Dance's drawback. Must not set
  // `deals`.
  match = COUNTER_PUT_ON_OPPONENT_ANY.exec(effect);
  if (match !== null) {
    // Counters to HP (one counter = 10, §12), at the producer.
    const anyZoneCounters = Number(match[1] ?? match[2]);
    // `>= 1`, the guard every arm here carries: a printed 0 would PARK the attacker on
    // a choice with no possible outcome. Leave it loud.
    if (anyZoneCounters >= 1) {
      return [
        {
          op: "damageChosen",
          // "1 of your opponent's POKÉMON" — the Active OR a Bench, so `oppAnyRefs`
          // and never empty during an attack.
          target: "opponentAny",
          amount: anyZoneCounters * HP_PER_COUNTER,
          // EXACT at one body, not a ceiling: the print says "1 of" and carries no
          // "up to", so §8.6 is the only thing that softens the pick.
          count: 1,
          source: "attack",
        },
      ];
    }
  }

  // "Choose {M} of your opponent's Pokémon and put {N} damage counters on each of them." Group 1 is
  // the arity, group 2 the amount.
  match = COUNTER_PUT_ON_CHOSEN_OPPONENTS.exec(effect);
  if (match !== null) {
    const chosenBodies = Number(match[1]);
    const chosenCounters = Number(match[2]);
    // BOTH numbers are guarded, and for two different failure modes: a 0 ARITY parks a
    // prompt asking for nothing, a 0 AMOUNT parks a real pick that places nothing.
    if (chosenBodies >= 1 && chosenCounters >= 1) {
      return [
        {
          op: "damageChosen",
          target: "opponentAny",
          amount: chosenCounters * HP_PER_COUNTER,
          count: chosenBodies,
          source: "attack",
        },
      ];
    }
  }

  // "Put {N} damage counters on each Pokémon that has an Ability (both yours and your opponent's)."
  match = COUNTER_FOLD_ON_ABILITY_BODIES.exec(effect);
  if (match !== null) {
    // COUNTERS → HP at the PRODUCER (§12), where every sibling arm converts.
    const abilityFoldCounters = Number(match[1]);
    // `>= 1` — a printed 0 would walk both boards emitting nothing; the interpreter
    // refuses it again at `amount <= 0`, and this is the loud half of that pair.
    if (abilityFoldCounters >= 1) {
      return [
        {
          op: "counterEachAll",
          amount: abilityFoldCounters * HP_PER_COUNTER,
          filter: { kind: "abilityPokemon" },
          // The printed "(both yours and your opponent's)", said as the enum value
          // it is rather than as a modifier on a one-seat op.
          side: "both",
          source: "attack",
        },
      ];
    }
  }

  // "Put {N} damage counters on each of your opponent's Pokémon." `anyPokemon` matches every
  // in-play body, which is what the card says.
  match = COUNTER_FOLD_ON_OPPONENT_ALL.exec(effect);
  if (match !== null) {
    const oppFoldCounters = positiveInt(match[1]);
    if (oppFoldCounters !== null) {
      return [
        {
          op: "counterEachAll",
          amount: oppFoldCounters * HP_PER_COUNTER,
          filter: { kind: "anyPokemon" },
          // `otherSeat(ctx.seat)` alone — their Active AND their Bench, which is what
          // "each of your opponent's Pokémon" prints and what the ZONE-scoped
          // siblings (arm 23, the Bench snipe) deliberately do not say.
          side: "opponent",
          source: "attack",
        },
      ];
    }
  }

  // "…that has any damage counters on it." Adds `damagedOnly`. The two anchors are a prefix pair
  // separated only by the `$`.
  match = COUNTER_FOLD_ON_OPPONENT_DAMAGED.exec(effect);
  if (match !== null) {
    const damagedFoldCounters = positiveInt(match[1]);
    if (damagedFoldCounters !== null) {
      return [
        {
          op: "counterEachAll",
          amount: damagedFoldCounters * HP_PER_COUNTER,
          filter: { kind: "anyPokemon" },
          side: "opponent",
          source: "attack",
          // Any damage counts (`pokemon.damage > 0`); the narrowing is applied while walking the
          // bodies.
          damagedOnly: true,
        },
      ];
    }
  }

  // "Put damage counters on your opponent's Active Pokémon until its remaining HP is {N}." The
  // capture is already HP, so no × 10. A destination of 0 would be lethal, so it is refused.
  match = COUNTER_UNTIL_REMAINING_HP_ACTIVE.exec(effect);
  if (match !== null) {
    const activeRemainingHp = positiveInt(match[1]);
    if (activeRemainingHp !== null) {
      return [
        {
          op: "counterUntilRemainingHp",
          // "your opponent's ACTIVE Pokémon" — one body, and `damageChosen.target`'s
          // vocabulary rather than a second spelling of the same axis.
          target: "opponentActive",
          remainingHp: activeRemainingHp,
          // Marked as an attack so the log does not render it as an Ability.
          source: "attack",
        },
      ];
    }
  }

  // "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is {N}."
  // Each body is filled to `remainingHp` independently, so the op carries no amount.
  match = COUNTER_UNTIL_REMAINING_HP_BENCH.exec(effect);
  if (match !== null) {
    const benchRemainingHp = positiveInt(match[1]);
    if (benchRemainingHp !== null) {
      return [
        {
          op: "counterUntilRemainingHp",
          // The printed zone: their BENCH only, so a defender at 200 remaining HP is
          // untouched by this sentence and touched by arm 23g's.
          target: "opponentBench",
          remainingHp: benchRemainingHp,
          source: "attack",
        },
      ];
    }
  }

  // "During your next turn, this Pokémon can't attack."
  if (SELF_CANT_ATTACK_NEXT_TURN.test(effect)) {
    return [{ op: "preventAttack" }];
  }
  // Side-wide attack locks that require "(This includes new Pokémon that come into play.)". A side
  // record read at each declaration, since the reminder covers Pokémon that do not exist at install
  // time.
  if (SIDE_CANT_ATTACK_NEXT_TURN.test(effect)) {
    return [{ op: "lockSideAttacks", whose: "self", maxEnergy: null }];
  }
  match = OPPONENT_LOW_ENERGY_CANT_ATTACK.exec(effect);
  if (match !== null) {
    return [{ op: "lockSideAttacks", whose: "opponent", maxEnergy: Number(match[1]) }];
  }

  // "During your next turn, this Pokémon can't use {AttackName}." The name is resolved by the
  // interpreter against the holder's attacks. `(.+?)` already refuses an empty name. The capture is
  // apostrophe-folded so punctuation variants produce the same value.
  match = SELF_CANT_USE_ATTACK.exec(effect);
  if (match !== null) {
    return [{ op: "preventAttackUse", attack: foldApostrophes(match[1] ?? "") }];
  }

  // "During your next turn, this Pokémon can't use attacks." A whole-Pokémon lock. It sits below
  // arm 24a so that arm's `[A-Z]` refusal is what routes the string here.
  if (SELF_CANT_USE_ATTACKS.test(effect)) {
    return [{ op: "preventAttack" }];
  }

  // "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot." No clock: the bar
  // is lifted by the §10 clears.
  if (SELF_CANT_USE_NAMED_UNTIL_LEAVES_ACTIVE.test(effect)) {
    return [{ op: "preventAttackUse", attack: "Blaze Blitz", until: "leavesActive" }];
  }

  // "During your next turn, this Pokémon's {AttackName} attack does {N} more damage (before
  // applying Weakness and Resistance)."
  match = SELF_ATTACK_BOOST.exec(effect);
  if (match !== null) {
    const amount = Number(match[2]);
    // `amount >= 1` is the guard every arm in this neighbourhood carries: a
    // printed "does 0 more damage" would install a record that changes no
    // arithmetic anywhere and emit a row announcing a bonus that does not exist,
    // which is worse than an unread sentence. Leave it LOUD. (Arm 24a has no
    // twin guard on its NAME capture, and that absence was measured rather than
    // assumed — `(.+?)` already cannot match an empty string.)
    if (amount >= 1) {
      return [{ op: "boostAttack", attack: foldApostrophes(match[1] ?? ""), amount }];
    }
  }

  // "During your next turn, this Pokémon's {AttackName} attack's base damage is {N}." Replaces the
  // printed base instead of adding to it. A printed 0 would zero the attack, so it stays loud.
  match = SELF_ATTACK_BASE_SET.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[2]);
    if (amount !== null) {
      return [{ op: "boostAttack", attack: foldApostrophes(match[1] ?? ""), amount, base: true }];
    }
  }

  // "[Both Active Pokémon are now Asleep. ]During your next turn, attacks used by this Pokémon do
  // {N} more damage to your opponent's Active Pokémon." No attack name, so `attack: null` applies
  // to every attack. With the prefix, the defender is put to sleep first, then the attacker, then
  // the boost.
  match = SELF_EVERY_ATTACK_BOOST.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[2]);
    if (amount !== null) {
      const boost: EffectOp = { op: "boostAttack", attack: null, amount };
      return match[1] === undefined
        ? [boost]
        : [
            { op: "applyStatus", target: "defender", status: "asleep" },
            { op: "applyStatus", target: "self", status: "asleep" },
            boost,
          ];
    }
  }

  // "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that
  // Pokémon can't use that attack." One op over two sentences, because the first is the antecedent
  // of the second; the attack is chosen at the park.
  if (OPPONENT_CHOSEN_ATTACK_LOCK.test(effect)) {
    return [{ op: "preventChosenAttack" }];
  }

  // "Put {N} damage counters on 1 of your opponent's Pokémon. During your next turn, this Pokémon
  // can't attack." Anchored whole so a prefix match cannot ship the counters without the drawback.
  // The counters may park and the lock installs on the resumed tail.
  match = COUNTER_PUT_ANY_THEN_SELF_LOCK.exec(effect);
  if (match !== null) {
    // Counters to HP (one counter = 10, §12), at the producer.
    const counters = Number(match[1]);
    // `counters >= 1`, the guard every arm carries: a printed 0 would park the
    // attacker on a choice with no possible outcome AND install a drawback for
    // nothing. Leave it loud.
    if (counters >= 1) {
      return [
        {
          op: "damageChosen",
          // Active or Bench, so never empty during an attack. No `deals`: placed counters stay flat
          // even on the Active.
          target: "opponentAny",
          amount: counters * HP_PER_COUNTER,
          // EXACT, not a ceiling: no "up to" is printed.
          count: 1,
          // Provenance printed on the COUNTERS_PLACED row.
          source: "attack",
        },
        { op: "preventAttack" },
      ];
    }
  }

  // "Flip a coin. If tails, during your next turn, this Pokémon can't attack." The lock lands on
  // tails.
  if (FLIP_TAILS_SELF_CANT_ATTACK.test(effect)) {
    return [
      {
        op: "coinFlipGate",
        // Absent on heads-gated programs, never `false`, so they stay equal to registry rows.
        onTails: true,
        then: [{ op: "preventAttack" }],
      },
    ];
  }

  // The Defending Pokémon attack lock: bare, behind an Energy discard, or behind a Basic condition.
  // The stamp turn is derived from `target`.
  if (DEFENDER_CANT_ATTACK_NEXT_TURN.test(effect)) {
    return [{ op: "preventAttack", target: "defender" }];
  }

  if (SELF_DISCARD_ONE_THEN_DEFENDER_LOCK.test(effect)) {
    return [
      // The PARK, and it comes first because it is printed first: with two
      // different Energy attached the pick is a real decision, so the lock behind
      // it installs on the RESUMED tail (Ninetales' compound is the precedent, and
      // this is the first time an OPPONENT-side install has sat behind a park).
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
      { op: "preventAttack", target: "defender" },
    ];
  }
  if (DEFENDER_BASIC_CANT_ATTACK.test(effect)) {
    return [
      {
        op: "conditionGate",
        // "The Defending Pokémon" is the opponent's Active (§8), resolved here where the attack
        // context is known.
        cond: { kind: "opponentActiveIsBasic" },
        // BYTE-IDENTICAL to the second op of the arm above, which is the family's
        // checkable claim on this pair: there is ONE action here, printed two ways,
        // and the gate is a condition in front of it.
        then: [{ op: "preventAttack", target: "defender" }],
      },
    ];
  }
  // The same lock behind the heads face of a coin. Deliberately a separate copy of the bare
  // program; do not merge them into a shared constant.
  if (FLIP_HEADS_DEFENDER_CANT_ATTACK.test(effect)) {
    return [headsGate([{ op: "preventAttack", target: "defender" }])];
  }
  // "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your
  // opponent flips a coin. If tails, that attack doesn't happen." Not a `coinFlipGate`: the locked
  // player flips at each declaration next turn, so the op only installs a stamp.
  if (DEFENDER_FLIP_ATTACK_LOCK.test(effect)) return [{ op: "flipLockAttack" }];
  // "During your opponent's next turn, attacks used by the Defending Pokémon cost {C} more, and its
  // Retreat Cost is {C} more."
  if (DEFENDER_COSTS_TAXED.test(effect)) return [{ op: "taxDefender" }];

  // "Flip a coin. If tails, discard all Energy from this Pokémon." and "…this Pokémon also does {N}
  // damage to itself." The recoil is flat (no W/R or reduction) and runs after the main hit, even
  // if that hit was prevented; a cancelled attack does not run it.
  if (FLIP_TAILS_SELF_DISCARD_ALL.test(effect)) {
    return [
      tailsGate([
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      ]),
    ];
  }
  match = FLIP_TAILS_SELF_DAMAGE.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // The bare arm's guard, verbatim: a printed 0 would derive to a silent no-op,
    // so it stays on the loud ATTACK_EFFECT_SKIPPED path.
    if (amount >= 1) {
      return [tailsGate([{ op: "damageSelf", amount }])];
    }
  }
  // "Flip 2 coins. If both of them are tails, this Pokémon also does {N} damage to itself." Both
  // coins are flipped and logged before the branch, and the recoil lands only when both are tails.
  match = FLIP_TWO_BOTH_TAILS_SELF_DAMAGE.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[1]);
    if (amount !== null) {
      return [tailsGate([{ op: "damageSelf", amount }], 2)];
    }
  }

  // Trainer-path ops printed as attack text. The gust's choice is made by the attacker. It runs
  // before the Knock Out sweep, so a gusted Pokémon that took lethal damage is Knocked Out on the
  // Bench.
  match = ATTACK_DRAW.exec(effect);
  if (match !== null) {
    // The singular branch leaves group 1 undefined and means exactly one card —
    // `DECK_TOP_MILL`'s arrangement, and the only place either arm invents a
    // number instead of reading one.
    const count = match[1] === undefined ? 1 : Number(match[1]);
    // `count >= 1` is the guard every arm here carries: a printed "Draw 0 cards."
    // would derive to an attack that reports a simulated effect and moves
    // nothing. No CEILING — `drawToHand` short-draws on a shallow deck (§14.3
    // deck-out is a turn-START rule), so a malformed large count empties a deck
    // and stops, which is a legal board state.
    if (count >= 1) return [{ op: "drawCards", count }];
  }
  // Draw from the bottom of the deck.
  match = ATTACK_DRAW_BOTTOM.exec(effect);
  if (match !== null) {
    const count = positiveInt(match[1]);
    if (count !== null) return [{ op: "drawCards", count, from: "bottom" }];
  }
  // Each player draws; `drawToHand` short-draws per seat (§8.6).
  match = ATTACK_EACH_PLAYER_DRAW.exec(effect);
  if (match !== null) {
    const count = positiveInt(match[1]);
    if (count !== null) return [{ op: "drawCards", count, who: "eachPlayer" }];
  }
  match = ATTACK_DRAW_UNTIL.exec(effect);
  if (match !== null) {
    const size = Number(match[1]);
    // Same guard, and here it refuses something slightly different: "until you
    // have 0 cards in your hand" is not a small draw, it is a sentence whose op
    // never draws at all (`drawUntilHandSize` NEVER TRIMS a bigger hand), so
    // admitting it would file an effect that is a no-op by construction.
    if (size >= 1) return [{ op: "drawUntilHandSize", size }];
  }

  // "You may …" wrapped in `optional`. `note` is the matched sentence, so the prompt shows the
  // printed text. A 0 count is refused, since it would ask a question whose answers are the same
  // board.
  match = ATTACK_MAY_DRAW.exec(effect);
  if (match !== null) {
    const count = positiveInt(match[1]);
    if (count !== null) {
      return [optionalStep(effect, [{ op: "drawCards", count }])];
    }
  }
  match = ATTACK_MAY_DRAW_UNTIL.exec(effect);
  if (match !== null) {
    const size = positiveInt(match[1]);
    if (size !== null) {
      return [optionalStep(effect, [{ op: "drawUntilHandSize", size }])];
    }
  }

  // `gust` and `switchActive` differ only in which seat switches; crossing them would switch out
  // the attacker instead of bringing up the defender.
  if (ATTACK_GUST.test(effect)) {
    return [{ op: "gust" }];
  }
  if (ATTACK_FLIP_GUST.test(effect)) {
    return [headsGate([{ op: "gust" }])];
  }
  // Self-switch: moves the attacker off the Active Spot. With an empty Bench the attack is still
  // usable and the switch does nothing.
  if (ATTACK_SELF_SWITCH.test(effect)) {
    return [{ op: "switchActive" }];
  }
  // Bench switch narrowed to a type (`targetType`); disjoint from the bare anchor.
  const typedSwitch = ATTACK_SELF_SWITCH_TYPED.exec(effect);
  if (typedSwitch !== null) {
    const targetType = POKEMON_TYPE_BY_CODE[typedSwitch[1] ?? ""];
    // An unreadable code returns null rather than an unnarrowed switch, which would offer the whole
    // Bench.
    if (targetType !== undefined) return [{ op: "switchActive", targetType }];
  }
  if (ATTACK_FLIP_SELF_SWITCH.test(effect)) {
    return [headsGate([{ op: "switchActive" }])];
  }
  // "You may switch this Pokémon…": `optional` parks a confirm and the mandatory switch runs on
  // yes. With an empty Bench the player is still asked and yes does nothing, matching the
  // opponent-switch mirror.
  if (ATTACK_MAY_SELF_SWITCH.test(effect)) {
    return [optionalStep(effect, [{ op: "switchActive" }])];
  }
  // Moves the defender's Active like `gust`, but the defender chooses the replacement.
  if (ATTACK_OPPONENT_SWITCH_OUT.test(effect)) {
    return [{ op: "opponentSwitchOut" }];
  }
  // The printed "You may", wrapped exactly as the two MAY-DRAW arms above are —
  // and this is the FIRST `optional` whose inner op parks for the OTHER seat, so
  // the two questions are asked of two different people in order: the controller
  // consents, then the opponent chooses. Both parks are `resumeTail` parks behind
  // the same `attackEpilogue`, which is what makes the sequence work at all.
  if (ATTACK_MAY_OPPONENT_SWITCH_OUT.test(effect)) {
    return [optionalStep(effect, [{ op: "opponentSwitchOut" }])];
  }
  // Iron Bundle — Interjet: self-switch, then the §9.2 gate, then the opponent chooses their new
  // Active. The gate matters: with an empty Bench the attacker cannot switch, nothing is recorded,
  // and the opponent is never asked.
  if (ATTACK_SELF_SWITCH_THEN_OPPONENT_SWITCH_OUT.test(effect)) {
    return [
      { op: "switchActive", recordAs: "moved" },
      recordGate("moved", [{ op: "opponentSwitchOut" }]),
    ];
  }
  // Both arms promote a new Active and then damage it with `damageNewActive`; they differ only by
  // the `recordGate` for the printed "If you do".
  match = ATTACK_GUST_THEN_DAMAGE_NEW_ACTIVE.exec(effect);
  if (match !== null) {
    return [{ op: "gust" }, { op: "damageNewActive", amount: Number(match[1]) }];
  }
  // The gate reads the recorded promotion, so an opponent with an empty Bench takes no damage.
  match = ATTACK_OPPONENT_SWITCH_OUT_THEN_DAMAGE_NEW_ACTIVE.exec(effect);
  if (match !== null) {
    return [
      { op: "opponentSwitchOut", recordAs: "moved" },
      recordGate("moved", [{ op: "damageNewActive", amount: Number(match[1]) }]),
    ];
  }
  // Destination-side spread: "in any way you like" maps to `anyDest: true`.
  match = ATTACK_MOVE_ANY_AMOUNT_SPREAD.exec(effect);
  if (match !== null) {
    // Absent brace group is the bare noun ("any amount of Energy"); present is the typed one ("any
    // amount of {M} Energy").
    const code = match[1];
    const energyType = code === undefined ? undefined : ENERGY_TYPE_BY_CODE[code];
    // Unreachable in practice since the character class is built from the map's keys; kept for type
    // narrowing and to skip loudly rather than widen to `anyEnergy`.
    if (code === undefined || energyType !== undefined) {
      return [
        {
          op: "moveEnergy",
          filter:
            energyType === undefined
              ? { kind: "anyEnergy" }
              : { kind: "providesEnergy", energyType },
          // "Any amount" is declinable and clamped to the movable count when the prompt is built.
          max: "any",
          // The printed "from your Pokémon" (plural) and "to your other Pokémon …
          // in any way you like" — the two riders, one per endpoint. No `route`:
          // the FREE route is what "your Pokémon"/"your other Pokémon" name, and
          // its `needed: 2` is the printed "other" made structural.
          anySource: true,
          anyDest: true,
        },
      ];
    }
  }
  // Kilowattrel: same as the `max: "all"` arm except `anyDest`, which is the printed "in any way
  // you like".
  if (ATTACK_MOVE_ALL_ENERGY_SELF_TO_BENCH_SPREAD.test(effect)) {
    return [
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: "all",
        route: "selfToBench",
        anyDest: true,
      },
    ];
  }
  // Opponent-board variants of the free and `selfToBench` routes, selected by `side`.
  if (ATTACK_MOVE_ENERGY_OPPONENT_FREE.test(effect)) {
    return [{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, side: "opponent" }];
  }
  // Known approximation: this family is always offered as declinable, even when the print has no
  // "you may" or "up to".
  if (ATTACK_MOVE_ENERGY_OPPONENT_ACTIVE_TO_BENCH.test(effect)) {
    return [
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: 1,
        route: "selfToBench",
        side: "opponent",
      },
    ];
  }
  // Moves the attacker's Energy onto its own Bench. An absent number means the article "an", so
  // `max: 1`.
  match = ATTACK_MOVE_ENERGY_SELF_TO_BENCH.exec(effect);
  if (match !== null) {
    return [
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: match[1] === undefined ? 1 : Number(match[1]),
        route: "selfToBench",
      },
    ];
  }
  // Tornadus `svp-210`/`sv10.5w-078` "Hurricane" — the same move with the noun
  // narrowed. `basicEnergy` is the filter Energy Switch already carries, so the
  // two arms differ by that one word in the op exactly as they do in print.
  if (ATTACK_MOVE_BASIC_ENERGY_SELF_TO_BENCH.test(effect)) {
    return [{ op: "moveEnergy", filter: { kind: "basicEnergy" }, max: 1, route: "selfToBench" }];
  }
  // Castform: the mandatory variant; `max: "all"` is resolved against the board when the op runs.
  if (ATTACK_MOVE_ALL_ENERGY_SELF_TO_BENCH.test(effect)) {
    return [{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: "all", route: "selfToBench" }];
  }
  // Deck search onto your own Bench, followed by `shuffleDeck` so the printed shuffle happens even
  // on a whiff or decline. An absent "up to" group means the article, so `max: 1`.
  match = ATTACK_BENCH_SEARCH.exec(effect);
  if (match !== null) {
    // Groups: 1/5 literal "Basic Pokémon", 2/6 brace-coded "Basic {G} Pokémon", 3/7 a proper name
    // (singular then plural), 4 the printed count.
    const max = match[4] === undefined ? 1 : Number(match[4]);
    const typed = match[2] ?? match[6];
    const name = match[3] ?? match[7];
    // `max >= 1` is the guard every arm here carries: a printed "up to 0" would
    // derive to a search the interpreter turns into a silent no-op that still
    // shuffles — an attack reporting a simulated effect that moved nothing.
    if (max >= 1) {
      // Dispatch on which group matched; the typed group's code is a key into a closed map, and an
      // unmapped code falls through to the loud skip path.
      const filter: CardFilter | undefined =
        typed !== undefined
          ? typedNounFilter(typed, match[6] !== undefined)
          : name !== undefined
            ? { kind: "byName", name }
            : { kind: "basicPokemon" };
      if (filter !== undefined) {
        return [{ op: "searchDeck", filter, dest: "bench", max }, { op: "shuffleDeck" }];
      }
    }
  }
  // Jynx — Inviting Kiss: the bench search with a §9.2 tail moving Energy to the newly benched
  // Pokémon. The whole sentence is one anchor because the tail's "in this way" and "the new Benched
  // Pokémon" refer back to the search.
  if (ATTACK_BENCH_SEARCH_THEN_MOVE.test(effect)) {
    return [
      {
        op: "searchDeck",
        filter: { kind: "basicPokemon" },
        dest: "bench",
        max: 1,
        recordAs: "moved",
      },
      { op: "shuffleDeck" },
      recordGate("moved", [
        {
          op: "moveEnergy",
          filter: { kind: "anyEnergy" },
          max: 1,
          route: "selfToBench",
          destRecorded: "moved",
        },
      ]),
    ];
  }
  // Hand search whose max is the attacker's Bench size, resolved when the op runs; an empty Bench
  // searches nothing but still shuffles. Checked before the sibling arm to keep arm order fixed.
  if (ATTACK_HAND_SEARCH_BENCH_COUNT.test(effect)) {
    return [
      { op: "searchDeck", filter: { kind: "anyCard" }, dest: "hand", max: "yourBenchCount" },
      { op: "shuffleDeck" },
    ];
  }
  // Hand search narrowed by `typedAsAttachedBasicEnergy` to Pokémon matching the types of the
  // source's attached Basic Energy.
  if (ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED.test(effect)) {
    return [
      {
        op: "searchDeck",
        filter: { kind: "anyPokemon" },
        dest: "hand",
        max: 5,
        reveal: true,
        typedAsAttachedBasicEnergy: true,
      },
      { op: "shuffleDeck" },
    ];
  }
  // Deck search into your hand. The noun is looked up in a closed table and a miss is a refusal.
  // `reveal` is set only when the reveal clause is printed. "You may search" derives the same
  // program because `searchDeck` already allows choosing nothing.
  match = ATTACK_HAND_SEARCH.exec(effect);
  if (match !== null) {
    const one = match[1];
    const many = match[5];
    // The noun table is consulted first, then the brace pattern, then a card name. The name must
    // come last so category phrases like "Energy cards" are not read as card names.
    const filter =
      one === undefined
        ? (HAND_SEARCH_PLURAL.get(many ?? "") ??
          typedNounFilter(many ?? "", true) ??
          namedCardNounFilter(many ?? ""))
        : (HAND_SEARCH_SINGULAR.get(one) ?? typedNounFilter(one, false));
    // An absent count means the article (one); `max >= 1` keeps a printed zero on the loud path.
    // "any number of" is kept as `"any"` rather than a number so the prompt text matches the print.
    const max = match[4] !== undefined ? "any" : match[3] === undefined ? 1 : Number(match[3]);
    // Group indices: 4 quantifier, 5 plural noun, 6 distinctness clause, 7 plural reveal.
    const revealed = (match[2] ?? match[7]) !== undefined;
    // "Of different types" is only defined over Basic Energy, so any other noun with that clause is
    // refused loudly.
    const distinct = match[6] !== undefined;
    const spellable = !distinct || filter?.kind === "basicEnergy";
    // The floor guards only a printed number; `"any"` has no digit to be zero.
    if (filter !== undefined && (typeof max !== "number" || max >= 1) && spellable) {
      return [
        {
          op: "searchDeck",
          filter,
          dest: "hand",
          max,
          ...(revealed ? { reveal: true } : {}),
          ...(distinct ? { distinctEnergyTypes: true as const } : {}),
        },
        { op: "shuffleDeck" },
      ];
    }
  }
  // Deck search that evolves this Pokémon (`evolveFromDeck`), followed by a shuffle.
  if (ATTACK_EVOLVE_FROM_DECK.test(effect)) {
    return [{ op: "evolveFromDeck" }, { op: "shuffleDeck" }];
  }
  // Evolves each Benched Pokémon from the deck: one `evolveFromDeck` per occupied Bench slot via
  // `schedule`, with a single trailing shuffle for the printed "Then, shuffle your deck."
  if (ATTACK_EVOLVE_FROM_DECK_EACH_BENCHED.test(effect)) {
    return [{ op: "evolveFromDeckEachBenched" }, { op: "shuffleDeck" }];
  }
  // Duosion: the player chooses 1 of their Pokémon, then `evolveFromDeck` handles the card choice;
  // the single shuffle runs after both choices, even on a whiff or decline.
  if (ATTACK_EVOLVE_FROM_DECK_BODY_CHOICE.test(effect)) {
    return [{ op: "evolveFromDeckChosen" }, { op: "shuffleDeck" }];
  }
  // Team Rocket's Nidorina — Dark Awakening: choose up to N of your typed Pokémon and evolve each
  // from the deck, with one trailing shuffle. An unrecognised brace code falls to the loud path.
  const eachChosen = ATTACK_EVOLVE_FROM_DECK_EACH_CHOSEN.exec(effect);
  if (eachChosen !== null) {
    const max = Number(eachChosen[1]);
    const pokemonType = POKEMON_TYPE_BY_CODE[eachChosen[2] ?? ""];
    // `max >= 1` keeps an unprinted "up to 0" on the loud path rather than
    // deriving a program that chooses nothing and shuffles anyway —
    // `ATTACK_HAND_SEARCH`'s guard one family over, at its second site.
    if (pokemonType !== undefined && max >= 1) {
      return [{ op: "evolveFromDeckEachChosen", max, pokemonType }, { op: "shuffleDeck" }];
    }
  }
  // Opponent-hand family: three arms because the verbs (reveal, discard, choose-and-shuffle) select
  // different ops.
  if (ATTACK_REVEAL_OPPONENT_HAND.test(effect)) {
    return [{ op: "revealOpponentHand" }];
  }
  if (ATTACK_RANDOM_DISCARD_FROM_HAND.test(effect)) {
    return [{ op: "randomFromOpponentHand", to: "discard" }];
  }
  if (ATTACK_RANDOM_SHUFFLE_FROM_HAND.test(effect)) {
    return [{ op: "randomFromOpponentHand", to: "deck" }];
  }
  // Opponent discards cards of their choice from their own hand. An absent count means the article
  // (one); the op clamps to the hand size (§8.6).
  match = ATTACK_OPPONENT_DISCARDS_HAND.exec(effect);
  if (match !== null) {
    const count = match[1] === undefined ? 1 : Number(match[1]);
    if (count >= 1) return [{ op: "opponentDiscardsFromHand", count }];
  }
  // Opponent chooses cards to shuffle into their deck: the discard op with a deck destination, then
  // a separate `shuffleDeck` with `whose: "opponent"`.
  if (ATTACK_OPPONENT_CHOOSES_SHUFFLE_HAND.test(effect)) {
    return [
      { op: "opponentDiscardsFromHand", count: 3, to: "deck" },
      { op: "shuffleDeck", whose: "opponent" },
    ];
  }
  // Two ops in printed order (discard, then a gated second discard) rather than one gated op; the
  // totals match but the prompts differ at a two-card hand.
  match = ATTACK_OPPONENT_DISCARDS_HAND_MORE.exec(effect);
  if (match !== null) {
    const gate = boardConditionForClause(match[1] ?? "");
    const more = Number(match[2]);
    // An UNMAPPED clause falls through to null and stays LOUD —
    // `CONDITIONAL_DAMAGE_CLAUSES`' standing rule, and the floor is the numeric
    // guard every count-bearing arm in this file carries (a printed *"0 more
    // cards"* would derive to an attack claiming a simulated discard of nothing).
    if (gate !== null && more >= 1) {
      return [
        { op: "opponentDiscardsFromHand", count: 1 },
        conditionGate(gate, [{ op: "opponentDiscardsFromHand", count: more }]),
      ];
    }
  }
  // No filter: the printed noun is just "a card".
  if (ATTACK_REVEAL_AND_BOTTOM.test(effect)) {
    return [{ op: "bottomFromOpponentHand" }];
  }
  // Lickitung's "up to 2"; no `maxHp` rider since this sentence prints none.
  match = ATTACK_REVEAL_AND_BENCH_UP_TO.exec(effect);
  if (match !== null) {
    const upTo = Number(match[1]);
    if (upTo >= 1 && upTo <= BENCH_MAX) {
      return [
        { op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench", upTo },
      ];
    }
  }
  if (ATTACK_REVEAL_AND_DISCARD.test(effect)) {
    return [{ op: "bottomFromOpponentHand", dest: "discard" }];
  }
  // Reveals the opponent's hand, then discards every Item and Pokémon Tool card in it with no
  // choice. The filter is `anyOf` since the two categories are disjoint.
  if (ATTACK_REVEAL_AND_SWEEP.test(effect)) {
    return [
      { op: "revealOpponentHand" },
      {
        op: "discardFromOpponentHand",
        filter: { kind: "anyOf", filters: [{ kind: "item" }, { kind: "toolCard" }] },
      },
    ];
  }
  // Discard up to N Pokémon Tools from the opponent's Pokémon. The capture is a ceiling, clamped to
  // what the board offers; a zero count is refused.
  {
    const match = ATTACK_DISCARD_TOOLS_UP_TO.exec(effect);
    if (match !== null) {
      const count = positiveInt(match[1]);
      if (count !== null) return [{ op: "discardTools", count }];
    }
  }
  // This sentence is read here for the reveal and by `deriveAttackDamageMultiplier` for the damage,
  // so the count is never computed off a hidden hand. Only claimed when the fold reader also
  // accepts it, otherwise half the sentence would be dropped. The reveal runs after damage, which
  // changes only log order.
  match = ATTACK_REVEAL_AND_TRAINER_SCALE.exec(effect);
  if (match !== null) {
    const per = Number(match[1]);
    if (per >= 1 && opponentHandFilter(match[2] ?? "") !== null) {
      return [{ op: "revealOpponentHand" }];
    }
  }
  // Kyogre — Riptide: the damage fold is handled by `deriveAttackDamageMultiplier`; a whiffed
  // retrieval still shuffles.
  match = DISCARD_PILE_COUNT_THEN_SHUFFLE.exec(effect);
  if (match !== null && Number(match[1]) >= 1) {
    return [
      { op: "discardPileRetrieval", filter: RIPTIDE_PILE_FILTER, dest: "deck", max: "all" },
      { op: "shuffleDeck" },
    ];
  }
  // Attach from the discard pile, built by `attachFromZoneProgram`. The cross-seat variant attaches
  // three Energy to the opponent's Pokémon as independent declinable choices with `whose:
  // "opponent"`.
  if (ATTACK_OPPONENT_DISCARD_ATTACH.test(effect)) {
    return Array.from({ length: 3 }, () => ({
      op: "attachEnergyFrom" as const,
      source: "discard" as const,
      anyEnergy: true as const,
      declinable: true as const,
      whose: "opponent" as const,
    }));
  }
  match = DISCARD_ATTACH.exec(effect);
  if (match !== null) {
    const program = attachFromZoneProgram(match, "discard");
    if (program !== null) return program;
  }
  // Same attach from the hand, sharing the anchor factory and destination table. A heal amount of
  // "all" is the absent numeric group.
  match = HAND_ATTACH.exec(effect);
  if (match !== null) {
    const program = attachFromZoneProgram(
      match,
      "hand",
      // Group 6 is the whole optional tail; 7 its number and 8 its pronoun. The
      // tail's PRESENCE is group 6, not group 7 — "heal all damage" spells no
      // number, so keying off the number would read every "all" printing as
      // having no tail at all.
      match[6] === undefined
        ? undefined
        : { amount: match[7] === undefined ? "all" : Number(match[7]), pronoun: match[8] ?? "" },
    );
    if (program !== null) return program;
  }
  // Alolan Exeggutor ex — Tropical Frenzy: attach any number of Energy from hand via
  // `attachFromHand`.
  match = ATTACK_HAND_ANY_NUMBER_ATTACH.exec(effect);
  if (match !== null) {
    const destination = DISCARD_ATTACH_DESTINATIONS.get(match[2] ?? "");
    // Only `anyWay` destinations are admitted, since this op's prompt lets cards land on different
    // bodies. Destinations with riders the op cannot express (such as `benchOnly`) are refused
    // rather than widened.
    if (destination?.anyWay === true && Object.keys(destination.riders).length === 0) {
      const energyType = match[1] === undefined ? undefined : ENERGY_TYPE_BY_CODE[match[1]];
      // The brace code resolves through the SAME map its character class was
      // built from, so an unresolvable code is unreachable by construction; the
      // `undefined` guard is the type system's, not a catalog claim.
      if (match[1] === undefined || energyType !== undefined) {
        return [
          {
            op: "attachFromHand",
            // "Basic Energy cards" — never `anyEnergy`: the printed adjective
            // excludes Special Energy, and never `providesEnergy`, because a card
            // in the hand provides nothing (§6.5).
            filter:
              energyType === undefined
                ? { kind: "basicEnergy" }
                : { kind: "basicEnergy", energyType },
            // NO target riders: the print says the bare "your Pokémon", and
            // `destination.riders` is empty on both `anyWay` rows. Spreading it
            // would spell a field the op does not have.
          },
        ];
      }
    }
  }
  // Kilowattrel ex — Return Charge: switch, then the attach gated on the switch. With an empty
  // Bench nothing is switched and nothing is attached.
  match = ATTACK_SELF_SWITCH_THEN_HAND_ATTACH.exec(effect);
  if (match !== null) {
    const program = attachFromZoneProgram(match, "hand");
    if (program !== null) {
      return [{ op: "switchActive", recordAs: "moved" }, recordGate("moved", program)];
    }
  }
  // Deck search that attaches, with an optional §9.2 poison tail. Must come after
  // `ATTACK_HAND_SEARCH` and `ATTACK_BENCH_SEARCH`, which share the opening words.
  match = DECK_SEARCH_ATTACH.exec(effect);
  if (match !== null) {
    const destination = DECK_SEARCH_ATTACH_DESTINATIONS.get(match[6] ?? "");
    // Exactly one of the two branches matched, so at most one code group is set.
    const code = match[1] ?? match[3];
    const energyType = code === undefined ? undefined : ENERGY_TYPE_BY_CODE[code];
    // The absent count IS the article — `ATTACK_DRAW`'s reading for the sixth
    // slice running.
    const count = match[2] === undefined ? 1 : Number(match[2]);
    // Optional second printed noun ("and up to N …").
    const secondCount = match[4] === undefined ? undefined : Number(match[4]);
    const secondCode = match[5];
    const secondType = secondCode === undefined ? undefined : ENERGY_TYPE_BY_CODE[secondCode];
    if (
      destination !== undefined &&
      (code === undefined || energyType !== undefined) &&
      (secondCode === undefined || secondType !== undefined) &&
      // A printed 0 derives to a search that moves nothing and shuffles anyway;
      // the ceiling is the ingested-text guard `DISCARD_ATTACH` carries, shared
      // rather than re-picked so the two attach families cannot disagree about
      // what counts as a printed number.
      count >= 1 &&
      count <= MAX_PRINTED_ATTACH_COUNT &&
      (secondCount === undefined ||
        (secondCount >= 1 &&
          secondCount <= MAX_PRINTED_ATTACH_COUNT &&
          // Two sequential searches equal one two-quota search only if nothing couples them, so two
          // cases are refused: a single-target destination (two maps could split targets) and a
          // §9.2 tail (the second op would overwrite the first's record).
          destination.batch &&
          match[7] === undefined))
    ) {
      const attach: OpOf<"attachFromDeck"> = {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", ...(energyType === undefined ? {} : { energyType }) },
        max: count,
        ...destination.riders,
        // "Attach them to 1 of your Pokémon" needs `oneTarget` so the cards cannot be split; it is
        // omitted at `max: 1`, where it has no effect.
        ...(destination.batch || count === 1 ? {} : { oneTarget: true as const }),
        // `recordAs` is set only when a gate reads it.
        ...(match[7] === undefined ? {} : { recordAs: "moved" as const }),
      };
      // The printed cap is per noun, so the second noun becomes a second `attachFromDeck`. One
      // shuffle at the end, as printed.
      const searches: EffectOp[] =
        secondCount === undefined
          ? [attach]
          : [
              attach,
              {
                op: "attachFromDeck",
                filter: {
                  kind: "basicEnergy",
                  ...(secondType === undefined ? {} : { energyType: secondType }),
                },
                max: secondCount,
                ...destination.riders,
              },
            ];
      // "Then, shuffle your deck" is the trailing op on every printing in this
      // family, and it runs on the whiff and the decline alike — the Nest Ball
      // pattern, read off text rather than authored per card.
      return match[7] === undefined
        ? [...searches, { op: "shuffleDeck" }]
        : [
            ...searches,
            { op: "shuffleDeck" },
            recordGate("moved", [{ op: "applyStatus", target: "self", status: "poisoned" }]),
          ];
    }
  }
  // Overflowing Wishes: one Basic Energy per Benched Pokémon via `attachFromDeck.each`.
  match = EACH_BENCHED_DECK_ATTACH.exec(effect);
  if (match !== null) {
    const energyType = match[1] === undefined ? undefined : ENERGY_TYPE_BY_CODE[match[1]];
    if (match[1] === undefined || energyType !== undefined) {
      return [
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", ...(energyType === undefined ? {} : { energyType }) },
          max: 1,
          benchOnly: true,
          each: true,
        },
        { op: "shuffleDeck" },
      ];
    }
  }
  // Discard pile into hand or onto the Bench. Noun and destination vary independently.
  match = ATTACK_DISCARD_RETRIEVAL.exec(effect);
  if (match !== null) {
    const dest = DISCARD_RETRIEVAL_DESTINATIONS.get(match[5] ?? "");
    // Exactly one noun group matched: singular and plural use their maps, the name group uses
    // `byName`. Table lookups fall through to the brace pattern, never the reverse.
    const filter: CardFilter | undefined =
      match[1] !== undefined
        ? (HAND_SEARCH_SINGULAR.get(match[1]) ?? typedNounFilter(match[1], false))
        : match[3] !== undefined
          ? (HAND_SEARCH_PLURAL.get(match[3]) ?? typedNounFilter(match[3], true))
          : match[4] === undefined
            ? undefined
            : { kind: "byName", name: match[4] };
    // The absent count IS the article — `ATTACK_DRAW`'s reading for the eighth
    // slice running, and here it is the op's `max` rather than a rider, so a
    // singular printing emits `max: 1` outright (there is no absent-means-one
    // field to leave off: `max` is REQUIRED on this op).
    const max = match[2] === undefined ? 1 : Number(match[2]);
    if (
      dest !== undefined &&
      filter !== undefined &&
      // The same printed-number guard the three attach anchors carry, shared
      // rather than re-picked: a printed 0 derives to a silent no-op and an
      // unbounded `\d+` lets one malformed third-party row size a prompt.
      max >= 1 &&
      max <= MAX_PRINTED_ATTACH_COUNT &&
      // A Bench destination may only take a Pokémon noun; nothing downstream checks it.
      (dest !== "bench" || BENCHABLE_RETRIEVAL_KINDS.has(filter.kind))
    ) {
      // No `recordAs`, `exclude` or trailing shuffle: no printing in this family needs them.
      return [{ op: "discardPileRetrieval", filter, dest, max }];
    }
  }
  // "Shuffle up to N … from your discard pile into your deck." Same plural noun resolution as the
  // hand variant, with a required trailing shuffle.
  match = ATTACK_DISCARD_SHUFFLE_BACK.exec(effect);
  if (match !== null) {
    const noun = match[2] ?? "";
    const filter = HAND_SEARCH_PLURAL.get(noun) ?? typedNounFilter(noun, true);
    const max = Number(match[1]);
    if (filter !== undefined && max >= 1 && max <= MAX_PRINTED_ATTACH_COUNT) {
      return [{ op: "discardPileRetrieval", filter, dest: "deck", max }, { op: "shuffleDeck" }];
    }
  }

  // Look at the top N cards.
  match = ATTACK_LOOK_TOP_BENCH.exec(effect);
  if (match !== null) {
    const n = Number(match[1]);
    // The same printed-number guard every arm here carries, shared rather than
    // re-picked: a printed 0 derives to a window nobody looks at, and an
    // unbounded `\d+` lets one malformed third-party row size a prompt. The
    // ceiling is the attach family's, because it is the same question (how large
    // a printed window this engine will believe) and the largest printing in
    // EITHER family is Lapras ex's 20.
    if (n >= 1 && n <= MAX_PRINTED_LOOK_WINDOW) {
      return [
        {
          op: "lookAtTopN",
          n,
          // No Bench-kind guard needed: the noun is the literal "Pokémon" in the pattern.
          filter: { kind: "anyPokemon" },
          // "any number of" is `"any"` so the prompt does not invent a number; the Bench limit
          // still caps the take.
          max: "any",
          dest: "bench",
        },
        // "Shuffle the other cards back into your deck" — the trailing op, off
        // the printed text, running on the whiff and the decline alike (the Nest
        // Ball pattern this op has followed since M5).
        { op: "shuffleDeck" },
      ];
    }
  }
  match = ATTACK_LOOK_TOP_ATTACH.exec(effect);
  if (match !== null) {
    const n = Number(match[1]);
    if (n >= 1 && n <= MAX_PRINTED_LOOK_WINDOW) {
      return [
        {
          op: "attachFromTop",
          n,
          // "Energy cards" — Basic OR Special, so `anyEnergy` and never
          // `basicEnergy`; the op's own doc block makes exactly this call for
          // Hydreigon's identical noun. NEVER `providesEnergy`: provision is a
          // while-ATTACHED property and a card in the deck provides nothing.
          filter: { kind: "anyEnergy" },
          // The printed "any number of", which on THIS op is a real union member
          // rather than a bound — the candidate set is the cap, and a card may
          // not be attached twice.
          max: "any",
          // NO `discardRest`: the leftovers clause here is "**Shuffle** the other
          // cards back into your deck", which is the trailing op below. The op's
          // doc records why the two clauses are not symmetric.
        },
        { op: "shuffleDeck" },
      ];
    }
  }
  // "…and put them back in any order".
  match = ATTACK_REORDER_TOP.exec(effect);
  if (match !== null) {
    // Exactly one of the two groups is defined — the alternation is closed and
    // the arms are mutually exclusive by their fifth word. `side` is derived from
    // WHICH group matched rather than from a re-scan of the text, so the reading
    // and the possessive cannot drift apart.
    const own = match[1];
    const n = Number(own ?? match[2]);
    // The shared printed-number guard, unchanged from the three arms above.
    if (n >= 1 && n <= MAX_PRINTED_LOOK_WINDOW) {
      return [
        own === undefined ? { op: "reorderTop", n, side: "opponent" } : { op: "reorderTop", n },
      ];
    }
  }
  // Inkay: one-card look at the opponent's deck, where the printed "you may" is the alternative to
  // reordering.
  if (ATTACK_OPPONENT_TOP_LOOK_SHUFFLE.test(effect)) {
    return [
      {
        op: "reorderTop",
        n: 1,
        side: "opponent",
        otherwise: [{ op: "shuffleDeck", whose: "opponent" }],
        otherwiseNote: "Have your opponent shuffle their deck.",
      },
    ];
  }
  // Dialga — Time Manipulation: must derive the same ops as the Supporter registry rows with the
  // same sentence.
  match = ATTACK_SEARCH_TOP_ORDER.exec(effect);
  if (match !== null) {
    const n = Number(match[1]);
    // The shared printed-number guard, the same one the three look arms above
    // carry: the ordering window this program ends in is `n` cards deep, so the
    // bound that protects `reorderTop` protects this too.
    if (n >= 1 && n <= MAX_PRINTED_LOOK_WINDOW) {
      return searchTopOrderProgram(n);
    }
  }
  if (ATTACK_LOOK_TOP_DISCARD.test(effect)) {
    return [
      {
        op: "lookAtTopN",
        // The printed singular "the top card" — one, not a captured number.
        n: 1,
        // No noun is printed ("that card"), so the filter is `anyCard`.
        filter: { kind: "anyCard" },
        max: 1,
        dest: "discard",
      },
      // NO trailing `shuffleDeck`, and the absence is printed rather than
      // forgotten: this sentence has no leftovers clause because a one-card
      // window has no leftovers. Adding one would shuffle a deck the print
      // leaves alone — and on the DECLINE it would scramble a top the player
      // deliberately kept, which is the opposite of what the card offers.
    ];
  }

  // Devolve each of the opponent's evolved Pokémon, shuffling the top Stage card into their deck.
  if (DEVOLVE_EACH_TO_DECK.test(effect)) return [{ op: "devolveEach" }];

  // Devolve 1 chosen evolved opponent Pokémon, putting the top Stage card into their hand.
  if (DEVOLVE_CHOSEN_TO_HAND.test(effect)) return [{ op: "devolveChosen" }];

  // Choose 3 of the opponent's Benched Pokémon to keep and shuffle the rest into their deck. No
  // `recordGate` for "If you do": the op itself does not prompt unless there are more than `keep`
  // candidates.
  match = CHOOSE_KEEP_SHUFFLE_REST.exec(effect);
  if (match !== null) {
    const keep = Number(match[1]);
    // The FLOOR, printed rather than defensive: "Choose 0" names no pick, and the
    // complement of an empty pick is the whole Bench under a caption that asked for
    // nothing. Unreadable sentences go to `ATTACK_EFFECT_SKIPPED`, loudly.
    if (keep >= 1) return [{ op: "returnBenchedRest", keep }];
  }

  // Choose N of the opponent's Benched Pokémon and shuffle them into their deck; reached after the
  // trailing gate clause is stripped. Clamps to the Bench size (§8.6).
  match = CHOOSE_SHUFFLE_CHOSEN.exec(effect);
  if (match !== null) {
    const count = Number(match[1]);
    // The FLOOR, printed rather than defensive, mirroring 42-bis's own: "Choose 0"
    // names no pick at all, and a shuffle of nothing is a deck re-order the printed
    // sentence never asked for. Unreadable sentences go to `ATTACK_EFFECT_SKIPPED`,
    // loudly.
    if (count >= 1) return [{ op: "returnBenchedChosen", count }];
  }

  // Return one Benched Pokémon and its attached cards to the deck or hand (`returnBenched`).
  match = RETURN_BENCHED.exec(effect);
  if (match !== null) {
    // The OWN-BOARD arms read `whose: "self"`; the two opponent spellings read
    // `"opponent"`. `dest` is not derived from the verb — the verb is derived
    // from the destination (see the op), so each arm states its destination and
    // the interpreter decides whether that implies a shuffle.
    if (match[2] !== undefined) return [{ op: "returnBenched", whose: "self", dest: "deck" }];
    if (match[3] !== undefined) return [{ op: "returnBenched", whose: "self", dest: "hand" }];
    const shuffleAway: EffectOp = { op: "returnBenched", whose: "opponent", dest: "deck" };
    // Sylveon's coin-gated spelling uses the same op behind the coin gate.
    if (match[4] !== undefined) {
      return [headsGate([shuffleAway])];
    }
    return [shuffleAway];
  }

  // "(You may) discard a Stadium in play."
  if (DISCARD_STADIUM.test(effect)) {
    // The bare imperative is the op ALONE. No gate: an empty zone is §8.6's "do as
    // much as you can" and the op's own silent no-op, which is the correct printed
    // reading — the sentence carries no "if you can't" (the one printing that does
    // is Eternatus `sv08-141`, whose trailing anaphoric clause this anchor refuses).
    return [{ op: "discardStadium" }];
  }
  if (MAY_DISCARD_STADIUM.test(effect)) {
    return [
      {
        // Gated on a Stadium being in play, because `optional` always prompts and an empty zone
        // would give a choice with no effect.
        op: "conditionGate",
        cond: { kind: "stadiumInPlay" },
        then: [
          {
            op: "optional",
            // The WHOLE printed sentence, the op's own contract: it is what the
            // confirm dialog shows, and "you may" is the only thing being asked.
            note: effect,
            then: [{ op: "discardStadium" }],
          },
        ],
      },
    ];
  }
  // "If a Stadium is in play, this attack also does N damage to each of your opponent's Benched
  // Pokémon, and discard that Stadium." Base damage lands first; the spread and discard run
  // afterward.
  match = STADIUM_GATED_BENCH_SPREAD.exec(effect);
  if (match !== null) {
    const amount = positiveInt(match[1]);
    if (amount !== null) {
      return [
        conditionGate({ kind: "stadiumInPlay" }, [
          { op: "spreadDamage", target: "opponentBench", amount },
          { op: "discardStadium" },
        ]),
      ];
    }
  }

  // "Discard your hand and draw N cards." Order matters: discard first, then draw. A short deck
  // draws what it can; deck-out is checked at the next turn's draw (§14.3).
  match = DISCARD_HAND_DRAW.exec(effect);
  if (match !== null) {
    const count = positiveInt(match[1]);
    if (count !== null) {
      return [{ op: "discardHand" }, { op: "drawCards", count }];
    }
  }

  // "Shuffle your hand into your deck. Then, draw N cards." One `handRefresh` op, since the shuffle
  // must happen between moving the hand and drawing. The local is `redrawn` deliberately; do not
  // rename it.
  match = SHUFFLE_HAND_DRAW.exec(effect);
  if (match !== null) {
    const redrawn = positiveInt(match[1]);
    if (redrawn !== null) {
      return [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: redrawn } }];
    }
  }

  // Same as above but drawing one card per card in the opponent's hand; zero is a legal outcome, so
  // no guard.
  if (SHUFFLE_HAND_DRAW_PER_OPPONENT_HAND.test(effect)) {
    return [{ op: "handRefresh", who: "you", draw: { kind: "opponentHandSize" } }];
  }

  // "Discard a card from your hand. If you do, draw N cards." Attacks do not check hand costs, so
  // the §9.2 gate keeps an empty hand from drawing. The local is `drawn` deliberately; do not
  // rename it.
  match = HAND_COST_THEN_DRAW.exec(effect);
  if (match !== null) {
    const drawn = positiveInt(match[1]);
    if (drawn !== null) {
      return [
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        recordGate("paid", [{ op: "drawCards", count: drawn }]),
      ];
    }
  }

  // "Discard a card from your hand. If you do, your opponent discards a card from their hand." The
  // gate stops the opponent's discard when your hand was empty.
  if (HAND_COST_THEN_OPPONENT_DISCARD.test(effect)) {
    return [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      recordGate("paid", [{ op: "opponentDiscardsFromHand", count: 1 }]),
    ];
  }

  // "Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active
  // Pokémon and all attached cards." The gate stops the discard when no such Energy is attached.
  // The `byName` filter uses the catalog's straight apostrophe.
  if (TR_ENERGY_COST_THEN_DISCARD_DEFENDER.test(effect)) {
    return [
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "byName", name: "Team Rocket's Energy" },
        recordAs: "discarded",
      },
      recordGate("discarded", [{ op: "discardDefender" }]),
    ];
  }

  // Heals the damage just dealt: the amount is `"dealt"`, resolved at run time from
  // `EffectContext.dealt`.
  if (SELF_HEAL_DEALT.test(effect)) {
    return [{ op: "heal", target: "self", amount: "dealt" }];
  }

  if (ATTACK_RETURN_SELF_TO_DECK.test(effect)) {
    return [{ op: "returnSelf", dest: "deck" }];
  }

  const coinGate = COIN_GATE_HEAD.exec(effect);
  if (coinGate !== null) {
    const gated = literalClauseRow(COIN_GATED_CONSEQUENTS, coinGate[2] ?? "");
    if (gated !== undefined) {
      const coins = COIN_GATE_COINS[coinGate[1] ?? ""];
      return [{ op: "coinFlipGate", ...(coins === undefined ? {} : { coins }), then: [...gated] }];
    }
  }

  // Target Together.
  const targetTogether = CHOSEN_PER_HEADS_IN_PLAY.exec(effect);
  if (targetTogether !== null) {
    const perHeads = positiveInt(targetTogether[2]);
    if (perHeads !== null) {
      return [
        {
          op: "damageChosen",
          target: "opponentAny",
          amount: perHeads,
          count: 1,
          source: "attack",
          deals: true,
          perHeadsInPlay: { kind: "pokemonNameContaining", fragment: targetTogether[1] ?? "" },
        },
      ];
    }
  }

  // Nullifying Zero.
  const nullifyingZero = FLIP_EACH_OPPONENT_SNIPE.exec(effect);
  if (nullifyingZero !== null) {
    const amount = positiveInt(nullifyingZero[1]);
    if (amount !== null) {
      return [
        {
          op: "damageChosen",
          target: "opponentAny",
          amount,
          count: "all",
          source: "attack",
          deals: true,
          flipEach: true,
        },
      ];
    }
  }

  // Corrosive Liquid.
  if (ATTACK_DISCARD_ALL_TOOLS_AND_SPECIAL.test(effect)) {
    return [
      { op: "discardTools", count: "all" },
      {
        op: "discardEnergy",
        from: "opponentEach",
        filter: { kind: "specialEnergy" },
        count: "all",
      },
    ];
  }

  return null;
}

/**
 * A count-scaled damage clause, `per × count`, shared by the additive, multiply and subtractive
 * readers. It is computed before damage in attack.ts rather than run as an effect op. `per` is
 * always positive; the direction comes from which reader produced it.
 */
export interface AttackDamageBonus {
  per: number;
  count: DamageCountSource;
}

// Additive damage scaling: "This attack does N more damage for each <resource>." This folds per ×
// count onto the printed base before the §8.5 W/R pipeline, so it has its own reader rather than an
// op. "more" is the discriminator: without it the printed N is the per-unit and per × count is the
// whole damage (`deriveAttackDamageMultiplier`). Each additive regex must refuse its no-"more" twin
// and vice versa.
const SELF_COUNTER_SCALE =
  /^This attack does (\d+) more damage for each damage counter on this Pokémon\.$/;

const OPPONENT_PRIZES_SCALE =
  /^This attack does (\d+) more damage for each Prize card your opponent has taken\.$/;

// Prizes the opponent took during their last turn, read from `PlayerSide.prizesTakenOnTurn`.
const OPPONENT_PRIZES_LAST_TURN_SCALE =
  /^This attack does (\d+) more damage for each Prize card your opponent took during their last turn\.$/;

// "that much more": the bonus is the recorded damage itself (`per: 1`, count in HP), read from
// `InPlayPokemon.attackDamageTaken`.
const DAMAGED_LAST_TURN_THAT_MUCH_MORE =
  /^If this Pokémon was damaged by an attack during your opponent['’]s last turn, this attack does that much more damage\.$/;

// Retreat-cost readers, counting {C} in the defender's effective Retreat Cost
// (`effectiveRetreatCost`). Additive adds per {C} to the base; multiply is per {C} only, so a
// retreat-0 defender takes 0. Both apostrophe slots carry `['’]`.
const RETREAT_COST_SCALE =
  /^This attack does (\d+) more damage for each \{C\} in your opponent['’]s Active Pokémon['’]s Retreat Cost\.$/;

// "This attack does N more damage for each damage counter on your opponent's Active Pokémon." A
// `DamageCountSource` member on the additive fold. Disjoint from the self-counter patterns by their
// literal `on this Pokémon\.` tail.
const OPPONENT_COUNTER_SCALE =
  /^This attack does (\d+) more damage for each damage counter on your opponent['’]s Active Pokémon\.$/;

/**
 * "This attack does N more damage for each damage counter on all of your opponent's Pokémon."
 * Counts the opponent's Active and Bench.
 */
const OPPONENT_BOARD_COUNTER_SCALE =
  /^This attack does (\d+) more damage for each damage counter on all of your opponent['’]s Pokémon\.$/;

// Bench counted as Pokémon rather than counters: both Benches (additive only, "(both yours and your
// opponent's)") and the opponent's Bench on both folds. "more" picks the additive fold; without it
// the printed N is the per-unit.
const BOTH_BENCH_SCALE =
  /^This attack does (\d+) more damage for each Benched Pokémon \(both yours and your opponent['’]s\)\.$/;

const OPPONENT_BENCH_SCALE =
  /^This attack does (\d+) more damage for each of your opponent['’]s Benched Pokémon\.$/;

// The attacker's own Bench counted as Pokémon, on both folds. A noun narrowed by "that has …" is
// not matched, so it stays on the skipped path rather than being read as the unfiltered total.
const YOUR_BENCH_SCALE = /^This attack does (\d+) more damage for each of your Benched Pokémon\.$/;

/**
 * "This attack does N more damage for each of your Benched <noun>." where the noun is a bare card
 * name. The `(?!Pokémon\.)` lookahead is load-bearing and this arm runs before `YOUR_BENCH_SCALE`;
 * without it this pattern would also claim "…your Benched Pokémon." with an `anyPokemon` filter.
 */
const YOUR_BENCHED_NOUN_SCALE =
  /^This attack does (\d+) more damage for each of your Benched (?!Pokémon\.)([^.]+)\.$/;

/**
 * "This attack does N more damage for each <noun> on your Bench." A separate anchor from
 * `YOUR_BENCH_SCALE` because the word order differs. The noun is `[^.]+`, resolved by
 * `inPlayBodyFilter`; the map is what refuses unknown nouns.
 */
const YOUR_BENCH_FILTERED_SCALE =
  /^This attack does (\d+) more damage for each ([^.]+) on your Bench\.$/;

const IN_PLAY_BODY_SCALE =
  /^This attack does (\d+) more damage for each of your ((?!opponent)[^.]+) in play\.$/;

const DISCARD_PILE_COUNT_SCALE =
  /^This attack does (\d+) more damage for each ([^.]+) in (your opponent['’]s|your) discard pile\.$/;

// Damage scaled by Energy attached to the opponent's Active or whole board, with an optional type
// filter. An absent token means untyped; an unresolvable token stays loud rather than counting
// everything. The additive form is Active-only because the board-wide additive sentence is not
// printed.
const OPPONENT_ENERGY_SCALE =
  /^This attack does (\d+) more damage for each (?:(.+) )?Energy attached to your opponent['’]s Active Pokémon\.$/;

// Damage scaled by Energy attached to the attacker (or, additive only, all of your Pokémon).
// `attachedEnergyFilter` keeps "no filter printed" (`null`) distinct from "unreadable filter"
// (`undefined`, stays loud). The multiply form accepts an optional "card" after Energy. Sentences
// that attach Energy mid-attack are refused because this count is read at declaration.
const SELF_ENERGY_SCALE =
  /^This attack does (\d+) more damage for each (?:(.+) )?Energy attached to (this Pokémon|all of your Pokémon)\.$/;

/**
 * "…for each {L} Energy attached to all of your Iono's Pokémon." Narrows the board count to the
 * bodies the noun names, resolved through `inPlayBodyFilter`. `(?!opponent)` refuses "all of your
 * opponent's Pokémon", which would otherwise resolve to an owner filter that matches nothing.
 */
const SELF_ENERGY_FILTERED_SCALE =
  /^This attack does (\d+) more damage for each (?:(.+) )?Energy attached to all of your ((?!opponent)[^.]+ Pokémon)\.$/;

// Energy attached to both Active Pokémon, summed. Additive only and untyped, matching the printed
// sentences.
const SELF_ENERGY_BOTH_ACTIVES_SCALE =
  /^This attack does (\d+) more damage for each Energy attached to both Active Pokémon\.$/;

// Benched Pokémon counts narrowed by a board fact. "any {R} Energy" is read by provision. The two
// additive anchors also match `YOUR_BENCHED_NOUN_SCALE`, whose noun map refuses them.
const YOUR_DAMAGED_BENCH_SCALE =
  /^This attack does (\d+) more damage for each of your Benched Pokémon that has any damage counters on it\.$/;

const YOUR_FIRE_BENCH_SCALE =
  /^This attack does (\d+) more damage for each of your Benched Pokémon that has any \{R\} Energy attached\.$/;

// "If <clause>, this attack does N more damage.": the clause is a 0-or-1 indicator. The leading
// `^If` anchor keeps flip sentences and optional-cost sentences off this path. The extra-Energy
// form counts provided units against this attack's effective cost (§8.2), not cards.
const EXTRA_ENERGY_BONUS =
  /^If this Pokémon has at least (\d+) extra Energy attached \(in addition to this attack['’]s cost\), this attack does (\d+) more damage\.$/;

const CONDITIONAL_DAMAGE_BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/**
 * Parse an additive damage-scaling sentence into its `per` and count source, or null. Folded into
 * base damage before Weakness and Resistance by attack.ts.
 */
export function deriveAttackDamageBonus(text: string): AttackDamageBonus | null {
  const effect = text.trim();
  // A printed 0 adds nothing (either arm) — leave it on the loud
  // ATTACK_EFFECT_SKIPPED path, the guard the self-damage / exact-N discard rules
  // carry.
  const selfCounters = SELF_COUNTER_SCALE.exec(effect);
  if (selfCounters !== null) {
    const per = positiveInt(selfCounters[1]);
    if (per !== null) return { per, count: { kind: "damageCountersOnSelf" } };
  }
  const opponentPrizes = OPPONENT_PRIZES_SCALE.exec(effect);
  if (opponentPrizes !== null) {
    const per = positiveInt(opponentPrizes[1]);
    if (per !== null) return { per, count: { kind: "opponentPrizesTaken" } };
  }
  const lastTurnPrizes = OPPONENT_PRIZES_LAST_TURN_SCALE.exec(effect);
  if (lastTurnPrizes !== null) {
    const per = positiveInt(lastTurnPrizes[1]);
    if (per !== null) return { per, count: { kind: "opponentPrizesTakenLastTurn" } };
  }
  if (DAMAGED_LAST_TURN_THAT_MUCH_MORE.test(effect))
    return { per: 1, count: { kind: "attackDamageTakenLastTurnOnSelf" } };
  const retreatCost = RETREAT_COST_SCALE.exec(effect);
  if (retreatCost !== null) {
    const per = positiveInt(retreatCost[1]);
    if (per !== null) return { per, count: { kind: "opponentActiveRetreatCost" } };
  }
  const opponentCounters = OPPONENT_COUNTER_SCALE.exec(effect);
  if (opponentCounters !== null) {
    const per = positiveInt(opponentCounters[1]);
    if (per !== null) return { per, count: { kind: "damageCountersOnOpponentActive" } };
  }
  const opponentBoardCounters = OPPONENT_BOARD_COUNTER_SCALE.exec(effect);
  if (opponentBoardCounters !== null) {
    const per = positiveInt(opponentBoardCounters[1]);
    if (per !== null) return { per, count: { kind: "damageCountersOnOpponentBoard" } };
  }
  const bothBench = BOTH_BENCH_SCALE.exec(effect);
  if (bothBench !== null) {
    const per = positiveInt(bothBench[1]);
    if (per !== null) return { per, count: { kind: "bothSidesBenchCount" } };
  }
  const opponentBench = OPPONENT_BENCH_SCALE.exec(effect);
  if (opponentBench !== null) {
    const per = positiveInt(opponentBench[1]);
    if (per !== null) return { per, count: { kind: "opponentBenchCount" } };
  }
  // Bench count narrowed by a bare printed name. Deliberately checked before the unfiltered arm it
  // narrows; see `YOUR_BENCHED_NOUN_SCALE`.
  const yourBenchNoun = YOUR_BENCHED_NOUN_SCALE.exec(effect);
  if (yourBenchNoun !== null) {
    const per = Number(yourBenchNoun[1]);
    const filter = inPlayBodyFilter(yourBenchNoun[2] ?? "");
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "yourBenchCount", filter } };
    }
  }
  const yourBench = YOUR_BENCH_SCALE.exec(effect);
  if (yourBench !== null) {
    const per = positiveInt(yourBench[1]);
    if (per !== null) return { per, count: { kind: "yourBenchCount" } };
  }
  // An absent filter means every Benched Pokémon; `filter !== null` keeps unknown nouns on the loud
  // skipped path.
  const yourBenchFiltered = YOUR_BENCH_FILTERED_SCALE.exec(effect);
  if (yourBenchFiltered !== null) {
    const per = Number(yourBenchFiltered[1]);
    const filter = inPlayBodyFilter(yourBenchFiltered[2] ?? "");
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "yourBenchCount", filter } };
    }
  }
  // Checked after the bench arms above: `YOUR_BENCHED_NOUN_SCALE` also matches these sentences, but
  // its map refuses them.
  const damagedBench = YOUR_DAMAGED_BENCH_SCALE.exec(effect);
  if (damagedBench !== null && Number(damagedBench[1]) >= 1) {
    return { per: Number(damagedBench[1]), count: { kind: "damagedBenchedPokemon" } };
  }
  const fireBench = YOUR_FIRE_BENCH_SCALE.exec(effect);
  if (fireBench !== null && Number(fireBench[1]) >= 1) {
    return {
      per: Number(fireBench[1]),
      count: { kind: "benchedPokemonWithEnergy", energyType: "Fire" },
    };
  }
  // Counts the attacker's Pokémon in play (Active plus Bench), filtered by the printed noun;
  // unknown nouns stay loud.
  const inPlayBodies = IN_PLAY_BODY_SCALE.exec(effect);
  if (inPlayBodies !== null) {
    const per = Number(inPlayBodies[1]);
    const filter = inPlayBodyFilter(inPlayBodies[2] ?? "");
    if (per >= 1 && filter !== null) {
      // The pattern's `(?!opponent)` lookahead means it never matches an opponent-side noun, so the
      // seat is always "you".
      return { per, count: { kind: "pokemonInPlay", seat: "you", filter } };
    }
  }
  // The seat comes from the printed noun phrase (capture 3), never from which reader matched.
  const yourDiscard = DISCARD_PILE_COUNT_SCALE.exec(effect);
  if (yourDiscard !== null) {
    const per = Number(yourDiscard[1]);
    const filter = discardPileFilter(yourDiscard[2] ?? "");
    const seat: DiscardPileSeat = yourDiscard[3] === "your" ? "you" : "opponent";
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "cardsInDiscardPile", seat, filter } };
    }
  }
  // Active zone only: this additive spelling never prints a board-wide variant. An unresolvable
  // type token stays loud.
  const opponentEnergy = OPPONENT_ENERGY_SCALE.exec(effect);
  if (opponentEnergy !== null) {
    const per = Number(opponentEnergy[1]);
    const energyType = attachedEnergyFilter(opponentEnergy[2]);
    if (per >= 1 && energyType !== undefined) {
      return { per, count: { kind: "energyOnOpponent", zone: "active", energyType } };
    }
  }
  // "this Pokémon" counts the attacker's own Energy; the wider phrase counts the whole board. An
  // unresolvable type token stays loud.
  const selfEnergy = SELF_ENERGY_SCALE.exec(effect);
  if (selfEnergy !== null) {
    const per = Number(selfEnergy[1]);
    const energyType = attachedEnergyFilter(selfEnergy[2]);
    if (per >= 1 && energyType !== undefined) {
      return selfEnergy[3] === "this Pokémon"
        ? { per, count: { kind: "energyOnSelf", energyType } }
        : { per, count: { kind: "energyOnSelf", zone: "board", energyType } };
    }
  }
  const selfEnergyFiltered = SELF_ENERGY_FILTERED_SCALE.exec(effect);
  if (selfEnergyFiltered !== null) {
    const per = Number(selfEnergyFiltered[1]);
    const energyType = attachedEnergyFilter(selfEnergyFiltered[2]);
    const filter = inPlayBodyFilter(selfEnergyFiltered[3] ?? "");
    if (per >= 1 && energyType !== undefined && filter !== null) {
      // `zone: "board"` is HARD-CODED and the anchor's own literal is why — it spells
      // `all of your ` and nothing else, so there is no second zone to capture. The
      // same call `IN_PLAY_BODY_SCALE`'s arm makes about its seat, for the same reason.
      return { per, count: { kind: "energyOnSelf", zone: "board", energyType, filter } };
    }
  }
  const bothActivesEnergy = SELF_ENERGY_BOTH_ACTIVES_SCALE.exec(effect);
  if (bothActivesEnergy !== null) {
    const per = positiveInt(bothActivesEnergy[1]);
    if (per !== null) return { per, count: { kind: "bothActivesEnergyCount" } };
  }
  const extraEnergy = EXTRA_ENERGY_BONUS.exec(effect);
  if (extraEnergy !== null) {
    const per = Number(extraEnergy[2]);
    const extra = Number(extraEnergy[1]);
    // The threshold has no guard: "at least 0 extra" is still read correctly.
    if (per >= 1) return { per, count: { kind: "extraEnergyUnitsBeyondCost", extra } };
  }
  // Conditional flat bonus, checked last because its clause capture is the loosest pattern. An
  // unmapped clause returns null so it stays loud rather than scoring 0.
  const conditional =
    CONDITIONAL_DAMAGE_BONUS.exec(effect) ?? CONDITIONAL_BONUS_SUPPRESSED.exec(effect);
  if (conditional !== null) {
    const cond = boardConditionForClause(conditional[1] ?? "");
    if (cond !== null) {
      const per = Number(conditional[2]);
      // A printed 0 adds nothing — the guard every arm in this family carries.
      if (per >= 1) return { per, count: { kind: "boardCondition", cond } };
    }
  }
  return null;
}

// "This attack does N less damage for each damage counter on this Pokémon." A third fold (keep the
// base, subtract), so a separate reader rather than a negative `per`, which would break the
// `scaledTotal > 0` guard and the "+" log crumb.
const SELF_COUNTER_PENALTY =
  /^This attack does (\d+) less damage for each damage counter on this Pokémon\.$/;

// Subtractive retreat-cost twin: "This attack does N less damage for each {C} in your opponent's
// Active Pokémon's Retreat Cost."
const RETREAT_COST_PENALTY =
  /^This attack does (\d+) less damage for each \{C\} in your opponent['’]s Active Pokémon['’]s Retreat Cost\.$/;

// Penalty fold counting Energy on the opponent's Active (`energyOnOpponent`).
const OPPONENT_ENERGY_PENALTY =
  /^This attack does (\d+) less damage for each Energy attached to your opponent['’]s Active Pokémon\.$/;

/**
 * Parse a subtractive damage-scaling sentence ("This attack does N less damage for each …") into
 * `{per, count}`, or null. The printed base is kept and `per × count` is subtracted before Weakness
 * and Resistance.
 */
export function deriveAttackDamagePenalty(text: string): AttackDamageBonus | null {
  const effect = text.trim();
  // A printed 0 subtracts nothing — the guard every arm in BOTH families carries,
  // and it keeps such a printing on the loud ATTACK_EFFECT_SKIPPED path rather
  // than silently claiming to simulate a sentence that does nothing.
  const selfCounters = SELF_COUNTER_PENALTY.exec(effect);
  if (selfCounters !== null) {
    const per = positiveInt(selfCounters[1]);
    if (per !== null) return { per, count: { kind: "damageCountersOnSelf" } };
  }
  const retreatCost = RETREAT_COST_PENALTY.exec(effect);
  if (retreatCost !== null) {
    const per = positiveInt(retreatCost[1]);
    if (per !== null) return { per, count: { kind: "opponentActiveRetreatCost" } };
  }
  const opponentEnergy = OPPONENT_ENERGY_PENALTY.exec(effect);
  if (opponentEnergy !== null) {
    const per = positiveInt(opponentEnergy[1]);
    if (per !== null)
      return { per, count: { kind: "energyOnOpponent", zone: "active", energyType: null } };
  }
  return null;
}

// "This attack does N damage for each damage counter on this Pokémon." The multiply twin of
// SELF_COUNTER_SCALE and SELF_COUNTER_PENALTY on the same count source.
const SELF_COUNTER_MULTIPLY =
  /^This attack does (\d+) damage for each damage counter on this Pokémon\.$/;

// The "×"/multiply twin of OPPONENT_PRIZES_SCALE — the SAME Prize-count source, no
// "more": the whole damage is `per × count`, the printed base dropped (attack.ts).
// Refuses Wo-Chien ex's benched-target print ("… to 1 of your opponent's Benched
// Pokémon for each Prize …") by the mid-sentence text the anchors exclude, and
// Chien-Pao ex's discarded-Energy count ("… for each card you discarded in this
// way.") by the tail.
const OPPONENT_PRIZES_MULTIPLY =
  /^This attack does (\d+) damage for each Prize card your opponent has taken\.$/;

// Own-side twin ("…Prize card you have taken."), read as `yourPrizesTaken`.
const YOUR_PRIZES_MULTIPLY = /^This attack does (\d+) damage for each Prize card you have taken\.$/;

const RETREAT_COST_MULTIPLY =
  /^This attack does (\d+) damage for each \{C\} in your opponent['’]s Active Pokémon['’]s Retreat Cost\.$/;

// The multiply twin of OPPONENT_COUNTER_SCALE: "This attack does N damage for each damage counter on
// your opponent's Active Pokémon."
const OPPONENT_COUNTER_MULTIPLY =
  /^This attack does (\d+) damage for each damage counter on your opponent['’]s Active Pokémon\.$/;

/**
 * "This attack does N damage for each Special Condition affecting your opponent's Active Pokémon."
 * A separate anchor because both the noun and the preposition differ; merging them would admit
 * unprinted combinations.
 */
const OPPONENT_CONDITION_COUNT_MULTIPLY =
  /^This attack does (\d+) damage for each Special Condition affecting your opponent['’]s Active Pokémon\.$/;

// "This attack does N damage for each damage counter on all of your Benched Pokémon." Tallies every
// Pokémon on the attacker's Bench.
const BENCH_COUNTER_MULTIPLY =
  /^This attack does (\d+) damage for each damage counter on all of your Benched Pokémon\.$/;

/**
 * The bench-wide counter tally narrowed by a printed noun, e.g. "…on all of your Benched {F}
 * Pokémon." The whole noun is captured and resolved by `inPlayBodyFilter`. The noun need not end in
 * "Pokémon" (e.g. "Benched Rattata."); `(?!Pokémon\.)` keeps the bare "Benched Pokémon." on
 * `BENCH_COUNTER_MULTIPLY` alone.
 */
const BENCH_COUNTER_FILTERED_MULTIPLY =
  /^This attack does (\d+) damage for each damage counter on all of your Benched ((?!Pokémon\.)[^.]+)\.$/;

const OPPONENT_BENCH_MULTIPLY =
  /^This attack does (\d+) damage for each of your opponent['’]s Benched Pokémon\.$/;

const YOUR_BENCH_MULTIPLY = /^This attack does (\d+) damage for each of your Benched Pokémon\.$/;

// "This attack does N [more] damage for each of your <noun> in play." The noun is resolved by
// `inPlayBodyFilter`. The `(?!opponent)` lookahead is load-bearing: without it the capture would
// swallow "opponent's Pokémon ex" and score the opponent's sentence off the attacker's board. The
// capture is `[^.]+` so it cannot span a sentence break into a compound.
const IN_PLAY_BODY_MULTIPLY =
  /^This attack does (\d+) damage for each of your ((?!opponent)[^.]+) in play\.$/;

/**
 * The opponent's Pokémon in play, a separate anchor from the attacker's (which keeps its
 * `(?!opponent)` lookahead). The noun is `[^.]+` so it cannot span a sentence break.
 */
const IN_PLAY_FOE_BODY_MULTIPLY =
  /^This attack does (\d+) damage for each of your opponent['’]s ([^.]+) in play\.$/;

/**
 * "This attack does N damage for each of your Pokémon that has any damage counters on it." The
 * narrowing is a board fact carried as `damagedOnly` on the count, so the noun still goes through
 * `inPlayBodyFilter`. `(?!opponent)` keeps the attacker's anchor off an opponent-side sentence.
 */
const IN_PLAY_DAMAGED_BODY_MULTIPLY =
  /^This attack does (\d+) damage for each of your ((?!opponent)[^.]+) that has any damage counters on it\.$/;

/**
 * "This attack does N damage for each of your Pokémon in play that has the <name> attack."
 * "Pokémon" is a literal so the whole phrase resolves to one `attackNamePokemon` filter (there is
 * no intersection combinator); only the bare "Pokémon" head is read.
 */
const IN_PLAY_ATTACK_NAME_MULTIPLY =
  /^This attack does (\d+) damage for each of your Pokémon in play that has the ([^.]+) attack\.$/;

/**
 * "This attack does N damage for each Pokémon in play that has "A" or "B" in its name (both yours
 * and your opponent's)." Exactly two name fragments, captured with `([^"]+)` between the printed
 * quotes and combined with `anyOf`; other arities fall to the skipped path.
 */
const IN_PLAY_BOTH_SIDES_NAME_MULTIPLY =
  /^This attack does (\d+) damage for each Pokémon in play that has "([^"]+)" or "([^"]+)" in its name \(both yours and your opponent['’]s\)\.$/;

// "This attack does N [more] damage for each <noun> in your [opponent's] discard pile." The seat is
// captured from the printed words, never inferred from the fold. The noun goes through a closed map
// rather than a `(.+) card` capture, so an unknown noun stays loud instead of counting zero
// forever. `[^.]+` cannot cross a sentence break.
const DISCARD_PILE_COUNT_MULTIPLY =
  /^This attack does (\d+) damage for each ([^.]+) in (your opponent['’]s|your) discard pile\.$/;

/**
 * "This attack does N damage for each Pokémon in your discard pile that has the X attack." A
 * separate anchor rather than a widening of the pile anchors. The attack name is captured because
 * it is a catalog column, so a misspelling matches nothing loudly; only the attacker's own pile is
 * printed.
 */
const DISCARD_PILE_ATTACK_NAME_MULTIPLY =
  /^This attack does (\d+) damage for each Pokémon in your discard pile that has the ([^.]+) attack\.$/;

// Damage scaled by cards in the opponent's hand. Counting the whole hand leaks nothing since hand
// size is public; a filtered count ("Trainer card you find there") is only legitimate because the
// sentence reveals the hand first, which is why the reveal op reads the same anchor.
const OPPONENT_HAND_COUNT_MULTIPLY =
  /^This attack does (\d+) damage for each ([^.]+) in your opponent['’]s hand\.$/;

// The attacker's own hand, bare noun only.
const YOUR_HAND_COUNT_MULTIPLY = /^This attack does (\d+) damage for each card in your hand\.$/;

const OPPONENT_ENERGY_MULTIPLY =
  /^This attack does (\d+) damage for each (?:(.+) )?Energy attached to (your opponent['’]s Active Pokémon|all of your opponent['’]s Pokémon)\.$/;

const SELF_ENERGY_MULTIPLY =
  /^This attack does (\d+) damage for each (?:(.+) )?Energy(?: card)? attached to this Pokémon\.$/;

/**
 * The multiply form of the board-wide own Energy count ("…attached to all of your Pokémon."),
 * separate from `SELF_ENERGY_MULTIPLY`.
 */
const SELF_BOARD_ENERGY_MULTIPLY =
  /^This attack does (\d+) damage for each (?:(.+) )?Energy attached to all of your Pokémon\.$/;

// Pokémon Tools attached to all of your Pokémon (Active and Bench). Multiply only: with no Tools
// the attack deals nothing.
const YOUR_TOOLS_MULTIPLY =
  /^This attack does (\d+) damage for each Pokémon Tool attached to all of your Pokémon\.$/;

// "all Pokémon" (without "of your") counts both boards. "each type of Basic Energy" counts distinct
// Basic Energy types.
const BOTH_SIDES_TOOLS_MULTIPLY =
  /^This attack does (\d+) damage for each Pokémon Tool attached to all Pokémon\.$/;

const BOTH_SIDES_ENERGY_MULTIPLY =
  /^This attack does (\d+) damage for each Energy attached to all Pokémon\.$/;

const BASIC_ENERGY_TYPES_MULTIPLY =
  /^This attack does (\d+) damage for each type of Basic Energy attached to all of your Pokémon\.$/;

const YOUR_BENCH_MAX_HP_MULTIPLY =
  /^This attack does (\d+) damage for each of your Benched Pokémon that has a maximum HP of (\d+)\.$/;

/**
 * Parse a multiply damage-scaling sentence ("This attack does N damage for each …", with no "more"
 * or "less") into `{per, count}`, or null. The result is the whole damage: attack.ts drops the
 * printed base, so a count of 0 deals no damage.
 */
export function deriveAttackDamageMultiplier(text: string): AttackDamageBonus | null {
  const effect = text.trim();
  // A printed 0 does nothing — left loud, the guard every arm in both families
  // carries.
  const selfCounters = SELF_COUNTER_MULTIPLY.exec(effect);
  if (selfCounters !== null) {
    const per = positiveInt(selfCounters[1]);
    if (per !== null) return { per, count: { kind: "damageCountersOnSelf" } };
  }
  const opponentPrizes = OPPONENT_PRIZES_MULTIPLY.exec(effect);
  if (opponentPrizes !== null) {
    // A printed 0 does nothing — left loud, the guard the additive rules carry.
    const per = positiveInt(opponentPrizes[1]);
    if (per !== null) return { per, count: { kind: "opponentPrizesTaken" } };
  }
  const yourPrizes = YOUR_PRIZES_MULTIPLY.exec(effect);
  if (yourPrizes !== null) {
    const per = positiveInt(yourPrizes[1]);
    if (per !== null) return { per, count: { kind: "yourPrizesTaken" } };
  }
  const retreatCost = RETREAT_COST_MULTIPLY.exec(effect);
  if (retreatCost !== null) {
    const per = positiveInt(retreatCost[1]);
    if (per !== null) return { per, count: { kind: "opponentActiveRetreatCost" } };
  }
  const opponentCounters = OPPONENT_COUNTER_MULTIPLY.exec(effect);
  if (opponentCounters !== null) {
    const per = positiveInt(opponentCounters[1]);
    if (per !== null) return { per, count: { kind: "damageCountersOnOpponentActive" } };
  }
  const opponentConditions = OPPONENT_CONDITION_COUNT_MULTIPLY.exec(effect);
  if (opponentConditions !== null) {
    const per = positiveInt(opponentConditions[1]);
    if (per !== null) return { per, count: { kind: "specialConditionsOnOpponentActive" } };
  }
  const benchCounters = BENCH_COUNTER_MULTIPLY.exec(effect);
  if (benchCounters !== null) {
    const per = positiveInt(benchCounters[1]);
    if (per !== null) return { per, count: { kind: "damageCountersOnYourBench" } };
  }
  // An absent filter means every Benched Pokémon. The suppressed compound has the same capture
  // groups, so both spellings fold identically.
  const benchCountersFiltered =
    BENCH_COUNTER_FILTERED_MULTIPLY.exec(effect) ?? BENCH_COUNTER_FILTERED_SUPPRESSED.exec(effect);
  if (benchCountersFiltered !== null) {
    const per = Number(benchCountersFiltered[1]);
    const filter = inPlayBodyFilter(benchCountersFiltered[2] ?? "");
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "damageCountersOnYourBench", filter } };
    }
  }
  const opponentBench = OPPONENT_BENCH_MULTIPLY.exec(effect);
  if (opponentBench !== null) {
    const per = positiveInt(opponentBench[1]);
    if (per !== null) return { per, count: { kind: "opponentBenchCount" } };
  }
  // Terapagos ex reaches this only after `splitAttackGateClause` has removed its gate clause.
  const yourBench = YOUR_BENCH_MULTIPLY.exec(effect);
  if (yourBench !== null) {
    const per = positiveInt(yourBench[1]);
    if (per !== null) return { per, count: { kind: "yourBenchCount" } };
  }
  const inPlayBodies = IN_PLAY_BODY_MULTIPLY.exec(effect);
  if (inPlayBodies !== null) {
    const per = Number(inPlayBodies[1]);
    const filter = inPlayBodyFilter(inPlayBodies[2] ?? "");
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "pokemonInPlay", seat: "you", filter } };
    }
  }
  // Also claimed by `deriveAttackEffect`, which reads the spread in the second sentence; both
  // readers must run.
  const namedBodiesSpread = NAMED_BODIES_MULTIPLY_SPREAD.exec(effect);
  if (namedBodiesSpread !== null) {
    const per = Number(namedBodiesSpread[1]);
    const filter = inPlayBodyFilter(namedBodiesSpread[2] ?? "");
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "pokemonInPlay", seat: "you", filter } };
    }
  }
  // Counts only damaged bodies. Damage is a board fact, so it rides on the count as `damagedOnly`
  // rather than in the card filter.
  const damagedInPlayBodies = IN_PLAY_DAMAGED_BODY_MULTIPLY.exec(effect);
  if (damagedInPlayBodies !== null) {
    const per = Number(damagedInPlayBodies[1]);
    const filter = inPlayBodyFilter(damagedInPlayBodies[2] ?? "");
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "pokemonInPlay", seat: "you", filter, damagedOnly: true } };
    }
  }
  const foeInPlayBodies = IN_PLAY_FOE_BODY_MULTIPLY.exec(effect);
  if (foeInPlayBodies !== null) {
    const per = Number(foeInPlayBodies[1]);
    const filter = inPlayBodyFilter(foeInPlayBodies[2] ?? "");
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "pokemonInPlay", seat: "opponent", filter } };
    }
  }
  // The captured attack name is the filter's payload, so the filter is built here rather than
  // resolved through `inPlayBodyFilter`.
  const roundBodies = IN_PLAY_ATTACK_NAME_MULTIPLY.exec(effect);
  if (roundBodies !== null) {
    const per = Number(roundBodies[1]);
    const attackName = roundBodies[2] ?? "";
    if (per >= 1 && attackName !== "") {
      return {
        per,
        count: {
          kind: "pokemonInPlay",
          seat: "you",
          filter: { kind: "attackNamePokemon", attack: attackName },
        },
      };
    }
  }
  // Counts both seats, so the count carries no seat and attack.ts sums the two walks. The printed
  // "or" becomes `anyOf`. An empty fragment would match every Pokémon, so both captures are
  // checked.
  const bothSidesNamed = IN_PLAY_BOTH_SIDES_NAME_MULTIPLY.exec(effect);
  if (bothSidesNamed !== null) {
    const per = Number(bothSidesNamed[1]);
    const first = bothSidesNamed[2] ?? "";
    const second = bothSidesNamed[3] ?? "";
    if (per >= 1 && first !== "" && second !== "") {
      return {
        per,
        count: {
          kind: "bothSidesPokemonInPlay",
          filter: {
            kind: "anyOf",
            filters: [
              { kind: "pokemonNameContaining", fragment: first },
              { kind: "pokemonNameContaining", fragment: second },
            ],
          },
        },
      };
    }
  }
  // The seat comes from capture 3; it is never hard-coded.
  const foeDiscard = DISCARD_PILE_COUNT_MULTIPLY.exec(effect);
  if (foeDiscard !== null) {
    const per = Number(foeDiscard[1]);
    const filter = discardPileFilter(foeDiscard[2] ?? "");
    const seat: DiscardPileSeat = foeDiscard[3] === "your" ? "you" : "opponent";
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "cardsInDiscardPile", seat, filter } };
    }
  }
  // Kyogre — Riptide: the count half of a shared anchor whose shuffle tail `deriveAttackEffect`
  // reads.
  const riptide = DISCARD_PILE_COUNT_THEN_SHUFFLE.exec(effect);
  if (riptide !== null && Number(riptide[1]) >= 1) {
    return {
      per: Number(riptide[1]),
      count: { kind: "cardsInDiscardPile", seat: "you", filter: RIPTIDE_PILE_FILTER },
    };
  }
  const pileByAttackName = DISCARD_PILE_ATTACK_NAME_MULTIPLY.exec(effect);
  if (pileByAttackName !== null) {
    const per = Number(pileByAttackName[1]);
    const attackName = pileByAttackName[2] ?? "";
    if (per >= 1 && attackName !== "") {
      return {
        per,
        count: {
          kind: "cardsInDiscardPile",
          seat: "you",
          filter: { kind: "attackNamePokemon", attack: attackName },
        },
      };
    }
  }
  // The reveal row is also claimed by `deriveAttackEffect`: the reveal makes the counted fact
  // public, so both halves must run.
  const foeHand = OPPONENT_HAND_COUNT_MULTIPLY.exec(effect);
  if (foeHand !== null) {
    const per = Number(foeHand[1]);
    const filter = opponentHandFilter(foeHand[2] ?? "");
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "cardsInOpponentHand", filter } };
    }
  }
  const ownHand = YOUR_HAND_COUNT_MULTIPLY.exec(effect);
  if (ownHand !== null && Number(ownHand[1]) >= 1) {
    return { per: Number(ownHand[1]), count: { kind: "cardsInYourHand" } };
  }
  const revealedHand = ATTACK_REVEAL_AND_TRAINER_SCALE.exec(effect);
  if (revealedHand !== null) {
    const per = Number(revealedHand[1]);
    const filter = opponentHandFilter(revealedHand[2] ?? "");
    if (per >= 1 && filter !== null) {
      return { per, count: { kind: "cardsInOpponentHand", filter } };
    }
  }
  // The zone comes from the printed noun phrase (capture 3).
  const opponentEnergy = OPPONENT_ENERGY_MULTIPLY.exec(effect);
  if (opponentEnergy !== null) {
    const per = Number(opponentEnergy[1]);
    const energyType = attachedEnergyFilter(opponentEnergy[2]);
    const zone: OpponentEnergyZone =
      opponentEnergy[3]?.startsWith("all of ") === true ? "board" : "active";
    if (per >= 1 && energyType !== undefined) {
      return { per, count: { kind: "energyOnOpponent", zone, energyType } };
    }
  }
  const selfEnergy = SELF_ENERGY_MULTIPLY.exec(effect);
  if (selfEnergy !== null) {
    const per = Number(selfEnergy[1]);
    const energyType = attachedEnergyFilter(selfEnergy[2]);
    if (per >= 1 && energyType !== undefined) {
      return { per, count: { kind: "energyOnSelf", energyType } };
    }
  }
  const boardEnergy = SELF_BOARD_ENERGY_MULTIPLY.exec(effect);
  if (boardEnergy !== null) {
    const per = Number(boardEnergy[1]);
    const energyType = attachedEnergyFilter(boardEnergy[2]);
    if (per >= 1 && energyType !== undefined) {
      return { per, count: { kind: "energyOnSelf", zone: "board", energyType } };
    }
  }
  const yourTools = YOUR_TOOLS_MULTIPLY.exec(effect);
  if (yourTools !== null) {
    const per = positiveInt(yourTools[1]);
    if (per !== null) return { per, count: { kind: "toolsOnYourBoard" } };
  }
  const allTools = BOTH_SIDES_TOOLS_MULTIPLY.exec(effect);
  if (allTools !== null && Number(allTools[1]) >= 1) {
    return { per: Number(allTools[1]), count: { kind: "toolsInPlayBothSides" } };
  }
  const allEnergy = BOTH_SIDES_ENERGY_MULTIPLY.exec(effect);
  if (allEnergy !== null && Number(allEnergy[1]) >= 1) {
    return { per: Number(allEnergy[1]), count: { kind: "energyInPlayBothSides" } };
  }
  const energyTypes = BASIC_ENERGY_TYPES_MULTIPLY.exec(effect);
  if (energyTypes !== null && Number(energyTypes[1]) >= 1) {
    return { per: Number(energyTypes[1]), count: { kind: "basicEnergyTypesOnYourBoard" } };
  }
  // Igglybuff — Bouncy Circle: two printed numbers, both guarded positive.
  const maxHpBench = YOUR_BENCH_MAX_HP_MULTIPLY.exec(effect);
  if (maxHpBench !== null && Number(maxHpBench[1]) >= 1 && Number(maxHpBench[2]) >= 1) {
    return {
      per: Number(maxHpBench[1]),
      count: { kind: "benchedPokemonWithMaxHp", hp: Number(maxHpBench[2]) },
    };
  }
  return null;
}

/**
 * Which §8.5 damage modifiers the main hit ignores ("This attack's damage isn't affected by …").
 * Each field is absent rather than false when not named; Weakness and Resistance are separate
 * because they apply at different steps.
 */
export interface AttackDamageSuppression {
  weakness?: true;
  resistance?: true;
  targetEffects?: true;
}

/**
 * One capture group per printed object, so dispatch never inspects matched text. Alternation order
 * matters: the longer compound must precede its "Weakness or Resistance" prefix.
 */
const DAMAGE_SUPPRESSION = new RegExp(
  `^This attack['’]s damage isn['’]t affected by ` +
    `(?:(Weakness or Resistance, or by any effects on your opponent['’]s Active Pokémon)` +
    "|(Weakness or Resistance)" +
    "|(Resistance)" +
    `|(any effects on your opponent['’]s Active Pokémon))\\.$`,
);

/** Parse the main-hit suppression sentence into the modifiers it skips, or null. */
export function deriveAttackDamageSuppression(text: string): AttackDamageSuppression | null {
  const trimmed = text.trim();
  // Coin compound: gated on `deriveAttackCoinFlip` so a sentence that reader refuses (such as a
  // printed 0) stays loud. Only Weakness and Resistance are suppressed.
  if (ATTACK_OPPONENT_BENCH_TAILS.test(trimmed) && deriveAttackCoinFlip(trimmed) !== null) {
    return { weakness: true, resistance: true };
  }
  // Conditional-bonus compound: gated on `deriveAttackDamageBonus` so an unmapped clause or printed
  // 0 stays loud instead of silently dropping the bonus.
  if (CONDITIONAL_BONUS_SUPPRESSED.test(trimmed) && deriveAttackDamageBonus(trimmed) !== null) {
    return { weakness: true };
  }
  // Bench-counter compound: gated on `deriveAttackDamageMultiplier` so an unmapped noun or printed
  // 0 stays loud instead of silently dropping the fold.
  if (
    BENCH_COUNTER_FILTERED_SUPPRESSED.test(trimmed) &&
    deriveAttackDamageMultiplier(trimmed) !== null
  ) {
    return { weakness: true };
  }
  const match = DAMAGE_SUPPRESSION.exec(trimmed);
  if (match === null) return null;
  if (match[1] !== undefined) return { weakness: true, resistance: true, targetEffects: true };
  if (match[2] !== undefined) return { weakness: true, resistance: true };
  if (match[3] !== undefined) return { resistance: true };
  return { targetEffects: true };
}

/**
 * The printed "You may do N more damage. If you do, …": the extra damage and the ops that accepting
 * it buys. The base lives in the attack's `damage` field, so attack.ts assembles the program; the
 * whole hit moves inside the gate because §8.5 applies once per damage op. An unrecognised
 * consequent returns null.
 */
export interface AttackOptionalBoost {
  /** The printed extra damage a "yes" adds to the attack's own base. */
  bonus: number;
  /** What the printed "If you do," buys, in printed order. Named `ops` rather
      than `then` for `programPerHeads.ops`'s reason: it is a program reached
      through a READING, not a branch hanging off a gate op. */
  ops: EffectOp[];
}

const OPTIONAL_DAMAGE_BOOST = /^You may do (\d+) more damage\. If you do, (.+)$/;

const BOOST_RETURN_SELF = /^shuffle this Pokémon and all attached cards into your deck\.$/;

const BOOST_SELF_DAMAGE = /^this Pokémon also does (\d+) damage to itself\.$/;

const BOOST_CANT_ATTACK = /^during your next turn, this Pokémon can['’]t attack\.$/;

/** Parse the optional damage boost into its bonus and its consequent's ops, or
    null for anything else.

    THE EIGHTH READER of the same effect text, and disjoint from all seven by its
    LEADING WORDS: *"You may do"* denies `deriveAttackEffect`'s whole-sentence
    anchors, both scaling readers' `^This attack does` / `^If`, the coin family's
    `^Flip a coin`, the requirement family's `^If` and the suppression family's
    `^This attack's damage`. attack.ts owns the read site, beside the coin
    reader's. */
export function deriveAttackOptionalBoost(text: string): AttackOptionalBoost | null {
  const match = OPTIONAL_DAMAGE_BOOST.exec(text.trim());
  if (match === null) return null;
  const bonus = Number(match[1]);
  const consequent = match[2] ?? "";
  if (bonus < 1) return null;
  if (BOOST_RETURN_SELF.test(consequent)) {
    return { bonus, ops: [{ op: "returnSelf", dest: "deck" }] };
  }
  const recoil = BOOST_SELF_DAMAGE.exec(consequent);
  if (recoil !== null) {
    const amount = positiveInt(recoil[1]);
    return amount !== null ? { bonus, ops: [{ op: "damageSelf", amount }] } : null;
  }
  if (BOOST_CANT_ATTACK.test(consequent)) return { bonus, ops: [{ op: "preventAttack" }] };
  return null;
}

/** Build the confirm program for an optional boost from the attack's printed base. */
export function optionalBoostProgram(
  reading: AttackOptionalBoost,
  base: number,
  note: string,
): EffectOp[] {
  const [then, otherwise] = boostedArms(base, reading.bonus, reading.ops);
  return [
    {
      op: "optional",
      // The WHOLE printed sentence, the op's own contract — it is what the confirm
      // dialog shows, and the player is being asked to agree to the drawback as
      // much as to the damage.
      note,
      then,
      otherwise,
    },
  ];
}

/**
 * The yes and no arms shared by every boost decider; the no arm deals the printed base, not
 * nothing. Returns a tuple so callers can splice a local `then` without a `then:` key tripping
 * lint.
 */
function boostedArms(
  base: number,
  bonus: number,
  ops: readonly EffectOp[],
): [EffectOp[], EffectOp[]] {
  return [
    [{ op: "damageDefender", amount: base + bonus }, ...ops],
    [{ op: "damageDefender", amount: base }],
  ];
}

/**
 * "…this attack does N more damage, and {consequent}": one decider (a board condition or a coin)
 * buys both the bigger hit and the consequent. A single reader keeps the coin to one flip, and both
 * arms deal a single `damageDefender` because §8.5 applies once per hit. An unrecognised consequent
 * returns null.
 */
export interface AttackBonusConsequent {
  /** What decides BOTH halves — a board fact read at declaration, or one coin
      taken by the gate the program carries. Never both, and never neither: the
      union is closed by the two anchors below. */
  decider: { kind: "boardCondition"; cond: BoardCondition } | { kind: "coinFlip" };
  /** The printed extra damage the YES arm adds to the attack's own printed base. */
  bonus: number;
  /** What the printed join (", and …" or ". Then, …") buys on the yes arm, in printed order. */
  ops: EffectOp[];
  /**
   * "If {clause}, this attack's base damage is N.": the yes arm's hit is N instead of the printed
   * base; the no arm keeps the printed base.
   */
  baseOverride?: number;
}

const CONSEQUENT_DISCARD_ALL_SELF_ENERGY = /^discard all Energy from this Pokémon\.$/;

const CONSEQUENT_HEAL_SELF = /^heal (\d+) damage from this Pokémon\.$/;

/**
 * Lowercase and anaphoric "that Stadium": `DISCARD_STADIUM` does not read this string, so the
 * consequent is dispatched here.
 */
const CONSEQUENT_DISCARD_STADIUM = /^discard that Stadium\.$/;

/** The ops the consequent buys, or null for a consequent this engine does not read. */
function bonusConsequentOps(consequent: string): EffectOp[] | null {
  if (CONSEQUENT_DISCARD_ALL_SELF_ENERGY.test(consequent)) {
    return [
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ];
  }
  // No confirm or gate: the antecedent is already `stadiumInPlay`, so the yes arm only runs when
  // there is a Stadium to discard.
  if (CONSEQUENT_DISCARD_STADIUM.test(consequent)) return [{ op: "discardStadium" }];
  const heal = CONSEQUENT_HEAL_SELF.exec(consequent);
  if (heal !== null) {
    const amount = Number(heal[1]);
    // A printed 0 heals nothing — the guard every captured amount in this file
    // carries, and it keeps such a printing LOUD rather than silently claiming to
    // simulate a sentence with a no-op in it.
    return amount >= 1 ? [{ op: "heal", target: "self", amount }] : null;
  }
  return null;
}

const BONUS_CONSEQUENT_CONDITION = /^If (.+), this attack does (\d+) more damage, and (.+)$/;

/**
 * The same condition form with the join spelled ". Then, " (Chi-Yu — Ground Melter), kept as a
 * separate anchor rather than an alternation.
 */
const BONUS_CONSEQUENT_CONDITION_THEN =
  /^If (.+), this attack does (\d+) more damage\. Then, (.+)$/;

const BONUS_CONSEQUENT_COIN =
  /^Flip a coin\. If heads, this attack does (\d+) more damage, and (.+)$/;

/** Mega Mawile ex — Huge Bite: the condition form with a base override. */
const BASE_OVERRIDE_CONDITION = /^If (.+), this attack['’]s base damage is (\d+)\.$/;

/**
 * Parse the bonus-plus-consequent sentence into its decider, bonus and consequent ops, or null. The
 * coin anchor is tried first; otherwise the condition anchor's `If (.+)` would capture "heads" and
 * refuse the sentence.
 */
export function deriveAttackBonusConsequent(text: string): AttackBonusConsequent | null {
  const effect = text.trim();
  const coin = BONUS_CONSEQUENT_COIN.exec(effect);
  if (coin !== null) {
    const bonus = Number(coin[1]);
    // A printed 0 adds nothing — the guard every arm of the damage-bonus family
    // carries, and here it is the whole reason the decision is worth taking.
    if (bonus < 1) return null;
    const ops = bonusConsequentOps(coin[2] ?? "");
    return ops === null ? null : { decider: { kind: "coinFlip" }, bonus, ops };
  }
  const override = BASE_OVERRIDE_CONDITION.exec(effect);
  if (override !== null) {
    const cond = boardConditionForClause(override[1] ?? "");
    const baseOverride = Number(override[2]);
    if (cond === null || baseOverride < 1) return null;
    return { decider: { kind: "boardCondition", cond }, bonus: 0, ops: [], baseOverride };
  }
  const condition =
    BONUS_CONSEQUENT_CONDITION.exec(effect) ?? BONUS_CONSEQUENT_CONDITION_THEN.exec(effect);
  if (condition === null) return null;
  // An UNMAPPED clause falls through to null and stays LOUD — `CONDITIONAL_DAMAGE_
  // BONUS`'s own rule, and the reason this reader shares that table rather than
  // carrying a second copy of the vocabulary: a clause meaning "does 140 more
  // damage if X" must mean the same thing here as it does one reader over.
  const cond = boardConditionForClause(condition[1] ?? "");
  if (cond === null) return null;
  const bonus = Number(condition[2]);
  if (bonus < 1) return null;
  const ops = bonusConsequentOps(condition[3] ?? "");
  return ops === null ? null : { decider: { kind: "boardCondition", cond }, bonus, ops };
}

/**
 * Assemble the reading into its gate given the attack's printed base. Exported so program walkers
 * can build the same program attack.ts runs.
 */
export function bonusConsequentProgram(reading: AttackBonusConsequent, base: number): EffectOp[] {
  const [boosted, otherwise] = boostedArms(base, reading.bonus, reading.ops);
  const then: EffectOp[] =
    reading.baseOverride === undefined
      ? boosted
      : [{ op: "damageDefender", amount: reading.baseOverride }];
  return reading.decider.kind === "coinFlip"
    ? [headsGate(then, otherwise)]
    : [conditionGate(reading.decider.cond, then, otherwise)];
}

/**
 * "You may {cost}. If you do, {payoff}": a cost that may be unpayable buys the payoff. Both halves
 * are dispatched over closed anchor lists, so an unrecognised half leaves the whole sentence loud.
 */
export interface AttackOptionalCostBoost {
  /** The board fact that gives the offer a STAKE — the cost's own payability, read
      at the gate rather than inside the confirm. Never optional: every reversed
      printing in this family leads with a cost that can be unpayable, which is
      what makes this reading a different reading and not a wider one. */
  cond: BoardCondition;
  /** What saying "yes" COSTS, in printed order, paid BEFORE the boosted hit. Named
      `ops` for `AttackOptionalBoost.ops`'s reason: it is a program reached through
      a READING, not a branch hanging off an `EffectOp` a walk can find. */
  ops: EffectOp[];
  /** What the paid cost buys. */
  payoff: AttackOptionalCostPayoff;
}

/** The payoff half of an optional-cost sentence. */
export type AttackOptionalCostPayoff =
  /**
   * "this attack does N more damage." The printed base moves inside the gate, since the boosted and
   * declined hits are the same §8.5 hit and only one may land.
   */
  | { kind: "moreDamage"; bonus: number }
  /**
   * "this attack also does N damage to 1 of your opponent's Benched Pokémon." A second hit on a
   * Benched body, so the printed base stays an ordinary pre-program hit and the program carries
   * only the cost and the snipe.
   */
  | { kind: "benchSnipe"; amount: number; count: number }
  /**
   * "…and make your opponent's Active Pokémon Paralyzed." An additional effect, so a decline still
   * deals the printed base.
   */
  | { kind: "defenderStatus"; status: "paralyzed" };

/**
 * Both connectives read the same here because every cost row's `cond` is exactly that cost's
 * payability, so an accepted cost always moves something. Each new cost row must keep its `cond`
 * necessary and sufficient.
 */
const OPTIONAL_COST_CONNECTIVE = "(?:If you do|If you discarded any cards in this way)";

const OPTIONAL_COST_TURN_PRIZE_FACE_UP = /^turn 1 of your face-down Prize cards face up$/;

const OPTIONAL_COST_DISCARD_STADIUM = /^discard a Stadium in play$/;

/** "your hand" prints no count, so its gate is nullary. */
const OPTIONAL_COST_DISCARD_HAND = /^discard your hand$/;

/** The printed count is captured because the gate reads it. */
const OPTIONAL_COST_SHUFFLE_SELF_ENERGY =
  /^shuffle (\d+) Energy attached to this Pokémon into your deck$/;

const OPTIONAL_COST_PUT_ALL_SELF_ENERGY_TO_HAND =
  /^put all Energy attached to this Pokémon into your hand$/;

const OPTIONAL_COST_DISCARD_TYPED_SELF_ENERGY = new RegExp(
  `^discard (\\d+) \\{([${ENERGY_CODES}])\\} Energy from this Pokémon$`,
);

const OPTIONAL_COST_DISCARD_ALL_SELF_ENERGY = /^discard all Energy from this Pokémon$/;

const OPTIONAL_COST_PUT_TYPED_SELF_ENERGY_TO_HAND = new RegExp(
  `^put a \\{([${ENERGY_CODES}])\\} Energy attached to this Pokémon into your hand$`,
);

const OPTIONAL_COST_SHUFFLE_ALL_SELF_ENERGY =
  /^shuffle all Energy attached to this Pokémon into your deck$/;

/**
 * The cost half: the ops a printed "You may …" charges and the board fact that makes them payable,
 * or null. The gate matters because an attacker can hold fewer Energy cards than units, so without
 * it a "yes" could pay a partial cost and still collect the payoff.
 */
function optionalCostOps(cost: string): { cond: BoardCondition; ops: EffectOp[] } | null {
  if (OPTIONAL_COST_DISCARD_STADIUM.test(cost)) {
    return { cond: { kind: "stadiumInPlay" }, ops: [{ op: "discardStadium" }] };
  }
  // `yourHandNotEmpty` is exactly `discardHand`'s payability, so the printed "if you discarded any
  // cards in this way" always holds once the gate passes.
  if (OPTIONAL_COST_DISCARD_HAND.test(cost)) {
    return { cond: { kind: "yourHandNotEmpty" }, ops: [{ op: "discardHand" }] };
  }
  // The gate is the payability of moving all Energy (at least one attached) and that the hand move
  // is allowed; a cost that would whiff must not be offered.
  if (OPTIONAL_COST_PUT_ALL_SELF_ENERGY_TO_HAND.test(cost))
    return {
      cond: {
        kind: "allOf",
        conditions: [
          { kind: "yourActiveEnergyAtLeast", count: 1 },
          { kind: "yourInPlayToHandAllowed" },
        ],
      },
      ops: [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "anyEnergy" },
          count: "all",
          to: "hand",
        },
      ],
    };
  // `turnPrizeFaceUp` turns exactly one Prize whenever one is face down, so
  // `yourFaceDownPrizeRemains` is its exact payability.
  if (OPTIONAL_COST_TURN_PRIZE_FACE_UP.test(cost))
    return { cond: { kind: "yourFaceDownPrizeRemains" }, ops: [{ op: "turnPrizeFaceUp" }] };
  // A printed 0 charges nothing and is refused.
  const typedDiscard = OPTIONAL_COST_DISCARD_TYPED_SELF_ENERGY.exec(cost);
  const typedDiscardEnergy = ENERGY_TYPE_BY_CODE[typedDiscard?.[2] ?? ""];
  if (typedDiscard !== null && typedDiscardEnergy !== undefined && Number(typedDiscard[1]) >= 1)
    return {
      cond: {
        kind: "yourActiveEnergyAtLeast",
        count: Number(typedDiscard[1]),
        energy: typedDiscardEnergy,
      },
      ops: [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "providesEnergy", energyType: typedDiscardEnergy },
          count: Number(typedDiscard[1]),
        },
      ],
    };
  if (OPTIONAL_COST_DISCARD_ALL_SELF_ENERGY.test(cost))
    return {
      cond: { kind: "yourActiveEnergyAtLeast", count: 1 },
      ops: [
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      ],
    };
  const typedToHandEnergy =
    ENERGY_TYPE_BY_CODE[OPTIONAL_COST_PUT_TYPED_SELF_ENERGY_TO_HAND.exec(cost)?.[1] ?? ""];
  if (typedToHandEnergy !== undefined)
    return {
      cond: {
        kind: "allOf",
        conditions: [
          { kind: "yourActiveEnergyAtLeast", count: 1, energy: typedToHandEnergy },
          { kind: "yourInPlayToHandAllowed" },
        ],
      },
      ops: [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "providesEnergy", energyType: typedToHandEnergy },
          to: "hand",
        },
      ],
    };
  if (OPTIONAL_COST_SHUFFLE_ALL_SELF_ENERGY.test(cost))
    return {
      cond: { kind: "yourActiveEnergyAtLeast", count: 1 },
      ops: [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "anyEnergy" },
          count: "all",
          to: "deck",
        },
        { op: "shuffleDeck" },
      ],
    };
  const shuffle = OPTIONAL_COST_SHUFFLE_SELF_ENERGY.exec(cost);
  if (shuffle !== null) {
    const count = Number(shuffle[1]);
    // A printed 0 charges nothing — the guard every captured amount in this file
    // carries, and here it would make the gate vacuously true and the confirm a
    // free question. No card prints it; the row refuses it rather than relying on
    // that.
    if (count < 1) return null;
    return {
      cond: { kind: "yourActiveEnergyAtLeast", count },
      ops: [
        // `yourActive` and NOT `self`: the printed subject is *"this Pokémon"* and
        // §8 makes the actor the Active, which is the exact division of labour that
        // member's own doc block draws (`self` exists for an ABILITY on a benched
        // host, where §8 supplies no such clause).
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "anyEnergy" },
          count,
          to: "deck",
        },
        { op: "shuffleDeck" },
      ],
    };
  }
  return null;
}

const OPTIONAL_COST_PAYOFF_MORE_DAMAGE = /^this attack does (\d+) more damage\.$/;

/** Shares its body with `ALSO_BENCHED_SNIPE` so the two spellings cannot drift. */
const OPTIONAL_COST_PAYOFF_BENCH_SNIPE = new RegExp(`^this ${ALSO_BENCHED_SNIPE_BODY}$`);

/**
 * The payoff half: what the accepted offer buys, or null for a payoff this engine cannot pay out.
 */
function optionalCostPayoff(payoff: string): AttackOptionalCostPayoff | null {
  const more = OPTIONAL_COST_PAYOFF_MORE_DAMAGE.exec(payoff);
  if (more !== null) {
    const bonus = Number(more[1]);
    // A printed 0 buys nothing, and here the guard is the whole stake: an offer that
    // charges a Stadium for no extra damage is a decision with no upside, exactly as
    // `AttackOptionalBoost`'s own `>= 1` refuses one with no downside.
    return bonus < 1 ? null : { kind: "moreDamage", bonus };
  }
  const snipe = OPTIONAL_COST_PAYOFF_BENCH_SNIPE.exec(payoff);
  if (snipe !== null) {
    const amount = Number(snipe[1]);
    const count = Number(snipe[2]);
    // A narrowed snipe has no slot in `benchSnipe`, so it is refused rather than aimed at bodies
    // the card never offered.
    if (snipe[5] !== undefined) return null;
    // A class-narrowed snipe is refused for the same reason.
    if (snipe[4] !== undefined) return null;
    // An own-Bench snipe is refused for the same reason.
    if (snipe[3] === "your") return null;
    // The same guard on the same reason — and it is the guard `deriveAttackEffect`'s
    // own benched-snipe arm carries on this clause's other spelling.
    return amount < 1 || count < 1 ? null : { kind: "benchSnipe", amount, count };
  }
  return null;
}

const OPTIONAL_COST_BOOST = new RegExp(`^You may (.+)\\. ${OPTIONAL_COST_CONNECTIVE}, (.+)$`);

/**
 * Purpose-clause skeleton ("You may {cost} to have this attack do N more damage."). Its infinitive
 * "do" only appears under this connective, so it captures the bonus itself rather than widening the
 * payoff table.
 */
const OPTIONAL_COST_PURPOSE_BOOST = /^You may (.+) to have this attack do (\d+) more damage\.$/;

/**
 * Reminder text stripped from Crescent Purge's payoff only when the cost is the face-up row. It
 * changes nothing because face-up Prizes stay face up anyway.
 */
const OPTIONAL_COST_FACE_UP_REMINDER =
  " (That Prize card remains face up for the rest of the game.)";

/**
 * "You may {cost} and have this attack do N more damage." Each cost row's `cond` is that cost's
 * exact payability.
 */
const OPTIONAL_COST_AND_HAVE_BOOST = /^You may (.+) and have this attack do (\d+) more damage\.$/;

const OPTIONAL_COST_AND_MAKE_PARALYZED =
  /^You may (.+) and make your opponent['’]s Active Pokémon Paralyzed\.$/;

/**
 * Parse the reversed optional boost into its precondition, cost ops and payoff, or null. It shares
 * the `^You may ` lead with `deriveAttackOptionalBoost` and is separated by the word after it.
 */
export function deriveAttackOptionalCostBoost(text: string): AttackOptionalCostBoost | null {
  const match = OPTIONAL_COST_BOOST.exec(text.trim());
  if (match === null) {
    // "… and have this attack do N more damage.": same cost table, payoff built inline; a printed 0
    // bonus is refused.
    const andHave = OPTIONAL_COST_AND_HAVE_BOOST.exec(text.trim());
    const andHaveCost = andHave === null ? null : optionalCostOps(andHave[1] ?? "");
    if (andHave !== null)
      return andHaveCost === null || Number(andHave[2]) < 1
        ? null
        : {
            cond: andHaveCost.cond,
            ops: andHaveCost.ops,
            payoff: { kind: "moreDamage", bonus: Number(andHave[2]) },
          };
    const andMake = OPTIONAL_COST_AND_MAKE_PARALYZED.exec(text.trim());
    const andMakeCost = andMake === null ? null : optionalCostOps(andMake[1] ?? "");
    if (andMakeCost !== null)
      return {
        cond: andMakeCost.cond,
        ops: andMakeCost.ops,
        payoff: { kind: "defenderStatus", status: "paralyzed" },
      };
    // Purpose connective: the payoff is built inline because its verb "do" only appears under this
    // connective.
    const purpose = OPTIONAL_COST_PURPOSE_BOOST.exec(text.trim());
    if (purpose === null) return null;
    const purposeCost = optionalCostOps(purpose[1] ?? "");
    const bonus = Number(purpose[2]);
    if (purposeCost === null || bonus < 1) return null;
    return { cond: purposeCost.cond, ops: purposeCost.ops, payoff: { kind: "moreDamage", bonus } };
  }
  const cost = optionalCostOps(match[1] ?? "");
  if (cost === null) return null;
  // Crescent Purge's reminder is stripped only behind the face-up cost and only as the exact
  // suffix.
  const printedPayoff = match[2] ?? "";
  const faceUpReminder =
    OPTIONAL_COST_TURN_PRIZE_FACE_UP.test(match[1] ?? "") &&
    printedPayoff.endsWith(OPTIONAL_COST_FACE_UP_REMINDER);
  const payoff = optionalCostPayoff(
    faceUpReminder ? printedPayoff.slice(0, -OPTIONAL_COST_FACE_UP_REMINDER.length) : printedPayoff,
  );
  return payoff === null ? null : { cond: cost.cond, ops: cost.ops, payoff };
}

/**
 * Assemble the reversed reading into gate, confirm and hits given the printed base. Both gates
 * carry an `otherwise` dealing the printed base, since a decline or unpayable cost still deals it.
 * The cost precedes the hit, as printed, and the order is observable (for example, discarding a
 * Stadium that prevents the damage).
 */
export function optionalCostBoostProgram(
  reading: AttackOptionalCostBoost,
  base: number,
  note: string,
): EffectOp[] {
  if (reading.payoff.kind === "benchSnipe") {
    return costSnipeProgram(reading, reading.payoff.amount, reading.payoff.count, note);
  }
  // One gate and one confirm with no decline arm: the printed base is dealt before the program on
  // every answer. The status follows the cost.
  if (reading.payoff.kind === "defenderStatus") {
    const then: EffectOp[] = [
      ...reading.ops,
      { op: "applyStatus", target: "defender", status: reading.payoff.status },
    ];
    const offer: EffectOp = optionalStep(note, then);
    return [conditionGate(reading.cond, [offer])];
  }
  const [boosted, otherwise] = boostedArms(base, reading.payoff.bonus, []);
  const then = [...reading.ops, ...boosted];
  const ask: EffectOp = {
    op: "optional",
    // The WHOLE printed sentence, the op's own contract — it is what the confirm
    // dialog shows, and the player is agreeing to the COST as much as to the damage.
    note,
    then,
    otherwise,
  };
  // A second call rather than reusing `otherwise`: the two gates must not share one array, or the
  // program becomes a DAG and identity-based walkers miscount.
  const [, vacantZone] = boostedArms(base, reading.payoff.bonus, []);
  // Only the outer gate needs the lint suppression; the shorthand `then` local is used by the
  // confirm.
  return [
    {
      op: "conditionGate",
      cond: reading.cond,
      then: [ask],
      // The empty board's arm, and it is the printed base rather than nothing: the
      // gate refuses the QUESTION, never the attack.
      otherwise: vacantZone,
    },
  ];
}

/**
 * Bench-snipe payoff: one gate, one confirm, no decline arm, because the printed base is dealt
 * before the program on every answer. The cost precedes the snipe, as printed.
 */
function costSnipeProgram(
  reading: AttackOptionalCostBoost,
  amount: number,
  count: number,
  note: string,
): EffectOp[] {
  const then: EffectOp[] = [
    ...reading.ops,
    // `deals: true` makes this attack damage rather than placed counters, so benched reduction
    // still applies; Weakness and Resistance never apply to Benched Pokémon (§8.5).
    { op: "damageChosen", target: "opponentBench", amount, count, source: "attack", deals: true },
  ];
  const offer: EffectOp = optionalStep(note, then);
  return [
    {
      op: "conditionGate",
      // The cost's own payability, read BEFORE the confirm is parked: an attacker
      // holding two Energy must not be offered a "yes" that shuffles two and
      // collects the whole printed snipe ("do as much as you can" is the op's rule
      // for a MANDATORY discard, and this one is a purchase).
      cond: reading.cond,
      then: [offer],
    },
  ];
}

/**
 * "You may discard up to N [Basic] Energy from your Benched Pokémon. This attack does P more damage
 * for each card you discarded in this way." The printed base and the scaled part are one §8.5 hit
 * via `damageDefender.base`; declining is N = 0, so no decline arm is needed.
 */
export interface AttackBenchDiscardScaledBoost {
  /** Discriminator switched on by `discardScaledBoostProgram`. */
  kind: "benchDiscard";
  /** The printed ceiling of the declinable discard (the "up to N"), which rides the
      op's `cap` — the pick stays 0..min(cap, matches) and stays declinable. */
  cap: number;
  /** What may come off the Bench: the bare printed noun, or the Basic-Energy card. */
  filter: CardFilter;
  /** The printed extra damage EACH discarded card buys — the "+" of the attack's
      own printed marker, which is why this reading claims that marker at the read
      site the way `optionalBoost` and `bonusConsequent` do. */
  per: number;
}

/**
 * "Discard the top card of each player's deck. This attack does N more damage for each Energy card
 * discarded in this way."
 */
export interface AttackEachDeckMillScaledBoost {
  kind: "eachDeckMill";
  /** The printed extra damage each ENERGY card milled buys. The only capture in the
      anchor, guarded `>= 1` like every captured amount in this file. */
  per: number;
}

/** The additive discarded-card fold, one member per printed head. */
export type AttackDiscardScaledBoost =
  | AttackBenchDiscardScaledBoost
  | AttackEachDeckMillScaledBoost
  | AttackSelfHandAttachScaledBoost
  | AttackHandDiscardScaledBoost;

/**
 * "You may discard up to N Energy cards from your hand, and this attack does P more damage for each
 * card you discarded in this way." Declining is picking none, so no separate confirm is needed.
 */
export interface AttackHandDiscardScaledBoost {
  kind: "handDiscard";
  /** The printed "up to N" ceiling on the hand discard. */
  cap: number;
  /** The printed extra damage each discarded card buys. */
  per: number;
}

/**
 * "This attack does N damage for each {W} Energy attached to this Pokémon. Before doing damage, you
 * may attach any number of Basic {W} Energy cards from your hand to this Pokémon." The attach runs
 * before the hit so the attached Energy is counted in one §8.5 pass; attack.ts passes the
 * declaration-time multiplier as `base`, not the printed number.
 */
export interface AttackSelfHandAttachScaledBoost {
  kind: "selfHandAttach";
  /** The printed per-Energy damage. */
  per: number;
  /** The printed Energy type, shared by the attach filter and the declaration-time count. */
  energyType: BasicEnergyType;
}

// No /i, on this file's standing reason for every whole-sentence attack anchor: the
// capital first word is half of what keeps a whole-sentence reader off a mid-sentence
// clause, and the `^…$` is the other half. Two printed spellings of the filter and
// nothing else — see the doc block above for why the type map is not admitted here.
const BENCH_DISCARD_SCALED_BOOST =
  /^You may discard up to (\d+) (Basic )?Energy from your Benched Pokémon\. This attack does (\d+) more damage for each card you discarded in this way\.$/;

const EACH_DECK_MILL_SCALED_BOOST =
  /^Discard the top card of each player['’]s deck\. This attack does (\d+) more damage for each Energy card discarded in this way\.$/;

const SELF_HAND_ATTACH_SCALED =
  /^This attack does (\d+) damage for each \{W\} Energy attached to this Pokémon\. Before doing damage, you may attach any number of Basic \{W\} Energy cards from your hand to this Pokémon\.$/;

const HAND_DISCARD_SCALED_BOOST =
  /^You may discard up to (\d+) Energy cards from your hand, and this attack does (\d+) more damage for each card you discarded in this way\.$/;

/** Parse the additive discarded-card boost into its reading, or null. */
export function deriveAttackDiscardScaledBoost(text: string): AttackDiscardScaledBoost | null {
  const mill = EACH_DECK_MILL_SCALED_BOOST.exec(text.trim());
  if (mill !== null) {
    const perMilled = Number(mill[1]);
    // A printed 0 per card buys nothing, so it stays loud.
    return perMilled < 1 ? null : { kind: "eachDeckMill", per: perMilled };
  }
  const selfAttach = SELF_HAND_ATTACH_SCALED.exec(text.trim());
  if (selfAttach !== null) {
    const perEnergy = Number(selfAttach[1]);
    return perEnergy < 1 ? null : { kind: "selfHandAttach", per: perEnergy, energyType: "Water" };
  }
  const handBoost = HAND_DISCARD_SCALED_BOOST.exec(text.trim());
  if (handBoost !== null) {
    const handCap = Number(handBoost[1]);
    const handPer = Number(handBoost[2]);
    return handCap >= 1 && handPer >= 1
      ? { kind: "handDiscard", cap: handCap, per: handPer }
      : null;
  }
  const match = BENCH_DISCARD_SCALED_BOOST.exec(text.trim());
  if (match === null) return null;
  const cap = Number(match[1]);
  const per = Number(match[3]);
  // A printed "up to 0" or 0 per card would be a silent no-op, so both stay loud.
  if (cap < 1 || per < 1) return null;
  return {
    kind: "benchDiscard",
    cap,
    per,
    // "Basic" names the card, not what it provides: a Special Energy providing {C} is not a Basic
    // Energy card.
    filter: match[2] === undefined ? { kind: "anyEnergy" } : { kind: "basicEnergy" },
  };
}

/**
 * Assemble the additive reading into its ops given the attack's base. `base` is set even at 0,
 * since an absent `base` means the multiply family's dropped base. The discard or attach runs first
 * because the damage reads what it recorded.
 */
export function discardScaledBoostProgram(
  reading: AttackDiscardScaledBoost,
  base: number,
): EffectOp[] {
  // Switch on the discriminator so a new member is a missing case rather than silently matching
  // another arm.
  switch (reading.kind) {
    case "benchDiscard":
      return [
        {
          op: "discardEnergy",
          // The printed "your Benched Pokémon" — the own side MINUS the Active, which is
          // why `yours` is the wrong member: the Active's Energy paid for this attack.
          from: "yourBench",
          filter: reading.filter,
          // "Up to N" is the declinable mode with a ceiling.
          count: "any",
          cap: reading.cap,
          recordAs: "discarded",
        },
        { op: "damageDefender", base, per: reading.per, count: "discarded" },
      ];
    case "eachDeckMill":
      return [
        // The printed "the top card of each player's deck": ONE card, BOTH decks, and
        // one §9.2 filing holding what came off both — see the op's own block for why
        // two sequential mills cannot spell this (the slot is ASSIGNED, not appended).
        // The mill itself is UNFILTERED, exactly as `discardDeckTop`'s block says it
        // stays: the top card leaves whatever it is, and only the DAMAGE asks which of
        // the two were Energy.
        { op: "discardDeckTop", whose: "eachPlayer", count: 1, recordAs: "discarded" },
        // The printed "Energy card" filters the count, not the mill. The printed base is kept and
        // added in the same §8.5 pass.
        {
          op: "damageDefender",
          base,
          per: reading.per,
          count: "discarded",
          countFilter: { kind: "anyEnergy" },
        },
      ];
    case "selfHandAttach":
      // Attach before damage: the damage reads the Energy actually attached. `base` here is the
      // declaration-time multiplier, so the hit equals the head on the post-attach board.
      return [
        {
          op: "attachFromHand",
          filter: { kind: "basicEnergy", energyType: reading.energyType },
          toSelf: true,
          recordAs: "moved",
        },
        { op: "damageDefender", base, per: reading.per, count: "moved" },
      ];
    case "handDiscard":
      // Discard before damage so the damage reads what was paid; the printed base is kept.
      return [
        {
          op: "payFromHand",
          count: "any",
          cap: reading.cap,
          to: "discard",
          filter: { kind: "anyEnergy" },
          recordAs: "discarded",
        },
        { op: "damageDefender", base, count: "discarded", per: reading.per },
      ];
  }
}

/**
 * The closed list of whole printed attack clauses keyed to one attack: timing gates and cost
 * clauses. Each is a literal matched only at a sentence boundary, because a mis-parsed template
 * condition could silently bar a legal attack forever.
 */
const ATTACK_GATE_CLAUSES = [
  "If you go second, you can't use this attack during your first turn.",
  "If you go first, you can use this attack during your first turn.",
  "You can use this attack only if you go second, and only during your first turn.",
  "You can use this attack only if this Pokémon used Rollout during your last turn.",
  "If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.",
  // Cost clauses rather than timing gates.
  "If this Pokémon has any damage counters on it, this attack can be used for {F}.",
  "If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.",
  "If this Pokémon has any damage counters on it, this attack can be used for {D}.",
] as const;

/**
 * Derived from the tuple, so `ATTACK_GATE_CLAUSE_GATES` below is a total map the compiler enforces.
 */
export type AttackGateClause = (typeof ATTACK_GATE_CLAUSES)[number];

/**
 * The going-second player's own first turn (turn 2): `yourFirstTurn` is a per-seat fact, not
 * `state.turn === 1`.
 */
const ATTACK_GATE_SECOND_PLAYERS_FIRST_TURN: BoardCondition = {
  kind: "allOf",
  conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
};

/**
 * Takes a listed gate or cost clause off the front or the end of an attack's effect text and
 * returns the clause and the remaining body, or `null` when the text carries none. `body` is `""`
 * when the clause is the whole text. No reader's `^…$` anchor is relaxed: a whole sentence is
 * removed at a sentence boundary and the readers run over the remainder whole. The caller must
 * already enforce the clause through `attackGate`; otherwise dropping the sentence would silently
 * lose it.
 */
export function splitAttackGateClause(
  text: string,
): { clause: AttackGateClause; body: string } | null {
  const trimmed = text.trim();
  // Refuse a string that carries listed clauses at both ends (or more than one), rather than guess
  // which one the caller accounted for. Returning `null` keeps the whole text on the loud
  // `ATTACK_EFFECT_SKIPPED` path instead of throwing.
  const leadingHits = ATTACK_GATE_CLAUSES.filter(
    (clause) => trimmed !== clause && trimmed.startsWith(`${clause} `),
  );
  const trailingHits = ATTACK_GATE_CLAUSES.filter(
    (clause) => trimmed !== clause && trimmed.endsWith(` ${clause}`),
  );
  if (leadingHits.length + trailingHits.length > 1) return null;
  for (const clause of ATTACK_GATE_CLAUSES) {
    // A clause-only printing (e.g. Miltank) is a match with an empty body, not a miss; downstream
    // treats `""` as no text. Checked before `startsWith` because a clause-only string has no
    // trailing space to match.
    if (trimmed === clause) return { clause, body: "" };
    if (trimmed.startsWith(`${clause} `)) {
      const body = trimmed.slice(clause.length + 1).trim();
      // Whitespace-only behind the clause is the same answer as nothing behind it,
      // by the branch above — the trim is what makes the two one case.
      return { clause, body };
    }
    // Trailing clause (Sylveon ex "Angelite"). The leading space is part of the pattern so only a
    // whole sentence after the previous period matches, not a mid-word suffix.
    if (trimmed.endsWith(` ${clause}`)) {
      const body = trimmed.slice(0, trimmed.length - clause.length - 1).trim();
      return { clause, body };
    }
  }
  return null;
}

/**
 * Each printed clause mapped to the gate it means. The two `If you go …` rows point in opposite
 * directions: the go-second row adds a restriction (`barredIf`), while the go-first row removes the
 * §4 first-turn attack ban (`firstTurnExempt`). Some rows are cost clauses (`alternateCostIf`,
 * `costWaivedIf`) that never bar the declaration. A `Record` rather than a `Partial`, so adding a
 * clause without deciding its gate does not typecheck.
 */
const ATTACK_GATE_CLAUSE_GATES: Record<AttackGateClause, AttackTimingGate> = {
  "If you go second, you can't use this attack during your first turn.": {
    kind: "barredIf",
    condition: ATTACK_GATE_SECOND_PLAYERS_FIRST_TURN,
  },
  "If you go first, you can use this attack during your first turn.": {
    kind: "firstTurnExempt",
  },
  "You can use this attack only if you go second, and only during your first turn.": {
    kind: "onlyIf",
    condition: ATTACK_GATE_SECOND_PLAYERS_FIRST_TURN,
  },
  "You can use this attack only if this Pokémon used Rollout during your last turn.": {
    kind: "onlyIf",
    condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
  },
  // Sylveon ex "Angelite": `yourPokemonUsedAttackLastTurn`, not `yourActiveUsedAttackLastTurn`. The
  // two differ only when the body that used Angelite has left the Active Spot, which is the board
  // the card is printed for. `barredIf` because the printed polarity is a ban.
  "If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.": {
    kind: "barredIf",
    condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
  },
  // Cost clauses printed as the whole effect text, so the split answers `body: ""`. They are read
  // by `attackCostAt` and excluded from `BlockingAttackGate`; otherwise `attackTimingBlocked` would
  // refuse the attack exactly when the card makes it cheaper.
  "If this Pokémon has any damage counters on it, this attack can be used for {F}.": {
    kind: "alternateCostIf",
    condition: { kind: "yourActiveDamaged" },
    cost: ["Fighting"],
  },
  "If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.": {
    kind: "costWaivedIf",
    condition: { kind: "yourActiveHasSpecialCondition" },
  },
  // Crawdaunt "Cutting Riposte": the same damaged-body alternate cost at {D}.
  "If this Pokémon has any damage counters on it, this attack can be used for {D}.": {
    kind: "alternateCostIf",
    condition: { kind: "yourActiveDamaged" },
    cost: ["Darkness"],
  },
};

/**
 * The gate a printed clause in the attack text means, or `undefined` when it carries none; includes
 * cost clauses despite the name. The derived half of `attackGateOf`, which prefers the registry.
 * Deliberately not named `deriveAttack…`: that prefix marks whole-sentence readers returning `T |
 * null`, and the census enrols exports by that prefix.
 */
export function timingGateFromAttackText(text: string | undefined): AttackTimingGate | undefined {
  if (text === undefined) return undefined;
  const split = splitAttackGateClause(text);
  return split === null ? undefined : ATTACK_GATE_CLAUSE_GATES[split.clause];
}

/**
 * Every whole-sentence attack reader this module exports, in the order `attack.ts` calls them. Used
 * by `splitAttackTrailingClause`; a reader missing from this list would let the splitter claim a
 * compound that reader already reads whole, so a test pins it against the module's `deriveAttack`
 * exports.
 */
const ATTACK_WHOLE_SENTENCE_READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
];

// `deriveAttackCopy` is deliberately absent: it returns no program, so admitting a compound whose
// head is a copy sentence would hand the head to `deriveAttackEffect` and silently drop the copy.

/** Does ANY whole-sentence reader claim this string? The splitter's refusal and
    its admission are the same question asked of two different strings. */
function claimedByAnyReader(text: string): boolean {
  return ATTACK_WHOLE_SENTENCE_READERS.some((read) => read(text) !== null);
}

/**
 * A sentence break inside an attack's effect text: a period (optionally closing a parenthetical),
 * whitespace, then a capital or an opening parenthesis. The lookahead keeps `etc. have` and
 * `sv08.5` from being breaks.
 */
const COMPOUND_CLAUSE_BREAK = /(?<=\.\)?)\s+(?=[A-Z(])/;

/**
 * Splits a compound into a head and a trailing effect clause, or `null` unless no reader claims the
 * whole string, `deriveAttackEffect` claims the tail and some reader claims the head. A string any
 * reader claims whole is left to that reader. Splits at the last boundary, so a head that is itself
 * a compound is refused unless a reader claims it whole.
 */
export function splitAttackTrailingClause(text: string): { head: string; tail: string } | null {
  const trimmed = text.trim();
  // The shadow refusal, FIRST: a string any reader claims whole is that reader's,
  // and composition never gets a look at it.
  if (claimedByAnyReader(trimmed)) return null;
  const parts = trimmed.split(COMPOUND_CLAUSE_BREAK);
  if (parts.length < 2) return null;
  const tail = parts[parts.length - 1] ?? "";
  const head = parts.slice(0, -1).join(" ");
  // The tail must be an EFFECT clause specifically — it is the half the caller
  // appends to the program, and a tail claimed only by a damage reader would be a
  // fold the caller has no place to put (the damage readers all read the HEAD).
  if (deriveAttackEffect(tail) === null) return null;
  if (!claimedByAnyReader(head)) return null;
  return { head, tail };
}

/**
 * The optional type filter on a "for each [token] Energy attached" sentence: `null` when no token
 * is printed (every attached card counts) and `undefined` for a token that resolves to nothing,
 * which callers send to `ATTACK_EFFECT_SKIPPED`. The two nullish answers must not be collapsed: one
 * counts everything, the other must count nothing.
 */
function attachedEnergyFilter(
  token: string | undefined,
): BasicEnergyType | "special" | "basic" | null | undefined {
  return token === undefined ? null : literalClauseRow(CLAUSE_ENERGY_TOKENS, token);
}

/** The matched status word, lowercased into the event vocabulary. The regex
    alternation guarantees the word; the fallback only satisfies
    noUncheckedIndexedAccess. */
function statusOf(word: string | undefined): StatusName {
  return STATUS_OF_WORD[(word ?? "Asleep") as StatusWord];
}

/**
 * Which `SpecialConditions` field each status word writes. Asleep, Paralyzed and Confused share one
 * field, so applying two of them would overwrite; `defenderStatusOps` uses this to refuse such
 * combinations.
 */
const CONDITION_SLOT: Record<StatusName, keyof SpecialConditions> = {
  asleep: "rotation",
  paralyzed: "rotation",
  confused: "rotation",
  poisoned: "poisonDamage",
  burned: "burned",
};

/**
 * The printed status words as `applyStatus` ops in printed order, or `null` when two of them share
 * a `SpecialConditions` slot (two rotation words, or a repeated word) and so cannot coexist.
 */
function defenderStatusOps(words: (string | undefined)[]): EffectOp[] | null {
  const statuses = words.map(statusOf);
  const slots = statuses.map((s) => CONDITION_SLOT[s]);
  if (new Set(slots).size !== slots.length) return null;
  return statuses.map((status): EffectOp => ({ op: "applyStatus", target: "defender", status }));
}

// Pre-damage acts ("Before doing damage, …") are not `EffectOp`s: effect programs run after the
// §8.5 damage pipeline, and an `EffectOp` could park on a choice with no way to continue into the
// damage step. So they are a closed union applied by a total function that returns a board
// (`applyAttackPreDamage`), which makes a member needing a decision unwritable. Its result may gain
// plain-data fields but never one a resolver would have to drain.

/**
 * The act an attack performs before its damage step. Separate kinds rather than optional riders, so
 * a dropped rider is a compile error instead of silently degrading into another member.
 */
export type AttackPreDamage =
  /** "…discard all Pokémon Tools from your opponent's Active Pokémon." */
  | { kind: "discardOpponentActiveTools" }
  /**
   * "…discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon." Special is
   * the card class, so Basic Energy stays attached.
   */
  | { kind: "discardOpponentActiveToolsAndSpecialEnergy" }
  /**
   * "…discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does
   * nothing."
   */
  | { kind: "discardOwnToolsElseCancel" }
  /**
   * "…If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now
   * Paralyzed."
   */
  | { kind: "discardOpponentActiveToolsThenParalyze" };

/**
 * Literal anchors rather than a template: the rows differ by whole clauses, not by a varying token.
 * The four are mutually exclusive because the bare row's anchor ends at the period the others
 * continue past.
 */
const ATTACK_PRE_DAMAGE_TOOL_DISCARD =
  /^Before doing damage, discard all Pokémon Tools from your opponent['’]s Active Pokémon\.$/;

/** Row 71 — the SECOND ZONE. `Tools and Special Energy` is one noun phrase over two
    attachment kinds, and both come off the same body. */
const ATTACK_PRE_DAMAGE_TOOL_AND_SPECIAL_DISCARD =
  /^Before doing damage, discard all Pokémon Tools and Special Energy from your opponent['’]s Active Pokémon\.$/;

/** Row 72 — the OWN-BODY strip with the printed cancel branch. Two sentences in one
    printed `effect` string, anchored WHOLE: the cancel is not separable, because
    *"any"* refers back to the first sentence's act and means nothing on its own. */
const ATTACK_PRE_DAMAGE_OWN_TOOL_DISCARD_OR_NOTHING =
  /^Before doing damage, discard all Pokémon Tools from this Pokémon\. If you can['’]t discard any, this attack does nothing\.$/;

/** Row 74 — row 73's act plus a consequent conditioned on its RESULT. Anchored whole
    for row 72's reason: *"in this way"* is a §9.2 back-reference and is false of any
    string that does not carry the act it refers to. */
const ATTACK_PRE_DAMAGE_TOOL_DISCARD_THEN_PARALYZE =
  /^Before doing damage, discard all Pokémon Tools from your opponent['’]s Active Pokémon\. If you discarded a Pokémon Tool in this way, your opponent['’]s Active Pokémon is now Paralyzed\.$/;

/** The "Before doing damage, …" family, whole-sentence anchored; `null` for every other string. */
export function deriveAttackPreDamage(text: string): AttackPreDamage | null {
  const trimmed = text.trim();
  if (ATTACK_PRE_DAMAGE_TOOL_DISCARD.test(trimmed)) return { kind: "discardOpponentActiveTools" };
  if (ATTACK_PRE_DAMAGE_TOOL_AND_SPECIAL_DISCARD.test(trimmed)) {
    return { kind: "discardOpponentActiveToolsAndSpecialEnergy" };
  }
  if (ATTACK_PRE_DAMAGE_OWN_TOOL_DISCARD_OR_NOTHING.test(trimmed)) {
    return { kind: "discardOwnToolsElseCancel" };
  }
  if (ATTACK_PRE_DAMAGE_TOOL_DISCARD_THEN_PARALYZE.test(trimmed)) {
    return { kind: "discardOpponentActiveToolsThenParalyze" };
  }
  return null;
}

/**
 * The phrase every copy-family sentence prints. attack.ts drops any candidate attack carrying it,
 * so a copy can never copy a copy. Deliberately the bare phrase rather than the anchors, so every
 * family member is excluded.
 */
export const COPY_FAMILY_MARKER = /use it as this attack/;

export function isInPlayAttackCopy(
  copy: AttackCopy | ResolvedAttackCopy | InPlayAttackCopy,
): copy is InPlayAttackCopy {
  return copy.from === "opponentInPlay";
}

/** Does this copy resolve mid-attack rather than at declaration? */
export function isResolvedAttackCopy(
  copy: AttackCopy | ResolvedAttackCopy | InPlayAttackCopy,
): copy is ResolvedAttackCopy {
  return copy.from === "opponentDeckTop" || copy.from === "ownDeckTopMill";
}

// Copy-attack sentences ("…and use it as this attack."), each anchored whole. This reader returns
// no program: the sentence replaces the attack, and attack.ts re-enters `attack()` with the copied
// attack's damage, text and gate while the copier keeps its name, type, cost and
// Weakness/Resistance. Copied text still reports `ATTACK_EFFECT_SKIPPED` when unbuilt, and a copied
// gate clause is enforced for the copier.
const ATTACK_COPY_OPPONENT_ACTIVE =
  /^Choose 1 of your opponent['’]s Active Pokémon['’]s attacks and use it as this attack\.$/;

const ATTACK_COPY_OPPONENT_ACTIVE_TERA =
  /^Choose 1 of your opponent['’]s Active Tera Pokémon['’]s attacks and use it as this attack\.$/;

const ATTACK_COPY_BENCHED_N =
  /^Choose 1 of your Benched N['’]s Pokémon['’]s attacks and use it as this attack\.$/;

const ATTACK_COPY_FLIP_OPPONENT_ACTIVE =
  /^Flip a coin\. If heads, choose 1 of your opponent['’]s Active Pokémon['’]s attacks and use it as this attack\.$/;

// Haughty Order and Seek Inspiration: the copy is chosen after the reveal or mill, mid-attack.
const ATTACK_COPY_OPPONENT_DECK_TOP =
  /^Reveal the top 10 cards of your opponent['’]s deck\. You may choose an attack from a Pokémon you find there and use it as this attack\. Shuffle the revealed cards into your opponent['’]s deck\.$/;

const ATTACK_COPY_OWN_DECK_TOP_MILL =
  /^Discard the top card of your deck, and if that card is a Pokémon that doesn['’]t have a Rule Box, choose 1 of its attacks and use it as this attack\. \(Pokémon ex, Pokémon V, etc\. have Rule Boxes\.\)$/;

// Thievul "Skill Thief".
const ATTACK_COPY_OPPONENT_IN_PLAY_EMPTY_HAND =
  /^If you have no cards in your hand, choose an attack from 1 of your opponent['’]s Pokémon in play and use it as this attack\.$/;

/** The copy-attack reader: the whole-sentence anchors above, `null` for every other string. */
export function deriveAttackCopy(
  text: string,
): AttackCopy | ResolvedAttackCopy | InPlayAttackCopy | null {
  const trimmed = text.trim();
  if (ATTACK_COPY_OPPONENT_ACTIVE.test(trimmed)) return { from: "opponentActive" };
  if (ATTACK_COPY_OPPONENT_ACTIVE_TERA.test(trimmed)) return { from: "opponentActiveTera" };
  if (ATTACK_COPY_BENCHED_N.test(trimmed)) return { from: "benchOwner", owner: "N" };
  if (ATTACK_COPY_FLIP_OPPONENT_ACTIVE.test(trimmed)) return { from: "opponentActive", flip: true };
  if (ATTACK_COPY_OPPONENT_DECK_TOP.test(trimmed))
    return { from: "opponentDeckTop", count: 10, may: true };
  if (ATTACK_COPY_OWN_DECK_TOP_MILL.test(trimmed)) return { from: "ownDeckTopMill", count: 1 };
  if (ATTACK_COPY_OPPONENT_IN_PLAY_EMPTY_HAND.test(trimmed))
    return { from: "opponentInPlay", ifEmptyHand: true };
  return null;
}
