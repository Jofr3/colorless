import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackDamageBonus } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  SCALED_DAMAGE_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.34.0 — count-scaled attack damage (the additive "+" family, self-damage-
// counter reader).
//
// "This attack does N more damage for each damage counter on this Pokémon."
// (Paldean Tauros sv02-028 "Raging Horns", fix-attacker "Rage") is now SIMULATED:
// deriveAttackDamageBonus reads the anchored sentence, and attack.ts folds
// N × (the attacker's OWN damage counters) into the printed base BEFORE the §8.5
// W/R pipeline — a new DAMAGE_DEALT `scaled` field, landing at the same pre-W/R
// step as the continuous Vitality Band bonus. The "+"/effect is no longer flagged
// loudly for these cards.
//
// Charizard ex sv03-125 "Burning Darkness" ("… for each Prize card your opponent
// has taken.") is a DIFFERENT count source with no reader — it STAYS on the loud
// ATTACK_EFFECT_SKIPPED path, the anchor-guard witness that the deriver is narrow.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1 goes second, so
    turn 2 is their first turn with no §4 attack restriction. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(seed, { p1: SCALED_DAMAGE_DECK, p2: SCALED_DAMAGE_DECK }, { first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** P1 fields `attacker` with `energy` Fire attached and `damage` HP already on it
    (its damage counters are what the scaling reads), P2 fields `defender`. The two
    scaling attackers are Basics and Charizard is a Stage 2, but setActiveFromDeck
    force-places either — the surgery reads the stack top, not the stage. */
function matchup(
  seed: number,
  opts: { attacker: string; defender: string; energy: number; damage?: number },
): GameState {
  let state = p1Turn2(seed);
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = attachFromDeck(state, "p1", "fix-fire-energy", opts.energy);
  if (opts.damage !== undefined) state = setDamage(state, "p1", opts.damage);
  return setActiveFromDeck(state, "p2", opts.defender);
}

describe("deriveAttackDamageBonus — the additive counter-scaling reader", () => {
  it("reads the anchored sentence for any N, as damageCountersOnSelf", () => {
    expect(
      deriveAttackDamageBonus(
        "This attack does 10 more damage for each damage counter on this Pokémon.",
      ),
    ).toEqual({ per: 10, count: { kind: "damageCountersOnSelf" } });
    // Not hard-coded to 10 — the per-counter amount is captured.
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each damage counter on this Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "damageCountersOnSelf" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each damage counter on this Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "damageCountersOnSelf" } });
  });

  it("REFUSES Charizard ex's Prize-card twin — the discrimination the slice turns on", () => {
    // Same shape, a DIFFERENT count source (the opponent's taken Prizes), differing
    // only in the tail: the anchored whole-sentence match is what keeps it out.
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Prize card your opponent has taken.",
      ),
    ).toBeNull();
  });

  it("refuses the near-misses — the anchors and the capital are load-bearing", () => {
    for (const text of [
      // A lowercase leading "this" is refused independently of the anchors — no /i,
      // the capital is half of what keeps a mid-sentence clause off the derived
      // path (the family's Krookodile convention; the anchors are the other half).
      "this attack does 10 more damage for each damage counter on this Pokémon.",
      // A missing trailing period is not the whole sentence.
      "This attack does 10 more damage for each damage counter on this Pokémon",
      // A printed 0 adds nothing — left loud, not derived to a no-op.
      "This attack does 0 more damage for each damage counter on this Pokémon.",
      // Leading text with a CAPITAL "This" pins `^`: drop the start anchor and the
      // sentence matches as a substring here (so it would wrongly derive).
      "Draw a card. This attack does 10 more damage for each damage counter on this Pokémon.",
      // A real trailing clause pins `$`: dropping the end anchor would match this.
      "This attack does 10 more damage for each damage counter on this Pokémon. Then, draw a card.",
    ]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
  });
});

describe("scaling applies — folded into the base before §8.5 (no skip)", () => {
  it("fix-attacker 'Rage' adds 10 per damage counter, ahead of W/R", () => {
    // 9 counters (90 HP) × 10 = 90 on top of Rage's printed base 10 → 100, which
    // fix-wall (120 HP, no weakness) survives so the math stands alone.
    const state = matchup(1, {
      attacker: "fix-attacker",
      defender: "fix-wall",
      energy: 1,
      damage: 90,
    });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 3 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 90, dealt: 100 });
  });

  it("omits `scaled` at 0 damage counters — the clause added nothing", () => {
    const state = matchup(2, { attacker: "fix-attacker", defender: "fix-wall", energy: 1 });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 3 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.scaled).toBeUndefined();
    expect(dealt?.dealt).toBe(10); // base only
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("simulates the REAL card — Paldean Tauros 'Raging Horns' (base 20)", () => {
    // 3 counters (30 HP) × 10 = 30 on top of base 20 → 50 vs fix-wall (survives).
    const state = matchup(3, {
      attacker: "sv02-028",
      defender: "fix-wall",
      energy: 2,
      damage: 30,
    });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, scaled: 30, dealt: 50 });
  });

  it("folds the scaling BEFORE weakness — (base + scaled) is what doubles", () => {
    // fix-weak is ×2 Fire and fix-attacker is Fire: 1 counter → scaled 10, so
    // (10 + 10) × 2 = 40, where scaling AFTER weakness would give 10×2 + 10 = 30.
    // 40 < 60 HP, so fix-weak survives and the number is only about the order.
    const state = matchup(4, {
      attacker: "fix-attacker",
      defender: "fix-weak",
      energy: 1,
      damage: 10,
    });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 3 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 10,
      scaled: 10,
      weakness: { op: "multiply", amount: 2 },
      dealt: 40,
    });
  });

  it("multiplies by the CAPTURED per, and fires on the scaling clause alone (base 0)", () => {
    // fix-attacker's "Fury" (index 4) is a base-0 scaler at per 20 — the probe that
    // pins two branches nothing else reaches: the fold uses the CAPTURED `per` (not
    // the literal 10 every real reader happens to print — a `* 10` regression would
    // give 30 here, not 60), and attack.ts's widened `base + scaled > 0` guard fires
    // the §8.5 pipeline off the scaling clause ALONE (a `base > 0` guard would emit
    // no DAMAGE_DEALT at all). 3 counters (30 HP) × 20 = 60 on top of base 0.
    const state = matchup(7, {
      attacker: "fix-attacker",
      defender: "fix-wall",
      energy: 1,
      damage: 30,
    });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 4 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 60, dealt: 60 });
  });

  it("never mutates the state it was given (purity)", () => {
    const state = matchup(5, {
      attacker: "fix-attacker",
      defender: "fix-wall",
      energy: 1,
      damage: 90,
    });
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 3 })).not.toThrow();
  });
});

describe("the discrimination — Charizard ex's Prize-scaling '+' stays skipped", () => {
  it("flags 'Burning Darkness' loudly and adds no `scaled` (a DIFFERENT count source)", () => {
    // Charizard's "+" scales off the opponent's TAKEN Prizes, which no reader
    // simulates — so its base 180 lands and the "+"/effect is flagged, exactly as
    // before the slice. fix-bigbody (200 HP) survives the 180, keeping the §8.1 KO
    // tail out of the way. Its attack is DERIVED (CHARIZARD_EX authors only the
    // onEvolve Ability), so nothing but the deriver decides this.
    const state = matchup(6, { attacker: "sv03-125", defender: "fix-bigbody", energy: 2 });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      attack: "Burning Darkness",
      damageModifier: "+",
    });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 180, dealt: 180 });
    expect(dealt?.scaled).toBeUndefined();
  });
});
