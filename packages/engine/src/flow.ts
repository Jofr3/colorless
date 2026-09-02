import type { Card } from "@luminous/schema";
import type { ApplyResult, ConcedeAction } from "./actions";
import { err, ok } from "./actions";
import { activeTop, cardOfUid, prizeValueOf, topCardOf, topUid } from "./cards";
import { isLethallyDamaged, passivesOf, seatKoPrizeBonuses } from "./continuous";
import type { GameEvent } from "./events";
import type { RunResult } from "./interpreter";
import { doomBodyAt, runProgram } from "./interpreter";
import type { KoPrizeReduction } from "./registry";
import { flipCoin } from "./rng";
import {
  damagedByAttackAbility,
  koToolTriggersOf,
  onKnockOutTrigger,
  runCheckupTriggers,
} from "./triggers";
import type {
  GameOutcome,
  GameOverReason,
  GameState,
  InPlayPokemon,
  KnockOutMark,
  PendingStage,
  Seat,
  UsedAttack,
} from "./types";
import {
  BENCH_MAX,
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

/** 🆕🆕 D433 — THE DEFINITION MOVED TO `continuous.ts`, BESIDE `effectiveMaxHp`,
    AND THIS RE-EXPORT IS WHAT KEEPS EVERY EXISTING IMPORT PATH RESOLVING. It is that
    function's comparator and reads nothing else; interpreter.ts's `devolveEach` needs
    it and cannot import this module (this module takes `runProgram` from it). ONE
    definition, two spellings of the same import — see the block at the definition for
    why re-spelling the comparison at the op was refused. */
export { isLethallyDamaged } from "./continuous";

/** §8.1 KO cleanup, generalized off the Active (M4): Knock Out the in-play
    Pokémon whose stack-top is `koedUid` on `koedSeat`'s board — Active OR a
    benched one. Its whole stack (evolution cards, energy, tools) leaves play
    for `koedSeat`'s discard, KNOCKED_OUT fires, and the decision stages come
    back for the caller to queue: the prize pick for `prizeSeat` (§8.1 — the
    KO'd side's opponent), plus — for an ACTIVE KO only — the promotion that
    refills the empty spot. A benched KO leaves no gap (the bench compacts),
    so it owes no promotion. Addresses the Pokémon by uid, not index, so a
    batch of KOs cannot shift a later target's bench slot out from under it.

    🆕 **AND IT IS THE ONE WRITER OF `GameState.lastKoTurn` (D271).** Every Knock
    Out in the engine passes through here — both `KNOCKED_OUT` emit sites are in
    this function, and the attack epilogue, the Checkup and the mid-turn KO path
    all reach them via `collectKnockOuts` — so stamping the turn here is the only
    placement that cannot be bypassed. The stamp is taken from `state.turn` AS IT
    STANDS, which is why a Checkup KO counts toward the turn that is ending
    rather than the one about to start: the Checkup runs before `startTurn`
    increments, and "during your opponent's last turn" includes their Checkup.

    ⚠️ The speculative §14 tie probe in `collectKnockOuts` calls this on a
    THROWAWAY state, so it stamps a state that is discarded; the tie branch then
    re-runs every KO against the real `startState`, which stamps for real. Both
    are fine because the stamp is IDEMPOTENT — writing the same turn number twice
    for the same seat is the same value, which is the second thing the
    stamp-not-a-tally shape buys (a counter would have double-counted here). */
export function knockOut(
  state: GameState,
  koedSeat: Seat,
  koedUid: string,
  prizeSeat: Seat,
  events: GameEvent[],
  byAttack = false,
): { state: GameState; stages: PendingStage[] } {
  const side = state.players[koedSeat];
  // D271 — stamp the turn this seat lost a Pokémon on. 🆕 D326 — and co-stamp
  // WHICH body it was, for the two printed sentences that narrow the KO set
  // itself (an owner prefix, and "by damage from an attack"). Computed here and
  // applied only on the two branches that actually Knock something Out, so the
  // not-in-play no-op below stays a true no-op.
  //
  // 🛑 The list is RESTARTED when this Knock Out lands on a turn later than the
  // one already stamped and APPENDED to otherwise, which is the whole of the
  // "nothing clears it" property: the marks belong to `lastKoTurn`'s turn by
  // construction rather than by a boundary write anyone could forget. And the
  // append is keyed on `uid`, so the §14 tie probe's speculative call and the
  // real one that follows agree — D271's stamp was idempotent for free and a
  // list has to be made so on purpose.
  const stampFor = (card: Card | undefined): GameState => {
    const carried = state.lastKoTurn[koedSeat] === state.turn ? state.lastKoMarks[koedSeat] : [];
    // `card` is undefined only when a stack outruns the catalog. An empty name
    // matches no owner prefix, so the narrowed gate reads FALSE rather than
    // throwing — the bare D271 gate still reads TRUE off the turn stamp, which
    // is the honest split: we know a Pokémon was lost, we do not know which.
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
    const cleanup = discardFromStack(side, side.active, "all");
    events.push({ type: "KNOCKED_OUT", seat: koedSeat, uid: koedUid, discarded: cleanup.discarded });
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
    const cleanup = discardFromStack(side, benched, "all");
    const bench = [...side.bench.slice(0, index), ...side.bench.slice(index + 1)];
    events.push({ type: "KNOCKED_OUT", seat: koedSeat, uid: koedUid, discarded: cleanup.discarded });
    return {
      state: withSide(stamped, koedSeat, { ...cleanup.side, bench }),
      stages: [{ kind: "takePrizes", seat: prizeSeat, count: card === undefined ? 1 : prizeValueOf(card) }],
    };
  }
  // Not in play — unreachable (every caller just scanned it lethal). No-op.
  return { state, stages: [] };
}

/** 🆕🆕 **D435 — THE §8.1 PROMOTION OWED FOR AN ACTIVE SPOT NOTHING KNOCKED OUT,
    HOISTED.** D311 wrote this filter for `resolveMidTurnKnockOuts`, D312 copied it
    byte-for-byte into `finishAttack`, and D312's own comment named the expiry date:
    *"If a THIRD caller of `collectKnockOuts` ever appears it owes the same six lines,
    and the honest fix at that point is to hoist the filter into a helper rather than
    to write it a third time — two copies with two different tails is a shape, three
    would be a duplication."* D435 is that third caller: the delayed DISCARD payload
    (corpus row 53) is the first thing in this engine that can empty an Active Spot
    **during the Checkup**, so `runCheckup` needs it too. The premise is removed
    rather than the argument re-had (D418).

    🛑 **THE PREDICATE IS "EMPTY AND NOT ALREADY PROMISED A PROMOTION", NOT "EMPTY".**
    `collectKnockOuts` empties the spot it kills and queues that seat's `promote`
    itself, so an unconditional filter would queue a SECOND stage for every KO'd seat.
    That stage would be harmless — the handler pops on an occupied spot — and it would
    still be wrong: a board with two promotions owed for one dead Pokémon is a queue
    nobody can read.

    ⚠️ **THE THREE CALLERS DIFFER ONLY IN THE TAIL THEY SPLICE IN FRONT OF**, which is
    what D312 said and what the hoist preserves: `resumeTurn` where the actor keeps
    playing, `turnTail` where §8.1's promotion is owed before the turn ends, and — at
    the Checkup — the queue that was already pending, because the promotion is owed
    before the NEXT player's turn starts and a board handed over with an empty Active
    Spot is exactly what §8.1 forbids. */
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

/** §8.1 KO-CONDITIONED RECOIL — the HP `seat`'s about-to-be-Knocked-Out bodies
    owe the Attacking Pokémon (Vengeful Punch sv03-197: "If the Pokémon this card
    is attached to is Knocked Out by damage from an attack from your opponent's
    Pokémon, put 4 damage counters on the Attacking Pokémon"). SUMMED, because two
    holders can die to one spread and each Tool prints its own sentence — and one
    row carrying the sum is D141's judgement, not a shortcut: the amount already
    has no surviving provenance.

    ⚠️ THE LETHAL SET IS `lethalRefs`' OWN, NOT A SECOND OPINION. The refs are
    taken from the very function `collectKnockOuts` is about to call on the same
    state, so "the bodies this sweep will Knock Out" cannot drift from "the bodies
    that pay" — the alternative (re-deriving the predicate here) is the D141
    accident waiting to happen. It is exact rather than approximate because
    nothing between the two calls can save a lethal body: `collectKnockOuts` has
    no KO-prevention at all, and the only guard it does own (Glimmora's
    "Shattering Crystal") denies the PRIZE while the KO still happens for real.
    So "lethally damaged here" ≡ "is Knocked Out", which is the printed condition.

    Scans the WHOLE board, Active and Bench, because this printing — unlike Rocky
    Helmet sv01-193 — does NOT print "is in the Active Spot": a benched holder
    finished off by a snipe retaliates. That is the read-site difference between
    the two Tools and it is the reason for the second field. */
/** Is this body's lethality an EFFECT's doing rather than damage's, right now? */
function lethalByEffect(body: InPlayPokemon, turn: number): boolean {
  return body.markers.includes(koByEffectMarker(turn));
}

function koRecoilOf(state: GameState, seat: Seat): number {
  // 🆕🆕 D414 — the doomed set is narrowed to bodies made lethal BY DAMAGE. The
  // printed condition is "if this Pokémon is Knocked Out by damage from an
  // opponent's attack", and until D414 the `by damage` half was true by
  // construction at this line; `knockOutDefender` is the first thing that can put
  // a body here without damaging it, and it must not pay this recoil.
  const doomed = new Set(lethalRefs(state, [seat]).map((ref) => ref.uid));
  if (doomed.size === 0) return 0;
  const side = state.players[seat];
  let total = 0;
  for (const body of side.active === null ? side.bench : [side.active, ...side.bench]) {
    const uid = topUid(body);
    // 🆕🆕 D414 — `&& !lethalByEffect(...)` is the printed *"by damage"*, which
    // until D414 was true by construction at this line and is now a question.
    if (uid !== undefined && doomed.has(uid) && !lethalByEffect(body, state.turn)) {
      total += passivesOf(state, body).damageAttackerOnKo;
    }
  }
  return total;
}

/** Add `amount` HP of damage to the in-play body `uid` names on `seat`'s board —
    Active OR Bench — or `null` when it is not in play there (D189).

    ⚠️ BY UID ACROSS BOTH ZONES, WHICH IS THE WHOLE POINT rather than generality
    for its own sake. Its one caller (`finishAttack`'s §8.1 KO-conditioned recoil)
    aims at THE POKÉMON THAT ATTACKED, and since D189's self-switch arm that body
    can be sitting on its own Bench by the time the epilogue runs. The Active
    branch is checked first because it is the common case, not because it is the
    correct one — the uid decides.

    `null` rather than an unchanged state, so the caller can tell "no body" from
    "no damage" and skip the event: a COUNTERS_PLACED row naming a uid that is not
    in play would be a log entry no client could render against a board. */
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

/** 🆕🆕 §8 (D394) — record on the ATTACKING body that it used `attack` on this
    turn. `addDamageByUid`'s walk with a different field written, and copied from
    it deliberately: both address a body that may have moved off the Active Spot
    mid-attack, and one of them already got that right.

    RETURNS THE STATE RATHER THAN `null`-ON-MISS, because unlike the recoil there
    is nothing for the caller to decide: an attacker that is no longer in play
    (Gholdengo's "Surf Back" shuffles its own actor away, D312) has nowhere to
    carry the stamp and the record dies with the body, which is the right answer
    and not an error. */
function stampAttackUse(
  state: GameState,
  seat: Seat,
  uid: string,
  attack: string,
): GameState {
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

/** §8.1 CAUSE-CONDITIONED PRIZE REDUCTION — Munkidori ex sv06.5-037/-083/-091
    "Oh No You Don't": "If this Pokémon is Knocked Out by damage from an attack
    from your opponent's Pokémon, and if you have any Pecharunt ex in play, your
    opponent takes 1 fewer Prize card." Returns the REDUCED prize count, or null
    when any clause of the antecedent fails (the caller then plans face value).

    ⚠️ THE CAUSE IS A PARAMETER HERE, NOT A PLACEMENT — and that is the whole
    difference from D158, which read the SAME printed antecedent. D158's line sits
    in `finishAttack`, so "by an attack" is discharged by WHERE it sits: the
    Checkup and the mid-turn evolve path call `collectKnockOuts` directly and
    never reach it. This consequent modifies a PRIZE, and prizes are planned in
    `planPrizes` — INSIDE `collectKnockOuts` — which all three paths reach. So the
    same clause that cost D158 nothing costs this printing a threaded argument:
    `attackerSeat` is undefined on the Checkup and mid-turn paths, and the clause
    is refused there. **Placement discharges a condition only for a consequent
    that can live at the placement.**

    The three clauses, each a separate refusal and each driven:

      • "by damage from an attack" — `attackerSeat === undefined` means this batch
        was not swept by the attack epilogue. Refused.
      • "from your OPPONENT'S Pokémon" — `attackerSeat === ref.seat` means the
        holder died on the ATTACKER's own board (its own `damageSelf` recoil, its
        own confusion self-hit, or a defender's Rocky Helmet), which `finishAttack`
        sweeps too because it passes BOTH seats. The possessive refuses it.
      • "if you have any Pecharunt ex in play" — scanned on the KO'd body's OWN
        side ("you" is this Ability's controller), Active and Bench, by card NAME
        because the sentence names a card with FOUR printings
        (sv06.5-039/-085/-093/-095) and no id would cover them.

    ⚠️ "IN PLAY" IS READ BEFORE THE BATCH RESOLVES, which is a judgement and is
    pinned: `planPrizes` runs on the pre-KO state, so a Pecharunt ex dying in the
    SAME batch still counts. That is D158's one-simultaneous-batch model read one
    function later — the batch is a single instant, so nothing in it has left play
    while the plan is made.

    The reduction is CLAMPED at 0: "1 fewer" than a 1-Prize Pokémon is 0, not −1.
    Munkidori ex is itself worth 2 (it has a Rule Box), so its own printing is
    2 → 1 and never reaches the clamp — the clamp is total-function hygiene with a
    constructed witness rather than a live rule. */
function koPrizeReduction(
  state: GameState,
  ref: { seat: Seat; uid: string },
  reduction: KoPrizeReduction,
  attackerSeat: Seat | undefined,
  baseCount: number,
): number | null {
  if (attackerSeat === undefined || attackerSeat === ref.seat) return null;
  const side = state.players[ref.seat];
  const inPlay = side.active === null ? side.bench : [side.active, ...side.bench];
  // 🆕 D298 — the board clause became OPTIONAL when the type was extracted for the
  // two ATTACHED carriers, neither of which prints one. `undefined` is "no clause
  // to refuse", not "a clause that fails": an Ability with no `requiresInPlay`
  // reduces on the attack-cause alone. No such Ability is printed today, so the
  // arm is guarded by the corpus rather than by a board.
  const name = reduction.requiresInPlay;
  if (name !== undefined && !inPlay.some((body) => topCardOf(state, body)?.name === name))
    return null;
  return Math.max(0, baseCount - reduction.by);
}

/** 🆕 §8.1 (D298) — the same reduction borne by an ATTACHED CARD rather than by
    the holder's Ability. Two printings reach it, and they are the whole population
    of the sentence (remote D1 `luminous`, 2026-08-09: `legal_standard = 1 AND
    instr(effect,'fewer Prize') > 0` returns 9 rows, of which 7 are Lacey ×5 /
    Emcee's Hype ×2 printing a *"3 or fewer Prize cards **remaining**"* board
    condition and the other two are these):

      • Lillie's Pearl `sv09-151`, a Pokémon TOOL, gated on the HOLDER being a
        `Lillie's ` Pokémon and carrying NO cap;
      • Legacy Energy `sv06-167`, a Special ENERGY, gated on NOTHING and carrying a
        once-per-game cap on the printed EFFECT.

    🛑 **THE ATTACK-CAUSE CLAUSE IS `koPrizeReduction`'s, NOT A SECOND READING OF
    IT.** Both printings spell the antecedent Munkidori ex spells, byte for byte
    (*"is Knocked Out by damage from an attack from your opponent's Pokémon"*), so
    the two refusals above — no `attackerSeat` (a Checkup or mid-turn KO) and
    `attackerSeat === ref.seat` (the holder died on the ATTACKER's own board, to
    its own recoil, its own confusion self-hit or a defender's Rocky Helmet) — are
    re-used verbatim rather than re-derived. `finishAttack` passes BOTH seats, so
    the possessive is load-bearing here for exactly D164's reason.

    ⚠️ **AND THE SOURCE SCAN IS `passivesOf`'s, WHICH IS THE WHOLE REASON THIS ROW
    IS NOT A NEW MECHANISM.** That fold has walked the holder's attached Tools
    since §7.4 and its attached Energy since D174, and its §8.1 SIBLING —
    `koRecoilOf` directly above, Vengeful Punch `sv03-197` — already proves a KO
    sweep may read an attached card's clause off a body it is about to destroy,
    from the PRE-KO state, through this exact fold. The consequent is different;
    nothing else is.

    Each entry answers its OWN riders and the reductions COMPOUND, so a body
    wearing both printings pays both — and `Math.max(0, …)` clamps the running
    total, not each term, so two "1 fewer" clauses on a 1-Prize Pokémon is 0 rather
    than −1. Returns the reduced count, the latch writes, and one `PRIZE_REDUCED`
    per applied entry. */
function attachedPrizeReductions(
  state: GameState,
  ref: { seat: Seat; uid: string },
  attackerSeat: Seat | undefined,
  baseCount: number,
): { state: GameState; count: number; events: GameEvent[] } {
  const unchanged = { state, count: baseCount, events: [] };
  if (attackerSeat === undefined || attackerSeat === ref.seat) return unchanged;
  const side = state.players[ref.seat];
  const body = (side.active === null ? side.bench : [side.active, ...side.bench]).find(
    (pokemon) => topUid(pokemon) === ref.uid,
  );
  if (body === undefined) return unchanged;
  const entries = passivesOf(state, body).koPrizeReductions;
  if (entries.length === 0) return unchanged;
  const holderName = topCardOf(state, body)?.name;
  const inPlay = side.active === null ? side.bench : [side.active, ...side.bench];
  let next = state;
  let count = baseCount;
  const events: GameEvent[] = [];
  for (const entry of entries) {
    // 🛑 NOTHING LEFT TO REDUCE IS NOT AN APPLICATION OF THE EFFECT, AND THIS LINE
    // IS THE ONLY THING THAT KEEPS THE LATCH HONEST. Glimmora's coin-flip guard
    // already zeroed this Prize, or a previous entry did; "that player takes 1
    // fewer Prize card" than none is not a thing the sentence can do, so it does
    // not fire, does not log, and — the part that matters — does not spend a
    // once-per-game cap on a Knock Out that reduced nothing.
    if (count === 0) break;
    // The OWNER-PREFIXED subgroup gate (D200/D267's vocabulary), read off the
    // HOLDER's top card name exact-case with the trailing space load-bearing —
    // `matchesFilter`'s `ownerPokemon` predicate, one body over. A Pearl on a body
    // that is not a Lillie's Pokémon reduces nothing.
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
  attackerSeat?: Seat,
  /** 🆕 D323 — the ATTACKING BODY's uid, passed only by `finishAttack` and only
      alongside `attackerSeat`. `attackerSeat` answers "by an attack from your
      opponent's Pokémon" (Munkidori ex, D164, a SEAT question); this answers "by
      an attack used by THIS Pokémon" (Hydreigon ex "Greedy Eater"), which names a
      BODY and which no seat can decide. Omitted by the Checkup and mid-turn
      sweeps exactly as `attackerSeat` is, and the clause is refused there. */
  attackerUid?: string,
): KnockOutBatch {
  let next = state;
  const stages: PendingStage[] = [];
  // 🆕 🛑 THE BATCH IS A FIXED POINT, NOT A SNAPSHOT. `lethalRefs` used to be
  // taken ONCE, which was sound only while a Knock Out could not change any OTHER
  // body's lethality — an accident of the catalog rather than a rule, and D324
  // ended it: `seatHpBonus` (Ludicolo `sv09-037` "Vibrant Dance", +40 to that
  // player's WHOLE side) means the dying body can be the SOURCE of its teammates'
  // maximum. Knock the Ludicolo out and every one of its teammates loses 40 max HP
  // in the same instant; a teammate already past the reduced number is Knocked Out
  // by §8.1's `damage ≥ maximum` state check, and nothing re-scanned. So the pass
  // below is repeated until a pass finds nothing.
  //
  // ⚠️ **IT TERMINATES, AND THE ARGUMENT IS A STRICTLY DECREASING FINITE
  // MEASURE.** A pass runs only when `lethalRefs` is non-empty, and each ref it
  // finds is a body `knockOut` REMOVES from play (the Active spot is emptied, a
  // benched body is spliced out) — so every pass strictly decreases the number of
  // Pokémon in play, which starts at most `2 × (1 + BENCH_MAX)` and never grows
  // inside this function (nothing here plays or promotes anything; the `promote`
  // stages are QUEUED, not run). The loop therefore runs at most that many times.
  // `MAX_KO_PASSES` states the same bound as a hard stop so a future op that DOES
  // refill mid-sweep cannot turn a correctness bug into a hang; reaching it would
  // be a bug, and it is unreachable by the measure above.
  //
  // 🆕 🛑 **THE §14 TIE GUARD SEES THE WHOLE FIXED POINT, AND IT IS AN INVARIANT
  // RATHER THAN A CAVEAT (D329).** D328 left this per PASS and recorded the edge:
  // *"a tie that only exists ACROSS passes still falls through to the
  // stage-by-stage §14 checks"*. **THOSE CHECKS CANNOT REPORT A TIE.**
  // `resolvePrizesAndResume` evaluates §14 after EACH prize stage, so whichever
  // seat's stage is queued first empties its row first and wins OUTRIGHT — the
  // sequential resolution is precisely what this speculation exists to pre-empt,
  // and a cross-pass tie was being answered `win`. A board reaches it: one Gravity
  // Mountain Knocks Out a Stage 2 on each side (pass 0 — both seats, so the guard
  // ran, saw a ONE-SIDED win and correctly fell through) and the dying Ludicolo's
  // aura cascades onto a benched teammate whose Prize is the other seat's last
  // (pass 1). `hpAura.test.ts` §11 drives it, with the one-row-empties control
  // beside it.
  //
  // ⚠️ **SO THE SPECULATION IS RUN ONCE, OVER THE ACCUMULATED BATCH** — and it
  // gets simpler rather than bigger by moving: the Knock Outs have already
  // happened for real by then, so nothing has to be re-applied to a throwaway
  // state and only the batch's OWED PRIZES are speculative. `tiedOverTheBatch`
  // below is that, whole.
  //
  // ⚠️ **AND A TIE IS MONOTONE IN KNOCK OUTS, WHICH IS WHY ONE CHECK AT THE END IS
  // NOT WEAKER THAN A CHECK PER PASS.** `evaluateWin` sets a seat's reason on
  // `prizes.length === 0` or on the opponent having no Pokémon in play; a later
  // pass only removes bodies and only adds owed prizes, so neither term can go
  // back from true to false. A tie visible after any prefix of the passes is
  // therefore still a tie after all of them — the later passes can add Knock Outs
  // to a decided game, and that is §8.1's own simultaneity rather than a change of
  // answer.
  //
  // ⚠️ **AND ONLY THE FIRST PASS IS "BY AN ATTACK".** `attackerSeat`/`attackerUid`
  // answer *"Knocked Out by damage from an attack"* (D164's Munkidori ex, D323's
  // Hydreigon ex, D326's marks). A cascade Knock Out is caused by the maximum
  // MOVING, not by the attack's damage — the counters on that teammate were placed
  // some other turn — so the later passes are handed neither, which is exactly how
  // the Checkup and the mid-turn sweep already call this function.
  const koedSeats = new Set<Seat>();
  for (let pass = 0; pass < MAX_KO_PASSES; pass += 1) {
    const batch = collectKnockOutPass(
      next,
      seats,
      events,
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

/** The §14 speculation, run ONCE over a whole settled batch: take the prizes the
    batch OWES into a throwaway state and ask `evaluateWin`, so the §14 precedence
    core stays single-sourced (D329).

    ⚠️ **ONLY THE PRIZES ARE SPECULATIVE.** Every Knock Out in the batch has
    already been applied for real by the time this runs — the cards have left play
    and the events have fired — so this is the state the stage-by-stage resolution
    would reach if it took every queued `takePrizes` at once, which is exactly what
    §8.1's one-instant model says happens. WHICH prize slots are taken is immaterial
    to §14; a guard-denied Knock Out (Glimmora "Shattering Crystal") queued no
    stage at all and therefore deducts nothing, which is the right answer for the
    same reason.

    Returns the outcome only when it is the TIE — a one-sided win is left to the
    stage path, which reaches it correctly and prompts the prize pick on the way. */
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

/** The most Knock Out passes `collectKnockOuts` can need — one per Pokémon that
    can be in play at once, which is the measure its loop decreases. A pass that
    finds nothing exits earlier; this is the hard stop, not the expected count. */
const MAX_KO_PASSES = 2 * (1 + BENCH_MAX);

/** What ONE pass Knocked Out: the post-KO state, the decision stages it queued
    and the SEATS it took a body from — the last of which is what the accumulated
    §14 guard is asked about, and the reason a pass no longer returns an outcome
    of its own (D329). */
interface KnockOutPass {
  state: GameState;
  stages: PendingStage[];
  koedSeats: readonly Seat[];
}

/** ONE pass of the sweep — the function `collectKnockOuts` was until D328, with
    its loop lifted out at D328 and its §14 speculation lifted out at D329.
    Everything below is unchanged: the up-front Prize plan and the
    PRIZES → koTriggers → PROMOTIONS grouping. */
function collectKnockOutPass(
  state: GameState,
  seats: readonly Seat[],
  events: GameEvent[],
  attackerSeat?: Seat,
  attackerUid?: string,
): KnockOutPass {
  const refs = lethalRefs(state, seats);
  if (refs.length === 0) return { state, stages: [], koedSeats: [] };

  // Resolve each on-KO Prize guard (Glimmora) ONCE, up front: the flip's rng
  // advance and its post-flip Prize `count` are then shared by the tie-guard
  // speculation and the real KO alike (so §14 stays exact). The guard's own
  // events fire in the real KO loop, after that KO's KNOCKED_OUT.
  // 🆕 D326 — the CAUSE the co-stamped marks record. `attackerSeat` is passed by
  // `finishAttack` ALONE and deliberately omitted by the Checkup and the mid-turn
  // sweep, so it is already exactly "this batch is an attack's epilogue" — the
  // same discriminant D164 reads for Munkidori ex's "by an attack from your
  // opponent's Pokémon", inherited rather than re-derived.
  // 🆕🆕 D414 — PER-BODY, NOT PER-BATCH, AND THE OLD LINE WAS RIGHT ONLY BY
  // ACCIDENT. It read `attackerSeat !== undefined` — "this batch is an attack's
  // epilogue" — which was a faithful reading of *"by damage from an attack"* only
  // while an attack could not doom a body WITHOUT damaging it. `knockOutDefender`
  // can, so the batch-level answer would mark a non-damage Knock Out as
  // `byAttack: true` and satisfy all six printings of the sentence it feeds.
  // ⚠️ THE OTHER TWO CALLERS ARE UNCHANGED BY CONSTRUCTION: the Checkup and the
  // mid-turn sweep pass no `attackerSeat`, so they answer FALSE either way.
  const byAttackFor = (ref: { seat: Seat; uid: string }): boolean => {
    if (attackerSeat === undefined) return false;
    const side = state.players[ref.seat];
    const body = [side.active, ...side.bench].find((p) => p !== null && topUid(p) === ref.uid);
    // A ref whose body cannot be found answers TRUE — the pre-D414 reading — so a
    // lookup miss degrades to the behaviour six shipped printings already have
    // rather than silently withholding a mark they are owed.
    return body === null || body === undefined ? true : !lethalByEffect(body, state.turn);
  };
  const plan = planPrizes(state, refs, attackerSeat, attackerUid);
  const startState = plan.state;

  // Apply each KO for real, grouping the stages PRIZES-first, then on-KO
  // triggers, then PROMOTIONS (§8.1/§13), preserving ref order within each
  // kind. A guard-denied KO queues no prize; an on-KO PROGRAM queues a koTrigger.
  let next = startState;
  const prizeStages: PendingStage[] = [];
  const koTriggerStages: PendingStage[] = [];
  const promoteStages: PendingStage[] = [];
  for (const entry of plan.entries) {
    // 🆕🆕 D414 — asked of `state`, the PRE-BATCH board, and not of `next`: by the
    // time this loop reaches a later ref the earlier Knock Outs have already left
    // play, so the body carrying the marker may be gone. The question is about how
    // this body BECAME lethal, which the pre-batch state is the only witness to.
    const ko = knockOut(
      next,
      entry.ref.seat,
      entry.ref.uid,
      otherSeat(entry.ref.seat),
      events,
      byAttackFor(entry.ref),
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
  }
  return {
    state: next,
    stages: [...prizeStages, ...koTriggerStages, ...promoteStages],
    koedSeats: refs.map((ref) => ref.seat),
  };
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

/** 🆕 §8.1 (D323) — the SEAT-WIDE PRIZE BONUS, resolved for ONE Knock Out.
    Togekiss `sv08-072` "Wonder Kiss" (*"When your opponent's Active Pokémon is
    Knocked Out, flip a coin. If heads, take 1 more Prize card. The effect of
    Wonder Kiss doesn't stack."*) and Hydreigon ex `sv10.5w-067`/`-161`/`-169`
    "Greedy Eater" (*"If your opponent's Basic Pokémon is Knocked Out by damage
    from an attack used by this Pokémon, take 1 more Prize card."*).

    🛑 **IT SCANS THE OTHER BOARD FROM EVERY OTHER MEMBER OF THIS SEAM.** D164's
    reduction, D298's attached reductions and Glimmora's guard are all read off the
    DYING body — its own Ability, its own attachments. These two are printed on a
    body belonging to `otherSeat(ref.seat)`, the side about to TAKE the prize, so
    the board question is delegated to `seatKoPrizeBonuses` (continuous.ts, the
    aura-scan family) and this function owns only the parts that need a state: the
    coin flip and the events.

    ⚠️ **"ACTIVE" IS READ ON THE PRE-KO STATE, WHICH IS THE SAME JUDGEMENT D164
    PINNED ONE FUNCTION UP AND FOR THE SAME REASON.** `planPrizes` runs before any
    body in the batch has left play, so the batch is a single instant: an Active
    that dies alongside a benched teammate is still the Active when its own bonus
    is decided. */
function koPrizeBonus(
  state: GameState,
  ref: { seat: Seat; uid: string },
  baseCount: number,
  attackerUid: string | undefined,
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
  return { state: next, count, events };
}

function planPrizes(
  state: GameState,
  refs: readonly { seat: Seat; uid: string }[],
  attackerSeat?: Seat,
  attackerUid?: string,
): { state: GameState; entries: KoPrizePlan[] } {
  let next = state;
  const entries: KoPrizePlan[] = [];
  for (const ref of refs) {
    const card = cardOfUid(next, ref.uid);
    const baseCount = card === undefined ? 1 : prizeValueOf(card);
    const ability = onKnockOutTrigger(next, ref.uid);
    const hasProgram = ability !== undefined && ability.program.length > 0;
    // 🆕 D298 — every push in this loop goes through here, so the ATTACHED
    // reduction (Legacy Energy, Lillie's Pearl) rides EVERY on-KO Ability path and
    // not just the bare one: a Munkidori ex wearing a Legacy Energy pays both, and
    // a Glimmora whose coin came up heads has nothing left to reduce (the clamp
    // answers that, which is why the two need no mutual exclusion). The latch write
    // lands on `next` before the entry is recorded.
    // 🆕 D323 — and the SEAT-WIDE BONUS rides the same choke, AFTER the
    // reductions, so a Munkidori ex that cut its own prize and a Togekiss that
    // added one compose in printed order (2 → 1 → 2) rather than racing.
    //
    // 🛑 **`denied` IS NOT `count === 0`, AND THE DISTINCTION IS THE PRINTED ONE
    // THIS FILE ALREADY DRAWS BETWEEN `PRIZE_PREVENTED` AND `PRIZE_REDUCED`.**
    // Glimmora's heads prints *"your opponent **can't take any** Prize cards for
    // it"* — a PROHIBITION, which a later permission does not overturn, so a
    // Wonder Kiss cannot resurrect a denied prize and does not even flip for it.
    // A REDUCTION clamped to 0 is a different sentence: Munkidori ex says "1
    // fewer", nothing forbids the taking, and a bonus on top of it is arithmetic.
    // A build that keyed on `count === 0` would collapse the two and silently
    // give the prohibition's answer to the clamp.
    const push = (count: number, guardEvents: GameEvent[], denied = false): void => {
      const attached = attachedPrizeReductions(next, ref, attackerSeat, count);
      next = attached.state;
      const bonus = denied
        ? { state: next, count: attached.count, events: [] as GameEvent[] }
        : koPrizeBonus(next, ref, attached.count, attackerUid);
      next = bonus.state;
      entries.push({
        ref,
        count: bonus.count,
        guardEvents: [...guardEvents, ...attached.events, ...bonus.events],
        hasProgram,
      });
    };
    // §8.1 — the CAUSE-CONDITIONED Prize REDUCTION (Munkidori ex "Oh No You
    // Don't", D164). Checked BEFORE the coin-flip guard because the two are
    // mutually exclusive by construction (an on-KO Ability carries at most one),
    // and its refusal path is the common one, so nothing below sees it.
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
      push(0, guardEvents, true); // D323 — a PROHIBITION; no bonus, and no flip

    } else {
      push(baseCount, guardEvents);
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
    the sweep — and the §14 double-KO tie guard — sees every KO.

    🆕 🛑 **D311 — AND IT ALSO SWEEPS FOR AN EMPTY ACTIVE SPOT THAT NO KNOCK OUT
    EXPLAINS.** Until this slice, `active === null` mid-turn meant exactly one
    thing: a body had just died, and `knockOut` queued the promotion itself. The
    `returnSelf` op (Dudunsparce `sv05-129`/`sv08.5-080`, *"shuffle this Pokémon
    and all attached cards into your deck"*) is the first thing in the engine that
    empties the spot WITHOUT a Knock Out, and the block on `returnBenched` has
    called that missing promotion *"missing CODE"* since D299.

    ⚠️ **IT IS A QUEUEING SEAM AND NOT A STAGE, WHICH IS THE WHOLE REASON THE ROW
    WAS CHEAPER THAN ITS PRICE.** `PendingStage {kind:"promote"}` is already total
    over the three boards it can meet — it POPS on a spot something refilled,
    AUTO-RESOLVES a Bench of one (the M1 no-choice doctrine) and falls into the
    §14.2 loss on a Bench of none — so a controller who shuffles away their last
    Pokémon loses through the path that already existed, with nothing added.

    ⚠️ **AND A SEAT THE KO SWEEP ALREADY QUEUED A PROMOTION FOR IS SKIPPED.**
    `collectKnockOuts` empties the spot it kills, so every KO'd seat would
    otherwise match this predicate too and take a SECOND stage. That stage would be
    harmless (the handler pops on an occupied spot) and it would still be wrong: a
    board with two promotions owed for one dead Pokémon is a queue nobody can read.
    The KO's own stage is the one that counts, so this term is the seats the batch
    did NOT already name.

    🆕 ⚠️ **D312 — THIS IS ONE OF *TWO* SITES AND NOT THE ONLY ONE.** `finishAttack`
    below calls `collectKnockOuts` directly and never comes through here, so the
    ATTACK half of the same printed family (Gholdengo `sv08-131` "Surf Back") owed
    its own copy. It has one now, spliced in front of `turnTail` instead of in front
    of `resumeTurn`. **If a THIRD caller of `collectKnockOuts` ever appears it owes
    the same six lines**, and the honest fix at that point is to hoist the filter
    into a helper beside `collectKnockOuts` rather than to write it a third time —
    two copies with two different tails is a shape, three would be a duplication.

    🆕🆕 **D435 — THE THIRD CALLER ARRIVED AND THE PREDICTION WAS PAID EXACTLY AS
    WRITTEN.** `runCheckup` has in fact called `collectKnockOuts` directly since long
    before D312 wrote that sentence; what it did not have until D435 was any way for
    a Checkup to leave an Active Spot empty without a Knock Out. The delayed DISCARD
    payload (corpus row 53) is that way, and the filter is now `orphanedPromotions`
    above, called from all three sites. The price was the hoist and three call lines
    — the quoted "six lines" per site, avoided — and this paragraph records it rather
    than leaving the forecast to be read as a criterion (D427). */
export function resolveMidTurnKnockOuts(
  state: GameState,
  actorSeat: Seat,
  seats: readonly Seat[],
  events: GameEvent[],
): ApplyResult {
  const batch = collectKnockOuts(state, seats, events);
  if (batch.done !== null) return finishGame(batch.state, batch.done, events);
  // 🆕🆕 D435 — the filter itself is `orphanedPromotions` now, shared with
  // `finishAttack` below and with `runCheckup`'s third site. Nothing about this
  // call's behaviour changed; what changed is that there is one copy of it.
  const orphaned = orphanedPromotions(batch.state, seats, batch.stages);
  // Nothing KO'd and no spot left empty.
  if (batch.stages.length === 0 && orphaned.length === 0) return ok(batch.state, events);
  return advance(
    {
      ...batch.state,
      pending: [...batch.stages, ...orphaned, { kind: "resumeTurn", seat: actorSeat }],
    },
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
    the other side of that edge.

    ⚠️ `attackerUid` IS LOAD-BEARING ON EXACTLY ONE OF THE FIVE CALL SITES, AND
    THAT WAS MEASURED RATHER THAN REASONED (D189). `attack.ts`'s four DIRECT calls
    — the confusion-tails failure, the D125 requirement gate, the cancel-on-tails
    flip and the no-effect-program tail — all sit STRICTLY BEFORE any effect
    program has run, so on every one of them the declared attacker is still
    `players[attackerSeat].active` and the parameter provably equals the lookup it
    replaced. Mutating those four to re-read the spot fails NOTHING, and that was
    said here to be recorded as an equivalent mutant rather than papered over with
    a case that asserts nothing.
    🆕🆕 **D455 CHECKED THAT SENTENCE AND IT IS FALSE — THE ROW DOES NOT EXIST.**
    `scripts/mutation/mutants.ts` holds SIX declared survivors on `attack.ts`
    (`D196-live-active`, `D228-base-damage-is-suppressed`,
    `D282-split-fires-without-a-gate`, `D317-program-assigned-not-appended`,
    `D318-boost-program-not-appended`, `D427-whiffed-attack-heals-the-base`) and
    TWO on this file (`D312-attack-seam-scans-only-the-attacker`,
    `D435-ko-marker-not-stamped`); **not one of them mutates a direct
    `finishAttack` call site to re-read `players[attackerSeat].active`.** The nine
    corpus rows that quote `attackerUid` at all are about the THREADING, the seat
    and the KO cause. The equivalence argument above stands on its own reasoning
    and is unchanged; only the claim that somebody recorded it is withdrawn.
    ⚠️ **A DOC BLOCK'S "recorded as X" NAMES A FILE AND IS ONE GREP FROM BEING
    CHECKED** — D453 found the same false claim on `moveCountersChosen`, D455 found
    it again on `interpreter.ts`'s `optional` apply arm and here. Three of the four
    such claims in shipped source were false; the true one is `effects.ts`'s
    `D382-join-operands-swapped`. **Writing the row is what closes this.** The fifth site — `advance`'s `attackEpilogue` stage — is the
    only one a program has run before, and it is the whole reason the field exists.
    The four keep passing the uid anyway: uniform, and a future reordering that put
    a program in front of any of them would then be correct by construction rather
    than by this paragraph. */
export function finishAttack(
  state: GameState,
  events: GameEvent[],
  attackerSeat: Seat,
  attackerUid: string,
  attackName: string,
): ApplyResult {
  // §8.1 KO-conditioned recoil (Vengeful Punch sv03-197), placed BEFORE the sweep
  // reads the board — the new READ SITE this printing needed, and the one thing
  // about it that is a judgement rather than a lookup.
  //
  // ⚠️ WHY BEFORE THE SWEEP AND NOT INSIDE IT. Placing it in `collectKnockOuts`'
  // loop — right after the holder's own KNOCKED_OUT, where the printed sentence's
  // "if … is Knocked Out" reads in order — would put the counters down AFTER
  // `lethalRefs` had already decided who dies. A lethal retaliation would then
  // miss this batch entirely: the attacker would stand until some later sweep,
  // and worse, `collectKnockOuts`' §14 double-KO tie guard (which speculates over
  // ONE batch) could not see a game that both players just lost. Placing it here
  // makes the holder's KO and the attacker's KO ONE simultaneous batch — which is
  // §8.1's own model ("If multiple Pokémon are KO'd simultaneously … the
  // attacking player takes prizes for the opponent's KO'd Pokémon") — so the
  // cascade question has no second pass to ask about, the prizes go to the
  // holder's side through the ordinary `otherSeat` rule, and the tie is reachable.
  //
  // It is also D98's OWN model one step later. attack.ts's §9 recoil places
  // before this sweep for the same reason ("even if it is Knocked Out" is FREE),
  // and the row order it produces — COUNTERS_PLACED, then KNOCKED_OUT — is
  // already what this family narrates and what rockyHelmet.test.ts pins. So the
  // condition being announced after its consequence is the family's existing
  // reading order, not a wart this slice introduces.
  //
  // ⚠️ THE GUARD IS THE SITE. "Knocked Out by damage from an attack from your
  // OPPONENT'S Pokémon" is three conditions, and each is discharged by WHERE this
  // line sits rather than by a flag:
  //   • "by an attack" — `finishAttack` is the attack epilogue and nothing else.
  //     The Checkup's poison/burn KO and the mid-turn evolve KO call
  //     `collectKnockOuts` directly and never come through here, so a KO this
  //     Tool must ignore cannot reach the line.
  //   • "from your opponent's" — only `otherSeat(attackerSeat)` is scanned. A
  //     Vengeful Punch on the ATTACKER's own board, killed by its own confusion
  //     self-hit or by a `damageSelf` recoil, pays nothing, which is exactly what
  //     the possessive says.
  //   • "by damage" — a body can only be lethal on the defender's board here
  //     because this attack put it there; pre-existing damage that was already
  //     lethal would have been swept when it landed.
  // Every one of the three is DRIVEN in vengefulPunch.test.ts rather than argued.
  //
  // ⚠️ THE ATTACKING POKÉMON IS `attackerUid`, AND SINCE D189 THAT IS A PARAMETER
  // RATHER THAN A LOOKUP. This line used to read `players[attackerSeat].active`,
  // which was sound only because nothing between the §8.5 hit and this epilogue
  // could swap that seat's Active — an accident of the registry rather than a
  // rule, and swept as such by `vengefulPunch.test.ts` ("no attack program,
  // derived OR authored, can move its own actor off the spot"), which named this
  // exact repair in advance. D189's self-switch arm ("Switch this Pokémon with 1
  // of your Benched Pokémon.") turned that sweep red: the spot now holds the body
  // that was just PROMOTED, and the counters would land on a Pokémon that never
  // attacked. "The Attacking Pokémon" is a fact about which body DECLARED the
  // attack, so it is carried from `attack.ts` (on the `attackEpilogue` stage
  // across a park) rather than re-derived from a spot that has moved.
  //
  // The body is then found by uid across the WHOLE board — Active or Bench — for
  // the same reason `koRecoilOf` scans both: a self-switched attacker is standing
  // on its own Bench when this runs, and it is still the Pokémon that attacked.
  //
  // 🆕 🛑 **D312 — THE `null` BRANCH USED TO BE JUSTIFIED BY A CLAIM ABOUT THE
  // POOL, AND THE CLAIM IS NOW FALSE.** This paragraph read, verbatim:
  //
  //     "`null` (not in play at all) is a no-op: nothing in this pool can discard
  //      its own actor mid-attack, and `koRecoilOf`'s 'the lethal set is the
  //      sweep's own' rule says a body that is about to be Knocked Out is still
  //      HERE."
  //
  // Gholdengo `sv08-131` "Surf Back" (*"You may shuffle this Pokémon and all
  // attached cards into your deck."*) discards its own actor mid-attack, through
  // `returnSelf` — so the second half of that sentence still holds (a lethal body
  // IS still here) and the FIRST half does not. ⚠️ **THE CODE WAS ALREADY RIGHT
  // AND ONLY THE REASON WAS WRONG**, which is the whole shape of this correction:
  // `addDamageByUid` returns `null` on a uid it cannot find, `recoiled` stays
  // `null`, and no `COUNTERS_PLACED` row is written for a Pokémon that is sitting
  // in its controller's deck. What changed at D312 is that the branch went from
  // UNREACHABLE-by-argument to **REACHED**, and it is now DRIVEN
  // (`surfBack.test.ts`: a Vengeful Punch holder is Knocked Out by the same attack
  // that removes its killer, and the 4 counters it is owed land on nothing).
  // 🛑 **A `null` GUARD DEFENDED BY A CENSUS OF THE POOL EXPIRES WHEN THE POOL
  // GROWS.** The guard is kept because it is TOTAL over uids, not because the
  // registry is small.
  // 🆕🆕 **D394 — THE ONE WRITER OF `InPlayPokemon.usedAttack`, AND ITS PLACEMENT
  // IS THE WHOLE OF WHY THE FIELD WORKS.** `finishAttack` IS this engine's
  // definition of "an attack was used": every exit out of `attack.ts` reaches it —
  // the confusion-tails failure (§12), the D125 requirement gate whose own comment
  // already says *"a cancelled attack is an attack that was USED"*, the
  // cancel-on-tails flip, the no-effect-program tail and the parked program's
  // epilogue stage — and nothing else in the engine does. The Checkup's poison KO
  // and the mid-turn evolve sweep call `collectKnockOuts` directly, so no
  // non-attack can reach this line, which is the same placement argument D158 made
  // for *"by an attack"* two paragraphs down.
  //
  // 🛑 **AND IT IS WRITTEN AT THE END SO THIS ATTACK CANNOT CLOBBER ITS OWN
  // ANTECEDENT.** The printed clause is read by `scaledAttackDamage`'s
  // `boardCondition` arm at DECLARATION (attack.ts, "so Gyarados ex's 'already has
  // any damage counters on it' cannot be bootstrapped by this very attack") —
  // hundreds of lines before this one. A stamp written beside `ATTACK_DECLARED`
  // would overwrite last turn's record with THIS turn's attack before the bonus is
  // read, and Weezing's +120 would never pay on any board. The read is at the front
  // of the declaration and the write is at the back of it; that ordering is the
  // slice.
  //
  // ⚠️ **`state.turn` HERE IS STILL THE ATTACKING TURN**, because this runs BEFORE
  // `turnTail` is queued below — and it stays the attacking turn across a Knock Out
  // PARK, since the prize/promotion stages are spliced in FRONT of that tail and
  // hold the counter at the ending turn's value for the whole interrupt.
  let next = stampAttackUse(state, attackerSeat, attackerUid, attackName);
  const koRecoil = koRecoilOf(next, otherSeat(attackerSeat));
  const recoiled = koRecoil > 0 ? addDamageByUid(next, attackerSeat, attackerUid, koRecoil) : null;
  if (recoiled !== null) {
    next = recoiled;
    // The SAME row as the §9 recoil, with no new `source` member — D141's
    // mechanism axis paying out for the third kind of producer and the FIFTH
    // printing. `seat` is the ATTACKER's (it owns the damaged Pokémon, per this
    // event's contract) while the causer is the dying holder, so log.ts renders it
    // SYSTEM-voiced for D141's reason verbatim; an active-voice row under this
    // seat would credit the attacker with damaging itself.
    events.push({
      type: "COUNTERS_PLACED",
      seat: attackerSeat,
      uid: attackerUid,
      amount: koRecoil,
      source: "counterattack",
    });
  }

  // ⚠️ `attackerSeat` is passed ONLY here. It is what makes the attack epilogue
  // distinguishable from the Checkup and the mid-turn evolve sweep INSIDE
  // `collectKnockOuts` — the discrimination D158 got for free from placement and
  // Munkidori ex's Prize reduction (D164) cannot, because a prize is planned in
  // there rather than out here. The other two call sites deliberately omit it.
  const batch = collectKnockOuts(
    next,
    [otherSeat(attackerSeat), attackerSeat],
    events,
    attackerSeat,
    attackerUid,
  );
  if (batch.done !== null) return finishGame(batch.state, batch.done, events);
  // 🆕 🛑 **D312 — THE §8.1 PROMOTION SEAM AT ITS *SECOND* SITE, AND IT IS THE
  // SAME QUEUEING SEAM D311 PUT IN `resolveMidTurnKnockOuts` ABOVE.** An ATTACK
  // whose program removes its own actor (Gholdengo `sv08-131` "Surf Back",
  // `returnSelf`) leaves `attackerSeat`'s Active Spot empty with **no Knock Out to
  // explain it**, and this function reaches `collectKnockOuts` DIRECTLY — it never
  // passes through `resolveMidTurnKnockOuts`, so D311's sweep cannot see it.
  //
  // ⚠️ **THE SECOND SITE IS NOT MORE EXPENSIVE THAN THE FIRST, AND THAT WAS
  // MEASURED RATHER THAN HOPED.** The filter, the `.map` and the `promote` stage
  // are byte-for-byte D311's; `PendingStage {kind:"promote"}` is still TOTAL over
  // the three boards it can meet (pops on a refilled spot, auto-resolves a Bench
  // of one, falls into the §14.2 loss on a Bench of none) and gains nothing here.
  // **The whole difference between the two sites is the TAIL behind the splice**,
  // and the difference is what makes this one correct: D311's stages sit in front
  // of `{kind:"resumeTurn"}` because the actor keeps playing, and these sit in
  // front of `turnTail(attackerSeat)` because §8.1's promotion is owed BEFORE the
  // turn ends — a player does not hand over a board with an empty Active Spot.
  //
  // ⚠️ **AND THE SEATS ARE THE SWEEP'S OWN SEATS**, `[defender, attacker]`, for
  // `resolveMidTurnKnockOuts`' reason verbatim: only the attacker's board can be
  // emptied this way today (`returnSelf` reads `ctx.sourceRef`), scanning the
  // defender's too is a harmless superset, and a future op that bounces the
  // opponent's Active is then correct by construction rather than by this comment.
  //
  // ⚠️ **A SEAT THE KO BATCH ALREADY NAMED IS SKIPPED** — same term, same reason:
  // `collectKnockOuts` empties the spot it kills, so every KO'd Active would match
  // this predicate too and take a SECOND, unreadable promotion. And note the
  // interaction this site has that D311's does not: an attack can KO the DEFENDER
  // and remove the ATTACKER in one resolution, which is exactly the board where a
  // naive predicate queues two promotions for one seat and none for the other.
  const orphaned = orphanedPromotions(
    batch.state,
    [otherSeat(attackerSeat), attackerSeat],
    batch.stages,
  );
  // §5.3 — attacking ends the turn, through the same staged tail as a pass.
  // COMPOSES with whatever is still queued rather than overwriting it: both
  // callers hand over an empty queue (turn:action never carries a tail, and the
  // attackEpilogue case pops its own stage first), so this is behaviour-identical
  // — but it makes that pop LOAD-BEARING instead of merely tidy. Overwriting hid
  // a missing pop, which is exactly the kind of mistake the queue should surface.
  const pending: PendingStage[] = [
    ...batch.stages,
    ...orphaned,
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
  // §12 (D174) — restore the RECOVERY invariant before anything else looks at the
  // board. Every op that can put an Energy onto a body (`attachEnergyFrom`,
  // `attachFromDeck`, `attachFromTop`) or move one between bodies (`moveEnergy`)
  // runs inside a program, so this ONE line is total over the interpreter where four
  // separate call sites would have been a list to keep up to date (D169's lesson: a
  // seam is cheaper than an enumeration). The op list IS complete — `discardEnergy`
  // is the only other Energy op and it REMOVES, which can never create a condition a
  // live source should have cleared.
  //
  // ⚠️ "AND EVERY PROGRAM LANDS HERE" WAS THE HALF THAT WAS NOT TRUE, AND D176 MADE
  // IT SO RATHER THAN RESTATING IT. Eight of the nine `runProgram` call sites fold
  // through this function; triggers.ts `runCheckupTriggers` is the ninth and takes
  // `.state` inline, deliberately, because a betweenTurns program may not park. It
  // now calls `recoverStatuses` itself at the same moment, so the invariant is a
  // property of PROGRAM COMPLETION and not of which runner happened to be used. It runs
  // ahead of the branch rather than inside it so a program that PARKS after
  // attaching does not carry the stale condition across the player's decision.
  const settled = recoverStatuses(result.state, events);
  if (result.kind === "parked") {
    // EFFECT_PENDING's seat is the seat that MUST RESOLVE the decision (its own
    // doc) — the park's decider when one is named (opponentMayDraw: Ortega's
    // "your opponent may"), else the controller, which is who it always was.
    events.push({ type: "EFFECT_PENDING", seat: result.decider ?? controller, note: result.prompt.note });
    return ok(
      {
        ...settled,
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
  if (opts.resumeTail === true) return advance(settled, events);
  // An Ability that ends the turn (Koraidon "Dino Cry") seeds the turn tail
  // instead of returning to turn:action. Its program does not damage, so no
  // mid-turn KO sweep is owed — the tail's Checkup handles between-turns KOs.
  if (opts.endsTurn === true) {
    return advance({ ...settled, pending: turnTail(controller) }, events);
  }
  const resumed: GameState = { ...settled, phase: { kind: "turn:action", seat: controller } };
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

/** D171 — run the `onAllyActiveKnockOut` program of a POKÉMON TOOL on `koedSeat`'s
    board, because that seat's Active `uid` is about to be Knocked Out by the
    opponent's attack (Exp. Share sv01-174: "When your Active Pokémon is Knocked Out
    by damage from an attack from your opponent's Pokémon, you may move a Basic
    Energy from that Pokémon to the Pokémon this card is attached to"). The third
    sibling of runKoTrigger / runDamagedTrigger, and the first whose `uid` is NOT the
    body whose card runs — the bearer is a SURVIVING Pokémon found by re-scanning the
    board (triggers.ts `koToolTriggersOf`).

    ⚠️ THE PLACEMENT IS THE WHOLE DESIGN, AND IT IS A TEMPORAL FACT RATHER THAN A
    TASTE. This stage sits AHEAD of `attackEpilogue`, so it runs BEFORE
    `finishAttack` → `collectKnockOuts` → `knockOut`, which does
    `discardFromStack(side, side.active, "all")`. Every `koTrigger` is queued by
    `collectKnockOuts` AFTER that discard has already happened for the whole batch —
    so the Energy this sentence moves would be in the discard pile by the time a
    `koTrigger` could look for it. `koRecoilOf` IS a genuine before-`knockOut` hook
    and is deliberately ahead of the sweep for a related reason, but it is
    SYNCHRONOUS and cannot park; this consequent is a player's choice. Right point,
    wrong mechanism — hence a stage of `runDamagedTrigger`'s shape instead.

    ⚠️ AND EVERY CLAUSE OF THE ANTECEDENT IS ANSWERED HERE, NOT AT THE SEED —
    because the stage is seeded at DAMAGE time and the printed condition is
    LETHALITY, which is knowable only after the attack's own effect program has run.
    That is `damagedByAttackAbility`'s idiom ("re-derive the printed clause at the
    point where it is answerable") carried one step further: this runner remembers
    NOTHING from the seed except the seat.

      • "your ACTIVE Pokémon" — read off the live board. The subject is whatever is
        in the spot NOW, which is what the present tense says; carrying a uid from
        damage time would be a second opinion that can disagree with the sweep.
      • "is Knocked Out" — `isLethallyDamaged`, the sweep's OWN predicate, so "this
        will die" here cannot drift from what `collectKnockOuts` decides two stages
        later (`koRecoilOf`'s rule, read from the other end). An attack that dealt
        no lethal damage seeds the stage and then does nothing with it.
      • "by damage from an attack from your OPPONENT'S Pokémon" — discharged by
        PLACEMENT, exactly as D158 discharged it: only attack.ts seeds this stage,
        and only for the DEFENDER's seat. The Checkup and the mid-turn sweep call
        `collectKnockOuts` directly and can never reach here.

    Fires the FIRST match (§7.4 allows one Tool per Pokémon; several holders on one
    board would each print their own sentence, and chaining a second PARKING trigger
    behind the first is the same follow-up the board triggers already defer).
    `sourceUid` is the TOOL's uid, not the holder's — the program's route resolves
    "the Pokémon this card is attached to" from it, which is the phrase a Tool
    prints where a Pokémon prints "this Pokémon". No ABILITY_TRIGGERED row: a Tool
    has no Ability to trigger (log.ts says so at the neighbouring recoil arm), so
    the prompt and the ENERGY_MOVED row are the whole of what a reader is told. */
function runKoToolTrigger(state: GameState, koedSeat: Seat, events: GameEvent[]): ApplyResult {
  const active = state.players[koedSeat].active;
  if (active === null || !isLethallyDamaged(state, active)) return advance(state, events);
  const uid = topUid(active);
  if (uid === undefined) return advance(state, events);
  const entry = koToolTriggersOf(state, koedSeat, uid)[0];
  if (entry === undefined || entry.ability.program.length === 0) return advance(state, events);
  return settleProgram(
    runProgram(state, entry.ability.program, { seat: koedSeat, sourceUid: entry.toolUid }, events),
    koedSeat,
    events,
    { resumeTail: true },
  );
}

/** §12 RECOVERY (D174) — restore the invariant *no in-play Pokémon carries a
    Special Condition that a live continuous effect recovers it from*, clearing
    whatever it finds and announcing it as STATUS_CLEARED / "recovered". Today the
    only printing is Therapeutic Energy sv02-193 ("The Pokémon this card is
    attached to RECOVERS FROM BEING Asleep, Confused, or Paralyzed…"); the function
    reads `passivesOf().statusRecovery`, which folds the top card's own passive and
    every attached Tool's as well as the Energy's, so a Tool or an Ability printing
    the same clause is READ for free.

    ⚠️ THE READ WAS FREE AND THE MOMENT WAS NOT — D174 SAID "FOR FREE" FLAT AND WAS
    WRONG ABOUT TOOLS. A recovery source has to be swept at the moment it NEWLY
    covers a body, and a Tool arrives through cardplay.ts `attachTool`, which returns
    `ok` without running a program. D176 added the call there (see the moments below).
    The ABILITY half survived unaided, for a reason worth stating rather than
    trusting: every route by which a body comes to carry its own printed passive —
    evolution (turn.ts), a promotion, a switch (interpreter.ts `switchInto`) — runs
    through `noConditions()`, so there is nothing left to recover from. The one
    uncovered Ability moment is a §9 LOCK ENDING over a holder that acquired a
    condition while suppressed, which no card in the pool can reach.

    ⚠️ WHY THIS IS NOT SIMPLY ANOTHER `applyStatus` GATE, WHICH IS THE DESIGN
    DECISION AND NOT AN IMPLEMENTATION DETAIL. The card prints TWO clauses and they
    run in OPPOSITE DIRECTIONS in time. "…can't be affected by those Special
    Conditions" is a refusal at the moment of application and is exactly an
    `applyStatus` gate — it is `statusImmunities`, and it is where D172 left it.
    "…recovers from being" is about a condition that is ALREADY THERE, which no gate
    on the writer can ever see: by the time the Energy arrives, the write happened
    turns ago. A gate answers "may this land"; this answers "what is still true".

    ⚠️ AND IT IS A WRITE RATHER THAN A DERIVED VIEW, WHICH IS THE OTHER TEMPTATION.
    The engine's idiom for a continuous effect is to DERIVE at the read site
    (`effectiveMaxHp`, `effectiveRetreatCost`, `effectiveAttackCost`) precisely so a
    cached value cannot go stale — D172 refused a cached "cannot be Burned" flag on
    `InPlayPokemon` for that reason. A derived `effectiveConditionsOf` would be
    WRONG here, and the printed word says why: "recovers" is a ONE-WAY change. A
    Pokémon that recovered from Sleep is not Asleep again when the Energy is
    discarded or moved away, but a subtraction at the read sites would bring it
    straight back. So the condition really is removed, and staleness is impossible
    for the opposite reason: there is nothing left to go stale.

    ⚠️ THE ACTIVE ONLY, AND THAT IS A CLAIM ABOUT THE ENGINE RATHER THAN A
    SHORTCUT. `applyStatus` resolves only to `players[seat].active`, and every route
    OFF the Active Spot (retreat, a forced switch, evolution, a promotion into an
    empty spot) runs through `noConditions()`. So a benched body's `conditions` is
    the zero value on every reachable board, and a bench arm here would be a branch
    no test could witness (D154). Asserted over the board in
    therapeuticEnergy.test.ts rather than trusted.

    Called at the FOUR moments a recovery source can NEWLY cover a body:
      • the §6.2 manual Energy attach (turn.ts `attachEnergy`);
      • the §7.4 TOOL attach (cardplay.ts `attachTool`, D176) — no program runs, so
        it cannot arrive by either seam below;
      • the completion of any effect program through `settleProgram` below (which
        covers `attachEnergyFrom`, `attachFromDeck`, `attachFromTop`, `moveEnergy`);
      • the completion of a betweenTurns program (triggers.ts `runCheckupTriggers`,
        D176) — the one program runner that cannot fold through `settleProgram`,
        because a Checkup trigger may not park.
    Naming the moments is §8.1's own arrangement — `collectKnockOuts` is called at
    three named moments and not globally — and idempotent, so a moment named twice
    costs nothing but a scan. */
export function recoverStatuses(state: GameState, events: GameEvent[]): GameState {
  let next = state;
  for (const seat of SEATS) {
    const active = next.players[seat].active;
    if (active === null) continue;
    const recovers = passivesOf(next, active).statusRecovery;
    if (recovers.length === 0) continue;
    const cleared = presentStatuses(active.conditions).filter((status) =>
      recovers.includes(status),
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

  // 🆕🆕 §13/D434 — THE DELAYED COUNTER PLACEMENT, AND IT RUNS FIRST.
  //
  // *"At the end of your opponent's next turn, put 9 damage counters on the
  // Defending Pokémon."* (3 legal printings, corpus row 54). `scheduleCounters`
  // (interpreter.ts) stamped `state.turn + 1` onto the Defending Pokémon a turn ago;
  // this block is the half that makes the stamp mean anything.
  //
  // 🛑 **WHY BEFORE §13.1, AND IT IS A DECISION RATHER THAN AN ACCIDENT.** The
  // printed clock is *"at the END OF"* the turn; Poison, Burn and Sleep all print
  // *"During Pokémon Checkup"*, which is the step AFTER the turn has ended
  // (docs/reference/ptcg-rules.md §13: the Checkup "runs between turns — after the
  // current player's turn ends"). Placing this first is the only order in which both
  // printed clocks are honoured in their printed sequence; any other placement puts
  // a during-Checkup effect ahead of an end-of-turn one.
  //
  // ⚠️ THE ORDER HAS EXACTLY TWO OBSERVABLE CONSEQUENCES, AND ONLY ONE OF THEM IS
  // DRIVEN — WHICH IS SAID RATHER THAN SKIPPED (D130/D205). Damage is additive and
  // commutative and the KO is resolved for the whole batch at the bottom of this
  // function, so the ordering canNOT change whether the body dies. It changes:
  //   (1) the EVENT SEQUENCE, which is what a player reads — DRIVEN, in
  //       `delayedCounters.test.ts` §5, on a body that is Poisoned, Burned and
  //       Asleep at once, and by the mutant `D434-fires-after-the-condition-steps`
  //       which swaps this block with §13.1 and leaves every board identical;
  //   (2) the board `runCheckupTriggers` is handed further down — Garganacl
  //       "Blessed Salt" heals 20 from each of its controller's Pokémon during the
  //       Checkup, so counters placed HERE can be partly healed and counters placed
  //       after it could not. **NOT DRIVEN**: it needs that card on the victim's
  //       board, which is a fixture this suite does not carry. The falsifier is one
  //       deck entry away, and the claim is marked as reasoning rather than as a
  //       measurement.
  // Running first is the reading in which an end-of-turn placement can be answered
  // by a during-Checkup heal, which is the sequence the two printed clocks describe.
  //
  // ⚠️ `endedSeat` ONLY, AND THE ACTIVE ONLY. Both narrowings are the printed
  // sentence rather than an optimisation: *"your opponent's next turn"* names the
  // seat whose turn just ended, and *"the Defending Pokémon"* is a body that was in
  // the Active Spot — §10 sheds the schedule the moment it leaves (four literals,
  // `types.ts scheduledEffect`), so a BENCHED body can never carry one. The turn
  // stamp alone would in fact determine the seat, by a parity argument that is true
  // today and is exactly the kind of accident D430 was spent on: an attack stamps
  // `turn + 1` on its opponent, turns alternate, so only the seat owning turn T can
  // hold a stamp of T. **Both facts are printed, so both are spelled** — and a
  // wrong-seat build is then a red test rather than a coincidence.
  //
  // ⚠️ NOTHING IS CLEARED AFTER FIRING. The stamp expires by arithmetic
  // (`scheduledEffectDue`), which is `attackLockedTurn`'s rule: there is exactly
  // one Checkup per turn, so `=== next.turn` is true once and never again, and there
  // is no boundary write for anyone to forget. The §11 `retreatBlocked` walk 100
  // lines below is the engine's ONE boundary-cleared rider and it is a boolean.
  //
  // 🆕🆕 **D435 — THREE PAYLOADS ON THIS ONE CLOCK, AND THE `switch` IS WHERE THE
  // FAMILY'S ONE REAL DISTINCTION LIVES: A KNOCK OUT PAYS A PRIZE AND A DISCARD DOES
  // NOT.** §8.1 (`docs/reference/ptcg-rules.md`) defines the Knock Out and then says
  // *"the player **who KO'd** the Pokémon takes prize card(s)"* — the Prize is owed by
  // the Knock Out and by nothing else in the rules. Corpus row 53 prints *discard* and
  // Knocks nothing Out; corpus row 113 prints *"will be Knocked Out"*. On the board
  // the two are indistinguishable — the body leaves play, the Active Spot empties, a
  // promotion is owed — and they differ on exactly one row of the prize track. Two
  // arms, two shipped seams, no shared "remove the body" helper between them: the
  // discard reaches `discardFromStack` (§8.1's own cleanup move, minus §8.1) and the
  // Knock Out reaches §8.1's SWEEP at the bottom of this function.
  //
  // ⚠️ **THE ORDERING AGAINST §13.1 IS OBSERVABLE FOR THESE TWO IN A WAY IT WAS NOT
  // FOR D434's COUNTERS, AND THAT IS DRIVEN RATHER THAN NOTED.** D434 could only
  // assert a SEQUENCE, because damage is commutative and the KO is resolved for the
  // whole batch below. A DISCARDED body is GONE before §13.1 reads the spot, so a
  // Poisoned victim files no `source: "poison"` row at all and takes no poison damage
  // — a BOARD difference, not merely a log one. A DOOMED body is still standing (this
  // engine marks; §8.1 kills), so Poison lands on it and the row is filed; harmless,
  // and asserted so that "marks rather than kills" cannot quietly become "kills".
  //
  // ── (a) THE DISCARD PAYLOAD (corpus row 53) ────────────────────────────────
  //
  // 🛑 **`discardFromStack(…, "all")` IS THE MOVE, AND THE TWO PRECEDENTS WERE CHECKED
  // AGAINST EACH OTHER RATHER THAN ONE COPIED (D433).** *"and all attached cards"* has
  // to name a set, and three shipped literals could have supplied one: §8.1's
  // `knockOut` (this file), `returnSelf` with `dest: "discard"` (interpreter.ts, D313,
  // Revavroom ex's *"Discard this Pokémon and all attached cards."*) and `devolveEach`
  // (D433). The first two AGREE to the byte — the set is `stackUids` =
  // `[...stack, ...energy, ...tools]`, evolution stack bottom→top then Energy then
  // Tools, appended to the OWNER's pile in §2's order. `devolveEach` is not a third
  // opinion at all: it moves ONE evolution card and never touches an attachment, so it
  // is not a precedent for this sentence. That is a finding rather than an omission.
  //
  // ⚠️ **`POKEMON_RETURNED` AND NOT A NEW EVENT, AND CERTAINLY NOT `KNOCKED_OUT`.**
  // D299's row is the engine's *"a body left play without being Knocked Out"* row and
  // already carries the two facts this needs: `seat` OWNS the body, `actor` DID it, and
  // here they differ exactly as they do on Illumise's printing. Emitting `KNOCKED_OUT`
  // would be the lie this whole family is about.
  //
  // ⚠️ **AND THE PROMOTION IS OWED** — the spot is now empty with no Knock Out to
  // explain it, which is `orphanedPromotions`' subject and the THIRD site of D311/D312's
  // seam, spliced in below.
  //
  // ── (b) THE KNOCK-OUT PAYLOAD (corpus row 113's tail) ──────────────────────
  //
  // 🛑 **IT MARKS AND THE SWEEP AT THE BOTTOM OF THIS FUNCTION KILLS** — `doomBodyAt`
  // (interpreter.ts), D345's argument inherited whole and now at its FOURTH caller
  // rather than its fourth copy. Killing here would need a fourth Prize plan, a fourth
  // whole-stack discard, a fourth `KNOCKED_OUT` and a fourth promotion, all of which
  // `collectKnockOuts` already owes this Checkup.
  //
  // ⚠️ **A CHECKUP-TRIGGERED HEAL BETWEEN THE MARK AND THE SWEEP CAN SAVE THE BODY, AND
  // THAT IS D434's UNDRIVEN ORDERING CONSEQUENCE ARRIVING AT A HIGHER STAKE — SAID
  // RATHER THAN SKIPPED.** `runCheckupTriggers` runs below this block, and Garganacl
  // "Blessed Salt" heals 20 from each of its controller's Pokémon; a doomed body healed
  // below `effectiveMaxHp` is not collected. NOT DRIVEN: it needs that card on the
  // victim's board, a fixture this suite does not carry, and the falsifier is one deck
  // entry away. The alternative — resolving the Knock Out inside this block — is the
  // fourth §8.1 copy the paragraph above refuses.
  //
  // ── (c) THE CAUSE, RE-DERIVED AND NOT INHERITED ───────────────────────────
  //
  // 🛑 **THE `koByEffect` MARKER IS RE-DERIVED FROM SCRATCH (D433's rule for a marker's
  // second producer).** D434 withheld it because its payload PLACES DAMAGE COUNTERS, so
  // its Knock Out genuinely is by damage and stamping would have denied Vengeful Punch a
  // recoil that is owed. **This payload places no damage at all** — D414's marker's exact
  // subject, *"lethal WITHOUT damage"* — so the reasoning does not transfer and the stamp
  // is owed.
  //
  // 🛑 **AND D433's `wasLethal` CONJUNCT *DOES* ARISE HERE, WHICH D434 NEVER HAD TO ASK.**
  // A body already lethally damaged when this fires WAS Knocked Out by damage, whatever
  // the appointment says; stamping it would deny a recoil that is genuinely owed. So the
  // marker is passed only when the body is not already lethal.
  //
  // ⚠️ **THE MARKER IS SEMANTICALLY OWED AND OBSERVATIONALLY INERT ON THIS PATH TODAY,
  // AND BOTH HALVES ARE STATED BECAUSE ONLY ONE IS A MEASUREMENT (D414).** Its two
  // readers are `byAttackFor` (this file — returns `false` outright when `attackerSeat`
  // is `undefined`, which the Checkup's `collectKnockOuts` call always leaves it) and
  // `koRecoilOf` (this file — called by `finishAttack` alone, which this path never
  // reaches). So no board today distinguishes the stamped build from the unstamped one.
  // It is stamped anyway, because the alternative is a body whose lethality is an
  // effect's doing carrying — by ABSENCE — the mark that says it was damage's, which is
  // precisely the closed-world assumption D414 was spent removing. The corresponding
  // mutant row is DECLARED `equivalent` rather than expected to die, so the day a third
  // reader or a Checkup-side `attackerSeat` appears it reports `STALE-SURVIVOR` and
  // fails the run (D427).
  {
    const spot = activeTop(next, endedSeat);
    const due = spot === null ? null : scheduledEffectDue(spot.active, next.turn);
    if (spot !== null && due !== null) {
      const { active, uid } = spot;
      switch (due.kind) {
        // D434 — counters. §12's one-counter-is-10 conversion happened at the ARM.
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
        // 🆕🆕 D435 — the DISCARD (corpus row 53). NO Prize; see (a) above.
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
        // 🆕🆕 D435 — the KNOCK OUT (corpus row 113's tail). §8.1 IN FULL, Prize
        // included, and not one line of it written here; see (b) and (c) above.
        case "knockOut": {
          const marker = isLethallyDamaged(next, active) ? undefined : koByEffectMarker(next.turn);
          next = doomBodyAt(next, { seat: endedSeat, spot: { spot: "active" } }, marker);
          break;
        }
      }
    }
  }

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
  // 🆕🆕 **D435 — THE §8.1 PROMOTION SEAM AT ITS *THIRD* SITE, WHICH D312 PREDICTED
  // AND NAMED.** Until this slice, an Active Spot could only be empty at this line
  // because something died, and `collectKnockOuts` queues that seat's promotion
  // itself. The delayed DISCARD payload (corpus row 53) is the first thing in this
  // engine that empties a spot **during the Checkup** with no Knock Out to explain
  // it — and the next thing in the queue is the OTHER seat's `startTurn`, so without
  // this the victim would face an attack with no Active Pokémon at all, and a victim
  // with an empty Bench would never reach the §14.2 loss they are owed.
  //
  // ⚠️ **`order` AND NOT `[endedSeat]`**, `finishAttack`'s reason verbatim: only the
  // ended seat's spot can be emptied this way today (the schedule is `endedSeat`'s by
  // construction — see the block above), scanning both is a harmless superset, and a
  // future payload that removes the other side's Active is then correct by
  // construction rather than by this comment.
  //
  // ⚠️ **AND THE TAIL IS THE PENDING QUEUE ITSELF**, which is this site's one
  // difference from the other two (D312: *"the whole difference between the sites is
  // the TAIL behind the splice"*): the promotion is spliced in front of the
  // `startTurn` that was already queued, because §8.1 owes it before the next
  // player's turn begins.
  const orphaned = orphanedPromotions(batch.state, order, batch.stages);
  // Pop the checkup stage, put the KO stages in front of what remains
  // (the startTurn) and keep draining — a decision stage parks as usual.
  return advance(
    {
      ...batch.state,
      pending: [...batch.stages, ...orphaned, ...batch.state.pending.slice(1)],
    },
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
    case "koToolTrigger":
      // §8.1 (D171) — a Pokémon TOOL on the DEFENDER's surviving board reacting to
      // its own Active's imminent Knock Out (Exp. Share's Basic-Energy rescue). Pop
      // first, for the same resume-the-tail reason as the two stages above: the
      // attackEpilogue behind it is what drains — and what finally KOs the body this
      // stage just read the Energy off.
      return runKoToolTrigger(popStage(state), stage.seat, events);
    case "attackEpilogue":
      // §8 step 4 has finished (the effect program ran to completion, possibly
      // across one or more parks): sweep BOTH boards (a spread that KO'd the
      // defender, a recoil that KO'd the attacker) and end the attacker's turn.
      // The pop is REQUIRED — finishAttack composes with what is still queued, so
      // leaving this stage on would re-queue the epilogue behind the turn tail and
      // run the whole attack ending a second time.
      //
      // ⚠️ `stage.uid` — the attacker as it was at DECLARATION, carried across
      // however many parks the effect program took (D189). This is the path where
      // re-reading the spot is not merely fragile but WRONG: the program that just
      // finished is the one allowed to have moved its own actor.
      return finishAttack(popStage(state), events, stage.seat, stage.uid, stage.attack);
    case "startTurn":
      return startTurn(popStage(state), stage.seat, events);
  }
}
