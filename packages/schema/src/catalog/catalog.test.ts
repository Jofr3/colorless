import { describe, expect, it } from "vitest";
import { cardBriefSchema, cardSchema } from "./card";
import { catalogFacetsSchema } from "./facets";
import { paginatedSchema } from "./page";
import { serieSchema } from "./serie";
import { setWithCardsSchema } from "./set";

// A full canonical Pokémon card — the mapped shape of the real ingested
// sv06.5-001 row (Joltik, Shrouded Fable).
const joltikCard = {
  id: "sv06.5-001",
  setId: "sv06.5",
  localId: "001",
  name: "Joltik",
  category: "Pokemon",
  image: "/assets/cards/sv06.5-001",
  illustrator: "Naoyo Kimura",
  rarity: "Common",
  regulationMark: "H",
  hp: 40,
  stage: "Basic",
  evolveFrom: null,
  types: ["Grass"],
  retreat: 1,
  abilities: null,
  attacks: [{ cost: ["Grass"], name: "Splashing Dodge", damage: 10 }],
  weaknesses: [{ type: "Fire", value: "×2" }],
  resistances: null,
  trainerType: null,
  energyType: null,
  effect: null,
  legal: { standard: true, expanded: true },
  variants: { normal: true, reverse: true, holo: false, firstEdition: false, wPromo: false },
};

describe("catalog cardSchema", () => {
  it("parses a full Pokémon card with nulled off-category fields", () => {
    const card = cardSchema.parse(joltikCard);
    expect(card.types).toEqual(["Grass"]);
    expect(card.trainerType).toBeNull();
  });

  it("rejects a card whose image is not null but missing", () => {
    const { image: _image, ...withoutImage } = joltikCard;
    expect(cardSchema.safeParse(withoutImage).success).toBe(false);
  });

  it("rejects unknown categories", () => {
    expect(cardSchema.safeParse({ ...joltikCard, category: "Pokémon" }).success).toBe(false);
  });
});

describe("catalog set/serie schemas", () => {
  const setBrief = {
    id: "sv06.5",
    serieId: "sv",
    name: "Shrouded Fable",
    logo: "/assets/sets/sv06.5",
    symbol: "/assets/sets/sv06.5",
    releaseDate: "2024-08-02",
    cardCount: { total: 99, official: 64 },
  };

  it("parses a full set with its card briefs", () => {
    const set = setWithCardsSchema.parse({
      ...setBrief,
      legal: { standard: true, expanded: true },
      tcgOnline: null,
      cards: [
        {
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
          legal: { standard: true, expanded: true },
        },
      ],
    });
    expect(set.cards).toHaveLength(1);
  });

  it("rejects a releaseDate that is not a plain date", () => {
    expect(
      serieSchema.safeParse({
        id: "sv",
        name: "Scarlet & Violet",
        releaseDate: "2023-03-31T00:00:00Z",
        sets: [setBrief],
      }).success,
    ).toBe(false);
  });
});

describe("catalog cardBriefSchema", () => {
  const joltikBrief = {
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
    legal: { standard: true, expanded: true },
  };

  it("carries the builder-facing columns (types/hp/mark/subtype discriminators)", () => {
    const brief = cardBriefSchema.parse(joltikBrief);
    expect(brief.types).toEqual(["Grass"]);
    expect(brief.hp).toBe(40);
    expect(brief.stage).toBe("Basic");
  });

  it("requires the M9 fields — nullable, never absent", () => {
    const { types: _types, ...withoutTypes } = joltikBrief;
    expect(cardBriefSchema.safeParse(withoutTypes).success).toBe(false);
    expect(cardBriefSchema.safeParse({ ...joltikBrief, hp: undefined }).success).toBe(false);
  });

  it("requires the P2 legal block — both flags, never absent", () => {
    const { legal: _legal, ...withoutLegal } = joltikBrief;
    expect(cardBriefSchema.safeParse(withoutLegal).success).toBe(false);
    expect(cardBriefSchema.safeParse({ ...joltikBrief, legal: { standard: true } }).success).toBe(
      false,
    );
    const brief = cardBriefSchema.parse(joltikBrief);
    expect(brief.legal).toEqual({ standard: true, expanded: true });
  });
});

describe("catalogFacetsSchema", () => {
  const facets = {
    rarities: ["Common", "Double rare"],
    types: ["Fire", "Grass"],
    stages: ["Basic", "Stage1"],
    trainerTypes: ["Item", "Supporter"],
    energyTypes: ["Normal", "Special"],
    illustrators: ["5ban Graphics", "Naoyo Kimura"],
    regulationMarks: ["G", "H"],
    suffixes: ["MEGA", "V", "ex"],
  };

  it("parses the eight vocabularies (empty lists included)", () => {
    expect(catalogFacetsSchema.parse(facets)).toEqual(facets);
    expect(catalogFacetsSchema.safeParse({ ...facets, illustrators: [] }).success).toBe(true);
  });

  it("rejects a missing vocabulary and non-string entries (nulls excluded by contract)", () => {
    const { stages: _stages, ...withoutStages } = facets;
    expect(catalogFacetsSchema.safeParse(withoutStages).success).toBe(false);
    expect(catalogFacetsSchema.safeParse({ ...facets, rarities: [null] }).success).toBe(false);
    // `suffixes` is REQUIRED like the other seven, not optional-with-default —
    // that is what makes a pre-D198 cached /facets body fail loudly here
    // instead of reaching the rail as `undefined` (the cache prefix moved to
    // v6 for exactly this reason; apps/api/src/catalog/cache.ts).
    const { suffixes: _suffixes, ...withoutSuffixes } = facets;
    expect(catalogFacetsSchema.safeParse(withoutSuffixes).success).toBe(false);
  });

  it("accepts an EMPTY suffix vocabulary — the state production is in today", () => {
    // `cards.suffix` is NULL on every row until an ingest fills it, so the
    // live payload carries `suffixes: []`. It must parse: the empty list IS
    // the signal the rail reads to hide the section.
    expect(catalogFacetsSchema.parse({ ...facets, suffixes: [] }).suffixes).toEqual([]);
  });
});

describe("paginatedSchema", () => {
  it("wraps an item schema into the list envelope", () => {
    const envelope = paginatedSchema(cardBriefSchema).parse({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
    expect(envelope.items).toEqual([]);
  });

  it("rejects a 0-based page and negative totals", () => {
    const schema = paginatedSchema(cardBriefSchema);
    expect(schema.safeParse({ items: [], page: 0, pageSize: 50, total: 0 }).success).toBe(false);
    expect(schema.safeParse({ items: [], page: 1, pageSize: 50, total: -1 }).success).toBe(false);
  });
});
