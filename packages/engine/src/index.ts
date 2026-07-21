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

/** Engine milestone marker (M5 op-slice: **`attachFromTop`** — the from-the-top
    ATTACH the lookAtTopN slice deferred. Look at the top N of your own deck and
    attach the Energy you find there straight onto your Pokémon, "**in any way you
    like**" — so each attached card names its OWN destination, and the answer is a
    MAP (card → Pokémon) rather than the flat list every other card prompt takes
    (the new `attachCards` prompt). Two consumers differing in every rider the op
    has: **Electric Generator** (Item — top 5, up to 2 Basic {L} Energy CARDS, onto
    your BENCHED {L} Pokémon) and **Hydreigon "Tri Howl"** (Ability, once per turn
    — top 3, ANY number of Energy cards, onto ANY of your Pokémon).

    The leftovers clause is the design point: "Shuffle the other cards back" is a
    trailing `shuffleDeck` op (those cards never left the deck), but "**Discard**
    the other cards" must name exactly the looked-at cards that were not attached,
    so it is `discardRest` ON the op — and it fires on the whiff and the decline
    too, which is the difference between Tri Howl costing three cards and costing
    nothing. The filter reads the PRINT (`basicEnergy` / `anyEnergy`), never
    `providesEnergy`: these cards sit in a DECK, attached to nothing (§6.5).
    providesEnergy was 0.24.0; the discardEnergy attack arms 0.23.0;
    attackEpilogue/park 0.22.0; discardEnergy 0.21.0; board conditions 0.20.0).

    **0.26.0 — `payFromHand`, the printed COST that parks.** "You can use
    this card only if you discard 2 OTHER cards from your hand" (Ultra Ball,
    Earthen Vessel) and "You must discard a card from your hand in order to use
    this Ability" (Tinkaton, Revavroom, Meowscarada ex, Radiant Blastoise) are ONE
    mechanism in two printed wordings — and the "other" appears exactly when the
    paying card is itself in the hand, which is why the play GATE excludes the
    played uid and the op carries no flag. It is the FIRST op of its program, so
    the payment happens before what it buys: Revavroom pays, THEN draws to a hand
    size that counts the payment. MANDATORY and exact, so `chooseCards` gained a
    `min` (0 for every printed "up to", `count` here — the one park with no
    decline) and a `"discard"` destination; `AbilityProgram.cost` is GONE, its one
    consumer migrated onto the op it was the fungible special case of.

    **0.27.0 — the printed number is a FLOOR, and the cost that is not a
    discard.** Two mandatory-exactly-N fixes, one on each prompt that could
    already say "up to". (1) `choosePokemonMulti` gained `min`/`max` +
    `declinable`: "put 3 damage counters on **1** of your opponent's Benched
    Pokémon" is not "up to 1", so Meowscarada ex / Radiant Blastoise can no longer
    pay an irreversible hand cost and then place nothing, while Hawlucha's printed
    "**you may** choose 2" stays all-or-nothing — 2 or none, never 1 of 2 — which
    is a decline the framework's auto-fired triggers leave nowhere else to live.
    (2) `discardFromHandCost` became **`payFromHand`** with a required
    destination: `to: "deckBottom"` pays UNDER THE DECK, landing **Dendra** ×3
    ("Put a card from your hand on the bottom of your deck. If you do, draw cards
    until you have 5") — nothing is discarded, yet the mechanism is the same
    mandatory pick, the same conditional benefit and the same printed play gate,
    which Dendra states as its contrapositive. HAND_COST_PAID carries `to`,
    because a payment to the discard becomes public and one to the deck never
    does. **Skwovet** ×2 ("Nest Stash") reaches the same destination with the
    WHOLE hand and needed no new op at all — `handRefresh` with Iono's `toBottom`
    + `onlyIfAnyMoved`. */
export const engineVersion = "0.27.0";

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
export type { AttachTargetRiders, BoardCondition, CardFilter, EffectOp } from "./effects";
/** The one BoardCondition evaluator + its printed-text describer. Exported so a
    host holding raw engine state (today's hot-seat HUD) greys out a card whose
    printed "only if" gate is unmet using the SAME logic playTrainer rejects it
    by, and can say WHY. Both take a `GameState`: a P4 remote client holds a
    projection instead, which does not carry the Stadium's owner and redacts the
    prize arrays — see the P4 notes in docs/workstreams/simulator.md before
    reusing these online. */
export { conditionHolds, conditionNote } from "./interpreter";
/** The §7.5 hand-COST gate + its printed noun phrase. Exported for the same
    reason `conditionHolds` is: the HUD must grey out a card whose printed rule is
    unmet rather than offering a button that can only reject (D19/D29), and it has
    to do that with the SAME logic playTrainer rejects by — a second
    implementation is how a card becomes greyed while it was legal.

    SAFER to expose than `conditionHolds`, not riskier: this reads only the
    viewer's OWN hand, where the condition evaluator reads Prize counts and the
    Stadium's owner (see the P4 caveat above). Pass the played uid for a Trainer
    (the printed "OTHER cards"); omit it for an Ability, whose card is on the
    board. */
export { handCostAction, handCostUnmet } from "./interpreter";
export type {
  DiscardScope,
  EffectChoice,
  EffectContinuation,
  EffectPrompt,
  PokemonRef,
} from "./interpreter";
export type {
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
