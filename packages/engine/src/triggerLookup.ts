import { topCardOf, topUid } from "./cards";
import { disabledAbilityUids, toolsInEffect } from "./continuous";
import type { TriggeredAbility, TriggerTiming } from "./programTypes";
import { programFor } from "./registry";
import type { GameState, InPlayPokemon, Seat } from "./types";

/**
 * The triggered Abilities on the top card of `pokemon` matching `timing`, gated by `activeOnly`.
 * `watch` partitions by direction: "self" fires on the controller's own action, "opponent" on the
 * other seat's. The self partition matters: Team Rocket's Ampharos carries an onEvolve row that
 * must not fire when it is itself evolved.
 */
export function triggersOf(
  state: GameState,
  pokemon: InPlayPokemon,
  timing: TriggerTiming,
  isActive: boolean,
  watch: "self" | "opponent",
): TriggeredAbility[] {
  const card = topCardOf(state, pokemon);
  if (card === undefined) return [];
  // §9 — a continuous Ability-lock aura suppresses this Pokémon's triggered
  // Abilities too (this is the single choke for onPlayToBench / onEvolve /
  // betweenTurns / onDamagedByAttack). The on-KO trigger (onKnockOutTrigger,
  // above) is deliberately NOT gated: it fires as the Pokémon leaves play.
  const uid = topUid(pokemon);
  if (uid !== undefined && disabledAbilityUids(state).has(uid)) return [];
  return (programFor(card.id)?.triggered ?? []).filter(
    (t) =>
      t.trigger === timing &&
      (t.activeOnly !== true || isActive) &&
      (t.opponentAction === true) === (watch === "opponent"),
  );
}

/**
 * The `onDamagedByAttack` Ability of the Active `uid` (§9). The uid must still be Active, since the
 * attack's own effects may have switched it out before this runs. The program runs under the
 * damaged seat and reaches the attacker through `EffectContext.attackerUid`.
 */
export function damagedByAttackAbility(
  state: GameState,
  seat: Seat,
  uid: string,
): TriggeredAbility | undefined {
  const active = state.players[seat].active;
  if (active === null || topUid(active) !== uid) return undefined;
  return triggersOf(state, active, "onDamagedByAttack", true, "self")[0];
}

/**
 * Every `onDamagedByAttack` program on a Tool attached to `seat`'s Active when that Active is
 * `defenderUid` (Lucky Helmet, Handheld Fan), in attachment order. Active only, as printed. Not
 * §9-gated; Jamming Tower silences them.
 */
export function damagedToolTriggersOf(
  state: GameState,
  seat: Seat,
  defenderUid: string,
): { toolUid: string; ability: TriggeredAbility }[] {
  const active = state.players[seat].active;
  if (active === null || topUid(active) !== defenderUid) return [];
  const out: { toolUid: string; ability: TriggeredAbility }[] = [];
  for (const toolUid of toolsInEffect(state, active)) {
    const id = state.cardIdByUid[toolUid];
    if (id === undefined) continue;
    for (const ability of programFor(id)?.triggered ?? []) {
      if (ability.trigger === "onDamagedByAttack") out.push({ toolUid, ability });
    }
  }
  return out;
}
