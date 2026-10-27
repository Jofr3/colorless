import { describe, expect, it } from "vitest";
import type { GameState, Phase, Seat } from "@colorless/engine";
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
} from "@colorless/engine/testing";
import {
  dropAutoSteps,
  hostReducer,
  initHost,
  replayHost,
  restorePosition,
  stepTarget,
  waitingSeatOf,
  type LocalGameSetup,
} from "./localHost";

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

/** p1 Bites fix-victim (30 HP, OHKO) with two benched defenders: the prize
    pick parks first (p1), then the promotion parks for p2. */
function koBoard(): GameState {
  let state = driveSetup(
    11,
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
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Two Fire Energy in hand for p1's attacker, so its turns have actions besides ending. */
function energyBoard(): GameState {
  return handFromDeck(
    driveSetup(
      11,
      { p1: deckOf({ "fix-attacker": 30, "fix-fire-energy": 30 }), p2: MIXED_DECK },
      { first: "p1", active: { p1: "fix-attacker" } },
    ),
    "p1",
    "fix-fire-energy",
    2,
  );
}

function freshSetup(): LocalGameSetup {
  const { state, events } = mustCreate(170, { p1: MIXED_DECK, p2: MIXED_DECK });
  return { state, events, names: NAMES, startedAt: 1_000 };
}

describe("initHost / hostReducer", () => {
  it("applies a coin-flipping play at once, its coins riding the new rows' cues", () => {
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
    expect(tossing.game).not.toBe(initial.game);
    const cues = tossing.log
      .slice(initial.log.length)
      .flatMap((e) => (e.kind === "action" ? (e.cues ?? []) : []));
    expect(cues.filter((c) => c.kind === "coin")).not.toEqual([]);
    const next = hostReducer(tossing, { action: { type: "endTurn", seat: "p1" }, at: 2000 });
    expect(next.lastError).toBeNull();
    expect(next.game.turn).toBe(tossing.game.turn + 1);
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
    let host = initHost({ state: koBoard(), events: [], names: NAMES, startedAt: 0 });
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

describe("the line of play", () => {
  const endTurn = (seat: Seat, at: number) => ({ action: { type: "endTurn", seat } as const, at });
  const attach = (state: GameState, at: number) => ({
    action: {
      type: "attachEnergy",
      seat: "p1",
      uid: handUid(state, "p1", "fix-fire-energy"),
      target: { spot: "active" },
    } as const,
    at,
  });
  const endTurns = (start: ReturnType<typeof initHost>, count: number) => {
    let host = start;
    for (let i = 0; i < count; i++) {
      if (host.game.phase.kind !== "turn:action") throw new Error("expected a turn");
      host = hostReducer(host, endTurn(host.game.phase.seat, 1000 * (i + 1)));
      if (host.lastError) throw new Error(host.lastError.message);
    }
    return host;
  };

  it("records each accepted action once, and a new one after an undo replaces the tail", () => {
    const setup = { state: energyBoard(), events: [], names: NAMES, startedAt: 0 };
    let host = initHost(setup);
    host = hostReducer(host, attach(host.game, 1000));
    host = hostReducer(host, endTurn("p1", 2000));
    host = hostReducer(host, endTurn("p1", 2500));
    expect(host.lastError).not.toBeNull();
    host = hostReducer(host, endTurn("p2", 3000));
    expect(host.actions.map((a) => a.at)).toEqual([1000, 2000, 3000]);
    expect(host.cursor).toBe(3);
    const undone = hostReducer(hostReducer(host, { type: "undoAction" }), { type: "undoAction" });
    expect(undone.cursor).toBe(1);
    expect(undone.actions).toBe(host.actions);
    expect(undone.log).toEqual(host.log.slice(0, undone.steps[1]?.logLength));
    const replaced = hostReducer(undone, endTurn("p1", 4000));
    expect(replaced.actions.map((a) => a.at)).toEqual([1000, 4000]);
    expect(replaced.steps.map((s) => s.actions)).toEqual([0, 1, 2]);
  });

  it("replays a line to the history the reducer built, undone and replaced actions included", () => {
    const setup = { state: energyBoard(), events: [], names: NAMES, startedAt: 0 };
    let host = initHost(setup);
    host = hostReducer(host, attach(host.game, 1000));
    host = hostReducer(host, endTurn("p1", 2000));
    host = hostReducer(host, endTurn("p2", 3000));
    host = hostReducer(host, attach(host.game, 4000));
    host = hostReducer(hostReducer(host, { type: "undoAction" }), { type: "undoAction" });
    host = hostReducer(host, endTurn("p2", 5000));
    host = hostReducer(host, endTurn("p1", 6000));
    expect(host.actions).toHaveLength(4);
    expect(replayHost(setup, host.actions)).toEqual(host);
  });

  it("replays automatic steps and drops them from the history where the table did", () => {
    const setup = { state: koBoard(), events: [], names: NAMES, startedAt: 0 };
    let host = initHost(setup);
    host = hostReducer(host, { action: { type: "attack", seat: "p1", index: 0 }, at: 1000 });
    host = hostReducer(host, {
      action: { type: "takePrizes", seat: "p1", prizeIndices: [0] },
      at: 1000,
      auto: "ko:takePrizes",
    });
    host = dropAutoSteps(host, "ko:takePrizes");
    const prized = host;
    host = hostReducer(host, { action: { type: "promote", seat: "p2", benchIndex: 0 }, at: 2000 });
    expect(host.steps.map((s) => s.game.phase.kind)).not.toContain("ko:takePrizes");
    expect(host.steps.map((s) => s.actions)).toEqual([0, 2, 3]);
    expect(replayHost(setup, host.actions)).toEqual(host);
    expect(replayHost(setup, host.actions.slice(0, 2))).toEqual(prized);
  });

  it("refuses a line the engine does not accept", () => {
    const setup = { state: energyBoard(), events: [], names: NAMES, startedAt: 0 };
    expect(replayHost(setup, [endTurn("p2", 1000)])).toBeNull();
    expect(replayHost(setup, [endTurn("p1", 1000), endTurn("p1", 2000)])).toBeNull();
    expect(replayHost(setup, [])).toEqual(initHost(setup));
  });

  it("keeps every action of a long game undoable, by action and by turn", () => {
    const setup = { state: driveSetup(170), events: [], names: NAMES, startedAt: 0 };
    const host = endTurns(initHost(setup), 60);
    expect(host.steps).toHaveLength(61);
    const latest = host;
    let back = host;
    for (let i = 59; i >= 0; i--) {
      back = hostReducer(back, { type: "undoAction" });
      expect(back.game).toBe(latest.steps[i]?.game);
      expect(back.log).toHaveLength(latest.steps[i]?.logLength ?? -1);
    }
    expect(back.game).toBe(setup.state);
    expect(back.log).toEqual(initHost(setup).log);
    expect(hostReducer(back, { type: "undoAction" })).toBe(back);
    let turns = 0;
    for (back = latest; back.stepIndex > 0; turns++) back = hostReducer(back, { type: "undoTurn" });
    expect(turns).toBe(60);
    for (let i = 0; i < 60; i++) back = hostReducer(back, { type: "redoTurn" });
    expect(back.game).toBe(latest.game);
    expect(back.log).toBe(latest.log);
  });

  it("lands on a turn whose start step was dropped, putting it back in its place", () => {
    const setup = { state: driveSetup(170), events: [], names: NAMES, startedAt: 0 };
    let host = initHost(setup);
    host = endTurns(host, 3);
    const second = host.steps[2];
    host = { ...host, steps: host.steps.filter((s) => s !== second), stepIndex: 2 };
    const back = hostReducer(host, { type: "previousTurn" });
    expect(back.game).toBe(second?.game);
    expect(back.stepIndex).toBe(2);
    expect(back.steps.map((s) => s.actions)).toEqual([0, 1, 2, 3]);
    expect(back.cursor).toBe(2);
    expect(hostReducer(back, { type: "undoAction" }).game).toBe(host.steps[1]?.game);
    expect(hostReducer(back, { type: "redoAction" }).game).toBe(host.game);
  });

  it("restores a saved place in the line, and refuses one no snapshot matches", () => {
    const setup = { state: energyBoard(), events: [], names: NAMES, startedAt: 0 };
    let host = initHost(setup);
    host = hostReducer(host, attach(host.game, 1000));
    host = hostReducer(host, endTurn("p1", 2000));
    host = hostReducer(host, endTurn("p2", 3000));
    const end = replayHost(setup, host.actions);
    if (!end) throw new Error("expected a replay");
    const undone = hostReducer(host, { type: "undoAction" });
    const turnBack = hostReducer(host, { type: "previousTurn" });
    for (const at of [host, undone, turnBack]) expect(restorePosition(end, at)).toEqual(at);
    expect(restorePosition(end, { cursor: 2, stepIndex: 0, turnIndex: 0 })).toBeNull();
    expect(restorePosition(end, { cursor: 0, stepIndex: 9, turnIndex: 0 })).toBeNull();
    expect(restorePosition(end, { cursor: 0, stepIndex: 0, turnIndex: 9 })).toBeNull();
  });
});
