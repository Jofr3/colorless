// GET /cards, /sets, /series — the public catalog read API (§6).
//
// Every route: browser cache headers, query params validated with
// @hono/zod-validator (invalid → terse 400 JSON), KV cache-aside where a KV
// write pays for itself (./cache.ts: /facets, /series, /sets, /sets/:id and
// /cards pages 1-3, keyed by the validated query), Drizzle over D1, and the
// outgoing payload parsed through the canonical domain schemas at the
// boundary (the /health pattern) so row/schema drift fails loudly instead of
// leaking. Paired queries (page + count, set + its cards)
// go through db.batch() — one D1 round trip.

import {
  type CardBrief,
  type CardsQuery,
  cardBriefSchema,
  cardSchema,
  cardsQuerySchema,
  type CatalogFacets,
  catalogFacetsSchema,
  fullCardsQuerySchema,
  MAX_CACHED_CARDS_PAGE,
  type Paginated,
  paginatedSchema,
  serieSchema,
  setBriefSchema,
  setsQuerySchema,
  setWithCardsSchema,
} from "@colorless/schema";
import { asc, count, eq, isNotNull } from "drizzle-orm";
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
  cardBriefColumns,
  mapCardBriefRow,
  mapCardRow,
  mapSerieRow,
  mapSetBriefRow,
  mapSetRow,
} from "./map";
import { buildCardsWhere, cardIdIn, cardsOrder } from "./query";

export const catalogRoutes = new Hono<{ Bindings: Env }>();

// Response schemas — the domain shapes each route parses itself against.
const cardsResponseSchema = paginatedSchema(cardBriefSchema);
const fullCardsResponseSchema = z.array(cardSchema);
const setsResponseSchema = z.array(setBriefSchema);
const seriesResponseSchema = z.array(serieSchema);

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
  // A passed-back `total` is echoed into the body, so a page that carries one is never stored.
  catalogQueryCache(
    cardsQuerySchema,
    (query) => query.page <= MAX_CACHED_CARDS_PAGE && query.total === undefined,
  ),
  async (c) => {
    const query = c.req.valid("query");
    const db = drizzle(c.env.DB);
    const [page, matches] = cardsPageStatements(db, query);
    const [rows, totals] =
      query.total === undefined
        ? await db.batch([page, matches])
        : [await page, [{ total: query.total }]];
    const payload: Paginated<CardBrief> = {
      items: rows.map(mapCardBriefRow),
      page: query.page,
      pageSize: query.pageSize,
      total: totals[0]?.total ?? 0,
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

/** Scalar facet rows → the string list, nulls and "no value" SENTINELS
    dropped (../sentinel.ts). SQL already sorted them and the DISTINCT
    already deduped, so order survives; the extra dedupe in
    `facetVocabulary` only matters when normalisation collapses two stored
    spellings onto the same absence. The SQL keeps its `isNotNull` guard —
    it is what makes the round trip cheap — and this catches what a string
    sentinel slips past it. */
const facetValues = (rows: { value: string | null }[]): string[] =>
  facetVocabulary(rows.map((row) => row.value));

// GET /facets: the filter vocabularies present in the catalog. This list must come from the data,
// never from a constant: the suffix filter stays unreachable until rows carry a suffix.
catalogRoutes.get("/facets", catalogPathCache, async (c) => {
  const db = drizzle(c.env.DB);
  const distinctOf = <Column extends SQLiteColumn>(column: Column) =>
    db.selectDistinct({ value: column }).from(cards).where(isNotNull(column)).orderBy(asc(column));
  const [
    rarityRows,
    typeRows,
    stageRows,
    trainerRows,
    energyRows,
    illustratorRows,
    markRows,
    suffixRows,
  ] = await db.batch([
    distinctOf(cards.rarity),
    db.selectDistinct({ value: cards.typesJson }).from(cards).where(isNotNull(cards.typesJson)),
    distinctOf(cards.stage),
    distinctOf(cards.trainerType),
    distinctOf(cards.energyType),
    distinctOf(cards.illustrator),
    distinctOf(cards.regulationMark),
    distinctOf(cards.suffix),
  ]);
  const payload: CatalogFacets = {
    rarities: facetValues(rarityRows),
    // `types` is array-valued, so it is flattened and sorted here, then passed through the same
    // sentinel guard as the other facets.
    types: facetVocabulary(typeRows.flatMap((row) => row.value ?? [])).sort(),
    stages: facetValues(stageRows),
    trainerTypes: facetValues(trainerRows),
    energyTypes: facetValues(energyRows),
    illustrators: facetValues(illustratorRows),
    regulationMarks: facetValues(markRows),
    suffixes: facetValues(suffixRows),
  };
  return c.json(catalogFacetsSchema.parse(payload));
});
