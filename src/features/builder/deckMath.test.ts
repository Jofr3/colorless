import { describe, expect, it } from "vitest";
import { type BuilderCard, FORMATS, formatById } from "./cards";
import {
  basicPokemonCount,
  copiesByName,
  countsBySupertype,
  type Deck,
  pokemonTypeDistribution,
  remainingAllowed,
  totalCount,
  validateDeck,
} from "./deckMath";

const charizard: BuilderCard = {
  cardId: "obf-125",
  name: "Charizard ex",
  supertype: "Pokémon",
  subtype: "Stage 2",
  types: ["Fire"],
  hp: 330,
  regulationMark: "H",
};
// A second print of the same name — copies count by name, across prints.
const charizardReprint: BuilderCard = { ...charizard, cardId: "mew-6", number: "006" };
const charmander: BuilderCard = {
  cardId: "obf-26",
  name: "Charmander",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Fire"],
  hp: 70,
  regulationMark: "H",
};
const squirtle: BuilderCard = {
  cardId: "mew-7",
  name: "Squirtle",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Water"],
  hp: 60,
  regulationMark: "H",
};
const research: BuilderCard = {
  cardId: "svi-189",
  name: "Professor's Research",
  supertype: "Trainer",
  subtype: "Supporter",
  regulationMark: "H",
};
// Two distinct ACE SPEC cards — only one ACE SPEC is allowed per deck, total.
const aceA: BuilderCard = {
  cardId: "sv5-119",
  name: "Prime Catcher",
  supertype: "Trainer",
  subtype: "Item",
  regulationMark: "H",
  rarity: "ACE SPEC Rare",
};
const aceB: BuilderCard = {
  cardId: "sv6-167",
  name: "Legacy Energy",
  supertype: "Energy",
  subtype: "Special Energy",
  regulationMark: "H",
  rarity: "ACE SPEC Rare",
};
const fireEnergy: BuilderCard = {
  cardId: "sve-2",
  name: "Fire Energy",
  supertype: "Energy",
  subtype: "Basic Energy",
  types: ["Fire"],
};
// A rotated-out card — mark "F" is not in Standard's allow-list.
const rotated: BuilderCard = {
  cardId: "swsh1-1",
  name: "Snom",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Water"],
  hp: 60,
  regulationMark: "F",
};

const standard = formatById("standard");
const expanded = formatById("expanded");

const deckOf = (...entries: [BuilderCard, number][]): Deck =>
  entries.map(([card, quantity]) => ({ card, quantity }));

describe("counts", () => {
  it("totals quantities", () => {
    expect(totalCount(deckOf([charizard, 4], [fireEnergy, 10]))).toBe(14);
    expect(totalCount([])).toBe(0);
  });

  it("splits by supertype", () => {
    const deck = deckOf([charizard, 2], [charmander, 3], [research, 4], [fireEnergy, 8]);
    expect(countsBySupertype(deck)).toEqual({ Pokémon: 5, Trainer: 4, Energy: 8 });
  });

  it("sums copies by name across different prints", () => {
    const deck = deckOf([charizard, 2], [charizardReprint, 1]);
    expect(copiesByName(deck).get("Charizard ex")).toBe(3);
  });

  it("counts only Basic Pokémon", () => {
    const deck = deckOf([charizard, 2], [charmander, 3], [research, 4]);
    expect(basicPokemonCount(deck)).toBe(3);
  });

  it("distributes Pokémon by energy type in wheel order", () => {
    const deck = deckOf([charizard, 2], [squirtle, 1], [research, 4], [fireEnergy, 9]);
    // Fire precedes Water in the wheel; Trainers/Energy don't contribute.
    expect(pokemonTypeDistribution(deck)).toEqual([
      { type: "Fire", count: 2 },
      { type: "Water", count: 1 },
    ]);
  });
});

describe("remainingAllowed", () => {
  it("caps non-energy at the format limit, counting by name", () => {
    expect(remainingAllowed([], charizard, standard)).toBe(4);
    expect(
      remainingAllowed(deckOf([charizard, 2], [charizardReprint, 1]), charizard, standard),
    ).toBe(1);
    expect(remainingAllowed(deckOf([charizard, 4]), charizard, standard)).toBe(0);
  });

  it("exempts basic Energy from the per-name rule but stops at the server's 99-copy cap", () => {
    expect(remainingAllowed(deckOf([fireEnergy, 30]), fireEnergy, standard)).toBe(69);
    expect(remainingAllowed(deckOf([fireEnergy, 99]), fireEnergy, standard)).toBe(0);
  });

  it("allows only one ACE SPEC in total across the deck", () => {
    expect(remainingAllowed([], aceA, standard)).toBe(1);
    expect(remainingAllowed(deckOf([aceA, 1]), aceA, standard)).toBe(0);
    // A different ACE SPEC already occupies the single slot.
    expect(remainingAllowed(deckOf([aceA, 1]), aceB, standard)).toBe(0);
  });
});

describe("validateDeck", () => {
  it("accepts a complete, legal 60-card deck", () => {
    const deck = deckOf([charmander, 4], [charizard, 4], [research, 4], [fireEnergy, 48]);
    const result = validateDeck(deck, standard);
    expect(result.total).toBe(60);
    expect(result.complete).toBe(true);
    expect(result.legal).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("warns (not errors) while under size", () => {
    const result = validateDeck(deckOf([charmander, 1]), standard);
    expect(result.complete).toBe(false);
    expect(result.legal).toBe(false);
    expect(result.issues).toEqual([{ level: "warning", message: "59 more cards to reach 60." }]);
  });

  it("errors when over the size limit", () => {
    const deck = deckOf([charmander, 1], [fireEnergy, 60]);
    const result = validateDeck(deck, standard);
    expect(result.issues).toContainEqual({
      level: "error",
      message: "Deck has 61 cards — 60 is the limit.",
    });
    expect(result.legal).toBe(false);
  });

  it("errors past 4 copies of a name but exempts basic Energy", () => {
    const overCopies = validateDeck(deckOf([charizard, 3], [charizardReprint, 2]), standard);
    expect(overCopies.issues).toContainEqual({
      level: "error",
      message: "5 copies of Charizard ex — max 4.",
    });
    // 20 basic Energy is fine.
    const lotsOfEnergy = validateDeck(deckOf([charmander, 1], [fireEnergy, 20]), standard);
    expect(lotsOfEnergy.issues.some((i) => i.message.includes("Fire Energy"))).toBe(false);
  });

  it("requires at least one Basic Pokémon", () => {
    const result = validateDeck(deckOf([research, 4], [fireEnergy, 10]), standard);
    expect(result.issues).toContainEqual({
      level: "error",
      message: "Add at least 1 Basic Pokémon.",
    });
  });

  it("errors on more than one ACE SPEC in total", () => {
    const deck = deckOf([charmander, 1], [aceA, 1], [aceB, 1], [fireEnergy, 57]);
    const result = validateDeck(deck, standard);
    expect(result.total).toBe(60);
    expect(result.issues).toContainEqual({
      level: "error",
      message: "2 ACE SPEC cards — only 1 is allowed.",
    });
    expect(result.legal).toBe(false);
  });

  it("flags cards out of the format's regulation marks", () => {
    const inStandard = validateDeck(deckOf([rotated, 1]), standard);
    expect(inStandard.issues).toContainEqual({
      level: "error",
      message: "Snom is not legal in Standard.",
    });
    // Expanded has no mark restriction, so the same card raises no legality error.
    const inExpanded = validateDeck(deckOf([rotated, 1]), expanded);
    expect(inExpanded.issues.some((i) => i.message.includes("not legal"))).toBe(false);
  });
});

describe("FORMATS", () => {
  it("exposes Standard and Expanded at 60 cards", () => {
    expect(FORMATS.map((f) => f.id)).toContain("standard");
    expect(FORMATS.every((f) => f.deckSize === 60)).toBe(true);
  });
});
