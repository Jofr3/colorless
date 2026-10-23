import type { ApplyResult } from "./actions";
import { ok } from "./actions";
import { topCardOf, topUid } from "./cards";
// The single once-per-turn key for a triggered row's lock (Zero to Hero).
import { abilityUsedKey } from "./cardplay";
import { disabledAbilityUids, toolsInEffect } from "./continuous";
import type { GameEvent } from "./events";
import { recoverStatuses, settleProgram } from "./flow";
import { runProgram } from "./interpreter";
// The "during their turn" clause: switch on `Phase`, never turn parity. phaseView.ts imports from
// here only as a type, so this value import creates no runtime cycle.
import { phaseViewOf } from "./phaseView";
import { programFor } from "./registry";
import type { TriggeredAbility, TriggerTiming } from "./registry";
import type { GameState, InPlayPokemon, PokemonTarget, Seat } from "./types";
import { inPlayOf, otherSeat, pokemonAt } from "./types";

// Triggered Abilities (§9) fire on a game event rather than being activated. Board triggers
// (onPlayToBench, onEvolve) run on the controller's own turn and settle through `settleProgram`, so
// they may park on a decision. Between-turns triggers never park and run synchronously inside the
// Checkup.

/** The on-KO triggered Ability of the card `uid` names (§8.1), or undefined.
    Resolved through cardIdByUid → programFor, which stays valid AFTER the KO
    discarded the Pokémon (the id map is fixed for the whole game). Consulted by
    the flow.ts KO sweep, both to resolve a coin-flip Prize guard (Glimmora) and
    to run a parking on-KO program as a koTrigger stage. Representatives carry at
    most one on-KO Ability, so the first match is it. */
export function onKnockOutTrigger(state: GameState, uid: string): TriggeredAbility | undefined {
  const cardId = state.cardIdByUid[uid];
  if (cardId === undefined) return undefined;
  return (programFor(cardId)?.triggered ?? []).find((t) => t.trigger === "onKnockOut");
}

/**
 * The triggered Abilities on the top card of `pokemon` matching `timing`, gated by `activeOnly`.
 * `watch` partitions by direction: "self" fires on the controller's own action, "opponent" on the
 * other seat's. The self partition matters: Team Rocket's Ampharos carries an onEvolve row that
 * must not fire when it is itself evolved.
 */
function triggersOf(
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

/** The Pokémon at `target` on `seat`'s board, or undefined when the spot is
    empty / the bench index is out of range (wire indices are checked upstream,
    but stay total). */
/** Run the triggered Ability that fires when the actor's own Pokémon at
    `target` was just played to the Bench / evolved (§9), and fold the result to
    a phase. Returns ok(state) unchanged when nothing fires — the caller
    (playBasicToBench / evolve) passes its board-action events straight through.
    Representative cards carry ONE triggered Ability per timing, so at most one
    program runs here; chaining several parking triggers on one card (a second
    would have to wait for the first to resolve) is a follow-up. */
export function runBoardTrigger(
  state: GameState,
  seat: Seat,
  target: PokemonTarget,
  timing: TriggerTiming,
  events: GameEvent[],
): ApplyResult {
  const pokemon = pokemonAt(state, seat, target);
  if (pokemon === undefined) return ok(state, events);
  const ability = triggersOf(state, pokemon, timing, target.spot === "active", "self")[0];
  if (ability === undefined) return ok(state, events);
  const uid = topUid(pokemon);
  if (uid === undefined) return ok(state, events);
  // A printed once-per-game lock on a board trigger: a spent key fires nothing, and the key is
  // written before the program runs, so declining the inner confirm still spends it.
  let armed = state;
  if (ability.oncePerTurn !== undefined) {
    const usedKey = abilityUsedKey(uid, ability);
    if (state.allowances.abilitiesUsed.includes(usedKey)) return ok(state, events);
    armed = {
      ...state,
      allowances: {
        ...state.allowances,
        abilitiesUsed: [...state.allowances.abilitiesUsed, usedKey],
      },
    };
  }
  // Triggers auto-fire; a printed "you may" with a downside carries its own confirm as an inner
  // `optional` op.
  events.push({ type: "ABILITY_TRIGGERED", seat, uid, ability: ability.name });
  return settleProgram(
    runProgram(armed, ability.program, { seat, sourceUid: uid, invokedBy: "ability" }, events),
    seat,
    events,
  );
}

/**
 * `actorSeat` has just performed a watched action (an evolve or Energy attach from hand) on
 * `subjectUid`; sweeps the other seat's board, Active then Bench, for Abilities that watch it and
 * runs each program. Never parks, since it fires mid-way through the other player's action, so it
 * restores the §12 invariant with `recoverStatuses` instead of `settleProgram`. The caller owns any
 * Knock Out. `doesNotStack` abilities fire once per sweep by name.
 */
export function runWatchedTriggers(
  state: GameState,
  actorSeat: Seat,
  subjectUid: string,
  timing: TriggerTiming,
  events: GameEvent[],
  atMoment: GameState,
): GameState {
  return sweepTriggers(
    state,
    otherSeat(actorSeat),
    subjectUid,
    timing,
    "opponent",
    events,
    atMoment,
  );
}

/**
 * The self direction of the watched sweep: the Ability's bearer is on `actorSeat`'s own board
 * (Magearna "Auto Heal"). Never parks: it fires mid-action inside the actor's own turn.
 */
export function runSelfWatchedTriggers(
  state: GameState,
  actorSeat: Seat,
  subjectUid: string,
  timing: TriggerTiming,
  events: GameEvent[],
  atMoment: GameState,
): GameState {
  return sweepTriggers(state, actorSeat, subjectUid, timing, "self", events, atMoment);
}

/**
 * The shared board sweep for both watched directions; `watcher` is the seat whose board bears the
 * Ability. `atMoment` is the board at the instant of the watched action and is the only thing the
 * `activeOnly` gate may read, because a rider such as Jet Energy's switch may already have moved
 * bodies. The subject is still read off the current board, by uid.
 */
function sweepTriggers(
  state: GameState,
  watcher: Seat,
  subjectUid: string,
  timing: TriggerTiming,
  watch: "self" | "opponent",
  events: GameEvent[],
  atMoment: GameState,
  /**
   * Restricts the sweep to one body, for self-direction triggers about "this Pokémon" moving.
   * Absent means every body.
   */
  onlyUid?: string,
): GameState {
  // Active, then each bench slot. The walk re-reads the CURRENT board each step
  // for `runCheckupTriggers`' reason — and the bench LENGTH cannot change here,
  // so the index walk is stable.
  const targets: PokemonTarget[] = [{ spot: "active" }];
  for (let index = 0; index < state.players[watcher].bench.length; index++) {
    targets.push({ spot: "bench", index });
  }
  // The body that was in the WATCHER's Active Spot at the watched moment, by uid.
  // `undefined` when that seat had no Active then — and a defined `uid` never
  // equals it, which is the right answer (nothing was in the Active Spot).
  const activeAtMoment = atMoment.players[watcher].active;
  const activeUidAtMoment = activeAtMoment === null ? undefined : topUid(activeAtMoment);
  const stacked = new Set<string>();
  let next = state;
  for (const target of targets) {
    const pokemon = pokemonAt(next, watcher, target);
    if (pokemon === undefined) continue;
    const uid = topUid(pokemon);
    if (uid === undefined) continue;
    if (onlyUid !== undefined && uid !== onlyUid) continue;
    for (const ability of triggersOf(next, pokemon, timing, uid === activeUidAtMoment, watch)) {
      if (stacked.has(ability.name)) continue;
      if (ability.doesNotStack === true) stacked.add(ability.name);
      // A printed "Once during your turn" on a trigger, keyed through `abilityUsedKey`. The key is
      // written before the program runs, so the use is spent even if the search fails.
      if (ability.oncePerTurn === true) {
        const usedKey = abilityUsedKey(uid, ability);
        if (next.allowances.abilitiesUsed.includes(usedKey)) continue;
        next = {
          ...next,
          allowances: {
            ...next.allowances,
            abilitiesUsed: [...next.allowances.abilitiesUsed, usedKey],
          },
        };
      }
      events.push({ type: "ABILITY_TRIGGERED", seat: watcher, uid, ability: ability.name });
      next = recoverStatuses(
        runProgram(
          next,
          ability.program,
          { seat: watcher, sourceUid: uid, subjectUid, invokedBy: "ability" },
          events,
        ).state,
        events,
      );
    }
  }
  return next;
}

/**
 * An Active Pokémon moved to the Bench (Magcargo "Lava Zone"). Both movers call this: `switchInto`
 * and `retreat`, which builds its own bench and emits `RETREATED`. "During their turn" is checked
 * with `phaseViewOf`, not turn parity, so a Boss's Orders on the other player's turn fires nothing.
 * `movedUid` is the body that moved, not the new Active.
 */
export function runActiveBenchedTriggers(
  state: GameState,
  seat: Seat,
  movedUid: string,
  events: GameEvent[],
): GameState {
  if (phaseViewOf(state, seat).activeSeat !== seat) return state;
  // `state` is the moment board here: movers only rearrange `seat`'s own board, and the watcher is
  // the other seat.
  const watched = runWatchedTriggers(state, seat, movedUid, "onActiveMovedToBench", events, state);
  // The self direction (Palafin "Zero to Hero"), restricted to the body that moved, behind the same
  // "during your turn" gate. The opponent's watched triggers run first, with no Knock Out check
  // between the two sweeps.
  return sweepTriggers(
    watched,
    seat,
    movedUid,
    "onActiveMovedToBench",
    "self",
    events,
    state,
    movedUid,
  );
}

/** Run every betweenTurns triggered Ability in play during the Pokémon Checkup
    (§13), in `order` (the ended seat first), Active then Bench per seat. These
    are NON-PARKING by construction, so they apply synchronously and the state
    threads straight through — the Checkup's own KO sweep (flow.ts) resolves any
    Knock Out a placed counter caused. None changes the bench LENGTH (heal /
    counter only), so a per-seat index walk over the current board is stable. */
export function runCheckupTriggers(
  state: GameState,
  order: readonly Seat[],
  events: GameEvent[],
): GameState {
  let next = state;
  for (const seat of order) {
    // Active, then each bench slot — re-reading the CURRENT board each step,
    // since a heal/damage replaced the Pokémon object at that spot.
    const targets: PokemonTarget[] = [{ spot: "active" }];
    for (let index = 0; index < next.players[seat].bench.length; index++) {
      targets.push({ spot: "bench", index });
    }
    for (const target of targets) {
      const pokemon = pokemonAt(next, seat, target);
      if (pokemon === undefined) continue;
      const uid = topUid(pokemon);
      if (uid === undefined) continue;
      for (const ability of triggersOf(
        next,
        pokemon,
        "betweenTurns",
        target.spot === "active",
        "self",
      )) {
        events.push({ type: "ABILITY_TRIGGERED", seat, uid, ability: ability.name });
        // Between-turns programs never park, so taking `.state` loses nothing except the §12 status
        // recovery, which is restored here. It runs inside the loop because the invariant is per
        // program.
        next = recoverStatuses(
          runProgram(next, ability.program, { seat, sourceUid: uid, invokedBy: "ability" }, events)
            .state,
          events,
        );
      }
    }
  }
  return next;
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
 * Every on-Active-KO program for the KO of `koedUid`: the dying Active's own
 * `onSelfActiveKnockedOut` Ability first (§9-gated), then Tools in board order, Active first. A
 * Tool on the dying body answers `onHolderActiveKnockedOut`; Tools on other bodies answer
 * `onAllyActiveKnockOut`. Tools are not Abilities, so they are not §9-gated, but `toolsInEffect`
 * lets Jamming Tower silence them. The runner fires only the first match.
 */
export function koToolTriggersOf(
  state: GameState,
  seat: Seat,
  koedUid: string,
): { toolUid: string; holderUid: string; ability: TriggeredAbility; fromAbility?: true }[] {
  const side = state.players[seat];
  const out: {
    toolUid: string;
    holderUid: string;
    ability: TriggeredAbility;
    fromAbility?: true;
  }[] = [];
  const bodies = inPlayOf(side);
  for (const body of bodies) {
    const holderUid = topUid(body);
    if (holderUid === undefined) continue;
    // The dying body's own Ability comes first and is §9-gated; `toolUid` then names the body and
    // `fromAbility` marks it.
    if (holderUid === koedUid && !disabledAbilityUids(state).has(holderUid)) {
      const top = topCardOf(state, body);
      for (const ability of (top === undefined ? undefined : programFor(top.id)?.triggered) ?? []) {
        if (ability.trigger === "onSelfActiveKnockedOut")
          out.push({ toolUid: holderUid, holderUid, ability, fromAbility: true });
      }
    }
    // The KO'd body answers the self timing; every other body answers the ally timing.
    const timing: TriggerTiming =
      holderUid === koedUid ? "onHolderActiveKnockedOut" : "onAllyActiveKnockOut";
    for (const toolUid of toolsInEffect(state, body)) {
      const id = state.cardIdByUid[toolUid];
      if (id === undefined) continue;
      for (const ability of programFor(id)?.triggered ?? []) {
        if (ability.trigger !== timing) continue;
        out.push({ toolUid, holderUid, ability });
      }
    }
  }
  return out;
}

/**
 * Every `onHolderKnockedOut` program on a Tool attached to `body` (Amulet of Hope), in attachment
 * order. The caller gates seat and cause. Not §9-gated; Jamming Tower silences it.
 */
export function koHolderToolTriggersOf(state: GameState, body: InPlayPokemon): string[] {
  return toolsInEffect(state, body).filter((toolUid) => {
    const id = state.cardIdByUid[toolUid];
    return (
      id !== undefined &&
      (programFor(id)?.triggered ?? []).some((ability) => ability.trigger === "onHolderKnockedOut")
    );
  });
}

/** The `timing` program printed on the Tool `toolUid`; still valid after the Tool has left play. */
export function toolTriggerOf(
  state: GameState,
  toolUid: string,
  timing: TriggerTiming,
): TriggeredAbility | undefined {
  const id = state.cardIdByUid[toolUid];
  if (id === undefined) return undefined;
  return (programFor(id)?.triggered ?? []).find((ability) => ability.trigger === timing);
}

/**
 * Every live Tool on `seat`'s Active carrying an `atEndOfYourTurnInActive` program (Powerglass).
 * Not §9-gated.
 */
export function endTurnToolTriggersOf(
  state: GameState,
  seat: Seat,
): { toolUid: string; ability: TriggeredAbility }[] {
  const holder = state.players[seat].active;
  if (holder === null) return [];
  const out: { toolUid: string; ability: TriggeredAbility }[] = [];
  for (const toolUid of toolsInEffect(state, holder)) {
    const id = state.cardIdByUid[toolUid];
    if (id === undefined) continue;
    for (const ability of programFor(id)?.triggered ?? []) {
      if (ability.trigger === "atEndOfYourTurnInActive") out.push({ toolUid, ability });
    }
  }
  return out;
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
