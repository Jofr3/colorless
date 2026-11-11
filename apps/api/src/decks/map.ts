// D1 row → deck-library domain mapping (§5.2/§6) — the
// catalog/map.ts pattern: pure functions from Drizzle rows to the shapes in
// @colorless/schema/decks, so routes.ts owns queries and these unit-test flat.
// `user_id` never crosses the boundary — ownership is a WHERE clause, not a
// response field — and the epoch-ms `updated` column serializes to ISO here.

import { DECK_SIZE } from "@colorless/engine";
import type { Deck, DeckCard, DeckSummary } from "@colorless/schema";
import type { decks } from "../db/schema";

export type DeckRow = typeof decks.$inferSelect;

/** The shared (cards-free) projection of a deck row. */
function mapDeckBase(row: DeckRow) {
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    tint: row.tint,
    folderId: row.folderId,
    position: row.position,
    updated: row.updated.toISOString(),
    version: row.version,
  };
}

/** Full deck: the row plus its (already user-scoped) deck_cards entries.
    `chosenCoverCardId` is the STORED pin — the editor's state, null for
    automatic — not the face being drawn, which is the summary's business. */
export function mapDeckRow(row: DeckRow, cards: readonly DeckCard[]): Deck {
  return {
    ...mapDeckBase(row),
    cards: cards.map(({ cardId, count }) => ({ cardId, count })),
    chosenCoverCardId: row.coverCardId,
  };
}

/** List row: `cardCount` is the sum of the deck's copy counts, `cards` its entries only when that
    sum is DECK_SIZE (the decks a picker or the legality check reads), and `coverCardId` the deck's
    face (`pickCoverCardId`, null for a deck with nothing to show). */
export function mapDeckSummaryRow(
  row: DeckRow,
  cards: readonly DeckCard[],
  coverCardId: string | null,
): DeckSummary {
  const cardCount = cards.reduce((sum, entry) => sum + entry.count, 0);
  return {
    ...mapDeckBase(row),
    cardCount,
    ...(cardCount === DECK_SIZE && {
      cards: cards.map(({ cardId, count }) => ({ cardId, count })),
    }),
    coverCardId,
  };
}
