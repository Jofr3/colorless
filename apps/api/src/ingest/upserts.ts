// Column specs mapping ./map.ts rows to catalog column names. These lists are hand-maintained; a
// column added to the schema but not here would never be written. Apply order (series, sets, cards)
// is the CLI's job.

import type { CardRow, SeriesRow, SetRow } from "./map";
import { buildUpsertSql, chunk, escapeSqlText, type SqlColumnSpec } from "./sql";

/** Keep card upsert files modest for `wrangler d1 execute --file` (§3.4). */
export const CARDS_PER_CHUNK = 100;

/** D1 refuses a statement over 100 KB; the margin covers the encoding of the file around it. */
export const MAX_STATEMENT_BYTES = 90_000;

// Specs are exported for the round-trip test in ./upserts.test.ts.
export const SERIES_COLUMNS: readonly SqlColumnSpec<SeriesRow>[] = [
  { name: "id", key: "id", kind: "text" },
  { name: "name", key: "name", kind: "text" },
  { name: "release_date", key: "releaseDate", kind: "text" },
  { name: "logo_url", key: "logoUrl", kind: "text" },
];

export const SETS_COLUMNS: readonly SqlColumnSpec<SetRow>[] = [
  { name: "id", key: "id", kind: "text" },
  { name: "serie_id", key: "serieId", kind: "text" },
  { name: "name", key: "name", kind: "text" },
  { name: "logo_url", key: "logoUrl", kind: "text" },
  { name: "symbol_url", key: "symbolUrl", kind: "text" },
  { name: "release_date", key: "releaseDate", kind: "text" },
  { name: "count_total", key: "countTotal", kind: "number" },
  { name: "count_official", key: "countOfficial", kind: "number" },
  { name: "legal_standard", key: "legalStandard", kind: "boolean" },
  { name: "legal_expanded", key: "legalExpanded", kind: "boolean" },
  { name: "tcg_online", key: "tcgOnline", kind: "text" },
  { name: "abbreviation", key: "abbreviation", kind: "text" },
];

export const CARDS_COLUMNS: readonly SqlColumnSpec<CardRow>[] = [
  { name: "id", key: "id", kind: "text" },
  { name: "set_id", key: "setId", kind: "text" },
  { name: "local_id", key: "localId", kind: "text" },
  { name: "name", key: "name", kind: "text" },
  { name: "category", key: "category", kind: "text" },
  { name: "illustrator", key: "illustrator", kind: "text" },
  { name: "rarity", key: "rarity", kind: "text" },
  { name: "regulation_mark", key: "regulationMark", kind: "text" },
  { name: "hp", key: "hp", kind: "number" },
  { name: "stage", key: "stage", kind: "text" },
  { name: "suffix", key: "suffix", kind: "text" },
  { name: "evolve_from", key: "evolveFrom", kind: "text" },
  { name: "types_json", key: "typesJson", kind: "json" },
  { name: "retreat", key: "retreat", kind: "number" },
  { name: "abilities_json", key: "abilitiesJson", kind: "json" },
  { name: "attacks_json", key: "attacksJson", kind: "json" },
  { name: "weaknesses_json", key: "weaknessesJson", kind: "json" },
  { name: "resistances_json", key: "resistancesJson", kind: "json" },
  { name: "trainer_type", key: "trainerType", kind: "text" },
  { name: "energy_type", key: "energyType", kind: "text" },
  { name: "effect", key: "effect", kind: "text" },
  { name: "legal_standard", key: "legalStandard", kind: "boolean" },
  { name: "legal_expanded", key: "legalExpanded", kind: "boolean" },
  { name: "print_key", key: "printKey", kind: "text" },
  {
    name: "legal_standard_effective",
    key: "legalStandardEffective",
    kind: "boolean",
    insertOnly: true,
  },
  {
    name: "legal_expanded_effective",
    key: "legalExpandedEffective",
    kind: "boolean",
    insertOnly: true,
  },
  { name: "variants_json", key: "variantsJson", kind: "json" },
  { name: "image_url", key: "imageUrl", kind: "text" },
  // Stored for reference only; tcgdex re-stamps whole sets at once, so comparing it would rewrite
  // every row of a set whose cards did not change.
  { name: "updated", key: "updated", kind: "text", derived: true },
];

export function seriesUpsertSql(rows: readonly SeriesRow[]): string {
  return buildUpsertSql("series", SERIES_COLUMNS, rows);
}

export function setsUpsertSql(rows: readonly SetRow[]): string {
  return buildUpsertSql("sets", SETS_COLUMNS, rows);
}

export function cardsUpsertSql(rows: readonly CardRow[]): string {
  return buildUpsertSql("cards", CARDS_COLUMNS, rows);
}

/**
 * The card upserts for `rows`: CARDS_PER_CHUNK rows a statement, halved until each statement fits
 * MAX_STATEMENT_BYTES, so a text-dense set fails here rather than on the remote database alone.
 */
export function cardsUpsertStatements(
  rows: readonly CardRow[],
  maxBytes = MAX_STATEMENT_BYTES,
): string[] {
  const fit = (part: readonly CardRow[]): string[] => {
    const sql = cardsUpsertSql(part);
    if (new TextEncoder().encode(sql).length <= maxBytes) return [sql];
    if (part.length === 1) {
      throw new Error(`card ${part[0]?.id} alone makes a ${maxBytes}+ byte statement`);
    }
    const half = Math.ceil(part.length / 2);
    return [...fit(part.slice(0, half)), ...fit(part.slice(half))];
  };
  return chunk(rows, CARDS_PER_CHUNK).flatMap(fit);
}

/** The reprint-rule post-pass: a print is effectively legal in a format when any print sharing
    its `print_key` is legal there per tcgdex. The CLI appends it scoped to each set's file, so the
    set's rows are right in the same import that upserts them, and runs it over the WHOLE table
    after every set, because a partial `--sets` ingest can still flip a rotated print elsewhere
    legal. Twins are looked up across the whole table either way. Only rows whose verdict changes
    are written. */
export function reprintLegalitySql(setId?: string): string {
  const twin = (flag: "legal_standard" | "legal_expanded") =>
    `EXISTS (SELECT 1 FROM cards AS twin WHERE twin.print_key = cards.print_key AND twin.${flag} = 1)`;
  const scope = setId === undefined ? "" : `\n  AND set_id = ${escapeSqlText(setId)}`;
  return `UPDATE cards SET
  legal_standard_effective = ${twin("legal_standard")},
  legal_expanded_effective = ${twin("legal_expanded")}
WHERE print_key IS NOT NULL${scope}
  AND (legal_standard_effective IS NOT ${twin("legal_standard")}
    OR legal_expanded_effective IS NOT ${twin("legal_expanded")});
`;
}
