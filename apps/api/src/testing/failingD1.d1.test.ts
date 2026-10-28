import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { users } from "../db/schema";
import { failingD1, SPENT_QUOTA, useTestD1 } from "./d1";

const d1 = useTestD1();

const insert = (db: D1Database, id: string) =>
  db
    .prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, 'A')")
    .bind(id, `${id}@x.co`);
const userIds = async () =>
  (await d1().db.prepare("SELECT id FROM users ORDER BY id").all<{ id: string }>()).results.map(
    (row) => row.id,
  );

describe("failingD1", () => {
  it("fails the matching statements alone and in a batch, and runs the rest", async () => {
    const db = failingD1(d1().db, { sql: /^insert/i });
    await expect(insert(db, "a").run()).rejects.toThrow(SPENT_QUOTA);
    await expect(db.batch([db.prepare("SELECT 1"), insert(db, "b")])).rejects.toThrow(SPENT_QUOTA);
    expect(await db.prepare("SELECT 2 AS two").first("two")).toBe(2);
    expect(await db.batch([db.prepare("SELECT 1")])).toHaveLength(1);
    expect(await userIds()).toEqual([]);
  });

  it("fails every batch, but not single statements, with batch alone", async () => {
    const db = failingD1(d1().db, { batch: true, error: "D1_ERROR: boom" });
    await expect(db.batch([db.prepare("SELECT 1")])).rejects.toThrow("D1_ERROR: boom");
    await insert(db, "a").run();
    expect(await userIds()).toEqual(["a"]);
  });

  it("fails everything with neither, through drizzle too, rejecting with the error given", async () => {
    const down = new TypeError("down");
    const db = failingD1(d1().db, { error: down });
    await expect(db.prepare("SELECT 1").all()).rejects.toBe(down);
    const error = await drizzle(db)
      .select()
      .from(users)
      .then(
        () => null,
        (failure: unknown) => failure,
      );
    expect((error as Error).cause).toBe(down);
  });
});
