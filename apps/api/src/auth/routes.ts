// /auth — accounts and sessions (§3.5, §6): email/password register + login,
// server sessions in D1 behind an http-only cookie, Google OAuth
// (config-gated), and 501 stubs for the email-dependent flows.
//
// House style as everywhere: the pure logic lives in the sibling modules
// (password / session / oauth / rateLimit, all unit-tested); this file owns
// request validation, the D1 queries, and response shaping — every user
// payload boundary-parsed through @colorless/schema userSchema, which also
// guarantees no password/hash field can ever leak.

import {
  deleteAccountRequestSchema,
  loginRequestSchema,
  type OAuthFailure,
  type OAuthProvider,
  registerRequestSchema,
  updateProfileRequestSchema,
  type User,
  userSchema,
} from "@colorless/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import { oauthIdentities, sessions, users } from "../db/schema";
import { appOrigin, type Env } from "../env";
import { bindingRefusal, bindingRefuses } from "../http/bindingLimit";
import { clientIpKey } from "../http/clientIp";
import { chainMentions } from "../http/errors";
import { logEvent, logEventThrottled } from "../http/log";
import { validate } from "../http/validation";
import { privateRevalidate } from "../httpCache";
import { avatarSeedOf } from "./avatar";
import {
  buildAuthorizeUrl,
  clearedStateCookie,
  generateState,
  OAUTH_STATE_COOKIE,
  type OAuthProfile,
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
import { limitAttempt, type RateLimitScope, rateLimitKeys } from "./rateLimit";
import { requireUser, type UserRow } from "./requireUser";
import {
  clearedSessionCookie,
  generateSessionToken,
  hashSessionToken,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookie,
  sessionIdFromCookie,
} from "./session";

export const authRoutes = new Hono<{ Bindings: Env }>();

type Db = DrizzleD1Database;
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
    hasPassword: row.passwordHash !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Count this attempt and run `lookup` in one D1 batch. An over-budget attempt answers 429, and
    one the limiter could not count (a D1 error, such as a spent write quota) 503; neither exposes
    anything about the lookup.

    The AUTH_LIMIT binding comes first, per scope and address: 10 a minute, which no person
    signing in reaches, refuses a flood before the D1 limiter spends a write counting it (AUX1).
    It fails open (http/bindingLimit.ts); the D1 limiter behind it fails closed. */
async function afterRateLimit<T, E extends { Bindings: Env }>(
  c: Context<E>,
  db: Db,
  scope: RateLimitScope,
  email: string,
  lookup: Parameters<typeof limitAttempt<T>>[2],
): Promise<{ limited: Response } | { limited: null; found: T }> {
  const ip = clientIpKey(c);
  if (await bindingRefuses(c.env.AUTH_LIMIT, `${scope}:${ip}`, "auth", scope)) {
    logEventThrottled("auth", "rate_limited", { scope, by: "binding" });
    return { limited: bindingRefusal(c, "too many attempts") };
  }
  const keys = await rateLimitKeys(scope, ip, email);
  const attempt = await limitAttempt(db, keys, lookup);
  if (attempt.allowed) {
    return { limited: null, found: attempt.found };
  }
  c.header("Retry-After", String(attempt.retryAfterSeconds));
  if (attempt.reason === "unavailable") {
    return { limited: c.json({ error: "temporarily unavailable, try again later" }, 503) };
  }
  // Throttled: a brute-force burst answers 429 on every attempt past the budget.
  logEventThrottled("auth", "rate_limited", { scope });
  return { limited: c.json({ error: "too many attempts" }, 429) };
}

/** Deletes the user's expired sessions. Expiry is enforced on read, so this only keeps the table
    from growing with abandoned rows; it rides along whenever the user signs in. */
function sweepExpiredSessions(db: Db, userId: string) {
  return db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, new Date())));
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

type SessionRow = Awaited<ReturnType<typeof newSession>>["row"];

/** A password login's session insert, as INSERT … SELECT from the user's row while it still holds
    the hash that was verified. The verify is slow, and an OAuth verified-email link that commits
    during it clears the password and deletes the sessions; the insert then selects nothing, rather
    than minting a session for the credential the link revoked. */
function insertSessionWhilePasswordHolds(db: Db, row: SessionRow, passwordHash: string) {
  return db.insert(sessions).select(
    db
      .select({
        id: sql<string>`${row.id}`.as("id"),
        userId: users.id,
        expiresAt: sql<Date>`${row.expiresAt.getTime()}`.as("expires_at"),
        // The column's default, which a select-sourced insert does not apply.
        createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
      })
      .from(users)
      .where(and(eq(users.id, row.userId), eq(users.passwordHash, passwordHash))),
  );
}

/** A fresh users row: a new id, no favourite deck, created now. */
function newUserRow(
  fields: Pick<UserRow, "email" | "displayName" | "passwordHash" | "emailVerified">,
): UserRow {
  return { id: crypto.randomUUID(), ...fields, favouriteDeckId: null, createdAt: new Date() };
}

/** D1 surfaces SQLite constraint failures as message text — good enough to
    turn a register/link race into a 409 instead of a 500. A batch throws D1's error itself; a
    single query throws drizzle's wrapper, which keeps that text on `cause`. */
function isUniqueViolation(error: unknown): boolean {
  return chainMentions(error, /UNIQUE constraint failed/);
}

// --- email + password ------------------------------------------------------

authRoutes.post("/register", validate("json", registerRequestSchema), async (c) => {
  const body = c.req.valid("json");
  const db = drizzle(c.env.DB);
  const attempt = await afterRateLimit(c, db, "register", body.email, () =>
    db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1),
  );
  if (attempt.limited) {
    return attempt.limited;
  }
  const existing = attempt.found[0];
  if (existing !== undefined) {
    return c.json({ error: "email already registered" }, 409);
  }
  const row = newUserRow({
    email: body.email,
    // Default display name: the email's local part (user can rename later).
    displayName: body.displayName ?? body.email.split("@")[0] ?? body.email,
    passwordHash: await hashPassword(body.password),
    emailVerified: false,
  });
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
});

authRoutes.post("/login", validate("json", loginRequestSchema), async (c) => {
  const body = c.req.valid("json");
  const db = drizzle(c.env.DB);
  const attempt = await afterRateLimit(c, db, "login", body.email, () =>
    db.select().from(users).where(eq(users.email, body.email)).limit(1),
  );
  if (attempt.limited) {
    return attempt.limited;
  }
  const row = attempt.found[0];
  // Unknown email and password-less (OAuth-only) accounts still burn one
  // PBKDF2 verify against a throwaway hash — timing parity with the wrong-
  // password path, and ONE message for every failure (§3.5): no oracle for
  // which field was wrong.
  const verified = await verifyPassword(body.password, row?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (row === undefined || row.passwordHash === null || !verified) {
    logEvent("auth", "login_failed", {
      reason:
        row === undefined
          ? "unknown_email"
          : row.passwordHash === null
            ? "no_password"
            : "wrong_password",
    });
    return c.json({ error: "invalid email or password" }, 401);
  }
  const session = await newSession(row.id);
  // Iteration upgrade path: re-hash at today's DEFAULT_ITERATIONS while we
  // hold the plaintext. Scoped to the verified hash, like the session insert,
  // so it cannot restore a password an OAuth link cleared meanwhile.
  const rehash = passwordNeedsRehash(row.passwordHash)
    ? [
        db
          .update(users)
          .set({ passwordHash: await hashPassword(body.password) })
          .where(and(eq(users.id, row.id), eq(users.passwordHash, row.passwordHash))),
      ]
    : [];
  // The insert runs before the rehash, which changes the hash it checks.
  const [, inserted] = await db.batch([
    sweepExpiredSessions(db, row.id),
    insertSessionWhilePasswordHolds(db, session.row, row.passwordHash),
    ...rehash,
  ]);
  if (inserted.meta.changes === 0) {
    logEvent("auth", "login_failed", { reason: "credential_changed" });
    return c.json({ error: "invalid email or password" }, 401);
  }
  c.header("Set-Cookie", sessionCookie(session.token));
  return c.json(userSchema.parse(mapUserRow(row)));
});

// --- session ----------------------------------------------------------------

// Session resolution (cookie → user, expiry-on-read, lazy dead-row delete)
// lives in requireUser, shared with /decks; /me
// is just "echo the resolved caller".
// ETagged `private, no-cache` (../httpCache.ts): the boot probe revalidates
// to a 304 while the profile is unchanged.
// The session check re-sends the cookie with its current attributes and remaining lifetime, so a
// cookie set before the move to SameSite=Lax (2026-10-27) is replaced on the next page load
// instead of living out its 30 days.
authRoutes.get("/me", privateRevalidate, requireUser, (c) => {
  const token = readCookie(c.req.header("Cookie"), SESSION_COOKIE);
  const remaining = Math.floor((c.get("sessionExpiresAt").getTime() - Date.now()) / 1000);
  if (token !== null && remaining > 0) c.header("Set-Cookie", sessionCookie(token, remaining));
  return c.json(userSchema.parse(mapUserRow(c.get("user"))));
});

// Editing your own account (P5-5 — polish.md "Profiles"). The name P5-1 made
// authoritative was, until now, whatever register chose: the lobby broadcasts
// it to the opponent and to spectators, so being unable to change it is a real
// gap, not a nicety. requireUser runs BEFORE validation deliberately — a
// signed-out caller should hear "unauthorized", not a critique of their body.
authRoutes.patch("/me", requireUser, validate("json", updateProfileRequestSchema), async (c) => {
  const row = c.get("user");
  // A `favouriteDeckId` from an older client is stripped by the schema: the field is retired and
  // the column is left as it stands.
  const { displayName } = c.req.valid("json");

  // No write when nothing changed: the form disables Save in that case, but
  // the route is the api, and a re-submit shouldn't cost a D1 write.
  if (displayName !== row.displayName) {
    await drizzle(c.env.DB).update(users).set({ displayName }).where(eq(users.id, row.id));
  }
  // The updated row, not a re-read: this session owns the only change.
  return c.json(userSchema.parse(mapUserRow({ ...row, displayName })));
});

// Deleting your own account (database audit OP6). One statement: every table holding the user's
// data references users ON DELETE CASCADE (sessions, oauth_identities, folders, decks and through
// them deck_cards), so the delete takes this session and every other with it. Rate-limit rows are
// hashed and age out on their own; a lobby seat bound to the id only ever compares it, and a deck
// read for it finds nothing.
authRoutes.delete("/me", requireUser, validate("json", deleteAccountRequestSchema), async (c) => {
  const row = c.get("user");
  const { password, confirmEmail } = c.req.valid("json");
  const db = drizzle(c.env.DB);
  // A password account proves it is its owner at the keyboard, not only a holder of the cookie.
  // An OAuth-only account has no secret to ask for, so it types its email: a request made with the
  // cookie but without the person (a forged command, a framed click) does not delete it.
  let verifiedHash: string | null = null;
  if (row.passwordHash === null) {
    if (confirmEmail?.trim().toLowerCase() !== row.email.toLowerCase()) {
      logEvent("auth", "delete_failed", {
        reason: confirmEmail === undefined ? "no_confirm_email" : "wrong_confirm_email",
      });
      return c.json({ error: "email confirmation mismatch" }, 403);
    }
  } else {
    // The hash is re-read with the attempt count, since the verify below is slow either way.
    const attempt = await afterRateLimit(c, db, "delete", row.email, () =>
      db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, row.id)),
    );
    if (attempt.limited) {
      return attempt.limited;
    }
    const hash = attempt.found[0]?.passwordHash ?? null;
    if (password === undefined || hash === null || !(await verifyPassword(password, hash))) {
      logEvent("auth", "delete_failed", {
        reason: password === undefined ? "no_password" : "wrong_password",
      });
      return c.json({ error: "invalid password" }, 401);
    }
    verifiedHash = hash;
  }
  // Scoped to the verified hash, like the login's session insert: an OAuth link that cleared the
  // password during the verify also ended this session, so the delete then matches nothing.
  const deleted = await db
    .delete(users)
    .where(
      verifiedHash === null
        ? eq(users.id, row.id)
        : and(eq(users.id, row.id), eq(users.passwordHash, verifiedHash)),
    );
  // With no password to scope by, nothing matched means a concurrent delete already did the work.
  if (deleted.meta.changes === 0 && verifiedHash !== null) {
    logEvent("auth", "delete_failed", { reason: "credential_changed" });
    return c.json({ error: "invalid password" }, 401);
  }
  // Nothing that identifies the account: it no longer exists.
  logEvent("auth", "account_deleted", {});
  c.header("Set-Cookie", clearedSessionCookie());
  return c.body(null, 204);
});

authRoutes.post("/logout", async (c) => {
  const sessionId = await sessionIdFromCookie(c.req.header("Cookie"));
  if (sessionId !== null) {
    await drizzle(c.env.DB).delete(sessions).where(eq(sessions.id, sessionId));
  }
  c.header("Set-Cookie", clearedSessionCookie());
  return c.body(null, 204);
});

// --- OAuth (Google) ------------------------------------------------

/** Use the public API origin behind an HTTPS proxy, otherwise the request
    origin, so each deployment registers its own callback URI. */
function callbackUrl(c: AuthContext, provider: OAuthProvider): string {
  const origin = new URL(c.env.API_ORIGIN ?? c.req.url).origin;
  return `${origin}/auth/oauth/${provider}/callback`;
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

/** The callback is a top-level browser navigation, so failures go back to the
    app page with a code rather than rendering JSON at the API origin. */
function oauthFailureRedirect(env: Env, redirect: string, failure: OAuthFailure): string {
  const url = new URL(redirect, appOrigin(env));
  url.searchParams.set("authError", failure);
  return url.toString();
}

type Upstream = {
  /** The JSON body of a 2xx response; null for a network error, a non-2xx status or a body that
      is not JSON. */
  json: unknown;
  /** The HTTP status, or null when the fetch itself failed. */
  status: number | null;
  /** The OAuth `error` code of a failed response (redirect_uri_mismatch, invalid_client, ...). */
  providerError: string | null;
};

/** The provider's error code from a JSON body, kept only when it looks like one: the line it lands
    in must not carry free text. */
function providerErrorOf(json: unknown): string | null {
  const code =
    typeof json === "object" && json !== null && "error" in json ? json.error : undefined;
  return typeof code === "string" && /^[\w.-]{1,64}$/.test(code) ? code : null;
}

async function upstreamJson(url: string, init: RequestInit): Promise<Upstream> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { json: null, status: null, providerError: null };
  }
  const json: unknown = await response.json().catch(() => null);
  return {
    json: response.ok ? json : null,
    status: response.status,
    providerError: providerErrorOf(json),
  };
}

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
    logEvent("auth", "oauth_state", {
      provider,
      reason: packed === null ? "no_cookie" : !code ? "no_code" : !state ? "no_state" : "mismatch",
    });
    return c.redirect(oauthFailureRedirect(c.env, packed?.redirect ?? "/?account", "state"), 302);
  }

  // Code → access token.
  const exchange = tokenRequest(config, code, callbackUrl(c, provider));
  const tokenResponse = await upstreamJson(exchange.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: exchange.body,
  });
  const accessToken = parseTokenResponse(tokenResponse.json);
  if (accessToken === null) {
    const { status, providerError } = tokenResponse;
    logEvent("auth", "oauth_exchange", { provider, status, providerError });
    return c.redirect(oauthFailureRedirect(c.env, packed.redirect, "exchange"), 302);
  }

  // Access token → normalized profile.
  const userinfo = await upstreamJson(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = parseOAuthProfile(userinfo.json);
  if (profile === null) {
    const { status, providerError } = userinfo;
    logEvent("auth", "oauth_profile", { provider, status, providerError });
    return c.redirect(oauthFailureRedirect(c.env, packed.redirect, "profile"), 302);
  }

  const db = drizzle(c.env.DB);
  const result = await findOrCreateOAuthUser(db, provider, profile);
  if (result === "no-email" || result === "email-in-use") {
    logEvent("auth", "oauth_refused", { provider, reason: result });
    // email-in-use: the provider email matches an existing account but is NOT
    // provider-verified — linking would let anyone with an unverified alias
    // take the account over.
    return c.redirect(oauthFailureRedirect(c.env, packed.redirect, result), 302);
  }
  const session = await newSession(result.id);
  await db.batch([sweepExpiredSessions(db, result.id), db.insert(sessions).values(session.row)]);
  c.header("Set-Cookie", sessionCookie(session.token), { append: true });
  return c.redirect(`${appOrigin(c.env)}${packed.redirect}`, 302);
});

/** §3.5 find-or-create: linked identity → that user; verified-email match →
    link identity to the existing user; otherwise a fresh user + identity. */
async function findOrCreateOAuthUser(
  db: Db,
  provider: OAuthProvider,
  profile: OAuthProfile,
): Promise<UserRow | Extract<OAuthFailure, "no-email" | "email-in-use">> {
  try {
    return await linkOrCreateOAuthUser(db, provider, profile);
  } catch (error) {
    // A concurrent callback for the same identity won the insert: retry once,
    // which now finds the identity it linked.
    if (!isUniqueViolation(error)) throw error;
    return linkOrCreateOAuthUser(db, provider, profile);
  }
}

async function linkOrCreateOAuthUser(
  db: Db,
  provider: OAuthProvider,
  profile: OAuthProfile,
): Promise<UserRow | Extract<OAuthFailure, "no-email" | "email-in-use">> {
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
    // Link, and promote emailVerified — the provider just attested it. An
    // unverified account's password and sessions could belong to whoever
    // registered the address first, so they go: the owner signs in through
    // the provider from now on.
    if (existing.emailVerified) {
      await db.insert(oauthIdentities).values({ ...identity, userId: existing.id });
      return existing;
    }
    await db.batch([
      db.insert(oauthIdentities).values({ ...identity, userId: existing.id }),
      db
        .update(users)
        .set({ emailVerified: true, passwordHash: null })
        .where(eq(users.id, existing.id)),
      db.delete(sessions).where(eq(sessions.userId, existing.id)),
    ]);
    return { ...existing, emailVerified: true, passwordHash: null };
  }
  const row = newUserRow({
    email: profile.email,
    displayName: profile.displayName,
    passwordHash: null,
    emailVerified: profile.emailVerified,
  });
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
