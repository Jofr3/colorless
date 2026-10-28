import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { type GameState, type Seat, applyAction, createGame } from "./index";
import { type StoredState, firstP1Turn, migrateStored, mustMigrate } from "./testFixtures";

const BODY = "side-body";
const TRAINER = "side-trainer";
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "Side Body",
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
  attacks: [{ cost: [], name: "Tap", damage: "10" }],
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
const STALE_TRAINER: Card = {
  ...BODY_CARD,
  id: TRAINER,
  name: "Side Trainer",
  category: "Trainer",
  hp: null,
  stage: null,
  types: null,
  attacks: null,
  trainerType: "Item",
  effect: "Draw a card.",
} as unknown as Card;

const DECK = [...Array.from({ length: 58 }, () => BODY), TRAINER, TRAINER];

/** A v41 or v42 opening state: each side lacks `chosenAttackShield` and `sideRetreatLock`. */
function oldState(version: 41 | 42, seed = 6210): StoredState {
  const created = createGame({
    seed,
    decks: { p1: [...DECK], p2: [...DECK] },
    cardPool: { [BODY]: BODY_CARD, [TRAINER]: STALE_TRAINER },
  });
  if (!created.ok) throw new Error(created.error.message);
  const players = { ...created.state.players };
  for (const seat of ["p1", "p2"] as const) {
    const { chosenAttackShield: _a, sideRetreatLock: _b, ...v42Side } = players[seat];
    players[seat] = v42Side as GameState["players"][Seat];
  }
  return { version, state: { ...created.state, players } };
}

describe("side keys: the version gate", () => {
  it("a v42 state, the oldest migratable, is migrated; a v41 one is retired", () => {
    expect(migrateStored(oldState(42))).not.toBeNull();
    expect(migrateStored(oldState(41))).toBeNull();
  });

  it("v40 and v51 are not migrated; a v42 state missing its players is not migrated", () => {
    const old = oldState(42);
    for (const version of [40, 51]) {
      expect(migrateStored({ ...old, version })).toBeNull();
    }
    expect(migrateStored({ ...old, state: { ...old.state, players: null } })).toBeNull();
  });
});

describe("side keys: what the migration writes", () => {
  it("v42: both sides gain the two keys as null, the pool is untouched, every other byte kept", () => {
    const old = oldState(42);
    const migrated = mustMigrate(old);
    for (const seat of ["p1", "p2"] as const) {
      expect(migrated.players[seat].chosenAttackShield).toBeNull();
      expect(migrated.players[seat].sideRetreatLock).toBeNull();
      const { chosenAttackShield: _a, sideRetreatLock: _b, ...rest } = migrated.players[seat];
      expect(rest).toEqual(old.state.players[seat]);
    }
    expect(migrated.cardPool[TRAINER]).toBe(old.state.cardPool[TRAINER]);
    const { players: _p, ...restNew } = migrated;
    const { players: _q, ...restOld } = old.state;
    expect(restNew).toEqual(restOld);
  });

  it("v42: a live side install and a live body effect are kept as written", () => {
    const old = oldState(42);
    const board = firstP1Turn(old.state, BODY);
    const active = board.players.p2.active;
    if (active === null) throw new Error("no Active");
    const lock = { turn: board.turn + 1 };
    const live = {
      ...board,
      players: {
        ...board.players,
        p1: { ...board.players.p1, sideAttackLock: lock },
        p2: { ...board.players.p2, active: { ...active, attackLockedTurn: board.turn + 1 } },
      },
    } as GameState;
    const migrated = mustMigrate({ version: 42, state: live });
    expect(migrated.players.p1.sideAttackLock).toEqual(lock);
    expect(migrated.players.p2.active?.attackLockedTurn).toBe(board.turn + 1);
  });

  it("does not touch the state it was given", () => {
    const old = oldState(42);
    const before = JSON.stringify(old);
    migrateStored(old);
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("side keys: the unmigrated v42 state throws at the first attack; the migrated one plays", () => {
  it("an attack reads `chosenAttackShield` on both sides: undefined throws, null plays", () => {
    const old = oldState(42);
    const turn = firstP1Turn(old.state, BODY);
    expect(() => applyAction(turn, { type: "attack", seat: "p1", index: 0 })).toThrow(TypeError);
    const migrated = mustMigrate(old);
    const hit = applyAction(firstP1Turn(migrated, BODY), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(hit.ok).toBe(true);
  });
});
