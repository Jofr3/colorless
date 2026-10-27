// Migrations must keep the data already in the database. D1 applies each migration file in its own
// transaction with foreign keys enforced, where `PRAGMA foreign_keys=OFF` does nothing, so the
// table rebuild drizzle-kit writes for a CHECK, an FK action or a column change (`CREATE __new_t;
// INSERT … SELECT; DROP TABLE t; RENAME`) fires the dropped table's ON DELETE actions: rebuilding
// `users` would empty sessions, decks and deck_cards. testing/d1.ts migrates an empty database,
// so only this test sees that. See docs/conventions.md "Database migrations".

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationFiles } from "../testing/d1";

/**
 * The last migration the seed below is written against. Every later file is applied, one at a
 * time, on top of seeded data. Move this forward only when the seed no longer fits the schema,
 * and never past a migration that has not been checked here.
 */
const SEEDED_AT = "0009_gigantic_namorita.sql";

/** One row in every table, with every reference between them set. */
const SEED = [
  "INSERT INTO series (id, name) VALUES ('sv', 'Scarlet & Violet')",
  `INSERT INTO sets (id, serie_id, name, release_date, count_total, count_official, legal_standard,
    legal_expanded) VALUES ('sv01', 'sv', 'Scarlet & Violet', '2023-03-31', 258, 198, 1, 1)`,
  `INSERT INTO cards (id, set_id, local_id, name, category, legal_standard, legal_expanded)
    VALUES ('sv01-181', 'sv01', '181', 'Nest Ball', 'Trainer', 1, 1)`,
  "INSERT INTO users (id, email, display_name) VALUES ('u', 'u@example.com', 'u')",
  "INSERT INTO sessions (id, user_id, expires_at) VALUES ('s', 'u', 4102444800000)",
  "INSERT INTO oauth_identities (provider, provider_id, user_id) VALUES ('google', 'g', 'u')",
  "INSERT INTO folders (id, user_id, name) VALUES ('f', 'u', 'Root')",
  "INSERT INTO folders (id, user_id, parent_id, name) VALUES ('f2', 'u', 'f', 'Child')",
  `INSERT INTO decks (id, user_id, folder_id, name, tint, cover_card_id)
    VALUES ('d', 'u', 'f2', 'Deck', 200, 'sv01-181')`,
  "INSERT INTO deck_cards (deck_id, card_id, count) VALUES ('d', 'sv01-181', 4)",
  "UPDATE users SET favourite_deck_id = 'd' WHERE id = 'u'",
];

/** Every reference the seed sets, read the same way before and after each migration. */
const REFERENCES = `SELECT
  (SELECT favourite_deck_id FROM users WHERE id = 'u') AS favourite,
  (SELECT folder_id || '/' || cover_card_id FROM decks WHERE id = 'd') AS deck,
  (SELECT parent_id FROM folders WHERE id = 'f2') AS parent,
  (SELECT card_id || 'x' || count FROM deck_cards WHERE deck_id = 'd') AS deck_card,
  (SELECT user_id FROM sessions WHERE id = 's') AS session,
  (SELECT user_id FROM oauth_identities WHERE provider_id = 'g') AS identity`;

let mf: Miniflare;
let db: D1Database;

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: "", d1Databases: ["DB"] });
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
});

afterAll(async () => {
  await mf.dispose();
});

async function apply(file: { statements: string[] }): Promise<void> {
  // One batch per file: wrangler's transaction boundary.
  await db.batch(file.statements.map((statement) => db.prepare(statement)));
}

async function tables(): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name`,
    )
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

async function rowCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of await tables()) {
    const row = await db.prepare(`SELECT count(*) AS n FROM "${table}"`).first<{ n: number }>();
    counts[table] = row?.n ?? 0;
  }
  return counts;
}

describe("migrations on a database that holds data", () => {
  it("keeps every row and reference through each migration after the seed", async () => {
    const files = migrationFiles();
    const seededAt = files.findIndex((file) => file.name === SEEDED_AT);
    expect(seededAt, `${SEEDED_AT} is not a migration file`).toBeGreaterThanOrEqual(0);
    for (const file of files.slice(0, seededAt + 1)) await apply(file);
    await db.batch(SEED.map((sql) => db.prepare(sql)));

    const counts = await rowCounts();
    // A table the seed leaves empty is not protected; give it a row in SEED.
    expect(Object.keys(counts).filter((table) => counts[table] === 0)).toEqual([]);
    const references = await db.prepare(REFERENCES).first();

    for (const file of files.slice(seededAt + 1)) {
      await apply(file);
      const after = await rowCounts();
      for (const [table, n] of Object.entries(counts)) {
        expect(after[table], `${file.name} changed the row count of ${table}`).toBe(n);
      }
      expect(await db.prepare(REFERENCES).first(), `${file.name} changed a reference`).toEqual(
        references,
      );
      const { results } = await db.prepare("PRAGMA foreign_key_check").all();
      expect(results, `${file.name} left a foreign key violation`).toEqual([]);
    }
  });
});
