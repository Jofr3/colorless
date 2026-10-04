// @vitest-environment jsdom
import type { Card } from "@luminous/schema";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState, Seat } from "@luminous/engine";
import { applyAction, createGame } from "@luminous/engine";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  must,
  setActiveFromDeck,
  trainerCard,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

// 🆕🆕🆕 D576 — the LOCAL HUD's twin of the online Antique Fossil surface: the fossil's Trainer row (an Item
// played onto the Bench — greyed exactly when `fossilPlayable` refuses, R-FO1) and the "Discard from play"
// section read off the engine's ONE offer funnel `discardableTargets` (R-FO3). The fossil row is the catalog
// row as the ingest writes it today (an Item, `hp: null`, `abilities: null` — decisions.md D576).

beforeAll(installDomShims);
afterEach(cleanup);

const COVER = "sv07-129";
const FILLER = "d576h-filler";
const RULE =
  "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.";
const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [COVER]: { ...trainerCard(COVER, "Item", RULE), name: "Antique Cover Fossil", hp: null, abilities: null },
  [FILLER]: battler(FILLER, {
    name: "D576 Filler",
    hp: 900,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
};
const DECK = deckOf({ [COVER]: 4, [FILLER]: 36, "fix-energy": 20 });
const NAMES = { p1: "Ember", p2: "Tide" } as const;

/** p1's turn 2 (p2 went first and passed): p1's Active a filler, its Bench `bench`, its hand `hand`. */
function board(bench: readonly string[], hand: readonly string[]): GameState {
  const created = createGame({ seed: 5764, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error("createGame failed");
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) break;
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === FILLER);
    if (uid === undefined) throw new Error(`no filler in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  // Hand surgery: everything back into the deck, then exactly `hand`.
  const side = state.players.p1;
  let deck = [...side.deck, ...side.hand];
  const newHand: string[] = [];
  for (const id of hand) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`no ${id} left`);
    deck = deck.filter((u) => u !== uid);
    newHand.push(uid);
  }
  state = { ...state, players: { ...state.players, p1: { ...side, hand: newHand, deck } } };
  state = setActiveFromDeck(state, "p1", FILLER);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  return state;
}

function renderHud(state: GameState, dispatch: (action: GameAction) => void, viewerSeat: Seat = "p1") {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, viewerSeat)}
      viewerSeat={viewerSeat}
      names={NAMES}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />,
  );
}

function section(title: string): HTMLElement | null {
  const heading = screen.queryByText(title);
  return heading === null ? null : (heading.parentElement as HTMLElement);
}

describe("GameHud — the Antique Fossils (D576)", () => {
  it("offers the fossil as a lit Trainer row with Bench room, and plays it by uid", () => {
    const state = board([FILLER], [COVER]);
    const dispatch = vi.fn<(action: GameAction) => void>();
    renderHud(state, dispatch);
    const trainers = section("Trainers");
    expect(trainers).not.toBeNull();
    const button = within(trainers as HTMLElement).getByRole("button", { name: "Antique Cover Fossil" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(dispatch.mock.calls[0]?.[0]).toEqual({ type: "playTrainer", seat: "p1", uid: state.players.p1.hand[0] });
  });

  it("greys the row on a FULL Bench — exactly when `playTrainer` refuses it", () => {
    const state = board([FILLER, FILLER, FILLER, FILLER, FILLER], [COVER]);
    renderHud(state, () => {});
    const trainers = section("Trainers") as HTMLElement;
    const button = within(trainers).getByRole("button", { name: "Antique Cover Fossil" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const refused = applyAction(state, { type: "playTrainer", seat: "p1", uid: state.players.p1.hand[0] as string });
    expect(refused.ok).toBe(false);
  });

  it("renders a Discard-from-play row per fossil in play and dispatches its spot", () => {
    const state = board([FILLER, COVER], []);
    const dispatch = vi.fn<(action: GameAction) => void>();
    renderHud(state, dispatch);
    const discard = section("Discard from play");
    expect(discard).not.toBeNull();
    const buttons = within(discard as HTMLElement).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Antique Cover Fossil (Bench 2)"]);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(dispatch.mock.calls[0]?.[0]).toEqual({
      type: "discardFromPlay",
      seat: "p1",
      target: { spot: "bench", index: 1 },
    });
  });

  it("renders NO discard section when no fossil is in play", () => {
    renderHud(board([FILLER], []), () => {});
    expect(section("Discard from play")).toBeNull();
    expect(screen.getByRole("button", { name: /Retreat/ })).not.toBeNull();
  });
});
