import { describe, expect, it } from "vitest";
import type { BuilderCard } from "./cards";
import type { Deck } from "./deckMath";
import { cardSetLabel, formatDecklist, parseDecklist } from "./decklistText";

const charizard: BuilderCard = {
  cardId: "obf-125",
  name: "Charizard ex",
  supertype: "Pokémon",
  subtype: "Stage 2",
  types: ["Fire"],
};
const charmander: BuilderCard = {
  cardId: "obf-26",
  name: "Charmander",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Fire"],
};
const research: BuilderCard = {
  cardId: "svi-189",
  name: "Professor's Research",
  supertype: "Trainer",
  subtype: "Supporter",
};
const fireEnergy: BuilderCard = {
  cardId: "sve-2",
  name: "Fire Energy",
  supertype: "Energy",
  subtype: "Basic Energy",
  types: ["Fire"],
};
// A three-word name ending in "ex" — the trailing "Hands ex" must not be peeled
// off as a set+number on import.
const ironHands: BuilderCard = {
  cardId: "sv4-70",
  name: "Iron Hands ex",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Lightning"],
};

const pool = [charizard, charmander, research, fireEnergy, ironHands];
const deckOf = (...entries: [BuilderCard, number][]): Deck =>
  entries.map(([card, quantity]) => ({ card, quantity }));

describe("cardSetLabel", () => {
  it("derives set code + number from the Scrydex id", () => {
    expect(cardSetLabel(charizard)).toBe("OBF 125");
    expect(cardSetLabel({ ...charizard, cardId: "sv8-125" })).toBe("SV8 125");
  });

  it("prefers an explicit number when present", () => {
    expect(cardSetLabel({ ...charizard, number: "125a" })).toBe("OBF 125a");
  });
});

describe("formatDecklist", () => {
  it("groups by supertype with subtotals and a grand total", () => {
    const deck = deckOf([research, 1], [charizard, 4], [fireEnergy, 5], [charmander, 4]);
    expect(formatDecklist(deck)).toBe(
      [
        "Pokémon: 8",
        "4 Charizard ex OBF 125",
        "4 Charmander OBF 26",
        "",
        "Trainer: 1",
        "1 Professor's Research SVI 189",
        "",
        "Energy: 5",
        "5 Fire Energy SVE 2",
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
  it("matches card lines by name, ignoring headers and totals", () => {
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
    const { entries, unmatched } = parseDecklist(text, pool);
    expect(unmatched).toHaveLength(0);
    const byId = Object.fromEntries(entries.map((e) => [e.card.cardId, e.quantity]));
    expect(byId).toEqual({ "obf-125": 4, "obf-26": 4, "svi-189": 1, "sve-2": 5 });
  });

  it("parses names with no set/number and sums duplicates", () => {
    const { entries } = parseDecklist("2 Charmander\n2 Charmander OBF 26", pool);
    expect(entries).toEqual([{ card: charmander, quantity: 4 }]);
  });

  it("keeps multi-word names ending in 'ex' whether or not a set follows", () => {
    const noSet = parseDecklist("3 Iron Hands ex", pool);
    expect(noSet.unmatched).toHaveLength(0);
    expect(noSet.entries).toEqual([{ card: ironHands, quantity: 3 }]);

    const withSet = parseDecklist("3 Iron Hands ex PAR 70", pool);
    expect(withSet.unmatched).toHaveLength(0);
    expect(withSet.entries).toEqual([{ card: ironHands, quantity: 3 }]);
  });

  it("reports lines it can't resolve", () => {
    const { entries, unmatched } = parseDecklist("3 Mystery Card ABC 9\n1 Charmander", pool);
    expect(entries).toEqual([{ card: charmander, quantity: 1 }]);
    expect(unmatched).toEqual([{ quantity: 3, name: "Mystery Card", raw: "3 Mystery Card ABC 9" }]);
  });

  it("round-trips a deck through format → parse", () => {
    const deck = deckOf([charizard, 4], [charmander, 4], [research, 2], [fireEnergy, 6]);
    const { entries, unmatched } = parseDecklist(formatDecklist(deck), pool);
    expect(unmatched).toHaveLength(0);
    const byId = Object.fromEntries(entries.map((e) => [e.card.cardId, e.quantity]));
    expect(byId).toEqual({ "obf-125": 4, "obf-26": 4, "svi-189": 2, "sve-2": 6 });
  });
});
