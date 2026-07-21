import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  SNIPE_DECK,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handToDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setPrizes,
  types,
} from "./testFixtures";

// M4 slice 8 — the mid-turn-damage snipe (§9): a damaging Ability that puts
// counters on CHOSEN opponent Benched Pokémon and can Knock one Out MID-TURN
// (the actor keeps their turn). Two representatives:
//   • Hawlucha "Flying Entry" — a TRIGGERED Ability (onPlayToBench) that chooses
//     2 of the opponent's Benched Pokémon, 1 counter each (parks on a MULTI-
//     Pokémon prompt when the opponent has >2 Benched, forced otherwise);
//   • Meowscarada ex "Bouquet Magic" — an ACTIVATED Ability with the engine's
//     first activation COST (discard a Basic {G} Energy), 3 counters on 1 of the
//     opponent's Benched Pokémon.
// The KO sweep lives in the shared settleProgram (flow.ts): a completed board
// program that placed lethal damage resolves through resolveMidTurnKnockOuts.

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

/** p1 (going first) and p2 both on SNIPE_DECK with fix-basic-1 Actives, on
    turn 1 (the returned state). The opponent's Bench — the snipe targets — is
    surgery-placed per test. Playing a Basic to the Bench / using an Ability are
    legal on turn 1, and the opponent's setup Bench is a legal target. */
function snipeBoard(seed: number): GameState {
  return driveSetup(
    seed,
    { p1: SNIPE_DECK, p2: SNIPE_DECK },
    { first: "p1", active: { p1: "fix-basic-1", p2: "fix-basic-1" } },
  );
}

const SEED = 4;

// ── Hawlucha "Flying Entry" — onPlayToBench, choose 2 ────────────────────────

describe("Hawlucha's Flying Entry — the onPlayToBench multi-snipe (§9)", () => {
  it("parks on the multi-Pokémon choice when the opponent has >2 Benched", () => {
    let state = snipeBoard(SEED);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1"); // 3 → a real choice of 2
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const uid = handUid(state, "p1", "sv01-118");
    const { state: parked, events } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    // The bench play AND the auto-fired trigger land in the one batch.
    expect(types(events)).toContain("POKEMON_BENCHED");
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Flying Entry");
    expect(types(events)).toContain("EFFECT_PENDING");
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.max).toBe(2);
    // Every candidate is one of the OPPONENT's Benched Pokémon.
    expect(prompt.candidates).toHaveLength(3);
    for (const c of prompt.candidates) {
      expect(c.seat).toBe("p2");
      expect(c.spot.spot).toBe("bench");
    }
    // Pick 2 → 1 damage counter (10 HP) on each; back to turn:action.
    const pick = prompt.candidates.slice(0, 2);
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: pick },
    });
    const counters = findAll(e2, "COUNTERS_PLACED");
    expect(counters).toHaveLength(2);
    for (const c of counters) {
      expect(c.amount).toBe(10);
      expect(c.seat).toBe("p2");
      expect(c.source).toBe("ability");
    }
    expect(done.phase.kind).toBe("turn:action");
    // Exactly the two chosen benched took 10; the third is untouched.
    expect(done.players.p2.bench.filter((p) => p.damage === 10)).toHaveLength(2);
    expect(done.players.p2.bench.filter((p) => p.damage === 0)).toHaveLength(1);
  });

  it("is forced (no park) when the opponent has exactly 2 Benched — both take it", () => {
    let state = snipeBoard(SEED);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1"); // exactly 2 → both hit
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const uid = handUid(state, "p1", "sv01-118");
    const { state: done, events } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Flying Entry");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(2);
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p2.bench.every((p) => p.damage === 10)).toBe(true);
  });

  it("whiffs harmlessly when the opponent has no Bench (auto-fired, no counters)", () => {
    let state = snipeBoard(SEED); // p2 has only its Active
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const uid = handUid(state, "p1", "sv01-118");
    const { state: done, events } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    // The Ability still triggered (auto-fire), but there was nothing to snipe.
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Flying Entry");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("KOs a lethally-sniped Benched Pokémon MID-TURN and resumes the actor's turn", () => {
    let state = snipeBoard(SEED);
    // A 30 HP body at 20 damage: the 10 counter is lethal. A second benched
    // body (60 HP) makes the snipe forced (2 Benched → both take 10, only the
    // victim dies).
    state = benchFromDeck(state, "p2", "fix-victim");
    state = setBenchDamage(state, "p2", 0, 20);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    const victimUid = benchTopUid(state, "p2", 0);
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const uid = handUid(state, "p1", "sv01-118");
    const { state: after, events } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(victimUid);
    // The KOing player (p1, the actor) parks on their prize pick (1 of 6).
    expect(after.phase.kind).toBe("ko:takePrizes");
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p1");
    // Take the prize → the turn comes BACK to p1 (resumeTurn), not the opponent.
    const { state: resumed } = mustApply(after, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    });
    expect(resumed.phase.kind).toBe("turn:action");
    if (resumed.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(resumed.phase.seat).toBe("p1");
    expect(resumed.players.p1.prizes).toHaveLength(5);
    // The surviving benched body kept its 10; the KO'd one is gone (bench dense).
    expect(resumed.players.p2.bench).toHaveLength(1);
    expect(resumed.players.p2.bench[0]?.damage).toBe(10);
  });

  it("wins the game (§14.1) when the snipe KO takes the actor's last prize", () => {
    let state = snipeBoard(SEED);
    state = setPrizes(state, "p1", 1); // p1 one prize from victory
    state = benchFromDeck(state, "p2", "fix-victim");
    state = setBenchDamage(state, "p2", 0, 20); // +10 = lethal
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const uid = handUid(state, "p1", "sv01-118");
    const { state: after, events } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    // The lone prize is forced, so the whole KO auto-resolves into a win.
    const over = find(events, "GAME_OVER");
    expect(over?.outcome).toEqual({ result: "win", winner: "p1", reason: "prizesTaken" });
    expect(after.phase.kind).toBe("gameOver");
  });

  it("honours 'up to' — the player may pick fewer than the max", () => {
    let state = snipeBoard(SEED);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1"); // 3 → parks with max 2
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const uid = handUid(state, "p1", "sv01-118");
    const { state: parked } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    // Pick only 1 of the 2 allowed.
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(1);
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p2.bench.filter((p) => p.damage === 10)).toHaveLength(1);
  });

  it("may decline entirely — pick none ('you may')", () => {
    let state = snipeBoard(SEED);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const uid = handUid(state, "p1", "sv01-118");
    const { state: parked } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [] },
    });
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p2.bench.every((p) => p.damage === 0)).toBe(true);
  });

  it("rejects an illegal multi-choice (too many / not a candidate / duplicate / wrong kind)", () => {
    let state = snipeBoard(SEED);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const uid = handUid(state, "p1", "sv01-118");
    const { state: parked } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const legal = prompt.candidates[0] as PokemonRef;
    // More than max (2).
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: prompt.candidates } },
      "BAD_EFFECT_CHOICE",
    );
    // A ref that is not a candidate (the opponent's Active).
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // The same Pokémon twice.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [legal, legal] } },
      "BAD_EFFECT_CHOICE",
    );
    // The wrong choice shape (single-Pokémon where a multi is expected).
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: legal } },
      "BAD_EFFECT_CHOICE",
    );
  });
});

// ── Meowscarada ex "Bouquet Magic" — activated, {G}-discard cost, choose 1 ────

describe("Meowscarada's Bouquet Magic — the activated snipe with a cost (§9)", () => {
  it("discards a Basic {G} Energy and parks on the single-target choice", () => {
    let state = snipeBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv02-015"); // Meowscarada Active
    state = handFromDeck(state, "p1", "fix-grass-energy", 1);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = benchFromDeck(state, "p2", "fix-basic-1"); // 2 → a choice of 1
    const grassUid = handUid(state, "p1", "fix-grass-energy");
    const { state: parked, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Bouquet Magic",
    });
    expect(find(events, "ABILITY_USED")?.ability).toBe("Bouquet Magic");
    // The cost is now the Ability program's first op (discardFromHandCost), so
    // it announces HAND_COST_PAID — and, its candidates being interchangeable
    // Basic {G} Energy, it resolves without a prompt of its own, exactly as the
    // pre-op `AbilityCost` field did.
    const paid = find(events, "HAND_COST_PAID");
    expect(paid?.uids).toEqual([grassUid]);
    // The Energy left hand for the discard pile.
    expect(parked.players.p1.hand).not.toContain(grassUid);
    expect(parked.players.p1.discard).toContain(grassUid);
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.max).toBe(1);
    // Pick 1 → 3 damage counters (30 HP).
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(find(e2, "COUNTERS_PLACED")?.amount).toBe(30);
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p2.bench.filter((p) => p.damage === 30)).toHaveLength(1);
  });

  it("is forced (no park) when the opponent has exactly 1 Benched Pokémon", () => {
    let state = snipeBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv02-015");
    state = handFromDeck(state, "p1", "fix-grass-energy", 1);
    state = benchFromDeck(state, "p2", "fix-basic-1"); // exactly 1 → forced
    const { state: done, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Bouquet Magic",
    });
    // Names the card, not just the count: the FILTER is what this pins (a Basic
    // {G} Energy was paid, not merely "something"), which is what the removed
    // ABILITY_COST_PAID.energyType assertion used to carry.
    expect(find(events, "HAND_COST_PAID")?.uids).toEqual([
      handUid(state, "p1", "fix-grass-energy"),
    ]);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(30);
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p2.bench[0]?.damage).toBe(30);
  });

  it("rejects (ABILITY_COST_UNMET) with no Basic {G} Energy in hand — nothing paid", () => {
    let state = snipeBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv02-015");
    state = handToDeck(state, "p1", "fix-grass-energy"); // ensure none in hand
    state = benchFromDeck(state, "p2", "fix-basic-1"); // a legal target exists
    expectErr(
      state,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Bouquet Magic" },
      "ABILITY_COST_UNMET",
    );
  });

  it("rejects (NO_LEGAL_TARGET) with an empty opponent Bench — before paying the cost", () => {
    let state = snipeBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv02-015");
    state = handFromDeck(state, "p1", "fix-grass-energy", 1); // payable, but no target
    expectErr(
      state,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Bouquet Magic" },
      "NO_LEGAL_TARGET",
    );
  });

  it("is once per turn (ABILITY_ALREADY_USED on a second use)", () => {
    let state = snipeBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv02-015");
    state = handFromDeck(state, "p1", "fix-grass-energy", 2);
    state = benchFromDeck(state, "p2", "fix-basic-1"); // 60 HP survives the 30
    const { state: after } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Bouquet Magic",
    });
    // A second use is blocked at the once-per-turn gate (before the cost).
    expectErr(
      after,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Bouquet Magic" },
      "ABILITY_ALREADY_USED",
    );
  });

  it("fires from the Bench (Bouquet Magic is not Active-only)", () => {
    let state = snipeBoard(SEED);
    state = benchFromDeck(state, "p1", "sv02-015"); // Meowscarada benched at index 0
    state = handFromDeck(state, "p1", "fix-grass-energy", 1);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    const { state: done, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Bouquet Magic",
    });
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(30);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("KOs a lethally-sniped Benched Pokémon mid-turn and resumes the actor's turn", () => {
    let state = snipeBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv02-015");
    state = handFromDeck(state, "p1", "fix-grass-energy", 1);
    state = benchFromDeck(state, "p2", "fix-victim"); // 30 HP: the 30 is lethal
    const victimUid = benchTopUid(state, "p2", 0);
    const { state: after, events } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Bouquet Magic",
    });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(victimUid);
    expect(after.phase.kind).toBe("ko:takePrizes");
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p1");
    const { state: resumed } = mustApply(after, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    });
    expect(resumed.phase.kind).toBe("turn:action");
    if (resumed.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(resumed.phase.seat).toBe("p1");
    expect(resumed.players.p1.prizes).toHaveLength(5);
    expect(resumed.players.p2.bench).toHaveLength(0);
  });
});

// ── Purity ──────────────────────────────────────────────────────────────────

describe("the snipe — purity (never mutate the input)", () => {
  it("a triggered snipe does not mutate the frozen prior state", () => {
    let state = snipeBoard(SEED);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = handFromDeck(state, "p1", "sv01-118", 1);
    const uid = handUid(state, "p1", "sv01-118");
    deepFreeze(state);
    expect(() => applyAction(state, { type: "playBasicToBench", seat: "p1", uid })).not.toThrow();
  });

  it("an activated snipe (with its cost) does not mutate the frozen prior state", () => {
    let state = snipeBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv02-015");
    state = handFromDeck(state, "p1", "fix-grass-energy", 1);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    deepFreeze(state);
    expect(() =>
      applyAction(state, {
        type: "useAbility",
        seat: "p1",
        target: { spot: "active" },
        abilityName: "Bouquet Magic",
      }),
    ).not.toThrow();
  });
});
