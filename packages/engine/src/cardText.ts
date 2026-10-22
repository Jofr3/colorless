import type { Ability, Attack, Card } from "@colorless/schema";

// 🆕🆕🆕 D612 — WP06: THE tcgdex MARKUP NORMALISER. ONE pure text function, applied in two places:
// at INGEST (apps/api/src/ingest/map.ts writes every card text through it) and at READ time
// (cards.ts `cardOfUid`, the engine's one card accessor, reads a face through `normalizedFace`).
// The read-time half is the D581 / D583 lesson: `GameState.cardPool` persists whole Card faces in a
// MatchRecord, so a match created before the re-ingest holds the RAW text, and the engine must read
// it the same as a re-ingested row.
//
// What tcgdex prints, and the `sv` spelling it is normalised to (LOCAL D1, 2026-10-09; the `sv` rows
// carry none of it, so every `sv` text is a fixed point — measured over every attack, Ability and
// rules text in the LOCAL D1 on 2026-10-09; `cardTextD612.test.ts` PINS it over the two committed
// attack corpora only, not over the `sv` Ability / Trainer / Energy texts):
//   • `<span class="energy-symbol Lightning" title="Lightning">Lightning</span>` → `{L}`
//     (17 `30th` / `30th-c` texts; an unknown type word keeps the span unchanged);
//   • `<em>` / `</em>` → removed (the reminder parentheticals and "Pokémon <em>ex</em>"); a run of
//     spaces or tabs right after an `<em>` that follows a space is dropped with it (`30th-c`);
//   • `[R]` → `{R}` (Mega Charizard X ex `mep-023` / `-029` "Inferno X", R-IX1);
//   • a type WORD before "Energy" or "Pokémon", alone or in a list joined by ", " / " or " /
//     " and " → its symbol ("Basic Fire Energy card" → "Basic {R} Energy card", "6 or more Grass
//     Energy" → "6 or more {G} Energy"; the non-legal `swsh10.5` prints the same word forms);
//   • a run of two or more GLUED type words → one symbol each ("ColorlessColorless" → "{C}{C}",
//     Zoroark `30th-096`; "FireFire" `swsh10.5-010`), and one type word before "less" / "more" (a
//     cost: "cost Colorless less" `swsh10.5-011`).
// A type word anywhere else (an attack NAME such as "Dragon Strike") is left alone. Idempotent:
// no output spelling matches any rule.

/** The type word → its energy-symbol letter (tcgdex's `{X}` spelling in the `sv` rows). */
const SYMBOL_OF: Readonly<Record<string, string>> = {
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

const TYPE_WORD = "Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless";

/** Anything the rules below could touch: a tag, a bracket, or a type word. */
const MAY_CARRY_MARKUP = new RegExp(`[<[]|${TYPE_WORD}`);
const ENERGY_SPAN = /<span class="energy-symbol ([A-Za-z]+)"[^>]*>[^<]*<\/span>/g;
const EM_AFTER_SPACE = /([ \t])<em>[ \t]+/g;
const EM_TAG = /<\/?em>/g;
const BRACKET_SYMBOL = /\[([GRWLPFDMYNC])\]/g;
const GLUED_TYPE_WORDS = new RegExp(`\\b(?:(?:${TYPE_WORD}){2,}\\b|(?:${TYPE_WORD})(?= (?:less|more)\\b))`, "g");
const TYPE_WORD_LIST_BEFORE_NOUN = new RegExp(
  `\\b(?:${TYPE_WORD})(?:(?:,? or |,? and |, )(?:${TYPE_WORD}))*(?= (?:Energy|Pokémon)\\b)`,
  "g",
);
const ONE_TYPE_WORD = new RegExp(TYPE_WORD, "g");

function symbolsOf(words: string): string {
  return words.replace(ONE_TYPE_WORD, (word) => `{${SYMBOL_OF[word]}}`);
}

/** 🆕🆕🆕 D612 — one card text (an attack's or Ability's `effect`, or a Trainer's / Energy's) in the
    `sv` spelling. Pure and idempotent; a text with no markup comes back as the same string. */
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
    .replace(TYPE_WORD_LIST_BEFORE_NOUN, (list) => list.replace(ONE_TYPE_WORD, (word) => `{${SYMBOL_OF[word]}}`));
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

/** 🆕🆕🆕 D612 — `card` with every printed text through `normalizeCardText`: the SAME object when
    nothing changes (every `sv` face, every re-ingested row), else a shallow copy with new text. */
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
