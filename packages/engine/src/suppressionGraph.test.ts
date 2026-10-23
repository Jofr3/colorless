import { describe, expect, it } from "vitest";
import { resolveSuppressionGraph } from "./continuous";

// `reachedBy[i]` lists the locks that reach lock i's holder.
describe("resolveSuppressionGraph", () => {
  it("keeps every lock on when none reaches another", () => {
    expect(resolveSuppressionGraph([[], [], []])).toEqual([true, true, true]);
  });

  it("switches off a lock whose holder an unreached lock silences (one-way)", () => {
    // 0 reaches 1; nothing reaches 0.
    expect(resolveSuppressionGraph([[], [0]])).toEqual([true, false]);
  });

  it("grounds a chain: a silenced middle lock frees the lock it reached", () => {
    // 0 → 1 → 2: 0 is on, so 1 is off, so 2 is on again.
    expect(resolveSuppressionGraph([[], [0], [1]])).toEqual([true, false, true]);
  });

  it("keeps both members of a mutual pair on", () => {
    expect(resolveSuppressionGraph([[1], [0]])).toEqual([true, true]);
  });

  it("keeps a self-reaching lone lock on", () => {
    expect(resolveSuppressionGraph([[0]])).toEqual([true]);
  });

  it("switches off a lock downstream of a source cycle", () => {
    // 0 ⇄ 1 is a source cycle; both reach 2.
    expect(resolveSuppressionGraph([[1], [0], [0, 1]])).toEqual([true, true, false]);
  });

  it("silences a cycle that an outside on lock reaches", () => {
    // 0 is unreached and reaches 1; 1 ⇄ 2. 1 is off, so 2 grounds on.
    expect(resolveSuppressionGraph([[], [0, 2], [1]])).toEqual([true, false, true]);
  });

  it("decides a downstream cycle only after its source cycle", () => {
    // 0 ⇄ 1 is the source cycle; 2 ⇄ 3 is reached by 1. 2 is off, so 3 grounds on.
    expect(resolveSuppressionGraph([[1], [0], [1, 3], [2]])).toEqual([true, true, false, true]);
  });

  it("returns an empty result for an empty graph", () => {
    expect(resolveSuppressionGraph([])).toEqual([]);
  });
});
