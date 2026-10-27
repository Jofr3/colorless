// GET /cards/index: every card as one compact row, so the builder searches names and rules text in
// the browser instead of running a LIKE that scans the whole table per keystroke (security audit
// CA1). `searchCardIndex` reproduces GET /cards' filters and orders over these rows (the API's
// catalog/query.ts), and catalog/cardIndex.d1.test.ts in the API holds the two to the same answers.

import type { CardBrief } from "./card";
import type { CardsQuery } from "./query";

/**
 * The column order of a GET /cards/index row. Text columns hold the stored values, not the
 * served ones: a filter matches the stored value, and `abilities` and `attacks` are the stored JSON
 * text, which GET /cards' `text` search matches inside (keys included).
 */
export const CARD_INDEX_COLUMNS = [
  "id",
  "name",
  "category",
  "rarity",
  "hasImage",
  "setId",
  "localId",
  "types",
  "hp",
  "regulationMark",
  "stage",
  "trainerType",
  "energyType",
  "suffix",
  "illustrator",
  "legalStandard",
  "legalExpanded",
  "abilities",
  "attacks",
  "effect",
] as const;

/** One card, in CARD_INDEX_COLUMNS order. `hasImage` and the legality flags are 0 or 1; `types`,
    `abilities` and `attacks` are JSON text. */
export type CardIndexRow = [
  id: string,
  name: string,
  category: CardBrief["category"],
  rarity: string | null,
  hasImage: 0 | 1,
  setId: string,
  localId: string,
  types: string | null,
  hp: number | null,
  regulationMark: string | null,
  stage: string | null,
  trainerType: string | null,
  energyType: string | null,
  suffix: string | null,
  illustrator: string | null,
  legalStandard: 0 | 1,
  legalExpanded: 0 | 1,
  abilities: string | null,
  attacks: string | null,
  effect: string | null,
];

/** The GET /cards/index body. Rows come in no particular order. */
export interface CardIndexPayload {
  version: 1;
  /** Each set's serie, for the `serie` filter. */
  series: Record<string, string>;
  cards: CardIndexRow[];
}

/** SQLite's LIKE and lower() fold ASCII letters only; any other character must match exactly. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/** SQLite's BINARY order (UTF-8 bytes, so code points). UTF-16 units agree with it except that a
    surrogate (part of a code point past U+FFFF) must sort after every other unit. */
function binaryCompare(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) {
      const surrogate = (unit: number) =>
        unit >= 0xd800 && unit <= 0xdfff ? unit + 0x10000 : unit;
      return surrogate(x) - surrogate(y);
    }
  }
  return a.length - b.length;
}

/** The API's "no value" sentinels (apps/api/src/sentinel.ts), dropped from served values. */
function served(value: string | null): string | null {
  if (value === null) return null;
  const folded = value.trim().toLowerCase();
  return folded === "" || folded === "none" ? null : value;
}

/** A row with its case-folded search text, prepared once per index. */
interface SearchableCard {
  row: CardIndexRow;
  name: string;
  types: string | null;
  texts: string[];
}

export interface CardIndex {
  cards: readonly SearchableCard[];
  series: ReadonlyMap<string, string>;
  /** Row positions in each `sort` order, every one ending on collector order like GET /cards. */
  orders: Record<CardsQuery["sort"], readonly number[]>;
}

export function prepareCardIndex(payload: CardIndexPayload): CardIndex {
  const cards = payload.cards.map(
    (row): SearchableCard => ({
      row,
      name: asciiLower(row[1]),
      types: row[7] === null ? null : asciiLower(row[7]),
      texts: [row[17], row[18], row[19]].flatMap((text) =>
        text === null ? [] : [asciiLower(text)],
      ),
    }),
  );
  const collector = (a: number, b: number) => {
    const [x, y] = [payload.cards[a] as CardIndexRow, payload.cards[b] as CardIndexRow];
    return binaryCompare(x[5], y[5]) || binaryCompare(x[6], y[6]);
  };
  const set = cards.map((_, index) => index).sort(collector);
  // Array sorts are stable, so sorting the collector order keeps it as the tie-break.
  const name = [...set].sort((a, b) =>
    binaryCompare((payload.cards[a] as CardIndexRow)[1], (payload.cards[b] as CardIndexRow)[1]),
  );
  const hp = (index: number) => pokemonHp(payload.cards[index] as CardIndexRow) ?? -1;
  const hpDesc = [...set].sort((a, b) => hp(b) - hp(a));
  return {
    cards,
    series: new Map(Object.entries(payload.series)),
    orders: { set, name, "hp-desc": hpDesc },
  };
}

/** A card's HP as a Pokémon (GET /cards' hp filters and sort ignore a Trainer's printed HP). */
function pokemonHp(row: CardIndexRow): number | null {
  return row[2] === "Pokemon" ? row[8] : null;
}

/** `value` is one of `wanted`, or no filter was given. A null never matches, as in SQL. */
const oneOf = (wanted: readonly string[] | undefined, value: string | null) =>
  wanted === undefined || (value !== null && wanted.includes(value));

/** `value` equals `wanted`, or no filter was given. */
const equals = (wanted: string | undefined, value: string | null) =>
  wanted === undefined || value === wanted;

/** GET /cards' `where` (apps/api/src/catalog/query.ts) for one card. */
function matches(card: SearchableCard, query: CardsQuery, series: ReadonlyMap<string, string>) {
  const { row } = card;
  const hp = pokemonHp(row);
  return (
    (query.id === undefined || query.id.includes(row[0])) &&
    (query.name === undefined || card.name.includes(asciiLower(query.name))) &&
    (query.nameExact === undefined || card.name === asciiLower(query.nameExact)) &&
    equals(query.category, row[2]) &&
    (query.type === undefined ||
      query.type.some((type) => card.types?.includes(asciiLower(`"${type}"`)) === true)) &&
    oneOf(query.rarity, row[3]) &&
    oneOf(query.stage, row[10]) &&
    oneOf(query.suffix, row[13]) &&
    oneOf(query.trainerType, row[11]) &&
    oneOf(query.energyType, row[12]) &&
    equals(query.set, row[5]) &&
    (query.serie === undefined || series.get(row[5]) === query.serie) &&
    equals(query.illustrator, row[14]) &&
    (query.text === undefined ||
      card.texts.some((text) => text.includes(asciiLower(query.text as string)))) &&
    equals(query.regulationMark, row[9]) &&
    (query.hpMin === undefined || (hp !== null && hp >= query.hpMin)) &&
    (query.hpMax === undefined || (hp !== null && hp <= query.hpMax)) &&
    (query.legal === undefined || (query.legal === "standard" ? row[15] : row[16]) === 1)
  );
}

/** Every row GET /cards would answer `query` with, in its order. `page`, `pageSize` and `total`
    are ignored: the caller pages the result. */
export function searchCardIndex(index: CardIndex, query: CardsQuery): CardIndexRow[] {
  const found: CardIndexRow[] = [];
  for (const position of index.orders[query.sort]) {
    const card = index.cards[position] as SearchableCard;
    if (matches(card, query, index.series)) found.push(card.row);
  }
  return found;
}

/** A row as GET /cards serves it, plus the stored Energy fields its Energy subtype is judged from:
    `energyType` here is the stored value and `effect` an Energy's rules text, so a caller that
    classifies Special Energy the way the API's brief does gets the same answer. */
export type CardIndexBrief = Omit<CardBrief, "energyType"> & {
  energyType: string | null;
  effect: string | null;
};

export function cardIndexBrief(row: CardIndexRow): CardIndexBrief {
  return {
    id: row[0],
    name: row[1],
    category: row[2],
    rarity: served(row[3]),
    image: row[4] === 1 ? `/assets/cards/${row[0]}` : null,
    setId: row[5],
    localId: row[6],
    types: row[7] === null ? null : (JSON.parse(row[7]) as string[]),
    hp: row[8],
    regulationMark: served(row[9]),
    stage: served(row[10]),
    trainerType: served(row[11]),
    energyType: served(row[12]),
    legal: { standard: row[15] === 1, expanded: row[16] === 1 },
    effect: row[2] === "Energy" ? row[19] : null,
  };
}
