import { describe, expect, it } from "vitest";
import { bannerOfId } from "./banners";
import { cardOfUid } from "./cards";
import { savedDeckReasons } from "./deckRules";
import { programFor } from "./registry";
import { createGame } from "./setup";
import { ALL_BASIC_DECK, FIXTURE_POOL } from "./testFixtures";
import type { GameState } from "./types";

describe("lookups keyed by outside strings", () => {
  const inherited = ["toString", "constructor", "__proto__", "hasOwnProperty"];

  it("programFor ignores inherited keys", () => {
    for (const key of inherited) expect(programFor(key)).toBeUndefined();
  });

  it("bannerOfId ignores inherited keys", () => {
    for (const key of inherited) expect(bannerOfId(key)).toBeUndefined();
  });

  it("cardOfUid ignores inherited keys", () => {
    const state = { cardIdByUid: {}, cardPool: {} } as unknown as GameState;
    for (const key of inherited) expect(cardOfUid(state, key)).toBeUndefined();
  });

  it("createGame refuses an inherited key as an unknown card id", () => {
    for (const key of inherited) {
      const deck = [...ALL_BASIC_DECK.slice(0, 59), key];
      const result = createGame({
        seed: 1,
        decks: { p1: deck, p2: ALL_BASIC_DECK },
        cardPool: FIXTURE_POOL,
      });
      expect(result.ok ? "accepted" : result.error.code, key).toBe("UNKNOWN_CARD_ID");
    }
  });

  it("savedDeckReasons reads an inherited key as a card missing from the catalog", () => {
    for (const key of inherited) {
      const cards = [
        { cardId: "fix-basic-1", count: 4 },
        { cardId: key, count: 56 },
      ];
      expect(savedDeckReasons(cards, null, FIXTURE_POOL), key).toEqual([
        "The deck has a card that's no longer in the catalog.",
      ]);
    }
  });
});
