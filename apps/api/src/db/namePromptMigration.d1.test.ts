// Migration 0012's backfill (security audit AU3, decision 12): which existing accounts are asked,
// once, to choose their public name. No name changes.

import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationFiles } from "../testing/d1";

const MIGRATION = "0012_users_name_prompt.sql";

let mf: Miniflare;
let db: D1Database;

beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "", d1Databases: ["DB"] }));
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
});

afterAll(async () => {
  await mf.dispose();
});

describe(MIGRATION, () => {
  it("asks accounts named after their email or linked to Google, and no one else", async () => {
    const files = migrationFiles();
    const at = files.findIndex((file) => file.name === MIGRATION);
    expect(at, `${MIGRATION} is not a migration file`).toBeGreaterThan(0);
    for (const file of files.slice(0, at)) {
      await db.batch(file.statements.map((statement) => db.prepare(statement)));
    }
    const users: [id: string, email: string, name: string][] = [
      ["local", "misty@example.com", "misty"],
      ["local-case", "brock.harrison@example.com", " Brock.Harrison "],
      ["typed", "erika@example.com", "Erika of Celadon"],
      ["google", "sabrina@example.com", "Sabrina Natsume"],
      ["google-typed", "surge@example.com", "Lt. Surge"],
      ["prefix", "koga@example.com", "koga2"],
    ];
    await db.batch([
      ...users.map(([id, email, name]) =>
        db
          .prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)")
          .bind(id, email, name),
      ),
      db.prepare(
        "INSERT INTO oauth_identities (provider, provider_id, user_id) VALUES ('google', 'g1', 'google'), ('google', 'g2', 'google-typed')",
      ),
    ]);

    await db.batch(files[at]?.statements.map((statement) => db.prepare(statement)) ?? []);

    const { results } = await db
      .prepare("SELECT id, display_name AS name, name_prompt AS prompt FROM users ORDER BY id")
      .all<{ id: string; name: string; prompt: number }>();
    expect(results).toEqual([
      { id: "google", name: "Sabrina Natsume", prompt: 1 },
      { id: "google-typed", name: "Lt. Surge", prompt: 1 },
      { id: "local", name: "misty", prompt: 1 },
      { id: "local-case", name: " Brock.Harrison ", prompt: 1 },
      { id: "prefix", name: "koga2", prompt: 0 },
      { id: "typed", name: "Erika of Celadon", prompt: 0 },
    ]);
  });
});
