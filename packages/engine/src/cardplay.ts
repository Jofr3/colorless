import type { Card } from "@colorless/schema";
import type {
  ApplyResult,
  AttachToolAction,
  PlayTrainerAction,
  RareCandyAction,
  ResolveEffectAction,
  UseAbilityAction,
  UseStadiumAbilityAction,
  Rejection,
} from "./actions";
import { err, ok } from "./actions";
import {
  resolveCoinRedo,
  resolveCopiedAttack,
  resolveFoundAttack,
  resolveInPlayCopiedAttack,
} from "./attack";
import { cardOfUid, isBasicPokemon, topUid } from "./cards";
import {
  benchLimitOf,
  disabledAbilityUids,
  handPlayBarred,
  handPlayBarredReason,
  hasAttachedEnergy,
  inPlayToHandBlocked,
  remainingHpWithin,
  toolCardSimulated,
  toolCapOf,
  countersMoveLocked,
} from "./continuous";
import type { EffectOp, OpOf } from "./effects";
import type { GameEvent } from "./events";
import { recoverStatuses, resolveMidTurnKnockOuts, settleProgram } from "./flow";
import type { EffectChoice, EffectPrompt, PokemonRef } from "./effectPrompt";
import {
  attachEnergyTargets,
  attachFromDiscardOffer,
  attachFromHandPlayable,
  attachSeat,
  firstAttachableEnergy,
} from "./ops/energy";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  counterOwnDestinations,
  counterOwnSources,
  counterToOpponentSources,
  healChosenTargets,
  ruffianBodies,
} from "./ops/damage";
import {
  discardEnergyPlayable,
  discardableTools,
  moveEnergyPlayable,
  snipeTargets,
  refKeyOf,
} from "./effectTargets";
import {
  discardRetrievalCandidates,
  resumeProgram,
  runProgram,
  isCounterMoveOp,
} from "./interpreter";
import {
  evolveFromHandAvailable,
  handCostUnmet,
  handPokemonUids,
  benchArrivalCounters,
} from "./ops/cards";
import {
  gustTargets,
  offeredBranches,
  ownDevolveAvailable,
  swapBodies,
  swapDiscardCards,
  switchActiveTargets,
} from "./ops/board";
import { handCostAction } from "./promptText";
import type { AbilityProgram, StadiumAbility } from "./registry";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import { isBenchIndex, isPokemonTarget, placeEvolution, turnGate } from "./turn";
import type { GameState, InPlayPokemon, PlayerSide, PokemonTarget, Seat } from "./types";
import {
  SEATS,
  answererOf,
  isFirstTurnOf,
  isSeat,
  makeInPlay,
  otherSeat,
  withSide,
  without,
} from "./types";

// Card-play actions (§7 Trainers, §9 Abilities) and the resolver for the mid-effect decisions they
// park on. Stadiums and Tools are different: they stay in play with continuous effects read by
// continuous.ts rather than programs the interpreter runs.

/**
 * Seismitoad "Quaking Fist"'s coin, flipped when `seat` tries to use a Trainer from hand while
 * `trainerFlipLockTurn` is the current turn. `null` when no lock is live (no rng drawn); on tails
 * the card is discarded instead of used. Asked after every check that would refuse the play, so
 * only a legal try flips. The failed try still spends the Supporter/Stadium per-turn limit, but
 * nothing else a use writes.
 */
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

/**
 * §7.1–§7.3: play a Trainer from hand. An Item or Supporter (one per turn) resolves its program
 * then discards; a Stadium (one per turn) replaces the zone's occupant, different names only, and
 * stays in play. An Antique Fossil is the exception: it goes onto the Bench as a Pokémon
 * (`playFossil`).
 */
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
  // An Antique Fossil is played "as if it were a 60-HP Basic {C} Pokémon": an Item play that runs
  // no program, so it is routed before the `trainer` lookup.
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
    // §4: the player going first may not play a Supporter on turn 1, unless the card prints its own
    // exemption (Carmine). The exemption lifts only this timing rule; the once-per-turn limit below
    // still applies.
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
  // The opponent can bar a Trainer class from this seat's hand, either by an attack for this turn
  // or continuously from their Active. Checked after §4 and §7.2 so the player's own limits are
  // reported first; Carmine's exemption does not lift an opponent's lock.
  if (handPlayBarred(state, action.seat, trainerType, card)) {
    return err("HAND_PLAY_BLOCKED", handPlayBarredReason(state, action.seat, trainerType, card));
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
  // The card's printed hand cost (Ultra Ball's "discard 2 other cards"), checked with the played
  // card excluded because it cannot pay for itself.
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
  // Quaking Fist: tails discards the card and still spends the turn's Supporter.
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
    // `supporterPlayedUid` is written only here; Team Rocket's Factory and Crobat "Shadowy Envoy"
    // read the played card's name through it.
    next = {
      ...next,
      allowances: { ...next.allowances, supporterPlayed: true, supporterPlayedUid: action.uid },
    };
  }
  // Katy "your turn ends": a Trainer that ends the turn on completion, folded by
  // settleProgram exactly like an Ability's endsTurn (the Koraidon precedent).
  const endsTurn = entry?.trainerEndsTurn === true;
  // Only Item and Supporter programs are labelled, so effects that prevent "effects of Item or
  // Supporter cards" can ask every op. Stadium and Ability programs are deliberately unlabelled.
  const invokedBy = trainerType === "Supporter" ? "supporter" : "item";
  // `playedUid` is the played card itself (Caretaker shuffles itself into the deck). Not
  // `sourceUid`, which names a Pokémon and must stay absent for a Trainer.
  return settleProgram(
    runProgram(next, program, { seat: action.seat, invokedBy, playedUid: action.uid }, events),
    action.seat,
    events,
    { endsTurn },
  );
}

/**
 * Antique Fossil: "Play this card as if it were a 60-HP Basic {C} Pokémon." It is an Item play, so
 * the opponent's Item bar refuses it, but it is not playing a Basic Pokémon from hand, so no
 * Pokémon-play bar or on-bench trigger applies. Needs a free Bench slot. `makeInPlay` stamps
 * `turnPlayed`, so it cannot evolve the turn it is played.
 */
function playFossil(state: GameState, action: PlayTrainerAction, card: Card): ApplyResult {
  const itemBarred = handPlayBarred(state, action.seat, "Item", card);
  if (itemBarred) {
    return err("HAND_PLAY_BLOCKED", handPlayBarredReason(state, action.seat, "Item", card));
  }
  const side = state.players[action.seat];
  if (!fossilPlayable(state, action.seat)) {
    return err("BENCH_FULL", `the bench holds at most ${benchLimitOf(state, action.seat)} Pokémon`);
  }
  // Quaking Fist: an Antique Fossil is an Item play, so the try flips.
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
  // Risky Ruins: the seated fossil is a Basic {C} Pokémon, so it takes the counters.
  return ok(benchArrivalCounters(seated, action.seat, [action.uid], events), events);
}

/** Can `seat` put an Antique Fossil onto its Bench now? A free Bench slot is all it needs. */
export function fossilPlayable(state: GameState, seat: Seat): boolean {
  return state.players[seat].bench.length < benchLimitOf(state, seat);
}

/** §7.3 — the Stadium play, split out of playTrainer's Item/Supporter path
    (hand/uid/category already validated there): one play per turn, replaces a
    DIFFERENT-named predecessor (which goes to its owner's discard), and the
    card sits in the shared zone with no program to run — its authored effects
    are continuous, read by the pipeline (continuous.ts) while it stays. */
function playStadium(state: GameState, action: PlayTrainerAction, card: Card): ApplyResult {
  // An opponent's Stadium bar (Copperajah "Massive Body"). Checked inside `playStadium` so any
  // caller inherits it, and before the per-turn and different-name rules, since those are facts
  // about the zone rather than a rule the player broke.
  if (handPlayBarred(state, action.seat, "Stadium", card)) {
    return err("HAND_PLAY_BLOCKED", handPlayBarredReason(state, action.seat, "Stadium", card));
  }
  if (programFor(card.id)?.stadium === undefined) {
    // Coverage strategy, same as the Item/Supporter path: an unauthored
    // Stadium cannot be played rather than sitting in the zone doing nothing.
    return err("TRAINER_NOT_SIMULATED", `${card.name} is not simulated yet`);
  }
  // Ange Floette: "during the same turn you play Prism Tower" lifts the spent Stadium play.
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
  // Ange Floette: "only if you discard a Prism Tower in play".
  if (stadiumPlayOverUnmet(state, card)) {
    return err(
      "PLAY_CONDITION_NOT_MET",
      `${card.name} can be put into play only by discarding the Stadium it names`,
    );
  }

  // Quaking Fist: tails discards the Stadium and spends the turn's Stadium play.
  const flip = trainerFlipFails(state, action.seat, action.uid);
  if (flip?.failed === true) {
    return ok(
      { ...flip.state, allowances: { ...flip.state.allowances, stadiumPlayed: true } },
      flip.events,
    );
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
    events.push({
      type: "STADIUM_DISCARDED",
      seat: current.owner,
      uid: current.uid,
      cause: "replaced",
    });
  }
  next = {
    ...next,
    stadium: { uid: action.uid, owner: action.seat },
    allowances: { ...next.allowances, stadiumPlayed: true },
  };
  // A Stadium can change max HP on both boards (Gravity Mountain, or discarding a replaced
  // HP-raising Stadium), and §8.1's KO is a state check, so the sweep runs on both seats after the
  // zone is written. Status recovery (Festival Grounds) runs first so the event order is
  // STATUS_CLEARED then KO. The replaced Stadium's owner trims first (Area Zero Underdepths).
  next = recoverStatuses(next, events);
  return resolveMidTurnKnockOuts(next, action.seat, SEATS, events, undefined, current?.owner);
}

/** Is the Stadium in play the one `card`'s `playOnlyOverStadium` names? By name, either owner's. */
function stadiumPlayOverMet(state: GameState, card: Card): boolean {
  const over = programFor(card.id)?.stadium?.playOnlyOverStadium;
  if (over === undefined || state.stadium === null) return false;
  return cardOfUid(state, state.stadium.uid)?.name === over;
}

/**
 * Ange Floette's "only if you discard a Prism Tower in play" is unmet. False for every card without
 * the key.
 */
export function stadiumPlayOverUnmet(state: GameState, card: Card): boolean {
  return (
    programFor(card.id)?.stadium?.playOnlyOverStadium !== undefined &&
    !stadiumPlayOverMet(state, card)
  );
}

/**
 * Ange Floette's "you can put this card into play during the same turn you play Prism Tower": the
 * spent Stadium play does not refuse `card` while the named Stadium is in play and is `seat`'s own.
 * Known limitation: this also lets through an actor whose own earlier Prism Tower is in play and
 * whose Stadium play this turn failed.
 */
export function stadiumSpentPlayLifted(state: GameState, seat: Seat, card: Card): boolean {
  return stadiumPlayOverMet(state, card) && state.stadium?.owner === seat;
}

/**
 * §7.4: attach a Pokémon Tool from hand to one of the actor's own Pokémon. Not capped per turn; up
 * to `toolCapOf` Tools per Pokémon. There is no detach, and its effects are continuous, so nothing
 * runs here.
 *
 * Refusal message for a full Tool slot.
 */
function toolCapMessage(carried: number): string {
  return carried <= 1
    ? "one Tool per Pokémon (§7.4)"
    : `at most ${carried} Pokémon Tools on this Pokémon (Multi Adapter)`;
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
  // Jellicent ex bars "Item cards or Pokémon Tool cards"; a Tool never goes through `playTrainer`,
  // so the bar is checked here too. Checked before the slot and target checks, so a barred seat
  // learns about the bar first.
  if (handPlayBarred(state, action.seat, "Tool", card)) {
    return err("HAND_PLAY_BLOCKED", handPlayBarredReason(state, action.seat, "Tool", card));
  }
  // Shared with Impromptu Carrier's deck-search attach so the two cannot disagree.
  if (!toolCardSimulated(card)) {
    // An unauthored Tool would occupy a Tool slot while doing nothing, so reject it. A Tool counts
    // as simulated if it does anything while attached, passive or triggered.
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
  // Quaking Fist: a Tool is a Trainer used from hand, so the try flips after the target and slot
  // checks; tails discards the Tool.
  const flip = trainerFlipFails(state, action.seat, action.uid);
  if (flip?.failed === true) return ok(flip.state, flip.events);
  const flipped = flip?.state ?? state;
  const events: GameEvent[] = [
    ...(flip?.events ?? []),
    // The target is copied: the action object belongs to the caller (events.ts).
    { type: "TOOL_ATTACHED", seat: action.seat, uid: action.uid, target: { ...action.target } },
  ];
  // A Tool can newly provide status recovery, so recovery is re-checked after the attach. Runs
  // after `withSide` because the Tool must already be on the body to count as a source.
  return ok(recoverStatuses(withSide(flipped, action.seat, updated), events), events);
}

/**
 * §7.1 Rare Candy: evolve one of the actor's Basic Pokémon straight to a Stage 2 from hand. It
 * reuses `placeEvolution`, so on-evolve triggers and the evolve KO check apply as for `evolve`.
 * Timing mirrors evolve: not on the first turn, not on a Basic that came into play this turn.
 */
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
  // Rare Candy is an Item played from hand, so the opponent's Item bar stops it. The Stage 2 is put
  // by the Item's effect, not played from hand, so Pokémon-play bars (Bronzong, Arbok) do not
  // apply. Checked in the same position as for other Items, before the card's own printed bans.
  if (handPlayBarred(state, action.seat, "Item", card)) {
    return err("HAND_PLAY_BLOCKED", handPlayBarredReason(state, action.seat, "Item", card));
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
  // No Rare Candy on your own first turn. Evolve-early licences (Eevee "Boosted Evolution")
  // deliberately do not lift this: the restriction is printed on Rare Candy itself, not a rule
  // about evolving.
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
  // Rare Candy and the Stage 2 leave hand together, then the shared placement runs the evolve, its
  // trigger and the KO check. Quaking Fist tails discards Rare Candy and the Stage 2 stays in hand.
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

/**
 * Rare Candy: does `stage2` evolve, through its Stage 1, from a Basic named `basicName`? The
 * catalog stores only each card's immediate `evolveFrom`, so this bridges through any Stage 1 known
 * to the card pool. Known gap: if neither deck runs the Stage 1, the link cannot be resolved.
 */
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
  // Mirrors the handler, which does not consult the evolve-early licence.
  if (isFirstTurnOf(state, seat)) return [];
  // Mirrors the handler's Item bar so every option offered resolves to a legal `rareCandy`.
  // `undefined` card because Rare Candy is never ACE SPEC, so the rarity bar cannot apply.
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

/**
 * The key for the §9 once-per-turn Ability limit, shared by every reader and writer of
 * `allowances.abilitiesUsed`. `"sharedByName"` (Fezandipiti ex's "Flip the Script") drops the uid;
 * every other Ability keeps it.
 */
export function abilityUsedKey(
  uid: string,
  // Takes only the two fields it reads, so triggered abilities with `oncePerTurn` can key through
  // it too.
  ability: Pick<AbilityProgram, "name"> & { oncePerTurn?: AbilityProgram["oncePerTurn"] },
): string {
  const keyUid = ability.oncePerTurn === "sharedByName" ? SHARED_ABILITY_UID : uid;
  return `${keyUid}:${ability.name}`;
}

/**
 * Per-body Ability gates (`remainingHpAtMost`, `requiresEnergyType`, `benchedThisTurn`); `true`
 * when the Ability prints none. Remaining HP is measured against `effectiveMaxHp`, and an unknown
 * maximum fails the gate.
 */
export function abilityBodyGateMet(
  state: GameState,
  ability: AbilityProgram,
  pokemon: InPlayPokemon,
): boolean {
  // Munkidori "Adrena-Brain": "if this Pokémon has any {D} Energy attached". `"any"` (Dragonair)
  // means any Energy.
  if (
    ability.requiresEnergyType !== undefined &&
    !hasAttachedEnergy(state, pokemon, ability.requiresEnergyType)
  ) {
    return false;
  }
  // Fall Back to Reload: usable only if this body moved from the Active Spot to the Bench this
  // turn.
  if (ability.benchedThisTurn === true && pokemon.benchedTurn !== state.turn) return false;
  if (ability.remainingHpAtMost === undefined) return true;
  return remainingHpWithin(state, pokemon, ability.remainingHpAtMost);
}

/**
 * The per-body gate's printed clause (without "if") for refusal and greyed-row text; `null` when
 * the Ability has no per-body gate.
 */
export function abilityBodyGateClause(ability: AbilityProgram): string | null {
  if (ability.requiresEnergyType === "any") return "this Pokémon has any Energy attached";
  if (ability.requiresEnergyType !== undefined) {
    return `this Pokémon has any ${ability.requiresEnergyType} Energy attached`;
  }
  if (ability.remainingHpAtMost !== undefined) {
    return `this Pokémon's remaining HP is ${ability.remainingHpAtMost} or less`;
  }
  if (ability.benchedThisTurn === true)
    return "this Pokémon moved from the Active Spot to your Bench this turn";
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
  // §9: a continuous Ability lock turns this Pokémon's Abilities off. Checked before the other
  // gates so a locked Pokémon reports the lock, not an incidental cost failure.
  if (disabledAbilityUids(state).has(uid)) {
    return err("ABILITY_DISABLED", `${card.name} has no Abilities right now (§9)`);
  }
  if (ability.activeOnly && action.target.spot !== "active") {
    return err("ABILITY_ACTIVE_ONLY", `${ability.name} can only be used from the Active Spot (§9)`);
  }
  // Flustered Leap: "if this Pokémon is on your Bench".
  if (ability.benchOnly === true && action.target.spot !== "bench") {
    return err("ABILITY_BENCH_ONLY", `${ability.name} can only be used from the Bench (§9)`);
  }
  const usedKey = abilityUsedKey(uid, ability);
  if (ability.oncePerTurn && state.allowances.abilitiesUsed.includes(usedKey)) {
    return err("ABILITY_ALREADY_USED", `${ability.name} was already used this turn (§9)`);
  }
  // The Ability's printed board condition (Fezandipiti ex). Checked after the once-per-turn lock so
  // "already used" is reported first, and before the would-only-whiff checks so the message names
  // the printed clause.
  if (ability.playableIf !== undefined && !conditionHolds(state, action.seat, ability.playableIf)) {
    return err(
      "ABILITY_CONDITION_NOT_MET",
      `${ability.name} can only be used if ${conditionNote(ability.playableIf)} (§9)`,
    );
  }
  // Printed per-body gate (Pidove: "if this Pokémon's remaining HP is 30 or less"). Kept separate
  // from the board condition because `conditionHolds` has no uid to refer to. Ordered after the
  // once-per-turn lock for the same reason.
  if (!abilityBodyGateMet(state, ability, resolved.pokemon)) {
    return err(
      "ABILITY_CONDITION_NOT_MET",
      `${ability.name} can only be used if ${abilityBodyGateClause(ability) ?? "its printed condition holds"} (§9)`,
    );
  }
  // An Ability that would do nothing cannot be used. `uid` is the same one `runProgram` gets, so
  // costs on "this Pokémon" (Kilowattrel) are checked against the right body.
  if (!programPlayable(state, ability.program, action.seat, uid)) {
    return err("NO_LEGAL_TARGET", `${ability.name} has no legal target`);
  }
  // §9 hand cost ("You must discard … from your hand in order to use this Ability"). The payment is
  // the program's first op, so the use must be refused here before anything is committed. No
  // `excludeUid`: the Ability's card is on the board, not in hand.
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
    runProgram(
      next,
      ability.program,
      { seat: action.seat, sourceUid: uid, invokedBy: "ability" },
      events,
    ),
    action.seat,
    events,
    { endsTurn: ability.endsTurn === true },
  );
}

/**
 * §7.3: use the shared Stadium's "once during each player's turn" ability. No target; `turnGate`
 * admits only the turn's player, who uses it off their own allowance. Not affected by Pokémon
 * Ability locks. A hand cost (Academy at Night) is checked like the Trainer and Ability paths, so
 * an empty hand is refused. The program runs under the activating seat.
 */
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
  // The Stadium ability's printed condition (Community Center, Team Rocket's Factory), read for the
  // actor. Checked after the once-per-turn flag and before `programPlayable`.
  const printedGate = ability.playableIf;
  if (printedGate !== undefined && !conditionHolds(state, action.seat, printedGate)) {
    return err(
      "PLAY_CONDITION_NOT_MET",
      `${ability.label} can only be used if ${conditionNote(printedGate)} (§7.3)`,
    );
  }
  // Would-only-whiff gate, as in `useAbility`. The Stadium's uid resolves to no Pokémon, so a
  // `self` op on a Stadium ability is refused.
  if (!programPlayable(state, ability.program, action.seat, stadium.uid)) {
    return err("NO_LEGAL_TARGET", `${ability.label} has no legal target`);
  }
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
  const result = runProgram(
    next,
    ability.program,
    { seat: action.seat, sourceUid: stadium.uid },
    events,
  );
  return settleProgram(result, action.seat, events, {
    endsTurn: stadiumUseEndsTurn(ability, events, action.seat),
  });
}

/**
 * Does this Stadium use end the actor's turn? `"always"` (Lumiose City) is unconditional;
 * `"ifHealed"` (Celebratory Fanfare) checks whether this use emitted a `HEALED` row for the actor.
 * `events` holds only this action's rows and the program never parks, so the answer is final.
 */
function stadiumUseEndsTurn(
  ability: StadiumAbility,
  events: readonly GameEvent[],
  seat: Seat,
): boolean {
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
  // The controller cannot answer the opponent's printed "may" for them, and vice versa.
  const answerer = answererOf(phase);
  if (answerer !== action.seat) {
    return err("WRONG_SEAT", `only ${answerer} resolves this effect`);
  }
  // A `resumeTail` park needs a queued tail: settleProgram hands control to `advance` without
  // writing a phase, so an empty queue would return this same park forever. Unreachable through
  // normal transitions; guards against a crafted snapshot.
  if (phase.resumeTail === true && state.pending.length === 0) {
    return err("PHASE_DESYNC", "a mid-tail effect park has no pending tail to resume");
  }
  const invalid = validateChoice(phase.prompt, action.choice);
  if (invalid !== null) return invalid;
  // The copy-attack park is answered by re-entering `attack()`, not by a program, so it is routed
  // before `settleProgram`.
  const pendingOp = phase.cont.pendingOp;
  if (pendingOp.op === "useAttackAs")
    return resolveCopiedAttack(state, phase, pendingOp, action.choice);
  if (pendingOp.op === "useInPlayAttackAs")
    return resolveInPlayCopiedAttack(state, phase, pendingOp, action.choice);
  // The mid-attack copy park (Haughty Order, Seek Inspiration). A declined "you may" takes the
  // default drain, which runs the queued attack epilogue.
  const declined = action.choice.kind === "confirm" && !action.choice.yes;
  if (pendingOp.op === "useFoundAttackAs" && !declined)
    return resolveFoundAttack(state, phase, pendingOp, action.choice);
  // Backtrack Badge's offer at the printed coin flip: both answers re-enter `attack()`.
  if (pendingOp.op === "reflipAttackCoins")
    return resolveCoinRedo(state, phase, pendingOp, action.choice);
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

/**
 * A card or Ability that would do nothing cannot be played (§7). Searches, draws and heals always
 * count as playable, since the deck is hidden. Exported so the HUD can grey rows with the same
 * predicate; every input is public to the asking seat. `sourceUid` is "this Pokémon" for an
 * Ability; a Trainer passes none and a Stadium's resolves to no Pokémon, so `self` ops there are
 * refused.
 *
 * Several `attachEnergyFrom` ops in one program are alternatives (Infernape "Pyro Dance": "a Basic
 * {R} Energy card, a Basic {F} Energy card, or 1 of each"), so the program is refused only if all
 * of them would whiff. Top-level only; coin-gate arms are checked as their own programs. Returns
 * false when there are no attaches.
 */
function attachAlternativesAllWhiff(
  state: GameState,
  program: readonly EffectOp[],
  seat: Seat,
): boolean {
  // Crispin's `oneOfRecorded` attach uses the Energy its own search puts in hand, so the hand at
  // play time says nothing about it.
  const attaches = program.filter(
    (op): op is OpOf<"attachEnergyFrom"> =>
      op.op === "attachEnergyFrom" && op.oneOfRecorded === undefined,
  );
  if (attaches.length === 0) return false;
  return attaches.every(
    (op) =>
      firstAttachableEnergy(
        state,
        attachSeat(op, seat),
        op.source,
        op.energyType,
        op.anyEnergy,
        op.energyName,
      ) === undefined || attachEnergyTargets(state, seat, op).length === 0,
  );
}

/**
 * Discard sweeps are alternatives too (Megaton Blower: Tools, Special Energy and a Stadium), so the
 * card is refused only when all `count: "all"` sweeps would find nothing. Returns false when the
 * program has no such sweep.
 */
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
  if (sweepAlternativesAllWhiff(state, program, seat, sourceUid)) return false;
  for (const op of program) {
    if (op.op === "coinFlipGate") {
      // A coin flip is procedure, not effect, so if the branches that could run would only whiff,
      // the card can only whiff and cannot be played (§7). A one-armed gate is checked on `then`;
      // with `otherwise` the card is refused only if both arms would whiff. Not extended to
      // `optional` (declining is a legal resolution) or to `conditionGate`. The source uid is
      // passed down so a gated `self` cost is still that Pokémon's.
      if (
        !programPlayable(state, op.then, seat, sourceUid) &&
        (op.otherwise === undefined || !programPlayable(state, op.otherwise, seat, sourceUid))
      ) {
        return false;
      }
      continue;
    }
    // Uses the op's own candidate funnel, not the Bench length, because riders can narrow it
    // (Lisia's Appeal: Basics only).
    if (op.op === "gust" && gustTargets(state, seat, op).length === 0) return false;
    // Spiteful Evolution: "Choose a card in your hand that evolves from this Pokémon". The hand is
    // checked; the deck form stays ungated.
    if (
      op.op === "evolveFromDeck" &&
      op.fromHand === true &&
      !evolveFromHandAvailable(state, seat, sourceUid)
    ) {
      return false;
    }
    // Repel: an empty opponent Bench refuses the Item (Bench size is public).
    if (op.op === "opponentSwitchOut" && state.players[otherSeat(seat)].bench.length === 0) {
      return false;
    }
    // Uses `snipeTargets` because `opponentAny` can target the Active. `count: "all"` is exempt: it
    // resolves inline and an empty set is a silent no-op, not an empty prompt.
    if (
      op.op === "damageChosen" &&
      op.count !== "all" &&
      snipeTargets(state, seat, op).length === 0
    ) {
      return false;
    }
    // Only a rider (`remainingHpAtMost`, Bianca's Devotion) can empty this set; asked
    // unconditionally so this line need not know which riders can.
    if (op.op === "healChosen" && healChosenTargets(state, seat, op).length === 0) return false;
    // Blowtorch's "Choose 1": no branch with a target means the Item can only whiff.
    if (op.op === "chooseOneOffered" && offeredBranches(state, seat, op).length === 0) return false;
    // Strange Timepiece: no own evolved body of the type, or Milotic stopping the cards reaching
    // the hand, means the Item can only whiff.
    if (
      op.op === "devolveChosen" &&
      op.whose === "self" &&
      !ownDevolveAvailable(state, seat, op.pokemonType)
    ) {
      return false;
    }
    // A full opponent Bench is public, so it refuses the Bench arm; checked before the hand test
    // because it refuses even when the hand has a match.
    if (
      op.op === "bottomFromOpponentHand" &&
      op.dest === "bench" &&
      state.players[otherSeat(seat)].bench.length >= benchLimitOf(state, otherSeat(seat))
    ) {
      return false;
    }
    // Tyme names "a Pokémon in your hand": with none, the card can only whiff.
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
    // Uses the op's own candidate function, which handles subgroup filters (Team Rocket's Giovanni)
    // and `fromSource` (Meowscarada's "if this Pokémon is on your Bench"). A gated consequent is
    // not scanned, so Giovanni with an empty opponent Bench still switches.
    if (op.op === "switchActive" && switchActiveTargets(state, seat, op, sourceUid).length === 0) {
      return false;
    }
    // `attachEnergyFrom` is checked as alternatives in `attachAlternativesAllWhiff`, not per op.
    // The other gates here stay per op because some are costs. `attachFromTop` and `attachFromDeck`
    // are not gated: every card with them also shuffles, which is an effect. `payFromHand` is
    // checked by the callers via `handCostUnmet`.
    //
    // Glass Trumpet: no Basic Energy in the discard pile or no Benched {C} body means the Item can
    // only whiff.
    if (op.op === "attachFromDiscard") {
      const offer = attachFromDiscardOffer(state, seat, op);
      if (offer.candidates.length === 0 || offer.targets.length === 0) return false;
    }
    // Lethargic Charge: no Energy card in hand, or no matching Active, means the attach can only
    // whiff. Only the singular `one` form is gated.
    if (
      op.op === "attachFromHand" &&
      op.one === true &&
      !attachFromHandPlayable(state, seat, op, sourceUid)
    ) {
      return false;
    }
    if (op.op === "moveEnergy" && !moveEnergyPlayable(state, seat, op, sourceUid)) {
      // No movable Energy, or fewer than two Pokémon in play, means the move can only whiff (Energy
      // Switch, Poppy). The source uid is passed for the uid-resolved routes.
      return false;
    }
    // A chosen Tool discard with nothing to choose can only whiff (Tool Scrapper). `"all"` is
    // handled by the sweep alternatives.
    if (
      op.op === "discardTools" &&
      op.count !== "all" &&
      discardableTools(state, seat, op.sides).length === 0
    ) {
      return false;
    }
    // Ruffian with no opponent body carrying a Tool or Special Energy can only whiff.
    if (op.op === "discardToolAndSpecialEnergyChosen" && ruffianBodies(state, seat).length === 0) {
      return false;
    }
    // Patrat "Watchful Eye": counter moves are locked while a holder is in play, so such a card is
    // refused.
    if (isCounterMoveOp(op) && countersMoveLocked(state)) return false;
    // Ogre's Mask with no qualifying body in play or no qualifying card in the discard pile can
    // only whiff.
    if (
      op.op === "switchWithDiscardNamed" &&
      (swapBodies(state, seat, op.filter).length === 0 ||
        swapDiscardCards(state, seat, op.filter).length === 0)
    ) {
      return false;
    }
    // Adrena-Brain with no damaged own body or no opponent body can only whiff.
    if (
      op.op === "moveCountersToOpponentChosen" &&
      (counterToOpponentSources(state, seat).length === 0 ||
        (state.players[otherSeat(seat)].active === null &&
          state.players[otherSeat(seat)].bench.length === 0))
    ) {
      return false;
    }
    // A hand return the Milotic lock wholly blocks can only whiff (Scoop Up Cyclone with every own
    // body locked). Own board only.
    if (
      op.op === "returnBenched" &&
      op.dest === "hand" &&
      op.whose === "self" &&
      inPlayToHandBlocked(state, seat)
    ) {
      return false;
    }
    // Rocket Brain with no damaged own Team Rocket's body, or no other own body to move a counter
    // onto, can only whiff.
    if (
      op.op === "moveCounterOwnChosen" &&
      !counterOwnSources(state, seat, op.ownerPokemon).some(
        (ref) => counterOwnDestinations(state, seat, ref.spot).length > 0,
      )
    ) {
      return false;
    }
    // `count: "all"` sweeps are handled by `sweepAlternativesAllWhiff`.
    if (
      op.op === "discardEnergy" &&
      op.count !== "all" &&
      !discardEnergyPlayable(state, seat, op, sourceUid)
    ) {
      // Nothing matching means the discard can only whiff (Giacomo with no Special Energy in play).
      // For `from: "self"` this is a cost gate (Kilowattrel), answered on `sourceUid`. It also
      // applies to Crushing Hammer through the coin-gate descent.
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
  // A bare deck mill (Hole-Digging Shovel) does nothing on an empty deck, and deck size is public,
  // so the card is refused.
  if (onlyOp?.op === "discardDeckTop") {
    const milled = onlyOp.whose === "self" ? seat : otherSeat(seat);
    if (state.players[milled].deck.length === 0) return false;
  }
  return programPlayable(state, program, seat);
}

/** Resolve one of the actor's own in-play Pokémon off a wire target: the
    Active (must be present) or a benched index (checked like every wire index). */
function resolveOwnPokemon(
  state: GameState,
  seat: Seat,
  target: PokemonTarget,
): { pokemon: InPlayPokemon; uid: string; reject?: undefined } | { reject: Rejection } {
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
function validateChoice(prompt: EffectPrompt, choice: EffectChoice): Rejection | null {
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
      // The floor: 0 for any printed "up to", and `min === max` for a mandatory exact pick.
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
      // Per-kind caps (Drayton: "a Pokémon and a Trainer card"), enforced only here because the
      // validator checks answers against the prompt. A uid in two groups counts against both.
      for (const cap of prompt.caps ?? []) {
        const inGroup = new Set(cap.uids);
        const picked = choice.uids.filter((uid) => inGroup.has(uid)).length;
        if (picked > cap.max) {
          return err("BAD_EFFECT_CHOICE", `pick at most ${cap.max} card(s) of that kind`);
        }
      }
      // Disjunctive caps (Brock's Scouting: "up to 2 Basic Pokémon or 1 Evolution Pokémon"): the
      // answer must fit wholly within one entry. The empty answer fits every entry.
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
      // `min`..`max` distinct offered refs. The printed number is exact unless the card says "up
      // to", so the floor stops a player paying an irreversible cost and placing nothing. The empty
      // answer is legal only when `declinable`, and it is all or nothing.
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
        const key = refKeyOf(ref);
        if (seen.has(key)) return err("BAD_EFFECT_CHOICE", "a Pokémon picked twice");
        seen.add(key);
      }
      return null;
    }
    case "choosePokemon": {
      // Exactly one offered ref, or none when the prompt carries a printed ceiling (with a quantity
      // in 1..upTo when given). Without a ceiling, an omitted ref must be refused (Boss's Orders
      // has no "up to").
      if (choice.kind !== "pokemon") {
        return err("BAD_EFFECT_CHOICE", "expected a Pokémon choice");
      }
      if (choice.ref === undefined) {
        // The decline, kept as its own arm so the error says it cannot be declined rather than that
        // it is malformed. A `take` with no ref is refused below.
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
      // The answered quantity, enforced against the printed ceiling: refused when the prompt has no
      // ceiling, when above it or not a whole number, and when zero alongside a named body (the
      // decline is the absent ref).
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
      // Up to `max` movable Energy, each paired with a destination. Every pick and destination must
      // be offered, and no pick may land on the body it came from. Unless the prompt sets
      // `anySource` / `anyDest`, all picks share one source and one destination. An empty pick is a
      // decline unless the prompt has a floor.
      if (choice.kind !== "moveEnergy" || !Array.isArray(choice.picks)) {
        return err("BAD_EFFECT_CHOICE", "expected an energy-move choice");
      }
      if (choice.picks.length > prompt.max) {
        return err("BAD_EFFECT_CHOICE", `move at most ${prompt.max} Energy`);
      }
      // The floor for a mandatory move (Castform "Move all Energy"). A missing `min` means
      // declinable, which keeps older persisted parks meaning what they meant.
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
      // Mandatory, so the count is exact: `total` takes exactly `count` Energy, `each` exactly one
      // from every offered Pokémon. Every uid must be offered and none repeated. Nothing pins a
      // multi-count `total` pick to one host; every current producer is single-Pokémon.
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
          : new Set(prompt.discardable.map((d) => refKeyOf(d.from))).size;
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
          const key = refKeyOf(from);
          if (sources.has(key)) {
            return err("BAD_EFFECT_CHOICE", "only one Energy per Pokémon");
          }
          sources.add(key);
        }
      }
      return null;
    }
    case "discardTools": {
      // "Discard up to N Pokémon Tools": 0..`max`, every uid offered, none twice, no per-source
      // rule. `max` is read off the prompt, which is already clamped to the board. Tools may come
      // from both boards when offered (Tool Scrapper).
      if (choice.kind !== "discardTools" || !Array.isArray(choice.uids)) {
        return err("BAD_EFFECT_CHOICE", "expected a tool-discard choice");
      }
      // An exact `total` (Multi Adapter's trim, Ruffian on a two-Tool body).
      if (prompt.scope.kind === "total" && choice.uids.length !== prompt.scope.count) {
        return err("BAD_EFFECT_CHOICE", `discard exactly ${prompt.scope.count} Pokémon Tools`);
      }
      const scope =
        prompt.scope.kind === "total"
          ? { kind: "upTo" as const, max: prompt.scope.count }
          : prompt.scope;
      // Any other scope is refused rather than accepted unchecked.
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
      // "Attach … in any way you like": each pick carries its own destination. At most `max` picks;
      // every uid offered and none twice; every destination an offered target; at most
      // `maxPerTarget` per Pokémon when set; and one Pokémon for the whole answer when `oneTarget`
      // is set. Enforced only here; the apply re-derives none of it. An empty list is a decline,
      // and the leftovers clause still runs.
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
        const key = refKeyOf(to);
        const count = (perTarget.get(key) ?? 0) + 1;
        if (prompt.maxPerTarget !== undefined && count > prompt.maxPerTarget) {
          return err(
            "BAD_EFFECT_CHOICE",
            `attach at most ${prompt.maxPerTarget} card(s) to any one Pokémon`,
          );
        }
        perTarget.set(key, count);
        // "Attach them to 1 of your Pokémon": all cards share one destination. Uses the map size,
        // so an empty answer stays a legal decline.
        if (prompt.oneTarget === true && perTarget.size > 1) {
          return err("BAD_EFFECT_CHOICE", "attach every card to the same Pokémon");
        }
      }
      return null;
    }
    case "guessHp": {
      // Tyme's guess must be a non-negative integer.
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
      if (
        target !== undefined &&
        (prompt.cards === undefined ||
          (!choice.yes && prompt.cards.no === undefined) ||
          !isPokemonRef(target) ||
          !prompt.targets?.some((ref) => refEquals(ref, target)))
      ) {
        return err("BAD_EFFECT_CHOICE", "not a legal attachment target");
      }
      return null;
    }
    case "orderCards": {
      // A permutation: a short answer would destroy cards, a repeat would duplicate one, and an
      // unoffered uid would pull a card from below the visible window. Equal length, no duplicates
      // and all offered together make it a bijection.
      if (choice.kind !== "orderCards" || !Array.isArray(choice.uids)) {
        return err("BAD_EFFECT_CHOICE", "expected a card ordering");
      }
      // An empty ordering is the printed alternative (Deduction Kit: "or shuffle them and put them
      // on the bottom of your deck"), legal only when the prompt carries `alt`.
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
      // Exactly one offered attack index; mandatory ("Choose 1"). `Number.isInteger` because the
      // value is used as an index.
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
      // Exactly one offered face-down prize slot; membership refuses out-of-range and face-up
      // slots.
      if (choice.kind !== "prize" || !Number.isInteger(choice.index)) {
        return err("BAD_EFFECT_CHOICE", "expected exactly one prize choice");
      }
      if (!prompt.indices.includes(choice.index)) {
        return err(
          "BAD_EFFECT_CHOICE",
          `${String(choice.index)} is not a face-down Prize you can turn`,
        );
      }
      return null;
    }
  }
}

function isPokemonRef(value: unknown): value is PokemonRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as { seat?: unknown; spot?: unknown };
  if (!isSeat(ref.seat)) return false;
  return isPokemonTarget(ref.spot);
}

function refEquals(a: PokemonRef, b: PokemonRef): boolean {
  if (a.seat !== b.seat || a.spot.spot !== b.spot.spot) return false;
  if (a.spot.spot === "bench" && b.spot.spot === "bench") return a.spot.index === b.spot.index;
  return true;
}
