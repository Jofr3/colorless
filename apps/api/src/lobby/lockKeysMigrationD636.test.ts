import { applyAction, type GameState, type InPlayPokemon, type Seat } from "@colorless/engine";
import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  LOCK_KEYS_MIGRATABLE_MATCH_RECORD_VERSION,
  loadMatchRecord,
  MATCH_RECORD_VERSION,
  type MatchRecord,
  type MatchSlot,
  MIGRATABLE_MATCH_RECORD_VERSION,
  migratablePoolIdsOf,
  migrateMatchRecord,
  RECORD_KEYS_MIGRATABLE_MATCH_RECORD_VERSION,
  readMatchRecord,
  SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION,
  startMatch,
} from "./match";

const BODY = "d636-body";
const TRAINER = "d636-trainer";
const HIT = 50;
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "D636 Body",
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
  name: "D636 Trainer",
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
const NAMES = { p1: "Ana", p2: "Bo" } as const;
type Side = GameState["players"][Seat];

function must(state: GameState, action: Parameters<typeof applyAction>[1]): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result.state;
}

/** Setup through the real action API, then p1's first turn (p2 went first and passed): turn 2. */
function p1Turn(start: GameState): GameState {
  let state = start;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" });
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] });
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === BODY);
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(state, { type: "setupPlaceActive", seat: s, uid });
  }
  for (const s of ["p1", "p2"] as const) state = must(state, { type: "setupReady", seat: s });
  return must(state, { type: "endTurn", seat: "p2" });
}

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
  const created = startMatch({
    seed,
    hostDeck: DECK,
    guestDeck: DECK,
    cardPool: { [BODY]: BODY_CARD, [TRAINER]: STALE_TRAINER },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

function oldRecord(version: 41 | 42 | 43 | 44, state?: GameState, seed = 6360): MatchRecord {
  const created = startMatch({
    seed,
    hostDeck: DECK,
    guestDeck: DECK,
    cardPool: { [BODY]: BODY_CARD, [TRAINER]: STALE_TRAINER },
  });
  if (!created.ok) throw new Error(created.error.message);
  let old = asV44(state ?? created.state);
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
  return { version, seed, startedAt: 1_000, names: NAMES, state: old, log: [] };
}

describe("D636 — the version and the gate", () => {
  it("MATCH_RECORD_VERSION is 45 ( 46 since D637; 47 since D640; 48 since D643; 49 since D646; 50 since the gate-key rename); v41 pool-migrated, v42 side-key-, v43 record-key-, v44 lock-key-migrated ( D637: and v45 re-stamped, fossilsMigrationD637.test.ts; D640: and v46 re-stamped, prizeStageMigrationD640.test.ts; D643: and v47 re-stamped, toolTrimMigrationD643.test.ts; D646: and v48 re-stamped, coinRedoMigrationD646.test.ts)", () => {
    expect(MATCH_RECORD_VERSION).toBe(50);
    expect(MIGRATABLE_MATCH_RECORD_VERSION).toBe(41);
    expect(SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(42);
    expect(RECORD_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(43);
    expect(LOCK_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(44);
  });

  it("a v44 record is not read as-is; it is migrated with no pool ids (D1 is not asked)", () => {
    const old = oldRecord(44);
    expect(readMatchRecord(old)).toBeNull();
    expect(migratablePoolIdsOf(old)).toEqual([]);
    expect(migratablePoolIdsOf(oldRecord(41))?.sort()).toEqual([BODY, TRAINER].sort());
  });

  it("v40 and v46 are neither read nor migrated; a v44 record missing its players is not migrated ( D637 (D539): v40 and v47 — v46 is this build's own) ( D640 (D539): v40 and v48 — v47 is this build's own) ( D643 (D539): v40 and v49 — v48 is this build's own) ( D646 (D539): v40 and v50 — v49 is this build's own) (then v40 and v51 — v50 is this build's own)", () => {
    const old = oldRecord(44);
    for (const version of [40, 51]) {
      expect(readMatchRecord({ ...old, version })).toBeNull();
      expect(migratablePoolIdsOf({ ...old, version })).toBeNull();
      expect(migrateMatchRecord({ ...old, version }, {})).toBeNull();
    }
    expect(migrateMatchRecord({ ...old, state: { ...old.state, players: null } }, {})).toBeNull();
    expect(migrateMatchRecord({ ...old, log: undefined }, {})).toBeNull();
  });
});

describe("D636 — what the migration writes", () => {
  it("v44: the side keys and the body keys as `null`, the Stadium stamp `null`; every other byte kept", () => {
    const board = p1Turn(fresh());
    const old = oldRecord(44, board);
    const migrated = migrateMatchRecord(old, { [TRAINER]: FRESH_TRAINER });
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.version).toBe(50);
    expect(readMatchRecord(migrated)).not.toBeNull();
    expect(migrated.state).toEqual(board);
    for (const seat of ["p1", "p2"] as const) {
      const side = migrated.state.players[seat];
      expect(side.trainerFlipLockTurn).toBeNull();
      expect(side.active?.attackTwoFlipLockTurn).toBeNull();
      expect(side.active?.benchedTurn).toBeNull();
      expect(migrated.state.handPlayLockedTurn[seat].Stadium).toBeNull();
    }
    expect(migrated.state.cardPool[TRAINER]).toBe(old.state.cardPool[TRAINER]);
  });

  it("a live v44 hand-attach mark gains `counters: 0` and is otherwise kept; a live D630 record is NOT re-nulled", () => {
    const board = p1Turn(fresh());
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
    const migrated = migrateMatchRecord(oldRecord(44, live), {});
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.state.players.p2.active?.handAttachMark).toEqual(mark);
    expect(migrated.state.players.p2.prizesTakenOnTurn).toEqual({ turn: 1, count: 1 });
    expect(migrated.state.players.p2.active?.attackDamageTaken).toEqual({ turn: 1, amount: 30 });
  });

  it("v43: D630's keys AND D636's; v42 and v41: the earlier steps too", () => {
    for (const version of [43, 42, 41] as const) {
      const migrated = migrateMatchRecord(oldRecord(version), { [TRAINER]: FRESH_TRAINER });
      if (migrated === null) throw new Error(`v${version} not migrated`);
      expect(migrated.version).toBe(50);
      expect(readMatchRecord(migrated)).not.toBeNull();
      expect(migrated.state.players.p1.prizesTakenOnTurn).toBeNull();
      expect(migrated.state.players.p2.sideDamageReduction).toEqual([]);
      expect(migrated.state.players.p1.chosenAttackShield).toBeNull();
      expect(migrated.state.players.p2.trainerFlipLockTurn).toBeNull();
      expect(migrated.state.handPlayLockedTurn.p1.Stadium).toBeNull();
      expect(migrated.state.cardPool[TRAINER]).toEqual(
        version === 41 ? FRESH_TRAINER : STALE_TRAINER,
      );
    }
  });

  it("does not touch the record it was given", () => {
    const old = oldRecord(44, p1Turn(fresh()));
    const before = JSON.stringify(old);
    migrateMatchRecord(old, {});
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("D636 — on a board: the migrated v44 record plays", () => {
  it("the migrated state attacks, and the hit lands with every new key present and empty", () => {
    const board = p1Turn(fresh());
    const migrated = migrateMatchRecord(oldRecord(44, board), {});
    if (migrated === null) throw new Error("not migrated");
    const hit = applyAction(migrated.state, { type: "attack", seat: "p1", index: 0 });
    if (!hit.ok) throw new Error(hit.error.code);
    expect(hit.state.players.p2.active?.damage).toBe(HIT);
    expect(hit.state.players.p2.active?.attackTwoFlipLockTurn).toBeNull();
  });
});

// ── THE DO's READ: `loadMatchRecord` over a fake slot ──

function fakeSlot(value: unknown) {
  const slot = { value, puts: [] as MatchRecord[] };
  const api: MatchSlot = {
    get: async () => slot.value,
    put: async (record) => {
      slot.puts.push(record);
      slot.value = record;
    },
  };
  return { slot, api };
}

describe("D636 — the DO's read migrates a v44 record without asking D1", () => {
  it("a v44 record: written once as v45 ( v46 since D637; v47 since D640; v48 since D643; v49 since D646; v50 since the gate-key rename), D1 never asked; the next read is plain", async () => {
    const { slot, api } = fakeSlot(oldRecord(44));
    const never = async (): Promise<Record<string, Card>> => {
      throw new Error("D1 asked");
    };
    const load = await loadMatchRecord(api, never);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(50);
    expect(slot.puts).toEqual([load.record]);
    expect((await loadMatchRecord(api, never)).kind).toBe("ok");
    expect(slot.puts).toHaveLength(1);
  });

  it("a v41 record still asks D1 for its pool, and lands at v45 ( v46 since D637; v47 since D640; v48 since D643; v49 since D646; v50 since the gate-key rename) with every key", async () => {
    const { slot, api } = fakeSlot(oldRecord(41));
    const asked: string[][] = [];
    const load = await loadMatchRecord(api, async (ids) => {
      asked.push([...ids].sort());
      return { [TRAINER]: FRESH_TRAINER };
    });
    expect(asked).toEqual([[BODY, TRAINER].sort()]);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(50);
    expect(load.record.state.players.p1.trainerFlipLockTurn).toBeNull();
    expect(load.record.state.players.p2.prizesTakenOnTurn).toBeNull();
    expect(slot.puts).toHaveLength(1);
  });
});
