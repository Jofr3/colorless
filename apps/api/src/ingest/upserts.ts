// Per-table upsert builders: the column specs that tie the ./map.ts rows to
// the SQL column names of migration 0000 (+ the 0001/0002 asset-URL rename),
// and thin wrappers over ./sql.ts's generic builder.
//
// Apply order matters — series → sets → cards (FKs) — but that is the CLI's
// job (apps/api/scripts/ingest.ts); these builders only produce statements.

import type { CardRow, SeriesRow, SetRow } from "./map";
import { buildUpsertSql, type SqlColumnSpec } from "./sql";

/** Keep card upsert files modest for `wrangler d1 execute --file` (§3.4). */
export const CARDS_PER_CHUNK = 100;

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
  { name: "variants_json", key: "variantsJson", kind: "json" },
  { name: "image_url", key: "imageUrl", kind: "text" },
  { name: "updated", key: "updated", kind: "text" },
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
