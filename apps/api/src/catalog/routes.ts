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
import { asc, count, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { cards, series, sets } from "../db/schema";
import type { Env } from "../env";
import { facetVocabulary } from "../sentinel";
import { catalogCache } from "./cache";
import {
  cardBriefColumns,
  mapCardBriefRow,
  mapCardRow,
  mapSerieRow,
  mapSetBriefRow,
  mapSetRow,
} from "./map";
import { buildCardsWhere, cardsOrder, cardsQuerySchema, setsQuerySchema } from "./query";

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

catalogRoutes.get(
  "/cards",
  catalogCache,
  zValidator("query", cardsQuerySchema, (result, c) =>
    result.success ? undefined : invalidQuery(c, result.error),
  ),
  // ONE path for every query, id-hydration (`?id=…&id=…`) included: the id
  // set is a single JSON bind inside the where (../catalog/query.ts), so it
  // pages and orders in SQL like any other filter. It used to fork into a
  // chunked db.batch sorted by a JS twin of `cardsOrder` — see that function
  // for why the twin is gone (D197).
  async (c) => {
    const query = c.req.valid("query");
    const db = drizzle(c.env.DB);
    const where = buildCardsWhere(query);
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

/** Scalar facet rows → the string list, nulls and "no value" SENTINELS
    dropped (../sentinel.ts). SQL already sorted them and the DISTINCT
    already deduped, so order survives; the extra dedupe in
    `facetVocabulary` only matters when normalisation collapses two stored
    spellings onto the same absence. The SQL keeps its `isNotNull` guard —
    it is what makes the round trip cheap — and this catches what a string
    sentinel slips past it. */
const facetValues = (rows: { value: string | null }[]): string[] =>
  facetVocabulary(rows.map((row) => row.value));

// GET /facets — the filter vocabularies actually present in the catalog (P2
// task 10), feeding the web's selects instead of hardcoded constants. Eight
// DISTINCTs in one D1 round trip; `types` holds ARRAYS per row, so its
// distinct rows flatten + dedupe + sort in memory (the vocabulary is tiny).
//
// This is the endpoint where the sentinel was USER-VISIBLE: a facet list is
// rendered one chip per value in the builder's FilterRail, so the 34 rarity
// rows and 2 regulation-mark rows spelling absence as "None" put two dead
// chips in the rail (D194).
//
// It is ALSO the mechanism that lets `?suffix=` exist before any row carries
// a suffix (D198). `cards.suffix` is NULL catalog-wide until an ingest fills
// it, so this DISTINCT returns nothing, `suffixes` serves `[]`, and the rail
// renders no chip — the filter is unreachable rather than broken. That is the
// whole degradation story; there is no second guard anywhere, which is why
// this list must keep coming from the DATA and never from a constant.
catalogRoutes.get("/facets", catalogCache, async (c) => {
  const db = drizzle(c.env.DB);
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
      db
        .selectDistinct({ value: cards.suffix })
        .from(cards)
        .where(isNotNull(cards.suffix))
        .orderBy(asc(cards.suffix)),
    ]);
  const payload: CatalogFacets = {
    rarities: facetValues(rarityRows),
    // `types` is the one ARRAY-valued facet, so it flattens before it can go
    // through the same guard — sorted here rather than by SQL. Routed through
    // it anyway (the sweep measured zero sentinel elements and zero empty
    // arrays) so the invariant "no facet list can contain a sentinel" holds
    // for ALL EIGHT vocabularies, not seven of them. (Seven when this was
    // written; D198's `suffixes` made it eight and the count was not updated —
    // D203.)
    types: facetVocabulary(typeRows.flatMap((row) => row.value ?? [])).sort(),
    stages: facetValues(stageRows),
    trainerTypes: facetValues(trainerRows),
    energyTypes: facetValues(energyRows),
    illustrators: facetValues(illustratorRows),
    regulationMarks: facetValues(markRows),
    // Through the same sentinel guard as the rest, deliberately and in
    // advance: nothing has been ingested into this column yet, so unlike the
    // other seven there is no sweep behind it — a "None" suffix cannot be
    // ruled out until the first run, and this is the one place where letting
    // one through would put a dead chip in the rail (the ingest mapper
    // normalises the same value on the way IN, D197; neither guard is
    // redundant — see ./map.ts).
    suffixes: facetValues(suffixRows),
  };
  return c.json(catalogFacetsSchema.parse(payload));
});
