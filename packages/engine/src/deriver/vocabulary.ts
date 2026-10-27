import { BASIC_ENERGY_TYPES, type BasicEnergyType } from "@colorless/schema/constants";
import { TYPE_SYMBOL } from "../cardText";
import { POKEMON_TYPES, type PokemonType } from "../effectTypes";
import type { StatusName } from "../events";

// The printed-text vocabulary the deriver reads and the runtime also needs: status words, type
// codes, the apostrophe fold and the copy-family marker. Kept apart from the deriver so a runtime
// module can use it without importing the parser.

export type StatusWord = "Asleep" | "Burned" | "Confused" | "Paralyzed" | "Poisoned";

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

export const STATUS_OF_WORD: Record<StatusWord, StatusName> = {
  Asleep: "asleep",
  Burned: "burned",
  Confused: "confused",
  Paralyzed: "paralyzed",
  Poisoned: "poisoned",
};

// Both printed energy notations: brace codes ({L}) and spelled-out names (Fire). {C} and {N} are
// absent (§6.1): Colorless is the provision fallback for unauthored Special Energy, so a {C} filter
// would match cards nobody meant.
export const ENERGY_TYPE_BY_CODE: Readonly<Record<string, BasicEnergyType>> = Object.fromEntries(
  BASIC_ENERGY_TYPES.map((type) => [TYPE_SYMBOL[type], type]),
);

/** The spelled-out notation, keyed straight off BASIC_ENERGY_TYPES rather than
    re-listed — so the two notations cannot resolve to different vocabularies, and
    a type added to the schema is admitted here by construction. */
export const ENERGY_TYPE_BY_NAME: Readonly<Record<string, BasicEnergyType>> = Object.fromEntries(
  BASIC_ENERGY_TYPES.map((type) => [type, type]),
);

/**
 * Brace code read as a Pokémon type rather than a payable Energy. Extends `ENERGY_TYPE_BY_CODE`
 * with `N` (Dragon, which has no Basic Energy) and `C` (Colorless, excluded from the energy map
 * because `{C}` there is the Special Energy fallback).
 */
export const POKEMON_TYPE_BY_CODE: Readonly<Record<string, PokemonType>> = Object.fromEntries(
  POKEMON_TYPES.map((type) => [TYPE_SYMBOL[type], type]),
);

/**
 * Every exact lookup on printed text goes through this fold so curly and straight apostrophes match
 * the same key.
 */
export const CURLY_APOSTROPHE = "’";

export const STRAIGHT_APOSTROPHE = "'";

/**
 * The same apostrophe fold applied to a captured value rather than a table key.
 */
export function foldApostrophes(text: string): string {
  return text.includes(CURLY_APOSTROPHE)
    ? text.replaceAll(CURLY_APOSTROPHE, STRAIGHT_APOSTROPHE)
    : text;
}

/**
 * The phrase every copy-family sentence prints. attack.ts drops any candidate attack carrying it,
 * so a copy can never copy a copy. Deliberately the bare phrase rather than the anchors, so every
 * family member is excluded.
 */
export const COPY_FAMILY_MARKER = /use it as this attack/;
