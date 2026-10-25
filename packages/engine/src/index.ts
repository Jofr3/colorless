// @colorless/engine: a deterministic Pokémon TCG rules engine. Everything is
// (state, action) -> result with seeded randomness, so the same seed and actions
// replay identically. Shared by the web app (local play) and the API Worker
// (authoritative online matches). Spec: docs/workstreams/simulator.md; rules:
// docs/reference/ptcg-rules.md.

import type { ApplyResult, GameAction } from "./actions";
import { err, ok } from "./actions";
import { attack, promote, takePrizes } from "./attack";
import { reorderBench } from "./bench";
import {
  attachTool,
  playTrainer,
  rareCandy,
  resolveEffect,
  useAbility,
  useStadiumAbility,
} from "./cardplay";
import { advance, concede } from "./flow";
import { postStepChecks } from "./stateChecks";
import {
  chooseFirstPlayer,
  setupDrawExtra,
  setupPlaceActive,
  setupPlaceBench,
  setupReady,
} from "./setup";
import { attachEnergy, discardFromPlay, endTurn, evolve, playBasicToBench, retreat } from "./turn";
import type { GameState } from "./types";
import { isSeat } from "./types";

export const engineVersion = "0.555.0";

export type {
  ApplyResult,
  AttachEnergyAction,
  AttachToolAction,
  AttackAction,
  ChooseFirstPlayerAction,
  ConcedeAction,
  DiscardFromPlayAction,
  EndTurnAction,
  EngineError,
  ErrorCode,
  EvolveAction,
  GameAction,
  PlayBasicToBenchAction,
  PlayTrainerAction,
  PromoteAction,
  RareCandyAction,
  ReorderBenchAction,
  ResolveEffectAction,
  RetreatAction,
  SetupDrawExtraAction,
  SetupPlaceActiveAction,
  SetupPlaceBenchAction,
  SetupReadyAction,
  TakePrizesAction,
  UseAbilityAction,
  UseStadiumAbilityAction,
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
  isBasicEnergy,
  isBasicPokemon,
  isEnergyCard,
  isMegaEvolutionPokemonEx,
  isSpecialEnergy,
  parseAttackDamage,
  pokemonSuffixOf,
  prizeValueOf,
  resistanceOf,
  retreatCostOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
export type {
  DamageModifier,
  EnergyFace,
  ParsedDamage,
  PokemonSuffix,
  PreventedAttackerClass,
} from "./cards";
export { normalizeCardText } from "./cardText";
export {
  alliedRetreatDiscount,
  attackBlockOf,
  attackLocked,
  countAttachedEnergy,
  countEnergyInPlay,
  disabledAbilityUids,
  effectiveAttackCost,
  effectiveMaxHp,
  attackGateOf,
  effectiveRetreatCost,
  firstTurnAttackBanned,
  handPlayBarred,
  hasAttachedEnergy,
  hasFreeRetreatAura,
  hasFreeRetreatSelf,
  boostedAttackBase,
  boostedAttackDamage,
  installedNoWeakness,
  installedReductionOf,
  lockedAttackIndexes,
  lockedAttackNames,
  opposingRetreatBlocked,
  retreatLocked,
  opposingRetreatSurcharge,
  pokemonPlayBarred,
  providedEnergy,
  seatRemovesWeakness,
  stadiumEffectsOf,
} from "./continuous";
export { benchLimitForIds, benchLimitOf } from "./continuous";
export { attackMenuOf, effectiveTypesOf, inPlayCardOf } from "./continuous";
export type { AttackMenuEntry } from "./continuous";
export {
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
  timingGateFromAttackText,
} from "./effects";
export { rareCandyOptions } from "./cardplay";
export type { RareCandyOption } from "./cardplay";
export type {
  AttachTargetRiders,
  AttackCoinFlip,
  AttackDamageBonus,
  AttackGateClause,
  AttackDamageSuppression,
  AttackFlipCount,
  AttackFlipThreshold,
  AttackOptionalBoost,
  BoardCondition,
  CardFilter,
  DamageCountSource,
  EffectOp,
  EffectSlot,
  OpponentEnergyZone,
} from "./effects";
export { conditionHolds, conditionNote } from "./boardCondition";
export { attackBarredByAbility } from "./boardCondition";
export { attackAgainBarred } from "./boardCondition";
export { attackTimingBlocked, attackTimingNote } from "./boardCondition";
export { handCostAction } from "./promptText";
export { handCostUnmet } from "./ops/cards";
export { programPlayable, trainerProgramPlayable } from "./cardplay";
export { fossilPlayable } from "./cardplay";
export { stadiumPlayOverUnmet, stadiumSpentPlayLifted } from "./cardplay";
export { abilityBodyGateMet } from "./cardplay";
export { abilityUsedKey } from "./types";
export type { BlockingAttackGate } from "./boardCondition";
export type {
  DiscardScope,
  EffectChoice,
  EffectContinuation,
  EffectPrompt,
  EffectRecord,
  PokemonRef,
} from "./effectPrompt";
export type {
  AbilityProgram,
  CardProgram,
  AttackTimingGate,
  EnergyOnAttach,
  EnergyProgram,
  PassiveEffects,
  StadiumEffects,
  TriggeredAbility,
  TriggerTiming,
} from "./programTypes";
export { programFor } from "./registry";
export type { DrawReason, GameEvent, StatusName } from "./events";
export { inSetup, phaseViewOf } from "./phaseView";
export type { PendingDecision, PhaseView } from "./phaseView";
export { redactGame } from "./redact";
export { formatElapsed, logFromEvents } from "./log";
export type { LogContext } from "./log";
export type { CoinFace } from "./rng";
export { createGame } from "./setup";
export { pendingMulligansOf } from "./mulligans";
export type { CreateErrorCode, CreateGameOptions, CreateGameResult } from "./setup";
export {
  BENCH_CEILING,
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
  AttackBlock,
  BoostedAttack,
  DamageReduction,
  GameOutcome,
  GameOverReason,
  GameState,
  InPlayPokemon,
  LockedAttack,
  PendingStage,
  Phase,
  PlayerSide,
  PokemonTarget,
  Seat,
  SpecialConditions,
  StadiumInPlay,
  TurnAllowances,
} from "./types";
export { turnGate, evolutionTargetUids } from "./turn";
export { discardableTargets } from "./turn";
export { FOSSIL_IDS } from "./fossils";
export { costMet } from "./attack";
export { attackCostAt } from "./attack";

/** The one reducer. Never throws or mutates its input, including for malformed
    actions decoded from the wire. */
export function applyAction(state: GameState, action: GameAction): ApplyResult {
  const result = dispatchAction(state, action);
  if (!result.ok) return result;
  const checked = postStepChecks(result.state, "action", result.events);
  if (checked.pending.length !== result.state.pending.length) {
    return advance(checked, result.events);
  }
  return checked === result.state ? result : ok(checked, result.events);
}

function dispatchAction(state: GameState, action: GameAction): ApplyResult {
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
    case "reorderBench":
      return reorderBench(state, action);
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
    case "useStadiumAbility":
      return useStadiumAbility(state, action);
    case "resolveEffect":
      return resolveEffect(state, action);
    case "takePrizes":
      return takePrizes(state, action);
    case "promote":
      return promote(state, action);
    case "endTurn":
      return endTurn(state, action);
    case "concede":
      return concede(state, action);
    case "discardFromPlay":
      return discardFromPlay(state, action);
    default:
      return err("UNKNOWN_ACTION", `unknown action type "${(action as { type: string }).type}"`);
  }
}
