import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { type GameState, type InPlayPokemon, type Seat, applyAction, createGame } from "./index";
import {
  type StoredState,
  firstP1Turn,
  migrateStored,
  mustMigrate,
  storedPoolIds,
} from "./testFixtures";

const BODY = "record-body";
const TRAINER = "record-trainer";
const HIT = 50;
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "Record Body",
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
  name: "Record Trainer",
  category: "Trainer",
  hp: null,
  stage: null,
  types: null,
  attacks: null,
  trainerType: "Item",
  effect: "Draw a card.",
} as unknown as Card;
const FRESH_TRAINER: Card = { ...STALE_TRAINER, hp: 60 } as Card;

const DECK = [...Array.from({ length: 58 }, () => BODY), TRAINER, TRAINER];

type Side = GameState["players"][Seat];

function must(state: GameState, action: Parameters<typeof applyAction>[1]): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result.state;
}

function fresh(seed = 6300): GameState {
  const created = createGame({
    seed,
    decks: { p1: [...DECK], p2: [...DECK] },
    cardPool: { [BODY]: BODY_CARD, [TRAINER]: STALE_TRAINER },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

function asV43(state: GameState, reductions: Partial<Record<Seat, unknown>> = {}): GameState {
  const strip = (pokemon: InPlayPokemon) => {
    const { attackDamageTaken: _a, ...v43 } = pokemon;
    return v43 as InPlayPokemon;
  };
  const players = { ...state.players };
  for (const seat of ["p1", "p2"] as const) {
    const { prizesTakenOnTurn: _p, sideDamageReduction: _s, ...rest } = players[seat];
    players[seat] = {
      ...rest,
      sideDamageReduction: reductions[seat] ?? null,
      active: rest.active === null ? null : strip(rest.active),
      bench: rest.bench.map(strip),
    } as unknown as Side;
  }
  return { ...state, players };
}

function oldState(version: 41 | 42 | 43, state?: GameState): StoredState {
  let old = asV43(state ?? fresh());
  if (version !== 43) {
    const players = { ...old.players };
    for (const seat of ["p1", "p2"] as const) {
      const { chosenAttackShield: _c, sideRetreatLock: _r, ...v42 } = players[seat];
      players[seat] = v42 as Side;
    }
    old = { ...old, players };
  }
  return { version, state: old };
}

describe("record keys: the version gate", () => {
  it("a v43 state is migrated with no pool ids; a v41 one needs its pool", () => {
    expect(storedPoolIds(oldState(43))).toEqual([]);
    expect(storedPoolIds(oldState(41))?.sort()).toEqual([BODY, TRAINER].sort());
  });

  it("v40 and v51 are not migrated; a v43 state missing its players is not migrated", () => {
    const old = oldState(43);
    for (const version of [40, 51]) {
      expect(storedPoolIds({ ...old, version })).toBeNull();
      expect(migrateStored({ ...old, version })).toBeNull();
    }
    expect(migrateStored({ ...old, state: { ...old.state, players: null } })).toBeNull();
  });
});

describe("record keys: what the migration writes", () => {
  it("v43: each side gains `prizesTakenOnTurn: null` and a list; each body `attackDamageTaken: null`; every other byte kept", () => {
    const board = firstP1Turn(fresh(), BODY);
    const old = oldState(43, board);
    const migrated = mustMigrate(old, { [TRAINER]: FRESH_TRAINER });
    for (const seat of ["p1", "p2"] as const) {
      const side = migrated.players[seat];
      expect(side.prizesTakenOnTurn).toBeNull();
      expect(side.sideDamageReduction).toEqual([]);
      expect(side.active?.attackDamageTaken).toBeNull();
      expect(side.chosenAttackShield).toBe(old.state.players[seat].chosenAttackShield);
      const { prizesTakenOnTurn: _p, sideDamageReduction: _s, active, bench, ...rest } = side;
      const {
        sideDamageReduction: _o,
        active: oldActive,
        bench: oldBench,
        ...oldRest
      } = old.state.players[seat];
      expect(rest).toEqual(oldRest);
      expect({ ...active, attackDamageTaken: undefined }).toEqual({
        ...oldActive,
        attackDamageTaken: undefined,
      });
      expect(bench.length).toBe(oldBench.length);
    }
    expect(migrated.cardPool[TRAINER]).toBe(old.state.cardPool[TRAINER]);
    const { players: _q, ...restNew } = migrated;
    const { players: _r, ...restOld } = old.state;
    expect(restNew).toEqual(restOld);
  });

  it("a v43 side's live chosen-Pokémon shield is kept: the side-key step does not run on a v43 state", () => {
    const old = oldState(43);
    const shield = { turn: 3, uid: "u1", fromClass: { stage: "ex" } };
    const players = {
      ...old.state.players,
      p1: { ...old.state.players.p1, chosenAttackShield: shield },
    } as GameState["players"];
    const migrated = migrateStored({ ...old, state: { ...old.state, players } });
    expect(migrated?.players.p1.chosenAttackShield).toEqual(shield);
  });

  it("a v43 side's one reduction record is wrapped into the list; a list is kept as it is", () => {
    const record = { turn: 3, amount: 30 };
    const old = oldState(43);
    const wrapped = migrateStored({ ...old, state: asV43(old.state, { p1: record }) });
    expect(wrapped?.players.p1.sideDamageReduction).toEqual([record]);
    expect(wrapped?.players.p2.sideDamageReduction).toEqual([]);
    const listed = migrateStored({ ...old, state: asV43(old.state, { p2: [record, record] }) });
    expect(listed?.players.p2.sideDamageReduction).toEqual([record, record]);
  });

  it("v42: the side keys and the record keys; v41: the Trainer refresh too", () => {
    const v42 = mustMigrate(oldState(42), { [TRAINER]: FRESH_TRAINER });
    expect(v42.players.p1.chosenAttackShield).toBeNull();
    expect(v42.players.p2.sideRetreatLock).toBeNull();
    expect(v42.players.p1.prizesTakenOnTurn).toBeNull();
    expect(v42.players.p2.sideDamageReduction).toEqual([]);
    expect(v42.cardPool[TRAINER]).toEqual(STALE_TRAINER);
    const v41 = mustMigrate(oldState(41), { [TRAINER]: FRESH_TRAINER });
    expect(v41.cardPool[TRAINER]).toEqual(FRESH_TRAINER);
    expect(v41.players.p1.chosenAttackShield).toBeNull();
    expect(v41.players.p1.sideDamageReduction).toEqual([]);
  });

  it("does not touch the state it was given", () => {
    const old = oldState(43, firstP1Turn(fresh(), BODY));
    const before = JSON.stringify(old);
    migrateStored(old);
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("record keys: the unmigrated v43 state throws at the first damaging hit; the migrated one plays", () => {
  it("a v43 `null` side reduction is iterated by this build: a TypeError, while the migrated hit lands", () => {
    const old = oldState(43, firstP1Turn(fresh(), BODY));
    expect(() => applyAction(old.state, { type: "attack", seat: "p1", index: 0 })).toThrow(
      TypeError,
    );
    const migrated = mustMigrate(old);
    const hit = applyAction(migrated, { type: "attack", seat: "p1", index: 0 });
    if (!hit.ok) throw new Error(hit.error.code);
    expect(hit.state.players.p2.active?.damage).toBe(HIT);
    expect(hit.state.players.p2.active?.attackDamageTaken).toEqual({ turn: 2, amount: HIT });
  });

  it("a live v43 Jasmine's Gaze record still pays after the migration (wrapped, not dropped)", () => {
    const turn2 = firstP1Turn(fresh(), BODY);
    const v43 = { version: 43, state: asV43(turn2, { p1: { turn: 3, amount: 30 } }) };
    const migrated = mustMigrate(v43);
    const turn3 = must(migrated, { type: "endTurn", seat: "p1" });
    const hit = applyAction(turn3, { type: "attack", seat: "p2", index: 0 });
    if (!hit.ok) throw new Error(hit.error.code);
    expect(hit.state.players.p1.active?.damage).toBe(HIT - 30);
  });
});
