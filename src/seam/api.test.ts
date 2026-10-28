import { app, fakeRateLimit, seedCards, useTestD1 } from "@colorless/api/testing/contract";
import {
  cardBriefSchema,
  cardSchema,
  catalogFacetsSchema,
  deckConflictSchema,
  deckSchema,
  deckSummarySchema,
  paginatedSchema,
  serieSchema,
  setBriefSchema,
  userSchema,
} from "@colorless/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";

// The web client's api.ts against the real Worker routes on a real D1, through a fetch that does
// what a browser does: the page's Origin on writes and a cookie jar. Every answer is parsed by the
// shared schema, and every refusal checked for the status and body the screens branch on.

const ORIGIN = "http://localhost:5175";
const d1 = useTestD1((db) =>
  seedCards(db, [
    { id: "sv01-004", name: "Charmander", category: "Pokemon", hp: 70 },
    { id: "sv01-230", name: "Fire Energy", category: "Energy" },
  ]),
);

let jar = new Map<string, string>();
let bindings: Parameters<ReturnType<typeof d1>["env"]>[0] = {};

beforeEach(() => {
  jar = new Map();
  bindings = {};
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    if (request.method !== "GET") headers.set("Origin", ORIGIN);
    if (jar.size > 0) headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await app.fetch(
      new Request(request, { headers }),
      d1().env({ APP_ORIGIN: ORIGIN, ...bindings }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = cookie.split(";");
      const [name = "", value = ""] = pair.split("=");
      const cleared = value === "" || attributes.some((a) => /max-age=0/i.test(a.trim()));
      if (cleared) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  });
});
afterEach(() => {
  api.setSessionRecoveryHandler(null);
  vi.unstubAllGlobals();
});

async function refusal(call: Promise<unknown>): Promise<api.ApiError> {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof api.ApiError)) throw new Error(`expected an ApiError, got ${error}`);
  return error;
}

const ASH = { email: "ash@example.com", password: "pikachu-123" };

describe("api.ts against the Worker", () => {
  it("signs up, saves a deck with its versions, and signs out", async () => {
    const user = userSchema.parse(await api.register(ASH));
    expect(userSchema.parse(await api.me()).id).toBe(user.id);
    expect((await refusal(api.register(ASH))).status).toBe(409);

    const deck = deckSchema.parse(await api.createDeck({ name: "Fire", tint: 3, cards: [] }));
    const cards = [{ cardId: "sv01-004", count: 4 }];
    const saved = deckSchema.parse(await api.patchDeck(deck.id, { cards, version: deck.version }));
    expect(saved.version).toBe((deck.version ?? 0) + 1);

    // A save from the older version: the 409 carries the deck as stored, which is how the
    // builder tells its own landed save from another device's.
    const stale = await refusal(api.patchDeck(deck.id, { cards: [], version: deck.version }));
    expect(stale.status).toBe(409);
    expect(deckConflictSchema.parse(stale.body).deck).toMatchObject({
      cards,
      version: saved.version,
    });

    for (const row of await api.listDecks()) deckSummarySchema.parse(row);
    expect(deckSchema.parse(await api.getDeck(deck.id)).cards).toEqual(cards);
    const unknown = await refusal(
      api.createDeck({ name: "x", tint: 1, cards: [{ cardId: "zz-1", count: 1 }] }),
    );
    expect([unknown.status, unknown.body]).toEqual([
      400,
      { error: "unknown card id(s)", cardIds: ["zz-1"] },
    ]);
    await api.deleteDeck(deck.id);
    expect((await refusal(api.getDeck(deck.id))).status).toBe(404);

    await api.logout();
    await api.logout();
    expect((await refusal(api.me())).status).toBe(401);
    expect((await refusal(api.login({ ...ASH, password: "wrong-pass" }))).status).toBe(401);
    userSchema.parse(await api.login(ASH));
    const wrong = await refusal(api.deleteAccount({ password: "wrong-pass" }));
    expect([wrong.status, wrong.message]).toEqual([401, "invalid password"]);
    await api.deleteAccount({ password: ASH.password });
    const gone = await refusal(api.deleteAccount({ password: ASH.password }));
    expect([gone.status, gone.message]).toEqual([401, "unauthorized"]);
  });

  it("recovers a deck read from a lost session, and reads a rate limit's Retry-After", async () => {
    await api.register(ASH);
    const deck = await api.createDeck({ name: "Fire", tint: 3, cards: [] });
    jar.clear();
    api.setSessionRecoveryHandler(async () => {
      await api.login(ASH);
      return true;
    });
    expect(deckSchema.parse(await api.getDeck(deck.id)).id).toBe(deck.id);

    bindings = { DECK_WRITE_LIMIT: fakeRateLimit(0).binding };
    const limited = await refusal(api.patchDeck(deck.id, { name: "Water" }));
    expect(limited.status).toBe(429);
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("reads the catalog in the shapes the screens parse", async () => {
    const page = paginatedSchema(cardBriefSchema).parse(
      await api.getCards({ category: "Pokemon" }),
    );
    expect(page.items.map((card) => card.id)).toEqual(["sv01-004"]);
    cardSchema.parse(await api.getCard("sv01-004"));
    for (const card of await api.getFullCards(["sv01-004", "sv01-230"])) cardSchema.parse(card);
    for (const set of await api.getSets()) setBriefSchema.parse(set);
    for (const serie of await api.getSeries()) serieSchema.parse(serie);
    catalogFacetsSchema.parse(await api.getFacets());
    expect(typeof (await api.getCardIndex())).toBe("object");
    expect((await refusal(api.getCard("nope"))).status).toBe(404);
  });
});
