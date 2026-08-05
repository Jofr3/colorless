// @vitest-environment jsdom
// Review additions for the D50 slice (EffectContext.sourceUid / Pawmot). Two
// gaps in the shipped DOM suite, both found by mutation testing and both
// driven engine → projection → HUD → dispatch → engine on REAL states:
//
//   • the FULL round trip nobody closed: the sibling file dispatches and
//     checks `applyAction(...).ok`, but never feeds the accepted state BACK
//     into the HUD — so nothing pinned that after the attach (or the decline)
//     the Electrogenesis row comes back DISABLED. The engine spends the
//     once-per-turn stamp on both paths; the row going grey is what stands
//     between the player and a lit row that ABILITY_ALREADY_USED refuses.
//
//   • two promptKey segments nothing exercised: the sibling attachFromDeck
//     file pins that `maxPerTarget` rides the attachCards key, but the TARGET
//     list and `max` ride it on the same argument and had no test — a key
//     that dropped either survived the whole suite. Hand-built sibling
//     prompts off one real park (the established belt technique): no shipped
//     program parks twice back-to-back, and the key's documented job is not
//     to depend on that.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState, PokemonRef, Seat } from "@luminous/engine";
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

/** P1 rebuilt: a plain Active, `pawmots` Pawmot copies on the Bench (the
    sibling file's board, generalised — see the engine suite's `withBoard`). */
function benchedPawmots(pawmots: number, seed = SEED): GameState {
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
  for (let i = 0; i < pawmots; i += 1) next = benchFromDeck(next, "p1", PAWMOT);
  return next;
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

const ROW_NAME = "Electrogenesis · Pawmot (Bench 1)";

/** Drive one HUD interaction into the engine: render, click through `clicks`,
    take the single dispatched action, apply it, and hand back the ACCEPTED
    state — every hop of the loop the app runs, minus only the reducer. */
function driveClicks(state: GameState, clicks: readonly (() => HTMLElement)[]): GameState {
  const dispatch = vi.fn();
  const view = render(hud(state, dispatch));
  for (const locate of clicks) fireEvent.click(locate());
  expect(dispatch).toHaveBeenCalledTimes(1);
  const action = dispatch.mock.calls[0]?.[0] as GameAction;
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`engine rejected the HUD's dispatch: ${result.error.message}`);
  view.unmount();
  return result.state;
}

describe("the full loop — the row goes DEAD after the play resolves", () => {
  it("attach path: use from the Bench, attach via the dialog, and the row greys out", () => {
    let state = benchedPawmots(1);
    state = driveClicks(state, [() => screen.getByRole("button", { name: ROW_NAME })]);
    expect(state.phase.kind).toBe("effect:choose");
    state = driveClicks(state, [
      // One target ⇒ the tap attaches outright; no target list mounts.
      () => screen.getAllByRole("button", { name: /Lightning Energy/ })[0] as HTMLElement,
      () => screen.getByRole("button", { name: "Attach 1" }),
    ]);
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p1.bench[0]?.energy).toHaveLength(1);

    // The engine spent the once-per-turn stamp; the row must SAY so.
    const dispatch = vi.fn();
    render(hud(state, dispatch));
    const row = screen.getByRole("button", { name: ROW_NAME }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("decline path: 'Attach none' spends the use too, and the row greys out", () => {
    let state = benchedPawmots(1);
    state = driveClicks(state, [() => screen.getByRole("button", { name: ROW_NAME })]);
    state = driveClicks(state, [() => screen.getByRole("button", { name: "Attach none" })]);
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p1.bench[0]?.energy).toHaveLength(0);

    const dispatch = vi.fn();
    render(hud(state, dispatch));
    const row = screen.getByRole("button", { name: ROW_NAME }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(dispatch).not.toHaveBeenCalled();
    // And the engine agrees with the grey — the mirror in both directions.
    const second = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Electrogenesis",
    });
    expect(second.ok).toBe(false);
  });
});

describe("promptKey — the two attachCards segments nothing pinned", () => {
  /** A real benched-Pawmot park on a two-Pawmot bench. */
  function park(): GameState {
    const parked = mustApply(benchedPawmots(2), {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Electrogenesis",
    }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return parked;
  }

  /** The same park with one prompt field swapped — the belt technique. */
  function sibling(
    parked: GameState,
    patch: { targets?: PokemonRef[]; max?: number },
  ): GameState {
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    return {
      ...parked,
      phase: { ...parked.phase, prompt: { ...parked.phase.prompt, ...patch } },
    };
  }

  it("the TARGET list rides the key — same cards aimed at the other Pawmot remount", () => {
    // The second park is the OTHER benched Pawmot's offer: same single
    // candidate, same max, no maxPerTarget — only the target differs. A sole
    // target means the tap COMMITS an assignment (no pending step), so what a
    // dropped target segment would carry across is a stale attach aimed at a
    // Pokémon the new offer does not contain — readback and all.
    const first = park();
    const second = sibling(first, {
      targets: [{ seat: "p1", spot: { spot: "bench", index: 1 } }],
    });
    const { rerender } = render(hud(first, vi.fn()));
    fireEvent.click(screen.getAllByRole("button", { name: /Lightning Energy/ })[0] as HTMLElement);
    expect(screen.getByRole("button", { name: /→ Pawmot · Bench 1$/ })).toBeTruthy();

    rerender(hud(second, vi.fn()));
    // Fresh picks: the remount cleared the assignment; nothing reads "→".
    expect(screen.queryByRole("button", { name: /→ Pawmot/ })).toBeNull();
    expect(screen.getByText("Attaching 0/1. Pick a card to attach.")).toBeTruthy();
  });

  it("`max` rides the key — the same offer at a different ceiling remounts", () => {
    const first = park();
    const second = sibling(first, { max: 2 });
    const { rerender } = render(hud(first, vi.fn()));
    fireEvent.click(screen.getAllByRole("button", { name: /Lightning Energy/ })[0] as HTMLElement);
    expect(screen.getByRole("button", { name: /→ Pawmot · Bench 1$/ })).toBeTruthy();

    rerender(hud(second, vi.fn()));
    expect(screen.queryByRole("button", { name: /→ Pawmot/ })).toBeNull();
    expect(screen.getByText("Attaching 0/2. Pick a card to attach.")).toBeTruthy();
  });
});
