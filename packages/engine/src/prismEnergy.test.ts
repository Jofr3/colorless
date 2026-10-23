import { describe, expect, it } from "vitest";
import { ANY_ENERGY, applyAction, costMet, programFor, providedEnergy } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  FIXTURE_POOL,
  PRISM_ENERGY_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

function p1Turn2(seed: number): GameState {
  const state = driveSetup(seed, { p1: PRISM_ENERGY_DECK, p2: PRISM_ENERGY_DECK }, { first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return active;
}

/** P1's SECOND turn — `p1Turn2` plus a full round. Needed only by the EVOLVE
    boards: §4/§10 refuse an evolve on a player's FIRST turn, which is what
    `p1Turn2` actually opens. */
function p1LaterTurn(seed: number): GameState {
  let state = p1Turn2(seed);
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** P1's turn 2 with `bodyId` Active and `count` copies of `energyId` on it. */
function holding(seed: number, bodyId: string, energyId: string, count = 1): GameState {
  let state = p1Turn2(seed);
  state = setActiveFromDeck(state, "p1", bodyId);
  return attachFromDeck(state, "p1", energyId, count);
}

/** `holding`, on a turn where §10 lets P1 evolve. */
function holdingLater(seed: number, bodyId: string, energyId: string): GameState {
  let state = p1LaterTurn(seed);
  state = setActiveFromDeck(state, "p1", bodyId);
  return attachFromDeck(state, "p1", energyId, 1);
}

describe("D300 §1 — Prism Energy's row, and the paragraph the handoff did not quote", () => {
  it("authors the FIRST paragraph — the {C} provision four shipped Energies share", () => {
    expect(programFor("sv10.5b-086")?.energy?.provides).toEqual(["Colorless"]);
    for (const id of ["sv02-190", "sv05-161", "sv05-162", "sv08-191"]) {
      expect(programFor(id)?.energy?.provides, id).toEqual(["Colorless"]);
    }
  });

  it("authors the SECOND paragraph as a stage VALUE, not a field name", () => {
    expect(programFor("sv10.5b-086")?.energy?.promoteOnHolderStage).toEqual({
      stage: "Basic",
      units: [ANY_ENERGY],
    });
    // …and the OTHER carrier of the same field disagrees on BOTH values, which is
    // what makes the shape earn itself.
    expect(programFor("sv05-162")?.energy?.promoteOnHolderStage).toEqual({
      stage: "Stage2",
      units: [ANY_ENERGY, ANY_ENERGY],
    });
  });

  it("provides ONE wildcard unit and not two — the multiset half, mirrored", () => {
    expect(programFor("sv10.5b-086")?.energy?.promoteOnHolderStage?.units).toHaveLength(1);
    expect(programFor("sv05-162")?.energy?.promoteOnHolderStage?.units).toHaveLength(2);
    // Observable at the matcher, one layer below any board.
    expect(costMet(["Psychic", "Water"], [ANY_ENERGY])).toBe(false);
    expect(costMet(["Psychic"], [ANY_ENERGY])).toBe(true);
    // And it is NOT the other conditional wearing a new name.
    expect(programFor("sv10.5b-086")?.energy?.demoteWithOtherSpecial).toBeUndefined();
    expect(programFor("sv10.5b-086")?.energy?.passive).toBeUndefined();
    expect(programFor("sv10.5b-086")?.energy?.onAttach).toBeUndefined();
  });

  it("carries the printed sentence on the fixture demonstrator, BOTH paragraphs", () => {
    const printed =
      "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to a Basic Pokémon, this card provides every type of Energy but provides only 1 Energy at a time.";
    expect(FIXTURE_POOL["fix-prism-energy"]?.effect).toBe(printed);
    expect(printed).toHaveLength(194); // the remote D1 `length(effect)`, to the character
    expect(programFor("fix-prism-energy")).toBe(programFor("sv10.5b-086"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE GATE — AND THE STAGE 2 BOARD, WHICH IS THE ONE THAT MATTERS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D300 §2 — provision is gated on the HOLDER's printed stage (§6.3)", () => {
  it("provides ONE wildcard on a BASIC holder", () => {
    const state = holding(1, "fix-prism-basic", "fix-prism-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY]);
  });

  it("provides {C} on a STAGE 1 holder", () => {
    const state = holding(2, "fix-prism-stage1", "fix-prism-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("provides {C} on a STAGE 2 holder — the wrong-predicate executioner", () => {
    const state = holding(3, "fix-neo-stage2", "fix-prism-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("the two carriers SWAP on the same two bodies — the stage is a value", () => {
    // The cleanest statement the pair can make. On a BASIC, Prism is a wildcard
    // and Neo Upper is {C}; on a STAGE 2 the answers trade places. One board each
    // would let a hard-coded predicate through; the cross does not.
    const basic = holding(4, "fix-prism-basic", "fix-prism-energy");
    expect(providedEnergy(basic, activeOf(basic, "p1"))).toEqual([ANY_ENERGY]);
    const basicNeo = holding(5, "fix-prism-basic", "fix-neo-upper-energy");
    expect(providedEnergy(basicNeo, activeOf(basicNeo, "p1"))).toEqual(["Colorless"]);

    const stage2 = holding(6, "fix-neo-stage2", "fix-prism-energy");
    expect(providedEnergy(stage2, activeOf(stage2, "p1"))).toEqual(["Colorless"]);
    const stage2Neo = holding(7, "fix-neo-stage2", "fix-neo-upper-energy");
    expect(providedEnergy(stage2Neo, activeOf(stage2Neo, "p1"))).toEqual([ANY_ENERGY, ANY_ENERGY]);
  });

  it("promotes EVERY copy on the same Basic — the condition is about the HOLDER", () => {
    // Two copies attached: two wildcard units, one per card. The antecedent names
    // the body, so it is the same question for each card sitting on it.
    const state = holding(8, "fix-prism-basic", "fix-prism-energy", 2);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY, ANY_ENERGY]);
  });

  it("is NOT demoted by another Special Energy on the holder", () => {
    // The discrimination that keeps this field from being `demoteWithOtherSpecial`
    // wearing a new name: Jet is another Special, and Luminous would collapse to
    // {C} here. Prism prints no such clause, so it does not.
    let state = holding(9, "fix-prism-basic", "fix-prism-energy");
    state = attachFromDeck(state, "p1", "sv02-190", 1); // Jet — another Special
    expect(providedEnergy(state, activeOf(state, "p1")).sort()).toEqual(
      [ANY_ENERGY, "Colorless"].sort(),
    );
  });

  it("does NOT promote a Luminous sharing the same Basic body", () => {
    let state = holding(10, "fix-prism-basic", "sv02-191", 1);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY]);
    state = attachFromDeck(state, "p1", "fix-prism-energy", 1);
    expect(providedEnergy(state, activeOf(state, "p1")).sort()).toEqual(
      [ANY_ENERGY, "Colorless"].sort(),
    );
  });

  it("leaves the UNAUTHORED Special and the BASIC energy alone on a Basic", () => {
    let state = holding(11, "fix-prism-basic", "fix-special", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless", "Colorless"]);
  });
});

describe("D300 §3 — the provision is LIVE-READ, and here it is LOST (§1.2 + §10)", () => {
  it("DEMOTES ON THE SPOT when the Basic holder EVOLVES into a Stage 1", () => {
    let state = holdingLater(12, "fix-prism-basic", "fix-prism-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY]);

    state = handFromDeck(state, "p1", "fix-prism-stage1", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-prism-stage1"),
        target: { spot: "active" },
      }),
    );

    // Same card, same uid, same energy — a different top card, and therefore a
    // WEAKER provision, in the same breath.
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. IT PAYS A REAL ATTACK COST (§8.2).
// ─────────────────────────────────────────────────────────────────────────────

describe("D300 §4 — the provision spent in the currency §8.2 actually pays", () => {
  it("pays the single {P} of Prism Jab off the one attached card", () => {
    let state = holding(13, "fix-prism-basic", "fix-prism-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("REJECTS Prism Smash {P}{W} on the SAME board — one wildcard, two slots", () => {
    let state = holding(14, "fix-prism-basic", "fix-prism-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("pays Prism Smash {P}{W} once a SECOND Prism is attached to the Basic", () => {
    // Two cards, two wildcards, two typed slots — the count is per CARD, so the
    // cost is reachable the honest way and the rejection above is about arithmetic
    // rather than about the attack being unpayable in principle.
    let state = holding(15, "fix-prism-basic", "fix-prism-energy", 2);
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("REJECTS Prism Jab {P} on the STAGE 1 — the same card, the same cost, {C} only", () => {
    let state = holding(16, "fix-prism-stage1", "fix-prism-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("LOSES a payable attack across the evolve — the live read, priced in §8.2", () => {
    let state = holdingLater(17, "fix-prism-basic", "fix-prism-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    state = handFromDeck(state, "p1", "fix-prism-stage1", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-prism-stage1"),
        target: { spot: "active" },
      }),
    );
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. MATCH_RECORD_VERSION — DRIVEN BOTH DIRECTIONS, AND RECORDED AS A **SKIP**.
// ─────────────────────────────────────────────────────────────────────────────

describe("D300 §5 — the persisted shape does NOT move, and that is measured", () => {
  it("the LITERAL key anchor — the whole GameState key list, spelled out", () => {
    const state = holding(18, "fix-prism-basic", "fix-prism-energy");
    expect(Object.keys(state).sort()).toEqual([
      "allowances",
      "cardIdByUid",
      "cardPool",
      "firstPlayer",
      "handPlayLockedTurn",
      "lastKoMarks",
      "lastKoTurn",
      "oncePerGameSpent",
      "pending",
      "phase",
      "players",
      "recentAttackers",
      "rngState",
      "stadium",
      "turn",
    ]);
  });

  it("D300's build writes NO persisted byte — the SKIP, stated as a measurement", () => {
    const state = holding(19, "fix-prism-basic", "fix-prism-energy");
    const active = activeOf(state, "p1");
    expect(Object.keys(active).sort()).toEqual(
      [
        "attackBlock",
        "attackDamageDebuff",
        "attackDamageTaken",
        "attackFlipLockTurn",
        "attackLockedTurn",
        "attackTwoFlipLockTurn",
        "benchedTurn",
        "boostedAttack",
        "conditions",
        "costTaxTurn",
        "damage",
        "damageReduction",
        "damageVulnerability",
        "energy",
        "evolvedTurn",
        "handAttachMark",
        "healedTurn",
        "installedRecoil",
        "koBounty",
        "lockedAttacks",
        "markers",
        "noWeaknessTurn",
        "promotedTurn",
        "retreatBlocked",
        "retreatLockedTurn",
        "scheduledEffect",
        "stack",
        "tools",
        "turnPlayed",
        "usedAttack",
        "weaknessRetype",
      ].sort(),
    );
    expect(JSON.stringify(active)).not.toContain(ANY_ENERGY);
    expect(providedEnergy(state, active)).toEqual([ANY_ENERGY]);
  });

  it("the SAME board round-trips through JSON with the provision re-derived", () => {
    // Both directions: a serialised board rehydrates and the wildcard is computed
    // again from the top card, not restored from a field that does not exist.
    const state = holding(20, "fix-prism-basic", "fix-prism-energy");
    const round = JSON.parse(JSON.stringify(state)) as GameState;
    expect(round).toEqual(state);
    expect(providedEnergy(round, activeOf(round, "p1"))).toEqual([ANY_ENERGY]);
  });
});
