import { describe, expect, it } from "vitest";
import { toSnapshot } from "./deckSnapshot";

// The two rules the editor's save payload carries: a card order that makes the
// saver's no-op check honest, and a cover pin that can't contradict the list
// it travels with.

const entries = (...ids: [string, number][]) => new Map(ids);

describe("toSnapshot", () => {
  it("sorts the card list so a content-identical deck serializes identically", () => {
    // addCard re-appends a removed id at the Map's end; unsorted, that alone
    // would look like an edit and fire a spurious PATCH.
    const a = toSnapshot("Deck", "standard", entries(["b", 1], ["a", 2]), null);
    const b = toSnapshot("Deck", "standard", entries(["a", 2], ["b", 1]), null);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.cards).toEqual([
      { cardId: "a", count: 2 },
      { cardId: "b", count: 1 },
    ]);
  });

  it("trims the name, so it matches the server's own trim or is omitted", () => {
    expect(toSnapshot("  Lost Box  ", "standard", entries(), null).name).toBe("Lost Box");
  });

  it("keeps a cover pin that is still in the deck (P5-6)", () => {
    expect(
      toSnapshot("Deck", "standard", entries(["sv01-001", 2]), "sv01-001").chosenCoverCardId,
    ).toBe("sv01-001");
  });

  it("drops a cover pin whose card has left the deck", () => {
    // Not cosmetic: the server 400s a patch whose cover isn't in its card list,
    // and the saver retries the same dirty snapshot — so keeping the pin here
    // would wedge every later save of this deck.
    expect(
      toSnapshot("Deck", "standard", entries(["sv01-002", 1]), "sv01-001").chosenCoverCardId,
    ).toBeNull();
    expect(toSnapshot("Deck", "standard", entries(), "sv01-001").chosenCoverCardId).toBeNull();
  });
});
