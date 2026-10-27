// Authenticated deck routes. User data is never KV-cached. Each :id lookup is scoped to the user,
// so another user's deck returns the same 404 as a missing one.

import {
  createDeckRequestSchema,
  type Deck,
  type DeckCard,
  deckConflictSchema,
  deckSchema,
  deckSummarySchema,
  MAX_DECKS_PER_USER,
  patchDeckRequestSchema,
} from "@colorless/schema";
import { and, asc, eq, exists, inArray, type SQL, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { type Context, Hono } from "hono";
import * as z from "zod";
import { requireUser } from "../auth/requireUser";
import { chunk, D1_MAX_BOUND_PARAMS } from "../db/batch";
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

/** One IN query per D1 bound-parameter chunk naming which of `ids` the catalog knows; the caller
    runs them inside its own db.batch and hands the rows to `unknownCardsResponse`. */
function knownCardQueries(db: Db, ids: readonly string[]) {
  return chunk(ids, D1_MAX_BOUND_PARAMS).map((group) =>
    db.select({ id: cards.id }).from(cards).where(inArray(cards.id, group)),
  );
}

/** 400 naming the requested card ids absent from the catalog, or null when all exist. */
function unknownCardsResponse(
  c: Context,
  ids: string[],
  known: readonly { id: string }[][],
): Response | null {
  const unknown = unknownIds(
    ids,
    known.flat().map((row) => row.id),
  );
  return unknown.length === 0
    ? null
    : c.json({ error: "unknown card id(s)", cardIds: unknown }, 400);
}

/** How many decks the user has, against MAX_DECKS_PER_USER, and the `position` a created deck
    takes: one below the user's current minimum, so new decks land first in the position-ordered
    list. Two racing creates can tie, which is harmless: the id tiebreak keeps the order stable.
    They can also both pass the cap from one below it, which is as harmless: the cap bounds reads,
    it is not an exact quota. */
function deckSlotQuery(db: Db, userId: string) {
  return db
    .select({ count: sql<number>`count(*)`, min: sql<number | null>`min(${decks.position})` })
    .from(decks)
    .where(eq(decks.userId, userId));
}

/** Chunked `deck_cards` inserts for one deck (3 bound params per row). */
function deckCardInserts(db: Db, deckId: string, entries: readonly DeckCard[]) {
  const rowsPerInsert = Math.floor(D1_MAX_BOUND_PARAMS / 3);
  return chunk(entries, rowsPerInsert).map((group) =>
    db.insert(deckCards).values(group.map(({ cardId, count }) => ({ deckId, cardId, count }))),
  );
}

/** Replace a deck's card list by writing only what differs: rows whose card left the list are
    deleted, and the upsert skips rows whose count is unchanged. Both statements write only while
    the deck row matches `guard`, since a D1 batch carries on past a statement that changes
    nothing. The list travels as one JSON parameter, so neither statement grows with the deck. */
function deckCardReplacement(
  db: Db,
  deckId: string,
  entries: readonly DeckCard[],
  guard: SQL | undefined,
) {
  const keptIds = JSON.stringify(entries.map((entry) => entry.cardId));
  const rows = JSON.stringify(entries.map(({ cardId, count }) => [cardId, count]));
  const holds = exists(db.select({ id: decks.id }).from(decks).where(guard));
  return [
    db
      .delete(deckCards)
      .where(
        and(
          eq(deckCards.deckId, deckId),
          sql`${deckCards.cardId} not in (select "value" from json_each(${keptIds}))`,
          holds,
        ),
      ),
    db
      .insert(deckCards)
      .select(
        sql`select ${deckId}, "value" ->> 0, "value" ->> 1 from json_each(${rows}) where ${holds}`,
      )
      .onConflictDoUpdate({
        target: [deckCards.deckId, deckCards.cardId],
        set: { count: sql`excluded.count` },
        setWhere: sql`${deckCards.count} is not excluded.count`,
      }),
  ] as const;
}

/** The (already user-scoped) card list of one deck, in stable id order. */
function selectDeckCards(db: Db, deckId: string) {
  return db
    .select({ cardId: deckCards.cardId, count: deckCards.count })
    .from(deckCards)
    .where(eq(deckCards.deckId, deckId))
    .orderBy(asc(deckCards.cardId));
}

/** One full deck, only if `userId` owns it. */
async function readDeck(db: Db, deckId: string, userId: string): Promise<Deck | undefined> {
  const [deckRows, cardRows] = await db.batch([
    db
      .select()
      .from(decks)
      .where(ownedBy(decks, deckId, userId)),
    selectDeckCards(db, deckId),
  ]);
  const row = deckRows[0];
  return row === undefined ? undefined : deckSchema.parse(mapDeckRow(row, cardRows));
}

/** The answer to a patch its precondition refused: 404 when the deck is gone or not the caller's,
    else 409 with the deck as it stands now, for the client to reload. */
async function refusedPatchResponse(c: Context, db: Db, deckId: string, userId: string) {
  const deck = await readDeck(db, deckId, userId);
  return deck === undefined
    ? c.json({ error: "deck not found" }, 404)
    : c.json(deckConflictSchema.parse({ error: "deck changed since this version", deck }), 409);
}

// --- decks -------------------------------------------------------------------

deckRoutes.get("/", privateRevalidate, requireUser, async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("user").id;
  // Every deck's cards come from a second query in the same batch, joined to the catalog facts
  // the cover rule needs. Each deck's count, cover and (when complete) card list are derived from
  // those rows here rather than in SQL: the cover rule then lives in a pure `pickCoverCardId` that
  // can be argued with and tested, and the rows are one per distinct card per deck.
  const [rows, cardRows] = await db.batch([
    db
      .select()
      .from(decks)
      .where(eq(decks.userId, userId))
      .orderBy(asc(decks.position), asc(decks.id)),
    db
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
      .orderBy(asc(deckCards.deckId), asc(deckCards.cardId)),
  ]);
  const byDeck = new Map<string, CoverCandidate[]>();
  for (const row of cardRows) {
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
      rows.map((row) => {
        const candidates = byDeck.get(row.id) ?? [];
        return mapDeckSummaryRow(
          row,
          candidates,
          // The owner's pin wins over the derived default, but only while it is
          // still a drawable card in the deck (P5-6) — resolved against the
          // candidates already in hand, so honouring a choice costs no query.
          effectiveCoverCardId(row.coverCardId, candidates),
        );
      }),
    ),
  );
});

deckRoutes.get("/:id", privateRevalidate, requireUser, async (c) => {
  const deck = await readDeck(drizzle(c.env.DB), c.req.param("id"), c.get("user").id);
  return deck === undefined ? c.json({ error: "deck not found" }, 404) : c.json(deck);
});

deckRoutes.post("/", requireUser, validate("json", createDeckRequestSchema), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  const ids = body.cards.map((entry) => entry.cardId);
  const [slotRows, ...known] = await db.batch([
    deckSlotQuery(db, user.id),
    ...knownCardQueries(db, ids),
  ]);
  const slot = slotRows[0];
  if ((slot?.count ?? 0) >= MAX_DECKS_PER_USER) {
    return c.json({ error: "deck limit reached", limit: MAX_DECKS_PER_USER }, 409);
  }
  const badCards = unknownCardsResponse(c, ids, known);
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
    position: (slot?.min ?? 1) - 1,
    updated: new Date(),
    version: 0,
  };
  await db.batch([db.insert(decks).values(row), ...deckCardInserts(db, row.id, body.cards)]);
  return c.json(deckSchema.parse(mapDeckRow(row, body.cards)), 201);
});

deckRoutes.patch("/:id", requireUser, validate("json", patchDeckRequestSchema), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const deckId = c.req.param("id");
  const db = drizzle(c.env.DB);
  const owned = db
    .select()
    .from(decks)
    .where(ownedBy(decks, deckId, user.id));
  // A cover pin must name a card the deck still runs, and `cards` can be replaced by this same
  // request, so the list it has to live in is the one the patch leaves behind. The stored list is
  // read only for a pin without a new list, so the ordinary rename or autosave reads no cards.
  let existing: DeckRow | undefined;
  let badCards: Response | null = null;
  let cardIdsAfter: Set<string> | null = null;
  if (body.cards !== undefined) {
    const ids = body.cards.map((entry) => entry.cardId);
    const [deckRows, ...known] = await db.batch([owned, ...knownCardQueries(db, ids)]);
    existing = deckRows[0];
    badCards = unknownCardsResponse(c, ids, known);
    cardIdsAfter = new Set(ids);
  } else if ((body.chosenCoverCardId ?? null) !== null) {
    const [deckRows, storedCards] = await db.batch([owned, selectDeckCards(db, deckId)]);
    existing = deckRows[0];
    cardIdsAfter = new Set(storedCards.map((entry) => entry.cardId));
  } else {
    existing = await owned.get();
  }
  if (existing === undefined) {
    return c.json({ error: "deck not found" }, 404);
  }
  if (badCards !== null) {
    return badCards;
  }
  // A save made from an older copy is refused here without a write; the guarded batch below
  // refuses one that loses its race after this read.
  if (body.version !== undefined && existing.version !== body.version) {
    return refusedPatchResponse(c, db, deckId, user.id);
  }
  const chosen = body.chosenCoverCardId;
  if (chosen !== undefined && chosen !== null && cardIdsAfter?.has(chosen) !== true) {
    return c.json({ error: "cover card not in deck", cardIds: [chosen] }, 400);
  }
  // Only the fields the request names are written, so a patch from a tab holding an older copy
  // does not put back the fields another tab changed since. For the nullable fields, absent means
  // "keep" and null means "clear".
  const changes: SQLiteUpdateSetSource<typeof decks> = {
    updated: new Date(),
    version: sql`${decks.version} + 1`,
  };
  if (body.name !== undefined) changes.name = body.name;
  if (body.tint !== undefined) changes.tint = body.tint;
  if (body.format !== undefined) changes.format = body.format;
  if (body.folderId !== undefined) changes.folderId = body.folderId;
  if (chosen !== undefined) {
    // Explicit: a card id pins it, null goes back to the derived default.
    changes.coverCardId = chosen;
  } else if (body.cards !== undefined) {
    // A pinned card that left the deck in this patch takes the choice with it rather than
    // lingering as a pin nothing can honour. Judged against the stored pin, not the one read
    // above, which a concurrent patch may have changed.
    const keptIds = JSON.stringify(body.cards.map((entry) => entry.cardId));
    changes.coverCardId = sql`case when ${decks.coverCardId} in (select "value" from json_each(${keptIds})) then ${decks.coverCardId} end`;
  }
  // The write's precondition: the deck is still the caller's and, for a versioned save, still at
  // the version the save was made from. An unversioned patch is last-writer-wins, and still moves
  // the version so that versioned saves from other copies notice it.
  const precondition =
    body.version === undefined
      ? ownedBy(decks, deckId, user.id)
      : and(ownedBy(decks, deckId, user.id), eq(decks.version, body.version));
  const update = db.update(decks).set(changes).where(precondition).returning();
  if (body.cards === undefined) {
    const [updated, cardsAfter] = await db.batch([update, selectDeckCards(db, deckId)]);
    const row = updated[0];
    return row === undefined
      ? refusedPatchResponse(c, db, deckId, user.id)
      : c.json(deckSchema.parse(mapDeckRow(row, cardsAfter)));
  }
  // The card writes go before the UPDATE, the only statement that moves `version`, so all three
  // judge the precondition against the same row: either all of them write or none does.
  const [removeCards, upsertCards] = deckCardReplacement(db, deckId, body.cards, precondition);
  const [, , updated] = await db.batch([removeCards, upsertCards, update]);
  const row = updated[0];
  return row === undefined
    ? refusedPatchResponse(c, db, deckId, user.id)
    : c.json(deckSchema.parse(mapDeckRow(row, body.cards)));
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
