// Pure-logic suite (node env). The demo lists are static data; what a unit
// test CAN pin is the deck-legality shape createGame checks (exactly 60) and
// the expansion helper the saved-deck path shares. The ids themselves were
// verified against the live catalog when authored (see demoDecks.ts).

import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "@luminous/engine";
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

  it("keeps the demo status attacks' printed sentences derivable (M3 tripwire)", () => {
    // These sentences MIRROR the D1 catalog wording as ingested (verified
    // live 2026-07-17, see demoDecks.ts header). A re-ingest that rewords
    // any of them must update this test AND the deck rationale together —
    // a documentation tripwire that the demo conditions still derive, not
    // a live-D1 check.
    const sentences = [
      // Numel — Hot Magma
      ["sv03-031", "Your opponent's Active Pokémon is now Burned."],
      // Luvdisc — Water Pulse
      ["sv02-047", "Your opponent's Active Pokémon is now Asleep."],
      // Slowpoke — Rest
      ["sv01-042", "This Pokémon is now Asleep. Heal 30 damage from it."],
    ] as const;
    for (const [cardId, sentence] of sentences) {
      expect(deriveAttackEffect(sentence), `${cardId} effect should derive`).not.toBeNull();
    }
  });

  it("keeps the M3 status attackers in the lists (conditions reachable at /play)", () => {
    const [ember, tidal] = DEMO_DECKS;
    if (ember === undefined || tidal === undefined) throw new Error("expected two decks");
    const count = (deck: typeof ember, id: string) =>
      deck.ids.filter((cardId) => cardId === id).length;
    // Numel — Hot Magma [FC] 20: the defender is Burned.
    expect(count(ember, "sv03-031")).toBe(3);
    // Luvdisc — Water Pulse [W] 20: the defender is Asleep.
    expect(count(tidal, "sv02-047")).toBe(3);
    // Slowpoke — Rest [C]: self-Asleep + heal 30, simulated since M3.
    expect(count(tidal, "sv01-042")).toBe(4);
  });

  it("keeps a playable evolution line + its Basic in each deck (evolve reachable at /play, M4)", () => {
    const [ember, tidal] = DEMO_DECKS;
    if (ember === undefined || tidal === undefined) throw new Error("expected two decks");
    const has = (deck: typeof ember, id: string) => deck.ids.includes(id);
    // Ember: Fuecoco (Basic) → Crocalor (Stage 1) → Skeledirge (Stage 2).
    expect(has(ember, "sv01-036") && has(ember, "sv01-037") && has(ember, "sv01-038")).toBe(true);
    // Tidal: Buizel (Basic) → Floatzel (Stage 1).
    expect(has(tidal, "sv01-046") && has(tidal, "sv01-047")).toBe(true);
  });
});
