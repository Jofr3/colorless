// Authenticated deck routes. User data is never KV-cached. Each :id lookup is scoped to the user,
// so another user's deck returns the same 404 as a missing one.

import {
  createDeckRequestSchema,
  type DeckCard,
  deckSchema,
  deckSummarySchema,
  patchDeckRequestSchema,
} from "@colorless/schema";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import * as z from "zod";
import { requireUser } from "../auth/requireUser";
import { chunk, D1_MAX_BOUND_PARAMS, nonEmpty } from "../db/batch";
import { ownedBy } from "../db/owned";
import { cards, deckCards, decks } from "../db/schema";
import type { Env } from "../env";
import { validate } from "../http/validation";
import { privateRevalidate } from "../httpCache";
import { type CoverCandidate, effectiveCoverCardId } from "./cover";
import { type DeckRow, mapDeckRow, mapDeckSummaryRow } from "./map";
import { unknownIds } from "./validate";

export const deckRoutes = new Hono<{ Bindings: Env }>();

type Db = DrizzleD1Database;

// Response schemas — the domain shapes each route parses itself against.
const deckSummariesResponseSchema = z.array(deckSummarySchema);

/** 400 naming the card ids absent from the catalog, or null when all exist.
    One logical IN query — chunked to D1's bound-parameter cap and run in a
    single db.batch round trip — instead of relying on FK error text. */
async function guardUnknownCards(
  c: Context,
  db: Db,
  entries: readonly DeckCard[],
): Promise<Response | null> {
  if (entries.length === 0) {
    return null;
  }
  const ids = entries.map((entry) => entry.cardId);
  const queries = chunk(ids, D1_MAX_BOUND_PARAMS).map((group) =>
    db.select({ id: cards.id }).from(cards).where(inArray(cards.id, group)),
  );
  const results = await db.batch(nonEmpty(queries));
  const unknown = unknownIds(
    ids,
    results.flat().map((row) => row.id),
  );
  return unknown.length === 0
    ? null
    : c.json({ error: "unknown card id(s)", cardIds: unknown }, 400);
}

/** The `position` a created deck takes: one below the user's current minimum, so new decks land
    first in the position-ordered list. Two racing creates can tie, which is harmless: the id
    tiebreak keeps the order stable. */
async function nextPrependPosition(db: Db, userId: string): Promise<number> {
  const row = await db
    .select({ min: sql<number | null>`min(${decks.position})` })
    .from(decks)
    .where(eq(decks.userId, userId))
    .get();
  return (row?.min ?? 1) - 1;
}

/** Chunked `deck_cards` inserts for one deck (3 bound params per row). */
function deckCardInserts(db: Db, deckId: string, entries: readonly DeckCard[]) {
  const rowsPerInsert = Math.floor(D1_MAX_BOUND_PARAMS / 3);
  return chunk(entries, rowsPerInsert).map((group) =>
    db.insert(deckCards).values(group.map(({ cardId, count }) => ({ deckId, cardId, count }))),
  );
}

/** The (already user-scoped) card list of one deck, in stable id order. */
function selectDeckCards(db: Db, deckId: string) {
  return db
    .select({ cardId: deckCards.cardId, count: deckCards.count })
    .from(deckCards)
    .where(eq(deckCards.deckId, deckId))
    .orderBy(asc(deckCards.cardId));
}

// --- decks -------------------------------------------------------------------

deckRoutes.get("/", privateRevalidate, requireUser, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("user").id;
  const rows = await db
    .select({ deck: decks, cardCount: sql<number>`coalesce(sum(${deckCards.count}), 0)` })
    .from(decks)
    .leftJoin(deckCards, eq(deckCards.deckId, decks.id))
    .where(eq(decks.userId, userId))
    .groupBy(decks.id)
    .orderBy(asc(decks.position), asc(decks.id))
    .all();
  // Cover candidates for the whole library in ONE query (P5-3), rather than the
  // window function this would need to fold into the aggregate above: the RULE
  // then lives in a pure `pickCoverCardId` that can be argued with and tested,
  // and the extra rows are one per distinct card per deck.
  const candidateRows = await db
    .select({
      deckId: deckCards.deckId,
      cardId: deckCards.cardId,
      count: deckCards.count,
      category: cards.category,
      hp: cards.hp,
      imageUrl: cards.imageUrl,
    })
    .from(deckCards)
    .innerJoin(decks, eq(decks.id, deckCards.deckId))
    .innerJoin(cards, eq(cards.id, deckCards.cardId))
    .where(eq(decks.userId, userId))
    .all();
  const byDeck = new Map<string, CoverCandidate[]>();
  for (const row of candidateRows) {
    const list = byDeck.get(row.deckId) ?? [];
    list.push({
      cardId: row.cardId,
      count: row.count,
      category: row.category,
      hp: row.hp,
      hasImage: row.imageUrl !== null,
    });
    byDeck.set(row.deckId, list);
  }
  return c.json(
    deckSummariesResponseSchema.parse(
      rows.map((row) =>
        mapDeckSummaryRow(
          row.deck,
          row.cardCount,
          // The owner's pin wins over the derived default, but only while it is
          // still a drawable card in the deck (P5-6) — resolved against the
          // candidates already in hand, so honouring a choice costs no query.
          effectiveCoverCardId(row.deck.coverCardId, byDeck.get(row.deck.id) ?? []),
        ),
      ),
    ),
  );
});

deckRoutes.get("/:id", privateRevalidate, requireUser, async (c) => {
  const deckId = c.req.param("id");
  const db = drizzle(c.env.DB);
  const [deckRows, cardRows] = await db.batch([
    db
      .select()
      .from(decks)
      .where(ownedBy(decks, deckId, c.get("user").id)),
    selectDeckCards(db, deckId),
  ]);
  const row = deckRows[0];
  if (row === undefined) {
    return c.json({ error: "deck not found" }, 404);
  }
  return c.json(deckSchema.parse(mapDeckRow(row, cardRows)));
});

deckRoutes.post("/", validate("json", createDeckRequestSchema), requireUser, async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  const badCards = await guardUnknownCards(c, db, body.cards);
  if (badCards !== null) {
    return badCards;
  }
  const row: DeckRow = {
    id: crypto.randomUUID(),
    userId: user.id,
    folderId: body.folderId ?? null,
    name: body.name,
    format: body.format ?? null,
    tint: body.tint,
    // A brand-new deck wears the derived default; picking a cover is an edit
    // you make later, in the editor, once there is something to pick.
    coverCardId: null,
    position: await nextPrependPosition(db, user.id),
    updated: new Date(),
  };
  await db.batch([db.insert(decks).values(row), ...deckCardInserts(db, row.id, body.cards)]);
  return c.json(deckSchema.parse(mapDeckRow(row, body.cards)), 201);
});

deckRoutes.patch("/:id", validate("json", patchDeckRequestSchema), requireUser, async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const deckId = c.req.param("id");
  const db = drizzle(c.env.DB);
  const existing = await db
    .select()
    .from(decks)
    .where(ownedBy(decks, deckId, user.id))
    .get();
  if (existing === undefined) {
    return c.json({ error: "deck not found" }, 404);
  }
  const badCards = await guardUnknownCards(c, db, body.cards ?? []);
  if (badCards !== null) {
    return badCards;
  }
  // A cover pin must name a card the deck still runs (P5-6) — and `cards` can
  // be replaced by this same request, so the list it has to live in is the one
  // the patch LEAVES BEHIND. Read only when a pin is actually in play, so the
  // ordinary rename/move patch costs nothing.
  const pinInPlay =
    (body.chosenCoverCardId ?? null) !== null ||
    (existing.coverCardId !== null && body.cards !== undefined);
  const cardIdsAfter = pinInPlay
    ? new Set((body.cards ?? (await selectDeckCards(db, deckId).all())).map((e) => e.cardId))
    : null;
  let coverCardId = existing.coverCardId;
  if (body.chosenCoverCardId !== undefined) {
    // Explicit: a card id pins it, null goes back to the derived default.
    coverCardId = body.chosenCoverCardId;
    if (coverCardId !== null && cardIdsAfter?.has(coverCardId) !== true) {
      return c.json({ error: "cover card not in deck", cardIds: [coverCardId] }, 400);
    }
  } else if (coverCardId !== null && cardIdsAfter !== null && !cardIdsAfter.has(coverCardId)) {
    // The pinned card left the deck in this patch, so the choice goes with it
    // rather than lingering as a pin nothing can honour.
    coverCardId = null;
  }
  const next: DeckRow = {
    ...existing,
    name: body.name ?? existing.name,
    tint: body.tint ?? existing.tint,
    // For the nullable fields, absent means "keep" and null means "clear".
    format: body.format === undefined ? existing.format : body.format,
    folderId: body.folderId === undefined ? existing.folderId : body.folderId,
    coverCardId,
    updated: new Date(),
  };
  const statements: BatchItem<"sqlite">[] = [
    db
      .update(decks)
      .set({
        name: next.name,
        tint: next.tint,
        format: next.format,
        folderId: next.folderId,
        coverCardId: next.coverCardId,
        updated: next.updated,
      })
      .where(eq(decks.id, deckId)),
  ];
  if (body.cards !== undefined) {
    // Wholesale replacement: delete + reinsert atomically in the same batch.
    statements.push(db.delete(deckCards).where(eq(deckCards.deckId, deckId)));
    statements.push(...deckCardInserts(db, deckId, body.cards));
  }
  await db.batch(nonEmpty(statements));
  const cardsAfter = body.cards ?? (await selectDeckCards(db, deckId).all());
  return c.json(deckSchema.parse(mapDeckRow(next, cardsAfter)));
});

deckRoutes.delete("/:id", requireUser, async (c) => {
  const deleted = await drizzle(c.env.DB)
    .delete(decks)
    .where(ownedBy(decks, c.req.param("id"), c.get("user").id))
    .returning({ id: decks.id });
  if (deleted.length === 0) {
    return c.json({ error: "deck not found" }, 404);
  }
  // deck_cards rows cascade away with the deck (§5.3 FKs).
  return c.body(null, 204);
});
