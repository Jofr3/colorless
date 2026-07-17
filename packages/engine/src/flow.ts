import type { ApplyResult } from "./actions";
import { ok } from "./actions";
import { activeTop, hpOf, prizeValueOf, topCardOf, topUid } from "./cards";
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

/** The one "damage ≥ max HP" Knock Out test (§8.1/§13), owning the null-hp
    rule: a missing/non-positive printed hp is a catalog data gap, and a data
    gap never KOs (cards.ts hpOf). */
export function isLethallyDamaged(state: GameState, pokemon: InPlayPokemon): boolean {
  const card = topCardOf(state, pokemon);
  const hp = card === undefined ? null : hpOf(card);
  return hp !== null && pokemon.damage >= hp;
}

/** §8.1 KO cleanup, shared by the attack path and the Checkup: `koedSeat`'s
    Active leaves play (its whole stack to the discard), KNOCKED_OUT fires,
    and the resulting decision stages come back for the caller to queue —
    the prize pick for `prizeSeat` (the attacker; on a Checkup or self-KO,
    the opponent — no one attacked), then the promotion. Active-only for
    M3; M4's bench snipes generalize the target. */
export function knockOut(
  state: GameState,
  koedSeat: Seat,
  prizeSeat: Seat,
  events: GameEvent[],
): { state: GameState; stages: PendingStage[] } {
  const spot = activeTop(state, koedSeat);
  if (spot === null) {
    // Unreachable — every caller just verified a lethally damaged Active.
    return { state, stages: [] };
  }
  const { active, uid, card } = spot;
  const cleanup = discardFromStack(state.players[koedSeat], active, "all");
  events.push({ type: "KNOCKED_OUT", seat: koedSeat, uid, discarded: cleanup.discarded });
  return {
    state: withSide(state, koedSeat, { ...cleanup.side, active: null }),
    stages: [
      { kind: "takePrizes", seat: prizeSeat, count: prizeValueOf(card) },
      { kind: "promote", seat: koedSeat },
    ],
  };
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

  // The batch is done — NOW resolve its Knock Outs (§13), in the same seat
  // order. hpOf's null (a catalog data gap) never KOs, as everywhere.
  const koedSeats = order.filter((seat) => {
    const active = next.players[seat].active;
    return active !== null && isLethallyDamaged(next, active);
  });

  // Simultaneous-win guard: with BOTH Actives going down at once, the
  // stage-by-stage resolution below would crown whoever's prize pick happens
  // to resolve first — so when both players would win off this batch (the
  // owed prizes empty their row, or the opponent's board empties), the game
  // is the §14 TIE, decided here as one instant. Detected by SPECULATIVELY
  // resolving the whole batch — both KOs plus their owed prize takes — into
  // a throwaway state and asking evaluateWin, so the §14 precedence core is
  // single-sourced rather than re-derived here. A single (or one-sided) KO
  // keeps the normal path: the resolve helpers' §14 check owns it.
  if (koedSeats.length === 2) {
    let speculative = next;
    const scratch: GameEvent[] = []; // speculative events go nowhere
    for (const seat of koedSeats) {
      const ko = knockOut(speculative, seat, otherSeat(seat), scratch);
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
      for (const seat of koedSeats) {
        next = knockOut(next, seat, otherSeat(seat), events).state;
      }
      return finishGame(next, outcome, events);
    }
    // A one-sided (or no) win: discard the speculation — the stage-by-stage
    // resolution below reaches the same §14 verdict at its defined points.
  }

  // Group the KO stages PRIZES-FIRST (§8.1/§13: all prizes are taken before
  // promotions refill the board), preserving the [endedSeat, other] KO order
  // within each kind — a double KO seeds
  // [takePrizes, takePrizes, promote, promote], not interleaved pairs.
  const prizeStages: PendingStage[] = [];
  const promoteStages: PendingStage[] = [];
  for (const seat of koedSeats) {
    const ko = knockOut(next, seat, otherSeat(seat), events);
    next = ko.state;
    for (const stage of ko.stages) {
      (stage.kind === "takePrizes" ? prizeStages : promoteStages).push(stage);
    }
  }
  // Pop the checkup stage, put the KO stages in front of what remains
  // (the startTurn) and keep draining — a decision stage parks as usual.
  return advance(
    { ...next, pending: [...prizeStages, ...promoteStages, ...next.pending.slice(1)] },
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
    case "startTurn":
      return startTurn(popStage(state), stage.seat, events);
  }
}
