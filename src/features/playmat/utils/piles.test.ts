import { describe, expect, it } from "vitest";
import type { CardModel, FaceUpPrize } from "../types";
import {
  deckBackId,
  PRIZE_COUNT,
  prizeBackId,
  prizeSlotFaces,
  prizeSlots,
  type PrizeSlotFace,
} from "./piles";

const takenCount = (slots: boolean[]) => slots.filter(Boolean).length;

describe("prizeSlots", () => {
  it("marks all six slots taken when no prizes remain", () => {
    expect(prizeSlots(0, false)).toEqual([false, false, false, false, false, false]);
    expect(prizeSlots(0, true)).toEqual([false, false, false, false, false, false]);
  });

  it("marks all six slots present when all prizes remain", () => {
    expect(prizeSlots(PRIZE_COUNT, false)).toEqual([true, true, true, true, true, true]);
    expect(prizeSlots(PRIZE_COUNT, true)).toEqual([true, true, true, true, true, true]);
  });

  it("fills from opposite edges per side but keeps the same remaining count", () => {
    const bottom = prizeSlots(2, false);
    const top = prizeSlots(2, true);

    expect(bottom).toEqual([true, true, false, false, false, false]);
    expect(top).toEqual([false, false, false, false, true, true]);
    expect(takenCount(bottom)).toBe(2);
    expect(takenCount(top)).toBe(2);
  });

  it("clamps out-of-range remaining values", () => {
    // More than the max → treated as full; negative → treated as empty.
    expect(prizeSlots(7, false)).toEqual([true, true, true, true, true, true]);
    expect(prizeSlots(-1, false)).toEqual([false, false, false, false, false, false]);
  });
});

// 🆕🆕🆕 D551 — THE FACE-UP PRIZE SLOT. `prizeSlotFaces` is the SINGLE mapping from an engine
// prize-row index (the live row, which compacts on every take) to a grid slot; `prizeSlots`
// is its presence projection and PrizeGrid + the Pixi descriptors both read it, so no
// second mapping exists anywhere to drift. Bottom side: row index i -> slot i. Top side
// (flipped): row index i -> slot taken + i, the same opposite-edge fill prizeSlots draws.
describe("🛑 prizeSlotFaces — the one row-index -> grid-slot mapping (D551)", () => {
  const cresselia: CardModel = {
    id: "p1#9",
    name: "Cresselia",
    cardId: "sv06.5-021",
    type: "pokemon",
  };
  const up = (index: number, card: CardModel = cresselia): FaceUpPrize => ({ index, card });
  const face = (card: CardModel = cresselia): PrizeSlotFace => ({ card });

  it("🛑 with every prize present the flip is invisible — top slot taken+i IS slot i at taken 0", () => {
    expect(prizeSlotFaces(6, [up(2)], false)).toEqual([
      "back",
      "back",
      face(),
      "back",
      "back",
      "back",
    ]);
    expect(prizeSlotFaces(6, [up(2)], true)).toEqual([
      "back",
      "back",
      face(),
      "back",
      "back",
      "back",
    ]);
  });

  it("🛑 remaining 5, face-up row index 2: bottom paints slot 2, top paints slot 3", () => {
    expect(prizeSlotFaces(5, [up(2)], false)).toEqual([
      "back",
      "back",
      face(),
      "back",
      "back",
      null,
    ]);
    expect(prizeSlotFaces(5, [up(2)], true)).toEqual([
      null,
      "back",
      "back",
      face(),
      "back",
      "back",
    ]);
  });

  it("🛑 remaining 2 (four taken): row index 1 is bottom slot 1 and top slot 5", () => {
    expect(prizeSlotFaces(2, [up(1)], false)).toEqual(["back", face(), null, null, null, null]);
    expect(prizeSlotFaces(2, [up(1)], true)).toEqual([null, null, null, null, "back", face()]);
  });

  it("🛑 a face-down take BELOW the face-up card compacts the row: its index drops by 1, and so does its slot", () => {
    // Before: six present, the card at row index 3. A face-down prize at row index 0 is
    // taken; the engine's row compacts, so the SAME card is now at row index 2.
    expect(prizeSlotFaces(6, [up(3)], false)).toEqual([
      "back",
      "back",
      "back",
      face(),
      "back",
      "back",
    ]);
    expect(prizeSlotFaces(5, [up(2)], false)).toEqual([
      "back",
      "back",
      face(),
      "back",
      "back",
      null,
    ]);
    // Seen from across the table the card does not move: slot taken+i = 1+2 = 3 = 0+3.
    expect(prizeSlotFaces(6, [up(3)], true)[3]).toEqual(face());
    expect(prizeSlotFaces(5, [up(2)], true)[3]).toEqual(face());
  });

  it("🛑 clamps: more than six remaining reads as six, fewer than zero as none", () => {
    expect(prizeSlotFaces(7, [up(0)], false)).toEqual([
      face(),
      "back",
      "back",
      "back",
      "back",
      "back",
    ]);
    expect(prizeSlotFaces(7, [up(0)], true)).toEqual([
      face(),
      "back",
      "back",
      "back",
      "back",
      "back",
    ]);
    expect(prizeSlotFaces(-1, [], false)).toEqual([null, null, null, null, null, null]);
    expect(prizeSlotFaces(-1, [], true)).toEqual([null, null, null, null, null, null]);
    expect(prizeSlotFaces(-1, [up(0)], true)).toEqual([null, null, null, null, null, null]);
  });

  it("🛑 an all-face-up row paints every present slot, each with its own card, on both sides", () => {
    const cards = [0, 1, 2].map(
      (n): CardModel => ({ id: `p1#${n}`, name: `c${n}`, cardId: `c${n}`, type: "pokemon" }),
    );
    const row = cards.map((card, index) => up(index, card));
    expect(prizeSlotFaces(3, row, false)).toEqual([
      face(cards[0]),
      face(cards[1]),
      face(cards[2]),
      null,
      null,
      null,
    ]);
    expect(prizeSlotFaces(3, row, true)).toEqual([
      null,
      null,
      null,
      face(cards[0]),
      face(cards[1]),
      face(cards[2]),
    ]);
  });

  it("🛑 is total: a row index outside the live row paints nothing (never an absent slot)", () => {
    expect(prizeSlotFaces(2, [up(2), up(-1)], false)).toEqual([
      "back",
      "back",
      null,
      null,
      null,
      null,
    ]);
    expect(prizeSlotFaces(2, [up(2)], true)).toEqual([null, null, null, null, "back", "back"]);
  });

  it("🛑 prizeSlots IS its presence projection, for every remaining count and both sides", () => {
    for (let remaining = -1; remaining <= PRIZE_COUNT + 1; remaining += 1) {
      for (const flipped of [false, true]) {
        expect(prizeSlots(remaining, flipped)).toEqual(
          prizeSlotFaces(remaining, [], flipped).map((slot) => slot !== null),
        );
      }
    }
  });

  it('🛑 a slot with no face-up card is exactly "back" — the face-up list, empty, changes nothing', () => {
    expect(prizeSlotFaces(4, [], false)).toEqual(["back", "back", "back", "back", null, null]);
    expect(prizeSlotFaces(4, [], true)).toEqual([null, null, "back", "back", "back", "back"]);
  });
});

describe("back id formats (parsed by the Pixi layer)", () => {
  it("builds deck back ids", () => {
    expect(deckBackId("you")).toBe("back-deck-you");
    expect(deckBackId("opponent")).toBe("back-deck-opponent");
  });

  it("builds prize back ids", () => {
    expect(prizeBackId("opponent", 3)).toBe("back-prize-opponent-3");
    expect(prizeBackId("you", 0)).toBe("back-prize-you-0");
  });
});
