import { describe, expect, it } from "vitest";
import { ANY_ENERGY, applyAction, costMet, programFor, providedEnergy } from "./index";
import type { GameState } from "./index";
import {
  FIXTURE_POOL,
  NEO_UPPER_ENERGY_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  activeOf,
} from "./testFixtures";

/** Setup, then open P1's turn 2 (P2 went first and passed) — `specialEnergy.test.ts`'s
    opener, reused whole. Seed-free: nothing in this cast flips a coin. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: NEO_UPPER_ENERGY_DECK, p2: NEO_UPPER_ENERGY_DECK },
    { first: "p2" },
  );
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

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

describe("Neo Upper Energy — the ROW is data, and both printed halves are on it", () => {
  it("authors `sv05-162` with the {C} provision Jet, Spiky and Mist already share", () => {
    expect(programFor("sv05-162")?.energy?.provides).toEqual(["Colorless"]);
    for (const id of ["sv02-190", "sv05-161", "sv08-191", "sv09-159"]) {
      expect(programFor(id)?.energy?.provides, id).toEqual(["Colorless"]);
    }
  });

  it("provides TWO wildcard units and not one — the multiset half", () => {
    expect(programFor("sv05-162")?.energy?.promoteOnHolderStage?.units).toEqual([
      ANY_ENERGY,
      ANY_ENERGY,
    ]);
    expect(programFor("sv05-162")?.energy?.promoteOnHolderStage?.units).toHaveLength(2);
    // And the two-ness is observable at the matcher, one layer below any board:
    // one wildcard cannot cover two typed slots.
    expect(costMet(["Psychic", "Water"], [ANY_ENERGY])).toBe(false);
    expect(costMet(["Psychic", "Water"], [ANY_ENERGY, ANY_ENERGY])).toBe(true);
  });

  it("carries NO on-attach arm and NO continuous passive — both are ABSENT from the print", () => {
    expect(programFor("sv05-162")?.energy?.onAttach).toBeUndefined();
    expect(programFor("sv05-162")?.energy?.passive).toBeUndefined();
    // …and it is NOT the other conditional wearing a new name.
    expect(programFor("sv05-162")?.energy?.demoteWithOtherSpecial).toBeUndefined();
    expect(programFor("sv02-191")?.energy?.promoteOnHolderStage).toBeUndefined();
  });

  it("carries the printed sentence on the fixture demonstrator", () => {
    const printed =
      "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to a Stage 2 Pokémon, this card provides every type of Energy but provides only 2 Energy at a time.";
    expect(FIXTURE_POOL["fix-neo-upper-energy"]?.effect).toBe(printed);
    expect(programFor("fix-neo-upper-energy")).toBe(programFor("sv05-162"));
  });

  it("ENUMERATES every card in the pool with a CONDITIONAL provision — measured", () => {
    const conditional = Object.keys(FIXTURE_POOL)
      .filter((id) => {
        const energy = programFor(id)?.energy;
        return (
          energy?.demoteWithOtherSpecial !== undefined || energy?.promoteOnHolderStage !== undefined
        );
      })
      .sort();
    expect(conditional).toEqual([
      "fix-neo-upper-energy",
      "fix-prism-energy",
      "fix-reversal-energy",
      "sv02-191",
    ]);

    for (const id of conditional) {
      const energy = programFor(id)?.energy;
      const both =
        energy?.demoteWithOtherSpecial !== undefined && energy?.promoteOnHolderStage !== undefined;
      expect(both, `${id} carries BOTH conditional provisions`).toBe(false);
    }
  });
});

describe("Neo Upper Energy — provision is gated on the HOLDER's printed stage (§6.3)", () => {
  it("provides {C} on a BASIC holder", () => {
    const state = holding(1, "fix-basic-1", "fix-neo-upper-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("provides {C} on a STAGE 1 holder — the mistake a reused `stage` filter makes", () => {
    // `matchesFilter`'s non-basic arm is `evolveFromOf(card) !== null`, which a
    // Stage 1 satisfies. If this board came back with wildcards, the gate would be
    // "is an Evolution" and not "is a Stage 2".
    const state = holding(2, "fix-neo-stage1", "fix-neo-upper-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);
  });

  it("provides TWO wildcards on a STAGE 2 holder", () => {
    const state = holding(3, "fix-neo-stage2", "fix-neo-upper-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY, ANY_ENERGY]);
  });

  it("promotes EVERY copy on the same Stage 2 — the condition is about the HOLDER", () => {
    // Two copies attached: four wildcard units, not two. The antecedent names the
    // body, so it is the same question for each card sitting on it (and unlike
    // Luminous's, a second copy does not interfere with the first).
    const state = holding(4, "fix-neo-stage2", "fix-neo-upper-energy", 2);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([
      ANY_ENERGY,
      ANY_ENERGY,
      ANY_ENERGY,
      ANY_ENERGY,
    ]);
  });

  it("is NOT demoted by another Special Energy on the holder", () => {
    // The discrimination that keeps this field from being `demoteWithOtherSpecial`
    // wearing a new name: Jet is another Special, and Luminous would collapse to
    // {C} here. Neo Upper prints no such clause, so it does not.
    let state = holding(5, "fix-neo-stage2", "fix-neo-upper-energy");
    state = attachFromDeck(state, "p1", "sv02-190", 1); // Jet — another Special
    expect(providedEnergy(state, activeOf(state, "p1")).sort()).toEqual(
      [ANY_ENERGY, ANY_ENERGY, "Colorless"].sort(),
    );
  });

  it("does NOT promote a Luminous sharing the same Stage 2 body", () => {
    let state = holding(6, "fix-neo-stage2", "sv02-191", 1);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY]);
    state = attachFromDeck(state, "p1", "fix-neo-upper-energy", 1);
    expect(providedEnergy(state, activeOf(state, "p1")).sort()).toEqual(
      [ANY_ENERGY, ANY_ENERGY, "Colorless"].sort(),
    );
  });

  it("leaves the UNAUTHORED Special and the BASIC energy alone on a Stage 2", () => {
    // Both reach the same funnel; neither has a program to promote.
    let state = holding(7, "fix-neo-stage2", "fix-special", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless", "Colorless"]);
  });
});

describe("Neo Upper Energy — the provision is LIVE-READ, not stamped (§1.2 + §10)", () => {
  it("UPGRADES ON THE SPOT when the holder EVOLVES into a Stage 2", () => {
    let state = holdingLater(8, "fix-neo-stage1", "fix-neo-upper-energy");
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless"]);

    state = handFromDeck(state, "p1", "fix-neo-stage2", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-neo-stage2"),
        target: { spot: "active" },
      }),
    );

    // Same card, same uid, same energy — a different top card, and therefore a
    // different provision, in the same breath.
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY, ANY_ENERGY]);
  });
});

describe("Neo Upper Energy — it pays a real attack cost (§8.2)", () => {
  it("pays the two DIFFERENT typed symbols of Neo Smash {P}{W} off ONE card", () => {
    let state = holding(9, "fix-neo-stage2", "fix-neo-upper-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("pays the single {P} of Neo Jab off the same card", () => {
    let state = holding(10, "fix-neo-stage2", "fix-neo-upper-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("REJECTS Neo Jab {P} on the STAGE 1 — the same card, the same cost, {C} only", () => {
    let state = holding(11, "fix-neo-stage1", "fix-neo-upper-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("rejects Neo Smash {P}{W} when only ONE Neo Upper is on the Stage 1", () => {
    let state = holding(12, "fix-neo-stage1", "fix-neo-upper-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });

  it("pays Neo Smash on a Stage 2 the moment the body EVOLVES into one", () => {
    // The live read again, priced in the currency §8.2 actually spends: the very
    // attack refused two tests up resolves once the body is a Stage 2, with no
    // change to the attached card at all.
    let state = holdingLater(13, "fix-neo-stage1", "fix-neo-upper-energy");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    state = handFromDeck(state, "p1", "fix-neo-stage2", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: handUid(state, "p1", "fix-neo-stage2"),
        target: { spot: "active" },
      }),
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });
});
