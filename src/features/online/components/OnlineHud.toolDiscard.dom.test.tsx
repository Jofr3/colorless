// @vitest-environment jsdom
// 🆕🆕🆕 D543 — THE `discardTools` DIALOG ON THE **ONLINE** SURFACE.
//
// The ELEVENTH wire prompt kind, and the first whose candidates are Pokémon TOOLS.
// A park with no dialog is not a missing feature, it is a SOFT-LOCK — the phase
// swallows Escape, has no decline, and the match cannot proceed without an answer
// no rendered control can send — so the dialog lands in the same slice as the op.
//
// ⚠️ **THE COVERAGE PIN IS ELSEWHERE AND IS NOT DUPLICATED HERE.**
// `OnlineHud.chooseAttack.dom.test.tsx` reads `redactedEffectPromptSchema.options`
// LIVE and asserts a dialog renders for EVERY kind, both directions; this file
// asserts what THIS dialog actually does. The two are different questions.
//
// 🛑 **DECLINABLE IS THE WHOLE SHAPE OF THIS DECISION.** The printed *"up to 2"*
// makes 0 a legal answer, so nothing is pre-answered, Confirm is always enabled,
// the button names what pressing it will DO, and the engine is sent `uids: []` on
// a decline rather than nothing at all. Every rung below is one of those four.

import type { RedactedCard, RedactedGame, RedactedInPlay } from "@luminous/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

beforeAll(installDomShims);
afterEach(cleanup);

const NOTE = "Discard up to 2 Pokémon Tools from your opponent's Pokémon.";

const EMPTY_SIDE: RedactedGame["board"]["you"] = {
  hand: [],
  active: null,
  bench: [],
  prizesRemaining: 6,
  deckCount: 53,
  discard: [],
};

function tool(id: string, name: string): RedactedCard {
  return { id, cardId: id, name, category: "Trainer", trainerType: "Tool", hasImage: false };
}

function body(id: string, name: string, tools: RedactedCard[]): RedactedInPlay {
  return {
    id,
    cardId: id,
    name,
    category: "Pokemon",
    trainerType: null,
    hasImage: false,
    battle: {
      damage: 0,
      hp: 120,
      conditions: { rotation: "none", poisonDamage: 0, burned: false, confusionDamage: 30 },
    },
    attached: { tools, energies: [] },
  };
}

const OPP_ACTIVE = { seat: "p2", spot: { spot: "active" } } as const;
const OPP_BENCH0 = { seat: "p2", spot: { spot: "bench", index: 0 } } as const;

/** TWO hosts, one Tool each — the board the engine actually parks on (the engine
    suite's §4 asserts that shape), and the board on which a dialog that grouped
    wrongly, pre-answered, or ignored the cap is distinguishable from a correct one. */
function toolGame(max: number): RedactedGame {
  return {
    seat: "p1",
    turn: 3,
    phase: {
      kind: "effect:choose",
      prompt: {
        kind: "discardTools",
        discardable: [
          { uid: "t1", from: OPP_ACTIVE },
          { uid: "t2", from: OPP_BENCH0 },
        ],
        scope: { kind: "upTo", max },
        note: NOTE,
      },
    },
    board: {
      stadium: null,
      you: EMPTY_SIDE,
      opponent: {
        ...EMPTY_SIDE,
        active: body("oa", "Their Active", [tool("t1", "Rock Chestplate")]),
        bench: [body("ob", "Their Bench", [tool("t2", "Bravery Charm")])],
      },
    },
    activePlayer: "you",
    waitingOn: "you",
    outcome: null,
  };
}

describe("🛑 OnlineHud discardTools — the eleventh wire prompt kind", () => {
  it("🛑 renders the dialog, the printed heading, and BOTH Tools by name", () => {
    render(<OnlineHud game={toolGame(2)} waitingOn="you" activePlaced={false} onAction={vi.fn()} />);
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rock Chestplate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bravery Charm" })).toBeTruthy();
    // The names come off the board's `attached.tools`, which is the seam a build
    // that reused `energyName` would get wrong — it would render the raw uids.
    expect(screen.queryByRole("button", { name: "t1" })).toBeNull();
    expect(screen.queryByRole("button", { name: "t2" })).toBeNull();
  });

  it("🛑 groups by HOST, and each legend names the Pokémon, its spot and the SIDE", () => {
    // Every row reads like a Trainer name, so without the host in the group's
    // accessible name a screen reader never says which Pokémon loses the card —
    // and this dialog always names the OPPONENT's bodies, so the `opponent` marker
    // is the only thing that says whose board is being stripped.
    render(<OnlineHud game={toolGame(2)} waitingOn="you" activePlaced={false} onAction={vi.fn()} />);
    expect(screen.getByText(/Their Active · Active · opponent/)).toBeTruthy();
    expect(screen.getByText(/Their Bench · Bench 1 · opponent/)).toBeTruthy();
  });

  it("🛑 DECLINABLE: Confirm is enabled at zero picks and nothing is pre-pressed", () => {
    render(<OnlineHud game={toolGame(2)} waitingOn="you" activePlaced={false} onAction={vi.fn()} />);
    for (const name of ["Rock Chestplate", "Bravery Charm"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
    }
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: "Discard none" });
    expect(confirm.disabled).toBe(false);
    expect(screen.getByText(/Pick up to 2 Pokémon Tools to discard \(0 selected\)\./)).toBeTruthy();
  });

  it("🛑 THE DECLINE DISPATCHES `uids: []` — the answer that is not a whiff", () => {
    const onAction = vi.fn();
    render(<OnlineHud game={toolGame(2)} waitingOn="you" activePlaced={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard none" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardTools", uids: [] },
    });
  });

  it("🛑 both picks dispatch BOTH uids, in press order", () => {
    const onAction = vi.fn();
    render(<OnlineHud game={toolGame(2)} waitingOn="you" activePlaced={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Bravery Charm" }));
    fireEvent.click(screen.getByRole("button", { name: "Rock Chestplate" }));
    expect(screen.getByText(/\(2 selected\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard 2" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardTools", uids: ["t2", "t1"] },
    });
  });

  it("🛑 the CAP is enforced and the closed row says so", () => {
    render(<OnlineHud game={toolGame(1)} waitingOn="you" activePlaced={false} onAction={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rock Chestplate" }));
    const second = screen.getByRole("button", { name: "Bravery Charm" });
    expect(second.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(second);
    expect(second.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Discard 1" })).toBeTruthy();
    // …and the caption says ONE, singular, because the ceiling is 1 here.
    expect(screen.getByText(/Pick up to 1 Pokémon Tool to discard/)).toBeTruthy();
  });

  it("the ANSWER never sends a Tool uid as a discardEnergy choice", () => {
    // The reason `discardTools` is its OWN prompt kind and its own choice member:
    // a shared kind would let this dialog's answer reach the ENERGY apply, where
    // the uid would be stripped from the wrong array (or silently from neither).
    const onAction = vi.fn();
    render(<OnlineHud game={toolGame(2)} waitingOn="you" activePlaced={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Rock Chestplate" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard 1" }));
    const call = onAction.mock.calls[0]?.[0] as { choice: { kind: string } };
    expect(call.choice.kind).toBe("discardTools");
  });
});
