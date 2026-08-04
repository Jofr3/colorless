// The transport seam (./source.ts), exercised entirely with stubs — no network.
// What these prove: both transports issue the RIGHT request, hand the payload
// on VERBATIM (the property the Zod boundary depends on), fail LOUDLY, and pace
// themselves. What they cannot prove is that the SDK's own HTTP call works
// against the live API; that is the one line `createDefaultSdkClient` isolates,
// and `bun scripts/ingest.ts --transport=sdk --dry-run` is what proves it.

import { describe, expect, it } from "vitest";
import cardPokemonAttacks from "../../../../packages/schema/src/tcgdex/__fixtures__/card-pokemon-swsh3-136.json";
import {
  type CatalogSource,
  createFetchSource,
  createSdkSource,
  createSource,
  parseTransport,
  type TcgdexRawClient,
  TRANSPORTS,
} from "./source";

/** A `fetch` stub recording every URL, answering 200 with `payload`. */
function stubFetch(payload: unknown, status = 200): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return {
      ok: status >= 200 && status < 300,
      status,
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
  const cases: { name: string; build: (sleep: (ms: number) => Promise<void>) => CatalogSource }[] = [
    {
      name: "fetch",
      build: (sleep) =>
        createFetchSource({ fetchImpl: stubFetch({}).impl, delayMs: 50, sleep }),
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
