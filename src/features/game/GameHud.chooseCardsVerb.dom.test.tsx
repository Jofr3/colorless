// @vitest-environment jsdom
// REVIEW FIX 5/5 — THE CONFIRM VERB, AND THE UNION MEMBER THAT FELL OUT OF THE
// WRONG SIDE OF A TERNARY.
//
// `ChooseCardsDialog`'s Confirm label used to branch on ONE member per branch —
// `dest === "deck" ? "Shuffle" : "Take"` on the "up to" side, `dest ===
// "deckBottom" ? "Put under deck" : "Discard"` on the mandatory one. D307 then
// added `"evolve"` to `chooseCards.dest`, and the Emergency Evolution park
// rendered a Confirm reading **"Take 1"** over a heading that says *"…and put it
// onto Pidove to evolve it"*. Nothing went red, because a ternary has no opinion
// about a union member it was written before.
//
// 🛑 THIS IS D222's RULE ON A CLIENT-SIDE READER, and the repair is D222's:
// `CHOOSE_CARDS_VERB` is a TOTAL record keyed on the union, so the next member
// breaks `tsc` instead of quietly inheriting a verb. What this file adds is the
// half a compiler cannot check — that the verb each cell holds is the one the
// prompt's OWN HEADING uses, driven on a real board rather than on a hand-built
// prompt object.
//
// ⚠️ THE HEADING IS ASSERTED BESIDE THE BUTTON, DELIBERATELY. The defect was never
// "the label is wrong" in isolation — it was the label contradicting the sentence
// directly above it, and a test that only pinned the button would go green on a
// build that changed both to something equally wrong.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState, Seat } from "@luminous/engine";
import { applyAction, createGame } from "@luminous/engine";
import {
  EMERGENCY_DECK,
  FIXTURE_POOL,
  benchFromDeck,
  clearBench,
  mustApply,
  setActiveFromDeck,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = FIXTURE_POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** `emergencyEvolution.test.ts`'s own setup, reached through the same actions —
    the Ability is the one HUD-reachable producer of a `dest: "evolve"` park. */
function localSetup(seed: number): GameState {
  const created = createGame({
    seed,
    decks: { p1: EMERGENCY_DECK, p2: EMERGENCY_DECK },
    cardPool: FIXTURE_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
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

/** P1 on turn 2 with a DAMAGED Pidove on the bench — the Ability's printed gate
    is "30 or less HP remaining", so the damage is what makes it usable at all. */
function parkedOnEvolve(seed: number): GameState {
  let state = localSetup(seed);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-emergencyevolution");
  const side = state.players.p1;
  const pidove = side.bench[0];
  if (pidove === undefined) throw new Error("p1 bench 0 is empty");
  state = {
    ...state,
    players: { ...state.players, p1: { ...side, bench: [{ ...pidove, damage: 40 }] } },
  };
  return must(
    applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Emergency Evolution",
    }),
  );
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

describe("ChooseCardsDialog — the Confirm verb follows the prompt's own heading", () => {
  it("🛑 an `evolve` park reads EVOLVE, not TAKE — the D307 member", () => {
    const state = parkedOnEvolve(11);
    // The premise, asserted rather than assumed: this really is a `dest: "evolve"`
    // park produced by the ENGINE, not a prompt this file built.
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = state.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.dest).toBe("evolve");
    expect(prompt.min).toBe(0); // the printed "you may" — declinable

    renderHud(state, vi.fn());
    // The heading the Confirm used to contradict.
    expect(screen.getByText(/put it onto .* to evolve it\./)).toBeTruthy();
    // 🛑 THE DEFECT: this button read "Take none" / "Take 1" before the repair.
    expect(screen.getByRole("button", { name: "Evolve none" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take none" })).toBeNull();
  });

  it("…and it carries the COUNT once a card is picked", () => {
    const state = parkedOnEvolve(11);
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = state.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const first = prompt.candidates[0] as string;
    const dispatch = vi.fn();
    renderHud(state, dispatch);

    const rows = screen.getAllByRole("button", { name: /Unfezant/ });
    fireEvent.click(rows[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Evolve 1" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [first] },
    });
  });
});
