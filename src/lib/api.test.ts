import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetchResponse as stubFetch, stubFetchSequence } from "../test/fetchStub";
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
  setSessionRecoveryHandler,
  unknownCardIdsOf,
  updateProfile,
} from "./api";

// The client is a thin fetch wrapper, so the tests stub global fetch and
// assert on what reaches it: the built URL, the always-on credentials, the
// JSON body — and on how responses come back (typed casts, ApiError, 204).

function requestedUrl(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls[0]?.[0] as string;
}

function requestInit(mock: ReturnType<typeof vi.fn>): RequestInit {
  return mock.mock.calls[0]?.[1] as RequestInit;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionRecoveryHandler(null);
});

describe("query-string building", () => {
  it("hits the bare path when no params are given", async () => {
    const mock = stubFetch(json({ items: [], page: 1, pageSize: 50, total: 0 }));
    await getCards();
    expect(requestedUrl(mock)).toBe("http://localhost:8787/cards");
  });

  it("serializes the given params and omits undefined and empty strings", async () => {
    const mock = stubFetch(json({ items: [], page: 2, pageSize: 50, total: 0 }));
    await getCards({ name: "pikachu", rarity: "", set: undefined, hpMin: 60, page: 2 });
    expect(requestedUrl(mock)).toBe("http://localhost:8787/cards?name=pikachu&hpMin=60&page=2");
  });

  it("emits one occurrence per array item for the repeatable dimensions", async () => {
    const mock = stubFetch(json({ items: [], page: 1, pageSize: 50, total: 0 }));
    await getCards({ type: ["Fire", "Water"], rarity: ["Double rare"], sort: "hp-desc" });
    expect(requestedUrl(mock)).toBe(
      "http://localhost:8787/cards?type=Fire&type=Water&rarity=Double+rare&sort=hp-desc",
    );
  });

  it("omits empty arrays and empty array items", async () => {
    const mock = stubFetch(json({ items: [], page: 1, pageSize: 50, total: 0 }));
    await getCards({ type: [], rarity: ["", "Common"] });
    expect(requestedUrl(mock)).toBe("http://localhost:8787/cards?rarity=Common");
  });

  it("builds /sets with and without the serie filter", async () => {
    const bare = stubFetch(json([]));
    await getSets();
    expect(requestedUrl(bare)).toBe("http://localhost:8787/sets");

    const filtered = stubFetch(json([]));
    await getSets("sv");
    expect(requestedUrl(filtered)).toBe("http://localhost:8787/sets?serie=sv");
  });
});

describe("request plumbing", () => {
  it("sends credentials: include on every call, GETs and mutations alike", async () => {
    for (const call of [
      () => getCards(),
      () => me(),
      () => listDecks(),
      () => login({ email: "a@b.c", password: "hunter22" }),
    ]) {
      const mock = stubFetch(json({}));
      await call();
      expect(requestInit(mock).credentials).toBe("include");
    }
  });

  it("POSTs JSON bodies with the content-type header", async () => {
    const mock = stubFetch(json({ id: "d1" }));
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

  it("percent-encodes path ids (getCard)", async () => {
    const mock = stubFetch(json({ id: "sv06.5-001" }));
    await getCard("sv06.5-001");
    expect(requestedUrl(mock)).toBe("http://localhost:8787/cards/sv06.5-001");

    const encoded = stubFetch(json({ id: "odd/id" }));
    await getCard("odd/id");
    expect(requestedUrl(encoded)).toBe("http://localhost:8787/cards/odd%2Fid");
  });
});

describe("ApiError", () => {
  it("carries the status and the parsed JSON body", async () => {
    stubFetch(json({ error: "unknown card id(s)", cardIds: ["fake-1"] }, 400));
    const error = await createDeck({ name: "x", tint: 0, cards: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).body).toEqual({ error: "unknown card id(s)", cardIds: ["fake-1"] });
    expect((error as ApiError).message).toBe("unknown card id(s)");
  });

  it("is thrown from me() on 401 — logged-out is the caller's branch", async () => {
    stubFetch(json({ error: "unauthorized" }, 401));
    await expect(me()).rejects.toMatchObject({ status: 401 });
  });

  it("leaves body undefined when the error response isn't JSON", async () => {
    stubFetch(
      new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } }),
    );
    const error = await getCards().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).body).toBeUndefined();
    expect((error as ApiError).message).toBe("request failed with status 502");
  });
});

describe("session recovery", () => {
  it("retries a session-gated 401 once when the handler reports the session alive", async () => {
    const mock = stubFetchSequence(json({ error: "unauthorized" }, 401), json([{ id: "d1" }]));
    const handler = vi.fn().mockResolvedValue(true);
    setSessionRecoveryHandler(handler);

    await expect(listDecks()).resolves.toEqual([{ id: "d1" }]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("propagates the 401 without retrying when the session is really gone", async () => {
    const mock = stubFetchSequence(json({ error: "unauthorized" }, 401));
    const handler = vi.fn().mockResolvedValue(false);
    setSessionRecoveryHandler(handler);

    await expect(listDecks()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("never consults the handler for the opted-out auth calls — there a 401 IS the answer", async () => {
    // Every /auth endpoint passes `recoverSession: false` at the call site
    // (it used to be inferred from the path prefix), so all of them must skip
    // the probe — including the two that also carry a body.
    stubFetch(json({ error: "unauthorized" }, 401));
    const handler = vi.fn().mockResolvedValue(true);
    setSessionRecoveryHandler(handler);

    await expect(me()).rejects.toMatchObject({ status: 401 });
    await expect(login({ email: "a@b.c", password: "nope-nope" })).rejects.toMatchObject({
      status: 401,
    });
    await expect(updateProfile({ displayName: "Ash" })).rejects.toMatchObject({ status: 401 });
    await expect(logout()).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("propagates the 401 untouched when no handler is installed", async () => {
    const mock = stubFetch(json({ error: "unauthorized" }, 401));
    await expect(listDecks()).rejects.toMatchObject({ status: 401 });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("coalesces parallel 401s into one probe", async () => {
    // Both requests 401 on their first hit, then both retries succeed.
    const hits = new Map<string, number>();
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const n = (hits.get(url) ?? 0) + 1;
      hits.set(url, n);
      return n === 1 ? json({ error: "unauthorized" }, 401) : json([]);
    });
    vi.stubGlobal("fetch", mock);
    let release!: (alive: boolean) => void;
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(() => gate);
    setSessionRecoveryHandler(handler);

    const both = Promise.all([listDecks(), getSets()]);
    // Let both requests hit their 401 and queue on the shared probe.
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    release(true);
    await expect(both).resolves.toEqual([[], []]);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("unknownCardIdsOf", () => {
  it("extracts the ids from the api's unknown-card 400 payload", () => {
    expect(unknownCardIdsOf({ error: "unknown card id(s)", cardIds: ["a", "b"] })).toEqual([
      "a",
      "b",
    ]);
  });

  it("returns null for anything else", () => {
    expect(unknownCardIdsOf(undefined)).toBeNull();
    expect(unknownCardIdsOf({ error: "empty patch" })).toBeNull();
    expect(unknownCardIdsOf({ cardIds: "fake-1" })).toBeNull();
    expect(unknownCardIdsOf({ cardIds: ["a", 1] })).toBeNull();
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
