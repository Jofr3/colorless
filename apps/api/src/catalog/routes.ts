// GET /cards, /sets, /series — the public catalog read API (§6).
//
// Every route: KV cache-aside middleware first (./cache.ts), query params
// validated with @hono/zod-validator (invalid → terse 400 JSON), Drizzle
// over D1, and the outgoing payload parsed through the canonical domain
// schemas at the boundary (the /health pattern) so row/schema drift fails
// loudly instead of leaking. Paired queries (page + count, set + its cards)
// go through db.batch() — one D1 round trip.

import { zValidator } from "@hono/zod-validator";
import {
  type CardBrief,
  cardBriefSchema,
  cardSchema,
  type CatalogFacets,
  catalogFacetsSchema,
  type Paginated,
  paginatedSchema,
  serieSchema,
  setBriefSchema,
  setWithCardsSchema,
} from "@luminous/schema";
import { and, asc, count, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { cards, series, sets } from "../db/schema";
import { chunk, D1_MAX_BOUND_PARAMS } from "../decks/validate";
import type { Env } from "../env";
import { catalogCache } from "./cache";
import {
  cardBriefColumns,
  type CardBriefRow,
  mapCardBriefRow,
  mapCardRow,
  mapSerieRow,
  mapSetBriefRow,
  mapSetRow,
} from "./map";
import {
  buildCardsWhere,
  type CardsQuery,
  cardsOrder,
  cardsQuerySchema,
  compareCardRows,
  setsQuerySchema,
} from "./query";

export const catalogRoutes = new Hono<{ Bindings: Env }>();

// Response schemas — the domain shapes each route parses itself against.
const cardsResponseSchema = paginatedSchema(cardBriefSchema);
const setsResponseSchema = z.array(setBriefSchema);
const seriesResponseSchema = z.array(serieSchema);

/** Terse 400 for bad query params, e.g. `{"error":"invalid query","issues":["pageSize: …"]}`. */
// zValidator surfaces the zod-core error type, hence z.core.$ZodError here.
function invalidQuery(c: Context, error: z.core.$ZodError) {
  const issues = error.issues.map(
    (issue) => `${issue.path.map(String).join(".") || "query"}: ${issue.message}`,
  );
  return c.json({ error: "invalid query", issues }, 400);
}

/** Ids per hydration statement — half the D1 cap, so each chunk's statement
    keeps generous headroom for the other composable filters' binds. */
const ID_CHUNK_SIZE = D1_MAX_BOUND_PARAMS / 2;

/** db.batch demands a non-empty tuple (the decks routes' shape). */
type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/**
 * The id-hydration path of GET /cards (repeatable `id`): one logical
 * `id IN (…)` AND-ed with the regular filters. Chunked into a single
 * db.batch because LIMIT/OFFSET bind parameters too — a lone 100-id
 * statement would already brush D1's cap. The ≤ MAX_ID_VALUES matches are
 * then ordered and paged in memory, mirroring the SQL path's semantics
 * (compareCardRows is cardsOrder's JS twin).
 */
async function cardsByIds(
  db: DrizzleD1Database,
  query: CardsQuery,
  ids: string[],
  where: SQL | undefined,
): Promise<Paginated<CardBrief>> {
  const selects: BatchItem<"sqlite">[] = chunk([...new Set(ids)], ID_CHUNK_SIZE).map((group) =>
    db
      .select(cardBriefColumns)
      .from(cards)
      .where(and(where, inArray(cards.id, group))),
  );
  const rows = ((await db.batch(selects as Batch)) as CardBriefRow[][]).flat();
  rows.sort((a, b) => compareCardRows(query.sort, a, b));
  const start = (query.page - 1) * query.pageSize;
  return {
    items: rows.slice(start, start + query.pageSize).map(mapCardBriefRow),
    page: query.page,
    pageSize: query.pageSize,
    total: rows.length,
  };
}

catalogRoutes.get(
  "/cards",
  catalogCache,
  zValidator("query", cardsQuerySchema, (result, c) =>
    result.success ? undefined : invalidQuery(c, result.error),
  ),
  async (c) => {
    const query = c.req.valid("query");
    const db = drizzle(c.env.DB);
    const where = buildCardsWhere(query);
    if (query.id !== undefined) {
      return c.json(cardsResponseSchema.parse(await cardsByIds(db, query, query.id, where)));
    }
    const [rows, totals] = await db.batch([
      db
        .select(cardBriefColumns)
        .from(cards)
        .where(where)
        .orderBy(...cardsOrder(query.sort))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db.select({ total: count() }).from(cards).where(where),
    ]);
    const payload: Paginated<CardBrief> = {
      items: rows.map(mapCardBriefRow),
      page: query.page,
      pageSize: query.pageSize,
      total: totals[0]?.total ?? 0,
    };
    return c.json(cardsResponseSchema.parse(payload));
  },
);

catalogRoutes.get("/cards/:id", catalogCache, async (c) => {
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
  catalogCache,
  zValidator("query", setsQuerySchema, (result, c) =>
    result.success ? undefined : invalidQuery(c, result.error),
  ),
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

catalogRoutes.get("/sets/:id", catalogCache, async (c) => {
  const setId = c.req.param("id");
  const db = drizzle(c.env.DB);
  const [setRows, cardRows] = await db.batch([
    db.select().from(sets).where(eq(sets.id, setId)),
    db
      .select(cardBriefColumns)
      .from(cards)
      .where(eq(cards.setId, setId))
      .orderBy(asc(cards.localId)),
  ]);
  const row = setRows[0];
  if (row === undefined) {
    return c.json({ error: "set not found" }, 404);
  }
  return c.json(
    setWithCardsSchema.parse({ ...mapSetRow(row), cards: cardRows.map(mapCardBriefRow) }),
  );
});

catalogRoutes.get("/series", catalogCache, async (c) => {
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

/** Non-null scalar facet rows → the string list (SQL already sorted them). */
const facetValues = (rows: { value: string | null }[]): string[] =>
  rows.flatMap((row) => (row.value !== null ? [row.value] : []));

// GET /facets — the filter vocabularies actually present in the catalog (P2
// task 10), feeding the web's selects instead of hardcoded constants. Seven
// DISTINCTs in one D1 round trip; `types` holds ARRAYS per row, so its
// distinct rows flatten + dedupe + sort in memory (the vocabulary is tiny).
catalogRoutes.get("/facets", catalogCache, async (c) => {
  const db = drizzle(c.env.DB);
  const [rarityRows, typeRows, stageRows, trainerRows, energyRows, illustratorRows, markRows] =
    await db.batch([
      db
        .selectDistinct({ value: cards.rarity })
        .from(cards)
        .where(isNotNull(cards.rarity))
        .orderBy(asc(cards.rarity)),
      db.selectDistinct({ value: cards.typesJson }).from(cards).where(isNotNull(cards.typesJson)),
      db
        .selectDistinct({ value: cards.stage })
        .from(cards)
        .where(isNotNull(cards.stage))
        .orderBy(asc(cards.stage)),
      db
        .selectDistinct({ value: cards.trainerType })
        .from(cards)
        .where(isNotNull(cards.trainerType))
        .orderBy(asc(cards.trainerType)),
      db
        .selectDistinct({ value: cards.energyType })
        .from(cards)
        .where(isNotNull(cards.energyType))
        .orderBy(asc(cards.energyType)),
      db
        .selectDistinct({ value: cards.illustrator })
        .from(cards)
        .where(isNotNull(cards.illustrator))
        .orderBy(asc(cards.illustrator)),
      db
        .selectDistinct({ value: cards.regulationMark })
        .from(cards)
        .where(isNotNull(cards.regulationMark))
        .orderBy(asc(cards.regulationMark)),
    ]);
  const payload: CatalogFacets = {
    rarities: facetValues(rarityRows),
    types: [...new Set(typeRows.flatMap((row) => row.value ?? []))].sort(),
    stages: facetValues(stageRows),
    trainerTypes: facetValues(trainerRows),
    energyTypes: facetValues(energyRows),
    illustrators: facetValues(illustratorRows),
    regulationMarks: facetValues(markRows),
  };
  return c.json(catalogFacetsSchema.parse(payload));
});
