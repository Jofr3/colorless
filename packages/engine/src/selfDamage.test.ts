import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackEffect } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  SELF_DAMAGE_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
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
  const state = driveSetup(seed, { p1: SELF_DAMAGE_DECK, p2: SELF_DAMAGE_DECK }, { first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function matchup(seed: number, defenderId: string): GameState {
  let state = p1Turn2(seed);
  state = setActiveFromDeck(state, "p1", "sv01-038");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 2); // {R}{R}
  state = attachFromDeck(state, "p1", "fix-energy", 1); // {C}
  state = setActiveFromDeck(state, "p2", defenderId);
  state = onlyBench(state, "p1", "fix-basic-1");
  state = onlyBench(state, "p2", "fix-basic-1");
  return state;
}

/** Reset `seat`'s bench to EXACTLY one `id`. */
function onlyBench(state: GameState, seat: "p1" | "p2", id: string): GameState {
  const cleared: GameState = {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], bench: [] } },
  };
  return benchFromDeck(cleared, seat, id);
}

const BLAZING_SHOUT = { index: 1 } as const; // attack 0 is Passionate Singing

describe("damageSelf — the derived recoil op", () => {
  it("derives 'This Pokémon also does N damage to itself.' for any N", () => {
    expect(deriveAttackEffect("This Pokémon also does 30 damage to itself.")).toEqual([
      { op: "damageSelf", amount: 30 },
    ]);
    // Not hard-coded to 30 — the count is captured.
    expect(deriveAttackEffect("This Pokémon also does 10 damage to itself.")).toEqual([
      { op: "damageSelf", amount: 10 },
    ]);
  });

  it("refuses the near-misses — the anchors are load-bearing, both of them", () => {
    for (const text of [
      "This attack does 30 damage to itself.",
      "This Pokémon also does 30 damage to each of your opponent's Benched Pokémon.",
      // A printed 0 is not a real card — left loud, not derived to a no-op.
      "This Pokémon also does 0 damage to itself.",
      // Leading text with a CAPITAL "This" pins `^`: drop the start anchor and
      // the sentence matches as a substring here (so it would wrongly derive).
      "Draw a card. This Pokémon also does 30 damage to itself.",
      // Trailing text pins `$`: dropping the end anchor would match this.
      "This Pokémon also does 30 damage to itself. Draw a card.",
      // A lowercase "this" is refused independently of the anchors — no /i, and
      // the capital is half of what keeps a mid-sentence clause off the derived
      // path (the family's Krookodile convention; the anchors are the other half).
      "Then this Pokémon also does 30 damage to itself.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(deriveAttackEffect("This Pokémon does 30 damage to itself.")).toEqual([
      { op: "damageSelf", amount: 30 },
    ]);
  });
});

describe("Blazing Shout — the recoil lands (§8, outside the W/R pipeline)", () => {
  it("does 190 to the defender and 30 to ITSELF, as COUNTERS_PLACED source 'self'", () => {
    // fix-bigbody (200 HP) survives the 190, and a fresh Skeledirge (180 HP)
    // survives its own 30 — so this isolates the placement from any KO.
    const state = matchup(1, "fix-bigbody");
    const skeledirge = activeUid(state, "p1");
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BLAZING_SHOUT.index,
    });

    // The recoil is SIMULATED, not flagged as skipped.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(190);
    const recoil = findEvent(events, "COUNTERS_PLACED");
    expect(recoil).toMatchObject({ seat: "p1", uid: skeledirge, amount: 30, source: "self" });
    // Main damage lands BEFORE the recoil (§8 printed order — the effect program
    // runs after the numeric damage).
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("COUNTERS_PLACED"));
    expect(after.players.p1.active?.damage).toBe(30);
    expect(after.players.p2.active?.damage).toBe(190);
    // Nobody was Knocked Out; the turn simply ends.
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(types(events)).toContain("TURN_ENDED");
  });
});

describe("the two-seat sweep — a self-KO the old single-seat sweep would miss", () => {
  it("Knocks Out the ATTACKER on recoil and prizes it to the DEFENDER (§8.1)", () => {
    // Skeledirge one hit from death (150 of 180); the 30 recoil finishes it.
    // The defender is fix-bigbody (200 HP), so it SURVIVES the 190 — only the
    // attacker's own board goes lethal, the case the single-seat sweep dropped.
    let state = matchup(2, "fix-bigbody");
    state = setDamage(state, "p1", 150);
    const skeledirge = activeUid(state, "p1");
    const promoted = benchTopUid(state, "p1", 0);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BLAZING_SHOUT.index,
    });

    const ko = findEvent(events, "KNOCKED_OUT");
    expect(ko).toMatchObject({ seat: "p1", uid: skeledirge });
    expect(after.players.p1.discard).toContain(skeledirge);
    // The prize is owed to the DEFENDER (p2) — the opponent of the KO'd side,
    // exactly as the confusion self-hit's is.
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(after.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);

    // Drive it out: p2 takes the prize, p1 force-promotes its lone bench body,
    // and the turn passes to p2. The defender never took a lethal hit.
    const next = must(applyAction(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    expect(next.players.p2.prizes.length).toBe(5); // p2 took 1 of 6
    expect(activeUid(next, "p1")).toBe(promoted);
    expect(next.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("resolves the both-boards DOUBLE KO prizes-first, the ATTACKER's prize first (§8.1)", () => {
    // The 190 KOs the 30-HP defender (prize → p1) AND the 30 recoil KOs the
    // primed Skeledirge (prize → p2): both boards lose their Active at once.
    let state = matchup(3, "fix-victim");
    state = setDamage(state, "p1", 150);
    const skeledirge = activeUid(state, "p1");
    const victim = activeUid(state, "p2");
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BLAZING_SHOUT.index,
    });

    expect(
      events
        .filter((e) => e.type === "KNOCKED_OUT")
        .map((e) => (e as Extract<GameEvent, { type: "KNOCKED_OUT" }>).uid)
        .sort(),
    ).toEqual([skeledirge, victim].sort());
    // §8.1 — "the player whose turn it is takes their Prizes first": the
    // attacker's prize (for the defender KO) is queued ahead of the defender's
    // (for the self-KO), then the promotions, all before the turn ends.
    expect(after.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "takePrizes",
      "promote",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });

    // p1 takes first, then p2; both benches auto-promote their lone body and the
    // turn passes to p2. Each side took exactly one prize.
    let next = must(applyAction(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    expect(next.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    next = must(applyAction(next, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    expect(next.players.p1.prizes.length).toBe(5);
    expect(next.players.p2.prizes.length).toBe(5);
    expect(next.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("is a §14 TIE when the double KO takes BOTH players' last prize, and both are taken (COR-P0E)", () => {
    let state = matchup(4, "fix-victim");
    state = setDamage(state, "p1", 150);
    state = setPrizes(state, "p1", 1);
    state = setPrizes(state, "p2", 1);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BLAZING_SHOUT.index,
    });

    // Both cards still leave play (the KOs are real), each player takes their last
    // Prize, and the game ends a TIE: both sides win by the SAME reason, which is
    // what makes it a tie.
    expect(events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(2);
    expect(findEvent(events, "GAME_OVER")?.outcome).toEqual({
      result: "tie",
      reasons: { p1: "prizesTaken", p2: "prizesTaken" },
    });
    expect(after.phase.kind).toBe("gameOver");
    expect(after.players.p1.prizes).toEqual([]);
    expect(after.players.p2.prizes).toEqual([]);
    expect(events.filter((e) => e.type === "PRIZES_TAKEN").map((e) => e.seat)).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("LOSES the attacker (§14.2) at once when the recoil KOs its LAST Pokémon (COR-P0E)", () => {
    let state = matchup(6, "fix-bigbody");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = setDamage(state, "p1", 150);
    const { state: over, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BLAZING_SHOUT.index,
    });

    // p1's empty board decides the game before p2's Prize pick for the self-KO.
    expect(findEvent(events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p2",
      reason: "noPokemon",
    });
    expect(over.phase.kind).toBe("gameOver");
  });

  it("never mutates the state it was given (purity)", () => {
    let state = matchup(5, "fix-victim");
    state = setDamage(state, "p1", 150);
    deepFreeze(state);
    expect(() =>
      applyAction(state, { type: "attack", seat: "p1", index: BLAZING_SHOUT.index }),
    ).not.toThrow();
  });
});
