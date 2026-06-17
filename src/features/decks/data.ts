// Seed library for the decks page. These stand in for persisted data until a
// real store exists; the page treats them as the initial state and lets the
// player create, rename and remove their own decks and folders on top.

export type Deck = {
  id: string;
  name: string;
  /** Owning folder, or null when the deck lives at the library root. */
  folderId: string | null;
  cardCount: number;
  /** Base hue (0–360) for the deck's cover gradient, so the grid reads colourful. */
  tint: number;
};

export type Folder = {
  id: string;
  name: string;
};

export const SEED_FOLDERS: Folder[] = [
  { id: "folder-standard", name: "Standard" },
  { id: "folder-expanded", name: "Expanded" },
];

export const SEED_DECKS: Deck[] = [
  { id: "deck-charizard", name: "Charizard ex", folderId: "folder-standard", cardCount: 60, tint: 22 },
  { id: "deck-gardevoir", name: "Gardevoir ex", folderId: "folder-standard", cardCount: 60, tint: 320 },
  { id: "deck-lugia", name: "Lugia Archeops", folderId: null, cardCount: 60, tint: 205 },
  { id: "deck-lostbox", name: "Lost Box", folderId: "folder-expanded", cardCount: 60, tint: 268 },
  { id: "deck-miraidon", name: "Miraidon ex", folderId: null, cardCount: 60, tint: 52 },
  { id: "deck-snorlax", name: "Snorlax Stall", folderId: null, cardCount: 58, tint: 135 },
];
