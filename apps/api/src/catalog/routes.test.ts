// Catalog route behavior that doesn't need a real D1: query validation
// (which runs before any DB access) and the KV cache middleware's hit/miss
// protocol. The full data path runs against the real local D1 via
// `wrangler dev` (see docs §6); D1 itself is not stubbed here.

import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import app from "../index";

/** In-memory stand-in for the CACHE KV namespace. */
function fakeKv(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const puts: string[] = [];
  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      puts.push(key);
      store.set(key, value);
    },
  };
  return { kv, puts };
}

function envWith(kv: unknown): Env {
  // DB/ASSETS are never reached on these paths; a touch would throw loudly.
  return { CACHE: kv, DB: undefined, ASSETS: undefined } as unknown as Env;
}

describe("GET /cards param validation", () => {
  it("400s invalid params with a terse JSON error, before touching D1", async () => {
    const { kv } = fakeKv();
    for (const query of ["pageSize=1000", "page=0", "hpMin=abc", "category=Pokémon", "legal=no"]) {
      const res = await app.request(`/cards?${query}`, {}, envWith(kv));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues: string[] };
      expect(body.error).toBe("invalid query");
      expect(body.issues.length).toBeGreaterThan(0);
    }
  });

  it("never caches a 400", async () => {
    const { kv, puts } = fakeKv();
    await app.request("/cards?pageSize=1000", {}, envWith(kv));
    expect(puts).toEqual([]);
  });
});

describe("catalog KV cache middleware", () => {
  it("serves a seeded key as a hit without touching D1", async () => {
    const cachedBody = JSON.stringify({ items: [], page: 1, pageSize: 50, total: 0 });
    const { kv } = fakeKv({ "catalog:/cards?page=1&set=nope": cachedBody });
    // Param order differs from the stored key — normalization must line up.
    const res = await app.request("/cards?set=nope&page=1", {}, envWith(kv));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-luminous-cache")).toBe("hit");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ items: [], page: 1, pageSize: 50, total: 0 });
  });
});
