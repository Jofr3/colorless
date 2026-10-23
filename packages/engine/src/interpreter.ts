import { conditionHolds, countCardsInHand, countPokemonInPlay } from "./boardCondition";
import {
  benchMatches,
  cardOfUid,
  energyProvidesOf,
  isBasicPokemon,
  matchesFilter,
  topCardOf,
  topUid,
} from "./cards";
import {
  benchLimitOf,
  countersMoveLocked,
  discardPileLockedOf,
  opponentMillRetortOf,
  spendCoinRedo,
  supporterEffectOf,
  toolCapOf,
} from "./continuous";
import type {
  DiscardScope,
  EffectChoice,
  EffectContext,
  EffectContinuation,
  EffectPrompt,
  EffectRecord,
  PokemonRef,
  RunResult,
} from "./effectPrompt";
import type { CardFilter, EffectOp, EffectSlot, OpOf, PokemonType } from "./effectTypes";
import { STATUS_WORD_OF } from "./effects";
import {
  benchSpace,
  cardIdentity,
  discardableEnergies,
  discardableTools,
  discardVictimSeat,
  effectRefused,
  filteredRefs,
  forcedDiscards,
  interchangeableCandidates,
  moveBoardSeat,
  moveCap,
  moveEndpoints,
  moveFloor,
  oppAnyRefs,
  oppBenchRefs,
  ownBenchRefs,
  ownInPlayRefs,
  recorded,
  recordMoved,
  refKeyOf,
  refPokemon,
  refTopCard,
  reorderWindow,
  reservedDiscards,
  snipeTargets,
  sourceRef,
  subgroupRefs,
  unshieldedEntries,
  unshieldedRefs,
} from "./effectTargets";
import type { GameEvent, StatusName } from "./events";
// Import cycle with flow.ts; safe because both ends are hoisted function declarations called only
// at run time.
import { discardMisplacedEnergy } from "./flow";
import {
  chooseOneChain,
  cycleOwnPrizes,
  deckSwapCandidates,
  devolveBodyToHand,
  devolveEach,
  devolveEachToHand,
  devolveTargets,
  discardBenchedRefs,
  discardDefender,
  discardStadium,
  doomBodyAt,
  gust,
  gustTargets,
  knockOutChosenTargets,
  knockOutDefender,
  knockOutEach,
  knockOutSelf,
  lookAtPrize,
  offeredBranches,
  overCapToolBody,
  ownDevolveAnswered,
  ownDevolveTargets,
  queueStadiumLeaveTrims,
  queueTakePrize,
  returnBenched,
  returnSelf,
  shedOwnBody,
  shuffleBenchedRefsIntoDeck,
  swapBodies,
  swapBodyAnswered,
  swapDiscardCards,
  swapTurnedPrizeWithRevealed,
  switchActiveTargets,
  switchOwn,
  switchRecording,
  switchWithDeckCard,
  switchWithDeckNamed,
  switchWithDiscard,
  trimToolsApply,
  turnPrizeFaceUp,
  turnPrizeFaceUpAt,
  winGame,
} from "./ops/board";
import {
  attachableToolCard,
  benchArrivalCounters,
  bottomDeckTop,
  bottomFromOpponentHandApply,
  bottomFromOpponentHandOffer,
  copiedSupporterOps,
  deckChosenFromHand,
  discardChosenFromHand,
  discardHand,
  evolveFromDeckMove,
  evolveFromDeckOffer,
  evolveFromHandMove,
  freeToolSlotsOfSource,
  handCostCandidates,
  handPokemonUids,
  handRefresh,
  hpGuessApply,
  lookWindow,
  opponentSupporterOffer,
  payFromHandApply,
  randomDiscardDownTo,
  randomFromOpponentHand,
  retrieveMove,
  revealFromTop,
  revealHand,
  searchAttachToSelf,
  searchDeckOrElse,
  searchMove,
  selfDiscardDownTo,
  shuffleDeck,
  shufflePlayedCardIntoDeck,
} from "./ops/cards";
import {
  anyWayBudget,
  anyWayDestinations,
  anyWaySourceAnswered,
  anyWaySources,
  coinRedoPrompt,
  counterEachAll,
  counterOwnDestinations,
  counterOwnSources,
  countersOnRecordedBody,
  counterToOpponentSources,
  counterUntilRemainingHp,
  damageActive,
  damageSelf,
  damageSourceBody,
  damageSubject,
  flipOrKeep,
  healChosen,
  healChosenTargets,
  healEach,
  healEachAll,
  healSelf,
  healSubject,
  moveCountersBetweenOpponents,
  moveCountersFromBench,
  moveCountersToDefender,
  moveCountersToOpponent,
  moveOneOwnCounter,
  nextAnyWayRound,
  perHeadsHit,
  placeCountersOnSelf,
  placeSnipe,
  recoilAmount,
  ruffianBodies,
  snipeActive,
  snipeAmount,
  snipeEachByCounters,
  spreadDamage,
} from "./ops/damage";
import {
  attachableEnergies,
  attachedBasicEnergyTypedFilter,
  attachEnergyFrom,
  attachEnergyTargets,
  attachFromDeckOffer,
  attachFromDiscardOffer,
  attachFromHandOffer,
  attachFromTopApply,
  attachFromTopOffer,
  attachFromZoneApply,
  attachSeat,
  attachTake,
  discardAttachCeiling,
  discardEnergyApply,
  discardEnergyFromHealed,
  eachAttachTopUp,
  energyPickOffer,
  firstAttachableEnergy,
  handTopUp,
  moveEnergyApply,
  opponentInPlayNameFilter,
  perBodyDeckOp,
  toolDiscardApply,
} from "./ops/energy";
import {
  applyStatus,
  boostAttack,
  boostSideAttacksThisTurn,
  bountyDefender,
  bountyThisAttack,
  clearStatus,
  exposeDefender,
  exposeSelf,
  flipLockAttack,
  flipLockTrainerPlay,
  installChosenAttackShield,
  installNoWeakness,
  installRecoil,
  installSideAttackBlock,
  installSideDamageReductionNextTurn,
  lockDefenderAttack,
  lockSideAttacks,
  lockSideRetreat,
  markHandAttach,
  preventAttack,
  preventAttackUse,
  preventChosenAttack,
  preventDamage,
  preventHandPlay,
  preventRetreat,
  reduceDamage,
  retypeDefenderWeakness,
  scheduleCounters,
  scheduleDiscard,
  scheduleEndOfTurnHandDiscard,
  scheduleKnockOut,
  taxDefender,
  weakenDefenderAttacks,
} from "./ops/locks";
import {
  attachEachFromDiscardNote,
  attachFromDeckNote,
  attachFromDiscardNote,
  attachFromHandNote,
  attachNote,
  attachTargetNoun,
  bottomFromOpponentHandNote,
  chosenAttackShieldNote,
  devolveChosenNote,
  discardNote,
  energyPickNote,
  gustTargetNoun,
  healTargetNoun,
  healUpToNote,
  knockOutChosenNote,
  LOOK_ALIKE_SHOW_NOTE,
  lookNote,
  mayDrawNote,
  moveNote,
  opponentDiscardNote,
  ownDevolveNote,
  ownerNoun,
  payFromHandNote,
  reorderNote,
  retrieveNote,
  retrieveNoun,
  returnBenchedChosenNote,
  returnBenchedNote,
  returnBenchedRestNote,
  searchNote,
  snipeNote,
  switchTargetNoun,
  toolDiscardNote,
} from "./promptText";
import type { CoinFace } from "./rng";
import { shuffle } from "./rng";
import type { GameState, Seat } from "./types";
import {
  BENCH_MAX,
  drawToHand,
  HP_PER_COUNTER,
  isFirstTurnOf,
  koByEffectMarker,
  otherSeat,
  presentStatuses,
  relativeSeat,
  turnOwnerOf,
  withSide,
} from "./types";

export type { BlockingAttackGate } from "./boardCondition";
export {
  attackAgainBarred,
  attackAgainLicensed,
  attackBarredByAbility,
  attackTimingBlocked,
  attackTimingNote,
  attackerPreWRBonus,
  conditionHolds,
  conditionNote,
  countCardsInDiscardPile,
  countCardsInHand,
  countOwnerPokemonInPlay,
  countPokemonInPlay,
  evolveAliasLicensed,
  evolveEarlyLicensed,
} from "./boardCondition";
export type {
  DiscardScope,
  EffectChoice,
  EffectContext,
  EffectContinuation,
  EffectPrompt,
  EffectRecord,
  PokemonRef,
  RunResult,
} from "./effectPrompt";
export {
  discardEnergyPlayable,
  discardableEnergies,
  discardableTools,
  effectRefused,
  moveEnergyPlayable,
  refKeyOf,
  snipeTargets,
} from "./effectTargets";
export {
  doomBodyAt,
  gustTargets,
  knockOutChosenTargets,
  offeredBranches,
  ownDevolveAvailable,
  swapBodies,
  swapDiscardCards,
  switchActiveTargets,
  switchInto,
} from "./ops/board";
export {
  benchArrivalCounters,
  discardHand,
  evolveFromHandAvailable,
  handCostUnmet,
  handPokemonUids,
  opponentSupporterOffer,
} from "./ops/cards";
export {
  coinRedoPrompt,
  consumeTools,
  consumedTools,
  counterOwnDestinations,
  counterOwnSources,
  counterToOpponentSources,
  detonateDeluxeBomb,
  discardToPile,
  healChosenTargets,
  ruffianBodies,
} from "./ops/damage";
export {
  attachEnergyTargets,
  attachFromDiscardOffer,
  attachFromHandPlayable,
  attachSeat,
  firstAttachableEnergy,
  shockHandAttach,
} from "./ops/energy";
export { applyStatus } from "./ops/locks";
export { handCostAction, handCostPhrase, retrieveNoun } from "./promptText";

// The shared effect interpreter: the one place a GameState changes under an op program (attack,
// Trainer or Ability). It can park mid-effect, and the continuation is plain JSON so it persists
// and replays identically. It may place damage but never resolves Knock Outs; flow.ts owns every
// Knock Out.

/** Run an op program from the top. Synchronous ops apply in order; the first
    op that needs a decision PARKS (returns the prompt + a continuation), and
    an empty/forced decision auto-resolves without a prompt (the M1 doctrine:
    a choice with no choice in it is not a choice). A coin-flip gate splices
    its heads-branch into the work queue so parking works uniformly through
    a gate too (no representative program parks inside one — but the shape is
    correct if one ever does). */
export function runProgram(
  state: GameState,
  program: readonly EffectOp[],
  ctx: EffectContext,
  /** What earlier ops recorded (§9.2): `{}` for a program run from the top,
      which is every caller but `resumeProgram`. Mutated in place as the run
      proceeds, like `events`. */
  record: EffectRecord,
  events: GameEvent[],
): RunResult {
  let next = state;
  const queue: EffectOp[] = [...program];
  while (queue.length > 0) {
    const op = queue.shift() as EffectOp;
    if (op.op === "coinFlipGate") {
      // `coins` is the printed count, default one. Every flip is taken and announced before any
      // branch is consulted, so `rngState` advances identically on every outcome and the log shows
      // each coin.
      const flipped = flipOrKeep(next, op.faces, op.coins ?? 1, ctx, events);
      next = flipped.state;
      const { faces, redo } = flipped;
      // A live Backtrack Badge parks its re-flip offer before the branch is chosen.
      if (redo !== null) {
        queue.unshift({ op: "reflipCoins", toolUid: redo, faces: [...faces], retry: op });
        continue;
      }
      // The unanimous face, or `null` when the coins disagree: "If both of them are heads" is
      // satisfied only by agreement, so a mixed result takes `otherwise`.
      const face = faces.every((drawn) => drawn === faces[0]) ? (faces[0] ?? null) : null;
      // The winning face defaults to heads. Either branch is spliced by the same `unshift`, so an
      // op inside it can park; an absent `otherwise` splices nothing.
      queue.unshift(
        ...(face === (op.onTails === true ? "tails" : "heads") ? op.then : (op.otherwise ?? [])),
      );
      continue;
    }
    if (op.op === "conditionGate") {
      // The deterministic gate (Falkner's Stadium, Grusha's "instead"), spliced
      // like the coin flip so an op inside a branch can still park. Evaluated
      // against `next` — the board AS OF this point, with every earlier op in
      // the program applied. No event: the condition is public (BoardCondition),
      // so unlike a coin flip it tells the opponent nothing they can't see.
      queue.unshift(...(conditionHolds(next, ctx.seat, op.cond) ? op.then : (op.otherwise ?? [])));
      continue;
    }
    if (op.op === "recordGate") {
      // The printed "in this way" / "if you do" (§9.2 — Miriam, Dendra), spliced
      // like the other two gates so an op inside a branch can still park. Reads
      // the RUNNING record, not `ctx`: what makes this gate different from the
      // other two is that its answer is produced by this very program, so it
      // must see writes made since the run started — including one made by an
      // op that parked and resolved through resolveEffect. No event: the
      // recording op already announced these cards by uid.
      queue.unshift(...(recordGateHolds(next, ctx, op, record) ? op.then : (op.otherwise ?? [])));
      continue;
    }
    // An `atLeastOne` attach learns here whether it may be declined; the queue and record are only
    // visible at this level.
    const live = atLeastOneDecline(next, op, queue, ctx, record);
    const stepped = stepOp(next, live, ctx, record, events);
    if ("park" in stepped) {
      // rest = the queue as it stands after shifting `op` — a plain EffectOp[].
      return {
        kind: "parked",
        state: next,
        // A §9.2 gate later in the queue makes the answer buy something the op cannot see, so the
        // consequence is appended to the note here.
        prompt: withCountersConsequence(withConsequence(stepped.park, live, queue), live, queue),
        cont: { pendingOp: live, rest: [...queue], ctx, ...carriedRecord(record) },
        ...(stepped.decider === undefined ? {} : { decider: stepped.decider }),
      };
    }
    // Team Rocket's Energy state check after every synchronous step, so a misplaced card is
    // discarded before the next op reads the board.
    next = discardMisplacedEnergy(stepped.done, events);
    // A synchronous step may schedule more ops; they are queued with the same `unshift` so they can
    // park.
    if (stepped.schedule !== undefined) queue.unshift(...stepped.schedule);
  }
  return { kind: "done", state: next };
}

/**
 * `attachEnergyFrom.atLeastOne` (Infernape "Pyro Dance": "a Basic {R} Energy card, a Basic {F}
 * Energy card, or 1 of each"). The op becomes declinable when an earlier op with the same
 * `recordAs` slot already attached, or a later queued one still can; otherwise its pick stays
 * mandatory, so the empty answer is unreachable.
 */
function atLeastOneDecline<T extends EffectOp>(
  state: GameState,
  op: T,
  queue: readonly EffectOp[],
  ctx: EffectContext,
  record: EffectRecord,
): T {
  if (op.op !== "attachEnergyFrom" || op.atLeastOne !== true || op.declinable === true) return op;
  const slot = op.recordAs;
  if (slot === undefined) return op;
  const earlierLanded = recorded(record, slot).length > 0;
  const laterCanLand = queue.some(
    (later) =>
      later.op === "attachEnergyFrom" &&
      later.atLeastOne === true &&
      later.recordAs === slot &&
      firstAttachableEnergy(
        state,
        attachSeat(later, ctx.seat),
        later.source,
        later.energyType,
        later.anyEnergy,
        later.energyName,
      ) !== undefined &&
      (later.toSelf === true ? sourceRef(state, ctx) : attachEnergyTargets(state, ctx.seat, later))
        .length > 0,
  );
  return earlierLanded || laterCanLand ? { ...op, declinable: true } : op;
}

/** Eligible discard cards, shared by retrieval prompts and play validation. */
export function discardRetrievalCandidates(
  state: GameState,
  seat: Seat,
  op: OpOf<"discardPileRetrieval">,
  record: EffectRecord = {},
): string[] {
  const barred = new Set(op.exclude === undefined ? [] : recorded(record, op.exclude));
  // Bench destinations admit Basic Pokémon only unless the noun names otherwise. Cards locked out
  // of the discard pile ("This card can't be put into your hand or deck from the discard pile.")
  // are never offered for a hand or deck destination.
  return state.players[seat].discard.filter(
    (uid) =>
      !barred.has(uid) &&
      matchesFilter(cardOfUid(state, uid), op.filter) &&
      (op.dest === "bench" || !discardPileLockedOf(cardOfUid(state, uid))) &&
      (op.dest !== "bench" || benchMatches(cardOfUid(state, uid), op.filter)),
  );
}

/**
 * How many uids filed under `slot` match the printed noun. An absent `filter` counts every uid. A
 * uid the state cannot resolve does not count under a filter; the unfiltered branch is kept
 * separate so such uids still count there.
 */
function scoredSlot(
  record: EffectRecord,
  state: GameState,
  slot: EffectSlot,
  filter: CardFilter | undefined,
): number {
  const filed = recorded(record, slot);
  return filter === undefined
    ? filed.length
    : filed.filter((uid) => matchesFilter(cardOfUid(state, uid), filter)).length;
}

/** The slot a parking op will file its answer under, if any. */
function recordSlotOf(op: EffectOp): EffectSlot | undefined {
  return op.op === "payFromHand" ||
    op.op === "discardPileRetrieval" ||
    op.op === "attachFromDeck" ||
    op.op === "bottomFromOpponentHand" ||
    op.op === "discardEnergy" ||
    // Recording ops whose park note must state what the answer buys. Omitting one is silent:
    // `withConsequence` would drop the clause.
    op.op === "switchActive" ||
    op.op === "gust" ||
    op.op === "searchDeck" ||
    op.op === "attachFromHand" ||
    op.op === "revealFromHand"
    ? op.recordAs
    : // Always files the fixed `placed` slot.
      op.op === "putCountersOnSelfChosen"
      ? "placed"
      : undefined;
}

// `discardTools` is not listed: it has no `recordAs`, since no card pairs a Tool discard with an
// "If you do," consequent.

// `turnPrizeFaceUp` and `randomFromOpponentHand` record but are not listed: their gates wrap a
// second gate and an `optional` that `describeBranch` cannot phrase, and the switch is asked by its
// own confirm.

/**
 * Does the record satisfy this gate? A whiffed op files an empty array, so the length is checked,
 * not the key. `contains: "yourActive"` narrows to cards now on the controller's Active, read from
 * the live board as of the gate.
 */
function recordGateHolds(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"recordGate">,
  record: EffectRecord,
): boolean {
  const filed = recorded(record, op.slot);
  if (filed.length === 0) return false;
  if (op.contains !== "yourActive") return true;
  const active = state.players[ctx.seat].active;
  if (active === null) return false;
  return filed.some((uid) => active.energy.includes(uid));
}

/**
 * A recording op's prompt must say what the answer buys, so it looks down the queue for the gate
 * that reads its slot and appends the printed conditional. An unrecognised op in the branch yields
 * no clause rather than a partial one. Only top-level gates are scanned.
 */
function withConsequence(
  prompt: EffectPrompt,
  op: EffectOp,
  queue: readonly EffectOp[],
): EffectPrompt {
  const slot = recordSlotOf(op);
  if (slot === undefined) return prompt;
  const gate = queue.find((q) => q.op === "recordGate" && q.slot === slot);
  if (gate === undefined || gate.op !== "recordGate") return prompt;
  const clause = describeBranch(gate.then);
  if (clause === null) return prompt;
  // The CONDITION, not just the consequence. "If you do" is right for a gate that
  // asks whether the op did anything at all; it is wrong — and quietly wrong, the
  // worst kind in a dialog — for one that asks where the cards LANDED. A player
  // reading "If you do, it is now Poisoned" over Janine's prompt would take the
  // poison for a certainty of attaching at all, and pick two Benched Pokémon.
  const condition = describeCondition(op, gate);
  return condition === null
    ? prompt
    : { ...prompt, note: `${prompt.note} ${condition}, ${clause}.` };
}

/**
 * Note the consequence when a later `countersOnRecordedBody` reads the parked op's slot: the answer
 * decides which body takes the counters.
 */
function withCountersConsequence(
  prompt: EffectPrompt,
  op: EffectOp,
  queue: readonly EffectOp[],
): EffectPrompt {
  const slot = op.op === "evolveFromDeck" ? op.recordAs : recordSlotOf(op);
  if (slot === undefined) return prompt;
  const counters = queue.find((q) => q.op === "countersOnRecordedBody" && q.slot === slot);
  if (counters === undefined || counters.op !== "countersOnRecordedBody") return prompt;
  const n = counters.amount / HP_PER_COUNTER;
  return {
    ...prompt,
    note: `${prompt.note} If you do, place ${n} damage counter${n === 1 ? "" : "s"} on that Pokémon.`,
  };
}

/**
 * The gate's condition as a printed phrase, or null. A plain gate is "If you do". A narrowed gate
 * needs wording specific to the recording op; an op without such wording yields null, dropping the
 * clause rather than describing a narrow gate in broad words.
 */
function describeCondition(op: EffectOp, gate: OpOf<"recordGate">): string | null {
  // Ortega prints its gate in long form, so its exact text is used, checked before the plain
  // default. The `contains === undefined` and `dest === undefined` checks keep the phrase from
  // being used for a narrowed gate or a bench destination, where it would be untrue.
  if (gate.contains === undefined && op.op === "bottomFromOpponentHand" && op.dest === undefined) {
    return "If you put a card on the bottom of your opponent's deck in this way";
  }
  // Jynx prints its gate in long form too. The `dest === "bench"` check keeps the phrase off
  // searches that put nothing onto the Bench.
  if (gate.contains === undefined && op.op === "searchDeck" && op.dest === "bench") {
    return "If you put any Pokémon onto your Bench in this way";
  }
  if (gate.contains === undefined) return "If you do";
  if (gate.contains === "yourActive" && op.op === "attachFromDeck") {
    return "If you attach one to your Active Pokémon";
  }
  return null;
}

/** A gate branch as a printed phrase, or null when any op in it has none.
    Deliberately TINY — it covers exactly the automatic ops the two §9.2 gates
    branch into today (Miriam draws 3, Dendra draws to 5) and refuses everything
    else, because a describer that guesses is how a dialog starts lying. Grow it
    one case per card, the `retrieveNoun` rule. */
function describeBranch(ops: readonly EffectOp[]): string | null {
  const parts: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "drawCards":
        // Say the draw's source when the op names one, and the `per` noun, so a gated draw is not
        // captioned as a plain one.
        if (op.per !== undefined) {
          // Awakening Drum's noun ("your Ancient Pokémon in play"). Emma's member is never inside a
          // gate branch, so it has no caption.
          if (op.per.kind === "cardsInOpponentHand") return null;
          // Gwynn's `recorded` member is never inside a gate branch either.
          if (op.per.kind === "recorded") return null;
          parts.push(
            op.per.kind === "opponentBenchCount"
              ? "draw a card for each of your opponent's Benched Pokémon"
              : `draw a card for each of ${op.per.seat === "you" ? "your" : "your opponent's"} ${
                  retrieveNoun(op.per.filter).plural
                } in play`,
          );
          break;
        }
        parts.push(
          `${op.count === 1 ? "draw a card" : `draw ${op.count} cards`}${
            op.from === "bottom" ? " from the bottom of your deck" : ""
          }`,
        );
        break;
      case "drawUntilHandSize":
        // Mystery Garden's `per` member is never inside a gate branch either.
        if (op.per !== undefined) return null;
        parts.push(`draw cards until you have ${op.size} cards in your hand`);
        break;
      // Perrin's consequent in the card's words. Only the `maxRecorded` hand search has a caption;
      // any other search inside a gate yields none.
      case "searchDeck":
        if (op.maxRecorded === undefined || op.dest !== "hand") return null;
        parts.push(
          "search your deck for up to that many Pokémon, reveal them, and put them into your hand",
        );
        break;
      // Team Rocket's Energy has two printing ids, so a body holding one of each offers two classes
      // and the discard parks; without this case the note would omit that the opponent's Active
      // leaves play. The condition is the plain "If you do".
      case "discardDefender":
        parts.push("discard your opponent's Active Pokémon and all attached cards");
        break;
      case "switchActive":
        // Prime Catcher's consequent, in Switch's printed words. Only an unnarrowed switch is
        // described: a switch with a subgroup, `fromSource`, `targetType` or `exceptNamed` would
        // need different words, so it yields none.
        if (
          op.ownerPokemon !== undefined ||
          op.targetType !== undefined ||
          op.exceptNamed !== undefined ||
          op.fromSource === true
        ) {
          return null;
        }
        parts.push("switch your Active Pokémon with 1 of your Benched Pokémon");
        break;
      case "gust":
        // Team Rocket's Giovanni / Boss's Orders. The pick of which Benched Pokémon is a later
        // prompt, so this clause only promises the switch.
        parts.push("switch in 1 of your opponent's Benched Pokémon to the Active Spot");
        break;
      case "opponentSwitchOut":
        // Iron Bundle "Interjet". The printed parenthetical is dropped: it is about who answers the
        // next prompt, not this one.
        parts.push("switch out your opponent's Active Pokémon to the Bench");
        break;
      case "opponentMayDraw":
        // Ortega's consequence, addressed to the CONTROLLER reading the pick
        // prompt (the mayDraw prompt itself speaks to the opponent — see
        // mayDrawNote; this clause describes what the answer buys THEM).
        parts.push(
          op.count === 1
            ? "your opponent may draw a card"
            : `your opponent may draw ${op.count} cards`,
        );
        break;
      case "opponentDiscardsFromHand":
        // Without this phrase the gated payment's caption would read the same as an ungated
        // discard, hiding what the payment buys.
        if (op.untilHandSize !== undefined) {
          parts.push(
            `your opponent discards cards from their hand until they have ${op.untilHandSize} cards in their hand`,
          );
          break;
        }
        if (op.to === "deck") {
          parts.push(
            op.count === 1
              ? "your opponent shuffles a card from their hand into their deck"
              : `your opponent shuffles ${op.count} cards from their hand into their deck`,
          );
          break;
        }
        parts.push(
          op.count === 1
            ? "your opponent discards a card from their hand"
            : `your opponent discards ${op.count} cards from their hand`,
        );
        break;
      case "applyStatus":
        // Only the controller-relative arm: "self" is the controller's own Active (or an attack's
        // attacker), which is what "it is now Poisoned" refers to.
        if (op.target !== "self") return null;
        parts.push(`it is now ${STATUS_WORD_OF[op.status]}`);
        break;
      case "attachEnergyFrom":
        // Kilowattrel ex "Return Charge". Only the `toSelf` shape is described: any other
        // destination is a second question this note's prompt is not asking.
        if (op.toSelf !== true) return null;
        parts.push(
          `attach ${op.count === undefined ? "the Energy" : `up to ${op.count} Energy`} to this Pokémon`,
        );
        break;
      case "moveEnergy":
        // Jynx "Inviting Kiss". Only the record-pinned destination is described; any other
        // `moveEnergy` destination is a second question.
        if (op.sourceRecorded !== undefined && op.route === "benchToActive") {
          parts.push(
            "you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon",
          );
          break;
        }
        if (op.destRecorded === undefined || op.route !== "selfToBench") return null;
        parts.push("move an Energy from this Pokémon to the new Benched Pokémon");
        break;
      default:
        return null;
    }
  }
  return parts.length === 0 ? null : parts.join(", then ");
}

/** The continuation's `record` field, or NOTHING when nothing has been recorded
    — so a program that never touches §9.2 parks into the exact phase shape it
    parked into before this existed. Copied, so the stored record cannot be
    reached by a later write to the running accumulator. */
function carriedRecord(record: EffectRecord): { record?: EffectRecord } {
  return Object.keys(record).length === 0 ? {} : { record: { ...record } };
}

/**
 * The chosen-destination counter move's first answer: returns the same op with the source now
 * known, so its second question can be asked. Shared by the forced and parked endings so both
 * resolve identically. It tests the zone, not the seat.
 */
function counterSourceAnswered(op: OpOf<"moveCountersChosen">, ref: PokemonRef): EffectOp[] {
  if (ref.spot.spot !== "bench") return [];
  return [{ ...op, fromBench: ref.spot.index }];
}

/**
 * The body-choice evolve's first answer, shared by the forced and parked endings. It returns an
 * `evolveFromDeck` onto the picked body rather than rewriting this op.
 */
function evolveBodyAnswered(
  ref: PokemonRef,
  noAbilities?: true,
  thenEvolveAgain?: true,
): EffectOp[] {
  // Salvatore's no-Abilities rider and Grand Tree's chained Stage 2 ride along as conditional
  // spreads; no printing carries both.
  return [
    {
      ...(noAbilities === true
        ? { op: "evolveFromDeck", onto: ref.spot, noAbilities: true }
        : { op: "evolveFromDeck", onto: ref.spot }),
      ...(thenEvolveAgain === true ? { thenEvolveAgain: true } : {}),
    },
  ];
}

/**
 * Grand Tree's optional Stage 2 question onto the same body, bought only when the Stage 1 answer
 * names a card from the original offer (the placement happened). A decline buys nothing, and the
 * bought op does not chain again.
 */
function chainedEvolveAnswered(
  before: GameState,
  cont: EffectContinuation,
  op: OpOf<"evolveFromDeck">,
  choice: EffectChoice,
): EffectOp[] {
  if (choice.kind !== "cards" || op.onto === undefined) return [];
  const [picked] = choice.uids;
  const offer = evolveFromDeckOffer(before, cont.ctx, {
    onto: op.onto,
    names: op.names,
    noAbilities: op.noAbilities,
  });
  if (picked === undefined || offer === undefined || !offer.candidates.includes(picked)) return [];
  return [{ op: "evolveFromDeck", onto: op.onto }];
}

/**
 * Super Potion's healed body: returns one Energy discard from that body, or nothing when it had no
 * damage before the heal. `state` is the board before the heal.
 */
function healedDiscardAnswered(state: GameState, ref: PokemonRef): EffectOp[] {
  const body = refPokemon(state, ref);
  if (body === undefined || body.damage <= 0) return [];
  const uid = topUid(body);
  if (uid === undefined) return [];
  return [
    { op: "discardEnergy", from: "self", filter: { kind: "anyEnergy" }, count: 1, bodyUid: uid },
  ];
}

/** Whether a `healChosen` pick buys any healed-body rider; the park and the resume must agree. */
function hasHealedRider(op: OpOf<"healChosen">): boolean {
  return (
    op.discardEnergyFromHealed === true ||
    op.recoverHealed === true ||
    op.energyToHandFromHealed === true
  );
}

/**
 * Every healed-body rider of one `healChosen` pick, in printed order: Super Potion's discard,
 * Pokémon Center Lady's status recovery (only when the pick is the Active) and Wally's Compassion's
 * Energy to hand. `state` is the board before the heal.
 */
function healedRiderOps(state: GameState, ref: PokemonRef, op: OpOf<"healChosen">): EffectOp[] {
  const discard = op.discardEnergyFromHealed === true ? healedDiscardAnswered(state, ref) : [];
  const recover: EffectOp[] =
    op.recoverHealed === true && ref.spot.spot === "active" ? [{ op: "clearStatus" }] : [];
  // Wally's Compassion: all attached Energy to the hand, only when the pick healed.
  const toHand = op.energyToHandFromHealed === true ? healedEnergyToHandAnswered(state, ref) : [];
  return [...discard, ...recover, ...toHand];
}

/**
 * Wally's Compassion: "put all Energy attached to that Pokémon into your hand", only when that body
 * had damage before the heal. `state` is the board before the heal.
 */
function healedEnergyToHandAnswered(state: GameState, ref: PokemonRef): EffectOp[] {
  const body = refPokemon(state, ref);
  if (body === undefined || body.damage < 1) return [];
  const uid = topUid(body);
  if (uid === undefined) return [];
  return [
    {
      op: "discardEnergy",
      from: "self",
      filter: { kind: "anyEnergy" },
      count: "all",
      to: "hand",
      bodyUid: uid,
    },
  ];
}

/**
 * Rocket Brain's first answer: the same op with the source now known, shared by the forced and
 * parked endings.
 */
function counterOwnSourceAnswered(op: OpOf<"moveCounterOwnChosen">, ref: PokemonRef): EffectOp[] {
  return [{ ...op, from: ref.spot }];
}

/**
 * Ruffian: the two printed discards (Tool first, then Special Energy), each narrowed to the picked
 * body. A half with nothing to take whiffs silently.
 */
function ruffianBodyAnswered(state: GameState, ref: PokemonRef): EffectOp[] {
  const body = refPokemon(state, ref);
  const uid = body === undefined ? undefined : topUid(body);
  if (uid === undefined) return [];
  return [
    { op: "discardTools", count: 1, bodyUid: uid },
    {
      op: "discardEnergy",
      from: "opponentChosen",
      filter: { kind: "specialEnergy" },
      count: 1,
      bodyUid: uid,
    },
  ];
}

/**
 * Crispin's split: one branch per distinct Basic Energy type filed (at most 2). With one type the
 * branches are "attach it" or "keep it in your hand"; with two, attach either.
 */
function oneOfRecordedChoice(
  state: GameState,
  op: OpOf<"attachEnergyFrom">,
  record: EffectRecord,
  seat: Seat,
): EffectOp[] {
  const slot = op.oneOfRecorded;
  if (slot === undefined) return [];
  const choices: { uid: string; type: string }[] = [];
  for (const uid of recorded(record, slot)) {
    const found = cardOfUid(state, uid);
    if (found !== undefined && matchesFilter(found, { kind: "basicEnergy" })) {
      const type = energyProvidesOf(found);
      if (!choices.some((choice) => choice.type === type)) choices.push({ uid, type });
    }
  }
  const [first, second] = choices.slice(0, 2);
  if (first === undefined) return [];
  const targets = attachEnergyTargets(state, seat, op);
  if (targets.length === 0) return [];
  const { oneOfRecorded: _dropped, ...plain } = op;
  const attach = (energyType: string): EffectOp[] => [{ ...plain, energyType }];
  const note = "Which Energy do you want to attach?";
  return [
    {
      op: "optional",
      note,
      labels: {
        yes: `Attach ${first.type} Energy`,
        no: second === undefined ? "Keep it in your hand" : `Attach ${second.type} Energy`,
      },
      cards: { yes: first.uid, ...(second === undefined ? {} : { no: second.uid }) },
      targets,
      then: attach(first.type),
      ...(second === undefined ? {} : { otherwise: attach(second.type) }),
    },
  ];
}

/**
 * Own in-play bodies an evolve-from-deck choice may target: top card matches `pokemonType` (if
 * given) and the deck holds a card that evolves from it. Shared by both evolve-choice ops so they
 * cannot disagree.
 */
function evolvableOwnRefs(
  state: GameState,
  ctx: EffectContext,
  pokemonType?: PokemonType,
  /**
   * Salvatore's "a card that has no Abilities": only offer bodies whose deck evolutions include one
   * without an Ability.
   */
  noAbilities?: true,
  /**
   * Grand Tree's body narrowings: `bodyStage` requires a Basic top card, `timingGates` excludes the
   * controller's first turn and bodies played this turn.
   */
  grandTree?: { bodyStage?: "Basic"; timingGates?: true },
): PokemonRef[] {
  // The first-turn gate applies to the seat, so it empties the whole offer. `evolveEarlyLicensed`
  // is deliberately not consulted: the ban is printed on the Stadium.
  if (grandTree?.timingGates === true && isFirstTurnOf(state, ctx.seat)) return [];
  return ownInPlayRefs(state, ctx.seat).filter((ref) => {
    if (grandTree !== undefined) {
      const body = refPokemon(state, ref);
      const card = refTopCard(state, ref);
      if (body === undefined || card === undefined) return false;
      if (grandTree.bodyStage === "Basic" && !isBasicPokemon(card)) return false;
      if (grandTree.timingGates === true && body.turnPlayed >= state.turn) return false;
    }
    if (pokemonType !== undefined) {
      const card = refTopCard(state, ref);
      if (card === undefined) return false;
      if (!matchesFilter(card, { kind: "typedPokemon", pokemonType })) return false;
    }
    return (
      (evolveFromDeckOffer(state, ctx, { onto: ref.spot, noAbilities })?.candidates.length ?? 0) > 0
    );
  });
}

/**
 * Ops a resolved park schedules ahead of the program's remaining ops. `applyChoice` returns only
 * state, so an answer that buys ops is spliced here in `resumeProgram`.
 */
function continuationOps(
  cont: EffectContinuation,
  choice: EffectChoice,
  /**
   * The board before the answer was applied (Super Potion reads the picked body's damage before the
   * heal).
   */
  before: GameState,
): EffectOp[] {
  const op = cont.pendingOp;
  // Backtrack Badge: yes re-runs the coin op (flipping again); no re-runs it with the faces already
  // flipped.
  if (op.op === "reflipCoins") {
    return [choice.kind === "confirm" && choice.yes ? op.retry : withKeptFaces(op.retry, op.faces)];
  }
  // An attach target whose cards are not interchangeable buys the card question: the op again with
  // target and take pinned. Asked of `before`, the board `applyChoice` saw.
  if (op.op === "attachEnergyFrom" && op.pickOnto === undefined && pickedPokemon(choice)) {
    const take = attachTake(op, choice.take);
    return energyPickOffer(before, op, cont.ctx.seat, take) === undefined
      ? []
      : [
          {
            ...op,
            pickOnto: { ref: { seat: choice.ref.seat, spot: { ...choice.ref.spot } }, take },
          },
        ];
  }
  // Target Together's resumed pick: the op again with the targets, so `stepOp` flips its coins.
  if (op.op === "damageChosen" && op.perHeadsInPlay !== undefined && op.hitRefs === undefined) {
    return choice.kind === "pokemonMulti" ? [{ ...op, hitRefs: [...choice.refs] }] : [];
  }
  // A parked heal pick buys its healed-body riders.
  if (op.op === "healChosen" && hasHealedRider(op)) {
    return pickedPokemon(choice) ? healedRiderOps(before, choice.ref, op) : [];
  }
  // Strange Timepiece's own-side pick buys the devolve (or the depth question).
  if (op.op === "devolveChosen" && op.whose === "self" && op.bodyUid === undefined) {
    return pickedPokemon(choice) ? ownDevolveAnswered(before, choice.ref, op) : [];
  }
  // A decline runs `otherwise` (empty when absent), e.g. "You may do 120 more damage" prints its
  // base damage on the decline.
  if (op.op === "optional") {
    if (choice.kind === "confirm" && choice.target !== undefined && op.cards !== undefined)
      return [];
    return choice.kind === "confirm" && choice.yes ? [...op.then] : [...(op.otherwise ?? [])];
  }
  // Deduction Kit: an empty ordering is the printed alternative (shuffle them onto the bottom).
  // `validateChoice` only admits it when the prompt carries `alt`.
  if (op.op === "reorderTop") {
    return choice.kind === "orderCards" && choice.uids.length === 0
      ? [...(op.otherwise ?? [])]
      : [];
  }
  if (op.op === "moveCountersChosen" && op.fromBench === undefined) {
    return pickedPokemon(choice) ? counterSourceAnswered(op, choice.ref) : [];
  }
  // Rocket Brain's source answer buys the destination question.
  if (op.op === "moveCounterOwnChosen" && op.from === undefined) {
    return pickedPokemon(choice) ? counterOwnSourceAnswered(op, choice.ref) : [];
  }
  // Adrena-Brain's source answer buys the destination question.
  if (op.op === "moveCountersToOpponentChosen" && op.from === undefined) {
    return pickedPokemon(choice) ? [{ ...op, from: choice.ref.spot }] : [];
  }
  // Sableye / Alakazam loop: the source answer buys the destination-and-count question; that answer
  // buys the next round with the budget spent. A ref-less answer declines and ends the loop.
  if (op.op === "moveCountersOpponentAnyWay") {
    if (!pickedPokemon(choice)) return [];
    return op.source === undefined
      ? [anyWaySourceAnswered(before, op, choice.ref, choice.take)]
      : [nextAnyWayRound(op)];
  }
  // Blipbug's blind slot answer buys the look. Look-Alike Show's pick buys the picked Supporter's
  // program, run in this attack's context; an empty answer declines.
  if (op.op === "useOpponentSupporterEffect") {
    const [picked] = choice.kind === "cards" ? choice.uids : [];
    const id = picked === undefined ? undefined : before.cardIdByUid[picked];
    return id === undefined ? [] : [...(supporterEffectOf(id)?.ops ?? [])];
  }
  // Tyme's naming answer buys the guess question.
  if (op.op === "opponentGuessesHp" && op.uid === undefined) {
    const [named] = choice.kind === "cards" ? choice.uids : [];
    return named === undefined ? [] : [{ ...op, uid: named }];
  }
  if (op.op === "lookAtPrize" && op.index === undefined) {
    return choice.kind === "prize" ? [{ ...op, index: choice.index }] : [];
  }
  if (op.op === "discardToolAndSpecialEnergyChosen") {
    return pickedPokemon(choice) ? ruffianBodyAnswered(before, choice.ref) : [];
  }
  // Ogre's Mask's body answer buys the discard pick.
  if (op.op === "switchWithDiscardNamed" && op.bodyUid === undefined) {
    return pickedPokemon(choice) ? swapBodyAnswered(before, op, choice.ref) : [];
  }
  // `evolveFromDeckChosen` exists only to ask, so reaching here means it was answered; it buys an
  // `evolveFromDeck` onto the picked body.
  if (op.op === "evolveFromDeckChosen") {
    return pickedPokemon(choice)
      ? evolveBodyAnswered(choice.ref, op.noAbilities, op.thenEvolveAgain)
      : [];
  }
  // Grand Tree's Stage 1 answer buys the optional Stage 2 question, only when the Stage 1 placement
  // happened.
  if (op.op === "evolveFromDeck" && op.thenEvolveAgain === true) {
    return chainedEvolveAnswered(before, cont, op, choice);
  }
  // "Choose up to 2 … For each of those Pokémon": one `evolveFromDeck` per picked body, in pick
  // order. An empty pick buys nothing.
  if (op.op === "evolveFromDeckEachChosen") {
    return choice.kind === "pokemonMulti"
      ? choice.refs.flatMap((ref) => evolveBodyAnswered(ref))
      : [];
  }
  return [];
}

/** Resume a parked effect: apply the awaited op with the (already validated)
    choice, then run the rest of the program. */
export function resumeProgram(
  state: GameState,
  cont: EffectContinuation,
  choice: EffectChoice,
  events: GameEvent[],
): RunResult {
  // Seed the accumulator from the stored record (a COPY — the stored one is
  // inside GameState), let the resolving op file its own result into it, then
  // run the rest against it. This is the whole of what makes §9.2 survive a
  // park: Superior Energy Retrieval's cost and Miriam's retrieval both PARK, so
  // every recording this engine can do happens on exactly this path.
  const record: EffectRecord = { ...cont.record };
  // The answer may attach or move Team Rocket's Energy, so the state check runs before the rest of
  // the program.
  const applied = discardMisplacedEnergy(
    applyChoice(state, cont.pendingOp, choice, cont.ctx, record, events),
    events,
  );
  // The answer's continuation ops are spliced ahead of the rest here, the only place holding both
  // the applied state and the remaining ops.
  const rest = [...continuationOps(cont, choice, state), ...cont.rest];
  return runProgram(applied, rest, cont.ctx, record, events);
}

/** `retry` carrying the kept Backtrack Badge `faces`; only the two coin ops read them. */
function withKeptFaces(retry: EffectOp, faces: readonly CoinFace[]): EffectOp {
  return retry.op === "coinFlipGate" || retry.op === "damageChosen"
    ? { ...retry, faces: [...faces] }
    : retry;
}

/**
 * One synchronous step, or a park request. Parking ops compute their candidates: none is a no-op, a
 * single forced candidate auto-resolves (except searchDeck, which is "up to" and always parks). A
 * step may also `schedule` further ops (not `then`, which biome bans on an object literal).
 */
export function startlingDropRetort(
  state: GameState,
  victim: Seat,
  milled: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (victim === ctx.seat || ctx.invokedBy === undefined) return state;
  // "During your opponent's turn": the controller's turn.
  if (turnOwnerOf(state) !== ctx.seat) return state;
  let next = state;
  for (const uid of milled) {
    const retort = opponentMillRetortOf(state, uid);
    if (retort === undefined) continue;
    events.push({ type: "ABILITY_TRIGGERED", seat: victim, uid, ability: retort.ability });
    const side = next.players[ctx.seat];
    const top = side.deck.slice(0, retort.count);
    if (top.length === 0) continue;
    events.push({ type: "DECK_TOP_DISCARDED", seat: ctx.seat, actor: victim, uids: top });
    next = withSide(next, ctx.seat, {
      ...side,
      deck: side.deck.slice(top.length),
      discard: [...side.discard, ...top],
    });
  }
  return next;
}

/**
 * Ops that move damage counters between Pokémon, which Patrat "Watchful Eye" blocks. An in-place
 * swap that keeps counters on the body moves none.
 */
export function isCounterMoveOp(op: EffectOp): boolean {
  return (
    op.op === "moveCountersToDefender" ||
    op.op === "moveCountersChosen" ||
    op.op === "moveCounterOwnChosen" ||
    op.op === "moveCountersToOpponentChosen" ||
    op.op === "moveCountersOpponentAnyWay"
  );
}

/** The three gates are spliced by runProgram's queue loop, so they never reach `stepOp`. */
type SteppedOp = Exclude<EffectOp, OpOf<"coinFlipGate" | "conditionGate" | "recordGate">>;

function stepOp(
  state: GameState,
  op: SteppedOp,
  ctx: EffectContext,
  record: EffectRecord,
  events: GameEvent[],
): { done: GameState; schedule?: EffectOp[] } | { park: EffectPrompt; decider?: Seat } {
  // Patrat "Watchful Eye": while a holder is in play, a counter move whiffs.
  if (isCounterMoveOp(op) && countersMoveLocked(state)) return { done: state };
  switch (op.op) {
    case "applyStatus":
      return { done: applyStatus(state, op, ctx, events) };
    case "clearStatus":
      return { done: clearStatus(state, ctx, op.only, events) };
    // "Choose 1": only branches with a target are offered as a labelled binary chain, built from
    // the board at this step; one branch runs directly, none is a no-op.
    case "chooseOneOffered":
      return {
        done: state,
        schedule: chooseOneChain(op.note, offeredBranches(state, ctx.seat, op)),
      };
    case "recoverOneStatus": {
      const active = state.players[ctx.seat].active;
      const present = active === null ? [] : presentStatuses(active.conditions);
      const [first, second, third] = present;
      if (first === undefined) return { done: state };
      if (second === undefined) return { done: clearStatus(state, ctx, first, events) };
      const word = (status: StatusName) => STATUS_WORD_OF[status];
      const clear = (status: StatusName): EffectOp[] => [{ op: "clearStatus", only: status }];
      const note = "Your Active Pokémon recovers from a Special Condition. Which one?";
      const tail: EffectOp[] =
        third === undefined
          ? clear(second)
          : [
              {
                op: "optional",
                note,
                labels: { yes: word(second), no: word(third) },
                then: clear(second),
                otherwise: clear(third),
              },
            ];
      return {
        done: state,
        schedule: [
          {
            op: "optional",
            note,
            labels: {
              yes: word(first),
              no: third === undefined ? word(second) : `${word(second)} or ${word(third)}`,
            },
            then: clear(first),
            otherwise: tail,
          },
        ],
      };
    }
    case "preventRetreat":
      return { done: preventRetreat(state, op, ctx, events) };
    case "preventHandPlay":
      return { done: preventHandPlay(state, op.bars, ctx, events) };
    case "preventDamage":
      return {
        done: preventDamage(state, op.effects === true, op.fromClass, op.maxDamage, ctx, events),
      };
    case "preventAttack":
      return { done: preventAttack(state, op, ctx, events) };
    case "flipLockAttack":
      return { done: flipLockAttack(state, ctx, op.coins, events) };
    case "flipLockTrainerPlay":
      return { done: flipLockTrainerPlay(state, ctx, events) };
    case "lockSideAttacks":
      return { done: lockSideAttacks(state, op, ctx, events) };
    case "preventAttackUse":
      return { done: preventAttackUse(state, op.attack, op.until, ctx, events) };
    case "boostAttack":
      return {
        done: boostAttack(
          state,
          op.attack,
          op.amount,
          op.base,
          ctx,
          op.holder,
          op.thisTurn,
          events,
        ),
      };
    case "boostSideAttacksThisTurn":
      return { done: boostSideAttacksThisTurn(state, op, ctx, events) };
    case "installSideDamageReductionNextTurn":
      return { done: installSideDamageReductionNextTurn(state, op, ctx, events) };
    // Acerola's Mischief: the shield is keyed on the side by the picked body's base uid.
    case "installChosenAttackShield":
      return parkOrForce(
        state,
        ownInPlayRefs(state, ctx.seat),
        (ref) => installChosenAttackShield(state, ref, op, ctx, events),
        chosenAttackShieldNote(op),
      );
    case "lockSideRetreat":
      return { done: lockSideRetreat(state, op, ctx, events) };
    case "installSideAttackBlock":
      return { done: installSideAttackBlock(state, op, ctx, events) };
    case "markHandAttach":
      return { done: markHandAttach(state, op, ctx, events) };
    case "lookAtPrize":
      return lookAtPrize(state, op, ctx, events);
    case "winGame":
      return { done: winGame(state, ctx, events) };
    case "preventChosenAttack":
      return preventChosenAttack(state, ctx, events);
    case "reduceDamage":
      return { done: reduceDamage(state, op.amount, op.fromClass, ctx, events) };
    case "installNoWeakness":
      return { done: installNoWeakness(state, ctx, events) };
    case "weakenDefenderAttacks":
      return { done: weakenDefenderAttacks(state, op.amount, ctx, events) };
    case "exposeDefender":
      return { done: exposeDefender(state, op.amount, ctx, events) };
    case "exposeSelf":
      return { done: exposeSelf(state, op.amount, ctx, events) };
    case "retypeDefenderWeakness":
      return { done: retypeDefenderWeakness(state, op.type, ctx, op.asTimesTwo === true, events) };
    case "taxDefender":
      return { done: taxDefender(state, ctx, events) };
    case "bountyDefender":
      return { done: bountyDefender(state, op.amount, ctx, events) };
    case "bountyThisAttack":
      return { done: bountyThisAttack(state, op.amount, ctx) };
    case "knockOutEach":
      return { done: knockOutEach(state, op.remainingHpAtMost, ctx, events) };
    // Schedules a delayed placement; flow.ts `runCheckup` applies it.
    case "scheduleCounters":
      return { done: scheduleCounters(state, op.amount, ctx, events) };
    case "scheduleDiscard":
      return { done: scheduleDiscard(state, ctx, events) };
    case "scheduleKnockOut":
      return { done: scheduleKnockOut(state, ctx, events) };
    case "installRecoil":
      // `"damageTaken"` is passed through unresolved: it means damage the holder takes on the
      // opponent's next turn, unknown here.
      return { done: installRecoil(state, op.amount, ctx, events) };
    case "heal": {
      // `"dealt"` is the damage this attack did to the opponent's Active. Runners that dealt no
      // damage (Trainers, Abilities, triggers) have no `dealt`, so 0 makes the heal whiff.
      const healed = healSelf(
        state,
        op.amount === "dealt" ? (ctx.dealt ?? 0) : op.amount,
        ctx,
        events,
      );
      return {
        done:
          op.discardEnergyFromHealed === true
            ? discardEnergyFromHealed(state, healed, ctx, events)
            : healed,
      };
    }
    case "healEach": {
      // Dachsbun ex's per-healed-body discard runs after the heal walk.
      const healed = healEach(state, op, ctx, events);
      return {
        done:
          op.discardEnergyFromHealed === true
            ? discardEnergyFromHealed(state, healed, ctx, events)
            : healed,
      };
    }
    case "healEachAll":
      return { done: healEachAll(state, op.amount, events) };
    case "counterEachAll":
      return { done: counterEachAll(state, op, ctx, events) };
    case "counterUntilRemainingHp":
      return { done: counterUntilRemainingHp(state, op, ctx, events) };
    case "damageActive":
      // `per`: the amount once per card in the controller's hand, read at resolve.
      return {
        done: damageActive(
          state,
          op.per === undefined
            ? op.amount
            : op.amount * countCardsInHand(state, ctx.seat, { kind: "anyCard" }),
          op.source,
          ctx,
          events,
        ),
      };
    case "damageSubject":
      return { done: damageSubject(state, op.amount, ctx, events) };
    case "countersOnRecordedBody":
      return { done: countersOnRecordedBody(state, op, ctx, record, events) };
    case "healSubject":
      return { done: healSubject(state, op.amount, ctx, events) };
    case "moveCountersToDefender":
      // "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active
      // Pokémon." Every benched body is a candidate, damaged or not; an undamaged pick whiffs.
      // `ownerPokemon` narrows the set.
      return parkOrForce(
        state,
        filteredRefs(
          state,
          subgroupRefs(state, ownBenchRefs(state, ctx.seat), op.ownerPokemon),
          op.filter,
        ),
        (ref) => moveCountersToDefender(state, ref, ctx, events),
        `Move the damage counters off which of your Benched ${
          op.filter === undefined
            ? `${ownerNoun(op.ownerPokemon)}Pokémon`
            : retrieveNoun(op.filter).plural
        }?`,
      );
    case "moveCountersChosen": {
      // Cofagrigus: one op, two questions; `fromBench` says which is being asked.
      const chosen = op.fromBench;
      if (chosen === undefined) {
        // Source question; not narrowed by `subgroupRefs`, since no chosen-destination printing
        // carries a possessive.
        const sources = ownBenchRefs(state, ctx.seat);
        if (sources.length === 0) return { done: state };
        const forced = sources.length === 1 ? sources[0] : undefined;
        // Not `parkOrForce`: its forced arm applies directly and cannot ask a second question. A
        // single candidate is answered through the same helper as the parked ending.
        if (forced !== undefined)
          return { done: state, schedule: counterSourceAnswered(op, forced) };
        return {
          park: {
            kind: "choosePokemon",
            candidates: sources,
            // THE PROMPT SAYS WHAT THE ANSWER BUYS (the §9.2 note doctrine, owed
            // here for a reason of this slice's own making): the answer buys a
            // SECOND prompt, and a player told only "which Bench body?" would
            // read this as the whole decision and pick for a destination the
            // engine has not offered yet.
            note: "Move the damage counters off which of your Benched Pokémon? You will then choose where they go.",
          },
        };
      }
      // QUESTION 2 — the DESTINATION. A source carrying no counters is the
      // printed sentence's SILENT WHIFF (the single-arm rule `healChosen` and
      // `moveCountersToDefender` both follow), and it is answered HERE rather
      // than in the mover so the whiff costs no prompt: asking "where do these
      // counters go?" about zero counters is a question with no answer.
      const source = state.players[ctx.seat].bench[chosen];
      if (source === undefined || source.damage <= 0) return { done: state };
      // "1 of your opponent's Pokémon" — the Active TOO, not just the Bench, so
      // this set is never empty during a §8 attack and the empty-set ending is
      // the wire belt rather than a board. A lone Active FORCES the destination,
      // which is `parkOrForce`'s own doctrine and needs nothing new: this half
      // applies its answer instead of passing it on.
      return parkOrForce(
        state,
        oppAnyRefs(state, ctx.seat),
        (ref) => moveCountersFromBench(state, chosen, ref, ctx, events),
        "Move the damage counters onto which of your opponent's Pokémon?",
      );
    }
    case "moveCounterOwnChosen": {
      // Team Rocket's Orbeetle "Rocket Brain": one counter between two own bodies; `op.from` tells
      // the two questions apart.
      const from = op.from;
      if (from === undefined) {
        // QUESTION 1 — the SOURCE: a damaged own body in the printed subgroup.
        const sources = counterOwnSources(state, ctx.seat, op.ownerPokemon);
        if (sources.length === 0) return { done: state };
        // `parkOrForce`'s ordering (nothing / one / many), with the one ANSWERED and handed
        // on through the helper the parked ending uses (`moveCountersChosen`'s `then`).
        const onlySource = sources.length === 1 ? sources[0] : undefined;
        if (onlySource !== undefined)
          return { done: state, schedule: counterOwnSourceAnswered(op, onlySource) };
        return {
          park: {
            kind: "choosePokemon",
            candidates: sources,
            note: `Move 1 damage counter off which of your ${ownerNoun(op.ownerPokemon)}Pokémon? You will then choose where it goes.`,
          },
        };
      }
      // QUESTION 2 — the DESTINATION: ANOTHER own body. A source that no longer carries
      // damage is the silent whiff (no question about nothing).
      const movable = refPokemon(state, { seat: ctx.seat, spot: from })?.damage ?? 0;
      if (movable <= 0) return { done: state };
      return parkOrForce(
        state,
        counterOwnDestinations(state, ctx.seat, from),
        (ref) => moveOneOwnCounter(state, from, ref, ctx, events),
        "Move the damage counter onto which of your Pokémon?",
      );
    }
    // Never queued: only ever a pending op answered through `resolveCopiedAttack`. Exists for
    // switch exhaustiveness.
    case "useAttackAs":
      return { done: state };
    // Never queued: only ever a pending op answered through `resolveFoundAttack`.
    case "useFoundAttackAs":
      return { done: state };
    // Backtrack Badge's offer always parks ("you may"); `continuationOps` splices the retry.
    case "reflipCoins":
      return { park: coinRedoPrompt(state, op.toolUid, op.faces) };
    // Never queued: only ever a pending op answered through `resolveCoinRedo`.
    case "reflipAttackCoins":
      return { done: state };
    // Never queued: only ever a pending op answered through `resolveInPlayCopiedAttack`.
    case "useInPlayAttackAs":
      return { done: state };
    case "moveCountersOpponentAnyWay": {
      // Sableye / Alakazam: one round of the opponent-to-opponent move. The first step writes the
      // budget and announces each shielded body once; a zero budget ends the op silently.
      if (op.budget === undefined) {
        const budget = anyWayBudget(state, ctx.seat, op.from);
        if (budget <= 0) return { done: state };
        unshieldedRefs(state, oppAnyRefs(state, ctx.seat), ctx, events);
        return { done: state, schedule: [{ ...op, budget }] };
      }
      if (op.budget <= 0) return { done: state };
      const source = op.source;
      if (source === undefined) {
        // Q1 — the SOURCE and the COUNT, ALWAYS PARKED (*"You may"*: the decline is the ref-less
        // answer). `upTo` is the LIVE budget, not a printed ceiling — nothing is printed.
        const sources = anyWaySources(state, ctx, op.from);
        if (sources.length === 0) return { done: state };
        return {
          park: {
            kind: "choosePokemon",
            candidates: sources,
            upTo: op.budget,
            takeVerb: "move",
            note:
              op.from === "bench"
                ? `Move up to ${op.budget} damage counters off which of your opponent's Benched Pokémon onto their Active Pokémon? Decline to stop.`
                : `Move up to ${op.budget} damage counters off which of your opponent's Pokémon? You will then choose which of their other Pokémon they go to. Decline to stop.`,
          },
        };
      }
      // Destination: the opponent's Active for "bench", any other opponent body for "any"; forced
      // at one candidate, parked otherwise.
      const take = op.take ?? 0;
      if (take <= 0) return { done: state };
      const from: PokemonRef = { seat: otherSeat(ctx.seat), spot: source };
      const dests = anyWayDestinations(state, ctx, op.from, from);
      const lone = dests.length === 1 ? dests[0] : undefined;
      if (dests.length === 0) return { done: state };
      if (lone !== undefined) {
        return {
          done: moveCountersBetweenOpponents(state, from, lone, take, ctx, events),
          schedule: [nextAnyWayRound(op)],
        };
      }
      return {
        park: {
          kind: "choosePokemon",
          candidates: dests,
          note: `Move ${take} damage counter${take === 1 ? "" : "s"} onto which of your opponent's other Pokémon?`,
        },
      };
    }
    case "moveCountersToOpponentChosen": {
      // Munkidori "Adrena-Brain": up to `upTo` counters from own body to opponent's; `op.from`
      // tells the two questions apart.
      const source = op.from;
      if (source === undefined) {
        // QUESTION 1 — the SOURCE: any own damaged body (Munkidori included). One is FORCED and
        // handed on through the SAME splice the parked answer takes (`continuationOps`).
        const damagedOwn = counterToOpponentSources(state, ctx.seat);
        if (damagedOwn.length === 0) return { done: state };
        const lone = damagedOwn.length === 1 ? damagedOwn[0] : undefined;
        if (lone !== undefined) return { done: state, schedule: [{ ...op, from: lone.spot }] };
        return {
          park: {
            kind: "choosePokemon",
            candidates: damagedOwn,
            note: `Move up to ${op.upTo} damage counters off which of your Pokémon? You will then choose where they go.`,
          },
        };
      }
      // Destination and count in one answer, always parked: a lone body still has `upTo + 1`
      // answers. `upTo` is not clamped here; the mover clamps to the source's counters.
      if ((refPokemon(state, { seat: ctx.seat, spot: source })?.damage ?? 0) <= 0)
        return { done: state };
      // A shielded body is not a destination (§11).
      const opposing = unshieldedRefs(state, oppAnyRefs(state, ctx.seat), ctx, events);
      if (opposing.length === 0) return { done: state };
      return {
        park: {
          kind: "choosePokemon",
          candidates: opposing,
          upTo: op.upTo,
          takeVerb: "move",
          note: `Move up to ${op.upTo} damage counters onto which of your opponent's Pokémon?`,
        },
      };
    }
    case "putCountersOnSelfChosen": {
      // Walking Wake "Undulating Slice": always parked even with one candidate, since the count is
      // still a choice.
      if (state.players[ctx.seat].active === null) return { done: state };
      return {
        park: {
          kind: "choosePokemon",
          candidates: [{ seat: ctx.seat, spot: { spot: "active" } }],
          upTo: op.upTo,
          takeVerb: "put",
          note: `Put up to ${op.upTo} damage counters on this Pokémon? This attack does damage for each one you put. Decline to put none.`,
        },
      };
    }
    case "discardToolAndSpecialEnergyChosen": {
      // Ruffian: one question (which opponent body), forced on one candidate, parked on several.
      // Shielded bodies are filtered before the prompt.
      const bodies = unshieldedRefs(state, ruffianBodies(state, ctx.seat), ctx, events);
      if (bodies.length === 0) return { done: state };
      const forced = bodies.length === 1 ? bodies[0] : undefined;
      if (forced !== undefined)
        return { done: state, schedule: ruffianBodyAnswered(state, forced) };
      return {
        park: {
          kind: "choosePokemon",
          candidates: bodies,
          note: "Discard a Pokémon Tool and a Special Energy from which of your opponent's Pokémon?",
        },
      };
    }
    case "switchWithDeckNamed":
      // Palafin "Zero to Hero": non-parking, so the forced pick is the whole answer.
      return { done: switchWithDeckNamed(state, op.name, ctx, events) };
    case "switchWithDeckChosen": {
      // Ditto: matching deck cards, copies collapsed, offered as a declinable pick of one. With no
      // source or candidate the search still ends in the shuffle.
      const offered = deckSwapCandidates(state, ctx.seat, op.filter);
      if (offered.length === 0 || sourceRef(state, ctx).length === 0) {
        return { done: switchWithDeckCard(state, undefined, ctx, events) };
      }
      const note = `Search your deck for ${retrieveNoun(op.filter).singular} to switch with this Pokémon.`;
      return {
        park: { kind: "chooseCards", candidates: offered, min: 0, max: 1, dest: "swap", note },
      };
    }
    case "switchWithDiscardNamed": {
      // Ogre's Mask: two questions told apart by the engine-written `bodyUid`. First the in-play
      // body; an empty discard offer does nothing, one body is forced.
      const bodyUid = op.bodyUid;
      if (bodyUid === undefined) {
        const bodies = swapBodies(state, ctx.seat, op.filter);
        if (bodies.length === 0 || swapDiscardCards(state, ctx.seat, op.filter).length === 0) {
          return { done: state };
        }
        const onlyBody = bodies.length === 1 ? bodies[0] : undefined;
        if (onlyBody !== undefined)
          return { done: state, schedule: swapBodyAnswered(state, op, onlyBody) };
        return {
          park: {
            kind: "choosePokemon",
            candidates: bodies,
            note: `Switch out which of your Pokémon in play (${retrieveNoun(op.filter).singular})?`,
          },
        };
      }
      // Second question: the discard card, mandatory. Copies of one card are interchangeable, so a
      // single distinct id is forced.
      const cards = swapDiscardCards(state, ctx.seat, op.filter);
      const [first] = cards;
      if (first === undefined) return { done: state };
      if (new Set(cards.map((uid) => state.cardIdByUid[uid])).size === 1) {
        return { done: switchWithDiscard(state, bodyUid, first, ctx, events) };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates: cards,
          min: 1,
          max: 1,
          dest: "swap",
          note: `Switch in which card from your discard pile (${retrieveNoun(op.filter).singular})?`,
        },
      };
    }
    case "spreadDamage":
      // The amount is scaled here, not inside `spreadDamage`, so the helper stays a flat placement.
      return {
        done: spreadDamage(
          state,
          op.target,
          snipeAmount(op, state, ctx, record),
          op.damagedOnly === true,
          ctx,
          events,
        ),
      };
    case "damageSelf":
      // The amount is scaled here so `damageSelf` stays a flat placement. `op.on === "source"`
      // places on the program's source body instead, unscaled.
      if (op.on === "source")
        return { done: damageSourceBody(state, op.amount, ctx, op.source, events) };
      return { done: damageSelf(state, recoilAmount(op, state, ctx), ctx, op.source, events) };
    case "damageDefender": {
      // Chien-Pao ex "Hail Blade": `per` damage per card filed under `count`, through the full §8.5
      // pipeline. Flat `amount` is the "you may do N more damage" arm. Zero places nothing.
      const amount =
        op.amount ?? (op.base ?? 0) + scoredSlot(record, state, op.count, op.countFilter) * op.per;
      if (amount <= 0) return { done: state };
      return { done: snipeActive(state, amount, false, ctx, false, events) };
    }
    case "damageNewActive":
      // "This attack does N damage to the new Active Pokémon": `snipeActive` reads the Active after
      // the earlier promotion, with the full §8.5 pipeline.
      return { done: snipeActive(state, op.amount, false, ctx, false, events) };
    case "damageChosen": {
      // Resumed Target Together pick: coins flip here, where a Backtrack Badge offer can park.
      if (op.hitRefs !== undefined && op.perHeadsInPlay !== undefined) {
        return perHeadsHit(
          state,
          op,
          op.perHeadsInPlay,
          op.hitRefs,
          snipeAmount(op, state, ctx, record),
          ctx,
          events,
        );
      }
      // The snipe: choose exactly `count` opponent Benched Pokémon (clamped to the Bench, §8.6). A
      // declinable ("you may") snipe always parks; a mandatory one auto-takes when the Bench has
      // `count` or fewer.
      const shieldAsked =
        ctx.invokedBy === "item" || ctx.invokedBy === "supporter" || ctx.invokedBy === "ability";
      const offered = snipeTargets(state, ctx.seat, op);
      const candidates = shieldAsked ? unshieldedRefs(state, offered, ctx, events) : offered;
      if (candidates.length === 0) return { done: state };
      // Wo-Chien "Covetous Ivy" scales the amount by the opponent's TAKEN Prizes;
      // 0 taken → 0 damage, so there is nothing to place OR to ask about.
      const amount = snipeAmount(op, state, ctx, record);
      if (amount <= 0) return { done: state };
      const declinable = op.optional === true;
      const ceiling = op.count === "all" ? candidates.length : op.count;
      // §8.6: with fewer candidates than the printed number, take them all.
      const take = Math.min(ceiling, candidates.length);
      if (!declinable && candidates.length <= ceiling) {
        // Per-target scaling: each pick reads its own counters, so placement walks the refs one at
        // a time.
        if (op.perDamageCounterOnTarget === true) {
          return { done: snipeEachByCounters(state, candidates, op, ctx, record, events) };
        }
        // Nullifying Zero: one coin per candidate, all coins before any damage; heads targets take
        // the hit together.
        if (op.flipEach === true) {
          // A live Backtrack Badge offers after the coins, before any damage.
          const {
            state: flipped,
            faces,
            redo,
          } = flipOrKeep(state, op.faces, candidates.length, ctx, events);
          if (redo !== null)
            return {
              done: flipped,
              schedule: [{ op: "reflipCoins", toolUid: redo, faces, retry: op }],
            };
          const hit = candidates.filter((_, index) => faces[index] === "heads");
          return { done: placeSnipe(flipped, hit, amount, op, ctx, events) };
        }
        // Target Together with one candidate: the pick is forced, then the coins.
        if (op.perHeadsInPlay !== undefined) {
          return perHeadsHit(state, op, op.perHeadsInPlay, candidates, amount, ctx, events);
        }
        return { done: placeSnipe(state, candidates, amount, op, ctx, events) };
      }
      return {
        park: {
          kind: "choosePokemonMulti",
          candidates,
          min: take,
          max: take,
          declinable,
          note: snipeNote(amount, take, declinable, op),
        },
      };
    }
    case "drawCards": {
      // "If you drew any cards in this way" needs the cards actually drawn, read off the deck
      // before the draw by the same slice `drawToHand` uses, at the end `from` names.
      const drawSeats: readonly Seat[] = ((): readonly Seat[] => {
        switch (op.who) {
          case "eachPlayer":
            return [ctx.seat, otherSeat(ctx.seat)];
          case undefined:
            return [ctx.seat];
        }
      })();
      // One `recordMoved` over both seats' cards: it assigns, so per-seat filing would keep only
      // the last seat's.
      const drawn: string[] = [];
      let done = state;
      // `per`: the printed rate times a board count read here, after any cost paid earlier. A
      // switch, not a ternary, so a new member cannot fall through.
      const perCount = ((): number => {
        const per = op.per;
        if (per === undefined) return 1;
        switch (per.kind) {
          case "opponentBenchCount":
            return state.players[otherSeat(ctx.seat)].bench.length;
          case "pokemonInPlay":
            return countPokemonInPlay(
              state,
              per.seat === "you" ? ctx.seat : otherSeat(ctx.seat),
              per.filter,
              per.damagedOnly === true,
            );
          // Emma: count of cards in the opponent's hand (revealed earlier).
          case "cardsInOpponentHand":
            return countCardsInHand(state, otherSeat(ctx.seat), per.filter);
          // Gwynn: "for each card you discarded in this way".
          case "recorded":
            return recorded(record, per.slot).length;
        }
      })();
      const count = op.count * perCount;
      for (const drawSeat of drawSeats) {
        const deck = done.players[drawSeat].deck;
        const wanted = Math.max(count, 0);
        drawn.push(
          ...(op.from === "bottom"
            ? deck.slice(Math.max(0, deck.length - wanted))
            : deck.slice(0, wanted)),
        );
        done = drawToHand(done, drawSeat, count, "effect", op.from ?? "top", events);
      }
      recordMoved(record, op.recordAs, drawn);
      return { done };
    }
    case "drawUntilHandSize":
      // "Draw cards until you have N cards in your hand" (Grusha). Fully
      // automatic. A hand already at or above `size` draws NOTHING — drawToHand
      // no-ops at count ≤ 0 and emits no event, so a topped-up hand leaves no
      // misleading "drew 0 cards" row; a shallow deck short-draws, like every
      // other draw (§14.3 deck-out is checked at turn start, not here).
      if (op.per !== undefined) {
        // Mystery Garden: target hand size is `size` times the matching Pokémon in play, counted
        // after payment.
        const perSeat = op.per.seat === "you" ? ctx.seat : otherSeat(ctx.seat);
        const target =
          op.size * countPokemonInPlay(state, perSeat, op.per.filter, op.per.damagedOnly === true);
        return {
          done: drawToHand(
            state,
            ctx.seat,
            target - state.players[ctx.seat].hand.length,
            "effect",
            "top",
            events,
          ),
        };
      }
      return {
        done: drawToHand(
          state,
          ctx.seat,
          op.size - state.players[ctx.seat].hand.length,
          "effect",
          "top",
          events,
        ),
      };
    case "discardHand":
      return { done: discardHand(state, ctx, events) };
    // Amarys: flow.ts `endTurn` pays the scheduled discard.
    case "scheduleEndOfTurnHandDiscard":
      return { done: scheduleEndOfTurnHandDiscard(state, op, ctx, events) };
    case "shufflePlayedCardIntoDeck":
      return { done: shufflePlayedCardIntoDeck(state, ctx, events) };
    case "shuffleDeck":
      return { done: shuffleDeck(state, ctx, op, events) };
    case "bottomDeckTop":
      // Never parks: shuffling is the absence of an order decision.
      return { done: bottomDeckTop(state, op.n, ctx, events) };
    case "searchDeck": {
      // Brock's Scouting's "or" alternative is its own park; it shares none of the multi-group
      // arithmetic below.
      if (op.orElse !== undefined) return searchDeckOrElse(state, op, op.orElse, ctx, record);
      // `also` lists further filter/cap pairs over the same deck: the print is one decision over
      // one offer, so it is one prompt. The printed groups feed only the caption; the resolved
      // groups feed the offer.
      const printedGroups = [{ filter: op.filter, max: op.max }, ...(op.also ?? [])];
      const typedGroups =
        op.typedAsAttachedBasicEnergy === true
          ? printedGroups.map((g, i) =>
              i === 0 ? { ...g, filter: attachedBasicEnergyTypedFilter(state, ctx) } : g,
            )
          : printedGroups;
      // Step-time resolutions: Love Ball narrows group 0 to names of the opponent's in-play
      // Pokémon; Perrin's `maxRecorded` replaces group 0's ceiling with the filed slot's length.
      const groups = typedGroups.map((g, i) => ({
        filter:
          i === 0 && op.sameNameAsOpponentInPlay === true
            ? opponentInPlayNameFilter(state, ctx)
            : g.filter,
        max:
          i === 0 && op.maxRecorded !== undefined ? recorded(record, op.maxRecorded).length : g.max,
      }));
      // A Bench destination uses `benchMatches` (Basic only unless the noun names the card).
      const onBench = (uid: string, filter: CardFilter) =>
        op.dest !== "bench" || benchMatches(cardOfUid(state, uid), filter);
      const groupMatches = (filter: CardFilter) =>
        state.players[ctx.seat].deck.filter(
          (uid) => matchesFilter(cardOfUid(state, uid), filter) && onBench(uid, filter),
        );
      // The union is taken in DECK ORDER off the deck itself, one pass, so a uid
      // matching two filters appears exactly once in the offer — the caps below
      // are what make it count against both (effects.ts states the rule).
      const candidates = state.players[ctx.seat].deck
        .filter((uid) => groups.some((g) => matchesFilter(cardOfUid(state, uid), g.filter)))
        .filter((uid) => groups.some((g) => onBench(uid, g.filter)))
        // Impromptu Carrier offers simulated Tools only, and only while the program's body has a
        // free Tool slot.
        .filter(
          (uid) =>
            op.dest !== "attachToSelf" ||
            (freeToolSlotsOfSource(state, ctx) > 0 && attachableToolCard(state, uid)),
        );
      // "Any number of" resolves to the group's own match count, so `prompt.max` stays a number.
      const sized = groups.map((g) => ({
        filter: g.filter,
        max:
          typeof g.max === "number"
            ? g.max
            : g.max === "any"
              ? groupMatches(g.filter).length
              : state.players[ctx.seat].bench.length,
      }));
      // The Bench clamp binds the total across groups, not the first group's max.
      const total = sized.reduce((sum, g) => sum + g.max, 0);
      const max = op.dest === "bench" ? Math.min(total, benchSpace(state, ctx.seat)) : total;
      // "Of different types": partition candidates by type and cap each cell at one, so
      // `validateChoice` enforces pairwise distinctness via `caps`. Cells come from the candidates,
      // not all types.
      const distinctCells = new Map<string, string[]>();
      if (op.distinctEnergyTypes === true) {
        for (const uid of candidates) {
          const card = cardOfUid(state, uid);
          if (card === undefined) continue;
          const key = energyProvidesOf(card);
          const cell = distinctCells.get(key);
          if (cell === undefined) distinctCells.set(key, [uid]);
          else cell.push(uid);
        }
      }
      const distinctCaps = [...distinctCells.values()].map((uids) => ({ uids, max: 1 }));
      // The two cap sources concatenate: a uid in two groups counts against both.
      const caps = [
        ...(op.also === undefined
          ? []
          : // `sized`, not `groups`: the caps must match the numbers `total` was summed from.
            sized.map((g) => ({ uids: groupMatches(g.filter), max: g.max }))),
        ...distinctCaps,
      ];
      if (candidates.length === 0 || max <= 0) {
        // A search that can find nothing is a no-op (the trailing shuffle still fires), but it
        // files an empty record so a later "if you put any … in this way" gate answers no.
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          // With `exact` the take is mandatory and the floor is clamped to the candidates, or a
          // short deck would make the prompt unanswerable.
          min: op.exact === true ? Math.min(max, candidates.length) : 0,
          max,
          // The prompt names the place; the body is re-derived from the program on resolve.
          dest: op.dest === "attachToSelf" ? "attach" : op.dest,
          // Conditional spread, not `caps: undefined`: prompts are compared by value and an absent
          // key differs from an undefined one.
          ...(caps.length === 0 ? {} : { caps }),
          // The caption quotes the printed groups, never the resolved ones.
          note: searchNote(printedGroups, max, op),
        },
      };
    }
    case "evolveFromDeck": {
      // "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon."
      // Candidates depend on the board, so this cannot be a `searchDeck` filter. "Up to" (`min:
      // 0`); `op.onto` is written only by the ops that schedule this one.
      if (op.fromHand === true) {
        const handOffer = evolveFromDeckOffer(state, ctx, { fromHand: true });
        const candidates = handOffer?.candidates ?? [];
        if (candidates.length <= 1) {
          const placed = evolveFromHandMove(state, candidates, ctx, events);
          recordMoved(record, op.recordAs, placed.moved);
          return { done: placed.state };
        }
        const note = `Choose a card in your hand that evolves from ${handOffer?.name} and put it onto ${handOffer?.name} to evolve it.`;
        return { park: { kind: "chooseCards", candidates, min: 1, max: 1, dest: "evolve", note } };
      }
      const offer = evolveFromDeckOffer(state, ctx, {
        onto: op.onto,
        names: op.names,
        noAbilities: op.noAbilities,
      });
      if (offer === undefined || offer.candidates.length === 0) return { done: state };
      return {
        park: {
          kind: "chooseCards",
          candidates: offer.candidates,
          min: 0,
          max: 1,
          dest: "evolve",
          // The note follows the predicate so the dialog describes its own candidates correctly.
          note:
            op.names === undefined
              ? `Search your deck for a card that ${op.noAbilities === true ? "has no Abilities and " : ""}evolves from ${offer.name} and put it onto ${offer.name} to evolve it.`
              : `Search your deck for ${op.names.join(" or ")} and put it onto ${offer.name} to evolve it.`,
        },
      };
    }
    case "evolveFromDeckEachBenched": {
      // "For each of your Benched Pokémon…": asks nothing; schedules one `evolveFromDeck` per
      // occupied bench slot, each parking on its own. An empty Bench schedules nothing.
      const bench = state.players[ctx.seat].bench;
      const schedule: EffectOp[] = [];
      for (const [index, body] of bench.entries()) {
        if (body === undefined || body === null) continue;
        schedule.push({ op: "evolveFromDeck", onto: { spot: "bench", index } });
      }
      return { done: state, schedule };
    }
    case "evolveFromDeckChosen": {
      // "…evolves from 1 of your Pokémon…": asks only the body question; the card question is the
      // scheduled `evolveFromDeck`. Candidates are narrowed to bodies the deck can actually evolve.
      const eligible = evolvableOwnRefs(
        state,
        ctx,
        undefined,
        op.noAbilities,
        op.bodyStage === undefined && op.evolveTimingGates === undefined
          ? undefined
          : { bodyStage: op.bodyStage, timingGates: op.evolveTimingGates },
      );
      if (eligible.length === 0) return { done: state };
      // `parkOrForce`'s own ordering — nothing / one / many — but NOT that helper:
      // its forced arm applies a `(ref) => GameState`, the one shape that cannot
      // ask a second question. A single eligible body is ANSWERED and handed on
      // through the SAME helper the parked ending uses, so a board of one and a
      // board of two resolve this sentence down one code path (`moveCountersChosen`
      // §QUESTION 1's argument, verbatim, at its second site).
      const forced = eligible.length === 1 ? eligible[0] : undefined;
      if (forced !== undefined)
        return {
          done: state,
          schedule: evolveBodyAnswered(forced, op.noAbilities, op.thenEvolveAgain),
        };
      return {
        park: {
          kind: "choosePokemon",
          candidates: eligible,
          // The note says a second prompt follows, so the player does not take this as the whole
          // decision.
          note: "Search your deck for a card that evolves from which of your Pokémon? You will then choose the card.",
        },
      };
    }
    case "evolveFromDeckEachChosen": {
      // "Choose up to 2 of your {D} Pokémon. For each…": one multi-pick park, buying one
      // `evolveFromDeck` per picked body. No forced single: "up to" keeps a decision on every
      // board.
      const eligible = evolvableOwnRefs(state, ctx, op.pokemonType);
      if (eligible.length === 0) return { done: state };
      const max = Math.min(op.max, eligible.length);
      return {
        park: {
          kind: "choosePokemonMulti",
          candidates: eligible,
          min: 0,
          max,
          declinable: false,
          // THE PROMPT SAYS WHAT THE ANSWER BUYS (§9.2's note doctrine at its
          // third site in this family): each pick buys its OWN card prompt, and a
          // player told only "which Pokémon?" would read this as the whole
          // decision. The type is named because the candidate set is narrowed by
          // it — a caption that said "your Pokémon" would describe a set this
          // prompt is not offering.
          note: `Choose up to ${max} of your ${op.pokemonType} Pokémon to evolve from your deck. You will then choose a card for each.`,
        },
      };
    }
    case "discardPileRetrieval": {
      // Discard-pile twin of searchDeck. A Bench destination clamps to bench space before anything
      // moves. Numeric `max` is "up to" and parks; `"all"` is mandatory and resolves forced.
      const candidates = discardRetrievalCandidates(state, ctx.seat, op, record);
      // `max: "all"` ("shuffle those Energy cards into your deck") prints no quantifier, so the
      // whole matching pile moves without a prompt. The early return also narrows `op.max` to a
      // number below.
      if (op.max === "all") {
        if (candidates.length === 0) {
          recordMoved(record, op.recordAs, []);
          return { done: state };
        }
        const forced = retrieveMove(state, candidates, op.dest, ctx, events);
        recordMoved(record, op.recordAs, forced.moved);
        // No Risky Ruins call: no printing puts "all" onto the Bench, so that arm is unreachable
        // here.
        return { done: forced.state };
      }
      const retrieveMax =
        op.dest === "bench" ? Math.min(op.max, benchSpace(state, ctx.seat)) : op.max;
      // A whiff FILES AN EMPTY ANSWER rather than filing nothing. Both are false
      // to the gate that may follow ("if you shuffled any cards … in this way" —
      // you shuffled none), but only one of them is false to a slot some earlier
      // op already wrote: an op that ran and moved nothing must overwrite, or a
      // stale value survives it. Unreachable while each slot has one writer, and
      // the closed `EffectSlot` union makes reuse easy rather than hard — so the
      // two recording ops agree here instead of differing by accident.
      if (candidates.length === 0 || retrieveMax <= 0) {
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 0, // "up to" — taking none is a legal answer
          max: retrieveMax,
          dest: op.dest,
          note: retrieveNote(op.filter, op.dest, retrieveMax, op.exclude !== undefined),
        },
      };
    }
    case "lookAtTopN": {
      // Look at the top n cards (index 0 = top); candidates are the matches in deck order.
      // Declinable, so parks whenever there is a candidate. `also` is a second filter/cap over the
      // same window, which is why it cannot be two ops.
      const top = lookWindow(
        state.players[relativeSeat(ctx.seat, op.whose === "opponent")].deck,
        op,
      );
      // A Bench destination uses `benchMatches` (Basic only unless the noun names the card).
      const matches = (uid: string, filter: CardFilter) =>
        op.dest === "bench"
          ? benchMatches(cardOfUid(state, uid), filter)
          : matchesFilter(cardOfUid(state, uid), filter);
      const also = op.also;
      const candidates = top.filter(
        (uid) => matches(uid, op.filter) || (also !== undefined && matches(uid, also.filter)),
      );
      // "Any number of" resolves to the group's own match count, so the prompt's `max` stays a
      // number.
      const groupMatches = (filter: CardFilter) => top.filter((uid) => matches(uid, filter));
      const firstMax = op.max === "any" ? groupMatches(op.filter).length : op.max;
      // The total is the sum of the printed caps; `caps` keeps the two kinds distinct.
      const totalMax = firstMax + (also === undefined ? 0 : also.max);
      // A Bench destination is clamped to bench space at the offer, so a full Bench takes the whiff
      // path. `exact` still reads `totalMax`; no printing pairs it with a Bench destination.
      const offerMax =
        op.dest === "bench"
          ? Math.min(totalMax, benchSpace(state, relativeSeat(ctx.seat, op.whose === "opponent")))
          : totalMax;
      if (candidates.length === 0 || offerMax <= 0) {
        // The whiff still announces the look, through the same apply so leftovers (`restTo`) are
        // handled. Skipped only when nothing was looked at.
        if (top.length === 0) return { done: state };
        return { done: revealFromTop(state, [], op, ctx, events) };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          // `exact` (e.g. Explorer's Guidance "put 2 of them") makes the take mandatory; the floor
          // is clamped to the candidates.
          min: op.exact === true ? Math.min(totalMax, candidates.length) : 0,
          max: offerMax,
          // The op's absent `dest` means hand; the prompt requires it.
          dest: op.dest ?? "hand",
          // Caps are raw match sets and may overlap; a uid matching both filters counts against
          // both.
          ...(also === undefined
            ? {}
            : {
                caps: [
                  { uids: groupMatches(op.filter), max: firstMax },
                  { uids: groupMatches(also.filter), max: also.max },
                ],
              }),
          note: lookNote(
            op.filter,
            op.n,
            op.max,
            op.dest,
            also,
            op.exact === true,
            op.from,
            op.whose,
          ),
        },
      };
    }
    case "reorderTop": {
      // "…and put them back in any order." The deck is `op.side`'s, not necessarily `ctx.seat`'s;
      // the park and apply share the owner helper.
      const owner = relativeSeat(ctx.seat, op.side === "opponent");
      // Absent `from` is the top; `"bottom"` takes the last `n`, with index 0 still the card
      // closest to the top. Park and apply share `reorderWindow`.
      const top = reorderWindow(state.players[owner].deck, op);
      // The look is announced on every path, including no-park ones and the bottom fork. `count` is
      // what was actually looked at, not `op.n`.
      events.push({
        type: "DECK_TOP_REORDERED",
        seat: owner,
        actor: ctx.seat,
        count: top.length,
        ...(op.from === "bottom" ? { end: "bottom" as const } : {}),
      });
      // A 0- or 1-card window has one ordering, so no park. With a printed alternative, a
      // single-card window over a longer deck still differs between the arms.
      const armsDiffer =
        op.otherwise !== undefined && top.length === 1 && state.players[owner].deck.length >= 2;
      if (top.length < 2 && !armsDiffer) return { done: state };
      return {
        park: {
          kind: "orderCards",
          // In current deck order, index 0 = the top. The dialog needs the order
          // it is starting FROM, and the identity permutation has to be a
          // reachable answer.
          candidates: top,
          note: reorderNote(op),
          // The printed alternative's words, rendered as a second button; also licenses an empty
          // answer. Spread to keep the key absent.
          ...(op.otherwiseNote === undefined ? {} : { alt: op.otherwiseNote }),
        },
      };
    }
    case "attachFromTop": {
      // Look at the top n and attach the Energy among them "in any way you like": parks on the
      // compound attachCards prompt. Every non-parking path goes through the same apply so the
      // leftovers clause fires. There is no play gate, so the no-target case is reachable.
      const { candidates, targets, max } = attachFromTopOffer(state, ctx.seat, op);
      if (candidates.length === 0 || targets.length === 0 || max <= 0) {
        return { done: attachFromTopApply(state, [], op, ctx, events) };
      }
      return { park: { kind: "attachCards", candidates, targets, max, note: attachNote(op) } };
    }
    case "discardDeckTop": {
      // Mill: the top `count` of `whose` deck into that player's discard, top first. A self-mill
      // can empty the attacker's deck; they lose at their next draw, not immediately.
      const victims = ((): readonly Seat[] => {
        switch (op.whose) {
          case "self":
            return [ctx.seat];
          case "opponent":
            return [otherSeat(ctx.seat)];
          case "eachPlayer":
            return [ctx.seat, otherSeat(ctx.seat)];
        }
      })();
      let milledState = state;
      const filed: string[] = [];
      for (const victim of victims) {
        const side = milledState.players[victim];
        const milled = side.deck.slice(0, Math.max(0, op.count));
        if (milled.length === 0) continue;
        filed.push(...milled);
        // `seat` is the deck's owner and `actor` the player whose card did it; log.ts voices the
        // row from that comparison.
        events.push({ type: "DECK_TOP_DISCARDED", seat: victim, actor: ctx.seat, uids: milled });
        milledState = withSide(milledState, victim, {
          ...side,
          deck: side.deck.slice(milled.length),
          discard: [...side.discard, ...milled],
        });
        // Ferrothorn "Startling Drop" responds to being milled.
        milledState = startlingDropRetort(milledState, victim, milled, ctx, events);
      }
      // ONE filing, after the walk, and it runs on the empty-deck path too — the rule
      // `discardPileRetrieval` states and `attachFromDeck` repeats: an op that RAN and
      // moved nothing must OVERWRITE its slot, or a stale value from an earlier writer
      // survives and the count answers for the wrong op.
      recordMoved(record, op.recordAs, filed);
      return { done: milledState };
    }
    case "discardDeckBottom": {
      // Mill from the bottom (controller's own deck only). Files under `recordAs` before the
      // zero-card return so an empty deck closes the "if you do" gate.
      const side = state.players[ctx.seat];
      const kept = Math.max(0, side.deck.length - Math.max(0, op.count));
      const milled = side.deck.slice(kept);
      recordMoved(record, op.recordAs, milled);
      if (milled.length === 0) return { done: state };
      events.push({ type: "DECK_BOTTOM_DISCARDED", seat: ctx.seat, uids: milled });
      return {
        done: withSide(state, ctx.seat, {
          ...side,
          deck: side.deck.slice(0, kept),
          discard: [...side.discard, ...milled],
        }),
      };
    }
    case "revealTopDiscardMatching": {
      // Destructo-Press: reveal the top `n`, discard matches, shuffle the rest. Matches are filed
      // before the zero-card return; the discard precedes the printed damage.
      const side = state.players[ctx.seat];
      const window = side.deck.slice(0, Math.max(0, op.n));
      const matched = window.filter((uid) => matchesFilter(cardOfUid(state, uid), op.filter));
      recordMoved(record, op.recordAs, matched);
      // The printed "Reveal": the whole window is shown to both players before anything moves, even
      // on a whiff or empty deck.
      events.push({
        type: "DECK_TOP_REVEALED",
        seat: ctx.seat,
        dest: "deck",
        uids: [...window],
        reveal: true,
      });
      if (window.length === 0) return { done: state };
      const taken = new Set(matched);
      const [deck, rngState] = shuffle(
        side.deck.filter((uid) => !taken.has(uid)),
        state.rngState,
      );
      if (matched.length > 0) {
        events.push({ type: "DECK_TOP_DISCARDED", seat: ctx.seat, actor: ctx.seat, uids: matched });
      }
      events.push({ type: "SHUFFLE", seat: ctx.seat });
      return {
        done: {
          ...withSide(state, ctx.seat, { ...side, deck, discard: [...side.discard, ...matched] }),
          rngState,
        },
      };
    }
    case "revealDeckBottomCount": {
      // Bug Out: reveal the bottom `n`, file the matches (even empty), discard revealed
      // non-Pokémon, shuffle; this precedes the printed damage.
      const side = state.players[ctx.seat];
      const window = side.deck.slice(Math.max(0, side.deck.length - Math.max(0, op.n)));
      recordMoved(
        record,
        op.recordAs,
        window.filter((uid) => matchesFilter(cardOfUid(state, uid), op.filter)),
      );
      // The printed "Reveal": the whole window is shown to both players before anything moves, even
      // on a whiff or empty deck.
      events.push({
        type: "DECK_TOP_REVEALED",
        seat: ctx.seat,
        dest: "deck",
        from: "bottom",
        uids: [...window],
        reveal: true,
      });
      if (window.length === 0) return { done: state };
      const shed = window.filter(
        (uid) => !matchesFilter(cardOfUid(state, uid), { kind: "anyPokemon" }),
      );
      const gone = new Set(shed);
      const [deck, rngState] = shuffle(
        side.deck.filter((uid) => !gone.has(uid)),
        state.rngState,
      );
      if (shed.length > 0)
        events.push({ type: "DECK_BOTTOM_DISCARDED", seat: ctx.seat, uids: shed });
      events.push({ type: "SHUFFLE", seat: ctx.seat });
      return {
        done: {
          ...withSide(state, ctx.seat, { ...side, deck, discard: [...side.discard, ...shed] }),
          rngState,
        },
      };
    }
    case "attachFromDeck": {
      // Search the deck for Energy and attach it to your own Pokémon (compound attachCards park).
      // Unlike attachFromTop, dead ends return early: there are no leftovers. The trailing shuffle
      // still runs.
      const { candidates, targets, max } = attachFromDeckOffer(
        state,
        ctx,
        perBodyDeckOp(state, ctx, op),
      );
      if (candidates.length === 0 || targets.length === 0 || max <= 0) {
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      return {
        park: {
          kind: "attachCards",
          candidates,
          targets,
          max,
          // `each` parks its per-body count as `maxPerTarget`.
          ...(op.each === true
            ? { maxPerTarget: op.max }
            : op.maxPerTarget === undefined
              ? {}
              : { maxPerTarget: op.maxPerTarget }),
          // "Attach them to 1 of your Pokémon", spread so the key is absent when unconstrained.
          ...(op.oneTarget === undefined ? {} : { oneTarget: op.oneTarget }),
          note: attachFromDeckNote(op),
        },
      };
    }
    case "attachFromDiscard": {
      // Glass Trumpet / Tail Generator: compound attach from the discard pile. Dead ends return the
      // board unchanged.
      const { candidates, targets, max } = attachFromDiscardOffer(state, ctx.seat, op);
      if (candidates.length === 0 || targets.length === 0 || max <= 0) return { done: state };
      // "To each of your Future Pokémon": a pile of one identity that covers every body leaves no
      // decision and is attached inline. A short pile still parks, since which bodies get cards is
      // a choice.
      const ceiling = discardAttachCeiling(state, ctx.seat, op);
      if (
        op.each === true &&
        candidates.length >= targets.length * ceiling &&
        new Set(candidates.map((uid) => cardIdentity(state, uid))).size === 1
      ) {
        return { done: eachAttachTopUp(state, op, [], ctx, events) };
      }
      const perTarget = op.each === true ? ceiling : op.maxPerTarget;
      return {
        park: {
          kind: "attachCards",
          candidates,
          targets,
          max,
          ...(perTarget === undefined ? {} : { maxPerTarget: perTarget }),
          note:
            op.each === true ? attachEachFromDiscardNote(op) : attachFromDiscardNote(op, ceiling),
        },
      };
    }
    case "attachFromHand": {
      // Compound attach from the controller's hand. Dead ends return early: no leftovers to handle.
      if (op.whose === "opponent") {
        const owner = { ...ctx, seat: otherSeat(ctx.seat) };
        const offer = attachFromHandOffer(state, owner, op);
        if (offer.candidates.length === 0 || offer.targets.length === 0 || offer.max <= 0)
          return { done: state };
        return {
          park: { kind: "attachCards", ...offer, note: attachFromHandNote(op) },
          decider: owner.seat,
        };
      }
      const { candidates, targets, max } = attachFromHandOffer(state, ctx, op);
      if (candidates.length === 0 || targets.length === 0 || max <= 0) {
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      return {
        park: { kind: "attachCards", candidates, targets, max, note: attachFromHandNote(op) },
      };
    }
    case "moveEnergy": {
      // Move up to `max` Energy from one Pokémon to another; parks on the compound moveEnergy
      // prompt. No movable Energy or no distinct destination is a no-op. `ctx.sourceUid` resolves
      // tool- and self-relative routes. The board seat is resolved first.
      const board = moveBoardSeat(op, ctx.seat);
      const offer = moveEndpoints(state, board, op, ctx.sourceUid);
      const needed = offer.needed;
      let movable = offer.movable;
      let destinations = offer.destinations;
      // Jynx "to the new Benched Pokémon": narrow the destination to bodies carrying a filed uid.
      // Done here because `moveEndpoints` is shared with a gate that has no record, and before the
      // §11 check so unnamed bodies file no prevention row.
      if (op.destRecorded !== undefined) {
        const filed = new Set(recorded(record, op.destRecorded));
        destinations = destinations.filter((ref) =>
          (refPokemon(state, ref)?.stack ?? []).some((uid) => filed.has(uid)),
        );
      }
      // Scramble Switch: the source is pinned to the body its own switch filed.
      if (op.sourceRecorded !== undefined) {
        const filedSource = new Set(recorded(record, op.sourceRecorded));
        movable = movable.filter((entry) =>
          (refPokemon(state, entry.from)?.stack ?? []).some((uid) => filedSource.has(uid)),
        );
      }
      // §11: moving Energy on or off an opponent's Pokémon is an effect done to it, so shielded
      // bodies are filtered from the endpoints rather than refusing the whole op.
      if (board !== ctx.seat) {
        const named = new Map<string, PokemonRef>();
        for (const entry of movable) named.set(refKeyOf(entry.from), entry.from);
        for (const ref of destinations) named.set(refKeyOf(ref), ref);
        const live = new Set(unshieldedRefs(state, [...named.values()], ctx, events).map(refKeyOf));
        movable = movable.filter((entry) => live.has(refKeyOf(entry.from)));
        destinations = destinations.filter((ref) => live.has(refKeyOf(ref)));
      }
      const cap = moveCap(op, movable.length);
      if (movable.length === 0 || destinations.length < needed || cap <= 0) {
        return { done: state };
      }
      const floor = moveFloor(op, cap);
      // Forced arm: with a mandatory take of the whole movable set and one destination there is a
      // single legal answer. Gated on the floor so declinable printings still park.
      if (floor > 0 && destinations.length === 1) {
        const dest = destinations[0] as PokemonRef;
        return {
          done: moveEnergyApply(
            state,
            movable.map((entry) => ({ uid: entry.uid, dest })),
            op,
            ctx,
            events,
          ),
        };
      }
      return {
        park: {
          kind: "moveEnergy",
          movable,
          destinations,
          // "Any amount" is clamped here so the prompt keeps a plain number.
          max: cap,
          // The floor is spread rather than written as 0 so a declinable park's shape is unchanged.
          ...(floor === 0 ? {} : { min: floor }),
          // Carried onto the prompt because the wire validator and dialogs read the prompt; spread
          // to keep the key absent.
          ...(op.anySource === undefined ? {} : { anySource: op.anySource }),
          ...(op.anyDest === undefined ? {} : { anyDest: op.anyDest }),
          note: moveNote(op),
        },
      };
    }
    case "discardEnergy": {
      // Discard Energy from the opponent's board (Crushing Hammer, Giacomo, Mawile): mandatory, one
      // per affected Pokémon. An attack aimed at a single opponent's Active is refused whole by the
      // §11 block before candidates are scanned; multi-body arms are left to the per-body filter
      // below.
      if (
        ctx.invokedBy === "attack" &&
        op.from !== "opponentEach" &&
        op.from !== "opponentChosen" &&
        discardVictimSeat(ctx.seat, op) !== ctx.seat
      ) {
        if (effectRefused(state, discardVictimSeat(ctx.seat, op), ctx, undefined, events)) {
          recordMoved(record, op.recordAs, []);
          return { done: state };
        }
      }
      // The trainer channel filters shielded bodies out instead of refusing the op, since it names
      // a set. Refusals are announced once per distinct body, not per Energy candidate.
      const allDiscardable = discardableEnergies(
        state,
        ctx.seat,
        op,
        op.from === "attacker"
          ? ctx.attackerUid
          : op.from === "self" && op.bodyUid !== undefined
            ? op.bodyUid
            : ctx.sourceUid,
      );
      const unreserved = unshieldedEntries(state, allDiscardable, ctx, events);
      // Elemental Blast's `reserve`: keep only the picks that leave the most later slots fillable.
      const discardable =
        op.from === "opponentEach" || op.reserve === undefined
          ? unreserved
          : reservedDiscards(state, ctx.seat, op.from, unreserved, op.reserve);
      if (discardable.length === 0) {
        // A whiff still FILES an empty record, so a downstream reader (Hail
        // Blade's damageDefender) counts 0 rather than a stale slot — the same
        // empty-array-on-whiff the retrieval/attach ops record.
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      // "You may discard ANY amount" (Chien-Pao ex "Hail Blade"): 0..all, the
      // player choosing HOW MANY as well as WHICH — a real decision at every
      // non-empty board (unlike the mandatory arms, which auto-take a forced
      // set), so it ALWAYS parks. Every candidate stays DISTINCT (no
      // interchangeable collapse): the COUNT is what the damage reads, so three
      // identical {W} must offer three pickable rows, not one. The record is
      // filed when the pick resolves (applyChoice), so a decline files nothing.
      if (op.count === "any") {
        // "up to N" (Mewtwo VSTAR "Psy Purge") bounds the ceiling below the whole
        // offer; absent a cap it is every offered Energy (Hail Blade "any amount").
        const max =
          op.cap !== undefined ? Math.min(op.cap, discardable.length) : discardable.length;
        return {
          park: {
            kind: "discardEnergy",
            discardable,
            scope: { kind: "upTo", max },
            note: discardNote(op),
          },
        };
      }
      // "Discard ALL Energy from this Pokémon" (Pawmot / Raichu) asks nothing —
      // every match comes off, so it resolves inline like any automatic op. The
      // FULL set, not the collapsed one: interchangeability is about which to
      // pick, and here nothing is picked.
      if (op.count === "all") {
        const done = discardEnergyApply(
          state,
          discardable.map((d) => d.uid),
          op,
          ctx,
          events,
        );
        recordMoved(record, op.recordAs, done.discarded);
        return { done: done.state };
      }
      const scope: DiscardScope =
        op.from === "opponentEach" ? { kind: "each" } : { kind: "total", count: op.count ?? 1 };
      // A pick can never want more than `count` copies of one interchangeable
      // Energy, so that is exactly how many of each survive the collapse: with
      // cap 1 this is the single-Energy rule ("three {R} on a Houndoom ask
      // nothing"), and with cap 3 a Koraidon discarding 3 off FOUR identical {F}
      // is likewise no question at all.
      const cap = scope.kind === "total" ? scope.count : 1;
      const candidates = interchangeableCandidates(state, discardable, cap);
      const forced = forcedDiscards(candidates, scope);
      if (forced !== null) {
        const done = discardEnergyApply(state, forced, op, ctx, events);
        recordMoved(record, op.recordAs, done.discarded);
        return { done: done.state };
      }
      return {
        park: { kind: "discardEnergy", discardable: candidates, scope, note: discardNote(op) },
      };
    }
    case "discardTools": {
      // "Discard up to N Pokémon Tools from your opponent's Pokémon": the player chooses how many
      // and which. §11 is a per-body filter, so one shielded body does not cancel the discard on
      // the others. `op.sides` adds the controller's own board; own Tools are never shielded.
      const allDiscardable = discardableTools(state, ctx.seat, op.sides, op.bodyUid);
      const discardable = unshieldedEntries(state, allDiscardable, ctx, events);
      // Zero offers is a silent no-op: no park, no event, no log row.
      if (discardable.length === 0) return { done: state };
      // Megaton Blower's "all" asks nothing: every unshielded Tool is discarded, each to its
      // owner's pile. So does a mandatory discard (no "up to") with an offer no bigger than the
      // count; a bigger one parks for an exact total (Multi Adapter bodies can carry two Tools).
      if (op.count === "all" || (op.bodyUid !== undefined && discardable.length <= op.count)) {
        return {
          done: toolDiscardApply(
            state,
            discardable.map((entry) => entry.uid),
            ctx,
            events,
          ).state,
        };
      }
      if (op.bodyUid !== undefined) {
        return {
          park: {
            kind: "discardTools",
            discardable,
            scope: { kind: "total", count: op.count },
            note: `Discard ${op.count === 1 ? "a Pokémon Tool" : `${op.count} Pokémon Tools`} from that Pokémon.`,
          },
        };
      }
      // Any non-empty offer asks, even an offer of one, because declining is always legal under "up
      // to". No interchangeable collapse: the count is part of the answer. The ceiling is the
      // printed number clamped to the offer.
      return {
        park: {
          kind: "discardTools",
          discardable,
          scope: { kind: "upTo", max: Math.min(op.count, discardable.length) },
          note: toolDiscardNote(op),
        },
      };
    }
    // The owner picks which prize; on `side: "opponent"` the controller picks.
    case "turnPrizeFaceUp":
      return turnPrizeFaceUp(state, op, ctx, record, events);
    case "cycleOwnPrizes":
      return { done: cycleOwnPrizes(state, ctx, events) };
    // Bother-Bot's switch reads the two recorded uids and never parks.
    case "swapTurnedPrizeWithRevealed":
      return { done: swapTurnedPrizeWithRevealed(state, ctx, record, events) };
    case "revealFromHand": {
      // Weaponized Swords: any non-empty offer parks since each count gives different damage; no
      // collapse. An empty offer files `[]`.
      const candidates = state.players[ctx.seat].hand.filter((uid) =>
        matchesFilter(cardOfUid(state, uid), op.filter),
      );
      if (candidates.length === 0) {
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 0,
          max: candidates.length,
          dest: "reveal",
          note: op.note,
        },
      };
    }
    case "payFromHand": {
      // Pay the printed hand cost to the discard or the deck bottom; always the program's first op.
      // Mandatory and exact; an offer no bigger than the count resolves inline. A short hand pays
      // what there is rather than throwing (§8.6); callers gate on `handCostUnmet` first.
      const candidates = handCostCandidates(state, ctx.seat, op);
      // "Discard up to N" has a floor of zero: an empty offer files `[]` and resolves inline, while
      // any non-empty offer parks, even with one candidate. The ceiling is `cap` clamped to the
      // offer.
      if (op.count === "any") {
        if (candidates.length === 0) {
          recordMoved(record, op.recordAs, []);
          return { done: state };
        }
        return {
          park: {
            kind: "chooseCards",
            candidates,
            min: 0,
            // `cap: "any"` (Naveen's "any number of cards") offers every match.
            max: op.cap === "any" ? candidates.length : Math.min(op.cap, candidates.length),
            dest: op.to,
            note: payFromHandNote(op),
          },
        };
      }
      if (candidates.length <= op.count) {
        const paid = payFromHandApply(state, candidates, op, ctx, events);
        recordMoved(record, op.recordAs, paid.paid);
        return { done: paid.state };
      }
      // Hidden information: candidates are hand cards, and the offer names more uids than are paid
      // (and reveals duplicate structure). This is only safe because the prompt is shown just to
      // its owner; `projection.ts` does not yet gate `pendingDecision` on `phase.seat`.
      return {
        park: {
          kind: "chooseCards",
          candidates,
          // No decline: min === max.
          min: op.count,
          max: op.count,
          dest: op.to,
          note: payFromHandNote(op),
        },
      };
    }
    case "bottomFromOpponentHand": {
      // Reveal the whole hand first, in the printed order, and only here rather than in the apply
      // so a park reports it once.
      revealHand(state, otherSeat(ctx.seat), events);
      // The offer: the filtered hand, one representative per interchangeable
      // class (see the op's doc for why collapsing is sound here and not in
      // payFromHand). No match is the whiff (files [], Greavard into a
      // Supporter-less hand); one class is a forced pick and resolves inline
      // (the M1 doctrine); anything else parks the second-ever mandatory
      // chooseCards.
      const candidates = bottomFromOpponentHandOffer(state, ctx, op);
      if (candidates.length === 0) {
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      // Auto-resolve a lone candidate only when the pick is mandatory; under "up to" moving nothing
      // is a different answer, so it must still be asked.
      if (op.upTo === undefined && candidates.length === 1) {
        const moved = bottomFromOpponentHandApply(state, candidates, ctx, op.dest, events);
        recordMoved(record, op.recordAs, moved.moved);
        return { done: moved.state };
      }
      // Clamp the ask to the Bench space that can actually land; the apply clamps again on the live
      // board. "Any number of" takes the offer size as its cap.
      const printedCap = op.upTo === "any" ? candidates.length : op.upTo;
      const pickMax =
        printedCap === undefined
          ? 1
          : op.dest === "bench"
            ? Math.min(printedCap, benchSpace(state, otherSeat(ctx.seat)))
            : printedCap;
      return {
        park: {
          kind: "chooseCards",
          candidates,
          // "Up to" — taking none is a legal answer (searchDeck's `min: 0`); the
          // unmarked op's pick is compulsory and stays exactly-one.
          min: op.upTo === undefined ? 1 : 0,
          max: pickMax,
          // `dest` names the zone kind, not the owner (this is the opponent's Bench), so `note`
          // carries the printed sentence for the caption.
          dest: op.dest ?? "deckBottom",
          note: bottomFromOpponentHandNote(op),
        },
      };
    }
    case "revealOpponentHand":
      // "Your opponent reveals their hand.": no offer and no park. An empty hand still reveals, as
      // zero uids.
      revealHand(state, otherSeat(ctx.seat), events);
      return { done: state };
    case "useMilledSupporterEffect": {
      // Ninetales "Supernatural Shapeshifter": discard the top card; a Supporter Look-Alike Show
      // would offer has its program scheduled in this attack's context.
      const side = state.players[ctx.seat];
      const top = side.deck[0];
      if (top === undefined) return { done: state };
      events.push({ type: "DECK_TOP_DISCARDED", seat: ctx.seat, actor: ctx.seat, uids: [top] });
      const milled = withSide(state, ctx.seat, {
        ...side,
        deck: side.deck.slice(1),
        discard: [...side.discard, top],
      });
      const ops = copiedSupporterOps(milled, ctx, top);
      if (ops === undefined) return { done: milled };
      events.push({ type: "SUPPORTER_EFFECT_USED", seat: ctx.seat, uid: top, milled: true });
      return { done: milled, schedule: [...ops] };
    }
    case "useOpponentSupporterEffect": {
      // Mr. Mime "Look-Alike Show": offer the opponent's hand Supporters that have a program, one
      // per card id, filtered by their play conditions for the attacker. An empty offer is just the
      // reveal; a non-empty one always parks ("You may"), answered by the controller.
      const candidates = opponentSupporterOffer(state, ctx);
      if (candidates.length === 0) return { done: state };
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 0,
          max: 1,
          dest: "use",
          note: LOOK_ALIKE_SHOW_NOTE,
        },
      };
    }
    case "randomFromOpponentHand":
      // Drawn from `rngState`; never parks, since "random" has no chooser.
      if (op.untilHandSize === undefined)
        return { done: randomFromOpponentHand(state, op, ctx, record, events) };
      // Hand Trim: the take is read off the opponent's hand once, then each card is its own random
      // draw.
      return { done: randomDiscardDownTo(state, op, op.untilHandSize, ctx, record, events) };
    case "opponentDiscardsFromHand": {
      // The opponent chooses from their own hand, so `owner` is the hand, chooser, discard pile and
      // answerer, hence `decider`. With `whose: "self"` all roles are the controller and no
      // `decider` is set.
      if (op.whose === "self") return selfDiscardDownTo(state, op, ctx.seat, events);
      const owner = otherSeat(ctx.seat);
      const hand = state.players[owner].hand;
      // §8.6: the take is the printed count clamped to the hand. An empty hand is a silent no-op; a
      // hand of `take` cards or fewer is forced. For "until they have N cards" the take is the
      // excess over N.
      const wanted =
        op.untilHandSize === undefined ? op.count : Math.max(0, hand.length - op.untilHandSize);
      const take = Math.min(wanted, hand.length);
      if (take === 0) return { done: state };
      if (hand.length <= take) {
        // The forced short-hand path never reaches `applyChoice`, so it must branch on the
        // destination too.
        return {
          done:
            op.to === "deck"
              ? deckChosenFromHand(state, owner, hand, events)
              : discardChosenFromHand(state, owner, hand, events),
        };
      }
      // Mandatory exact pick; boards that could make the floor unanswerable were taken by the
      // forced arm above. The whole hand is offered without collapse because the answerer owns and
      // sees it.
      return {
        park: {
          kind: "chooseCards",
          candidates: [...hand],
          min: take,
          max: take,
          dest: op.to ?? "discard",
          note: opponentDiscardNote(op),
        },
        // The opponent answers: `decider` becomes `phase.answerer`, which gates `resolveEffect` and
        // routes the prompt (with hand card identities) to the owner alone.
        decider: owner,
      };
    }
    case "discardFromOpponentHand": {
      // "Discard all Item cards and Pokémon Tool cards": a predicate, so no park and no `decider`.
      // The hand is read and filtered live when the op runs.
      const swept = state.players[otherSeat(ctx.seat)].hand.filter((uid) =>
        matchesFilter(cardOfUid(state, uid), op.filter),
      );
      return { done: discardChosenFromHand(state, otherSeat(ctx.seat), swept, events) };
    }
    case "opponentGuessesHp": {
      // Tyme, first question: the controller names a Pokémon card in hand (a fossil is an Item),
      // forced at one candidate, otherwise parked.
      if (op.uid === undefined) {
        const named = handPokemonUids(state, ctx.seat);
        const [only] = named;
        if (only === undefined) return { done: state };
        if (named.length === 1) return { done: state, schedule: [{ ...op, uid: only }] };
        return {
          park: {
            kind: "chooseCards",
            candidates: named,
            min: 1,
            max: 1,
            dest: "name",
            note: "Name a Pokémon in your hand — your opponent guesses its HP.",
          },
        };
      }
      // Second question: the name is public, the card stays in hand, and the opponent guesses.
      const card = cardOfUid(state, op.uid);
      if (card === undefined || !state.players[ctx.seat].hand.includes(op.uid))
        return { done: state };
      events.push({ type: "POKEMON_NAMED", seat: ctx.seat, name: card.name });
      return {
        park: {
          kind: "guessHp",
          name: card.name,
          note: `Guess the HP of your opponent's ${card.name}.`,
        },
        decider: otherSeat(ctx.seat),
      };
    }
    case "opponentMayDraw": {
      // The opponent's printed "may" is answered by the opponent (`decider`). An empty opponent
      // deck makes both answers identical, so the op resolves silently.
      const drawer = otherSeat(ctx.seat);
      if (state.players[drawer].deck.length === 0) return { done: state };
      return {
        park: { kind: "mayDraw", count: op.count, note: mayDrawNote(op) },
        decider: drawer,
      };
    }
    case "optional":
      // The printed "you may" always parks, since the two answers differ by everything in `then`.
      // No `decider`: the controller answers. Printed "Choose 1:" captions ride the park as
      // `labels` only when present.
      return {
        park: {
          kind: "confirm",
          note: op.note,
          ...(op.labels === undefined ? {} : { labels: { yes: op.labels.yes, no: op.labels.no } }),
          ...(op.cards === undefined ? {} : { cards: { ...op.cards } }),
          ...(op.targets === undefined
            ? {}
            : { targets: op.targets.map((ref) => ({ ...ref, spot: { ...ref.spot } })) }),
        },
        // Lt. Surge's Bargain's "Ask your opponent": the opponent answers.
        ...(op.askOpponent === true ? { decider: otherSeat(ctx.seat) } : {}),
      };
    case "handRefresh":
      // Put the affected player(s)' hand back into their deck — shuffled in
      // (Youngster / Judge / Brassius / Katy) or under it (Iono) — then draw.
      // Fully automatic — no decision, so it never parks (like drawCards /
      // discardHand / shuffleDeck).
      return { done: handRefresh(state, op, ctx, events) };
    case "switchActive": {
      // `ownerPokemon` narrows candidates; an Active outside the subgroup means nothing is offered.
      // Targets come from `switchActiveTargets` so `programPlayable` asks the same question.
      // `ctx.sourceUid` is only used by the `fromSource` arm.
      const candidates = switchActiveTargets(state, ctx.seat, op, ctx.sourceUid);
      // No explicit empty filing on the zero-candidate path: it is unreachable (`programPlayable`
      // refuses), and `recorded()` already answers `[]` for a missing key.
      return parkOrForce(
        state,
        candidates,
        (ref) => switchRecording(op, (into) => switchOwn(state, ref, ctx, into), record, events),
        `Switch to which ${switchTargetNoun(op)}?`,
      );
    }
    case "gust":
      // Mirror of `switchActive` on the opponent's board. Candidates come from `gustTargets`, the
      // same set `programPlayable` checks; the §11 shield is applied outside it because
      // `unshieldedRefs` emits refusal events.
      return parkOrForce(
        state,
        unshieldedRefs(state, gustTargets(state, ctx.seat, op), ctx, events),
        (ref) => switchRecording(op, (into) => gust(state, ref, ctx, into), record, events),
        gustTargetNoun(op),
        undefined,
        // The printed "you may switch in": a ceiling of one allows declining.
        op.optional === true ? 1 : undefined,
      );
    case "opponentSwitchOut":
      // Same as the gust above, but the opponent chooses the new Active (`decider`). The note is
      // addressed to the answerer, who is picking from their own Bench.
      return parkOrForce(
        state,
        oppBenchRefs(state, ctx.seat),
        (ref) => switchRecording(op, (into) => gust(state, ref, ctx, into), record, events),
        "Choose your new Active Pokémon.",
        otherSeat(ctx.seat),
      );
    case "returnBenched":
      // Scoop Up Cyclone's "1 of your Pokémon": the controller's whole board, Active first.
      if (op.includeActive === true && op.whose === "self") {
        return parkOrForce(
          state,
          ownInPlayRefs(state, ctx.seat),
          (ref) => returnBenched(state, ref, op, ctx, events),
          returnBenchedNote(op),
        );
      }
      // Reversing Gust's "1 of your opponent's Pokémon": the opponent's Active and Bench,
      // §11-filtered.
      if (op.includeActive === true) {
        return parkOrForce(
          state,
          unshieldedRefs(state, oppAnyRefs(state, ctx.seat), ctx, events),
          (ref) => returnBenched(state, ref, op, ctx, events),
          returnBenchedNote(op),
        );
      }
      // The shield applies only to the opponent's board; returning your own Pokémon asks nobody.
      return parkOrForce(
        state,
        op.whose === "opponent"
          ? unshieldedRefs(state, oppBenchRefs(state, ctx.seat), ctx, events)
          : ownBenchRefs(state, ctx.seat),
        (ref) => returnBenched(state, ref, op, ctx, events),
        returnBenchedNote(op),
      );
    case "returnBenchedRest": {
      // The answer names the bodies that stay; the effect lands on the complement in `applyChoice`.
      // Not §11-filtered here: the shield is asked after the complement is taken, so kept bodies
      // don't produce false refusal rows.
      const candidates = oppBenchRefs(state, ctx.seat);
      // §8.6 "do as much as you can" with the M1 no-choice rule on top: at
      // `candidates.length <= keep` the complement is EMPTY, so there is no effect to
      // ask about and a prompt here would be a question with one answer (`parkOrForce`
      // states both halves). Correct at bench 0/1/2 as well as at exactly `keep`.
      if (candidates.length <= op.keep) return { done: state };
      return {
        park: {
          kind: "choosePokemonMulti",
          candidates,
          // The printed number is EXACT — `min === max`, the all-or-nothing reading
          // this prompt's own doc block spells. `declinable` is the separate printed
          // "you may", which this sentence does not print.
          min: op.keep,
          max: op.keep,
          declinable: false,
          note: returnBenchedRestNote(op),
        },
        // No `decider`: the controller picks on the opponent's board (§9.4).
      };
    }
    case "returnBenchedChosen": {
      // The answer names the bodies that leave, so the shield is applied to the candidates at the
      // park: ask about the bodies the effect will actually reach.
      const candidates = unshieldedRefs(state, oppBenchRefs(state, ctx.seat), ctx, events);
      // §8.6 "do as much as you can": with fewer unshielded candidates than the printed number,
      // take them all. The only early return is at zero candidates.
      if (candidates.length === 0) return { done: state };
      const take = Math.min(op.count, candidates.length);
      return {
        park: {
          kind: "choosePokemonMulti",
          candidates,
          // The printed number is EXACT — `min === max` — and §8.6's clamp is the one
          // thing that moves it, never a widening of the range: a short board asks for
          // FEWER, never for *"up to"*. `declinable` is the separate printed "you may",
          // which this sentence does not print.
          min: take,
          max: take,
          declinable: false,
          note: returnBenchedChosenNote(take),
        },
        // No `decider`: the controller picks on the opponent's board (§9.4).
      };
    }
    case "trimBench": {
      // Area Zero Underdepths trim (§7.3): the Bench owner discards exactly the excess over 5 from
      // their own Bench, only while over the live limit. Never forced, and no §11 shield.
      const bench = state.players[ctx.seat].bench.length;
      const excess = bench > benchLimitOf(state, ctx.seat) ? bench - BENCH_MAX : 0;
      if (excess <= 0) return { done: state };
      return {
        park: {
          kind: "choosePokemonMulti",
          candidates: ownBenchRefs(state, ctx.seat),
          min: excess,
          max: excess,
          declinable: false,
          note: `Your Bench can hold only ${BENCH_MAX} Pokémon: discard ${excess} of your Benched Pokémon (and all attached cards).`,
        },
      };
    }
    case "trimTools": {
      // Multi Adapter trim (§7.4): the owner discards exactly the excess over `toolCapOf` from
      // their first over-cap body. Identical Tools ask nothing and the newest come off. No §11
      // shield.
      const over = overCapToolBody(state, ctx.seat);
      if (over === undefined) return { done: state };
      const cap = toolCapOf(state, ctx.seat, over.body);
      const excess = over.body.tools.length - cap;
      if (new Set(over.body.tools.map((uid) => cardIdentity(state, uid))).size === 1) {
        return { done: trimToolsApply(state, over.body.tools.slice(-excess), ctx, events) };
      }
      const name = topCardOf(state, over.body)?.name ?? "This Pokémon";
      return {
        park: {
          kind: "discardTools",
          discardable: over.body.tools.map((uid) => ({ uid, from: over.ref })),
          scope: { kind: "total", count: excess },
          note: `${name} can have only ${cap} Pokémon Tool${cap === 1 ? "" : "s"} attached: discard ${excess}.`,
        },
      };
    }
    case "returnSelf":
      // "This Pokémon" needs no pick. This can leave the Active Spot empty; the promotion is queued
      // by `resolveMidTurnKnockOuts` after the program settles, since an op cannot reach `pending`.
      return { done: returnSelf(state, op, ctx, events) };
    case "knockOutSelf":
      // "If you use this Ability, this Pokémon is Knocked Out.": marks it lethal and lets the §8.1
      // sweep in `resolveMidTurnKnockOuts` handle the Prize, discard, event and promotion.
      return { done: knockOutSelf(state, ctx) };
    case "knockOutDefender":
      // Same seam on the defender, but the lethality is stamped as not damage, since other
      // mechanisms read a lethal defender during an attack as damaged by it. See
      // `koByEffectMarker`.
      return { done: knockOutDefender(state, ctx, events) };
    case "discardDefender":
      // Unlike `knockOutDefender`, this removes the body during the program, upstream of
      // `lethalRefs`, so there is no Prize, `KNOCKED_OUT`, recoil or `byAttackFor` mark.
      return { done: discardDefender(state, ctx, events) };
    case "knockOutChosen":
      // Knock Out with a pick: `knockOutChosenTargets` gives the offer, `unshieldedRefs` filters
      // shielded bodies, and `parkOrForce` handles empty and single-candidate boards. No `decider`:
      // the attacker chooses.
      return parkOrForce(
        state,
        unshieldedRefs(
          state,
          knockOutChosenTargets(state, ctx.seat, op, ctx.sourceUid),
          ctx,
          events,
        ),
        (ref) => doomBodyAt(state, ref, koByEffectMarker(state.turn)),
        knockOutChosenNote(op),
      );
    case "takePrize":
      // Queues a Prize decision without a Knock Out; `advance` owns the clamp, auto-resolve and win
      // check. See `queueTakePrize` for the queue position.
      return { done: queueTakePrize(state, ctx, op.count ?? 1, op.thenShuffleHand === true) };
    case "eachPlayerTakesPrize":
      // Lt. Surge's Bargain's "each player takes a Prize card": the controller's stage, then the
      // opponent's.
      return {
        done: queueTakePrize(
          queueTakePrize(state, ctx, 1, false),
          { ...ctx, seat: otherSeat(ctx.seat) },
          1,
          false,
        ),
      };
    case "discardStadium":
      // Discarding a Stadium can lower a body's maximum HP; the resulting Knock Out is collected
      // later by `collectKnockOuts`/`resolveMidTurnKnockOuts`, not here. A departing Area Zero
      // Underdepths queues its `benchTrim` stages here.
      return { done: queueStadiumLeaveTrims(state, discardStadium(state, events)) };
    // Devolving can lower a body's maximum HP; the Knock Out is collected later, but the cause is
    // stamped here (see `devolveEach`).
    case "devolveEach":
      // `toHand` (Miraculous Shine): the sweep's offer, using `devolveChosen`'s writer per body.
      return {
        done:
          op.toHand === true
            ? devolveEachToHand(state, ctx, events)
            : devolveEach(state, ctx, events),
      };
    // Devolve with a pick: `devolveTargets` gives the offer, `unshieldedRefs` is applied after
    // narrowing so no refusal is filed for a body never targeted, and `parkOrForce` handles empty
    // and single boards. No `decider` and no `upTo`: the attacker's pick is mandatory.
    case "devolveChosen": {
      // Strange Timepiece, own side: the engine-written shed applies at once; the authored pick
      // forces one body or parks a `choosePokemon`.
      if (op.whose === "self") {
        if (op.bodyUid !== undefined)
          return { done: shedOwnBody(state, ctx, op.bodyUid, op.shed ?? 1, events) };
        const own = ownDevolveTargets(state, ctx.seat, op.pokemonType);
        const [only] = own;
        if (only === undefined) return { done: state };
        if (own.length === 1) return { done: state, schedule: ownDevolveAnswered(state, only, op) };
        return parkOrForce(state, own, () => state, ownDevolveNote(op));
      }
      // `defenderOnly` (Devolution Ray): the evolved set narrowed to the Active, before §11.
      const evolved = devolveTargets(state, ctx.seat);
      const narrowed =
        op.defenderOnly === true ? evolved.filter((ref) => ref.spot.spot === "active") : evolved;
      const offered = unshieldedRefs(state, narrowed, ctx, events);
      return parkOrForce(
        state,
        offered,
        (ref) => devolveBodyToHand(state, ref, ctx, events),
        devolveChosenNote(ctx.seat, offered),
      );
    }
    case "healChosen": {
      // `zone: "bench"` (the printed "Benched") drops the Active from candidates and changes
      // nothing else; it applies to both arms. Candidates come from `healChosenTargets`, which
      // `programPlayable` also uses.
      const candidates = healChosenTargets(state, ctx.seat, op, record);
      const zoneWord = op.zone === "bench" ? "Benched " : "";
      if (op.upTo !== undefined) {
        // "Up to N … each" (Saguaro): the ask is clamped to the board and min is 0, so it parks on
        // every non-empty board.
        if (candidates.length === 0) return { done: state };
        const max = Math.min(op.upTo, candidates.length);
        return {
          park: {
            kind: "choosePokemonMulti",
            candidates,
            min: 0,
            max,
            declinable: false,
            note: healUpToNote(op.amount, max, zoneWord),
          },
        };
      }
      // A forced pick is answered here and its riders are scheduled through `continuationOps`, the
      // same path as the parked ending.
      if (hasHealedRider(op) && candidates.length === 1) {
        const forced = candidates[0] as PokemonRef;
        return {
          done: healChosen(state, forced, op.amount, ctx, events),
          schedule: healedRiderOps(state, forced, op),
        };
      }
      return parkOrForce(
        state,
        candidates,
        (ref) => healChosen(state, ref, op.amount, ctx, events),
        healTargetNoun(op),
      );
    }
    case "attachEnergyFrom": {
      // Crispin's "put 1 of them into your hand. Attach the other": the rider rewrites this op into
      // the player's type choice.
      if (op.oneOfRecorded !== undefined) {
        return { done: state, schedule: oneOfRecordedChoice(state, op, record, ctx.seat) };
      }
      // Second question: the target is known (`pickOnto`), so ask which cards. If the board no
      // longer makes it a decision, attach inline.
      if (op.pickOnto !== undefined) {
        const offer = energyPickOffer(state, op, ctx.seat, op.pickOnto.take);
        if (offer === undefined) {
          return {
            done: attachEnergyFrom(
              state,
              op,
              op.pickOnto.ref,
              ctx,
              record,
              op.pickOnto.take,
              undefined,
              events,
            ),
          };
        }
        return {
          park: {
            kind: "chooseCards",
            candidates: offer.candidates,
            min: offer.take,
            max: offer.take,
            dest: "attach",
            note: energyPickNote(state, op.pickOnto.ref, offer.take),
          },
        };
      }
      // When the pile's cards are interchangeable the only decision is the target; otherwise the
      // target answer leads to a card question (`pickOnto`). A source with no matching Energy is a
      // no-op.
      if (
        firstAttachableEnergy(
          state,
          attachSeat(op, ctx.seat),
          op.source,
          op.energyType,
          op.anyEnergy,
          op.energyName,
        ) === undefined
      ) {
        return { done: state };
      }
      // The caption names the riders and the count, since the count is not visible from the offered
      // rows. `toSelf` reads `sourceRef`, like `attachFromDeck.toSelf`. The printed "each of" is
      // handled before the park because it asks nothing: refs are resolved once, the apply runs per
      // ref against the evolving state so each body gets a different card, and Bench indices stay
      // stable since attaching reorders nothing.
      if (op.toEach === true) {
        // A pile shorter than the target set lets the controller choose which bodies get a card:
        // park exactly the pile size over the targets. A pile that covers every body asks nothing.
        const spreadTargets = attachEnergyTargets(state, ctx.seat, op);
        const spreadPile = attachableEnergies(
          state,
          attachSeat(op, ctx.seat),
          op.source,
          op.energyType,
          spreadTargets.length,
          op.anyEnergy,
          op.energyName,
        ).length;
        if (spreadPile < spreadTargets.length) {
          return {
            park: {
              kind: "choosePokemonMulti",
              candidates: spreadTargets,
              min: spreadPile,
              max: spreadPile,
              declinable: false,
              note: `Not enough Energy for all your ${attachTargetNoun(op)} — attach ${spreadPile === 1 ? "it to which one" : `1 each to which ${spreadPile}`}?`,
            },
          };
        }
        return {
          done: attachEnergyTargets(state, ctx.seat, op).reduce(
            (soFar, ref) =>
              attachEnergyFrom(soFar, op, ref, ctx, record, undefined, undefined, events),
            state,
          ),
        };
      }
      // `count` is the printed "up to N" ceiling and `declinable` is the same right at width one;
      // they never co-occur, so they fold into one argument.
      const upTo = op.count ?? (op.declinable === true ? 1 : undefined);
      // One target with non-interchangeable cards: the target needs no question but the cards do,
      // so reschedule with the target pinned (`pickOnto`).
      if (upTo === undefined && energyPickOffer(state, op, ctx.seat, 1) !== undefined) {
        const targets =
          op.toSelf === true ? sourceRef(state, ctx) : attachEnergyTargets(state, ctx.seat, op);
        const [onlyTarget] = targets;
        if (targets.length === 1 && onlyTarget !== undefined) {
          return { done: state, schedule: [{ ...op, pickOnto: { ref: onlyTarget, take: 1 } }] };
        }
      }
      return parkOrForce(
        state,
        op.toSelf === true ? sourceRef(state, ctx) : attachEnergyTargets(state, ctx.seat, op),
        (ref) => attachEnergyFrom(state, op, ref, ctx, record, undefined, undefined, events),
        // Branches on the field's presence, not its value: `count: 1` is never authored. A `toSelf`
        // caption does not use `attachTargetNoun`, since that row has no class rider.
        `Attach ${op.count === undefined ? "the Energy" : `up to ${op.count} Energy`} to ${
          op.toSelf === true ? "this Pokémon" : `which of your ${attachTargetNoun(op)}`
        }?`,
        // No `decider`: "up to N" changes how many, not who. The ceiling comes from the op because
        // only the printed text knows it.
        undefined,
        upTo,
      );
    }
  }
}

/**
 * Did the answer name a Pokémon? An absent ref is the printed decline of an "up to N" park. A
 * narrowing predicate so call sites can read `choice.ref` without a non-null assertion.
 */
function pickedPokemon(
  choice: EffectChoice,
): choice is { kind: "pokemon"; ref: PokemonRef; take?: number } {
  return choice.kind === "pokemon" && choice.ref !== undefined;
}

/**
 * A targeting op: no candidate is a no-op, one is forced (auto-resolved), two or more park a
 * choosePokemon prompt, unless the pick may be refused, in which case one candidate parks too.
 */
function parkOrForce(
  state: GameState,
  candidates: PokemonRef[],
  apply: (ref: PokemonRef) => GameState,
  note: string,
  /**
   * The seat that answers when it is not the controller ("Your opponent chooses the new Active
   * Pokémon."). The no-choice rule applies to a cross-seat park too, so a lone candidate is still
   * forced.
   */
  decider?: Seat,
  /**
   * The printed ceiling: the pick may take `0..upTo`. With a ceiling, even a single candidate
   * parks, because declining is still an answer. Zero candidates remain a no-op.
   */
  upTo?: number,
): { done: GameState } | { park: EffectPrompt; decider?: Seat } {
  if (candidates.length === 0) return { done: state };
  if (candidates.length === 1 && upTo === undefined) {
    return { done: apply(candidates[0] as PokemonRef) };
  }
  return {
    park: {
      kind: "choosePokemon",
      candidates,
      ...(upTo === undefined ? {} : { upTo }),
      note,
    },
    ...(decider === undefined ? {} : { decider }),
  };
}

/** Apply a parked op given its validated choice. The auto-resolve path calls
    the per-op helpers directly (single forced ref); this is the resolveEffect
    entry, matching the choice shape to the op. */
export function applyChoice(
  state: GameState,
  op: EffectOp,
  choice: EffectChoice,
  ctx: EffectContext,
  /** The running §9.2 record — the two recording ops both PARK, so this path is
      where nearly every recording is actually made (see resumeProgram). */
  record: EffectRecord,
  events: GameEvent[],
): GameState {
  switch (op.op) {
    // Backtrack Badge: "yes" spends the once-per-turn key and files `COINS_REFLIPPED`; "no" moves
    // nothing.
    case "reflipCoins":
      return choice.kind === "confirm" && choice.yes
        ? spendCoinRedo(state, ctx.seat, op.toolUid, op.faces.length, events)
        : state;
    case "searchDeck": {
      // Filed from what `searchMove` actually moved, not from `choice.uids`: a stale uid never
      // moved, and a Bench-bound answer is clamped to bench space (§9.2).
      if (choice.kind !== "cards") {
        recordMoved(record, op.recordAs, []);
        return state;
      }
      // Impromptu Carrier: the pick is attached to the program's own body.
      if (op.dest === "attachToSelf") {
        const attached = searchAttachToSelf(state, choice.uids, ctx, events);
        recordMoved(record, op.recordAs, attached.moved);
        return attached.state;
      }
      const searched = searchMove(state, choice.uids, op.dest, op.reveal, ctx, events);
      recordMoved(record, op.recordAs, searched.moved);
      // Risky Ruins on what landed on the Bench (a no-op for every other `dest`).
      return benchArrivalCounters(searched.state, ctx.seat, searched.moved, events);
    }
    case "evolveFromDeck":
      // The hand route (Spiteful Evolution) files the placement for its "If you do".
      if (op.fromHand === true) {
        const placed =
          choice.kind === "cards" ? evolveFromHandMove(state, choice.uids, ctx, events) : undefined;
        recordMoved(record, op.recordAs, placed?.moved ?? []);
        return placed?.state ?? state;
      }
      return choice.kind === "cards"
        ? evolveFromDeckMove(
            state,
            choice.uids,
            ctx,
            { onto: op.onto, names: op.names, noAbilities: op.noAbilities },
            events,
          )
        : state;
    case "evolveFromDeckChosen":
      // The body answer moves nothing; `continuationOps` schedules the op that asks for the card.
      return state;
    case "evolveFromDeckEachChosen":
      // The multi answer moves nothing; `continuationOps` schedules the resulting ops.
      return state;
    case "discardPileRetrieval": {
      if (choice.kind !== "cards") return state;
      const retrieved = retrieveMove(state, choice.uids, op.dest, ctx, events);
      // What was RETRIEVED, not what was offered or picked: a wire-dropped uid
      // (one no longer in the discard) never moved, so Miriam's "if you
      // shuffled any cards into your deck in this way" must not count it.
      recordMoved(record, op.recordAs, retrieved.moved);
      // Risky Ruins on what landed on the Bench (a no-op for every other `dest`).
      return benchArrivalCounters(retrieved.state, ctx.seat, retrieved.moved, events);
    }
    case "lookAtTopN":
      // Risky Ruins on the picked cards that landed on the controller's own Bench.
      return choice.kind === "cards"
        ? benchArrivalCounters(
            revealFromTop(state, choice.uids, op, ctx, events),
            ctx.seat,
            choice.uids,
            events,
          )
        : state;
    case "reorderTop": {
      // `validateChoice` has checked that the answer is a permutation of the offered window, so the
      // top cards are replaced in the answer's order. No event here: `DECK_TOP_REORDERED` was filed
      // when the op parked, since it reports the look.
      if (choice.kind !== "orderCards") return state;
      const owner = relativeSeat(ctx.seat, op.side === "opponent");
      const deck = state.players[owner].deck;
      // Re-sliced off the live deck: a short deck may have offered fewer than `op.n` cards. The
      // bottom fork replaces the last `uids.length` cards instead.
      const kept = deck.slice(0, Math.max(0, deck.length - choice.uids.length));
      return {
        ...state,
        players: {
          ...state.players,
          [owner]: {
            ...state.players[owner],
            deck:
              op.from === "bottom"
                ? [...kept, ...choice.uids]
                : [...choice.uids, ...deck.slice(choice.uids.length)],
          },
        },
      };
    }
    case "revealFromHand": {
      // `validateChoice` has checked the answer against the prompt; what is revealed is what is
      // still in hand, once each. Nothing moves.
      const hand = new Set(state.players[ctx.seat].hand);
      const revealed: string[] = [];
      for (const uid of choice.kind === "cards" ? choice.uids : []) {
        if (hand.has(uid) && !revealed.includes(uid)) revealed.push(uid);
      }
      if (revealed.length > 0)
        events.push({ type: "HAND_CARDS_REVEALED", seat: ctx.seat, uids: revealed });
      recordMoved(record, op.recordAs, revealed);
      return state;
    }
    case "payFromHand": {
      if (choice.kind !== "cards") return state;
      const paid = payFromHandApply(state, choice.uids, op, ctx, events);
      recordMoved(record, op.recordAs, paid.paid);
      return paid.state;
    }
    case "opponentDiscardsFromHand":
      // The answer comes from the opponent and moves cards on their side; `ctx.seat` is still the
      // controller, so the owner is re-derived as the park derived it. The deck-destination branch
      // is not checked by the compiler: without it the picked cards would land in the discard pile.
      if (choice.kind !== "cards") return state;
      // Xerosic's Machinations' `untilHandSize` arm and Hand Trimmer's `whose: "self"` arm always
      // take the discard branch (`to` is unrepresentable there).
      if (op.whose === "self") {
        return discardChosenFromHand(
          state,
          relativeSeat(ctx.seat, op.whose !== "self"),
          choice.uids,
          events,
        );
      }
      return op.to === "deck"
        ? deckChosenFromHand(state, otherSeat(ctx.seat), choice.uids, events)
        : discardChosenFromHand(state, otherSeat(ctx.seat), choice.uids, events);
    case "bottomFromOpponentHand": {
      if (choice.kind !== "cards") return state;
      const moved = bottomFromOpponentHandApply(state, choice.uids, ctx, op.dest, events);
      // What actually MOVED, not what was picked — the retrieval/payment rule
      // (§9.2): a wire-dropped uid never left the hand, and Ortega's "if you
      // put a card on the bottom of your opponent's deck in this way" must not
      // count it. The reveal is NOT re-emitted here — it already rode the
      // action that parked.
      recordMoved(record, op.recordAs, moved.moved);
      return moved.state;
    }
    case "useOpponentSupporterEffect": {
      // Look-Alike Show: the pick moves nothing (the card stays in the opponent's hand); it is
      // announced here and `continuationOps` splices the Supporter's program. A decline says
      // nothing.
      const [picked] = choice.kind === "cards" ? choice.uids : [];
      if (picked === undefined) return state;
      events.push({ type: "SUPPORTER_EFFECT_USED", seat: ctx.seat, uid: picked });
      return state;
    }
    case "opponentGuessesHp":
      // Tyme: the naming answer moves nothing (`continuationOps` asks the second question); the
      // guess answer is the reveal and the draw.
      return op.uid !== undefined && choice.kind === "hpGuess"
        ? hpGuessApply(state, op, op.uid, choice.hp, ctx, events)
        : state;
    case "opponentMayDraw":
      // The drawer is the answerer — the controller's OPPONENT (the op's whole
      // point); a decline moves nothing and says nothing.
      return choice.kind === "mayDraw" && choice.draw
        ? drawToHand(state, otherSeat(ctx.seat), op.count, "effect", "top", events)
        : state;
    case "optional":
      if (choice.kind === "confirm" && choice.target !== undefined && op.cards !== undefined) {
        const attach = (choice.yes ? op.then : op.otherwise)?.[0];
        const uid = choice.yes ? op.cards.yes : op.cards.no;
        if (attach?.op === "attachEnergyFrom" && uid !== undefined) {
          return attachEnergyFrom(
            state,
            attach,
            choice.target,
            ctx,
            record,
            undefined,
            [uid],
            events,
          );
        }
      }
      // Other optional prompts splice their branch through continuationOps.
      return state;
    case "switchActive":
      // Records what moved, not what was picked: an answer that `switchInto` then refused must not
      // file a switch.
      return pickedPokemon(choice)
        ? switchRecording(op, (into) => switchOwn(state, choice.ref, ctx, into), record, events)
        : state;
    case "gust":
      return pickedPokemon(choice)
        ? switchRecording(op, (into) => gust(state, choice.ref, ctx, into), record, events)
        : state;
    case "knockOutChosen":
      // The same call the forced half makes, so both produce identical boards; `doomBodyAt` no-ops
      // if the body has left play. No §11 check here: shielded bodies were filtered from the
      // candidates.
      return pickedPokemon(choice)
        ? doomBodyAt(state, choice.ref, koByEffectMarker(state.turn))
        : state;
    case "returnBenched":
      // No `recordAs`: this op is on neither side of any printed "If you do". `returnBenched`
      // no-ops if the body has since left play.
      return pickedPokemon(choice) ? returnBenched(state, choice.ref, op, ctx, events) : state;
    case "returnBenchedRest": {
      // The answer names the bodies that stay, so the writer receives the complement.
      if (choice.kind !== "pokemonMulti") return state;
      const kept = choice.refs;
      // The live Bench is re-read; a body that has since left play simply matches nothing.
      // `refKeyOf` is used because `refEquals` is private to cardplay.ts.
      const keptKeys = new Set(kept.map(refKeyOf));
      const complement = oppBenchRefs(state, ctx.seat).filter(
        (ref) => !keptKeys.has(refKeyOf(ref)),
      );
      // The §11 shield is asked here, after narrowing, so only bodies the effect will actually
      // reach are checked.
      return shuffleBenchedRefsIntoDeck(
        state,
        unshieldedRefs(state, complement, ctx, events),
        ctx,
        events,
      );
    }
    case "trimBench":
      // Area Zero Underdepths' trim (§7.3): the answer names the owner's benched bodies that go.
      // Omitting this arm would typecheck and silently drop the answer.
      return choice.kind === "pokemonMulti"
        ? discardBenchedRefs(state, choice.refs, ctx, events)
        : state;
    case "trimTools":
      // Multi Adapter's trim (§7.4): the answer names the Tools that go from the owner's over-cap
      // body.
      return choice.kind === "discardTools"
        ? trimToolsApply(state, choice.uids, ctx, events)
        : state;
    case "returnBenchedChosen": {
      // The resumed half. The compiler cannot catch a missing arm here: `default` returns the state
      // unchanged, so the answer would be silently dropped.
      if (choice.kind !== "pokemonMulti") return state;
      // The answer itself, not the complement. No shield check: shielded bodies were filtered from
      // the candidates. No `recordAs`. The funnel re-reads the live Bench.
      return shuffleBenchedRefsIntoDeck(state, choice.refs, ctx, events);
    }
    case "opponentSwitchOut":
      // `ctx.seat` is still the controller, so `gust`'s `otherSeat` lands on the seat that
      // answered. The recording is needed on this arm too: with two or more benched bodies the op
      // always parks.
      return pickedPokemon(choice)
        ? switchRecording(op, (into) => gust(state, choice.ref, ctx, into), record, events)
        : state;
    case "healChosen":
      // The "up to N" arm answers with a SET (each ref healed `amount`,
      // clamped per Pokémon; the empty set is the legal "none" of §9.1's
      // "up to"); the exact-1 arm with a single ref. Each shape only ever
      // reaches its own prompt — validateChoice matches the choice against
      // the PARKED prompt — so the cross arms are the wire belt.
      if (choice.kind === "pokemonMulti") {
        return choice.refs.reduce(
          (healed, ref) => healChosen(healed, ref, op.amount, ctx, events),
          state,
        );
      }
      return pickedPokemon(choice) ? healChosen(state, choice.ref, op.amount, ctx, events) : state;
    // Acerola's Mischief's parked pick.
    case "installChosenAttackShield":
      return pickedPokemon(choice)
        ? installChosenAttackShield(state, choice.ref, op, ctx, events)
        : state;
    case "moveCountersToDefender":
      // The parked half of the counter move.
      return pickedPokemon(choice) ? moveCountersToDefender(state, choice.ref, ctx, events) : state;
    // The resumed half; the compiler cannot catch a missing arm here, since `default` returns the
    // state unchanged. Same call as the forced half; `devolveBodyToHand` no-ops if the body has
    // left play. No §11 check: shielded bodies were filtered from the candidates.
    case "devolveChosen":
      // An own-side pick moves nothing here; `continuationOps` schedules the shed.
      if (op.whose === "self") return state;
      return pickedPokemon(choice) ? devolveBodyToHand(state, choice.ref, ctx, events) : state;
    case "moveCountersChosen": {
      // The two parks of one sentence. The source answer moves nothing (`continuationOps` asks
      // question two); the destination answer is the whole move.
      const chosen = op.fromBench;
      if (!pickedPokemon(choice) || chosen === undefined) return state;
      return moveCountersFromBench(state, chosen, choice.ref, ctx, events);
    }
    case "moveCounterOwnChosen": {
      // Rocket Brain's two parks, told apart by `op.from`. The source answer moves nothing; the
      // destination answer is the whole move.
      const from = op.from;
      if (!pickedPokemon(choice) || from === undefined) return state;
      return moveOneOwnCounter(state, from, choice.ref, ctx, events);
    }
    case "moveCountersToOpponentChosen": {
      // Adrena-Brain's two parks, told apart by `op.from`. The source answer moves nothing. The
      // destination answer's `take` is the count (absent means `upTo`), and a ref-less answer
      // declines: nothing moves, no event.
      const source = op.from;
      if (!pickedPokemon(choice) || source === undefined) return state;
      return moveCountersToOpponent(state, source, choice.ref, choice.take ?? op.upTo, ctx, events);
    }
    case "putCountersOnSelfChosen": {
      // `take` is the count (absent means `upTo`); a ref-less answer declines and files `[]`. One
      // entry per counter is filed under `"placed"`, which the program's `damageDefender { count:
      // "placed" }` reads.
      if (!pickedPokemon(choice)) {
        recordMoved(record, "placed", []);
        return state;
      }
      const placed = placeCountersOnSelf(state, choice.take ?? op.upTo, ctx, events);
      recordMoved(record, "placed", placed.placed);
      return placed.state;
    }
    case "moveCountersOpponentAnyWay": {
      // The loop's two parks, told apart by `op.source`. The first (source and count) moves
      // nothing; the second's answer is the round's whole move.
      const source = op.source;
      if (!pickedPokemon(choice) || source === undefined) return state;
      const from: PokemonRef = { seat: otherSeat(ctx.seat), spot: source };
      return moveCountersBetweenOpponents(state, from, choice.ref, op.take ?? 0, ctx, events);
    }
    case "discardToolAndSpecialEnergyChosen":
      // Ruffian's pick moves nothing here; `continuationOps` splices the two discards.
      return state;
    case "switchWithDiscardNamed": {
      // Ogre's Mask: the body answer moves nothing (`continuationOps` asks question two); the card
      // answer is the whole swap.
      const bodyUid = op.bodyUid;
      const [picked] = choice.kind === "cards" ? choice.uids : [];
      if (bodyUid === undefined || picked === undefined) return state;
      return switchWithDiscard(state, bodyUid, picked, ctx, events);
    }
    case "switchWithDeckChosen": {
      // Ditto: the picked deck card is switched in (or none), then the deck is shuffled.
      const [picked] = choice.kind === "cards" ? choice.uids : [];
      return switchWithDeckCard(state, picked, ctx, events);
    }
    case "damageChosen":
      // Per-target fold: the multiplier is the chosen body's own counters, so the pick is walked
      // ref by ref with `snipeAmount`, as `stepOp`'s forced branch does.
      if (choice.kind === "pokemonMulti" && op.perDamageCounterOnTarget === true) {
        return snipeEachByCounters(state, choice.refs, op, ctx, record, events);
      }
      // Target Together: the pick moves nothing; `continuationOps` reschedules the op with
      // `hitRefs` and `stepOp` flips, so a Backtrack Badge offer can park.
      if (choice.kind === "pokemonMulti" && op.perHeadsInPlay !== undefined) return state;
      // Recompute the (possibly Prize-scaled) amount from state: no KO has
      // happened between parking and this pick, so the count is unchanged — the
      // same value snipeNote quoted in the prompt.
      return choice.kind === "pokemonMulti"
        ? // The riders, provenance included, ride the parked op, so a resumed pick emits the same
          // row an inline one would.
          placeSnipe(state, choice.refs, snipeAmount(op, state, ctx, record), op, ctx, events)
        : state;
    case "attachEnergyFrom":
      // An absent ref is the decline: the board is returned untouched with no event. `choice.take`
      // carries a partial count (absent means the whole batch). The card answer (`pickOnto`) lands
      // exactly the picked uids on the pinned target; a target answer with cards still undecided
      // moves nothing, as `continuationOps` asks the card question. The short-pile spread
      // (`toEach`) puts one card onto each chosen body in the order named.
      if (op.toEach === true && choice.kind === "pokemonMulti") {
        return choice.refs.reduce(
          (board, ref) =>
            attachEnergyFrom(board, op, ref, ctx, record, undefined, undefined, events),
          state,
        );
      }
      if (op.pickOnto !== undefined) {
        return choice.kind === "cards"
          ? attachEnergyFrom(
              state,
              op,
              op.pickOnto.ref,
              ctx,
              record,
              op.pickOnto.take,
              choice.uids,
              events,
            )
          : state;
      }
      if (
        pickedPokemon(choice) &&
        energyPickOffer(state, op, ctx.seat, attachTake(op, choice.take)) !== undefined
      ) {
        return state;
      }
      return pickedPokemon(choice)
        ? attachEnergyFrom(state, op, choice.ref, ctx, record, choice.take, undefined, events)
        : state;
    case "attachFromTop":
      return choice.kind === "attachCards"
        ? attachFromTopApply(state, choice.assignments, op, ctx, events)
        : state;
    case "attachFromHand": {
      // Files what was attached (§9.2), never what was offered; a decline files `[]`. The compiler
      // cannot catch its absence, and the later hit would then count an empty slot.
      if (choice.kind !== "attachCards") return state;
      // Pleasing Present's first half: applied out of the opponent's hand onto their board, under
      // their seat.
      if (op.whose === "opponent") {
        return attachFromZoneApply(
          state,
          choice.assignments,
          "hand",
          { ...ctx, seat: otherSeat(ctx.seat) },
          events,
        ).state;
      }
      // The printed singular is mandatory (Lethargic Charge): an empty answer is topped up with the
      // first offered card onto the first offered target, both re-read off the live offer.
      const attached = attachFromZoneApply(
        state,
        op.one === true && choice.assignments.length === 0
          ? handTopUp(state, ctx, op)
          : choice.assignments,
        "hand",
        ctx,
        events,
      );
      recordMoved(record, op.recordAs, attached.attached);
      return attached.state;
    }
    case "attachFromDiscard":
      // Glass Trumpet's answer, applied out of the discard pile. `validateChoice` enforced the
      // couplings; the apply re-checks zone and seat.
      if (choice.kind !== "attachCards") return state;
      // Reboot Pod: the answer as given, then the mandatory top-up.
      return op.each === true
        ? eachAttachTopUp(state, op, choice.assignments, ctx, events)
        : attachFromZoneApply(state, choice.assignments, "discard", ctx, events).state;
    case "attachFromDeck": {
      if (choice.kind !== "attachCards") return state;
      const attached = attachFromZoneApply(state, choice.assignments, "deck", ctx, events);
      // What was ATTACHED, not what was offered or picked — the retrieval/payment
      // rule (§9.2): a uid the wire dropped, repeated, or aimed at a Pokémon that
      // is not there never moved, so Janine's "if you attached Energy to your
      // Active Pokémon in this way" must not count it.
      recordMoved(record, op.recordAs, attached.attached);
      return attached.state;
    }
    case "moveEnergy":
      // The op is threaded so the board side comes from the card, not from the wire-supplied refs.
      return choice.kind === "moveEnergy"
        ? moveEnergyApply(state, choice.picks, op, ctx, events)
        : state;
    case "turnPrizeFaceUp":
      // The parked half of Crescent Purge's cost; a missing arm would silently drop the answer.
      // `side` picks the row (Bother-Bot's is the opponent's) and `recordAs` files the uid actually
      // turned.
      return choice.kind === "prize"
        ? turnPrizeFaceUpAt(state, choice.index, op, ctx, record, events)
        : state;
    case "preventChosenAttack":
      // The parked half of the opponent-side per-attack lock.
      return choice.kind === "attack"
        ? lockDefenderAttack(state, choice.index, ctx, events)
        : state;
    case "discardEnergy": {
      if (choice.kind !== "discardEnergy") return state;
      const done = discardEnergyApply(state, choice.uids, op, ctx, events);
      // File what actually came off under the §9.2 slot — Hail Blade's
      // damageDefender reads its length. A decline (empty pick) files [], so the
      // damage counts 0. No-op for every other discard (recordAs absent).
      recordMoved(record, op.recordAs, done.discarded);
      return done.state;
    }
    case "discardTools": {
      // Required even though no exhaustiveness check catches its absence: `default` returns the
      // state unchanged, so a missing arm would silently drop the player's answer.
      if (choice.kind !== "discardTools") return state;
      // No `recordMoved`: this op is not enrolled in `recordSlotOf` and carries no
      // `recordAs` — no printing pairs the sentence with a §9.2 "If you do,".
      return toolDiscardApply(state, choice.uids, ctx, events).state;
    }
    case "lookAtPrize":
      // Both answers move nothing: the slot answer buys the look through `continuationOps`, and the
      // one-card `orderCards` answer leaves the card where it was. Spelled out so the parking op is
      // named here.
      return state;
    // Synchronous ops never park, so never reach the choice path.
    case "applyStatus":
    case "boostAttack":
    case "boostSideAttacksThisTurn":
    case "bottomDeckTop":
    case "bountyDefender":
    case "bountyThisAttack":
    case "chooseOneOffered":
    case "clearStatus":
    case "coinFlipGate":
    case "conditionGate":
    case "counterEachAll":
    case "countersOnRecordedBody":
    case "counterUntilRemainingHp":
    case "cycleOwnPrizes":
    case "damageActive":
    case "damageDefender":
    case "damageNewActive":
    case "damageSelf":
    case "damageSubject":
    case "devolveEach":
    case "discardDeckBottom":
    case "discardDeckTop":
    case "discardDefender":
    case "discardFromOpponentHand":
    case "discardHand":
    case "discardStadium":
    case "drawCards":
    case "drawUntilHandSize":
    case "eachPlayerTakesPrize":
    case "evolveFromDeckEachBenched":
    case "exposeDefender":
    case "exposeSelf":
    case "flipLockAttack":
    case "flipLockTrainerPlay":
    case "handRefresh":
    case "heal":
    case "healEach":
    case "healEachAll":
    case "healSubject":
    case "installNoWeakness":
    case "installRecoil":
    case "installSideAttackBlock":
    case "installSideDamageReductionNextTurn":
    case "knockOutDefender":
    case "knockOutEach":
    case "knockOutSelf":
    case "lockSideAttacks":
    case "lockSideRetreat":
    case "markHandAttach":
    case "preventAttack":
    case "preventAttackUse":
    case "preventDamage":
    case "preventHandPlay":
    case "preventRetreat":
    case "randomFromOpponentHand":
    case "recordGate":
    case "recoverOneStatus":
    case "reduceDamage":
    case "reflipAttackCoins":
    case "returnSelf":
    case "retypeDefenderWeakness":
    case "revealDeckBottomCount":
    case "revealOpponentHand":
    case "revealTopDiscardMatching":
    case "scheduleCounters":
    case "scheduleDiscard":
    case "scheduleEndOfTurnHandDiscard":
    case "scheduleKnockOut":
    case "shuffleDeck":
    case "shufflePlayedCardIntoDeck":
    case "spreadDamage":
    case "swapTurnedPrizeWithRevealed":
    case "switchWithDeckNamed":
    case "takePrize":
    case "taxDefender":
    case "useAttackAs":
    case "useFoundAttackAs":
    case "useInPlayAttackAs":
    case "useMilledSupporterEffect":
    case "weakenDefenderAttacks":
    case "winGame":
      return state;
    default:
      // Records written by another engine version can carry op names this build
      // does not know; they are ignored at runtime but must not typecheck.
      assertNoOpLeft(op);
      return state;
  }
}

function assertNoOpLeft(_op: never): void {}
