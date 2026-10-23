// D1 statement limits and the list helpers that stay inside them. Driver-free, so the ingest CLI
// can share it.

/** D1 caps bound parameters at 100 per statement, so statements over dynamic lists must chunk. A
    200-entry card list is 200 params as an IN query and 600 as an insert; both split here and run
    inside one db.batch. */
export const D1_MAX_BOUND_PARAMS = 100;

/** Split `items` into consecutive runs of at most `size` (the last may be shorter). */
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

/** `items` as the non-empty tuple `db.batch` requires, keeping each statement's result type. */
export function nonEmpty<T>(items: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) throw new Error("a D1 batch needs at least one statement");
  return [first, ...rest];
}
