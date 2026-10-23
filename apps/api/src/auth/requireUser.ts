// requireUser — the shared "who is calling" gate (§3.5), extracted in P1
// milestone 7 so /auth/me and the /decks + /folders routes resolve sessions
// through ONE code path: read the `session` cookie, hash the token to the
// sessions row id, join the user, enforce expiry on read (deleting the dead
// row lazily), and either stash the user row on the context or answer 401.
//
// The cookie is cleared only when a token WAS presented but didn't resolve —
// a cookie-less request gets a bare 401 without touching D1, which is also
// what lets route tests prove the gate runs before any query.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import { sessions, users } from "../db/schema";
import type { Env } from "../env";
import { clearedSessionCookie, sessionExpired, sessionIdFromCookie } from "./session";

export type UserRow = typeof users.$inferSelect;

/** Hono env for routes behind requireUser: `c.get("user")` is the caller. */
export type AuthedEnv = { Bindings: Env; Variables: { user: UserRow } };

export const requireUser = createMiddleware<AuthedEnv>(async (c, next) => {
  const sessionId = await sessionIdFromCookie(c.req.header("Cookie"));
  if (sessionId === null) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const db = drizzle(c.env.DB);
  const row = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .get();
  if (row === undefined) {
    c.header("Set-Cookie", clearedSessionCookie());
    return c.json({ error: "unauthorized" }, 401);
  }
  // The dead row is deleted lazily here; there is no background sweeper.
  if (sessionExpired(row.expiresAt)) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    c.header("Set-Cookie", clearedSessionCookie());
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", row.user);
  await next();
});
