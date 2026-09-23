// @vitest-environment jsdom
// 🆕🆕🆕 D545 — THE PRINTED COST CLAUSE ON THE **LOCAL** SURFACE.
//
// TurnPanel computes its dots and its `disabled` from the engine's ONE payability seam,
// `attackCostAt` (attack.ts), which folds the printed COST CLAUSE on the attack index —
// corpus `:316`'s alternate {F} and `:324`'s waive — over `effectiveAttackCost`. A HUD that
// kept calling `effectiveAttackCost` would grey out an attack the engine accepts and draw a
// cost the player is not charged. This file is the only instrument that sees GameHud's
// half; `D545-gamehud-reverts-to-effective-cost` is the declared row.
//
// ⚠️ No card id resolves for either sentence on this checkout (D425), so the bodies are
// file-local declared `d545-*` demonstrators in their own 60 (D270), each printing a cost
// that differs from both `{F}` and `[]`.

import type { GameState } from "@luminous/engine";
import { applyAction, createGame } from "@luminous/engine";
import type { Card } from "@luminous/schema";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;
const ALT = "If this Pokémon has any damage counters on it, this attack can be used for {F}.";
const WAIVE =
  "If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.";

const base = FIXTURE_POOL["fix-basic-1"] as Card;
const LOCAL: Record<string, Card> = {
  "d545-alt": {
    ...base,
    id: "d545-alt",
    name: "d545-alt",
    hp: 300,
    attacks: [{ cost: ["Water", "Water", "Colorless"], name: "Rock Alternate", damage: "30", effect: ALT }],
  },
  "d545-waive": {
    ...base,
    id: "d545-waive",
    name: "d545-waive",
    hp: 300,
    attacks: [{ cost: ["Grass", "Grass", "Colorless"], name: "Free Vine", damage: "40", effect: WAIVE }],
  },
  "d545-wall": { ...base, id: "d545-wall", name: "d545-wall", hp: 600, attacks: [] },
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

const DECK = deckOf({
  "d545-alt": 4,
  "d545-waive": 4,
  "d545-wall": 16,
  "fix-fighting-energy": 12,
  "fix-energy": 24,
});

function localSetup(): GameState {
  const created = createGame({ seed: 20260925, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** P1 mid turn 3 fielding `attacker` with `fighting` {F} attached, P2 the inert wall. */
function board(attacker: string, fighting: number): GameState {
  let state = localSetup();
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  if (fighting > 0) state = attachFromDeck(state, "p1", "fix-fighting-energy", fighting);
  return clearBench(setActiveFromDeck(state, "p2", "d545-wall"), "p2");
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

const dots = () => screen.getByLabelText(/^cost: /).getAttribute("aria-label");
const button = (name: string) =>
  screen.getByRole("button", { name: new RegExp(name) }) as HTMLButtonElement;

describe("D545 — TurnPanel reads the printed COST CLAUSE through `attackCostAt`", () => {
  it("`:316` FALSE: the printed cost is drawn and `{F}` alone does not light the button", () => {
    renderHud(board("d545-alt", 1));
    expect(dots()).toBe("cost: Water, Water, Colorless");
    expect(button("Rock Alternate")).toHaveProperty("disabled", true);
  });

  it("🛑 `:316` TRUE with `{F}` attached: the dots draw `{F}` and the button is LIVE", () => {
    renderHud(setDamage(board("d545-alt", 1), "p1", 10));
    expect(dots()).toBe("cost: Fighting");
    expect(button("Rock Alternate")).toHaveProperty("disabled", false);
  });

  it("`:324` FALSE: the printed cost is drawn and the button is dead with no Energy", () => {
    renderHud(board("d545-waive", 0));
    expect(dots()).toBe("cost: Grass, Grass, Colorless");
    expect(button("Free Vine")).toHaveProperty("disabled", true);
  });

  it("🛑 `:324` TRUE (Poisoned): NO dots' worth of cost and the button is LIVE with no Energy", () => {
    renderHud(setConditions(board("d545-waive", 0), "p1", { poisonDamage: 10 }));
    expect(screen.queryByLabelText(/^cost: /)).toBeNull();
    expect(within(button("Free Vine")).getByText("free")).toBeTruthy();
    expect(button("Free Vine")).toHaveProperty("disabled", false);
  });
});
