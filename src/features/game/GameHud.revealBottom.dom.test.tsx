// @vitest-environment jsdom
// M5 op-slice: the reveal-and-bottom family (Ortega / Greavard) and the HUD's
// first prompt shown to the seat that did NOT make the play.
//
// Three surfaces, and the middle one is new to this app: the controller's pick
// over the OPPONENT's revealed hand (a plain chooseCards, so the existing
// dialog serves it), the `mayDraw` yes/no that parks on the OTHER seat, and the
// Trainer row's greying for a card whose target zone is empty. The seat flip is
// the point — `projection.waitingOn` already routes a KO promotion to the
// non-turn player, and this rides the same rail with the turn still running.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState, Seat } from "@luminous/engine";
import {
  REVEAL_BOTTOM_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;
const both = { p1: REVEAL_BOTTOM_DECK, p2: REVEAL_BOTTOM_DECK };

const ORTEGA = "sv03-190";
const GREAVARD = "sv01-105";
const MIRIAM = "sv01-179";

/** Setup, then open P1's turn 2 (P2 first → ending their turn 1 unblocks P1's
    unrestricted first turn, so Supporters play). */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(seed, both, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Rebuild `seat`'s hand exactly — the opponent's hand is what these prompts
    read, so a dealt hand would make every assertion seed-dependent. */
function withHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
  for (const id of ids) next = handFromDeck(next, seat, id, 1);
  return next;
}

function view(state: GameState, viewerSeat: Seat, dispatch: (action: GameAction) => void) {
  return (
    <GameHud
      game={state}
      projection={projectGameState(state, viewerSeat)}
      viewerSeat={viewerSeat}
      names={NAMES}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />
  );
}

function renderHud(state: GameState, viewerSeat: Seat, dispatch: (action: GameAction) => void) {
  render(view(state, viewerSeat, dispatch));
}

/** P1 holds an Ortega, P2's hand is `oppIds`. */
function ortegaBoard(oppIds: readonly string[]): GameState {
  const state = withHand(p1Turn2(20260722), "p1", [ORTEGA]);
  return withHand(state, "p2", oppIds);
}

/** Play Ortega and answer the pick — the state parked on the opponent's may. */
function parkedMayDraw(): GameState {
  const state = ortegaBoard(["fix-item", GREAVARD]);
  const { state: parked } = mustApply(state, {
    type: "playTrainer",
    seat: "p1",
    uid: handUid(state, "p1", ORTEGA),
  });
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [handUid(parked, "p2", GREAVARD)] },
  }).state;
}

describe("Ortega — the pick over the OPPONENT's revealed hand", () => {
  it("renders the opponent's hand cards by name and dispatches the chosen uid", () => {
    const state = ortegaBoard(["fix-item", GREAVARD, "fix-grass-energy"]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    const dispatch = vi.fn();
    renderHud(parked, "p1", dispatch);
    // The revealed cards are NAMED — the whole point of a reveal, and the
    // projection's face-down opponent hand does not reach this dialog (it reads
    // the game state the prompt's uids belong to).
    screen.getByRole("button", { name: /Greavard/ });
    screen.getByRole("button", { name: "fix-item" });
    // Mandatory and exact: there is no decline.
    expect(screen.queryByRole("button", { name: "Take none" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Greavard/ }));
    fireEvent.click(screen.getByRole("button", { name: /Put under deck/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [handUid(parked, "p2", GREAVARD)] },
    });
  });

  it("keeps the pick dialog off the OPPONENT's screen — it is the controller's decision", () => {
    const state = ortegaBoard(["fix-item", GREAVARD]);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    renderHud(parked, "p2", () => {});
    // P2's hand is on the table, but the choosing is P1's — and a dialog that
    // mounted here would show P2 a prompt they cannot answer (WRONG_SEAT).
    expect(screen.queryByRole("button", { name: /Greavard/ })).toBeNull();
  });
});

describe("MayDrawDialog — the printed 'may' answered by the other seat", () => {
  it("mounts on the OPPONENT's screen while the controller's turn is still running", () => {
    const asked = parkedMayDraw();
    const projected = projectGameState(asked, "p2");
    // The seat flip the dialog rides: the opponent is waited on, and the turn
    // still belongs to the controller (the board's glow must not move).
    expect(projected.waitingOn).toBe("you");
    expect(projected.activePlayer).toBe("opponent");
    renderHud(asked, "p2", () => {});
    screen.getByText("You may draw a card.");
  });

  it("dispatches draw:true on Draw and draw:false on Decline", () => {
    const asked = parkedMayDraw();
    const dispatch = vi.fn();
    renderHud(asked, "p2", dispatch);
    fireEvent.click(screen.getByRole("button", { name: "Draw a card" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "mayDraw", draw: true },
    });
    cleanup();
    const declineDispatch = vi.fn();
    renderHud(asked, "p2", declineDispatch);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(declineDispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "mayDraw", draw: false },
    });
  });

  it("stays off the CONTROLLER's screen — they cannot consent for their opponent", () => {
    const asked = parkedMayDraw();
    expect(projectGameState(asked, "p1").waitingOn).toBe("opponent");
    renderHud(asked, "p1", () => {});
    expect(screen.queryByRole("button", { name: "Draw a card" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("both answers drive the real engine back to the controller's turn", () => {
    // The dispatch spy proves the action's shape; this proves the engine takes
    // it — the full path the two tests above only meet at their ends.
    const asked = parkedMayDraw();
    for (const draw of [true, false]) {
      const { state: done } = mustApply(asked, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "mayDraw", draw },
      });
      expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
      expect(projectGameState(done, "p1").waitingOn).toBe("you");
    }
  });

  it("the count rides promptKey — a differing offer remounts the dialog", () => {
    // The belt technique (the attachCards/heal precedent). This dialog holds no
    // state to go stale, so the assertion is on the RENDER: a key that ignored
    // `count` would leave the first park's button label mounted over the second
    // park's offer.
    const first = parkedMayDraw();
    if (first.phase.kind !== "effect:choose") throw new Error("expected the mayDraw park");
    const prompt = first.phase.prompt;
    if (prompt.kind !== "mayDraw") throw new Error("expected a mayDraw prompt");
    const second: GameState = {
      ...first,
      phase: {
        ...first.phase,
        prompt: { ...prompt, count: 2, note: "You may draw 2 cards." },
      },
    };
    const { rerender } = render(view(first, "p2", () => {}));
    screen.getByRole("button", { name: "Draw a card" });
    rerender(view(second, "p2", () => {}));
    screen.getByRole("button", { name: "Draw 2 cards" });
    expect(screen.queryByRole("button", { name: "Draw a card" })).toBeNull();
  });
});

describe("the Trainer row mirrors the engine's would-only-whiff gate", () => {
  it("greys Ortega out over an EMPTY opponent hand, with the reason on the row", () => {
    // The recurring review finding: without the mirror this row renders lit and
    // the click is refused with NO_LEGAL_TARGET and no reason anywhere.
    const state = ortegaBoard([]);
    renderHud(state, "p1", () => {});
    const row = screen.getByRole("button", { name: ORTEGA }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    // The reason rides the row as a tooltip AND sr-only text — a greyed button
    // that cannot say why is the half-fix this mirror exists to avoid.
    expect(screen.getByText("No legal target")).toBeTruthy();
  });

  it("lights Ortega when the opponent holds a card, and the click plays it", () => {
    const state = ortegaBoard(["fix-item"]);
    const dispatch = vi.fn();
    renderHud(state, "p1", dispatch);
    const row = screen.getByRole("button", { name: ORTEGA }) as HTMLButtonElement;
    expect(row.disabled).toBe(false);
    fireEvent.click(row);
    expect(dispatch).toHaveBeenCalledWith({
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", ORTEGA),
    });
    // Lit ⇔ the engine accepts — the row's promise, checked against the engine
    // rather than assumed.
    expect(
      mustApply(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", ORTEGA) }).state
        .phase.kind,
    ).not.toBe("turn:action");
  });
});

describe("Greavard — the derived attack twin through the HUD", () => {
  it("parks the Supporter-filtered pick on the attacker's screen mid-attack", () => {
    let state = setActiveFromDeck(p1Turn2(20260722), "p1", GREAVARD);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    state = withHand(state, "p2", [ORTEGA, MIRIAM, "fix-item"]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dispatch = vi.fn();
    renderHud(parked, "p1", dispatch);
    // Only the two Supporters are offered — the filter is the engine's, and the
    // dialog renders exactly what it was handed.
    screen.getByRole("button", { name: ORTEGA });
    screen.getByRole("button", { name: MIRIAM });
    expect(screen.queryByRole("button", { name: "fix-item" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: MIRIAM }));
    fireEvent.click(screen.getByRole("button", { name: /Put under deck/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [handUid(parked, "p2", MIRIAM)] },
    });
  });
});
