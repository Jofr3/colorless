import type { Card } from "@luminous/schema";
import type {
  ApplyResult,
  AttachToolAction,
  PlayTrainerAction,
  RareCandyAction,
  ResolveEffectAction,
  UseAbilityAction,
  UseStadiumAbilityAction,
} from "./actions";
import { err, ok } from "./actions";
import { resolveCopiedAttack, resolveFoundAttack, resolveInPlayCopiedAttack } from "./attack";
import { cardOfUid, isBasicPokemon, topUid } from "./cards";
import {
  // 🆕🆕🆕 D577 — the live per-seat Bench limit (Area Zero Underdepths, R-AZ1).
  benchLimitOf,
  disabledAbilityUids,
  handPlayBarred,
  // 🆕🆕🆕 D572 — Adrena-Brain's {D} body gate and the Milotic lock (R-MC2).
  hasAttachedEnergy,
  inPlayToHandBlocked,
  remainingHpWithin,
  toolCardSimulated,
  // 🆕🆕🆕 D643 — Multi Adapter's raised Tool cap, at both `attachTool` arms.
  toolCapOf,
  // 🆕🆕🆕 D644 — Watchful Eye's counter-move lock, at `programPlayable`.
  countersMoveLocked,
} from "./continuous";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { recoverStatuses, resolveMidTurnKnockOuts, settleProgram } from "./flow";
import type { EffectChoice, EffectPrompt, PokemonRef } from "./interpreter";
import {
  attachEnergyTargets,
  attachFromDiscardOffer,
  // 🆕🆕🆕 D628 — Lethargic Charge's hand offer, so the refusal and the offer agree.
  attachFromHandPlayable,
  attachSeat,
  conditionHolds,
  conditionNote,
  // 🆕🆕🆕 D565 — Rocket Brain's two candidate funnels, so the grey-out and the offer agree.
  counterOwnDestinations,
  counterOwnSources,
  // 🆕🆕🆕 D572 — Adrena-Brain's source funnel.
  counterToOpponentSources,
  discardEnergyPlayable,
  discardRetrievalCandidates,
  // 🆕🆕🆕 D557 — the Tool offer's own funnel, so the grey-out and the offer agree.
  discardableTools,
  // 🆕🆕🆕 D611 — Spiteful Evolution's hand offer, so the refusal and the offer agree.
  evolveFromHandAvailable,
  firstAttachableEnergy,
  gustTargets,
  healChosenTargets,
  handCostAction,
  handCostUnmet,
  // 🆕🆕🆕 D577 — Tyme's candidate funnel (R-TY1), so the grey-out and the offer agree.
  handPokemonUids,
  moveEnergyPlayable,
  // 🆕🆕🆕 D625 — Blowtorch's branch offer and Strange Timepiece's own-side offer, so the refusal and the offer agree.
  offeredBranches,
  ownDevolveAvailable,
  resumeProgram,
  // 🆕🆕🆕 D565 — Ruffian's candidate funnel.
  ruffianBodies,
  runProgram,
  snipeTargets,
  // 🆕🆕🆕 D566 — Ogre's Mask's two offer funnels.
  swapBodies,
  swapDiscardCards,
  switchActiveTargets,
  // 🆕🆕🆕 D642 — Risky Ruins' counters, at an Antique Fossil's play.
  benchArrivalCounters,
  // 🆕🆕🆕 D644 — the five counter-move ops Watchful Eye refuses.
  isCounterMoveOp,
} from "./interpreter";
import type { AbilityProgram, StadiumAbility } from "./registry";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import { isBenchIndex, isPokemonTarget, placeEvolution, turnGate } from "./turn";
import type { GameState, InPlayPokemon, PlayerSide, PokemonTarget, Seat } from "./types";
import { SEATS, isFirstTurnOf, makeInPlay, otherSeat, withSide, without } from "./types";

// The M4 card-play actions (§7 Trainers, §9 Abilities) and the resolver for the
// mid-effect decisions they park on (§15.E/G). playTrainer/useAbility/
// resolveEffect orchestrate the same shared interpreter (interpreter.ts):
// validate the play, announce it, run the op program, and either finish (back
// to turn:action) or PARK on effect:choose. The two persistent-zone plays are
// different animals — a Stadium (§7.3) moves into the shared zone and a Tool
// (§7.4, attachTool) onto a Pokémon, both with CONTINUOUS effects the
// pipeline reads (continuous.ts) rather than programs the interpreter runs.

/** 🆕🆕🆕 §7 (D636) — Seismitoad "Quaking Fist"'s coin, flipped by `seat` trying to use the Trainer card `uid`
    from hand while `PlayerSide.trainerFlipLockTurn` is the turn now in progress. `null` when no lock is live (no
    rng is drawn). Otherwise the flip's row, and on TAILS the card moved from the hand to the discard pile
    instead of being used (`failed`). Asked at all five Trainer-play sites (Item / Supporter, Stadium, Tool, Rare
    Candy, an Antique Fossil) AFTER every check that would refuse the play, so only a legal try flips.
    R-QF1 ⚠️ UNRULED: the try IS the play for the per-turn limits — a tails Supporter or Stadium spends
    `supporterPlayed` / `stadiumPlayed` (the caller writes it) — and nothing else a use writes is written
    (no `TRAINER_PLAYED`, no `supporterPlayedUid`, no effect). */
function trainerFlipFails(
  state: GameState,
  seat: Seat,
  uid: string,
): { state: GameState; events: GameEvent[]; failed: boolean } | null {
  const side = state.players[seat];
  if (side.trainerFlipLockTurn !== state.turn) return null;
  const [face, rngState] = flipCoin(state.rngState);
  const events: GameEvent[] = [{ type: "TRAINER_FLIP_LOCK_CHECK", seat, uid, result: face }];
  if (face === "heads") return { state: { ...state, rngState }, events, failed: false };
  const discarded = withSide(state, seat, {
    ...side,
    hand: without(side.hand, uid),
    discard: [...side.discard, uid],
  });
  return { state: { ...discarded, rngState }, events, failed: true };
}

/** §7.1–§7.3 — play a Trainer from hand: an Item (any number) or Supporter
    (one per turn) resolves its authored program then discards; a Stadium (one
    play per turn) replaces the shared zone's occupant — different names only —
    and STAYS in play, its continuous effects live from this moment.
    (🆕🆕🆕 D576 (D539): one Item does NOT resolve-then-discard — an Antique Fossil
    (`playAsPokemon`) goes onto the Bench as a Pokémon, `playFossil` below, R-FO1.) */
export function playTrainer(state: GameState, action: PlayTrainerAction): ApplyResult {
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
  if (card.category !== "Trainer") {
    return err("NOT_A_TRAINER", `${card.name} is not a Trainer card`);
  }
  const entry = programFor(card.id);
  if (entry?.rareCandy === true) {
    // Rare Candy evolves (it carries a target Basic + a Stage 2), so it is not
    // a program-running Trainer — it goes through the dedicated `rareCandy`
    // action (the same shape as a Tool routing to attachTool).
    return err("TRAINER_TYPE_UNSUPPORTED", "Rare Candy is played via the rareCandy action (§7.1)");
  }
  const trainerType = card.trainerType;
  if (trainerType === "Stadium") {
    return playStadium(state, action, card);
  }
  if (trainerType === "Tool") {
    // Not a play — Tools attach (attachTool carries the required target).
    return err("TRAINER_TYPE_UNSUPPORTED", "Pokémon Tools are attached via attachTool (§7.4)");
  }
  if (trainerType !== "Item" && trainerType !== "Supporter") {
    return err(
      "TRAINER_TYPE_UNSUPPORTED",
      `${trainerType ?? "this"} Trainers are not supported yet`,
    );
  }
  // 🆕🆕🆕 §7.1 (D576) — an Antique Fossil is played "as if it were a 60-HP Basic {C} Pokémon":
  // an ITEM play that becomes a body (R-FO1), routed BEFORE the `trainer` lookup because it
  // runs no program (Rare Candy's marker shape, `CardProgram.playAsPokemon`).
  if (trainerType === "Item" && entry?.playAsPokemon === true) {
    return playFossil(state, action, card);
  }
  const program = entry?.trainer;
  if (program === undefined) {
    // Coverage strategy: an unauthored Trainer surfaces loudly rather than
    // playing as a silent no-op that still costs the player the card.
    return err("TRAINER_NOT_SIMULATED", `${card.name} is not simulated yet`);
  }
  if (trainerType === "Supporter") {
    // §4 — the going-first player may not play a Supporter on turn 1 (turn 1 is
    // by construction their turn, and the gate proved this is the actor's turn).
    //
    // …unless the card PRINTS its own exemption: "If you go first, you may use
    // this card during your first turn." (Carmine, D223). The flag is read HERE,
    // one line above the rule it lifts, and nowhere else in this branch — §7.2's
    // once-per-turn allowance below is a different rule and stays enforced, so a
    // turn-1 Carmine still spends the Supporter for the turn.
    if (state.turn === 1 && entry?.trainerFirstTurnExempt !== true) {
      return err(
        "FIRST_TURN_SUPPORTER",
        "the going-first player cannot play a Supporter on turn 1 (§4)",
      );
    }
    if (state.allowances.supporterPlayed) {
      return err("SUPPORTER_ALREADY_PLAYED", "only one Supporter per turn (§7.2)");
    }
  }
  // §7.1/§7.2 (D283/D284) — the OPPONENT barred this class from this seat's hand:
  // either by an ATTACK, for exactly this turn (Scream Tail ex's Supporter bar,
  // Galvantula ex / Budew / Frillish's Item bar), or CONTINUOUSLY by the body in
  // their Active Spot (Tyranitar's "Daunting Gaze", Jellicent ex's "Oceanic
  // Curse"). ⚠️ ONE PREDICATE FOR BOTH SOURCES — `handPlayBarred` (continuous.ts)
  // ORs them, so this gate did not gain a term when the second source landed and
  // cannot fall behind a third. Checked for BOTH classes in ONE place, below the
  // Supporter-only pair above rather than inside it: the rule is printed on the
  // opponent's card and is indifferent to which class it names, so a copy of it
  // inside the `isSupporter` branch would have to be written a second time the
  // day the Item printings landed — which is D283's own slice.
  //
  // ⚠️ AFTER §4 and §7.2, and the ORDER is what the two rules mean. Those are the
  // player's OWN limits and this is one their opponent imposed; a turn-1 second
  // Supporter should still say so, and a barred seat learns the bar only once its
  // own play was otherwise legal. `trainerFirstTurnExempt` does NOT reach here:
  // Carmine's printed sentence licenses §4's timing, not an opponent's lock.
  if (handPlayBarred(state, action.seat, trainerType, card)) {
    return err(
      "HAND_PLAY_BLOCKED",
      `your opponent prevents you from playing ${trainerType} cards from your hand`,
    );
  }
  // The card's own printed "You can use this card only if …" line (Fighting Au
  // Lait). Checked HERE — before the card leaves hand below — so a rejected play
  // costs nothing; and against `state`, the board the player is looking at.
  const playGate = entry?.trainerPlayableIf;
  if (playGate !== undefined && !conditionHolds(state, action.seat, playGate)) {
    return err(
      "PLAY_CONDITION_NOT_MET",
      `${card.name} can only be used if ${conditionNote(playGate)}`,
    );
  }
  // The card's OTHER printed "only if" — a hand COST rather than a board
  // condition (Ultra Ball's "only if you discard 2 OTHER cards from your hand";
  // Dendra's "(If you have no OTHER cards in your hand, you can't use this
  // card.)", the same gate stated as its contrapositive).
  // Checked beside the gate above because both are printed RULES, not
  // programPlayable's would-only-whiff heuristics; and checked with the played
  // uid EXCLUDED, which is exactly what the printed word "other" means — the card
  // is still in hand right now and cannot pay for itself (it is about to become
  // the discard's newest card, not one of the two the player picks).
  const unpayable = handCostUnmet(state, action.seat, program, action.uid);
  if (unpayable !== null) {
    return err(
      "PLAY_CONDITION_NOT_MET",
      `${card.name} can only be used if you ${handCostAction(unpayable, true)}`,
    );
  }
  if (!trainerProgramPlayable(state, program, action.seat)) {
    return err("NO_LEGAL_TARGET", `${card.name} has no legal target`);
  }
  // 🆕🆕🆕 D636 — Quaking Fist: the try flips (R-QF1); tails discards the card and spends a Supporter's turn.
  const flip = trainerFlipFails(state, action.seat, action.uid);
  if (flip?.failed === true) {
    const spent =
      trainerType === "Supporter"
        ? { ...flip.state, allowances: { ...flip.state.allowances, supporterPlayed: true } }
        : flip.state;
    return ok(spent, flip.events);
  }

  // Play it: the card leaves hand for the discard (Item/Supporter discard after
  // resolving — none in scope references itself mid-effect, so discarding up
  // front is equivalent and spares threading its uid through the continuation).
  const events: GameEvent[] = [
    ...(flip?.events ?? []),
    { type: "TRAINER_PLAYED", seat: action.seat, uid: action.uid, trainerType },
  ];
  let next: GameState = withSide(flip?.state ?? state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
    discard: [...side.discard, action.uid],
  });
  if (trainerType === "Supporter") {
    // 🆕🆕🆕 D564 — AND WHICH Supporter: `supporterPlayedUid` is written HERE, in the same
    // literal as the flag, and nowhere else (Team Rocket's Factory and Crobat "Shadowy
    // Envoy" read the played card's NAME back through it — R-FC).
    next = {
      ...next,
      allowances: { ...next.allowances, supporterPlayed: true, supporterPlayedUid: action.uid },
    };
  }
  // Katy "your turn ends": a Trainer that ends the turn on completion, folded by
  // settleProgram exactly like an Ability's endsTurn (the Koraidon precedent).
  const endsTurn = entry?.trainerEndsTurn === true;
  // 🆕 D259 — THE ONE SITE THAT LABELS A TRAINER'S PROGRAM, and it is one site for
  // `invokedBy`'s original reason (interpreter.ts): the rule "prevent all effects
  // of that card done to this Pokémon" asks every effect op the SAME question, and
  // the only place that knows the answer is the call that started the program.
  // A Stadium's own program (two calls down) and an Ability's are deliberately
  // unlabelled — neither is "an Item or Supporter card played from their hand".
  const invokedBy = trainerType === "Supporter" ? "supporter" : "item";
  // 🆕🆕🆕 D564 — `playedUid`: the PLAYED CARD itself, for Caretaker's *"shuffle this
  // Caretaker into your deck instead of discarding it"* (`shufflePlayedCardIntoDeck`). Set
  // HERE and nowhere else; NOT `sourceUid`, which names a Pokémon and which a Trainer must
  // leave absent (D222's self-op hazard — a `self` op would find no body and whiff, or worse).
  return settleProgram(
    runProgram(next, program, { seat: action.seat, invokedBy, playedUid: action.uid }, events),
    action.seat,
    events,
    { endsTurn },
  );
}

/** 🆕🆕🆕 §7.1 (D576) — THE ANTIQUE FOSSIL PLAY (`sv07-129`, `sv10.5b-080`, `sv07-130`,
    `sv10.5w-079`): *"Play this card as if it were a 60-HP Basic {C} Pokémon."* — split out of
    playTrainer's Item path (hand / uid / category / Item already validated there).

    R-FO1 (⚠️ UNRULED → ruled at D576): **it is an ITEM play** — the opponent's Item bar
    (`handPlayBarred` with `"Item"`, both its stamped and its continuous sources) refuses it,
    exactly as it refuses any Item. **It is NOT "playing a Basic Pokémon from your hand"**, so
    no Pokémon-play bar (`pokemonPlayBarred`) is asked and no on-bench-play trigger
    (`runBoardTrigger "onPlayToBench"`) fires — the card is a Trainer while it is being played.
    It needs a free Bench slot (§5.2's cap — the printed "as if it were a … Basic Pokémon"
    puts it where a Basic goes, and a full Bench has nowhere to put it).

    The card leaves the hand for the BENCH (never the discard pile): `makeInPlay` stamps
    `turnPlayed`, so a Lileep cannot evolve from it on the turn it was played (§10, R-FO6).
    Announced `TRAINER_PLAYED` (the Item play) then `POKEMON_BENCHED` (the body). No mid-turn
    sweep is owed: a fresh 60-HP body with no damage cannot be Knocked Out by arriving. */
function playFossil(state: GameState, action: PlayTrainerAction, card: Card): ApplyResult {
  const itemBarred = handPlayBarred(state, action.seat, "Item", card);
  if (itemBarred) {
    return err("HAND_PLAY_BLOCKED", "your opponent prevents you from playing Item cards from your hand");
  }
  const side = state.players[action.seat];
  if (!fossilPlayable(state, action.seat)) {
    return err("BENCH_FULL", `the bench holds at most ${benchLimitOf(state, action.seat)} Pokémon`);
  }
  // 🆕🆕🆕 D636 — Quaking Fist (R-QF1): an Antique Fossil is an Item play, so the try flips.
  const flip = trainerFlipFails(state, action.seat, action.uid);
  if (flip?.failed === true) return ok(flip.state, flip.events);
  const events: GameEvent[] = [
    ...(flip?.events ?? []),
    { type: "TRAINER_PLAYED", seat: action.seat, uid: action.uid, trainerType: "Item" },
    { type: "POKEMON_BENCHED", seat: action.seat, uid: action.uid },
  ];
  const seated = withSide(flip?.state ?? state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
    bench: [...side.bench, makeInPlay(action.uid, state.turn)],
  });
  // 🆕🆕🆕 D642 — Risky Ruins: the seated fossil is a Basic {C} Pokémon (R-RR2), so it takes the counters.
  return ok(benchArrivalCounters(seated, action.seat, [action.uid], events), events);
}

/** 🆕🆕🆕 D576 — can `seat` put an Antique Fossil onto its Bench right now? A free Bench slot is
    the whole of it (R-FO1). The ONE funnel `playFossil` refuses on and both Trainer lists
    (GameHud's `playableTrainers`, redact.ts's `redactedTrainersOf`) grey a fossil row on — the
    `programPlayable` role for a card that runs no program. */
export function fossilPlayable(state: GameState, seat: Seat): boolean {
  // 🆕🆕🆕 D577 — the LIVE limit (Area Zero Underdepths + a Tera Pokémon in play: 8).
  return state.players[seat].bench.length < benchLimitOf(state, seat);
}

/** §7.3 — the Stadium play, split out of playTrainer's Item/Supporter path
    (hand/uid/category already validated there): one play per turn, replaces a
    DIFFERENT-named predecessor (which goes to its owner's discard), and the
    card sits in the shared zone with no program to run — its authored effects
    are continuous, read by the pipeline (continuous.ts) while it stays. */
function playStadium(state: GameState, action: PlayTrainerAction, card: Card): ApplyResult {
  // §7.3 (D287) — THE FIFTH READ SITE, and the one D284's refusal note named by
  // LINE: *"the CLASS is spellable (`"Stadium"` IS a `Card.trainerType`); the READ
  // is not. `playTrainer` hands a Stadium to `playStadium` on the line ABOVE this
  // gate."* Copperajah `sv06.5-042` "Massive Body" prints *"…your opponent can't
  // play any Stadium cards from their hand."*, so until this line existed the
  // widest class list in the world could not have refused a Stadium play.
  //
  // ⚠️ INSIDE `playStadium` AND NOT ON `playTrainer`'s DISPATCH LINE — `attachTool`'s
  // placement (D284), not the Item/Supporter gate's (D283). The rule is about
  // PLAYING A STADIUM, so it belongs to the handler that owns that play: a future
  // second caller of this function inherits the gate here and would not inherit
  // one written on the dispatch line above.
  //
  // ⚠️ ORDER — ABOVE §7.3's own two mechanics (the once-per-turn allowance and the
  // different-name rule) and above the "is it simulated" check, for `attachTool`'s
  // reason verbatim. Everything below is a fact about the ZONE rather than a rule
  // the player broke, and a barred seat has no business being told "only one
  // Stadium play per turn" about a play the rules never let it attempt. ⚠️ **THIS
  // INVERTS `playTrainer`'s ORDERING ON PURPOSE**: there §4 and §7.2 are the
  // player's OWN limits and are entitled to name themselves first; here there is
  // no such rule above, so the opponent's bar is the honest first answer.
  //
  // ⚠️ `handPlayBarred` AND NOT A FIFTH PREDICATE: the SAME funnel every other read
  // site asks, so the stamped source — which can never name `"Stadium"`, by
  // `StampedHandPlayClass` [🆕🆕🆕 D636 (D539): WITHDRAWN — Scorching Earth stamps `"Stadium"`, and this
  // line now meets that stamp] — is consulted and answers `false` without this line
  // knowing there are two sources at all.
  if (handPlayBarred(state, action.seat, "Stadium", card)) {
    return err(
      "HAND_PLAY_BLOCKED",
      "your opponent prevents you from playing Stadium cards from your hand",
    );
  }
  if (programFor(card.id)?.stadium === undefined) {
    // Coverage strategy, same as the Item/Supporter path: an unauthored
    // Stadium cannot be played rather than sitting in the zone doing nothing.
    return err("TRAINER_NOT_SIMULATED", `${card.name} is not simulated yet`);
  }
  // 🆕🆕🆕 D642 — Ange Floette's *"during the same turn you play Prism Tower"* lifts the spent play (R-ANF2).
  if (state.allowances.stadiumPlayed && !stadiumSpentPlayLifted(state, action.seat, card)) {
    return err("STADIUM_ALREADY_PLAYED", "only one Stadium play per turn (§7.3)");
  }
  const current = state.stadium;
  const currentCard = current === null ? undefined : cardOfUid(state, current.uid);
  // §7.3 — the same NAME cannot replace itself (no resetting the zone);
  // different prints of one Stadium share the name, so this compares names,
  // not ids. An unresolvable occupant (structurally impossible) reads as
  // replaceable — stay total.
  if (currentCard !== undefined && currentCard.name === card.name) {
    return err("STADIUM_SAME_NAME", `${card.name} is already in play (§7.3)`);
  }
  // 🆕🆕🆕 D642 — Ange Floette's *"only if you discard a Prism Tower in play"* (R-ANF1).
  if (stadiumPlayOverUnmet(state, card)) {
    return err("PLAY_CONDITION_NOT_MET", `${card.name} can be put into play only by discarding the Stadium it names`);
  }

  // 🆕🆕🆕 D636 — Quaking Fist (R-QF1): tails discards the Stadium and spends the turn's Stadium play.
  const flip = trainerFlipFails(state, action.seat, action.uid);
  if (flip?.failed === true) {
    return ok({ ...flip.state, allowances: { ...flip.state.allowances, stadiumPlayed: true } }, flip.events);
  }
  const events: GameEvent[] = [
    ...(flip?.events ?? []),
    { type: "TRAINER_PLAYED", seat: action.seat, uid: action.uid, trainerType: "Stadium" },
  ];
  const side = state.players[action.seat];
  let next: GameState = withSide(flip?.state ?? state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
  });
  if (current !== null) {
    // The replaced Stadium goes to its OWNER's discard pile — read off `next`
    // so an actor discarding their own earlier Stadium keeps the hand update.
    const ownerSide = next.players[current.owner];
    next = withSide(next, current.owner, {
      ...ownerSide,
      discard: [...ownerSide.discard, current.uid],
    });
    events.push({ type: "STADIUM_DISCARDED", seat: current.owner, uid: current.uid });
  }
  next = {
    ...next,
    stadium: { uid: action.uid, owner: action.seat },
    allowances: { ...next.allowances, stadiumPlayed: true },
  };
  // 🆕 §8.1 — THE FOURTH CALL SITE OF THE MID-TURN SWEEP, AND THE FIRST ONE THE
  // ZONE OWNS. `hpDelta` made the Stadium zone a max-HP term (Gravity Mountain
  // `sv08-177`/`sv08-250`, −30 to every Stage 2 in play — the engine's FIRST
  // subtrahend), and §8.1's Knock Out is a state check on `damage ≥ maximum`, not
  // an event of the thing that moved the number: a Stage 2 already carrying 130 is
  // Knocked Out the instant its maximum drops to 120, exactly as a charmed Basic
  // dies the instant it evolves out of Bravery Charm's clause. That evolve case is
  // `placeEvolution`'s sweep, and this is the same rule reached through the other
  // zone. ⚠️ A REPLACEMENT IS THE SAME EVENT: discarding a Lively Stadium takes
  // +30 off every Basic in play, so the sweep is owed on the play, never on the
  // delta's sign.
  //
  // ⚠️ `SEATS` AND NOT `[action.seat]`, WHICH IS WHERE THIS SITE DIFFERS FROM THE
  // THREE IN turn.ts. Those three are `[actorSeat]` because only the actor's own
  // board can go lethal on an evolve or a watched attach; a Stadium's printed
  // clause is *"both yours and your opponent's"* on all three legal printings, so
  // playing one can Knock Out the OPPONENT's body — which also makes §14's
  // double-KO tie reachable from this path, and `collectKnockOuts` owns it.
  //
  // ⚠️ IT IS THE LAST THING THIS FUNCTION DOES. `allowances.stadiumPlayed` and the
  // zone itself are already written into `next`, so the interrupt resumes onto a
  // board where the Stadium is genuinely in play — a sweep run before the zone
  // update would read the OLD maximum and find nothing.
  //
  // 🆕🆕🆕 §12 (D562) — AND THE FIFTH RECOVERY MOMENT, JUST BEFORE THE SWEEP. Festival
  // Grounds' *"recovers from all Special Conditions"* covers every Energy-carrying Active
  // the instant it enters the zone, on BOTH boards (flow.ts `recoverStatuses`, which would
  // also cover a Tool-borne recovery source re-enabled by a Jamming Tower leaving — latent:
  // no Tool writes `statusRecovery` today). Before the sweep so
  // the sweep reads the recovered board — which moves no damage, so the order is free for
  // the KO and fixed only for the event sequence (STATUS_CLEARED, then any KO).
  // 🆕🆕🆕 §7.3 (D577) — the REPLACED Stadium left play, so its OWNER trims first (R-AZ3:
  // Area Zero Underdepths' *"the player who played this card discards first"*). With no
  // Stadium replaced the sweep's state check runs actor-first, as every sweep does.
  next = recoverStatuses(next, events);
  return resolveMidTurnKnockOuts(next, action.seat, SEATS, events, undefined, current?.owner);
}

/** 🆕🆕🆕 §7.3 (D642) — is the Stadium in play the one `card`'s `playOnlyOverStadium` names (Ange Floette: a
    Prism Tower, R-ANF1)? By NAME, either owner's. */
function stadiumPlayOverMet(state: GameState, card: Card): boolean {
  const over = programFor(card.id)?.stadium?.playOnlyOverStadium;
  if (over === undefined || state.stadium === null) return false;
  return cardOfUid(state, state.stadium.uid)?.name === over;
}

/** 🆕🆕🆕 §7.3 (D642) — Ange Floette's *"only if you discard a Prism Tower in play"* is UNMET: the card names a
    Stadium and that Stadium is not the one in play (R-ANF1). False for every card without the key. The ONE
    answer `playStadium` refuses on (`PLAY_CONDITION_NOT_MET`) and both Trainer lists (redact.ts
    `redactedTrainersOf`, GameHud.tsx) grey a Stadium row on. */
export function stadiumPlayOverUnmet(state: GameState, card: Card): boolean {
  return programFor(card.id)?.stadium?.playOnlyOverStadium !== undefined && !stadiumPlayOverMet(state, card);
}

/** 🆕🆕🆕 §7.3 (D642) — Ange Floette's *"you can put this card into play during the same turn you play Prism
    Tower"*: the turn's spent Stadium play does not refuse `card` while the Stadium it names is in play AND is
    `seat`'s own (R-ANF2 — read off the board; no new persisted key). A stated limitation, pinned: an actor whose
    own earlier Prism Tower is still in play and whose Stadium play this turn FAILED (Quaking Fist tails, R-QF1) is
    let through too. Asked by `playStadium` and both Trainer lists beside `allowances.stadiumPlayed`. */
export function stadiumSpentPlayLifted(state: GameState, seat: Seat, card: Card): boolean {
  return stadiumPlayOverMet(state, card) && state.stadium?.owner === seat;
}

/** §7.4 — attach a Pokémon Tool from hand to one of the actor's own in-play
    Pokémon. Not capped per turn and consumes NO allowance (unlike energy);
    one Tool per Pokémon at a time [🆕🆕🆕 D643 (D539): up to `toolCapOf` — 2 on a Rotom under Multi Adapter]; there is no detach — it rides the stack
    through evolution and leaves play only with a KO. Its effects are
    continuous (continuous.ts), so nothing runs here. */
/** 🆕🆕🆕 D643 — the refusal's words: §7.4's one Tool, or the Multi Adapter cap a body already carries. */
function toolCapMessage(carried: number): string {
  return carried <= 1 ? "one Tool per Pokémon (§7.4)" : `at most ${carried} Pokémon Tools on this Pokémon (Multi Adapter)`;
}

export function attachTool(state: GameState, action: AttachToolAction): ApplyResult {
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
  if (card.category !== "Trainer" || card.trainerType !== "Tool") {
    return err("NOT_A_TOOL", `${card.name} is not a Pokémon Tool card`);
  }
  // §7.4 (D284) — THE FOURTH READ SITE, and the only one the family's other
  // printing does not need. Jellicent ex `sv10.5w-045`/`-160`/`-168` prints
  // *"can't play any Item cards **or Pokémon Tool cards**"*; a Tool never passes
  // through `playTrainer`'s gate (the `trainerType === "Tool"` branch turns it
  // away ~180 lines up), so a bar wired only there would honour exactly half of
  // that one sentence — the Items refused and the Tools landing.
  //
  // ⚠️ ORDER: ABOVE the "is it simulated" check and above every §7.4 mechanic
  // (target shape, an occupied Tool slot), for `playTrainer`'s reason inverted.
  // There the bar sits AFTER §4/§7.2 because those are the player's OWN limits
  // and should name themselves first; here every check below is about the CARD
  // and the BOARD rather than about a rule the player broke, so an opponent's bar
  // is the honest first answer — a barred seat should not learn "one Tool per
  // Pokémon" about an attach the rules never let it attempt.
  //
  // ⚠️ `handPlayBarred` AND NOT A SECOND PREDICATE: this site reads the SAME
  // funnel `playTrainer` does, so the stamped source (which can never name
  // `"Tool"`, by `StampedHandPlayClass`) is asked and answers `false` here
  // without this line knowing there are two sources at all.
  if (handPlayBarred(state, action.seat, "Tool", card)) {
    return err(
      "HAND_PLAY_BLOCKED",
      "your opponent prevents you from playing Pokémon Tool cards from your hand",
    );
  }
  // 🆕🆕🆕 D565 — the predicate is EXTRACTED to `toolCardSimulated` (continuous.ts) and
  // shared with Impromptu Carrier's deck-search attach, so the two cannot disagree.
  if (!toolCardSimulated(card)) {
    // Coverage strategy: an unauthored Tool would occupy the one Tool slot
    // while doing nothing — reject loudly instead.
    //
    // ⚠️ `passive !== undefined` WAS THE WHOLE TEST UNTIL D171, AND IT BELONGED TO
    // THE TOOLS THAT EXISTED RATHER THAN TO THE QUESTION. Every authored Tool up to
    // Vengeful Punch expressed its printed sentence as continuous NUMBERS, so "has a
    // passive" and "is simulated" were the same predicate by accident. Exp. Share
    // sv01-174 is the first Tool whose sentence is a `triggered` program and NO
    // passive at all — under the old gate the engine would have refused to attach a
    // Tool it fully simulates, with "not simulated yet". The test now asks what it
    // always meant: does this card DO anything while attached?
    return err("TRAINER_NOT_SIMULATED", `${card.name} is not simulated yet`);
  }
  // Wire shape check (types are not validation), then the same indexed
  // write-back attachEnergy uses — including its string-index trap.
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "tool target must name the Active spot or a bench index");
  }

  const hand = without(side.hand, action.uid);
  let updated: PlayerSide;
  if (action.target.spot === "active") {
    if (side.active === null) {
      return err("NO_TARGET", "no Active Pokémon to attach to");
    }
    // 🆕🆕🆕 D643 — the cap is `toolCapOf`'s: 1, or Multi Adapter's 2 on a Rotom.
    if (side.active.tools.length >= toolCapOf(state, action.seat, side.active)) {
      return err("TOOL_ALREADY_ATTACHED", toolCapMessage(side.active.tools.length));
    }
    updated = {
      ...side,
      hand,
      active: { ...side.active, tools: [...side.active.tools, action.uid] },
    };
  } else {
    const index = action.target.index;
    const benched = isBenchIndex(index) ? side.bench[index] : undefined;
    if (benched === undefined) {
      return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(index)}`);
    }
    if (benched.tools.length >= toolCapOf(state, action.seat, benched)) {
      return err("TOOL_ALREADY_ATTACHED", toolCapMessage(benched.tools.length));
    }
    const bench = side.bench.map((pokemon, i) =>
      i === index ? { ...pokemon, tools: [...pokemon.tools, action.uid] } : pokemon,
    );
    updated = { ...side, hand, bench };
  }
  // 🆕🆕🆕 D636 — Quaking Fist (R-QF1): a Tool is a Trainer card used from hand, so the try flips — AFTER the
  // target and slot checks above (only a legal attach flips); tails discards the Tool.
  const flip = trainerFlipFails(state, action.seat, action.uid);
  if (flip?.failed === true) return ok(flip.state, flip.events);
  const flipped = flip?.state ?? state;
  const events: GameEvent[] = [
    ...(flip?.events ?? []),
    // The target is copied: the action object belongs to the caller (events.ts).
    { type: "TOOL_ATTACHED", seat: action.seat, uid: action.uid, target: { ...action.target } },
  ];
  // §12 (D176) — the THIRD route by which a recovery source can NEWLY cover a body,
  // and the one D174's seam MISSED. `recoverStatuses` reads `passivesOf`, which has
  // always folded every attached Tool's passive, so the READ was free from the day
  // the field landed; what was not free is the MOMENT. D174 named two of them (the
  // §6.2 attach in turn.ts, the completion of any effect program in settleProgram)
  // and its own comment claimed "a Tool printing the same clause would arrive for
  // free" — false, because a Tool arrives HERE, and this function returns `ok`
  // straight out without ever running a program or reaching settleProgram.
  //
  // ⚠️ NO CARD PRINTS `statusRecovery` ON A TOOL TODAY, so this line changes no
  // board in the current catalog — it is here so the invariant is a property of the
  // ENGINE rather than of what the registry happens to contain, which is the same
  // reason D174 put the sweep behind a seam instead of at five call sites.
  //
  // The early-return audit turn.ts made at its own attach holds here unchanged and
  // for the same reason: all six guards above (`turnGate`, hand, unknown-card,
  // not-a-Tool, not-simulated, the target/slot checks) belong to the ATTACH term
  // alone, and a Tool that does not attach covers nothing new.
  //
  // Placed AFTER `withSide` because the fold reads `pokemon.tools` (🆕🆕🆕 D562: through
  // `toolsInEffect`, which is `pokemon.tools` unless Jamming Tower is in play): the Tool must
  // already be on the body for its own clause to be one of the sources. A BENCH
  // target sweeps nothing (the sweep is Active-only, §12) — correct rather than
  // incomplete, since a benched body carries no conditions to recover from.
  return ok(recoverStatuses(withSide(flipped, action.seat, updated), events), events);
}

/** §7.1 — Rare Candy: evolve one of the actor's own Basic Pokémon straight to a
    Stage 2 from hand, skipping the Stage 1. An Item (unbounded per turn, no
    allowance), but it EVOLVES rather than running an interpreter program — so it
    reuses the shared evolution placement (turn.ts placeEvolution) and thus the
    on-evolve triggered Ability + the evolve-below-HP mid-turn KO, exactly like
    `evolve`. Timing mirrors evolve (§4 first-turn ban + not a Basic that came
    into play this turn). Every wire value is runtime-checked (the D14 contract):
    the target shape and index, both hand uids, and the Basic-and-chain link. */
export function rareCandy(state: GameState, action: RareCandyAction): ApplyResult {
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
  if (card.category !== "Trainer") {
    return err("NOT_A_TRAINER", `${card.name} is not a Trainer card`);
  }
  if (programFor(card.id)?.rareCandy !== true) {
    return err("TRAINER_NOT_SIMULATED", `${card.name} is not Rare Candy`);
  }
  // §7.1 (D286) — THE BAR REACHES RARE CANDY, AND FIXING THAT IS THIS SLICE'S
  // OTHER HALF. D283 scoped the `"Item"` bar OFF this action with the stated
  // reason *"it is not played through `playTrainer`'s Item branch at all"* — an
  // ENGINE-SHAPE argument wearing a rules argument's clothes. **RARE CANDY IS AN
  // ITEM CARD PLAYED FROM HAND** (`trainer_type = "Item"`, and its own printed
  // sentence says *"You can't **use** this card during your first turn"*), so
  // Galvantula ex / Budew / Frillish (the stamped source) and Tyranitar /
  // Jellicent ex (the continuous one) all stop it, and until this line none of
  // them did.
  //
  // 🛑 **THIS IS NOT IN TENSION WITH D285's REFUSAL OF RARE CANDY FROM THE
  // POKÉMON-SURFACE BAR, AND THE REASON IS THAT THE TWO READINGS HAVE DIFFERENT
  // OBJECTS.** One Rare Candy play moves TWO cards out of one hand:
  //   • RARE CANDY ITSELF — an Item the player PLAYS. The `"Item"` bar's object,
  //     and this gate.
  //   • THE STAGE 2 — *"**put** that card onto the Basic Pokémon to evolve it"*
  //     (the card's printed effect). A card the ITEM'S EFFECT PUTS, not one the
  //     player plays from hand, so Bronzong's *"can't play any Pokémon from their
  //     hand **to evolve** their Pokémon"* and Arbok's *"can't play any Pokémon …
  //     from their hand"* both miss it — `pokemonPlayBarred` is deliberately NOT
  //     asked here, and `effects.ts`'s `PokemonPlayAct` says so on the type.
  // **BOTH READINGS ARE PRINTED AND BOTH HOLD AT ONCE**; what conflicted was
  // D283's stated REASON, not either conclusion. The observable consequence is an
  // ASYMMETRY the suite drives in one breath: a seat barred by Bronzong may still
  // Rare Candy, and a seat barred by Budew may not.
  //
  // ⚠️ ORDER: `playTrainer`'s ITEM ordering exactly, which is why it sits here and
  // not below the printed bans. There the bar comes immediately after "is it
  // simulated" — §4/§7.2 are SUPPORTER-only, so for an Item nothing precedes it —
  // and ABOVE `trainerPlayableIf`, the card's own printed gate. Rare Candy's
  // first-turn / came-into-play-this-turn bans ARE its `trainerPlayableIf`
  // analogue (printed on the card, naming its own use), so they belong below, and
  // the target resolution below them is board fact that a barred seat has no
  // business being told about at all (`attachTool`'s reason).
  if (handPlayBarred(state, action.seat, "Item", card)) {
    return err(
      "HAND_PLAY_BLOCKED",
      "your opponent prevents you from playing Item cards from your hand",
    );
  }
  // Resolve the target Basic (the actor's own in-play) — wire shape check, then
  // the string-index trap at the bench use site (same as attachEnergy/evolve).
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "Rare Candy target must name the Active spot or a bench index");
  }
  let target: InPlayPokemon;
  let benchIndex = -1;
  if (action.target.spot === "active") {
    if (side.active === null) return err("NO_TARGET", "no Active Pokémon to evolve");
    target = side.active;
  } else {
    benchIndex = action.target.index;
    const benched = isBenchIndex(benchIndex) ? side.bench[benchIndex] : undefined;
    if (benched === undefined) {
      return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(benchIndex)}`);
    }
    target = benched;
  }
  const fromUid = topUid(target);
  const targetCard = fromUid === undefined ? undefined : cardOfUid(state, fromUid);
  if (fromUid === undefined || targetCard === undefined) {
    return err("UNKNOWN_CARD", "the target Pokémon has no resolvable top card");
  }
  // §7.1 — the target must be a BASIC in play, and not one that came into play
  // this turn (the same window evolve rejects with EVOLVE_TOO_SOON).
  if (!isBasicPokemon(targetCard)) {
    return err("NOT_A_BASIC_POKEMON", "Rare Candy only evolves a Basic Pokémon (§7.1)");
  }
  // §7.1/§4 — no Rare Candy on your own first turn (the same ban evolve carries,
  // through the SAME reader since D275: `isFirstTurnOf`, types.ts).
  //
  // 🛑 **D278 — EEVEE'S "BOOSTED EVOLUTION" LICENCE DELIBERATELY DOES *NOT* REACH
  // THESE TWO LINES, AND THE ARGUMENT IS THE PRINTED TEXT OF *THIS* CARD.** The
  // §4/§10 evolve licence (`evolveEarlyLicensed`, continuous.ts) lifts the two
  // bans in `evolve` (turn.ts) because those bans are RULES about a Pokémon
  // evolving, and the Ability is printed on the Pokémon. Rare Candy's are not
  // inherited rules: the card prints its OWN restriction — *"You can't use this
  // card during your first turn or on a Basic Pokémon that was put into play this
  // turn."* (registry.ts `RARE_CANDY`) — and an Ability on the TARGET cannot lift
  // a restriction printed on a DIFFERENT card that names its own use. The two
  // clauses coincide with §4/§10 exactly, which is why one reader served both and
  // why the distinction is easy to miss.
  // ⚠️ **AND IT IS UNREACHABLE EITHER WAY, MEASURED**: the pool contains ZERO
  // Standard-legal Stage 2 whose `evolveFrom` names any Stage 1 that evolves from
  // Eevee, Karrablast or Shelmet (registry.ts `BOOSTED_EVOLUTION`, census rung 4),
  // so no board can tell the two readings apart today. **The refusal is recorded
  // rather than the permission guessed** — a licence wired on an unreachable path
  // is a decision nobody can ever see being wrong.
  if (isFirstTurnOf(state, action.seat)) {
    return err("FIRST_TURN_EVOLVE", "cannot use Rare Candy on your first turn (§4/§7.1)");
  }
  if (target.turnPlayed >= state.turn) {
    return err(
      "EVOLVE_TOO_SOON",
      `${targetCard.name} came into play this turn — Rare Candy cannot evolve it (§7.1)`,
    );
  }
  // §7.1 — the Stage 2 in hand that evolves (through its Stage 1) from that
  // Basic. Distinct from the Rare Candy card itself, actually in hand, a valid
  // chain (stage2EvolvesFromBasic bridges Basic→Stage 2 via the Stage 1 name).
  if (action.evolutionUid === action.uid || !side.hand.includes(action.evolutionUid)) {
    return err("CARD_NOT_IN_HAND", `${action.evolutionUid} is not in ${action.seat}'s hand`);
  }
  const stage2 = cardOfUid(state, action.evolutionUid);
  if (stage2 === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${action.evolutionUid}`);
  }
  if (!stage2EvolvesFromBasic(state, stage2, targetCard.name)) {
    return err(
      "RARE_CANDY_NO_STAGE2",
      `${stage2.name} is not a Stage 2 that evolves from ${targetCard.name} (§7.1)`,
    );
  }
  // Play it: Rare Candy → discard, the Stage 2 leaves hand onto the stack. Both
  // leave hand together (up front), then the shared placement runs the evolve +
  // its on-evolve trigger + the evolve-below-HP mid-turn KO check.
  // 🆕🆕🆕 D636 — Quaking Fist (R-QF1): Rare Candy is the Trainer tried; tails discards it and the Stage 2 stays.
  const flip = trainerFlipFails(state, action.seat, action.uid);
  if (flip?.failed === true) return ok(flip.state, flip.events);
  const hand = without(without(side.hand, action.uid), action.evolutionUid);
  const stateAfterHand = withSide(flip?.state ?? state, action.seat, {
    ...side,
    hand,
    discard: [...side.discard, action.uid],
  });
  const events: GameEvent[] = [
    ...(flip?.events ?? []),
    { type: "TRAINER_PLAYED", seat: action.seat, uid: action.uid, trainerType: "Item" },
  ];
  return placeEvolution(
    stateAfterHand,
    action.seat,
    action.target,
    benchIndex,
    target,
    fromUid,
    action.evolutionUid,
    events,
  );
}

/** Rare Candy (§7.1): does `stage2` (a card in the actor's hand) evolve —
    through its Stage 1 — from a Basic named `basicName`? The catalog stores only
    each card's IMMEDIATE `evolveFrom` (a Stage 2 names its Stage 1, never the
    Basic), so we BRIDGE: `stage2.evolveFrom` names a Stage 1, and some card in
    the pool with that Stage-1 name evolves from `basicName`. The bridge Stage 1
    need not be in play or hand — only KNOWN to the card pool (the two decks'
    cards). DOCUMENTED GAP: a deck that runs no copy of the Stage 1 at all cannot
    resolve the link until the full evolution family is persisted at ingest (the
    same ingest-debt class as prizeValueOf = 1 and name-derived energy). */
function stage2EvolvesFromBasic(state: GameState, stage2: Card, basicName: string): boolean {
  if (stage2.category !== "Pokemon" || stage2.stage !== "Stage2") return false;
  const stage1Name = stage2.evolveFrom;
  if (stage1Name === null) return false;
  return Object.values(state.cardPool).some(
    (c) => c.stage === "Stage1" && c.name === stage1Name && c.evolveFrom === basicName,
  );
}

/** A legal Rare Candy play the HUD can offer (§7.1): one of the actor's Basics
    in play that has ≥1 matching Stage 2 in hand. The engine authority the Rare
    Candy dialog reads so it never offers an illegal pairing — the `rareCandy`
    handler still re-validates every wire value. */
export interface RareCandyOption {
  /** The Basic's spot (Active or a bench index). */
  target: PokemonTarget;
  /** The Basic's stack-top uid (display / stable key). */
  basicUid: string;
  /** The matching Stage 2 uids in the actor's hand. */
  stage2Uids: string[];
}

/** Every legal Rare Candy target for `seat` right now (empty on the first turn
    — the §4 ban — or when no Basic-in-play links to a Stage 2 in hand). Mirrors
    the handler's Basic / turnPlayed / chain checks, so an option here always
    resolves to a legal `rareCandy` action. */
export function rareCandyOptions(state: GameState, seat: Seat): RareCandyOption[] {
  // D278 — STILL a seat-wide early return, and that is now a load-bearing
  // MIRROR rather than an accident: the handler above does not consult the
  // §4/§10 evolve licence, so this projection must not either. If Rare Candy's
  // printed restriction is ever re-read the other way, BOTH move together.
  if (isFirstTurnOf(state, seat)) return [];
  // §7.1 (D286) — THE SECOND SEAT-WIDE EARLY RETURN, AND IT IS HERE BECAUSE THIS
  // FUNCTION'S OWN DOCSTRING PROMISES IT. *"Mirrors the handler's … checks, so an
  // option here always resolves to a legal `rareCandy` action"* — the moment the
  // handler above gained an `"Item"` bar, that promise became FALSE for a barred
  // seat, and this line is what makes it true again rather than a comment
  // explaining why it is not. ⚠️ **A PLAY-LEGALITY RULE IN A TARGET ENUMERATOR IS
  // NOT A CATEGORY ERROR HERE, AND THE LINE ABOVE IS THE PRECEDENT**: §4's
  // first-turn ban is play legality too, and it is already folded seat-wide for
  // exactly this reason.
  //
  // ⚠️ THIS IS WHAT MAKES THE TWO MIRRORS FREE. `redact.ts` reads this function
  // TWICE — once for the row's `disabled` flag (`rareCandyPlayable`) and once for
  // the dialog's target list (`redactedRareCandyOf`) — and `GameHud.tsx` reads it
  // for the local twin. Widening HERE is why the wire stops OFFERING targets a
  // barred seat cannot use, which greying the row alone would not have done: the
  // row is what a client disables, the option list is what it would have opened.
  // ⚠️ **`undefined` FOR THE CARD, AND IT IS TYPED OUT RATHER THAN DEFAULTED**
  // (D291). This enumerator is reached only for a Rare Candy, which is an ITEM at
  // a non-ACE-SPEC rarity on all four of its printings, so the rarity source can
  // never fire here and the honest value is "no card". The parameter is REQUIRED
  // precisely so this reads as a decision instead of an omission.
  if (handPlayBarred(state, seat, "Item", undefined)) return [];
  const side = state.players[seat];
  const options: RareCandyOption[] = [];
  const consider = (pokemon: InPlayPokemon | null, target: PokemonTarget) => {
    if (pokemon === null || pokemon.turnPlayed >= state.turn) return;
    const uid = topUid(pokemon);
    const card = uid === undefined ? undefined : cardOfUid(state, uid);
    if (uid === undefined || card === undefined || !isBasicPokemon(card)) return;
    const stage2Uids = side.hand.filter((h) => {
      const c = cardOfUid(state, h);
      return c !== undefined && stage2EvolvesFromBasic(state, c, card.name);
    });
    if (stage2Uids.length > 0) options.push({ target, basicUid: uid, stage2Uids });
  };
  consider(side.active, { spot: "active" });
  side.bench.forEach((pokemon, index) => consider(pokemon, { spot: "bench", index }));
  return options;
}

/** The `${uid}:${ability.name}` sentinel a `"sharedByName"` Ability keys on
    INSTEAD of its own uid, so every copy of the card on a board collides into one
    entry. Safe as a sentinel because a uid is `` `${seat}#${index}` `` (setup.ts)
    and can never be `*` — the two key spaces are disjoint by construction. */
const SHARED_ABILITY_UID = "*";

/** THE SOLE FUNNEL FOR THE §9/§15.J ONCE-PER-TURN KEY (D272). Three readers gate
    on `allowances.abilitiesUsed` — `useAbility` below (which also WRITES it),
    `redactedAbilitiesOf` (redact.ts, the online HUD) and the local `GameHud` —
    and each of them hand-spelled `` `${uid}:${ability.name}` `` until the scope
    stopped being uniform. It is one line of string building, and that is exactly
    why it has to be shared: a per-body reader looking at a name-keyed write
    would grey nothing and afford a click the engine then refuses.

    `"sharedByName"` (Fezandipiti ex's "You can't use more than 1 Flip the Script
    Ability each turn") drops the uid; every other Ability keeps it. Callers pass
    the whole `AbilityProgram` rather than a scope argument so there is no way to
    ask about one ability's name under another's scope. */
export function abilityUsedKey(
  uid: string,
  // 🆕🆕🆕 D565 — WIDENED from `AbilityProgram` to the two fields the key reads, so a
  // TRIGGERED row's `oncePerTurn` (Zero to Hero, triggers.ts) keys through this same
  // funnel instead of re-spelling `${uid}:${name}`.
  ability: Pick<AbilityProgram, "name"> & { oncePerTurn?: AbilityProgram["oncePerTurn"] },
): string {
  const keyUid = ability.oncePerTurn === "sharedByName" ? SHARED_ABILITY_UID : uid;
  return `${keyUid}:${ability.name}`;
}

/** 🆕 **D310 — THE SOLE FUNNEL FOR §9's PER-BODY `remainingHpAtMost` GATE**, for
    the reason `abilityUsedKey` one line up is one [🆕🆕🆕 D572 (D539): "FOR THE
    `remainingHpAtMost` GATE" IS WITHDRAWN as a description of the whole funnel — it is the sole
    funnel for BOTH per-body gates now, `remainingHpAtMost` and Munkidori's
    `requiresEnergyType`, and their ONE reason text is `abilityBodyGateClause` below]: THREE readers consult it —
    `useAbility` below, `redactedAbilitiesOf` (redact.ts) and the local `GameHud` —
    and a per-body gate hand-spelled in three places is the shape that rots into an
    afford-then-reject the moment one of them is edited (D222).

    `true` when the Ability prints no such clause, so every caller can ask
    unconditionally rather than guarding the call.

    🛑 **THE MAXIMUM IS `effectiveMaxHp` AND NOT THE PRINTED `hpOf`.** *"Remaining
    HP"* is measured against the maximum actually in force, so a Bravery Charm
    (+50) lifts a body out of the window it would otherwise sit in. ⚠️ **AND A
    `null` MAXIMUM FAILS THE GATE RATHER THAN PASSING IT** — `effectiveMaxHp` owns
    the catalog data gap, and an unknown maximum cannot be shown to satisfy a
    printed threshold. Refusing is the safe direction: the alternative affords a
    click the resolution would then have to honour on a body whose HP nobody
    knows. */
export function abilityBodyGateMet(
  state: GameState,
  ability: AbilityProgram,
  pokemon: InPlayPokemon,
): boolean {
  // 🆕🆕🆕 D572 — Munkidori "Adrena-Brain"'s *"if this Pokémon has any {D} Energy attached"*,
  // through `hasAttachedEnergy` (the D118 provision rule). Asked FIRST and returning only on a
  // fail, so a row carrying no such field falls through to the HP gate byte-identically.
  // 🆕🆕🆕 D611 — and Dragonair's untyped `"any"`, which `hasAttachedEnergy` answers as "any card".
  if (ability.requiresEnergyType !== undefined && !hasAttachedEnergy(state, pokemon, ability.requiresEnergyType)) {
    return false;
  }
  // 🆕🆕🆕 D636 — Fall Back to Reload's moment as a use-time gate (R-FBR1): this body went down from the
  // Active Spot during the turn now in progress (`benchedTurn`, written by `retreat` / `switchInto`).
  if (ability.benchedThisTurn === true && pokemon.benchedTurn !== state.turn) return false;
  if (ability.remainingHpAtMost === undefined) return true;
  // 🆕 D349 — WAS THIS FUNCTION'S OWN THREE LINES, NOW `remainingHpWithin`
  // (continuous.ts). The arithmetic is byte-identical; what changed is that the
  // printed phrase *"N HP or less remaining"* now has ONE spelling for all three
  // of its printed SUBJECTS — this HOST gate, `gust`'s candidate scan and
  // `healChosen`'s. D310 made the gate a sole funnel for its three READERS; this
  // makes the PREDICATE a sole funnel for its three subjects, which is the same
  // rule one level down.
  return remainingHpWithin(state, pokemon, ability.remainingHpAtMost);
}

/** 🆕🆕🆕 D572 — THE ONE SPELLING of the per-body gate's printed clause (minus "if"), for the three
    readers' reason text: `useAbility`'s reject, `redactedAbilitiesOf`'s and `GameHud`'s greyed-row
    reason. The Energy clause first, `abilityBodyGateMet`'s own order; `null` for a row with no
    per-body gate. */
export function abilityBodyGateClause(ability: AbilityProgram): string | null {
  // 🆕🆕🆕 D611 — the untyped clause prints no type word.
  if (ability.requiresEnergyType === "any") return "this Pokémon has any Energy attached";
  if (ability.requiresEnergyType !== undefined) {
    return `this Pokémon has any ${ability.requiresEnergyType} Energy attached`;
  }
  if (ability.remainingHpAtMost !== undefined) {
    return `this Pokémon's remaining HP is ${ability.remainingHpAtMost} or less`;
  }
  // 🆕🆕🆕 D636 — Fall Back to Reload (R-FBR1).
  if (ability.benchedThisTurn === true) return "this Pokémon moved from the Active Spot to your Bench this turn";
  return null;
}

/** §9 — use an in-play Pokémon's activated Ability. Does not cost energy, does
    not end the turn (once-per-turn per Pokémon, tracked in TurnAllowances). */
export function useAbility(state: GameState, action: UseAbilityAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "ability target must name the Active spot or a bench index");
  }
  const resolved = resolveOwnPokemon(state, action.seat, action.target);
  if (resolved.reject !== undefined) return resolved.reject;
  const uid = resolved.uid;
  const card = cardOfUid(state, uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${uid}`);
  }
  const ability = (programFor(card.id)?.abilities ?? []).find((a) => a.name === action.abilityName);
  if (ability === undefined) {
    return err("NO_SUCH_ABILITY", `${card.name} has no usable Ability "${action.abilityName}"`);
  }
  // §9 — a continuous Ability-lock aura (Klefki / Spiritomb / Ting-Lu ex — 🆕🆕🆕 D559:
  // and Flutter Mane / Gastrodon, the two legal locks the registry builds — Iron
  // Thorns ex "Initialization" and Team Rocket's Watchtower are legal and unbuilt; D539 —
  // 🆕🆕🆕 D566 (D539): the Watchtower is BUILT, the first Stadium-sourced lock — 🆕🆕🆕 D571
  // (D539): and Initialization is BUILT, so the legal Pokémon locks the registry builds are
  // Flutter Mane / Gastrodon / Iron Thorns ex, settled by the stratified pass, R-LK2 — 🆕🆕🆕 D632
  // (D539): and Damp, Psyduck / Golduck, over self-Knock-Out bodies only) turns
  // this Pokémon's Abilities off. Checked before activeOnly/oncePerTurn/cost so a
  // locked Pokémon reports the lock, not an incidental cost failure.
  if (disabledAbilityUids(state).has(uid)) {
    return err("ABILITY_DISABLED", `${card.name} has no Abilities right now (§9)`);
  }
  if (ability.activeOnly && action.target.spot !== "active") {
    return err("ABILITY_ACTIVE_ONLY", `${ability.name} can only be used from the Active Spot (§9)`);
  }
  // 🆕🆕🆕 D565 — the mirror spot (Flustered Leap: "if this Pokémon is on your Bench"),
  // beside `activeOnly` and for its reasons: a SPOT, read off the action's target.
  if (ability.benchOnly === true && action.target.spot !== "bench") {
    return err("ABILITY_BENCH_ONLY", `${ability.name} can only be used from the Bench (§9)`);
  }
  const usedKey = abilityUsedKey(uid, ability);
  if (ability.oncePerTurn && state.allowances.abilitiesUsed.includes(usedKey)) {
    return err("ABILITY_ALREADY_USED", `${ability.name} was already used this turn (§9)`);
  }
  // The Ability's own printed board gate — Fezandipiti ex's "if any of your
  // Pokémon were Knocked Out during your opponent's last turn". The
  // `trainerPlayableIf` sibling, sharing its `BoardCondition` and its
  // `conditionHolds`, exactly as that field's doc block called for.
  //
  // ⚠️ ORDER IS DELIBERATE: BELOW the once-per-turn lock, not above it. Both
  // rejects can be true at once — a player who already drew this turn is very
  // often looking at a board where the KO window has also closed — and of the
  // two, "you already used it" is the one that tells them something they did not
  // know. A gate checked first would mask ABILITY_ALREADY_USED on every such
  // board and the lock's own reject would be nearly unreachable.
  //
  // And ABOVE `programPlayable`/`handCostUnmet` for the reason the Trainer path
  // orders them the same way: a printed RULE outranks the engine's
  // would-only-whiff heuristic, so the message names the clause on the card.
  if (ability.playableIf !== undefined && !conditionHolds(state, action.seat, ability.playableIf)) {
    return err(
      "ABILITY_CONDITION_NOT_MET",
      `${ability.name} can only be used if ${conditionNote(ability.playableIf)} (§9)`,
    );
  }
  // 🆕 D310 — the §9 printed PER-BODY gate (Pidove `sv05-133`: "if this Pokémon's
  // remaining HP is 30 or less"). Beside the board gate and not folded into it:
  // `conditionHolds` takes a seat and no uid, so a self-pronoun has no referent in
  // it — the `playableIf` doc block in registry.ts has said so since D272.
  //
  // ⚠️ SAME ORDER AND FOR THE SAME REASON: BELOW the once-per-turn lock, so a
  // player who already used it this turn is told THAT rather than being told about
  // an HP window they can see on the card. And it REUSES
  // `ABILITY_CONDITION_NOT_MET` rather than minting a code — both rejects mean "a
  // printed clause on this card says no", the client renders the message, and a
  // second code would split one concept across two branches for every reader.
  //
  // `resolved.pokemon` is the very body `uid` names, so the gate and the run ask
  // about the same Pokémon (D222's rule, one gate over).
  if (!abilityBodyGateMet(state, ability, resolved.pokemon)) {
    return err(
      "ABILITY_CONDITION_NOT_MET",
      // 🆕🆕🆕 D572 — the clause through `abilityBodyGateClause`, so the Energy gate names itself.
      `${ability.name} can only be used if ${abilityBodyGateClause(ability) ?? "its printed condition holds"} (§9)`,
    );
  }
  // A card that would do NOTHING cannot be used — the snipe needs an opponent
  // Bench, exactly as a gust needs one (the shared programPlayable gate). This
  // also guards Meowscarada's discard cost from being spent for no effect.
  //
  // D222 — `uid` IS THE SAME UID `runProgram` PUTS ON THE CONTEXT BELOW, and
  // passing it here is what keeps the gate and the run asking about the same
  // Pokémon: Iono's Kilowattrel's printed board cost ("discard a Basic {L}
  // Energy from THIS Pokémon") is refused here when this body holds none.
  if (!programPlayable(state, ability.program, action.seat, uid)) {
    return err("NO_LEGAL_TARGET", `${ability.name} has no legal target`);
  }
  // §9 activation cost — the printed "You must discard … from your hand in order
  // to use this Ability" (Meowscarada ex, Radiant Blastoise, Revavroom,
  // Tinkaton). The cost is the FIRST op of the Ability's own program, so the
  // payment itself happens in the interpreter (it can PARK on which cards); what
  // has to happen HERE is refusing the use before anything is committed, since a
  // program that ran with an unpayable cost would hand out the effect for free.
  //
  // No `excludeUid`: an Ability's card is on the BOARD, not in the hand it pays
  // out of — which is why none of these cards prints the "other" that every
  // Trainer in the family does.
  const unpayable = handCostUnmet(state, action.seat, ability.program);
  if (unpayable !== null) {
    return err(
      "ABILITY_COST_UNMET",
      // The VERB comes from the destination, like the Trainer path's message: no
      // printed Ability pays anywhere but the discard today, and a message that
      // hard-codes "discard" is the same latent bug the Trainer side just fixed.
      `${ability.name} can only be used if you ${handCostAction(unpayable, false)} (§9)`,
    );
  }

  const events: GameEvent[] = [
    { type: "ABILITY_USED", seat: action.seat, uid, ability: ability.name },
  ];
  let next = state;
  if (ability.oncePerTurn) {
    next = {
      ...next,
      allowances: {
        ...next.allowances,
        abilitiesUsed: [...next.allowances.abilitiesUsed, usedKey],
      },
    };
  }
  return settleProgram(
    // 🆕🆕🆕 D614 — `invokedBy: "ability"`: the §11 ability channel (Luminous Wing).
    runProgram(next, ability.program, { seat: action.seat, sourceUid: uid, invokedBy: "ability" }, events),
    action.seat,
    events,
    { endsTurn: ability.endsTurn === true },
  );
}

/** §7.3 — activate the shared Stadium's "once during each player's turn" ability
    (Artazon / Mesagoza / Town Store). Simpler than useAbility: there is exactly
    ONE shared Stadium, so no target; the turnGate admits only the turn's own
    player (turn:action, phase.seat), so "each player's turn" needs no
    non-active-seat routing — the opponent activates it on THEIR own turn, off
    their own fresh allowance. Not affected by the D100 ability-lock aura (that
    targets Pokémon, and a Stadium is neither). No hand-cost path: no printed
    Stadium ability pays one. The program runs under the activating seat, so it
    searches THAT player's deck and benches onto THEIR board.
    🆕🆕🆕 D561 — "No hand-cost path: no printed Stadium ability pays one" is
    WITHDRAWN (D539), kept above as written: Academy at Night `sv06.5-054` (*"Once
    during each player's turn, that player may put a card from their hand on top of
    their deck."*) is a Stadium ability whose whole program is a `payFromHand { count:
    1, to: "deckTop" }`, so this path now asks `handCostUnmet` beside
    `programPlayable`, exactly as the Trainer and Ability paths do — an EMPTY hand is
    refused (`PLAY_CONDITION_NOT_MET`) rather than spending the turn's one use on
    nothing (R-AN; reversal: a ruling that the once-per-turn use may be declared into
    an empty hand). No `excludeUid`: the Stadium is in the shared zone, not the hand. */
export function useStadiumAbility(state: GameState, action: UseStadiumAbilityAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  const stadium = state.stadium;
  if (stadium === null) {
    return err("STADIUM_ABILITY_UNAVAILABLE", "no Stadium is in play (§7.3)");
  }
  const card = cardOfUid(state, stadium.uid);
  const ability = card === undefined ? undefined : programFor(card.id)?.stadium?.ability;
  if (ability === undefined) {
    return err(
      "STADIUM_ABILITY_UNAVAILABLE",
      "the Stadium in play has no activated Ability (§7.3)",
    );
  }
  if (state.allowances.stadiumAbilityUsed) {
    return err(
      "STADIUM_ABILITY_ALREADY_USED",
      `${ability.label} was already used this turn (§7.3)`,
    );
  }
  // 🆕🆕🆕 D564 — the Stadium ability's own PRINTED gate (`StadiumAbility.playableIf`):
  // Community Center's *"if they played a Supporter card from their hand this turn"* and
  // Team Rocket's Factory's *"… that has "Team Rocket" in its name …"*. Read for the ACTOR
  // — "each player's turn" / "they": either seat may use the Stadium on its OWN turn, and
  // `turnGate` above already admits only the turn's seat. Checked AFTER the once-per-turn
  // flag (an already-spent use says so, `useAbility`'s order) and BEFORE `programPlayable`
  // (a printed rule is not a would-only-whiff heuristic, `playTrainer`'s order).
  // (Read through a local: the `useAbility` gate above spells the same test on `ability`,
  // and one spelling per file keeps each anchor unique.)
  const printedGate = ability.playableIf;
  if (printedGate !== undefined && !conditionHolds(state, action.seat, printedGate)) {
    return err(
      "PLAY_CONDITION_NOT_MET",
      `${ability.label} can only be used if ${conditionNote(printedGate)} (§7.3)`,
    );
  }
  // Would-only-whiff gate, exactly as useAbility (Mesagoza's heads-branch search
  // is always playable enough; a search that can only whiff is still a search).
  //
  // D222 — the Stadium's uid rides along, the same one `runProgram` puts on the
  // context below, so the gate and the run agree. It resolves to NO Pokémon (a
  // Stadium is never a stack top), which is the right answer rather than a
  // missing one: a `self` op authored on a Stadium ability has no "this Pokémon"
  // and is refused, instead of quietly stripping the activating seat's Active.
  if (!programPlayable(state, ability.program, action.seat, stadium.uid)) {
    return err("NO_LEGAL_TARGET", `${ability.label} has no legal target`);
  }
  // 🆕🆕🆕 D561 — the printed hand cost, refused before anything is committed (R-AN).
  const unpayable = handCostUnmet(state, action.seat, ability.program);
  if (unpayable !== null) {
    return err(
      "PLAY_CONDITION_NOT_MET",
      `${ability.label} can only be used if you ${handCostAction(unpayable, false)} (§7.3)`,
    );
  }
  const events: GameEvent[] = [
    {
      type: "STADIUM_ABILITY_ACTIVATED",
      seat: action.seat,
      uid: stadium.uid,
      stadium: ability.label,
    },
  ];
  const next: GameState = {
    ...state,
    allowances: { ...state.allowances, stadiumAbilityUsed: true },
  };
  const result = runProgram(next, ability.program, { seat: action.seat, sourceUid: stadium.uid }, events);
  return settleProgram(result, action.seat, events, {
    endsTurn: stadiumUseEndsTurn(ability, events, action.seat),
  });
}

/** 🆕🆕🆕 D606 — does this Stadium use end the actor's turn (`StadiumAbility.endsTurn`)?
    `"always"` (Lumiose City, R-LC1) is unconditional; `"ifHealed"` (Celebratory Fanfare, R-CF1)
    asks whether the use's own program emitted a `HEALED` row for the actor — `events` holds
    only this action's rows, and the program (`healEach`) never parks, so the answer is final
    here. Absent = false (every pre-D606 Stadium). */
function stadiumUseEndsTurn(ability: StadiumAbility, events: readonly GameEvent[], seat: Seat): boolean {
  if (ability.endsTurn === "always") return true;
  if (ability.endsTurn !== "ifHealed") return false;
  return events.some((event) => event.type === "HEALED" && event.seat === seat && event.amount > 0);
}

/** Resolve the parked effect:choose decision: validate the choice against the
    prompt, apply the awaited op, and run the rest of the program (which may
    park again). */
export function resolveEffect(state: GameState, action: ResolveEffectAction): ApplyResult {
  if (state.phase.kind !== "effect:choose") {
    return err("BAD_PHASE", `resolveEffect is not legal during ${state.phase.kind}`);
  }
  const phase = state.phase;
  // Who may ANSWER: the phase's answerer when one is filed (the opponent's
  // printed "may" — Ortega's mayDraw park), else the controller as ever. The
  // controller cannot answer the opponent's "may" for them, and vice versa.
  const answerer = phase.answerer ?? phase.seat;
  if (answerer !== action.seat) {
    return err("WRONG_SEAT", `only ${answerer} resolves this effect`);
  }
  // A resumeTail park is MID-TAIL: the stages that finish the job (the KO sweep's
  // prizes/promotions, or an attack's epilogue) must still be queued behind it,
  // because settleProgram's resumeTail branch hands control to `advance` and
  // writes NO phase of its own — an empty queue there would return this very
  // effect:choose phase again, with the same continuation, forever. Unreachable
  // through the engine's own transitions (both producers queue before they run),
  // so this is the ko:* handlers' crafted-snapshot guard (attack.ts) applied to
  // the one fold that cannot recover on its own.
  if (phase.resumeTail === true && state.pending.length === 0) {
    return err("PHASE_DESYNC", "a mid-tail effect park has no pending tail to resume");
  }
  const invalid = validateChoice(phase.prompt, action.choice);
  if (invalid !== null) return invalid;
  // 🆕🆕🆕 D573 — the COPY-ATTACK park is answered by re-entering `attack()`, not by a program:
  // routed here, after the prompt check and BEFORE `settleProgram`. (A 0.456 deploy has no
  // route and reads the park as inert — `applyChoice`'s default, an empty `rest`, back to
  // `turn:action`; decisions.md D573.)
  const pendingOp = phase.cont.pendingOp;
  if (pendingOp.op === "useAttackAs") return resolveCopiedAttack(state, phase, pendingOp, action.choice);
  // 🆕🆕🆕 D638 — Skill Thief's in-play copy park, the same route (a 0.520 deploy has none: inert, D125).
  if (pendingOp.op === "useInPlayAttackAs") return resolveInPlayCopiedAttack(state, phase, pendingOp, action.choice);
  // 🆕🆕🆕 D574 — the MID-ATTACK copy park (Haughty Order / Seek Inspiration), routed the same way —
  // EXCEPT Haughty Order's *"You may"* DECLINE, which takes the default drain below: no arm applies,
  // the empty `rest` finishes and `resumeTail` runs the queued attack epilogue (exactly what a
  // 0.457 deploy reads off any answer to this park — decisions.md D574).
  const declined = action.choice.kind === "confirm" && !action.choice.yes;
  if (pendingOp.op === "useFoundAttackAs" && !declined) return resolveFoundAttack(state, phase, pendingOp, action.choice);
  const events: GameEvent[] = [];
  // resumeTail (§9 on-KO trigger, flow.ts): this park was made MID-KO-SWEEP, so
  // finishing the program resumes the remaining prize/promotion tail rather than
  // folding back to a turn. Absent for every other parked effect (turn:action).
  return settleProgram(
    resumeProgram(state, phase.cont, action.choice, events),
    phase.seat,
    events,
    {
      resumeTail: phase.resumeTail === true,
      // endsTurn (Koraidon "Dino Cry"): the parked Ability ends the turn once its
      // program finishes, threaded across re-parks by settleProgram.
      endsTurn: phase.endsTurn === true,
    },
  );
}

/** A program whose only effect targets a zone that is empty does nothing, and a
    card/Ability that would do nothing cannot be played (gust and the snipe need
    an opponent Bench, Switch needs your own Bench). Search/draw/heal are always
    "playable enough" (they may whiff — fail a search, heal an undamaged
    Pokémon), which also matches the rule's own limit: the deck is not public
    knowledge, so "this search will find nothing" is not a fact the game state
    establishes. Shared by playTrainer and useAbility — and EXPORTED for the
    HUD's row lighting (D52): every input it reads is public to the seat asking
    (zone counts and the seat's own board), so the web can grey a dead Trainer
    row with the engine's own predicate instead of offering a button the click
    will refuse — the recurring review HIGH, closed at the source.

    ⚠️ **`sourceUid` (D222) — "THIS POKÉMON", FOR THE ONE GATE THAT IS A COST
    RATHER THAN A TARGET.** Every other question this predicate asks is about a
    ZONE (is the opponent's Bench empty, does the hand hold a Basic {G}), and a
    zone answers the same whoever asks. `discardEnergy { from: "self" }` is the
    printed *"You must discard a Basic {L} Energy from **this Pokémon** in order
    to use this Ability"* (Iono's Kilowattrel), and the honest question there is
    about ONE BODY — so the activated Ability's own uid has to reach this far, or
    the gate answers about the wrong Pokémon.

    OPTIONAL, and its absence is a FACT rather than a default: a Trainer has no
    "this Pokémon" (playTrainer passes nothing), so a `self` op inside a Trainer
    program is never playable — the same loud refusal the interpreter's whiff
    would give it. `useAbility` passes the Pokémon's own uid; `useStadiumAbility`
    passes the Stadium's, which resolves to no Pokémon at all (a Stadium is never
    a stack TOP), so a `self` op in a Stadium ability is refused for the reason it
    should be. Every input stays PUBLIC to the seat asking, so the HUD's row
    lighting keeps working — the uid it would pass is one it already reads off its
    own board. */
/** ⚠️⚠️ D351 — THE `attachEnergyFrom` WHIFF TEST, ASKED OF THE **PROGRAM** RATHER
    THAN OF EACH OP. Infernape `svp-116`/`sv06-033`/`sv06-173` "Pyro Dance" —
    *"Once during your turn, you may attach a Basic {R} Energy card, a Basic {F}
    Energy card, **or 1 of each** from your hand to your Pokémon in any way you
    like."* — is TWO `attachEnergyFrom` ops (D263's `ASSEMBLE_ALLOY` reading of
    *"in any way you like"*: N independent decisions landing on N bodies, never one
    batch pinned to one body), and the two ops name DIFFERENT Energy types.

    🛑 **ASKED ONE OP AT A TIME, THE OLD GATE GREYED THE ABILITY OUT ON A HAND
    HOLDING A BASIC {F} AND NO BASIC {R}** — a board the printed sentence names
    explicitly as one of its three outcomes. The per-op AND was not a judgement
    about alternatives; it was a per-op question that had never been asked of a
    program whose ops could disagree. Every multi-op `attachEnergyFrom` producer
    shipped before this row is HOMOGENEOUS — Koraidon "Dino Cry" (`sv01-125`/
    `-231`/`-247`/`-254`) is two ops of the SAME type out of the SAME zone, so its
    two answers are the same answer — and Archaludon's `ASSEMBLE_ALLOY` is an
    `onEvolve` TRIGGER, and triggers never reach this function at all. So the
    defect was UNREACHABLE from a printed row until this one, which is D345's
    `damageChosen` finding at its second instance, one op over.

    **THE RULE IS ruling/284's, APPLIED AT THE UNIT THE RULING NAMES.** A card is
    unplayable only when the game state itself prevents ANY effect from taking
    place. N independent attaches are printed ALTERNATIVES, so the honest question
    is whether ALL of them can only whiff — an `or`, exactly as `coinFlipGate`'s
    two-armed descent (D269) is an `or` over its arms and for the same reason.

    ⚠️ **TOP-LEVEL ONLY, AND THAT IS CONSISTENT RATHER THAN LAZY.** `programPlayable`
    recurses into `coinFlipGate`'s arms with the arm as its own program, so each
    nested program gets its own alternatives set — which is right: a gated attach's
    alternatives are the other attaches under the same gate, not the ones outside it.

    ⚠️ **RETURNS FALSE ONLY WHEN THERE IS AT LEAST ONE ATTACH TO SPEAK FOR.** An
    empty list is not "everything whiffs"; `.every` on `[]` is `true`, which would
    refuse every program in the registry, so the arity guard is load-bearing and
    not defensive. Installed as a mutant (`D351-empty-attach-list-refuses`). */
function attachAlternativesAllWhiff(
  state: GameState,
  program: readonly EffectOp[],
  seat: Seat,
): boolean {
  // 🆕🆕🆕 D561 — Crispin's `oneOfRecorded` attach is NOT an alternative the play gate can
  // ask about: its Energy is what the program's own search puts into the hand, so the
  // hand at play time says nothing about it (the search is always playable enough).
  const attaches = program.filter(
    (op): op is Extract<EffectOp, { op: "attachEnergyFrom" }> =>
      op.op === "attachEnergyFrom" && op.oneOfRecorded === undefined,
  );
  if (attaches.length === 0) return false;
  return attaches.every(
    (op) =>
      firstAttachableEnergy(
        state,
        attachSeat(op, seat), // 🆕 D532 — the printed pile's owner; the gate asks the apply's question
        op.source,
        op.energyType,
        op.anyEnergy,
        op.energyName, // D353 — the play gate asks the apply's question
      ) === undefined ||
      // D532 — `attachEnergyTargets` resolves the OWNER from the riders itself.
      attachEnergyTargets(state, seat, op).length === 0,
  );
}

/** 🆕🆕🆕 **D557 — THE SWEEP ALTERNATIVES, `attachAlternativesAllWhiff`'s RULE ONE FAMILY
    OVER.** Megaton Blower `sv08-182` prints THREE discards in one sentence — *"Discard all
    Pokémon Tools and Special Energy from all of your opponent's Pokémon, and discard a
    Stadium in play."* — and ruling/284 (a card is unplayable only when the game state
    prevents ANY effect) makes that an `or`: the card is refused only when the Tool sweep,
    the Special Energy sweep AND the Stadium discard would ALL find nothing. The per-op
    `discardEnergy` line in the loop below is an AND, which on this card would refuse a
    board holding a Tool but no Special Energy — so `count: "all"` sweeps are answered
    HERE and skipped there. RETURNS FALSE WHEN THE PROGRAM HOLDS NO `"all"` SWEEP (the
    arity guard `attachAlternativesAllWhiff` names): no shipped Trainer or Ability program
    carries one, so every other card is byte-identical through this line. Unshielded
    offers are not consulted, the `discardEnergy` gate's own convention (a shielded board
    plays and files its refusal rows). */
function sweepAlternativesAllWhiff(
  state: GameState,
  program: readonly EffectOp[],
  seat: Seat,
  sourceUid?: string,
): boolean {
  let sweeps = 0;
  let anyActs = false;
  for (const op of program) {
    if (op.op === "discardTools" && op.count === "all") {
      sweeps += 1;
      if (discardableTools(state, seat, op.sides).length > 0) anyActs = true;
    } else if (op.op === "discardEnergy" && op.count === "all") {
      sweeps += 1;
      if (discardEnergyPlayable(state, seat, op, sourceUid)) anyActs = true;
    } else if (op.op === "discardStadium" && state.stadium !== null) {
      anyActs = true;
    }
  }
  return sweeps > 0 && !anyActs;
}

export function programPlayable(
  state: GameState,
  program: readonly EffectOp[],
  seat: Seat,
  sourceUid?: string,
): boolean {
  // No matching Basic Energy in the source zone, OR no eligible target
  // (targetType / notIfKO riders) → that attach can only whiff; when EVERY attach
  // the program spells can only whiff, the card can only whiff. See the function's
  // own doc for why this is an `or` over the ops and why it sits outside the loop.
  if (attachAlternativesAllWhiff(state, program, seat)) return false;
  // 🆕🆕🆕 D557 — the discard SWEEPS are alternatives too (Megaton Blower), answered
  // once over the whole program; see `sweepAlternativesAllWhiff`.
  if (sweepAlternativesAllWhiff(state, program, seat, sourceUid)) return false;
  for (const op of program) {
    if (op.op === "coinFlipGate") {
      // DESCEND INTO THE BRANCHES THAT COULD RUN. On a ONE-ARMED gate that is
      // `then` alone — the LOSING face does nothing at all — so `then` is the
      // only thing the card can ever do; on a two-armed gate (D269's
      // `otherwise`) it is both, and see the `or` below. A branch that could
      // only whiff therefore means the whole
      // card could only whiff, and §7's "you cannot play a card if it has no valid
      // target" applies: the flip is PROCEDURE, not effect (the rulebook's own
      // attack sequence separates "flip a coin" from applying effects), so it
      // cannot be the effect that makes the card playable. Compendium ruling/906
      // ("you cannot play a card if it has no valid target", reconfirmed by the
      // TPCi Rules Team 2025-06-26) with ruling/284 drawing the line this sits
      // on: "playing a card for no effect happens when THE GAME STATE ITSELF
      // prevents any effect from taking place". The apparent counter-precedent
      // (Unown-E's Hidden Power forcing all flips tails, yet flip Trainers stay
      // playable) is the OTHER branch of that same ruling — blocked by an effect
      // in play, not by the board. Reaches Crushing Hammer (no Energy anywhere on
      // the opponent's board) and Pokémon Catcher (an empty opponent Bench);
      // Poké Ball is untouched, since a deck search is always playable enough.
      //
      // ⚠️ FACE-AGNOSTIC BY CONSTRUCTION, AND THAT IS NOW ASSERTED (D144). The
      // argument above never mentions WHICH face splices the branch — only that
      // exactly one branch runs — so `onTails` (D144) needs no code here, and
      // D269's `otherwise` did not change that: the descent reads the ARM SET,
      // never the face that picks from it. That is the kind of claim this engine has three times found
      // to be an accident of the candidate sets (D139 → D140 → D143's `placeSnipe`
      // comment), so it is pinned in `tailsGatedOp.test.ts` rather than left in
      // this comment: a tails-gated whiffable op is refused exactly as a
      // heads-gated one is. No printed TRAINER carries a tails gate today — the
      // pool's only tails-gated Trainer, Egg Incubator swsh10.5-066/-087, is a
      // two-consequent sentence this op cannot express — so the case is a
      // constructed program, which is the honest shape for a rule with no card.
      //
      // NOT extended to `optional` either, and there the argument INVERTS rather
      // than merely running short. A coin gate's `then` is all the card can ever
      // do, so a whiffable branch means a whiffable card; an `optional`'s branch
      // is one of TWO printed outcomes, and the other one — declining — is a legal
      // resolution of the sentence as printed. So a card whose "you may" wraps a
      // whiff-only op still resolves: it asks, and the answer is the effect.
      //
      // NOT extended to `conditionGate`: no printed sv01–03 card puts a
      // whiff-able op inside one (Falkner and Grusha branch into draws), and
      // deciding it properly means EVALUATING the condition here and scanning
      // only the arm that will actually run — a bigger claim than this pure
      // implication, and one no card needs yet.
      // The source rides the descent: a coin-gated `self` discard is still that
      // Pokémon's cost, and dropping the uid here would silently re-ask the
      // question about a Trainer.
      //
      // ⚠️ D269 — AND WITH `otherwise` THE IMPLICATION NEEDS BOTH ARMS. The
      // argument above rests on "`then` is the only thing the card can ever do",
      // which was true only while a coin gate had no second branch. Now exactly
      // ONE of two arms runs and neither is knowable before the flip, so the
      // honest reading of ruling/906 is that the card could only whiff iff BOTH
      // arms could only whiff — an `or`, not an `and`, and refusing on `then`
      // alone would reject a card that does something on the losing face.
      // Unreachable from a printed row today (Picnicker and Drasna put draws in
      // both arms, and a draw is always playable enough), which is exactly why it
      // is written as the rule rather than as the cases: a whiffable two-armed
      // gate is a constructed program, pinned in tailsGatedOp.test.ts.
      if (
        !programPlayable(state, op.then, seat, sourceUid) &&
        (op.otherwise === undefined || !programPlayable(state, op.otherwise, seat, sourceUid))
      ) {
        return false;
      }
      continue;
    }
    // 🆕 D331 — WAS `state.players[otherSeat(seat)].bench.length === 0`, and that
    // is D206's finding one op over, arriving eleven decisions later. A LENGTH
    // test is `gustTargets` only while no printing narrows the set; Lisia's
    // Appeal `sv08-179`/`-234`/`-246` narrows it to Basics, so the length test
    // would have called the Supporter playable into a Bench of pure Evolutions,
    // spent the turn's one Supporter (§7.2) and parked a prompt with no
    // candidates in it. The op's own candidate function answers instead — the
    // `switchActive` line below and the `attachEnergyTargets` one after it — so
    // the refusal and the offer can never disagree. Unchanged on every gust
    // printing that shipped before this one: with no rider the funnel returns
    // `oppBenchRefs`, whose length IS the bench length this used to read.
    if (op.op === "gust" && gustTargets(state, seat, op).length === 0) return false;
    // 🆕🆕🆕 D611 — Spiteful Evolution's *"Choose a card in your hand that evolves from this
    // Pokémon"*: a hand with no such card can only whiff, so the use is refused (the hand is the
    // controller's own zone, unlike the deck `evolveFromDeck` otherwise reads, which stays ungated).
    if (op.op === "evolveFromDeck" && op.fromHand === true && !evolveFromHandAvailable(state, seat, sourceUid)) {
      return false;
    }
    // 🆕🆕🆕 D587 — Repel `me01-126`, the first Trainer with a top-level `opponentSwitchOut`: the
    // `gust` line above with the op's own candidate set (the interpreter parks on `oppBenchRefs`,
    // the whole opponent Bench, unnarrowed), so an empty opponent Bench refuses the Item rather
    // than spending it on nothing (ruling/906 — Bench size is public). No other Trainer or Ability
    // carries the op at top level (its other producers are attack derivations), so every shipped
    // program is unchanged through this line.
    if (op.op === "opponentSwitchOut" && state.players[otherSeat(seat)].bench.length === 0) {
      return false;
    }
    // 🆕🛑 D345 — THE SAME CORRECTION AS THE `gust` LINE ABOVE, ONE OP OVER, AND
    // IT WAS A LIVE DEFECT RATHER THAN A TIDY-UP. This read
    // `players[opponent].bench.length === 0` for EVERY `damageChosen`, which is
    // the `opponentBench` reading alone. It was accidentally right until D345
    // because every REGISTRY producer was a Bench snipe and every `opponentAny`
    // producer was an ATTACK — and attacks never reach this function (§8). The
    // first registry `opponentAny` row ("Cursed Blast") greyed out an Ability
    // whose own op offers the opponent's ACTIVE as a candidate. `snipeTargets` is
    // that op's own funnel, shared exactly as `gustTargets` is.
    // 🆕🆕🆕 **D492 — AND `count: "all"` IS EXEMPT, WHICH IS A CORRECTION RATHER THAN
    // AN EXCEPTION.** This line exists so a pick with no candidates is never OFFERED:
    // a park with an empty prompt is an afford-then-reject. The printed *"each of"*
    // form asks nothing — it resolves inline over whatever the board holds and an
    // empty set is a SILENT NO-OP, exactly as `spreadDamage`'s empty Bench is and as
    // 6a-bis's whole-side pair is (neither of those ops is gated here at all). Left
    // unexempted, this line would grey out a legal attack whenever the opponent
    // happens to field no Pokémon of the printed class — a live afford-then-reject in
    // the OTHER direction, and one no engine test would have seen because attacks do
    // not reach this function (§8) and the only producers today are attacks.
    // 🛑 **SO IT IS UNOBSERVABLE TODAY IN BOTH DIRECTIONS, AND THAT IS RECORDED HERE
    // RATHER THAN GUARDED (D446).** `programPlayable` is module-private and gates §7
    // Trainer play and §9 Ability activation only; the ONLY producer of `count: "all"`
    // is `deriveAttackEffect`, and attacks do not reach this function. So no board can
    // tell this conjunct from its absence — which is not "it does not matter": the day
    // a registry row hand-writes `count: "all"` on an Ability, this line is what
    // decides it, and getting it wrong then would be a live afford-then-reject.
    // ⚠️ **AND NO MUTANT ROW IS WRITTEN FOR IT**, D420's rule plus D442's: a row that
    // changes no answer reports a suite gap that does not exist, and here there is no
    // observable direction at all, so the record IS this comment.
    if (
      op.op === "damageChosen" &&
      op.count !== "all" &&
      snipeTargets(state, seat, op).length === 0
    ) {
      return false;
    }
    // 🆕🛑 D349 — THE THIRD OP TO GET ITS OWN FUNNEL HERE, AND THE FIRST WITH NO
    // PRIOR LINE TO CORRECT. `gust` (D331) and `damageChosen` (D345) each REPLACED
    // a raw bench-length test that a rider had made wrong; `healChosen` had no
    // test at all, and needed none — unnarrowed its candidates are every own
    // in-play Pokémon, which §1.1 makes non-empty at every legal board, so this
    // line can only fire once a rider exists. `remainingHpAtMost` is that rider,
    // and its first printing is Bianca's Devotion — a SUPPORTER, so parking an
    // empty prompt would spend the turn's one Supporter (§7.2) on nothing. Asked
    // unconditionally rather than under an `op.remainingHpAtMost !== undefined`
    // guard: the funnel already answers correctly for the unnarrowed op, and a
    // guard here would be a second place that has to know which riders can empty
    // the set — the exact drift the sole-funnel rule exists to prevent.
    if (op.op === "healChosen" && healChosenTargets(state, seat, op).length === 0) return false;
    // 🆕🆕🆕 D625 — Blowtorch's *"Choose 1"*: no branch with a target and the Item can only whiff (R-BT1);
    // the op's own funnel answers, so the refusal and the offer cannot disagree.
    if (op.op === "chooseOneOffered" && offeredBranches(state, seat, op).length === 0) return false;
    // 🆕🆕🆕 D625 — Strange Timepiece: no own evolved body of the type, or Milotic stopping the cards reaching
    // the hand, and the Item can only whiff (R-ST1). The opponent-side pick (an attack) is never asked here.
    if (op.op === "devolveChosen" && op.whose === "self" && !ownDevolveAvailable(state, seat, op.pokemonType)) {
      return false;
    }
    // D294 — the BENCH arm's own public whiff, and it is a DIFFERENT fact from
    // the empty hand below. Bench SIZE is public at both seats, so "their Bench
    // is full" is a board statement and greying on it is the Catcher/Hammer
    // class, not a peek. Ordered before the hand test because it is the stricter
    // of the two: a full Bench refuses even a hand that holds a match.
    if (
      op.op === "bottomFromOpponentHand" &&
      op.dest === "bench" &&
      // 🆕🆕🆕 D577 — the OPPONENT's live limit (their Tera Pokémon, R-AZ1).
      state.players[otherSeat(seat)].bench.length >= benchLimitOf(state, otherSeat(seat))
    ) {
      return false;
    }
    // 🆕🆕🆕 D577 — Tyme names "a Pokémon in your hand": none there, and the card can only whiff
    // (R-TY1, §7). The SAME funnel the op's first question offers from, so they cannot disagree.
    if (op.op === "opponentGuessesHp" && handPokemonUids(state, seat).length === 0) return false;
    if (op.op === "bottomFromOpponentHand" && state.players[otherSeat(seat)].hand.length === 0) {
      // An empty opponent hand is PUBLIC knowledge (the count shows), so
      // "this can only whiff" is a fact the board states — the Catcher/Hammer
      // class, not Poké Ball's. Reads hand LENGTH and never the op's filter:
      // whether a non-empty hidden hand holds a match is exactly what the game
      // state does NOT establish (ruling/284's line), so a filtered op into a
      // matchless hand stays playable and reveals — which is also the played
      // card working as printed (the reveal happens; the pick whiffs).
      return false;
    }
    // D206 — was `bench.length === 0`, which is `switchActiveTargets` on an
    // unmarked printing and WRONG on a subgroup one: Team Rocket's Giovanni into
    // a full Bench of ordinary Pokémon can do nothing at all (neither the switch
    // nor its gated gust), and a length test would spend the turn's one Supporter
    // on it. The op's own candidate function answers instead — the
    // `attachEnergyTargets` shape one op over — so the refusal and the offer can
    // never disagree.
    //
    // ⚠️ THE GATE STAYS OFF THE CONSEQUENT, and that is not an oversight: a
    // `recordGate` branch is not scanned here (only `coinFlipGate.then` is), and
    // Giovanni with an EMPTY OPPONENT BENCH still switches — the card does the
    // first half of what it prints, so it is playable, exactly as the `gust` gate
    // three lines up refuses only a program whose gust is the WHOLE card.
    //
    // ⚠️ D244 — AND THE SOURCE RIDES IT, which is what turns this line into the
    // gate Meowscarada `sv09-018` needs. Its "Showtime" prints *"if this Pokémon
    // is on your Bench"*, and with `fromSource` that clause IS the candidate set:
    // an Active Meowscarada has no bench ref to switch with, so the set is empty
    // and the Ability is refused here rather than being offered and whiffing.
    // Dropping the uid would answer about the whole Bench and light the row on
    // every board — D222's afford-then-reject, at the switch op.
    if (op.op === "switchActive" && switchActiveTargets(state, seat, op, sourceUid).length === 0) {
      return false;
    }
    // 🆕🛑 D351 — `attachEnergyFrom` USED TO BE ASKED HERE, ONE OP AT A TIME, AND
    // THAT WAS A LIVE DEFECT THE MOMENT A PROGRAM SPELLED TWO **DIFFERENT**
    // ATTACHES. The question moved OUT of this per-op loop and up to
    // `attachAlternativesAllWhiff` above it; the reason is in that function's doc,
    // and the reason it went unnoticed for so long is that every multi-op producer
    // shipped before this row was HOMOGENEOUS (Koraidon "Dino Cry" is the same
    // Energy from the same zone twice, so its two gates cannot disagree).
    //
    // ⚠️ NOT a widening of the OTHER gates in this loop and deliberately so: `gust`,
    // `damageChosen`, `healChosen`, `switchActive`, `moveEnergy` and `discardEnergy`
    // keep their per-op AND. Two of those are printed COSTS rather than targets
    // (`discardEnergy { from: "self" }` is Iono's Kilowattrel's "You must discard…
    // in order to use this Ability"), and an ALTERNATIVES reading of a cost is
    // simply wrong. An attach is never a cost, which is what makes the relaxation
    // safe on exactly this op and on no other.
    // `attachFromTop` and `attachFromDeck` are deliberately NOT gated — see the
    // ops' own docs (effects.ts). A gate here would be an AND over ops applied to
    // `attachFromTop` and `attachFromDeck` are deliberately NOT gated — see the
    // ops' own docs (effects.ts). A gate here would be an AND over ops applied to
    // a card whose OTHER printed clause always resolves, which is precisely the
    // case ruling/284 (quoted above) excludes: every card carrying either op also
    // prints a shuffle, and shuffling your deck is an effect players buy on
    // purpose. Note this bites HARDER on the search op than on the top-N one,
    // because a Supporter carries it — Janine's Secret Art into a board with no
    // {D} Pokémon spends the turn's one Supporter (§7.2) on a bare shuffle, where
    // Electric Generator only spends a card. Doctrine over cost; the prompt is the
    // mitigation (see the Miriam precedent, docs/workstreams/simulator.md).
    //
    // `payFromHand` is not gated here either, for the opposite reason:
    // it DOES veto the whole card, but on the card's own printed authority
    // ("You can use this card only if…") rather than this function's judgement
    // about ops that would whiff — and the Trainer form needs the played uid
    // excluded, which this function cannot see. Both action paths call
    // `handCostUnmet` themselves, beside `trainerPlayableIf`. (🆕🆕🆕 D561: all THREE
    // since R-AN — `useStadiumAbility` asks it too, after this function.)
    // 🆕🆕🆕 D568 — Glass Trumpet: no Basic Energy in the discard pile or no Benched {C}
    // body → the attach can only whiff, so the Item is not played (§7, the gust rule).
    if (op.op === "attachFromDiscard") {
      const offer = attachFromDiscardOffer(state, seat, op);
      if (offer.candidates.length === 0 || offer.targets.length === 0) return false;
    }
    // 🆕🆕🆕 D628 — Lethargic Charge, the op's first Ability: no Energy card in hand, or no Active Larry's
    // Pokémon → the attach can only whiff (§7, the gust rule), on the op's OWN offer funnel. Asked of the
    // printed singular (`one`) ONLY: D247's "any number" rows are attacks and stay ungated
    // (`derivedAnyNumberAttach.test.ts` §5 pins that answer).
    if (op.op === "attachFromHand" && op.one === true && !attachFromHandPlayable(state, seat, op, sourceUid)) {
      return false;
    }
    if (op.op === "moveEnergy" && !moveEnergyPlayable(state, seat, op, sourceUid)) {
      // No movable Energy, or fewer than two of your Pokémon in play (no distinct
      // destination) → the move can only whiff (Energy Switch / Poppy).
      //
      // D244 — the source rides it for the two uid-resolved routes
      // (`koedActiveToToolHolder`, `othersToSelf`), the same thread the switch
      // gate ten lines up grew. A Trainer still passes none, so a route that can
      // only be reached from a Pokémon's own sentence is refused inside one.
      return false;
    }
    // 🆕🆕🆕 D557 — a CHOSEN Tool discard with nothing to choose can only whiff (Tool
    // Scrapper into a board with no Tool on either side): refused on the op's OWN offer
    // funnel, `gust`/`healChosen`'s rule. `"all"` is answered by the sweep alternatives.
    if (
      op.op === "discardTools" &&
      op.count !== "all" &&
      discardableTools(state, seat, op.sides).length === 0
    ) {
      return false;
    }
    // 🆕🆕🆕 D565 — Ruffian into a board where no opponent body carries a Tool or a
    // Special Energy can only whiff: refused on the op's OWN candidate funnel
    // (`ruffianBodies`), the D557 `discardTools` line's rule one op over.
    if (op.op === "discardToolAndSpecialEnergyChosen" && ruffianBodies(state, seat).length === 0) {
      return false;
    }
    // 🆕🆕🆕 D644 — Patrat "Watchful Eye": a counter move can only whiff while a live holder is in play, so an
    // Ability or Trainer whose op it is is refused (Rocket Brain, Adrena-Brain; R-WEY1).
    if (isCounterMoveOp(op) && countersMoveLocked(state)) return false;
    // 🆕🆕🆕 D566 — Ogre's Mask with no qualifying body in play, OR no qualifying card in the
    // discard pile, can only whiff: refused on the op's OWN two offer funnels. A non-ex
    // Ogerpon fills neither side (`pokemonNameContaining.suffix`).
    if (
      op.op === "switchWithDiscardNamed" &&
      (swapBodies(state, seat, op.filter).length === 0 ||
        swapDiscardCards(state, seat, op.filter).length === 0)
    ) {
      return false;
    }
    // 🆕🆕🆕 D572 — Adrena-Brain with no damaged own body, or no opponent body to move onto, can
    // only whiff. Both halves are the op's own funnels (`counterToOpponentSources`, the
    // opponent's whole board — `oppAnyRefs`' set, empty exactly when no body is in play there).
    if (
      op.op === "moveCountersToOpponentChosen" &&
      (counterToOpponentSources(state, seat).length === 0 ||
        (state.players[otherSeat(seat)].active === null && state.players[otherSeat(seat)].bench.length === 0))
    ) {
      return false;
    }
    // 🆕🆕🆕 D572 — R-MC2 (⚠️ UNRULED): a hand return the Milotic lock wholly blocks can only
    // whiff, so the card is refused (Scoop Up Cyclone with every own body locked). Own board
    // only — the one `returnBenched … dest: "hand"` population is `whose: "self"`.
    if (op.op === "returnBenched" && op.dest === "hand" && op.whose === "self" && inPlayToHandBlocked(state, seat)) {
      return false;
    }
    // 🆕🆕🆕 D565 — Rocket Brain with no damaged own Team Rocket's body, or no OTHER own body
    // to move a counter onto, can only whiff. Both halves are the op's own funnels.
    if (
      op.op === "moveCounterOwnChosen" &&
      !counterOwnSources(state, seat, op.ownerPokemon).some(
        (ref) => counterOwnDestinations(state, seat, ref.spot).length > 0,
      )
    ) {
      return false;
    }
    // 🆕🆕🆕 D557 — and a `count: "all"` SWEEP is not asked here: it is one of the
    // program's alternatives (`sweepAlternativesAllWhiff`, above the loop).
    if (
      op.op === "discardEnergy" &&
      op.count !== "all" &&
      !discardEnergyPlayable(state, seat, op, sourceUid)
    ) {
      // Nothing matching on the opponent's board → the discard can only whiff
      // (Giacomo into a board with no Special Energy — rejected rather than
      // spending the turn's one Supporter, §7.2).
      //
      // D222 — AND FOR `from: "self"` THIS IS A COST GATE RATHER THAN A
      // would-only-whiff one. Iono's Kilowattrel prints "You MUST discard a Basic
      // {L} Energy from this Pokémon IN ORDER TO USE this Ability", so a host
      // holding none may not activate at all — the `handCostUnmet` refusal one
      // clause down, for the cost that is paid off the BOARD instead of the hand.
      // It is the `sourceUid` parameter that makes it answerable: without one,
      // this line would ask about the Active and let a benched Kilowattrel spend
      // another Pokémon's Energy.
      //
      // THIS REACHES CRUSHING HAMMER TOO, through the coinFlipGate branch above.
      // An earlier version of this comment claimed the opposite ("only TOP-LEVEL
      // ops are scanned, so Crushing Hammer's coin-GATED discard stays playable
      // either way") — it predated D41, which added that descent for exactly
      // this card and says so in its own comment. The descent wins, and it is
      // the intended reading: ruling/906 makes the flip PROCEDURE, not effect,
      // so a heads branch that could only whiff means the card could only whiff.
      // Corrected here rather than in one place only, because the two comments
      // disagreeing is how a reader concludes either behaviour is fine — and
      // since 0.32.0 the HUD greys the row with this predicate, so the
      // disagreement would now read to a player as a printed rule.
      return false;
    }
  }
  return true;
}

/** Trainer target validation, shared by playTrainer and both HUD offers. */
export function trainerProgramPlayable(
  state: GameState,
  program: readonly EffectOp[],
  seat: Seat,
): boolean {
  // A standalone retrieval into hand has no effect without an eligible discard
  // card (Night Stretcher / Energy Retrieval). Check before discarding the Trainer.
  // Mixed programs may still act through a draw, shuffle, or earlier discard cost.
  const onlyOp = program.length === 1 ? program[0] : undefined;
  if (
    onlyOp?.op === "discardPileRetrieval" &&
    onlyOp.dest === "hand" &&
    discardRetrievalCandidates(state, seat, onlyOp).length === 0
  ) {
    return false;
  }
  return programPlayable(state, program, seat);
}

/** Resolve one of the actor's own in-play Pokémon off a wire target: the
    Active (must be present) or a benched index (checked like every wire index). */
function resolveOwnPokemon(
  state: GameState,
  seat: Seat,
  target: PokemonTarget,
): { pokemon: InPlayPokemon; uid: string; reject?: undefined } | { reject: ApplyResult } {
  const side = state.players[seat];
  let pokemon: InPlayPokemon;
  if (target.spot === "active") {
    if (side.active === null) return { reject: err("NO_TARGET", "no Active Pokémon") };
    pokemon = side.active;
  } else {
    const benched = isBenchIndex(target.index) ? side.bench[target.index] : undefined;
    if (benched === undefined) {
      return {
        reject: err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(target.index)}`),
      };
    }
    pokemon = benched;
  }
  const uid = topUid(pokemon);
  if (uid === undefined)
    return { reject: err("UNKNOWN_CARD", "the Pokémon has no resolvable top card") };
  return { pokemon, uid };
}

/** Wire-check a resolveEffect choice against the parked prompt (a P4 client
    controls it): the right kind, and every uid/ref among the legal options. */
function validateChoice(prompt: EffectPrompt, choice: EffectChoice): ApplyResult | null {
  if (typeof choice !== "object" || choice === null) {
    return err("BAD_EFFECT_CHOICE", "choice must be an object");
  }
  switch (prompt.kind) {
    case "chooseCards": {
      if (choice.kind !== "cards" || !Array.isArray(choice.uids)) {
        return err("BAD_EFFECT_CHOICE", "expected a card choice");
      }
      if (choice.uids.length > prompt.max) {
        return err("BAD_EFFECT_CHOICE", `pick at most ${prompt.max} card(s)`);
      }
      // The FLOOR — 0 for every printed "up to" (a decline is a legal answer),
      // and `min === max` for a MANDATORY exact pick, where the only decision is
      // WHICH cards. 🆕 D426 CORRECTED THIS COMMENT, which said "the mandatory hand
      // COST": that was the only mandatory producer when it was written, and there
      // are now four — `payFromHand` (a cost, where an empty answer would take the
      // effect without paying for it), `bottomFromOpponentHand`'s unridden
      // exactly-one, `lookAtTopN.exact`, and `opponentDiscardsFromHand`, whose
      // answer comes from the seat that did NOT make the play. The floor means the
      // same thing at all four and says nothing about why.
      if (choice.uids.length < prompt.min) {
        return err("BAD_EFFECT_CHOICE", `pick at least ${prompt.min} card(s)`);
      }
      const candidates = new Set(prompt.candidates);
      const seen = new Set<string>();
      for (const uid of choice.uids) {
        if (typeof uid !== "string" || !candidates.has(uid)) {
          // Reads off the PROMPT: this validator now serves a deck search, a
          // discard-pile retrieval, a look at the deck top AND a hand cost, so
          // "searchable" was only ever right for the first of them.
          return err("BAD_EFFECT_CHOICE", `${String(uid)} is not a legal card for this choice`);
        }
        if (seen.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
        seen.add(uid);
      }
      // 🆕 D332 — THE PER-KIND CAPS, and this is the ONLY place they can be
      // enforced. The printed sentence is "a Pokémon **and** a Trainer card"
      // (Drayton), so the flat `max` of 2 checked above is satisfied just as
      // happily by TWO Pokémon — the conjunction lives entirely in these groups.
      // The op cannot enforce it: this validator matches a wire answer against
      // the PROMPT and nothing else, which is what a P4 client is checked by, so
      // a cap the prompt did not carry would be a cap a crafted frame walks past.
      //
      // Absent on every other producer (one filter, one cap), so the loop runs
      // zero times and the six older parks reach `null` down exactly the path
      // they always did. A uid in two groups counts against both — the
      // conservative reading, stated in effects.ts.
      for (const cap of prompt.caps ?? []) {
        const inGroup = new Set(cap.uids);
        const picked = choice.uids.filter((uid) => inGroup.has(uid)).length;
        if (picked > cap.max) {
          return err("BAD_EFFECT_CHOICE", `pick at most ${cap.max} card(s) of that kind`);
        }
      }
      // 🆕🆕🆕 D566 — THE DISJUNCTIVE CAPS (`capsAnyOf`, Brock's Scouting's *"up to 2 Basic
      // Pokémon OR 1 Evolution Pokémon"*): the answer must come WHOLLY out of ONE entry and
      // stay within THAT entry's ceiling. `every` over the picks inside `some` over the
      // entries — a mixed answer (1 Basic + 1 Evolution) is in no entry and is refused, which
      // is the board the conjunctive loop above would have passed. The empty answer is in
      // every entry (the printed "up to"). Absent on every other park: the check is skipped.
      const anyOf = prompt.capsAnyOf;
      if (
        anyOf !== undefined &&
        !anyOf.some(
          (entry) =>
            choice.uids.length <= entry.max && choice.uids.every((uid) => entry.uids.includes(uid)),
        )
      ) {
        return err("BAD_EFFECT_CHOICE", "pick from one kind only, within its limit");
      }
      return null;
    }
    case "choosePokemonMulti": {
      // `min`..`max` DISTINCT offered refs — and the printed number is EXACT
      // unless the card says "up to" ("put 3 damage counters on 1 of your
      // opponent's Benched Pokémon" is not "up to 1"), so the floor is what
      // stops a player from paying an irreversible hand cost and then placing
      // nothing. An "up to" prompt (Saguaro's heal) carries min: 0, and there
      // the floor never rejects — 0, 1, … max are all printed answers.
      //
      // The empty answer is legal only where the card prints "you may"
      // (`declinable` — Hawlucha, whose trigger the framework auto-fires, so the
      // decline has nowhere else to live). It is ALL-OR-NOTHING: none, or the
      // full `min`, never one of two.
      if (choice.kind !== "pokemonMulti" || !Array.isArray(choice.refs)) {
        return err("BAD_EFFECT_CHOICE", "expected a Pokémon multi-choice");
      }
      if (choice.refs.length > prompt.max) {
        return err("BAD_EFFECT_CHOICE", `pick at most ${prompt.max} Pokémon`);
      }
      if (choice.refs.length < prompt.min && !(prompt.declinable && choice.refs.length === 0)) {
        return err("BAD_EFFECT_CHOICE", `pick ${prompt.min} Pokémon`);
      }
      const seen = new Set<string>();
      for (const ref of choice.refs) {
        if (!isPokemonRef(ref) || !prompt.candidates.some((c) => refEquals(c, ref))) {
          return err("BAD_EFFECT_CHOICE", "that Pokémon is not a legal target");
        }
        const key = refKey(ref);
        if (seen.has(key)) return err("BAD_EFFECT_CHOICE", "a Pokémon picked twice");
        seen.add(key);
      }
      return null;
    }
    case "choosePokemon": {
      // Exactly one of the offered refs — or, on a prompt carrying a printed
      // ceiling, NONE, and with a quantity in 1..upTo when it names one.
      //
      // 🆕🆕 **D358 — THIS IS THE ONLY PLACE THE PRINTED *"up to N"* CAN BE
      // ENFORCED, AND IT IS ALSO THE ONLY PLACE THE ABSENCE OF ONE CAN BE.** The
      // answer shape is the same either way (`{kind:"pokemon"}` with the ref left
      // off), so what separates a legal decline from a crafted frame refusing a
      // mandatory effect is entirely this arm reading the PROMPT — the
      // architecture every other arm here is built on, and what a P4 client is
      // checked by. Boss's Orders prints *"Switch in 1 of your opponent's Benched
      // Pokémon"* with no *"up to"* and no *"you may"*; without the second half of
      // this test, a frame that simply omitted `ref` would walk past it.
      if (choice.kind !== "pokemon") {
        return err("BAD_EFFECT_CHOICE", "expected a Pokémon choice");
      }
      if (choice.ref === undefined) {
        // The DECLINE. Spelled as its own arm rather than folded into the guard
        // above so the two rejections carry different sentences: "you cannot
        // decline this" is a rules fact about the card, and a reader looking at
        // the Pokémon in front of them should not be told their message was
        // malformed.
        //
        // 🆕 D359 — the test is now the CEILING's presence rather than a decline
        // flag's, and it admits exactly what it used to: a prompt carrying
        // `upTo: N` legalises every k in 0..N (§9.1), and the k = 0 answer is
        // this one. A `take` beside a missing ref is refused below, because a
        // decline that also names a quantity is two answers in one frame.
        if (prompt.upTo === undefined) {
          return err("BAD_EFFECT_CHOICE", "this choice cannot be declined");
        }
        return choice.take === undefined
          ? null
          : err("BAD_EFFECT_CHOICE", "a declined choice takes nothing");
      }
      if (!isPokemonRef(choice.ref)) {
        return err("BAD_EFFECT_CHOICE", "expected a Pokémon choice");
      }
      const picked = choice.ref;
      if (!prompt.candidates.some((c) => refEquals(c, picked))) {
        return err("BAD_EFFECT_CHOICE", "that Pokémon is not a legal target");
      }
      // 🆕🆕 **D359 — THE ANSWERED QUANTITY, AND THIS IS THE ONLY PLACE THE
      // PRINTED CEILING CAN BE ENFORCED.** `applyChoice` clamps to `op.count` as
      // a belt, but a clamp SILENTLY accepts a frame the print never allowed;
      // this arm is what a P4 client is checked by, so the three ways a quantity
      // can be wrong are three refusals with their own sentences:
      //   • a quantity against a prompt that offered no ceiling — the mandatory
      //     parks (switchActive, gust, healChosen's single arm, both evolve-body
      //     continuations), where "how many" has no referent at all;
      //   • a quantity above the printed ceiling, or not a whole number — the
      //     over-take, which is the one a crafted frame actually wants;
      //   • ZERO beside a named body. That is the DECLINE, and the union already
      //     spells it as the absent ref. Refusing the second spelling is what
      //     keeps a §9.2 `recordGate` from being handed a body with no uids and
      //     the log from carrying a row naming a Pokémon nothing happened to.
      if (choice.take === undefined) return null;
      if (prompt.upTo === undefined) {
        return err("BAD_EFFECT_CHOICE", "this choice takes no quantity");
      }
      if (!Number.isInteger(choice.take) || choice.take < 1 || choice.take > prompt.upTo) {
        return err("BAD_EFFECT_CHOICE", "that is not a legal quantity");
      }
      return null;
    }
    case "moveEnergy": {
      // Up to `max` movable Energy, each paired with the Pokémon it moves onto
      // (Energy Switch / Poppy / N's Plan / Kilowattrel). The couplings the
      // compound decision must hold: every picked uid is an offered movable Energy
      // (distinct), every named destination is an offered one, and no pick lands on
      // the body it came off (no moving Energy onto itself). Unless the prompt
      // lifts them, the picks all share ONE source (the printed "from 1 of your
      // Pokémon") and ONE destination (the printed "to another"). An empty pick is
      // a legal decline, unless the prompt carries a floor.
      //
      // ⚠️ D226 — THE SINGLE-SOURCE RULE IS THE PROMPT'S TO ASK FOR, AND THE
      // SELF-MOVE RULE IS PER PICK. N's Plan prints "from your Benched Pokémon",
      // plural, so its prompt carries `anySource` and one Energy off each of two
      // benched bodies is a legal answer here. Everything else is unchanged and
      // deliberately so: this arm is the ONLY thing standing between a wire
      // message and `moveEnergyApply`, so relaxing a coupling by DELETING the
      // check — rather than by making it conditional — would also delete the rule
      // riding on it.
      //
      // 🆕🆕 D442 — AND THE SINGLE-DESTINATION RULE IS NOW THE PROMPT'S TO ASK FOR
      // TOO, BY THE IDENTICAL CONSTRUCTION. It used to be expressed by the answer's
      // SHAPE (one `dest` field for the whole frame), which is why lifting it had to
      // be a rename rather than a flag: a shape cannot be made conditional. Under
      // `anyDest` the destinations may differ; without it they must all agree, which
      // is the same proposition the old field asserted, now asserted rather than
      // assumed. ⚠️ THE SELF-MOVE RULE IS UNCHANGED IN MEANING AND MOVES INSIDE THE
      // LOOP'S PER-PICK PAIR: under the old coupling every pick shared one
      // destination, so "no pick's source is ITS destination" and "the source is not
      // the destination" are the same test, and the message stays the one the suite
      // already pins.
      if (choice.kind !== "moveEnergy" || !Array.isArray(choice.picks)) {
        return err("BAD_EFFECT_CHOICE", "expected an energy-move choice");
      }
      if (choice.picks.length > prompt.max) {
        return err("BAD_EFFECT_CHOICE", `move at most ${prompt.max} Energy`);
      }
      // 🆕🆕 D441 — THE FLOOR, AND IT IS THE ONLY THING STANDING BETWEEN A
      // MANDATORY MOVE AND A DECLINE. Castform's printed *"Move **all** Energy"*
      // parks with `min === max`, so the empty answer the comment above calls "a
      // legal decline" stops being one — and this is where that is decided, because
      // the ceiling check one line up cannot see the difference between a prompt
      // that offers 0..N and one that offers only N. ⚠️ `?? 0` IS THE ABSENT-KEY
      // ARM AND IT IS LOAD-BEARING RATHER THAN DEFENSIVE: every `moveEnergy` park a
      // pre-D441 deploy could persist carries no `min` and genuinely meant
      // declinable, so reading the missing key as 0 is what keeps those records
      // meaning what they meant (`MATCH_RECORD_VERSION` unmoved — see the prompt's
      // own doc for the D334-versus-D359 argument).
      if (choice.picks.length < (prompt.min ?? 0)) {
        return err("BAD_EFFECT_CHOICE", `move all ${prompt.min ?? 0} Energy`);
      }
      const sourceOf = new Map(prompt.movable.map((m) => [m.uid, m.from]));
      const seen = new Set<string>();
      let source: PokemonRef | undefined;
      let destination: PokemonRef | undefined;
      let selfMove = false;
      // The entries come off the WIRE, so each is checked as an unknown shape
      // (TypeScript's `{uid, dest}` is a claim about the action, not about the
      // JSON) — the `attachCards` arm's rule, and the one this arm inherits along
      // with its map.
      for (const entry of choice.picks as readonly ({
        uid?: unknown;
        dest?: unknown;
      } | null)[]) {
        if (typeof entry !== "object" || entry === null) {
          return err("BAD_EFFECT_CHOICE", "each move must name an Energy and a Pokémon");
        }
        const uid = entry.uid;
        const from = typeof uid === "string" ? sourceOf.get(uid) : undefined;
        if (from === undefined || typeof uid !== "string") {
          return err("BAD_EFFECT_CHOICE", `${String(uid)} is not a movable Energy`);
        }
        if (seen.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
        seen.add(uid);
        const dest = entry.dest;
        if (!isPokemonRef(dest) || !prompt.destinations.some((d) => refEquals(d, dest))) {
          return err("BAD_EFFECT_CHOICE", "that Pokémon is not a legal destination");
        }
        if (refEquals(from, dest)) selfMove = true;
        // The couplings, unless the prompt lifted them (N's Plan; Kilowattrel).
        // Checked INSIDE the loop, before the self-move verdict below, so the
        // message a mixed-source answer gets is the one it got before these riders
        // existed.
        if (prompt.anySource !== true) {
          if (source === undefined) source = from;
          else if (!refEquals(source, from)) {
            return err("BAD_EFFECT_CHOICE", "every Energy must come from the same Pokémon");
          }
        }
        if (prompt.anyDest !== true) {
          if (destination === undefined) destination = dest;
          else if (!refEquals(destination, dest)) {
            return err("BAD_EFFECT_CHOICE", "every Energy must go to the same Pokémon");
          }
        }
      }
      if (selfMove) {
        return err("BAD_EFFECT_CHOICE", "cannot move a Pokémon's Energy onto itself");
      }
      return null;
    }
    case "discardEnergy": {
      // Crushing Hammer / Giacomo / Mawile, the attack twins, and the §8
      // self-discard cost. MANDATORY — an empty pick is NOT a decline here
      // (unlike chooseCards / moveEnergy), so the count is exact: "total" takes
      // exactly `count` Energy across the whole offer, "each" exactly one from
      // EVERY Pokémon the prompt offered. Both rest on the same two rules —
      // every uid was offered, and no uid twice — plus the required count, which
      // for "each" is the number of distinct sources, so "one each, none skipped"
      // follows by pigeonhole once no Pokémon may give up two.
      //
      // The one-per-Pokémon rule is "each"-only: an exact-N discard takes all N
      // off the SAME Pokémon (every printed one is "…from this Pokémon"), which
      // is exactly what that rule forbids. AUTHORING NOTE — nothing here then
      // pins a multi-count pick to a single host, so a future "discard 2 Energy
      // from 1 of your opponent's Pokémon" would need a same-host rule of its
      // own; the deriver is the only author of a numeric count and only ever
      // pairs it with the single-Pokémon `yourActive` arm.
      if (choice.kind !== "discardEnergy" || !Array.isArray(choice.uids)) {
        return err("BAD_EFFECT_CHOICE", "expected an energy-discard choice");
      }
      const scope = prompt.scope;
      const sourceOf = new Map(prompt.discardable.map((d) => [d.uid, d.from]));
      // "You may discard any amount" (Chien-Pao ex "Hail Blade"): DECLINABLE, so
      // 0..`max` rather than an exact count — every uid still offered and none
      // twice (the two rules every scope shares), but no per-source rule and an
      // empty pick is a legal decline. Branched out before the exact-count path
      // below, which "each" and "total" share.
      if (scope.kind === "upTo") {
        if (choice.uids.length > scope.max) {
          return err("BAD_EFFECT_CHOICE", `discard at most ${scope.max} Energy`);
        }
        const picked = new Set<string>();
        for (const uid of choice.uids) {
          if (typeof uid !== "string" || !sourceOf.has(uid)) {
            return err("BAD_EFFECT_CHOICE", `${String(uid)} is not a discardable Energy`);
          }
          if (picked.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
          picked.add(uid);
        }
        return null;
      }
      const required =
        scope.kind === "total"
          ? scope.count
          : new Set(prompt.discardable.map((d) => refKey(d.from))).size;
      if (choice.uids.length !== required) {
        return err("BAD_EFFECT_CHOICE", `discard exactly ${required} Energy`);
      }
      const seen = new Set<string>();
      const sources = new Set<string>();
      for (const uid of choice.uids) {
        const from = typeof uid === "string" ? sourceOf.get(uid) : undefined;
        if (from === undefined) {
          return err("BAD_EFFECT_CHOICE", `${String(uid)} is not a discardable Energy`);
        }
        if (seen.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
        seen.add(uid);
        if (scope.kind === "each") {
          const key = refKey(from);
          if (sources.has(key)) {
            return err("BAD_EFFECT_CHOICE", "only one Energy per Pokémon");
          }
          sources.add(key);
        }
      }
      return null;
    }
    case "discardTools": {
      // 🆕🆕🆕 **D543 — the printed *"Discard up to N Pokémon Tools from your
      // opponent's Pokémon."*** DECLINABLE, so 0..`max` rather than an exact count:
      // the `upTo` branch of the sibling arm above is the template, and it is a
      // RESTATEMENT rather than a shared call because the two answers are different
      // `EffectChoice` members over different offers — see the prompt's own block for
      // why they must stay distinguishable on the wire.
      //
      // Two rules, the ones EVERY scope shares: every uid was OFFERED, and no uid
      // twice. **NO per-source rule and no exact count**, both for the `upTo` reason:
      // the print caps the answer from above and says nothing about distribution, so
      // taking both Tools off one Pokémon is a legal answer and so is taking none.
      // **`max` IS READ OFF THE PROMPT, NEVER OFF THE OP** — the prompt's ceiling is
      // already clamped to what the board offered, and this validator never sees the
      // op at all.
      //
      // 🆕🆕🆕 D557 — AND IT NEEDS NO SEAT RULE FOR TOOL SCRAPPER'S *"yours or your
      // opponent's"*, which is why nothing below changed. Membership is checked against
      // `prompt.discardable`, which already pairs every offered Tool with its OWN seat's
      // body (`discardableTools(…, "both")`), so an own-side uid is legal exactly when it
      // was offered and a uid off neither board is refused as before. A pick spanning
      // BOTH boards in one answer is legal (the print caps the COUNT, not the side).
      if (choice.kind !== "discardTools" || !Array.isArray(choice.uids)) {
        return err("BAD_EFFECT_CHOICE", "expected a tool-discard choice");
      }
      // 🆕🆕🆕 D643 — an EXACT `total` (Multi Adapter's trim, R-MAD1; Ruffian on a two-Tool body, R-MAD4): exactly
      // `count` uids, then the `upTo` rules below at that ceiling (every uid offered, none twice).
      if (prompt.scope.kind === "total" && choice.uids.length !== prompt.scope.count) {
        return err("BAD_EFFECT_CHOICE", `discard exactly ${prompt.scope.count} Pokémon Tools`);
      }
      const scope = prompt.scope.kind === "total" ? { kind: "upTo" as const, max: prompt.scope.count } : prompt.scope;
      // The prompt is authored `upTo`-only today. [🆕🆕🆕 D643 (D539): ~~`upTo`-only~~ — `total` too, read above.] A future `total`/`each` Tool
      // discard would arrive here as a scope this branch does not read, so the
      // NON-`upTo` case is refused rather than waved through: an unrecognised scope
      // must not become "anything goes".
      if (scope.kind !== "upTo") {
        return err("BAD_EFFECT_CHOICE", "unsupported tool-discard scope");
      }
      if (choice.uids.length > scope.max) {
        return err("BAD_EFFECT_CHOICE", `discard at most ${scope.max} Pokémon Tools`);
      }
      const offered = new Set(prompt.discardable.map((d) => d.uid));
      const picked = new Set<string>();
      for (const uid of choice.uids) {
        if (typeof uid !== "string" || !offered.has(uid)) {
          return err("BAD_EFFECT_CHOICE", `${String(uid)} is not a discardable Pokémon Tool`);
        }
        if (picked.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
        picked.add(uid);
      }
      return null;
    }
    case "attachCards": {
      // Electric Generator / Hydreigon / Charizard ex / Janine's Secret Art —
      // "attach … in any way you like", so each pick carries its OWN destination
      // and the answer is a list of PAIRS rather than the flat uid list every
      // other card prompt takes. SIX couplings: at most `max` of them; every uid
      // one the prompt offered (which is what keeps a client off a card DEEPER in
      // the deck than the look reached — the lookAtTopN rule — and off a card the
      // filter or the interchangeable collapse excluded, and it also keeps a hand
      // card out of an attach that must come from the deck); no uid twice, since
      // one physical card cannot land on two Pokémon and the apply would otherwise
      // be asked to duplicate it; every destination an offered target (the printed
      // "your Benched {L} Pokémon" — the opponent's board is never among them);
      // and, when the prompt sets it, at most `maxPerTarget` on any ONE Pokémon;
      // and, when the prompt sets THAT, exactly one Pokémon in the whole answer
      // (`oneTarget` — D457's printed "attach them to 1 of your Pokémon").
      //
      // The fifth is the printed "for each of those Pokémon" (Janine's Secret
      // Art: up to 2 Basic {D} Energy, one apiece) and the sixth is its dual, the
      // printed "1 of your Pokémon" (`censusAttackCorpus.ts` lines 403 and 412 —
      // up to 2 Basic Energy, both onto the SAME body; NO CARD NAMED, because the
      // ids behind those corpus rows are unresolvable in this checkout, D425). Both are enforced HERE and only here,
      // like every other coupling above — the apply re-derives none of them, so a
      // rule that lived in both places could drift and let one path attach what
      // the other refuses.
      //
      // An empty list is a legal DECLINE ("up to" / "any number"), and it is not
      // the same as nothing happening: the op's leftovers clause still runs.
      if (choice.kind !== "attachCards" || !Array.isArray(choice.assignments)) {
        return err("BAD_EFFECT_CHOICE", "expected a card-attach choice");
      }
      if (choice.assignments.length > prompt.max) {
        return err("BAD_EFFECT_CHOICE", `attach at most ${prompt.max} card(s)`);
      }
      const candidates = new Set(prompt.candidates);
      const seen = new Set<string>();
      const perTarget = new Map<string, number>();
      // The entries come off the WIRE, so each is checked as an unknown shape
      // (TypeScript's `{uid, to}` is a claim about the action, not about the JSON).
      for (const entry of choice.assignments as readonly ({
        uid?: unknown;
        to?: unknown;
      } | null)[]) {
        if (typeof entry !== "object" || entry === null) {
          return err("BAD_EFFECT_CHOICE", "each attachment must name a card and a Pokémon");
        }
        const uid = entry.uid;
        if (typeof uid !== "string" || !candidates.has(uid)) {
          return err("BAD_EFFECT_CHOICE", `${String(uid)} is not an attachable card`);
        }
        if (seen.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} picked twice`);
        seen.add(uid);
        const to = entry.to;
        if (!isPokemonRef(to) || !prompt.targets.some((t) => refEquals(t, to))) {
          return err("BAD_EFFECT_CHOICE", "that Pokémon is not a legal attach target");
        }
        const key = refKey(to);
        const count = (perTarget.get(key) ?? 0) + 1;
        if (prompt.maxPerTarget !== undefined && count > prompt.maxPerTarget) {
          return err(
            "BAD_EFFECT_CHOICE",
            `attach at most ${prompt.maxPerTarget} card(s) to any one Pokémon`,
          );
        }
        perTarget.set(key, count);
        // 🆕🆕 D457 — the SIXTH coupling and the dual of the fifth: the printed
        // "attach them to 1 of your Pokémon" (`attachFromDeck.oneTarget`), where
        // every card in the batch shares ONE destination. Counted off the SAME
        // map, which is why the `perTarget` bookkeeping above moved out from under
        // `maxPerTarget`'s `if` — a second tally keyed the same way could disagree
        // with the first one about what "a target" is.
        //
        // ⚠️ IT IS THE MAP'S SIZE AND NOT THE FIRST ENTRY'S REF, deliberately:
        // comparing each `to` against `assignments[0].to` would give the same
        // verdict on every answer a client can send and a DIFFERENT one on an
        // empty list, where there is no first entry to compare against. The
        // decline stays legal here (size 0), exactly as it is under `max`.
        if (prompt.oneTarget === true && perTarget.size > 1) {
          return err("BAD_EFFECT_CHOICE", "attach every card to the same Pokémon");
        }
      }
      return null;
    }
    case "guessHp": {
      // 🆕🆕🆕 D577 — Tyme's guess: an INTEGER ≥ 0 and nothing else (R-TY2) — a P4 client's
      // "60", 59.5 or -10 is refused here, never compared.
      if (choice.kind !== "hpGuess" || !Number.isInteger(choice.hp) || choice.hp < 0) {
        return err("BAD_EFFECT_CHOICE", "expected a whole-number HP guess");
      }
      return null;
    }
    case "mayDraw": {
      // A plain boolean, and CHECKED to be one: a P4 client's truthy string
      // ("yes", 1) must not read as consent to draw — the wire rule every
      // index and count in this file already lives by.
      if (choice.kind !== "mayDraw" || typeof choice.draw !== "boolean") {
        return err("BAD_EFFECT_CHOICE", "expected a yes/no draw choice");
      }
      return null;
    }
    case "confirm": {
      // The printed "you may", answered by the controller. The `mayDraw` check
      // VERBATIM, and deliberately so: a P4 client's truthy string ("yes", 1)
      // must not read as consent — and here consent runs a whole op branch
      // rather than a draw, so the belt matters more, not less. Nothing else to
      // check: the prompt offers no candidates, so `yes` is the entire answer.
      if (choice.kind !== "confirm" || typeof choice.yes !== "boolean") {
        return err("BAD_EFFECT_CHOICE", "expected a yes/no confirmation");
      }
      const target = choice.target;
      if (target !== undefined && (
        prompt.cards === undefined || (!choice.yes && prompt.cards.no === undefined) ||
        !isPokemonRef(target) ||
        !prompt.targets?.some((ref) => refEquals(ref, target))
      )) {
        return err("BAD_EFFECT_CHOICE", "not a legal attachment target");
      }
      return null;
    }
    case "orderCards": {
      // 🆕🆕 D341 — A PERMUTATION, WHICH IS THE ONE ANSWER SHAPE THIS FUNCTION HAS
      // NEVER HAD TO CHECK. Three independent failures, and none of them is caught
      // by the `cards` arm's membership-and-count test:
      //   • a SHORT answer would leave cards out of the deck entirely (the apply
      //     splices `uids` over the first `uids.length` slots, so a dropped uid is
      //     a destroyed card);
      //   • a REPEATED uid would duplicate a physical card;
      //   • an UNOFFERED uid would drag a card up from BELOW the window the print
      //     let the player see — `lookAtTopN`'s rule, and the one failure the
      //     three arms above do share.
      // The length check is what makes this a permutation rather than a subset:
      // with equal length, no duplicates and every uid offered, the answer is a
      // bijection onto the candidate set by counting alone.
      if (choice.kind !== "orderCards" || !Array.isArray(choice.uids)) {
        return err("BAD_EFFECT_CHOICE", "expected a card ordering");
      }
      // 🆕🆕 D344 — **THE EMPTY ORDERING IS THE PRINTED ALTERNATIVE, AND IT IS
      // LEGAL EXACTLY WHEN THE PROMPT CARRIES ONE.** Deduction Kit `sv08-171`'s
      // *"…, or shuffle them and put them on the bottom of your deck"* — the
      // answer means *none of these cards is being put back on top*, and
      // `continuationOps` splices the op's `otherwise` arm behind it.
      //
      // 🛑 GUARDED ON `prompt.alt`, WHICH IS WHAT KEEPS THIS FROM BEING A DECLINE
      // THE OTHER FOUR PRINTINGS SUDDENLY GAINED. A prompt with no alternative
      // still refuses `[]` on the length check below, so the note under this arm
      // stays true where it always was: *"put them back in any order" carries no
      // "you may"*. An empty answer is not a decline — on the one printing that
      // has an alternative it is the OTHER printed thing to do, and on every
      // other printing it is still nothing at all.
      if (choice.uids.length === 0 && prompt.alt !== undefined) return null;
      if (choice.uids.length !== prompt.candidates.length) {
        return err("BAD_EFFECT_CHOICE", `order all ${prompt.candidates.length} card(s)`);
      }
      const offered = new Set(prompt.candidates);
      const placed = new Set<string>();
      // The entries come off the WIRE, so each is checked as an unknown (the
      // `string[]` type is a claim about the action, not about the JSON) — the
      // `attachCards` arm's rule, one case up.
      for (const uid of choice.uids as readonly unknown[]) {
        if (typeof uid !== "string" || !offered.has(uid)) {
          return err("BAD_EFFECT_CHOICE", `${String(uid)} is not one of the cards to order`);
        }
        if (placed.has(uid)) return err("BAD_EFFECT_CHOICE", `${uid} placed twice`);
        placed.add(uid);
      }
      // NO DECLINE, and it is printed rather than assumed: "put them back in any
      // order" carries no "you may", so an empty answer is not a legal decline —
      // it is refused by the length check above, which is the only place it could
      // be. The identity permutation IS the "leave it alone" answer.
      return null;
    }
    case "chooseAttack": {
      // D157 — exactly ONE of the OFFERED attack indices. Mandatory: the printed
      // sentence is "Choose 1", with no "you may", so an absent answer is not a
      // decline and there is nothing to floor against — the whole check is that
      // the number is one the prompt named.
      //
      // ⚠️ `Number.isInteger` RATHER THAN `typeof === "number"`, and the reason is
      // attack.ts's §8 wire check verbatim: an index is used as an INDEX, so a
      // string "0" or a 1.5 would sail through a type test and corrupt everything
      // downstream that compares it to `lockedAttack.attackIndex`. The membership
      // test alone would catch both here — but it is the same fact stated once,
      // and the day this prompt offers a computed subset it stops being.
      if (choice.kind !== "attack" || !Number.isInteger(choice.index)) {
        return err("BAD_EFFECT_CHOICE", "expected an attack choice");
      }
      if (!prompt.candidates.some((c) => c.index === choice.index)) {
        return err(
          "BAD_EFFECT_CHOICE",
          `${String(choice.index)} is not a legal attack for this choice`,
        );
      }
      return null;
    }
    case "choosePrize": {
      // 🆕🆕🆕 D548 — exactly ONE of the OFFERED face-down slots. `chooseAttack`'s check
      // one case up, verbatim in shape: `Number.isInteger` (an index is used as an INDEX,
      // so "0", 1.5 and an ARRAY of two slots must not sail through), then membership in
      // the offer — which refuses an out-of-range slot AND a face-up one, because the
      // prompt offered only the face-down ones. Mandatory: the decline was the confirm.
      if (choice.kind !== "prize" || !Number.isInteger(choice.index)) {
        return err("BAD_EFFECT_CHOICE", "expected exactly one prize choice");
      }
      if (!prompt.indices.includes(choice.index)) {
        return err("BAD_EFFECT_CHOICE", `${String(choice.index)} is not a face-down Prize you can turn`);
      }
      return null;
    }
  }
}

function isPokemonRef(value: unknown): value is PokemonRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as { seat?: unknown; spot?: unknown };
  if (ref.seat !== "p1" && ref.seat !== "p2") return false;
  return isPokemonTarget(ref.spot);
}

/** A stable string key for de-duping picked refs (the multi-choice's "no
    Pokémon twice" check). */
function refKey(ref: PokemonRef): string {
  return `${ref.seat}:${ref.spot.spot}:${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
}

function refEquals(a: PokemonRef, b: PokemonRef): boolean {
  if (a.seat !== b.seat || a.spot.spot !== b.spot.spot) return false;
  if (a.spot.spot === "bench" && b.spot.spot === "bench") return a.spot.index === b.spot.index;
  return true;
}
