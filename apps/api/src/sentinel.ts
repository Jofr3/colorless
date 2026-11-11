// The catalog's "no value" sentinel guard, shared by the ingest write boundary and the catalog read
// boundary. tcgdex usually omits a missing value, but some rows carry the literal string "None",
// which would otherwise survive as a bogus facet value. The list is deliberately narrow so real
// values are never eaten. A sentinel becomes NULL, NULL keeps meaning "no value", and nothing is
// filtered out of a result set, only out of vocabulary lists.

/** Sentinel spellings, compared against the lowercased+trimmed input. */
const SENTINELS: ReadonlySet<string> = new Set(["", "none"]);

/**
 * A raw catalog string → itself, or `null` when it is a "no value" sentinel.
 *
 * Case- and whitespace-insensitive on the MATCH only: a value that survives
 * is returned byte-identical, never trimmed or re-cased, so this can sit on
 * a read path without silently rewriting stored data.
 */
export function normalizeSentinel(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return SENTINELS.has(value.trim().toLowerCase()) ? null : value;
}

/**
 * A facet vocabulary → the same list with sentinels and nulls dropped and
 * duplicates collapsed, ORDER PRESERVED (GET /facets sorts the result).
 *
 * Dedupe is not theoretical: normalising can collapse two distinct stored
 * spellings ("None" and "") onto the same absence, and the builder's filter
 * chips must list each value once.
 */
export function facetVocabulary(values: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeSentinel(value);
    if (normalized !== null) seen.add(normalized);
  }
  return [...seen];
}
