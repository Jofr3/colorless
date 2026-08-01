import type { ApplyResult, ConcedeAction } from "./actions";
import { err, ok } from "./actions";
import { activeTop, cardOfUid, prizeValueOf, topCardOf, topUid } from "./cards";
import { effectiveMaxHp } from "./continuous";
import type { GameEvent } from "./events";
import type { RunResult } from "./interpreter";
import { runProgram } from "./interpreter";
import { flipCoin } from "./rng";
import { damagedByAttackAbility, onKnockOutTrigger, runCheckupTriggers } from "./triggers";
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
    back grouped PRIZES-first, then any on-KO triggered Abilities (koTrigger),
    then PROMOTIONS (all prizes are taken before the board refills, §8.1/§13,
    and a "when Knocked Out" Ability resolves between). When the batch would win
    for BOTH players at the same instant it is the §14 TIE, detected by
    SPECULATIVELY resolving the whole batch (KOs plus their owed prizes) into a
    throwaway state and asking evaluateWin — so the §14 precedence core stays
    single-sourced. A tie can only arise when both seats lost a Pokémon this
    batch (a one-sided batch only ever wins for the one player who gains the
    prizes / faces the emptied board), so the guard runs only then; every other
    case falls through to the stage-by-stage resolution, whose defined §14 checks
    own it. `done` non-null is that terminal tie; otherwise `stages` are the
    decisions to queue and `state` is post-KO. Shared by the attack epilogue, the
    Checkup and the mid-turn KO path.

    §9 on-KO triggered Abilities (M4 slice 9) ride this sweep two ways: a
    coin-flip Prize GUARD (Glimmora "Shattering Crystal") is resolved UP FRONT by
    planPrizes — before the tie-guard speculation, so §14 sees the post-flip
    counts and the rng advances once — and a parking on-KO PROGRAM is queued as a
    koTrigger stage (advance runs it, resume-the-tail). Both are behaviour-neutral
    for every Pokémon with no on-KO Ability (planPrizes plans its face-value
    Prize with no flip and no koTrigger). */
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

  // Resolve each on-KO Prize guard (Glimmora) ONCE, up front: the flip's rng
  // advance and its post-flip Prize `count` are then shared by the tie-guard
  // speculation and the real KO alike (so §14 stays exact). The guard's own
  // events fire in the real KO loop, after that KO's KNOCKED_OUT.
  const plan = planPrizes(state, refs);
  const startState = plan.state;

  const bothSeatsHit = new Set(refs.map((ref) => ref.seat)).size === 2;
  if (bothSeatsHit) {
    let speculative = startState;
    const scratch: GameEvent[] = []; // speculative events go nowhere
    for (const entry of plan.entries) {
      speculative = knockOut(
        speculative,
        entry.ref.seat,
        entry.ref.uid,
        otherSeat(entry.ref.seat),
        scratch,
      ).state;
      // Deduct the (post-guard) prize this KO grants (which slots is immaterial
      // to §14; a guard-denied KO grants 0).
      const prizeSeat = otherSeat(entry.ref.seat);
      const side = speculative.players[prizeSeat];
      speculative = withSide(speculative, prizeSeat, { ...side, prizes: side.prizes.slice(entry.count) });
    }
    const outcome = evaluateWin(speculative);
    if (outcome !== null && outcome.result === "tie") {
      // Both KOs still happen FOR REAL (the cards leave play, the events fire —
      // each guard's included) — only the prize/promotion stages are skipped.
      let next = startState;
      for (const entry of plan.entries) {
        next = knockOut(next, entry.ref.seat, entry.ref.uid, otherSeat(entry.ref.seat), events).state;
        for (const guardEvent of entry.guardEvents) events.push(guardEvent);
      }
      return { done: outcome, state: next };
    }
    // A one-sided (or no) win: discard the speculation and fall through.
  }

  // Apply each KO for real, grouping the stages PRIZES-first, then on-KO
  // triggers, then PROMOTIONS (§8.1/§13), preserving ref order within each
  // kind. A guard-denied KO queues no prize; an on-KO PROGRAM queues a koTrigger.
  let next = startState;
  const prizeStages: PendingStage[] = [];
  const koTriggerStages: PendingStage[] = [];
  const promoteStages: PendingStage[] = [];
  for (const entry of plan.entries) {
    const ko = knockOut(next, entry.ref.seat, entry.ref.uid, otherSeat(entry.ref.seat), events);
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
  }
  return { done: null, state: next, stages: [...prizeStages, ...koTriggerStages, ...promoteStages] };
}

/** The per-KO Prize plan for a batch (§9 on-KO Abilities). Resolve each on-KO
    Prize GUARD (Glimmora's coin flip) ONCE, up front, threading rng, so the §14
    tie guard and the real KO agree on the counts and the flip happens a single
    time. Per ref it records: the post-guard prize `count`, the guard's
    `guardEvents` to emit in the real KO loop (right after that KO's
    KNOCKED_OUT), and whether the card carries a parking on-KO `program` (→ a
    koTrigger stage). A ref whose card has no on-KO Ability plans its face-value
    prize with no flip and no events — behaviour-identical to the pre-slice-9
    sweep, so the whole existing suite is unperturbed. */
interface KoPrizePlan {
  ref: { seat: Seat; uid: string };
  count: number;
  guardEvents: GameEvent[];
  hasProgram: boolean;
}

function planPrizes(
  state: GameState,
  refs: readonly { seat: Seat; uid: string }[],
): { state: GameState; entries: KoPrizePlan[] } {
  let next = state;
  const entries: KoPrizePlan[] = [];
  for (const ref of refs) {
    const card = cardOfUid(next, ref.uid);
    const baseCount = card === undefined ? 1 : prizeValueOf(card);
    const ability = onKnockOutTrigger(next, ref.uid);
    const hasProgram = ability !== undefined && ability.program.length > 0;
    if (ability?.onKoPrizeGuard !== "coinFlipPrevent") {
      entries.push({ ref, count: baseCount, guardEvents: [], hasProgram });
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
      entries.push({ ref, count: 0, guardEvents, hasProgram });
    } else {
      entries.push({ ref, count: baseCount, guardEvents, hasProgram });
    }
  }
  return { state: next, entries };
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

/** The shared attack epilogue (§8.1 + §5.3) — every exit out of `attack`
    (attack.ts: the confusion-tails failure, an attack with no effect program,
    and the attackEpilogue stage a PARKED effect program resumes into): sweep
    BOTH boards for Knock Outs — the Active from the main damage AND any Benched
    Pokémon a spread/snipe effect damaged, plus the ATTACKER's own Active when a
    recoil clause ("This Pokémon also does N damage to itself", damageSelf) turned
    the attack on itself — prizes to each KO'd side's opponent, re-read off the
    state since the effect ops replace the Pokémon objects. Then end
    `attackerSeat`'s turn through the staged tail, the KO's decision stages in
    front of it.

    **The sweep is [defender, attacker] ORDER, and that order is §8.1.** When an
    attack KOs both the Defending Pokémon and the attacker itself at once, "the
    player whose turn it is takes their Prize card(s) first" — so the defender's
    board is swept first, queueing the attacker's prizes ahead of the defender's
    (collectKnockOuts groups every batch prizes-first in ref order, and lethalRefs
    walks `seats` in order). A self-KO prizes to the DEFENDER, exactly as the
    confusion self-hit's does. This widening (from the old single defender-seat
    sweep) is what makes the §14 DOUBLE-KO tie reachable from the attack path —
    both boards can now win at once — and collectKnockOuts' speculative tie guard
    owns it, the same guard the Checkup path already exercises. Sweeping the
    attacker's board on the no-recoil paths (confusion tails dealt the defender
    nothing; a plain attack never touched the attacker) is a harmless superset:
    only a fresh recoil can leave the attacker lethal here, since a mid-turn KO is
    resolved the instant it occurs.

    Lives in flow.ts rather than attack.ts because `advance` below must reach it:
    attack.ts already imports flow, so the epilogue stage's handler cannot sit on
    the other side of that edge. */
export function finishAttack(state: GameState, events: GameEvent[], attackerSeat: Seat): ApplyResult {
  const batch = collectKnockOuts(state, [otherSeat(attackerSeat), attackerSeat], events);
  if (batch.done !== null) return finishGame(batch.state, batch.done, events);
  // §5.3 — attacking ends the turn, through the same staged tail as a pass.
  // COMPOSES with whatever is still queued rather than overwriting it: both
  // callers hand over an empty queue (turn:action never carries a tail, and the
  // attackEpilogue case pops its own stage first), so this is behaviour-identical
  // — but it makes that pop LOAD-BEARING instead of merely tidy. Overwriting hid
  // a missing pop, which is exactly the kind of mistake the queue should surface.
  const pending: PendingStage[] = [
    ...batch.stages,
    ...turnTail(attackerSeat),
    ...batch.state.pending,
  ];
  return advance({ ...batch.state, pending }, events);
}

/** Fold a completed / parked effect program back into `controller`'s turn —
    the ONE place a Trainer, an Ability or a board trigger's program meets the
    KO/turn tail. Shared by cardplay.ts (playTrainer / useAbility /
    resolveEffect) and triggers.ts (runBoardTrigger); it unifies the two
    identical settle helpers that predated the first DAMAGING effect op.
    • PARKED — set the effect:choose interrupt and announce it (EFFECT_PENDING)
      so an event-only client never hangs on an unseen prompt.
    • DONE — return the controller to turn:action, but FIRST resolve any Knock
      Out the program's damage caused, as a MID-TURN KO: the snipe (Hawlucha /
      Meowscarada) can drop an opponent's Benched Pokémon, and the actor keeps
      their turn (resumeTurn) while the opponent's KO'd Pokémon prizes to them —
      a game-winning KO ends the game at the shared §14 check. The sweep scans
      BOTH boards (SEATS): a harmless superset (only the opponent's board can be
      freshly lethal from an in-scope effect — no program in scope damages the
      controller's own side), the same total scan runCheckup does. Every
      non-damaging program (draw / search / switch / heal) leaves nothing lethal,
      so routing them through here is behaviour-preserving — the KO sweep is a
      no-op that returns straight to turn:action.

    `opts.resumeTail` marks a program that is ALREADY mid-TAIL, with the stages
    that finish the job sitting in `pending` behind it. It parks/finishes the
    same way, except the DONE branch just keeps DRAINING that queue (advance)
    instead of folding back to a turn, and resolveEffect passes the flag back so
    a park RE-parks with it. Two callers:
    • an on-KO triggered Ability (runKoTrigger) — the sweep's prize/promotion
      stages are queued behind the koTrigger;
    • an ATTACK's effect program (attack.ts, §8 step 4) — the attackEpilogue
      stage is queued behind it, and draining it runs the KO sweep + turn end.
    Neither wants the mid-turn KO sweep below: the on-KO program does not damage,
    and an attack's KOs are the epilogue's own job — its sweep reads the
    POST-effect board and now covers BOTH seats, so a spread that KOs the defender
    AND a recoil that KOs the attacker (damageSelf) are both caught there. The flag
    is about WHERE control returns, not a second KO check.

    This is the flow↔triggers mutual import the header notes: the interpreter and
    triggers never KO, so completion is handed BACK to flow (the KO/tail owner)
    to resolve. Both directions are used only inside function bodies, so the
    cycle is evaluation-safe. */
export function settleProgram(
  result: RunResult,
  controller: Seat,
  events: GameEvent[],
  opts: { resumeTail?: boolean; endsTurn?: boolean } = {},
): ApplyResult {
  if (result.kind === "parked") {
    // EFFECT_PENDING's seat is the seat that MUST RESOLVE the decision (its own
    // doc) — the park's decider when one is named (opponentMayDraw: Ortega's
    // "your opponent may"), else the controller, which is who it always was.
    events.push({ type: "EFFECT_PENDING", seat: result.decider ?? controller, note: result.prompt.note });
    return ok(
      {
        ...result.state,
        phase: {
          kind: "effect:choose",
          seat: controller,
          prompt: result.prompt,
          cont: result.cont,
          // The seat that ANSWERS, only when it is not the controller (the
          // absent-when-empty rule, so every pre-D52 park is byte-identical).
          // `seat` above stays the CONTROLLER — every reader of it means the
          // program's owner, and the turn still belongs to them while the
          // opponent weighs their printed "may".
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
  if (opts.resumeTail === true) return advance(result.state, events);
  // An Ability that ends the turn (Koraidon "Dino Cry") seeds the turn tail
  // instead of returning to turn:action. Its program does not damage, so no
  // mid-turn KO sweep is owed — the tail's Checkup handles between-turns KOs.
  if (opts.endsTurn === true) {
    return advance({ ...result.state, pending: turnTail(controller) }, events);
  }
  const resumed: GameState = { ...result.state, phase: { kind: "turn:action", seat: controller } };
  return resolveMidTurnKnockOuts(resumed, controller, SEATS, events);
}

/** Run the on-KO triggered Ability of the just-Knocked-Out `uid` (owned by
    `koedSeat`) — a koTrigger stage the KO sweep queued (advance below). Fires
    during the OPPONENT's turn: the program runs through the shared interpreter
    and folds through settleProgram with `resumeTail`, so a decision PARKS on
    effect:choose (the KO'd player decides) and the sweep RESUMES the remaining
    prize/promotion tail via resolveEffect. The Pokémon left play, but its program
    targets `koedSeat`'s surviving Pokémon / its own deck (the KO'd player is the
    controller), and cardIdByUid → programFor still resolves the card. A stage
    with nothing to run (defensive — the guard-only Glimmora queues no koTrigger)
    just keeps draining. */
function runKoTrigger(
  state: GameState,
  koedSeat: Seat,
  uid: string,
  events: GameEvent[],
): ApplyResult {
  const ability = onKnockOutTrigger(state, uid);
  if (ability === undefined || ability.program.length === 0) return advance(state, events);
  events.push({ type: "ABILITY_TRIGGERED", seat: koedSeat, uid, ability: ability.name });
  // sourceUid names a card that has LEFT play — honest (the program is that
  // card's own printed sentence), and a source-reading op then finds no board
  // top for it and whiffs, which is what "this Pokémon" means after a KO.
  return settleProgram(
    runProgram(state, ability.program, { seat: koedSeat, sourceUid: uid }, events),
    koedSeat,
    events,
    { resumeTail: true },
  );
}

/** Run the `onDamagedByAttack` reactive Ability of the Active `uid` a main-hit
    attack just DAMAGED (§9 — Armarouge "Scorching Armor" Burns the attacker,
    Klawf ex "Counterattacking Pincer" discards its Energy) — a damagedTrigger
    stage attack.ts queued AFTER the attack's own effect program and BEFORE
    finishAttack's sweep. The twin of runKoTrigger: it fires during the ATTACKER's
    turn, so it runs under `damagedSeat` (the DAMAGED, non-turn player, the
    program's controller) and folds through settleProgram with `resumeTail`, so a
    PARKING discard PARKS on effect:choose (the DEFENDER decides which of the
    attacker's Energy) and draining RESUMES the attackEpilogue queued behind it —
    which then sweeps §8.1 (so "even if this Pokémon is Knocked Out" holds: the
    reaction lands before the sweep) and ends the attacker's turn. `damagedSeat`
    being the controller makes it the answerer by default (no `decider`), exactly
    as runKoTrigger routes a KO'd player's on-KO decision; the projection reads the
    real turn owner off the attackEpilogue in `pending` (koParkActiveSeat). A stage
    whose Ability no longer resolves — the effect program switched the defender out,
    or a lock came down — just keeps draining. */
function runDamagedTrigger(
  state: GameState,
  damagedSeat: Seat,
  uid: string,
  events: GameEvent[],
): ApplyResult {
  const ability = damagedByAttackAbility(state, damagedSeat, uid);
  if (ability === undefined || ability.program.length === 0) return advance(state, events);
  events.push({ type: "ABILITY_TRIGGERED", seat: damagedSeat, uid, ability: ability.name });
  return settleProgram(
    runProgram(state, ability.program, { seat: damagedSeat, sourceUid: uid }, events),
    damagedSeat,
    events,
    { resumeTail: true },
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

  // §11 — the retreat block ("During your opponent's next turn, the Defending
  // Pokémon can't retreat.") expires on exactly the paralysis clock above: it
  // is applied during the ATTACKER's turn, has to survive the Checkup that
  // follows it (endedSeat is then the attacker, not the locked player), holds
  // through the locked player's whole next turn, and lifts at the Checkup that
  // ends it. So the same `endedSeat`-only clear gives the printed duration —
  // and the same caveat applies: a block applied by the ended seat's OWN attack
  // would lift a turn early, which no print in the pool can do (the deriver's
  // only two shapes both target the DEFENDER).
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

  // The batch is done — NOW resolve its Knock Outs (§13) through the shared
  // sweep, in [endedSeat, other] order. Checkup damage lands on the Actives
  // (poison/burn, Trevenant's between-turns counter), but the sweep scans full
  // boards: a benched Pokémon is never lethal here (mid-turn KOs are resolved
  // the instant they occur), so scanning it is a harmless superset that also
  // keeps the §14 double-KO tie guard single-sourced with the attack and
  // mid-turn paths.
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

/** Give the game up (§ none — this is not a rules condition, it is a player's
    own choice, or the P4 server acting for one who abandoned an online match).
    The opponent wins by `conceded`.

    Legal in EVERY phase but `gameOver`, which is deliberate and is why it lives
    here beside `finishGame` rather than behind `turnGate` with the turn actions:
    a concede that only worked on your own turn would be useless in exactly the
    situations it exists for — an opponent who walked away mid-turn, or a park
    nobody can answer. `gameOver` is the one refusal, so a finished game can't be
    re-decided (and a second concede can't overwrite the first winner);
    `applyAction`'s global finished-game guard already returns first for anything
    arriving that way, so the check below is what keeps this handler total for a
    direct caller rather than the enforcing gate.

    Conceding while a decision is parked is safe for the same reason the phase is:
    `finishGame` clears `pending` wholesale, so no queued stage resumes into a
    finished game. */
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
    case "koTrigger":
      // §9 (M4) — the just-Knocked-Out Pokémon's on-KO Ability. Pop the stage
      // first so the prize/promotion stages behind it are what resumes if the
      // program parks (resume-the-tail); a done program just keeps draining.
      return runKoTrigger(popStage(state), stage.seat, stage.uid, events);
    case "damagedTrigger":
      // §9 — the damaged Active's reactive onDamagedByAttack Ability (Klawf ex's
      // parking Energy discard, Armarouge's Burn). Pop first so the attackEpilogue
      // behind it is what resumes if the program parks (resume-the-tail); a done
      // program just keeps draining into the sweep + turn end.
      return runDamagedTrigger(popStage(state), stage.seat, stage.uid, events);
    case "attackEpilogue":
      // §8 step 4 has finished (the effect program ran to completion, possibly
      // across one or more parks): sweep BOTH boards (a spread that KO'd the
      // defender, a recoil that KO'd the attacker) and end the attacker's turn.
      // The pop is REQUIRED — finishAttack composes with what is still queued, so
      // leaving this stage on would re-queue the epilogue behind the turn tail and
      // run the whole attack ending a second time.
      return finishAttack(popStage(state), events, stage.seat);
    case "startTurn":
      return startTurn(popStage(state), stage.seat, events);
  }
}
