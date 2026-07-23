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

**Increment 1b — DONE:** the DO seam. `LobbyDO`'s constructor now takes `env` (for D1);
new pure `loadCardPool(db, ids)` (`apps/api/src/lobby/cardPool.ts` — chunked `db.batch(inArray)`
→ `mapCardRow`, mirroring `guardUnknownCards`; the row→pool fold `poolFromRows` is unit-tested).
At the in-game handoff inside `alarm()`, a new private `handoffToMatch()` loads the pool,
mints an RNG seed (`crypto.getRandomValues`), calls `startMatch`, and persists a `MatchRecord`
`{seed, state}` under storage key `"match"` — BEFORE the in-game snapshot broadcasts (crash-safe
ordering; a mid-flip crash re-runs the handoff). Idempotent via a `MATCH_KEY`-exists guard.
Fixed placeholder decks in `match.ts` (`FIXED_MATCH_DECKS`: host = Sneasel `sv06.5-013` +
Water Energy, guest = Mareep `sv01-066` + Lightning Energy; 60 each, distinct per seat) +
`FIXED_MATCH_CARD_IDS` (the 4 distinct ids the DO resolves from D1). 1696 → 1702 tests.

**Increment 1c — DONE:** the redactor + wire + read-only client (D60, engine 0.40.0). The
match now CROSSES THE WIRE and renders. New PURE **`redactGame(state, seat) → RedactedGame`**
(`packages/engine/src/redact.ts`) — the per-viewer hidden-information filter, run server-side once
per socket, so no full `GameState` ever leaves the DO. **`RedactedGame`** is a `@luminous/schema`
wire type (`match/redacted.ts`, Zod source-of-truth, viewer-relative you/opponent): opponent hand a
count of positional-id backs (never the engine uid), prizes + decks counts, discards + Stadium
public, in-play redacted to anonymous backs during setup (no battle row → no HP leak), the
mid-effect prompt STRIPPED. Its subtle phase derivation (`phaseViewOf`) was MOVED out of the web
projection into the engine (`phaseView.ts`) so the projection and the redactor share ONE source
(verified byte-identical; the whole local suite stays green). The DO broadcasts each socket its view
on the in-game FLIP (a per-viewer fan-out `broadcastMatch`, gated on the countdown→in-game
transition) and on RECONNECT (`sendMatchIfInGame` in the three hello branches), keyed by
`matchSeatOf` (host→p1, guest→p2). `{kind:"match", game}` joins the lobby server-message union (Zod
+ exactness proof). Client: `useLobby` gains a `match` state (set on the frame; cleared when the
lobby leaves in-game so a rematch starts clean); a new **`OnlineMatch`** feeds the same `PlaymatView`
a `projectionFromRedacted(game)` in place of `MatchPlaceholder` — READ-ONLY (no-op drag/pass,
deny-all placement) until increment 2 drives turns. The wire round-trip is pinned to reconstruct
EXACTLY the local `projectGameState` board (the guard against the two redactors drifting). 1702 →
1719 tests, `bun run check` green.

**Increment 2a — DONE:** the authoritative action transport + the online SETUP flow (D61, engine
0.40.0). The match is now INTERACTIVE (setup + basic turn drags + pass). A new `{kind:"action",
action}` client frame (schema — `wireActionSchema` = `z.looseObject`, loosely typed on purpose: the
DO rebinds the seat and relies on `applyAction`'s totality) carries an engine `GameAction`. The DO's
new `case "action"` handler binds the action to the SOCKET's own seat via `matchSeatOf` (never the
client-claimed `action.seat` — a client can't act for its opponent), runs the pure
`applyMatchAction(record, seat, action)` (persist-before-broadcast), and re-fans each socket its
redacted view. `RedactedGame` gained a redacted **`phase`** (the action-routing discriminant —
setup:chooseFirst / drawExtra`{owed}` / place`{ready}` / turn:action / ko / effect / gameOver;
`pendingDecision` was folded into it and derived client-side). `moveToAction` + `placement.ts` were
refactored to a transport-agnostic context (`phaseKind` + `isViewerTurn` + `isReady`) so local AND
online drive ONE tested drag router / drop gate (the placement.test.ts lockstep unchanged). Client:
`useLobby.sendAction`; a new `OnlineHud` (chooseFirst / drawExtra / place-ready panels, gated on
`waitingOn === "you"`); `OnlineMatch` now wires drags → `moveToAction` → `sendAction`, pass →
`endTurn`, and the shared placement predicate. 1719 → 1730 tests, `bun run check` green.

**Match-record lifecycle (locked this increment):** the persisted match outlives EXACTLY the
match it describes. `handoffToMatch` writes `MATCH_KEY` once; `commit` drops it on the
`abandonsMatch(prev, next)` transition — any commit that takes the lobby OUT of in-game (only
`removeGuest` does: a guest's `bye` or the host's kick). Without this, a rematch in the same
lobby would hit the idempotency guard and reuse the previous pairing's `GameState`/seed — a
HIGH the review caught. The empty-lobby `deleteAll()` also clears it. Invariant: `MATCH_KEY`
present ⇒ phase in-game (the reverse can briefly fail on the load-failure path below).

**The handoff SEAM** (now wired): `apps/api/src/lobby/lobbyDO.ts` `alarm()`, the ONLY place
`phase` becomes `"in-game"` (countdown ends, both ready + both sockets live). It now starts
the match; the client still renders `MatchPlaceholder` (`src/features/online/LobbyRoom.tsx:259`)
until 1c broadcasts the redacted view.

**Known gaps carried into 1c/2 (review LOWs, deliberate):**
- **Load-failure wedge:** if `startMatch` fails (only when the D1 pool is incomplete — all 4
  fixed ids are confirmed present locally), `handoffToMatch` logs and returns without a record,
  but the lobby STILL flips to in-game (no game). Self-heals on the next abandon+rematch (no
  `MATCH_KEY` was written). Increment 2 must surface match-start errors to players.
- **Vacuous deck test:** `match.test.ts` builds the pool with synthetic Basics, so it pins deck
  size + pool coverage but NOT that the 4 ids exist/are-typed-right in the real catalog. A
  Worker-pool integration test resolving them through `loadCardPool` against a seeded D1 would
  close it (deferred — no D1 in the current vitest setup).

**Architectural decisions (D-log a real one when they lock):**
- **Redaction lives in the engine; the wire type in schema. DONE (1c, D60).** The engine
  produces ONE full-information `GameState` (redaction is explicitly "P4's job" — `events.ts:8`,
  `setup.ts:262`). The prior redactor was CLIENT-side + playmat-coupled
  (`src/features/game/projection.ts`), unusable by the DO. So 1c added the PURE
  **`redactGame(state, seat) → RedactedGame`** (`packages/engine/src/redact.ts`), with
  **`RedactedGame`** the wire type in `packages/schema` (`match/redacted.ts`). **No full
  `GameState` (opponent hand/deck/prizes) crosses the wire** — pinned by redact.test.ts's
  "LEAKS NOTHING" barrier + the projectionFromRedacted round-trip equality. The subtle phase
  derivation (`phaseViewOf`) MOVED into the engine (`phaseView.ts`), shared by the projection +
  the redactor (one source, no drift).
- Seats: host→p1, guest→p2 (minted at handoff — the lobby has no p1/p2). The DO keys each
  socket's redaction off `matchSeatOf(snapshot, playerId)` (`slotOf` → `SEAT_OF_SLOT`).
- **Fixed test decks + a server card pool** for now: lobbies are account-less
  (`lobby/routes.ts`) and store only opaque `deckId`/`deckName`, not the card list, and
  the deck routes are session-gated — so the DO can't resolve a player's saved deck yet.
  The DO builds `cardPool` from D1 (`env.DB` + `catalog/map.ts` `mapCardRow`); NOTE the
  `LobbyDO` constructor currently takes only `state` — **add `env` to it** for D1 access.

**Next increments (was "Slice 1", now split):**
- **1b — the DO seam. DONE** (see Status above): `env` on the constructor, `loadCardPool`,
  `handoffToMatch` persisting a `MatchRecord` under `MATCH_KEY`, fixed placeholder decks.
- **1c — the redactor + wire + read-only client. DONE** (see Status above): `redactGame`
  (engine) + `RedactedGame` (schema) + the `{kind:"match", game}` server message; the DO
  broadcasts each socket its redacted view on the flip + reconnect; `useLobby.match` +
  `OnlineMatch` render a read-only `PlaymatView` in place of `MatchPlaceholder`.
- **2a — the action transport + the online setup flow. DONE** (see Status above): the
  `{kind:"action"}` client frame, the DO's seat-bound `applyMatchAction` + re-broadcast, the
  redacted `phase`, the shared `moveToAction`/`placementPredicateFor`, `useLobby.sendAction`,
  `OnlineHud` + interactive `OnlineMatch`. Setup + basic turn drags + pass are playable online.
- **2b — the turn:action HUD + the ko/effect dialogs (NEXT).** The heavy panels: attacks
  (`attacksOf`/`effectAttackCost`/`costMet`), abilities, non-Stadium trainers, retreat — all read the
  FULL GameState (`GameHud.tsx` TurnPanel; `programPlayable`/`conditionHolds` — `index.ts:288-315`),
  unsafe over a projection. Two sub-problems: (1) put enough on the wire for the online HUD to know
  what's PLAYABLE (attack list + payability, retreat cost, ability/trainer options) without leaking,
  and (2) the ko:takePrizes / ko:promote / effect:choose DIALOGS — the first needs the redacted
  **effect PROMPT** 2a stripped (`RedactedPhase.effect:choose` carries no prompt; `redactPhase` in
  redact.ts + `decisionFromPhase` in projection.ts are the seams; a prompt built from the
  CONTROLLER's private zones must stay controller-only). Also: per-RECIPIENT EVENT redaction
  (`CARDS_DRAWN`/`MULLIGAN_REVEALED` reveal hidden uids — `events.ts:8`) + an event→log stream for
  the online board (`logFromEvents` is per-viewer already), and a rejection pill (the DO drops a
  rejected action silently today).
- **3:** real deck selection (resolve `deckId`→60 ids server-side), reconnect/timeouts,
  concede/rematch, spectate, and surfacing a match-start FAILURE to players (the load-failure
  wedge below).

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
