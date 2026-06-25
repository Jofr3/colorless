import { describe, expect, it } from "vitest";
import { deckBackId, PRIZE_COUNT, prizeBackId, prizeSlots } from "./piles";

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
