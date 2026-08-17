import type { ApplyResult } from "./actions";
import { ok } from "./actions";
import { topCardOf, topUid } from "./cards";
import { disabledAbilityUids } from "./continuous";
import type { GameEvent } from "./events";
import { recoverStatuses, settleProgram } from "./flow";
import { runProgram } from "./interpreter";
// 🆕 D320 — the "during their turn" clause. THE one exhaustive switch over
// `Phase`, never turn parity: phaseView.ts's own header forbids that shortcut,
// and it imports from here only as a TYPE, so this value import leaves no
// runtime cycle.
import { phaseViewOf } from "./phaseView";
import { programFor } from "./registry";
import type { TriggeredAbility, TriggerTiming } from "./registry";
import type { GameState, InPlayPokemon, PokemonTarget, Seat } from "./types";
import { otherSeat } from "./types";

// Triggered Abilities (§9, M4 slice 6) — the Abilities that FIRE on a game
// event rather than being player-activated. Three scan points are wired:
//   • onPlayToBench — a Basic played from hand onto the Bench during the
//     controller's turn (turn.ts playBasicToBench — NOT a setup placement,
//     which is a different handler and not "during your turn");
//   • onEvolve — the controller evolved one of their Pokémon (turn.ts evolve);
//   • betweenTurns — the Pokémon Checkup (§13, flow.ts runCheckup);
//   • onKnockOut — this Pokémon was Knocked Out (§8.1, flow.ts KO sweep). It
//     fires during the OPPONENT's turn, mid-KO-sweep. Its detection lives here
//     (onKnockOutTrigger, below) but the KO sweep in flow.ts drives it — a
//     coin-flip Prize guard (Glimmora) resolves inline in the sweep, and a
//     program that needs a decision runs as a koTrigger stage that folds
//     through settleProgram with `resumeTail` (park → resume the KO tail).
//
// 🆕 D319 — AND ONE SCAN DIRECTION, which is the axis none of the above varies
// on: every bullet there finds its Ability by reading the body the event
// happened to, and `runWatchedTriggers` (below) instead sweeps the OTHER seat's
// board when this seat evolves from hand or attaches an Energy from hand. The
// TIMING still names the moment (onEvolve, onEnergyAttach); `opponentAction`
// names whose action is watched.
//
// The board triggers (onPlayToBench/onEvolve) run during the controller's own
// turn, so they fold their program's result through the SHARED settleProgram
// (flow.ts) exactly like a Trainer/Ability: a decision PARKS on effect:choose
// and RESUMES to turn:action via resolveEffect (cardplay.ts), and a completed
// program that placed lethal damage (Hawlucha's "Flying Entry" snipe) resolves
// its Knock Out as a MID-TURN KO that hands the turn back to the actor.
// The betweenTurns triggers are NON-PARKING by construction (a heal-each / a
// fixed counter placement), so they run synchronously inside the one Checkup
// reduction — their KOs are swept by the Checkup's own collectKnockOuts (a
// between-turns Ability that needed a decision would be new machinery, parking
// mid-Checkup, deferred with on-KO).

/** The on-KO triggered Ability of the card `uid` names (§8.1), or undefined.
    Resolved through cardIdByUid → programFor, which stays valid AFTER the KO
    discarded the Pokémon (the id map is fixed for the whole game). Consulted by
    the flow.ts KO sweep, both to resolve a coin-flip Prize guard (Glimmora) and
    to run a parking on-KO program as a koTrigger stage. Representatives carry at
    most one on-KO Ability, so the first match is it. */
export function onKnockOutTrigger(state: GameState, uid: string): TriggeredAbility | undefined {
  const cardId = state.cardIdByUid[uid];
  if (cardId === undefined) return undefined;
  return (programFor(cardId)?.triggered ?? []).find((t) => t.trigger === "onKnockOut");
}

/** The triggered Abilities on the top card of `pokemon` matching `timing`,
    gated by each one's own `activeOnly` against whether the Pokémon is Active.

    🆕 D319 — AND PARTITIONED BY SCAN DIRECTION, WHICH IS WHY `watch` IS A
    PARAMETER AND NOT A FILTER APPLIED BY ONE CALLER. `"self"` yields the
    abilities that fire on their OWN controller's action (every timing before
    D319); `"opponent"` yields the ones that watch the other seat's
    (`TriggeredAbility.opponentAction`). The two sets are DISJOINT and each
    caller sees exactly one of them.

    🛑 THE PARTITION IS LOAD-BEARING IN THE `"self"` DIRECTION, and that is the
    live bug it prevents rather than a symmetry. Team Rocket's Ampharos is a
    Stage 2 carrying an `onEvolve` row, so the self scan — which runs on the very
    body that was just evolved — would find Ampharos's own trigger the moment its
    controller played it onto Flaaffy and put 4 damage counters on the Ampharos.
    Filtering in the opponent scan alone would leave that untouched. */
function triggersOf(
  state: GameState,
  pokemon: InPlayPokemon,
  timing: TriggerTiming,
  isActive: boolean,
  watch: "self" | "opponent",
): TriggeredAbility[] {
  const card = topCardOf(state, pokemon);
  if (card === undefined) return [];
  // §9 — a continuous Ability-lock aura suppresses this Pokémon's triggered
  // Abilities too (this is the single choke for onPlayToBench / onEvolve /
  // betweenTurns / onDamagedByAttack). The on-KO trigger (onKnockOutTrigger,
  // above) is deliberately NOT gated: it fires as the Pokémon leaves play.
  const uid = topUid(pokemon);
  if (uid !== undefined && disabledAbilityUids(state).has(uid)) return [];
  return (programFor(card.id)?.triggered ?? []).filter(
    (t) =>
      t.trigger === timing &&
      (t.activeOnly !== true || isActive) &&
      (t.opponentAction === true) === (watch === "opponent"),
  );
}

/** The Pokémon at `target` on `seat`'s board, or undefined when the spot is
    empty / the bench index is out of range (wire indices are checked upstream,
    but stay total). */
function pokemonAt(state: GameState, seat: Seat, target: PokemonTarget): InPlayPokemon | undefined {
  const side = state.players[seat];
  if (target.spot === "active") return side.active ?? undefined;
  return side.bench[target.index];
}

/** Run the triggered Ability that fires when the actor's own Pokémon at
    `target` was just played to the Bench / evolved (§9), and fold the result to
    a phase. Returns ok(state) unchanged when nothing fires — the caller
    (playBasicToBench / evolve) passes its board-action events straight through.
    Representative cards carry ONE triggered Ability per timing, so at most one
    program runs here; chaining several parking triggers on one card (a second
    would have to wait for the first to resolve) is a follow-up. */
export function runBoardTrigger(
  state: GameState,
  seat: Seat,
  target: PokemonTarget,
  timing: TriggerTiming,
  events: GameEvent[],
): ApplyResult {
  const pokemon = pokemonAt(state, seat, target);
  if (pokemon === undefined) return ok(state, events);
  const ability = triggersOf(state, pokemon, timing, target.spot === "active", "self")[0];
  if (ability === undefined) return ok(state, events);
  const uid = topUid(pokemon);
  if (uid === undefined) return ok(state, events);
  // Optional triggers auto-fire (see TriggeredAbility.optional) — the "up to"
  // search still lets the player take none, and the other representatives are
  // pure upside. A yes/no confirm for a downside trigger is the follow-up.
  events.push({ type: "ABILITY_TRIGGERED", seat, uid, ability: ability.name });
  return settleProgram(
    runProgram(state, ability.program, { seat, sourceUid: uid }, events),
    seat,
    events,
  );
}

/** 🆕 D319 — THE OPPONENT-ACTION SCAN, AND IT IS A DIRECTION RATHER THAN A
    TIMING. `actorSeat` has just performed a watched action (an evolve from hand,
    an Energy attach from hand) on the body `subjectUid`; this sweeps the OTHER
    seat's board — Active then Bench — for every triggered Ability that watches
    it, and runs each one's program. Returns the new state; the caller owns the
    Knock Out the placed counters may cause.

    ⚠️ IT IS THE FIRST SCAN IN THIS FILE THAT DOES NOT READ THE BODY THE EVENT
    HAPPENED TO. Every other detection here starts from the subject — `triggersOf`
    from the evolved/benched Pokémon, `onKnockOutTrigger` from the dying one,
    `damagedByAttackAbility` from the damaged Active. Here the subject is on one
    seat's board and every candidate BEARER is on the other, which is the same
    split `koToolTriggersOf` (D171) found between the sentence's subject and its
    bearer — arriving this time across the TABLE rather than across a Tool.

    🛑 NON-PARKING BY CONSTRUCTION, LIKE `runCheckupTriggers` AND FOR A SHARPER
    REASON: both representative sentences are a FIXED counter placement with no
    choice in them, and this fires in the MIDDLE of the other player's board
    action — parking here would suspend a turn that is not the parking player's.
    So it takes `.state` and, exactly as D176 requires of the one other inline
    runner, restores the per-program §12 invariant with `recoverStatuses` rather
    than routing through `settleProgram` (which owns parking, the KO tail and the
    phase, none of which this may touch).

    🛑 `doesNotStack` IS APPLIED HERE AND NOWHERE ELSE, because the clause is a
    fact about the SWEEP: *"The effect of Darkest Impulse doesn't stack."* means
    two Ampharos are one firing, so the ability NAME is remembered once it has
    fired. Gnawing Curse does NOT print the clause and two Gengar ex therefore
    place their counters twice — the same loop, told apart by the one flag. */
export function runWatchedTriggers(
  state: GameState,
  actorSeat: Seat,
  subjectUid: string,
  timing: TriggerTiming,
  events: GameEvent[],
  atMoment: GameState,
): GameState {
  return sweepTriggers(
    state,
    otherSeat(actorSeat),
    subjectUid,
    timing,
    "opponent",
    events,
    atMoment,
  );
}

/** 🆕 D356 — THE SELF DIRECTION OF THE SAME SWEEP, AND THE FIRST PRINTING TO
    POPULATE IT. Magearna `sv09-107` "Auto Heal": *"As long as this Pokémon is in
    the Active Spot, whenever **you** attach an Energy card from your hand to 1 of
    **your** Pokémon, heal 90 damage from that Pokémon."*

    `actorSeat` has just performed a watched action on the body `subjectUid`, and
    the bearer of the Ability is on `actorSeat`'s OWN board. That is the whole
    difference from `runWatchedTriggers` above, and it is why this is a second
    named entry point rather than a flag on that one: the doc comment there opens
    by claiming to be *"the first scan in this file that does not read the body
    the event happened to"*, and that claim is FALSE of this direction — here the
    subject and the bearer are on the same side of the table again. Two opposite
    claims want two names over one sweep, which is exactly what
    `runActiveBenchedTriggers` (D320) already does to `runWatchedTriggers`.

    🛑 IT IS NOT A NEW TRIGGER POINT, AND THE SOURCE SAID SO BEFORE THIS SLICE
    EXISTED. `onEnergyAttach` has been a `TriggerTiming` since D319, the moment is
    already fired at turn.ts's §6.2 attach, and `triggersOf`'s `watch` parameter
    has partitioned the two directions since D319 — whose own comment on the union
    member reads *"the self direction is spelled and unpopulated, exactly like a
    union member waiting for its first printing."* This is that printing. The
    price the two prior slices refused was the price of machinery that was already
    standing.

    🛑 NON-PARKING BY CONSTRUCTION, for `runWatchedTriggers`' reason and one more
    of its own: this fires MID-ACTION inside the actor's own turn, between the
    attach and the return to `turn:action`, so a park here would suspend a phase
    the caller is still holding. Today's one program is a clamped heal with no
    choice in it. */
export function runSelfWatchedTriggers(
  state: GameState,
  actorSeat: Seat,
  subjectUid: string,
  timing: TriggerTiming,
  events: GameEvent[],
  atMoment: GameState,
): GameState {
  return sweepTriggers(state, actorSeat, subjectUid, timing, "self", events, atMoment);
}

/** The shared board sweep both watched directions run — `watcher` is the seat
    whose board BEARS the Ability, and `watch` is the direction `triggersOf`
    partitions on. Split out at D356 when the self direction got its first
    printing; the body is D319's, unchanged.

    🆕🛑 D357 — `atMoment` IS THE BOARD AS IT STOOD AT THE INSTANT THE WATCHED
    ACTION HAPPENED, AND IT IS THE ONLY THING THE `activeOnly` GATE MAY READ.
    D356 gated on `target.spot === "active"` against the CURRENT board, which is
    the board AFTER §6.1's Jet Energy `switchIfBenched` rider has already moved a
    body into the Active Spot. That is a different board from the one the print
    names, and it was wrong in BOTH directions on real boards:

      • attaching Jet Energy to a BENCHED damaged Magearna promoted it and THEN
        fired Auto Heal — a heal off a bearer that was on the Bench at the moment
        the Energy was attached;
      • with Magearna ACTIVE, attaching Jet Energy to a damaged benched body
        DEMOTED Magearna first and the printed 90 heal was SILENTLY LOST.

    🛑 THE RULES QUESTION IS SETTLED FROM THE CATALOG, NOT FROM THE CODE, AND THE
    CATALOG ANSWERS IT IN PRINT. Every `activeOnly` sentence pairs the Active-Spot
    clause with the moment its consequent answers, and the one other TRIGGERED
    family that shares a moment with a board change spells the answer out:
    *"If this Pokémon **is in the Active Spot** and is damaged by an attack from
    your opponent's Pokémon (**even if this Pokémon is Knocked Out**) …"* — the
    parenthetical exists precisely to say that a board change ARRIVING WITH the
    trigger does not unmake a gate that held at the moment. The Checkup family
    (*"During Pokémon Checkup, if this Pokémon is in the Active Spot"*) names the
    gate and the moment in one breath for the same reason.

    🛑 AND `bodyHoldingEnergy` (turn.ts) ALREADY SAID SO ABOUT THIS EXACT RIDER,
    one clause to the left: it is keyed on the ENERGY rather than on the target
    spot so that it is *"right in both orders"*. Jet's switch and this trigger are
    two effects answering ONE moment, and which resolves first is the turn
    player's choice — so no reading that DEPENDS on that choice can be the
    printed one. `target.spot === "active"` was right under exactly one ordering.

    ⚠️ THE SUBJECT IS STILL READ OFF THE CURRENT BOARD AND MUST BE. *"that
    Pokémon"* corefers with the body the Energy landed on, and the Energy rides
    into the Active Spot with it — that is `bodyHoldingEnergy`'s whole design.
    **THE GATE AND THE REFERENT READ DIFFERENT BOARDS ON PURPOSE**: the gate is
    an antecedent (evaluated at the moment) and the referent is a pronoun
    (resolved when the consequent runs). Conflating them is the defect this
    parameter exists to prevent, in either direction.

    ⚠️ AND IT IS A UID COMPARISON RATHER THAN A SPOT COMPARISON, because a spot
    is a POSITION and the print names a BODY. Reading `atMoment`'s Active spot by
    position would still be a second board's opinion about which body is there. */
function sweepTriggers(
  state: GameState,
  watcher: Seat,
  subjectUid: string,
  timing: TriggerTiming,
  watch: "self" | "opponent",
  events: GameEvent[],
  atMoment: GameState,
): GameState {
  // Active, then each bench slot. The walk re-reads the CURRENT board each step
  // for `runCheckupTriggers`' reason — and the bench LENGTH cannot change here,
  // so the index walk is stable.
  const targets: PokemonTarget[] = [{ spot: "active" }];
  for (let index = 0; index < state.players[watcher].bench.length; index++) {
    targets.push({ spot: "bench", index });
  }
  // The body that was in the WATCHER's Active Spot at the watched moment, by uid.
  // `undefined` when that seat had no Active then — and a defined `uid` never
  // equals it, which is the right answer (nothing was in the Active Spot).
  const activeAtMoment = atMoment.players[watcher].active;
  const activeUidAtMoment = activeAtMoment === null ? undefined : topUid(activeAtMoment);
  const stacked = new Set<string>();
  let next = state;
  for (const target of targets) {
    const pokemon = pokemonAt(next, watcher, target);
    if (pokemon === undefined) continue;
    const uid = topUid(pokemon);
    if (uid === undefined) continue;
    for (const ability of triggersOf(next, pokemon, timing, uid === activeUidAtMoment, watch)) {
      if (stacked.has(ability.name)) continue;
      if (ability.doesNotStack === true) stacked.add(ability.name);
      events.push({ type: "ABILITY_TRIGGERED", seat: watcher, uid, ability: ability.name });
      next = recoverStatuses(
        runProgram(next, ability.program, { seat: watcher, sourceUid: uid, subjectUid }, events)
          .state,
        events,
      );
    }
  }
  return next;
}

/** 🆕 D320 — THE ACTIVE→BENCH MOVE, AND IT IS A SHARED CALL BECAUSE THE ENGINE
    HAS EXACTLY TWO OF THEM. Magcargo `sv05-029` "Lava Zone": *"Whenever your
    opponent's Active Pokémon moves to the Bench during their turn, their new
    Active Pokémon is now Burned."* `seat`'s Active has just gone to the Bench
    and `movedUid` is the body that went; the watcher is the other seat.

    🛑 **TWO SITES, AND THE FIRST DRAFT HAD ONE — WHICH WOULD HAVE SHIPPED THE
    SENTENCE'S MOST COMMON TRIGGER DEAD.** `switchInto` (interpreter.ts) looked
    like the sole funnel and its own doc comment names "three provenances at
    once", but the three it names are Switch/Escape Rope, Boss's Orders and Jet
    Energy — **RETREAT IS NOT AMONG THEM.** `retreat` (turn.ts) builds its own
    dense bench inline, because it also PAYS A COST out of the retreating body's
    attachments, and it emits `RETREATED` rather than `POKEMON_SWITCHED`. The
    two emit sites are the census: `grep 'type: "POKEMON_SWITCHED"' / 'type:
    "RETREATED"'` returns one apiece and nothing else. **A DOC COMMENT THAT
    ENUMERATES CALLERS IS A CLAIM ABOUT THE DAY IT WAS WRITTEN** — D313's rule,
    arriving as a comment rather than as a file.

    So the gate and the sweep live HERE, once, and both movers call it — D318's
    "share the code rather than widen the anchors" on a call graph instead of on
    a mutation anchor.

    🛑 *"DURING THEIR TURN"* IS `phaseViewOf`, THE ONE EXHAUSTIVE SWITCH OVER
    `Phase`, and never turn parity (phaseView.ts's header forbids exactly that
    shortcut, and a `ko:*` park is where it goes wrong). It is what makes a
    Boss's Orders played on YOUR turn — a `gust`, i.e. `switchInto` on the
    OTHER seat's board — leave Lava Zone silent, and that negative is the only
    thing separating this clause from no clause at all. At the retreat site the
    read cannot be false, which is fine: one caller of a shared gate proving it
    can go red is what makes it a gate rather than a decoration.

    ⚠️ THE `subjectUid` IS THE BODY THAT MOVED, NOT THE ONE THE CONSEQUENT ACTS
    ON. It names the body the watched action was performed on (D319); this
    sentence's consequent says *"their **new** Active Pokémon"* and reaches it
    through `applyStatus`'s `defender` arm, since `ctx.seat` in a watched
    trigger is the WATCHER. Passing the antecedent's real subject is the honest
    value even though no op in today's one program reads it. */
export function runActiveBenchedTriggers(
  state: GameState,
  seat: Seat,
  movedUid: string,
  events: GameEvent[],
): GameState {
  if (phaseViewOf(state, seat).activeSeat !== seat) return state;
  // 🆕 D357 — `state` IS the moment board here, and that is a MEASUREMENT rather
  // than a shrug: every mover that reaches this line (`switchInto`, `retreat`)
  // rearranges `seat`'s OWN board, and the watcher is `otherSeat(seat)`, whose
  // Active is untouched between the move and this sweep. There is no rider on
  // this moment the way §6.1's Jet switch rides the §6.2 attach.
  return runWatchedTriggers(state, seat, movedUid, "onActiveMovedToBench", events, state);
}

/** Run every betweenTurns triggered Ability in play during the Pokémon Checkup
    (§13), in `order` (the ended seat first), Active then Bench per seat. These
    are NON-PARKING by construction, so they apply synchronously and the state
    threads straight through — the Checkup's own KO sweep (flow.ts) resolves any
    Knock Out a placed counter caused. None changes the bench LENGTH (heal /
    counter only), so a per-seat index walk over the current board is stable. */
export function runCheckupTriggers(
  state: GameState,
  order: readonly Seat[],
  events: GameEvent[],
): GameState {
  let next = state;
  for (const seat of order) {
    // Active, then each bench slot — re-reading the CURRENT board each step,
    // since a heal/damage replaced the Pokémon object at that spot.
    const targets: PokemonTarget[] = [{ spot: "active" }];
    for (let index = 0; index < next.players[seat].bench.length; index++) {
      targets.push({ spot: "bench", index });
    }
    for (const target of targets) {
      const pokemon = pokemonAt(next, seat, target);
      if (pokemon === undefined) continue;
      const uid = topUid(pokemon);
      if (uid === undefined) continue;
      for (const ability of triggersOf(next, pokemon, "betweenTurns", target.spot === "active", "self")) {
        events.push({ type: "ABILITY_TRIGGERED", seat, uid, ability: ability.name });
        // Non-parking by construction — a betweenTurns program returns done, so
        // taking .state loses nothing (parking mid-Checkup is deferred).
        //
        // ⚠️ §12 (D176) — AND `recoverStatuses` IS EXACTLY WHAT TAKING `.state`
        // *DID* LOSE. This is the ONE runProgram site in the engine that does not
        // fold through flow.ts `settleProgram`, so D174's "every program lands
        // there" was true of eight call sites and false of this one. The fix is the
        // call rather than a route through settleProgram: that function returns an
        // ApplyResult and owns parking, the KO tail and the phase, none of which a
        // Checkup trigger may touch (the comment above is why). So the seam is
        // restored by naming the same moment here — the completion of an effect
        // program — and `recoverStatuses` is idempotent, so a Checkup with no
        // Energy op pays one scan of two Active spots and changes nothing.
        //
        // INSIDE the loop rather than after it, which is the whole point: the
        // invariant is per-PROGRAM, so a trigger that attaches an Energy cannot
        // leave a stale condition for the NEXT trigger in the same Checkup to read.
        // No betweenTurns program in the registry moves Energy today (Garganacl
        // heals, Trevenant places a counter), so this is latent — but `program` is
        // a plain EffectOp[] and nothing stops the next one from doing so.
        next = recoverStatuses(
          runProgram(next, ability.program, { seat, sourceUid: uid }, events).state,
          events,
        );
      }
    }
  }
  return next;
}

/** The `onDamagedByAttack` reactive Ability of the Active `uid` on `seat`'s board
    — the one a main-hit attack just DAMAGED (§9, Armarouge "Scorching Armor" Burns
    the attacker; Klawf ex "Counterattacking Pincer" discards its Energy). The
    §9 ability-lock is applied (through `triggersOf`, the single choke), and the
    `uid` must STILL be the Active — the caller seeds the damagedTrigger stage at
    damage time but it runs after the attack's own effect program, which could have
    switched the defender out (then the "in the Active Spot" clause no longer holds
    and this returns undefined). Representatives carry ONE such Ability, so the
    first match is it — the flow.ts twin of `onKnockOutTrigger`. Unlike D99's
    NON-PARKING inline runner, the program is now run by flow.ts `runDamagedTrigger`
    through settleProgram, so a PARKING discard (Klawf) survives the opponent's
    turn. It runs under the DAMAGED seat, so `discardEnergy from:"opponentActive"`
    (or `applyStatus target:"defender"`) reaches the ATTACKER's Active (`otherSeat`),
    matching "… from the Attacking Pokémon". */
export function damagedByAttackAbility(
  state: GameState,
  seat: Seat,
  uid: string,
): TriggeredAbility | undefined {
  const active = state.players[seat].active;
  if (active === null || topUid(active) !== uid) return undefined;
  return triggersOf(state, active, "onDamagedByAttack", true, "self")[0];
}

/** D171 — THE TOOL-BORNE ON-KO SCAN. Every `onAllyActiveKnockOut` program a
    POKÉMON TOOL on `seat`'s board carries, keyed on the KO of `koedUid` (that
    seat's Active). Returns, in board order, the Tool's own `uid` (the card whose
    sentence runs), the `holderUid` it is attached to, and the program.

    ⚠️ THIS IS A FOURTH DETECTION SITE, AND IT HAD TO BE — none of the three that
    existed can see this card, each for its own structural reason:

      • `onKnockOutTrigger` (above) reads `cardIdByUid[uid]` of the KO'd body's TOP
        CARD. Exp. Share's holder is a body that SURVIVES; the dying one is only
        the Energy's source. Wrong body, and it never looks at tools anyway.
      • `triggersOf` (above) reads `topCardOf(pokemon)`. A Tool is not the top card
        — it is not in the evolution stack at all — so this misses every Tool by
        construction, for every timing.
      • `passivesOf` (continuous.ts) IS the only existing site that walks
        `pokemon.tools`, and that is exactly why Vengeful Punch was a data row and
        this is not: it folds `programFor(id)?.passive` into NUMBERS, one seat-free
        sum per field. It has no way to express a program, a park or a controller.

    Two deliberate refusals, each a line of the printed sentence:

      • THE KO'D BODY IS SKIPPED. "…move a Basic Energy from THAT Pokémon to THE
        POKÉMON THIS CARD IS ATTACHED TO" names two Pokémon. An Exp. Share on the
        dying Active names one, has no destination distinct from its source, and is
        in the same discard-bound stack as the Energy — so it is not a holder here.
      • NO §9 GATE. `triggersOf` suppresses a locked Pokémon's triggered Abilities;
        this scan deliberately does not, because a TOOL IS NOT AN ABILITY —
        `passivesOf` states the same rule for the same reason ("a locked Pokémon's
        own printed passive is suppressed; its Tools are not Abilities and keep
        contributing"). A Klefki aura over the holder leaves Exp. Share working,
        and that negative is driven.

    Read by flow.ts (`runKoToolTrigger`, which fires the first match) and by
    attack.ts (presence alone, to decide whether to seed the stage at all — so an
    attack into a board with no such Tool keeps its exact pre-D171 pending queue). */
export function koToolTriggersOf(
  state: GameState,
  seat: Seat,
  koedUid: string,
): { toolUid: string; holderUid: string; ability: TriggeredAbility }[] {
  const side = state.players[seat];
  const out: { toolUid: string; holderUid: string; ability: TriggeredAbility }[] = [];
  const bodies = side.active === null ? side.bench : [side.active, ...side.bench];
  for (const body of bodies) {
    const holderUid = topUid(body);
    if (holderUid === undefined || holderUid === koedUid) continue;
    for (const toolUid of body.tools) {
      const id = state.cardIdByUid[toolUid];
      if (id === undefined) continue;
      for (const ability of programFor(id)?.triggered ?? []) {
        if (ability.trigger !== "onAllyActiveKnockOut") continue;
        out.push({ toolUid, holderUid, ability });
      }
    }
  }
  return out;
}
