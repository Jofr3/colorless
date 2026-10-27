// D1 row → deck-library domain mapping (P1 milestone 7, §5.2/§6) — the
// catalog/map.ts pattern: pure functions from Drizzle rows to the shapes in
// @colorless/schema/decks, so routes.ts owns queries and these unit-test flat.
// `user_id` never crosses the boundary — ownership is a WHERE clause, not a
// response field — and the epoch-ms `updated` column serializes to ISO here.

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
    `chosenCoverCardId` is the STORED pin (P5-6) — the editor's state, null for
    automatic — not the face being drawn, which is the summary's business. */
export function mapDeckRow(row: DeckRow, cards: readonly DeckCard[]): Deck {
  return {
    ...mapDeckBase(row),
    cards: cards.map(({ cardId, count }) => ({ cardId, count })),
    chosenCoverCardId: row.coverCardId,
  };
}

/** List row: `cardCount` is the SQL-side sum of the deck's copy counts, and
    `coverCardId` the deck's face (P5-3 — `pickCoverCardId`, null for a deck with
    nothing to show). */
export function mapDeckSummaryRow(
  row: DeckRow,
  cardCount: number,
  coverCardId: string | null,
): DeckSummary {
  return { ...mapDeckBase(row), cardCount, coverCardId };
}
