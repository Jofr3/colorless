import { describe, expect, it } from "vitest";
import type { BoardState, PlayerBoard } from "../types";
import {
  pendingMulliganDrawCounts,
  prizeTakesBetween,
  setupDealsBetween,
  turnDrawsBetween,
  type SetupDealSnapshot,
} from "./setupDeals";

function side(handSize: number, prizesRemaining = 0): PlayerBoard {
  return {
    hand: Array.from({ length: handSize }, (_, index) => ({
      id: `card-${index}`,
      name: "Card",
      cardId: "card",
      type: "pokemon" as const,
    })),
    prizesRemaining,
    faceUpPrizes: [],
    active: null,
    bench: [],
  };
}

function snapshot(
  you: PlayerBoard,
  opponent: PlayerBoard,
  options: Partial<Omit<SetupDealSnapshot, "board">> = {},
): SetupDealSnapshot {
  const board: BoardState = { you, opponent, stadium: null };
  return { board, blueBackPlayer: "you", turn: 0, activePlayer: "you", ...options };
}

describe("setup deal animations", () => {
  it("deals six Prize backs from the correct physical deck during a hot-seat swap", () => {
    const before = snapshot(side(5), side(7));
    const next = snapshot(side(7), side(5, 6), { blueBackPlayer: "opponent", activePlayer: "you" });
    expect(setupDealsBetween(before, next)).toEqual(
      Array.from({ length: 6 }, (_, index) => ({
        tone: "blue",
        kind: "prizes",
        index,
      })),
    );
  });

  it("draws only the bonus cards after a swap, leaving the existing opening hand alone", () => {
    const before = snapshot(side(6, 6), side(5, 6));
    const next = snapshot(side(7, 6), side(6, 6), { blueBackPlayer: "opponent" });
    expect(setupDealsBetween(before, next)).toEqual([
      { tone: "red", kind: "draw", index: 5 },
      { tone: "red", kind: "draw", index: 6 },
    ]);
  });

  it("orders Prize flights before bonus draws when an online snapshot contains both", () => {
    const before = snapshot(side(6, 6), side(6));
    const next = snapshot(side(8, 6), side(6, 6));
    const deals = setupDealsBetween(before, next);
    expect(deals.slice(0, 6)).toEqual(
      Array.from({ length: 6 }, (_, index) => ({ tone: "red", kind: "prizes", index })),
    );
    expect(deals.slice(6)).toEqual([
      { tone: "blue", kind: "draw", index: 6 },
      { tone: "blue", kind: "draw", index: 7 },
    ]);
  });

  it("keeps bonuses when setup advances to turn one, excluding the ordinary turn draw", () => {
    const before = snapshot(side(6, 6), side(6, 6));
    const next = snapshot(side(9, 6), side(7, 6), { turn: 1 });
    expect(setupDealsBetween(before, next)).toEqual([
      { tone: "blue", kind: "draw", index: 6 },
      { tone: "blue", kind: "draw", index: 7 },
      { tone: "red", kind: "draw", index: 6 },
    ]);
  });

  it("includes bonuses batched with their owner's Prize placement", () => {
    const own = side(6);
    own.active = { id: "active", cardId: "active", name: "Basic", type: "pokemon" };
    const before = snapshot(own, side(6, 6));
    const next = snapshot({ ...own, hand: side(8).hand, prizesRemaining: 6 }, side(6, 6));
    expect(setupDealsBetween(before, next)).toEqual([
      ...Array.from({ length: 6 }, (_, index) => ({ tone: "blue", kind: "prizes", index })),
      { tone: "blue", kind: "draw", index: 6 },
      { tone: "blue", kind: "draw", index: 7 },
    ]);
  });

  it("does not replay opening hands, restored games, unchanged snapshots or ordinary turns", () => {
    const empty = snapshot(side(0), side(0));
    const opening = snapshot(side(7), side(7));
    const restored = snapshot(side(9, 6), side(6, 6));
    expect(setupDealsBetween(empty, opening)).toEqual([]);
    expect(setupDealsBetween(null, restored)).toEqual([]);
    expect(setupDealsBetween(restored, restored)).toEqual([]);
    expect(setupDealsBetween({ ...restored, turn: 1 }, { ...restored, turn: 2 })).toEqual([]);
  });
});

describe("start-of-turn draw animations", () => {
  it("draws the incoming player's new card from their physical deck after a hot-seat swap", () => {
    const previous = snapshot(side(4, 6), side(6, 6), { turn: 3 });
    const next = snapshot(side(7, 6), side(4, 6), {
      turn: 4,
      blueBackPlayer: "opponent",
    });
    expect(turnDrawsBetween(previous, next)).toEqual([
      { tone: "red", kind: "turn-draw", index: 6 },
    ]);
  });

  it("draws the opponent's card in an online match without changing perspective", () => {
    const previous = snapshot(side(4, 6), side(6, 6), { turn: 1 });
    const next = snapshot(side(4, 6), side(7, 6), { turn: 2, activePlayer: "opponent" });
    expect(turnDrawsBetween(previous, next)).toEqual([
      { tone: "red", kind: "turn-draw", index: 6 },
    ]);
  });

  it("queues the first turn draw after the mulligan bonuses without duplicating them", () => {
    const previous = snapshot(side(6, 6), side(6, 6));
    const next = snapshot(side(9, 6), side(7, 6), { turn: 1 });
    expect([...setupDealsBetween(previous, next), ...turnDrawsBetween(previous, next)]).toEqual([
      { tone: "blue", kind: "draw", index: 6 },
      { tone: "blue", kind: "draw", index: 7 },
      { tone: "red", kind: "draw", index: 6 },
      { tone: "blue", kind: "turn-draw", index: 8 },
    ]);
  });

  it("finds the first turn draw when setup placement and the draw keep the same hand size", () => {
    const previous = snapshot(side(7, 6), side(6, 6));
    const hand = [
      ...previous.board.you.hand.slice(1),
      { id: "turn-card", name: "Turn card", cardId: "card", type: "pokemon" as const },
    ];
    const next = snapshot({ ...previous.board.you, hand }, side(6, 6), { turn: 1 });
    expect(turnDrawsBetween(previous, next)).toEqual([
      { tone: "blue", kind: "turn-draw", index: 6 },
    ]);
  });

  it("does not replay restored hands, mid-turn draws, rewinds, or a failed deck-out draw", () => {
    const previous = snapshot(side(6, 6), side(6, 6), { turn: 2 });
    expect(turnDrawsBetween(null, previous)).toEqual([]);
    expect(turnDrawsBetween(previous, snapshot(side(7, 6), side(6, 6), { turn: 2 }))).toEqual([]);
    expect(turnDrawsBetween(previous, { ...previous, turn: 1 })).toEqual([]);
    expect(turnDrawsBetween(previous, { ...previous, turn: 3 })).toEqual([]);
    expect(turnDrawsBetween(previous, snapshot(side(0, 6), side(6, 6), { turn: 3 }))).toEqual([]);
  });

  it("does not mistake a newly revealed hot-seat hand for a draw from an empty deck", () => {
    const previous = snapshot(side(4, 6), side(6, 6), {
      turn: 1,
      deckCounts: { you: 20, opponent: 0 },
    });
    const hand = side(6).hand.map((card) => ({ ...card, id: `revealed-${card.id}` }));
    const next = snapshot({ ...side(6, 6), hand }, side(4, 6), {
      turn: 2,
      blueBackPlayer: "opponent",
      deckCounts: { you: 0, opponent: 20 },
    });
    expect(turnDrawsBetween(previous, next)).toEqual([]);
  });
});

describe("mulligan dice during queued draws", () => {
  it("keeps both recipients' counts while Prize cards animate ahead of the bonus draws", () => {
    expect(
      pendingMulliganDrawCounts([
        { deal: { tone: "red", kind: "prizes", index: 0 }, started: true },
        { deal: { tone: "blue", kind: "draw", index: 6 }, started: false },
        { deal: { tone: "blue", kind: "draw", index: 7 }, started: false },
        { deal: { tone: "red", kind: "draw", index: 6 }, started: false },
        { deal: { tone: "blue", kind: "turn-draw", index: 8 }, started: false },
      ]),
    ).toEqual({ blue: 2, red: 1 });
  });

  it("removes a recipient's die on their first draw while preserving the other's queued die", () => {
    expect(
      pendingMulliganDrawCounts([
        { deal: { tone: "blue", kind: "draw", index: 6 }, started: true },
        { deal: { tone: "blue", kind: "draw", index: 7 }, started: false },
        { deal: { tone: "red", kind: "draw", index: 6 }, started: false },
      ]),
    ).toEqual({ blue: 0, red: 1 });
    expect(pendingMulliganDrawCounts([])).toEqual({ blue: 0, red: 0 });
  });
});

describe("Prize collection animations", () => {
  it("flies multiple awarded cards from the vacated bottom slots into their hand positions", () => {
    const before = snapshot(side(4, 6), side(5, 6), { turn: 2 });
    const next = snapshot(side(6, 4), side(5, 6), { turn: 2 });
    expect(prizeTakesBetween(before, next)).toEqual([
      { tone: "blue", kind: "prize-take", index: 4, prizeSlot: 4 },
      { tone: "blue", kind: "prize-take", index: 5, prizeSlot: 5 },
    ]);
  });

  it("tracks the physical recipient across a local viewer handoff", () => {
    const before = snapshot(side(4, 5), side(5, 6), { turn: 2 });
    const next = snapshot(side(5, 6), side(6, 3), { turn: 2, blueBackPlayer: "opponent" });
    expect(prizeTakesBetween(before, next)).toEqual([
      { tone: "blue", kind: "prize-take", index: 4, prizeSlot: 1 },
      { tone: "blue", kind: "prize-take", index: 5, prizeSlot: 2 },
    ]);
  });

  it("keeps a Prize award separate from a following turn draw for the same player", () => {
    const before = snapshot(side(4, 6), side(5, 6), { turn: 2, activePlayer: "opponent" });
    const next = snapshot(side(6, 5), side(5, 6), { turn: 3 });
    expect(prizeTakesBetween(before, next)).toEqual([
      { tone: "blue", kind: "prize-take", index: 4, prizeSlot: 5 },
    ]);
    expect(turnDrawsBetween(before, next)).toEqual([
      { tone: "blue", kind: "turn-draw", index: 5 },
    ]);
  });

  it("animates the final Prize and ignores mounts, unchanged counts and rewinds", () => {
    const before = snapshot(side(4, 1), side(5, 6), { turn: 2 });
    const next = snapshot(side(5, 0), side(5, 6), { turn: 2 });
    expect(prizeTakesBetween(before, next)).toEqual([
      { tone: "blue", kind: "prize-take", index: 4, prizeSlot: 0 },
    ]);
    expect(prizeTakesBetween(null, next)).toEqual([]);
    expect(prizeTakesBetween(next, next)).toEqual([]);
    expect(prizeTakesBetween(before, { ...next, turn: 1 })).toEqual([]);
    expect(prizeTakesBetween(next, before)).toEqual([]);
  });
});
