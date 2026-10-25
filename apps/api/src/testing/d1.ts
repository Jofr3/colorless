/// <reference types="vite/types/importMeta.d.ts" />
// Real bindings for route tests: Miniflare's in-memory D1, with every drizzle migration applied in
// order, and KV. One instance per test file; `reset` empties the user tables and KV between tests
// while the seeded catalog rows stay.

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { generateSessionToken, hashSessionToken, SESSION_TTL_MS } from "../auth/session";
import type { Env } from "../env";

const MIGRATIONS = import.meta.glob<string>("../../drizzle/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

function migrationStatements(): string[] {
  return Object.keys(MIGRATIONS)
    .sort()
    .flatMap((path) => (MIGRATIONS[path] ?? "").split("--> statement-breakpoint"))
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export type TestD1 = {
  db: D1Database;
  kv: KVNamespace;
  /** A Worker env with the real DB and CACHE; the other bindings throw if a route touches them. */
  env(overrides?: Partial<Record<keyof Env, unknown>>): Env;
  reset(): Promise<void>;
  dispose(): Promise<void>;
};

export async function createTestD1(): Promise<TestD1> {
  const mf = new Miniflare({
    modules: true,
    script: "",
    d1Databases: ["DB"],
    kvNamespaces: ["CACHE"],
  });
  const db = (await mf.getD1Database("DB")) as unknown as D1Database;
  const kv = (await mf.getKVNamespace("CACHE")) as unknown as KVNamespace;
  await db.batch(migrationStatements().map((statement) => db.prepare(statement)));
  return {
    db,
    kv,
    env: (overrides = {}) =>
      ({ DB: db, ASSETS: undefined, CACHE: kv, ...overrides }) as unknown as Env,
    reset: async () => {
      // Deleting users cascades to sessions, identities, folders, decks and deck cards.
      await db.prepare("DELETE FROM users").run();
      const { keys } = await kv.list();
      await Promise.all(keys.map((key) => kv.delete(key.name)));
    },
    dispose: () => mf.dispose(),
  };
}

/** Registers the per-file lifecycle: one database for the file, user data emptied per test. */
export function useTestD1(seed?: (db: D1Database) => Promise<void>): () => TestD1 {
  let instance: TestD1 | undefined;
  beforeAll(async () => {
    instance = await createTestD1();
    await seed?.(instance.db);
  });
  beforeEach(async () => {
    await instance?.reset();
  });
  afterAll(async () => {
    await instance?.dispose();
  });
  return () => {
    if (instance === undefined) throw new Error("useTestD1 is read before beforeAll ran");
    return instance;
  };
}

export type CatalogCard = {
  id: string;
  name: string;
  category: "Pokemon" | "Trainer" | "Energy";
  hp?: number | null;
  imageUrl?: string | null;
};

/** One series and set holding the given cards: only the columns the schema requires. */
export async function seedCards(db: D1Database, cards: readonly CatalogCard[]): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO series (id, name) VALUES ('sv', 'Scarlet & Violet')"),
    db.prepare(
      `INSERT INTO sets (id, serie_id, name, release_date, count_total, count_official,
        legal_standard, legal_expanded) VALUES ('sv01', 'sv', 'Scarlet & Violet', '2023-03-31', 258, 198, 1, 1)`,
    ),
    ...cards.map((card, index) =>
      db
        .prepare(
          `INSERT INTO cards (id, set_id, local_id, name, category, hp, image_url, legal_standard,
            legal_expanded) VALUES (?, 'sv01', ?, ?, ?, ?, ?, 1, 1)`,
        )
        .bind(
          card.id,
          String(index + 1),
          card.name,
          card.category,
          card.hp ?? null,
          card.imageUrl ?? null,
        ),
    ),
  ]);
}

export type SignedIn = { userId: string; cookie: string };

/** A password-less account with a live session, without paying for the register route's hash. */
export async function signedInUser(db: D1Database, email: string): Promise<SignedIn> {
  const userId = crypto.randomUUID();
  const token = generateSessionToken();
  await db.batch([
    db
      .prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)")
      .bind(userId, email, email.split("@")[0] ?? email),
    db
      .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await hashSessionToken(token), userId, Date.now() + SESSION_TTL_MS),
  ]);
  return { userId, cookie: `session=${token}` };
}

/**
 * `db`, except that `winner` runs once just before the first batch: a concurrent request that
 * commits between a route's reads and its write.
 */
export function raceBeforeFirstBatch(db: D1Database, winner: () => Promise<void>): D1Database {
  let raced = false;
  return new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (!raced) {
            raced = true;
            await winner();
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
