import { describe, expect, it } from "vitest";
import { printKey } from "../ingest/map";
import type { CardRow } from "../ingest/map";
import { useTestD1 } from "../testing/d1";
import { CARD_KEY_COLUMNS, CONSISTENCY_CHECKS, printKeyMismatches } from "./consistency";

const KEY = printKey({ category: "Trainer", name: "Nest Ball", effect: "Search." } as CardRow);

async function seed(db: D1Database): Promise<void> {
  await db.batch(
    [
      "INSERT INTO series (id, name) VALUES ('sv', 'Scarlet & Violet')",
      `INSERT INTO sets (id, serie_id, name, release_date, count_total, count_official, legal_standard,
        legal_expanded) VALUES ('sv01', 'sv', 'Scarlet & Violet', '2023-03-31', 258, 198, 1, 1)`,
      `INSERT INTO cards (id, set_id, local_id, name, category, effect, legal_standard, legal_expanded,
        print_key, legal_standard_effective, legal_expanded_effective)
        VALUES ('sv01-181', 'sv01', '181', 'Nest Ball', 'Trainer', 'Search.', 1, 1, '${KEY}', 1, 1)`,
    ].map((sql) => db.prepare(sql)),
  );
}

const getDb = useTestD1(seed);

/** One clean account: a folder, a deck in it holding one card, and that deck as its favourite. */
async function seedAccount(db: D1Database, user: string, email = `${user}@example.com`) {
  await db.batch(
    [
      `INSERT INTO users (id, email, display_name) VALUES ('${user}', '${email}', '${user}')`,
      `INSERT INTO folders (id, user_id, name) VALUES ('${user}-f', '${user}', 'Folder')`,
      `INSERT INTO decks (id, user_id, folder_id, name, tint) VALUES ('${user}-d', '${user}', '${user}-f', 'Deck', 200)`,
      `INSERT INTO deck_cards (deck_id, card_id, count) VALUES ('${user}-d', 'sv01-181', 4)`,
      `UPDATE users SET favourite_deck_id = '${user}-d' WHERE id = '${user}'`,
    ].map((sql) => db.prepare(sql)),
  );
}

async function rows(name: string): Promise<unknown[]> {
  const check = CONSISTENCY_CHECKS.find((c) => c.name === name);
  if (check === undefined) throw new Error(`no check named ${name}`);
  return (await getDb().db.prepare(check.sql).all()).results;
}

/** The statements that break each rule, run after two clean accounts `a` and `b` exist. */
const VIOLATIONS: Record<string, string[]> = {
  "favourite deck owned by another user": [
    "UPDATE users SET favourite_deck_id = 'b-d' WHERE id = 'a'",
  ],
  "deck in another user's folder": ["UPDATE decks SET folder_id = 'b-f' WHERE id = 'a-d'"],
  "folder under another user's folder": ["UPDATE folders SET parent_id = 'b-f' WHERE id = 'a-f'"],
  "email not lowercase": ["UPDATE users SET email = 'A@example.com' WHERE id = 'a'"],
  "deck_cards.count outside 1-99": ["UPDATE deck_cards SET count = 0 WHERE deck_id = 'a-d'"],
  "decks.tint outside 0-360": ["UPDATE decks SET tint = 361 WHERE id = 'a-d'"],
  "boolean column not 0/1": ["UPDATE users SET email_verified = 2 WHERE id = 'a'"],
  "cards.category outside Pokemon/Trainer/Energy": [
    "UPDATE cards SET category = 'Item' WHERE id = 'sv01-181'",
  ],
  "two cards with one set number": [
    `INSERT INTO cards (id, set_id, local_id, name, category, legal_standard, legal_expanded,
      print_key, legal_standard_effective, legal_expanded_effective)
      VALUES ('sv01-181b', 'sv01', '181', 'Nest Ball', 'Trainer', 1, 1, '${KEY}', 1, 1)`,
  ],
  "card the reprint post-pass has not reached": [
    "UPDATE cards SET legal_expanded_effective = NULL WHERE id = 'sv01-181'",
  ],
  "effective legality differs from its print_key group": [
    `INSERT INTO cards (id, set_id, local_id, name, category, legal_standard, legal_expanded,
      print_key, legal_standard_effective, legal_expanded_effective)
      VALUES ('sv01-999', 'sv01', '999', 'Nest Ball', 'Trainer', 0, 1, '${KEY}', 0, 1)`,
  ],
};

/** PRAGMA-backed checks: D1 enforces foreign keys and owns the file, so a test cannot break them. */
const UNSEEDABLE = ["integrity (PRAGMA quick_check)", "foreign keys (PRAGMA foreign_key_check)"];

async function restoreCatalog(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM cards WHERE id <> 'sv01-181'"),
    db.prepare(
      `UPDATE cards SET category = 'Trainer', legal_standard_effective = 1,
        legal_expanded_effective = 1 WHERE id = 'sv01-181'`,
    ),
  ]);
}

describe("consistency checks", () => {
  it("covers every check with a violation or names why it cannot", () => {
    const covered = new Set([...Object.keys(VIOLATIONS), ...UNSEEDABLE]);
    expect(CONSISTENCY_CHECKS.map((c) => c.name).filter((name) => !covered.has(name))).toEqual([]);
    expect([...covered].filter((name) => !CONSISTENCY_CHECKS.some((c) => c.name === name))).toEqual(
      [],
    );
  });

  it("finds nothing in a consistent database", async () => {
    const { db } = getDb();
    await seedAccount(db, "a");
    await seedAccount(db, "b");
    for (const check of CONSISTENCY_CHECKS) expect(await rows(check.name), check.name).toEqual([]);
  });

  for (const [name, statements] of Object.entries(VIOLATIONS)) {
    it(`finds: ${name}`, async () => {
      const { db } = getDb();
      await seedAccount(db, "a");
      await seedAccount(db, "b");
      await db.batch(statements.map((sql) => db.prepare(sql)));
      try {
        expect((await rows(name)).length).toBeGreaterThan(0);
      } finally {
        await restoreCatalog(db);
      }
    });
  }

  it("finds a print_key the current printKey would not compute", async () => {
    const { db } = getDb();
    const select = `SELECT ${CARD_KEY_COLUMNS} FROM cards`;
    expect(printKeyMismatches((await db.prepare(select).all()).results)).toEqual([]);
    await db.prepare("UPDATE cards SET effect = 'Search  your deck.' WHERE id = 'sv01-181'").run();
    try {
      expect(printKeyMismatches((await db.prepare(select).all()).results)).toEqual([
        { id: "sv01-181" },
      ]);
    } finally {
      await db.prepare("UPDATE cards SET effect = 'Search.' WHERE id = 'sv01-181'").run();
    }
  });
});
