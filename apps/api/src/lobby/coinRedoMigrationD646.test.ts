import { applyAction, type GameState, type InPlayPokemon, type Seat } from "@colorless/engine";
import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  COIN_REDO_MIGRATABLE_MATCH_RECORD_VERSION,
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

const BODY = "d646-body";
const FLIPPER = "d646-flipper"; // {C}: "Flip a coin. If tails, this attack does nothing."
const BADGE = "me05-074";
const JAW = "me03-068"; // Antique Jaw Fossil — kept so the earlier steps run over the same pool
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "D646 Body",
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
const FLIPPER_CARD: Card = {
  ...BODY_CARD,
  id: FLIPPER,
  name: "D646 Flipper",
  attacks: [
    {
      cost: [],
      name: "Hyper Fang",
      damage: "30",
      effect: "Flip a coin. If tails, this attack does nothing.",
    },
  ],
} as unknown as Card;
const BADGE_CARD: Card = {
  ...BODY_CARD,
  id: BADGE,
  setId: "me05",
  localId: "074",
  name: "Backtrack Badge",
  category: "Trainer",
  hp: null,
  stage: null,
  types: null,
  attacks: null,
  trainerType: "Tool",
  effect:
    "Once during your turn, after you flip any coins for an attack of the {C} Pokémon this card is attached to, you may ignore all results of those coin flips and begin flipping those coins again.",
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
  ...Array.from({ length: 50 }, () => BODY),
  FLIPPER,
  FLIPPER,
  BADGE,
  BADGE,
  BADGE,
  BADGE,
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
function fresh(seed = 6460): GameState {
  const created = startMatch({
    seed,
    hostDeck: DECK,
    guestDeck: DECK,
    cardPool: { [BODY]: BODY_CARD, [FLIPPER]: FLIPPER_CARD, [BADGE]: BADGE_CARD, [JAW]: JAW_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

function oldRecord(version: 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48, state?: GameState): MatchRecord {
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
  return { version, seed: 6460, startedAt: 1_000, names: NAMES, state: old, log: [] };
}

describe("D646 — the version and the gate", () => {
  it("MATCH_RECORD_VERSION is 49; v41 pool-migrated, v42 side-key-, v43 record-key-, v44 lock-key-migrated, v45, v46, v47 and v48 re-stamped", () => {
    expect(MATCH_RECORD_VERSION).toBe(49);
    expect(MIGRATABLE_MATCH_RECORD_VERSION).toBe(41);
    expect(SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(42);
    expect(RECORD_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(43);
    expect(LOCK_KEYS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(44);
    expect(FOSSILS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(45);
    expect(PRIZE_STAGE_MIGRATABLE_MATCH_RECORD_VERSION).toBe(46);
    expect(TOOL_TRIM_MIGRATABLE_MATCH_RECORD_VERSION).toBe(47);
    expect(COIN_REDO_MIGRATABLE_MATCH_RECORD_VERSION).toBe(48);
  });

  it("a v48 record is not read as-is; it is migrated with no pool ids (D1 is not asked)", () => {
    const old = oldRecord(48);
    expect(readMatchRecord(old)).toBeNull();
    expect(migratablePoolIdsOf(old)).toEqual([]);
    expect(readMatchRecord({ ...old, version: 49 })).not.toBeNull();
  });

  it("v40 and v50 are neither read nor migrated; a v48 record missing its players or its log is not migrated", () => {
    const old = oldRecord(48);
    for (const version of [40, 50]) {
      expect(readMatchRecord({ ...old, version })).toBeNull();
      expect(migratablePoolIdsOf({ ...old, version })).toBeNull();
      expect(migrateMatchRecord({ ...old, version }, {})).toBeNull();
    }
    expect(migrateMatchRecord({ ...old, state: { ...old.state, players: null } }, {})).toBeNull();
    expect(migrateMatchRecord({ ...old, log: undefined }, {})).toBeNull();
  });
});

describe("D646 — what the migration writes", () => {
  it("v48: the version and nothing else — every byte of the state kept, the pool unread", () => {
    const board = p1Turn(fresh());
    const old = oldRecord(48, board);
    const migrated = migrateMatchRecord(old, { [BADGE]: { ...BADGE_CARD, name: "stale" } as Card });
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.version).toBe(49);
    expect(readMatchRecord(migrated)).not.toBeNull();
    expect(migrated.state).toEqual(board);
    expect(migrated.state.cardPool[BADGE]).toBe(old.state.cardPool[BADGE]);
    expect({ ...migrated, version: 48 }).toEqual(old);
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
    const migrated = migrateMatchRecord(oldRecord(48, live), {});
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.state.players.p2.active?.benchedTurn).toBe(1);
    expect(migrated.state.players.p1.trainerFlipLockTurn).toBe(board.turn);
  });

  it("v47, v46 and v45: re-stamped too; v44: D636's keys; v43, v42 and v41: the earlier steps too — every one lands at v49", () => {
    for (const version of [47, 46, 45] as const) {
      const migrated = migrateMatchRecord(oldRecord(version), {});
      expect(migrated?.version).toBe(49);
      expect({ ...migrated, version }).toEqual(oldRecord(version));
    }
    for (const version of [44, 43, 42, 41] as const) {
      const migrated = migrateMatchRecord(oldRecord(version), {
        [JAW]: JAW_CARD,
        [BADGE]: BADGE_CARD,
      });
      if (migrated === null) throw new Error(`v${version} not migrated`);
      expect(migrated.version).toBe(49);
      expect(readMatchRecord(migrated)).not.toBeNull();
      expect(migrated.state.players.p1.trainerFlipLockTurn).toBeNull();
      expect(migrated.state.handPlayLockedTurn.p2.Stadium).toBeNull();
      if (version <= 43) expect(migrated.state.players.p1.prizesTakenOnTurn).toBeNull();
      if (version <= 42) expect(migrated.state.players.p2.chosenAttackShield).toBeNull();
    }
  });

  it("does not touch the record it was given", () => {
    const old = oldRecord(48, p1Turn(fresh()));
    const before = JSON.stringify(old);
    migrateMatchRecord(old, {});
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("D646 — on a board: the migrated v48 record plays Backtrack Badge", () => {
  it("a {C} Active wearing a Badge in a migrated v48 record parks the re-flip offer after its coin, and either answer resolves", () => {
    let board = p1Turn(fresh());
    const side = board.players.p1;
    const pick = (id: string) => {
      const uid = [...side.deck, ...side.hand].find((u) => board.cardIdByUid[u] === id);
      if (uid === undefined) throw new Error(`no ${id}`);
      return uid;
    };
    const flipper = pick(FLIPPER);
    const badge = pick(BADGE);
    if (side.active === null) throw new Error("no Active");
    const moved = [flipper, badge];
    board = {
      ...board,
      players: {
        ...board.players,
        p1: {
          ...side,
          deck: [...side.deck.filter((u) => !moved.includes(u)), ...side.active.stack],
          hand: side.hand.filter((u) => !moved.includes(u)),
          active: { ...side.active, stack: [flipper], tools: [badge] },
        },
      },
    };
    const migrated = migrateMatchRecord(oldRecord(48, board), {});
    if (migrated === null) throw new Error("not migrated");
    const parked = applyAction(migrated.state, { type: "attack", seat: "p1", index: 0 });
    if (!parked.ok) throw new Error(parked.error.code);
    expect(parked.state.phase.kind).toBe("effect:choose");
    if (parked.state.phase.kind !== "effect:choose") return;
    expect(parked.state.phase.cont.pendingOp.op).toBe("reflipAttackCoins");
    // The park survives the record's own JSON round trip and answers on the far side.
    const reread = readMatchRecord(
      JSON.parse(JSON.stringify({ ...oldRecord(48, parked.state), version: 49 })),
    );
    if (reread === null) throw new Error("not read");
    for (const yes of [false, true]) {
      const answered = applyAction(reread.state, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "confirm", yes },
      });
      if (!answered.ok) throw new Error(answered.error.code);
      expect(answered.state.phase.kind).not.toBe("effect:choose");
      expect(answered.events.filter((e) => e.type === "COINS_REFLIPPED")).toHaveLength(yes ? 1 : 0);
    }
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

describe("D646 — the DO's read migrates a v48 record without asking D1", () => {
  it("a v48 record: written once as v49, D1 never asked; the next read is plain", async () => {
    const { slot, api } = fakeSlot(oldRecord(48));
    const never = async (): Promise<Record<string, Card>> => {
      throw new Error("D1 asked");
    };
    const load = await loadMatchRecord(api, never);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(49);
    expect(slot.puts).toEqual([load.record]);
    expect((await loadMatchRecord(api, never)).kind).toBe("ok");
    expect(slot.puts).toHaveLength(1);
  });

  it("a v41 record still asks D1 for its pool, and lands at v49 with every key", async () => {
    const { slot, api } = fakeSlot(oldRecord(41));
    const asked: string[][] = [];
    const load = await loadMatchRecord(api, async (ids) => {
      asked.push([...ids].sort());
      return { [JAW]: JAW_CARD, [BADGE]: BADGE_CARD };
    });
    expect(asked).toEqual([[BODY, FLIPPER, BADGE, JAW].sort()]);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(49);
    expect(load.record.state.players.p1.trainerFlipLockTurn).toBeNull();
    expect(slot.puts).toHaveLength(1);
  });
});
