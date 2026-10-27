import { tcgdexCardSchema, tcgdexSerieSchema, tcgdexSetSchema } from "@colorless/schema";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import cardEnergyBasic from "@colorless/schema/tcgdex-fixtures/card-energy-basic-sve-002.json";
import cardEnergySpecial from "@colorless/schema/tcgdex-fixtures/card-energy-special-sv02-191.json";
import cardPokemonAbility from "@colorless/schema/tcgdex-fixtures/card-pokemon-ability-sv01-081.json";
import cardPokemonHeldItem from "@colorless/schema/tcgdex-fixtures/card-pokemon-helditem-dp5-4.json";
import cardPokemonPromo from "@colorless/schema/tcgdex-fixtures/card-pokemon-promo-svp-001.json";
import cardPokemonAttacks from "@colorless/schema/tcgdex-fixtures/card-pokemon-swsh3-136.json";
import cardTrainerFossil from "@colorless/schema/tcgdex-fixtures/card-trainer-fossil-sv07-129.json";
import cardTrainer from "@colorless/schema/tcgdex-fixtures/card-trainer-sv01-181.json";
import cardTrainerTm from "@colorless/schema/tcgdex-fixtures/card-trainer-tm-sv08-188.json";
import serieFull from "@colorless/schema/tcgdex-fixtures/serie-full-sv.json";
import setFull from "@colorless/schema/tcgdex-fixtures/set-full-sv01.json";
import { cards, series, sets } from "../db/schema";
import { type CardRow, mapCard, mapSerie, mapSet } from "./map";
import type { SqlColumnSpec } from "./sql";
import {
  CARDS_COLUMNS,
  cardsUpsertSql,
  cardsUpsertStatements,
  reprintLegalitySql,
  SERIES_COLUMNS,
  seriesUpsertSql,
  SETS_COLUMNS,
  setsUpsertSql,
} from "./upserts";

type Decoded = string | number | null;

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
  printKey: null,
  legalStandardEffective: null,
  legalExpandedEffective: null,
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
      cardTrainerFossil,
      cardTrainerTm,
      cardEnergyBasic,
      cardEnergySpecial,
    ];
    const rows = [...fixtures.map((raw) => mapCard(tcgdexCardSchema.parse(raw))), hostileCard];
    const sql = cardsUpsertSql(rows);
    const tuples = parseValuesTuples(sql);
    expect(tuples).toEqual(rows.map((row) => expectedTuple(CARDS_COLUMNS, row)));
    const column = (name: string) => CARDS_COLUMNS.findIndex((c) => c.name === name);
    const fossilTuple = tuples[fixtures.indexOf(cardTrainerFossil)];
    expect(fossilTuple?.[column("hp")]).toBe(60);
    expect(JSON.parse(String(fossilTuple?.[column("abilities_json")]))).toEqual([
      expect.objectContaining({ name: "Protective Cover" }),
    ]);
    const tmTuple = tuples[fixtures.indexOf(cardTrainerTm)];
    expect(JSON.parse(String(tmTuple?.[column("attacks_json")]))).toEqual([
      expect.objectContaining({ name: "Fluorite", cost: ["Grass", "Water", "Psychic"] }),
    ]);
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

describe("reprintLegalitySql", () => {
  it("OR's each legality flag across every print sharing the key, whole-table", () => {
    const sql = reprintLegalitySql();
    expect(sql).toContain("UPDATE cards SET");
    expect(sql).toContain(
      "legal_standard_effective = EXISTS (SELECT 1 FROM cards AS twin WHERE twin.print_key = cards.print_key AND twin.legal_standard = 1)",
    );
    expect(sql).toContain(
      "legal_expanded_effective = EXISTS (SELECT 1 FROM cards AS twin WHERE twin.print_key = cards.print_key AND twin.legal_expanded = 1)",
    );
    expect(sql).toContain("WHERE print_key IS NOT NULL");
  });

  it("scopes the rows it rewrites to one set, still finding twins anywhere", () => {
    const sql = reprintLegalitySql("sv'01");
    expect(sql).toContain("WHERE print_key IS NOT NULL\n  AND set_id = 'sv''01'");
    expect(sql).toContain("FROM cards AS twin WHERE twin.print_key = cards.print_key AND");
    expect(sql).not.toContain("twin.set_id");
  });
});

describe("cardsUpsertStatements", () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ ...hostileCard, id: `test-${i}` }));

  it("keeps a statement per CARDS_PER_CHUNK rows while they fit", () => {
    expect(cardsUpsertStatements(rows)).toEqual([cardsUpsertSql(rows)]);
  });

  it("halves a statement until each fits the byte budget, keeping every row once", () => {
    const budget = new TextEncoder().encode(cardsUpsertSql(rows.slice(0, 3))).length;
    const statements = cardsUpsertStatements(rows, budget);
    expect(statements.length).toBeGreaterThan(1);
    for (const sql of statements) {
      expect(new TextEncoder().encode(sql).length).toBeLessThanOrEqual(budget);
    }
    const ids = statements.flatMap((sql) => [...sql.matchAll(/\('(test-\d)'/g)].map((m) => m[1]));
    expect(ids).toEqual(rows.map((row) => row.id));
  });

  it("refuses a single row larger than the budget", () => {
    expect(() => cardsUpsertStatements(rows, 100)).toThrow("test-0");
  });
});
