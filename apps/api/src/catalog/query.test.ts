// Query parsing + where building. The SQL assertions render real queries via
// Drizzle's toSQL() — no database is touched, so the D1 client is a dummy.

import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { cards } from "../db/schema";
import { buildCardsWhere, type CardsQuery, cardsQuerySchema, setsQuerySchema } from "./query";

/** Parse a query string's params the way zValidator hands them to the schema. */
function parseCards(params: Record<string, string>) {
  return cardsQuerySchema.safeParse(params);
}

function defaults(overrides: Partial<CardsQuery> = {}): CardsQuery {
  return { page: 1, pageSize: 50, ...overrides };
}

/** Rendered SQL + params for a where, via a real (never-executed) select. */
function render(query: CardsQuery) {
  const db = drizzle({} as D1Database);
  return db.select({ id: cards.id }).from(cards).where(buildCardsWhere(query)).toSQL();
}

describe("cardsQuerySchema", () => {
  it("defaults page/pageSize and keeps every filter optional", () => {
    const result = parseCards({});
    expect(result.success && result.data).toEqual({ page: 1, pageSize: 50 });
  });

  it("coerces the numeric params from query strings", () => {
    const result = parseCards({ page: "3", pageSize: "10", hpMin: "60", hpMax: "120" });
    expect(result.success && result.data).toEqual({ page: 3, pageSize: 10, hpMin: 60, hpMax: 120 });
  });

  it("rejects out-of-range and malformed values", () => {
    const rejected: Record<string, string>[] = [
      { pageSize: "101" },
      { pageSize: "0" },
      { page: "0" },
      { page: "two" },
      { hpMin: "-1" },
      { hpMin: "60.5" },
      { category: "Pokémon" }, // DB vocabulary is unaccented
      { legal: "unlimited" },
      { name: "" },
    ];
    for (const params of rejected) {
      expect(parseCards(params).success).toBe(false);
    }
  });

  it("ignores unknown params", () => {
    const result = parseCards({ sort: "name" });
    expect(result.success).toBe(true);
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

  it("matches type as a quoted value inside types_json", () => {
    const { sql, params } = render(defaults({ type: "Lightning" }));
    expect(sql).toContain('"cards"."types_json" like ?');
    expect(params).toEqual(['%"Lightning"%']);
  });

  it("ANDs equality filters with the hp bounds", () => {
    const { sql, params } = render(
      defaults({ category: "Pokemon", set: "sv06.5", rarity: "Common", hpMin: 60, hpMax: 120 }),
    );
    expect(sql).toContain('"cards"."category" = ?');
    expect(sql).toContain('"cards"."set_id" = ?');
    expect(sql).toContain('"cards"."rarity" = ?');
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
