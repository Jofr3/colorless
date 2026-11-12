// The database's consistency rules that the foreign keys cannot express, as read-only queries.
// `scripts/db-check.ts` runs them against local or remote D1; consistency.d1.test.ts proves each one
// finds the row it is about.

import type { TcgdexCard } from "@colorless/schema";
import { UNPLAYABLE_EVOLUTIONS } from "../ingest/evolutionSupplement";
import { type CardRow, mapCard, TYPELESS_ENERGY_GAPS } from "../ingest/map";
import { ruleBoxMismatches } from "../ingest/ruleBoxes";
import { escapeSqlText } from "../ingest/sql";
import { CARDS_COLUMNS } from "../ingest/upserts";

type Row = Record<string, unknown>;

const idList = (ids: Readonly<Record<string, string>>) =>
  Object.keys(ids).map(escapeSqlText).join(", ");
const UNPLAYABLE_IDS = idList(UNPLAYABLE_EVOLUTIONS);

/** Each query returns the offending rows; an empty result passes. */
export const CONSISTENCY_CHECKS: readonly { name: string; sql: string }[] = [
  {
    name: "integrity (PRAGMA quick_check)",
    sql: "SELECT quick_check AS problem FROM pragma_quick_check WHERE quick_check <> 'ok'",
  },
  { name: "foreign keys (PRAGMA foreign_key_check)", sql: "PRAGMA foreign_key_check" },
  {
    name: "favourite deck owned by another user",
    sql: `SELECT u.id AS user_id, d.id AS deck_id FROM users u JOIN decks d ON d.id = u.favourite_deck_id
          WHERE d.user_id <> u.id`,
  },
  {
    name: "deck in another user's folder",
    sql: `SELECT d.id AS deck_id, f.id AS folder_id FROM decks d JOIN folders f ON f.id = d.folder_id
          WHERE f.user_id <> d.user_id`,
  },
  {
    name: "folder under another user's folder",
    sql: `SELECT f.id AS folder_id, p.id AS parent_id FROM folders f JOIN folders p ON p.id = f.parent_id
          WHERE p.user_id <> f.user_id`,
  },
  { name: "email not lowercase", sql: "SELECT id FROM users WHERE email <> lower(email)" },
  {
    name: "deck_cards.count outside 1-99",
    sql: "SELECT deck_id, card_id, count FROM deck_cards WHERE count NOT BETWEEN 1 AND 99",
  },
  {
    name: "decks.tint outside 0-360",
    sql: "SELECT id, tint FROM decks WHERE tint NOT BETWEEN 0 AND 360",
  },
  {
    name: "boolean column not 0/1",
    sql: `SELECT 'users' AS t, id FROM users WHERE email_verified NOT IN (0, 1) OR name_prompt NOT IN (0, 1)
          UNION ALL SELECT 'sets', id FROM sets WHERE legal_standard NOT IN (0, 1) OR legal_expanded NOT IN (0, 1)
          UNION ALL SELECT 'cards', id FROM cards WHERE legal_standard NOT IN (0, 1) OR legal_expanded NOT IN (0, 1)
            OR legal_standard_effective NOT IN (0, 1) OR legal_expanded_effective NOT IN (0, 1)`,
  },
  {
    name: "cards.category outside Pokemon/Trainer/Energy",
    sql: "SELECT id, category FROM cards WHERE category NOT IN ('Pokemon', 'Trainer', 'Energy')",
  },
  {
    name: "two cards with one set number",
    sql: "SELECT set_id, local_id, count(*) AS n FROM cards GROUP BY set_id, local_id HAVING n > 1",
  },
  {
    name: "card the reprint post-pass has not reached",
    sql: `SELECT id FROM cards WHERE print_key IS NULL OR legal_standard_effective IS NULL
            OR legal_expanded_effective IS NULL`,
  },
  {
    name: "effective legality differs from its print_key group",
    sql: `SELECT c.id, c.legal_standard_effective AS standard, g.standard AS group_standard,
            c.legal_expanded_effective AS expanded, g.expanded AS group_expanded
          FROM cards c JOIN (SELECT print_key, max(legal_standard) AS standard,
            max(legal_expanded) AS expanded FROM cards WHERE print_key IS NOT NULL GROUP BY print_key) g
            ON g.print_key = c.print_key
          WHERE c.legal_standard_effective IS NOT g.standard OR c.legal_expanded_effective IS NOT g.expanded`,
  },
  {
    name: "non-Basic Pokémon with no evolve_from",
    sql: `SELECT id, stage FROM cards WHERE category = 'Pokemon' AND stage IS NOT 'Basic'
            AND evolve_from IS NULL AND id NOT IN (${UNPLAYABLE_IDS})`,
  },
  {
    name: "Basic Pokémon with an evolve_from",
    sql: `SELECT id, evolve_from FROM cards WHERE category = 'Pokemon' AND stage = 'Basic'
            AND evolve_from IS NOT NULL`,
  },
  {
    name: "evolve_from names no card",
    sql: `SELECT id, evolve_from FROM cards WHERE category = 'Pokemon' AND evolve_from IS NOT NULL
            AND evolve_from NOT IN (SELECT name FROM cards) AND id NOT IN (${UNPLAYABLE_IDS})`,
  },
  {
    name: "Energy with no energy_type",
    sql: `SELECT id, name FROM cards WHERE category = 'Energy' AND energy_type IS NULL
            AND id NOT IN (${idList(TYPELESS_ENERGY_GAPS)})`,
  },
];

export const COUNTED_TABLES = [
  "series",
  "sets",
  "cards",
  "users",
  "sessions",
  "oauth_identities",
  "folders",
  "decks",
  "deck_cards",
];

export const CARD_KEY_COLUMNS = `id, set_id, name, category, hp, stage, suffix, evolve_from, types_json, retreat,
  abilities_json, attacks_json, weaknesses_json, resistances_json, trainer_type, energy_type, effect, print_key`;

function json<T>(value: unknown): T | undefined {
  return typeof value === "string" ? (JSON.parse(value) as T) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function int(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** The stored row read back as the tcgdex payload of the columns `printKey` reads, a NULL column
    as the field left out, so `mapCard` keys it with every transform and supplement it has today. */
function storedPayload(row: Row): TcgdexCard {
  return {
    id: row.id,
    localId: "",
    set: { id: row.set_id, name: "", cardCount: { total: 0, official: 0 } },
    category: row.category,
    name: row.name,
    hp: int(row.hp),
    stage: text(row.stage),
    suffix: text(row.suffix),
    evolveFrom: text(row.evolve_from),
    types: json(row.types_json),
    retreat: int(row.retreat),
    abilities: json(row.abilities_json),
    attacks: json(row.attacks_json),
    weaknesses: json(row.weaknesses_json),
    resistances: json(row.resistances_json),
    trainerType: text(row.trainer_type),
    energyType: text(row.energy_type),
    effect: text(row.effect),
  } as TcgdexCard;
}

/** The cards (rows of CARD_KEY_COLUMNS) whose stored `print_key` is not what today's code computes. */
export function printKeyMismatches(cards: readonly Row[]): Row[] {
  return cards
    .filter(
      (card) => card.print_key !== null && mapCard(storedPayload(card)).printKey !== card.print_key,
    )
    .map((card) => ({ id: card.id }));
}

/** A stored card (every column of `cards`) as the row the ingest wrote. */
export function storedCardRow(row: Row): CardRow {
  return Object.fromEntries(
    CARDS_COLUMNS.map(({ name, key, kind }) => {
      const value = row[name] ?? null;
      if (value === null) return [key, null];
      if (kind === "json") return [key, JSON.parse(String(value))];
      if (kind === "boolean") return [key, value === 1 || value === true];
      return [key, value];
    }),
  ) as CardRow;
}

/** The stored legal Pokémon whose engine Prize value or suffix disagrees with its printed family
    (ruleBoxMismatches), from rows of every `cards` column. */
export function storedRuleBoxMismatches(cards: readonly Row[]): Row[] {
  return ruleBoxMismatches(cards.map(storedCardRow)).map((problem) => ({ problem }));
}
