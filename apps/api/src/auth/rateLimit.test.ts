import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLogThrottle } from "../http/log";
import {
  checkRateLimit,
  evaluateRateLimit,
  parseRateLimitState,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  rateLimitKey,
} from "./rateLimit";

const NOW = 1_752_000_000_000;

describe("rateLimitKey", () => {
  it("scopes by endpoint, ip and normalized email", () => {
    expect(rateLimitKey("login", "203.0.113.9", "Ash@Example.COM ")).toBe(
      "ratelimit:login:203.0.113.9:ash@example.com",
    );
    expect(rateLimitKey("register", "203.0.113.9", "a@b.co")).toBe(
      "ratelimit:register:203.0.113.9:a@b.co",
    );
  });
});

describe("parseRateLimitState", () => {
  it("round-trips stored counters and treats garbage as a fresh window", () => {
    expect(parseRateLimitState(JSON.stringify({ count: 3, resetAt: NOW }))).toEqual({
      count: 3,
      resetAt: NOW,
    });
    expect(parseRateLimitState(null)).toBeNull();
    expect(parseRateLimitState("not json")).toBeNull();
    expect(parseRateLimitState('{"count":"three"}')).toBeNull();
  });
});

describe("evaluateRateLimit", () => {
  it("opens a fresh window on first attempt", () => {
    const decision = evaluateRateLimit(null, NOW);
    expect(decision.allowed).toBe(true);
    expect(decision.nextState).toEqual({ count: 1, resetAt: NOW + RATE_LIMIT_WINDOW_MS });
    expect(decision.retryAfterSeconds).toBe(RATE_LIMIT_WINDOW_MS / 1000);
  });

  it("allows up to the limit, then blocks within the same window", () => {
    let state = evaluateRateLimit(null, NOW).nextState;
    for (let attempt = 2; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
      const decision = evaluateRateLimit(state, NOW + attempt);
      expect(decision.allowed).toBe(true);
      state = decision.nextState;
    }
    const blocked = evaluateRateLimit(state, NOW + 1000);
    expect(blocked.allowed).toBe(false);
    // Blocked attempts are recorded but never extend the window.
    expect(blocked.nextState.resetAt).toBe(NOW + RATE_LIMIT_WINDOW_MS);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(RATE_LIMIT_WINDOW_MS / 1000);
  });

  it("resets once the window has passed", () => {
    const exhausted = { count: 99, resetAt: NOW + RATE_LIMIT_WINDOW_MS };
    const decision = evaluateRateLimit(exhausted, NOW + RATE_LIMIT_WINDOW_MS);
    expect(decision.allowed).toBe(true);
    expect(decision.nextState.count).toBe(1);
  });

  it("floors the KV TTL to 60s near the window's end", () => {
    const nearEnd = { count: 2, resetAt: NOW + 5_000 };
    const decision = evaluateRateLimit(nearEnd, NOW);
    expect(decision.ttlSeconds).toBe(60);
    expect(decision.retryAfterSeconds).toBe(5);
  });
});

describe("checkRateLimit when KV fails", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLogThrottle();
  });

  const key = rateLimitKey("login", "203.0.113.9", "ash@example.com");
  const quotaError = () => Promise.reject(new Error("KV put() limit exceeded for the day."));
  // An exhausted window, so only failing open can allow the attempt after the read.
  const exhausted = JSON.stringify({ count: RATE_LIMIT_MAX_ATTEMPTS, resetAt: NOW + 60_000 });

  it.each([
    ["get", { get: quotaError, put: async () => {} }],
    ["put", { get: async () => exhausted, put: quotaError }],
  ])("allows the attempt and logs when the %s throws", async (op, kv) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const decision = await checkRateLimit(kv as unknown as KVNamespace, key, NOW);
    expect(decision.allowed).toBe(true);
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { evt: "auth", kind: "limiter_error", op, error: "Error", quota: true },
    ]);
  });
});
