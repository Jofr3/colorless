import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackDamageBonus, deriveAttackDamageMultiplier } from "./index";
import type { GameState } from "./index";
import {
  FIXTURE_POOL,
  RETREAT_SCALING_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const ADDITIVE_TEXT =
  "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";
const MULTIPLY_TEXT =
  "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";

/** Setup then open P1's turn 2 (P2 went first and passed) — P1 goes second, so
    turn 2 is their first turn with no §4 attack restriction. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: RETREAT_SCALING_DECK, p2: RETREAT_SCALING_DECK },
    { first: "p2" },
  );
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** P1 fields `attacker` with `energy` copies of `energyId` attached, P2 fields
    `defender`. Stoutland is a Stage 2 and Heracross a Basic — setActiveFromDeck
    force-places either, since the surgery reads the stack top, not the stage. */
function matchup(
  seed: number,
  opts: { attacker: string; defender: string; energyId: string; energy: number },
): GameState {
  let state = p1Turn2(seed);
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = attachFromDeck(state, "p1", opts.energyId, opts.energy);
  return setActiveFromDeck(state, "p2", opts.defender);
}

/** Play `cardId` out of P1's deck into the shared Stadium zone (a real action on
    P1's open turn, so the attack that follows is still legal). */
function withStadium(state: GameState, cardId: string): GameState {
  const next = handFromDeck(state, "p1", cardId, 1);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid: handUid(next, "p1", cardId) })
    .state;
}

describe("the retreat-cost readers — the derivers", () => {
  it("reads the additive sentence as opponentActiveRetreatCost", () => {
    expect(deriveAttackDamageBonus(ADDITIVE_TEXT)).toEqual({
      per: 30,
      count: { kind: "opponentActiveRetreatCost" },
    });
    // Not hard-coded to 30 — the per-{C} amount is captured.
    expect(
      deriveAttackDamageBonus(
        "This attack does 10 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      ),
    ).toEqual({ per: 10, count: { kind: "opponentActiveRetreatCost" } });
  });

  it("reads Stoutland's '×' twin through the MULTIPLY reader", () => {
    expect(deriveAttackDamageMultiplier(MULTIPLY_TEXT)).toEqual({
      per: 50,
      count: { kind: "opponentActiveRetreatCost" },
    });
  });

  it("keeps the two arms disjoint — 'more' is the tell, as for the Prize twins", () => {
    // The additive reader must refuse Stoutland's text (it multiplies, dropping the
    // printed base) and the multiply reader must refuse the "more" family.
    expect(deriveAttackDamageBonus(MULTIPLY_TEXT)).toBeNull();
    expect(deriveAttackDamageMultiplier(ADDITIVE_TEXT)).toBeNull();
  });

  it("stays anchored — no leading/trailing text, no lowercase 'this'", () => {
    expect(deriveAttackDamageBonus(`Flip a coin. ${ADDITIVE_TEXT}`)).toBeNull();
    expect(deriveAttackDamageBonus(ADDITIVE_TEXT.replace("This", "this"))).toBeNull();
    expect(deriveAttackDamageBonus(ADDITIVE_TEXT.replace(".", ""))).toBeNull();
    // The near-miss that belongs to a DIFFERENT (unbuilt) seam: an own-side read.
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each {C} in this Pokémon's Retreat Cost.",
      ),
    ).toBeNull();
  });

  it("carries the four real printings' text verbatim on the fixtures", () => {
    // The fixtures derive off their TEXT (no registry program), so the sentence is
    // load-bearing: a drifted character silently un-simulates the card.
    const heracross = FIXTURE_POOL["sv01-002"]?.attacks?.[0];
    expect(heracross?.name).toBe("Superpowered Throw");
    expect(heracross?.damage).toBe("10+");
    expect(heracross?.effect).toBe(ADDITIVE_TEXT);
    const stoutland = FIXTURE_POOL["sv03-172"]?.attacks?.[0];
    expect(stoutland?.name).toBe("Chomp Chomp Panic");
    expect(stoutland?.damage).toBe("50×");
    expect(stoutland?.effect).toBe(MULTIPLY_TEXT);
  });
});

describe("the additive arm — Heracross sv01-002 'Superpowered Throw' (10+)", () => {
  it("adds 30 per {C} of the defender's cost onto the printed base", () => {
    const state = matchup(1, {
      attacker: "sv01-002",
      defender: "fix-retreat2",
      energyId: "fix-grass-energy",
      energy: 2,
    });
    const { events, state: after } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // retreat 2 → 10 + 30 × 2.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 60, dealt: 70 });
    expect(after.players.p2.active?.damage).toBe(70);
    // Both the "+" marker and the sentence are simulated now.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("keeps the printed base when the defender retreats free (count 0)", () => {
    const state = matchup(2, {
      attacker: "sv01-002",
      defender: "fix-basic-0",
      energyId: "fix-grass-energy",
      energy: 2,
    });
    const { events, state: after } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // `scaled` is present only when the clause actually added HP.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, dealt: 10 });
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(after.players.p2.active?.damage).toBe(10);
  });

  it("does NOT leak onto the card's other attack (the index-keyed seam)", () => {
    const state = matchup(3, {
      attacker: "sv01-002",
      defender: "fix-retreat2",
      energyId: "fix-grass-energy",
      energy: 3,
    });
    // Horn Attack — a plain 90, no effect text, no "+" marker.
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, dealt: 90 });
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("the multiply arm — Stoutland sv03-172 'Chomp Chomp Panic' (50×)", () => {
  it("makes 50 per {C} the WHOLE damage, the printed base dropped", () => {
    const state = matchup(4, {
      attacker: "sv03-172",
      defender: "fix-retreat2",
      energyId: "fix-energy",
      energy: 1,
    });
    const { events, state: after } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // retreat 2 → 50 × 2, and base 0 — the printed "50×" IS the per-unit.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 100, dealt: 100 });
    expect(after.players.p2.active?.damage).toBe(100);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("does NOTHING at all against a free retreater — the arm's distinguishing case", () => {
    const state = matchup(5, {
      attacker: "sv03-172",
      defender: "fix-basic-0",
      energyId: "fix-energy",
      energy: 1,
    });
    const { events, state: after } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // 50 × 0 with no base to fall back on: the damage branch never opens, so there
    // is no DAMAGE_DEALT at all (the established count-0 behaviour). Still not
    // flagged — the attack IS simulated, it simply does nothing.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(after.players.p2.active?.damage).toBe(0);
  });
});

describe("the readers see the MODIFIED cost — the one-derivation-point payoff", () => {
  it("reads Beach Court's discount (retreat 2 → 1, so 70 → 40)", () => {
    const state = withStadium(
      matchup(6, {
        attacker: "sv01-002",
        defender: "fix-retreat2",
        energyId: "fix-grass-energy",
        energy: 2,
      }),
      "sv01-167",
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 30, dealt: 40 });
  });

  it("reads Calamitous Wasteland's surcharge (retreat 2 → 3, so 70 → 100)", () => {
    const state = withStadium(
      matchup(7, {
        attacker: "sv01-002",
        defender: "fix-retreat2",
        energyId: "fix-grass-energy",
        energy: 2,
      }),
      "sv02-175",
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 90, dealt: 100 });
  });

  it("reads the surcharge's {F} EXEMPTION too — a Fighting defender stays at 1", () => {
    const state = withStadium(
      matchup(8, {
        attacker: "sv01-002",
        defender: "fix-fighting-1",
        energyId: "fix-grass-energy",
        energy: 2,
      }),
      "sv02-175",
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // Not 3 — the Stadium exempts {F}, so the reader sees the printed 1.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 30, dealt: 40 });
  });

  it("multiplies through the surcharge as well (50 × 3 = 150)", () => {
    const state = withStadium(
      matchup(9, {
        attacker: "sv03-172",
        defender: "fix-retreat2",
        energyId: "fix-energy",
        energy: 1,
      }),
      "sv02-175",
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 150, dealt: 150 });
  });

  it("is a pure read — declaring the attack never mutates the frozen input", () => {
    const state = matchup(10, {
      attacker: "sv01-002",
      defender: "fix-retreat2",
      energyId: "fix-grass-energy",
      energy: 2,
    });
    expect(() =>
      applyAction(deepFreeze(state), { type: "attack", seat: "p1", index: 0 }),
    ).not.toThrow();
  });
});
