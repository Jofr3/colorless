import { describe, expect, it } from "vitest";
import { builderCard } from "../../test/fixtures";
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

const charizard = builderCard({
  cardId: "obf-125",
  name: "Charizard ex",
  supertype: "Pokémon",
  subtype: "Stage 2",
  types: ["Fire"],
  hp: 330,
  regulationMark: "H",
});
// A second print of the same name — copies count by name, across prints.
const charizardReprint: BuilderCard = { ...charizard, cardId: "mew-6", number: "006" };
const charmander = builderCard({
  cardId: "obf-26",
  name: "Charmander",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Fire"],
  hp: 70,
  regulationMark: "H",
});
const squirtle = builderCard({
  cardId: "mew-7",
  name: "Squirtle",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Water"],
  hp: 60,
  regulationMark: "H",
});
const research = builderCard({
  cardId: "svi-189",
  name: "Professor's Research",
  supertype: "Trainer",
  subtype: "Supporter",
  regulationMark: "H",
});
// Two distinct ACE SPEC cards — only one ACE SPEC is allowed per deck, total.
const aceA = builderCard({
  cardId: "sv5-119",
  name: "Prime Catcher",
  supertype: "Trainer",
  subtype: "Item",
  regulationMark: "H",
  rarity: "ACE SPEC Rare",
});
const aceB = builderCard({
  cardId: "sv6-167",
  name: "Legacy Energy",
  supertype: "Energy",
  subtype: "Special Energy",
  regulationMark: "H",
  rarity: "ACE SPEC Rare",
});
const fireEnergy = builderCard({
  cardId: "sve-2",
  name: "Fire Energy",
  supertype: "Energy",
  subtype: "Basic Energy",
  types: ["Fire"],
});
// A rotated-out card: mark "F", so the fixture factory derives standard:false
// for it (D191 — the derivation happens once, at construction; the validator
// itself knows only the verdict).
const rotated = builderCard({
  cardId: "swsh1-1",
  name: "Snom",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Water"],
  hp: 60,
  regulationMark: "F",
});
// The verdict is the whole rule: these two spell `legal` out, contradicting
// what their printed mark would have derived, and the verdict wins.
const promoOnlyExpanded = builderCard({
  cardId: "svp-001",
  name: "Sprigatito",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Grass"],
  hp: 70,
  regulationMark: "H", // the mark alone would pass Standard
  legal: { standard: false, expanded: true },
});
const oldMarkStillLegal = builderCard({
  cardId: "swsh1-2",
  name: "Frosmoth",
  supertype: "Pokémon",
  subtype: "Stage 1",
  types: ["Water"],
  hp: 90,
  regulationMark: "F", // the mark alone would fail Standard
  legal: { standard: true, expanded: true },
});
const nowhereLegal = builderCard({
  cardId: "sm1-1",
  name: "Forest of Giant Plants",
  supertype: "Trainer",
  subtype: "Stadium",
  legal: { standard: false, expanded: false },
});
// The name-defined single-copy classes: Radiant Pokémon ("Radiant X") and
// Prism Star (tcgdex "X ◇"; some sources spell out "X Prism Star").
const radiantGreninja = builderCard({
  cardId: "swsh9-46",
  name: "Radiant Greninja",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Water"],
  hp: 130,
  regulationMark: "F",
});
const radiantCharizard = builderCard({
  cardId: "swsh10.5-11",
  name: "Radiant Charizard",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Fire"],
  hp: 160,
  regulationMark: "F",
});
const dittoPrism = builderCard({
  cardId: "sm9-154",
  name: "Ditto ◇",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Colorless"],
  hp: 40,
});
const lunalaPrismSpelled = builderCard({
  cardId: "sm5-62",
  name: "Lunala Prism Star",
  supertype: "Pokémon",
  subtype: "Basic",
  types: ["Psychic"],
  hp: 160,
});

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

  it("allows only one Radiant Pokémon in total across the deck", () => {
    expect(remainingAllowed([], radiantGreninja, expanded)).toBe(1);
    expect(remainingAllowed(deckOf([radiantGreninja, 1]), radiantGreninja, expanded)).toBe(0);
    // Like ACE SPEC, a different Radiant already occupies the single slot.
    expect(remainingAllowed(deckOf([radiantGreninja, 1]), radiantCharizard, expanded)).toBe(0);
  });

  it("caps Prism Star cards at one copy of the name", () => {
    expect(remainingAllowed(deckOf([dittoPrism, 1]), dittoPrism, expanded)).toBe(0);
    expect(remainingAllowed(deckOf([lunalaPrismSpelled, 1]), lunalaPrismSpelled, expanded)).toBe(0);
    // Unlike Radiant/ACE SPEC, the limit is per NAME — another Prism still fits.
    expect(remainingAllowed(deckOf([dittoPrism, 1]), lunalaPrismSpelled, expanded)).toBe(1);
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

  it("errors on more than one Radiant Pokémon in total", () => {
    // Two copies of one name and one-each of two names are the same offence.
    const sameName = validateDeck(deckOf([radiantGreninja, 2]), expanded);
    expect(sameName.issues).toContainEqual({
      level: "error",
      message: "2 Radiant Pokémon — only 1 is allowed.",
    });
    const distinctNames = validateDeck(
      deckOf([radiantGreninja, 1], [radiantCharizard, 1]),
      expanded,
    );
    expect(distinctNames.issues).toContainEqual({
      level: "error",
      message: "2 Radiant Pokémon — only 1 is allowed.",
    });
    // The deck-wide message SUPERSEDES the per-name cap — never both.
    const wayOver = validateDeck(deckOf([radiantGreninja, 5]), expanded);
    expect(wayOver.issues.some((i) => i.message.includes("copies of"))).toBe(false);
  });

  it("errors past one copy of a Prism Star name, naming the class", () => {
    const result = validateDeck(deckOf([dittoPrism, 3]), expanded);
    expect(result.issues).toContainEqual({
      level: "error",
      message: "3 copies of Ditto ◇ — Prism Star cards are limited to 1.",
    });
    // The single-copy message SUPERSEDES the per-name cap — never both.
    const wayOver = validateDeck(deckOf([dittoPrism, 5]), expanded);
    expect(wayOver.issues.filter((i) => i.message.includes("copies of"))).toHaveLength(1);
  });

  it("accepts one Radiant plus one copy each of distinct Prism Star names", () => {
    const deck = deckOf([radiantGreninja, 1], [dittoPrism, 1], [lunalaPrismSpelled, 1]);
    const result = validateDeck(deck, expanded);
    expect(result.issues.some((i) => i.message.includes("limited to 1"))).toBe(false);
    expect(result.issues.some((i) => i.message.includes("only 1 is allowed"))).toBe(false);
  });

  it("judges legality by the catalog's legal flags, never by the mark", () => {
    // Mark H would pass Standard, but the catalog says standard: false.
    const flagged = validateDeck(deckOf([promoOnlyExpanded, 1]), standard);
    expect(flagged.issues).toContainEqual({
      level: "error",
      message: "Sprigatito is not legal in Standard.",
    });
    // Mark F would fail Standard, but the catalog says standard: true.
    const cleared = validateDeck(deckOf([oldMarkStillLegal, 1]), standard);
    expect(cleared.issues.some((i) => i.message.includes("not legal"))).toBe(false);
  });

  it("gates Expanded on legal.expanded, the same one bit under a different key", () => {
    const result = validateDeck(deckOf([nowhereLegal, 1]), expanded);
    expect(result.issues).toContainEqual({
      level: "error",
      message: "Forest of Giant Plants is not legal in Expanded.",
    });
  });

  it("fails a rotated-out mark in Standard but not in Expanded", () => {
    // Same card, same single verdict, two keys: the fixture's mark "F" derived
    // {standard: false, expanded: true} at construction (test/fixtures.ts —
    // the ONE site a rotation edits now), and validateDeck just reads the key
    // the format names. Every Expanded-legality claim here is measured: all
    // 3,786 catalog rows carry legal_expanded = 1 (see test/legality.test.ts).
    const inStandard = validateDeck(deckOf([rotated, 1]), standard);
    expect(inStandard.issues).toContainEqual({
      level: "error",
      message: "Snom is not legal in Standard.",
    });
    const inExpanded = validateDeck(deckOf([rotated, 1]), expanded);
    expect(inExpanded.issues.some((i) => i.message.includes("not legal"))).toBe(false);
  });
});

describe("FORMATS", () => {
  it("exposes Standard and Expanded at 60 cards", () => {
    expect(FORMATS.map((f) => f.id)).toContain("standard");
    expect(FORMATS.every((f) => f.deckSize === 60)).toBe(true);
  });

  it("maps each format to its card.legal flag (validator + rail share it)", () => {
    expect(formatById("standard").legalFlag).toBe("standard");
    expect(formatById("expanded").legalFlag).toBe("expanded");
  });
});
