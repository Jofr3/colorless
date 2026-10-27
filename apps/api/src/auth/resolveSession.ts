// Read-only session resolver for the lobby WebSocket: unlike `requireUser` it never 401s, clears
// cookies or deletes expired rows, so connecting a socket cannot mutate auth state.

import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sessions, users } from "../db/schema";
import { sessionExpired, sessionIdFromCookie } from "./session";

/** The account a session cookie authenticates: its id, the sessions row id (the token's hash) that
    authenticated it, so a long-lived socket can re-check the session later, and its stored display
    name, which is null when the session outlived its user row. */
export type SessionAccount = { userId: string; sessionId: string; displayName: string | null };

/** The account the `session` cookie authenticates, or null (no cookie / an
    unknown or expired session). One indexed `sessions` read joined to the user
    row; no D1 hit at all when there is no cookie (the anonymous fast path). */
export async function resolveAccountFromCookie(
  db: DrizzleD1Database,
  cookieHeader: string | null | undefined,
): Promise<SessionAccount | null> {
  const sessionId = await sessionIdFromCookie(cookieHeader);
  if (sessionId === null) return null;
  const row = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      displayName: users.displayName,
    })
    .from(sessions)
    .leftJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .get();
  if (row === undefined || sessionExpired(row.expiresAt)) return null;
  return { userId: row.userId, sessionId, displayName: row.displayName };
}
