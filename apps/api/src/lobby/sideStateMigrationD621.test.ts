// 🆕🆕🆕 D621 — MATCH_RECORD_VERSION 42 → 43, THE SECOND MIGRATION (match.ts "42 → 43 AT D621"): a v42
// record gains `PlayerSide.chosenAttackShield` / `sideRetreatLock` as `null` on each seat, with no D1
// read; a v41 record takes D583's pool refresh AND the two keys. Read as-is, a v42 side has neither
// key, and this build reads both as records: the first attack's damage step throws.

import { applyAction, type GameState, type Seat } from "@luminous/engine";
import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  loadMatchRecord,
  MATCH_RECORD_VERSION,
  type MatchRecord,
  type MatchSlot,
  MIGRATABLE_MATCH_RECORD_VERSION,
  migratablePoolIdsOf,
  migrateMatchRecord,
  readMatchRecord,
  SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION,
  startMatch,
} from "./match";

const BODY = "d621-body";
const TRAINER = "d621-trainer";
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "D621 Body",
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
  name: "D621 Trainer",
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

/** A record as a v42 deploy wrote it: neither D621 key on either side. */
function oldRecord(version: 41 | 42, seed = 6210): MatchRecord {
  const created = startMatch({
    seed,
    hostDeck: DECK,
    guestDeck: DECK,
    cardPool: { [BODY]: BODY_CARD, [TRAINER]: STALE_TRAINER },
  });
  if (!created.ok) throw new Error(created.error.message);
  const players = { ...created.state.players };
  for (const seat of ["p1", "p2"] as const) {
    const { chosenAttackShield: _a, sideRetreatLock: _b, ...v42Side } = players[seat];
    players[seat] = v42Side as GameState["players"][Seat];
  }
  return { version, seed, startedAt: 1_000, names: NAMES, state: { ...created.state, players }, log: [] };
}

function must(state: GameState, action: Parameters<typeof applyAction>[1]): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result.state;
}

/** Setup through the real action API, then p1's first turn (p2 went first and passed). */
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

describe("D621 — the version and the gate", () => {
  it("MATCH_RECORD_VERSION is 43 (🆕🆕🆕 44 since D630; 🆕🆕🆕 45 since D636; 🆕🆕🆕 46 since D637; 🆕🆕🆕 47 since D640; 🆕🆕🆕 48 since D643; 🆕🆕🆕 49 since D646); v41 is pool-migrated, v42 side-key-migrated (🆕🆕🆕 D630: and v43 record-key-migrated, recordKeysMigrationD630.test.ts; 🆕🆕🆕 D636: and v44 lock-key-migrated, lockKeysMigrationD636.test.ts; 🆕🆕🆕 D637: and v45 re-stamped, fossilsMigrationD637.test.ts; 🆕🆕🆕 D640: and v46 re-stamped, prizeStageMigrationD640.test.ts; 🆕🆕🆕 D643: and v47 re-stamped, toolTrimMigrationD643.test.ts; 🆕🆕🆕 D646: and v48 re-stamped, coinRedoMigrationD646.test.ts)", () => {
    expect(MATCH_RECORD_VERSION).toBe(49); // 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(MIGRATABLE_MATCH_RECORD_VERSION).toBe(41);
    expect(SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(42);
  });

  it("a v42 record is not read as-is; it is migrated with no pool ids (D1 is not asked)", () => {
    const old = oldRecord(42);
    expect(readMatchRecord(old)).toBeNull();
    expect(migratablePoolIdsOf(old)).toEqual([]);
    expect(migratablePoolIdsOf(oldRecord(41))?.sort()).toEqual([BODY, TRAINER].sort());
  });

  it("v40 and v44 are neither read nor migrated; a v42 record missing its players is not migrated (🆕🆕🆕 D630 (D539): v40 and v45 — v44 is this build's own) (🆕🆕🆕 D636 (D539): v40 and v46 — v45 is this build's own) (🆕🆕🆕 D637 (D539): v40 and v47 — v46 is this build's own) (🆕🆕🆕 D640 (D539): v40 and v48 — v47 is this build's own) (🆕🆕🆕 D643 (D539): v40 and v49 — v48 is this build's own) (🆕🆕🆕 D646 (D539): v40 and v50 — v49 is this build's own)", () => {
    const old = oldRecord(42);
    for (const version of [40, 50]) { // 🆕🆕🆕 D640 — 47 is this build's own 🆕🆕🆕 D643 — 48 is. 🆕🆕🆕 D646 — 49 is.
      expect(readMatchRecord({ ...old, version })).toBeNull();
      expect(migratablePoolIdsOf({ ...old, version })).toBeNull();
      expect(migrateMatchRecord({ ...old, version }, {})).toBeNull();
    }
    expect(migrateMatchRecord({ ...old, state: { ...old.state, players: null } }, {})).toBeNull();
    expect(migrateMatchRecord({ ...old, log: undefined }, {})).toBeNull();
  });
});

describe("D621 — what the migration writes", () => {
  it("v42: both sides gain the two keys as null, the pool is untouched, every other byte kept", () => {
    const old = oldRecord(42);
    const migrated = migrateMatchRecord(old, { [TRAINER]: FRESH_TRAINER });
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.version).toBe(49); // 🆕🆕🆕 D630 — 43 → 44 (D630's keys ride the same step; this fixture's sides are post-D630) 🆕🆕🆕 D636 — 44 → 45 (D636's keys too) 🆕🆕🆕 D637 — 45 → 46 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(readMatchRecord(migrated)).not.toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      expect(migrated.state.players[seat].chosenAttackShield).toBeNull();
      expect(migrated.state.players[seat].sideRetreatLock).toBeNull();
      const { chosenAttackShield: _a, sideRetreatLock: _b, ...rest } = migrated.state.players[seat];
      expect(rest).toEqual(old.state.players[seat]);
    }
    expect(migrated.state.cardPool[TRAINER]).toBe(old.state.cardPool[TRAINER]);
    const { players: _p, ...restNew } = migrated.state;
    const { players: _q, ...restOld } = old.state;
    expect(restNew).toEqual(restOld);
  });

  it("v41: the D583 Trainer refresh AND the two keys", () => {
    const migrated = migrateMatchRecord(oldRecord(41), { [TRAINER]: FRESH_TRAINER });
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.version).toBe(49); // 🆕🆕🆕 D630 — 43 → 44 🆕🆕🆕 D636 — 44 → 45 🆕🆕🆕 D637 — 45 → 46 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(migrated.state.cardPool[TRAINER]).toEqual(FRESH_TRAINER);
    expect(migrated.state.players.p1.sideRetreatLock).toBeNull();
    expect(migrated.state.players.p2.chosenAttackShield).toBeNull();
  });

  it("does not touch the record it was given", () => {
    const old = oldRecord(42);
    const before = JSON.stringify(old);
    migrateMatchRecord(old, {});
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("D621 — on a board: the unmigrated v42 state throws at the first attack; the migrated one plays", () => {
  it("an attack reads `chosenAttackShield` on both sides: undefined throws, null plays", () => {
    const old = oldRecord(42);
    // 🆕🆕🆕 D622 — the setup runs OUTSIDE the lambda, so the throw pinned is the FIRST ATTACK's.
    const turn = p1Turn(old.state);
    expect(() => applyAction(turn, { type: "attack", seat: "p1", index: 0 })).toThrow(TypeError);
    const migrated = migrateMatchRecord(old, {});
    if (migrated === null) throw new Error("not migrated");
    const hit = applyAction(p1Turn(migrated.state), { type: "attack", seat: "p1", index: 0 });
    expect(hit.ok).toBe(true);
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

describe("D621 — the DO's read migrates a v42 record without asking D1", () => {
  it("a v42 record: written once as v43 (🆕🆕🆕 v44 since D630; 🆕🆕🆕 v45 since D636; 🆕🆕🆕 v46 since D637; 🆕🆕🆕 v47 since D640; 🆕🆕🆕 v48 since D643; 🆕🆕🆕 v49 since D646), D1 never asked; the next read is plain", async () => {
    const { slot, api } = fakeSlot(oldRecord(42));
    const never = async (): Promise<Record<string, Card>> => {
      throw new Error("D1 asked");
    };
    const load = await loadMatchRecord(api, never);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(49); // 🆕🆕🆕 D630 — 43 → 44 🆕🆕🆕 D636 — 44 → 45 🆕🆕🆕 D637 — 45 → 46 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(slot.puts).toEqual([load.record]);
    expect((await loadMatchRecord(api, never)).kind).toBe("ok");
    expect(slot.puts).toHaveLength(1);
  });

  it("a v41 record still asks D1 for its pool, and lands at v43 (🆕🆕🆕 v44 since D630; 🆕🆕🆕 v45 since D636; 🆕🆕🆕 v46 since D637; 🆕🆕🆕 v47 since D640; 🆕🆕🆕 v48 since D643; 🆕🆕🆕 v49 since D646) with the keys", async () => {
    const { slot, api } = fakeSlot(oldRecord(41));
    const asked: string[][] = [];
    const load = await loadMatchRecord(api, async (ids) => {
      asked.push([...ids].sort());
      return { [TRAINER]: FRESH_TRAINER };
    });
    expect(asked).toEqual([[BODY, TRAINER].sort()]);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.state.cardPool[TRAINER]).toEqual(FRESH_TRAINER);
    expect(load.record.state.players.p1.chosenAttackShield).toBeNull();
    expect(slot.puts).toHaveLength(1);
  });
});
