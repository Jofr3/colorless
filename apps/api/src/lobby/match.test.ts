import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  FIXED_MATCH_CARD_IDS,
  FIXED_MATCH_DECKS,
  SEAT_OF_SLOT,
  startMatch,
} from "./match";

// P4 — the lobby → engine handoff. `startMatch` is a pure wrapper over the P3
// engine's `createGame`, so this also proves the engine imports and runs inside the
// API/Worker package (the first cross-package integration).

/** A minimal valid Basic Pokémon — the one card the synthetic decks below are made
    of, so `createGame`'s "60 cards + at least one Basic" check passes. */
function basicCard(id: string): Card {
  return {
    id,
    setId: "test",
    localId: "1",
    name: id,
    category: "Pokemon",
    image: null,
    illustrator: null,
    rarity: null,
    regulationMark: null,
    hp: 60,
    stage: "Basic",
    evolveFrom: null,
    types: ["Colorless"],
    retreat: 1,
    abilities: null,
    attacks: null,
    weaknesses: null,
    resistances: null,
    trainerType: null,
    energyType: null,
    effect: null,
    legal: { standard: true, expanded: true },
    variants: null,
  };
}

const DECK = Array.from({ length: 60 }, () => "basic");
const POOL = { basic: basicCard("basic") };

describe("startMatch — the lobby → engine handoff", () => {
  it("maps host→p1 / guest→p2 into a game paused at the first-player choice", () => {
    const result = startMatch({ seed: 1, hostDeck: DECK, guestDeck: DECK, cardPool: POOL });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    // Both decks became 60-card p1#/p2# stacks; the engine paused at setup.
    expect(result.state.phase.kind).toBe("setup:chooseFirst");
    expect(result.state.players.p1.deck).toHaveLength(60 - result.state.players.p1.hand.length);
    // The seat mapping this module owns.
    expect(SEAT_OF_SLOT).toEqual({ host: "p1", guest: "p2" });
  });

  it("is deterministic — the same seed reproduces the same coin winner", () => {
    const a = startMatch({ seed: 7, hostDeck: DECK, guestDeck: DECK, cardPool: POOL });
    const b = startMatch({ seed: 7, hostDeck: DECK, guestDeck: DECK, cardPool: POOL });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("expected both to create");
    if (a.state.phase.kind !== "setup:chooseFirst" || b.state.phase.kind !== "setup:chooseFirst") {
      throw new Error("expected setup:chooseFirst");
    }
    expect(a.state.phase.coinWinner).toBe(b.state.phase.coinWinner);
  });

  it("surfaces the engine's rejection of an illegal deck (not 60 cards)", () => {
    const result = startMatch({ seed: 1, hostDeck: ["basic"], guestDeck: DECK, cardPool: POOL });
    expect(result.ok).toBe(false);
  });
});

describe("FIXED_MATCH_DECKS — the placeholder decks the DO hands off until real selection", () => {
  it("both seats are 60 cards drawn only from FIXED_MATCH_CARD_IDS, which are distinct", () => {
    const known = new Set(FIXED_MATCH_CARD_IDS);
    expect(known.size).toBe(FIXED_MATCH_CARD_IDS.length); // no dup in the pool list
    for (const deck of [FIXED_MATCH_DECKS.host, FIXED_MATCH_DECKS.guest]) {
      expect(deck).toHaveLength(60);
      for (const id of deck) expect(known.has(id)).toBe(true);
    }
    // Every pool id is actually referenced (no dead ids to resolve from D1).
    const used = new Set([...FIXED_MATCH_DECKS.host, ...FIXED_MATCH_DECKS.guest]);
    for (const id of FIXED_MATCH_CARD_IDS) expect(used.has(id)).toBe(true);
  });

  it("the seats differ, so redaction asymmetry (1c) is exercised on a real board", () => {
    expect(FIXED_MATCH_DECKS.host).not.toEqual(FIXED_MATCH_DECKS.guest);
  });

  it("boot a real game once their ids resolve to a pool (engine-valid: 60 + a Basic)", () => {
    // The DO builds this pool from D1; here every id maps to a Basic so the
    // engine's "60 cards, all resolvable, ≥1 Basic" check passes — proving the
    // deck sizes + pool coverage, not the runtime card types.
    const pool = Object.fromEntries(FIXED_MATCH_CARD_IDS.map((id) => [id, basicCard(id)]));
    const result = startMatch({
      seed: 3,
      hostDeck: FIXED_MATCH_DECKS.host,
      guestDeck: FIXED_MATCH_DECKS.guest,
      cardPool: pool,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.phase.kind).toBe("setup:chooseFirst");
  });
});
