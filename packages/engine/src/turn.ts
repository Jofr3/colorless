import type {
  ApplyResult,
  AttachEnergyAction,
  EndTurnAction,
  EvolveAction,
  GameAction,
  PlayBasicToBenchAction,
  RetreatAction,
} from "./actions";
import { err, ok } from "./actions";
import { basicFromHandError, cardOfUid, evolveFromOf, isEnergyCard, topUid } from "./cards";
import { effectiveRetreatCost, opposingRetreatBlocked } from "./continuous";
import type { GameEvent } from "./events";
import { advance, isLethallyDamaged, resolveMidTurnKnockOuts, turnTail } from "./flow";
import { switchInto } from "./interpreter";
import { programFor } from "./registry";
import { runBoardTrigger } from "./triggers";
import type { GameState, InPlayPokemon, PlayerSide, PokemonTarget, Seat } from "./types";
import {
  BENCH_MAX,
  discardFromStack,
  isImmobilized,
  makeInPlay,
  noConditions,
  presentStatuses,
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
    the use site (isBenchIndex), same as every other wire index. Shared by the
    attach/evolve/ability targets and the effect-choice Pokémon ref. */
export function isPokemonTarget(value: unknown): value is PokemonTarget {
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
  let next: GameState = {
    ...withSide(state, action.seat, updated),
    allowances: { ...state.allowances, energyAttached: true },
  };
  const events: GameEvent[] = [
    // The target is copied: the action object belongs to the caller, and an
    // emitted event must not alias it (see events.ts).
    { type: "ENERGY_ATTACHED", seat: action.seat, uid: action.uid, target: { ...action.target } },
  ];
  // §6.1 — a Special Energy's on-attach effect. Jet Energy: attaching from hand
  // to a BENCHED Pokémon switches it to the Active Spot (the energy just landed
  // rides in with it). Nothing fires on an Active attach. Reuses the shared
  // switch move (interpreter.ts), which clears the outgoing Active's conditions
  // and emits POKEMON_SWITCHED — the bench index is still valid (attaching does
  // not reorder the bench).
  const onAttach = programFor(card.id)?.energy?.onAttach;
  if (onAttach?.kind === "switchIfBenched" && action.target.spot === "bench") {
    next = switchInto(
      next,
      action.seat,
      { seat: action.seat, spot: { spot: "bench", index: action.target.index } },
      events,
    );
  }
  return ok(next, events);
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
  const events: GameEvent[] = [{ type: "POKEMON_BENCHED", seat: action.seat, uid: action.uid }];
  // §9 — a "when you play this Pokémon onto your Bench during your turn"
  // triggered Ability (Flamigo's Insta-Flock) fires now, on the freshly
  // benched Pokémon (the last, dense slot). It may park on effect:choose.
  const benchIndex = next.players[action.seat].bench.length - 1;
  return runBoardTrigger(
    next,
    action.seat,
    { spot: "bench", index: benchIndex },
    "onPlayToBench",
    events,
  );
}

/** §10 — place an Evolution card from hand on top of one of your own in-play
    Pokémon (Active or Bench) whose top card it evolves from. No per-turn cap
    (each Pokémon may evolve once — enforced by turnPlayed, below), and it
    consumes NONE of the energy/retreat allowances. */
export function evolve(state: GameState, action: EvolveAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;

  // §4/§10 — neither player may evolve on their own first turn (every Pokémon
  // in play then arrived this turn). firstPlayer takes the odd turns, so their
  // first turn is turn 1 and the other seat's is turn 2; the gate already
  // proved this is the acting seat's turn, so the counter names whether it is
  // their first. (This is the turn/firstPlayer check turnPlayed cannot make —
  // setup Pokémon carry turnPlayed 0, not the turn number, by design.)
  const firstTurnOfSeat = action.seat === state.firstPlayer ? 1 : 2;
  if (state.turn === firstTurnOfSeat) {
    return err("FIRST_TURN_EVOLVE", "cannot evolve on your first turn (§4/§10)");
  }

  const side = state.players[action.seat];
  if (!side.hand.includes(action.uid)) {
    return err("CARD_NOT_IN_HAND", `${action.uid} is not in ${action.seat}'s hand`);
  }
  const card = cardOfUid(state, action.uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${action.uid}`);
  }
  const evolvesFrom = evolveFromOf(card);
  if (evolvesFrom === null) {
    return err("NOT_AN_EVOLUTION", `${card.name} is not an Evolution Pokémon`);
  }
  // Wire shape check, same as attachEnergy: a null/garbled target must reject,
  // not throw on `.spot`; the bench index is checked at the use site below.
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "evolve target must name the Active spot or a bench index");
  }

  // Resolve the in-play Pokémon being evolved.
  let target: InPlayPokemon;
  let benchIndex = -1;
  if (action.target.spot === "active") {
    if (side.active === null) {
      return err("NO_TARGET", "no Active Pokémon to evolve");
    }
    target = side.active;
  } else {
    // Same wire-decode trap as attachEnergy/retreat: a string index would
    // index the bench fine yet corrupt the write-back below.
    benchIndex = action.target.index;
    const benched = isBenchIndex(benchIndex) ? side.bench[benchIndex] : undefined;
    if (benched === undefined) {
      return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(benchIndex)}`);
    }
    target = benched;
  }

  const targetTopUid = topUid(target);
  const targetTopCard = targetTopUid === undefined ? undefined : cardOfUid(state, targetTopUid);
  if (targetTopUid === undefined || targetTopCard === undefined) {
    return err("UNKNOWN_CARD", "the target Pokémon has no resolvable top card");
  }
  // §10 — the evolution's `evolveFrom` must NAME the target's current top card.
  if (targetTopCard.name !== evolvesFrom) {
    return err("EVOLVE_MISMATCH", `${card.name} does not evolve from ${targetTopCard.name}`);
  }
  // §10 timing — a Pokémon cannot evolve the turn it came into play, nor twice
  // in one turn (evolving stamps turnPlayed to the current turn, below), so a
  // target already stamped this turn is too soon. Setup Pokémon carry 0 and
  // clear this from turn 2 on; the first-turn ban above covers turns 1–2.
  if (target.turnPlayed >= state.turn) {
    return err(
      "EVOLVE_TOO_SOON",
      `${targetTopCard.name} came into play this turn — it cannot evolve yet (§10)`,
    );
  }

  // §10 — the evolution card leaves hand; the shared placement (below) puts it
  // on the stack, carries over damage/energy/tools, clears conditions/markers,
  // resets turnPlayed, and runs the evolve-below-HP KO check + the on-evolve
  // trigger. Rare Candy (§7.1, cardplay.ts) reuses the SAME placement to skip
  // the Stage 1 — the two card plays differ only in what they validate first.
  const stateAfterHand = withSide(state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
  });
  return placeEvolution(
    stateAfterHand,
    action.seat,
    action.target,
    benchIndex,
    target,
    targetTopUid,
    action.uid,
    [],
  );
}

/** §10/§7.1 — the shared evolution PLACEMENT, used by both `evolve` (adjacent
    stage) and `rareCandy` (Basic→Stage 2 skip). The caller has ALREADY removed
    the evolution card (and, for Rare Candy, the Rare Candy Item) from `state`'s
    hand and validated the legality (name match / Basic-and-chain, timing); this
    only does the placement + its consequences. `evolutionUid` becomes the new
    stack top of `from` (the pre-evolution Pokémon at `target`, bench index
    `benchIndex`, -1 for the Active). §10 carry-over: damage, Energy and Tools
    STAY on the stack; Special Conditions and temporary markers are cleared;
    turnPlayed resets so it cannot evolve again this turn. Then §8.1 — evolution
    can LOWER effective max HP (a Bravery Charm's Basic-only +50 dropping off),
    so a carried-damage Pokémon that now meets the new stage's HP is Knocked Out
    the instant it evolves: a MID-TURN KO that resumes the actor's turn (flow.ts),
    for a benched holder as much as an Active one. The KO check runs BEFORE the
    trigger (a Pokémon KO'd on evolution left play, so its own "when you evolve"
    Ability does not fire); otherwise the §9 on-evolve triggered Ability fires
    (Arboliva's Enriching Oil), which may park on effect:choose. `events` is
    seeded by the caller (empty for evolve; a TRAINER_PLAYED for Rare Candy)
    and POKEMON_EVOLVED is appended here as the placement's own event. */
export function placeEvolution(
  state: GameState,
  seat: Seat,
  target: PokemonTarget,
  benchIndex: number,
  from: InPlayPokemon,
  fromUid: string,
  evolutionUid: string,
  events: GameEvent[],
): ApplyResult {
  const evolved: InPlayPokemon = {
    ...from,
    stack: [...from.stack, evolutionUid],
    conditions: noConditions(),
    // §10 — evolving sheds the effects of attacks too, not just conditions. That
    // covers the retreat block and, since D142, the attack-installed damage
    // block. The second one is UNREACHABLE and deliberately written anyway: the
    // block is installed by an attack, an attack ends the turn (§5.3), and its
    // window is the opponent's next turn — during which the holder's controller
    // cannot evolve anything — so no legal sequence puts an evolution between the
    // install and the expiry. The rule belongs with the concept rather than with
    // the sequences that can currently reach it (the same call the retreat block
    // made one line up), and a state surgery pins it.
    retreatBlocked: false,
    attackBlock: null,
    // …and, since D143, the attack-installed LOCK — the one §10 clear on this line
    // that is not only reachable but is a PLAYED LINE: the lock's window is the
    // holder's own next turn, so evolving the locked Pokémon on that turn frees it
    // to attack immediately. That is the inverse of the block above, whose window
    // belongs to the opponent and which therefore no evolution can ever meet.
    //
    // D148 — and since the lock can now be written by the OPPONENT's attack ("…the
    // Defending Pokémon can't attack."), this line is also the VICTIM's chief
    // counterplay rather than only the holder's escape from its own drawback. The
    // reachability is identical (the window is the locked player's own next turn
    // either way); the AGENCY is not, and evolving out of an imposed lock is the
    // sharpest of the three routes because it costs no Energy and no allowance.
    // Driven end to end on a printed line (Alomomola → fix-mola-stage1).
    attackLockedTurn: null,
    // …and, since D147, the attack-installed DAMAGE REDUCTION — the same
    // reachability story as the block two lines up rather than the lock's, and
    // for the same arithmetic: its window is the OPPONENT's next turn, during
    // which the holder's controller cannot evolve anything, so no legal sequence
    // puts an evolution between the install and the expiry. Written anyway (§10
    // sheds the effects of ATTACKS and this is one) and pinned by a surgery.
    damageReduction: null,
    // …and, since D149, the attack-installed ATTACK-DAMAGE DEBUFF — whose story
    // here is the LOCK's rather than the reduction's, and that is the whole
    // difference between the two mirrors: the debuff's window is the HOLDER's own
    // next turn, so evolving the debuffed Pokémon on that turn frees its attacks
    // to hit full. A PLAYED LINE, driven end to end, and the victim's cheapest
    // counterplay against an effect they did not choose (D148's agency, on the
    // number instead of the lock).
    attackDamageDebuff: null,
    // …and, since D152, the attack-armed RECOIL — the reduction's story two lines
    // up rather than the debuff's, and for the same arithmetic: its window is the
    // OPPONENT's next turn, during which the holder's controller cannot evolve
    // anything, so no legal sequence puts an evolution between the arming and the
    // expiry. Written anyway (§10 sheds the effects of ATTACKS and this is one)
    // and pinned by a surgery.
    installedRecoil: null,
    // …and, since D154, the attack-installed PER-ATTACK lock — whose story here is
    // the LOCK's two lines up and not the reduction's, for the same reason it
    // shares that lock's number: the window is the HOLDER's own next turn, so
    // evolving the barred Pokémon on that turn frees the barred attack
    // immediately. A PLAYED LINE, driven end to end (Skarmory → fix-skarm-stage1),
    // and the sharpest of the three routes because it costs no Energy and no
    // allowance. Since D165 it sheds a LIST, and the WHOLE list — §10 sheds the
    // effects of attacks, all of them, and an evolution that freed one bar while
    // keeping another would be the defect this slice fixed wearing a clear.
    lockedAttacks: [],
    // …and, since D155, the attack-installed PER-ATTACK BUFF — the same window on
    // the same body as the line above, so the same PLAYED LINE, and the only entry
    // on this list a player must be careful NOT to take: evolving the boosted
    // Pokémon inside the window throws the bonus away. §10 sheds the effects of
    // ATTACKS whether or not the holder wanted this one shed.
    boostedAttack: null,
    markers: [],
    turnPlayed: state.turn,
  };
  const side = state.players[seat];
  const updated: PlayerSide =
    target.spot === "active"
      ? { ...side, active: evolved }
      : { ...side, bench: side.bench.map((p, i) => (i === benchIndex ? evolved : p)) };
  events.push({
    type: "POKEMON_EVOLVED",
    seat,
    from: fromUid,
    to: evolutionUid,
    // Copied: the action object belongs to the caller (events.ts).
    target: { ...target },
  });
  // §10/§12 — evolving removed the Pokémon's Special Conditions. Announced only
  // when there was something to remove; `uid` is the NEW top (see events.ts).
  const cleared = presentStatuses(from.conditions);
  if (cleared.length > 0) {
    events.push({
      type: "STATUS_CLEARED",
      seat,
      uid: evolutionUid,
      statuses: cleared,
      reason: "evolved",
    });
  }
  const next = withSide(state, seat, updated);
  if (isLethallyDamaged(next, evolved)) {
    return resolveMidTurnKnockOuts(next, seat, [seat], events);
  }
  return runBoardTrigger(next, seat, target, "onEvolve", events);
}

/** Leaving the Active spot removes Special Conditions (§11/§12) and every other
    effect of an attack still on the Pokémon — the §11 retreat block included
    (unreachable down THIS path, which is a retreat the block would have already
    refused, but the rule belongs with the concept, not with one caller) and,
    since D142, the attack-installed damage block, which is reachable here: a
    Pokémon that shielded itself and then RETREATS on its own following turn
    walks away from a block whose window has in any case already closed, but the
    forced half of the same move (`switchInto`) can do it INSIDE the window —
    and, since D143, the attack-installed SELF-LOCK, for which THIS path is the
    reachable one rather than the theoretical one: the lock's window is the
    HOLDER's own turn, so a player can retreat their locked Pokémon on that very
    turn, promote something that can attack, and — with a Switch — bring the now
    un-locked body back and attack with it — and, since D147, the durated DAMAGE
    REDUCTION, which shares the BLOCK's story rather than the lock's (same
    window, same body, so the forced half is the reachable one). FOUR durated
    effects, three different reachability stories, one clear.

    D148 adds a FOURTH story to the same four fields without adding a field: an
    OPPONENT-installed attack lock reaches this path exactly where D143's does (the
    window is the locked player's own turn, so a retreat inside it is legal), but
    the player taking the retreat is the one the effect was done TO. Same site,
    same clear, opposite agency — which is worth writing down because it is the
    first durated effect in the engine whose early endings are a COUNTERPLAY rather
    than an escape, and because "who can reach this line" has been the question
    every one of these four fields was priced on.
    M4 adds dropping active-only markers here too. */
function clearOnLeavingActive(pokemon: InPlayPokemon): InPlayPokemon {
  return {
    ...pokemon,
    conditions: noConditions(),
    retreatBlocked: false,
    attackBlock: null,
    attackLockedTurn: null,
    // D147 — the durated damage reduction, whose story here is D142's block's:
    // the RETREAT half of this path is unreachable inside the window (the window
    // is the opponent's turn, and the holder's controller cannot retreat on it),
    // while the FORCED half (`switchInto`) is exactly where it bites.
    damageReduction: null,
    // D149 — the attack-damage debuff, whose story here is the LOCK's: the window
    // is the HOLDER's own next turn, so the RETREAT half is a played line and the
    // victim's own counterplay (retreat the weakened body, attack with a fresh
    // one). FIVE durated effects on one clear, and this is the fifth distinct
    // reachability story — which is why the clear-set is SWEPT and not listed.
    attackDamageDebuff: null,
    // D152 — the armed recoil, whose story here is the REDUCTION's: the window is
    // the opponent's turn, so the RETREAT half is unreachable inside it (the
    // holder's controller cannot retreat on someone else's turn) and the FORCED
    // half (`switchInto`) is exactly where it bites. SIX durated effects on one
    // clear, FIVE distinct reachability stories — which is why the clear-set is
    // SWEPT and not listed.
    installedRecoil: null,
    // D154 — the per-attack lock, whose story here is the SELF-LOCK's four fields
    // up (same window, same body): the RETREAT half is the reachable one and it is
    // the holder's own line of play — retreat the barred Pokémon on the very turn
    // the bar is live, promote something that can attack, and with a Switch bring
    // the now-unbarred body back. SEVEN durated effects on one clear, FIVE
    // reachability stories — which is why the clear-set is SWEPT and not listed.
    // Since D165 it sheds a LIST, and the WHOLE list: a retreat that shed the
    // holder's own bar and kept the one an opponent imposed would invert the
    // agency §10 gives the retreating player.
    lockedAttacks: [],
    // D155 — the per-attack BUFF, whose story here is the line above it verbatim
    // (same window, same body): the RETREAT half is the reachable one and it is
    // the holder's own line of play — with the sign flipped, since retreating the
    // boosted Pokémon is how a player LOSES a bonus they spent a turn on. EIGHT
    // durated effects on one clear, FIVE reachability stories.
    boostedAttack: null,
  };
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
  // §11 — an attack held it in place ("the Defending Pokémon can't retreat").
  // Its own code, not STATUS_PREVENTS_RETREAT: nothing about it is a §12
  // condition, and a client showing "Asleep/Paralyzed" here would be lying.
  if (active.retreatBlocked) {
    return err("RETREAT_PREVENTED", "an attack effect prevents this Pokémon from retreating (§11)");
  }
  // §11 — an opposing CONTINUOUS Ability holding it in place (Snorlax "Block").
  // Same error code as the attack rider above — the client is told it cannot
  // retreat, not why (D112) — but its own message: the two differ only in
  // provenance, and "an attack effect" would be a lie for an Ability aura.
  if (opposingRetreatBlocked(state, active)) {
    return err(
      "RETREAT_PREVENTED",
      "an opposing Ability prevents this Pokémon from retreating (§11)",
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
  // O(n) membership scans must never run on an unbounded list. The cost is
  // the CONTINUOUS one (§7.3 — Beach Court discounts Basics).
  const cost = effectiveRetreatCost(state, active);
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
    ...withSide(state, action.seat, {
      ...paid.side,
      // The Pokémon remembers WHEN it came in from the Bench (types.ts
      // `promotedTurn`) — a retreat is the deliberate half of that move.
      active: { ...promoted, promotedTurn: state.turn },
      bench,
    }),
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
