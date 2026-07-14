import { describe, expect, it } from "vitest";
import type { BuilderCard } from "./cards";
import { DEFAULT_FILTERS, type Filters, filtersActive, filterVisibleCards } from "./poolFilter";

const f = (over: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...over });

// The kind chips filter server-side since P2 task 9 — filterVisibleCards is
// only the client-side remainder for selections containing a DERIVED kind
// (EX/Mega, read off the card name because tcgdex `suffix` isn't persisted).
describe("filterVisibleCards", () => {
  const cards: BuilderCard[] = [
    { cardId: "a-1", name: "Charizard ex", supertype: "Pokémon", subtype: "Stage 2" },
    { cardId: "a-2", name: "Charmander", supertype: "Pokémon", subtype: "Basic" },
    { cardId: "a-3", name: "Mega Kangaskhan ex", supertype: "Pokémon", subtype: "Basic" },
    { cardId: "a-4", name: "Iono", supertype: "Trainer", subtype: "Supporter" },
  ];
  const ids = (subtypes: string[]) => filterVisibleCards(cards, subtypes).map((c) => c.cardId);

  it("passes everything through when no kinds are selected", () => {
    expect(filterVisibleCards(cards, [])).toBe(cards);
  });

  it("passes purely-printed selections through — those filtered server-side", () => {
    expect(filterVisibleCards(cards, ["Basic"])).toBe(cards);
    expect(filterVisibleCards(cards, ["Supporter", "Pokémon Tool"])).toBe(cards);
  });

  it("applies the whole selection per page once a derived kind is in it", () => {
    expect(ids(["EX"])).toEqual(["a-1", "a-3"]);
    expect(ids(["Mega"])).toEqual(["a-3"]);
    // OR within the dimension: printed labels match by subtype equality.
    expect(ids(["Stage 2", "Mega"])).toEqual(["a-1", "a-3"]);
  });

  it("ignores unknown labels riding along with a derived kind", () => {
    expect(ids(["Mega", "Mystery Kind"])).toEqual(["a-3"]);
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
    expect(filtersActive(f({ setId: "sv06" }))).toBe(true);
    expect(filtersActive(f({ serieId: "sv" }))).toBe(true);
    expect(filtersActive(f({ illustrator: "5ban Graphics" }))).toBe(true);
    expect(filtersActive(f({ regulationMark: "H" }))).toBe(true);
    expect(filtersActive(f({ hpMin: "120" }))).toBe(true);
    expect(filtersActive(f({ hpMax: "200" }))).toBe(true);
    expect(filtersActive(f({ text: "discard" }))).toBe(true);
    expect(filtersActive(f({ legalOnly: false }))).toBe(true);
  });
});
