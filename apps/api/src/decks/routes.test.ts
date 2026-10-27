import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import app from "../index";

/** DB/ASSETS/CACHE stay undefined — any touch throws loudly, proving order. */
function bareEnv(): Env {
  return { DB: undefined, ASSETS: undefined, CACHE: undefined } as unknown as Env;
}

function jsonInit(method: "POST" | "PATCH", body: unknown, cookie?: string) {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: JSON.stringify(body),
  };
}

const VALID_DECK = { name: "Charizard ex", tint: 22 };

describe("401 gating without a session cookie (before any D1 access)", () => {
  const requests: [string, RequestInit][] = [
    ["/decks", {}],
    ["/decks/d1", {}],
    ["/decks", jsonInit("POST", VALID_DECK)],
    ["/decks/d1", jsonInit("PATCH", { name: "Renamed" })],
    ["/decks/d1", { method: "DELETE" }],
  ];

  it.each(requests)("%s %o → 401", async (path, init) => {
    const res = await app.request(path, init, bareEnv());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
    // No token was presented, so nothing to clear.
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("the session gate runs before body validation", () => {
  // No cookie AND no DB: a 401 for a bad body proves the validator never ran, so an anonymous
  // caller cannot make the API validate anything (validation itself: routes.d1.test.ts).
  const invalid: [string, "POST" | "PATCH", unknown][] = [
    ["/decks", "POST", { name: "No tint" }],
    ["/decks", "POST", { ...VALID_DECK, cards: [{ cardId: "sv01-001", count: 100 }] }],
    ["/decks/d1", "PATCH", {}],
    [
      "/decks",
      "POST",
      { ...VALID_DECK, cards: Array.from({ length: 1000 }, () => ({ cardId: "x", count: 0 })) },
    ],
  ];

  it.each(invalid)("%s %s %o → 401", async (path, method, body) => {
    const res = await app.request(path, jsonInit(method, body), bareEnv());
    expect(res.status).toBe(401);
  });
});

describe("folder and reorder routes", () => {
  const retired: [string, RequestInit][] = [
    ["/folders", {}],
    ["/folders", jsonInit("POST", { name: "Standard" })],
    ["/folders/f1", jsonInit("PATCH", { name: "Renamed" })],
    ["/folders/f1", { method: "DELETE" }],
    ["/folders/reorder", jsonInit("POST", { positions: [{ id: "f1", position: 0 }] })],
    ["/decks/reorder", jsonInit("POST", { positions: [{ id: "d1", position: 0 }] })],
  ];

  it.each(retired)("%s %o → 404", async (path, init) => {
    const res = await app.request(path, init, bareEnv());
    expect(res.status).toBe(404);
  });
});
