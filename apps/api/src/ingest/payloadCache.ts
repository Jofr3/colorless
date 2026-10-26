// A disk cache of tcgdex payloads for the ingest CLI, so a rerun (a local ingest followed by the
// remote one, or a retry after a failed set) does not refetch every card. Entries expire, and the
// CLI only stores payloads that passed validation and still validates what it reads back. Not
// re-exported from ./index.ts: it needs node:fs, which the Worker does not have.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PayloadKind = "serie" | "set" | "card";

export interface PayloadCache {
  /** The stored payload, or undefined when absent, unreadable or older than the cache allows. */
  read(kind: PayloadKind, id: string): unknown;
  write(kind: PayloadKind, id: string, payload: unknown): void;
}

export interface PayloadCacheOptions {
  dir: string;
  maxAgeMs: number;
  now?: () => number;
}

type Entry = { savedAt: number; payload: unknown };

/** Ids become file names; anything outside a conservative set is escaped so an id cannot leave
    its directory. */
function fileName(id: string): string {
  return `${encodeURIComponent(id).replaceAll(".", "%2E")}.json`;
}

export function createPayloadCache(options: PayloadCacheOptions): PayloadCache {
  const now = options.now ?? Date.now;
  const pathOf = (kind: PayloadKind, id: string) => join(options.dir, kind, fileName(id));
  return {
    read(kind, id) {
      let entry: Entry;
      try {
        entry = JSON.parse(readFileSync(pathOf(kind, id), "utf8")) as Entry;
      } catch {
        return undefined;
      }
      if (typeof entry?.savedAt !== "number" || now() - entry.savedAt > options.maxAgeMs) {
        return undefined;
      }
      return entry.payload;
    },
    write(kind, id, payload) {
      mkdirSync(join(options.dir, kind), { recursive: true });
      const entry: Entry = { savedAt: now(), payload };
      writeFileSync(pathOf(kind, id), JSON.stringify(entry));
    },
  };
}
