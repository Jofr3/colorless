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
  formatElapsed,
  logFromEvents,
} from "@luminous/engine";
import type { Card, LobbySnapshot, SeatLogEntry, WireAction } from "@luminous/schema";
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

/** What the DO persists when a lobby becomes a match: the authoritative
    full-information `GameState` plus the seed it was created from (audit/replay).
    Seats map by `SEAT_OF_SLOT`. Stored under the DO's match key and, from
    increment 1c, redacted per seat before it crosses the wire. */
export interface MatchRecord {
  /** The RNG seed the DO minted for this match. */
  seed: number;
  /** Epoch ms the match started — the log's "+MM:SS" elapsed origin (2b-iii-d-ii). */
  startedAt: number;
  /** Display names per seat (the lobby player names: host → p1, guest → p2) — the
      log's system rows read them ("Ana wins the toss"). Fixed for the match. */
  names: Record<Seat, string>;
  /** The engine's full game state — never sent whole to a client (online.md). */
  state: GameState;
  /** The accumulated game log, seat-keyed + leak-safe (@luminous/engine
      `logFromEvents`). Grows as actions apply; the DO broadcasts it WHOLE on every
      match frame (a reconnect gets the full backlog), and each client relabels it
      for its own seat (`viewLogEntries`). It can't be rebuilt from `state` — it is
      the running record of every event since createGame — so it is persisted here
      beside the state it describes. */
  log: SeatLogEntry[];
}

/** The engine action types the online client can DRIVE and RECOVER from: setup,
    the `moveToAction` turn drags (attach energy, bench a Basic, evolve, attach a
    Tool, play a Stadium), pass, the attack + KO loop (increment 2b-i — `attack`,
    then the KOing player's `takePrizes` and the KO'd player's `promote`),
    `retreat` (2b-ii), the effect:choose answer `resolveEffect` (2b-iii-c), and —
    from increment 3b — the activated Ability + non-Stadium Trainer plays
    (`useAbility` newly ON; `playTrainer` was already on but only the Stadium DRAG
    reached it, and now the OnlineHud turn panel sends it for Items/Supporters too).
    The DO rejects everything else — so a crafted frame can't push the match into a
    phase the online HUD renders no control for (a soft-lock; griefing-class).

    STILL DEFERRED (a missing affordance, not a soft-lock the engine can't recover
    from): **`rareCandy`**. It is a Trainer that EVOLVES via its own action + a
    two-step Basic/Stage-2 dialog reading `rareCandyOptions` off the full state, so
    it needs its own wire surface — a follow-up sub-slice — and stays off this set;
    a deck that NEEDS Rare Candy to progress can still stall on that one play.
    `redactedTrainersOf` (redact.ts) deliberately omits Rare Candy from the wire
    trainer list so no dead button is offered.

    SEQUENCING (allowing `attack`/`useAbility`/`playTrainer` is only soft-lock-safe
    because an effect:choose park they reach must have an online dialog): each is
    accepted and let park wherever the engine takes it — with an EFFECT attack /
    ability / trainer that is effect:choose. The invariant is "`resolveEffect` on
    this set ⟺ EVERY effect prompt kind has an online dialog." 2b-iii dialoged all
    seven kinds (a/b/c), so `resolveEffect` is ON and a real-deck effect play that
    parks at effect:choose drives to completion — the precondition real deck
    selection (3a) relied on, now MET. (`retreat` never carried the caveat — it only
    discards energy + promotes a Bench Pokémon, never parking at a decision, so it
    is soft-lock-safe with ANY deck; `useAbility`/`playTrainer` DO park, which is
    exactly why they wait for the dialoged effect layer.) `resolveEffect` itself is
    soft-lock-safe on any deck: `applyAction` rejects it off an effect:choose park,
    and on one it validates the choice against the parked prompt (validateChoice)
    before applying — a crafted frame rejects, never crashes/soft-locks. */
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
  "useAbility",
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
    (never throws on a bogus type/field, D14). On accept returns the next record —
    the state advanced AND the accepted events formatted into the log (`now` is the
    DO's wall clock, stamped once per action; the pure reducer takes it as an arg,
    the local `useLocalGame` pattern) — carrying seed/startedAt/names over. On
    reject returns a `reason` (an unsupported/illegal action changes nothing — the
    client's optimistic gesture already sprang back) so the DO can surface the
    transient rejection pill (P4 2b-iii-d). Pure — no DO/storage. */
export type MatchActionOutcome =
  | { ok: true; record: MatchRecord }
  | { ok: false; reason: string };

export function applyMatchAction(
  record: MatchRecord,
  seat: Seat,
  action: WireAction,
  now: number,
): MatchActionOutcome {
  // Off-allowlist types never reach the engine (the soft-lock gate) — a generic
  // reason, since there is no engine message to quote.
  if (!SUPPORTED_MATCH_ACTIONS.has(action.type)) {
    return { ok: false, reason: "That move isn't available here." };
  }
  const result = applyAction(record.state, { ...action, seat } as GameAction);
  // The engine's own rejection message is safe to surface: it describes the
  // ACTOR's own illegal move / wrong phase, never the opponent's hidden zones.
  if (!result.ok) return { ok: false, reason: result.error.message };
  // Format the accepted events into log rows (leak-safe: counts for hidden draws,
  // names off public state) and append. The log grows; seed/startedAt/names ride on.
  const entries = logFromEvents(result.events, {
    names: record.names,
    state: result.state,
    elapsed: formatElapsed(now - record.startedAt),
  });
  return {
    ok: true,
    record: { ...record, state: result.state, log: [...record.log, ...entries] },
  };
}
