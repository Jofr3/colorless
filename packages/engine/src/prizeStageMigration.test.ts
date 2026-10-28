import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { type GameState, type InPlayPokemon, applyAction, createGame } from "./index";
import { firstP1Turn, migrateStored, mustMigrate, storedAt } from "./testFixtures";

const BODY = "prize-body";
const BOLT_ID = "30th-040";
const JAW = "me03-068"; // Antique Jaw Fossil — kept so the earlier steps run over the same pool
const HIT = 50;
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "Prize Body",
  category: "Pokemon",
  illustrator: null,
  rarity: null,
  regulationMark: null,
  hp: 900,
  stage: "Basic",
  evolveFrom: null,
  types: ["Colorless"],
  retreat: 0,
  abilities: null,
  attacks: [{ cost: [], name: "Tap", damage: String(HIT) }],
  weaknesses: null,
  resistances: null,
  trainerType: null,
  energyType: null,
  effect: null,
  legalStandard: true,
  legalExpanded: true,
  printKey: null,
  legalStandardEffective: null,
  legalExpandedEffective: null,
  imageUrl: null,
  suffix: null,
} as unknown as Card;
const BOLT_TEXT =
  "The Defending Pokémon's Weakness is now {L} until the end of your next turn. (Apply Weakness as ×2.)";
const BOLT_CARD: Card = {
  ...BODY_CARD,
  id: BOLT_ID,
  setId: "30th",
  localId: "040",
  name: "Pikachu",
  hp: 80,
  types: ["Lightning"],
  attacks: [{ cost: [], name: "Overwriting Bolt", damage: "10", effect: BOLT_TEXT }],
} as unknown as Card;
const JAW_CARD: Card = {
  ...BODY_CARD,
  id: JAW,
  setId: "me03",
  localId: "068",
  name: "Antique Jaw Fossil",
  category: "Trainer",
  hp: 60,
  stage: null,
  types: null,
  attacks: null,
  abilities: [
    {
      type: "Ability",
      name: "Intimidating Jaw",
      effect:
        "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 30 less damage (before applying Weakness and Resistance).",
    },
  ],
  trainerType: "Item",
  effect:
    "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.",
} as unknown as Card;

const DECK = [
  ...Array.from({ length: 52 }, () => BODY),
  BOLT_ID,
  BOLT_ID,
  BOLT_ID,
  BOLT_ID,
  JAW,
  JAW,
  JAW,
  JAW,
];

/** This build's own opening state (setup not yet played). */
function fresh(seed = 6400): GameState {
  const created = createGame({
    seed,
    decks: { p1: [...DECK], p2: [...DECK] },
    cardPool: { [BODY]: BODY_CARD, [BOLT_ID]: BOLT_CARD, [JAW]: JAW_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

const p1Turn = (state: GameState) => firstP1Turn(state, BODY);

describe("prize stage: the version gate", () => {
  it("a v46 state is migrated", () => {
    expect(migrateStored(storedAt(46, fresh()))).not.toBeNull();
  });

  it("v40, the retired v41 and v51 are not migrated; a v46 state missing its players is not migrated", () => {
    const old = storedAt(46, fresh());
    for (const version of [40, 41, 51]) {
      expect(migrateStored({ ...old, version })).toBeNull();
    }
    expect(migrateStored({ ...old, state: { ...old.state, players: null } })).toBeNull();
  });
});

describe("prize stage: what the migration writes", () => {
  it("v46: nothing — every byte of the state kept, the pool unread", () => {
    const board = p1Turn(fresh());
    const old = storedAt(46, board);
    const migrated = mustMigrate(old);
    expect(migrated).toEqual(board);
    expect(migrated.cardPool[BOLT_ID]).toBe(old.state.cardPool[BOLT_ID]);
    expect(migrated).toEqual(old.state);
  });

  it("a live v46 Weakness retype and a live lock are kept as written: no key is added, no earlier step runs", () => {
    const board = p1Turn(fresh());
    const active = board.players.p2.active as InPlayPokemon;
    const live: GameState = {
      ...board,
      players: {
        ...board.players,
        p1: { ...board.players.p1, trainerFlipLockTurn: board.turn },
        p2: {
          ...board.players.p2,
          active: {
            ...active,
            weaknessRetype: { turn: board.turn + 2, type: "Colorless" },
            benchedTurn: 1,
          },
        },
      },
    };
    const migrated = mustMigrate(storedAt(46, live));
    expect(migrated.players.p2.active?.weaknessRetype).toEqual({
      turn: board.turn + 2,
      type: "Colorless",
    });
    expect(migrated.players.p2.active?.benchedTurn).toBe(1);
    expect(migrated.players.p1.trainerFlipLockTurn).toBe(board.turn);
  });

  it("v45: nothing too; v44: the lock keys; v43 and v42: the earlier steps too", () => {
    expect(mustMigrate(storedAt(45, fresh()))).toEqual(storedAt(45, fresh()).state);
    for (const version of [44, 43, 42] as const) {
      const migrated = mustMigrate(storedAt(version, fresh()));
      expect(migrated.players.p1.trainerFlipLockTurn).toBeNull();
      expect(migrated.handPlayLockedTurn.p2.Stadium).toBeNull();
      if (version <= 43) expect(migrated.players.p1.prizesTakenOnTurn).toBeNull();
      if (version <= 42) expect(migrated.players.p2.chosenAttackShield).toBeNull();
    }
  });

  it("does not touch the state it was given", () => {
    const old = storedAt(46, p1Turn(fresh()));
    const before = JSON.stringify(old);
    migrateStored(old);
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("prize stage: on a board, the migrated v46 state plays Overwriting Bolt", () => {
  it("a Pikachu in the Active Spot of a migrated v46 state installs the ×2 rewrite", () => {
    let board = p1Turn(fresh());
    const side = board.players.p1;
    const pikachu =
      side.deck.find((u) => board.cardIdByUid[u] === BOLT_ID) ??
      side.hand.find((u) => board.cardIdByUid[u] === BOLT_ID);
    if (pikachu === undefined || side.active === null) throw new Error("no Pikachu");
    board = {
      ...board,
      players: {
        ...board.players,
        p1: {
          ...side,
          deck: [...side.deck.filter((u) => u !== pikachu), ...side.active.stack],
          hand: side.hand.filter((u) => u !== pikachu),
          active: { ...side.active, stack: [pikachu] },
        },
      },
    };
    const migrated = mustMigrate(storedAt(46, board));
    const hit = applyAction(migrated, { type: "attack", seat: "p1", index: 0 });
    if (!hit.ok) throw new Error(hit.error.code);
    expect(hit.state.players.p2.active?.damage).toBe(10);
    expect(hit.state.players.p2.active?.weaknessRetype).toEqual({
      turn: migrated.turn + 2,
      type: "Lightning",
      asTimesTwo: true,
    });
  });
});
