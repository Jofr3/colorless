import type { Card } from "@colorless/schema";
import type { ApplyResult, ConcedeAction } from "./actions";
import { err, ok } from "./actions";
import {
  activeTop,
  cardOfUid,
  matchesFilter,
  pokemonSuffixOf,
  prizeValueOf,
  topCardOf,
  topUid,
} from "./cards";
import {
  benchTrimStages,
  owesToolTrim,
  toolTrimStages,
  effectiveRetreatCost,
  energyMayBeAttachedTo,
  inPlayCardOf,
  isLethallyDamaged,
  koAttackerOnCoinFlipOf,
  koEnergyRescueUids,
  koSelfToHandUids,
  passivesOf,
  seatBurnExtraCounters,
  seatKoPrizeBonuses,
  seatKoPrizeReductionOf,
  stadiumPoisonExtraCounters,
  stadiumEffectsOf,
  stadiumShieldsStatus,
} from "./continuous";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import type { PokemonRef, RunResult } from "./interpreter";
import {
  attackAgainBarred,
  attackAgainLicensed,
  discardHand,
  doomBodyAt,
  effectRefused,
  runProgram,
} from "./interpreter";
import type { KoPrizeReduction } from "./registry";
import { programFor } from "./registry";
import { flipCoin, shuffle } from "./rng";
import {
  damagedByAttackAbility,
  damagedToolTriggersOf,
  endTurnToolTriggersOf,
  koHolderToolTriggersOf,
  koToolTriggersOf,
  onKnockOutTrigger,
  runCheckupTriggers,
  toolTriggerOf,
} from "./triggers";
import type {
  GameOutcome,
  GameOverReason,
  GameState,
  InPlayPokemon,
  KnockOutMark,
  PendingStage,
  PlayerSide,
  PokemonTarget,
  Seat,
  UsedAttack,
} from "./types";
import {
  inPlayOf,
  BENCH_CEILING,
  SEATS,
  discardFromStack,
  drawToHand,
  freshAllowances,
  otherSeat,
  presentStatuses,
  withActive,
  withSide,
  koByEffectMarker,
  scheduledEffectDue,
} from "./types";

// The staged turn tail (types.ts: PendingStage) and everything that runs
// inside it: turn start with its deck-out check, the Pokémon Checkup (§13),
// KO prize/promotion resolution and the §14 win evaluation. endTurn and
// attack both funnel through `advance`, which is what lets a KO stop the
// tail mid-sequence for a player decision — M1's fused endTurn could not.

/** Advance to `seat`'s turn: fresh allowances, TURN_STARTED, the mandatory
    draw with its deck-out loss check (§5.1, §14.3). The first player DOES
    draw on turn 1 — the start-of-turn draw is not skipped under current
    rules (§4). */
export function startTurn(state: GameState, seat: Seat, events: GameEvent[]): ApplyResult {
  const turn = state.turn + 1;
  let next: GameState = {
    ...state,
    turn,
    allowances: freshAllowances(),
    phase: { kind: "turn:action", seat },
  };
  events.push({ type: "TURN_STARTED", turn, seat });

  // Draw step (§5.1): a player who must draw from an empty deck loses the
  // game right here (§14.3 deck-out) — checked at draw time. Only one player
  // draws, so deck-out can never be simultaneous with another condition.
  if (next.players[seat].deck.length === 0) {
    return finishGame(next, { result: "win", winner: otherSeat(seat), reason: "deckOut" }, events);
  }
  next = drawToHand(next, seat, 1, "turnStart", events);
  return ok(next, events);
}

/** Re-exported from `continuous.ts` so existing import paths keep resolving. */
export { isLethallyDamaged } from "./continuous";

/**
 * Knock Out the in-play Pokémon whose top card is `koedUid` on `koedSeat`'s board (§8.1). Its whole
 * stack goes to the discard pile and the prize and (for an Active) promotion stages are returned
 * for the caller to queue. Addressed by uid so a batch of KOs cannot shift a later bench slot. This
 * is the only writer of `lastKoTurn`; the stamp is idempotent, so the speculative tie probe may
 * call it on a throwaway state.
 */
export function knockOut(
  state: GameState,
  koedSeat: Seat,
  koedUid: string,
  prizeSeat: Seat,
  events: GameEvent[],
  byAttack = false,
  /**
   * Uids that go to `koedSeat`'s hand instead of the discard pile (Diver's Catch, Infinite Shadow).
   * Empty on every other Knock Out.
   */
  toHand: readonly string[] = [],
): { state: GameState; stages: PendingStage[] } {
  const side = state.players[koedSeat];
  // Stamp the turn this seat lost a Pokémon and which body it was. The mark list restarts on a
  // later turn and appends otherwise, keyed on uid so the speculative tie probe and the real call
  // agree. Only a Knock Out on the opponent's turn is stamped, judged by turn parity, because
  // readers only ask about the opponent's last turn.
  const ownTurn = (state.turn % 2 === 1) === (koedSeat === state.firstPlayer);
  const stampFor = (card: Card | undefined): GameState => {
    if (ownTurn) return state;
    const carried = state.lastKoTurn[koedSeat] === state.turn ? state.lastKoMarks[koedSeat] : [];
    // `card` is undefined only when a stack outruns the catalog; the empty name matches no owner
    // prefix, so narrowed gates read false while the bare turn stamp still reads true.
    const mark: KnockOutMark = { uid: koedUid, name: card?.name ?? "", byAttack };
    return {
      ...state,
      lastKoTurn: { ...state.lastKoTurn, [koedSeat]: state.turn },
      lastKoMarks: {
        ...state.lastKoMarks,
        [koedSeat]: carried.some((m) => m.uid === koedUid) ? carried : [...carried, mark],
      },
    };
  };
  // The Active?
  if (side.active !== null && topUid(side.active) === koedUid) {
    const card = topCardOf(state, side.active);
    const stamped = stampFor(card);
    const cleanup = koCleanup(side, side.active, toHand);
    events.push(knockedOutEvent(koedSeat, koedUid, cleanup));
    return {
      state: withSide(stamped, koedSeat, { ...cleanup.side, active: null }),
      stages: [
        { kind: "takePrizes", seat: prizeSeat, count: card === undefined ? 1 : prizeValueOf(card) },
        { kind: "promote", seat: koedSeat },
      ],
    };
  }
  // A benched one? (§8.1 — no promotion; the bench stays dense.)
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === koedUid);
  const benched = index === -1 ? undefined : side.bench[index];
  if (benched !== undefined) {
    const card = topCardOf(state, benched);
    const stamped = stampFor(card);
    const cleanup = koCleanup(side, benched, toHand);
    const bench = [...side.bench.slice(0, index), ...side.bench.slice(index + 1)];
    events.push(knockedOutEvent(koedSeat, koedUid, cleanup));
    return {
      state: withSide(stamped, koedSeat, { ...cleanup.side, bench }),
      stages: [
        { kind: "takePrizes", seat: prizeSeat, count: card === undefined ? 1 : prizeValueOf(card) },
      ],
    };
  }
  // Not in play — unreachable (every caller just scanned it lethal). No-op.
  return { state, stages: [] };
}

/**
 * Whole-stack teardown for a Knock Out: discard everything, then move the `toHand` uids back out of
 * the discard pile into the owner's hand, keeping pile order.
 */
function koCleanup(
  side: PlayerSide,
  body: InPlayPokemon,
  toHand: readonly string[],
): { side: PlayerSide; discarded: string[]; toHand: string[] } {
  const cleanup = discardFromStack(side, body, "all");
  const rescued = cleanup.discarded.filter((uid) => toHand.includes(uid));
  if (rescued.length === 0) return { side: cleanup.side, discarded: cleanup.discarded, toHand: [] };
  const discarded = cleanup.discarded.filter((uid) => !toHand.includes(uid));
  return {
    side: {
      ...cleanup.side,
      discard: [...side.discard, ...discarded],
      hand: [...side.hand, ...rescued],
    },
    discarded,
    toHand: rescued,
  };
}

/** The KNOCKED_OUT event; `toHand` is only present when something was rescued. */
function knockedOutEvent(
  seat: Seat,
  uid: string,
  cleanup: { discarded: string[]; toHand: string[] },
): GameEvent {
  return {
    type: "KNOCKED_OUT",
    seat,
    uid,
    discarded: cleanup.discarded,
    ...(cleanup.toHand.length === 0 ? {} : { toHand: cleanup.toHand }),
  };
}

/**
 * Promotions owed for an Active Spot left empty without a Knock Out. Seats the KO sweep already
 * queued a promotion for are skipped, so one empty spot never owes two promotions.
 */
function orphanedPromotions(
  state: GameState,
  seats: readonly Seat[],
  staged: readonly PendingStage[],
): PendingStage[] {
  return seats
    .filter(
      (seat) =>
        state.players[seat].active === null &&
        !staged.some((stage) => stage.kind === "promote" && stage.seat === seat),
    )
    .map((seat) => ({ kind: "promote", seat }));
}

/** Every lethally-damaged in-play Pokémon on `seats` right now, Active first
    then bench in index order, as stable {seat, top-uid} refs. By uid, because
    resolving one KO compacts its bench — knockOut then finds each ref by uid,
    immune to the shift (an index list would corrupt after the first removal). */
function lethalRefs(state: GameState, seats: readonly Seat[]): { seat: Seat; uid: string }[] {
  const refs: { seat: Seat; uid: string }[] = [];
  for (const seat of seats) {
    const side = state.players[seat];
    if (side.active !== null && isLethallyDamaged(state, side.active)) {
      const uid = topUid(side.active);
      if (uid !== undefined) refs.push({ seat, uid });
    }
    for (const pokemon of side.bench) {
      if (!isLethallyDamaged(state, pokemon)) continue;
      const uid = topUid(pokemon);
      if (uid !== undefined) refs.push({ seat, uid });
    }
  }
  return refs;
}

/** Whether this body was made lethal by an effect (a knock-out marker) rather than by damage. */
function lethalByEffect(body: InPlayPokemon, turn: number): boolean {
  return body.markers.includes(koByEffectMarker(turn));
}

function koRecoilOf(
  state: GameState,
  seat: Seat,
  // Luminous Wing on the attacker refuses Ability shares of the recoil (and so does Battle Cage for
  // a Benched attacker); a Tool's share still lands.
  abilityShareRefused = false,
): number {
  // Only bodies made lethal by damage pay this recoil; a `knockOutDefender` knock out is not
  // damage.
  const doomed = new Set(lethalRefs(state, [seat]).map((ref) => ref.uid));
  if (doomed.size === 0) return 0;
  const side = state.players[seat];
  let total = 0;
  for (const body of inPlayOf(side)) {
    const uid = topUid(body);
    if (uid !== undefined && doomed.has(uid) && !lethalByEffect(body, state.turn)) {
      const passives = passivesOf(state, body);
      total +=
        passives.damageAttackerOnKo -
        (abilityShareRefused ? passives.damageAttackerOnKoFromAbility : 0);
    }
  }
  return total;
}

/**
 * Gengar ex "Fainting Spell": "If this Pokémon is Knocked Out by damage from an attack from your
 * opponent's Pokémon, flip a coin. If heads, the Attacking Pokémon is Knocked Out." Called only
 * from `finishAttack`, so the attack and opponent clauses hold by placement. On heads the attacker
 * (found by uid) is marked as knocked out by effect, unless Luminous Wing prevents it; each dying
 * Gengar ex flips separately.
 */
function faintingSpells(
  state: GameState,
  attackerSeat: Seat,
  attackerUid: string,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(attackerSeat);
  const doomed = new Set(lethalRefs(state, [seat]).map((ref) => ref.uid));
  if (doomed.size === 0) return state;
  const side = state.players[seat];
  let next = state;
  for (const body of inPlayOf(side)) {
    const uid = topUid(body);
    if (uid === undefined || !doomed.has(uid) || lethalByEffect(body, state.turn)) continue;
    const ability = koAttackerOnCoinFlipOf(state, body);
    if (ability === null) continue;
    events.push({ type: "ABILITY_TRIGGERED", seat, uid, ability });
    const [face, rngState] = flipCoin(next.rngState);
    next = { ...next, rngState };
    events.push({ type: "ABILITY_COIN_FLIP", seat, uid, ability, result: face });
    if (face !== "heads") continue;
    const own = next.players[attackerSeat];
    const index = own.bench.findIndex((pokemon) => topUid(pokemon) === attackerUid);
    const ref: PokemonRef | undefined =
      own.active !== null && topUid(own.active) === attackerUid
        ? { seat: attackerSeat, spot: { spot: "active" } }
        : index === -1
          ? undefined
          : { seat: attackerSeat, spot: { spot: "bench", index } };
    const attacker =
      ref === undefined ? undefined : ref.spot.spot === "active" ? own.active : own.bench[index];
    if (ref === undefined || attacker === null || attacker === undefined) continue;
    if (
      effectRefused(
        next,
        attackerSeat,
        { seat, sourceUid: uid, invokedBy: "ability" },
        events,
        attacker,
      )
    )
      continue;
    next = doomBodyAt(
      next,
      ref,
      isLethallyDamaged(next, attacker) ? undefined : koByEffectMarker(next.turn),
    );
  }
  return next;
}

/**
 * Add `amount` damage to the in-play body `uid` on `seat`'s board, Active or Bench, or return
 * `null` when it is not in play. The attacker may have switched to its Bench, so the uid decides,
 * and `null` lets the caller skip the event.
 */
function addDamageByUid(
  state: GameState,
  seat: Seat,
  uid: string,
  amount: number,
): GameState | null {
  const side = state.players[seat];
  if (side.active !== null && topUid(side.active) === uid) {
    return withActive(state, seat, { ...side.active, damage: side.active.damage + amount });
  }
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === uid);
  if (index === -1) return null;
  return withSide(state, seat, {
    ...side,
    bench: side.bench.map((pokemon, at) =>
      at === index ? { ...pokemon, damage: pokemon.damage + amount } : pokemon,
    ),
  });
}

/**
 * Record on the attacking body that it used `attack` this turn, found by uid since it may have left
 * the Active Spot. An attacker no longer in play simply gets no stamp.
 */
function stampAttackUse(state: GameState, seat: Seat, uid: string, attack: string): GameState {
  const side = state.players[seat];
  const used: UsedAttack = { name: attack, turn: state.turn };
  if (side.active !== null && topUid(side.active) === uid) {
    return withActive(state, seat, { ...side.active, usedAttack: used });
  }
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === uid);
  if (index === -1) return state;
  return withSide(state, seat, {
    ...side,
    bench: side.bench.map((pokemon, at) =>
      at === index ? { ...pokemon, usedAttack: used } : pokemon,
    ),
  });
}

/**
 * Record on the seat that `uid` attacked this turn (Unrelenting Onslaught); the record survives the
 * body leaving play. Idempotent per turn and uid, and prunes entries older than the seat's previous
 * turn.
 */
function stampSeatAttacker(state: GameState, seat: Seat, uid: string): GameState {
  const turn = state.turn;
  const kept = state.recentAttackers[seat].filter((entry) => entry.turn >= turn - 2);
  const already = kept.some((entry) => entry.turn === turn && entry.uid === uid);
  return {
    ...state,
    recentAttackers: {
      ...state.recentAttackers,
      [seat]: already ? kept : [...kept, { turn, uid }],
    },
  };
}

/**
 * Munkidori ex "Oh No You Don't": "If this Pokémon is Knocked Out by damage from an attack from
 * your opponent's Pokémon, and if you have any Pecharunt ex in play, your opponent takes 1 fewer
 * Prize card." Returns the reduced count, or null when any clause fails. The attack cause must be a
 * parameter because prizes are planned inside `collectKnockOuts`, which non-attack sweeps also
 * reach. Pecharunt ex is checked by name on the pre-batch board, so one dying in the same batch
 * still counts; the result is clamped at 0.
 */
function koPrizeReduction(
  state: GameState,
  ref: { seat: Seat; uid: string },
  reduction: KoPrizeReduction,
  attackerSeat: Seat | undefined,
  baseCount: number,
): number | null {
  // A `knockOutDefender` knock out is not "by damage" and is refused too.
  if (!koByOpponentAttack(state, ref, attackerSeat)) return null;
  const side = state.players[ref.seat];
  const inPlay = inPlayOf(side);
  // `undefined` means there is no board clause to check, not a failing one.
  const name = reduction.requiresInPlay;
  if (name !== undefined && !inPlay.some((body) => topCardOf(state, body)?.name === name))
    return null;
  return Math.max(0, baseCount - reduction.by);
}

/**
 * "Is Knocked Out by damage from an attack from your opponent's Pokémon", per body on the pre-batch
 * board: an attack epilogue, the attacker on the other seat, and lethal by damage. Unlike
 * `byAttackFor`, a ref whose body cannot be found answers false here.
 */
export function koByOpponentAttack(
  state: GameState,
  ref: { seat: Seat; uid: string },
  attackerSeat: Seat | undefined,
): boolean {
  if (attackerSeat === undefined || attackerSeat === ref.seat) return false;
  const body = preBatchBody(state, ref);
  return body !== undefined && !lethalByEffect(body, state.turn);
}

/**
 * Was `ref`'s body in its seat's Active Spot on the pre-batch board? Used by the on-KO `activeOnly`
 * gate (Sandy Flapping).
 */
export function koWasActiveSpot(state: GameState, ref: { seat: Seat; uid: string }): boolean {
  const active = state.players[ref.seat].active;
  return active !== null && topUid(active) === ref.uid;
}

/**
 * `koByOpponentAttack` and the attacking body (resolved by uid) is a Pokémon ex, Mega ex included.
 * False with no attacker uid.
 */
export function koByOpponentPokemonEx(
  state: GameState,
  ref: { seat: Seat; uid: string },
  attackerSeat: Seat | undefined,
  attackerUid: string | undefined,
): boolean {
  if (attackerUid === undefined || !koByOpponentAttack(state, ref, attackerSeat)) return false;
  const attacker = cardOfUid(state, attackerUid);
  return attacker !== undefined && pokemonSuffixOf(attacker) === "ex";
}

/**
 * Mega Gengar ex "Shadowy Concealment" applied to one Knock Out's running count, after the attached
 * reductions and before bonuses. Nothing left to reduce means no application and no row; otherwise
 * ABILITY_TRIGGERED plus one PRIZE_REDUCED, clamped at 0.
 */
function seatPrizeReduction(
  reduced: { state: GameState; count: number; events: GameEvent[] },
  ref: { seat: Seat; uid: string },
  attackerSeat: Seat | undefined,
  attackerUid: string | undefined,
): { state: GameState; count: number; events: GameEvent[] } {
  const { state, count } = reduced;
  if (count === 0 || !koByOpponentPokemonEx(state, ref, attackerSeat, attackerUid)) return reduced;
  const body = preBatchBody(state, ref);
  const holder = seatKoPrizeReductionOf(
    state,
    ref.seat,
    body === undefined ? undefined : inPlayCardOf(state, body),
  );
  if (holder === null) return reduced;
  const next = Math.max(0, count - holder.rule.by);
  return {
    state,
    count: next,
    events: [
      ...reduced.events,
      { type: "ABILITY_TRIGGERED", seat: ref.seat, uid: holder.uid, ability: holder.rule.ability },
      { type: "PRIZE_REDUCED", seat: ref.seat, uid: ref.uid, by: count - next, count: next },
    ],
  };
}

/**
 * The same Prize reduction borne by an attached card (Lillie's Pearl, gated on a Lillie's Pokémon
 * holder; Legacy Energy, once per game). Uses the same attack-cause clauses as `koPrizeReduction`.
 * Reductions compound and the running total is clamped at 0. Returns the reduced count, latch
 * writes and one PRIZE_REDUCED per applied entry.
 */
function attachedPrizeReductions(
  state: GameState,
  ref: { seat: Seat; uid: string },
  attackerSeat: Seat | undefined,
  baseCount: number,
): { state: GameState; count: number; events: GameEvent[] } {
  const unchanged = { state, count: baseCount, events: [] };
  if (attackerSeat === undefined || attackerSeat === ref.seat) return unchanged;
  const side = state.players[ref.seat];
  const body = inPlayOf(side).find((pokemon) => topUid(pokemon) === ref.uid);
  if (body === undefined) return unchanged;
  // A `knockOutDefender` knock out is not "by damage": it reduces nothing and spends no latch.
  if (lethalByEffect(body, state.turn)) return unchanged;
  const entries = passivesOf(state, body).koPrizeReductions;
  if (entries.length === 0) return unchanged;
  const holderName = topCardOf(state, body)?.name;
  const inPlay = inPlayOf(side);
  let next = state;
  let count = baseCount;
  const events: GameEvent[] = [];
  for (const entry of entries) {
    // Nothing left to reduce is not an application: no event and no once-per-game cap spent.
    if (count === 0) break;
    // Owner-prefixed gate read off the holder's top card name; the trailing space in the prefix
    // matters.
    if (
      entry.requiresHolderOwner !== undefined &&
      !(holderName ?? "").startsWith(`${entry.requiresHolderOwner}'s `)
    )
      continue;
    if (
      entry.requiresInPlay !== undefined &&
      !inPlay.some((pokemon) => topCardOf(next, pokemon)?.name === entry.requiresInPlay)
    )
      continue;
    // The per-GAME latch. Checked BEFORE the reduction is applied and stamped only
    // when it IS applied, so a cap is never spent by a clause some other rider
    // refused — and never spent twice by two copies of one printed effect.
    const spent = next.oncePerGameSpent[ref.seat];
    if (entry.oncePerGame !== undefined && spent.includes(entry.oncePerGame)) continue;
    const reduced = Math.max(0, count - entry.by);
    if (entry.oncePerGame !== undefined) {
      next = {
        ...next,
        oncePerGameSpent: { ...next.oncePerGameSpent, [ref.seat]: [...spent, entry.oncePerGame] },
      };
    }
    events.push({
      type: "PRIZE_REDUCED",
      seat: ref.seat,
      uid: ref.uid,
      by: count - reduced,
      count: reduced,
    });
    count = reduced;
  }
  return { state: next, count, events };
}

/**
 * The post-damage Knock Out sweep (§8.1): resolve every lethally damaged in-play Pokémon on `seats`
 * at once. Stages come back prizes first, then on-KO triggers, then promotions. A simultaneous win
 * for both players is the §14 tie, detected by speculatively taking the owed prizes; non-null
 * `done` is that tie. Prize guards such as Glimmora's coin flip are resolved up front so the
 * speculation and the real KO agree.
 */
export type KnockOutBatch =
  | { done: GameOutcome; state: GameState }
  | { done: null; state: GameState; stages: PendingStage[] };

export function collectKnockOuts(
  state: GameState,
  seats: readonly Seat[],
  events: GameEvent[],
  /**
   * Whether this is the Pokémon Checkup's sweep. Needed because `attackerSeat` is absent for both
   * the Checkup and mid-turn sweeps, and `state.turn` cannot tell them apart; the Knock Out bounty
   * pays during a turn but not in the Checkup.
   */
  checkup: boolean,
  attackerSeat?: Seat,
  /**
   * The attacking body's uid, passed only by `finishAttack` alongside `attackerSeat`; answers "by
   * an attack used by this Pokémon" (Greedy Eater).
   */
  attackerUid?: string,
): KnockOutBatch {
  let next = state;
  const stages: PendingStage[] = [];
  // Repeat passes until one finds nothing: a Knock Out can lower teammates' maximum HP (Vibrant
  // Dance) and make them lethal too. This terminates because every pass removes Pokémon from play.
  // The §14 tie check runs once over the whole batch, which is sound because a tie is monotone in
  // Knock Outs. Only the first pass counts as "by an attack".
  const koedSeats = new Set<Seat>();
  for (let pass = 0; pass < MAX_KO_PASSES; pass += 1) {
    const batch = collectKnockOutPass(
      next,
      seats,
      events,
      // Every pass, not only the first: a cascade Knock Out is still in the Checkup or in the turn.
      checkup,
      pass === 0 ? attackerSeat : undefined,
      pass === 0 ? attackerUid : undefined,
    );
    next = batch.state;
    if (batch.koedSeats.length === 0) break;
    for (const seat of batch.koedSeats) koedSeats.add(seat);
    stages.push(...batch.stages);
  }
  // §14 — a tie needs BOTH seats to have lost a Pokémon in this batch. A one-sided
  // batch only ever wins for the one player who gains the prizes and faces the
  // emptied board, so the guard runs only then; that is D-era reasoning unchanged,
  // asked of the accumulated refs instead of one pass's.
  const tie = koedSeats.size === 2 ? tiedOverTheBatch(next, stages) : null;
  if (tie !== null) return { done: tie, state: next };
  return { done: null, state: next, stages };
}

/**
 * The §14 tie check over a settled batch: take the owed prizes on a throwaway state and ask
 * `evaluateWin`. Only the prizes are speculative, since the Knock Outs already happened. Returns an
 * outcome only for a tie; a one-sided win is left to the stage path.
 */
function tiedOverTheBatch(state: GameState, stages: readonly PendingStage[]): GameOutcome | null {
  let speculative = state;
  for (const stage of stages) {
    if (stage.kind !== "takePrizes") continue;
    const side = speculative.players[stage.seat];
    speculative = withSide(speculative, stage.seat, {
      ...side,
      prizes: side.prizes.slice(stage.count),
    });
  }
  const outcome = evaluateWin(speculative);
  return outcome !== null && outcome.result === "tie" ? outcome : null;
}

/**
 * Hard upper bound on Knock Out passes: one per Pokémon that can be in play at once (Area Zero
 * Underdepths allows a Bench of 8).
 */
const MAX_KO_PASSES = 2 * (1 + BENCH_CEILING);

/**
 * What one pass Knocked Out: the post-KO state, the stages it queued and the seats it took a body
 * from.
 */
interface KnockOutPass {
  state: GameState;
  stages: PendingStage[];
  koedSeats: readonly Seat[];
}

/**
 * One pass of the sweep: plan prizes up front, then group stages as prizes, on-KO triggers,
 * promotions.
 */
function collectKnockOutPass(
  state: GameState,
  seats: readonly Seat[],
  events: GameEvent[],
  checkup: boolean,
  attackerSeat?: Seat,
  attackerUid?: string,
): KnockOutPass {
  const refs = lethalRefs(state, seats);
  if (refs.length === 0) return { state, stages: [], koedSeats: [] };

  // Resolve each on-KO Prize guard (Glimmora) once, up front, so the tie speculation and the real
  // KO share the same rng advance and counts. "By damage from an attack" is judged per body: a
  // `knockOutDefender` knock out in an attack epilogue is not by damage.
  const byAttackFor = (ref: { seat: Seat; uid: string }): boolean => {
    if (attackerSeat === undefined) return false;
    const side = state.players[ref.seat];
    const body = [side.active, ...side.bench].find((p) => p !== null && topUid(p) === ref.uid);
    // A ref whose body cannot be found answers true, falling back to the batch-level reading.
    return body === null || body === undefined ? true : !lethalByEffect(body, state.turn);
  };
  const plan = planPrizes(state, refs, checkup, attackerSeat, attackerUid);
  const startState = plan.state;

  // Apply each KO for real, grouping the stages PRIZES-first, then on-KO
  // triggers, then PROMOTIONS (§8.1/§13), preserving ref order within each
  // kind. A guard-denied KO queues no prize; an on-KO PROGRAM queues a koTrigger.
  let next = startState;
  const prizeStages: PendingStage[] = [];
  const koTriggerStages: PendingStage[] = [];
  const promoteStages: PendingStage[] = [];
  for (const entry of plan.entries) {
    // Asked of the pre-batch board, since earlier Knock Outs may have removed the body. Diver's
    // Catch is decided here, before `knockOut`, because the split happens inside its teardown.
    const rescuable =
      entry.ref.seat !== attackerSeat && byAttackFor(entry.ref)
        ? preBatchBody(state, entry.ref)
        : undefined;
    const ko = knockOut(
      next,
      entry.ref.seat,
      entry.ref.uid,
      otherSeat(entry.ref.seat),
      events,
      byAttackFor(entry.ref),
      rescuable === undefined
        ? []
        : // Infinite Shadow's own stack also returns via `toHand`.
          [
            ...koEnergyRescueUids(state, entry.ref.seat, rescuable),
            ...koSelfToHandUids(state, entry.ref.seat, rescuable),
          ],
    );
    next = ko.state;
    for (const guardEvent of entry.guardEvents) events.push(guardEvent);
    for (const stage of ko.stages) {
      if (stage.kind === "takePrizes") {
        if (entry.count > 0) prizeStages.push({ ...stage, count: entry.count });
      } else {
        promoteStages.push(stage);
      }
    }
    if (entry.hasProgram) {
      koTriggerStages.push({ kind: "koTrigger", seat: entry.ref.seat, uid: entry.ref.uid });
    }
    // Amulet of Hope: one `koTrigger` per Tool, behind the body's own on-KO stage. Tools are read
    // off the pre-batch board, since the stack is already in the discard pile; the KO must be by
    // damage from an opponent's attack.
    if (attackerSeat !== entry.ref.seat && byAttackFor(entry.ref)) {
      const holder = preBatchBody(state, entry.ref);
      for (const toolUid of holder === undefined ? [] : koHolderToolTriggersOf(state, holder)) {
        koTriggerStages.push({
          kind: "koTrigger",
          seat: entry.ref.seat,
          uid: entry.ref.uid,
          toolUid,
        });
      }
    }
  }
  return {
    state: next,
    stages: [...prizeStages, ...koTriggerStages, ...promoteStages],
    koedSeats: refs.map((ref) => ref.seat),
  };
}

/**
 * The in-play body on `ref.seat` whose top uid is `ref.uid` on the pre-batch board, or undefined.
 */
function preBatchBody(
  state: GameState,
  ref: { seat: Seat; uid: string },
): InPlayPokemon | undefined {
  const side = state.players[ref.seat];
  const bodies = inPlayOf(side);
  return bodies.find((body) => topUid(body) === ref.uid);
}

/**
 * The per-KO Prize plan for a batch. Resolves each on-KO Prize guard (Glimmora's coin flip) once,
 * threading rng, so the tie check and the real KO agree. Per ref it records the post-guard count,
 * the guard's events and any parking on-KO program.
 */
interface KoPrizePlan {
  ref: { seat: Seat; uid: string };
  count: number;
  guardEvents: GameEvent[];
  hasProgram: boolean;
}

/**
 * Prize bonuses for one Knock Out: Wonder Kiss and Greedy Eater on the taker's side, then the
 * attack-installed Knock Out bounty on the dying body. "Active" is read on the pre-KO state. The
 * bounty pays when the body was the Active, its record is for this turn, and the batch is not the
 * Checkup. A Glimmora-denied Knock Out never reaches here.
 */
function koPrizeBonus(
  state: GameState,
  ref: { seat: Seat; uid: string },
  baseCount: number,
  attackerUid: string | undefined,
  checkup: boolean,
  attackerSeat: Seat | undefined,
): { state: GameState; count: number; events: GameEvent[] } {
  const takerSeat = otherSeat(ref.seat);
  const side = state.players[ref.seat];
  const koWasActive = side.active !== null && topUid(side.active) === ref.uid;
  const bonuses = seatKoPrizeBonuses(
    state,
    takerSeat,
    // The DYING body's own card, read the way `planPrizes` already reads it one
    // scope up — `ref.uid` IS the top uid of that stack (`lethalRefs` collects
    // top uids), so `cardOfUid` and a `topCardOf` on the stack agree by
    // construction and the cheaper of the two is the honest one.
    cardOfUid(state, ref.uid),
    koWasActive,
    attackerUid,
  );
  let next = state;
  let count = baseCount;
  const events: GameEvent[] = [];
  for (const entry of bonuses) {
    events.push({
      type: "ABILITY_TRIGGERED",
      seat: takerSeat,
      uid: entry.uid,
      ability: entry.bonus.ability,
    });
    if (entry.bonus.coinFlip === true) {
      const [face, rngState] = flipCoin(next.rngState);
      next = { ...next, rngState };
      events.push({
        type: "ABILITY_COIN_FLIP",
        seat: takerSeat,
        uid: entry.uid,
        ability: entry.bonus.ability,
        result: face,
      });
      // Tails pays nothing, and the ABILITY_TRIGGERED / ABILITY_COIN_FLIP pair is
      // still emitted: the flip HAPPENED, it moved the rng, and a log that hid it
      // would leave the next coin in the game unexplainable.
      if (face !== "heads") continue;
    }
    count += entry.bonus.amount;
    events.push({
      type: "PRIZE_BONUS",
      seat: ref.seat,
      uid: ref.uid,
      by: entry.bonus.amount,
      count,
    });
  }
  // The Knock Out bounty, read off the dying body, after the seat bonuses.
  const dying = koWasActive ? side.active : null;
  const bounty = dying === null ? null : dying.koBounty;
  if (!checkup && bounty !== null && bounty.turn === state.turn) {
    count += bounty.amount;
    events.push({ type: "PRIZE_BONUS", seat: ref.seat, uid: ref.uid, by: bounty.amount, count });
  }
  // Briar: the taker's Supporter this turn, after the seat bonuses and the bounty. Not an Ability,
  // so no coin and no ABILITY_TRIGGERED.
  const briar = briarPrizeBonus(state, takerSeat, dying, attackerSeat, attackerUid, checkup);
  if (briar > 0) {
    count += briar;
    events.push({ type: "PRIZE_BONUS", seat: ref.seat, uid: ref.uid, by: briar, count });
  }
  return { state: next, count, events };
}

/**
 * Supporter Prize bonus (Briar: "During this turn, if your opponent's Active Pokémon is Knocked Out
 * by damage from an attack used by your Tera Pokémon, take 1 more Prize card."). Checked on the
 * pre-KO board: the taker's Supporter this turn carries the field, the dying body was the Active,
 * it is an attack epilogue outside the Checkup, the knock out is by damage, and the attacking card
 * (resolved by uid, not spot) matches the filter. An attacker that switched itself to the Bench
 * still counts.
 */
export function briarPrizeBonus(
  state: GameState,
  takerSeat: Seat,
  dying: InPlayPokemon | null,
  attackerSeat: Seat | undefined,
  attackerUid: string | undefined,
  checkup: boolean,
): number {
  if (dying === null || checkup || attackerUid === undefined) return 0;
  if (lethalByEffect(dying, state.turn)) return 0;
  const played = state.allowances.supporterPlayedUid;
  const playedId = played === null ? undefined : state.cardIdByUid[played];
  const rule = playedId === undefined ? undefined : programFor(playedId)?.supporterKoPrizeBonus;
  if (rule === undefined) return 0;
  if (attackerSeat !== takerSeat) return 0;
  return matchesFilter(cardOfUid(state, attackerUid), rule.attacker) ? rule.amount : 0;
}

function planPrizes(
  state: GameState,
  refs: readonly { seat: Seat; uid: string }[],
  checkup: boolean,
  attackerSeat?: Seat,
  attackerUid?: string,
): { state: GameState; entries: KoPrizePlan[] } {
  let next = state;
  const entries: KoPrizePlan[] = [];
  for (const ref of refs) {
    const card = cardOfUid(next, ref.uid);
    const baseCount = card === undefined ? 1 : prizeValueOf(card);
    const ability = onKnockOutTrigger(next, ref.uid);
    const hasProgram =
      ability !== undefined &&
      ability.program.length > 0 &&
      // Final Chain's printed cause; absent means every Knock Out.
      (ability.byOpponentAttack !== true || koByOpponentAttack(next, ref, attackerSeat)) &&
      // Sandy Flapping's "if this Pokémon is in the Active Spot", on the pre-batch board; absent
      // means anywhere.
      (ability.activeOnly !== true || koWasActiveSpot(next, ref));
    // Every entry passes through here, so attached reductions and then seat-wide bonuses apply on
    // every on-KO path, in printed order. `denied` is not `count === 0`: Glimmora's "can't take
    // any" is a prohibition a bonus cannot overturn, while a reduction clamped to 0 can still
    // receive a bonus.
    const push = (count: number, guardEvents: GameEvent[], denied = false): void => {
      const attached = seatPrizeReduction(
        attachedPrizeReductions(next, ref, attackerSeat, count),
        ref,
        attackerSeat,
        attackerUid,
      );
      next = attached.state;
      const bonus = denied
        ? { state: next, count: attached.count, events: [] as GameEvent[] }
        : koPrizeBonus(next, ref, attached.count, attackerUid, checkup, attackerSeat);
      next = bonus.state;
      entries.push({
        ref,
        count: bonus.count,
        guardEvents: [...guardEvents, ...attached.events, ...bonus.events],
        hasProgram,
      });
    };
    // Cause-conditioned Prize reduction (Munkidori ex), checked before the coin-flip guard; an
    // on-KO Ability carries at most one of the two.
    const reduction = ability === undefined ? undefined : ability.onKoPrizeReduction;
    if (ability !== undefined && reduction !== undefined) {
      const count = koPrizeReduction(next, ref, reduction, attackerSeat, baseCount);
      if (count === null) {
        push(baseCount, []);
      } else {
        push(count, [
          { type: "ABILITY_TRIGGERED", seat: ref.seat, uid: ref.uid, ability: ability.name },
          {
            type: "PRIZE_REDUCED",
            seat: ref.seat,
            uid: ref.uid,
            by: baseCount - count,
            count,
          },
        ]);
      }
      continue;
    }
    // Fragile Husk: Glimmora's prohibition, gated on being Knocked Out by an ex.
    if (ability?.onKoPrizeGuard === "pokemonExAttackPrevent") {
      if (koByOpponentPokemonEx(next, ref, attackerSeat, attackerUid)) {
        const prevented: GameEvent[] = [
          { type: "ABILITY_TRIGGERED", seat: ref.seat, uid: ref.uid, ability: ability.name },
          { type: "PRIZE_PREVENTED", seat: ref.seat, uid: ref.uid },
        ];
        push(0, prevented, true);
      } else {
        push(baseCount, []);
      }
      continue;
    }
    if (ability?.onKoPrizeGuard !== "coinFlipPrevent") {
      push(baseCount, []);
      continue;
    }
    const guardEvents: GameEvent[] = [
      { type: "ABILITY_TRIGGERED", seat: ref.seat, uid: ref.uid, ability: ability.name },
    ];
    const [face, rngState] = flipCoin(next.rngState);
    next = { ...next, rngState };
    guardEvents.push({
      type: "ABILITY_COIN_FLIP",
      seat: ref.seat,
      uid: ref.uid,
      ability: ability.name,
      result: face,
    });
    if (face === "heads") {
      guardEvents.push({ type: "PRIZE_PREVENTED", seat: ref.seat, uid: ref.uid });
      push(0, guardEvents, true); // A prohibition: no bonus, and no flip.
    } else {
      push(baseCount, guardEvents);
    }
  }
  return { state: next, entries };
}

/**
 * A Knock Out during `actorSeat`'s turn that does not end it (an evolve dropping HP, a snipe
 * effect): resolve every KO on `seats`, then resume the turn. `seats` must include every board the
 * effect damaged so the sweep and tie guard see every KO. Also queues a promotion for an Active
 * Spot emptied without a Knock Out (`returnSelf`).
 */
export function resolveMidTurnKnockOuts(
  state: GameState,
  actorSeat: Seat,
  seats: readonly Seat[],
  events: GameEvent[],
  /**
   * What follows the sweep's stages instead of `resumeTurn`: the turn tail when the action ends the
   * turn (Daydream). Absent means `resumeTurn`.
   */
  tail?: PendingStage[],
  /**
   * Who trims first when both seats are over their Bench limit: the replaced Stadium's owner.
   * Absent means `actorSeat`.
   */
  trimFirst?: Seat,
): ApplyResult {
  // A mid-turn Knock Out is during a turn, so the bounty pays.
  const batch = collectKnockOuts(state, seats, events, false);
  if (batch.done !== null) return finishGame(batch.state, batch.done, events);
  const orphaned = orphanedPromotions(batch.state, seats, batch.stages);
  // Area Zero Underdepths state check: a seat over its Bench limit trims, behind the sweep's prize
  // and promotion stages. `queued` trims already put on `pending` by `discardStadium` keep their
  // order, and their seats are skipped.
  const queued = batch.state.pending.filter((stage) => stage.kind === "benchTrim");
  const trims = [...queued, ...benchTrimStages(batch.state, trimFirst ?? actorSeat, queued)];
  // Nothing knocked out, no empty spot and no Bench over its limit; the fast path still checks the
  // trim.
  if (
    batch.stages.length === 0 &&
    orphaned.length === 0 &&
    trims.length === 0 &&
    tail === undefined
  ) {
    return ok(batch.state, events);
  }
  return advance(
    {
      ...batch.state,
      pending: [
        ...batch.stages,
        ...orphaned,
        ...trims,
        ...(tail ?? [{ kind: "resumeTurn", seat: actorSeat }]),
      ],
    },
    events,
  );
}

/**
 * The shared attack epilogue (§8.1, §5.3), reached by every exit out of `attack`: sweep both boards
 * for Knock Outs, then end the attacker's turn behind the KO stages (or open Festival Lead's
 * attack-again window). The sweep order is [defender, attacker] because the turn player takes
 * Prizes first. Lives in flow.ts because `advance` must reach it and attack.ts already imports
 * flow. `attackerUid` only matters on the `attackEpilogue` stage path, but every caller passes it.
 */
export function finishAttack(
  state: GameState,
  events: GameEvent[],
  attackerSeat: Seat,
  attackerUid: string,
  attackName: string,
): ApplyResult {
  // KO-conditioned recoil (Vengeful Punch) is placed before the sweep so the holder's and
  // attacker's Knock Outs form one simultaneous batch (§8.1) and the tie guard can see both. Only
  // `otherSeat(attackerSeat)` is scanned, and only the attack epilogue reaches this, which
  // discharges the printed attack conditions. The attacker is `attackerUid`, found anywhere on the
  // board since it may have switched or left play (then no counters land). `usedAttack` and the
  // seat attacker record are written here at the end so this attack cannot satisfy its own
  // declaration-time condition; `state.turn` is still the attacking turn.
  let next = stampAttackUse(state, attackerSeat, attackerUid, attackName);
  next = stampSeatAttacker(next, attackerSeat, attackerUid);
  // Luminous Wing on the attacker, read by uid in either zone: the recoil's Ability share is
  // refused and announced.
  const attackerBody = [
    next.players[attackerSeat].active,
    ...next.players[attackerSeat].bench,
  ].find((body) => body !== null && body !== undefined && topUid(body) === attackerUid);
  const shielded = attackerBody != null && passivesOf(next, attackerBody).preventAbilityEffects;
  // Battle Cage: an attacker on its own Bench takes no counters from an Ability share; a Tool's
  // share still lands. No row is filed.
  const caged =
    stadiumEffectsOf(next)?.benchCounterShield === true &&
    next.players[attackerSeat].bench.some((body) => topUid(body) === attackerUid);
  const koRecoil = koRecoilOf(next, otherSeat(attackerSeat), shielded || caged);
  if (shielded && koRecoil < koRecoilOf(next, otherSeat(attackerSeat))) {
    events.push({ type: "ABILITY_EFFECT_PREVENTED", seat: attackerSeat, uid: attackerUid });
  }
  const recoiled = koRecoil > 0 ? addDamageByUid(next, attackerSeat, attackerUid, koRecoil) : null;
  if (recoiled !== null) {
    next = recoiled;
    // `seat` is the attacker's (it owns the damaged Pokémon) while the cause is the dying holder,
    // so the log renders it system-voiced.
    events.push({
      type: "COUNTERS_PLACED",
      seat: attackerSeat,
      uid: attackerUid,
      amount: koRecoil,
      source: "counterattack",
    });
  }
  // Fainting Spell: after the KO recoil, before the sweep, so a doomed attacker joins this batch
  // and its Prize goes to the Gengar side.
  next = faintingSpells(next, attackerSeat, attackerUid, events);

  // `attackerSeat` is passed only here; it is what distinguishes the attack epilogue from the other
  // sweeps inside `collectKnockOuts`.
  const batch = collectKnockOuts(
    next,
    [otherSeat(attackerSeat), attackerSeat],
    events,
    false, // An attack's epilogue is during the turn, not the Checkup.
    attackerSeat,
    attackerUid,
  );
  if (batch.done !== null) return finishGame(batch.state, batch.done, events);
  // Promotion for an Active Spot emptied without a Knock Out (Surf Back), queued in front of the
  // turn tail since a player may not hand over a board with an empty Active Spot. Seats the KO
  // batch already queued a promotion for are skipped.
  const orphaned = orphanedPromotions(
    batch.state,
    [otherSeat(attackerSeat), attackerSeat],
    batch.stages,
  );
  // Area Zero Underdepths state check: the attack knocked out or bounced a seat's last Tera
  // Pokémon. Queued behind the KO stages, in front of the tail, attacker's seat first.
  const trims = benchTrimStages(batch.state, attackerSeat, batch.state.pending);
  // Festival Lead: "If the first attack Knocks Out your opponent's Active Pokémon, you may attack
  // again after your opponent chooses a new Active Pokémon." Opens only on the first attack of the
  // turn, only if the attacker is still in its Active Spot and the Ability and Festival Grounds
  // still apply. The KO stages stay in front, then `resumeTurn`; `turnGate` limits the turn to
  // attack or end turn.
  const swept = batch.state.players[attackerSeat].active;
  if (
    batch.state.allowances.attackAgainUid === null &&
    swept !== null &&
    topUid(swept) === attackerUid &&
    attackAgainLicensed(batch.state, attackerSeat, swept)
  ) {
    const windowed: GameState = {
      ...batch.state,
      allowances: { ...batch.state.allowances, attackAgainUid: attackerUid },
    };
    return advance(
      {
        ...windowed,
        pending: [
          ...batch.stages,
          ...orphaned,
          ...trims,
          { kind: "resumeTurn", seat: attackerSeat },
          ...batch.state.pending,
        ],
      },
      events,
    );
  }
  // §5.3: attacking ends the turn, through the same staged tail as a pass. Composes with whatever
  // is queued rather than overwriting it, so a missing pop surfaces.
  const pending: PendingStage[] = [
    ...batch.stages,
    ...orphaned,
    ...trims,
    ...turnTail(attackerSeat),
    ...batch.state.pending,
  ];
  return advance({ ...batch.state, pending }, events);
}

/**
 * Fold a completed or parked effect program back into `controller`'s turn. Parked: set the
 * effect:choose interrupt and emit EFFECT_PENDING. Done: resolve any mid-turn Knock Out the program
 * caused, then return to turn:action. `opts.resumeTail` marks a program already inside a tail
 * (on-KO triggers, attack effect programs); its done branch keeps draining `pending` instead of
 * returning to the turn.
 */
export function settleProgram(
  result: RunResult,
  controller: Seat,
  events: GameEvent[],
  opts: { resumeTail?: boolean; endsTurn?: boolean } = {},
): ApplyResult {
  // §12: restore the recovery invariant on every program completion, before anything else reads the
  // board, so Energy attached or moved by a program clears conditions it should. Runs before the
  // park branch so a parked program does not carry a stale condition across the decision.
  const settled = recoverStatuses(result.state, events);
  if (result.kind === "parked") {
    // EFFECT_PENDING's seat is the seat that MUST RESOLVE the decision (its own
    // doc) — the park's decider when one is named (opponentMayDraw: Ortega's
    // "your opponent may"), else the controller, which is who it always was.
    events.push({
      type: "EFFECT_PENDING",
      seat: result.decider ?? controller,
      note: result.prompt.note,
    });
    return ok(
      {
        ...settled,
        phase: {
          kind: "effect:choose",
          seat: controller,
          prompt: result.prompt,
          cont: result.cont,
          // The answering seat, only when it is not the controller. `seat` stays the controller,
          // who still owns the turn.
          ...(result.decider !== undefined && result.decider !== controller
            ? { answerer: result.decider }
            : {}),
          // Carry the fold flags across a park so resolveEffect folds the same
          // way once the (possibly re-parking) program finishes: resumeTail
          // resumes the KO tail, endsTurn ends the controller's turn.
          ...(opts.resumeTail === true ? { resumeTail: true as const } : {}),
          ...(opts.endsTurn === true ? { endsTurn: true as const } : {}),
        },
      },
      events,
    );
  }
  // DONE. A mid-tail program hands control back to the queue behind it — the
  // KO sweep's prize/promotion stages, or an attack's epilogue — so keep
  // draining rather than folding to a turn.
  if (opts.resumeTail === true) return advance(settled, events);
  // An Ability that ends the turn (Dino Cry), or a hand attach that tripped a Daydream mark, seeds
  // the turn tail instead of returning to turn:action. No mid-turn KO sweep is owed since these
  // programs do not damage.
  if (opts.endsTurn === true || handAttachTripped(settled, controller)) {
    // A Bench trim queued by an in-program `discardStadium` stays in front of the tail.
    const queued = settled.pending.filter((stage) => stage.kind === "benchTrim");
    return advance({ ...settled, pending: [...queued, ...turnTail(controller)] }, events);
  }
  const resumed: GameState = { ...settled, phase: { kind: "turn:action", seat: controller } };
  // A Trainer or Ability program that queued Prize stages (Lt. Surge's Bargain) drains them here in
  // order, behind a §14 tie check over all of them.
  const prizes = resumed.pending.filter((stage) => stage.kind === "takePrizes");
  if (prizes.length > 0) {
    const tie = tiedOverTheBatch(resumed, prizes);
    if (tie !== null) return finishGame(resumed, tie, events);
    return advance(
      { ...resumed, pending: [...resumed.pending, { kind: "resumeTurn", seat: controller }] },
      events,
    );
  }
  return resolveMidTurnKnockOuts(resumed, controller, SEATS, events);
}

/** Does any of `seat`'s bodies carry a live, tripped Daydream hand-attach mark? */
function handAttachTripped(state: GameState, seat: Seat): boolean {
  const side = state.players[seat];
  const bodies = inPlayOf(side);
  // `?.` because hand-built test bodies may omit the field.
  return bodies.some(
    (body) => body.handAttachMark?.turn === state.turn && body.handAttachMark.tripped,
  );
}

/**
 * Run the on-KO triggered Ability of the just-Knocked-Out `uid`, queued by the KO sweep. It runs
 * during the opponent's turn with the KO'd player as controller; a park resumes the remaining prize
 * and promotion tail. A stage with nothing to run just keeps draining.
 */
function runKoTrigger(
  state: GameState,
  koedSeat: Seat,
  uid: string,
  events: GameEvent[],
  /**
   * Amulet of Hope: run the Tool's `onHolderKnockedOut` program instead of the body's Ability, with
   * the Tool as `sourceUid` and no ABILITY_TRIGGERED row.
   */
  toolUid?: string,
): ApplyResult {
  if (toolUid !== undefined) {
    const amulet = toolTriggerOf(state, toolUid, "onHolderKnockedOut");
    if (amulet === undefined) return advance(state, events);
    return settleProgram(
      runProgram(state, amulet.program, { seat: koedSeat, sourceUid: toolUid }, events),
      koedSeat,
      events,
      { resumeTail: true },
    );
  }
  const ability = onKnockOutTrigger(state, uid);
  if (ability === undefined || ability.program.length === 0) return advance(state, events);
  events.push({ type: "ABILITY_TRIGGERED", seat: koedSeat, uid, ability: ability.name });
  // sourceUid names a card that has LEFT play — honest (the program is that
  // card's own printed sentence), and a source-reading op then finds no board
  // top for it and whiffs, which is what "this Pokémon" means after a KO.
  return settleProgram(
    runProgram(
      state,
      ability.program,
      { seat: koedSeat, sourceUid: uid, invokedBy: "ability" },
      events,
    ),
    koedSeat,
    events,
    { resumeTail: true },
  );
}

/**
 * Run one `onDamagedByAttack` reaction on the damaged Active, queued after the attack's effect
 * program and before `finishAttack`'s sweep, so the reaction lands even if the Pokémon is Knocked
 * Out. `uid` names the Active's top card (its Ability) or an attached Tool (Lucky Helmet, Handheld
 * Fan); one stage per source so a parking program cannot strand others. Runs under `damagedSeat`,
 * who answers any prompt. A source that no longer applies just keeps draining.
 */
function runDamagedTrigger(
  state: GameState,
  damagedSeat: Seat,
  uid: string,
  events: GameEvent[],
): ApplyResult {
  const holder = state.players[damagedSeat].active;
  const holderUid = holder === null ? undefined : topUid(holder);
  // "The Attacking Pokémon" is the attacker as of declaration, carried by the `attackEpilogue`
  // stage; the attack's program may have switched it to the Bench.
  const epilogue = state.pending.find(
    (stage) => stage.kind === "attackEpilogue" && stage.seat === otherSeat(damagedSeat),
  );
  const attackerUid = epilogue?.kind === "attackEpilogue" ? epilogue.uid : undefined;
  const attackerCtx = attackerUid === undefined ? {} : { attackerUid };
  const tool =
    holderUid === undefined
      ? undefined
      : damagedToolTriggersOf(state, damagedSeat, holderUid).find((entry) => entry.toolUid === uid);
  if (tool !== undefined) {
    return settleProgram(
      runProgram(
        state,
        tool.ability.program,
        { seat: damagedSeat, sourceUid: uid, ...attackerCtx },
        events,
      ),
      damagedSeat,
      events,
      { resumeTail: true },
    );
  }
  const ability = damagedByAttackAbility(state, damagedSeat, uid);
  if (ability === undefined || ability.program.length === 0) return advance(state, events);
  events.push({ type: "ABILITY_TRIGGERED", seat: damagedSeat, uid, ability: ability.name });
  return settleProgram(
    runProgram(
      state,
      ability.program,
      { seat: damagedSeat, sourceUid: uid, invokedBy: "ability", ...attackerCtx },
      events,
    ),
    damagedSeat,
    events,
    { resumeTail: true },
  );
}

/**
 * Run a Tool's on-Active-Knock-Out program (Exp. Share, Heavy Baton) or Photon Cord for `koedSeat`,
 * whose Active is about to be Knocked Out by the opponent's attack. Placed ahead of
 * `attackEpilogue` because `knockOut` discards the stack before any `koTrigger` could act. Every
 * clause is re-checked here: the current Active, lethal by the sweep's own predicate, and by
 * damage. Fires only the first live match. A Tool runs with its own uid as `sourceUid` and no
 * ABILITY_TRIGGERED row.
 */
function runKoToolTrigger(state: GameState, koedSeat: Seat, events: GameEvent[]): ApplyResult {
  const active = state.players[koedSeat].active;
  if (active === null || !isLethallyDamaged(state, active)) return advance(state, events);
  // Every entry prints "Knocked Out by damage from an attack", so a `knockOutDefender` knock out
  // fires none of them.
  if (lethalByEffect(active, state.turn)) return advance(state, events);
  const uid = topUid(active);
  if (uid === undefined) return advance(state, events);
  // Heavy Baton's "Retreat Cost of exactly 4", read from the effective cost before `knockOut`
  // discards the stack. A Baton that fails it is not a match.
  const entry = koToolTriggersOf(state, koedSeat, uid).find(
    (candidate) =>
      candidate.ability.trigger !== "onHolderActiveKnockedOut" ||
      effectiveRetreatCost(state, active) === 4,
  );
  if (entry === undefined || entry.ability.program.length === 0) return advance(state, events);
  // Photon Cord, the scan's Ability arm, announces itself and runs as an Ability.
  if (entry.fromAbility === true) {
    events.push({ type: "ABILITY_TRIGGERED", seat: koedSeat, uid, ability: entry.ability.name });
    return settleProgram(
      runProgram(
        state,
        entry.ability.program,
        { seat: koedSeat, sourceUid: uid, invokedBy: "ability" },
        events,
      ),
      koedSeat,
      events,
      { resumeTail: true },
    );
  }
  return settleProgram(
    runProgram(state, entry.ability.program, { seat: koedSeat, sourceUid: entry.toolUid }, events),
    koedSeat,
    events,
    { resumeTail: true },
  );
}

/**
 * Run Powerglass's end-of-turn program for `toolUid` if the Tool is still on `seat`'s Active, else
 * drain as a whiff. `sourceUid` is the holder's top uid, not the Tool's, so "attach ... to it"
 * resolves to the holder. Fires on every turn end; an attack is not required.
 */
function runEndTurnToolTrigger(
  state: GameState,
  seat: Seat,
  toolUid: string,
  events: GameEvent[],
): ApplyResult {
  const holder = state.players[seat].active;
  const holderUid = holder === null ? undefined : topUid(holder);
  const entry = endTurnToolTriggersOf(state, seat).find((live) => live.toolUid === toolUid);
  if (holderUid === undefined || entry === undefined) return advance(state, events);
  return settleProgram(
    runProgram(state, entry.ability.program, { seat, sourceUid: holderUid }, events),
    seat,
    events,
    { resumeTail: true },
  );
}

/**
 * §12 recovery: clear any Special Condition that a live continuous effect says the Pokémon recovers
 * from (Therapeutic Energy, Festival Grounds). This is a write, not a derived view, because
 * recovering is one-way: the condition must not return when the source leaves. Only the Active is
 * scanned, since every route off the Active Spot already clears conditions. Called at each moment a
 * recovery source can newly cover a body: manual Energy attach, Tool attach, program completion,
 * Checkup trigger completion, and Stadium play.
 */
export function recoverStatuses(state: GameState, events: GameEvent[]): GameState {
  let next = state;
  for (const seat of SEATS) {
    const active = next.players[seat].active;
    if (active === null) continue;
    const recovers = passivesOf(next, active).statusRecovery;
    // Festival Grounds: while in play, an Active with any Energy recovers from every Special
    // Condition, not only the named ones.
    const festival = stadiumShieldsStatus(next, active);
    if (recovers.length === 0 && !festival) continue;
    const cleared = presentStatuses(active.conditions).filter(
      (status) => festival || recovers.includes(status),
    );
    if (cleared.length === 0) continue;
    const uid = topUid(active);
    if (uid === undefined) continue;
    // Only the conditions the effect NAMES come off. A Therapeutic Energy on a
    // Burned, Poisoned, Asleep body wakes it and leaves the other two ticking —
    // the same per-condition claim `statusImmunities` makes on the other clause.
    let conditions = active.conditions;
    for (const status of cleared) {
      if (status === "burned") conditions = { ...conditions, burned: false };
      else if (status === "poisoned") conditions = { ...conditions, poisonDamage: 0 };
      else conditions = { ...conditions, rotation: "none" };
    }
    next = withActive(next, seat, { ...active, conditions });
    events.push({ type: "STATUS_CLEARED", seat, uid, statuses: cleared, reason: "recovered" });
  }
  return next;
}

/** The Pokémon Checkup (§13), run whole inside its stage — no player
    decisions happen mid-checkup, so there is no checkup phase: the four
    condition steps tick in their fixed order, THEN the batch's KOs resolve
    (order-faithful — a Pokémon lethally poisoned still takes its burn tick
    and flips its wake-up flip, §13 "one batch"). Within each step the seat
    whose turn just ended processes first. The KO stage-pairs go in front of
    the remaining tail and park on the same ko:* interrupts as attack KOs;
    prizes go to the opponent (no one attacked). */
function runCheckup(state: GameState, endedSeat: Seat, events: GameEvent[]): ApplyResult {
  const order: readonly Seat[] = [endedSeat, otherSeat(endedSeat)];
  let next = state;

  // Delayed effects scheduled for the end of the opponent's turn ("At the end of your opponent's
  // next turn, ...") run before §13.1, since end of turn precedes Pokémon Checkup. Only
  // `endedSeat`'s Active can carry a schedule. The stamp expires by arithmetic, so nothing is
  // cleared after firing. Payloads: damage counters; a discard of the body and its attached cards,
  // which is not a Knock Out and pays no Prize but still owes a promotion; and a Knock Out, which
  // only marks the body so the §8.1 sweep below resolves it (a Checkup heal in between can save
  // it). The Knock Out payload is stamped `koByEffect` unless the body was already lethally
  // damaged.
  {
    const spot = activeTop(next, endedSeat);
    const due = spot === null ? null : scheduledEffectDue(spot.active, next.turn);
    if (spot !== null && due !== null) {
      const { active, uid } = spot;
      switch (due.kind) {
        case "counters": {
          next = withActive(next, endedSeat, { ...active, damage: active.damage + due.amount });
          events.push({
            type: "COUNTERS_PLACED",
            seat: endedSeat,
            uid,
            amount: due.amount,
            source: "delayed",
          });
          break;
        }
        // Discard payload: no Prize is taken.
        case "discard": {
          const cleanup = discardFromStack(next.players[endedSeat], active, "all");
          next = withSide(next, endedSeat, { ...cleanup.side, active: null });
          events.push({
            type: "POKEMON_RETURNED",
            seat: endedSeat,
            uid,
            actor: otherSeat(endedSeat),
            dest: "discard",
            uids: cleanup.discarded,
          });
          break;
        }
        // Knock Out payload: marked here, resolved with its Prize by the §8.1 sweep below.
        case "knockOut": {
          const marker = isLethallyDamaged(next, active) ? undefined : koByEffectMarker(next.turn);
          next = doomBodyAt(next, { seat: endedSeat, spot: { spot: "active" } }, marker);
          break;
        }
      }
    }
  }

  // §13.1 Poison: the condition's own counter amount plus Perilous Jungle's 2 extra counters on
  // non-{D} Pokémon, summed into one `COUNTERS_PLACED` row.
  for (const seat of order) {
    const spot = activeTop(next, seat);
    if (spot === null || spot.active.conditions.poisonDamage <= 0) continue;
    const { active, uid } = spot;
    const amount =
      // Perilous Jungle's {D} exemption reads the in-play card's types.
      active.conditions.poisonDamage + stadiumPoisonExtraCounters(next, inPlayCardOf(next, active));
    next = withActive(next, seat, { ...active, damage: active.damage + amount });
    events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: "poison" });
  }

  // §13.2 Burn: 20 damage plus 3 counters per unsilenced opposing Magmortar ("Magma Surge"), placed
  // before the cure flip and summed into one row.
  for (const seat of order) {
    const spot = activeTop(next, seat);
    if (spot === null || !spot.active.conditions.burned) continue;
    const { active, uid } = spot;
    // Magma Surge's extra counters are an Ability effect, so Mega Clefable ex "Luminous Wing"
    // prevents them; the rulebook's 20 still lands.
    const surge = seatBurnExtraCounters(next, seat);
    const surgeRefused = surge > 0 && passivesOf(next, active).preventAbilityEffects;
    if (surgeRefused) events.push({ type: "ABILITY_EFFECT_PREVENTED", seat, uid });
    const burn = 20 + (surgeRefused ? 0 : surge);
    let updated = { ...active, damage: active.damage + burn };
    events.push({ type: "COUNTERS_PLACED", seat, uid, amount: burn, source: "burn" });
    const [face, rngState] = flipCoin(next.rngState);
    events.push({ type: "CHECKUP_COIN_FLIP", seat, status: "burned", result: face });
    if (face === "heads") {
      updated = { ...updated, conditions: { ...updated.conditions, burned: false } };
      events.push({ type: "STATUS_CLEARED", seat, uid, statuses: ["burned"], reason: "burnCured" });
    }
    next = { ...withActive(next, seat, updated), rngState };
  }

  // §13.3 Asleep — the wake-up flip (heads removes it).
  for (const seat of order) {
    const spot = activeTop(next, seat);
    if (spot === null || spot.active.conditions.rotation !== "asleep") continue;
    const { active, uid } = spot;
    const [face, rngState] = flipCoin(next.rngState);
    events.push({ type: "CHECKUP_COIN_FLIP", seat, status: "asleep", result: face });
    let updated = active;
    if (face === "heads") {
      updated = { ...active, conditions: { ...active.conditions, rotation: "none" } };
      events.push({ type: "STATUS_CLEARED", seat, uid, statuses: ["asleep"], reason: "wokeUp" });
    }
    next = { ...withActive(next, seat, updated), rngState };
  }

  // §13.4 Paralysis recovers only for the player whose turn just ended, with no flip.
  // Self-inflicted paralysis would break this, but no supported card can apply it.
  {
    const spot = activeTop(next, endedSeat);
    if (spot !== null && spot.active.conditions.rotation === "paralyzed") {
      next = withActive(next, endedSeat, {
        ...spot.active,
        conditions: { ...spot.active.conditions, rotation: "none" },
      });
      events.push({
        type: "STATUS_CLEARED",
        seat: endedSeat,
        uid: spot.uid,
        statuses: ["paralyzed"],
        reason: "paralysisEnded",
      });
    }
  }

  // §11 The retreat block ("During your opponent's next turn, the Defending Pokémon can't
  // retreat.") expires on the same clock as paralysis, so the same `endedSeat`-only clear gives the
  // printed duration.
  {
    const spot = activeTop(next, endedSeat);
    if (spot?.active.retreatBlocked) {
      next = withActive(next, endedSeat, { ...spot.active, retreatBlocked: false });
      events.push({ type: "RETREAT_BLOCK_ENDED", seat: endedSeat, uid: spot.uid });
    }
  }

  // §9/§13 — between-turns triggered Abilities fire during the Checkup, after
  // the condition ticks and before the KO sweep: a heal-each (Garganacl's
  // Blessed Salt) and a fixed counter placement (Trevenant's Forest Miasma,
  // which can lethally damage the opponent's Active — swept below). They are
  // non-parking, so they thread straight through. The engine fires them in a
  // fixed order ([endedSeat, other], Active then Bench); the official
  // player-ordered Checkup is simplified to this deterministic order.
  next = runCheckupTriggers(next, order, events);

  // Resolve the batch's Knock Outs through the shared sweep, in [endedSeat, other] order. The flag
  // marks the sweep as between turns, so a this-turn bounty does not pay.
  const batch = collectKnockOuts(next, order, events, true);
  if (batch.done !== null) return finishGame(batch.state, batch.done, events);
  // A delayed discard can empty an Active Spot with no Knock Out, so owed promotions are spliced in
  // front of the queued `startTurn`. Both seats are scanned as a harmless superset.
  const orphaned = orphanedPromotions(batch.state, order, batch.stages);
  // §7.3 Area Zero Underdepths: a Checkup Knock Out of a seat's last Tera Pokémon can shrink its
  // Bench limit. The trim queues behind the prize and promotion stages and before the next
  // `startTurn`, ended seat first.
  const trims = benchTrimStages(batch.state, endedSeat);
  // Pop the checkup stage, put the KO stages in front of what remains
  // (the startTurn) and keep draining — a decision stage parks as usual.
  return advance(
    {
      ...batch.state,
      pending: [...batch.stages, ...orphaned, ...trims, ...batch.state.pending.slice(1)],
    },
    events,
  );
}

/**
 * §7.3 Drain one `benchTrim` stage: `seat` discards Benched Pokémon until back at its limit. The
 * excess is re-read when the stage drains, since a promotion in front may have shrunk the Bench.
 * The bench owner chooses, and the queue behind resumes once it lands.
 */
function runBenchTrim(state: GameState, seat: Seat, events: GameEvent[]): ApplyResult {
  // No guard here: the op re-reads the excess itself and finishes at once (no park) when the
  // seat is back at its limit, and the `resumeTail` fold then just keeps draining.
  return settleProgram(runProgram(state, [{ op: "trimBench" }], { seat }, events), seat, events, {
    resumeTail: true,
  });
}

/**
 * §7.4 Drain one `toolTrim` stage: `seat` discards Tools from each body over `toolCapOf` (e.g.
 * after Multi Adapter leaves). The owner chooses, and the queue behind resumes once it lands.
 */
function runToolTrim(state: GameState, seat: Seat, events: GameEvent[]): ApplyResult {
  const side = state.players[seat];
  const bodies = inPlayOf(side);
  const over = bodies.filter((body) => owesToolTrim(state, seat, body)).length;
  const program = Array.from({ length: over }, (): EffectOp => ({ op: "trimTools" }));
  return settleProgram(runProgram(state, program, { seat }, events), seat, events, {
    resumeTail: true,
  });
}

/**
 * Boomerang Energy: re-attach each uid the attack's own program discarded off its attacker to that
 * body, found by uid across its board (a self-switched attacker still counts). Nothing happens if
 * the attacker left play or the card left the discard pile.
 */
function returnBoomerangs(
  start: GameState,
  stage: Extract<PendingStage, { kind: "attackEpilogue" }>,
  events: GameEvent[],
): GameState {
  const recorded = stage.boomerang ?? [];
  if (recorded.length === 0) return start;
  // Nitro Fire Energy returns from the discard pile to the hand instead of re-attaching.
  const toHand = (uid: string): boolean => {
    const id = start.cardIdByUid[uid];
    return id !== undefined && programFor(id)?.energy?.returnAfterAttackDiscard === "hand";
  };
  const before = start.players[stage.seat];
  const handed = recorded.filter(
    (uid, i) => toHand(uid) && before.discard.includes(uid) && recorded.indexOf(uid) === i,
  );
  if (handed.length > 0)
    events.push({ type: "DISCARD_RETRIEVED", seat: stage.seat, dest: "hand", uids: [...handed] });
  const state =
    handed.length === 0
      ? start
      : withSide(start, stage.seat, {
          ...before,
          hand: [...before.hand, ...handed],
          discard: before.discard.filter((uid) => !handed.includes(uid)),
        });
  const uids = recorded.filter((uid) => !toHand(uid));
  if (uids.length === 0) return state;
  const side = state.players[stage.seat];
  const onBench = side.bench.findIndex((body) => topUid(body) === stage.uid);
  const onActive = side.active !== null && topUid(side.active) === stage.uid;
  if (!onActive && onBench === -1) return state;
  const back = uids.filter((uid, i) => side.discard.includes(uid) && uids.indexOf(uid) === i);
  if (back.length === 0) return state;
  const host = (body: InPlayPokemon): InPlayPokemon => ({
    ...body,
    energy: [...body.energy, ...back],
  });
  const next = withSide(state, stage.seat, {
    ...side,
    active: onActive && side.active !== null ? host(side.active) : side.active,
    bench: onActive
      ? side.bench
      : side.bench.map((body, index) => (index === onBench ? host(body) : body)),
    discard: side.discard.filter((uid) => !back.includes(uid)),
  });
  for (const uid of back) {
    events.push({
      type: "ENERGY_ATTACHED",
      seat: stage.seat,
      uid,
      target: onActive ? { spot: "active" } : { spot: "bench", index: onBench },
    });
  }
  return recoverStatuses(next, events);
}

/** §14.1–§14.2, evaluated for BOTH seats at once and in precedence order per
    seat (taking your last prize outranks the opponent's empty board when
    both hold at the same instant). Both seats winning together is the §14
    simultaneous case and comes back a TIE — deck-out (§14.3) cannot
    participate, it is checked at the single drawing player's draw
    (startTurn). Null = play on. */
export function evaluateWin(state: GameState): GameOutcome | null {
  const reasons: Partial<Record<Seat, GameOverReason>> = {};
  for (const seat of SEATS) {
    const opponent = state.players[otherSeat(seat)];
    if (state.players[seat].prizes.length === 0) {
      reasons[seat] = "prizesTaken";
    } else if (opponent.active === null && opponent.bench.length === 0) {
      reasons[seat] = "noPokemon";
    }
  }
  const p1 = reasons.p1;
  const p2 = reasons.p2;
  if (p1 !== undefined && p2 !== undefined) return { result: "tie", reasons: { p1, p2 } };
  if (p1 !== undefined) return { result: "win", winner: "p1", reason: p1 };
  if (p2 !== undefined) return { result: "win", winner: "p2", reason: p2 };
  return null;
}

/**
 * Concede: the opponent wins by `conceded`. Legal in every phase except `gameOver`, so a player can
 * concede mid-turn or during a park nobody can answer; `finishGame` clears `pending`.
 */
export function concede(state: GameState, action: ConcedeAction): ApplyResult {
  if (state.phase.kind === "gameOver") {
    return err("GAME_OVER", "the game is already over");
  }
  return finishGame(
    state,
    { result: "win", winner: otherSeat(action.seat), reason: "conceded" },
    [],
  );
}

/** The one GAME_OVER emitter: parks the phase, clears whatever tail was
    still pending (a finished game resumes nothing) and hands consumers
    their own copy of the outcome — an event must never alias the state's
    objects (events.ts). */
export function finishGame(
  state: GameState,
  outcome: GameOutcome,
  events: GameEvent[],
): ApplyResult {
  events.push({ type: "GAME_OVER", outcome: copyOutcome(outcome) });
  return ok({ ...state, pending: [], phase: { kind: "gameOver", outcome } }, events);
}

function copyOutcome(outcome: GameOutcome): GameOutcome {
  return outcome.result === "win"
    ? { ...outcome }
    : { result: "tie", reasons: { ...outcome.reasons } };
}

/**
 * The end-of-turn tail every way of ending `seat`'s turn seeds (§5.3): TURN_ENDED, the checkup
 * (keyed on the ended seat), the opponent's turn start. A first attack under Festival Lead with
 * Festival Grounds in play defers this tail until the turn really ends.
 */
export function turnTail(seat: Seat): PendingStage[] {
  return [
    { kind: "endTurn", seat },
    { kind: "checkup", seat },
    { kind: "startTurn", seat: otherSeat(seat) },
  ];
}

/** Drop the head stage — used by the resolve helpers below, which serve both
    the ko:* action handlers (attack.ts) and `advance`'s auto-resolves. */
export function popStage(state: GameState): GameState {
  return { ...state, pending: state.pending.slice(1) };
}

/**
 * Move the picked prizes into `seat`'s hand (§8.1). Indices are validated by the caller. A picked
 * slot may be face up; its uid is removed from `faceUpPrizes` in the same write.
 */
function resolveTakePrizes(
  state: GameState,
  seat: Seat,
  indices: readonly number[],
  events: GameEvent[],
): GameState {
  const side = state.players[seat];
  const uids: string[] = [];
  for (const index of indices) {
    const uid = side.prizes[index];
    if (uid !== undefined) uids.push(uid);
  }
  const picked = new Set(indices);
  const prizes = side.prizes.filter((_, index) => !picked.has(index));
  // Keep `faceUpPrizes` a subset of `prizes`; keyed by uid because the indices are about to go
  // stale.
  const faceUpPrizes = side.faceUpPrizes.filter((uid) => !uids.includes(uid));
  // Both arrays copied: `indices` may be the caller's own action array, and
  // `uids` also lands in the hand below.
  events.push({
    type: "PRIZES_TAKEN",
    seat,
    uids: [...uids],
    indices: [...indices],
    remaining: prizes.length,
  });
  // Record the take for its turn (Okidogi "Settle the Score"). Only takes on the taker's own turn
  // are recorded, since an off-turn take would overwrite the record about to be read. Turn
  // ownership comes from turn-number parity; at the Checkup `state.turn` is still the ended turn.
  const ownTurn = (state.turn % 2 === 1) === (seat === state.firstPlayer);
  const recorded = side.prizesTakenOnTurn;
  const prizesTakenOnTurn =
    uids.length === 0 || !ownTurn
      ? recorded
      : {
          turn: state.turn,
          count:
            recorded !== null && recorded.turn === state.turn
              ? recorded.count + uids.length
              : uids.length,
        };
  return withSide(state, seat, {
    ...side,
    prizes,
    faceUpPrizes,
    prizesTakenOnTurn,
    hand: [...side.hand, ...uids],
  });
}

/** Promote bench[index] into the empty Active spot (§8.1). The bench stays
    dense by closing up the vacated slot. */
function resolvePromotion(
  state: GameState,
  seat: Seat,
  index: number,
  events: GameEvent[],
): GameState {
  const side = state.players[seat];
  const promoted = side.bench[index];
  const uid = promoted === undefined ? undefined : topUid(promoted);
  // An empty bench (the §14.2 board) promotes nothing — the identity here;
  // resolvePromotionAndResume's win check is what ends the game. Stacks are
  // never empty (§1.2).
  if (promoted === undefined || uid === undefined) return state;
  events.push({ type: "POKEMON_PROMOTED", seat, uid, benchIndex: index });
  return withSide(state, seat, {
    ...side,
    // The involuntary half of bench→Active (types.ts `promotedTurn`). This
    // almost always runs during the OPPONENT's turn, and the stamp is what
    // makes that harmless: `state.turn` is THEIR turn number, so a Pokémon
    // that replaced a Knocked Out Active reads "did not move this turn" the
    // moment its own controller's turn begins.
    active: { ...promoted, promotedTurn: state.turn },
    bench: [...side.bench.slice(0, index), ...side.bench.slice(index + 1)],
  });
}

// The two KO decisions resolve through ONE path each, shared by the action
// handlers (attack.ts) and `advance`'s forced auto-resolves, so the
// resolve → pop → win-check → resume sequence cannot drift between them.
// The §14 evaluation sits at this one defined point: taking the last prize
// ends the game before any promotion is prompted (§14.1), and the promote
// path is covered too (unobservable until M3 — M2 promotions cannot create
// wins, except the empty-bench §14.2 loss resolved right here).

/** Move the picked prizes to hand, pop the stage, win-check, resume (§8.1). */
export function resolvePrizesAndResume(
  state: GameState,
  seat: Seat,
  indices: readonly number[],
  events: GameEvent[],
): ApplyResult {
  const next = popStage(resolveTakePrizes(state, seat, indices, events));
  const outcome = evaluateWin(next);
  if (outcome !== null) return finishGame(next, outcome, events);
  return advance(next, events);
}

/** Promote bench[index], pop the stage, win-check, resume (§8.1). */
export function resolvePromotionAndResume(
  state: GameState,
  seat: Seat,
  index: number,
  events: GameEvent[],
): ApplyResult {
  const next = popStage(resolvePromotion(state, seat, index, events));
  const outcome = evaluateWin(next);
  if (outcome !== null) return finishGame(next, outcome, events);
  return advance(next, events);
}

/**
 * Ignition Energy: discard every attached Energy with `discardAtEndOfYourTurn` from `seat`'s
 * Pokémon, one `ENERGY_DISCARDED` per body. Called with the turn owner only. Returns `state` itself
 * when nothing moves.
 */
function discardEndOfTurnEnergy(state: GameState, seat: Seat, events: GameEvent[]): GameState {
  const side = state.players[seat];
  const discarded: string[] = [];
  const strip = (pokemon: InPlayPokemon, from: PokemonTarget): InPlayPokemon => {
    const taken = pokemon.energy.filter(
      (uid) => programFor(cardOfUid(state, uid)?.id ?? "")?.energy?.discardAtEndOfYourTurn === true,
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
  if (discarded.length === 0) return state;
  return withSide(state, seat, {
    ...side,
    active,
    bench,
    discard: [...side.discard, ...discarded],
  });
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
 * §7.4 Technical Machine: discard every attached Tool with `toolDiscardAtEndOfYourTurn` on the turn
 * owner's Pokémon. Reads the tool list directly rather than `toolsInEffect`, since Jamming Tower
 * silences effects, not this rule. Returns `state` itself when nothing moves.
 */
function discardEndOfTurnTools(state: GameState, seat: Seat, events: GameEvent[]): GameState {
  const side = state.players[seat];
  const discarded: string[] = [];
  const strip = (pokemon: InPlayPokemon): InPlayPokemon => {
    const taken = pokemon.tools.filter(
      (uid) => programFor(cardOfUid(state, uid)?.id ?? "")?.toolDiscardAtEndOfYourTurn === true,
    );
    if (taken.length === 0) return pokemon;
    discarded.push(...taken);
    events.push({
      type: "TOOLS_DISCARDED",
      seat,
      actor: seat,
      uids: taken,
      host: topUid(pokemon) ?? "",
      when: "consumed",
    });
    return { ...pokemon, tools: pokemon.tools.filter((uid) => !taken.includes(uid)) };
  };
  const active = side.active === null ? null : strip(side.active);
  const bench = side.bench.map(strip);
  if (discarded.length === 0) return state;
  return withSide(state, seat, {
    ...side,
    active,
    bench,
    discard: [...side.discard, ...discarded],
  });
}

/** Drain GameState.pending stage by stage. Automatic stages (TURN_ENDED,
    checkup, the next startTurn) just run; decision stages either PARK — set
    the matching ko:* interrupt phase, announce it with a prompt event so an
    event-only client is never left hanging, and return with the stage still
    at the head — or auto-resolve when exactly one legal resolution exists
    (the M1 doctrine: a choice with no choice in it is not a choice). The
    recursion is bounded by the queue length (a handful of stages). */
export function advance(stateIn: GameState, events: GameEvent[]): ApplyResult {
  // Team Rocket's Energy state check.
  const state = discardMisplacedEnergy(stateIn, events);
  // §7.4 Multi Adapter state check: a seat with a body over `toolCapOf` trims first, ahead of the
  // queue. Only a non-empty queue is checked here; `applyAction` covers the empty case.
  const head = state.pending[0];
  const toolTrims = head === undefined ? [] : toolTrimStages(state, head.seat, state.pending);
  if (toolTrims.length > 0)
    return advance({ ...state, pending: [...toolTrims, ...state.pending] }, events);
  const stage = state.pending[0];
  if (stage === undefined) return ok(state, events);
  switch (stage.kind) {
    case "takePrizes": {
      const side = state.players[stage.seat];
      const count = Math.min(stage.count, side.prizes.length);
      // Nothing left to take — only reachable if a future effect empties the
      // row mid-KO; the game would already be over otherwise.
      if (count === 0) return advance(popStage(state), events);
      if (count < side.prizes.length) {
        const next: GameState = {
          ...state,
          phase: { kind: "ko:takePrizes", seat: stage.seat, count },
        };
        events.push({ type: "PRIZES_OWED", seat: stage.seat, count });
        return ok(next, events);
      }
      // Taking the LAST prize(s) is forced — auto-resolve; the row is now
      // empty, so the shared win check always ends the game (§14.1, or a
      // tie via §14).
      return resolvePrizesAndResume(
        state,
        stage.seat,
        side.prizes.map((_, index) => index),
        events,
      );
    }
    case "shuffleHandIntoDeck": {
      // Celebration: "If you do, shuffle your hand into your deck." Runs after its Prize stage.
      // Never parks.
      const side = state.players[stage.seat];
      const [deck, rngState] = shuffle([...side.deck, ...side.hand], state.rngState);
      events.push({ type: "HAND_SHUFFLED_INTO_DECK", seat: stage.seat, count: side.hand.length });
      return advance(
        popStage({ ...withSide(state, stage.seat, { ...side, hand: [], deck }), rngState }),
        events,
      );
    }
    case "promote": {
      const side = state.players[stage.seat];
      // Already occupied (a future effect re-filled the spot) — nothing owed.
      // The promote action handler mirrors this guard (attack.ts).
      if (side.active !== null) return advance(popStage(state), events);
      if (side.bench.length <= 1) {
        // A lone benched Pokémon is a forced promotion (M1 doctrine: a
        // choice with no choice in it is not a choice) and an EMPTY bench is
        // the §14.2 loss — both auto-resolve through the shared helper:
        // promoting from an empty bench is the identity, and the win check
        // sees the whole empty board, so a simultaneous condition
        // (unreachable in M2: attacks never KO the attacker's own side)
        // resolves to a tie per §14 rather than a hardcoded winner.
        return resolvePromotionAndResume(state, stage.seat, 0, events);
      }
      const next: GameState = { ...state, phase: { kind: "ko:promote", seat: stage.seat } };
      events.push({ type: "PROMOTION_REQUIRED", seat: stage.seat });
      return ok(next, events);
    }
    case "endTurn": {
      // Powerglass can park, so queue one trigger per live end-of-turn Tool on the Active ahead of
      // a copy of this stage marked `toolsDone`.
      if (stage.toolsDone !== true) {
        const powerglass = endTurnToolTriggersOf(state, stage.seat);
        if (powerglass.length > 0) {
          return advance(
            {
              ...state,
              pending: [
                ...powerglass.map(
                  ({ toolUid }): PendingStage => ({
                    kind: "endTurnToolTrigger",
                    seat: stage.seat,
                    toolUid,
                  }),
                ),
                { ...stage, toolsDone: true },
                ...state.pending.slice(1),
              ],
            },
            events,
          );
        }
      }
      // Amarys: "At the end of this turn, if you have 5 or more cards in your hand, discard your
      // hand." Paid before `TURN_ENDED` and before `startTurn` resets allowances. On an
      // attack-ended turn this runs after the prize stages, so prizes count toward the threshold.
      const threshold = state.allowances.endOfTurnHandDiscard;
      const ended =
        threshold !== null && state.players[stage.seat].hand.length >= threshold
          ? discardHand(state, { seat: stage.seat }, events)
          : state;
      // Ignition Energy: "discard it at the end of your turn", turn owner only. Never parks.
      const ignited = discardEndOfTurnEnergy(ended, stage.seat, events);
      // Technical Machine end-of-turn discard, turn owner only.
      const toolsShed = discardEndOfTurnTools(ignited, stage.seat, events);
      events.push({ type: "TURN_ENDED", turn: state.turn, seat: stage.seat });
      return advance(popStage(toolsShed), events);
    }
    case "checkup":
      // runCheckup pops the stage itself: its KO stage-pairs go in front of
      // the remainder, and a double-KO tie ends the game outright.
      return runCheckup(state, stage.seat, events);
    case "resumeTurn": {
      // A mid-turn KO has resolved: hand the turn back to the actor. Always the last stage.
      // Festival Lead's attack-again offer is announced here, when the actor regains control, and
      // only while a second attack is not barred.
      const offerActive = state.players[stage.seat].active;
      if (
        state.allowances.attackAgainUid !== null &&
        offerActive !== null &&
        !attackAgainBarred(state, stage.seat, offerActive)
      ) {
        events.push({
          type: "ATTACK_AGAIN_OFFERED",
          seat: stage.seat,
          uid: state.allowances.attackAgainUid,
        });
      }
      return ok({ ...popStage(state), phase: { kind: "turn:action", seat: stage.seat } }, events);
    }
    case "koTrigger":
      // §9 The Knocked Out Pokémon's on-KO Ability, or an attached Amulet of Hope. Pop first so the
      // stages behind resume if the program parks.
      return runKoTrigger(popStage(state), stage.seat, stage.uid, events, stage.toolUid);
    case "endTurnToolTrigger":
      // Powerglass. Pop first so the re-queued `endTurn` drains after it.
      return runEndTurnToolTrigger(popStage(state), stage.seat, stage.toolUid, events);
    case "damagedTrigger":
      // §9 The damaged Active's reactive Ability. Pop first so the `attackEpilogue` behind it
      // resumes if the program parks.
      return runDamagedTrigger(popStage(state), stage.seat, stage.uid, events);
    case "koToolTrigger":
      // §8.1 A Tool on the defender reacting to its Active's imminent Knock Out (Exp. Share). Pop
      // first; the `attackEpilogue` behind it performs the Knock Out.
      return runKoToolTrigger(popStage(state), stage.seat, events);
    case "attackEpilogue":
      // §8 step 4 has finished: sweep both boards and end the attacker's turn. The pop is required,
      // or the epilogue would run twice. `stage.uid` is the attacker as declared, since the program
      // may have moved it. Boomerang Energy returns before the sweep.
      return finishAttack(
        returnBoomerangs(popStage(state), stage, events),
        events,
        stage.seat,
        stage.uid,
        stage.attack,
      );
    case "benchTrim":
      return runBenchTrim(popStage(state), stage.seat, events);
    case "toolTrim":
      return runToolTrim(popStage(state), stage.seat, events);
    case "startTurn":
      return startTurn(popStage(state), stage.seat, events);
  }
}
