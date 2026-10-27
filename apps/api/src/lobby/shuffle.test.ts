import { describe, expect, it } from "vitest";
import { cryptoShuffle } from "./shuffle";

/** A word source that replays `words`, failing the test if it runs dry. */
function scripted(words: number[]): () => number {
  return () => {
    const word = words.shift();
    if (word === undefined) throw new Error("ran out of words");
    return word;
  };
}

describe("cryptoShuffle", () => {
  it("returns a permutation and leaves the input alone", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `card-${String(i % 15)}`);
    const before = [...ids];
    const shuffled = cryptoShuffle(ids);
    expect(ids).toEqual(before);
    expect([...shuffled].sort()).toEqual([...ids].sort());
  });

  it("swaps each position with the index its word picks, from the end", () => {
    // i=2 draws 7 % 3 = 1, i=1 draws 4 % 2 = 0.
    expect(cryptoShuffle(["a", "b", "c"], scripted([7, 4]))).toEqual(["c", "a", "b"]);
  });

  it("redraws a word from the top of the range that would favour low indices", () => {
    // For a bound of 3, words at or past 2^32 - (2^32 % 3) are refused.
    const top = 2 ** 32 - 1;
    expect(cryptoShuffle(["a", "b", "c"], scripted([top, 1, 1]))).toEqual(["a", "c", "b"]);
  });

  it("leaves short lists as they are", () => {
    expect(cryptoShuffle([], scripted([]))).toEqual([]);
    expect(cryptoShuffle(["a"], scripted([]))).toEqual(["a"]);
  });

  it("puts every card in every position, near-uniformly", () => {
    const trials = 6000;
    const counts = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    for (let t = 0; t < trials; t++) {
      cryptoShuffle([0, 1, 2, 3]).forEach((card, position) => {
        const row = counts[card];
        if (row !== undefined) row[position] = (row[position] ?? 0) + 1;
      });
    }
    // Each cell expects 1500; a fair shuffle stays well within ±200 (over 6 standard deviations).
    for (const row of counts)
      for (const n of row) expect(Math.abs(n - trials / 4)).toBeLessThan(200);
  });
});
