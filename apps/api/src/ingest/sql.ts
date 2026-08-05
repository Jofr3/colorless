// SQL generation for the tcgdex→D1 ingest (P1 milestone 4, §3.4).
//
// The ingest CLI (apps/api/scripts/ingest.ts) applies generated SQL files via
// `wrangler d1 execute --file`, so everything here must serialize to plain SQL
// TEXT — there are no bound parameters. That makes the escaping helper the
// load-bearing piece: values are emitted as SQLite literals with single-quote
// doubling, NULL for null/undefined, integers for booleans, and JSON text
// (via JSON.stringify) for the `*_json` columns. Statements are idempotent
// upserts (`INSERT … ON CONFLICT(id) DO UPDATE`) — never delete+reinsert,
// because `deck_cards.card_id` references cards with RESTRICT semantics.

/** What a column spec declares about its values; enforced at runtime. */
export type SqlColumnKind = "text" | "number" | "boolean" | "json";

/** One column of a generated upsert: SQL name, row property, value kind. */
export interface SqlColumnSpec<Row> {
  name: string;
  key: keyof Row;
  kind: SqlColumnKind;
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
 * state. Callers chunk rows (see `chunk`) before building.
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
  const updates = columns
    .filter((column) => column.name !== "id")
    .map((column) => `"${column.name}" = excluded."${column.name}"`)
    .join(",\n  ");
  return [
    `INSERT INTO "${table}" (${columnList}) VALUES`,
    tuples.join(",\n"),
    `ON CONFLICT("id") DO UPDATE SET`,
    `  ${updates};`,
  ].join("\n");
}

/** Split rows into consecutive chunks of at most `size` (the last may be smaller). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk size must be a positive integer, got ${size}`);
  }
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
