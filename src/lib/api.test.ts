import {
  CARD_ID_MAX,
  DECK_NAME_MAX,
  MAX_DECK_CARD_ENTRIES,
  patchDeckRequestSchema,
} from "@colorless/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetchResponse as stubFetch, stubFetchSequence } from "../test/fetchStub";
import {
  ApiError,
  DECK_WRITE_TIMEOUT_MS,
  cardImageUrl,
  createDeck,
  getCard,
  getCards,
  getSets,
  listDecks,
  login,
  logout,
  me,
  patchDeck,
  REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  setSessionRecoveryHandler,
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

  it("lets only a deck save asked to outlive the page do so", async () => {
    const kept = stubFetch(json({ id: "d1" }));
    await patchDeck("d1", { name: "x" }, { keepalive: true });
    expect(requestInit(kept).keepalive).toBe(true);
    const plain = stubFetch(json({ id: "d1" }));
    await patchDeck("d1", { name: "x" });
    expect(requestInit(plain).keepalive).toBeFalsy();
  });

  it("keeps the largest deck save the API accepts inside the browsers' keepalive quota", async () => {
    // Chromium and Firefox refuse a keepalive fetch whose body would take the page's in-flight
    // keepalive bytes past 64 KiB; the builder sends one save at a time.
    const worst = "\u0001"; // JSON spells it in six bytes
    const ids = Array.from({ length: MAX_DECK_CARD_ENTRIES }, (_, i) =>
      String(i).padStart(CARD_ID_MAX, "x"),
    );
    const body = {
      name: worst.repeat(DECK_NAME_MAX),
      format: "expanded",
      cards: ids.map((cardId) => ({ cardId, count: 99 })),
      chosenCoverCardId: ids[0] ?? null,
      version: Number.MAX_SAFE_INTEGER,
    };
    expect(patchDeckRequestSchema.safeParse(body).success).toBe(true);
    const mock = stubFetch(json({ id: "d1" }));
    await patchDeck("d1", body, { keepalive: true });
    const bytes = new TextEncoder().encode(requestInit(mock).body as string).length;
    expect(bytes).toBeLessThan(64 * 1024);
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

  it("carries a 429's Retry-After seconds, and nothing for a missing or dated one", async () => {
    const limited = (retryAfter?: string) =>
      new Response(JSON.stringify({ error: "too many requests" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
        },
      });
    for (const [header, seconds] of [
      ["30", 30],
      [undefined, undefined],
      ["Wed, 21 Oct 2026 07:28:00 GMT", undefined],
    ] as const) {
      stubFetch(limited(header));
      const error = await createDeck({ name: "x", tint: 0, cards: [] }).catch((e: unknown) => e);
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).retryAfterSeconds).toBe(seconds);
    }
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

describe("request deadlines", () => {
  /** A fetch that never answers until its signal aborts, as a stalled connection does. */
  function stubStalledFetch() {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) signals.push(signal);
            signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    return signals;
  }
  afterEach(() => vi.useRealTimers());

  it("abandons a read that never answers, aborting its fetch", async () => {
    vi.useFakeTimers();
    const signals = stubStalledFetch();
    const failure = me().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await failure;
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("gives a deck write longer before abandoning it", async () => {
    vi.useFakeTimers();
    stubStalledFetch();
    let settled = false;
    const failure = patchDeck("d1", { name: "x" }).catch((error: unknown) => {
      settled = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(DECK_WRITE_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    expect(await failure).toBeInstanceOf(RequestTimeoutError);
  });

  it("times out even when the fetch ignores its signal, and leaves no timer behind an answer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const failure = getSets().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await failure).toBeInstanceOf(RequestTimeoutError);

    stubFetch(json([]));
    await expect(getSets()).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("cardImageUrl", () => {
  it("builds the high-quality WebP url, the one card file the api mirrors", () => {
    expect(cardImageUrl("sv06.5-001", "high")).toBe(
      "http://localhost:8787/assets/cards/sv06.5-001/high.webp",
    );
  });
});
