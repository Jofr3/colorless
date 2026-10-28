// GET /health/db over a real D1: one read of the migrations table wrangler keeps, and a 503 that
// names nothing when D1 fails.

import { dbHealthResponseSchema } from "@colorless/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLogThrottle } from "./http/log";
import app from "./index";
import { migrationFiles, useTestD1 } from "./testing/d1";

const d1 = useTestD1();

afterEach(() => {
  vi.restoreAllMocks();
  resetLogThrottle();
});

describe("GET /health/db", () => {
  it("503s with a bare body while the migrations table is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await app.request("/health/db", {}, d1().env());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(warn).toHaveBeenCalledWith('{"evt":"d1","kind":"health_failed"}');
  });

  it("counts the applied migrations, uncached", async () => {
    // testing/d1.ts applies the files directly; wrangler's apply also records each one here.
    const { db } = d1();
    await db.batch([
      db.prepare(
        `CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`,
      ),
      ...migrationFiles().map((file) =>
        db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(file.name),
      ),
    ]);
    try {
      const res = await app.request("/health/db", {}, d1().env());
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(dbHealthResponseSchema.parse(await res.json())).toEqual({
        ok: true,
        migrations: migrationFiles().length,
      });
    } finally {
      await db.prepare("DROP TABLE d1_migrations").run();
    }
  });
});
