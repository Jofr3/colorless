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

describe("filterPool — format legality", () => {
  // "H"/"I" are legal; "F" is a rotated-out mark. An unmarked card is always legal.
  const legalMarks = ["H", "I"];
  const legalityPool: BuilderCard[] = [
    { cardId: "l-1", name: "Alpha", supertype: "Pokémon", subtype: "Basic", regulationMark: "H" },
    { cardId: "l-2", name: "Bravo", supertype: "Pokémon", subtype: "Basic", regulationMark: "F" },
    { cardId: "l-3", name: "Energy", supertype: "Energy", subtype: "Basic Energy" },
  ];

  it("drops cards whose regulation mark isn't legal, keeping unmarked cards", () => {
    const out = filterPool(legalityPool, DEFAULT_FILTERS, legalMarks).map((c) => c.cardId);
    expect(out).toEqual(["l-1", "l-3"]);
  });

  it("keeps illegal-mark cards when legalOnly is off", () => {
    const out = filterPool(legalityPool, f({ legalOnly: false }), legalMarks).map((c) => c.cardId);
    expect(out).toEqual(["l-1", "l-2", "l-3"]);
  });

  it("ignores marks entirely when the format supplies none (Expanded)", () => {
    expect(filterPool(legalityPool, DEFAULT_FILTERS)).toHaveLength(3);
  });
});

describe("filterPool — set sort", () => {
  const setPool: BuilderCard[] = [
    { cardId: "s-1", name: "Bravo", supertype: "Trainer", subtype: "Item", setName: "Alpha", number: "10" },
    { cardId: "s-2", name: "Alpha", supertype: "Trainer", subtype: "Item", setName: "Alpha", number: "2" },
    { cardId: "s-3", name: "Zulu", supertype: "Trainer", subtype: "Item", setName: "Beta", number: "1" },
  ];

  it("orders by set name, then collector number numerically, then name", () => {
    // Within set "Alpha", #2 precedes #10 numerically (not lexically); "Beta" follows.
    const out = filterPool(setPool, f({ sort: "set" })).map((c) => c.cardId);
    expect(out).toEqual(["s-2", "s-1", "s-3"]);
  });
});

describe("filterPool — rarity", () => {
  const rarityPool: BuilderCard[] = [
    { cardId: "r-1", name: "Common Mon", supertype: "Pokémon", subtype: "Basic", rarity: "Common" },
    { cardId: "r-2", name: "Rare Mon", supertype: "Pokémon", subtype: "Basic", rarity: "Double Rare" },
    { cardId: "r-3", name: "Plain Mon", supertype: "Pokémon", subtype: "Basic" },
  ];

  it("keeps only selected rarities, dropping cards with no rarity", () => {
    const one = filterPool(rarityPool, f({ rarities: ["Double Rare"] })).map((c) => c.cardId);
    expect(one).toEqual(["r-2"]);
    const two = filterPool(rarityPool, f({ rarities: ["Common", "Double Rare"] })).map((c) => c.cardId);
    expect(two).toEqual(["r-1", "r-2"]);
  });
});

describe("filterPool — query targets", () => {
  const queryPool: BuilderCard[] = [
    { cardId: "swsh-123", name: "Pikachu", supertype: "Pokémon", subtype: "Basic", setName: "Vivid Voltage" },
    { cardId: "sv-045", name: "Bulbasaur", supertype: "Pokémon", subtype: "Basic", setName: "Twilight" },
  ];

  it("matches on set name", () => {
    expect(filterPool(queryPool, f({ query: "vivid" })).map((c) => c.cardId)).toEqual(["swsh-123"]);
  });

  it("matches on card id, full and partial", () => {
    expect(filterPool(queryPool, f({ query: "sv-045" })).map((c) => c.cardId)).toEqual(["sv-045"]);
    expect(filterPool(queryPool, f({ query: "045" })).map((c) => c.cardId)).toEqual(["sv-045"]);
  });
});

describe("filtersActive", () => {
  it("is false for defaults (sort alone doesn't count)", () => {
    expect(filtersActive(DEFAULT_FILTERS)).toBe(false);
    expect(filtersActive(f({ sort: "hp-desc" }))).toBe(false);
  });

  it("is true when any narrowing dimension is set", () => {
    expect(filtersActive(f({ query: "x" }))).toBe(true);
    expect(filtersActive(f({ supertype: "Trainer" }))).toBe(true);
    expect(filtersActive(f({ types: ["Fire"] }))).toBe(true);
    expect(filtersActive(f({ subtypes: ["Basic"] }))).toBe(true);
    expect(filtersActive(f({ rarities: ["Common"] }))).toBe(true);
    expect(filtersActive(f({ legalOnly: false }))).toBe(true);
  });
});
