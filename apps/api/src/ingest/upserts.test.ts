// Round-trip test for the generated upsert SQL: build real rows (every card
// fixture + a deliberately hostile synthetic card), emit the SQL text, then
// re-parse its VALUES tuples with a quote-aware scanner that inverts the
// escaping rules — the decoded values must equal what went in. This is the
// closest we get to executing the files without a SQLite engine in the tests;
// the real execution path is covered by the ingest run against local D1.

import { tcgdexCardSchema, tcgdexSerieSchema, tcgdexSetSchema } from "@luminous/schema";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import cardEnergyBasic from "../../../../packages/schema/src/tcgdex/__fixtures__/card-energy-basic-sve-002.json";
import cardEnergySpecial from "../../../../packages/schema/src/tcgdex/__fixtures__/card-energy-special-sv02-191.json";
import cardPokemonAbility from "../../../../packages/schema/src/tcgdex/__fixtures__/card-pokemon-ability-sv01-081.json";
import cardPokemonHeldItem from "../../../../packages/schema/src/tcgdex/__fixtures__/card-pokemon-helditem-dp5-4.json";
import cardPokemonPromo from "../../../../packages/schema/src/tcgdex/__fixtures__/card-pokemon-promo-svp-001.json";
import cardPokemonAttacks from "../../../../packages/schema/src/tcgdex/__fixtures__/card-pokemon-swsh3-136.json";
import cardTrainer from "../../../../packages/schema/src/tcgdex/__fixtures__/card-trainer-sv01-181.json";
import serieFull from "../../../../packages/schema/src/tcgdex/__fixtures__/serie-full-sv.json";
import setFull from "../../../../packages/schema/src/tcgdex/__fixtures__/set-full-sv01.json";
import { cards, series, sets } from "../db/schema";
import { type CardRow, mapCard, mapSerie, mapSet } from "./map";
import type { SqlColumnSpec } from "./sql";
import {
  CARDS_COLUMNS,
  cardsUpsertSql,
  SERIES_COLUMNS,
  seriesUpsertSql,
  SETS_COLUMNS,
  setsUpsertSql,
} from "./upserts";

type Decoded = string | number | null;

/**
 * Parse the VALUES tuples out of a generated upsert, inverting the escaping
 * rules: quoted strings un-double their quotes, NULL → null, bare tokens are
 * numbers. Quote-aware, so parens/commas/newlines inside strings are data.
 */
function parseValuesTuples(sql: string): Decoded[][] {
  const start = sql.indexOf("VALUES\n");
  const end = sql.lastIndexOf("\nON CONFLICT");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = sql.slice(start + "VALUES\n".length, end);
  const rows: Decoded[][] = [];
  let i = 0;
  while (i < block.length) {
    if (block.charAt(i) !== "(") {
      i += 1; // separators between tuples: ",", "\n"
      continue;
    }
    i += 1;
    const values: Decoded[] = [];
    while (i < block.length && block.charAt(i) !== ")") {
      const ch = block.charAt(i);
      if (ch === "," || ch === " " || ch === "\n") {
        i += 1;
        continue;
      }
      if (ch === "'") {
        i += 1;
        let out = "";
        for (;;) {
          const q = block.charAt(i);
          if (q === "") {
            throw new Error("unterminated string literal in generated SQL");
          }
          if (q === "'") {
            if (block.charAt(i + 1) === "'") {
              out += "'";
              i += 2;
              continue;
            }
            i += 1;
            break;
          }
          out += q;
          i += 1;
        }
        values.push(out);
        continue;
      }
      let j = i;
      while (j < block.length && block.charAt(j) !== "," && block.charAt(j) !== ")") {
        j += 1;
      }
      const token = block.slice(i, j).trim();
      values.push(token === "NULL" ? null : Number(token));
      i = j;
    }
    i += 1; // past ")"
    rows.push(values);
  }
  return rows;
}

/** What each row value must decode back to, given its column kind. */
function expectedTuple<Row>(columns: readonly SqlColumnSpec<Row>[], row: Row): Decoded[] {
  return columns.map((column) => {
    const value = row[column.key];
    if (value === null || value === undefined) {
      return null;
    }
    switch (column.kind) {
      case "text":
        return value as string;
      case "number":
        return value as number;
      case "boolean":
        return value ? 1 : 0;
      case "json":
        return JSON.stringify(value);
    }
  });
}

/** A card row stuffed with every escaping hazard at once. */
const hostileCard: CardRow = {
  id: "test-666",
  setId: "test",
  localId: "666",
  name: "Farfetch'd '); DROP TABLE cards; --",
  category: "Pokemon",
  illustrator: "O'Brien\nsecond line",
  rarity: "Pokémon ×2 ⚡ 'rare'",
  regulationMark: null,
  hp: 0,
  stage: null,
  suffix: "ex' ◇",
  evolveFrom: "Mime Jr.',(",
  typesJson: ["Grass", "it's"],
  retreat: 3,
  abilitiesJson: [{ name: "quote ' and \" and newline\n", effect: "), (fake tuple)" }],
  attacksJson: [{ name: "damage as string", damage: "60+" }],
  weaknessesJson: null,
  resistancesJson: [{ type: "Metal", value: "-30" }],
  trainerType: null,
  energyType: null,
  effect: null,
  legalStandard: true,
  legalExpanded: false,
  variantsJson: { normal: true, reverse: false },
  imageUrl: "https://assets.tcgdex.net/en/test/test/666",
  updated: "2026-07-09T00:00:00Z",
};

describe("generated upsert SQL round-trips through the escaping rules", () => {
  it("cards: every fixture category plus a hostile synthetic row", () => {
    const fixtures = [
      cardPokemonAttacks,
      cardPokemonAbility,
      cardPokemonHeldItem,
      cardPokemonPromo,
      cardTrainer,
      cardEnergyBasic,
      cardEnergySpecial,
    ];
    const rows = [...fixtures.map((raw) => mapCard(tcgdexCardSchema.parse(raw))), hostileCard];
    const sql = cardsUpsertSql(rows);
    const tuples = parseValuesTuples(sql);
    expect(tuples).toEqual(rows.map((row) => expectedTuple(CARDS_COLUMNS, row)));
    // The JSON columns must decode back to the exact source objects too.
    const hostileTuple = tuples.at(-1);
    const abilitiesIndex = CARDS_COLUMNS.findIndex((c) => c.name === "abilities_json");
    expect(JSON.parse(String(hostileTuple?.[abilitiesIndex]))).toEqual(hostileCard.abilitiesJson);
  });

  it("series and sets: fixture rows survive the round trip", () => {
    const serieRow = mapSerie(tcgdexSerieSchema.parse(serieFull));
    const serieSql = seriesUpsertSql([serieRow]);
    expect(parseValuesTuples(serieSql)).toEqual([expectedTuple(SERIES_COLUMNS, serieRow)]);

    const setRow = mapSet(tcgdexSetSchema.parse(setFull));
    const setSql = setsUpsertSql([setRow]);
    expect(parseValuesTuples(setSql)).toEqual([expectedTuple(SETS_COLUMNS, setRow)]);
  });

  // D203 — the one link in this file that was asserted in a comment and checked
  // by nothing: the hand-written specs vs the Drizzle table they claim to
  // mirror. A column added to ../db/catalog.ts and forgotten in the spec is
  // otherwise SILENT — the generated INSERT omits it, and the next ingest
  // leaves it NULL for good (`cards.suffix` is the live example of a column
  // that arrived late). Derived from `getTableColumns`, so it cannot be kept
  // green by editing it alongside the spec.
  it("every spec covers its whole table, in table order", () => {
    const specNames = (columns: readonly SqlColumnSpec<never>[]) => columns.map((c) => c.name);
    const tableNames = (table: SQLiteTable) =>
      Object.values(getTableColumns(table)).map((column) => column.name);
    expect(specNames(SERIES_COLUMNS as readonly SqlColumnSpec<never>[])).toEqual(
      tableNames(series),
    );
    expect(specNames(SETS_COLUMNS as readonly SqlColumnSpec<never>[])).toEqual(tableNames(sets));
    expect(specNames(CARDS_COLUMNS as readonly SqlColumnSpec<never>[])).toEqual(tableNames(cards));
    // The spec's `kind` drives the SQL literal, so a wrong one corrupts the
    // value rather than dropping it: pin the JSON columns, the only kind whose
    // mismatch would round-trip through `parseValuesTuples` looking plausible.
    expect(CARDS_COLUMNS.filter((c) => c.kind === "json").map((c) => c.name)).toEqual([
      "types_json",
      "abilities_json",
      "attacks_json",
      "weaknesses_json",
      "resistances_json",
      "variants_json",
    ]);
  });

  it("targets the right tables and conflict action", () => {
    const serieRow = mapSerie(tcgdexSerieSchema.parse(serieFull));
    expect(seriesUpsertSql([serieRow]).startsWith('INSERT INTO "series" ')).toBe(true);
    const setRow = mapSet(tcgdexSetSchema.parse(setFull));
    expect(setsUpsertSql([setRow])).toContain('ON CONFLICT("id") DO UPDATE SET');
    expect(cardsUpsertSql([hostileCard]).startsWith('INSERT INTO "cards" ')).toBe(true);
  });
});
