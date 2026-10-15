// Pure-logic suite (node env): the hot-seat viewer selector and the host
// reducer — the parts of useLocalGame that must be exactly right for the
// game not to soft-lock (D17: gate on who must ACT, never on turn owner).

import { describe, expect, it } from "vitest";
import type { GameState, Phase, Seat } from "@luminous/engine";
import {
  MIXED_DECK,
  ALL_BASIC_DECK,
  deckOf,
  driveSetup,
  attachFromDeck,
  handFromDeck,
  handUid,
  mustApply,
  mustCreate,
} from "../../../packages/engine/src/testFixtures";
import {
  hostReducer,
  initHost,
  stepTarget,
  waitingSeatOf,
  type LocalGameSetup,
} from "./useLocalGame";

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function withPhase(state: GameState, phase: Phase): GameState {
  return { ...state, phase };
}

describe("waitingSeatOf", () => {
  const base = mustCreate(170).state;

  it("setup:chooseFirst waits on the coin winner", () => {
    if (base.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    expect(waitingSeatOf(base, "p1")).toBe(base.phase.coinWinner);
    expect(waitingSeatOf(base, "p2")).toBe(base.phase.coinWinner);
  });

  it("setup:drawExtra prefers the current viewer among the undecided", () => {
    const both = withPhase(base, {
      kind: "setup:drawExtra",
      owed: { p1: 1, p2: 1 },
      decided: { p1: false, p2: false },
    });
    expect(waitingSeatOf(both, "p1")).toBe("p1");
    expect(waitingSeatOf(both, "p2")).toBe("p2");
    const p1Done = withPhase(base, {
      kind: "setup:drawExtra",
      owed: { p1: 1, p2: 1 },
      decided: { p1: true, p2: false },
    });
    expect(waitingSeatOf(p1Done, "p1")).toBe("p2");
  });

  it("setup:place flips to the seat still not ready", () => {
    const p1Ready = withPhase(base, { kind: "setup:place", ready: { p1: true, p2: false } });
    expect(waitingSeatOf(p1Ready, "p1")).toBe("p2");
    expect(waitingSeatOf(p1Ready, "p2")).toBe("p2");
  });

  it("turn:action waits on the turn seat", () => {
    const turn = withPhase(base, { kind: "turn:action", seat: "p2" });
    expect(waitingSeatOf(turn, "p1")).toBe("p2");
  });

  it("ko:promote waits on the KO'd NON-turn seat (the D17 trap)", () => {
    const parked = withPhase(base, { kind: "ko:promote", seat: "p2" });
    // p1 is mid-turn; the DEFENDER decides.
    expect(waitingSeatOf(parked, "p1")).toBe("p2");
  });

  it("ko:takePrizes waits on the KOing seat", () => {
    const parked = withPhase(base, { kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(waitingSeatOf(parked, "p2")).toBe("p1");
  });

  it("gameOver keeps the current viewer", () => {
    const over = withPhase(base, {
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
    expect(waitingSeatOf(over, "p2")).toBe("p2");
  });
});

function freshSetup(): LocalGameSetup {
  const { state, events } = mustCreate(170, { p1: MIXED_DECK, p2: MIXED_DECK });
  return { state, events, names: NAMES, startedAt: 1_000 };
}

describe("initHost / hostReducer", () => {
  it("holds the pre-toss snapshot, blocks actions, and only releases the matching dice batch", () => {
    const deck = deckOf({ "fix-basic-1": 30, "sv01-168": 20, "fix-fire-energy": 10 });
    const state = attachFromDeck(
      handFromDeck(driveSetup(7, { p1: deck, p2: deck }, { first: "p1" }), "p1", "sv01-168", 1),
      "p2",
      "fix-fire-energy",
      1,
    );
    const initial = initHost({ state, events: [], names: NAMES, startedAt: 0 });
    const tossing = hostReducer(initial, {
      action: { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", "sv01-168") },
      at: 1000,
    });
    expect(tossing.coinFlipBatch).not.toBeNull();
    expect(tossing.coinFlipPresentation).toEqual({
      game: initial.game,
      log: initial.log,
      viewerSeat: initial.viewerSeat,
    });
    expect(tossing.game).not.toBe(initial.game);
    expect(hostReducer(tossing, { type: "previousTurn" })).toBe(tossing);
    expect(hostReducer(tossing, { action: { type: "endTurn", seat: "p1" }, at: 2000 })).toBe(
      tossing,
    );
    expect(hostReducer(tossing, { type: "finishCoinFlip", id: -1 })).toBe(tossing);
    const id = tossing.coinFlipBatch?.id;
    if (id === undefined) throw new Error("missing dice batch");
    const complete = hostReducer(tossing, { type: "finishCoinFlip", id });
    expect(complete.coinFlipPresentation).toBeNull();
    expect(complete.game).toBe(tossing.game);
    expect(complete.log).toBe(tossing.log);
    expect(hostReducer(complete, { type: "finishCoinFlip", id })).toBe(complete);
  });

  it("rewinds to a turn's start and returns to the complete latest position", () => {
    const state = handFromDeck(
      driveSetup(
        11,
        {
          p1: deckOf({ "fix-attacker": 30, "fix-fire-energy": 30 }),
          p2: MIXED_DECK,
        },
        { first: "p1", active: { p1: "fix-attacker" } },
      ),
      "p1",
      "fix-fire-energy",
      2,
    );
    const uid = handUid(state, "p1", "fix-fire-energy");
    const start = initHost({ state, events: [], names: NAMES, startedAt: 0 });
    const attached = hostReducer(start, {
      action: { type: "attachEnergy", seat: "p1", uid, target: { spot: "active" } },
      at: 1000,
    });
    expect(attached.lastError).toBeNull();
    const second = hostReducer(attached, { action: { type: "endTurn", seat: "p1" }, at: 2000 });
    const third = hostReducer(second, { action: { type: "endTurn", seat: "p2" }, at: 3000 });
    const nextEnergy = handUid(third.game, "p1", "fix-fire-energy");
    const latest = hostReducer(third, {
      action: { type: "attachEnergy", seat: "p1", uid: nextEnergy, target: { spot: "active" } },
      at: 4000,
    });
    expect(latest.lastError).toBeNull();
    const back = hostReducer(hostReducer(latest, { type: "previousTurn" }), {
      type: "previousTurn",
    });
    expect(back.game).toEqual(start.game);
    expect(back.log).toEqual(start.log);
    expect(back.viewerSeat).toBe(start.viewerSeat);
    expect(back.game.players.p1.hand).toContain(uid);
    expect(back.game.rngState).toBe(start.game.rngState);
    expect(hostReducer(back, { type: "previousTurn" })).toBe(back);
    const forward = hostReducer(hostReducer(back, { type: "nextTurn" }), { type: "nextTurn" });
    expect(forward.game).toBe(latest.game);
    expect(forward.log).toBe(latest.log);
    expect(hostReducer(forward, { type: "nextTurn" })).toBe(forward);
  });

  it("undoes and redoes single actions, and jumps turns by checkpoint", () => {
    const state = handFromDeck(
      driveSetup(
        11,
        {
          p1: deckOf({ "fix-attacker": 30, "fix-fire-energy": 30 }),
          p2: MIXED_DECK,
        },
        { first: "p1", active: { p1: "fix-attacker" } },
      ),
      "p1",
      "fix-fire-energy",
      2,
    );
    const uid = handUid(state, "p1", "fix-fire-energy");
    const start = initHost({ state, events: [], names: NAMES, startedAt: 0 });
    expect(hostReducer(start, { type: "undoAction" })).toBe(start);
    expect(hostReducer(start, { type: "undoTurn" })).toBe(start);
    const attached = hostReducer(start, {
      action: { type: "attachEnergy", seat: "p1", uid, target: { spot: "active" } },
      at: 1000,
    });
    expect(attached.steps).toHaveLength(2);
    expect(attached.steps[1]?.checkpoint).toBe(false);
    // One action back restores the hand without touching the turn history.
    const undone = hostReducer(attached, { type: "undoAction" });
    expect(undone.game).toBe(start.game);
    expect(undone.game.players.p1.hand).toContain(uid);
    expect(undone.turnIndex).toBe(0);
    expect(hostReducer(undone, { type: "redoAction" }).game).toBe(attached.game);
    // Mid-turn, "undo turn" goes to the start of this turn; at a turn's
    // start it goes to the previous turn's start.
    const second = hostReducer(attached, { action: { type: "endTurn", seat: "p1" }, at: 2000 });
    const third = hostReducer(second, { action: { type: "endTurn", seat: "p2" }, at: 3000 });
    expect(third.steps[3]?.checkpoint).toBe(true);
    const nextEnergy = handUid(third.game, "p1", "fix-fire-energy");
    const latest = hostReducer(third, {
      action: { type: "attachEnergy", seat: "p1", uid: nextEnergy, target: { spot: "active" } },
      at: 4000,
    });
    const turnStart = hostReducer(latest, { type: "undoTurn" });
    expect(turnStart.game).toBe(third.game);
    expect(turnStart.turnIndex).toBe(third.turnIndex);
    const previousTurn = hostReducer(turnStart, { type: "undoTurn" });
    expect(previousTurn.game).toBe(second.game);
    expect(hostReducer(previousTurn, { type: "redoTurn" }).game).toBe(third.game);
    expect(hostReducer(turnStart, { type: "redoTurn" }).game).toBe(latest.game);
    expect(hostReducer(latest, { type: "redoTurn" })).toBe(latest);
    // A new action after an undo discards the redo future.
    const replayed = hostReducer(undone, { action: { type: "endTurn", seat: "p1" }, at: 5000 });
    expect(replayed.steps).toHaveLength(2);
    expect(hostReducer(replayed, { type: "redoAction" })).toBe(replayed);
    // Turn navigation keeps the step cursor on the matching checkpoint
    // (previousTurn from turn 3 lands on turn 2's start, step 2).
    const back = hostReducer(latest, { type: "previousTurn" });
    expect(back.game).toBe(second.game);
    expect(back.stepIndex).toBe(2);
    expect(hostReducer(back, { type: "undoAction" }).game).toBe(attached.game);
  });

  it("skips a card's open prompt when undoing or redoing single actions", () => {
    const step = (kind: string, checkpoint = false) =>
      ({ game: { phase: { kind } }, log: [], viewerSeat: "p1", checkpoint, turnIndex: 0 }) as never;
    // 0 start, 1 Trainer played (prompt open), 2 its pick resolved, 3 another action.
    const steps = [
      step("turn:action", true),
      step("effect:choose"),
      step("turn:action"),
      step("turn:action"),
    ];
    const host = (stepIndex: number) =>
      ({ steps, stepIndex }) as unknown as Parameters<typeof stepTarget>[0];
    expect(stepTarget(host(2), "undoAction")).toBe(0);
    expect(stepTarget(host(0), "redoAction")).toBe(2);
    expect(stepTarget(host(3), "undoAction")).toBe(2);
    expect(stepTarget(host(1), "undoAction")).toBe(0);
    expect(stepTarget(host(2), "redoAction")).toBe(3);
  });

  it("keeps future turns after rejection and replaces them after a replayed action", () => {
    const start = initHost({ state: driveSetup(170), events: [], names: NAMES, startedAt: 0 });
    const second = hostReducer(start, { action: { type: "endTurn", seat: "p1" }, at: 1000 });
    const latest = hostReducer(second, { action: { type: "endTurn", seat: "p2" }, at: 2000 });
    const back = hostReducer(latest, { type: "previousTurn" });
    const rejected = hostReducer(back, { action: { type: "endTurn", seat: "p1" }, at: 3000 });
    expect(rejected.lastError?.code).toBe("WRONG_SEAT");
    expect(hostReducer(rejected, { type: "nextTurn" }).game).toBe(latest.game);
    const replayed = hostReducer(back, { action: { type: "endTurn", seat: "p2" }, at: 4000 });
    expect(replayed.game).toEqual(latest.game);
    expect(replayed.log).not.toEqual(latest.log);
    expect(hostReducer(replayed, { type: "nextTurn" })).toBe(replayed);
    expect(hostReducer(replayed, { type: "previousTurn" }).game).toBe(second.game);
  });

  it("rewinds both setup players and the starting-player choice, and allows replay", () => {
    const result = mustCreate(170, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
    const created = { state: result.state, events: result.events, names: NAMES, startedAt: 0 };
    if (created.state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    const initial = initHost(created);
    let host = hostReducer(initial, {
      action: { type: "chooseFirstPlayer", seat: created.state.phase.coinWinner, first: "p1" },
      at: 1000,
    });
    const firstSetup = host;
    for (let player = 0; player < 2; player++) {
      const uid = host.game.players[host.viewerSeat].hand[0];
      if (!uid) throw new Error("Expected an opening Basic");
      host = hostReducer(host, {
        action: { type: "setupPlaceActive", seat: host.viewerSeat, uid },
        at: 2000,
      });
      host = hostReducer(host, {
        action: { type: "setupReady", seat: host.viewerSeat },
        at: 3000,
      });
      expect(host.lastError).toBeNull();
    }
    expect(host.game.turn).toBe(1);
    expect(host.turns).toHaveLength(4);
    const secondSetup = hostReducer(host, { type: "previousTurn" });
    expect(secondSetup.game.phase.kind).toBe("setup:place");
    expect(secondSetup.viewerSeat).not.toBe(firstSetup.viewerSeat);
    expect(secondSetup.game.players[secondSetup.viewerSeat].active).toBeNull();
    expect(secondSetup.game.players[firstSetup.viewerSeat].prizes).toHaveLength(6);
    const back = hostReducer(secondSetup, { type: "previousTurn" });
    expect(back.game).toBe(firstSetup.game);
    expect(back.viewerSeat).toBe(firstSetup.viewerSeat);
    const choice = hostReducer(back, { type: "previousTurn" });
    expect(choice.game).toBe(initial.game);
    expect(choice.log).toEqual(initial.log);
    expect(hostReducer(choice, { type: "previousTurn" })).toBe(choice);
    const replayed = hostReducer(choice, {
      action: { type: "chooseFirstPlayer", seat: choice.viewerSeat, first: "p2" },
      at: 4000,
    });
    expect(replayed.game.firstPlayer).toBe("p2");
    expect(replayed.turns).toHaveLength(2);
    expect(hostReducer(replayed, { type: "nextTurn" })).toBe(replayed);
  });

  it("initializes with the creation log and the coin winner as viewer", () => {
    const setup = freshSetup();
    const host = initHost(setup);
    if (setup.state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    expect(host.viewerSeat).toBe(setup.state.phase.coinWinner);
    expect(host.log.length).toBeGreaterThan(0);
    expect(host.lastError).toBeNull();
  });

  it("applies a legal action: new game, appended log, re-derived viewer", () => {
    const setup = freshSetup();
    const host = initHost(setup);
    if (setup.state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    const winner = setup.state.phase.coinWinner;
    const next = hostReducer(host, {
      action: { type: "chooseFirstPlayer", seat: winner, first: "p1" },
      at: 61_000,
    });
    expect(next.game.phase.kind).toBe("setup:place"); // seed 170: no mulligans
    expect(next.log.length).toBeGreaterThan(host.log.length);
    expect(next.lastError).toBeNull();
    // Nobody has placed yet — the viewer holding the device places first.
    expect(next.viewerSeat).toBe(winner);
    // The elapsed stamp came from the dispatched wall clock, not the reducer.
    const appended = next.log[host.log.length];
    expect(appended?.kind === "action" && appended.elapsed).toBe("+01:00");
  });

  it("keeps the game IDENTICAL on a rejected action and surfaces the error", () => {
    const setup = freshSetup();
    const host = initHost(setup);
    const wrongSeat = host.viewerSeat === "p1" ? "p2" : "p1";
    const rejected = hostReducer(host, {
      action: { type: "chooseFirstPlayer", seat: wrongSeat, first: wrongSeat },
      at: 2_000,
    });
    expect(rejected.game).toBe(host.game); // same reference — nothing changed
    expect(rejected.log).toBe(host.log);
    expect(rejected.lastError?.code).toBe("WRONG_SEAT");
    expect(rejected.lastError?.nonce).toBe(1);
    // An identical repeat bumps the nonce so the pill re-announces.
    const again = hostReducer(rejected, {
      action: { type: "chooseFirstPlayer", seat: wrongSeat, first: wrongSeat },
      at: 3_000,
    });
    expect(again.lastError?.nonce).toBe(2);
  });

  it("clears a stale rejection when a later action is accepted", () => {
    const setup = freshSetup();
    const host = initHost(setup);
    if (setup.state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    const winner = setup.state.phase.coinWinner;
    const wrongSeat = winner === "p1" ? "p2" : "p1";
    const rejected = hostReducer(host, {
      action: { type: "chooseFirstPlayer", seat: wrongSeat, first: wrongSeat },
      at: 1_000,
    });
    expect(rejected.lastError).not.toBeNull();
    const accepted = hostReducer(rejected, {
      action: { type: "chooseFirstPlayer", seat: winner, first: "p1" },
      at: 2_000,
    });
    // The accepted action supersedes the rejection — critical because the
    // hot-seat viewer flip rides on accepted actions: the next seat must
    // never inherit the previous seat's error pill.
    expect(accepted.lastError).toBeNull();
    expect(accepted.game).not.toBe(rejected.game);
  });

  it("hands the device to the KO'd defender when a promotion parks", () => {
    // p1 Bites fix-victim (30 HP, OHKO) with two benched defenders: the
    // prize pick parks first (p1), then the promotion parks for p2.
    const KO_SEED = 11;
    let state = driveSetup(
      KO_SEED,
      {
        p1: deckOf({ "fix-attacker": 30, "fix-fire-energy": 20, "fix-water-energy": 10 }),
        p2: deckOf({ "fix-victim": 40, "fix-water-energy": 20 }),
      },
      {
        first: "p1",
        active: { p1: "fix-attacker", p2: "fix-victim" },
        bench: { p2: ["fix-victim", "fix-victim"] },
      },
    );
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;

    let host = initHost({ state, events: [], names: NAMES, startedAt: 0 });
    expect(host.viewerSeat).toBe("p1");
    host = hostReducer(host, { action: { type: "attack", seat: "p1", index: 0 }, at: 1_000 });
    expect(host.game.phase.kind).toBe("ko:takePrizes");
    expect(host.viewerSeat).toBe("p1"); // the KOing seat picks its prize
    host = hostReducer(host, {
      action: { type: "takePrizes", seat: "p1", prizeIndices: [0] },
      at: 2_000,
    });
    expect(host.game.phase.kind).toBe("ko:promote");
    expect(host.viewerSeat).toBe("p2"); // the DEFENDER decides mid-p1-turn
    host = hostReducer(host, { action: { type: "promote", seat: "p2", benchIndex: 0 }, at: 3_000 });
    // The parked tail resumes: p1's turn ends, p2's turn 4 begins.
    expect(host.game.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(host.viewerSeat).toBe("p2");
  });
});
