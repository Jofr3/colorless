import { describe, expect, it } from "vitest";
import { applyAction, otherSeat, topCardOf, topUid } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  ALL_BASIC_DECK,
  MIXED_DECK,
  attachFromDeck,
  driveSetup,
  expectErr,
  handUid,
  handUids,
  must,
  mustApply,
  types,
} from "./testFixtures";

// Seed found by deterministic scan: MIXED decks, no mulligans, and p1's
// post-setup hands hold the cards each configuration below needs.
const SEED = 170;

const DECKS = { p1: MIXED_DECK, p2: MIXED_DECK };

/** p1 first; active fix-basic-1 (retreat 1) with fix-basic-0 benched; the
    turn-1 hand holds >=2 energy, >=1 item and a Stage1. */
function costOneBoard(): GameState {
  return driveSetup(SEED, DECKS, {
    first: "p1",
    active: { p1: "fix-basic-1", p2: "fix-basic-1" },
    bench: { p1: ["fix-basic-0"] },
  });
}

/** p1 first; active fix-basic-0 (free retreat) with fix-basic-1 benched. */
function freeRetreatBoard(): GameState {
  return driveSetup(SEED, DECKS, {
    first: "p1",
    active: { p1: "fix-basic-0", p2: "fix-basic-1" },
    bench: { p1: ["fix-basic-1"] },
  });
}

/** p1 first; active fix-basic-2 (retreat 2) with fix-basic-0 benched. */
function costTwoBoard(): GameState {
  return driveSetup(SEED, DECKS, {
    first: "p1",
    active: { p1: "fix-basic-2", p2: "fix-basic-1" },
    bench: { p1: ["fix-basic-0"] },
  });
}

describe("attachEnergy", () => {
  it("attaches one energy from hand to the active", () => {
    const state = costOneBoard();
    const uid = handUid(state, "p1", "fix-energy");
    const { state: next, events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    expect(next.players.p1.active?.energy).toEqual([uid]);
    expect(next.players.p1.hand).not.toContain(uid);
    expect(events).toEqual([
      { type: "ENERGY_ATTACHED", seat: "p1", uid, target: { spot: "active" } },
    ]);
  });

  it("attaches to a bench slot", () => {
    const state = costOneBoard();
    const uid = handUid(state, "p1", "fix-energy");
    const next = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid,
        target: { spot: "bench", index: 0 },
      }),
    );
    expect(next.players.p1.bench[0]?.energy).toEqual([uid]);
    expect(next.players.p1.active?.energy).toEqual([]);
  });

  it("enforces exactly one attachment per turn", () => {
    const state = costOneBoard();
    const [first, second] = handUids(state, "p1", "fix-energy", 2);
    if (first === undefined || second === undefined) throw new Error("need 2 energy");
    const next = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: first,
        target: { spot: "active" },
      }),
    );
    expectErr(
      next,
      { type: "attachEnergy", seat: "p1", uid: second, target: { spot: "active" } },
      "ENERGY_ALREADY_ATTACHED",
    );
  });

  it("rejects non-energy cards", () => {
    const state = costOneBoard();
    const uid = handUid(state, "p1", "fix-item");
    expectErr(
      state,
      { type: "attachEnergy", seat: "p1", uid, target: { spot: "active" } },
      "NOT_AN_ENERGY",
    );
  });

  it("rejects a bench index with no Pokémon", () => {
    const state = costOneBoard();
    const uid = handUid(state, "p1", "fix-energy");
    expectErr(
      state,
      { type: "attachEnergy", seat: "p1", uid, target: { spot: "bench", index: 3 } },
      "BAD_BENCH_INDEX",
    );
  });

  it("rejects a wire-garbled target without throwing", () => {
    // The target is a wire value like every other: a null / non-object /
    // unknown-spot shape must come back ok:false, never TypeError on `.spot`.
    const state = costOneBoard();
    const uid = handUid(state, "p1", "fix-energy");
    for (const target of [null, "active", {}]) {
      expectErr(
        state,
        { type: "attachEnergy", seat: "p1", uid, target: target as never },
        "BAD_TARGET",
      );
    }
  });

  it("rejects the off-turn seat", () => {
    expectErr(
      costOneBoard(),
      { type: "attachEnergy", seat: "p2", uid: "whatever", target: { spot: "active" } },
      "WRONG_SEAT",
    );
  });

  it("resets with the next turn", () => {
    let state = costOneBoard();
    const [first, second] = handUids(state, "p1", "fix-energy", 2);
    if (first === undefined || second === undefined) throw new Error("need 2 energy");
    state = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: first,
        target: { spot: "active" },
      }),
    );
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    // Turn 3, p1 again: the allowance is fresh.
    const next = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: second,
        target: { spot: "active" },
      }),
    );
    expect(next.players.p1.active?.energy).toEqual([first, second]);
  });
});

describe("playBasicToBench", () => {
  it("benches any number of Basics per turn, recording the turn placed", () => {
    let state = driveSetup(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK }, { first: "p1" });
    for (let i = 0; i < 2; i++) {
      const uid = handUid(state, "p1", "fix-basic-1");
      const { state: next, events } = mustApply(state, {
        type: "playBasicToBench",
        seat: "p1",
        uid,
      });
      expect(events).toEqual([{ type: "POKEMON_BENCHED", seat: "p1", uid }]);
      state = next;
    }
    expect(state.players.p1.bench).toHaveLength(2);
    expect(state.players.p1.bench.map((p) => p.turnPlayed)).toEqual([1, 1]);
  });

  it("rejects non-Basic cards", () => {
    const state = costOneBoard();
    expectErr(
      state,
      { type: "playBasicToBench", seat: "p1", uid: handUid(state, "p1", "fix-stage1") },
      "NOT_A_BASIC_POKEMON",
    );
    expectErr(
      state,
      { type: "playBasicToBench", seat: "p1", uid: handUid(state, "p1", "fix-energy") },
      "NOT_A_BASIC_POKEMON",
    );
  });

  it("caps the bench at five", () => {
    const state = driveSetup(
      1,
      { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK },
      {
        first: "p1",
        bench: { p1: ["fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1"] },
      },
    );
    expect(state.players.p1.bench).toHaveLength(5);
    expectErr(
      state,
      { type: "playBasicToBench", seat: "p1", uid: handUid(state, "p1", "fix-basic-1") },
      "BENCH_FULL",
    );
  });

  it("rejects the off-turn seat", () => {
    expectErr(
      costOneBoard(),
      { type: "playBasicToBench", seat: "p2", uid: "whatever" },
      "WRONG_SEAT",
    );
  });
});

describe("retreat", () => {
  it("pays the exact cost with the chosen energies and swaps with the bench", () => {
    let state = costOneBoard();
    const energy = handUid(state, "p1", "fix-energy");
    state = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: energy,
        target: { spot: "active" },
      }),
    );
    const retreater = state.players.p1.active;
    const promoted = state.players.p1.bench[0];
    if (retreater === null || promoted === undefined) throw new Error("bad board");

    const { state: next, events } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [energy],
      promoteBenchIndex: 0,
    });
    // The promoted Pokémon arrives UNCHANGED except for the one thing a retreat
    // is: it moved up from the Bench on this turn (D124's `promotedTurn`).
    expect(next.players.p1.active).toEqual({ ...promoted, promotedTurn: state.turn });
    expect(promoted.promotedTurn).toBeNull();
    // The retreater sits at the end of the (dense) bench, cost discarded.
    expect(next.players.p1.bench.at(-1)?.stack).toEqual(retreater.stack);
    expect(next.players.p1.bench.at(-1)?.energy).toEqual([]);
    expect(next.players.p1.discard).toContain(energy);
    expect(events).toEqual([
      {
        type: "RETREATED",
        seat: "p1",
        // The event names the TOP of each stack (§1.2) — identical to
        // stack[0] only while stacks are singletons, which stops being true
        // the moment evolution lands.
        retreated: topUid(retreater),
        promoted: topUid(promoted),
        promotedFrom: 0,
        benchedTo: next.players.p1.bench.length - 1,
        discardedEnergy: [energy],
      },
    ]);
  });

  it("rejects a payment that does not match the cost exactly", () => {
    let state = costTwoBoard();
    const energy = handUid(state, "p1", "fix-energy");
    state = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: energy,
        target: { spot: "active" },
      }),
    );
    // Retreat cost is 2; paying 1 (or 0) is rejected even though the uid is
    // legitimately attached.
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: [energy], promoteBenchIndex: 0 },
      "RETREAT_COST_MISMATCH",
    );
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 },
      "RETREAT_COST_MISMATCH",
    );
  });

  it("rejects a wire-garbled discardEnergy without throwing", () => {
    // Array.isArray, not `.length`: a length-faking object passes the count
    // check and then throws at `new Set`; a plain STRING is even sneakier —
    // it is iterable, so it would sail past the Set into the membership scan.
    const state = costOneBoard();
    for (const bogus of [{ length: 1 }, undefined, "x"]) {
      expectErr(
        state,
        { type: "retreat", seat: "p1", discardEnergy: bogus as never, promoteBenchIndex: 0 },
        "RETREAT_COST_MISMATCH",
      );
    }
  });

  it("reports discarded energy in pile order, not the caller's order", () => {
    // e1 attached before e2 (test surgery keeps attachment order), so the
    // pile gains [e1, e2] no matter how the payment names them — and the
    // event reports what the pile gained (§2 — ordered and public).
    const state = attachFromDeck(costTwoBoard(), "p1", "fix-energy", 2);
    const [e1, e2] = state.players.p1.active?.energy ?? [];
    if (e1 === undefined || e2 === undefined) throw new Error("need 2 attached energy");
    const { state: next, events } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [e2, e1],
      promoteBenchIndex: 0,
    });
    expect(next.players.p1.discard).toEqual([e1, e2]);
    const retreated = events.find((e) => e.type === "RETREATED");
    expect(retreated?.type === "RETREATED" && retreated.discardedEnergy).toEqual([e1, e2]);
  });

  it("rejects unattached or duplicated energy uids", () => {
    let state = costTwoBoard();
    const [attached, inHand] = handUids(state, "p1", "fix-energy", 2);
    if (attached === undefined || inHand === undefined) throw new Error("need 2 energy");
    state = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: attached,
        target: { spot: "active" },
      }),
    );
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: [attached, inHand], promoteBenchIndex: 0 },
      "ENERGY_NOT_ATTACHED",
    );
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: [attached, attached], promoteBenchIndex: 0 },
      "ENERGY_NOT_ATTACHED",
    );
  });

  it("retreats for free when the cost is zero", () => {
    const state = freeRetreatBoard();
    const next = must(
      applyAction(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }),
    );
    expect(next.players.p1.discard).toEqual([]);
    const promotedActive = next.players.p1.active;
    if (promotedActive === null) throw new Error("no active after retreat");
    expect(topCardOf(next, promotedActive)?.id).toBe("fix-basic-1");
  });

  it("rejects with an empty bench", () => {
    const state = driveSetup(SEED, DECKS, {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
    });
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 },
      "BENCH_EMPTY",
    );
  });

  it("rejects a promote index with no Pokémon", () => {
    const state = freeRetreatBoard();
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 4 },
      "BAD_BENCH_INDEX",
    );
  });

  it("is once per turn", () => {
    const state = freeRetreatBoard();
    const next = must(
      applyAction(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }),
    );
    expectErr(
      next,
      { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 },
      "ALREADY_RETREATED",
    );
  });

  it("resets with the next turn", () => {
    let state = freeRetreatBoard();
    state = must(
      applyAction(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }),
    );
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    // Turn 3: the new active is fix-basic-1 (cost 1) — attach and retreat.
    const energy = handUid(state, "p1", "fix-energy");
    state = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: energy,
        target: { spot: "active" },
      }),
    );
    const next = must(
      applyAction(state, {
        type: "retreat",
        seat: "p1",
        discardEnergy: [energy],
        promoteBenchIndex: 0,
      }),
    );
    expect(next.players.p1.discard).toContain(energy);
  });
});

describe("endTurn", () => {
  it("hands the turn over with an automatic draw", () => {
    const state = costOneBoard();
    const p2HandBefore = state.players.p2.hand.length;
    const { state: next, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(next.turn).toBe(2);
    expect(next.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(next.allowances).toEqual({ energyAttached: false, retreated: false, supporterPlayed: false, stadiumPlayed: false, stadiumAbilityUsed: false, abilitiesUsed: [] });
    expect(next.players.p2.hand).toHaveLength(p2HandBefore + 1);
  });

  it("rejects the off-turn seat", () => {
    expectErr(costOneBoard(), { type: "endTurn", seat: "p2" }, "WRONG_SEAT");
  });
});

describe("deck-out", () => {
  it("the player who cannot draw at turn start loses", () => {
    let state = driveSetup(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK }, { first: "p1" });
    let lastEvents: GameEvent[] = [];
    for (let guard = 0; guard < 200 && state.phase.kind === "turn:action"; guard++) {
      const applied = mustApply(state, { type: "endTurn", seat: state.phase.seat });
      state = applied.state;
      lastEvents = applied.events;
    }
    // p1 drew first, so p1's deck empties first: p2 wins by deck-out.
    expect(state.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p2", reason: "deckOut" },
    });
    expect(state.players.p1.deck).toHaveLength(0);
    expect(types(lastEvents)).toEqual([
      "TURN_ENDED",
      "TURN_STARTED",
      "GAME_OVER", // no CARDS_DRAWN — the loss is checked at draw time
    ]);
    const over = lastEvents.at(-1);
    if (over?.type !== "GAME_OVER") throw new Error("expected GAME_OVER");
    expect(over.outcome).toEqual({ result: "win", winner: "p2", reason: "deckOut" });
  });

  it("a finished game rejects every further action", () => {
    let state = driveSetup(1, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK }, { first: "p1" });
    for (let guard = 0; guard < 200 && state.phase.kind === "turn:action"; guard++) {
      state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
    }
    expect(state.phase.kind).toBe("gameOver");
    for (const seat of ["p1", "p2"] as const) {
      expectErr(state, { type: "endTurn", seat }, "GAME_OVER");
      expectErr(state, { type: "endTurn", seat: otherSeat(seat) }, "GAME_OVER");
    }
  });
});
