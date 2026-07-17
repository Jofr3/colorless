import type { Card } from "@luminous/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { json, stubFetch } from "../../test/fetchStub";
import { clearCardPoolCache, fetchCardPool } from "./cardPool";

// fetchCardPool is a fetch-fan-out over GET /cards/:id, so the tests stub
// global fetch with the shared routing table and assert on the partition
// (pool vs missing), the rejection semantics, the in-flight ceiling, and
// the module-level per-id cache (cleared between cases — it outlives each
// test's fetch stub by design).

/** A full wire-shaped Card (every column, null off-category) keyed by id. */
function card(id: string): Card {
  return {
    id,
    setId: "sv06.5",
    localId: "001",
    name: id,
    category: "Pokemon",
    image: null,
    illustrator: null,
    rarity: "Common",
    regulationMark: "H",
    hp: 40,
    stage: "Basic",
    evolveFrom: null,
    types: ["Grass"],
    retreat: 1,
    abilities: null,
    attacks: [{ cost: ["Grass"], name: "Gnaw", damage: 10 }],
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: null,
    trainerType: null,
    energyType: null,
    effect: null,
    legal: { standard: true, expanded: true },
    variants: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearCardPoolCache();
});

describe("fetchCardPool", () => {
  it("resolves empty input without touching the network", async () => {
    const { impl } = stubFetch({});
    await expect(fetchCardPool([])).resolves.toEqual({ pool: {}, missing: [] });
    expect(impl).not.toHaveBeenCalled();
  });

  it("dedupes ids and keys the pool by card id", async () => {
    const { impl } = stubFetch({
      "GET /cards/a": () => json(card("a")),
      "GET /cards/b": () => json(card("b")),
    });
    const { pool, missing } = await fetchCardPool(["a", "b", "a", "b", "a"]);
    expect(pool).toEqual({ a: card("a"), b: card("b") });
    expect(missing).toEqual([]);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("partitions 404s into missing, in input order", async () => {
    stubFetch({
      "GET /cards/gone-1": () => json({ error: "card not found" }, 404),
      "GET /cards/a": () => json(card("a")),
      "GET /cards/gone-2": () => json({ error: "card not found" }, 404),
      "GET /cards/b": () => json(card("b")),
    });
    const { pool, missing } = await fetchCardPool(["gone-1", "a", "gone-2", "b"]);
    expect(missing).toEqual(["gone-1", "gone-2"]);
    expect(Object.keys(pool).sort()).toEqual(["a", "b"]);
  });

  it("rejects on a non-404 http failure instead of filing it under missing", async () => {
    stubFetch({
      "GET /cards/a": () => json(card("a")),
      "GET /cards/boom": () => json({ error: "internal" }, 500),
      "GET /cards/b": () => json(card("b")),
    });
    const error = await fetchCardPool(["a", "boom", "b"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });

  it("rejects on a network failure", async () => {
    stubFetch({
      "GET /cards/a": () => Promise.reject(new TypeError("fetch failed")),
    });
    await expect(fetchCardPool(["a"])).rejects.toThrow("fetch failed");
  });

  it("serves cached ids without new fetches on a second call", async () => {
    const { impl } = stubFetch({
      "GET /cards/a": () => json(card("a")),
      "GET /cards/b": () => json(card("b")),
    });
    await fetchCardPool(["a", "b"]);
    expect(impl).toHaveBeenCalledTimes(2);
    // "Play again" with the same decks: zero new requests, same partition.
    const { pool, missing } = await fetchCardPool(["a", "b"]);
    expect(impl).toHaveBeenCalledTimes(2);
    expect(pool).toEqual({ a: card("a"), b: card("b") });
    expect(missing).toEqual([]);
  });

  it("keeps a 404 cached as missing — absence is a stable catalog fact", async () => {
    const { impl } = stubFetch({
      "GET /cards/gone": () => json({ error: "card not found" }, 404),
    });
    await expect(fetchCardPool(["gone"])).resolves.toEqual({ pool: {}, missing: ["gone"] });
    await expect(fetchCardPool(["gone"])).resolves.toEqual({ pool: {}, missing: ["gone"] });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("retries a transiently-failed id (rejected promises evict) while successes stay cached", async () => {
    let flakyCalls = 0;
    const { impl } = stubFetch({
      "GET /cards/a": () => json(card("a")),
      "GET /cards/flaky": () => {
        flakyCalls += 1;
        return flakyCalls === 1 ? json({ error: "internal" }, 500) : json(card("flaky"));
      },
    });
    await expect(fetchCardPool(["a", "flaky"])).rejects.toBeInstanceOf(ApiError);
    // The 5xx did not poison the id: the next call refetches ONLY flaky.
    const { pool, missing } = await fetchCardPool(["a", "flaky"]);
    expect(pool).toEqual({ a: card("a"), flaky: card("flaky") });
    expect(missing).toEqual([]);
    expect(flakyCalls).toBe(2);
    expect(impl).toHaveBeenCalledTimes(3); // a once (cached), flaky twice
  });

  it("keeps at most 8 requests in flight", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
    let inFlight = 0;
    let peak = 0;
    const routes: Record<string, () => Promise<Response>> = {};
    for (const id of ids) {
      routes[`GET /cards/${id}`] = async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve(); // yield so every ready worker starts its fetch first
        inFlight -= 1;
        return json(card(id));
      };
    }
    stubFetch(routes);
    const { pool, missing } = await fetchCardPool(ids);
    expect(Object.keys(pool)).toHaveLength(20);
    expect(missing).toEqual([]);
    expect(peak).toBe(8);
  });
});
