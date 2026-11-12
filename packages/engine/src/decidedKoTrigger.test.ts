import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameState } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  clearBench,
  deckOf,
  driveSetup,
  findEvent,
  must,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  types,
} from "./testFixtures";

const GLIMMORA = "sv02-126";
const AMULET = "sv08-162";

const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [AMULET]: {
    ...trainerCard(
      AMULET,
      "Tool",
      "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
    ),
    name: "Amulet of Hope",
  },
};
const DECK = deckOf({ "fix-attacker": 8, [GLIMMORA]: 4, [AMULET]: 4, "fix-energy": 44 });

/** P1's turn 2: Bite (30) against p2's lone Glimmora (30 HP) holding Amulet of Hope. */
function board(seed: number): GameState {
  let state = driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", GLIMMORA);
  state = clearBench(state, "p2");
  return attachToolFromDeck(state, "p2", "active", AMULET);
}

describe("a game already won ends before an on-KO program runs (§14, COR-P1)", () => {
  it("Shattering Crystal denies the Prize, so no Prize stage comes first, and the game still ends before Amulet of Hope's search parks", () => {
    let checked = 0;
    for (let seed = 0; seed < 40 && checked < 2; seed++) {
      const { state, events } = mustApply(board(seed), { type: "attack", seat: "p1", index: 0 });
      expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
      const flip = findEvent(events, "ABILITY_COIN_FLIP");
      if (flip?.result !== "heads") continue;
      checked++;
      expect(findEvent(events, "PRIZE_PREVENTED")).toBeDefined();
      expect(state.phase).toMatchObject({
        kind: "gameOver",
        outcome: { result: "win", winner: "p1", reason: "noPokemon" },
      });
      expect(types(events)).not.toContain("EFFECT_PENDING");
      expect(state.pending).toEqual([]);
    }
    expect(checked).toBe(2);
  });
});
