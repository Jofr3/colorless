import { describe, expect, it } from "vitest";
import {
  CARD_ID_MAX,
  createDeckRequestSchema,
  deckSchema,
  deckSummarySchema,
  MAX_DECK_CARD_ENTRIES,
  patchDeckRequestSchema,
} from "./index";

const card = (cardId: string, count = 1) => ({ cardId, count });

describe("deckSchema / deckSummarySchema", () => {
  const base = {
    id: "d1",
    name: "Charizard ex",
    format: null,
    tint: 22,
    folderId: null,
    position: -2,
    updated: "2026-07-09T00:00:00.000Z",
    // Required on the full deck (P5-6) and ignored by the summary, so the
    // rejection cases below still fail for the reason they name.
    chosenCoverCardId: null,
  };

  it("parses a full deck with cards", () => {
    const parsed = deckSchema.parse({ ...base, cards: [card("sv01-001", 4)] });
    expect(parsed.cards).toEqual([{ cardId: "sv01-001", count: 4 }]);
    expect(parsed.chosenCoverCardId).toBeNull();
  });

  it("carries the owner's cover pick on the full deck, not on the list row", () => {
    // Two different questions: what the editor's picker is set to (here) versus
    // what the grid draws (the summary's `coverCardId`, resolved server-side).
    const parsed = deckSchema.parse({ ...base, cards: [], chosenCoverCardId: "sv01-001" });
    expect(parsed.chosenCoverCardId).toBe("sv01-001");
    expect(
      deckSummarySchema.parse({ ...base, cardCount: 0, coverCardId: null }),
    ).not.toHaveProperty("chosenCoverCardId");
  });

  it("parses a summary with cardCount instead of cards", () => {
    const parsed = deckSummarySchema.parse({ ...base, cardCount: 60, coverCardId: "sv01-001" });
    expect(parsed.cardCount).toBe(60);
    expect(parsed.coverCardId).toBe("sv01-001");
    expect(parsed).not.toHaveProperty("cards");
  });

  it("parses a summary carrying a complete deck's cards", () => {
    const cards = [card("sv01-001", 4), card("sv01-230", 56)];
    const parsed = deckSummarySchema.parse({ ...base, cardCount: 60, cards, coverCardId: null });
    expect(parsed.cards).toEqual(cards);
  });

  it("accepts a summary with no cover — an empty deck has no face (P5-3)", () => {
    expect(
      deckSummarySchema.parse({ ...base, cardCount: 0, coverCardId: null }).coverCardId,
    ).toBeNull();
  });

  it.each([
    ["tint above the hue wheel", { ...base, tint: 361, cards: [] }],
    ["fractional tint", { ...base, tint: 22.5, cards: [] }],
    ["count 0", { ...base, cards: [card("sv01-001", 0)] }],
    ["count 100", { ...base, cards: [card("sv01-001", 100)] }],
    ["non-ISO updated", { ...base, updated: "yesterday", cards: [] }],
    ["fractional position", { ...base, position: 1.5, cards: [] }],
    ["missing position", { ...(({ position, ...rest }) => rest)(base), cards: [] }],
  ])("rejects %s", (_label, value) => {
    expect(deckSchema.safeParse(value).success).toBe(false);
  });
});

describe("createDeckRequestSchema", () => {
  it("defaults cards to [] and trims the name", () => {
    const parsed = createDeckRequestSchema.parse({ name: "  Lost Box ", tint: 268 });
    expect(parsed.name).toBe("Lost Box");
    expect(parsed.cards).toEqual([]);
    expect(parsed.format).toBeUndefined();
  });

  it("rejects duplicate cardIds, naming the offenders", () => {
    const result = createDeckRequestSchema.safeParse({
      name: "Dup",
      tint: 1,
      cards: [card("sv01-001", 2), card("sv01-002"), card("sv01-001", 1)],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("sv01-001"))).toBe(true);
  });

  it(`rejects more than ${MAX_DECK_CARD_ENTRIES} distinct entries`, () => {
    const cards = Array.from({ length: MAX_DECK_CARD_ENTRIES + 1 }, (_, i) => card(`sv01-${i}`));
    expect(createDeckRequestSchema.safeParse({ name: "Big", tint: 0, cards }).success).toBe(false);
  });

  it("files a new deck only at the library root", () => {
    expect(createDeckRequestSchema.parse({ name: "Root", tint: 0, folderId: null }).folderId).toBe(
      null,
    );
    expect(
      createDeckRequestSchema.safeParse({ name: "Filed", tint: 0, folderId: "f1" }).success,
    ).toBe(false);
  });

  it.each([
    ["blank name", { name: "   ", tint: 0 }],
    ["missing tint", { name: "No tint" }],
    ["negative tint", { name: "Neg", tint: -1 }],
    ["blank format", { name: "Fmt", tint: 0, format: " " }],
    ["count above 99", { name: "Cap", tint: 0, cards: [card("sv01-001", 100)] }],
  ])("rejects %s", (_label, body) => {
    expect(createDeckRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("patchDeckRequestSchema", () => {
  it("rejects an empty patch", () => {
    expect(patchDeckRequestSchema.safeParse({}).success).toBe(false);
  });

  it("names an empty patch in its message, word for word", () => {
    expect(patchDeckRequestSchema.safeParse({ version: 3 }).error?.issues).toEqual([
      expect.objectContaining({
        code: "custom",
        path: [],
        message: "empty patch: provide at least one field",
      }),
    ]);
  });

  it("takes a version alongside a change, but not as the whole patch", () => {
    expect(patchDeckRequestSchema.parse({ name: "Zard", version: 3 }).version).toBe(3);
    expect(patchDeckRequestSchema.safeParse({ version: 3 }).success).toBe(false);
    expect(patchDeckRequestSchema.safeParse({ name: "Zard", version: -1 }).success).toBe(false);
  });

  it("accepts a lone explicit null (clear folder / format)", () => {
    expect(patchDeckRequestSchema.parse({ folderId: null }).folderId).toBeNull();
    expect(patchDeckRequestSchema.parse({ format: null }).format).toBeNull();
  });

  it("rejects moving a deck into a folder", () => {
    expect(patchDeckRequestSchema.safeParse({ folderId: "f1" }).success).toBe(false);
  });

  it("takes a cover pick, and a lone null to go back to automatic (P5-6)", () => {
    expect(patchDeckRequestSchema.parse({ chosenCoverCardId: "sv01-001" }).chosenCoverCardId).toBe(
      "sv01-001",
    );
    expect(patchDeckRequestSchema.parse({ chosenCoverCardId: null }).chosenCoverCardId).toBeNull();
    // An empty string is not a card id — that's a bug, not "automatic".
    expect(patchDeckRequestSchema.safeParse({ chosenCoverCardId: "" }).success).toBe(false);
  });

  it("accepts a wholesale cards replacement, including clearing to []", () => {
    expect(patchDeckRequestSchema.parse({ cards: [] }).cards).toEqual([]);
    const parsed = patchDeckRequestSchema.parse({ cards: [card("sv01-003", 3)] });
    expect(parsed.cards).toEqual([{ cardId: "sv01-003", count: 3 }]);
  });

  it("still applies the duplicate guard on patch", () => {
    const result = patchDeckRequestSchema.safeParse({
      cards: [card("sv01-001"), card("sv01-001")],
    });
    expect(result.success).toBe(false);
  });
});

describe("card ids on deck writes", () => {
  const longest = `${"a".repeat(CARD_ID_MAX - 4)}-001`;
  const createWith = (cardId: string) =>
    createDeckRequestSchema.safeParse({ name: "D", tint: 0, cards: [card(cardId)] }).success;

  it("takes catalog-shaped ids up to the cap", () => {
    for (const id of ["sv01-001", "swsh10.5-001", "me02.5-010", "swsh12tg_TG01", longest]) {
      expect(createWith(id), id).toBe(true);
      expect(patchDeckRequestSchema.safeParse({ chosenCoverCardId: id }).success, id).toBe(true);
    }
  });

  it("refuses a longer id or one with other characters, in the list and as the cover", () => {
    for (const id of [`${longest}x`, "sv01 001", "sv01-001\n", "<b>", "sv01/001", "é"]) {
      expect(createWith(id), id).toBe(false);
      expect(patchDeckRequestSchema.safeParse({ cards: [card(id)] }).success, id).toBe(false);
      expect(patchDeckRequestSchema.safeParse({ chosenCoverCardId: id }).success, id).toBe(false);
    }
  });

  it("leaves the read schemas loose, so a deck saved before the check still loads", () => {
    const odd = "x".repeat(CARD_ID_MAX + 10);
    const deck = deckSchema.parse({
      id: "d1",
      name: "Old",
      format: null,
      tint: 0,
      folderId: null,
      position: 0,
      updated: "2026-07-09T00:00:00.000Z",
      cards: [card(odd)],
      chosenCoverCardId: odd,
    });
    expect(deck.cards[0]?.cardId).toBe(odd);
  });
});
