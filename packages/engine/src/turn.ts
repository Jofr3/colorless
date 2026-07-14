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
import type { GameEvent } from "./events";
import type { GameState, InPlayPokemon, PlayerSide, Seat, TurnPhase } from "./types";
import {
  BENCH_MAX,
  drawToHand,
  makeInPlay,
  noConditions,
  otherSeat,
  withSide,
  without,
} from "./types";

// The turn loop (rules §5, §16). Turn start is never a player decision, so
// startTurn runs automatically off the previous turn's end (or off setup):
// fresh allowances, TURN_STARTED, then the mandatory draw with its deck-out
// loss check.

/** Bench slots are array indices, and the arrays are dense. The `Number` check
    guards the wire: TS says these are numbers, JSON does not, and a string
    index misbehaves silently rather than loudly (see the call sites). */
export function isBenchIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < BENCH_MAX;
}

/** The gate every in-turn action shares: right phase, right seat. Returning
    the narrowed phase (rather than re-narrowing in each handler) is what
    keeps the four M1 actions — and M2's attack/evolve/trainer plays — from
    each re-deriving the turn check. */
export function turnGate(
  state: GameState,
  action: { type: GameAction["type"]; seat: Seat },
): { phase: TurnPhase; reject?: undefined } | { phase?: undefined; reject: ApplyResult } {
  const phase = state.phase;
  if (phase.kind !== "turn:action") {
    return { reject: err("BAD_PHASE", `${action.type} is not legal during ${phase.kind}`) };
  }
  if (phase.seat !== action.seat) {
    return { reject: err("WRONG_SEAT", `it is ${phase.seat}'s turn`) };
  }
  return { phase };
}

/** Advance to `seat`'s turn. Building a fresh turn:action phase IS the
    per-turn allowance reset. The first player DOES draw on turn 1 — the
    start-of-turn draw is not skipped under current rules (§4). */
export function startTurn(state: GameState, seat: Seat, events: GameEvent[]): ApplyResult {
  const turn = state.turn + 1;
  let next: GameState = {
    ...state,
    turn,
    phase: { kind: "turn:action", seat, energyAttached: false, retreated: false },
  };
  events.push({ type: "TURN_STARTED", turn, seat });

  // Draw step (§5.1): a player who must draw from an empty deck loses the
  // game right here (§14.3 deck-out) — checked at draw time.
  if (next.players[seat].deck.length === 0) {
    const winner = otherSeat(seat);
    next = { ...next, phase: { kind: "gameOver", winner, reason: "deckOut" } };
    events.push({ type: "GAME_OVER", winner, reason: "deckOut" });
    return ok(next, events);
  }
  next = drawToHand(next, seat, 1, "turnStart", events);
  return ok(next, events);
}

/** §6.2 — exactly one energy attachment per turn, from hand, onto any of
    the actor's Pokémon (Active or Bench). */
export function attachEnergy(state: GameState, action: AttachEnergyAction): ApplyResult {
  const gate = turnGate(state, action);
  if (gate.reject) return gate.reject;
  const phase = gate.phase;
  if (phase.energyAttached) {
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
    phase: { ...phase, energyAttached: true },
  };
  return ok(next, [
    // The target is copied: the action object belongs to the caller, and an
    // emitted event must not alias it (see events.ts).
    { type: "ENERGY_ATTACHED", seat: action.seat, uid: action.uid, target: { ...action.target } },
  ]);
}

/** §5.2 — Basics to the bench, any number per turn, cap 5. */
export function playBasicToBench(state: GameState, action: PlayBasicToBenchAction): ApplyResult {
  const gate = turnGate(state, action);
  if (gate.reject) return gate.reject;
  const side = state.players[action.seat];
  if (side.bench.length >= BENCH_MAX) {
    return err("BENCH_FULL", `the bench holds at most ${BENCH_MAX} Pokémon`);
  }
  const invalid = basicFromHandError(state, action.seat, action.uid);
  if (invalid !== null) return invalid;

  // makeInPlay records turnPlayed — M2's evolution timing ("not the turn it
  // came into play", §10) reads it.
  const next = withSide(state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
    bench: [...side.bench, makeInPlay(action.uid, state.turn)],
  });
  return ok(next, [{ type: "POKEMON_BENCHED", seat: action.seat, uid: action.uid }]);
}

/** M3 hook — leaving the Active spot removes Special Conditions (§11/§12)
    and will drop active-only markers. M1 conditions are always empty, so
    this is the identity in practice; it exists so retreat (and M2's
    KO-promotion) already route through the right place. */
function clearOnLeavingActive(pokemon: InPlayPokemon): InPlayPokemon {
  return { ...pokemon, conditions: noConditions() };
}

/** §11 — once per turn: the player names WHICH attached energies pay the
    cost (count must equal the top card's retreat cost exactly) and which
    benched Pokémon takes the Active spot. */
export function retreat(state: GameState, action: RetreatAction): ApplyResult {
  const gate = turnGate(state, action);
  if (gate.reject) return gate.reject;
  const phase = gate.phase;
  if (phase.retreated) {
    return err("ALREADY_RETREATED", "only one retreat per turn (§11)");
  }
  const side = state.players[action.seat];
  const active = side.active;
  if (active === null) {
    // Unreachable in M1 — nothing removes the Active before KOs land in M2.
    return err("NO_TARGET", "no Active Pokémon to retreat");
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

  // The cheap bound check comes FIRST: discardEnergy is caller-supplied (a P4
  // client controls it), so the O(n) membership scans below must never run on
  // an unbounded list.
  const cost = retreatCostOf(topCard);
  const chosen = action.discardEnergy;
  if (chosen.length !== cost) {
    return err("RETREAT_COST_MISMATCH", `retreat costs ${cost} energy, got ${chosen.length}`);
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

  const benched = clearOnLeavingActive({
    ...active,
    energy: active.energy.filter((uid) => !chosenSet.has(uid)),
  });
  // The bench stays dense: the promoted Pokémon's slot closes up and the
  // retreater goes to the end. Both indices ride along on the event so
  // consumers never re-derive this rule (events.ts).
  const bench = [
    ...side.bench.slice(0, promoteBenchIndex),
    ...side.bench.slice(promoteBenchIndex + 1),
    benched,
  ];
  const next: GameState = {
    ...withSide(state, action.seat, {
      ...side,
      discard: [...side.discard, ...chosen],
      active: promoted,
      bench,
    }),
    phase: { ...phase, retreated: true },
  };
  return ok(next, [
    {
      type: "RETREATED",
      seat: action.seat,
      retreated: activeTopUid,
      promoted: promotedTopUid,
      promotedFrom: promoteBenchIndex,
      benchedTo: bench.length - 1,
      discardedEnergy: [...chosen],
    },
  ]);
}

/** M3 stub — the Pokémon Checkup (§13: poison/burn/sleep/paralysis ticks,
    KO + promotion, win checks) runs here between turns. M1 has none of
    those, so the state passes through untouched. */
function runCheckup(state: GameState, _events: GameEvent[]): GameState {
  return state;
}

/** Pass: end the turn, run the between-turns hook, start the opponent's
    turn (which advances the counter and resets the allowances). */
export function endTurn(state: GameState, action: EndTurnAction): ApplyResult {
  const gate = turnGate(state, action);
  if (gate.reject) return gate.reject;
  const events: GameEvent[] = [{ type: "TURN_ENDED", turn: state.turn, seat: action.seat }];
  const next = runCheckup(state, events);
  return startTurn(next, otherSeat(action.seat), events);
}
