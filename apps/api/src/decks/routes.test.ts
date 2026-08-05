// Deck/folder route behavior that doesn't need a real D1 (the catalog/auth
// routes.test.ts pattern): body validation runs BEFORE the session gate and
// any DB access, and every endpoint 401s a cookie-less request without
// touching D1 (DB stays undefined — any touch would throw a 500, so the
// asserted status IS the proof of ordering). The full CRUD paths run against
// the real local D1 via `wrangler dev` — see docs §6.

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
    ["/decks/reorder", jsonInit("POST", { positions: [{ id: "d1", position: 0 }] })],
    ["/folders", {}],
    ["/folders", jsonInit("POST", { name: "Standard" })],
    ["/folders/f1", jsonInit("PATCH", { name: "Renamed" })],
    ["/folders/f1", { method: "DELETE" }],
    ["/folders/reorder", jsonInit("POST", { positions: [{ id: "f1", position: 0 }] })],
  ];

  it.each(requests)("%s %o → 401", async (path, init) => {
    const res = await app.request(path, init, bareEnv());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
    // No token was presented, so nothing to clear.
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("body validation runs before auth and D1", () => {
  // No cookie AND no DB: a 400 here proves the validator answered first.
  const invalid: [string, "POST" | "PATCH", unknown][] = [
    ["/decks", "POST", { name: "No tint" }],
    ["/decks", "POST", { name: "", tint: 22 }],
    ["/decks", "POST", { ...VALID_DECK, tint: 361 }],
    [
      "/decks",
      "POST",
      {
        ...VALID_DECK,
        cards: [
          { cardId: "sv01-001", count: 1 },
          { cardId: "sv01-001", count: 2 },
        ],
      },
    ],
    ["/decks", "POST", { ...VALID_DECK, cards: [{ cardId: "sv01-001", count: 100 }] }],
    ["/decks/d1", "PATCH", {}],
    ["/folders", "POST", {}],
    ["/folders/f1", "PATCH", {}],
    ["/decks/reorder", "POST", { positions: [] }],
    ["/decks/reorder", "POST", { positions: [{ id: "d1", position: 0.5 }] }],
    [
      "/decks/reorder",
      "POST",
      {
        positions: [
          { id: "d1", position: 0 },
          { id: "d1", position: 1 },
        ],
      },
    ],
    ["/folders/reorder", "POST", { positions: [] }],
  ];

  it.each(invalid)("%s %s %o → 400 invalid body", async (path, method, body) => {
    const res = await app.request(path, jsonInit(method, body), bareEnv());
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: string; issues: string[] };
    expect(payload.error).toBe("invalid body");
    expect(payload.issues.length).toBeGreaterThan(0);
  });

  it("names duplicate cardIds in the 400 issues", async () => {
    const body = {
      ...VALID_DECK,
      cards: [
        { cardId: "sv01-001", count: 1 },
        { cardId: "sv01-001", count: 2 },
      ],
    };
    const res = await app.request("/decks", jsonInit("POST", body), bareEnv());
    const payload = (await res.json()) as { issues: string[] };
    expect(payload.issues.join("\n")).toContain("sv01-001");
  });
});
