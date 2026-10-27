import { deckSchema, deckSummarySchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { type DeckRow, mapDeckRow, mapDeckSummaryRow } from "./map";

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
  version: 0,
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
      version: 0,
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
  it("sums cardCount and carries the card list of a complete deck", () => {
    const cards = [
      { cardId: "sv01-001", count: 4 },
      { cardId: "sv01-230", count: 56 },
    ];
    const summary = mapDeckSummaryRow(deckRow, cards, "sv01-001");
    expect(summary.cardCount).toBe(60);
    expect(summary.cards).toEqual(cards);
    expect(summary.coverCardId).toBe("sv01-001");
    expect(deckSummarySchema.parse(summary)).toEqual(summary);
  });

  it("leaves the card list off an incomplete deck, and counts an empty one as 0", () => {
    const short = mapDeckSummaryRow(deckRow, [{ cardId: "sv01-001", count: 59 }], null);
    expect(short.cardCount).toBe(59);
    expect(short).not.toHaveProperty("cards");
    const empty = mapDeckSummaryRow(deckRow, [], null);
    expect(empty.cardCount).toBe(0);
    expect(empty).not.toHaveProperty("cards");
    expect(deckSummarySchema.parse(empty)).toEqual(empty);
  });
});
