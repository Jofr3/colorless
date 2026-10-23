import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT, isLegalInFormat } from "../decks/cards";
import { builderCard, legalFromMark, STANDARD_LEGAL_MARKS } from "./fixtures";

interface MarkCensus {
  /** The `regulation_mark` column value; `null` is SQL NULL — no printed mark. */
  mark: string | null;
  rows: number;
  standardLegal: number;
  expandedLegal: number;
  /** Rows where `legalFromMark`'s Standard verdict differs from the catalog's.
      Pinned per mark rather than summed so a future rotation has to state
      WHICH rows it newly disagrees about. */
  disagreements: number;
}

const CENSUS: MarkCensus[] = [
  { mark: null, rows: 66, standardLegal: 36, expandedLegal: 66, disagreements: 30 },
  { mark: "None", rows: 2, standardLegal: 0, expandedLegal: 2, disagreements: 0 },
  { mark: "D", rows: 2, standardLegal: 0, expandedLegal: 2, disagreements: 0 },
  { mark: "F", rows: 85, standardLegal: 0, expandedLegal: 85, disagreements: 0 },
  // sv04-266 Reversal Energy: mark G (rotated out in April 2026) yet
  // legal_standard = 1 — the catalog's ONE mark/legality exception. Fixtures
  // model it by passing `legal` outright, never by widening the mark list.
  { mark: "G", rows: 1647, standardLegal: 1, expandedLegal: 1647, disagreements: 1 },
  { mark: "H", rows: 1248, standardLegal: 1248, expandedLegal: 1248, disagreements: 0 },
  { mark: "I", rows: 736, standardLegal: 736, expandedLegal: 736, disagreements: 0 },
  { mark: "J", rows: 0, standardLegal: 0, expandedLegal: 0, disagreements: 0 },
];

const sum = (pick: (row: MarkCensus) => number) => CENSUS.reduce((n, row) => n + pick(row), 0);

const derivedStandard = (mark: string | null) => legalFromMark(mark ?? undefined).standard;

describe("regulation marks vs the catalog's Standard verdict (measured census)", () => {
  it("accounts for every row in the catalog", () => {
    expect(sum((row) => row.rows)).toBe(3786);
    expect(sum((row) => row.standardLegal)).toBe(2021);
  });

  it("finds EVERY card Expanded-legal — which is why the derivation hardcodes it", () => {
    for (const row of CENSUS) expect(row.expandedLegal).toBe(row.rows);
    expect(sum((row) => row.expandedLegal)).toBe(3786);
    expect(legalFromMark("F").expanded).toBe(true);
    expect(legalFromMark(undefined).expanded).toBe(true);
  });

  it("derives the catalog's Standard verdict for all but the 31 rows pinned above", () => {
    for (const row of CENSUS) {
      const wouldBeLegal = derivedStandard(row.mark) ? row.rows : 0;
      expect({ mark: row.mark, off: Math.abs(row.standardLegal - wouldBeLegal) }).toEqual({
        mark: row.mark,
        off: row.disagreements,
      });
    }
    expect(sum((row) => row.disagreements)).toBe(31);
  });

  it("agrees exactly on the two marks in rotation today (H, I)", () => {
    for (const mark of ["H", "I"]) {
      const row = CENSUS.find((r) => r.mark === mark);
      expect(row).toBeDefined();
      expect(derivedStandard(mark)).toBe(true);
      expect(row?.standardLegal).toBe(row?.rows);
    }
    for (const mark of ["D", "F", "G", "None"]) expect(derivedStandard(mark)).toBe(false);
  });

  it("keeps every allow-listed mark censused — a rotation must re-measure", () => {
    for (const mark of STANDARD_LEGAL_MARKS) {
      expect(CENSUS.map((row) => row.mark)).toContain(mark);
    }
  });

  it("marks J as an aspiration, not a measurement", () => {
    expect(STANDARD_LEGAL_MARKS).toContain("J");
    expect(CENSUS.find((row) => row.mark === "J")?.rows).toBe(0);
    // Every OTHER allow-listed mark is one the catalog has actually printed.
    for (const mark of STANDARD_LEGAL_MARKS.filter((m) => m !== "J")) {
      expect(CENSUS.find((row) => row.mark === mark)?.rows).toBeGreaterThan(0);
    }
  });
});

describe("isLegalInFormat reads the structured verdict and nothing else", () => {
  it("honours a verdict that contradicts the printed mark (sv04-266)", () => {
    const reversalEnergy = builderCard({
      cardId: "sv04-266",
      name: "Reversal Energy",
      supertype: "Energy",
      subtype: "Special Energy",
      regulationMark: "G",
      legal: { standard: true, expanded: true },
    });
    expect(legalFromMark("G").standard).toBe(false);
    expect(isLegalInFormat(reversalEnergy, DEFAULT_FORMAT)).toBe(true);
  });

  it("refuses an in-rotation mark whose verdict says otherwise", () => {
    const promo = builderCard({
      cardId: "svp-001",
      name: "Sprigatito",
      supertype: "Pokémon",
      subtype: "Basic",
      regulationMark: "H",
      legal: { standard: false, expanded: true },
    });
    expect(isLegalInFormat(promo, DEFAULT_FORMAT)).toBe(false);
  });
});
