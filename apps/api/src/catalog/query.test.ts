// Query parsing + where building. The SQL assertions render real queries via
// Drizzle's toSQL() — no database is touched, so the D1 client is a dummy.

import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { cards } from "../db/schema";
import {
  buildCardsWhere,
  type CardOrderFields,
  type CardsQuery,
  cardsOrder,
  cardsQuerySchema,
  compareCardRows,
  MAX_ID_VALUES,
  setsQuerySchema,
} from "./query";

/** Parse params the way zValidator hands them to the schema: a single
    occurrence arrives as a string, a repeated key as a string[]. */
function parseCards(params: Record<string, string | string[]>) {
  return cardsQuerySchema.safeParse(params);
}

function defaults(overrides: Partial<CardsQuery> = {}): CardsQuery {
  return { page: 1, pageSize: 50, sort: "set", ...overrides };
}

/** Rendered SQL + params for a where, via a real (never-executed) select. */
function render(query: CardsQuery) {
  const db = drizzle({} as D1Database);
  return db.select({ id: cards.id }).from(cards).where(buildCardsWhere(query)).toSQL();
}

/** Rendered SQL for a sort's full ORDER BY. */
function renderOrder(sort: CardsQuery["sort"]) {
  const db = drizzle({} as D1Database);
  return db
    .select({ id: cards.id })
    .from(cards)
    .orderBy(...cardsOrder(sort))
    .toSQL().sql;
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

describe("buildCardsWhere", () => {
  it("returns undefined for an unfiltered query", () => {
    expect(buildCardsWhere(defaults())).toBeUndefined();
  });

  it("wraps name in a substring LIKE", () => {
    const { sql, params } = render(defaults({ name: "joltik" }));
    expect(sql).toContain('"cards"."name" like ?');
    expect(params).toEqual(["%joltik%"]);
  });

  it("matches a single type as a quoted value inside types_json", () => {
    const { sql, params } = render(defaults({ type: ["Lightning"] }));
    expect(sql).toContain('"cards"."types_json" like ?');
    expect(params).toEqual(['%"Lightning"%']);
  });

  it("ORs repeated types within the dimension", () => {
    const { sql, params } = render(defaults({ type: ["Fire", "Water"] }));
    expect(sql).toContain(
      "\"cards\".\"types_json\" like ? escape '\\' or \"cards\".\"types_json\" like ? escape '\\'",
    );
    expect(params).toEqual(['%"Fire"%', '%"Water"%']);
  });

  it("matches repeated rarities with IN", () => {
    const { sql, params } = render(defaults({ rarity: ["Common", "Double rare"] }));
    expect(sql).toContain('"cards"."rarity" in (?, ?)');
    expect(params).toEqual(["Common", "Double rare"]);
  });

  it("ANDs equality filters with the hp bounds", () => {
    const { sql, params } = render(
      defaults({ category: "Pokemon", set: "sv06.5", rarity: ["Common"], hpMin: 60, hpMax: 120 }),
    );
    expect(sql).toContain('"cards"."category" = ?');
    expect(sql).toContain('"cards"."set_id" = ?');
    expect(sql).toContain('"cards"."rarity" in (?)');
    expect(sql).toContain('"cards"."hp" >= ?');
    expect(sql).toContain('"cards"."hp" <= ?');
    expect(params).toEqual(["Pokemon", "Common", "sv06.5", 60, 120]);
  });

  it("maps legal to the matching boolean flag column", () => {
    expect(render(defaults({ legal: "standard" })).sql).toContain('"cards"."legal_standard" = ?');
    expect(render(defaults({ legal: "expanded" })).sql).toContain('"cards"."legal_expanded" = ?');
  });

  it("filters regulationMark exactly", () => {
    const { sql, params } = render(defaults({ regulationMark: "H" }));
    expect(sql).toContain('"cards"."regulation_mark" = ?');
    expect(params).toEqual(["H"]);
  });

  it("matches nameExact with case-folded equality, not LIKE (no wildcards)", () => {
    const { sql, params } = render(defaults({ nameExact: "100% Zygarde" }));
    expect(sql).toContain('lower("cards"."name") = lower(?)');
    expect(sql).not.toContain("like");
    expect(params).toEqual(["100% Zygarde"]); // `%` stays literal
  });

  it("matches the P2 kind params with IN, like rarity", () => {
    const { sql, params } = render(
      defaults({ stage: ["Basic", "Stage1"], trainerType: ["Item"], energyType: ["Special"] }),
    );
    expect(sql).toContain('"cards"."stage" in (?, ?)');
    expect(sql).toContain('"cards"."trainer_type" in (?)');
    expect(sql).toContain('"cards"."energy_type" in (?)');
    expect(params).toEqual(["Basic", "Stage1", "Item", "Special"]);
  });

  it("filters serie through a set-membership subquery", () => {
    const { sql, params } = render(defaults({ serie: "sv" }));
    expect(sql).toContain(
      '"cards"."set_id" in (select "sets"."id" from "sets" where "sets"."serie_id" = ?)',
    );
    expect(params).toEqual(["sv"]);
  });

  it("filters illustrator exactly", () => {
    const { sql, params } = render(defaults({ illustrator: "Naoyo Kimura" }));
    expect(sql).toContain('"cards"."illustrator" = ?');
    expect(params).toEqual(["Naoyo Kimura"]);
  });

  it("ORs text as substring LIKEs over the abilities and attacks JSON", () => {
    const { sql, params } = render(defaults({ text: "Poison" }));
    expect(sql).toContain(
      "\"cards\".\"abilities_json\" like ? escape '\\' or \"cards\".\"attacks_json\" like ? escape '\\'",
    );
    expect(params).toEqual(["%Poison%", "%Poison%"]);
  });

  it("escapes LIKE wildcards in name/text so `%`/`_` match literally", () => {
    // "50%" must not over-match everything containing 50 — the pattern
    // escapes the wildcards and the LIKE carries an ESCAPE '\' clause.
    const name = render(defaults({ name: "50%_off" }));
    expect(name.sql).toContain("\"cards\".\"name\" like ? escape '\\'");
    expect(name.params).toEqual(["%50\\%\\_off%"]);

    const text = render(defaults({ text: "100% chance" }));
    expect(text.sql).toContain("escape '\\'");
    expect(text.params).toEqual(["%100\\% chance%", "%100\\% chance%"]);
  });

  it("escapes the quoted type patterns too — the escape char itself included", () => {
    const { params } = render(defaults({ type: ["Fi%re", "Wa\\ter"] }));
    expect(params).toEqual(['%"Fi\\%re"%', '%"Wa\\\\ter"%']);
  });

  it("ignores id — the hydration path in routes.ts ANDs the chunked IN itself", () => {
    expect(buildCardsWhere(defaults({ id: ["sv06.5-001"] }))).toBeUndefined();
  });
});

describe("cardsOrder", () => {
  it("keeps collector order as the default sort", () => {
    expect(renderOrder("set")).toContain('order by "cards"."set_id" asc, "cards"."local_id" asc');
  });

  it("sorts name ascending with collector order as the tiebreak", () => {
    expect(renderOrder("name")).toContain(
      'order by "cards"."name" asc, "cards"."set_id" asc, "cards"."local_id" asc',
    );
  });

  // NULL hp (Trainers/Energy) lands last on `hp DESC` because SQLite orders
  // NULL below every value — verified against SQLite directly:
  //   ORDER BY hp DESC over (330, NULL, 70, NULL, 60) → 330, 70, 60, NULL, NULL.
  it("sorts hp-desc with collector order as the tiebreak", () => {
    expect(renderOrder("hp-desc")).toContain(
      'order by "cards"."hp" desc, "cards"."set_id" asc, "cards"."local_id" asc',
    );
  });
});

describe("compareCardRows", () => {
  // Deliberately shuffled; fields mirror the real ingested vocabulary.
  const rows: CardOrderFields[] = [
    { name: "Ultra Ball", hp: null, setId: "sv01", localId: "196" },
    { name: "Joltik", hp: 40, setId: "sv06.5", localId: "001" },
    { name: "Fezandipiti ex", hp: 210, setId: "sv06.5", localId: "038" },
    { name: "Fire Energy", hp: null, setId: "sve", localId: "002" },
    { name: "Joltik", hp: 30, setId: "sv01", localId: "066" },
  ];
  const sorted = (sort: CardsQuery["sort"]) =>
    [...rows].sort((a, b) => compareCardRows(sort, a, b)).map((row) => row.localId);

  it('mirrors SQL collector order for "set" — (set_id, local_id) ascending', () => {
    expect(sorted("set")).toEqual(["066", "196", "001", "038", "002"]);
  });

  it('mirrors SQL "name" order with the collector tiebreak on equal names', () => {
    expect(sorted("name")).toEqual(["038", "002", "066", "001", "196"]);
  });

  it('mirrors SQL "hp-desc" — NULL hp last, collector tiebreak among NULLs', () => {
    expect(sorted("hp-desc")).toEqual(["038", "001", "066", "196", "002"]);
  });
});
