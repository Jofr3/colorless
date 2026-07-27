// /auth — accounts and sessions (§3.5, §6): email/password register + login,
// server sessions in D1 behind an http-only cookie, Discord/Google OAuth
// (config-gated), and 501 stubs for the email-dependent flows.
//
// House style as everywhere: the pure logic lives in the sibling modules
// (password / session / oauth / rateLimit, all unit-tested); this file owns
// request validation, the D1 queries, and response shaping — every user
// payload boundary-parsed through @luminous/schema userSchema, which also
// guarantees no password/hash field can ever leak.

import { zValidator } from "@hono/zod-validator";
import {
  loginRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
  type User,
  userSchema,
} from "@luminous/schema";
import { and, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { decks, oauthIdentities, sessions, users } from "../db/schema";
import { appOrigin, type Env } from "../env";
import { avatarSeedOf } from "./avatar";
import {
  buildAuthorizeUrl,
  clearedStateCookie,
  generateState,
  OAUTH_STATE_COOKIE,
  type OAuthProfile,
  type OAuthProvider,
  oauthConfig,
  packStateCookieValue,
  parseOAuthProfile,
  parseProvider,
  parseTokenResponse,
  sanitizeRedirect,
  stateCookie,
  tokenRequest,
  unpackStateCookieValue,
} from "./oauth";
import { DUMMY_PASSWORD_HASH, hashPassword, passwordNeedsRehash, verifyPassword } from "./password";
import { checkRateLimit, type RateLimitScope, rateLimitKey } from "./rateLimit";
import { requireUser } from "./requireUser";
import {
  clearedSessionCookie,
  generateSessionToken,
  hashSessionToken,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookie,
} from "./session";

export const authRoutes = new Hono<{ Bindings: Env }>();

type Db = DrizzleD1Database;
type UserRow = typeof users.$inferSelect;
type AuthContext = Context<{ Bindings: Env }>;

/** Row → public User (schema-parsed at each route's boundary). */
function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    emailVerified: row.emailVerified,
    // Derived, never stored (P5-2): the same token the lobby broadcasts for
    // this account, so a player's profile draws the face opponents see.
    avatarSeed: avatarSeedOf(row.id),
    // The stored CHOICE (P5-7), just the id — /settings resolves its cover +
    // name from GET /decks. The FK's SET NULL guarantees a non-null id is a
    // live deck of this account's.
    favouriteDeckId: row.favouriteDeckId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Terse 400 for bad request bodies, mirroring the catalog's invalid-query
    shape. zValidator surfaces the zod-core error type, hence z.core.$ZodError. */
function invalidBody(c: Context, error: z.core.$ZodError) {
  const issues = error.issues.map(
    (issue) => `${issue.path.map(String).join(".") || "body"}: ${issue.message}`,
  );
  return c.json({ error: "invalid body", issues }, 400);
}

/** Best-effort caller IP for rate-limit keys — Cloudflare sets this header
    on every request (wrangler dev included). */
function clientIp(c: AuthContext): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

/** Count this attempt; a 429 Response when over budget, null to proceed. */
async function guardRateLimit(
  c: AuthContext,
  scope: RateLimitScope,
  email: string,
): Promise<Response | null> {
  const decision = await checkRateLimit(c.env.CACHE, rateLimitKey(scope, clientIp(c), email));
  if (decision.allowed) {
    return null;
  }
  c.header("Retry-After", String(decision.retryAfterSeconds));
  return c.json({ error: "too many attempts" }, 429);
}

/** Mint a token + its sessions row (id = sha256(token), 30-day expiry).
    The caller inserts the row — alone or inside a batch. */
async function newSession(userId: string) {
  const token = generateSessionToken();
  return {
    token,
    row: {
      id: await hashSessionToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  };
}

/** D1 surfaces SQLite constraint failures as message text — good enough to
    turn a register/link race into a 409 instead of a 500. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

// --- email + password ------------------------------------------------------

authRoutes.post(
  "/register",
  zValidator("json", registerRequestSchema, (result, c) =>
    result.success ? undefined : invalidBody(c, result.error),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const limited = await guardRateLimit(c, "register", body.email);
    if (limited) {
      return limited;
    }
    const db = drizzle(c.env.DB);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .get();
    if (existing !== undefined) {
      return c.json({ error: "email already registered" }, 409);
    }
    const row: UserRow = {
      id: crypto.randomUUID(),
      email: body.email,
      // Default display name: the email's local part (user can rename later).
      displayName: body.displayName ?? body.email.split("@")[0] ?? body.email,
      passwordHash: await hashPassword(body.password),
      emailVerified: false,
      favouriteDeckId: null,
      createdAt: new Date(),
    };
    const session = await newSession(row.id);
    try {
      await db.batch([db.insert(users).values(row), db.insert(sessions).values(session.row)]);
    } catch (error) {
      // Two concurrent registers for one email: the UNIQUE index catches what
      // the pre-check raced past.
      if (isUniqueViolation(error)) {
        return c.json({ error: "email already registered" }, 409);
      }
      throw error;
    }
    c.header("Set-Cookie", sessionCookie(session.token));
    return c.json(userSchema.parse(mapUserRow(row)), 201);
  },
);

authRoutes.post(
  "/login",
  zValidator("json", loginRequestSchema, (result, c) =>
    result.success ? undefined : invalidBody(c, result.error),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const limited = await guardRateLimit(c, "login", body.email);
    if (limited) {
      return limited;
    }
    const db = drizzle(c.env.DB);
    const row = await db.select().from(users).where(eq(users.email, body.email)).get();
    // Unknown email and password-less (OAuth-only) accounts still burn one
    // PBKDF2 verify against a throwaway hash — timing parity with the wrong-
    // password path, and ONE message for every failure (§3.5): no oracle for
    // which field was wrong.
    const verified = await verifyPassword(body.password, row?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (row === undefined || row.passwordHash === null || !verified) {
      return c.json({ error: "invalid email or password" }, 401);
    }
    // Iteration upgrade path: re-hash at today's DEFAULT_ITERATIONS while we
    // hold the plaintext.
    if (passwordNeedsRehash(row.passwordHash)) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(body.password) })
        .where(eq(users.id, row.id));
    }
    const session = await newSession(row.id);
    await db.insert(sessions).values(session.row);
    c.header("Set-Cookie", sessionCookie(session.token));
    return c.json(userSchema.parse(mapUserRow(row)));
  },
);

// --- session ----------------------------------------------------------------

// Session resolution (cookie → user, expiry-on-read, lazy dead-row delete)
// lives in requireUser — shared with /decks and /folders (milestone 7); /me
// is just "echo the resolved caller".
authRoutes.get("/me", requireUser, (c) => c.json(userSchema.parse(mapUserRow(c.get("user")))));

// Editing your own account (P5-5 — polish.md "Profiles"). The name P5-1 made
// authoritative was, until now, whatever register chose: the lobby broadcasts
// it to the opponent and to spectators, so being unable to change it is a real
// gap, not a nicety. requireUser runs BEFORE validation deliberately — a
// signed-out caller should hear "unauthorized", not a critique of their body.
authRoutes.patch(
  "/me",
  requireUser,
  zValidator("json", updateProfileRequestSchema, (result, c) =>
    result.success ? undefined : invalidBody(c, result.error),
  ),
  async (c) => {
    const row = c.get("user");
    const { displayName, favouriteDeckId } = c.req.valid("json");
    const db = drizzle(c.env.DB);

    const changes: Partial<Pick<UserRow, "displayName" | "favouriteDeckId">> = {};
    if (displayName !== row.displayName) {
      changes.displayName = displayName;
    }
    // The favourite (P5-7). Absent (undefined) leaves it untouched; null clears
    // it; a non-null id must be one of the CALLER'S OWN decks — anyone else's or
    // a phantom is a 400, not a row that would resolve to nothing on the
    // profile. An UNCHANGED non-null id skips the check: the FK's ON DELETE SET
    // NULL means it can't have gone stale under us.
    if (favouriteDeckId !== undefined && favouriteDeckId !== row.favouriteDeckId) {
      if (favouriteDeckId !== null) {
        const owned = await db
          .select({ id: decks.id })
          .from(decks)
          .where(and(eq(decks.id, favouriteDeckId), eq(decks.userId, row.id)))
          .get();
        if (owned === undefined) {
          return c.json({ error: "favourite deck not found" }, 400);
        }
      }
      changes.favouriteDeckId = favouriteDeckId;
    }

    // No write when nothing changed: the form disables Save in that case, but
    // the route is the api, and a re-submit shouldn't cost a D1 write.
    if (Object.keys(changes).length > 0) {
      await db.update(users).set(changes).where(eq(users.id, row.id));
    }
    // The updated row, not a re-read: this session owns the only change.
    return c.json(
      userSchema.parse(
        mapUserRow({
          ...row,
          displayName,
          favouriteDeckId: favouriteDeckId === undefined ? row.favouriteDeckId : favouriteDeckId,
        }),
      ),
    );
  },
);

authRoutes.post("/logout", async (c) => {
  const token = readCookie(c.req.header("Cookie"), SESSION_COOKIE);
  if (token !== null) {
    await drizzle(c.env.DB)
      .delete(sessions)
      .where(eq(sessions.id, await hashSessionToken(token)));
  }
  c.header("Set-Cookie", clearedSessionCookie());
  return c.body(null, 204);
});

// --- OAuth (Discord / Google) ------------------------------------------------

/** Our callback URL on THIS deployment — derived from the request origin, so
    dev (localhost:8787) and prod (workers.dev) register their own URIs. */
function callbackUrl(c: AuthContext, provider: OAuthProvider): string {
  return `${new URL(c.req.url).origin}/auth/oauth/${provider}/callback`;
}

authRoutes.get("/oauth/:provider", (c) => {
  const provider = parseProvider(c.req.param("provider"));
  if (provider === null) {
    return c.json({ error: "unknown provider" }, 404);
  }
  const config = oauthConfig(c.env, provider);
  if (config === null) {
    return c.json({ error: "provider not configured" }, 503);
  }
  const state = generateState();
  const redirect = sanitizeRedirect(c.req.query("redirect"));
  c.header("Set-Cookie", stateCookie(packStateCookieValue(state, redirect)));
  return c.redirect(buildAuthorizeUrl(config, callbackUrl(c, provider), state), 302);
});

authRoutes.get("/oauth/:provider/callback", async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  if (provider === null) {
    return c.json({ error: "unknown provider" }, 404);
  }
  const config = oauthConfig(c.env, provider);
  if (config === null) {
    return c.json({ error: "provider not configured" }, 503);
  }
  // The state cookie is single-use: cleared on every callback outcome.
  const packed = unpackStateCookieValue(readCookie(c.req.header("Cookie"), OAUTH_STATE_COOKIE));
  c.header("Set-Cookie", clearedStateCookie());
  const state = c.req.query("state");
  const code = c.req.query("code");
  if (!code || !state || packed === null || packed.state !== state) {
    return c.json({ error: "invalid oauth state" }, 400);
  }

  // Code → access token.
  const exchange = tokenRequest(config, code, callbackUrl(c, provider));
  const tokenResponse = await fetch(exchange.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: exchange.body,
  });
  const accessToken = tokenResponse.ok ? parseTokenResponse(await tokenResponse.json()) : null;
  if (accessToken === null) {
    return c.json({ error: "oauth code exchange failed" }, 502);
  }

  // Access token → normalized profile.
  const profileResponse = await fetch(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = profileResponse.ok
    ? parseOAuthProfile(provider, await profileResponse.json())
    : null;
  if (profile === null) {
    return c.json({ error: "oauth profile fetch failed" }, 502);
  }

  const db = drizzle(c.env.DB);
  const result = await findOrCreateOAuthUser(db, provider, profile);
  if (result === "no-email") {
    return c.json({ error: "provider did not supply an email" }, 400);
  }
  if (result === "email-in-use") {
    // The provider email matches an existing account but is NOT provider-
    // verified — linking would let anyone with an unverified alias take the
    // account over.
    return c.json({ error: "email already in use" }, 409);
  }
  const session = await newSession(result.id);
  await db.insert(sessions).values(session.row);
  c.header("Set-Cookie", sessionCookie(session.token), { append: true });
  return c.redirect(`${appOrigin(c.env)}${packed.redirect}`, 302);
});

/** §3.5 find-or-create: linked identity → that user; verified-email match →
    link identity to the existing user; otherwise a fresh user + identity. */
async function findOrCreateOAuthUser(
  db: Db,
  provider: OAuthProvider,
  profile: OAuthProfile,
): Promise<UserRow | "no-email" | "email-in-use"> {
  const linked = await db
    .select({ user: users })
    .from(oauthIdentities)
    .innerJoin(users, eq(oauthIdentities.userId, users.id))
    .where(
      and(
        eq(oauthIdentities.provider, provider),
        eq(oauthIdentities.providerId, profile.providerId),
      ),
    )
    .get();
  if (linked !== undefined) {
    return linked.user;
  }
  if (profile.email === null) {
    // users.email is NOT NULL UNIQUE — nothing to key a new account on.
    return "no-email";
  }
  const identity = { provider, providerId: profile.providerId };
  const existing = await db.select().from(users).where(eq(users.email, profile.email)).get();
  if (existing !== undefined) {
    if (!profile.emailVerified) {
      return "email-in-use";
    }
    // Link, and promote emailVerified — the provider just attested it.
    await db.batch([
      db.insert(oauthIdentities).values({ ...identity, userId: existing.id }),
      db.update(users).set({ emailVerified: true }).where(eq(users.id, existing.id)),
    ]);
    return { ...existing, emailVerified: true };
  }
  const row: UserRow = {
    id: crypto.randomUUID(),
    email: profile.email,
    displayName: profile.displayName,
    passwordHash: null,
    emailVerified: profile.emailVerified,
    favouriteDeckId: null,
    createdAt: new Date(),
  };
  await db.batch([
    db.insert(users).values(row),
    db.insert(oauthIdentities).values({ ...identity, userId: row.id }),
  ]);
  return row;
}

// --- email-dependent flows: stubs -------------------------------------------
// TODO(§3.5): verify-email + reset-password need an outbound email provider,
// which is not chosen yet. Deliberately NO token tables/plumbing until it is
// — the 501s keep the §6 surface honest in the meantime.

const EMAIL_NOT_IMPLEMENTED = {
  error: "not implemented",
  detail: "requires an outbound email provider, not yet chosen (backend-data.md §3.5)",
} as const;

authRoutes.post("/verify-email", (c) => c.json(EMAIL_NOT_IMPLEMENTED, 501));
authRoutes.post("/reset-password", (c) => c.json(EMAIL_NOT_IMPLEMENTED, 501));
