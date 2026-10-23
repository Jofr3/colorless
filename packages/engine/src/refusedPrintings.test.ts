import { describe, expect, it } from "vitest";
import { programFor } from "./registry";
import {
  excerptNamesId,
  REFUSED_PRINTINGS,
  RESOLVED_REFUSALS,
  type RefusedPrinting,
} from "./refusedPrintings";

// ── 1. The finding, DRIVEN rather than asserted in prose ─────────────────────

const RETIRED_BRIAR_EXCERPT =
  '      remaining" (Briar sv07-132/-163/-171, sv08.5-100 — unbuilt, see registry.ts)';

describe("D480 — the three printings the work order priced as unbuilt", () => {
  it("all three SHIP, and the price of D479's row was ZERO registry rows", () => {
    expect(programFor("sv06-165")).toEqual({
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn" },
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 2 } }],
    });
    expect(programFor("sv10-170")).toEqual({
      trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Team Rocket" },
      trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
    });
    // The alternate art is the SAME program object, as a reprint must be.
    expect(programFor("sv10-223")).toEqual(programFor("sv10-170"));
  });

  it("the two cards are kept APART by the one number that separates them", () => {
    const stamp = programFor("sv06-165");
    const archer = programFor("sv10-170");
    expect(stamp).not.toEqual(archer);
    expect(stamp?.trainerPlayableIf).toEqual({ kind: "yourPokemonKoedOnOpponentsLastTurn" });
    expect(archer?.trainerPlayableIf).toEqual({
      kind: "yourPokemonKoedOnOpponentsLastTurn",
      owner: "Team Rocket",
    });
  });

  it("the fixture demonstrators ship too — three of them, not two", () => {
    for (const id of ["fix-unfairstamp", "fix-stamp", "fix-archer"]) {
      expect(programFor(id), id).toBeDefined();
    }
  });
});

describe("REFUSED_PRINTINGS — the build-state claim, as a command", () => {
  it("no declared-refused printing has a registry program", () => {
    // (1) in the header. The day one of these is built, THIS is the line that
    // reddens, and it names the id — which is the whole difference between this
    // and the three prose rules that preceded it.
    const built = REFUSED_PRINTINGS.filter((r) => programFor(r.id) !== undefined);
    expect(
      built.map((r) => `${r.id} (${r.card}, ${r.surface}) — refused by ${r.since}`),
      "these printings are BUILT and their refusals are stale: correct the cited doc block, then delete the row",
    ).toEqual([]);
  });

  it("every row names a surface `programFor` is an oracle for — never an attack", () => {
    const surfaces: readonly RefusedPrinting["surface"][] = [
      "trainer",
      "tool",
      "ability",
      "passive",
      "specialEnergy",
    ];
    for (const row of REFUSED_PRINTINGS) {
      expect(surfaces, `${row.id} names a surface programFor cannot answer for`).toContain(
        row.surface,
      );
    }
  });
});

// ── 3. THE GUARD, reverse — the falsified refusals stay falsified ────────────

describe("RESOLVED_REFUSALS — the correction, as a command", () => {
  it("every printing D480 found already built is STILL built", () => {
    const missing = RESOLVED_REFUSALS.filter((r) => programFor(r.id) === undefined);
    expect(
      missing.map((r) => `${r.id} (${r.card}) — built by ${r.builtBy}`),
      "a printing D480 recorded as built has lost its registry program",
    ).toEqual([]);
  });

  it("names both the decision that BUILT it and the decision that REFUSED it", () => {
    for (const row of RESOLVED_REFUSALS) {
      expect(row.builtBy, row.id).toMatch(/^D\d+$/);
      expect(row.refusedBy, row.id).toContain("D");
      expect(row.refusedBy, row.id).not.toBe(row.builtBy);
    }
  });
});

// ── 4. The citations are REAL — the anti-fiction rung ────────────────────────

describe("the citations", () => {
  it("every REFUSED row's excerpt actually names its id — whole or as a suffix", () => {
    for (const row of REFUSED_PRINTINGS) {
      expect(
        excerptNamesId(row.cite.excerpt, row.id),
        `${row.id} is not named by the excerpt it cites in ${row.cite.file}`,
      ).toBe(true);
    }
  });

  it("…and the predicate REFUSES an id the excerpt does not name", () => {
    // (6) in the header — the negative control, without which the case above passes
    // on `return true`. `sv99-999` shares neither set nor number with anything cited.
    for (const row of REFUSED_PRINTINGS) {
      expect(excerptNamesId(row.cite.excerpt, "sv99-999"), row.id).toBe(false);
    }
    const suffixOnly = REFUSED_PRINTINGS.filter((r) => !r.cite.excerpt.includes(r.id));
    expect(suffixOnly.map((r) => r.id)).toEqual([]);
    for (const row of suffixOnly)
      expect(excerptNamesId(row.cite.excerpt, row.id), row.id).toBe(true);
    for (const id of ["sv07-163", "sv07-171"])
      expect(excerptNamesId(RETIRED_BRIAR_EXCERPT, id), id).toBe(true);
  });

  it("the split reading does not admit a NEIGHBOURING printing of the same set", () => {
    expect(REFUSED_PRINTINGS.find((r) => r.id === "sv07-163")).toBeUndefined();
    expect(excerptNamesId(RETIRED_BRIAR_EXCERPT, "sv07-199")).toBe(false);
    // …while the three that ARE printed there all match, so the refusal is not
    // accidentally narrow either. Both directions, this repo's standing rule.
    for (const id of ["sv07-132", "sv07-163", "sv07-171"]) {
      expect(excerptNamesId(RETIRED_BRIAR_EXCERPT, id), id).toBe(true);
    }
  });
});

// ── 5. Non-vacuity and the attribution controls ──────────────────────────────

describe("the guard cannot pass by being empty or by being unwired", () => {
  it("both tables are non-empty and their ids are unique", () => {
    // (4) in the header. §2 is trivially green on an empty table and §3 is trivially
    // green on an empty one; the two guard each other only if neither can be emptied
    // without a red line.
    expect(REFUSED_PRINTINGS.length).toBeGreaterThanOrEqual(1);
    expect(RESOLVED_REFUSALS.length).toBe(3);
    const refusedIds = REFUSED_PRINTINGS.map((r) => r.id);
    const resolvedIds = RESOLVED_REFUSALS.map((r) => r.id);
    expect(new Set(refusedIds).size).toBe(refusedIds.length);
    expect(new Set(resolvedIds).size).toBe(resolvedIds.length);
    expect(refusedIds.filter((id) => resolvedIds.includes(id))).toEqual([]);
  });

  it("the oracle is wired — it returns BOTH answers over this file's own ids", () => {
    expect(programFor("sv01-125")).toBeDefined();
    expect(programFor("sv01-127")).toBeUndefined();
    expect(REFUSED_PRINTINGS.some((r) => r.id === "sv01-127")).toBe(true);
    expect(REFUSED_PRINTINGS.some((r) => r.id === "sv01-125")).toBe(false);
  });

  it("every row carries a reason and a decision, so the list is a record and not an allowlist", () => {
    for (const row of REFUSED_PRINTINGS) {
      expect(row.why.length, row.id).toBeGreaterThan(80);
      expect(row.since, row.id).toMatch(/^D\d+$/);
      expect(row.card.length, row.id).toBeGreaterThan(0);
    }
  });
});
