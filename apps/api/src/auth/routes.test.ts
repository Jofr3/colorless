import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { Env } from "../env";
import { resetLogThrottle } from "../http/log";
import app from "../index";
import { unpackStateCookieValue } from "./oauth";

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetLogThrottle();
});

/** The structured lines logged so far in this test. */
function logged(): Record<string, unknown>[] {
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
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
  it("400s invalid bodies with a terse JSON error, before D1", async () => {
    const cases: [string, unknown][] = [
      ["/auth/register", { email: "not-an-email", password: "long-enough" }],
      ["/auth/register", { email: "a@b.co", password: "short" }],
      ["/auth/register", { email: "a@b.co" }],
      ["/auth/login", { email: "a@b.co", password: "" }],
      ["/auth/login", {}],
    ];
    for (const [path, body] of cases) {
      // DB is undefined: validation must come before rate limiting.
      const res = await app.request(path, postJson(body), envWith());
      expect(res.status).toBe(400);
      const payload = (await res.json()) as { error: string; issues: string[] };
      expect(payload.error).toBe("invalid body");
      expect(payload.issues.length).toBeGreaterThan(0);
    }
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
  it("uses the configured HTTPS API origin behind a Tailnet proxy", async () => {
    const res = await app.request(
      "http://127.0.0.1:8788/auth/oauth/google",
      {},
      envWith({
        GOOGLE_CLIENT_ID: "g-id",
        GOOGLE_CLIENT_SECRET: "g-secret",
        API_ORIGIN: "https://dev.example.ts.net:8447",
      }),
    );
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("Location") ?? "").searchParams.get("redirect_uri")).toBe(
      "https://dev.example.ts.net:8447/auth/oauth/google/callback",
    );
  });

  it("404s unknown providers", async () => {
    const res = await app.request("/auth/oauth/github", {}, envWith());
    expect(res.status).toBe(404);
  });

  it("rejects removed Discord start and callback routes", async () => {
    for (const path of ["/auth/oauth/discord", "/auth/oauth/discord/callback?code=x&state=y"]) {
      const res = await app.request(path, {}, envWith());
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "unknown provider" });
      expect(res.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("503s a known provider whose secrets are not installed", async () => {
    for (const provider of ["google"]) {
      const res = await app.request(`/auth/oauth/${provider}`, {}, envWith());
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "provider not configured" });
    }
  });

  it("302s to the provider with a state that matches the cookie", async () => {
    const env = envWith({ GOOGLE_CLIENT_ID: "d-id", GOOGLE_CLIENT_SECRET: "d-secret" });
    const res = await app.request(
      "http://localhost:8787/auth/oauth/google?redirect=/decks",
      {},
      env,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(location.searchParams.get("client_id")).toBe("d-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8787/auth/oauth/google/callback",
    );
    expect(location.searchParams.get("scope")).toBe("openid email profile");
    const state = location.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain(`oauth_state=${state}.`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=600");
    expect(
      unpackStateCookieValue(cookie.split(";")[0]?.slice("oauth_state=".length) ?? null),
    ).toEqual({
      state,
      redirect: "/decks",
    });
  });
});

describe("GET /auth/oauth/:provider/callback", () => {
  it("503s while unconfigured, mirroring the start route", async () => {
    const res = await app.request("/auth/oauth/google/callback?code=x&state=y", {}, envWith());
    expect(res.status).toBe(503);
  });

  it("redirects a state mismatch back to the app before exchanging the code", async () => {
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
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("Location") ?? "");
      expect(location.searchParams.get("authError")).toBe("state");
      // The one-shot state cookie is dropped even on failure.
      expect(res.headers.get("Set-Cookie")).toContain("oauth_state=; Max-Age=0");
    }
    expect(logged()).toEqual(
      ["no_cookie", "no_state", "no_code", "mismatch"].map((reason) => ({
        evt: "auth",
        kind: "oauth_state",
        provider: "google",
        reason,
      })),
    );
  });

  it.each([
    [
      "the provider's error code from a refused code exchange",
      () =>
        Response.json(
          { error: "redirect_uri_mismatch", error_description: "Bad" },
          { status: 400 },
        ),
      "exchange",
      { kind: "oauth_exchange", status: 400, providerError: "redirect_uri_mismatch" },
    ],
    [
      "no status for an exchange that never reached the provider",
      () => Promise.reject(new TypeError("network down")),
      "exchange",
      { kind: "oauth_exchange", status: null, providerError: null },
    ],
    [
      "a free-text error as no code",
      () => Response.json({ error: "user misty@example.com is blocked" }, { status: 400 }),
      "exchange",
      { kind: "oauth_exchange", status: 400, providerError: null },
    ],
  ])("logs %s", async (_label, tokenEndpoint, authError, line) => {
    vi.stubGlobal("fetch", vi.fn(tokenEndpoint));
    const res = await app.request(
      "/auth/oauth/google/callback?code=x&state=real",
      { headers: { Cookie: "oauth_state=real.Lw" } },
      envWith({ GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret" }),
    );
    expect(new URL(res.headers.get("Location") ?? "").searchParams.get("authError")).toBe(
      authError,
    );
    expect(logged()).toEqual([{ evt: "auth", provider: "google", ...line }]);
  });

  it("logs the userinfo endpoint's status and error code when the profile fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "https://oauth2.googleapis.com/token"
          ? Response.json({ access_token: "access-token" })
          : Response.json({ error: "invalid_token" }, { status: 401 }),
      ),
    );
    const res = await app.request(
      "/auth/oauth/google/callback?code=x&state=real",
      { headers: { Cookie: "oauth_state=real.Lw" } },
      envWith({ GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret" }),
    );
    expect(new URL(res.headers.get("Location") ?? "").searchParams.get("authError")).toBe(
      "profile",
    );
    expect(logged()).toEqual([
      {
        evt: "auth",
        kind: "oauth_profile",
        provider: "google",
        status: 401,
        providerError: "invalid_token",
      },
    ]);
  });
  it.each([
    ["a network error", () => Promise.reject(new TypeError("network down"))],
    ["a non-JSON body", () => Promise.resolve(new Response("<html>", { status: 200 }))],
    ["an upstream 5xx", () => Promise.resolve(new Response("{}", { status: 502 }))],
  ])("redirects %s during the code exchange back to the app", async (_label, upstream) => {
    vi.stubGlobal("fetch", vi.fn(upstream));
    try {
      const res = await app.request(
        "/auth/oauth/google/callback?code=x&state=real",
        { headers: { Cookie: "oauth_state=real.Lw" } },
        envWith({ GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret" }),
      );
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("Location") ?? "");
      expect(location.searchParams.get("authError")).toBe("exchange");
    } finally {
      vi.unstubAllGlobals();
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
  it.each(["http://localhost:5175", "http://127.0.0.1:5175"])(
    "allows both local addresses when APP_ORIGIN is %s",
    async (configured) => {
      for (const origin of ["http://localhost:5175", "http://127.0.0.1:5175"]) {
        const res = await app.request(
          "/auth/me",
          { headers: { Origin: origin } },
          envWith({ APP_ORIGIN: configured }),
        );
        expect(res.status).toBe(401);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
        expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      }
    },
  );

  it.each([
    ["http://localhost:5175", "http://localhost:5173"],
    ["http://localhost:5175", "http://localhost.evil.example:5175"],
    ["http://localhost:5175", "https://evil.example"],
    ["https://web.example", "http://localhost:5175"],
    ["https://web.example", "http://127.0.0.1:5175"],
    ["https://web.example", "https://evil.example"],
  ])("does not allow %s to grant access to %s", async (configured, origin) => {
    const res = await app.request(
      "/auth/me",
      { headers: { Origin: origin } },
      envWith({ APP_ORIGIN: configured }),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("echoes APP_ORIGIN with credentials on auth responses", async () => {
    const env = envWith({ APP_ORIGIN: "https://web.example" });
    const res = await app.request("/auth/me", { headers: { Origin: "https://web.example" } }, env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://web.example");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it.each(["http://localhost:5175", "http://127.0.0.1:5175"])(
    "answers preflight for %s",
    async (origin) => {
      const res = await app.request(
        "/auth/login",
        {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
          },
        },
        envWith(),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    },
  );
});
