import { createGame, type GameState, isRngState, migrateGameState } from "@colorless/engine";
import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { drbgSeed, firstP1Turn, storedAt } from "@colorless/engine/testing";
import {
  loadMatchRecord,
  MATCH_RECORD_VERSION,
  type MatchRecord,
  type MatchSlot,
  migrateMatchRecord,
  readMatchRecord,
} from "./match";
import { FakeStorage } from "./lobbyHarness";
import { MATCH_KEY, MATCH_LAYOUT, MatchStore } from "./matchStore";

const BODY = "load-body";
const TRAINER = "load-trainer";
const BODY_CARD: Card = {
  id: BODY,
  setId: "test",
  localId: "1",
  name: "Load Body",
  category: "Pokemon",
  image: null,
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
  legal: { standard: true, expanded: true },
  variants: null,
};
const STALE_TRAINER: Card = {
  ...BODY_CARD,
  id: TRAINER,
  name: "Load Trainer",
  category: "Trainer",
  hp: null,
  stage: null,
  types: null,
  attacks: null,
  trainerType: "Item",
  effect: "Draw a card.",
};

/** The oldest version an older deploy's record is still migrated from; 41 is retired. */
const OLDEST_MIGRATABLE = 42;

const DECK = [...Array.from({ length: 58 }, () => BODY), TRAINER, TRAINER];
const NAMES = { p1: "Ana", p2: "Bo" } as const;

/** A match an older deploy started: on the mulberry32 generator, from a numeric seed. */
function board(): GameState {
  const created = createGame({
    seed: 5830,
    decks: { p1: DECK, p2: DECK },
    cardPool: { [BODY]: BODY_CARD, [TRAINER]: STALE_TRAINER },
  });
  if (!created.ok) throw new Error(created.error.message);
  return firstP1Turn(created.state, BODY);
}

/** A record an older deploy wrote at `version`. */
function oldRecord(version: number): MatchRecord {
  const { state } = storedAt(version, board());
  return { version, seed: 5830, startedAt: 1_000, names: NAMES, state, log: [] };
}

/** A storage slot holding `value`, recording every write. */
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

describe("loadMatchRecord — the DO's read of an older record", () => {
  it("a record at the oldest migratable version is written back once at this version, and the next read is plain", async () => {
    const { slot, api } = fakeSlot(oldRecord(OLDEST_MIGRATABLE));
    const load = await loadMatchRecord(api);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(MATCH_RECORD_VERSION);
    expect(load.record.state.players.p1.chosenAttackShield).toBeNull();
    expect(load.record.state.cardPool[TRAINER]).toEqual(STALE_TRAINER);
    expect(slot.puts).toEqual([load.record]);
    expect(await loadMatchRecord(api)).toEqual(load);
    expect(slot.puts).toHaveLength(1);
  });

  it("every migratable version is written back once", async () => {
    for (let version = OLDEST_MIGRATABLE; version < MATCH_RECORD_VERSION; version++) {
      const { slot, api } = fakeSlot(oldRecord(version));
      const load = await loadMatchRecord(api);
      if (load.kind !== "ok") throw new Error(`v${version}: expected ok, got ${load.kind}`);
      expect(load.record.version).toBe(MATCH_RECORD_VERSION);
      expect(load.record.state.players.p1.trainerFlipLockTurn).toBeNull();
      expect(slot.puts).toEqual([load.record]);
    }
  });

  it("a current record is read as-is; a retired v41 or v40 record is stale; an empty slot is none — nothing written", async () => {
    const current = migrateMatchRecord(oldRecord(OLDEST_MIGRATABLE));
    for (const [value, kind] of [
      [current, "ok"],
      [oldRecord(41), "stale"],
      [{ ...oldRecord(41), version: 40 }, "stale"],
      [undefined, "none"],
    ] as const) {
      const { slot, api } = fakeSlot(value);
      expect((await loadMatchRecord(api)).kind).toBe(kind);
      expect(slot.puts).toEqual([]);
    }
  });
});

describe("loadMatchRecord over the DO's store — a whole record from before the split", () => {
  it("migrates an older whole record, writes it back split, and the next wake reads it as current", async () => {
    for (const version of [OLDEST_MIGRATABLE, 49]) {
      const storage = new FakeStorage();
      await storage.put(MATCH_KEY, oldRecord(version));
      const load = await loadMatchRecord(new MatchStore(storage));
      if (load.kind !== "ok") throw new Error(`v${version}: expected ok, got ${load.kind}`);
      expect(load.record.version).toBe(MATCH_RECORD_VERSION);
      expect(storage.data.get(MATCH_KEY)).toMatchObject({
        layout: MATCH_LAYOUT,
        version: MATCH_RECORD_VERSION,
      });
      const woken = await loadMatchRecord(new MatchStore(storage));
      expect(woken).toEqual(load);
    }
  });

  it("reads a current whole record without writing, and an unknown or retired version as stale", async () => {
    const current = migrateMatchRecord(oldRecord(OLDEST_MIGRATABLE));
    for (const [value, kind] of [
      [current, "ok"],
      [{ ...current, version: MATCH_RECORD_VERSION + 1 }, "stale"],
      [oldRecord(41), "stale"],
    ] as const) {
      const storage = new FakeStorage();
      await storage.put(MATCH_KEY, value);
      const load = await loadMatchRecord(new MatchStore(storage));
      expect(load.kind).toBe(kind);
      expect([...storage.data.keys()]).toEqual([MATCH_KEY]);
    }
  });
});

describe("migrateMatchRecord — the envelope around the engine's migration", () => {
  it("keeps the envelope, stamps this version and hands back a record readMatchRecord accepts", () => {
    const old = oldRecord(44);
    expect(readMatchRecord(old)).toBeNull();
    const migrated = migrateMatchRecord(old);
    if (migrated === null) throw new Error("not migrated");
    expect(migrated.version).toBe(MATCH_RECORD_VERSION);
    expect(readMatchRecord(JSON.parse(JSON.stringify(migrated)))).not.toBeNull();
    expect([migrated.seed, migrated.startedAt, migrated.names, migrated.log]).toEqual([
      old.seed,
      old.startedAt,
      old.names,
      old.log,
    ]);
  });

  it("moves a match still on mulberry32 to a fresh ChaCha20 key and changes nothing else (MI1)", () => {
    for (const version of [OLDEST_MIGRATABLE, 49, 50]) {
      const old = oldRecord(version);
      expect(typeof old.state.rngState).toBe("number");
      const migrated = migrateMatchRecord(old, () => drbgSeed(version));
      if (migrated === null) throw new Error(`v${version}: not migrated`);
      expect(migrated.state.rngState).toEqual(drbgSeed(version));
      const engine = migrateGameState(old.state, version);
      expect({ ...migrated.state, rngState: old.state.rngState }).toEqual(engine);
      expect(migrated.seed).toBe(5830);
    }
    // The old DO minted an unsigned u32 seed, which the record kept as it was.
    const high = migrateMatchRecord({ ...oldRecord(50), seed: 4_000_000_000 });
    expect(high?.seed).toBe(4_000_000_000);
    // The default rekey is the CSPRNG one: well formed, and a different key each time.
    const a = migrateMatchRecord(oldRecord(50))?.state.rngState;
    const b = migrateMatchRecord(oldRecord(50))?.state.rngState;
    expect(isRngState(a) && typeof a === "object").toBe(true);
    expect(a).not.toEqual(b);
  });

  it("a v50 record is read through the store, rekeyed once, and the next wake keeps that key", async () => {
    const storage = new FakeStorage();
    await storage.put(MATCH_KEY, oldRecord(50));
    const load = await loadMatchRecord(new MatchStore(storage));
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(MATCH_RECORD_VERSION);
    expect(typeof load.record.state.rngState).toBe("object");
    const woken = await loadMatchRecord(new MatchStore(storage));
    expect(woken).toEqual(load);
  });

  it("a record failing the envelope checks is not migrated", () => {
    const old = oldRecord(OLDEST_MIGRATABLE);
    const { version: _version, ...unversioned } = old;
    for (const raw of [
      { ...old, log: undefined },
      { ...old, names: { p1: "Ana" } },
      { ...old, state: null },
      unversioned,
      null,
      undefined,
      41,
      "x",
    ]) {
      expect(migrateMatchRecord(raw)).toBeNull();
    }
  });

  it("the engine decides the version: a retired, current or unknown version is not migrated", () => {
    const old = oldRecord(OLDEST_MIGRATABLE);
    for (const version of [40, 41, MATCH_RECORD_VERSION, MATCH_RECORD_VERSION + 1]) {
      expect(migrateMatchRecord({ ...old, version })).toBeNull();
    }
    expect(migrateMatchRecord(old)).not.toBeNull();
    expect(migrateMatchRecord({ ...old, version: 45 })).not.toBeNull();
  });
});
