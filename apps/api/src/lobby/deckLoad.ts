// Resolves a lobby player's chosen deck into the flat card id list at match start. The read is
// owner-scoped and contents come from D1, so a client can neither use another user's deck nor forge
// the card list.

import { and, asc, eq, gt } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { ownedBy } from "../db/owned";
import { deckCards, decks, sessions } from "../db/schema";

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

/** The account a lobby socket authenticated at its upgrade, and the session that did it. */
export type DeckOwner = { userId: string; sessionId: string };

/** Read a player's chosen deck as a flat id list, OWNER-SCOPED. Fails (never
    throws) when the player isn't signed in (`owner` null — an anonymous socket
    can own no deck), picked no deck, named a deck that isn't theirs, or their session has since
    ended. The ownership check is a single `WHERE id = ? AND user_id = ?` on the one joined
    query, so someone else's deck reads the same as a missing one (no existence leak, the deck-routes
    precedent). The session is re-checked in the same query: a socket keeps the account it
    authenticated at the upgrade for as long as it stays open, so without this a logout, an expiry
    or a revoked session would still play that account's decks. Legality is `beginMatch`'s to
    enforce; this only proves the deck exists and is the player's. */
export async function loadPlayerDeck(
  db: Db,
  deckId: string | null,
  owner: DeckOwner | null,
  now: number = Date.now(),
): Promise<LoadDeckResult> {
  if (owner === null) return { ok: false, reason: "you must be signed in to play a saved deck" };
  if (deckId === null) return { ok: false, reason: "no deck selected" };
  // One row per card line, or one row with null card columns for a deck with no cards. The
  // session joins on its primary key, so it adds no rows; `session` is null on every row once
  // the session has ended.
  const rows = await db
    .select({
      format: decks.format,
      session: sessions.id,
      cardId: deckCards.cardId,
      count: deckCards.count,
    })
    .from(decks)
    .leftJoin(
      sessions,
      and(
        eq(sessions.id, owner.sessionId),
        eq(sessions.userId, decks.userId),
        gt(sessions.expiresAt, new Date(now)),
      ),
    )
    .leftJoin(deckCards, eq(deckCards.deckId, decks.id))
    .where(ownedBy(decks, deckId, owner.userId))
    .orderBy(asc(deckCards.cardId))
    .all();
  const [owned] = rows;
  if (owned === undefined) return { ok: false, reason: "deck not found" };
  if (owned.session === null) return { ok: false, reason: "sign in again to play a saved deck" };
  const lines = rows.flatMap(({ cardId, count }) =>
    cardId === null || count === null ? [] : [{ cardId, count }],
  );
  return { ok: true, ids: deckIdsFromRows(lines), format: owned.format };
}
