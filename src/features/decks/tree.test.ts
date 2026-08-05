import { describe, expect, it } from "vitest";
import type { Deck, Folder } from "./data";
import { canDrop, folderPath, isDescendantOf } from "./tree";

// A (root) > A1 > A2 ; B (root). Decks: d1 in A, d2 at root.
const folders: Folder[] = [
  { id: "A", name: "A", parentId: null, position: 0 },
  { id: "A1", name: "A1", parentId: "A", position: 1 },
  { id: "A2", name: "A2", parentId: "A1", position: 2 },
  { id: "B", name: "B", parentId: null, position: 3 },
];
const decks: Deck[] = [
  { id: "d1", name: "d1", folderId: "A", cardCount: 1, tint: 0, coverCardId: null, position: 0 },
  { id: "d2", name: "d2", folderId: null, cardCount: 1, tint: 0, coverCardId: null, position: 1 },
];
const folder = (id: string) => ({ type: "folder" as const, id });
const deck = (id: string) => ({ type: "deck" as const, id });

describe("folderPath", () => {
  it("returns the ancestor chain root-most first", () => {
    expect(folderPath(folders, "A2").map((f) => f.id)).toEqual(["A", "A1", "A2"]);
    expect(folderPath(folders, "A").map((f) => f.id)).toEqual(["A"]);
  });

  it("terminates on a corrupt parent cycle", () => {
    const cyclic: Folder[] = [
      { id: "X", name: "X", parentId: "Y", position: 0 },
      { id: "Y", name: "Y", parentId: "X", position: 1 },
    ];
    expect(folderPath(cyclic, "X")).toHaveLength(2);
  });
});

describe("isDescendantOf", () => {
  it("detects direct and deep descendants", () => {
    expect(isDescendantOf(folders, "A1", "A")).toBe(true);
    expect(isDescendantOf(folders, "A2", "A")).toBe(true);
  });

  it("is false for unrelated or reversed relationships", () => {
    expect(isDescendantOf(folders, "B", "A")).toBe(false);
    expect(isDescendantOf(folders, "A", "A2")).toBe(false);
  });
});

describe("canDrop", () => {
  it("rejects a folder into itself or its own descendant", () => {
    expect(canDrop(folders, decks, folder("A"), "A")).toBe(false);
    expect(canDrop(folders, decks, folder("A"), "A2")).toBe(false);
  });

  it("rejects a no-op move to the current parent", () => {
    expect(canDrop(folders, decks, folder("A1"), "A")).toBe(false); // already in A
    expect(canDrop(folders, decks, folder("A"), null)).toBe(false); // already at root
  });

  it("allows a folder into an unrelated folder or out to root", () => {
    expect(canDrop(folders, decks, folder("A1"), "B")).toBe(true);
    expect(canDrop(folders, decks, folder("A1"), null)).toBe(true); // out of A → root
  });

  it("handles decks by their owning folder", () => {
    expect(canDrop(folders, decks, deck("d1"), "A")).toBe(false); // already in A
    expect(canDrop(folders, decks, deck("d1"), "B")).toBe(true);
    expect(canDrop(folders, decks, deck("d1"), null)).toBe(true);
    expect(canDrop(folders, decks, deck("d2"), null)).toBe(false); // already at root
  });
});
