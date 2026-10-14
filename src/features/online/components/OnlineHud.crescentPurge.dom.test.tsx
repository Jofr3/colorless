// @vitest-environment jsdom
// 🆕🆕🆕 D548 — CRESCENT PURGE ON THE **ONLINE** SURFACE: the `choosePrize` dialog (the
// TWELFTH wire prompt kind) and automatic collection of face-up prizes.
//
// ⚠️ THE COVERAGE PIN IS ELSEWHERE: `OnlineHud.chooseAttack.dom.test.tsx` reads
// `redactedEffectPromptSchema.options` live and renders every kind; this file asserts
// what these two decisions do. The wire payloads are the shapes `crescentPurge.test.ts` §8
// drives out of the real engine (indices only; `{index, card}` per face-up prize).

import type { RedactedGame } from "@luminous/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

beforeAll(installDomShims);
afterEach(cleanup);

const NOTE = "Choose 1 of your face-down Prize cards to turn face up.";

const EMPTY_SIDE: RedactedGame["board"]["you"] = {
  hand: [],
  active: null,
  bench: [],
  prizesRemaining: 6,
  faceUpPrizes: [],
  deckCount: 40,
  discard: [],
};

const SHOWN = {
  index: 2,
  card: {
    id: "p1#44",
    cardId: "sv01-196",
    name: "Ultra Ball",
    category: "Trainer" as const,
    trainerType: "Item",
    hasImage: false,
  },
};

function wireGame(phase: RedactedGame["phase"], you: Partial<RedactedGame["board"]["you"]> = {}): RedactedGame {
  return {
    seat: "p1",
    turn: 5,
    phase,
    board: { stadium: null, you: { ...EMPTY_SIDE, ...you }, opponent: EMPTY_SIDE },
    activePlayer: "you",
    waitingOn: "you",
    outcome: null,
  };
}

describe("🛑 OnlineHud choosePrize — the twelfth wire prompt kind", () => {
  const game = wireGame(
    { kind: "effect:choose", prompt: { kind: "choosePrize", indices: [0, 1, 3, 4, 5], note: NOTE } },
    { faceUpPrizes: [SHOWN] },
  );

  it("🛑 offers ONLY the prompt's face-down slots — the face-up slot is no tile here", () => {
    render(<OnlineHud game={game} waitingOn="you" activePlaced={false} onAction={vi.fn()} />);
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /^Prize \d$/ }).map((t) => t.getAttribute("aria-label")),
    ).toEqual(["Prize 1", "Prize 2", "Prize 4", "Prize 5", "Prize 6"]);
    expect(screen.queryByRole("button", { name: /Prize 3/ })).toBeNull();
    expect(screen.queryByText("Ultra Ball")).toBeNull();
  });

  it("🛑 a tap dispatches `{kind: \"prize\", index}` for that slot", () => {
    const onAction = vi.fn();
    render(<OnlineHud game={game} waitingOn="you" activePlaced={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Prize 4" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "prize", index: 3 },
    });
  });
});

describe("online automatic prize collection", () => {
  it("includes a face-up prize without opening a picker", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud
        game={wireGame({ kind: "ko:takePrizes", count: 2 }, { prizesRemaining: 4, faceUpPrizes: [SHOWN] })}
        waitingOn="you"
        activePlaced={false}
        onAction={onAction}
      />,
    );
    expect(screen.queryByRole("dialog", { name: "Take prizes" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Prize / })).toBeNull();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: "takePrizes", seat: "p1", prizeIndices: [2, 3],
    });
  });
});
