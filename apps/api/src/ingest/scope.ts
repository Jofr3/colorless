// What an ingest run fetches (apps/api/scripts/ingest.ts), kept here so it is unit-tested. Not
// re-exported from ./index.ts: the Worker never runs an ingest.

import { isTcgdexId } from "@colorless/schema";

/** The series and loose sets an ingest fetches. */
export interface IngestScope {
  readonly series: readonly string[];
  readonly sets: readonly string[];
}

/**
 * The whole catalog: Scarlet & Violet, Mega Evolution, and the Pokémon GO set for its reprints. A
 * run with neither `--serie` nor `--sets` refreshes all of it. A new serie or loose set joins here.
 */
export const CATALOG_SCOPE: IngestScope = { series: ["sv", "me"], sets: ["swsh10.5"] };

/** The scope the `--serie` and `--sets` flags ask for, or a message saying why they are wrong. */
export function ingestScope(flags: {
  serie?: string;
  sets?: string;
}): { scope: IngestScope } | { error: string } {
  if (flags.sets !== undefined && flags.serie !== undefined) {
    return { error: "pass either --sets or --serie, not both" };
  }
  let scope = CATALOG_SCOPE;
  if (flags.serie !== undefined) scope = { series: [flags.serie], sets: [] };
  if (flags.sets !== undefined) {
    const sets = flags.sets
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (sets.length === 0) return { error: "--sets names no set" };
    scope = { series: [], sets };
  }
  const badId = [...scope.series, ...scope.sets].find((id) => !isTcgdexId(id));
  if (badId !== undefined) return { error: `not a tcgdex id: ${JSON.stringify(badId)}` };
  return { scope };
}
