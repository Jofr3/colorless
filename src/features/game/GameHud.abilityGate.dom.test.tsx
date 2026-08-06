// @vitest-environment jsdom
// D242 — THE THIRD READ SITE of the always-on attack gate ("This Pokémon can't
// attack unless you have 4 or more Team Rocket's Pokémon in play").
//
// The engine's §8 gate refuses the declaration and `redactedAttacksOf` greys the
// wire rows; this file is the HOT-SEAT surface, which has no wire between it and
// the state and therefore no other check. ⚠️ IT EXISTS BECAUSE A READ SITE WITH NO
// TEST IS A READ SITE A MUTANT SURVIVES: the clause in `TurnPanel`'s `disabled`
// is one token, and without this suite deleting it costs nothing measurable while
// handing the player a button `attack` rejects with ATTACK_PREVENTED — the D157
// soft-lock shape, on the surface that is the whole of P3 play.
//
// ⚠️ AND THE GATE IS ASSERTED ON *BOTH* ROWS. `Team Rocket's Mewtwo` has two
// attacks precisely so this can be told apart from D154's per-attack bar, which
// greys one row and leaves the other live.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameState, Seat } from "@luminous/engine";
import {
  ROW14_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;
const SEED = 91;

function active(state: GameState, seat: Seat, cardId: string): GameState {
  return clearBench(setActiveFromDeck(state, seat, cardId), seat);
}

/** P1 mid turn 3, both benches empty, both Active spots the inert plain body. */
function board(): GameState {
  let state = driveSetup(SEED, { p1: ROW14_DECK, p2: ROW14_DECK }, { first: "p1" });
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = active(state, "p1", "fix-basic-1");
  return active(state, "p2", "fix-basic-1");
}

/** The gate holder Active, with `benched` further prefixed bodies beside it. */
function gated(benched: number): GameState {
  let state = active(board(), "p1", "fix-powersaver");
  for (let i = 0; i < benched; i++) state = benchFromDeck(state, "p1", "fix-tr-body");
  return state;
}

function renderHud(state: GameState) {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, "p1")}
      viewerSeat="p1"
      names={NAMES}
      dispatch={() => {}}
      onPlayAgain={() => {}}
    />,
  );
}

const attackButton = (name: string) =>
  screen.getByRole("button", { name: new RegExp(name) }) as HTMLButtonElement;

describe("D242 — TurnPanel greys the whole attack panel under an always-on Ability gate", () => {
  it("greys BOTH rows one prefixed body short of the printed floor", () => {
    // 🛑 THE ENERGY IS THE POINT OF THIS LINE, AND A SURVIVING MUTANT BOUGHT IT.
    // Written without it, both rows were greyed by the PAYABILITY check as well as
    // by the gate, so deleting the gate clause from `TurnPanel`'s `disabled`
    // changed nothing this file could see — a full case proving nothing about the
    // layer it names (D241). Two Colorless cover BOTH printed costs, so the gate is
    // the only layer left that can refuse.
    renderHud(attachFromDeck(gated(2), "p1", "fix-energy", 2));
    expect(attackButton("Erasure Ball").disabled).toBe(true);
    expect(attackButton("Second Strike").disabled).toBe(true);
  });

  it("…and un-greys the AFFORDABLE row the moment the fourth body lands", () => {
    // 🛑 THE NON-VACUOUS HALF, AND IT IS WHAT MAKES THE CASE ABOVE MEAN ANYTHING.
    // Same 60, same turn, one Benched Pokémon more — and only ONE Colorless
    // attached, so "Erasure Ball" ({C}) goes live while "Second Strike" ({C}{C})
    // stays greyed on the SAME render. That second row is the half that matters:
    // what came back is PAYABILITY, not a panel that stopped checking.
    renderHud(attachFromDeck(gated(3), "p1", "fix-energy", 1));
    expect(attackButton("Erasure Ball").disabled).toBe(false);
    expect(attackButton("Second Strike").disabled).toBe(true);
  });

  it("a body with NO gate renders its row live — the attribution control", () => {
    // Without this, "everything is greyed" would pass the first case just as
    // happily on a broken import (D214's vacuous-guard shape). `fix-tr-body`
    // carries the PREFIX and no program, so it proves the greying tracks the
    // ABILITY rather than the name.
    renderHud(attachFromDeck(active(board(), "p1", "fix-tr-body"), "p1", "fix-energy", 1));
    expect(attackButton("Scratch").disabled).toBe(false);
  });
});
