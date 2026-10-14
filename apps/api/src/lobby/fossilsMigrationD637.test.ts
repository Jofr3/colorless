// 🆕🆕🆕 D637 — MATCH_RECORD_VERSION 45 → 46, THE FIFTH MIGRATION (match.ts "45 → 46 AT D637"): the four `me` Antique
// Fossils join `FOSSIL_IDS`, so a uid of a NEW id can sit in an in-play stack (D576's twelfth position). No key is added:
// a v45 record is migrated by a re-stamp alone, with no D1 read, and skips every earlier step. A v44 record takes
// D636's step, a v43 two, a v42 three, a v41 all four.

import { applyAction, type GameState, type InPlayPokemon, type Seat } from "@luminous/engine";
import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  FOSSILS_MIGRATABLE_MATCH_RECORD_VERSION,
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

const BODY = "d637-body";
const JAW = "me03-068"; // Antique Jaw Fossil — a real `FOSSIL_IDS` id since D637
const HIT = 50;
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "D637 Body",
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
  imageUrl: null,
  suffix: null,
} as unknown as Card;
/** The catalog row as a v45 pool holds it (D581's ingest keeps the printed face). */
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

const DECK = [...Array.from({ length: 56 }, () => BODY), JAW, JAW, JAW, JAW];
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
function fresh(seed = 6370): GameState {
  const created = startMatch({
    seed,
    hostDeck: DECK,
    guestDeck: DECK,
    cardPool: { [BODY]: BODY_CARD, [JAW]: JAW_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

/** A record as an older deploy wrote it. v45 is this build's bytes (no key was added); v44 also lacks D636's keys;
    v43 D630's too; v42 D621's too; v41 is the D583-refreshed shape below that. */
function oldRecord(version: 41 | 42 | 43 | 44 | 45, state?: GameState): MatchRecord {
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
  return { version, seed: 6370, startedAt: 1_000, names: NAMES, state: old, log: [] };
}

describe("D637 — the version and the gate", () => {
  it("MATCH_RECORD_VERSION is 46 (🆕🆕🆕 47 since D640; 🆕🆕🆕 48 since D643; 🆕🆕🆕 49 since D646); v41 pool-migrated, v42 side-key-, v43 record-key-, v44 lock-key-migrated, v45 re-stamped (🆕🆕🆕 D640: and v46 re-stamped, prizeStageMigrationD640.test.ts; 🆕🆕🆕 D643: and v47 re-stamped, toolTrimMigrationD643.test.ts; 🆕🆕🆕 D646: and v48 re-stamped, coinRedoMigrationD646.test.ts)", () => {
    expect(MATCH_RECORD_VERSION).toBe(49); // 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(MIGRATABLE_MATCH_RECORD_VERSION).toBe(41);
    expect(SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(42);
    expect(RECORD_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(43);
    expect(LOCK_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(44);
    expect(FOSSILS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(45);
  });

  it("a v45 record is not read as-is; it is migrated with no pool ids (D1 is not asked)", () => {
    const old = oldRecord(45);
    expect(readMatchRecord(old)).toBeNull();
    expect(migratablePoolIdsOf(old)).toEqual([]);
    expect(readMatchRecord({ ...old, version: 49 })).not.toBeNull(); // 🆕🆕🆕 D640 — 47 is this build's own 🆕🆕🆕 D643 — 48 is. 🆕🆕🆕 D646 — 49 is.
  });

  it("v40 and v47 (🆕🆕🆕 D640 (D539): v48 — v47 is this build's own; 🆕🆕🆕 D643 (D539): v49 — v48 is; 🆕🆕🆕 D646 (D539): v50 — v49 is) are neither read nor migrated; a v45 record missing its players or its log is not migrated", () => {
    const old = oldRecord(45);
    for (const version of [40, 50]) { // 🆕🆕🆕 D643 — 48 is this build's own 🆕🆕🆕 D646 — 49 is.
      expect(readMatchRecord({ ...old, version })).toBeNull();
      expect(migratablePoolIdsOf({ ...old, version })).toBeNull();
      expect(migrateMatchRecord({ ...old, version }, {})).toBeNull();
    }
    expect(migrateMatchRecord({ ...old, state: { ...old.state, players: null } }, {})).toBeNull();
    expect(migrateMatchRecord({ ...old, log: undefined }, {})).toBeNull();
  });
});

describe("D637 — what the migration writes", () => {
  it("v45: the version and nothing else — every byte of the state kept, the pool unread", () => {
    const board = p1Turn(fresh());
    const old = oldRecord(45, board);
    const migrated = migrateMatchRecord(old, { [JAW]: { ...JAW_CARD, name: "stale" } as Card });
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.version).toBe(49); // 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(readMatchRecord(migrated)).not.toBeNull();
    expect(migrated.state).toEqual(board);
    expect(migrated.state.cardPool[JAW]).toBe(old.state.cardPool[JAW]);
    expect({ ...migrated, version: 45 }).toEqual(old);
  });

  it("a live v45 lock is NOT re-nulled: D636's step does not run on a v45 record", () => {
    const board = p1Turn(fresh());
    const active = board.players.p2.active as InPlayPokemon;
    const live: GameState = {
      ...board,
      players: {
        ...board.players,
        p1: { ...board.players.p1, trainerFlipLockTurn: board.turn },
        p2: { ...board.players.p2, active: { ...active, attackTwoFlipLockTurn: board.turn, benchedTurn: 1 } },
      },
      handPlayLockedTurn: { ...board.handPlayLockedTurn, p1: { ...board.handPlayLockedTurn.p1, Stadium: board.turn } },
    };
    const migrated = migrateMatchRecord(oldRecord(45, live), {});
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.state.players.p1.trainerFlipLockTurn).toBe(board.turn);
    expect(migrated.state.players.p2.active?.attackTwoFlipLockTurn).toBe(board.turn);
    expect(migrated.state.players.p2.active?.benchedTurn).toBe(1);
    expect(migrated.state.handPlayLockedTurn.p1.Stadium).toBe(board.turn);
  });

  it("v44: D636's keys; v43, v42 and v41: the earlier steps too — every one lands at v46 (🆕🆕🆕 v47 since D640; 🆕🆕🆕 v48 since D643; 🆕🆕🆕 v49 since D646)", () => {
    for (const version of [44, 43, 42, 41] as const) {
      const migrated = migrateMatchRecord(oldRecord(version), { [JAW]: JAW_CARD });
      if (migrated === null) throw new Error(`v${version} not migrated`);
      expect(migrated.version).toBe(49); // 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
      expect(readMatchRecord(migrated)).not.toBeNull();
      expect(migrated.state.players.p1.trainerFlipLockTurn).toBeNull();
      expect(migrated.state.handPlayLockedTurn.p2.Stadium).toBeNull();
      if (version <= 43) expect(migrated.state.players.p1.prizesTakenOnTurn).toBeNull();
      if (version <= 42) expect(migrated.state.players.p2.chosenAttackShield).toBeNull();
    }
  });

  it("does not touch the record it was given", () => {
    const old = oldRecord(45, p1Turn(fresh()));
    const before = JSON.stringify(old);
    migrateMatchRecord(old, {});
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("D637 — on a board: the migrated v45 record plays a `me` fossil", () => {
  it("an Antique Jaw Fossil in a v45 hand is benched as a 60-HP body after the migration", () => {
    let board = p1Turn(fresh());
    const side = board.players.p1;
    const jaw = side.deck.find((u) => board.cardIdByUid[u] === JAW) ?? side.hand.find((u) => board.cardIdByUid[u] === JAW);
    if (jaw === undefined) throw new Error("no Antique Jaw Fossil");
    board = {
      ...board,
      players: {
        ...board.players,
        p1: { ...side, deck: side.deck.filter((u) => u !== jaw), hand: [...side.hand.filter((u) => u !== jaw), jaw] },
      },
    };
    const migrated = migrateMatchRecord(oldRecord(45, board), {});
    if (migrated === null) throw new Error("not migrated");
    const played = applyAction(migrated.state, { type: "playTrainer", seat: "p1", uid: jaw });
    if (!played.ok) throw new Error(played.error.code);
    const benched = played.state.players.p1.bench.find((b) => b.stack[0] === jaw);
    expect(benched?.stack).toEqual([jaw]);
    expect(played.state.players.p1.hand).not.toContain(jaw);
  });

  it("the migrated state attacks, and the hit lands", () => {
    const migrated = migrateMatchRecord(oldRecord(45, p1Turn(fresh())), {});
    if (migrated === null) throw new Error("not migrated");
    const hit = applyAction(migrated.state, { type: "attack", seat: "p1", index: 0 });
    if (!hit.ok) throw new Error(hit.error.code);
    expect(hit.state.players.p2.active?.damage).toBe(HIT);
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

describe("D637 — the DO's read migrates a v45 record without asking D1", () => {
  it("a v45 record: written once as v46 (🆕🆕🆕 v47 since D640; 🆕🆕🆕 v48 since D643; 🆕🆕🆕 v49 since D646), D1 never asked; the next read is plain", async () => {
    const { slot, api } = fakeSlot(oldRecord(45));
    const never = async (): Promise<Record<string, Card>> => {
      throw new Error("D1 asked");
    };
    const load = await loadMatchRecord(api, never);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(49); // 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(slot.puts).toEqual([load.record]);
    expect((await loadMatchRecord(api, never)).kind).toBe("ok");
    expect(slot.puts).toHaveLength(1);
  });

  it("a v41 record still asks D1 for its pool, and lands at v46 (🆕🆕🆕 v47 since D640; 🆕🆕🆕 v48 since D643; 🆕🆕🆕 v49 since D646) with every key", async () => {
    const { slot, api } = fakeSlot(oldRecord(41));
    const asked: string[][] = [];
    const load = await loadMatchRecord(api, async (ids) => {
      asked.push([...ids].sort());
      return { [JAW]: JAW_CARD };
    });
    expect(asked).toEqual([[BODY, JAW].sort()]);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(49); // 🆕🆕🆕 D640 — 46 → 47 🆕🆕🆕 D643 — 47 → 48. 🆕🆕🆕 D646 — 48 → 49.
    expect(load.record.state.players.p1.trainerFlipLockTurn).toBeNull();
    expect(slot.puts).toHaveLength(1);
  });
});
