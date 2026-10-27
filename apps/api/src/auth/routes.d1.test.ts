import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import app from "../index";
import { raceBeforeFirstBatch, useTestD1 } from "../testing/d1";
import { packStateCookieValue } from "./oauth";
import { DEFAULT_ITERATIONS, hashPassword, parsePasswordHash } from "./password";

const d1 = useTestD1();

const GOOGLE = { GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret" };

function postJson(body: unknown) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
      DB: raceBeforeFirstBatch(db, async () => {
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
  });

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
