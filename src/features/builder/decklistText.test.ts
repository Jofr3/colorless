import { describe, expect, it, vi } from "vitest";
import { builderCard } from "../../test/fixtures";
import type { BuilderCard } from "./cards";
import type { Deck } from "./deckMath";
import {
  cardSetLabel,
  formatDecklist,
  nameKey,
  parseDecklist,
  resolveDecklist,
} from "./decklistText";

const charizard = builderCard({
  cardId: "sv03-125",
  name: "Charizard ex",
  supertype: "Pokémon",
  subtype: "Stage 2",
  types: ["Fire"],
});
const charmander = builderCard({
  cardId: "sv03-026",
  name: "Charmander",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Fire"],
});
const research = builderCard({
  cardId: "sv01-189",
  name: "Professor's Research",
  supertype: "Trainer",
  subtype: "Supporter",
});
const fireEnergy = builderCard({
  cardId: "sve-002",
  name: "Fire Energy",
  supertype: "Energy",
  subtype: "Basic Energy",
  types: ["Fire"],
});
// A three-word name ending in "ex" — the trailing "Hands ex" must not be peeled
// off as a set+number on import.
const ironHands = builderCard({
  cardId: "sv04-070",
  name: "Iron Hands ex",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Lightning"],
});

const pool = [charizard, charmander, research, fireEnergy, ironHands];
const deckOf = (...entries: [BuilderCard, number][]): Deck =>
  entries.map(([card, quantity]) => ({ card, quantity }));

/** A catalog-shaped async lookup over the fixture pool — exact match on the
    normalized name, like catalog.ts's findCardByName. Tests never touch the
    network. */
const findInPool = (name: string): Promise<BuilderCard | undefined> =>
  Promise.resolve(pool.find((card) => nameKey(card.name) === nameKey(name)));

describe("cardSetLabel", () => {
  it("derives set code + number from the tcgdex id", () => {
    expect(cardSetLabel(charizard)).toBe("SV03 125");
    expect(cardSetLabel({ ...charizard, cardId: "sv8-125" })).toBe("SV8 125");
  });

  it("prefers an explicit number when present", () => {
    expect(cardSetLabel({ ...charizard, number: "125a" })).toBe("SV03 125a");
  });
});

describe("formatDecklist", () => {
  it("groups by supertype with subtotals and a grand total", () => {
    const deck = deckOf([research, 1], [charizard, 4], [fireEnergy, 5], [charmander, 4]);
    expect(formatDecklist(deck)).toBe(
      [
        "Pokémon: 8",
        "4 Charizard ex SV03 125",
        "4 Charmander SV03 026",
        "",
        "Trainer: 1",
        "1 Professor's Research SV01 189",
        "",
        "Energy: 5",
        "5 Fire Energy SVE 002",
        "",
        "Total Cards: 14",
      ].join("\n"),
    );
  });

  it("renders an empty deck without a leading blank line", () => {
    expect(formatDecklist([])).toBe("Total Cards: 0");
  });
});

describe("parseDecklist", () => {
  it("lifts card lines, ignoring headers, totals and non-card lines", () => {
    const text = [
      "Pokémon: 8",
      "4 Charizard ex OBF 125",
      "",
      "some stray comment",
      "1 Professor's Research SVI 189",
      "Total Cards: 5",
    ].join("\n");
    expect(parseDecklist(text)).toEqual([
      { quantity: 4, name: "Charizard ex OBF 125", raw: "4 Charizard ex OBF 125" },
      { quantity: 1, name: "Professor's Research SVI 189", raw: "1 Professor's Research SVI 189" },
    ]);
  });

  it("drops zero quantities and empty names", () => {
    expect(parseDecklist("0 Charmander\n3")).toEqual([]);
  });
});

describe("resolveDecklist", () => {
  it("matches card lines by name, tolerating trailing set/number and prefixes", async () => {
    const text = [
      "Pokémon: 8",
      "4 Charizard ex OBF 125",
      "4 Charmander OBF 26",
      "",
      "Trainer: 1",
      "1 Professor's Research SVI 189",
      "",
      "Energy: 5",
      "5 Basic Fire Energy SVE 2", // "Basic …" normalises to "Fire Energy"
      "",
      "Total Cards: 14",
    ].join("\n");
    const { entries, unmatched } = await resolveDecklist(parseDecklist(text), findInPool);
    expect(unmatched).toHaveLength(0);
    const byId = Object.fromEntries(entries.map((e) => [e.card.cardId, e.quantity]));
    expect(byId).toEqual({ "sv03-125": 4, "sv03-026": 4, "sv01-189": 1, "sve-002": 5 });
  });

  it("parses names with no set/number and sums duplicates", async () => {
    const { entries } = await resolveDecklist(
      parseDecklist("2 Charmander\n2 Charmander OBF 26"),
      findInPool,
    );
    expect(entries).toEqual([{ card: charmander, quantity: 4 }]);
  });

  it("keeps multi-word names ending in 'ex' whether or not a set follows", async () => {
    const noSet = await resolveDecklist(parseDecklist("3 Iron Hands ex"), findInPool);
    expect(noSet.unmatched).toHaveLength(0);
    expect(noSet.entries).toEqual([{ card: ironHands, quantity: 3 }]);

    const withSet = await resolveDecklist(parseDecklist("3 Iron Hands ex PAR 70"), findInPool);
    expect(withSet.unmatched).toHaveLength(0);
    expect(withSet.entries).toEqual([{ card: ironHands, quantity: 3 }]);
  });

  it("reports lines it can't resolve", async () => {
    const { entries, unmatched } = await resolveDecklist(
      parseDecklist("3 Mystery Card ABC 9\n1 Charmander"),
      findInPool,
    );
    expect(entries).toEqual([{ card: charmander, quantity: 1 }]);
    expect(unmatched).toEqual([{ quantity: 3, name: "Mystery Card", raw: "3 Mystery Card ABC 9" }]);
  });

  it("memoizes lookups by normalized name — one call per unique name form", async () => {
    const lookup = vi.fn(findInPool);
    await resolveDecklist(
      parseDecklist("2 Charmander\n2 Charmander OBF 26\n1 Basic Fire Energy\n1 Fire Energy"),
      lookup,
    );
    // Both Energy spellings share one normalized key; the "… OBF 26" form is
    // its own (missing) lookup whose stripped retry then hits the cache — so
    // three calls, not five.
    expect(lookup.mock.calls.map(([name]) => nameKey(name)).sort()).toEqual([
      "charmander",
      "charmander obf 26",
      "fire energy",
    ]);
  });

  it("rejects when a lookup throws — an api failure is not 'unmatched'", async () => {
    const failing = () => Promise.reject(new Error("api down"));
    await expect(resolveDecklist(parseDecklist("2 Charmander"), failing)).rejects.toThrow(
      "api down",
    );
  });

  it("round-trips a deck through format → parse → resolve", async () => {
    const deck = deckOf([charizard, 4], [charmander, 4], [research, 2], [fireEnergy, 6]);
    const { entries, unmatched } = await resolveDecklist(
      parseDecklist(formatDecklist(deck)),
      findInPool,
    );
    expect(unmatched).toHaveLength(0);
    const byId = Object.fromEntries(entries.map((e) => [e.card.cardId, e.quantity]));
    expect(byId).toEqual({ "sv03-125": 4, "sv03-026": 4, "sv01-189": 2, "sve-002": 6 });
  });
});
