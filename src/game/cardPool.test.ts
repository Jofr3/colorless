import { type Card, MAX_ID_VALUES } from "@colorless/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { fullCardsFrom, json, stubFetch } from "../test/fetchStub";
import { clearCardPoolCache, fetchCardPool } from "./cardPool";

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

const ids = (url: URL) => url.searchParams.getAll("id");

describe("fetchCardPool", () => {
  it("resolves empty input without touching the network", async () => {
    const { impl } = stubFetch({});
    await expect(fetchCardPool([])).resolves.toEqual({ pool: {}, missing: [] });
    expect(impl).not.toHaveBeenCalled();
  });

  it("asks once for the deduped, sorted ids and keys the pool by card id", async () => {
    const asked: string[][] = [];
    const { impl } = stubFetch({
      "GET /cards/full": (url) => {
        asked.push(ids(url));
        return fullCardsFrom({ a: card("a"), b: card("b") })(url);
      },
    });
    const { pool, missing } = await fetchCardPool(["b", "a", "b", "a", "a"]);
    expect(pool).toEqual({ a: card("a"), b: card("b") });
    expect(missing).toEqual([]);
    expect(impl).toHaveBeenCalledTimes(1);
    expect(asked).toEqual([["a", "b"]]);
  });

  it("files ids the catalog left out under missing, in input order", async () => {
    stubFetch({ "GET /cards/full": fullCardsFrom({ a: card("a"), b: card("b") }) });
    const { pool, missing } = await fetchCardPool(["gone-1", "a", "gone-2", "b"]);
    expect(missing).toEqual(["gone-1", "gone-2"]);
    expect(Object.keys(pool).sort()).toEqual(["a", "b"]);
  });

  it("rejects on an http failure instead of filing it under missing", async () => {
    stubFetch({ "GET /cards/full": () => json({ error: "internal" }, 500) });
    const error = await fetchCardPool(["a", "boom", "b"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });

  it("rejects on a network failure", async () => {
    stubFetch({ "GET /cards/full": () => Promise.reject(new TypeError("fetch failed")) });
    await expect(fetchCardPool(["a"])).rejects.toThrow("fetch failed");
  });

  it("asks only for ids it has not seen, and serves the rest from the cache", async () => {
    const asked: string[][] = [];
    const { impl } = stubFetch({
      "GET /cards/full": (url) => {
        asked.push(ids(url));
        return fullCardsFrom({ a: card("a"), b: card("b"), c: card("c") })(url);
      },
    });
    await fetchCardPool(["a", "b"]);
    const { pool, missing } = await fetchCardPool(["a", "b"]);
    expect(impl).toHaveBeenCalledTimes(1);
    expect(pool).toEqual({ a: card("a"), b: card("b") });
    expect(missing).toEqual([]);
    await fetchCardPool(["c", "b"]);
    expect(asked).toEqual([["a", "b"], ["c"]]);
  });

  it("keeps an absent id cached as missing — absence is a stable catalog fact", async () => {
    const { impl } = stubFetch({ "GET /cards/full": fullCardsFrom({}) });
    await expect(fetchCardPool(["gone"])).resolves.toEqual({ pool: {}, missing: ["gone"] });
    await expect(fetchCardPool(["gone"])).resolves.toEqual({ pool: {}, missing: ["gone"] });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("retries the ids of a failed request while successes stay cached", async () => {
    let calls = 0;
    const asked: string[][] = [];
    stubFetch({
      "GET /cards/full": (url) => {
        calls += 1;
        asked.push(ids(url));
        return calls === 2
          ? json({ error: "internal" }, 500)
          : fullCardsFrom({ a: card("a"), flaky: card("flaky") })(url);
      },
    });
    await fetchCardPool(["a"]);
    await expect(fetchCardPool(["a", "flaky"])).rejects.toBeInstanceOf(ApiError);
    const { pool, missing } = await fetchCardPool(["a", "flaky"]);
    expect(pool).toEqual({ a: card("a"), flaky: card("flaky") });
    expect(missing).toEqual([]);
    expect(asked).toEqual([["a"], ["flaky"], ["flaky"]]);
  });

  it("shares a request still in flight with a concurrent call", async () => {
    const { impl } = stubFetch({ "GET /cards/full": fullCardsFrom({ a: card("a") }) });
    const [first, second] = await Promise.all([fetchCardPool(["a"]), fetchCardPool(["a"])]);
    expect(first).toEqual(second);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("splits more than MAX_ID_VALUES ids into requests of at most that many", async () => {
    const many = Array.from({ length: MAX_ID_VALUES * 2 + 5 }, (_, i) => `c${i}`);
    const sizes: number[] = [];
    stubFetch({
      "GET /cards/full": (url) => {
        sizes.push(ids(url).length);
        return fullCardsFrom(Object.fromEntries(many.map((id) => [id, card(id)])))(url);
      },
    });
    const { pool, missing } = await fetchCardPool(many);
    expect(Object.keys(pool)).toHaveLength(many.length);
    expect(missing).toEqual([]);
    expect(sizes).toEqual([MAX_ID_VALUES, MAX_ID_VALUES, 5]);
  });
});
