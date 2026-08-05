// The rotation pin (D191). Deck-builder legality has exactly ONE mechanism: the
// catalog's structured `card.legal` verdict — ingested from tcgdex into the
// legal_standard / legal_expanded columns, required on BuilderCard, read by
// isLegalInFormat, and sent as GET /cards' `legal` param by the rail's
// legal-only switch. A rotation therefore reaches the app as DATA, with no
// allow-list in src/ to bump.
//
// The one place a regulation MARK still becomes a verdict is the hand-built
// fixture factory (`legalFromMark` / STANDARD_LEGAL_MARKS, ./fixtures.ts),
// which has no catalog to ask. This suite is what stops that list drifting away
// from the catalog it imitates: it carries a census MEASURED against the live
// D1 and asserts, mark by mark, exactly how far the derivation sits from what
// the catalog actually says. Bump the mark list without re-measuring and the
// counts here stop reconciling.

import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT, isLegalInFormat } from "../features/builder/cards";
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

/** Measured 2026-08-04 against the live catalog D1 (`luminous`, 735f0fb5-…):
    `SELECT COALESCE(regulation_mark,'(none)'), COUNT(*), SUM(legal_standard),
     SUM(legal_expanded) FROM cards GROUP BY 1` — 3,786 rows over 20 sets. */
const CENSUS: MarkCensus[] = [
  // 36 unmarked Basic Energy ARE Standard-legal; the other 30 unmarked rows
  // (29 pre-mark Pokémon + one Rare Candy) are not. The derivation's
  // "unmarked ⇒ legal" is right for the first group only — which is the group
  // hand-built fixtures overwhelmingly are.
  { mark: null, rows: 66, standardLegal: 36, expandedLegal: 66, disagreements: 30 },
  // The literal STRING "None", not SQL NULL: mfb-33 Potion and mfb-34 Switch.
  // An ingest quirk (it also reaches the rail as a "None" regulation-mark
  // chip — see the report on this slice); harmless to the derivation, which
  // reads it as a mark outside the allow-list and agrees with the catalog.
  { mark: "None", rows: 2, standardLegal: 0, expandedLegal: 2, disagreements: 0 },
  { mark: "D", rows: 2, standardLegal: 0, expandedLegal: 2, disagreements: 0 },
  { mark: "F", rows: 85, standardLegal: 0, expandedLegal: 85, disagreements: 0 },
  // sv04-266 Reversal Energy: mark G (rotated out in April 2026) yet
  // legal_standard = 1 — the catalog's ONE mark/legality exception. Fixtures
  // model it by passing `legal` outright, never by widening the mark list.
  { mark: "G", rows: 1647, standardLegal: 1, expandedLegal: 1647, disagreements: 1 },
  { mark: "H", rows: 1248, standardLegal: 1248, expandedLegal: 1248, disagreements: 0 },
  { mark: "I", rows: 736, standardLegal: 736, expandedLegal: 736, disagreements: 0 },
  // ASPIRATIONAL: zero J-marked cards exist. The entry in STANDARD_LEGAL_MARKS
  // anticipates the next rotation rather than recording one — a distinction
  // this row exists to keep visible.
  { mark: "J", rows: 0, standardLegal: 0, expandedLegal: 0, disagreements: 0 },
];

const sum = (pick: (row: MarkCensus) => number) => CENSUS.reduce((n, row) => n + pick(row), 0);

/** What the fixture derivation would say about every row carrying this mark. */
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
      // If the mark derives legal, every row under it should be legal; if not,
      // none should be. The gap either way is the pinned disagreement count.
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
    // The red light on a one-site rotation edit: add a mark to
    // STANDARD_LEGAL_MARKS and it needs a census row (with real counts) here.
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
    // The catalog's lone exception, as a fixture: mark G, Standard-legal. The
    // deliberate behaviour is that the app believes the catalog — the mark is
    // display data, and the fixture factory's derivation is a default, not an
    // oracle, so this card is spelled out rather than widening any list.
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
