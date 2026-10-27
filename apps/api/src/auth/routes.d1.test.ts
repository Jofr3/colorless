import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { Env } from "../env";
import { resetLogThrottle } from "../http/log";
import app from "../index";
import {
  raceBeforeBatch,
  raceBeforeFirstBatch,
  seedCards,
  signedInUser,
  useTestD1,
} from "../testing/d1";
import { packStateCookieValue } from "./oauth";
import { DEFAULT_ITERATIONS, hashPassword, parsePasswordHash } from "./password";
import { ACCOUNT_MAX_ATTEMPTS, rateLimitKeys, UNAVAILABLE_RETRY_SECONDS } from "./rateLimit";

// One catalog card, for the deck contents account deletion must take with it.
const d1 = useTestD1((db) =>
  seedCards(db, [{ id: "sv01-001", name: "Sprigatito", category: "Pokemon" }]),
);

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** The structured lines logged so far in this test. */
function logged(): Record<string, unknown>[] {
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}

const GOOGLE = { GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret" };

function postJson(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

/** The `name=value` pair of the session cookie a response set, or null. */
function sessionCookieOf(res: Response): string | null {
  const cookie = res.headers.getSetCookie().find((header) => header.startsWith("session="));
  return cookie?.split(";")[0] ?? null;
}

async function me(cookie: string | null, env: Env = d1().env()) {
  return app.request("/auth/me", { headers: cookie === null ? {} : { Cookie: cookie } }, env);
}

async function register(email: string, password: string, displayName?: string) {
  return app.request("/auth/register", postJson({ email, password, displayName }), d1().env());
}

async function login(email: string, password: string) {
  return app.request("/auth/login", postJson({ email, password }), d1().env());
}

type UserinfoBody = { sub: string; email?: string; email_verified?: boolean; name?: string };

/** One Google callback whose code exchange and userinfo answer as Google would. */
async function oauthCallback(userinfo: UserinfoBody, env: Env = d1().env(GOOGLE)) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "access-token" });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return Response.json(userinfo);
      }
      return realFetch(input, init);
    }),
  );
  return app.request(
    "/auth/oauth/google/callback?code=code&state=state",
    { headers: { Cookie: `oauth_state=${packStateCookieValue("state", "/decks")}` } },
    env,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetLogThrottle();
});

/** The callback's `?authError=` code, or null for a successful sign-in redirect. */
function authErrorOf(res: Response): string | null {
  expect(res.status).toBe(302);
  return new URL(res.headers.get("Location") ?? "").searchParams.get("authError");
}

async function userRows() {
  const { results } = await d1()
    .db.prepare(
      "SELECT id, email, email_verified AS emailVerified, password_hash AS passwordHash FROM users ORDER BY email",
    )
    .all<{ id: string; email: string; emailVerified: number; passwordHash: string | null }>();
  return results;
}

async function identityRows() {
  const { results } = await d1()
    .db.prepare(
      "SELECT provider, provider_id AS providerId, user_id AS userId FROM oauth_identities",
    )
    .all<{ provider: string; providerId: string; userId: string }>();
  return results;
}

async function insertUser(fields: {
  email: string;
  passwordHash?: string | null;
  emailVerified?: boolean;
}): Promise<string> {
  const id = crypto.randomUUID();
  await d1()
    .db.prepare(
      "INSERT INTO users (id, email, display_name, password_hash, email_verified) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, fields.email, "Misty", fields.passwordHash ?? null, fields.emailVerified ? 1 : 0)
    .run();
  return id;
}

describe("POST /auth/register", () => {
  it("creates an unverified account with a working session", async () => {
    const res = await register("Misty@Example.com", "starmie-456");
    expect(res.status).toBe(201);
    const user = (await res.json()) as { id: string; email: string; displayName: string };
    expect(user).toMatchObject({
      email: "misty@example.com",
      displayName: "misty",
      emailVerified: false,
    });
    const rows = await userRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.passwordHash).toMatch(/^pbkdf2\$/);

    const session = await me(sessionCookieOf(res));
    expect(session.status).toBe(200);
    expect(((await session.json()) as { id: string }).id).toBe(user.id);
  });

  it("409s an email already registered, whatever its case", async () => {
    expect((await register("misty@example.com", "starmie-456", "Misty")).status).toBe(201);
    const again = await register("MISTY@example.com", "psyduck-789");
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "email already registered" });
    expect(await userRows()).toHaveLength(1);
  });

  it("409s the loser of a register race that passed the pre-check", async () => {
    const db = d1().db;
    const env = d1().env({
      DB: raceBeforeBatch(db, 1, async () => {
        await insertUser({ email: "brock@example.com" });
      }),
    });
    const res = await app.request(
      "/auth/register",
      postJson({ email: "brock@example.com", password: "onix-1234" }),
      env,
    );
    expect(res.status).toBe(409);
    expect(sessionCookieOf(res)).toBeNull();
    expect(await userRows()).toHaveLength(1);
  });
});

describe("POST /auth/login", () => {
  it("signs in with the registered password and mints a new session", async () => {
    const registered = await register("misty@example.com", "starmie-456");
    const res = await login("MISTY@example.com", "starmie-456");
    expect(res.status).toBe(200);
    const cookie = sessionCookieOf(res);
    expect(cookie).not.toBeNull();
    expect(cookie).not.toBe(sessionCookieOf(registered));
    expect((await me(cookie)).status).toBe(200);
  });

  it("answers one message for a wrong password, an unknown email and a password-less account", async () => {
    await register("misty@example.com", "starmie-456");
    await insertUser({ email: "oauth-only@example.com", passwordHash: null });
    for (const [email, password] of [
      ["misty@example.com", "wrong-password"],
      ["nobody@example.com", "starmie-456"],
      ["oauth-only@example.com", "anything-at-all"],
    ] as const) {
      const res = await login(email, password);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid email or password" });
      expect(sessionCookieOf(res)).toBeNull();
    }
    // The operator's lines tell the cases apart and carry no address.
    expect(logged()).toEqual(
      ["wrong_password", "unknown_email", "no_password"].map((reason) => ({
        evt: "auth",
        kind: "login_failed",
        reason,
      })),
    );
  });

  it.each([
    ["needs no rehash", DEFAULT_ITERATIONS],
    ["would be rehashed", 1000],
  ])(
    "mints no session when an OAuth link revokes a password that %s mid-login",
    async (_label, iterations) => {
      const id = await insertUser({
        email: "victim@example.com",
        passwordHash: await hashPassword("squatter-pass", iterations),
      });
      const { db } = d1();
      // The verified-email link's batch, committing while the login verifies the password.
      const env = d1().env({
        DB: raceBeforeBatch(db, 1, async () => {
          await db.batch([
            db
              .prepare("UPDATE users SET email_verified = 1, password_hash = NULL WHERE id = ?")
              .bind(id),
            db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
          ]);
        }),
      });
      const res = await app.request(
        "/auth/login",
        postJson({ email: "victim@example.com", password: "squatter-pass" }),
        env,
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid email or password" });
      expect(sessionCookieOf(res)).toBeNull();
      const sessions = await db
        .prepare("SELECT count(*) AS n FROM sessions WHERE user_id = ?")
        .bind(id)
        .first<{ n: number }>();
      expect(sessions?.n).toBe(0);
      expect((await userRows())[0]?.passwordHash).toBeNull();
      expect(logged()).toEqual([
        { evt: "auth", kind: "login_failed", reason: "credential_changed" },
      ]);
    },
  );

  it("re-hashes a password stored below the current iteration count", async () => {
    const id = await insertUser({
      email: "oak@example.com",
      passwordHash: await hashPassword("pallet-town", 1000),
    });
    expect((await login("oak@example.com", "pallet-town")).status).toBe(200);
    const row = (await userRows()).find((user) => user.id === id);
    expect(parsePasswordHash(row?.passwordHash ?? "")?.iterations).toBe(DEFAULT_ITERATIONS);
    expect((await login("oak@example.com", "pallet-town")).status).toBe(200);
  });

  it("clears the account's expired sessions and keeps its live ones and everyone else's", async () => {
    const misty = sessionCookieOf(await register("misty@example.com", "starmie-456"));
    const brock = sessionCookieOf(await register("brock@example.com", "onix-789"));
    const { db } = d1();
    const userIdOf = async (email: string) =>
      (await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())
        ?.id;
    const expired = Date.now() - 1000;
    await db.batch(
      [
        ["misty-old-1", await userIdOf("misty@example.com")],
        ["misty-old-2", await userIdOf("misty@example.com")],
        ["brock-old", await userIdOf("brock@example.com")],
      ].map(([id, userId]) =>
        db
          .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
          .bind(id, userId, expired),
      ),
    );
    const res = await login("misty@example.com", "starmie-456");
    expect(res.status).toBe(200);
    const { results } = await db
      .prepare("SELECT id FROM sessions ORDER BY id")
      .all<{ id: string }>();
    const ids = results.map((row) => row.id);
    expect(ids).toContain("brock-old");
    expect(ids.filter((id) => id.startsWith("misty-old"))).toEqual([]);
    expect(ids).toHaveLength(4);
    for (const cookie of [misty, brock, sessionCookieOf(res)]) {
      expect((await me(cookie)).status).toBe(200);
    }
  });
});

describe("register and login rate limiting", () => {
  const body = { email: "misty@example.com", password: "starmie-456" };

  it("429s an exhausted address and email with Retry-After, across its whole IPv6 /64", async () => {
    const keys = await rateLimitKeys("login", "2001:db8:0:12::/64", body.email);
    await d1()
      .db.prepare("INSERT INTO auth_rate_limits (key, count, reset_at) VALUES (?, ?, ?)")
      .bind(keys.account, ACCOUNT_MAX_ATTEMPTS, Date.now() + 10 * 60 * 1000)
      .run();
    for (const ip of ["2001:db8:0:12::1", "2001:db8:0:12:ffff::2"]) {
      const res = await app.request(
        "/auth/login",
        postJson({ ...body, email: "Misty@Example.com" }, { "cf-connecting-ip": ip }),
        d1().env(),
      );
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(590);
      expect(await res.json()).toEqual({ error: "too many attempts" });
    }
    expect(logged()).toEqual([{ evt: "auth", kind: "rate_limited", scope: "login" }]);
    const other = await app.request(
      "/auth/login",
      postJson(body, { "cf-connecting-ip": "2001:db8:0:13::1" }),
      d1().env(),
    );
    expect(other.status).toBe(401);
  });

  it("answers 503 to every attempt, right or wrong, while the counting batch fails", async () => {
    const headers = { "cf-connecting-ip": "203.0.113.9" };
    expect((await app.request("/auth/register", postJson(body, headers), d1().env())).status).toBe(
      201,
    );
    // Every batch fails, as on a spent daily write quota; single reads still work.
    const db = new Proxy(d1().db, {
      get(target, property) {
        if (property === "batch") {
          return () => Promise.reject(new Error("D1_ERROR: rows written limit exceeded"));
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const env = d1().env({ DB: db });
    const guesses = [...Array.from({ length: 12 }, (_, i) => `wrong-guess-${i}`), body.password];
    for (const password of guesses) {
      const res = await app.request("/auth/login", postJson({ ...body, password }, headers), env);
      // The right password is not told apart from a wrong one: no 401 oracle, no 500.
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe(String(UNAVAILABLE_RETRY_SECONDS));
      expect(await res.json()).toEqual({ error: "temporarily unavailable, try again later" });
    }
    const other = { email: "brock@example.com", password: "onix-7890" };
    expect((await app.request("/auth/register", postJson(other, headers), env)).status).toBe(503);
    // Throttled to one line per isolate while the failure lasts.
    expect(logged()).toEqual([{ evt: "auth", kind: "limiter_error", error: "Error", quota: true }]);
    expect(JSON.stringify(logged())).not.toMatch(/misty|203\.0\.113\.9/);
  });
});

describe("DELETE /auth/me", () => {
  function deleteAccount(
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
    env: Env = d1().env(),
  ) {
    return app.request(
      "/auth/me",
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(cookie === null ? {} : { Cookie: cookie }),
          ...headers,
        },
        body: JSON.stringify(body),
      },
      env,
    );
  }

  /** Everything an account can own: nested folders, a deck in one with a card line and the
      favourite pointing at it, a Google identity, and a second session. */
  async function seedLibrary(userId: string, prefix: string) {
    const { db } = d1();
    await db.batch([
      db
        .prepare("INSERT INTO folders (id, user_id, name) VALUES (?, ?, 'Water')")
        .bind(`${prefix}-root`, userId),
      db
        .prepare("INSERT INTO folders (id, user_id, parent_id, name) VALUES (?, ?, ?, 'Gym')")
        .bind(`${prefix}-child`, userId, `${prefix}-root`),
      db
        .prepare(
          "INSERT INTO decks (id, user_id, folder_id, name, tint, cover_card_id) VALUES (?, ?, ?, 'Deck', 200, 'sv01-001')",
        )
        .bind(`${prefix}-deck`, userId, `${prefix}-child`),
      db
        .prepare("INSERT INTO deck_cards (deck_id, card_id, count) VALUES (?, 'sv01-001', 4)")
        .bind(`${prefix}-deck`),
      db
        .prepare("UPDATE users SET favourite_deck_id = ? WHERE id = ?")
        .bind(`${prefix}-deck`, userId),
      db
        .prepare(
          "INSERT INTO oauth_identities (provider, provider_id, user_id) VALUES ('google', ?, ?)",
        )
        .bind(`${prefix}-sub`, userId),
      db
        .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(`${prefix}-session`, userId, Date.now() + 60_000),
    ]);
  }

  /** The account's rows in every table that can hold them. */
  async function ownedRows(userId: string, prefix: string) {
    const count = async (sql: string, bind: string) =>
      (await d1().db.prepare(sql).bind(bind).first<{ n: number }>())?.n;
    return {
      users: await count("SELECT count(*) AS n FROM users WHERE id = ?", userId),
      sessions: await count("SELECT count(*) AS n FROM sessions WHERE user_id = ?", userId),
      identities: await count(
        "SELECT count(*) AS n FROM oauth_identities WHERE user_id = ?",
        userId,
      ),
      folders: await count("SELECT count(*) AS n FROM folders WHERE user_id = ?", userId),
      decks: await count("SELECT count(*) AS n FROM decks WHERE user_id = ?", userId),
      deckCards: await count(
        "SELECT count(*) AS n FROM deck_cards WHERE deck_id = ?",
        `${prefix}-deck`,
      ),
    };
  }

  const NONE = { users: 0, sessions: 0, identities: 0, folders: 0, decks: 0, deckCards: 0 };

  it("deletes a password account and all it owns, clears the cookie and leaves others be", async () => {
    const registered = await register("misty@example.com", "starmie-456");
    const misty = ((await registered.json()) as { id: string }).id;
    const cookie = sessionCookieOf(registered);
    await seedLibrary(misty, "misty");
    const brock = await signedInUser(d1().db, "brock@example.com");
    await seedLibrary(brock.userId, "brock");

    const res = await deleteAccount(cookie, { password: "starmie-456" });
    expect(res.status).toBe(204);
    const logout = await app.request("/auth/logout", { method: "POST" }, d1().env());
    expect(res.headers.get("Set-Cookie")).toBe(logout.headers.get("Set-Cookie"));
    expect(await ownedRows(misty, "misty")).toEqual(NONE);
    expect(await ownedRows(brock.userId, "brock")).toEqual({
      users: 1,
      sessions: 2,
      identities: 1,
      folders: 2,
      decks: 1,
      deckCards: 1,
    });
    expect((await me(cookie)).status).toBe(401);
    expect((await me(brock.cookie)).status).toBe(200);
    // The email is free again.
    expect((await register("misty@example.com", "psyduck-789")).status).toBe(201);
    expect(logged()).toContainEqual({ evt: "auth", kind: "account_deleted" });
    expect(JSON.stringify(logged())).not.toMatch(/misty|starmie/);
  });

  it("401s a wrong or missing password and keeps the account", async () => {
    const cookie = sessionCookieOf(await register("misty@example.com", "starmie-456"));
    for (const body of [{ password: "psyduck-789" }, {}]) {
      const res = await deleteAccount(cookie, body);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid password" });
    }
    expect(await userRows()).toHaveLength(1);
    expect((await me(cookie)).status).toBe(200);
    expect(logged()).toEqual([
      { evt: "auth", kind: "delete_failed", reason: "wrong_password" },
      { evt: "auth", kind: "delete_failed", reason: "no_password" },
    ]);
  });

  it("deletes an OAuth-only account without a password", async () => {
    const { userId, cookie } = await signedInUser(d1().db, "brock@example.com");
    await seedLibrary(userId, "brock");
    const res = await deleteAccount(cookie, {});
    expect(res.status).toBe(204);
    expect(await ownedRows(userId, "brock")).toEqual(NONE);
    expect((await me(cookie)).status).toBe(401);
  });

  it("counts attempts in its own scope and 429s an exhausted one, even with the password", async () => {
    const cookie = sessionCookieOf(await register("misty@example.com", "starmie-456"));
    const headers = { "cf-connecting-ip": "203.0.113.7" };
    const keys = await rateLimitKeys("delete", "203.0.113.7", "misty@example.com");
    const counted = async () =>
      (
        await d1()
          .db.prepare("SELECT count FROM auth_rate_limits WHERE key = ?")
          .bind(keys.account)
          .first<{ count: number }>()
      )?.count;

    expect((await deleteAccount(cookie, { password: "wrong-guess" }, headers)).status).toBe(401);
    expect(await counted()).toBe(1);
    await d1()
      .db.prepare("UPDATE auth_rate_limits SET count = ? WHERE key = ?")
      .bind(ACCOUNT_MAX_ATTEMPTS + 1, keys.account)
      .run();
    const res = await deleteAccount(cookie, { password: "starmie-456" }, headers);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await userRows()).toHaveLength(1);
    // Signing in keeps its own budget.
    expect((await login("misty@example.com", "starmie-456")).status).toBe(200);
  });

  it("refuses a delete whose password an OAuth link cleared during the verify", async () => {
    const cookie = sessionCookieOf(await register("misty@example.com", "starmie-456"));
    const { db } = d1();
    // The limiter's batch is the route's only one; the link commits as it returns.
    const raced = new Proxy(db, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            const result = await target.batch(statements);
            await target.prepare("UPDATE users SET password_hash = NULL").run();
            return result;
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const res = await deleteAccount(
      cookie,
      { password: "starmie-456" },
      {},
      d1().env({ DB: raced }),
    );
    expect(res.status).toBe(401);
    expect(await userRows()).toHaveLength(1);
    expect(logged()).toEqual([
      { evt: "auth", kind: "delete_failed", reason: "credential_changed" },
    ]);
  });
});

describe("PATCH /auth/me", () => {
  it("renames the account and ignores the retired favourite-deck field", async () => {
    const { userId, cookie } = await signedInUser(d1().db, "misty@example.com");
    const { db } = d1();
    await db.batch([
      db
        .prepare("INSERT INTO decks (id, user_id, name, tint) VALUES ('d', ?, 'Water', 200)")
        .bind(userId),
      db.prepare("UPDATE users SET favourite_deck_id = 'd' WHERE id = ?").bind(userId),
    ]);
    const res = await app.request(
      "/auth/me",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ displayName: "Misty W", favouriteDeckId: null }),
      },
      d1().env(),
    );
    expect(res.status).toBe(200);
    const user = (await res.json()) as Record<string, unknown>;
    expect(user.displayName).toBe("Misty W");
    expect(user).not.toHaveProperty("favouriteDeckId");
    const row = await db
      .prepare("SELECT display_name AS name, favourite_deck_id AS favourite FROM users")
      .first();
    expect(row).toEqual({ name: "Misty W", favourite: "d" });
  });
});

describe("GET /auth/oauth/google/callback find-or-create", () => {
  it("creates an account and identity for a new Google user", async () => {
    const res = await oauthCallback({
      sub: "g-1",
      email: "Erika@Example.com",
      email_verified: true,
      name: "Erika",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://localhost:5175/decks");
    const rows = await userRows();
    expect(rows).toEqual([
      { id: expect.any(String), email: "erika@example.com", emailVerified: 1, passwordHash: null },
    ]);
    expect(await identityRows()).toEqual([
      { provider: "google", providerId: "g-1", userId: rows[0]?.id },
    ]);
    const session = await me(sessionCookieOf(res));
    expect(((await session.json()) as { id: string }).id).toBe(rows[0]?.id);
  });

  it("signs a returning identity into its account even after the Google email changed", async () => {
    await oauthCallback({ sub: "g-1", email: "erika@example.com", email_verified: true });
    const [account] = await userRows();
    const res = await oauthCallback({
      sub: "g-1",
      email: "erika@new.example",
      email_verified: true,
    });
    expect(authErrorOf(res)).toBeNull();
    expect(await userRows()).toHaveLength(1);
    const session = await me(sessionCookieOf(res));
    expect(((await session.json()) as { id: string }).id).toBe(account?.id);
  });

  it("links a verified Google email to the existing account and marks it verified", async () => {
    const existing = await insertUser({
      email: "misty@example.com",
      passwordHash: await hashPassword("starmie-456", 1000),
    });
    const res = await oauthCallback({
      sub: "g-2",
      email: "MISTY@example.com",
      email_verified: true,
    });
    expect(authErrorOf(res)).toBeNull();
    expect(await userRows()).toMatchObject([{ id: existing, emailVerified: 1 }]);
    expect(await identityRows()).toEqual([
      { provider: "google", providerId: "g-2", userId: existing },
    ]);
    const session = await me(sessionCookieOf(res));
    expect(((await session.json()) as { id: string }).id).toBe(existing);
  });

  it("refuses to link an unverified Google email to an existing account", async () => {
    const existing = await insertUser({ email: "misty@example.com", emailVerified: true });
    for (const userinfo of [
      { sub: "g-3", email: "misty@example.com", email_verified: false },
      { sub: "g-3", email: "misty@example.com" },
    ]) {
      const res = await oauthCallback(userinfo);
      expect(res.status).toBe(302);
      expect(authErrorOf(res)).toBe("email-in-use");
      expect(sessionCookieOf(res)).toBeNull();
    }
    expect(await identityRows()).toEqual([]);
    expect(await userRows()).toMatchObject([{ id: existing }]);
  });

  it("creates no account when Google withholds the email", async () => {
    const res = await oauthCallback({ sub: "g-4", email_verified: true });
    expect(authErrorOf(res)).toBe("no-email");
    expect(sessionCookieOf(res)).toBeNull();
    expect(await userRows()).toEqual([]);
  });

  it("retries a callback that lost the insert race and signs into the winner's account", async () => {
    const db = d1().db;
    const winner = crypto.randomUUID();
    const env = d1().env({
      ...GOOGLE,
      DB: raceBeforeFirstBatch(db, async () => {
        await db.batch([
          db
            .prepare(
              "INSERT INTO users (id, email, display_name, email_verified) VALUES (?, ?, ?, 1)",
            )
            .bind(winner, "erika@example.com", "Erika"),
          db
            .prepare(
              "INSERT INTO oauth_identities (provider, provider_id, user_id) VALUES ('google', 'g-5', ?)",
            )
            .bind(winner),
        ]);
      }),
    });
    const res = await oauthCallback(
      { sub: "g-5", email: "erika@example.com", email_verified: true },
      env,
    );
    expect(authErrorOf(res)).toBeNull();
    expect(await userRows()).toMatchObject([{ id: winner }]);
    const session = await me(sessionCookieOf(res));
    expect(((await session.json()) as { id: string }).id).toBe(winner);
  });

  it("retries a link whose single identity insert lost the race (drizzle wraps that error)", async () => {
    const db = d1().db;
    const brock = await insertUser({ email: "brock@example.com", emailVerified: true });
    let raced = false;
    // A concurrent callback links the same identity just before this one's insert runs.
    const racing = new Proxy(db, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            if (!raced && /^insert into "oauth_identities"/i.test(query)) {
              raced = true;
              return {
                bind: (...values: unknown[]) => {
                  const statement = target.prepare(query).bind(...values);
                  const first = async <R>(run: () => Promise<R>) => {
                    await target
                      .prepare(
                        "INSERT INTO oauth_identities (provider, provider_id, user_id) VALUES ('google', 'g-8', ?)",
                      )
                      .bind(brock)
                      .run();
                    return run();
                  };
                  return new Proxy(statement, {
                    get(inner, name) {
                      const value = Reflect.get(inner, name);
                      return typeof value === "function"
                        ? (...args: unknown[]) => first(() => value.apply(inner, args))
                        : value;
                    },
                  });
                },
              };
            }
            return target.prepare(query);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const res = await oauthCallback(
      { sub: "g-8", email: "brock@example.com", email_verified: true },
      d1().env({ ...GOOGLE, DB: racing }),
    );
    expect(raced).toBe(true);
    expect(authErrorOf(res)).toBeNull();
    const session = await me(sessionCookieOf(res));
    expect(((await session.json()) as { id: string }).id).toBe(brock);
  });

  // Linking keeps an unverified account's password and sessions, so whoever registered the
  // address first keeps access to the account its real owner then signs into.
  it("revokes a squatter's password and sessions when a verified email links", async () => {
    const squatter = await register("victim@example.com", "squatter-pass");
    const squatterCookie = sessionCookieOf(squatter);
    await oauthCallback({ sub: "g-6", email: "victim@example.com", email_verified: true });
    expect((await login("victim@example.com", "squatter-pass")).status).toBe(401);
    expect((await me(squatterCookie)).status).toBe(401);
  });

  it("keeps the password of an account whose email was already verified", async () => {
    await insertUser({
      email: "brock@example.com",
      emailVerified: true,
      passwordHash: await hashPassword("onix-789", 1000),
    });
    await oauthCallback({ sub: "g-7", email: "brock@example.com", email_verified: true });
    expect((await login("brock@example.com", "onix-789")).status).toBe(200);
  });
});
