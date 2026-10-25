import {
  ANY_ENERGY,
  attacksOf,
  cardOfUid,
  constrainedEnergyTypes,
  costMet,
  energyProvidesOf,
  hasPrintedAbility,
  hasRuleBox,
  hpOf,
  isBasicPokemon,
  isEvolutionPokemon,
  isExOrV,
  isFossilTop,
  isSpecialEnergy,
  isTeraPokemon,
  isStage2Pokemon,
  matchesFilter,
  pokemonSuffixOf,
  retreatCostOf,
  topCardOf,
  topUid,
} from "./cards";
import type { DamageModifier, PokemonSuffix, PreventedAttackerClass } from "./cards";
import { type Banner, bannerOf, bannerOfId } from "./banners";
import type { Attack, BasicEnergyType, Card } from "@colorless/schema";
import type {
  AttackerClass,
  BoardCondition,
  CardFilter,
  EffectOp,
  HandPlayClass,
  PokemonPlayAct,
  PokemonType,
} from "./effectTypes";
import { COPY_FAMILY_MARKER } from "./deriver/vocabulary";
import { timingGateFromAttackText } from "./effects";
import type { StatusName } from "./events";
// No cycle: phaseView.ts imports only types from here.
import { phaseViewOf } from "./phaseView";
import type {
  AttackTimingGate,
  EnergyProgram,
  KoPrizeReduction,
  MaxHpScale,
  PassiveEffects,
  StadiumEffects,
} from "./programTypes";
import { programFor, registryCardIds } from "./registry";
import type {
  AttackBlock,
  GameState,
  HandAttachMark,
  InPlayPokemon,
  LockedAttack,
  PlayerSide,
  Seat,
  SpecialConditions,
} from "./types";
import {
  abilityUsedThisTurn,
  coinRedoKey,
  damageCountersOn,
  inPlayOf,
  BENCH_MAX,
  SEATS,
  noConditions,
  otherSeat,
  stampedActBarFor,
  stampedBarFor,
  takenPrizes,
} from "./types";

// The continuous-modifier pipeline: the one place the always-on effects of the Stadium (§7.3) and
// of attached Tools and printed passives (§7.4/§9) are aggregated and applied to a rule read, so
// the engine and the web HUD ask the same questions. Every function is pure and total: a missing
// card or program contributes nothing.

/**
 * The in-play Stadium's continuous effects, or undefined when no Stadium is out or it has no
 * registry row.
 *
 * §8.1: the floor `effectiveMaxHp` clamps to, so HP is never non-positive. 10 rather than 1 because
 * HP is dealt in tens.
 */
const MIN_EFFECTIVE_MAX_HP = 10;

export function stadiumEffectsOf(state: GameState): StadiumEffects | undefined {
  if (state.stadium === null) return undefined;
  const id = state.cardIdByUid[state.stadium.uid];
  return id === undefined ? undefined : programFor(id)?.stadium;
}

/**
 * §7.3: the live Bench limit over card ids, so the web's redacted board asks the same question: the
 * Stadium's `benchLimitWithTera` when `teraInPlay`, else `BENCH_MAX`.
 */
function benchLimitFrom(stadiumCardId: string | undefined, teraInPlay: boolean): number {
  const widened =
    stadiumCardId === undefined
      ? undefined
      : programFor(stadiumCardId)?.stadium?.benchLimitWithTera;
  return widened !== undefined && teraInPlay ? widened : BENCH_MAX;
}

/**
 * §7.3: how many Benched Pokémon `seat` may have right now: 8 if Area Zero Underdepths is the
 * Stadium and `seat` has a Tera Pokémon in play, otherwise `BENCH_MAX`. Per seat. `BENCH_CEILING`
 * bounds only what a ref may address.
 */
export function benchLimitOf(state: GameState, seat: Seat): number {
  const stadiumCardId = state.stadium === null ? undefined : state.cardIdByUid[state.stadium.uid];
  const side = state.players[seat];
  const bodies = inPlayOf(side);
  return benchLimitFrom(
    stadiumCardId,
    bodies.some((body) => isTeraPokemon(topCardOf(state, body))),
  );
}

/**
 * `benchLimitOf` over card ids, for a board with no `GameState` (the web's
 * `projectionFromRedacted`).
 */
export function benchLimitForIds(
  stadiumCardId: string | undefined,
  inPlayCardIds: readonly string[],
): number {
  return benchLimitFrom(
    stadiumCardId,
    inPlayCardIds.some((id) => bannerOfId(id) === "Tera"),
  );
}

/**
 * §7.4: how many Tools `body` may have attached: 1, or a live `toolCapForName` cap when the body's
 * top card name contains its fragment (Rotom ex "Multi Adapter"; the holder counts itself). Holders
 * are the seat's own in-play Pokémon with a live Ability; several holders do not stack.
 */
export function toolCapOf(state: GameState, seat: Seat, body: InPlayPokemon): number {
  const name = topCardOf(state, body)?.name ?? "";
  const side = state.players[seat];
  const holders = inPlayOf(side);
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    const raise = top === undefined ? undefined : programFor(top.id)?.passive?.toolCapForName;
    if (raise === undefined || !name.includes(raise.nameContains)) continue;
    const uid = topUid(holder);
    if (uid !== undefined && disabledAbilityUids(state).has(uid)) continue; // §9
    return raise.cap;
  }
  return 1;
}

/**
 * The name fragments a `toolCapForName` raise names, read off the whole registry: the trim's "those
 * Pokémon" outlives the Ability that named them.
 */
let toolCapNamesMemo: readonly string[] | undefined;
function toolCapNames(): readonly string[] {
  toolCapNamesMemo ??= [
    ...new Set(
      registryCardIds().flatMap((id) => {
        const raise = programFor(id)?.passive?.toolCapForName;
        return raise === undefined ? [] : [raise.nameContains];
      }),
    ),
  ];
  return toolCapNamesMemo;
}

/**
 * Does `body` owe Multi Adapter's trim: named by a `toolCapNames` fragment and carrying more Tools
 * than `toolCapOf` allows?
 */
export function owesToolTrim(state: GameState, seat: Seat, body: InPlayPokemon): boolean {
  if (body.tools.length <= 1) return false;
  const name = topCardOf(state, body)?.name ?? "";
  return (
    toolCapNames().some((part) => name.includes(part)) &&
    body.tools.length > toolCapOf(state, seat, body)
  );
}

/**
 * §6.1: does this Energy card print Boomerang Energy's "attach this card from your discard pile to
 * that Pokémon after attacking"?
 */
export function returnsAfterAttackDiscard(
  state: GameState,
  uid: string,
  holder: InPlayPokemon,
): boolean {
  const id = state.cardIdByUid[uid];
  const energy = id === undefined ? undefined : programFor(id)?.energy;
  // `"hand"` (Nitro Fire) is recorded the same way; its {R} is the holder gate.
  return energy?.returnAfterAttackDiscard !== undefined && energyRulesApply(state, holder, energy);
}

/**
 * Do the attached Energy's printed rules apply on `holder`? True unless the program names a
 * `holderType` the holder's in-play types lack ("The {G} Pokémon this card is attached to…").
 */
export function energyRulesApply(
  state: GameState,
  holder: InPlayPokemon,
  energy: EnergyProgram | undefined,
): boolean {
  const type = energy?.holderType;
  return type === undefined || effectiveTypesOf(state, holder).includes(type);
}

/**
 * A card's Supporter effect as Mr. Mime "Look-Alike Show" uses it: the registry `trainer` ops and
 * the printed play condition. `undefined` for a card with no `trainer` key; an empty program is
 * still a program. `supporterKoPrizeBonus` and `trainerFirstTurnExempt` are deliberately excluded:
 * a copy is the effect, and both are read off a played card.
 */
export function supporterEffectOf(
  cardId: string,
): { ops: readonly EffectOp[]; playableIf: BoardCondition | undefined } | undefined {
  const program = programFor(cardId);
  if (program?.trainer === undefined) return undefined;
  return { ops: program.trainer, playableIf: program.trainerPlayableIf };
}

/**
 * §7.4: the Tools on `pokemon` whose effects are live: every attached Tool, or none while the
 * Stadium prints `toolsHaveNoEffect` (Jamming Tower). Every effect walk over `pokemon.tools` goes
 * through here; count reads use the raw list, since a Tool under Jamming Tower is still attached
 * and still fills the slot.
 */
export function toolsInEffect(state: GameState, pokemon: InPlayPokemon): readonly string[] {
  return stadiumEffectsOf(state)?.toolsHaveNoEffect === true ? [] : pokemon.tools;
}

/**
 * The uid of a Backtrack Badge that may re-flip `body`'s attack coins now, or `null`: an in-effect
 * Tool with `reflipAttackCoins`, on a body whose in-play types include {C}, whose key is unused
 * this turn. Callers pass the attacking body, only after its own coins.
 */
export function coinRedoToolOf(state: GameState, body: InPlayPokemon): string | null {
  const types = inPlayCardOf(state, body)?.types ?? [];
  for (const uid of toolsInEffect(state, body)) {
    const id = state.cardIdByUid[uid];
    const redo = id === undefined ? undefined : programFor(id)?.passive?.reflipAttackCoins;
    if (redo === undefined || !types.includes(redo.holderType)) continue;
    if (abilityUsedThisTurn(state, coinRedoKey(uid, redo.name))) continue;
    return uid;
  }
  return null;
}

/**
 * The in-effect Tools on `holder` whose sentence is keyed to an attack from the opponent's Pokémon.
 * The holder's seat must differ from `attackerSeat`, so an own-side spread reaches none; an
 * unplaceable holder answers none (the conservative direction).
 */
function opposedToolPassives(
  state: GameState,
  holder: InPlayPokemon,
  attackerSeat: Seat,
): { uid: string; passive: PassiveEffects }[] {
  const holderSeat = seatOfPokemon(state, holder);
  if (holderSeat === undefined || holderSeat === attackerSeat) return [];
  const out: { uid: string; passive: PassiveEffects }[] = [];
  for (const uid of toolsInEffect(state, holder)) {
    const id = state.cardIdByUid[uid];
    const passive = id === undefined ? undefined : programFor(id)?.passive;
    if (passive !== undefined) out.push({ uid, passive });
  }
  return out;
}

/**
 * The consumable answer when not asked: nothing to add, nothing to discard (a suppressed target, or
 * a hit stopped before damage).
 */
export const NO_CONSUMABLE: { amount: number; toolUids: readonly string[] } = {
  amount: 0,
  toolUids: [],
};

/**
 * §8.5: the type Berries' post-W/R reduction for `holder` against this attacker ("…takes 60 less
 * damage… and discard this card"), and the Tools that pay it. The attacker must be on the opposing
 * seat and its in-play types must include the Berry's type. Not folded by `passivesOf`, which
 * cannot say which Tool paid; the caller discards `toolUids` when the hit is not prevented. No
 * Active clause, so it applies on the Bench too.
 */
export function berryReductionOf(
  state: GameState,
  holder: InPlayPokemon,
  attacker: Card | undefined,
  attackerSeat: Seat,
): { amount: number; toolUids: readonly string[] } {
  let amount = 0;
  const toolUids: string[] = [];
  for (const { uid, passive } of opposedToolPassives(state, holder, attackerSeat)) {
    const berry = passive.damageReductionAfterWRFromTypeThenDiscard;
    if (berry === undefined || !(attacker?.types ?? []).includes(berry.type)) continue;
    amount += berry.amount;
    toolUids.push(uid);
  }
  return { amount, toolUids };
}

/**
 * §8.5: the attacker-gated post-W/R reduction ("…takes N less damage from attacks from your
 * opponent's <class> Pokémon"): the sum of entries whose `attacker` filter the attacker's in-play
 * card matches. An own-side hit or unresolvable attacker gets 0.
 */
export function attackerGatedReductionOf(
  state: GameState,
  holder: InPlayPokemon,
  reductions: readonly { amount: number; attacker: CardFilter }[],
  attacker: Card | undefined,
  attackerSeat: Seat,
): number {
  if (reductions.length === 0 || attacker === undefined) return 0;
  const holderSeat = seatOfPokemon(state, holder);
  if (holderSeat === undefined || holderSeat === attackerSeat) return 0;
  let amount = 0;
  for (const reduction of reductions)
    if (matchesFilter(attacker, reduction.attacker)) amount += reduction.amount;
  return amount;
}

/**
 * §8.1: the Survival Brace on `holder` that would answer an attack from `attackerSeat`, or
 * `undefined`. Only the source half; the full-HP and lethality checks are `koSurvivalClamp`'s. The
 * first in-effect Brace answers.
 */
export function survivalBraceOf(
  state: GameState,
  holder: InPlayPokemon,
  attackerSeat: Seat,
): string | undefined {
  return opposedToolPassives(state, holder, attackerSeat).find(
    ({ passive }) => passive.survivesKoAtFullHpFromOpponentThenDiscard === true,
  )?.uid;
}

/**
 * §9: the Deluxe Bomb recoil on `holder` (12 counters on the Attacking Pokémon, then discard), and
 * the Tools that pay it. Asked only where the attacker recoil is, and both sites damage an Active,
 * so "in the Active Spot" is satisfied by placement.
 */
export function deluxeBombOf(
  state: GameState,
  holder: InPlayPokemon,
  attackerSeat: Seat,
  dealt: number,
): { amount: number; toolUids: readonly string[] } {
  let amount = 0;
  const toolUids: string[] = [];
  for (const { uid, passive } of opposedToolPassives(state, holder, attackerSeat)) {
    const bomb =
      passive.damageAttackerActiveThenDiscard ??
      gatedBombOf(state, holder, attackerSeat, dealt, passive);
    if (bomb === undefined) continue;
    amount += bomb;
    toolUids.push(uid);
  }
  return { amount, toolUids };
}

/**
 * §9: Tremendous Bomb's three gates: this hit's `dealt` reaches `minDamage`, the attacking Active
 * matches `attacker`, and the holder does not match `holderNot`. Its counters, or `undefined`.
 */
function gatedBombOf(
  state: GameState,
  holder: InPlayPokemon,
  attackerSeat: Seat,
  dealt: number,
  passive: PassiveEffects,
): number | undefined {
  const gated = passive.damageAttackerActiveThenDiscardIf;
  if (gated === undefined || dealt < gated.minDamage) return undefined;
  const attacking = state.players[attackerSeat].active;
  const attackerCard = attacking === null ? undefined : inPlayCardOf(state, attacking);
  const holderCard = inPlayCardOf(state, holder);
  if (attackerCard === undefined || !matchesFilter(attackerCard, gated.attacker)) return undefined;
  return holderCard === undefined || matchesFilter(holderCard, gated.holderNot)
    ? undefined
    : gated.amount;
}

/**
 * §12: does the Stadium shield `pokemon` from every Special Condition? Festival Grounds: "Each
 * Pokémon that has any Energy attached… recovers from all Special Conditions and can't be affected
 * by any Special Conditions." No seat and no §9 gate (a Stadium).
 */
export function stadiumShieldsStatus(state: GameState, pokemon: InPlayPokemon): boolean {
  return (
    stadiumEffectsOf(state)?.statusShieldIfEnergyAttached === true && pokemon.energy.length > 0
  );
}

/**
 * §10: does the Stadium let `target` evolve into `evolution` although it came into play this turn?
 * Forest of Vitality: the body's in-play types and the evolution's printed types must both include
 * the Stadium's type. §4's first-turn ban is not lifted. No seat and no §9 gate.
 */
export function stadiumLicensesSameTurnEvolve(
  state: GameState,
  target: InPlayPokemon,
  evolution: Card,
): boolean {
  const type = stadiumEffectsOf(state)?.sameTurnEvolution?.type;
  return (
    type !== undefined &&
    effectiveTypesOf(state, target).includes(type) &&
    (evolution.types ?? []).includes(type)
  );
}

/**
 * §9: the top uids of every in-play Pokémon whose Abilities are suppressed by an Ability-lock aura.
 * Auras are collected ungated off each source's printed passive, tagged with their holder, then
 * settled by a stratified pass: an aura is on once every aura reaching its holder is off, off once
 * an on aura reaches its holder, and mutual source cycles are kept both on. Only on auras mark
 * targets. A Stadium lock has no holder and is always on.
 */
export function disabledAbilityUids(state: GameState): Set<string> {
  const disabled = new Set<string>();
  // Collect the live auras first (ungated), each tagged with its source's seat and its holder, so
  // the pass below can ask whether another aura reaches it. A Stadium's aura has no holder: no
  // Ability can silence a Stadium.
  const auras: {
    aura: NonNullable<PassiveEffects["disableAbilities"]>;
    sourceSeat: Seat;
    holder: { body: InPlayPokemon; top: Card; isActive: boolean } | null;
  }[] = [];
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = inPlayOf(side);
    for (const holder of holders) {
      const top = topCardOf(state, holder);
      if (top === undefined) continue;
      const aura = programFor(top.id)?.passive?.disableAbilities;
      if (aura === undefined) continue;
      if (aura.requiresActive === true && holder !== side.active) continue;
      // Gastrodon's "As long as this Pokémon is on your Bench".
      if (aura.sourceOnBench === true && holder === side.active) continue;
      auras.push({
        aura,
        sourceSeat: seat,
        holder: { body: holder, top, isActive: holder === side.active },
      });
    }
  }
  // The Stadium's lock (Team Rocket's Watchtower: "{C} Pokémon in play… have no Abilities"),
  // collected before the no-aura return so a board whose only lock is the Stadium is not skipped.
  const stadiumAura = stadiumEffectsOf(state)?.disableAbilities;
  if (stadiumAura !== undefined && state.stadium !== null) {
    auras.push({ aura: stadiumAura, sourceSeat: state.stadium.owner, holder: null });
  }
  if (auras.length === 0) return disabled;
  // Run only for two or more auras: a lone aura is always on.
  const on: readonly boolean[] =
    auras.length < 2
      ? auras.map(() => true)
      : resolveSuppressionGraph(
          // `reachedBy[i]` — the auras whose predicate reaches aura i's HOLDER. A Pokémon aura's
          // `sourceSeat` IS its holder's seat.
          auras.map(({ holder, sourceSeat: holderSeat }) =>
            holder === null
              ? []
              : auras.flatMap(({ aura, sourceSeat }, j) =>
                  auraSuppresses(
                    aura,
                    sourceSeat,
                    holderSeat,
                    holder.body,
                    holder.top,
                    holder.isActive,
                  )
                    ? [j]
                    : [],
                ),
          ),
        );
  // Evaluate each aura's targets against the auras left on.
  for (const targetSeat of SEATS) {
    const side = state.players[targetSeat];
    const targets = inPlayOf(side);
    for (const target of targets) {
      const top = topCardOf(state, target);
      const uid = topUid(target);
      if (top === undefined || uid === undefined) continue;
      // The target's zone, for `targetZone`.
      const isActive = target === side.active;
      if (
        auras.some(
          ({ aura, sourceSeat }, i) =>
            on[i] === true && auraSuppresses(aura, sourceSeat, targetSeat, target, top, isActive),
        )
      )
        disabled.add(uid);
    }
  }
  return disabled;
}

/**
 * Which Ability locks stay on when locks can silence each other's holders. `reachedBy[i]` lists
 * the locks that reach lock i's holder; the result says, per lock, whether it is on.
 *
 * Stratified: a lock is on once every lock reaching it is off (vacuously when nothing reaches it),
 * and off once an on lock reaches it (one-way). When grounding stalls, every source cycle — a
 * strongly connected group of undecided locks that no outside undecided lock reaches — is switched
 * on, and grounding resumes. Each round decides at least one cycle, so it terminates with every
 * lock decided.
 */
export function resolveSuppressionGraph(reachedBy: readonly (readonly number[])[]): boolean[] {
  const on: (boolean | undefined)[] = reachedBy.map(() => undefined);
  for (;;) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [i, by] of reachedBy.entries()) {
        if (on[i] !== undefined) continue;
        if (by.some((j) => on[j] === true)) {
          on[i] = false;
          changed = true;
        } else if (by.every((j) => on[j] === false)) {
          on[i] = true;
          changed = true;
        }
      }
    }
    // `upstream[i]` — the undecided locks that reach lock i, directly or through other undecided
    // locks (empty for a decided lock).
    const upstream = reachedBy.map((by, i) => {
      const seen = new Set<number>();
      if (on[i] !== undefined) return seen;
      const stack = by.filter((j) => on[j] === undefined);
      for (let j = stack.pop(); j !== undefined; j = stack.pop()) {
        if (seen.has(j)) continue;
        seen.add(j);
        for (const k of reachedBy[j] ?? []) if (on[k] === undefined) stack.push(k);
      }
      return seen;
    });
    // A source cycle member reaches itself, and reaches back every undecided lock reaching it.
    const sources = upstream.flatMap((up, i) =>
      up.has(i) && [...up].every((k) => upstream[k]?.has(i) === true) ? [i] : [],
    );
    if (sources.length === 0) break;
    for (const i of sources) on[i] = true;
  }
  // Every lock is decided by now; an undecided one would read on.
  return on.map((value) => value !== false);
}

/** Does `aura` (emitted by `sourceSeat`) suppress the Abilities of the in-play
    Pokémon `target` (top card `top`, on `targetSeat`)? Each field is an
    independent narrowing predicate; a target passes only when every stated clause
    holds and no exemption applies. */
function auraSuppresses(
  aura: NonNullable<PassiveEffects["disableAbilities"]>,
  sourceSeat: Seat,
  targetSeat: Seat,
  target: InPlayPokemon,
  top: Card,
  /** Is `target` its side's Active Pokémon (else Benched)? */
  isActive: boolean,
): boolean {
  if (aura.side === "opponent" && targetSeat === sourceSeat) return false;
  if (aura.stage === "Basic" && !isBasicPokemon(top)) return false;
  if (aura.stage === "Stage2" && !isStage2Pokemon(top)) return false;
  if (aura.targetZone === "active" && !isActive) return false;
  if (aura.targetZone === "bench" && isActive) return false;
  if (aura.suffix !== undefined && pokemonSuffixOf(top) !== aura.suffix) return false;
  if (aura.requiresDamage === true && target.damage <= 0) return false;
  // Watchtower's "{C} Pokémon" reads printed types on purpose: the in-play reader (`inPlayCardOf`)
  // calls `disabledAbilityUids`, so reading it here would recurse. It stays exact because no retype
  // adds or removes {C}.
  if (aura.targetType !== undefined && !(top.types ?? []).includes(aura.targetType)) return false;
  // Iron Thorns ex "Initialization": "Pokémon with a Rule Box in play… except for Future Pokémon".
  if (aura.ruleBox === true && !hasRuleBox(top)) return false;
  if (
    aura.exemptBanner !== undefined &&
    matchesFilter(top, { kind: "bannerPokemon", banner: aura.exemptBanner })
  )
    return false;
  // Damp: only a body with an Ability that Knocks Out the Pokémon using it.
  if (aura.selfKnockOutAbility === true && !hasSelfKnockOutAbility(top)) return false;
  if (aura.exemptSuffix !== undefined && pokemonSuffixOf(top) === aura.exemptSuffix) return false;
  if (
    aura.exemptAbilityNamed !== undefined &&
    (top.abilities ?? []).some((a) => a.name === aura.exemptAbilityNamed)
  )
    return false;
  return true;
}

/**
 * Damp's Ability class: does `top`'s registry program hold an activated Ability that Knocks Out its
 * own user (`knockOutSelf` at its top level)?
 */
export function hasSelfKnockOutAbility(top: Card): boolean {
  return (programFor(top.id)?.abilities ?? []).some((ability) =>
    ability.program.some((op) => op.op === "knockOutSelf"),
  );
}

/**
 * §8.5: does `seat` have a live "Your Pokémon in play have no Weakness" aura (Florges "Blooming
 * Garden")? A source is any of the seat's own in-play Pokémon, Active or Bench, whose Ability is
 * not §9-suppressed. The lock scan runs only once a source is found.
 */
export function seatRemovesWeakness(state: GameState, seat: Seat): boolean {
  const side = state.players[seat];
  const holders = inPlayOf(side);
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    if (top === undefined || programFor(top.id)?.passive?.removeWeakness !== true) continue;
    const uid = topUid(holder);
    if (uid !== undefined && disabledAbilityUids(state).has(uid)) continue;
    return true;
  }
  return false;
}

/**
 * §8.5: the type an opponent-side Weakness rewrite makes `defenderCard`'s Weakness, or `null`
 * (Lillie's Clefairy ex "Fairy Zone"). Sources are the top cards on the defender's opponent's
 * board, Active and Bench, each §9-gated; the first matching source answers. Callers prefer an
 * installed rewrite over this.
 */
export function seatWeaknessRewrite(
  state: GameState,
  defenderSeat: Seat,
  defenderCard: Card | undefined,
): PokemonType | null {
  if (defenderCard === undefined) return null;
  const side = state.players[otherSeat(defenderSeat)];
  const holders = inPlayOf(side);
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    const rewrite =
      top === undefined ? undefined : programFor(top.id)?.passive?.opponentWeaknessRewrite;
    if (rewrite === undefined) continue;
    const uid = topUid(holder);
    if (uid !== undefined && disabledAbilityUids(state).has(uid)) continue; // §9
    if ((defenderCard.types ?? []).includes(rewrite.targetType)) return rewrite.weaknessType;
  }
  return null;
}

/**
 * §8.5: Illumise "Supereffective Pheromones" ("If you have Volbeat in play, apply Weakness for both
 * Active Pokémon as ×3"). The override amount, or `null`. A holder on either board with a live
 * Ability, whose own board has a body named `rule.name`.
 */
export function weaknessAmountOverride(state: GameState): number | null {
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = inPlayOf(side);
    for (const holder of holders) {
      const top = topCardOf(state, holder);
      const rule =
        top === undefined ? undefined : programFor(top.id)?.passive?.weaknessTimesWithNamedInPlay;
      if (rule === undefined) continue;
      const uid = topUid(holder);
      if (uid !== undefined && disabledAbilityUids(state).has(uid)) continue; // §9
      if (holders.some((body) => topCardOf(state, body)?.name === rule.name)) return rule.amount;
    }
  }
  return null;
}

/**
 * Lays `weaknessAmountOverride` over a Weakness that applies. Only a multiplicative Weakness is
 * rewritten; an additive one is left as printed.
 */
export function withWeaknessAmount(
  weakness: DamageModifier | null,
  amount: number | null,
): DamageModifier | null {
  if (weakness === null || amount === null || weakness.op !== "multiply") return weakness;
  return { op: "multiply", amount };
}

/**
 * §9: Ferrothorn "Startling Drop"'s retort, read off the card wherever it lies (it has just left
 * the deck), or `undefined`.
 */
export function opponentMillRetortOf(
  state: GameState,
  uid: string,
): { ability: string; count: number } | undefined {
  return programFor(state.cardIdByUid[uid] ?? "")?.opponentMillWhenMilled;
}

/**
 * §9: Patrat "Watchful Eye" ("Damage counters on each Pokémon… can't be moved to other Pokémon").
 * True while a holder with a live Ability is in play on either board.
 */
export function countersMoveLocked(state: GameState): boolean {
  for (const seat of SEATS) {
    const side = state.players[seat];
    for (const holder of inPlayOf(side)) {
      const top = topCardOf(state, holder);
      if (top === undefined || programFor(top.id)?.passive?.countersCantMove !== true) continue;
      const uid = topUid(holder);
      if (uid !== undefined && disabledAbilityUids(state).has(uid)) continue; // §9
      return true;
    }
  }
  return false;
}

/**
 * §13.2: the extra Burn damage owed to `burnedSeat`'s Burned Active (Magmortar "Magma Surge").
 * Sources are on the opponent's board, §9-gated, and summed: no "doesn't stack" is printed, so two
 * Magmortar pay twice.
 */
export function seatBurnExtraCounters(state: GameState, burnedSeat: Seat): number {
  const side = state.players[otherSeat(burnedSeat)];
  const holders = inPlayOf(side);
  let extra = 0;
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    const amount =
      top === undefined ? undefined : programFor(top.id)?.passive?.opponentBurnExtraCounters;
    if (amount === undefined) continue;
    const uid = topUid(holder);
    if (uid !== undefined && disabledAbilityUids(state).has(uid)) continue; // §9
    extra += amount;
  }
  return extra;
}

/**
 * §9: may `ownerSeat`'s in-play cards not be put into its hand right now? Milotic "Mentally Calm":
 * sources on the opponent's board, §9-gated. Keyed on the owner of the moving card, never on who
 * moves it.
 */
export function inPlayToHandBlocked(state: GameState, ownerSeat: Seat): boolean {
  const side = state.players[otherSeat(ownerSeat)];
  const holders = inPlayOf(side);
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    if (top === undefined || programFor(top.id)?.passive?.opponentInPlayToHandBlocked !== true)
      continue;
    const uid = topUid(holder);
    if (uid !== undefined && disabledAbilityUids(state).has(uid)) continue; // §9
    return true;
  }
  return false;
}

/**
 * §8.1: the uids Huntail "Diver's Catch" puts into `seat`'s hand instead of the discard pile when
 * `body` is Knocked Out, or `[]`. Asked of the pre-batch board, only for a KO by an opponent's
 * attack (the caller's check). Needs a live holder on `seat`'s board (possibly the dying body
 * itself), the dying body being {W} in play, and the move not blocked by `inPlayToHandBlocked`. The
 * "you may" auto-fires; two holders do not stack.
 */
export function koEnergyRescueUids(state: GameState, seat: Seat, body: InPlayPokemon): string[] {
  const side = state.players[seat];
  const holders = inPlayOf(side);
  let rescued: BasicEnergyType | undefined;
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    const type = top === undefined ? undefined : programFor(top.id)?.passive?.koBasicEnergyToHand;
    if (type === undefined) continue;
    const uid = topUid(holder);
    if (uid !== undefined && disabledAbilityUids(state).has(uid)) continue; // §9
    rescued = type;
    break;
  }
  if (rescued === undefined) return [];
  // The KO'd body's in-play types: it is still on the board here.
  if (!matchesFilter(inPlayCardOf(state, body), { kind: "typedPokemon", pokemonType: rescued }))
    return [];
  if (inPlayToHandBlocked(state, seat)) return [];
  const energyType = rescued;
  return body.energy.filter((uid) =>
    matchesFilter(cardOfUid(state, uid), { kind: "basicEnergy", energyType }),
  );
}

/**
 * §8.1: the uids Gengar "Infinite Shadow" puts into `seat`'s hand when `body` is Knocked Out, or
 * `[]`. Asked of the pre-batch board, only for a KO by an opponent's attack. The body's own top
 * card must carry `koSelfToHand` with a live Ability, and the move must not be blocked. "It" is
 * every card of the stack; attached Energy and Tools are discarded.
 *
 * The printed name of `body`'s Gengar ex "Fainting Spell", or null: its own top card carries it and
 * its Ability is live.
 */
export function koAttackerOnCoinFlipOf(state: GameState, body: InPlayPokemon): string | null {
  const top = topCardOf(state, body);
  const ability = top === undefined ? undefined : programFor(top.id)?.passive?.koAttackerOnCoinFlip;
  if (ability === undefined) return null;
  const uid = topUid(body);
  if (uid !== undefined && disabledAbilityUids(state).has(uid)) return null; // §9
  return ability;
}

export function koSelfToHandUids(state: GameState, seat: Seat, body: InPlayPokemon): string[] {
  const top = topCardOf(state, body);
  if (top === undefined || programFor(top.id)?.passive?.koSelfToHand !== true) return [];
  const uid = topUid(body);
  if (uid !== undefined && disabledAbilityUids(state).has(uid)) return []; // §9
  if (inPlayToHandBlocked(state, seat)) return [];
  return [...body.stack];
}

/**
 * §13.1: the extra Poison damage the Stadium owes a Poisoned body (Perilous Jungle: "…2 more damage
 * counters on each Poisoned non-{D} Pokémon"). No seat and no §9 gate. A dual-type body carrying
 * {D} is exempt.
 */
export function stadiumPoisonExtraCounters(state: GameState, top: Card | undefined): number {
  const jungle = stadiumEffectsOf(state)?.poisonExtraCounters;
  if (jungle === undefined) return 0;
  if (jungle.excludesType !== undefined && (top?.types ?? []).includes(jungle.excludesType)) {
    return 0;
  }
  return jungle.amount;
}

/**
 * §10: the Ability a card prints as its only licence into play (Palafin ex "Hero's Spirit" → "Zero
 * to Hero"), or undefined. Read off the card's own program, never `passivesOf`: the card is in a
 * hidden zone, and a §9 lock must not lift a restriction printed on the card being played. Here
 * because interpreter.ts takes no runtime edge to registry.ts.
 */
export function intoPlayOnlyViaOf(card: Card): string | undefined {
  return programFor(card.id)?.intoPlayOnlyVia;
}

/**
 * Does this card print "This card can't be put into your hand or deck from the discard pile"? Read
 * off the card's own program. An unresolvable card is not locked.
 */
export function discardPileLockedOf(card: Card | undefined): boolean {
  return card !== undefined && programFor(card.id)?.discardPileLocked === true;
}

/**
 * §7.4: does this Tool do anything while attached? The one "is this Tool simulated" predicate,
 * shared by the hand attach and Impromptu Carrier's deck offer so neither offers a Tool the other
 * refuses. Here because interpreter.ts takes no runtime edge to registry.ts.
 */
export function toolCardSimulated(card: Card): boolean {
  const toolProgram = programFor(card.id);
  // …or it grants attacks (Technical Machine: Fluorite).
  return (
    toolProgram?.passive !== undefined ||
    (toolProgram?.triggered ?? []).length > 0 ||
    toolProgram?.toolAttacks !== undefined
  );
}

/**
 * Every continuous modifier on one in-play Pokémon, summed from its top card's printed passive,
 * every in-effect Tool (§7.4) and every attached Energy (§6.1). The Basic-only `hpBonus` counts
 * only while the top card is Basic. Under a §9 lock the Pokémon's own passive (an Ability)
 * contributes nothing, but its Tools and Energy keep working; Jamming Tower removes the Tools.
 *
 * Memoized per catalog card object, so every read of one retyped body sees one view.
 */
const retypedViews = new WeakMap<Card, Card>();

/**
 * §9: the top card of an in-play body as the in-play rules see it: the card itself, or, while its
 * own live Ability retypes it (Scovillain ex "Double Type"), a view whose `types` are the in-play
 * types. Every in-play type read goes through here; hand, deck and discard cards never do.
 * `disabledAbilityUids` must never call back here. The retype may be conditional (Iron Treads "Dual
 * Core": only while a Tool with the exact name is attached).
 */
export function inPlayCardOf(state: GameState, pokemon: InPlayPokemon): Card | undefined {
  const top = topCardOf(state, pokemon);
  if (top === undefined) return undefined;
  const typesInPlay = programFor(top.id)?.passive?.typesInPlay;
  if (typesInPlay === undefined) return top;
  const uid = topUid(pokemon);
  if (uid !== undefined && disabledAbilityUids(state).has(uid)) return top; // §9: printed Iron Treads "Dual Core": only while an attached Tool (`pokemon.tools`, not `toolsInEffect`) has this exact name. Checked before the cache, which is keyed by top card while this condition is per body.
  const whileTool = programFor(top.id)?.passive?.typesInPlayWhileToolNamed;
  if (
    whileTool !== undefined &&
    !pokemon.tools.some((t) => cardOfUid(state, t)?.name === whileTool)
  )
    return top;
  const cached = retypedViews.get(top);
  if (cached !== undefined) return cached;
  const view: Card = { ...top, types: [...typesInPlay] };
  retypedViews.set(top, view);
  return view;
}

/** The in-play types of `pokemon` (`[]` for an unresolvable body). */
export function effectiveTypesOf(state: GameState, pokemon: InPlayPokemon): readonly string[] {
  return inPlayCardOf(state, pokemon)?.types ?? [];
}

/**
 * The Antique Fossils' card rule "This card can't be affected by any Special Conditions" as a
 * `passivesOf` source. Ungated: a card rule is not an Ability and no lock lifts it.
 */
const FOSSIL_CARD_RULE: PassiveEffects = {
  statusImmunities: ["asleep", "burned", "confused", "paralyzed", "poisoned"],
};

/** The fold of every passive source on one in-play Pokémon (`passivesOf`). */
export interface PokemonPassives {
  /**
   * §8.5 post-W/R reduction, summed over the holder's passive and every attached Tool, including
   * type-gated Tools (Rock Chestplate). That gate names the holder, so it is resolved here against
   * its in-play types; contrast `preventDamageFromTypes`, whose gate names the attacker and can
   * only be resolved at a read site.
   */
  damageReductionAfterWR: number;
  damageBonusBeforeWR: number;
  /** Pre-W/R bonuses gated on a board condition (Defiance Band), collected RAW
      and UNEVALUATED: the condition is seat-relative and this aggregation has no
      seat, so the two pre-W/R read sites fold them via `conditionHolds`
      (boardCondition.ts `attackerPreWRBonus`). Kept out of `damageBonusBeforeWR` so
      the defender-reduction / HP reads, which never look at either, can't be
      accidentally credited an attacker's conditional bonus. */
  conditionalDamageBonusBeforeWR: { amount: number; cond: BoardCondition }[];
  /** Pre-W/R bonuses gated on the DEFENDER's rule-box suffix (Choice Belt),
      collected RAW like the board-condition list above: the defender is not a
      seat and this aggregation has none, so the read sites fold them via
      `pokemonSuffixOf(defenderCard)` in `attackerPreWRBonus`. */
  targetConditionalDamageBonusBeforeWR: { amount: number; targetSuffix: PokemonSuffix }[];
  /**
   * §8/§9: attack gates the holder's own Abilities impose ("This Pokémon can't attack unless…"),
   * collected raw because the condition is seat-relative and this fold has no seat. A list because
   * two sources can name one.
   */
  cantAttackUnless: BoardCondition[];
  /**
   * §5.3/§8: the holder's attack-again licences ("Festival Lead"), collected raw for the same
   * reason; `attackAgainLicensed` evaluates them. A §9-locked holder contributes nothing.
   */
  attackTwiceIf: BoardCondition[];
  /**
   * §4: the holder's own Ability licenses it to attack on the going-first player's first turn
   * ("Debut Performance"). A boolean: it carries no seat-relative condition.
   */
  attackFirstTurnExempt: boolean;
  /**
   * §4/§10: the live licences on this body to evolve on your first turn or the turn it came into
   * play. A zone clause (Eevee "Boosted Evolution": "As long as this Pokémon is in the Active
   * Spot") is resolved in the fold; seat-relative clauses (Karrablast/Shelmet "Stimulated
   * Evolution", Luxio "Fighting Roar") are collected raw for `evolveEarlyLicensed`. The zone gate
   * must not apply to the latter, which print no zone clause. `undefined` means nothing further to
   * check; a `BoardCondition` is the remainder.
   */
  evolveEarlyExempt: (BoardCondition | undefined)[];
  /**
   * §8.2: cost clauses the holder's Ability puts on its own named attacks (Noivern "Tuning Echo",
   * Kyurem "Plasma Bane"), collected raw because the condition is seat-relative.
   */
  attackCostClauses: NonNullable<PassiveEffects["attackCostClause"]>[];
  /** §10: evolve aliases the holder's Ability grants (Eevee ex "Rainbow DNA"); §9-suppressible. */
  evolveAsNamed: NonNullable<PassiveEffects["evolveAsNamed"]>[];
  hpBonus: number;
  /** §9 reactive recoil placed on the ATTACKER when this Pokémon is damaged by
      an attack while Active (Counterattack Quills / Custom Trap) — summed HP.
      `requiresTool` is evaluated HERE against the holder's board (this function
      has the Pokémon), so the attack.ts read site stays a plain number. */
  damageAttacker: number;
  /** §8.1 recoil placed on the ATTACKER when this Pokémon is KNOCKED OUT by
      damage from an opponent's attack (Vengeful Punch sv03-197) — summed HP, and
      a SECOND number rather than a term of the one above because the two read
      sites refuse each other's condition (registry.ts `damageAttackerOnKo`).
      Read once per sweep by flow.ts `koRecoilOf`, which supplies the "is Knocked
      Out" half; this aggregation only answers "what would this body pay". */
  damageAttackerOnKo: number;
  /**
   * §11: the shares of the two recoils above contributed by the holder's own Ability, without the
   * Tools'. An attacker with `preventAbilityEffects` (Mega Clefable ex "Luminous Wing") takes the
   * recoil less this share.
   */
  damageAttackerFromAbility: number;
  damageAttackerOnKoFromAbility: number;
  /** §8.5 full damage PREVENTION when the attacker is an ex/V (Mimikyu
      "Safeguard"). The attacker's rule-box class is known only at the read sites,
      so this aggregation just reports whether the holder carries the aura; the
      sites gate it on `isExOrV(attacker)`. */
  preventDamageFromExV: boolean;
  /**
   * §8.5: full damage prevention when the attacker is one of these types (Dachsbun "Well-Baked
   * Body", Bellibolt "Insulator"). A list, not a scalar, because each source names a value and a
   * scalar fold would be last-wins.
   */
  preventDamageFromTypes: PokemonType[];
  /**
   * §8.5: full damage prevention when the attacker has an Ability (Cornerstone Mask Ogerpon ex
   * "Cornerstone Stance"). A boolean: the gate carries no value, so an OR over sources is lossless.
   * Damage only, not effects. No Active clause, so it protects a benched holder.
   */
  preventDamageFromHasAbility: boolean;
  /**
   * §8.5/§11: prevents damage and effects of attacks from Pokémon with any Special Energy attached
   * (Carracosta "Mighty Shell"), so it is also read at `attackEffectRefused`. The attacker
   * predicate is a board read (`attackerHasSpecialEnergy`), not a card read. A boolean, since the
   * gate names no value.
   */
  preventDamageAndEffectsFromSpecialEnergy: boolean;
  /**
   * §8.5/§11: prevents damage and effects of the opponent's attacks while this Pokémon is on the
   * Bench (Poltchageist, Sinistcha). The zone clause names the holder, so it is resolved here and
   * read sites get a bare boolean. Kept separate from the Special Energy prevention so neither card
   * gains the other's condition.
   */
  preventDamageAndEffectsWhileBenched: boolean;
  /**
   * §8.5: the line above without the effects half (Antique Plume Fossil "Plume Protection"): read
   * at the damage sites only. The fold answers the zone clause; "from your opponent's Pokémon" is a
   * seat check made at the read sites.
   */
  preventDamageWhileBenched: boolean;
  /**
   * §11: does this Pokémon refuse the effects of an Item or Supporter the opponent plays (Fraxure
   * "Unnerve", Cetitan ex "Snow Camouflage")? Read only at `effectRefused`'s Trainer channel; no
   * damage half. No zone clause, so benched and Active holders answer the same.
   */
  preventTrainerEffects: boolean;
  /**
   * §11: `preventTrainerEffects` narrowed to a Supporter the opponent plays (Antique Sail Fossil
   * "Protective Sail").
   */
  preventSupporterEffects: boolean;
  /**
   * §11: does this Pokémon refuse the effects of an opponent's attack, with no damage half
   * (Skeledirge "Unaware": "Damage is not an effect")? Separate from `preventTrainerEffects` so
   * neither refuses the other's channel. Nothing in the §8.5 pipeline may read it.
   */
  preventAttackEffects: boolean;
  /** §11: `preventAttackEffects` on the Ability channel (Mega Clefable ex "Luminous Wing"). */
  preventAbilityEffects: boolean;
  /**
   * §8.5: the rule-box classes an attacker must belong to for this Pokémon's aura to prevent its
   * damage (Sylveon "Safeguard" and Crustle: any ex; Farigiraf ex "Armor Tail": Basic ex). A list
   * of records because sources can disagree; not de-duplicated, since the read is a `.some`. Damage
   * only, so `attackEffectRefused` does not read it.
   */
  preventDamageFromAttackerClasses: PreventedAttackerClass[];
  /**
   * §8.5/§11: the banners whose attacks this holder refuses, damage and effects (Milotic ex
   * "Sparkling Scales": `["Tera"]`).
   */
  preventDamageAndEffectsFromBanners: Banner[];
  /**
   * §8.5: attacker-gated post-W/R reductions (Sacred Charm, Thick Scale, Dewgong "Thick Fat"),
   * holder gate already resolved. Summed at the read sites by `attackerGatedReductionOf`.
   */
  damageReductionsFromAttacker: { amount: number; attacker: CardFilter }[];
  /**
   * §8.5: full damage prevention when the damage about to be placed is this number or more (Drednaw
   * "Impervious Shell": "…if that damage is 200 or more"). Inclusive. Folded with `Math.min`, since
   * a lower threshold shields more. `undefined`, not `Infinity`, means no such aura. Damage only.
   */
  preventDamageAtOrAbove: number | undefined;
  /**
   * §8.5: coin-flip damage shields on this body (Fezandipiti "Adrena-Pheromone", Kecleon "Expert
   * Hider"), already gated and each carrying its Ability name. Read sites go through
   * `coinFlipShieldPrevents`, which owns the RNG step. A list and not de-duplicated, because two
   * sources mean two coin flips.
   */
  preventDamageOnCoinFlip: { ability: string }[];
  /**
   * §8.1: cause-conditioned prize reductions an attached card prints (Lillie's Pearl, Legacy
   * Energy), collected raw because their riders are about a seat or the game; flow.ts `planPrizes`
   * evaluates them. A list because the printings carry different riders. Attached cards are not
   * Abilities, so a §9 lock does not silence them.
   */
  koPrizeReductions: KoPrizeReduction[];
  /**
   * §12: the Special Conditions this Pokémon cannot be given (Dachsbun, Pachirisu, Therapeutic
   * Energy). Consumed only by `applyStatus`. Rides this fold so a §9 lock switches off the
   * Ability-granted immunities while leaving the Energy's and the Antique Fossils' card rule
   * standing.
   */
  statusImmunities: StatusName[];
  /**
   * §12: the Special Conditions a live effect clears from this body (Therapeutic Energy). Consumed
   * by `recoverStatuses`, which does the clearing since this fold never writes.
   */
  statusRecovery: StatusName[];
  /**
   * §8.5: does damage from this Pokémon's attacks ignore effects on the opponent's Active (Walking
   * Wake ex "Azure Seas")? Read off the attacker, not the body hit. An Ability, so a §9 lock
   * switches it off.
   */
  suppressTargetEffectsOnAttack: boolean;
  /**
   * §8.1: does this Pokémon survive a Knock Out at full HP on 10 HP (Pikachu ex "Resolute Heart",
   * Crustle "Sturdy")? Clamps the stored total rather than changing `dealt`. Consumed only by
   * `koSurvivalClamp`. An Ability, so a §9 lock switches it off.
   */
  survivesKoAtFullHp: boolean;
  /** The name of this body's coin-flip survival Ability (Tenacious Body, Durable Body), or null. */
  survivesKoOnCoinFlip: string | null;
}

function emptyPassives(): PokemonPassives {
  return {
    damageReductionAfterWR: 0,
    damageBonusBeforeWR: 0,
    conditionalDamageBonusBeforeWR: [],
    targetConditionalDamageBonusBeforeWR: [],
    cantAttackUnless: [],
    attackTwiceIf: [],
    attackFirstTurnExempt: false,
    evolveEarlyExempt: [],
    attackCostClauses: [],
    evolveAsNamed: [],
    hpBonus: 0,
    damageAttacker: 0,
    damageAttackerOnKo: 0,
    damageAttackerFromAbility: 0,
    damageAttackerOnKoFromAbility: 0,
    preventDamageFromExV: false,
    preventDamageFromTypes: [],
    preventDamageFromHasAbility: false,
    preventDamageAndEffectsFromSpecialEnergy: false,
    preventDamageAndEffectsWhileBenched: false,
    preventDamageWhileBenched: false,
    preventTrainerEffects: false,
    preventSupporterEffects: false,
    preventAttackEffects: false,
    preventAbilityEffects: false,
    preventDamageFromAttackerClasses: [],
    preventDamageAndEffectsFromBanners: [],
    damageReductionsFromAttacker: [],
    // `undefined` means no threshold aura, rather than `Infinity`.
    preventDamageAtOrAbove: undefined,
    preventDamageOnCoinFlip: [],
    koPrizeReductions: [],
    statusImmunities: [],
    statusRecovery: [],
    suppressTargetEffectsOnAttack: false,
    survivesKoAtFullHp: false,
    survivesKoOnCoinFlip: null,
  };
}

/** The holder facts every passive source is gated against. */
interface PassiveHolder {
  state: GameState;
  pokemon: InPlayPokemon;
  /** The in-play card, or the printed one for a locked holder. */
  card: Card | undefined;
  types: readonly string[];
  isBasic: boolean;
  onBench: boolean;
  hasTool: boolean;
}

export function passivesOf(state: GameState, pokemon: InPlayPokemon): PokemonPassives {
  const top = topCardOf(state, pokemon);
  // A locked Pokémon's own printed passive (an Ability) is suppressed; its Tools are not Abilities
  // and keep contributing (Jamming Tower is a separate gate via `toolsInEffect`). The lock aura is
  // read by `disabledAbilityUids` straight off the passive, so this never recurses.
  const holderUid = topUid(pokemon);
  const disabled = holderUid !== undefined && disabledAbilityUids(state).has(holderUid);
  // Sources: the top card's printed passive (the only element that takes the §9 `disabled` drop),
  // the Antique Fossils' card rule, the in-effect Tools and the attached Energy. Only Abilities are
  // silenced by a lock. Consumable Tool fields (Berries, Survival Brace, Deluxe Bomb) are read by
  // their own per-Tool scans, not summed here.
  const sources: (PassiveEffects | undefined)[] = [
    disabled || top === undefined ? undefined : programFor(top.id)?.passive,
    // The Antique Fossils' card rule ("This card can't be affected by any Special Conditions"): not
    // an Ability, so §9 locks leave it standing. Top card only; an evolved fossil has no such rule.
    isFossilTop(state, pokemon) ? FOSSIL_CARD_RULE : undefined,
    // Under Jamming Tower no Tool reaches the fold.
    ...toolsInEffect(state, pokemon).map((uid) => {
      const id = state.cardIdByUid[uid];
      return id === undefined ? undefined : programFor(id)?.passive;
    }),
    ...pokemon.energy.map((uid) => {
      const id = state.cardIdByUid[uid];
      const energy = id === undefined ? undefined : programFor(id)?.energy;
      // A typed Special Energy's passive applies only on a holder of its printed type.
      return energyRulesApply(state, pokemon, energy) ? energy?.passive : undefined;
    }),
  ];
  const isBasic = top !== undefined && isBasicPokemon(top);
  // The holder's in-play types, for holder-type gates (Rock Chestplate, Brave Bangle, Cynthia's
  // Power Weight). Read from the top card, so an evolution that changes type ends the effect with
  // the Tool still attached. A locked holder is its printed card.
  const holderCard = disabled ? top : inPlayCardOf(state, pokemon);
  const holderTypes = holderCard?.types ?? [];
  // The holder's zone, for Poltchageist's "As long as this Pokémon is on your Bench". Live-read, so
  // leaving the Bench ends the prevention.
  const onBench = isOnBench(state, pokemon);
  const hasTool = pokemon.tools.length > 0;
  const holder: PassiveHolder = {
    state,
    pokemon,
    card: holderCard,
    types: holderTypes,
    isBasic,
    onBench,
    hasTool,
  };
  const out = emptyPassives();
  for (const [index, passive] of sources.entries()) {
    if (passive === undefined) continue;
    // `sources[0]` is the top card's own printed passive, i.e. its Ability.
    const fromAbility = index === 0;
    foldDamageModifiers(out, passive, holder);
    foldHpBonus(out, passive, holder);
    foldRecoil(out, passive, holder, fromAbility);
    foldPreventions(out, passive, holder);
    foldStatuses(out, passive);
    foldLicences(out, passive, holder);
  }
  return out;
}

/** §8.5 reductions and pre-W/R bonuses. */
function foldDamageModifiers(
  out: PokemonPassives,
  passive: PassiveEffects,
  holder: PassiveHolder,
): void {
  out.damageReductionAfterWR += passive.damageReductionAfterWR ?? 0;
  // The same reduction gated on the holder's in-play type, summed into the ungated total: it is
  // the same sentence at the same §8.5 step.
  const typed = passive.damageReductionAfterWRIfType;
  if (typed !== undefined && holder.types.includes(typed.type)) {
    out.damageReductionAfterWR += typed.amount;
  }
  // Regirock "Rock Armor": the same reduction gated on the holder having any Energy attached (a
  // card count).
  if (passive.damageReductionAfterWRIfEnergy !== undefined && holder.pokemon.energy.length > 0)
    out.damageReductionAfterWR += passive.damageReductionAfterWRIfEnergy;
  // The attacker-gated twin (Sacred Charm, Thick Scale, Thick Fat): the holder gate is answered
  // here, the attacker gate only at the read sites.
  const fromAttacker = passive.damageReductionAfterWRFromAttacker;
  if (
    fromAttacker !== undefined &&
    (fromAttacker.holderType === undefined || holder.types.includes(fromAttacker.holderType))
  )
    out.damageReductionsFromAttacker.push({
      amount: fromAttacker.amount,
      attacker: fromAttacker.attacker,
    });
  out.damageBonusBeforeWR += passive.damageBonusBeforeWR ?? 0;
  if (passive.damageBonusBeforeWRIf !== undefined)
    out.conditionalDamageBonusBeforeWR.push(passive.damageBonusBeforeWRIf);
  // Brave Bangle's holder clause ("If the Pokémon this card is attached to doesn't have a Rule
  // Box"), resolved here because only the fold holds the holder.
  const targeted = passive.damageBonusBeforeWRIfTarget;
  if (
    targeted !== undefined &&
    (targeted.holder === undefined || matchesFilter(holder.card, targeted.holder))
  )
    out.targetConditionalDamageBonusBeforeWR.push(targeted);
}

function foldHpBonus(out: PokemonPassives, passive: PassiveEffects, holder: PassiveHolder): void {
  const { state, pokemon } = holder;
  if (holder.isBasic) out.hpBonus += passive.basicHpBonus ?? 0;
  // Stage-free HP bonus, summed into the same accumulator: Hero's Cape has no stage clause so it
  // must not take `isBasic`; Cynthia's Power Weight gates on `beneficiary`; Okidogi gates on
  // having any {D} Energy attached (`hasAttachedEnergy`, since the printed word is "any").
  const stageFree = passive.hpBonus;
  if (
    stageFree !== undefined &&
    (stageFree.beneficiary === undefined || matchesFilter(holder.card, stageFree.beneficiary)) &&
    (stageFree.requiresEnergyType === undefined ||
      hasAttachedEnergy(state, pokemon, stageFree.requiresEnergyType)) &&
    // Scale Up's "6 or more": a count threshold beside the "any" gate (absent = no threshold).
    // Counts Energy cards by provision.
    (stageFree.requiresEnergyCount === undefined ||
      countAttachedEnergy(state, pokemon, stageFree.requiresEnergyType ?? null) >=
        stageFree.requiresEnergyCount)
  ) {
    out.hpBonus += stageFree.amount;
  }
  // Scaled max-HP bonus: `amount × count`, summed into the same accumulator as the flat bonuses.
  // The count is never negative, so this only ever adds.
  const scaled = passive.hpBonusPer;
  if (scaled !== undefined)
    out.hpBonus += scaled.amount * maxHpScaleCount(state, pokemon, scaled.scale);
}

/** §9/§8.1 recoil on the attacker, with the holder's own Ability share kept apart. */
function foldRecoil(
  out: PokemonPassives,
  passive: PassiveEffects,
  holder: PassiveHolder,
  fromAbility: boolean,
): void {
  // Orthworm ex: "for each {M} Energy attached to this Pokémon" multiplies the amount by the
  // holder's count of that type.
  const recoil = passive.damageAttacker;
  if (
    recoil !== undefined &&
    (recoil.requiresTool !== true || holder.hasTool) &&
    // Punk Helmet: "{D} Pokémon this card is attached to" checks the holder's in-play types.
    (recoil.holderType === undefined || holder.types.includes(recoil.holderType))
  ) {
    const amount =
      recoil.perAttachedEnergy === undefined
        ? recoil.amount
        : recoil.amount *
          countAttachedEnergy(holder.state, holder.pokemon, recoil.perAttachedEnergy);
    out.damageAttacker += amount;
    if (fromAbility) out.damageAttackerFromAbility += amount;
  }
  // A §9 lock silences an Ability printing (Maractus "Exploding Needles") but never an attached
  // Tool. `activeOnly` is answered off `onBench`; `koRecoilOf` reads this fold before `knockOut`
  // moves the body, so the zone is still the one it was Knocked Out in.
  const onKo = passive.damageAttackerOnKo;
  if (onKo !== undefined && (onKo.activeOnly !== true || !holder.onBench)) {
    out.damageAttackerOnKo += onKo.amount;
    if (fromAbility) out.damageAttackerOnKoFromAbility += onKo.amount;
  }
}

/**
 * §8.5/§11 damage and effect preventions, KO survival and target-effect suppression. Folded per
 * source, so a §9 lock on the holder switches its Ability's share off.
 */
function foldPreventions(
  out: PokemonPassives,
  passive: PassiveEffects,
  holder: PassiveHolder,
): void {
  if (passive.preventDamageFromExV === true) out.preventDamageFromExV = true;
  if (passive.preventDamageFromType !== undefined)
    out.preventDamageFromTypes.push(passive.preventDamageFromType);
  if (passive.preventDamageFromHasAbility === true) out.preventDamageFromHasAbility = true;
  // Separate from the damage-only flag: "prevent all damage" does not imply "and effects of".
  if (passive.preventDamageAndEffectsFromSpecialEnergy === true)
    out.preventDamageAndEffectsFromSpecialEnergy = true;
  // "As long as this Pokémon is on your Bench": the zone clause is answered here.
  if (passive.preventDamageAndEffectsWhileBenched === true && holder.onBench)
    out.preventDamageAndEffectsWhileBenched = true;
  // Plume Protection: the same Bench gate, damage only.
  if (passive.preventDamageWhileBenched === true && holder.onBench)
    out.preventDamageWhileBenched = true;
  if (passive.preventTrainerEffects === true) out.preventTrainerEffects = true;
  // Protective Sail: the same shield, Supporters only (read at the funnel).
  if (passive.preventSupporterEffects === true) out.preventSupporterEffects = true;
  if (passive.preventAttackEffects === true) out.preventAttackEffects = true;
  if (passive.preventAbilityEffects === true) out.preventAbilityEffects = true;
  // Pushed rather than OR'd because sources can name different classes ("Pokémon ex", "Basic
  // Pokémon ex").
  if (passive.preventDamageFromAttackerClass !== undefined)
    out.preventDamageFromAttackerClasses.push(passive.preventDamageFromAttackerClass);
  // Sparkling Scales.
  if (passive.preventDamageAndEffectsFromBanner !== undefined)
    out.preventDamageAndEffectsFromBanners.push(passive.preventDamageAndEffectsFromBanner);
  // `Math.min` because a lower threshold shields strictly more damage, so the minimum keeps every
  // source's promise.
  if (passive.preventDamageAtOrAbove !== undefined)
    out.preventDamageAtOrAbove =
      out.preventDamageAtOrAbove === undefined
        ? passive.preventDamageAtOrAbove
        : Math.min(out.preventDamageAtOrAbove, passive.preventDamageAtOrAbove);
  // `requiresEnergyType` (Fezandipiti's "has any {D} Energy attached") is a holder fact resolved
  // here; absent means the unconditional printing. Pushed, not OR'd: each source is its own coin
  // flip, collected with its Ability name because `ABILITY_COIN_FLIP` has to name one.
  if (
    passive.preventDamageOnCoinFlip !== undefined &&
    (passive.preventDamageOnCoinFlip.requiresEnergyType === undefined ||
      hasAttachedEnergy(
        holder.state,
        holder.pokemon,
        passive.preventDamageOnCoinFlip.requiresEnergyType,
      ))
  )
    out.preventDamageOnCoinFlip.push({ ability: passive.preventDamageOnCoinFlip.ability });
  // §8.1 Prize reduction, pushed raw: its riders concern the seat, the attack cause or the game,
  // which this fold cannot answer.
  if (passive.onKoPrizeReduction !== undefined)
    out.koPrizeReductions.push(passive.onKoPrizeReduction);
  // Attacker-side suppression ("Azure Seas").
  if (passive.suppressTargetEffectsOnAttack === true) out.suppressTargetEffectsOnAttack = true;
  // §8.1 KO survival ("Resolute Heart", "Sturdy"). Survival Brace uses
  // `survivesKoAtFullHpFromOpponentThenDiscard` instead because it needs the Tool's uid.
  if (passive.survivesKoAtFullHp === true) out.survivesKoAtFullHp = true;
  // Tenacious Body / Durable Body.
  if (passive.survivesKoOnCoinFlip !== undefined)
    out.survivesKoOnCoinFlip ??= passive.survivesKoOnCoinFlip;
}

/** §12 immunity and recovery; a §9 lock drops the holder's own share while Tools and Energy apply. */
function foldStatuses(out: PokemonPassives, passive: PassiveEffects): void {
  if (passive.statusImmunities !== undefined)
    out.statusImmunities.push(...passive.statusImmunities);
  // Deliberately not derived from the immunity: most immunity printings refuse without recovering.
  if (passive.statusRecovery !== undefined) out.statusRecovery.push(...passive.statusRecovery);
}

/** §4/§5.3/§8/§10 attack and evolve gates and licences, collected raw where seat-relative. */
function foldLicences(out: PokemonPassives, passive: PassiveEffects, holder: PassiveHolder): void {
  // §8 attack gate ("Power Saver").
  if (passive.cantAttackUnless !== undefined) out.cantAttackUnless.push(passive.cantAttackUnless);
  // Attack-again licence (Festival Lead); a locked holder loses the window.
  if (passive.attackTwiceIf !== undefined) out.attackTwiceIf.push(passive.attackTwiceIf);
  // §4 first-turn attack licence ("Debut Performance"); a §9 lock hands the ban back.
  if (passive.attackFirstTurnExempt === true) out.attackFirstTurnExempt = true;
  // §4/§10 evolve licence, collected raw because its conditions differ in kind. `activeOnly`
  // (Eevee) is answered here via `!onBench`; it is per printing, since Karrablast and Shelmet
  // print no Active Spot clause. `ifInPlay` and `ifCondition` are seat-relative and resolved by
  // `evolveEarlyLicensed` (boardCondition.ts).
  const licence = passive.evolveEarlyExempt;
  if (licence !== undefined && (licence.activeOnly !== true || !holder.onBench)) {
    out.evolveEarlyExempt.push(
      licence.ifInPlay === undefined
        ? // Luxio "Fighting Roar"
          licence.ifCondition
        : { kind: "yourNamedPokemonInPlay", name: licence.ifInPlay },
    );
  }
  // Ability-printed cost clause (Noivern, Kyurem), pushed raw because the condition is
  // seat-relative and `attackCostAt` evaluates it; a §9 lock restores the printed cost.
  if (passive.attackCostClause !== undefined) out.attackCostClauses.push(passive.attackCostClause);
  // Evolve alias (Eevee ex "Rainbow DNA"); a locked Eevee ex evolves by §10 name match alone.
  if (passive.evolveAsNamed !== undefined) out.evolveAsNamed.push(passive.evolveAsNamed);
}

/**
 * §8.5: does `attacker` have one of the types the prevention aura names? Types are intersected
 * because dual types exist. An unresolvable attacker returns false (protects less).
 */
export function preventsAttackerType(
  types: readonly PokemonType[],
  attacker: Card | undefined,
): boolean {
  if (types.length === 0 || attacker === undefined) return false;
  const printed = attacker.types ?? [];
  return types.some((type) => printed.includes(type));
}

/**
 * §8.5: does `damage` meet the prevention threshold ("if that damage is 200 or more")? Inclusive;
 * an absent threshold shields nothing. `damage` is the amount actually to be placed, after
 * Weakness, Resistance and reductions.
 */
export function preventedByDamageThreshold(threshold: number | undefined, damage: number): boolean {
  return threshold !== undefined && damage >= threshold;
}

/**
 * §8.5/§11: does the attacking body have any Special Energy attached? Takes the board body, not a
 * card, because attachment is board state. An unresolvable attacker returns false (protects less).
 */
export function attackerHasSpecialEnergy(
  state: GameState,
  attacker: InPlayPokemon | undefined,
): boolean {
  return attacker !== undefined && hasAttachedEnergy(state, attacker, "special");
}

/**
 * §2.2: is `pokemon` on a Bench? Scans both sides because a body can only be on its own Bench.
 * Identity is the top uid, since bodies are rebuilt by value. A body without a top uid is not on a
 * Bench.
 */
export function isOnBench(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  return SEATS.some((seat) => state.players[seat].bench.some((benched) => topUid(benched) === uid));
}

/**
 * §11: the live attack-installed block on `pokemon`, or null. The block is live only while its turn
 * stamp equals the current turn. Callers must also check that the effect comes from an attack
 * (`EffectContext.invokedBy`). `attacker` and `damage` are required but nullable so every site
 * resolves the class filter and the damage cap; an unknown attacker or amount fails a filtered or
 * capped block. `damage` is the amount that would actually be placed, after Weakness, Resistance
 * and reductions (a flagged reading, not a ruling).
 */
export function attackBlockOf(
  state: GameState,
  pokemon: InPlayPokemon,
  attacker: Card | undefined,
  damage: number | undefined,
  // The attacking body, for classes read off the board ("burned"). When absent, those classes
  // answer false.
  attackerBody?: InPlayPokemon,
): AttackBlock | null {
  // The chosen-body shield is checked first: it refuses damage and effects with no cap, so no other
  // block refuses more.
  const chosen = chosenAttackShieldOf(state, pokemon, attacker, attackerBody);
  if (chosen !== null) return chosen;
  const block = pokemon.attackBlock;
  // The side-wide block (Miraidon "C.O.D.E.: Protect") applies whenever the body's own block does
  // not.
  if (block === null || block.turn !== state.turn)
    return sideAttackBlockOf(state, pokemon, attacker, attackerBody);
  // `<=` matches the printed "or less". An absent cap means no cap.
  if (block.maxDamage !== undefined && !(damage !== undefined && damage <= block.maxDamage)) {
    return sideAttackBlockOf(state, pokemon, attacker, attackerBody);
  }
  // Unfiltered block.
  if (block.fromClass === undefined) return block;
  return attacker !== undefined && attackerMatchesClass(attacker, block.fromClass, attackerBody)
    ? block
    : sideAttackBlockOf(state, pokemon, attacker, attackerBody);
}

/**
 * §11 side arm of `attackBlockOf` (Miraidon "C.O.D.E.: Protect"): the side's live block applies
 * when the body prints the banner, the source is still that side's Active, and the attacker matches
 * the class. Synthesizes a damage-only block with no cap.
 */
function sideAttackBlockOf(
  state: GameState,
  pokemon: InPlayPokemon,
  attacker: Card | undefined,
  attackerBody: InPlayPokemon | undefined,
): AttackBlock | null {
  const uid = topUid(pokemon);
  if (uid === undefined || attacker === undefined) return null;
  for (const seat of SEATS) {
    const side = state.players[seat];
    const record = side.sideAttackBlock;
    if (record === null || record.turn !== state.turn) continue;
    if (side.active === null || topUid(side.active) !== record.sourceUid) continue;
    const onSide = side.active.stack.includes(uid) || side.bench.some((b) => b.stack.includes(uid));
    if (!onSide) continue;
    if (bannerOf(topCardOf(state, pokemon)) !== record.banner) return null;
    return attackerMatchesClass(attacker, record.fromClass, attackerBody)
      ? { turn: record.turn, effects: false, fromClass: record.fromClass }
      : null;
  }
  return null;
}

/**
 * §11 chosen-body arm of `attackBlockOf`: the side's live `chosenAttackShield` names this body's
 * base uid (`stack[0]`, so it follows the body through switching and evolving) and the attacker
 * matches the class. Synthesizes a damage-and-effects block with no cap.
 */
function chosenAttackShieldOf(
  state: GameState,
  pokemon: InPlayPokemon,
  attacker: Card | undefined,
  attackerBody: InPlayPokemon | undefined,
): AttackBlock | null {
  const base = pokemon.stack[0];
  if (base === undefined || attacker === undefined) return null;
  for (const seat of SEATS) {
    const record = state.players[seat].chosenAttackShield;
    if (record === null || record.turn !== state.turn || record.uid !== base) continue;
    return attackerMatchesClass(attacker, record.fromClass, attackerBody)
      ? { turn: record.turn, effects: true, fromClass: record.fromClass }
      : null;
  }
  return null;
}

/**
 * Does `attacker` belong to the class a filtered block names? Stage words use an exhaustive switch
 * so new members are compile errors. Read off the attacker's top card, so an evolved Basic no
 * longer matches "Basic". Type exclusions use `types.includes` because types is an array; since an
 * exclusion widens the block when it fails, an unresolvable type refuses to derive.
 */
function attackerMatchesClass(
  attacker: Card,
  cls: NonNullable<AttackBlock["fromClass"]>,
  attackerBody?: InPlayPokemon, // Only used by `"burned"`.
): boolean {
  if (!attackerMatchesStage(attacker, cls.stage, attackerBody)) return false;
  return cls.excludingType === undefined || !(attacker.types ?? []).includes(cls.excludingType);
}

/** The stage conjunct alone, split out so the `switch` can be the whole BODY of a
    `boolean` function: that is what makes exhaustiveness a compiler fact (a new
    `stage` member leaves the function with a code path returning `undefined`).
    Folded inline it would merely fall out of the switch and answer `true`, which
    is the silent-widening failure this family must not have. */
function attackerMatchesStage(
  attacker: Card,
  stage: AttackerClass["stage"],
  attackerBody: InPlayPokemon | undefined,
): boolean {
  switch (stage) {
    case "basic":
      return isBasicPokemon(attacker);
    // Ancient banner (Iron Moth "…from Ancient Pokémon"), read off the attacker's top card at
    // damage time.
    case "ancient":
      return bannerOf(attacker) === "Ancient";
    // Exactly "Pokémon ex": not `isExOrV` (a V is not an ex) nor `hasRuleBox`.
    case "ex":
      return pokemonSuffixOf(attacker) === "ex";
    // "Attacks from Burned Pokémon" (Lava Wall): the attacking body's condition at damage time. No
    // body means false.
    case "burned":
      return attackerBody?.conditions.burned === true;
    // "Attacks from Evolution Pokémon": the in-play card.
    case "evolution":
      return isEvolutionPokemon(attacker);
    // "Attacks from Pokémon that have an Ability": the printed Ability on the in-play card; a
    // §9-locked Ability still counts.
    case "hasAbility":
      return hasPrintedAbility(attacker);
  }
}

/**
 * §6.2/§11: `pokemon`'s live hand-attach mark (`HandAttachMark`), or null. Live only while its turn
 * stamp equals the current turn.
 */
export function liveHandAttachMark(
  state: GameState,
  pokemon: InPlayPokemon,
): HandAttachMark | null {
  const mark = pokemon.handAttachMark;
  return mark !== null && mark.turn === state.turn ? mark : null;
}

/**
 * §8.5/§11: the attack-installed damage reduction on `pokemon` right now, or 0. Live only while its
 * turn stamp equals the current turn. Callers add it to the `passivesOf` reduction at the same
 * step; it is kept out of `passivesOf` because an installation is not an Ability and must survive a
 * §9 lock.
 */
export function installedReductionOf(
  state: GameState,
  pokemon: InPlayPokemon,
  // The attacking card and body, for a class-filtered reduction. An unreadable attacker gets no
  // filtered reduction.
  attacker?: Card,
  attackerBody?: InPlayPokemon,
): number {
  const installed = pokemon.damageReduction;
  if (installed === null || installed.turn !== state.turn) return 0;
  if (installed.fromClass === undefined) return installed.amount;
  return attacker !== undefined && attackerMatchesClass(attacker, installed.fromClass, attackerBody)
    ? installed.amount
    : 0;
}

/**
 * §8.5/§11: the attack-installed next-turn vulnerability on `pokemon` ("takes 50 more damage from
 * attacks (after applying Weakness and Resistance)"), or 0. Callers add it after Weakness and
 * Resistance and report it as `vulnerability`. It is an effect on the target, so target-effect
 * suppression drops it.
 */
export function installedVulnerabilityOf(state: GameState, pokemon: InPlayPokemon): number {
  const installed = pokemon.damageVulnerability;
  return installed === null || installed.turn !== state.turn ? 0 : installed.amount;
}

/**
 * §8.5/§11: the type an attack-installed Weakness retype gives `pokemon` ("the Defending Pokémon's
 * Weakness is now {C}"), or null. Applied after the null-Weakness paths, so a removed Weakness
 * stays removed. It is an effect on the target, so `suppressTargetEffects` drops it.
 */
export function installedWeaknessRetypeOf(state: GameState, pokemon: InPlayPokemon): string | null {
  const installed = pokemon.weaknessRetype;
  return installed === null || installed.turn !== state.turn ? null : installed.type;
}

/**
 * §8.5/§11: the Weakness rewrite (Pikachu "Overwriting Bolt": "Weakness is now {L} … (Apply
 * Weakness as ×2.)") on `pokemon`, or null. Passed to `weaknessOf` as its `rewrite`, ahead of the
 * seat-wide rewrite.
 */
export function installedWeaknessRewriteOf(
  state: GameState,
  pokemon: InPlayPokemon,
): string | null {
  const installed = pokemon.weaknessRetype;
  return installed === null || installed.turn !== state.turn || installed.asTimesTwo !== true
    ? null
    : installed.type;
}

/**
 * §8.5/§11: does `pokemon` carry an attack-installed "During your opponent's next turn, this
 * Pokémon has no Weakness."? Live only while its turn stamp equals the current turn. Separate from
 * the Ability aura so a §9 lock cannot remove it.
 */
export function installedNoWeakness(state: GameState, pokemon: InPlayPokemon): boolean {
  return pokemon.noWeaknessTurn === state.turn;
}

/**
 * §8.5/§11: the attack-installed debuff on damage `pokemon`'s own attacks do, or 0. Applied before
 * Weakness and Resistance, subtracted beside `attackerPreWRBonus` rather than folded into it, and
 * kept out of `passivesOf` so a §9 lock cannot remove it. Live only while its turn stamp equals the
 * current turn.
 */
export function installedAttackDebuffOf(state: GameState, pokemon: InPlayPokemon): number {
  const installed = pokemon.attackDamageDebuff;
  return installed === null || installed.turn !== state.turn ? 0 : installed.amount;
}

/**
 * §9: the attack-installed recoil on whatever damages `pokemon`, or 0. Live only while its turn
 * stamp equals the current turn. A floor of 0 means "equal to the damage done to this Pokémon", so
 * `damageTaken` is required. Callers add it to the `passivesOf` recoil; kept out of `passivesOf` so
 * a §9 lock cannot remove it.
 */
export function installedRecoilOf(
  state: GameState,
  pokemon: InPlayPokemon,
  damageTaken: number,
): number {
  const installed = pokemon.installedRecoil;
  if (installed === null || installed.turn !== state.turn) return 0;
  // `amount` is a floor, so a body with both the flat and the damage-equal recoil never pays less
  // than the flat amount.
  return installed.ofDamageTaken === true
    ? Math.max(installed.amount, damageTaken)
    : installed.amount;
}

/**
 * §9 watched-Active recoil (Spiritomb "Spiteful Swirl", Wishiwashi "Counterattack Grouping"): the
 * HP each live holder on `seat` makes the Attacking Pokémon pay because `damaged`, that seat's
 * Active, was damaged by an attack. Holders may be Active or Benched, each pays its own amount, and
 * §9 applies per holder. It is all Ability damage, so Luminous Wing refuses it.
 */
export function watchedRecoilOf(state: GameState, seat: Seat, damaged: InPlayPokemon): number {
  const side = state.players[seat];
  const watched = inPlayCardOf(state, damaged);
  if (watched === undefined) return 0;
  const disabled = disabledAbilityUids(state);
  let total = 0;
  for (const holder of inPlayOf(side)) {
    const uid = topUid(holder);
    if (uid === undefined || disabled.has(uid)) continue;
    const top = topCardOf(state, holder);
    const recoil =
      top === undefined ? undefined : programFor(top.id)?.passive?.damageAttackerWatched;
    if (recoil === undefined) continue;
    if (recoil.activeType !== undefined && !(watched.types ?? []).includes(recoil.activeType))
      continue;
    if (recoil.activeNames !== undefined && !recoil.activeNames.includes(watched.name)) continue;
    total += recoil.amount;
  }
  return total;
}

/**
 * `passives` with `watchedRecoilOf` added to both `damageAttacker` and `damageAttackerFromAbility`.
 * Returns the same object when nothing watches.
 */
export function withWatchedRecoil<
  P extends { damageAttacker: number; damageAttackerFromAbility: number },
>(state: GameState, seat: Seat, damaged: InPlayPokemon, passives: P): P {
  const watched = watchedRecoilOf(state, seat, damaged);
  if (watched === 0) return passives;
  return {
    ...passives,
    damageAttacker: passives.damageAttacker + watched,
    damageAttackerFromAbility: passives.damageAttackerFromAbility + watched,
  };
}

/**
 * §12: the Special Conditions a body keeps when it evolves or devolves. None, except Confused (with
 * its `confusionDamage`) while Dizzying Valley is in play. Not §9-gated, since a Stadium is not an
 * Ability.
 */
export function stageChangeConditions(
  state: GameState,
  conditions: SpecialConditions,
): SpecialConditions {
  if (
    stadiumEffectsOf(state)?.confusionSurvivesStageChange !== true ||
    conditions.rotation !== "confused"
  ) {
    return noConditions();
  }
  return { ...noConditions(), rotation: "confused", confusionDamage: conditions.confusionDamage };
}

/**
 * §8/§11: is `pokemon` barred from attacking right now ("During your next turn, this Pokémon can't
 * attack." or a side-wide lock)? Live only while the stamp equals the current turn. The side lock
 * is checked first.
 */
export function attackLocked(state: GameState, pokemon: InPlayPokemon): boolean {
  // The side-wide lock is checked against the body at the moment it is asked, so bodies that arrive
  // later are covered and the Energy count is live.
  if (sideAttackLockHolds(state, seatOfPokemon(state, pokemon), pokemon)) return true;
  // No defensive `=== undefined` arm, for `attackBlockOf`'s reason one function
  // up: the field is REQUIRED and an older record is retired by
  // MATCH_RECORD_VERSION rather than read benignly here.
  return pokemon.attackLockedTurn === state.turn;
}

/**
 * §8/§11: does `seat`'s live side-wide attack lock hold `pokemon`? `maxEnergy` null locks every
 * body; otherwise only bodies with at most that many Energy cards attached (cards, not units),
 * counted live. An undefined seat answers false.
 */
function sideAttackLockHolds(
  state: GameState,
  seat: Seat | undefined,
  pokemon: InPlayPokemon,
): boolean {
  if (seat === undefined) return false;
  const lock = state.players[seat].sideAttackLock;
  if (lock === null || lock.turn !== state.turn) return false;
  return lock.maxEnergy === null || countAttachedEnergy(state, pokemon, null) <= lock.maxEnergy;
}

/**
 * §8.2/§11: the attack-installed cost tax on `pokemon` in {C}, or 0 ("attacks used by the Defending
 * Pokémon cost {C} more, and its Retreat Cost is {C} more"). Applied in both `effectiveAttackCost`
 * and `effectiveRetreatCost` so the two halves cannot diverge.
 */
export function installedCostTaxOf(state: GameState, pokemon: InPlayPokemon): number {
  return pokemon.costTaxTurn === state.turn ? 1 : 0;
}

/**
 * §8/§11: is `pokemon` under a flip-to-attack lock ("if the Defending Pokémon tries to use an
 * attack, your opponent flips a coin. If tails, that attack doesn't happen.")? Must not be folded
 * into `attackLocked`: the attack stays declarable and only a tails stops it.
 */
export function attackFlipLocked(state: GameState, pokemon: InPlayPokemon): boolean {
  return pokemon.attackFlipLockTurn === state.turn;
}

/**
 * §8/§11: how many coins `pokemon`'s declared attack must survive: 1 for a flip lock, 2 for a Jet
 * of Ink lock, summed when both are live. 0 means no lock and no RNG draw.
 */
export function attackFlipLockCoins(state: GameState, pokemon: InPlayPokemon): number {
  return (
    (attackFlipLocked(state, pokemon) ? 1 : 0) +
    (pokemon.attackTwoFlipLockTurn === state.turn ? 2 : 0)
  );
}

/**
 * §11: is `pokemon` unable to retreat right now? Combines the opponent-imposed lock, the
 * self-installed stamp, an Antique Fossil's card rule and the side-wide lock so every caller asks
 * one function. The two lock fields use different clocks on purpose. Not a cost, so it is not
 * folded into `effectiveRetreatCost`.
 */
export function retreatLocked(state: GameState, pokemon: InPlayPokemon): boolean {
  // Antique Fossil's card rule "…and can't retreat." applies to the top card only, and no lock
  // lifts it.
  if (isFossilTop(state, pokemon)) return true;
  // Roxie's Performance side lock, checked against the body's current conditions.
  if (sideRetreatLocked(state, pokemon)) return true;
  return pokemon.retreatBlocked || pokemon.retreatLockedTurn === state.turn;
}

/**
 * §11: is `pokemon` locked by its side's live `sideRetreatLock` (Roxie's Performance)? The stamp
 * must be the current turn and the body must have the printed Special Condition now (`poisonDamage
 * > 0` means Poisoned).
 */
export function sideRetreatLocked(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined || pokemon.conditions.poisonDamage <= 0) return false;
  for (const seat of SEATS) {
    const side = state.players[seat];
    const lock = side.sideRetreatLock;
    if (lock === null || lock.turn !== state.turn) continue;
    const onSide =
      (side.active !== null && topUid(side.active) === uid) ||
      side.bench.some((b) => topUid(b) === uid);
    if (onSide) return true;
  }
  return false;
}

/**
 * §4: is `pokemon` barred from attacking by the first-turn ban? True on turn 1 unless the body's
 * Ability licenses it (Meloetta ex "Debut Performance"). Uses `state.turn === 1`, not
 * `isFirstTurnOf`: only the player going first is banned.
 */
export function firstTurnAttackBanned(
  state: GameState,
  pokemon: InPlayPokemon,
  index: number,
): boolean {
  if (state.turn !== 1) return false;
  // Through `passivesOf` rather than off `top` directly: the licence is a printed
  // ABILITY, so a §9 Ability-lock (Klefki `sv01-096`) must silence it and hand the
  // ban back. Reading the catalog row here would be shorter and would get that
  // wrong silently — `cantAttackUnless`'s rule, mirrored.
  if (passivesOf(state, pokemon).attackFirstTurnExempt) return false;
  // The per-attack licence ("If you go first, you can use this attack during your first turn.") is
  // read from the attack gate, not `passivesOf`, because attack text is not affected by §9 locks.
  return attackGateOf(state, pokemon, index)?.kind !== "firstTurnExempt";
}

/**
 * §4/§8: the printed attack gate on the attack at menu `index`, or undefined. Read from the menu
 * row's source card, not through `passivesOf`, because it is attack text and §9 locks only
 * Abilities. Registry rows take precedence; otherwise the gate is derived from that attack's own
 * text. Out-of-range indexes return undefined.
 */
export function attackGateOf(
  state: GameState,
  pokemon: InPlayPokemon,
  index: number,
): AttackTimingGate | undefined {
  // `index` is the flat menu index; the gate is looked up on the card the attack is printed on, at
  // its own index there. A body not in play has no seat, so its menu is its printed attacks.
  const entry = attackMenuOf(state, seatOfPokemon(state, pokemon), pokemon)[index];
  if (entry === undefined) return undefined;
  const authored = programFor(entry.card.id)?.attackGate?.[entry.sourceIndex];
  return authored ?? timingGateFromAttackText(entry.attack.effect);
}

/**
 * One row of a body's attack menu: the attack, the card it is printed on, its index on that card,
 * and which section offered it.
 */
export interface AttackMenuEntry {
  attack: Attack;
  /** The card the attack is printed on: the top card (`"printed"`), a card UNDER it
      (`"memoryDive"`), or an attached Tool (`"tool"`). Its program (`attack`, `attackGate`)
      is keyed by `sourceIndex`. */
  card: Card;
  /** The attack's index on `card`. Never persisted; borrowed rows are locked by name instead. */
  sourceIndex: number;
  origin: "printed" | "memoryDive" | "tool" | "memoryHelix";
}

/**
 * §9: is Relicanth "Memory Dive" live for `seat` (a body whose top card has it and is not
 * Ability-locked)? Multiple Relicanth do not stack.
 */
export function memoryDiveLive(state: GameState, seat: Seat): boolean {
  const side = state.players[seat];
  const bodies = inPlayOf(side);
  return bodies.some((body) => {
    const top = topCardOf(state, body);
    if (top === undefined || programFor(top.id)?.passive?.memoryDive !== true) return false;
    const uid = topUid(body);
    return uid !== undefined && !disabledAbilityUids(state).has(uid);
  });
}

/**
 * §8: `pokemon`'s attack menu in one flat order whose index is `AttackAction.index`. Printed
 * attacks come first so their indexes are stable; then Memory Dive attacks from cards under the top
 * (evolved bodies only); then attacks granted by in-effect Tools. Only printed indexes are
 * persisted, since later sections can change.
 */
export function attackMenuOf(
  state: GameState,
  seat: Seat | undefined,
  pokemon: InPlayPokemon,
): AttackMenuEntry[] {
  const top = topCardOf(state, pokemon);
  if (top === undefined) return [];
  const menu: AttackMenuEntry[] = attacksOf(top).map((attack, sourceIndex) => ({
    attack,
    card: top,
    sourceIndex,
    origin: "printed",
  }));
  if (seat !== undefined && pokemon.stack.length > 1 && memoryDiveLive(state, seat)) {
    for (const uid of pokemon.stack.slice(0, -1)) {
      const lower = cardOfUid(state, uid);
      if (lower === undefined) continue;
      attacksOf(lower).forEach((attack, sourceIndex) => {
        menu.push({ attack, card: lower, sourceIndex, origin: "memoryDive" });
      });
    }
  }
  for (const toolUid of toolsInEffect(state, pokemon)) {
    const tool = cardOfUid(state, toolUid);
    const granted =
      tool === undefined || programFor(tool.id)?.toolAttacks !== true
        ? undefined
        : (tool.attacks ?? undefined);
    if (tool === undefined || granted === undefined) continue;
    // Core Memory: "The Mega Zygarde ex this card is attached to" checks the holder's top card.
    const holderGate = programFor(tool.id)?.toolAttacksHolder;
    if (holderGate !== undefined && !matchesFilter(top, holderGate)) continue;
    granted.forEach((attack, sourceIndex) => {
      menu.push({ attack, card: tool, sourceIndex, origin: "tool" });
    });
  }
  // Mew ex "Memory Helix": the printed attacks of the seat's other Benched Pokémon, in Bench order,
  // excluding copy attacks. A body not in play gets none.
  const helixUid = topUid(pokemon);
  if (
    seat !== undefined &&
    programFor(top.id)?.passive?.memoryHelix === true &&
    helixUid !== undefined &&
    !disabledAbilityUids(state).has(helixUid)
  ) {
    for (const benched of state.players[seat].bench) {
      if (benched === pokemon) continue;
      const card = topCardOf(state, benched);
      if (card === undefined) continue;
      attacksOf(card).forEach((attack, sourceIndex) => {
        if (!COPY_FAMILY_MARKER.test(attack.effect ?? ""))
          menu.push({ attack, card, sourceIndex, origin: "memoryHelix" });
      });
    }
  }
  return menu;
}

/**
 * §8/§11: the indexes of `pokemon`'s attacks that are barred right now ("During your next turn,
 * this Pokémon can't use {AttackName}."). Entries are live while their turn stamp equals the
 * current turn, except `until: "leavesActive"` entries, which last until §10 clears the list.
 * Returns indexes because callers map over all attacks.
 */
export function lockedAttackIndexes(state: GameState, pokemon: InPlayPokemon): number[] {
  // An `until: "leavesActive"` entry has no window; its `turn` is only the install turn. Name-keyed
  // entries (`attackIndex: -1`) are handled by `lockedAttackNames`.
  return liveLockedAttacks(state, pokemon)
    .filter((locked) => locked.attackName === undefined)
    .map((locked) => locked.attackIndex);
}

/** The live entries of `pokemon.lockedAttacks`, so both readers share the window rule. */
function liveLockedAttacks(state: GameState, pokemon: InPlayPokemon): LockedAttack[] {
  return pokemon.lockedAttacks.filter(
    (locked) => locked.until === "leavesActive" || locked.turn === state.turn,
  );
}

/**
 * §8/§11: names of attacks `pokemon` is barred from by name-keyed entries (a lock from a Memory
 * Dive or Technical Machine row the holder does not print). Callers bar any menu row whose
 * `attack.name` is listed.
 */
export function lockedAttackNames(state: GameState, pokemon: InPlayPokemon): string[] {
  return liveLockedAttacks(state, pokemon).flatMap((locked) =>
    locked.attackName === undefined ? [] : [locked.attackName],
  );
}

/**
 * §8.5/§11: the attack-installed buff to the attack at `index`, or 0. A null-index record buffs
 * every attack. Read only at the main hit, which knows the declared index. Summed at the site
 * rather than folded into `attackerPreWRBonus` so a §9 lock cannot remove it.
 */
export function boostedAttackDamage(
  state: GameState,
  pokemon: InPlayPokemon,
  index: number,
): number {
  const boost = pokemon.boostedAttack;
  // A null index is the all-attacks buff and pays on every index. The compiler cannot catch
  // dropping this check.
  return boost === null ||
    boost.turn !== state.turn ||
    (boost.attackIndex !== null && boost.attackIndex !== index)
    ? 0
    : boost.amount;
}

/**
 * §8.5: the all-attacks buff on `pokemon` ("attacks used by this Pokémon do 120 more damage to your
 * opponent's Active Pokémon"), or 0. Separate reader because `snipeActive` has no attack index. A
 * named record answers 0. Immune to §9 because it reads an installation.
 */
export function everyAttackBoostOf(state: GameState, pokemon: InPlayPokemon): number {
  const boost = pokemon.boostedAttack;
  return boost === null || boost.turn !== state.turn || boost.attackIndex !== null
    ? 0
    : boost.amount;
}

/**
 * §8.5: this turn's side-wide pre-Weakness bonus for `seat`'s attack against `defenderCard`, or 0
 * (Black Belt's Training). Read straight off state because a Trainer's installation is not affected
 * by §9 locks. Pays 0 unless `seat` owns the turn. Matching sources are summed.
 */
export function sideAttackBonusThisTurn(
  state: GameState,
  seat: Seat,
  defenderCard: Card | undefined,
  /**
   * The attacking body, matched on its in-play card for an entry's `attacker` filter. Null fails
   * every attacker filter and passes an entry without one.
   */
  attackerBody: InPlayPokemon | null,
): number {
  if (phaseViewOf(state, seat).activeSeat !== seat) return 0;
  const attackerCard = attackerBody === null ? undefined : inPlayCardOf(state, attackerBody);
  let total = 0;
  for (const bonus of state.allowances.sideAttackBonuses) {
    if (bonus.attacker !== undefined && !matchesFilter(attackerCard, bonus.attacker)) continue;
    if (matchesFilter(defenderCard, bonus.target)) total += bonus.amount;
  }
  return total;
}

/**
 * §8.5: the base damage an attack-installed override gives the attack at `index` ("this Pokémon's
 * Hyper Fang attack's base damage is 240"), or null when none. Null rather than 0 because 0 could
 * be a printed base. Applied before Weakness and Resistance; immune to §9.
 */
export function boostedAttackBase(
  state: GameState,
  pokemon: InPlayPokemon,
  index: number,
): number | null {
  const boost = pokemon.boostedAttack;
  if (boost === null || boost.turn !== state.turn || boost.attackIndex !== index) return null;
  return boost.base ?? null;
}

/**
 * §8.5: does `pokemon`'s attack damage ignore effects on the opponent's Active (Walking Wake ex
 * "Azure Seas")? Covers only the Ability; the attack-text version is parsed separately and combined
 * in attack.ts. This half is §9-suppressible.
 */
export function attackerSuppressesTargetEffects(state: GameState, pokemon: InPlayPokemon): boolean {
  return passivesOf(state, pokemon).suppressTargetEffectsOnAttack;
}

/**
 * §8.1: the max HP `pokemon`'s side grants via a seat-wide aura (Ludicolo "Vibrant Dance": "All of
 * your Pokémon in play get +40 HP. The effect of Vibrant Dance doesn't stack."). Includes the
 * source itself. Non-stacking is a per-Ability-name `Math.max`, so two Ludicolo give +40. A §9 lock
 * removes it.
 */
export function seatMaxHpBonus(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = inPlayOf(side);
    // The TARGET clause: "ALL of your Pokémon in play" — Active and Bench alike,
    // so membership on this side is the whole of it.
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    let bonus = 0;
    const capped = new Map<string, number>();
    for (const holder of holders) {
      const top = topCardOf(state, holder);
      const aura = top === undefined ? undefined : programFor(top.id)?.passive?.seatHpBonus;
      if (aura === undefined) continue;
      const sourceUid = topUid(holder);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9
      if (aura.noStack !== true) {
        bonus += aura.amount;
        continue;
      }
      capped.set(aura.ability, Math.max(capped.get(aura.ability) ?? 0, aura.amount));
    }
    for (const amount of capped.values()) bonus += amount;
    return bonus; // this is the Pokémon's own side — no other side can raise it
  }
  return 0;
}

/**
 * §7.3/§8.1: the Stadium's change to `top`'s max HP (Lively Stadium +30 to Basics, Gravity Mountain
 * −30 to Stage 2). Applies to both sides and ignores §9 locks.
 */
function stadiumHpDelta(state: GameState, top: Card): number {
  const delta = stadiumEffectsOf(state)?.hpDelta;
  if (delta === undefined) return 0;
  // Ange Floette's "Each Mega Floette ex": the name filter.
  if (delta.name !== undefined && top.name !== delta.name) return 0;
  const matches = delta.stage === "basic" ? isBasicPokemon : isStage2Pokemon;
  return matches(top) ? delta.amount : 0;
}

/**
 * §8.1 max HP for KO checks and the HUD: printed HP plus the body's own bonuses, its side's auras
 * and the Stadium. A null printed HP stays null, and a data gap never KOs. Floored so the result is
 * never non-positive, which `koSurvivalClamp` relies on.
 */
export function effectiveMaxHp(state: GameState, pokemon: InPlayPokemon): number | null {
  const top = topCardOf(state, pokemon);
  // Two early returns because `stadiumHpDelta` needs the card and TypeScript cannot narrow `top`
  // from the derived null check.
  if (top === undefined) return null;
  const hp = hpOf(top);
  if (hp === null) return null;
  const { hpBonus } = passivesOf(state, pokemon);
  return Math.max(
    MIN_EFFECTIVE_MAX_HP,
    hp + hpBonus + seatMaxHpBonus(state, pokemon) + stadiumHpDelta(state, top),
  );
}

/**
 * The single "damage ≥ max HP" Knock Out test (§8.1/§13), using continuous max HP. A missing HP
 * never KOs. Lives here so interpreter.ts can use it; flow.ts re-exports it.
 */
export function isLethallyDamaged(state: GameState, pokemon: InPlayPokemon): boolean {
  const hp = effectiveMaxHp(state, pokemon);
  return hp !== null && pokemon.damage >= hp;
}

/**
 * The printed "N HP or less remaining" predicate, shared by abilities, gust and heal filters.
 * Remaining HP is `effectiveMaxHp − damage`. A null max fails. Undamaged bodies are not excluded.
 */
export function remainingHpWithin(
  state: GameState,
  pokemon: InPlayPokemon,
  atMost: number,
): boolean {
  const max = effectiveMaxHp(state, pokemon);
  if (max === null) return false;
  return max - pokemon.damage <= atMost;
}

/**
 * §6.3/§6.4: the energy units a Pokémon's attached energies provide toward attack costs. Basic
 * energy provides its type; an authored Special provides its program's units (with Luminous's "{C}
 * instead if another Special Energy is attached" checked against the other energies); an unauthored
 * Special provides one Colorless. Shared by the cost check and the HUD so they cannot drift.
 */
export function providedEnergy(state: GameState, pokemon: InPlayPokemon): string[] {
  // Which attached energies are Special — for Luminous's "any OTHER Special
  // Energy attached" condition. Resolved once against the live board, then
  // shared by every unit lookup below (the condition is about the HOLDER, so it
  // is the same question for all of them).
  const specialUids = specialEnergyUids(state, pokemon);
  return pokemon.energy.flatMap((uid) => unitsOf(state, pokemon, uid, specialUids));
}

/** The units ONE attached Energy provides, on the Pokémon it is attached to —
    the per-card half of `providedEnergy` above, split out so the `providesEnergy`
    CardFilter (interpreter.ts) reads provision through the SAME code the §8.2
    cost matcher does. Two readers of one rule: an Energy that can pay a {L} cost
    is exactly an Energy a "discard a {L} Energy" effect may take, and letting
    those two drift would let a Kilowattrel pay {L} with a card the very same
    attack then refuses to discard. */
export function unitsProvidedBy(state: GameState, pokemon: InPlayPokemon, uid: string): string[] {
  return unitsOf(state, pokemon, uid, specialEnergyUids(state, pokemon));
}

/**
 * §6.1: may Energy `card` sit on `holder`? False only when `EnergyProgram.attachOnlyToOwner` names
 * an owner the holder's top card lacks (Team Rocket's Energy). Shared by the attach refusal, the
 * misplaced-energy sweep and `unitsOf`, where a misplaced card provides nothing.
 */
export function energyMayBeAttachedTo(
  state: GameState,
  card: Card | undefined,
  holder: InPlayPokemon,
): boolean {
  const owner = card === undefined ? undefined : programFor(card.id)?.energy?.attachOnlyToOwner;
  return (
    owner === undefined || matchesFilter(topCardOf(state, holder), { kind: "ownerPokemon", owner })
  );
}

/** Does `uid`, attached to `pokemon`, provide `energyType` (§6.3)? The
    `providesEnergy` filter's predicate.

    A WILDCARD provider matches every type: Luminous Energy "provides every type
    of Energy but only 1 at a time", so it IS a {L} Energy for a card that asks
    for one — the same ANY_ENERGY unit costMet lets fill any typed slot. And
    because provision is read on the HOST, the answer genuinely moves with the
    board: that same Luminous provides only {C} once another Special Energy joins
    it, and stops being a {L} Energy at all. */
export function providesEnergyType(
  state: GameState,
  pokemon: InPlayPokemon,
  uid: string,
  energyType: string,
): boolean {
  const units = unitsProvidedBy(state, pokemon, uid);
  // Or a constrained unit whose set includes the type (Team Rocket's Energy counts as {P} and {D}).
  // Asked per card, so the two units count the card once.
  return (
    units.includes(energyType) ||
    units.includes(ANY_ENERGY) ||
    units.some((unit) => constrainedEnergyTypes(unit)?.includes(energyType) === true)
  );
}

/**
 * §6.3: does `pokemon` have any attached Energy of `energy`? Types are read by provision, matching
 * the cost check. `"special"` is the card class.
 */
export function hasAttachedEnergy(
  state: GameState,
  pokemon: InPlayPokemon,
  energy: BasicEnergyType | "special" | "basic" | "any",
): boolean {
  // Untyped clause ("if this Pokémon has any Energy attached"): any attached Energy card.
  if (energy === "any") return pokemon.energy.length > 0;
  if (energy === "basic") return basicEnergyUids(state, pokemon).length > 0;
  if (energy === "special") return specialEnergyUids(state, pokemon).length > 0;
  return pokemon.energy.some((uid) => providesEnergyType(state, pokemon, uid, energy));
}

/**
 * §6.3: how many Energy cards are attached to `pokemon`, optionally filtered by type. Typed counts
 * read by provision, like `hasAttachedEnergy`. `energy: null` counts cards, not units.
 */
export function countAttachedEnergy(
  state: GameState,
  pokemon: InPlayPokemon,
  energy: BasicEnergyType | "special" | "basic" | null,
): number {
  if (energy === null) return pokemon.energy.length;
  // Basic Energy cards: `null` also counts Specials, and `"special"` counts only Specials.
  if (energy === "basic") return basicEnergyUids(state, pokemon).length;
  if (energy === "special") return specialEnergyUids(state, pokemon).length;
  return pokemon.energy.filter((uid) => providesEnergyType(state, pokemon, uid, energy)).length;
}

/**
 * §8.1: which seat has `pokemon` in play, or undefined when no board has its uid. Undefined rather
 * than a default so callers cannot read the wrong side.
 */
function seatOfPokemon(state: GameState, pokemon: InPlayPokemon): Seat | undefined {
  const uid = topUid(pokemon);
  if (uid === undefined) return undefined;
  return SEATS.find((seat) => {
    const side = state.players[seat];
    const holders = inPlayOf(side);
    return holders.some((holder) => topUid(holder) === uid);
  });
}

/**
 * §8.1: the multiplier for `PassiveEffects.hpBonusPer`, never negative. An unresolvable seat
 * answers 0.
 */
function maxHpScaleCount(state: GameState, pokemon: InPlayPokemon, scale: MaxHpScale): number {
  switch (scale.kind) {
    case "attachedEnergy":
      return countAttachedEnergy(state, pokemon, scale.energyType);
    case "opponentPrizesTaken": {
      const seat = seatOfPokemon(state, pokemon);
      return seat === undefined ? 0 : takenPrizes(state, otherSeat(seat));
    }
  }
}

/**
 * §6.3: how many Energy cards of `energy` are in play on `seat`'s side (Active and Bench). Counts
 * cards, not units, and reads type by provision on each holder. `energy: null` counts every card.
 * The optional `filter` selects holder bodies by their top card; it filters Pokémon, not Energy
 * cards.
 */
export function countEnergyInPlay(
  state: GameState,
  seat: Seat,
  energy: BasicEnergyType | "special" | "basic" | null,
  filter?: CardFilter,
): number {
  const side = state.players[seat];
  const holders = inPlayOf(side);
  let total = 0;
  for (const holder of holders) {
    // The in-play card, so a type filter reads the body's current types.
    if (filter !== undefined && !matchesFilter(inPlayCardOf(state, holder), filter)) continue;
    if (energy === null) {
      total += holder.energy.length;
      continue;
    }
    // Basic Energy category, using the same `basicEnergyUids` as the per-body counter. This is a
    // card category on `energy`, not the body `filter`.
    if (energy === "basic") {
      total += basicEnergyUids(state, holder).length;
      continue;
    }
    total +=
      energy === "special"
        ? specialEnergyUids(state, holder).length
        : holder.energy.filter((uid) => providesEnergyType(state, holder, uid, energy)).length;
  }
  return total;
}

/**
 * How many Pokémon Tools are attached across `seat`'s Active and Bench. Sums the arrays, since a
 * body can hold more than one Tool (Revavroom ex "Tune-Up").
 */
export function countToolsInPlay(state: GameState, seat: Seat): number {
  const side = state.players[seat];
  const holders = inPlayOf(side);
  let total = 0;
  for (const holder of holders) total += holder.tools.length;
  return total;
}

/**
 * How many different Basic Energy types are attached across `seat`'s Pokémon (Sylveon ex "Colorful
 * Harmony"). `energyProvidesOf` names a type only for a parsed Basic Energy card, so Specials and
 * unparsed Basics add none.
 */
export function countBasicEnergyTypesInPlay(state: GameState, seat: Seat): number {
  const side = state.players[seat];
  const holders = inPlayOf(side);
  const types = new Set<string>();
  for (const holder of holders) {
    for (const uid of holder.energy) {
      const card = cardOfUid(state, uid);
      const provided = card === undefined ? "Colorless" : energyProvidesOf(card);
      if (provided !== "Colorless") types.add(provided);
    }
  }
  return types.size;
}

/**
 * How many damage counters are on `seat`'s Active and Bench. Floored per body before summing, so 15
 * + 15 damage is 2 counters, not 3.
 */
export function countDamageCountersInPlay(state: GameState, seat: Seat): number {
  const side = state.players[seat];
  const holders = inPlayOf(side);
  let total = 0;
  for (const holder of holders) total += damageCountersOn(holder);
  return total;
}

/** The attached Energy that are SPECIAL — the context Luminous's "any other
    Special Energy attached" clause is evaluated against. */
function specialEnergyUids(state: GameState, pokemon: InPlayPokemon): string[] {
  return pokemon.energy.filter((uid) => {
    const card = cardOfUid(state, uid);
    return card !== undefined && isSpecialEnergy(card);
  });
}

/**
 * Which attached uids are Basic Energy cards (§6.1), the complement of `specialEnergyUids`.
 * Delegates to `matchesFilter`'s `basicEnergy` arm. This is about the card class, not about
 * providing a basic type. Missing cards are not counted.
 */
function basicEnergyUids(state: GameState, pokemon: InPlayPokemon): string[] {
  return pokemon.energy.filter((uid) => matchesFilter(cardOfUid(state, uid), BASIC_ENERGY_CARD));
}

/** The one `CardFilter` value `basicEnergyUids` asks with, hoisted to a module
    constant so the allocation does not sit inside a `.filter` callback and so the
    noun has exactly one spelling in this file. */
const BASIC_ENERGY_CARD: CardFilter = { kind: "basicEnergy" };

/**
 * Does the side that controls `pokemon` have strictly more Prize cards remaining than its opponent
 * (i.e. it is behind)? Read here rather than through `conditionHolds` because boardCondition.ts
 * imports this file. A holder with no top card matches no seat and answers false.
 */
function holderSideLeadsOnPrizesRemaining(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = inPlayOf(side);
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    return side.prizes.length > state.players[otherSeat(seat)].prizes.length;
  }
  return false;
}

/**
 * The Basic Energy type a live Meganium "Wild Growth" doubles on `pokemon`'s side, or `undefined`.
 * The first unlocked holder answers, so several holders double only once ("doesn't stack").
 */
function doubledBasicEnergyType(
  state: GameState,
  pokemon: InPlayPokemon,
): BasicEnergyType | undefined {
  const seat = seatOfPokemon(state, pokemon);
  if (seat === undefined) return undefined;
  const side = state.players[seat];
  for (const holder of inPlayOf(side)) {
    const top = topCardOf(state, holder);
    const doubled =
      top === undefined ? undefined : programFor(top.id)?.passive?.basicEnergyProvidesTwice;
    if (doubled === undefined) continue;
    const uid = topUid(holder);
    if (uid !== undefined && disabledAbilityUids(state).has(uid)) continue; // §9
    return doubled;
  }
  return undefined;
}

/**
 * The live Goodra "Slimy Sliding" on the opposing side that flips for `seat`'s retreat, or
 * `undefined`. The first unlocked holder answers, so only one coin is flipped ("doesn't stack").
 * Asked only after every other retreat check has passed.
 */
export function retreatCoinFlipSource(
  state: GameState,
  seat: Seat,
): { uid: string; ability: string } | undefined {
  const side = state.players[otherSeat(seat)];
  for (const holder of inPlayOf(side)) {
    const top = topCardOf(state, holder);
    const ability =
      top === undefined ? undefined : programFor(top.id)?.passive?.retreatFailsOnTails;
    const uid = topUid(holder);
    if (ability === undefined || uid === undefined) continue;
    if (disabledAbilityUids(state).has(uid)) continue; // §9
    return { uid, ability };
  }
  return undefined;
}

function unitsOf(
  state: GameState,
  pokemon: InPlayPokemon,
  uid: string,
  specialUids: readonly string[],
): string[] {
  const card = cardOfUid(state, uid);
  if (card === undefined) return ["Colorless"]; // unresolved uid — the conservative unit
  const program = programFor(card.id)?.energy;
  // Basic energy → its type; an unauthored special energy → Colorless.
  if (program === undefined) {
    const provided = energyProvidesOf(card);
    return provided !== "Colorless" && doubledBasicEnergyType(state, pokemon) === provided
      ? [provided, provided]
      : [provided];
  }
  // A restricted Energy on a Pokémon it may not be attached to provides nothing.
  if (!energyMayBeAttachedTo(state, card, pokemon)) return [];
  const demote = program.demoteWithOtherSpecial;
  if (demote !== undefined && specialUids.some((other) => other !== uid)) return [...demote];
  const promote = program.promoteOnHolderStage;
  if (promote !== undefined) {
    // The printed stage word lives on the holder's TOP card (§1.2 — a Pokémon's
    // identity is its top card), which is what makes this read move with an evolve.
    const top = topCardOf(state, pokemon);
    const matches =
      promote.stage === "Basic"
        ? isBasicPokemon
        : promote.stage === "Stage2"
          ? isStage2Pokemon
          : isEvolutionPokemon;
    if (
      top !== undefined &&
      matches(top) &&
      // Absent riders leave the stage gate ungated.
      (promote.noRuleBox !== true || !hasRuleBox(top)) &&
      (promote.whileMorePrizesRemaining !== true ||
        holderSideLeadsOnPrizesRemaining(state, pokemon))
    )
      return [...promote.units];
  }
  return [...program.provides];
}

/**
 * §11: is `pokemon`'s Retreat Cost zeroed by an own-side aura (Clefable ex "Lunar Zone", Latias ex
 * "Skyliner")? Any unlocked Pokémon on the same side can be the source, itself included. The energy
 * and stage clauses are read against the target's top card, not the holder's.
 */
export function hasFreeRetreatAura(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  const targetTop = topCardOf(state, pokemon);
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = inPlayOf(side);
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    for (const holder of holders) {
      const top = topCardOf(state, holder);
      const aura = top === undefined ? undefined : programFor(top.id)?.passive?.noRetreatCostAura;
      if (aura === undefined) continue;
      const sourceUid = topUid(holder);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue;
      if (aura.stage === "Basic" && (targetTop === undefined || !isBasicPokemon(targetTop)))
        continue;
      const required = aura.requiresEnergyType;
      if (
        required !== undefined &&
        !pokemon.energy.some((energyUid) => providesEnergyType(state, pokemon, energyUid, required))
      )
        continue;
      return true;
    }
    return false; // this is the Pokémon's own side — no other side can free it
  }
  return false;
}

/**
 * §11: the {C} added to `pokemon`'s Retreat Cost by opposing auras (Spidops ex "Trap Territory",
 * Ariados "Big Net"). Only an Active target is surcharged, but sources may be on the Bench; sources
 * are summed, and an optional `target` filter is matched against the target's top card.
 */
export function opposingRetreatSurcharge(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  const targetTop = inPlayCardOf(state, pokemon);
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause: only the side's Active is surcharged, so a benched
    // holder of this uid is out even though it belongs to this side.
    if (side.active === null || topUid(side.active) !== uid) continue;
    const foes = state.players[otherSeat(seat)];
    const sources = inPlayOf(foes);
    let added = 0;
    for (const source of sources) {
      const top = topCardOf(state, source);
      const aura =
        top === undefined ? undefined : programFor(top.id)?.passive?.opponentActiveRetreatSurcharge;
      if (aura === undefined) continue;
      const sourceUid = topUid(source);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue;
      if (aura.target !== undefined && !matchesFilter(targetTop, aura.target)) continue;
      added += aura.amount;
    }
    return added;
  }
  return 0;
}

/**
 * §11: the {C} subtracted from `pokemon`'s Retreat Cost by its own side's auras (Toedscruel "Secret
 * Forest Path"). Returns a non-negative discount that `effectiveRetreatCost` subtracts inside its
 * floored sum; sources are summed.
 */
export function alliedRetreatDiscount(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause: "your Active Pokémon's Retreat Cost", so a benched
    // holder of this uid is out even though it belongs to this side.
    if (side.active === null || topUid(side.active) !== uid) continue;
    const sources = [side.active, ...side.bench];
    let discount = 0;
    for (const source of sources) {
      const top = topCardOf(state, source);
      const aura =
        top === undefined ? undefined : programFor(top.id)?.passive?.ownActiveRetreatDiscount;
      if (aura === undefined) continue;
      const sourceUid = topUid(source);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue;
      if (aura.sourceOnBench === true && !isOnBench(state, source)) continue;
      discount += aura.amount;
    }
    return discount;
  }
  return 0;
}

/**
 * §11: is `pokemon` prevented from retreating by the opposing Active's Ability (Snorlax "Block")?
 * Both source and target must be Active. Read at the retreat gate rather than folded into the cost.
 */
export function opposingRetreatBlocked(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause: only this side's Active is blocked, so a benched holder
    // of this uid is out even though it belongs to this side.
    if (side.active === null || topUid(side.active) !== uid) continue;
    // The SOURCE clause: the opponent's Active Spot and nowhere else.
    const source = state.players[otherSeat(seat)].active;
    if (source === null) return false;
    const top = topCardOf(state, source);
    if (top === undefined || programFor(top.id)?.passive?.preventOpponentActiveRetreat !== true) {
      return false;
    }
    const sourceUid = topUid(source);
    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) return false;
    return true;
  }
  return false;
}

/**
 * §8.5: damage taken off `pokemon`'s attacks before Weakness and Resistance by the opposing
 * Active's Ability (Entei "Pressure"). Both source and target must be Active, and an Ability lock
 * silences it.
 */
export function opposingAttackDebuff(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause: only this side's Active is weakened, so a benched holder
    // of this uid is out even though it belongs to this side.
    if (side.active === null || topUid(side.active) !== uid) continue;
    // The SOURCE clause: the opponent's Active Spot and nowhere else.
    const source = state.players[otherSeat(seat)].active;
    if (source === null) return 0;
    const top = topCardOf(state, source);
    const amount =
      top === undefined ? undefined : programFor(top.id)?.passive?.opponentActiveAttackDebuff;
    if (amount === undefined) return 0;
    const sourceUid = topUid(source);
    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) return 0; // §9
    return amount;
  }
  return 0;
}

/**
 * §8.5: damage taken off `pokemon`'s attacks by opposing Garbodor "Gloomy Garbage" holders while
 * `pokemon` has a Tool attached. Holders may be anywhere in play; `exceptHolder` drops the term
 * granted by an attack's target when the attack ignores effects on it.
 */
export function opposingToolAttackDebuff(
  state: GameState,
  pokemon: InPlayPokemon,
  exceptHolder?: InPlayPokemon,
): number {
  const uid = topUid(pokemon);
  if (uid === undefined || pokemon.tools.length === 0) return 0;
  for (const seat of SEATS) {
    const side = state.players[seat];
    if (side.active === null || topUid(side.active) !== uid) continue;
    const other = state.players[otherSeat(seat)];
    const holders = inPlayOf(other);
    let amount = 0;
    for (const holder of holders) {
      const top = topCardOf(state, holder);
      const term =
        top === undefined ? undefined : programFor(top.id)?.passive?.opponentActiveToolAttackDebuff;
      const holderUid = topUid(holder);
      if (
        term === undefined ||
        holderUid === undefined ||
        disabledAbilityUids(state).has(holderUid)
      )
        continue; // §9
      if (exceptHolder !== undefined && topUid(exceptHolder) === holderUid) continue;
      amount += term;
    }
    return amount;
  }
  return 0;
}

/**
 * §8.5: does one of its own side's Pokémon shield the benched `pokemon` from attacks (Thundurus
 * "Adverse Weather", Rabsca "Spherical Shield", Shaymin "Flower Curtain")? Sources are first-match
 * and each is checked against Ability locks individually.
 */
function benchShieldGranted(
  state: GameState,
  source: InPlayPokemon,
  field:
    | "preventBenchDamageWhileActive"
    | "preventBenchDamageAndEffects"
    | "preventBenchDamageNoRuleBox",
  targetUid: string,
  scope: BenchShieldScope,
): boolean {
  const sourceUid = topUid(source);
  // Feint Attack: a source that is the damaged body itself is an effect on that Pokémon and is
  // ignored under `othersOnly`.
  if (scope === "othersOnly" && sourceUid === targetUid) return false;
  const top = topCardOf(state, source);
  if (top === undefined || programFor(top.id)?.passive?.[field] !== true) return false;
  if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) return false; // §9
  return true;
}

/**
 * Whether the damaged body's own contribution to a bench shield counts (Feint Attack ignores
 * effects on the target).
 */
type BenchShieldScope = "all" | "othersOnly";

function benchShieldScan(
  state: GameState,
  pokemon: InPlayPokemon,
  half: "damage" | "effects",
  scope: BenchShieldScope,
): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  // Shaymin's no-Rule-Box conjunct is a property of the damaged body; an unresolvable card counts
  // as having a Rule Box.
  const targetTop = topCardOf(state, pokemon);
  const targetHasRuleBox = targetTop === undefined || hasRuleBox(targetTop);
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause, and it is the ONE thing all three printings share: "your
    // BENCHED Pokémon". An Active holder of this uid is out either way.
    if (!side.bench.some((benched) => topUid(benched) === uid)) continue;
    // Tera rule: a benched Tera Pokémon takes no attack damage from either side. It is a printed
    // rule, not an Ability, so locks and Feint Attack's scope do not affect it.
    if (half === "damage" && isTeraPokemon(targetTop)) return true;
    // Thundurus's SOURCE clause: this side's OWN Active Spot and nowhere else —
    // and the DAMAGE half only, because its sentence prints no effects half at
    // all. A widening that let this field reach the effects site would hand
    // Thundurus a status immunity it does not print.
    if (
      half === "damage" &&
      side.active !== null &&
      benchShieldGranted(state, side.active, "preventBenchDamageWhileActive", uid, scope)
    ) {
      return true;
    }
    // Rabsca's SOURCE clause: there isn't one. Every body this side has in play
    // grants it, Active and Bench alike, INCLUDING the damaged body itself —
    // which is why `scope` exists and why an empty Active Spot is no longer a
    // reason to bail out of the scan (it was, while the only source was an
    // Active; that early `return false` was a correct reading of ONE sentence and
    // a bug waiting for the second).
    const holders = inPlayOf(side);
    for (const holder of holders) {
      if (benchShieldGranted(state, holder, "preventBenchDamageAndEffects", uid, scope))
        return true;
      // Shaymin's SOURCE clause is Rabsca's — absent — so it shares that loop
      // rather than getting one of its own. It departs on the two clauses that ARE
      // printed differently, and both are enforced right here:
      //   • the DAMAGE half only ("Prevent all damage done to…", no effects half),
      //     which is Thundurus's answer above and not Rabsca's;
      //   • the NARROWED TARGET ("…that don't have a Rule Box"), the first target
      //     conjunct any member of this family has printed beyond "your Benched".
      if (
        half === "damage" &&
        !targetHasRuleBox &&
        benchShieldGranted(state, holder, "preventBenchDamageNoRuleBox", uid, scope)
      ) {
        return true;
      }
    }
    return false; // this is the Pokémon's own side — no other side can shield it
  }
  return false;
}

export function benchShieldedFromDamage(
  state: GameState,
  pokemon: InPlayPokemon,
  scope: BenchShieldScope,
): boolean {
  return benchShieldScan(state, pokemon, "damage", scope);
}

/**
 * §8.5: Bastiodon "Ancient Bulwark": is `pokemon` shielded by a benched holder on its side because
 * the opposing attacker has at most the printed number of Energy cards attached? The holder shields
 * itself except under `othersOnly`.
 */
export function seatShieldedFromLowEnergyAttacker(
  state: GameState,
  pokemon: InPlayPokemon,
  attackerBody: InPlayPokemon | undefined,
  attackerSeat: Seat,
  scope: BenchShieldScope,
): boolean {
  const uid = topUid(pokemon);
  if (attackerBody === undefined || uid === undefined) return false;
  const seat = seatOfPokemon(state, pokemon);
  if (seat === undefined || seat === attackerSeat) return false;
  const energy = countAttachedEnergy(state, attackerBody, null);
  for (const holder of state.players[seat].bench) {
    const holderUid = topUid(holder);
    if (holderUid === undefined || (scope === "othersOnly" && holderUid === uid)) continue;
    const top = topCardOf(state, holder);
    const ceiling =
      top === undefined
        ? undefined
        : programFor(top.id)?.passive?.preventSeatDamageWhileBenchedFromEnergyAtMost;
    if (ceiling === undefined || energy > ceiling) continue;
    if (disabledAbilityUids(state).has(holderUid)) continue; // §9
    return true;
  }
  return false;
}

/**
 * §8: Yveltal "Life-Locked": is `pokemon` its side's Active while the other side has an unlocked
 * holder in play? Every heal site asks this; moving damage counters is not a heal.
 */
export function healLocked(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  for (const seat of SEATS) {
    const active = state.players[seat].active;
    if (active === null || topUid(active) !== uid) continue;
    const other = state.players[otherSeat(seat)];
    const holders = inPlayOf(other);
    return holders.some((holder) => {
      const top = topCardOf(state, holder);
      const holderUid = topUid(holder);
      return (
        top !== undefined &&
        holderUid !== undefined &&
        programFor(top.id)?.passive?.opponentActiveCantBeHealed === true &&
        !disabledAbilityUids(state).has(holderUid)
      );
    });
  }
  return false;
}

/** §11: is the benched `pokemon` shielded from attack effects by its own side (Rabsca)? */
export function benchShieldedFromEffects(state: GameState, pokemon: InPlayPokemon): boolean {
  return benchShieldScan(state, pokemon, "effects", "all");
}

/**
 * §11: does `seat`'s Active Rhyperior "Wide Wall" prevent the effects of the opponent's Supporters
 * on all of `seat`'s Pokémon?
 */
export function seatShieldedFromSupporterEffects(state: GameState, seat: Seat): boolean {
  const active = state.players[seat].active;
  if (active === null) return false;
  const top = topCardOf(state, active);
  if (top === undefined || programFor(top.id)?.passive?.preventSupporterEffectsWhileActive !== true)
    return false;
  const sourceUid = topUid(active);
  return sourceUid === undefined || !disabledAbilityUids(state).has(sourceUid); // §9
}

/**
 * §7.1/§7.4: is `seat` barred from playing `klass` cards from hand by the opponent's Active
 * (Tyranitar "Daunting Gaze", Jellicent ex "Oceanic Curse")?
 */
function handPlayBarredByOpponentActive(
  state: GameState,
  seat: Seat,
  klass: HandPlayClass,
): boolean {
  const barrier = state.players[otherSeat(seat)].active;
  if (barrier === null) return false;
  const top = topCardOf(state, barrier);
  if (top === undefined) return false;
  const classes = programFor(top.id)?.passive?.preventOpponentHandPlay;
  if (classes === undefined || !classes.includes(klass)) return false;
  const sourceUid = topUid(barrier);
  return sourceUid === undefined || !disabledAbilityUids(state).has(sourceUid); // §9
}

/** Matches the deck builder's ACE SPEC test so the engine and builder agree. */
export function isAceSpec(card: Card | undefined): boolean {
  return (card?.rarity ?? "").includes("ACE SPEC");
}

/**
 * §7.1/§7.4: is `seat` barred from playing ACE SPEC cards by an opposing Genesect "ACE Nullifier"
 * with a Tool attached? The holder may be Active or Benched, and each source is checked against
 * Ability locks individually.
 */
function aceSpecPlayBarredByOpponentBody(state: GameState, seat: Seat): boolean {
  // (the classifier is asked by `aceSpecPlayBarred` below, never here — this
  // half answers about the BOARD alone, so the two terms can be read apart.)
  const foes = state.players[otherSeat(seat)];
  const holders = inPlayOf(foes);
  const silenced = disabledAbilityUids(state);
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    if (top === undefined) continue;
    if (programFor(top.id)?.passive?.preventOpponentAceSpecPlayWhileToolAttached !== true) continue;
    if (holder.tools.length === 0) continue; // the printed window
    const sourceUid = topUid(holder);
    if (sourceUid === undefined || !silenced.has(sourceUid)) return true; // §9
  }
  return false;
}

/**
 * Is `seat` barred from playing this card because it is an ACE SPEC? Usable by callers with no
 * `HandPlayClass`, such as Energy attachment.
 */
export function aceSpecPlayBarred(state: GameState, seat: Seat, card: Card | undefined): boolean {
  return isAceSpec(card) && aceSpecPlayBarredByOpponentBody(state, seat);
}

/**
 * §7: may `seat` play a `klass` card from hand right now? Combines the attack-installed stamp, the
 * opposing Active's passive, and the ACE SPEC bar. `card` is required so no caller can silently
 * skip the ACE SPEC check.
 */
export function handPlayBarred(
  state: GameState,
  seat: Seat,
  klass: HandPlayClass,
  card: Card | undefined,
): boolean {
  return (
    stampedBarFor(state, seat, klass) ||
    handPlayBarredByOpponentActive(state, seat, klass) ||
    aceSpecPlayBarred(state, seat, card)
  );
}

/** The noun each class's refusal names (`attachTool` has always said "Pokémon Tool"). */
const HAND_PLAY_NOUN: Record<HandPlayClass, string> = {
  Item: "Item",
  Supporter: "Supporter",
  Tool: "Pokémon Tool",
  Stadium: "Stadium",
};

/**
 * The refusal reason for a play `handPlayBarred` refused: the class word when a class source bars
 * it, "ACE SPEC" only when the rarity bar is the sole cause.
 */
export function handPlayBarredReason(
  state: GameState,
  seat: Seat,
  klass: HandPlayClass,
  card: Card | undefined,
): string {
  const byClass =
    stampedBarFor(state, seat, klass) || handPlayBarredByOpponentActive(state, seat, klass);
  const noun =
    !byClass && aceSpecPlayBarred(state, seat, card) ? "ACE SPEC" : HAND_PLAY_NOUN[klass];
  return `your opponent prevents you from playing ${noun} cards from your hand`;
}

/**
 * §7.5/§10: does the opposing Active bar playing this Pokémon card? The `only` filter must hold and
 * the `except` filter must not.
 */
function pokemonPlayBarredByOpponentActive(
  state: GameState,
  seat: Seat,
  act: PokemonPlayAct,
  card: Card | undefined,
): boolean {
  const barrier = state.players[otherSeat(seat)].active;
  if (barrier === null) return false;
  const top = topCardOf(state, barrier);
  if (top === undefined) return false;
  const bar = programFor(top.id)?.passive?.preventOpponentPokemonPlay;
  if (bar === undefined || !bar.acts.includes(act)) return false;
  if (bar.only !== undefined && !matchesFilter(card, bar.only)) return false;
  if (bar.except !== undefined && matchesFilter(card, bar.except)) return false;
  const sourceUid = topUid(barrier);
  return sourceUid === undefined || !disabledAbilityUids(state).has(sourceUid); // §9
}

/**
 * §7.5/§10: may `seat` play `card` from hand by `act` right now? `card` is the card being played
 * (for evolve, the Evolution card), not the one played onto.
 */
export function pokemonPlayBarred(
  state: GameState,
  seat: Seat,
  act: PokemonPlayAct,
  card: Card | undefined,
): boolean {
  return (
    stampedActBarFor(state, seat, act) || pokemonPlayBarredByOpponentActive(state, seat, act, card)
  );
}

/**
 * §11: is `pokemon` in a subgroup its own side shields from attack effects (Team Rocket's Articuno
 * "Repelling Veil")? The target may be Active or Benched, sources are first-match, and each is
 * checked against Ability locks.
 */
export function groupShieldedFromAttackEffects(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  const targetTop = inPlayCardOf(state, pokemon);
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The DERIVED SEAT, `benchShieldScan`'s answer: the caller hands us one of a
    // side's own entries, so find that side and read ONLY it. The target clause
    // says "YOUR … Pokémon", so no other side's aura can reach this body.
    const bodies = inPlayOf(side);
    if (!bodies.some((body) => topUid(body) === uid)) continue;
    for (const holder of bodies) {
      const top = topCardOf(state, holder);
      if (top === undefined) continue;
      const filter = programFor(top.id)?.passive?.preventAttackEffectsForGroup;
      if (filter === undefined) continue;
      const sourceUid = topUid(holder);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9
      if (matchesFilter(targetTop, filter)) return true;
    }
    return false; // this is the Pokémon's own side — no other side can shield it
  }
  return false;
}

/**
 * §8.5: damage taken off attacks against `pokemon` after Weakness and Resistance by its own side's
 * auras (Hariyama, Steven's Carbink, Bouffalant, and the like) plus the Stadium and side
 * reductions. Sources are summed unless capped by `noStack`. `scope` handles Feint Attack ignoring
 * effects granted by the target itself; `attackerSeat` excludes own-side hits.
 */
export function seatDamageReduction(
  state: GameState,
  pokemon: InPlayPokemon,
  scope: "all" | "othersOnly",
  attackerSeat: Seat,
): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  // The damaged body's card, matched against `beneficiary`; an unresolvable card fails every
  // filter.
  const damagedCard = inPlayCardOf(state, pokemon);
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = inPlayOf(side);
    // The TARGET clause: "ALL of your Pokémon" — every body on this side, Active
    // and Bench alike, so membership is the whole of it.
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    // Every reduction here prints "from attacks from your opponent's Pokémon", so an own-side hit
    // is reduced by nothing.
    if (seat === attackerSeat) return 0;
    let taken = 0;
    // Printed Ability name to the largest single contribution, so `noStack` auras count once each.
    const capped = new Map<string, number>();
    for (const holder of holders) {
      const sourceUid = topUid(holder);
      // Feint Attack: the damaged body's OWN contribution is an effect on that
      // Pokémon and is the only part of this aura the clause reaches.
      if (scope === "othersOnly" && sourceUid === uid) continue;
      const top = topCardOf(state, holder);
      const aura =
        top === undefined ? undefined : programFor(top.id)?.passive?.seatDamageReductionAfterWR;
      if (aura === undefined) continue;
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9
      // The BENEFICIARY clause, on the DAMAGED body and on nothing else. On both
      // narrowed printings the source is itself inside the set it pays, so a
      // build that asked this of `top` instead would be green on every board this
      // pool can build and would still encode the wrong sentence.
      if (aura.beneficiary !== undefined && !matchesFilter(damagedCard, aura.beneficiary)) continue;
      // Klinklang "Gear Coating": the damaged body must have the printed Energy type attached.
      if (
        aura.beneficiaryHasEnergy !== undefined &&
        !hasAttachedEnergy(state, pokemon, aura.beneficiaryHasEnergy)
      )
        continue;
      // The SOURCE-ZONE clause — Steven's Carbink's "As long as this Pokémon is on
      // your Bench". It gates where the SOURCE stands and says nothing about the
      // target, so a benched Carbink shields the Active and stops shielding
      // anything the moment it is promoted.
      if (aura.sourceOnBench === true && !isOnBench(state, holder)) continue;
      // Antique Armor Fossil: the source must be this side's Active.
      if (aura.sourceActive === true && holder !== side.active) continue;
      // The "1 OTHER <name> in play" clause — Bouffalant's, and the one rider that
      // excludes the source itself. Compared by TOP UID because `InPlayPokemon` is
      // rebuilt by value on every damage step, and scanned over THIS side's
      // holders because the printed possessive is "you have".
      const otherNamed = aura.otherNamedInPlay;
      if (
        otherNamed !== undefined &&
        !holders.some(
          (other) =>
            topUid(other) !== sourceUid &&
            matchesFilter(topCardOf(state, other), { kind: "byName", name: otherNamed }),
        )
      ) {
        continue;
      }
      if (aura.noStack === undefined) {
        taken += aura.amount;
        continue;
      }
      capped.set(aura.noStack, Math.max(capped.get(aura.noStack) ?? 0, aura.amount));
    }
    for (const amount of capped.values()) taken += amount;
    // Jasmine's Gaze applies only under `all`, since Feint Attack ignores it as an effect on the
    // Pokémon; the Stadium reduction is not an effect on the Pokémon and applies under both scopes.
    if (scope === "all") taken += sideDamageReductionOf(state, side, damagedCard);
    return taken + stadiumDamageReduction(state, damagedCard); // this is the Pokémon's own side — no other side can shield it
  }
  return 0;
}

/**
 * §8.5: `side`'s live next-turn reductions (Jasmine's Gaze), summed over entries stamped for the
 * current turn whose type filter the damaged card matches.
 */
function sideDamageReductionOf(
  state: GameState,
  side: PlayerSide,
  damagedCard: Card | undefined,
): number {
  let amount = 0;
  for (const record of side.sideDamageReduction) {
    if (record.turn !== state.turn) continue;
    if (
      record.pokemonType !== undefined &&
      !matchesFilter(damagedCard, { kind: "typedPokemon", pokemonType: record.pokemonType })
    )
      continue;
    amount += record.amount;
  }
  return amount;
}

/**
 * §8.5: the in-play Stadium's post-Weakness/Resistance reduction for a hit on `damagedCard`, if it
 * matches the beneficiary filter.
 */
function stadiumDamageReduction(state: GameState, damagedCard: Card | undefined): number {
  const reduction = stadiumEffectsOf(state)?.damageReductionAfterWR;
  return reduction !== undefined && matchesFilter(damagedCard, reduction.beneficiary)
    ? reduction.amount
    : 0;
}

/**
 * §8.5: total pre-Weakness/Resistance damage bonus from `seat`'s own auras for an attack by
 * `attackerCard`. Sources are summed except that `noStack` caps each Ability name at its largest
 * contribution; `beneficiary` is matched against the attacker only.
 */
export function seatPreWRDamageBonus(
  state: GameState,
  seat: Seat,
  attackerCard: Card | undefined,
  /**
   * The defender's card, for the `target` rider; an aura with a `target` fails when it is absent.
   */
  defenderCard?: Card,
): number {
  const side = state.players[seat];
  const holders = inPlayOf(side);
  let total = 0;
  // The `noStack` ledger: printed Ability name → the largest single contribution
  // seen for it. Summed in at the end so a capped key and an uncapped one can
  // coexist on one board without either reading the other's rule.
  const capped = new Map<string, number>();
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    const aura =
      top === undefined ? undefined : programFor(top.id)?.passive?.seatDamageBonusBeforeWR;
    if (aura === undefined) continue;
    const sourceUid = topUid(holder);
    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9
    // The BENEFICIARY clause, on the attacker and on nothing else.
    if (aura.beneficiary !== undefined && !matchesFilter(attackerCard, aura.beneficiary)) continue;
    // An attacker with the excluded name gets nothing ("except any Iron Crown ex").
    if (aura.exceptName !== undefined && attackerCard?.name === aura.exceptName) continue;
    // The `target` rider is matched on the defender, never on the attacker.
    if (aura.target !== undefined && !matchesFilter(defenderCard, aura.target)) continue;
    if (aura.noStack === undefined) {
      total += aura.amount;
      continue;
    }
    capped.set(aura.noStack, Math.max(capped.get(aura.noStack) ?? 0, aura.amount));
  }
  for (const amount of capped.values()) total += amount;
  // The Stadium bonus is outside the `noStack` ledger, which keys on Ability names.
  return total + stadiumPreWRBonus(state, attackerCard);
}

/**
 * §8.5: the in-play Stadium's pre-Weakness/Resistance bonus (Postwick), matched on the attacker for
 * either side.
 */
function stadiumPreWRBonus(state: GameState, attackerCard: Card | undefined): number {
  const bonus = stadiumEffectsOf(state)?.damageBonusBeforeWR;
  return bonus !== undefined && matchesFilter(attackerCard, bonus.attacker) ? bonus.amount : 0;
}

/**
 * §8.1: the prize-bonus auras on the prize-taking `seat` that fire for the Knock Out of `koCard`
 * (Togekiss "Wonder Kiss", Hydreigon ex "Greedy Eater"). Returns the matching auras rather than a
 * number because Wonder Kiss needs a coin flip, which `planPrizes` performs. `noStack` caps
 * entries, so a second Togekiss does not flip.
 */
export function seatKoPrizeBonuses(
  state: GameState,
  seat: Seat,
  /** The DYING body's top card, for the `koTarget` filter. */
  koCard: Card | undefined,
  /** Was the dying body its seat's ACTIVE, on the pre-KO state? */
  koWasActive: boolean,
  /** The attacking body's uid — `undefined` on the Checkup and mid-turn sweeps. */
  attackerUid: string | undefined,
): { uid: string; bonus: NonNullable<PassiveEffects["koPrizeBonus"]> }[] {
  const side = state.players[seat];
  const holders = inPlayOf(side);
  const entries: { uid: string; bonus: NonNullable<PassiveEffects["koPrizeBonus"]> }[] = [];
  // The `noStack` ledger. It records the ABILITY NAMES already admitted, and the
  // FIRST holder to satisfy every clause is the one that keeps the entry — a
  // largest-wins ledger like the damage auras' would be arithmetic on a set of
  // effects that are not all arithmetic (a flip is not an amount).
  const capped = new Set<string>();
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    const bonus = top === undefined ? undefined : programFor(top.id)?.passive?.koPrizeBonus;
    if (bonus === undefined) continue;
    const sourceUid = topUid(holder);
    if (sourceUid === undefined) continue;
    if (disabledAbilityUids(state).has(sourceUid)) continue; // §9
    if (bonus.koSpot === "active" && !koWasActive) continue;
    if (bonus.koTarget !== undefined && !matchesFilter(koCard, bonus.koTarget)) continue;
    if (bonus.byThisPokemonsAttack === true && sourceUid !== attackerUid) continue;
    if (bonus.noStack === true) {
      if (capped.has(bonus.ability)) continue;
      capped.add(bonus.ability);
    }
    entries.push({ uid: sourceUid, bonus });
  }
  return entries;
}

/**
 * §8.1: the Prize reduction on the KO'd side (Mega Gengar ex "Shadowy Concealment"). First-match,
 * so copies do not stack; the cause is checked by the caller.
 */
export function seatKoPrizeReductionOf(
  state: GameState,
  seat: Seat,
  /** The DYING body's IN-PLAY card, for the `koTarget` filter. */
  koCard: Card | undefined,
): { uid: string; rule: NonNullable<PassiveEffects["seatKoPrizeReduction"]> } | null {
  const side = state.players[seat];
  const holders = inPlayOf(side);
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    const rule = top === undefined ? undefined : programFor(top.id)?.passive?.seatKoPrizeReduction;
    if (rule === undefined) continue;
    const uid = topUid(holder);
    if (uid === undefined || disabledAbilityUids(state).has(uid)) continue; // §9
    if (!matchesFilter(koCard, rule.koTarget)) continue;
    return { uid, rule };
  }
  return null;
}

/**
 * §7.3/§8.5: does the Stadium (Neutralization Zone) prevent all damage from an ex or V `attacker`
 * to a `pokemon` without a Rule Box? Not an Ability, so no lock or Feint Attack removes it. No
 * attacker seat is checked.
 */
export function stadiumPreventsDamage(
  state: GameState,
  pokemon: InPlayPokemon,
  attacker: Card | undefined,
): boolean {
  if (stadiumEffectsOf(state)?.preventDamageToNoRuleBoxFromExV !== true) return false;
  if (attacker === undefined || !isExOrV(attacker)) return false;
  const top = topCardOf(state, pokemon);
  return top !== undefined && !hasRuleBox(top);
}

/**
 * §11: is `pokemon`'s Retreat Cost zeroed by its own passive (Wimpod "Punk Out", Melt Away)? "In
 * play" includes the Bench, and an Ability lock silences it.
 */
export function hasFreeRetreatSelf(state: GameState, pokemon: InPlayPokemon): boolean {
  const top = topCardOf(state, pokemon);
  const uid = topUid(pokemon);
  if (top === undefined || uid === undefined) return false;
  const self = programFor(top.id)?.passive?.noRetreatCostSelf;
  if (self === undefined) return false;
  if (disabledAbilityUids(state).has(uid)) return false; // Counts attached Energy cards, not provided units.
  if (self.requiresNoEnergyAttached === true && pokemon.energy.length > 0) return false;
  const required = self.requiresOpponentSuffixInPlay;
  if (required === undefined) return true;
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = inPlayOf(side);
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    const foe = state.players[otherSeat(seat)];
    const foeHolders = inPlayOf(foe);
    return foeHolders.some((holder) => {
      const card = topCardOf(state, holder);
      return card !== undefined && pokemonSuffixOf(card) === required;
    });
  }
  return false;
}

/**
 * §11: Retreat Cost under continuous effects. Any free-retreat effect zeroes it outright; otherwise
 * the printed cost and every surcharge and discount are summed and floored once at zero.
 */
export function effectiveRetreatCost(state: GameState, pokemon: InPlayPokemon): number {
  const top = inPlayCardOf(state, pokemon);
  if (top === undefined) return 0;
  if (hasFreeRetreatAura(state, pokemon) || hasFreeRetreatSelf(state, pokemon)) return 0;
  // Tool, Energy, and Stadium free-retreat effects are not Abilities, so locks do not affect them.
  if (
    toolFreesRetreat(state, pokemon) ||
    energyFreesRetreat(state, pokemon) ||
    stadiumFreesRetreat(state, top)
  )
    return 0;
  const printed = retreatCostOf(top);
  // The attack-installed cost tax is part of the floored sum, so an overshooting discount does not
  // offset it.
  return Math.max(
    0,
    printed +
      installedCostTaxOf(state, pokemon) +
      stadiumRetreatDelta(state, top) +
      opposingRetreatSurcharge(state, pokemon) +
      activeRetreatSurcharge(state, pokemon) -
      alliedRetreatDiscount(state, pokemon) -
      toolRetreatDiscount(state, pokemon),
  );
}

/**
 * §11: the {C} discount from attached Tools (Air Balloon, Rescue Board), summed per Tool. Not
 * affected by Ability locks.
 */
export function toolRetreatDiscount(state: GameState, pokemon: InPlayPokemon): number {
  let discount = 0;
  for (const toolUid of toolsInEffect(state, pokemon)) {
    const id = state.cardIdByUid[toolUid];
    discount +=
      (id === undefined ? undefined : programFor(id)?.passive?.retreatCostDiscount)?.amount ?? 0;
  }
  return discount;
}

/**
 * §11: does an attached Tool zero the Retreat Cost (Rescue Board at 30 or less remaining HP)? Read
 * live, so healing restores the cost.
 */
export function toolFreesRetreat(state: GameState, pokemon: InPlayPokemon): boolean {
  return toolsInEffect(state, pokemon).some((toolUid) => {
    const id = state.cardIdByUid[toolUid];
    const atMost =
      id === undefined
        ? undefined
        : programFor(id)?.passive?.retreatCostDiscount?.freeAtRemainingHpAtMost;
    return atMost !== undefined && remainingHpWithin(state, pokemon, atMost);
  });
}

/**
 * §11: Magnetic Metal Energy: an attached Energy whose rules apply on the holder frees the retreat.
 * Not affected by Ability locks.
 */
export function energyFreesRetreat(state: GameState, pokemon: InPlayPokemon): boolean {
  return pokemon.energy.some((uid) => {
    const id = state.cardIdByUid[uid];
    const energy = id === undefined ? undefined : programFor(id)?.energy;
    return (
      energy?.passive?.noRetreatCostSelf !== undefined && energyRulesApply(state, pokemon, energy)
    );
  });
}

/**
 * §11: Gravity Gemstone: {C} more Retreat Cost for both Active Pokémon per Gemstone attached to
 * either Active. Benched holders and benched targets are unaffected.
 */
export function activeRetreatSurcharge(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  const actives = SEATS.flatMap((seat) => {
    const active = state.players[seat].active;
    return active === null ? [] : [active];
  });
  if (!actives.some((active) => topUid(active) === uid)) return 0;
  let added = 0;
  for (const active of actives) {
    for (const toolUid of toolsInEffect(state, active)) {
      const id = state.cardIdByUid[toolUid];
      added +=
        (id === undefined ? undefined : programFor(id)?.passive?.activeRetreatSurchargeBoth) ?? 0;
    }
  }
  return added;
}

/**
 * §11: does the Stadium (N's Castle) zero the Retreat Cost of a matching Pokémon at any stage, on
 * either side?
 */
function stadiumFreesRetreat(state: GameState, top: Card): boolean {
  const retreat = stadiumEffectsOf(state)?.retreat;
  return retreat?.free === true && matchesFilter(top, retreat.filter);
}

/**
 * The in-play Stadium's surcharge minus discount for one Pokémon's Retreat Cost. Beach Court and
 * Calamitous Wasteland apply only to Basics; the filtered discount applies at any stage.
 */
function stadiumRetreatDelta(state: GameState, top: Card): number {
  const stadium = stadiumEffectsOf(state);
  const basic = isBasicPokemon(top);
  const discount = basic ? (stadium?.basicRetreatDiscount ?? 0) : 0;
  const surcharge = basic ? stadium?.basicRetreatSurcharge : undefined;
  const exempt =
    surcharge?.excludesType !== undefined && (top.types ?? []).includes(surcharge.excludesType);
  const added = surcharge === undefined || exempt ? 0 : surcharge.amount;
  const retreat = stadium?.retreat;
  const filtered =
    retreat !== undefined && matchesFilter(top, retreat.filter) ? (retreat.discount ?? 0) : 0;
  return added - discount - filtered;
}

/**
 * §8.2: the {C} added to `pokemon`'s attacks by the opposing Active's Ability (Seismitoad "Quaking
 * Zone", Antique Root Fossil "Primal Root"). Both source and target must be Active.
 */
export function opposingAttackCostSurcharge(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause: only this side's Active is surcharged, so a benched holder
    // of this uid is out even though it belongs to this side.
    if (side.active === null || topUid(side.active) !== uid) continue;
    // The SOURCE clause: the opponent's Active Spot and nowhere else.
    const source = state.players[otherSeat(seat)].active;
    if (source === null) return 0;
    const top = topCardOf(state, source);
    const passive = top === undefined ? undefined : programFor(top.id)?.passive;
    const amount = passive?.opponentActiveAttackCostSurcharge;
    if (amount === undefined) return 0;
    // Primal Root applies only to a Basic attacker.
    if (passive?.opponentActiveAttackCostSurchargeBasicOnly === true) {
      const attacker = topCardOf(state, pokemon);
      if (attacker === undefined || !isBasicPokemon(attacker)) return 0;
    }
    const sourceUid = topUid(source);
    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) return 0; // §9
    return amount;
  }
  return 0;
}

/**
 * §8.2: the {C} subtracted from `pokemon`'s attacks by its own passive (Radiant Charizard "Excited
 * Heart" and similar) plus its attached Tools. An Ability lock removes only the top card's terms,
 * not the Tools'.
 */
export function selfAttackCostDiscount(
  state: GameState,
  pokemon: InPlayPokemon,
  attackName?: string,
): number {
  const top = topCardOf(state, pokemon);
  const uid = topUid(pokemon);
  if (top === undefined || uid === undefined) return 0;
  // Tools are not Abilities, so their discount survives a missing passive or an Ability lock.
  const tools = toolAttackCostDiscount(state, pokemon);
  const passive = programFor(top.id)?.passive;
  const perPrize = passive?.attackCostDiscountPerOpponentPrize;
  const perNamed = passive?.attackCostDiscountPerNamedInDiscard;
  const perBenched = passive?.attackCostDiscountPerOpponentBenched;
  if (perPrize === undefined && perNamed === undefined && perBenched === undefined) return tools;
  if (disabledAbilityUids(state).has(uid)) return tools; // A discount scoped to one attack name (Bloodmoon Ursaluna ex "Seasoned Skill") does not apply to other attacks.
  const scope = passive?.attackCostDiscountAttack;
  if (scope !== undefined && scope !== attackName) return tools;
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = inPlayOf(side);
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    let discount = tools;
    if (perPrize !== undefined) discount += perPrize * takenPrizes(state, otherSeat(seat));
    if (perNamed !== undefined)
      discount += perNamed.amount * namedInDiscard(state, seat, perNamed.name);
    if (perBenched !== undefined)
      discount += perBenched * state.players[otherSeat(seat)].bench.length;
    return discount;
  }
  return tools;
}

/**
 * §8.5: Kingambit "Supreme Overlord": the printed pre-Weakness/Resistance bonus times the Prizes
 * the opponent has taken.
 */
export function selfPreWRBonusPerOpponentPrize(state: GameState, pokemon: InPlayPokemon): number {
  const top = topCardOf(state, pokemon);
  const uid = topUid(pokemon);
  if (top === undefined || uid === undefined) return 0;
  const rate = programFor(top.id)?.passive?.damageBonusBeforeWRPerOpponentPrize;
  if (rate === undefined || disabledAbilityUids(state).has(uid)) return 0; // §9
  const seat = seatOfPokemon(state, pokemon);
  return seat === undefined ? 0 : rate * takenPrizes(state, otherSeat(seat));
}

/**
 * §8.2: Decidueye ex "Sniper's Eye": does `pokemon` ignore every {C} in its attack costs because
 * the opponent holds exactly the printed number of cards?
 */
export function selfIgnoresColorlessCost(state: GameState, pokemon: InPlayPokemon): boolean {
  const top = topCardOf(state, pokemon);
  const uid = topUid(pokemon);
  if (top === undefined || uid === undefined) return false;
  const exactly = programFor(top.id)?.passive?.ignoreColorlessCostIfOpponentHandExactly;
  if (exactly === undefined || disabledAbilityUids(state).has(uid)) return false; // §9
  const seat = seatOfPokemon(state, pokemon);
  return seat !== undefined && state.players[otherSeat(seat)].hand.length === exactly;
}

/**
 * §8.2: the {C} discount from attached Tools (Counter Gain, Hop's Choice Band). Not affected by
 * Ability locks; the `holder` filter is matched on the holder's in-play card.
 */
export function toolAttackCostDiscount(state: GameState, pokemon: InPlayPokemon): number {
  const top = inPlayCardOf(state, pokemon);
  const uid = topUid(pokemon);
  if (top === undefined || uid === undefined) return 0;
  let discount = 0;
  for (const toolUid of toolsInEffect(state, pokemon)) {
    const id = state.cardIdByUid[toolUid];
    const term = id === undefined ? undefined : programFor(id)?.passive?.attackCostDiscount;
    if (term === undefined) continue;
    // Any-type discounts (Sparkling Crystal) are summed by `toolAnyTypeCostDiscount` instead.
    if (term.anyType === true) continue;
    if (term.holder !== undefined && !matchesFilter(top, term.holder)) continue;
    if (term.ifMorePrizesRemaining === true && !holderSideLeadsOnPrizesRemaining(state, pokemon))
      continue;
    discount += term.amount;
  }
  return discount;
}

/**
 * §8.2: Energy of any type taken off the attack cost by attached Tools (Sparkling Crystal on a Tera
 * Pokémon).
 */
export function toolAnyTypeCostDiscount(state: GameState, pokemon: InPlayPokemon): number {
  const holderTop = inPlayCardOf(state, pokemon);
  if (holderTop === undefined) return 0;
  let total = 0;
  for (const attachedUid of toolsInEffect(state, pokemon)) {
    const cardId = state.cardIdByUid[attachedUid];
    const anyTerm =
      cardId === undefined ? undefined : programFor(cardId)?.passive?.attackCostDiscount;
    if (anyTerm === undefined || anyTerm.anyType !== true) continue;
    if (anyTerm.holder !== undefined && !matchesFilter(holderTop, anyTerm.holder)) continue;
    if (anyTerm.ifMorePrizesRemaining === true && !holderSideLeadsOnPrizesRemaining(state, pokemon))
      continue;
    total += anyTerm.amount;
  }
  return total;
}

/**
 * Removes `count` symbols of any type from `cost`, choosing the symbol that never loses: a
 * Colorless if the cost is already payable, otherwise a typed symbol whose removal makes it payable
 * or that the attached Energy falls short on. Removes from the end so the remaining symbols keep
 * printed order.
 */
export function anyTypeCostRemoval(
  cost: readonly string[],
  provided: readonly string[],
  count: number,
): readonly string[] {
  let next: readonly string[] = cost;
  for (let step = 0; step < count && next.length > 0; step += 1) {
    const current = next;
    const without = (index: number): readonly string[] => current.filter((_, i) => i !== index);
    const lastColorless = current.lastIndexOf("Colorless");
    if (costMet(current, provided)) {
      next = without(lastColorless >= 0 ? lastColorless : current.length - 1);
      continue;
    }
    let pick = -1;
    for (let i = current.length - 1; i >= 0 && pick < 0; i -= 1) {
      if (current[i] !== "Colorless" && costMet(without(i), provided)) pick = i;
    }
    for (let i = current.length - 1; i >= 0 && pick < 0; i -= 1) {
      const symbol = current[i];
      if (symbol === undefined || symbol === "Colorless") continue;
      const owed = current.filter((s) => s === symbol).length;
      // A constrained unit whose set includes `symbol` can also pay it.
      const payers = provided.filter(
        (unit) => unit === symbol || constrainedEnergyTypes(unit)?.includes(symbol) === true,
      ).length;
      if (owed > payers) pick = i;
    }
    next = without(pick >= 0 ? pick : lastColorless >= 0 ? lastColorless : current.length - 1);
  }
  return next;
}

/** Counts by printed name, not id, so different printings of the same card all count. */
function namedInDiscard(state: GameState, seat: Seat, name: string): number {
  let count = 0;
  for (const uid of state.players[seat].discard) {
    if (cardOfUid(state, uid)?.name === name) count += 1;
  }
  return count;
}

/**
 * §8.2: attack cost under continuous effects. Stadium, opposing aura, and cost-tax surcharges are
 * netted against the self discount as Colorless symbols; any-type discounts are applied last
 * against the attached Energy. Returns the printed array itself when nothing changes it.
 */
export function effectiveAttackCost(
  state: GameState,
  pokemon: InPlayPokemon,
  cost: readonly string[],
  attackName?: string,
): readonly string[] {
  const top = topCardOf(state, pokemon);
  if (top === undefined) return cost;
  // Nighttime Mine's filtered surcharge adds to League HQ's Basic surcharge.
  const stadium =
    (isBasicPokemon(top) ? (stadiumEffectsOf(state)?.basicAttackCostSurcharge ?? 0) : 0) +
    stadiumFilteredCostSurcharge(state, top);
  const added =
    stadium + opposingAttackCostSurcharge(state, pokemon) + installedCostTaxOf(state, pokemon);
  const net = added - selfAttackCostDiscount(state, pokemon, attackName);
  // Sparkling Crystal's any-type discount is applied last, on the Colorless-adjusted cost.
  const anyType = toolAnyTypeCostDiscount(state, pokemon);
  // Sniper's Eye removes every {C}, including surcharges.
  const colorlessAdjusted = selfIgnoresColorlessCost(state, pokemon)
    ? cost.filter((symbol) => symbol !== "Colorless")
    : colorlessNetCost(cost, net);
  return anyType === 0
    ? colorlessAdjusted
    : anyTypeCostRemoval(colorlessAdjusted, providedEnergy(state, pokemon), anyType);
}

/**
 * The Stadium's filtered attack-cost surcharge (Nighttime Mine) for an attacker whose top card is
 * `top`.
 */
function stadiumFilteredCostSurcharge(state: GameState, top: Card): number {
  const surcharge = stadiumEffectsOf(state)?.attackCostSurcharge;
  return surcharge !== undefined && matchesFilter(top, surcharge.attacker) ? surcharge.amount : 0;
}

/** Appends `net` Colorless for a surcharge or removes them from the end for a discount. */
function colorlessNetCost(cost: readonly string[], net: number): readonly string[] {
  if (net === 0) return cost;
  if (net > 0) return [...cost, ...Array.from({ length: net }, () => "Colorless")];
  // The discount, applied from the END of the printed cost so the symbols the
  // player still owes read left-to-right as the card prints them. Self-flooring:
  // `remaining` simply runs out of Colorless to spend itself on.
  let remaining = -net;
  const kept: string[] = [];
  for (const symbol of [...cost].reverse()) {
    if (remaining > 0 && symbol === "Colorless") {
      remaining--;
      continue;
    }
    kept.push(symbol);
  }
  return kept.reverse();
}
