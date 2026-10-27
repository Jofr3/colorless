// Every route the app registers, classified by who may call it. A route missing from ACCESS fails
// the sweep, so a new route cannot ship without saying whether it needs a session and whether it
// reads or writes one user's rows.

import { describe, expect, it } from "vitest";
import { requireUser } from "./auth/requireUser";
import app from "./index";
import { type SignedIn, signedInUser, useTestD1 } from "./testing/d1";

type Access =
  /** Middleware mounted with `app.use`, not a route. */
  | { kind: "middleware" }
  | { kind: "public" }
  /** Behind requireUser, acting only on the caller's own account. */
  | { kind: "requireUser"; body?: unknown }
  /** Behind requireUser, naming another row by `:id` that must be the caller's. */
  | { kind: "owner"; body?: unknown };

const ACCESS: Record<string, Access> = {
  "ALL /*": { kind: "middleware" },
  "GET /health": { kind: "public" },
  "GET /health/db": { kind: "public" },
  "POST /auth/register": { kind: "public" },
  "POST /auth/login": { kind: "public" },
  "POST /auth/logout": { kind: "public" },
  "GET /auth/oauth/:provider": { kind: "public" },
  "GET /auth/oauth/:provider/callback": { kind: "public" },
  "POST /auth/verify-email": { kind: "public" },
  "POST /auth/reset-password": { kind: "public" },
  "GET /assets/cards/:cardId/:file": { kind: "public" },
  "GET /assets/sets/:setId/:file": { kind: "public" },
  "GET /cards": { kind: "public" },
  "GET /cards/index": { kind: "public" },
  "GET /cards/full": { kind: "public" },
  "GET /cards/:id": { kind: "public" },
  "GET /sets": { kind: "public" },
  "GET /sets/:id": { kind: "public" },
  "GET /series": { kind: "public" },
  "GET /facets": { kind: "public" },
  // Seats are account-less; the DO reads the cookie only to owner-scope the deck it loads.
  "POST /lobby": { kind: "public" },
  "GET /lobby/:code/ws": { kind: "public" },
  "GET /auth/me": { kind: "requireUser" },
  "PATCH /auth/me": { kind: "requireUser", body: { displayName: "Mallory" } },
  "DELETE /auth/me": { kind: "requireUser", body: {} },
  "POST /auth/logout-all": { kind: "requireUser" },
  "GET /decks": { kind: "requireUser" },
  "POST /decks": { kind: "requireUser", body: { name: "Probe", tint: 1 } },
  "GET /decks/:id": { kind: "owner" },
  "PATCH /decks/:id": { kind: "owner", body: { name: "Hijacked" } },
  "DELETE /decks/:id": { kind: "owner" },
};

const routeKey = (route: { method: string; path: string }) => `${route.method} ${route.path}`;
const registered = [...new Set(app.routes.map(routeKey))];
const gated = (kind: Access["kind"]) => registered.filter((key) => ACCESS[key]?.kind === kind);
const protectedRoutes = [...gated("requireUser"), ...gated("owner")];

const d1 = useTestD1();

/** The request a route's probe sends: its schema-valid body, `:id` naming `deckId`. */
function probe(key: string, deckId: string, cookie?: string): [string, RequestInit] {
  const [method = "", path = ""] = key.split(" ");
  const url = path.replace(":id", deckId);
  if (url.includes(":")) throw new Error(`${key}: teach probe() a fixture for this path parameter`);
  const access = ACCESS[key];
  const body = access !== undefined && "body" in access ? access.body : undefined;
  const headers: Record<string, string> = cookie === undefined ? {} : { Cookie: cookie };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return [url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }];
}

async function createDeck(owner: SignedIn): Promise<string> {
  const [url, init] = probe("POST /decks", "", owner.cookie);
  const res = await app.request(url, init, d1().env());
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function snapshot() {
  const { db } = d1();
  const [users, decks, deckCards] = await db.batch([
    db.prepare("SELECT * FROM users ORDER BY id"),
    db.prepare("SELECT * FROM decks ORDER BY id"),
    db.prepare("SELECT * FROM deck_cards ORDER BY deck_id, card_id"),
  ]);
  return { users: users?.results, decks: decks?.results, deckCards: deckCards?.results };
}

describe("route access", () => {
  it("classifies every registered route", () => {
    const unclassified = registered.filter((key) => !(key in ACCESS));
    expect(
      unclassified,
      "New route(s): classify each in ACCESS (apps/api/src/routeAccess.d1.test.ts) as public, " +
        "requireUser or owner. A requireUser or owner route gets a 401 and cross-user 404 check.",
    ).toEqual([]);
    expect(
      Object.keys(ACCESS).filter((key) => !registered.includes(key)),
      "ACCESS names routes the app no longer registers: remove them",
    ).toEqual([]);
  });

  it("puts requireUser on exactly the requireUser and owner routes", () => {
    const withGate = new Set(app.routes.filter((r) => r.handler === requireUser).map(routeKey));
    expect([...withGate].sort()).toEqual([...protectedRoutes].sort());
  });

  it.each(protectedRoutes)("%s answers 401 without a session and changes nothing", async (key) => {
    const victim = await signedInUser(d1().db, "victim@example.com");
    const deckId = await createDeck(victim);
    const before = await snapshot();
    const res = await app.request(...probe(key, deckId), d1().env());
    expect(res.status).toBe(401);
    expect(await snapshot()).toEqual(before);
  });

  it.each(gated("owner"))(
    "%s answers 404 for another user's row and changes nothing",
    async (key) => {
      const victim = await signedInUser(d1().db, "victim@example.com");
      const attacker = await signedInUser(d1().db, "attacker@example.com");
      const deckId = await createDeck(victim);
      const before = await snapshot();
      const res = await app.request(...probe(key, deckId, attacker.cookie), d1().env());
      expect(res.status).toBe(404);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(gated("owner"))("%s reaches the owner's own row", async (key) => {
    const owner = await signedInUser(d1().db, "owner@example.com");
    const deckId = await createDeck(owner);
    const res = await app.request(...probe(key, deckId, owner.cookie), d1().env());
    expect(res.status).toBeLessThan(300);
  });
});
