// @luminous/engine — deterministic, pure PTCG game engine (P3).
//
// M1 surface: the setup sequence (shuffle, coin flip, hands + mulligans +
// compensation, placements, prizes), the turn loop with its mandatory draw
// and deck-out loss, energy attach, bench plays, retreat and pass. M2 adds
// the attack step: costs, weakness/resistance damage, Knock Outs with prize
// taking and forced promotion, and the full §14 win check — resolved through
// a staged turn tail that can park on player decisions. M3 adds the Special
// Conditions (§12) with their attack/retreat gates and the confusion flip,
// the Pokémon Checkup (§13) with its ticks, recoveries and KOs, and the
// first text-derived attack effects (effects.ts). M4 begins with evolution
// (§10): an Evolution card placed on an in-play Pokémon whose top card it
// evolves from, carrying over damage/energy/tools and clearing Special
// Conditions, under the §4/§10 timing rules. Spec:
// docs/workstreams/simulator.md; ruleset: docs/reference/ptcg-rules.md.
// Everything is (state, action) → result: no classes, no wall clock, no
// unseeded randomness — the same seed and actions replay identically. The
// package is shared by the web app (local play + the semantic animation
// event stream) and the api Worker (authoritative online matches, P4).

import type { ApplyResult, GameAction } from "./actions";
import { err } from "./actions";
import { attack, promote, takePrizes } from "./attack";
import { attachTool, playTrainer, rareCandy, resolveEffect, useAbility } from "./cardplay";
import {
  chooseFirstPlayer,
  setupDrawExtra,
  setupPlaceActive,
  setupPlaceBench,
  setupReady,
} from "./setup";
import { attachEnergy, endTurn, evolve, playBasicToBench, retreat } from "./turn";
import type { GameState, Seat } from "./types";

/** Engine milestone marker (M5 op-slice: handRefresh — Iono, which CLOSES the
    hand-refresh Supporter family. Three riders on the 0.18.0 op: `toBottom` (the
    hand alone is shuffled and put UNDER the deck, so the deck's order — and the
    next draws — survive, the whole strategic point of Iono over Judge), the
    `prizeCount` draw (each player draws their own remaining Prizes, so the player
    behind draws more), and `onlyIfAnyMoved` (with both hands empty, nobody draws).
    The op now moves every affected hand BEFORE any draw, which that all-or-nothing
    gate requires. Youngster/Judge/Brassius/Katy were 0.18.0). */
export const engineVersion = "0.20.0";

export type {
  ApplyResult,
  AttachEnergyAction,
  AttachToolAction,
  AttackAction,
  ChooseFirstPlayerAction,
  EndTurnAction,
  EngineError,
  ErrorCode,
  EvolveAction,
  GameAction,
  PlayBasicToBenchAction,
  PlayTrainerAction,
  PromoteAction,
  RareCandyAction,
  ResolveEffectAction,
  RetreatAction,
  SetupDrawExtraAction,
  SetupPlaceActiveAction,
  SetupPlaceBenchAction,
  SetupReadyAction,
  TakePrizesAction,
  UseAbilityAction,
} from "./actions";
export {
  ANY_ENERGY,
  applyDamageModifier,
  attacksOf,
  basicFromHandError,
  cardOfUid,
  energyProvidesOf,
  evolveFromOf,
  hpOf,
  isBasicPokemon,
  isEnergyCard,
  isSpecialEnergy,
  parseAttackDamage,
  prizeValueOf,
  resistanceOf,
  retreatCostOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
export type { DamageModifier, ParsedDamage } from "./cards";
export {
  effectiveAttackCost,
  effectiveMaxHp,
  effectiveRetreatCost,
  providedEnergy,
  stadiumEffectsOf,
} from "./continuous";
export { deriveAttackEffect } from "./effects";
export { rareCandyOptions } from "./cardplay";
export type { RareCandyOption } from "./cardplay";
export type { BoardCondition, CardFilter, EffectOp } from "./effects";
/** The one BoardCondition evaluator + its printed-text describer. Exported so a
    host holding raw engine state (today's hot-seat HUD) greys out a card whose
    printed "only if" gate is unmet using the SAME logic playTrainer rejects it
    by, and can say WHY. Both take a `GameState`: a P4 remote client holds a
    projection instead, which does not carry the Stadium's owner and redacts the
    prize arrays — see the P4 notes in docs/workstreams/simulator.md before
    reusing these online. */
export { conditionHolds, conditionNote } from "./interpreter";
export type {
  EffectChoice,
  EffectContinuation,
  EffectPrompt,
  PokemonRef,
} from "./interpreter";
export type {
  AbilityCost,
  AbilityProgram,
  CardProgram,
  EnergyOnAttach,
  EnergyProgram,
  PassiveEffects,
  StadiumEffects,
  TriggeredAbility,
  TriggerTiming,
} from "./registry";
export { programFor } from "./registry";
export type { DrawReason, GameEvent, StatusName } from "./events";
export type { CoinFace } from "./rng";
export { createGame } from "./setup";
export type { CreateErrorCode, CreateGameOptions, CreateGameResult } from "./setup";
export {
  BENCH_MAX,
  DECK_SIZE,
  DEFAULT_POISON_DAMAGE,
  HAND_SIZE,
  PRIZE_COUNT,
  SEATS,
  isImmobilized,
  otherSeat,
} from "./types";
export type {
  GameOutcome,
  GameOverReason,
  GameState,
  InPlayPokemon,
  PendingStage,
  Phase,
  PlayerSide,
  PokemonTarget,
  Seat,
  SpecialConditions,
  StadiumInPlay,
  TurnAllowances,
  TurnPhase,
} from "./types";
/** Exported for effect handlers: the shared turn gate every in-turn action
    runs first, and the M2 cost matcher. */
export { turnGate } from "./turn";
export { costMet } from "./attack";

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
    const outcome = state.phase.outcome;
    return err(
      "GAME_OVER",
      outcome.result === "win"
        ? `the game is over (${outcome.winner} won: ${outcome.reason})`
        : "the game is over (tie)",
    );
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
    case "evolve":
      return evolve(state, action);
    case "rareCandy":
      return rareCandy(state, action);
    case "retreat":
      return retreat(state, action);
    case "attack":
      return attack(state, action);
    case "playTrainer":
      return playTrainer(state, action);
    case "attachTool":
      return attachTool(state, action);
    case "useAbility":
      return useAbility(state, action);
    case "resolveEffect":
      return resolveEffect(state, action);
    case "takePrizes":
      return takePrizes(state, action);
    case "promote":
      return promote(state, action);
    case "endTurn":
      return endTurn(state, action);
    default:
      return err("UNKNOWN_ACTION", `unknown action type "${(action as { type: string }).type}"`);
  }
}

function isSeat(value: unknown): value is Seat {
  return value === "p1" || value === "p2";
}
