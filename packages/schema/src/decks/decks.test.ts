import { describe, expect, it } from "vitest";
import {
  createDeckRequestSchema,
  createFolderRequestSchema,
  deckSchema,
  deckSummarySchema,
  folderSchema,
  MAX_DECK_CARD_ENTRIES,
  MAX_REORDER_POSITIONS,
  patchDeckRequestSchema,
  patchFolderRequestSchema,
  reorderRequestSchema,
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

describe("folderSchema", () => {
  it("parses root and nested folders", () => {
    const root = { id: "f1", name: "Standard", parentId: null, position: 0 };
    expect(folderSchema.parse(root).parentId).toBeNull();
    expect(
      folderSchema.parse({ id: "f2", name: "Rogue", parentId: "f1", position: -1 }).parentId,
    ).toBe("f1");
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

describe("reorderRequestSchema", () => {
  const entry = (id: string, position = 0) => ({ id, position });

  it("parses absolute assignments, negatives included", () => {
    const parsed = reorderRequestSchema.parse({
      positions: [entry("d1", -4), entry("d2", 0), entry("d3", 7)],
    });
    expect(parsed.positions).toHaveLength(3);
  });

  it("rejects duplicate ids, naming the offenders", () => {
    const result = reorderRequestSchema.safeParse({
      positions: [entry("d1"), entry("d2"), entry("d1", 5)],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("d1"))).toBe(true);
  });

  it.each([
    ["an empty list", { positions: [] }],
    ["a fractional position", { positions: [{ id: "d1", position: 0.5 }] }],
    ["a blank id", { positions: [{ id: "", position: 0 }] }],
    [
      `more than ${MAX_REORDER_POSITIONS} rows`,
      { positions: Array.from({ length: MAX_REORDER_POSITIONS + 1 }, (_, i) => entry(`d${i}`)) },
    ],
  ])("rejects %s", (_label, body) => {
    expect(reorderRequestSchema.safeParse(body).success).toBe(false);
  });
});
