// Auth route behavior that doesn't need a real D1 (the catalog routes.test.ts
// pattern): body validation and rate limiting run BEFORE any DB access, the
// cookie-less session paths, OAuth configuration gating + state verification
// (which precede the provider fetches), and the 501 email stubs. The full
// data paths (register→me→logout, wrong-password 401, duplicate 409) run
// against the real local D1 via `wrangler dev` — see docs §3.5.

import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import app from "../index";
import { RATE_LIMIT_MAX_ATTEMPTS } from "./rateLimit";

/** In-memory stand-in for the CACHE KV namespace. */
function fakeKv(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  };
  return { kv, store };
}

/** DB/ASSETS stay undefined — any touch throws loudly, proving order. */
function envWith(overrides: Partial<Record<keyof Env, unknown>> = {}): Env {
  return { DB: undefined, ASSETS: undefined, CACHE: undefined, ...overrides } as unknown as Env;
}

function postJson(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

describe("POST /auth/register|login body validation", () => {
  it("400s invalid bodies with a terse JSON error, before KV or D1", async () => {
    const cases: [string, unknown][] = [
      ["/auth/register", { email: "not-an-email", password: "long-enough" }],
      ["/auth/register", { email: "a@b.co", password: "short" }],
      ["/auth/register", { email: "a@b.co" }],
      ["/auth/login", { email: "a@b.co", password: "" }],
      ["/auth/login", {}],
    ];
    for (const [path, body] of cases) {
      // Even CACHE is undefined: validation must come before rate limiting.
      const res = await app.request(path, postJson(body), envWith());
      expect(res.status).toBe(400);
      const payload = (await res.json()) as { error: string; issues: string[] };
      expect(payload.error).toBe("invalid body");
      expect(payload.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("auth rate limiting", () => {
  const seededEnv = (key: string) => {
    const { kv } = fakeKv({
      [key]: JSON.stringify({
        count: RATE_LIMIT_MAX_ATTEMPTS,
        resetAt: Date.now() + 10 * 60 * 1000,
      }),
    });
    return envWith({ CACHE: kv });
  };

  it("429s register/login once the (ip, email) window is exhausted — before D1", async () => {
    for (const [path, scope] of [
      ["/auth/register", "register"],
      ["/auth/login", "login"],
    ] as const) {
      const env = seededEnv(`ratelimit:${scope}:203.0.113.9:ash@example.com`);
      const res = await app.request(
        path,
        postJson(
          { email: "Ash@example.com", password: "long-enough-pw" },
          { "cf-connecting-ip": "203.0.113.9" },
        ),
        env,
      );
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(((await res.json()) as { error: string }).error).toBe("too many attempts");
    }
  });

  it("keys per IP: another address is not blocked by the exhausted one", async () => {
    const env = seededEnv("ratelimit:login:203.0.113.9:ash@example.com");
    // Different IP → fresh window → passes the guard and reaches D1, which
    // is undefined here and throws → Hono answers 500. 500-not-429 is the
    // assertion that the limiter let it through.
    const res = await app.request(
      "/auth/login",
      postJson(
        { email: "ash@example.com", password: "long-enough-pw" },
        { "cf-connecting-ip": "198.51.100.7" },
      ),
      env,
    );
    expect(res.status).toBe(500);
  });
});

describe("session routes without a cookie", () => {
  it("GET /auth/me → 401 without touching D1", async () => {
    const res = await app.request("/auth/me", {}, envWith());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
  });

  it("PATCH /auth/me → 401 before the body is even looked at", async () => {
    // Order matters: a signed-out caller hears "unauthorized", not a critique
    // of their body — and an invalid body from a stranger costs no D1.
    const res = await app.request(
      "/auth/me",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" },
      envWith(),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
  });

  it("POST /auth/logout → 204 and clears the cookie, no D1 needed", async () => {
    const res = await app.request("/auth/logout", { method: "POST" }, envWith());
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toBe(
      "session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None",
    );
  });
});

describe("GET /auth/oauth/:provider (start)", () => {
  it("404s unknown providers", async () => {
    const res = await app.request("/auth/oauth/github", {}, envWith());
    expect(res.status).toBe(404);
  });

  it("503s a known provider whose secrets are not installed", async () => {
    for (const provider of ["discord", "google"]) {
      const res = await app.request(`/auth/oauth/${provider}`, {}, envWith());
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "provider not configured" });
    }
  });

  it("302s to the provider with a state that matches the cookie", async () => {
    const env = envWith({ DISCORD_CLIENT_ID: "d-id", DISCORD_CLIENT_SECRET: "d-secret" });
    const res = await app.request(
      "http://localhost:8787/auth/oauth/discord?redirect=/decks",
      {},
      env,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(location.origin + location.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(location.searchParams.get("client_id")).toBe("d-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8787/auth/oauth/discord/callback",
    );
    expect(location.searchParams.get("scope")).toBe("identify email");
    const state = location.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain(`oauth_state=${state}.`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=600");
  });
});

describe("GET /auth/oauth/:provider/callback", () => {
  it("503s while unconfigured, mirroring the start route", async () => {
    const res = await app.request("/auth/oauth/google/callback?code=x&state=y", {}, envWith());
    expect(res.status).toBe(503);
  });

  it("400s a state mismatch before exchanging the code", async () => {
    const env = envWith({ GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret" });
    const cases = [
      { query: "?code=x&state=forged", cookie: undefined }, // no cookie at all
      { query: "?code=x", cookie: "oauth_state=real.Lw" }, // provider sent no state
      { query: "?state=real", cookie: "oauth_state=real.Lw" }, // no code
      { query: "?code=x&state=forged", cookie: "oauth_state=real.Lw" }, // mismatch
    ];
    for (const { query, cookie } of cases) {
      const res = await app.request(
        `/auth/oauth/google/callback${query}`,
        { headers: cookie ? { Cookie: cookie } : {} },
        env,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid oauth state");
      // The one-shot state cookie is dropped even on failure.
      expect(res.headers.get("Set-Cookie")).toContain("oauth_state=; Max-Age=0");
    }
  });
});

describe("email-dependent stubs (§3.5 TODO)", () => {
  it("501s verify-email and reset-password with an explanatory body", async () => {
    for (const path of ["/auth/verify-email", "/auth/reset-password"]) {
      const res = await app.request(path, { method: "POST" }, envWith());
      expect(res.status).toBe(501);
      const payload = (await res.json()) as { error: string; detail: string };
      expect(payload.error).toBe("not implemented");
      expect(payload.detail).toContain("email provider");
    }
  });
});

describe("CORS for the credentialed web app", () => {
  it("echoes APP_ORIGIN with credentials on auth responses", async () => {
    const env = envWith({ CACHE: fakeKv().kv, APP_ORIGIN: "https://web.example" });
    const res = await app.request("/auth/me", { headers: { Origin: "https://web.example" } }, env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://web.example");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("answers preflight for cross-origin JSON POSTs", async () => {
    const res = await app.request(
      "/auth/login",
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      },
      envWith(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });
});
