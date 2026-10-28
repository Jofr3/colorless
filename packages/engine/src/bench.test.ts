import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameAction } from "./actions";
import { topUid } from "./cards";
import { ALL_BASIC_DECK, driveSetup, mustApply } from "./testFixtures";
import { makeInPlay, type GameState } from "./types";

function board(): GameState {
  return driveSetup(
    3,
    { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK },
    {
      first: "p1",
      bench: { p1: Array(5).fill("fix-basic-1"), p2: ["fix-basic-1"] },
    },
  );
}

function firstBenchUid(state: GameState): string {
  const pokemon = state.players.p1.bench[0];
  const uid = pokemon === undefined ? undefined : topUid(pokemon);
  if (uid === undefined) throw new Error("Expected a benched Pokémon");
  return uid;
}

describe("reorderBench", () => {
  it("moves an evolved, damaged body with all its attachments, without spending allowances", () => {
    const initial = board();
    const side = initial.players.p1;
    const original = side.bench[0];
    if (!original) throw new Error("Expected a benched Pokémon");
    const moved = {
      ...original,
      stack: [side.deck[0] as string, ...original.stack],
      energy: [side.deck[1] as string],
      tools: [side.deck[2] as string],
      damage: 30,
    };
    const state = {
      ...initial,
      players: {
        ...initial.players,
        p1: { ...side, deck: side.deck.slice(3), bench: [moved, ...side.bench.slice(1)] },
      },
    };
    const before = JSON.stringify(state);
    const result = mustApply(state, {
      type: "reorderBench",
      seat: "p1",
      uid: topUid(moved) as string,
      index: 4,
    });
    expect(result.state.players.p1.bench).toEqual([...side.bench.slice(1), moved]);
    expect(result.state.players.p1.bench[4]).toBe(moved);
    expect(result.state.players.p1.active).toBe(side.active);
    expect(result.state.players.p2).toBe(initial.players.p2);
    expect(result.state.allowances).toBe(initial.allowances);
    expect(result.state.phase).toBe(initial.phase);
    expect(result.state.turn).toBe(initial.turn);
    expect(result.events).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
    const restored = mustApply(result.state, {
      type: "reorderBench",
      seat: "p1",
      uid: topUid(moved) as string,
      index: 0,
    });
    expect(restored.state.players.p1.bench).toEqual(state.players.p1.bench);
  });

  it("supports all eight positions on an expanded bench", () => {
    const initial = board();
    const side = initial.players.p1;
    const bench = [...side.bench, ...side.deck.slice(0, 3).map((uid) => makeInPlay(uid, 0))];
    const state = {
      ...initial,
      players: { ...initial.players, p1: { ...side, bench, deck: side.deck.slice(3) } },
    };
    const uid = firstBenchUid(state);
    const result = mustApply(state, { type: "reorderBench", seat: "p1", uid, index: 7 });
    expect(result.state.players.p1.bench.map(topUid)).toEqual([...bench.slice(1).map(topUid), uid]);
  });

  it("allows setup reordering until that seat declares ready", () => {
    const initial = board();
    const state: GameState = {
      ...initial,
      phase: { kind: "setup:place", stage: "opening", ready: { p1: false, p2: false } },
    };
    const action: GameAction = {
      type: "reorderBench",
      seat: "p1",
      uid: firstBenchUid(state),
      index: 1,
    };
    expect(applyAction(state, action).ok).toBe(true);
    const locked: GameState = {
      ...state,
      phase: { kind: "setup:place", stage: "opening", ready: { p1: true, p2: false } },
    };
    expect(applyAction(locked, action)).toMatchObject({
      ok: false,
      error: { code: "ALREADY_READY" },
    });
  });

  it("rejects off-turn moves, parked choices, stale ids, and invalid wire indices", () => {
    const state = board();
    const action: GameAction = {
      type: "reorderBench",
      seat: "p1",
      uid: firstBenchUid(state),
      index: 1,
    };
    expect(applyAction(state, { ...action, seat: "p2" })).toMatchObject({
      ok: false,
      error: { code: "WRONG_SEAT" },
    });
    expect(
      applyAction({ ...state, phase: { kind: "ko:promote", seat: "p1" } }, action),
    ).toMatchObject({ ok: false, error: { code: "BAD_PHASE" } });
    expect(applyAction(state, { ...action, uid: "missing" })).toMatchObject({
      ok: false,
      error: { code: "NO_TARGET" },
    });
    for (const index of [-1, 5, 1.5, Number.NaN, "1", undefined]) {
      expect(applyAction(state, { ...action, index } as GameAction)).toMatchObject({
        ok: false,
        error: { code: "BAD_BENCH_INDEX" },
      });
    }
  });
});
