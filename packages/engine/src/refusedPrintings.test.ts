import { describe, expect, it } from "vitest";
import { programFor } from "./registry";
import { REFUSED_PRINTINGS, RESOLVED_REFUSALS, type RefusedPrinting } from "./refusedPrintings";

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
    const built = REFUSED_PRINTINGS.filter((r) => programFor(r.id) !== undefined);
    expect(
      built.map((r) => `${r.id} (${r.card}, ${r.surface}) — refused by ${r.since}`),
      "these printings are BUILT and their refusals are stale: delete the row",
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

describe("the guard cannot pass by being empty or by being unwired", () => {
  it("both tables are non-empty and their ids are unique", () => {
    // Both guards are trivially green on an empty table, so neither may be empty.
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
