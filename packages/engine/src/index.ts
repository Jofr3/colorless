// @luminous/engine — deterministic, pure PTCG game engine (P3).
//
// M1 surface: the setup sequence (shuffle, coin flip, hands + mulligans +
// compensation, placements, prizes), the turn loop with its mandatory draw
// and deck-out loss, energy attach, bench plays, retreat and pass. Spec:
// docs/workstreams/simulator.md; ruleset: docs/reference/ptcg-rules.md.
// Everything is (state, action) → result: no classes, no wall clock, no
// unseeded randomness — the same seed and actions replay identically. The
// package is shared by the web app (local play + the semantic animation
// event stream) and the api Worker (authoritative online matches, P4).

import type { ApplyResult, GameAction } from "./actions";
import { err } from "./actions";
import {
  chooseFirstPlayer,
  setupDrawExtra,
  setupPlaceActive,
  setupPlaceBench,
  setupReady,
} from "./setup";
import { attachEnergy, endTurn, playBasicToBench, retreat } from "./turn";
import type { GameState, Seat } from "./types";

/** Engine milestone marker (M1 = core state machine). */
export const engineVersion = "0.1.0";

export type {
  ApplyResult,
  AttachEnergyAction,
  ChooseFirstPlayerAction,
  EndTurnAction,
  EngineError,
  ErrorCode,
  GameAction,
  PlayBasicToBenchAction,
  RetreatAction,
  SetupDrawExtraAction,
  SetupPlaceActiveAction,
  SetupPlaceBenchAction,
  SetupReadyAction,
} from "./actions";
export {
  basicFromHandError,
  cardOfUid,
  isBasicPokemon,
  isEnergyCard,
  retreatCostOf,
  topCardOf,
  topUid,
} from "./cards";
export type { DrawReason, GameEvent } from "./events";
export type { CoinFace } from "./rng";
export { createGame } from "./setup";
export type { CreateErrorCode, CreateGameOptions, CreateGameResult } from "./setup";
export { BENCH_MAX, DECK_SIZE, HAND_SIZE, PRIZE_COUNT, SEATS, otherSeat } from "./types";
export type {
  GameOverReason,
  GameState,
  InPlayPokemon,
  Phase,
  PlayerSide,
  PokemonTarget,
  Seat,
  SpecialConditions,
  TurnPhase,
} from "./types";
/** Exported for M2: the shared turn gate every in-turn action runs first. */
export { turnGate } from "./turn";

/** The one reducer. Dispatches on action type; each handler validates the
    phase and acting seat itself and returns ok/err without ever throwing
    or mutating its input.

    The two guards below are unreachable through the typed API but NOT through
    the wire: P4's authoritative Worker decodes actions from a client, and the
    never-throw contract has to hold for a bogus `type` or `seat` too (an
    unknown seat would otherwise index `players` with undefined and throw). */
export function applyAction(state: GameState, action: GameAction): ApplyResult {
  // A finished game accepts nothing further.
  if (state.phase.kind === "gameOver") {
    return err("GAME_OVER", `the game is over (${state.phase.winner} won: ${state.phase.reason})`);
  }
  if (!isSeat(action.seat)) {
    return err("UNKNOWN_SEAT", `"${String(action.seat)}" is not a seat`);
  }
  switch (action.type) {
    case "chooseFirstPlayer":
      return chooseFirstPlayer(state, action);
    case "setupDrawExtra":
      return setupDrawExtra(state, action);
    case "setupPlaceActive":
      return setupPlaceActive(state, action);
    case "setupPlaceBench":
      return setupPlaceBench(state, action);
    case "setupReady":
      return setupReady(state, action);
    case "attachEnergy":
      return attachEnergy(state, action);
    case "playBasicToBench":
      return playBasicToBench(state, action);
    case "retreat":
      return retreat(state, action);
    case "endTurn":
      return endTurn(state, action);
    default:
      return err("UNKNOWN_ACTION", `unknown action type "${(action as { type: string }).type}"`);
  }
}

function isSeat(value: unknown): value is Seat {
  return value === "p1" || value === "p2";
}
