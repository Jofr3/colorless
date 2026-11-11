// The deck-library Deck, in two projections:
//   - `Deck` — the full resource (GET /decks/:id): carries `cards`.
//   - `DeckSummary` — the list row (GET /decks): `cardCount`, the summed
//     counts, with `cards` only on complete decks.

import * as z from "zod";

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
  /** A folder id from stored data, or null. No route creates folders or files a deck in one, and
      the client lists every deck at the library root. */
  folderId: z.string().nullable(),
  /** Manual sort slot within the library; lists come back ordered by it ascending. Global per
      user. New decks take min-1 (they prepend), so negatives are normal. */
  position: z.number().int(),
  /** ISO datetime — the api serializes the epoch-ms DB column at the boundary. */
  updated: z.iso.datetime(),
  /** Bumped by every write. PATCH /decks/:id takes the version a save was made from and refuses
      it (409) once the deck has moved on. Optional so a web build can talk to an api from before
      versions; every current api response carries it. */
  version: z.number().int().min(0).optional(),
});

/** The full deck resource — what GET /decks/:id (and create/patch) serve. */
export const deckSchema = deckBaseSchema.extend({
  cards: z.array(deckCardSchema),
  /** The cover the OWNER picked, or null for "automatic" — the default
      the server derives from the contents. Deliberately NOT the same field as
      `DeckSummary.coverCardId`, which is the face actually being drawn: this is
      the stored CHOICE, the editor's state, and it is null for almost every
      deck. PATCH /decks/:id takes it under the same name. */
  chosenCoverCardId: z.string().nullable(),
});
export type Deck = z.infer<typeof deckSchema>;

/** The 409 body of a PATCH /decks/:id whose `version` the deck has moved past: the deck as it
    stands now, so the client can reload it without another request. */
export const deckConflictSchema = z.object({ error: z.string(), deck: deckSchema });
export type DeckConflict = z.infer<typeof deckConflictSchema>;

/** The GET /decks list row: the summed copy count, and the card list of a complete deck. */
export const deckSummarySchema = deckBaseSchema.extend({
  cardCount: z.number().int().min(0),
  /** The deck's entries in card id order, as GET /decks/:id serves them, on a deck of exactly
      DECK_SIZE cards and absent on any other: the pickers and the legality check judge complete
      decks only, so this spares them a request per deck while bounding each row at DECK_SIZE
      entries. Optional so a web build can talk to an api from before it, by fetching the deck. */
  cards: z.array(deckCardSchema).optional(),
  /** The card whose art fronts this deck in the library grid — the owner's
      `chosenCoverCardId` when they picked one that is still in the deck and
      drawable, else the derived default (`pickCoverCardId`), else
      null for a deck with nothing to show (an empty one, or one whose Pokémon
      have no scan yet). Resolved server-side on read, so it follows the deck's
      contents with nothing to keep in sync. */
  coverCardId: z.string().nullable(),
});
export type DeckSummary = z.infer<typeof deckSummarySchema>;
