// GET /cards/index: every card as one compact row (@colorless/schema `CardIndexPayload`), which
// the builder downloads once and searches in the browser, so a typed name or rules-text search
// costs no D1 rows (security audit CA1). The response depends on the catalog alone, so it is one
// KV entry per catalog epoch: a D1 read of the whole table only after an ingest or a KV miss.
//
// SQLite builds the JSON, one aggregate per set, and the Worker only joins those strings: parsing
// and re-serializing 5,000 rows would spend most of the Free plan's 10 ms of CPU, and one value for
// the whole catalog would near D1's 2 MB value cap.

import { CARD_INDEX_COLUMNS } from "@colorless/schema";
import { type SQL, sql } from "drizzle-orm";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { cards, sets } from "../db/schema";
import type { Env } from "../env";
import { catalogPathCache } from "./cache";

/** Each index column's stored value, by CARD_INDEX_COLUMNS name. */
const INDEX_VALUES: Record<(typeof CARD_INDEX_COLUMNS)[number], SQLiteColumn | SQL> = {
  id: cards.id,
  name: cards.name,
  category: cards.category,
  rarity: cards.rarity,
  hasImage: sql`(${cards.imageUrl} is not null)`,
  setId: cards.setId,
  localId: cards.localId,
  types: cards.typesJson,
  hp: cards.hp,
  regulationMark: cards.regulationMark,
  stage: cards.stage,
  trainerType: cards.trainerType,
  energyType: cards.energyType,
  suffix: cards.suffix,
  illustrator: cards.illustrator,
  // The reprint rule's verdict where the ingest post-pass wrote it, as GET /cards' `legal` filter.
  legalStandard: sql`coalesce(${cards.legalStandardEffective}, ${cards.legalStandard})`,
  legalExpanded: sql`coalesce(${cards.legalExpandedEffective}, ${cards.legalExpanded})`,
  // JSON columns go in as their stored text (a column value is a string to json_array).
  abilities: cards.abilitiesJson,
  attacks: cards.attacksJson,
  effect: cards.effect,
};

/** One JSON array of rows per set, and the set → serie map as one JSON object. */
export function cardIndexStatements(db: DrizzleD1Database) {
  const row = sql.join(
    CARD_INDEX_COLUMNS.map((column) => sql`${INDEX_VALUES[column]}`),
    sql`, `,
  );
  return [
    db
      .select({ rows: sql<string>`json_group_array(json_array(${row}))` })
      .from(cards)
      .groupBy(cards.setId),
    db.select({ series: sql<string>`json_group_object(${sets.id}, ${sets.serieId})` }).from(sets),
  ] as const;
}

/** The response body from the statements' results: the set arrays' rows spliced into one. */
export function cardIndexBody(sets: readonly { rows: string }[], series: string): string {
  const rows = sets.map((set) => set.rows.slice(1, -1)).filter((inner) => inner !== "");
  return `{"version":1,"series":${series},"cards":[${rows.join(",")}]}`;
}

export const cardIndexRoutes = new Hono<{ Bindings: Env }>();

cardIndexRoutes.get("/cards/index", catalogPathCache, async (c) => {
  const db = drizzle(c.env.DB);
  const [rowsBySet, series] = await db.batch(cardIndexStatements(db));
  return c.body(cardIndexBody(rowsBySet, series[0]?.series ?? "{}"), 200, {
    "Content-Type": "application/json",
  });
});
