// @vitest-environment jsdom
// D186 — the printed "You may …" (`confirm`) on the ONLINE surface. The engine
// has no producer for this prompt yet, by design: landing one before both
// surfaces can render the park is the soft-lock, so the dialogs go first and the
// two deriver anchors are pinned ABSENT in the engine suite. These drive the
// dialog off a hand-built wire snapshot, which is what every test in the sibling
// OnlineHud file does anyway — the online client only ever holds a
// `RedactedGame`.
//
// ⚠️ AND THE ROUTER THIS GOES THROUGH IS NOT COMPILE-GUARDED. `EffectChooseDialog`
// in OnlineHud.tsx has no declared return type, so an unmatched prompt kind falls
// off the end as `undefined` and renders NOTHING — its old comment claimed the
// opposite and has been corrected. `chooseAttack` is on the wire with no arm
// there today (see that comment). So the `confirm` arm is pinned HERE by a test
// rather than by the compiler.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RedactedGame } from "@luminous/schema";
import { redactedEffectPromptSchema } from "@luminous/schema";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import { OnlineHud } from "./OnlineHud";

beforeAll(installDomShims);
afterEach(cleanup);

const SENTENCE = "You may draw cards until you have 6 cards in your hand.";

function confirmGame(): RedactedGame {
  const emptySide: RedactedGame["board"]["you"] = {
    hand: [],
    active: null,
    bench: [],
    prizesRemaining: 6,
    deckCount: 53,
    discard: [],
  };
  return {
    seat: "p1",
    turn: 3,
    phase: { kind: "effect:choose", prompt: { kind: "confirm", note: SENTENCE } },
    board: { stadium: null, you: emptySide, opponent: emptySide },
    activePlayer: "you",
    waitingOn: "you",
    outcome: null,
  };
}

describe("OnlineHud — effect:choose confirm (the printed 'you may')", () => {
  it("renders the sentence and dispatches yes:true on Yes", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud game={confirmGame()} waitingOn="you" activePlaced={false} onAction={onAction} />,
    );
    expect(screen.getByText(SENTENCE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
  });

  it("dispatches yes:FALSE on No — the decline is an answer and must cross the wire", () => {
    const onAction = vi.fn();
    render(
      <OnlineHud game={confirmGame()} waitingOn="you" activePlaced={false} onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
  });

  it("puts Yes first in DOM order, where showModal lands focus", () => {
    render(
      <OnlineHud game={confirmGame()} waitingOn="you" activePlaced={false} onAction={vi.fn()} />,
    );
    const labels = [...document.querySelectorAll("dialog button")].map((b) => b.textContent);
    expect(labels).toEqual(["Yes", "No"]);
  });

  it("renders nothing for the viewer the prompt is withheld from", () => {
    // Controller-answered, so the opponent's snapshot carries a null prompt and
    // waitingOn=opponent — no dialog on a screen that cannot answer it.
    const { container } = render(
      <OnlineHud
        game={{
          ...confirmGame(),
          phase: { kind: "effect:choose", prompt: null },
          waitingOn: "opponent",
        }}
        waitingOn="opponent"
        activePlaced={false}
        onAction={vi.fn()}
      />,
    );
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("the wire arm parses — and carries the sentence ALONE", () => {
    const parsed = redactedEffectPromptSchema.parse({ kind: "confirm", note: SENTENCE });
    expect(parsed).toEqual({ kind: "confirm", note: SENTENCE });
    // No `count`: the mayDraw sibling's printed number is meaningless here, and
    // a schema that accepted one would invite a producer to write it.
    expect(redactedEffectPromptSchema.safeParse({ kind: "confirm" }).success).toBe(false);
  });
});
