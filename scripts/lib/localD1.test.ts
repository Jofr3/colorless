import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { D1_DIR, D1_ENV, findLocalD1 } from "./localD1";

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "colorless-d1-"));
  vi.stubEnv(D1_ENV, "");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

/** A checkout at `base/name` whose D1 holds `cards` rows, an empty `cards` table, or no table. */
function checkout(name: string, cards: number | "unmigrated"): { root: string; db: string } {
  const root = join(base, name);
  const dir = join(root, D1_DIR);
  mkdirSync(dir, { recursive: true });
  const db = join(dir, "0123abcd.sqlite");
  const sqlite = new DatabaseSync(db);
  if (cards !== "unmigrated") {
    sqlite.exec("create table cards (id text primary key)");
    for (let i = 0; i < cards; i++) sqlite.prepare("insert into cards values (?)").run(`c${i}`);
  }
  sqlite.close();
  new DatabaseSync(join(dir, "metadata.sqlite")).close();
  return { root, db };
}

describe("findLocalD1", () => {
  it("reads this checkout's catalog first", () => {
    const own = checkout("own", 2);
    const main = checkout("main", 3);
    expect(findLocalD1(own.root, main.root)).toBe(own.db);
  });

  it("falls back to the main checkout's catalog when this checkout has no D1", () => {
    const main = checkout("main", 3);
    expect(findLocalD1(join(base, "worktree"), main.root)).toBe(main.db);
  });

  it("treats a migrated D1 with no catalog rows as absent", () => {
    const own = checkout("own", 0);
    const main = checkout("main", 3);
    expect(findLocalD1(own.root, main.root)).toBe(main.db);
  });

  it("treats an unmigrated D1 as absent", () => {
    const own = checkout("own", "unmigrated");
    const main = checkout("main", 3);
    expect(findLocalD1(own.root, main.root)).toBe(main.db);
  });

  it("finds nothing when neither checkout has a catalog", () => {
    const own = checkout("own", 0);
    expect(findLocalD1(own.root, join(base, "main"))).toBeUndefined();
    expect(findLocalD1(own.root, undefined)).toBeUndefined();
  });

  it("lets COLORLESS_D1_SQLITE win over both checkouts", () => {
    const own = checkout("own", 2);
    const other = checkout("other", 1);
    vi.stubEnv(D1_ENV, other.db);
    expect(findLocalD1(own.root, own.root)).toBe(other.db);
  });
});
