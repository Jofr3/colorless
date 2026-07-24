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
    the `moveToAction` turn drags, pass, the attack + KO loop (increment 2b-i —
    `attack`, then the KOing player's `takePrizes` and the KO'd player's
    `promote`), `retreat` (2b-ii), and — from increment 2b-iii-c — the effect:choose
    answer `resolveEffect`. The DO rejects everything else (abilities `useAbility`)
    — so a crafted frame can't push the match into a phase the online HUD renders
    no control for (a soft-lock; griefing-class, the review's LOW). With the fixed
    basic-only decks (pure-damage attacks, no status/abilities/trainers), the
    reachable game is exactly setup → the turn drags → attack → ko:takePrizes →
    ko:promote → retreat → endTurn, none of which reaches effect:choose, so
    nothing a legitimate client sends is blocked. Real decks (increment 3) GROW
    this set with abilities/trainers.

    SEQUENCING (allowing `attack` is only soft-lock-safe because an effect:choose
    park it reaches must have an online dialog): an `attack` is accepted and let
    park wherever the engine takes it — with an EFFECT attack that is effect:choose.
    The invariant is "`resolveEffect` on this set ⟺ EVERY effect prompt kind has an
    online dialog." 2b-iii SPLIT it: 2b-iii-a landed `mayDraw`, 2b-iii-b the
    PUBLIC-REF family (choosePokemon/choosePokemonMulti/moveEnergy/discardEnergy),
    and **2b-iii-c the hidden-candidate chooseCards/attachCards family — the LAST
    kinds, so `resolveEffect` now goes ON**. With every prompt kind dialoged, a
    real-deck effect attack that parks at effect:choose can be driven to completion
    online, so this precondition on real deck selection (increment 3) is now MET.
    (`retreat` never carried the caveat — it only discards energy + promotes a
    Bench Pokémon, never parking at a decision, so it is soft-lock-safe with ANY
    deck.) `resolveEffect` itself is soft-lock-safe on any deck: `applyAction`
    rejects it off an effect:choose park (unreachable with the fixed decks), and on
    one it validates the choice against the parked prompt (validateChoice) before
    applying — a crafted frame rejects, never crashes/soft-locks. */
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
  "retreat",
  "resolveEffect",
  "endTurn",
]);

/** Apply a client action to a persisted match (P4 increment 2). The action is
    BOUND to the actor's own `seat` — never the client-claimed `action.seat` — so
    a client can never act for its opponent, gated to the 2a-SUPPORTED types
    (`SUPPORTED_MATCH_ACTIONS`), then run through the engine's TOTAL `applyAction`
    (never throws on a bogus type/field, D14). On accept returns the next record;
    on reject returns a `reason` (an unsupported/illegal action changes nothing —
    the client's optimistic gesture already sprang back; the seed carries over
    unchanged) so the DO can surface the transient rejection pill (P4 2b-iii-d).
    Pure — no DO/storage. */
export type MatchActionOutcome =
  | { ok: true; record: MatchRecord }
  | { ok: false; reason: string };

export function applyMatchAction(
  record: MatchRecord,
  seat: Seat,
  action: WireAction,
): MatchActionOutcome {
  // Off-allowlist types never reach the engine (the soft-lock gate) — a generic
  // reason, since there is no engine message to quote.
  if (!SUPPORTED_MATCH_ACTIONS.has(action.type)) {
    return { ok: false, reason: "That move isn't available here." };
  }
  const result = applyAction(record.state, { ...action, seat } as GameAction);
  // The engine's own rejection message is safe to surface: it describes the
  // ACTOR's own illegal move / wrong phase, never the opponent's hidden zones.
  return result.ok
    ? { ok: true, record: { seed: record.seed, state: result.state } }
    : { ok: false, reason: result.error.message };
}
