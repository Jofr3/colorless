import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { CoinFace, GameState } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  driveSetup,
  findEvents,
  mustApply,
  seedForFlips,
  setActiveFromDeck,
  setConditions,
  typedEnergy,
} from "./testFixtures";

const PINSIR = "sv06-003";
const SNORLAX = "30th-119";
const GRASS = "cor-p1-grass";

const LOCAL_CARDS: Record<string, Card> = {
  [PINSIR]: battler(PINSIR, {
    name: "Pinsir",
    hp: 110,
    types: ["Grass"],
    retreat: 2,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Grass", "Colorless"],
        name: "Slow Crunch",
        effect:
          "Discard all Energy from this Pokémon. At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out.",
      },
      { cost: ["Grass", "Colorless", "Colorless"], name: "Superpowered Horns", damage: 100 },
    ],
  }),
  [SNORLAX]: battler(SNORLAX, {
    name: "Snorlax",
    hp: 160,
    types: ["Colorless"],
    retreat: 4,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Good Sleep",
        effect:
          "If this Pokémon remains Asleep during Pokémon Checkup, heal all damage from this Pokémon.",
      },
    ],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Collapse",
        damage: 130,
        effect: "This Pokémon is now Asleep.",
      },
    ],
  }),
  [GRASS]: typedEnergy(GRASS, "Grass"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };
const DECK = deckOf({ [PINSIR]: 4, [SNORLAX]: 4, [GRASS]: 52 });

/** P2's turn 4, Snorlax Asleep in the Active Spot with 30 damage, after Pinsir's Slow Crunch. */
function crunched(): GameState {
  let state = driveSetup(3, { p1: DECK, p2: DECK }, { pool: POOL, first: "p1" });
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", PINSIR);
  state = attachFromDeck(state, "p1", GRASS, 2);
  state = setActiveFromDeck(state, "p2", SNORLAX);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", SNORLAX);
  const active = state.players.p2.active;
  if (active === null) throw new Error("no Snorlax");
  state = {
    ...state,
    players: { ...state.players, p2: { ...state.players.p2, active: { ...active, damage: 30 } } },
  };
  state = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
  expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  return setConditions(state, "p2", { rotation: "asleep" });
}

function endWithFlip(face: CoinFace) {
  const state = crunched();
  return mustApply({ ...state, rngState: seedForFlips([face]) }, { type: "endTurn", seat: "p2" });
}

describe("a scheduled Knock Out is not damage, so a Checkup heal cannot cancel it (§8.1, COR-P1)", () => {
  it("Snorlax stays Asleep, Good Sleep heals all damage, and Slow Crunch still Knocks it Out", () => {
    const { state, events } = endWithFlip("tails");
    expect(findEvents(events, "ABILITY_TRIGGERED").map((e) => e.ability)).toContain("Good Sleep");
    expect(findEvents(events, "HEALED")).toHaveLength(1);
    expect(findEvents(events, "KNOCKED_OUT").map((e) => e.seat)).toEqual(["p2"]);
    expect(state.players.p2.discard.some((uid) => state.cardIdByUid[uid] === SNORLAX)).toBe(true);
  });

  it("Snorlax wakes up, nothing heals, and Slow Crunch Knocks it Out", () => {
    const { events } = endWithFlip("heads");
    expect(findEvents(events, "HEALED")).toEqual([]);
    expect(findEvents(events, "KNOCKED_OUT").map((e) => e.seat)).toEqual(["p2"]);
  });
});
