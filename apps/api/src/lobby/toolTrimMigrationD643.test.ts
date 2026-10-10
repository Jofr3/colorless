// 🆕🆕🆕 D643 — MATCH_RECORD_VERSION 47 → 48, THE SEVENTH MIGRATION (match.ts "47 → 48 AT D643"): Multi Adapter's
// `PendingStage` `toolTrim`, its parked `EffectOp` `trimTools` and a two-Tool `InPlayPokemon.tools` are all persisted
// shapes a 0.525 rollback misreads. No v47 writer could write any of them, so a v47 record is migrated by a re-stamp
// alone (no D1 read), as a v45 or v46 one is; a v44 record takes D636's step, a v43 two, a v42 three, a v41 all four.

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
  PRIZE_STAGE_MIGRATABLE_MATCH_RECORD_VERSION,
  RECORD_KEYS_MIGRATABLE_MATCH_RECORD_VERSION,
  readMatchRecord,
  SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION,
  startMatch,
  TOOL_TRIM_MIGRATABLE_MATCH_RECORD_VERSION,
} from "./match";

const BODY = "d643-body";
const ROTOM_ID = "me02-029"; // Rotom ex "Multi Adapter" — read since D643
const BAND = "sv01-197"; // Vitality Band
const CHARM = "sv02-173"; // Bravery Charm
const JAW = "me03-068"; // Antique Jaw Fossil — kept so the earlier steps run over the same pool
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "D643 Body",
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
  imageUrl: null,
  suffix: null,
} as unknown as Card;
const MULTI_ADAPTER_TEXT =
  'Each of your Pokémon that has "Rotom" in its name may have up to 2 Pokémon Tool cards attached. If this Ability goes away, discard Pokémon Tools from those Pokémon until only 1 remains on each.';
/** The catalog row a v47 pool holds — the printed face; only this build reads its Ability. */
const ROTOM_CARD: Card = {
  ...BODY_CARD,
  id: ROTOM_ID,
  setId: "me02",
  localId: "029",
  name: "Rotom ex",
  hp: 190,
  types: ["Lightning"],
  retreat: 1,
  suffix: "EX",
  abilities: [{ type: "Ability", name: "Multi Adapter", effect: MULTI_ADAPTER_TEXT }],
  attacks: [{ cost: ["Lightning", "Colorless"], name: "Thunderbolt", damage: "130", effect: "Discard all Energy from this Pokémon." }],
} as unknown as Card;
const tool = (id: string, name: string, effect: string): Card =>
  ({ ...BODY_CARD, id, name, category: "Trainer", hp: null, stage: null, types: null, attacks: null, trainerType: "Tool", effect }) as unknown as Card;
const BAND_CARD = tool(BAND, "Vitality Band", "The attacks of the Pokémon this card is attached to do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).");
const CHARM_CARD = tool(CHARM, "Bravery Charm", "The Basic Pokémon this card is attached to gets +50 HP.");
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

const DECK = [
  ...Array.from({ length: 48 }, () => BODY),
  ROTOM_ID,
  ROTOM_ID,
  BAND,
  BAND,
  BAND,
  CHARM,
  CHARM,
  CHARM,
  JAW,
  JAW,
  JAW,
  JAW,
];
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
function fresh(seed = 6430): GameState {
  const created = startMatch({
    seed,
    hostDeck: DECK,
    guestDeck: DECK,
    cardPool: { [BODY]: BODY_CARD, [ROTOM_ID]: ROTOM_CARD, [BAND]: BAND_CARD, [CHARM]: CHARM_CARD, [JAW]: JAW_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

/** A record as an older deploy wrote it. v47, v46 and v45 are this build's bytes (no key was added at any); v44 also
    lacks D636's keys; v43 D630's too; v42 D621's too; v41 is the D583-refreshed shape below that. */
function oldRecord(version: 41 | 42 | 43 | 44 | 45 | 46 | 47, state?: GameState): MatchRecord {
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
  return { version, seed: 6430, startedAt: 1_000, names: NAMES, state: old, log: [] };
}

describe("D643 — the version and the gate", () => {
  it("MATCH_RECORD_VERSION is 48; v41 pool-migrated, v42 side-key-, v43 record-key-, v44 lock-key-migrated, v45, v46 and v47 re-stamped", () => {
    expect(MATCH_RECORD_VERSION).toBe(48);
    expect(MIGRATABLE_MATCH_RECORD_VERSION).toBe(41);
    expect(SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(42);
    expect(RECORD_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(43);
    expect(LOCK_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(44);
    expect(FOSSILS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(45);
    expect(PRIZE_STAGE_MIGRATABLE_MATCH_RECORD_VERSION).toBe(46);
    expect(TOOL_TRIM_MIGRATABLE_MATCH_RECORD_VERSION).toBe(47);
  });

  it("a v47 record is not read as-is; it is migrated with no pool ids (D1 is not asked)", () => {
    const old = oldRecord(47);
    expect(readMatchRecord(old)).toBeNull();
    expect(migratablePoolIdsOf(old)).toEqual([]);
    expect(readMatchRecord({ ...old, version: 48 })).not.toBeNull();
  });

  it("v40 and v49 are neither read nor migrated; a v47 record missing its players or its log is not migrated", () => {
    const old = oldRecord(47);
    for (const version of [40, 49]) {
      expect(readMatchRecord({ ...old, version })).toBeNull();
      expect(migratablePoolIdsOf({ ...old, version })).toBeNull();
      expect(migrateMatchRecord({ ...old, version }, {})).toBeNull();
    }
    expect(migrateMatchRecord({ ...old, state: { ...old.state, players: null } }, {})).toBeNull();
    expect(migrateMatchRecord({ ...old, log: undefined }, {})).toBeNull();
  });
});

describe("D643 — what the migration writes", () => {
  it("v47: the version and nothing else — every byte of the state kept, the pool unread", () => {
    const board = p1Turn(fresh());
    const old = oldRecord(47, board);
    const migrated = migrateMatchRecord(old, { [ROTOM_ID]: { ...ROTOM_CARD, name: "stale" } as Card });
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.version).toBe(48);
    expect(readMatchRecord(migrated)).not.toBeNull();
    expect(migrated.state).toEqual(board);
    expect(migrated.state.cardPool[ROTOM_ID]).toBe(old.state.cardPool[ROTOM_ID]);
    expect({ ...migrated, version: 47 }).toEqual(old);
  });

  it("a live lock is kept as written: no key is added, no earlier step runs", () => {
    const board = p1Turn(fresh());
    const active = board.players.p2.active as InPlayPokemon;
    const live: GameState = {
      ...board,
      players: {
        ...board.players,
        p1: { ...board.players.p1, trainerFlipLockTurn: board.turn },
        p2: { ...board.players.p2, active: { ...active, benchedTurn: 1 } },
      },
    };
    const migrated = migrateMatchRecord(oldRecord(47, live), {});
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.state.players.p2.active?.benchedTurn).toBe(1);
    expect(migrated.state.players.p1.trainerFlipLockTurn).toBe(board.turn);
  });

  it("v46 and v45: re-stamped too; v44: D636's keys; v43, v42 and v41: the earlier steps too — every one lands at v48", () => {
    for (const version of [46, 45] as const) {
      const migrated = migrateMatchRecord(oldRecord(version), {});
      expect(migrated?.version).toBe(48);
      expect({ ...migrated, version }).toEqual(oldRecord(version));
    }
    for (const version of [44, 43, 42, 41] as const) {
      const migrated = migrateMatchRecord(oldRecord(version), { [JAW]: JAW_CARD, [ROTOM_ID]: ROTOM_CARD });
      if (migrated === null) throw new Error(`v${version} not migrated`);
      expect(migrated.version).toBe(48);
      expect(readMatchRecord(migrated)).not.toBeNull();
      expect(migrated.state.players.p1.trainerFlipLockTurn).toBeNull();
      expect(migrated.state.handPlayLockedTurn.p2.Stadium).toBeNull();
      if (version <= 43) expect(migrated.state.players.p1.prizesTakenOnTurn).toBeNull();
      if (version <= 42) expect(migrated.state.players.p2.chosenAttackShield).toBeNull();
    }
  });

  it("does not touch the record it was given", () => {
    const old = oldRecord(47, p1Turn(fresh()));
    const before = JSON.stringify(old);
    migrateMatchRecord(old, {});
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("D643 — on a board: the migrated v47 record plays Multi Adapter", () => {
  it("a Rotom ex in the Active Spot of a migrated v47 record takes a second Tool", () => {
    let board = p1Turn(fresh());
    const side = board.players.p1;
    const pick = (id: string, not: readonly string[] = []) => {
      const uid = [...side.deck, ...side.hand].find((u) => board.cardIdByUid[u] === id && !not.includes(u));
      if (uid === undefined) throw new Error(`no ${id}`);
      return uid;
    };
    const rotom = pick(ROTOM_ID);
    const band = pick(BAND);
    const charm = pick(CHARM);
    if (side.active === null) throw new Error("no Active");
    const moved = [rotom, band, charm];
    board = {
      ...board,
      players: {
        ...board.players,
        p1: {
          ...side,
          deck: [...side.deck.filter((u) => !moved.includes(u)), ...side.active.stack],
          hand: [...side.hand.filter((u) => !moved.includes(u)), charm],
          active: { ...side.active, stack: [rotom], tools: [band] },
        },
      },
    };
    const migrated = migrateMatchRecord(oldRecord(47, board), {});
    if (migrated === null) throw new Error("not migrated");
    const attached = applyAction(migrated.state, { type: "attachTool", seat: "p1", uid: charm, target: { spot: "active" } });
    if (!attached.ok) throw new Error(attached.error.code);
    expect(attached.state.players.p1.active?.tools).toEqual([band, charm]);
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

describe("D643 — the DO's read migrates a v47 record without asking D1", () => {
  it("a v47 record: written once as v48, D1 never asked; the next read is plain", async () => {
    const { slot, api } = fakeSlot(oldRecord(47));
    const never = async (): Promise<Record<string, Card>> => {
      throw new Error("D1 asked");
    };
    const load = await loadMatchRecord(api, never);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(48);
    expect(slot.puts).toEqual([load.record]);
    expect((await loadMatchRecord(api, never)).kind).toBe("ok");
    expect(slot.puts).toHaveLength(1);
  });

  it("a v41 record still asks D1 for its pool, and lands at v48 with every key", async () => {
    const { slot, api } = fakeSlot(oldRecord(41));
    const asked: string[][] = [];
    const load = await loadMatchRecord(api, async (ids) => {
      asked.push([...ids].sort());
      return { [JAW]: JAW_CARD, [ROTOM_ID]: ROTOM_CARD };
    });
    expect(asked).toEqual([[BODY, ROTOM_ID, BAND, CHARM, JAW].sort()]);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(48);
    expect(load.record.state.players.p1.trainerFlipLockTurn).toBeNull();
    expect(slot.puts).toHaveLength(1);
  });
});
