# Roadmap

Five phases. Each has a detailed workstream doc; this is the map + dependencies.
Live status lives in `progress.md`, not here.

## Phase 1 — Backend & Data Foundation → `workstreams/backend-data.md`
Stand up the Bun + Hono API on Cloudflare. Ingest real tcgdex card data into D1,
mirror images to R2, add accounts + auth (email/password + Discord/Google),
persist decks/folders, and stand up the lobby Durable Object (WebSocket) server.
**Unblocks everything else.**

## Phase 2 — Deck Builder & Decks List (real cards) → `workstreams/deck-builder.md`
Replace the fixture card pool with the live catalog API. Complete the deck
editor (add/remove, counts, format validation, save/load) and the decks list
page (folders, CRUD, persistence). Upgrade filters using the richer tcgdex
fields (set/serie, rarity, HP, illustrator, regulation mark, ability/attack text,
energy cost).
*Depends on: P1 catalog + deck API.*

## Phase 3 — Simulator Engine → `workstreams/simulator.md`
Research the official Pokémon TCG rules (`reference/ptcg-rules.md`) and build the
game engine: a deterministic state machine + a card-effect system driven by the
imported card data + descriptions. Iterative — accuracy improves pass over pass;
unimplemented cards degrade gracefully. The goal is to replicate the real game.
*Depends on: P2 (real, usable decks) + the ruleset.*

## Phase 4 — Online Matches → `workstreams/online.md`
Run the P3 engine authoritatively inside the lobby Durable Object so two players
on different machines can play a real game. Swap the client lobby transport from
BroadcastChannel to WebSocket. Same engine as local play, with tweaks for
authority/hidden info.
*Depends on: P3 engine + P1 lobby DO.*

## Phase 5 — Polish → `workstreams/polish.md`
Now that user + card data exist: player names & profile pictures on the lobby,
profiles, real deck-cover art, and general refinement. Threads through P2–P4 but
tracked separately so it isn't forgotten.
*Depends on: P1 user data.*
