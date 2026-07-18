import type { ApplyResult } from "./actions";
import { ok } from "./actions";
import { activeTop, prizeValueOf, topCardOf, topUid } from "./cards";
import { effectiveMaxHp } from "./continuous";
import type { GameEvent } from "./events";
import { flipCoin } from "./rng";
import type {
  GameOutcome,
  GameOverReason,
  GameState,
  InPlayPokemon,
  PendingStage,
  Seat,
} from "./types";
import {
  SEATS,
  discardFromStack,
  drawToHand,
  freshAllowances,
  otherSeat,
  withActive,
  withSide,
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

/** The one "damage ≥ max HP" Knock Out test (§8.1/§13), reading the
    CONTINUOUS max HP (printed + Tool bonuses — Bravery Charm) and owning the
    null-hp rule: a missing/non-positive printed hp is a catalog data gap, and
    a data gap never KOs (cards.ts hpOf via continuous.ts effectiveMaxHp). */
export function isLethallyDamaged(state: GameState, pokemon: InPlayPokemon): boolean {
  const hp = effectiveMaxHp(state, pokemon);
  return hp !== null && pokemon.damage >= hp;
}

/** §8.1 KO cleanup, generalized off the Active (M4): Knock Out the in-play
    Pokémon whose stack-top is `koedUid` on `koedSeat`'s board — Active OR a
    benched one. Its whole stack (evolution cards, energy, tools) leaves play
    for `koedSeat`'s discard, KNOCKED_OUT fires, and the decision stages come
    back for the caller to queue: the prize pick for `prizeSeat` (§8.1 — the
    KO'd side's opponent), plus — for an ACTIVE KO only — the promotion that
    refills the empty spot. A benched KO leaves no gap (the bench compacts),
    so it owes no promotion. Addresses the Pokémon by uid, not index, so a
    batch of KOs cannot shift a later target's bench slot out from under it. */
export function knockOut(
  state: GameState,
  koedSeat: Seat,
  koedUid: string,
  prizeSeat: Seat,
  events: GameEvent[],
): { state: GameState; stages: PendingStage[] } {
  const side = state.players[koedSeat];
  // The Active?
  if (side.active !== null && topUid(side.active) === koedUid) {
    const card = topCardOf(state, side.active);
    const cleanup = discardFromStack(side, side.active, "all");
    events.push({ type: "KNOCKED_OUT", seat: koedSeat, uid: koedUid, discarded: cleanup.discarded });
    return {
      state: withSide(state, koedSeat, { ...cleanup.side, active: null }),
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
    const cleanup = discardFromStack(side, benched, "all");
    const bench = [...side.bench.slice(0, index), ...side.bench.slice(index + 1)];
    events.push({ type: "KNOCKED_OUT", seat: koedSeat, uid: koedUid, discarded: cleanup.discarded });
    return {
      state: withSide(state, koedSeat, { ...cleanup.side, bench }),
      stages: [{ kind: "takePrizes", seat: prizeSeat, count: card === undefined ? 1 : prizeValueOf(card) }],
    };
  }
  // Not in play — unreachable (every caller just scanned it lethal). No-op.
  return { state, stages: [] };
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

/** The post-damage Knock Out sweep (§8.1), generalized off the Active (M4):
    resolve EVERY lethally-damaged in-play Pokémon on `seats` at once — Active
    and Bench — prizes to each KO'd side's opponent. The decision stages come
    back grouped PRIZES-FIRST (all prizes are taken before any promotion
    refills the board, §8.1/§13). When the batch would win for BOTH players at
    the same instant it is the §14 TIE, detected by SPECULATIVELY resolving the
    whole batch (KOs plus their owed prizes) into a throwaway state and asking
    evaluateWin — so the §14 precedence core stays single-sourced. A tie can
    only arise when both seats lost a Pokémon this batch (a one-sided batch
    only ever wins for the one player who gains the prizes / faces the emptied
    board), so the guard runs only then; every other case falls through to the
    stage-by-stage resolution, whose defined §14 checks own it. `done` non-null
    is that terminal tie; otherwise `stages` are the decisions to queue and
    `state` is post-KO. Shared by the attack epilogue, the Checkup and the
    mid-turn KO path. */
export type KnockOutBatch =
  | { done: GameOutcome; state: GameState }
  | { done: null; state: GameState; stages: PendingStage[] };

export function collectKnockOuts(
  state: GameState,
  seats: readonly Seat[],
  events: GameEvent[],
): KnockOutBatch {
  const refs = lethalRefs(state, seats);
  if (refs.length === 0) return { done: null, state, stages: [] };

  const bothSeatsHit = new Set(refs.map((ref) => ref.seat)).size === 2;
  if (bothSeatsHit) {
    let speculative = state;
    const scratch: GameEvent[] = []; // speculative events go nowhere
    for (const ref of refs) {
      const ko = knockOut(speculative, ref.seat, ref.uid, otherSeat(ref.seat), scratch);
      speculative = ko.state;
      for (const stage of ko.stages) {
        if (stage.kind !== "takePrizes") continue;
        // Deduct the owed prizes (which slots is immaterial to §14).
        const side = speculative.players[stage.seat];
        speculative = withSide(speculative, stage.seat, {
          ...side,
          prizes: side.prizes.slice(stage.count),
        });
      }
    }
    const outcome = evaluateWin(speculative);
    if (outcome !== null && outcome.result === "tie") {
      // Both KOs still happen FOR REAL (the cards leave play, the events
      // fire) — only the prize/promotion stages are skipped for the tie.
      let next = state;
      for (const ref of refs) {
        next = knockOut(next, ref.seat, ref.uid, otherSeat(ref.seat), events).state;
      }
      return { done: outcome, state: next };
    }
    // A one-sided (or no) win: discard the speculation and fall through.
  }

  // Apply each KO for real, grouping the stages PRIZES-FIRST (§8.1/§13) while
  // preserving the ref order within each kind.
  let next = state;
  const prizeStages: PendingStage[] = [];
  const promoteStages: PendingStage[] = [];
  for (const ref of refs) {
    const ko = knockOut(next, ref.seat, ref.uid, otherSeat(ref.seat), events);
    next = ko.state;
    for (const stage of ko.stages) {
      (stage.kind === "takePrizes" ? prizeStages : promoteStages).push(stage);
    }
  }
  return { done: null, state: next, stages: [...prizeStages, ...promoteStages] };
}

/** A Knock Out that happens DURING `actorSeat`'s turn and does NOT end it —
    an evolve that drops a charmed Basic below its new stage's HP (§8.1, a
    Bravery Charm's Basic-only bonus falling off), or a future spread/snipe
    ability. Resolve every KO on `seats`, then RESUME the actor's turn: unlike
    an attack KO (ends the turn) or a Checkup KO (between turns), the actor
    keeps playing once the KO's prize/promotion decisions settle. Allowances
    live on GameState, so they survive the interrupt untouched. A KO that hands
    the actor's last Pokémon to the opponent — or that takes the opponent's
    last prize — still ends the game at the resolve helpers' §14 check.
    `seats` MUST be the set of boards the effect actually damaged: evolve passes
    `[actorSeat]` (only the actor's own Pokémon can go lethal on evolution); a
    future snipe ability damaging the opponent must pass THAT board (or both) so
    the sweep — and the §14 double-KO tie guard — sees every KO. */
export function resolveMidTurnKnockOuts(
  state: GameState,
  actorSeat: Seat,
  seats: readonly Seat[],
  events: GameEvent[],
): ApplyResult {
  const batch = collectKnockOuts(state, seats, events);
  if (batch.done !== null) return finishGame(batch.state, batch.done, events);
  if (batch.stages.length === 0) return ok(batch.state, events); // nothing KO'd
  return advance(
    { ...batch.state, pending: [...batch.stages, { kind: "resumeTurn", seat: actorSeat }] },
    events,
  );
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

  // §13.1 Poison — the condition's own counter amount (10 unless raised).
  for (const seat of order) {
    const spot = activeTop(next, seat);
    if (spot === null || spot.active.conditions.poisonDamage <= 0) continue;
    const { active, uid } = spot;
    const amount = active.conditions.poisonDamage;
    next = withActive(next, seat, { ...active, damage: active.damage + amount });
    events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: "poison" });
  }

  // §13.2 Burn — 20 damage, then the cure flip (heads removes it).
  for (const seat of order) {
    const spot = activeTop(next, seat);
    if (spot === null || !spot.active.conditions.burned) continue;
    const { active, uid } = spot;
    let updated = { ...active, damage: active.damage + 20 };
    events.push({ type: "COUNTERS_PLACED", seat, uid, amount: 20, source: "burn" });
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

  // §13.4 Paralysis — recovers ONLY for the player whose turn just ended
  // (the §12 timing note: paralysis lasts through the paralyzed player's
  // whole next turn, then clears at the checkup after it). No flip. The
  // official rule makes this clear CONDITIONAL — only if the Pokémon was
  // Paralyzed since the beginning of the ended turn. Every opponent-
  // inflicted paralysis satisfies that; the one case that would not
  // (self-paralysis applied by the ended seat's own attack) is unreachable
  // because the effect deriver refuses self-Paralyzed text (effects.ts
  // SELF_STATUS_WORDS) — an applied-turn stamp is the future work.
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

  // The batch is done — NOW resolve its Knock Outs (§13) through the shared
  // sweep, in [endedSeat, other] order. Checkup damage only ever lands on the
  // Actives (poison/burn), but the sweep scans full boards: a benched Pokémon
  // is never lethal here (mid-turn KOs are resolved the instant they occur),
  // so scanning it is a harmless superset that also keeps the §14 double-KO
  // tie guard single-sourced with the attack and mid-turn paths.
  const batch = collectKnockOuts(next, order, events);
  if (batch.done !== null) return finishGame(batch.state, batch.done, events);
  // Pop the checkup stage, put the KO stages in front of what remains
  // (the startTurn) and keep draining — a decision stage parks as usual.
  return advance(
    { ...batch.state, pending: [...batch.stages, ...batch.state.pending.slice(1)] },
    events,
  );
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

/** The staged end-of-turn tail every way of ending `seat`'s turn seeds
    (§5.3): TURN_ENDED, the between-turns checkup (which carries the ended
    seat — §13.4 paralysis recovery keys on it), the opponent's turn start.
    attack.ts puts its KO stages in FRONT of this tail. */
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

/** Move the picked face-down prizes into `seat`'s hand (§8.1). Indices are
    validated by the action handler (attack.ts) or generated by the forced
    auto-resolve in `advance` — never trusted raw. */
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
  // Both arrays copied: `indices` may be the caller's own action array, and
  // `uids` also lands in the hand below.
  events.push({
    type: "PRIZES_TAKEN",
    seat,
    uids: [...uids],
    indices: [...indices],
    remaining: prizes.length,
  });
  return withSide(state, seat, { ...side, prizes, hand: [...side.hand, ...uids] });
}

/** Promote bench[index] into the empty Active spot (§8.1). The bench stays
    dense — the same compaction rule retreat uses (events.ts RETREATED). */
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
    active: promoted,
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

/** Drain GameState.pending stage by stage. Automatic stages (TURN_ENDED,
    checkup, the next startTurn) just run; decision stages either PARK — set
    the matching ko:* interrupt phase, announce it with a prompt event so an
    event-only client is never left hanging, and return with the stage still
    at the head — or auto-resolve when exactly one legal resolution exists
    (the M1 doctrine: a choice with no choice in it is not a choice). The
    recursion is bounded by the queue length (a handful of stages). */
export function advance(state: GameState, events: GameEvent[]): ApplyResult {
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
    case "endTurn":
      events.push({ type: "TURN_ENDED", turn: state.turn, seat: stage.seat });
      return advance(popStage(state), events);
    case "checkup":
      // runCheckup pops the stage itself: its KO stage-pairs go in front of
      // the remainder, and a double-KO tie ends the game outright.
      return runCheckup(state, stage.seat, events);
    case "resumeTurn":
      // A mid-turn KO (evolve-below-HP, a snipe ability) has resolved: hand the
      // turn BACK to the actor rather than ending it. Allowances live on
      // GameState, untouched by the KO flow, so the actor resumes exactly where
      // they were. Always the last stage, so popping leaves an empty queue.
      return ok(
        { ...popStage(state), phase: { kind: "turn:action", seat: stage.seat } },
        events,
      );
    case "startTurn":
      return startTurn(popStage(state), stage.seat, events);
  }
}
