import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackEffect } from "./index";
import type { GameState, RetreatAction, Seat } from "./index";
import { flipCoin } from "./rng";
import {
  SCALED_DAMAGE_DECK,
  activeUid,
  attachFromDeck,
  deckOf,
  deepFreeze,
  driveSetup,
  expectErr,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  setPrizes,
  types,
} from "./testFixtures";

// Special Conditions (§12) and the Pokémon Checkup (§13). Seeds found by
// deterministic scan: none of the deck pairs below mulligan, so the rng
// state after driveSetup — and with it the faces of the next coin flips —
// depends on the seed alone. The next flips are:
//   seed 2 → heads, heads   seed 10 → tails, tails   seed 6 → heads, tails
const HEADS = 2;
const TAILS = 10;
const HEADS_THEN_TAILS = 6;

/** Attackless 120 HP walls + energy — the surgery-conditioned checkup boards. */
const WALL_DECK = deckOf({ "fix-wall": 40, "fix-energy": 20 });
/** The M2 attacker (Bite = index 0) — status-gate and confusion boards. */
const ATTACKER_DECK = deckOf({ "fix-attacker": 30, "fix-fire-energy": 30 });
/** The M3 statuser — one derivable effect sentence per attack. */
const STATUSER_DECK = deckOf({ "fix-statuser": 40, "fix-energy": 20 });

/** Two walls facing off on p1's turn 1; each test surgically applies its
    conditions (setConditions) — walls can't inflict any. */
function walls(seed: number, bench: { p1?: number; p2?: number } = {}): GameState {
  return driveSetup(
    seed,
    { p1: WALL_DECK, p2: WALL_DECK },
    {
      first: "p1",
      active: { p1: "fix-wall", p2: "fix-wall" },
      bench: {
        p1: Array.from({ length: bench.p1 ?? 0 }, () => "fix-wall"),
        p2: Array.from({ length: bench.p2 ?? 0 }, () => "fix-wall"),
      },
    },
  );
}

/** p1's fix-attacker (1 Fire attached — Bite is payable, retreat too) vs
    p2's wall, on p1's turn 3, past the §4 first-turn ban. No flips have
    been consumed: the seed's first face decides the confusion check. */
function attackerBoard(seed: number, bench: { p1?: number; p2?: number } = {}): GameState {
  let state = driveSetup(
    seed,
    { p1: ATTACKER_DECK, p2: WALL_DECK },
    {
      first: "p1",
      active: { p1: "fix-attacker", p2: "fix-wall" },
      bench: {
        p1: Array.from({ length: bench.p1 ?? 0 }, () => "fix-attacker"),
        p2: Array.from({ length: bench.p2 ?? 0 }, () => "fix-wall"),
      },
    },
  );
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** p1's fix-statuser (costless status attacks) vs p2's wall on p1's turn 3.
    Attack indices: 0 Hypnosis, 1 Confuse Ray, 2 Numbing Bolt, 3 Overheat,
    4 Rest, 5 Toxic, 6 Lullaby (testFixtures). */
function statuserBoard(seed: number, bench: { p2?: number } = {}): GameState {
  let state = driveSetup(
    seed,
    { p1: STATUSER_DECK, p2: WALL_DECK },
    {
      first: "p1",
      active: { p1: "fix-statuser", p2: "fix-wall" },
      bench: { p2: Array.from({ length: bench.p2 ?? 0 }, () => "fix-wall") },
    },
  );
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** Retreat paying with everything attached (the boards attach exactly the
    retreat cost), promoting bench[0]. */
function retreatAction(state: GameState, seat: Seat): RetreatAction {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return { type: "retreat", seat, discardEnergy: [...active.energy], promoteBenchIndex: 0 };
}

describe("checkup: poison (§13.1)", () => {
  it("ticks both Actives for their own poison amount, the ended seat first", () => {
    let state = walls(TAILS);
    state = setConditions(state, "p1", { poisonDamage: 10 });
    state = setConditions(state, "p2", { poisonDamage: 30 });
    const p1Uid = activeUid(state, "p1");
    const p2Uid = activeUid(state, "p2");
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).toEqual([
      "TURN_ENDED",
      "COUNTERS_PLACED",
      "COUNTERS_PLACED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(events[1]).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: p1Uid,
      amount: 10,
      source: "poison",
    });
    expect(events[2]).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: p2Uid,
      amount: 30,
      source: "poison",
    });
    expect(done.players.p1.active?.damage).toBe(10);
    expect(done.players.p2.active?.damage).toBe(30);
    // Poison has no recovery flip — it ticks again at every checkup.
    const again = mustApply(done, { type: "endTurn", seat: "p2" });
    expect(again.state.players.p1.active?.damage).toBe(20);
    expect(again.state.players.p2.active?.damage).toBe(60);
  });
});

describe("checkup: burn (§13.2)", () => {
  it("places 20, then the cure flip — heads removes the burn", () => {
    let state = walls(HEADS);
    state = setConditions(state, "p1", { burned: true });
    const uid = activeUid(state, "p1");
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).toEqual([
      "TURN_ENDED",
      "COUNTERS_PLACED",
      "CHECKUP_COIN_FLIP",
      "STATUS_CLEARED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(events[1]).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid,
      amount: 20,
      source: "burn",
    });
    expect(events[2]).toEqual({
      type: "CHECKUP_COIN_FLIP",
      seat: "p1",
      status: "burned",
      result: "heads",
    });
    expect(events[3]).toEqual({
      type: "STATUS_CLEARED",
      seat: "p1",
      uid,
      statuses: ["burned"],
      reason: "burnCured",
    });
    expect(done.players.p1.active?.conditions.burned).toBe(false);
    expect(done.players.p1.active?.damage).toBe(20);
  });

  it("tails keeps it burning — the 20 damage lands either way", () => {
    let state = walls(TAILS);
    state = setConditions(state, "p1", { burned: true });
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).not.toContain("STATUS_CLEARED");
    expect(done.players.p1.active?.conditions.burned).toBe(true);
    expect(done.players.p1.active?.damage).toBe(20);
    // The next checkup ticks another 20 (this seed's second flip is tails too).
    const again = mustApply(done, { type: "endTurn", seat: "p2" });
    expect(again.state.players.p1.active?.damage).toBe(40);
    expect(again.state.players.p1.active?.conditions.burned).toBe(true);
  });

  it("flips per Pokémon and threads every flip back into rngState", () => {
    let state = walls(HEADS_THEN_TAILS);
    state = setConditions(state, "p1", { burned: true });
    state = setConditions(state, "p2", { burned: true });
    // The exact faces the checkup must consume, threaded by hand.
    const [face1, rng1] = flipCoin(state.rngState);
    const [face2, rng2] = flipCoin(rng1);
    expect([face1, face2]).toEqual(["heads", "tails"]);
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(events.filter((e) => e.type === "CHECKUP_COIN_FLIP")).toEqual([
      { type: "CHECKUP_COIN_FLIP", seat: "p1", status: "burned", result: "heads" },
      { type: "CHECKUP_COIN_FLIP", seat: "p2", status: "burned", result: "tails" },
    ]);
    expect(done.rngState).toBe(rng2);
    expect(done.players.p1.active?.conditions.burned).toBe(false);
    expect(done.players.p2.active?.conditions.burned).toBe(true);
  });
});

describe("checkup: asleep (§13.3)", () => {
  it("heads wakes the Pokémon up", () => {
    let state = walls(HEADS);
    state = setConditions(state, "p1", { rotation: "asleep" });
    const uid = activeUid(state, "p1");
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(events.find((e) => e.type === "CHECKUP_COIN_FLIP")).toEqual({
      type: "CHECKUP_COIN_FLIP",
      seat: "p1",
      status: "asleep",
      result: "heads",
    });
    expect(events.find((e) => e.type === "STATUS_CLEARED")).toEqual({
      type: "STATUS_CLEARED",
      seat: "p1",
      uid,
      statuses: ["asleep"],
      reason: "wokeUp",
    });
    expect(done.players.p1.active?.conditions.rotation).toBe("none");
  });

  it("tails and it sleeps on", () => {
    let state = walls(TAILS);
    state = setConditions(state, "p1", { rotation: "asleep" });
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).toContain("CHECKUP_COIN_FLIP");
    expect(types(events)).not.toContain("STATUS_CLEARED");
    expect(done.players.p1.active?.conditions.rotation).toBe("asleep");
  });
});

describe("checkup: paralysis (§13.4)", () => {
  it("clears ONLY the ended seat's Active — the opponent's rides through their own turn", () => {
    let state = walls(TAILS);
    state = setConditions(state, "p1", { rotation: "paralyzed" });
    state = setConditions(state, "p2", { rotation: "paralyzed" });
    const p1Uid = activeUid(state, "p1");
    const p1End = mustApply(state, { type: "endTurn", seat: "p1" });
    // No flip — paralysis recovery is automatic, for the ended seat alone.
    expect(types(p1End.events)).not.toContain("CHECKUP_COIN_FLIP");
    expect(p1End.events.filter((e) => e.type === "STATUS_CLEARED")).toEqual([
      {
        type: "STATUS_CLEARED",
        seat: "p1",
        uid: p1Uid,
        statuses: ["paralyzed"],
        reason: "paralysisEnded",
      },
    ]);
    expect(p1End.state.players.p1.active?.conditions.rotation).toBe("none");
    // The §12 timing note: p2 stays paralyzed through their whole turn...
    expect(p1End.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    // ...and recovers at the checkup after it.
    const p2End = mustApply(p1End.state, { type: "endTurn", seat: "p2" });
    expect(p2End.state.players.p2.active?.conditions.rotation).toBe("none");
  });
});

describe("checkup: the fixed §13 order, conditions coexisting (§12)", () => {
  it("poison, then burn + flip, then paralysis — one Pokémon, one batch", () => {
    let state = walls(TAILS); // the burn flip is tails — nothing cures
    state = setConditions(state, "p1", { rotation: "paralyzed", poisonDamage: 10, burned: true, confusionDamage: 30 });
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).toEqual([
      "TURN_ENDED",
      "COUNTERS_PLACED", // poison 10 (§13.1)
      "COUNTERS_PLACED", // burn 20 (§13.2)...
      "CHECKUP_COIN_FLIP", // ...and its cure flip (tails)
      "STATUS_CLEARED", // paralysis recovery (§13.4), no flip
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.players.p1.active?.damage).toBe(30);
    // Poison and burn coexist with (and outlive) the rotation condition.
    expect(done.players.p1.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 10,
      burned: true,
      confusionDamage: 30,
    });
  });
});

describe("status gates (§12)", () => {
  it("asleep and paralysis block attacking; confusion and poison do not", () => {
    const board = attackerBoard(HEADS);
    const bite = { type: "attack", seat: "p1", index: 0 } as const;
    expectErr(setConditions(board, "p1", { rotation: "asleep" }), bite, "STATUS_PREVENTS_ATTACK");
    expectErr(
      setConditions(board, "p1", { rotation: "paralyzed" }),
      bite,
      "STATUS_PREVENTS_ATTACK",
    );
    // Poisoned attacks fine; confused declares fine (the flip decides below).
    const poisoned = mustApply(setConditions(board, "p1", { poisonDamage: 10 }), bite);
    expect(types(poisoned.events)).toContain("DAMAGE_DEALT");
    const confused = mustApply(setConditions(board, "p1", { rotation: "confused" }), bite);
    expect(types(confused.events)).toContain("DAMAGE_DEALT"); // this seed flips heads
  });

  it("asleep and paralysis block retreating; confusion does not", () => {
    const board = attackerBoard(HEADS, { p1: 1 });
    const action = retreatAction(board, "p1");
    expectErr(
      setConditions(board, "p1", { rotation: "asleep" }),
      action,
      "STATUS_PREVENTS_RETREAT",
    );
    expectErr(
      setConditions(board, "p1", { rotation: "paralyzed" }),
      action,
      "STATUS_PREVENTS_RETREAT",
    );
    const { events } = mustApply(setConditions(board, "p1", { rotation: "confused" }), action);
    expect(types(events)).toEqual(["RETREATED", "STATUS_CLEARED"]);
  });
});

describe("confusion at attack time (§8 step 3, §12)", () => {
  it("heads: the attack resolves normally", () => {
    const board = setConditions(attackerBoard(HEADS), "p1", { rotation: "confused" });
    const { state: done, events } = mustApply(board, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "CONFUSION_CHECK",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(events[1]).toEqual({
      type: "CONFUSION_CHECK",
      seat: "p1",
      uid: activeUid(board, "p1"),
      result: "heads",
    });
    expect(done.players.p2.active?.damage).toBe(30);
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("tails: the attack fails — 30 on the attacker itself, and the turn still ends", () => {
    const board = setConditions(attackerBoard(TAILS), "p1", { rotation: "confused" });
    const uid = activeUid(board, "p1");
    const { state: done, events } = mustApply(board, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "CONFUSION_CHECK",
      "ATTACK_FAILED",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(events[2]).toEqual({ type: "ATTACK_FAILED", seat: "p1", uid, reason: "confusion" });
    expect(events[3]).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid,
      amount: 30,
      source: "confusion",
    });
    expect(done.players.p1.active?.damage).toBe(30);
    expect(done.players.p2.active?.damage).toBe(0); // the defender was never touched
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // No checkup step touches confusion — it stays until cured otherwise.
    expect(done.players.p1.active?.conditions.rotation).toBe("confused");
  });

  it("tails on a damaged attacker: the self-hit KOs — the DEFENDER takes the prize", () => {
    let board = setConditions(attackerBoard(TAILS, { p1: 1 }), "p1", { rotation: "confused" });
    board = setDamage(board, "p1", 90); // 120 HP — the 30 self-hit is exactly lethal
    const uid = activeUid(board, "p1");
    const { state: parked, events } = mustApply(board, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "CONFUSION_CHECK",
      "ATTACK_FAILED",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "PRIZES_OWED",
    ]);
    expect(events[4]).toMatchObject({ type: "KNOCKED_OUT", seat: "p1", uid });
    // Nobody attacked p1 — the prize goes to its opponent (§8.1).
    expect(parked.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    // Resolving the pick auto-promotes p1's lone benched Pokémon, then the
    // turn passes through the (uneventful) checkup.
    const resolved = mustApply(parked, { type: "takePrizes", seat: "p2", prizeIndices: [0] });
    expect(types(resolved.events)).toEqual([
      "PRIZES_TAKEN",
      "POKEMON_PROMOTED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(resolved.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

describe("retreat clears conditions (§11/§12)", () => {
  it("emits one STATUS_CLEARED listing exactly what was present", () => {
    let board = attackerBoard(HEADS, { p1: 1 });
    board = setConditions(board, "p1", { rotation: "confused", poisonDamage: 20, burned: true, confusionDamage: 30 });
    const uid = activeUid(board, "p1");
    const { state: done, events } = mustApply(board, retreatAction(board, "p1"));
    expect(types(events)).toEqual(["RETREATED", "STATUS_CLEARED"]);
    expect(events[1]).toEqual({
      type: "STATUS_CLEARED",
      seat: "p1",
      uid,
      statuses: ["confused", "poisoned", "burned"],
      reason: "benched",
    });
    expect(done.players.p1.bench.at(-1)?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
  });

  it("emits no STATUS_CLEARED when there was nothing to clear", () => {
    const board = attackerBoard(HEADS, { p1: 1 });
    const { events } = mustApply(board, retreatAction(board, "p1"));
    expect(types(events)).toEqual(["RETREATED"]);
  });
});

describe("checkup Knock Outs (§13)", () => {
  it("a lethal tick KOs — prize to the opponent, promotion for the KO'd seat", () => {
    let state = walls(TAILS, { p2: 1 });
    state = setConditions(state, "p2", { poisonDamage: 120 }); // one tick = the wall's whole HP
    const uid = activeUid(state, "p2");
    const { state: parked, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).toEqual(["TURN_ENDED", "COUNTERS_PLACED", "KNOCKED_OUT", "PRIZES_OWED"]);
    expect(events[2]).toMatchObject({ type: "KNOCKED_OUT", seat: "p2", uid });
    expect(parked.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // The KO stage-pair went in FRONT of the tail's startTurn.
    expect(parked.pending.map((stage) => stage.kind)).toEqual([
      "takePrizes",
      "promote",
      "startTurn",
    ]);
    const resolved = mustApply(parked, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(types(resolved.events)).toEqual([
      "PRIZES_TAKEN",
      "POKEMON_PROMOTED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(resolved.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("a checkup KO can take the last prize — the §14.1 win, forced pick and all", () => {
    let state = setPrizes(walls(TAILS, { p2: 1 }), "p1", 1);
    state = setConditions(state, "p2", { poisonDamage: 120 });
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).toEqual([
      "TURN_ENDED",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "PRIZES_TAKEN",
      "GAME_OVER",
    ]);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
  });

  it("a checkup KO with an empty bench is the §14.2 loss", () => {
    let state = walls(TAILS);
    state = setConditions(state, "p2", { poisonDamage: 120 });
    const { state: parked } = mustApply(state, { type: "endTurn", seat: "p1" });
    // The prize pick still parks first (§8.1)...
    expect(parked.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const { state: done, events } = mustApply(parked, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [3],
    });
    // ...and the §14 check right after it sees p2's empty board.
    expect(types(events)).toEqual(["PRIZES_TAKEN", "GAME_OVER"]);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "noPokemon" },
    });
  });

  it("double KO, both boards emptying — the §14 tie, decided as one instant", () => {
    let state = walls(TAILS); // no benches on either side
    state = setConditions(state, "p1", { poisonDamage: 120 });
    state = setConditions(state, "p2", { poisonDamage: 120 });
    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).toEqual([
      "TURN_ENDED",
      "COUNTERS_PLACED",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "KNOCKED_OUT",
      "GAME_OVER",
    ]);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "tie", reasons: { p1: "noPokemon", p2: "noPokemon" } },
    });
    // Both stacks still left play; no prizes were taken for either KO.
    expect(done.players.p1.active).toBeNull();
    expect(done.players.p2.active).toBeNull();
    expect(done.players.p1.prizes).toHaveLength(6);
    expect(done.players.p2.prizes).toHaveLength(6);
    expect(done.pending).toEqual([]);
  });

  it("double KO, both on their last prize — the tie again, prize-flavored", () => {
    let state = walls(TAILS, { p1: 1, p2: 1 });
    state = setPrizes(setPrizes(state, "p1", 1), "p2", 1);
    state = setConditions(state, "p1", { poisonDamage: 120 });
    state = setConditions(state, "p2", { poisonDamage: 120 });
    const { state: done } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "tie", reasons: { p1: "prizesTaken", p2: "prizesTaken" } },
    });
  });

  it("double KO where only ONE side would win resolves stage by stage", () => {
    // p1 has no bench (their board empties); p2 promotes on. Not a tie —
    // the normal stage path runs, ended seat's KO pair first.
    let state = walls(TAILS, { p2: 1 });
    state = setConditions(state, "p1", { poisonDamage: 120 });
    state = setConditions(state, "p2", { poisonDamage: 120 });
    const { state: parked, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).toEqual([
      "TURN_ENDED",
      "COUNTERS_PLACED",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "KNOCKED_OUT",
      "PRIZES_OWED",
    ]);
    // The batch's stages are grouped PRIZES-FIRST (§8.1/§13: every prize is
    // taken before any promotion refills a board), the ended seat's KO first
    // within each kind — not interleaved per-KO pairs.
    expect(parked.pending.map((stage) => stage.kind)).toEqual([
      "takePrizes",
      "takePrizes",
      "promote",
      "promote",
      "startTurn",
    ]);
    // p2 owes the pick for p1's KO (the ended seat's KO is first)...
    expect(parked.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    const { state: done, events: resolved } = mustApply(parked, {
      type: "takePrizes",
      seat: "p2",
      prizeIndices: [0],
    });
    // ...and the §14 check right after the pick sees p1's empty board, well
    // before p1's own stage-pair would have resolved.
    expect(types(resolved)).toEqual(["PRIZES_TAKEN", "GAME_OVER"]);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p2", reason: "noPokemon" },
    });
  });
});

describe("derived attack effects in play (effects.ts)", () => {
  it("puts the defender to sleep — and the immediate checkup already flips for it", () => {
    const board = statuserBoard(TAILS);
    const uid = activeUid(board, "p2");
    const { state: done, events } = mustApply(board, { type: "attack", seat: "p1", index: 0 }); // Hypnosis
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "STATUS_APPLIED",
      "TURN_ENDED",
      "CHECKUP_COIN_FLIP", // the fresh sleep already gets its wake flip (tails)
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(events[1]).toEqual({ type: "STATUS_APPLIED", seat: "p2", uid, status: "asleep" });
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
  });

  it("a rotation status REPLACES the previous one; poison and burn ride along (§12)", () => {
    let board = statuserBoard(TAILS);
    board = setConditions(board, "p2", { rotation: "confused", poisonDamage: 10, burned: true, confusionDamage: 30 });
    const { state: done, events } = mustApply(board, { type: "attack", seat: "p1", index: 0 }); // Hypnosis
    expect(events.find((e) => e.type === "STATUS_APPLIED")).toMatchObject({ status: "asleep" });
    // Asleep replaced Confused; the checkup then ticked poison 10 + burn 20
    // (both flips tails — nothing cured).
    expect(done.players.p2.active?.conditions).toEqual({
      rotation: "asleep",
      poisonDamage: 10,
      burned: true,
      confusionDamage: 30,
    });
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("Toxic poisons for 20 a tick — the counters-instead-of-1 print", () => {
    const board = statuserBoard(TAILS);
    const uid = activeUid(board, "p2");
    const { state: done, events } = mustApply(board, { type: "attack", seat: "p1", index: 5 }); // Toxic
    expect(events.find((e) => e.type === "STATUS_APPLIED")).toEqual({
      type: "STATUS_APPLIED",
      seat: "p2",
      uid,
      status: "poisoned",
      poisonDamage: 20,
    });
    // The immediate checkup already ticked the raised amount once.
    expect(events.find((e) => e.type === "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid,
      amount: 20,
      source: "poison",
    });
    expect(done.players.p2.active?.damage).toBe(20);
    expect(done.players.p2.active?.conditions.poisonDamage).toBe(20);
  });

  it("Rest: self-sleep plus the heal, clamped at the damage present", () => {
    let board = statuserBoard(TAILS);
    board = setDamage(board, "p1", 50);
    const uid = activeUid(board, "p1");
    const { state: done, events } = mustApply(board, { type: "attack", seat: "p1", index: 4 }); // Rest
    expect(events.find((e) => e.type === "STATUS_APPLIED")).toEqual({
      type: "STATUS_APPLIED",
      seat: "p1",
      uid,
      status: "asleep",
    });
    expect(events.find((e) => e.type === "HEALED")).toEqual({
      type: "HEALED",
      seat: "p1",
      uid,
      amount: 30,
    });
    expect(done.players.p1.active?.damage).toBe(20);
    // Tails on the immediate wake flip — it sleeps on into p2's turn.
    expect(done.players.p1.active?.conditions.rotation).toBe("asleep");
  });

  it("Rest on light damage heals only what is there; on none, no HEALED at all", () => {
    let board = statuserBoard(TAILS);
    board = setDamage(board, "p1", 10);
    const light = mustApply(board, { type: "attack", seat: "p1", index: 4 });
    expect(light.events.find((e) => e.type === "HEALED")).toMatchObject({ amount: 10 });
    expect(light.state.players.p1.active?.damage).toBe(0);
    const clean = mustApply(statuserBoard(TAILS), { type: "attack", seat: "p1", index: 4 });
    expect(types(clean.events)).not.toContain("HEALED");
  });

  it("gates an effect behind its flip — heads applies it, and the §12 paralysis timing holds", () => {
    const board = statuserBoard(HEADS);
    const uid = activeUid(board, "p2");
    const { state: done, events } = mustApply(board, { type: "attack", seat: "p1", index: 2 }); // Numbing Bolt
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "STATUS_APPLIED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(events[2]).toEqual({ type: "ATTACK_EFFECT_COIN_FLIP", seat: "p1", result: "heads" });
    expect(events[3]).toEqual({ type: "STATUS_APPLIED", seat: "p2", uid, status: "paralyzed" });
    // §13.4 cleared nothing here (p1 ended the turn) — p2 is stuck for their
    // whole turn...
    expect(done.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expectErr(
      done,
      { type: "retreat", seat: "p2", discardEnergy: [], promoteBenchIndex: 0 },
      "STATUS_PREVENTS_RETREAT",
    );
    // ...and recovers at the checkup after their own turn ends.
    const after = mustApply(done, { type: "endTurn", seat: "p2" });
    expect(after.events.filter((e) => e.type === "STATUS_CLEARED")).toEqual([
      {
        type: "STATUS_CLEARED",
        seat: "p2",
        uid,
        statuses: ["paralyzed"],
        reason: "paralysisEnded",
      },
    ]);
    expect(after.state.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("gates an effect behind its flip — tails skips it, the damage still lands", () => {
    const board = statuserBoard(TAILS);
    const { state: done, events } = mustApply(board, { type: "attack", seat: "p1", index: 2 });
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
    expect(done.players.p2.active?.damage).toBe(10);
  });

  it("applies a defender status even when the same attack KOs it (order-faithful)", () => {
    let board = statuserBoard(HEADS, { p2: 1 });
    board = setDamage(board, "p2", 110); // Numbing Bolt's 10 is exactly lethal
    const uid = activeUid(board, "p2");
    const { events } = mustApply(board, { type: "attack", seat: "p1", index: 2 });
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "STATUS_APPLIED", // the paralysis lands (heads)...
      "KNOCKED_OUT", // ...and vanishes with the stack right after
      "PRIZES_OWED",
    ]);
    expect(events[3]).toEqual({ type: "STATUS_APPLIED", seat: "p2", uid, status: "paralyzed" });
  });

  it("still flags underivable text loudly — ATTACK_EFFECT_SKIPPED as before", () => {
    // Both scaling readers DERIVE (fix-attacker's Rage self-counters, 0.34.0;
    // Charizard's Prize "+", 0.35.0), so the "+"-modifier-skip witness has to be a
    // printing no reader answers.
    //
    // ⚠️ RE-HOMED IN 0.126.0 (D196). Entei "Blaze Ball" held this from 0.35.0 until
    // `energyOnSelf` made the Energy-attached-to-itself count a real count source.
    // It is now Pachirisu sv01-068 "Everyone Discharge", which stays flagged for two
    // independent reasons — a TWO-SENTENCE printing against whole-sentence-anchored
    // readers, and a TYPED count of BODIES that no `DamageCountSource` member
    // answers. A Basic fielded by surgery, energied for its {L}{C} cost with
    // Lightning (Fire cannot pay the {L}); fix-bigbody (200 HP) survives the base 10
    // so the KO tail stays out of the way.
    let board = driveSetup(HEADS, { p1: SCALED_DAMAGE_DECK, p2: SCALED_DAMAGE_DECK }, { first: "p2" });
    board = must(applyAction(board, { type: "endTurn", seat: "p2" }));
    board = setActiveFromDeck(board, "p1", "sv01-068");
    board = attachFromDeck(board, "p1", "fix-lightning-energy", 2);
    board = setActiveFromDeck(board, "p2", "fix-bigbody");
    const { events } = mustApply(board, { type: "attack", seat: "p1", index: 0 });
    expect(events.find((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      attack: "Everyone Discharge",
      damageModifier: "+",
    });
    expect(types(events)).not.toContain("STATUS_APPLIED");
  });

  it("skips pure underivable text with no damage modifier — the full payload", () => {
    // Lullaby: the classic old-era print ("The Defending Pokémon …"), no
    // damage at all — the skip carries the text and a null modifier.
    const { state: done, events } = mustApply(statuserBoard(TAILS), {
      type: "attack",
      seat: "p1",
      index: 6,
    });
    expect(events.find((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toEqual({
      type: "ATTACK_EFFECT_SKIPPED",
      seat: "p1",
      attack: "Lullaby",
      effect: "The Defending Pokémon is now Asleep.",
      damageModifier: null,
    });
    // Nothing was simulated: no damage, no status — the defender untouched.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(done.players.p2.active?.conditions.rotation).toBe("none");
  });
});

describe("deriveAttackEffect (effects.ts)", () => {
  it("derives the five exact sentence shapes", () => {
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Asleep.")).toEqual([
      { op: "applyStatus", target: "defender", status: "asleep" },
    ]);
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Burned.")).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Poisoned.")).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
    expect(
      deriveAttackEffect("Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."),
    ).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
    expect(deriveAttackEffect("This Pokémon is now Confused.")).toEqual([
      { op: "applyStatus", target: "self", status: "confused" },
    ]);
    expect(deriveAttackEffect("This Pokémon is now Asleep. Heal 30 damage from it.")).toEqual([
      { op: "applyStatus", target: "self", status: "asleep" },
      { op: "heal", target: "self", amount: 30 },
    ]);
    // Counters → HP: sv03-122 prints 2, sv02-126 prints 6.
    expect(
      deriveAttackEffect(
        "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 2 damage counters on that Pokémon instead of 1.",
      ),
    ).toEqual([{ op: "applyStatus", target: "defender", status: "poisoned", poisonDamage: 20 }]);
    expect(
      deriveAttackEffect(
        "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 6 damage counters on that Pokémon instead of 1.",
      ),
    ).toEqual([{ op: "applyStatus", target: "defender", status: "poisoned", poisonDamage: 60 }]);
    // Surrounding whitespace is the ONE tolerated variation.
    expect(deriveAttackEffect("  Your opponent's Active Pokémon is now Asleep. ")).not.toBeNull();
  });

  it("refuses self-paralysis — the §13.4 clear would wrongly cure it at once", () => {
    // Official timing (ptcg-rules.md §12/§13.4): paralysis recovers at the
    // Checkup after its owner's next turn — only if Paralyzed since the
    // BEGINNING of that turn. Self-paralysis applied at the owner's own
    // turn's end must survive the immediately-following Checkup, which the
    // engine's unconditional ended-seat clear cannot honor yet, so the
    // deriver keeps the sentence on the loud ATTACK_EFFECT_SKIPPED path.
    expect(deriveAttackEffect("This Pokémon is now Paralyzed.")).toBeNull();
  });

  it("returns null for anything but the exact sentences", () => {
    for (const text of [
      // Real prints whose EXTRA mechanics are unbuilt — deriving just the poison
      // would silently drop the rest, so nothing derives. (Paldean Clodsire's
      // "…that Pokémon can't retreat" USED to sit here; D112 built its second
      // clause, so it now derives to poison + preventRetreat — retreatLock.test.)
      //
      // 🆕🆕 D424 — sv03-010's "Flip a coin. If heads, …is now Paralyzed and
      // Poisoned." USED to sit here too, for the same reason one line up: the
      // two-status pair was the unbuilt extra. `FLIP_DEFENDER_STATUS_PAIR` builds
      // it, so the entry was RE-POINTED rather than dropped — onto the two rows of
      // the same legal column that are STILL a real print with an unbuilt extra,
      // so this list keeps the discrimination it had. Both would go RED under a
      // loosened pair anchor (a dropped `\.$`, or an Oxford-comma third slot),
      // which is exactly what the deleted entry used to catch.
      // 🆕🆕 **D478 — RE-POINTED, AND THE OLD ENTRY'S STATED REASON WAS FALSE FROM THE DAY
      // IT WAS WRITTEN.** This slot held *"Flip a coin. If heads, …is now Paralyzed and
      // Poisoned. If tails, …is now Confused."* (corpus FILE LINE 263, 2 printings) with the
      // note *"coinFlipGate has no tails branch"*. It has carried `otherwise` since **D269**,
      // and `deriveAttackEffect` arm 6d has EMITTED a two-armed gate since **D416** — so the
      // mechanism was never what refused the row; an anchor and an arm were. D478 built it.
      //
      // D418's question, answered rather than skipped: the OLD entry caught a drift of
      // `FLIP_DEFENDER_STATUS_PAIR` that dropped its `\.$`, claimed line 263 and silently
      // threw the tails branch away. **That drift is still caught, and by VALUE rather than
      // by nullity** — arm 2b runs BEFORE arm 2b-bis, so the drifted anchor claims the
      // sentence first and emits the HEADS arm alone, which `flipStatusHeadsTails.test.ts`
      // §2's program equality reddens on (and `D478-pair-anchor-drift-eats-the-tails-branch`
      // pins). A `toBeNull` could never have distinguished *heads-only* from *both arms*;
      // the equality does, so the discrimination moved and grew.
      //
      // The slot itself is re-pointed onto the ONE remaining printed heads/tails compound in
      // the whole 640-row column (corpus FILE LINE 268, 2 printings, measured in
      // `flipStatusHeadsTails.test.ts` §3): its tails branch is *"this attack does
      // nothing"*, an attack-level CANCEL that resolves at the §8 declaration seam and that
      // `deriveAttackEffect` has no place to put — a blocker in a different SEAM rather than
      // in this reader's vocabulary, which is why it cannot be built by widening any anchor
      // here. ⚠️ It is load-bearing in three files now; a successor who builds it owes the
      // re-point (D467).
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.", // corpus FILE LINE 268 — the column's last printed heads/tails compound
      // 🆕🆕 D462 — this slot held the THREE-status Oxford list, which
      // `DEFENDER_STATUS_TRIPLE` now BUILDS. RE-POINTED rather than dropped (D418),
      // onto corpus FILE LINE 264 — the same legal column, still a real print with an
      // unbuilt extra, and the near miss BOTH the flip anchor and the two list anchors
      // refuse: a comma sits where `FLIP_DEFENDER_NOW`'s `\.$` wants a period, and
      // `(${STATUS_WORDS})` admits neither the comma nor the verb that follows it.
      //
      // 🆕🆕 **D464 — RE-POINTED A SECOND TIME, AND THE REASON IN THE PARAGRAPH ABOVE WAS
      // TWO-THIRDS WRONG.** `FLIP_DEFENDER_STATUS_THEN_DISCARD` now BUILDS corpus line 264,
      // so the entry had to move again — and re-deriving it showed that only the
      // `FLIP_DEFENDER_NOW` half of D462's reason was ever true. MEASURED over all 640
      // rows: neither list anchor can reach line 264 under ANY single-axis loosening
      // (`DEFENDER_STATUS_TRIPLE` demands a SECOND comma that line never prints, and its
      // `^Your opponent` prefix refuses the flip clause besides). Dropping
      // `FLIP_DEFENDER_NOW`'s `\.$`, by contrast, took it from 2 rows / 29 printings to
      // 6 / 35 — which is the drift this list exists to catch.
      //
      // So the slot is re-pointed onto the set that probe actually NAMES: the THREE real
      // printings `DEFENDER_NOW`'s own `\.$` refuses, each a real print with an unbuilt
      // extra, each 1 printing. Drop that `\.$` and all three are claimed with their
      // second clause silently thrown away — the exact defect the deleted entry was
      // believed to guard, now pointed at the anchor that has it.
      // 🆕🆕🆕 D501 — corpus FILE LINE 685 LEFT THIS LIST. It is claimed WHOLE by `deriveAttackEffect` through `DEFENDER_CONFUSION_N`, into an `applyStatus` carrying the raised amount — a STATUS op, which is what this family's refusal always said it would be. Re-pointed onto the OP rather than decremented (D465/D488): a count that steps says something left and nothing about what, where naming the op reddens on a reader widened past the count clause and stays green only on the build that actually shipped.
      // (The sibling two lines below still carries the `\.$` claim, unchanged.)
      "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.", // corpus FILE LINE 686 — same drift, same anchor
      "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, Energy cards can't be attached from your opponent's hand to that Pokémon.", // corpus FILE LINE 690 — same drift, same anchor
      "Flip a coin. If heads, choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition.", // sv01-010
      "The Defending Pokémon is now Asleep.", // old-era phrasing
      "Flip a coin. If tails, your opponent's Active Pokémon is now Asleep.",
      "Your opponent's Active Pokémon is now Asleep", // no period
      "Your opponent's Active Pokémon is now Tired.",
      "Your opponent's Active Pokémon is now Asleep. Draw a card.",
      "This Pokémon is now Asleep. Heal all damage from it.",
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });
});

describe("purity and determinism", () => {
  it("never mutates the input state through a full checkup", () => {
    let state = walls(HEADS_THEN_TAILS, { p2: 1 });
    state = setConditions(state, "p1", { rotation: "asleep", burned: true });
    state = setConditions(state, "p2", { poisonDamage: 10 });
    const frozen = deepFreeze(state);
    const snapshot = JSON.stringify(frozen);
    const result = applyAction(frozen, { type: "endTurn", seat: "p1" });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("replays identically for one seed and diverges across seeds", () => {
    const play = (seed: number) => {
      let state = walls(seed);
      state = setConditions(state, "p1", { rotation: "asleep", burned: true });
      return mustApply(state, { type: "endTurn", seat: "p1" });
    };
    const a = play(HEADS);
    expect(play(HEADS).state).toEqual(a.state);
    expect(play(HEADS).events).toEqual(a.events);
    // Different seed, different flips, different world — and the flips
    // advanced rngState away from where the other seed's did.
    const b = play(TAILS);
    expect(b.events).not.toEqual(a.events);
    expect(b.state.rngState).not.toBe(a.state.rngState);
  });
});
