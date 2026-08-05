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
  const gets: string[] = [];
  const puts: string[] = [];
  const kv = {
    get: async (key: string) => {
      gets.push(key);
      return store.get(key) ?? null;
    },
    put: async (key: string, value: string) => {
      puts.push(key);
      store.set(key, value);
    },
  };
  return { kv, gets, puts };
}

function envWith(kv: unknown): Env {
  // DB/ASSETS are never reached on these paths; a touch would throw loudly.
  return { CACHE: kv, DB: undefined, ASSETS: undefined } as unknown as Env;
}

describe("GET /cards param validation", () => {
  it("400s invalid params with a terse JSON error, before touching D1", async () => {
    const { kv } = fakeKv();
    for (const query of [
      "pageSize=1000",
      "page=0",
      "hpMin=abc",
      "category=Pokémon",
      "legal=no",
      "sort=hp",
      "type=Fire&type=", // a repeated value must still be non-empty
      "id=sv01-001&id=", // ditto for ids
      "nameExact=",
      "stage=",
      "trainerType=",
      "energyType=",
      "serie=",
      "illustrator=",
      "text=",
      "suffix=",
    ]) {
      const res = await app.request(`/cards?${query}`, {}, envWith(kv));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues: string[] };
      expect(body.error).toBe("invalid query");
      expect(body.issues.length).toBeGreaterThan(0);
    }
  });

  it("400s more than 100 repeated ids (the hydration cap)", async () => {
    const { kv } = fakeKv();
    const ids = Array.from({ length: 101 }, (_, i) => `id=sv01-${i}`).join("&");
    const res = await app.request(`/cards?${ids}`, {}, envWith(kv));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid query");
  });

  it("never caches a 400", async () => {
    const { kv, puts } = fakeKv();
    await app.request("/cards?pageSize=1000", {}, envWith(kv));
    await app.request("/cards?nameExact=", {}, envWith(kv));
    expect(puts).toEqual([]);
  });
});

describe("catalog KV cache middleware", () => {
  it("serves a seeded key as a hit without touching D1", async () => {
    const cachedBody = JSON.stringify({ items: [], page: 1, pageSize: 50, total: 0 });
    const { kv } = fakeKv({ "catalog:v6:/cards?page=1&set=nope": cachedBody });
    // Param order differs from the stored key — normalization must line up.
    const res = await app.request("/cards?set=nope&page=1", {}, envWith(kv));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-luminous-cache")).toBe("hit");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ items: [], page: 1, pageSize: 50, total: 0 });
  });

  it("normalizes repeated params into one key — reordered repeats share it", async () => {
    const cachedBody = JSON.stringify({ items: [], page: 1, pageSize: 50, total: 0 });
    const { kv } = fakeKv({
      "catalog:v6:/cards?rarity=Common&type=Fire&type=Water": cachedBody,
    });
    const res = await app.request("/cards?type=Water&type=Fire&rarity=Common", {}, envWith(kv));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-luminous-cache")).toBe("hit");
  });

  it("accepts repeated type/rarity params — hono hands them to zod as arrays", async () => {
    const { kv } = fakeKv();
    const res = await app.request("/cards?type=Water&type=Fire&rarity=Common", {}, envWith(kv));
    // NOT a 400: validation passed and the request died later, at the
    // deliberately-absent D1 stub (the full data path runs via wrangler dev).
    expect(res.status).not.toBe(400);
  });

  it("accepts the P2 params — repeated ids/kinds and the scalar filters", async () => {
    const { kv } = fakeKv();
    for (const query of [
      "id=sv06.5-001&id=sve-002",
      "nameExact=Joltik",
      "stage=Basic&stage=Stage1&trainerType=Item&energyType=Special",
      "serie=sv&illustrator=Naoyo%20Kimura&text=Poison",
      // D198: repeatable like the other vocabulary dimensions.
      "suffix=ex&suffix=VMAX",
    ]) {
      const res = await app.request(`/cards?${query}`, {}, envWith(kv));
      expect(res.status).not.toBe(400); // dies at the absent D1, not validation
    }
  });

  it("bypasses KV entirely when the normalized key exceeds the 512-byte cap", async () => {
    // A realistic 60-unique-id deck hydration — the query string alone is
    // way past 512 bytes, and KV would 414 the GET instead of missing.
    const ids = Array.from({ length: 60 }, (_, i) => `id=sv06.5-${String(i + 1).padStart(3, "0")}`);
    const { kv, gets, puts } = fakeKv();
    const res = await app.request(`/cards?${ids.join("&")}&pageSize=100`, {}, envWith(kv));
    expect(res.status).not.toBe(400); // validation passed; died at the absent D1
    expect(gets).toEqual([]);
    expect(puts).toEqual([]);
  });

  it("bypasses KV for id-hydration requests even when the key would fit", async () => {
    // Per-deck id sets essentially never recur, so caching one is a
    // guaranteed-miss read plus a never-re-read write — `id` skips KV
    // outright, short key or not.
    const { kv, gets, puts } = fakeKv();
    const res = await app.request("/cards?id=sv06.5-001&pageSize=100", {}, envWith(kv));
    expect(res.status).not.toBe(400); // validation passed; died at the absent D1
    expect(gets).toEqual([]);
    expect(puts).toEqual([]);
  });

  it("serves a seeded /facets key as a hit without touching D1", async () => {
    const facets = {
      rarities: ["Common"],
      types: ["Grass"],
      stages: ["Basic"],
      trainerTypes: ["Item"],
      energyTypes: ["Normal"],
      illustrators: ["Naoyo Kimura"],
      regulationMarks: ["H"],
      suffixes: ["ex"],
    };
    const { kv } = fakeKv({ "catalog:v6:/facets": JSON.stringify(facets) });
    const res = await app.request("/facets", {}, envWith(kv));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-luminous-cache")).toBe("hit");
    expect(await res.json()).toEqual(facets);
  });
});
