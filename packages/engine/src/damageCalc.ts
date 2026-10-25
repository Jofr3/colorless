import { topUid } from "./cards";
import { effectiveMaxHp, passivesOf, survivalBraceOf } from "./continuous";
import type { GameEvent } from "./events";
import { flipCoin } from "./rng";
import type { GameState, InPlayPokemon, Seat } from "./types";

// The damage-step checks every damage route shares: the §8.1 KO-survival clamp and the coins that
// can save a body or prevent a hit. The coin funnels consume RNG, so every route flips through them.

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
