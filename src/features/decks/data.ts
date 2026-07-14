// The decks page's client-side shapes plus the mapping from the api's wire
// types (M9 — the page loads the library from GET /decks + GET /folders
// instead of seed fixtures). The web `Deck` keeps its original vocabulary;
// `cardCount` is now the server-derived summed copy count, no longer a seed
// stand-in. Imports from @luminous/schema are types-only so the web bundle
// stays zod-free.

import type { Deck as ApiDeck, DeckSummary } from "@luminous/schema";

export type Deck = {
  id: string;
  name: string;
  /** Owning folder, or null when the deck lives at the library root. */
  folderId: string | null;
  /** Summed copies across the deck's card list (server-derived). */
  cardCount: number;
  /** Base hue (0–360) for the deck's cover gradient, so the grid reads colourful. */
  tint: number;
};

export type Folder = {
  id: string;
  name: string;
  /** Owning folder, or null when the folder lives at the library root. Folders
      nest indefinitely by pointing at a parent folder. */
  parentId: string | null;
};

/** A GET /decks list row as the grid renders it. */
export function fromDeckSummary(row: DeckSummary): Deck {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folderId,
    cardCount: row.cardCount,
    tint: row.tint,
  };
}

/** A full deck resource (create/patch responses) as the grid renders it —
    `cardCount` derived by summing the card list, matching the server's own
    summary maths. */
export function fromDeck(resource: ApiDeck): Deck {
  return {
    id: resource.id,
    name: resource.name,
    folderId: resource.folderId,
    cardCount: resource.cards.reduce((sum, card) => sum + card.count, 0),
    tint: resource.tint,
  };
}

// The server `Folder` wire shape ({id, name, parentId}) is exactly the web
// shape, so folders need no mapper — the api rows are used as-is.
