import { describe, expect, it } from "vitest";
import { catalogCacheKey } from "./cache";

const key = (url: string) => catalogCacheKey(new URL(url));

describe("catalogCacheKey", () => {
  it("keys by path under the versioned catalog prefix", () => {
    // The version segment guards cached SHAPES: bumping it (v2→v3 with the P2
    // CardBrief `legal` field) orphans every older entry instead of serving it.
    expect(key("http://api.test/cards")).toBe("catalog:v6:/cards");
    expect(key("http://api.test/cards/sv06.5-001")).toBe("catalog:v6:/cards/sv06.5-001");
  });

  it("normalizes query order — reordered params share a key", () => {
    expect(key("http://api.test/cards?set=sv06.5&page=2&pageSize=5")).toBe(
      key("http://api.test/cards?pageSize=5&set=sv06.5&page=2"),
    );
    expect(key("http://api.test/cards?set=sv06.5&page=2")).toBe(
      "catalog:v6:/cards?page=2&set=sv06.5",
    );
  });

  it("sorts repeated keys by value, deterministically", () => {
    expect(key("http://api.test/cards?type=Water&type=Fire")).toBe(
      key("http://api.test/cards?type=Fire&type=Water"),
    );
  });

  it("separates different values, paths and hosts' shared paths", () => {
    expect(key("http://api.test/cards?page=1")).not.toBe(key("http://api.test/cards?page=2"));
    expect(key("http://api.test/cards")).not.toBe(key("http://api.test/sets"));
    // The host never enters the key — one Worker, one origin.
    expect(key("http://a.test/cards?x=1")).toBe(key("http://b.test/cards?x=1"));
  });
});
