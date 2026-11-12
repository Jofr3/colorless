import { readdirSync, readFileSync } from "node:fs";
import { tcgdexCardSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { type CardRow, mapCard, printKey } from "../ingest/map";
import { CARDS_COLUMNS } from "../ingest/upserts";
import { printKeyMismatches, storedCardRow, storedRuleBoxMismatches } from "./consistency";

const FIXTURES = new URL("../../../../packages/schema/src/tcgdex/__fixtures__/", import.meta.url);

const fixtureRows: CardRow[] = readdirSync(FIXTURES)
  .filter((file) => file.startsWith("card-"))
  .map((file) =>
    mapCard(tcgdexCardSchema.parse(JSON.parse(readFileSync(new URL(file, FIXTURES), "utf8")))),
  );

/** A mapped row as D1 hands it back: snake_case columns, JSON as text, booleans as 0 / 1. */
function stored(row: CardRow): Record<string, unknown> {
  return Object.fromEntries(
    CARDS_COLUMNS.map(({ name, key, kind }) => {
      const value = row[key];
      if (value === null) return [name, null];
      if (kind === "json") return [name, JSON.stringify(value)];
      if (kind === "boolean") return [name, value ? 1 : 0];
      return [name, value];
    }),
  );
}

/** A row an older mapper wrote: `old` in place of what today's mapper gives, keyed as it was then. */
function storedBefore(row: CardRow, old: Partial<CardRow>): Record<string, unknown> {
  const then = { ...row, ...old };
  return stored({ ...then, printKey: printKey(then) });
}

function fixture(id: string): CardRow {
  const row = fixtureRows.find((card) => card.id === id);
  if (row === undefined) throw new Error(`no fixture card ${id}`);
  return row;
}

describe("printKeyMismatches", () => {
  it("reads every committed tcgdex card back, as stored, with the key the ingest gave it", () => {
    expect(fixtureRows.length).toBeGreaterThanOrEqual(9);
    expect(printKeyMismatches(fixtureRows.map(stored))).toEqual([]);
  });

  it("flags a row keyed before tidyWhitespace, though printKey folds whitespace (COR-P4)", () => {
    const nestBall = fixture("sv01-181");
    const effect = `${nestBall.effect}\t, then shuffle.`;
    const row = { ...nestBall, effect: `${nestBall.effect}, then shuffle.` };
    expect(printKeyMismatches([storedBefore(row, { effect })])).toEqual([{ id: "sv01-181" }]);
  });

  it("flags a row keyed before energyTypeOf stored a Special Energy tagged Normal as Special", () => {
    const prism = fixture("sv10.5b-086");
    expect(prism.energyType).toBe("Special");
    expect(printKeyMismatches([storedBefore(prism, { energyType: "Normal" })])).toEqual([
      { id: "sv10.5b-086" },
    ]);
  });

  it("flags a row keyed before its evolution supplement entry", () => {
    const row = { ...fixture("sv01-081"), id: "30th-007", stage: "Stage1", evolveFrom: "Cherubi" };
    expect(printKeyMismatches([storedBefore(row, { stage: "Basic", evolveFrom: null })])).toEqual([
      { id: "30th-007" },
    ]);
    expect(printKeyMismatches([stored({ ...row, printKey: printKey(row) })])).toEqual([]);
  });

  it("skips a row with no stored key", () => {
    expect(printKeyMismatches([stored({ ...fixture("sv01-181"), printKey: null })])).toEqual([]);
  });
});

describe("storedCardRow", () => {
  it("reads every committed tcgdex card back, as stored, as the row the ingest mapped", () => {
    for (const row of fixtureRows) expect(storedCardRow(stored(row)), row.id).toEqual(row);
  });
});

describe("storedRuleBoxMismatches (COR-P4)", () => {
  it("finds nothing in the committed cards, and names a stored Pokémon its family disagrees with", () => {
    expect(storedRuleBoxMismatches(fixtureRows.map(stored))).toEqual([]);
    const raichu = { ...fixture("sv01-081"), id: "sv03-064", name: "Raichu", suffix: "ex" };
    expect(storedRuleBoxMismatches([stored(raichu)])).toEqual([
      { problem: "sv03-064: Raichu (plain) carries catalog suffix ex" },
    ]);
  });
});
