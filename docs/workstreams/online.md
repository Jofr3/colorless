# Workstream: Online Matches (Phase 4)

Goal: two players on different machines play a real game, with the **P3 engine**
running authoritatively server-side.

**Depends on:** P3 engine + P1 lobby Durable Object.

## Status — P4 kickoff (2026-07-23)

**Started** (P3 engine broad enough at 0.39.0). **Milestone 1 (WS transport + lobby
over the DO) is already DONE** (P1 M8) — this workstream is really Milestone 2+.

**Increment 1a — DONE:** the engine is wired into `apps/api` (`@luminous/engine`
dependency added; imports + runs in the Worker/DO package, proven by tests). New pure
seam `apps/api/src/lobby/match.ts` — `startMatch({seed, hostDeck, guestDeck, cardPool})`
wraps `createGame`, fixing the seat mapping **host → p1, guest → p2** (`SEAT_OF_SLOT`);
`match.test.ts` pins the mapping, determinism, and deck-size rejection. 1693 → 1696 tests.

**The handoff SEAM** (verified): `apps/api/src/lobby/lobbyDO.ts:228`, inside `alarm()` —
the ONLY place `phase` becomes `"in-game"` (after the countdown ends with both ready +
both sockets live). Today it broadcasts and the client renders `MatchPlaceholder`
(`src/features/online/LobbyRoom.tsx:259`). That's where `startMatch` + the first per-seat
broadcast hook in.

**Architectural decisions (D-log a real one when they lock):**
- **Redaction lives in the engine; the wire type in schema.** The engine produces ONE
  full-information `GameState` (redaction is explicitly "P4's job" — `events.ts:8`,
  `setup.ts:262`). The only redactor today is CLIENT-side and playmat-coupled
  (`src/features/game/projection.ts` — imports `cardImageUrl`, outputs playmat
  `CardModel`s, so a DO can't use it). So P4 adds a PURE `redactGame(state, seat) →
  RedactedGame` in `packages/engine`, with `RedactedGame` a wire type in `packages/schema`.
  **No full `GameState` (opponent hand/deck/prizes) may cross the wire** (`projection.ts:5`).
- Seats: host→p1, guest→p2 (minted at handoff — the lobby has no p1/p2).
- **Fixed test decks + a server card pool** for now: lobbies are account-less
  (`lobby/routes.ts`) and store only opaque `deckId`/`deckName`, not the card list, and
  the deck routes are session-gated — so the DO can't resolve a player's saved deck yet.
  The DO builds `cardPool` from D1 (`env.DB` + `catalog/map.ts` `mapCardRow`); NOTE the
  `LobbyDO` constructor currently takes only `state` — **add `env` to it** for D1 access.

**Next increments (was "Slice 1", now split):**
- **1b — the DO seam.** Add `env` to the `LobbyDO` constructor; a `loadCardPool(db, ids)`
  (D1 `inArray` → `mapCardRow`); at line 228, `startMatch(fixed decks)` + persist the
  `GameState`/seed/seat-map under a new storage key. Server-only, testable.
- **1c — the redactor + wire + read-only client.** `redactGame` (engine) + `RedactedGame`
  (schema) + a `{kind:"match", game}` server message (Zod + the exactness proof, mirroring
  `wire.ts`); the DO broadcasts each socket its redacted view; the client adopts it
  (`useLobby`/a `useMatch` hook) and renders a read-only board (reuse `PlaymatView` +
  the `GameProjection` shape) in place of `MatchPlaceholder`.
- **2 — drive turns:** client sends actions (seat-bound like `lobbyDO.ts:156`), the DO
  `applyAction`s + broadcasts, with per-RECIPIENT event redaction (`CARDS_DRAWN`/
  `MULLIGAN_REVEALED` reveal hidden info — `events.ts:8`). The projection-unsafe greying
  gates (`programPlayable`/`conditionHolds` read full state — `index.ts:288-315`) need
  rework for the online HUD.
- **3:** real deck selection (resolve `deckId`→60 ids server-side), reconnect/timeouts,
  concede/rematch, spectate.

## What already exists (reuse it)
The lobby was built to swap transports without UI changes:
- `src/features/online/net/types.ts` — LobbySnapshot / LobbyMessage / LobbyIntent.
- `src/features/online/net/lobbyReducer.ts` — the authoritative reducer.
- `src/features/online/net/channel.ts` — the transport seam (currently
  BroadcastChannel).
These types + reducer move into `packages/schema` in P1 so the DO and client
share one source of truth.

## Plan
1. **Transport swap:** implement a WebSocket `channel.ts` against the lobby DO
   (`/lobby/:code/ws`). Lobby behaviour is unchanged — the DO runs the existing
   reducer.
2. **Match handoff:** when both players are ready, the DO transitions from lobby
   to **match**: it instantiates the P3 engine, deals, and drives the game.
3. **Authoritative engine in the DO:** the server owns the RNG seed and hidden
   info (hands, deck order, prizes); clients send intents and render the
   snapshots/events the DO broadcasts — the host-authoritative model the client
   already assumes.
4. **Reconnect / hibernation:** `PlayerState.id` already supports reconnect;
   handle DO hibernation + snapshot resync.
5. **Later:** spectate, per-recipient hidden-info filtering, anti-cheat.

## Milestones
1. WS transport + lobby over the DO (no game yet).
2. Lobby → match handoff; engine instance per lobby.
3. Per-player hidden-info snapshots + intent validation.
4. Reconnect, timeouts, concede/rematch.
