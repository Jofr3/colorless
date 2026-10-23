import type { Attack, Card } from "@colorless/schema";
import type {
  ApplyResult,
  AttackAction,
  GameAction,
  PromoteAction,
  TakePrizesAction,
  Rejection,
} from "./actions";
import { err, ok } from "./actions";
import {
  activeTop,
  applyDamageModifier,
  attacksOf,
  cardOfUid,
  costMet,
  hasPrintedAbility,
  hasRuleBox,
  isExOrV,
  isSpecialEnergy,
  isTeraPokemon,
  matchesFilter,
  parseAttackDamage,
  preventsAttackerBanner,
  preventsAttackerClass,
  resistanceOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
import {
  attackBlockOf,
  // The flip-to-attack lock is checked at the §8 step-3 seam, not in `attackLocked`, because the
  // declaration stays legal.
  attackFlipLockCoins,
  attackGateOf,
  attackLocked,
  attackMenuOf,
  attackerHasSpecialEnergy,
  attackerSuppressesTargetEffects,
  coinRedoToolOf,
  spendCoinRedo,
  benchShieldedFromDamage,
  inPlayCardOf,
  boostedAttackBase,
  boostedAttackDamage,
  coinFlipShieldPrevents,
  countAttachedEnergy,
  countDamageCountersInPlay,
  countBasicEnergyTypesInPlay,
  countEnergyInPlay,
  countToolsInPlay,
  effectiveAttackCost,
  effectiveMaxHp,
  effectiveRetreatCost,
  hasAttachedEnergy,
  firstTurnAttackBanned,
  installedAttackDebuffOf,
  installedNoWeakness,
  installedRecoilOf,
  installedReductionOf,
  installedVulnerabilityOf,
  installedWeaknessRetypeOf,
  installedWeaknessRewriteOf,
  koSurvivalClamp,
  koSurvivalCoinFlip,
  lockedAttackIndexes,
  lockedAttackNames,
  NO_CONSUMABLE,
  berryReductionOf,
  attackerGatedReductionOf,
  opposingAttackDebuff,
  opposingToolAttackDebuff,
  seatShieldedFromLowEnergyAttacker,
  passivesOf,
  preventedByDamageThreshold,
  preventsAttackerType,
  providedEnergy,
  seatDamageReduction,
  seatRemovesWeakness,
  seatWeaknessRewrite,
  weaknessAmountOverride,
  withWeaknessAmount,
  sideAttackBonusThisTurn,
  stadiumPreventsDamage,
  withWatchedRecoil,
} from "./continuous";
import {
  bonusConsequentProgram,
  COPY_FAMILY_MARKER,
  deriveAttackBonusConsequent,
  deriveAttackCopy,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  isInPlayAttackCopy,
  isResolvedAttackCopy,
  optionalBoostProgram,
  discardScaledBoostProgram,
  optionalCostBoostProgram,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackTrailingClause,
  splitAttackRequirementClause,
} from "./effects";
import type { AttackCopyOverride, BoardCondition } from "./effectTypes";
import type {
  AttackBonusConsequent,
  AttackCoinFlip,
  AttackDamageSuppression,
  AttackDiscardScaledBoost,
  AttackOptionalBoost,
  AttackOptionalCostBoost,
  AttackCopy,
  AttackDamageBonus,
  AttackFlipCount,
  AttackPreDamage,
  CardFilter,
  EffectOp,
  OpOf,
  ResolvedAttackCopy,
} from "./effects";
import type { GameEvent } from "./events";
import {
  advance,
  finishAttack,
  resolvePrizesAndResume,
  resolvePromotionAndResume,
  settleProgram,
} from "./flow";
import { applyStatus } from "./ops/locks";
import {
  attackAgainBarred,
  attackBarredByAbility,
  attackTimingBlocked,
  attackTimingNote,
  attackerPreWRBonus,
  conditionHolds,
  conditionNote,
  countCardsInDiscardPile,
  countCardsInHand,
  countPokemonInPlay,
} from "./boardCondition";
import {
  coinRedoPrompt,
  consumeTools,
  consumedTools,
  detonateDeluxeBomb,
  discardToPile,
} from "./ops/damage";
import { effectRefused } from "./effectTargets";
import { runProgram } from "./interpreter";
import type { EffectChoice, EffectContext, EffectPrompt } from "./effectPrompt";
import { programFor } from "./registry";
import type { ParsedDamage } from "./cards";
import type { AttackMenuEntry } from "./continuous";
import { flipCoin, flipUntilTails, MAX_UNTIL_TAILS_FLIPS, shuffle } from "./rng";
import type { CoinFace } from "./rng";
import { damagedByAttackAbility, damagedToolTriggersOf, koToolTriggersOf } from "./triggers";
import { isBenchIndex, turnGate } from "./turn";
import type { GameState, InPlayPokemon, PendingStage, Phase, PokemonTarget, Seat } from "./types";
import {
  damageCountersOn,
  inPlayOf,
  attackDamageTakenLastTurn,
  isImmobilized,
  makeInPlay,
  otherSeat,
  presentStatuses,
  prizesTakenOnLastTurn,
  takenPrizes,
  withActive,
  withAttackDamageTaken,
  withSide,
} from "./types";

export type { AttackCopyOverride };

// The attack step (§8) and the two KO-resolution decisions it can park on (§8.1). Declaring an
// attack ends the turn, except a first attack under Festival Lead with Festival Grounds in play,
// which opens the attack-again window (flow.ts `finishAttack`). Everything here funnels into
// flow.ts's staged tail.

// `costMet` lives in cards.ts to avoid a continuous → attack import cycle; re-exported here for
// existing importers.
export { costMet };

/**
 * §8.2: the cost this attack is charged right now, shared by `attack()`, `redactedAttacksOf` and
 * the HUD so they cannot disagree. `index` is the attack-menu index, and the cost is the menu
 * entry's own. Printed cost clauses apply on top of `effectiveAttackCost`: `alternateCostIf`
 * charges the alternate only if it is payable, otherwise the printed cost; `costWaivedIf` returns
 * `[]` after every surcharge. Ability-printed cost clauses are matched by attack name and dropped
 * under an Ability lock. `seat` must be the holder's controller.
 */
export function attackCostAt(
  state: GameState,
  seat: Seat,
  pokemon: InPlayPokemon,
  index: number,
  provided: readonly string[],
): readonly string[] {
  const entry = attackMenuOf(state, seat, pokemon)[index];
  const printed = entry?.attack.cost ?? [];
  // The attack name is passed so a discount scoped to one attack (Seasoned Skill's "Blood Moon")
  // reaches only that attack.
  const attackName = entry?.attack.name;
  const printedEff = effectiveAttackCost(state, pokemon, printed, attackName);
  const gate = attackGateOf(state, pokemon, index);
  if (gate?.kind === "alternateCostIf" && conditionHolds(state, seat, gate.condition)) {
    const alt = effectiveAttackCost(state, pokemon, gate.cost, attackName);
    return costMet(alt, provided) ? alt : printedEff;
  }
  if (gate?.kind === "costWaivedIf" && conditionHolds(state, seat, gate.condition)) {
    return [];
  }
  // Ability-printed cost clauses apply only when the attack-level gate did not fire, matched by
  // attack name; read through `passivesOf`, so a §9 lock on the holder drops them.
  for (const clause of passivesOf(state, pokemon).attackCostClauses) {
    if (clause.attack !== attackName || !conditionHolds(state, seat, clause.gate.condition))
      continue;
    if (clause.gate.kind === "costWaivedIf") return [];
    const clauseCost = effectiveAttackCost(state, pokemon, clause.gate.cost, attackName);
    if (costMet(clauseCost, provided)) return clauseCost;
  }
  return printedEff;
}

/**
 * §8: replaces top-level `conditionGate`s on `extraEnergyBeyondAttackCost` with the branch they
 * take at declaration (Deoxys "Psyspear"). `extraUnits` is attached provision units minus the
 * charged cost. Other ops pass through unchanged.
 */
function resolveDeclarationGates(
  program: EffectOp[] | null,
  extraUnits: number,
): EffectOp[] | null {
  if (program === null) return null;
  return program.flatMap((op) =>
    op.op === "conditionGate" && op.cond.kind === "extraEnergyBeyondAttackCost"
      ? extraUnits >= op.cond.extra
        ? op.ops
        : (op.otherwise ?? [])
      : [op],
  );
}

function scaledAttackDamage(
  state: GameState,
  attacker: InPlayPokemon,
  bonus: AttackDamageBonus,
  defenderSeat: Seat,
  attackerSeat: Seat,
  cost: readonly string[],
): number {
  switch (bonus.count.kind) {
    case "damageCountersOnSelf":
      // One damage counter = 10 HP (§12). `attacker` is the Active as of declaration, so an attack
      // cannot bootstrap the counters it scales off.
      return damageCountersOn(attacker) * bonus.per;
    case "opponentPrizesTaken":
      // Prizes the opponent has TAKEN (6 − their remaining pile, §8.1), read at
      // declaration before this attack's own KOs award any Prize.
      return takenPrizes(state, defenderSeat) * bonus.per;
    case "yourPrizesTaken":
      // Prizes the attacking seat has taken, read at declaration.
      return takenPrizes(state, attackerSeat) * bonus.per;
    case "opponentPrizesTakenLastTurn":
      // Settle the Score: Prizes the defending seat took during the previous turn.
      return prizesTakenOnLastTurn(state, defenderSeat) * bonus.per;
    case "attackDamageTakenLastTurnOnSelf":
      // Juggernaut Horn / Counter: attack damage dealt to the attacking body during the opponent's
      // last turn, in HP.
      return attackDamageTakenLastTurn(state, attacker) * bonus.per;
    case "opponentActiveRetreatCost": {
      // The {C} in the DEFENDING Pokémon's Retreat Cost — the EFFECTIVE one, not
      // the printed number: `effectiveRetreatCost` already folds every modifier in
      // play (Beach Court's discount, Calamitous Wasteland's surcharge, Clefable
      // ex's set-to-zero aura), so a Stadium that changes what it costs to retreat
      // changes what these attacks hit for. The only derived count source; the
      // rest read a raw field. A missing Active can't happen here (the attack gate
      // requires a Defending Pokémon) — 0 keeps the arm total.
      const defenderActive = state.players[defenderSeat].active;
      return defenderActive === null ? 0 : effectiveRetreatCost(state, defenderActive) * bonus.per;
    }
    case "damageCountersOnOpponentActive": {
      // Damage counters on the defending Active, read at declaration so this attack's own hit
      // cannot count; a missing Active cannot happen here, and 0 keeps the arm total.
      const defenderActive = state.players[defenderSeat].active;
      return defenderActive === null ? 0 : damageCountersOn(defenderActive) * bonus.per;
    }
    case "specialConditionsOnOpponentActive": {
      // Counts Special Conditions via `presentStatuses`, not raw fields: `confusionDamage` is a
      // parameter of Confusion, not a condition, and this keeps the count consistent with
      // `opponentActiveHasSpecialCondition`.
      const defenderActive = state.players[defenderSeat].active;
      return defenderActive === null
        ? 0
        : presentStatuses(defenderActive.conditions).length * bonus.per;
    }
    case "damageCountersOnYourBench": {
      // Damage counters summed over the attacker's own Bench (Actives excluded), floored per body,
      // optionally narrowed by the printed filter on the in-play top card.
      const bench = state.players[attackerSeat].bench;
      const filter = bonus.count.filter;
      return (
        bench.reduce(
          (total, p) =>
            total +
            (p !== null && (filter === undefined || matchesFilter(inPlayCardOf(state, p), filter))
              ? damageCountersOn(p)
              : 0),
          0,
        ) * bonus.per
      );
    }
    case "damageCountersOnOpponentBoard":
      // Damage counters on all of the opponent's Pokémon, Active included.
      return countDamageCountersInPlay(state, defenderSeat) * bonus.per;
    case "opponentBenchCount":
      // The defender's Benched Pokémon counted as bodies; damage is not consulted.
      return benchBodies(state, defenderSeat) * bonus.per;
    case "yourBenchCount":
      // The attacker's Benched Pokémon counted as bodies, optionally filtered; the Active is not
      // counted.
      return benchBodies(state, attackerSeat, bonus.count.filter) * bonus.per;
    case "bothSidesBenchCount":
      // Both Benches; neither Active is counted.
      return (benchBodies(state, attackerSeat) + benchBodies(state, defenderSeat)) * bonus.per;
    case "energyOnOpponent": {
      // Energy cards attached to the opponent, on the Active or the whole board (Active + Bench),
      // counted through continuous.ts so wildcard and multi-unit Specials count consistently.
      const { zone, energyType } = bonus.count;
      if (zone === "board") return countEnergyInPlay(state, defenderSeat, energyType) * bonus.per;
      const defenderActive = state.players[defenderSeat].active;
      return defenderActive === null
        ? 0
        : countAttachedEnergy(state, defenderActive, energyType) * bonus.per;
    }
    case "energyOnSelf": {
      // Energy attached to the attacking body as of declaration, or with `zone: "board"` to all of
      // the attacker's Pokémon in play.
      const { zone, energyType } = bonus.count;
      // "All of your Iono's Pokémon": the board zone narrowed by the printed filter, still on the
      // attacker's side.
      if (zone === "board" && bonus.count.filter !== undefined) {
        return countEnergyInPlay(state, attackerSeat, energyType, bonus.count.filter) * bonus.per;
      }
      if (zone === "board") return countEnergyInPlay(state, attackerSeat, energyType) * bonus.per;
      return countAttachedEnergy(state, attacker, energyType) * bonus.per;
    }
    case "bothActivesEnergyCount": {
      // Untyped Energy on the attacker's Active plus the defender's Active, summed then scaled.
      const defenderActive = state.players[defenderSeat].active;
      return (
        (countAttachedEnergy(state, attacker, null) +
          (defenderActive === null ? 0 : countAttachedEnergy(state, defenderActive, null))) *
        bonus.per
      );
    }
    case "toolsOnYourBoard":
      // Pokémon Tools attached to all of the attacker's Pokémon in play, Active included.
      return countToolsInPlay(state, attackerSeat) * bonus.per;
    case "toolsInPlayBothSides":
      // Bronzong "Tool Drop": every Tool on both boards.
      return (
        (countToolsInPlay(state, attackerSeat) + countToolsInPlay(state, defenderSeat)) * bonus.per
      );
    case "energyInPlayBothSides":
      // Delphox "Energized Storm": every Energy card attached on both boards.
      return (
        (countEnergyInPlay(state, attackerSeat, null) +
          countEnergyInPlay(state, defenderSeat, null)) *
        bonus.per
      );
    case "basicEnergyTypesOnYourBoard":
      // Sylveon ex: distinct Basic Energy types on the attacker's board.
      return countBasicEnergyTypesInPlay(state, attackerSeat) * bonus.per;
    case "damagedBenchedPokemon":
      // Gourgeist ex: the attacker's Benched Pokémon with any damage.
      return state.players[attackerSeat].bench.filter((p) => p.damage > 0).length * bonus.per;
    case "benchedPokemonWithEnergy": {
      // Armarouge: Benched Pokémon with any Energy of the type, by provision.
      const { energyType } = bonus.count;
      return (
        state.players[attackerSeat].bench.filter((p) => hasAttachedEnergy(state, p, energyType))
          .length * bonus.per
      );
    }
    case "benchedPokemonWithMaxHp": {
      // Igglybuff: Benched Pokémon whose modified max HP is exactly `hp`.
      const { hp } = bonus.count;
      return (
        state.players[attackerSeat].bench.filter((p) => effectiveMaxHp(state, p) === hp).length *
        bonus.per
      );
    }
    case "pokemonInPlay": {
      // Pokémon in play (Active + Bench, §4) on the named seat matching the printed noun,
      // optionally only damaged ones. Not `benchBodies`, which skips the Active.
      const bodySeat = bonus.count.seat === "you" ? attackerSeat : defenderSeat;
      return (
        countPokemonInPlay(state, bodySeat, bonus.count.filter, bonus.count.damagedOnly === true) *
        bonus.per
      );
    }
    case "bothSidesPokemonInPlay": {
      // Pokémon in play matching the filter on both sides of the table, summed before scaling. A
      // separate member because the seat ternary above is binary and a "both" seat would silently
      // read one board.
      return (
        (countPokemonInPlay(state, attackerSeat, bonus.count.filter) +
          countPokemonInPlay(state, defenderSeat, bonus.count.filter)) *
        bonus.per
      );
    }
    case "cardsInDiscardPile": {
      // Cards in the named seat's discard pile matching the printed noun; the seat comes from the
      // member, never from the fold.
      const pileSeat = bonus.count.seat === "you" ? attackerSeat : defenderSeat;
      return countCardsInDiscardPile(state, pileSeat, bonus.count.filter) * bonus.per;
    }
    case "cardsInOpponentHand":
      // Cards in the defender's hand matching the printed noun. Hand contents are hidden, so this
      // is only valid for the bare count (hand size is public) or after a printed reveal the engine
      // performs.
      return countCardsInHand(state, defenderSeat, bonus.count.filter) * bonus.per;
    case "cardsInYourHand":
      // Galarian Meowth "Treasure Rush": every card in the attacker's own hand.
      return countCardsInHand(state, attackerSeat, { kind: "anyCard" }) * bonus.per;
    case "extraEnergyUnitsBeyondCost":
      // "At least N extra Energy attached (in addition to this attack's cost)": a 0-or-1 indicator
      // comparing provision units, not cards, against the charged cost, since one multi-unit
      // Special counts as several Energy toward a cost.
      return providedEnergy(state, attacker).length - cost.length >= bonus.count.extra
        ? bonus.per
        : 0;
    case "boardCondition":
      // The 0-or-1 indicator: "If <clause>, this attack does N more damage." Evaluated at
      // declaration, so the attack cannot bootstrap its own condition.
      return conditionHolds(state, attackerSeat, bonus.count.cond) ? bonus.per : 0;
  }
}

/**
 * How many Pokémon are on `seat`'s Bench, as bodies; shared by the body-count members so they
 * cannot disagree.
 */
function benchBodies(state: GameState, seat: Seat, filter?: CardFilter): number {
  // An absent filter counts every body. The filter reads the top card's in-play view (§1.2), so an
  // evolved body counts as its current stage; an unresolvable uid is counted out.
  return state.players[seat].bench.reduce(
    (total, p) =>
      total +
      (p !== null && (filter === undefined || matchesFilter(inPlayCardOf(state, p), filter))
        ? 1
        : 0),
    0,
  );
}

/**
 * One flip-count member's faces, in order, plus the advanced rngState. Returns faces rather than a
 * count because "until tails" has no count until the faces are drawn. `attacker` is only the
 * fallback for an Active that cannot be missing here.
 */
function takeFlips(
  state: GameState,
  attackerSeat: Seat,
  attacker: InPlayPokemon,
  count: AttackFlipCount,
): [faces: CoinFace[], nextState: number] {
  // The engine's only throw: a flip-until-tails truncated at `MAX_UNTIL_TAILS_FLIPS` has no honest
  // heads count, and scoring it would corrupt the match. Unreachable with the current RNG (its
  // longest heads run is 31); it fires only if the RNG is replaced with something degenerate.
  if (count.kind === "untilTails") {
    const [faces, rngState] = flipUntilTails(state.rngState, MAX_UNTIL_TAILS_FLIPS);
    if (faces.at(-1) !== "tails") {
      throw new Error(
        `flipUntilTails truncated at the ${MAX_UNTIL_TAILS_FLIPS}-flip cap (${faces.length} consecutive heads), so the sequence has no heads count to score — see MAX_UNTIL_TAILS_FLIPS in rng.ts, which the shipped flipCoin cannot reach`,
      );
    }
    return [faces, rngState];
  }
  let flips: number;
  switch (count.kind) {
    case "printed":
      flips = count.count;
      break;
    case "attachedEnergy":
      flips = countAttachedEnergy(
        state,
        state.players[attackerSeat].active ?? attacker,
        count.energy,
      );
      break;
    // Pokémon in play (Active + Bench) on the attacker's side matching the filter; `benchBodies`
    // would miss the Active.
    case "pokemonInPlay":
      flips = countPokemonInPlay(state, attackerSeat, count.filter);
      break;
    // Energy on both Actives, untyped. The attacker side reads the live Active at the flip site,
    // which cannot differ from the declaring body on any reachable board.
    case "bothActivesEnergy": {
      const ownActive = state.players[attackerSeat].active ?? attacker;
      const foeActive = state.players[otherSeat(attackerSeat)].active;
      flips =
        countAttachedEnergy(state, ownActive, null) +
        (foeActive === null ? 0 : countAttachedEnergy(state, foeActive, null));
      break;
    }
    // "Your opponent flips a coin for each of their Benched Pokémon": the opponent's Bench only,
    // Active excluded.
    case "opponentBench":
      flips = benchBodies(state, otherSeat(attackerSeat));
      break;
  }
  const faces: CoinFace[] = [];
  let rng = state.rngState;
  for (let flip = 0; flip < flips; flip += 1) {
    const [face, next] = flipCoin(rng);
    faces.push(face);
    rng = next;
  }
  return [faces, rng];
}

/** `cancelOnTails` takes exactly one flip and carries no `flips` field to say so
    — the member IS "flip once, then take the printed branch". Spelling that one
    flip as a value rather than a `? 1 :` branch keeps every coin printing on the
    single `takeFlips` path, so the event rows and the rngState accounting are
    written once for the whole family. */
const ONE_FLIP: AttackFlipCount = { kind: "printed", count: 1 };

/**
 * How many coins a printed flip decision spends; the one place this is resolved, so event rows and
 * rngState accounting stay consistent.
 */
function printedFlips(coinFlip: AttackCoinFlip): AttackFlipCount {
  switch (coinFlip.kind) {
    // The two CANCEL members are "flip once, then take the printed branch" — the
    // count is the member, not a field on it.
    case "cancelOnTails":
    case "cancelOnTailsElseProgram":
      return ONE_FLIP;
    case "bonusOnHeads":
    case "perHeads":
    case "programPerHeads":
    case "opponentPerTails":
    case "bonusLadder":
    case "bonusOnAllHeads":
    case "deckUpToHeads":
    case "retrievalUpToHeads":
    case "perHeadsThenThreshold":
      return coinFlip.flips;
  }
}

/**
 * Result of the pre-damage seam. It is deliberately plain data, not assignable to `ApplyResult` or
 * `RunResult`, so a member needing a player's decision cannot be written; only add fields the
 * caller consumes and discards. `tools` counts Pokémon Tools only, because a consequent conditions
 * on discarding a Tool.
 */
type AttackPreDamageResult = {
  /** The board after the act — `===` the input when the act moved nothing. */
  state: GameState;
  /** How many POKÉMON TOOLS came off, which is the only quantity a printed
      consequent in this family conditions on. */
  tools: number;
  /**
   * The member's printed "this attack does nothing" branch fired; the caller ends the attack
   * through `finishAttack`.
   */
  cancelled: boolean;
};

/**
 * The strip shared by every pre-damage member. `seat` is whose board loses cards and `ctx.seat`
 * whose attack caused it; they are the same for a self-strip. A body with nothing to take returns
 * the state unchanged with no event. Tools and Special Energy file separate events.
 */
function stripPreDamage(
  state: GameState,
  seat: Seat,
  ctx: EffectContext,
  what: { specialEnergy: boolean; cancelIfNone: boolean },
  events: GameEvent[],
): AttackPreDamageResult {
  const actor = ctx.seat;
  const side = state.players[seat];
  const victim = side.active;
  const nothing = { state, tools: 0, cancelled: what.cancelIfNone };
  if (victim === null) return nothing;
  const host = topUid(victim);
  if (host === undefined) return nothing;
  // §11: a strip is an effect of an attack, so a "prevent all effects of attacks" shield refuses
  // it. Checked before any read or push, so a refused strip files only `ATTACK_EFFECT_PREVENTED`.
  if (effectRefused(state, seat, ctx, undefined, events)) return nothing;
  const tools = victim.tools;
  // "Special" is the CARD CLASS and not an energy TYPE (`isSpecialEnergy`, cards.ts),
  // so a Basic Energy on the same body is untouched by row 71 — the one distinction
  // an "all Energy" mis-build erases, and the reason this reads the class rather than
  // filtering on what the card provides.
  const special = what.specialEnergy
    ? victim.energy.filter((uid) => {
        const card = cardOfUid(state, uid);
        return card !== undefined && isSpecialEnergy(card);
      })
    : [];
  if (tools.length === 0 && special.length === 0) return nothing;
  // `host` is the stripped body's top-card uid, since this attack's damage may Knock it Out in the
  // same batch. `when: "preDamage"` because these rows precede the §8.5 `DAMAGE_DEALT`.
  if (tools.length > 0) {
    events.push({ type: "TOOLS_DISCARDED", seat, actor, uids: tools, host, when: "preDamage" });
  }
  if (special.length > 0) {
    events.push({
      type: "ENERGY_DISCARDED",
      seat,
      actor,
      uids: special,
      from: { spot: "active" },
      host,
    });
  }
  const kept = new Set(special);
  return {
    state: withSide(state, seat, {
      ...side,
      active: {
        ...victim,
        tools: tools.length > 0 ? [] : victim.tools,
        energy: special.length > 0 ? victim.energy.filter((uid) => !kept.has(uid)) : victim.energy,
      },
      // The printed order of the noun phrase — Tools, then Special Energy — so the
      // pile reads the way the sentence does.
      discard: [...side.discard, ...tools, ...special],
    }),
    tools: tools.length,
    cancelled: false,
  };
}

/**
 * The pre-damage act. It returns `AttackPreDamageResult` rather than running an `EffectOp[]`
 * through `runProgram`, so the compiler guarantees the seam cannot park; attack.ts has no
 * continuation for the straight-line code after it. This switch is the only reader of the union;
 * the caller tests `cancelled`.
 */
function applyAttackPreDamage(
  state: GameState,
  pre: AttackPreDamage,
  actor: Seat,
  actorUid: string,
  events: GameEvent[],
): AttackPreDamageResult {
  // One context for the whole seam. `invokedBy: "attack"` arms the §11 gate, and `dealt: 0` is
  // honest because no damage has been dealt yet.
  const ctx: EffectContext = { seat: actor, sourceUid: actorUid, invokedBy: "attack", dealt: 0 };
  switch (pre.kind) {
    case "discardOpponentActiveTools":
      return stripPreDamage(
        state,
        otherSeat(actor),
        ctx,
        {
          specialEnergy: false,
          cancelIfNone: false,
        },
        events,
      );
    case "discardOpponentActiveToolsAndSpecialEnergy":
      // Row 71. The SECOND ZONE and nothing else changes — same victim, same seat
      // convention, same silent no-op. `specialEnergy` is a CARD CLASS
      // (`isSpecialEnergy`), not an energy type, so a Basic on the same body stays
      // attached; that is the one thing an "all Energy" mis-build would get wrong
      // and it is driven as a control rather than described.
      return stripPreDamage(
        state,
        otherSeat(actor),
        ctx,
        {
          specialEnergy: true,
          cancelIfNone: false,
        },
        events,
      );
    case "discardOwnToolsElseCancel":
      // Row 72. The victim is the ATTACKER's own body — `actor` on both sides of the
      // event, which is exactly the self-discard case `TOOLS_DISCARDED`'s own doc
      // block already anticipated ("the two are opposite here and the same for a
      // self-discard"). The printed *"If you can't discard any, this attack does
      // nothing."* is reported through the RESULT and executed by the caller, which
      // is the only place that can return.
      return stripPreDamage(
        state,
        actor,
        ctx,
        {
          specialEnergy: false,
          cancelIfNone: true,
        },
        events,
      );
    case "discardOpponentActiveToolsThenParalyze": {
      // Row 74. The act is row 73's, byte for byte; the consequent is conditioned on
      // its RESULT — *"If you discarded a Pokémon Tool in this way"* — which is the
      // whole reason `stripPreDamage` reports what it moved instead of only a board.
      const stripped = stripPreDamage(
        state,
        otherSeat(actor),
        ctx,
        {
          specialEnergy: false,
          cancelIfNone: false,
        },
        events,
      );
      if (stripped.tools === 0) return stripped;
      // Through the interpreter's own `applyStatus`, which owns the §11 refusal and §12 status
      // immunities. A shielded body already refused the strip above, so only one
      // `ATTACK_EFFECT_PREVENTED` is filed.
      return {
        ...stripped,
        state: applyStatus(
          stripped.state,
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          ctx,
          events,
        ),
      };
    }
  }
}

/** How `attack()` was entered. Both fields are absent on a fresh declaration. */
interface AttackReentry {
  /** The copy-attack override, set only when `attack()` re-enters itself to resolve a copied attack. */
  copied?: AttackCopyOverride;
  /**
   * §8: set only on re-entry after a Backtrack Badge offer at the printed coin flip; rows and coins
   * before that flip are not repeated. `keep` takes the offered faces, `again` flips anew.
   */
  coinRedo?: CoinRedo;
}

/** The SOURCE of a non-empty copy override, else null. */
function copySourceOf(
  copied: AttackCopyOverride | undefined,
): Exclude<AttackCopyOverride, { empty: true }> | null {
  return copied === undefined || copied.empty === true ? null : copied;
}

/**
 * §8: declare one attack with the Active Pokémon; resolving it ends the turn through the staged
 * tail, except a first attack under Festival Lead, which opens the attack-again window. The cost is
 * a check, not a payment (§8.2). `reentry` is set only when this function re-enters itself.
 */
export function attack(
  state: GameState,
  action: AttackAction,
  reentry: AttackReentry = {},
): ApplyResult {
  const { copied, coinRedo } = reentry;
  const declaration = checkDeclaration(state, action);
  if ("ok" in declaration) return declaration;
  const { active, attackerUid, attacker, entry, declared, index, printedIndex, cost } = declaration;
  // §8: copy-attack substitution at declaration. Every gate has passed for the copier, and only the
  // copier's cost is checked. The choice is made before `ATTACK_DECLARED` and every coin: forced
  // for 0 or 1 candidate by re-entering with the override, or parked. Skipped when an override is
  // already present.
  const copyText = declared.effect ?? null;
  const copy = copied === undefined && copyText !== null ? deriveAttackCopy(copyText) : null;
  // Except a resolve-time copy (Haughty Order, Seek Inspiration), whose source is only found while
  // the attack resolves; it is handled after the opening coins. Skill Thief's in-play copy takes
  // its own declaration-time branch.
  if (copy !== null && isInPlayAttackCopy(copy)) {
    return declareInPlayAttackCopy(state, action, attackerUid, declared.name);
  }
  if (copy !== null && !isResolvedAttackCopy(copy)) {
    return declareAttackCopy(state, action, copy, attackerUid, declared.name);
  }
  const copiedFrom = copySourceOf(copied);

  const defenderSeat = otherSeat(action.seat);
  const defenderSpot = activeTop(state, defenderSeat);
  if (defenderSpot === null) {
    // Unreachable — the KO'd side promotes (or loses) before play resumes.
    return err("NO_TARGET", "no Defending Pokémon");
  }
  const { active: declaredDefender, uid: defenderUid } = defenderSpot;
  // The defender's in-play card, for the type-keyed reads below.
  const defenderCard = inPlayCardOf(state, declaredDefender) ?? defenderSpot.card;
  // Rebindable: `defenderSpot` is a snapshot, and every §8.5 read takes the body object, so a
  // pre-damage act that changes the defender must rebind this or the damage math reads the stale
  // body.
  let defender = declaredDefender;
  // The attacker's post-seam binding. `active` stays the declaration snapshot for the gates above;
  // any §8.5-or-later read must use `attackerBody`, or a stripped Tool still counts or is written
  // back to the board.
  let attackerBody = active;

  // Bound by name so a copy can stamp `as` onto it once the copied attack is known to resolve;
  // `attack` stays the copier's own name.
  const declaredEvent: Extract<GameEvent, { type: "ATTACK_DECLARED" }> = {
    type: "ATTACK_DECLARED",
    seat: action.seat,
    uid: attackerUid,
    attack: declared.name,
    index,
  };
  // A resumed copy or a Backtrack Badge re-entry is the second half of an attack already declared,
  // so it declares nothing again.
  const events: GameEvent[] =
    copiedFrom?.resumed === true || coinRedo !== undefined ? [] : [declaredEvent];

  const opening = flipOpeningCoins(state, action, active, attackerUid, reentry, events);
  let next = opening.state;
  if (!opening.resolves) return finishAttack(next, action.seat, attackerUid, declared.name, events);
  // The copy resolves only from here, so `ATTACK_DECLARED.as` is written only now; every earlier
  // return resolved nothing. `events[0]` is `declaredEvent`. A resolve-time copy also takes its
  // source here, after every coin.
  if (copy !== null && isResolvedAttackCopy(copy)) {
    return copyAtResolution(next, action, copy, attackerUid, declared.name, events);
  }
  // A resumed half names what the attack became in its own row; its `ATTACK_DECLARED` went out with
  // the first half.
  if (copiedFrom !== null && copiedFrom?.resumed === true && coinRedo === undefined) {
    events.push({
      type: "ATTACK_COPY_RESOLVED",
      seat: action.seat,
      uid: attackerUid,
      attack: declared.name,
      as: copiedFrom.attack.name,
    });
  }
  if (copiedFrom !== null && copiedFrom?.resumed !== true && coinRedo === undefined)
    events[0] = { ...declaredEvent, as: copiedFrom.attack.name };

  const text = readAttackText(state, declaration, copiedFrom);
  const { effect, preDamage, damagePenalty, scaling, coinFlip, discardScaledBoost } = text;
  // A boosted base ("this attack's base damage is 240") replaces the printed base, with
  // Weakness/Resistance still applied after it. The boost stays at the copier's index.
  const base = boostedAttackBase(next, attackerBody, printedIndex) ?? text.printedBase;
  const scaled =
    scaling === null
      ? 0
      : scaledAttackDamage(next, active, scaling, defenderSeat, action.seat, cost);
  // Counted at declaration, so this attack's own damage cannot feed the counters it reads.
  const printedPenalty =
    damagePenalty === null
      ? 0
      : scaledAttackDamage(next, active, damagePenalty, defenderSeat, action.seat, cost);
  // For `selfHandAttach` the head is a multiplier, so the base is `per × Energy on this Pokémon` at
  // declaration, and the program adds `per × moved`. Assumes nothing before the program tail
  // changes this Pokémon's Energy. Other members keep the printed base.
  const discardScaledBase =
    discardScaledBoost?.kind === "selfHandAttach"
      ? scaledAttackDamage(
          next,
          active,
          {
            per: discardScaledBoost.per,
            count: { kind: "energyOnSelf", energyType: discardScaledBoost.energyType },
          },
          defenderSeat,
          action.seat,
          cost,
        )
      : base;
  const terms = baseDamageTerms(text, base);
  const simulated = simulatedParts(text, terms);
  // Only on the first pass; a Backtrack Badge re-entry has already emitted it.
  if (
    coinRedo === undefined &&
    ((text.modifier !== null && !simulated.modifier) ||
      (effect !== null && effect !== "" && !simulated.effect))
  ) {
    events.push({
      type: "ATTACK_EFFECT_SKIPPED",
      seat: action.seat,
      attack: declared.name,
      // Authored/derived/scaled text IS simulated — only an unsimulated one is skipped.
      effect: simulated.effect ? null : effect,
      damageModifier: simulated.modifier ? null : text.modifier,
    });
  }

  // The requirement gate runs before §8.5 and the program: "this attack does nothing" means no
  // damage, no effects and no triggers. `finishAttack` still runs, because a cancelled attack was
  // still used. Read against the declaration board.
  if (text.requirement !== null && !conditionHolds(next, action.seat, text.requirement)) {
    events.push({
      type: "ATTACK_FAILED",
      seat: action.seat,
      uid: attackerUid,
      reason: "requirement",
    });
    return finishAttack(next, action.seat, attackerUid, declared.name, events);
  }

  // Reassigned only by the printed coin flips, which append to it.
  let program = text.program;
  let coinBonus = 0;
  if (coinFlip !== null) {
    const coins = flipPrintedCoins(
      next,
      { action, active, attackerUid, attackName: declared.name, coinFlip, program, reentry },
      events,
    );
    if ("done" in coins) return coins.done;
    next = coins.state;
    program = coins.program;
    coinBonus = coins.coinBonus;
  }
  program = withBoostPrograms(program, text, base, discardScaledBase);
  // The heads bonus is the attack's own printed extra damage, so it folds at the same pre-W/R step
  // as `scaled`. `scaled` stays board-only, since a coin face is not a board fact.
  const scaledTotal = scaled + coinBonus;

  // "Before doing damage": runs after everything that can cancel the attack and immediately before
  // §8.5, so a cancelled attack never strips a Tool and §8.5 reads the defender without it.
  // `scaled` was computed at declaration and is not re-read.
  if (preDamage !== null) {
    const stripped = applyAttackPreDamage(next, preDamage, action.seat, attackerUid, events);
    next = stripped.state;
    // Rebind the defender after the pre-damage discard, or §8.5 folds the stale snapshot.
    defender = next.players[defenderSeat].active ?? defender;
    // Rebind the attacker too, since the pre-damage step may discard from its own body.
    attackerBody = next.players[action.seat].active ?? attackerBody;
    // "If you can't discard any, this attack does nothing." Ends through `finishAttack` like other
    // cancelled attacks. Tests `stripped.cancelled` rather than `preDamage.kind`.
    if (stripped.cancelled) {
      events.push({
        type: "ATTACK_FAILED",
        seat: action.seat,
        uid: attackerUid,
        reason: "preDamage",
      });
      return finishAttack(next, action.seat, attackerUid, declared.name, events);
    }
  }

  // What §8.5 dealt to the defending Active, so the effect program can read it ("Heal from this
  // Pokémon the same amount of damage you did"). Stays 0 for an effect-only attack. Post-W/R,
  // reduction and prevention, unclamped: the same number `DAMAGE_DEALT.dealt` reports.
  let dealtToDefender = 0;
  // §9: the damaged Active's reactive Ability stage, then one stage per damaged-reacting Tool.
  let damagedStages: PendingStage[] = [];
  if (terms.scaledBase + scaledTotal > 0) {
    const hit = dealAttackDamage(
      next,
      {
        seat: action.seat,
        attackerUid,
        attacker,
        attackerBody,
        defenderSeat,
        defenderUid,
        defender,
        defenderCard,
        printedIndex,
        damageSuppression: text.damageSuppression,
        scaledBase: terms.scaledBase,
        scaledTotal,
        printedPenalty,
      },
      events,
    );
    next = hit.state;
    dealtToDefender = hit.dealt;
    damagedStages = hit.damagedStages;
  }

  // §8 step 4: the effect program runs after the damage, then the damaged trigger, then the on-KO
  // Tool trigger, all before `finishAttack`'s §8.1 sweep. Any of them can park, so the tail is
  // staged. The on-KO Tool stage is seeded on presence alone, since a KO can come from the program,
  // and must sit ahead of `attackEpilogue` before the KO discards the stack.
  const koToolStage: PendingStage | null =
    koToolTriggersOf(next, defenderSeat, defenderUid).length > 0
      ? { kind: "koToolTrigger", seat: defenderSeat }
      : null;
  const epilogue: PendingStage[] = [
    ...damagedStages,
    ...(koToolStage === null ? [] : [koToolStage]),
    // `uid` is the attacker as of declaration; the effect program may switch it to the Bench.
    // `attack` is captured at the same time for `usedAttack`.
    { kind: "attackEpilogue", seat: action.seat, uid: attackerUid, attack: declared.name },
  ];
  if (program !== null) {
    return settleProgram(
      runProgram(
        { ...next, pending: [...next.pending, ...epilogue] },
        program,
        // The attacker is identified by uid, not "the Active", in case the program moves it.
        // `invokedBy: "attack"` is set only here and lets a §11 block tell an attack's effect
        // apart. `borrowedAttack` names a Memory Dive or Technical Machine row, so a name-keyed
        // self-lock binds to that row.
        {
          seat: action.seat,
          sourceUid: attackerUid,
          invokedBy: "attack",
          dealt: dealtToDefender,
          ...(entry.origin === "printed" || copiedFrom !== null
            ? {}
            : { borrowedAttack: declared.name }),
        },
        {},
        events,
      ),
      action.seat,
      { resumeTail: true },
      events,
    );
  }

  // No effect program: if the defender reacts, drain the trigger stages and epilogue through
  // `advance`; otherwise call `finishAttack` directly.
  if (damagedStages.length > 0 || koToolStage !== null) {
    return advance({ ...next, pending: [...next.pending, ...epilogue] }, events);
  }

  // §8.1 Knock Out sweep on both boards, then the §5.3 turn end (or the Festival Lead attack-again
  // window).
  return finishAttack(next, action.seat, attackerUid, declared.name, events);
}

/** A declaration that passed every §4/§8/§9/§11 gate and the §8.2 cost check. */
interface DeclaredAttack {
  active: InPlayPokemon;
  attackerUid: string;
  /** The in-play view, so a retyped body (Scovillain ex) is read with the types it has in play. */
  attacker: Card;
  /** The menu row; it keeps the card the attack is printed on. */
  entry: AttackMenuEntry;
  declared: Attack;
  index: number;
  /**
   * The index a persisted record may name: the printed index for a printed row, and -1 for a Memory
   * Dive or Tool row, so index-keyed locks and named boosts never reach a borrowed attack while
   * whole-body locks and all-attacks boosts still do.
   */
  printedIndex: number;
  provided: string[];
  /** The charged cost, also used by `scaledAttackDamage` for extra-Energy readers. */
  cost: readonly string[];
}

/** The §4/§8/§9/§11/§12 declaration gates and the §8.2 cost check, in their reporting order. */
function checkDeclaration(state: GameState, action: AttackAction): DeclaredAttack | Rejection {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  const side = state.players[action.seat];
  const active = side.active;
  if (active === null) {
    // Unreachable — promotion is forced before the next action.
    return err("NO_TARGET", "no Active Pokémon to attack with");
  }
  // §4: the going-first player may not attack on turn 1, unless the Active's Ability or the
  // declared attack licenses it. It reads `action.index` before the index is validated, which is
  // safe because it is only a lookup, and keeps this rejection ahead of the others.
  if (firstTurnAttackBanned(state, active, action.index)) {
    return err("FIRST_TURN_ATTACK", "the going-first player cannot attack on turn 1 (§4)");
  }
  // §8 step 1 / §12 — an Asleep or Paralyzed Active cannot attack at all.
  // (Confusion does NOT block declaring — it flips at resolution.)
  const rotation = active.conditions.rotation;
  if (isImmobilized(active.conditions)) {
    return err(
      "STATUS_PREVENTS_ATTACK",
      `${rotation === "asleep" ? "an Asleep" : "a Paralyzed"} Pokémon cannot attack (§12)`,
    );
  }
  // §8/§11: an attack effect locked this Pokémon out of attacking this turn, whichever player's
  // attack installed it. A rejection rather than `ATTACK_FAILED`, so nothing is spent and the turn
  // does not end. Checked before the index and cost checks so the lock is the reported reason.
  if (attackLocked(state, active)) {
    return err("ATTACK_PREVENTED", "an attack effect stops this Pokémon attacking this turn (§11)");
  }
  // §8/§9: the body's own Ability bars attacking unless a board condition holds. Checked before the
  // index because it is a fact about the body; the message names the printed clause.
  const abilityGate = attackBarredByAbility(state, action.seat, active);
  if (abilityGate !== undefined) {
    return err(
      "ATTACK_PREVENTED",
      `this Pokémon's Ability stops it attacking unless ${conditionNote(abilityGate)} (§9)`,
    );
  }
  // §5.3/§8: during the Festival Lead attack-again window, only the first attacker may declare,
  // from the Active Spot, while Festival Grounds is in play and its Ability is unlocked. The board
  // may no longer license the window, leaving only `endTurn`.
  if (attackAgainBarred(state, action.seat, active)) {
    return err(
      "ATTACK_PREVENTED",
      "this Pokémon may not attack again this turn: the Festival Lead window belongs to the Pokémon that attacked first, and needs Festival Grounds in play and its Ability unlocked (§9)",
    );
  }
  const attackerUid = topUid(active);
  const attacker = inPlayCardOf(state, active);
  if (attackerUid === undefined || attacker === undefined) {
    return err("UNKNOWN_CARD", "no catalog card for the Active Pokémon");
  }
  // `index` addresses the attack menu: printed attacks first, then Memory Dive rows, then a
  // Technical Machine's.
  const menu = attackMenuOf(state, action.seat, active);
  const index = action.index;
  // Wire check (types are not validation): the integer gate matters because
  // a string "0" WOULD resolve `menu["0"]` while corrupting everything
  // downstream that does arithmetic with it; the indexed access then covers
  // range (and noUncheckedIndexedAccess types it `| undefined` anyway).
  const entry = Number.isInteger(index) ? menu[index] : undefined;
  if (entry === undefined) {
    return err("BAD_ATTACK_INDEX", `${attacker.name} has no attack at index ${String(index)}`);
  }
  const declared = entry.attack;
  const printedIndex = entry.origin === "printed" ? entry.sourceIndex : -1;
  // §8/§11: an effect barred this specific attack this turn. Checked after the index check (it is a
  // fact about the declaration) and before the cost check. Several bars can be live at once, by
  // index or by name.
  if (
    lockedAttackIndexes(state, active).includes(printedIndex) ||
    lockedAttackNames(state, active).includes(declared.name)
  ) {
    return err(
      "ATTACK_PREVENTED",
      `an attack effect stops this Pokémon using ${declared.name} this turn (§11)`,
    );
  }
  // §4/§8: the attack's printed timing clause ("only if you go second…"). Checked after the §11 bar
  // and before the cost check; the message names the clause.
  const timingGate = attackTimingBlocked(state, action.seat, active, index);
  if (timingGate !== undefined) {
    return err(
      "ATTACK_PREVENTED",
      `${declared.name} is printed with a timing clause — ${attackTimingNote(timingGate)} (§4)`,
    );
  }
  // §8.2 cost check against the attached Energy's provision, under continuous cost effects and the
  // attack's printed cost clause.
  const provided = providedEnergy(state, active);
  const cost = attackCostAt(state, action.seat, active, index, provided);
  if (!costMet(cost, provided)) {
    return err("ATTACK_COST_UNMET", `${declared.name} costs [${cost.join(", ")}]`);
  }
  return { active, attackerUid, attacker, entry, declared, index, printedIndex, provided, cost };
}

/**
 * The coins taken before the attack resolves, in rulebook order: the flip-to-attack lock, the
 * Confusion flip, then Try to Imitate's printed coin. None is repeated on a resumed copy half or a
 * Backtrack Badge re-entry, which already flipped. `resolves` is false when one of them ended the
 * attack or an empty copy override leaves nothing to resolve; the caller then finishes the attack.
 */
function flipOpeningCoins(
  state: GameState,
  action: AttackAction,
  active: InPlayPokemon,
  attackerUid: string,
  { copied, coinRedo }: AttackReentry,
  events: GameEvent[],
): { state: GameState; resolves: boolean } {
  const secondHalf = copySourceOf(copied)?.resumed === true || coinRedo !== undefined;
  let next = state;
  // §8 flip-to-attack lock: the locked player flips each coin, and any tails fails the attack. RNG
  // is spent only while a lock is live. It runs before the Confusion flip, per the rulebook's
  // order, so tails ends the attack with no Confusion coin.
  const lockCoins = secondHalf ? 0 : attackFlipLockCoins(state, active);
  if (lockCoins > 0) {
    let lockTails = false;
    for (let coin = 0; coin < lockCoins; coin++) {
      const [face, rngState] = flipCoin(next.rngState);
      next = { ...next, rngState };
      events.push({
        type: "ATTACK_FLIP_LOCK_CHECK",
        seat: action.seat,
        uid: attackerUid,
        result: face,
      });
      if (face === "tails") lockTails = true;
    }
    if (lockTails) {
      events.push({
        type: "ATTACK_FAILED",
        seat: action.seat,
        uid: attackerUid,
        reason: "flipLock",
      });
      return { state: next, resolves: false };
    }
  }

  // §8 step 3: the Confusion flip, after every gate and the cost check. Tails: the attack does not
  // resolve and the attacker damages itself.
  if (active.conditions.rotation === "confused" && !secondHalf) {
    const [face, rngState] = flipCoin(next.rngState);
    next = { ...next, rngState };
    events.push({ type: "CONFUSION_CHECK", seat: action.seat, uid: attackerUid, result: face });
    if (face === "tails") {
      events.push({
        type: "ATTACK_FAILED",
        seat: action.seat,
        uid: attackerUid,
        reason: "confusion",
      });
      // The self-damage amount is read off the body's `confusionDamage` (3 counters unless raised).
      // `active` is correct here since nothing has rebound the body before §8.5.
      const confusionDamage = active.conditions.confusionDamage;
      const hurt = { ...active, damage: active.damage + confusionDamage };
      next = withActive(next, action.seat, hurt);
      events.push({
        type: "COUNTERS_PLACED",
        seat: action.seat,
        uid: attackerUid,
        amount: confusionDamage,
        source: "confusion",
      });
      // The self-hit can KO the attacker itself — prized to the DEFENDER
      // (collectKnockOuts owes each KO's prize to the KO'd side's opponent). The
      // epilogue sweeps both boards; the defender took no damage on this failed
      // attack, so only the attacker's own board can be lethal here.
      return { state: next, resolves: false };
    }
  }

  // Try to Imitate's printed coin, after the Confusion block. Tails or an empty override resolves
  // nothing; the turn ends through the staged tail.
  if (copied?.flip === true && coinRedo === undefined) {
    const [face, rngState] = flipCoin(next.rngState);
    next = { ...next, rngState };
    events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat: action.seat, result: face });
    if (face === "tails") return { state: next, resolves: false };
  }
  return { state: next, resolves: copied?.empty !== true };
}

/** What the printed (or copied) attack text resolves to: the damage box and every reader's result. */
interface AttackText {
  printedBase: number;
  modifier: ParsedDamage["modifier"];
  /** The effect text left after every clause split, or null; `""` means no text remains. */
  effect: string | null;
  /** The printed "this attack does nothing" requirement, or null. */
  requirement: BoardCondition | null;
  /** A requirement or cancel clause was split off, so `effect` is a different sentence. */
  requirementSplit: boolean;
  /** The authored or derived effect program, or null (unsimulated). */
  program: EffectOp[] | null;
  preDamage: AttackPreDamage | null;
  damageMultiplier: AttackDamageBonus | null;
  damagePenalty: AttackDamageBonus | null;
  damageSuppression: AttackDamageSuppression | null;
  /** The count-scaling bonus or multiplier; at most one fires. */
  scaling: AttackDamageBonus | null;
  coinFlip: AttackCoinFlip | null;
  optionalBoost: AttackOptionalBoost | null;
  bonusConsequent: AttackBonusConsequent | null;
  optionalCostBoost: AttackOptionalCostBoost | null;
  discardScaledBoost: AttackDiscardScaledBoost | null;
}

/**
 * Reads the attack's text. Mechanical damage and Weakness/Resistance are simulated; effect text
 * runs only for shapes effects.ts recognizes, and anything else is flagged rather than guessed.
 * Under a copy, the damage box, text and source gate are the copied attack's; `usableCopies`
 * already enforced that gate for the copier.
 */
function readAttackText(
  state: GameState,
  { active, entry, declared, index, provided, cost }: DeclaredAttack,
  copiedFrom: Exclude<AttackCopyOverride, { empty: true }> | null,
): AttackText {
  // `parseAttackDamage`'s only caller.
  const { base: printedBase, modifier } = parseAttackDamage(
    (copiedFrom?.attack ?? declared).damage,
  );
  // The attack's gate clause was already enforced at declaration, so it is stripped before the
  // effect readers run, but only when `attackGateOf` confirms a gate at this index; otherwise the
  // whole string stays and is reported as skipped.
  const printedEffect = (copiedFrom?.attack ?? declared).effect ?? null;
  const gateSplit =
    printedEffect === null ||
    attackGateOf(state, copiedFrom?.body ?? active, copiedFrom?.index ?? index) === undefined
      ? null
      : splitAttackGateClause(printedEffect);
  // A clause-only printing leaves an empty body, which every reader below treats as no text.
  const gated = gateSplit === null ? printedEffect : gateSplit.body;
  // The requirement split reads the requirement off the unsplit string before only the body is
  // passed on. It fires only when the leading clause maps to an `ATTACK_REQUIREMENT_CLAUSES` row.
  // Gate split must come before requirement split: on a string carrying both, the reverse order
  // resolves neither.
  const requirementSplit =
    gated === null || gated === "" ? null : splitAttackRequirementClause(gated);
  // The printed "If <clause>, this attack does nothing." requirement, or null. Read off `gated`,
  // since `effect` is only the trailing companion once a split fires.
  const leadingRequirement = gated === null || gated === "" ? null : deriveAttackRequirement(gated);
  const composed = requirementSplit === null ? gated : requirementSplit.body;
  // Strips a trailing "If you can't, this attack does nothing." after reading it as a requirement
  // off the unsplit string. It is a requirement rather than an effect op because effect programs
  // run after damage, where nothing can retract it. Fires only when the head maps to an
  // `ATTACK_CANCEL_HEADS` row.
  const cancelSplit =
    composed === null || composed === "" ? null : splitAttackCancelClause(composed);
  const cancelRequirement =
    composed === null || composed === "" ? null : deriveAttackCancelRequirement(composed);
  // The two requirement readers are mutually exclusive by their anchors, so `??` is a join, not a
  // precedence.
  const requirement = leadingRequirement ?? cancelRequirement;
  const uncancelled = cancelSplit === null ? composed : cancelSplit.head;
  // Splits off a trailing effect clause that still has to be read, appended to the program as
  // `derivedTail`. It fires only when no reader claims the whole string and both halves are
  // claimed. It sits above all damage readers because some compounds put a damage-bonus clause in
  // the head.
  const compoundSplit =
    uncancelled === null || uncancelled === "" ? null : splitAttackTrailingClause(uncancelled);
  const effect = compoundSplit === null ? uncancelled : compoundSplit.head;
  const read = <T>(reader: (text: string) => T | null): T | null =>
    effect === null || effect === "" ? null : reader(effect);
  // An authored registry program wins over the text deriver, else null (unsimulated). Programs are
  // keyed by attack index so one authored attack does not leak onto its siblings. A copied or
  // menu-row attack runs its source card's program at the source index.
  const authored =
    programFor((copiedFrom?.card ?? entry.card).id)?.attack?.[
      copiedFrom?.index ?? entry.sourceIndex
    ] ?? null;
  const derivedHead = read(deriveAttackEffect);
  // Head program first, then the trailing clause's ops, in printed order.
  const derivedTail = compoundSplit === null ? null : deriveAttackEffect(compoundSplit.tail);
  const derived = derivedTail === null ? derivedHead : [...(derivedHead ?? []), ...derivedTail];
  // Count-scaling folds into the damage before §8.5. "more" adds `per × count` to the printed base,
  // no adjective replaces the base with `per × count`, and "less" subtracts it. The regexes are
  // mutually exclusive, so at most one fires.
  const damageBonus = read(deriveAttackDamageBonus);
  const damageMultiplier = damageBonus !== null ? null : read(deriveAttackDamageMultiplier);
  return {
    printedBase,
    modifier,
    effect,
    requirement,
    requirementSplit: requirementSplit !== null || cancelSplit !== null,
    program: resolveDeclarationGates(authored ?? derived, provided.length - cost.length),
    // "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon." Kept
    // separate from `program` because it runs before §8.5, while `program` runs at the tail.
    preDamage: read(deriveAttackPreDamage),
    damageMultiplier,
    // "This attack does N less damage for each …". Kept out of `scaling`: it is reported through
    // `debuff`, not `scaled`. The count may come from the defender, not only the attacker.
    damagePenalty:
      damageBonus !== null || damageMultiplier !== null ? null : read(deriveAttackDamagePenalty),
    // "This attack's damage isn't affected by Weakness or Resistance …". Read unconditionally
    // rather than chained onto the scaling ladder, because it is a separate clause that can trail a
    // scaling clause.
    damageSuppression: read(deriveAttackDamageSuppression),
    scaling: damageBonus ?? damageMultiplier,
    // The attack's own printed coin flip: a heads bonus, a cancel on tails, a per-heads fold, or
    // null. Disjoint from the other readers and from `coinFlipGate` programs, so at most one flip
    // decision applies per attack.
    coinFlip: read(deriveAttackCoinFlip),
    // "You may do N more damage. If you do, …".
    optionalBoost: read(deriveAttackOptionalBoost),
    // "…this attack does N more damage, and …", decided by a board fact or a coin instead of a
    // confirm.
    bonusConsequent: read(deriveAttackBonusConsequent),
    // "You may {cost}. If you do, {payoff}".
    optionalCostBoost: read(deriveAttackOptionalCostBoost),
    // "You may discard up to N Energy from your Benched Pokémon. This attack does P more damage for
    // each card you discarded in this way."
    discardScaledBoost: read(deriveAttackDiscardScaledBoost),
  };
}

/** Whether a reader or the program owns the printed base, and the base that lands before §8.5. */
interface BaseDamageTerms {
  /**
   * A program that deals the main damage itself owns the printed number, so the base must not also
   * land before the program. `damageNewActive` is deliberately excluded: it is an additional hit on
   * another body, not the printed base.
   */
  programDamage: boolean;
  /**
   * For `optionalCostBoost`, only the `moreDamage` payoff re-homes the base; `benchSnipe` is an
   * extra hit and keeps it.
   */
  costBoostOwnsTheBase: boolean;
  scaledBase: number;
}

function baseDamageTerms(text: AttackText, base: number): BaseDamageTerms {
  const programDamage = text.program?.some((step) => step.op === "damageDefender") ?? false;
  const costBoostOwnsTheBase = text.optionalCostBoost?.payoff.kind === "moreDamage";
  const { coinFlip } = text;
  // The multiply family's printed "N×" is the per-unit already counted in `scaled`, so the base is
  // dropped; additive families keep it. Readers whose hit is dealt inside a nested gate or appended
  // program also drop it here, since `programDamage` only sees top-level ops of the registry or
  // derived program. `opponentPerTails` drops the printed base like `perHeads`, since its marker is
  // read as "N×".
  const scaledBase =
    text.damageMultiplier !== null ||
    programDamage ||
    text.optionalBoost !== null ||
    text.bonusConsequent !== null ||
    costBoostOwnsTheBase ||
    text.discardScaledBoost !== null ||
    coinFlip?.kind === "perHeads" ||
    coinFlip?.kind === "opponentPerTails" ||
    coinFlip?.kind === "perHeadsThenThreshold"
      ? 0
      : base;
  return { programDamage, costBoostOwnsTheBase, scaledBase };
}

/**
 * Whether the effect text and the +/× damage modifier are simulated. The modifier counts only when
 * a reader consumes it or the program deals the damage; the text counts when a program or reader
 * resolves it. Everything else is reported as `ATTACK_EFFECT_SKIPPED`. Readers that explain no
 * damage marker must not claim the modifier.
 */
function simulatedParts(
  text: AttackText,
  { programDamage, costBoostOwnsTheBase }: BaseDamageTerms,
): { effect: boolean; modifier: boolean } {
  const { coinFlip } = text;
  const effect =
    text.program !== null ||
    text.preDamage !== null ||
    text.scaling !== null ||
    text.damagePenalty !== null ||
    // Only when no split fired: after a split, `effect` holds a different sentence that the
    // requirement says nothing about, and a bare term would silence an unresolved sentence.
    (text.requirement !== null && !text.requirementSplit) ||
    coinFlip !== null ||
    text.optionalBoost !== null ||
    text.bonusConsequent !== null ||
    text.optionalCostBoost !== null ||
    text.discardScaledBoost !== null ||
    text.damageSuppression !== null;
  // Coin members that fold no damage explain no printed damage marker, so they are listed as
  // exceptions rather than testing `coinFlip !== null`.
  const coinExplainsModifier =
    coinFlip !== null &&
    coinFlip.kind !== "cancelOnTails" &&
    coinFlip.kind !== "cancelOnTailsElseProgram" &&
    coinFlip.kind !== "deckUpToHeads" &&
    coinFlip.kind !== "programPerHeads" &&
    coinFlip.kind !== "retrievalUpToHeads";
  // Only the `moreDamage` payoff explains a printed "+"; `benchSnipe` is a second hit and explains
  // none.
  const modifier =
    text.scaling !== null ||
    text.damagePenalty !== null ||
    programDamage ||
    text.optionalBoost !== null ||
    text.bonusConsequent !== null ||
    costBoostOwnsTheBase ||
    text.discardScaledBoost !== null ||
    coinExplainsModifier;
  return { effect, modifier };
}

/**
 * The attack's own printed coin flips, taken before §8.5 so a flip can add to or cancel the damage,
 * and after the requirement gate so a cancelled attack does not consume rng. Each flip emits one
 * `ATTACK_EFFECT_COIN_FLIP` row in order. A per-heads program is expanded into repeated ops and
 * appended to `program`, never assigned over it. `done` is set when the flips parked a Backtrack
 * Badge offer or cancelled the attack.
 */
function flipPrintedCoins(
  state: GameState,
  printed: {
    action: AttackAction;
    active: InPlayPokemon;
    attackerUid: string;
    attackName: string;
    coinFlip: AttackCoinFlip;
    program: EffectOp[] | null;
    reentry: AttackReentry;
  },
  events: GameEvent[],
): { done: ApplyResult } | { state: GameState; program: EffectOp[] | null; coinBonus: number } {
  const { action, active, attackerUid, attackName, coinFlip } = printed;
  const { copied, coinRedo } = printed.reentry;
  let next = state;
  let program = printed.program;
  let coinBonus = 0;
  // A Backtrack Badge "keep" re-entry reuses the offered faces without flipping; "again" flips
  // anew.
  const kept = coinRedo?.kind === "keep" ? coinRedo.faces : undefined;
  const [faces, rngState] =
    kept === undefined
      ? takeFlips(next, action.seat, active, printedFlips(coinFlip))
      : [kept, next.rngState];
  next = { ...next, rngState };
  // Coin rows are filed under the seat that flips: the opponent for `opponentPerTails` ("Your
  // opponent flips a coin"), otherwise the attacker.
  const flipper = coinFlip.kind === "opponentPerTails" ? otherSeat(action.seat) : action.seat;
  let heads = 0;
  for (const face of faces) {
    if (kept === undefined)
      events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat: flipper, result: face });
    if (face === "heads") heads += 1;
  }
  // Backtrack Badge: after the attacker's own coins, on the first pass only, a Badge on the
  // attacking Pokémon offers its reflip before any coin is read.
  const redoTool =
    coinRedo === undefined && flipper === action.seat && faces.length > 0
      ? coinRedoToolOf(next, next.players[action.seat].active ?? active)
      : null;
  if (redoTool !== null) {
    return {
      done: parkCoinRedo(
        next,
        action.seat,
        attackerUid,
        attackName,
        {
          op: "reflipAttackCoins",
          toolUid: redoTool,
          index: action.index,
          faces: [...faces],
          ...(copied === undefined ? {} : { copied }),
        },
        events,
      ),
    };
  }
  if (coinFlip.kind === "cancelOnTails" || coinFlip.kind === "cancelOnTailsElseProgram") {
    if (heads === 0) {
      // No damage, no effects, no triggers; `finishAttack` still runs because the attack was
      // used.
      events.push({
        type: "ATTACK_FAILED",
        seat: action.seat,
        uid: attackerUid,
        reason: "coinFlip",
      });
      return { done: finishAttack(next, action.seat, attackerUid, attackName, events) };
    }
    // Heads branch of the same flip. Appended to `program`, never assigned, so a registry program
    // is not dropped.
    if (coinFlip.kind === "cancelOnTailsElseProgram") {
      program = [...(program ?? []), ...coinFlip.ops];
    }
  } else if (coinFlip.kind === "programPerHeads") {
    // One copy of the member's ops per face matching its printed face, in flip order. Sharing the
    // same ops array is safe because the interpreter never mutates ops. The tally counts the
    // printed face, not `heads`.
    let onPrintedFace = 0;
    for (const drawn of faces) if (drawn === coinFlip.face) onPrintedFace += 1;
    const repeated: EffectOp[] = [];
    for (let i = 0; i < onPrintedFace; i += 1) repeated.push(...coinFlip.ops);
    const expanded = [...(program ?? []), ...repeated];
    // Back to null when nothing came out of it (zero of the printed face and no prior program):
    // null is what the tail tests for, and an empty `EffectOp[]` would route the attack through
    // `settleProgram`, a different ending that could grow a KO sweep it did not have.
    program = expanded.length > 0 ? expanded : null;
  } else if (coinFlip.kind === "retrievalUpToHeads") {
    // "Up to" the number of heads: the count becomes one op's `max`. On zero heads nothing is
    // appended, rather than an empty program or a `max: 0` op.
    if (heads > 0) {
      program = [
        ...(program ?? []),
        { op: "discardPileRetrieval", filter: coinFlip.filter, dest: coinFlip.dest, max: heads },
      ];
    }
  } else if (coinFlip.kind === "deckUpToHeads") {
    // The heads count is the search's `max`; 0 heads searches and shuffles nothing.
    if (heads > 0) {
      const upToHeadsTake: EffectOp =
        coinFlip.to === "hand"
          ? { op: "searchDeck", filter: coinFlip.filter, dest: "hand", max: heads }
          : { op: "attachFromDeck", filter: coinFlip.filter, max: heads, toSelf: true };
      program = [...(program ?? []), upToHeadsTake, { op: "shuffleDeck" }];
    }
  } else if (coinFlip.kind === "bonusOnAllHeads") {
    // Hyper Lariat: the bonus applies only when every flipped coin is heads.
    coinBonus = heads === faces.length ? coinFlip.bonus : 0;
  } else if (coinFlip.kind === "bonusLadder") {
    // Heads ladder: a table lookup, not `per × heads`. Each tier is exclusive, so three heads
    // pays only the third tier. Spelled tier by tier rather than `ladder[heads - 1]` so an
    // out-of-range index is not silently absorbed.
    const [onOneHead, onTwoHeads, onAllThree] = coinFlip.ladder;
    coinBonus = heads === 0 ? 0 : heads === 1 ? onOneHead : heads === 2 ? onTwoHeads : onAllThree;
  } else if (coinFlip.kind === "opponentPerTails") {
    // Per-tails fold in its own branch: falling through to the `else` would compile but count
    // heads instead of tails.
    let tails = 0;
    for (const drawn of faces) if (drawn === "tails") tails += 1;
    coinBonus = tails * coinFlip.per;
  } else {
    coinBonus = heads * coinFlip.per;
  }
  // Threshold check over the same faces. A separate `if` so the `per × heads` fold stays in one
  // expression. Counts the printed face, not `heads`. Appended to `program`, never assigned; a
  // failed threshold appends nothing.
  if (coinFlip.kind === "perHeadsThenThreshold") {
    let matching = 0;
    for (const face of faces) if (face === coinFlip.threshold.face) matching += 1;
    if (matching >= coinFlip.threshold.atLeast) {
      program = [...(program ?? []), ...coinFlip.ops];
    }
  }
  return { state: next, program, coinBonus };
}

/**
 * Appends the boost readers' programs, each never assigned over `program`. `base` is the printed
 * (or boosted) base, and `discardScaledBase` the declaration-time head for `selfHandAttach`.
 */
function withBoostPrograms(
  program: EffectOp[] | null,
  text: AttackText,
  base: number,
  discardScaledBase: number,
): EffectOp[] | null {
  let out = program;
  // Optional boost: both arms deal one `damageDefender` through §8.5 (yes at `base + bonus` plus
  // the consequent, no at the printed base), so W/R applies once. `scaledBase` is already 0, so
  // nothing is dealt before the program.
  if (text.optionalBoost !== null) {
    out = [...(out ?? []), ...optionalBoostProgram(text.optionalBoost, base, text.effect ?? "")];
  }
  // The gate takes a single coin inside `runProgram` and both arms branch on that face; reading it
  // with `deriveAttackCoinFlip` as well would flip twice.
  if (text.bonusConsequent !== null) {
    out = [...(out ?? []), ...bonusConsequentProgram(text.bonusConsequent, base)];
  }
  // Two nested gates, each with a decline arm that still deals the printed base, since the attack
  // is "140+" rather than "+140".
  if (text.optionalCostBoost !== null) {
    out = [
      ...(out ?? []),
      ...optionalCostBoostProgram(text.optionalCostBoost, base, text.effect ?? ""),
    ];
  }
  // No gate and no decline arm: declining discards zero cards, so the hit is `base + P × 0`.
  if (text.discardScaledBoost !== null) {
    out = [
      ...(out ?? []),
      ...discardScaledBoostProgram(text.discardScaledBoost, discardScaledBase),
    ];
  }
  return out;
}

/** The main hit's two bodies and the damage terms fixed before §8.5. */
interface AttackHit {
  /** The declaring seat, which deals the main hit. */
  seat: Seat;
  attackerUid: string;
  /** The attacker's in-play card as of declaration. */
  attacker: Card;
  /** The attacker's post-pre-damage binding. */
  attackerBody: InPlayPokemon;
  defenderSeat: Seat;
  defenderUid: string;
  /** The defender's post-pre-damage binding. */
  defender: InPlayPokemon;
  defenderCard: Card;
  printedIndex: number;
  damageSuppression: AttackDamageSuppression | null;
  scaledBase: number;
  /** The attack's own extra: scaling plus any heads bonus. */
  scaledTotal: number;
  printedPenalty: number;
}

/**
 * §8.5 damage pipeline in printed order: base + the attack's own extra (`scaledTotal`) + pre-W/R
 * bonuses → Weakness → Resistance → the defender's damage reduction, floored at 0, then the §9
 * reactions to the hit. Returns what was dealt and the damaged-trigger stages to queue.
 */
function dealAttackDamage(
  state: GameState,
  hit: AttackHit,
  events: GameEvent[],
): { state: GameState; dealt: number; damagedStages: PendingStage[] } {
  const { seat, attackerUid, attacker, attackerBody, defenderSeat, defenderUid, defender } = hit;
  const { defenderCard, printedIndex, damageSuppression, scaledBase, scaledTotal } = hit;
  let next = state;
  // `scaledBase` is 0 for a multiply clause, whose "N×" is already in `scaled`. The installed
  // next-turn boost is summed separately because an Ability lock must not suppress it. "Any
  // effects on your opponent's Active Pokémon" can come from the attack text or from the
  // attacker's Ability; both feed this one flag.
  const suppressTargetEffects =
    damageSuppression?.targetEffects === true ||
    attackerSuppressesTargetEffects(next, attackerBody);
  // Black Belt's Training this-turn bonus against a Pokémon ex: an installation, so a §9 lock
  // cannot reach it, and unaffected by `suppressTargetEffects` because it is the attacker's
  // number.
  const bonus =
    attackerPreWRBonus(next, attackerBody, seat, defenderCard) +
    boostedAttackDamage(next, attackerBody, printedIndex) +
    sideAttackBonusThisTurn(next, seat, defenderCard, attackerBody);
  // Pre-W/R subtraction from three sources: an installed debuff on the attacker, an opposing
  // Active's aura, and the attack's own "less damage" clause. Kept separate from the bonus
  // because it is reported as `debuff` and needs a clamp. Only the aura half is an effect on the
  // defender, so only it is nulled by `suppressTargetEffects`.
  const debuff =
    installedAttackDebuffOf(next, attackerBody) +
    (suppressTargetEffects ? 0 : opposingAttackDebuff(next, attackerBody)) +
    // Gloomy Garbage: the suppression drops only a defending holder's own term.
    opposingToolAttackDebuff(next, attackerBody, suppressTargetEffects ? defender : undefined) +
    hit.printedPenalty;
  // Weakness is nulled by a "no Weakness" aura (Blooming Garden), by the attack's own "isn't
  // affected by Weakness", or by a bar the defender's previous attack installed; Resistance still
  // applies. The order of the disjuncts does not matter. A Weakness retype is applied after the
  // null paths and dropped by `suppressTargetEffects`.
  const weaknessRetype = suppressTargetEffects ? null : installedWeaknessRetypeOf(next, defender);
  // Lillie's Clefairy ex "Fairy Zone" rewrites the defender's Weakness from the attacker's side;
  // the null paths still win, and `suppressTargetEffects` drops it. Overwriting Bolt's installed
  // rewrite applies first.
  const weaknessRewrite = suppressTargetEffects
    ? null
    : (installedWeaknessRewriteOf(next, defender) ??
      seatWeaknessRewrite(next, defenderSeat, defenderCard));
  const weakness =
    damageSuppression?.weakness === true ||
    seatRemovesWeakness(next, defenderSeat) ||
    installedNoWeakness(next, defender)
      ? null
      : // Illumise "Supereffective Pheromones": Weakness applies as ×3 instead of ×2.
        withWeaknessAmount(
          weaknessOf(attacker, defenderCard, weaknessRetype, weaknessRewrite),
          weaknessAmountOverride(next),
        );
  // Resistance has its own suppression flag because some attacks suppress Resistance alone.
  const resistance =
    damageSuppression?.resistance === true ? null : resistanceOf(attacker, defenderCard);
  // Clamped at this step, not only at the end, because an attack never does negative damage; with
  // additive old-era Weakness the two placements differ.
  const preWR = Math.max(0, scaledBase + scaledTotal + bonus - debuff);
  const afterWR = Math.max(
    0,
    applyDamageModifier(applyDamageModifier(preWR, weakness), resistance),
  );
  // The fold plus the watched-Active recoil (Spiteful Swirl, Counterattack Grouping), read only
  // by the recoil below.
  const defenderPassives = withWatchedRecoil(
    next,
    defenderSeat,
    defender,
    passivesOf(next, defender),
  );
  // "Takes N less damage from attacks (after applying Weakness and Resistance)", summed from
  // catalog Abilities and Tools, installed reductions, own-side seat-wide auras, and Berries.
  // Under `suppressTargetEffects` the on-target terms drop and the seat-wide aura only counts
  // when granted by another Pokémon. A Berry is asked only when `preWR > 0`, and a dropped or
  // unasked Berry is not spent.
  const berry =
    suppressTargetEffects || preWR === 0
      ? NO_CONSUMABLE
      : berryReductionOf(next, defender, attacker, seat);
  const reduction = suppressTargetEffects
    ? seatDamageReduction(next, defender, "othersOnly", seat)
    : berry.amount +
      defenderPassives.damageReductionAfterWR +
      // Attacker-gated reductions (Sacred Charm, Thick Scale, Thick Fat), on-target.
      attackerGatedReductionOf(
        next,
        defender,
        defenderPassives.damageReductionsFromAttacker,
        attacker,
        seat,
      ) +
      installedReductionOf(next, defender, attacker, attackerBody) + // Metal Block.
      seatDamageReduction(next, defender, "all", seat);
  // Full prevention, which supersedes any reduction: catalog auras on the holder and installed
  // blocks are on-target and dropped by `suppressTargetEffects`; the shielding Active and the
  // Stadium are off-target and stay. The off-target reads are always false for the defending
  // Active but are kept so the check is total. A block's `maxDamage` is compared against
  // `wouldDeal`. An installed vulnerability adds after W/R, only when `preWR > 0` (the rulebook
  // stops when base damage is 0), and is on-target.
  const vulnerability =
    suppressTargetEffects || preWR === 0 ? 0 : installedVulnerabilityOf(next, defender);
  const wouldDeal = Math.max(0, afterWR + vulnerability - reduction);
  // The coin-flip shield is asked after the pure preventions, so no coin is flipped for damage
  // already stopped.
  const preventedBeforeFlip =
    (!suppressTargetEffects &&
      ((defenderPassives.preventDamageFromExV && isExOrV(attacker)) ||
        preventsAttackerType(defenderPassives.preventDamageFromTypes, attacker) ||
        // Inside the suppression guard because it is a catalog aura on the damaged Pokémon.
        (defenderPassives.preventDamageFromHasAbility && hasPrintedAbility(attacker)) ||
        // Inside the suppression guard because it is a catalog aura on the damaged Pokémon. Reads
        // `attacker` because it gates on the attacking card's printed name and stage.
        preventsAttackerClass(defenderPassives.preventDamageFromAttackerClasses, attacker) ||
        // Sparkling Scales, inside the suppression guard.
        preventsAttackerBanner(defenderPassives.preventDamageAndEffectsFromBanners, attacker) ||
        // Reads `attackerBody`, the post-discard binding, because it gates on the attacker's
        // attachments. Inside the suppression guard.
        (defenderPassives.preventDamageAndEffectsFromSpecialEnergy &&
          attackerHasSpecialEnergy(next, attackerBody)) ||
        // Plume Protection, the damage-only twin.
        defenderPassives.preventDamageWhileBenched ||
        // Always false here, since this is the defending Active and the flag only applies on the
        // Bench; read anyway so the check is total.
        defenderPassives.preventDamageAndEffectsWhileBenched ||
        // Prevents damage by amount rather than by attacker ("or more"), in the Active Spot and
        // on the Bench alike. ORed with `attackBlockOf`'s cap, not merged, because they are
        // different channels with opposite polarity.
        preventedByDamageThreshold(defenderPassives.preventDamageAtOrAbove, wouldDeal) ||
        attackBlockOf(next, defender, attacker, wouldDeal, attackerBody) !== null)) ||
    // Always false here: both sentences target benched Pokémon and `defender` is the Active.
    benchShieldedFromDamage(next, defender, "all") ||
    // Ancient Bulwark: the holder is benched, so it is never the defender here.
    seatShieldedFromLowEnergyAttacker(next, defender, attackerBody, seat, "all") ||
    stadiumPreventsDamage(next, defender, attacker);
  // The coin-flip shield must be a statement, last, because it draws rng and emits a row. It
  // flips only if damage would still land after prevention, suppression and reduction. Its row
  // precedes `DAMAGE_DEALT`, and `next` takes the advanced `rngState` immediately.
  const [flipPrevented, rngState] = coinFlipShieldPrevents(
    next,
    defender,
    defenderSeat,
    preventedBeforeFlip || suppressTargetEffects ? 0 : wouldDeal,
    events,
  );
  next = { ...next, rngState };
  const prevented = preventedBeforeFlip || flipPrevented;
  const dealt = prevented ? 0 : wouldDeal;
  // §8.1 KO-survival clamp, read here because "has full HP" is a pre-damage fact and `defender`
  // is the last binding holding it. `dealt` is not clamped, so the `dealt > 0` reactions still
  // see the damage. The result names the Survival Brace that answered, if any.
  const clamped = koSurvivalClamp(next, defender, dealt, seat);
  // Tenacious Body / Durable Body coin-flip survival, asked only when the clamp did not answer.
  const [coinSaved, survivalRng] =
    clamped === null
      ? koSurvivalCoinFlip(next, defender, defenderSeat, dealt, events)
      : [null, next.rngState];
  next = { ...next, rngState: survivalRng };
  // Record the damage dealt on the body (Juggernaut Horn).
  let defended = withAttackDamageTaken(
    { ...defender, damage: clamped?.damage ?? coinSaved ?? defender.damage + dealt },
    next.turn,
    dealt,
  );
  next = withSide(next, defenderSeat, { ...next.players[defenderSeat], active: defended });
  events.push({
    type: "DAMAGE_DEALT",
    seat: defenderSeat,
    // The main hit's dealer is always the declaring seat.
    by: seat,
    uid: defenderUid,
    base: scaledBase,
    // Present only when the attack's own extra (scaling or heads bonus) added damage.
    scaled: scaledTotal > 0 ? scaledTotal : undefined,
    // Present only when a continuous effect actually moved the total.
    bonus: bonus > 0 ? bonus : undefined,
    // The pre-W/R subtraction, in its own field rather than a negative `bonus`.
    debuff: debuff > 0 ? debuff : undefined,
    weakness,
    resistance,
    reduction: reduction > 0 ? reduction : undefined,
    // The post-W/R addition, in its own field.
    vulnerability: vulnerability > 0 ? vulnerability : undefined,
    prevented: prevented ? true : undefined,
    survived: clamped === null && coinSaved === null ? undefined : true,
    dealt,
    damage: defended.damage,
  });
  // Tools this hit consumed (Berries that reduced an unprevented hit, the Survival Brace that
  // answered) leave after the row showing their effect. `defended` is rebound so the Deluxe Bomb
  // scan sees the body without them.
  const spent = consumedTools(prevented ? [] : berry.toolUids, clamped);
  defended = consumeTools(defended, spent, defenderSeat, events);
  next = discardToPile(
    withSide(next, defenderSeat, { ...next.players[defenderSeat], active: defended }),
    defenderSeat,
    spent,
  );

  // §9 reactive recoil: when the defender is damaged, even if Knocked Out, it puts counters on
  // the attacker before the §8.1 sweep, outside the §8.5 pipeline. Labelled "counterattack"
  // because the sum mixes Ability, Tool and installed sources. `dealt`, not the clamped total,
  // feeds "equal to the damage done". An attacker with "Luminous Wing" refuses the Ability share.
  const refusedRecoil =
    dealt > 0 && passivesOf(next, attackerBody).preventAbilityEffects
      ? defenderPassives.damageAttackerFromAbility
      : 0;
  if (refusedRecoil > 0) {
    events.push({ type: "ABILITY_EFFECT_PREVENTED", seat, uid: attackerUid });
  }
  const recoil =
    defenderPassives.damageAttacker - refusedRecoil + installedRecoilOf(next, defender, dealt);
  if (dealt > 0 && recoil > 0) {
    const retaliated = { ...attackerBody, damage: attackerBody.damage + recoil };
    next = withActive(next, seat, retaliated);
    events.push({
      type: "COUNTERS_PLACED",
      seat,
      uid: attackerUid,
      amount: recoil,
      source: "counterattack",
    });
  }

  if (dealt === 0) return { state: next, dealt, damagedStages: [] };
  // §9 reactive trigger for the damaged Active (`onDamagedByAttack`), even if Knocked Out. Runs
  // as a staged epilogue after the attack's effect program and before the §8.1 sweep so it can
  // park. Seeded only when such an unlocked Ability is present.
  const damagedTrigger: PendingStage[] =
    damagedByAttackAbility(next, defenderSeat, defenderUid) !== undefined
      ? [{ kind: "damagedTrigger", seat: defenderSeat, uid: defenderUid }]
      : [];
  // Deluxe Bomb. Then one stage per damaged-reacting Tool, behind the Ability's stage, seeded only
  // when such a Tool is present. A list, because a parking Ability program would strand a program
  // chained behind it in the same stage.
  next = detonateDeluxeBomb(next, defenderSeat, defended, seat, dealt, events);
  const damagedToolStages = damagedToolTriggersOf(next, defenderSeat, defenderUid).map(
    ({ toolUid }): PendingStage => ({
      kind: "damagedTrigger",
      seat: defenderSeat,
      uid: toolUid,
    }),
  );
  return { state: next, dealt, damagedStages: [...damagedTrigger, ...damagedToolStages] };
}

// Copy attacks ("Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack."):
// made at declaration by re-entering `attack()` with an override, so the copied attack takes the
// normal §8 pipeline. The copied cost is ignored, the copier does the attack, and copy-family
// attacks are never candidates.

/** One body the copy may read, with its ELIGIBLE attacks (`index` into `attacksOf`). `ref` is
    the own-Bench spot for Night Joker, `null` for the opponent's Active. */
interface CopySource {
  body: InPlayPokemon;
  card: Card;
  ref: PokemonTarget | null;
  attacks: { index: number; attack: Attack }[];
}

/** Every printed attack of `card` that is not itself a copy-family attack. */
function copyCandidates(card: Card): { index: number; attack: Attack }[] {
  return attacksOf(card).flatMap((attack, index) =>
    COPY_FAMILY_MARKER.test(attack.effect ?? "") ? [] : [{ index, attack }],
  );
}

/**
 * The attacks of one source body the copier may use: `copyCandidates` minus any whose printed
 * timing or requirement clause bars the copier now. The clause is read from the source attack but
 * evaluated for the copier's seat. Barred attacks are not offered.
 */
function usableCopies(
  state: GameState,
  seat: Seat,
  body: InPlayPokemon,
  card: Card,
): { index: number; attack: Attack }[] {
  return copyCandidates(card).filter(
    ({ index }) => attackTimingBlocked(state, seat, body, index) === undefined,
  );
}

/** The bodies `copy` reads for `seat`, each with ≥ 1 eligible attack, live off `state`. */
function copySources(
  state: GameState,
  seat: Seat,
  copy: { from: AttackCopy["from"]; owner?: AttackCopy["owner"] },
): CopySource[] {
  if (copy.from === "benchOwner") {
    const owner = copy.owner;
    if (owner === undefined) return [];
    return state.players[seat].bench.flatMap((body, index) => {
      const card = topCardOf(state, body);
      if (card === undefined || !matchesFilter(card, { kind: "ownerPokemon", owner })) return [];
      const attacks = usableCopies(state, seat, body, card);
      return attacks.length === 0
        ? []
        : [{ body, card, ref: { spot: "bench" as const, index }, attacks }];
    });
  }
  const body = state.players[otherSeat(seat)].active;
  if (body === null) return [];
  const card = topCardOf(state, body);
  if (card === undefined) return [];
  if (copy.from === "opponentActiveTera" && !isTeraPokemon(card)) return [];
  const attacks = usableCopies(state, seat, body, card);
  return attacks.length === 0 ? [] : [{ body, card, ref: null, attacks }];
}

/** The PARK: `effect:choose` for the copier's seat, built by `settleProgram`'s own park branch
    (so the phase is byte-for-byte the shape every other park has). No RNG, no board change,
    no event but EFFECT_PENDING; no `resumeTail`, no `endsTurn`. */
function parkCopy(
  state: GameState,
  seat: Seat,
  attackerUid: string,
  op: OpOf<"useAttackAs">,
  prompt: EffectPrompt,
): ApplyResult {
  return settleProgram(
    {
      kind: "parked",
      state,
      prompt,
      cont: { pendingOp: op, rest: [], ctx: { seat, sourceUid: attackerUid } },
    },
    seat,
    {},
    [],
  );
}

/** The `chooseAttack` prompt over one source body's eligible attacks. */
function chooseCopiedAttack(source: CopySource, copierName: string): EffectPrompt {
  return {
    kind: "chooseAttack",
    candidates: source.attacks.map(({ index, attack }) => ({ index, name: attack.name })),
    note: `Choose 1 of ${source.card.name}'s attacks to use as ${copierName}.`,
  };
}

/** The override for one (source, attack) pair. */
function copiedOverride(
  source: CopySource,
  picked: { index: number; attack: Attack },
  flip: true | undefined,
): AttackCopyOverride {
  return {
    attack: picked.attack,
    card: source.card,
    body: source.body,
    index: picked.index,
    ...(flip === true ? { flip } : {}),
  };
}

/**
 * Declaration-time branch: no candidates re-enter empty, exactly one re-enters with it, otherwise
 * park `chooseAttack` (or, for Night Joker with several bodies, `choosePokemon` first).
 */
function declareAttackCopy(
  state: GameState,
  action: AttackAction,
  copy: AttackCopy,
  attackerUid: string,
  copierName: string,
): ApplyResult {
  const sources = copySources(state, action.seat, copy);
  const pairs = sources.flatMap((source) => source.attacks.map((picked) => ({ source, picked })));
  const only = pairs.length === 1 ? pairs[0] : undefined;
  if (pairs.length === 0)
    return attack(state, action, {
      copied: { empty: true, ...(copy.flip === true ? { flip: true } : {}) },
    });
  if (only !== undefined)
    return attack(state, action, { copied: copiedOverride(only.source, only.picked, copy.flip) });
  const op: OpOf<"useAttackAs"> = {
    op: "useAttackAs",
    from: copy.from,
    ...(copy.owner === undefined ? {} : { owner: copy.owner }),
    ...(copy.flip === true ? { flip: true as const } : {}),
    index: action.index,
  };
  const single = sources.length === 1 ? sources[0] : undefined;
  if (single !== undefined) {
    return parkCopy(
      state,
      action.seat,
      attackerUid,
      single.ref === null ? op : { ...op, sourceRef: single.ref },
      chooseCopiedAttack(single, copierName),
    );
  }
  return parkCopy(state, action.seat, attackerUid, op, {
    kind: "choosePokemon",
    candidates: sources.flatMap((source) =>
      source.ref === null ? [] : [{ seat: action.seat, spot: source.ref }],
    ),
    note: `Choose 1 of your Benched ${copy.owner ?? ""}'s Pokémon. You will then choose which of its attacks to use as ${copierName}.`,
  });
}

/**
 * Resolve a copy park. Restores `turn:action`, re-validates against the live board, and re-enters
 * `attack()` with the override so every declaration gate runs again for the copier.
 */
export function resolveCopiedAttack(
  state: GameState,
  phase: Extract<Phase, { kind: "effect:choose" }>,
  op: OpOf<"useAttackAs">,
  choice: EffectChoice,
): ApplyResult {
  const seat = phase.seat;
  const resumed: GameState = { ...state, phase: { kind: "turn:action", seat } };
  const action: AttackAction = { type: "attack", seat, index: op.index };
  const copier = resumed.players[seat].active;
  const copierCard = copier === null ? undefined : topCardOf(resumed, copier);
  // `op.index` is the flat menu index, used as a printed index: no copy-family attack is ever a
  // non-printed menu row.
  const printed = copierCard === undefined ? undefined : attacksOf(copierCard)[op.index];
  const copy = printed?.effect === undefined ? null : deriveAttackCopy(printed.effect);
  if (
    copier === null ||
    printed === undefined ||
    topUid(copier) !== phase.cont.ctx.sourceUid ||
    copy === null ||
    copy.from !== op.from
  ) {
    return err(
      "PHASE_DESYNC",
      "the copying Pokémon is no longer the Active that declared this attack",
    );
  }
  const sources = copySources(resumed, seat, op);
  if (choice.kind === "pokemon") {
    const ref = choice.ref;
    const source =
      ref === undefined || ref.seat !== seat || ref.spot.spot !== "bench"
        ? undefined
        : sources.find(
            (s) =>
              s.ref?.spot === "bench" &&
              ref.spot.spot === "bench" &&
              s.ref.index === ref.spot.index,
          );
    if (source === undefined || source.ref === null) {
      return err("BAD_EFFECT_CHOICE", "that Pokémon has no attack this copy can use");
    }
    const forced = source.attacks.length === 1 ? source.attacks[0] : undefined;
    if (forced !== undefined)
      return attack(resumed, action, { copied: copiedOverride(source, forced, op.flip) });
    return parkCopy(
      resumed,
      seat,
      phase.cont.ctx.sourceUid ?? "",
      { ...op, sourceRef: source.ref },
      chooseCopiedAttack(source, printed.name),
    );
  }
  if (choice.kind === "attack") {
    const want = op.sourceRef;
    const source = sources.find((s) =>
      want === undefined
        ? s.ref === null
        : s.ref?.spot === "bench" && want.spot === "bench" && s.ref.index === want.index,
    );
    const picked = source?.attacks.find((a) => a.index === choice.index);
    if (source === undefined || picked === undefined) {
      return err("BAD_EFFECT_CHOICE", `${String(choice.index)} is not an attack this copy can use`);
    }
    return attack(resumed, action, { copied: copiedOverride(source, picked, op.flip) });
  }
  return err("BAD_EFFECT_CHOICE", "expected an attack or Pokémon choice");
}

// Skill Thief: "If you have no cards in your hand, choose an attack from 1 of your opponent's
// Pokémon in play and use it as this attack." Candidates from the opponent's Active and Bench are
// flattened into one `chooseAttack` list. The hand is read at declaration; a non-empty hand gives
// the empty override.

/** The (top uid, printed index, label) pairs Skill Thief may copy for `seat`, Active first. */
function inPlayCopyPairs(state: GameState, seat: Seat): FoundPair[] {
  const side = state.players[otherSeat(seat)];
  const bodies = inPlayOf(side);
  const seen = new Set<string>();
  return bodies.flatMap((body) => {
    const uid = topUid(body);
    const card = topCardOf(state, body);
    if (uid === undefined || card === undefined) return [];
    return usableCopies(state, seat, body, card).flatMap(({ index, attack }) => {
      const key = `${card.name}#${String(index)}#${JSON.stringify(attack)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ uid, attackIndex: index, name: `${attack.name} (${card.name})` }];
    });
  });
}

/** Re-enter `attack()` with one in-play pair, re-validated on the live board: the uid is still the top card of
    one of the opponent's in-play bodies and its attack is still eligible. */
function reenterInPlay(state: GameState, action: AttackAction, pair: FoundPair): ApplyResult {
  const side = state.players[otherSeat(action.seat)];
  const bodies = inPlayOf(side);
  const body = bodies.find((b) => topUid(b) === pair.uid);
  const card = body === undefined ? undefined : topCardOf(state, body);
  const picked =
    body === undefined || card === undefined
      ? undefined
      : usableCopies(state, action.seat, body, card).find((c) => c.index === pair.attackIndex);
  if (body === undefined || card === undefined || picked === undefined) {
    return err("PHASE_DESYNC", "that attack is no longer one this copy can use");
  }
  return attack(state, action, {
    copied: { attack: picked.attack, card, body, index: picked.index },
  });
}

/**
 * Skill Thief at declaration: a card in hand or no pairs gives empty; one pair re-enters with it;
 * more parks `chooseAttack`.
 */
function declareInPlayAttackCopy(
  state: GameState,
  action: AttackAction,
  attackerUid: string,
  copierName: string,
): ApplyResult {
  if (state.players[action.seat].hand.length > 0)
    return attack(state, action, { copied: { empty: true } });
  const pairs = inPlayCopyPairs(state, action.seat);
  const only = pairs.length === 1 ? pairs[0] : undefined;
  if (pairs.length === 0) return attack(state, action, { copied: { empty: true } });
  if (only !== undefined) return reenterInPlay(state, action, only);
  return settleProgram(
    {
      kind: "parked",
      state,
      prompt: chooseFoundAttack(pairs, copierName),
      cont: {
        pendingOp: { op: "useInPlayAttackAs", index: action.index, candidates: pairs },
        rest: [],
        ctx: { seat: action.seat, sourceUid: attackerUid },
      },
    },
    action.seat,
    {},
    [],
  );
}

/**
 * Resolve a Skill Thief park: restore `turn:action`, re-validate the copier, and re-enter
 * `attack()` with the chosen pair.
 */
export function resolveInPlayCopiedAttack(
  state: GameState,
  phase: Extract<Phase, { kind: "effect:choose" }>,
  op: OpOf<"useInPlayAttackAs">,
  choice: EffectChoice,
): ApplyResult {
  const seat = phase.seat;
  if (choice.kind !== "attack") return err("BAD_EFFECT_CHOICE", "expected an attack choice");
  const pair = op.candidates[choice.index];
  if (pair === undefined)
    return err("BAD_EFFECT_CHOICE", "that is not an attack this copy can use");
  const reopened: GameState = { ...state, phase: { kind: "turn:action", seat } };
  const copier = reopened.players[seat].active;
  const copierCard = copier === null ? undefined : topCardOf(reopened, copier);
  const printed = copierCard === undefined ? undefined : attacksOf(copierCard)[op.index];
  const copy = printed?.effect === undefined ? null : deriveAttackCopy(printed.effect);
  if (
    copier === null ||
    topUid(copier) !== phase.cont.ctx.sourceUid ||
    copy === null ||
    !isInPlayAttackCopy(copy)
  ) {
    return err(
      "PHASE_DESYNC",
      "the copying Pokémon is no longer the Active that declared this attack",
    );
  }
  return reenterInPlay(reopened, { type: "attack", seat, index: op.index }, pair);
}

// Copies made mid-attack (Haughty Order, Seek Inspiration). The source is out of play, so its
// attack gate is read through a phantom one-card body. Haughty Order shuffles at the park, before
// the copied attack resolves.

/** One eligible (card, attack) pair found by a resolve-time copy, as the op stores it. */
type FoundPair = { uid: string; attackIndex: number; name: string };

/**
 * The eligible pairs among `uids` for the copier's seat, collapsed on card name, attack index and
 * printed attack, so identical copies or reprints offer one row. `ruleBoxFree` is Seek
 * Inspiration's "doesn't have a Rule Box".
 */
function foundPairs(
  state: GameState,
  seat: Seat,
  uids: readonly string[],
  ruleBoxFree: boolean,
): FoundPair[] {
  const seen = new Set<string>();
  return uids.flatMap((uid) => {
    const card = cardOfUid(state, uid);
    if (card === undefined || card.category !== "Pokemon") return [];
    if (ruleBoxFree && hasRuleBox(card)) return [];
    return usableCopies(state, seat, makeInPlay(uid, state.turn), card).flatMap(
      ({ index, attack }) => {
        const key = `${card.name}#${String(index)}#${JSON.stringify(attack)}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ uid, attackIndex: index, name: `${attack.name} (${card.name})` }];
      },
    );
  });
}

/** The answer's `index` indexes `candidates`, not one card's attacks. */
function chooseFoundAttack(pairs: readonly FoundPair[], copierName: string): EffectPrompt {
  return {
    kind: "chooseAttack",
    candidates: pairs.map((pair, index) => ({ index, name: pair.name })),
    note: `Choose an attack to use as ${copierName}.`,
  };
}

/** The MID-ATTACK PARK: attack.ts's in-attack park shape (`settleProgram` with `resumeTail` and
    the `attackEpilogue` QUEUED behind it), so a reader with no route for the op — a 0.457
    ROLLBACK, or Haughty Order's decline — drains the epilogue and ends the attack having copied
    nothing. The first half's events ride the park's result. */
function parkFoundCopy(
  state: GameState,
  seat: Seat,
  attackerUid: string,
  copierName: string,
  op: OpOf<"useFoundAttackAs">,
  prompt: EffectPrompt,
  events: GameEvent[],
): ApplyResult {
  const epilogue: PendingStage = {
    kind: "attackEpilogue",
    seat,
    uid: attackerUid,
    attack: copierName,
  };
  return settleProgram(
    {
      kind: "parked",
      state: { ...state, pending: [...state.pending, epilogue] },
      prompt,
      cont: {
        pendingOp: op,
        rest: [],
        ctx: { seat, sourceUid: attackerUid, invokedBy: "attack", dealt: 0 },
      },
    },
    seat,
    { resumeTail: true },
    events,
  );
}

/**
 * First half of a mid-attack copy. Haughty Order reveals the top 10, collects pairs, shuffles, then
 * ends or parks the "You may" confirm. Seek Inspiration mills 1, then ends, re-enters inline with
 * one pair, or parks `chooseAttack`.
 */
function copyAtResolution(
  state: GameState,
  action: AttackAction,
  copy: ResolvedAttackCopy,
  attackerUid: string,
  copierName: string,
  events: GameEvent[],
): ApplyResult {
  const seat = action.seat;
  if (copy.from === "opponentDeckTop") {
    const owner = otherSeat(seat);
    const side = state.players[owner];
    const shown = side.deck.slice(0, copy.count);
    events.push({
      type: "DECK_TOP_REVEALED",
      seat: owner,
      dest: "deck",
      uids: [...shown],
      reveal: true,
      actor: seat,
    });
    const pairs = foundPairs(state, seat, shown, false);
    const [deck, rngState] = shuffle(side.deck, state.rngState);
    events.push({ type: "SHUFFLE", seat: owner });
    const shuffled: GameState = { ...withSide(state, owner, { ...side, deck }), rngState };
    if (pairs.length === 0) return finishAttack(shuffled, seat, attackerUid, copierName, events);
    return parkFoundCopy(
      shuffled,
      seat,
      attackerUid,
      copierName,
      { op: "useFoundAttackAs", from: copy.from, index: action.index, candidates: pairs },
      {
        kind: "confirm",
        note: `Use an attack from a Pokémon revealed from your opponent's deck as ${copierName}?`,
        labels: { yes: "Choose an attack", no: "Don't" },
      },
      events,
    );
  }
  const side = state.players[seat];
  const top = side.deck[0];
  if (top === undefined) return finishAttack(state, seat, attackerUid, copierName, events);
  events.push({ type: "DECK_TOP_DISCARDED", seat, actor: seat, uids: [top] });
  const milled = withSide(state, seat, {
    ...side,
    deck: side.deck.slice(1),
    discard: [...side.discard, top],
  });
  const pairs = foundPairs(milled, seat, [top], true);
  const only = pairs.length === 1 ? pairs[0] : undefined;
  if (pairs.length === 0) return finishAttack(milled, seat, attackerUid, copierName, events);
  if (only !== undefined) {
    const resumed = reenterFound(milled, action, only);
    return resumed.ok ? ok(resumed.state, [...events, ...resumed.events]) : resumed;
  }
  return parkFoundCopy(
    milled,
    seat,
    attackerUid,
    copierName,
    { op: "useFoundAttackAs", from: copy.from, index: action.index, candidates: pairs },
    chooseFoundAttack(pairs, copierName),
    events,
  );
}

/** Re-enter `attack()` RESUMED with one found pair, re-validated against the live board: the
    source card is still in the zone the copy left it in (the opponent's deck for Haughty Order,
    the controller's discard pile for Seek Inspiration), and the attack is still eligible
    (`usableCopies` over a fresh phantom). Every declaration gate then runs again on the COPIER. */
function reenterFound(state: GameState, action: AttackAction, pair: FoundPair): ApplyResult {
  const card = cardOfUid(state, pair.uid);
  const body = makeInPlay(pair.uid, state.turn);
  const picked =
    card === undefined
      ? undefined
      : usableCopies(state, action.seat, body, card).find((c) => c.index === pair.attackIndex);
  if (card === undefined || picked === undefined) {
    return err("PHASE_DESYNC", "the found attack is no longer one this copy can use");
  }
  return attack(state, action, {
    copied: { attack: picked.attack, card, body, index: picked.index, resumed: true },
  });
}

/**
 * Resolve a mid-attack copy park. Taking a pair strips the queued `attackEpilogue` (the re-entered
 * attack queues its own), re-validates the copier and the source zone, and re-enters `attack()`.
 */
export function resolveFoundAttack(
  state: GameState,
  phase: Extract<Phase, { kind: "effect:choose" }>,
  op: OpOf<"useFoundAttackAs">,
  choice: EffectChoice,
): ApplyResult {
  const seat = phase.seat;
  const sourceUid = phase.cont.ctx.sourceUid ?? "";
  let pair: FoundPair | undefined;
  if (op.from === "opponentDeckTop" && op.accepted !== true) {
    if (choice.kind !== "confirm" || !choice.yes) return err("BAD_EFFECT_CHOICE", "expected a yes");
    if (op.candidates.length > 1) {
      return settleProgram(
        {
          kind: "parked",
          state,
          prompt: chooseFoundAttack(op.candidates, copierNameOf(state, seat, op.index)),
          cont: { ...phase.cont, pendingOp: { ...op, accepted: true } },
        },
        seat,
        { resumeTail: true },
        [],
      );
    }
    pair = op.candidates[0];
  } else {
    if (choice.kind !== "attack") return err("BAD_EFFECT_CHOICE", "expected an attack choice");
    pair = op.candidates[choice.index];
  }
  if (pair === undefined) return err("BAD_EFFECT_CHOICE", "that is not an attack this copy found");
  const restored: GameState = {
    ...state,
    phase: { kind: "turn:action", seat },
    pending: state.pending.filter(
      (stage) => !(stage.kind === "attackEpilogue" && stage.uid === sourceUid),
    ),
  };
  const copier = restored.players[seat].active;
  const copierCard = copier === null ? undefined : topCardOf(restored, copier);
  // `op.index` is the flat menu index, used as a printed index: no copy-family attack is ever a
  // non-printed menu row.
  const printed = copierCard === undefined ? undefined : attacksOf(copierCard)[op.index];
  const copy = printed?.effect === undefined ? null : deriveAttackCopy(printed.effect);
  const zone =
    op.from === "opponentDeckTop"
      ? restored.players[otherSeat(seat)].deck
      : restored.players[seat].discard;
  if (copier === null || topUid(copier) !== sourceUid || copy === null || copy.from !== op.from) {
    return err(
      "PHASE_DESYNC",
      "the copying Pokémon is no longer the Active that declared this attack",
    );
  }
  if (!zone.includes(pair.uid))
    return err("PHASE_DESYNC", "the found card has left the zone the copy found it in");
  return reenterFound(restored, { type: "attack", seat, index: op.index }, pair);
}

/** Backtrack Badge re-entry: `keep` the offered faces, or flip `again`. */
type CoinRedo = { kind: "keep"; faces: CoinFace[] } | { kind: "again" };

/** Park Backtrack Badge's offer after the printed coin flip. */
function parkCoinRedo(
  state: GameState,
  seat: Seat,
  attackerUid: string,
  attackName: string,
  op: OpOf<"reflipAttackCoins">,
  events: GameEvent[],
): ApplyResult {
  const epilogue: PendingStage = {
    kind: "attackEpilogue",
    seat,
    uid: attackerUid,
    attack: attackName,
  };
  return settleProgram(
    {
      kind: "parked",
      state: { ...state, pending: [...state.pending, epilogue] },
      prompt: coinRedoPrompt(state, op.toolUid, op.faces),
      cont: {
        pendingOp: op,
        rest: [],
        ctx: { seat, sourceUid: attackerUid, invokedBy: "attack", dealt: 0 },
      },
    },
    seat,
    { resumeTail: true },
    events,
  );
}

/**
 * Answer Backtrack Badge's offer: strip the queued epilogue, restore `turn:action`, check the
 * Active still declared, spend the Badge on yes, and re-enter `attack()` keeping or reflipping the
 * faces.
 */
export function resolveCoinRedo(
  state: GameState,
  phase: Extract<Phase, { kind: "effect:choose" }>,
  op: OpOf<"reflipAttackCoins">,
  choice: EffectChoice,
): ApplyResult {
  if (choice.kind !== "confirm") return err("BAD_EFFECT_CHOICE", "expected a yes or a no");
  const seat = phase.seat;
  const sourceUid = phase.cont.ctx.sourceUid ?? "";
  const restored: GameState = {
    ...state,
    phase: { kind: "turn:action", seat },
    pending: state.pending.filter(
      (stage) => !(stage.kind === "attackEpilogue" && stage.uid === sourceUid),
    ),
  };
  const attacker = restored.players[seat].active;
  if (attacker === null || topUid(attacker) !== sourceUid) {
    return err(
      "PHASE_DESYNC",
      "the attacking Pokémon is no longer the Active that declared this attack",
    );
  }
  const events: GameEvent[] = [];
  const spent = choice.yes
    ? spendCoinRedo(restored, seat, op.toolUid, op.faces.length, events)
    : restored;
  const resumed = attack(
    spent,
    { type: "attack", seat, index: op.index },
    {
      copied: op.copied,
      coinRedo: choice.yes ? { kind: "again" } : { kind: "keep", faces: op.faces },
    },
  );
  return resumed.ok ? ok(resumed.state, [...events, ...resumed.events]) : resumed;
}

/** The copier's printed attack name at `index`, used as the re-parked prompt's caption. */
function copierNameOf(state: GameState, seat: Seat, index: number): string {
  const active = state.players[seat].active;
  const card = active === null ? undefined : topCardOf(state, active);
  return (card === undefined ? undefined : attacksOf(card)[index]?.name) ?? "this attack";
}

/** The interrupt phases that park the tail on a ko:* decision (§8.1). */
type KoPhase = Extract<Phase, { kind: "ko:takePrizes" | "ko:promote" }>;

/** The gate the two ko:* decision handlers share — the interrupt twin of
    turnGate: right interrupt phase, right seat. Hands back the narrowed
    phase (via the intersection TS cannot derive from a generic discriminant
    check itself) so takePrizes keeps `phase.count`. */
function interruptGate<K extends KoPhase["kind"]>(
  state: GameState,
  action: { type: GameAction["type"]; seat: Seat },
  kind: K,
): { phase: KoPhase & { kind: K }; reject?: undefined } | { phase?: undefined; reject: Rejection } {
  const phase = state.phase;
  if (phase.kind !== kind) {
    return { reject: err("BAD_PHASE", `${action.type} is not legal during ${phase.kind}`) };
  }
  const narrowed = phase as KoPhase & { kind: K };
  if (narrowed.seat !== action.seat) {
    return { reject: err("WRONG_SEAT", `only ${narrowed.seat} resolves this Knock Out (§8.1)`) };
  }
  return { phase: narrowed };
}

// Parking DUAL-ENCODES a decision — the ko:* phase carries a copy of the
// head pending stage's fields — and resolving trusts the QUEUE, so both
// handlers cross-check that the head still agrees with the phase before
// popping it. A mismatch is unreachable through the engine's own transitions
// (advance always writes both together): it means a crafted or corrupted
// snapshot, and resolving it would act out the WRONG stage (e.g. take
// phase.count prizes while popping a different-count stage). M3 may collapse
// the two encodings into one.

/**
 * The ko:takePrizes decision (§8.1): the KOing player picks which prize slots to take. Indices
 * address the whole row; face-up prizes are still pickable.
 */
export function takePrizes(state: GameState, action: TakePrizesAction): ApplyResult {
  const gate = interruptGate(state, action, "ko:takePrizes");
  if (gate.reject) return gate.reject;
  const phase = gate.phase;
  const head = state.pending[0];
  if (head?.kind !== "takePrizes" || head.seat !== phase.seat || head.count !== phase.count) {
    return err("PHASE_DESYNC", "the ko:takePrizes phase disagrees with the pending queue head");
  }
  const indices = action.prizeIndices;
  // Wire checks: the array itself, its length (bounding the scans below),
  // then each element — integer, in range, no repeats.
  if (!Array.isArray(indices) || indices.length !== phase.count) {
    return err("BAD_PRIZE_COUNT", `must pick exactly ${phase.count} prize(s)`);
  }
  const prizes = state.players[action.seat].prizes;
  const seen = new Set<number>();
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= prizes.length) {
      return err("BAD_PRIZE_INDEX", `no prize at index ${String(index)}`);
    }
    if (seen.has(index)) {
      return err("BAD_PRIZE_INDEX", `prize index ${index} picked twice`);
    }
    seen.add(index);
  }
  // Resolve through the shared flow.ts helper: its win check runs before the
  // tail resumes — taking the last prize ends the game before any promotion
  // is prompted (§14.1).
  return resolvePrizesAndResume(state, action.seat, indices, []);
}

/** The ko:promote decision (§8.1): the KO'd player picks the benched
    Pokémon that takes the empty Active spot. */
export function promote(state: GameState, action: PromoteAction): ApplyResult {
  const gate = interruptGate(state, action, "ko:promote");
  if (gate.reject) return gate.reject;
  const head = state.pending[0];
  if (head?.kind !== "promote" || head.seat !== action.seat) {
    return err("PHASE_DESYNC", "the ko:promote phase disagrees with the pending queue head");
  }
  // An occupied Active spot means no promotion is owed — the guard mirrors
  // `advance`'s (flow.ts), which SKIPS the stage on its auto-resolve path;
  // here the action names a decision that does not exist, so it is rejected
  // (resolving anyway would overwrite the occupant's whole stack, with no
  // event). Unreachable in M2: nothing refills the spot while parked.
  if (state.players[action.seat].active !== null) {
    return err("ACTIVE_ALREADY_PLACED", "the Active spot is already occupied");
  }
  const index = action.benchIndex;
  // Same wire trap as retreat's promote index (see turn.ts).
  if (!isBenchIndex(index) || state.players[action.seat].bench[index] === undefined) {
    return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(index)}`);
  }
  return resolvePromotionAndResume(state, action.seat, index, []);
}
