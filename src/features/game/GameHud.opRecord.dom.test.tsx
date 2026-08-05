// @vitest-environment jsdom
// M5 op-slice §9.2 (op→op data flow) on the WEB side: Miriam and Superior
// Energy Retrieval both park on the EXISTING chooseCards prompt, so the claim
// under test is that the HUD needs no new code. These cases pin the parts of
// that claim that are load-bearing:
//
//   • the §7.5 hand-cost grey-out reaches SER's Trainer row (the same predicate
//     Ultra Ball's row uses — pinned per-card because the two previous slices
//     each shipped a row that had NOT been wired up);
//   • SER parks TWICE on one prompt kind, so the dialog's picked-state must not
//     survive from the cost into the retrieval (promptKey);
//   • the retrieval offer the DIALOG renders is the excluded one — the two
//     Energy just paid are absent from the rows, not merely rejected on dispatch;
//   • Miriam's whole play reads correctly in the game log, in printed order.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState, Seat } from "@luminous/engine";
import { applyAction } from "@luminous/engine";
import {
  OP_RECORD_DECK,
  discardFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { logFromEvents } from "@luminous/engine";
import type { SeatLogEntry } from "@luminous/schema";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const MIRIAM = "sv01-179";
const SER = "sv02-189";
const SEED = 20260722;
const decks = { p1: OP_RECORD_DECK, p2: OP_RECORD_DECK };

/** Setup, then open P1's turn 2 (P2 first, then passes) — Supporters play. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(seed, decks, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function withHand(state: GameState, ids: readonly string[]): GameState {
  const side = state.players.p1;
  let next: GameState = {
    ...state,
    players: { ...state.players, p1: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
  };
  for (const id of ids) next = handFromDeck(next, "p1", id, 1);
  return next;
}

function renderHud(state: GameState, dispatch: (action: GameAction) => void) {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, "p1")}
      viewerSeat="p1"
      names={NAMES}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />,
  );
}

/** Row labels inside the choose-cards dialog (the card-name buttons), in DOM
    order. The rows are the only buttons carrying `aria-pressed`; the Confirm /
    decline button at the end does not. */
function offeredRows(): string[] {
  return screen
    .getAllByRole("button")
    .filter((button) => button.hasAttribute("aria-pressed"))
    .map((button) => button.textContent ?? "");
}

function texts(entries: SeatLogEntry[]): string[] {
  return entries.map((entry) =>
    entry.kind === "turn"
      ? `— turn ${entry.turn} —`
      : entry.segments.map((segment) => segment.text).join(""),
  );
}

describe("Superior Energy Retrieval — the Trainer row's §7.5 grey-out", () => {
  it("greys the row out when the hand cannot pay 2 OTHER cards, with the printed reason", () => {
    // The row that is dead most often, and the class of bug the last two slices
    // each shipped: a new card whose cost the HUD never asks about, so the button
    // stays lit and the click comes back PLAY_CONDITION_NOT_MET.
    let state = p1Turn2(SEED);
    state = withHand(state, [SER, "fix-item"]); // one OTHER card — one short
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    const button = screen.getByRole("button", { name: SER }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(dispatch).not.toHaveBeenCalled();
    const reason = "Only if you discard 2 other cards from your hand";
    const row = button.closest("li");
    expect(row?.getAttribute("title")).toBe(reason);
    expect(row?.textContent).toContain(reason);
  });

  it("counts SER itself OUT of its own cost — two copies is still unpayable", () => {
    // hand.length === 3 with [SER, SER, other] reads "payable" to any gate that
    // counts the raw hand; the printed "other" excludes only the PLAYED copy, so
    // the second SER is a legal payer and this hand IS payable. The unpayable
    // one is [SER, SER]: two cards, but only one of them can pay.
    const base = p1Turn2(SEED);
    renderHud(withHand(base, [SER, SER]), vi.fn());
    expect((screen.getAllByRole("button", { name: SER })[0] as HTMLButtonElement).disabled).toBe(
      true,
    );
    cleanup();
    const payable = withHand(base, [SER, "fix-item", "fix-fire-energy"]);
    renderHud(payable, vi.fn());
    const enabled = screen.getByRole("button", { name: SER }) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    expect(enabled.closest("li")?.getAttribute("title")).toBeNull();
    // Calibrated against the engine, not guessed.
    const uid = handUid(payable, "p1", SER);
    expect(applyAction(payable, { type: "playTrainer", seat: "p1", uid }).ok).toBe(true);
  });
});

describe("Superior Energy Retrieval — two parks on ONE prompt kind", () => {
  /** Play SER with two Fire Energy payable out of hand and one identical Fire
      Energy already in the discard. Returns the state parked on the COST. */
  function parkedOnCost(): { state: GameState; paid: string[] } {
    let state = p1Turn2(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1);
    const uid = handUid(state, "p1", SER);
    const parked = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a cost park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const paid = prompt.candidates.filter((u) => parked.cardIdByUid[u] === "fix-fire-energy");
    return { state: parked, paid };
  }

  it("renders the cost dialog as a mandatory exact pick", () => {
    const { state, paid } = parkedOnCost();
    expect(paid).toHaveLength(2);
    renderHud(state, vi.fn());
    expect(screen.getByText("Discard 2 cards from your hand.")).toBeTruthy();
    // Mandatory: no decline, and Confirm is dead until the count is met.
    expect(screen.queryByRole("button", { name: "Take none" })).toBeNull();
    const confirm = screen.getByRole("button", { name: "Discard 0/2" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("the retrieval dialog OFFERS only what the exclusion left — the paid cards are not rows", () => {
    // The headline on the web side: a player who pays two Fire Energy must not
    // see those two cards in the offer that follows. The third, identical print
    // that was already in the pile stays — the record is uid-keyed.
    const { state, paid } = parkedOnCost();
    const resolved = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: paid },
    }).state;
    if (resolved.phase.kind !== "effect:choose") throw new Error("expected a retrieval park");
    renderHud(resolved, vi.fn());
    // The note carries the printed parenthetical, because the player just
    // WATCHED those two cards land in the public discard the offer omits them
    // from — without it the dialog contradicts the board.
    expect(
      screen.getByText(
        "Put up to 4 Basic Energy cards from your discard pile into your hand. (You can't choose a card you discarded with the effect of this card.)",
      ),
    ).toBeTruthy();
    // Exactly ONE row — the copy already in the pile. Three fix-fire-energy are
    // in the discard by now; two of them are barred.
    expect(
      resolved.players.p1.discard.filter((u) => resolved.cardIdByUid[u] === "fix-fire-energy"),
    ).toHaveLength(3);
    expect(offeredRows()).toEqual(["Fire Energy"]);
  });

  it("logs the play, then the cost, then the retrieval — the printed sentence order", () => {
    // The `dest: "hand"` arm of DISCARD_RETRIEVED's row, which had no coverage
    // at all before this suite (its `dest: "deck"` twin is pinned by the Miriam
    // case below). HAND_COST_PAID stays a COUNT — the cards came out of a hidden
    // hand, and the pile they landed in is readable on its own.
    const { state, paid } = parkedOnCost();
    const cost = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: paid },
    });
    expect(
      texts(logFromEvents(cost.events, { names: NAMES, state: cost.state, elapsed: "+00:08" })),
    ).toEqual(["discarded 2 cards from their hand to pay a cost"]);
    if (cost.state.phase.kind !== "effect:choose") throw new Error("expected a retrieval park");
    const prompt = cost.state.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const done = mustApply(cost.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: prompt.candidates },
    });
    expect(
      texts(logFromEvents(done.events, { names: NAMES, state: done.state, elapsed: "+00:09" })),
    ).toEqual(["took 1 card from their discard pile"]);
  });

  it("does NOT inherit the cost's picks into the retrieval dialog (promptKey remount)", () => {
    // Both parks are `chooseCards`. A dialog keyed only on seat+turn would keep
    // the two paid uids selected into a prompt that does not offer them, light
    // Confirm up, and have the dispatch rejected — with no decline to escape by.
    const { state, paid } = parkedOnCost();
    const dispatch = vi.fn();
    renderHud(state, dispatch);
    // Two identical Fire Energy rows; click both to complete the cost.
    const rows = screen.getAllByRole("button", { name: "Fire Energy" });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0] as HTMLElement);
    fireEvent.click(rows[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Discard 2/2" }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    cleanup();

    const resolved = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: paid },
    }).state;
    renderHud(resolved, vi.fn());
    // A fresh dialog: nothing pressed, and the declinable "Take none" is live.
    for (const row of screen.getAllByRole("button")) {
      expect(row.getAttribute("aria-pressed")).not.toBe("true");
    }
    // SER retrieves into the HAND, so the verb stays "Take" — the twin of the
    // Miriam case below, where the same dialog says "Shuffle".
    expect((screen.getByRole("button", { name: "Take none" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("Miriam — the dialog and the log", () => {
  function parkedOnRetrieval(): GameState {
    let state = p1Turn2(SEED);
    state = withHand(state, [MIRIAM, "fix-item"]);
    state = discardFromDeck(state, "p1", "fix-basic-1", 2);
    state = discardFromDeck(state, "p1", "fix-basic-2", 1);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 2);
    const uid = handUid(state, "p1", MIRIAM);
    return mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
  }

  it("offers the Pokémon in the discard (not the Energy) as a declinable 'up to 5'", () => {
    const state = parkedOnRetrieval();
    renderHud(state, vi.fn());
    // The note states what the ANSWER buys (§9.2). Without the trailing clause
    // "Take none" reads as skipping a minor shuffle rather than forfeiting three
    // cards AND the turn's only Supporter — the decision surface would describe
    // half the card.
    expect(
      screen.getByText(
        "Shuffle up to 5 Pokémon from your discard pile into your deck. If you do, draw 3 cards.",
      ),
    ).toBeTruthy();
    expect(offeredRows()).toEqual(["fix-basic-1", "fix-basic-1", "fix-basic-2"]);
    // "Shuffle none", not "Take none" — the verb follows the engine's `dest`,
    // matching the heading right above it.
    expect(
      (screen.getByRole("button", { name: "Shuffle none" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("logs the whole play in printed order: retrieve → shuffle → draw", () => {
    const state = parkedOnRetrieval();
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = state.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const taken = prompt.candidates.slice(0, 2);
    const { state: done, events } = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: taken },
    });
    expect(texts(logFromEvents(events, { names: NAMES, state: done, elapsed: "+00:09" }))).toEqual([
      "shuffled 2 cards from their discard pile into their deck",
      "shuffled their deck",
      "drew 3 cards",
    ]);
  });

  it("DECLINING logs only the deck shuffle — nothing says the draw was forfeited", () => {
    // Pins today's behaviour: the printed "if you shuffled any cards in this way,
    // draw 3 cards" produces NO row on the false arm, and the dialog that made
    // the choice never mentioned the draw either.
    const state = parkedOnRetrieval();
    const { state: done, events } = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(texts(logFromEvents(events, { names: NAMES, state: done, elapsed: "+00:09" }))).toEqual([
      "shuffled their deck",
    ]);
  });
});

describe("hidden information — what the §9.2 record does and does not cross", () => {
  it("the opponent's projection never carries the continuation's `record`", () => {
    // The record rides `phase.cont`, and the projection reads `phase.prompt`
    // only, so the op→op wire does not widen the (known, pre-existing)
    // pendingDecision leak. Asserted structurally: no key named `record`
    // anywhere in what an opponent's client would receive.
    let state = p1Turn2(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1);
    const uid = handUid(state, "p1", SER);
    const parked = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a cost park");
    const costPrompt = parked.phase.prompt;
    if (costPrompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const paid = costPrompt.candidates.filter((u) => parked.cardIdByUid[u] === "fix-fire-energy");
    const resolved = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: paid },
    }).state;
    if (resolved.phase.kind !== "effect:choose") throw new Error("expected a retrieval park");
    // The engine state DOES hold it (that is the point of the continuation)…
    expect(resolved.phase.cont.record).toEqual({ paid });
    // …and the opponent's projection does not — no `record` key, and the
    // pendingDecision it does carry (the pre-existing, un-seat-gated leak) is
    // the PROMPT alone.
    const projected = projectGameState(resolved, "p2");
    expect(JSON.stringify(projected)).not.toContain("record");
    expect(projected.pendingDecision).toEqual({
      kind: "effectChoose",
      prompt: resolved.phase.prompt,
    });
    // The paid uids DO appear — in the public discard pile, where the game put
    // them, and where they were readable before this slice existed.
    const publicDiscard = projected.piles.opponent.discard.map((card) => card.id);
    for (const barred of paid) expect(publicDiscard).toContain(barred);
  });

  it("every uid the stored record holds is already PUBLIC (it names discard-pile cards)", () => {
    // Today's only phase-persisted record is SER's, and `to: "discard"` means the
    // cards it names are sitting face up in a pile both players can read. A cost
    // paid to the DECK BOTTOM followed by a parking op would persist uids of
    // cards in a hidden zone — no printed card reaches that shape yet.
    let state = p1Turn2(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = discardFromDeck(state, "p1", "fix-fire-energy", 1);
    const uid = handUid(state, "p1", SER);
    const parked = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a cost park");
    const costPrompt = parked.phase.prompt;
    if (costPrompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const paid = costPrompt.candidates.filter((u) => parked.cardIdByUid[u] === "fix-fire-energy");
    const resolved = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: paid },
    }).state;
    if (resolved.phase.kind !== "effect:choose") throw new Error("expected a retrieval park");
    for (const recorded of resolved.phase.cont.record?.paid ?? []) {
      expect(resolved.players.p1.discard).toContain(recorded);
    }
  });
});
