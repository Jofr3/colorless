import { describe, expect, it } from "vitest";
import {
  createDeckRequestSchema,
  createFolderRequestSchema,
  deckSchema,
  deckSummarySchema,
  folderSchema,
  MAX_DECK_CARD_ENTRIES,
  patchDeckRequestSchema,
  patchFolderRequestSchema,
} from "./index";

const card = (cardId: string, count = 1) => ({ cardId, count });

describe("deckSchema / deckSummarySchema", () => {
  const base = {
    id: "d1",
    name: "Charizard ex",
    format: null,
    tint: 22,
    folderId: null,
    updated: "2026-07-09T00:00:00.000Z",
  };

  it("parses a full deck with cards", () => {
    const parsed = deckSchema.parse({ ...base, cards: [card("sv01-001", 4)] });
    expect(parsed.cards).toEqual([{ cardId: "sv01-001", count: 4 }]);
  });

  it("parses a summary with cardCount instead of cards", () => {
    const parsed = deckSummarySchema.parse({ ...base, cardCount: 60 });
    expect(parsed.cardCount).toBe(60);
    expect(parsed).not.toHaveProperty("cards");
  });

  it.each([
    ["tint above the hue wheel", { ...base, tint: 361, cards: [] }],
    ["fractional tint", { ...base, tint: 22.5, cards: [] }],
    ["count 0", { ...base, cards: [card("sv01-001", 0)] }],
    ["count 100", { ...base, cards: [card("sv01-001", 100)] }],
    ["non-ISO updated", { ...base, updated: "yesterday", cards: [] }],
  ])("rejects %s", (_label, value) => {
    expect(deckSchema.safeParse(value).success).toBe(false);
  });
});

describe("folderSchema", () => {
  it("parses root and nested folders", () => {
    expect(folderSchema.parse({ id: "f1", name: "Standard", parentId: null }).parentId).toBeNull();
    expect(folderSchema.parse({ id: "f2", name: "Rogue", parentId: "f1" }).parentId).toBe("f1");
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

  it("accepts a lone explicit null (clear folder / format)", () => {
    expect(patchDeckRequestSchema.parse({ folderId: null }).folderId).toBeNull();
    expect(patchDeckRequestSchema.parse({ format: null }).format).toBeNull();
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

describe("folder request schemas", () => {
  it("create accepts an optional parentId", () => {
    expect(createFolderRequestSchema.parse({ name: "Standard" }).parentId).toBeUndefined();
    expect(createFolderRequestSchema.parse({ name: "Rogue", parentId: "f1" }).parentId).toBe("f1");
  });

  it("patch rejects an empty body but accepts a lone move-to-root", () => {
    expect(patchFolderRequestSchema.safeParse({}).success).toBe(false);
    expect(patchFolderRequestSchema.parse({ parentId: null }).parentId).toBeNull();
  });
});
