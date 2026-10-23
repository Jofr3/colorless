import type { EffectOp, EffectSlot, PokemonRef } from "./effectTypes";
import type { GameState, Seat } from "./types";

export type { PokemonRef };

// The wire types of a parked effect: the context an op runs under, the prompt it parks on, the
// answer it accepts and the continuation that resumes it. Plain JSON, so a park persists.

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
