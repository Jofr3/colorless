// GET /cards, /sets, /series — the public catalog read API (§6).
//
// Every route: browser cache headers, query params validated with
// @hono/zod-validator (invalid → terse 400 JSON), KV cache-aside where a KV
// write pays for itself (./cache.ts: /facets, /series, /sets, /sets/:id and
// /cards pages 1-3, keyed by the validated query), Drizzle over D1, and the
// outgoing payload parsed through the canonical domain schemas at the
// boundary (the /health pattern) so row/schema drift fails loudly instead of
// leaking. Paired queries (page + count, set + its cards)
// go through db.batch() — one D1 round trip — except a free-text page, which
// carries its own count (cardsCountedPageStatement). A /cards or /facets request
// that misses KV is limited per IP, and what /cards reads then is logged
// (./searchLimit.ts).

import {
  CACHED_CARDS_PAGE_SIZES,
  type CardBrief,
  type CardsQuery,
  cardBriefSchema,
  cardSchema,
  cardsQuerySchema,
  type CatalogFacets,
  catalogFacetsSchema,
  FREE_TEXT_CATALOG_PARAMS,
  fullCardsQuerySchema,
  MAX_CACHED_CARDS_PAGE,
  type Paginated,
  paginatedSchema,
  serieSchema,
  setBriefSchema,
  setsQuerySchema,
  setWithCardsSchema,
} from "@colorless/schema";
import { asc, count, eq, sql } from "drizzle-orm";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import * as z from "zod";
import { cards, series, sets } from "../db/schema";
import type { Env } from "../env";
import { validate } from "../http/validation";
import { facetVocabulary } from "../sentinel";
import { catalogHttpCache, catalogPathCache, catalogQueryCache, catalogUncached } from "./cache";
import {
  type CardBriefRow,
  cardBriefColumns,
  mapCardBriefRow,
  mapCardRow,
  mapSerieRow,
  mapSetBriefRow,
  mapSetRow,
} from "./map";
import { buildCardsWhere, cardIdIn, cardsOrder } from "./query";
import {
  catalogScanLimit,
  catalogSearchLimit,
  countingReads,
  recordCatalogReads,
} from "./searchLimit";

export const catalogRoutes = new Hono<{ Bindings: Env }>();

// Response schemas — the domain shapes each route parses itself against.
const cardsResponseSchema = paginatedSchema(cardBriefSchema);
const fullCardsResponseSchema = z.array(cardSchema);
const setsResponseSchema = z.array(setBriefSchema);
const seriesResponseSchema = z.array(serieSchema);

/** Each KV-cached route's response schema (./cache.ts), whose shapes cacheShape.d1.test.ts pins to
    CACHE_VERSION. GET /cards/index is pinned there by its own columns. */
export const CACHED_RESPONSE_SCHEMAS = {
  "/cards": cardsResponseSchema,
  "/sets": setsResponseSchema,
  "/sets/:id": setWithCardsSchema,
  "/series": seriesResponseSchema,
  "/facets": catalogFacetsSchema,
};

/** The page and the match count for a /cards query. */
export function cardsPageStatements(db: DrizzleD1Database, query: CardsQuery) {
  const where = buildCardsWhere(query);
  return [
    db
      .select(cardBriefColumns)
      .from(cards)
      .where(where)
      .orderBy(...cardsOrder(query.sort))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(cards).where(where),
  ] as const;
}

/**
 * The page with the match count riding along on every row, for a free-text query. A typed term
 * matches sparsely, so filling the page walks most of the table and the count then scans it again;
 * the window counts during that one walk. It costs the table plus about the matches, so it halves
 * a typical search and costs a dense one-letter term up to 40% more than the pair. The window is
 * ordered like the page and framed over the whole result, so
 * SQLite feeds it straight off the sort's index; a bare `over ()` buffers every match and sorts it
 * again, about twice the pair's rows on that one-letter term.
 */
export function cardsCountedPageStatement(db: DrizzleD1Database, query: CardsQuery) {
  const order = cardsOrder(query.sort);
  const total = sql<number>`count(*) over (order by ${sql.join(order, sql`, `)}
    rows between unbounded preceding and unbounded following)`;
  return db
    .select({ ...cardBriefColumns, total })
    .from(cards)
    .where(buildCardsWhere(query))
    .orderBy(...order)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
}

/** The page's rows and the query's match count: a passed-back total is trusted, a free-text query
    counts in its page statement, and any other shape batches its page with an indexed count. */
async function cardsPage(
  db: DrizzleD1Database,
  query: CardsQuery,
): Promise<{ rows: CardBriefRow[]; total: number }> {
  // Every statement runs as a batch, the drizzle path whose results carry `rows_read`.
  const [page, matches] = cardsPageStatements(db, query);
  if (query.total !== undefined) {
    const [rows] = await db.batch([page]);
    return { rows, total: query.total };
  }
  if (FREE_TEXT_CATALOG_PARAMS.some((param) => query[param] !== undefined)) {
    const [rows] = await db.batch([cardsCountedPageStatement(db, query)]);
    const counted = rows[0]?.total;
    if (counted !== undefined) return { rows, total: counted };
    // A page past the last match has no row to carry the count, so only it is counted apart.
    if (query.page === 1) return { rows, total: 0 };
    const [totals] = await db.batch([matches]);
    return { rows, total: totals[0]?.total ?? 0 };
  }
  const [rows, totals] = await db.batch([page, matches]);
  return { rows, total: totals[0]?.total ?? 0 };
}

/** Whether KV may store a /cards page: one of the first MAX_CACHED_CARDS_PAGE, at a page size a
    client uses, and not carrying a passed-back `total`, which is echoed into the body. */
export function cardsCacheable(query: CardsQuery): boolean {
  return (
    query.page <= MAX_CACHED_CARDS_PAGE &&
    query.total === undefined &&
    CACHED_CARDS_PAGE_SIZES.includes(query.pageSize)
  );
}

/**
 * Whether a /cards query that missed KV spends the search budget: any query that names neither
 * ids nor an exact name. Those two are index lookups that read about one row per match whatever
 * else the query carries (queryPlan.d1.test.ts), and deck hydration and the decklist import send
 * them, so they are not limited.
 */
export function cardsQueryScans(query: CardsQuery): boolean {
  return query.id === undefined && query.nameExact === undefined;
}

/** A set's cards in collector order. */
export function setCardsStatement(db: DrizzleD1Database, setId: string) {
  return db
    .select(cardBriefColumns)
    .from(cards)
    .where(eq(cards.setId, setId))
    .orderBy(asc(cards.localId));
}

catalogRoutes.get(
  "/cards",
  catalogHttpCache,
  validate("query", cardsQuerySchema),
  catalogQueryCache(cardsQuerySchema, cardsCacheable),
  catalogSearchLimit(cardsQueryScans),
  async (c) => {
    const query = c.req.valid("query");
    const reads = { rows: 0 };
    const { rows, total } = await cardsPage(drizzle(countingReads(c.env.DB, reads)), query);
    recordCatalogReads(query, reads.rows);
    const payload: Paginated<CardBrief> = {
      items: rows.map(mapCardBriefRow),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
    return c.json(cardsResponseSchema.parse(payload));
  },
);

// Full Cards for a batch of ids, in id order; unknown ids are left out. Registered before
// /cards/:id, which would otherwise claim the path.
catalogRoutes.get(
  "/cards/full",
  catalogUncached,
  validate("query", fullCardsQuerySchema),
  async (c) => {
    const { id } = c.req.valid("query");
    const rows = await drizzle(c.env.DB)
      .select()
      .from(cards)
      .where(cardIdIn(id))
      .orderBy(asc(cards.id))
      .all();
    return c.json(fullCardsResponseSchema.parse(rows.map(mapCardRow)));
  },
);

catalogRoutes.get("/cards/:id", catalogUncached, async (c) => {
  const row = await drizzle(c.env.DB)
    .select()
    .from(cards)
    .where(eq(cards.id, c.req.param("id")))
    .get();
  if (row === undefined) {
    return c.json({ error: "card not found" }, 404);
  }
  return c.json(cardSchema.parse(mapCardRow(row)));
});

catalogRoutes.get(
  "/sets",
  catalogHttpCache,
  validate("query", setsQuerySchema),
  catalogQueryCache(setsQuerySchema),
  async (c) => {
    const { serie } = c.req.valid("query");
    const rows = await drizzle(c.env.DB)
      .select()
      .from(sets)
      .where(serie === undefined ? undefined : eq(sets.serieId, serie))
      .orderBy(asc(sets.releaseDate), asc(sets.id))
      .all();
    return c.json(setsResponseSchema.parse(rows.map(mapSetBriefRow)));
  },
);

catalogRoutes.get("/sets/:id", catalogPathCache, async (c) => {
  const setId = c.req.param("id");
  const db = drizzle(c.env.DB);
  const [setRows, cardRows] = await db.batch([
    db.select().from(sets).where(eq(sets.id, setId)),
    setCardsStatement(db, setId),
  ]);
  const row = setRows[0];
  if (row === undefined) {
    return c.json({ error: "set not found" }, 404);
  }
  return c.json(
    setWithCardsSchema.parse({ ...mapSetRow(row), cards: cardRows.map(mapCardBriefRow) }),
  );
});

catalogRoutes.get("/series", catalogPathCache, async (c) => {
  const db = drizzle(c.env.DB);
  // ~1 serie per era, so fetch all sets once and group in memory.
  const [serieRows, setRows] = await db.batch([
    db.select().from(series).orderBy(asc(series.releaseDate), asc(series.id)),
    db.select().from(sets).orderBy(asc(sets.releaseDate), asc(sets.id)),
  ]);
  const payload = serieRows.map((serieRow) =>
    mapSerieRow(
      serieRow,
      setRows.filter((setRow) => setRow.serieId === serieRow.id),
    ),
  );
  return c.json(seriesResponseSchema.parse(payload));
});

/** SQLite's BINARY collation order (UTF-8 bytes, which is code point order), the order the facet
    lists have always been served in. JS's default sort compares UTF-16 units instead, which
    disagrees for a character past U+FFFF. */
function binaryOrder(a: string, b: string): number {
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const x = left.next();
    const y = right.next();
    if (x.done || y.done) return Number(!x.done) - Number(!y.done);
    const difference = (x.value.codePointAt(0) ?? 0) - (y.value.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
}

/** One aggregate's JSON array → the facet list: nulls and "no value" SENTINELS dropped
    (../sentinel.ts), deduped (normalisation can collapse two stored spellings onto the same
    absence), then sorted. */
const facetValues = (json: string): string[] =>
  facetVocabulary(JSON.parse(json) as (string | null)[]).sort(binaryOrder);

/** The distinct values of a column as one JSON array, nulls included. */
const distinctValues = (column: SQLiteColumn) => sql<string>`json_group_array(distinct ${column})`;

/** Every facet's distinct values in one aggregate pass over cards, so /facets reads the table once
    rather than once per facet. `types` holds the stored JSON text of each distinct type list. */
export function facetsStatement(db: DrizzleD1Database) {
  return db
    .select({
      rarities: distinctValues(cards.rarity),
      types: distinctValues(cards.typesJson),
      stages: distinctValues(cards.stage),
      trainerTypes: distinctValues(cards.trainerType),
      energyTypes: distinctValues(cards.energyType),
      illustrators: distinctValues(cards.illustrator),
      regulationMarks: distinctValues(cards.regulationMark),
      suffixes: distinctValues(cards.suffix),
    })
    .from(cards);
}

// GET /facets: the filter vocabularies present in the catalog. This list must come from the data,
// never from a constant: the suffix filter stays unreachable until rows carry a suffix. A miss
// reads the whole table, so it spends the search budget.
catalogRoutes.get("/facets", catalogPathCache, catalogScanLimit("/facets"), async (c) => {
  const row = await facetsStatement(drizzle(c.env.DB)).get();
  // An aggregate without GROUP BY always yields one row, "[]" columns on an empty table.
  if (row === undefined) throw new Error("facet aggregate returned no row");
  const typeLists = (JSON.parse(row.types) as (string | null)[]).flatMap((list) =>
    list === null ? [] : (JSON.parse(list) as string[]),
  );
  const payload: CatalogFacets = {
    rarities: facetValues(row.rarities),
    types: facetVocabulary(typeLists).sort(binaryOrder),
    stages: facetValues(row.stages),
    trainerTypes: facetValues(row.trainerTypes),
    energyTypes: facetValues(row.energyTypes),
    illustrators: facetValues(row.illustrators),
    regulationMarks: facetValues(row.regulationMarks),
    suffixes: facetValues(row.suffixes),
  };
  return c.json(catalogFacetsSchema.parse(payload));
});
