import { describe, expect, it } from "vitest";
import { effectiveRetreatCost, hasFreeRetreatAura, programFor } from "./index";
import type { GameState } from "./index";
import {
  LUNAR_ZONE_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.58.0 → 0.59.0 — Clefable ex sv03-082 (P3-M5 long tail, D108): "All of your
// Pokémon that have {P} Energy attached have no Retreat Cost."
//
// The first CONDITIONAL continuous aura, and the first modifier on the
// retreat-cost seam. Like `removeWeakness` (D104) it reaches OTHER Pokémon, so it
// is read through a dedicated continuous.ts scan rather than `passivesOf` — but
// its printed clause is evaluated PER TARGET, so the scan takes the Pokémon and
// derives its seat (the aura is own-board), leaving `effectiveRetreatCost`'s
// signature and its three readers (turn.ts retreat, redact.ts, the web HUD)
// untouched. sv03-082 is the only "no Retreat Cost" print in the local pool.

/** Setup on P1's turn, then field the retreat-2 beneficiary in P1's Active spot
    (the starter is displaced onto the bench, which a retreat then promotes). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: LUNAR_ZONE_DECK, p2: LUNAR_ZONE_DECK }, { first: "p1" });
  return setActiveFromDeck(state, "p1", "fix-retreat2");
}

/** P1's Active — the body every assertion below reads. */
function p1Active(state: GameState) {
  const active = state.players.p1.active;
  if (active === null) throw new Error("p1 has no Active");
  return active;
}

/** P1's Active's current cost under every continuous modifier in play. */
function activeCost(state: GameState): number {
  return effectiveRetreatCost(state, p1Active(state));
}

describe("Lunar Zone — the registry data row (noRetreatCostAura)", () => {
  it("authors sv03-082 as a {P}-gated noRetreatCostAura passive", () => {
    expect(programFor("sv03-082")?.passive).toEqual({
      noRetreatCostAura: { requiresEnergyType: "Psychic" },
    });
  });
});

describe("Lunar Zone — the {P}-attached clause is read per target", () => {
  it("with no aura in play the printed cost stands, {P} attached or not", () => {
    const state = attachFromDeck(board(1), "p1", "fix-psychic-energy", 1);
    expect(hasFreeRetreatAura(state, p1Active(state))).toBe(false);
    expect(activeCost(state)).toBe(2);
  });

  it("a benched Clefable ex frees a {P}-carrying teammate — cost 0", () => {
    let state = benchFromDeck(board(2), "p1", "sv03-082");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    expect(hasFreeRetreatAura(state, p1Active(state))).toBe(true);
    expect(activeCost(state)).toBe(0);
  });

  it("the same teammate carrying only {C} is NOT freed — the clause is per target", () => {
    let state = benchFromDeck(board(3), "p1", "sv03-082");
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    expect(hasFreeRetreatAura(state, p1Active(state))).toBe(false);
    expect(activeCost(state)).toBe(2);
  });

  it("a bare teammate with no Energy at all is NOT freed", () => {
    const state = benchFromDeck(board(4), "p1", "sv03-082");
    expect(activeCost(state)).toBe(2);
  });

  it("a wildcard Luminous Energy satisfies {P} — provision, not card identity", () => {
    // sv02-191 provides EVERY type (one at a time), so it IS a {P} Energy here —
    // the same rule that lets it pay a {P} cost (continuous.ts providesEnergyType).
    let state = benchFromDeck(board(5), "p1", "sv03-082");
    state = attachFromDeck(state, "p1", "sv02-191", 1);
    expect(activeCost(state)).toBe(0);
  });

  it("is SELF-inclusive: Clefable ex frees its own retreat 2 only while it holds {P}", () => {
    const bare = setActiveFromDeck(board(6), "p1", "sv03-082");
    expect(activeCost(bare)).toBe(2);

    const fed = attachFromDeck(bare, "p1", "fix-psychic-energy", 1);
    expect(activeCost(fed)).toBe(0);
  });
});

describe("Lunar Zone — own-board scoping and the §9 ability lock", () => {
  it("an OPPONENT's Clefable ex does not free your {P}-carrying Active", () => {
    let state = benchFromDeck(board(7), "p2", "sv03-082");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    expect(hasFreeRetreatAura(state, p1Active(state))).toBe(false);
    expect(activeCost(state)).toBe(2);
  });

  it("an Active Klefki does not lock a Stage 1 source — the aura stands", () => {
    // The gate IS consulted (hasFreeRetreatAura skips a §9-disabled source), but
    // no lock in the sv01–03 pool can actually reach Clefable ex: Klefki
    // "Mischievous Lock" and Spiritomb "Fettered in Misfortune" narrow to BASIC
    // Pokémon (Clefable ex is a Stage 1) and Ting-Lu ex "Cursed Land" exempts ex.
    // So the only assertable case is the negative — recorded here deliberately.
    let state = benchFromDeck(board(8), "p1", "sv03-082");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    state = setActiveFromDeck(state, "p2", "sv01-096");
    expect(activeCost(state)).toBe(0);
  });
});

describe("Lunar Zone — a set-to-zero, read before the Stadium deltas", () => {
  it("beats Beach Court's ± Basic discount and reaches non-Basics it cannot", () => {
    let state = handFromDeck(board(9), "p1", "sv01-167", 1);
    state = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-167"),
    }).state;
    expect(state.stadium).not.toBeNull();

    // Beach Court alone: the Basic beneficiary pays 2 − 1 = 1.
    expect(activeCost(state)).toBe(1);

    // The aura takes it the rest of the way to 0 …
    let freed = benchFromDeck(state, "p1", "sv03-082");
    freed = attachFromDeck(freed, "p1", "fix-psychic-energy", 1);
    expect(activeCost(freed)).toBe(0);

    // … and it is stage-agnostic where Beach Court is Basic-only: a {P}-carrying
    // Clefable ex (Stage 1, retreat 2) gets no discount from the Stadium, but the
    // aura still zeroes it.
    const stage1 = attachFromDeck(
      setActiveFromDeck(state, "p1", "sv03-082"),
      "p1",
      "fix-psychic-energy",
      1,
    );
    expect(activeCost(stage1)).toBe(0);
  });
});

describe("Lunar Zone — the retreat action honors the aura", () => {
  it("a freed Active retreats for nothing, keeping its Energy attached", () => {
    let state = benchFromDeck(board(10), "p1", "sv03-082");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    const retreating = activeUid(state, "p1");
    const energy = state.players.p1.active?.energy;
    const promoted = benchTopUid(state, "p1", 0);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [],
      promoteBenchIndex: 0,
    });

    expect(types(events)).toContain("RETREATED");
    expect(activeUid(done, "p1")).toBe(promoted);
    // The {P} rode along on the retreating Pokémon — nothing was paid.
    const benched = done.players.p1.bench.find((p) => p.stack.at(-1) === retreating);
    expect(benched?.energy).toEqual(energy);
    expect(done.players.p1.discard).toEqual(state.players.p1.discard);
  });

  it("without the aura the same free retreat is rejected (RETREAT_COST_MISMATCH)", () => {
    const state = attachFromDeck(board(11), "p1", "fix-psychic-energy", 1);
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 },
      "RETREAT_COST_MISMATCH",
    );
  });
});
