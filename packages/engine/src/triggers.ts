import type { ApplyResult } from "./actions";
import { ok } from "./actions";
import { topCardOf, topUid } from "./cards";
import type { GameEvent } from "./events";
import { settleProgram } from "./flow";
import { runProgram } from "./interpreter";
import { programFor } from "./registry";
import type { TriggeredAbility, TriggerTiming } from "./registry";
import type { GameState, InPlayPokemon, PokemonTarget, Seat } from "./types";

// Triggered Abilities (§9, M4 slice 6) — the Abilities that FIRE on a game
// event rather than being player-activated. Three scan points are wired:
//   • onPlayToBench — a Basic played from hand onto the Bench during the
//     controller's turn (turn.ts playBasicToBench — NOT a setup placement,
//     which is a different handler and not "during your turn");
//   • onEvolve — the controller evolved one of their Pokémon (turn.ts evolve);
//   • betweenTurns — the Pokémon Checkup (§13, flow.ts runCheckup);
//   • onKnockOut — this Pokémon was Knocked Out (§8.1, flow.ts KO sweep). It
//     fires during the OPPONENT's turn, mid-KO-sweep. Its detection lives here
//     (onKnockOutTrigger, below) but the KO sweep in flow.ts drives it — a
//     coin-flip Prize guard (Glimmora) resolves inline in the sweep, and a
//     program that needs a decision runs as a koTrigger stage that folds
//     through settleProgram with `resumeTail` (park → resume the KO tail).
//
// The board triggers (onPlayToBench/onEvolve) run during the controller's own
// turn, so they fold their program's result through the SHARED settleProgram
// (flow.ts) exactly like a Trainer/Ability: a decision PARKS on effect:choose
// and RESUMES to turn:action via resolveEffect (cardplay.ts), and a completed
// program that placed lethal damage (Hawlucha's "Flying Entry" snipe) resolves
// its Knock Out as a MID-TURN KO that hands the turn back to the actor.
// The betweenTurns triggers are NON-PARKING by construction (a heal-each / a
// fixed counter placement), so they run synchronously inside the one Checkup
// reduction — their KOs are swept by the Checkup's own collectKnockOuts (a
// between-turns Ability that needed a decision would be new machinery, parking
// mid-Checkup, deferred with on-KO).

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

/** The triggered Abilities on the top card of `pokemon` matching `timing`,
    gated by each one's own `activeOnly` against whether the Pokémon is Active. */
function triggersOf(
  state: GameState,
  pokemon: InPlayPokemon,
  timing: TriggerTiming,
  isActive: boolean,
): TriggeredAbility[] {
  const card = topCardOf(state, pokemon);
  if (card === undefined) return [];
  return (programFor(card.id)?.triggered ?? []).filter(
    (t) => t.trigger === timing && (t.activeOnly !== true || isActive),
  );
}

/** The Pokémon at `target` on `seat`'s board, or undefined when the spot is
    empty / the bench index is out of range (wire indices are checked upstream,
    but stay total). */
function pokemonAt(state: GameState, seat: Seat, target: PokemonTarget): InPlayPokemon | undefined {
  const side = state.players[seat];
  if (target.spot === "active") return side.active ?? undefined;
  return side.bench[target.index];
}

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
  const ability = triggersOf(state, pokemon, timing, target.spot === "active")[0];
  if (ability === undefined) return ok(state, events);
  const uid = topUid(pokemon);
  if (uid === undefined) return ok(state, events);
  // Optional triggers auto-fire (see TriggeredAbility.optional) — the "up to"
  // search still lets the player take none, and the other representatives are
  // pure upside. A yes/no confirm for a downside trigger is the follow-up.
  events.push({ type: "ABILITY_TRIGGERED", seat, uid, ability: ability.name });
  return settleProgram(
    runProgram(state, ability.program, { seat, sourceUid: uid }, events),
    seat,
    events,
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
      for (const ability of triggersOf(next, pokemon, "betweenTurns", target.spot === "active")) {
        events.push({ type: "ABILITY_TRIGGERED", seat, uid, ability: ability.name });
        // Non-parking by construction — a betweenTurns program returns done, so
        // taking .state loses nothing (parking mid-Checkup is deferred).
        next = runProgram(next, ability.program, { seat, sourceUid: uid }, events).state;
      }
    }
  }
  return next;
}
