// @vitest-environment jsdom
// D186 — the printed "You may …" as a parked yes/no (`confirm`), on the LOCAL
// surface: the dialog, the seat gate, and the wire round-trip that feeds the
// same dialog online.
//
// ⚠️ THIS FILE EXISTS BECAUSE THE ENGINE HAS NO PRODUCER FOR THE PROMPT, AND
// THAT IS THE SLICE'S SAFETY PROPERTY RATHER THAN A GAP. Landing a deriver
// anchor before both surfaces can render the park is the soft-lock (effect:choose
// swallows Escape, offers no decline, and cannot advance without an answer), so
// the mechanism and both dialogs land first and the two anchors are pinned ABSENT
// in the engine suite. The park below is therefore CONSTRUCTED, which is the
// honest shape for a surface whose producer is one slice away.
//
// The router this exercises used to be a ternary chain ending in a catch-all
// `<ChoosePokemonDialog>`; it is now an exhaustive switch with a declared return
// type, so an undialoged prompt kind is a compile error AT THE ROUTER rather
// than a type mismatch bought incidentally from a sibling's prop type.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EffectContinuation, GameAction, GameState, Seat } from "@luminous/engine";
import { redactGame } from "@luminous/engine";
import { driveSetup, mustApply } from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState, projectionFromRedacted } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;
const SENTENCE = "You may draw cards until you have 6 cards in your hand.";

/** P1's turn, parked on the printed "you may". The continuation is the real
    shape `runProgram` stores — pendingOp + the ops after it — so the dialog is
    rendered off exactly what a producer would park. */
function parked(): GameState {
  const state = mustApply(driveSetup(20260804, undefined, { first: "p1" }), {
    type: "endTurn",
    seat: "p1",
  }).state;
  const p1Turn = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  const cont: EffectContinuation = {
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-op list, not a thenable.
    pendingOp: { op: "optional", note: SENTENCE, then: [{ op: "drawUntilHandSize", size: 6 }] },
    rest: [],
    ctx: { seat: "p1" },
  };
  return {
    ...p1Turn,
    phase: { kind: "effect:choose", seat: "p1", prompt: { kind: "confirm", note: SENTENCE }, cont },
  };
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

describe("the local confirm dialog", () => {
  it("shows the printed sentence and dispatches yes:true on Yes", () => {
    const dispatch = vi.fn();
    renderHud(parked(), "p1", dispatch);
    // The note IS the printed sentence — the heading, not a rendering of the
    // wrapped ops.
    expect(screen.getByText(SENTENCE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
  });

  it("dispatches yes:FALSE on No — the decline is an answer, and it must be sent", () => {
    // The half a broken build gets wrong: a dialog whose No dispatches nothing
    // (or dispatches true) leaves the program parked forever or silently
    // applies the branch. Both are the defect this mechanism can have.
    const dispatch = vi.fn();
    renderHud(parked(), "p1", dispatch);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
  });

  it("renders BOTH answers and no third option", () => {
    renderHud(parked(), "p1", () => {});
    expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No" })).toBeTruthy();
    // No decline-by-dismissal: a parked program has no Cancel.
    expect(screen.queryByRole("button", { name: /Cancel/i })).toBeNull();
  });

  it("puts Yes FIRST in DOM order, where showModal lands focus", () => {
    // Escape is swallowed, so an unprepared Enter must not land on the arm that
    // irreversibly forfeits the printed upside.
    renderHud(parked(), "p1", () => {});
    const labels = [...document.querySelectorAll("dialog button")].map((b) => b.textContent);
    expect(labels).toEqual(["Yes", "No"]);
  });

  it("stays off the OPPONENT's screen — the printed 'you' is the controller", () => {
    // Unlike `mayDraw`, this park files no answerer, so waitingOn stays with the
    // seat that played the card and P2 sees no dialog at all.
    renderHud(parked(), "p2", () => {});
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(screen.queryByText(SENTENCE)).toBeNull();
  });
});

describe("the wire round-trip", () => {
  it("rebuilds the ANSWERER's projection identically from the redacted snapshot", () => {
    // The online client holds a `RedactedGame` and rebuilds a projection from it;
    // the local one projects the full state. For the confirm arm the redaction is
    // the identity on `note` and nothing else crosses, so the two agree exactly.
    const state = parked();
    expect(projectionFromRedacted(redactGame(state, "p1"))).toEqual(projectGameState(state, "p1"));
  });

  it("and the non-answerer's does NOT round-trip — the wire is deliberately stricter", () => {
    // Scoped to the answerer above, because this park is CONTROLLER-answered and
    // the two withholding rules differ there ON PURPOSE (redact.ts spells it
    // out): `phaseViewOf` withholds only an EXPLICIT-answerer park, so the local
    // projection keeps `pendingDecision` for both viewers and the HUD's
    // `waitingOn === "you"` gate is what stops it rendering; the wire has no such
    // gate — it physically delivers a payload to a client — so a
    // controller-answered prompt goes to the CONTROLLER ALONE. Pinned rather
    // than left as a surprise for whoever widens the round-trip sweep next.
    const state = parked();
    expect(projectGameState(state, "p2").pendingDecision).not.toBeNull();
    expect(projectionFromRedacted(redactGame(state, "p2")).pendingDecision).toBeNull();
  });

  it("carries the sentence and nothing else onto the wire", () => {
    const phase = redactGame(parked(), "p1").phase;
    if (phase.kind !== "effect:choose") throw new Error("expected the park");
    expect(phase.prompt).toEqual({ kind: "confirm", note: SENTENCE });
  });
});
