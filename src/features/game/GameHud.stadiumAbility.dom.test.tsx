// @vitest-environment jsdom
// D213 — the §7.3 SHARED STADIUM's activated ability on the LOCAL hot-seat HUD.
//
// D210 gave `useStadiumAbility` its first client surface anywhere — the ONLINE
// one — and in doing so established that the action the engine has driven since
// 0.53.0 (cardplay.ts, D102) appeared NOWHERE under `src/`. The local half was
// the asymmetry that left: an online player could activate Levincia sv09-150 /
// sv10-244 or Spikemuth Gym sv10-169 and a hot-seat player, on the same board,
// could not. This file is the local half's guard.
//
// WHAT MAKES IT THE LOCAL HALF RATHER THAN A PORT. The online HUD renders a
// `RedactedStadiumAbility` the SERVER already folded; `GameHud` has the live
// `GameState` and folds the same three terms itself in `stadiumAbilityOption`
// (a Stadium in play, that Stadium's program carrying an `ability`,
// `allowances.stadiumAbilityUsed || !programPlayable(...)`). So the online DOM
// suite can drive its cases by writing wire literals, and this one CANNOT: every
// case below is a real engine board, reached by real actions, because the fold
// under test is exactly the claim that the button and `cardplay.ts` agree.
//
// The realistic wrong implementations and where each dies:
//   (a) offering it when `allowances.stadiumAbilityUsed` is already set — killed
//       by "greys once the turn's activation is spent", which spends it for real;
//   (b) rendering a row for ANY Stadium in play — killed by the Beach Court case
//       (a real Stadium with a real printed effect and no activated ability);
//   (c) dispatching without the seat (or with an invented target) — killed by the
//       whole-payload `toEqual` in the first case;
//   (d) showing it to the non-acting hot-seat player — killed by the paired
//       viewer case, which asserts the SAME state does render it for the actor;
//   (e) dropping the `programPlayable` term — SURVIVES, and the last block says
//       so out loud rather than shipping a guard that cannot fail. No printed
//       Stadium ability can whiff-gate, so no board over the real pool
//       discriminates it; the vacuity is pinned there instead.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState, Seat } from "@luminous/engine";
import { applyAction, programFor, programPlayable } from "@luminous/engine";
import {
  STADIUM_ABILITY_DECK,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;
const BOTH = { p1: STADIUM_ABILITY_DECK, p2: STADIUM_ABILITY_DECK };

/** Setup, then open P1's turn 2 (P2 went first and passed) — no §4 restrictions.
    The same opener `stadiumAbility.test.ts` and `redactStadiumAbility.test.ts`
    use, so all three surfaces are asserted over the same boards. */
function p1Turn2(seed = 1): GameState {
  return must(
    applyAction(driveSetup(seed, BOTH, { first: "p2" }), { type: "endTurn", seat: "p2" }),
  );
}

/** Put a Stadium into `seat`'s hand and PLAY it — the real drag the local HUD
    already supports, not surgery, so every board below is one a hot-seat match
    actually reaches. */
function withStadium(state: GameState, seat: Seat, cardId: string): GameState {
  const next = handFromDeck(state, seat, cardId, 1);
  return must(applyAction(next, { type: "playTrainer", seat, uid: handUid(next, seat, cardId) }));
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

/** The panel's "Stadium" section, or null when no row is offered.

    ⚠️ SCOPED, NOT A BARE `getByRole("button", { name })`. The first draft of this
    file queried by the Stadium's NAME and was green for the wrong reason: a
    SECOND copy of the same Stadium sitting in hand renders its own (disabled)
    row in the Trainers list, so "Beach Court is on screen" was true on a board
    whose §7.3 section did not exist. The section heading is the discriminator —
    nothing else in this panel renders the text "Stadium" — and scoping the button
    lookup inside it means a row smuggled into Abilities/Trainers cannot satisfy
    these assertions either. */
function stadiumSection(): HTMLElement | null {
  const heading = screen.queryByText("Stadium");
  return heading === null ? null : (heading.parentElement as HTMLElement);
}
function stadiumRow(): HTMLButtonElement | null {
  const section = stadiumSection();
  return section === null ? null : (within(section).getByRole("button") as HTMLButtonElement);
}

describe("GameHud — the §7.3 Stadium activation row (D213)", () => {
  it("offers the row and dispatches the seat-bound action, and NOTHING else", () => {
    const dispatch = vi.fn<(action: GameAction) => void>();
    renderHud(withStadium(p1Turn2(1), "p1", "sv03-196"), "p1", dispatch);

    // RED IF THERE IS NO CONTROL AT ALL — which is the state of the repo before
    // this slice, and the reason this file exists. A DOM query for a rendered
    // button cannot be satisfied by prose: unlike a source scan for the action's
    // name (the trap D210 nearly shipped), a comment renders nothing.
    const button = stadiumRow();
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    // The row is labelled with `StadiumAbility.label` — the Stadium's own name,
    // the same string the STADIUM_ABILITY_ACTIVATED log row carries. RED IF the
    // row renders some other text (a generic "Use Stadium"), which would leave
    // the player unable to tell which card they are about to activate.
    expect(button?.textContent).toBe("Town Store");

    fireEvent.click(button as HTMLButtonElement);
    // RED IF: the click dispatches nothing, dispatches a different action type,
    // or omits/hard-codes the seat — mutant (c). `toEqual` on the WHOLE payload
    // rather than `toMatchObject`, so an invented field (a uid, a target) fails
    // too: there is exactly one Stadium, so this action carries a seat alone.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toEqual({ type: "useStadiumAbility", seat: "p1" });
  });

  it("renders NO row when no Stadium is in play — and the panel is otherwise there", () => {
    const bare = p1Turn2(1);
    expect(bare.stadium).toBeNull();
    renderHud(bare, "p1", () => {});
    // The panel IS rendered (its Pass control is present), so this is not "the
    // HUD showed nothing". RED IF the row is rendered unconditionally, which
    // would put a button in front of a player for a card that is not on the table
    // and that `useStadiumAbility` answers STADIUM_ABILITY_UNAVAILABLE.
    expect(screen.getByRole("button", { name: "Pass" })).toBeTruthy();
    expect(stadiumRow()).toBeNull();
  });

  it("renders NO row for a CONTINUOUS-only Stadium — a Stadium in play is not enough", () => {
    // Beach Court is a real Stadium with a real printed effect (a Basic retreat
    // discount) and NO activated ability: `programFor(id).stadium.ability` is
    // undefined. Asserted here rather than assumed, so the null below is a fact
    // about the fold and not about a card that quietly changed.
    expect(programFor("sv01-167")?.stadium?.ability).toBeUndefined();
    const beachCourt = withStadium(p1Turn2(1), "p1", "sv01-167");
    expect(beachCourt.stadium).not.toBeNull();
    renderHud(beachCourt, "p1", () => {});
    // RED IF the fold drops the `programFor(...)?.stadium?.ability` term and
    // offers a row for any Stadium on the table — mutant (b).
    expect(screen.getByRole("button", { name: "Pass" })).toBeTruthy();
    expect(stadiumSection()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ONCE-PER-TURN STATE, SPENT FOR REAL.

/** Activate Town Store through the engine and answer its `chooseCards` park,
    landing back on turn:action with the allowance spent. */
function activateTownStore(state: GameState): GameState {
  const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected the search park");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return must(
    applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [prompt.candidates[0] as string] },
    }),
  );
}

describe("GameHud — the once-per-turn greying, and the re-arm", () => {
  it("greys the row once the turn's activation is spent, and refuses to dispatch", () => {
    const spent = activateTownStore(withStadium(p1Turn2(1), "p1", "sv03-196"));
    expect(spent.phase.kind).toBe("turn:action");
    expect(spent.allowances.stadiumAbilityUsed).toBe(true);
    const dispatch = vi.fn<(action: GameAction) => void>();
    renderHud(spent, "p1", dispatch);
    // RED IF the `allowances.stadiumAbilityUsed` term is dropped — mutant (a).
    // The HUD would light a row `useStadiumAbility` answers
    // STADIUM_ABILITY_ALREADY_USED, i.e. a button whose only outcome is a reject.
    expect(stadiumRow()?.disabled).toBe(true);
    fireEvent.click(stadiumRow() as HTMLButtonElement);
    expect(dispatch).not.toHaveBeenCalled();
    // …and no invented explanation. "Already used this turn" is self-evident, so
    // `reason` stays undefined — the Ability/Trainer rows' contract, shared with
    // the wire fold. RED IF someone gives this branch a string.
    expect(within(stadiumSection() as HTMLElement).queryByText("No legal target")).toBeNull();
    expect((stadiumSection() as HTMLElement).querySelector("li[title]")).toBeNull();
  });

  it("RE-ARMS for the opponent's own turn — the printed 'once during EACH player's turn'", () => {
    const spent = activateTownStore(withStadium(p1Turn2(1), "p1", "sv03-196"));
    const p2Turn = must(applyAction(spent, { type: "endTurn", seat: "p1" }));
    expect(p2Turn.allowances.stadiumAbilityUsed).toBe(false);
    // The Stadium is still P1's CARD. Ownership is not the discriminant — the
    // turn is — which is the whole reason this affordance fits in neither of the
    // panel's own-board / own-hand lists.
    expect(p2Turn.stadium?.owner).toBe("p1");
    const dispatch = vi.fn<(action: GameAction) => void>();
    renderHud(p2Turn, "p2", dispatch);
    // RED IF the fold grew per-seat bookkeeping for a flag that has none
    // (`TurnAllowances` is ONE object, reset at the turn boundary), or if it
    // gated on `stadium.owner`: either would grey — or hide — this row.
    expect(stadiumRow()?.disabled).toBe(false);
    fireEvent.click(stadiumRow() as HTMLButtonElement);
    expect(dispatch.mock.calls[0]?.[0]).toEqual({ type: "useStadiumAbility", seat: "p2" });
  });

  it("stays off the NON-ACTING hot-seat viewer's screen, on a board that does offer it", () => {
    // Both halves of the pair run on the SAME state, so this cannot pass by the
    // row being absent everywhere — which is what makes it a guard rather than a
    // restatement of "GameHud renders nothing for the opponent".
    const state = withStadium(p1Turn2(1), "p1", "sv03-196");
    renderHud(state, "p1", () => {});
    expect(stadiumRow()).not.toBeNull();
    cleanup();
    // RED IF the control is ever hoisted out of TurnPanel, which `GameHud`'s
    // phase switch mounts only for `waitingOn === "you"` (D17) — mutant (d).
    // In hot-seat that is the person holding the device.
    renderHud(state, "p2", () => {});
    expect(stadiumRow()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE PARK IS DIALOGED — the soft-lock check, driven from the CLICK's own payload.

describe("the `chooseCards` park the row causes is dialoged on this surface", () => {
  it("takes the button's OWN dispatched action through the engine and renders the dialog", () => {
    // D157 shipped a control that parked the client on a prompt no dialog
    // rendered, and D201 had to fix it: `effect:choose` swallows Escape, offers
    // no decline, and cannot advance without an answer, so a park with no dialog
    // is a SOFT-LOCK rather than a missing feature. Both implemented Stadium
    // abilities park this way, so the local router's `chooseCards` arm is what
    // stands between this row and that bug.
    const dispatch = vi.fn<(action: GameAction) => void>();
    const board = withStadium(p1Turn2(1), "p1", "sv03-196");
    renderHud(board, "p1", dispatch);
    fireEvent.click(stadiumRow() as HTMLButtonElement);
    const pressed = dispatch.mock.calls[0]?.[0] as GameAction;
    cleanup();

    // The exact object the BUTTON sent, fed to the real reducer — not a
    // hand-written twin. RED IF the row ever dispatches something the engine
    // rejects (mustApply throws), which is the other way a control soft-locks.
    const { state: parked } = mustApply(board, pressed);
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt.kind).toBe("chooseCards");

    const answer = vi.fn<(action: GameAction) => void>();
    renderHud(parked, "p1", answer);
    // RED IF the local router loses its `chooseCards` arm, or if the park lands
    // on a seat the dialog is not mounted for: `EffectChooseDialog` would render
    // null and the player would face a board with no way forward.
    expect(screen.getByRole("dialog", { name: "Choose cards" })).toBeTruthy();
    // …and the dialog can actually ANSWER it. A rendered-but-inert dialog is the
    // same soft-lock one step later.
    fireEvent.click(screen.getByRole("button", { name: /^Take/ }));
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer.mock.calls[0]?.[0]).toMatchObject({ type: "resolveEffect", seat: "p1" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE `programPlayable` TERM, AND THE HONEST ADMISSION ABOUT IT.

describe("the `programPlayable` term in the LOCAL fold is correct and, today, UNREACHABLE", () => {
  /** Every printed Stadium ability the registry implements — D209's census, kept
      as a literal because `REGISTRY` is not exported and this list is the claim.
      The engine-side twin lives in `redactStadiumAbility.test.ts`; this copy
      exists because the LOCAL fold has its own copy of the term. */
  const STADIUM_ABILITY_IDS = [
    "sv02-171", // Artazon
    "sv03-229", // Artazon (reprint)
    "sv01-178", // Mesagoza
    "sv03-196", // Town Store
    "sv09-150", // Levincia
    "sv10-244", // Levincia (reprint)
    "sv10-169", // Spikemuth Gym
  ];

  it("NO printed Stadium program can whiff-gate — so no DOM case above can grey the row that way", () => {
    // The most adverse board `programPlayable` has gates for: nothing in either
    // deck, hand or discard, no Bench on either side, no Energy anywhere.
    const base = p1Turn2(1);
    const stripped: GameState = {
      ...base,
      players: {
        p1: { ...base.players.p1, deck: [], hand: [], discard: [], bench: [] },
        p2: { ...base.players.p2, deck: [], hand: [], discard: [], bench: [] },
      },
    };
    for (const id of STADIUM_ABILITY_IDS) {
      const ability = programFor(id)?.stadium?.ability;
      if (ability === undefined) throw new Error(`${id} has no stadium ability`);
      // ⚠️ THE ADMISSION, PINNED. Every printed Stadium ability searches a deck or
      // retrieves from a discard, and `programPlayable` gates NEITHER ("a deck
      // search is always playable enough", cardplay.ts). So the `!programPlayable`
      // term in `stadiumAbilityOption` cannot currently return true, the "No legal
      // target" tooltip is UNREACHABLE from any authored card, and mutant (e)
      // SURVIVES. No assertion in this file pretends otherwise — a DOM case that
      // "proved" the greyed-with-reason row would have had to fabricate a Stadium
      // program the registry does not contain.
      expect(programPlayable(stripped, ability.program, "p1")).toBe(true);
    }
    // The control that makes the loop mean something: this state DOES make
    // `programPlayable` false for a gated op, so "true" above is a fact about
    // these programs and not about this board. RED the day a gated op joins one
    // of the seven — at which point the local case becomes writable.
    expect(programPlayable(stripped, [{ op: "gust" }], "p1")).toBe(false);
  });
});
