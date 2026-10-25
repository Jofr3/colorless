import { describe, expect, it } from "vitest";
import type { Mutant } from "./mutants";
import { pickSample } from "./sample";

const row = (id: string, file: string, killers: string[] = []): Mutant => ({
  id,
  decision: "D0",
  what: id,
  file,
  find: "a",
  replace: "b",
  expectKilledBy: killers,
});

const CORPUS = [
  row("a1", "src/a.ts"),
  row("a2", "src/a.ts"),
  row("k1", "src/b.ts", ["src/a.test.ts"]),
  ...Array.from({ length: 20 }, (_, i) => row(`r${i}`, `src/r${i}.ts`)),
];

describe("pickSample", () => {
  it("takes every row whose file or killer changed, then draws from the rest", () => {
    const { touched, random, dropped } = pickSample(
      CORPUS,
      new Set(["src/a.ts", "src/a.test.ts"]),
      { random: 5, cap: 10, seed: "s" },
    );
    expect(touched.map((m) => m.id).sort()).toEqual(["a1", "a2", "k1"]);
    expect(dropped).toBe(0);
    expect(random).toHaveLength(5);
    expect(random.every((m) => m.id.startsWith("r"))).toBe(true);
  });

  it("caps the changed rows and reports how many it left out", () => {
    const { touched, dropped } = pickSample(CORPUS, new Set(["src/a.ts"]), {
      random: 0,
      cap: 1,
      seed: "s",
    });
    expect(touched).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it("draws the same rows for the same seed and different rows for another", () => {
    const ids = (seed: string) =>
      pickSample(CORPUS, new Set(), { random: 6, cap: 0, seed }).random.map((m) => m.id);
    expect(ids("abc")).toEqual(ids("abc"));
    expect(ids("abc")).not.toEqual(ids("xyz"));
  });
});
