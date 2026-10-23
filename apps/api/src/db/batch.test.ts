import { describe, expect, it } from "vitest";
import { chunk, nonEmpty } from "./batch";

describe("chunk", () => {
  it("splits into consecutive chunks with a short tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("keeps an exact multiple intact", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("returns one chunk when everything fits", () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  it("returns no chunks for no items", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("rejects non-positive or fractional sizes", () => {
    expect(() => chunk([1], 0)).toThrow(/positive integer/);
    expect(() => chunk([1], 2.5)).toThrow(/positive integer/);
  });
});

describe("nonEmpty", () => {
  it("passes a non-empty list through in order", () => {
    expect(nonEmpty([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("refuses an empty list", () => {
    expect(() => nonEmpty([])).toThrow(/at least one statement/);
  });
});
