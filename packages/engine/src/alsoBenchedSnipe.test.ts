import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackEffect } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  ALSO_SNIPE_DECK,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.37.0 → 0.38.0 — the flat benched-snipe RIDER family.
//
// "This attack ALSO does N damage to 1 of your opponent's Benched Pokémon. (Don't
// apply Weakness and Resistance for Benched Pokémon.)" is a SECONDARY snipe AFTER
// the main damage (which rides the attack's own `damage` field). It is the SAME
// count-1 `deals` `damageChosen` op as D57's Covetous Ivy, only WITHOUT
// `perTakenPrize` (a fixed N, not Prize-scaled) — so it is a new derive over the
// existing op, no new interpreter code. Miraidon sv01-080 "Lightning Laser" (90 +
// 30) and Tadbulb sv03-076 "Shake and Discharge" (20 + 10) are the representatives;
// ~15 catalog prints share the shape (Pawmot, Bellibolt, Decidueye ex, Palafin, …).

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Setup with BOTH Actives pinned to fix-bigbody (200 HP, empty Bench — so the
    Defender survives the main hit and the Bench holds only what a test places),
    then open P1's turn 2 (P2 went first) — P1's first unrestricted turn. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ALSO_SNIPE_DECK, p2: ALSO_SNIPE_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` (displacing its fix-bigbody to its own Bench) with `energy`
    Lightning attached; P2 keeps its fix-bigbody Defender and its Bench holds exactly
    `benched` (index 0 first, the rider's targets). */
function alsoSnipe(
  seed: number,
  opts: { attacker: string; energy: number; benched: readonly string[] },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", opts.attacker);
  state = attachFromDeck(state, "p1", "fix-lightning-energy", opts.energy);
  for (const body of opts.benched) state = benchFromDeck(state, "p2", body);
  return state;
}

describe("deriveAttackEffect — the flat benched-snipe rider ('also does N to 1 Benched')", () => {
  it("reads the rider as a count-1 deals snipe with NO perTakenPrize (a fixed N)", () => {
    expect(
      deriveAttackEffect(
        "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "damageChosen", target: "opponentBench", amount: 30, count: 1, deals: true }]);
  });

  it("the W/R clarifier tail is OPTIONAL, and the amount is CAPTURED (10, 60)", () => {
    expect(
      deriveAttackEffect("This attack also does 10 damage to 1 of your opponent's Benched Pokémon."),
    ).toEqual([{ op: "damageChosen", target: "opponentBench", amount: 10, count: 1, deals: true }]);
    expect(
      deriveAttackEffect("This attack also does 60 damage to 1 of your opponent's Benched Pokémon."),
    ).toEqual([{ op: "damageChosen", target: "opponentBench", amount: 60, count: 1, deals: true }]);
  });

  it("REFUSES the near-misses — Flamigo's gate, 'each of', '2 of', 'YOUR', and a 0", () => {
    for (const text of [
      // Flamigo's "Synchronized Feathers" — a leading board-condition gate, off `^This`.
      "If Flamigo is on your Bench, this attack also does 60 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // The "each of" also-SPREAD rider (all benched) — a different op.
      "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // "2 of" — count ≠ 1.
      "This attack also does 20 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // "1 of YOUR Benched" — a self-target, not the opponent's.
      "This attack also does 20 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // A printed 0-rider adds nothing — left on the loud path.
      "This attack also does 0 damage to 1 of your opponent's Benched Pokémon.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("does not COLLIDE with Covetous Ivy's Prize-scaled clause — that keeps its perTakenPrize", () => {
    // The D57 reader owns "does N … for each Prize card your opponent has taken." (no
    // "also"); this flat reader must not steal it, so it stays a DIFFERENT op.
    expect(
      deriveAttackEffect(
        "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      ),
    ).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 60, count: 1, deals: true, perTakenPrize: true },
    ]);
  });
});

describe("the rider fires — main hit to the Defender, N to 1 chosen Benched", () => {
  it("Miraidon 'Lightning Laser': 90 to the Defender, then parks to snipe 30 on a Benched", () => {
    const state = alsoSnipe(1, {
      attacker: "sv01-080",
      energy: 3,
      benched: ["fix-bigbody", "fix-bigbody"], // 2 → a real count-1 choice
    });
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // The main hit landed FIRST (§8 printed order), on the Defender.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 90, dealt: 90 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // …then the rider asks WHICH Benched Pokémon.
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.max).toBe(1);
    expect(prompt.note).toContain("30 damage");
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    // The rider is DAMAGE_DEALT (not a counter), flat, on the chosen Benched.
    expect(types(e2)).not.toContain("COUNTERS_PLACED");
    expect(find(e2, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 30, weakness: null, dealt: 30 });
    expect(done.players.p2.active?.damage).toBe(90);
    expect(done.players.p2.bench[0]?.damage).toBe(30);
    expect(done.players.p2.bench[1]?.damage).toBe(0);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("auto-takes the rider on a Bench of exactly 1 — both hits in one action", () => {
    const state = alsoSnipe(2, { attacker: "sv01-080", energy: 3, benched: ["fix-bigbody"] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const dealt = findAll(events, "DAMAGE_DEALT");
    expect(dealt.map((d) => d.base).sort((a, b) => a - b)).toEqual([30, 90]);
    expect(done.players.p2.active?.damage).toBe(90);
    expect(done.players.p2.bench[0]?.damage).toBe(30);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("captures the amount, not a literal 30 — Tadbulb's rider is 10 (main 20)", () => {
    const state = alsoSnipe(3, { attacker: "sv03-076", energy: 2, benched: ["fix-bigbody"] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = findAll(events, "DAMAGE_DEALT");
    expect(dealt.map((d) => d.base).sort((a, b) => a - b)).toEqual([10, 20]);
    expect(done.players.p2.bench[0]?.damage).toBe(10);
  });

  it("the main hit still lands when the opponent has no Bench — the rider just whiffs", () => {
    const state = alsoSnipe(4, { attacker: "sv01-080", energy: 3, benched: [] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, dealt: 90 });
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(1); // main only, no rider
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the rider KOs a lethally-hit Benched Pokémon through the attack epilogue", () => {
    // fix-victim (30 HP) benched: Miraidon's 30 rider is lethal. The KO is swept by
    // finishAttack, p1 takes a Prize, then the turn ends.
    const state = alsoSnipe(5, { attacker: "sv01-080", energy: 3, benched: ["fix-victim"] });
    const victimUid = benchTopUid(state, "p2", 0);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(victimUid);
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p2.bench).toHaveLength(0);
  });

  it("never mutates the state it was given (purity — through the auto-take rider)", () => {
    const state = alsoSnipe(6, { attacker: "sv01-080", energy: 3, benched: ["fix-bigbody"] });
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 1 })).not.toThrow();
  });
});
