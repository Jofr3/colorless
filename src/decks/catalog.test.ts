import { afterEach, describe, expect, it, vi } from "vitest";
import { json } from "../test/fetchStub";
import { cardBrief as brief, cardsPage, FACETS } from "../test/fixtures";
import type { Card } from "@colorless/schema";
import { DEFAULT_FORMAT, formatById, isBasicEnergy } from "./cards";
import { validateDeck } from "./deckMath";
import {
  filtersToCardsQuery,
  findCardsByName,
  kindOptions,
  suffixOptions,
  toBuilderCard,
} from "./catalog";
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

  it("D628 (finding 0b): an Energy's subtype is the ENGINE's Basic / Special answer, so a 'Normal'-tagged Special Energy is capped at 4", () => {
    const ignition: Card = {
      ...brief({ category: "Energy", stage: null, types: null, hp: null, energyType: "Normal" }),
      id: "me02-124",
      setId: "me02",
      localId: "124",
      name: "Ignition Energy",
      illustrator: null,
      evolveFrom: null,
      retreat: null,
      abilities: null,
      attacks: null,
      weaknesses: null,
      resistances: null,
      effect:
        "If this card is attached to 1 of your Pokémon, discard it at the end of your turn.\n\nAs long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to an Evolution Pokémon, it provides {C}{C}{C} Energy instead.",
      variants: null,
    };
    const special = toBuilderCard(ignition);
    expect(special.subtype).toBe("Special Energy");
    expect(isBasicEnergy(special)).toBe(false);
    // A brief carries the API's answer to the same test (catalog/map.ts): "Special" stays Special.
    expect(
      toBuilderCard(
        brief({ category: "Energy", stage: null, types: null, hp: null, energyType: "Special" }),
      ).subtype,
    ).toBe("Special Energy");
    // A Basic Energy face (no rules text) is still Basic and still exempt.
    const fire = toBuilderCard({ ...ignition, id: "sve-002", name: "Fire Energy", effect: null });
    expect(fire.subtype).toBe("Basic Energy");
    const standard = formatById("standard");
    expect(validateDeck([{ card: special, quantity: 5 }], standard).issues).toContainEqual({
      level: "error",
      message: "5 copies of Ignition Energy — max 4.",
    });
    expect(
      validateDeck([{ card: fire, quantity: 5 }], standard).issues.some((i) =>
        i.message.includes("Fire Energy"),
      ),
    ).toBe(false);
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
  it("offers the facet vocabulary in builder labels — every label server-filterable", () => {
    expect(kindOptions("Pokémon", FACETS)).toEqual(["Basic", "Stage 1", "Stage 2"]);
    expect(kindOptions("Trainer", FACETS)).toEqual([
      "Item",
      "Stadium",
      "Supporter",
      "Pokémon Tool",
    ]);
    expect(kindOptions("Energy", FACETS)).toEqual(["Basic Energy", "Special Energy"]);
    expect(kindOptions("all", FACETS)).toEqual([]);
  });

  it("offers nothing at all when facets are unavailable — the rail hides the section", () => {
    expect(kindOptions("Pokémon", null)).toEqual([]);
    expect(kindOptions("Trainer", null)).toEqual([]);
  });
});

describe("suffixOptions", () => {
  it("serves the rule-box vocabulary VERBATIM — the chip label is the wire value", () => {
    expect(suffixOptions("Pokémon", FACETS)).toEqual(["MEGA", "V", "ex"]);
    // "all" keeps them: they narrow to Pokémon, which is what the data means.
    expect(suffixOptions("all", FACETS)).toEqual(["MEGA", "V", "ex"]);
  });

  it("offers none where a suffix cannot exist — ingest writes NULL off-Pokémon", () => {
    expect(suffixOptions("Trainer", FACETS)).toEqual([]);
    expect(suffixOptions("Energy", FACETS)).toEqual([]);
  });

  it("IS EMPTY FOR THE LIVE CATALOG — the whole degradation story", () => {
    expect(suffixOptions("Pokémon", { ...FACETS, suffixes: [] })).toEqual([]);
    expect(suffixOptions("Pokémon", null)).toEqual([]);
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

  it("sends rule-box markers as their OWN dimension, alongside the kind chips", () => {
    const query = filtersToCardsQuery(
      f({ supertype: "Pokémon", subtypes: ["Basic"], suffixes: ["ex"] }),
      DEFAULT_FORMAT,
    );
    expect(query.stage).toEqual(["Basic"]);
    expect(query.suffix).toEqual(["ex"]);
  });

  it("ORs repeated markers within the dimension and omits an empty selection", () => {
    expect(filtersToCardsQuery(f({ suffixes: ["ex", "MEGA"] }), DEFAULT_FORMAT).suffix).toEqual([
      "ex",
      "MEGA",
    ]);
    expect(filtersToCardsQuery(DEFAULT_FILTERS, DEFAULT_FORMAT).suffix).toBeUndefined();
  });

  it("maps legalOnly to the ACTIVE format's legality flag — the validator's key", () => {
    expect(filtersToCardsQuery(DEFAULT_FILTERS, DEFAULT_FORMAT).legal).toBe("standard");
    expect(filtersToCardsQuery(DEFAULT_FILTERS, expanded).legal).toBe("expanded");
    expect(filtersToCardsQuery(f({ legalOnly: false }), DEFAULT_FORMAT).legal).toBeUndefined();
    expect(filtersToCardsQuery(f({ legalOnly: false }), expanded).legal).toBeUndefined();
  });
});

describe("findCardsByName", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the exact name (normalized key) and keeps only an exact-key match", async () => {
    // A fresh Response per call: the raw "Basic JOLTIK" form is asked for too.
    const mock = vi
      .fn()
      .mockImplementation(async () => json(cardsPage([brief({ name: "Joltik" })])));
    vi.stubGlobal("fetch", mock);

    const [card] = await findCardsByName("Basic  JOLTIK"); // prefix + case + spacing noise
    expect(card?.name).toBe("Joltik");
    expect(mock.mock.calls[0]?.[0]).toBe(
      "http://localhost:8787/cards?nameExact=joltik&pageSize=100",
    );
  });

  it("unions an Energy's plain and 'Basic …' prints — both forms share the key", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(cardsPage([brief({ id: "sve-001", name: "Grass Energy" })])))
      .mockResolvedValueOnce(
        json(cardsPage([brief({ id: "sv02-278", name: "Basic Grass Energy" })])),
      );
    vi.stubGlobal("fetch", mock);

    const cards = await findCardsByName("Basic Grass Energy");
    expect(cards.map((card) => card.cardId)).toEqual(["sve-001", "sv02-278"]);
    expect(mock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://localhost:8787/cards?nameExact=grass+energy&pageSize=100",
      "http://localhost:8787/cards?nameExact=basic+grass+energy&pageSize=100",
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

    const [card] = await findCardsByName("Iron Hands ex");
    expect(card?.name).toBe("Iron  Hands ex");
    expect(mock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://localhost:8787/cards?nameExact=iron+hands+ex&pageSize=100",
      "http://localhost:8787/cards?name=iron+hands+ex&pageSize=100",
    ]);
  });

  it("resolves empty when nothing matches", async () => {
    // Fresh Response per layer — a Response body reads once.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => json(cardsPage([]))),
    );
    await expect(findCardsByName("Joltik")).resolves.toEqual([]);
  });

  it("keeps the normalized-key guard — a response row that isn't an exact key match is dropped", async () => {
    // Belt and braces: nameExact should only return exact names, but the
    // client still refuses to hand back a card whose normalized key differs —
    // on EVERY layer, the substring fallback included.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => json(cardsPage([brief({ name: "Joltik Rocker" })]))),
    );
    await expect(findCardsByName("Joltik")).resolves.toEqual([]);
  });
});
