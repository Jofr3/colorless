// 🆕🆕🆕 D630 — MATCH_RECORD_VERSION 43 → 44, THE THIRD MIGRATION (match.ts "43 → 44 AT D630"): a v43 record
// gains, with no D1 read, `PlayerSide.prizesTakenOnTurn: null` and `sideDamageReduction` as a list (`null` →
// `[]`, one record → `[record]`) on each seat, and `InPlayPokemon.attackDamageTaken: null` on every in-play body.
// A v42 record takes D621's step first, a v41 record all three. Read as-is, a v43 side's `null` reduction is
// iterated by this build's `seatDamageReduction`: the first damaging hit throws.

import { applyAction, type GameState, type InPlayPokemon, type Seat } from "@colorless/engine";
import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
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

const BODY = "d630-body";
const TRAINER = "d630-trainer";
const HIT = 50;
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "D630 Body",
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
  name: "D630 Trainer",
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

/** This build's state written back as a v43 deploy held it: no `prizesTakenOnTurn`, `sideDamageReduction` as
    `null` or one record, no `attackDamageTaken` on any body. D621's two keys are KEPT (a v43 side has them). */
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

/** A record as an older deploy wrote it. v42 also lacks D621's two keys; v41 also the D583 refresh. */
function oldRecord(version: 41 | 42 | 43, state?: GameState, seed = 6300): MatchRecord {
  const created = startMatch({
    seed,
    hostDeck: DECK,
    guestDeck: DECK,
    cardPool: { [BODY]: BODY_CARD, [TRAINER]: STALE_TRAINER },
  });
  if (!created.ok) throw new Error(created.error.message);
  let old = asV43(state ?? created.state);
  if (version !== 43) {
    const players = { ...old.players };
    for (const seat of ["p1", "p2"] as const) {
      const { chosenAttackShield: _c, sideRetreatLock: _r, ...v42 } = players[seat];
      players[seat] = v42 as Side;
    }
    old = { ...old, players };
  }
  return { version, seed, startedAt: 1_000, names: NAMES, state: old, log: [] };
}

describe("D630 — the version and the gate", () => {
  it("MATCH_RECORD_VERSION is 44 (🆕🆕🆕 45 since D636; 🆕🆕🆕 46 since D637; 🆕🆕🆕 47 since D640; 🆕🆕🆕 48 since D643; 🆕🆕🆕 49 since D646); v41 pool-migrated, v42 side-key-migrated, v43 record-key-migrated (🆕🆕🆕 D636: and v44 lock-key-migrated, lockKeysMigrationD636.test.ts; 🆕🆕🆕 D637: and v45 re-stamped, fossilsMigrationD637.test.ts; 🆕🆕🆕 D640: and v46 re-stamped, prizeStageMigrationD640.test.ts; 🆕🆕🆕 D643: and v47 re-stamped, toolTrimMigrationD643.test.ts; 🆕🆕🆕 D646: and v48 re-stamped, coinRedoMigrationD646.test.ts)", () => {
    expect(MATCH_RECORD_VERSION).toBe(49); // 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(MIGRATABLE_MATCH_RECORD_VERSION).toBe(41);
    expect(SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(42);
    expect(RECORD_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(43);
  });

  it("a v43 record is not read as-is; it is migrated with no pool ids (D1 is not asked)", () => {
    const old = oldRecord(43);
    expect(readMatchRecord(old)).toBeNull();
    expect(migratablePoolIdsOf(old)).toEqual([]);
    expect(migratablePoolIdsOf(oldRecord(41))?.sort()).toEqual([BODY, TRAINER].sort());
  });

  it("v40 and v45 are neither read nor migrated; a v43 record missing its players is not migrated (🆕🆕🆕 D636 (D539): v40 and v46 — v45 is this build's own) (🆕🆕🆕 D637 (D539): v40 and v47 — v46 is this build's own) (🆕🆕🆕 D640 (D539): v40 and v48 — v47 is this build's own) (🆕🆕🆕 D643 (D539): v40 and v49 — v48 is this build's own) (🆕🆕🆕 D646 (D539): v40 and v50 — v49 is this build's own)", () => {
    const old = oldRecord(43);
    for (const version of [40, 50]) { // 🆕🆕🆕 D640 — 47 is this build's own 🆕🆕🆕 D643 — 48 is. 🆕🆕🆕 D646 — 49 is.
      expect(readMatchRecord({ ...old, version })).toBeNull();
      expect(migratablePoolIdsOf({ ...old, version })).toBeNull();
      expect(migrateMatchRecord({ ...old, version }, {})).toBeNull();
    }
    expect(migrateMatchRecord({ ...old, state: { ...old.state, players: null } }, {})).toBeNull();
    expect(migrateMatchRecord({ ...old, log: undefined }, {})).toBeNull();
  });
});

describe("D630 — what the migration writes", () => {
  it("v43: each side gains `prizesTakenOnTurn: null` and a list; each body `attackDamageTaken: null`; every other byte kept", () => {
    const board = p1Turn(oldRecord(43).state as GameState);
    const old = oldRecord(43, board);
    const migrated = migrateMatchRecord(old, { [TRAINER]: FRESH_TRAINER });
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.version).toBe(49); // 🆕🆕🆕 D636 — 44 → 45 (D636's step rides it) 🆕🆕🆕 D637 — 45 → 46 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(readMatchRecord(migrated)).not.toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      const side = migrated.state.players[seat];
      expect(side.prizesTakenOnTurn).toBeNull();
      expect(side.sideDamageReduction).toEqual([]);
      expect(side.active?.attackDamageTaken).toBeNull();
      // D621's keys are a v43 side's own: kept, not re-written.
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
    expect(migrated.state.cardPool[TRAINER]).toBe(old.state.cardPool[TRAINER]);
    const { players: _q, ...restNew } = migrated.state;
    const { players: _r, ...restOld } = old.state;
    expect(restNew).toEqual(restOld);
  });

  it("a v43 side's LIVE D621 shield is kept: D621's step is not re-run on a v43 record", () => {
    const old = oldRecord(43);
    const shield = { turn: 3, uid: "u1", fromClass: { stage: "ex" } };
    const players = {
      ...old.state.players,
      p1: { ...old.state.players.p1, chosenAttackShield: shield },
    } as GameState["players"];
    const migrated = migrateMatchRecord({ ...old, state: { ...old.state, players } }, {});
    expect(migrated?.state.players.p1.chosenAttackShield).toEqual(shield);
  });

  it("a v43 side's ONE record is wrapped into the list; a list is kept as it is", () => {
    const record = { turn: 3, amount: 30 };
    const old = oldRecord(43);
    const wrapped = migrateMatchRecord(
      { ...old, state: asV43(old.state as GameState, { p1: record }) },
      {},
    );
    expect(wrapped?.state.players.p1.sideDamageReduction).toEqual([record]);
    expect(wrapped?.state.players.p2.sideDamageReduction).toEqual([]);
    const listed = migrateMatchRecord(
      { ...old, state: asV43(old.state as GameState, { p2: [record, record] }) },
      {},
    );
    expect(listed?.state.players.p2.sideDamageReduction).toEqual([record, record]);
  });

  it("v42: D621's two keys AND D630's; v41: the D583 Trainer refresh too", () => {
    const v42 = migrateMatchRecord(oldRecord(42), { [TRAINER]: FRESH_TRAINER });
    if (v42 === null) throw new Error("not migrated");
    expect(v42.version).toBe(49); // 🆕🆕🆕 D636 🆕🆕🆕 D637 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(v42.state.players.p1.chosenAttackShield).toBeNull();
    expect(v42.state.players.p2.sideRetreatLock).toBeNull();
    expect(v42.state.players.p1.prizesTakenOnTurn).toBeNull();
    expect(v42.state.players.p2.sideDamageReduction).toEqual([]);
    expect(v42.state.cardPool[TRAINER]).toEqual(STALE_TRAINER);
    const v41 = migrateMatchRecord(oldRecord(41), { [TRAINER]: FRESH_TRAINER });
    if (v41 === null) throw new Error("not migrated");
    expect(v41.version).toBe(49); // 🆕🆕🆕 D636 🆕🆕🆕 D637 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(v41.state.cardPool[TRAINER]).toEqual(FRESH_TRAINER);
    expect(v41.state.players.p1.chosenAttackShield).toBeNull();
    expect(v41.state.players.p1.sideDamageReduction).toEqual([]);
  });

  it("does not touch the record it was given", () => {
    const old = oldRecord(43, p1Turn(oldRecord(43).state as GameState));
    const before = JSON.stringify(old);
    migrateMatchRecord(old, {});
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("D630 — on a board: the unmigrated v43 state throws at the first damaging hit; the migrated one plays", () => {
  it("a v43 `null` side reduction is iterated by this build: undefined behaviour is a TypeError, the migrated hit lands", () => {
    const old = oldRecord(43, p1Turn(oldRecord(43).state as GameState));
    expect(() => applyAction(old.state, { type: "attack", seat: "p1", index: 0 })).toThrow(
      TypeError,
    );
    const migrated = migrateMatchRecord(old, {});
    if (migrated === null) throw new Error("not migrated");
    const hit = applyAction(migrated.state, { type: "attack", seat: "p1", index: 0 });
    if (!hit.ok) throw new Error(hit.error.code);
    expect(hit.state.players.p2.active?.damage).toBe(HIT);
    expect(hit.state.players.p2.active?.attackDamageTaken).toEqual({ turn: 2, amount: HIT });
  });

  it("a live v43 Jasmine's Gaze record still pays after the migration (wrapped, not dropped)", () => {
    const turn2 = p1Turn(oldRecord(43).state as GameState);
    const old = oldRecord(43);
    const v43 = { ...old, state: asV43(turn2, { p1: { turn: 3, amount: 30 } }) };
    const migrated = migrateMatchRecord(v43, {});
    if (migrated === null) throw new Error("not migrated");
    const turn3 = must(migrated.state, { type: "endTurn", seat: "p1" });
    const hit = applyAction(turn3, { type: "attack", seat: "p2", index: 0 });
    if (!hit.ok) throw new Error(hit.error.code);
    expect(hit.state.players.p1.active?.damage).toBe(HIT - 30);
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

describe("D630 — the DO's read migrates a v43 record without asking D1", () => {
  it("a v43 record: written once as v44 (🆕🆕🆕 v45 since D636; 🆕🆕🆕 v46 since D637; 🆕🆕🆕 v47 since D640; 🆕🆕🆕 v48 since D643; 🆕🆕🆕 v49 since D646), D1 never asked; the next read is plain", async () => {
    const { slot, api } = fakeSlot(oldRecord(43));
    const never = async (): Promise<Record<string, Card>> => {
      throw new Error("D1 asked");
    };
    const load = await loadMatchRecord(api, never);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(49); // 🆕🆕🆕 D636 — 44 → 45 🆕🆕🆕 D637 — 45 → 46 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(slot.puts).toEqual([load.record]);
    expect((await loadMatchRecord(api, never)).kind).toBe("ok");
    expect(slot.puts).toHaveLength(1);
  });

  it("a v41 record still asks D1 for its pool, and lands at v44 (🆕🆕🆕 v45 since D636; 🆕🆕🆕 v46 since D637; 🆕🆕🆕 v47 since D640; 🆕🆕🆕 v48 since D643; 🆕🆕🆕 v49 since D646) with every key", async () => {
    const { slot, api } = fakeSlot(oldRecord(41));
    const asked: string[][] = [];
    const load = await loadMatchRecord(api, async (ids) => {
      asked.push([...ids].sort());
      return { [TRAINER]: FRESH_TRAINER };
    });
    expect(asked).toEqual([[BODY, TRAINER].sort()]);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(49); // 🆕🆕🆕 D636 — 44 → 45 🆕🆕🆕 D637 — 45 → 46 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(load.record.state.players.p1.prizesTakenOnTurn).toBeNull();
    expect(load.record.state.players.p2.chosenAttackShield).toBeNull();
    expect(slot.puts).toHaveLength(1);
  });
});
