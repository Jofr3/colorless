// @vitest-environment jsdom
import type { GameAction } from "@luminous/engine";
import type { RedactedGame, RedactedInPlay, RedactedPhase } from "@luminous/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

// D210 — WHAT the §7.3 Stadium control does, beside the scan in
// `OnlineHud.stadiumAbility.test.ts` that asserts THAT it exists.
//
// The two are deliberately separate. The scan is one half of a biconditional
// chained to the api's allowlist (wire offer ⟺ a dispatch under
// `src/features/online`), and it must stay indifferent to which panel or label
// someone chooses. This file is the opposite: it renders the real HUD off a real
// wire shape and pins the behaviour a wrong implementation would get wrong —
// which is the only place the four realistic mutants can actually die.
//
// The mutants each case here kills are named at the assertion. In short:
//   (a) offering the Stadium to BOTH seats — killed by the non-acting viewer case
//       (the server sends `null`; if the client invented a row from
//       `board.stadium` instead, the opponent would get a button);
//   (b) reading the once-per-turn flag from the wrong place — killed by the
//       greying case, which is driven by the server's `disabled` alone;
//   (c) ignoring the server's fold and re-deriving playability here — killed by
//       the greyed row NOT dispatching;
//   (d) dispatching without the seat — killed by the exact-payload assertion.

beforeAll(installDomShims);
afterEach(cleanup);

function inPlay(id: string, name: string): RedactedInPlay {
  return {
    id,
    cardId: id,
    name,
    category: "Pokemon",
    trainerType: null,
    hasImage: false,
    battle: { damage: 0, hp: 60, conditions: { rotation: "none", poisonDamage: 0, burned: false } },
    attached: { tools: [], energies: [] },
  };
}

/** The shared Stadium as it crosses the wire — PUBLIC to both viewers, which is
    exactly why the offer beside it has to be withheld deliberately rather than
    by accident: a client could otherwise read the card off the board and grow its
    own button. */
const LEVINCIA = {
  id: "s1",
  cardId: "sv09-150",
  name: "Levincia",
  category: "Trainer" as const,
  trainerType: "Stadium" as const,
  hasImage: false,
};

function turnAction(
  stadiumAbility: Extract<RedactedPhase, { kind: "turn:action" }>["stadiumAbility"],
): RedactedPhase {
  return {
    kind: "turn:action",
    attacks: [],
    retreat: null,
    abilities: [],
    trainers: [],
    rareCandy: [],
    stadiumAbility,
  };
}

function game(phase: RedactedPhase, waitingOn: RedactedGame["waitingOn"] = "you"): RedactedGame {
  const emptySide: RedactedGame["board"]["you"] = {
    hand: [],
    active: inPlay("a1", "Mareep"),
    bench: [],
    prizesRemaining: 6,
    deckCount: 53,
    discard: [],
  };
  return {
    seat: "p1",
    turn: 3,
    phase,
    // The Stadium is on the board for BOTH viewers in every case below — the
    // variable under test is only ever the phase's offer.
    board: { stadium: LEVINCIA, you: { ...emptySide }, opponent: { ...emptySide } },
    activePlayer: "you",
    waitingOn,
    outcome: null,
  };
}

describe("OnlineHud — the §7.3 Stadium activation row (D210)", () => {
  it("dispatches `useStadiumAbility` WITH THE VIEWER'S SEAT and nothing else", () => {
    const onAction = vi.fn<(action: GameAction) => void>();
    render(
      <OnlineHud
        game={game(turnAction({ label: "Levincia", disabled: false, reason: null }))}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
    // The row is labelled with the Stadium's own name — the server's `label`,
    // which is `StadiumAbility.label` and the same string the
    // STADIUM_ABILITY_ACTIVATED log row carries.
    const button = screen.getByRole("button", { name: "Levincia" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    // RED IF: the click dispatches nothing (no wiring), dispatches a different
    // action type, or omits/hard-codes the seat — mutant (d). `toEqual` on the
    // WHOLE payload, not `toMatchObject`, so an extra invented field (a target,
    // a uid) fails too: this action carries a seat and nothing else.
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]).toEqual({ type: "useStadiumAbility", seat: "p1" });
  });

  it("greys the row off the SERVER's `disabled` and refuses to dispatch — with the reason readable", () => {
    const onAction = vi.fn<(action: GameAction) => void>();
    render(
      <OnlineHud
        game={game(
          turnAction({ label: "Levincia", disabled: true, reason: "No legal target" }),
        )}
        waitingOn="you"
        activePlaced
        onAction={onAction}
      />,
    );
    const button = screen.getByRole("button", { name: "Levincia" }) as HTMLButtonElement;
    // RED IF: the client ignores `disabled` and lights the row up anyway —
    // mutants (b) and (c), the once-per-turn flag and the whiff gate both ride
    // this ONE boolean, and both are state this client can never recompute.
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();
    // The greyed row's printed clause is reachable to a screen reader (a disabled
    // button is out of the tab order, so the tooltip alone would not be) — the
    // Ability rows' doctrine. RED IF the sr-only twin is dropped.
    expect(screen.getByText("No legal target")).toBeTruthy();
  });

  it("renders NO row when the server sends no offer — the Stadium on the board is not enough", () => {
    const onAction = vi.fn<(action: GameAction) => void>();
    render(
      <OnlineHud game={game(turnAction(null))} waitingOn="you" activePlaced onAction={onAction} />,
    );
    // The Stadium IS in play and public (board.stadium is Levincia above), and the
    // panel is rendered (its Pass control is there) — so this is not "the HUD
    // showed nothing". RED IF: the client derives the row from `board.stadium`
    // instead of the phase — mutant (a) in its client-side form, which would put
    // a live button in front of the seat whose turn it is NOT, and in front of a
    // player whose Stadium is continuous-only (Beach Court).
    expect(screen.getByRole("button", { name: "Pass" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Levincia" })).toBeNull();
  });

  it("renders nothing at all for the viewer who is not being waited on", () => {
    const onAction = vi.fn<(action: GameAction) => void>();
    // The offer is deliberately NON-null here — i.e. even if a buggy server ever
    // sent the acting seat's row to the wrong viewer, the client's own
    // `waitingOn` gate (D17) still withholds the button. Belt and braces, in the
    // order the repo puts them: the redactor is the barrier, this is the backstop.
    render(
      <OnlineHud
        game={game(turnAction({ label: "Levincia", disabled: false, reason: null }), "opponent")}
        waitingOn="opponent"
        activePlaced
        onAction={onAction}
      />,
    );
    expect(screen.queryByRole("button", { name: "Levincia" })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});
