import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackEffect } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  ANY_SNIPE_DECK,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.38.0 → 0.39.0 — the ANY-target snipe family.
//
// "This attack does N damage to 1 of your opponent's Pokémon. (Don't apply Weakness
// and Resistance for Benched Pokémon.)" is the WHOLE attack (no `damage` field) — a
// chosen hit on the Active OR a Bench. `damageChosen` gained `target: "opponentAny"`
// (candidates = the opponent's Active + Bench); `placeSnipe` an Active arm that runs
// the §8.5 W/R pipeline, because Weakness/Resistance apply ONLY to the Active — a
// Benched pick stays flat. Rotom sv01-069 "Linear Attack" (Lightning, 20) is the W/R
// witness: 40 on a {L}-weak ACTIVE, 20 on the SAME body Benched. Fezandipiti ex
// sv06.5-038 "Cruel Arrow" (Darkness, 100) is the big flat twin.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup with BOTH Actives pinned to fix-lightning-weak (×2 Lightning, 130 HP, empty
    Bench — a deterministic Defender that is the W/R target), then open P1's turn 2. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ANY_SNIPE_DECK, p2: ANY_SNIPE_DECK },
    { first: "p2", active: { p1: "fix-lightning-weak", p2: "fix-lightning-weak" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with `energy` attached; P2 keeps its fix-lightning-weak
    Active and its Bench holds exactly `benched`. */
function anySnipe(
  seed: number,
  opts: { attacker: string; energy: number; benched: readonly string[] },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", opts.attacker);
  state = attachFromDeck(state, "p1", "fix-lightning-energy", opts.energy);
  for (const body of opts.benched) state = benchFromDeck(state, "p2", body);
  return state;
}

describe("deriveAttackEffect — the any-target snipe ('does N to 1 of your opponent's Pokémon')", () => {
  it("reads it as a count-1 deals damageChosen with target opponentAny", () => {
    expect(
      deriveAttackEffect(
        "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "damageChosen", target: "opponentAny", amount: 20, count: 1, deals: true }]);
  });

  it("the W/R clarifier tail is OPTIONAL, and the amount is CAPTURED (100)", () => {
    expect(
      deriveAttackEffect("This attack does 100 damage to 1 of your opponent's Pokémon."),
    ).toEqual([{ op: "damageChosen", target: "opponentAny", amount: 100, count: 1, deals: true }]);
  });

  it("REFUSES the other 'to 1 … Pokémon' shapes — Umbreon, a discard cost, a coin flip, a 0", () => {
    for (const text of [
      // Umbreon "Feint Attack" — a DIFFERENT W/R-immunity tail (not the paren clause).
      "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
      // Pawmot ex "Levin Strike" — a leading discard cost, off `^This attack does`.
      "Discard 2 {L} Energy from this Pokémon. This attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // Magikarp "Jump" — a leading coin flip.
      "Flip a coin. If heads, this attack does 10 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // A printed 0.
      "This attack does 0 damage to 1 of your opponent's Pokémon.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("does not COLLIDE with the BENCHED snipes — those name the zone and keep opponentBench", () => {
    // "Benched Pokémon" is the opponentBench family (D57/D58); the any-target reader
    // names just "Pokémon", so it must not steal them — they stay a DIFFERENT target.
    expect(
      deriveAttackEffect(
        "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      ),
    ).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 60, count: 1, deals: true, perTakenPrize: true },
    ]);
    expect(
      deriveAttackEffect(
        "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "damageChosen", target: "opponentBench", amount: 30, count: 1, deals: true }]);
  });
});

describe("the any-target snipe — W/R applies on the Active, never on the Bench", () => {
  it("snipes the ACTIVE and DOUBLES for its Weakness (§8.5) — Rotom's 20 → 40", () => {
    // p2's only Pokémon is its fix-lightning-weak Active (empty Bench), so the count-1
    // snipe auto-takes it. Rotom is Lightning, the Active is ×2 Lightning → 20 × 2 = 40.
    const state = anySnipe(1, { attacker: "sv01-069", energy: 1, benched: [] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 20,
      weakness: { op: "multiply", amount: 2 },
      dealt: 40,
    });
    expect(done.players.p2.active?.damage).toBe(40);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("snipes the SAME weak body on the BENCH and stays FLAT — 20, no Weakness", () => {
    // The discriminating half: the identical ×2 Lightning body, Benched, takes the
    // printed 20 (§8.5 — W/R never apply to Bench). The Active is left untouched.
    const state = anySnipe(2, { attacker: "sv01-069", energy: 1, benched: ["fix-lightning-weak"] });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    // The Active is a candidate too (opponentAny), leading the Bench.
    expect(prompt.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.candidates[1]).toMatchObject({ seat: "p2", spot: { spot: "bench", index: 0 } });
    expect(prompt.note).toContain("of your opponent's Pokémon"); // not "Benched Pokémon"
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(find(e2, "DAMAGE_DEALT")).toMatchObject({ base: 20, weakness: null, dealt: 20 });
    expect(done.players.p2.bench[0]?.damage).toBe(20);
    expect(done.players.p2.active?.damage).toBe(0); // the Active was NOT the pick
  });

  it("a non-weak Active takes the FLAT amount — Fezandipiti's Darkness 100, no double", () => {
    // Fezandipiti is Darkness; the Active is ×2 Lightning, NOT Darkness — so no
    // Weakness fires and 100 lands flat (210 HP body attacking a 130 HP one survives).
    // Pins the amount ≠ Rotom's 20 and that Weakness only fires on a real match.
    const state = anySnipe(3, { attacker: "sv06.5-038", energy: 3, benched: [] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, weakness: null, dealt: 100 });
    expect(done.players.p2.active?.damage).toBe(100);
  });

  it("KOs a sniped Benched Pokémon through the attack epilogue, then ends the turn", () => {
    // Fezandipiti's 100 on a benched fix-victim (30 HP) is lethal; the KO is swept by
    // finishAttack, p1 takes a Prize, the turn ends.
    const state = anySnipe(4, { attacker: "sv06.5-038", energy: 3, benched: ["fix-victim"] });
    const victimUid = benchTopUid(state, "p2", 0);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] }, // the benched victim
    });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(victimUid);
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p2.bench).toHaveLength(0);
  });

  it("adds the attacker's pre-W/R bonus on the Active — Vitality Band's +10, INSIDE Weakness", () => {
    // Vitality Band ("+10 to your opponent's Active, before W/R") DOES apply to an
    // Active snipe: (20 + 10) × 2 = 60, the bonus landing inside the weakness multiply
    // exactly as attack.ts's main hit — where a Benched target would never get it.
    let state = anySnipe(6, { attacker: "sv01-069", energy: 1, benched: [] });
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      bonus: 10,
      weakness: { op: "multiply", amount: 2 },
      dealt: 60, // (20 + 10) × 2, NOT 20×2 + 10 = 50
    });
  });

  it("never mutates the state it was given (purity — through the active-snipe W/R arm)", () => {
    const state = anySnipe(5, { attacker: "sv01-069", energy: 1, benched: [] });
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});
