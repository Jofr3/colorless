// @vitest-environment jsdom
// M5 op-slice `EffectContext.sourceUid` on the WEB side. The claim under test
// is that the HUD needed NO code change: Pawmot's prompt is an ordinary
// `attachCards` offer whose target list happens to hold ONE fixed ref (the
// engine's `toSelf` rule), and the dialog, the ability row and `promptKey`
// already speak that shape. What has to be pinned is the shape itself —
//
//   • the ability row of a BENCHED Pokémon is lit and dispatches with the
//     bench target (`usableAbilities` walks the whole board, and Pawmot is the
//     first shipped card whose whole point is being used from the Bench);
//   • the offer's target list holds ONE ref — Pawmot itself — so the dialog
//     never mounts it (a list of one is not a decision): tapping the card
//     attaches outright, the row's "→" readback names Pawmot, the Active is
//     nowhere reachable, and Confirm dispatches that exact pair;
//   • "Attach none" stays a legal decline (a search may be failed on purpose).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState, Seat } from "@luminous/engine";
import { applyAction } from "@luminous/engine";
import {
  SOURCE_UID_DECK,
  benchFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const PAWMOT = "sv01-076";
const PLAIN_BODY = "fix-basic-1";
const SEED = 20260722;
const decks = { p1: SOURCE_UID_DECK, p2: SOURCE_UID_DECK };

/** Setup, then open P1's turn (P2 first, then passes). */
function p1Turn(seed: number): GameState {
  const state = driveSetup(seed, decks, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 rebuilt: a plain Active, Pawmot on the Bench (the board the slice is
    about — see the engine suite's `withBoard`). */
function benchedPawmot(seed = SEED): GameState {
  const state = p1Turn(seed);
  const side = state.players.p1;
  const returned = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, active: null, bench: [], deck: [...side.deck, ...returned] },
    },
  };
  next = setActiveFromDeck(next, "p1", PLAIN_BODY);
  return benchFromDeck(next, "p1", PAWMOT);
}

/** Electrogenesis used from the Bench, parked on its one-target offer. */
function parkedPawmot(): GameState {
  const parked = mustApply(benchedPawmot(), {
    type: "useAbility",
    seat: "p1",
    target: { spot: "bench", index: 0 },
    abilityName: "Electrogenesis",
  }).state;
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  return parked;
}

function hud(state: GameState, dispatch: (action: GameAction) => void) {
  return (
    <GameHud
      game={state}
      projection={projectGameState(state, "p1")}
      viewerSeat="p1"
      names={NAMES}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />
  );
}

describe("the ability row of a benched Pawmot", () => {
  it("is lit and dispatches the use with the BENCH target", () => {
    const state = benchedPawmot();
    const dispatch = vi.fn();
    render(hud(state, dispatch));
    const row = screen.getByRole("button", {
      name: "Electrogenesis · Pawmot (Bench 1)",
    }) as HTMLButtonElement;
    expect(row.disabled).toBe(false);
    fireEvent.click(row);
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "useAbility") throw new Error("expected a useAbility dispatch");
    expect(call.target).toEqual({ spot: "bench", index: 0 });
    expect(applyAction(state, call).ok).toBe(true);
  });
});

describe("the one-target offer — 'this Pokémon' in the dialog", () => {
  it("renders the printed note, and a tap attaches outright to Pawmot — the ONLY target", () => {
    const state = parkedPawmot();
    render(hud(state, vi.fn()));
    expect(
      screen.getByRole("heading", {
        name: "Search your deck for a Basic Lightning Energy card and attach it to this Pokémon.",
      }),
    ).toBeTruthy();
    const cards = screen.getAllByRole("button", { name: /Lightning Energy/ });
    expect(cards).toHaveLength(1);
    fireEvent.click(cards[0] as HTMLElement);
    // A list of one is not a decision: the tap commits the attach and the
    // row's readback names Pawmot. No target list mounts, and the Active is
    // nowhere — the row a fallback-to-Active bug would render is exactly the
    // one asserted absent.
    expect(screen.getByRole("button", { name: /→ Pawmot · Bench 1$/ })).toBeTruthy();
    expect(screen.queryByText("Attach to:")).toBeNull();
    expect(screen.queryByRole("button", { name: `${PLAIN_BODY} · Active` })).toBeNull();
  });

  it("Confirm dispatches the pair, and the engine accepts it", () => {
    const state = parkedPawmot();
    const dispatch = vi.fn();
    render(hud(state, dispatch));
    fireEvent.click(screen.getAllByRole("button", { name: /Lightning Energy/ })[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Attach 1" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "attachCards") {
      throw new Error("expected an attachCards resolveEffect");
    }
    expect(call.choice.assignments.map((a) => a.to.spot)).toEqual([{ spot: "bench", index: 0 }]);
    expect(applyAction(state, call).ok).toBe(true);
  });

  it("'Attach none' declines with an empty assignment list", () => {
    const state = parkedPawmot();
    const dispatch = vi.fn();
    render(hud(state, dispatch));
    fireEvent.click(screen.getByRole("button", { name: "Attach none" }));
    const call = dispatch.mock.calls[0]?.[0] as GameAction;
    if (call.type !== "resolveEffect" || call.choice.kind !== "attachCards") {
      throw new Error("expected an attachCards resolveEffect");
    }
    expect(call.choice.assignments).toEqual([]);
    expect(applyAction(state, call).ok).toBe(true);
  });
});
