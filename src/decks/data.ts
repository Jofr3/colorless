import type { DeckSummary } from "@colorless/schema";

/** The deck library's client-side row: the GET /decks summary fields the library and sandbox
    pickers read, `format` and `cards` for judging a complete deck without fetching it. The
    library array stays sorted by `position`. */
export type Deck = Pick<
  DeckSummary,
  | "id"
  | "name"
  | "format"
  | "folderId"
  | "cardCount"
  | "cards"
  | "tint"
  | "coverCardId"
  | "position"
  | "updated"
>;
