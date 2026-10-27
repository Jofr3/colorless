import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import { useTestD1 } from "../testing/d1";
import { sweepExpired } from "./sweep";

const d1 = useTestD1();

const NOW = 1_752_000_000_000;

afterEach(() => {
  vi.restoreAllMocks();
});

/** One user with `expired` sessions and `live` ones (each at least 1), and as many counters
    whose window has and has not passed at NOW. */
async function seed(expired: number, live: number) {
  const { db } = d1();
  const rows = (prefix: string, n: number, sql: string, at: number) =>
    db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1) ${sql}`,
      )
      .bind(n, prefix, at);
  await db.batch([
    db.prepare("INSERT INTO users (id, email, display_name) VALUES ('u', 'a@b.co', 'A')"),
    rows(
      "old",
      expired,
      "INSERT INTO sessions (id, user_id, expires_at) SELECT ?2 || i, 'u', ?3 FROM n",
      NOW - 1,
    ),
    rows(
      "new",
      live,
      "INSERT INTO sessions (id, user_id, expires_at) SELECT ?2 || i, 'u', ?3 FROM n",
      NOW + 1,
    ),
    rows(
      "old",
      expired,
      "INSERT INTO auth_rate_limits (key, count, reset_at) SELECT ?2 || i, 3, ?3 FROM n",
      NOW,
    ),
    rows(
      "new",
      live,
      "INSERT INTO auth_rate_limits (key, count, reset_at) SELECT ?2 || i, 3, ?3 FROM n",
      NOW + 1,
    ),
  ]);
}

async function remaining(table: "sessions" | "auth_rate_limits") {
  const row = await d1().db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n;
}

describe("the daily sweep", () => {
  it("deletes expired sessions and passed counters in chunks, and logs the counts", async () => {
    await seed(1203, 7);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = { scheduledTime: NOW, cron: "17 4 * * *", noRetry: () => {} };
    await worker.scheduled(controller, d1().env());
    expect(await remaining("sessions")).toBe(7);
    expect(await remaining("auth_rate_limits")).toBe(7);
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { evt: "d1", kind: "sweep", sessions: 1203, rateLimits: 1203 },
    ]);
  });

  it("stops after its chunk budget and leaves the rest for the next run", async () => {
    await seed(9, 1);
    expect(await sweepExpired(d1().db, NOW, { chunk: 2, maxChunks: 3 })).toEqual({
      sessions: 6,
      rateLimits: 6,
    });
    expect(await remaining("sessions")).toBe(3 + 1);
  });

  it("logs and rethrows a D1 failure, so the cron run shows as failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = d1().env({
      DB: {
        prepare: () => ({ bind: () => ({ run: () => Promise.reject(new TypeError("down")) }) }),
      },
    });
    const controller = { scheduledTime: NOW, cron: "17 4 * * *", noRetry: () => {} };
    await expect(worker.scheduled(controller, env)).rejects.toThrow("down");
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { evt: "d1", kind: "sweep_failed", error: "TypeError" },
    ]);
  });
});
