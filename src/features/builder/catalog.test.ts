import { afterEach, describe, expect, it, vi } from "vitest";
import { json } from "../../test/fetchStub";
import { cardBrief as brief, cardsPage, FACETS } from "../../test/fixtures";
import { DEFAULT_FORMAT, formatById } from "./cards";
import { filtersToCardsQuery, findCardByName, kindOptions, toBuilderCard } from "./catalog";
import { DEFAULT_FILTERS, type Filters } from "./poolFilter";

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
      legal: { standard: true, expanded: true },
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

  it("carries the catalog's structured legality verdict", () => {
    const card = toBuilderCard(brief({ legal: { standard: false, expanded: true } }));
    expect(card.legal).toEqual({ standard: false, expanded: true });
  });
});

describe("kindOptions", () => {
  it("offers the facet vocabulary in builder labels, plus derived kinds for Pokémon", () => {
    expect(kindOptions("Pokémon", FACETS)).toEqual(["Basic", "Stage 1", "Stage 2", "EX", "Mega"]);
    expect(kindOptions("Trainer", FACETS)).toEqual([
      "Item",
      "Stadium",
      "Supporter",
      "Pokémon Tool",
    ]);
    expect(kindOptions("Energy", FACETS)).toEqual(["Basic Energy", "Special Energy"]);
    expect(kindOptions("all", FACETS)).toEqual([]);
  });

  it("degrades to just the derived kinds when facets are unavailable", () => {
    expect(kindOptions("Pokémon", null)).toEqual(["EX", "Mega"]);
    expect(kindOptions("Trainer", null)).toEqual([]);
  });
});

describe("filtersToCardsQuery", () => {
  const f = (over: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...over });

  it("maps the defaults to Standard legality + name sort only", () => {
    const query = filtersToCardsQuery(DEFAULT_FILTERS, DEFAULT_FORMAT);
    expect(query).toEqual({ legal: "standard", sort: "name" });
    expect(Object.values(query).filter((v) => v !== undefined)).toEqual(["standard", "name"]);
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

  it("maps the richer dimensions — set/serie/illustrator/mark verbatim, trimmed text", () => {
    const query = filtersToCardsQuery(
      f({
        setId: "sv06",
        serieId: "sv",
        illustrator: "5ban Graphics",
        regulationMark: "H",
        text: "  discard ",
      }),
      DEFAULT_FORMAT,
    );
    expect(query.set).toBe("sv06");
    expect(query.serie).toBe("sv");
    expect(query.illustrator).toBe("5ban Graphics");
    expect(query.regulationMark).toBe("H");
    expect(query.text).toBe("discard");
  });

  it("parses the HP bounds, dropping empty/garbage/negative input instead of 400ing", () => {
    expect(filtersToCardsQuery(f({ hpMin: "120", hpMax: "200" }), DEFAULT_FORMAT)).toMatchObject({
      hpMin: 120,
      hpMax: 200,
    });
    const dropped = filtersToCardsQuery(f({ hpMin: "abc", hpMax: "-30" }), DEFAULT_FORMAT);
    expect(dropped.hpMin).toBeUndefined();
    expect(dropped.hpMax).toBeUndefined();
  });

  it("sends printed kinds on the supertype's own subtype dimension, wire-renamed", () => {
    const pokemon = filtersToCardsQuery(
      f({ supertype: "Pokémon", subtypes: ["Basic", "Stage 1"] }),
      DEFAULT_FORMAT,
    );
    expect(pokemon.stage).toEqual(["Basic", "Stage1"]);
    expect(pokemon.trainerType).toBeUndefined();
    expect(pokemon.energyType).toBeUndefined();

    const trainer = filtersToCardsQuery(
      f({ supertype: "Trainer", subtypes: ["Item", "Pokémon Tool"] }),
      DEFAULT_FORMAT,
    );
    expect(trainer.trainerType).toEqual(["Item", "Tool"]);
    expect(trainer.stage).toBeUndefined();

    const energy = filtersToCardsQuery(
      f({ supertype: "Energy", subtypes: ["Basic Energy"] }),
      DEFAULT_FORMAT,
    );
    expect(energy.energyType).toEqual(["Normal"]);
  });

  it("keeps the WHOLE kind dimension off the wire when a derived kind is selected", () => {
    // "Basic OR EX" can't be half server-side — poolFilter.filterVisibleCards
    // applies the whole selection per page instead.
    const query = filtersToCardsQuery(
      f({ supertype: "Pokémon", subtypes: ["Basic", "EX"] }),
      DEFAULT_FORMAT,
    );
    expect(query.stage).toBeUndefined();
    expect(query.trainerType).toBeUndefined();
    expect(query.energyType).toBeUndefined();
  });

  it("maps legalOnly to the ACTIVE format's legality flag — the validator's key", () => {
    expect(filtersToCardsQuery(DEFAULT_FILTERS, DEFAULT_FORMAT).legal).toBe("standard");
    expect(filtersToCardsQuery(DEFAULT_FILTERS, expanded).legal).toBe("expanded");
    expect(filtersToCardsQuery(f({ legalOnly: false }), DEFAULT_FORMAT).legal).toBeUndefined();
    expect(filtersToCardsQuery(f({ legalOnly: false }), expanded).legal).toBeUndefined();
  });
});

describe("findCardByName", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the exact name (normalized key) and keeps only an exact-key match", async () => {
    const mock = vi.fn().mockResolvedValue(json(cardsPage([brief({ name: "Joltik" })])));
    vi.stubGlobal("fetch", mock);

    const card = await findCardByName("Basic  JOLTIK"); // prefix + case + spacing noise
    expect(card?.name).toBe("Joltik");
    expect(mock.mock.calls[0]?.[0]).toBe(
      "http://localhost:8787/cards?nameExact=joltik&pageSize=100",
    );
  });

  it("retries nameExact with the unstripped name — a print STORED as 'Basic …' has no plain match", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(cardsPage([]))) // layer 1: the stripped key misses
      .mockResolvedValueOnce(json(cardsPage([brief({ name: "Basic Grass Energy" })])));
    vi.stubGlobal("fetch", mock);

    const card = await findCardByName("Basic Grass Energy");
    expect(card?.name).toBe("Basic Grass Energy");
    expect(mock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://localhost:8787/cards?nameExact=grass+energy&pageSize=100",
      "http://localhost:8787/cards?nameExact=Basic+Grass+Energy&pageSize=100",
    ]);
  });

  it("falls back to the substring search for a stored name only the key can bridge", async () => {
    // The stored name carries a doubled space, so neither nameExact layer can
    // equal it — the substring page plus the normalized-key guard reaches it.
    // (The unstripped retry is skipped: the raw name only differs by case.)
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(cardsPage([])))
      .mockResolvedValueOnce(json(cardsPage([brief({ name: "Iron  Hands ex" })])));
    vi.stubGlobal("fetch", mock);

    const card = await findCardByName("Iron Hands ex");
    expect(card?.name).toBe("Iron  Hands ex");
    expect(mock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://localhost:8787/cards?nameExact=iron+hands+ex&pageSize=100",
      "http://localhost:8787/cards?name=iron+hands+ex&pageSize=100",
    ]);
  });

  it("resolves undefined when nothing matches", async () => {
    // Fresh Response per layer — a Response body reads once.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => json(cardsPage([]))),
    );
    await expect(findCardByName("Joltik")).resolves.toBeUndefined();
  });

  it("keeps the normalized-key guard — a response row that isn't an exact key match is dropped", async () => {
    // Belt and braces: nameExact should only return exact names, but the
    // client still refuses to hand back a card whose normalized key differs —
    // on EVERY layer, the substring fallback included.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => json(cardsPage([brief({ name: "Joltik Rocker" })]))),
    );
    await expect(findCardByName("Joltik")).resolves.toBeUndefined();
  });
});
