import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { type GameState, type InPlayPokemon, type Seat, applyAction, createGame } from "./index";
import { type StoredState, firstP1Turn, migrateStored, mustMigrate } from "./testFixtures";

const BODY = "lock-body";
const TRAINER = "lock-trainer";
const HIT = 50;
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "Lock Body",
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
const STALE_TRAINER: Card = {
  ...BODY_CARD,
  id: TRAINER,
  name: "Lock Trainer",
  category: "Trainer",
  hp: null,
  stage: null,
  types: null,
  attacks: null,
  trainerType: "Item",
  effect: "Draw a card.",
} as unknown as Card;

const DECK = [...Array.from({ length: 58 }, () => BODY), TRAINER, TRAINER];

type Side = GameState["players"][Seat];

function asV44(state: GameState): GameState {
  const strip = (pokemon: InPlayPokemon) => {
    const { attackTwoFlipLockTurn: _a, benchedTurn: _b, handAttachMark, ...v44 } = pokemon;
    const mark = handAttachMark === null ? null : (({ counters: _c, ...m }) => m)(handAttachMark);
    return { ...v44, handAttachMark: mark } as unknown as InPlayPokemon;
  };
  const players = { ...state.players };
  const handPlayLockedTurn = { ...state.handPlayLockedTurn };
  for (const seat of ["p1", "p2"] as const) {
    const { trainerFlipLockTurn: _t, ...rest } = players[seat];
    players[seat] = {
      ...rest,
      active: rest.active === null ? null : strip(rest.active),
      bench: rest.bench.map(strip),
    } as unknown as Side;
    const { Stadium: _s, ...locks } = handPlayLockedTurn[seat];
    handPlayLockedTurn[seat] = locks as GameState["handPlayLockedTurn"][Seat];
  }
  return { ...state, players, handPlayLockedTurn };
}

/** This build's own opening state (setup not yet played). */
function fresh(seed = 6360): GameState {
  const created = createGame({
    seed,
    decks: { p1: [...DECK], p2: [...DECK] },
    cardPool: { [BODY]: BODY_CARD, [TRAINER]: STALE_TRAINER },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

function oldState(version: 41 | 42 | 43 | 44, state?: GameState): StoredState {
  let old = asV44(state ?? fresh());
  if (version <= 43) {
    const players = { ...old.players };
    for (const seat of ["p1", "p2"] as const) {
      const { prizesTakenOnTurn: _p, sideDamageReduction: _s, ...v43 } = players[seat];
      const strip = (pokemon: InPlayPokemon) => {
        const { attackDamageTaken: _a, ...rest } = pokemon;
        return rest as InPlayPokemon;
      };
      players[seat] = {
        ...v43,
        sideDamageReduction: null,
        active: v43.active === null ? null : strip(v43.active),
        bench: v43.bench.map(strip),
      } as unknown as Side;
    }
    old = { ...old, players };
  }
  if (version <= 42) {
    const players = { ...old.players };
    for (const seat of ["p1", "p2"] as const) {
      const { chosenAttackShield: _c, sideRetreatLock: _r, ...v42 } = players[seat];
      players[seat] = v42 as Side;
    }
    old = { ...old, players };
  }
  return { version, state: old };
}

describe("lock keys: the version gate", () => {
  it("a v44 state is migrated; a v41 one is retired", () => {
    expect(migrateStored(oldState(44))).not.toBeNull();
    expect(migrateStored(oldState(41))).toBeNull();
  });

  it("v40 and v51 are not migrated; a v44 state missing its players is not migrated", () => {
    const old = oldState(44);
    for (const version of [40, 51]) {
      expect(migrateStored({ ...old, version })).toBeNull();
    }
    expect(migrateStored({ ...old, state: { ...old.state, players: null } })).toBeNull();
  });
});

describe("lock keys: what the migration writes", () => {
  it("v44: the side keys and the body keys as `null`, the Stadium stamp `null`; every other byte kept", () => {
    const board = firstP1Turn(fresh(), BODY);
    const old = oldState(44, board);
    const migrated = mustMigrate(old);
    expect(migrated).toEqual(board);
    for (const seat of ["p1", "p2"] as const) {
      const side = migrated.players[seat];
      expect(side.trainerFlipLockTurn).toBeNull();
      expect(side.active?.attackTwoFlipLockTurn).toBeNull();
      expect(side.active?.benchedTurn).toBeNull();
      expect(migrated.handPlayLockedTurn[seat].Stadium).toBeNull();
    }
    expect(migrated.cardPool[TRAINER]).toBe(old.state.cardPool[TRAINER]);
  });

  it("a live v44 hand-attach mark gains `counters: 0` and is otherwise kept; a live prize or damage record is kept", () => {
    const board = firstP1Turn(fresh(), BODY);
    const active = board.players.p2.active as InPlayPokemon;
    const mark = { turn: 3, barred: true, endsTurn: false, tripped: false, counters: 0 };
    const live: GameState = {
      ...board,
      players: {
        ...board.players,
        p2: {
          ...board.players.p2,
          prizesTakenOnTurn: { turn: 1, count: 1 },
          active: { ...active, handAttachMark: mark, attackDamageTaken: { turn: 1, amount: 30 } },
        },
      },
    };
    const migrated = mustMigrate(oldState(44, live));
    expect(migrated.players.p2.active?.handAttachMark).toEqual(mark);
    expect(migrated.players.p2.prizesTakenOnTurn).toEqual({ turn: 1, count: 1 });
    expect(migrated.players.p2.active?.attackDamageTaken).toEqual({ turn: 1, amount: 30 });
  });

  it("v43: the record keys and the lock keys; v42: the earlier steps too", () => {
    for (const version of [43, 42] as const) {
      const migrated = mustMigrate(oldState(version));
      expect(migrated.players.p1.prizesTakenOnTurn).toBeNull();
      expect(migrated.players.p2.sideDamageReduction).toEqual([]);
      expect(migrated.players.p1.chosenAttackShield).toBeNull();
      expect(migrated.players.p2.trainerFlipLockTurn).toBeNull();
      expect(migrated.handPlayLockedTurn.p1.Stadium).toBeNull();
      expect(migrated.cardPool[TRAINER]).toEqual(STALE_TRAINER);
    }
  });

  it("does not touch the state it was given", () => {
    const old = oldState(44, firstP1Turn(fresh(), BODY));
    const before = JSON.stringify(old);
    migrateStored(old);
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("lock keys: the migrated v44 state plays", () => {
  it("the migrated state attacks, and the hit lands with every new key present and empty", () => {
    const board = firstP1Turn(fresh(), BODY);
    const migrated = mustMigrate(oldState(44, board));
    const hit = applyAction(migrated, { type: "attack", seat: "p1", index: 0 });
    if (!hit.ok) throw new Error(hit.error.code);
    expect(hit.state.players.p2.active?.damage).toBe(HIT);
    expect(hit.state.players.p2.active?.attackTwoFlipLockTurn).toBeNull();
  });
});
