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
import { clearedSessionCookie, hashSessionToken, readCookie, SESSION_COOKIE } from "./session";

export type UserRow = typeof users.$inferSelect;

/** Hono env for routes behind requireUser: `c.get("user")` is the caller. */
export type AuthedEnv = { Bindings: Env; Variables: { user: UserRow } };

export const requireUser = createMiddleware<AuthedEnv>(async (c, next) => {
  const token = readCookie(c.req.header("Cookie"), SESSION_COOKIE);
  if (token === null) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const sessionId = await hashSessionToken(token);
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
  // Expiry enforced on read; the dead row is deleted lazily right here —
  // no background sweeper needed at this scale.
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    c.header("Set-Cookie", clearedSessionCookie());
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", row.user);
  await next();
});
