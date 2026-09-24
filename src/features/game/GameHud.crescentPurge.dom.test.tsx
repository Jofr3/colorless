// @vitest-environment jsdom
// 🆕🆕🆕 D548 — CRESCENT PURGE ON THE **LOCAL** SURFACE: the choose-a-prize dialog, the
// face-up tile in the ko:takePrizes picker, and the wire round trip that feeds the same
// decision online.
//
// ⚠️ THE PARKS ARE DRIVEN, NOT CONSTRUCTED: the real Cresselia `sv06.5-021` attacks with
// "Crescent Purge" (index 1) on a real board, so every prompt this file renders is the
// one the engine actually produces. File-local 60-card deck (D270).

import type { GameAction, GameState, Seat } from "@luminous/engine";
import { applyAction, createGame, redactGame } from "@luminous/engine";
import type { Card } from "@luminous/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState, projectionFromRedacted } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Luna", p2: "Sol" } as const;
const CRESSELIA = "sv06.5-021";
const PURGE = 1;

const LOCAL: Record<string, Card> = {
  "d548-wall": battler("d548-wall", { types: ["Colorless"], hp: 400, retreat: 1 }),
  "d548-frail": battler("d548-frail", { types: ["Colorless"], hp: 150, retreat: 1 }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [CRESSELIA]: 4,
  "d548-wall": 4,
  "d548-frail": 4,
  "fix-psychic-energy": 20,
  "fix-basic-1": 8,
  "fix-energy": 20,
});

function localSetup(): GameState {
  const created = createGame({ seed: 20260924, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

function ready(defender: string): GameState {
  let state = localSetup();
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", CRESSELIA);
  state = attachFromDeck(state, "p1", "fix-psychic-energy", 3);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", defender);
  state = clearBench(state, "p2");
  return benchFromDeck(state, "p2", "d548-wall");
}

const act = (state: GameState, action: GameAction) => mustApply(state, action).state;
const purgeYes = (state: GameState) =>
  act(act(state, { type: "attack", seat: "p1", index: PURGE }), {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "confirm", yes: true },
  });
const pick = (state: GameState, index: number) =>
  act(state, { type: "resolveEffect", seat: "p1", choice: { kind: "prize", index } });

/** The SECOND Purge's pick: slot 2 was turned on the first, so five are offered. */
function secondPick(): GameState {
  const first = pick(purgeYes(ready("d548-wall")), 2);
  return purgeYes(act(first, { type: "endTurn", seat: "p2" }));
}

function renderHud(state: GameState, viewerSeat: Seat, dispatch: (action: GameAction) => void, wire = false) {
  render(
    <GameHud
      game={state}
      projection={
        wire ? projectionFromRedacted(redactGame(state, viewerSeat)) : projectGameState(state, viewerSeat)
      }
      viewerSeat={viewerSeat}
      names={NAMES}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />,
  );
}

describe("🛑 the local choose-a-prize dialog", () => {
  it("🛑 offers ONLY the face-down slots — the turned one is not a tile", () => {
    renderHud(secondPick(), "p1", vi.fn());
    expect(screen.getByText("Choose 1 of your face-down Prize cards to turn face up.")).toBeTruthy();
    const tiles = screen.getAllByRole("button", { name: /^Prize \d$/ });
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Prize 1",
      "Prize 2",
      "Prize 4",
      "Prize 5",
      "Prize 6",
    ]);
    expect(screen.queryByRole("button", { name: "Prize 3" })).toBeNull();
  });

  it("🛑 a tap IS the answer: it dispatches `{kind: \"prize\", index}` for that slot", () => {
    const dispatch = vi.fn();
    renderHud(secondPick(), "p1", dispatch);
    fireEvent.click(screen.getByRole("button", { name: "Prize 5" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "prize", index: 4 },
    });
  });

  it("🛑 the WIRE round trip rebuilds the same decision, and renders the same tiles", () => {
    const state = secondPick();
    expect(projectionFromRedacted(redactGame(state, "p1")).pendingDecision).toEqual(
      projectGameState(state, "p1").pendingDecision,
    );
    renderHud(state, "p1", vi.fn(), true);
    expect(screen.getAllByRole("button", { name: /^Prize \d$/ })).toHaveLength(5);
  });
});

describe("🛑 the local ko:takePrizes picker paints a FACE-UP prize and keeps it pickable", () => {
  it("🛑 the turned slot shows its card, and picking it dispatches its index", () => {
    // A paid Purge (160) Knocks Out the 150-HP defender after turning slot 3.
    const state = pick(purgeYes(ready("d548-frail")), 3);
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const uid = state.players.p1.prizes[3] as string;
    const name = POOL[state.cardIdByUid[uid] as string]?.name as string;
    const dispatch = vi.fn();
    renderHud(state, "p1", dispatch);
    expect(screen.getByText(/face-up ones included/)).toBeTruthy();
    const faceUp = screen.getByRole("button", { name: `Prize 4 — ${name} (face up)` });
    expect(faceUp.textContent).toBe(name);
    expect(screen.getAllByRole("button", { name: /^Prize \d$/ })).toHaveLength(5);
    fireEvent.click(faceUp);
    fireEvent.click(screen.getByRole("button", { name: "Take 1/1" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "takePrizes", seat: "p1", prizeIndices: [3] });
    // The caption's face-up clause is CONDITIONAL. TEST SURGERY: the same parked take with
    // the flip erased — a row with NO face-up slot (every normal game) says nothing of one.
    cleanup();
    const plain: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, faceUpPrizes: [] } },
    };
    renderHud(plain, "p1", vi.fn());
    expect(screen.getByText(/to add to your hand\.$/)).toBeTruthy();
    expect(screen.queryByText(/face-up/)).toBeNull();
  });
});
