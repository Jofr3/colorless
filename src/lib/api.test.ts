import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  cardImageUrl,
  createDeck,
  getCard,
  getCards,
  getSets,
  listDecks,
  login,
  logout,
  me,
  setAssetUrl,
} from "./api";

// The client is a thin fetch wrapper, so the tests stub global fetch and
// assert on what reaches it: the built URL, the always-on credentials, the
// JSON body — and on how responses come back (typed casts, ApiError, 204).

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Stub fetch with a canned response; returns the mock for call inspection. */
function stubFetch(response: Response) {
  const mock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function requestedUrl(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls[0]?.[0] as string;
}

function requestInit(mock: ReturnType<typeof vi.fn>): RequestInit {
  return mock.mock.calls[0]?.[1] as RequestInit;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("query-string building", () => {
  it("hits the bare path when no params are given", async () => {
    const mock = stubFetch(jsonResponse(200, { items: [], page: 1, pageSize: 50, total: 0 }));
    await getCards();
    expect(requestedUrl(mock)).toBe("http://localhost:8787/cards");
  });

  it("serializes the given params and omits undefined and empty strings", async () => {
    const mock = stubFetch(jsonResponse(200, { items: [], page: 2, pageSize: 50, total: 0 }));
    await getCards({ name: "pikachu", rarity: "", set: undefined, hpMin: 60, page: 2 });
    expect(requestedUrl(mock)).toBe("http://localhost:8787/cards?name=pikachu&hpMin=60&page=2");
  });

  it("emits one occurrence per array item for the repeatable dimensions", async () => {
    const mock = stubFetch(jsonResponse(200, { items: [], page: 1, pageSize: 50, total: 0 }));
    await getCards({ type: ["Fire", "Water"], rarity: ["Double rare"], sort: "hp-desc" });
    expect(requestedUrl(mock)).toBe(
      "http://localhost:8787/cards?type=Fire&type=Water&rarity=Double+rare&sort=hp-desc",
    );
  });

  it("omits empty arrays and empty array items", async () => {
    const mock = stubFetch(jsonResponse(200, { items: [], page: 1, pageSize: 50, total: 0 }));
    await getCards({ type: [], rarity: ["", "Common"] });
    expect(requestedUrl(mock)).toBe("http://localhost:8787/cards?rarity=Common");
  });

  it("builds /sets with and without the serie filter", async () => {
    const bare = stubFetch(jsonResponse(200, []));
    await getSets();
    expect(requestedUrl(bare)).toBe("http://localhost:8787/sets");

    const filtered = stubFetch(jsonResponse(200, []));
    await getSets("sv");
    expect(requestedUrl(filtered)).toBe("http://localhost:8787/sets?serie=sv");
  });
});

describe("request plumbing", () => {
  it("sends credentials: include on every call, GETs and mutations alike", async () => {
    for (const call of [
      () => getCard("sv06-001"),
      () => me(),
      () => listDecks(),
      () => login({ email: "a@b.c", password: "hunter22" }),
    ]) {
      const mock = stubFetch(jsonResponse(200, {}));
      await call();
      expect(requestInit(mock).credentials).toBe("include");
    }
  });

  it("POSTs JSON bodies with the content-type header", async () => {
    const mock = stubFetch(jsonResponse(201, { id: "d1" }));
    await createDeck({ name: "Grass rush", tint: 120, cards: [] });
    const init = requestInit(mock);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ name: "Grass rush", tint: 120, cards: [] });
  });

  it("resolves 204 responses to undefined", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(logout()).resolves.toBeUndefined();
  });
});

describe("ApiError", () => {
  it("carries the status and the parsed JSON body", async () => {
    stubFetch(jsonResponse(400, { error: "unknown card id(s)", cardIds: ["fake-1"] }));
    const error = await createDeck({ name: "x", tint: 0, cards: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).body).toEqual({ error: "unknown card id(s)", cardIds: ["fake-1"] });
    expect((error as ApiError).message).toBe("unknown card id(s)");
  });

  it("is thrown from me() on 401 — logged-out is the caller's branch", async () => {
    stubFetch(jsonResponse(401, { error: "unauthorized" }));
    await expect(me()).rejects.toMatchObject({ status: 401 });
  });

  it("leaves body undefined when the error response isn't JSON", async () => {
    stubFetch(
      new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } }),
    );
    const error = await getCard("sv06-001").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).body).toBeUndefined();
    expect((error as ApiError).message).toBe("request failed with status 502");
  });
});

describe("asset url helpers", () => {
  it("builds card image urls, defaulting the extension to webp", () => {
    expect(cardImageUrl("sv06.5-001", "high")).toBe(
      "http://localhost:8787/assets/cards/sv06.5-001/high.webp",
    );
    expect(cardImageUrl("sv06.5-001", "low", "png")).toBe(
      "http://localhost:8787/assets/cards/sv06.5-001/low.png",
    );
  });

  it("builds set asset urls, defaulting the extension to png", () => {
    expect(setAssetUrl("sv06", "symbol")).toBe("http://localhost:8787/assets/sets/sv06/symbol.png");
    expect(setAssetUrl("sv06", "logo", "webp")).toBe(
      "http://localhost:8787/assets/sets/sv06/logo.webp",
    );
  });
});
