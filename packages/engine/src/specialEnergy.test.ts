import { describe, expect, it } from "vitest";
import { ANY_ENERGY, applyAction, costMet, providedEnergy } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  SPECIAL_ENERGY_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  handUid,
  handFromDeck,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// M4 slice 5 — Special Energy (§6.1). Provision as data (a special energy's
// EnergyProgram gives its units — a concrete type, a WILDCARD, or several),
// the wildcard-aware cost matcher, and on-attach effects (Jet Energy switches a
// benched holder to Active). Representative set: Jet Energy (sv02-190) +
// Luminous Energy (sv02-191); an unauthored special falls back to Colorless.

/** Setup then open P1's turn 2 (P2 went first, passed). */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(seed, { p1: SPECIAL_ENERGY_DECK, p2: SPECIAL_ENERGY_DECK }, { first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return active;
}

describe("costMet with wildcards (§6.4)", () => {
  it("a wildcard fills a typed slot or a Colorless slot", () => {
    expect(costMet(["Fire"], [ANY_ENERGY])).toBe(true);
    expect(costMet(["Colorless"], [ANY_ENERGY])).toBe(true);
    expect(costMet(["Fire", "Colorless"], [ANY_ENERGY, "Colorless"])).toBe(true);
  });

  it("one wildcard cannot cover two typed slots, nor two Colorless slots", () => {
    expect(costMet(["Fire", "Water"], [ANY_ENERGY])).toBe(false);
    expect(costMet(["Colorless", "Colorless"], [ANY_ENERGY])).toBe(false);
  });

  it("multiple wildcards cover multiple DIFFERENT typed slots", () => {
    expect(costMet(["Fire", "Water"], [ANY_ENERGY, ANY_ENERGY])).toBe(true);
    expect(costMet(["Fire", "Water", "Colorless"], [ANY_ENERGY, ANY_ENERGY])).toBe(false);
    expect(costMet(["Fire", "Water", "Colorless"], [ANY_ENERGY, ANY_ENERGY, "Water"])).toBe(true);
  });

  it("handles a multi-unit provider (a 2-Colorless energy pays [C][C])", () => {
    expect(costMet(["Colorless", "Colorless"], ["Colorless", "Colorless"])).toBe(true);
    expect(costMet(["Fire", "Colorless"], ["Fire", "Fire"])).toBe(true); // 2nd Fire pays [C]
  });

  it("stays backward-compatible with plain concrete provision", () => {
    expect(costMet(["Fire", "Colorless"], ["Fire", "Water"])).toBe(true);
    expect(costMet(["Fire", "Fire"], ["Fire", "Water"])).toBe(false);
    expect(costMet([], [])).toBe(true);
  });
});

describe("providedEnergy — provision as data (§6.3)", () => {
  it("gives a basic energy its type, Jet a Colorless, and an unauthored special a Colorless", () => {
    let state = p1Turn2(1);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1); // basic Fire
    state = attachFromDeck(state, "p1", "sv02-190", 1); // Jet (authored → [C])
    state = attachFromDeck(state, "p1", "fix-special", 1); // unauthored special → [C]
    expect(providedEnergy(state, activeOf(state, "p1")).sort()).toEqual(
      ["Colorless", "Colorless", "Fire"].sort(),
    );
  });

  it("gives Luminous a wildcard on its own", () => {
    let state = p1Turn2(2);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "sv02-191", 1); // Luminous
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual([ANY_ENERGY]);
  });

  it("keeps Luminous a wildcard alongside a BASIC energy (a basic is not 'another Special')", () => {
    let state = p1Turn2(3);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "sv02-191", 1); // Luminous
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1); // basic
    expect(providedEnergy(state, activeOf(state, "p1")).sort()).toEqual([ANY_ENERGY, "Fire"].sort());
  });

  it("DEMOTES Luminous to Colorless when another Special Energy is attached", () => {
    let state = p1Turn2(4);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "sv02-191", 1); // Luminous
    state = attachFromDeck(state, "p1", "sv02-190", 1); // Jet — another Special
    // Both now provide Colorless: Luminous demoted, Jet's own [C].
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless", "Colorless"]);
  });

  it("demotes BOTH when two Luminous are attached (each sees the other, §6.1)", () => {
    let state = p1Turn2(10);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "sv02-191", 2); // two Luminous
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless", "Colorless"]);
  });

  it("demotes Luminous even when the other Special Energy is UNAUTHORED", () => {
    let state = p1Turn2(11);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "sv02-191", 1); // Luminous
    state = attachFromDeck(state, "p1", "fix-special", 1); // unauthored special → [C]
    expect(providedEnergy(state, activeOf(state, "p1"))).toEqual(["Colorless", "Colorless"]);
  });
});

describe("special energy pays a real attack cost", () => {
  it("Luminous's wildcard pays the Fire in Flame [Fire][Colorless]", () => {
    let state = p1Turn2(5);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "sv02-191", 1); // Luminous → the Fire
    state = attachFromDeck(state, "p1", "fix-energy", 1); // Colorless → the [C]
    state = setActiveFromDeck(state, "p2", "fix-victim");
    // Flame is attack index 1 ([Fire][Colorless], 60). It resolves — no
    // ATTACK_COST_UNMET — and deals damage.
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("rejects Flame when Luminous is demoted (no wildcard for the Fire)", () => {
    let state = p1Turn2(6);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "sv02-191", 1); // Luminous (will demote)
    state = attachFromDeck(state, "p1", "sv02-190", 1); // Jet — demotes Luminous
    state = setActiveFromDeck(state, "p2", "fix-victim");
    // Now provided = [Colorless, Colorless]; Flame needs a Fire → unpayable.
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_COST_UNMET");
  });
});

describe("Jet Energy — on-attach switch (§6.1)", () => {
  it("switches a benched holder to the Active Spot when attached from hand", () => {
    let state = p1Turn2(7);
    // A clean known benched Pokémon at index 0.
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = benchFromDeck(state, "p1", "fix-victim");
    state = handFromDeck(state, "p1", "sv02-190", 1);
    const jet = handUid(state, "p1", "sv02-190");
    const oldActive = activeUid(state, "p1");
    const benched = benchTopUid(state, "p1", 0);
    const { state: after, events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: jet,
      target: { spot: "bench", index: 0 },
    });
    expect(types(events)).toEqual(["ENERGY_ATTACHED", "POKEMON_SWITCHED"]);
    // The benched Pokémon (now carrying Jet) is Active; the old Active benched.
    expect(activeUid(after, "p1")).toBe(benched);
    expect(after.players.p1.active?.energy).toContain(jet);
    expect(benchTopUid(after, "p1", after.players.p1.bench.length - 1)).toBe(oldActive);
  });

  it("does NOT switch when attached to the Active Spot", () => {
    let state = p1Turn2(8);
    state = handFromDeck(state, "p1", "sv02-190", 1);
    const jet = handUid(state, "p1", "sv02-190");
    const oldActive = activeUid(state, "p1");
    const { state: after, events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: jet,
      target: { spot: "active" },
    });
    expect(types(events)).toEqual(["ENERGY_ATTACHED"]);
    expect(activeUid(after, "p1")).toBe(oldActive);
    expect(after.players.p1.active?.energy).toContain(jet);
  });

  it("never mutates the state it was given (purity)", () => {
    let state = p1Turn2(9);
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = benchFromDeck(state, "p1", "fix-victim");
    state = handFromDeck(state, "p1", "sv02-190", 1);
    const jet = handUid(state, "p1", "sv02-190");
    deepFreeze(state);
    expect(() =>
      applyAction(state, { type: "attachEnergy", seat: "p1", uid: jet, target: { spot: "bench", index: 0 } }),
    ).not.toThrow();
  });
});
