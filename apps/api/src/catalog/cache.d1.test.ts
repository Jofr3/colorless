// The catalog KV cache over a real D1: what a miss stores, what bypasses KV, that only the
// shapes worth a KV write spend one, and that a failing or slow KV never changes the response.

import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLogThrottle } from "../http/log";
import app from "../index";
import { seedCards, useTestD1 } from "../testing/d1";
import { catalogCacheKey } from "./cache";
import { CATALOG_EPOCH_KEY } from "./epoch";

const d1 = useTestD1((db) =>
  seedCards(db, [
    { id: "sv01-004", name: "Charmander", category: "Pokemon", hp: 70 },
    { id: "sv01-016", name: "Pidgey", category: "Pokemon", hp: 60 },
    // Enough Trainers to fill three pages of four.
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `sv01-1${index}0`,
      name: `Potion ${index}`,
      category: "Trainer" as const,
    })),
  ]),
);

type KvCall = { op: "get" | "put"; key: string };

/** A KV namespace over a Map that records every call; `fail` makes the named operations throw. */
function recordingKv(
  seed: Record<string, string> = {},
  fail: { get?: string[]; put?: boolean } = {},
) {
  const store = new Map(Object.entries(seed));
  const calls: KvCall[] = [];
  const kv = {
    get: async (key: string) => {
      calls.push({ op: "get", key });
      if (fail.get?.includes(key)) throw new Error("KV GET failed: 429");
      return store.get(key) ?? null;
    },
    put: async (key: string, value: string) => {
      calls.push({ op: "put", key });
      if (fail.put) throw new Error("KV PUT failed: 429 Too Many Requests");
      store.set(key, value);
    },
  };
  return { kv, store, calls };
}

const keyOf = (path: string, query = "", epoch: string | null = null) =>
  catalogCacheKey(path, query, epoch);

const putKeys = (calls: KvCall[]) => calls.filter((call) => call.op === "put").map((c) => c.key);

async function cardsIds(res: Response): Promise<string[]> {
  const body = (await res.json()) as { items: { id: string }[] };
  return body.items.map((item) => item.id);
}

afterEach(() => {
  vi.restoreAllMocks();
  resetLogThrottle();
});

describe("catalog KV cache over D1", () => {
  it("stores a miss under the stamped epoch and serves it as a hit", async () => {
    const { kv, store } = recordingKv({ [CATALOG_EPOCH_KEY]: "e1" });
    const env = d1().env({ CACHE: kv });
    const first = await app.request("/cards?category=Pokemon", {}, env);
    expect(first.headers.get("x-colorless-cache")).toBe("miss");
    expect(await cardsIds(first)).toEqual(["sv01-004", "sv01-016"]);
    expect(store.has(keyOf("/cards", "category=Pokemon", "e1"))).toBe(true);
    const second = await app.request("/cards?category=Pokemon", {}, env);
    expect(second.headers.get("x-colorless-cache")).toBe("hit");
    expect(await cardsIds(second)).toEqual(["sv01-004", "sv01-016"]);
  });

  it("works against Miniflare's KV", async () => {
    const env = d1().env();
    expect((await app.request("/sets/sv01", {}, env)).headers.get("x-colorless-cache")).toBe(
      "miss",
    );
    const hit = await app.request("/sets/sv01", {}, env);
    expect(hit.headers.get("x-colorless-cache")).toBe("hit");
    expect(((await hit.json()) as { cards: { name: string }[] }).cards[0]?.name).toBe("Charmander");
  });

  it("stops serving entries cached before a new epoch once the isolate rereads it", async () => {
    const { kv, store } = recordingKv({ [CATALOG_EPOCH_KEY]: "e1" });
    const env = d1().env({ CACHE: kv });
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    await app.request("/cards?category=Pokemon", {}, env);
    store.set(CATALOG_EPOCH_KEY, "e2");
    clock.mockReturnValue(now + 30_000);
    const memoised = await app.request("/cards?category=Pokemon", {}, env);
    expect(memoised.headers.get("x-colorless-cache")).toBe("hit");
    clock.mockReturnValue(now + 61_000);
    const reread = await app.request("/cards?category=Pokemon", {}, env);
    expect(reread.headers.get("x-colorless-cache")).toBe("miss");
    expect(store.has(keyOf("/cards", "category=Pokemon", "e2"))).toBe(true);
  });

  it("bypasses KV for free-text, id and HP queries without reading or writing it", async () => {
    for (const query of [
      "name=char",
      "nameExact=Pidgey",
      "text=burn",
      "id=sv01-004",
      "hpMin=60",
      "hpMax=80",
    ]) {
      const { kv, calls } = recordingKv();
      const res = await app.request(`/cards?${query}`, {}, d1().env({ CACHE: kv }));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-colorless-cache")).toBe("bypass");
      expect(calls).toEqual([]);
    }
  });

  it("still answers 200 when the KV write fails", async () => {
    const { kv, calls } = recordingKv({}, { put: true });
    const res = await app.request("/cards?category=Pokemon", {}, d1().env({ CACHE: kv }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-colorless-cache")).toBe("miss");
    expect(await cardsIds(res)).toEqual(["sv01-004", "sv01-016"]);
    expect(calls.some((call) => call.op === "put")).toBe(true);
  });

  it("reads a failing KV entry as a miss", async () => {
    const key = keyOf("/cards", "category=Pokemon");
    const { kv } = recordingKv({}, { get: [key] });
    const res = await app.request("/cards?category=Pokemon", {}, d1().env({ CACHE: kv }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-colorless-cache")).toBe("miss");
  });

  it("skips KV when the epoch cannot be read", async () => {
    const { kv, calls } = recordingKv({}, { get: [CATALOG_EPOCH_KEY] });
    const res = await app.request("/cards?category=Pokemon", {}, d1().env({ CACHE: kv }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-colorless-cache")).toBe("bypass");
    expect(calls).toEqual([{ op: "get", key: CATALOG_EPOCH_KEY }]);
  });

  it("answers before the KV write settles, handing the write to waitUntil", async () => {
    let release: () => void = () => {};
    const kv = {
      get: async () => null,
      put: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    };
    const deferred: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => deferred.push(promise),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    const res = await app.request("/cards?category=Pokemon", {}, d1().env({ CACHE: kv }), ctx);
    expect(res.status).toBe(200);
    expect(deferred).toHaveLength(1);
    release();
    await Promise.all(deferred);
  });
});

describe("which catalog shapes spend a KV write", () => {
  it("keys /cards by the validated query: junk params, defaults and order share one entry", async () => {
    const { kv, calls } = recordingKv();
    const env = d1().env({ CACHE: kv });
    for (const search of [
      "category=Pokemon",
      "category=Pokemon&bust=1",
      "bust=2&category=Pokemon&page=1",
      "category=Pokemon&sort=set&pageSize=50&page=01",
    ]) {
      const res = await app.request(`/cards?${search}`, {}, env);
      expect(res.status).toBe(200);
    }
    expect(putKeys(calls)).toEqual([keyOf("/cards", "category=Pokemon")]);
  });

  it("ignores the query on /facets, /series and /sets/:id", async () => {
    const { kv, calls } = recordingKv();
    const env = d1().env({ CACHE: kv });
    for (const path of ["/facets", "/series", "/sets/sv01"]) {
      for (const search of ["", "?bust=1", "?bust=2&name=x"]) {
        expect((await app.request(`${path}${search}`, {}, env)).status).toBe(200);
      }
    }
    expect(putKeys(calls)).toEqual([keyOf("/facets"), keyOf("/series"), keyOf("/sets/sv01")]);
  });

  it("keys /sets/:id by the decoded id, so an encoded spelling shares its entry", async () => {
    const { kv, calls } = recordingKv();
    const env = d1().env({ CACHE: kv });
    expect((await app.request("/sets/sv01", {}, env)).status).toBe(200);
    expect((await app.request("/sets/sv%301", {}, env)).headers.get("x-colorless-cache")).toBe(
      "hit",
    );
    expect(putKeys(calls)).toEqual([keyOf("/sets/sv01")]);
  });

  it("keys /sets by its serie filter only", async () => {
    const { kv, calls } = recordingKv();
    const env = d1().env({ CACHE: kv });
    for (const search of ["", "?bust=1", "?serie=sv", "?serie=sv&x=1"]) {
      expect((await app.request(`/sets${search}`, {}, env)).status).toBe(200);
    }
    expect(putKeys(calls)).toEqual([keyOf("/sets"), keyOf("/sets", "serie=sv")]);
  });

  it("caches /cards pages 1-3 and sends page 4 on to D1 without touching KV", async () => {
    const { kv, calls } = recordingKv();
    const env = d1().env({ CACHE: kv });
    for (const page of [1, 2, 3]) {
      const res = await app.request(`/cards?pageSize=4&page=${page}`, {}, env);
      expect(res.headers.get("x-colorless-cache")).toBe("miss");
    }
    expect(putKeys(calls)).toHaveLength(3);
    calls.length = 0;
    const deep = await app.request("/cards?pageSize=4&page=4", {}, env);
    expect(deep.status).toBe(200);
    expect(deep.headers.get("x-colorless-cache")).toBe("bypass");
    expect(calls).toEqual([]);
  });

  it("caches only the page sizes a client uses", async () => {
    const { kv, calls } = recordingKv();
    const env = d1().env({ CACHE: kv });
    for (const pageSize of [4, 8, 50]) {
      const res = await app.request(`/cards?pageSize=${pageSize}`, {}, env);
      expect(res.headers.get("x-colorless-cache")).toBe("miss");
    }
    expect(putKeys(calls)).toHaveLength(3);
    calls.length = 0;
    for (const pageSize of [1, 7, 9, 100]) {
      const res = await app.request(`/cards?pageSize=${pageSize}`, {}, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-colorless-cache")).toBe("bypass");
    }
    expect(calls).toEqual([]);
  });

  it("never stores an empty result, so values that match nothing spend no KV write", async () => {
    const { kv, calls } = recordingKv();
    const env = d1().env({ CACHE: kv });
    for (const path of ["/cards?set=junk0", "/cards?illustrator=junk1", "/sets?serie=junk2"]) {
      const res = await app.request(path, {}, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-colorless-cache")).toBe("miss");
    }
    // A page past the last match is empty too.
    expect((await app.request("/cards?pageSize=8&page=3", {}, env)).status).toBe(200);
    expect(putKeys(calls)).toEqual([]);
  });

  it("never stores a page carrying a passed-back total", async () => {
    const { kv, calls } = recordingKv();
    const res = await app.request("/cards?category=Pokemon&total=999", {}, d1().env({ CACHE: kv }));
    expect(((await res.json()) as { total: number }).total).toBe(999);
    expect(res.headers.get("x-colorless-cache")).toBe("bypass");
    expect(calls).toEqual([]);
  });

  it("keeps /cards/:id and /cards/full out of KV, with the public browser cache", async () => {
    const { kv, calls } = recordingKv();
    const env = d1().env({ CACHE: kv });
    for (const path of ["/cards/sv01-004", "/cards/full?id=sv01-004"]) {
      const res = await app.request(path, {}, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-colorless-cache")).toBe("bypass");
      expect(res.headers.get("cache-control")).toContain("max-age=300");
      expect(res.headers.get("etag")).not.toBeNull();
    }
    expect(calls).toEqual([]);
  });
});

describe("catalog KV failure logs", () => {
  const kvLines = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((line) => line.evt === "kv");

  it("logs a failed put with its route, once per throttle window", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { kv } = recordingKv({}, { put: true });
    const env = d1().env({ CACHE: kv });
    await app.request("/cards?category=Pokemon", {}, env);
    await app.request("/cards?category=Trainer", {}, env);
    expect(kvLines(warn)).toEqual([{ evt: "kv", kind: "put_failed", route: "/cards" }]);
  });

  it("logs a failed get and a failed epoch read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failingGet = recordingKv({}, { get: [keyOf("/sets/sv01")] });
    expect((await app.request("/sets/sv01", {}, d1().env({ CACHE: failingGet.kv }))).status).toBe(
      200,
    );
    const failingEpoch = recordingKv({}, { get: [CATALOG_EPOCH_KEY] });
    expect((await app.request("/facets", {}, d1().env({ CACHE: failingEpoch.kv }))).status).toBe(
      200,
    );
    expect(kvLines(warn)).toEqual([
      { evt: "kv", kind: "get_failed", route: "/sets/:id" },
      { evt: "kv", kind: "epoch_failed", route: "/facets" },
    ]);
  });
});
