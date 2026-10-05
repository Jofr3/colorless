// @vitest-environment jsdom
// 🆕🆕🆕 D542 — THE CONFIRM VERB ON THE **ONLINE** DIALOG, AND THE UNION MEMBER THAT
// FELL OUT OF THE WRONG SIDE OF A TERNARY.
//
// 🛑 **THE LOCAL HUD WAS FIXED AND THE ONLINE ONE WAS NOT, AND NOTHING COULD SEE
// IT.** `GameHud.tsx`'s twin of this dialog documents the repair in its own words —
// *"The mandatory branch had the mirror hole: it tested `"deckBottom"` and rendered
// *"Discard"* for everything else … A record keyed on the union goes red at `tsc`
// when a member is added; a ternary goes quiet"* — and `OnlineHud.tsx` still had
// the ternary at D541's head:
//
//     mandatory ? `${prompt.dest === "deckBottom" ? "Put under deck" : "Discard"} …`
//               : `${prompt.dest === "deck" ? "Shuffle" : "Take"} …`
//
// ⚠️ **IT WAS INERT UNTIL D542 AND IT IS NOT INERT NOW.** Every producer of a
// `chooseCards` park with `dest: "deck"` parked at `min: 0` (`discardPileRetrieval`),
// so the "up to" cell shipped live and the MANDATORY cell did not.
// `opponentDiscardsFromHand { to: "deck" }` is the engine's FIRST mandatory
// `dest: "deck"` park (`min === max === 3`, *"Your opponent chooses 3 cards from
// their hand and shuffles those cards into their deck."*), and against the old
// ternary it rendered **"Discard 0/3"** under a heading that reads *"Shuffle 3 cards
// from your hand into your deck."* — the dialog contradicting itself in its own
// words, with `tsc` silent and every engine suite green.
//
// 🛑 **THE HEADING IS ASSERTED BESIDE THE BUTTON, DELIBERATELY** (the local twin's
// rule, for its reason): the defect was never *"the label is wrong"* in isolation —
// it was the label contradicting the sentence directly above it, and a test that
// only pinned the button would go green on a build that changed both to something
// equally wrong.
//
// ⚠️ THE PROMPTS HERE ARE HAND-BUILT WIRE SNAPSHOTS, which is what every test in the
// sibling `OnlineHud.dom.test.tsx` does anyway — the online client only ever holds a
// `RedactedGame`. The MANDATORY-`deck` prompt's shape is not invented: it is the one
// `opponentHandShuffle.test.ts` §8 asserts the engine actually parks, so the two
// rungs move together.

import type { RedactedGame } from "@luminous/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

beforeAll(installDomShims);
afterEach(cleanup);

const EMPTY_SIDE: RedactedGame["board"]["you"] = {
  hand: [],
  active: null,
  bench: [],
  prizesRemaining: 6,
  faceUpPrizes: [], // 🆕🆕🆕 D548 — REQUIRED on the wire side (D159); no prize is face up on this board
  deckCount: 53,
  discard: [],
};

function card(id: string, name: string) {
  return { id, cardId: id, name, category: "Trainer" as const, trainerType: null, hasImage: false };
}

type Prompt = Extract<
  NonNullable<Extract<RedactedGame["phase"], { kind: "effect:choose" }>["prompt"]>,
  { kind: "chooseCards" }
>;

function gameWith(prompt: Prompt): RedactedGame {
  return {
    seat: "p1",
    turn: 3,
    phase: { kind: "effect:choose", prompt },
    board: { stadium: null, you: EMPTY_SIDE, opponent: EMPTY_SIDE },
    activePlayer: "opponent",
    waitingOn: "you",
    outcome: null,
  };
}

const THREE = [card("h1", "Card One"), card("h2", "Card Two"), card("h3", "Card Three")];

describe("🛑 OnlineHud chooseCards — the MANDATORY deck pick D542 made reachable", () => {
  it("🛑 renders SHUFFLE, not DISCARD, under a heading that promises a shuffle", () => {
    // `D542-online-mandatory-verb-falls-through` is the declared row, and this is the
    // only assertion in the repo that can see it.
    render(
      <OnlineHud
        game={gameWith({
          kind: "chooseCards",
          candidates: THREE,
          min: 3,
          max: 3,
          dest: "deck",
          note: "Shuffle 3 cards from your hand into your deck.",
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={vi.fn()}
      />,
    );
    // THE HEADING, beside the button — the engine's own caption, byte for byte.
    expect(screen.getByText("Shuffle 3 cards from your hand into your deck.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Shuffle 0\/3/ })).toBeTruthy();
    // …and the verb the old ternary produced is ABSENT, which is the half that fails
    // on a build that renders both.
    expect(screen.queryByRole("button", { name: /Discard 0\/3/ })).toBeNull();
  });

  it("the mandatory deck pick still gates Confirm to the count, then dispatches", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={gameWith({
          kind: "chooseCards",
          candidates: THREE,
          min: 3,
          max: 3,
          dest: "deck",
          note: "Shuffle 3 cards from your hand into your deck.",
        })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Shuffle 0\/3/ }).disabled).toBe(
      true,
    );
    for (const name of ["Card One", "Card Two", "Card Three"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    const armed = screen.getByRole<HTMLButtonElement>("button", { name: /Shuffle 3\/3/ });
    expect(armed.disabled).toBe(false);
    fireEvent.click(armed);
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: ["h1", "h2", "h3"] },
    });
  });

  it("🛑 THE MANDATORY CELLS THE OLD TERNARY GOT WRONG, one per `dest` member", () => {
    // ⚠️ THE CONTROL WITHOUT WHICH THE RUNG ABOVE IS ONE CELL: the ternary rendered
    // *"Discard"* for every member but `"deckBottom"`, so `bench`, `deckTop`, `hand`
    // and `evolve` were wrong too — all of them unreachable today, all of them filled
    // for the reason the local HUD's table states (*guessing a verb for a cell nobody
    // can reach is cheap; leaving it to a fallback is how `"evolve"` got "Take"*).
    // Driven here so the NEXT op to make one reachable finds a rung already standing,
    // which is D407's built-but-dead guard arriving from the useful side.
    const cells: [Prompt["dest"], string][] = [
      ["bench", "Put on Bench"],
      ["hand", "Take"],
      ["deck", "Shuffle"],
      ["deckBottom", "Put under deck"],
      ["deckTop", "Put on top"],
      ["discard", "Discard"],
      ["evolve", "Evolve"],
      // 🆕🆕🆕 D580 — Look-Alike Show's `use` (its only producer parks `min: 0`; the cell is filled anyway).
      ["use", "Use"],
    ];
    for (const [dest, verb] of cells) {
      cleanup();
      render(
        <OnlineHud
          game={gameWith({
            kind: "chooseCards",
            candidates: THREE,
            min: 1,
            max: 1,
            dest,
            note: `A mandatory ${dest} pick.`,
          })}
          waitingOn="you"
          activePlaced={false}
          onAction={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: `${verb} 0/1` }), dest).toBeTruthy();
    }
  });

  it("🛑 AND THE 'UP TO' CELLS, which had the MIRROR hole", () => {
    // The other ternary rendered *"Take"* for every member but `"deck"`, so an
    // "up to" pick into the DISCARD or onto the BENCH read *"Take none"*. Same
    // repair, same record, driven separately because it is a separate claim.
    const cells: [Prompt["dest"], string][] = [
      ["bench", "Take"],
      ["hand", "Take"],
      ["deck", "Shuffle"],
      ["deckBottom", "Put under deck"],
      ["deckTop", "Put on top"],
      ["discard", "Discard"],
      ["evolve", "Evolve"],
      // 🆕🆕🆕 D580 — Look-Alike Show's "You may use the effect of a Supporter card…" (the live cell).
      ["use", "Use"],
    ];
    for (const [dest, verb] of cells) {
      cleanup();
      render(
        <OnlineHud
          game={gameWith({
            kind: "chooseCards",
            candidates: THREE,
            min: 0,
            max: 2,
            dest,
            note: `An up-to ${dest} pick.`,
          })}
          waitingOn="you"
          activePlaced={false}
          onAction={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: `${verb} none` }), dest).toBeTruthy();
    }
  });
});
