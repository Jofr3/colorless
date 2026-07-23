// P4 — the lobby → engine handoff (online.md). When a lobby's countdown ends with
// both players ready, the DO starts a real match: it instantiates the P3 engine
// server-side and owns the RNG seed + hidden info. This module is the seam.
//
// The lobby has no p1/p2 concept — seats are "host"/"guest" — so the mapping to the
// engine's Seat is minted HERE, at match start: the host is p1, the guest is p2.
// Kept pure (no DO/storage/D1) so it unit-tests without a Worker: the DO loads the
// card pool from D1 (`loadCardPool`) and calls `startMatch`, then persists + redacts
// the result.

import { type CreateGameResult, type GameState, type Seat, createGame } from "@luminous/engine";
import type { Card } from "@luminous/schema";

/** The one place the lobby's seats map to the engine's: host → p1, guest → p2. */
export const SEAT_OF_SLOT = { host: "p1", guest: "p2" } as const satisfies Record<
  "host" | "guest",
  Seat
>;

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
