// @vitest-environment jsdom
// M4 slice 2 HUD wiring: the Trainer/Ability controls in TurnPanel and the
// effect:choose dialogs dispatch the right engine actions. Real engine states
// via the fixtures; a dispatch spy captures what the buttons send (the engine
// itself is covered by cardplay.test.ts).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState } from "@luminous/engine";
import {
  ABILITY_DECK,
  STADIUM_TOOL_DECK,
  TRAINER_DECK,
  driveSetup,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;
const both = { p1: TRAINER_DECK, p2: TRAINER_DECK };

/** Setup, then open P1's turn 2 (P2 first → ending their turn 1 unblocks P1's
    unrestricted first turn, so Supporters play). */
function p1Turn2(seed: number, decks: { p1: string[]; p2: string[] }): GameState {
  const state = driveSetup(seed, decks, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function renderHud(state: GameState, dispatch: (action: GameAction) => void) {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, "p1")}
      viewerSeat="p1"
      names={NAMES}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />,
  );
}

describe("TurnPanel — Trainer controls", () => {
  it("lists playable Trainers and dispatches playTrainer on click", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-181", 1); // Nest Ball (Item)
    state = handFromDeck(state, "p1", "sv01-189", 1); // Professor's Research (Supporter)
    const nestBall = handUid(state, "p1", "sv01-181");
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByText("Trainers")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sv01-181" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "playTrainer", seat: "p1", uid: nestBall });
    // The Supporter is offered too (P1's turn 2 is unrestricted).
    expect((screen.getByRole("button", { name: "sv01-189" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("greys a Supporter out once one is played this turn (§7.2)", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-189", 1);
    state = { ...state, allowances: { ...state.allowances, supporterPlayed: true } };
    renderHud(state, vi.fn());
    expect((screen.getByRole("button", { name: "sv01-189" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("offers a Stadium as a button, greyed by the §7.3 gates (played / same name)", () => {
    const decks = { p1: STADIUM_TOOL_DECK, p2: STADIUM_TOOL_DECK };
    let state = p1Turn2(1, decks);
    state = handFromDeck(state, "p1", "sv01-167", 1); // Beach Court
    const beachCourt = handUid(state, "p1", "sv01-167");
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    fireEvent.click(screen.getByRole("button", { name: "Beach Court" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "playTrainer", seat: "p1", uid: beachCourt });
    cleanup();

    // Played: a SAME-named copy is greyed (the engine would reject it)…
    let played = mustApply(state, { type: "playTrainer", seat: "p1", uid: beachCourt }).state;
    played = handFromDeck(played, "p1", "sv01-167", 1);
    renderHud(played, vi.fn());
    expect(
      (screen.getByRole("button", { name: "Beach Court" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();

    // …and so is a DIFFERENT Stadium this turn (one Stadium play per turn).
    const withOther = handFromDeck(played, "p1", "sv03-192", 1);
    renderHud(withOther, vi.fn());
    expect(
      (screen.getByRole("button", { name: "Pokémon League Headquarters" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // A Tool never becomes a button — attaching is a board drag.
    const withTool = handFromDeck(withOther, "p1", "sv01-197", 1);
    cleanup();
    renderHud(withTool, vi.fn());
    expect(screen.queryByRole("button", { name: "sv01-197" })).toBeNull();
  });
});

describe("TurnPanel — Ability controls", () => {
  it("lists an Active activated Ability and dispatches useAbility", () => {
    let state = p1Turn2(3, { p1: ABILITY_DECK, p2: ABILITY_DECK });
    state = setActiveFromDeck(state, "p1", "sv02-061"); // Chien-Pao ex active
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByText("Abilities")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Shivery Chill/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Shivery Chill",
    });
  });
});

describe("effect:choose — the search dialog (chooseCards)", () => {
  it("renders the parked search and dispatches resolveEffect on 'Take none'", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-181", 1);
    const uid = handUid(state, "p1", "sv01-181");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    expect(state.phase.kind).toBe("effect:choose");
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByRole("dialog", { name: "Search your deck" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take none" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
  });
});

describe("effect:choose — the target dialog (choosePokemon)", () => {
  it("renders the parked heal target and dispatches resolveEffect with a ref", () => {
    let state = p1Turn2(2, both);
    state = setDamage(state, "p1", 50);
    // Give P1 a Bench Pokémon so Potion must CHOOSE (active + bench = 2 targets).
    state = handFromDeck(state, "p1", "fix-basic-1", 1);
    const benchUid = handUid(state, "p1", "fix-basic-1");
    state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid: benchUid }).state;
    state = handFromDeck(state, "p1", "sv01-188", 1); // Potion
    const potion = handUid(state, "p1", "sv01-188");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid: potion }).state;
    expect(state.phase.kind).toBe("effect:choose");
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    expect(screen.getByRole("dialog", { name: "Choose a Pokémon" })).toBeTruthy();
    // The Active is offered first — clicking it dispatches the heal target.
    const buttons = screen.getAllByRole("button");
    const target = buttons.find((b) => b.textContent && b.textContent.length > 0);
    if (target === undefined) throw new Error("no target button");
    fireEvent.click(target);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    expect(call.type).toBe("resolveEffect");
    if (call.type === "resolveEffect") expect(call.choice.kind).toBe("pokemon");
  });
});
