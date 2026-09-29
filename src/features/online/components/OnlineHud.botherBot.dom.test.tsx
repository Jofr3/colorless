// @vitest-environment jsdom
// 🆕🆕🆕 D567 — TEAM ROCKET'S BOTHER-BOT ON THE **ONLINE** SURFACE: the `choosePrize` dialog over the
// OPPONENT's row. The wire prompt is `{indices, note}` (no shape moved — D548's twelfth kind), so this
// rung pins that the opponent-side note renders as sent, the offered tiles are exactly the prompt's
// indices, and a tap dispatches `{kind: "prize", index}` for that slot. The payload is the shape
// `trainerBundleD567.test.ts` §4 drives out of the real engine.

import type { RedactedGame } from "@luminous/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

beforeAll(installDomShims);
afterEach(cleanup);

const NOTE = "Choose 1 of your opponent's face-down Prize cards to turn face up.";

const EMPTY_SIDE: RedactedGame["board"]["you"] = {
  hand: [],
  active: null,
  bench: [],
  prizesRemaining: 6,
  faceUpPrizes: [],
  deckCount: 40,
  discard: [],
};

/** A Crescent Purge prize already face up on the OPPONENT's slot 1 — so that slot is not offered. */
const SHOWN = {
  index: 0,
  card: {
    id: "p2#44",
    cardId: "sv01-196",
    name: "Ultra Ball",
    category: "Trainer" as const,
    trainerType: "Item",
    hasImage: false,
  },
};

function wireGame(phase: RedactedGame["phase"]): RedactedGame {
  return {
    seat: "p1",
    turn: 4,
    phase,
    board: { stadium: null, you: EMPTY_SIDE, opponent: { ...EMPTY_SIDE, faceUpPrizes: [SHOWN] } },
    activePlayer: "you",
    waitingOn: "you",
    outcome: null,
  };
}

describe("🛑 OnlineHud choosePrize — the opponent-side note (Bother-Bot)", () => {
  it("🛑 renders the opponent wording, offers only the prompt's indices, and a tap dispatches that slot", () => {
    const onAction = vi.fn();
    const game = wireGame({ kind: "effect:choose", prompt: { kind: "choosePrize", indices: [1, 2, 3, 4, 5], note: NOTE } });
    render(<OnlineHud game={game} waitingOn="you" activePlaced={false} onAction={onAction} />);
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /^Prize \d$/ }).map((t) => t.getAttribute("aria-label")),
    ).toEqual(["Prize 2", "Prize 3", "Prize 4", "Prize 5", "Prize 6"]);
    fireEvent.click(screen.getByRole("button", { name: "Prize 5" }));
    expect(onAction).toHaveBeenCalledWith({ type: "resolveEffect", seat: "p1", choice: { kind: "prize", index: 4 } });
  });
});
