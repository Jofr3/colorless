// P4 — the lobby → engine handoff (online.md). When a lobby's countdown ends with
// both players ready, the DO starts a real match: it instantiates the P3 engine
// server-side and owns the RNG seed + hidden info. This module is the seam.
//
// The lobby has no p1/p2 concept — seats are "host"/"guest" — so the mapping to the
// engine's Seat is minted HERE, at match start: the host is p1, the guest is p2.
// Kept pure (no DO/storage/D1) so it unit-tests without a Worker: the DO loads the
// card pool from D1 (`loadCardPool`) and calls `startMatch`, then persists + redacts
// the result.

import {
  type CreateGameResult,
  type GameAction,
  type GameState,
  type Seat,
  applyAction,
  createGame,
} from "@luminous/engine";
import type { Card, LobbySnapshot, WireAction } from "@luminous/schema";
import { slotOf } from "./logic";

/** The one place the lobby's seats map to the engine's: host → p1, guest → p2. */
export const SEAT_OF_SLOT = { host: "p1", guest: "p2" } as const satisfies Record<
  "host" | "guest",
  Seat
>;

/** The engine seat whose REDACTED view the socket-holder `playerId` receives —
    host → p1, guest → p2 (SEAT_OF_SLOT), or null for a player not seated in this
    lobby (a refused/observer socket). The DO's per-viewer match broadcast keys
    each socket's redaction off this. */
export function matchSeatOf(snapshot: LobbySnapshot, playerId: string): Seat | null {
  const slot = slotOf(snapshot, playerId);
  return slot === null ? null : SEAT_OF_SLOT[slot];
}

export interface StartMatchOptions {
  /** The authoritative RNG seed the DO owns for this match (shuffle + coin flip). */
  seed: number;
  /** The host's 60-card deck as a flat list of catalog ids (becomes p1). */
  hostDeck: readonly string[];
  /** The guest's 60-card deck (becomes p2). */
  guestDeck: readonly string[];
  /** Every distinct card id in either deck, resolved to its full catalog Card. */
  cardPool: Record<string, Card>;
}

/** Create the engine game for a lobby handoff. A thin, deterministic wrapper over
    `createGame` that fixes the seat mapping; returns the engine's own result (which
    validates deck size + a Basic and pauses at the first-player choice, or reports
    a `CreateError`). */
export function startMatch(opts: StartMatchOptions): CreateGameResult {
  return createGame({
    seed: opts.seed,
    decks: { p1: [...opts.hostDeck], p2: [...opts.guestDeck] },
    cardPool: opts.cardPool,
  });
}

// --- Placeholder fixed decks (online.md) -----------------------------------
//
// Lobbies are account-less and store only an opaque deckId/deckName, not a card
// list (routes.ts), so the DO can't resolve a player's saved deck yet — real
// deck selection is increment 3. Until then both seats get a KNOWN-VALID deck of
// real catalog ids: a single Basic attacker plus its basic Energy. That is all
// the engine requires (60 cards + ≥1 Basic; it does NOT enforce the ≤4-copies
// deck rule). The two decks differ per seat so redaction asymmetry (increment 1c)
// is exercised on a real board.

function fixedDeck(attacker: string, energy: string): readonly string[] {
  // 24 attackers + 36 Energy = 60. Both are Basics/Energy present in the D1
  // catalog the DO resolves against (loadCardPool).
  return [
    ...Array.from({ length: 24 }, () => attacker),
    ...Array.from({ length: 36 }, () => energy),
  ];
}

/** The host/guest decks a lobby hands to the engine until real deck selection.
    host = Sneasel (sv06.5-013, {W} "Cut" → 10) + Water Energy; guest = Mareep
    (sv01-066, {L} "Static Shock" → 10) + Lightning Energy. */
export const FIXED_MATCH_DECKS = {
  host: fixedDeck("sv06.5-013", "sve-003"),
  guest: fixedDeck("sv01-066", "sve-004"),
} as const;

/** Every distinct catalog id the fixed decks reference — what the DO resolves
    from D1 into a `cardPool` (loadCardPool) before `startMatch`. */
export const FIXED_MATCH_CARD_IDS: readonly string[] = [
  ...new Set([...FIXED_MATCH_DECKS.host, ...FIXED_MATCH_DECKS.guest]),
];

/** What the DO persists when a lobby becomes a match: the authoritative
    full-information `GameState` plus the seed it was created from (audit/replay).
    Seats map by `SEAT_OF_SLOT`. Stored under the DO's match key and, from
    increment 1c, redacted per seat before it crosses the wire. */
export interface MatchRecord {
  /** The RNG seed the DO minted for this match. */
  seed: number;
  /** The engine's full game state — never sent whole to a client (online.md). */
  state: GameState;
}

/** The engine action types the online client can DRIVE and RECOVER from: setup,
    the `moveToAction` turn drags, pass, and — from increment 2b-i — the attack +
    KO loop (`attack`, then the KOing player's `takePrizes` and the KO'd player's
    `promote`). The DO rejects everything else — retreat / abilities / the
    effect:choose `resolveEffect` — so a crafted frame can't push the match into
    a phase the online HUD renders no control for (a soft-lock; griefing-class,
    the review's LOW). With the fixed basic-only decks (pure-damage attacks, no
    status/abilities), attack → ko:takePrizes → ko:promote is exactly the
    reachable loop and never reaches effect:choose, so nothing a legitimate
    client sends is blocked. Later 2b slices GROW this set as they land retreat,
    abilities/trainers and the effect dialogs.

    SEQUENCING CONSTRAINT (allowing `attack` is only soft-lock-safe because the
    decks are pure-damage): an `attack` here is accepted and let park wherever
    the engine takes it — with an EFFECT attack that is effect:choose, which the
    online HUD can't yet drive. So REAL deck selection (increment 3) must NOT
    ship before increment 2b-iii adds the effect:choose dialog + puts
    `resolveEffect` on this set. The guarantee is plan ordering, not a structural
    check — flagged so the coupling isn't lost. */
export const SUPPORTED_MATCH_ACTIONS: ReadonlySet<string> = new Set([
  "chooseFirstPlayer",
  "setupDrawExtra",
  "setupPlaceActive",
  "setupPlaceBench",
  "setupReady",
  "attachEnergy",
  "playBasicToBench",
  "evolve",
  "attachTool",
  "playTrainer",
  "attack",
  "takePrizes",
  "promote",
  "endTurn",
]);

/** Apply a client action to a persisted match (P4 increment 2). The action is
    BOUND to the actor's own `seat` — never the client-claimed `action.seat` — so
    a client can never act for its opponent, gated to the 2a-SUPPORTED types
    (`SUPPORTED_MATCH_ACTIONS`), then run through the engine's TOTAL `applyAction`
    (never throws on a bogus type/field, D14). Returns the next record on accept,
    or null on reject (an unsupported/illegal action changes nothing — the
    client's optimistic gesture already sprang back; the seed carries over
    unchanged). Pure — no DO/storage. */
export function applyMatchAction(
  record: MatchRecord,
  seat: Seat,
  action: WireAction,
): MatchRecord | null {
  if (!SUPPORTED_MATCH_ACTIONS.has(action.type)) return null;
  const result = applyAction(record.state, { ...action, seat } as GameAction);
  return result.ok ? { seed: record.seed, state: result.state } : null;
}
