import { describe, expect, it } from "vitest";
import { buildUpsertSql, escapeSqlText, type SqlColumnSpec, sqlLiteral } from "./sql";

describe("escapeSqlText", () => {
  it("wraps plain text in single quotes", () => {
    expect(escapeSqlText("Pikachu")).toBe("'Pikachu'");
  });

  it("doubles embedded single quotes", () => {
    expect(escapeSqlText("Farfetch'd")).toBe("'Farfetch''d'");
    expect(escapeSqlText("''")).toBe("''''''");
    expect(escapeSqlText("'; DROP TABLE cards; --")).toBe("'''; DROP TABLE cards; --'");
  });

  it("passes newlines and unicode through verbatim", () => {
    expect(escapeSqlText("line1\nline2")).toBe("'line1\nline2'");
    expect(escapeSqlText("Pokémon ×2 ポケモン ⚡")).toBe("'Pokémon ×2 ポケモン ⚡'");
  });

  it("leaves backslashes alone (SQLite has no backslash escapes)", () => {
    expect(escapeSqlText("a\\nb")).toBe("'a\\nb'");
  });

  it("handles the empty string", () => {
    expect(escapeSqlText("")).toBe("''");
  });

  it("throws on NUL rather than emit a silently-truncating literal", () => {
    expect(() => escapeSqlText("bad\u0000text")).toThrow(/NUL/);
  });
});

describe("sqlLiteral", () => {
  it("emits NULL for null and undefined regardless of kind", () => {
    for (const kind of ["text", "number", "boolean", "json"] as const) {
      expect(sqlLiteral(null, kind)).toBe("NULL");
      expect(sqlLiteral(undefined, kind)).toBe("NULL");
    }
  });

  it("escapes text values", () => {
    expect(sqlLiteral("it's", "text")).toBe("'it''s'");
  });

  it("emits numbers bare and rejects non-finite ones", () => {
    expect(sqlLiteral(220, "number")).toBe("220");
    expect(sqlLiteral(0, "number")).toBe("0");
    expect(() => sqlLiteral(Number.NaN, "number")).toThrow(/finite/);
    expect(() => sqlLiteral(Number.POSITIVE_INFINITY, "number")).toThrow(/finite/);
  });

  it("emits booleans as integers", () => {
    expect(sqlLiteral(true, "boolean")).toBe("1");
    expect(sqlLiteral(false, "boolean")).toBe("0");
  });

  it("JSON.stringifies json values and escapes the result", () => {
    expect(sqlLiteral(["Grass"], "json")).toBe("'[\"Grass\"]'");
    expect(sqlLiteral({ name: "Rocket's Zapdos" }, "json")).toBe(
      "'{\"name\":\"Rocket''s Zapdos\"}'",
    );
  });

  it("json control characters ride inside JSON escapes, never raw", () => {
    // JSON.stringify escapes \n and even NUL (which escapeSqlText rejects on
    // bare text), so the SQL literal never contains raw control characters.
    const literal = sqlLiteral({ effect: "line1\nline2\u0000end" }, "json");
    expect(literal).toBe('\'{"effect":"line1\\nline2\\u0000end"}\'');
  });

  it("rejects kind/typeof mismatches instead of coercing", () => {
    expect(() => sqlLiteral(42, "text")).toThrow(/expected a string/);
    expect(() => sqlLiteral("42", "number")).toThrow(/expected a finite number/);
    expect(() => sqlLiteral(1, "boolean")).toThrow(/expected a boolean/);
  });
});

interface DemoRow {
  id: string;
  name: string;
  count: number | null;
  active: boolean;
  tags: string[] | null;
}

const DEMO_COLUMNS: readonly SqlColumnSpec<DemoRow>[] = [
  { name: "id", key: "id", kind: "text" },
  { name: "name", key: "name", kind: "text" },
  { name: "count", key: "count", kind: "number" },
  { name: "active", key: "active", kind: "boolean" },
  { name: "tags", key: "tags", kind: "json" },
];

describe("buildUpsertSql", () => {
  it("builds a multi-row upsert that updates every non-id column of a changed row", () => {
    const sql = buildUpsertSql("demo", DEMO_COLUMNS, [
      { id: "a-1", name: "Ann's", count: 3, active: true, tags: ["x"] },
      { id: "b-2", name: "Bob", count: null, active: false, tags: null },
    ]);
    expect(sql).toBe(
      `INSERT INTO "demo" ("id", "name", "count", "active", "tags") VALUES
('a-1', 'Ann''s', 3, 1, '["x"]'),
('b-2', 'Bob', NULL, 0, NULL)
ON CONFLICT("id") DO UPDATE SET
  "name" = excluded."name",
  "count" = excluded."count",
  "active" = excluded."active",
  "tags" = excluded."tags"
WHERE "demo"."name" IS NOT excluded."name"
  OR "demo"."count" IS NOT excluded."count"
  OR "demo"."active" IS NOT excluded."active"
  OR "demo"."tags" IS NOT excluded."tags";`,
    );
  });

  it("writes a derived column without comparing it", () => {
    const columns: readonly SqlColumnSpec<DemoRow>[] = [
      { name: "id", key: "id", kind: "text" },
      { name: "name", key: "name", kind: "text" },
      { name: "active", key: "active", kind: "boolean", derived: true },
    ];
    const sql = buildUpsertSql("demo", columns, [
      { id: "a-1", name: "Ann", count: null, active: true, tags: null },
    ]);
    expect(sql).toContain('"active" = excluded."active"');
    expect(sql).toContain('WHERE "demo"."name" IS NOT excluded."name";');
    expect(sql).not.toContain('"demo"."active" IS NOT');
  });

  it("inserts an insertOnly column but never overwrites or compares it", () => {
    const columns: readonly SqlColumnSpec<DemoRow>[] = [
      { name: "id", key: "id", kind: "text" },
      { name: "name", key: "name", kind: "text" },
      { name: "active", key: "active", kind: "boolean", insertOnly: true },
    ];
    const sql = buildUpsertSql("demo", columns, [
      { id: "a-1", name: "Ann", count: null, active: true, tags: null },
    ]);
    expect(sql).toBe(
      `INSERT INTO "demo" ("id", "name", "active") VALUES
('a-1', 'Ann', 1)
ON CONFLICT("id") DO UPDATE SET
  "name" = excluded."name"
WHERE "demo"."name" IS NOT excluded."name";`,
    );
  });

  it("rewrites every row when only derived columns would be compared", () => {
    const columns: readonly SqlColumnSpec<DemoRow>[] = [
      { name: "id", key: "id", kind: "text" },
      { name: "active", key: "active", kind: "boolean", derived: true },
    ];
    const sql = buildUpsertSql("demo", columns, [
      { id: "a-1", name: "Ann", count: null, active: true, tags: null },
    ]);
    expect(sql).toBe(
      `INSERT INTO "demo" ("id", "active") VALUES
('a-1', 1)
ON CONFLICT("id") DO UPDATE SET
  "active" = excluded."active";`,
    );
  });

  it("refuses to build a zero-row statement", () => {
    expect(() => buildUpsertSql("demo", DEMO_COLUMNS, [])).toThrow(/zero rows/);
  });

  it("names the offending table.column when a value mismatches its kind", () => {
    const row = { id: "a", name: "n", count: Number.NaN, active: true, tags: null };
    expect(() => buildUpsertSql("demo", DEMO_COLUMNS, [row])).toThrow(/demo\.count/);
  });
});
