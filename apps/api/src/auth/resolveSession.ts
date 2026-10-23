// Read-only session resolver for the lobby WebSocket: unlike `requireUser` it never 401s, clears
// cookies or deletes expired rows, so connecting a socket cannot mutate auth state.

import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sessions } from "../db/schema";
import { hashSessionToken, readCookie, SESSION_COOKIE } from "./session";

/** The user id the `session` cookie authenticates, or null (no cookie / an
    unknown or expired session). One indexed `sessions` read; no D1 hit at all
    when there is no cookie (the anonymous fast path). */
export async function resolveUserIdFromCookie(
  db: DrizzleD1Database,
  cookieHeader: string | null | undefined,
): Promise<string | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (token === null) return null;
  const sessionId = await hashSessionToken(token);
  const row = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (row === undefined || row.expiresAt.getTime() <= Date.now()) return null;
  return row.userId;
}
