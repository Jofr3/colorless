// The catalog KV cache over a real D1: what a miss stores, what bypasses KV, and that a failing
// or slow KV never changes the response.

import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../index";
import { seedCards, useTestD1 } from "../testing/d1";
import { catalogCacheKey } from "./cache";
import { CATALOG_EPOCH_KEY } from "./epoch";

const d1 = useTestD1((db) =>
  seedCards(db, [
    { id: "sv01-004", name: "Charmander", category: "Pokemon", hp: 70 },
    { id: "sv01-016", name: "Pidgey", category: "Pokemon", hp: 60 },
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

const keyOf = (path: string, epoch: string | null = null) =>
  catalogCacheKey(new URL(`http://api.test${path}`), epoch);

async function cardsIds(res: Response): Promise<string[]> {
  const body = (await res.json()) as { items: { id: string }[] };
  return body.items.map((item) => item.id);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("catalog KV cache over D1", () => {
  it("stores a miss under the stamped epoch and serves it as a hit", async () => {
    const { kv, store } = recordingKv({ [CATALOG_EPOCH_KEY]: "e1" });
    const env = d1().env({ CACHE: kv });
    const first = await app.request("/cards?category=Pokemon", {}, env);
    expect(first.headers.get("x-colorless-cache")).toBe("miss");
    expect(await cardsIds(first)).toEqual(["sv01-004", "sv01-016"]);
    expect(store.has(keyOf("/cards?category=Pokemon", "e1"))).toBe(true);
    const second = await app.request("/cards?category=Pokemon", {}, env);
    expect(second.headers.get("x-colorless-cache")).toBe("hit");
    expect(await cardsIds(second)).toEqual(["sv01-004", "sv01-016"]);
  });

  it("works against Miniflare's KV", async () => {
    const env = d1().env();
    expect((await app.request("/cards/sv01-004", {}, env)).headers.get("x-colorless-cache")).toBe(
      "miss",
    );
    const hit = await app.request("/cards/sv01-004", {}, env);
    expect(hit.headers.get("x-colorless-cache")).toBe("hit");
    expect(((await hit.json()) as { name: string }).name).toBe("Charmander");
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
    expect(store.has(keyOf("/cards?category=Pokemon", "e2"))).toBe(true);
  });

  it("bypasses KV for free-text and id queries without reading or writing it", async () => {
    for (const query of ["name=char", "nameExact=Pidgey", "text=burn", "id=sv01-004"]) {
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
    const key = keyOf("/cards/sv01-016");
    const { kv } = recordingKv({}, { get: [key] });
    const res = await app.request("/cards/sv01-016", {}, d1().env({ CACHE: kv }));
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
