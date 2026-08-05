// Pure-logic suite (node env): the hot-seat viewer selector and the host
// reducer — the parts of useLocalGame that must be exactly right for the
// game not to soft-lock (D17: gate on who must ACT, never on turn owner).

import { describe, expect, it } from "vitest";
import type { GameState, Phase, Seat } from "@luminous/engine";
import {
  MIXED_DECK,
  deckOf,
  driveSetup,
  attachFromDeck,
  mustApply,
  mustCreate,
} from "../../../packages/engine/src/testFixtures";
import { hostReducer, initHost, waitingSeatOf, type LocalGameSetup } from "./useLocalGame";

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
