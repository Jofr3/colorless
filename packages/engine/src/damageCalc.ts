import type { Card } from "@colorless/schema";
import {
  hasPrintedAbility,
  isExOrV,
  preventsAttackerBanner,
  preventsAttackerClass,
  topUid,
} from "./cards";
import type { PokemonPassives } from "./continuous";
import {
  attackBlockOf,
  attackerGatedReductionOf,
  attackerHasSpecialEnergy,
  benchShieldedFromDamage,
  berryReductionOf,
  effectiveMaxHp,
  installedReductionOf,
  installedVulnerabilityOf,
  NO_CONSUMABLE,
  passivesOf,
  preventedByDamageThreshold,
  preventsAttackerType,
  seatDamageReduction,
  seatShieldedFromLowEnergyAttacker,
  stadiumPreventsDamage,
  survivalBraceOf,
} from "./continuous";
import type { GameEvent } from "./events";
import { flipCoin } from "./rng";
import type { GameState, InPlayPokemon, Seat } from "./types";
import { withAttackDamageTaken } from "./types";

// The damage-step tail every attack-damage route shares: the §8.5 reductions and preventions after
// Weakness and Resistance, the §8.1 KO-survival clamp, and the coins that can save a body or prevent
// a hit. The coin funnels consume RNG, so every route flips through them, in one order.

/** §8.1 KO SURVIVAL — the HP `remaining` a clamped body is left with. The printed
    number, converted once, here, where the family's other printed constants are
    (`damageAttackerOnKo`'s counters are converted at the registry row for the same
    reason): "its remaining HP becomes 10". */
const KO_SURVIVAL_REMAINING_HP = 10;

/**
 * Result of `koSurvivalClamp`: the new `damage` total and, when Survival Brace answered, its uid so
 * the damage write can discard it. `toolUid` is undefined for an Ability-only survival.
 */
export type KoSurvival = { damage: number; toolUid: string | undefined };

/**
 * §8.1 KO-survival clamp ("If this Pokémon has full HP and would be Knocked Out by damage from an
 * attack, it is not Knocked Out, and its remaining HP becomes 10."; also Survival Brace against
 * `attackerSeat`). Returns the new damage total, or null when it does not fire. It runs at the
 * damage writes, not KO detection, because "full HP" is only knowable before the hit lands; once
 * clamped, the body is simply not lethally damaged downstream. Placed counters are not damage and
 * never reach this. Uses `effectiveMaxHp` so HP bonuses count, and `>=` like `isLethallyDamaged`.
 */
export function koSurvivalClamp(
  state: GameState,
  pokemon: InPlayPokemon,
  dealt: number,
  attackerSeat: Seat,
): KoSurvival | null {
  if (pokemon.damage !== 0) return null;
  const toolUid = survivalBraceOf(state, pokemon, attackerSeat);
  if (toolUid === undefined && !passivesOf(state, pokemon).survivesKoAtFullHp) return null;
  const hp = effectiveMaxHp(state, pokemon);
  if (hp === null) return null;
  if (pokemon.damage + dealt < hp) return null;
  // "its remaining HP becomes 10" — the damage total that leaves exactly that much
  // standing. Floored, so a printing with 10 HP or less lands at 0 rather than
  // negative damage; no such body exists in the pool and the floor is not load-
  // bearing, it is `Math.max(0, …)` for the reason every other write site has one.
  return { damage: Math.max(0, hp - KO_SURVIVAL_REMAINING_HP), toolUid };
}

/**
 * §8.1 coin-flip survival (Tenacious Body, Durable Body): "If this Pokémon would be Knocked Out by
 * damage from an attack, flip a coin. If heads, this Pokémon is not Knocked Out, and its remaining
 * HP becomes 10." Callers ask only when `koSurvivalClamp` returned null. Returns `[damage,
 * rngState]`; no coin unless a live source exists, max HP is known, the body is not already
 * lethally damaged, and the hit is lethal.
 */
export function koSurvivalCoinFlip(
  state: GameState,
  pokemon: InPlayPokemon,
  seat: Seat,
  dealt: number,
  events: GameEvent[],
): [damage: number | null, rngState: number] {
  const ability = passivesOf(state, pokemon).survivesKoOnCoinFlip;
  if (ability === null) return [null, state.rngState];
  const hp = effectiveMaxHp(state, pokemon);
  if (hp === null || pokemon.damage >= hp || pokemon.damage + dealt < hp)
    return [null, state.rngState];
  const uid = topUid(pokemon);
  if (uid === undefined) return [null, state.rngState];
  const [face, rngState] = flipCoin(state.rngState);
  events.push({ type: "ABILITY_COIN_FLIP", seat, uid, ability, result: face });
  return [face === "heads" ? Math.max(0, hp - KO_SURVIVAL_REMAINING_HP) : null, rngState];
}

/**
 * §8.5 coin-flip shield ("flip a coin. If heads, prevent that damage."). A single funnel because it
 * consumes RNG and every site must flip the same coins. Draws no coin when `damage` is 0, so
 * callers pass 0 when something else already prevented it; it must be the last prevention term. One
 * coin per source, all flipped even after heads. `seat` is the damaged body's owner. Kept out of
 * `passivesOf`, which must stay pure.
 */
export function coinFlipShieldPrevents(
  state: GameState,
  pokemon: InPlayPokemon,
  seat: Seat,
  damage: number,
  events: GameEvent[],
): [prevented: boolean, rngState: number] {
  if (damage <= 0) return [false, state.rngState];
  const uid = topUid(pokemon);
  if (uid === undefined) return [false, state.rngState];
  const shields = passivesOf(state, pokemon).preventDamageOnCoinFlip;
  let rngState = state.rngState;
  let prevented = false;
  for (const shield of shields) {
    const [face, next] = flipCoin(rngState);
    rngState = next;
    events.push({ type: "ABILITY_COIN_FLIP", seat, uid, ability: shield.ability, result: face });
    if (face === "heads") prevented = true;
  }
  return [prevented, rngState];
}

/**
 * The Tools one §8.5 hit consumed: the Berries that reduced it (empty for a prevented hit) and the
 * Survival Brace the clamp used, if any.
 */
function consumedTools(berryUids: readonly string[], clamped: KoSurvival | null): string[] {
  return clamped?.toolUid === undefined ? [...berryUids] : [...berryUids, clamped.toolUid];
}

/**
 * Strip the `spent` Tools off `pokemon` and file one `TOOLS_DISCARDED { when: "consumed" }` row
 * under the holder's owner. The caller appends the uids to that owner's discard pile. Nothing spent
 * returns the body unchanged.
 */
export function consumeTools(
  pokemon: InPlayPokemon,
  spent: readonly string[],
  seat: Seat,
  events: GameEvent[],
): InPlayPokemon {
  if (spent.length === 0) return pokemon;
  events.push({
    type: "TOOLS_DISCARDED",
    seat,
    actor: seat,
    uids: [...spent],
    host: topUid(pokemon) ?? "",
    when: "consumed",
  });
  return { ...pokemon, tools: pokemon.tools.filter((uid) => !spent.includes(uid)) };
}

/** The `DAMAGE_DEALT` fields a route fills itself: its base and its pre-W/R and W/R steps. */
export type DamageRow = Pick<
  Extract<GameEvent, { type: "DAMAGE_DEALT" }>,
  "base" | "scaled" | "bonus" | "debuff" | "weakness" | "resistance"
>;

/** One attack-damage hit on one body, as it reaches the step after Weakness and Resistance. */
export interface AttackDamage {
  body: InPlayPokemon;
  /** The damaged body's owner. */
  seat: Seat;
  uid: string;
  passives: PokemonPassives;
  /** The attacker's in-play card and body, undefined when the attacking spot is empty. */
  attacker: Card | undefined;
  attackerBody: InPlayPokemon | undefined;
  /** The dealer, which is also `seat` when an attack damages its own Bench. */
  attackerSeat: Seat;
  /** "Isn't affected by any effects on that Pokémon": the on-target reductions and preventions
      drop, and an aura or shield counts only when another Pokémon grants it. */
  ignoreTargetEffects: boolean;
  /** Whether an attack is doing the damage, which a §11 block reads. */
  invokedByAttack: boolean;
  /** The pre-W/R amount, floored at 0. */
  preWR: number;
  /** After Weakness and Resistance, floored at 0; equal to `preWR` on the Bench. */
  afterWR: number;
  row: DamageRow;
}

/** What `landAttackHit` wrote: the damaged body, and the Tools it spent for the owner's pile. */
export interface LandedHit {
  body: InPlayPokemon;
  dealt: number;
  spent: string[];
  rngState: number;
}

/**
 * "Takes N less damage from attacks (after applying Weakness and Resistance)": catalog Abilities
 * and Tools, attacker-gated reductions, installed reductions, own-side seat-wide auras and Berries,
 * plus an installed vulnerability. At a pre-W/R amount of 0 the damage steps stop, so no Berry is
 * asked (nor spent) and no vulnerability adds.
 */
function reductionAfterWR(
  state: GameState,
  hit: AttackDamage,
): { berry: typeof NO_CONSUMABLE; reduction: number; vulnerability: number } {
  const { body, passives, attacker, attackerBody, attackerSeat, ignoreTargetEffects } = hit;
  const unasked = ignoreTargetEffects || hit.preWR === 0;
  const berry = unasked ? NO_CONSUMABLE : berryReductionOf(state, body, attacker, attackerSeat);
  const reduction = ignoreTargetEffects
    ? seatDamageReduction(state, body, "othersOnly", attackerSeat)
    : berry.amount +
      passives.damageReductionAfterWR +
      attackerGatedReductionOf(
        state,
        body,
        passives.damageReductionsFromAttacker,
        attacker,
        attackerSeat,
      ) +
      installedReductionOf(state, body, attacker, attackerBody) +
      seatDamageReduction(state, body, "all", attackerSeat);
  const vulnerability = unasked ? 0 : installedVulnerabilityOf(state, body);
  return { berry, reduction, vulnerability };
}

/**
 * Full prevention, which supersedes any reduction. Catalog auras on the damaged body and installed
 * blocks are on-target, so `ignoreTargetEffects` drops them; a bench shield, Ancient Bulwark and the
 * Stadium are off-target and stay, losing only the part the damaged body grants itself. Every term
 * is pure: the coin-flip shield is asked afterwards, so no coin is flipped for damage already
 * stopped.
 */
function preventedBeforeFlip(state: GameState, hit: AttackDamage, wouldDeal: number): boolean {
  const { body, seat, passives, attacker, attackerBody, attackerSeat } = hit;
  const scope = hit.ignoreTargetEffects ? "othersOnly" : "all";
  return (
    (!hit.ignoreTargetEffects &&
      ((passives.preventDamageFromExV && attacker !== undefined && isExOrV(attacker)) ||
        preventsAttackerType(passives.preventDamageFromTypes, attacker) ||
        (passives.preventDamageFromHasAbility && hasPrintedAbility(attacker)) ||
        preventsAttackerClass(passives.preventDamageFromAttackerClasses, attacker) ||
        preventsAttackerBanner(passives.preventDamageAndEffectsFromBanners, attacker) ||
        // Gates on the attacking body's attachments.
        (passives.preventDamageAndEffectsFromSpecialEnergy &&
          attackerHasSpecialEnergy(state, attackerBody)) ||
        // Plume Protection prints "attacks from your opponent's Pokémon", so an own-Bench hit lands.
        (passives.preventDamageWhileBenched && seat !== attackerSeat) ||
        passives.preventDamageAndEffectsWhileBenched ||
        // "Or more" is read against this body's own amount, not the attack's printed damage. ORed
        // with a block's cap, not merged: different channels with opposite polarity.
        preventedByDamageThreshold(passives.preventDamageAtOrAbove, wouldDeal) ||
        (hit.invokedByAttack &&
          attackBlockOf(state, body, attacker, wouldDeal, attackerBody) !== null))) ||
    benchShieldedFromDamage(state, body, scope) ||
    seatShieldedFromLowEnergyAttacker(state, body, attackerBody, attackerSeat, scope) ||
    stadiumPreventsDamage(state, body, attacker)
  );
}

/**
 * §8.5 from after Weakness and Resistance to the damage write: reduction, prevention, the coin-flip
 * shield, the §8.1 KO-survival clamp and survival coin, then the `DAMAGE_DEALT` row and the Tools
 * the hit consumed. `state.rngState` is where the coins start. `dealt` is not clamped, so the
 * `dealt > 0` reactions still see the damage; the damage is recorded on the body (Juggernaut Horn).
 */
export function landAttackHit(state: GameState, hit: AttackDamage, events: GameEvent[]): LandedHit {
  const { body, seat, uid, attackerSeat } = hit;
  const { berry, reduction, vulnerability } = reductionAfterWR(state, hit);
  // The damage cap and the threshold read the number that would actually be placed.
  const wouldDeal = Math.max(0, hit.afterWR + vulnerability - reduction);
  const blocked = preventedBeforeFlip(state, hit, wouldDeal);
  // A nulled or already-prevented hit passes 0, so the shield draws no coin at all.
  const [flipPrevented, flipRng] = coinFlipShieldPrevents(
    state,
    body,
    seat,
    blocked || hit.ignoreTargetEffects ? 0 : wouldDeal,
    events,
  );
  const prevented = blocked || flipPrevented;
  const dealt = prevented ? 0 : wouldDeal;
  // "Has full HP" is a pre-damage fact, so the clamp reads the body before the write.
  const clamped = koSurvivalClamp(state, body, dealt, attackerSeat);
  const [coinSaved, rngState] =
    clamped === null
      ? koSurvivalCoinFlip({ ...state, rngState: flipRng }, body, seat, dealt, events)
      : [null, flipRng];
  const damage = clamped?.damage ?? coinSaved ?? body.damage + dealt;
  events.push({
    type: "DAMAGE_DEALT",
    seat,
    by: attackerSeat,
    uid,
    ...hit.row,
    reduction: reduction > 0 ? reduction : undefined,
    vulnerability: vulnerability > 0 ? vulnerability : undefined,
    prevented: prevented ? true : undefined,
    survived: clamped === null && coinSaved === null ? undefined : true,
    dealt,
    damage,
  });
  // Consumed Tools leave after the row that shows what they did: a Berry is spent on any
  // unprevented hit it reduced, a Brace only when the clamp used it.
  const spent = consumedTools(prevented ? [] : berry.toolUids, clamped);
  const landed = withAttackDamageTaken(
    { ...consumeTools(body, spent, seat, events), damage },
    state.turn,
    dealt,
  );
  return { body: landed, dealt, spent, rngState };
}
