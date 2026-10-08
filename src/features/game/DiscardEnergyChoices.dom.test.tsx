// @vitest-environment jsdom
import { applyAction, redactGame, type GameAction, type GameState } from "@luminous/engine";
import { redactedGameSchema } from "@luminous/schema";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DISCARD_ENERGY_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { OnlineHud } from "../online/components/OnlineHud";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

function board(): GameState {
  const decks = { p1: DISCARD_ENERGY_DECK, p2: DISCARD_ENERGY_DECK };
  let state = driveSetup(7, decks, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p2", "fix-basic-1");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-2");
  return benchFromDeck(state, "p2", "fix-basic-1");
}

function play(state: GameState, cardId = "fix-hammer"): GameState {
  const next = handFromDeck(state, "p1", cardId, 1);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid: handUid(next, "p1", cardId) })
    .state;
}

describe.each(["local", "online"] as const)("%s visual Energy discard picker", (surface) => {
  function show(state: GameState) {
    const onAction = vi.fn();
    if (surface === "local") {
      render(
        <GameHud
          game={state}
          projection={projectGameState(state, "p1")}
          viewerSeat="p1"
          names={{ p1: "You", p2: "Opponent" }}
          dispatch={onAction}
          onPlayAgain={() => {}}
        />,
      );
    } else {
      render(
        <OnlineHud
          game={redactedGameSchema.parse(redactGame(state, "p1"))}
          waitingOn="you"
          activePlaced={false}
          onAction={onAction}
        />,
      );
    }
    return onAction;
  }

  it("hides Pokémon without Energy and selects the Energy from the clicked host", () => {
    let state = attachFromDeck(board(), "p2", "fix-energy", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-energy", 1);
    state = play(state);
    const onAction = show(state);
    const dialog = screen.getByRole("dialog", { name: "Discard Energy" });
    expect(within(dialog).getAllByRole("group")).toHaveLength(2);
    expect(within(dialog).getAllByRole("img", { name: "fix-basic-1" })).toHaveLength(1);
    expect(
      within(dialog).queryByRole("group", { name: "fix-basic-1 · Bench 2 · opponent" }),
    ).toBeNull();
    expect(within(dialog).getByRole("img", { name: "fix-basic-2" })).toBeTruthy();
    const bench = within(dialog).getByRole("group", { name: "fix-basic-2 · Bench 1 · opponent" });
    fireEvent.click(within(bench).getByRole("button", { name: "fix-energy" }));
    expect(within(bench).getByRole("button").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard 1/1" }));
    const action = onAction.mock.calls[0]?.[0] as GameAction;
    expect(action).toEqual({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [state.players.p2.bench[0]?.energy[0]] },
    });
    expect(applyAction(state, action).ok).toBe(true);
  });

  it("lets either identical Energy copy be clicked without choosing two cards", () => {
    let state = attachFromDeck(board(), "p2", "fix-energy", 2);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = play(state);
    const onAction = show(state);
    const host = screen.getByRole("group", { name: "fix-basic-1 · Active · opponent" });
    const copies = within(host).getAllByRole("button", { name: "fix-energy" });
    expect(copies).toHaveLength(2);
    fireEvent.click(copies[1] as HTMLElement);
    expect(copies[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(copies[0]?.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(copies[0] as HTMLElement);
    expect(copies[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(copies[1]?.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Discard 1/1" }));
    const action = onAction.mock.calls[0]?.[0] as GameAction;
    expect(action).toEqual({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [state.players.p2.active?.energy[0]] },
    });
    expect(applyAction(state, action).ok).toBe(true);
  });

  it("shows attached Energy excluded by the effect without making it selectable", () => {
    let state = attachFromDeck(board(), "p2", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    state = play(state, "sv02-182");
    show(state);
    const host = screen.getByRole("group", { name: "fix-basic-1 · Active · opponent" });
    expect(within(host).getByRole("img", { name: "fix-energy" })).toBeTruthy();
    expect(within(host).queryByRole("button", { name: "fix-energy" })).toBeNull();
    fireEvent.click(within(host).getByRole("button", { name: "fix-special-2" }));
    expect(
      (screen.getByRole("button", { name: "Discard 1/1" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
