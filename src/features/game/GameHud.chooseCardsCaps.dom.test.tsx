// @vitest-environment jsdom
// D332 — THE PER-KIND CAP, AT THE CLICK.
//
// `ChooseCardsDialog` refused a row on ONE rule: `picked.length >= prompt.max`.
// Drayton's prompt (`chooseCards.caps`) has a flat `max` of **2** and a cap of
// **1** on each kind, so under the old rule the dialog would happily let a player
// select TWO Pokémon — an answer the engine's `validateChoice` then rejects.
//
// 🛑 A DIALOG THAT OFFERS AN ANSWER ITS OWN VALIDATOR REFUSES IS THE DEFECT
// `attachFromDeckNote` names one prompt over — the caption contradicting its own
// gate — and it is invisible to `tsc`, which sees a perfectly well-typed
// unread field. So the branch is driven on a REAL engine park rather than on a
// prompt this file builds: the caps under test are the ones the interpreter put
// there, keyed on the uids it chose.
//
// ⚠️ THE CONTROL IS IN THE SAME FILE AND ON THE SAME DECK. Great Ball's park is
// this op with `also` removed, so its rows must stay clickable up to its own cap
// of 1 — which is what proves the new rule fires on the CAPS and not merely on
// "some second reason to refuse".

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState, Seat } from "@luminous/engine";
import { applyAction, createGame } from "@luminous/engine";
import {
  DRAYTON_WINDOW_DECK,
  FIXTURE_POOL,
  handFromDeck,
  handUid,
  mustApply,
  toDeckTop,
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

function localSetup(seed: number): GameState {
  const created = createGame({
    seed,
    decks: { p1: DRAYTON_WINDOW_DECK, p2: DRAYTON_WINDOW_DECK },
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

/** P1 on turn 2 with `id` in hand and a seeded top 7 — two Pokémon, two
    Trainers, three of neither. `draytonWindow.test.ts`'s window, reached through
    the same actions so the caps are the interpreter's own. */
function parkedOn(seed: number, id: string): GameState {
  let state = mustApply(localSetup(seed), { type: "endTurn", seat: "p2" }).state;
  state = handFromDeck(state, "p1", id, 1);
  state = toDeckTop(state, "p1", "fix-energy", 3);
  state = toDeckTop(state, "p1", "fix-item", 1);
  state = toDeckTop(state, "p1", "sv01-189", 1);
  state = toDeckTop(state, "p1", "fix-basic-2", 1);
  state = toDeckTop(state, "p1", "fix-basic-1", 1);
  return must(
    applyAction(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", id) }),
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

/** The dialog's rows, in prompt order, as `[name, ariaDisabled]` pairs. */
function rows(): [string, boolean][] {
  return screen
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") !== null)
    .map((b) => [b.textContent ?? "", b.getAttribute("aria-disabled") === "true"]);
}

describe("ChooseCardsDialog — the per-kind caps refuse a row the flat total allows", () => {
  it("🛑 picking one Pokémon disables the OTHER Pokémon while the Trainers stay live", () => {
    const state = parkedOn(3, "fix-drayton");
    // The premise, asserted rather than assumed: a real engine park carrying caps.
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = state.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.max).toBe(2);
    expect(prompt.caps).toHaveLength(2);

    renderHud(state, vi.fn());
    // Nothing picked: all four candidates are live, because the total has room
    // and every cap is empty.
    expect(rows().filter(([, disabled]) => disabled)).toHaveLength(0);
    const before = rows();
    expect(before).toHaveLength(4);

    // Click the FIRST Pokémon (prompt order is deck order: 0,1 Pokémon; 2,3
    // Trainers).
    const buttons = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed"));
    fireEvent.click(buttons[0] as HTMLElement);

    const after = rows();
    // 🛑 THE DEFECT: under the old rule this row was still clickable — one pick
    // against a flat cap of 2.
    expect(after[1]?.[1], "the second Pokémon must be refused").toBe(true);
    // …and the Trainers are NOT, which is the half that says the rule read the
    // caps rather than simply refusing everything after one pick.
    expect(after[2]?.[1], "the first Trainer must stay live").toBe(false);
    expect(after[3]?.[1], "the second Trainer must stay live").toBe(false);
  });

  it("clicking the refused Pokémon a second time changes nothing — it is inert, not merely styled", () => {
    const state = parkedOn(3, "fix-drayton");
    renderHud(state, vi.fn());
    const buttons = () =>
      screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") !== null);

    fireEvent.click(buttons()[0] as HTMLElement);
    fireEvent.click(buttons()[1] as HTMLElement); // the capped-out sibling
    // The running total in the live region is the observable: it must still read
    // 1, not 2. A row that LOOKS disabled but still toggles would pass an
    // aria-only assertion.
    expect(screen.getByText(/\(1\/2\)/)).toBeTruthy();
    expect(buttons()[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons()[1]?.getAttribute("aria-pressed")).toBe("false");
  });

  it("one of EACH is reachable — the printed conjunction survives the dialog", () => {
    const state = parkedOn(3, "fix-drayton");
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    const buttons = () =>
      screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") !== null);

    fireEvent.click(buttons()[0] as HTMLElement); // a Pokémon
    fireEvent.click(buttons()[2] as HTMLElement); // a Trainer
    expect(screen.getByText(/\(2\/2\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Take 2$/ }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0]?.[0] as GameAction;
    if (action.type !== "resolveEffect") throw new Error("expected resolveEffect");
    if (action.choice.kind !== "cards") throw new Error("expected a card choice");
    expect(action.choice.uids).toHaveLength(2);
    // And the answer the engine gets is one the engine accepts — the whole point
    // of teaching the dialog the caps.
    expect(applyAction(state, action).ok).toBe(true);
  });

  it("🛑 THE CONTROL — Great Ball's capless park refuses on the TOTAL alone", () => {
    const state = parkedOn(3, "sv02-183");
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = state.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.caps).toBeUndefined();
    expect(prompt.max).toBe(1);

    renderHud(state, vi.fn());
    const buttons = () =>
      screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") !== null);
    // Only the two Pokémon are offered (no `also`), and both start live.
    expect(buttons()).toHaveLength(2);
    expect(rows().filter(([, disabled]) => disabled)).toHaveLength(0);

    fireEvent.click(buttons()[0] as HTMLElement);
    // The refusal here is the OLD rule — the total is full — and the new one must
    // not have changed it.
    expect(rows()[1]?.[1]).toBe(true);
  });
});
