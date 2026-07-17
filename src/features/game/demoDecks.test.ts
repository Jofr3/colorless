// Pure-logic suite (node env). The demo lists are static data; what a unit
// test CAN pin is the deck-legality shape createGame checks (exactly 60) and
// the expansion helper the saved-deck path shares. The ids themselves were
// verified against the live catalog when authored (see demoDecks.ts).

import { describe, expect, it } from "vitest";
import { DEMO_DECKS, expandDeck } from "./demoDecks";

describe("expandDeck", () => {
  it("expands {cardId, count} rows into a flat id list, order preserved", () => {
    expect(
      expandDeck([
        { cardId: "a", count: 2 },
        { cardId: "b", count: 1 },
        { cardId: "a", count: 1 },
      ]),
    ).toEqual(["a", "a", "b", "a"]);
  });

  it("expands an empty deck to an empty list", () => {
    expect(expandDeck([])).toEqual([]);
  });
});

describe("DEMO_DECKS", () => {
  it("offers two differently named decks", () => {
    expect(DEMO_DECKS).toHaveLength(2);
    const names = DEMO_DECKS.map((deck) => deck.name);
    expect(new Set(names).size).toBe(2);
    for (const name of names) expect(name.length).toBeGreaterThan(0);
  });

  it("each holds exactly 60 catalog-shaped ids", () => {
    for (const deck of DEMO_DECKS) {
      expect(deck.ids).toHaveLength(60);
      for (const id of deck.ids) {
        expect(id).toMatch(/^sv[\w.]*-\d+$/);
      }
    }
  });

  it("the two decks share no card ids (distinct types by design)", () => {
    const [ember, tidal] = DEMO_DECKS;
    if (ember === undefined || tidal === undefined) throw new Error("expected two decks");
    const tidalSet = new Set(tidal.ids);
    expect(ember.ids.some((id) => tidalSet.has(id))).toBe(false);
  });
});
