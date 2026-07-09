// Minimal fixed-window rate limiting for register/login (§3.5), on the
// existing CACHE KV binding: one JSON counter per (scope, ip, email) key,
// expiring with its window via KV TTL.
//
// KV counters are APPROXIMATE by design: get→put is not atomic, so
// concurrent attempts can undercount, and KV's eventual consistency can lag
// across colos. That's acceptable for a brute-force guard — it bounds the
// order of magnitude, it isn't an accounting system. If precise limiting
// ever matters, move to a Durable Object.

import { z } from "zod";

export const RATE_LIMIT_MAX_ATTEMPTS = 10;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
/** KV rejects expirationTtl below 60s; clamp so end-of-window writes stick. */
const KV_MIN_TTL_SECONDS = 60;

export type RateLimitScope = "register" | "login";

export type RateLimitState = {
  /** Attempts recorded in the current window (counting this one). */
  count: number;
  /** Epoch ms when the window ends and the counter resets. */
  resetAt: number;
};

/** KV key for one caller+account pair. Email is normalized so casing can't
    mint fresh windows; IP comes from CF-Connecting-IP at the route. */
export function rateLimitKey(scope: RateLimitScope, ip: string, email: string): string {
  return `ratelimit:${scope}:${ip}:${email.trim().toLowerCase()}`;
}

const stateSchema = z.object({ count: z.number().int(), resetAt: z.number() });

/** Parse a stored counter; null (fresh window) for anything malformed. */
export function parseRateLimitState(raw: string | null): RateLimitState | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type RateLimitDecision = {
  allowed: boolean;
  /** What to store back (the attempt is recorded even when blocked). */
  nextState: RateLimitState;
  /** TTL for the KV put — window remainder, floored to KV's 60s minimum. */
  ttlSeconds: number;
  /** Seconds until the window resets — the Retry-After header on a 429. */
  retryAfterSeconds: number;
};

/** Pure fixed-window decision: expired/absent state starts a new window;
    otherwise increment. Blocked attempts still count, but never extend the
    window — the reset time is fixed when the window opens. */
export function evaluateRateLimit(state: RateLimitState | null, nowMs: number): RateLimitDecision {
  const nextState: RateLimitState =
    state === null || state.resetAt <= nowMs
      ? { count: 1, resetAt: nowMs + RATE_LIMIT_WINDOW_MS }
      : { count: state.count + 1, resetAt: state.resetAt };
  const retryAfterSeconds = Math.ceil((nextState.resetAt - nowMs) / 1000);
  return {
    allowed: nextState.count <= RATE_LIMIT_MAX_ATTEMPTS,
    nextState,
    ttlSeconds: Math.max(retryAfterSeconds, KV_MIN_TTL_SECONDS),
    retryAfterSeconds,
  };
}

/** Record an attempt and decide — the one KV-touching function. */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  nowMs: number = Date.now(),
): Promise<RateLimitDecision> {
  const decision = evaluateRateLimit(parseRateLimitState(await kv.get(key)), nowMs);
  await kv.put(key, JSON.stringify(decision.nextState), {
    expirationTtl: decision.ttlSeconds,
  });
  return decision;
}
