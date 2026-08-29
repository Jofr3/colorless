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
import {
  aceSpecPlayBarred,
  effectiveRetreatCost,
  opposingRetreatBlocked,
  pokemonPlayBarred,
  retreatLocked,
} from "./continuous";
import type { GameEvent } from "./events";
import {
  advance,
  isLethallyDamaged,
  recoverStatuses,
  resolveMidTurnKnockOuts,
  turnTail,
} from "./flow";
import { evolveEarlyLicensed, switchInto } from "./interpreter";
import { programFor } from "./registry";
import {
  runActiveBenchedTriggers,
  runBoardTrigger,
  runSelfWatchedTriggers,
  runWatchedTriggers,
} from "./triggers";
import type { GameState, InPlayPokemon, PlayerSide, PokemonTarget, Seat } from "./types";
import {
  BENCH_MAX,
  discardFromStack,
  drawToHand,
  evolveOnto,
  isFirstTurnOf,
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
  // §6.2/§7.4 (D292) — THE ENERGY SURFACE'S ONLY HAND-PLAY BAR, and the eighth
  // read site of this family. Genesect `sv06.5-040` "ACE Nullifier" prints *"your
  // opponent can't play any ACE SPEC cards from their hand"* — **any**, with no
  // class word — and the catalog holds THREE ACE SPEC Special Energy printings
  // (`sv05-162` Neo Upper, `sv08-191` Enriching, `sv06-167` Legacy). Attaching an
  // Energy from hand IS playing that card, so this is the surface D291 measured
  // itself missing and asserted as an absence in `aceSpecBar.test.ts` §5.
  //
  // 🛑 `aceSpecPlayBarred` AND NOT `handPlayBarred`, WHICH IS THE WHOLE DESIGN
  // CALL OF THIS SLICE. `handPlayBarred` demands a `HandPlayClass`, and that union
  // is exactly `Card.trainerType` (D287) — NULL on all three printings. Passing
  // `"Item"` here would have WORKED (both class-keyed sources answer `false` for an
  // Energy on every board) and would have been a LIE the compiler could never
  // catch: the day a stamp or an Active bar names `"Item"`, this line would refuse
  // a perfectly legal Energy attach and every ACE SPEC test in the repo would stay
  // green. The rarity term is EXTRACTED instead, so this site asks the question it
  // actually means and no class word is invented for it.
  //
  // 🛑 **AND "THE COMPILER COULD NEVER CATCH IT" IS A MEASUREMENT, NOT A WORRY.**
  // The lie was PERFORMED — `handPlayBarred(state, action.seat, "Item", card)`
  // substituted here, imported, run — and left **4,747 of 4,747 engine tests
  // GREEN, 0 assertions moved**, then undone by inverse substitution. **NO BOARD
  // THIS CATALOG CAN BUILD SEPARATES THE TWO READERS**, which is exactly why the
  // choice had to be made on DESIGN grounds and why it is recorded HERE rather
  // than as a mutant row: a row would have claimed the suite misses a line it
  // cannot miss (D288's "a decision, not a behaviour"). The day the lie becomes
  // observable is the day it silently breaks, and by then nothing else would have
  // said it was a lie.
  //
  // ⚠️ ORDER — BELOW §6.2's once-per-turn allowance and below the three card
  // facts, ABOVE the target checks. `playTrainer`'s rule for the first half (the
  // allowance is the player's OWN limit and is entitled to name itself; a barred
  // seat learns the bar only once its own play was otherwise legal) and
  // `playStadium`'s stated INVERSION for the second (everything below is a fact
  // about the TARGET rather than a rule the player broke, and a barred seat has no
  // business being told "no benched Pokémon at index 3" about a play the rules
  // never let it attempt). `energyAttached` is NOT spent by a refusal — the card
  // never leaves hand, exactly as a barred evolve costs nothing.
  if (aceSpecPlayBarred(state, action.seat, card)) {
    return err(
      "HAND_PLAY_BLOCKED",
      "your opponent prevents you from playing ACE SPEC cards from your hand",
    );
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
  // 🆕🛑 D357 — THE BOARD AT THE INSTANT OF THE ATTACH, CAPTURED BEFORE ANY §6.1
  // RIDER RUNS. Every watched trigger fired at the bottom of this handler names
  // THIS moment in its antecedent, and one of them — Magearna's *"As long as this
  // Pokémon is in the Active Spot"* — is GATED on where a body stood when the
  // Energy was attached. §6.1's Jet Energy switch is a rider on this same moment,
  // not a later action, so reading the gate off the post-switch board answers a
  // question nobody asked.
  //
  // ⚠️ IT MUST BE CAPTURED HERE AND NOT AT THE TOP: the Energy has already left
  // the hand and landed on its target in `next`, which is exactly right — the
  // moment the clause names is the moment the attach COMPLETED, and the rider is
  // what happens next. One line earlier would be the board BEFORE the attach, a
  // third board and the wrong one again.
  const atAttach = next;
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
  // D261 — the §6.1 union's SECOND arm: Enriching Energy sv08-191, "When you
  // attach this card from your hand to a Pokémon, draw 4 cards." A GUARD and not a
  // FILTER, because the clause names ONE seat and ONE moment and there is no set
  // to narrow.
  //
  // 🛑 NO `spot` CONJUNCT, WHICH IS THE ONE THING THIS ARM MUST NOT INHERIT FROM
  // THE ONE ABOVE IT. Jet prints "to 1 of your Benched Pokémon" and is guarded
  // accordingly; this sentence prints "to a Pokémon", so the guard is the arm tag
  // and nothing else. Both spots are driven in `mistEnergy.test.ts`.
  //
  // ⚠️ THE COUNT COMES OFF THE REGISTRY ROW, and the six guards above the attach
  // are all inherited unchanged: this is a RIDER on the §6.2 attach, so a rejected
  // attach draws nothing without the arm having to say so (D169's early-return
  // audit, re-read at this line and still clean — every one of those guards is a
  // condition under which no Energy moves at all, which is exactly when there is
  // nothing to have attached FROM HAND).
  if (onAttach?.kind === "draw") {
    next = drawToHand(next, action.seat, onAttach.count, "effect", events);
  }
  // §12 (D174) — the §6.2 attach is the ONE route by which an Energy reaches a body
  // outside an effect program (flow.ts settleProgram covers every other), and it is
  // the printed use of Therapeutic Energy sv02-193: attach it to your Paralyzed
  // Active and it "recovers from being … Paralyzed" on the spot, in time to attack
  // this turn. Placed at the very END, after the Jet switch: `switchInto` clears
  // conditions on its own (§11/§12), so a card printing both clauses must not have
  // this fire first and report a recovery the switch was going to perform anyway.
  //
  // ⚠️ THE EARLY-RETURN AUDIT (D169's lesson, FOURTH sighting). Six guards sit ahead
  // of this line — `turnGate`, the §6.2 allowance, card-in-hand, unknown-card,
  // not-an-energy and the target checks — and EVERY ONE belongs to the ATTACH term
  // alone: they are the conditions under which no Energy moves at all, and no Energy
  // moving is exactly when there is nothing to recover from. There is no guard here
  // that belongs to one term and is being borrowed by the other, which is the shape
  // D169 / D171 found and D172 first came up clean on.
  next = recoverStatuses(next, events);
  // 🆕 D319 — Gengar ex sv05-104/-193 "Gnawing Curse": *"Whenever your opponent
  // attaches an Energy card **from their hand** to 1 of their Pokémon, put 2
  // damage counters on that Pokémon."* The source-zone clause is answered the
  // same way the evolve half answers it — by WHERE the scan sits. This is the
  // §6.2 hand attach and nothing else; `attachFromDeck`, `attachFromTop` and
  // `moveEnergy` are ops in the interpreter and never reach this line.
  //
  // ⚠️ THE SUBJECT IS A UID AND NOT `action.target`, which is what makes it
  // survive the Jet Energy switch above: that clause can move the body out of
  // the bench index the action named, and "that Pokémon" still means the body
  // the Energy landed on. `topUid` of the attach target, read AFTER the riders.
  const attachedTo = bodyHoldingEnergy(next, action.seat, action.uid);
  if (attachedTo !== undefined) {
    // 🆕 D356 — Magearna sv09-107 "Auto Heal": *"As long as this Pokémon is in the
    // Active Spot, whenever you attach an Energy card from your hand to 1 of your
    // Pokémon, heal 90 damage from that Pokémon."* THE SAME MOMENT, the other
    // direction — the bearer is on the ACTING seat's board, so it is the self
    // sweep. It reads the same `attachedTo` for the same reason (the Jet switch).
    //
    // 🛑 THE SELF SWEEP RUNS FIRST, AND THE ORDER IS OBSERVABLE. A board with
    // Magearna Active and the opponent's Gengar ex out fires BOTH on one attach,
    // and the heal is CLAMPED to the damage present — so healing before the 2
    // counters land is a different board from healing after. The turn player's
    // own effects resolve first when two triggers answer one moment, and the
    // attaching player is the turn player. Driven in `autoHeal.test.ts` §4.
    //
    // ⚠️ NO KO SWEEP OF ITS OWN. Every self-direction program printed today heals,
    // and a heal cannot Knock Out; the opponent-direction sweep below owns the
    // mid-turn KO because ITS consequent is damage counters.
    //
    // 🆕🛑 D357 — AND THE LAST ARGUMENT IS THE POINT OF THE REPAIR: the SUBJECT
    // (`attachedTo`) is read off the POST-rider board and the `activeOnly` GATE is
    // read off `atAttach`, the board at the moment. D356 passed only one board and
    // the gate silently borrowed the subject's. **AN ANTECEDENT AND A PRONOUN DO
    // NOT READ THE SAME BOARD** — the antecedent is fixed when the moment happens,
    // the pronoun is resolved when the consequent runs. Both Jet-Energy orderings
    // are driven in `autoHeal.test.ts` §5b.
    next = runSelfWatchedTriggers(
      next,
      action.seat,
      attachedTo,
      "onEnergyAttach",
      events,
      atAttach,
    );
    const watched = runWatchedTriggers(
      next,
      action.seat,
      attachedTo,
      "onEnergyAttach",
      events,
      atAttach,
    );
    if (watched !== next) {
      next = watched;
      // The counters can be lethal, and this is the acting seat's own board
      // mid-turn — `placeEvolution`'s sweep, for `placeEvolution`'s reason.
      return resolveMidTurnKnockOuts(next, action.seat, [action.seat], events);
    }
  }
  return ok(next, events);
}

/** 🆕 D319 — the top-card uid of the body on `seat`'s board that is CARRYING the
    Energy card `energyUid`, or undefined.

    🛑 KEYED ON THE ENERGY AND NOT ON `action.target`, and the difference is a
    live board rather than a nicety: Jet Energy's on-attach rider SWITCHES the
    benched body it landed on into the Active Spot, so by the time the watched
    trigger runs, `{ spot: "bench", index }` names a DIFFERENT Pokémon — the one
    that swapped out. The Energy, though, is on exactly one body, and that body is
    the printed *"1 of their Pokémon"* the counters are owed to. Reading the
    board for the card is therefore the only spelling that is right in both
    orders. */
function bodyHoldingEnergy(state: GameState, seat: Seat, energyUid: string): string | undefined {
  const side = state.players[seat];
  const bodies = side.active === null ? side.bench : [side.active, ...side.bench];
  for (const body of bodies) {
    if (body.energy.includes(energyUid)) return topUid(body);
  }
  return undefined;
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
  // §7.5 (D285) — THE FIRST READ SITE OF THE POKÉMON-SURFACE PLAY GATE, and the
  // one only the CONTINUOUS source reaches: Team Rocket's Arbok `sv10-113`
  // "Potent Glare" bars the PLAY, so it covers a bench placement, while Bronzong
  // `sv05-069`'s stamp names *"to evolve"* and cannot ("bench" is not a
  // `StampedPokemonPlayAct`). ⚠️ ONE PREDICATE FOR BOTH SOURCES —
  // `pokemonPlayBarred` (continuous.ts) ORs them, so this gate cannot fall behind
  // a third the way four hand-written ORs could.
  //
  // ⚠️ AFTER `basicFromHandError` AND AFTER `BENCH_FULL`, which is `playTrainer`'s
  // ordering rule and not a coincidence: those two are the player's OWN limits
  // (this card is not a Basic; your bench is full) and should name themselves,
  // and a barred seat learns the bar only once its own play was otherwise legal.
  // The card is resolved by that same guard, so the filtered noun is answerable.
  if (pokemonPlayBarred(state, action.seat, "bench", cardOfUid(state, action.uid))) {
    return err(
      "HAND_PLAY_BLOCKED",
      "your opponent prevents you from playing this Pokémon from your hand",
    );
  }

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
  // §4/§10 (D278; SEAT ADDED BY D279) — the TWO standing timing bans, and the ONE
  // printed sentence that lifts both. `evolveEarlyLicensed` (interpreter.ts) is
  // Eevee's "Boosted Evolution" (*"As long as this Pokémon is in the Active Spot,
  // it can evolve during your first turn OR THE TURN YOU PLAY IT."*) and
  // Karrablast/Shelmet's "Stimulated Evolution" (*"If you have Shelmet in play,
  // …"*) — one predicate, because the licensed FACT is identical and only the
  // antecedents differ. Asked ONCE, above both refusals, because one sentence
  // licenses both — a build that consulted it at only the first would be green on
  // every turn-1 board in this repo (a SETUP Pokémon carries turnPlayed 0, so ban
  // 2 does not fire there) and wrong on the turn you play it, the quiet direction.
  //
  // ⚠️ `action.seat` IS THE RIGHT SEAT AND IT IS NOT THE BODY'S OWN: "you have
  // Shelmet in play" addresses the EVOLVING player. The gate above already proved
  // the target is one of theirs, so the two coincide — spelled with the action's
  // seat rather than re-derived from the board because that is the pronoun's
  // referent, and it stays right if a future card ever evolves across the table.
  //
  // ⚠️ THE §4 BAN MOVED DOWN HERE FROM ABOVE THE HAND CHECKS, AND HAD TO: the
  // licence is a property of the TARGET BODY, so the ban cannot be answered
  // before the target is resolved. The two refusals keep their own codes and
  // their own messages — see `evolveEarlyLicensed`'s doc block on why one
  // predicate must not collapse them.
  const licensed = evolveEarlyLicensed(state, action.seat, target);
  // §4/§10 — neither player may evolve on their own first turn (every Pokémon
  // in play then arrived this turn). The turn/firstPlayer arithmetic is
  // `isFirstTurnOf` (types.ts) since D275: the gate already proved this is the
  // acting seat's turn, so the ordinal names whether it is their first. (This is
  // the check turnPlayed cannot make — setup Pokémon carry turnPlayed 0, not the
  // turn number, by design.)
  if (!licensed && isFirstTurnOf(state, action.seat)) {
    return err("FIRST_TURN_EVOLVE", "cannot evolve on your first turn (§4/§10)");
  }
  // §10 timing — a Pokémon cannot evolve the turn it came into play, nor twice
  // in one turn (evolving stamps turnPlayed to the current turn, below), so a
  // target already stamped this turn is too soon. Setup Pokémon carry 0 and
  // clear this from turn 2 on; the first-turn ban above covers turns 1–2.
  //
  // ⚠️ THE LICENCE LIFTS THE "CAME INTO PLAY" HALF AND CANNOT BE OBSERVED
  // LIFTING THE "TWICE IN ONE TURN" HALF THIS LINE ALSO ENCODES — evolving
  // REPLACES the top card, so the very step that stamps `turnPlayed` also
  // removes the Ability granting the licence. The conflation is therefore
  // harmless here rather than resolved, and that is a fact about the print
  // (no Standard body prints this licence on a card that stays on top).
  if (!licensed && target.turnPlayed >= state.turn) {
    return err(
      "EVOLVE_TOO_SOON",
      `${targetTopCard.name} came into play this turn — it cannot evolve yet (§10)`,
    );
  }
  // §10 (D285) — THE SECOND READ SITE OF THE POKÉMON-SURFACE PLAY GATE, and the
  // only one BOTH sources reach: Bronzong `sv05-069` "Evolution Jammer" stamps
  // *"they can't play any Pokémon from their hand to evolve their Pokémon"* for
  // exactly the next turn, and Team Rocket's Arbok `sv10-113` bars the play
  // continuously while it is Active. ⚠️ ONE PREDICATE FOR BOTH — this line did
  // not gain a term when the second source landed and cannot fall behind a third.
  //
  // 🛑 THE NARROWED NOUN IS THE EVOLUTION CARD (`card`), NOT THE BODY IT LANDS ON.
  // Arbok's *"any Pokémon that has an Ability"* is printed about the card being
  // PLAYED, so a plain Basic evolving into an Ability-bearing Stage 1 is barred
  // and the reverse is not — the two directions are driven separately.
  //
  // ⚠️ BELOW §4/§10's TWO TIMING BANS AND THE LICENCE, for `playTrainer`'s stated
  // ordering reason: those are rules about the player's own board and should name
  // themselves, while this one is imposed by the opponent. It sits ABOVE the
  // placement so a barred evolve costs nothing — the card never leaves hand.
  if (pokemonPlayBarred(state, action.seat, "evolve", card)) {
    return err(
      "HAND_PLAY_BLOCKED",
      "your opponent prevents you from playing Pokémon from your hand to evolve",
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
    and POKEMON_EVOLVED is appended here as the placement's own event.

    🆕 **D307 — THE PLACEMENT ITSELF IS NOW `evolveOnto` BELOW, AND THIS FUNCTION
    IS THAT PLUS ITS TWO TAILS.** The split exists because the tails are the only
    part of this file an `EffectOp` cannot reach: `stepOp` (interpreter.ts) returns
    a bare `GameState` or a prompt, and both tails return an `ApplyResult` that
    SETS A PHASE. Every caller that plays an evolution card **from the hand**
    (`evolve` here, `rareCandy` in cardplay.ts) still calls THIS function and is
    byte-identical; the deck-sourced placement (`evolveFromDeck`, the D307 attack
    op) calls `evolveOnto` directly. See that op's doc block in `effects.ts` for
    why neither tail is owed on the deck route — the printed on-evolve trigger
    says *"from your hand"* on every legal card that prints one, and §8.1
    `finishAttack` already sweeps the attacker's own board. */
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
  const { state: next, evolved } = evolveOnto(
    state,
    seat,
    target,
    benchIndex,
    from,
    fromUid,
    evolutionUid,
    events,
  );
  if (isLethallyDamaged(next, evolved)) {
    return resolveMidTurnKnockOuts(next, seat, [seat], events);
  }
  // 🆕 D319 — THE OPPONENT'S WATCH, and it sits HERE for the reason the whole
  // "from their hand" clause costs no code: this function is reached ONLY by the
  // two hand routes (`evolve` above, `rareCandy` in cardplay.ts), while every
  // deck-sourced placement — `evolveFromDeck`, `evolveFromDeckChosen`,
  // `evolveFromDeckEachBenched`, `evolveFromDeckEachChosen` — calls `evolveOnto`
  // directly, one rung below. Team Rocket's Ampharos sv10-074 "Darkest Impulse"
  // prints *"Whenever your opponent plays a Pokémon **from their hand** to evolve
  // 1 of their Pokémon"*, so a deck-sourced evolve must NOT fire it, and the
  // split that already existed is exactly that gate. Rare Candy inherits the
  // trigger for free and correctly — it, too, is a Pokémon played from the hand.
  //
  // ⚠️ AFTER the §8.1 evolve-below-HP check above, BEFORE the controller's own
  // on-evolve trigger below. A body Knocked Out by evolving has left play, so
  // there is nothing left for the opponent's counters to land on; and running
  // ahead of `runBoardTrigger` is what keeps the two composable at all, since
  // that one returns an ApplyResult that may PARK and nothing can be threaded
  // after it.
  //
  // 🆕 D357 — `next` IS the moment board at this site, MEASURED and not assumed:
  // this is an evolve on `seat`'s board and the watcher is the other seat, whose
  // Active nothing between the placement and this line touches. The §6.1 rider
  // that made this parameter necessary rides the ATTACH, not the evolve.
  const watched = runWatchedTriggers(next, seat, evolutionUid, "onEvolve", events, next);
  const subject =
    target.spot === "active" ? watched.players[seat].active : watched.players[seat].bench[benchIndex];
  if (subject !== null && subject !== undefined && isLethallyDamaged(watched, subject)) {
    return resolveMidTurnKnockOuts(watched, seat, [seat], events);
  }
  return runBoardTrigger(watched, seat, target, "onEvolve", events);
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
    // D412 — the SELF-installed retreat lock. ⚠️ ON THIS PATH IT IS THE ONE CLEAR
    // IN THE SET THAT CANNOT FIRE, and saying so is better than pretending: the
    // window is the holder's own next turn and this function runs on a RETREAT,
    // which is the one action the lock forbids. It is written anyway because the
    // three §10 literals are hand-kept and nothing makes them agree — a field
    // present in two of three is the defect `attackLock.test.ts` names.
    retreatLockedTurn: null,
    attackBlock: null,
    attackLockedTurn: null,
    // D147 — the durated damage reduction, whose story here is D142's block's:
    // the RETREAT half of this path is unreachable inside the window (the window
    // is the opponent's turn, and the holder's controller cannot retreat on it),
    // while the FORCED half (`switchInto`) is exactly where it bites.
    damageReduction: null,
    // 🆕🆕 D432 — the NO-WEAKNESS bar, whose story here is the reduction's
    // one line up verbatim: the window is the OPPONENT's turn, so the RETREAT half
    // is unreachable inside it and the FORCED half (`switchInto`) is where it
    // bites. EIGHT durated effects on one clear, FIVE reachability stories — which
    // is why the clear-set is SWEPT and not listed.
    noWeaknessTurn: null,
    // 🆕🆕 D434 — the SCHEDULED counter placement, and it is the ONE field on this
    // literal whose RETREAT half is not merely reachable but is the printed
    // counterplay. Every neighbour here has its window on the opponent's turn, so
    // the paragraphs above all say "the retreat half is unreachable, the forced
    // half is where it bites". This record fires at the end of the HOLDER's own
    // next turn, so retreating the Defending Pokémon during that turn is exactly
    // how a player answers the attack — §10 sheds the effects of attacks, and the
    // schedule goes with the body. NINE durated effects on one clear, SIX
    // reachability stories.
    scheduledEffect: null,
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
  // §11 — an attack held it in place ("the Defending Pokémon can't retreat", or
  // since D412 "During your next turn, this Pokémon can't retreat" from its own
  // attack). Its own code, not STATUS_PREVENTS_RETREAT: nothing about it is a §12
  // condition, and a client showing "Asleep/Paralyzed" here would be lying.
  //
  // ⚠️ THROUGH `retreatLocked` AND NOT OFF EITHER FIELD, because the fact now has
  // two of them and this site does not care which one answered. The message stays
  // one message for the same reason it stays one error code: the player is told it
  // cannot retreat because of an attack, not whose attack (D112).
  if (retreatLocked(state, active)) {
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
  // 🆕 D320 — §9 THE OPPONENT-ACTION TRIGGER ON THIS MOVE (Magcargo `sv05-029`
  // "Lava Zone"). THE SECOND of the engine's two Active→Bench moves, and the
  // one a "sole funnel" reading of `switchInto` would have missed: a retreat
  // never calls that function, because it also spends the retreating body's
  // Energy and emits `RETREATED` rather than `POKEMON_SWITCHED`. Shared with
  // the other mover through triggers.ts `runActiveBenchedTriggers`, which owns
  // the printed "during their turn" clause — trivially true here (a retreat is
  // gated to the actor's own turn by `turnGate` at the top of this function)
  // and falsifiable at the `gust` route, which is what makes it a gate.
  const moved = runActiveBenchedTriggers(next, action.seat, activeTopUid, events);
  // 🆕 §8.1 — THE FIFTH CALL SITE OF THE MID-TURN SWEEP, AND THE FIRST ONE WHOSE
  // LETHALITY COMES FROM A **COST**. D325 gave `effectiveMaxHp` two ENERGY-COUNTED
  // terms — `hpBonus.requiresEnergyType` (Okidogi `sv06-111`/`sv06.5-074`/
  // `sv08.5-057` "Adrena-Power", +100 while any {D} is attached) and
  // `hpBonusPer.attachedEnergy` (Conkeldurr `sv10.5b-049`/`sv10.5b-127`
  // "Craftsmanship", +40 per attached {F}) — and recorded, in that slice's own
  // suite, that these are **the first grants that shrink with nothing in the
  // holder's stack moving at all**, leaving whether a sweep runs on that path an
  // OPEN SEAM. This is the path: the retreat cost discards Energy from the very
  // body the grant is measured on, so a Conkeldurr at 200 damage under a 260
  // maximum is at 200 under 140 the moment it pays three {F} — Knocked Out by
  // §8.1's `damage ≥ maximum` state check, on the Bench, with no attack anywhere
  // near it. Every OTHER discard-from-play route is an interpreter op and already
  // folds through `settleProgram`'s sweep; a retreat is the one that does not.
  //
  // ⚠️ `[action.seat]` AND NOT `SEATS`, which is turn.ts's other three sites'
  // answer and is reached the same way: the cost is paid off the actor's own body,
  // and nothing else on this path can damage anything. Neither term can reach the
  // other board. The Stadium play (cardplay.ts) is the one site that must pass
  // both, because its printed clause names both.
  //
  // 🆕 ⚠️ **AND IT IS BEHIND `runActiveBenchedTriggers`, THOUGH NOT FOR THE REASON
  // D328 WROTE HERE.** That paragraph read *"the counters that trigger places are
  // a second way this same move can turn lethal"* and named Magcargo `sv05-029`
  // "Lava Zone" as putting them "on the body that MOVED". **LAVA ZONE PLACES NO
  // COUNTERS**: its printed consequent is *"their **new Active Pokémon** is now
  // Burned"* and its program is one `applyStatus` op, so it touches a different
  // body from the one that moved, applies a §12 condition rather than damage, and
  // cannot make anything lethal here at all (Burn is dealt at the Checkup). The
  // trigger is the engine's ONLY `onActiveMovedToBench` row, so on today's pool
  // this move has exactly ONE lethality source and it is the cost.
  //
  // The ORDER is still owed, and it is owed for the ordinary reason: an Ability
  // whose antecedent is this move fires as part of the move, and a sweep in front
  // of it would Knock the retreater Out — and park the game on the opponent's
  // Prize decision — with the Ability still unfired. `selfScalingHp.test.ts` §8
  // drives that on a board where the cost is lethal and a Magcargo is watching.
  return resolveMidTurnKnockOuts(moved, action.seat, [action.seat], events);
}

/** Pass: seed the staged tail (flow.ts turnTail) and drain it. */
export function endTurn(state: GameState, action: EndTurnAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  return advance({ ...state, pending: turnTail(action.seat) }, []);
}
