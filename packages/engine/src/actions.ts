import type { GameEvent } from "./events";
import type { GameState, PokemonTarget, Seat } from "./types";

// Player-decision actions. Everything with no choice in it (mulligan
// redraws, prize setting, the turn-start draw) auto-resolves inside the
// reducer; everything with a choice is one of these, validated against
// state.phase and the acting seat.

export interface ChooseFirstPlayerAction {
  type: "chooseFirstPlayer";
  /** The acting seat — must be the coin-flip winner. */
  seat: Seat;
  /** Who takes the first turn; the winner may pick either seat (§3.3). */
  first: Seat;
}

export interface SetupDrawExtraAction {
  type: "setupDrawExtra";
  seat: Seat;
  /** Mulligan-compensation cards to draw, 0 ≤ count ≤ owed ("may draw up to"). */
  count: number;
}

export interface SetupPlaceActiveAction {
  type: "setupPlaceActive";
  seat: Seat;
  /** A Basic Pokémon uid from the actor's hand. */
  uid: string;
}

export interface SetupPlaceBenchAction {
  type: "setupPlaceBench";
  seat: Seat;
  uid: string;
}

export interface SetupReadyAction {
  type: "setupReady";
  seat: Seat;
}

export interface AttachEnergyAction {
  type: "attachEnergy";
  seat: Seat;
  /** An Energy uid from the actor's hand. */
  uid: string;
  target: PokemonTarget;
}

export interface PlayBasicToBenchAction {
  type: "playBasicToBench";
  seat: Seat;
  uid: string;
}

export interface EvolveAction {
  type: "evolve";
  seat: Seat;
  /** An Evolution Pokémon uid from the actor's hand (its `evolveFrom` names
      the card it goes on top of, §10). */
  uid: string;
  /** Which of the actor's own in-play Pokémon to evolve (Active or Bench). */
  target: PokemonTarget;
}

export interface RetreatAction {
  type: "retreat";
  seat: Seat;
  /** Exactly which attached energy uids pay the cost — the count must equal
      the top card's retreat cost (§11; any energy pays, cost is Colorless). */
  discardEnergy: string[];
  /** Bench index of the Pokémon promoted to Active. */
  promoteBenchIndex: number;
}

export interface AttackAction {
  type: "attack";
  seat: Seat;
  /** Index into the Active's printed attacks (the top card defines them,
      §1.2). Runtime-checked — integer, in range — like every wire value. */
  index: number;
}

export interface TakePrizesAction {
  type: "takePrizes";
  seat: Seat;
  /** Exactly `count` (from the ko:takePrizes phase) distinct indices into
      the actor's own face-down prize row — the KOing player picks which of
      THEIR prizes to reveal into hand (§8.1). */
  prizeIndices: number[];
}

export interface PromoteAction {
  type: "promote";
  seat: Seat;
  /** Bench index of the Pokémon promoted into the empty Active spot (§8.1). */
  benchIndex: number;
}

export interface EndTurnAction {
  type: "endTurn";
  seat: Seat;
}

export type GameAction =
  | ChooseFirstPlayerAction
  | SetupDrawExtraAction
  | SetupPlaceActiveAction
  | SetupPlaceBenchAction
  | SetupReadyAction
  | AttachEnergyAction
  | PlayBasicToBenchAction
  | EvolveAction
  | RetreatAction
  | AttackAction
  | TakePrizesAction
  | PromoteAction
  | EndTurnAction;

export type ErrorCode =
  | "GAME_OVER"
  /** The action's `type` or `seat` is not one the engine knows. Unreachable
      through the typed API; the P4 server decodes actions off the wire. */
  | "UNKNOWN_ACTION"
  | "UNKNOWN_SEAT"
  | "BAD_PHASE"
  | "WRONG_SEAT"
  | "UNKNOWN_CARD"
  | "CARD_NOT_IN_HAND"
  | "NOT_A_BASIC_POKEMON"
  /** §10 — the played card is a Basic / non-Pokémon (no `evolveFrom`), so it
      cannot be placed on top of an in-play Pokémon as an evolution. */
  | "NOT_AN_EVOLUTION"
  /** §10 — the evolution's `evolveFrom` does not name the target's current
      top card, so it does not evolve from it. */
  | "EVOLVE_MISMATCH"
  /** §10 — the target came into play (or was itself evolved) this turn; a
      Pokémon evolves at most once per turn and never the turn it arrived. */
  | "EVOLVE_TOO_SOON"
  /** §4/§10 — neither player may evolve on their own first turn. */
  | "FIRST_TURN_EVOLVE"
  | "NOT_AN_ENERGY"
  | "NO_TARGET"
  | "BENCH_FULL"
  | "BENCH_EMPTY"
  | "BAD_BENCH_INDEX"
  /** attachEnergy's `target` failed the wire shape check (null / not an
      object / an unknown `spot`). */
  | "BAD_TARGET"
  | "BAD_EXTRA_COUNT"
  | "ACTIVE_ALREADY_PLACED"
  | "ACTIVE_NOT_PLACED"
  | "ALREADY_READY"
  | "ENERGY_ALREADY_ATTACHED"
  | "ENERGY_NOT_ATTACHED"
  | "RETREAT_COST_MISMATCH"
  | "ALREADY_RETREATED"
  /** §4 — the going-first player may not attack on turn 1. */
  | "FIRST_TURN_ATTACK"
  | "BAD_ATTACK_INDEX"
  | "ATTACK_COST_UNMET"
  /** §12 — an Asleep or Paralyzed Active cannot attack. (Confusion does not
      block declaring — it flips at resolution, attack.ts.) */
  | "STATUS_PREVENTS_ATTACK"
  /** §11/§12 — an Asleep or Paralyzed Active cannot retreat. */
  | "STATUS_PREVENTS_RETREAT"
  | "BAD_PRIZE_COUNT"
  | "BAD_PRIZE_INDEX"
  /** A parked ko:* phase that disagrees with the head pending stage —
      unreachable through the engine's own transitions (parking writes both
      together); a crafted or corrupted snapshot (attack.ts). */
  | "PHASE_DESYNC"
  // createGame rejections. They live in the SAME union as the action codes so
  // a host (the P4 Worker above all) has one `switch (error.code)` to write,
  // not two disjoint ones over two identical-looking envelopes.
  | "BAD_DECK_SIZE"
  | "UNKNOWN_CARD_ID"
  | "NO_BASIC_POKEMON";

export interface EngineError {
  code: ErrorCode;
  message: string;
}

/** Illegal actions NEVER throw and NEVER mutate — they come back as
    ok:false with a stable code (the authoritative P4 server keys off it). */
export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: EngineError };

export function ok(state: GameState, events: GameEvent[]): ApplyResult {
  return { ok: true, state, events };
}

export function err(code: ErrorCode, message: string): ApplyResult {
  return { ok: false, error: { code, message } };
}
