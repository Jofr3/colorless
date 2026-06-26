import { describe, expect, it } from "vitest";
import type { BuilderCard } from "./cards";
import { DEFAULT_FILTERS, type Filters, filterPool, filtersActive } from "./poolFilter";

const pool: BuilderCard[] = [
  { cardId: "a-1", name: "Charizard ex", supertype: "Pokémon", subtype: "Stage 2", types: ["Fire"], hp: 330 },
  { cardId: "a-2", name: "Charmander", supertype: "Pokémon", subtype: "Basic", types: ["Fire"], hp: 70 },
  { cardId: "a-3", name: "Squirtle", supertype: "Pokémon", subtype: "Basic", types: ["Water"], hp: 60 },
  { cardId: "a-4", name: "Iono", supertype: "Trainer", subtype: "Supporter" },
  { cardId: "a-5", name: "Fire Energy", supertype: "Energy", subtype: "Basic Energy", types: ["Fire"] },
];

const f = (over: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...over });

describe("filterPool", () => {
  it("returns everything sorted by name by default", () => {
    expect(filterPool(pool, DEFAULT_FILTERS).map((c) => c.name)).toEqual([
      "Charizard ex",
      "Charmander",
      "Fire Energy",
      "Iono",
      "Squirtle",
    ]);
  });

  it("filters by supertype", () => {
    expect(filterPool(pool, f({ supertype: "Trainer" })).map((c) => c.cardId)).toEqual(["a-4"]);
  });

  it("filters by energy type, dropping untyped cards", () => {
    expect(filterPool(pool, f({ types: ["Fire"] })).map((c) => c.name)).toEqual([
      "Charizard ex",
      "Charmander",
      "Fire Energy",
    ]);
    expect(filterPool(pool, f({ types: ["Water"] })).map((c) => c.name)).toEqual(["Squirtle"]);
  });

  it("filters by subtype", () => {
    expect(filterPool(pool, f({ subtypes: ["Basic"] })).map((c) => c.name)).toEqual([
      "Charmander",
      "Squirtle",
    ]);
  });

  it("searches name case-insensitively", () => {
    expect(filterPool(pool, f({ query: "char" })).map((c) => c.name)).toEqual([
      "Charizard ex",
      "Charmander",
    ]);
  });

  it("sorts by HP descending", () => {
    expect(filterPool(pool, f({ supertype: "Pokémon", sort: "hp-desc" })).map((c) => c.hp)).toEqual([
      330, 70, 60,
    ]);
  });

  it("combines filters", () => {
    const out = filterPool(pool, f({ supertype: "Pokémon", types: ["Fire"], subtypes: ["Basic"] }));
    expect(out.map((c) => c.name)).toEqual(["Charmander"]);
  });
});

describe("filtersActive", () => {
  it("is false for defaults and true when any filter narrows", () => {
    expect(filtersActive(DEFAULT_FILTERS)).toBe(false);
    expect(filtersActive(f({ query: "x" }))).toBe(true);
    expect(filtersActive(f({ types: ["Fire"] }))).toBe(true);
    expect(filtersActive(f({ sort: "hp-desc" }))).toBe(false); // sort alone isn't "active"
  });
});
