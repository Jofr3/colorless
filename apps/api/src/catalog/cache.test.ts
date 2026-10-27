import { cardsQuerySchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { cacheQuery, catalogCacheKey } from "./cache";

const DEFAULTS = cardsQuerySchema.parse({});
/** The cache query for a raw /cards query string, as the route validates it. */
const cardsKeyQuery = (search: string) => {
  const raw: Record<string, string | string[]> = {};
  for (const [name, value] of new URLSearchParams(search)) {
    const seen = raw[name];
    raw[name] = seen === undefined ? value : [...(Array.isArray(seen) ? seen : [seen]), value];
  }
  return cacheQuery(cardsQuerySchema.parse(raw), DEFAULTS);
};

describe("catalogCacheKey", () => {
  it("keys by path and query under the versioned catalog prefix", () => {
    // The version segment guards cached SHAPES: bumping it (v2→v3 with the P2
    // CardBrief `legal` field) orphans every older entry instead of serving it.
    expect(catalogCacheKey("/cards")).toBe("catalog:v12:/cards");
    expect(catalogCacheKey("/cards", "page=2&set=sv01")).toBe("catalog:v12:/cards?page=2&set=sv01");
  });

  it("scopes keys by the stamped catalog epoch", () => {
    expect(catalogCacheKey("/cards", "set=sv01", "m3k1")).toBe("catalog:v12:m3k1:/cards?set=sv01");
    expect(catalogCacheKey("/cards", "", "m3k1")).not.toBe(catalogCacheKey("/cards", "", "m3k2"));
    expect(catalogCacheKey("/cards", "set=sv01", null)).toBe("catalog:v12:/cards?set=sv01");
  });
});

describe("cacheQuery", () => {
  it("drops params the schema does not know", () => {
    expect(cardsKeyQuery("bust=1")).toBe("");
    expect(cardsKeyQuery("set=sv01&bust=1")).toBe(cardsKeyQuery("set=sv01&bust=2&utm=x"));
  });

  it("drops defaults, spelled out or not", () => {
    expect(cardsKeyQuery("page=1&sort=set&pageSize=50")).toBe("");
    expect(cardsKeyQuery("set=sv01&page=01")).toBe("set=sv01");
    expect(cardsKeyQuery("page=2&pageSize=8")).toBe("page=2&pageSize=8");
  });

  it("sorts keys and repeated values, and dedupes repeats", () => {
    expect(cardsKeyQuery("type=Water&rarity=Common&type=Fire")).toBe(
      "rarity=Common&type=Fire&type=Water",
    );
    expect(cardsKeyQuery("type=Fire&type=Fire")).toBe(cardsKeyQuery("type=Fire"));
  });

  it("separates different values", () => {
    expect(cardsKeyQuery("page=2")).not.toBe(cardsKeyQuery("page=3"));
    expect(cardsKeyQuery("sort=name")).toBe("sort=name");
  });
});
