// The catalog's "no value" sentinel guard — shared by the WRITE boundary
// (src/ingest/map.ts) and the READ boundary (src/catalog/map.ts + the
// /facets endpoint). D194.
//
// tcgdex serialises "this card has no value in this column" two different
// ways. Almost everywhere the key is simply absent (→ `undefined` → SQL
// NULL, which is what the rest of the app means by "no mark" / "no rarity").
// But a handful of rows carry the literal STRING "None" instead, and a
// string is not NULL: it survives `?? null` in the mapper, it becomes its
// own GROUP BY bucket, and — because rarity and regulation mark are both
// filter facets — it reaches the deck builder's rail as a bogus "None" chip
// that filters to a nonsense subset.
//
// SWEEP (production catalog, 3,786 cards, 2026-08-04). Every nullable text
// column the ingest path writes was checked against a sentinel alphabet of
// "" / whitespace / none / null / nil / n/a / na / unknown / undefined /
// "-" / "--" / "?" / no / false / 0 / tbd, case-insensitively:
//   - cards.rarity ............. 34 rows = "None"  (ALL of the `mfb` set)
//   - cards.regulation_mark ..... 2 rows = "None"  (mfb-33 Potion, mfb-34 Switch)
//   - cards.illustrator, .category, .stage, .trainer_type, .energy_type,
//     .evolve_from, .name, .local_id, .effect, .image_url, .updated ... 0
//   - sets.name, sets.tcg_online, series.name ....................... 0
//   - cards.types_json (the OTHER facet vocabulary, an array per row): no
//     "None" element, no "" element, no [] — checked separately, 0
// So "None" is the ONLY sentinel in the catalog today — but it lives in TWO
// columns, not the one the bug report named, and `rarity` is the 17×-bigger
// leak of the two. Both are user-visible facets.
//
// The alphabet below is deliberately NARROWER than the one swept with: only
// what a "no value" serialiser plausibly emits AND that no real catalog
// value could ever equal. "None" is not a rarity and not a regulation mark
// (marks are the single letters D–I); "" and whitespace are not values at
// all. Anything else — including a value that merely *looks* odd — is passed
// through untouched, because guessing is how a normaliser starts eating real
// data.
//
// The one invariant this must NOT break: NULL keeps meaning "no mark" /
// "no rarity", a real and common state (66 cards carry no regulation mark —
// 36 Basic Energy, 29 pre-mark Pokémon, 1 Trainer). A sentinel becomes NULL;
// NULL never becomes anything else, and nothing is ever filtered OUT of a
// result set by this module — only out of a *vocabulary* list.

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
 * duplicates collapsed, ORDER PRESERVED (the SQL DISTINCTs already sort).
 *
 * Dedupe is not theoretical: normalising can collapse two distinct stored
 * spellings ("None" and "") onto the same absence, and a facet list feeds
 * React `key`s.
 */
export function facetVocabulary(values: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeSentinel(value);
    if (normalized !== null) seen.add(normalized);
  }
  return [...seen];
}
