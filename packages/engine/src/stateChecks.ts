import { cardOfUid, topUid } from "./cards";
import { benchLimitOf, energyMayBeAttachedTo, owesToolTrim } from "./continuous";
import type { GameEvent } from "./events";
import type { GameState, InPlayPokemon, PendingStage, PokemonTarget, Seat } from "./types";
import { inPlayOf, otherSeat, SEATS, withSide } from "./types";

/**
 * The state checks that run between steps. Team Rocket's Energy is discarded wherever it may not
 * stay, and a seat with a body over `toolCapOf` is queued a `toolTrim` (§7.4 Multi Adapter) ahead
 * of everything else. `advance` runs them before each stage and checks the seat at the head of the
 * queue. `applyAction` runs them once the action settles: it also clears shields whose body left
 * play, and checks the turn's seat only when the turn is back at the action step, queueing a
 * `resumeTurn` behind the trims. The trims are returned on `pending` for the caller to drain.
 */
export function postStepChecks(
  state: GameState,
  after: "stage" | "action",
  events: GameEvent[],
): GameState {
  const swept = discardMisplacedEnergy(state, events);
  if (after === "stage") {
    const head = swept.pending[0];
    const toolTrims = head === undefined ? [] : toolTrimStages(swept, head.seat, swept.pending);
    return toolTrims.length > 0 ? { ...swept, pending: [...toolTrims, ...swept.pending] } : swept;
  }
  const cleared = clearDepartedChosenShields(swept);
  if (cleared.phase.kind !== "turn:action") return cleared;
  const trims = toolTrimStages(cleared, cleared.phase.seat);
  if (trims.length === 0) return cleared;
  const resume = { kind: "resumeTurn" as const, seat: cleared.phase.seat };
  return { ...cleared, pending: [...trims, resume, ...cleared.pending] };
}

/**
 * §6.1 Team Rocket's Energy: "If this card is attached to anything other than a Team Rocket's
 * Pokémon, discard this card." A state check over both seats: every attached Energy that
 * `energyMayBeAttachedTo` refuses on its holder is discarded. Run at the top of `advance`, after
 * every synchronous program op, after a parked op resumes, and on every accepted action, so the
 * card never stays on an invalid body. Returns `state` itself when nothing moves.
 */
export function discardMisplacedEnergy(state: GameState, events: GameEvent[]): GameState {
  let next = state;
  for (const seat of SEATS) {
    const side = next.players[seat];
    const discarded: string[] = [];
    const strip = (pokemon: InPlayPokemon, from: PokemonTarget): InPlayPokemon => {
      const taken = pokemon.energy.filter(
        (uid) => !energyMayBeAttachedTo(state, cardOfUid(state, uid), pokemon),
      );
      if (taken.length === 0) return pokemon;
      discarded.push(...taken);
      events.push({
        type: "ENERGY_DISCARDED",
        seat,
        actor: seat,
        uids: taken,
        from,
        host: topUid(pokemon) ?? "",
      });
      return { ...pokemon, energy: pokemon.energy.filter((uid) => !taken.includes(uid)) };
    };
    const active = side.active === null ? null : strip(side.active, { spot: "active" });
    const bench = side.bench.map((pokemon, index) => strip(pokemon, { spot: "bench", index }));
    if (discarded.length === 0) continue;
    next = withSide(next, seat, {
      ...side,
      active,
      bench,
      discard: [...side.discard, ...discarded],
    });
  }
  return next;
}

/**
 * §11 Acerola's Mischief's shield ends when its body leaves play. A replayed card keeps its uid, so
 * this clears a `chosenAttackShield` whose uid is no longer the base card of an in-play body. A
 * body that leaves and returns within one action keeps it. Returns `state` itself when nothing
 * changes.
 */
export function clearDepartedChosenShields(state: GameState): GameState {
  let next = state;
  for (const seat of SEATS) {
    const side = next.players[seat];
    const record = side.chosenAttackShield;
    // `undefined` is an unmigrated side: skip it rather than writing `null`, so the reader still
    // fails loudly.
    if (record === null || record === undefined) continue;
    const bodies = inPlayOf(side);
    if (bodies.some((body) => body.stack[0] === record.uid)) continue;
    next = withSide(next, seat, { ...side, chosenAttackShield: null });
  }
  return next;
}

/**
 * §7.3: the Area Zero Underdepths state check: one `benchTrim` stage per seat whose Bench exceeds
 * `benchLimitOf`, `first` then the other seat, skipping seats already queued. When the Stadium
 * leaves, its owner discards first. The stage carries no count; `runBenchTrim` re-reads the excess.
 */
export function benchTrimStages(
  state: GameState,
  first: Seat,
  queued: readonly PendingStage[] = [],
): PendingStage[] {
  return [first, otherSeat(first)]
    .filter(
      (seat) =>
        state.players[seat].bench.length > benchLimitOf(state, seat) &&
        !queued.some((stage) => stage.kind === "benchTrim" && stage.seat === seat),
    )
    .map((seat): PendingStage => ({ kind: "benchTrim", seat }));
}

/**
 * §7.4: Multi Adapter's "If this Ability goes away, discard Pokémon Tools from those Pokémon until
 * only 1 remains on each" as a state check: one `toolTrim` stage per seat with a body that
 * `owesToolTrim`, `first` then the other seat. Over-cap is the whole test, so any way the cap drops
 * is covered; a body not named by a raise is never trimmed.
 */
export function toolTrimStages(
  state: GameState,
  first: Seat,
  queued: readonly PendingStage[] = [],
): PendingStage[] {
  return [first, otherSeat(first)]
    .filter((seat) => {
      if (queued.some((stage) => stage.kind === "toolTrim" && stage.seat === seat)) return false;
      const side = state.players[seat];
      const bodies = inPlayOf(side);
      return bodies.some((body) => owesToolTrim(state, seat, body));
    })
    .map((seat): PendingStage => ({ kind: "toolTrim", seat }));
}
