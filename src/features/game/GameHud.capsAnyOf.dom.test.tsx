// @vitest-environment jsdom
// 🆕🆕🆕 D566 — THE DISJUNCTIVE CAPS, AT THE CLICK (Brock's Scouting `sv09-146`).
//
// *"Search your deck for up to 2 Basic Pokémon OR 1 Evolution Pokémon"* parks ONE `chooseCards`
// whose flat `max` is 2 and whose `capsAnyOf` names the two alternatives. The engine's
// `validateChoice` refuses a MIXED answer (1 Basic + 1 Evolution) and two Evolutions; a dialog
// that let either be clicked would be the caption contradicting its own gate (D190/D222: no
// afford-then-reject). So `cappedOut` asks the validator's own question one pick ahead.
//
// Driven on a REAL engine park (the caps under test are the interpreter's), on a LOCAL pool that
// adds Brock's Scouting to the fixture pool (D275).

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

const BROCK = "sv09-146";
const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [BROCK]: {
    ...trainerCard(
      BROCK,
      "Supporter",
      "Search your deck for up to 2 Basic Pokémon or 1 Evolution Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    ),
    name: "Brock's Scouting",
  },
};
const DECK = deckOf({ [BROCK]: 4, "fix-basic-1": 8, "fix-stage1": 4, "fix-energy": 44 });

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** P1 on turn 2 (p2 went first and passed), Brock's Scouting played and parked. */
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
  // The Supporter into p1's hand (from the deck if it was not drawn).
  const side = state.players.p1;
  const brock = [...side.hand, ...side.deck].find((u) => state.cardIdByUid[u] === BROCK);
  if (brock === undefined) throw new Error("no Brock's Scouting");
  state = {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, hand: [...side.hand.filter((u) => u !== brock), brock], deck: side.deck.filter((u) => u !== brock) },
    },
  };
  return must(applyAction(state, { type: "playTrainer", seat: "p1", uid: brock }));
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

const rowButtons = () => screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") !== null);
const refused = (b: HTMLElement) => b.getAttribute("aria-disabled") === "true";
const named = (name: string) => rowButtons().filter((b) => (b.textContent ?? "").includes(name));

describe("ChooseCardsDialog — the disjunctive caps refuse a row the flat total allows", () => {
  it("the premise: a real park with `capsAnyOf` and a flat max of 2", () => {
    const state = parked(7);
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected a chooseCards park");
    }
    expect(state.phase.prompt.max).toBe(2);
    expect(state.phase.prompt.capsAnyOf).toHaveLength(2);
  });

  it("🛑 the WIRE rebuild keeps `capsAnyOf` — the online projection equals the local one (a dropped key would re-open the mixed answer)", () => {
    const state = parked(7);
    expect(projectionFromRedacted(redactGame(state, "p1"))).toEqual(projectGameState(state, "p1"));
  });

  it("🛑 after ONE Basic, every Evolution row greys and the other Basics stay live", () => {
    renderHud(parked(7), vi.fn());
    expect(rowButtons().filter(refused)).toHaveLength(0);
    fireEvent.click(named("fix-basic-1")[0] as HTMLElement);
    expect(named("fix-stage1").every(refused)).toBe(true);
    expect(named("fix-basic-1").slice(1).some(refused)).toBe(false);
    // …and clicking a greyed Evolution is INERT: the total still reads 1.
    fireEvent.click(named("fix-stage1")[0] as HTMLElement);
    expect(screen.getByText(/\(1\/2\)/)).toBeTruthy();
  });

  it("🛑 after ONE Evolution, every Basic row greys AND the other Evolutions grey (that alternative's ceiling is 1)", () => {
    renderHud(parked(7), vi.fn());
    fireEvent.click(named("fix-stage1")[0] as HTMLElement);
    expect(named("fix-basic-1").every(refused)).toBe(true);
    expect(named("fix-stage1").slice(1).every(refused)).toBe(true);
  });

  it("two Basics are reachable, and the answer the dialog sends is one the engine accepts", () => {
    const state = parked(7);
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(named("fix-basic-1")[0] as HTMLElement);
    fireEvent.click(named("fix-basic-1")[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: /^Take 2$/ }));
    const action = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(applyAction(state, action).ok).toBe(true);
  });
});
