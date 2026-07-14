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
  type Paginated,
  paginatedSchema,
  serieSchema,
  setBriefSchema,
  setWithCardsSchema,
} from "@luminous/schema";
import { asc, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { cards, series, sets } from "../db/schema";
import type { Env } from "../env";
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
