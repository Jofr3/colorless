// resolveSession — the READ-ONLY "who is this socket" resolver for the lobby WS
// (P4 increment 3). Unlike `requireUser` (which gates HTTP routes: it 401s,
// clears a dead cookie, and lazily deletes an expired session row), this only
// answers "which user id, if any, does this Cookie header authenticate?" — null
// for anonymous, an absent/expired session, or a cookie that doesn't resolve.
//
// Read-only on purpose: connecting a lobby socket must not mutate auth state,
// and the lobby stays usable anonymously (a null userId just means the socket
// can't start a match with a saved deck). The DO calls this at the /ws upgrade
// so it can later owner-scope that player's deck read at the match handoff — the
// only authenticated identity the otherwise account-less lobby has.

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
