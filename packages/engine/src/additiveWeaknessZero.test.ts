import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { afterWeaknessResistance } from "./cards";
import type { GameState } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  driveSetup,
  findEvent,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const BITE = 0;
const PICK_OFF = 1;

const LOCAL_CARDS: Record<string, Card> = {
  "rul5-attacker": battler("rul5-attacker", {
    types: ["Psychic"],
    hp: 200,
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      {
        cost: ["Colorless"],
        name: "Pick Off",
        effect:
          "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  "rul5-defender": battler("rul5-defender", {
    hp: 120,
    weaknesses: [{ type: "Psychic", value: "+20" }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };
const DECK = deckOf({ "rul5-attacker": 4, "rul5-defender": 4, "fix-energy": 52 });

/** P1's turn 3: the Psychic attacker, debuffed by `debuff`, faces the +20-Weak defender. */
function board(debuff: number): GameState {
  let state = driveSetup(7, { p1: DECK, p2: DECK }, { pool: POOL, first: "p1" });
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "rul5-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", "rul5-defender");
  state = clearBench(state, "p2");
  const active = state.players.p1.active;
  if (active === null) throw new Error("no attacker");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...state.players.p1,
        active: { ...active, attackDamageDebuff: { turn: state.turn, amount: debuff } },
      },
    },
  };
}

describe("additive Weakness on a hit that is 0 before Weakness (§8.5, COR-P1)", () => {
  it("the main hit: Bite 30 under a 30 debuff into a +20 Weakness deals 0, not 20", () => {
    const row = findEvent(
      mustApply(board(30), { type: "attack", seat: "p1", index: BITE }).events,
      "DAMAGE_DEALT",
    );
    expect(row?.weakness).toEqual({ op: "add", amount: 20 });
    expect(row?.dealt).toBe(0);
  });

  it("the main hit under a partial debuff still adds the +20: 30 - 10 + 20", () => {
    const row = findEvent(
      mustApply(board(10), { type: "attack", seat: "p1", index: BITE }).events,
      "DAMAGE_DEALT",
    );
    expect(row?.dealt).toBe(40);
  });

  it("a snipe onto the Active (`snipeActive`): 30 under a 30 debuff deals 0, not 20", () => {
    const { state, events } = mustApply(board(30), { type: "attack", seat: "p1", index: PICK_OFF });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt ?? 0).toBe(0);
    expect(state.players.p2.active?.damage).toBe(0);
  });

  it("a snipe onto the Active under a partial debuff adds the +20: 30 - 10 + 20", () => {
    const { state } = mustApply(board(10), { type: "attack", seat: "p1", index: PICK_OFF });
    expect(state.players.p2.active?.damage).toBe(40);
  });

  it("afterWeaknessResistance: 0 stays 0 under +20 Weakness; any other amount takes it", () => {
    const plus = { op: "add", amount: 20 } as const;
    expect(afterWeaknessResistance(0, plus, null)).toBe(0);
    expect(afterWeaknessResistance(10, plus, null)).toBe(30);
    expect(afterWeaknessResistance(10, null, { op: "subtract", amount: 30 })).toBe(0);
  });
});
