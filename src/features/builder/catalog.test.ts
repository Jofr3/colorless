import type { CardBrief } from "@luminous/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FORMAT, formatById } from "./cards";
import { filtersToCardsQuery, findCardByName, toBuilderCard } from "./catalog";
import { DEFAULT_FILTERS, type Filters } from "./poolFilter";

// Catalog-shaped fixtures (the wire vocabulary: unaccented category, tcgdex
// "Stage1"/"Tool"/"Normal" subtypes, null off-category fields).
const brief = (over: Partial<CardBrief>): CardBrief => ({
  id: "sv06.5-001",
  name: "Joltik",
  category: "Pokemon",
  rarity: "Common",
  image: "/assets/cards/sv06.5-001",
  setId: "sv06.5",
  localId: "001",
  types: ["Grass"],
  hp: 40,
  regulationMark: "H",
  stage: "Basic",
  trainerType: null,
  energyType: null,
  ...over,
});

const expanded = formatById("expanded");

describe("toBuilderCard", () => {
  it("maps a Pokémon brief to the builder vocabulary (accent, spaced stages)", () => {
    const card = toBuilderCard(
      brief({ stage: "Stage1", types: ["Lightning"], hp: 110, name: "Galvantula" }),
    );
    expect(card).toEqual({
      cardId: "sv06.5-001",
      name: "Galvantula",
      supertype: "Pokémon",
      subtype: "Stage 1",
      types: ["Lightning"],
      hp: 110,
      regulationMark: "H",
      rarity: "Common",
      number: "001",
      hasImage: true,
    });
  });

  it("renames Trainer 'Tool' and the Energy 'Normal'/'Special' subtypes", () => {
    const tool = toBuilderCard(
      brief({ category: "Trainer", stage: null, types: null, hp: null, trainerType: "Tool" }),
    );
    expect(tool.supertype).toBe("Trainer");
    expect(tool.subtype).toBe("Pokémon Tool");

    const basic = toBuilderCard(
      brief({ category: "Energy", stage: null, types: null, hp: null, energyType: "Normal" }),
    );
    expect(basic.subtype).toBe("Basic Energy");

    const special = toBuilderCard(
      brief({ category: "Energy", stage: null, types: null, hp: null, energyType: "Special" }),
    );
    expect(special.subtype).toBe("Special Energy");
  });

  it("passes unknown printed subtypes through verbatim", () => {
    expect(toBuilderCard(brief({ stage: "VMAX" })).subtype).toBe("VMAX");
  });

  it("turns nulls into absent fields and image null into hasImage: false", () => {
    const card = toBuilderCard(
      brief({
        category: "Energy",
        rarity: null,
        image: null,
        regulationMark: null,
        stage: null,
        types: null,
        hp: null,
        energyType: "Normal",
      }),
    );
    expect(card.types).toBeUndefined();
    expect(card.hp).toBeUndefined();
    expect(card.rarity).toBeUndefined();
    expect(card.regulationMark).toBeUndefined();
    expect(card.hasImage).toBe(false);
    expect(card.subtype).toBe("Basic Energy");
  });

  it("drops energy-type strings the palette doesn't know rather than inventing them", () => {
    expect(toBuilderCard(brief({ types: ["Grass", "Fairy"] })).types).toEqual(["Grass"]);
    expect(toBuilderCard(brief({ types: ["Fairy"] })).types).toBeUndefined();
  });
});

describe("filtersToCardsQuery", () => {
  const f = (over: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...over });

  it("maps the defaults to Standard legality + name sort only", () => {
    expect(filtersToCardsQuery(DEFAULT_FILTERS, DEFAULT_FORMAT)).toEqual({
      name: undefined,
      category: undefined,
      type: undefined,
      rarity: undefined,
      legal: "standard",
      sort: "name",
    });
  });

  it("translates each dimension — accent-mapped category, arrays for the OR dimensions", () => {
    const query = filtersToCardsQuery(
      f({
        query: "  joltik ",
        supertype: "Pokémon",
        types: ["Fire", "Water"],
        rarities: ["Double rare"],
        sort: "hp-desc",
      }),
      DEFAULT_FORMAT,
    );
    expect(query).toEqual({
      name: "joltik",
      category: "Pokemon",
      type: ["Fire", "Water"],
      rarity: ["Double rare"],
      legal: "standard",
      sort: "hp-desc",
    });
  });

  it("keeps `subtypes` (card kinds) OUT of the wire query — client-side by design", () => {
    const query = filtersToCardsQuery(f({ subtypes: ["Evolution", "EX"] }), DEFAULT_FORMAT);
    expect("subtypes" in query).toBe(false);
    expect(Object.values(query).filter((v) => v !== undefined)).toEqual(["standard", "name"]);
  });

  it("sends legal=standard only when the toggle is on AND the format is Standard", () => {
    expect(filtersToCardsQuery(f({ legalOnly: false }), DEFAULT_FORMAT).legal).toBeUndefined();
    expect(filtersToCardsQuery(DEFAULT_FILTERS, expanded).legal).toBeUndefined();
  });
});

describe("findCardByName", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const page = (items: CardBrief[]) =>
    new Response(JSON.stringify({ items, page: 1, pageSize: 100, total: items.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("searches by normalized name and keeps only the exact match", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(page([brief({ name: "Joltik Rocker" }), brief({ name: "Joltik" })]));
    vi.stubGlobal("fetch", mock);

    const card = await findCardByName("Basic  JOLTIK"); // prefix + case + spacing noise
    expect(card?.name).toBe("Joltik");
    expect(mock.mock.calls[0]?.[0]).toBe("http://localhost:8787/cards?name=joltik&pageSize=100");
  });

  it("resolves undefined when nothing matches exactly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page([brief({ name: "Joltik Rocker" })])));
    await expect(findCardByName("Joltik")).resolves.toBeUndefined();
  });
});
