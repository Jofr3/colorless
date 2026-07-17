import type {
  ApplyResult,
  AttachEnergyAction,
  EndTurnAction,
  GameAction,
  PlayBasicToBenchAction,
  RetreatAction,
} from "./actions";
import { err, ok } from "./actions";
import { basicFromHandError, cardOfUid, isEnergyCard, retreatCostOf, topUid } from "./cards";
import type { GameEvent, StatusName } from "./events";
import { advance, turnTail } from "./flow";
import type {
  GameState,
  InPlayPokemon,
  PlayerSide,
  PokemonTarget,
  Seat,
  SpecialConditions,
} from "./types";
import {
  BENCH_MAX,
  discardFromStack,
  isImmobilized,
  makeInPlay,
  noConditions,
  withSide,
  without,
} from "./types";

// The in-turn actions (rules §5). Turn start/end mechanics live in flow.ts:
// ending a turn seeds the staged tail (TURN_ENDED → checkup → the opponent's
// startTurn) and `advance` drains it — attack.ts feeds the same tail with
// the KO stages in front, which is why the tail is a queue and not a call.

/** Bench slots are array indices, and the arrays are dense. The `Number` check
    guards the wire: TS says these are numbers, JSON does not, and a string
    index misbehaves silently rather than loudly (see the call sites). */
export function isBenchIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < BENCH_MAX;
}

/** The gate every in-turn action shares: right phase, right seat. Returns
    the rejection, or null when the action may proceed (the same contract as
    basicFromHandError) — no handler consumes the narrowed phase, they act on
    the seat and the allowances alone. */
export function turnGate(
  state: GameState,
  action: { type: GameAction["type"]; seat: Seat },
): ApplyResult | null {
  const phase = state.phase;
  if (phase.kind !== "turn:action") {
    return err("BAD_PHASE", `${action.type} is not legal during ${phase.kind}`);
  }
  if (phase.seat !== action.seat) {
    return err("WRONG_SEAT", `it is ${phase.seat}'s turn`);
  }
  return null;
}

/** The attach target off the wire: a non-null object naming a legal `spot`.
    Like every wire value (types are not validation) — a null or garbled
    shape must reject, not throw on `.spot`. The bench index is checked at
    the use site (isBenchIndex), same as every other wire index. */
function isPokemonTarget(value: unknown): value is PokemonTarget {
  if (typeof value !== "object" || value === null) return false;
  const spot = (value as { spot?: unknown }).spot;
  return spot === "active" || spot === "bench";
}

/** §6.2 — exactly one energy attachment per turn, from hand, onto any of
    the actor's Pokémon (Active or Bench). */
export function attachEnergy(state: GameState, action: AttachEnergyAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  if (state.allowances.energyAttached) {
    return err("ENERGY_ALREADY_ATTACHED", "only one energy attachment per turn (§6.2)");
  }
  const side = state.players[action.seat];
  if (!side.hand.includes(action.uid)) {
    return err("CARD_NOT_IN_HAND", `${action.uid} is not in ${action.seat}'s hand`);
  }
  const card = cardOfUid(state, action.uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${action.uid}`);
  }
  if (!isEnergyCard(card)) {
    return err("NOT_AN_ENERGY", `${card.name} is not an Energy card`);
  }
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "attach target must name the Active spot or a bench index");
  }

  const hand = without(side.hand, action.uid);
  let updated: PlayerSide;
  if (action.target.spot === "active") {
    if (side.active === null) {
      return err("NO_TARGET", "no Active Pokémon to attach to");
    }
    updated = {
      ...side,
      hand,
      active: { ...side.active, energy: [...side.active.energy, action.uid] },
    };
  } else {
    const index = action.target.index;
    // The integer check is not pedantry: a wire-decoded `"1"` indexes the
    // bench array fine (string key) but never matches the `i === index`
    // compare below, so the energy would leave the hand and attach to
    // nothing — a destroyed card and a burned attachment allowance.
    if (!isBenchIndex(index) || side.bench[index] === undefined) {
      return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(index)}`);
    }
    const bench = side.bench.map((pokemon, i) =>
      i === index ? { ...pokemon, energy: [...pokemon.energy, action.uid] } : pokemon,
    );
    updated = { ...side, hand, bench };
  }
  const next: GameState = {
    ...withSide(state, action.seat, updated),
    allowances: { ...state.allowances, energyAttached: true },
  };
  return ok(next, [
    // The target is copied: the action object belongs to the caller, and an
    // emitted event must not alias it (see events.ts).
    { type: "ENERGY_ATTACHED", seat: action.seat, uid: action.uid, target: { ...action.target } },
  ]);
}

/** §5.2 — Basics to the bench, any number per turn, cap 5. */
export function playBasicToBench(state: GameState, action: PlayBasicToBenchAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  const side = state.players[action.seat];
  if (side.bench.length >= BENCH_MAX) {
    return err("BENCH_FULL", `the bench holds at most ${BENCH_MAX} Pokémon`);
  }
  const invalid = basicFromHandError(state, action.seat, action.uid);
  if (invalid !== null) return invalid;

  // makeInPlay records turnPlayed — M4's evolution timing ("not the turn it
  // came into play", §10) reads it.
  const next = withSide(state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
    bench: [...side.bench, makeInPlay(action.uid, state.turn)],
  });
  return ok(next, [{ type: "POKEMON_BENCHED", seat: action.seat, uid: action.uid }]);
}

/** Leaving the Active spot removes Special Conditions (§11/§12) — M4 adds
    dropping active-only markers here too. */
function clearOnLeavingActive(pokemon: InPlayPokemon): InPlayPokemon {
  return { ...pokemon, conditions: noConditions() };
}

/** The conditions present, in the event vocabulary — what a "benched"
    STATUS_CLEARED lists. Stable order: the rotation first, then poisoned,
    then burned. */
function presentStatuses(conditions: SpecialConditions): StatusName[] {
  const statuses: StatusName[] = [];
  if (conditions.rotation !== "none") statuses.push(conditions.rotation);
  if (conditions.poisonDamage > 0) statuses.push("poisoned");
  if (conditions.burned) statuses.push("burned");
  return statuses;
}

/** §11 — once per turn: the player names WHICH attached energies pay the
    cost (count must equal the top card's retreat cost exactly) and which
    benched Pokémon takes the Active spot. */
export function retreat(state: GameState, action: RetreatAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  if (state.allowances.retreated) {
    return err("ALREADY_RETREATED", "only one retreat per turn (§11)");
  }
  const side = state.players[action.seat];
  const active = side.active;
  if (active === null) {
    // Unreachable — KO promotion is forced before the next action, so the
    // Active spot is never empty during turn:action.
    return err("NO_TARGET", "no Active Pokémon to retreat");
  }
  // §11/§12 — an Asleep or Paralyzed Active cannot retreat. (Confusion does
  // not restrict retreating.)
  const rotation = active.conditions.rotation;
  if (isImmobilized(active.conditions)) {
    return err(
      "STATUS_PREVENTS_RETREAT",
      `${rotation === "asleep" ? "an Asleep" : "a Paralyzed"} Pokémon cannot retreat (§11)`,
    );
  }
  if (side.bench.length === 0) {
    return err("BENCH_EMPTY", "cannot retreat with an empty bench (§11)");
  }
  // Same wire-decode trap as attachEnergy, but worse: a string index would
  // reach `slice(index + 1)` as a CONCATENATION ("1" + 1 = "11"), silently
  // deleting every benched Pokémon past the promoted slot.
  const promoteBenchIndex = action.promoteBenchIndex;
  const promoted = isBenchIndex(promoteBenchIndex) ? side.bench[promoteBenchIndex] : undefined;
  if (promoted === undefined) {
    return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(promoteBenchIndex)}`);
  }
  const activeTopUid = topUid(active);
  const promotedTopUid = topUid(promoted);
  if (activeTopUid === undefined || promotedTopUid === undefined) {
    return err("UNKNOWN_CARD", "in-play stack is empty"); // structurally impossible
  }
  const topCard = cardOfUid(state, activeTopUid);
  if (topCard === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${activeTopUid}`);
  }

  // The array-ness and the cheap bound check come FIRST: discardEnergy is
  // caller-supplied (a P4 client controls it), so a non-array must never
  // reach `new Set` below — a length-faking object throws there — and the
  // O(n) membership scans must never run on an unbounded list.
  const cost = retreatCostOf(topCard);
  const chosen = action.discardEnergy;
  if (!Array.isArray(chosen) || chosen.length !== cost) {
    return err("RETREAT_COST_MISMATCH", `retreat costs exactly ${cost} energy`);
  }
  const chosenSet = new Set(chosen);
  if (chosenSet.size !== chosen.length) {
    return err("ENERGY_NOT_ATTACHED", "duplicate energy uids in discardEnergy");
  }
  for (const uid of chosen) {
    if (!active.energy.includes(uid)) {
      return err("ENERGY_NOT_ATTACHED", `${uid} is not attached to the Active Pokémon`);
    }
  }

  // The cost payment is the shared "cards leave play for the discard" move
  // (types.ts) — the same primitive KO cleanup uses.
  const paid = discardFromStack(side, active, chosenSet);
  const benched = clearOnLeavingActive(paid.pokemon);
  // The bench stays dense: the promoted Pokémon's slot closes up and the
  // retreater goes to the end. Both indices ride along on the event so
  // consumers never re-derive this rule (events.ts).
  const bench = [
    ...side.bench.slice(0, promoteBenchIndex),
    ...side.bench.slice(promoteBenchIndex + 1),
    benched,
  ];
  const next: GameState = {
    ...withSide(state, action.seat, { ...paid.side, active: promoted, bench }),
    allowances: { ...state.allowances, retreated: true },
  };
  const events: GameEvent[] = [
    {
      type: "RETREATED",
      seat: action.seat,
      retreated: activeTopUid,
      promoted: promotedTopUid,
      promotedFrom: promoteBenchIndex,
      benchedTo: bench.length - 1,
      // In PILE order (discardFromStack appends stack → energy → tools, so a
      // cost payment lands in attachment order), NOT the caller's chosen
      // order — the event reports what the public, ordered pile gained (§2),
      // exactly like KNOCKED_OUT's `discarded`.
      discardedEnergy: paid.discarded,
    },
  ];
  // §11/§12 — benching removed the retreater's Special Conditions
  // (clearOnLeavingActive above). Announced only when there was anything to
  // remove; `statuses` lists exactly what was present.
  const cleared = presentStatuses(active.conditions);
  if (cleared.length > 0) {
    events.push({
      type: "STATUS_CLEARED",
      seat: action.seat,
      uid: activeTopUid,
      statuses: cleared,
      reason: "benched",
    });
  }
  return ok(next, events);
}

/** Pass: seed the staged tail (flow.ts turnTail) and drain it. */
export function endTurn(state: GameState, action: EndTurnAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  return advance({ ...state, pending: turnTail(action.seat) }, []);
}
