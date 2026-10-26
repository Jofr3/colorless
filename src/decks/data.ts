import type { DeckSummary } from "@colorless/schema";

/** The deck library's client-side row: the GET /decks summary fields the library and sandbox
    pickers read. The library array stays sorted by `position`. */
export type Deck = Pick<
  DeckSummary,
  "id" | "name" | "folderId" | "cardCount" | "tint" | "coverCardId" | "position"
>;
