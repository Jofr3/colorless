import { describe, expect, it } from "vitest";
import { chunk, createsCycle, type ParentById, unknownIds } from "./validate";

describe("createsCycle", () => {
  // root ─ a ─ b ─ c (a chain), plus root-level sibling `s`.
  const parents: ParentById = new Map<string, string | null>([
    ["a", null],
    ["b", "a"],
    ["c", "b"],
    ["s", null],
  ]);

  it("rejects self-parenting (the zero-step cycle)", () => {
    expect(createsCycle(parents, "a", "a")).toBe(true);
  });

  it("rejects moving under a direct child", () => {
    expect(createsCycle(parents, "a", "b")).toBe(true);
  });

  it("rejects moving under a deeper descendant", () => {
    expect(createsCycle(parents, "a", "c")).toBe(true);
  });

  it("allows moving under a sibling", () => {
    expect(createsCycle(parents, "a", "s")).toBe(false);
  });

  it("allows moving a leaf under the chain's root", () => {
    expect(createsCycle(parents, "s", "c")).toBe(false);
  });

  it("allows re-parenting a child under its grandparent (shortening)", () => {
    expect(createsCycle(parents, "c", "a")).toBe(false);
  });

  it("terminates on corrupt parent data that already loops", () => {
    const corrupt: ParentById = new Map([
      ["x", "y"],
      ["y", "x"],
    ]);
    // "z" is nowhere in the loop — the walk must still terminate (false).
    expect(createsCycle(corrupt, "z", "x")).toBe(false);
  });
});

describe("unknownIds", () => {
  it("returns the ids missing from the known set, in request order", () => {
    expect(unknownIds(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  it("returns [] when everything is known", () => {
    expect(unknownIds(["a", "b"], ["b", "a", "extra"])).toEqual([]);
  });

  it("reports each missing id once", () => {
    expect(unknownIds(["a", "a", "b"], ["b"])).toEqual(["a"]);
  });
});

describe("chunk", () => {
  it("splits into runs of the given size, last one shorter", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("keeps an exact multiple intact", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("returns [] for an empty list", () => {
    expect(chunk([], 10)).toEqual([]);
  });
});
