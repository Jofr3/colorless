import { describe, expect, it } from "vitest";
import type { BuilderCard } from "./cards";
import { DEFAULT_FILTERS, type Filters, filtersActive, filterVisibleCards } from "./poolFilter";

const f = (over: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...over });

// The kind chips are the ONE filter dimension still applied client-side
// (poolFilter.filterVisibleCards docblock) — printed subtypes plus the
// derived labels (Evolution, EX/Mega by name).
describe("filterVisibleCards", () => {
  const cards: BuilderCard[] = [
    { cardId: "a-1", name: "Charizard ex", supertype: "Pokémon", subtype: "Stage 2" },
    { cardId: "a-2", name: "Charmander", supertype: "Pokémon", subtype: "Basic" },
    { cardId: "a-3", name: "Kirlia", supertype: "Pokémon", subtype: "Stage 1" },
    { cardId: "a-4", name: "Iono", supertype: "Trainer", subtype: "Supporter" },
    { cardId: "a-5", name: "Rescue Board", supertype: "Trainer", subtype: "Pokémon Tool" },
    { cardId: "a-6", name: "Fire Energy", supertype: "Energy", subtype: "Basic Energy" },
  ];
  const ids = (subtypes: string[]) => filterVisibleCards(cards, subtypes).map((c) => c.cardId);

  it("passes everything through when no kinds are selected", () => {
    expect(filterVisibleCards(cards, [])).toBe(cards);
  });

  it("keeps printed-subtype matches", () => {
    expect(ids(["Basic"])).toEqual(["a-2"]);
    expect(ids(["Supporter", "Pokémon Tool"])).toEqual(["a-4", "a-5"]);
    expect(ids(["Basic Energy"])).toEqual(["a-6"]);
  });

  it("resolves the derived kinds — Evolution unions stages, EX reads the name", () => {
    expect(ids(["Evolution"])).toEqual(["a-1", "a-3"]);
    expect(ids(["EX"])).toEqual(["a-1"]);
  });

  it("ORs within the dimension and ignores unknown labels", () => {
    expect(ids(["Basic", "EX"])).toEqual(["a-1", "a-2"]);
    expect(ids(["Mystery Kind"])).toEqual([]);
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
