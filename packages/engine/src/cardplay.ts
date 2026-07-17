import type {
  ApplyResult,
  PlayTrainerAction,
  ResolveEffectAction,
  UseAbilityAction,
} from "./actions";
import { err, ok } from "./actions";
import { cardOfUid, topUid } from "./cards";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import type { EffectChoice, EffectPrompt, PokemonRef, RunResult } from "./interpreter";
import { resumeProgram, runProgram } from "./interpreter";
import { programFor } from "./registry";
import { isBenchIndex, isPokemonTarget, turnGate } from "./turn";
import type { GameState, InPlayPokemon, PokemonTarget, Seat } from "./types";
import { otherSeat, withSide, without } from "./types";

// The M4 card-play actions (§7 Trainers, §9 Abilities) and the resolver for the
// mid-effect decisions they park on (§15.E/G). All three orchestrate the same
// shared interpreter (interpreter.ts): validate the play, announce it, run the
// op program, and either finish (back to turn:action) or PARK on effect:choose.

/** §7.1/§7.2 — play a Trainer (Item any number, Supporter one per turn) from
    hand: resolve its authored program, then the card is discarded. Stadium and
    Tool (persistent zones) are a later slice. */
export function playTrainer(state: GameState, action: PlayTrainerAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  const side = state.players[action.seat];
  if (!side.hand.includes(action.uid)) {
    return err("CARD_NOT_IN_HAND", `${action.uid} is not in ${action.seat}'s hand`);
  }
  const card = cardOfUid(state, action.uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${action.uid}`);
  }
  if (card.category !== "Trainer") {
    return err("NOT_A_TRAINER", `${card.name} is not a Trainer card`);
  }
  const trainerType = card.trainerType;
  if (trainerType !== "Item" && trainerType !== "Supporter") {
    return err("TRAINER_TYPE_UNSUPPORTED", `${trainerType ?? "this"} Trainers are not supported yet`);
  }
  const program = programFor(card.id)?.trainer;
  if (program === undefined) {
    // Coverage strategy: an unauthored Trainer surfaces loudly rather than
    // playing as a silent no-op that still costs the player the card.
    return err("TRAINER_NOT_SIMULATED", `${card.name} is not simulated yet`);
  }
  if (trainerType === "Supporter") {
    // §4 — the going-first player may not play a Supporter on turn 1 (turn 1 is
    // by construction their turn, and the gate proved this is the actor's turn).
    if (state.turn === 1) {
      return err("FIRST_TURN_SUPPORTER", "the going-first player cannot play a Supporter on turn 1 (§4)");
    }
    if (state.allowances.supporterPlayed) {
      return err("SUPPORTER_ALREADY_PLAYED", "only one Supporter per turn (§7.2)");
    }
  }
  if (!trainerPlayable(state, program, action.seat)) {
    return err("NO_LEGAL_TARGET", `${card.name} has no legal target`);
  }

  // Play it: the card leaves hand for the discard (Item/Supporter discard after
  // resolving — none in scope references itself mid-effect, so discarding up
  // front is equivalent and spares threading its uid through the continuation).
  const events: GameEvent[] = [
    { type: "TRAINER_PLAYED", seat: action.seat, uid: action.uid, trainerType },
  ];
  let next: GameState = withSide(state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
    discard: [...side.discard, action.uid],
  });
  if (trainerType === "Supporter") {
    next = { ...next, allowances: { ...next.allowances, supporterPlayed: true } };
  }
  return settleRun(runProgram(next, program, { seat: action.seat }, events), action.seat, events);
}

/** §9 — use an in-play Pokémon's activated Ability. Does not cost energy, does
    not end the turn (once-per-turn per Pokémon, tracked in TurnAllowances). */
export function useAbility(state: GameState, action: UseAbilityAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "ability target must name the Active spot or a bench index");
  }
  const resolved = resolveOwnPokemon(state, action.seat, action.target);
  if (resolved.reject !== undefined) return resolved.reject;
  const uid = resolved.uid;
  const card = cardOfUid(state, uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${uid}`);
  }
  const ability = (programFor(card.id)?.abilities ?? []).find((a) => a.name === action.abilityName);
  if (ability === undefined) {
    return err("NO_SUCH_ABILITY", `${card.name} has no usable Ability "${action.abilityName}"`);
  }
  if (ability.activeOnly && action.target.spot !== "active") {
    return err("ABILITY_ACTIVE_ONLY", `${ability.name} can only be used from the Active Spot (§9)`);
  }
  const usedKey = `${uid}:${ability.name}`;
  if (ability.oncePerTurn && state.allowances.abilitiesUsed.includes(usedKey)) {
    return err("ABILITY_ALREADY_USED", `${ability.name} was already used this turn (§9)`);
  }

  const events: GameEvent[] = [{ type: "ABILITY_USED", seat: action.seat, uid, ability: ability.name }];
  const next: GameState = ability.oncePerTurn
    ? {
        ...state,
        allowances: {
          ...state.allowances,
          abilitiesUsed: [...state.allowances.abilitiesUsed, usedKey],
        },
      }
    : state;
  return settleRun(runProgram(next, ability.program, { seat: action.seat }, events), action.seat, events);
}

/** Resolve the parked effect:choose decision: validate the choice against the
    prompt, apply the awaited op, and run the rest of the program (which may
    park again). */
export function resolveEffect(state: GameState, action: ResolveEffectAction): ApplyResult {
  if (state.phase.kind !== "effect:choose") {
    return err("BAD_PHASE", `resolveEffect is not legal during ${state.phase.kind}`);
  }
  const phase = state.phase;
  if (phase.seat !== action.seat) {
    return err("WRONG_SEAT", `only ${phase.seat} resolves this effect`);
  }
  const invalid = validateChoice(phase.prompt, action.choice);
  if (invalid !== null) return invalid;
  const events: GameEvent[] = [];
  return settleRun(resumeProgram(state, phase.cont, action.choice, events), phase.seat, events);
}

/** Fold a runProgram/resumeProgram result into an ApplyResult: DONE returns to
    the controller's turn:action (restoring it after a parked resolve); PARKED
    sets the effect:choose interrupt and announces it (EFFECT_PENDING) so an
    event-only client never hangs. No effect in scope KOs or wins, so there is
    no tail/win interaction here — a future damaging op adds it. */
function settleRun(result: RunResult, controller: Seat, events: GameEvent[]): ApplyResult {
  if (result.kind === "done") {
    return ok({ ...result.state, phase: { kind: "turn:action", seat: controller } }, events);
  }
  events.push({ type: "EFFECT_PENDING", seat: controller, note: result.prompt.note });
  return ok(
    {
      ...result.state,
      phase: { kind: "effect:choose", seat: controller, prompt: result.prompt, cont: result.cont },
    },
    events,
  );
}

/** A Trainer whose only effect targets a zone that is empty does nothing, and a
    card that would do nothing cannot be played (gust needs an opponent Bench,
    Switch needs a Bench). Search/draw/heal are always "playable enough" (they
    may whiff — fail a search, heal an undamaged Pokémon). */
function trainerPlayable(state: GameState, program: readonly EffectOp[], seat: Seat): boolean {
  for (const op of program) {
    if (op.op === "gust" && state.players[otherSeat(seat)].bench.length === 0) return false;
    if (op.op === "switchActive" && state.players[seat].bench.length === 0) return false;
  }
  return true;
}

/** Resolve one of the actor's own in-play Pokémon off a wire target: the
    Active (must be present) or a benched index (checked like every wire index). */
function resolveOwnPokemon(
  state: GameState,
  seat: Seat,
  target: PokemonTarget,
): { pokemon: InPlayPokemon; uid: string; reject?: undefined } | { reject: ApplyResult } {
  const side = state.players[seat];
  let pokemon: InPlayPokemon;
  if (target.spot === "active") {
    if (side.active === null) return { reject: err("NO_TARGET", "no Active Pokémon") };
    pokemon = side.active;
  } else {
    const benched = isBenchIndex(target.index) ? side.bench[target.index] : undefined;
    if (benched === undefined) {
      return { reject: err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(target.index)}`) };
    }
    pokemon = benched;
  }
  const uid = topUid(pokemon);
  if (uid === undefined) return { reject: err("UNKNOWN_CARD", "the Pokémon has no resolvable top card") };
  return { pokemon, uid };
}

/** Wire-check a resolveEffect choice against the parked prompt (a P4 client
    controls it): the right kind, and every uid/ref among the legal options. */
function validateChoice(prompt: EffectPrompt, choice: EffectChoice): ApplyResult | null {
  if (typeof choice !== "object" || choice === null) {
    return err("BAD_EFFECT_CHOICE", "choice must be an object");
  }
  if (prompt.kind === "chooseCards") {
    if (choice.kind !== "cards" || !Array.isArray(choice.uids)) {
      return err("BAD_EFFECT_CHOICE", "expected a card choice");
    }
    if (choice.uids.length > prompt.max) {
      return err("BAD_EFFECT_CHOICE", `pick at most ${prompt.max} card(s)`);
    }
    const candidates = new Set(prompt.candidates);
    const seen = new Set<string>();
    for (const uid of choice.uids) {
      if (typeof uid !== "string" || !candidates.has(uid)) {
        return err("BAD_EFFECT_CHOICE", `${String(uid)} is not a searchable card`);
      }
      if (seen.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
      seen.add(uid);
    }
    return null;
  }
  // choosePokemon — exactly one of the offered refs.
  if (choice.kind !== "pokemon" || !isPokemonRef(choice.ref)) {
    return err("BAD_EFFECT_CHOICE", "expected a Pokémon choice");
  }
  const ref = choice.ref;
  if (!prompt.candidates.some((c) => refEquals(c, ref))) {
    return err("BAD_EFFECT_CHOICE", "that Pokémon is not a legal target");
  }
  return null;
}

function isPokemonRef(value: unknown): value is PokemonRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as { seat?: unknown; spot?: unknown };
  if (ref.seat !== "p1" && ref.seat !== "p2") return false;
  return isPokemonTarget(ref.spot);
}

function refEquals(a: PokemonRef, b: PokemonRef): boolean {
  if (a.seat !== b.seat || a.spot.spot !== b.spot.spot) return false;
  if (a.spot.spot === "bench" && b.spot.spot === "bench") return a.spot.index === b.spot.index;
  return true;
}
