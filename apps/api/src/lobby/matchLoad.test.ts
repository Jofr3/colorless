import type { GameState } from "@colorless/engine";
import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { firstP1Turn, storedAt } from "@colorless/engine/testing";
import {
  loadMatchRecord,
  MATCH_RECORD_VERSION,
  type MatchRecord,
  type MatchSlot,
  migratablePoolIdsOf,
  migrateMatchRecord,
  readMatchRecord,
  startMatch,
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
const FRESH_TRAINER: Card = { ...STALE_TRAINER, hp: 60 };
const FRESH_POOL = { [BODY]: BODY_CARD, [TRAINER]: FRESH_TRAINER };

const DECK = [...Array.from({ length: 58 }, () => BODY), TRAINER, TRAINER];
const NAMES = { p1: "Ana", p2: "Bo" } as const;

function board(): GameState {
  const created = startMatch({
    seed: 5830,
    hostDeck: DECK,
    guestDeck: DECK,
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

const never = async (): Promise<Record<string, Card>> => {
  throw new Error("D1 asked");
};

describe("loadMatchRecord — the DO's read of an older record", () => {
  it("a v41 record asks D1 for its pool, is written back once at this version, and the next read is plain", async () => {
    const { slot, api } = fakeSlot(oldRecord(41));
    const asked: string[][] = [];
    const load = await loadMatchRecord(api, async (ids) => {
      asked.push([...ids].sort());
      return FRESH_POOL;
    });
    expect(asked).toEqual([[BODY, TRAINER].sort()]);
    if (load.kind !== "ok") throw new Error(`expected ok, got ${load.kind}`);
    expect(load.record.version).toBe(MATCH_RECORD_VERSION);
    expect(load.record.state.cardPool[TRAINER]).toEqual(FRESH_TRAINER);
    expect(load.record.state.players.p1.chosenAttackShield).toBeNull();
    expect(slot.puts).toEqual([load.record]);
    expect(await loadMatchRecord(api, never)).toEqual(load);
    expect(slot.puts).toHaveLength(1);
  });

  it("every newer migratable version is written back once without asking D1", async () => {
    for (let version = 42; version <= 49; version++) {
      const { slot, api } = fakeSlot(oldRecord(version));
      const load = await loadMatchRecord(api, never);
      if (load.kind !== "ok") throw new Error(`v${version}: expected ok, got ${load.kind}`);
      expect(load.record.version).toBe(MATCH_RECORD_VERSION);
      expect(load.record.state.players.p1.trainerFlipLockTurn).toBeNull();
      expect(load.record.state.cardPool[TRAINER]).toEqual(STALE_TRAINER);
      expect(slot.puts).toEqual([load.record]);
    }
  });

  it("a current record is read as-is; a v40 record is stale; an empty slot is none — D1 never asked, nothing written", async () => {
    const current = migrateMatchRecord(oldRecord(41), FRESH_POOL);
    for (const [value, kind] of [
      [current, "ok"],
      [{ ...oldRecord(41), version: 40 }, "stale"],
      [undefined, "none"],
    ] as const) {
      const { slot, api } = fakeSlot(value);
      expect((await loadMatchRecord(api, never)).kind).toBe(kind);
      expect(slot.puts).toEqual([]);
    }
  });

  it("another event migrated or advanced the match during the D1 load: that record wins, nothing is written", async () => {
    const v41 = oldRecord(41);
    const theirs = migrateMatchRecord(v41, { [TRAINER]: FRESH_TRAINER });
    if (theirs === null) throw new Error("not migrated");
    const { slot, api } = fakeSlot(v41);
    const load = await loadMatchRecord(api, async () => {
      slot.value = theirs;
      return FRESH_POOL;
    });
    expect(load).toEqual({ kind: "ok", record: theirs });
    expect(slot.puts).toEqual([]);
  });

  it("the match ended during the D1 load: none, nothing is written", async () => {
    const { slot, api } = fakeSlot(oldRecord(41));
    const load = await loadMatchRecord(api, async () => {
      slot.value = undefined;
      return FRESH_POOL;
    });
    expect(load).toEqual({ kind: "none" });
    expect(slot.puts).toEqual([]);
  });

  it("a failed D1 load rejects and leaves the v41 record untouched for the next read", async () => {
    const v41 = oldRecord(41);
    const { slot, api } = fakeSlot(v41);
    await expect(
      loadMatchRecord(api, async () => {
        throw new Error("D1 down");
      }),
    ).rejects.toThrow("D1 down");
    expect(slot.puts).toEqual([]);
    expect(slot.value).toBe(v41);
  });
});

describe("loadMatchRecord over the DO's store — a whole record from before the split", () => {
  it("migrates an older whole record, writes it back split, and the next wake reads it as current", async () => {
    for (const version of [41, 49]) {
      const storage = new FakeStorage();
      await storage.put(MATCH_KEY, oldRecord(version));
      const load = await loadMatchRecord(new MatchStore(storage), async () => FRESH_POOL);
      if (load.kind !== "ok") throw new Error(`v${version}: expected ok, got ${load.kind}`);
      expect(load.record.version).toBe(MATCH_RECORD_VERSION);
      expect(storage.data.get(MATCH_KEY)).toMatchObject({
        layout: MATCH_LAYOUT,
        version: MATCH_RECORD_VERSION,
      });
      const woken = await loadMatchRecord(new MatchStore(storage), never);
      expect(woken).toEqual(load);
      expect(woken.kind === "ok" && woken.record.state.cardPool[TRAINER]).toEqual(
        version === 41 ? FRESH_TRAINER : STALE_TRAINER,
      );
    }
  });

  it("reads a current whole record without writing, and an unknown version as stale", async () => {
    const current = migrateMatchRecord(oldRecord(41), FRESH_POOL);
    for (const [value, kind] of [
      [current, "ok"],
      [{ ...current, version: MATCH_RECORD_VERSION + 1 }, "stale"],
    ] as const) {
      const storage = new FakeStorage();
      await storage.put(MATCH_KEY, value);
      const load = await loadMatchRecord(new MatchStore(storage), never);
      expect(load.kind).toBe(kind);
      expect([...storage.data.keys()]).toEqual([MATCH_KEY]);
    }
  });
});

describe("migrateMatchRecord — the envelope around the engine's migration", () => {
  it("keeps the envelope, stamps this version and hands back a record readMatchRecord accepts", () => {
    const old = oldRecord(44);
    expect(readMatchRecord(old)).toBeNull();
    const migrated = migrateMatchRecord(old, {});
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

  it("a record failing the envelope checks is neither migrated nor asked for a pool", () => {
    const old = oldRecord(41);
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
      expect(migratablePoolIdsOf(raw)).toBeNull();
      expect(migrateMatchRecord(raw, FRESH_POOL)).toBeNull();
    }
  });

  it("the engine decides the version: a current or unknown version is not migrated", () => {
    const old = oldRecord(41);
    for (const version of [40, MATCH_RECORD_VERSION, MATCH_RECORD_VERSION + 1]) {
      expect(migratablePoolIdsOf({ ...old, version })).toBeNull();
      expect(migrateMatchRecord({ ...old, version }, FRESH_POOL)).toBeNull();
    }
    expect(migratablePoolIdsOf(old)?.sort()).toEqual([BODY, TRAINER].sort());
    expect(migratablePoolIdsOf({ ...old, version: 45 })).toEqual([]);
  });
});
