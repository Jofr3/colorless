import type { Attack, BasicEnergyType, Card } from "@colorless/schema";
import {
  activeTop,
  applyDamageModifier,
  attacksOf,
  benchMatches,
  // An attached Energy is a bare uid with no stack, so it resolves through `cardOfUid` rather than
  // `topCardOf`.
  cardOfUid,
  energyProvidesOf,
  evolveFromOf,
  hasPrintedAbility,
  isBasicEnergy,
  isBasicPokemon,
  isEnergyCard,
  isExOrV,
  isStage1Pokemon,
  isStage2Pokemon,
  matchesFilter,
  pokemonSuffixOf,
  preventsAttackerBanner,
  preventsAttackerClass,
  resistanceOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
import {
  attackBlockOf,
  attackGateOf,
  attackerHasSpecialEnergy,
  benchShieldedFromDamage,
  benchShieldedFromEffects,
  coinFlipShieldPrevents,
  coinRedoToolOf,
  spendCoinRedo,
  countAttachedEnergy,
  countEnergyInPlay,
  effectiveMaxHp,
  isLethallyDamaged,
  effectiveRetreatCost,
  everyAttackBoostOf,
  groupShieldedFromAttackEffects,
  hasAttachedEnergy,
  installedAttackDebuffOf,
  installedNoWeakness,
  installedRecoilOf,
  installedReductionOf,
  installedVulnerabilityOf,
  installedWeaknessRetypeOf,
  installedWeaknessRewriteOf,
  koSurvivalClamp,
  koSurvivalCoinFlip,
  liveHandAttachMark,
  opposingAttackDebuff,
  opposingToolAttackDebuff,
  passivesOf,
  preventedByDamageThreshold,
  preventsAttackerType,
  providesEnergyType,
  remainingHpWithin,
  seatDamageReduction,
  seatPreWRDamageBonus,
  sideAttackBonusThisTurn,
  seatRemovesWeakness,
  seatWeaknessRewrite,
  seatShieldedFromSupporterEffects,
  stadiumPreventsDamage,
  NO_CONSUMABLE,
  berryReductionOf,
  attackerGatedReductionOf,
  selfPreWRBonusPerOpponentPrize,
  seatShieldedFromLowEnergyAttacker,
  healLocked,
  deluxeBombOf,
  stadiumShieldsStatus,
  intoPlayOnlyViaOf,
  discardPileLockedOf,
  toolCardSimulated,
  inPlayToHandBlocked,
  inPlayCardOf,
  benchLimitOf,
  benchTrimStages,
  returnsAfterAttackDiscard,
  supporterEffectOf,
  stadiumEffectsOf,
  stageChangeConditions,
  withWatchedRecoil,
  toolCapOf,
  owesToolTrim,
  countersMoveLocked,
  opponentMillRetortOf,
  weaknessAmountOverride,
  withWeaknessAmount,
} from "./continuous";
import type { KoSurvival } from "./continuous";
import { POKEMON_TYPES, STATUS_WORD_OF, foldApostrophes } from "./effects";
// TYPE-ONLY — interpreter.ts must not gain a runtime edge to registry.ts (the
// registry imports effects.ts for its op vocabulary and this file evaluates it);
// `AttackTimingGate` is a shape, so the edge is erased wholesale.
import type { AttackTimingGate } from "./registry";
import type {
  AttachTargetRiders,
  AttackerClass,
  BoardCondition,
  CardFilter,
  EffectOp,
  OpOf,
  EffectSlot,
  StampedPlayLockKey,
  HandRefreshDraw,
  PokemonType,
} from "./effects";
import type { GameEvent, StatusName } from "./events";
// Import cycle with flow.ts; safe because both ends are hoisted function declarations called only
// at run time.
import { discardMisplacedEnergy, finishGame } from "./flow";
// THE one exhaustive switch over `Phase` (phaseView.ts) — `conditionHolds` reads
// the turn OWNER from it rather than re-deriving one by turn parity, which that
// module's header forbids. phaseView.ts imports from here TYPE-ONLY
// (`import type { EffectPrompt }`), so this value import leaves no runtime cycle.
import { phaseViewOf } from "./phaseView";
import type { CoinFace } from "./rng";
import { flipCoin, randomIndex, shuffle } from "./rng";
// Import cycle with triggers.ts; safe because both ends are hoisted function declarations called
// only at run time.
import {
  damagedByAttackAbility,
  damagedToolTriggersOf,
  runActiveBenchedTriggers,
  runSelfWatchedTriggers,
  runWatchedTriggers,
} from "./triggers";
import type {
  AttackBlock,
  BoostedAttack,
  GameState,
  InPlayPokemon,
  LockedAttack,
  PendingStage,
  PlayerSide,
  PokemonTarget,
  ScheduledEffect,
  Seat,
  SideDamageReduction,
  SpecialConditions,
} from "./types";
import {
  bodyAt,
  inPlayOf,
  HP_PER_COUNTER,
  clearedAttackEffects,
  damageCountersOn,
  pokemonAt,
  turnOwnerOf,
  BENCH_CEILING,
  BENCH_MAX,
  DEFAULT_CONFUSION_DAMAGE,
  DEFAULT_POISON_DAMAGE,
  SEATS,
  discardFromStack,
  drawToHand,
  evolveOnto,
  isFirstTurnOf,
  koedDuringOpponentsLastTurn,
  koedMarksOnOpponentsLastTurn,
  makeInPlay,
  noConditions,
  otherSeat,
  presentStatuses,
  stackUids,
  takenPrizes,
  usedAttackOnYourLastTurn,
  withActive,
  withAttackDamageTaken,
  withSide,
  without,
  koByEffectMarker,
} from "./types";

// The shared effect interpreter: the one place a GameState changes under an op program (attack,
// Trainer or Ability). It can park mid-effect, and the continuation is plain JSON so it persists
// and replays identically. It may place damage but never resolves Knock Outs; flow.ts owns every
// Knock Out.

/** The controller of an effect (the seat playing the card). "self" ops target
    this seat's Active, "defender"/gust the opponent's. */
export interface EffectContext {
  seat: Seat;
  /**
   * Top-card uid of the Pokémon whose effect this is (the printed "this Pokémon"). Absent for
   * Trainer programs, where ops reading it whiff. Constant for the run and carried across parks.
   */
  sourceUid?: string;
  /**
   * The printed "that Pokémon": the body the watched action was just performed on, set only by
   * `runWatchedTriggers`. Distinct from `sourceUid` (the body the effect belongs to) and `seat`
   * (the controller); on every such card they are on opposite seats.
   */
  subjectUid?: string;
  /**
   * What invoked this program, when that changes a rule: `"attack"` from attack.ts, `"ability"` for
   * a Pokémon Ability, or the Trainer type for a played Trainer (Item vs Supporter matters to some
   * shields). Absent otherwise. Lives on the context because several ops must answer the same rule
   * question identically.
   */
  invokedBy?: "attack" | "item" | "supporter" | "ability";
  /**
   * Damage this attack dealt to the opponent's Active ("the same amount of damage you did to your
   * opponent's Active Pokémon"). Set by attack.ts alongside `invokedBy: "attack"`, always a number
   * there (0 if nothing was dealt), and absent for every other program. It lives on the context
   * rather than `EffectRecord` because it is a fixed HP figure, not an accumulating uid list.
   */
  dealt?: number;
  /**
   * The played Trainer card's own uid ("this Caretaker"), set by `playTrainer`; the card is already
   * in the discard pile. Not `sourceUid`, which names a Pokémon.
   */
  playedUid?: string;
  /**
   * Name of the declared attack-menu row when it is not printed on the top card (Memory Dive or a
   * Technical Machine). Lets `preventAttackUse` bind to the attack by name.
   */
  borrowedAttack?: string;
  /**
   * The printed "the Attacking Pokémon": the attacker's uid as of declaration, set by
   * `runDamagedTrigger`. Not the attacker seat's Active, because the attack's own program may have
   * switched the attacker to the Bench.
   */
  attackerUid?: string;
}

/** A specific in-play Pokémon, addressed by the board it sits on and the spot.
    The one shape a targeting decision resolves to (own bench, opponent bench,
    own Active — the interpreter validates the ref against the live board). */
export interface PokemonRef {
  seat: Seat;
  spot: PokemonTarget;
}

/** What a parked op is asking the controller to decide. `note` is a short
    human string for the prompt UI / log; the arrays are the legal options
    (a client that offers anything else is rejected by resolveEffect). */
export type EffectPrompt =
  /**
   * Pick `min`..`max` card uids to move to `dest`. `dest` is display metadata; the op owns the
   * move. `min: 0` is the printed "up to" (declinable); `min === max` is a mandatory exact pick.
   * `lookAtTopN` clamps `min` to the candidate count since a short deck can make the floor
   * unanswerable; `max` needs no clamp.
   */
  | {
      kind: "chooseCards";
      candidates: string[];
      min: number;
      max: number;
      /**
       * Where the picked cards go, as stated by the engine. `"deck"` means shuffled in, distinct
       * from `"deckBottom"` and `"deckTop"`. `"evolve"`, `"attach"` and `"swap"` put the card onto
       * or in place of a body, which the op re-derives rather than reading from the wire. `"name"`,
       * `"use"` and `"reveal"` move nothing. Widening this union widens the wire enum, so deploy
       * the client first.
       */
      dest:
        | "bench"
        | "hand"
        | "deck"
        | "deckBottom"
        | "deckTop"
        | "discard"
        | "evolve"
        | "attach"
        | "swap"
        | "name"
        | "use"
        | "reveal";
      /**
       * Per-kind caps over the same candidate list ("a Pokémon and a Trainer card"). Each entry
       * caps picks from its `uids`; `max` stays the total. Lives on the prompt because
       * `validateChoice` checks answers against the prompt only. Absent means the total is the only
       * limit.
       */
      caps?: readonly { uids: readonly string[]; max: number }[];
      /**
       * Disjunctive caps ("up to 2 Basic Pokémon or 1 Evolution Pokémon"): an answer is legal only
       * if every pick lies in one entry's `uids` within that entry's `max`. Kept separate from the
       * conjunctive `caps`. The empty answer stays legal.
       */
      capsAnyOf?: readonly { uids: readonly string[]; max: number }[];
      note: string;
    }
  /**
   * Pick exactly one in-play Pokémon, and, when `upTo` is set, how many of the moved thing to take,
   * from zero to `upTo`. Absent `upTo` is a mandatory pick, forced at one candidate. `upTo` is not
   * clamped to what is available, so the prompt matches its note; with a ceiling the prompt parks
   * even at one candidate because declining is still a choice. For "any number" effects `upTo` is
   * the live budget. `takeVerb` captions the quantity (absent means attach).
   */
  | {
      kind: "choosePokemon";
      candidates: PokemonRef[];
      upTo?: number;
      takeVerb?: "move" | "put";
      note: string;
    }
  /**
   * Pick `min`..`max` in-play Pokémon as a set. The printed number is exact unless the card says
   * "up to" (`min: 0`). `declinable` is the printed "you may": all-or-nothing, so the legal answers
   * are `min..max` plus the empty set.
   */
  | {
      kind: "choosePokemonMulti";
      candidates: PokemonRef[];
      min: number;
      max: number;
      declinable: boolean;
      note: string;
    }
  /**
   * Move up to `max` Energy from one source to one destination (Energy Switch). Refs carry absolute
   * seats, so opponent-board variants need no extra field; the controller answers (§9.4).
   * `anySource` and `anyDest` relax the single-source and single-destination couplings, and `min`
   * makes the move mandatory ("Move all Energy"). These live on the prompt because the validator
   * and dialogs read only the prompt; absent keys keep the old meaning.
   */
  | {
      kind: "moveEnergy";
      movable: { uid: string; from: PokemonRef }[];
      destinations: PokemonRef[];
      max: number;
      min?: number;
      anySource?: true;
      anyDest?: true;
      note: string;
    }
  /**
   * Discard Energy off the board. `scope` is either exactly `count` uids total or one uid from
   * every distinct host. Mandatory; the op parks only when a real choice exists, with candidates
   * collapsed to at most `count` per interchangeable class.
   */
  | {
      kind: "discardEnergy";
      discardable: { uid: string; from: PokemonRef }[];
      scope: DiscardScope;
      note: string;
    }
  /**
   * Discard Pokémon Tools off the opponent's board; same shape as `discardEnergy`. A separate kind
   * so an answer's uids unambiguously name Tools, not Energy. `chooseCards` cannot carry it because
   * its candidates have no host. `scope` is `upTo` with `max` clamped to the offer.
   */
  | {
      kind: "discardTools";
      discardable: { uid: string; from: PokemonRef }[];
      scope: DiscardScope;
      note: string;
    }
  /**
   * Attach cards from the controller's deck (top N or a search) to their own Pokémon. The answer is
   * a map: each card names its own destination. Candidates are hidden information shown only to the
   * controller. `maxPerTarget` caps cards per target ("for each of those Pokémon"); `oneTarget`
   * requires all cards on one target ("attach them to 1 of your Pokémon"). Enforced by the
   * validator in cardplay.ts. Declinable.
   */
  | {
      kind: "attachCards";
      candidates: string[];
      targets: PokemonRef[];
      max: number;
      maxPerTarget?: number;
      oneTarget?: true;
      note: string;
    }
  /**
   * Yes/no: the answering seat may draw `count` cards (Ortega). Answered by the opponent, not the
   * controller. Parked only when the deck can supply a card.
   */
  | { kind: "mayDraw"; count: number; note: string }
  /**
   * Tyme's guess, answered by the opponent, who sees only the named card's name. The answer is an
   * `hpGuess`.
   */
  | { kind: "guessHp"; name: string; note: string }
  /**
   * §8/§11 Pick one of another Pokémon's attacks to bar for its next turn. The answer is an index,
   * since an attack has no uid; for the mid-attack copy park it indexes the op's flattened
   * candidate list instead. The prompt carries attack names because the client has no attack rows
   * for the opponent's Active. Never empty or a singleton.
   */
  | { kind: "chooseAttack"; candidates: { index: number; name: string }[]; note: string }
  /**
   * Pick one face-down Prize to turn face up (Cresselia "Crescent Purge", or the opponent's row for
   * Bother-Bot). `indices` are face-down slots only, with no uid, so a hidden card cannot be
   * tracked. Mandatory and never a singleton.
   */
  | { kind: "choosePrize"; indices: number[]; note: string }
  /**
   * The printed "You may ...": a yes/no answered by the controller whose "yes" splices the
   * `optional` op's `then` into the program. Kept separate from `mayDraw`, whose answer moves
   * cards. `labels` gives button captions for printed "Choose 1:" choices.
   */
  | {
      kind: "confirm";
      note: string;
      labels?: { yes: string; no: string };
      cards?: { yes: string; no?: string };
      targets?: PokemonRef[];
    }
  /**
   * Reorder cards: `candidates` are in current deck order (index 0 is the top), and the answer is a
   * permutation whose order becomes the new order. A separate kind because the answer's positions
   * matter. Not declinable; never parked with fewer than 2 candidates. Candidates may be the other
   * seat's hidden cards, so they go only to the answerer. `alt` is a printed alternative ("or
   * shuffle them and put them on the bottom"), chosen by answering with an empty ordering.
   */
  | { kind: "orderCards"; candidates: string[]; note: string; alt?: string };

/** How many Energy a parked `discardEnergy` is asking for — a total across the
    whole offer, or one from each Pokémon it offered. Named (rather than inlined)
    because validateChoice and the HUD dialog both branch on it. */
export type DiscardScope =
  | { kind: "total"; count: number }
  | { kind: "each" }
  /** "You may discard ANY amount" (Chien-Pao ex "Hail Blade"): 0 up to `max`
      (every offered Energy), DECLINABLE — the one discard scope whose answer may
      be empty, and whose count the player sets. The prompt offers each Energy
      distinctly (no interchangeable collapse) because the COUNT is what the
      damage reads. */
  | { kind: "upTo"; max: number };

/** The controller's answer, off the resolveEffect action (wire-checked there). */
export type EffectChoice =
  | { kind: "cards"; uids: string[] }
  /**
   * The `choosePokemon` answer. An absent `ref` is a decline, accepted only on an `upTo` prompt.
   * `take` is the chosen quantity, 1..upTo; absent means all of it. `take: 0` is refused because
   * the decline is spelled as an absent ref.
   */
  | { kind: "pokemon"; ref?: PokemonRef; take?: number }
  | { kind: "pokemonMulti"; refs: PokemonRef[] }
  /**
   * The moveEnergy answer: each picked Energy paired with its destination. `validateChoice` checks
   * every uid was offered and taken once, every destination was offered, nothing lands on its own
   * source, and, unless `anySource`/`anyDest`, one source and one destination overall. Empty
   * `picks` is a decline, refused when the prompt has `min`.
   */
  | { kind: "moveEnergy"; picks: { uid: string; dest: PokemonRef }[] }
  /** The discardEnergy answer: the Energy uids to discard — exactly `count` in
      total (`{kind:"total"}`) or exactly one per offered source Pokémon
      (`{kind:"each"}`), as validateChoice enforces. Never empty for those two
      MANDATORY scopes; the `{kind:"upTo"}` scope (Hail Blade's "any amount") is
      the one that MAY answer empty (a decline of the whole discard). */
  | { kind: "discardEnergy"; uids: string[] }
  /** The `discardTools` answer. Empty is the legal decline of "up to". */
  | { kind: "discardTools"; uids: string[] }
  /** The attachCards answer: each card to attach paired with the Pokémon it goes
      on — "in any way you like", so the pairing IS the decision. Every uid was
      offered and appears once (one physical card cannot land on two Pokémon), and
      every `to` is an offered target, as validateChoice enforces. An empty list is
      a legal decline. */
  | { kind: "attachCards"; assignments: { uid: string; to: PokemonRef }[] }
  /** The mayDraw answer — `draw: true` takes the cards, `false` is the printed
      decline. A plain boolean (wire-checked to be one: a P4 client's truthy
      string must not read as consent), answered by the phase's `answerer`. */
  | { kind: "mayDraw"; draw: boolean }
  /**
   * The `guessHp` answer: the guessed HP, an integer ≥ 0, answered by the controller's opponent.
   */
  | { kind: "hpGuess"; hp: number }
  /**
   * The chooseAttack answer: the index of the barred attack, validated to be one the prompt
   * offered.
   */
  | { kind: "attack"; index: number }
  /**
   * The `choosePrize` answer: one face-down slot index of the row the op names, validated to be an
   * offered integer.
   */
  | { kind: "prize"; index: number }
  /** The `confirm` answer — `yes: true` splices the `optional` op's `then` ahead
      of the rest of the program, `false` runs nothing. A plain boolean, and
      wire-checked to be one for `mayDraw`'s exact reason: a P4 client's truthy
      string must not read as consent. Answered by the CONTROLLER. */
  | { kind: "confirm"; yes: boolean; target?: PokemonRef }
  /**
   * The `orderCards` answer: the offered uids re-sequenced, index 0 the new top. `validateChoice`
   * requires a permutation, so a crafted frame cannot drop, duplicate or add cards.
   */
  | { kind: "orderCards"; uids: string[] };

/**
 * What earlier ops in this program recorded for later ones: each recording op's moved uids under
 * its `EffectSlot` (§9.2 "in this way", "if you do"). A mutable accumulator carried across parks,
 * kept off `EffectContext` because the context is fixed for the run.
 */
export type EffectRecord = { [K in EffectSlot]?: string[] };

/** The JSON continuation stored in the effect:choose phase: the op awaiting a
    choice, the ops after it, the context, and what earlier ops recorded.
    Replaying `applyChoice(pendingOp) → runProgram(rest)` resumes exactly where
    it parked. `record` is absent when nothing has been recorded, so every
    program in the vocabulary that predates §9.2 stores a byte-identical phase. */
export interface EffectContinuation {
  pendingOp: EffectOp;
  rest: EffectOp[];
  ctx: EffectContext;
  record?: EffectRecord;
}

export type RunResult =
  | { kind: "done"; state: GameState }
  | {
      kind: "parked";
      state: GameState;
      prompt: EffectPrompt;
      cont: EffectContinuation;
      /**
       * The seat that must answer when it is not the controller; absent otherwise.
       * `opponentDiscardsFromHand` uses it over the answerer's hidden hand, so the gate must keep
       * those candidates off the other seat's wire.
       */
      decider?: Seat;
    };

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
  events: GameEvent[],
  /** What earlier ops recorded (§9.2). Every caller but `resumeProgram` starts a
      program from the top, where nothing has run yet — hence the default, which
      is also what keeps this widening invisible to attack.ts / cardplay.ts /
      triggers.ts / flow.ts. Mutated in place as the run proceeds, like `events`. */
  record: EffectRecord = {},
): RunResult {
  let next = state;
  const queue: EffectOp[] = [...program];
  while (queue.length > 0) {
    const op = queue.shift() as EffectOp;
    if (op.op === "coinFlipGate") {
      // `coins` is the printed count, default one. Every flip is taken and announced before any
      // branch is consulted, so `rngState` advances identically on every outcome and the log shows
      // each coin.
      let faces: readonly CoinFace[] = [];
      let rngState = next.rngState;
      // Backtrack Badge "keep": reuse the declined faces in `op.faces`; no new flip and no row.
      const kept = op.faces;
      for (let flip = 0; kept === undefined && flip < (op.coins ?? 1); flip += 1) {
        const [drawn, advanced] = flipCoin(rngState);
        faces = [...faces, drawn];
        rngState = advanced;
      }
      next = { ...next, rngState };
      for (const drawn of faces) {
        events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat: ctx.seat, result: drawn });
      }
      if (kept !== undefined) faces = kept;
      // A live Backtrack Badge parks its re-flip offer before the branch is chosen.
      const redo = kept === undefined ? coinRedoOffer(next, ctx, faces) : null;
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
    const stepped = stepOp(next, live, ctx, events, record);
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
function atLeastOneDecline(
  state: GameState,
  op: EffectOp,
  queue: readonly EffectOp[],
  ctx: EffectContext,
  record: EffectRecord,
): EffectOp {
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

/** The uids filed under `slot`, or none. */
function recorded(record: EffectRecord, slot: EffectSlot): readonly string[] {
  return record[slot] ?? [];
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
      matchesFilter(cardOf(state, uid), op.filter) &&
      (op.dest === "bench" || !discardPileLockedOf(cardOf(state, uid))) &&
      (op.dest !== "bench" || benchMatches(cardOf(state, uid), op.filter)),
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

/** File `uids` under `slot`, if the op asked for it. Always a FRESH array: the
    record a park stored lives inside `GameState` (the phase's continuation), and
    a resumed run seeds its accumulator from it — so writes must replace entries,
    never mutate the arrays behind them. */
function recordMoved(
  record: EffectRecord,
  slot: EffectSlot | undefined,
  uids: readonly string[],
): void {
  if (slot !== undefined) record[slot] = [...uids];
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
  const offer = evolveFromDeckOffer(before, cont.ctx, op.onto, op.names, op.noAbilities);
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
    const found = cardOf(state, uid);
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
      (evolveFromDeckOffer(state, ctx, ref.spot, undefined, noAbilities)?.candidates.length ?? 0) >
      0
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
  if (
    op.op === "healChosen" &&
    (op.discardEnergyFromHealed === true ||
      op.recoverHealed === true ||
      op.energyToHandFromHealed === true)
  ) {
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
    applyChoice(state, cont.pendingOp, choice, cont.ctx, events, record),
    events,
  );
  // The answer's continuation ops are spliced ahead of the rest here, the only place holding both
  // the applied state and the remaining ops.
  const rest = [...continuationOps(cont, choice, state), ...cont.rest];
  return runProgram(applied, rest, cont.ctx, events, record);
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

function stepOp(
  state: GameState,
  op: EffectOp,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): { done: GameState; schedule?: EffectOp[] } | { park: EffectPrompt; decider?: Seat } {
  // Patrat "Watchful Eye": while a holder is in play, a counter move whiffs.
  if (isCounterMoveOp(op) && countersMoveLocked(state)) return { done: state };
  switch (op.op) {
    case "applyStatus":
      return { done: applyStatus(state, op, ctx, events) };
    case "clearStatus":
      return { done: clearStatus(state, ctx, events, op.only) };
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
      if (second === undefined) return { done: clearStatus(state, ctx, events, first) };
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
      return { done: flipLockAttack(state, ctx, events, op.coins) };
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
          events,
          op.holder,
          op.thisTurn,
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
      return { done: retypeDefenderWeakness(state, op.type, ctx, events, op.asTimesTwo === true) };
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
      return { done: countersOnRecordedBody(state, op, ctx, events, record) };
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
        return { done: damageSourceBody(state, op.amount, ctx, events, op.source) };
      return { done: damageSelf(state, recoilAmount(op, state, ctx), ctx, events, op.source) };
    case "damageDefender": {
      // Chien-Pao ex "Hail Blade": `per` damage per card filed under `count`, through the full §8.5
      // pipeline. Flat `amount` is the "you may do N more damage" arm. Zero places nothing.
      const amount =
        op.amount ?? (op.base ?? 0) + scoredSlot(record, state, op.count, op.countFilter) * op.per;
      if (amount <= 0) return { done: state };
      return { done: snipeActive(state, amount, false, ctx, events) };
    }
    case "damageNewActive":
      // "This attack does N damage to the new Active Pokémon": `snipeActive` reads the Active after
      // the earlier promotion, with the full §8.5 pipeline.
      return { done: snipeActive(state, op.amount, false, ctx, events) };
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
          let next = state;
          for (const ref of candidates) {
            next = placeSnipe(
              next,
              [ref],
              snipeAmount(op, next, ctx, record, ref),
              op.deals === true,
              op.ignoreWR === true,
              op.source,
              ctx,
              events,
              op.wrOnly === true,
            );
          }
          return { done: next };
        }
        // Nullifying Zero: one coin per candidate, all coins before any damage; heads targets take
        // the hit together.
        if (op.flipEach === true) {
          const [flipped, faces] =
            op.faces === undefined
              ? flipCoinsFor(state, candidates.length, ctx, events)
              : [state, op.faces];
          // A live Backtrack Badge offers after the coins, before any damage.
          const redo = op.faces === undefined ? coinRedoOffer(flipped, ctx, faces) : null;
          if (redo !== null)
            return {
              done: flipped,
              schedule: [{ op: "reflipCoins", toolUid: redo, faces, retry: op }],
            };
          const hit = candidates.filter((_, index) => faces[index] === "heads");
          return {
            done: placeSnipe(
              flipped,
              hit,
              amount,
              op.deals === true,
              op.ignoreWR === true,
              op.source,
              ctx,
              events,
              op.wrOnly === true,
            ),
          };
        }
        // Target Together with one candidate: the pick is forced, then the coins.
        if (op.perHeadsInPlay !== undefined) {
          return perHeadsHit(state, op, op.perHeadsInPlay, candidates, amount, ctx, events);
        }
        return {
          done: placeSnipe(
            state,
            candidates,
            amount,
            op.deals === true,
            op.ignoreWR === true,
            op.source,
            ctx,
            events,
            op.wrOnly === true,
          ),
        };
      }
      return {
        park: {
          kind: "choosePokemonMulti",
          candidates,
          min: take,
          max: take,
          declinable,
          note: snipeNote(
            amount,
            take,
            declinable,
            op.deals === true,
            op.target,
            op.damagedOnly === true,
            op.filter,
            op.perDamageCounterOnTarget === true,
            op.perHeadsInPlay !== undefined,
            op.specialEnergyOnly === true,
          ),
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
        done = drawToHand(done, drawSeat, count, "effect", events, op.from ?? "top");
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
        op.dest !== "bench" || benchMatches(cardOf(state, uid), filter);
      const groupMatches = (filter: CardFilter) =>
        state.players[ctx.seat].deck.filter(
          (uid) => matchesFilter(cardOf(state, uid), filter) && onBench(uid, filter),
        );
      // The union is taken in DECK ORDER off the deck itself, one pass, so a uid
      // matching two filters appears exactly once in the offer — the caps below
      // are what make it count against both (effects.ts states the rule).
      const candidates = state.players[ctx.seat].deck
        .filter((uid) => groups.some((g) => matchesFilter(cardOf(state, uid), g.filter)))
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
          const card = cardOf(state, uid);
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
          note: searchNote(
            printedGroups,
            op.dest,
            max,
            op.exact === true,
            op.distinctEnergyTypes === true,
            op.typedAsAttachedBasicEnergy === true,
          ),
          // Love Ball's caption carries its printed rule.
          ...(op.sameNameAsOpponentInPlay === true
            ? {
                note: searchNote(
                  printedGroups,
                  op.dest,
                  max,
                  op.exact === true,
                  op.distinctEnergyTypes === true,
                  op.typedAsAttachedBasicEnergy === true,
                  true,
                ),
              }
            : {}),
        },
      };
    }
    case "evolveFromDeck": {
      // "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon."
      // Candidates depend on the board, so this cannot be a `searchDeck` filter. "Up to" (`min:
      // 0`); `op.onto` is written only by the ops that schedule this one.
      if (op.fromHand === true) {
        const handOffer = evolveFromDeckOffer(state, ctx, undefined, undefined, undefined, true);
        const candidates = handOffer?.candidates ?? [];
        if (candidates.length <= 1) {
          const placed = evolveFromHandMove(state, candidates, ctx, events);
          recordMoved(record, op.recordAs, placed.moved);
          return { done: placed.state };
        }
        const note = `Choose a card in your hand that evolves from ${handOffer?.name} and put it onto ${handOffer?.name} to evolve it.`;
        return { park: { kind: "chooseCards", candidates, min: 1, max: 1, dest: "evolve", note } };
      }
      const offer = evolveFromDeckOffer(state, ctx, op.onto, op.names, op.noAbilities);
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
      const top = lookWindow(state.players[lookOwner(op, ctx)].deck, op);
      // A Bench destination uses `benchMatches` (Basic only unless the noun names the card).
      const matches = (uid: string, filter: CardFilter) =>
        op.dest === "bench"
          ? benchMatches(cardOf(state, uid), filter)
          : matchesFilter(cardOf(state, uid), filter);
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
        op.dest === "bench" ? Math.min(totalMax, benchSpace(state, lookOwner(op, ctx))) : totalMax;
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
      const owner = reorderTopOwner(ctx.seat, op);
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
        if (effectRefused(state, discardVictimSeat(ctx.seat, op), ctx, events)) {
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
      const bodies: PokemonRef[] = [];
      for (const entry of allDiscardable) {
        if (!bodies.some((ref) => refKeyOf(ref) === refKeyOf(entry.from))) bodies.push(entry.from);
      }
      const allowed = new Set(unshieldedRefs(state, bodies, ctx, events).map(refKeyOf));
      const unreserved = allDiscardable.filter((entry) => allowed.has(refKeyOf(entry.from)));
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
      const bodies: PokemonRef[] = [];
      for (const entry of allDiscardable) {
        if (!bodies.some((ref) => refKeyOf(ref) === refKeyOf(entry.from))) bodies.push(entry.from);
      }
      const allowed = new Set(unshieldedRefs(state, bodies, ctx, events).map(refKeyOf));
      const discardable = allDiscardable.filter((entry) => allowed.has(refKeyOf(entry.from)));
      // Zero offers is a silent no-op: no park, no event, no log row.
      if (discardable.length === 0) return { done: state };
      // A mandatory discard (no "up to") with an offer no bigger than the count resolves inline;
      // otherwise it parks for an exact total (Multi Adapter bodies can carry two Tools).
      if (op.bodyUid !== undefined && op.count !== "all" && discardable.length <= op.count) {
        return {
          done: toolDiscardApply(
            state,
            discardable.map((entry) => entry.uid),
            ctx,
            events,
          ).state,
        };
      }
      if (op.bodyUid !== undefined && op.count !== "all") {
        return {
          park: {
            kind: "discardTools",
            discardable,
            scope: { kind: "total", count: op.count },
            note: `Discard ${op.count === 1 ? "a Pokémon Tool" : `${op.count} Pokémon Tools`} from that Pokémon.`,
          },
        };
      }
      // Megaton Blower's "all": no question, every unshielded Tool is discarded, each to its
      // owner's pile.
      if (op.count === "all") {
        return {
          done: toolDiscardApply(
            state,
            discardable.map((entry) => entry.uid),
            ctx,
            events,
          ).state,
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
      return turnPrizeFaceUp(state, op, ctx, events, record);
    case "cycleOwnPrizes":
      return { done: cycleOwnPrizes(state, ctx, events) };
    // Bother-Bot's switch reads the two recorded uids and never parks.
    case "swapTurnedPrizeWithRevealed":
      return { done: swapTurnedPrizeWithRevealed(state, ctx, events, record) };
    case "revealFromHand": {
      // Weaponized Swords: any non-empty offer parks since each count gives different damage; no
      // collapse. An empty offer files `[]`.
      const candidates = state.players[ctx.seat].hand.filter((uid) =>
        matchesFilter(cardOf(state, uid), op.filter),
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
        const moved = bottomFromOpponentHandApply(state, candidates, ctx, events, op.dest);
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
        return { done: randomFromOpponentHand(state, op, ctx, events, record) };
      // Hand Trim: the take is read off the opponent's hand once, then each card is its own random
      // draw.
      return { done: randomDiscardDownTo(state, op, op.untilHandSize, ctx, events, record) };
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
        matchesFilter(cardOf(state, uid), op.filter),
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
      const card = cardOf(state, op.uid);
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
        (ref) => switchRecording(op, (into) => switchOwn(state, ref, ctx, into), events, record),
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
        (ref) => switchRecording(op, (into) => gust(state, ref, ctx, into), events, record),
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
        (ref) => switchRecording(op, (into) => gust(state, ref, ctx, into), events, record),
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
      if (
        (op.discardEnergyFromHealed === true ||
          op.recoverHealed === true ||
          op.energyToHandFromHealed === true) &&
        candidates.length === 1
      ) {
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
              events,
              record,
              op.pickOnto.take,
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
            (soFar, ref) => attachEnergyFrom(soFar, op, ref, ctx, events, record),
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
        (ref) => attachEnergyFrom(state, op, ref, ctx, events, record),
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
    // All three gates are spliced by runProgram's queue loop (never reach here).
    case "coinFlipGate":
    case "conditionGate":
    case "recordGate":
      return { done: state };
  }
}

/** Evaluate a `BoardCondition` for `seat` — PURE, and reading only PUBLIC state
    (Prize counts, the Stadium zone's owner, Energy sitting face up), so the
    answer is one the opponent could derive too. The single evaluator behind all
    three consumers: the `conditionGate` op above, the printed play gate
    playTrainer checks before the card leaves hand (cardplay.ts `playableIf`),
    and the HUD, which greys out a card whose condition is unmet rather than
    offering a button that can only reject. */
export function conditionHolds(state: GameState, seat: Seat, cond: BoardCondition): boolean {
  switch (cond.kind) {
    case "morePrizesThanOpponent":
      return state.players[seat].prizes.length > state.players[otherSeat(seat)].prizes.length;
    case "yourStadiumInPlay":
      // §7.3 — presence is not enough; the Stadium must be the one YOU played.
      return state.stadium !== null && state.stadium.owner === seat;
    case "opponentStadiumInPlay":
      // The arm above from the other seat (Scorching Earth).
      return state.stadium !== null && state.stadium.owner === otherSeat(seat);
    case "stadiumInPlay":
      // "A Stadium is in play": the arm above without the owner test, since the Stadium zone is
      // shared.
      return state.stadium !== null;
    case "noEnergyOnYourPokemon": {
      const side = state.players[seat];
      return [side.active, ...side.bench].every((p) => p === null || p.energy.length === 0);
    }
    case "opponentActiveDamaged": {
      // "your opponent's Active Pokémon ALREADY has any damage counters on it" —
      // the OPPONENT of `seat` (this is the one cross-board member of the
      // vocabulary). Damage is HP on the model, so "any counters" is `> 0`; the
      // "already" is a TIMING word the caller honours by asking at declaration,
      // not something this predicate can enforce.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && active.damage > 0;
    }
    case "opponentActiveIsEvolution": {
      // Evolution means `evolveFromOf` is non-null. An empty Active Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && evolveFromOf(spot.card) !== null;
    }
    case "opponentActiveIsBasic": {
      // Reuses `isBasicPokemon` so there is one reading of "Basic". Read off the top card; an empty
      // Active Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isBasicPokemon(spot.card);
    }
    case "opponentActiveIsStage1": {
      // Stage 1 via `isStage1Pokemon`, not "is evolved", which would also match Stage 2, VSTAR and
      // VMAX. Read off the top card; an empty Active Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isStage1Pokemon(spot.card);
    }
    case "opponentActiveIsStage2": {
      // Stage 2 via `isStage2Pokemon`. Read off the top card; an empty Active Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isStage2Pokemon(spot.card);
    }
    case "yourActiveDamaged": {
      // "This Pokémon has any damage counters on it", resolved to your Active by the clause table.
      // Read at declaration, so it is the damage the attacker walked in with.
      const active = state.players[seat].active;
      return active !== null && active.damage > 0;
    }
    case "yourActiveUndamaged": {
      // Not written as the negation of `yourActiveDamaged`, which would make an empty Active Spot
      // count as undamaged.
      const active = state.players[seat].active;
      return active !== null && active.damage === 0;
    }
    case "yourBenchDamaged":
      // "your Benched Pokémon have any damage counters on them" — the plural is
      // collective, so ANY one damaged benched Pokémon satisfies it. The Active is
      // deliberately not consulted, and an empty Bench is false rather than
      // vacuously true (nothing there is carrying counters).
      return state.players[seat].bench.some((p) => p !== null && p.damage > 0);
    case "yourBenchAllDamaged": {
      // "All of your Benched Pokémon" is false on an empty Bench (no vacuous truth); a wrong true
      // would pay the bonus on common boards.
      const bench = state.players[seat].bench;
      return bench.length > 0 && bench.every((p) => p !== null && p.damage > 0);
    }
    case "yourBenchNamedDamaged":
      // Damage and name are tested on the same body. The name is read from the top card, so an
      // evolved body no longer matches. An empty Bench is false.
      return state.players[seat].bench.some(
        (p) => p !== null && p.damage > 0 && topCardOf(state, p)?.name === cond.name,
      );
    case "opponentActivePoisoned": {
      // §12 — Poison is stored as the counter amount an effect may raise, so
      // "is Poisoned" is `> 0`, exactly as the Checkup reads it (flow.ts).
      const active = state.players[otherSeat(seat)].active;
      return active !== null && active.conditions.poisonDamage > 0;
    }
    case "opponentActiveHasSpecialCondition": {
      // §12 — ANY condition: the rotation slot, Poison or Burn. `presentStatuses`
      // is the same list the status chips and STATUS_CLEARED events are built
      // from, so "affected" cannot drift from what the board shows.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && presentStatuses(active.conditions).length > 0;
    }
    case "yourActiveHasSpecialCondition": {
      // Self version of the arm above: "If this Pokémon is affected by a Special Condition".
      const active = state.players[seat].active;
      return active !== null && presentStatuses(active.conditions).length > 0;
    }
    case "yourActivePoisoned": {
      // "This Pokémon is Poisoned" (Okidogi ex), resolved to your Active by the clause table.
      const active = state.players[seat].active;
      return active !== null && active.conditions.poisonDamage > 0;
    }
    case "yourActiveBurnedOrPoisoned": {
      // "If this Pokémon is Burned or Poisoned" (Larry's Staraptor): either alone holds.
      const active = state.players[seat].active;
      if (active === null) return false;
      const present = presentStatuses(active.conditions);
      return present.includes("burned") || present.includes("poisoned");
    }
    case "yourActiveAsleep": {
      // Snorlax "Good Sleep": "If this Pokémon remains Asleep".
      const active = state.players[seat].active;
      return active !== null && presentStatuses(active.conditions).includes("asleep");
    }
    case "opponentActiveBurned": {
      // Reads `presentStatuses`, not the raw `conditions.burned`, so Burned always implies affected
      // by a Special Condition.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && presentStatuses(active.conditions).includes("burned");
    }
    case "opponentActiveConfused": {
      // Not `isImmobilized`, which excludes Confused, and not `rotation !== "none"`, which would
      // include Asleep.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && presentStatuses(active.conditions).includes("confused");
    }
    case "opponentActiveIsExOrV": {
      // ex or V only, not VMAX/VSTAR/GX. An empty Active Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isExOrV(spot.card);
    }
    case "opponentActiveIsEx": {
      // ex only: false for a Pokémon V, unlike `opponentActiveIsExOrV`. An empty Active Spot is
      // false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && pokemonSuffixOf(spot.card) === "ex";
    }
    case "yourActiveHasEnergyAttached": {
      // Types are read by provision via continuous.ts, matching the §8.2 cost check. False with an
      // empty Active Spot.
      const active = state.players[seat].active;
      return active !== null && hasAttachedEnergy(state, active, cond.energy);
    }
    case "opponentActiveHasEnergyAttached": {
      // Seat mirror of the arm above. Types read by provision; false with an empty Active Spot.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && hasAttachedEnergy(state, active, cond.energy);
    }
    case "yourActiveHasNamedEnergyAttached": {
      // Matches attached Energy by printed name, not provision, folding the card name like the
      // stored clause. An unresolvable uid is false.
      const active = state.players[seat].active;
      if (active === null) return false;
      return active.energy.some((uid) => {
        const card = cardOfUid(state, uid);
        return card !== undefined && foldApostrophes(card.name) === cond.name;
      });
    }
    case "yourBenchHasNamedEnergyAttached":
      // Zarude "Shadowy Whip": the arm above over your Benched Pokémon only.
      return state.players[seat].bench.some((p) =>
        p.energy.some((uid) => {
          const attached = cardOfUid(state, uid);
          return attached !== undefined && foldApostrophes(attached.name) === cond.name;
        }),
      );
    case "opponentPrizesRemaining":
      // The printed "exactly" makes this set membership. Face-up prizes still count.
      return cond.counts.includes(state.players[otherSeat(seat)].prizes.length);
    case "yourPrizesRemaining":
      // Seat mirror of the arm above.
      return cond.counts.includes(state.players[seat].prizes.length);
    case "opponentHandAtMost":
      // The SIZE of their hand, never its contents — the line the union's
      // public-state invariant draws, and the reason this survives P4 redaction
      // (the wire ships face-down backs with a real length).
      return state.players[otherSeat(seat)].hand.length <= cond.count;
    case "handSizesEqual":
      // Seat-symmetric: equality commutes. Sizes only.
      return state.players[seat].hand.length === state.players[otherSeat(seat)].hand.length;
    case "yourHandExactly":
      // "You don't have exactly 3 cards in your hand" read positive: the attacker's own hand,
      // strict equality. Sizes only.
      return state.players[seat].hand.length === cond.count;
    case "yourHandAtLeast":
      // "If you have 10 or more cards in your hand": read at the gate, after the program's first
      // draw and after the Supporter left the hand.
      return state.players[seat].hand.length >= cond.count;
    case "yourHandNotEmpty":
      // Payability of "You may discard your hand": `> 0`, since an empty hand cannot pay and must
      // not earn the bonus.
      return state.players[seat].hand.length > 0;
    case "yourFaceDownPrizeRemains": {
      // Payability of Crescent Purge's cost: some prize must still be face down; a row whose prizes
      // are all face up cannot pay.
      const side = state.players[seat];
      return side.prizes.some((uid) => !side.faceUpPrizes.includes(uid));
    }
    case "yourDeckAtMost":
      // The size of your own deck, which is public. `<=`, so an empty deck is true: deck-out is
      // only checked at the draw step.
      return state.players[seat].deck.length <= cond.count;
    case "yourDeckNotEmpty":
      // Naveen's gate: the complement of `yourDeckAtMost 0`.
      return state.players[seat].deck.length > 0;
    case "yourActiveEnergyAtLeast": {
      // Counts Energy cards, not units. An optional `energy` type filters the count (Abomasnow
      // "Frozen Wood"). False with an empty Active Spot.
      const own = state.players[seat].active;
      return own !== null && countAttachedEnergy(state, own, cond.energy ?? null) >= cond.count;
    }
    case "activeEnergyCountsEqual": {
      // Counts Energy cards on the two Active Pokémon only, not the Bench. False when either Active
      // Spot is empty.
      const own = state.players[seat].active;
      const theirs = state.players[otherSeat(seat)].active;
      return (
        own !== null &&
        theirs !== null &&
        countAttachedEnergy(state, own, null) === countAttachedEnergy(state, theirs, null)
      );
    }
    case "moreActiveEnergyThanOpponent": {
      // Strictly more, attacker on the left. False when either Active Spot is empty; treating a
      // missing defender as zero would arm the clause.
      const own = state.players[seat].active;
      const theirs = state.players[otherSeat(seat)].active;
      return (
        own !== null &&
        theirs !== null &&
        countAttachedEnergy(state, own, null) > countAttachedEnergy(state, theirs, null)
      );
    }
    case "opponentActiveHasType": {
      // The same read Weakness and Resistance make two lines later in the §8.5
      // pipeline (`cards.ts` `weaknessOf`), so a printed type cannot mean one
      // thing to this clause and another to the multiplier it feeds. `types` is
      // null on Trainers and Energy, hence the `?? []`. Empty Active Spot is
      // FALSE, as with the two other card-reading members.
      const spot = activeTop(state, otherSeat(seat));
      // Reads in-play types (`inPlayCardOf`), so a retyped body counts.
      return (
        spot !== null &&
        ((inPlayCardOf(state, spot.active) ?? spot.card).types ?? []).includes(cond.type)
      );
    }
    case "yourActiveHasType": {
      // Dragon Elixir's "your Active {N} Pokémon": the arm above on your own seat.
      const spot = activeTop(state, seat);
      // Reads in-play types (`inPlayCardOf`).
      return (
        spot !== null &&
        ((inPlayCardOf(state, spot.active) ?? spot.card).types ?? []).includes(cond.type)
      );
    }
    case "opponentActiveHasResistance": {
      // Does not use `resistanceOf`, which only returns a Resistance that applies to the attacker's
      // types; this asks whether the defender has the Resistance at all. Matches on `type` alone.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && (spot.card.resistances ?? []).some((r) => r.type === cond.type);
    }
    case "opponentActiveRetreatCostAtLeast": {
      // Uses `effectiveRetreatCost`, not the printed cost, so Stadium and Ability modifiers apply.
      // `>=` for "or more". False with an empty Active Spot.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && effectiveRetreatCost(state, active) >= cond.count;
    }
    case "opponentActiveNoRetreatCost": {
      // Carnivine "Chomp Whole": the arm above's effective cost at zero.
      const foeActive = state.players[otherSeat(seat)].active;
      return foeActive !== null && effectiveRetreatCost(state, foeActive) === 0;
    }
    case "yourActiveWeakToOpponentActiveType": {
      // Adversity Policy: your Active's effective Weakness against the opponent's Active's in-play
      // types, applying the same rewrites as the §8.5 sites. False if either Spot is empty.
      const mine = state.players[seat].active;
      const theirs = state.players[otherSeat(seat)].active;
      if (mine === null || theirs === null) return false;
      if (seatRemovesWeakness(state, seat) || installedNoWeakness(state, mine)) return false;
      const holder = inPlayCardOf(state, mine);
      const attacker = inPlayCardOf(state, theirs);
      if (holder === undefined || attacker === undefined) return false;
      return (
        weaknessOf(
          attacker,
          holder,
          installedWeaknessRetypeOf(state, mine),
          // Overwriting Bolt's installed rewrite first.
          installedWeaknessRewriteOf(state, mine) ?? seatWeaknessRewrite(state, seat, holder),
        ) !== null
      );
    }
    case "yourBenchHasType":
      // Bench only: both printings are on Metal attackers, so including the Active would make the
      // bonus unconditional. Reads the in-play types of the top card.
      return state.players[seat].bench.some(
        // Reads in-play types (`inPlayCardOf`).
        (p) => p !== null && (inPlayCardOf(state, p)?.types ?? []).includes(cond.type),
      );
    case "yourBenchHasStage2OfType":
      // Sableye "Cocky Claw": the arm above and `isStage2Pokemon` on the same Benched body.
      return state.players[seat].bench.some((p) => {
        const benched = inPlayCardOf(state, p);
        return (
          benched !== undefined &&
          isStage2Pokemon(benched) &&
          (benched.types ?? []).includes(cond.type)
        );
      });
    case "opponentInPlayHasType":
      // "Your opponent has any {W} Pokémon in play": the opponent's Active and Bench only, never
      // your own side. Reads in-play types; nothing in play is false.
      return [
        state.players[otherSeat(seat)].active,
        ...state.players[otherSeat(seat)].bench,
        // Reads in-play types (`inPlayCardOf`).
      ].some((p) => p !== null && (inPlayCardOf(state, p)?.types ?? []).includes(cond.type));
    case "inPlayTypesIntersect": {
      // "Any of your Pokémon in play are the same type as any of your opponent's": both whole
      // boards, and any shared type counts. An empty side is false.
      const typesInPlay = (s: Seat): string[] => {
        const side = state.players[s];
        return [side.active, ...side.bench].flatMap((p) =>
          // Reads in-play types (`inPlayCardOf`).
          p === null ? [] : (inPlayCardOf(state, p)?.types ?? []),
        );
      };
      const theirs = new Set(typesInPlay(otherSeat(seat)));
      return typesInPlay(seat).some((type) => theirs.has(type));
    }
    case "yourBenchHasNamed":
      // Bench only — the printed word is "Bench", and the Active Spot is excluded
      // exactly as `yourBenchDamaged` excludes it. Bench slots are nullable and a
      // stack can outrun the catalog, so the name is read through `topCardOf`
      // (the stack TOP is the Pokémon's identity, §1.2: evolving a Falinks into
      // something else stops satisfying this, which is the right answer).
      return state.players[seat].bench.some(
        (p) => p !== null && topCardOf(state, p)?.name === cond.name,
      );
    case "yourBenchHasNameContaining":
      // Substring match, not prefix or equality: Team Rocket's Nidoqueen names "Nidoking",
      // satisfied by Team Rocket's Nidoking ex. Case-sensitive. An unresolvable card is false.
      return state.players[seat].bench.some(
        (p) => p !== null && (topCardOf(state, p)?.name.includes(cond.fragment) ?? false),
      );
    case "yourNamedPokemonInPlay": {
      // "In play" includes the Active Spot; keep this separate from the Bench-only arm, since
      // Falinks would otherwise satisfy its own clause. Read from the top card.
      const side = state.players[seat];
      return [side.active, ...side.bench].some(
        (p) => p !== null && topCardOf(state, p)?.name === cond.name,
      );
    }
    case "yourEnergyInPlayAtLeast":
      // Active + Bench, counting cards rather than units, `>=` for "at least".
      return countEnergyInPlay(state, seat, cond.energy) >= cond.count;
    case "yourBasicEnergyInDiscardAtLeast": {
      // A discarded Energy provides nothing, so count printed cards via `matchesFilter`, not
      // provision. `>=` for "or more".
      const filter: CardFilter = { kind: "basicEnergy", energyType: cond.energy };
      return countCardsInDiscardPile(state, seat, filter) >= cond.count;
    }
    case "yourBasicEnergyInHandAtLeast": {
      // The hand version of the arm above, using the same predicate `handCostCandidates` pays with,
      // so the gate and the payment agree.
      const handFilter: CardFilter = { kind: "basicEnergy", energyType: cond.energy };
      return countCardsInHand(state, seat, handFilter) >= cond.count;
    }
    case "yourActiveHasToolAttached": {
      // `> 0` rather than `=== 1`: some effects raise the one-Tool cap. False with an empty Active
      // Spot.
      const active = state.players[seat].active;
      return active !== null && active.tools.length > 0;
    }
    case "opponentActiveHasToolAttached": {
      // The opponent's Active version of the arm above. False with an empty Active Spot.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && active.tools.length > 0;
    }
    case "youPlayedSupporterThisTurn":
      // `state.allowances` belongs to the turn owner, so the seat must be the active seat from
      // `phaseViewOf` (never turn parity). Between turns this is false for both seats.
      return phaseViewOf(state, seat).activeSeat === seat && state.allowances.supporterPlayed;
    case "yourActivePromotedThisTurn": {
      // No seat guard needed: `promotedTurn` is stamped on the Pokémon and compared with the global
      // turn counter. A Knock Out promotion on the opponent's turn never matches the controller's
      // turn.
      const active = state.players[seat].active;
      return active !== null && active.promotedTurn === state.turn;
    }
    case "yourActiveHealedThisTurn": {
      // No seat guard, as above. Picnic Basket can stamp the opponent's Active, but that only reads
      // true during the turn it was healed.
      const active = state.players[seat].active;
      return active !== null && active.healedTurn === state.turn;
    }
    case "yourActiveEvolvedFromThisTurn": {
      // The card evolved from is one below the top of the stack (`stack[length - 2]`); a stack of
      // one gives undefined. Both the turn and name tests are needed.
      const active = state.players[seat].active;
      if (active === null || active.evolvedTurn !== state.turn) return false;
      const beneath = active.stack[active.stack.length - 2];
      return beneath !== undefined && cardOfUid(state, beneath)?.name === cond.name;
    }
    case "yourActiveUsedAttackLastTurn": {
      // Safe off-turn by parity: `state.turn - 2` matches only the same seat's previous turn, so
      // the non-turn seat reads false.
      const active = state.players[seat].active;
      return active !== null && usedAttackOnYourLastTurn(state, active, cond.attack);
    }
    case "yourPokemonUsedAttackLastTurn": {
      // "1 of your Pokémon": checks every in-play body. Reads the record on the body, not
      // `topCardOf`, so evolving keeps the history.
      const side = state.players[seat];
      return [side.active, ...side.bench].some(
        (p) => p !== null && usedAttackOnYourLastTurn(state, p, cond.attack),
      );
    }
    case "yourBenchAtLeast":
      // Victini "V-Force": "4 or fewer Benched Pokémon" under a cancel is stored as a floor of 5
      // with `>=`. Bench only; `bench` is dense.
      return state.players[seat].bench.length >= cond.count;
    case "opponentBenchAtLeast":
      // The opponent's Bench version of the arm above. `>=` for "or more"; Bench only.
      return state.players[otherSeat(seat)].bench.length >= cond.count;
    case "yourOwnerPokemonInPlayAtLeast":
      // "4 or more Team Rocket's Pokémon in play": Active + Bench top cards, matched with
      // `matchesFilter`'s `ownerPokemon` arm. `>=` for "or more".
      return countOwnerPokemonInPlay(state, seat, cond.owner) >= cond.count;
    case "yourPokemonAllOwner": {
      // "If all of your Pokémon in play are Team Rocket's Pokémon": an empty board is false.
      const side = state.players[seat];
      const inPlay = side.bench.length + (side.active === null ? 0 : 1);
      return inPlay > 0 && countOwnerPokemonInPlay(state, seat, cond.owner) === inPlay;
    }
    case "yourActiveOwner": {
      // Arven's Sandwich: the Active's top card via the `ownerPokemon` matcher. Empty Spot is
      // false.
      const spot = activeTop(state, seat);
      return spot !== null && matchesFilter(spot.card, { kind: "ownerPokemon", owner: cond.owner });
    }
    case "yourActiveHasAbility": {
      // Reads the printed Ability on the Active's top card; a locked Ability still counts, so
      // `disabledAbilityUids` is not consulted.
      const spot = activeTop(state, seat);
      return spot !== null && (spot.card.abilities ?? []).some((a) => a.name === cond.name);
    }
    case "yourActiveNamed": {
      // Latios "Lustrous Assist": the Active's top card by exact printed name. Empty Spot is false.
      const spot = activeTop(state, seat);
      return spot !== null && spot.card.name === cond.name;
    }
    case "opponentHasExOrVInPlay": {
      // Slaking ex: any Pokémon ex or V among the opponent's Active and Bench top cards.
      const side = state.players[otherSeat(seat)];
      const bodies = inPlayOf(side);
      return bodies.some((pokemon) => {
        const card = topCardOf(state, pokemon);
        return card !== undefined && isExOrV(card);
      });
    }
    case "yourActiveDamageCountersAtLeast": {
      // The field is the printed counter count; one counter is 10 damage. Empty Spot is false.
      const active = state.players[seat].active;
      return active !== null && active.damage >= cond.count * HP_PER_COUNTER;
    }
    case "opponentActiveHasAbility": {
      // Galvantula: the defender's top card has a printed Ability; a locked Ability still counts.
      // Empty Spot is false.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && hasPrintedAbility(spot.card);
    }
    case "yourActiveRemainingHpAtMost": {
      // Weavile "Retaliatory Claw": remaining HP of your Active. Empty Spot is false.
      const ownActive = state.players[seat].active;
      return ownActive !== null && remainingHpWithin(state, ownActive, cond.hp);
    }
    case "opponentActiveDamageCountersExactly": {
      // Mega Absol ex "Terminal Period": damage counters on the defender. Empty Spot is false.
      const defending = state.players[otherSeat(seat)].active;
      return defending !== null && damageCountersOn(defending) === cond.count;
    }
    case "opponentKnockedOutByDamage":
      // An opponent's body the §8.1 sweep will Knock Out, not by an effect's doom (`koByEffect`).
      return opponentKnockedOutByDamage(state, seat);
    case "opponentDiscardHasNameContaining":
      // Kyurem "Plasma Bane": any card in the opponent's discard pile with "Colress" in its name,
      // case-sensitive.
      return state.players[otherSeat(seat)].discard.some(
        (uid) => cardOf(state, uid)?.name.includes(cond.fragment) === true,
      );
    case "yourDiscardHasNamed":
      // Serperior "Solar Coiling": your discard pile, exact name (folded).
      return state.players[seat].discard.some((uid) => {
        const discarded = cardOfUid(state, uid);
        return discarded !== undefined && foldApostrophes(discarded.name) === cond.name;
      });
    case "yourDiscardPokemonWithAbilityNamedAtLeast": {
      // Hide 'n' Sneak count: Pokémon cards in your discard pile whose printed Abilities include
      // the name. Trainer cards printing an Ability never count.
      const holders = state.players[seat].discard.filter((uid) => {
        const discarded = cardOfUid(state, uid);
        return (
          discarded !== undefined &&
          discarded.category === "Pokemon" &&
          (discarded.abilities ?? []).some(
            (printed) => foldApostrophes(printed.name) === cond.ability,
          )
        );
      });
      return holders.length >= cond.count;
    }
    case "youPlayedSupporterNamedThisTurn": {
      // The allowance bag belongs to the turn owner, so a non-turn seat reads false.
      if (phaseViewOf(state, seat).activeSeat !== seat) return false;
      const played = state.allowances.supporterPlayedUid;
      if (played === null) return false;
      // `cardOfUid` resolves the uid in any zone, so a Supporter shuffled back into the deck still
      // counts as played.
      const name = cardOfUid(state, played)?.name;
      if (name === undefined) return false;
      if (cond.name !== undefined) return name === cond.name;
      return cond.nameContains !== undefined && name.includes(cond.nameContains);
    }
    case "stadiumInPlayNamed": {
      // Caretaker's "if Community Center is in play": a name test with no owner test, since no
      // possessive is printed.
      const stadium = state.stadium;
      return stadium !== null && cardOfUid(state, stadium.uid)?.name === cond.name;
    }
    case "yourBannerPokemonInPlay": {
      // "You have any Tera Pokémon in play": the seat's Active and Bench, each body's top card
      // (§1.2).
      const side = state.players[seat];
      const bodies = inPlayOf(side);
      return bodies.some((body) =>
        matchesFilter(topCardOf(state, body), { kind: "bannerPokemon", banner: cond.banner }),
      );
    }
    case "yourBannerPokemonOnBench":
      // "On your Bench": the Active is excluded.
      return state.players[seat].bench.some((body) =>
        matchesFilter(topCardOf(state, body), { kind: "bannerPokemon", banner: cond.banner }),
      );
    case "opponentActiveIsBanner":
      // An empty Active Spot is false.
      return matchesFilter(activeTop(state, otherSeat(seat))?.card, {
        kind: "bannerPokemon",
        banner: cond.banner,
      });
    case "opponentBannerPokemonInPlay": {
      // "Your opponent has any Future Pokémon in play": the other seat's Active and Bench, top
      // cards only.
      const theirs = state.players[otherSeat(seat)];
      const theirBodies = inPlayOf(theirs);
      return theirBodies.some((body) =>
        matchesFilter(topCardOf(state, body), { kind: "bannerPokemon", banner: cond.banner }),
      );
    }
    case "yourOtherBannerPokemonAttackedLastTurn": {
      // Koraidon "Unrelenting Onslaught": reads the seat-level `recentAttackers` record so a
      // departed attacker still counts. The window is the seat's previous turn (`- 2`), the banner
      // is read off the card by uid, and Koraidon's own Active stack is excluded. Safe off-turn: a
      // seat is only stamped on its own turns.
      const attacker = state.players[seat].active;
      const own = attacker === null ? [] : attacker.stack;
      return state.recentAttackers[seat].some(
        (entry) =>
          entry.turn === state.turn - 2 &&
          !own.includes(entry.uid) &&
          matchesFilter(cardOfUid(state, entry.uid), {
            kind: "bannerPokemon",
            banner: cond.banner,
          }),
      );
    }
    case "yourPlayedBannerSupporterThisTurn": {
      // "If you played an Ancient/Future Supporter card from your hand during this turn". The
      // allowance bag is the turn owner's, hence the seat guard; the uid resolves in any zone.
      if (phaseViewOf(state, seat).activeSeat !== seat) return false;
      const playedUid = state.allowances.supporterPlayedUid;
      return (
        playedUid !== null &&
        matchesFilter(cardOfUid(state, playedUid), { kind: "bannerCard", banner: cond.banner })
      );
    }
    case "opponentStage2PokemonInPlay": {
      // "Your opponent has any Stage 2 Pokémon in play": the other seat's Active and Bench, top
      // cards only.
      const foes = state.players[otherSeat(seat)];
      const foeBodies = inPlayOf(foes);
      return foeBodies.some((body) => {
        const top = topCardOf(state, body);
        return top !== undefined && isStage2Pokemon(top);
      });
    }
    case "yourMegaExInPlay": {
      // "If you have any [{T}] Mega Evolution Pokémon ex in play": your Active and Bench, each
      // body's in-play card (with its in-play types).
      const own = state.players[seat];
      return [own.active, ...own.bench].some((body) => {
        if (body === null) return false;
        const card = inPlayCardOf(state, body);
        if (card === undefined || !matchesFilter(card, { kind: "megaEvolutionEx" })) return false;
        return cond.type === undefined || (card.types ?? []).includes(cond.type);
      });
    }
    case "yourInPlayToHandAllowed":
      // The negation of the Milotic lock on the reading seat's own cards (Zarude "Jungle Whip"'s
      // cost gate).
      return !inPlayToHandBlocked(state, seat);
    case "extraEnergyBeyondAttackCost":
      // Psyspear's gate needs the declared attack's charged cost, which no board read has;
      // `resolveDeclarationGates` answers it at declaration, so this is false otherwise.
      return false;
    case "yourPokemonKoedOnOpponentsLastTurn":
      // "Any of your Pokémon were Knocked Out during your opponent's last turn." `lastKoTurn` is a
      // per-seat record, so unlike `youPlayedSupporterThisTurn` this is safe off-turn and needs no
      // `phaseViewOf` guard. The owner and cause narrowings are optional; absent means unnarrowed.
      if (cond.owner === undefined && cond.byAttack === undefined) {
        return koedDuringOpponentsLastTurn(state, seat);
      }
      // `koedMarksOnOpponentsLastTurn` returns an empty list when the window is shut, so the
      // narrowed gate is a strict subset of the bare one. The mark carries the printed card name
      // and `owner` is the bare subgroup, so the possessive is built here as `matchesFilter`'s
      // `ownerPokemon` arm builds it.
      return koedMarksOnOpponentsLastTurn(state, seat).some(
        (mark) =>
          (cond.owner === undefined || mark.name.startsWith(`${cond.owner}'s `)) &&
          (cond.byAttack === undefined || mark.byAttack),
      );
    case "youGoSecond":
      // A seat-assignment question, not a turn question, so it needs no `activeSeat` guard.
      // `firstPlayer` is null through setup; the `!== null` guard stops this reading true for both
      // seats.
      return state.firstPlayer !== null && state.firstPlayer !== seat;
    case "allOf":
      // `.every`: the printed conjunction is "and". The tuple type refuses the empty list, so this
      // cannot be vacuously true.
      return cond.conditions.every((inner) => conditionHolds(state, seat, inner));
    case "yourFirstTurn":
      // "Once during your first turn" (Fan Rotom "Fan Call"). Seat-relative and safe off-turn: the
      // operands do not depend on whose turn it is, so no `phaseViewOf` guard is needed.
      return isFirstTurnOf(state, seat);
    case "notYourFirstTurn":
      // The complement (Spiteful Evolution's printed first-turn ban).
      return !isFirstTurnOf(state, seat);
  }
}

/**
 * How many of `seat`'s in-play Pokémon carry the owner prefix `owner` ("Team Rocket's"). Active and
 * Bench, stack tops only. Exported for tests but deliberately not re-exported from `index.ts`.
 */
export function countOwnerPokemonInPlay(state: GameState, seat: Seat, owner: string): number {
  return countPokemonInPlay(state, seat, { kind: "ownerPokemon", owner });
}

/**
 * How many of `seat`'s Pokémon in play match `filter`: Active and Bench, top cards only (an evolved
 * stack is one Pokémon). An empty Active Spot counts just the Bench, and a top card missing from
 * the catalog is skipped.
 */
export function countPokemonInPlay(
  state: GameState,
  seat: Seat,
  filter: CardFilter,
  /**
   * When true, count only bodies with damage counters ("for each of your Pokémon that has any
   * damage counters on it"), decided through `hasAnyDamageCounters`. Checked before `topCardOf`, so
   * an undamaged body never costs a catalog lookup.
   */
  damagedOnly = false,
): number {
  const side = state.players[seat];
  return [side.active, ...side.bench].filter((body) => {
    if (body === null) return false;
    if (damagedOnly && !hasAnyDamageCounters(body)) return false;
    // The in-play card, so a typed count reads the types each body has in play.
    const card = inPlayCardOf(state, body);
    return card !== undefined && matchesFilter(card, filter);
  }).length;
}

/**
 * How many cards in `seat`'s discard pile match `filter`. A card in the pile provides no Energy, so
 * an Energy noun is the printed card class (§6.5). An unresolvable uid counts 0.
 */
export function countCardsInDiscardPile(state: GameState, seat: Seat, filter: CardFilter): number {
  let matched = 0;
  for (const uid of state.players[seat].discard) {
    if (matchesFilter(cardOfUid(state, uid), filter)) matched += 1;
  }
  return matched;
}

/**
 * How many cards in `seat`'s hand match `filter`. A card in hand provides no Energy, so an Energy
 * noun is the printed card class (§6.5). This is a full-information count; whether the answer may
 * be shown is decided by the caller. An unresolvable uid counts 0.
 */
export function countCardsInHand(state: GameState, seat: Seat, filter: CardFilter): number {
  let held = 0;
  for (const uid of state.players[seat].hand) {
    if (matchesFilter(cardOfUid(state, uid), filter)) held += 1;
  }
  return held;
}

/**
 * Is `pokemon` barred from attacking by its own always-on printed Ability ("This Pokémon can't
 * attack unless you have 4 or more Team Rocket's Pokémon in play")? Returns the first unmet
 * condition so the §8 gate can name it, or undefined when the body may attack. Read through
 * `passivesOf` so a §9 Ability lock suppresses it; evaluated here because the condition is
 * seat-relative and `passivesOf` has no seat.
 */
export function attackBarredByAbility(
  state: GameState,
  seat: Seat,
  pokemon: InPlayPokemon,
): BoardCondition | undefined {
  return passivesOf(state, pokemon).cantAttackUnless.find(
    (cond) => !conditionHolds(state, seat, cond),
  );
}

/**
 * Does `pokemon`'s printed attack-again licence hold right now for `seat`? "Festival Lead": "If
 * Festival Grounds is in play, this Pokémon may use an attack it has twice." A §9-locked holder
 * contributes no passive, so the licence is silent under an Ability lock.
 */
export function attackAgainLicensed(state: GameState, seat: Seat, pokemon: InPlayPokemon): boolean {
  return passivesOf(state, pokemon).attackTwiceIf.some((cond) => conditionHolds(state, seat, cond));
}

/**
 * Is a declaration by `seat`'s Active barred because the attack-again window is open and this body
 * no longer holds it? While `TurnAllowances.attackAgainUid` is set, only that uid may attack, only
 * from the Active Spot, and only while its licence still holds. False whenever the window is
 * closed. The bag describes the turn's owner only.
 */
export function attackAgainBarred(state: GameState, seat: Seat, active: InPlayPokemon): boolean {
  const uid = state.allowances.attackAgainUid;
  if (uid === null) return false;
  return topUid(active) !== uid || !attackAgainLicensed(state, seat, active);
}

/**
 * Is the attack at `index` blocked right now by a printed timing clause on the card? Returns the
 * blocking gate so the §8 reject can name it, or undefined. `onlyIf` blocks while the condition
 * does not hold, `barredIf` while it does; `firstTurnExempt` and the cost clauses never block (they
 * are read by `firstTurnAttackBanned` and `attackCostAt`).
 *
 * The arms of `AttackTimingGate` that can block a declaration. Derived with `Exclude` so a new
 * member lands here by default and must be excluded on purpose.
 */
export type BlockingAttackGate = Exclude<
  AttackTimingGate,
  { kind: "firstTurnExempt" } | { kind: "alternateCostIf" } | { kind: "costWaivedIf" }
>;

export function attackTimingBlocked(
  state: GameState,
  seat: Seat,
  pokemon: InPlayPokemon,
  index: number,
): BlockingAttackGate | undefined {
  const gate = attackGateOf(state, pokemon, index);
  if (gate === undefined || gate.kind === "firstTurnExempt") return undefined;
  // Cost clauses never block. Returned before the condition is asked: a cost clause whose condition
  // holds makes the attack cheaper, and the polarity line below would refuse it.
  if (gate.kind === "alternateCostIf" || gate.kind === "costWaivedIf") return undefined;
  const holds = conditionHolds(state, seat, gate.condition);
  return (gate.kind === "onlyIf") === holds ? undefined : gate;
}

/** The reject message for a blocked attack index, in the printed polarity. */
export function attackTimingNote(gate: BlockingAttackGate): string {
  return gate.kind === "onlyIf"
    ? `it can only be used if ${conditionNote(gate.condition)}`
    : `it cannot be used while ${conditionNote(gate.condition)}`;
}

/**
 * Is `pokemon` licensed to evolve early right now (the first-turn and played-this-turn bans lifted)
 * for `seat`? True iff a live printed licence on the stack top has its own antecedent holding. Each
 * ban keeps its own error code; this only says whether to skip it. It does not lift Rare Candy's
 * own restriction, and the zone clause is resolved in the fold only for printings that print it.
 * Read through `passivesOf` so a §9 Ability lock silences it.
 */
export function evolveEarlyLicensed(state: GameState, seat: Seat, pokemon: InPlayPokemon): boolean {
  // `.some` and not `.every`: the licences are alternatives (registry.ts's rule
  // that two sources can name one field), so ONE satisfied antecedent is enough —
  // the polarity opposite of `attackBarredByAbility`'s `.find`, which hunts for a
  // gate that FAILS. `undefined` is the entry whose clause the fold already
  // consumed and which has nothing further to ask.
  return passivesOf(state, pokemon).evolveEarlyExempt.some(
    (cond) => cond === undefined || conditionHolds(state, seat, cond),
  );
}

/**
 * Does an Ability on `target` let `card` evolve it under an alias? Eevee ex "Rainbow DNA": "This
 * Pokémon can evolve into any Pokémon ex that evolves from Eevee if you play it from your hand onto
 * this Pokémon." Read through `passivesOf` so a §9 lock silences it. Only the hand evolve asks it;
 * a deck evolve does not.
 */
export function evolveAliasLicensed(state: GameState, target: InPlayPokemon, card: Card): boolean {
  const from = evolveFromOf(card);
  if (from === null) return false;
  const suffix = pokemonSuffixOf(card);
  return passivesOf(state, target).evolveAsNamed.some(
    (alias) => alias.name === from && alias.intoSuffix === suffix,
  );
}

/** The condition as a printed-text fragment, for the reject message a failed
    play gate returns ("<card> can only be used if <this>"). */
export function conditionNote(cond: BoardCondition): string {
  switch (cond.kind) {
    case "morePrizesThanOpponent":
      return "you have more Prize cards remaining than your opponent";
    case "yourStadiumInPlay":
      return "you have a Stadium in play";
    case "opponentStadiumInPlay":
      return "your opponent has a Stadium in play";
    case "stadiumInPlay":
      return "a Stadium is in play";
    case "noEnergyOnYourPokemon":
      return "none of your Pokémon have any Energy attached";
    case "opponentActiveDamaged":
      // The printed clause drops the "already" — that word is about WHEN the
      // condition is read, and a reject/tooltip fragment is read in the present.
      return "your opponent's Active Pokémon has damage counters on it";
    case "opponentActiveIsEvolution":
      return "your opponent's Active Pokémon is an Evolution Pokémon";
    case "opponentActiveIsBasic":
      // The printed "the Defending Pokémon" is dropped: a reject/tooltip fragment is read off the
      // board, where nothing is defending.
      return "your opponent's Active Pokémon is a Basic Pokémon";
    case "opponentActiveIsStage1":
      return "your opponent's Active Pokémon is a Stage 1 Pokémon";
    case "opponentActiveIsStage2":
      return "your opponent's Active Pokémon is a Stage 2 Pokémon";
    case "yourActiveDamaged":
      return "your Active Pokémon has damage counters on it";
    case "yourActiveUndamaged":
      return "your Active Pokémon has no damage counters on it";
    case "yourBenchDamaged":
      return "1 of your Benched Pokémon has damage counters on it";
    case "yourBenchAllDamaged":
      // "All" is kept because the quantifier is the content; without it the note would describe the
      // sibling member.
      return "all of your Benched Pokémon have at least 1 damage counter on them";
    case "yourBenchNamedDamaged":
      return `1 of your Benched ${cond.name} has damage counters on it`;
    case "opponentActivePoisoned":
      return "your opponent's Active Pokémon is Poisoned";
    case "opponentActiveHasSpecialCondition":
      return "your opponent's Active Pokémon is affected by a Special Condition";
    case "yourActiveHasSpecialCondition":
      return "your Active Pokémon is affected by a Special Condition";
    case "yourActivePoisoned":
      return "your Active Pokémon is Poisoned";
    case "yourActiveBurnedOrPoisoned":
      return "your Active Pokémon is Burned or Poisoned";
    case "yourActiveAsleep":
      return "your Active Pokémon is Asleep";
    case "opponentActiveBurned":
      return "your opponent's Active Pokémon is Burned";
    case "opponentActiveConfused":
      return "your opponent's Active Pokémon is Confused";
    case "opponentActiveIsExOrV":
      return "your opponent's Active Pokémon is a Pokémon ex or Pokémon V";
    case "opponentActiveIsEx":
      return "your opponent's Active Pokémon is a Pokémon ex";
    case "yourActiveHasEnergyAttached":
      // Energy reads as the printed name, not the brace code. The basic-Energy arm is spelled out
      // because the template-string fallback would compile and render the wrong text.
      if (cond.energy === "basic") return "your Active Pokémon has a Basic Energy attached";
      return cond.energy === "special"
        ? "your Active Pokémon has a Special Energy attached"
        : `your Active Pokémon has ${cond.energy} Energy attached`;
    case "opponentActiveHasEnergyAttached":
      return cond.energy === "special"
        ? "your opponent's Active Pokémon has a Special Energy attached"
        : `your opponent's Active Pokémon has ${cond.energy} Energy attached`;
    case "yourActiveHasNamedEnergyAttached":
      // The name already ends in "Energy", so it is printed whole.
      return `your Active Pokémon has a ${cond.name} attached`;
    case "opponentPrizesRemaining":
      // Built from the parameter, agreement and all: the printed sentences read
      // "exactly 1 Prize card" and "exactly 2 or 4 Prize cards", so the noun is
      // singular exactly when the only admitted count is 1. `printedList` spells
      // the list the way the pool does, Oxford comma included.
      return `your opponent has exactly ${printedList(cond.counts)} Prize card${
        cond.counts.length === 1 && cond.counts[0] === 1 ? "" : "s"
      } remaining`;
    case "yourPrizesRemaining":
      // The noun is singular exactly when the only admitted count is 1.
      return `you have exactly ${printedList(cond.counts)} Prize card${
        cond.counts.length === 1 && cond.counts[0] === 1 ? "" : "s"
      } remaining`;
    case "opponentHandAtMost":
      return `your opponent has ${cond.count} or fewer cards in their hand`;
    case "handSizesEqual":
      return "you have the same number of cards in your hand as your opponent";
    case "yourHandAtLeast":
      return `you have ${String(cond.count)} or more cards in your hand`;
    case "yourHandExactly":
      // The pill says what the board must look like, so it does not match the printed negative
      // ("you don't have exactly 3…").
      if (cond.count === 1) return "you have exactly 1 card in your hand";
      // Slowbro "All Out" prints the zero as "no cards".
      if (cond.count === 0) return "you have no cards in your hand";
      return `you have exactly ${cond.count} cards in your hand`;
    case "yourHandNotEmpty":
      return "you have at least 1 card in your hand";
    case "yourFaceDownPrizeRemains":
      return "you have at least 1 face-down Prize card";
    case "yourDeckAtMost":
      return `you have ${cond.count} or fewer cards in your deck`;
    case "yourDeckNotEmpty":
      // Naveen's gate: "If you can't draw any cards in this way".
      return "you have at least 1 card in your deck";
    case "yourActiveEnergyAtLeast":
      // `Special` is the card class, not a type, so it reads "Special Energy" rather than "Special
      // Energy Energy"; an absent filter reads plain "Energy".
      return `your Active Pokémon has ${cond.count} or more ${
        cond.energy === undefined
          ? "Energy"
          : cond.energy === "special"
            ? "Special Energy"
            : `${cond.energy} Energy`
      } attached`;
    case "activeEnergyCountsEqual":
      return "your Active Pokémon and your opponent's Active Pokémon have the same amount of Energy attached";
    case "moreActiveEnergyThanOpponent":
      return "your Active Pokémon has more Energy attached than your opponent's Active Pokémon";
    case "opponentActiveHasType":
      return `your opponent's Active Pokémon is a ${cond.type} Pokémon`;
    case "yourActiveHasType":
      return `your Active Pokémon is a ${cond.type} Pokémon`;
    case "opponentActiveHasResistance":
      return `your opponent's Active Pokémon has ${cond.type} Resistance`;
    case "opponentActiveRetreatCostAtLeast":
      return `the Retreat Cost of your opponent's Active Pokémon is ${String(cond.count)} or more`;
    case "yourBenchHasType":
      return `you have any ${cond.type} Pokémon on your Bench`;
    case "opponentInPlayHasType":
      return `your opponent has any ${cond.type} Pokémon in play`;
    case "inPlayTypesIntersect":
      return "any of your Pokémon in play are the same type as any of your opponent's Pokémon in play";
    case "yourBenchHasNamed":
      return `${cond.name} is on your Bench`;
    case "yourBenchHasNameContaining":
      // The quotation marks are printed on the card; dropping them would make the fragment read as
      // a whole card name.
      return `a Pokémon that has "${cond.fragment}" in its name is on your Bench`;
    case "yourNamedPokemonInPlay":
      return `you have ${cond.name} in play`;
    case "yourEnergyInPlayAtLeast":
      // Energy reads as the printed name, not the brace code. The untyped branch is needed because
      // `${null} Energy` would compile and render "null Energy".
      if (cond.energy === null) return `you have at least ${cond.count} Energy in play`;
      return cond.energy === "special"
        ? `you have at least ${cond.count} Special Energy in play`
        : `you have at least ${cond.count} ${cond.energy} Energy in play`;
    case "yourBasicEnergyInDiscardAtLeast":
      return `you have at least ${cond.count} Basic ${cond.energy} Energy cards in your discard pile`;
    case "yourBasicEnergyInHandAtLeast":
      // Singular agreement matters here: counts of 1 are printed ("a Basic {G} Energy card").
      return cond.count === 1
        ? `you have a Basic ${cond.energy} Energy card in your hand`
        : `you have at least ${cond.count} Basic ${cond.energy} Energy cards in your hand`;
    case "yourActiveHasToolAttached":
      return "your Active Pokémon has a Pokémon Tool attached";
    case "opponentActiveHasToolAttached":
      return "your opponent's Active Pokémon has a Pokémon Tool attached";
    case "youPlayedSupporterThisTurn":
      // A full ROUND-TRIP, the family's cleanest: this clause names no pronoun to
      // resolve (the printed subject is already "you", which is what a
      // seat-relative predicate means), no timing word to drop and no card-face
      // glyph to spell out. The printed sentence, verbatim.
      return "you played a Supporter card from your hand during this turn";
    case "yourActivePromotedThisTurn":
      return "your Active Pokémon moved from your Bench to the Active Spot this turn";
    case "yourActiveHealedThisTurn":
      return "your Active Pokémon was healed during this turn";
    case "yourActiveEvolvedFromThisTurn":
      return `your Active Pokémon evolved from ${cond.name} during this turn`;
    case "yourActiveUsedAttackLastTurn":
      return `your Active Pokémon used ${cond.attack} during your last turn`;
    case "yourPokemonUsedAttackLastTurn":
      // The subject is "1 of your Pokémon", not "your Active Pokémon", since a benched body may be
      // the one that bars the attack.
      return `1 of your Pokémon used ${cond.attack} during your last turn`;
    case "yourBenchAtLeast":
      // The POSITIVE fact, in the printed noun — a note is read off the board by a
      // person, so it says what the player must HAVE and never repeats the
      // sentence's "4 or fewer". Reads as a floor because it is one.
      return `you have ${String(cond.count)} or more Benched Pokémon`;
    case "opponentBenchAtLeast":
      return `your opponent has ${String(cond.count)} or more Benched Pokémon`;
    case "yourOwnerPokemonInPlayAtLeast":
      // `owner` is the bare subgroup name, so the possessive is added here, as `matchesFilter`'s
      // `ownerPokemon` arm does.
      return `you have ${String(cond.count)} or more ${cond.owner}'s Pokémon in play`;
    case "yourPokemonAllOwner":
      return `all of your Pokémon in play are ${cond.owner}'s Pokémon`;
    case "yourActiveOwner":
      // The article follows the `ownerPokemon` noun's rule ("an Arven's Pokémon").
      return `your Active Pokémon is ${/^[AEIOU]/.test(cond.owner) ? "an" : "a"} ${cond.owner}'s Pokémon`;
    case "yourActiveHasAbility":
      return `your Active Pokémon has the ${cond.name} Ability`;
    case "yourActiveNamed":
      return `your Active Pokémon is ${cond.name}`;
    case "opponentHasExOrVInPlay":
      // The permission `cantAttackUnless` stores, read as "can't attack unless <this>".
      return "your opponent has a Pokémon ex or Pokémon V in play";
    case "yourActiveDamageCountersAtLeast":
      return `your Active Pokémon has ${cond.count} or more damage counters on it`;
    case "yourActiveRemainingHpAtMost":
      return `your Active Pokémon's remaining HP is ${String(cond.hp)} or less`;
    case "opponentActiveDamageCountersExactly":
      return `your opponent's Active Pokémon has exactly ${String(cond.count)} damage counters on it`;
    case "opponentKnockedOutByDamage":
      return "your opponent's Pokémon is Knocked Out by damage from this attack";
    case "opponentActiveNoRetreatCost":
      return "your opponent's Active Pokémon has no Retreat Cost";
    case "yourActiveWeakToOpponentActiveType":
      return "your Active Pokémon has Weakness to your opponent's Active Pokémon's type";
    case "yourDiscardHasNamed":
      return `${cond.name} is in your discard pile`;
    case "yourDiscardPokemonWithAbilityNamedAtLeast":
      return `you have ${String(cond.count)} or more Pokémon that have the ${cond.ability} Ability in your discard pile`;
    case "yourBenchHasStage2OfType":
      return `you have any Stage 2 ${cond.type} Pokémon on your Bench`;
    case "yourBenchHasNamedEnergyAttached":
      return `your Benched Pokémon have any ${cond.name} attached`;
    case "opponentActiveHasAbility":
      return "your opponent's Active Pokémon has an Ability";
    case "opponentDiscardHasNameContaining":
      // The quotation marks are printed on the card.
      return `your opponent has any cards in their discard pile that have "${cond.fragment}" in the name`;
    case "youPlayedSupporterNamedThisTurn":
      // The Factory's substring form keeps its printed quotation marks; Crobat's exact form names
      // the card.
      return cond.name !== undefined
        ? `you played ${cond.name} from your hand this turn`
        : `you played a Supporter card that has "${cond.nameContains ?? ""}" in its name from your hand this turn`;
    case "stadiumInPlayNamed":
      return `${cond.name} is in play`;
    case "yourBannerPokemonInPlay":
      return `you have any ${cond.banner} Pokémon in play`;
    case "yourBannerPokemonOnBench":
      return `you have any ${cond.banner} Pokémon on your Bench`;
    case "opponentActiveIsBanner":
      return `your opponent's Active Pokémon is a ${cond.banner} Pokémon`;
    case "opponentBannerPokemonInPlay":
      return `your opponent has any ${cond.banner} Pokémon in play`;
    case "yourOtherBannerPokemonAttackedLastTurn":
      return `1 of your other ${cond.banner} Pokémon used an attack during your last turn`;
    case "yourPlayedBannerSupporterThisTurn":
      return `you played ${cond.banner === "Ancient" ? "an" : "a"} ${cond.banner} Supporter card from your hand during this turn`;
    case "opponentStage2PokemonInPlay":
      return "your opponent has any Stage 2 Pokémon in play";
    case "yourMegaExInPlay":
      return cond.type === undefined
        ? "you have any Mega Evolution Pokémon ex in play"
        : `you have any ${cond.type} Mega Evolution Pokémon ex in play`;
    case "yourInPlayToHandAllowed":
      // No printed clause; named after the lock.
      return "your Pokémon in play and attached cards can be put into your hand";
    case "extraEnergyBeyondAttackCost":
      return `this Pokémon has at least ${cond.extra} extra Energy attached (in addition to this attack's cost)`;
    case "yourPokemonKoedOnOpponentsLastTurn":
      // Keeps the printed possessive "your opponent's last turn". The owner and cause narrowings
      // are assembled in printed order, so a card printing both renders its own sentence.
      return `any of your ${cond.owner === undefined ? "" : `${cond.owner}'s `}Pokémon were Knocked Out ${cond.byAttack === undefined ? "" : "by damage from an attack "}during your opponent's last turn`;
    case "youGoSecond":
      return "you go second";
    case "allOf": {
      // Joined with " and ", which does not reproduce the printed scaffolding (Call Bell: "only if
      // you go second, and only during your first turn") but reads correctly after cardplay.ts's
      // "can only be used if". The join is " and " at every arity; no printed sentence conjoins
      // three clauses.
      return cond.conditions.map(conditionNote).join(" and ");
    }
    case "yourFirstTurn":
      // "Once during" belongs to the once-per-turn lock, not the gate, so it is dropped.
      return "it is your first turn";
    case "notYourFirstTurn":
      return "it is not your first turn";
  }
}

/** "1", "2 or 4", "2, 4, or 6" — the pool's own way of printing a count list
    (all three arities appear in it), used by `conditionNote` so a generated
    fragment reads like the card it came from. */
function printedList(values: readonly number[]): string {
  if (values.length <= 1) return String(values[0] ?? 0);
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

/**
 * The attacker's total pre-W/R damage bonus (§8.5) for a hit on the opponent's Active
 * `defenderCard`: unconditional Tool bonuses, board-conditional ones whose condition holds for the
 * attacking `seat`, target-conditional ones whose suffix matches the defender, and the seat-wide
 * aura scan. Shared by both attack-damage sites so each gate is evaluated once.
 */
export function attackerPreWRBonus(
  state: GameState,
  pokemon: InPlayPokemon,
  seat: Seat,
  defenderCard: Card,
): number {
  const passives = passivesOf(state, pokemon);
  // Plus Supreme Overlord's per-Prize term, a scan because it needs the holder's seat.
  let bonus = passives.damageBonusBeforeWR + selfPreWRBonusPerOpponentPrize(state, pokemon);
  for (const { amount, cond } of passives.conditionalDamageBonusBeforeWR) {
    if (conditionHolds(state, seat, cond)) bonus += amount;
  }
  for (const { amount, targetSuffix } of passives.targetConditionalDamageBonusBeforeWR) {
    if (pokemonSuffixOf(defenderCard) === targetSuffix) bonus += amount;
  }
  // The attacker's in-play card for a typed `beneficiary`, and the defender's card for the aura's
  // `target` rider.
  return bonus + seatPreWRDamageBonus(state, seat, inPlayCardOf(state, pokemon), defenderCard);
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

// ── Choice application (shared by the forced auto-resolve and resolveEffect) ──

/** Apply a parked op given its validated choice. The auto-resolve path calls
    the per-op helpers directly (single forced ref); this is the resolveEffect
    entry, matching the choice shape to the op. */
export function applyChoice(
  state: GameState,
  op: EffectOp,
  choice: EffectChoice,
  ctx: EffectContext,
  events: GameEvent[],
  /** The running §9.2 record — the two recording ops both PARK, so this path is
      where nearly every recording is actually made (see resumeProgram). */
  record: EffectRecord = {},
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
        ? evolveFromDeckMove(state, choice.uids, ctx, events, op.onto, op.names, op.noAbilities)
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
      const owner = reorderTopOwner(ctx.seat, op);
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
        return discardChosenFromHand(state, discardHandOwner(op, ctx.seat), choice.uids, events);
      }
      return op.to === "deck"
        ? deckChosenFromHand(state, otherSeat(ctx.seat), choice.uids, events)
        : discardChosenFromHand(state, otherSeat(ctx.seat), choice.uids, events);
    case "bottomFromOpponentHand": {
      if (choice.kind !== "cards") return state;
      const moved = bottomFromOpponentHandApply(state, choice.uids, ctx, events, op.dest);
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
        ? drawToHand(state, otherSeat(ctx.seat), op.count, "effect", events)
        : state;
    case "optional":
      if (choice.kind === "confirm" && choice.target !== undefined && op.cards !== undefined) {
        const attach = (choice.yes ? op.then : op.otherwise)?.[0];
        const uid = choice.yes ? op.cards.yes : op.cards.no;
        if (attach?.op === "attachEnergyFrom" && uid !== undefined) {
          return attachEnergyFrom(state, attach, choice.target, ctx, events, record, undefined, [
            uid,
          ]);
        }
      }
      // Other optional prompts splice their branch through continuationOps.
      return state;
    case "switchActive":
      // Records what moved, not what was picked: an answer that `switchInto` then refused must not
      // file a switch.
      return pickedPokemon(choice)
        ? switchRecording(op, (into) => switchOwn(state, choice.ref, ctx, into), events, record)
        : state;
    case "gust":
      return pickedPokemon(choice)
        ? switchRecording(op, (into) => gust(state, choice.ref, ctx, into), events, record)
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
        ? switchRecording(op, (into) => gust(state, choice.ref, ctx, into), events, record)
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
        let resumed = state;
        for (const ref of choice.refs) {
          resumed = placeSnipe(
            resumed,
            [ref],
            snipeAmount(op, resumed, ctx, record, ref),
            op.deals === true,
            op.ignoreWR === true,
            op.source,
            ctx,
            events,
            op.wrOnly === true,
          );
        }
        return resumed;
      }
      // Target Together: the pick moves nothing; `continuationOps` reschedules the op with
      // `hitRefs` and `stepOp` flips, so a Backtrack Badge offer can park.
      if (choice.kind === "pokemonMulti" && op.perHeadsInPlay !== undefined) return state;
      // Recompute the (possibly Prize-scaled) amount from state: no KO has
      // happened between parking and this pick, so the count is unchanged — the
      // same value snipeNote quoted in the prompt.
      return choice.kind === "pokemonMulti"
        ? placeSnipe(
            state,
            choice.refs,
            snipeAmount(op, state, ctx, record),
            op.deals === true,
            op.ignoreWR === true,
            // The provenance rides the parked op, so a resumed pick emits the same row an inline
            // one would.
            op.source,
            ctx,
            events,
            // The parked op's own `wrOnly`; an older park without it keeps the old reading.
            op.wrOnly === true,
          )
        : state;
    case "attachEnergyFrom":
      // An absent ref is the decline: the board is returned untouched with no event. `choice.take`
      // carries a partial count (absent means the whole batch). The card answer (`pickOnto`) lands
      // exactly the picked uids on the pinned target; a target answer with cards still undecided
      // moves nothing, as `continuationOps` asks the card question. The short-pile spread
      // (`toEach`) puts one card onto each chosen body in the order named.
      if (op.toEach === true && choice.kind === "pokemonMulti") {
        return choice.refs.reduce(
          (board, ref) => attachEnergyFrom(board, op, ref, ctx, events, record),
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
              events,
              record,
              op.pickOnto.take,
              choice.uids,
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
        ? attachEnergyFrom(state, op, choice.ref, ctx, events, record, choice.take)
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
        ? turnPrizeFaceUpAt(state, choice.index, op, ctx, events, record)
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

// ── Op implementations ──

/**
 * Exported for `applyAttackPreDamage` ("If you discarded a Pokémon Tool in this way, your
 * opponent's Active Pokémon is now Paralyzed"), so the §11/§12 gates are asked in one place. Safe
 * before damage because it is total and synchronous and never parks.
 */
export function applyStatus(
  state: GameState,
  op: OpOf<"applyStatus">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = op.target === "self" ? ctx.seat : otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // "The Attacking Pokémon is now Burned" applies only while the attacker is still the Active: its
  // own attack may have benched it, and the promoted Pokémon did not attack.
  if (op.target === "attacker" && uid !== ctx.attackerUid) return state;
  // A §12 Special Condition is an effect of the attack, so a body with the wider §11 block takes
  // none. Checked on the resolved seat so it covers both targets; `effectRefusedOn` does not refuse
  // the attacker's own self-inflicted condition.
  if (effectRefused(state, seat, ctx, events)) return state;
  // Printed status immunities are read through `passivesOf`, so a locked holder's own Ability is
  // already dropped while attached Tools and Energy still count. One gate ahead of every condition
  // arm below, so no arm can be missed.
  if (passivesOf(state, active).statusImmunities.includes(op.status)) {
    events.push({ type: "STATUS_PREVENTED", seat, uid, status: op.status });
    return state;
  }
  // Festival Grounds: while it is in play, an Active with any Energy attached can't be affected by
  // any Special Conditions (continuous.ts `stadiumShieldsStatus`). A Stadium, so no §9 gate.
  if (stadiumShieldsStatus(state, active)) {
    events.push({ type: "STATUS_PREVENTED", seat, uid, status: op.status });
    return state;
  }
  if (op.status === "poisoned") {
    const poisonDamage = op.poisonDamage ?? DEFAULT_POISON_DAMAGE;
    events.push({ type: "STATUS_APPLIED", seat, uid, status: "poisoned", poisonDamage });
    return withActive(state, seat, {
      ...active,
      conditions: { ...active.conditions, poisonDamage },
    });
  }
  if (op.status === "burned") {
    events.push({ type: "STATUS_APPLIED", seat, uid, status: "burned" });
    return withActive(state, seat, {
      ...active,
      conditions: { ...active.conditions, burned: true },
    });
  }
  // The amount is written unconditionally so a raised Confusion amount never outlives the Confusion
  // that carried it; a later bare Confusion resets to the default.
  if (op.status === "confused") {
    const confusionDamage = op.confusionDamage ?? DEFAULT_CONFUSION_DAMAGE;
    events.push({ type: "STATUS_APPLIED", seat, uid, status: "confused", confusionDamage });
    return withActive(state, seat, {
      ...active,
      conditions: { ...active.conditions, rotation: "confused", confusionDamage },
    });
  }
  events.push({ type: "STATUS_APPLIED", seat, uid, status: op.status });
  return withActive(state, seat, {
    ...active,
    conditions: { ...active.conditions, rotation: op.status },
  });
}

/**
 * Clears all Special Conditions from the controller's own Active (Gardevoir ex — Miracle Force,
 * Blissey — Busybody Nurse). Deliberately does not reuse `recoverStatuses`, which is a
 * passive-driven sweep over both seats. No §11 gate: it only touches the attacker's own Active.
 * Silent when there is nothing to clear.
 */
function clearStatus(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
  // One named condition to clear; absent means all.
  only?: StatusName,
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const cleared = presentStatuses(active.conditions);
  if (cleared.length === 0) return state;
  if (only !== undefined) {
    if (!cleared.includes(only)) return state;
    events.push({
      type: "STATUS_CLEARED",
      seat: ctx.seat,
      uid,
      statuses: [only],
      reason: "recovered",
    });
    const conditions =
      only === "burned"
        ? { ...active.conditions, burned: false }
        : only === "poisoned"
          ? { ...active.conditions, poisonDamage: 0 }
          : { ...active.conditions, rotation: "none" as const };
    return withActive(state, ctx.seat, { ...active, conditions });
  }
  events.push({
    type: "STATUS_CLEARED",
    seat: ctx.seat,
    uid,
    statuses: cleared,
    reason: "recovered",
  });
  return withActive(state, ctx.seat, { ...active, conditions: noConditions() });
}

/** §11 — hold the Defending Pokémon in place ("During your opponent's next
    turn, the Defending Pokémon can't retreat."). Always the opponent's Active,
    like the `applyStatus` "defender" arm, and idempotent: re-locking an already
    locked Pokémon changes nothing and stays silent (the block has no stacking
    depth — one lock reads the same as two). No Active is a no-op, exactly as
    every other defender-relative op treats it. */
function preventRetreat(
  state: GameState,
  op: OpOf<"preventRetreat">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // A bare target means the opponent here, unlike `preventAttack` where bare means self.
  const seat = op.target === "self" ? ctx.seat : otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // Checked before the idempotence early return so a refusal is announced even on an already locked
  // body.
  if (effectRefused(state, seat, ctx, events)) return state;
  if (op.target === "self") {
    // The installer's OWN next turn is one full round away, which is
    // `attackLockedTurn`'s self-arm number: `otherSeat(ctx.seat)` takes the turn
    // that comes next (§5.3), so the holder's own is the one after that.
    const turn = state.turn + 2;
    // Idempotent BY THE STAMP rather than by a flag test — two installs in one
    // turn compute the same number, so the second write is the value the first
    // one left, and the row is not emitted twice.
    if (active.retreatLockedTurn === turn) return state;
    events.push({ type: "RETREAT_BLOCKED", seat, uid });
    return withActive(state, seat, { ...active, retreatLockedTurn: turn });
  }
  if (active.retreatBlocked) return state;
  events.push({ type: "RETREAT_BLOCKED", seat, uid });
  return withActive(state, seat, { ...active, retreatBlocked: true });
}

/**
 * Bars the opponent from playing `cards` from their hand during their next turn (Scream Tail ex,
 * Galvantula ex). Stamped `state.turn + 1` because the barred seat plays next. No `effectRefused`
 * gate and no Active precondition: the effect targets the hand, not a Pokémon.
 */
function preventHandPlay(
  state: GameState,
  bars: StampedPlayLockKey,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  events.push({ type: "HAND_PLAY_BLOCKED", seat, bars });
  return {
    ...state,
    handPlayLockedTurn: {
      ...state.handPlayLockedTurn,
      [seat]: { ...state.handPlayLockedTurn[seat], [bars]: state.turn + 1 },
    },
  };
}

/**
 * Installs the §11 damage block on the controller's own Active for the opponent's next turn
 * (`state.turn + 1`). A re-install never leaves less protection: `effects` is ORed, while
 * `fromClass` and `maxDamage` are kept only when both installs agree, otherwise the block becomes
 * unfiltered or uncapped.
 */
function preventDamage(
  state: GameState,
  effects: boolean,
  fromClass: AttackBlock["fromClass"],
  maxDamage: AttackBlock["maxDamage"],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const turn = state.turn + 1;
  const existing = active.attackBlock;
  const stacking = existing !== null && existing.turn === turn;
  const merged = stacking ? existing.effects || effects : effects;
  // Agreement keeps the filter; anything else widens to "every attacker".
  const mergedClass = stacking
    ? sameAttackerClass(existing.fromClass, fromClass)
      ? fromClass
      : undefined
    : fromClass;
  const mergedMax = stacking
    ? existing.maxDamage === maxDamage
      ? maxDamage
      : undefined
    : maxDamage;
  if (
    stacking &&
    merged === existing.effects &&
    sameAttackerClass(mergedClass, existing.fromClass) &&
    mergedMax === existing.maxDamage
  ) {
    return state;
  }
  events.push({
    type: "ATTACK_BLOCK_APPLIED",
    seat: ctx.seat,
    uid,
    effects: merged,
    fromClass: mergedClass,
    maxDamage: mergedMax,
  });
  return withActive(state, ctx.seat, {
    ...active,
    attackBlock: { turn, effects: merged, fromClass: mergedClass, maxDamage: mergedMax },
  });
}

/**
 * Field-by-field rather than `JSON.stringify`, since key order can differ between derived and
 * persisted records. Two absent classes agree.
 */
function sameAttackerClass(a: AttackBlock["fromClass"], b: AttackBlock["fromClass"]): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.stage === b.stage && a.excludingType === b.excludingType;
}

/**
 * Installs an attack lock on the controller's own Active (`+ 2`, its next turn) or on the defender
 * (`+ 1`, the opponent's next turn). The defender arm is an effect of an attack, so a §11 block can
 * refuse it. A re-install that says nothing new is silent.
 */
function preventAttack(
  state: GameState,
  op: OpOf<"preventAttack">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = op.target === "defender" ? otherSeat(ctx.seat) : ctx.seat;
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // Checked before the idempotence early return so a refusal is announced even on an already locked
  // body.
  if (effectRefused(state, seat, ctx, events)) return state;
  // The one rule, on the one seat that matters: the locked body's controller's
  // next turn. `otherSeat(ctx.seat)` is the seat whose turn comes next (§5.3), so
  // the defender arm is `+ 1` and the installer's own is one full round later.
  const turn = state.turn + (op.target === "defender" ? 1 : 2);
  if (active.attackLockedTurn === turn) return state;
  events.push({ type: "ATTACK_LOCKED", seat, uid });
  return withActive(state, seat, { ...active, attackLockedTurn: turn });
}

/**
 * Installs the flip-to-attack lock on the defender: during the opponent's next turn, if it tries to
 * attack, they flip a coin and on tails the attack doesn't happen. Same shape as `preventAttack`'s
 * defender arm but writes `attackFlipLockTurn`; the coin is flipped at declaration, not here.
 */
function flipLockAttack(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
  coins?: 2,
): GameState {
  const seat = otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // Checked before the idempotence early return so a refusal is announced even on an already locked
  // body.
  if (effectRefused(state, seat, ctx, events)) return state;
  const turn = state.turn + 1;
  // Jet of Ink's two-coin lock has its own stamp (`attackTwoFlipLockTurn`).
  if (coins === 2) {
    if (active.attackTwoFlipLockTurn === turn) return state;
    events.push({ type: "ATTACK_LOCKED", seat, uid, flip: true, coins: 2 });
    return withActive(state, seat, { ...active, attackTwoFlipLockTurn: turn });
  }
  if (active.attackFlipLockTurn === turn) return state;
  events.push({ type: "ATTACK_LOCKED", seat, uid, flip: true });
  return withActive(state, seat, { ...active, attackFlipLockTurn: turn });
}

/**
 * Seismitoad — Quaking Fist: next-turn Trainer flip lock on the opponent's side. No §11 refusal
 * (its object is the hand), no Active precondition, idempotent by the stamp.
 */
function flipLockTrainerPlay(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const seat = otherSeat(ctx.seat);
  events.push({ type: "TRAINER_FLIP_LOCKED", seat });
  return withSide(state, seat, { ...state.players[seat], trainerFlipLockTurn: state.turn + 1 });
}

/**
 * Installs a side-wide attack lock (`PlayerSide.sideAttackLock`) for the locked side's controller's
 * next turn. No `effectRefused` gate since the object is a side, not a Pokémon. Same-window
 * installs merge to the wider lock: unconditional dominates, else the larger `maxEnergy`.
 */
function lockSideAttacks(
  state: GameState,
  op: OpOf<"lockSideAttacks">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const lockedSeat = op.whose === "self" ? ctx.seat : otherSeat(ctx.seat);
  const lockTurn = state.turn + (op.whose === "self" ? 2 : 1);
  const side = state.players[lockedSeat];
  const standing = side.sideAttackLock;
  let maxEnergy = op.maxEnergy;
  if (standing !== null && standing.turn === lockTurn) {
    maxEnergy =
      standing.maxEnergy === null || op.maxEnergy === null
        ? null
        : Math.max(standing.maxEnergy, op.maxEnergy);
    if (maxEnergy === standing.maxEnergy) return state;
  }
  events.push({ type: "SIDE_ATTACKS_LOCKED", seat: lockedSeat, maxEnergy });
  return withSide(state, lockedSeat, { ...side, sideAttackLock: { turn: lockTurn, maxEnergy } });
}

/**
 * Appends a this-turn side-wide pre-W/R damage bonus; sources are summed. No `effectRefused` gate
 * since the object is a side. Written even when no matching Pokémon is Active.
 */
function boostSideAttacksThisTurn(
  state: GameState,
  op: OpOf<"boostSideAttacksThisTurn">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const attacker = op.attacker === undefined ? {} : { attacker: op.attacker };
  events.push({
    type: "SIDE_ATTACKS_BOOSTED",
    seat: ctx.seat,
    amount: op.amount,
    target: op.target,
    ...attacker,
  });
  return {
    ...state,
    allowances: {
      ...state.allowances,
      sideAttackBonuses: [
        ...state.allowances.sideAttackBonuses,
        { amount: op.amount, target: op.target, ...attacker },
      ],
    },
  };
}

/**
 * Installs a side damage reduction on the controller's side for the opponent's next turn
 * (`state.turn + 1`), read by `seatDamageReduction`.
 */
function installSideDamageReductionNextTurn(
  state: GameState,
  op: OpOf<"installSideDamageReductionNextTurn">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const pokemonType = op.pokemonType;
  events.push({
    type: "SIDE_DAMAGE_REDUCTION_INSTALLED",
    seat: ctx.seat,
    amount: op.amount,
    ...(pokemonType === undefined ? {} : { pokemonType }),
  });
  // Appended so two plays in one turn stack; expired entries are pruned.
  const live = side.sideDamageReduction.filter((record) => record.turn > state.turn);
  const record: SideDamageReduction =
    pokemonType === undefined
      ? { turn: state.turn + 1, amount: op.amount }
      : { turn: state.turn + 1, amount: op.amount, pokemonType };
  return withSide(state, ctx.seat, { ...side, sideDamageReduction: [...live, record] });
}

/**
 * Acerola's Mischief: shields the picked body (by base uid) during the opponent's next turn.
 * Overwrites any standing record. A ref that no longer resolves installs nothing.
 */
function installChosenAttackShield(
  state: GameState,
  ref: PokemonRef,
  op: OpOf<"installChosenAttackShield">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const body = refPokemon(state, ref);
  const base = body?.stack[0];
  const top = body === undefined ? undefined : topUid(body);
  if (base === undefined || top === undefined) return state;
  events.push({
    type: "CHOSEN_ATTACK_SHIELD_INSTALLED",
    seat: ctx.seat,
    uid: top,
    fromClass: { ...op.fromClass },
  });
  return withSide(state, ctx.seat, {
    ...state.players[ctx.seat],
    chosenAttackShield: { turn: state.turn + 1, uid: base, fromClass: { ...op.fromClass } },
  });
}

/** Acerola's Mischief dialog caption: the printed sentence with the class spelled as printed. */
function chosenAttackShieldNote(op: OpOf<"installChosenAttackShield">): string {
  const noun = {
    ex: "Pokémon ex",
    basic: "Basic Pokémon",
    ancient: "Ancient Pokémon",
    burned: "Burned Pokémon",
    evolution: "Evolution Pokémon",
    hasAbility: "Pokémon that have an Ability",
  }[op.fromClass.stage];
  return `Choose 1 of your Pokémon in play. During your opponent's next turn, prevent all damage from and effects of attacks done to that Pokémon by your opponent's ${noun}.`;
}

/**
 * Roxie's Performance: retreat lock on the opponent's side for their next turn, checked against
 * each body's live conditions. No `effectRefused` gate since the object is a side.
 */
function lockSideRetreat(
  state: GameState,
  op: OpOf<"lockSideRetreat">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const victim = otherSeat(ctx.seat);
  events.push({ type: "SIDE_RETREAT_LOCKED", seat: victim, status: op.status });
  return withSide(state, victim, {
    ...state.players[victim],
    sideRetreatLock: { turn: state.turn + 1, status: op.status },
  });
}

/**
 * Miraidon — C.O.D.E.: Protect: side-wide block on the controller's side for the opponent's next
 * turn, sourced from the attacker. A source no longer in the Active Spot installs nothing, since
 * the effect would already have ended.
 */
function installSideAttackBlock(
  state: GameState,
  op: OpOf<"installSideAttackBlock">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const source = side.active === null ? undefined : topUid(side.active);
  if (source === undefined || (ctx.sourceUid !== undefined && ctx.sourceUid !== source))
    return state;
  events.push({
    type: "SIDE_ATTACK_BLOCK_APPLIED",
    seat: ctx.seat,
    uid: source,
    banner: op.banner,
    fromClass: { ...op.fromClass },
  });
  return withSide(state, ctx.seat, {
    ...side,
    sideAttackBlock: {
      turn: state.turn + 1,
      sourceUid: source,
      banner: op.banner,
      fromClass: { ...op.fromClass },
    },
  });
}

/**
 * Marks the defender's hand attaches for the opponent's next turn (`state.turn + 1`). §11 refusal
 * first, then a same-window OR merge with a silent early return when nothing changes.
 */
function markHandAttach(
  state: GameState,
  op: OpOf<"markHandAttach">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const victimSeat = otherSeat(ctx.seat);
  const marked = state.players[victimSeat].active;
  if (marked === null) return state;
  const markedUid = topUid(marked);
  if (markedUid === undefined) return state;
  if (effectRefused(state, victimSeat, ctx, events)) return state;
  const turn = state.turn + 1;
  const prior = marked.handAttachMark;
  const same = prior !== null && prior.turn === turn;
  const barred = op.barred === true || (same && prior.barred);
  const endsTurn = op.endsTurn === true || (same && prior.endsTurn);
  // Electrified Incisors' counters sum within one window.
  const counters = (op.counters ?? 0) + (same ? prior.counters : 0);
  if (same && barred === prior.barred && endsTurn === prior.endsTurn && counters === prior.counters)
    return state;
  events.push({
    type: "HAND_ATTACH_MARKED",
    seat: victimSeat,
    uid: markedUid,
    barred,
    endsTurn,
    counters,
  });
  return withActive(state, victimSeat, {
    ...marked,
    handAttachMark: { turn, barred, endsTurn, tripped: false, counters },
  });
}

/**
 * Team Rocket's Blipbug — Searching Eyes: without `index`, picks a face-down Prize (parking when
 * there are two or more); with `index`, shows that card only to the looker through an `orderCards`
 * prompt, since log rows are broadcast to both seats.
 */
function lookAtPrize(
  state: GameState,
  op: OpOf<"lookAtPrize">,
  ctx: EffectContext,
  events: GameEvent[],
): { done: GameState } | { park: EffectPrompt } {
  const owner = otherSeat(ctx.seat);
  const slots = faceDownPrizeIndices(state, owner);
  const index = op.index ?? (slots.length === 1 ? slots[0] : undefined);
  if (index === undefined) {
    if (slots.length === 0) return { done: state };
    return {
      park: {
        kind: "choosePrize",
        indices: slots,
        note: "Choose 1 of your opponent's face-down Prize cards to look at.",
      },
    };
  }
  const uid = state.players[owner].prizes[index];
  if (uid === undefined || !slots.includes(index)) return { done: state };
  events.push({ type: "PRIZE_LOOKED_AT", seat: owner, actor: ctx.seat, index });
  return {
    park: {
      kind: "orderCards",
      candidates: [uid],
      note: "You looked at this face-down Prize card. Put it back face down.",
    },
  };
}

/**
 * N's Sigilyph — Victory Symbol: the controller wins via `finishGame`, so the rest of the attack
 * never resolves.
 */
function winGame(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const result = finishGame(
    state,
    { result: "win", winner: ctx.seat, reason: "cardEffect" },
    events,
  );
  return result.ok ? result.state : state;
}

/**
 * Amarys: schedules the end-of-turn hand discard. Only the turn's owner can play a Supporter, so
 * `ctx.seat` is that owner.
 */
function scheduleEndOfTurnHandDiscard(
  state: GameState,
  op: OpOf<"scheduleEndOfTurnHandDiscard">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  events.push({ type: "HAND_DISCARD_SCHEDULED", seat: ctx.seat, atLeast: op.atLeast });
  return { ...state, allowances: { ...state.allowances, endOfTurnHandDiscard: op.atLeast } };
}

/**
 * Caretaker: the card is already in the discard pile when the program runs, so "instead of
 * discarding it" moves it to the deck and shuffles. Named by `ctx.playedUid`, not `sourceUid`; a
 * silent no-op if it is gone.
 */
function shufflePlayedCardIntoDeck(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const uid = ctx.playedUid;
  const side = state.players[ctx.seat];
  if (uid === undefined || !side.discard.includes(uid)) return state;
  const [deck, rngState] = shuffle([...side.deck, uid], state.rngState);
  // `played: true` so the log shows the played card going into the deck rather than a discard-pile
  // retrieval.
  events.push({
    type: "DISCARD_RETRIEVED",
    seat: ctx.seat,
    dest: "deck",
    uids: [uid],
    played: true,
  });
  events.push({ type: "SHUFFLE", seat: ctx.seat });
  return {
    ...withSide(state, ctx.seat, { ...side, discard: without(side.discard, uid), deck }),
    rngState,
  };
}

/**
 * Resolves a printed attack name to the holder's attack index (-1 if absent). Both sides are
 * apostrophe-folded so curly and straight apostrophes match.
 */
function printedAttackIndex(printed: readonly Attack[], attack: string): number {
  return printed.findIndex((row) => foldApostrophes(row.name) === attack);
}

/**
 * The single merge rule for `lockedAttacks`, shared by both writers so one can't delete the other's
 * live bar. Idempotent on the same (turn, index); a differing index is appended; entries with `turn
 * < now` are pruned, but one stamped for `now` is still live. `until: "leavesActive"` entries are
 * keyed by index alone and never pruned. Returns null when nothing changed.
 */
function addLockedAttack(
  existing: readonly LockedAttack[],
  now: number,
  turn: number,
  attackIndex: number,
  until?: "leavesActive",
  /** Name-keyed bar for a borrowed menu row, written with `attackIndex: -1`. */
  attackName?: string,
): LockedAttack[] | null {
  // A turn-stamped bar is keyed by (turn, index); an `until: "leavesActive"` bar has no window, so
  // it is keyed by index alone.
  const duplicate =
    until === undefined
      ? (lock: LockedAttack) =>
          lock.until === undefined && lock.turn === turn && lock.attackIndex === attackIndex
      : (lock: LockedAttack) => lock.until === until && lock.attackIndex === attackIndex;
  // The name is part of both keys, since name-keyed bars share `attackIndex: -1`.
  if (existing.some((lock) => duplicate(lock) && lock.attackName === attackName)) return null;
  // Unbounded bars are never pruned, since their `turn` is the install turn; they are shed when the
  // body leaves the Active Spot.
  const kept = existing.filter((lock) => lock.until === "leavesActive" || lock.turn >= now);
  return [
    ...kept,
    {
      ...(until === undefined ? { turn, attackIndex } : { turn, attackIndex, until }),
      ...(attackName === undefined ? {} : { attackName }),
    },
  ];
}

/**
 * Bars one named attack on the controller's own Active during its next turn. The printed name is
 * resolved to an index here; a name matching nothing (for example under a copied attack) installs
 * nothing. No §11 check: it lands on the actor's own Active.
 */
function preventAttackUse(
  state: GameState,
  attack: string,
  until: "leavesActive" | undefined,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  const card = topCardOf(state, active);
  if (uid === undefined || card === undefined) return state;
  const printed = attacksOf(card);
  // When the attack being used is a borrowed Memory Dive or Technical Machine row named by the
  // sentence, the bar binds to its name, since the holder prints no such attack. A copy never sets
  // `borrowedAttack`.
  const borrowed =
    ctx.borrowedAttack !== undefined && foldApostrophes(ctx.borrowedAttack) === attack
      ? ctx.borrowedAttack
      : undefined;
  const attackIndex = borrowed === undefined ? printedAttackIndex(printed, attack) : -1;
  if (attackIndex < 0 && borrowed === undefined) return state;
  // The window is the holder's own next turn. For "until it leaves the Active Spot" the install
  // turn is recorded as provenance only.
  const turn = until === undefined ? state.turn + 2 : state.turn;
  const locks = addLockedAttack(
    active.lockedAttacks,
    state.turn,
    turn,
    attackIndex,
    until,
    borrowed,
  );
  if (locks === null) return state;
  // Logs the card's printed spelling rather than the folded token, and carries the `until` rider
  // since "next turn" would be false for an unbounded bar.
  events.push({
    type: "ATTACK_LOCKED",
    seat: ctx.seat,
    uid,
    attack: borrowed ?? printed[attackIndex]?.name ?? attack,
    ...(until === undefined ? {} : { until }),
  });
  return withActive(state, ctx.seat, { ...active, lockedAttacks: locks });
}

/**
 * Gives a named attack (or every attack, with `attack: null`) a pre-W/R damage bonus during the
 * holder's next turn, or a base-damage override with `base`. A name matching nothing installs
 * nothing. No §11 check: it lands on the actor's own body. Same-address re-installs merge fieldwise
 * by max; a different address replaces the record.
 */
function boostAttack(
  state: GameState,
  attack: string | null,
  amount: number,
  base: true | undefined,
  ctx: EffectContext,
  events: GameEvent[],
  // Write the record on the program's source body (Bench or Active) instead of the seat's Active.
  holder?: "source",
  // Stamp `state.turn` for a printed "during this turn" instead of `+ 2`.
  thisTurn?: true,
): GameState {
  // An all-attacks base override is refused: no card prints one and `boostedAttackBase` would never
  // pay it.
  if (attack === null && base === true) return state;
  // The holder is the seat's Active or the source body found by uid, which may be Benched. A
  // departed source installs nothing.
  const [holderRef] =
    holder === "source"
      ? sourceRef(state, ctx)
      : [{ seat: ctx.seat, spot: { spot: "active" } } as const];
  const active = holderRef === undefined ? null : (refPokemon(state, holderRef) ?? null);
  if (active === null || holderRef === undefined) return state;
  const uid = topUid(active);
  const card = topCardOf(state, active);
  if (uid === undefined || card === undefined) return state;
  const printed = attacksOf(card);
  // `null` addresses every attack, so there is no name to resolve.
  const attackIndex = attack === null ? null : printedAttackIndex(printed, attack);
  if (attackIndex !== null && attackIndex < 0) return state;
  // The window is the holder's own next turn, or this turn when the op prints "during this turn".
  const turn = thisTurn === true ? state.turn : state.turn + 2;
  const existing = active.boostedAttack;
  const stacking =
    existing !== null && existing.turn === turn && existing.attackIndex === attackIndex;
  // A base install puts the printed number in `base` and 0 in `amount`; an additive install omits
  // `base`.
  const installed: BoostedAttack =
    base === true ? { turn, attackIndex, amount: 0, base: amount } : { turn, attackIndex, amount };
  const mergedBase = !stacking
    ? installed.base
    : existing.base === undefined
      ? installed.base
      : installed.base === undefined
        ? existing.base
        : Math.max(existing.base, installed.base);
  const merged: BoostedAttack = stacking
    ? {
        turn,
        attackIndex,
        amount: Math.max(existing.amount, installed.amount),
        ...(mergedBase === undefined ? {} : { base: mergedBase }),
      }
    : installed;
  if (stacking && merged.amount === existing.amount && merged.base === existing.base) {
    return state;
  }
  // Logs the card's printed spelling rather than the folded token; an all-attacks install names no
  // attack.
  events.push({
    type: "ATTACK_BOOSTED",
    seat: ctx.seat,
    uid,
    attack: attackIndex === null ? null : (printed[attackIndex]?.name ?? attack),
    ...(base === true
      ? { amount: merged.base ?? amount, base: true as const }
      : { amount: merged.amount }),
    ...(thisTurn === true ? { thisTurn: true as const } : {}),
  });
  const boosted: InPlayPokemon = { ...active, boostedAttack: merged };
  if (holderRef.spot.spot === "active") return withActive(state, ctx.seat, boosted);
  const benchSlot = holderRef.spot.index;
  const holderSide = state.players[ctx.seat];
  return withSide(state, ctx.seat, {
    ...holderSide,
    bench: holderSide.bench.map((pokemon, i) => (i === benchSlot ? boosted : pokemon)),
  });
}

/**
 * Bars one chosen attack of the opponent's Active during their next turn (Medicham —
 * Acu-Punch-Ture, Oranguru — Plotter's Command). Refusable by a §11 block, asked before the
 * candidate scan so a shielded defender is never prompted. No attacks: no-op; one: forced; more:
 * park.
 */
function preventChosenAttack(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): { done: GameState } | { park: EffectPrompt } {
  const victim = otherSeat(ctx.seat);
  // Refused before the candidate scan so a shielded defender is never prompted.
  if (effectRefused(state, victim, ctx, events)) return { done: state };
  const active = state.players[victim].active;
  if (active === null) return { done: state };
  const card = topCardOf(state, active);
  if (card === undefined) return { done: state };
  const printed = attacksOf(card);
  if (printed.length === 0) return { done: state };
  if (printed.length === 1) return { done: lockDefenderAttack(state, 0, ctx, events) };
  return {
    park: {
      kind: "chooseAttack",
      candidates: printed.map((attack, index) => ({ index, name: attack.name })),
      // The prompt addresses the seat that ANSWERS it, like every other note in
      // this file — and that seat is the ATTACKER, so the possessive is the
      // printed one ("your opponent's") and the body is named so a hot-seat device
      // cannot be misread. The printed verb is kept ("can't use") for
      // DAMAGE_REDUCTION_APPLIED's rule: a player holding the card reads back the
      // words on it.
      note: `Choose 1 of ${card.name}'s attacks — it can't use that attack next turn.`,
    },
  };
}

/**
 * Applies the chosen index to the opponent's Active. The index is re-validated against the live
 * board; a stale one writes nothing. Merges through `addLockedAttack`.
 */
function lockDefenderAttack(
  state: GameState,
  attackIndex: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const victim = otherSeat(ctx.seat);
  const active = state.players[victim].active;
  if (active === null) return state;
  const uid = topUid(active);
  const card = topCardOf(state, active);
  if (uid === undefined || card === undefined) return state;
  const printed = attacksOf(card);
  const row = printed[attackIndex];
  if (row === undefined) return state;
  // The window is the locked Pokémon's controller's next turn.
  const turn = state.turn + 1;
  const locks = addLockedAttack(active.lockedAttacks, state.turn, turn, attackIndex);
  if (locks === null) return state;
  events.push({ type: "ATTACK_LOCKED", seat: victim, uid, attack: row.name });
  return withActive(state, victim, { ...active, lockedAttacks: locks });
}

/**
 * Installs damage reduction on the controller's own Active for the opponent's next turn.
 * Re-installs merge by max rather than sum, since the field holds one installation.
 */
function reduceDamage(
  state: GameState,
  amount: number,
  // Metal Block's attacker class; absent means every attacker.
  fromClass: AttackerClass | undefined,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const turn = state.turn + 1;
  const existing = active.damageReduction;
  const stacking = existing !== null && existing.turn === turn;
  const merged = stacking ? Math.max(existing.amount, amount) : amount;
  // A class mismatch widens to every attacker with the larger amount, which over-protects;
  // unreachable since only attacks install this.
  const mergedClass = stacking
    ? sameAttackerClass(existing.fromClass, fromClass)
      ? fromClass
      : undefined
    : fromClass;
  if (stacking && merged === existing.amount && sameAttackerClass(mergedClass, existing.fromClass))
    return state;
  events.push({
    type: "DAMAGE_REDUCTION_APPLIED",
    seat: ctx.seat,
    uid,
    amount: merged,
    ...(mergedClass === undefined ? {} : { fromClass: { ...mergedClass } }),
  });
  return withActive(state, ctx.seat, {
    ...active,
    damageReduction:
      mergedClass === undefined
        ? { turn, amount: merged }
        : { turn, amount: merged, fromClass: { ...mergedClass } },
  });
}

/**
 * Installs "this Pokémon has no Weakness" on the controller's own Active for the opponent's next
 * turn; idempotent by the stamp. Only stamps: both Weakness sites read it through
 * `installedNoWeakness`.
 */
function installNoWeakness(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const turn = state.turn + 1;
  if (active.noWeaknessTurn === turn) return state;
  events.push({ type: "WEAKNESS_REMOVED", seat: ctx.seat, uid });
  return withActive(state, ctx.seat, { ...active, noWeaknessTurn: turn });
}

/**
 * Installs "the Defending Pokémon's attacks do N less damage" on the opponent's Active for their
 * next turn. Refusable by a §11 block. Re-installs merge by max.
 */
function weakenDefenderAttacks(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // Checked before the idempotence early return so a refusal is announced even on an already
  // debuffed body.
  if (effectRefused(state, seat, ctx, events)) return state;
  const turn = state.turn + 1;
  const existing = active.attackDamageDebuff;
  const stacking = existing !== null && existing.turn === turn;
  const merged = stacking ? Math.max(existing.amount, amount) : amount;
  if (stacking && merged === existing.amount) return state;
  events.push({ type: "ATTACK_DEBUFF_APPLIED", seat, uid, amount: merged });
  return withActive(state, seat, { ...active, attackDamageDebuff: { turn, amount: merged } });
}

/**
 * Installs "the Defending Pokémon takes N more damage" during the installer's next turn, hence `+
 * 2`. Same-window re-installs merge by max.
 */
function exposeDefender(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // Checked before the idempotence early return so a refusal is announced even on an already
  // exposed body.
  if (effectRefused(state, seat, ctx, events)) return state;
  const turn = state.turn + 2;
  const existing = active.damageVulnerability;
  const exposedAlready = existing !== null && existing.turn === turn;
  const worst = exposedAlready ? Math.max(existing.amount, amount) : amount;
  if (exposedAlready && worst === existing.amount) return state;
  events.push({ type: "DAMAGE_VULNERABILITY_APPLIED", seat, uid, amount: worst });
  return withActive(state, seat, { ...active, damageVulnerability: { turn, amount: worst } });
}

/**
 * Mabosstiff — Plunging Headbutt: self vulnerability for the opponent's next turn. Summed onto a
 * same-window record, since the opponent's `exposeDefender` can stamp the same turn and both
 * effects apply. No §11 check.
 */
function exposeSelf(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const turn = state.turn + 1;
  const existing = active.damageVulnerability;
  const total = existing !== null && existing.turn === turn ? existing.amount + amount : amount;
  events.push({ type: "DAMAGE_VULNERABILITY_APPLIED", seat: ctx.seat, uid, amount: total });
  return withActive(state, ctx.seat, { ...active, damageVulnerability: { turn, amount: total } });
}

/**
 * Retypes the defender's Weakness until the end of the installer's next turn (`+ 2`). A type has no
 * order, so a re-install replaces rather than merging.
 */
function retypeDefenderWeakness(
  state: GameState,
  type: string,
  ctx: EffectContext,
  events: GameEvent[],
  // Overwriting Bolt's "(Apply Weakness as ×2.)".
  asTimesTwo: boolean,
): GameState {
  const seat = otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // §11 — checked BEFORE the idempotence early-return, `exposeDefender`'s ordering, so a
  // refusal is announced even on an already-retyped body.
  if (effectRefused(state, seat, ctx, events)) return state;
  const turn = state.turn + 2;
  const existing = active.weaknessRetype;
  if (
    existing !== null &&
    existing.turn === turn &&
    existing.type === type &&
    (existing.asTimesTwo === true) === asTimesTwo
  )
    return state;
  if (asTimesTwo) {
    events.push({ type: "WEAKNESS_RETYPED", seat, uid, weaknessType: type, asTimesTwo: true });
    return withActive(state, seat, { ...active, weaknessRetype: { turn, type, asTimesTwo: true } });
  }
  events.push({ type: "WEAKNESS_RETYPED", seat, uid, weaknessType: type });
  return withActive(state, seat, { ...active, weaknessRetype: { turn, type } });
}

/**
 * Installs the attack and Retreat cost tax on the defender for the opponent's next turn. Its own
 * event rather than an `ATTACK_LOCKED` rider, since the body can still attack and retreat at a
 * higher cost.
 */
function taxDefender(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const taxedSeat = otherSeat(ctx.seat);
  const taxed = state.players[taxedSeat].active;
  if (taxed === null) return state;
  const taxedUid = topUid(taxed);
  if (taxedUid === undefined) return state;
  // Checked before the same-window early return so a refusal is announced even on an already taxed
  // body.
  if (effectRefused(state, taxedSeat, ctx, events)) return state;
  const taxTurn = state.turn + 1;
  if (taxed.costTaxTurn === taxTurn) return state;
  events.push({ type: "COST_TAX_APPLIED", seat: taxedSeat, uid: taxedUid });
  return withActive(state, taxedSeat, { ...taxed, costTaxTurn: taxTurn });
}

/**
 * Knock Out bounty on the defender during the installer's next turn (`+ 2`): take 2 more Prize
 * cards if it is Knocked Out. Read only in flow.ts `koPrizeBonus`.
 */
function bountyDefender(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const markedSeat = otherSeat(ctx.seat);
  const marked = state.players[markedSeat].active;
  if (marked === null) return state;
  const markedUid = topUid(marked);
  if (markedUid === undefined) return state;
  // Checked before the merge's early return.
  if (effectRefused(state, markedSeat, ctx, events)) return state;
  const bountyTurn = state.turn + 2;
  const prior = marked.koBounty;
  // A live record from this turn is kept when the marked body will be Knocked Out at this attack's
  // sweep, since it still pays there and the new window could never open. Otherwise the live record
  // can no longer pay and is replaced.
  const leavesAtSweep =
    isLethallyDamaged(state, marked) || marked.markers.includes(koByEffectMarker(state.turn));
  if (prior !== null && prior.turn === state.turn && leavesAtSweep) return state;
  const sameWindow = prior !== null && prior.turn === bountyTurn;
  const payout = sameWindow ? Math.max(prior.amount, amount) : amount;
  if (sameWindow && payout === prior.amount) return state;
  events.push({ type: "KO_BOUNTY_APPLIED", seat: markedSeat, uid: markedUid, amount: payout });
  return withActive(state, markedSeat, {
    ...marked,
    koBounty: { turn: bountyTurn, amount: payout },
  });
}

/**
 * Is a body of `seat`'s opponent lethally damaged, and not doomed by an effect this turn? Inside an
 * attack program this means "Knocked Out by damage from this attack".
 */
function opponentKnockedOutByDamage(state: GameState, seat: Seat): boolean {
  const side = state.players[otherSeat(seat)];
  return [side.active, ...side.bench].some(
    (body) =>
      body !== null &&
      isLethallyDamaged(state, body) &&
      !body.markers.includes(koByEffectMarker(state.turn)),
  );
}

/**
 * Unown — Mysterious Signal: puts a this-turn `koBounty` on the opponent's Active, paid at the
 * sweep. Added to a live record of this turn, otherwise replaces. No §11 check and no event.
 */
function bountyThisAttack(state: GameState, amount: number, ctx: EffectContext): GameState {
  const seat = otherSeat(ctx.seat);
  const marked = state.players[seat].active;
  if (marked === null || !isLethallyDamaged(state, marked)) return state;
  if (marked.markers.includes(koByEffectMarker(state.turn))) return state;
  const prior = marked.koBounty;
  const live = prior !== null && prior.turn === state.turn ? prior.amount : 0;
  return withActive(state, seat, {
    ...marked,
    koBounty: { turn: state.turn, amount: live + amount },
  });
}

/**
 * Yveltal ex — Soul Destroyer: dooms every opponent body with at most `atMost` HP remaining (read
 * before any doom), skipping §11-shielded ones.
 */
function knockOutEach(
  state: GameState,
  atMost: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const inWindow = oppAnyRefs(state, ctx.seat).filter((ref) => {
    const pokemon = refPokemon(state, ref);
    return pokemon !== undefined && remainingHpWithin(state, pokemon, atMost);
  });
  return unshieldedRefs(state, inWindow, ctx, events).reduce(
    (next, ref) => doomBodyAt(next, ref, koByEffectMarker(state.turn)),
    state,
  );
}

/**
 * Schedules damage counters on the defender for the end of the opponent's next turn. Only stamps:
 * placement happens in flow.ts `runCheckup`.
 */
function scheduleCounters(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  return scheduleDelayed(state, { kind: "counters", amount }, ctx, events);
}

/**
 * Schedules discarding the defender at the end of the opponent's next turn. Unlike the scheduled
 * Knock Out, this takes no Prize.
 */
function scheduleDiscard(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  return scheduleDelayed(state, { kind: "discard" }, ctx, events);
}

/**
 * Schedules the defender's Knock Out at the end of the opponent's next turn; the Checkup hands it
 * to §8.1, so a Prize is taken.
 */
function scheduleKnockOut(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  return scheduleDelayed(state, { kind: "knockOut" }, ctx, events);
}

/**
 * Shared body of the `schedule*` installers. The §11 gate is asked here at install, not at the
 * firing site. One appointment per body: same-kind counter schedules merge by max, a different kind
 * replaces. The row is suppressed when nothing changed.
 */
function scheduleDelayed(
  state: GameState,
  payload: { kind: "counters"; amount: number } | { kind: "discard" } | { kind: "knockOut" },
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  if (effectRefused(state, seat, ctx, events)) return state;
  const turn = state.turn + 1;
  const existing = active.scheduledEffect;
  const stacking = existing !== null && existing.turn === turn ? existing : null;
  const wanted: ScheduledEffect =
    payload.kind === "counters"
      ? {
          turn,
          kind: "counters",
          amount:
            stacking !== null && stacking.kind === "counters"
              ? Math.max(stacking.amount, payload.amount)
              : payload.amount,
        }
      : payload.kind === "discard"
        ? { turn, kind: "discard" }
        : { turn, kind: "knockOut" };
  if (stacking !== null && sameSchedule(stacking, wanted)) return state;
  events.push({ type: "EFFECT_SCHEDULED", seat, uid, scheduled: { ...wanted } });
  return withActive(state, seat, { ...active, scheduledEffect: wanted });
}

/**
 * Do two appointments say the same thing? A switch so a new `ScheduledEffect` member fails to
 * compile here.
 */
function sameSchedule(a: ScheduledEffect, b: ScheduledEffect): boolean {
  switch (a.kind) {
    case "counters":
      return b.kind === "counters" && a.amount === b.amount;
    case "discard":
      return b.kind === "discard";
    case "knockOut":
      return b.kind === "knockOut";
  }
}

/**
 * Arms reactive recoil on the controller's own Active for the opponent's next turn ("put 8 damage
 * counters on the Attacking Pokémon"). No §11 check: own body. Re-installs merge by max, since the
 * field holds one installation.
 */
function installRecoil(
  state: GameState,
  amount: number | "damageTaken",
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const turn = state.turn + 1;
  const existing = active.installedRecoil;
  const stacking = existing !== null && existing.turn === turn;
  // The "equal to the damage done" form has a printed floor of 0.
  const floor = amount === "damageTaken" ? 0 : amount;
  const merged = stacking ? Math.max(existing.amount, floor) : floor;
  // Gated on `stacking` because an expired record still sits on the body and must not turn a fresh
  // flat install into a scaled one.
  const wasTaken = stacking && existing.ofDamageTaken === true;
  const taken = amount === "damageTaken" || wasTaken;
  // A `damageTaken` install on a flat record changes the flag without changing the amount, which is
  // still news.
  if (stacking && merged === existing.amount && taken === wasTaken) return state;
  events.push({
    type: "RECOIL_ARMED",
    seat: ctx.seat,
    uid,
    amount: merged,
    // Same omission rule as the record, so the row doesn't announce a 0-damage counterattack.
    ...(taken ? { ofDamageTaken: true } : {}),
  });
  return withActive(state, ctx.seat, {
    ...active,
    // Omitted rather than `false`, so absent has one spelling in the persisted record.
    installedRecoil: { turn, amount: merged, ...(taken ? { ofDamageTaken: true } : {}) },
  });
}

/**
 * Is attack damage aimed at `pokemon` refused by a live §11 block? Both printed spellings block
 * damage, so `effects` is not read, and nothing is announced since `DAMAGE_DEALT` carries
 * `prevented: true`. Takes the attacker and the damage amount because a block may be narrowed by
 * attacker class or capped by damage.
 */
function attackDamageBlocked(
  state: GameState,
  pokemon: InPlayPokemon,
  attacker: Card | undefined,
  damage: number,
  ctx: EffectContext,
  // The attacking body, whose conditions Lava Wall's `"burned"` class reads.
  attackerBody: InPlayPokemon | undefined,
): boolean {
  return (
    ctx.invokedBy === "attack" &&
    attackBlockOf(state, pokemon, attacker, damage, attackerBody) !== null
  );
}

/**
 * The pure predicate behind `effectRefused`, for per-candidate readers that drop shielded bodies
 * from a list without announcing a refusal.
 */
function effectRefusedOn(
  state: GameState,
  target: InPlayPokemon,
  seat: Seat,
  ctx: EffectContext,
): boolean {
  // Trainer channel: both sentences are about cards the opponent plays, so a Trainer you play on
  // your own Pokémon is not refused by your own shield.
  if (ctx.invokedBy === "item" || ctx.invokedBy === "supporter") {
    if (seat === ctx.seat) return false;
    // Fraxure / Cetitan ex: the HOLDER rule, and the fold answers it whole — no
    // zone clause, no source clause, and BOTH trainer types refused.
    if (passivesOf(state, target).preventTrainerEffects) return true;
    // Antique Sail Fossil — Protective Sail: the holder rule, Supporters only.
    if (ctx.invokedBy === "supporter" && passivesOf(state, target).preventSupporterEffects)
      return true;
    // Rhyperior: the SEAT rule, Supporters only. `seat` and not `target` because
    // the printed target is "all of your Pokémon" — the scan is about the side.
    return ctx.invokedBy === "supporter" && seatShieldedFromSupporterEffects(state, seat);
  }
  // Ability channel: Mega Clefable ex — Luminous Wing, "Prevent all effects of your opponent's
  // Pokémon's Abilities done to this Pokémon." An Ability from the shielded body's own side is not
  // refused.
  if (ctx.invokedBy === "ability") {
    return seat !== ctx.seat && passivesOf(state, target).preventAbilityEffects;
  }
  if (ctx.invokedBy !== "attack") return false;
  // Every attack-effect shield names the holder's opponent as the source, so an effect an attack
  // aims at its own side is refused by nothing.
  if (seat === ctx.seat) return false;
  // The attacker is `ctx.seat`'s Active by construction, so it is resolved here rather than passed
  // in. The damage amount is undefined because this gate is about effects, so a damage-capped block
  // never refuses an effect. Installed blocks and Ability auras are ORed.
  const attackerTop = activeTop(state, ctx.seat);
  // The in-play card, so blocks read the attacker's current types.
  const attacker = attackerTop === null ? undefined : inPlayCardOf(state, attackerTop.active);
  // Auras are read through `passivesOf`, so a §9 lock over the holder switches the refusal off.
  // "Done to this Pokémon" auras fold per body; "done to your … Pokémon" auras cover a set and need
  // a scan.
  const auraRefuses =
    (passivesOf(state, target).preventDamageAndEffectsFromSpecialEnergy &&
      attackerHasSpecialEnergy(state, attackerTop?.active)) ||
    // Sparkling Scales' effects half: "from and effects of attacks from your opponent's Tera
    // Pokémon".
    preventsAttackerBanner(
      passivesOf(state, target).preventDamageAndEffectsFromBanners,
      attacker,
    ) ||
    passivesOf(state, target).preventDamageAndEffectsWhileBenched ||
    passivesOf(state, target).preventAttackEffects ||
    benchShieldedFromEffects(state, target) ||
    groupShieldedFromAttackEffects(state, target);
  return auraRefuses || attackBlockOf(state, target, attacker, undefined)?.effects === true;
}

/**
 * §11 — is an effect aimed at `seat`'s `target` (default: its Active) refused, and if so announce
 * it with `ATTACK_EFFECT_PREVENTED`. Exported for attack.ts's pre-damage strip; it returns a
 * boolean and never parks.
 */
export function effectRefused(
  state: GameState,
  seat: Seat,
  ctx: EffectContext,
  events: GameEvent[],
  target: InPlayPokemon | null = state.players[seat].active,
): boolean {
  if (target === null) return false;
  if (!effectRefusedOn(state, target, seat, ctx)) return false;
  const uid = topUid(target);
  if (uid === undefined) return false;
  events.push(
    ctx.invokedBy === "item" || ctx.invokedBy === "supporter"
      ? { type: "TRAINER_EFFECT_PREVENTED", seat, uid, trainerType: ctx.invokedBy }
      : ctx.invokedBy === "ability"
        ? { type: "ABILITY_EFFECT_PREVENTED", seat, uid }
        : { type: "ATTACK_EFFECT_PREVENTED", seat, uid },
  );
  return true;
}

/**
 * Battle Cage: "Prevent all damage counters from being placed on Benched Pokémon (both yours and
 * your opponent's) by effects of attacks and Abilities from the opponent's Pokémon." Callers ask
 * only for a Benched body; the target stays offered and no row is filed. Trainers, Tools, Checkup
 * counters and a player's own effects are not stopped.
 */
function benchCountersCaged(state: GameState, seat: Seat, ctx: EffectContext): boolean {
  return (
    stadiumEffectsOf(state)?.benchCounterShield === true &&
    (ctx.invokedBy === "attack" || ctx.invokedBy === "ability") &&
    seat !== ctx.seat
  );
}

/**
 * Drops from `refs` every body that refuses this effect, announcing one row per dropped body. A
 * filter rather than a whole-op guard, so one shielded body doesn't protect the whole Bench from a
 * chosen-target effect.
 */
function unshieldedRefs(
  state: GameState,
  refs: readonly PokemonRef[],
  ctx: EffectContext,
  events: GameEvent[],
): PokemonRef[] {
  return refs.filter((ref) => {
    const side = state.players[ref.seat];
    const body = bodyAt(side, ref.spot);
    if (body === undefined) return true; // not our call — the op validates refs
    return !effectRefused(state, ref.seat, ctx, events, body);
  });
}

/**
 * Spread damage: `amount` to each Benched Pokémon of the named side, flat since §8.5 W/R never
 * apply on the Bench. `amount` arrives already scaled. A benched body's own reductions and
 * preventions still apply; the attacker's pre-W/R bonus is Active-only and does not. Never Knocks
 * Out: the KO sweep runs later, and an own-side Knock Out gives the opponent the Prize.
 */
function spreadDamage(
  state: GameState,
  target: "opponentBench" | "yourBench",
  amount: number,
  damagedOnly: boolean,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  // A switch so a new union member fails to compile instead of landing on the wrong side.
  const victim = ((): Seat => {
    switch (target) {
      case "yourBench":
        return ctx.seat;
      case "opponentBench":
        return otherSeat(ctx.seat);
    }
  })();
  const side = state.players[victim];
  if (side.bench.length === 0) return state;
  // Mimikyu "Safeguard" prevents spread damage too (no "Active Spot" clause) when
  // the attacker is an ex/V — the same gate the main hit runs.
  const attackerTop = activeTop(state, ctx.seat);
  // The in-play card, so shields read the attacker's current types.
  const attackerCard = attackerTop === null ? undefined : inPlayCardOf(state, attackerTop.active);
  // The attacker's pre-W/R debuffs reach the Bench while its bonuses don't: every printed bonus is
  // scoped to the opponent's Active, and no debuff names a target.
  const attackerDebuff =
    attackerTop === null
      ? 0
      : installedAttackDebuffOf(state, attackerTop.active) +
        opposingAttackDebuff(state, attackerTop.active) +
        // Gloomy Garbage: nothing here ignores effects on the target, so every holder counts.
        opposingToolAttackDebuff(state, attackerTop.active);
  const spread = Math.max(0, amount - attackerDebuff);
  // A fold because the coin-flip shield consumes rng: a spread into three holders is three flips,
  // each drawn from the state the last left.
  const bench: InPlayPokemon[] = [];
  // Tools this spread consumed (Berries, Survival Braces), discarded in the write-back below.
  const consumed: string[] = [];
  let rng = state.rngState;
  for (const pokemon of side.bench) {
    const uid = topUid(pokemon);
    if (uid === undefined) {
      bench.push(pokemon);
      continue;
    }
    // "That has any damage counters on it" is a targeting test: an undamaged body is not hit at
    // all. Checked before the shield coin so excluded bodies don't advance the rng.
    if (damagedOnly && !hasAnyDamageCounters(pokemon)) {
      bench.push(pokemon);
      continue;
    }
    const passives = passivesOf(state, pokemon);
    // The reduction is computed before `prevented` because a damage-capped block is read against
    // the amount that would actually be placed. A splash the debuff took to 0 never reaches the
    // after-W/R step, so no Berry applies or is spent.
    const berry =
      spread === 0 ? NO_CONSUMABLE : berryReductionOf(state, pokemon, attackerCard, ctx.seat);
    const reduction =
      berry.amount +
      passives.damageReductionAfterWR +
      attackerGatedReductionOf(
        state,
        pokemon,
        passives.damageReductionsFromAttacker,
        attackerCard,
        ctx.seat,
      ) +
      installedReductionOf(state, pokemon, attackerCard, attackerTop?.active) +
      seatDamageReduction(state, pokemon, "all", ctx.seat);
    // Next-turn vulnerability is added at the post-W/R step, but not to a splash the debuff took to
    // 0.
    const vulnerability = spread === 0 ? 0 : installedVulnerabilityOf(state, pokemon);
    const wouldDeal = Math.max(0, spread + vulnerability - reduction);
    // The pure preventions settle first; the coin-flip shield is asked afterwards on what is left.
    const preventedBeforeFlip =
      (passives.preventDamageFromExV && attackerCard !== undefined && isExOrV(attackerCard)) ||
      preventsAttackerType(passives.preventDamageFromTypes, attackerCard) ||
      // Cornerstone Stance has no Active Spot clause, so a benched holder is protected from a
      // spread.
      (passives.preventDamageFromHasAbility && hasPrintedAbility(attackerCard)) ||
      // `preventsAttackerClass` answers false for an unresolvable attacker, so no `!== undefined`
      // check is needed.
      preventsAttackerClass(passives.preventDamageFromAttackerClasses, attackerCard) ||
      preventsAttackerBanner(passives.preventDamageAndEffectsFromBanners, attackerCard) ||
      // Mighty Shell has no Active Spot clause, so a benched holder is protected from a spread.
      (passives.preventDamageAndEffectsFromSpecialEnergy &&
        attackerHasSpecialEnergy(state, attackerTop?.active)) ||
      // Plume Protection prints "attacks from your opponent's Pokémon", so an own-Bench spread
      // still lands.
      (passives.preventDamageWhileBenched && victim !== ctx.seat) ||
      // `passivesOf` already resolved the "on your Bench" clause.
      passives.preventDamageAndEffectsWhileBenched ||
      // The threshold is compared against this body's per-body amount, not the attack's printed
      // damage.
      preventedByDamageThreshold(passives.preventDamageAtOrAbove, wouldDeal) ||
      attackDamageBlocked(state, pokemon, attackerCard, wouldDeal, ctx, attackerTop?.active) ||
      // "all": a spread never ignores effects on the damaged body.
      benchShieldedFromDamage(state, pokemon, "all") ||
      // Ancient Bulwark: seat-gated, so an own-Bench spread lands.
      seatShieldedFromLowEnergyAttacker(state, pokemon, attackerTop?.active, ctx.seat, "all") ||
      stadiumPreventsDamage(state, pokemon, attackerCard);
    // Each coin is drawn from the loop's advanced rng, so every benched holder flips independently.
    const [flipPrevented, nextRng] = coinFlipShieldPrevents(
      { ...state, rngState: rng },
      pokemon,
      victim,
      preventedBeforeFlip ? 0 : wouldDeal,
      events,
    );
    rng = nextRng;
    const prevented = preventedBeforeFlip || flipPrevented;
    const dealt = prevented ? 0 : wouldDeal;
    // A spread is attack damage and reaches the Bench, so the KO-survival clamp applies. Passing
    // the attacker's seat means a Survival Brace only answers an opponent's attack.
    const clamped = koSurvivalClamp(state, pokemon, dealt, ctx.seat);
    // Tenacious Body's coin-flip survival, after the clamp, on the loop's rng.
    const [coinSaved, survivalRng] =
      clamped === null
        ? koSurvivalCoinFlip({ ...state, rngState: rng }, pokemon, victim, dealt, events)
        : [null, rng];
    rng = survivalRng;
    const damage = clamped?.damage ?? coinSaved ?? pokemon.damage + dealt;
    events.push({
      type: "DAMAGE_DEALT",
      seat: victim,
      vulnerability: vulnerability > 0 ? vulnerability : undefined,
      // On the `"yourBench"` arm the dealer and the damaged body's owner are the same seat.
      by: ctx.seat,
      uid,
      base: amount,
      debuff: attackerDebuff > 0 ? attackerDebuff : undefined,
      weakness: null,
      resistance: null,
      reduction: reduction > 0 ? reduction : undefined,
      prevented: prevented ? true : undefined,
      survived: clamped === null && coinSaved === null ? undefined : true,
      dealt,
      damage,
    });
    // Consumed Tools leave after the row that shows what they did: a Berry is spent on any
    // unprevented hit it reduced, a Brace only when the clamp used it.
    const spent = consumedTools(prevented ? [] : berry.toolUids, clamped);
    consumed.push(...spent);
    // Splash damage is attack damage, so it is recorded on the body (Juggernaut Horn).
    bench.push(
      withAttackDamageTaken(
        { ...consumeTools(pokemon, spent, victim, events), damage },
        state.turn,
        dealt,
      ),
    );
  }
  return withSide({ ...state, rngState: rng }, victim, {
    ...side,
    bench,
    discard: [...side.discard, ...consumed],
  });
}

/** Flips `count` coins for `ctx.seat`, announcing each before any is read. */
function flipCoinsFor(
  state: GameState,
  count: number,
  ctx: EffectContext,
  events: GameEvent[],
): [GameState, CoinFace[]] {
  const faces: CoinFace[] = [];
  let rngState = state.rngState;
  for (let flip = 0; flip < count; flip += 1) {
    const [drawn, advanced] = flipCoin(rngState);
    faces.push(drawn);
    rngState = advanced;
  }
  for (const drawn of faces)
    events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat: ctx.seat, result: drawn });
  return [{ ...state, rngState }, faces];
}

/**
 * Target Together: one coin per own body in play matching `filter`, then `amount × heads` to the
 * chosen `refs`.
 */
function perHeadsHit(
  state: GameState,
  op: OpOf<"damageChosen">,
  filter: CardFilter,
  refs: readonly PokemonRef[],
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): { done: GameState; schedule?: EffectOp[] } {
  // Reuses declined faces (`op.faces`) instead of new coins; otherwise flips, then offers Backtrack
  // Badge with a retry that keeps the same targets.
  const [flipped, faces] =
    op.faces === undefined
      ? flipCoinsFor(state, countPokemonInPlay(state, ctx.seat, filter), ctx, events)
      : [state, op.faces];
  const redo = op.faces === undefined ? coinRedoOffer(flipped, ctx, faces) : null;
  if (redo !== null) {
    return {
      done: flipped,
      schedule: [{ op: "reflipCoins", toolUid: redo, faces, retry: { ...op, hitRefs: [...refs] } }],
    };
  }
  const heads = faces.filter((face) => face === "heads").length;
  return {
    done: placeSnipe(
      flipped,
      refs,
      amount * heads,
      op.deals === true,
      op.ignoreWR === true,
      op.source,
      ctx,
      events,
      op.wrOnly === true,
    ),
  };
}

/**
 * Backtrack Badge: after a batch of attack coins, the uid of a Badge on the attacking body that may
 * re-flip them, or null. Only attack programs ask, so Trainer and Ability coins are never offered.
 */
function coinRedoOffer(
  state: GameState,
  ctx: EffectContext,
  faces: readonly CoinFace[],
): string | null {
  if (ctx.invokedBy !== "attack" || faces.length === 0) return null;
  const [ref] = sourceRef(state, ctx);
  const body = ref === undefined ? undefined : refPokemon(state, ref);
  return body === undefined ? null : coinRedoToolOf(state, body);
}

/**
 * The Backtrack Badge "you may" prompt, showing the faces it would ignore. Shared by `stepOp`'s
 * `reflipCoins` park and attack.ts's printed-coin park.
 */
export function coinRedoPrompt(
  state: GameState,
  toolUid: string,
  faces: readonly CoinFace[],
): EffectPrompt {
  const name = cardOf(state, toolUid)?.name ?? "Backtrack Badge";
  const these = faces.length === 1 ? "this coin flip" : `these ${String(faces.length)} coin flips`;
  return {
    kind: "confirm",
    note: `${name}: ignore ${these} (${faces.join(", ")}) and flip ${faces.length === 1 ? "that coin" : "those coins"} again?`,
    labels: { yes: "Flip again", no: "Keep the results" },
  };
}

function placeSnipe(
  state: GameState,
  refs: readonly PokemonRef[],
  amount: number,
  deals: boolean,
  printedIgnoreWR: boolean,
  source: "ability" | "attack" | "trainer", // Venture Bomb's Item placement
  ctx: EffectContext,
  events: GameEvent[],
  wrOnly: boolean, // The bare W/R tail: ignore Weakness and Resistance only
): GameState {
  if (amount <= 0) return state;
  const opponent = otherSeat(ctx.seat);
  // `ignoreWR` is only the form that also ignores effects on the target. The bare tail (`wrOnly`)
  // skips only Weakness and Resistance, so it takes the plain hit's path and passes `wrOnly` to
  // `snipeActive` for an Active pick.
  const ignoreWR = printedIgnoreWR && !wrOnly;
  // The Active target (`opponentAny` only). Weakness and Resistance apply only to the Active, so a
  // hit that lands there goes through W/R unlike a Bench target; `ignoreWR` (Feint Attack) skips
  // W/R and the reduction passive. A placement (`!deals`) uses `damageActive` instead, since a
  // placed counter is not attack damage and must not be doubled by Weakness or cut by Resistance.
  let next = state;
  if (refs.some((r) => r.seat === opponent && r.spot.spot === "active")) {
    next = deals
      ? snipeActive(next, amount, ignoreWR, ctx, events, wrOnly)
      : damageActive(next, amount, source, ctx, events);
  }
  // The attacker's own Active (a `yourAny` target). This is flat, like `damageSelf`: the attacker
  // is not the Defending Pokémon, so no Weakness, Resistance, reduction or §11 prevention applies,
  // and the KO-survival clamp is skipped. A `deals` hit files `DAMAGE_DEALT`; a placement files
  // `COUNTERS_PLACED`.
  if (refs.some((r) => r.seat === ctx.seat && r.spot.spot === "active")) {
    next = hitOwnActive(next, amount, deals, source, ctx, events);
  }
  // Bench targets are flat (no W/R), batched in one map so a count-N snipe lands together. The
  // victim seat is read off the refs, not assumed to be the opponent; every candidate set is
  // single-seated, so the seat is taken from the first benched ref.
  const benchVictim = refs.find((r) => r.spot.spot === "bench")?.seat ?? opponent;
  const targeted = new Set<number>();
  for (const ref of refs) {
    if (ref.seat === benchVictim && ref.spot.spot === "bench") targeted.add(ref.spot.index);
  }
  if (targeted.size === 0) return next;
  const side = next.players[benchVictim];
  // Mimikyu "Safeguard" — an ex/V attacker's Benched-target attack damage is
  // prevented too (the deals arm only; a placed counter below is not "damage").
  const attackerTop = activeTop(next, ctx.seat);
  // The attacker's in-play card: its types as the shields read them.
  const attackerCard = attackerTop === null ? undefined : inPlayCardOf(next, attackerTop.active);
  // The attacker's pre-W/R debuff applies to the `deals` arm only: a placed counter is not attack
  // damage. The always-on aura is not nulled by `ignoreWR` here, because its source is the
  // opponent's Active, not the benched pick.
  const sharedDebuff =
    attackerTop === null
      ? 0
      : installedAttackDebuffOf(next, attackerTop.active) +
        opposingAttackDebuff(next, attackerTop.active);
  // A fold rather than a map: the coin-flip shield draws once per damaged body and each draw
  // advances the state. The put-counter arm draws nothing, since a placed counter is not damage
  // done by attacks.
  const bench: InPlayPokemon[] = [];
  // The Tools the `deals` arm consumed (Berries, Survival Braces).
  const consumed: string[] = [];
  let rng = next.rngState;
  for (const [index, pokemon] of side.bench.entries()) {
    if (!targeted.has(index)) {
      bench.push(pokemon);
      continue;
    }
    const uid = topUid(pokemon);
    if (uid === undefined) {
      bench.push(pokemon);
      continue;
    }
    if (!deals) {
      // The default put-counter snipe: flat, no W/R and no reduction passive (a placed counter is
      // not damage from an attack). It is still refused by §11 effect prevention on the picked
      // body; an own-Bench pick is never refused.
      if (effectRefused(next, benchVictim, ctx, events, pokemon)) {
        bench.push(pokemon);
        continue;
      }
      // Battle Cage: the counters do not land on the Benched pick.
      if (benchCountersCaged(next, benchVictim, ctx)) {
        bench.push(pokemon);
        continue;
      }
      events.push({ type: "COUNTERS_PLACED", seat: benchVictim, uid, amount, source });
      bench.push({ ...pokemon, damage: pokemon.damage + amount });
      continue;
    }
    // Wo-Chien "Covetous Ivy": ATTACK DAMAGE to a Benched Pokémon — no Weakness/
    // Resistance (§8.5, Benched), but a benched reduction passive still applies,
    // exactly like spreadDamage. Emitted as DAMAGE_DEALT, so the log reads "dealt"
    // rather than "counters placed". Umbreon "Feint Attack" (`ignoreWR`) skips even
    // that reduction — its "not affected by any effects on that Pokémon" reaches a
    // Benched pick too.
    const targetPassives = passivesOf(next, pokemon);
    // Plus Gloomy Garbage; under `ignoreWR` a pick that is itself a holder drops its own term.
    const attackerDebuff =
      sharedDebuff +
      (attackerTop === null
        ? 0
        : opposingToolAttackDebuff(next, attackerTop.active, ignoreWR ? pokemon : undefined));
    // `ignoreWR` (Feint Attack, "not affected by any effects on that Pokémon") nulls the on-target
    // preventions and reductions, catalog and installed, including a Berry (a nulled Berry is not
    // spent). Off-target preventions (an aura sourced from another body, a Stadium) survive it; a
    // seat-wide aura is nulled only for the part the damaged body grants itself.
    const berry =
      ignoreWR || amount - attackerDebuff <= 0
        ? NO_CONSUMABLE
        : berryReductionOf(next, pokemon, attackerCard, ctx.seat);
    const reduction = ignoreWR
      ? seatDamageReduction(next, pokemon, "othersOnly", ctx.seat)
      : berry.amount +
        targetPassives.damageReductionAfterWR +
        // The attacker-gated reduction, on-target (`ignoreWR` nulls it).
        attackerGatedReductionOf(
          next,
          pokemon,
          targetPassives.damageReductionsFromAttacker,
          attackerCard,
          ctx.seat,
        ) +
        installedReductionOf(next, pokemon, attackerCard, attackerTop?.active) +
        seatDamageReduction(next, pokemon, "all", ctx.seat);
    // The debuff is not nulled by `ignoreWR`: it is an effect on the attacker, not on the target.
    // The damage cap reads this number, so it is computed below. The installed next-turn
    // vulnerability is added at the reduction step and nulled by `ignoreWR` with it; a pick the
    // debuff took to 0 is not a hit, so it does not land.
    const exposedBy =
      ignoreWR || amount - attackerDebuff <= 0 ? 0 : installedVulnerabilityOf(next, pokemon);
    const wouldDeal = Math.max(0, Math.max(0, amount - attackerDebuff) + exposedBy - reduction);
    const preventedBeforeFlip =
      (!ignoreWR &&
        ((targetPassives.preventDamageFromExV &&
          attackerCard !== undefined &&
          isExOrV(attackerCard)) ||
          preventsAttackerType(targetPassives.preventDamageFromTypes, attackerCard) ||
          // Catalog aura on the damaged Pokémon, so Feint Attack nulls it.
          (targetPassives.preventDamageFromHasAbility && hasPrintedAbility(attackerCard)) ||
          // Catalog aura on the damaged Pokémon, so Feint Attack nulls it.
          preventsAttackerClass(targetPassives.preventDamageFromAttackerClasses, attackerCard) ||
          // Sparkling Scales, inside the `ignoreWR` guard.
          preventsAttackerBanner(targetPassives.preventDamageAndEffectsFromBanners, attackerCard) ||
          // Catalog aura on the damaged Pokémon, so Feint Attack nulls it.
          (targetPassives.preventDamageAndEffectsFromSpecialEnergy &&
            attackerHasSpecialEnergy(next, attackerTop?.active)) ||
          // Plume Protection. Seat-gated: an own-Bench pick is not damaged by "attacks from your
          // opponent's Pokémon".
          (targetPassives.preventDamageWhileBenched && benchVictim !== ctx.seat) ||
          // Catalog aura on the damaged Pokémon, so Feint Attack nulls it.
          targetPassives.preventDamageAndEffectsWhileBenched ||
          // Feint Attack nulls this prevention, and its threshold is read against damage computed
          // without W/R or reduction.
          preventedByDamageThreshold(targetPassives.preventDamageAtOrAbove, wouldDeal) ||
          attackDamageBlocked(next, pokemon, attackerCard, wouldDeal, ctx, attackerTop?.active))) ||
      // Outside the `ignoreWR` guard because the shield usually comes from a different body;
      // `scope` nulls it only when the damaged body is the one granting it.
      benchShieldedFromDamage(next, pokemon, ignoreWR ? "othersOnly" : "all") ||
      // Ancient Bulwark; a Feint Attack snipe on the holder drops its own shield.
      seatShieldedFromLowEnergyAttacker(
        next,
        pokemon,
        attackerTop?.active,
        ctx.seat,
        ignoreWR ? "othersOnly" : "all",
      ) ||
      stadiumPreventsDamage(next, pokemon, attackerCard);
    // `ignoreWR` is folded into the argument so a nulled coin-flip shield draws no coin at all;
    // drawing and ignoring one would advance `rngState` and desync replays.
    const [flipPrevented, nextRng] = coinFlipShieldPrevents(
      { ...next, rngState: rng },
      pokemon,
      // The shielded body's seat, which is the sniped side and not necessarily the opponent's.
      benchVictim,
      preventedBeforeFlip || ignoreWR ? 0 : wouldDeal,
      events,
    );
    rng = nextRng;
    const prevented = preventedBeforeFlip || flipPrevented;
    const dealt = prevented ? 0 : wouldDeal;
    // §8.1 KO-survival clamp, on the `deals` arm only: placed counters are not damage from an
    // attack.
    const clamped = koSurvivalClamp(next, pokemon, dealt, ctx.seat);
    // Coin-flip survival, on the sniped body's seat.
    const [coinSaved, survivalRng] =
      clamped === null
        ? koSurvivalCoinFlip({ ...next, rngState: rng }, pokemon, benchVictim, dealt, events)
        : [null, rng];
    rng = survivalRng;
    const damage = clamped?.damage ?? coinSaved ?? pokemon.damage + dealt;
    // `by` is always the attacker; `seat` is the damaged body's, which equals the attacker's on a
    // `yourBench` snipe.
    events.push({
      type: "DAMAGE_DEALT",
      seat: benchVictim,
      vulnerability: exposedBy > 0 ? exposedBy : undefined,
      by: ctx.seat, // The attacker, which is also `seat` on the own-side arm.
      uid,
      base: amount,
      debuff: attackerDebuff > 0 ? attackerDebuff : undefined,
      weakness: null,
      resistance: null,
      reduction: reduction > 0 ? reduction : undefined,
      prevented: prevented ? true : undefined,
      survived: clamped === null && coinSaved === null ? undefined : true,
      dealt,
      damage,
    });
    const spent = consumedTools(prevented ? [] : berry.toolUids, clamped);
    consumed.push(...spent);
    bench.push(
      withAttackDamageTaken(
        { ...consumeTools(pokemon, spent, benchVictim, events), damage },
        next.turn,
        dealt,
      ),
    );
  }
  return withSide({ ...next, rngState: rng }, benchVictim, {
    ...side,
    bench,
    discard: [...side.discard, ...consumed],
  });
}

/**
 * The own-side Active arm of a `yourAny` snipe. Flat on both arms, like `damageSelf`: no Weakness,
 * Resistance, reduction or §11 prevention. A `deals` hit files `DAMAGE_DEALT`, a placement files
 * `COUNTERS_PLACED`. Note the own-side Bench bodies go through `placeSnipe`'s full funnel, so the
 * two zones currently read shields and the KO clamp differently.
 */
function hitOwnActive(
  state: GameState,
  amount: number,
  deals: boolean,
  source: "ability" | "attack" | "trainer", // Venture Bomb's Item placement.
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const damage = active.damage + amount;
  if (!deals) {
    events.push({ type: "COUNTERS_PLACED", seat: ctx.seat, uid, amount, source });
    return withActive(state, ctx.seat, { ...active, damage });
  }
  events.push({
    type: "DAMAGE_DEALT",
    seat: ctx.seat,
    by: ctx.seat,
    uid,
    base: amount,
    weakness: null,
    resistance: null,
    dealt: amount,
    damage,
  });
  return withActive(state, ctx.seat, { ...active, damage });
}

/**
 * The Active-target arm of an `opponentAny` snipe. Runs the full §8.5 pipeline (base plus the
 * attacker's pre-W/R bonus, ×Weakness, −Resistance, −reduction, floored at 0). `ignoreWR` (Feint
 * Attack) nulls W/R and the target's reduction but keeps the attacker's own bonus, which is an
 * effect on the attacker.
 */
function snipeActive(
  state: GameState,
  amount: number,
  ignoreWR: boolean,
  ctx: EffectContext,
  events: GameEvent[],
  // `wrOnly` skips only Weakness and Resistance; every effect on the target still applies.
  // Defaulted for the `damageDefender` callers, whose hit always goes through W/R.
  wrOnly = false,
): GameState {
  const opponent = otherSeat(ctx.seat);
  // Both spots as in-play cards, so W/R and type-keyed shields read the types each body has in
  // play.
  const target = activeInPlay(state, opponent);
  if (target === null) return state;
  const attacker = activeInPlay(state, ctx.seat);
  // Also folds the attacker's all-attacks next-turn buff (null attack index only, since
  // `EffectContext` carries none) and this turn's side-wide bonus against an opponent's Active
  // Pokémon ex. Neither is touched by `ignoreWR`: they are effects on the attacking side.
  const bonus =
    attacker === null
      ? 0
      : attackerPreWRBonus(state, attacker.active, ctx.seat, target.card) +
        everyAttackBoostOf(state, attacker.active) +
        sideAttackBonusThisTurn(state, ctx.seat, target.card, attacker.active);
  // The attacker's pre-W/R debuff is not bypassed by `ignoreWR` (an effect on the attacker). The
  // always-on aura half is nulled here, because its source is the opponent's Active, which is this
  // arm's target.
  const debuff =
    attacker === null
      ? 0
      : installedAttackDebuffOf(state, attacker.active) +
        (ignoreWR ? 0 : opposingAttackDebuff(state, attacker.active)) +
        // Gloomy Garbage: `ignoreWR` drops only the target's own term.
        opposingToolAttackDebuff(state, attacker.active, ignoreWR ? target.active : undefined);
  // Weakness is skipped under `ignoreWR`, a "no Weakness" aura on the target's seat (Blooming
  // Garden), or the target's installed no-Weakness effect; Resistance still applies. `attacker ===
  // null` must stay an operand of this `const` so TypeScript narrows `attacker` on the next line.
  const noWeakness =
    ignoreWR ||
    attacker === null ||
    seatRemovesWeakness(state, opponent) ||
    installedNoWeakness(state, target.active);
  // Weakness retype and the opponent-side Weakness rewrite, applied after the null paths as at the
  // main hit. `wrOnly` nulls Weakness and Resistance only.
  const weakness =
    noWeakness || wrOnly
      ? null
      : // Illumise "Supereffective Pheromones", as at the main hit.
        withWeaknessAmount(
          weaknessOf(
            attacker.card,
            target.card,
            installedWeaknessRetypeOf(state, target.active),
            // Overwriting Bolt's installed rewrite first.
            installedWeaknessRewriteOf(state, target.active) ??
              seatWeaknessRewrite(state, opponent, target.card),
          ),
          weaknessAmountOverride(state),
        );
  const resistance =
    ignoreWR || wrOnly || attacker === null ? null : resistanceOf(attacker.card, target.card);
  // The pre-W/R clamp is attack.ts's, for its reason verbatim: an attack does not
  // do negative damage, and the printed parenthetical puts the subtraction here.
  const afterWR = Math.max(
    0,
    applyDamageModifier(
      applyDamageModifier(Math.max(0, amount + bonus - debuff), weakness),
      resistance,
    ),
  );
  const targetPassives = passivesOf(state, target.active);
  // Mimikyu "Safeguard" and other on-target preventions (catalog, installed, Berry) are bypassed by
  // `ignoreWR`; a nulled Berry is not spent. Off-target preventions such as Neutralization Zone sit
  // outside the guard.
  const berry =
    ignoreWR || amount + bonus <= debuff
      ? NO_CONSUMABLE
      : berryReductionOf(state, target.active, attacker?.card, ctx.seat);
  const reduction = ignoreWR
    ? seatDamageReduction(state, target.active, "othersOnly", ctx.seat)
    : berry.amount +
      targetPassives.damageReductionAfterWR +
      // The attacker-gated reduction, on-target (`ignoreWR` nulls it).
      attackerGatedReductionOf(
        state,
        target.active,
        targetPassives.damageReductionsFromAttacker,
        attacker?.card,
        ctx.seat,
      ) +
      installedReductionOf(state, target.active, attacker?.card, attacker?.active) +
      seatDamageReduction(state, target.active, "all", ctx.seat);
  // The damage cap reads the number that would actually be placed, so `prevented` is computed after
  // the reduction. The installed next-turn vulnerability is added after Weakness and nulled by
  // `ignoreWR`, and does not apply when the pre-W/R sum is 0 or less (damage step 2 stops).
  const activeExposure =
    ignoreWR || amount + bonus - debuff <= 0 ? 0 : installedVulnerabilityOf(state, target.active);
  const wouldDeal = Math.max(0, afterWR + activeExposure - reduction);
  const preventedBeforeFlip =
    (!ignoreWR &&
      ((targetPassives.preventDamageFromExV && attacker !== null && isExOrV(attacker.card)) ||
        preventsAttackerType(targetPassives.preventDamageFromTypes, attacker?.card) ||
        // `attacker?.card`: an unresolvable attacker answers false (protects less).
        (targetPassives.preventDamageFromHasAbility && hasPrintedAbility(attacker?.card)) ||
        // `attacker?.card`: an unresolvable attacker protects less rather than more.
        preventsAttackerClass(targetPassives.preventDamageFromAttackerClasses, attacker?.card) ||
        // Sparkling Scales, inside the `ignoreWR` guard.
        preventsAttackerBanner(targetPassives.preventDamageAndEffectsFromBanners, attacker?.card) ||
        // `attacker?.active`: an unresolvable attacker answers false.
        (targetPassives.preventDamageAndEffectsFromSpecialEnergy &&
          attackerHasSpecialEnergy(state, attacker?.active)) ||
        // Plume Protection, the damage-only twin.
        targetPassives.preventDamageWhileBenched ||
        // Always false here (the target is the Active); kept for totality.
        targetPassives.preventDamageAndEffectsWhileBenched ||
        preventedByDamageThreshold(targetPassives.preventDamageAtOrAbove, wouldDeal) ||
        attackDamageBlocked(
          state,
          target.active,
          attacker?.card,
          wouldDeal,
          ctx,
          attacker?.active,
        ))) ||
    // Always false here: the target clause reads "your Benched Pokémon"; kept for totality.
    benchShieldedFromDamage(state, target.active, "all") ||
    // Ancient Bulwark: the holder is benched, so it is never the target here.
    seatShieldedFromLowEnergyAttacker(state, target.active, attacker?.active, ctx.seat, "all") ||
    stadiumPreventsDamage(state, target.active, attacker?.card);
  // `ignoreWR` folds into the argument so a nulled shield draws no coin.
  const [flipPrevented, rngState] = coinFlipShieldPrevents(
    state,
    target.active,
    opponent,
    preventedBeforeFlip || ignoreWR ? 0 : wouldDeal,
    events,
  );
  const prevented = preventedBeforeFlip || flipPrevented;
  const dealt = prevented ? 0 : wouldDeal;
  // §8.1 KO-survival clamp; this arm is damage from an attack.
  const clamped = koSurvivalClamp(state, target.active, dealt, ctx.seat);
  // Coin-flip survival, on the shield's advanced rng.
  const [coinSaved, survivalRng] =
    clamped === null
      ? koSurvivalCoinFlip({ ...state, rngState }, target.active, opponent, dealt, events)
      : [null, rngState];
  const damage = clamped?.damage ?? coinSaved ?? target.active.damage + dealt;
  events.push({
    type: "DAMAGE_DEALT",
    seat: opponent,
    by: ctx.seat,
    uid: target.uid,
    base: amount,
    bonus: bonus > 0 ? bonus : undefined,
    debuff: debuff > 0 ? debuff : undefined,
    weakness,
    resistance,
    reduction: reduction > 0 ? reduction : undefined,
    vulnerability: activeExposure > 0 ? activeExposure : undefined,
    prevented: prevented ? true : undefined,
    survived: clamped === null && coinSaved === null ? undefined : true,
    dealt,
    damage,
  });
  // The consumed Tools leave the sniped Active for its owner's discard pile, after the row.
  const spent = consumedTools(prevented ? [] : berry.toolUids, clamped);
  // Recorded on the sniped Active (Juggernaut Horn).
  const struck = withActive(
    { ...state, rngState: survivalRng },
    opponent,
    withAttackDamageTaken(
      { ...consumeTools(target.active, spent, opponent, events), damage },
      state.turn,
      dealt,
    ),
  );
  const hit = discardToPile(struck, opponent, spent);
  // §9: the recoil and "is damaged by an attack" reactions are seeded here because some attacks
  // re-home their main hit into a `damageDefender` op, bypassing attack.ts's own seeding. Only this
  // Active funnel seeds them, not `placeSnipe`; a benched Orthworm ex therefore does not retaliate
  // (a known deviation). Gated on `invokedBy === "attack"`.
  return dealt > 0 && ctx.invokedBy === "attack"
    ? reactToAttackDamage(hit, opponent, target.uid, ctx.seat, target.active, dealt, events)
    : hit;
}

/**
 * §9: the reactions a damaged Active owes the attacker: flat recoil outside the pipeline, and a
 * trigger stage (which can park). The stage is spliced in front of the KO-tool trigger and
 * epilogue, not appended, so it runs before the Knock Out sweep. Seeded at most once per body,
 * checked by scanning `pending`.
 */
function reactToAttackDamage(
  state: GameState,
  damagedSeat: Seat,
  damagedUid: string,
  attackerSeat: Seat,
  damagedBody: InPlayPokemon,
  damageTaken: number,
  events: GameEvent[],
): GameState {
  // Tool reactions, in attack.ts's main-hit order: recoil and Ability stage first, then Deluxe
  // Bomb's counters, then one `damagedTrigger` stage per Tool with an `onDamagedByAttack` program,
  // landing behind the Ability's.
  const reacted = reactWithRecoilAndAbility(
    state,
    damagedSeat,
    damagedUid,
    attackerSeat,
    damagedBody,
    damageTaken,
    events,
  );
  return queueDamagedToolStages(
    detonateDeluxeBomb(reacted, damagedSeat, damagedBody, attackerSeat, damageTaken, events),
    damagedSeat,
    damagedUid,
  );
}

/**
 * The recoil and Ability-stage half of `reactToAttackDamage`, split out so the Ability's early
 * return cannot skip the Tool reactions.
 */
function reactWithRecoilAndAbility(
  state: GameState,
  damagedSeat: Seat,
  damagedUid: string,
  attackerSeat: Seat,
  damagedBody: InPlayPokemon,
  // `dealt` is passed from the caller so the gate and the installed recoil amount can never
  // disagree.
  damageTaken: number,
  events: GameEvent[],
): GameState {
  let next = state;
  const attacker = activeTop(next, attackerSeat);
  // Plus the watched-Active recoil (Spiteful Swirl, Counterattack Grouping).
  const damagedPassives = withWatchedRecoil(
    next,
    damagedSeat,
    damagedBody,
    passivesOf(next, damagedBody),
  );
  // Luminous Wing on the attacker refuses the Ability share.
  const refusedRecoil =
    attacker !== null && passivesOf(next, attacker.active).preventAbilityEffects
      ? damagedPassives.damageAttackerFromAbility
      : 0;
  if (attacker !== null && refusedRecoil > 0) {
    events.push({ type: "ABILITY_EFFECT_PREVENTED", seat: attackerSeat, uid: attacker.uid });
  }
  const recoil =
    damagedPassives.damageAttacker -
    refusedRecoil +
    installedRecoilOf(next, damagedBody, damageTaken);
  if (attacker !== null && recoil > 0) {
    next = withActive(next, attackerSeat, {
      ...attacker.active,
      damage: attacker.active.damage + recoil,
    });
    events.push({
      type: "COUNTERS_PLACED",
      seat: attackerSeat,
      uid: attacker.uid,
      amount: recoil,
      source: "counterattack",
    });
  }
  if (damagedByAttackAbility(next, damagedSeat, damagedUid) === undefined) return next;
  if (
    next.pending.some(
      (stage) =>
        stage.kind === "damagedTrigger" && stage.seat === damagedSeat && stage.uid === damagedUid,
    )
  ) {
    return next;
  }
  const stage: PendingStage = { kind: "damagedTrigger", seat: damagedSeat, uid: damagedUid };
  const ahead = next.pending.findIndex(
    (queued) => queued.kind === "koToolTrigger" || queued.kind === "attackEpilogue",
  );
  return {
    ...next,
    pending:
      ahead === -1
        ? [...next.pending, stage]
        : [...next.pending.slice(0, ahead), stage, ...next.pending.slice(ahead)],
  };
}

/**
 * §9: queue one `damagedTrigger` stage per in-effect Tool on the damaged Active with an
 * `onDamagedByAttack` program, `uid` = the Tool's uid, spliced in front of the KO-tool trigger and
 * epilogue (behind any Ability stage), at most once per Tool.
 */
function queueDamagedToolStages(
  state: GameState,
  damagedSeat: Seat,
  damagedUid: string,
): GameState {
  let queued = state;
  for (const { toolUid } of damagedToolTriggersOf(state, damagedSeat, damagedUid)) {
    const already = queued.pending.some(
      (stage) => stage.kind === "damagedTrigger" && stage.uid === toolUid,
    );
    if (already) continue;
    const toolStage: PendingStage = { kind: "damagedTrigger", seat: damagedSeat, uid: toolUid };
    const tail = queued.pending.findIndex(
      (stage) => stage.kind === "koToolTrigger" || stage.kind === "attackEpilogue",
    );
    const pending = [...queued.pending];
    pending.splice(tail === -1 ? pending.length : tail, 0, toolStage);
    queued = { ...queued, pending };
  }
  return queued;
}

/**
 * §9 Deluxe Bomb: put its counters on `attackerSeat`'s Active and discard every Bomb that paid. A
 * separate `COUNTERS_PLACED` row from the recoil, so the discard names its card. No attacker in the
 * Active Spot means nothing is placed or discarded.
 */
export function detonateDeluxeBomb(
  state: GameState,
  damagedSeat: Seat,
  damagedBody: InPlayPokemon,
  attackerSeat: Seat,
  dealt: number,
  events: GameEvent[],
): GameState {
  // `dealt` is the hit's damage, for Tremendous Bomb's "takes 240 or more damage".
  const bomb = deluxeBombOf(state, damagedBody, attackerSeat, dealt);
  const attacker = activeTop(state, attackerSeat);
  if (bomb.amount === 0 || attacker === null) return state;
  const bombed = withActive(state, attackerSeat, {
    ...attacker.active,
    damage: attacker.active.damage + bomb.amount,
  });
  events.push({
    type: "COUNTERS_PLACED",
    seat: attackerSeat,
    uid: attacker.uid,
    amount: bomb.amount,
    source: "counterattack",
  });
  // The damaged Active is still in its spot: both callers run before any §8.1 sweep.
  const holder = bombed.players[damagedSeat].active as InPlayPokemon;
  return discardToPile(
    withActive(bombed, damagedSeat, consumeTools(holder, bomb.toolUids, damagedSeat, events)),
    damagedSeat,
    bomb.toolUids,
  );
}

/**
 * The Tools one §8.5 hit consumed: the Berries that reduced it (empty for a prevented hit) and the
 * Survival Brace the clamp used, if any.
 */
export function consumedTools(berryUids: readonly string[], clamped: KoSurvival | null): string[] {
  return clamped?.toolUid === undefined ? [...berryUids] : [...berryUids, clamped.toolUid];
}

/**
 * Strip the `spent` Tools off `pokemon` and file one `TOOLS_DISCARDED { when: "consumed" }` row
 * under the holder's owner. The caller appends the uids to that owner's discard pile. Nothing spent
 * returns the body unchanged.
 */
export function consumeTools(
  pokemon: InPlayPokemon,
  spent: readonly string[],
  seat: Seat,
  events: GameEvent[],
): InPlayPokemon {
  if (spent.length === 0) return pokemon;
  events.push({
    type: "TOOLS_DISCARDED",
    seat,
    actor: seat,
    uids: [...spent],
    host: topUid(pokemon) ?? "",
    when: "consumed",
  });
  return { ...pokemon, tools: pokemon.tools.filter((uid) => !spent.includes(uid)) };
}

/** Append `uids` to `seat`'s discard pile (§7.4: a discarded Tool goes to its owner's pile). */
export function discardToPile(state: GameState, seat: Seat, uids: readonly string[]): GameState {
  const side = state.players[seat];
  return withSide(state, seat, { ...side, discard: [...side.discard, ...uids] });
}

/**
 * The effective snipe amount: `amount`, or `amount` times a board count when the op scales.
 * Parallel to attack.ts's pre-W/R fold, which cannot be reused (import cycle, needs the attack
 * cost). The riders are mutually exclusive. `perDamageCounterOnTarget` needs the chosen ref; called
 * without one (the park caption) it returns the bare amount. A null attacker or empty count folds
 * to 0, so no pick and no damage. Riders that return must sit above the `perEnergyOnSelf` line,
 * which returns unconditionally.
 */
function snipeAmount(
  op: {
    amount: number;
    perTakenPrize?: true;
    perEnergyOnSelf?: true;
    perRecorded?: EffectSlot;
    perDamageCounterOnTarget?: true;
    perDiscardPileCard?: CardFilter;
    perTypedEnergyOnSelf?: BasicEnergyType;
  },
  state: GameState,
  ctx: EffectContext,
  record: EffectRecord,
  target?: PokemonRef,
): number {
  if (op.perDamageCounterOnTarget === true) {
    if (target === undefined) return op.amount;
    const body = refPokemon(state, target);
    return body === undefined ? 0 : op.amount * damageCountersOn(body);
  }
  if (op.perTakenPrize === true) return op.amount * takenPrizes(state, otherSeat(ctx.seat));
  // "For each Energy card you discarded in this way" counts what the sentence's own head produced,
  // so it reads the run's §9.2 record rather than the board; the park carries the record, so
  // caption and hit agree.
  if (op.perRecorded !== undefined) return op.amount * recorded(record, op.perRecorded).length;
  // Typed twin of `perEnergyOnSelf` (Bug's Cannon, Hydro Jet): the attacker's Energy cards
  // providing the printed type. Must sit above that line, which returns for every other op.
  if (op.perTypedEnergyOnSelf !== undefined) {
    const typedHolder = activeTop(state, ctx.seat);
    return typedHolder === null
      ? 0
      : op.amount * countAttachedEnergy(state, typedHolder.active, op.perTypedEnergyOnSelf);
  }
  // Must sit above the `perEnergyOnSelf` line, which returns unconditionally.
  if (op.perDiscardPileCard !== undefined)
    return op.amount * countCardsInDiscardPile(state, ctx.seat, op.perDiscardPileCard);
  if (op.perEnergyOnSelf !== true) return op.amount;
  const thisPokemon = activeTop(state, ctx.seat);
  return thisPokemon === null
    ? 0
    : op.amount * countAttachedEnergy(state, thisPokemon.active, null);
}

/** The choosePokemonMulti prompt string. For the put-counter snipe, counters are
    the printed unit, so the HP `amount` reads back as counters (one counter = 10
    HP, §12); for a `deals` hit (Wo-Chien "Covetous Ivy") the printed unit is
    damage. The heading quotes the card: a bare "Choose 2" for the exact pick every
    consumer prints, and "you may" only where the card says it (an optional trigger,
    whose decline the dialog offers as taking none). Never "up to". */
function snipeNote(
  amount: number,
  count: number,
  optional: boolean,
  deals: boolean,
  /**
   * Widened for `yourAny`; unreachable today because that op is `count: "all"` and takes the forced
   * branch, but the caption must read correctly once a park reaches it.
   */
  target: "opponentBench" | "opponentAny" | "yourBench" | "yourAny" = "opponentBench",
  /** `op.damagedOnly`: the caption must name exactly the set the prompt offers. */
  damagedOnly = false,
  /**
   * `op.filter`: the caption names the narrowed candidate class via `retrieveNoun`, writing the
   * zone word once ("Benched Pokémon ex or Pokémon V").
   */
  narrowing?: CardFilter,
  /**
   * `op.perDamageCounterOnTarget`: the amount depends on the unchosen body, so the caption quotes
   * the rule ("20 damage for each damage counter on it") instead of a number.
   */
  perDamageCounterOnTarget = false,
  /**
   * `op.perHeadsInPlay`: coins are flipped after the pick, so the caption quotes the rule ("50
   * damage for each heads").
   */
  perHeads = false,
  /** `op.specialEnergyOnly`: the caption names the narrowed set. */
  specialEnergyOnly = false,
): string {
  const verb = optional ? "You may choose" : "Choose";
  const each = deals
    ? `${amount} damage`
    : `${Math.round(amount / HP_PER_COUNTER)} damage counter${Math.round(amount / HP_PER_COUNTER) === 1 ? "" : "s"}`;
  // `opponentAny` offers the Active too, so the heading drops "Benched".
  const noun = narrowing === undefined ? "Pokémon" : retrieveNoun(narrowing).plural;
  // `yourAny` drops "Benched" like `opponentAny`: the candidate set includes the Active.
  const zone = target === "opponentAny" || target === "yourAny" ? noun : `Benched ${noun}`;
  // The heading names whose Pokémon they are, since `yourBench` and `yourAny` offer the attacker's
  // own bodies.
  const owner = target === "yourBench" || target === "yourAny" ? "your" : "your opponent's";
  // The window follows the noun, as printed. Singular only: the clause is only accepted with a
  // count of 1.
  const window = damagedOnly
    ? " that has any damage counters on it"
    : specialEnergyOnly
      ? " that has any Special Energy attached"
      : "";
  if (perDamageCounterOnTarget) {
    // `each` rather than `${amount} damage`: a placement (Spiritomb "Spiritual End") quotes
    // counters per counter already there.
    return `${verb} ${count} of ${owner} ${zone}${window} (${each} for each damage counter on it).`;
  }
  if (perHeads)
    return `${verb} ${count} of ${owner} ${zone}${window} (${amount} damage for each heads).`;
  return `${verb} ${count} of ${owner} ${zone}${window} (${each} each).`;
}

/**
 * The heading for healChosen's "up to N" park, quoting the card, with `max` already clamped to the
 * board (§8.6). The heading must describe the candidates it was built from.
 */
function healUpToNote(amount: number | "all", max: number, zoneWord: string): string {
  const what = amount === "all" ? "all damage" : `${amount} damage`;
  return `Choose up to ${max} of your ${zoneWord}Pokémon and heal ${what} from each of them.`;
}

/**
 * The one place a healed body is written, and so the one place `healedTurn` is stamped; callers
 * file the `HEALED` event alongside. `healed` is already clamped and positive, so the stamp means
 * damage was actually removed. `turn` is passed because some callers have no state in scope.
 */
function healedBody(pokemon: InPlayPokemon, healed: number, turn: number): InPlayPokemon {
  return { ...pokemon, damage: pokemon.damage - healed, healedTurn: turn };
}

/**
 * Heal `amount` from each of the controller's own in-play Pokémon, Active then Bench. Each heal is
 * clamped and emits its own HEALED (0 emits nothing). Never parks. `pokemonType`, `basicOnly` and
 * similar filters skip non-matching bodies, reading the in-play top card; an unresolvable card is
 * never healed. `benchOnly` skips the Active entirely.
 */
function healEach(
  state: GameState,
  op: OpOf<"healEach">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // The op is passed whole because the set is narrowed on several independent axes.
  const { amount, pokemonType } = op;
  const side = state.players[ctx.seat];
  const healOne = (pokemon: InPlayPokemon): InPlayPokemon => {
    // "Basic" via `matchesFilter`, so board-side Basic is one predicate; an unresolvable top card
    // is skipped, never healed.
    if (op.basicOnly === true) {
      const card = topCardOf(state, pokemon);
      if (!matchesFilter(card, { kind: "basicPokemon" })) return pokemon;
    }
    if (pokemonType !== undefined) {
      // The in-play types (`inPlayCardOf`).
      const card = inPlayCardOf(state, pokemon);
      if (!(card?.types ?? []).includes(pokemonType)) return pokemon;
    }
    // "Evolution", via `matchesFilter` (an unresolvable top card is skipped).
    if (op.evolutionOnly === true) {
      const card = topCardOf(state, pokemon);
      if (!matchesFilter(card, { kind: "evolutionPokemon" })) return pokemon;
    }
    // "Tera" (TM Fluorite).
    if (op.banner !== undefined) {
      const card = topCardOf(state, pokemon);
      if (!matchesFilter(card, { kind: "bannerPokemon", banner: op.banner })) return pokemon;
    }
    const uid = topUid(pokemon);
    if (healLocked(state, pokemon)) return pokemon; // Life-Locked. `"all"` is this body's own damage, so the clamp is a no-op.
    const healed = Math.min(amount === "all" ? pokemon.damage : amount, pokemon.damage);
    if (uid === undefined || healed <= 0) return pokemon;
    events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
    return healedBody(pokemon, healed, state.turn);
  };
  // "Benched" removes the Active from the set but keeps its body unchanged.
  const healsActive = op.benchOnly !== true;
  const active = side.active !== null && healsActive ? healOne(side.active) : side.active;
  const bench = side.bench.map(healOne);
  return withSide(state, ctx.seat, { ...side, active, bench });
}

/**
 * Dachsbun ex: "If you healed any damage in this way, discard all Energy from those Pokémon." Runs
 * after the heal walk; "those Pokémon" are the bodies whose damage fell, so a body that healed 0
 * keeps its Energy. One `ENERGY_DISCARDED` per body, after every `HEALED`, in board order.
 */
function discardEnergyFromHealed(
  before: GameState,
  after: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const was = before.players[ctx.seat];
  const now = after.players[ctx.seat];
  const pairs: [InPlayPokemon | null | undefined, InPlayPokemon | null | undefined][] = [
    [was.active, now.active],
    ...was.bench.map((body, i): [InPlayPokemon, InPlayPokemon | undefined] => [body, now.bench[i]]),
  ];
  const energy = pairs.flatMap(([b, a]) =>
    b !== null && b !== undefined && a !== null && a !== undefined && a.damage < b.damage
      ? a.energy
      : [],
  );
  if (energy.length === 0) return after;
  return discardEnergyApply(
    after,
    energy,
    { op: "discardEnergy", from: "yours", filter: { kind: "anyEnergy" }, count: "all" },
    ctx,
    events,
  ).state;
}

/** Heal `amount` HP from EVERY in-play Pokémon on BOTH boards (Picnic Basket).
    Seat-blind twin of `healEach`: each heal is clamped to that Pokémon's damage
    and emits its own HEALED tagged with that Pokémon's own seat (an undamaged
    Pokémon heals 0 and emits nothing). Active then bench per seat, p1 then p2.
    Never parks. */
function healEachAll(state: GameState, amount: number, events: GameEvent[]): GameState {
  let next = state;
  for (const seat of SEATS) {
    const side = next.players[seat];
    const healOne = (pokemon: InPlayPokemon): InPlayPokemon => {
      const uid = topUid(pokemon);
      if (healLocked(state, pokemon)) return pokemon; // Life-Locked
      const healed = Math.min(amount, pokemon.damage);
      if (uid === undefined || healed <= 0) return pokemon;
      events.push({ type: "HEALED", seat, uid, amount: healed });
      return healedBody(pokemon, healed, state.turn);
    };
    const active = side.active === null ? null : healOne(side.active);
    const bench = side.bench.map(healOne);
    next = withSide(next, seat, { ...side, active, bench });
  }
  return next;
}

/**
 * Put `amount` HP of damage counters on every in-play body on the seats `op.side` selects that
 * matches `filter`, except any named `exceptNamed` (Froslass "Freezing Shroud"). The exemption is a
 * subtraction checked after the filter, so an unresolvable card fails the filter first. `amount` is
 * already HP (§12) and `amount <= 0` is refused. Never KOs; the caller sweeps. §11 is asked per
 * body, after narrowing.
 */
function counterEachAll(
  state: GameState,
  op: OpOf<"counterEachAll">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // `printedAmount` is the printed figure; `amount` is the per-body one below.
  const { amount: printedAmount, filter, exceptNamed } = op;
  if (printedAmount <= 0) return state;
  const walked = ((): readonly Seat[] => {
    switch (op.side) {
      case "both":
        return SEATS;
      case "opponent":
        return [otherSeat(ctx.seat)];
    }
  })();
  let next = state;
  for (const seat of walked) {
    const board = next.players[seat];
    const counterOne = (pokemon: InPlayPokemon): InPlayPokemon => {
      // The in-play card, for a typed filter.
      const card = inPlayCardOf(next, pokemon);
      if (!matchesFilter(card, filter)) return pokemon;
      if (exceptNamed !== undefined && card?.name === exceptNamed) return pokemon;
      // Snow Coating: the printed amount once per counter already on this body, read before it
      // changes; a body with none takes nothing and is not asked §11.
      const amount =
        op.perDamageCounterOnTarget === true
          ? printedAmount * damageCountersOn(pokemon)
          : printedAmount;
      if (amount <= 0) return pokemon;
      if (op.damagedOnly === true && !hasAnyDamageCounters(pokemon)) return pokemon;
      const uid = topUid(pokemon);
      if (uid === undefined) return pokemon;
      if (effectRefused(next, seat, ctx, events, pokemon)) return pokemon;
      // Battle Cage, on a Benched body only.
      if (pokemon !== board.active && benchCountersCaged(next, seat, ctx)) return pokemon;
      events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: op.source });
      return { ...pokemon, damage: pokemon.damage + amount };
    };
    const active = board.active === null ? null : counterOne(board.active);
    const bench = board.bench.map(counterOne);
    next = withSide(next, seat, { ...board, active, bench });
  }
  return next;
}

/**
 * Put damage counters on the opponent's bodies in `op.target` until each one's remaining HP is
 * `op.remainingHp` (Alolan Raticate, Palossand ex). The amount is computed per body from
 * `effectiveMaxHp − damage`, so HP modifiers count. A body already at or below the destination
 * takes nothing. `op.remainingHp <= 0` is guarded so this can never Knock Out. No rounding to whole
 * counters, and a null max HP places nothing. §11 is asked per body, only for bodies that would
 * take counters.
 */
function counterUntilRemainingHp(
  state: GameState,
  op: OpOf<"counterUntilRemainingHp">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (op.remainingHp <= 0) return state;
  const victim = otherSeat(ctx.seat);
  const board = state.players[victim];
  const fillOne = (pokemon: InPlayPokemon): InPlayPokemon => {
    const max = effectiveMaxHp(state, pokemon);
    if (max === null) return pokemon;
    // THE SUBTRACTION, INSIDE THE CLOSURE — this is the distributive "its".
    const placed = max - pokemon.damage - op.remainingHp;
    if (placed <= 0) return pokemon;
    const uid = topUid(pokemon);
    if (uid === undefined) return pokemon;
    if (effectRefused(state, victim, ctx, events, pokemon)) return pokemon;
    // Battle Cage, on a Benched body only.
    if (pokemon !== board.active && benchCountersCaged(state, victim, ctx)) return pokemon;
    events.push({
      type: "COUNTERS_PLACED",
      seat: victim,
      uid,
      amount: placed,
      source: op.source,
    });
    return { ...pokemon, damage: pokemon.damage + placed };
  };
  // The ZONE is the printed noun and nothing else: "Active Pokémon" is one body (or
  // none, between a Knock Out and a promotion), "each of your opponent's Benched
  // Pokémon" is the whole Bench and never the Active.
  if (op.target === "opponentActive") {
    if (board.active === null) return state;
    return withActive(state, victim, fillOne(board.active));
  }
  return withSide(state, victim, { ...board, bench: board.bench.map(fillOne) });
}

/**
 * Put `amount` HP of damage counters on the opponent's Active (Trevenant "Forest Miasma", Mimikyu
 * "Ghost Eye"). Placed counters are not attack damage, even when printed on an attack: no W/R and
 * no reduction passive. `amount` is already HP. `source` rides the op because this function cannot
 * know the provenance. Never KOs; the caller sweeps.
 */
function damageActive(
  state: GameState,
  amount: number,
  source: "ability" | "attack" | "trainer", // Venture Bomb's Item placement.
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  const opponent = otherSeat(ctx.seat);
  const active = state.players[opponent].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // §11: a placed counter is not damage, so only the effects half of a block refuses it ("Damage is
  // not an effect."). The refusal is gated on the invocation, not on `source`.
  if (effectRefused(state, opponent, ctx, events)) return state;
  events.push({ type: "COUNTERS_PLACED", seat: opponent, uid, amount, source });
  return withActive(state, opponent, { ...active, damage: active.damage + amount });
}

/**
 * Place `amount` damage counters on "that Pokémon": the controller's body holding the first card
 * filed under `op.slot`, so it survives an evolution. Nothing filed, or the card gone, is a silent
 * whiff.
 */
function countersOnRecordedBody(
  state: GameState,
  op: OpOf<"countersOnRecordedBody">,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const [filed] = recorded(record, op.slot);
  if (filed === undefined) return state;
  const side = state.players[ctx.seat];
  const holds = (pokemon: InPlayPokemon) => stackUids(pokemon).includes(filed);
  const place = (pokemon: InPlayPokemon): InPlayPokemon => {
    events.push({
      type: "COUNTERS_PLACED",
      seat: ctx.seat,
      uid: topUid(pokemon) ?? filed,
      amount: op.amount,
      source: "ability",
    });
    return { ...pokemon, damage: pokemon.damage + op.amount };
  };
  if (side.active !== null && holds(side.active))
    return withActive(state, ctx.seat, place(side.active));
  const index = side.bench.findIndex(holds);
  if (index === -1) return state;
  return withSide(state, ctx.seat, {
    ...side,
    bench: side.bench.map((pokemon, i) => (i === index ? place(pokemon) : pokemon)),
  });
}

/**
 * Put `amount` damage counters on "that Pokémon" (Team Rocket's Ampharos, Gengar ex):
 * `ctx.subjectUid`, on the opponent's side, in either spot. No `subjectUid`, or one no longer on
 * the board, resolves to nothing. §11 is asked on the subject body.
 */
function damageSubject(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const uid = ctx.subjectUid;
  if (amount <= 0 || uid === undefined) return state;
  const seat = otherSeat(ctx.seat);
  const side = state.players[seat];
  const active = side.active;
  if (active !== null && topUid(active) === uid) {
    // §11 funnel on the subject body (Luminous Wing).
    if (effectRefused(state, seat, ctx, events, active)) return state;
    events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: "ability" });
    return withActive(state, seat, { ...active, damage: active.damage + amount });
  }
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === uid);
  if (index === -1) return state;
  const benched = side.bench[index];
  if (benched !== undefined && effectRefused(state, seat, ctx, events, benched)) return state;
  // Battle Cage: an opponent's Ability puts no counters on the Benched subject.
  if (benchCountersCaged(state, seat, ctx)) return state;
  events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: "ability" });
  return withSide(state, seat, {
    ...side,
    bench: side.bench.map((pokemon, i) =>
      i === index ? { ...pokemon, damage: pokemon.damage + amount } : pokemon,
    ),
  });
}

/**
 * Heal `amount` from the body the watched action was performed on, on the controller's own board
 * (Magearna "Auto Heal"). Checks the Active then the Bench, since the subject can be either.
 */
function healSubject(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const uid = ctx.subjectUid;
  if (amount <= 0 || uid === undefined) return state;
  const seat = ctx.seat;
  const side = state.players[seat];
  const active = side.active;
  if (active !== null && topUid(active) === uid) {
    if (healLocked(state, active)) return state; // Life-Locked
    const healed = Math.min(amount, active.damage);
    if (healed <= 0) return state;
    events.push({ type: "HEALED", seat, uid, amount: healed });
    return withActive(state, seat, healedBody(active, healed, state.turn));
  }
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === uid);
  const benched = side.bench[index];
  if (index === -1 || benched === undefined) return state;
  const healed = Math.min(amount, benched.damage);
  if (healed <= 0) return state;
  events.push({ type: "HEALED", seat, uid, amount: healed });
  return withSide(state, seat, {
    ...side,
    bench: side.bench.map((pokemon, i) =>
      i === index ? healedBody(pokemon, healed, state.turn) : pokemon,
    ),
  });
}

/**
 * Move every damage counter off the controller's chosen Benched `ref` onto the opponent's Active
 * (Dedenne ex "Tail Swap"). `HEALED` then `COUNTERS_PLACED` with the same number, in printed order.
 * Placed counters skip W/R and reduction. Silent endings: a ref not on the controller's Bench, an
 * undamaged pick, or no Defending Pokémon (then nothing moves at all). Never KOs; the attack
 * epilogue sweeps.
 */
function moveCountersToDefender(
  state: GameState,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (ref.seat !== ctx.seat || ref.spot.spot !== "bench") return state;
  // No "is there a defender" pre-check: the shared helper answers it (its
  // destination read is `null` on an empty Active Spot) and a second one here
  // would be a guard nothing can turn red.
  const dest: PokemonRef = { seat: otherSeat(ctx.seat), spot: { spot: "active" } };
  return moveCountersFromBench(state, ref.spot.index, dest, ctx, events);
}

/**
 * The same move with the destination given as a ref. Both rows carry one number and the §11 refusal
 * takes both or neither. The gate is asked of the destination body, on the destination's seat.
 */
function moveCountersFromBench(
  state: GameState,
  index: number,
  dest: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const source = side.bench[index];
  if (source === undefined) return state;
  const sourceUid = topUid(source);
  if (sourceUid === undefined) return state;
  const moved = source.damage;
  if (moved <= 0) return state;
  const destSide = state.players[dest.seat];
  const target = bodyAt(destSide, dest.spot);
  // A move needs both ends, and half of one would silently launder counters off
  // the controller's board — see the doc block above.
  if (target === undefined) return state;
  const targetUid = topUid(target);
  if (targetUid === undefined) return state;
  // §11: the destination half is a placement (an effect), so the effects block refuses the whole
  // move, checked before the HEALED row so counters are never removed without arriving.
  if (effectRefused(state, dest.seat, ctx, events, target)) {
    return state;
  }
  // Battle Cage: a move onto a Benched body is refused whole, before the HEALED row.
  if (dest.spot.spot === "bench" && benchCountersCaged(state, dest.seat, ctx)) return state;
  events.push({ type: "HEALED", seat: ctx.seat, uid: sourceUid, amount: moved });
  // `moved` is `source.damage`, so this writes 0 and stamps `healedTurn` via `healedBody`.
  const bench = side.bench.map((pokemon, i) =>
    i === index ? healedBody(pokemon, moved, state.turn) : pokemon,
  );
  const cleared = withSide(state, ctx.seat, { ...side, bench });
  events.push({
    type: "COUNTERS_PLACED",
    seat: dest.seat,
    uid: targetUid,
    amount: moved,
    source: "moved",
  });
  const damaged: InPlayPokemon = { ...target, damage: target.damage + moved };
  // Re-read the destination side off `cleared`: if the destination were on the controller's own
  // side, reusing `destSide` would undo the clearing.
  const written = cleared.players[dest.seat];
  if (dest.spot.spot === "active") {
    return withSide(cleared, dest.seat, { ...written, active: damaged });
  }
  const destIndex = dest.spot.index;
  return withSide(cleared, dest.seat, {
    ...written,
    bench: written.bench.map((pokemon, i) => (i === destIndex ? damaged : pokemon)),
  });
}

/**
 * Rocket Brain's source candidates: own in-play bodies (Active first) in the owner subgroup that
 * carry damage. Exported for `programPlayable`, which must refuse on exactly this set.
 */
export function counterOwnSources(state: GameState, seat: Seat, owner: string): PokemonRef[] {
  return subgroupRefs(state, ownInPlayRefs(state, seat), owner).filter(
    (ref) => (refPokemon(state, ref)?.damage ?? 0) > 0,
  );
}

/**
 * Rocket Brain's destination candidates: "another of your Pokémon", every own body except the
 * source. Exported for `programPlayable`.
 */
export function counterOwnDestinations(
  state: GameState,
  seat: Seat,
  from: PokemonTarget,
): PokemonRef[] {
  return ownInPlayRefs(state, seat).filter((ref) =>
    from.spot === "active"
      ? ref.spot.spot !== "active"
      : !(ref.spot.spot === "bench" && ref.spot.index === from.index),
  );
}

/**
 * Move one damage counter between two of the controller's own bodies (Rocket Brain). The source
 * half is a direct `healedBody` write, not `healChosen`, because a move is not a heal (Life-Locked
 * must not block it). Silent endings: invalid destination, same spot, empty spot, undamaged source.
 * Never KOs; `settleProgram` sweeps with the Prize to the opponent.
 */
function moveOneOwnCounter(
  state: GameState,
  from: PokemonTarget,
  dest: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (dest.seat !== ctx.seat) return state;
  const sameSpot =
    from.spot === "active"
      ? dest.spot.spot === "active"
      : dest.spot.spot === "bench" && dest.spot.index === from.index;
  if (sameSpot) return state;
  const sourceRef: PokemonRef = { seat: ctx.seat, spot: from };
  const source = refPokemon(state, sourceRef);
  const target = refPokemon(state, dest);
  if (source === undefined || target === undefined) return state;
  const targetUid = topUid(target);
  const sourceUid = topUid(source);
  const moved = Math.min(10, source.damage);
  if (targetUid === undefined || sourceUid === undefined || moved <= 0) return state;
  // A direct write, not `healChosen`: a move off a Life-Locked body is not a heal, and `healChosen`
  // would refuse it while the placement still landed.
  events.push({ type: "HEALED", seat: ctx.seat, uid: sourceUid, amount: moved });
  const healed = withBodyAt(state, sourceRef, healedBody(source, moved, state.turn));
  events.push({
    type: "COUNTERS_PLACED",
    seat: ctx.seat,
    uid: targetUid,
    amount: moved,
    source: "moved",
  });
  const written = refPokemon(healed, dest) ?? target;
  const damaged: InPlayPokemon = { ...written, damage: written.damage + moved };
  const side = healed.players[ctx.seat];
  const spot = dest.spot;
  return withSide(
    healed,
    ctx.seat,
    spot.spot === "active"
      ? { ...side, active: damaged }
      : { ...side, bench: side.bench.map((pokemon, i) => (i === spot.index ? damaged : pokemon)) },
  );
}

/**
 * Adrena-Brain's source candidates: every own in-play body carrying damage, the Munkidori included.
 * Exported for `programPlayable`.
 */
export function counterToOpponentSources(state: GameState, seat: Seat): PokemonRef[] {
  return ownInPlayRefs(state, seat).filter((ref) => (refPokemon(state, ref)?.damage ?? 0) > 0);
}

/**
 * Move up to `count` damage counters from the controller's own body onto an opponent's body
 * (Adrena-Brain), clamped to what the source carries. The heal half is a direct `healedBody` write.
 * No §11 question (an Ability), but Battle Cage refuses a Benched destination whole. Never KOs;
 * `settleProgram` sweeps.
 */
function moveCountersToOpponent(
  state: GameState,
  from: PokemonTarget,
  dest: PokemonRef,
  count: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (dest.seat === ctx.seat) return state;
  const sourceRef: PokemonRef = { seat: ctx.seat, spot: from };
  const source = refPokemon(state, sourceRef);
  const target = refPokemon(state, dest);
  if (source === undefined || target === undefined) return state;
  const targetUid = topUid(target);
  const sourceUid = topUid(source);
  const moved = Math.min(count * HP_PER_COUNTER, source.damage);
  if (targetUid === undefined || sourceUid === undefined || moved <= 0) return state;
  // Battle Cage: a move onto a Benched body is refused whole.
  if (dest.spot.spot === "bench" && benchCountersCaged(state, dest.seat, ctx)) return state;
  // A direct write, not `healChosen` (see `moveOneOwnCounter`).
  events.push({ type: "HEALED", seat: ctx.seat, uid: sourceUid, amount: moved });
  const relieved = withBodyAt(state, sourceRef, healedBody(source, moved, state.turn));
  events.push({
    type: "COUNTERS_PLACED",
    seat: dest.seat,
    uid: targetUid,
    amount: moved,
    source: "moved",
  });
  const landing = refPokemon(relieved, dest) ?? target;
  const loaded: InPlayPokemon = { ...landing, damage: landing.damage + moved };
  const theirs = relieved.players[dest.seat];
  const at = dest.spot;
  return withSide(
    relieved,
    dest.seat,
    at.spot === "active"
      ? { ...theirs, active: loaded }
      : { ...theirs, bench: theirs.bench.map((pokemon, i) => (i === at.index ? loaded : pokemon)) },
  );
}

// Opponent-to-opponent counter moves (`moveCountersOpponentAnyWay`).

/**
 * The opponent bodies a round's source may come from: their Bench for `"bench"` (Sableye), every
 * body for `"any"` (Alakazam). Also the budget's zone.
 */
function anyWayZone(state: GameState, seat: Seat, from: "bench" | "any"): PokemonRef[] {
  return from === "bench" ? oppBenchRefs(state, seat) : oppAnyRefs(state, seat);
}

/** The total counters the op may move: those on its source zone when it first steps. */
function anyWayBudget(state: GameState, seat: Seat, from: "bench" | "any"): number {
  return anyWayZone(state, seat, from).reduce(
    (sum, ref) => sum + Math.floor((refPokemon(state, ref)?.damage ?? 0) / HP_PER_COUNTER),
    0,
  );
}

/**
 * A round's destinations for source `from`: the opponent's Active for `"bench"`, every other
 * opponent body for `"any"`; §11-shielded bodies are dropped silently.
 */
function anyWayDestinations(
  state: GameState,
  ctx: EffectContext,
  zone: "bench" | "any",
  from: PokemonRef,
): PokemonRef[] {
  const opp = otherSeat(ctx.seat);
  const offered: PokemonRef[] =
    zone === "bench"
      ? state.players[opp].active === null
        ? []
        : [{ seat: opp, spot: { spot: "active" } }]
      : oppAnyRefs(state, ctx.seat).filter((ref) => refKeyOf(ref) !== refKeyOf(from));
  // Battle Cage: a Benched body cannot receive the counters, so it is not offered, since a refused
  // round would still spend the budget.
  return unshieldedRefs(state, offered, ctx, []).filter(
    (ref) => ref.spot.spot !== "bench" || !benchCountersCaged(state, ref.seat, ctx),
  );
}

/** A round's SOURCES: damaged, unshielded opponent bodies in the zone that have at least one
    destination to move to (a source with nowhere to go is not offered — the M1 rule). */
function anyWaySources(state: GameState, ctx: EffectContext, zone: "bench" | "any"): PokemonRef[] {
  const damaged = anyWayZone(state, ctx.seat, zone).filter(
    (ref) => (refPokemon(state, ref)?.damage ?? 0) >= 10,
  );
  return unshieldedRefs(state, damaged, ctx, []).filter(
    (ref) => anyWayDestinations(state, ctx, zone, ref).length > 0,
  );
}

/**
 * The round's source and count (absent `take` means the whole budget), clamped silently to the
 * source's counters and the budget.
 */
function anyWaySourceAnswered(
  before: GameState,
  op: OpOf<"moveCountersOpponentAnyWay">,
  ref: PokemonRef,
  take: number | undefined,
): EffectOp {
  const budget = op.budget ?? 0;
  const onSource = Math.floor((refPokemon(before, ref)?.damage ?? 0) / HP_PER_COUNTER);
  return { ...op, source: ref.spot, take: Math.min(take ?? budget, onSource, budget) };
}

/** The next round: the same op with the budget reduced by what this round moved. */
function nextAnyWayRound(op: OpOf<"moveCountersOpponentAnyWay">): EffectOp {
  return {
    op: "moveCountersOpponentAnyWay",
    from: op.from,
    budget: (op.budget ?? 0) - (op.take ?? 0),
  };
}

/**
 * Move `count` damage counters between two of the opponent's bodies. Source half is a `HEALED` row
 * with the heal stamp, destination half `COUNTERS_PLACED { source: "moved" }`. Silent endings:
 * either end not the opponent's, the same body, an empty spot, nothing to move. Never KOs; inside
 * an attack the epilogue sweep counts a lethal result as a KO by the attack.
 */
function moveCountersBetweenOpponents(
  state: GameState,
  from: PokemonRef,
  dest: PokemonRef,
  count: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const opp = otherSeat(ctx.seat);
  if (from.seat !== opp || dest.seat !== opp || refKeyOf(from) === refKeyOf(dest)) return state;
  const source = refPokemon(state, from);
  const target = refPokemon(state, dest);
  if (source === undefined || target === undefined) return state;
  const sourceUid = topUid(source);
  const targetUid = topUid(target);
  const moved = Math.min(source.damage, count * HP_PER_COUNTER);
  if (sourceUid === undefined || targetUid === undefined || moved <= 0) return state;
  events.push({ type: "HEALED", seat: opp, uid: sourceUid, amount: moved });
  const relieved = withBodyAt(state, from, healedBody(source, moved, state.turn));
  events.push({
    type: "COUNTERS_PLACED",
    seat: opp,
    uid: targetUid,
    amount: moved,
    source: "moved",
  });
  const landing = refPokemon(relieved, dest) ?? target;
  return withBodyAt(relieved, dest, { ...landing, damage: landing.damage + moved });
}

/** Write `body` back at `ref`. */
function withBodyAt(state: GameState, ref: PokemonRef, body: InPlayPokemon): GameState {
  const side = state.players[ref.seat];
  const spot = ref.spot;
  return withSide(
    state,
    ref.seat,
    spot.spot === "active"
      ? { ...side, active: body }
      : { ...side, bench: side.bench.map((pokemon, i) => (i === spot.index ? body : pokemon)) },
  );
}

/**
 * Ruffian's candidates: every opponent body (Active first) carrying a Tool or a Special Energy. The
 * shield is asked at the call site, so `programPlayable` can refuse on this set.
 */
export function ruffianBodies(state: GameState, seat: Seat): PokemonRef[] {
  const opposing = oppAnyRefs(state, seat);
  return opposing.filter((ref) => {
    const body = refPokemon(state, ref);
    if (body === undefined) return false;
    return (
      body.tools.length > 0 ||
      body.energy.some((uid) => matchesAttached(state, body, uid, { kind: "specialEnergy" }))
    );
  });
}

/**
 * Palafin "Zero to Hero": search the deck for a card named `name` and switch it with the program's
 * own body in place; the old top card goes into the deck and every other field carries over. The
 * first match in deck order is taken. The deck is always shuffled, even on a failed search. Not an
 * evolution (no `onEvolve`, no `EVOLVED` row), and it is the licensed route for `intoPlayOnlyVia`.
 * No body swaps nothing and still shuffles.
 */
function switchWithDeckNamed(
  state: GameState,
  name: string,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = ctx.seat;
  const side = state.players[seat];
  const [ref] = sourceRef(state, ctx);
  const body = ref === undefined ? undefined : refPokemon(state, ref);
  const oldTop = body === undefined ? undefined : topUid(body);
  const found = side.deck.find((uid) => cardOf(state, uid)?.name === name);
  if (ref === undefined || body === undefined || oldTop === undefined || found === undefined) {
    const [deck, rngState] = shuffle([...side.deck], state.rngState);
    events.push({ type: "SHUFFLE", seat });
    const searched = withSide(state, seat, { ...side, deck });
    return { ...searched, rngState };
  }
  const swapped: InPlayPokemon = { ...body, stack: [...body.stack.slice(0, -1), found] };
  const [deck, rngState] = shuffle(
    [...side.deck.filter((uid) => uid !== found), oldTop],
    state.rngState,
  );
  events.push({ type: "POKEMON_SWAPPED_FROM_DECK", seat, fromUid: oldTop, toUid: found });
  events.push({ type: "SHUFFLE", seat });
  const spot = ref.spot;
  const placed: PlayerSide =
    spot.spot === "active"
      ? { ...side, deck, active: swapped }
      : { ...side, deck, bench: side.bench.map((p, i) => (i === spot.index ? swapped : p)) };
  return { ...withSide(state, seat, placed), rngState };
}

/**
 * The uid a body carries after any in-place swap in `emitted` (Zero to Hero), or `uid` itself. Used
 * to re-key a `switchActive.recordDemoted` filing whose body was swapped into the deck; a filing
 * with `demotedAsMoved` skips the re-key.
 */
function swappedUid(uid: string, emitted: readonly GameEvent[]): string {
  let current = uid;
  for (const event of emitted) {
    if (event.type === "POKEMON_SWAPPED_FROM_DECK" && event.fromUid === current) {
      current = event.toUid;
    }
  }
  return current;
}

/**
 * Ditto "Surprisingly Transform"'s offer: deck cards passing `filter`, in deck order, one per
 * catalog card. Cards with `intoPlayOnlyVia` are never offered.
 */
function deckSwapCandidates(state: GameState, seat: Seat, filter: CardFilter): string[] {
  const seen = new Set<string>();
  return state.players[seat].deck.filter((uid) => {
    const card = cardOf(state, uid);
    if (card === undefined || !matchesFilter(card, filter) || seen.has(card.id)) return false;
    if (intoPlayOnlyViaOf(card) !== undefined) return false;
    seen.add(card.id);
    return true;
  });
}

/**
 * Ditto "Surprisingly Transform": switch `found` in for the program's own body in place, the old
 * top card into the deck, and shuffle on every ending. A card no longer in the deck, or a body that
 * left play, swaps nothing and still shuffles.
 */
function switchWithDeckCard(
  state: GameState,
  found: string | undefined,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = ctx.seat;
  const side = state.players[seat];
  const [ref] = sourceRef(state, ctx);
  const body = ref === undefined ? undefined : refPokemon(state, ref);
  const oldTop = body === undefined ? undefined : topUid(body);
  if (
    ref === undefined ||
    body === undefined ||
    oldTop === undefined ||
    found === undefined ||
    !side.deck.includes(found)
  ) {
    const [deck, rngState] = shuffle([...side.deck], state.rngState);
    events.push({ type: "SHUFFLE", seat });
    const unswapped = withSide(state, seat, { ...side, deck });
    return { ...unswapped, rngState };
  }
  const switched: InPlayPokemon = { ...body, stack: [...body.stack.slice(0, -1), found] };
  const [deck, rngState] = shuffle(
    [...side.deck.filter((uid) => uid !== found), oldTop],
    state.rngState,
  );
  events.push({ type: "POKEMON_SWAPPED_FROM_DECK", seat, toUid: found, fromUid: oldTop });
  events.push({ type: "SHUFFLE", seat });
  return { ...withBodyAt(withSide(state, seat, { ...side, deck }), ref, switched), rngState };
}

/**
 * Ogre's Mask's first offer: the controller's in-play bodies (Active first) whose top card passes
 * `filter`. Exported for `programPlayable`, which refuses the card on an empty offer.
 */
export function swapBodies(state: GameState, seat: Seat, filter: CardFilter): PokemonRef[] {
  return ownInPlayRefs(state, seat).filter((ref) => {
    const body = refPokemon(state, ref);
    // The in-play card, for a typed filter.
    const top = body === undefined ? undefined : inPlayCardOf(state, body);
    return top !== undefined && matchesFilter(top, filter);
  });
}

/** Ogre's Mask's second offer: discard-pile cards passing `filter`, in pile order. */
export function swapDiscardCards(state: GameState, seat: Seat, filter: CardFilter): string[] {
  return state.players[seat].discard.filter((uid) => {
    const card = cardOf(state, uid);
    return card !== undefined && matchesFilter(card, filter);
  });
}

/**
 * Ogre's Mask's body answer (forced or parked): asks question two narrowed to that body by its top
 * uid. No body at the ref does nothing.
 */
function swapBodyAnswered(
  state: GameState,
  op: OpOf<"switchWithDiscardNamed">,
  ref: PokemonRef,
): EffectOp[] {
  const body = refPokemon(state, ref);
  const uid = body === undefined ? undefined : topUid(body);
  return uid === undefined ? [] : [{ ...op, bodyUid: uid }];
}

/**
 * Ogre's Mask swap: the body whose top uid is `bodyUid` gets `cardUid` from the discard pile on top
 * in place; every other field carries over and the old top card goes to the discard pile. No
 * shuffle, and not an evolution. A lower HP can leave the body KO'd; `settleProgram`'s mid-turn
 * sweep handles it. The new card's once-per-turn Abilities are fresh. A departed body or missing
 * card swaps nothing.
 */
function switchWithDiscard(
  state: GameState,
  bodyUid: string,
  cardUid: string,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = ctx.seat;
  const side = state.players[seat];
  const ref = ownInPlayRefs(state, seat).find((candidate) => {
    const body = refPokemon(state, candidate);
    return body !== undefined && topUid(body) === bodyUid;
  });
  const body = ref === undefined ? undefined : refPokemon(state, ref);
  if (ref === undefined || body === undefined || !side.discard.includes(cardUid)) return state;
  const swapped: InPlayPokemon = { ...body, stack: [...body.stack.slice(0, -1), cardUid] };
  const discard = [...side.discard.filter((uid) => uid !== cardUid), bodyUid];
  events.push({ type: "POKEMON_SWAPPED_FROM_DISCARD", seat, fromUid: bodyUid, toUid: cardUid });
  const spot = ref.spot;
  const placed: PlayerSide =
    spot.spot === "active"
      ? { ...side, discard, active: swapped }
      : { ...side, discard, bench: side.bench.map((p, i) => (i === spot.index ? swapped : p)) };
  return withSide(state, seat, placed);
}

/**
 * Place `amount` HP of self-damage on the controller's own Active ("This Pokémon also does N damage
 * to itself"). Outside the §8.5 pipeline: no W/R and no reduction; emitted as COUNTERS_PLACED
 * source "self". Never KOs; the attack epilogue sweeps and the defender takes the prize.
 * `perDamageCounterOnSelf` multiplies by counters already on the attacker, read before placing;
 * zero counters or no Active yields no recoil.
 */
function recoilAmount(
  op: { amount: number; perDamageCounterOnSelf?: true },
  state: GameState,
  ctx: EffectContext,
): number {
  if (op.perDamageCounterOnSelf !== true) return op.amount;
  const recoilingPokemon = state.players[ctx.seat].active;
  return recoilingPokemon === null ? 0 : op.amount * damageCountersOn(recoilingPokemon);
}

function damageSelf(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
  // Optional provenance; absent means the `"self"` recoil.
  source?: "trainer" | "ability",
): GameState {
  if (amount <= 0) return state;
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  events.push({ type: "COUNTERS_PLACED", seat: ctx.seat, uid, amount, source: source ?? "self" });
  return withActive(state, ctx.seat, { ...active, damage: active.damage + amount });
}

/**
 * Put `count` damage counters on the controller's Active, as `damageSelf` does, and return one
 * entry (the attacker's top uid) per counter for filing under `"placed"`. Not clamped to remaining
 * HP; the epilogue handles the self-KO. A non-positive count or no Active places nothing.
 */
function placeCountersOnSelf(
  state: GameState,
  count: number,
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; placed: string[] } {
  const active = state.players[ctx.seat].active;
  const uid = active === null ? undefined : topUid(active);
  if (count <= 0 || active === null || uid === undefined) return { state, placed: [] };
  const amount = count * HP_PER_COUNTER;
  events.push({ type: "COUNTERS_PLACED", seat: ctx.seat, uid, amount, source: "self" });
  return {
    state: withActive(state, ctx.seat, { ...active, damage: active.damage + amount }),
    placed: Array.from({ length: count }, () => uid),
  };
}

/**
 * `damageSelf { on: "source" }`: place counters on the program's source body wherever it sits
 * (Feraligatr "Torrential Heart", usable from the Bench). Flat, no W/R or shield. Never KOs;
 * `resolveMidTurnKnockOuts` sweeps with the Prize to the opponent. A departed source or
 * non-positive amount is silent.
 */
function damageSourceBody(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
  source?: "trainer" | "ability",
): GameState {
  if (amount <= 0) return state;
  const [ref] = sourceRef(state, ctx);
  const body = ref === undefined ? undefined : refPokemon(state, ref);
  if (ref === undefined || body === undefined) return state;
  const uid = topUid(body);
  if (uid === undefined) return state;
  events.push({ type: "COUNTERS_PLACED", seat: ctx.seat, uid, amount, source: source ?? "self" });
  const placed: InPlayPokemon = { ...body, damage: body.damage + amount };
  if (ref.spot.spot === "active") return withActive(state, ctx.seat, placed);
  const slot = ref.spot.index;
  const side = state.players[ctx.seat];
  return withSide(state, ctx.seat, {
    ...side,
    bench: side.bench.map((pokemon, i) => (i === slot ? placed : pokemon)),
  });
}

/**
 * Heal the controller's own Active; an Ability may do this from the Bench, and the Benched user is
 * never the one healed.
 */
function healSelf(
  state: GameState,
  // `"all"` is "heal all damage": this body's own damage.
  amount: number | "all",
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  if (healLocked(state, active)) return state; // Life-Locked
  const healed = amount === "all" ? active.damage : Math.min(amount, active.damage);
  if (healed <= 0) return state;
  events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
  return withActive(state, ctx.seat, healedBody(active, healed, state.turn));
}

/**
 * Discard `ctx.seat`'s whole hand, filing `HAND_DISCARDED` (nothing on an empty hand). Exported for
 * flow.ts's end-of-turn discard (Amarys).
 */
export function discardHand(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const side = state.players[ctx.seat];
  if (side.hand.length === 0) return state;
  events.push({ type: "HAND_DISCARDED", seat: ctx.seat, uids: [...side.hand] });
  return withSide(state, ctx.seat, { ...side, hand: [], discard: [...side.discard, ...side.hand] });
}

/**
 * `whose: "opponent"` shuffles the other seat's deck; the seat is computed once so the read, the
 * `SHUFFLE` row and the write agree. Absent means the controller's deck.
 */
function shuffleDeck(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"shuffleDeck">,
  events: GameEvent[],
): GameState {
  const seat = op.whose === "opponent" ? otherSeat(ctx.seat) : ctx.seat;
  const side = state.players[seat];
  const [deck, rngState] = shuffle(side.deck, state.rngState);
  events.push({ type: "SHUFFLE", seat });
  return { ...withSide(state, seat, { ...side, deck }), rngState };
}

/**
 * Shuffle the top `n` cards of the controller's deck among themselves and put them under the rest
 * (Deduction Kit). Only the window is shuffled, so the rest of the deck keeps its order. Clamped to
 * the deck size.
 */
function bottomDeckTop(
  state: GameState,
  n: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const window = side.deck.slice(0, Math.max(0, n));
  const [shuffled, rngState] = shuffle(window, state.rngState);
  events.push({ type: "DECK_TOP_TO_BOTTOM", seat: ctx.seat, count: window.length });
  return {
    ...withSide(state, ctx.seat, {
      ...side,
      deck: [...side.deck.slice(window.length), ...shuffled],
    }),
    rngState,
  };
}

/**
 * Put the affected players' hands back into their decks, then draw (hand-refresh Supporters,
 * Gothitelle "Distorted Future"). Seats in fixed order, controller first. Pass 1 moves each hand
 * (shuffled in, or with `toBottom` shuffled alone and placed under the deck); pass 2 draws.
 * `onlyIfAnyMoved` skips all draws if no seat moved a card, which is why all moves precede any
 * draw. Events are count-only. Never parks or KOs.
 */
function handRefresh(
  state: GameState,
  op: OpOf<"handRefresh">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // With `who: "opponent"` the controller's hand is not refreshed (Distorted Future disrupts
  // without paying).
  const seats: Seat[] =
    op.who === "both"
      ? [ctx.seat, otherSeat(ctx.seat)]
      : op.who === "opponent"
        ? [otherSeat(ctx.seat)]
        : [ctx.seat];
  let next = state;
  // One entry per affected seat, in the same order — pass 2 zips over it, so the
  // captured pre-move hand size can never go missing (no lookup, no default).
  const moved: { seat: Seat; handCount: number }[] = [];
  for (const seat of seats) {
    const side = next.players[seat];
    const handCount = side.hand.length;
    moved.push({ seat, handCount });
    if (op.toBottom) {
      // Only the hand is randomized; the deck keeps its order above it.
      const [bottom, rngState] = shuffle(side.hand, next.rngState);
      const deck = [...side.deck, ...bottom];
      events.push({ type: "HAND_TO_BOTTOM_OF_DECK", seat, count: handCount });
      next = { ...withSide(next, seat, { ...side, hand: [], deck }), rngState };
    } else {
      // The deck is reordered even from an empty hand (count 0), so the following
      // draw is off a freshly shuffled deck either way.
      const [deck, rngState] = shuffle([...side.deck, ...side.hand], next.rngState);
      events.push({ type: "HAND_SHUFFLED_INTO_DECK", seat, count: handCount });
      next = { ...withSide(next, seat, { ...side, hand: [], deck }), rngState };
    }
  }
  if (op.onlyIfAnyMoved && !moved.some((m) => m.handCount > 0)) return next;
  for (const { seat, handCount } of moved) {
    // Returns the state as well as the count because Lucian's coin flip spends `rngState` (one flip
    // per seat, controller first).
    const dealt = handRefreshDrawCount(next, seat, ctx.seat, op.draw, handCount, events);
    next = drawToHand(dealt.state, seat, dealt.count, "effect", events);
  }
  return next;
}

/**
 * How many cards `seat` draws in a handRefresh. `seat` is the seat being dealt to; `controller` is
 * the one who played the card ("you"), needed for printed pairs like Harlequin's "you draw 5, your
 * opponent draws 3".
 */
function handRefreshDrawCount(
  state: GameState,
  seat: Seat,
  controller: Seat,
  draw: HandRefreshDraw,
  handCount: number,
  events: GameEvent[],
): { count: number; state: GameState } {
  switch (draw.kind) {
    case "fixed":
      return { count: draw.count, state };
    case "handPlus":
      return { count: handCount + draw.delta, state };
    case "prizeCount":
      return { count: state.players[seat].prizes.length, state };
    case "perSeat":
      return { count: seat === controller ? draw.you : draw.opponent, state };
    // Lucian: each seat flips its own coin (heads draws 6, tails 3); each flip advances `rngState`
    // and files a row under the flipping seat.
    case "coinFlip": {
      const [face, rngState] = flipCoin(state.rngState);
      events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat, result: face });
      return { count: face === "heads" ? draw.heads : draw.tails, state: { ...state, rngState } };
    }
    // The controller's opponent, never `otherSeat(seat)`, so the word names the same seat for every
    // affected seat.
    case "opponentHandSize":
      return { count: state.players[otherSeat(controller)].hand.length, state };
  }
}

// (deck shuffling reuses rng.ts's vetted Fisher–Yates — the M1 review caught a
// biased hand-rolled variant; there is exactly one shuffle in the engine.)

/**
 * Move the chosen searched cards deck to dest (Bench Basics enter play stamped this turn; hand
 * cards append). Only uids actually in the deck move. `reveal` is forwarded to the event for the
 * log. Returns what actually moved, since Bench-bound answers are clamped to `benchSpace` here.
 *
 * §7.3 Risky Ruins: place counters on each of `uids` that `seat` just put onto its own Bench during
 * its own turn, when the body is a Basic Pokémon (including Antique Fossil) whose in-play types do
 * not include `excludesType`. One `COUNTERS_PLACED { source: "trainer" }` row per body. Every
 * own-Bench arrival route calls this; placement onto the opponent's Bench does not. No sweep: no
 * Standard-legal Basic has 20 HP or less.
 */
export function benchArrivalCounters(
  state: GameState,
  seat: Seat,
  uids: readonly string[],
  events: GameEvent[],
): GameState {
  const rule = stadiumEffectsOf(state)?.benchArrivalCounters;
  if (rule === undefined) return state;
  // "During their turn".
  if (turnOwnerOf(state) !== seat) return state;
  const landed = new Set(uids);
  const side = state.players[seat];
  const bench = side.bench.map((body) => {
    const uid = topUid(body);
    if (uid === undefined || !landed.has(uid)) return body;
    const card = inPlayCardOf(state, body);
    if (
      card === undefined ||
      !isBasicPokemon(card) ||
      (card.types ?? []).includes(rule.excludesType)
    )
      return body;
    events.push({ type: "COUNTERS_PLACED", seat, uid, amount: rule.amount, source: "trainer" });
    return { ...body, damage: body.damage + rule.amount };
  });
  return withSide(state, seat, { ...side, bench });
}

function searchMove(
  state: GameState,
  uids: readonly string[],
  dest: "bench" | "hand" | "deckTop" | "discard",
  reveal: true | undefined,
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: readonly string[] } {
  const side = state.players[ctx.seat];
  // Bench-bound cards clamp to the remaining bench space HERE, before anything
  // leaves the deck — so the set removed from the deck is EXACTLY the set that
  // lands (a slice-after-remove would strand the excess in neither zone, the
  // card-destruction shape the M1 review called out). Hand has no cap.
  const inDeck = uids.filter((uid) => side.deck.includes(uid));
  const moved = dest === "bench" ? inDeck.slice(0, benchSpace(state, ctx.seat)) : inDeck;
  if (moved.length === 0) return { state, moved };
  const picked = new Set(moved);
  const deck = side.deck.filter((uid) => !picked.has(uid));
  const updated: PlayerSide =
    dest === "bench"
      ? {
          ...side,
          deck,
          bench: [...side.bench, ...moved.map((uid) => makeInPlay(uid, state.turn))],
        }
      : // "Then put those cards on top of it": the cards go straight back onto the deck's front in pick order, seeding `reorderTop`'s park so declining to reorder keeps the picked order. No shuffle here; it already ran as its own op, and shuffling now would bury these cards.
        dest === "deckTop"
        ? { ...side, deck: [...moved, ...deck] }
        : // Brilliant Blender's "and discard them": the controller's own pile, in pick order.
          dest === "discard"
          ? { ...side, deck, discard: [...side.discard, ...moved] }
          : { ...side, deck, hand: [...side.hand, ...moved] };
  // Two whole objects rather than a conditional spread: `reveal: undefined` is not the same wire
  // value as no key.
  events.push(
    reveal === true
      ? { type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved], reveal: true }
      : { type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved] },
  );
  return { state: withSide(state, ctx.seat, updated), moved }; // searchMove
}

/**
 * Is deck card `uid` a Tool the engine simulates? Uses `toolCardSimulated`, the same predicate
 * `attachTool` asks, so the deck attach never offers a Tool the hand attach would refuse.
 */
function attachableToolCard(state: GameState, uid: string): boolean {
  const card = cardOf(state, uid);
  return card !== undefined && toolCardSimulated(card);
}

/**
 * §7.4 free Tool slots on the program's own body: `toolCapOf` minus Tools attached, 0 if it left
 * play. Gates the `attachToSelf` search offer.
 */
function freeToolSlotsOfSource(state: GameState, ctx: EffectContext): number {
  const [ref] = sourceRef(state, ctx);
  if (ref === undefined) return 0;
  const body = refPokemon(state, ref);
  // Slot count comes from `toolCapOf` (Multi Adapter), still at most one card per attach.
  return body !== undefined && body.tools.length < toolCapOf(state, ctx.seat, body) ? 1 : 0;
}

/**
 * Farfetch'd "Impromptu Carrier": attach the picked Tool from the deck to the program's own body.
 * §7.4 is re-checked: at most one card, only with a free slot, only a card still in the deck and
 * still a simulated Tool. Emits `TOOL_ATTACHED` as `attachTool` does. Returns what moved.
 */
function searchAttachToSelf(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: readonly string[] } {
  const side = state.players[ctx.seat];
  const [ref] = sourceRef(state, ctx);
  const uid = uids.find((u) => side.deck.includes(u) && attachableToolCard(state, u));
  if (ref === undefined || uid === undefined) return { state, moved: [] };
  const body = refPokemon(state, ref);
  if (body === undefined || body.tools.length >= toolCapOf(state, ctx.seat, body))
    return { state, moved: [] };
  const withTool: InPlayPokemon = { ...body, tools: [...body.tools, uid] };
  const deck = side.deck.filter((u) => u !== uid);
  const updated: PlayerSide =
    ref.spot.spot === "active"
      ? { ...side, deck, active: withTool }
      : {
          ...side,
          deck,
          bench: side.bench.map((pokemon, i) =>
            ref.spot.spot === "bench" && i === ref.spot.index ? withTool : pokemon,
          ),
        };
  const target: PokemonTarget =
    ref.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: ref.spot.index };
  events.push({ type: "TOOL_ATTACHED", seat: ctx.seat, uid, target });
  return { state: withSide(state, ctx.seat, updated), moved: [uid] };
}

/**
 * What an `evolveFromDeck` op offers: the body "this Pokémon" names, where it sits, and the deck
 * cards that would legally evolve it. The predicate is the §10 evolves-from match used for hand
 * evolves (without Eevee ex's hand-only alias), and cards with `intoPlayOnlyVia` are excluded. The
 * §10 timing bans do not apply: they govern playing from hand. `undefined` when the source has left
 * the board.
 */
function evolveFromDeckOffer(
  state: GameState,
  ctx: EffectContext,
  /**
   * The op's `onto`. Absent, the subject is `ctx.sourceUid`; present, it is that target. A slot
   * that emptied falls out as `undefined`. Seat-relative to `ctx.seat`.
   */
  onto?: PokemonTarget,
  /**
   * The op's `names`. Absent, candidates are the §10 chain match; present, a name-set test replaces
   * it (they are alternatives, never conjuncts).
   */
  names?: readonly string[],
  /**
   * The op's `noAbilities` (Salvatore): a conjunct keeping only cards with no Abilities. Absent
   * means unfiltered.
   */
  noAbilities?: true,
  /**
   * When set, candidates are read from the controller's hand instead of the deck (Spiteful
   * Evolution).
   */
  fromHand?: true,
):
  | {
      target: PokemonTarget;
      benchIndex: number;
      body: InPlayPokemon;
      bodyUid: string;
      name: string;
      candidates: string[];
    }
  | undefined {
  const [ref] = onto === undefined ? sourceRef(state, ctx) : [{ seat: ctx.seat, spot: onto }];
  if (ref === undefined) return undefined;
  const side = state.players[ctx.seat];
  const body = bodyAt(side, ref.spot);
  if (body === undefined) return undefined;
  const bodyUid = topUid(body);
  const top = bodyUid === undefined ? undefined : cardOf(state, bodyUid);
  if (bodyUid === undefined || top === undefined) return undefined;
  return {
    target: ref.spot,
    benchIndex: ref.spot.spot === "bench" ? ref.spot.index : -1,
    body,
    bodyUid,
    name: top.name,
    candidates: (fromHand === true ? side.hand : side.deck).filter((uid) => {
      const card = cardOf(state, uid);
      // An unresolvable deck uid is not a candidate — `evolveFromOf` demands a
      // `Card`, and a missing catalog row must fall OUT of the offer rather than
      // be admitted by a loose comparison (the `hpOf` null rule, one file over).
      if (card === undefined) return false;
      // Palafin ex's "Hero's Spirit" card is never a deck-evolve candidate. Read off the card's
      // program, not `passivesOf`, since a card in the deck has no fold and a §9 lock must not lift
      // it.
      if (intoPlayOnlyViaOf(card) !== undefined) return false;
      // A printed name set replaces the §10 chain match rather than combining with it: Pidove names
      // Unfezant, which evolves from Tranquill, so a conjunction would always be empty.
      // `noAbilities` is ANDed ahead of either predicate; `abilities` may be `null` or `[]` and
      // both mean no Abilities.
      if (noAbilities === true && (card.abilities ?? []).length > 0) return false;
      if (names !== undefined) return names.includes(card.name);
      return evolveFromOf(card) === top.name;
    }),
  };
}

/**
 * Resolve an `evolveFromDeck` pick: the card leaves the deck and goes onto the named body through
 * `evolveOnto`, without the phase-setting tails. No on-evolve trigger fires, since printed triggers
 * require playing from hand. Only a uid still in the deck and still a legal evolution moves, and
 * only the first pick is taken.
 */
function evolveFromDeckMove(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
  /** The op's `onto`, so resolution re-derives the same offer the park made. */
  onto?: PokemonTarget,
  /** The op's `names`, so resolution re-derives the offer under the same predicate as the park. */
  names?: readonly string[],
  /**
   * The op's `noAbilities`, so resolution re-derives the offer under the same predicate as the
   * park.
   */
  noAbilities?: true,
): GameState {
  const offer = evolveFromDeckOffer(state, ctx, onto, names, noAbilities);
  if (offer === undefined) return state;
  const uid = uids[0];
  if (uid === undefined || !offer.candidates.includes(uid)) return state;
  const side = state.players[ctx.seat];
  const pulled = withSide(state, ctx.seat, {
    ...side,
    deck: side.deck.filter((inDeck) => inDeck !== uid),
  });
  return evolveOnto(
    pulled,
    ctx.seat,
    offer.target,
    offer.benchIndex,
    offer.body,
    offer.bodyUid,
    uid,
    events,
    stageChangeConditions(pulled, offer.body.conditions),
  ).state;
}

/**
 * Resolve an `evolveFromDeck { fromHand }` pick (Spiteful Evolution): the card leaves the hand and
 * evolves the program's own body, re-derived against the offer. Returns the uid placed, for
 * `recordAs`.
 */
function evolveFromHandMove(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: string[] } {
  const offer = evolveFromDeckOffer(state, ctx, undefined, undefined, undefined, true);
  const uid = uids[0];
  if (offer === undefined || uid === undefined || !offer.candidates.includes(uid))
    return { state, moved: [] };
  const side = state.players[ctx.seat];
  const pulled = withSide(state, ctx.seat, {
    ...side,
    hand: side.hand.filter((inHand) => inHand !== uid),
  });
  const kept = stageChangeConditions(pulled, offer.body.conditions);
  const evolved = evolveOnto(
    pulled,
    ctx.seat,
    offer.target,
    offer.benchIndex,
    offer.body,
    offer.bodyUid,
    uid,
    events,
    kept,
  );
  return { state: evolved.state, moved: [uid] };
}

/**
 * Whether `seat`'s hand holds a card that evolves from the body `sourceUid` names, so Spiteful
 * Evolution is refused rather than spent on a whiff.
 */
export function evolveFromHandAvailable(
  state: GameState,
  seat: Seat,
  sourceUid: string | undefined,
): boolean {
  return (
    (evolveFromDeckOffer(state, { seat, sourceUid }, undefined, undefined, undefined, true)
      ?.candidates.length ?? 0) > 0
  );
}

/**
 * Move the chosen retrieved cards from discard to dest: hand appends, deck appends (a following
 * `shuffleDeck` scrambles), bench enters play stamped this turn. Only uids still in the discard
 * move. The bench arm clamps again because the Bench may have filled since the park; returns the
 * uids that actually moved.
 */
function retrieveMove(
  state: GameState,
  uids: readonly string[],
  dest: "hand" | "deck" | "bench",
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: string[] } {
  const side = state.players[ctx.seat];
  const inDiscard = uids.filter((uid) => side.discard.includes(uid));
  const moved = dest === "bench" ? inDiscard.slice(0, benchSpace(state, ctx.seat)) : inDiscard;
  if (moved.length === 0) return { state, moved };
  const picked = new Set(moved);
  const discard = side.discard.filter((uid) => !picked.has(uid));
  const updated: PlayerSide =
    dest === "hand"
      ? { ...side, discard, hand: [...side.hand, ...moved] }
      : dest === "bench"
        ? {
            ...side,
            discard,
            bench: [...side.bench, ...moved.map((uid) => makeInPlay(uid, state.turn))],
          }
        : { ...side, discard, deck: [...side.deck, ...moved] };
  events.push({ type: "DISCARD_RETRIEVED", seat: ctx.seat, dest, uids: [...moved] });
  return { state: withSide(state, ctx.seat, updated), moved };
}

/**
 * Push the single `DECK_TOP_REVEALED` row shared by the whiff, decline and move paths. Absent flags
 * must be absent keys, not `undefined`.
 */
function pushDeckTopLook(
  op: OpOf<"lookAtTopN">,
  moved: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): void {
  const owner = lookOwner(op, ctx);
  const event: Extract<GameEvent, { type: "DECK_TOP_REVEALED" }> = {
    type: "DECK_TOP_REVEALED",
    seat: owner,
    uids: [...moved],
    // Spread when present: an explicit `undefined` is a different wire value from a missing key.
    ...(op.dest === undefined ? {} : { dest: op.dest }),
    ...(op.reveal === true ? { reveal: true as const } : {}),
    ...(op.from === undefined ? {} : { from: op.from }),
    // Accompanying Flute: the looker is not the deck's owner.
    ...(owner === ctx.seat ? {} : { actor: ctx.seat }),
  };
  events.push(event);
}

/**
 * Whose deck `lookAtTopN` reads: the controller's by default, or the opponent's (Accompanying
 * Flute).
 */
function lookOwner(op: OpOf<"lookAtTopN">, ctx: EffectContext): Seat {
  return op.whose === "opponent" ? otherSeat(ctx.seat) : ctx.seat;
}

/**
 * The looked-at window: the top `n` by default, or the last `n` for `"bottom"`. A short deck yields
 * the whole deck.
 */
function lookWindow(deck: readonly string[], op: OpOf<"lookAtTopN">): string[] {
  const n = Math.max(0, op.n);
  return op.from === "bottom" ? deck.slice(Math.max(0, deck.length - n)) : deck.slice(0, n);
}

/**
 * Move the chosen looked-at cards from the deck to `op.dest`. Only uids still in the deck move. The
 * bench arm clamps before anything leaves the deck, since the Bench may have filled since the park.
 * The event fires even when nothing moved. `restTo` handles the leftovers (`window \ moved`,
 * including unfiltered cards) on every path: `"discard"` leaves the deck and emits
 * `DECK_TOP_DISCARDED`; `"bottom"` and `"shuffledBottom"` append under the deck silently, and only
 * `"shuffledBottom"` spends rng.
 */
function revealFromTop(
  state: GameState,
  uids: readonly string[],
  op: OpOf<"lookAtTopN">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // The deck, Bench clamp and landing side belong to `lookOwner` (Accompanying Flute).
  const owner = lookOwner(op, ctx);
  const side = state.players[owner];
  const inDeck = uids.filter((uid) => side.deck.includes(uid));
  const moved = op.dest === "bench" ? inDeck.slice(0, benchSpace(state, owner)) : inDeck;
  pushDeckTopLook(op, moved, ctx, events);
  const picked = new Set(moved);
  const rest =
    op.restTo === undefined ? [] : lookWindow(side.deck, op).filter((uid) => !picked.has(uid));
  if (moved.length === 0 && rest.length === 0) return state;
  const removed = new Set([...picked, ...rest]);
  const kept = side.deck.filter((uid) => !removed.has(uid));
  // `toPile` are cards that left the deck; `underneath` stayed in it. Only the discard arm
  // announces anything.
  const toPile = op.restTo === "discard" ? rest : [];
  // `"shuffledBottom"` is the only path that touches `rngState`, and `shuffle`
  // leaves it alone for a leftover of 0 or 1 (its loop starts at `length - 1`).
  const [underneath, rngState] =
    op.restTo === "shuffledBottom"
      ? shuffle(rest, state.rngState)
      : [op.restTo === "bottom" ? rest : [], state.rngState];
  // `seat` is the deck's owner and `actor` the controller; they differ only under Accompanying
  // Flute.
  if (toPile.length > 0)
    events.push({ type: "DECK_TOP_DISCARDED", seat: owner, actor: ctx.seat, uids: [...toPile] });
  // The leftovers land in the pile BEFORE the taken cards reach a `dest` of
  // `"discard"` would — but no printing carries both, and the two never share a
  // card, so the pile's order is the window's either way.
  const discard = toPile.length === 0 ? side.discard : [...side.discard, ...toPile];
  // The bottomed leftovers go UNDER everything the deck still holds — appended after
  // the removal, so a window deeper than the rest of the deck cannot reorder it.
  const deck = underneath.length === 0 ? kept : [...kept, ...underneath];
  const updated: PlayerSide =
    op.dest === "bench"
      ? {
          ...side,
          deck,
          discard,
          bench: [...side.bench, ...moved.map((uid) => makeInPlay(uid, state.turn))],
        }
      : op.dest === "discard"
        ? { ...side, deck, discard: [...discard, ...moved] }
        : { ...side, deck, discard, hand: [...side.hand, ...moved] };
  // `rngState` is threaded rather than assumed unchanged: it is a field of
  // `GameState` and not of the side, so a shuffled leftover has to be written back
  // here or the randomness is spent and then thrown away.
  return withSide({ ...state, rngState }, owner, updated);
}

/**
 * Pay a hand cost: move the chosen uids from the controller's hand to their discard or under their
 * deck (in pick order). Only uids in hand move and duplicates pay once. Returns the uids actually
 * paid, for the §9.2 record.
 */
function payFromHandApply(
  state: GameState,
  uids: readonly string[],
  op: OpOf<"payFromHand">,
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; paid: string[] } {
  const side = state.players[ctx.seat];
  const inHand = new Set(side.hand);
  const paid: string[] = [];
  const spent = new Set<string>();
  for (const uid of uids) {
    if (!inHand.has(uid) || spent.has(uid)) continue;
    spent.add(uid);
    paid.push(uid);
  }
  if (paid.length === 0) return { state, paid };
  const hand = side.hand.filter((uid) => !spent.has(uid));
  // An attack's hand discard is its effect, not a cost.
  const asEffect = ctx.invokedBy === "attack" ? { effect: true as const } : {};
  // Evidence Gathering: the old top card goes into the hand first, then the paid card goes on top.
  // An empty deck is refused before use.
  if (op.swapWithTop === true) {
    const took = side.deck.slice(0, 1);
    events.push({
      type: "HAND_COST_PAID",
      seat: ctx.seat,
      uids: [...paid],
      to: op.to,
      took,
      ...asEffect,
    });
    return {
      state: withSide(state, ctx.seat, {
        ...side,
        hand: [...hand, ...took],
        deck: [...paid, ...side.deck.slice(took.length)],
      }),
      paid,
    };
  }
  events.push({ type: "HAND_COST_PAID", seat: ctx.seat, uids: [...paid], to: op.to, ...asEffect });
  // Academy at Night: the paid cards go on top of the deck in pick order.
  if (op.to === "deckTop") {
    return {
      state: withSide(state, ctx.seat, { ...side, hand, deck: [...paid, ...side.deck] }),
      paid,
    };
  }
  return {
    state: withSide(
      state,
      ctx.seat,
      op.to === "deckBottom"
        ? { ...side, hand, deck: [...side.deck, ...paid] }
        : { ...side, hand, discard: [...side.discard, ...paid] },
    ),
    paid,
  };
}

/**
 * The reveal-and-bottom offer (Ortega, Greavard): the opponent's hand filtered by the op, collapsed
 * to at most `op.upTo ?? 1` copies per interchangeable class. Collapsing leaks nothing because the
 * hand was just revealed. The cap must follow `upTo` so two copies of one Basic can both be picked.
 */
function bottomFromOpponentHandOffer(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"bottomFromOpponentHand">,
): string[] {
  // A bench destination into a full opponent Bench offers nothing, so the offer matches what can
  // land.
  if (op.dest === "bench" && benchSpace(state, otherSeat(ctx.seat)) === 0) return [];
  const hand = state.players[otherSeat(ctx.seat)].hand;
  // `"any"` keeps `BENCH_CEILING` copies per class; the full-Bench guard above reads the live
  // limit.
  const cap = op.upTo === "any" ? BENCH_CEILING : (op.upTo ?? 1);
  const kept = new Map<string, number>();
  const candidates: string[] = [];
  for (const uid of hand) {
    if (op.filter !== undefined && !matchesFilter(cardOf(state, uid), op.filter)) continue;
    // Onto their Bench, Basic only.
    if (op.dest === "bench" && !benchMatches(cardOf(state, uid), op.filter ?? { kind: "anyCard" }))
      continue;
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= cap) continue;
    kept.set(key, already + 1);
    candidates.push(uid);
  }
  return candidates;
}

/** Mr. Mime "Look-Alike Show"'s second sentence, used as the park heading. */
const LOOK_ALIKE_SHOW_NOTE =
  "You may use the effect of a Supporter card you find there as the effect of this attack.";

/**
 * A copied Supporter's play condition, read as if played from the attacker's hand. Since the copied
 * card is not in that hand, `yourHandExactly n` is checked as `n - 1` (Cassiopeia is offered on an
 * empty attacker hand). Other kinds pass through unchanged.
 */
function copiedPlayableIf(cond: BoardCondition): BoardCondition {
  if (cond.kind === "yourHandExactly") return { kind: "yourHandExactly", count: cond.count - 1 };
  return cond;
}

/**
 * The Look-Alike Show offer: opponent hand Supporters with a `trainer` program (empty programs
 * included), one per card id, in hand order, filtered by their printed play conditions and hand
 * cost for the attacker. `programPlayable` is deliberately not applied.
 */
export function opponentSupporterOffer(state: GameState, ctx: EffectContext): string[] {
  const candidates: string[] = [];
  const kept = new Set<string>();
  for (const uid of state.players[otherSeat(ctx.seat)].hand) {
    const card = cardOf(state, uid);
    if (card === undefined || card.category !== "Trainer" || card.trainerType !== "Supporter")
      continue;
    if (kept.has(card.id)) continue;
    const effect = supporterEffectOf(card.id);
    if (effect === undefined) continue;
    if (
      effect.playableIf !== undefined &&
      !conditionHolds(state, ctx.seat, copiedPlayableIf(effect.playableIf))
    )
      continue;
    if (handCostUnmet(state, ctx.seat, effect.ops) !== null) continue;
    kept.add(card.id);
    candidates.push(uid);
  }
  return candidates;
}

/**
 * The program of Supporter `uid` as an attack may use it (Supernatural Shapeshifter), using
 * Look-Alike Show's filter; `undefined` when not eligible.
 */
function copiedSupporterOps(
  state: GameState,
  ctx: EffectContext,
  uid: string,
): readonly EffectOp[] | undefined {
  const card = cardOf(state, uid);
  if (card === undefined || card.category !== "Trainer" || card.trainerType !== "Supporter")
    return undefined;
  const effect = supporterEffectOf(card.id);
  if (effect === undefined) return undefined;
  if (
    effect.playableIf !== undefined &&
    !conditionHolds(state, ctx.seat, copiedPlayableIf(effect.playableIf))
  )
    return undefined;
  if (handCostUnmet(state, ctx.seat, effect.ops) !== null) return undefined;
  return effect.ops;
}

/**
 * Move the chosen card from the opponent's hand to the bottom of their deck. Only uids still in the
 * hand move. Returns what actually moved, for the §9.2 record.
 */
function bottomFromOpponentHandApply(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
  dest?: "bench" | "discard" | "deck",
): { state: GameState; moved: string[] } {
  const owner = otherSeat(ctx.seat);
  const side = state.players[owner];
  const inHand = new Set(side.hand);
  const moved: string[] = [];
  const taken = new Set<string>();
  for (const uid of uids) {
    if (!inHand.has(uid) || taken.has(uid)) continue;
    taken.add(uid);
    moved.push(uid);
  }
  // Clamp again: the Bench may have filled since the offer was made.
  const landing = dest === "bench" ? moved.slice(0, benchSpace(state, owner)) : moved;
  if (landing.length === 0) return { state, moved: landing };
  const kept = new Set(landing);
  if (dest === "bench") {
    for (const uid of landing) {
      // The ENERGY_DISCARDED / CARD_TO_BOTTOM_OF_DECK convention: `seat` is the
      // OWNER whose Bench grew, `actor` the controller who chose. Without the
      // actor the row is indistinguishable from that seat benching a Basic of
      // their own, which is a materially different thing to have happened.
      events.push({ type: "POKEMON_BENCHED", seat: owner, uid, actor: ctx.seat });
    }
    return {
      state: withSide(state, owner, {
        ...side,
        hand: side.hand.filter((uid) => !kept.has(uid)),
        bench: [...side.bench, ...landing.map((uid) => makeInPlay(uid, state.turn))],
      }),
      moved: landing,
    };
  }
  // Discard arm: the card goes to its owner's discard pile, which has no capacity, so no clamp.
  // Uses its own event because the actor chose from someone else's hand.
  if (dest === "discard") {
    for (const uid of landing) {
      events.push({ type: "CARD_DISCARDED_FROM_HAND", seat: owner, uid, actor: ctx.seat });
    }
    return {
      state: withSide(state, owner, {
        ...side,
        hand: side.hand.filter((uid) => !kept.has(uid)),
        discard: [...side.discard, ...landing],
      }),
      moved: landing,
    };
  }
  // Snap Inspection: the picked card is shuffled into its owner's deck.
  if (dest === "deck") {
    for (const uid of landing) {
      events.push({ type: "HAND_CARD_SHUFFLED_INTO_DECK", seat: owner, uid, actor: ctx.seat });
    }
    const [shuffledDeck, rngState] = shuffle([...side.deck, ...landing], state.rngState);
    events.push({ type: "SHUFFLE", seat: owner });
    return {
      state: {
        ...withSide(state, owner, {
          ...side,
          hand: side.hand.filter((uid) => !kept.has(uid)),
          deck: shuffledDeck,
        }),
        rngState,
      },
      moved: landing,
    };
  }
  for (const uid of landing) {
    events.push({ type: "CARD_TO_BOTTOM_OF_DECK", seat: owner, uid, actor: ctx.seat });
  }
  return {
    state: withSide(state, owner, {
      ...side,
      hand: side.hand.filter((uid) => !kept.has(uid)),
      deck: [...side.deck, ...landing],
    }),
    moved: landing,
  };
}

/**
 * Reveal `seat`'s whole hand in one `HAND_REVEALED`. The caller passes the owner. The uid array is
 * copied so later moves don't change the logged reveal. Emits even for an empty hand.
 */
function revealHand(state: GameState, seat: Seat, events: GameEvent[]): void {
  events.push({ type: "HAND_REVEALED", seat, uids: [...state.players[seat].hand] });
}

/**
 * Take a random card from the opponent's hand to their discard or shuffle it into their deck. The
 * pick uses `randomIndex` over `rngState` so it replays deterministically. An empty hand takes
 * nothing, emits nothing and spends no rng. The deck route shuffles and emits a `SHUFFLE`.
 */
function randomFromOpponentHand(
  state: GameState,
  op: OpOf<"randomFromOpponentHand">,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const owner = otherSeat(ctx.seat);
  const side = state.players[owner];
  if (side.hand.length === 0) return state;
  const [index, rngState] = randomIndex(side.hand.length, state.rngState);
  const uid = side.hand[index] as string;
  // Bother-Bot: the card stays in hand, only it is revealed, and its uid is recorded for the later
  // switch.
  if (op.to === "reveal") {
    events.push({ type: "RANDOM_CARD_REVEALED", seat: owner, uid, actor: ctx.seat });
    recordMoved(record, op.recordAs, [uid]);
    return { ...state, rngState };
  }
  events.push({ type: "RANDOM_CARD_TAKEN", seat: owner, uid, actor: ctx.seat, to: op.to });
  const hand = side.hand.filter((held) => held !== uid);
  if (op.to === "discard") {
    return {
      ...withSide(state, owner, { ...side, hand, discard: [...side.discard, uid] }),
      rngState,
    };
  }
  const [deck, shuffled] = shuffle([...side.deck, uid], rngState);
  events.push({ type: "SHUFFLE", seat: owner });
  return { ...withSide(state, owner, { ...side, hand, deck }), rngState: shuffled };
}

/**
 * Furfrou "Hand Trim": `max(0, hand - size)` independent random takes, counted once before the
 * first. A hand at or under `size` spends no rng.
 */
function randomDiscardDownTo(
  state: GameState,
  op: OpOf<"randomFromOpponentHand">,
  size: number,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const single: OpOf<"randomFromOpponentHand"> = {
    op: "randomFromOpponentHand",
    to: op.to,
  };
  const take = Math.max(0, state.players[otherSeat(ctx.seat)].hand.length - size);
  let next = state;
  for (let n = 0; n < take; n += 1)
    next = randomFromOpponentHand(next, single, ctx, events, record);
  return next;
}

/**
 * Take a benched `ref` (either board) with all attached cards into its owner's `dest`. The owner is
 * `ref.seat`, not `ctx.seat`. The Bench compacts. The deck arm shuffles the owner's deck and emits
 * its own shuffle.
 */
function returnBenched(
  state: GameState,
  ref: PokemonRef,
  op: OpOf<"returnBenched">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // The Active is reachable only under `includeActive`. The spot is left empty; promotion or loss
  // is handled by the mid-turn sweep. On the opponent side the Active is the opponent's.
  const activeOwner = op.whose === "self" ? ctx.seat : otherSeat(ctx.seat);
  if (ref.spot.spot === "active" && op.includeActive === true && ref.seat === activeOwner) {
    return returnOwnActive(state, ref.seat, op, ctx, events);
  }
  // Not a bench ref: a silent no-op, since the op validates refs.
  if (ref.spot.spot !== "bench") return state;
  const owner = ref.seat;
  const side = state.players[owner];
  const index = ref.spot.index;
  const body = side.bench[index];
  if (body === undefined) return state;
  const uid = topUid(body);
  if (uid === undefined) return state;
  // Milotic "Mentally Calm" on the owner's opposing side: a hand return fails and the body stays.
  if (op.dest === "hand" && inPlayToHandBlocked(state, owner)) return state;
  const uids = stackUids(body);
  const bench = [...side.bench.slice(0, index), ...side.bench.slice(index + 1)];
  events.push({ type: "POKEMON_RETURNED", seat: owner, uid, actor: ctx.seat, dest: op.dest, uids });
  if (op.dest === "hand") {
    return withSide(state, owner, { ...side, bench, hand: [...side.hand, ...uids] });
  }
  const [deck, rngState] = shuffle([...side.deck, ...uids], state.rngState);
  events.push({ type: "SHUFFLE", seat: owner });
  return { ...withSide(state, owner, { ...side, bench, deck }), rngState };
}

/**
 * `returnBenched`'s Active arm: move `owner`'s Active with attachments to `op.dest` and leave the
 * spot empty for promotion.
 */
function returnOwnActive(
  state: GameState,
  owner: Seat,
  op: OpOf<"returnBenched">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[owner];
  const body = side.active;
  if (body === null) return state;
  const uid = topUid(body);
  if (uid === undefined) return state;
  // Milotic guard: the body stays Active.
  if (op.dest === "hand" && inPlayToHandBlocked(state, owner)) return state;
  const pile = stackUids(body);
  events.push({
    type: "POKEMON_RETURNED",
    seat: owner,
    uid,
    actor: ctx.seat,
    dest: op.dest,
    uids: pile,
  });
  if (op.dest === "hand") {
    return withSide(state, owner, { ...side, active: null, hand: [...side.hand, ...pile] });
  }
  const [deck, shuffled] = shuffle([...side.deck, ...pile], state.rngState);
  events.push({ type: "SHUFFLE", seat: owner });
  return { ...withSide(state, owner, { ...side, active: null, deck }), rngState: shuffled };
}

/**
 * Shuffle every ref in `refs` (with attachments) from one seat's Bench into that seat's deck as a
 * single shuffle. Not a loop over `returnBenched`, which removes by index and would hit wrong
 * bodies after compaction. All refs are gathered before splicing, and splices go in descending
 * index order, which is only correct because all refs are on one seat. Emits one `POKEMON_RETURNED`
 * per body in board order and exactly one `SHUFFLE`.
 */
function shuffleBenchedRefsIntoDeck(
  state: GameState,
  refs: readonly PokemonRef[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const first = refs[0];
  // An EMPTY complement is a silent no-op and not an empty shuffle: the printed
  // sentence moved nothing, so the deck must not be re-ordered and no row filed.
  if (first === undefined) return state;
  // THE SINGLE-SEAT PRECONDITION, enforced rather than assumed (see the block above).
  const owner = first.seat;
  const side = state.players[owner];
  // ── GATHER (no mutation past this point until every read is done) ────────────
  const gathered: { index: number; uid: string; uids: string[] }[] = [];
  for (const ref of refs) {
    if (ref.seat !== owner || ref.spot.spot !== "bench") continue;
    const body = side.bench[ref.spot.index];
    if (body === undefined) continue; // the wire answer's body has since left play
    const uid = topUid(body);
    if (uid === undefined) continue;
    gathered.push({ index: ref.spot.index, uid, uids: stackUids(body) });
  }
  if (gathered.length === 0) return state;
  // ── APPLY: strictly DESCENDING, so no surviving index shifts under a removal ──
  let bench = side.bench;
  for (const { index } of [...gathered].sort((a, b) => b.index - a.index)) {
    bench = [...bench.slice(0, index), ...bench.slice(index + 1)];
  }
  // Sort into board order so click order does not affect the log, the deck or `rngState`.
  gathered.sort((a, b) => a.index - b.index);
  const moved: string[] = [];
  for (const body of gathered) {
    events.push({
      type: "POKEMON_RETURNED",
      seat: owner,
      uid: body.uid,
      actor: ctx.seat,
      dest: "deck",
      uids: body.uids,
    });
    moved.push(...body.uids);
  }
  const [deck, rngState] = shuffle([...side.deck, ...moved], state.rngState);
  events.push({ type: "SHUFFLE", seat: owner });
  return { ...withSide(state, owner, { ...side, bench, deck }), rngState };
}

/** Pokémon cards in `seat`'s hand (Tyme's candidates), read through the zone-aware `cardOf`. */
export function handPokemonUids(state: GameState, seat: Seat): string[] {
  return state.players[seat].hand.filter((uid) => cardOf(state, uid)?.category === "Pokemon");
}

/**
 * Tyme's reveal: an exact match against the named card's printed HP (no HP matches nothing). Right,
 * the opponent draws `op.draw`; wrong, the controller does.
 */
function hpGuessApply(
  state: GameState,
  op: OpOf<"opponentGuessesHp">,
  uid: string,
  guess: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const hp = cardOf(state, uid)?.hp ?? null;
  const right = hp !== null && guess === hp;
  const drawer = right ? otherSeat(ctx.seat) : ctx.seat;
  events.push({ type: "HP_GUESSED", seat: ctx.seat, uid, guess, hp, right, drawer });
  return drawToHand(state, drawer, op.draw, "effect", events);
}

/** The controller's first body (Active, then Bench) that `owesToolTrim`, with its ref. */
function overCapToolBody(
  state: GameState,
  seat: Seat,
): { body: InPlayPokemon; ref: PokemonRef } | undefined {
  const side = state.players[seat];
  const refs: { body: InPlayPokemon; ref: PokemonRef }[] = [
    ...(side.active === null
      ? []
      : [{ body: side.active, ref: { seat, spot: { spot: "active" as const } } }]),
    ...side.bench.map((body, index) => ({
      body,
      ref: { seat, spot: { spot: "bench" as const, index } },
    })),
  ];
  return refs.find(({ body }) => owesToolTrim(state, seat, body));
}

/**
 * Multi Adapter's discard: the named own Tools go to the controller's discard, one
 * `TOOLS_DISCARDED` per host. Unknown uids are ignored.
 */
function trimToolsApply(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const picks = new Set(uids);
  const side = state.players[ctx.seat];
  const discarded: string[] = [];
  const strip = (pokemon: InPlayPokemon): InPlayPokemon => {
    const taken = pokemon.tools.filter((uid) => picks.has(uid));
    if (taken.length === 0) return pokemon;
    discarded.push(...taken);
    events.push({
      type: "TOOLS_DISCARDED",
      seat: ctx.seat,
      actor: ctx.seat,
      uids: taken,
      host: topUid(pokemon) ?? "",
      when: "trimmed",
    });
    return { ...pokemon, tools: pokemon.tools.filter((uid) => !picks.has(uid)) };
  };
  const active = side.active === null ? null : strip(side.active);
  const bench = side.bench.map(strip);
  if (discarded.length === 0) return state;
  return withSide(state, ctx.seat, {
    ...side,
    active,
    bench,
    discard: [...side.discard, ...discarded],
  });
}

/**
 * Discard the named benched bodies with their whole stacks (not a Knock Out, no Prize), gathering
 * before splicing, with one `BENCH_TRIMMED` row.
 */
function discardBenchedRefs(
  state: GameState,
  refs: readonly PokemonRef[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  let side = state.players[ctx.seat];
  const picked = new Set(
    refs
      .filter((ref) => ref.seat === ctx.seat && ref.spot.spot === "bench")
      .map((ref) => (ref.spot.spot === "bench" ? ref.spot.index : -1)),
  );
  const tops: string[] = [];
  const discarded: string[] = [];
  const kept: InPlayPokemon[] = [];
  side.bench.forEach((body, index) => {
    if (!picked.has(index)) {
      kept.push(body);
      return;
    }
    const cleanup = discardFromStack(side, body, "all");
    side = cleanup.side;
    tops.push(topUid(body) ?? "");
    discarded.push(...cleanup.discarded);
  });
  if (tops.length === 0) return state;
  events.push({ type: "BENCH_TRIMMED", seat: ctx.seat, uids: tops, discarded });
  return withSide(state, ctx.seat, { ...side, bench: kept });
}

/**
 * Take the program's own body with all attachments off the board. Unlike `returnBenched` it can
 * reach the Active; the resulting empty spot is promoted by `resolveMidTurnKnockOuts`. A missing
 * body is a silent no-op. `op.dest` is where the body pile goes and `op.attachmentsTo` optionally
 * redirects attachments; piles are gathered first so the deck is shuffled at most once.
 */
function returnSelf(
  state: GameState,
  op: OpOf<"returnSelf">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const [ref] = sourceRef(state, ctx);
  if (ref === undefined) return state;
  const seat = ctx.seat;
  const side = state.players[seat];
  const body = bodyAt(side, ref.spot);
  if (body === undefined) return state;
  const uid = topUid(body);
  if (uid === undefined) return state;
  const uids = stackUids(body);
  const emptied =
    ref.spot.spot === "active"
      ? { ...side, active: null }
      : {
          ...side,
          bench: [...side.bench.slice(0, ref.spot.index), ...side.bench.slice(ref.spot.index + 1)],
        };
  const dest = op.dest ?? "deck";
  // Milotic "Mentally Calm" opposite: returning to hand fails and everything stays in play.
  if (dest === "hand" && inPlayToHandBlocked(state, seat)) return state;
  const attached = [...body.energy, ...body.tools];
  const split = op.attachmentsTo !== undefined && op.attachmentsTo !== dest;
  const bodyPile = split ? [...body.stack] : uids;
  const zones: Record<"deck" | "deckTop" | "hand" | "discard", string[]> = {
    deck: [],
    deckTop: [],
    hand: [],
    discard: [],
  };
  zones[dest].push(...bodyPile);
  if (split) zones[op.attachmentsTo as "discard"].push(...attached);
  events.push(
    split
      ? {
          type: "POKEMON_RETURNED",
          seat,
          uid,
          actor: seat,
          dest,
          uids,
          attachmentsTo: { dest: op.attachmentsTo as "discard", uids: attached },
        }
      : { type: "POKEMON_RETURNED", seat, uid, actor: seat, dest, uids },
  );
  // `"deckTop"` prepends without shuffling.
  const placed = {
    ...emptied,
    deck: [...zones.deckTop, ...emptied.deck],
    hand: [...emptied.hand, ...zones.hand],
    discard: [...emptied.discard, ...zones.discard],
  };
  if (zones.deck.length === 0) return withSide(state, seat, placed);
  const [deck, rngState] = shuffle([...placed.deck, ...zones.deck], state.rngState);
  events.push({ type: "SHUFFLE", seat });
  return { ...withSide(state, seat, { ...placed, deck }), rngState };
}

/**
 * The opponent's evolved bodies (`stack.length >= 2`), Active first then Bench, shared by
 * `devolveEach` and `devolveChosen`. The §11 shield is applied by callers to this set, never the
 * whole board.
 */
function devolveTargets(state: GameState, seat: Seat): PokemonRef[] {
  return oppAnyRefs(state, seat).filter((ref) => {
    const side = state.players[ref.seat];
    const spot = ref.spot;
    const target = bodyAt(side, spot);
    return target !== undefined && target.stack.length >= 2;
  });
}

/**
 * The body after shedding its top card, shared by both devolve ops so their §10/§12 clears cannot
 * drift.
 */
function devolvedBodyOf(body: InPlayPokemon, kept: SpecialConditions): InPlayPokemon {
  return {
    ...body,
    // "the highest Stage Evolution card" — ONE card off the top, not the whole
    // stack: a Stage 2 devolves to its Stage 1 (or, after a Rare Candy, to its
    // Basic). `evolveOnto`'s APPEND read backwards.
    stack: body.stack.slice(0, -1),
    // §12: devolving removes Special Conditions, except those in `kept` (Confused under Dizzying
    // Valley).
    conditions: kept,
    // §10: also shed the effects of attacks.
    ...clearedAttackEffects(),
    // …and the evolution stamp, which belongs to the card that left. See
    // `devolveEach`'s block for why this is `null` and why `turnPlayed` and `markers`
    // are NOT touched (clearing `markers` would erase the `koByEffect` stamp for a
    // body §8.1 is about to collect — the one copy that would be a live defect).
    evolvedTurn: null,
  };
}

/**
 * §10: devolve each of the opponent's evolved Pokémon, shuffling the top card into the opponent's
 * deck. Shielded bodies are filtered out, not refusing the whole op. `turnPlayed` and `markers` are
 * kept; `evolvedTurn` is nulled. A body made lethal by its maximum dropping is stamped
 * `koByEffect`, but only if it was not already lethal; lethality is read on the committed board so
 * seat-wide HP auras apply. One `SHUFFLE` for the sweep, into the owner's deck.
 */
function devolveEach(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const owner = otherSeat(ctx.seat);
  // Narrow to evolved bodies before asking §11, so no refusal is logged for a body this op would
  // never touch.
  const evolvedRefs = devolveTargets(state, ctx.seat);
  const refs = unshieldedRefs(state, evolvedRefs, ctx, events);
  const devolved: {
    ref: PokemonRef;
    body: InPlayPokemon;
    from: string;
    cleared: StatusName[];
    wasLethal: boolean;
  }[] = [];
  const returned: string[] = [];
  for (const ref of refs) {
    const side = state.players[ref.seat];
    const spot = ref.spot;
    const body = bodyAt(side, spot);
    // Not in play — unreachable (`evolvedRefs` just read every one of these bodies),
    // and a silent skip rather than a throw for the reason every ref guard in this
    // file is: the op validates refs. The "evolved" filter is NOT repeated here; it
    // lives in `evolvedRefs` alone, so the printed candidate set has ONE spelling and
    // the refusal rows above cannot disagree with the bodies this loop collects.
    if (body === undefined) continue;
    const from = body.stack[body.stack.length - 1];
    if (from === undefined) continue;
    devolved.push({
      ref,
      from,
      // Less the Confusion Dizzying Valley keeps.
      cleared: presentStatuses(body.conditions).filter(
        (status) =>
          !presentStatuses(stageChangeConditions(state, body.conditions)).includes(status),
      ),
      wasLethal: isLethallyDamaged(state, body),
      body: devolvedBodyOf(body, stageChangeConditions(state, body.conditions)),
    });
    returned.push(from);
  }
  if (devolved.length === 0) return state;

  let next = state;
  for (const entry of devolved) {
    const side = next.players[entry.ref.seat];
    const spot = entry.ref.spot;
    next = withSide(
      next,
      entry.ref.seat,
      spot.spot === "active"
        ? { ...side, active: entry.body }
        : {
            ...side,
            bench: side.bench.map((pokemon, i) => (i === spot.index ? entry.body : pokemon)),
          },
    );
    // The new stack top. `undefined` is unreachable — the slice left at least one card
    // behind — and an empty string would be a uid no client can render, so the `??` is
    // a total-function tail rather than a case.
    const to = entry.body.stack[entry.body.stack.length - 1] ?? entry.from;
    events.push({
      type: "POKEMON_DEVOLVED",
      seat: entry.ref.seat,
      actor: ctx.seat,
      from: entry.from,
      to,
    });
    // §10/§12 — announced only when there was something to remove, `evolveOnto`'s rule
    // verbatim; `uid` is the NEW top (events.ts).
    if (entry.cleared.length > 0) {
      events.push({
        type: "STATUS_CLEARED",
        seat: entry.ref.seat,
        uid: to,
        statuses: entry.cleared,
        reason: "devolved",
      });
    }
  }
  // The whole pile in ONE move, so the deck is touched at most once.
  const ownerSide = next.players[owner];
  const [deck, rngState] = shuffle([...ownerSide.deck, ...returned], next.rngState);
  next = { ...withSide(next, owner, { ...ownerSide, deck }), rngState };
  events.push({ type: "SHUFFLE", seat: owner });

  // Read from the committed board: `seatMaxHpBonus` finds the body among those in play.
  for (const entry of devolved) {
    if (entry.wasLethal) continue;
    const side = next.players[entry.ref.seat];
    const spot = entry.ref.spot;
    const body = bodyAt(side, spot);
    if (body === undefined) continue;
    if (!isLethallyDamaged(next, body)) continue;
    const marker = koByEffectMarker(next.turn);
    // Idempotent, `doomBodyAt`'s contract: a body already carrying this turn's stamp
    // is left alone rather than given a duplicate.
    if (body.markers.includes(marker)) continue;
    const marked: InPlayPokemon = { ...body, markers: [...body.markers, marker] };
    next = withSide(
      next,
      entry.ref.seat,
      spot.spot === "active"
        ? { ...side, active: marked }
        : { ...side, bench: side.bench.map((p, i) => (i === spot.index ? marked : p)) },
    );
  }
  return next;
}

/**
 * Devolve one chosen body, putting its top card into its owner's hand. No shuffle and no rng. The
 * hand is read from `ref.seat`. Lethality uses `devolveEach`'s committed-board read and `wasLethal`
 * check.
 */
function devolveBodyToHand(
  state: GameState,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ref.seat];
  const spot = ref.spot;
  const body = bodyAt(side, spot);
  // Not in play, or nothing to shed — a silent no-op rather than a throw, for the
  // reason every ref guard in this file is: the op validates refs, and a wire answer
  // whose body has since left play moves nothing (`returnBenched`'s trust level).
  if (body === undefined) return state;
  // Milotic "Mentally Calm" opposite the owner: the devolution fails whole and nothing is shed.
  if (inPlayToHandBlocked(state, ref.seat)) return state;
  const from = body.stack[body.stack.length - 1];
  if (from === undefined) return state;
  // Keep what the devolved top retains (Dizzying Valley's Confused) and clear the rest.
  const kept = stageChangeConditions(state, body.conditions);
  const cleared = presentStatuses(body.conditions).filter(
    (status) => !presentStatuses(kept).includes(status),
  );
  const wasLethal = isLethallyDamaged(state, body);
  const devolved = devolvedBodyOf(body, kept);
  let next = withSide(
    state,
    ref.seat,
    spot.spot === "active"
      ? { ...side, active: devolved }
      : {
          ...side,
          bench: side.bench.map((pokemon, i) => (i === spot.index ? devolved : pokemon)),
        },
  );
  // …and the card into the OWNER's hand. Re-read off `next`, because the line above
  // just replaced that whole side.
  const ownerSide = next.players[ref.seat];
  next = withSide(next, ref.seat, { ...ownerSide, hand: [...ownerSide.hand, from] });
  // The new stack top. `undefined` is unreachable — the slice left at least one card
  // behind — and an empty string would be a uid no client can render, so the `??` is
  // a total-function tail rather than a case (`devolveEach`'s line verbatim).
  const to = devolved.stack[devolved.stack.length - 1] ?? from;
  events.push({
    type: "POKEMON_DEVOLVED",
    seat: ref.seat,
    actor: ctx.seat,
    from,
    to,
    // The destination rider: otherwise nothing would announce that the card went to hand.
    zone: "hand",
  });
  // §10/§12 — announced only when there was something to remove, `evolveOnto`'s rule
  // verbatim; `uid` is the NEW top (events.ts).
  if (cleared.length > 0) {
    events.push({
      type: "STATUS_CLEARED",
      seat: ref.seat,
      uid: to,
      statuses: cleared,
      reason: "devolved",
    });
  }
  // Read from the committed board.
  if (wasLethal) return next;
  const committed = next.players[ref.seat];
  const live = bodyAt(committed, spot);
  if (live === undefined) return next;
  if (!isLethallyDamaged(next, live)) return next;
  const marker = koByEffectMarker(next.turn);
  // Idempotent, `doomBodyAt`'s contract: a body already carrying this turn's stamp is
  // left alone rather than given a duplicate.
  if (live.markers.includes(marker)) return next;
  const marked: InPlayPokemon = { ...live, markers: [...live.markers, marker] };
  return withSide(
    next,
    ref.seat,
    spot.spot === "active"
      ? { ...committed, active: marked }
      : { ...committed, bench: committed.bench.map((p, i) => (i === spot.index ? marked : p)) },
  );
}

/**
 * `devolveEach.toHand` (Espeon "Miraculous Shine"): devolve each unshielded evolved body to hand in
 * board order, no shuffle. `wasLethal` is read on the starting board and the stamp on the committed
 * board after the whole sweep, so stamping does not depend on board order.
 */
function devolveEachToHand(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const refs = unshieldedRefs(state, devolveTargets(state, ctx.seat), ctx, events);
  const lethalBefore = refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = bodyAt(side, ref.spot);
    return body === undefined || isLethallyDamaged(state, body);
  });
  let next = state;
  for (const ref of refs) next = devolveBodyToHand(next, ref, ctx, events);
  // Stamp on the committed board after the whole sweep.
  refs.forEach((ref, i) => {
    if (lethalBefore[i] === true) return;
    const side = next.players[ref.seat];
    const spot = ref.spot;
    const body = bodyAt(side, spot);
    if (body === undefined) return;
    if (!isLethallyDamaged(next, body)) return;
    const marker = koByEffectMarker(next.turn);
    if (body.markers.includes(marker)) return;
    const marked: InPlayPokemon = { ...body, markers: [...body.markers, marker] };
    next = withSide(
      next,
      ref.seat,
      spot.spot === "active"
        ? { ...side, active: marked }
        : { ...side, bench: side.bench.map((p, j) => (j === spot.index ? marked : p)) },
    );
  });
  return next;
}

/**
 * Strange Timepiece's offer: the controller's own evolved bodies whose top card has `pokemonType`,
 * Active first then Bench. No §11 pass: a shield does not stop the controller's own Item.
 */
function ownDevolveTargets(state: GameState, seat: Seat, pokemonType?: PokemonType): PokemonRef[] {
  return ownInPlayRefs(state, seat).filter((ref) => {
    const body = refPokemon(state, ref);
    if (body === undefined || body.stack.length < 2) return false;
    if (pokemonType === undefined) return true;
    const uid = topUid(body);
    const card = inPlayCardOf(state, body) ?? (uid === undefined ? undefined : cardOf(state, uid));
    return (card?.types ?? []).includes(pokemonType);
  });
}

/**
 * Whether Strange Timepiece can act: some own body is on offer and an opposing Milotic "Mentally
 * Calm" does not block the hand return.
 */
export function ownDevolveAvailable(
  state: GameState,
  seat: Seat,
  pokemonType?: PokemonType,
): boolean {
  return (
    ownDevolveTargets(state, seat, pokemonType).length > 0 && !inPlayToHandBlocked(state, seat)
  );
}

function ownDevolveNote(op: OpOf<"devolveChosen">): string {
  const typed = op.pokemonType === undefined ? "" : `${op.pokemonType} `;
  return `Devolve which of your evolved ${typed}Pokémon? Its Evolution cards go into your hand, and it can't evolve this turn.`;
}

/**
 * Strange Timepiece's own-side pick, answered. `n` is the Evolution cards on the body. With one
 * card or no `depth`, shed 1; otherwise with `depth: "any"`, ask how many (at least 1).
 */
function ownDevolveAnswered(
  state: GameState,
  ref: PokemonRef,
  op: OpOf<"devolveChosen">,
): EffectOp[] {
  const body = refPokemon(state, ref);
  const uid = body === undefined ? undefined : topUid(body);
  if (body === undefined || uid === undefined || body.stack.length < 2) return [];
  const shedOp = (shed: number): EffectOp => ({
    op: "devolveChosen",
    whose: "self",
    bodyUid: uid,
    shed,
  });
  const n = op.depth === "any" ? body.stack.length - 1 : 1;
  const cards = (k: number) => (k === 1 ? "1 Evolution card" : `${k} Evolution cards`);
  const chain = (k: number): EffectOp =>
    k === n
      ? shedOp(k)
      : {
          op: "optional",
          note: "Put how many Evolution cards on it into your hand?",
          labels: {
            yes: cards(k),
            no: k + 1 === n ? cards(n) : `${k + 1} to ${n} Evolution cards`,
          },
          then: [shedOp(k)],
          otherwise: [chain(k + 1)],
        };
  return [chain(1)];
}

/**
 * Shed the top `shed` cards of the body whose top uid is `bodyUid` to its owner's hand, never below
 * its Basic. A body that shed anything gets `turnPlayed = state.turn` so it can't evolve this turn.
 */
function shedOwnBody(
  state: GameState,
  ctx: EffectContext,
  bodyUid: string,
  shed: number,
  events: GameEvent[],
): GameState {
  const ref = ownInPlayRefs(state, ctx.seat).find((r) => {
    const own = refPokemon(state, r);
    return own !== undefined && topUid(own) === bodyUid;
  });
  if (ref === undefined) return state;
  let next = state;
  for (let i = 0; i < shed; i++) {
    const body = refPokemon(next, ref);
    if (body === undefined || body.stack.length < 2) break;
    const after = devolveBodyToHand(next, ref, ctx, events);
    if (after === next) break;
    next = after;
  }
  if (next === state) return state;
  const body = refPokemon(next, ref);
  if (body === undefined) return next;
  const stamped: InPlayPokemon = { ...body, turnPlayed: next.turn };
  const side = next.players[ref.seat];
  const spot = ref.spot;
  return withSide(
    next,
    ref.seat,
    spot.spot === "active"
      ? { ...side, active: stamped }
      : { ...side, bench: side.bench.map((p, i) => (i === spot.index ? stamped : p)) },
  );
}

/**
 * Blowtorch's offered branches: a branch is offered when its op has a target. The §11 shield is not
 * asked here.
 */
export function offeredBranches(
  state: GameState,
  seat: Seat,
  op: OpOf<"chooseOneOffered">,
): { label: string; op: EffectOp }[] {
  const acts = (branch: EffectOp): boolean => {
    if (branch.op === "discardTools")
      return discardableTools(state, seat, branch.sides, branch.bodyUid).length > 0;
    if (branch.op === "discardEnergy") return discardableEnergies(state, seat, branch).length > 0;
    if (branch.op === "discardStadium") return state.stadium !== null;
    return true;
  };
  return op.branches.flatMap((branch, i) =>
    acts(branch) ? [{ label: op.labels[i] ?? "", op: branch }] : [],
  );
}

/**
 * The offered branches as a labelled binary chain: `yes` is the first, `no` the rest, recursively.
 */
function chooseOneChain(
  note: string,
  offered: readonly { label: string; op: EffectOp }[],
): EffectOp[] {
  const [first, ...rest] = offered;
  if (first === undefined) return [];
  if (rest.length === 0) return [first.op];
  return [
    {
      op: "optional",
      note,
      labels: { yes: first.label, no: rest.map((b) => b.label).join(" or ") },
      then: [first.op],
      otherwise: chooseOneChain(note, rest),
    },
  ];
}

function devolveChosenNote(seat: Seat, candidates: readonly PokemonRef[]): string {
  const ownSide = candidates.length > 0 && candidates.every((ref) => ref.seat === seat);
  const owner = ownSide ? "your" : "your opponent's";
  return (
    `Devolve 1 of ${owner} evolved Pokémon by putting the highest Stage Evolution ` +
    `card on it into ${owner} hand.`
  );
}

/**
 * "If you use this Ability, this Pokémon is Knocked Out." Marks the body lethal rather than
 * removing it, so the §8.1 sweep handles Prizes, discard and promotion. `effectiveMaxHp` is read
 * when the op runs. No event; `KNOCKED_OUT` follows. A missing body is a no-op.
 */
function knockOutSelf(state: GameState, ctx: EffectContext): GameState {
  const [ref] = sourceRef(state, ctx);
  if (ref === undefined) return state;
  // No marker: the body is this op's own host.
  return doomBodyAt(state, ref);
}

/**
 * Mark one in-play body lethal by setting damage to its effective max HP; the §8.1 sweep does the
 * rest. `marker` records that lethality was not caused by damage. §11 is checked by callers. A body
 * with no printed HP is left alone. The stamp is idempotent.
 */
export function doomBodyAt(state: GameState, ref: PokemonRef, marker?: string): GameState {
  const side = state.players[ref.seat];
  const spot = ref.spot;
  const body = bodyAt(side, spot);
  if (body === undefined) return state;
  const hp = effectiveMaxHp(state, body);
  if (hp === null) return state;
  const doomed: InPlayPokemon = {
    ...body,
    damage: Math.max(body.damage, hp),
    ...(marker === undefined || body.markers.includes(marker)
      ? {}
      : { markers: [...body.markers, marker] }),
  };
  return withSide(
    state,
    ref.seat,
    spot.spot === "active"
      ? { ...side, active: doomed }
      : { ...side, bench: side.bench.map((pokemon, i) => (i === spot.index ? doomed : pokemon)) },
  );
}

/**
 * Knock Out the defender's Active by marking it lethal with the `koByEffect` marker, so "Knocked
 * Out by damage" readers don't treat it as damage. Asks §11, since it is an attack effect on the
 * Defending Pokémon. An empty Active spot is a no-op.
 */
function knockOutDefender(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const seat = otherSeat(ctx.seat);
  if (state.players[seat].active === null) return state;
  if (effectRefused(state, seat, ctx, events)) return state;
  // The §11 guard runs before the max-HP read.
  return doomBodyAt(state, { seat, spot: { spot: "active" } }, koByEffectMarker(state.turn));
}

/**
 * Discard the opponent's Active and all attached cards without a Knock Out (Moltres ex): no Prize,
 * no `KNOCKED_OUT`. §11 refuses the whole op. Cards go to the defender's discard. Promotion is
 * handled by `finishAttack`'s `orphanedPromotions`. An empty Active spot is a no-op.
 */
function discardDefender(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const seat = otherSeat(ctx.seat);
  const side = state.players[seat];
  const active = side.active;
  if (active === null) return state;
  if (effectRefused(state, seat, ctx, events)) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const cleanup = discardFromStack(side, active, "all");
  events.push({
    type: "POKEMON_RETURNED",
    seat,
    uid,
    actor: ctx.seat,
    dest: "discard",
    uids: cleanup.discarded,
  });
  return withSide(state, seat, { ...cleanup.side, active: null });
}

/**
 * Discard the Stadium to its owner's discard pile (not `ctx.seat`'s). An empty zone emits nothing.
 */
function discardStadium(state: GameState, events: GameEvent[]): GameState {
  const stadium = state.stadium;
  if (stadium === null) return state;
  const ownerSide = state.players[stadium.owner];
  const next = withSide(state, stadium.owner, {
    ...ownerSide,
    discard: [...ownerSide.discard, stadium.uid],
  });
  // Card revision B22 — `cause: "effect"`: nothing replaced it, the zone is now empty.
  events.push({
    type: "STADIUM_DISCARDED",
    seat: stadium.owner,
    uid: stadium.uid,
    cause: "effect",
  });
  // The zone is cleared LAST, off `next`, so the pile update and the vacancy are one
  // reduction — nothing can observe a Stadium that is in neither place.
  return { ...next, stadium: null };
}

/**
 * Area Zero Underdepths leaving play: both players trim their Bench to 5, the owner first. The
 * owner is read from `before`, and the trims go at the front of `pending`.
 */
function queueStadiumLeaveTrims(before: GameState, after: GameState): GameState {
  if (before.stadium === null) return after;
  const trims = benchTrimStages(after, before.stadium.owner, after.pending);
  return trims.length === 0 ? after : { ...after, pending: [...trims, ...after.pending] };
}

/**
 * Queue a `takePrizes` stage for an attack's "take a Prize card"; `advance` does the work. The seat
 * is `ctx.seat`. The stage is spliced ahead of the attack's queued tail so it resolves before the
 * Knock Out sweep; with no tail it is appended. No clamp or win check here; `advance` handles both.
 */
function queueTakePrize(
  state: GameState,
  ctx: EffectContext,
  count: number,
  thenShuffleHand: boolean,
): GameState {
  const taken: PendingStage = { kind: "takePrizes", seat: ctx.seat, count };
  // Celebration: the hand-shuffle stage goes directly behind the Prize stage, so it runs once the
  // Prizes are in hand.
  const prize: PendingStage[] = thenShuffleHand
    ? [taken, { kind: "shuffleHandIntoDeck", seat: ctx.seat }]
    : [taken];
  const tail = state.pending.findIndex(
    (queued) =>
      queued.kind === "damagedTrigger" ||
      queued.kind === "koToolTrigger" ||
      queued.kind === "attackEpilogue",
  );
  return {
    ...state,
    pending:
      tail === -1
        ? [...state.pending, ...prize]
        : [...state.pending.slice(0, tail), ...prize, ...state.pending.slice(tail)],
  };
}

/**
 * Turn one face-down Prize face up, of the controller's row or the opponent's (`side: "opponent"`).
 * The player picks rather than the engine. Zero face-down prizes is a silent no-op, one is forced,
 * more parks a choice inside the confirm's `then`.
 */
function turnPrizeFaceUp(
  state: GameState,
  op: OpOf<"turnPrizeFaceUp">,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): { done: GameState } | { park: EffectPrompt } {
  const owner = prizeRowOwner(op, ctx);
  const indices = faceDownPrizeIndices(state, owner);
  if (indices.length === 0) return { done: state };
  if (indices.length === 1)
    return { done: turnPrizeFaceUpAt(state, indices[0] ?? -1, op, ctx, events, record) };
  return {
    park: {
      kind: "choosePrize",
      indices,
      // The note names whose row is being chosen.
      note:
        owner === ctx.seat
          ? "Choose 1 of your face-down Prize cards to turn face up."
          : "Choose 1 of your opponent's face-down Prize cards to turn face up.",
    },
  };
}

/** Whose prize row `turnPrizeFaceUp` turns, shared by the park, forced pick and answer. */
function prizeRowOwner(op: OpOf<"turnPrizeFaceUp">, ctx: EffectContext): Seat {
  return op.side === "opponent" ? otherSeat(ctx.seat) : ctx.seat;
}

/** The face-down slots of `seat`'s prize row, in row order. */
function faceDownPrizeIndices(state: GameState, seat: Seat): number[] {
  const side = state.players[seat];
  const indices: number[] = [];
  side.prizes.forEach((uid, index) => {
    if (!side.faceUpPrizes.includes(uid)) indices.push(index);
  });
  return indices;
}

/**
 * Apply the chosen slot: append its uid to `faceUpPrizes` and emit `PRIZE_TURNED_FACE_UP`. An
 * out-of-range or already face-up index does nothing.
 */
function turnPrizeFaceUpAt(
  state: GameState,
  index: number,
  op: OpOf<"turnPrizeFaceUp">,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const owner = prizeRowOwner(op, ctx);
  const side = state.players[owner];
  const uid = side.prizes[index];
  if (uid === undefined || side.faceUpPrizes.includes(uid)) return state;
  // `actor` is set only when the row is not the controller's; the turned uid is recorded for
  // Bother-Bot's switch.
  events.push({
    type: "PRIZE_TURNED_FACE_UP",
    seat: owner,
    index,
    uid,
    ...(owner === ctx.seat ? {} : { actor: ctx.seat }),
  });
  recordMoved(record, op.recordAs, [uid]);
  return {
    ...state,
    players: {
      ...state.players,
      [owner]: { ...side, faceUpPrizes: [...side.faceUpPrizes, uid] },
    },
  };
}

/**
 * Redeemable Ticket: shuffle the whole prize row under the controller's deck and take the top `n`
 * as a new face-down row, clearing `faceUpPrizes`. `n = 0` is a no-op that spends no rng.
 */
function cycleOwnPrizes(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const side = state.players[ctx.seat];
  const count = side.prizes.length;
  if (count === 0) return state;
  const [shuffled, rngState] = shuffle([...side.prizes], state.rngState);
  const pile = [...side.deck, ...shuffled];
  events.push({ type: "PRIZES_CYCLED", seat: ctx.seat, count });
  return withSide({ ...state, rngState }, ctx.seat, {
    ...side,
    prizes: pile.slice(0, count),
    deck: pile.slice(count),
    faceUpPrizes: [],
  });
}

/**
 * Bother-Bot's switch: swap the recorded turned prize with the recorded revealed hand card. The
 * hand card takes the prize's slot and stays face up. Stale records are a no-op. The row and hand
 * are the opponent's.
 */
function swapTurnedPrizeWithRevealed(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const owner = otherSeat(ctx.seat);
  const side = state.players[owner];
  const [prizeUid] = recorded(record, "turnedPrize");
  const [handUid] = recorded(record, "revealed");
  if (prizeUid === undefined || handUid === undefined) return state;
  const index = side.prizes.indexOf(prizeUid);
  if (index < 0 || !side.hand.includes(handUid)) return state;
  events.push({
    type: "PRIZE_SWITCHED_WITH_HAND",
    seat: owner,
    actor: ctx.seat,
    index,
    prizeUid,
    handUid,
  });
  return withSide(state, owner, {
    ...side,
    prizes: side.prizes.map((uid) => (uid === prizeUid ? handUid : uid)),
    faceUpPrizes: side.faceUpPrizes.map((uid) => (uid === prizeUid ? handUid : uid)),
    hand: [...side.hand.filter((uid) => uid !== handUid), prizeUid],
  });
}

/** The `returnBenched` pick prompt, in the printed card's own words minus its
    anaphora — the `retrieveNoun` rule (one phrasing per printed shape, never a
    guessed one). The DESTINATION picks the verb because the printings do:
    nothing in this pool "shuffles" into a hand or "puts" into a deck. */
function returnBenchedNote(op: OpOf<"returnBenched">): string {
  // Reversing Gust: Active included.
  if (op.whose === "opponent" && op.includeActive === true) {
    return "Shuffle which of your opponent's Pokémon and all attached cards into their deck?";
  }
  if (op.whose === "opponent") {
    return "Shuffle which of your opponent's Benched Pokémon into their deck?";
  }
  // Scoop Up Cyclone: Active included.
  if (op.includeActive === true)
    return "Put which of your Pokémon and all attached cards into your hand?";
  return op.dest === "deck"
    ? "Shuffle which of your Benched Pokémon into your deck?"
    : "Put which of your Benched Pokémon into your hand?";
}

/** Prompt for `returnBenchedRest`: names the bodies that stay. Uses the printed number. */
function returnBenchedRestNote(op: OpOf<"returnBenchedRest">): string {
  return `Choose ${op.keep} of your opponent's Benched Pokémon to leave in play.`;
}

/**
 * Prompt for `returnBenchedChosen`. Uses the prompt's `min`/`max` rather than `op.count` so the
 * caption matches what the dialog accepts on a clamped Bench.
 */
function returnBenchedChosenNote(count: number): string {
  return `Choose ${count} of your opponent's Benched Pokémon to shuffle into their deck.`;
}

/** The pick prompt's printed sentence — the whole clause, since the op IS the
    whole clause (the payFromHandNote rule). Grown one printed form per card
    (the retrieveNoun rule): bare = Ortega's, `supporter` = Greavard's. An
    unphrased future filter gets the bare form's structure with no guessed
    noun — "a card" is never a lie, merely less than the card prints. */
function bottomFromOpponentHandNote(op: OpOf<"bottomFromOpponentHand">): string {
  // Check the destination before the filter, since it changes the verb.
  if (op.dest === "bench") {
    // One printed form per card, so the caption matches the card text: Lickitung's "up to" and
    // Lillie's Ribombee's "any number" are separate sentences.
    if (op.upTo === "any") {
      return `Your opponent reveals their hand, and you put any number of ${retrieveNoun(op.filter ?? { kind: "anyCard" }).plural} you find there onto their Bench.`;
    }
    if (op.upTo !== undefined) {
      return `Your opponent reveals their hand. Put up to ${op.upTo} ${retrieveNoun(op.filter ?? { kind: "anyCard" }).plural} you find there onto your opponent's Bench.`;
    }
    return `Your opponent reveals their hand, and you put ${retrieveNoun(op.filter ?? { kind: "anyCard" }).singular} you find there onto your opponent's Bench.`;
  }
  // Discard destination, checked before the filter. Eri's "up to" form is a separate, narrower
  // branch.
  if (op.dest === "discard" && typeof op.upTo === "number") {
    return `Your opponent reveals their hand, and you discard up to ${op.upTo} ${retrieveNoun(op.filter ?? { kind: "anyCard" }).plural} you find there.`;
  }
  if (op.dest === "discard") {
    return "Your opponent reveals their hand. Discard a card you find there.";
  }
  // Watchog "Snap Inspection"'s per-heads clause.
  if (op.dest === "deck") {
    return "Your opponent reveals their hand. Choose a card you find there and shuffle it into your opponent's deck.";
  }
  if (op.filter?.kind === "supporter") {
    return "Your opponent reveals their hand. Choose a Supporter card you find there and put it on the bottom of their deck.";
  }
  // Energy Swatter: "an Energy card" in place of "a card".
  if (op.filter?.kind === "anyEnergy") {
    return "Your opponent reveals their hand, and you choose an Energy card you find there and put it on the bottom of their deck.";
  }
  return "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.";
}

/** The mayDraw prompt speaks to its ANSWERER — the opponent of the seat that
    played the card — so the printed "your opponent may draw a card" turns
    around into the second person, the way it is said across a table. */
function mayDrawNote(op: OpOf<"opponentMayDraw">): string {
  return op.count === 1 ? "You may draw a card." : `You may draw ${op.count} cards.`;
}

/**
 * Caption for the opponent-chooses hand discard, in the answerer's voice rather than the printed
 * sentence, since the reader is the opponent. The printed count is safe because the op only parks
 * when the hand exceeds it.
 * Whose hand `opponentDiscardsFromHand` targets: the controller's under Hand Trimmer's `whose:
 * "self"`, otherwise the opponent's.
 */
function discardHandOwner(op: OpOf<"opponentDiscardsFromHand">, seat: Seat): Seat {
  return op.whose === "self" ? seat : otherSeat(seat);
}

/**
 * Hand Trimmer's controller arm: `seat` discards down to `untilHandSize`, choosing which, with no
 * separate decider.
 */
function selfDiscardDownTo(
  state: GameState,
  op: OpOf<"opponentDiscardsFromHand">,
  seat: Seat,
  events: GameEvent[],
): { done: GameState } | { park: EffectPrompt } {
  const own = state.players[seat].hand;
  const excess = Math.max(0, own.length - (op.untilHandSize ?? own.length));
  if (excess === 0) return { done: state };
  if (own.length <= excess) return { done: discardChosenFromHand(state, seat, own, events) };
  return {
    park: {
      kind: "chooseCards",
      candidates: [...own],
      min: excess,
      max: excess,
      dest: "discard",
      note: opponentDiscardNote(op),
    },
  };
}

function opponentDiscardNote(op: OpOf<"opponentDiscardsFromHand">): string {
  // Xerosic's Machinations, phrased for the player holding the hand.
  if (op.untilHandSize !== undefined) {
    return `Discard cards from your hand until you have ${op.untilHandSize} cards in your hand.`;
  }
  // The caption follows the destination: the deck arm says shuffle, not discard.
  if (op.to === "deck") {
    return op.count === 1
      ? "Shuffle a card from your hand into your deck."
      : `Shuffle ${op.count} cards from your hand into your deck.`;
  }
  return op.count === 1
    ? "Discard a card from your hand."
    : `Discard ${op.count} cards from your hand.`;
}

/**
 * Move `uids` from `owner`'s hand to their discard and announce what actually moved. `owner` is
 * hand, chooser and destination. Only uids in hand move, duplicates once; an empty result emits
 * nothing.
 */
function discardChosenFromHand(
  state: GameState,
  owner: Seat,
  uids: readonly string[],
  events: GameEvent[],
): GameState {
  const side = state.players[owner];
  const inHand = new Set(side.hand);
  const discarded: string[] = [];
  const gone = new Set<string>();
  for (const uid of uids) {
    if (!inHand.has(uid) || gone.has(uid)) continue;
    gone.add(uid);
    discarded.push(uid);
  }
  if (discarded.length === 0) return state;
  events.push({ type: "FORCED_HAND_DISCARD", seat: owner, uids: [...discarded] });
  return withSide(state, owner, {
    ...side,
    hand: side.hand.filter((uid) => !gone.has(uid)),
    discard: [...side.discard, ...discarded],
  });
}

/**
 * Move `uids` from `owner`'s hand to the end of their deck and announce what moved. It does not
 * shuffle; the separate `shuffleDeck` op does. Kept separate from `discardChosenFromHand` so the
 * destination is decided at the call site.
 */
function deckChosenFromHand(
  state: GameState,
  owner: Seat,
  uids: readonly string[],
  events: GameEvent[],
): GameState {
  const side = state.players[owner];
  const inHand = new Set(side.hand);
  const moved: string[] = [];
  const gone = new Set<string>();
  for (const uid of uids) {
    if (!inHand.has(uid) || gone.has(uid)) continue;
    gone.add(uid);
    moved.push(uid);
  }
  if (moved.length === 0) return state;
  events.push({ type: "FORCED_HAND_DISCARD", seat: owner, uids: [...moved], to: "deck" });
  return withSide(state, owner, {
    ...side,
    hand: side.hand.filter((uid) => !gone.has(uid)),
    deck: [...side.deck, ...moved],
  });
}

/**
 * Hand cards that can pay a `payFromHand`, with interchangeable copies collapsed to at most `count`
 * each. `excludeUid` is the printed "other": the Trainer paying is still in hand during the gate.
 * Collapsing at cap `count` preserves whether `count` cards are available, so gate and prompt
 * agree.
 */
function handCostCandidates(
  state: GameState,
  seat: Seat,
  op: OpOf<"payFromHand">,
  excludeUid?: string,
): string[] {
  const kept = new Map<string, number>();
  const out: string[] = [];
  // The ceiling is `count` for the exact arm and `cap` for the declinable arm; `cap: "any"` keeps
  // every copy.
  const keepPer =
    op.count !== "any" ? op.count : op.cap === "any" ? Number.POSITIVE_INFINITY : op.cap;
  for (const uid of state.players[seat].hand) {
    if (uid === excludeUid) continue;
    const card = cardOf(state, uid);
    if (op.filter !== undefined && !matchesFilter(card, op.filter)) continue;
    if (op.filter === undefined && card === undefined) continue;
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= keepPer) continue;
    kept.set(key, already + 1);
    out.push(uid);
  }
  return out;
}

/**
 * The first top-level `payFromHand` whose cost the seat cannot pay, or null. Checked before
 * committing a play so an unpayable card is not played. Separate from `programPlayable` because it
 * is printed text and needs the played uid. Each cost is checked against the same starting hand, so
 * it handles only one cost per program.
 */
export function handCostUnmet(
  state: GameState,
  seat: Seat,
  program: readonly EffectOp[],
  excludeUid?: string,
): OpOf<"payFromHand"> | null {
  for (const op of program) {
    if (op.op !== "payFromHand") continue;
    // A declinable "up to N" payment can always be met (paying nothing is legal), so it never
    // refuses a play.
    if (op.count === "any") continue;
    if (handCostCandidates(state, seat, op, excludeUid).length < op.count) return op;
    // The swap needs a top card to switch with.
    if (op.swapWithTop === true && state.players[seat].deck.length === 0) return op;
  }
  return null;
}

/** How a hand cost reads as a printed noun phrase — "2 other cards", "another
    card", "an Energy card", "a Basic Grass Energy card". `other` spells the word
    the TRAINERS carry and the Abilities do not, which is not a stylistic split:
    a Trainer is in the very hand it pays out of, an Ability's card is on the
    board (see effects.ts). Shared by the prompt heading (`other: false` — by then
    the played card has already left the hand, so every offered card IS another
    one) and by both rejection messages (`other` as printed). */
export function handCostPhrase(op: OpOf<"payFromHand">, other: boolean): string {
  const { singular, plural } =
    op.filter === undefined ? { singular: "a card", plural: "cards" } : retrieveNoun(op.filter);
  // The declinable arm's caption prints its ceiling, always plural; Naveen's uncapped arm prints
  // "any number of cards".
  if (op.count === "any" && op.cap === "any")
    return `any number of ${other ? "other " : ""}${plural}`;
  if (op.count === "any") return `up to ${op.cap} ${other ? "other " : ""}${plural}`;
  if (op.count > 1) return `${op.count} ${other ? "other " : ""}${plural}`;
  // "a card" → "another card"; no printed card pairs `other` with a filter, but
  // the article strip keeps it reading correctly if one ever does.
  return other ? `another ${singular.replace(/^an? /, "")}` : singular;
}

/** The whole printed cost clause — the noun phrase above under the VERB its
    destination prints: "discard 2 other cards from your hand" (Ultra Ball) /
    "put another card from your hand on the bottom of your deck" (Dendra). One
    string for the three readers that must agree on the wording: the park's
    heading, both rejection messages (cardplay.ts) and the HUD's disabled-card
    hint. Lower-case and verb-first, so a caller can say "can only be used if you
    …", "Only if you …" or capitalize it into a sentence of its own. */
export function handCostAction(op: OpOf<"payFromHand">, other: boolean): string {
  const phrase = handCostPhrase(op, other);
  // Evidence Gathering's printed verb, ahead of the plain top-of-deck payment.
  if (op.swapWithTop === true)
    return `switch ${phrase} from your hand with the top card of your deck`;
  // Academy at Night's "on top of their deck" and Perrin's "put them into your deck" use their own
  // printed verbs.
  if (op.to === "deckTop") return `put ${phrase} from your hand on top of your deck`;
  if (op.count === "any" && op.to === "deckBottom") {
    return `reveal ${phrase} in your hand and put them into your deck`;
  }
  return op.to === "deckBottom"
    ? `put ${phrase} from your hand on the bottom of your deck`
    : `discard ${phrase} from your hand`;
}

/** The park's heading — the cost clause as an instruction ("Discard a card from
    your hand." / "Put a card from your hand on the bottom of your deck."). The
    played Trainer has already left the hand by the time this is asked, so every
    offered card IS another one and the printed "other" is not repeated here. */
function payFromHandNote(op: OpOf<"payFromHand">): string {
  const action = handCostAction(op, false);
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}.`;
}

/** Switch the controller's Active with their benched `ref` (§G). The outgoing
    Active loses its Special Conditions (§12 — it left the Active spot). */
function switchOwn(
  state: GameState,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  return switchInto(state, ctx.seat, ref, events);
}

/**
 * A switch or gust plus the §9.2 filing for "If you do". The filed uid comes from the
 * `POKEMON_SWITCHED` event, so the record only reflects switches that actually happened.
 */
function switchRecording(
  op: { recordAs?: EffectSlot; recordDemoted?: true; demotedAsMoved?: true },
  move: (into: GameEvent[]) => GameState,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const emitted: GameEvent[] = [];
  const next = move(emitted);
  events.push(...emitted);
  recordMoved(
    record,
    op.recordAs,
    emitted.flatMap((event) => (event.type === "POKEMON_SWITCHED" ? [event.nowActive] : [])),
  );
  // Scramble Switch records the demoted body instead; `recordMoved` assigns, replacing the earlier
  // filing.
  if (op.recordDemoted === true) {
    recordMoved(
      record,
      op.recordAs,
      // Re-keyed through `swappedUid`, since Zero to Hero may have swapped the demoted body's top
      // card; with `demotedAsMoved`, records the card the switch moved.
      emitted.flatMap((event) =>
        event.type === "POKEMON_SWITCHED"
          ? [op.demotedAsMoved === true ? event.wasActive : swappedUid(event.wasActive, emitted)]
          : [],
      ),
    );
  }
  return next;
}

/** The bodies a `switchActive` may switch TO on `seat`'s board — every Benched
    Pokémon, narrowed to the printed owner-prefixed subgroup, and EMPTY when the
    printing names a subgroup the controller's own Active is not in.

    Exported for `programPlayable` (cardplay.ts), which must refuse a Trainer
    whose only effect can whiff — `attachEnergyTargets`' precedent and its
    reason: a gate that recomputed the candidate set would be a second copy of
    the printed rule, free to drift from the op it is meant to be about. */
export function switchActiveTargets(
  state: GameState,
  seat: Seat,
  op: OpOf<"switchActive">,
  sourceUid?: string,
): PokemonRef[] {
  if (op.fromSource === true) {
    // "Switch it with your Active": the bench end is the source body itself. Limited to bench refs,
    // so a source in the Active Spot yields no candidates.
    return sourceRef(state, { seat, sourceUid }).filter((ref) => ref.spot.spot === "bench");
  }
  // Bench-end narrowings applied here because both `programPlayable` and the interpreter use this
  // function.
  const bench = switchBenchNarrowing(
    state,
    subgroupRefs(state, ownBenchRefs(state, seat), op.ownerPokemon),
    op,
  );
  // The owner check reads `op.ownerPokemon`: Pecharunt narrows only the destination, Giovanni
  // narrows both ends.
  if (op.ownerPokemon === undefined) return bench;
  // The printed sentence's FIRST noun — "Switch your Active <owner>'s Pokémon".
  // Asked through the SAME `subgroupRefs` call the Bench end uses, so the two
  // halves of one printed owner cannot come to mean two different things.
  const activeInSubgroup =
    subgroupRefs(state, [{ seat, spot: { spot: "active" } }], op.ownerPokemon).length > 0;
  return activeInSubgroup ? bench : [];
}

/**
 * The opponent's benched bodies a `gust` may target, narrowed by any printed rider. Exported so
 * `programPlayable` checks the same set. The §11 shield is applied at the call site, since
 * `unshieldedRefs` announces refusals.
 */
export function gustTargets(state: GameState, seat: Seat, op: OpOf<"gust">): PokemonRef[] {
  const bench = oppBenchRefs(state, seat);
  // Remaining-HP rider, read from the body; refs with no body are dropped.
  const inWindow =
    op.remainingHpAtMost === undefined
      ? bench
      : bench.filter((ref) => {
          const pokemon = refPokemon(state, ref);
          return (
            pokemon !== undefined && remainingHpWithin(state, pokemon, op.remainingHpAtMost ?? 0)
          );
        });
  if (op.basicOnly !== true) return inWindow;
  return inWindow.filter((ref) => {
    const card = refTopCard(state, ref);
    // A missing top card is not this function's call to make (the op validates
    // refs), but an absent card cannot be shown to be Basic either — and the
    // narrowed sentence must not offer a body it cannot read. `isBasicPokemon`
    // (cards.ts) is asked through `matchesFilter`'s own `basicPokemon` arm so the
    // board half and every deck half of "Basic" stay one predicate.
    return card !== undefined && matchesFilter(card, { kind: "basicPokemon" });
  });
}

/** Whether a body has any damage counters: `damage > 0`, matching the `conditionHolds` arms. */
function hasAnyDamageCounters(pokemon: InPlayPokemon): boolean {
  return pokemon.damage > 0;
}

/**
 * Candidate set for `knockOutChosen`, by `target` scope, narrowed by the damage-counter window
 * (body) then `basicOnly` (card). Unreadable refs are dropped. The §11 shield is applied at the
 * call site.
 */
export function knockOutChosenTargets(
  state: GameState,
  seat: Seat,
  op: OpOf<"knockOutChosen">,
  /** The attacker's top-card uid, excluded by `anyExceptSelf`. */
  sourceUid?: string,
): PokemonRef[] {
  let scope: PokemonRef[];
  switch (op.target) {
    case "opponentAny":
      scope = oppAnyRefs(state, seat);
      break;
    case "opponentBench":
      scope = oppBenchRefs(state, seat);
      break;
    case "anyExceptSelf":
      // Both sides, Active first on each, the attacker dropped by uid.
      scope = [...ownInPlayRefs(state, seat), ...oppAnyRefs(state, seat)].filter((ref) => {
        const pokemon = refPokemon(state, ref);
        return pokemon !== undefined && (sourceUid === undefined || topUid(pokemon) !== sourceUid);
      });
      break;
  }
  if (op.leastHpRemaining === true) return leastHpRemainingRefs(state, scope);
  const inWindow =
    op.damageCountersExactly === undefined
      ? scope
      : scope.filter((ref) => {
          const pokemon = refPokemon(state, ref);
          return pokemon !== undefined && damageCountersOn(pokemon) === op.damageCountersExactly;
        });
  if (op.basicOnly !== true) return inWindow;
  return inWindow.filter((ref) => {
    const card = refTopCard(state, ref);
    // `isBasicPokemon` asked through `matchesFilter`'s own `basicPokemon` arm, so
    // the board half and every deck half of "Basic" stay ONE predicate —
    // `gustTargets`' line one op over, deliberately identical.
    return card !== undefined && matchesFilter(card, { kind: "basicPokemon" });
  });
}

/**
 * Refs in `scope` with the minimum remaining HP (Inteleon "Bring Down"). Bodies with no readable
 * max HP are skipped.
 */
function leastHpRemainingRefs(state: GameState, scope: readonly PokemonRef[]): PokemonRef[] {
  const remaining = scope.flatMap((ref): [PokemonRef, number][] => {
    const pokemon = refPokemon(state, ref);
    const max = pokemon === undefined ? null : effectiveMaxHp(state, pokemon);
    return pokemon === undefined || max === null ? [] : [[ref, max - pokemon.damage]];
  });
  const least = Math.min(...remaining.map(([, hp]) => hp));
  return remaining.filter(([, hp]) => hp === least).map(([ref]) => ref);
}

/** The printed noun for `knockOutChosen` candidates, matching the set offered. */
function knockOutChosenNote(op: OpOf<"knockOutChosen">): string {
  // Bring Down's own sentence.
  if (op.target === "anyExceptSelf") {
    return "Choose a Pokémon in play (yours or your opponent's) that has the least HP remaining, except for this Pokémon, and it is Knocked Out.";
  }
  const scope = op.target === "opponentBench" ? "Benched " : "";
  const stage = op.basicOnly === true ? "Basic " : "";
  // The window rides AFTER the noun because that is where the print puts it, and
  // the counter word is pluralised rather than hard-coded: the anchor captures the
  // number, so a printing at 1 must not read "1 damage counters".
  const window =
    op.damageCountersExactly === undefined
      ? ""
      : ` that has exactly ${op.damageCountersExactly} damage counter${
          op.damageCountersExactly === 1 ? "" : "s"
        } on it`;
  return `Knock Out 1 of your opponent's ${scope}${stage}Pokémon${window}.`;
}

/** The printed noun for `gust` candidates, matching the set `gustTargets` offers. */
function gustTargetNoun(op: OpOf<"gust">): string {
  const stage = op.basicOnly === true ? "Basic " : "";
  // The remaining-HP window goes after the noun, as printed.
  const window =
    op.remainingHpAtMost === undefined
      ? ""
      : ` that has ${op.remainingHpAtMost} HP or less remaining`;
  return `Gust up which of the opponent's Benched ${stage}Pokémon${window}?`;
}

/**
 * Candidates for `healChosen`, shared with `programPlayable` so it can refuse a play that could
 * only whiff. The zone word picks the population and the HP window narrows it.
 */
export function healChosenTargets(
  state: GameState,
  seat: Seat,
  op: OpOf<"healChosen">,
  /** The program's record, read only by `targetRecorded`. Callers without one see no candidates. */
  record?: EffectRecord,
): PokemonRef[] {
  const zonedAll = op.zone === "bench" ? ownBenchRefs(state, seat) : ownInPlayRefs(state, seat);
  // `targetRecorded`: only a body whose stack holds a recorded uid.
  const slot = op.targetRecorded;
  const filed =
    slot === undefined ? undefined : new Set(record === undefined ? [] : recorded(record, slot));
  const zoned =
    filed === undefined
      ? zonedAll
      : zonedAll.filter((ref) =>
          (refPokemon(state, ref)?.stack ?? []).some((uid) => filed.has(uid)),
        );
  // Supportive Singing's subgroup filter ("your Benched Ancient Pokémon").
  const banded = filteredRefs(state, zoned, op.filter);
  const atMost = op.remainingHpAtMost;
  if (atMost === undefined) return banded;
  return banded.filter((ref) => {
    const pokemon = refPokemon(state, ref);
    // A ref this function cannot resolve is dropped rather than offered, exactly
    // as `gustTargets` drops an unreadable body: a narrowed sentence must not put
    // a Pokémon in a prompt whose printed clause it cannot evaluate.
    return pokemon !== undefined && remainingHpWithin(state, pokemon, atMost);
  });
}

/**
 * Narrow refs to bodies whose top card matches `filter`, or return them unchanged when none is
 * given.
 */
function filteredRefs(
  state: GameState,
  refs: PokemonRef[],
  filter: CardFilter | undefined,
): PokemonRef[] {
  if (filter === undefined) return refs;
  return refs.filter((ref) => matchesFilter(refTopCard(state, ref), filter));
}

/** The printed noun for `healChosen` candidates, matching the set `healChosenTargets` offers. */
function healTargetNoun(op: OpOf<"healChosen">): string {
  const zoneWord = op.zone === "bench" ? "Benched " : "";
  const window =
    op.remainingHpAtMost === undefined
      ? ""
      : ` that has ${op.remainingHpAtMost} HP or less remaining`;
  // The filter's plural noun, or "Pokémon".
  const noun = op.filter === undefined ? "Pokémon" : retrieveNoun(op.filter).plural;
  // `recoverHealed` (Pokémon Center Lady): the pick also decides whether conditions clear.
  const rider = op.recoverHealed === true ? " It also recovers from all Special Conditions." : "";
  // `energyToHandFromHealed` (Wally's Compassion): the pick also decides whose Energy moves.
  const toHand =
    op.energyToHandFromHealed === true
      ? " If it heals any damage, all its Energy goes into your hand."
      : "";
  return `Heal which of your ${zoneWord}${noun}${window}?${rider}${toHand}`;
}

/** Gust: switch the OPPONENT's Active with their benched `ref` (Boss's Orders). */
function gust(
  state: GameState,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  return switchInto(state, otherSeat(ctx.seat), ref, events);
}

/** The shared switch move for `seat`'s board: `ref` (a bench index on that
    board) becomes Active; the old Active goes to the bench with its Special
    Conditions cleared. The bench stays dense (the promoted slot closes up, the
    outgoing Active lands at the end). Exported for
    Jet Energy's on-attach switch (turn.ts attachEnergy). */
export function switchInto(
  state: GameState,
  seat: Seat,
  ref: PokemonRef,
  events: GameEvent[],
): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (ref.spot.spot !== "bench" || active === null) return state;
  const index = ref.spot.index;
  const incoming = side.bench[index];
  if (incoming === undefined) return state;
  const wasActive = topUid(active);
  const nowActive = topUid(incoming);
  if (wasActive === undefined || nowActive === undefined) return state;
  const cleared = presentStatuses(active.conditions);
  // Leaving the Active Spot ends Special Conditions and the effects of attacks installed on the
  // body (retreat block, damage block, self-lock, damage reduction, attack lock, and so on). A
  // forced switch can reach these even when retreat could not.
  const benched = {
    ...active,
    // Record when the body went to the Bench (`benchedTurn`).
    benchedTurn: state.turn,
    conditions: noConditions(),
    // A Pokémon switched out and back in on the same turn may use an attack that was barred, and
    // loses any per-attack buff.
    ...clearedAttackEffects(),
  };
  const bench = [...side.bench.slice(0, index), ...side.bench.slice(index + 1), benched];
  events.push({
    type: "POKEMON_SWITCHED",
    seat,
    wasActive,
    nowActive,
    fromBench: index,
    toBench: bench.length - 1,
  });
  if (cleared.length > 0) {
    events.push({
      type: "STATUS_CLEARED",
      seat,
      uid: wasActive,
      statuses: cleared,
      reason: "benched",
    });
  }
  // Stamp the move. This covers every forced bench-to-Active move (Switch, Boss's Orders, Jet
  // Energy); the stamp is a turn number, so a dragged-out Pokémon simply fails to match its
  // controller's next turn. Miraidon "C.O.D.E.: Protect" ends when its source leaves the Active, so
  // the side-wide block is cleared here and stays cleared if the source is re-promoted. The row is
  // emitted only for a live window.
  const sideBlock = side.sideAttackBlock;
  const blockEnds = sideBlock !== null && sideBlock.sourceUid === wasActive;
  if (blockEnds && sideBlock.turn === state.turn) {
    events.push({ type: "SIDE_ATTACK_BLOCK_ENDED", seat, uid: wasActive });
  }
  const moved = withSide(state, seat, {
    ...side,
    active: { ...incoming, promotedTurn: state.turn },
    bench,
    ...(blockEnds ? { sideAttackBlock: null } : {}),
  });
  // §9 opponent-action trigger (Magcargo "Lava Zone"). This is one of the two Active-to-Bench
  // moves; `retreat` is the other, so both call `runActiveBenchedTriggers`. Promotion after a Knock
  // Out is not one: the Knocked Out body went to the discard pile.
  return runActiveBenchedTriggers(moved, seat, wasActive, events);
}

/** Heal from the controller's own in-play `ref`: `amount` HP, or all of its
    damage when `amount` is "all" (Potion 30 / Arboliva's Enriching Oil). */
function healChosen(
  state: GameState,
  ref: PokemonRef,
  amount: number | "all",
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (ref.seat !== ctx.seat) return state;
  const side = state.players[ctx.seat];
  const pokemon = bodyAt(side, ref.spot);
  if (pokemon === undefined) return state;
  const uid = topUid(pokemon);
  if (uid === undefined) return state;
  if (healLocked(state, pokemon)) return state;
  const healed = amount === "all" ? pokemon.damage : Math.min(amount, pokemon.damage);
  if (healed <= 0) return state;
  events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
  const updated = healedBody(pokemon, healed, state.turn);
  if (ref.spot.spot === "active") return withActive(state, ctx.seat, updated);
  const bench = side.bench.map((p, i) =>
    i === (ref.spot as { index: number }).index ? updated : p,
  );
  return withSide(state, ctx.seat, { ...side, bench });
}

/**
 * The first `max` Basic Energy uids in `seat`'s `source` zone matching `energyType` (any Basic
 * Energy when undefined), in zone order. Fewer than `max` is normal ("attach up to N"), so callers
 * must read the length.
 */
function attachableEnergies(
  state: GameState,
  seat: Seat,
  source: "hand" | "discard",
  energyType: string | undefined,
  max: number,
  /**
   * Widens the printed noun from "a Basic Energy card" to "an Energy card". Every consumer of the
   * op asks this one function, so the widening cannot reach some and miss others.
   */
  anyEnergy = false,
  /**
   * The printed proper name ("Spiky Energy"). It replaces the Basic test rather than conjoining
   * with it, since every by-name printing names a Special Energy.
   */
  energyName: string | undefined = undefined,
): string[] {
  if (max <= 0) return [];
  const zone = source === "hand" ? state.players[seat].hand : state.players[seat].discard;
  const found: string[] = [];
  for (const uid of zone) {
    const card = cardOf(state, uid);
    if (
      card !== undefined &&
      isEnergyCard(card) &&
      // Basic Energy by default; `anyEnergy` admits both kinds and a printed name replaces the
      // category question outright.
      (anyEnergy || energyName !== undefined || isBasicEnergy(card)) &&
      (energyType === undefined || energyProvidesOf(card) === energyType) &&
      (energyName === undefined || matchesFilter(card, { kind: "byName", name: energyName }))
    ) {
      found.push(uid);
      if (found.length === max) break;
    }
  }
  return found;
}

/**
 * How many cards an attach moves once its target is answered: the answered `take` clamped to the
 * printed count, or the whole printed batch when no take was sent.
 */
function attachTake(op: OpOf<"attachEnergyFrom">, take: number | undefined): number {
  const printed = op.count ?? 1;
  return take === undefined ? printed : Math.min(take, printed);
}

/**
 * The card question an attach owes once its target is known, or undefined. The pick is a decision
 * only when the pile holds more attachable cards than the take and more than one `cardIdentity`
 * among them. Candidates are every attachable card in pile order; `seat` is the actor.
 */
function energyPickOffer(
  state: GameState,
  op: OpOf<"attachEnergyFrom">,
  seat: Seat,
  take: number,
): { candidates: string[]; take: number } | undefined {
  const owner = attachSeat(op, seat);
  const candidates = attachableEnergies(
    state,
    owner,
    op.source,
    op.energyType,
    state.players[owner][op.source].length,
    op.anyEnergy,
    op.energyName,
  );
  const n = Math.min(take, candidates.length);
  if (n <= 0 || n >= candidates.length) return undefined;
  // `cardIdentity` — the interchangeability key the mandatory discards already ask (a Basic by its
  // type, anything else by its print), so "would picking this one rather than that one differ?" has
  // ONE answer across the attach and the discard families.
  return new Set(candidates.map((uid) => cardIdentity(state, uid))).size > 1
    ? { candidates, take: n }
    : undefined;
}

/** The card question's caption, naming the body the cards go onto. */
function energyPickNote(state: GameState, ref: PokemonRef, take: number): string {
  const body = refPokemon(state, ref);
  const top = body === undefined ? undefined : topUid(body);
  const name = top === undefined ? undefined : cardOf(state, top)?.name;
  const what =
    take === 1
      ? "Which Energy card do you want to attach"
      : `Which ${take} Energy cards do you want to attach`;
  return name === undefined ? `${what}?` : `${what} to ${name}?`;
}

/**
 * The first matching Basic Energy uid, or undefined. It stays a one-card question even under
 * `count`: "up to 2" with one Energy in hand still attaches one, so it is not a whiff.
 */
export function firstAttachableEnergy(
  state: GameState,
  seat: Seat,
  source: "hand" | "discard",
  energyType: string | undefined,
  /** Carried through so the play gate and park guard ask the same question the apply answers. */
  anyEnergy = false,
  /** Carried through so the play gate and park guard ask the same question the apply answers. */
  energyName?: string,
): string | undefined {
  return attachableEnergies(state, seat, source, energyType, 1, anyEnergy, energyName)[0];
}

/**
 * The in-play Pokémon an attach may target (Active first, then bench), filtered by the printed
 * riders. This is the only target gate: `validateChoice` matches answers against the prompt this
 * produced, so a new rider needs no separate validation. Shared by every attach op and by
 * `programPlayable`.
 */
export function attachEnergyTargets(
  state: GameState,
  seat: Seat,
  riders: AttachTargetRiders,
): PokemonRef[] {
  // `seat` is the actor; targets are on the owner's board resolved from the riders' `whose`, and
  // every ref carries the owner's seat.
  const owner = attachSeat(riders, seat);
  const side = state.players[owner];
  const eligible = (pokemon: InPlayPokemon): boolean => {
    if (
      riders.targetType !== undefined ||
      riders.basicOnly === true ||
      riders.stage2Only === true ||
      riders.ownerPokemon !== undefined ||
      riders.targetBanner !== undefined
    ) {
      // Read the in-play card so `targetType` sees the types the body has.
      const card = inPlayCardOf(state, pokemon);
      // `targetType` may be a list, so the test is any-of-any against the body's types.
      const wantedTypes = targetTypeNames(riders.targetType);
      if (wantedTypes.length > 0) {
        const cardTypes = card?.types ?? [];
        if (!wantedTypes.some((wanted) => cardTypes.includes(wanted))) return false;
      }
      if (riders.basicOnly === true && (card === undefined || !isBasicPokemon(card))) return false;
      // Rosa's Encouragement's printed "Stage 2".
      if (riders.stage2Only === true && (card === undefined || !isStage2Pokemon(card)))
        return false;
      // The owner-prefixed subgroup, read through `matchesFilter`'s `ownerPokemon` arm so the deck
      // and board halves agree on who is an "Iono's Pokémon". No printing narrows an in-play target
      // by stage.
      if (
        riders.ownerPokemon !== undefined &&
        !matchesFilter(card, { kind: "ownerPokemon", owner: riders.ownerPokemon })
      ) {
        return false;
      }
      // The printed banner target ("your Tera Pokémon").
      if (
        riders.targetBanner !== undefined &&
        !matchesFilter(card, { kind: "bannerPokemon", banner: riders.targetBanner })
      ) {
        return false;
      }
    }
    if (riders.notIfKO === true && riders.bonusCounters !== undefined) {
      const hp = effectiveMaxHp(state, pokemon);
      if (hp !== null && pokemon.damage + riders.bonusCounters >= hp) return false;
    }
    // Glimmora's bar: a hand attach skips a barred body.
    if (riders.source === "hand" && liveHandAttachMark(state, pokemon)?.barred === true)
      return false;
    return true;
  };
  const refs: PokemonRef[] = [];
  if (riders.benchOnly !== true && side.active !== null && eligible(side.active)) {
    refs.push({ seat: owner, spot: { spot: "active" } });
  }
  // `activeOnly` (Lethargic Charge): the Bench is not offered.
  if (riders.activeOnly === true) return refs;
  side.bench.forEach((pokemon, index) => {
    if (eligible(pokemon)) refs.push({ seat: owner, spot: { spot: "bench", index } });
  });
  return refs;
}

/**
 * The seat whose discard pile is read and whose board is targeted for a cross-seat attach (`whose:
 * "opponent"`, Grafaiai); no printing separates the two. Events keep the actor's seat. Absent means
 * the actor's own seat.
 */
export function attachSeat(op: { readonly whose?: "opponent" }, seat: Seat): Seat {
  return op.whose === "opponent" ? otherSeat(seat) : seat;
}

/**
 * The printed "this Pokémon" as a zero- or one-element target list: the in-play Pokémon whose top
 * card is `ctx.sourceUid`. Empty is a live answer (no source, or the card is no longer a top).
 * Matched by top uid because a card evolved over is no longer "this Pokémon". Takes only the fields
 * it reads so `programPlayable` can call it without an `EffectContext`.
 *
 * The filter for "Pokémon that are the same type as any Basic Energy attached to this Pokémon",
 * resolved at the park: `anyOf(typedPokemon × T)` for the types provided by Basic Energy attached
 * to the source body. Special Energy never counts, and the category filter runs before
 * `energyProvidesOf` so a Special's Colorless fallback cannot admit every Colorless Pokémon. Zero
 * types gives `anyOf([])`, which matches nothing, never an unconstrained search. Resolved here
 * because `matchesFilter` sees no board.
 */
function attachedBasicEnergyTypedFilter(state: GameState, ctx: EffectContext): CardFilter {
  const [host] = sourceRef(state, ctx);
  const body = host === undefined ? undefined : refPokemon(state, host);
  const types: PokemonType[] = [];
  for (const uid of body?.energy ?? []) {
    const card = cardOf(state, uid);
    if (card === undefined || !matchesFilter(card, { kind: "basicEnergy" })) continue;
    const provided = energyProvidesOf(card);
    if (!(POKEMON_TYPES as readonly string[]).includes(provided)) continue;
    const pokemonType = provided as PokemonType;
    if (!types.includes(pokemonType)) types.push(pokemonType);
  }
  return {
    kind: "anyOf",
    filters: types.map((pokemonType) => ({ kind: "typedPokemon", pokemonType })),
  };
}

/**
 * Love Ball's "a Pokémon with the same name as 1 of your opponent's Pokémon in play", resolved at
 * step time to an exact-name `anyOf` over the opponent's top cards. An empty opposing board matches
 * nothing.
 */
function opponentInPlayNameFilter(state: GameState, ctx: EffectContext): CardFilter {
  const side = state.players[otherSeat(ctx.seat)];
  const bodies = inPlayOf(side);
  const names: string[] = [];
  for (const body of bodies) {
    const name = topCardOf(state, body)?.name;
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return { kind: "anyOf", filters: names.map((name) => ({ kind: "byName", name })) };
}

function sourceRef(state: GameState, ctx: Pick<EffectContext, "seat" | "sourceUid">): PokemonRef[] {
  if (ctx.sourceUid === undefined) return [];
  const side = state.players[ctx.seat];
  if (side.active !== null && topUid(side.active) === ctx.sourceUid) {
    return [{ seat: ctx.seat, spot: { spot: "active" } }];
  }
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === ctx.sourceUid);
  return index === -1 ? [] : [{ seat: ctx.seat, spot: { spot: "bench", index } }];
}

/**
 * What an `attachFromTop` op offers: the cards in the top `n` its filter admits (top first), the
 * eligible targets, and the cap `min(printed, candidates.length)`, so `"any"` is the degenerate
 * case. Reads the deck, so it is only asked when the op runs and is not a `programPlayable` input.
 */
function attachFromTopOffer(
  state: GameState,
  seat: Seat,
  op: OpOf<"attachFromTop">,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  const top = state.players[seat].deck.slice(0, Math.max(0, op.n));
  const candidates = top.filter((uid) => matchesFilter(cardOf(state, uid), op.filter));
  return {
    candidates,
    targets: attachEnergyTargets(state, seat, op),
    max: Math.min(op.max === "any" ? candidates.length : op.max, candidates.length),
  };
}

/**
 * What an `attachFromDeck` op offers: deck-wide matches, eligible targets, and the cap.
 * Interchangeable cards (by `cardIdentity`) collapse to at most `max` representatives each, so
 * every distinguishable answer stays reachable without a dozen identical rows. The cap is the
 * minimum of the printed `max`, the candidates available, and `targets.length × maxPerTarget` when
 * a per-target rule applies. `oneTarget` adds no ceiling: one target may take every card. The board
 * ceiling is taken before the collapse. Only asked when the op runs; not a `programPlayable` input.
 */
function attachFromDeckOffer(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"attachFromDeck">,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  const seat = ctx.seat;
  const targets = op.toSelf === true ? sourceRef(state, ctx) : attachEnergyTargets(state, seat, op);
  const cap =
    op.maxPerTarget === undefined ? op.max : Math.min(op.max, targets.length * op.maxPerTarget);
  const matches = state.players[seat].deck.filter((uid) =>
    matchesFilter(cardOf(state, uid), op.filter),
  );
  const kept = new Map<string, number>();
  const candidates: string[] = [];
  // "Of different types" (Prism Charge): the collapse keys by provided type and keeps one uid per
  // type, so every legal answer is pairwise type-distinct.
  const distinct = op.distinctEnergyTypes === true;
  for (const uid of matches) {
    const card = distinct ? cardOf(state, uid) : undefined;
    const key = distinct
      ? `type:${card === undefined ? uid : energyProvidesOf(card)}`
      : cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= (distinct ? 1 : cap)) continue;
    kept.set(key, already + 1);
    candidates.push(uid);
  }
  return { candidates, targets, max: Math.min(cap, candidates.length) };
}

/**
 * `attachFromDeck.each` (Overflowing Wishes): `max` per offered body, so the total is `max` ×
 * bodies and the per-target cap is `max`. Other ops are returned unchanged.
 */
function perBodyDeckOp(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"attachFromDeck">,
): OpOf<"attachFromDeck"> {
  if (op.each !== true) return op;
  const bodies = attachEnergyTargets(state, ctx.seat, op).length;
  return { ...op, max: op.max * bodies, maxPerTarget: op.max };
}

/**
 * What an `attachFromDiscard` op offers (Glass Trumpet): admitted discard cards collapsed by
 * identity to the reachable total, the bodies `attachEnergyTargets` admits, and the ceiling.
 * Exported for `programPlayable`: an offer with no card or no body can only whiff.
 */
export function attachFromDiscardOffer(
  state: GameState,
  seat: Seat,
  op: OpOf<"attachFromDiscard">,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  const targets = attachEnergyTargets(state, seat, op);
  const ceiling = discardAttachCeiling(state, seat, op);
  // The reachable total: up to `max`, and never more than one per offered body; under `each`, `max`
  // per body.
  const reach =
    op.each === true
      ? ceiling * targets.length
      : op.maxPerTarget === undefined
        ? ceiling
        : Math.min(ceiling, targets.length * op.maxPerTarget);
  const kept = new Map<string, number>();
  const candidates: string[] = [];
  const pile = state.players[seat].discard;
  for (const uid of pile) {
    if (!matchesFilter(cardOf(state, uid), op.filter)) continue;
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= reach) continue;
    kept.set(key, already + 1);
    candidates.push(uid);
  }
  return { candidates, targets, max: Math.min(reach, candidates.length) };
}

/**
 * An `attachFromDiscard`'s printed ceiling as a number: the printed count, or Tail Generator's
 * energy count over the opponent's board, read when the op runs.
 */
function discardAttachCeiling(state: GameState, seat: Seat, op: OpOf<"attachFromDiscard">): number {
  return op.max === "opponentEnergyInPlay"
    ? countEnergyInPlay(state, otherSeat(seat), null)
    : op.max;
}

/**
 * Reboot Pod's mandatory "to each of your Future Pokémon": apply the player's assignments, then
 * give every offered body still short of `op.max` the next matching discard card in pile order
 * while the pile lasts, so an empty or short answer cannot decline the effect.
 */
function eachAttachTopUp(
  state: GameState,
  op: OpOf<"attachFromDiscard">,
  assignments: readonly { uid: string; to: PokemonRef }[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const given = attachFromZoneApply(state, assignments, "discard", ctx, events);
  const landed = new Map<string, number>();
  for (const { uid, to } of assignments) {
    if (given.attached.includes(uid)) landed.set(refKeyOf(to), (landed.get(refKeyOf(to)) ?? 0) + 1);
  }
  const pile = given.state.players[ctx.seat].discard.filter((uid) =>
    matchesFilter(cardOf(given.state, uid), op.filter),
  );
  const fill: { uid: string; to: PokemonRef }[] = [];
  const perBody = discardAttachCeiling(state, ctx.seat, op);
  for (const to of attachEnergyTargets(given.state, ctx.seat, op)) {
    for (let n = landed.get(refKeyOf(to)) ?? 0; n < perBody; n += 1) {
      const uid = pile.shift();
      if (uid === undefined) break;
      fill.push({ uid, to });
    }
  }
  return attachFromZoneApply(given.state, fill, "discard", ctx, events).state;
}

/**
 * What an `attachFromHand` op offers: admitted hand cards (hand order), the eligible targets, and
 * the cap. Every printing reads "any number", so the cap is the candidate set and no
 * interchangeable collapse runs; the hand is already visible to its owner. The singular printing
 * (`one`, Lethargic Charge) caps at 1 and feeds the play gate through `attachFromHandPlayable`.
 */
function attachFromHandOffer(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"attachFromHand">,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  // Takes the context because "to this Pokémon" needs `ctx.sourceUid`.
  const seat = ctx.seat;
  const candidates = state.players[seat].hand.filter((uid) =>
    matchesFilter(cardOf(state, uid), op.filter),
  );
  // `toSelf` prints "to this Pokémon", so the sole target is `sourceRef`, filtered through
  // Glimmora's bar.
  if (op.toSelf === true) {
    return {
      candidates,
      targets: handOpenRefs(state, sourceRef(state, ctx)),
      max: candidates.length,
    };
  }
  // The printed singular "Attach an Energy card … to your Active Larry's Pokémon" (Lethargic
  // Charge): riders reach `attachEnergyTargets` and the cap is one card.
  if (op.one === true) {
    const riders: AttachTargetRiders = {
      source: "hand",
      ...(op.activeOnly === true ? { activeOnly: true as const } : {}),
      ...(op.ownerPokemon === undefined ? {} : { ownerPokemon: op.ownerPokemon }),
    };
    return {
      candidates,
      targets: attachEnergyTargets(state, seat, riders),
      max: Math.min(1, candidates.length),
    };
  }
  // The printed "up to N" (Pleasing Present). `ctx.seat` is the hand's owner here, so the board
  // read is theirs too.
  if (op.max !== undefined) {
    return {
      candidates,
      targets: attachEnergyTargets(state, seat, { source: "hand" }),
      max: Math.min(op.max, candidates.length),
    };
  }
  return {
    candidates,
    targets: attachEnergyTargets(state, seat, { source: "hand" }),
    max: candidates.length,
  };
}

/** The forced top-up: the first offered hand card onto the first offered target, or nothing. */
function handTopUp(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"attachFromHand">,
): { uid: string; to: PokemonRef }[] {
  const offer = attachFromHandOffer(state, ctx, op);
  const [uid] = offer.candidates;
  const [to] = offer.targets;
  return uid === undefined || to === undefined ? [] : [{ uid, to }];
}

/**
 * `attachFromHandOffer` for the play gate, which has a seat and the acting body's uid but no
 * `EffectContext`.
 */
export function attachFromHandPlayable(
  state: GameState,
  seat: Seat,
  op: OpOf<"attachFromHand">,
  sourceUid?: string,
): boolean {
  const offer = attachFromHandOffer(
    state,
    sourceUid === undefined ? { seat } : { seat, sourceUid },
    op,
  );
  return offer.candidates.length > 0 && offer.targets.length > 0;
}

/**
 * `refs` minus every body carrying a live Glimmora bar, for the `toSelf` hand attaches that do not
 * go through `attachEnergyTargets`.
 */
function handOpenRefs(state: GameState, refs: PokemonRef[]): PokemonRef[] {
  return refs.filter((ref) => {
    const side = state.players[ref.seat];
    const body = bodyAt(side, ref.spot);
    return body === undefined || liveHandAttachMark(state, body)?.barred !== true;
  });
}

/**
 * Hypno "Daydream" on the effect path: if `body` just took an Energy from hand and carries a live
 * `endsTurn` mark, trip it; `settleProgram` then ends the controller's turn.
 */
function tripHandAttachMark(state: GameState, body: InPlayPokemon): InPlayPokemon {
  const mark = liveHandAttachMark(state, body);
  return mark?.endsTurn ? { ...body, handAttachMark: { ...mark, tripped: true } } : body;
}

/**
 * Pachirisu "Electrified Incisors": `cards` Energy just went from hand onto `body`, so a live mark
 * places its counters for each card, filed as an attack placement. No Knock Out check here; the
 * caller's sweep owns it.
 */
export function shockHandAttach(
  state: GameState,
  seat: Seat,
  body: InPlayPokemon,
  cards: number,
  events: GameEvent[],
): InPlayPokemon {
  const counters = liveHandAttachMark(state, body)?.counters ?? 0;
  const uid = topUid(body);
  if (counters <= 0 || cards <= 0 || uid === undefined) return body;
  const amount = counters * HP_PER_COUNTER * cards;
  events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: "attack" });
  return { ...body, damage: body.damage + amount };
}

/**
 * The effect path of a watched hand attach (Magearna "Auto Heal", Gengar ex "Gnawing Curse"): these
 * name the source zone, so an Ability or attack attaching from hand counts. One moment per card,
 * actor's sweep first then the opponent's; Electrified Incisors counters are placed last for each
 * card. Knock Outs are the caller's settle.
 */
function handAttachWatched(
  state: GameState,
  actor: Seat,
  energyUids: readonly string[],
  events: GameEvent[],
): GameState {
  const atMoment = state;
  let next = state;
  for (const energyUid of energyUids) {
    const side = next.players[actor];
    const host = [side.active, ...side.bench].find(
      (body) => body?.energy.includes(energyUid) === true,
    );
    const subject = host == null ? undefined : topUid(host);
    if (subject === undefined) continue;
    next = runSelfWatchedTriggers(next, actor, subject, "onEnergyAttach", events, atMoment);
    next = runWatchedTriggers(next, actor, subject, "onEnergyAttach", events, atMoment);
    next = shockHandAttachHost(next, actor, subject, events);
  }
  return next;
}

/**
 * `shockHandAttach` for one Energy card on `actor`'s body whose top is `subject`, re-found on the
 * live board.
 */
function shockHandAttachHost(
  state: GameState,
  actor: Seat,
  subject: string,
  events: GameEvent[],
): GameState {
  const side = state.players[actor];
  if (side.active !== null && topUid(side.active) === subject) {
    const shocked = shockHandAttach(state, actor, side.active, 1, events);
    return shocked === side.active ? state : withSide(state, actor, { ...side, active: shocked });
  }
  const index = side.bench.findIndex((body) => topUid(body) === subject);
  const benched = side.bench[index];
  if (benched === undefined) return state;
  const shocked = shockHandAttach(state, actor, benched, 1, events);
  return shocked === benched
    ? state
    : withSide(state, actor, {
        ...side,
        bench: side.bench.map((body, i) => (i === index ? shocked : body)),
      });
}

/**
 * Apply a deck-search attach (Infernal Reign, Janine's Secret Art): move each assigned card onto
 * its assigned Pokémon and return the uids that actually moved (§9.2). `validateChoice` is the only
 * gate on what may attach; this only re-reads the source zone and skips stale uids or missing
 * targets so a card is never conjured or lost. Each attach emits ENERGY_ATTACHED with the target
 * rebuilt field by field (§2). The trailing `shuffleDeck` op does the shuffle. `zone` lets the hand
 * and discard attaches share this mover.
 */
function attachFromZoneApply(
  state: GameState,
  assignments: readonly { uid: string; to: PokemonRef }[],
  zone: "deck" | "hand" | "discard",
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; attached: string[] } {
  const side = state.players[ctx.seat];
  const inZone = new Set(side[zone]);
  let active = side.active;
  let bench = side.bench;
  const attached = new Set<string>();
  for (const { uid, to } of assignments) {
    if (!inZone.has(uid) || attached.has(uid) || to.seat !== ctx.seat) continue;
    // A hand attach trips Hypno's turn-end mark.
    const trip = (body: InPlayPokemon): InPlayPokemon =>
      zone === "hand" ? tripHandAttachMark(state, body) : body;
    if (to.spot.spot === "active") {
      if (active === null) continue;
      active = trip({ ...active, energy: [...active.energy, uid] });
    } else {
      const index = to.spot.index;
      if (bench[index] === undefined) continue;
      bench = bench.map((p, i) => (i === index ? trip({ ...p, energy: [...p.energy, uid] }) : p));
    }
    attached.add(uid);
    events.push({
      type: "ENERGY_ATTACHED",
      seat: ctx.seat,
      uid,
      target:
        to.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: to.spot.index },
    });
  }
  if (attached.size === 0) return { state, attached: [] };
  const moved = withSide(state, ctx.seat, {
    ...side,
    active,
    bench,
    [zone]: side[zone].filter((uid) => !attached.has(uid)),
  });
  // A hand attach is the moment `onEnergyAttach` watches (Auto Heal, Gnawing Curse).
  return {
    state: zone === "hand" ? handAttachWatched(moved, ctx.seat, [...attached], events) : moved,
    attached: [...attached],
  };
}

/**
 * Attach the first matching Basic Energy from `op.source` onto the chosen Pokémon `ref` (one by
 * default, `op.count` when the print pins a batch), unless an unlike pile was picked via
 * `chosenUids`. Not the §6.3 manual attach; no allowance is used. `count` attaches to the one `ref`
 * and never re-asks. `bonusCounters` and `healTarget` fire once per op, not per card; the heal runs
 * last.
 */
function attachEnergyFrom(
  state: GameState,
  op: OpOf<"attachEnergyFrom">,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
  /**
   * The running §9.2 record. Whiffs return early and file nothing, since a missing key already
   * reads as empty.
   */
  record: EffectRecord = {},
  /**
   * How many the controller asked for. Absent means the whole printed batch (the forced path).
   * Clamped to the printed ceiling because a wire-supplied number can reach here.
   */
  take?: number,
  /**
   * The Energy cards the controller picked. Absent means the leading matches in pile order, used
   * only when they are interchangeable. A picked uid no longer attachable is skipped.
   */
  chosenUids?: readonly string[],
): GameState {
  // The owner's seat, resolved once: the pile, the validated board and the rewritten side are all
  // the owner's. `ctx.seat` is used only on events (the actor).
  const seat = attachSeat(op, ctx.seat);
  if (ref.seat !== seat) return state;
  const printed = op.count ?? 1; // absent = a single attach
  const energyUids = attachableEnergies(
    state,
    seat, // the printed pile's owner
    op.source,
    op.energyType,
    chosenUids === undefined
      ? take === undefined
        ? printed
        : Math.min(take, printed)
      : state.players[seat][op.source].length,
    op.anyEnergy, // absent = the printed "a Basic Energy card"
    op.energyName,
  )
    .filter((uid) => chosenUids === undefined || chosenUids.includes(uid))
    // A picked list is capped at the printed count.
    .slice(0, chosenUids === undefined ? undefined : printed);
  if (energyUids.length === 0) return state;
  const side = state.players[seat];
  const pokemon = bodyAt(side, ref.spot);
  if (pokemon === undefined) return state;
  // Glimmora's bar at the apply: the `toSelf` hand attaches never pass through
  // `attachEnergyTargets`'s filter. A barred body takes nothing and nothing is filed.
  if (op.source === "hand" && liveHandAttachMark(state, pokemon)?.barred === true) return state;
  const targetUid = topUid(pokemon);
  if (targetUid === undefined) return state;
  let updated: InPlayPokemon = { ...pokemon, energy: [...pokemon.energy, ...energyUids] };
  // A hand attach trips Hypno's turn-end mark.
  if (op.source === "hand") updated = tripHandAttachMark(state, updated);
  // Remove the Energy from its source zone (hand or the public discard pile).
  const drop = (zone: readonly string[]): string[] =>
    energyUids.reduce<string[]>((rest, uid) => without(rest, uid), [...zone]);
  const base: PlayerSide =
    op.source === "hand"
      ? { ...side, hand: drop(side.hand) }
      : { ...side, discard: drop(side.discard) };
  for (const energyUid of energyUids) {
    events.push({
      type: "ENERGY_ATTACHED",
      seat: ctx.seat,
      uid: energyUid,
      target: { ...ref.spot },
    });
  }
  if (op.bonusCounters !== undefined && op.bonusCounters > 0) {
    updated = { ...updated, damage: updated.damage + op.bonusCounters };
    events.push({
      type: "COUNTERS_PLACED",
      seat: ctx.seat,
      uid: targetUid,
      amount: op.bonusCounters,
      source: "ability",
    });
  }
  // What was ATTACHED, not what was offered (§9.2) — the ENERGY uids, the one
  // kind of thing this record's values ever hold, which is what lets the gate's
  // `contains: "yourActive"` ask the BOARD where they ended up. Filed once, here,
  // rather than at the two call sites: the forced path and the resumed pick both
  // land in this function, and two filings are two places to drift.
  recordMoved(record, op.recordAs, energyUids);
  const index = ref.spot.spot === "active" ? -1 : (ref.spot as { index: number }).index;
  const next =
    index < 0
      ? withSide(state, seat, { ...base, active: updated })
      : withSide(state, seat, {
          ...base,
          bench: side.bench.map((p, i) => (i === index ? updated : p)),
        });
  // "If you do, heal all damage from that Pokémon." Every whiff returns above, so the early returns
  // are the "if you do" gate. Once per op, not per card.
  const fed =
    op.healTarget === undefined ? next : healChosen(next, ref, op.healTarget, ctx, events);
  // The watched attach moment runs after the op's own riders, matching turn.ts. Only an attach from
  // the attaching player's own hand counts.
  return op.source === "hand" && seat === ctx.seat
    ? handAttachWatched(fed, seat, energyUids, events)
    : fed;
}

/**
 * Apply a from-the-top attach (Electric Generator, Hydreigon "Tri Howl"): move each assigned card
 * off the deck top onto its target, then settle the leftovers. `validateChoice` is the only gate;
 * this re-reads the window and skips stale uids or missing targets so cards are never duplicated or
 * lost. The leftovers run on every path, including empty ones. They are the whole window minus what
 * was attached, not just unattached candidates; `restTo` absent leaves them on top for the trailing
 * shuffle.
 */
function attachFromTopApply(
  state: GameState,
  assignments: readonly { uid: string; to: PokemonRef }[],
  op: OpOf<"attachFromTop">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const window = side.deck.slice(0, Math.max(0, op.n));
  const inWindow = new Set(window);
  let active = side.active;
  let bench = side.bench;
  const attached = new Set<string>();
  for (const { uid, to } of assignments) {
    if (!inWindow.has(uid) || attached.has(uid) || to.seat !== ctx.seat) continue;
    if (to.spot.spot === "active") {
      if (active === null) continue;
      active = { ...active, energy: [...active.energy, uid] };
    } else {
      const index = to.spot.index;
      if (bench[index] === undefined) continue;
      bench = bench.map((p, i) => (i === index ? { ...p, energy: [...p.energy, uid] } : p));
    }
    attached.add(uid);
    events.push({
      type: "ENERGY_ATTACHED",
      seat: ctx.seat,
      uid,
      target:
        to.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: to.spot.index },
    });
  }
  // Deck order, top first — the order the discard pile gains them (§2).
  const rest = op.restTo === undefined ? [] : window.filter((uid) => !attached.has(uid));
  if (attached.size === 0 && rest.length === 0) return state;
  // `toPile` is the cards that left the deck; `underneath` the cards that stayed and moved.
  const toPile = op.restTo === "discard" ? rest : [];
  // Only `"shuffledBottom"` touches `rngState`, and `shuffle` leaves it alone for 0 or 1 leftovers.
  const [underneath, rngState] =
    op.restTo === "shuffledBottom"
      ? shuffle(rest, state.rngState)
      : [[] as string[], state.rngState];
  const removed = new Set([...attached, ...rest]);
  // This op only looks at the controller's own top, so `actor` is `seat`. Only the discard arm
  // emits an event: a card put under the deck never left it. `SHUFFLE` is not emitted because only
  // a small tail is randomized, not the whole deck.
  if (toPile.length > 0)
    events.push({ type: "DECK_TOP_DISCARDED", seat: ctx.seat, actor: ctx.seat, uids: [...toPile] });
  const kept = side.deck.filter((uid) => !removed.has(uid));
  // The bottomed leftovers go UNDER everything the deck still holds — appended after
  // the removal, so a window deeper than the rest of the deck cannot reorder it.
  // `rngState` is threaded rather than assumed unchanged: it is a field of `GameState`
  // and not of the side, so a shuffled leftover has to be written back here or the
  // randomness is spent and then thrown away.
  return withSide({ ...state, rngState }, ctx.seat, {
    ...side,
    active,
    bench,
    deck: underneath.length === 0 ? kept : [...kept, ...underneath],
    discard: toPile.length === 0 ? side.discard : [...side.discard, ...toPile],
  });
}

/**
 * Move each chosen Energy off its host onto the destination that pick names, on the board the op
 * names. `validateChoice` already proved the answer; this re-finds each uid on the live board and
 * skips stale, self-targeting or missing-destination picks. Pokémon stay put, so event refs are
 * valid against the post-state. Strip and re-attach happen in one reduction, so an Energy is never
 * left detached.
 */
function moveEnergyApply(
  state: GameState,
  picks: readonly { uid: string; dest: PokemonRef }[],
  op: OpOf<"moveEnergy">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // The board is the op's, not the controller's.
  const board = moveBoardSeat(op, ctx.seat);
  const side = state.players[board];
  // The destination is rebuilt field by field, never spread off the pick: it came from the wire and
  // `refEquals` checks only seat/spot/index, so extra keys would leak into events.
  const targetOf = (ref: PokemonRef): PokemonTarget =>
    ref.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: ref.spot.index };
  const keyOf = (target: PokemonTarget): string =>
    target.spot === "active" ? "active" : `bench:${target.index}`;
  const bodyAt = (target: PokemonTarget): InPlayPokemon | undefined =>
    target.spot === "active" ? (side.active ?? undefined) : side.bench[target.index];
  // uid to destination, built first so a pick naming a body not in play drops out before its uid
  // leaves its host.
  const destOf = new Map<string, PokemonTarget>();
  for (const { uid, dest } of picks) {
    // A pick aimed at the side this op does not act on is dropped silently.
    if (typeof uid !== "string" || dest.seat !== board || destOf.has(uid)) continue;
    const to = targetOf(dest);
    if (bodyAt(to) === undefined) continue;
    destOf.set(uid, to);
  }
  if (destOf.size === 0) return state;
  // Grouped by (source, destination) pair, one event per pair, because `ENERGY_MOVED` promises all
  // its uids share one `from` and one `to`. Each entry keeps its source's top uid since the source
  // may be Knocked Out later in this reduction.
  const groups: {
    from: PokemonTarget;
    fromUid: string | undefined;
    to: PokemonTarget;
    uids: string[];
  }[] = [];
  const arrivals = new Map<string, string[]>();
  const strip = (pokemon: InPlayPokemon, target: PokemonTarget): InPlayPokemon => {
    const byDest = new Map<string, { uids: string[] }>();
    const kept = pokemon.energy.filter((uid) => {
      const to = destOf.get(uid);
      // Never strip a pick whose destination is the body it sits on; `validateChoice` refuses it,
      // this keeps the apply honest.
      if (to === undefined || keyOf(to) === keyOf(target)) return true;
      let group = byDest.get(keyOf(to));
      if (group === undefined) {
        group = { uids: [] };
        byDest.set(keyOf(to), group);
        groups.push({ from: target, fromUid: topUid(pokemon), to, uids: group.uids });
      }
      group.uids.push(uid);
      const inbound = arrivals.get(keyOf(to));
      if (inbound === undefined) arrivals.set(keyOf(to), [uid]);
      else inbound.push(uid);
      return false;
    });
    return kept.length === pokemon.energy.length ? pokemon : { ...pokemon, energy: kept };
  };
  const activeStripped = side.active === null ? null : strip(side.active, { spot: "active" });
  const benchStripped = side.bench.map((pokemon, index) =>
    strip(pokemon, { spot: "bench", index }),
  );
  if (groups.length === 0) return state; // nothing actually moved
  // Re-attach, read off the STRIPPED board (no destination is ever stripped for a
  // pick aimed at it, so this cannot drop a just-moved uid) — and in board-walk
  // order, which for a single destination is byte-identical to the order this
  // function appended before the map existed.
  const addTo = (pokemon: InPlayPokemon, key: string): InPlayPokemon => {
    const inbound = arrivals.get(key);
    return inbound === undefined
      ? pokemon
      : { ...pokemon, energy: [...pokemon.energy, ...inbound] };
  };
  const active = activeStripped === null ? null : addTo(activeStripped, "active");
  const bench = benchStripped.map((pokemon, index) => addTo(pokemon, `bench:${index}`));
  // One row per (SOURCE, DESTINATION) pair, in the order the board was walked
  // (Active first, then the bench left to right) — a two-source N's Plan reads as
  // the two sentences it is, and a Kilowattrel spread reads as the several it is.
  for (const group of groups) {
    events.push({
      type: "ENERGY_MOVED",
      // `seat` is the board and `actor` the cause; they differ only on the opponent-board
      // printings, and `log.ts` forks on the comparison.
      seat: board,
      actor: ctx.seat,
      uids: [...group.uids],
      from: group.from,
      ...(group.fromUid === undefined ? {} : { fromUid: group.fromUid }),
      to: group.to,
    });
  }
  return withSide(state, board, { ...side, active, bench });
}

/**
 * Discard the chosen Energy off the victim's Pokémon into the victim's discard pile (cards go to
 * their owner's pile, §8.1). The victim is the opponent for hammer arms and the controller for
 * `yourActive`. Re-finds each uid on the live board and skips stale ones. One event per affected
 * Pokémon, in board order. Never damages.
 */
function discardEnergyApply(
  state: GameState,
  uids: readonly string[],
  op: OpOf<"discardEnergy">,
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; discarded: string[] } {
  if (uids.length === 0) return { state, discarded: [] };
  const victim = discardVictimSeat(ctx.seat, op);
  // Milotic "Mentally Calm" opposite the victim: a `to: "hand"` move whiffs and the Energy stays
  // attached.
  if (op.to === "hand" && inPlayToHandBlocked(state, victim)) return { state, discarded: [] };
  const side = state.players[victim];
  const picks = new Set(uids);
  // Collected in one pass so events read Active-then-bench. `host` is captured off the pre-strip
  // stack because the attack may have Knocked Out the defender, so events name the Pokémon by uid.
  // The destination is read once so the events and the zone write agree; absent means the discard
  // pile, and both zones belong to `victim`.
  const toHand = op.to === "hand";
  // Deck destination (Wellspring Mask Ogerpon ex: "shuffle 3 Energy attached to this Pokémon into
  // your deck"). The shuffle is the trailing `shuffleDeck` op.
  const toDeck = op.to === "deck";
  const pulled: { target: PokemonTarget; host: string; uids: string[]; body: InPlayPokemon }[] = [];
  const strip = (pokemon: InPlayPokemon, target: PokemonTarget): InPlayPokemon => {
    const taken: string[] = [];
    const kept = pokemon.energy.filter((uid) => {
      if (!picks.has(uid)) return true;
      taken.push(uid);
      return false;
    });
    if (taken.length === 0) return pokemon;
    pulled.push({ target, host: topUid(pokemon) ?? "", uids: taken, body: pokemon });
    return { ...pokemon, energy: kept };
  };
  const active = side.active === null ? null : strip(side.active, { spot: "active" });
  const bench = side.bench.map((pokemon, index) => strip(pokemon, { spot: "bench", index }));
  if (pulled.length === 0) return { state, discarded: [] }; // nothing was actually attached
  const discarded: string[] = [];
  for (const entry of pulled) {
    discarded.push(...entry.uids);
    events.push({
      type: "ENERGY_DISCARDED",
      seat: victim,
      actor: ctx.seat,
      uids: [...entry.uids],
      from: { ...entry.target },
      host: entry.host,
      // Omitted for the discard pile so the absent case stays `{}`.
      ...(toHand ? { to: "hand" as const } : toDeck ? { to: "deck" as const } : {}),
    });
  }
  const result = {
    state: withSide(state, victim, {
      ...side,
      active,
      bench,
      // Exactly one zone key is written, so a uid never sits in two zones. The deck is appended to;
      // position is irrelevant under the trailing shuffle.
      ...(toHand
        ? { hand: [...side.hand, ...discarded] }
        : toDeck
          ? { deck: [...side.deck, ...discarded] }
          : { discard: [...side.discard, ...discarded] }),
    }),
    discarded,
  };
  // Boomerang Energy (§6.1): a flagged card this attack's program discards off the attacker itself
  // is recorded on the queued `attackEpilogue`, which re-attaches it after the attack. Discards to
  // hand or deck, non-attack discards, and discards from other bodies do not count.
  const boomerang =
    toHand || toDeck || ctx.invokedBy !== "attack" || ctx.sourceUid === undefined
      ? []
      : pulled
          .filter((entry) => entry.host === ctx.sourceUid)
          // The pre-strip attacker answers Nitro Fire's {R} gate.
          .flatMap((entry) =>
            entry.uids.filter((uid) => returnsAfterAttackDiscard(state, uid, entry.body)),
          );
  return { ...result, state: recordBoomerang(result.state, ctx.sourceUid, boomerang) };
}

/**
 * Append `uids` to the attacker's queued `attackEpilogue` (Boomerang Energy). That stage is queued
 * before the attack's program runs; with none queued, nothing returns.
 */
function recordBoomerang(
  state: GameState,
  attackerUid: string | undefined,
  uids: readonly string[],
): GameState {
  if (uids.length === 0) return state;
  const at = state.pending.findIndex(
    (stage) => stage.kind === "attackEpilogue" && stage.uid === attackerUid,
  );
  const stage = state.pending[at];
  if (stage === undefined || stage.kind !== "attackEpilogue") return state;
  const carried: PendingStage = { ...stage, boomerang: [...(stage.boomerang ?? []), ...uids] };
  return {
    ...state,
    pending: state.pending.map((queued, index) => (index === at ? carried : queued)),
  };
}

/**
 * Strip the picked Pokémon Tools and put each in its owner's discard pile (§7.4). `host` is
 * captured off the pre-strip stack since the body may be Knocked Out in the same batch. One event
 * row per host, never emitted for an empty `uids`.
 */
function toolDiscardApply(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; discarded: string[] } {
  if (uids.length === 0) return { state, discarded: [] };
  // Tool Scrapper ("yours or your opponent's") can pick Tools off both boards, so each seat is
  // stripped in turn (controller's first) and each Tool lands in its owner's pile.
  const picks = new Set(uids);
  let next = state;
  const discarded: string[] = [];
  for (const victim of [ctx.seat, otherSeat(ctx.seat)] as const) {
    const side = next.players[victim];
    const pulled: { host: string; uids: string[] }[] = [];
    const strip = (pokemon: InPlayPokemon): InPlayPokemon => {
      const taken: string[] = [];
      const kept = pokemon.tools.filter((uid) => {
        if (!picks.has(uid)) return true;
        taken.push(uid);
        return false;
      });
      if (taken.length === 0) return pokemon;
      pulled.push({ host: topUid(pokemon) ?? "", uids: taken });
      return { ...pokemon, tools: kept };
    };
    const active = side.active === null ? null : strip(side.active);
    const bench = side.bench.map(strip);
    if (pulled.length === 0) continue;
    const fromThisSide: string[] = [];
    for (const entry of pulled) {
      fromThisSide.push(...entry.uids);
      events.push({
        type: "TOOLS_DISCARDED",
        // Each row names its victim's seat (the host's owner).
        seat: victim,
        actor: ctx.seat,
        uids: [...entry.uids],
        host: entry.host,
        // This runs at the program tail after damage, so the log must not say "before doing
        // damage".
        when: "effect",
      });
    }
    discarded.push(...fromThisSide);
    next = withSide(next, victim, {
      ...side,
      active,
      bench,
      discard: [...side.discard, ...fromThisSide],
    });
  }
  return { state: discarded.length === 0 ? state : next, discarded };
}

/**
 * The `discardTools` prompt string, reproducing the printed sentence. The number is the printed
 * ceiling, not the board-clamped one; the clamp lives on `scope.max`.
 */
function toolDiscardNote(op: OpOf<"discardTools">): string {
  // Tool Scrapper's printed sentence when the offer spans both boards. `"all"` never parks; the
  // branch exists for totality.
  const count = op.count === "all" ? "all" : `up to ${op.count}`;
  if (op.sides === "both") {
    return `Choose ${count} Pokémon Tools attached to Pokémon (yours or your opponent's) and discard them.`;
  }
  return `Discard ${count} Pokémon Tools from your opponent's Pokémon.`;
}

// ── Candidate builders + small shared helpers ──

/** The in-play Energy on `seat`'s board that `filter` admits, each paired with
    the Pokémon it currently sits on — Active first, then bench in index order.
    `activeOnly` keeps just the Active (the discardEnergy `opponentActive` arm).
    Shared by the two Energy-picking ops: moveEnergy's movable set (the
    controller's own board) and discardEnergy's discardable set — the opponent's
    board for the hammer arms, the controller's OWN Active for `yourActive`. */
function attachedEnergies(
  state: GameState,
  seat: Seat,
  filter: CardFilter,
  scope: "all" | "active" | "bench" = "all",
): { uid: string; from: PokemonRef }[] {
  const side = state.players[seat];
  const out: { uid: string; from: PokemonRef }[] = [];
  const collect = (pokemon: InPlayPokemon, from: PokemonRef) => {
    for (const uid of pokemon.energy) {
      if (matchesAttached(state, pokemon, uid, filter)) out.push({ uid, from });
    }
  };
  if (side.active !== null && scope !== "bench") {
    collect(side.active, { seat, spot: { spot: "active" } });
  }
  if (scope === "active") return out;
  side.bench.forEach((pokemon, index) =>
    collect(pokemon, { seat, spot: { spot: "bench", index } }),
  );
  return out;
}

/** Does the Energy `uid`, ATTACHED TO `pokemon`, match `filter`? The in-play
    counterpart of `matchesFilter`, and the only place `providesEnergy` can be
    answered: what an Energy provides is a property of the card ON ITS HOST (§6.3
    — Luminous provides every type alone and only {C} beside another Special
    Energy), so the card alone cannot decide it. Every other filter kind is a
    pure card predicate and defers to `matchesFilter` unchanged. */
function matchesAttached(
  state: GameState,
  pokemon: InPlayPokemon,
  uid: string,
  filter: CardFilter,
): boolean {
  if (filter.kind === "providesEnergy") {
    return providesEnergyType(state, pokemon, uid, filter.energyType);
  }
  return matchesFilter(cardOf(state, uid), filter);
}

/**
 * The board a `discardEnergy` op takes Energy off: the controller's for the own-board scopes, the
 * opponent's for the hammer arms. One helper so the candidate scan, the apply and the §11
 * attack-block guard agree.
 */
function discardVictimSeat(seat: Seat, op: OpOf<"discardEnergy">): Seat {
  return op.from === "yourActive" ||
    op.from === "yours" ||
    op.from === "yourBench" ||
    op.from === "self"
    ? seat
    : otherSeat(seat);
}

/**
 * The Energy a `discardEnergy` op may take, in board order: the `…Active` arms see only that
 * Active, `self` sees the one body the program is printed on, the rest the whole victim board.
 * `sourceUid` is a parameter because `programPlayable` has no context; an absent uid makes `self`
 * whiff rather than strip the Active.
 */
export function discardableEnergies(
  state: GameState,
  seat: Seat,
  op: OpOf<"discardEnergy">,
  sourceUid?: string,
): { uid: string; from: PokemonRef }[] {
  if (op.from === "self") {
    // At most one ref comes back (a top-card uid sits in exactly one spot), and
    // EMPTY is a live answer — no source, or a host that has been evolved over,
    // bounced or Knocked Out. Filtered through `matchesAttached`, like every
    // other arm, so `providesEnergy` keeps reading the card ON ITS HOST (§6.3).
    const [ref] = sourceRef(state, { seat, sourceUid });
    if (ref === undefined) return [];
    const side = state.players[seat];
    const host = bodyAt(side, ref.spot);
    if (host === undefined) return [];
    return host.energy
      .filter((uid) => matchesAttached(state, host, uid, op.filter))
      .map((uid) => ({ uid, from: ref }));
  }
  // `"attacker"`: the one opponent body `sourceUid` names, wherever it sits. Empty when no uid was
  // given or it left the board.
  if (op.from === "attacker") {
    if (sourceUid === undefined) return [];
    return attachedEnergies(state, discardVictimSeat(seat, op), op.filter).filter((entry) => {
      const host = refPokemon(state, entry.from);
      return host !== undefined && topUid(host) === sourceUid;
    });
  }
  // "From your Benched Pokémon" is the own side minus the Active; reading it as `"all"` would offer
  // the Energy that paid for the attack.
  const activeOnly = op.from === "opponentActive" || op.from === "yourActive";
  const benchOnly = op.from === "yourBench";
  const offered = attachedEnergies(
    state,
    discardVictimSeat(seat, op),
    op.filter,
    activeOnly ? "active" : benchOnly ? "bench" : "all",
  );
  // Ruffian's picked body: `bodyUid` keeps only the Energy on the body whose top uid it names.
  const narrowTo = op.from === "opponentChosen" ? op.bodyUid : undefined;
  if (narrowTo === undefined) return offered;
  return offered.filter((entry) => {
    const host = refPokemon(state, entry.from);
    return host !== undefined && topUid(host) === narrowTo;
  });
}

/**
 * `discardEnergy.reserve` (Lugia "Elemental Blast"): of the typed picks, keep those whose removal
 * leaves the most of `reserve` matchable (one Energy per type) by the rest of the scope's Energy.
 * With no full matching, keep the picks that lose the least.
 */
function reservedDiscards(
  state: GameState,
  seat: Seat,
  from: Exclude<OpOf<"discardEnergy">["from"], "opponentEach">,
  offered: readonly { uid: string; from: PokemonRef }[],
  reserve: readonly BasicEnergyType[],
): { uid: string; from: PokemonRef }[] {
  const pool = discardableEnergies(state, seat, {
    op: "discardEnergy",
    from,
    filter: { kind: "anyEnergy" },
  });
  const provides = (
    entry: { uid: string; from: PokemonRef },
    energyType: BasicEnergyType,
  ): boolean => {
    const host = refPokemon(state, entry.from);
    return (
      host !== undefined &&
      matchesAttached(state, host, entry.uid, { kind: "providesEnergy", energyType })
    );
  };
  // The largest number of `types` one-to-one matchable by `rest` (a tiny exhaustive search: <= 2 types).
  const matched = (
    types: readonly BasicEnergyType[],
    rest: readonly { uid: string; from: PokemonRef }[],
  ): number => {
    const [head, ...tail] = types;
    if (head === undefined) return 0;
    let best = matched(tail, rest);
    rest.forEach((entry, index) => {
      if (!provides(entry, head)) return;
      best = Math.max(
        best,
        1 +
          matched(
            tail,
            rest.filter((_, other) => other !== index),
          ),
      );
    });
    return best;
  };
  const scored = offered.map((entry) => ({
    entry,
    score: matched(
      reserve,
      pool.filter((other) => other.uid !== entry.uid),
    ),
  }));
  const top = Math.max(...scored.map((s) => s.score));
  return scored.filter((s) => s.score === top).map((s) => s.entry);
}

/**
 * The interchangeability key for mandatory discards. A Basic Energy is keyed by the type it
 * provides, since the catalog prints identical Basic Energy under several ids. Everything else keys
 * on catalog id; the `basic:`/`card:` prefixes keep the two spaces apart. A uid with no catalog
 * card gets its own key, so the engine asks rather than guesses.
 */
function cardIdentity(state: GameState, uid: string): string {
  const card = cardOf(state, uid);
  if (card === undefined) return `?${uid}`;
  return isBasicEnergy(card) ? `basic:${energyProvidesOf(card)}` : `card:${card.id}`;
}

/**
 * Discardable Energy with interchangeable candidates (same Energy on the same Pokémon) collapsed to
 * at most `cap` representatives each, board order preserved. The host is part of the key because
 * which Pokémon loses the Energy is always a real choice. Keeping `cap` copies lets an exact-N
 * discard still be answered; collapsing here lets a single-class board resolve without a prompt.
 */
function interchangeableCandidates(
  state: GameState,
  discardable: readonly { uid: string; from: PokemonRef }[],
  cap: number,
): { uid: string; from: PokemonRef }[] {
  const kept = new Map<string, number>();
  const out: { uid: string; from: PokemonRef }[] = [];
  for (const candidate of discardable) {
    const key = `${refKeyOf(candidate.from)}|${cardIdentity(state, candidate.uid)}`;
    const already = kept.get(key) ?? 0;
    if (already >= cap) continue;
    kept.set(key, already + 1);
    out.push(candidate);
  }
  return out;
}

/**
 * Every Pokémon Tool on the opponent's board in board order, paired with its host. Separate from
 * `discardableEnergies` because Tools live in `tools`, not `energy`. No `CardFilter` parameter: the
 * printed sentence names Tools without narrowing.
 */
export function discardableTools(
  state: GameState,
  seat: Seat,
  // Tool Scrapper's "yours or your opponent's" also reads the controller's side; absent means the
  // opponent's side alone.
  sides?: "both",
  /**
   * Ruffian's picked body: only the Tools on the body whose top uid this is. Absent means every
   * body on the named sides.
   */
  bodyUid?: string,
): { uid: string; from: PokemonRef }[] {
  const out: { uid: string; from: PokemonRef }[] = [];
  const victims: readonly Seat[] = sides === "both" ? [seat, otherSeat(seat)] : [otherSeat(seat)];
  for (const victim of victims) {
    const side = state.players[victim];
    const collect = (pokemon: InPlayPokemon, from: PokemonRef) => {
      if (bodyUid !== undefined && topUid(pokemon) !== bodyUid) return;
      for (const uid of pokemon.tools) out.push({ uid, from });
    };
    if (side.active !== null) collect(side.active, { seat: victim, spot: { spot: "active" } });
    side.bench.forEach((pokemon, index) =>
      collect(pokemon, { seat: victim, spot: { spot: "bench", index } }),
    );
  }
  return out;
}

/**
 * The picks a discardEnergy makes with no choice left, or null when the player must decide. Runs
 * over the collapsed candidates. "total": the offer holds no more than the count, so everything
 * comes off. "each": every affected Pokémon has exactly one.
 */
function forcedDiscards(
  discardable: readonly { uid: string; from: PokemonRef }[],
  scope: DiscardScope,
): string[] | null {
  if (scope.kind === "total") {
    return discardable.length <= scope.count ? discardable.map((d) => d.uid) : null;
  }
  const perSource = new Map<string, string[]>();
  for (const { uid, from } of discardable) {
    const key = refKeyOf(from);
    const bucket = perSource.get(key);
    if (bucket === undefined) perSource.set(key, [uid]);
    else bucket.push(uid);
  }
  const picks: string[] = [];
  for (const bucket of perSource.values()) {
    const only = bucket[0];
    if (bucket.length !== 1 || only === undefined) return null; // a real choice
    picks.push(only);
  }
  return picks;
}

/** A stable key for grouping and de-duping refs. */
export function refKeyOf(ref: PokemonRef): string {
  return `${ref.seat}:${ref.spot.spot}:${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
}

/**
 * How many Energy a `moveEnergy` op may move on this board: the printed number, or the whole
 * movable set for "any amount". Shared by the play gate and the park so they agree on `max`, and
 * keeps the prompt's `max` a number.
 */
function moveCap(op: OpOf<"moveEnergy">, movable: number): number {
  // `"all"` clamps like `"any"`; they differ only in the floor. Tested by membership over the
  // literal words so a new quantifier cannot fall onto the numeric side.
  return op.max === "any" || op.max === "all" ? movable : op.max;
}

/**
 * How few Energy a `moveEnergy` answer may carry: 0, or the whole cap for Castform's "Move all
 * Energy". Only the park asks the floor; the play gate deliberately does not.
 */
function moveFloor(op: OpOf<"moveEnergy">, cap: number): number {
  return op.max === "all" ? cap : 0;
}

/**
 * Whose board a `moveEnergy` op acts on: the controller's, or the other seat's for `side:
 * "opponent"`. Shared by the park, the play gate and the apply so they agree. Controller-relative
 * like every seat field in this vocabulary.
 */
function moveBoardSeat(op: OpOf<"moveEnergy">, seat: Seat): Seat {
  // Spelled off the absent key on purpose: a record with no `side` means the controller's own
  // board.
  return op.side === undefined ? seat : otherSeat(seat);
}

/**
 * A moveEnergy op does something iff the board has at least one admitted Energy and a valid
 * distinct destination. Exported for `programPlayable`. `sourceUid` is threaded because two routes
 * resolve endpoints from "this Pokémon"; without it the gate refuses.
 */
export function moveEnergyPlayable(
  state: GameState,
  seat: Seat,
  op: OpOf<"moveEnergy">,
  sourceUid?: string,
): boolean {
  // Asks about the op's board, not the controller's. It deliberately does not consult the §11
  // shield, since `unshieldedRefs` emits events and a playability check must not, so this can
  // report playable when every candidate is shielded.
  const board = moveBoardSeat(op, seat);
  const { movable, destinations, needed } = moveEndpoints(state, board, op, sourceUid);
  return moveCap(op, movable.length) > 0 && movable.length > 0 && destinations.length >= needed;
}

/**
 * What a `moveEnergy` op can take, where it can put it, and how many destinations the route needs;
 * shared by the op's no-op test and the play gate. The free route needs two Pokémon since a Pokémon
 * cannot move Energy onto itself; `benchToActive`, `koedActiveToToolHolder` (Exp. Share) and
 * `selfToBench` have disjoint endpoints so one destination is enough. `selfToBench`'s source is the
 * Active, since only the Active attacks. `seat` is the board the op acts on; the uid-anchored
 * routes whiff on the opponent's board. The §11 shield is filtered in `stepOp`, not here.
 */
function moveEndpoints(
  state: GameState,
  seat: Seat,
  op: OpOf<"moveEnergy">,
  sourceUid?: string,
): { movable: { uid: string; from: PokemonRef }[]; destinations: PokemonRef[]; needed: number } {
  const benchToActive = op.route === "benchToActive";
  const toToolHolder = op.route === "koedActiveToToolHolder";
  const selfToBench = op.route === "selfToBench";
  const active = state.players[seat].active;
  if (op.route === "othersToSelf") {
    // "From your other Pokémon to this Pokémon", resolved by uid on the current board. On printed
    // boards this equals `benchToActive` because a switch gate runs first; it differs only when
    // used from the Bench.
    const [dest] = sourceRef(state, { seat, sourceUid });
    if (dest === undefined) return { movable: [], destinations: [], needed: 1 };
    // "OTHER" is the source exclusion, and it is taken HERE rather than left to
    // `moveEnergyApply`'s never-strip-the-destination rule: that rule keeps the
    // APPLY honest, this keeps the OFFER honest, and a prompt that lists Energy
    // the answer can never move is a dead row in both dialogs.
    return {
      movable: attachedEnergies(state, seat, op.filter, "all").filter(
        (entry) => refKeyOf(entry.from) !== refKeyOf(dest),
      ),
      destinations: [dest],
      needed: 1,
    };
  }
  if (selfToBench) {
    return {
      movable: attachedEnergies(state, seat, op.filter, "active"),
      destinations: state.players[seat].bench.map((_, index) => ({
        seat,
        spot: { spot: "bench", index },
      })),
      needed: 1,
    };
  }
  if (toToolHolder) {
    const holder = sourceUid === undefined ? undefined : toolHolderRef(state, seat, sourceUid);
    return {
      movable: attachedEnergies(state, seat, op.filter, "active"),
      // No "holder must not be the source" check: `koToolTriggersOf` skips the Knocked Out body and
      // `validateChoice` refuses self-moves.
      destinations: holder === undefined ? [] : [holder],
      needed: 1,
    };
  }
  return {
    movable: attachedEnergies(state, seat, op.filter, benchToActive ? "bench" : "all"),
    destinations: benchToActive
      ? active === null
        ? []
        : [{ seat, spot: { spot: "active" } }]
      : ownInPlayRefs(state, seat),
    needed: benchToActive ? 1 : 2,
  };
}

/**
 * The in-play Pokémon on `seat`'s board carrying the Tool `toolUid` ("the Pokémon this card is
 * attached to"). Not `sourceRef`, which matches top-card uids and would never find a Tool.
 */
function toolHolderRef(state: GameState, seat: Seat, toolUid: string): PokemonRef | undefined {
  const side = state.players[seat];
  if (side.active?.tools.includes(toolUid) === true) {
    return { seat, spot: { spot: "active" } };
  }
  const index = side.bench.findIndex((pokemon) => pokemon.tools.includes(toolUid));
  return index === -1 ? undefined : { seat, spot: { spot: "bench", index } };
}

/**
 * A discardEnergy op does something iff its scope holds at least one admitted Energy. Exported for
 * `programPlayable` so a play that could only whiff is refused (§7.2); coin-flip gates are refused
 * only when neither arm can act. For `self` this is a cost gate: an Ability whose discard cost
 * cannot be paid must not run, and an absent uid answers `false`.
 */
export function discardEnergyPlayable(
  state: GameState,
  seat: Seat,
  op: OpOf<"discardEnergy">,
  sourceUid?: string,
): boolean {
  // A `to: "hand"` move wholly blocked by the Milotic lock can only whiff, so the play is refused.
  // The seat is the victim's.
  if (op.to === "hand" && inPlayToHandBlocked(state, discardVictimSeat(seat, op))) return false;
  return discardableEnergies(state, seat, op, sourceUid).length > 0;
}

function ownBenchRefs(state: GameState, seat: Seat): PokemonRef[] {
  return state.players[seat].bench.map((_, index) => ({ seat, spot: { spot: "bench", index } }));
}

function oppBenchRefs(state: GameState, seat: Seat): PokemonRef[] {
  const opp = otherSeat(seat);
  return state.players[opp].bench.map((_, index) => ({
    seat: opp,
    spot: { spot: "bench", index },
  }));
}

/** The opponent's Active (if any) PLUS their whole Bench — the candidate set for an
    `opponentAny` snipe (Fezandipiti ex "Cruel Arrow", 1 of ALL the opponent's
    Pokémon). The Active leads so a forced single-candidate board reads naturally. */
function oppAnyRefs(state: GameState, seat: Seat): PokemonRef[] {
  const opp = otherSeat(seat);
  const refs: PokemonRef[] = [];
  if (state.players[opp].active !== null) refs.push({ seat: opp, spot: { spot: "active" } });
  refs.push(...oppBenchRefs(state, seat));
  return refs;
}

/**
 * The one funnel for a snipe's candidate set, exported so `programPlayable` refuses on exactly the
 * set `stepOp` offers. The printed `damagedOnly` narrowing is applied here: a filtered set can be
 * empty (silent no-op), a set of one is forced, and the §11 shield is asked only of bodies that
 * survive the narrowing. It applies to whichever scope `target` names.
 */
export function snipeTargets(state: GameState, seat: Seat, op: OpOf<"damageChosen">): PokemonRef[] {
  // A total `switch` so a new target member fails to compile instead of falling into an else
  // branch.
  const scope = ((): PokemonRef[] => {
    switch (op.target) {
      case "opponentAny":
        return oppAnyRefs(state, seat);
      case "opponentBench":
        return oppBenchRefs(state, seat);
      // The attacker's own Bench; `seat` is the attacker's on every attack program.
      case "yourBench":
        return ownBenchRefs(state, seat);
      // The attacker's whole own side, Active first; the order matters because `placeSnipe` hits
      // refs in order.
      case "yourAny":
        return ownInPlayRefs(state, seat);
    }
  })();
  // The printed candidate class, applied at the same seam as `damagedOnly` for the same reasons; it
  // reads the top card. The two narrowings are never co-printed but compose anyway.
  const narrowing = op.filter;
  const classed =
    narrowing === undefined
      ? scope
      : scope.filter((ref) => {
          const pokemon = refPokemon(state, ref);
          // A ref with no body or unreadable in-play card is dropped rather than admitted.
          return pokemon !== undefined && matchesFilter(inPlayCardOf(state, pokemon), narrowing);
        });
  // Bone Sniper: a candidate must hold a Special Energy. A ref with no body is dropped.
  if (op.specialEnergyOnly === true) {
    return classed.filter((ref) => {
      const pokemon = refPokemon(state, ref);
      return pokemon !== undefined && hasAttachedEnergy(state, pokemon, "special");
    });
  }
  if (op.damagedOnly !== true) return classed;
  // A ref that resolves to no body is DROPPED rather than admitted — the narrowed
  // sentence must not offer a body it cannot read (`knockOutChosenTargets`' rule
  // one funnel over, and the same `refPokemon` behind it).
  return classed.filter((ref) => {
    const pokemon = refPokemon(state, ref);
    return pokemon !== undefined && hasAnyDamageCounters(pokemon);
  });
}

/** Every in-play Pokémon the controller could heal — Active first, then bench. */
function ownInPlayRefs(state: GameState, seat: Seat): PokemonRef[] {
  const refs: PokemonRef[] = [];
  if (state.players[seat].active !== null) refs.push({ seat, spot: { spot: "active" } });
  for (let index = 0; index < state.players[seat].bench.length; index++) {
    refs.push({ seat, spot: { spot: "bench", index } });
  }
  return refs;
}

function benchSpace(state: GameState, seat: Seat): number {
  // The live Bench limit (e.g. Area Zero Underdepths with a Tera Pokémon in play), never below
  // zero.
  return Math.max(0, benchLimitOf(state, seat) - state.players[seat].bench.length);
}

// Delegates to `cardOfUid` so an in-play Antique Fossil reads as its Pokémon face.
function cardOf(state: GameState, uid: string): Card | undefined {
  return cardOfUid(state, uid);
}

/**
 * The chooseCards note for a deck search: "Search your deck for [up to N] {noun} [onto your Bench |
 * into your hand]", with nouns from the shared `retrieveNoun` table.
 *
 * `searchDeck.max`'s union, named once off the op.
 */
type SearchDeckMax = OpOf<"searchDeck">["max"];

/**
 * The disjunctive search (Brock's Scouting: "up to 2 Basic Pokémon or 1 Evolution Pokémon"): one
 * park over the union whose `max` is the larger alternative, never the sum, and whose `capsAnyOf`
 * lets `validateChoice` admit an answer only when one alternative takes all of it. No candidates or
 * no room files the empty record and parks nothing.
 */
function searchDeckOrElse(
  state: GameState,
  op: OpOf<"searchDeck">,
  alternative: { filter: CardFilter; max: number },
  ctx: EffectContext,
  record: EffectRecord,
): { done: GameState } | { park: EffectPrompt } {
  const deck = state.players[ctx.seat].deck;
  const matching = (filter: CardFilter) =>
    deck.filter((uid) => {
      const card = cardOf(state, uid);
      // A Bench destination asks `benchMatches`.
      return (
        card !== undefined &&
        (op.dest === "bench" ? benchMatches(card, filter) : matchesFilter(card, filter))
      );
    });
  const firstMatches = matching(op.filter);
  const firstMax =
    typeof op.max === "number"
      ? op.max
      : op.max === "any"
        ? firstMatches.length
        : state.players[ctx.seat].bench.length;
  const entries = [
    { uids: firstMatches, max: firstMax },
    { uids: matching(alternative.filter), max: alternative.max },
  ];
  const offered = new Set(entries.flatMap((entry) => entry.uids));
  const candidates = deck.filter((uid) => offered.has(uid));
  const ceiling = Math.max(firstMax, alternative.max);
  const max = op.dest === "bench" ? Math.min(ceiling, benchSpace(state, ctx.seat)) : ceiling;
  if (candidates.length === 0 || max <= 0) {
    recordMoved(record, op.recordAs, []);
    return { done: state };
  }
  return {
    park: {
      kind: "chooseCards",
      candidates,
      min: 0,
      max,
      dest: op.dest === "attachToSelf" ? "attach" : op.dest,
      capsAnyOf: entries,
      note: searchOrElseNote(op.filter, firstMax, alternative, op.dest),
    },
  };
}

/**
 * `searchDeckOrElse`'s caption, keeping the printed "or". Both nouns use the plural column with the
 * printed digit.
 */
function searchOrElseNote(
  filter: CardFilter,
  max: number,
  alternative: { filter: CardFilter; max: number },
  dest: OpOf<"searchDeck">["dest"],
): string {
  return `Search your deck for up to ${max} ${retrieveNoun(filter).plural} or ${alternative.max} ${
    retrieveNoun(alternative.filter).plural
  } ${SEARCH_OR_ELSE_PLACE[dest]}.`;
}

/** `searchOrElseNote`'s place phrase, keyed as a total record on `dest`. */
const SEARCH_OR_ELSE_PLACE: Record<OpOf<"searchDeck">["dest"], string> = {
  bench: "onto your Bench",
  hand: "into your hand",
  deckTop: "on top of your deck",
  discard: "and discard them",
  attachToSelf: "and attach it to this Pokémon",
};

function searchNote(
  /**
   * The printed group maxes, not the resolved ones, so a quantifier with no digit ("any number",
   * "up to the number of your Benched Pokémon") is captioned in the card's words. The clamped total
   * is a separate parameter.
   */
  groups: readonly { filter: CardFilter; max: SearchDeckMax }[],
  dest: "bench" | "hand" | "deckTop" | "discard" | "attachToSelf",
  max: number,
  /**
   * The op's `exact`: the caption drops "up to" so it matches a Confirm button that refuses fewer.
   */
  exact = false,
  /**
   * The op's `distinctEnergyTypes`: the caption carries "of different types" so the player can see
   * why a duplicate type is refused.
   */
  distinctEnergyTypes = false,
  /**
   * The op's `typedAsAttachedBasicEnergy`: the caption quotes the printed rule, not the resolved
   * types. Plural noun only.
   */
  typedAsAttachedBasicEnergy = false,
  /**
   * The op's `sameNameAsOpponentInPlay` (Love Ball), on the singular noun; the caption quotes the
   * rule.
   */
  sameNameAsOpponentInPlay = false,
): string {
  const where =
    dest === "bench"
      ? "onto your Bench"
      : // Prints "your deck" rather than the card's "it", since a heading has no antecedent.
        dest === "deckTop"
        ? "on top of your deck"
        : // Brilliant Blender
          dest === "discard"
          ? "and discard them"
          : // Impromptu Carrier
            dest === "attachToSelf"
            ? "and attach it to this Pokémon"
            : "into your hand";
  // Reads the clamped `max`, so a bench search cut by `benchSpace` captions the number the dialog
  // accepts.
  const first = groups[0];
  if (first === undefined) return `Search your deck ${where}.`;
  if (groups.length === 1) {
    const { singular: printedSingular, plural: printedPlural } = retrieveNoun(first.filter);
    const singular = sameNameAsOpponentInPlay
      ? `${printedSingular} with the same name as 1 of your opponent's Pokémon in play`
      : printedSingular;
    // "That are the same type as any Basic Energy attached to this Pokémon", on the plural noun
    // only, using the printed group's noun rather than the resolved types.
    const plural = typedAsAttachedBasicEnergy
      ? `${printedPlural} that are the same type as any Basic Energy attached to this Pokémon`
      : printedPlural;
    // "Of different types" rides only the plural noun: the constraint is vacuous for a one-card
    // take.
    const many = distinctEnergyTypes ? `${plural} of different types` : plural;
    // Printed quantifiers with no digit ("any number of", "up to the number of your Benched
    // Pokémon") are captioned in words; printing the clamped number would also leak the hidden deck
    // size.
    if (first.max === "yourBenchCount")
      return `Search your deck for a number of ${many} up to the number of your Benched Pokémon ${where}.`;
    if (first.max === "any") return `Search your deck for any number of ${many} ${where}.`;
    // An exact take drops "up to" and keeps the number.
    if (exact)
      return max > 1
        ? `Search your deck for ${max} ${many} ${where}.`
        : `Search your deck for ${singular} ${where}.`;
    return max > 1
      ? `Search your deck for up to ${max} ${many} ${where}.`
      : `Search your deck for ${singular} ${where}.`;
  }
  // Multiple groups join as a serial list with the printed Oxford comma; two nouns join with a bare
  // "and". Each group keeps its own number; the flat `max` is the sum and is deliberately not used.
  // The quantifier words are spelled for hand-authored registry ops.
  const phrase = (g: { filter: CardFilter; max: SearchDeckMax }) => {
    const { singular, plural } = retrieveNoun(g.filter);
    return g.max === "yourBenchCount"
      ? `a number of ${plural} up to the number of your Benched Pokémon`
      : g.max === "any"
        ? `any number of ${plural}`
        : g.max > 1
          ? `up to ${g.max} ${plural}`
          : singular;
  };
  const parts = groups.map(phrase);
  const last = parts[parts.length - 1] ?? "";
  const head = parts.slice(0, -1);
  const what = head.length === 1 ? `${head[0]} and ${last}` : `${head.join(", ")}, and ${last}`;
  return `Search your deck for ${what} ${where}.`;
}

/**
 * The chooseCards note for a discard-pile retrieval, reproducing the printed verb ("Put" /
 * "Shuffle") and noun. Nouns are spelled per kind so "Pokémon" stays invariant. `excluded`
 * reproduces Superior Energy Retrieval's parenthetical, since the cards just paid are visible in
 * the discard pile but not offered.
 */
function retrieveNote(
  filter: CardFilter,
  dest: "hand" | "deck" | "bench",
  max: number,
  excluded: boolean,
): string {
  const { singular, plural } = retrieveNoun(filter);
  // A Bench destination uses "Put" like the hand; only the deck destination uses "Shuffle".
  const verb = dest === "deck" ? "Shuffle" : "Put";
  const where =
    dest === "hand" ? "into your hand" : dest === "bench" ? "onto your Bench" : "into your deck";
  const note =
    max > 1
      ? `${verb} up to ${max} ${plural} from your discard pile ${where}.`
      : `${verb} ${singular} from your discard pile ${where}.`;
  return excluded
    ? `${note} (You can't choose a card you discarded with the effect of this card.)`
    : note;
}

/**
 * The chooseCards note for a lookAtTopN (Great Ball, Pokégear 3.0): "Look at the top N cards … and
 * put a {noun} into your hand." `also` joins with the printed "and" rather than `anyOf`'s "or",
 * each half keeping its own number. `exact` drops "up to" and nothing else.
 *
 * Whose deck a `reorderTop` is ordering, shared so the park and the apply cannot disagree.
 */
function reorderTopOwner(seat: Seat, op: OpOf<"reorderTop">): Seat {
  return op.side === "opponent" ? otherSeat(seat) : seat;
}

/**
 * Which cards a `reorderTop` is ordering, shared by the park and the apply. Both arms return the
 * window in deck order, so index 0 is nearest the top and one prompt serves both ends. The bottom
 * arm's `Math.max(0, …)` is for symmetry only; `slice` already clamps a negative start.
 */
function reorderWindow(deck: readonly string[], op: OpOf<"reorderTop">): string[] {
  return op.from === "bottom"
    ? deck.slice(Math.max(0, deck.length - Math.max(0, op.n)))
    : deck.slice(0, Math.max(0, op.n));
}

/**
 * The `orderCards` caption, naming whose deck it is. The printed window size is not spelled since a
 * short deck offers fewer cards. The bottom fork (Kofu) says "on the bottom of your deck" rather
 * than "back", since those cards came from the hand. There is no opponent-bottom caption because no
 * card prints it.
 */
function reorderNote(op: OpOf<"reorderTop">): string {
  // One card is not "these cards … in any order": a one-card window parks only when a printed
  // alternative exists (Inkay), so the caption names the two answers. Checked before `side`.
  if (op.n === 1) {
    return op.side === "opponent"
      ? "Look at the top card of your opponent's deck — put it back, or have your opponent shuffle their deck."
      : "Look at the top card of your deck — put it back on top.";
  }
  if (op.side === "opponent") {
    return "Put these cards back on top of your opponent's deck in any order.";
  }
  return op.from === "bottom"
    ? "Put these cards on the bottom of your deck in any order."
    : "Put these cards back on top of your deck in any order.";
}

function lookNote(
  filter: CardFilter,
  n: number,
  max: number | "any",
  dest?: "bench" | "discard",
  also?: { filter: CardFilter; max: number },
  exact = false,
  /** Dusk Ball's "Look at the bottom 7 cards"; absent is the top. */
  from?: "bottom",
  /** Accompanying Flute's "your opponent's deck" / "their Bench". */
  whose?: "opponent",
): string {
  const { singular, plural } = retrieveNoun(filter);
  // The destination is the prompt's, so the caption matches where the answer actually goes.
  const where =
    dest === "bench"
      ? whose === "opponent"
        ? "onto their Bench"
        : "onto your Bench"
      : dest === "discard"
        ? "in the discard pile"
        : "into your hand";
  // `"any"` is captioned as the card's "any number of", never the resolved number. `exact` is per
  // group because it describes only the first group's sentence.
  const phrase = (
    m: number | "any",
    noun: { singular: string; plural: string },
    isExact: boolean,
  ) =>
    m === "any"
      ? `any number of ${noun.plural}`
      : m > 1
        ? `${isExact ? "" : "up to "}${m} ${noun.plural}`
        : noun.singular;
  const first = phrase(max, { singular, plural }, exact);
  const what =
    also === undefined
      ? first
      : `${first} and ${phrase(also.max, retrieveNoun(also.filter), false)}`;
  return `Look at the ${from === "bottom" ? "bottom" : "top"} ${n} cards of ${whose === "opponent" ? "your opponent's" : "your"} deck and put ${what} ${where}.`;
}

/**
 * The attachCards prompt string (Electric Generator, Hydreigon "Tri Howl"), built from the op. "You
 * find there" tells the player the rows are the window, and "in any way you like" signals that
 * several Energy may go on one Pokémon.
 *
 * The printed noun phrase for an attach's eligible targets ("your Benched {L} Pokémon"), built from
 * the same riders as the candidate set so the caption never names a wider set than the rows. Word
 * order follows the print. `basicOnly` and `notIfKO` are deliberately not spelled.
 */
function attachTargetNoun(riders: AttachTargetRiders): string {
  const printedZone = riders.benchOnly === true ? "Benched " : "";
  // The printed "their Pokémon" (Grafaiai): the caption names the opponent's board so it matches
  // the offered rows.
  const zone = riders.whose === "opponent" ? `opponent's ${printedZone}` : printedZone;
  // The banner word goes where the owner prefix does ("your Tera Pokémon"); no printing has both.
  const owner =
    riders.targetBanner === undefined ? ownerNoun(riders.ownerPokemon) : `${riders.targetBanner} `;
  const types = targetTypeNames(riders.targetType);
  // The printed stage word ("1 of your Stage 2 Pokémon", Rosa's Encouragement); no printing pairs
  // it with a type or owner.
  if (riders.stage2Only === true) return `${zone}Stage 2 Pokémon`;
  // No type: the bare noun.
  if (types.length === 0) return `${zone}${owner}Pokémon`;
  // Multiple types repeat the noun as the card does ("your {P} Pokémon and {M} Pokémon").
  return types.map((type) => `${zone}${type} ${owner}Pokémon`).join(" and ");
}

/**
 * The types an attach's target rider names, always as a list. Shared by `attachEnergyTargets` and
 * `attachTargetNoun` so the gate and the caption never disagree.
 */
function targetTypeNames(targetType: string | readonly string[] | undefined): readonly string[] {
  if (targetType === undefined) return [];
  return typeof targetType === "string" ? [targetType] : targetType;
}

/**
 * The printed possessive of an owner-prefixed subgroup (`"Team Rocket"` → `"Team Rocket's "`,
 * absent → `""`). The trailing "'s " is load-bearing: without it the caption names a subgroup no
 * card prints.
 */
function ownerNoun(owner: string | undefined): string {
  return owner === undefined ? "" : `${owner}'s `;
}

/**
 * Narrow a candidate ref list to bodies whose top card is in the printed owner-prefixed subgroup,
 * or return it unchanged when no owner is printed. Uses `matchesFilter`'s `ownerPokemon` arm so
 * deck searches, attach targets and counter moves share one definition.
 */
function subgroupRefs(
  state: GameState,
  refs: PokemonRef[],
  owner: string | undefined,
): PokemonRef[] {
  if (owner === undefined) return refs;
  return refs.filter((ref) =>
    matchesFilter(refTopCard(state, ref), { kind: "ownerPokemon", owner }),
  );
}

/**
 * `activeTop` with its card as the in-play view (`inPlayCardOf`), for the §8.5 sites whose
 * Weakness, Resistance and type-keyed reads take the spot's card.
 */
function activeInPlay(
  state: GameState,
  seat: Seat,
): { active: InPlayPokemon; uid: string; card: Card } | null {
  const spot = activeTop(state, seat);
  if (spot === null) return null;
  return { ...spot, card: inPlayCardOf(state, spot.active) ?? spot.card };
}

/**
 * The in-play view of the top card of the body a ref points at, or undefined when the spot is
 * empty; `matchesFilter` answers false for an undefined card, so an empty spot fails every
 * predicate.
 */
function refTopCard(state: GameState, ref: PokemonRef): Card | undefined {
  const body = refPokemon(state, ref);
  // Every caller asks about a body in play, so a typed filter ("your {G} Pokémon") sees Scovillain
  // ex as both {G} and {R}.
  return body === undefined ? undefined : inPlayCardOf(state, body);
}

function refPokemon(state: GameState, ref: PokemonRef): InPlayPokemon | undefined {
  return pokemonAt(state, ref.seat, ref.spot);
}

/**
 * The two printed narrowings on a `switchActive` candidate set (Pecharunt ex: "1 of your Benched
 * {D} Pokémon, except any Pecharunt ex"). The type check goes through `matchesFilter`'s
 * `typedPokemon` so dual-type bodies match; the name check is exact-case against the top card. Both
 * are conjuncts: the exclusion applies even with no type.
 */
function switchBenchNarrowing(
  state: GameState,
  refs: PokemonRef[],
  op: OpOf<"switchActive">,
): PokemonRef[] {
  if (op.targetType === undefined && op.exceptNamed === undefined) return refs;
  return refs.filter((ref) => {
    const card = refTopCard(state, ref);
    if (card === undefined) return false;
    if (op.exceptNamed !== undefined && card.name === op.exceptNamed) return false;
    return (
      op.targetType === undefined ||
      matchesFilter(card, { kind: "typedPokemon", pokemonType: op.targetType })
    );
  });
}

/**
 * The printed noun for a `switchActive`'s eligible bench targets; it must name exactly the set
 * `switchActiveTargets` offers. An unmarked op reads "Benched Pokémon".
 */
function switchTargetNoun(op: OpOf<"switchActive">): string {
  const type = op.targetType === undefined ? "" : `${op.targetType} `;
  const except = op.exceptNamed === undefined ? "" : `, except any ${op.exceptNamed}`;
  return `Benched ${type}${ownerNoun(op.ownerPokemon)}Pokémon${except}`;
}

function attachNote(op: OpOf<"attachFromTop">): string {
  const { plural } = retrieveNoun(op.filter);
  const how = op.max === "any" ? "any number of" : `up to ${op.max}`;
  const where = attachTargetNoun(op);
  return `Look at the top ${op.n} cards of your deck and attach ${how} ${plural} you find there to your ${where} in any way you like.`;
}

/**
 * The attachCards prompt for a deck search (Charizard ex "Infernal Reign", Janine's Secret Art),
 * built from the op. `toSelf` prints "attach it to this Pokémon". Without `maxPerTarget` the
 * caption says "in any way you like" (several Energy may go on one Pokémon, §15.E); with it, that
 * phrase would contradict the validator, so Janine's "for each of those Pokémon" is used.
 */
function attachFromDeckNote(op: OpOf<"attachFromDeck">): string {
  const { singular, plural } = retrieveNoun(op.filter);
  if (op.toSelf === true) {
    return op.max > 1
      ? `Search your deck for up to ${op.max} ${plural} and attach them to this Pokémon.`
      : `Search your deck for ${singular} and attach it to this Pokémon.`;
  }
  const where = attachTargetNoun(op);
  // Overflowing Wishes' per-body sentence; its shuffle is left to the next op.
  if (op.each === true) {
    return `For each of your ${where}, search your deck for ${singular} and attach it to that Pokémon.`;
  }
  if (op.maxPerTarget !== undefined) {
    // "attach 1 to each", not "attach a Basic Darkness Energy card to each" —
    // the noun is already in the first clause, and repeating it there produced a
    // sentence long enough that the per-target rule stopped being the thing the
    // reader noticed, which is the one thing this branch exists to say.
    const each = op.maxPerTarget === 1 ? "1" : `up to ${op.maxPerTarget}`;
    return `Search your deck for up to ${op.max} ${plural} and attach ${each} to each of up to ${op.max} of your ${where}.`;
  }
  // "attach them to 1 of your Pokémon": "in any way you like" would contradict a validator that
  // refuses a second body. There is no `max === 1` branch because the op omits the rider there.
  if (op.oneTarget === true) {
    return `Search your deck for up to ${op.max} ${plural} and attach them to 1 of your ${where}.`;
  }
  // "of different types" (Prism Charge) rides the plural noun.
  const many = op.distinctEnergyTypes === true ? `${plural} of different types` : plural;
  return op.max > 1
    ? `Search your deck for up to ${op.max} ${many} and attach them to your ${where} in any way you like.`
    : `Search your deck for ${singular} and attach it to your ${where}.`;
}

/** Glass Trumpet's caption: the printed sentence with the brace code written out. */
function attachFromDiscardNote(op: OpOf<"attachFromDiscard">, ceiling: number): string {
  const { singular, plural } = retrieveNoun(op.filter);
  // Tail Generator's printed sentence, with the resolved ceiling.
  if (op.max === "opponentEnergyInPlay") {
    return `Choose up to ${ceiling} ${plural} from your discard pile (the amount of Energy attached to all of your opponent's Pokémon) and attach them to your ${attachTargetNoun(op)} in any way you like.`;
  }
  return `Choose up to ${op.max} of your ${attachTargetNoun(op)} and attach ${singular} from your discard pile to each of them.`;
}

/**
 * Reboot Pod's caption. Any body left without a card is topped up at apply time
 * (`eachAttachTopUp`).
 */
function attachEachFromDiscardNote(op: OpOf<"attachFromDiscard">): string {
  const { singular } = retrieveNoun(op.filter);
  return `Attach ${singular} from your discard pile to each of your ${attachTargetNoun(op)}.`;
}

/**
 * The attachCards prompt for a hand attach (Alolan Exeggutor ex "Tropical Frenzy"). "from your
 * hand" distinguishes it from a deck window, and "in any way you like" signals every card may go on
 * one Pokémon (§15.E). There is no "up to N" because the op carries no `max`; the printed "You may"
 * is dropped because the prompt itself is the offer.
 */
function attachFromHandNote(op: OpOf<"attachFromHand">): string {
  // The printed "to this Pokémon": a single target row cannot convey that the destination is not a
  // choice, and "in any way you like" would describe a split the validator cannot produce.
  if (op.toSelf === true) {
    return `Attach any number of ${retrieveNoun(op.filter).plural} from your hand to this Pokémon.`;
  }
  // Lethargic Charge's singular sentence; `attachTargetNoun` has no Active word, so the zone is
  // spelled here.
  if (op.one === true) {
    return `Attach ${retrieveNoun(op.filter).singular} from your hand to your ${op.activeOnly === true ? "Active " : ""}${ownerNoun(op.ownerPokemon)}Pokémon.`;
  }
  // Pleasing Present's "up to N", addressed to whichever player answers it.
  if (op.max !== undefined) {
    return `Attach up to ${String(op.max)} ${retrieveNoun(op.filter).plural} from your hand to your ${attachTargetNoun({})} in any way you like.`;
  }
  return `Attach any number of ${retrieveNoun(op.filter).plural} from your hand to your ${attachTargetNoun({})} in any way you like.`;
}

/**
 * The moveEnergy prompt (Energy Switch / Poppy): "Move [up to N] {noun} from [1 of] your Pokémon to
 * another of your Pokémon". The "1 of" comes from `anySource`.
 */
function moveNote(op: OpOf<"moveEnergy">): string {
  const noun = energyNoun(op.filter);
  // "1 of" marks single-source coupling: every coupled printing says "from 1 of your …", while N's
  // Plan says "from your Benched Pokémon".
  const one = op.anySource === true ? "" : "1 of ";
  // The opponent-board sentences share no clause with the own-board ones, so they override the
  // chain below rather than joining it.
  let where =
    op.route === "benchToActive"
      ? `from ${one}your Benched Pokémon to your Active Pokémon`
      : op.route === "koedActiveToToolHolder"
        ? // Exp. Share's printed second half; the prompt is the only thing naming this card to the player, since a Tool emits no ABILITY_TRIGGERED row.
          "from that Pokémon to the Pokémon this card is attached to"
        : op.route === "selfToBench"
          ? // The printed second half. This route has one source by construction (the attacker), so the "1 of" sits on the destination; `anyDest` replaces exactly the destination clause, as Kilowattrel's print does.
            op.anyDest === true
            ? "from this Pokémon to your Benched Pokémon in any way you like"
            : "from this Pokémon to 1 of your Benched Pokémon"
          : op.route === "othersToSelf"
            ? // Iron Leaves ex's printed second half; this route is always `anySource`, so `one` is empty.
              `from ${one}your other Pokémon to this Pokémon`
            : // The free route's destination clause: `anyDest` is "to your other Pokémon in any way you like", otherwise Energy Switch's "to another of your Pokémon".
              op.anyDest === true
              ? `from ${one}your Pokémon to your other Pokémon in any way you like`
              : `from ${one}your Pokémon to another of your Pokémon`;
  // Opponent-board sentences. `selfToBench` names its source by the spot, so it takes no article.
  // The printed "You may" is dropped as elsewhere; it is not a claim that `moveFloor` honours
  // declining.
  if (op.side === "opponent") {
    where =
      op.route === "selfToBench"
        ? "from your opponent's Active Pokémon to 1 of their Benched Pokémon"
        : `from ${one}your opponent's Pokémon to another of their Pokémon`;
  }
  // A record-pinned destination: the park carries exactly one destination (the body the search just
  // benched), so the inherited "to 1 of your Benched Pokémon" would promise a choice that is not
  // offered. It wins over the `side` override, which is unreachable here because the record is
  // filed by the controller's own ops.
  if (op.destRecorded !== undefined) where = "from this Pokémon to the new Benched Pokémon";
  // Scramble Switch's printed endpoints.
  if (op.sourceRecorded !== undefined) {
    where = "from the Pokémon you moved to your Bench to the new Active Pokémon";
  }
  // "an Energy", "a Basic Energy", "a Fire Energy" — the article follows the noun,
  // the same rule discardNote applies. Unreachable at max 1 today (the only
  // `anyEnergy` mover is Poppy at max 2, which takes the "up to" branch), which is
  // precisely why it read "Move a Energy" unnoticed.
  const article = noun === "Energy" ? "an" : "a";
  // "any amount" is spelled rather than resolved to the clamp, so the caption does not show a
  // number the card does not print.
  if (op.max === "any") return `Move any amount of ${noun} ${where}.`;
  // Castform's printed "all" is spelled for the same reason; the pick cannot be shortened.
  if (op.max === "all") return `Move all ${noun} ${where}.`;
  return op.max > 1
    ? `Move up to ${op.max} ${noun} ${where}.`
    : `Move ${article} ${noun} ${where}.`;
}

/**
 * How a filter's Energy reads inside a prompt sentence; unspelled filters read "Energy". A typed
 * one reads as its full type name ("a Fire Energy"), not the brace code, so the heading matches the
 * card names the player clicks.
 */
function energyNoun(filter: CardFilter): string {
  if (filter.kind === "specialEnergy") return "Special Energy";
  if (filter.kind === "providesEnergy") return `${filter.energyType} Energy`;
  // `basicEnergy` must read "Basic Energy"; falling through to the wider "Energy" would misdescribe
  // the pick.
  if (filter.kind === "basicEnergy") {
    return filter.energyType === undefined ? "Basic Energy" : `Basic ${filter.energyType} Energy`;
  }
  return "Energy";
}

/** The discardEnergy prompt string — reproduced from the printed sentence, so
    the dialog's heading IS the card's own instruction (Crushing Hammer "…from 1
    of your opponent's Pokémon", Giacomo "…from each of…", Mawile "…from your
    opponent's Active Pokémon", Corviknight "Discard 2 Energy from this Pokémon").
    Only the two filters those cards use are spelled; any other reads as the
    generic "an Energy". `count: "all"` never reaches here — that arm asks
    nothing, so it has no prompt to caption. */
function discardNote(op: OpOf<"discardEnergy">): string {
  const noun = energyNoun(op.filter);
  // A numeric count is printed as the bare number ("Discard 2 Energy…"), one as
  // the article ("Discard an Energy…"), and `"any"` as the printed "any amount
  // of" (Chien-Pao ex "Hail Blade") — or "up to N" when it carries a cap (Mewtwo
  // VSTAR "Psy Purge": "Discard up to 3 Psychic Energy…").
  const what =
    op.count === "any"
      ? op.cap !== undefined
        ? `up to ${op.cap} ${noun}`
        : `any amount of ${noun}`
      : typeof op.count === "number" && op.count > 1
        ? `${op.count} ${noun}`
        : `${noun === "Energy" ? "an" : "a"} ${noun}`;
  // The caption names the destination, because that is the consequence of the pick ("Discard an
  // Energy…" versus "Put an Energy… into their hand").
  const putBack = op.to === "hand";
  // The deck and hand destinations each have their own caption flag, read by the arms that can
  // reach them.
  const shuffleBack = op.to === "deck";
  switch (op.from) {
    case "opponentActive":
      return putBack
        ? `Put ${what} attached to your opponent's Active Pokémon into their hand.`
        : `Discard ${what} from your opponent's Active Pokémon.`;
    case "opponentChosen":
      return putBack
        ? `Put ${what} attached to 1 of your opponent's Pokémon into their hand.`
        : `Discard ${what} from 1 of your opponent's Pokémon.`;
    case "attacker":
      // The printed noun (Shell Spikes, Counterattacking Pincer).
      return `Discard ${what} from the Attacking Pokémon.`;
    case "opponentEach":
      return `Discard ${what} from each of your opponent's Pokémon.`;
    case "yourActive":
      // The printed attack sentence; "this Pokémon" is the Active (§8). The hand and deck arms use
      // the printed verbs ("Put … into your hand", "shuffle … into your deck") so the caption
      // matches where the card goes.
      return putBack
        ? `Put ${what} attached to this Pokémon into your hand.`
        : shuffleBack
          ? `Shuffle ${what} attached to this Pokémon into your deck.`
          : `Discard ${what} from this Pokémon.`;
    case "self":
      // Same printed words for the same subject; the members differ only in how they resolve it (a
      // spot versus a uid). For Super Potion the engine-written `bodyUid` is the healed body, not
      // the card running.
      if (op.bodyUid !== undefined) return `Discard ${what} from that Pokémon.`;
      return `Discard ${what} from this Pokémon.`;
    case "yours":
      // The printed "from your Pokémon" — the whole own board (Hail Blade).
      return `Discard ${what} from your Pokémon.`;
    case "yourBench":
      // The printed "from your Benched Pokémon"; the `what` half already carries the ceiling, and
      // "You may" is dropped.
      return `Discard ${what} from your Benched Pokémon.`;
  }
}

/**
 * The noun phrase (singular / plural) each filter reads as in a retrieval note. Exported within the
 * module so log.ts renders nouns through this switch.
 */
export function retrieveNoun(filter: CardFilter): { singular: string; plural: string } {
  switch (filter.kind) {
    case "anyPokemon":
      // The printed "Pokémon that don't have a Rule Box" (Lana's Aid); the singular uses "doesn't".
      return filter.noRuleBox === true
        ? {
            singular: "a Pokémon that doesn't have a Rule Box",
            plural: "Pokémon that don't have a Rule Box",
          }
        : { singular: "a Pokémon", plural: "Pokémon" };
    case "supporter":
      return { singular: "a Supporter card", plural: "Supporter cards" };
    case "supporterNameContaining":
      // The printed "Supporter card that has "Team Rocket" in its name". The quotation marks are
      // printed; dropping them would read as a whole card name. The plural changes both verb and
      // possessive.
      return {
        singular: `a Supporter card that has "${filter.fragment}" in its name`,
        plural: `Supporter cards that have "${filter.fragment}" in their names`,
      };
    case "toolNameContaining":
      // TM Machine's noun; the plural is the print's "in their name", not "names".
      return {
        singular: `a Pokémon Tool card that has "${filter.fragment}" in its name`,
        plural: `Pokémon Tool cards that have "${filter.fragment}" in their name`,
      };
    case "itemNameContaining":
      // Fossil Quarry's noun ("Item cards that have "Antique" in their name").
      return {
        singular: `an Item card that has "${filter.fragment}" in its name`,
        plural: `Item cards that have "${filter.fragment}" in their name`,
      };
    case "item":
      // "an Item card" / "Item cards": spelled per kind because the article varies.
      return { singular: "an Item card", plural: "Item cards" };
    case "stadium":
      return { singular: "a Stadium card", plural: "Stadium cards" };
    case "trainerCard":
      // This phrase is also the filter's row in effects.ts `HAND_SEARCH_NOUNS`, whose strings must
      // equal this function's output.
      return { singular: "a Trainer card", plural: "Trainer cards" };
    case "anyCard":
      // The uncategorised noun, matching `handCostPhrase` for a filterless cost.
      return { singular: "a card", plural: "cards" };
    case "pokemonOrBasicEnergy":
      return {
        singular: "a Pokémon or Basic Energy card",
        plural: "Pokémon or Basic Energy cards",
      };
    case "anyEnergy":
      return { singular: "an Energy card", plural: "Energy cards" };
    case "pokemonWithResistance":
      // Fletchling "Chirp"'s noun, type written out, invariant in number.
      return {
        singular: `a Pokémon with ${filter.type} Resistance`,
        plural: `Pokémon with ${filter.type} Resistance`,
      };
    case "specialEnergy":
      return { singular: "a Special Energy card", plural: "Special Energy cards" };
    case "byName": {
      // A non-Pokémon name carries "cards" ("up to 2 Arven's Sandwich cards"); a Pokémon name
      // prints bare and invariant ("up to 3 Flamigo"). The singular article is computed from the
      // name ("an Ethan's Adventure card").
      const article = /^[AEIOU]/.test(filter.name) ? "an" : "a";
      return filter.cardNoun === true
        ? { singular: `${article} ${filter.name} card`, plural: `${filter.name} cards` }
        : { singular: filter.name, plural: filter.name };
    }
    case "basicPokemon":
      // The printed HP threshold ("a Basic Pokémon with 70 HP or less"); the number varies per
      // card. The `noRuleBox` and HP riders are tested in sequence because no printing combines
      // them.
      if (filter.maxHp !== undefined && filter.noRuleBox !== true)
        return {
          singular: `a Basic Pokémon with ${filter.maxHp} HP or less`,
          plural: `Basic Pokémon with ${filter.maxHp} HP or less`,
        };
      return filter.noRuleBox === true
        ? {
            singular: "a Basic Pokémon that doesn't have a Rule Box",
            plural: "Basic Pokémon that don't have a Rule Box",
          }
        : { singular: "a Basic Pokémon", plural: "Basic Pokémon" };
    case "evolutionPokemon":
      return { singular: "an Evolution Pokémon", plural: "Evolution Pokémon" };
    case "stagePokemon": {
      // The printed stage ordinal ("a Stage 1 Pokémon"), invariant in number; the article is always "a" because both stages spell "Stage".
      const ordinal = filter.stage === "Stage1" ? "Stage 1" : "Stage 2";
      return { singular: `a ${ordinal} Pokémon`, plural: `${ordinal} Pokémon` };
    }
    case "typedPokemon": {
      // The caption writes the type out instead of the printed brace code, so it matches the card
      // names the player clicks; that is why brace-coded nouns are not in `HAND_SEARCH_NOUNS`. The
      // stage word is the printed one ("Evolution {M} Pokémon"), and the HP threshold rides at the
      // end.
      const noun = `${filter.stage === undefined ? "" : filter.stage === "basic" ? "Basic " : "Evolution "}${filter.pokemonType} Pokémon${filter.maxHp === undefined ? "" : ` with ${filter.maxHp} HP or less`}`;
      // The article is always "a": no Pokémon type begins with a vowel (pinned by
      // `typedPokemonNounsTakeNoVowelArticle`).
      return { singular: `a ${noun}`, plural: noun };
    }
    case "ownerPokemon": {
      // The printed noun phrase, whole: "a Cynthia's Pokémon", "up to 2 Basic
      // Hop's Pokémon", "an Evolution Team Rocket's Pokémon". The stage word sits
      // INSIDE the phrase, before the owner, which is the concrete reason the
      // stage rides on this filter instead of composing with `basicPokemon`:
      // there is no way to build this string out of two independent nouns.
      const noun = `${filter.stage === undefined ? "" : filter.stage === "basic" ? "Basic " : "Evolution "}${filter.owner}'s Pokémon`;
      // "an Ethan's Pokémon" / "an Evolution …" — the printed article (Arven's
      // Pokéblock prints "is an Arven's Pokémon"). With a stage word the article
      // is decided by THAT word, not by the owner: "a Basic Ethan's Pokémon".
      const article = /^[AEIOU]/.test(noun) ? "an" : "a";
      return { singular: `${article} ${noun}`, plural: noun };
    }
    // The printed "Pokémon that has an Ability" (Team Rocket's Arbok); exists because the switch is
    // exhaustive over `CardFilter`.
    case "abilityPokemon":
      return { singular: "a Pokémon that has an Ability", plural: "Pokémon that have an Ability" };
    case "attackNamePokemon":
      // The printed "Pokémon … that has the Round attack", with the attack name interpolated; the
      // phrase always opens with "Pokémon", so the article is "a".
      return {
        singular: `a Pokémon that has the ${filter.attack} attack`,
        plural: `Pokémon that have the ${filter.attack} attack`,
      };
    case "pokemonNameContaining":
      // The printed "Pokémon … that has "Koffing" in its name". The quotation marks are printed;
      // the plural changes verb and possessive; the "or" is joined by the `anyOf` arm. `suffix`
      // rides the head noun as printed ("a Pokémon ex … that has "Ogerpon" in its name").
      if (filter.suffix !== undefined) {
        return {
          singular: `a Pokémon ${filter.suffix} that has "${filter.fragment}" in its name`,
          plural: `Pokémon ${filter.suffix} that have "${filter.fragment}" in their names`,
        };
      }
      return {
        singular: `a Pokémon that has "${filter.fragment}" in its name`,
        plural: `Pokémon that have "${filter.fragment}" in their names`,
      };
    case "megaEvolutionEx":
      // "a Mega Evolution Pokémon ex", invariant in number.
      return { singular: "a Mega Evolution Pokémon ex", plural: "Mega Evolution Pokémon ex" };
    case "bannerPokemon":
      // "a Tera Pokémon", invariant in number.
      return { singular: `a ${filter.banner} Pokémon`, plural: `${filter.banner} Pokémon` };
    case "bannerCard":
      // The article follows the banner's first letter ("an Ancient", "a Future").
      return {
        singular: `${filter.banner === "Ancient" ? "an" : "a"} ${filter.banner} card`,
        plural: `${filter.banner} cards`,
      };
    case "suffixPokemon":
      // The printed rule-box class ("a Pokémon ex"), invariant in number with article "a". The pair
      // "Pokémon ex and Pokémon V" is an `anyOf`, joined by that arm.
      return { singular: `a Pokémon ${filter.suffix}`, plural: `Pokémon ${filter.suffix}` };
    case "toolCard":
      return { singular: "a Pokémon Tool card", plural: "Pokémon Tool cards" };
    case "basicEnergy": {
      const kind = filter.energyType === undefined ? "Basic" : `Basic ${filter.energyType}`;
      return { singular: `a ${kind} Energy card`, plural: `${kind} Energy cards` };
    }
    case "anyOf": {
      // The combinator's caption joins its members' phrases with " or " where cards print "and",
      // deliberately: the predicate is a union, and "and" would read as a conjunction.
      const parts = filter.filters.map((inner) => retrieveNoun(inner));
      return {
        singular: parts.map((p) => p.singular).join(" or "),
        plural: parts.map((p) => p.plural).join(" or "),
      };
    }
    case "providesEnergy":
      // Unreachable through a pile-scanning op (matchesFilter rejects this
      // filter there, so such an op offers nothing to caption). Spelled anyway:
      // the phrase is what the note builders below want, and an exhaustive
      // switch that throws would be a worse answer than a correct sentence.
      return {
        singular: `a ${filter.energyType} Energy`,
        plural: `${filter.energyType} Energy`,
      };
  }
}
