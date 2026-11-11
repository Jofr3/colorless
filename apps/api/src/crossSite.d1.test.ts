// Requests from a foreign site carrying the visitor's session cookie: every unsafe-method route
// and the lobby WebSocket upgrade. A new unsafe route must be added to UNSAFE_ROUTES.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCookie } from "./auth/session";
import { resetLogThrottle } from "./http/log";
import app from "./index";
import { type SignedIn, signedInUser, useTestD1 } from "./testing/d1";

const APP = "https://colorless.example";
const EVIL = "https://evil.example";
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Every unsafe-method route with a body its schema accepts, and for a POST (which a page can
    send without a preflight) what a cross-site form-encodable POST with the cookie gets: the
    Origin guard refuses each before it runs. */
const UNSAFE_ROUTES: Record<string, { body?: unknown; textPlain?: number }> = {
  "POST /auth/register": {
    body: { email: "new@example.com", password: "hunter2hunter2" },
    textPlain: 403,
  },
  "POST /auth/login": {
    body: { email: "victim@example.com", password: "hunter2hunter2" },
    textPlain: 403,
  },
  // Without the guard, would sign the visitor out.
  "POST /auth/logout": { textPlain: 403 },
  // Would sign the visitor out everywhere.
  "POST /auth/logout-all": { textPlain: 403 },
  "POST /auth/verify-email": { textPlain: 403 },
  "POST /auth/reset-password": { textPlain: 403 },
  "POST /decks": { body: { name: "Planted", tint: 1 }, textPlain: 403 },
  // Without the guard, would mint a lobby on the visitor's address.
  "POST /lobby": { textPlain: 403 },
  "PATCH /auth/me": { body: { displayName: "Mallory" } },
  "DELETE /auth/me": { body: { confirmEmail: "victim@example.com" } },
  "PATCH /decks/:id": { body: { name: "Hijacked" } },
  "DELETE /decks/:id": {},
};

const FORM_CONTENT_TYPES = [
  "text/plain",
  "application/x-www-form-urlencoded",
  "multipart/form-data; boundary=x",
];

const routeKey = (route: { method: string; path: string }) => `${route.method} ${route.path}`;
const unsafeRoutes = [
  ...new Set(app.routes.filter((route) => UNSAFE.has(route.method)).map(routeKey)),
];
const textPlainPosts = Object.entries(UNSAFE_ROUTES).flatMap(([key, row]) =>
  row.textPlain === undefined ? [] : [[key, row.textPlain] as const],
);

const d1 = useTestD1();

type Forwarded = { origin: string | null; cookie: string | null };

/** A LOBBY namespace whose DO accepts every create and upgrade, recording what reached it. */
function lobbyStub() {
  const forwarded: Forwarded[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (input: Request | string, init?: RequestInit) => {
        const request = typeof input === "string" ? new Request(input, init) : input;
        forwarded.push({
          origin: request.headers.get("Origin"),
          cookie: request.headers.get("Cookie"),
        });
        return new Response(null, { status: request.url.endsWith("/create") ? 201 : 200 });
      },
    }),
  };
  return { namespace, forwarded };
}

let victim: SignedIn;
let deckId: string;
let lobby: ReturnType<typeof lobbyStub>;
const env = () => d1().env({ APP_ORIGIN: APP, LOBBY: lobby.namespace });

beforeEach(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  lobby = lobbyStub();
  victim = await signedInUser(d1().db, "victim@example.com");
  const res = await app.request(
    "/decks",
    {
      method: "POST",
      headers: { Origin: APP, "Content-Type": "application/json", Cookie: victim.cookie },
      body: JSON.stringify({ name: "Mine", tint: 1 }),
    },
    env(),
  );
  expect(res.status).toBe(201);
  deckId = ((await res.json()) as { id: string }).id;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetLogThrottle();
});

function split(key: string): [method: string, path: string] {
  const [method = "", path = ""] = key.split(" ");
  return [method, path.replace(":id", deckId)];
}

function counts() {
  return d1()
    .db.prepare(
      `SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM sessions) AS sessions,
        (SELECT count(*) FROM decks) AS decks`,
    )
    .first();
}

const upgrade = (origin?: string) =>
  app.request(
    "/lobby/BCDF/ws",
    {
      headers: {
        Upgrade: "websocket",
        Cookie: victim.cookie,
        ...(origin === undefined ? {} : { Origin: origin }),
      },
    },
    env(),
  );

describe("cross-site requests", () => {
  it("lists every unsafe-method route", () => {
    expect(
      unsafeRoutes.filter((key) => !(key in UNSAFE_ROUTES)),
      "New unsafe route(s): add each to UNSAFE_ROUTES (apps/api/src/crossSite.d1.test.ts) with " +
        "a schema-valid body and, for a POST, the status a cross-site text/plain POST gets",
    ).toEqual([]);
    expect(Object.keys(UNSAFE_ROUTES).filter((key) => !unsafeRoutes.includes(key))).toEqual([]);
  });

  it.each(unsafeRoutes)("%s: a preflight from a foreign Origin is not allowed", async (key) => {
    const [method, path] = split(key);
    const preflight = (origin: string) =>
      app.request(
        path,
        {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "content-type",
          },
        },
        env(),
      );
    expect((await preflight(EVIL)).headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await preflight(APP)).headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });

  it.each(textPlainPosts)(
    "%s: a cross-site form-encodable POST with the cookie answers %i, unreadable",
    async (key, status) => {
      const [method, path] = split(key);
      for (const contentType of FORM_CONTENT_TYPES) {
        const res = await app.request(
          path,
          {
            method,
            headers: { Origin: EVIL, Cookie: victim.cookie, "Content-Type": contentType },
            body: JSON.stringify(UNSAFE_ROUTES[key]?.body ?? {}),
          },
          env(),
        );
        expect(res.status, contentType).toBe(status);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      }
    },
  );

  it("JSON routes write nothing from a cross-site form body", async () => {
    const before = await counts();
    for (const key of ["POST /auth/register", "POST /auth/login", "POST /decks"]) {
      const [method, path] = split(key);
      for (const contentType of FORM_CONTENT_TYPES) {
        const res = await app.request(
          path,
          {
            method,
            headers: { Origin: EVIL, Cookie: victim.cookie, "Content-Type": contentType },
            body: JSON.stringify(UNSAFE_ROUTES[key]?.body),
          },
          env(),
        );
        expect(res.ok, `${key} ${contentType}`).toBe(false);
      }
    }
    expect(await counts()).toEqual(before);
  });

  it("does not echo a foreign Origin on a plain read", async () => {
    const res = await app.request("/health", { headers: { Origin: EVIL } }, env());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("forwards a lobby upgrade with the cookie from the app or from a non-browser client", async () => {
    expect((await upgrade(APP)).status).toBe(200);
    expect((await upgrade()).status).toBe(200);
    expect(lobby.forwarded).toEqual([
      { origin: APP, cookie: victim.cookie },
      { origin: null, cookie: victim.cookie },
    ]);
  });

  it("AU1: refuses a lobby upgrade from a foreign Origin", async () => {
    const res = await upgrade(EVIL);
    expect(lobby.forwarded).toEqual([]);
    expect(res.status).toBe(403);
  });
});

describe("the cross-site Origin guard and Lax cookie (AEX1)", () => {
  it("AEX1: a cross-site text/plain logout leaves the session alive", async () => {
    await app.request(
      "/auth/logout",
      {
        method: "POST",
        headers: { Origin: EVIL, Cookie: victim.cookie, "Content-Type": "text/plain" },
      },
      env(),
    );
    const me = await app.request("/auth/me", { headers: { Cookie: victim.cookie } }, env());
    expect(me.status).toBe(200);
  });

  it.each([
    ["the app's Origin, same-site", { Origin: APP, "Sec-Fetch-Site": "same-site" }, 201],
    ["no Origin (not a browser page)", {}, 201],
    ["a null Origin", { Origin: "null" }, 403],
    ["no Origin but Sec-Fetch-Site cross-site", { "Sec-Fetch-Site": "cross-site" }, 403],
  ])("AEX1: POST /lobby with %s answers %i", async (_, headers, status) => {
    const res = await app.request("/lobby", { method: "POST", headers }, env());
    expect(res.status).toBe(status);
  });

  it("AEX1: the session cookie is SameSite=Lax", () => {
    expect(sessionCookie("token")).toContain("SameSite=Lax");
  });

  it.each(unsafeRoutes)(
    "AEX1: refuses %s from a foreign Origin with the cookie and a JSON body",
    async (key) => {
      const [method, path] = split(key);
      const body = UNSAFE_ROUTES[key]?.body;
      const res = await app.request(
        path,
        {
          method,
          headers: { Origin: EVIL, Cookie: victim.cookie, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env(),
      );
      expect(res.status).toBe(403);
    },
  );
});
