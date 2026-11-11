// The lobby's persisted match, laid out so an action writes only what it changed: a head (the
// envelope and the game state without its fixed card tables), the card tables once per match,
// and the log in fixed-size chunks of which an action rewrites only the last. A record from
// before the split sits whole under the head key and reads back as it is; the next write splits
// it. While the instance is awake the store mirrors what storage holds, so a read costs nothing.

import type { SeatLogEntry } from "@colorless/schema";
import type { MatchRecord, MatchSlot } from "./match";

/** The head; also where a whole record from before the split was stored. */
export const MATCH_KEY = "match";
const TABLES_KEY = "matchTables";
const LOG_KEY_PREFIX = "matchLog:";

/** Log entries per stored chunk. */
export const LOG_CHUNK = 64;

/** The layout this deploy writes, stamped on the head. A head without it is a whole record. */
export const MATCH_LAYOUT = 2;

/** The most keys one storage call accepts. */
const STORAGE_BATCH = 128;

type GameState = MatchRecord["state"];

type FixedTables = Pick<GameState, "cardPool" | "cardIdByUid">;

/** The head's state keeps the tables' keys, nulled, so a joined state has the original key order. */
type HeadState = Omit<GameState, keyof FixedTables> & { cardPool: null; cardIdByUid: null };

type StoredHead = Omit<MatchRecord, "state" | "log"> & {
  layout: typeof MATCH_LAYOUT;
  state: HeadState;
  logLength: number;
};

/** The slice of Durable Object storage the store uses. */
export interface MatchStorage {
  get(key: string): Promise<unknown>;
  get(keys: string[]): Promise<Map<string, unknown>>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
  list(options: { prefix: string }): Promise<Map<string, unknown>>;
}

/** What the split keys hold, enough to write the next action's changes alone. */
type Written = FixedTables & { seed: string; startedAt: number; logLength: number };

/** A record's seed as a comparable value: a ChaCha20 seed is an object, which a read from storage
    copies. Total, since a head read back from storage is not validated. */
function seedId(seed: unknown): string {
  if (!isObject(seed)) return String(seed);
  return `${String(seed.key)}:${String(seed.counter)}`;
}

function logChunkKey(index: number): string {
  return `${LOG_KEY_PREFIX}${index}`;
}

function chunkCount(logLength: number): number {
  return Math.ceil(logLength / LOG_CHUNK);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSplitHead(raw: unknown): raw is StoredHead {
  return (
    isObject(raw) &&
    raw.layout === MATCH_LAYOUT &&
    Number.isInteger(raw.logLength) &&
    (raw.logLength as number) >= 0 &&
    isObject(raw.state)
  );
}

function isTables(raw: unknown): raw is FixedTables {
  return isObject(raw) && isObject(raw.cardPool) && isObject(raw.cardIdByUid);
}

function batches<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += STORAGE_BATCH) out.push(items.slice(i, i + STORAGE_BATCH));
  return out;
}

function headOf(record: MatchRecord): StoredHead {
  const { log, state, ...envelope } = record;
  return {
    layout: MATCH_LAYOUT,
    ...envelope,
    state: { ...state, cardPool: null, cardIdByUid: null },
    logLength: log.length,
  };
}

/**
 * The storage entries that persist `record`, given what the keys already hold: the head always,
 * the card tables when they are not the ones written, and the log chunks from the first one
 * holding a new entry, or all of them once the log was trimmed. Nothing written means
 * everything is.
 */
function matchEntries(record: MatchRecord, written: Written | null): Record<string, unknown> {
  const { cardPool, cardIdByUid } = record.state;
  const sameMatch =
    written !== null &&
    written.seed === seedId(record.seed) &&
    written.startedAt === record.startedAt;
  const continues = sameMatch && record.log.length >= written.logLength;
  const entries: Record<string, unknown> = { [MATCH_KEY]: headOf(record) };
  if (!sameMatch || written.cardPool !== cardPool || written.cardIdByUid !== cardIdByUid) {
    entries[TABLES_KEY] = { cardPool, cardIdByUid };
  }
  const from = continues
    ? written.logLength === record.log.length
      ? chunkCount(record.log.length)
      : Math.floor(written.logLength / LOG_CHUNK)
    : 0;
  for (let index = from; index < chunkCount(record.log.length); index++) {
    entries[logChunkKey(index)] = record.log.slice(index * LOG_CHUNK, (index + 1) * LOG_CHUNK);
  }
  return entries;
}

/**
 * The match slot over Durable Object storage. Every read and write of the match goes through one
 * store per instance, which is what keeps its mirror true; `forget` covers a wipe done around it.
 */
export class MatchStore implements MatchSlot {
  /** What storage holds, as `get` returns it; null until read since the instance woke. */
  private mirror: { raw: unknown } | null = null;
  private written: Written | null = null;

  constructor(private readonly storage: MatchStorage) {}

  /** The stored match joined back into one record, a whole record as stored, or undefined. */
  async get(): Promise<unknown> {
    this.mirror ??= { raw: await this.read() };
    return this.mirror.raw;
  }

  async put(record: MatchRecord): Promise<void> {
    const entries = Object.entries(matchEntries(record, this.written));
    // A shorter log (a trimmed one) leaves chunks past its end, which no read reaches.
    const kept = chunkCount(record.log.length);
    const had = chunkCount(this.written?.logLength ?? 0);
    const stale = Array.from({ length: Math.max(0, had - kept) }, (_, i) => logChunkKey(kept + i));
    // Writes issued without an await between them commit together.
    await Promise.all([
      ...batches(entries).map((batch) => this.storage.put(Object.fromEntries(batch))),
      ...batches(stale).map((batch) => this.storage.delete(batch)),
    ]);
    this.mirror = { raw: record };
    this.written = {
      seed: seedId(record.seed),
      startedAt: record.startedAt,
      cardPool: record.state.cardPool,
      cardIdByUid: record.state.cardIdByUid,
      logLength: record.log.length,
    };
  }

  /** Remove every key of the match, whatever layout wrote it. */
  async delete(): Promise<void> {
    const chunks = await this.storage.list({ prefix: LOG_KEY_PREFIX });
    const keys = [MATCH_KEY, TABLES_KEY, ...chunks.keys()];
    await Promise.all(batches(keys).map((batch) => this.storage.delete(batch)));
    this.forget();
  }

  /** Storage was wiped around the store. */
  forget(): void {
    this.mirror = { raw: undefined };
    this.written = null;
  }

  private async read(): Promise<unknown> {
    this.written = null;
    const head = await this.storage.get(MATCH_KEY);
    if (!isSplitHead(head)) return head;
    const chunkKeys = Array.from({ length: chunkCount(head.logLength) }, (_, i) => logChunkKey(i));
    const values = new Map<string, unknown>();
    for (const batch of batches([TABLES_KEY, ...chunkKeys])) {
      for (const [key, value] of await this.storage.get(batch)) values.set(key, value);
    }
    const tables = values.get(TABLES_KEY);
    const chunks = chunkKeys.map((key) => values.get(key));
    // A head whose other keys are missing reads as the head alone, which no reader accepts.
    if (!isTables(tables) || !chunks.every((chunk) => Array.isArray(chunk))) return head;
    const log = (chunks as SeatLogEntry[][]).flat();
    if (log.length !== head.logLength) return head;
    const { layout: _layout, logLength: _logLength, state, ...envelope } = head;
    this.written = {
      seed: seedId(head.seed),
      startedAt: head.startedAt,
      cardPool: tables.cardPool,
      cardIdByUid: tables.cardIdByUid,
      logLength: head.logLength,
    };
    return {
      ...envelope,
      state: { ...state, cardPool: tables.cardPool, cardIdByUid: tables.cardIdByUid },
      log,
    };
  }
}
