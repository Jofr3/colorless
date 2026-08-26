import { describe, expect, it } from "vitest";
import { evaluateWin } from "./flow";
import { applyAction, createGame, topUid } from "./index";
import type { GameAction, GameEvent, GameState } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  deckOf,
  deepFreeze,
  driveSetup,
  expectErr,
  handUid,
  must,
  mustApply,
  setPrizes,
  types,
} from "./testFixtures";

// Seed found by deterministic scan: no mulligans for the deck pairs below,
// p1's turn-3 hand holds a fix-fire-energy, and p2's opening hand holds the
// bench copies the boards request.
const SEED = 11;

/** 30 Basics + typed energy — every hand has an attacker after mulligans. */
const ATTACKER_DECK = deckOf({ "fix-attacker": 30, "fix-fire-energy": 20, "fix-water-energy": 10 });

/** All one defender species, plus energy for KO-cleanup boards. */
function defenderDeck(id: string): string[] {
  return deckOf({ [id]: 40, "fix-water-energy": 20 });
}

interface MatchupOptions {
  /** Fire/Water energies pre-attached (test surgery) to p1's Active. */
  fire?: number;
  water?: number;
  /** Copies of the defender benched for p2 during setup. */
  bench?: number;
}

/** p1's fix-attacker vs p2's `defenderId`, on p1's turn 3 — past the §4
    first-turn attack ban — with the requested board pre-built. */
function matchup(defenderId: string, opts: MatchupOptions = {}): GameState {
  const { fire = 1, water = 0, bench = 0 } = opts;
  let state = driveSetup(
    SEED,
    { p1: ATTACKER_DECK, p2: defenderDeck(defenderId) },
    {
      first: "p1",
      active: { p1: "fix-attacker", p2: defenderId },
      bench: { p2: Array.from({ length: bench }, () => defenderId) },
    },
  );
  if (fire > 0) state = attachFromDeck(state, "p1", "fix-fire-energy", fire);
  if (water > 0) state = attachFromDeck(state, "p1", "fix-water-energy", water);
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  return state;
}

/** Attack 0 is Bite — Colorless cost, 30 damage. */
function bite(state: GameState): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index: 0 });
}

/** A KO parked on the prize pick: fix-weak (60 HP, ×2 Fire) dies to one
    Bite, and with 6 prizes up the pick always parks. */
function parkedOnPrizes(opts: MatchupOptions = { bench: 1 }): {
  state: GameState;
  events: GameEvent[];
} {
  return bite(matchup("fix-weak", opts));
}

describe("attack costs (§6.4, §8.2)", () => {
  it("rejects an attack the attached energy cannot pay", () => {
    expectErr(
      matchup("fix-wall", { fire: 0 }),
      { type: "attack", seat: "p1", index: 0 },
      "ATTACK_COST_UNMET",
    );
  });

  it("pays a Colorless slot with any energy type", () => {
    const { events } = mustApply(matchup("fix-wall", { fire: 0, water: 1 }), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(events[0]?.type).toBe("ATTACK_DECLARED");
  });

  it("requires the exact type for a typed symbol", () => {
    // Two Water pay Flame's Colorless slot but never its Fire slot.
    expectErr(
      matchup("fix-wall", { fire: 0, water: 2 }),
      { type: "attack", seat: "p1", index: 1 },
      "ATTACK_COST_UNMET",
    );
  });

  it("pays a typed + Colorless cost with mixed energy", () => {
    const { events } = mustApply(matchup("fix-wall", { fire: 1, water: 1 }), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    const dealt = events.find((e) => e.type === "DAMAGE_DEALT");
    expect(dealt?.type === "DAMAGE_DEALT" && dealt.dealt).toBe(60);
  });

  it("declares a free attack with no energy attached", () => {
    const { events } = mustApply(matchup("fix-wall", { fire: 0 }), {
      type: "attack",
      seat: "p1",
      index: 2, // Yawn — no cost, no damage, a derived sleep effect (M3)
    });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // The text derives (effects.ts), so nothing is skipped — the defender
    // is actually put to sleep.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(events.find((e) => e.type === "STATUS_APPLIED")).toMatchObject({
      seat: "p2",
      status: "asleep",
    });
  });

  it("checks the cost without paying it — energy stays attached (§8.2)", () => {
    const before = matchup("fix-wall", { fire: 1 });
    const { state } = bite(before);
    expect(state.players.p1.active?.energy).toEqual(before.players.p1.active?.energy);
  });
});

describe("first-turn restriction (§4)", () => {
  it("blocks the going-first player's turn-1 attack", () => {
    let state = driveSetup(
      SEED,
      { p1: ATTACKER_DECK, p2: defenderDeck("fix-wall") },
      { first: "p1", active: { p1: "fix-attacker", p2: "fix-wall" } },
    );
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    expectErr(state, { type: "attack", seat: "p1", index: 0 }, "FIRST_TURN_ATTACK");
  });

  it("lets the second player attack on their first turn (turn 2)", () => {
    let state = driveSetup(
      SEED,
      { p1: defenderDeck("fix-wall"), p2: ATTACKER_DECK },
      { first: "p1", active: { p1: "fix-wall", p2: "fix-attacker" } },
    );
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = attachFromDeck(state, "p2", "fix-fire-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(events[0]?.type).toBe("ATTACK_DECLARED");
  });
});

describe("attack declaration validation", () => {
  it("rejects out-of-range, fractional and string indices (wire)", () => {
    const state = matchup("fix-wall");
    // fix-attacker prints 6 attacks (0-5: Bite, Flame, Yawn, Rage, Fury, Bounty), so
    // 6 is the first out-of-range index.
    for (const index of [6, -1, 1.5, "1"]) {
      expectErr(state, { type: "attack", seat: "p1", index: index as never }, "BAD_ATTACK_INDEX");
    }
  });

  it("rejects a Pokémon with no printed attacks", () => {
    let state = driveSetup(
      SEED,
      { p1: defenderDeck("fix-wall"), p2: defenderDeck("fix-wall") },
      { first: "p1", active: { p1: "fix-wall", p2: "fix-wall" } },
    );
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expectErr(state, { type: "attack", seat: "p1", index: 0 }, "BAD_ATTACK_INDEX");
  });

  it("rejects the off-turn seat", () => {
    expectErr(matchup("fix-wall"), { type: "attack", seat: "p2", index: 0 }, "WRONG_SEAT");
  });
});

describe("damage pipeline (§8.5)", () => {
  it("applies base damage and accumulates it across turns", () => {
    const board = matchup("fix-wall");
    const defender = board.players.p2.active;
    if (defender === null) throw new Error("no defender");
    const defenderUid = topUid(defender);
    const first = bite(board);
    expect(first.events.find((e) => e.type === "DAMAGE_DEALT")).toEqual({
      type: "DAMAGE_DEALT",
      seat: "p2",
      // 🆕🆕 D425 — the DEALER, required on this row since the own-side bench spread
      // made `otherSeat(seat)` a wrong answer for the first time. This is the
      // STRICT-equality rung in the repo, so it is where a build that dropped the
      // field or filled it from the damaged seat goes red.
      by: "p1",
      uid: defenderUid,
      base: 30,
      weakness: null,
      resistance: null,
      dealt: 30,
      damage: 30,
    });
    // The tail ran through to p2's turn; pass back and Bite again.
    const back = must(applyAction(first.state, { type: "endTurn", seat: "p2" }));
    const second = bite(back);
    expect(second.state.players.p2.active?.damage).toBe(60);
  });

  it("doubles for weakness — and the doubled hit KOs", () => {
    const { events } = parkedOnPrizes();
    const dealt = events.find((e) => e.type === "DAMAGE_DEALT");
    expect(dealt?.type === "DAMAGE_DEALT" && dealt.weakness).toEqual({
      op: "multiply",
      amount: 2,
    });
    expect(dealt?.type === "DAMAGE_DEALT" && dealt.dealt).toBe(60);
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("ADDS an old-era additive weakness (+20) instead of doubling", () => {
    // The dp5-4 print: "+20" — 30 + 20 = 50, where a misread ×2 deals 60.
    const { events } = bite(matchup("fix-weak-plus"));
    expect(events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({
      base: 30,
      weakness: { op: "add", amount: 20 },
      resistance: null,
      dealt: 50,
    });
  });

  it("subtracts resistance and floors at zero", () => {
    const { state, events } = bite(matchup("fix-tough"));
    expect(events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({
      base: 30,
      weakness: null,
      resistance: { op: "subtract", amount: 30 },
      dealt: 0,
      damage: 0,
    });
    expect(state.players.p2.active?.damage).toBe(0);
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });

  it("applies weakness BEFORE resistance (§8.5 order)", () => {
    // (30 × 2) − 30 = 30; the wrong order would floor to (30 − 30) × 2 = 0.
    const { events } = bite(matchup("fix-weak-tough"));
    expect(events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({
      base: 30,
      weakness: { op: "multiply", amount: 2 },
      resistance: { op: "subtract", amount: 30 },
      dealt: 30,
    });
  });

  it("simulates a self-damage-counter scaling clause, no longer flagged", () => {
    // fix-attacker's Rage — "This attack does 10 more damage for each damage
    // counter on this Pokémon." — now DERIVES (0.34.0), so its "+" is simulated
    // rather than flagged. At 0 damage counters it just deals its printed base 10,
    // with no `scaled`; the deep scaling coverage lives in scaledDamage.test.ts.
    const { events } = mustApply(matchup("fix-wall"), { type: "attack", seat: "p1", index: 3 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = events.find((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 10, dealt: 10 });
    expect(dealt?.type === "DAMAGE_DEALT" && dealt.scaled).toBeUndefined();
  });
});

describe("Knock Out cleanup (§8.1)", () => {
  it("sends the whole stack — Pokémon and attached energy — to the discard", () => {
    let state = matchup("fix-weak", { bench: 1 });
    state = attachFromDeck(state, "p2", "fix-water-energy", 1);
    const defender = state.players.p2.active;
    if (defender === null) throw new Error("no defender");
    const stackUid = topUid(defender);
    const energyUid = defender.energy[0];
    const { state: after, events } = bite(state);

    expect(after.players.p2.active).toBeNull(); // promotion still pending
    expect(after.players.p2.discard).toEqual([stackUid, energyUid]);
    expect(events.find((e) => e.type === "KNOCKED_OUT")).toEqual({
      type: "KNOCKED_OUT",
      seat: "p2",
      uid: stackUid,
      discarded: [stackUid, energyUid],
    });
  });

  it("hands out a KNOCKED_OUT payload detached from the state", () => {
    const { state, events } = parkedOnPrizes();
    const koed = events.find((e) => e.type === "KNOCKED_OUT");
    if (koed?.type !== "KNOCKED_OUT") throw new Error("expected KNOCKED_OUT");
    koed.discarded.length = 0;
    expect(state.players.p2.discard).toHaveLength(1);
  });

  it("never KOs a Pokémon whose printed hp is 0 — a data gap, not '0 HP'", () => {
    // hpOf reads a non-positive print as the same gap as null (cards.ts);
    // without that, ANY damage would KO an undamaged fix-zero-hp on sight.
    const { state, events } = bite(matchup("fix-zero-hp"));
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.damage).toBe(30);
  });
});

describe("prize taking (§8.1)", () => {
  it("parks on ko:takePrizes and announces the prompt", () => {
    const { state, events } = parkedOnPrizes();
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(events.at(-1)).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    // The rest of the tail is queued, waiting on the decision.
    expect(state.pending.map((stage) => stage.kind)).toEqual([
      "takePrizes",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
  });

  it("validates the pick like a wire value", () => {
    const { state } = parkedOnPrizes();
    expectErr(state, { type: "takePrizes", seat: "p2", prizeIndices: [0] }, "WRONG_SEAT");
    expectErr(
      state,
      { type: "takePrizes", seat: "p1", prizeIndices: "0" as never },
      "BAD_PRIZE_COUNT",
    );
    expectErr(state, { type: "takePrizes", seat: "p1", prizeIndices: [] }, "BAD_PRIZE_COUNT");
    expectErr(state, { type: "takePrizes", seat: "p1", prizeIndices: [0, 1] }, "BAD_PRIZE_COUNT");
    expectErr(state, { type: "takePrizes", seat: "p1", prizeIndices: [6] }, "BAD_PRIZE_INDEX");
    expectErr(state, { type: "takePrizes", seat: "p1", prizeIndices: [-1] }, "BAD_PRIZE_INDEX");
    expectErr(state, { type: "takePrizes", seat: "p1", prizeIndices: [0.5] }, "BAD_PRIZE_INDEX");
    expectErr(
      state,
      { type: "takePrizes", seat: "p1", prizeIndices: ["0"] as never },
      "BAD_PRIZE_INDEX",
    );
    // Turn actions are locked out while the interrupt is parked.
    expectErr(state, { type: "attack", seat: "p1", index: 0 }, "BAD_PHASE");
    expectErr(state, { type: "endTurn", seat: "p1" }, "BAD_PHASE");
  });

  it("takes the picked prize into hand and resumes the tail", () => {
    const { state } = parkedOnPrizes(); // p2 benched 1 — promotion will auto-resolve
    const targetUid = state.players.p1.prizes[2];
    const prizeIndices = [2];
    const { state: done, events } = mustApply(state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices,
    });
    expect(events.find((e) => e.type === "PRIZES_TAKEN")).toEqual({
      type: "PRIZES_TAKEN",
      seat: "p1",
      uids: [targetUid],
      indices: [2],
      remaining: 5,
    });
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p1.hand).toContain(targetUid);
    // The lone benched Pokémon auto-promoted (no prompt), then the tail ran
    // through TURN_ENDED into p2's turn.
    expect(types(events)).toEqual([
      "PRIZES_TAKEN",
      "POKEMON_PROMOTED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.turn).toBe(4);
    expect(done.pending).toEqual([]);
    // The event's indices are a copy, not the caller's action array.
    prizeIndices.length = 0;
    const taken = events.find((e) => e.type === "PRIZES_TAKEN");
    expect(taken?.type === "PRIZES_TAKEN" && taken.indices).toEqual([2]);
  });

  it("handles a multi-prize pick (the ex flow) including duplicate rejection", () => {
    // Craft the 2-prize decision directly — in BOTH encodings (the phase AND the
    // head pending stage), exactly the way parking writes them — to pin the PICK
    // HANDLER (duplicate rejection) in isolation; prizeValue.test.ts covers the
    // KO→count wiring that now feeds it (an ex/V owes 2 via prizeValueOf). The
    // handler cross-checks the two encodings and the resolution takes `count`.
    const { state } = parkedOnPrizes();
    const twoPrize: GameState = {
      ...state,
      phase: { kind: "ko:takePrizes", seat: "p1", count: 2 },
      pending: [{ kind: "takePrizes", seat: "p1", count: 2 }, ...state.pending.slice(1)],
    };
    expectErr(
      twoPrize,
      { type: "takePrizes", seat: "p1", prizeIndices: [1, 1] },
      "BAD_PRIZE_INDEX",
    );
    const { state: done, events } = mustApply(twoPrize, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0, 5],
    });
    expect(done.players.p1.prizes).toHaveLength(4);
    const taken = events.find((e) => e.type === "PRIZES_TAKEN");
    expect(taken?.type === "PRIZES_TAKEN" && taken.remaining).toBe(4);
  });

  it("rejects a pick whose phase disagrees with the queue head (crafted)", () => {
    // Parking dual-encodes the decision; resolving trusts the queue. A
    // crafted count-2 phase over the real count-1 head must reject — the old
    // behavior took 2 prizes while popping the 1-prize stage.
    const { state } = parkedOnPrizes();
    const desynced: GameState = {
      ...state,
      phase: { kind: "ko:takePrizes", seat: "p1", count: 2 },
    };
    expectErr(desynced, { type: "takePrizes", seat: "p1", prizeIndices: [0, 1] }, "PHASE_DESYNC");
  });

  it("never mutates a parked state through the KO resolution", () => {
    const parked = deepFreeze(parkedOnPrizes().state);
    const snapshot = JSON.stringify(parked);
    const result = applyAction(parked, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(parked)).toBe(snapshot);
  });
});

describe("promotion (§8.1)", () => {
  /** Parked on ko:promote: two benched defenders make it a real choice. */
  function parkedOnPromotion(): { state: GameState; events: GameEvent[] } {
    const { state } = parkedOnPrizes({ bench: 2 });
    return mustApply(state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
  }

  it("parks on ko:promote and announces the prompt", () => {
    const { state, events } = parkedOnPromotion();
    expect(state.phase).toEqual({ kind: "ko:promote", seat: "p2" });
    expect(events.at(-1)).toEqual({ type: "PROMOTION_REQUIRED", seat: "p2" });
  });

  it("validates the promotion like a wire value", () => {
    const { state } = parkedOnPromotion();
    expectErr(state, { type: "promote", seat: "p1", benchIndex: 0 }, "WRONG_SEAT");
    expectErr(state, { type: "promote", seat: "p2", benchIndex: "0" as never }, "BAD_BENCH_INDEX");
    expectErr(state, { type: "promote", seat: "p2", benchIndex: 2 }, "BAD_BENCH_INDEX");
    expectErr(state, { type: "promote", seat: "p2", benchIndex: 5 }, "BAD_BENCH_INDEX");
    // The KO'd side cannot take other actions while promotion is owed.
    expectErr(
      state,
      { type: "attachEnergy", seat: "p2", uid: "p2#0", target: { spot: "active" } },
      "BAD_PHASE",
    );
  });

  it("rejects a promotion onto an occupied Active spot (crafted)", () => {
    // Unreachable through M2 actions (nothing refills the spot while
    // parked) — resolving anyway would overwrite the occupant's whole stack
    // with no event, so the handler mirrors advance's occupied guard.
    const { state } = parkedOnPromotion();
    const occupant = state.players.p2.bench[0];
    if (occupant === undefined) throw new Error("expected a benched Pokémon");
    const crafted: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: occupant } },
    };
    expectErr(crafted, { type: "promote", seat: "p2", benchIndex: 0 }, "ACTIVE_ALREADY_PLACED");
  });

  it("rejects a promotion whose phase disagrees with the queue head (crafted)", () => {
    // The dual-encoding cross-check, promote flavor: popping the head out
    // from under the parked phase must reject, not resolve a wrong stage.
    const { state } = parkedOnPromotion();
    const desynced: GameState = { ...state, pending: state.pending.slice(1) };
    expectErr(desynced, { type: "promote", seat: "p2", benchIndex: 0 }, "PHASE_DESYNC");
  });

  it("promotes the chosen Pokémon and resumes into the next turn", () => {
    const { state } = parkedOnPromotion();
    const chosen = state.players.p2.bench[1];
    const remaining = state.players.p2.bench[0];
    const { state: done, events } = mustApply(state, {
      type: "promote",
      seat: "p2",
      benchIndex: 1,
    });
    expect(events.find((e) => e.type === "POKEMON_PROMOTED")).toEqual({
      type: "POKEMON_PROMOTED",
      seat: "p2",
      uid: chosen === undefined ? "?" : topUid(chosen),
      benchIndex: 1,
    });
    // Unchanged but for the §8.1 move itself: the replacement is stamped with
    // the turn it came up on (D124's `promotedTurn`), which is the ATTACKER's
    // turn — so it reads "did not move this turn" once p2's own turn starts.
    expect(done.players.p2.active).toEqual({ ...chosen, promotedTurn: state.turn });
    expect(done.players.p2.bench).toEqual([remaining]);
    expect(types(events)).toEqual([
      "POKEMON_PROMOTED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

describe("win conditions (§14)", () => {
  it("wins by taking the last prize — auto-resolved, before any promotion", () => {
    // One prize from victory: the forced last pick never parks (M1 doctrine),
    // and the game ends before p2's promotion is ever prompted.
    const state = setPrizes(matchup("fix-weak", { bench: 1 }), "p1", 1);
    const { state: done, events } = bite(state);
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "KNOCKED_OUT",
      "PRIZES_TAKEN",
      "GAME_OVER",
    ]);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
    expect(done.players.p1.prizes).toHaveLength(0);
    expect(done.pending).toEqual([]);
  });

  it("wins when the KO'd side has no Pokémon left to promote", () => {
    const { state } = parkedOnPrizes({ bench: 0 }); // prizes still park first (§8.1)
    const { state: done, events } = mustApply(state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    });
    expect(types(events)).toEqual(["PRIZES_TAKEN", "GAME_OVER"]);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "noPokemon" },
    });
  });

  it("orders simultaneous conditions: the last prize outranks the empty board", () => {
    // Both §14.1 and §14.2 trigger on the same KO; precedence picks §14.1.
    const state = setPrizes(matchup("fix-weak", { bench: 0 }), "p1", 1);
    const { state: done } = bite(state);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
  });

  it("surfaces a TIE when both seats meet a condition at once", () => {
    // Unreachable through M2 actions (attacks never KO the attacker's own
    // side) — evaluateWin still has to resolve it per §14 for M3's checkup
    // damage. Crafted board: p1 out of prizes AND out of Pokémon.
    const base = matchup("fix-wall");
    const crafted: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: { ...base.players.p1, prizes: [], active: null, bench: [] },
      },
    };
    expect(evaluateWin(crafted)).toEqual({
      result: "tie",
      reasons: { p1: "prizesTaken", p2: "noPokemon" },
    });
    expect(evaluateWin(base)).toBeNull();
  });

  it("hands out a GAME_OVER outcome detached from the state", () => {
    const { state } = parkedOnPrizes({ bench: 0 });
    const { state: done, events } = mustApply(state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    });
    const over = events.find((e) => e.type === "GAME_OVER");
    if (over?.type !== "GAME_OVER") throw new Error("expected GAME_OVER");
    (over.outcome as { winner: string }).winner = "p2";
    expect(done.phase.kind === "gameOver" && done.phase.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "noPokemon",
    });
  });
});

describe("allowances across interrupts", () => {
  it("keeps the per-turn flags through a parked KO and resets them next turn", () => {
    let state = matchup("fix-weak", { bench: 1, fire: 1 });
    // A real attach action sets the allowance flag...
    const uid = handUid(state, "p1", "fix-fire-energy");
    state = must(
      applyAction(state, { type: "attachEnergy", seat: "p1", uid, target: { spot: "active" } }),
    );
    expect(state.allowances.energyAttached).toBe(true);
    // ...the ko:takePrizes interrupt replaces the phase but NOT the flags...
    const { state: parked } = bite(state);
    expect(parked.phase.kind).toBe("ko:takePrizes");
    expect(parked.allowances.energyAttached).toBe(true);
    // ...and the tail's startTurn is what resets them.
    const { state: done } = mustApply(parked, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    });
    expect(done.allowances).toEqual({ energyAttached: false, retreated: false, supporterPlayed: false, stadiumPlayed: false, stadiumAbilityUsed: false, abilitiesUsed: [] });
  });
});

describe("scripted end-to-end game — win by prizes", () => {
  const E2E_P1 = deckOf({ "fix-attacker": 30, "fix-fire-energy": 30 });
  const E2E_P2 = deckOf({ "fix-victim": 60 });

  /** A deterministic prize race driven only through applyAction: p1 attaches
      once and Bites every turn (each Bite KOs a 30 HP victim); p2 keeps the
      bench stocked and passes. p1 must win by prizes — p2 can never KO. */
  function playPrizeGame(seed: number): { state: GameState; events: GameEvent[] } {
    const created = createGame({ seed, decks: { p1: E2E_P1, p2: E2E_P2 }, cardPool: FIXTURE_POOL });
    if (!created.ok) throw new Error(created.error.code);
    let state = created.state;
    const events: GameEvent[] = [...created.events];
    const step = (action: GameAction): GameState => {
      const applied = mustApply(state, action);
      state = applied.state;
      events.push(...applied.events);
      return state;
    };

    if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    state = step({ type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" });
    while (state.phase.kind === "setup:drawExtra") {
      const phase = state.phase;
      const owedSeat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
      if (owedSeat === undefined) throw new Error("drawExtra with every seat decided");
      state = step({ type: "setupDrawExtra", seat: owedSeat, count: phase.owed[owedSeat] });
    }
    state = step({
      type: "setupPlaceActive",
      seat: "p1",
      uid: handUid(state, "p1", "fix-attacker"),
    });
    state = step({ type: "setupPlaceActive", seat: "p2", uid: handUid(state, "p2", "fix-victim") });
    for (let i = 0; i < 2; i++) {
      state = step({
        type: "setupPlaceBench",
        seat: "p2",
        uid: handUid(state, "p2", "fix-victim"),
      });
    }
    state = step({ type: "setupReady", seat: "p1" });
    state = step({ type: "setupReady", seat: "p2" });

    for (let guard = 0; guard < 300 && state.phase.kind !== "gameOver"; guard++) {
      const phase = state.phase;
      if (phase.kind === "turn:action") {
        const seat = phase.seat;
        const side = state.players[seat];
        if (seat === "p1") {
          const active = side.active;
          if (active !== null && active.energy.length === 0 && !state.allowances.energyAttached) {
            const uid = side.hand.find((u) => state.cardIdByUid[u] === "fix-fire-energy");
            if (uid !== undefined) {
              state = step({ type: "attachEnergy", seat, uid, target: { spot: "active" } });
            }
          }
          const armed = state.players.p1.active;
          if (state.turn > 1 && armed !== null && armed.energy.length > 0) {
            state = step({ type: "attack", seat, index: 0 });
          } else {
            state = step({ type: "endTurn", seat });
          }
        } else {
          const uid = side.hand.find((u) => state.cardIdByUid[u] === "fix-victim");
          if (uid !== undefined && side.bench.length < 5) {
            state = step({ type: "playBasicToBench", seat, uid });
          }
          state = step({ type: "endTurn", seat });
        }
      } else if (phase.kind === "ko:takePrizes") {
        const prizeIndices = Array.from({ length: phase.count }, (_, i) => i);
        state = step({ type: "takePrizes", seat: phase.seat, prizeIndices });
      } else if (phase.kind === "ko:promote") {
        state = step({ type: "promote", seat: phase.seat, benchIndex: 0 });
      } else {
        throw new Error(`unexpected phase ${phase.kind}`);
      }
    }
    return { state, events };
  }

  it("plays to a prize-out win, with the KO cadence in the event log", () => {
    const { state, events } = playPrizeGame(21);

    expect(state.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
    expect(state.players.p1.prizes).toHaveLength(0);
    expect(events.at(-1)?.type).toBe("GAME_OVER");
    expect(events.at(-2)?.type).toBe("PRIZES_TAKEN"); // the auto-taken last prize

    const count = (type: GameEvent["type"]) => events.filter((e) => e.type === type).length;
    expect(count("ATTACK_DECLARED")).toBe(6); // every Bite KO'd
    expect(count("KNOCKED_OUT")).toBe(6);
    expect(count("PRIZES_TAKEN")).toBe(6);
    expect(count("PRIZES_OWED")).toBe(5); // the last take was forced, no prompt
    expect(count("POKEMON_PROMOTED")).toBe(5); // no promotion after the winning KO
    expect(count("GAME_OVER")).toBe(1);

    // Every hit was a clean unmodified 30 into a 30 HP victim.
    for (const event of events) {
      if (event.type === "DAMAGE_DEALT") {
        expect(event).toMatchObject({ base: 30, weakness: null, resistance: null, dealt: 30 });
      }
    }
    // Each KO immediately announces what the game is waiting for (or pays
    // out): the next event is always the prize step.
    events.forEach((event, i) => {
      if (event.type === "KNOCKED_OUT") {
        expect(["PRIZES_OWED", "PRIZES_TAKEN"]).toContain(events[i + 1]?.type);
      }
    });
  });

  it("replays identically for the same seed", () => {
    const a = playPrizeGame(21);
    const b = playPrizeGame(21);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });
});
