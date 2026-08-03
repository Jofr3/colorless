// @vitest-environment jsdom
// The LOCAL HUD's energy dots, and the divergence they used to carry. TurnPanel
// has computed `payable` from `effectiveAttackCost` since the cost seam existed
// while `<EnergyDots>` beside it drew the PRINTED cost — a mismatch that was
// merely unhelpful while the pool's only modifier was a SURCHARGE (the button
// greys and the dots do not say why) and actively misleading the moment a
// DISCOUNT exists: the button goes LIVE while the dots still show a cost the
// player has not paid. Both surfaces now read the same array.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameState, Seat } from "@luminous/engine";
import {
  clearBench,
  deckOf,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setPrizes,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;
const SEED = 7;

// The engine suite's 60, restated here rather than exported — this file needs
// three of its nine entries and the two suites must be free to move apart.
const DECK = deckOf({
  "swsh10.5-011": 4, // Radiant Charizard — "Excited Heart": the discount
  "sv03-052": 4, // Seismitoad — "Quaking Zone": the surcharge
  "fix-titan": 28, // 340 HP neutral Basic, NO attacks — the normalised Active
  "fix-fire-energy": 6,
  "fix-water-energy": 6,
  "fix-energy": 12,
});

function active(state: GameState, seat: Seat, cardId: string): GameState {
  return clearBench(setActiveFromDeck(state, seat, cardId), seat);
}

/** P1 mid turn 3 with both Active spots normalised to the inert 340 HP body. */
function board(): GameState {
  let state = driveSetup(SEED, { p1: DECK, p2: DECK }, { first: "p1" });
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = active(state, "p1", "fix-titan");
  return active(state, "p2", "fix-titan");
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

/** `EnergyDots` labels itself with the symbols it drew, which is the only place
    the rendered cost is observable. */
const dots = () => screen.getByLabelText(/^cost: /).getAttribute("aria-label");

describe("TurnPanel energy dots — the EFFECTIVE cost, not the printed one", () => {
  it("draws the printed {R}{C}{C}{C}{C} when nothing modifies it", () => {
    renderHud(active(board(), "p1", "swsh10.5-011"));
    expect(dots()).toBe("cost: Fire, Colorless, Colorless, Colorless, Colorless");
  });

  it("drops one dot per Prize the opponent has taken — the DISCOUNT", () => {
    // ⚠️ THE CASE THE SIBLING FIELD AND THIS LINE EXIST FOR. At two taken Prizes
    // Combustion Blast costs {R}{C}{C}; dots still showing five would tell the
    // player they cannot afford an attack the engine will happily accept.
    const state = setPrizes(active(board(), "p1", "swsh10.5-011"), "p2", 4);
    renderHud(state);
    expect(dots()).toBe("cost: Fire, Colorless, Colorless");
  });

  it("adds a dot under the opposing surcharge — the direction that shipped un-rendered", () => {
    let state = active(board(), "p1", "sv03-052");
    state = active(state, "p2", "sv03-052");
    renderHud(state);
    expect(dots()).toBe("cost: Water, Water, Colorless");
  });
});
