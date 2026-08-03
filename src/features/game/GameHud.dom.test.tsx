// @vitest-environment jsdom
// TurnPanel's §12 status gating. The predicate must MIRROR the engine's
// gates exactly (STATUS_PREVENTS_ATTACK / STATUS_PREVENTS_RETREAT: asleep or
// paralyzed — confusion, poison and burn block nothing at declaration), or
// the HUD drifts from what the engine will accept. Real engine states via
// the fixtures; the HUD reads conditions off the PROJECTED board.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameAction, GameState } from "@luminous/engine";
import {
  OPPONENT_ATTACK_LOCK_DECK,
  attachFromDeck,
  deckOf,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setConditions,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

// The <dialog> shims the effect-choose dialog needs (showModal/close), shared
// with every other dialog suite in this folder. Harmless for the TurnPanel
// cases above, which mount no dialog at all.
beforeAll(installDomShims);
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
  function barAttack(state: GameState, ...attackIndexes: number[]): GameState {
    const side = state.players.p1;
    const active = side.active;
    if (active === null) throw new Error("p1 has no Active Pokémon");
    const lockedAttacks = attackIndexes.map((attackIndex) => ({ turn: state.turn, attackIndex }));
    return {
      ...state,
      players: { ...state.players, p1: { ...side, active: { ...active, lockedAttacks } } },
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

  // D165 — TWO live bars on one body, the cell this panel could not reach before
  // the field became a list. The engine's `lockedAttacks` has two writers whose
  // stamps collide from adjacent turns, so this is an ORDINARY board and not a
  // constructed one (the played line is in lockedAttackMerge.test.ts). What is
  // pinned here is the projection's half: a HUD that read ONE index would grey
  // whichever bar was written last and offer the other, which is a button the
  // server rejects with ATTACK_PREVENTED.
  it("greys EVERY barred row when two bars are live, not the last one written", () => {
    renderHud(barAttack(battleReady(), 0, 2));
    expect(attackButton().disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Yawn/ }) as HTMLButtonElement).disabled).toBe(true);
    // …and the CONTROL, on the same board with the bars removed: both rows come
    // back, so "both disabled" cannot be passing because the panel was unpayable.
    // (fix-attacker's "Flame" and "Rage" are unpayable on this board either way,
    // which is exactly why the two BARRED rows are the costless one and the {C}
    // one — the two whose greying can only be the bar.)
    cleanup();
    renderHud(barAttack(battleReady()));
    expect(attackButton().disabled).toBe(false);
    expect((screen.getByRole("button", { name: /Yawn/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
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
              : {
                  ...state.players.p1.active,
                  lockedAttacks: [{ turn: state.turn - 1, attackIndex: 0 }],
                },
        },
      },
    };
    renderHud(stale);
    expect(attackButton().disabled).toBe(false);
  });
});

describe("EffectChooseDialog — §8/§11 the CHOSEN opponent attack (D157)", () => {
  // The eighth prompt kind, and the first whose candidates are neither cards nor
  // Pokémon. What is pinned here is the half the engine suite cannot see: that the
  // dialog renders the ROWS the engine offered, dispatches the INDEX the engine
  // will accept, and reads its labels off the PROMPT rather than off the board —
  // which is what makes it work identically on the wire, where the opponent's
  // attack rows do not cross at all.
  //
  // ⚠️ AND IT IS THE INVARIANT `apps/api/src/lobby/match.ts` NAMES: `resolveEffect`
  // is on the DO's allowlist exactly while EVERY prompt kind has an online dialog.
  // A ninth kind added without one re-arms a soft-lock, so this case is the shape
  // that obligation is discharged in.
  function parkedOnAttackChoice(): { state: GameState; sent: GameAction[] } {
    let state = driveSetup(
      21,
      { p1: OPPONENT_ATTACK_LOCK_DECK, p2: OPPONENT_ATTACK_LOCK_DECK },
      { first: "p2" },
    );
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "sv02-094");
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    return { state, sent: [] };
  }

  it("offers one row per printed attack of the DEFENDER, in printed order", () => {
    const { state, sent } = parkedOnAttackChoice();
    render(
      <GameHud
        game={state}
        projection={projectGameState(state, "p1")}
        viewerSeat="p1"
        names={NAMES}
        dispatch={(action) => sent.push(action)}
        onPlayAgain={() => {}}
      />,
    );
    expect(screen.getByText(/Choose 1 of fix-attacker's attacks/)).toBeTruthy();
    for (const name of ["Bite", "Flame", "Yawn", "Rage", "Fury", "Bounty"]) {
      expect(screen.getByRole("button", { name }), name).toBeTruthy();
    }
  });

  it("dispatches the picked INDEX, and the engine accepts it", () => {
    const { state, sent } = parkedOnAttackChoice();
    render(
      <GameHud
        game={state}
        projection={projectGameState(state, "p1")}
        viewerSeat="p1"
        names={NAMES}
        dispatch={(action) => sent.push(action)}
        onPlayAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rage" }));
    expect(sent).toEqual([
      { type: "resolveEffect", seat: "p1", choice: { kind: "attack", index: 3 } },
    ]);
    // …and the dispatch is not merely well-shaped, it is LEGAL: the same action
    // fed to the engine installs the record. A dialog that offered a row the
    // validator rejects is exactly the soft-lock the allowlist invariant is about.
    const applied = mustApply(state, sent[0] as GameAction).state;
    expect(applied.players.p2.active?.lockedAttacks).toEqual([{ turn: 3, attackIndex: 3 }]);
  });
});
