// @luminous/schema — the shared vocabulary of the monorepo: Zod schemas and
// their inferred types, imported by both the web app and the api Worker.
// Grows in P1 milestone 2 with the tcgdex models and the lobby vocabulary
// (LobbySnapshot / LobbyMessage / LobbyIntent + lobbyReducer), and in
// milestone 5 with the canonical catalog domain (Card / Set / Serie) and in
// milestone 6 with the auth vocabulary (User + register/login requests) and in
// milestone 7 with the deck library (Deck / DeckSummary / Folder + requests) —
// see docs/workstreams/backend-data.md §5, §3.5, §6.

export * from "./auth";
export * from "./catalog";
export * from "./decks";
export * from "./health";
export * from "./lobby";
export * from "./match";
export * from "./tcgdex";
