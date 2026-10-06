import { describe, expect, it } from "vitest";
import type { BoardState, PlayerBoard } from "../types";
import { setupDealsBetween, type SetupDealSnapshot } from "./setupDeals";

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
