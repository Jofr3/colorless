// The deck library's client-side row: a GET /decks summary as the library
// and sandbox pickers read it. `cardCount` is the server-derived summed copy
// count.

export type Deck = {
  id: string;
  name: string;
  /** Owning folder, or null when the deck lives at the library root. */
  folderId: string | null;
  /** Summed copies across the deck's card list (server-derived). */
  cardCount: number;
  /** Base hue (0–360) for the deck's cover gradient, so the grid reads colourful.
      Still the backdrop behind a cover, and the whole cover when there is none. */
  tint: number;
  /** The card whose art fronts this deck (P5-3), or null for a deck with nothing
      to show yet — server-derived, so it follows the deck's contents. */
  coverCardId: string | null;
  /** Manual sort slot (server-persisted, global per user). The library array
      stays sorted by it — array order IS the manual order — so a reorder
      rewrites both together. */
  position: number;
};
