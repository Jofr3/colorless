import { describe, expect, it } from "vitest";
import { facetVocabulary, normalizeSentinel } from "./sentinel";

const PRODUCTION_RARITIES = [
  "ACE SPEC Rare",
  "Black White Rare",
  "Common",
  "Double rare",
  "Holo Rare",
  "Holo Rare V",
  "Holo Rare VMAX",
  "Holo Rare VSTAR",
  "Hyper rare",
  "Illustration rare",
  "None",
  "Promo",
  "Radiant Rare",
  "Rare",
  "Secret Rare",
  // SQLite's BINARY collation puts "Shiny Ultra Rare" before "Shiny rare"
  // (uppercase U < lowercase r) — copied from the DB, not re-sorted here.
  "Shiny Ultra Rare",
  "Shiny rare",
  "Special illustration rare",
  "Ultra Rare",
  "Uncommon",
];

/** Ditto for `regulation_mark`: five real marks plus the sentinel that
    mfb-33 (Potion) and mfb-34 (Switch) carry. */
const PRODUCTION_MARKS = ["D", "F", "G", "H", "I", "None"];

describe("normalizeSentinel", () => {
  it("nulls the literal 'None' the mfb set ships for rarity and mark", () => {
    expect(normalizeSentinel("None")).toBeNull();
  });

  it("nulls the empty and whitespace-only string", () => {
    expect(normalizeSentinel("")).toBeNull();
    expect(normalizeSentinel("   ")).toBeNull();
  });

  it("matches case- and whitespace-insensitively", () => {
    for (const spelling of ["none", "NONE", "nOnE", " None ", "\tNone\n"]) {
      expect(normalizeSentinel(spelling)).toBeNull();
    }
  });

  it("passes null and undefined straight through as null", () => {
    // The point of absence: NULL means "no mark" / "no rarity" for 66 real
    // cards (36 Basic Energy, 29 pre-mark Pokémon, 1 Trainer) and this
    // function must never turn that into anything else.
    expect(normalizeSentinel(null)).toBeNull();
    expect(normalizeSentinel(undefined)).toBeNull();
  });

  it("returns every real catalog value BYTE-IDENTICAL — no trim, no re-case", () => {
    // Over-reach guard. A normaliser that tidies survivors starts eating
    // real data; only the sentinel set is allowed to change.
    for (const value of [...PRODUCTION_RARITIES, ...PRODUCTION_MARKS]) {
      if (value === "None") continue;
      expect(normalizeSentinel(value)).toBe(value);
    }
  });

  it("leaves near-misses alone — only exact sentinel spellings are absence", () => {
    for (const value of ["Nonet", "None-ko", "no-none", "N/A", "-", "unknown", "0"]) {
      expect(normalizeSentinel(value)).toBe(value);
    }
  });
});

describe("facetVocabulary", () => {
  it("drops the sentinel from the REAL rarity facet, keeping the other 19", () => {
    const vocabulary = facetVocabulary(PRODUCTION_RARITIES);
    expect(vocabulary).toEqual(PRODUCTION_RARITIES.filter((r) => r !== "None"));
    expect(vocabulary).toHaveLength(19);
  });

  it("drops the sentinel from the REAL regulation-mark facet", () => {
    expect(facetVocabulary(PRODUCTION_MARKS)).toEqual(["D", "F", "G", "H", "I"]);
  });

  it("cannot emit a sentinel — pinned as an EMPTINESS over both real facets", () => {
    const noisy = [...PRODUCTION_RARITIES, ...PRODUCTION_MARKS, "", "  ", "none", "NONE", null];
    const sentinels = facetVocabulary(noisy).filter(
      (value) => value.trim() === "" || value.trim().toLowerCase() === "none",
    );
    expect(sentinels).toEqual([]);
  });

  it("preserves the SQL's order and collapses spellings that normalise alike", () => {
    expect(facetVocabulary(["I", "None", "H", "", "H", null, "G"])).toEqual(["I", "H", "G"]);
  });

  it("returns [] for an all-absent vocabulary rather than a list of holes", () => {
    expect(facetVocabulary([null, "None", "", null])).toEqual([]);
  });
});
