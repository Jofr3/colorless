import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackEffect } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  COVETOUS_IVY_DECK,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  types,
} from "./testFixtures";

// 0.36.0 → 0.37.0 — the "×"/multiply family's benched-TARGET sibling.
//
// Wo-Chien ex sv02-027 "Covetous Ivy": "This attack does 60 damage to 1 of your
// opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't
// apply Weakness and Resistance for Benched Pokémon.)" — a CHOSEN single Benched
// target (not the Defender), so it derives to a `damageChosen` op (count 1) rather
// than the pre-W/R fold Pecharunt uses. Two new fields: `deals` (the hit is ATTACK
// DAMAGE — DAMAGE_DEALT with the benched reduction passive, not a flat placed
// counter) and `perTakenPrize` (the amount is 60 × the opponent's TAKEN Prizes,
// read from state; 0 taken → no damage and no pick).
//
// fix-bramble carries the SAME derived text at per 40 (a synthetic probe fielded as
// the attacker), the only thing that pins the interpreter multiplies the CAPTURED
// amount rather than a hard-coded 60.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so attacking is legal (§4). P2 starts with only its Active;
    the Bench targets are surgery-placed per test. */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: COVETOUS_IVY_DECK, p2: COVETOUS_IVY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with `energy` Grass attached (its cost); P2's Bench holds
    `benched` (index 0 first) and its Prize pile is trimmed to `remaining`. */
function covetous(
  seed: number,
  opts: { attacker: string; energy: number; benched: readonly string[]; remaining: number },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", opts.attacker);
  state = attachFromDeck(state, "p1", "fix-grass-energy", opts.energy);
  for (const body of opts.benched) state = benchFromDeck(state, "p2", body);
  return setPrizes(state, "p2", opts.remaining);
}

describe("deriveAttackEffect — Wo-Chien's Covetous Ivy (the benched Prize-snipe)", () => {
  it("reads the whole sentence as a count-1 damageChosen (deals + perTakenPrize)", () => {
    expect(
      deriveAttackEffect(
        "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        perTakenPrize: true,
      },
    ]);
  });

  it("the W/R clarifier tail is OPTIONAL, and the per is CAPTURED (fix-bramble's 40)", () => {
    // The reminder clause is §8.5-true regardless, so the deriver reads the sentence
    // with or without it; and the per is captured, not hard-coded to Wo-Chien's 60.
    expect(
      deriveAttackEffect(
        "This attack does 40 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 40,
        count: 1,
        source: "attack",
        deals: true,
        perTakenPrize: true,
      },
    ]);
  });

  it("does not STEAL the 'each of' spread — that stays a different op (all benched)", () => {
    // SPREAD_EACH_BENCH's "each of" is a valid derive already (spreadDamage on ALL
    // benched, flat), NOT this count-1 chosen-target op — the "1 of" vs "each of" is
    // the whole difference, so the two readers must not overlap.
    expect(
      deriveAttackEffect("This attack does 60 damage to each of your opponent's Benched Pokémon."),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 60 }]);
  });

  it("REFUSES its near-misses — the active-multiply, a 0-per, and the anchors", () => {
    for (const text of [
      // Pecharunt's active-multiply — the SAME Prize count, but NO benched target,
      // so it is the pre-W/R fold's, not this op's (deriveAttackEffect must skip it).
      "This attack does 60 damage for each Prize card your opponent has taken.",
      // The additive "more" — Charizard's family.
      "This attack does 30 more damage for each Prize card your opponent has taken.",
      // A printed 0-per adds nothing — left on the loud path, not a no-op op.
      "This attack does 0 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      // Lowercase leading "this" (no /i), a missing trailing period, leading/trailing text.
      "this attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken",
      "Draw a card. This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });
});

describe("Covetous Ivy — a Prize-scaled hit on 1 CHOSEN Benched Pokémon", () => {
  it("parks on the count-1 choice, then deals 60 × taken to the picked Benched (DAMAGE, not counters)", () => {
    // p2 has taken 2 Prizes (4 remain) → 60 × 2 = 120, to 1 of TWO benched bodies.
    const state = covetous(1, {
      attacker: "sv02-027",
      energy: 3,
      benched: ["fix-bigbody", "fix-basic-1"],
      remaining: 4,
    });
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // No main damage (Covetous Ivy has no `damage` field), and the effect asks WHICH.
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p1");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1); // "1 of" is exact
    expect(prompt.note).toContain("120 damage"); // the SCALED amount, in damage not counters
    for (const c of prompt.candidates) {
      expect(c.seat).toBe("p2");
      expect(c.spot.spot).toBe("bench");
    }
    // Pick the first benched (fix-bigbody, 200 HP survives) → dealt as DAMAGE_DEALT.
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(types(e2)).not.toContain("COUNTERS_PLACED");
    expect(find(e2, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 120,
      weakness: null,
      resistance: null,
      dealt: 120,
    });
    // Exactly the chosen body took it; the other Benched Pokémon is untouched.
    expect(done.players.p2.bench[0]?.damage).toBe(120);
    expect(done.players.p2.bench[1]?.damage).toBe(0);
    // The attack's epilogue ran — the turn passed to p2.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("auto-takes on a Bench of exactly 1 (no pick left), scaling by the taken count", () => {
    // p2 has taken 3 Prizes (3 remain) → 60 × 3 = 180 on its one Benched body.
    const state = covetous(2, {
      attacker: "sv02-027",
      energy: 3,
      benched: ["fix-bigbody"],
      remaining: 3,
    });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 180, dealt: 180 });
    expect(done.players.p2.bench[0]?.damage).toBe(180);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("multiplies the CAPTURED per, not a literal 60 — fix-bramble's 40 × 2 = 80", () => {
    // Wo-Chien always prints 60, so a `* 60` literal in the interpreter would survive
    // every real-card test. fix-bramble carries the same op at per 40: taken 2 → 80.
    const state = covetous(3, {
      attacker: "fix-bramble",
      energy: 1,
      benched: ["fix-bigbody"],
      remaining: 4,
    });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 80, dealt: 80 });
    expect(done.players.p2.bench[0]?.damage).toBe(80);
  });

  it("does NOTHING when the opponent has taken no Prizes — 60 × 0 = 0, no pick", () => {
    // A full 6 Prizes remain → 0 taken → 0 damage, so there is nothing to place OR
    // to ask about: no park, no DAMAGE_DEALT, and the turn just ends.
    const state = covetous(4, {
      attacker: "sv02-027",
      energy: 3,
      benched: ["fix-bigbody", "fix-basic-1"],
      remaining: 6,
    });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(done.players.p2.bench.every((p) => p.damage === 0)).toBe(true);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("whiffs harmlessly when the opponent has an empty Bench — no target", () => {
    const state = covetous(5, { attacker: "sv02-027", energy: 3, benched: [], remaining: 4 });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("KOs a lethally-hit Benched Pokémon through the attack epilogue, then ends the turn", () => {
    // fix-victim (30 HP) benched: taken 1 → 60 is lethal. The KO is swept by
    // finishAttack (the two-seat epilogue), p1 takes a Prize, then the turn ends.
    const state = covetous(6, {
      attacker: "sv02-027",
      energy: 3,
      benched: ["fix-victim"],
      remaining: 5, // 1 taken → 60
    });
    const victimUid = benchTopUid(state, "p2", 0);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(victimUid);
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p1");
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    // An attack KO ENDS the turn (unlike the mid-turn Ability snipe, which resumes it).
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.players.p1.prizes).toHaveLength(5); // full 6 → took 1 for the KO
    expect(done.players.p2.bench).toHaveLength(0);
  });

  it("is ATTACK DAMAGE — a benched reduction passive applies, but never Weakness (§8.5)", () => {
    // A benched Bouffalant ("Bouffer", −20 after W/R) takes 60 × 1 = 60, REDUCED to
    // 40 — the `deals` branch runs spreadDamage's reduction, where the put-counter
    // snipe (a flat placed counter) would not. Weakness/Resistance stay null: a
    // Benched target never doubles (§8.5). This is the whole point of `deals`.
    const state = covetous(7, {
      attacker: "sv02-027",
      energy: 3,
      benched: ["sv03-174"], // Bouffalant — Bouffer reduces the hit by 20
      remaining: 5, // 1 taken → 60
    });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 60,
      weakness: null,
      resistance: null,
      reduction: 20, // the passive fired…
      dealt: 40, // …so 60 − 20 landed, not the flat 60 a counter would place
      damage: 40,
    });
  });

  it("never mutates the state it was given (purity — through the state-rewriting auto-take)", () => {
    // A Bench of exactly 1 AUTO-TAKES (no park), so placeSnipe's `deals` branch runs
    // its bench rewrite inside applyAction — the path a mutation-in-place would escape.
    const state = covetous(8, {
      attacker: "sv02-027",
      energy: 3,
      benched: ["fix-bigbody"],
      remaining: 4, // 2 taken → 120, a real placement
    });
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});
