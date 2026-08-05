// Deck & folder vocabulary (P1 milestone 7 — backend-data.md §5.2, §6): the
// server-persisted deck library. `Deck`/`Folder` keep the web app's existing
// field names (src/features/decks/data.ts) — extended with the card list —
// plus the create/patch request bodies the /decks and /folders routes parse.

export * from "./deck";
export * from "./folder";
export * from "./requests";
