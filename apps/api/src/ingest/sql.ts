// Generated SQL is applied via `wrangler d1 execute --file`, so values are emitted as escaped
// SQLite literals rather than bound parameters. Statements are upserts, never delete and reinsert,
// because `deck_cards.card_id` references cards with RESTRICT.

/** What a column spec declares about its values; enforced at runtime. */
export type SqlColumnKind = "text" | "number" | "boolean" | "json";

/** One column of a generated upsert: SQL name, row property, value kind. A `derived` column is
    rewritten by a later pass, so it is written but not compared when deciding whether a row
    changed. */
export interface SqlColumnSpec<Row> {
  name: string;
  key: keyof Row;
  kind: SqlColumnKind;
  derived?: true;
}

/**
 * Escape a string as a SQLite literal: wrap in single quotes, double any
 * embedded single quotes. Newlines and unicode are legal inside literals and
 * pass through verbatim. NUL cannot be represented in SQL text — throw rather
 * than silently truncate (SQLite would cut the string at the NUL).
 */
export function escapeSqlText(value: string): string {
  if (value.includes("\u0000")) {
    throw new Error("cannot escape a string containing NUL (\\u0000) as a SQL literal");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Serialize one value as a SQL literal according to its declared kind.
 * null/undefined → NULL for every kind; kind/typeof mismatches throw (a
 * mismatch means a mapping bug — never emit silently-coerced SQL).
 */
export function sqlLiteral(value: unknown, kind: SqlColumnKind): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  switch (kind) {
    case "text": {
      if (typeof value !== "string") {
        throw new Error(`expected a string for a text column, got ${typeof value}`);
      }
      return escapeSqlText(value);
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`expected a finite number for a number column, got ${String(value)}`);
      }
      return String(value);
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw new Error(`expected a boolean for a boolean column, got ${typeof value}`);
      }
      return value ? "1" : "0";
    }
    case "json": {
      // JSON.stringify escapes all control characters (\n → \\n etc.), so the
      // resulting text is always safe to embed as a plain SQL string.
      return escapeSqlText(JSON.stringify(value));
    }
  }
}

/**
 * Build one multi-row upsert. Every column is listed for every row (mapping
 * emits explicit nulls), and `ON CONFLICT(id) DO UPDATE` overwrites all
 * non-id columns from `excluded` so reruns converge on the latest upstream
 * state, but only for a row whose non-derived columns changed: an unchanged
 * row is not rewritten. Callers chunk rows (see `chunk`) before building.
 */
export function buildUpsertSql<Row>(
  table: string,
  columns: readonly SqlColumnSpec<Row>[],
  rows: readonly Row[],
): string {
  if (rows.length === 0) {
    throw new Error(`buildUpsertSql(${table}): refusing to build an upsert for zero rows`);
  }
  const columnList = columns.map((column) => `"${column.name}"`).join(", ");
  const tuples = rows.map((row) => {
    const values = columns.map((column) => {
      try {
        return sqlLiteral(row[column.key], column.kind);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${table}.${column.name}: ${reason}`);
      }
    });
    return `(${values.join(", ")})`;
  });
  const updated = columns.filter((column) => column.name !== "id");
  const updates = updated
    .map((column) => `"${column.name}" = excluded."${column.name}"`)
    .join(",\n  ");
  const changed = updated
    .filter((column) => column.derived === undefined)
    .map((column) => `"${table}"."${column.name}" IS NOT excluded."${column.name}"`)
    .join("\n  OR ");
  return [
    `INSERT INTO "${table}" (${columnList}) VALUES`,
    tuples.join(",\n"),
    `ON CONFLICT("id") DO UPDATE SET`,
    `  ${updates}`,
    `WHERE ${changed};`,
  ].join("\n");
}

export { chunk } from "../db/batch";
