// Query parsing + where building. The SQL assertions render real queries via
// Drizzle's toSQL() — no database is touched, so the D1 client is a dummy.

import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { cards } from "../db/schema";
import {
  buildCardsWhere,
  type CardsQuery,
  cardsOrder,
  cardsQuerySchema,
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
    expect(sql).toContain('"cards"."types_json" like ? or "cards"."types_json" like ?');
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
