// 🆕🆕🆕 D640 — MATCH_RECORD_VERSION 46 → 47, THE SIXTH MIGRATION (match.ts "46 → 47 AT D640"): Overwriting Bolt's
// `WeaknessRetype.asTimesTwo` and Celebration's `PendingStage` `shuffleHandIntoDeck` are both persisted shapes a 0.522
// rollback misreads. No v46 writer could write either, so a v46 record is migrated by a re-stamp alone (no D1 read), as a
// v45 one is; a v44 record takes D636's step, a v43 two, a v42 three, a v41 all four.

import { applyAction, type GameState, type InPlayPokemon, type Seat } from "@colorless/engine";
import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  FOSSILS_MIGRATABLE_MATCH_RECORD_VERSION,
  LOCK_KEYS_MIGRATABLE_MATCH_RECORD_VERSION,
  PRIZE_STAGE_MIGRATABLE_MATCH_RECORD_VERSION,
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

const BODY = "d640-body";
const BOLT_ID = "30th-040"; // Pikachu "Overwriting Bolt" — read since D640
const JAW = "me03-068"; // Antique Jaw Fossil — kept so the earlier steps run over the same pool
const HIT = 50;
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "D640 Body",
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
/** The catalog row a v46 pool holds — the printed face; only this build reads its sentence. */
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
/** The catalog row as a pool holds it (D581's ingest keeps the printed face). */
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

const DECK = [...Array.from({ length: 52 }, () => BODY), BOLT_ID, BOLT_ID, BOLT_ID, BOLT_ID, JAW, JAW, JAW, JAW];
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

/** This build's own opening state (setup not yet played). */
function fresh(seed = 6400): GameState {
  const created = startMatch({
    seed,
    hostDeck: DECK,
    guestDeck: DECK,
    cardPool: { [BODY]: BODY_CARD, [BOLT_ID]: BOLT_CARD, [JAW]: JAW_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

/** A record as an older deploy wrote it. v46 and v45 are this build's bytes (no key was added at either); v44 also
    lacks D636's keys; v43 D630's too; v42 D621's too; v41 is the D583-refreshed shape below that. */
function oldRecord(version: 41 | 42 | 43 | 44 | 45 | 46, state?: GameState): MatchRecord {
  let old = state ?? fresh();
  if (version <= 44) {
    const strip = (pokemon: InPlayPokemon) => {
      const { attackTwoFlipLockTurn: _a, benchedTurn: _b, ...v44 } = pokemon;
      return v44 as unknown as InPlayPokemon;
    };
    const players = { ...old.players };
    const handPlayLockedTurn = { ...old.handPlayLockedTurn };
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
    old = { ...old, players, handPlayLockedTurn };
  }
  if (version <= 43) {
    const players = { ...old.players };
    for (const seat of ["p1", "p2"] as const) {
      const { prizesTakenOnTurn: _p, sideDamageReduction: _s, ...v43 } = players[seat];
      players[seat] = { ...v43, sideDamageReduction: null } as unknown as Side;
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
  return { version, seed: 6400, startedAt: 1_000, names: NAMES, state: old, log: [] };
}

describe("D640 — the version and the gate", () => {
  it("MATCH_RECORD_VERSION is 47 (🆕🆕🆕 48 since D643; 🆕🆕🆕 49 since D646); v41 pool-migrated, v42 side-key-, v43 record-key-, v44 lock-key-migrated, v45 and v46 re-stamped (🆕🆕🆕 D643: and v47 re-stamped, toolTrimMigrationD643.test.ts; 🆕🆕🆕 D646: and v48 re-stamped, coinRedoMigrationD646.test.ts)", () => {
    expect(MATCH_RECORD_VERSION).toBe(49); // 🆕🆕🆕 D643 — 47 → 48 🆕🆕🆕 D646 — 48 → 49.
    expect(MIGRATABLE_MATCH_RECORD_VERSION).toBe(41);
    expect(SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(42);
    expect(RECORD_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(43);
    expect(LOCK_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(44);
    expect(FOSSILS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(45);
    expect(PRIZE_STAGE_MIGRATABLE_MATCH_RECORD_VERSION).toBe(46);
  });

  it("a v46 record is not read as-is; it is migrated with no pool ids (D1 is not asked)", () => {
    const old = oldRecord(46);
    expect(readMatchRecord(old)).toBeNull();
    expect(migratablePoolIdsOf(old)).toEqual([]);
    expect(readMatchRecord({ ...old, version: 49 })).not.toBeNull(); // 🆕🆕🆕 D643 — 48 is this build's own 🆕🆕🆕 D646 — 49 is.
  });

  it("v40 and v48 (🆕🆕🆕 D643 (D539): v49 — v48 is this build's own) (🆕🆕🆕 D646 (D539): v50 — v49 is) are neither read nor migrated; a v46 record missing its players or its log is not migrated", () => {
    const old = oldRecord(46);
    for (const version of [40, 50]) { // 🆕🆕🆕 D643 — 48 is this build's own 🆕🆕🆕 D646 — 49 is.
      expect(readMatchRecord({ ...old, version })).toBeNull();
      expect(migratablePoolIdsOf({ ...old, version })).toBeNull();
      expect(migrateMatchRecord({ ...old, version }, {})).toBeNull();
    }
    expect(migrateMatchRecord({ ...old, state: { ...old.state, players: null } }, {})).toBeNull();
    expect(migrateMatchRecord({ ...old, log: undefined }, {})).toBeNull();
  });
});

describe("D640 — what the migration writes", () => {
  it("v46: the version and nothing else — every byte of the state kept, the pool unread", () => {
    const board = p1Turn(fresh());
    const old = oldRecord(46, board);
    const migrated = migrateMatchRecord(old, { [BOLT_ID]: { ...BOLT_CARD, name: "stale" } as Card });
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.version).toBe(49); // 🆕🆕🆕 D643 — 47 → 48 🆕🆕🆕 D646 — 48 → 49.
    expect(readMatchRecord(migrated)).not.toBeNull();
    expect(migrated.state).toEqual(board);
    expect(migrated.state.cardPool[BOLT_ID]).toBe(old.state.cardPool[BOLT_ID]);
    expect({ ...migrated, version: 46 }).toEqual(old);
  });

  it("a live v46 D552 retype and a live lock are kept as written: no key is added, no earlier step runs", () => {
    const board = p1Turn(fresh());
    const active = board.players.p2.active as InPlayPokemon;
    const live: GameState = {
      ...board,
      players: {
        ...board.players,
        p1: { ...board.players.p1, trainerFlipLockTurn: board.turn },
        p2: {
          ...board.players.p2,
          active: { ...active, weaknessRetype: { turn: board.turn + 2, type: "Colorless" }, benchedTurn: 1 },
        },
      },
    };
    const migrated = migrateMatchRecord(oldRecord(46, live), {});
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.state.players.p2.active?.weaknessRetype).toEqual({ turn: board.turn + 2, type: "Colorless" });
    expect(migrated.state.players.p2.active?.benchedTurn).toBe(1);
    expect(migrated.state.players.p1.trainerFlipLockTurn).toBe(board.turn);
  });

  it("v45: re-stamped too; v44: D636's keys; v43, v42 and v41: the earlier steps too — every one lands at v47 (🆕🆕🆕 v48 since D643; 🆕🆕🆕 v49 since D646)", () => {
    const v45 = migrateMatchRecord(oldRecord(45), {});
    expect(v45?.version).toBe(49); // 🆕🆕🆕 D643 — 47 → 48 🆕🆕🆕 D646 — 48 → 49.
    expect({ ...v45, version: 45 }).toEqual(oldRecord(45));
    for (const version of [44, 43, 42, 41] as const) {
      const migrated = migrateMatchRecord(oldRecord(version), { [JAW]: JAW_CARD, [BOLT_ID]: BOLT_CARD });
      if (migrated === null) throw new Error(`v${version} not migrated`);
      expect(migrated.version).toBe(49); // 🆕🆕🆕 D643 — 47 → 48 🆕🆕🆕 D646 — 48 → 49.
      expect(readMatchRecord(migrated)).not.toBeNull();
      expect(migrated.state.players.p1.trainerFlipLockTurn).toBeNull();
      expect(migrated.state.handPlayLockedTurn.p2.Stadium).toBeNull();
      if (version <= 43) expect(migrated.state.players.p1.prizesTakenOnTurn).toBeNull();
      if (version <= 42) expect(migrated.state.players.p2.chosenAttackShield).toBeNull();
    }
  });

  it("does not touch the record it was given", () => {
    const old = oldRecord(46, p1Turn(fresh()));
    const before = JSON.stringify(old);
    migrateMatchRecord(old, {});
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("D640 — on a board: the migrated v46 record plays Overwriting Bolt", () => {
  it("a Pikachu in the Active Spot of a migrated v46 record installs the ×2 rewrite", () => {
    let board = p1Turn(fresh());
    const side = board.players.p1;
    const pikachu = side.deck.find((u) => board.cardIdByUid[u] === BOLT_ID) ?? side.hand.find((u) => board.cardIdByUid[u] === BOLT_ID);
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
    const migrated = migrateMatchRecord(oldRecord(46, board), {});
    if (migrated === null) throw new Error("not migrated");
    const hit = applyAction(migrated.state, { type: "attack", seat: "p1", index: 0 });
    if (!hit.ok) throw new Error(hit.error.code);
    expect(hit.state.players.p2.active?.damage).toBe(10);
    expect(hit.state.players.p2.active?.weaknessRetype).toEqual({
      turn: migrated.state.turn + 2,
      type: "Lightning",
      asTimesTwo: true,
    });
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

describe("D640 — the DO's read migrates a v46 record without asking D1", () => {
  it("a v46 record: written once as v47 (🆕🆕🆕 v48 since D643; 🆕🆕🆕 v49 since D646), D1 never asked; the next read is plain", async () => {
    const { slot, api } = fakeSlot(oldRecord(46));
    const never = async (): Promise<Record<string, Card>> => {
      throw new Error("D1 asked");
    };
    const load = await loadMatchRecord(api, never);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(49); // 🆕🆕🆕 D643 — 47 → 48 🆕🆕🆕 D646 — 48 → 49.
    expect(slot.puts).toEqual([load.record]);
    expect((await loadMatchRecord(api, never)).kind).toBe("ok");
    expect(slot.puts).toHaveLength(1);
  });

  it("a v41 record still asks D1 for its pool, and lands at v47 (🆕🆕🆕 v48 since D643; 🆕🆕🆕 v49 since D646) with every key", async () => {
    const { slot, api } = fakeSlot(oldRecord(41));
    const asked: string[][] = [];
    const load = await loadMatchRecord(api, async (ids) => {
      asked.push([...ids].sort());
      return { [JAW]: JAW_CARD, [BOLT_ID]: BOLT_CARD };
    });
    expect(asked).toEqual([[BODY, BOLT_ID, JAW].sort()]);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(49); // 🆕🆕🆕 D643 — 47 → 48 🆕🆕🆕 D646 — 48 → 49.
    expect(load.record.state.players.p1.trainerFlipLockTurn).toBeNull();
    expect(slot.puts).toHaveLength(1);
  });
});
