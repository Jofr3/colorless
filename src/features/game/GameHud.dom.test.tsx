// @vitest-environment jsdom
// TurnPanel's §12 status gating. The predicate must MIRROR the engine's
// gates exactly (STATUS_PREVENTS_ATTACK / STATUS_PREVENTS_RETREAT: asleep or
// paralyzed — confusion, poison and burn block nothing at declaration), or
// the HUD drifts from what the engine will accept. Real engine states via
// the fixtures; the HUD reads conditions off the PROJECTED board.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GameState } from "@luminous/engine";
import {
  attachFromDeck,
  deckOf,
  driveSetup,
  mustApply,
  setConditions,
} from "../../../packages/engine/src/testFixtures";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;

// Seed pairing mirrors projection.test.ts: seed 11 deals no mulligans and
// p1's opening hand holds the second fix-attacker the bench needs.
const DECK = deckOf({ "fix-attacker": 30, "fix-fire-energy": 20, "fix-water-energy": 10 });

/** p1 mid turn 3: a payable Bite (one Fire attached, cost [C]) and a benched
    Pokémon to retreat to (retreat cost 1 — the energy covers it). */
function battleReady(): GameState {
  let state = driveSetup(
    11,
    { p1: DECK, p2: DECK },
    {
      first: "p1",
      active: { p1: "fix-attacker", p2: "fix-attacker" },
      bench: { p1: ["fix-attacker"] },
    },
  );
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
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

const attackButton = () => screen.getByRole("button", { name: /Bite/ }) as HTMLButtonElement;
const retreatButton = () => screen.getByRole("button", { name: /Retreat/ }) as HTMLButtonElement;

describe("TurnPanel — §12 status gating", () => {
  it("keeps a payable attack and retreat enabled with no conditions", () => {
    renderHud(battleReady());
    expect(attackButton().disabled).toBe(false);
    expect(retreatButton().disabled).toBe(false);
    expect(screen.queryByText(/cannot attack or retreat/)).toBeNull();
  });

  it.each([
    ["asleep", "Asleep"],
    ["paralyzed", "Paralyzed"],
  ] as const)("disables attack AND retreat while %s, with the reason shown", (rotation, label) => {
    renderHud(setConditions(battleReady(), "p1", { rotation }));
    expect(attackButton().disabled).toBe(true);
    expect(retreatButton().disabled).toBe(true);
    expect(screen.getByText(`${label} — cannot attack or retreat.`)).toBeTruthy();
  });

  it("keeps attack and retreat available while Confused, with the flip note", () => {
    renderHud(setConditions(battleReady(), "p1", { rotation: "confused" }));
    expect(attackButton().disabled).toBe(false);
    expect(retreatButton().disabled).toBe(false);
    expect(screen.getByText(/Confused: attacking flips a coin/)).toBeTruthy();
  });

  it("never gates on Poison or Burn", () => {
    renderHud(setConditions(battleReady(), "p1", { poisonDamage: 20, burned: true }));
    expect(attackButton().disabled).toBe(false);
    expect(retreatButton().disabled).toBe(false);
    expect(screen.queryByText(/cannot attack or retreat/)).toBeNull();
  });
});

describe("TurnPanel — §8/§11 the PER-ATTACK bar (D154)", () => {
  /** TEST SURGERY: write the durated record straight onto p1's Active. The real
      install needs a printed barrer in the deck, and this suite's deck is
      fix-attacker × 30 — the HUD claim is about ONE boolean per row, not about
      which card wrote it, so the record is placed rather than played. */
  function barAttack(state: GameState, attackIndex: number): GameState {
    const side = state.players.p1;
    const active = side.active;
    if (active === null) throw new Error("p1 has no Active Pokémon");
    return {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, active: { ...active, lockedAttack: { turn: state.turn, attackIndex } } },
      },
    };
  }

  // ⚠️ THIS IS THE PROJECTION WITH THE MOST ROOM TO BE WRONG, AND THE REASON IS
  // VISUAL. D143's whole-Pokémon lock greys EVERY row, so a build that missed it
  // shows a panel of dead controls and someone notices. This one greys exactly one
  // row on an otherwise live panel — so a build that folded it into the
  // whole-declaration `attackLockedNow` boolean, or forgot it, renders a board
  // that looks completely normal and rejects one press with ATTACK_PREVENTED. The
  // server-side twin is `redactedAttacksOf`'s `barred` (redact.ts), pinned in
  // perAttackLock.test.ts; this is the local HUD's half of the same claim.
  it("disables ONLY the barred row and leaves the card's other attacks alone", () => {
    renderHud(barAttack(battleReady(), 0));
    expect(attackButton().disabled).toBe(true);
    // fix-attacker's index-2 "Yawn" is costless, so it is payable on any board —
    // which makes it the row that proves the bar is per-INDEX rather than a panel
    // that happens to be unpayable.
    expect((screen.getByRole("button", { name: /Yawn/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    // …and retreating is untouched: this is not a §12 condition and says nothing
    // about moving (the same separation `retreatBlocked` is under).
    expect(retreatButton().disabled).toBe(false);
  });

  it("bars whichever index the record names, not a constant", () => {
    renderHud(barAttack(battleReady(), 2));
    expect((screen.getByRole("button", { name: /Yawn/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(attackButton().disabled).toBe(false);
  });

  it("stops mattering once the window has passed — the stamp, not the record", () => {
    // The record is STILL on the body; only its turn has moved on. A HUD that read
    // the field instead of the reader would grey the row forever.
    const state = battleReady();
    const stale = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active:
            state.players.p1.active === null
              ? null
              : { ...state.players.p1.active, lockedAttack: { turn: state.turn - 1, attackIndex: 0 } },
        },
      },
    };
    renderHud(stale);
    expect(attackButton().disabled).toBe(false);
  });
});
