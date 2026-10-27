// Fixed-window rate limiting for register, login and account deletion (§3.5), in the D1 table
// `auth_rate_limits`. Each scope has its own windows: deletion asks for the current password, so
// without a budget a stolen session cookie could guess it at full speed.
//
// Every attempt counts against two keys. For login and deletion the (scope, ip, email) key allows
// 10 per 15 minutes, which is what slows a password guesser on one account. The (scope, ip) key
// allows 50, which stops one address cycling through emails while leaving room for a household,
// office or school behind one NAT address, where several people sign in and mistype within the
// same quarter hour. An attempt refused by the account key does not count against the address,
// so one locked-out account does not use up its neighbours' budget.
//
// Register gets 5 an hour per address (security audit AUX1): each allowed register writes about
// 10 rows and leaves a user behind, so the login budget let one address spend half the day's
// write quota. Nobody makes more than a few accounts an hour; a class signing up together behind
// one address waits for the window, which the 429's Retry-After says.
//
// The counting statements run in the same D1 batch as the route's user lookup: no extra round
// trip, and since D1 runs a batch as one serial transaction, concurrent attempts cannot
// undercount. An attempt already over budget writes nothing, so hammering a refused key spends
// none of the Free plan's 100,000 D1 rows written a day, which deck saves and sessions share.
//
// Keys are SHA-256 hashes: the table never holds an IP or an email. The daily sweep
// (./sweep.ts) deletes rows whose window has passed.
//
// A D1 error fails CLOSED: the attempt is refused as unavailable (the route's 503) and the error
// is logged. Failing open made a spent write quota an unthrottled password oracle: a wrong guess
// answered 401 and the right one failed at the session insert. Register, login and deletion all
// need a write to succeed, so refusing them costs nothing that would have worked.

import { and, eq, gt, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { RunnableQuery } from "drizzle-orm/runnable-query";
import { authRateLimits } from "../db/schema";
import { logEventThrottled } from "../http/log";
import { toBase64Url } from "./encoding";

/** The login and delete window. */
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
/** Login and delete attempts per (scope, ip, email) per window. */
export const ACCOUNT_MAX_ATTEMPTS = 10;
/** Login and delete attempts per (scope, ip) per window, across every email. */
export const IP_MAX_ATTEMPTS = 50;
/** The register window, and the registers it allows per address (and so per address and email). */
export const REGISTER_WINDOW_MS = 60 * 60 * 1000;
export const REGISTER_MAX_ATTEMPTS = 5;

export type RateLimitScope = "register" | "login" | "delete";

type ScopeBudget = { windowMs: number; accountMax: number; ipMax: number };

const BUDGETS: Record<RateLimitScope, ScopeBudget> = {
  login: {
    windowMs: RATE_LIMIT_WINDOW_MS,
    accountMax: ACCOUNT_MAX_ATTEMPTS,
    ipMax: IP_MAX_ATTEMPTS,
  },
  delete: {
    windowMs: RATE_LIMIT_WINDOW_MS,
    accountMax: ACCOUNT_MAX_ATTEMPTS,
    ipMax: IP_MAX_ATTEMPTS,
  },
  register: {
    windowMs: REGISTER_WINDOW_MS,
    accountMax: REGISTER_MAX_ATTEMPTS,
    ipMax: REGISTER_MAX_ATTEMPTS,
  },
};

export type RateLimitKeys = { scope: RateLimitScope; account: string; ip: string };

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toBase64Url(new Uint8Array(digest));
}

/** The two stored keys for one attempt. `ip` is the route's clientIpKey; the email is
    normalized so casing cannot mint a fresh window. */
export async function rateLimitKeys(
  scope: RateLimitScope,
  ip: string,
  email: string,
): Promise<RateLimitKeys> {
  const [account, address] = await Promise.all([
    sha256(`account\n${scope}\n${ip}\n${email.trim().toLowerCase()}`),
    sha256(`ip\n${scope}\n${ip}`),
  ]);
  return { scope, account, ip: address };
}

type Budget = { key: string; max: number };

/**
 * Counts one attempt against `own`: a missing row or a passed window starts at 1, a live window
 * adds 1. Writes nothing while `own` is already over its max, or while `other` is.
 */
function countAttempt(
  db: DrizzleD1Database,
  own: Budget,
  other: Budget,
  windowMs: number,
  nowMs: number,
) {
  const { resetAt, count } = authRateLimits;
  // Raw SQL is not batchable with parameters in drizzle's D1 driver, so the statement is built
  // on an insert; the select's columns follow the table's: key, count, reset_at.
  return db
    .insert(authRateLimits)
    .select(sql`SELECT ${own.key}, 1, ${nowMs + windowMs}
      WHERE NOT EXISTS (SELECT 1 FROM auth_rate_limits AS other
        WHERE other."key" = ${other.key} AND other.reset_at > ${nowMs} AND other.count > ${other.max})`)
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        count: sql`CASE WHEN ${resetAt} <= ${nowMs} THEN 1 ELSE ${count} + 1 END`,
        resetAt: sql`CASE WHEN ${resetAt} <= ${nowMs} THEN excluded.reset_at ELSE ${resetAt} END`,
      },
      setWhere: sql`${resetAt} <= ${nowMs} OR ${count} <= ${own.max}`,
    });
}

/** When the latest refusing window ends: one row, null when neither key refuses. */
function refusedUntil(db: DrizzleD1Database, account: Budget, ip: Budget, nowMs: number) {
  const { key, resetAt, count } = authRateLimits;
  return db
    .select({ resetAt: sql<number | null>`max(${resetAt})` })
    .from(authRateLimits)
    .where(
      and(
        gt(resetAt, nowMs),
        or(
          and(eq(key, account.key), gt(count, account.max)),
          and(eq(key, ip.key), gt(count, ip.max)),
        ),
      ),
    );
}

/** How long a caller refused because the limiter's batch failed is asked to wait. */
export const UNAVAILABLE_RETRY_SECONDS = 60;

export type LimitedLookup<T> =
  | { allowed: true; found: T }
  | {
      allowed: false;
      /** "limited": over budget, the 429. "unavailable": the batch failed, the 503. */
      reason: "limited" | "unavailable";
      /** Seconds until the refusing window ends, or UNAVAILABLE_RETRY_SECONDS: the Retry-After. */
      retryAfterSeconds: number;
    };

/**
 * Counts this attempt and runs `lookup` in the same batch. A refused attempt carries nothing
 * from the lookup. When the batch fails nothing was counted, so the attempt is refused as
 * unavailable and `lookup` is not retried on its own.
 */
export async function limitAttempt<T>(
  db: DrizzleD1Database,
  keys: RateLimitKeys,
  lookup: () => RunnableQuery<T, "sqlite"> & PromiseLike<T>,
  nowMs: number = Date.now(),
): Promise<LimitedLookup<T>> {
  const budget = BUDGETS[keys.scope];
  const account = { key: keys.account, max: budget.accountMax };
  const ip = { key: keys.ip, max: budget.ipMax };
  let refused: { resetAt: number | null }[];
  let found: T;
  try {
    [, , refused, found] = await db.batch([
      countAttempt(db, account, ip, budget.windowMs, nowMs),
      countAttempt(db, ip, account, budget.windowMs, nowMs),
      refusedUntil(db, account, ip, nowMs),
      lookup(),
    ]);
  } catch (error) {
    logLimiterError(error);
    return { allowed: false, reason: "unavailable", retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS };
  }
  const resetAt = refused[0]?.resetAt ?? null;
  return resetAt === null
    ? { allowed: true, found }
    : {
        allowed: false,
        reason: "limited",
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - nowMs) / 1000)),
      };
}

/** D1's message may echo the statement, so only the error's name and whether it reads as a spent
    quota are logged. */
function logLimiterError(error: unknown): void {
  logEventThrottled("auth", "limiter_error", {
    error: error instanceof Error ? error.name : typeof error,
    quota: error instanceof Error && /exceeded/i.test(error.message),
  });
}
