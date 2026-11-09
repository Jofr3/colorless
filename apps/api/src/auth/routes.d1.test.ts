import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { Env } from "../env";
import { resetLogThrottle } from "../http/log";
import app from "../index";
import {
  failingD1,
  raceBeforeBatch,
  raceBeforeFirstBatch,
  seedCards,
  signedInUser,
  TEST_PEPPER,
  useTestD1,
} from "../testing/d1";
import { packStateCookieValue } from "./oauth";
import { DEFAULT_ITERATIONS, hashPassword, parsePasswordHash, pepperOf } from "./password";
import { brokenRateLimit, fakeRateLimit } from "../testing/rateLimit";
import {
  ACCOUNT_MAX_ATTEMPTS,
  EMAIL_MAX_FAILURES,
  REGISTER_MAX_ATTEMPTS,
  REGISTER_WINDOW_MS,
  rateLimitKeys,
  UNAVAILABLE_RETRY_SECONDS,
} from "./rateLimit";

// One catalog card, for the deck contents account deletion must take with it.
const d1 = useTestD1((db) =>
  seedCards(db, [{ id: "sv01-001", name: "Sprigatito", category: "Pokemon" }]),
);

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  tokenBodies = [];
});

/** The structured lines logged so far in this test, only those of `kinds` when any are named. */
function logged(...kinds: string[]): Record<string, unknown>[] {
  return warn.mock.calls
    .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    .filter((line) => kinds.length === 0 || kinds.includes(String(line.kind)));
}

/** What every account tag reads in these tests, which set no LOG_TAG_KEY. */
const UNTAGGED = "untagged";

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

/** The PKCE verifier of oauthCallback's state cookie. */
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
/** The form bodies oauthCallback's token exchanges sent, newest last. */
let tokenBodies: URLSearchParams[] = [];

/** One Google callback whose code exchange and userinfo answer as Google would. */
async function oauthCallback(userinfo: UserinfoBody, env: Env = d1().env(GOOGLE)) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        tokenBodies.push(new URLSearchParams(String(init?.body)));
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
    { headers: { Cookie: `oauth_state=${packStateCookieValue("state", VERIFIER, "/decks")}` } },
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
      emailVerified: false,
      namePrompt: false,
    });
    // A blank name gets a generated handle, never the email's local part (AU3).
    expect(user.displayName).toMatch(/^Trainer-[A-Z2-9]{4}$/);
    const rows = await userRows();
    expect(rows).toHaveLength(1);
    // Peppered with the env's PASSWORD_PEPPER (AU9).
    expect(rows[0]?.passwordHash).toMatch(/^pbkdf2p\$[A-Za-z0-9_-]{8}\$100000\$/);
    expect(logged()).toEqual([{ evt: "auth", kind: "registered", account: UNTAGGED }]);

    const session = await me(sessionCookieOf(res));
    expect(session.status).toBe(200);
    expect(((await session.json()) as { id: string }).id).toBe(user.id);
  });

  it("keeps a typed name, normalized, and refuses one with a control character", async () => {
    const res = await register("misty@example.com", "starmie-456", "  \uFF2Disty   Water ");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ displayName: "Misty Water", namePrompt: false });
    const refused = await register("brock@example.com", "onix-4567", "Brock\u202e");
    expect(refused.status).toBe(400);
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
    // The operator's lines tell the cases apart and carry no address; an account that exists is
    // named by its tag.
    expect(logged("login_failed")).toEqual([
      { evt: "auth", kind: "login_failed", reason: "wrong_password", account: UNTAGGED },
      { evt: "auth", kind: "login_failed", reason: "unknown_email" },
      { evt: "auth", kind: "login_failed", reason: "no_password", account: UNTAGGED },
    ]);
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
        { evt: "auth", kind: "login_failed", reason: "credential_changed", account: UNTAGGED },
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
    expect(logged()).toEqual([
      { evt: "auth", kind: "rate_limited", scope: "login", net: UNTAGGED },
    ]);
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
    const env = d1().env({ DB: failingD1(d1().db, { batch: true }) });
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
    expect(logged("limiter_error")).toEqual([
      { evt: "auth", kind: "limiter_error", error: "Error", quota: true },
    ]);
    expect(JSON.stringify(logged())).not.toMatch(/misty|203\.0\.113\.9/);
  });

  it(`gives register its own budget of ${REGISTER_MAX_ATTEMPTS} an hour per address`, async () => {
    const headers = { "cf-connecting-ip": "203.0.113.9" };
    const registerFrom = (email: string, from = headers) =>
      app.request("/auth/register", postJson({ email, password: "starmie-456" }, from), d1().env());
    for (let i = 0; i < REGISTER_MAX_ATTEMPTS; i++) {
      expect((await registerFrom(`trainer${i}@example.com`)).status).toBe(201);
    }
    const refused = await registerFrom("one-more@example.com");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(
      REGISTER_WINDOW_MS / 1000 - 10,
    );
    expect(await refused.json()).toEqual({ error: "too many attempts" });
    // Signing in from the address, and registering from another, are untouched.
    const signIn = postJson({ email: "trainer0@example.com", password: "starmie-456" }, headers);
    expect((await app.request("/auth/login", signIn, d1().env())).status).toBe(200);
    expect(
      (await registerFrom("one-more@example.com", { "cf-connecting-ip": "198.51.100.7" })).status,
    ).toBe(201);
  });

  const storedCounters = async () =>
    (await d1().db.prepare("SELECT count(*) AS n FROM auth_rate_limits").first<{ n: number }>())?.n;

  it("refuses a flood at the AUTH_LIMIT binding before the D1 limiter writes, per scope and /64", async () => {
    const { binding, keys } = fakeRateLimit(2);
    const env = d1().env({ AUTH_LIMIT: binding });
    const loginFrom = (ip: string) =>
      app.request("/auth/login", postJson(body, { "cf-connecting-ip": ip }), env);
    expect((await loginFrom("2001:db8:0:12::1")).status).toBe(401);
    expect((await loginFrom("2001:db8:0:12::2")).status).toBe(401);
    const counted = await storedCounters();
    const refused = await loginFrom("2001:db8:0:12:ffff::3");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");
    expect(await refused.json()).toEqual({ error: "too many attempts" });
    expect(await storedCounters()).toBe(counted);
    expect(keys).toEqual(Array(3).fill("login:2001:db8:0:12::/64"));
    // Register counts apart from login.
    const registered = await app.request(
      "/auth/register",
      postJson(body, { "cf-connecting-ip": "2001:db8:0:12::1" }),
      env,
    );
    expect(registered.status).toBe(201);
    expect(keys.at(-1)).toBe("register:2001:db8:0:12::/64");
    expect(logged()).toContainEqual({
      evt: "auth",
      kind: "rate_limited",
      scope: "login",
      by: "binding",
      net: UNTAGGED,
    });
  });

  it("falls through to the D1 limiter when the binding fails", async () => {
    const env = d1().env({ AUTH_LIMIT: brokenRateLimit });
    const res = await app.request("/auth/login", postJson(body), env);
    expect(res.status).toBe(401);
    // The address and the address-and-email attempt counters, and the email's failure counter.
    expect(await storedCounters()).toBe(3);
    expect(logged()).toContainEqual({
      evt: "auth",
      kind: "binding_error",
      route: "login",
      error: "Error",
    });
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
    expect(logged()).toContainEqual({ evt: "auth", kind: "account_deleted", account: UNTAGGED });
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
    expect(logged("delete_failed")).toEqual([
      { evt: "auth", kind: "delete_failed", reason: "wrong_password", account: UNTAGGED },
      { evt: "auth", kind: "delete_failed", reason: "no_password", account: UNTAGGED },
    ]);
  });

  it("deletes an OAuth-only account whose email is typed, trimmed and in any case", async () => {
    const { userId, cookie } = await signedInUser(d1().db, "brock@example.com");
    await seedLibrary(userId, "brock");
    const res = await deleteAccount(cookie, { confirmEmail: "  Brock@Example.COM " });
    expect(res.status).toBe(204);
    expect(await ownedRows(userId, "brock")).toEqual(NONE);
    expect((await me(cookie)).status).toBe(401);
  });

  it("403s an OAuth-only delete without its email, or with another, and keeps the account", async () => {
    const { userId, cookie } = await signedInUser(d1().db, "brock@example.com");
    await seedLibrary(userId, "brock");
    for (const body of [{}, { confirmEmail: "" }, { confirmEmail: "misty@example.com" }]) {
      const res = await deleteAccount(cookie, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "email confirmation mismatch" });
    }
    expect((await ownedRows(userId, "brock")).users).toBe(1);
    expect((await me(cookie)).status).toBe(200);
    expect(logged("delete_failed")).toEqual(
      ["no_confirm_email", "wrong_confirm_email", "wrong_confirm_email"].map((reason) => ({
        evt: "auth",
        kind: "delete_failed",
        reason,
        account: UNTAGGED,
      })),
    );
  });

  it("asks a password account for its password, not its email", async () => {
    const cookie = sessionCookieOf(await register("misty@example.com", "starmie-456"));
    const res = await deleteAccount(cookie, { confirmEmail: "misty@example.com" });
    expect(res.status).toBe(401);
    expect(await userRows()).toHaveLength(1);
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

  it("puts a password check behind the AUTH_LIMIT binding too", async () => {
    const cookie = sessionCookieOf(await register("misty@example.com", "starmie-456"));
    const { binding, keys } = fakeRateLimit(0);
    const env = d1().env({ AUTH_LIMIT: binding });
    const res = await deleteAccount(cookie, { password: "starmie-456" }, {}, env);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(keys).toEqual(["delete:unknown"]);
    expect(await userRows()).toHaveLength(1);
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
    expect(logged("delete_failed")).toEqual([
      { evt: "auth", kind: "delete_failed", reason: "credential_changed", account: UNTAGGED },
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

describe("the one-time public-name prompt", () => {
  async function patchName(cookie: string, displayName: string) {
    return app.request(
      "/auth/me",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ displayName }),
      },
      d1().env(),
    );
  }
  async function promptOf(userId: string) {
    return d1()
      .db.prepare("SELECT name_prompt AS prompt, display_name AS name FROM users WHERE id = ?")
      .bind(userId)
      .first<{ prompt: number; name: string }>();
  }

  it("asks a flagged account; keeping the current name clears the ask and renames nothing", async () => {
    const { userId, cookie } = await signedInUser(d1().db, "misty@example.com");
    await d1()
      .db.prepare("UPDATE users SET display_name = 'misty', name_prompt = 1 WHERE id = ?")
      .bind(userId)
      .run();
    expect(await (await me(cookie)).json()).toMatchObject({
      displayName: "misty",
      namePrompt: true,
    });

    const kept = await patchName(cookie, "misty");
    expect(kept.status).toBe(200);
    expect(await kept.json()).toMatchObject({ displayName: "misty", namePrompt: false });
    expect(await promptOf(userId)).toEqual({ prompt: 0, name: "misty" });
    expect(await (await me(cookie)).json()).toMatchObject({ namePrompt: false });
  });

  it("clears the ask when a new name is saved", async () => {
    const { userId, cookie } = await signedInUser(d1().db, "brock@example.com");
    await d1().db.prepare("UPDATE users SET name_prompt = 1 WHERE id = ?").bind(userId).run();
    const saved = await patchName(cookie, "Pewter Leader");
    expect(await saved.json()).toMatchObject({ displayName: "Pewter Leader", namePrompt: false });
    expect(await promptOf(userId)).toEqual({ prompt: 0, name: "Pewter Leader" });
  });

  it("asks a row inserted without saying otherwise, as the Worker before this column writes", async () => {
    const id = await insertUser({ email: "erika@example.com" });
    expect(await promptOf(id)).toEqual({ prompt: 1, name: "Misty" });
  });
});

describe("GET /auth/me", () => {
  it("re-sends the session cookie as Lax for its remaining lifetime, on a 304 too", async () => {
    const { userId, cookie } = await signedInUser(d1().db, "brock@example.com");
    const tenMinutes = Date.now() + 10 * 60 * 1000;
    await d1()
      .db.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?")
      .bind(tenMinutes, userId)
      .run();
    const first = await app.request("/auth/me", { headers: { Cookie: cookie } }, d1().env());
    expect(first.status).toBe(200);
    const sent = first.headers.get("Set-Cookie") ?? "";
    expect(sent).toContain(`${cookie};`);
    expect(sent).toContain("SameSite=Lax");
    const maxAge = Number(/Max-Age=(\d+)/.exec(sent)?.[1]);
    expect(maxAge).toBeGreaterThan(590);
    expect(maxAge).toBeLessThanOrEqual(600);
    const etag = first.headers.get("ETag") ?? "";
    const revalidated = await app.request(
      "/auth/me",
      { headers: { Cookie: cookie, "If-None-Match": etag } },
      d1().env(),
    );
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("Set-Cookie")).toContain("SameSite=Lax");
  });

  const expire = (userId: string) =>
    d1().db.prepare("UPDATE sessions SET expires_at = 1 WHERE user_id = ?").bind(userId).run();
  const sessionCount = async () =>
    (await d1().db.prepare("SELECT count(*) AS n FROM sessions").first<number>("n")) ?? 0;
  const clearedCookie = async () =>
    (await app.request("/auth/logout", { method: "POST" }, d1().env())).headers.get("Set-Cookie");

  it("401s an expired session, clears its cookie and deletes its row", async () => {
    const { userId, cookie } = await signedInUser(d1().db, "brock@example.com");
    await expire(userId);
    const res = await me(cookie);
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBe(await clearedCookie());
    expect(await sessionCount()).toBe(0);
  });

  it("still 401s an expired session, and logs, when deleting its row fails", async () => {
    const { userId, cookie } = await signedInUser(d1().db, "brock@example.com");
    await expire(userId);
    const res = await me(cookie, d1().env({ DB: failingD1(d1().db, { sql: /^delete/i }) }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("Set-Cookie")).toBe(await clearedCookie());
    // The daily sweep deletes it instead.
    expect(await sessionCount()).toBe(1);
    expect(logged("expired_session_delete_failed")).toEqual([
      {
        evt: "auth",
        kind: "expired_session_delete_failed",
        error: "DrizzleQueryError",
        cause: "Error",
        query: expect.stringMatching(/^delete from "sessions"/),
        quota: true,
      },
    ]);
  });
});

describe("POST /auth/logout", () => {
  const logout = (cookie: string, env: Env = d1().env()) =>
    app.request("/auth/logout", { method: "POST", headers: { Cookie: cookie } }, env);

  it("ends the session and clears the cookie", async () => {
    const ash = await signedInUser(d1().db, "ash@example.com");
    const res = await logout(ash.cookie);
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toMatch(/^session=;/);
    expect((await me(ash.cookie)).status).toBe(401);
  });

  it("still clears the cookie, and logs, when deleting the session fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ash = await signedInUser(d1().db, "ash@example.com");
    const res = await logout(
      ash.cookie,
      d1().env({ DB: failingD1(d1().db, { sql: /^delete from "sessions"/i }) }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toMatch(/^session=;/);
    expect(error.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      {
        evt: "auth",
        kind: "logout_failed",
        error: "DrizzleQueryError",
        cause: "Error",
        query: expect.stringMatching(/^delete from "sessions"/),
        quota: true,
      },
    ]);
    expect(logged("logout")).toEqual([]);
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
    const user = (await session.json()) as { id: string; displayName: string };
    expect(user.id).toBe(rows[0]?.id);
    // A generated handle, not the Google real name (AU3), and so no prompt to choose one.
    expect(user).toMatchObject({ namePrompt: false });
    expect(user.displayName).toMatch(/^Trainer-[A-Z2-9]{4}$/);
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

  // Addresses Google can verify that z.email() refuses (audit AUTH1).
  it.each(["ivan@example.xn--p1ai", "a&b@example.com"])(
    "keeps a Google account with the email %s usable",
    async (email) => {
      const res = await oauthCallback({ sub: "g-odd", email, email_verified: true });
      expect(authErrorOf(res)).toBeNull();
      const cookie = sessionCookieOf(res);
      const session = await me(cookie);
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({ email });
      const renamed = await app.request(
        "/auth/me",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie ?? "" },
          body: JSON.stringify({ displayName: "Ivan" }),
        },
        d1().env(),
      );
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({ email, displayName: "Ivan" });
    },
  );

  it("refuses a Google email longer than any account can return", async () => {
    const email = `${"x".repeat(243)}@example.com`;
    const res = await oauthCallback({ sub: "g-long", email, email_verified: true });
    expect(authErrorOf(res)).toBe("profile");
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

  it("sends a new user back to the app as unavailable when D1 refuses every write", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await oauthCallback(
      { sub: "g-9", email: "erika@example.com", email_verified: true },
      d1().env({ ...GOOGLE, DB: failingD1(d1().db, { sql: /^insert/i }) }),
    );
    expect(res.headers.get("Location")).toBe("http://localhost:5175/decks?authError=unavailable");
    expect(sessionCookieOf(res)).toBeNull();
    // The state cookie is still single-use.
    expect(res.headers.getSetCookie()).toEqual([expect.stringMatching(/^oauth_state=;/)]);
    expect(await userRows()).toEqual([]);
    expect(error.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      {
        evt: "auth",
        kind: "oauth_unavailable",
        provider: "google",
        error: "Error",
        quota: true,
      },
    ]);
  });

  it("sends a returning user back as unavailable when only the session insert fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await oauthCallback({ sub: "g-9", email: "erika@example.com", email_verified: true });
    const res = await oauthCallback(
      { sub: "g-9", email: "erika@example.com", email_verified: true },
      d1().env({ ...GOOGLE, DB: failingD1(d1().db, { sql: /^insert into "sessions"/i }) }),
    );
    expect(authErrorOf(res)).toBe("unavailable");
    expect(sessionCookieOf(res)).toBeNull();
    expect(logged("login_ok")).toHaveLength(1);
    expect(error.mock.calls.map(([line]) => JSON.parse(String(line)).kind)).toEqual([
      "oauth_unavailable",
    ]);
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

describe("OAuth identities and verified emails (AU4) and PKCE (AU12)", () => {
  it("sends the state cookie's PKCE verifier with the code exchange", async () => {
    await oauthCallback({ sub: "g-1", email: "erika@example.com", email_verified: true });
    expect(tokenBodies.map((body) => body.get("code_verifier"))).toEqual([VERIFIER]);
  });

  it("creates no account from an email Google has not verified", async () => {
    for (const userinfo of [
      { sub: "g-9", email: "erika@example.com", email_verified: false },
      { sub: "g-9", email: "erika@example.com" },
    ]) {
      const res = await oauthCallback(userinfo);
      expect(authErrorOf(res)).toBe("email-unverified");
      expect(sessionCookieOf(res)).toBeNull();
    }
    expect(await userRows()).toEqual([]);
    expect(await identityRows()).toEqual([]);
    expect(logged("oauth_refused")).toEqual(
      Array(2).fill({
        evt: "auth",
        kind: "oauth_refused",
        provider: "google",
        reason: "email-unverified",
      }),
    );
  });

  it("leaves only the claiming identity on an unverified account a verified email claims", async () => {
    // An identity linked before the owner claimed the address, as an unverified provider email
    // could once create.
    const squatter = await register("victim@example.com", "squatter-pass");
    const squatterId = ((await squatter.json()) as { id: string }).id;
    await d1()
      .db.prepare(
        "INSERT INTO oauth_identities (provider, provider_id, user_id) VALUES ('google', 'g-squatter', ?)",
      )
      .bind(squatterId)
      .run();
    const claim = await oauthCallback({
      sub: "g-owner",
      email: "victim@example.com",
      email_verified: true,
    });
    expect(authErrorOf(claim)).toBeNull();
    expect(await identityRows()).toEqual([
      { provider: "google", providerId: "g-owner", userId: squatterId },
    ]);
    expect(logged("oauth_linked", "login_ok")).toEqual([
      {
        evt: "auth",
        kind: "oauth_linked",
        provider: "google",
        account: UNTAGGED,
        claimed: true,
        identitiesRemoved: 1,
        sessionsRevoked: 1,
      },
      { evt: "auth", kind: "login_ok", method: "oauth", provider: "google", account: UNTAGGED },
    ]);
    // The squatter's identity no longer signs in: Google calls the email unverified for it.
    const again = await oauthCallback({ sub: "g-squatter", email: "victim@example.com" });
    expect(authErrorOf(again)).toBe("email-in-use");
    expect(sessionCookieOf(again)).toBeNull();
  });

  it("logs a new Google account and a plain link apart from a claim", async () => {
    await insertUser({ email: "brock@example.com", emailVerified: true });
    await oauthCallback({ sub: "g-1", email: "erika@example.com", email_verified: true });
    await oauthCallback({ sub: "g-2", email: "brock@example.com", email_verified: true });
    await oauthCallback({ sub: "g-1", email: "erika@example.com", email_verified: true });
    expect(logged("oauth_created", "oauth_linked")).toEqual([
      { evt: "auth", kind: "oauth_created", provider: "google", account: UNTAGGED },
      {
        evt: "auth",
        kind: "oauth_linked",
        provider: "google",
        account: UNTAGGED,
        claimed: false,
      },
    ]);
    expect(logged("login_ok")).toHaveLength(3);
  });
});

describe("POST /auth/logout-all (AU7)", () => {
  const post = (path: string, cookie: string | null) =>
    app.request(
      path,
      { method: "POST", headers: cookie === null ? {} : { Cookie: cookie } },
      d1().env(),
    );

  it("ends every session of the account, this one included, and no one else's", async () => {
    const here = sessionCookieOf(await register("misty@example.com", "starmie-456"));
    const elsewhere = sessionCookieOf(await login("misty@example.com", "starmie-456"));
    const brock = await signedInUser(d1().db, "brock@example.com");
    const res = await post("/auth/logout-all", here);
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toBe(
      (await post("/auth/logout", null)).headers.get("Set-Cookie"),
    );
    expect((await me(here)).status).toBe(401);
    expect((await me(elsewhere)).status).toBe(401);
    expect((await me(brock.cookie)).status).toBe(200);
    expect(logged("logout_all")).toEqual([
      { evt: "auth", kind: "logout_all", account: UNTAGGED, sessions: 2 },
    ]);
    // The password still works: only sessions end.
    expect((await login("misty@example.com", "starmie-456")).status).toBe(200);
  });

  it("401s without a live session and ends nothing", async () => {
    const brock = await signedInUser(d1().db, "brock@example.com");
    expect((await post("/auth/logout-all", null)).status).toBe(401);
    expect((await post("/auth/logout-all", "session=not-a-session")).status).toBe(401);
    expect((await me(brock.cookie)).status).toBe(200);
  });
});

describe("audit trail (AU10)", () => {
  const LOG_TAG_KEY = "test-log-tag-key";

  it("tags each account's events with one keyed tag that names no id, email or address", async () => {
    const env = d1().env({ LOG_TAG_KEY });
    const send = (path: string, init: RequestInit) => app.request(path, init, env);
    const headers = { "cf-connecting-ip": "203.0.113.9" };
    const registered = await send(
      "/auth/register",
      postJson({ email: "misty@example.com", password: "starmie-456" }, headers),
    );
    const misty = ((await registered.json()) as { id: string }).id;
    await send(
      "/auth/login",
      postJson({ email: "misty@example.com", password: "wrong-guess" }, headers),
    );
    const signedIn = await send(
      "/auth/login",
      postJson({ email: "misty@example.com", password: "starmie-456" }, headers),
    );
    const cookie = sessionCookieOf(signedIn) ?? "";
    await send("/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ displayName: "Misty W" }),
    });
    await send("/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    await send(
      "/auth/register",
      postJson(
        { email: "brock@example.com", password: "onix-7890" },
        { "cf-connecting-ip": "1.2.3.4" },
      ),
    );

    const lines = logged();
    expect(lines.map((line) => line.kind)).toEqual([
      "registered",
      "login_failed",
      "login_ok",
      "profile_updated",
      "logout",
      "registered",
    ]);
    const tags = lines.map((line) => line.account);
    const mistyTag = tags[0];
    expect(mistyTag).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(tags.slice(0, 5)).toEqual(Array(5).fill(mistyTag));
    expect(tags[5]).not.toBe(mistyTag);
    expect(lines[2]).toEqual({
      evt: "auth",
      kind: "login_ok",
      method: "password",
      account: mistyTag,
      rehashed: false,
    });
    const text = JSON.stringify(lines);
    for (const secret of [misty, "misty@example.com", "brock", "203.0.113.9", "starmie"]) {
      expect(text).not.toContain(secret);
    }
    // Another key gives other tags: without the secret a tag cannot be computed from an id.
    const again = sessionCookieOf(await login("misty@example.com", "starmie-456")) ?? "";
    await app.request(
      "/auth/logout-all",
      { method: "POST", headers: { Cookie: again } },
      d1().env({ LOG_TAG_KEY: "another-key" }),
    );
    expect(logged("logout_all")[0]?.account).not.toBe(mistyTag);
  });

  it("tags the network a refused attempt came from, never its address", async () => {
    const env = d1().env({ LOG_TAG_KEY });
    const keys = await rateLimitKeys("login", "203.0.113.9", "misty@example.com");
    await d1()
      .db.prepare("INSERT INTO auth_rate_limits (key, count, reset_at) VALUES (?, ?, ?)")
      .bind(keys.ip, 51, Date.now() + 60_000)
      .run();
    const res = await app.request(
      "/auth/login",
      postJson(
        { email: "misty@example.com", password: "starmie-456" },
        { "cf-connecting-ip": "203.0.113.9" },
      ),
      env,
    );
    expect(res.status).toBe(429);
    const [line] = logged("rate_limited");
    expect(line).toEqual({
      evt: "auth",
      kind: "rate_limited",
      scope: "login",
      net: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
    });
    expect(JSON.stringify(line)).not.toContain("203.0.113");
  });
});

describe("password pepper (AU9)", () => {
  async function storedHash(email: string) {
    return (
      await d1()
        .db.prepare("SELECT password_hash AS hash FROM users WHERE email = ?")
        .bind(email)
        .first<{ hash: string | null }>()
    )?.hash;
  }

  it("re-peppers an unpeppered hash on the next login, which keeps working", async () => {
    await insertUser({
      email: "oak@example.com",
      passwordHash: await hashPassword("pallet-town", DEFAULT_ITERATIONS),
    });
    expect((await login("oak@example.com", "pallet-town")).status).toBe(200);
    const pepper = await pepperOf(TEST_PEPPER);
    expect(parsePasswordHash((await storedHash("oak@example.com")) ?? "")?.pepperId).toBe(
      pepper.id,
    );
    expect(logged("login_ok")).toEqual([
      { evt: "auth", kind: "login_ok", method: "password", account: UNTAGGED, rehashed: true },
    ]);
    expect((await login("oak@example.com", "pallet-town")).status).toBe(200);
    expect((await login("oak@example.com", "pallet-tow")).status).toBe(401);
  });

  it("hashes unpeppered without the secret and logs it, then upgrades once it is set", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const unpeppered = d1().env({ PASSWORD_PEPPER: undefined });
    const res = await app.request(
      "/auth/register",
      postJson({ email: "misty@example.com", password: "starmie-456" }),
      unpeppered,
    );
    expect(res.status).toBe(201);
    expect(await storedHash("misty@example.com")).toMatch(/^pbkdf2\$100000\$/);
    expect(error.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { evt: "auth", kind: "pepper_missing" },
    ]);
    expect((await login("misty@example.com", "starmie-456")).status).toBe(200);
    expect(await storedHash("misty@example.com")).toMatch(/^pbkdf2p\$/);
  });

  it("answers 503, not a wrong password, while a peppered hash's pepper is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await register("misty@example.com", "starmie-456");
    for (const env of [
      d1().env({ PASSWORD_PEPPER: undefined }),
      d1().env({ PASSWORD_PEPPER: "a-different-pepper" }),
    ]) {
      for (const password of ["starmie-456", "wrong-guess"]) {
        const res = await app.request(
          "/auth/login",
          postJson({ email: "misty@example.com", password }),
          env,
        );
        expect(res.status).toBe(503);
        expect(res.headers.get("Retry-After")).toBe("60");
      }
    }
    expect(logged("login_failed")).toEqual([]);
    expect(await storedHash("misty@example.com")).toMatch(/^pbkdf2p\$/);
  });

  it("verifies under PASSWORD_PEPPER_PREVIOUS while rotating, and re-peppers with the new one", async () => {
    await register("misty@example.com", "starmie-456");
    const signIn = (env: Env) =>
      app.request(
        "/auth/login",
        postJson({ email: "misty@example.com", password: "starmie-456" }),
        env,
      );
    const rotating = d1().env({
      PASSWORD_PEPPER: "the-new-pepper",
      PASSWORD_PEPPER_PREVIOUS: TEST_PEPPER,
    });
    expect((await signIn(rotating)).status).toBe(200);
    const fresh = await pepperOf("the-new-pepper");
    expect(parsePasswordHash((await storedHash("misty@example.com")) ?? "")?.pepperId).toBe(
      fresh.id,
    );
    expect((await signIn(d1().env({ PASSWORD_PEPPER: "the-new-pepper" }))).status).toBe(200);
  });

  it("checks a deletion's password under the pepper too", async () => {
    const cookie = sessionCookieOf(await register("misty@example.com", "starmie-456"));
    const res = await app.request(
      "/auth/me",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Cookie: cookie ?? "" },
        body: JSON.stringify({ password: "starmie-456" }),
      },
      d1().env(),
    );
    expect(res.status).toBe(204);
  });
});

describe("per-email failure cap (AU6)", () => {
  const attempt = (email: string, password: string, ip: string) =>
    app.request(
      "/auth/login",
      postJson({ email, password }, { "cf-connecting-ip": ip }),
      d1().env(),
    );

  async function failures(email: string) {
    const keys = await rateLimitKeys("login", "any address", email);
    return (
      await d1()
        .db.prepare("SELECT count FROM auth_rate_limits WHERE key = ?")
        .bind(keys.email)
        .first<{ count: number }>()
    )?.count;
  }

  async function spendCap(email: string) {
    const keys = await rateLimitKeys("login", "any address", email);
    await d1()
      .db.prepare("INSERT INTO auth_rate_limits (key, count, reset_at) VALUES (?, ?, ?)")
      .bind(keys.email, EMAIL_MAX_FAILURES, Date.now() + 30 * 60 * 1000)
      .run();
  }

  it("counts failures per email across addresses, and not successes", async () => {
    await register("misty@example.com", "starmie-456");
    expect((await attempt("Misty@example.com", "wrong-1", "203.0.113.1")).status).toBe(401);
    expect((await attempt("misty@example.com", "wrong-2", "198.51.100.2")).status).toBe(401);
    expect((await attempt("misty@example.com", "starmie-456", "198.51.100.3")).status).toBe(200);
    expect(await failures("misty@example.com")).toBe(2);
  });

  it("answers 429 to further failures past the cap, from any address, and still signs the owner in", async () => {
    await register("misty@example.com", "starmie-456");
    await spendCap("misty@example.com");
    const refused = await attempt("misty@example.com", "wrong-guess", "203.0.113.50");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "too many attempts" });
    const retryAfter = Number(refused.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(29 * 60);
    expect(retryAfter).toBeLessThanOrEqual(30 * 60);
    expect(sessionCookieOf(refused)).toBeNull();
    // The right password is not refused: the cap cannot lock the owner out.
    const owner = await attempt("misty@example.com", "starmie-456", "198.51.100.7");
    expect(owner.status).toBe(200);
    expect((await me(sessionCookieOf(owner))).status).toBe(200);
    // A failure past the cap writes nothing.
    expect(await failures("misty@example.com")).toBe(EMAIL_MAX_FAILURES);
    expect(logged("login_failed")).toEqual([
      {
        evt: "auth",
        kind: "login_failed",
        reason: "wrong_password",
        account: UNTAGGED,
        capped: true,
      },
    ]);
  });

  it("treats an unknown email the same way, so the cap tells nothing about who has an account", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await attempt("nobody@example.com", `guess-${i}`, `203.0.113.${i}`)).status).toBe(
        401,
      );
    }
    expect(await failures("nobody@example.com")).toBe(3);
    await spendCap("ghost@example.com");
    expect((await attempt("ghost@example.com", "guess", "203.0.113.9")).status).toBe(429);
  });

  it("caps one email only", async () => {
    await register("misty@example.com", "starmie-456");
    await spendCap("brock@example.com");
    expect((await attempt("misty@example.com", "wrong-guess", "203.0.113.9")).status).toBe(401);
  });
});
