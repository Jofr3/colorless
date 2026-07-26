import { deckSchema, deckSummarySchema, folderSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { type DeckRow, type FolderRow, mapDeckRow, mapDeckSummaryRow, mapFolderRow } from "./map";

const deckRow: DeckRow = {
  id: "d1",
  userId: "u1",
  folderId: "f1",
  name: "Charizard ex",
  format: "standard",
  tint: 22,
  coverCardId: null,
  position: -3,
  updated: new Date("2026-07-09T12:34:56.000Z"),
};

describe("mapDeckRow", () => {
  it("serializes `updated` to ISO and never leaks user_id", () => {
    const deck = mapDeckRow(deckRow, [{ cardId: "sv01-001", count: 4 }]);
    expect(deck).toEqual({
      id: "d1",
      name: "Charizard ex",
      format: "standard",
      tint: 22,
      folderId: "f1",
      position: -3,
      updated: "2026-07-09T12:34:56.000Z",
      cards: [{ cardId: "sv01-001", count: 4 }],
      chosenCoverCardId: null,
    });
    expect(deck).not.toHaveProperty("userId");
    expect(deckSchema.parse(deck)).toEqual(deck);
  });

  it("maps a rootless, formatless deck with no cards", () => {
    const deck = mapDeckRow({ ...deckRow, folderId: null, format: null }, []);
    expect(deck.folderId).toBeNull();
    expect(deck.format).toBeNull();
    expect(deck.cards).toEqual([]);
    expect(deckSchema.parse(deck)).toEqual(deck);
  });

  it("carries the owner's cover pick — the stored choice, not the face drawn", () => {
    // The summary's `coverCardId` is what the grid draws; this is what the
    // editor's picker is set to (P5-6), and it is null for almost every deck.
    const deck = mapDeckRow({ ...deckRow, coverCardId: "sv01-001" }, []);
    expect(deck.chosenCoverCardId).toBe("sv01-001");
    expect(deckSchema.parse(deck)).toEqual(deck);
  });
});

describe("mapDeckSummaryRow", () => {
  it("carries the summed cardCount instead of the card list", () => {
    const summary = mapDeckSummaryRow(deckRow, 60, "sv01-001");
    expect(summary.cardCount).toBe(60);
    expect(summary.coverCardId).toBe("sv01-001");
    expect(summary).not.toHaveProperty("cards");
    expect(deckSummarySchema.parse(summary)).toEqual(summary);
  });
});

describe("mapFolderRow", () => {
  it("maps root and nested folders, dropping user_id", () => {
    const row: FolderRow = {
      id: "f1",
      userId: "u1",
      parentId: null,
      name: "Standard",
      position: 2,
    };
    expect(mapFolderRow(row)).toEqual({ id: "f1", name: "Standard", parentId: null, position: 2 });
    expect(mapFolderRow({ ...row, id: "f2", parentId: "f1" }).parentId).toBe("f1");
    expect(folderSchema.parse(mapFolderRow(row))).toEqual(mapFolderRow(row));
  });
});
