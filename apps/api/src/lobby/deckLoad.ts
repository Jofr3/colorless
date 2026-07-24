// P4 increment 3 — resolve a lobby player's CHOSEN deck into the flat 60-card id
// list the engine wants, at the match handoff. This is where the otherwise
// account-less lobby's one authenticated fact (the socket's `userId`, from the
// /ws session cookie) becomes load-bearing: the read is OWNER-SCOPED, so a
// crafted `select-deck` naming another user's deck id resolves to nothing.
//
// The pure `deckIdsFromRows` fold is unit-tested; `loadPlayerDeck` is the query
// half (D1, so untested here — the `loadCardPool` pattern). Contents come from
// D1, never the client: the client sends only an opaque `deckId`, so it can't
// forge the card list.

import { and, asc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { deckCards, decks } from "../db/schema";

type Db = DrizzleD1Database;

/** Compressed `(cardId, count)` deck rows → the flat id list `createGame` wants
    (each id repeated `count` times). Pure. Order follows the input rows; the
    engine shuffles under its own seed, so the order here only needs to be
    deterministic for a given deck (the query sorts by cardId). */
export function deckIdsFromRows(rows: readonly { cardId: string; count: number }[]): string[] {
  const ids: string[] = [];
  for (const { cardId, count } of rows) {
    for (let i = 0; i < count; i++) ids.push(cardId);
  }
  return ids;
}

export type LoadDeckResult = { ok: true; ids: string[] } | { ok: false; reason: string };

/** Read a player's chosen deck as a flat id list, OWNER-SCOPED. Fails (never
    throws) when the player isn't signed in (`userId` null — an anonymous socket
    can own no deck), picked no deck, or named a deck that isn't theirs — the
    ownership check is a single `WHERE id = ? AND user_id = ?`, so someone else's
    deck reads the same as a missing one (no existence leak, the deck-routes
    precedent). Card COUNTS (60 + a Basic) are the engine's to enforce at
    `startMatch`; this only proves the deck exists and is the player's. */
export async function loadPlayerDeck(
  db: Db,
  deckId: string | null,
  userId: string | null,
): Promise<LoadDeckResult> {
  if (userId === null) return { ok: false, reason: "you must be signed in to play a saved deck" };
  if (deckId === null) return { ok: false, reason: "no deck selected" };
  const owned = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .get();
  if (owned === undefined) return { ok: false, reason: "deck not found" };
  const rows = await db
    .select({ cardId: deckCards.cardId, count: deckCards.count })
    .from(deckCards)
    .where(eq(deckCards.deckId, deckId))
    .orderBy(asc(deckCards.cardId))
    .all();
  return { ok: true, ids: deckIdsFromRows(rows) };
}
