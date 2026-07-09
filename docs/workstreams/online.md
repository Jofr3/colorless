# Workstream: Online Matches (Phase 4)

Goal: two players on different machines play a real game, with the **P3 engine**
running authoritatively server-side.

**Depends on:** P3 engine + P1 lobby Durable Object.

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
