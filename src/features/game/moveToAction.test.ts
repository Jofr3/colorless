// Pure-logic suite (node env): the drag → GameAction router, exercised over
// REAL engine states (the engine's own test fixtures + the projection), so a
// contract drift between the three surfaces breaks here, not on the page.

import { describe, expect, it } from "vitest";
import type { GameState, Phase, Seat } from "@luminous/engine";
import { applyAction } from "@luminous/engine";
import {
  MIXED_DECK,
  driveSetup,
  handUid,
  must,
  mustCreate,
} from "../../../packages/engine/src/testFixtures";
import type { CardMoveRequest, CardPlacement } from "../playmat/types";
import { moveToAction, type MoveTranslationContext } from "./moveToAction";
import { projectGameState } from "./projection";

// Seed 170: MIXED vs MIXED runs mulligan-free (see projection.test.ts), so
// chooseFirstPlayer lands straight on setup:place.
const SEED = 170;
const DECKS = { p1: MIXED_DECK, p2: MIXED_DECK };

function placingState(): GameState {
  const created = mustCreate(SEED, DECKS).state;
  if (created.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  const winner = created.phase.coinWinner;
  const state = must(
    applyAction(created, { type: "chooseFirstPlayer", seat: winner, first: "p1" }),
  );
  if (state.phase.kind !== "setup:place")
    throw new Error(`expected setup:place, got ${state.phase.kind}`);
  return state;
}

function turnState(): GameState {
  return driveSetup(SEED, DECKS, {
    first: "p1",
    active: { p1: "fix-basic-1", p2: "fix-basic-1" },
    bench: { p1: ["fix-basic-0"] },
  });
}

function contextOf(state: GameState, viewerSeat: Seat, phase?: Phase): MoveTranslationContext {
  const effective = phase ?? state.phase;
  return {
    phaseKind: effective.kind,
    isViewerTurn: effective.kind === "turn:action" && effective.seat === viewerSeat,
    viewerSeat,
    board: projectGameState(state, viewerSeat).board,
  };
}

const fromHand = (index: number): CardPlacement => ({ owner: "you", zone: "hand", index });

function request(cardId: string, from: CardPlacement, to: CardPlacement): CardMoveRequest {
  return { cardId, from, to };
}

describe("moveToAction — setup:place", () => {
  it("routes own hand card → active slot to setupPlaceActive", () => {
    const state = placingState();
    const uid = handUid(state, "p1", "fix-basic-1");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "active" }),
      contextOf(state, "p1"),
    );
    expect(action).toEqual({ type: "setupPlaceActive", seat: "p1", uid });
  });

  it("routes own hand card → bench to setupPlaceBench", () => {
    const state = placingState();
    const uid = handUid(state, "p1", "fix-basic-1");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "bench", index: 0 }),
      contextOf(state, "p1"),
    );
    expect(action).toEqual({ type: "setupPlaceBench", seat: "p1", uid });
  });

  it("routes ANY hand card (the engine is the judge of Basic-ness)", () => {
    const state = placingState();
    const uid = handUid(state, "p1", "fix-energy");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "active" }),
      contextOf(state, "p1"),
    );
    // The translated action is then REJECTED by the engine — routing only.
    expect(action).toEqual({ type: "setupPlaceActive", seat: "p1", uid });
    const applied = action === null ? null : applyAction(state, action);
    expect(applied?.ok).toBe(false);
  });

  it("translates for whichever seat is viewing", () => {
    const state = placingState();
    const uid = handUid(state, "p2", "fix-basic-1");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "active" }),
      contextOf(state, "p2"),
    );
    expect(action).toEqual({ type: "setupPlaceActive", seat: "p2", uid });
  });
});

describe("moveToAction — turn:action", () => {
  it("routes hand energy → active to attachEnergy {spot: active}", () => {
    const state = turnState();
    const uid = handUid(state, "p1", "fix-energy");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "active" }),
      contextOf(state, "p1"),
    );
    expect(action).toEqual({
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    // The routed action is engine-legal on this real board.
    expect(action === null ? false : applyAction(state, action).ok).toBe(true);
  });

  it("routes hand energy → occupied bench slot to attachEnergy {spot: bench}", () => {
    const state = turnState();
    const uid = handUid(state, "p1", "fix-energy");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "bench", index: 0 }),
      contextOf(state, "p1"),
    );
    expect(action).toEqual({
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "bench", index: 0 },
    });
  });

  it("does not attach energy to an index-less bench container drop", () => {
    const state = turnState();
    const uid = handUid(state, "p1", "fix-energy");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "bench" }),
      contextOf(state, "p1"),
    );
    expect(action).toBeNull();
  });

  it("routes hand Pokémon → a FREE bench slot to playBasicToBench", () => {
    const state = turnState();
    const uid = handUid(state, "p1", "fix-basic-1");
    // bench[1] is empty (turnState benches only fix-basic-0 at index 0).
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "bench", index: 1 }),
      contextOf(state, "p1"),
    );
    expect(action).toEqual({ type: "playBasicToBench", seat: "p1", uid });
    expect(action === null ? false : applyAction(state, action).ok).toBe(true);
  });

  it("routes hand Pokémon → the Active (an evolve gesture, §10)", () => {
    const state = turnState();
    const uid = handUid(state, "p1", "fix-basic-1");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "active" }),
      contextOf(state, "p1"),
    );
    // Routing only — the engine judges the evolution (here it would reject).
    expect(action).toEqual({ type: "evolve", seat: "p1", uid, target: { spot: "active" } });
  });

  it("routes hand Pokémon → an OCCUPIED bench slot (an evolve gesture, §10)", () => {
    const state = turnState();
    const uid = handUid(state, "p1", "fix-basic-1");
    // bench[0] holds fix-basic-0 — dropping onto it aims the evolution there.
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "bench", index: 0 }),
      contextOf(state, "p1"),
    );
    expect(action).toEqual({
      type: "evolve",
      seat: "p1",
      uid,
      target: { spot: "bench", index: 0 },
    });
  });

  it("returns null when the phase belongs to the other seat", () => {
    const state = turnState(); // p1's turn 1
    const uid = handUid(state, "p2", "fix-energy");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "active" }),
      contextOf(state, "p2"),
    );
    expect(action).toBeNull();
  });
});

describe("moveToAction — everything else springs back", () => {
  it("hand → hand reorder is not an engine action", () => {
    const state = turnState();
    const uid = handUid(state, "p1", "fix-energy");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "hand", index: 3 }),
      contextOf(state, "p1"),
    );
    expect(action).toBeNull();
  });

  it("board-to-board drags (bench → active) are dialog flows, not drags", () => {
    const state = turnState();
    const action = moveToAction(
      request("p1#0", { owner: "you", zone: "bench", index: 0 }, { owner: "you", zone: "active" }),
      contextOf(state, "p1"),
    );
    expect(action).toBeNull();
  });

  it("never dispatches for opponent-owned placements (positional back ids)", () => {
    const state = turnState();
    const action = moveToAction(
      request(
        "opponent-hand-0",
        { owner: "opponent", zone: "hand", index: 0 },
        { owner: "opponent", zone: "bench", index: 0 },
      ),
      contextOf(state, "p1"),
    );
    expect(action).toBeNull();
  });

  it("ignores a cardId the projected hand does not hold (stale drag)", () => {
    const state = turnState();
    const action = moveToAction(
      request("p2#0", fromHand(0), { owner: "you", zone: "bench", index: 0 }),
      contextOf(state, "p1"),
    );
    expect(action).toBeNull();
  });

  it("returns null in interrupt phases (ko:promote is a dialog decision)", () => {
    const state = turnState();
    const uid = handUid(state, "p1", "fix-basic-1");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "bench", index: 0 }),
      contextOf(state, "p1", { kind: "ko:promote", seat: "p1" }),
    );
    expect(action).toBeNull();
  });

  it("returns null in setup:drawExtra (a button decision)", () => {
    const state = turnState();
    const uid = handUid(state, "p1", "fix-basic-1");
    const action = moveToAction(
      request(uid, fromHand(0), { owner: "you", zone: "active" }),
      contextOf(state, "p1", {
        kind: "setup:drawExtra",
        owed: { p1: 1, p2: 0 },
        decided: { p1: false, p2: true },
      }),
    );
    expect(action).toBeNull();
  });
});
