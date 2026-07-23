// P4 — resolve catalog ids to full domain Cards for the engine's `cardPool`
// (online.md). The lobby → engine handoff needs every card in both decks as a
// `@luminous/schema` Card; the DO reads them out of D1 here, then hands the pool
// to `startMatch` (match.ts, which stays pure of D1).
//
// The query half mirrors `guardUnknownCards` (decks/routes.ts): one logical IN
// query, chunked to D1's bound-parameter cap and run in a single db.batch. The
// row→domain fold is the pure `poolFromRows`, so it unit-tests without a Worker.

import type { Card } from "@luminous/schema";
import { inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { type CardRow, mapCardRow } from "../catalog/map";
import { cards } from "../db/schema";
import { chunk, D1_MAX_BOUND_PARAMS } from "../decks/validate";

type Db = DrizzleD1Database;
type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/** Fold catalog rows into the engine's `id → Card` pool. Pure — the query half
    lives in `loadCardPool`. A duplicate id keeps the last row (rows come from a
    single keyed table, so duplicates don't arise in practice). */
export function poolFromRows(rows: readonly CardRow[]): Record<string, Card> {
  const pool: Record<string, Card> = {};
  for (const row of rows) {
    pool[row.id] = mapCardRow(row);
  }
  return pool;
}

/** Resolve `ids` to their full catalog Cards, keyed by id. Missing ids are
    simply absent from the result — `createGame` then reports `UNKNOWN_CARD_ID`,
    so the caller never has to pre-check the catalog. */
export async function loadCardPool(
  db: Db,
  ids: readonly string[],
): Promise<Record<string, Card>> {
  const distinct = [...new Set(ids)];
  if (distinct.length === 0) {
    return {};
  }
  const queries: BatchItem<"sqlite">[] = chunk(distinct, D1_MAX_BOUND_PARAMS).map((group) =>
    db.select().from(cards).where(inArray(cards.id, group)),
  );
  const results = (await db.batch(queries as Batch)) as CardRow[][];
  return poolFromRows(results.flat());
}
