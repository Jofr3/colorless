// Resolves a lobby player's chosen deck into the flat card id list at match start. The read is
// owner-scoped and contents come from D1, so a client can neither use another user's deck nor forge
// the card list.

import { asc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { ownedBy } from "../db/owned";
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

/** A resolved deck: its flat card ids and the format it was built for (null when none was picked). */
export type LoadDeckResult =
  | { ok: true; ids: string[]; format: string | null }
  | { ok: false; reason: string };

/** Read a player's chosen deck as a flat id list, OWNER-SCOPED. Fails (never
    throws) when the player isn't signed in (`userId` null — an anonymous socket
    can own no deck), picked no deck, or named a deck that isn't theirs — the
    ownership check is a single `WHERE id = ? AND user_id = ?` on the one joined
    query, so someone else's deck reads the same as a missing one (no existence leak, the deck-routes
    precedent). Legality is `beginMatch`'s to enforce; this only proves the
    deck exists and is the player's. */
export async function loadPlayerDeck(
  db: Db,
  deckId: string | null,
  userId: string | null,
): Promise<LoadDeckResult> {
  if (userId === null) return { ok: false, reason: "you must be signed in to play a saved deck" };
  if (deckId === null) return { ok: false, reason: "no deck selected" };
  // One row per card line, or one row with null card columns for a deck with no cards.
  const rows = await db
    .select({ format: decks.format, cardId: deckCards.cardId, count: deckCards.count })
    .from(decks)
    .leftJoin(deckCards, eq(deckCards.deckId, decks.id))
    .where(ownedBy(decks, deckId, userId))
    .orderBy(asc(deckCards.cardId))
    .all();
  const [owned] = rows;
  if (owned === undefined) return { ok: false, reason: "deck not found" };
  const lines = rows.flatMap(({ cardId, count }) =>
    cardId === null || count === null ? [] : [{ cardId, count }],
  );
  return { ok: true, ids: deckIdsFromRows(lines), format: owned.format };
}
