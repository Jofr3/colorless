// @vitest-environment jsdom
// 🆕🆕🆕 D567 — TEAM ROCKET'S BOTHER-BOT `sv10-172` AT THE CLICK: the FIRST `choosePrize` park over the
// OPPONENT's row. No wire or HUD shape moved for it — the prompt is `{indices, note}` and
// `ChoosePrizeDialog` draws face-down tiles by index — so this rung pins the two things that DID move:
// the note is the opponent's wording, and the tile the controller taps is answered against the
// OPPONENT's row (the engine turns p2's prize, never p1's). Driven on a REAL engine park, on a LOCAL
// pool that adds Bother-Bot to the fixture pool (D275).

import type { Card } from "@luminous/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState } from "@luminous/engine";
import { applyAction, createGame, redactGame } from "@luminous/engine";
import { FIXTURE_POOL, deckOf, trainerCard } from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState, projectionFromRedacted } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const BOTHER = "sv10-172";
const NOTE = "Choose 1 of your opponent's face-down Prize cards to turn face up.";
const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [BOTHER]: {
    ...trainerCard(
      BOTHER,
      "Item",
      "Turn 1 of your opponent's face-down Prize cards face up and choose a random card from your opponent's hand. Your opponent reveals that card. You may have your opponent switch those cards. (That Prize card remains face up for the rest of the game.)",
    ),
    name: "Team Rocket's Bother-Bot",
  },
};
const DECK = deckOf({ [BOTHER]: 4, "fix-basic-1": 8, "fix-energy": 48 });

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** P1 on turn 2 (p2 went first and passed), Bother-Bot played and parked on p2's row. */
function parked(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    const uid = state.players[seat].hand.find((h) => state.cardIdByUid[h] === "fix-basic-1");
    if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid }));
  }
  for (const seat of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  const side = state.players.p1;
  const bot = [...side.hand, ...side.deck].find((u) => state.cardIdByUid[u] === BOTHER);
  if (bot === undefined) throw new Error("no Bother-Bot");
  state = {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, hand: [...side.hand.filter((u) => u !== bot), bot], deck: side.deck.filter((u) => u !== bot) },
    },
  };
  return must(applyAction(state, { type: "playTrainer", seat: "p1", uid: bot }));
}

function renderHud(state: GameState, dispatch: (action: GameAction) => void) {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, "p1")}
      viewerSeat="p1"
      names={{ p1: "Ember", p2: "Tide" }}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />,
  );
}

describe("🛑 GameHud choosePrize — the OPPONENT's row (Bother-Bot)", () => {
  it("the premise: a real park over p2's six face-down indices, in the opponent's wording", () => {
    const state = parked(11);
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.prompt).toEqual({ kind: "choosePrize", indices: [0, 1, 2, 3, 4, 5], note: NOTE });
    // The wire rebuild is the local projection (no shape moved for the opponent side).
    expect(projectionFromRedacted(redactGame(state, "p1"))).toEqual(projectGameState(state, "p1"));
  });

  it("🛑 the dialog shows the OPPONENT note, and the tapped tile turns p2's prize — never p1's", () => {
    const state = parked(11);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Prize \d$/ })).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Prize 3" }));
    const action = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(action).toEqual({ type: "resolveEffect", seat: "p1", choice: { kind: "prize", index: 2 } });
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.state.players.p2.faceUpPrizes).toEqual([state.players.p2.prizes[2]]);
    expect(result.state.players.p1.faceUpPrizes).toEqual([]);
  });
});
