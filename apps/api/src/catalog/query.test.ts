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
      '"cards"."types_json" like ? escape \'\\\' or "cards"."types_json" like ? escape \'\\\'',
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

  it("matches suffix with IN, and ANDs it with the stage dimension", () => {
    const { sql, params } = render(defaults({ suffix: ["ex", "MEGA"], stage: ["Basic"] }));
    expect(sql).toContain('"cards"."suffix" in (?, ?)');
    // Two dimensions, so they AND: "a Basic Pokémon that is also an ex".
    // Within `suffix` the repeats OR. This is the split the rail relies on —
    // stage chips and suffix chips are separate sections precisely because
    // the server can only AND across them.
    expect(sql).toContain('"cards"."stage" in (?)');
    expect(sql).toContain(" and ");
    expect(params).toEqual(["Basic", "ex", "MEGA"]);
  });

  it("passes suffix values through verbatim — no case folding against /facets", () => {
    // The chips carry the STORED spelling (tcgdex prints "ex" in the SV era
    // and "EX" in the XY era); folding here would make the filter disagree
    // with the vocabulary it is driven by.
    const { params } = render(defaults({ suffix: ["EX"] }));
    expect(params).toEqual(["EX"]);
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

  // D197 — `effect` joined the OR. It is the ONLY disjunct that can match a
  // Trainer or an Energy: on production every one of the 517 rows with
  // `effect` has abilities_json AND attacks_json NULL (and every Pokémon has
  // `effect` NULL), so the two JSON disjuncts and this one cover exactly
  // disjoint halves of the catalog. Before it, `?text=` could not return a
  // Trainer for any term at all — 275 of those rows are Standard-legal.
  it("ORs text over the abilities/attacks JSON AND the plain-text effect", () => {
    const { sql, params } = render(defaults({ text: "Poison" }));
    expect(sql).toContain(
      '"cards"."abilities_json" like ? escape \'\\\' or "cards"."attacks_json" like ? escape \'\\\' or "cards"."effect" like ? escape \'\\\'',
    );
    expect(params).toEqual(["%Poison%", "%Poison%", "%Poison%"]);
  });

  it("escapes LIKE wildcards in name/text so `%`/`_` match literally", () => {
    // "50%" must not over-match everything containing 50 — the pattern
    // escapes the wildcards and the LIKE carries an ESCAPE '\' clause.
    const name = render(defaults({ name: "50%_off" }));
    expect(name.sql).toContain('"cards"."name" like ? escape \'\\\'');
    expect(name.params).toEqual(["%50\\%\\_off%"]);

    // Escaped once per disjunct — the `effect` arm included, so widening the
    // search did not open a wildcard hole in the new column.
    const text = render(defaults({ text: "100% chance" }));
    expect(text.sql).toContain("escape '\\'");
    expect(text.params).toEqual(["%100\\% chance%", "%100\\% chance%", "%100\\% chance%"]);
  });

  it("escapes the quoted type patterns too — the escape char itself included", () => {
    const { params } = render(defaults({ type: ["Fi%re", "Wa\\ter"] }));
    expect(params).toEqual(['%"Fi\\%re"%', '%"Wa\\\\ter"%']);
  });

  // D197: `id` moved INTO the where. The shape that matters is "one bind for
  // the whole list" — that is what keeps a 100-id hydration under D1's
  // 100-parameter cap on the same statement as ORDER BY + LIMIT/OFFSET, and
  // therefore what let the JS sort twin go (see the cardsOrder block below).
  it("expands the id list from ONE JSON bind, not N placeholders", () => {
    const { sql, params } = render(defaults({ id: ["sv06.5-001", "sv01-196"] }));
    expect(sql).toContain('"cards"."id" in (select "value" from json_each(?))');
    expect(params).toEqual(['["sv06.5-001","sv01-196"]']);
  });

  it("stays ONE bind at the MAX_ID_VALUES cap — the whole point of the JSON form", () => {
    const ids = Array.from({ length: MAX_ID_VALUES }, (_, i) => `sv01-${i}`);
    const { params } = render(defaults({ id: ids }));
    expect(params).toHaveLength(1);
  });

  it("composes id with the other filters instead of replacing them", () => {
    const { sql, params } = render(defaults({ id: ["sv01-196"], legal: "standard" }));
    expect(sql).toContain("json_each(?)");
    expect(sql).toContain('"cards"."legal_standard" = ?');
    expect(params).toEqual(['["sv01-196"]', 1]); // drizzle binds the boolean as 1
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

// D197 — the unification, pinned. `cardsOrder` used to have a JS twin
// (`compareCardRows`) that sorted the id-hydration path's ≤100 rows in memory,
// because that path fanned out into a chunked db.batch with no single
// statement to order. Two specs, one order, nothing keeping them in step.
//
// They DID agree at the time of removal, and the argument is finite: the key
// tuples are identical, `hp` is an integer on both sides, and the only way the
// string keys could disagree is SQLite's BINARY collation (UTF-8 memcmp) vs
// JS `<` (UTF-16 code units), which differ only when an astral code point
// (≥ U+10000) meets a BMP one — surrogates sort BELOW U+E000..U+FFFF in
// UTF-16 and ABOVE it in UTF-8. Measured against the production catalog
// (3,786 rows): 13 rows carry a non-ASCII `name` (11 distinct — `Flabébé`,
// `Nidoran♀`, `Nidoran♂`, the `Poké*` family), every character BMP, zero
// astral; `set_id` and `local_id` are pure ASCII; and `cards` has no COLLATE
// clause on any column, so BINARY it is. So the twin was latent, not live.
//
// It is gone now, and these cases pin the property that replaced it: the id
// path and the plain path are the SAME statement shape, so there is nothing
// left to keep in step.
describe("one sort spec — the id path orders in SQL like every other query", () => {
  /** The /cards page statement as routes.ts builds it: where + order + page. */
  function renderPage(query: CardsQuery) {
    const db = drizzle({} as D1Database);
    return db
      .select({ id: cards.id })
      .from(cards)
      .where(buildCardsWhere(query))
      .orderBy(...cardsOrder(query.sort))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .toSQL().sql;
  }

  const orderBy = (sql: string) => sql.slice(sql.indexOf("order by"));

  it.each(["set", "name", "hp-desc"] as const)(
    'orders a "%s" id-hydration exactly like the unfiltered page',
    (sort) => {
      const ids = ["sv06.5-001", "sv01-196", "sve-002"];
      expect(orderBy(renderPage(defaults({ sort, id: ids })))).toEqual(
        orderBy(renderPage(defaults({ sort }))),
      );
    },
  );

  it("pages the id set in SQL — LIMIT/OFFSET, not a JS slice", () => {
    const sql = renderPage(defaults({ id: ["sv01-196"], page: 3, pageSize: 20 }));
    expect(sql).toContain("json_each(?)");
    expect(sql).toContain("limit ?");
    expect(sql).toContain("offset ?");
  });
});
