import { describe, expect, it } from "vitest";
import { applyReorder, insertionIndex, previewOrder, type ReorderRect, sameOrder } from "./reorder";

// A 2-column grid of 100×100 tiles with a 20px gap:
//   [0](0,0)  [1](120,0)
//   [2](0,120) [3](120,120)
const grid: ReorderRect[] = [
  { left: 0, right: 100, top: 0, bottom: 100 },
  { left: 120, right: 220, top: 0, bottom: 100 },
  { left: 0, right: 100, top: 120, bottom: 220 },
  { left: 120, right: 220, top: 120, bottom: 220 },
];

describe("insertionIndex", () => {
  it("inserts before a tile when left of its centre, in the same row", () => {
    expect(insertionIndex(grid, 10, 50)).toBe(0); // left of tile 0's centre
    expect(insertionIndex(grid, 80, 50)).toBe(1); // right of 0, left of 1's centre
  });

  it("counts down the reading order across rows", () => {
    expect(insertionIndex(grid, 200, 50)).toBe(2); // past both tiles in row 0
    expect(insertionIndex(grid, 10, 170)).toBe(2); // left of tile 2 (row 1)
    expect(insertionIndex(grid, 80, 170)).toBe(3); // right of 2, left of 3's centre
  });

  it("appends when past the last tile", () => {
    expect(insertionIndex(grid, 200, 170)).toBe(4);
    expect(insertionIndex(grid, 0, 9999)).toBe(4); // far below everything
  });

  it("treats a row above the first tile as index 0", () => {
    expect(insertionIndex(grid, 200, -50)).toBe(0);
  });

  it("handles a single column (vertical reading order)", () => {
    const column: ReorderRect[] = [
      { left: 0, right: 100, top: 0, bottom: 100 },
      { left: 0, right: 100, top: 120, bottom: 220 },
    ];
    expect(insertionIndex(column, 40, 10)).toBe(0); // left-of-centre in row 0
    expect(insertionIndex(column, 90, 10)).toBe(1); // right-of-centre → next row
    expect(insertionIndex(column, 40, 130)).toBe(1);
    expect(insertionIndex(column, 90, 130)).toBe(2);
  });

  it("returns 0 for an empty group", () => {
    expect(insertionIndex([], 5, 5)).toBe(0);
  });
});

describe("previewOrder", () => {
  it("moves the dragged id to the given slot among the others", () => {
    expect(previewOrder(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(previewOrder(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("round-trips when dropped back at its own slot", () => {
    expect(previewOrder(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
  });

  it("clamps an out-of-range index", () => {
    expect(previewOrder(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
    expect(previewOrder(["a", "b", "c"], "c", -5)).toEqual(["c", "a", "b"]);
  });
});

describe("applyReorder", () => {
  type Item = { id: string; folderId: string | null; position: number };
  const inRoot = (item: Item) => item.folderId === null;

  it("reorders only the in-view items, keeping their slots and leaving others put", () => {
    // Root items r1,r2,r3 are interleaved with a foreign item f (folderId "x").
    const all: Item[] = [
      { id: "r1", folderId: null, position: 10 },
      { id: "f", folderId: "x", position: 20 },
      { id: "r2", folderId: null, position: 30 },
      { id: "r3", folderId: null, position: 40 },
    ];
    const { items, changes } = applyReorder(all, inRoot, ["r3", "r1", "r2"]);
    // The three root slots (indices 0,2,3) now hold r3,r1,r2 in order; f untouched.
    expect(items.map((i) => i.id)).toEqual(["r3", "f", "r1", "r2"]);
    expect(items[1]).toBe(all[1]); // foreign item kept by reference
    // Each new occupant inherits its slot's position, so the array stays
    // position-sorted; the changes are exactly the moved rows.
    expect(items.map((i) => i.position)).toEqual([10, 20, 30, 40]);
    expect(changes).toEqual([
      { id: "r3", position: 10 },
      { id: "r1", position: 30 },
      { id: "r2", position: 40 },
    ]);
  });

  it("is a no-op when the order matches", () => {
    const all: Item[] = [
      { id: "r1", folderId: null, position: 0 },
      { id: "r2", folderId: null, position: 1 },
    ];
    const { items, changes } = applyReorder(all, inRoot, ["r1", "r2"]);
    expect(items.map((i) => i.id)).toEqual(["r1", "r2"]);
    expect(items[0]).toBe(all[0]); // untouched rows keep their references
    expect(changes).toEqual([]);
  });

  it("reports only the rows whose slot changed", () => {
    const all: Item[] = [
      { id: "r1", folderId: null, position: 0 },
      { id: "r2", folderId: null, position: 1 },
      { id: "r3", folderId: null, position: 2 },
    ];
    // Swap the last two; r1 stays put.
    const { changes } = applyReorder(all, inRoot, ["r1", "r3", "r2"]);
    expect(changes).toEqual([
      { id: "r3", position: 1 },
      { id: "r2", position: 2 },
    ]);
  });
});

describe("sameOrder", () => {
  it("compares sequences by position", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOrder(["a"], ["a", "b"])).toBe(false);
  });
});
