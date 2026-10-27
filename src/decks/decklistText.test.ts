import { describe, expect, it, vi } from "vitest";
import { builderCard } from "../test/fixtures";
import type { BuilderCard } from "./cards";
import type { Deck } from "./deckMath";
import {
  cardSetLabel,
  choosePrint,
  DECKLIST_LOOKUP_CONCURRENCY,
  formatDecklist,
  MAX_DECKLIST_LINE_LENGTH,
  nameKey,
  numberKey,
  parseDecklist,
  preferArt,
  resolveDecklist,
  splitCardId,
  splitPrint,
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
  hasImage: false, // tcgdex has no art for the energy-only sets
});
// The sv full-art print of the same basic Energy — the one with art.
const fireEnergyArt = builderCard({
  cardId: "sv03-230",
  name: "Basic Fire Energy",
  supertype: "Energy",
  subtype: "Basic Energy",
  types: ["Fire"],
  number: "230",
  rarity: "Hyper rare",
  hasImage: true,
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

// A reprint of Charmander in a later set: the same name, a different print.
const charmanderReprint: BuilderCard = { ...charmander, cardId: "sv08.5-109", number: "109" };

const pool = [
  charizard,
  charmander,
  charmanderReprint,
  research,
  fireEnergy,
  fireEnergyArt,
  ironHands,
];
const deckOf = (...entries: [BuilderCard, number][]): Deck =>
  entries.map(([card, quantity]) => ({ card, quantity }));

/** A catalog-shaped async lookup over the fixture pool — exact match on the
    normalized name, like catalog.ts's findCardsByName. Tests never touch the
    network. */
const findInPool = (name: string): Promise<BuilderCard[]> =>
  Promise.resolve(pool.filter((card) => nameKey(card.name) === nameKey(name)));
/** PTCGL-style set codes for the fixture sets, like catalog.ts's setIdsByCode. */
const codes: Record<string, string> = { OBF: "sv03", PRE: "sv08.5", SVI: "sv01", SVE: "sve" };
const setIdForCode = (code: string) => codes[code.toUpperCase()];

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
    expect(byId).toEqual({ "sv03-125": 4, "sv03-026": 4, "sv01-189": 1, "sv03-230": 5 });
  });

  it("stands a basic Energy print with art in for a named print without", async () => {
    const named = await resolveDecklist(parseDecklist("5 Fire Energy SVE 2"), findInPool, {
      setIdForCode,
    });
    expect(named.entries).toEqual([{ card: fireEnergyArt, quantity: 5 }]);
    const plain = await resolveDecklist(parseDecklist("5 Fire Energy"), findInPool);
    expect(plain.entries).toEqual([{ card: fireEnergyArt, quantity: 5 }]);
    // Only basic Energy swaps; and only when the named print lacks art.
    const artless = [fireEnergy];
    expect(preferArt(artless, fireEnergy)).toBe(fireEnergy);
    expect(preferArt([charmander, charmanderReprint], { ...charmander, hasImage: false })).toEqual({
      ...charmander,
      hasImage: false,
    });
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

  it("picks the print a set code and number name, across reprints", async () => {
    const text = ["2 Charmander PRE 109", "2 Charmander OBF 26"].join("\n");
    const { entries, unmatched } = await resolveDecklist(parseDecklist(text), findInPool, {
      setIdForCode,
    });
    expect(unmatched).toHaveLength(0);
    expect(entries).toEqual([
      { card: charmanderReprint, quantity: 2 },
      { card: charmander, quantity: 2 },
    ]);
  });

  it("matches our own export's upper-cased set ids without a code map", async () => {
    const { entries } = await resolveDecklist(parseDecklist("3 Charmander SV08.5 109"), findInPool);
    expect(entries).toEqual([{ card: charmanderReprint, quantity: 3 }]);
  });

  it("falls back to the named set, then to the first print", async () => {
    const inSet = await resolveDecklist(parseDecklist("1 Charmander PRE 999"), findInPool, {
      setIdForCode,
    });
    expect(inSet.entries).toEqual([{ card: charmanderReprint, quantity: 1 }]);
    const unknownSet = await resolveDecklist(parseDecklist("1 Charmander XYZ 1"), findInPool, {
      setIdForCode,
    });
    expect(unknownSet.entries).toEqual([{ card: charmander, quantity: 1 }]);
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

  it("asks for the stripped names of every line that missed at once, not line by line", async () => {
    // Only the stripped lookups count: the full-name wave is concurrent anyway.
    let inFlight = 0;
    let most = 0;
    const lookup = async (name: string) => {
      if (/\d$/.test(name)) return findInPool(name);
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return findInPool(name);
    };
    const { unmatched } = await resolveDecklist(
      parseDecklist("4 Charmander OBF 26\n4 Charizard ex OBF 125\n1 Professor's Research SVI 189"),
      lookup,
    );
    expect(unmatched).toEqual([]);
    expect(most).toBe(3);
  });

  it("tries the loose lookup only after the full and the stripped exact lookups miss", async () => {
    const loose = vi.fn(findInPool);
    const { entries, unmatched } = await resolveDecklist(
      parseDecklist("4 Charmander OBF 26\n3 Mystery Card ABC 9\n1 Unknown"),
      findInPool,
      { findLoosely: loose },
    );
    expect(entries).toEqual([{ card: charmander, quantity: 4 }]);
    expect(unmatched.map((line) => line.name)).toEqual(["Mystery Card", "Unknown"]);
    expect(loose.mock.calls.map(([name]) => name)).toEqual(["Mystery Card", "Unknown"]);
  });

  it("rejects when a lookup throws — an api failure is not 'unmatched'", async () => {
    const failing = () => Promise.reject(new Error("api down"));
    await expect(resolveDecklist(parseDecklist("2 Charmander"), failing)).rejects.toThrow(
      "api down",
    );
  });

  it("round-trips a deck through format → parse → resolve", async () => {
    const deck = deckOf([charizard, 4], [charmander, 4], [research, 2], [fireEnergyArt, 6]);
    const { entries, unmatched } = await resolveDecklist(
      parseDecklist(formatDecklist(deck)),
      findInPool,
    );
    expect(unmatched).toHaveLength(0);
    const byId = Object.fromEntries(entries.map((e) => [e.card.cardId, e.quantity]));
    expect(byId).toEqual({ "sv03-125": 4, "sv03-026": 4, "sv01-189": 2, "sv03-230": 6 });
  });
});

describe("choosePrint / numberKey / splitCardId", () => {
  it("compares collector numbers without leading zeros or case", () => {
    expect(numberKey("080")).toBe("80");
    expect(numberKey("tg01")).toBe("TG01");
    expect(numberKey("0")).toBe("0");
  });
  it("splits hyphenated set ids at the last hyphen", () => {
    expect(splitCardId("30th-c-005")).toEqual({ set: "30th-c", number: "005" });
    expect(splitCardId("sv06.5-001")).toEqual({ set: "sv06.5", number: "001" });
  });
  it("returns the only print without consulting the reference", () => {
    expect(choosePrint([charizard], { set: "XYZ", number: "1" })).toBe(charizard);
    expect(choosePrint([], { set: "XYZ", number: "1" })).toBeUndefined();
  });
});

describe("splitPrint", () => {
  it("peels the last two tokens as a set code and a number", () => {
    expect(splitPrint("Rocky Helmet SVI 193")).toEqual({
      name: "Rocky Helmet",
      print: { set: "SVI", number: "193" },
    });
    expect(splitPrint("Iono  PR-SV   124")).toEqual({
      name: "Iono",
      print: { set: "PR-SV", number: "124" },
    });
    expect(splitPrint("Pikachu SV10.5B 001").print?.set).toBe("SV10.5B");
  });

  it("reads a set code that starts with a digit, as the app's own export writes", () => {
    expect(splitPrint("Pikachu 30TH 023")).toEqual({
      name: "Pikachu",
      print: { set: "30TH", number: "023" },
    });
  });

  it("leaves a name without a set and number whole", () => {
    for (const name of ["Pikachu 023", "Boss's Orders", "Mew", "A TOOLONGSET 1", "A B !"]) {
      expect(splitPrint(name)).toEqual({ name });
    }
  });

  it("takes linear time on a long pasted line", () => {
    // The old pattern's lazy prefix took about a second on this.
    const line = `${"a ".repeat(15_000)}!`;
    const started = performance.now();
    expect(splitPrint(line)).toEqual({ name: line });
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe("decklist import limits", () => {
  it("imports its own export of a set whose id starts with a digit", async () => {
    const pikachu = builderCard({
      cardId: "30th-023",
      name: "Pikachu",
      supertype: "Pokémon",
      subtype: "Basic",
      types: ["Lightning"],
    });
    const find = (name: string) =>
      Promise.resolve([pikachu].filter((card) => nameKey(card.name) === nameKey(name)));
    const text = formatDecklist(deckOf([pikachu, 2]));
    expect(text).toContain("2 Pikachu 30TH 023");
    const { entries, unmatched } = await resolveDecklist(parseDecklist(text), find);
    expect(unmatched).toEqual([]);
    expect(entries).toEqual([{ card: pikachu, quantity: 2 }]);
  });

  it("reports a line longer than MAX_DECKLIST_LINE_LENGTH unknown without looking it up", async () => {
    const find = vi.fn(findInPool);
    const long = `1 ${"X".repeat(MAX_DECKLIST_LINE_LENGTH)}`;
    const { entries, unmatched } = await resolveDecklist(
      parseDecklist(`${long}\n2 Charmander`),
      find,
    );
    expect(entries).toEqual([{ card: charmander, quantity: 2 }]);
    expect(unmatched).toEqual([{ quantity: 1, name: `${"X".repeat(24)}...`, raw: long }]);
    expect(find.mock.calls.map(([name]) => name)).toEqual(["Charmander"]);
  });

  it(`runs at most ${DECKLIST_LOOKUP_CONCURRENCY} lookups at once`, async () => {
    let active = 0;
    let most = 0;
    const find = async (name: string) => {
      active++;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return findInPool(name);
    };
    const text = Array.from({ length: 40 }, (_, index) => `1 Card ${index}`).join("\n");
    const { unmatched } = await resolveDecklist(parseDecklist(text), find, {
      findLoosely: find,
    });
    expect(unmatched).toHaveLength(40);
    expect(most).toBe(DECKLIST_LOOKUP_CONCURRENCY);
  });
});
