import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetch } from "../test/fetchStub";
import { cardBrief as brief, cardIndexPayload, cardsPage, FACETS } from "../test/fixtures";
import { type Card, prepareCardIndex } from "@colorless/schema";
import { DEFAULT_FORMAT, formatById } from "@colorless/engine";
import { isBuilderBasicEnergy } from "./cards";
import { validateDeck } from "./deckMath";
import {
  filtersToCardsQuery,
  findCardsByName,
  findCardsBySubstring,
  forgetCardIndex,
  forgetCatalogOptions,
  importDecklist,
  kindOptions,
  loadFacets,
  loadCardIndex,
  loadSeries,
  loadSets,
  prepareInSlices,
  suffixOptions,
  toBuilderCard,
} from "./catalog";
import { MAX_DECKLIST_LINES } from "./decklistText";
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
    expect(isBuilderBasicEnergy(special)).toBe(false);
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

  it("a Trainer the catalog gives no trainer_type (30th-c-005 Misty) is a Trainer with no kind", () => {
    const misty = toBuilderCard(
      brief({
        id: "30th-c-005",
        name: "Misty",
        category: "Trainer",
        stage: null,
        types: null,
        hp: null,
        trainerType: null,
      }),
    );
    expect([misty.supertype, misty.subtype]).toEqual(["Trainer", ""]);
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

  it("never falls back to the substring search itself", async () => {
    // The unstripped retry is skipped too: the raw name only differs by case.
    const mock = vi.fn().mockImplementation(async () => json(cardsPage([])));
    vi.stubGlobal("fetch", mock);
    await expect(findCardsByName("Iron Hands ex")).resolves.toEqual([]);
    expect(mock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://localhost:8787/cards?nameExact=iron+hands+ex&pageSize=100",
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
    await expect(findCardsBySubstring("Joltik")).resolves.toEqual([]);
  });
});

describe("findCardsBySubstring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reaches a stored name only the key can bridge, without asking for a count", async () => {
    // The stored name carries a trailing space, so no nameExact lookup can
    // equal it; the substring page plus the normalized-key guard reaches it.
    const mock = vi.fn().mockResolvedValue(json(cardsPage([brief({ name: "Iron Hands ex " })])));
    vi.stubGlobal("fetch", mock);
    const [card] = await findCardsBySubstring("Iron Hands ex");
    expect(card?.name).toBe("Iron Hands ex ");
    expect(mock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://localhost:8787/cards?name=iron+hands+ex&pageSize=100&total=0",
    ]);
  });
});

describe("filter options", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetCatalogOptions();
  });

  it("loads facets, sets and series once for every caller, and again after an hour", async () => {
    const { calls } = stubFetch({
      "GET /facets": () => json(FACETS),
      "GET /sets": () => json([]),
      "GET /series": () => json([]),
    });
    const now = Date.now();
    await Promise.all([loadFacets(now), loadFacets(now), loadSets(now), loadSeries(now)]);
    await Promise.all([loadFacets(now + 60_000), loadSets(now + 60_000), loadSeries(now + 60_000)]);
    expect(calls).toEqual(["GET /facets", "GET /sets", "GET /series"]);
    await loadSets(now + 60 * 60 * 1000 + 1);
    expect(calls).toEqual(["GET /facets", "GET /sets", "GET /series", "GET /sets"]);
  });

  it("forgets a failed load, so the next call asks again", async () => {
    let fail = true;
    const { calls } = stubFetch({
      "GET /facets": () => (fail ? json({ error: "down" }, 503) : json(FACETS)),
    });
    await expect(loadFacets()).rejects.toThrow();
    fail = false;
    await expect(loadFacets()).resolves.toEqual(FACETS);
    expect(calls).toEqual(["GET /facets", "GET /facets"]);
  });
});

describe("the card index", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetCardIndex();
  });
  /** Three sets of two cards. */
  const payload = cardIndexPayload(
    ["a", "b", "c"].flatMap((setId) =>
      [1, 2].map((n) => brief({ id: `${setId}-${n}`, name: `Card ${n}`, setId })),
    ),
  );

  it("prepares a slice at a time, giving the thread back to a timer queued before it", async () => {
    let ran = false;
    setTimeout(() => {
      ran = true;
    }, 0);
    const index = await prepareInSlices(payload, 0);
    expect(ran).toBe(true);
    expect(index).toEqual(prepareCardIndex(payload));
  });

  it("yields through scheduler.yield where the browser has it", async () => {
    const yieldNow = vi.fn(() => Promise.resolve());
    vi.stubGlobal("scheduler", { yield: yieldNow });
    expect(await prepareInSlices(payload, 0)).toEqual(prepareCardIndex(payload));
    // After each of the three sets and after the name order.
    expect(yieldNow).toHaveBeenCalledTimes(4);
  });

  it("is loaded in slices", async () => {
    const yieldNow = vi.fn(() => Promise.resolve());
    vi.stubGlobal("scheduler", { yield: yieldNow });
    stubFetch({ "GET /cards/index": () => json(payload) });
    const loaded = await loadCardIndex(Date.now(), 0);
    expect(loaded.index).toEqual(prepareCardIndex(payload));
    expect(yieldNow).toHaveBeenCalledTimes(4);
  });
});

describe("importDecklist", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetCatalogOptions();
  });

  /** The /cards queries an import makes, as `nameExact=…` / `name=…` strings. */
  function stubCatalog(byExactName: Record<string, ReturnType<typeof brief>[]>) {
    const queries: string[] = [];
    stubFetch({
      "GET /sets": () => json([]),
      "GET /cards": (url) => {
        const query = [...url.searchParams].filter(
          ([key]) => key === "nameExact" || key === "name",
        );
        queries.push(query.map(([key, value]) => `${key}=${value}`).join("&"));
        const exact = url.searchParams.get("nameExact");
        return json(cardsPage(exact === null ? [] : (byExactName[exact] ?? [])));
      },
    });
    return queries;
  }

  it("retries a PTCG Live line without its set and number before any substring search", async () => {
    const queries = stubCatalog({
      "rocky helmet": [brief({ id: "sv01-193", name: "Rocky Helmet", category: "Trainer" })],
    });
    const { entries, unmatched } = await importDecklist("2 Rocky Helmet SVI 193");
    expect(unmatched).toEqual([]);
    expect(entries.map((entry) => [entry.card.cardId, entry.quantity])).toEqual([["sv01-193", 2]]);
    expect(queries).toEqual(["nameExact=rocky helmet svi 193", "nameExact=rocky helmet"]);
  });

  it("searches by substring only once every exact lookup missed, on the stripped name", async () => {
    const queries = stubCatalog({});
    const { unmatched } = await importDecklist("1 Mystery Card SVI 9");
    expect(unmatched).toHaveLength(1);
    expect(queries).toEqual([
      "nameExact=mystery card svi 9",
      "nameExact=mystery card",
      "name=mystery card",
    ]);
  });

  it("resolves names in the card index when it loads, asking /cards nothing", async () => {
    const prints = [
      brief({ id: "sve-002", name: "Fire Energy", category: "Energy", energyType: "Normal" }),
      brief({ id: "sv01-193", name: "Rocky Helmet", category: "Trainer" }),
      brief({
        id: "sv03-230",
        name: "Basic Fire Energy",
        category: "Energy",
        energyType: "Normal",
      }),
    ];
    const { calls } = stubFetch({
      "GET /sets": () => json([]),
      "GET /cards/index": () => json(cardIndexPayload(prints)),
    });
    const { entries, unmatched } = await importDecklist(
      "2 Rocky Helmet SVI 193\n5 Basic Fire Energy\n1 Mystery Card",
    );
    expect(unmatched.map((line) => line.name)).toEqual(["Mystery Card"]);
    // The plain print comes first, as from GET /cards: exact key, then its "Basic …" form.
    expect(entries.map((entry) => [entry.card.cardId, entry.quantity])).toEqual([
      ["sv01-193", 2],
      ["sve-002", 5],
    ]);
    expect(calls.filter((call) => call === "GET /cards")).toEqual([]);
    forgetCardIndex();
  });

  it("asks /cards instead of reading an index of an unknown version, and refetches the index", async () => {
    const prints = [brief({ id: "sv01-193", name: "Rocky Helmet", category: "Trainer" })];
    let version = 2;
    const { calls } = stubFetch({
      "GET /sets": () => json([]),
      "GET /cards/index": () => json({ ...cardIndexPayload(prints), version }),
      "GET /cards": () => json(cardsPage(prints)),
    });
    const fromApi = await importDecklist("2 Rocky Helmet");
    expect(fromApi.entries.map((entry) => entry.card.cardId)).toEqual(["sv01-193"]);
    expect(calls.filter((call) => call === "GET /cards").length).toBeGreaterThan(0);
    version = 1;
    calls.length = 0;
    const fromIndex = await importDecklist("2 Rocky Helmet");
    expect(fromIndex.entries.map((entry) => entry.card.cardId)).toEqual(["sv01-193"]);
    expect(calls.filter((call) => call !== "GET /sets")).toEqual(["GET /cards/index"]);
    forgetCardIndex();
  });

  it(`refuses more than ${MAX_DECKLIST_LINES} card lines before any lookup`, async () => {
    const { impl } = stubFetch({});
    const text = Array.from({ length: MAX_DECKLIST_LINES + 1 }, () => "1 Pikachu").join("\n");
    await expect(importDecklist(text)).resolves.toEqual({
      entries: [],
      unmatched: [],
      tooManyLines: true,
    });
    expect(impl).not.toHaveBeenCalled();
  });
});
