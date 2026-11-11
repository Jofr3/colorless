// Real bindings for route tests: Miniflare's in-memory D1, with every drizzle migration applied in
// order, and KV. One instance per test file; `reset` empties the user tables and KV between tests
// while the seeded catalog rows stay.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { generateSessionToken, hashSessionToken, SESSION_TTL_MS } from "../auth/session";
import type { Env } from "../env";

// Read from disk on each run rather than through `import.meta.glob`: vitest's module cache keys a
// file by its own content, so a cached glob would not see a migration added later.
const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle/", import.meta.url).href);

/** The PASSWORD_PEPPER of every test env. */
export const TEST_PEPPER = "test-pepper-not-a-secret";

export type MigrationFile = { name: string; statements: string[] };

/** Every migration file in order, as `wrangler d1 migrations apply` names and splits it. */
export function migrationFiles(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      statements: readFileSync(join(MIGRATIONS_DIR, name), "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0),
    }));
}

export type TestD1 = {
  db: D1Database;
  kv: KVNamespace;
  /** A Worker env with the real DB and CACHE and a TEST_PEPPER password pepper, as production
      has one; the other bindings throw if a route touches them. LOG_TAG_KEY is unset, so log
      lines carry the literal "untagged". */
  env(overrides?: Partial<Record<keyof Env, unknown>>): Env;
  reset(): Promise<void>;
  dispose(): Promise<void>;
};

export async function createTestD1(): Promise<TestD1> {
  // Miniflare 5 takes a `workers` array; the shim keeps the v4 single-worker shape. The exact
  // miniflare pin equals wrangler's own.
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "",
      d1Databases: ["DB"],
      kvNamespaces: ["CACHE"],
    }),
  );
  const db = (await mf.getD1Database("DB")) as unknown as D1Database;
  const kv = (await mf.getKVNamespace("CACHE")) as unknown as KVNamespace;
  await db.batch(
    migrationFiles().flatMap((file) => file.statements.map((statement) => db.prepare(statement))),
  );
  return {
    db,
    kv,
    env: (overrides = {}) =>
      ({
        DB: db,
        ASSETS: undefined,
        CACHE: kv,
        PASSWORD_PEPPER: TEST_PEPPER,
        ...overrides,
      }) as unknown as Env,
    reset: async () => {
      // Deleting users cascades to sessions, identities, folders, decks and deck cards.
      await db.batch([db.prepare("DELETE FROM users"), db.prepare("DELETE FROM auth_rate_limits")]);
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
  return raceBeforeBatch(db, 0, winner);
}

/** `raceBeforeFirstBatch`, for a route whose reads are a batch too: `winner` runs just before the
    batch with this 0-based index. */
export function raceBeforeBatch(
  db: D1Database,
  index: number,
  winner: () => Promise<void>,
): D1Database {
  let batches = 0;
  return new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (batches++ === index) await winner();
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The message of a spent daily write quota, as D1 words it; errorFields logs it as `quota`. */
export const SPENT_QUOTA = "D1_ERROR: Exceeded maximum rows written";

export type D1Failure = {
  /** The statements that fail: those whose SQL matches, run alone or inside a batch. Every
      statement when neither this nor `batch` is given. */
  sql?: RegExp;
  /** Every batch fails, whatever it holds. Single statements still run unless `sql` matches. */
  batch?: boolean;
  /** What a failing call rejects with: a message (a new Error each time) or one error. A spent
      write quota by default. */
  error?: string | Error;
};

/**
 * `db`, except that the calls `failure` names reject as D1 does in an outage or on a spent quota.
 * Every other statement runs on the real database.
 */
export function failingD1(db: D1Database, failure: D1Failure = {}): D1Database {
  const { error = SPENT_QUOTA } = failure;
  const fails = (query: string) =>
    failure.sql === undefined ? failure.batch !== true : failure.sql.test(query);
  const reject = async () => {
    throw typeof error === "string" ? new Error(error) : error;
  };
  // The statements handed out to fail, so that a batch holding one fails too.
  const failing = new WeakSet<D1PreparedStatement>();
  const failingStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => failingStatement(target.bind(...values));
        }
        if (
          property === "first" ||
          property === "run" ||
          property === "all" ||
          property === "raw"
        ) {
          return reject;
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    failing.add(wrapped);
    return wrapped;
  };
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          const statement = target.prepare(query);
          return fails(query) ? failingStatement(statement) : statement;
        };
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) =>
          failure.batch === true || statements.some((statement) => failing.has(statement))
            ? reject()
            : target.batch(statements);
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
