// @vitest-environment jsdom
// 🆕🆕🆕 D543 — THE `discardTools` DIALOG ON THE **LOCAL** SURFACE, AND THE WIRE
// ROUND TRIP THAT FEEDS THE SAME DECISION ONLINE.
//
// 🛑 **THE ROUND TRIP LIVES HERE BECAUSE IT CANNOT LIVE IN THE ENGINE.**
// `packages/engine` must not import from `src/`, so the engine suite drives
// `redactGame` → `redactedEffectPromptSchema.safeParse` and stops. The WAY HOME —
// `projectionFromRedacted` rebuilding the engine `EffectPrompt` — is the third
// read site (D412), and it is the half `tsc` is silent about: the `discardEnergy`
// arm's scope was rebuilt by a two-arm ternary over a THREE-member union for 184
// decisions, and an `else` branch is always type-correct for the member it forgot.
// `D543-projection-rebuild-collapses-upto` is the declared row, and this file is
// the only instrument that can see it.
//
// ⚠️ THE PARK IS DRIVEN, NOT CONSTRUCTED: the board below is a real game with two
// of the opponent's bodies wearing Tools, attacked with the printed sentence, so
// the prompt this dialog renders is the one the engine actually produces.

import type { GameAction, GameState, Seat } from "@luminous/engine";
import { applyAction, createGame, redactGame } from "@luminous/engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Card } from "@luminous/schema";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState, projectionFromRedacted } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;
const SENTENCE = "Discard up to 2 Pokémon Tools from your opponent's Pokémon.";

const LOCAL: Record<string, Card> = {
  "d543-stripper": battler("d543-stripper", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tool Strip", effect: SENTENCE }],
  }),
  "d543-wall": battler("d543-wall", { types: ["Colorless"], hp: 300, retreat: 1 }),
  "d543-bench": battler("d543-bench", { types: ["Colorless"], hp: 300, retreat: 1 }),
  "d543-chestplate": {
    ...(FIXTURE_POOL["fix-tool"] as Card),
    id: "d543-chestplate",
    name: "Rock Chestplate",
  },
  "d543-charm": { ...(FIXTURE_POOL["fix-tool"] as Card), id: "d543-charm", name: "Bravery Charm" },
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

const DECK = deckOf({
  "d543-stripper": 4,
  "d543-wall": 4,
  "d543-bench": 4,
  "d543-chestplate": 4,
  "d543-charm": 4,
  "fix-basic-1": 8,
  "fix-energy": 32,
});

/** ⚠️ **A LOCAL SETUP RATHER THAN `driveSetup`**, because that helper hard-codes
    `FIXTURE_POOL` and this file's demonstrator has to PRINT the sentence: no
    catalog row resolves for it on this checkout (measured), so the card is a
    file-local declared `d543-*` (D425) in its own 60 (D270). */
function localSetup(): GameState {
  const created = createGame({ seed: 20260923, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** p1 fields the demonstrator; p2 fields an Active and a benched body, each
    wearing a DISTINCT Tool — the board the engine parks a two-offer `upTo` on. */
function parked(): GameState {
  let state = localSetup();
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "d543-stripper");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", "d543-wall");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "d543-bench");
  state = attachToolFromDeck(state, "p2", "active", "d543-chestplate");
  state = attachToolFromDeck(state, "p2", 0, "d543-charm");
  const after = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
  if (after.phase.kind !== "effect:choose") throw new Error(`expected the park, got ${after.phase.kind}`);
  return after;
}

function renderHud(state: GameState, viewerSeat: Seat, dispatch: (action: GameAction) => void) {
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

/** The same state rendered off the WIRE instead of off the engine — the online
    client's exact path, and the only way this file can see a projection bug. */
function renderFromWire(state: GameState, viewerSeat: Seat, dispatch: (action: GameAction) => void) {
  render(
    <GameHud
      game={state}
      projection={projectionFromRedacted(redactGame(state, viewerSeat))}
      viewerSeat={viewerSeat}
      names={NAMES}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />,
  );
}

describe("🛑 the local discardTools dialog", () => {
  it("🛑 renders the printed sentence and BOTH Tools, grouped by host", () => {
    renderHud(parked(), "p1", vi.fn());
    expect(screen.getByText(SENTENCE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rock Chestplate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bravery Charm" })).toBeTruthy();
    expect(screen.getByText(/d543-wall · Active · opponent/)).toBeTruthy();
    expect(screen.getByText(/d543-bench · Bench 1 · opponent/)).toBeTruthy();
  });

  it("🛑 DECLINABLE: nothing pre-pressed, Confirm enabled, and the decline DISPATCHES", () => {
    const dispatch = vi.fn();
    renderHud(parked(), "p1", dispatch);
    for (const name of ["Rock Chestplate", "Bravery Charm"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
    }
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: "Discard none" });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardTools", uids: [] },
    });
  });

  it("🛑 a two-pick answer dispatches BOTH uids, and they are the offered ones", () => {
    const state = parked();
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "discardTools") {
      throw new Error("expected the discardTools park");
    }
    const offered = state.phase.prompt.discardable.map((d) => d.uid);
    const dispatch = vi.fn();
    renderHud(state, "p1", dispatch);
    fireEvent.click(screen.getByRole("button", { name: "Rock Chestplate" }));
    fireEvent.click(screen.getByRole("button", { name: "Bravery Charm" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard 2" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardTools", uids: offered },
    });
  });

  it("the caption counts SELECTED rather than a fraction — there is no total to reach", () => {
    renderHud(parked(), "p1", vi.fn());
    expect(screen.getByText(/Pick up to 2 Pokémon Tools to discard \(0 selected\)\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bravery Charm" }));
    expect(screen.getByText(/\(1 selected\)/)).toBeTruthy();
    expect(screen.queryByText(/0\/2/)).toBeNull();
  });
});

describe("🛑 the WIRE round trip — `projectionFromRedacted` rebuilds the same decision", () => {
  it("🛑 the rebuilt prompt is the engine prompt, `upTo` scope included", () => {
    const state = parked();
    const local = projectGameState(state, "p1").pendingDecision;
    const viaWire = projectionFromRedacted(redactGame(state, "p1")).pendingDecision;
    expect(viaWire).toEqual(local);
    if (viaWire?.kind !== "effectChoose" || viaWire.prompt.kind !== "discardTools") {
      throw new Error("expected the rebuilt discardTools prompt");
    }
    // 🛑 THE ASSERTION THE MUTANT DIES ON, stated as the member it is about rather
    // than as a whole-object equality: a rebuild that collapsed the scope would
    // produce `{ kind: "each" }` here, and `toEqual` above would also fail — but it
    // would fail for "the prompts differ", which does not name the seam.
    expect(viaWire.prompt.scope).toEqual({ kind: "upTo", max: 2 });
  });

  it("🛑 …and the dialog rendered OFF THE WIRE is declinable, like the local one", () => {
    // The consequence, driven rather than inferred: a collapsed scope reaches this
    // dialog as `each`, which pre-answers both single-candidate groups and gates
    // Confirm to 2 — so the decline becomes unreachable on the online surface while
    // the engine is still waiting for an answer it will accept.
    const dispatch = vi.fn();
    renderFromWire(parked(), "p1", dispatch);
    expect(screen.getByRole("button", { name: "Rock Chestplate" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: "Discard none" });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardTools", uids: [] },
    });
  });

  it("🛑 the OPPONENT's projection carries NO prompt — controller-answered", () => {
    const state = parked();
    expect(projectionFromRedacted(redactGame(state, "p2")).pendingDecision).toBeNull();
  });
});
