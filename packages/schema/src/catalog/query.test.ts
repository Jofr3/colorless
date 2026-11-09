import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type CardsQueryParams,
  cardsQuerySchema,
  MAX_CARDS_OFFSET,
  MAX_FILTER_VALUES,
  MAX_FILTER_VALUES_TOTAL,
  MAX_ID_VALUES,
  MAX_PARAM_LENGTH,
  MAX_SEARCH_TERM_LENGTH,
  setsQuerySchema,
} from "./query";

/** Parse params the way zValidator hands them to the schema: a single
    occurrence arrives as a string, a repeated key as a string[]. */
function parseCards(params: Record<string, string | string[]>) {
  return cardsQuerySchema.safeParse(params);
}

describe("cardsQuerySchema", () => {
  it("defaults page/pageSize/sort and keeps every filter optional", () => {
    const result = parseCards({});
    expect(result.success && result.data).toEqual({ page: 1, pageSize: 50, sort: "set" });
  });

  it("coerces the numeric params from query strings", () => {
    const result = parseCards({ page: "3", pageSize: "10", hpMin: "60", hpMax: "120" });
    expect(result.success && result.data).toEqual({
      page: 3,
      pageSize: 10,
      hpMin: 60,
      hpMax: 120,
      sort: "set",
    });
  });

  it("normalizes type/rarity to arrays — single and repeated forms alike", () => {
    const single = parseCards({ type: "Fire", rarity: "Common" });
    expect(single.success && single.data.type).toEqual(["Fire"]);
    expect(single.success && single.data.rarity).toEqual(["Common"]);

    const repeated = parseCards({ type: ["Fire", "Water"], rarity: ["Common", "Double rare"] });
    expect(repeated.success && repeated.data.type).toEqual(["Fire", "Water"]);
    expect(repeated.success && repeated.data.rarity).toEqual(["Common", "Double rare"]);
  });

  it("normalizes the P2 kind params to arrays like type/rarity", () => {
    const result = parseCards({
      stage: "Basic",
      trainerType: ["Item", "Supporter"],
      energyType: "Special",
    });
    expect(result.success && result.data.stage).toEqual(["Basic"]);
    expect(result.success && result.data.trainerType).toEqual(["Item", "Supporter"]);
    expect(result.success && result.data.energyType).toEqual(["Special"]);
  });

  it("normalizes suffix to an array too — repeatable like the kind params", () => {
    expect(parseCards({ suffix: "ex" }).success && parseCards({ suffix: "ex" }).data).toMatchObject(
      { suffix: ["ex"] },
    );
    const repeated = parseCards({ suffix: ["ex", "VMAX"] });
    expect(repeated.success && repeated.data.suffix).toEqual(["ex", "VMAX"]);
    // Empty is a 400, like every other vocabulary param.
    expect(parseCards({ suffix: "" }).success).toBe(false);
  });

  it("accepts the P2 scalar params (nameExact/serie/illustrator/text)", () => {
    const result = parseCards({
      nameExact: "Fezandipiti ex",
      serie: "sv",
      illustrator: "Naoyo Kimura",
      text: "draw 3 cards",
    });
    expect(result.success && result.data).toMatchObject({
      nameExact: "Fezandipiti ex",
      serie: "sv",
      illustrator: "Naoyo Kimura",
      text: "draw 3 cards",
    });
  });

  it("normalizes id to an array and caps it at MAX_ID_VALUES", () => {
    const single = parseCards({ id: "sv06.5-001" });
    expect(single.success && single.data.id).toEqual(["sv06.5-001"]);

    const atCap = parseCards({ id: Array.from({ length: MAX_ID_VALUES }, (_, i) => `sv01-${i}`) });
    expect(atCap.success).toBe(true);

    const overCap = parseCards({
      id: Array.from({ length: MAX_ID_VALUES + 1 }, (_, i) => `sv01-${i}`),
    });
    expect(overCap.success).toBe(false);
  });

  it("caps each repeatable filter at MAX_FILTER_VALUES and all of them at the total", () => {
    const values = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => `${prefix}${i}`);
    for (const name of ["type", "rarity", "stage", "suffix", "trainerType", "energyType"]) {
      expect(parseCards({ [name]: values("v", MAX_FILTER_VALUES) }).success).toBe(true);
      expect(parseCards({ [name]: values("v", MAX_FILTER_VALUES + 1) }).success).toBe(false);
    }
    expect(
      parseCards({
        type: values("t", MAX_FILTER_VALUES),
        rarity: values("r", MAX_FILTER_VALUES_TOTAL - MAX_FILTER_VALUES),
      }).success,
    ).toBe(true);
    expect(
      parseCards({
        type: values("t", MAX_FILTER_VALUES),
        rarity: values("r", MAX_FILTER_VALUES),
        stage: values("s", 1),
      }).success,
    ).toBe(false);
  });

  it("accepts each sort value", () => {
    for (const sort of ["name", "hp-desc", "set"] as const) {
      const result = parseCards({ sort });
      expect(result.success && result.data.sort).toBe(sort);
    }
  });

  it("rejects out-of-range and malformed values", () => {
    const rejected: Record<string, string | string[]>[] = [
      { pageSize: "101" },
      { pageSize: "0" },
      { page: "0" },
      { page: "two" },
      { hpMin: "-1" },
      { hpMin: "60.5" },
      { category: "Pokémon" }, // DB vocabulary is unaccented
      { legal: "unlimited" },
      { name: "" },
      { sort: "hp" },
      { type: ["Fire", ""] }, // every repeated value must be non-empty
      { id: ["sv01-001", ""] },
      { nameExact: "" },
      { stage: "" },
      { trainerType: "" },
      { energyType: "" },
      { serie: "" },
      { illustrator: "" },
      { text: "" },
    ];
    for (const params of rejected) {
      expect(parseCards(params).success).toBe(false);
    }
  });

  it("caps every string value's length: free text at MAX_SEARCH_TERM_LENGTH, the rest at MAX_PARAM_LENGTH", () => {
    const of = (length: number) => "x".repeat(length);
    for (const name of ["name", "nameExact", "text"]) {
      expect(parseCards({ [name]: of(MAX_SEARCH_TERM_LENGTH) }).success).toBe(true);
      expect(parseCards({ [name]: of(MAX_SEARCH_TERM_LENGTH + 1) }).success).toBe(false);
    }
    for (const name of ["set", "serie", "illustrator", "regulationMark", "type", "rarity", "id"]) {
      expect(parseCards({ [name]: of(MAX_PARAM_LENGTH) }).success).toBe(true);
      expect(parseCards({ [name]: of(MAX_PARAM_LENGTH + 1) }).success).toBe(false);
    }
    // Each repeated value is capped on its own.
    expect(parseCards({ stage: ["Basic", of(MAX_PARAM_LENGTH + 1)] }).success).toBe(false);
    expect(setsQuerySchema.safeParse({ serie: of(MAX_PARAM_LENGTH + 1) }).success).toBe(false);
  });

  it("caps a page's offset at MAX_CARDS_OFFSET cards", () => {
    expect(parseCards({ page: "126", pageSize: "8" }).success).toBe(true);
    expect(parseCards({ page: "11", pageSize: "100" }).success).toBe(true);
    expect(parseCards({ page: "21", pageSize: "50", text: "x" }).success).toBe(true);
    const deep = parseCards({ page: "127", pageSize: "8" });
    expect(deep.success).toBe(false);
    expect(deep.error?.issues).toEqual([
      expect.objectContaining({
        path: ["page"],
        message: `page 127 at 8 a page skips more than ${MAX_CARDS_OFFSET} cards; narrow the filters`,
      }),
    ]);
    expect(parseCards({ page: "12", pageSize: "100", total: "5000" }).success).toBe(false);
  });

  it("ignores unknown params", () => {
    const result = parseCards({ order: "name" });
    expect(result.success).toBe(true);
    expect(result.success && "order" in result.data).toBe(false);
  });
});

describe("setsQuerySchema", () => {
  it("accepts an optional non-empty serie", () => {
    expect(setsQuerySchema.safeParse({}).success).toBe(true);
    expect(setsQuerySchema.safeParse({ serie: "sv" }).success).toBe(true);
    expect(setsQuerySchema.safeParse({ serie: "" }).success).toBe(false);
  });
});

describe("CardsQueryParams", () => {
  it("keeps the coerced numbers typed as numbers on the input side", () => {
    expectTypeOf<CardsQueryParams["page"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<CardsQueryParams["hpMin"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<CardsQueryParams["type"]>().toEqualTypeOf<string | string[] | undefined>();
  });
});
