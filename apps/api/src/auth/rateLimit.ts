// Fixed-window rate limiting for register, login and account deletion (§3.5), in the D1 table
// `auth_rate_limits`. Each scope has its own windows: deletion asks for the current password, so
// without a budget a stolen session cookie could guess it at full speed.
//
// Every attempt counts against two keys. The (scope, ip, email) key allows 10 per 15 minutes,
// which is what slows a password guesser on one account. The (scope, ip) key allows 50, which
// stops one address cycling through emails while leaving room for a household, office or
// school behind one NAT address, where several people sign in and mistype within the same
// quarter hour. An attempt refused by the account key does not count against the address, so
// one locked-out account does not use up its neighbours' budget.
//
// The counting statements run in the same D1 batch as the route's user lookup: no extra round
// trip, and since D1 runs a batch as one serial transaction, concurrent attempts cannot
// undercount. An attempt already over budget writes nothing, so hammering a refused key spends
// none of the Free plan's 100,000 D1 rows written a day, which deck saves and sessions share.
//
// Keys are SHA-256 hashes: the table never holds an IP or an email. The daily sweep
// (./sweep.ts) deletes rows whose window has passed.
//
// A D1 error fails OPEN: the attempt proceeds unlimited and the error is logged, so a spent
// write quota or a transient failure does not also take sign-in down.

import { and, eq, gt, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { RunnableQuery } from "drizzle-orm/runnable-query";
import { authRateLimits } from "../db/schema";
import { logEventThrottled } from "../http/log";
import { toBase64Url } from "./encoding";

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
/** Attempts per (scope, ip, email) per window. */
export const ACCOUNT_MAX_ATTEMPTS = 10;
/** Attempts per (scope, ip) per window, across every email. */
export const IP_MAX_ATTEMPTS = 50;

export type RateLimitScope = "register" | "login" | "delete";

export type RateLimitKeys = { account: string; ip: string };

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
  return { account, ip: address };
}

type Budget = { key: string; max: number };

/**
 * Counts one attempt against `own`: a missing row or a passed window starts at 1, a live window
 * adds 1. Writes nothing while `own` is already over its max, or while `other` is.
 */
function countAttempt(db: DrizzleD1Database, own: Budget, other: Budget, nowMs: number) {
  const { resetAt, count } = authRateLimits;
  // Raw SQL is not batchable with parameters in drizzle's D1 driver, so the statement is built
  // on an insert; the select's columns follow the table's: key, count, reset_at.
  return db
    .insert(authRateLimits)
    .select(sql`SELECT ${own.key}, 1, ${nowMs + RATE_LIMIT_WINDOW_MS}
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

export type LimitedLookup<T> =
  | { allowed: true; found: T }
  | {
      allowed: false;
      /** Seconds until the refusing window ends: the 429's Retry-After. */
      retryAfterSeconds: number;
    };

/**
 * Counts this attempt and runs `lookup` in the same batch. A refused attempt carries nothing
 * from the lookup. When the batch fails the attempt is allowed and `lookup` runs alone, so a
 * lookup error still surfaces.
 */
export async function limitAttempt<T>(
  db: DrizzleD1Database,
  keys: RateLimitKeys,
  lookup: () => RunnableQuery<T, "sqlite"> & PromiseLike<T>,
  nowMs: number = Date.now(),
): Promise<LimitedLookup<T>> {
  const account = { key: keys.account, max: ACCOUNT_MAX_ATTEMPTS };
  const ip = { key: keys.ip, max: IP_MAX_ATTEMPTS };
  let refused: { resetAt: number | null }[];
  let found: T;
  try {
    [, , refused, found] = await db.batch([
      countAttempt(db, account, ip, nowMs),
      countAttempt(db, ip, account, nowMs),
      refusedUntil(db, account, ip, nowMs),
      lookup(),
    ]);
  } catch (error) {
    logLimiterError(error);
    return { allowed: true, found: await lookup() };
  }
  const resetAt = refused[0]?.resetAt ?? null;
  return resetAt === null
    ? { allowed: true, found }
    : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - nowMs) / 1000)) };
}

/** D1's message may echo the statement, so only the error's name and whether it reads as a spent
    quota are logged. */
function logLimiterError(error: unknown): void {
  logEventThrottled("auth", "limiter_error", {
    error: error instanceof Error ? error.name : typeof error,
    quota: error instanceof Error && /exceeded/i.test(error.message),
  });
}
