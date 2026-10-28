import { describe, expect, it } from "vitest";
import { pendingMulligansOf } from "./mulligans";
import { driveSetup } from "./testFixtures";
import { redactGame } from "./redact";
import type { GameState } from "./types";

function opening(): GameState {
  const state = driveSetup(170);
  return {
    ...state,
    turn: 0,
    players: {
      p1: { ...state.players.p1, mulligans: 2 },
      p2: { ...state.players.p2, mulligans: 5 },
    },
    phase: { kind: "setup:place", stage: "opening", ready: { p1: false, p2: false } },
  };
}

describe("mulligan deck markers", () => {
  it("shows bonus cards on the recipient's deck to both players and spectators", () => {
    const state = opening();
    expect(pendingMulligansOf(state, "p1")).toBe(5);
    expect(pendingMulligansOf(state, "p2")).toBe(2);
    expect(redactGame(state, "p1").board.you.mulliganCount).toBe(5);
    expect(redactGame(state, "p2").board.opponent.mulliganCount).toBe(5);
    expect(redactGame(state, "p1", true).board.opponent.mulliganCount).toBe(2);
  });

  it("clears the drawing player's die while leaving the other player's pending cards", () => {
    const state: GameState = {
      ...opening(),
      phase: {
        kind: "setup:drawExtra",
        owed: { p1: 5, p2: 2 },
        decided: { p1: true, p2: false },
        bonusCards: { p1: [], p2: [] },
      },
    };
    expect(pendingMulligansOf(state, "p1")).toBe(0);
    expect(pendingMulligansOf(state, "p2")).toBe(2);
    expect(redactGame(state, "p1").board.you.mulliganCount).toBe(0);
    expect(redactGame(state, "p2").board.you.mulliganCount).toBe(2);
  });

  it("uses the actual cards owed once the bonus draw phase begins", () => {
    const state: GameState = {
      ...opening(),
      phase: {
        kind: "setup:drawExtra",
        owed: { p1: 3, p2: 1 },
        decided: { p1: false, p2: false },
        bonusCards: { p1: [], p2: [] },
      },
    };
    expect(pendingMulligansOf(state, "p1")).toBe(3);
    expect(pendingMulligansOf(state, "p2")).toBe(1);
  });

  it("removes both dice during bonus placement and regular play", () => {
    const state: GameState = {
      ...opening(),
      phase: { kind: "setup:place", stage: "bonus", ready: { p1: false, p2: false } },
    };
    expect(pendingMulligansOf(state, "p1")).toBe(0);
    expect(pendingMulligansOf(state, "p2")).toBe(0);
    expect(pendingMulligansOf({ ...opening(), turn: 1 }, "p1")).toBe(0);
    expect(pendingMulligansOf({ ...opening(), turn: 1 }, "p2")).toBe(0);
  });
});
