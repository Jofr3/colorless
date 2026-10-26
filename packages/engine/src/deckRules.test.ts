import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { formatById, savedDeckReasons, validateDeck } from "./deckRules";
import { basicEnergy, basicPokemon, itemTrainer, specialEnergy } from "./fixtures/cards";

const standard = formatById("standard");
const expanded = formatById("expanded");

const pikachu = basicPokemon("pikachu", 1);
const energy = basicEnergy("energy");
const rotated: Card = { ...basicPokemon("old", 1), legal: { standard: false, expanded: true } };
const aceSpec = (id: string): Card => ({ ...itemTrainer(id), rarity: "ACE SPEC Rare" });
const radiant = (name: string): Card => ({ ...basicPokemon(name, 1), name });

/** Four Pikachu, `extra`, and Basic Energy up to 60. */
function deckOf(...extra: [Card, number][]) {
  const used = extra.reduce((sum, [, count]) => sum + count, 4);
  return [
    { card: pikachu, count: 4 },
    ...extra.map(([card, count]) => ({ card, count })),
    { card: energy, count: 60 - used },
  ];
}

describe("validateDeck", () => {
  it("accepts a complete deck with Basic Energy far past the copy limit", () => {
    expect(validateDeck(deckOf(), standard)).toEqual([]);
  });

  it("reports the size in either direction", () => {
    const short = [
      { card: pikachu, count: 4 },
      { card: energy, count: 55 },
    ];
    expect(validateDeck(short, standard)).toEqual(["The deck has 59 cards — it needs exactly 60."]);
    const long = [
      { card: pikachu, count: 4 },
      { card: energy, count: 57 },
    ];
    expect(validateDeck(long, standard)).toEqual(["The deck has 61 cards — it needs exactly 60."]);
  });

  it("counts copies across prints of one name, and exempts only Basic Energy", () => {
    const reprint = { ...pikachu, id: "pikachu-2" };
    expect(validateDeck(deckOf([reprint, 1]), standard)).toEqual(["5 copies of pikachu — max 4."]);
    const special = specialEnergy("special", "Jet Energy", "Switch.");
    expect(validateDeck(deckOf([special, 5]), standard)).toEqual([
      "5 copies of Jet Energy — max 4.",
    ]);
  });

  it("needs a Basic Pokémon", () => {
    expect(validateDeck([{ card: energy, count: 60 }], standard)).toEqual([
      "Add at least 1 Basic Pokémon.",
    ]);
  });

  it("holds ACE SPEC and Radiant cards to one in the whole deck, and Prism Star to one per name", () => {
    expect(validateDeck(deckOf([aceSpec("ace-a"), 1], [aceSpec("ace-b"), 1]), standard)).toEqual([
      "2 ACE SPEC cards — only 1 is allowed.",
    ]);
    expect(
      validateDeck(
        deckOf([radiant("Radiant Greninja"), 1], [radiant("Radiant Charizard"), 1]),
        standard,
      ),
    ).toEqual(["2 Radiant Pokémon — only 1 is allowed."]);
    expect(validateDeck(deckOf([radiant("Diancie ◇"), 2]), standard)).toEqual([
      "2 copies of Diancie ◇ — Prism Star cards are limited to 1.",
    ]);
  });

  it("reads the card's verdict for the format", () => {
    expect(validateDeck(deckOf([rotated, 4]), standard)).toEqual(["old is not legal in Standard."]);
    expect(validateDeck(deckOf([rotated, 4]), expanded)).toEqual([]);
  });
});

describe("savedDeckReasons", () => {
  const pool = { pikachu, energy, old: rotated };
  const cards = [
    { cardId: "pikachu", count: 4 },
    { cardId: "old", count: 4 },
    { cardId: "energy", count: 52 },
  ];

  it("judges a saved deck in its own format, with no format or an unknown one playing Standard", () => {
    expect(savedDeckReasons(cards, "expanded", pool)).toEqual([]);
    expect(savedDeckReasons(cards, null, pool)).toEqual(["old is not legal in Standard."]);
    expect(savedDeckReasons(cards, "unlimited", pool)).toEqual(["old is not legal in Standard."]);
  });

  it("reports a card missing from the pool", () => {
    expect(savedDeckReasons(cards, "expanded", { pikachu, energy })).toEqual([
      "The deck has a card that's no longer in the catalog.",
    ]);
  });
});
