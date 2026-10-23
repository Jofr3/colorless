import type { Ability, Attack, Card } from "@colorless/schema";
import { POKEMON_TYPES, type PokemonType } from "./effectTypes";

// Normalises tcgdex card-text markup to the `sv` spelling. Applied at ingest and again at read
// time, because a persisted `GameState.cardPool` may still hold raw faces. Rules: energy-symbol
// spans, `[R]`, type words before "Energy"/"Pokémon" (alone or in a list) and glued type words
// ("ColorlessColorless") become `{X}` symbols; `<em>` tags are removed. A type word elsewhere, such
// as an attack name, is left alone. Idempotent.

/** Each type word's energy-symbol letter (tcgdex's `{X}` spelling in the `sv` rows). */
export const TYPE_SYMBOL: Readonly<Record<PokemonType, string>> = {
  Grass: "G",
  Fire: "R",
  Water: "W",
  Lightning: "L",
  Psychic: "P",
  Fighting: "F",
  Darkness: "D",
  Metal: "M",
  Fairy: "Y",
  Dragon: "N",
  Colorless: "C",
};

const SYMBOL_OF: Readonly<Record<string, string>> = TYPE_SYMBOL;

const TYPE_WORD = POKEMON_TYPES.join("|");

/** Anything the rules below could touch: a tag, a bracket, or a type word. */
const MAY_CARRY_MARKUP = new RegExp(`[<[]|${TYPE_WORD}`);
const ENERGY_SPAN = /<span class="energy-symbol ([A-Za-z]+)"[^>]*>[^<]*<\/span>/g;
const EM_AFTER_SPACE = /([ \t])<em>[ \t]+/g;
const EM_TAG = /<\/?em>/g;
const BRACKET_SYMBOL = /\[([GRWLPFDMYNC])\]/g;
const GLUED_TYPE_WORDS = new RegExp(
  `\\b(?:(?:${TYPE_WORD}){2,}\\b|(?:${TYPE_WORD})(?= (?:less|more)\\b))`,
  "g",
);
const TYPE_WORD_LIST_BEFORE_NOUN = new RegExp(
  `\\b(?:${TYPE_WORD})(?:(?:,? or |,? and |, )(?:${TYPE_WORD}))*(?= (?:Energy|Pokémon)\\b)`,
  "g",
);
const ONE_TYPE_WORD = new RegExp(TYPE_WORD, "g");

function symbolsOf(words: string): string {
  return words.replace(ONE_TYPE_WORD, (word) => `{${SYMBOL_OF[word]}}`);
}

/**
 * One card text in the `sv` spelling. Pure and idempotent; text with no markup is returned
 * unchanged.
 */
export function normalizeCardText(text: string): string {
  if (!MAY_CARRY_MARKUP.test(text)) return text;
  return text
    .replace(ENERGY_SPAN, (span, word: string) => {
      const letter = SYMBOL_OF[word];
      return letter === undefined ? span : `{${letter}}`;
    })
    .replace(EM_AFTER_SPACE, (_match, space: string) => space)
    .replace(EM_TAG, () => "")
    .replace(BRACKET_SYMBOL, (_match, letter: string) => `{${letter}}`)
    .replace(GLUED_TYPE_WORDS, (run) => symbolsOf(run))
    .replace(TYPE_WORD_LIST_BEFORE_NOUN, (list) =>
      list.replace(ONE_TYPE_WORD, (word) => `{${SYMBOL_OF[word]}}`),
    );
}

function normalizedBlock<T extends Ability | Attack>(block: T): T {
  if (block.effect === undefined) return block;
  const effect = normalizeCardText(block.effect);
  return effect === block.effect ? block : { ...block, effect };
}

function normalizedBlocks<T extends Ability | Attack>(blocks: T[]): T[] {
  const out = blocks.map(normalizedBlock);
  return out.every((block, i) => block === blocks[i]) ? blocks : out;
}

/** Faces already normalised, keyed by the face read: a persisted pool is revived once per load,
    and the engine reads the same object many times per action. */
const FACES = new WeakMap<Card, Card>();

/**
 * `card` with every printed text normalised: the same object when nothing changes, otherwise a
 * shallow copy.
 */
export function normalizedFace(card: Card): Card {
  const hit = FACES.get(card);
  if (hit !== undefined) return hit;
  const attacks = card.attacks == null ? card.attacks : normalizedBlocks(card.attacks);
  const abilities = card.abilities == null ? card.abilities : normalizedBlocks(card.abilities);
  const effect = card.effect == null ? card.effect : normalizeCardText(card.effect);
  const face =
    attacks === card.attacks && abilities === card.abilities && effect === card.effect
      ? card
      : { ...card, attacks, abilities, effect };
  FACES.set(card, face);
  return face;
}
