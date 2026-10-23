// Authenticated deck and folder routes. User data is never KV-cached. Each :id lookup is scoped to
// the user, so another user's resource returns the same 404 as a missing one, while a referenced
// folder you do not own is a 400.

import {
  createDeckRequestSchema,
  createFolderRequestSchema,
  type DeckCard,
  deckSchema,
  deckSummarySchema,
  folderSchema,
  patchDeckRequestSchema,
  patchFolderRequestSchema,
  type ReorderRequest,
  reorderRequestSchema,
} from "@colorless/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../auth/requireUser";
import { chunk, D1_MAX_BOUND_PARAMS, nonEmpty } from "../db/batch";
import { ownedBy } from "../db/owned";
import { cards, deckCards, decks, folders } from "../db/schema";
import type { Env } from "../env";
import { validate } from "../http/validation";
import { privateRevalidate } from "../httpCache";
import { type CoverCandidate, effectiveCoverCardId } from "./cover";
import { type DeckRow, type FolderRow, mapDeckRow, mapDeckSummaryRow, mapFolderRow } from "./map";
import { createsCycle, unknownIds } from "./validate";

export const deckRoutes = new Hono<{ Bindings: Env }>();
export const folderRoutes = new Hono<{ Bindings: Env }>();

type Db = DrizzleD1Database;

// Response schemas — the domain shapes each route parses itself against.
const deckSummariesResponseSchema = z.array(deckSummarySchema);
const foldersResponseSchema = z.array(folderSchema);

/** 400 when `folderId` names a folder the CALLER doesn't own — a folder that
    doesn't exist at all gets the same answer, so nothing about other users'
    trees leaks. Null (the library root) always passes. */
async function guardFolderRef(
  c: Context,
  db: Db,
  userId: string,
  folderId: string | null | undefined,
): Promise<Response | null> {
  if (folderId === null || folderId === undefined) {
    return null;
  }
  const row = await db
    .select({ id: folders.id })
    .from(folders)
    .where(ownedBy(folders, folderId, userId))
    .get();
  return row === undefined ? c.json({ error: "unknown folder" }, 400) : null;
}

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

/** The `position` a created deck/folder takes: one below the user's current
    minimum, so new rows land FIRST in the position-ordered lists (the web
    grid prepends creates). Two racing creates can tie — harmless, the id
    tiebreak keeps the order stable. */
async function nextPrependPosition(
  db: Db,
  table: typeof decks | typeof folders,
  userId: string,
): Promise<number> {
  const row = await db
    .select({ min: sql<number | null>`min(${table.position})` })
    .from(table)
    .where(eq(table.userId, userId))
    .get();
  return (row?.min ?? 1) - 1;
}

/** Both reorder routes: absolute position assignments, applied atomically in
    one batch. Any id that isn't the CALLER's answers a 400 naming it (the
    ids came from the request body, and a foreign id reads the same as a
    missing one — no existence leak). */
async function reorderRows(
  c: Context,
  db: Db,
  table: typeof decks | typeof folders,
  noun: "deck" | "folder",
  userId: string,
  positions: ReorderRequest["positions"],
): Promise<Response> {
  const ids = positions.map((entry) => entry.id);
  const queries = chunk(ids, D1_MAX_BOUND_PARAMS - 1).map((group) =>
    db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.userId, userId), inArray(table.id, group))),
  );
  const owned = await db.batch(nonEmpty(queries));
  const unknown = unknownIds(
    ids,
    owned.flat().map((row) => row.id),
  );
  if (unknown.length > 0) {
    return c.json({ error: `unknown ${noun} id(s)`, ids: unknown }, 400);
  }
  const updates = positions.map(({ id, position }) =>
    db.update(table).set({ position }).where(eq(table.id, id)),
  );
  await db.batch(nonEmpty(updates));
  return c.body(null, 204);
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
  const badFolder = await guardFolderRef(c, db, user.id, body.folderId);
  if (badFolder !== null) {
    return badFolder;
  }
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
    position: await nextPrependPosition(db, decks, user.id),
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
  const badFolder = await guardFolderRef(c, db, user.id, body.folderId);
  if (badFolder !== null) {
    return badFolder;
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

deckRoutes.post("/reorder", validate("json", reorderRequestSchema), requireUser, async (c) => {
  return reorderRows(
    c,
    drizzle(c.env.DB),
    decks,
    "deck",
    c.get("user").id,
    c.req.valid("json").positions,
  );
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

// --- folders -----------------------------------------------------------------

folderRoutes.get("/", privateRevalidate, requireUser, async (c) => {
  const rows = await drizzle(c.env.DB)
    .select()
    .from(folders)
    .where(eq(folders.userId, c.get("user").id))
    .orderBy(asc(folders.position), asc(folders.id))
    .all();
  return c.json(foldersResponseSchema.parse(rows.map(mapFolderRow)));
});

folderRoutes.post("/", validate("json", createFolderRequestSchema), requireUser, async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  const badParent = await guardFolderRef(c, db, user.id, body.parentId);
  if (badParent !== null) {
    return badParent;
  }
  const row: FolderRow = {
    id: crypto.randomUUID(),
    userId: user.id,
    parentId: body.parentId ?? null,
    name: body.name,
    position: await nextPrependPosition(db, folders, user.id),
  };
  await db.insert(folders).values(row);
  return c.json(folderSchema.parse(mapFolderRow(row)), 201);
});

folderRoutes.patch("/:id", validate("json", patchFolderRequestSchema), requireUser, async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const folderId = c.req.param("id");
  const db = drizzle(c.env.DB);
  // One user's folder list is small; fetch it whole — the ownership check,
  // the parent-reference check and the cycle walk all read the same rows.
  const rows = await db.select().from(folders).where(eq(folders.userId, user.id)).all();
  const target = rows.find((row) => row.id === folderId);
  if (target === undefined) {
    return c.json({ error: "folder not found" }, 404);
  }
  if (body.parentId !== undefined && body.parentId !== null) {
    if (!rows.some((row) => row.id === body.parentId)) {
      return c.json({ error: "unknown folder" }, 400);
    }
    const parents = new Map(rows.map((row) => [row.id, row.parentId]));
    if (createsCycle(parents, folderId, body.parentId)) {
      return c.json({ error: "cannot move a folder into itself or its own subtree" }, 400);
    }
  }
  const next: FolderRow = {
    ...target,
    name: body.name ?? target.name,
    parentId: body.parentId === undefined ? target.parentId : body.parentId,
  };
  await db
    .update(folders)
    .set({ name: next.name, parentId: next.parentId })
    .where(eq(folders.id, folderId));
  return c.json(folderSchema.parse(mapFolderRow(next)));
});

folderRoutes.post("/reorder", validate("json", reorderRequestSchema), requireUser, async (c) => {
  return reorderRows(
    c,
    drizzle(c.env.DB),
    folders,
    "folder",
    c.get("user").id,
    c.req.valid("json").positions,
  );
});

folderRoutes.delete("/:id", requireUser, async (c) => {
  const deleted = await drizzle(c.env.DB)
    .delete(folders)
    .where(ownedBy(folders, c.req.param("id"), c.get("user").id))
    .returning({ id: folders.id });
  if (deleted.length === 0) {
    return c.json({ error: "folder not found" }, 404);
  }
  // §5.3 FK semantics do the rest: subfolders cascade-delete with the parent,
  // and decks inside any deleted folder fall back to the library root
  // (folder_id SET NULL) — decks are never destroyed by folder deletion.
  return c.body(null, 204);
});
