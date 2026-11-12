import { describe, expect, it, vi } from "vitest";
import cardPokemonAttacks from "@colorless/schema/tcgdex-fixtures/card-pokemon-swsh3-136.json";
import {
  type CatalogSource,
  createFetchSource,
  createSdkSource,
  createSource,
  DEFAULT_RETRIES,
  parseTransport,
  SourceRequestError,
  type TcgdexRawClient,
  TRANSPORTS,
  withRetries,
} from "./source";

/** A `fetch` stub recording every URL, answering 200 with `payload`. */
function stubFetch(payload: unknown, status = 200): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      json: async () => payload,
    } as Response;
  }) as typeof fetch;
  return { impl, urls };
}

/** A `TCGdex.fetch` stub recording every endpoint tuple. */
function stubClient(payload: unknown): { client: TcgdexRawClient; calls: string[][] } {
  const calls: string[][] = [];
  const client = {
    fetch: async (...endpoint: [string, string]) => {
      calls.push(endpoint);
      return payload;
    },
  } as TcgdexRawClient;
  return { client, calls };
}

/** Record every paced sleep so the politeness posture is asserted, not timed. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; slept: number[] } {
  const slept: number[] = [];
  return {
    sleep: async (ms: number) => {
      slept.push(ms);
    },
    slept,
  };
}

describe("createFetchSource", () => {
  it("builds the same paths the ingest has always requested", async () => {
    const { impl, urls } = stubFetch({ id: "x" });
    const source = createFetchSource({ fetchImpl: impl, delayMs: 0 });
    await source.getSerie("sv");
    await source.getSet("sv06.5");
    await source.getCard("swsh3-136");
    expect(urls).toEqual([
      "https://api.tcgdex.net/v2/en/series/sv",
      "https://api.tcgdex.net/v2/en/sets/sv06.5",
      "https://api.tcgdex.net/v2/en/cards/swsh3-136",
    ]);
  });

  it("percent-encodes ids so a hostile id cannot escape its path segment", async () => {
    const { impl, urls } = stubFetch({});
    const source = createFetchSource({ fetchImpl: impl, delayMs: 0 });
    await source.getCard("a/b?c=1");
    expect(urls[0]).toBe("https://api.tcgdex.net/v2/en/cards/a%2Fb%3Fc%3D1");
  });

  it("returns the payload verbatim — nothing renamed, nothing stripped", async () => {
    const { impl } = stubFetch(cardPokemonAttacks);
    const source = createFetchSource({ fetchImpl: impl, delayMs: 0 });
    expect(await source.getCard("swsh3-136")).toBe(cardPokemonAttacks);
  });

  it("throws with the status on a non-2xx", async () => {
    const { impl } = stubFetch(null, 404);
    const source = createFetchSource({ fetchImpl: impl, delayMs: 0 });
    await expect(source.getCard("nope-1")).rejects.toThrow("HTTP 404 for /cards/nope-1");
  });

  it("cancels the body of a non-2xx before it throws, so the connection is not held (COR-P4)", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const impl = (async () => new Response(body, { status: 503 })) as unknown as typeof fetch;
    const source = createFetchSource({ fetchImpl: impl, delayMs: 0 });
    await expect(source.getCard("sv01-001")).rejects.toThrow("HTTP 503 for /cards/sv01-001");
    expect(cancelled).toBe(true);
  });

  it("honours a custom base url", async () => {
    const { impl, urls } = stubFetch({});
    const source = createFetchSource({ fetchImpl: impl, delayMs: 0, baseUrl: "http://x/v2/fr" });
    await source.getSet("sv01");
    expect(urls[0]).toBe("http://x/v2/fr/sets/sv01");
  });
});

describe("createSdkSource", () => {
  it("uses the SDK's RAW endpoints, never its model endpoints", async () => {
    const { client, calls } = stubClient({ id: "x" });
    const source = createSdkSource({ client, delayMs: 0 });
    await source.getSerie("sv");
    await source.getSet("sv06.5");
    await source.getCard("swsh3-136");
    expect(calls).toEqual([
      ["series", "sv"],
      ["sets", "sv06.5"],
      ["cards", "swsh3-136"],
    ]);
  });

  it("returns the payload verbatim — the Zod boundary must see what the API sent", async () => {
    const { client } = stubClient(cardPokemonAttacks);
    const source = createSdkSource({ client, delayMs: 0 });
    expect(await source.getCard("swsh3-136")).toBe(cardPokemonAttacks);
  });

  it("turns the SDK's `undefined` (any non-200 below 500) into a loud failure", async () => {
    const { client } = stubClient(undefined);
    const source = createSdkSource({ client, delayMs: 0 });
    await expect(source.getCard("nope-1")).rejects.toThrow(
      /no payload for card nope-1 .*returned undefined/,
    );
  });

  it("does not mistake a legitimately null-ish payload for a miss", async () => {
    const { client } = stubClient(null);
    const source = createSdkSource({ client, delayMs: 0 });
    await expect(source.getSet("sv01")).resolves.toBeNull();
  });
});

describe("politeness posture (the SDK adds none, so the seam owns it)", () => {
  const cases: { name: string; build: (sleep: (ms: number) => Promise<void>) => CatalogSource }[] =
    [
      {
        name: "fetch",
        build: (sleep) => createFetchSource({ fetchImpl: stubFetch({}).impl, delayMs: 50, sleep }),
      },
      {
        name: "sdk",
        build: (sleep) => createSdkSource({ client: stubClient({}).client, delayMs: 50, sleep }),
      },
    ];

  for (const { name, build } of cases) {
    it(`${name}: delays before every request but the first, and counts them`, async () => {
      const { sleep, slept } = recordingSleep();
      const source = build(sleep);
      expect(source.requestCount).toBe(0);
      await source.getCard("a");
      expect(slept).toEqual([]);
      await source.getCard("b");
      await source.getCard("c");
      expect(slept).toEqual([50, 50]);
      expect(source.requestCount).toBe(3);
    });

    it(`${name}: spaces overlapping requests one delay apart, in call order`, async () => {
      const { sleep, slept } = recordingSleep();
      const source = build(sleep);
      await Promise.all(["a", "b", "c", "d"].map((id) => source.getCard(id)));
      expect(slept).toEqual([50, 50, 50]);
      expect(source.requestCount).toBe(4);
    });
  }
});

describe("createSource / parseTransport", () => {
  it("dispatches on the flag", () => {
    expect(createSource("fetch").transport).toBe("fetch");
    expect(createSource("sdk", { client: stubClient({}).client }).transport).toBe("sdk");
  });

  it("defaults to the only transport proven end-to-end", () => {
    expect(parseTransport(undefined)).toBe("fetch");
  });

  it("accepts every advertised transport", () => {
    for (const transport of TRANSPORTS) {
      expect(parseTransport(transport)).toBe(transport);
    }
  });

  it("rejects anything else rather than silently falling back", () => {
    expect(() => parseTransport("graphql")).toThrow(
      'unknown --transport "graphql" (expected fetch | sdk)',
    );
    expect(() => parseTransport("")).toThrow("unknown --transport");
  });
});

type Answer = { status: number; body?: unknown; headers?: Record<string, string> } | "hang" | Error;

/** A `fetch` stub giving each call the next answer: a response, a network error, or a request
    that only ends when its signal aborts. Records each URL and whether a signal came with it. */
function scriptedFetch(answers: readonly Answer[]): {
  impl: typeof fetch;
  urls: string[];
  signalled: boolean[];
} {
  const urls: string[] = [];
  const signalled: boolean[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    signalled.push(init?.signal instanceof AbortSignal);
    const answer = answers[Math.min(urls.length, answers.length) - 1] as Answer;
    if (answer instanceof Error) throw answer;
    if (answer === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: new Headers(answer.headers),
      json: async () => {
        if (answer.body === undefined) throw new SyntaxError("Unexpected token '<'");
        return answer.body;
      },
    } as Response;
  }) as typeof fetch;
  return { impl, urls, signalled };
}

/** The failure `promise` rejects with. */
async function failureOf(promise: Promise<unknown>): Promise<SourceRequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SourceRequestError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("request failures", () => {
  it("fetch: gives every request a deadline and names the path when it passes", async () => {
    const { impl, signalled } = scriptedFetch(["hang"]);
    const source = createFetchSource({ fetchImpl: impl, delayMs: 0, timeoutMs: 20 });
    const error = await failureOf(source.getCard("sv01-001"));
    expect(signalled).toEqual([true]);
    expect(error.message).toBe("timed out after 20 ms for /cards/sv01-001");
    expect(error.retryable).toBe(true);
  });

  it("fetch: a network error, 408, 429 and 5xx may pass; any other status does not", async () => {
    const cases: [Answer, boolean][] = [
      [new TypeError("fetch failed"), true],
      [{ status: 408 }, true],
      [{ status: 429 }, true],
      [{ status: 500 }, true],
      [{ status: 503 }, true],
      [{ status: 404 }, false],
      [{ status: 403 }, false],
    ];
    for (const [answer, retryable] of cases) {
      const source = createFetchSource({ fetchImpl: scriptedFetch([answer]).impl, delayMs: 0 });
      const error = await failureOf(source.getSet("sv01"));
      expect(error.retryable, error.message).toBe(retryable);
    }
  });

  it("fetch: reads Retry-After as seconds or a date, capped at a minute", async () => {
    const waitAsked = async (value: string) => {
      const answer = { status: 429, headers: { "retry-after": value } };
      const source = createFetchSource({ fetchImpl: scriptedFetch([answer]).impl, delayMs: 0 });
      return (await failureOf(source.getCard("x"))).retryAfterMs;
    };
    expect(await waitAsked("2")).toBe(2000);
    expect(await waitAsked("86400")).toBe(60_000);
    expect(await waitAsked(new Date(Date.now() - 1000).toUTCString())).toBe(0);
    expect(await waitAsked("soon")).toBeUndefined();
  });

  it("fetch: a 200 whose body is not JSON fails with the path, and may pass", async () => {
    const source = createFetchSource({
      fetchImpl: scriptedFetch([{ status: 200 }]).impl,
      delayMs: 0,
    });
    const error = await failureOf(source.getCard("sv01-001"));
    expect(error.message).toMatch(/^unreadable JSON for \/cards\/sv01-001: /);
    expect(error.retryable).toBe(true);
  });

  it("sdk: a throw or a stall may pass; the SDK's undefined does not", async () => {
    const throwing = {
      fetch: async () => Promise.reject(new Error("HTTP 502")),
    } as TcgdexRawClient;
    const stalled = { fetch: () => new Promise<unknown>(() => {}) } as TcgdexRawClient;
    const missing = stubClient(undefined).client;
    const thrown = await failureOf(createSdkSource({ client: throwing, delayMs: 0 }).getCard("a"));
    expect([thrown.message, thrown.retryable]).toEqual(["HTTP 502 for card a", true]);
    const timedOut = await failureOf(
      createSdkSource({ client: stalled, delayMs: 0, timeoutMs: 20 }).getSet("sv01"),
    );
    expect([timedOut.message, timedOut.retryable]).toEqual([
      "timed out after 20 ms for set sv01",
      true,
    ]);
    const miss = await failureOf(createSdkSource({ client: missing, delayMs: 0 }).getSerie("sv"));
    expect(miss.retryable).toBe(false);
  });

  it("sdk: a request that settles in time stops its deadline's clock", async () => {
    vi.useFakeTimers();
    try {
      const answered = createSdkSource({ client: stubClient({ id: "sv01" }).client, delayMs: 0 });
      await answered.getSet("sv01");
      const throwing = {
        fetch: async () => Promise.reject(new Error("HTTP 502")),
      } as TcgdexRawClient;
      await failureOf(createSdkSource({ client: throwing, delayMs: 0 }).getSet("sv01"));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withRetries", () => {
  const half = () => 0.5;

  it("retries a passing failure with full-jitter backoff, each attempt a paced request", async () => {
    const { impl, urls } = scriptedFetch([
      { status: 503 },
      new TypeError("reset"),
      { status: 200, body: { id: "x" } },
    ]);
    const { sleep, slept } = recordingSleep();
    const source = withRetries(createFetchSource({ fetchImpl: impl, delayMs: 0 }), {
      sleep,
      random: half,
    });
    await expect(source.getCard("x")).resolves.toEqual({ id: "x" });
    expect(urls).toHaveLength(3);
    expect(source.requestCount).toBe(3);
    expect(slept).toEqual([500, 1000]);
  });

  it("waits what Retry-After asks instead of the backoff", async () => {
    const answers: Answer[] = [
      { status: 429, headers: { "retry-after": "3" } },
      { status: 200, body: {} },
    ];
    const { sleep, slept } = recordingSleep();
    const fetchImpl = scriptedFetch(answers).impl;
    const source = withRetries(createFetchSource({ fetchImpl, delayMs: 0 }), {
      sleep,
      random: half,
    });
    await source.getSet("sv01");
    expect(slept).toEqual([3000]);
  });

  it("gives up after the last retry, saying how many attempts it made", async () => {
    const { impl, urls } = scriptedFetch([{ status: 503 }]);
    const { sleep, slept } = recordingSleep();
    const source = withRetries(createFetchSource({ fetchImpl: impl, delayMs: 0 }), {
      sleep,
      random: half,
    });
    const error = await failureOf(source.getCard("x"));
    expect(error.message).toBe("HTTP 503 for /cards/x (4 attempts)");
    expect(urls).toHaveLength(1 + DEFAULT_RETRIES);
    expect(slept).toEqual([500, 1000, 2000]);
  });

  it("never retries a failure that cannot pass", async () => {
    const { impl, urls } = scriptedFetch([{ status: 404 }, { status: 200, body: {} }]);
    const source = withRetries(createFetchSource({ fetchImpl: impl, delayMs: 0 }), {
      sleep: recordingSleep().sleep,
    });
    await expect(source.getCard("nope-1")).rejects.toThrow("HTTP 404 for /cards/nope-1");
    expect(urls).toHaveLength(1);
  });

  it("with no retries, the first failure is the error", async () => {
    const source = withRetries(
      createFetchSource({ fetchImpl: scriptedFetch([{ status: 503 }]).impl, delayMs: 0 }),
      {
        retries: 0,
      },
    );
    await expect(source.getCard("x")).rejects.toThrow(/^HTTP 503 for \/cards\/x$/);
  });

  it("createSource retries by default, on both transports", async () => {
    const { sleep } = recordingSleep();
    const { impl } = scriptedFetch([{ status: 502 }, { status: 200, body: { id: "a" } }]);
    await expect(
      createSource("fetch", { fetchImpl: impl, delayMs: 0, sleep }).getCard("a"),
    ).resolves.toEqual({
      id: "a",
    });
    let calls = 0;
    const flaky = {
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error("HTTP 500");
        return { id: "b" };
      },
    } as TcgdexRawClient;
    await expect(
      createSource("sdk", { client: flaky, delayMs: 0, sleep }).getCard("b"),
    ).resolves.toEqual({
      id: "b",
    });
  });
});
