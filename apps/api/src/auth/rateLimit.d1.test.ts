import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { users } from "../db/schema";
import { resetLogThrottle } from "../http/log";
import { useTestD1 } from "../testing/d1";
import {
  ACCOUNT_MAX_ATTEMPTS,
  countFailure,
  EMAIL_FAILURE_WINDOW_MS,
  EMAIL_MAX_FAILURES,
  IP_MAX_ATTEMPTS,
  limitAttempt,
  RATE_LIMIT_WINDOW_MS,
  type RateLimitKeys,
  rateLimitKeys,
  UNAVAILABLE_RETRY_SECONDS,
} from "./rateLimit";

const d1 = useTestD1();

const NOW = 1_752_000_000_000;
const IP = "203.0.113.9";

afterEach(() => {
  vi.restoreAllMocks();
  resetLogThrottle();
});

/** One attempt against the real table, with the cheapest lookup a route could batch. */
function attempt(keys: RateLimitKeys, nowMs = NOW, db: D1Database = d1().db) {
  const orm = drizzle(db);
  return limitAttempt(orm, keys, () => orm.select({ id: users.id }).from(users).limit(1), nowMs);
}

async function counters(): Promise<{ key: string; count: number; reset_at: number }[]> {
  const { results } = await d1()
    .db.prepare("SELECT key, count, reset_at FROM auth_rate_limits ORDER BY count")
    .all<{ key: string; count: number; reset_at: number }>();
  return results;
}

describe("limitAttempt", () => {
  it("allows ten attempts per address and email, then refuses until the window ends", async () => {
    const keys = await rateLimitKeys("login", IP, "ash@example.com");
    for (let i = 0; i < ACCOUNT_MAX_ATTEMPTS; i++) {
      expect(await attempt(keys, NOW + i)).toEqual({ allowed: true, found: [] });
    }
    const refused = await attempt(keys, NOW + 60_000);
    expect(refused).toEqual({
      allowed: false,
      reason: "limited",
      retryAfterSeconds: (RATE_LIMIT_WINDOW_MS - 60_000) / 1000,
    });
    // Further refusals write nothing: the account stops at one past its budget and the address
    // never counted the refused attempt.
    await attempt(keys, NOW + 61_000);
    expect((await counters()).map((row) => row.count)).toEqual([
      ACCOUNT_MAX_ATTEMPTS,
      ACCOUNT_MAX_ATTEMPTS + 1,
    ]);
  });

  it("counts concurrent attempts exactly", async () => {
    const keys = await rateLimitKeys("login", IP, "ash@example.com");
    const results = await Promise.all(
      Array.from({ length: ACCOUNT_MAX_ATTEMPTS + 5 }, () => attempt(keys)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(ACCOUNT_MAX_ATTEMPTS);
  });

  it("starts a fresh window once the old one has passed", async () => {
    const keys = await rateLimitKeys("login", IP, "ash@example.com");
    for (let i = 0; i <= ACCOUNT_MAX_ATTEMPTS; i++) await attempt(keys);
    expect((await attempt(keys, NOW + RATE_LIMIT_WINDOW_MS - 1)).allowed).toBe(false);
    const later = NOW + RATE_LIMIT_WINDOW_MS;
    expect((await attempt(keys, later)).allowed).toBe(true);
    expect(await counters()).toEqual([
      { key: keys.account, count: 1, reset_at: later + RATE_LIMIT_WINDOW_MS },
      // The address counted only the ten allowed attempts of the old window.
      { key: keys.ip, count: 1, reset_at: later + RATE_LIMIT_WINDOW_MS },
    ]);
  });

  it("limits one address across emails, and no other address or scope", async () => {
    // The address has spent all but one attempt of its window on other emails.
    const first = await rateLimitKeys("login", IP, "trainer@example.com");
    await d1()
      .db.prepare("INSERT INTO auth_rate_limits (key, count, reset_at) VALUES (?, ?, ?)")
      .bind(first.ip, IP_MAX_ATTEMPTS - 1, NOW + RATE_LIMIT_WINDOW_MS)
      .run();
    expect((await attempt(first)).allowed).toBe(true);
    const fresh = await rateLimitKeys("login", IP, "new@example.com");
    expect(await attempt(fresh)).toEqual({
      allowed: false,
      reason: "limited",
      retryAfterSeconds: RATE_LIMIT_WINDOW_MS / 1000,
    });
    // Once the address is over budget, a new email writes no row of its own.
    const rows = (await counters()).length;
    expect((await attempt(await rateLimitKeys("login", IP, "other@example.com"))).allowed).toBe(
      false,
    );
    expect(await counters()).toHaveLength(rows);
    for (const keys of [
      await rateLimitKeys("login", "198.51.100.7", "new@example.com"),
      await rateLimitKeys("register", IP, "new@example.com"),
    ]) {
      expect((await attempt(keys)).allowed).toBe(true);
    }
  });

  it("keeps the address and the email out of the table", async () => {
    await attempt(await rateLimitKeys("login", IP, "ash@example.com"));
    const stored = JSON.stringify(await counters());
    expect(stored).not.toMatch(/ash|example|203\.0\.113/);
  });

  it("refuses the attempt as unavailable, without the lookup, when the counting batch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await d1()
      .db.prepare("INSERT INTO users (id, email, display_name) VALUES ('u', 'a@b.co', 'A')")
      .run();
    const failing = new Proxy(d1().db, {
      get(target, property) {
        if (property === "batch") {
          return () => Promise.reject(new Error("D1_ERROR: rows written limit exceeded"));
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const keys = await rateLimitKeys("login", IP, "ash@example.com");
    const orm = drizzle(failing);
    const lookup = vi.fn(() => orm.select({ id: users.id }).from(users).limit(1));
    expect(await limitAttempt(orm, keys, lookup, NOW)).toEqual({
      allowed: false,
      reason: "unavailable",
      retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS,
    });
    // Built once for the batch, never run on its own.
    expect(lookup).toHaveBeenCalledOnce();
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { evt: "auth", kind: "limiter_error", error: "Error", quota: true },
    ]);
    expect(await counters()).toEqual([]);
  });
});

describe("countFailure (AU6)", () => {
  const fail = (keys: RateLimitKeys, nowMs: number, db: D1Database = d1().db) =>
    countFailure(drizzle(db), keys, nowMs);

  it(`counts ${EMAIL_MAX_FAILURES} failures an hour per email, then caps further ones without writing`, async () => {
    const keys = await rateLimitKeys("login", IP, "ash@example.com");
    for (let i = 0; i < EMAIL_MAX_FAILURES; i++) {
      expect(await fail(keys, NOW + i)).toEqual({ capped: false });
    }
    const later = NOW + 10 * 60 * 1000;
    expect(await fail(keys, later)).toEqual({
      capped: true,
      retryAfterSeconds: (EMAIL_FAILURE_WINDOW_MS - 10 * 60 * 1000) / 1000,
    });
    // Another address is capped too, and nothing past the cap is written.
    const elsewhere = await rateLimitKeys("login", "198.51.100.7", "ASH@example.com");
    expect((await fail(elsewhere, later)).capped).toBe(true);
    expect(await counters()).toEqual([
      { key: keys.email, count: EMAIL_MAX_FAILURES, reset_at: NOW + EMAIL_FAILURE_WINDOW_MS },
    ]);
    // The window ends and counting starts over.
    expect(await fail(keys, NOW + EMAIL_FAILURE_WINDOW_MS)).toEqual({ capped: false });
    expect((await counters())[0]?.count).toBe(1);
  });

  it("caps nothing, and logs, when D1 fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = new Proxy(d1().db, {
      get(target, property) {
        if (property === "batch") return () => Promise.reject(new Error("D1_ERROR: boom"));
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const keys = await rateLimitKeys("login", IP, "ash@example.com");
    expect(await fail(keys, NOW, failing)).toEqual({ capped: false });
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { evt: "auth", kind: "limiter_error", error: "Error", quota: false },
    ]);
  });
});
