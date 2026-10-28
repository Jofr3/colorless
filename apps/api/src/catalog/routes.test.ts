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

  it("400s a page that skips more than MAX_CARDS_OFFSET cards, saying why", async () => {
    const { kv } = fakeKv();
    for (const query of [
      "page=127&pageSize=8",
      "page=12&pageSize=100&total=5000",
      "page=42&name=a",
    ]) {
      const res = await app.request(`/cards?${query}`, {}, envWith(kv));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues: string[] };
      expect(body.error).toBe("invalid query");
      expect(body.issues[0]).toMatch(/^page: page \d+ at \d+ a page skips more than 1000 cards/);
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

  it("400s more repeated filter values than one D1 statement can bind", async () => {
    const { kv } = fakeKv();
    const values = (name: string, count: number) =>
      Array.from({ length: count }, (_, i) => `${name}=v${i}`).join("&");
    for (const query of [
      values("rarity", 31),
      [values("type", 30), values("rarity", 30), values("stage", 30)].join("&"),
    ]) {
      const res = await app.request(`/cards?${query}`, {}, envWith(kv));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid query");
    }
  });

  it("400s a /cards/full request with no ids, an empty id or more than 100 ids", async () => {
    const { kv } = fakeKv();
    const tooMany = Array.from({ length: 101 }, (_, i) => `id=sv01-${i}`).join("&");
    for (const query of ["", "?id=", "?id=sv01-001&id=", `?${tooMany}`]) {
      const res = await app.request(`/cards/full${query}`, {}, envWith(kv));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid query");
    }
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
    const { kv } = fakeKv({ "catalog:v12:/cards?set=nope": cachedBody });
    // The explicit default page drops out of the key, as does a param the schema does not know.
    const res = await app.request("/cards?page=1&bust=7&set=nope", {}, envWith(kv));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-colorless-cache")).toBe("hit");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ items: [], page: 1, pageSize: 50, total: 0 });
  });

  it("normalizes repeated params into one key — reordered repeats share it", async () => {
    const cachedBody = JSON.stringify({ items: [], page: 1, pageSize: 50, total: 0 });
    const { kv } = fakeKv({
      "catalog:v12:/cards?rarity=Common&type=Fire&type=Water": cachedBody,
    });
    const res = await app.request("/cards?type=Water&type=Fire&rarity=Common", {}, envWith(kv));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-colorless-cache")).toBe("hit");
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
    const { kv } = fakeKv({ "catalog:v12:/facets": JSON.stringify(facets) });
    const res = await app.request("/facets", {}, envWith(kv));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-colorless-cache")).toBe("hit");
    expect(await res.json()).toEqual(facets);
  });
});

describe("catalog browser cache", () => {
  const body = JSON.stringify({ items: [], page: 1, pageSize: 50, total: 0 });
  const origin = "http://localhost:5175";

  it("stamps a public Cache-Control and an ETag on a 200", async () => {
    const { kv } = fakeKv({ "catalog:v12:/cards?set=sv01": body });
    const res = await app.request("/cards?set=sv01", {}, envWith(kv));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=300, stale-while-revalidate=3600",
    );
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
  });

  it("answers a matching If-None-Match with a 304 that keeps its CORS headers", async () => {
    const { kv } = fakeKv({ "catalog:v12:/cards?set=sv01": body });
    const first = await app.request(
      "/cards?set=sv01",
      { headers: { Origin: origin } },
      envWith(kv),
    );
    const tag = first.headers.get("etag") ?? "";
    const res = await app.request(
      "/cards?set=sv01",
      { headers: { Origin: origin, "If-None-Match": tag } },
      envWith(kv),
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBe(tag);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("cache-control")).toContain("max-age=300");
  });

  it("serves the full body when the ETag no longer matches", async () => {
    const { kv } = fakeKv({ "catalog:v12:/cards?set=sv01": body });
    const res = await app.request(
      "/cards?set=sv01",
      { headers: { "If-None-Match": '"stale"' } },
      envWith(kv),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it("leaves errors without a Cache-Control", async () => {
    const { kv } = fakeKv();
    const res = await app.request("/cards?pageSize=1000", {}, envWith(kv));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
