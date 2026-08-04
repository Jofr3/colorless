import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, type Filters, filtersActive } from "./poolFilter";

const f = (over: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...over });

// NOTE (D198): this file used to test `filterVisibleCards`, the one
// client-side remainder of the card search — it re-applied a kind selection
// per page whenever it contained a DERIVED kind (EX/Mega, name regexes the
// server could not express). It is gone: `?suffix=` answers those server-side
// now, so no dimension is filtered after paging and a page can no longer
// render nearly empty under a total in the hundreds. What is left here is the
// Filters model itself.

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
    expect(filtersActive(f({ suffixes: ["ex"] }))).toBe(true);
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
