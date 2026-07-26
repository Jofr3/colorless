// The deck-library Deck (P1 milestone 7 — backend-data.md §5.2/§6): the web
// app's existing `Deck` vocabulary (src/features/decks/data.ts) extended with
// the persisted card list. Two projections:
//   - `Deck` — the full resource (GET /decks/:id): carries `cards`.
//   - `DeckSummary` — the list row (GET /decks): `cards` replaced by
//     `cardCount`, the summed counts, which is exactly the web shape's field.

import { z } from "zod";

/** One deck entry: a catalog card id ("sv01-001") and how many copies.
    Counts are 1–99 — 0 means "remove the entry", and 99 is a sanity cap
    (real formats allow 4, but the builder must not enforce format legality
    at the persistence layer). */
export const deckCardSchema = z.object({
  cardId: z.string().min(1),
  count: z.number().int().min(1).max(99),
});
export type DeckCard = z.infer<typeof deckCardSchema>;

/** Everything but the card list — shared by `Deck` and `DeckSummary`. */
const deckBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Play format ("standard" | "expanded" | …) — free text mirroring the
      nullable DB column; null when the player hasn't picked one. */
  format: z.string().nullable(),
  /** Base hue (0–360) for the deck's cover gradient (web `Deck.tint`). */
  tint: z.number().int().min(0).max(360),
  /** Owning folder, or null when the deck lives at the library root. */
  folderId: z.string().nullable(),
  /** Manual sort slot within the library — lists come back ordered by it
      ascending. Global per user (not per folder): a nest move keeps the
      deck's slot, exactly like the web grid's flat array. New decks take
      min-1 (they prepend), so negatives are normal. */
  position: z.number().int(),
  /** ISO datetime — the api serializes the epoch-ms DB column at the boundary. */
  updated: z.iso.datetime(),
});

/** The full deck resource — what GET /decks/:id (and create/patch) serve. */
export const deckSchema = deckBaseSchema.extend({
  cards: z.array(deckCardSchema),
  /** The cover the OWNER picked (P5-6), or null for "automatic" — the default
      the server derives from the contents. Deliberately NOT the same field as
      `DeckSummary.coverCardId`, which is the face actually being drawn: this is
      the stored CHOICE, the editor's state, and it is null for almost every
      deck. PATCH /decks/:id takes it under the same name. */
  chosenCoverCardId: z.string().nullable(),
});
export type Deck = z.infer<typeof deckSchema>;

/** The GET /decks list row: no card list, just the summed copy count. */
export const deckSummarySchema = deckBaseSchema.extend({
  cardCount: z.number().int().min(0),
  /** The card whose art fronts this deck in the library grid — the owner's
      `chosenCoverCardId` when they picked one that is still in the deck and
      drawable (P5-6), else the derived default (P5-3, `pickCoverCardId`), else
      null for a deck with nothing to show (an empty one, or one whose Pokémon
      have no scan yet). Resolved server-side on read, so it follows the deck's
      contents with nothing to keep in sync. */
  coverCardId: z.string().nullable(),
});
export type DeckSummary = z.infer<typeof deckSummarySchema>;
