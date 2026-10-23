import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackDamageBonus, deriveAttackDamageMultiplier } from "./index";
import type { GameState } from "./index";
import {
  MULTIPLY_DAMAGE_DECK,
  SCALED_DAMAGE_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  setPrizes,
  types,
  findEvent,
} from "./testFixtures";

/** Setup then open P1's turn 2 (P2 went first and passed) — P1 goes second, so
    turn 2 is their first turn with no §4 attack restriction. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: SCALED_DAMAGE_DECK, p2: SCALED_DAMAGE_DECK },
    { first: "p2" },
  );
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function matchup(
  seed: number,
  opts: {
    attacker: string;
    defender: string;
    energy: number;
    damage?: number;
    energyId?: string;
  },
): GameState {
  let state = p1Turn2(seed);
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = attachFromDeck(state, "p1", opts.energyId ?? "fix-fire-energy", opts.energy);
  if (opts.damage !== undefined) state = setDamage(state, "p1", opts.damage);
  return setActiveFromDeck(state, "p2", opts.defender);
}

const UNREAD_COUNT_NOUN = "This attack does 30 damage for each of your Future Pokémon in play.";

const BUILT_FORMER_WITNESS =
  "This attack does 50 damage for each of your Pokémon that has any damage counters on it.";

const BUILT_D518_WITNESS =
  "This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon.";

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

  it("reads Charizard ex's Prize twin as opponentPrizesTaken (the second member)", () => {
    expect(
      deriveAttackDamageBonus(
        "This attack does 30 more damage for each Prize card your opponent has taken.",
      ),
    ).toEqual({ per: 30, count: { kind: "opponentPrizesTaken" } });
    // Not hard-coded to 30 — the per-Prize amount is captured.
    expect(
      deriveAttackDamageBonus(
        "This attack does 60 more damage for each Prize card your opponent has taken.",
      ),
    ).toEqual({ per: 60, count: { kind: "opponentPrizesTaken" } });
  });

  it("REFUSES the '×'/multiply Prize family — 'more' is the additive tell", () => {
    expect(
      deriveAttackDamageBonus(
        "This attack does 60 damage for each Prize card your opponent has taken.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each of your Benched {L} Pokémon.",
      ),
    ).toEqual({
      per: 20,
      count: {
        kind: "yourBenchCount",
        filter: { kind: "typedPokemon", pokemonType: "Lightning" },
      },
    });
    expect(deriveAttackDamageBonus(UNREAD_COUNT_NOUN)).toBeNull();
    expect(deriveAttackDamageMultiplier(UNREAD_COUNT_NOUN)).toBeNull();
    // …and the ANCHOR is not what refuses it: the same pattern claims the same shape at a
    // noun the shared map DOES answer, so the null above is the VOCABULARY and nothing else.
    expect(deriveAttackDamageMultiplier(UNREAD_COUNT_NOUN.replace("Future", "Basic"))).toEqual({
      per: 30,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "basicPokemon" } },
    });
    expect(deriveAttackDamageMultiplier(BUILT_FORMER_WITNESS)).toEqual({
      per: 50,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "anyPokemon" },
        damagedOnly: true,
      },
    });
    expect(deriveAttackDamageBonus(BUILT_FORMER_WITNESS)).toBeNull();
    expect(deriveAttackDamageMultiplier(BUILT_D518_WITNESS)).toEqual({
      per: 100,
      count: { kind: "specialConditionsOnOpponentActive" },
    });
    expect(deriveAttackDamageBonus(BUILT_D518_WITNESS)).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 10 more damage for each damage counter on all of your opponent's Pokémon.",
      ),
    ).toEqual({ per: 10, count: { kind: "damageCountersOnOpponentBoard" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each {R} Energy attached to this Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "energyOnSelf", energyType: "Fire" } });
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

  it("refuses the Prize-regex near-misses — its anchors are load-bearing too", () => {
    // The second reader's anchors and capital pinned INDEPENDENTLY of the first —
    // dropping `^`/`$` on OPPONENT_PRIZES_SCALE must fail here, not survive because
    // SELF_COUNTER_SCALE's own anchors happen to be tested.
    for (const text of [
      // Lowercase leading "this" — refused independently of the anchors (no /i).
      "this attack does 30 more damage for each Prize card your opponent has taken.",
      // Missing trailing period is not the whole sentence.
      "This attack does 30 more damage for each Prize card your opponent has taken",
      // A printed 0 adds nothing — left loud, not derived to a no-op.
      "This attack does 0 more damage for each Prize card your opponent has taken.",
      // Leading text with a capital "This" pins `^`.
      "Draw a card. This attack does 30 more damage for each Prize card your opponent has taken.",
      // A real trailing clause pins `$`.
      "This attack does 30 more damage for each Prize card your opponent has taken. Then, draw a card.",
    ]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
  });
});

describe("deriveAttackDamageMultiplier — the '×'/multiply reader", () => {
  it("reads the no-'more' Prize sentence for any N, as opponentPrizesTaken", () => {
    // Pecharunt ex (60×) and Annihilape (70×) — the SAME count source as the
    // additive twin, a DIFFERENT fold. The parse is the shared {per, count} shape;
    // per is captured (not hard-coded), which the two real pers prove.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Prize card your opponent has taken.",
      ),
    ).toEqual({ per: 60, count: { kind: "opponentPrizesTaken" } });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 70 damage for each Prize card your opponent has taken.",
      ),
    ).toEqual({ per: 70, count: { kind: "opponentPrizesTaken" } });
  });

  it("REFUSES the additive '+' twin — 'more' belongs to the other reader", () => {
    // Charizard ex's "… does N MORE damage …" is the additive family's; the multiply
    // reader must leave it (deriveAttackDamageBonus owns it) so no text derives twice.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 more damage for each Prize card your opponent has taken.",
      ),
    ).toBeNull();
  });

  it("REFUSES the bigger '×' siblings — a different SHAPE, not this reader's", () => {
    for (const text of [
      // Wo-Chien ex "Covetous Ivy" — a benched-target multiply (no W/R), refused by
      // the mid-sentence text the anchors exclude, not by the tail.
      "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // Chien-Pao ex "Hail Blade" — a DISCARDED-Energy count (a compound: discard
      // then scale), refused by the tail.
      "You may discard any amount of {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
    ]) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });

  it("refuses the near-misses — the anchors, the capital, and a printed 0", () => {
    for (const text of [
      // Lowercase leading "this" — refused independently of the anchors (no /i).
      "this attack does 60 damage for each Prize card your opponent has taken.",
      // Missing trailing period is not the whole sentence.
      "This attack does 60 damage for each Prize card your opponent has taken",
      // A printed 0 does nothing — left loud, not derived to a no-op.
      "This attack does 0 damage for each Prize card your opponent has taken.",
      // Leading text with a capital "This" pins `^`.
      "Draw a card. This attack does 60 damage for each Prize card your opponent has taken.",
      // A real trailing clause pins `$`.
      "This attack does 60 damage for each Prize card your opponent has taken. Then, draw a card.",
    ]) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 90, dealt: 100 });
  });

  it("omits `scaled` at 0 damage counters — the clause added nothing", () => {
    const state = matchup(2, { attacker: "fix-attacker", defender: "fix-wall", energy: 1 });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 3 });
    const dealt = findEvent(events, "DAMAGE_DEALT");
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, scaled: 30, dealt: 50 });
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 10,
      scaled: 10,
      weakness: { op: "multiply", amount: 2 },
      dealt: 40,
    });
  });

  it("multiplies by the CAPTURED per, and fires on the scaling clause alone (base 0)", () => {
    const state = matchup(7, {
      attacker: "fix-attacker",
      defender: "fix-wall",
      energy: 1,
      damage: 30,
    });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 4 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 60, dealt: 60 });
  });

  it("simulates Charizard ex 'Burning Darkness' — 30 per Prize the opponent has taken", () => {
    // The opponent (p2, the defender) has taken 2 of their 6 Prizes → 4 remain, so
    // scaled = 30 × 2 = 60 folded onto base 180 → 240. The mirror-match Charizard
    // (330 HP) survives, keeping the §8.1 KO tail out so the math stands alone.
    let state = matchup(8, { attacker: "sv03-125", defender: "sv03-125", energy: 2 });
    state = setPrizes(state, "p2", 4); // 2 taken
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 180, scaled: 60, dealt: 240 });
  });

  it("scales off the OPPONENT's Prizes, and by the CAPTURED per (not a literal 10)", () => {
    // 4 taken by p2 (2 remain) → 30 × 4 = 120 → 300, still under the mirror's 330.
    // Pins two mutations at once: reading the ATTACKER's own prizes (p1 has taken 0
    // → would give base 180 alone) and a hard-coded `* 10` (would give 40, not 120).
    let state = matchup(9, { attacker: "sv03-125", defender: "sv03-125", energy: 2 });
    state = setPrizes(state, "p2", 2); // 4 taken
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 180, scaled: 120, dealt: 300 });
  });

  it("omits `scaled` when the opponent has taken no Prizes", () => {
    // Full 6 Prizes remain on p2 → 0 taken → the clause adds nothing, so `scaled`
    // is absent and base 180 lands alone (the bonus/reduction omit-at-0 pattern).
    const state = matchup(10, { attacker: "sv03-125", defender: "sv03-125", energy: 2 });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt?.scaled).toBeUndefined();
    expect(dealt?.dealt).toBe(180);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("multiplies the Prize count by the CAPTURED per — a per-50 probe (not a literal 30)", () => {
    let state = matchup(11, { attacker: "fix-attacker", defender: "fix-bigbody", energy: 1 });
    state = setPrizes(state, "p2", 4); // 2 taken
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 5 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 40, scaled: 100, dealt: 140 });
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

describe("the discrimination — an unsimulated '+' (Pachirisu) stays skipped", () => {
  it("flags 'Everyone Discharge' loudly and adds no `scaled` (a count source with no reader)", () => {
    const state = matchup(6, {
      attacker: "sv01-068",
      defender: "fix-bigbody",
      energy: 2,
      energyId: "fix-lightning-energy",
    });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      attack: "Everyone Discharge",
      damageModifier: "+",
    });
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 10, dealt: 10 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("hands the role over cleanly — Entei's SAME board now folds instead of skipping", () => {
    const state = matchup(6, { attacker: "sv03-030", defender: "fix-bigbody", energy: 3 });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 60, scaled: 60, dealt: 120 });
  });
});

describe("the '×'/multiply family — per × count as the whole damage (base dropped)", () => {
  function multiplyMatchup(
    seed: number,
    opts: { attacker: string; energyId: string; energy: number },
  ): GameState {
    let state = driveSetup(
      seed,
      { p1: MULTIPLY_DAMAGE_DECK, p2: MULTIPLY_DAMAGE_DECK },
      { first: "p2" },
    );
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = setActiveFromDeck(state, "p1", opts.attacker);
    state = attachFromDeck(state, "p1", opts.energyId, opts.energy);
    return setActiveFromDeck(state, "p2", "fix-bigbody");
  }

  it("Pecharunt ex 'Irritated Outburst' does 60 × taken Prizes, base dropped", () => {
    // p2 (the opponent/defender) has taken 2 of 6 Prizes → 4 remain, so 60 × 2 = 120
    // is the WHOLE damage: base 0 (the printed "60×" per-unit dropped), scaled 120,
    // dealt 120 vs fix-bigbody (200 HP survives, so the math stands alone).
    let state = multiplyMatchup(1, {
      attacker: "sv06.5-039",
      energyId: "fix-dark-energy",
      energy: 2,
    });
    state = setPrizes(state, "p2", 4); // 2 taken
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 120, dealt: 120 });
  });

  it("drops the printed base — 0 taken Prizes does 0 damage, no DAMAGE_DEALT", () => {
    // The base-drop tell: a multiply at count 0 does NOTHING. Were the printed "60×"
    // base kept (folded like the additive family), it would deal 60 — so the absent
    // DAMAGE_DEALT pins that attack.ts drops the base (scaledBase 0) for a multiply.
    const state = multiplyMatchup(2, {
      attacker: "sv06.5-039",
      energyId: "fix-dark-energy",
      energy: 2,
    });
    // p2 keeps all 6 Prizes → 0 taken.
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("scales by the CAPTURED per — Annihilape 'Rage Fist' is 70, not Pecharunt's 60", () => {
    // per 70 ≠ 60 pins the multiply fold reads the deriver's captured per (a hard-coded
    // 60 would give 120). p2 has taken 2 → 70 × 2 = 140, which fix-bigbody survives.
    let state = multiplyMatchup(3, {
      attacker: "sv01-109",
      energyId: "fix-fighting-energy",
      energy: 1,
    });
    state = setPrizes(state, "p2", 4); // 2 taken
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 140, dealt: 140 });
  });

  it("never mutates the state it was given (purity)", () => {
    let state = multiplyMatchup(4, {
      attacker: "sv06.5-039",
      energyId: "fix-dark-energy",
      energy: 2,
    });
    state = setPrizes(state, "p2", 4);
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});
