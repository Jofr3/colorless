import { applyAction, type EffectOp, type GameState } from "@colorless/engine";
import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  COIN_REDO_MIGRATABLE_MATCH_RECORD_VERSION,
  GATE_OPS_MIGRATABLE_MATCH_RECORD_VERSION,
  loadMatchRecord,
  MATCH_RECORD_VERSION,
  type MatchRecord,
  type MatchSlot,
  migratablePoolIdsOf,
  migrateMatchRecord,
  readMatchRecord,
  startMatch,
} from "./match";

const BODY = "gate-body";
const ASKER = "gate-asker";
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "Gate Body",
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
const ASKER_CARD: Card = {
  ...BODY_CARD,
  id: ASKER,
  name: "Gate Asker",
  attacks: [{ cost: [], name: "Ask", damage: "", effect: "You may draw 3 cards." }],
} as unknown as Card;

const DECK = [...Array.from({ length: 56 }, () => BODY), ASKER, ASKER, ASKER, ASKER];
const NAMES = { p1: "Ana", p2: "Bo" } as const;
const GATES = new Set(["coinFlipGate", "conditionGate", "recordGate", "optional"]);

function must(state: GameState, action: Parameters<typeof applyAction>[1]): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result.state;
}

function fresh(seed: number): GameState {
  const created = startMatch({
    seed,
    hostDeck: DECK,
    guestDeck: DECK,
    cardPool: { [BODY]: BODY_CARD, [ASKER]: ASKER_CARD },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

/** Setup through the action API, then p1's first turn with an Asker as its Active. */
function p1Turn(seed: number): GameState {
  let state = fresh(seed);
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
  state = must(state, { type: "endTurn", seat: "p2" });
  const side = state.players.p1;
  const asker = [...side.deck, ...side.hand].find((u) => state.cardIdByUid[u] === ASKER);
  if (asker === undefined || side.active === null) throw new Error("no Asker");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: [...side.deck.filter((u) => u !== asker), ...side.active.stack],
        hand: side.hand.filter((u) => u !== asker),
        active: { ...side.active, stack: [asker] },
      },
    },
  };
}

const NO_ENERGY = { kind: "noEnergyOnYourPokemon" } as const;

/**
 * The Asker's confirm, parked, with its yes arm replaced by a coin gate inside a condition gate and
 * one more gate left in the continuation's rest.
 */
function parkedWithNestedGates(seed: number): GameState {
  const parked = must(p1Turn(seed), { type: "attack", seat: "p1", index: 0 });
  const phase = parked.phase;
  if (phase.kind !== "effect:choose" || phase.cont.pendingOp.op !== "optional") {
    throw new Error("expected the confirm to park");
  }
  const coin: EffectOp = {
    op: "coinFlipGate",
    ops: [{ op: "drawCards", count: 3 }],
    otherwise: [{ op: "drawCards", count: 1 }],
  };
  const cond: EffectOp = { op: "conditionGate", cond: NO_ENERGY, ops: [coin] };
  const tail: EffectOp = {
    op: "conditionGate",
    cond: { kind: "stadiumInPlay" },
    ops: [],
    otherwise: [{ op: "drawCards", count: 1 }],
  };
  return {
    ...parked,
    phase: {
      ...phase,
      cont: {
        ...phase.cont,
        pendingOp: { ...phase.cont.pendingOp, ops: [cond] },
        rest: [tail, ...phase.cont.rest],
      },
    },
  };
}

/** The bytes a v49 deploy wrote for `value`: every gate's `ops` spelled `then`, in place. */
function asV49(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asV49);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  const gate = typeof object.op === "string" && GATES.has(object.op);
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      gate && key === "ops" ? "then" : key,
      asV49(item),
    ]),
  );
}

function v49Record(state: GameState): MatchRecord {
  return {
    version: GATE_OPS_MIGRATABLE_MATCH_RECORD_VERSION,
    seed: 4900,
    startedAt: 1_000,
    names: NAMES,
    state: asV49(state) as GameState,
    log: [],
  };
}

function migrated(record: unknown): MatchRecord {
  const out = migrateMatchRecord(record, {});
  if (out === null) throw new Error("not migrated");
  return out;
}

describe("gate ops `then` → `ops`: the version and the gate", () => {
  it("MATCH_RECORD_VERSION is 50 and v49 is the newest migratable version", () => {
    expect(MATCH_RECORD_VERSION).toBe(50);
    expect(GATE_OPS_MIGRATABLE_MATCH_RECORD_VERSION).toBe(49);
    expect(COIN_REDO_MIGRATABLE_MATCH_RECORD_VERSION).toBe(48);
  });

  it("a v49 record is not read as-is; it is migrated with no pool ids", () => {
    const old = v49Record(parkedWithNestedGates(4901));
    expect(readMatchRecord(old)).toBeNull();
    expect(migratablePoolIdsOf(old)).toEqual([]);
    expect(migratablePoolIdsOf({ ...old, version: 51 })).toBeNull();
  });
});

describe("gate ops `then` → `ops`: what the migration writes", () => {
  it("renames every nested gate in a parked continuation, byte for byte and key order kept", () => {
    const current = parkedWithNestedGates(4902);
    const old = v49Record(current);
    expect(JSON.stringify(old.state)).toContain('"then":');
    const out = migrated(old);
    expect(out.version).toBe(50);
    expect(readMatchRecord(out)).not.toBeNull();
    expect(JSON.stringify(out.state)).toBe(JSON.stringify(current));
    expect(JSON.stringify(out.state)).not.toContain('"then":');
  });

  it("every older migratable version gets the rename too", () => {
    const current = parkedWithNestedGates(4903);
    for (const version of [41, 44, 48]) {
      const out = migrated({ ...v49Record(current), version });
      expect(out.version).toBe(50);
      expect(out.state.phase).toEqual(current.phase);
    }
  });

  it("leaves a `then` key alone on an object that is not a gate op", () => {
    const current = parkedWithNestedGates(4904);
    const old = v49Record(current);
    // Parsed, as the stored bytes would be: a `then` key with no gate `op` beside it.
    const extras = JSON.parse(
      '{"plain":{"then":[{"op":"drawCards","count":1}]},' +
        '"notGate":{"op":"drawCards","count":1,"then":[{"op":"drawCards","count":2}]},' +
        '"tagged":{"kind":"optional","then":[]}}',
    ) as Record<string, unknown>;
    const card = { ...old.state.cardPool[BODY], ...extras } as unknown as Card;
    const withExtras = {
      ...old,
      state: { ...old.state, cardPool: { ...old.state.cardPool, [BODY]: card } },
    };
    const out = migrated(withExtras);
    expect(out.state.cardPool[BODY]).toBe(card);
    expect(JSON.stringify(out.state.phase)).toBe(JSON.stringify(current.phase));
  });

  it("copies only what it renames and does not touch the record it was given", () => {
    const old = v49Record(parkedWithNestedGates(4905));
    const before = JSON.stringify(old);
    const out = migrated(old);
    expect(JSON.stringify(old)).toBe(before);
    expect(out.state.cardPool).toBe(old.state.cardPool);
    expect(out.state.players).toBe(old.state.players);
    expect(out.state.phase).not.toBe(old.state.phase);
  });

  it("a v49 state without a gate comes back as the same object", () => {
    const board = p1Turn(4906);
    const old = v49Record(board);
    expect(migrated(old).state).toBe(old.state);
  });
});

describe("gate ops `then` → `ops`: the migrated record plays on", () => {
  it("answering the confirm runs both nested gates and the tail exactly as on a fresh record", () => {
    const heads = new Set<number>();
    for (const seed of [4910, 4911, 4912, 4913, 4914, 4915, 4916, 4917]) {
      const current = parkedWithNestedGates(seed);
      const reread = readMatchRecord(JSON.parse(JSON.stringify(migrated(v49Record(current)))));
      if (reread === null) throw new Error("not read");
      const yes = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } };
      const fromMigrated = applyAction(reread.state, yes as Parameters<typeof applyAction>[1]);
      const fromCurrent = applyAction(current, yes as Parameters<typeof applyAction>[1]);
      if (!fromMigrated.ok || !fromCurrent.ok) throw new Error("confirm rejected");
      expect(fromMigrated.state).toEqual(fromCurrent.state);
      expect(fromMigrated.events).toEqual(fromCurrent.events);
      const drawn = fromMigrated.state.players.p1.hand.length - current.players.p1.hand.length;
      expect([4, 2]).toContain(drawn);
      heads.add(drawn);
    }
    expect(heads).toEqual(new Set([4, 2]));
  });

  it("the unmigrated v49 bytes cannot be resumed by this engine", () => {
    const old = v49Record(parkedWithNestedGates(4920));
    const yes = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } };
    expect(() => applyAction(old.state, yes as Parameters<typeof applyAction>[1])).toThrow();
  });
});

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

describe("gate ops `then` → `ops`: the DO's read", () => {
  it("a v49 record is written back once as v50 without asking D1; the next read is plain", async () => {
    const current = parkedWithNestedGates(4930);
    const { slot, api } = fakeSlot(v49Record(current));
    const never = async (): Promise<Record<string, Card>> => {
      throw new Error("D1 asked");
    };
    const load = await loadMatchRecord(api, never);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(50);
    expect(load.record.state.phase).toEqual(current.phase);
    expect(slot.puts).toEqual([load.record]);
    expect((await loadMatchRecord(api, never)).kind).toBe("ok");
    expect(slot.puts).toHaveLength(1);
  });
});
