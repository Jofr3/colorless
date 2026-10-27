import type { SeatLogEntry } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { basicCard, FakeStorage, LEGAL_DECK } from "./lobbyHarness";
import { beginMatch, type MatchRecord, readMatchRecord } from "./match";
import { LOG_CHUNK, MATCH_KEY, MATCH_LAYOUT, MatchStore } from "./matchStore";

const POOL = Object.fromEntries(LEGAL_DECK.map((id) => [id, basicCard(id)]));

function begun(seed = 9): MatchRecord {
  const result = beginMatch({
    seed,
    hostDeck: LEGAL_DECK,
    guestDeck: LEGAL_DECK,
    cardPool: POOL,
    names: { host: "Ana", guest: "Bo" },
    formats: { host: null, guest: null },
    chooser: null,
    now: 1_000,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.record;
}

/** `record` with `count` more log rows. */
function appended(record: MatchRecord, count: number): MatchRecord {
  const rows = Array.from(
    { length: count },
    (_, i) => ({ kind: "text", n: record.log.length + i }) as unknown as SeatLogEntry,
  );
  return {
    ...record,
    state: { ...record.state, turn: record.state.turn + 1 },
    log: [...record.log, ...rows],
  };
}

/** Storage that records the keys of every write and refuses a call over the runtime's key cap. */
function recordingStorage() {
  const storage = new FakeStorage();
  const writes: string[][] = [];
  const put = storage.put.bind(storage);
  storage.put = async (entries: string | Record<string, unknown>, value?: unknown) => {
    const keys = typeof entries === "string" ? [entries] : Object.keys(entries);
    if (keys.length > 128) throw new Error("too many keys");
    writes.push(keys.sort());
    await put(entries, value);
  };
  return { storage, writes };
}

async function readBack(storage: FakeStorage): Promise<unknown> {
  return new MatchStore(storage).get();
}

describe("MatchStore — the split record", () => {
  it("rewrites a trimmed log's chunks without the tables, and deletes the chunks past its end", async () => {
    const { storage, writes } = recordingStorage();
    const store = new MatchStore(storage);
    const long = appended(begun(), LOG_CHUNK * 5);
    await store.put(long);
    const trimmed = { ...long, log: long.log.slice(-(LOG_CHUNK + 3)) };
    await store.put(trimmed);
    expect(writes.at(-1)).toEqual(["match", "matchLog:0", "matchLog:1"]);
    const chunks = [...storage.data.keys()].filter((key) => key.startsWith("matchLog:"));
    expect(chunks.sort()).toEqual(["matchLog:0", "matchLog:1"]);
    expect(readMatchRecord(await readBack(storage))).toEqual(trimmed);
  });

  it("reads back exactly the record it wrote, key order included", async () => {
    const { storage } = recordingStorage();
    const record = appended(begun(), LOG_CHUNK * 2 + 5);
    await new MatchStore(storage).put(record);
    const joined = await readBack(storage);
    expect(JSON.stringify(joined)).toBe(JSON.stringify(record));
    expect(readMatchRecord(joined)).toEqual(record);
  });

  it("writes the card tables once and then only the head and the log's last chunk", async () => {
    const { storage, writes } = recordingStorage();
    const store = new MatchStore(storage);
    let record = begun();
    await store.put(record);
    expect(writes.at(-1)).toEqual(["match", "matchLog:0", "matchTables"]);
    record = appended(record, LOG_CHUNK - record.log.length - 1);
    await store.put(record);
    expect(writes.at(-1)).toEqual(["match", "matchLog:0"]);
    record = appended(record, 2);
    await store.put(record);
    expect(writes.at(-1)).toEqual(["match", "matchLog:0", "matchLog:1"]);
    record = appended(record, 1);
    await store.put(record);
    expect(writes.at(-1)).toEqual(["match", "matchLog:1"]);
    record = appended(record, 0);
    await store.put(record);
    expect(writes.at(-1)).toEqual(["match"]);
    expect(readMatchRecord(await readBack(storage))).toEqual(record);
  });

  it("continues writing only the changes after a wake reads the split record", async () => {
    const { storage, writes } = recordingStorage();
    const record = appended(begun(), LOG_CHUNK + 3);
    await new MatchStore(storage).put(record);
    const woken = new MatchStore(storage);
    const read = readMatchRecord(await woken.get());
    if (read === null) throw new Error("unreadable");
    const next = appended(read, 1);
    await woken.put(next);
    expect(writes.at(-1)).toEqual(["match", "matchLog:1"]);
    expect(readMatchRecord(await readBack(storage))).toEqual(next);
  });

  it("writes a different match whole", async () => {
    const { storage, writes } = recordingStorage();
    const store = new MatchStore(storage);
    await store.put(appended(begun(9), LOG_CHUNK));
    const rematch = begun(10);
    await store.put(rematch);
    expect(writes.at(-1)).toEqual(["match", "matchLog:0", "matchTables"]);
    expect(readMatchRecord(await readBack(storage))).toEqual(rematch);
  });

  it("splits a write over the runtime's key cap into several", async () => {
    const { storage, writes } = recordingStorage();
    const record = appended(begun(), LOG_CHUNK * 200);
    await new MatchStore(storage).put(record);
    expect(writes.length).toBeGreaterThan(1);
    expect(readMatchRecord(await readBack(storage))).toEqual(record);
  });

  it("answers from its mirror while awake, and from nothing once deleted or wiped", async () => {
    const { storage } = recordingStorage();
    const store = new MatchStore(storage);
    const record = begun();
    await store.put(record);
    storage.get = async () => {
      throw new Error("storage read");
    };
    expect(await store.get()).toBe(record);
    store.forget();
    expect(await store.get()).toBeUndefined();
  });

  it("deletes every key of the match, leftover chunks of an older one included", async () => {
    const { storage } = recordingStorage();
    const store = new MatchStore(storage);
    await store.put(appended(begun(9), LOG_CHUNK * 3));
    await store.put(begun(10));
    await storage.put("snapshot", { kept: true });
    await store.delete();
    expect([...storage.data.keys()]).toEqual(["snapshot"]);
    expect(await store.get()).toBeUndefined();
    expect(await readBack(storage)).toBeUndefined();
  });

  it("reads a head whose other keys are missing as the head alone, which no reader accepts", async () => {
    for (const missing of ["matchTables", "matchLog:1"]) {
      const { storage } = recordingStorage();
      await new MatchStore(storage).put(appended(begun(), LOG_CHUNK + 1));
      await storage.delete(missing);
      const raw = await readBack(storage);
      expect(raw).toMatchObject({ layout: MATCH_LAYOUT });
      expect(readMatchRecord(raw)).toBeNull();
    }
  });
});

describe("MatchStore — a record stored whole", () => {
  it("is read as stored, and the next write splits it", async () => {
    const { storage, writes } = recordingStorage();
    const whole = appended(begun(), LOG_CHUNK + 1);
    await storage.put(MATCH_KEY, whole);
    const store = new MatchStore(storage);
    expect(await store.get()).toEqual(whole);
    const next = appended(whole, 1);
    await store.put(next);
    expect(writes.at(-1)).toEqual(["match", "matchLog:0", "matchLog:1", "matchTables"]);
    expect(storage.data.get(MATCH_KEY)).toMatchObject({
      layout: MATCH_LAYOUT,
      logLength: next.log.length,
    });
    expect(storage.data.get(MATCH_KEY)).not.toHaveProperty("log");
    expect(readMatchRecord(await readBack(storage))).toEqual(next);
  });
});
