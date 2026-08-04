import type { Attack, Card } from "@luminous/schema";
import {
  activeTop,
  applyDamageModifier,
  attacksOf,
  energyProvidesOf,
  evolveFromOf,
  isBasicPokemon,
  isEnergyCard,
  isExOrV,
  matchesFilter,
  pokemonSuffixOf,
  resistanceOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
import {
  attackBlockOf,
  benchShieldedByActive,
  countEnergyInPlay,
  effectiveMaxHp,
  hasAttachedEnergy,
  installedAttackDebuffOf,
  installedReductionOf,
  opposingAttackDebuff,
  passivesOf,
  preventsAttackerType,
  providesEnergyType,
  seatDamageReduction,
  seatRemovesWeakness,
  stadiumPreventsDamage,
} from "./continuous";
import { STATUS_WORD_OF, foldApostrophes } from "./effects";
import type {
  AttachTargetRiders,
  BoardCondition,
  CardFilter,
  EffectOp,
  EffectSlot,
  HandRefreshDraw,
} from "./effects";
import type { GameEvent } from "./events";
// THE one exhaustive switch over `Phase` (phaseView.ts) — `conditionHolds` reads
// the turn OWNER from it rather than re-deriving one by turn parity, which that
// module's header forbids. phaseView.ts imports from here TYPE-ONLY
// (`import type { EffectPrompt }`), so this value import leaves no runtime cycle.
import { phaseViewOf } from "./phaseView";
import { flipCoin, shuffle } from "./rng";
import type {
  AttackBlock,
  GameState,
  InPlayPokemon,
  LockedAttack,
  PlayerSide,
  PokemonTarget,
  Seat,
} from "./types";
import {
  BENCH_MAX,
  DEFAULT_POISON_DAMAGE,
  SEATS,
  drawToHand,
  makeInPlay,
  noConditions,
  otherSeat,
  presentStatuses,
  takenPrizes,
  withActive,
  withSide,
  without,
} from "./types";

// The shared effect interpreter (D8) — the one place a GameState changes under
// an op program, whether the program came from an attack (effects.ts deriver),
// a Trainer, or an Ability (registry.ts). M3's interpreter was attack-private
// and synchronous; M4 needs mid-effect PARKING (search a deck → pick a card;
// gust → pick which benched Pokémon) so this returns a resumable result and
// the whole continuation (`pendingOp` + the rest of the program + context) is
// JSON so it stores in the `effect:choose` phase and replays identically.
//
// The interpreter can PLACE damage (spreadDamage — an attack's spread hit on
// the opponent's Bench) but never KOs or ends the game: the Knock Out check
// stays in the attack epilogue (attack.ts finishAttack), which sweeps the
// whole board through the shared collectKnockOuts (flow.ts) after the program
// runs. So the interpreter still never touches the KO/win tail — it only moves
// damage, and flow.ts owns every Knock Out.

/** The controller of an effect (the seat playing the card). "self" ops target
    this seat's Active, "defender"/gust the opponent's. */
export interface EffectContext {
  seat: Seat;
  /** The top-card uid of the Pokémon whose effect this is — the printed "this
      Pokémon" (Pawmot "Electrogenesis"). Set wherever the runner knows which
      body the program belongs to: an activated Ability's own Pokémon
      (useAbility), a trigger's (runBoardTrigger / runCheckupTriggers /
      runKoTrigger), the attacker (attack.ts). ABSENT for a Trainer program — a
      Trainer has no "this Pokémon", and an op that reads the source whiffs
      without one. Constant for the whole run, like `seat` (the accumulator
      shape lives on `EffectRecord`), and it rides `EffectContinuation` across
      parks: plain JSON, so a parked program still replays identically (D14). */
  sourceUid?: string;
  /** §11/§15.B — WHAT invoked this program, when the answer changes a RULE.
      Set to `"attack"` by attack.ts and by nothing else; ABSENT everywhere else
      (a Trainer, an activated Ability, a trigger, the Checkup), which is why it
      is optional rather than a two-member union with a default: the fact is
      "this is an attack's effect", and its negation needs no spelling.

      ⚠️ THIS REFINES D139's RULE RATHER THAN REVERSING IT, and the distinction is
      worth stating because that decision explicitly declined a context field.
      D139 was choosing where a LOG LABEL for ONE op should live and answered "on
      the op" — `damageActive`/`damageChosen` carry `source: "ability" | "attack"`
      to this day, and they still should, because a label is a property of the row
      that op emits. What rides HERE is a RULE that SEVERAL ops must answer
      IDENTICALLY: "prevent all damage from and effects of ATTACKS done to this
      Pokémon" (D142) asks every defender-relative op the same question, and the
      only site that knows the answer is the one that started the program. Written
      per op it would be one fact in six places with six chances to go stale;
      written here it is stated once by the caller that knows.

      D139's second objection — that `ctx` is serialized into every park — is
      answered by the field being exactly what a park NEEDS: an attack effect that
      parks and resolves three actions later is still an attack's effect, and the
      continuation carries that across the wire for free. An old continuation
      written before this field simply lacks it, which reads as "not an attack" and
      is byte-identical to the pre-slice behaviour.

      It is NOT the same axis as `sourceUid` even though both describe the
      invocation: that one names WHICH BODY the effect belongs to (a target
      question), this one names WHAT KIND OF THING is doing it (a rules question). */
  invokedBy?: "attack";
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
  /** Pick `min`..`max` card uids to move to `dest`. `dest` is display metadata;
      the op owns the actual move, and `note` carries the accurate prompt text.

      `min` is what tells the two consumers (the dialog's Confirm button and
      resolveEffect's wire validator) whether the pick is DECLINABLE, and it is
      required rather than optional so every park site has to say which it is:

        • **`min: 0`** — the printed "up to", every pile-scanning op (searchDeck
          moves deck → bench/hand; discardPileRetrieval moves the discard pile →
          hand/deck; lookAtTopN takes from the deck top). Taking none is a legal
          answer.
        • **`min === max === count`** — a MANDATORY exact pick, the printed hand
          COST (`payFromHand`, dest `"discard"` or `"deck"`): the only decision is
          WHICH cards, never whether, so there is no decline. */
  | {
      kind: "chooseCards";
      candidates: string[];
      min: number;
      max: number;
      /** Where the picked cards are going. `"deck"` is "into the deck", which for
          every op that says it means SHUFFLED in (Pal Pad / Super Rod); the
          bottom of the deck is its own member, because "put it under your deck"
          and "shuffle it into your deck" are different promises to a player and
          the destination is the ENGINE's to state — a client deriving one from
          the other is the guess `min` exists to prevent. */
      dest: "bench" | "hand" | "deck" | "deckBottom" | "discard";
      note: string;
    }
  /** Pick exactly one in-play Pokémon (switchActive / gust / healChosen). */
  | { kind: "choosePokemon"; candidates: PokemonRef[]; note: string }
  /** Pick `min`..`max` in-play Pokémon — the multi-target snipe (damageChosen:
      Hawlucha's "choose 2", Meowscarada ex / Radiant Blastoise's "on 1 of your
      opponent's Benched Pokémon"). Distinct from choosePokemon (exactly one) in
      that the answer is a SET, dispatched in one go.

      The printed number is EXACT unless the card says "up to" (§9.1): the
      snipes all carry `min === max`, and the "up to" print is `min: 0` —
      healChosen's `upTo` arm (Saguaro's "up to 2 of your Pokémon", the range's
      first consumer; Janine's Secret Art looked like the one coming in but its
      pick collapsed into the attachCards map).

      `declinable` is the separate, printed "**you may**", and it is why a floor
      alone cannot describe this prompt: Hawlucha's "you may choose 2" is
      ALL-OR-NOTHING — 2 refs or none, never 1 of 2 — so the legal answers are
      `min..max` PLUS the empty set. It exists only because the framework
      auto-fires optional triggers (triggers.ts): the decline of a "you may" that
      is never asked about anywhere else has to live in the pick it governs. A
      prompt with `min: 0` is declinable by construction and does not set it. */
  | {
      kind: "choosePokemonMulti";
      candidates: PokemonRef[];
      min: number;
      max: number;
      declinable: boolean;
      note: string;
    }
  /** Move up to `max` Energy from ONE source Pokémon (all picks share a source)
      to ONE destination — the compound moveEnergy decision (Energy Switch /
      Poppy). `movable` pairs each takeable Energy uid with the Pokémon it sits
      on (`from`); `destinations` are the eligible destination Pokémon (all the
      controller's own in-play — the source-exclusion is per-pick, validated
      against the chosen source). Declinable (pick none). */
  | {
      kind: "moveEnergy";
      movable: { uid: string; from: PokemonRef }[];
      destinations: PokemonRef[];
      max: number;
      note: string;
    }
  /** Discard Energy off the board — the energy-removal family (Crushing Hammer /
      Giacomo / Mawile), its attack twins (Pincurchin / Dedenne) and the §8
      self-discard attack cost (Houndoom / Corviknight / Koraidon). `discardable`
      pairs each takeable Energy uid with the Pokémon it sits on — the opponent's,
      or the controller's own Active for the self-discard arm; `scope` says how
      many to pick: **`{kind:"total", count}`** = exactly `count` uids across the
      whole offer (1 for "an Energy", 2 for Corviknight's "Discard 2 Energy"),
      **`{kind:"each"}`** = exactly one uid from EVERY distinct `from` present.
      MANDATORY — there is NO decline, and the op only parks when a real choice
      exists: `discardable` holds at most `count` representatives per
      interchangeable class (the same Energy on the same Pokémon — interpreter.ts
      interchangeableCandidates), and an offer no bigger than `count` auto-resolves
      instead of parking. So **every distinguishable answer is reachable, and no
      row survives beyond what the pick could want** — which above `count: 1` is
      NOT the same as "no two rows give the same answer": three interchangeable
      {F} offered for a pick of 3 yield several uid-subsets landing on one board,
      and that is correct — the player is choosing between identical cards, as in
      paper. What the cap removes is the copy that could ONLY ever duplicate.
      validateChoice's "was it offered" check keys on this collapsed set. Every
      candidate is Energy sitting face up on the table, so the prompt leaks
      nothing. */
  | {
      kind: "discardEnergy";
      discardable: { uid: string; from: PokemonRef }[];
      scope: DiscardScope;
      note: string;
    }
  /** Attach cards out of the controller's DECK onto their own Pokémon — off the
      TOP (Electric Generator / Hydreigon "Tri Howl" — `attachFromTop`) or out of
      a SEARCH of the whole deck (Charizard ex "Infernal Reign", Janine's Secret
      Art — `attachFromDeck`). The first prompt whose answer is a MAP rather than
      a list: every picked card names its OWN destination, where moveEnergy's
      picks all share one.

      `candidates` are the cards the op's filter admits — among the looked-at top
      N in deck order (index 0 was the top) for `attachFromTop`, or the deck-wide
      matches COLLAPSED to at most `max` per interchangeable class for
      `attachFromDeck`, whose source zone is big enough for the difference to
      matter. They are HIDDEN information the controller is being shown — that is
      what "look at the top N" and "search your deck" both mean — so this prompt
      goes to the controller alone, exactly like lookAtTopN's chooseCards; the
      ones actually attached become public through ENERGY_ATTACHED, and the ones
      left unattached stay unnamed unless `discardRest` puts them in the (public)
      discard pile. `targets` are the eligible own Pokémon (attachEnergyTargets,
      with the op's targetType/benchOnly riders); `max` is how many may be
      attached — the printed "up to 2", or the whole candidate set for "any
      number", already resolved to a number here so the dialog and the wire
      validator both read one field.

      `maxPerTarget` caps how many may land on any ONE of those targets — the
      printed "for each of those Pokémon" (Janine's Secret Art, one Energy
      apiece). Absent is the printed "in any way you like": no limit, every split
      legal including all of them on a single Pokémon. It is a separate field
      rather than a smaller `max` because the two bound different things — three
      cards spread one-per-Pokémon is `max: 3, maxPerTarget: 1`, and neither
      number can be recovered from the other.

      DECLINABLE: attaching none is a legal answer ("up to" / "any number"), and
      the op's leftovers clause still runs. */
  | {
      kind: "attachCards";
      candidates: string[];
      targets: PokemonRef[];
      max: number;
      maxPerTarget?: number;
      note: string;
    }
  /** A yes/no: the answering seat may draw `count` cards (opponentMayDraw —
      Ortega's "your opponent may draw a card"). The engine's first pure binary
      prompt, and the first whose ANSWERER is not the program's controller: the
      park carries a `decider` and the phase files it as `answerer`, so this
      prompt reaches the OTHER seat's screen while the controller's turn stands
      still around it. `note` speaks to that answerer ("You may draw a card." —
      every prompt addresses the seat that answers it, and here that is not the
      seat that played the card). Carries no candidates: the decision is the
      whole content, and `count` is the printed number the dialog and the wire
      validator both read. Only ever parked when the draw could actually move a
      card (an empty deck auto-resolves — the M1 no-choice rule), so "yes" is
      never a no-op. */
  | { kind: "mayDraw"; count: number; note: string }
  /** §8/§11 (D157) — pick exactly one of ANOTHER Pokémon's printed ATTACKS, to
      bar it for that Pokémon's next turn ("Choose 1 of your opponent's Active
      Pokémon's attacks…" — Medicham sv01-111, Oranguru sv02-094). The first
      prompt in this engine whose candidates are neither CARDS nor POKÉMON but
      ROWS of one Pokémon's printed attack list, which is why it carries a shape of
      its own rather than reusing `chooseCards`: an attack has no uid, and the only
      thing the answer can be is an INDEX into `attacksOf(card)` — the same value
      the `attack` action carries, the registry's `attack` map is keyed by and
      `InPlayPokemon.lockedAttack` stores.

      ⚠️ PUBLIC INFORMATION, AND THE ANSWERER GATE IS A CONVENIENCE HERE RATHER
      THAN A BARRIER — the `choosePokemon` end of the split (2b-iii-b), not the
      `chooseCards` end (2b-iii-c). Both players can read the printed attacks off a
      face-up Active, and an Active is face-up for both viewers the moment setup
      ends (redact.ts's `inSetup` gate), which an attack's tail is always after. So
      nothing here needs hiding, and `redactPrompt` resolves no card identity.

      ⚠️ IT NONETHELESS CARRIES THE `name`, WHICH THE PUBLIC-REF FAMILY DOES NOT,
      AND THE REASON IS A HOLE IN THE WIRE RATHER THAN A REVEAL. A `PokemonRef` and
      an attached-Energy uid both resolve against the redacted BOARD the client
      already holds; an attack INDEX resolves against nothing — `RedactedCard`
      carries `id`/`cardId`/`name` and no attack rows, and `RedactedAttack[]` is
      published for the viewer's OWN Active only. So the wire must carry the label
      or the dialog would offer numbered buttons. **The two axes are independent**:
      "is the answerer gate load-bearing?" and "must the wire carry a resolved
      label?" — this prompt is the first case that answers NO to the first and YES
      to the second, and saying so is cheaper than the next reader re-deriving it.

      `candidates` is never empty and never a singleton: the op resolves both
      degenerate boards inline (no attacks → silent no-op, one attack → forced),
      the M1 doctrine every parking op in this file follows. */
  | { kind: "chooseAttack"; candidates: { index: number; name: string }[]; note: string }
  /** The printed "**You may** …" — a bare yes/no whose ANSWER SPLICES OPS. The
      engine's second pure binary prompt and its opposite in every other respect:
      `mayDraw` is answered by the NON-controller and its answer moves cards
      itself (applyChoice draws them); this one is answered by the CONTROLLER (no
      `decider` — the printed "you" is the player who played the card) and its
      answer moves nothing at all. What "yes" buys is the `optional` op's `then`
      spliced ahead of the rest of the program, in `resumeProgram`.

      A SIBLING OF `mayDraw` RATHER THAN A RENAME OF IT, and the three reasons are
      worth stating because "two yes/no prompts" invites the merge. (1) The READ
      SITES differ: a mayDraw answer means *move `count` cards to the answerer*, a
      confirm answer means *run `then`* — one is a fact about cards, the other a
      fact about the program. (2) `count` is MEANINGLESS here: every mayDraw
      producer writes a printed number its dialog renders ("Draw 2 cards"), and a
      generic confirm has no number to write — a merged arm would carry a field
      three quarters of its parks could not fill honestly. (3) `kind` is a
      PERSISTED literal (it rides `GameState.phase.prompt` into the match record),
      so renaming it would owe a `MATCH_RECORD_VERSION` bump; adding an
      inhabitant does not.

      NO CANDIDATES — the decision IS the whole content, so `redactPrompt` has
      nothing to resolve and the wire arm is `{kind, note}`. */
  | { kind: "confirm"; note: string };

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
  | { kind: "pokemon"; ref: PokemonRef }
  | { kind: "pokemonMulti"; refs: PokemonRef[] }
  /** The moveEnergy answer: up to `max` movable Energy uids (all sharing one
      source) moved onto `dest` — the compound decision validateChoice checks
      (same source, dest distinct from it). An empty `uids` is a decline. */
  | { kind: "moveEnergy"; uids: string[]; dest: PokemonRef }
  /** The discardEnergy answer: the Energy uids to discard — exactly `count` in
      total (`{kind:"total"}`) or exactly one per offered source Pokémon
      (`{kind:"each"}`), as validateChoice enforces. Never empty for those two
      MANDATORY scopes; the `{kind:"upTo"}` scope (Hail Blade's "any amount") is
      the one that MAY answer empty (a decline of the whole discard). */
  | { kind: "discardEnergy"; uids: string[] }
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
  /** The chooseAttack answer (D157): the INDEX of the barred attack, into the
      chosen Pokémon's printed `attacks`. A bare number rather than a ref or a uid
      because an attack is not an addressable object in this engine — the index IS
      its identity everywhere else (the `attack` action, the registry's `attack`
      map, `InPlayPokemon.lockedAttack.attackIndex`), and inventing a second
      addressing here would be a second thing to keep in step. Wire-checked to be
      one of the OFFERED indices (validateChoice), which is also what keeps a
      crafted frame off an index the defender does not have. */
  | { kind: "attack"; index: number }
  /** The `confirm` answer — `yes: true` splices the `optional` op's `then` ahead
      of the rest of the program, `false` runs nothing. A plain boolean, and
      wire-checked to be one for `mayDraw`'s exact reason: a P4 client's truthy
      string must not read as consent. Answered by the CONTROLLER. */
  | { kind: "confirm"; yes: boolean };

/** What the ops ALREADY RUN in this program left behind for the ops still to
    come — each recording op's moved uids under its printed `EffectSlot` (§9.2:
    "in this way", "if you do", "with the effect of this card"). Threaded through
    a run as a mutable accumulator, exactly like `events`, and carried across a
    park inside the continuation.

    DELIBERATELY NOT A FIELD ON `EffectContext`, which the backlog named as the
    likely home. The context is WHO the program is running for — one seat, fixed
    for the whole program, and read by ~30 helpers that would then be holding a
    value going stale under them mid-run. This is the opposite: an accumulator
    that changes at nearly every op. Its sibling is `rest` ("the ops still to
    run") on the continuation, not `seat`. */
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
      /** The seat that must ANSWER, when it is not the program's controller —
          opponentMayDraw is the one producer (Ortega's "your opponent may").
          Absent everywhere else, so settleProgram files the phase's `answerer`
          only for the park that needs it and every pre-D52 park stays
          byte-identical. */
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
      const [face, rngState] = flipCoin(next.rngState);
      next = { ...next, rngState };
      events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat: ctx.seat, result: face });
      // D144 — WHICH FACE WINS is the op's only variable, and everything either
      // side of this comparison is shared: the flip is taken before the branch is
      // consulted (so `rngState` advances on BOTH faces and an online match cannot
      // desynchronise), the row is emitted either way, and the branch is spliced
      // by the same `unshift` so an op inside it can still park. `onTails` is
      // absent on every heads-gated program in the engine, which is why the
      // comparison defaults to heads rather than testing for it.
      if (face === (op.onTails === true ? "tails" : "heads")) queue.unshift(...op.then);
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
    const stepped = stepOp(next, op, ctx, events, record);
    if ("park" in stepped) {
      // rest = the queue as it stands after shifting `op` — a plain EffectOp[].
      return {
        kind: "parked",
        state: next,
        // The prompt describes its own op; a §9.2 gate makes the ANSWER buy
        // something the op cannot see. `queue` is the only place that is
        // knowable, which is why this is folded in here and not in the note.
        prompt: withConsequence(stepped.park, op, queue),
        cont: { pendingOp: op, rest: [...queue], ctx, ...carriedRecord(record) },
        ...(stepped.decider === undefined ? {} : { decider: stepped.decider }),
      };
    }
    next = stepped.done;
  }
  return { kind: "done", state: next };
}

/** The uids filed under `slot`, or none. */
function recorded(record: EffectRecord, slot: EffectSlot): readonly string[] {
  return record[slot] ?? [];
}

/** The slot a parking op will file its answer under, if any. */
function recordSlotOf(op: EffectOp): EffectSlot | undefined {
  return op.op === "payFromHand" ||
    op.op === "discardPileRetrieval" ||
    op.op === "attachFromDeck" ||
    op.op === "bottomFromOpponentHand" ||
    op.op === "discardEnergy"
    ? op.recordAs
    : undefined;
}

/** Does the record satisfy this gate? The base test is "did the earlier op file
    anything" — a whiffed op files an EMPTY array, which is why the length and not
    the key is what is asked.

    `contains: "yourActive"` narrows it to "is any of those cards on the
    controller's Active" (Janine's Secret Art's "if you attached Energy to your
    **Active** Pokémon in this way"). Read off the live board rather than out of
    the record — see the op's doc for why the record's values stay one kind of
    thing, and for the three ops that would make this board reading differ from
    the historical one if a future card sequenced them in between — and against
    `state` AS OF the gate, with every earlier op applied. */
function recordGateHolds(
  state: GameState,
  ctx: EffectContext,
  op: Extract<EffectOp, { op: "recordGate" }>,
  record: EffectRecord,
): boolean {
  const filed = recorded(record, op.slot);
  if (filed.length === 0) return false;
  if (op.contains !== "yourActive") return true;
  const active = state.players[ctx.seat].active;
  if (active === null) return false;
  return filed.some((uid) => active.energy.includes(uid));
}

/** THE PROMPT MUST SAY WHAT THE ANSWER BUYS. Every prompt note before §9.2 was
    the whole printed effect, because an op WAS the whole effect. A recording op
    is the first that is not: Miriam's dialog describes a deck shuffle while the
    answer silently decides three cards, and "take none" reads as declining a
    minor extra rather than forfeiting the draw and the turn's only Supporter.

    So a parking op that records looks DOWN THE QUEUE for the gate that reads it
    and appends the printed conditional. The queue is where this is knowable —
    a note builder sees one op, and the gate is a different op entirely.

    Silence beats a guess: an unrecognised op in the branch yields no clause at
    all rather than a partial one, so a future gate branch this describer has no
    phrase for degrades to the pre-§9.2 note instead of announcing half a
    consequence. Only TOP-LEVEL gates are scanned, matching every other scan over
    a program (`programPlayable`, `handCostUnmet`). */
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

/** The gate's CONDITION as a printed phrase, or null when there is none to give.
 *
 *  A gate with no `contains` is the plain "did the earlier op do anything", and
 *  "If you do" says that for every op that can record — it is the wording both
 *  §9.2 cards print.
 *
 *  A NARROWED gate needs the narrowing spelled out, and it needs the op's own
 *  verb to do it: "If your Active Pokémon is among them" — an earlier draft —
 *  reads as a fact about the eligible targets rather than about where the cards
 *  went, since "them" binds to the nearest list, which in the note above is
 *  "your Darkness Pokémon". That is a softer form of exactly the misreading the
 *  narrowing exists to prevent. So the phrase is built per RECORDING OP, and an
 *  op this has no words for yields **null** — dropping the clause entirely rather
 *  than describing a narrowed gate in the broad gate's words, which would promise
 *  the consequence on any answer at all. `describeBranch`'s rule, applied to the
 *  other half of the sentence. */
function describeCondition(
  op: EffectOp,
  gate: Extract<EffectOp, { op: "recordGate" }>,
): string | null {
  // Ortega prints its plain gate LONG — "If you put a card on the bottom of
  // your opponent's deck in this way" — so its op says those words rather than
  // the two-word form below: the note is the printed text, and this is the
  // text printed. (Checked before the plain default for exactly that reason.)
  //
  // The `contains === undefined` half of this test is UNREACHABLE today and
  // kept deliberately: `contains` has one member, consumed by one other op, so
  // no gate can currently be both narrowed and pointed at this op. Dropping it
  // is a passing mutation — and it is the exact mutation this function's own
  // doc warns about, since a narrowed gate would then be announced in the broad
  // gate's words ("if you put a card on the bottom" promising a consequence
  // that in fact needs the card to have landed somewhere specific).
  if (gate.contains === undefined && op.op === "bottomFromOpponentHand") {
    return "If you put a card on the bottom of your opponent's deck in this way";
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
        parts.push(op.count === 1 ? "draw a card" : `draw ${op.count} cards`);
        break;
      case "drawUntilHandSize":
        parts.push(`draw cards until you have ${op.size} cards in your hand`);
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
      case "applyStatus":
        // Only the controller-relative arm: "self" is the controller's own Active
        // in a Trainer/Ability program (applyStatus reads ctx.seat), which is what
        // Janine's "it is now Poisoned" refers to. The "defender" arm belongs to
        // an ATTACK program, where no §9.2 gate exists to describe.
        if (op.target !== "self") return null;
        parts.push(`it is now ${STATUS_WORD_OF[op.status]}`);
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
  const applied = applyChoice(state, cont.pendingOp, choice, cont.ctx, events, record);
  // THE FOURTH GATE, SPLICED HERE RATHER THAN IN AN APPLY ARM. `optional` is the
  // printed "you may", and a gate's whole job is to put ops into the queue —
  // which `runProgram` does three times over (`coinFlipGate` / `conditionGate` /
  // `recordGate` each `queue.unshift(...op.then)`). The only difference is that
  // this gate's condition is a HUMAN ANSWER, so it cannot be evaluated where the
  // others are: the branch is known one action later, on the resume. This is the
  // one place that holds both halves — the applied state AND the ops still to run
  // — so it is the only place the splice can live without widening applyChoice's
  // signature or its return type. A "no" splices nothing, which is the whole of
  // the decline.
  const rest =
    cont.pendingOp.op === "optional" && choice.kind === "confirm" && choice.yes
      ? [...cont.pendingOp.then, ...cont.rest]
      : cont.rest;
  return runProgram(applied, rest, cont.ctx, events, record);
}

/** One synchronous step, or a park request. Parking ops compute their
    candidates: an empty candidate set is a no-op (nothing to choose), a single
    forced candidate auto-resolves (except searchDeck, which is "up to" and
    always lets the player decline, so it parks whenever ≥1 candidate). */
function stepOp(
  state: GameState,
  op: EffectOp,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): { done: GameState } | { park: EffectPrompt; decider?: Seat } {
  switch (op.op) {
    case "applyStatus":
      return { done: applyStatus(state, op, ctx, events) };
    case "clearStatus":
      return { done: clearStatus(state, ctx, events) };
    case "preventRetreat":
      return { done: preventRetreat(state, ctx, events) };
    case "preventDamage":
      return { done: preventDamage(state, op.effects === true, op.fromClass, ctx, events) };
    case "preventAttack":
      return { done: preventAttack(state, op, ctx, events) };
    case "preventAttackUse":
      return { done: preventAttackUse(state, op.attack, ctx, events) };
    case "boostAttack":
      return { done: boostAttack(state, op.attack, op.amount, ctx, events) };
    case "preventChosenAttack":
      return preventChosenAttack(state, ctx, events);
    case "reduceDamage":
      return { done: reduceDamage(state, op.amount, ctx, events) };
    case "weakenDefenderAttacks":
      return { done: weakenDefenderAttacks(state, op.amount, ctx, events) };
    case "installRecoil":
      return { done: installRecoil(state, op.amount, ctx, events) };
    case "heal":
      return { done: healSelf(state, op.amount, ctx, events) };
    case "healEach":
      return { done: healEach(state, op.amount, ctx, events) };
    case "healEachAll":
      return { done: healEachAll(state, op.amount, events) };
    case "damageActive":
      return { done: damageActive(state, op.amount, op.source, ctx, events) };
    case "moveCountersToDefender":
      // D138 — "Move all damage counters from 1 of your Benched Pokémon to your
      // opponent's Active Pokémon." The CHOICE is `healChosen`'s bench-filtered
      // park, unchanged: the same `ownBenchRefs` helper through the same
      // `parkOrForce`, so all three of its endings are reachable here and mean
      // the same things they mean there — an EMPTY BENCH resolves silently (no
      // prompt, no event, and NOT an ATTACK_EFFECT_SKIPPED, since a derived
      // program means the sentence was read), exactly one benched body is
      // applied INLINE, and two or more park.
      //
      // The candidates are EVERY benched body, damaged or not. The printed
      // sentence carries no damaged restriction, so filtering would be a rule
      // the card does not print (the Potion doctrine `healChosen` follows for
      // the same reason); an undamaged pick whiffs silently in the helper.
      //
      // ⚠️ D205 — `ownerPokemon` NARROWS THAT SET AND IS THE ONLY GATE ON IT.
      // Team Rocket's Wobbuffet "Rocket Mirror" prints "1 of your Benched **Team
      // Rocket's** Pokémon", so a non-subgroup benched body is not a candidate,
      // never reaches `prompt.candidates`, and is therefore unreachable from a
      // crafted online frame — `validateChoice` (cardplay.ts) matches the wire
      // answer against the PROMPT, never against the op. That is D204's
      // structural finding on the attach side, holding here for the same reason
      // rather than by a second copy of the rule. The empty-subgroup board is
      // `parkOrForce`'s existing silent no-op, the ending an empty Bench already
      // takes — an attack that resolves and moves nothing, which is what the
      // sentence does on that board.
      return parkOrForce(
        state,
        subgroupRefs(state, ownBenchRefs(state, ctx.seat), op.ownerPokemon),
        (ref) => moveCountersToDefender(state, ref, ctx, events),
        `Move the damage counters off which of your Benched ${ownerNoun(op.ownerPokemon)}Pokémon?`,
      );
    case "spreadDamage":
      return { done: spreadDamage(state, op.amount, ctx, events) };
    case "damageSelf":
      return { done: damageSelf(state, op.amount, ctx, events) };
    case "damageDefender": {
      // Chien-Pao ex "Hail Blade": `per` (60) HP per card an earlier op filed
      // under `count` — its own leading discardEnergy's `discarded` slot. This is
      // genuine ATTACK damage to the DEFENDER, so it goes through snipeActive's
      // full §8.5 pipeline (attacker pre-W/R bonus → Weakness → Resistance →
      // reduction), NOT the flat put-counter model: Hail Blade doubles off a {G}
      // defender's Weakness, and Vitality Band adds its +10. Nothing discarded
      // (an empty slot or a whiffed board) → amount 0 → no damage placed. Never
      // parks; the KO it may cause is swept by the attack epilogue, like every
      // program-emitted damage op. */
      const amount = recorded(record, op.count).length * op.per;
      if (amount <= 0) return { done: state };
      return { done: snipeActive(state, amount, false, ctx, events) };
    }
    case "damageChosen": {
      // The snipe (Hawlucha / Meowscarada): choose `count` of the opponent's
      // Benched Pokémon and put counters on each. An empty Bench is a no-op.
      // The pick asks for `count` EXACTLY — the printed number is a floor as
      // well as a ceiling (effects.ts) — clamped to the Bench by §8.6 "do as
      // much as you can", which is the only thing that softens it.
      //
      // WHAT DECIDES BETWEEN A PROMPT AND AN AUTO-TAKE IS `optional`, NOT THE
      // BENCH SIZE. A mandatory snipe over a Bench of `count` or fewer has no
      // decision left in it, so it auto-takes (the M1 no-choice doctrine, and
      // the parkOrForce family's rule at one candidate). A DECLINABLE one always
      // has a decision left — "you may" — and it is the same decision on a Bench
      // of 1 as on a Bench of 5, so it parks at every non-empty Bench. Auto-
      // taking there would honour Hawlucha's printed "you may" only when the
      // opponent has more than 2 Benched Pokémon, which is not what the card
      // says: placing counters is not always wanted (it can KO a body the
      // opponent is happy to lose, free a Bench slot, or fire an on-KO Ability).
      // The framework auto-fires the TRIGGER (triggers.ts), so this pick is the
      // only place that "may" can live at all.
      // `opponentAny` (Fezandipiti ex "Cruel Arrow") offers the Active TOO, not just
      // the Bench — and the Active is always present during an attack, so this set
      // is never empty; the Bench-only snipes can be.
      const candidates =
        op.target === "opponentAny" ? oppAnyRefs(state, ctx.seat) : oppBenchRefs(state, ctx.seat);
      if (candidates.length === 0) return { done: state };
      // Wo-Chien "Covetous Ivy" scales the amount by the opponent's TAKEN Prizes;
      // 0 taken → 0 damage, so there is nothing to place OR to ask about.
      const amount = snipeAmount(op, state, ctx);
      if (amount <= 0) return { done: state };
      const declinable = op.optional === true;
      // §8.6: with fewer candidates than the printed number, take them all.
      const take = Math.min(op.count, candidates.length);
      if (!declinable && candidates.length <= op.count) {
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
          note: snipeNote(amount, take, declinable, op.deals === true, op.target),
        },
      };
    }
    case "drawCards":
      return { done: drawToHand(state, ctx.seat, op.count, "effect", events) };
    case "drawUntilHandSize":
      // "Draw cards until you have N cards in your hand" (Grusha). Fully
      // automatic. A hand already at or above `size` draws NOTHING — drawToHand
      // no-ops at count ≤ 0 and emits no event, so a topped-up hand leaves no
      // misleading "drew 0 cards" row; a shallow deck short-draws, like every
      // other draw (§14.3 deck-out is checked at turn start, not here).
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
    case "shuffleDeck":
      return { done: shuffleDeck(state, ctx, events) };
    case "searchDeck": {
      const candidates = state.players[ctx.seat].deck.filter((uid) =>
        matchesFilter(cardOf(state, uid), op.filter),
      );
      const max = op.dest === "bench" ? Math.min(op.max, benchSpace(state, ctx.seat)) : op.max;
      if (candidates.length === 0 || max <= 0) {
        // A search that can find nothing (or has nowhere to put it) is a
        // no-op — the trailing shuffleDeck op still fires.
        return { done: state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 0, // "up to" — taking none is a legal answer
          max,
          dest: op.dest,
          note: searchNote(op.filter, op.dest, max),
        },
      };
    }
    case "discardPileRetrieval": {
      // The discard-pile twin of searchDeck (§7.1 recovery Items). Hand and deck
      // have no capacity cap, so `max` is used as printed (no bench-space clamp).
      // Also "up to" → parks on the SAME chooseCards prompt whenever ≥1 candidate
      // (the player may still take none); an empty match is a no-op, and any
      // trailing shuffleDeck op still fires — exactly like searchDeck's whiff.
      //
      // `exclude` is Superior Energy Retrieval's "(You can't choose a card you
      // discarded with the effect of this card.)" — the cards its own cost paid
      // INTO this pile a moment ago (§9.2). Applied to the CANDIDATES, which is
      // the only place it can bite: the offer is what resolveEffect's
      // validateChoice checks a pick against, so an excluded uid is unreachable
      // from the wire as well as absent from the dialog.
      const barred = new Set(op.exclude === undefined ? [] : recorded(record, op.exclude));
      const candidates = state.players[ctx.seat].discard.filter(
        (uid) => !barred.has(uid) && matchesFilter(cardOf(state, uid), op.filter),
      );
      // A whiff FILES AN EMPTY ANSWER rather than filing nothing. Both are false
      // to the gate that may follow ("if you shuffled any cards … in this way" —
      // you shuffled none), but only one of them is false to a slot some earlier
      // op already wrote: an op that ran and moved nothing must overwrite, or a
      // stale value survives it. Unreachable while each slot has one writer, and
      // the closed `EffectSlot` union makes reuse easy rather than hard — so the
      // two recording ops agree here instead of differing by accident.
      if (candidates.length === 0 || op.max <= 0) {
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 0, // "up to" — taking none is a legal answer
          max: op.max,
          dest: op.dest,
          note: retrieveNote(op.filter, op.dest, op.max, op.exclude !== undefined),
        },
      };
    }
    case "lookAtTopN": {
      // Look at the top n cards (index 0 = top); the candidates are those
      // matching the filter, in deck order. "Up to"/declinable like searchDeck →
      // parks whenever ≥1 candidate (the player may still take none); an empty
      // top-n match is a no-op. The candidate set is the top-n matches ALONE, so
      // resolveEffect's validateChoice (picks ⊆ candidates) already forbids a
      // deeper card. "Shuffle the other cards back" is the trailing shuffleDeck op.
      const top = state.players[ctx.seat].deck.slice(0, Math.max(0, op.n));
      const candidates = top.filter((uid) => matchesFilter(cardOf(state, uid), op.filter));
      if (candidates.length === 0 || op.max <= 0) return { done: state };
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 0, // "up to" — taking none is a legal answer
          max: op.max,
          dest: "hand",
          note: lookNote(op.filter, op.n, op.max),
        },
      };
    }
    case "attachFromTop": {
      // Look at the top n (index 0 = the top) and attach the Energy among them
      // onto your own Pokémon, "in any way you like" (Electric Generator /
      // Hydreigon). Two coupled decisions PER CARD — which cards, and where each
      // one goes — so it parks on the compound attachCards prompt and applies
      // atomically on resolve.
      //
      // Every non-parking path goes through the SAME apply with no assignments,
      // rather than returning `state`: the leftovers clause must fire whether the
      // look found nothing, the board had nowhere to put it, or the player
      // declined (Tri Howl discards the top 3 either way). Routing the empty
      // cases through the one apply is what keeps a branch from forgetting it.
      // The no-TARGET case is a live path, not a theoretical one: there is no
      // `programPlayable` gate on this op (see effects.ts), so Electric Generator
      // into a board with no Benched {L} Pokémon lands exactly here and resolves
      // to its printed shuffle.
      const { candidates, targets, max } = attachFromTopOffer(state, ctx.seat, op);
      if (candidates.length === 0 || targets.length === 0 || max <= 0) {
        return { done: attachFromTopApply(state, [], op, ctx, events) };
      }
      return { park: { kind: "attachCards", candidates, targets, max, note: attachNote(op) } };
    }
    case "discardDeckTop": {
      // D130 — the MILL, widened to either deck by D131. The top `count` of
      // `whose` deck into that same player's discard, in deck order (top first —
      // the order the pile gains them, §2). No choice, so no park; no filter, so no
      // scan; no rng, so the faces that decided how many times this runs are the
      // only randomness in the sentence. That is what makes it safe to repeat once
      // per heads.
      //
      // `whose` PICKS THE SEAT AND NOTHING ELSE — that one ternary is the entire
      // difference between "Discard the top 5 cards of your deck" (Gyarados
      // swsh10.5-022 "Wild Splash") and "…of your opponent's deck" (its own index-0
      // "Wreak Havoc"), which is why D131 widened the field instead of adding a
      // member. Note the self-mill can empty the ATTACKER's deck, and the deck-out
      // rule below applies to it identically: the attacker loses at THEIR next draw
      // step, not the instant the deck runs dry.
      //
      // CLAMPED BY `slice`, which is the whole of the "do as much as you can" rule
      // here: a deck shallower than `count` gives up everything it has and the
      // event reports the SHORT list, so the log and the wire agree with the board
      // rather than with the printed number. Milling to zero does NOT end the game
      // — §14.3 deck-out is checked at the DRAW (flow.ts `startTurn`), which for
      // the milled player is their next turn, so the loss stays owed to the draw
      // step exactly as it is for a short `drawCards`.
      //
      // ZERO CARDS EMIT NOTHING (an empty deck, or a `count` of 0 no deriver can
      // produce): the sibling producer's "only fires with ≥1" rule, and the reason
      // it matters here is that a heads-count of N on an empty deck would
      // otherwise announce N rows about nothing having happened.
      const victim = op.whose === "self" ? ctx.seat : otherSeat(ctx.seat);
      const side = state.players[victim];
      const milled = side.deck.slice(0, Math.max(0, op.count));
      if (milled.length === 0) return { done: state };
      // `seat` is the deck's OWNER and `actor` the player whose card did it, so the
      // two coincide on `whose: "self"` and diverge on `whose: "opponent"` — the same
      // one ternary, read a second time. The log's voice hangs off that comparison
      // (D153): Wild Splash's own-deck cost reads ACTIVE under the attacker's name,
      // the mill reads PASSIVE under the victim's.
      events.push({ type: "DECK_TOP_DISCARDED", seat: victim, actor: ctx.seat, uids: milled });
      return {
        done: withSide(state, victim, {
          ...side,
          deck: side.deck.slice(milled.length),
          discard: [...side.discard, ...milled],
        }),
      };
    }
    case "attachFromDeck": {
      // SEARCH the deck for Energy and attach it onto your own Pokémon (Charizard
      // ex "Infernal Reign" / Janine's Secret Art). The same compound decision
      // attachFromTop parks on — which cards, and where each one goes — over a
      // candidate set drawn from the whole deck rather than a window on its top.
      //
      // A dead end here returns `state` rather than routing through the apply, and
      // that is the one structural difference from attachFromTop: this op has NO
      // leftovers clause to charge on the empty paths (nothing was ever taken out
      // of the deck, so there is nothing to put back or discard). The printed
      // "Then, shuffle your deck" lives in the trailing `shuffleDeck` op, which
      // runs on the whiff, the decline and the no-target board alike — exactly as
      // it does behind every other search in this vocabulary. No `programPlayable`
      // gate, so the no-target board IS a live path (see the op's doc).
      //
      // The dead end still FILES AN EMPTY ANSWER, the rule `discardPileRetrieval`
      // states above: an op that ran and moved nothing must OVERWRITE its slot, or
      // a stale value from an earlier writer survives it and the gate answers for
      // the wrong op. Unreachable while each slot has one writer — and kept so
      // that stays a property of the PROGRAMS rather than an accident of which
      // branch remembered. With three recording ops now, the one that differed
      // would have been this one.
      const { candidates, targets, max } = attachFromDeckOffer(state, ctx, op);
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
          ...(op.maxPerTarget === undefined ? {} : { maxPerTarget: op.maxPerTarget }),
          note: attachFromDeckNote(op),
        },
      };
    }
    case "moveEnergy": {
      // Move up to `max` Energy from ONE own Pokémon to ANOTHER (Energy Switch /
      // Poppy). Two coupled decisions (which Energy + where), so it parks on the
      // compound moveEnergy prompt and applies atomically on resolve. A no-op
      // needs no movable Energy OR no distinct destination (fewer than two of the
      // controller's Pokémon in play) — the programPlayable gate blocks the play,
      // but stay a no-op here too (a mid-program board could reach it).
      // `ctx.sourceUid` is threaded for the `koedActiveToToolHolder` route alone
      // (D171): it names the TOOL whose sentence is running, and the route resolves
      // "the Pokémon this card is attached to" from it. Every other route ignores it.
      const { movable, destinations, needed } = moveEndpoints(state, ctx.seat, op, ctx.sourceUid);
      if (movable.length === 0 || destinations.length < needed || op.max <= 0) {
        return { done: state };
      }
      return {
        park: { kind: "moveEnergy", movable, destinations, max: op.max, note: moveNote(op) },
      };
    }
    case "discardEnergy": {
      // Discard Energy off the OPPONENT's board (Crushing Hammer / Giacomo /
      // Mawile). Mandatory and exactly one per affected Pokémon, so the only
      // question is WHICH: nothing matching is a no-op, a forced pick
      // auto-resolves (the parkOrForce doctrine), and anything else parks.
      //
      // §11 (D142) — an ATTACK's discard aimed at the opponent's Active ("Flip a
      // coin. If heads, discard an Energy from your opponent's Active Pokémon.")
      // is an effect done to that Pokémon and the wider block refuses it, WHOLE:
      // the refusal is taken here, in front of the candidate scan, so a blocked
      // defender never reaches the prompt and the opponent is not asked to pick
      // an Energy that will not be discarded. `from: "yourActive"`/`"yours"` — the
      // attacker's OWN printed cost, six of the eight derived arms — resolve on
      // `ctx.seat`, whose block can never be live during its own turn, so this
      // one guard covers both directions without a `from` branch. A TRAINER
      // reaching the same op is untouched: `invokedBy` is absent for it, which is
      // exactly why Crushing Hammer still works inside the window.
      if (op.from !== "yourActive" && op.from !== "yours") {
        if (attackEffectRefused(state, discardVictimSeat(ctx.seat, op), ctx, events)) {
          recordMoved(record, op.recordAs, []);
          return { done: state };
        }
      }
      const discardable = discardableEnergies(state, ctx.seat, op);
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
    case "payFromHand": {
      // Pay the printed hand cost — to the DISCARD (Ultra Ball / Earthen Vessel /
      // Tinkaton / Revavroom / Meowscarada ex / Radiant Blastoise) or to the
      // BOTTOM OF THE DECK (Dendra) — always the FIRST op of its program, so it
      // runs before anything it buys.
      //
      // MANDATORY and exact: the only decision is WHICH cards, so there is no
      // decline and the prompt asks for `count` on the nose. An offer no bigger
      // than the count has no decision left in it and resolves inline (the M1
      // doctrine) — which is what keeps Meowscarada, whose Basic {G} Energy are
      // interchangeable and collapse to one candidate, asking nothing at all,
      // exactly as its pre-op `AbilityCost` field did.
      //
      // A SHORT hand (fewer candidates than `count`) also lands in that branch
      // and pays what there is. Unreachable through either action path — both
      // gate on `handCostUnmet` before the card is committed — and deliberately
      // NOT an exception here: an interpreter that threw or no-opped mid-program
      // would leave the play half-resolved, where "do as much as you can" is the
      // rule this engine already applies to a short board (§8.6).
      const candidates = handCostCandidates(state, ctx.seat, op);
      if (candidates.length <= op.count) {
        const paid = payFromHandApply(state, candidates, op, ctx, events);
        recordMoved(record, op.recordAs, paid.paid);
        return { done: paid.state };
      }
      // HIDDEN INFORMATION — the candidates are cards in the controller's own
      // HAND, and this prompt is the first that carries any. Do not reason from
      // the apply's rule ("the paid cards land in the public discard, so naming
      // them leaks nothing"): the OFFER is strictly bigger than the payment, so
      // with Ultra Ball three uids are named and only two ever become public —
      // the third stays in hand with its identity given away. The collapse leaks
      // a second thing, the hand's DUPLICATE STRUCTURE: hand size is public but
      // `candidates.length` against it says how many cards are copies.
      //
      // `to: "deckBottom"` is the WORST case of the three and the reason this
      // note is not softening: a card paid to the discard at least becomes
      // public, while Dendra's goes hand → deck and is never seen again, so
      // naming its uid gives away a card that is now hidden for the rest of the
      // game (and, with a full hand offered, names every card in that hand).
      //
      // Safe today because the prompt is only ever shown to the seat that owns
      // it. It reaches a client through `projection.ts`'s `pendingDecision`,
      // which is NOT yet gated on `phase.seat` — a pre-existing P4 hole (deck
      // uids already ride it) that this op is the first to widen to the HAND.
      // That gate is P4's job; see docs/workstreams/simulator.md.
      return {
        park: {
          kind: "chooseCards",
          candidates,
          // No decline: min === max is what makes this the one MANDATORY
          // chooseCards park (every other consumer is a printed "up to").
          min: op.count,
          max: op.count,
          dest: op.to,
          note: payFromHandNote(op),
        },
      };
    }
    case "bottomFromOpponentHand": {
      // Reveal FIRST, and totally — the whole hand goes public in one event
      // before any question is asked, because that is the printed order ("Your
      // opponent reveals their hand, and you choose…"). Emitted here and never
      // in the apply, so a park tells the story once: the reveal rides the
      // action that parked, the pick rides the resolveEffect that answers.
      const revealed = otherSeat(ctx.seat);
      events.push({
        type: "HAND_REVEALED",
        seat: revealed,
        uids: [...state.players[revealed].hand],
      });
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
      if (candidates.length === 1) {
        const moved = bottomFromOpponentHandApply(state, candidates, ctx, events);
        recordMoved(record, op.recordAs, moved.moved);
        return { done: moved.state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          min: 1,
          max: 1,
          dest: "deckBottom",
          note: bottomFromOpponentHandNote(op),
        },
      };
    }
    case "opponentMayDraw": {
      // The opponent's printed "may" — the one park whose ANSWERER is the other
      // seat (the decider below; settleProgram files it as phase.answerer). An
      // empty opponent deck makes both answers the same state, so the question
      // does not exist and the op resolves silently (the M1 no-choice rule —
      // drawCards' own empty-deck no-op, asked about first).
      const drawer = otherSeat(ctx.seat);
      if (state.players[drawer].deck.length === 0) return { done: state };
      return {
        park: { kind: "mayDraw", count: op.count, note: mayDrawNote(op) },
        decider: drawer,
      };
    }
    case "optional":
      // The printed "you may" — ALWAYS parks, and that is the whole op. No
      // no-choice shortcut of the M1 kind is available here and none would be
      // honest: the M1 rule retires a prompt whose ANSWERS ARE THE SAME STATE,
      // and this op's two answers differ by everything in `then`. (An `optional`
      // wrapping an empty `then` would be such a case — and it is unrepresentable
      // in practice for the same reason no other gate guards it: nothing but a
      // deriver arm or a registry row builds one, and neither can write an empty
      // branch by accident.) NO `decider`: the printed "you" is the controller,
      // unlike `opponentMayDraw` above.
      return { park: { kind: "confirm", note: op.note } };
    case "handRefresh":
      // Put the affected player(s)' hand back into their deck — shuffled in
      // (Youngster / Judge / Brassius / Katy) or under it (Iono) — then draw.
      // Fully automatic — no decision, so it never parks (like drawCards /
      // discardHand / shuffleDeck).
      return { done: handRefresh(state, op, ctx, events) };
    case "switchActive":
      return parkOrForce(
        state,
        ownBenchRefs(state, ctx.seat),
        (ref) => switchOwn(state, ref, ctx, events),
        "Switch to which Benched Pokémon?",
      );
    case "gust":
      return parkOrForce(
        state,
        oppBenchRefs(state, ctx.seat),
        (ref) => gust(state, ref, ctx, events),
        "Gust up which of the opponent's Benched Pokémon?",
      );
    case "healChosen": {
      // `zone: "bench"` is the printed word "Benched" and nothing else (D135):
      // it drops the Active from the candidate set and changes NOTHING else —
      // same park, same choice shape, same heal, same HEALED event. The zone is
      // applied to BOTH arms from one place on purpose: a field that silently
      // meant nothing on the `upTo` arm would be a trap for the first author who
      // combines them (no printing does today), and the heading has to agree
      // with the candidates or the prompt lies about what it is offering.
      const candidates =
        op.zone === "bench" ? ownBenchRefs(state, ctx.seat) : ownInPlayRefs(state, ctx.seat);
      const zoneWord = op.zone === "bench" ? "Benched " : "";
      if (op.upTo !== undefined) {
        // The printed "up to N … each" (Saguaro). §8.6 clamps the ASK to the
        // board; min is 0 because "up to" legalizes taking fewer — including
        // none — so unlike the mandatory single arm below this parks at every
        // non-empty board: the take-fewer right is the same decision over one
        // candidate as over six (the declinable-snipe rule, D47).
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
      return parkOrForce(
        state,
        candidates,
        (ref) => healChosen(state, ref, op.amount, ctx, events),
        `Heal which of your ${zoneWord}Pokémon?`,
      );
    }
    case "attachEnergyFrom": {
      // Same-type Basic Energy is fungible, so the ONLY decision is the target;
      // a source with no matching Energy is a no-op (nothing to attach). The
      // candidates are the eligible targets (targetType + notIfKO riders).
      if (firstAttachableEnergy(state, ctx.seat, op.source, op.energyType) === undefined) {
        return { done: state };
      }
      // ⚠️ THE CAPTION NAMES THE RIDERS. It used to read "…which of your
      // Pokémon?" flat, which was merely vague while every rider was a type or a
      // stage the offered rows themselves make obvious; with an owner-prefixed
      // subgroup it would be FALSE — a board of six Pokémon offering two rows and
      // a prompt saying "your Pokémon" reads as a bug rather than as the printed
      // "1 of your Iono's Pokémon". Shares `attachTargetNoun` with the two
      // attachCards captions so the three cannot drift.
      // ⚠️ AND SINCE D205 IT NAMES THE COUNT TOO. "Attach the Energy" is a
      // singular the print contradicts when `count` is 2 — and the count is the
      // one thing about this park a player cannot see from the offered rows,
      // because the batch lands on whichever ONE they pick. The printed hedge is
      // carried verbatim ("up to"), since the hand may hold fewer.
      return parkOrForce(
        state,
        attachEnergyTargets(state, ctx.seat, op),
        (ref) => attachEnergyFrom(state, op, ref, ctx, events),
        // ⚠️ BRANCHES ON THE FIELD'S PRESENCE, NOT ON ITS VALUE, and that is a
        // mutation result rather than a preference. Written as `count <= 1 ? …`
        // it carries a comparison NO AUTHORED ROW CAN REACH — `count: 1` is
        // never spelled, because D104's minimal-shape rule omits a field that
        // means what its absence means — so `<= 1` versus `< 1` is a live
        // difference no test can see and no card can produce. Removing the
        // comparison removes the unkillable mutant with it: the absent field is
        // the singular caption, and any count a card DOES spell is quoted.
        `Attach ${
          op.count === undefined ? "the Energy" : `up to ${op.count} Energy`
        } to which of your ${attachTargetNoun(op)}?`,
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
      // D105's Evolution reading, verbatim: a Pokémon that evolves from another
      // one. `evolveFromOf` returns null for a Basic and for a non-Pokémon, so a
      // non-null result is the exact complement of `basicPokemon`. An empty
      // Active Spot is FALSE (nothing there is an Evolution) rather than a throw —
      // the attack gate already guarantees a Defending Pokémon at the one live
      // read site, so this only covers a directly-invoked edge.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && evolveFromOf(spot.card) !== null;
    }
    case "opponentActiveIsBasic": {
      // D148 — "the Defending Pokémon is a Basic Pokémon" (Houndoom ex sv03-134),
      // and `isBasicPokemon` is reused VERBATIM rather than re-derived from
      // `evolveFromOf` right above: the two are complements today, and writing
      // this as `=== null` would be a SECOND reading of "Basic" free to disagree
      // with §3.6/§5.2 and with D146's identical predicate on the attacker.
      // Read off the TOP card (§1.2) — an evolved body is a Stage 1 and is not
      // Basic, which is what makes the §10 evolve clear a real line of play.
      // An empty Active Spot is FALSE rather than a throw, exactly as the arm
      // above: the attack gate guarantees a Defending Pokémon at the one live
      // read site, so this only covers a directly-invoked edge.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isBasicPokemon(spot.card);
    }
    case "yourActiveDamaged": {
      // "this Pokémon has any damage counters on it" as printed on Talonflame /
      // Darmanitan — resolved to YOUR ACTIVE by the clause table, not here (D116).
      // At the one live read site (attack.ts's damage fold) `state` is the board
      // as of DECLARATION and the attacker IS this Active, so the number read is
      // the damage it walked in with, not any it takes later in the same attack.
      const active = state.players[seat].active;
      return active !== null && active.damage > 0;
    }
    case "yourBenchDamaged":
      // "your Benched Pokémon have any damage counters on them" — the plural is
      // collective, so ANY one damaged benched Pokémon satisfies it. The Active is
      // deliberately not consulted, and an empty Bench is false rather than
      // vacuously true (nothing there is carrying counters).
      return state.players[seat].bench.some((p) => p !== null && p.damage > 0);
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
    case "yourActivePoisoned": {
      // "this Pokémon is Poisoned" as printed on Okidogi ex — resolved to YOUR
      // ACTIVE by the clause table, not here (D116's rule, D117's second use).
      // Same `> 0` read as the cross-board twin above: Poison is the counter
      // AMOUNT, and the attacker walks into its own attack already carrying it
      // (the Checkup that Poisons it ran on an earlier turn).
      const active = state.players[seat].active;
      return active !== null && active.conditions.poisonDamage > 0;
    }
    case "opponentActiveIsExOrV": {
      // D107's `isExOrV` verbatim — ex or V, NOT VMAX/VSTAR/GX, which is exactly
      // what the sentence names. An empty Active Spot is FALSE, as with the
      // Evolution sibling.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isExOrV(spot.card);
    }
    case "yourActiveHasEnergyAttached": {
      // D116's pronoun rule again — the printed "this Pokémon" was resolved to
      // your Active by the clause table, not here. The predicate itself is
      // continuous.ts's, so a type reads by PROVISION (a wildcard Luminous
      // Energy counts as {R} while it provides every type) and cannot drift from
      // the §8.2 cost check. False with an empty Active Spot.
      const active = state.players[seat].active;
      return active !== null && hasAttachedEnergy(state, active, cond.energy);
    }
    case "opponentPrizesRemaining":
      // §3.8 — what is still face down on their side, the same read
      // `morePrizesThanOpponent` makes and the complement of `takenPrizes`. The
      // printed "exactly" makes this set MEMBERSHIP: on `[2, 4]` a 3-Prize board
      // is FALSE, sitting between two true values.
      return cond.counts.includes(state.players[otherSeat(seat)].prizes.length);
    case "opponentHandAtMost":
      // The SIZE of their hand, never its contents — the line the union's
      // public-state invariant draws, and the reason this survives P4 redaction
      // (the wire ships face-down backs with a real length).
      return state.players[otherSeat(seat)].hand.length <= cond.count;
    case "handSizesEqual":
      // The vocabulary's one SEAT-SYMMETRIC member: equality commutes, so this
      // reads the same for p1 and p2 on any board. Sizes only, as above.
      return state.players[seat].hand.length === state.players[otherSeat(seat)].hand.length;
    case "opponentActiveHasType": {
      // The same read Weakness and Resistance make two lines later in the §8.5
      // pipeline (`cards.ts` `weaknessOf`), so a printed type cannot mean one
      // thing to this clause and another to the multiplier it feeds. `types` is
      // null on Trainers and Energy, hence the `?? []`. Empty Active Spot is
      // FALSE, as with the two other card-reading members.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && (spot.card.types ?? []).includes(cond.type);
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
    case "yourEnergyInPlayAtLeast":
      // The board-wide fold of D118's per-Pokémon predicate, and it stays in
      // continuous.ts for that reason: "an Energy that can pay a {D} cost" and
      // "an Energy this clause counts" are one question, whichever board asks it.
      // Active + Bench, cards rather than units, `>=` because the printed word is
      // "at least" (a threshold, unlike the sibling above's "exactly").
      return countEnergyInPlay(state, seat, cond.energy) >= cond.count;
    case "yourActiveHasToolAttached": {
      // D116's pronoun rule again — "this Pokémon" was resolved to your Active by
      // the clause table, not here. `tools` is a uid array on the model and every
      // uid in it got there through `attachTool`, which has already refused
      // anything that is not a Trainer of trainerType "Tool"; so the predicate is
      // a length test and nothing more. `> 0` rather than `=== 1` on purpose:
      // §7.4's one-Tool cap is an attach-gate rule, and Revavroom ex's "Tune-Up"
      // raises it to 4. False with an empty Active Spot.
      const active = state.players[seat].active;
      return active !== null && active.tools.length > 0;
    }
    case "youPlayedSupporterThisTurn":
      // §7.2 — the one-Supporter-per-turn flag `playTrainer` already sets, read
      // back as a printed clause. No new state, and no new clock: the allowances
      // bag is reset by `freshAllowances()` on every startTurn, so its lifetime
      // IS the printed "during this turn".
      //
      // THE SEAT GUARD IS THE WHOLE ARM. `state.allowances` is a SINGLE bag
      // describing whoever owns the current turn, not a per-seat record, and this
      // predicate is seat-relative with consumers where `seat` is NOT the turn
      // owner (a `conditionGate` under a koTrigger/damagedTrigger stage evaluates
      // during the OPPONENT's turn). Unguarded, the bag would answer "your
      // OPPONENT played a Supporter" as "you played a Supporter" — so the seat
      // must first be proved to own the turn.
      //
      // The owner comes from `phaseViewOf`, THE one exhaustive switch over
      // `Phase`, never from turn parity (phaseView.ts's header forbids exactly
      // that shortcut, and a ko:* park is where it goes wrong). `activeSeat` is
      // viewer-independent, so passing `seat` as the viewer is immaterial. During
      // a checkup-origin `ko:*` park `activeSeat` is null and this reads FALSE for
      // BOTH seats: "during this turn" is vacuous between turns, which is the
      // intended reading.
      return phaseViewOf(state, seat).activeSeat === seat && state.allowances.supporterPlayed;
    case "yourActivePromotedThisTurn": {
      // D116's pronoun rule: "this Pokémon" was resolved to your Active by the
      // clause table, so this arm only has to ask the Active when it moved up.
      //
      // AND THIS ONE TAKES NO SEAT GUARD — the deliberate inverse of the arm
      // directly above, and the reason worth writing down. D123's guard was NOT
      // owed to the words "this turn"; it was owed to `allowances` being a
      // SINGLE bag belonging to whoever owns the turn, i.e. to seat-AMBIGUOUS
      // state. `promotedTurn` is stamped on the Pokémon, which already knows
      // whose it is, and `state.turn` is a global counter, so the comparison is
      // total: it is true exactly when THIS Pokémon moved during the turn now in
      // progress, for any `seat`, from any consumer, in any phase.
      //
      // That totality is also what gets §8.1 right for free. A Knock Out
      // promotion runs during the OPPONENT's turn and stamps THEIR turn number,
      // so it can never equal `state.turn` once the controller's own turn has
      // begun — the replacement Pokémon did not "move up this turn", and nothing
      // had to be cleared to say so. Between turns (a checkup-origin ko:* park)
      // the counter has not yet advanced, so a promotion made in the turn just
      // played still reads TRUE for the player who made it: correct, since that
      // turn is the one it moved in.
      const active = state.players[seat].active;
      return active !== null && active.promotedTurn === state.turn;
    }
  }
}

/** The condition as a printed-text fragment, for the reject message a failed
    play gate returns ("<card> can only be used if <this>"). */
export function conditionNote(cond: BoardCondition): string {
  switch (cond.kind) {
    case "morePrizesThanOpponent":
      return "you have more Prize cards remaining than your opponent";
    case "yourStadiumInPlay":
      return "you have a Stadium in play";
    case "noEnergyOnYourPokemon":
      return "none of your Pokémon have any Energy attached";
    case "opponentActiveDamaged":
      // The printed clause drops the "already" — that word is about WHEN the
      // condition is read, and a reject/tooltip fragment is read in the present.
      return "your opponent's Active Pokémon has damage counters on it";
    case "opponentActiveIsEvolution":
      return "your opponent's Active Pokémon is an Evolution Pokémon";
    case "opponentActiveIsBasic":
      // The printed pronoun ("the Defending Pokémon") is dropped for
      // `yourActiveDamaged`'s reason (D116): a reject/tooltip fragment is read off
      // the BOARD, where no attack is resolving and nothing is "Defending".
      return "your opponent's Active Pokémon is a Basic Pokémon";
    case "yourActiveDamaged":
      // The printed pronoun is dropped for the same reason "already" is above: a
      // reject/tooltip fragment is read off the BOARD, where "this Pokémon" has
      // no referent (D116).
      return "your Active Pokémon has damage counters on it";
    case "yourBenchDamaged":
      return "1 of your Benched Pokémon has damage counters on it";
    case "opponentActivePoisoned":
      return "your opponent's Active Pokémon is Poisoned";
    case "opponentActiveHasSpecialCondition":
      return "your opponent's Active Pokémon is affected by a Special Condition";
    case "yourActivePoisoned":
      // The printed pronoun is dropped exactly as `yourActiveDamaged` drops it —
      // a reject/tooltip fragment is read off the BOARD (D116).
      return "your Active Pokémon is Poisoned";
    case "opponentActiveIsExOrV":
      return "your opponent's Active Pokémon is a Pokémon ex or Pokémon V";
    case "yourActiveHasEnergyAttached":
      // The family's first note built from a PARAMETER rather than returned as a
      // literal. The pronoun is dropped exactly as its siblings drop it, and the
      // energy reads as the printed NAME rather than the brace code — a
      // reject/tooltip fragment is prose, and half the pool prints it that way
      // anyway.
      return cond.energy === "special"
        ? "your Active Pokémon has a Special Energy attached"
        : `your Active Pokémon has ${cond.energy} Energy attached`;
    case "opponentPrizesRemaining":
      // Built from the parameter, agreement and all: the printed sentences read
      // "exactly 1 Prize card" and "exactly 2 or 4 Prize cards", so the noun is
      // singular exactly when the only admitted count is 1. `printedList` spells
      // the list the way the pool does, Oxford comma included.
      return `your opponent has exactly ${printedList(cond.counts)} Prize card${
        cond.counts.length === 1 && cond.counts[0] === 1 ? "" : "s"
      } remaining`;
    case "opponentHandAtMost":
      return `your opponent has ${cond.count} or fewer cards in their hand`;
    case "handSizesEqual":
      return "you have the same number of cards in your hand as your opponent";
    case "opponentActiveHasType":
      // Round-trips to the printed clause: the note is built from the parameter
      // and the type word is the same token the sentence carried in.
      return `your opponent's Active Pokémon is a ${cond.type} Pokémon`;
    case "yourBenchHasNamed":
      // Also verbatim — this clause names no pronoun and no timing word, so
      // nothing has to be dropped on the way out (D119's whole cluster).
      return `${cond.name} is on your Bench`;
    case "yourEnergyInPlayAtLeast":
      // Built from BOTH parameters, and the energy reads as the printed NAME
      // rather than the brace code — D118's rule, so this is the family's first
      // note that does NOT round-trip to the printed clause byte for byte
      // ("{D}" → "Darkness"). Deliberate: a reject message and a HUD tooltip are
      // read off the board by a person, and "{D}" is a card-face glyph.
      return cond.energy === "special"
        ? `you have at least ${cond.count} Special Energy in play`
        : `you have at least ${cond.count} ${cond.energy} Energy in play`;
    case "yourActiveHasToolAttached":
      // Back to a round-trip: this clause names no timing word and no energy
      // glyph, so only the pronoun is dropped (D116) and the rest is the printed
      // sentence.
      return "your Active Pokémon has a Pokémon Tool attached";
    case "youPlayedSupporterThisTurn":
      // A full ROUND-TRIP, the family's cleanest: this clause names no pronoun to
      // resolve (the printed subject is already "you", which is what a
      // seat-relative predicate means), no timing word to drop and no card-face
      // glyph to spell out. The printed sentence, verbatim.
      return "you played a Supporter card from your hand during this turn";
    case "yourActivePromotedThisTurn":
      // Back to a resolved pronoun (D116): the printed subject is "this
      // Pokémon", which for a note read off the board by a person has to become
      // "your Active Pokémon". Everything after it is the printed sentence, the
      // possessive on "your Bench" included.
      return "your Active Pokémon moved from your Bench to the Active Spot this turn";
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

/** §8.5 — the attacker's total pre-W/R damage bonus for a hit landing on the
    opponent's Active `defenderCard`: the unconditional Tool bonuses (Vitality
    Band) plus every board-conditional one (Defiance Band) whose condition holds
    for the ATTACKING `seat`, plus every target-conditional one (Choice Belt)
    whose printed suffix matches the defender. The two attack-damage read sites
    (attack.ts's main hit and `snipeActive` below) share this so both gates are
    evaluated ONCE, here, beside the single `conditionHolds`: continuous.ts
    aggregates the passives but is seat-free and defender-free — a BoardCondition
    is relative to whose board it reads, and a target suffix to who is being hit,
    both of which only these sites know. */
export function attackerPreWRBonus(
  state: GameState,
  pokemon: InPlayPokemon,
  seat: Seat,
  defenderCard: Card,
): number {
  const passives = passivesOf(state, pokemon);
  let bonus = passives.damageBonusBeforeWR;
  for (const { amount, cond } of passives.conditionalDamageBonusBeforeWR) {
    if (conditionHolds(state, seat, cond)) bonus += amount;
  }
  for (const { amount, targetSuffix } of passives.targetConditionalDamageBonusBeforeWR) {
    if (pokemonSuffixOf(defenderCard) === targetSuffix) bonus += amount;
  }
  return bonus;
}

/** A mandatory targeting op: no candidate = no-op, one = forced (auto-resolve),
    ≥2 = park on a choosePokemon prompt. */
function parkOrForce(
  state: GameState,
  candidates: PokemonRef[],
  apply: (ref: PokemonRef) => GameState,
  note: string,
): { done: GameState } | { park: EffectPrompt } {
  if (candidates.length === 0) return { done: state };
  if (candidates.length === 1) return { done: apply(candidates[0] as PokemonRef) };
  return { park: { kind: "choosePokemon", candidates, note } };
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
    case "searchDeck":
      return choice.kind === "cards" ? searchMove(state, choice.uids, op.dest, ctx, events) : state;
    case "discardPileRetrieval": {
      if (choice.kind !== "cards") return state;
      const retrieved = retrieveMove(state, choice.uids, op.dest, ctx, events);
      // What was RETRIEVED, not what was offered or picked: a wire-dropped uid
      // (one no longer in the discard) never moved, so Miriam's "if you
      // shuffled any cards into your deck in this way" must not count it.
      recordMoved(record, op.recordAs, retrieved.moved);
      return retrieved.state;
    }
    case "lookAtTopN":
      return choice.kind === "cards" ? revealFromTop(state, choice.uids, ctx, events) : state;
    case "payFromHand": {
      if (choice.kind !== "cards") return state;
      const paid = payFromHandApply(state, choice.uids, op, ctx, events);
      recordMoved(record, op.recordAs, paid.paid);
      return paid.state;
    }
    case "bottomFromOpponentHand": {
      if (choice.kind !== "cards") return state;
      const moved = bottomFromOpponentHandApply(state, choice.uids, ctx, events);
      // What actually MOVED, not what was picked — the retrieval/payment rule
      // (§9.2): a wire-dropped uid never left the hand, and Ortega's "if you
      // put a card on the bottom of your opponent's deck in this way" must not
      // count it. The reveal is NOT re-emitted here — it already rode the
      // action that parked.
      recordMoved(record, op.recordAs, moved.moved);
      return moved.state;
    }
    case "opponentMayDraw":
      // The drawer is the answerer — the controller's OPPONENT (the op's whole
      // point); a decline moves nothing and says nothing.
      return choice.kind === "mayDraw" && choice.draw
        ? drawToHand(state, otherSeat(ctx.seat), op.count, "effect", events)
        : state;
    case "optional":
      // THE ONE APPLY ARM THAT IS INTENTIONALLY EMPTY ON BOTH ANSWERS. A yes
      // buys the `then` branch, and a branch is spliced into the WORK QUEUE, which
      // this function cannot see — it returns a `GameState` and knows nothing of
      // `rest`. `resumeProgram` owns both halves (this call and the `runProgram`
      // that follows it) and does the splice there, exactly as `runProgram`'s
      // three gates `unshift` their own branches. So a decline is not "the empty
      // arm of the apply"; a decline is the ABSENCE of the splice, and both
      // answers pass through here identically.
      //
      // ⚠️ BEHAVIOURALLY EQUIVALENT TO DELETING IT — the `default` below already
      // returns the state — and kept anyway, because the default's REASON is
      // false about this op: it reads "synchronous ops never park, so never reach
      // the choice path", and `optional` parks on every board. An arm that states
      // the true thing beats one inherited for a wrong reason. Recorded as an
      // equivalent mutant rather than passed off as a tested line.
      return state;
    case "switchActive":
      return choice.kind === "pokemon" ? switchOwn(state, choice.ref, ctx, events) : state;
    case "gust":
      return choice.kind === "pokemon" ? gust(state, choice.ref, ctx, events) : state;
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
      return choice.kind === "pokemon"
        ? healChosen(state, choice.ref, op.amount, ctx, events)
        : state;
    case "moveCountersToDefender":
      // D138 — the parked half of the counter move. Same shape as `healChosen`'s
      // single-pick arm above and for the same reason: `validateChoice` matches
      // the answer against the PARKED prompt, so the wrong choice kind is the
      // wire belt rather than a case that can fire in a real match.
      return choice.kind === "pokemon"
        ? moveCountersToDefender(state, choice.ref, ctx, events)
        : state;
    case "damageChosen":
      // Recompute the (possibly Prize-scaled) amount from state: no KO has
      // happened between parking and this pick, so the count is unchanged — the
      // same value snipeNote quoted in the prompt.
      return choice.kind === "pokemonMulti"
        ? placeSnipe(
            state,
            choice.refs,
            snipeAmount(op, state, ctx),
            op.deals === true,
            op.ignoreWR === true,
            // D140 — the provenance rides the PARKED op, so the row a resumed
            // pick emits says the same thing an inline one would.
            op.source,
            ctx,
            events,
          )
        : state;
    case "attachEnergyFrom":
      return choice.kind === "pokemon"
        ? attachEnergyFrom(state, op, choice.ref, ctx, events)
        : state;
    case "attachFromTop":
      return choice.kind === "attachCards"
        ? attachFromTopApply(state, choice.assignments, op, ctx, events)
        : state;
    case "attachFromDeck": {
      if (choice.kind !== "attachCards") return state;
      const attached = attachFromDeckApply(state, choice.assignments, ctx, events);
      // What was ATTACHED, not what was offered or picked — the retrieval/payment
      // rule (§9.2): a uid the wire dropped, repeated, or aimed at a Pokémon that
      // is not there never moved, so Janine's "if you attached Energy to your
      // Active Pokémon in this way" must not count it.
      recordMoved(record, op.recordAs, attached.attached);
      return attached.state;
    }
    case "moveEnergy":
      return choice.kind === "moveEnergy"
        ? moveEnergyApply(state, choice.uids, choice.dest, ctx, events)
        : state;
    case "preventChosenAttack":
      // D157 — the parked half of the opponent-side per-attack lock. Same shape as
      // `healChosen`'s single-pick arm and for the same reason: `validateChoice`
      // matches the answer against the PARKED prompt, so the wrong choice kind is
      // the wire belt rather than a case that can fire in a real match.
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
    default:
      // Synchronous ops never park, so never reach the choice path.
      return state;
  }
}

// ── Op implementations ──

function applyStatus(
  state: GameState,
  op: Extract<EffectOp, { op: "applyStatus" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = op.target === "self" ? ctx.seat : otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // §11 (D142) — a §12 Special Condition is an EFFECT of the attack, so a body
  // carrying the wider block takes none. Checked on the RESOLVED seat rather
  // than on the "defender" arm, so it is total over both targets: the "self"
  // arm can never be refused in practice (a block is live only during its
  // holder's OPPONENT's turn, and the self arm runs on the holder's own), and
  // asking anyway costs one read and removes a case from the reasoning.
  if (attackEffectRefused(state, seat, ctx, events)) return state;
  // §12 (D172) — the target's printed IMMUNITY ("This Pokémon can't be Burned." /
  // "…can't be Paralyzed." / Therapeutic Energy sv02-193's "…can't be affected by
  // those Special Conditions"). Read through `passivesOf` and not off the catalog
  // row, which is the whole §9 answer in one call: the fold has already dropped a
  // locked holder's own printed passive and already kept every attached Tool's, so
  // a Klefki aura over Pachirisu lets the Paralysis land with nothing written here
  // to say so.
  //
  // ⚠️ NOT NECESSARILY THE BODY'S OWN, SINCE D174. `passivesOf` gained a THIRD
  // source class — the attached ENERGY — so this line now reads three source
  // classes with two different §9 verdicts (an Ability is suppressible, a Tool and
  // an Energy are not), and it took ZERO characters to do it. That is what riding
  // the fold buys: the whole cost of the family's third printing landed in
  // continuous.ts and registry.ts, and the gate that decides the rule did not move.
  // The RECOVERY half of that printing is not here at all and could not be — it is
  // about a condition that already landed, which no gate on the writer can see
  // (flow.ts `recoverStatuses`).
  //
  // ⚠️ PLACED AFTER `attackEffectRefused`, AND THE ORDER IS UNOBSERVABLE — SAID
  // RATHER THAN LEFT AS A COINCIDENCE. Both gates refuse the same op and produce
  // the same board; only the ROW differs. Reaching both at once would need a body
  // that carries an immunity AND has installed a §11 "prevent all … effects of
  // attacks" block on itself, and `preventDamage` only ever installs on the
  // ATTACKER's own Active (an attack ends the turn, §5.3) — neither immune
  // printing has such an attack, and no card can install one on another body. So
  // this sits behind the older, broader gate: when the whole attack has been
  // refused, the attack-level row is the true one, and the per-condition row would
  // be a second sentence about one refusal.
  //
  // ⚠️ AND IT IS ONE GATE FOR ALL THREE ARMS BELOW, ASKED ON `op.status` BEFORE
  // ANY OF THEM. Poison's `poisonDamage` and the rotation slot's overwrite are
  // both consequences of the condition landing; a gate written inside an arm would
  // be a fourth reading of "which condition is this" and would silently exempt
  // whichever arm nobody remembered to write it into.
  if (passivesOf(state, active).statusImmunities.includes(op.status)) {
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
  events.push({ type: "STATUS_APPLIED", seat, uid, status: op.status });
  return withActive(state, seat, {
    ...active,
    conditions: { ...active.conditions, rotation: op.status },
  });
}

/** §12 (D177) — the DISCRETE recovery. `applyStatus`'s exact inverse and its
    neighbour on purpose: same resolution to ONE Active, same `uid === undefined`
    early return, same STATUS_* row, opposite direction. Two printings reach it —
    Gardevoir ex's "Miracle Force" (an ATTACK, through the deriver) and Blissey's
    "Busybody Nurse" (an activated ABILITY, through the registry) — and both mean
    the CONTROLLER's own Active, which is why there is no `target` to resolve.

    ⚠️ IT CLEARS ITS TARGET DIRECTLY AND DOES **NOT** REUSE `recoverStatuses`
    (flow.ts). THIS WAS THE SLICE'S OPEN QUESTION AND IT WAS PRICED, NOT ASSUMED —
    three independent reasons, any one of which is sufficient:

      1. **THE DRIVER IS WRONG.** `recoverStatuses` is driven off
         `passivesOf(...).statusRecovery` — a CATALOG value contributed by a live
         continuous source. This op has no such source: its warrant is that it ran.
         Reusing the sweep would mean writing a synthetic passive onto the board so
         a function could read it back off, which is a continuous effect
         impersonating an instant one. Strip the `statusRecovery` read and there is
         no `recoverStatuses` left.
      2. **THE SCOPE IS WRONG.** That function is a TWO-SEAT board sweep restoring
         a board-wide invariant (*no in-play Pokémon carries a condition a live
         effect recovers it from*). This is one body, named by the printed subject,
         at one moment. A sweep would touch the opponent's Active as well — a no-op
         on today's catalog, and a rule this card does not print on tomorrow's.
      3. **THE SET IS WRONG.** Its per-condition filter (`recovers.includes`) is
         what makes sv02-193 wake a body and leave its Burn ticking. "All Special
         Conditions" has no such filter, so `noConditions()` is the whole clear —
         and passing an all-five list into a filter designed to narrow is a filter
         written to be inert.

    ⚠️ WHAT **IS** SHARED IS THE VOCABULARY, WHICH IS THE PART THAT MATTERED. Both
    halves announce `STATUS_CLEARED` with `reason: "recovered"` — the printed verb,
    one reading, one log arm (log.ts renders "X recovered from Y" for both), so a
    consumer cannot tell a continuous recovery from a discrete one by its ROW and
    does not need to: the card says "recovers" in both mouths. A second reason
    would have been a second rendering of the same word (D131).

    ⚠️ AND IT IS `noConditions()` RATHER THAN THREE FIELD WRITES, WHICH IS THE
    THIRD EXISTING SITE FOR THAT CALL AND NOT A FOURTH SPELLING. turn.ts's retreat
    and evolve clears are this same shape — `presentStatuses` for the row, the
    zero value for the board — because "all of them" is what all three sentences
    say. `recoverStatuses`'s three-arm loop exists precisely because ITS sentence
    does not.

    NO §11 GATE, and the absence is deliberate rather than forgotten.
    `attackEffectRefused` refuses effects done TO the body carrying a "prevent all
    damage from and effects of attacks" block; this op touches only the ATTACKER's
    own Active, which is never that body (a block is live during its holder's
    OPPONENT's turn). A gate here would ask the defender for permission to heal
    yourself.

    SILENT WHEN THERE IS NOTHING TO RECOVER FROM — no event, no board change, and
    NOT an `ATTACK_EFFECT_SKIPPED` (the sentence was read; it found nothing). That
    also makes it idempotent, so a program running it twice costs one scan. */
function clearStatus(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const cleared = presentStatuses(active.conditions);
  if (cleared.length === 0) return state;
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
function preventRetreat(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const seat = otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // §11 (D142) — the DEFENDER's own block refuses this rider, which is the
  // sharpest instance of the mirror: one durated block installed on the
  // defender, another installed on the attacker, and the second one refuses the
  // first. Checked BEFORE the idempotence early-return so a refusal is announced
  // even on an already locked body.
  if (attackEffectRefused(state, seat, ctx, events)) return state;
  if (active.retreatBlocked) return state;
  events.push({ type: "RETREAT_BLOCKED", seat, uid });
  return withActive(state, seat, { ...active, retreatBlocked: true });
}

/** §11/§15.B — INSTALL the printed damage block on the CONTROLLER's own Active
    ("During your opponent's next turn, prevent all damage [from and effects of]
    attacks done to this Pokémon.", 13 printings across two spellings, D142).
    "This Pokémon" is `ctx.seat`'s Active — the attacker, resolved exactly the way
    `healSelf` and `damageSelf` resolve their own printed "this Pokémon" — so the
    op carries no `target` and there is nothing to choose, hence no park.

    THE STAMP IS `state.turn + 1`, AND THAT ARITHMETIC IS THE WHOLE DURATION.
    Declaring an attack ENDS the turn (§5.3), so the turn after the installing one
    is by construction the opponent's; the block is therefore live for exactly the
    window the card prints, is NOT live for the remainder of the installing turn
    (the printed word is "next"), and is dead again on the holder's following turn
    with nobody having cleared it. The one place that arithmetic could go wrong is
    a caller that is not an attack — an Ability installing this mid-turn would
    stamp its own opponent's turn correctly too, but no such printing exists and
    the op is refused to the deriver's Ability path by not being derivable there.

    IDEMPOTENT: installing twice in one turn writes the same stamp, and the second
    row is suppressed only when the second install says nothing new — a NARROW
    block landing on top of a WIDE one must not silently downgrade it, so the two
    are merged by OR rather than overwritten. Reachable in principle (a card with
    two such attacks, or a re-install after a switch), unreachable in this pool.

    ⚠️ D146's `fromClass` MERGES ON THE SAME RULE READ ON THE OTHER AXIS. `effects`
    widens what is refused, so two installs OR it; `fromClass` NARROWS whose
    attacks are refused at all, so two installs keep the filter only when they
    AGREE, and any disagreement (including one side having no filter) collapses to
    the UNFILTERED block. Both rules say the same thing — a second installation
    may never leave the holder with less protection than one of them printed — and
    writing them as one comparison rather than one `||` is the only reason they
    look different. Unreachable in this pool for the same reason as above, and
    doubly so: no card prints two of these attacks, and the four filtered printings
    are one attack each. */
function preventDamage(
  state: GameState,
  effects: boolean,
  fromClass: AttackBlock["fromClass"],
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
    ? existing.fromClass === fromClass
      ? fromClass
      : undefined
    : fromClass;
  if (stacking && merged === existing.effects && mergedClass === existing.fromClass) return state;
  events.push({
    type: "ATTACK_BLOCK_APPLIED",
    seat: ctx.seat,
    uid,
    effects: merged,
    fromClass: mergedClass,
  });
  return withActive(state, ctx.seat, {
    ...active,
    attackBlock: { turn, effects: merged, fromClass: mergedClass },
  });
}

/** §8/§11 (D143, widened D148) — INSTALL the printed ATTACK LOCK on the Pokémon
    the sentence names: the CONTROLLER's own Active with `target` absent ("During
    your next turn, this Pokémon can't attack.", 22 printings across two
    sentences), the DEFENDING Pokémon with `target: "defender"` ("…the Defending
    Pokémon can't attack.", 4 printings across two more). `preventDamage`'s sibling
    one function up on the self arm and `preventRetreat`'s exact sibling on the
    defender arm — same holder resolution, same no-park, same idempotence.

    ⚠️ THE STAMP IS DERIVED FROM THE HOLDER, AND THAT IS WHY `target` IS ONE AXIS.
    There is exactly ONE rule here — *the window is the locked Pokémon's
    controller's NEXT turn* — and the two numbers this function can write are that
    rule evaluated on the two seats, because DECLARING AN ATTACK ENDS THE TURN
    (§5.3). The turn after the installing one belongs to the opponent, so the
    defender's next turn is `+ 1`; the one after THAT is the installer's own, so
    the self arm is `+ 2`. The printed wordings differ for the identical reason
    ("during YOUR next turn" / "during your OPPONENT's next turn"), which is the
    tell that they are one rule and not two. A build that shared one number would
    be wrong on one arm; a build that carried the number in the op would let a
    deriver write a window the printed subject contradicts.

    D143's warning survives on its own arm: `+ 1` on the SELF lock fails quietly in
    play rather than loudly, because a `+ 1` self-lock is live only on a turn its
    holder could not have acted on anyway and the card's whole printed drawback
    silently disappears. The mirror is just as quiet — `+ 2` on the DEFENDER arm
    would skip the printed window entirely and bite on a turn two later. Both are
    driven across real turn boundaries rather than asserted as arithmetic.

    ⚠️ THE DEFENDER ARM IS AN EFFECT OF AN ATTACK DONE TO THE DEFENDING POKÉMON,
    so a §11 block that refuses "effects of attacks" refuses THIS — `preventRetreat`'s
    check verbatim, and reachable off printed cards (the defender installs
    `{ effects: true }` on their turn, its window is the installer's very next
    turn, and that is the turn this lock would land on). Asked on the RESOLVED seat
    so the rule is TOTAL over both arms rather than written on one of them: the
    self arm can never be refused in practice (a block is live only during its
    holder's OPPONENT's turn, and the self arm runs on the holder's own), and
    asking anyway costs one read and removes a case from the reasoning — which is
    the call `applyStatus` already made for its own two arms.

    IDEMPOTENT, and on the self arm that is by construction rather than by care:
    installing needs an attack, an attack ends the turn, and a locked Pokémon
    cannot declare the attack that would re-install. The DEFENDER arm makes the
    question live for the first time — two installers can lock one body — and the
    answer is that a later stamp is never an EARLIER turn than the one it replaces:
    every install writes its holder's next turn measured from the install, and
    installs are ordered in time, so the sequence of stamps on any one body is
    monotone. That is also why a `Math.max` would be a merge rule with nothing to
    merge (contrast `reduceDamage`, whose two sources really can disagree). The
    early-return keeps a re-install that says nothing new SILENT — D142's
    idempotence answer, and the case is real here: a self-lock stamped `+ 2` and a
    defender-lock stamped `+ 1` from the opponent's following turn are the SAME
    number on the same body, so the second install emits no second row. */
function preventAttack(
  state: GameState,
  op: Extract<EffectOp, { op: "preventAttack" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = op.target === "defender" ? otherSeat(ctx.seat) : ctx.seat;
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // §11 (D142) — checked BEFORE the idempotence early-return so a refusal is
  // announced even on an already-locked body (`preventRetreat`'s ordering).
  if (attackEffectRefused(state, seat, ctx, events)) return state;
  // The one rule, on the one seat that matters: the locked body's controller's
  // next turn. `otherSeat(ctx.seat)` is the seat whose turn comes next (§5.3), so
  // the defender arm is `+ 1` and the installer's own is one full round later.
  const turn = state.turn + (op.target === "defender" ? 1 : 2);
  if (active.attackLockedTurn === turn) return state;
  events.push({ type: "ATTACK_LOCKED", seat, uid });
  return withActive(state, seat, { ...active, attackLockedTurn: turn });
}

/** §8/§8.5 (D154, shared D155) — the printed PROPER NOUN → the INDEX every read
    site in this engine speaks. `findIndex` over the holder's OWN printed attacks,
    so a sentence naming an attack the card does not have resolves to `-1` and its
    op writes nothing.

    ⚠️ BOTH SIDES ARE APOSTROPHE-FOLDED (D137's rule, D154's reach). The op's token
    was folded at the deriver; the card's `name` is folded here, because a
    punctuation-normalising re-ingest would rewrite BOTH the sentence and the
    attack row it names — Greedent ex sv03-179's "Slip 'n' Roll" is the printing
    that makes it visible — and folding one side only is the half-fix that reads
    like a whole one.

    ⚠️ IT IS A SHARED HELPER RATHER THAN TWO COPIES, AND THE GROUND IS THAT THE
    FOLD IS INVISIBLE WHEN MISSING. D154 measured exactly that: removing its
    install-side fold failed NOTHING until a card whose attack name carries U+2019
    was added to the pool (`fix-curly-barrer`). A second copy of these two lines
    would be a second place that can silently lose the fold, covered by no witness
    unless the next slice remembers to field a second curly card. One copy makes
    that one witness load-bearing for every op that resolves a printed attack name
    — today `preventAttackUse` (D154) and `boostAttack` (D155). */
function printedAttackIndex(printed: readonly Attack[], attack: string): number {
  return printed.findIndex((row) => foldApostrophes(row.name) === attack);
}

/** §8/§11 (D165) — ADD one per-attack bar to a body's list, or say that it adds
    nothing. THE ONE MERGE RULE for `InPlayPokemon.lockedAttacks`, shared by both
    of that field's writers — `preventAttackUse` (D154, self-side, `+ 2`) and
    `lockDefenderAttack` (D157, opponent-side, `+ 1`).

    ⚠️ IT IS A SHARED HELPER RATHER THAN TWO COPIES BECAUSE TWO COPIES ARE THE
    DEFECT IT EXISTS TO FIX. Both writers previously did the same bare overwrite,
    each guarded by the same same-turn-same-index early return, and each was
    correct about ITSELF: a self-side re-install always stamps a later turn, and
    §5.3 forbids a second declaration inside one turn. Neither asked what the
    OTHER one stamps. `+ 2` from turn 3 and `+ 1` from turn 4 are both 5, so the
    later write silently deleted a live bar and the §8 gate let a Skarmory use the
    "Slashing Steel" its own card bars. One function means the question "what
    happens when this lands on a live record" has exactly one answer and exactly
    one place a mutation can reach it.

    THREE RULES, AND EACH IS DRIVEN (`lockedAttackMerge.test.ts`):
      • IDEMPOTENT on the pair — the same `turn` AND the same `attackIndex` adds
        nothing and returns `null`, so the caller suppresses its row (D142's
        idempotence answer, both writers' early return preserved verbatim);
      • ADDITIVE on a DIFFERING index — the entry is APPENDED and no live entry is
        touched, which is the whole of D165. A differing index for a DIFFERENT
        turn is likewise appended rather than replacing: it names a window the
        body has not reached, and dropping it would be the same deletion one turn
        further out;
      • PRUNED on the PAST — entries whose `turn` is strictly behind `now` can
        never answer again (the turn counter only rises), so they are dropped on
        every write. That is what keeps the list bounded by the number of bars
        stamped for turns not yet played, rather than by the length of the match.
        It is a garbage rule and NOT an expiry rule: expiry is the reader's turn
        comparison (`lockedAttackIndexes`), which is what makes a bar stop biting.

    ⚠️ AND THE PRUNE'S `>=` IS THE ONE CHARACTER THIS FUNCTION'S BOUNDARY TURNS ON
    — D166's finding, and the reason D165 shipped with an unfinished verification.
    An entry stamped for `now` is LIVE right now, so `> now` would DELETE A BAR THAT
    IS STILL BITING: D165's own defect relocated out of the merge rule and into the
    garbage rule. D165's mutation pass was interrupted exactly here; re-run at D166
    it produced FIVE survivors rather than the two recorded, all of them the same
    off-by-one (`> now`, `>= now + 1`, `>= turn`, and either writer passing `turn`
    rather than `state.turn` as `now`). All five are now witnessed and the boundary
    is pinned from BOTH sides (`>= now - 1`, which keeps one dead turn, fails too).

    THE TWO WRITERS DO NOT REACH THE EQUAL CASE ALIKE, AND THE ARGUMENT IS PARITY.
    Both stamp the HOLDER's own next turn, so every entry on a body carries that
    seat's turn parity. `preventAttackUse` writes on its OWN Active during its own
    turn, so `lock.turn === now` is REACHABLE — an opponent-imposed bar live this
    turn, plus this turn's own self-install — and is driven as a PLAYED LINE.
    `lockDefenderAttack` writes on the OPPONENT's Active during the actor's turn, so
    `now` is never one of the victim's turns and the equal case is UNREACHABLE by
    parity; it is driven by SURGERY instead, said rather than skipped, because this
    is ONE function with ONE contract and the parity it leans on is a property of
    today's two writers rather than of the shape (`lockedAttackMerge.test.ts`).

    Returns the NEW list, or `null` when the write is a no-op. `null` rather than
    the old array by identity, because "nothing changed" is a fact the caller acts
    on (it suppresses an `ATTACK_LOCKED` row) and a reference comparison would
    make that fact depend on whether the prune happened to allocate. */
function addLockedAttack(
  existing: readonly LockedAttack[],
  now: number,
  turn: number,
  attackIndex: number,
): LockedAttack[] | null {
  if (existing.some((lock) => lock.turn === turn && lock.attackIndex === attackIndex)) return null;
  return [...existing.filter((lock) => lock.turn >= now), { turn, attackIndex }];
}

/** §8/§11 (D154) — BAR ONE NAMED ATTACK on the controller's own Active ("During
    your next turn, this Pokémon can't use {AttackName}.", 6 catalogued printings
    across 4 names plus 1 fielded uncatalogued printing). `preventAttack`'s
    sibling one function up, and written beneath it so the pair reads as one
    design:

    | | `preventAttack` (D143/D148) | this (D154) |
    |---|---|---|
    | Holder | `ctx.seat`'s Active, or the defender's | `ctx.seat`'s Active |
    | Stamp  | `+ 2` self / `+ 1` defender            | `+ 2`               |
    | State  | `attackLockedTurn: number`             | `lockedAttack: { turn, attackIndex }` |
    | Gate   | the whole DECLARATION                  | ONE index of it     |

    ⚠️ THE PRINTED NAME IS RESOLVED HERE, AND THIS IS THE ONLY SITE THAT KNOWS IT.
    The deriver captures a PROPER NOUN because that is what the sentence contains;
    every consumer of the record addresses attacks by INDEX (attack.ts's §8 gate
    compares `action.index`, and both payability projections map over
    `attacksOf(card)`). So the lookup happens once, at the install, against the
    HOLDER's own stack-top card — the same call D152's deriver made converting
    counters to HP, in the same direction: translate at the site that owns the
    printed token, so nothing downstream has to know a sentence named anything.

    ⚠️ A NAME THAT MATCHES NOTHING INSTALLS NOTHING, AND SILENTLY. Unreachable off
    every printing in the pool — all six name their own attack — so it is a
    CONSTRUCTED case and it is pinned as one. The alternative (stamping an index
    of −1, or the printed name itself) would put a value into a persisted record
    that no read site can act on, and the alternative to THAT (emitting a row
    anyway) would tell a player about a drawback that cannot bite. A lock on an
    attack the card does not have is inert; the honest representation of inert is
    absence (D140/D146: a gate that declines emits nothing).

    ⚠️ NO `attackEffectRefused` CHECK, AND THAT IS `reduceDamage`'s AND
    `installRecoil`'s VERDICT AND NOT AN OMISSION. The record lands on the ACTOR's
    own Active, so there is no opponent-side body a §11 "prevent all effects of
    attacks done to this Pokémon" could be protecting from it. The §11
    classification table (preventBlock.test.ts) carries the verdict AND a board
    that drives it, which is D150's rule.

    IDEMPOTENT, and here that is by construction exactly as D143's self arm was:
    installing needs an attack, an attack ends the turn, and the window is the
    holder's own next turn — on which the only attack that could re-install is the
    very one this record bars. So a second install of THIS op can never land on a
    live record of THIS op, and `addLockedAttack`'s early return covers the
    constructed case (same turn AND same index → silent, D142's idempotence
    answer).

    ⚠️ AND THE SENTENCE THAT USED TO END THAT PARAGRAPH — *"a differing index
    simply overwrites, because a later install always stamps a later turn"* — WAS
    THE DEFECT D165 FIXED. It is true of this op about itself and false about the
    field, which `lockDefenderAttack` also writes with a `+ 1` stamp: from the
    turn after this one those two land on the SAME number, and the overwrite
    deleted a live bar. The merge is now `addLockedAttack`'s and is APPENDING. */
function preventAttackUse(
  state: GameState,
  attack: string,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  const card = topCardOf(state, active);
  if (uid === undefined || card === undefined) return state;
  const printed = attacksOf(card);
  const attackIndex = printedAttackIndex(printed, attack);
  if (attackIndex < 0) return state;
  // The one rule, D143's: the window is the holder's own next turn, and declaring
  // an attack ENDS the turn (§5.3), so the turn after this one is the opponent's
  // and the one after THAT is the holder's.
  const turn = state.turn + 2;
  const locks = addLockedAttack(active.lockedAttacks, state.turn, turn, attackIndex);
  if (locks === null) return state;
  // The RESOLVED row's own name and not the op's token: the two differ only in
  // punctuation (the op's is folded, the card's is as printed), and a log row is
  // read by a player holding the card — so it prints the card's spelling.
  events.push({
    type: "ATTACK_LOCKED",
    seat: ctx.seat,
    uid,
    attack: printed[attackIndex]?.name ?? attack,
  });
  return withActive(state, ctx.seat, { ...active, lockedAttacks: locks });
}

/** §8.5/§11 (D155) — BUY ONE NAMED ATTACK a durated pre-W/R DAMAGE BONUS on the
    controller's own Active ("During your next turn, this Pokémon's {AttackName}
    attack does {N} more damage (before applying Weakness and Resistance).", 1
    printing — Seismitoad sv03-052 "Echoed Voice"). `preventAttackUse`'s OPPOSITE
    VERB AT THE SAME ADDRESS, and written directly beneath it so the pair reads as
    one design:

    | | `preventAttackUse` (D154) | this (D155) |
    |---|---|---|
    | Holder | `ctx.seat`'s Active     | `ctx.seat`'s Active |
    | Stamp  | `state.turn + 2`        | `state.turn + 2`    |
    | State  | `lockedAttack: { turn, attackIndex }` | `boostedAttack: { turn, attackIndex, amount }` |
    | Read at| the §8 gate (REFUSES it)| §8.5's pre-W/R step (PAYS it) |

    ⚠️ THE TWO RECORDS ARE A KEY APART AND ARE STILL TWO FIELDS, AND THIS TABLE'S
    LAST ROW IS THE WHOLE REASON. D131's widen-don't-add test passes on the SHAPE
    here — strip `amount` and you have D154's record byte for byte — which is the
    first time in this family it has, so the refusal has to be made on the READ.
    `lockedAttackIndex`'s consumer refuses the declaration whose index it returns;
    this one's pays it a bonus. One field would hand the §8 gate the index of the
    attack the card just bought, and a Seismitoad that spent a turn on +100 could
    not then declare "Echoed Voice". Driven on one board rather than argued
    (perAttackBuff.test.ts), which is what this repo asks of a design answer.

    ⚠️ THE PRINTED NAME IS RESOLVED HERE BY `preventAttackUse`'s OWN HELPER, and
    sharing it is the point rather than a tidy-up: the apostrophe fold it carries is
    invisible when missing (D154 measured that), so one copy makes that slice's one
    curly-named witness load-bearing for both ops. A name matching nothing on the
    holder installs NOTHING and emits no row — a bonus on an attack the card does
    not have is inert, and announcing it would tell a player about a payoff that
    cannot arrive (D140/D146: a gate that declines emits nothing).

    ⚠️ NO `attackEffectRefused` CHECK, for `reduceDamage`'s, `installRecoil`'s and
    `preventAttackUse`'s verdict verbatim: the record lands on the ACTOR's own
    Active, so there is no opponent-side body a §11 "prevent all effects of attacks
    done to this Pokémon" could be protecting from it. The §11 classification table
    (preventBlock.test.ts) carries the verdict AND a board that drives it (D150).

    IDEMPOTENT BY `Math.max` ON THE AMOUNT, WHICH IS `reduceDamage`'s RULE AND NOT
    `preventAttackUse`'s EARLY RETURN — because this record carries a number and
    that one does not. The rule both are instances of is *a second installation may
    never leave the holder with less than one of them printed*: for an address that
    is "the later write wins", for a number that is MAX. The merge is per-ADDRESS,
    so a second install naming a DIFFERENT attack replaces the record outright
    rather than keeping the larger of two unrelated bonuses — the amount is a
    property of the pair, not of the body. Unreachable off the one printing (an
    attack ends the turn, and the window is the holder's own next turn), so it is
    constructed and pinned; the row is suppressed when the merge says nothing new
    (D142's idempotence answer). */
function boostAttack(
  state: GameState,
  attack: string,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  const card = topCardOf(state, active);
  if (uid === undefined || card === undefined) return state;
  const printed = attacksOf(card);
  const attackIndex = printedAttackIndex(printed, attack);
  if (attackIndex < 0) return state;
  // The one rule, D143's and D154's: the window is the holder's own next turn, and
  // declaring an attack ENDS the turn (§5.3), so the turn after this one is the
  // opponent's and the one after THAT is the holder's.
  const turn = state.turn + 2;
  const existing = active.boostedAttack;
  const stacking =
    existing !== null && existing.turn === turn && existing.attackIndex === attackIndex;
  const merged = stacking ? Math.max(existing.amount, amount) : amount;
  if (stacking && merged === existing.amount) return state;
  // The RESOLVED row's own name and not the op's token (`preventAttackUse`'s
  // call): the two differ only in punctuation, and a log row is read by a player
  // holding the card, so it prints the card's spelling.
  events.push({
    type: "ATTACK_BOOSTED",
    seat: ctx.seat,
    uid,
    attack: printed[attackIndex]?.name ?? attack,
    amount: merged,
  });
  return withActive(state, ctx.seat, {
    ...active,
    boostedAttack: { turn, attackIndex, amount: merged },
  });
}

/** §8/§11 (D157) — BAR ONE CHOSEN ATTACK on the OPPONENT's Active ("Choose 1 of
    your opponent's Active Pokémon's attacks. During your opponent's next turn,
    that Pokémon can't use that attack.", 2 printings — Medicham sv01-111
    "Acu-Punch-Ture", Oranguru sv02-094 "Plotter's Command"). `preventAttackUse`'s
    twin two functions up, and written beneath the pair so all three read as one
    design:

    | | `preventAttackUse` (D154) | `boostAttack` (D155) | this (D157) |
    |---|---|---|---|
    | Holder  | `ctx.seat`'s Active | `ctx.seat`'s Active | the DEFENDER   |
    | Address | printed NOUN        | printed NOUN        | a PARK         |
    | Stamp   | `+ 2`               | `+ 2`               | `+ 1`          |
    | Field   | `lockedAttack`      | `boostedAttack`     | `lockedAttack` |
    | §11     | `untouched`         | `untouched`         | **`blocked`**  |

    ⚠️ THE FIELD IS SHARED AND THE OP IS NOT, WHICH IS D148's ANSWER AND D155's
    ANSWER RUN AT THE SAME TIME. D148 gave `preventAttack` a `target` because "on
    which turn may this body not attack" is ONE question about ONE body; the same
    argument reaches the address unchanged — `lockedAttackIndex` is the ONLY reader
    of `lockedAttack`, and it REFUSES the index it returns whichever op wrote it,
    so the §8 gate, both payability projections and all four §10 clears take ZERO
    diff. D155 refused to merge `boostedAttack` into that record on exactly this
    axis and reached the opposite answer, because ITS consumer PAYS the index the
    other refuses. Same test, two results, decided by the read site both times.

    ⚠️ AND IT IS `blocked` BY §11, WHERE ITS TWO SIBLINGS ARE `untouched` — the
    first op in the per-attack family that a wide block stops. Those write onto the
    CONTROLLER's own Active, so there is no opponent-side body a "prevent all
    effects of attacks done to this Pokémon" could be protecting from them; this
    one writes onto the DEFENDING Pokémon, which is squarely an effect of an attack
    done to it — `preventRetreat`'s, `weakenDefenderAttacks`'s and D148's
    `preventAttack { target: "defender" }`'s verdict verbatim. The refusal is taken
    IN FRONT OF the candidate scan, `discardEnergy`'s placement and for its reason:
    a shielded defender must never reach the prompt, because asking a player to
    pick an attack that will not be barred is worse than not asking.

    THE STAMP IS `state.turn + 1` — D142/D148's number. One rule (the window is
    the LOCKED Pokémon's controller's next turn) on the other seat: declaring an
    attack ENDS the turn (§5.3), so the turn after this one belongs to the victim.

    ⚠️ THE ENDINGS ARE `parkOrForce`'s THREE, ON A CANDIDATE SET THAT IS NOT A
    LIST OF POKÉMON — which is why they are spelled here rather than routed
    through that helper. No Active, or an Active whose card cannot be resolved, or
    an Active with NO printed attacks (fix-titan is one, and so is any body the
    catalog gives no `attacks_json`): a silent no-op, because a lock on a Pokémon
    with nothing to lock is inert and the honest representation of inert is absence
    (D140/D146 — a gate that declines emits nothing). EXACTLY ONE printed attack:
    forced, applied inline with no prompt (the M1 doctrine — a choice with no
    choice in it is not a choice), and this is the board on which this op and
    D148's whole-Pokémon lock become observationally identical. Two or more: park.
    **All three are reachable off the two printings** — a one-attack defender is an
    ordinary board — so none of them is a constructed case. */
function preventChosenAttack(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): { done: GameState } | { park: EffectPrompt } {
  const victim = otherSeat(ctx.seat);
  // §11 (D142) — in FRONT of the candidate scan, `discardEnergy`'s placement.
  if (attackEffectRefused(state, victim, ctx, events)) return { done: state };
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

/** Apply the chosen (or forced) index: the durated bar written onto the
    OPPONENT's Active. Shared by the inline one-attack path and the resolved park,
    so a forced pick and an answered one are byte-identical — `parkOrForce`'s
    contract, restated for a candidate set that is not a list of Pokémon.

    ⚠️ THE INDEX IS RE-VALIDATED AGAINST THE LIVE BOARD, WHICH THE POKÉMON PROMPTS
    DO NOT HAVE TO DO. A `PokemonRef` answer is checked against the prompt AND
    resolved against the board on the way in; an index is a plain number, and the
    board it indexes could in principle have moved between the park and the answer
    (nothing in this engine promotes or evolves the DEFENDER mid-attack-tail, so it
    is unreachable today — said rather than assumed). A stale index writes nothing
    and emits no row, `printedAttackIndex`'s no-match contract verbatim.

    IDEMPOTENT by `addLockedAttack`'s EARLY RETURN rather than by `boostAttack`'s
    `Math.max`, because this record carries an address and no number: same turn AND
    same index is silent. Unlike its self-side twin the re-install is REACHABLE in
    principle — two of the controller's own attacks could both bar the defender on
    the same turn only if one attack declared twice, which §5.3 forbids — so it is
    pinned as a constructed case.

    ⚠️ A DIFFERING INDEX **APPENDS** SINCE D165, AND THAT IS THE FIX. This op and
    `preventAttackUse` are the field's TWO writers, they stamp `+ 1` and `+ 2`,
    and from adjacent turns those are the SAME turn — so the bare overwrite this
    line used to do deleted the victim's own live self-installed bar and handed
    them back an attack their card forbids. The merge rule is `addLockedAttack`'s
    and it is shared with that op, so the collision has one answer written once. */
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
  // The one rule, D142/D148's: the window is the LOCKED Pokémon's controller's
  // next turn, and declaring an attack ENDS the turn (§5.3), so the turn after
  // this one is the victim's.
  const turn = state.turn + 1;
  const locks = addLockedAttack(active.lockedAttacks, state.turn, turn, attackIndex);
  if (locks === null) return state;
  // `seat` owns the BARRED Pokémon (D136's finding 1) — the ACTOR'S OPPONENT here,
  // which makes this the first ATTACK_LOCKED row that is victim-side AND carries
  // the `attack` narrowing. The wording needs no new arm and that was READ rather
  // than assumed: "next turn" means the NAMED player's own next turn under this
  // family's seat rule, and the named player is the victim, whose next turn is
  // exactly the window this stamp encodes.
  events.push({ type: "ATTACK_LOCKED", seat: victim, uid, attack: row.name });
  return withActive(state, victim, { ...active, lockedAttacks: locks });
}

/** §8.5/§11 (D147) — INSTALL the printed DAMAGE REDUCTION on the CONTROLLER's own
    Active ("During your opponent's next turn, this Pokémon takes {N} less damage
    from attacks (after applying Weakness and Resistance).", 14 printings across
    two sentences and four amounts). `preventDamage`'s neighbour two functions up,
    and written beside it on purpose: same holder resolution ("this Pokémon" is
    `ctx.seat`'s Active, the attacker), same absence of a `target` field, same
    no-park, same `state.turn + 1` stamp, same idempotence question.

    THE STAMP IS `state.turn + 1` FOR `preventDamage`'s REASON VERBATIM — the
    sentence prints "during your OPPONENT's next turn", declaring an attack ENDS
    the turn (§5.3), so the turn after the installing one is the opponent's by
    construction. It is the same NUMBER `attackBlock.turn` carries, which is why
    the two windows can be driven apart only by what they DO, never by when.

    ⚠️ IDEMPOTENT BY `Math.max`, WHICH IS D142's `||` WITH THE BOOLEAN REPLACED BY
    A NUMBER — and the alternative is written down rather than left implicit. The
    rule both are instances of is *a second installation may never leave the holder
    with less protection than one of them printed*: for a flag that is OR, for a
    number that is MAX. A SUM would be the other reading — two continuous effects
    from two sources do stack, which is exactly why `passivesOf` sums a printed
    passive with an attached Tool — but this field holds ONE installation with ONE
    window, so summing would make the stored number depend on how many times the
    record was written rather than on what was printed. Unreachable off any
    printing (one attack per turn, and no card prints two of these), so it is
    constructed and pinned; the day a printing installs this on the DEFENDER, the
    field becomes a list and the sum becomes the live question.

    The row is suppressed when the merge says nothing new, exactly as
    `preventDamage`'s is: announcing a re-install that changed no number would be
    announcing a non-event (D140/D146). */
function reduceDamage(
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
  const existing = active.damageReduction;
  const stacking = existing !== null && existing.turn === turn;
  const merged = stacking ? Math.max(existing.amount, amount) : amount;
  if (stacking && merged === existing.amount) return state;
  events.push({ type: "DAMAGE_REDUCTION_APPLIED", seat: ctx.seat, uid, amount: merged });
  return withActive(state, ctx.seat, { ...active, damageReduction: { turn, amount: merged } });
}

/** §8.5/§11 (D149) — INSTALL the printed ATTACK-DAMAGE DEBUFF on the DEFENDING
    Pokémon ("During your opponent's next turn, the Defending Pokémon's attacks do
    {N} less damage (before applying Weakness and Resistance).", 5 printings across
    two sentences and three amounts). `reduceDamage`'s MIRROR ON BOTH AXES AT
    ONCE, and written directly beneath it so the pair reads as one design:

    | | `reduceDamage` (D147) | this (D149) |
    |---|---|---|
    | Holder   | `ctx.seat`'s Active         | `otherSeat(ctx.seat)`'s Active |
    | Stamp    | `state.turn + 1`            | `state.turn + 1`               |
    | Read at  | the DEFENDER's step, after W/R | the ATTACKER's step, before W/R |
    | Refusable by a §11 block | no (own body) | **YES** (the opponent's body)  |

    THE STAMP IS `state.turn + 1`, AND HERE THE ARITHMETIC AND THE HOLDER COME
    FROM TWO DIFFERENT PRECEDENTS. The printed words are "during your OPPONENT's
    next turn" and declaring an attack ENDS the turn (§5.3), so the turn after the
    installing one is the opponent's — D142's number verbatim. But the body is the
    OPPONENT's, which is D148's `target: "defender"` arm. The two agree here for
    the reason D148 wrote down: the window is always the HOLDER's controller's
    next turn, and on this op the holder is the opponent, so `+ 1` is that one
    rule and not a coincidence. (Contrast `preventAttack`'s self arm, where the
    same rule reads `+ 2`.)

    ⚠️ IT IS AN EFFECT OF AN ATTACK DONE TO THE DEFENDING POKÉMON, so a live §11
    block refuses it — `preventRetreat`'s and D148's `preventAttack` check
    verbatim, asked on the DEFENDER's seat because that is the body being written
    to. Reachable off printed cards rather than constructed: the defender installs
    a wide block on their own turn, its window is the installer's very next turn,
    and that is the turn this debuff would land on. The refusal is announced
    BEFORE the idempotence early-return, so an already-debuffed body still reports
    it (`preventRetreat`'s ordering).

    ⚠️ IDEMPOTENT BY `Math.max`, WHICH IS `reduceDamage`'s RULE READ FROM THE
    OTHER SEAT — *a second installation may never leave the INSTALLING side with
    less than one of them printed*, so for a number that is MAX. A SUM would be
    the other reading and is refused for the same reason: this field holds ONE
    installation with ONE window, so summing would make the stored number depend
    on how many times the record was written rather than on what was printed.
    Unreachable off any printing (one attack per turn, and the two installs would
    have to land on the same turn), so it is constructed and pinned. The row is
    suppressed when the merge says nothing new (D142's idempotence answer). */
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
  // §11 (D142) — checked BEFORE the idempotence early-return, `preventRetreat`'s
  // ordering, so a refusal is announced even on an already-debuffed body.
  if (attackEffectRefused(state, seat, ctx, events)) return state;
  const turn = state.turn + 1;
  const existing = active.attackDamageDebuff;
  const stacking = existing !== null && existing.turn === turn;
  const merged = stacking ? Math.max(existing.amount, amount) : amount;
  if (stacking && merged === existing.amount) return state;
  events.push({ type: "ATTACK_DEBUFF_APPLIED", seat, uid, amount: merged });
  return withActive(state, seat, { ...active, attackDamageDebuff: { turn, amount: merged } });
}

/** §9/§11 (D152) — ARM the printed REACTIVE RECOIL on the CONTROLLER's own Active
    ("During your opponent's next turn, if this Pokémon is damaged by an attack
    (even if it is Knocked Out), put 10 damage counters on the Attacking Pokémon.",
    2 printings of one sentence — Lycanroc ex sv02-117/-241 "Scary Fangs").

    `reduceDamage`'s SIBLING rather than `weakenDefenderAttacks`'s mirror, and
    written beneath the pair on purpose so all three read as one design:

    | | `reduceDamage` (D147) | `weakenDefenderAttacks` (D149) | this (D152) |
    |---|---|---|---|
    | Holder  | `ctx.seat`'s Active | `otherSeat(ctx.seat)`'s Active | `ctx.seat`'s Active |
    | Stamp   | `state.turn + 1`    | `state.turn + 1`               | `state.turn + 1`    |
    | Read at | §8.5, subtracted    | §8.5, subtracted               | §9, ADDED           |
    | §11-refusable | no (own body) | **YES** (opponent's body)      | no (own body)       |

    THE STAMP IS `state.turn + 1` FOR `reduceDamage`'s REASON VERBATIM — the
    sentence prints "during your OPPONENT's next turn", declaring an attack ENDS
    the turn (§5.3), so the turn after the installing one is the opponent's by
    construction. It is the same NUMBER `attackBlock.turn` and `damageReduction.turn`
    carry, which is why these windows can be driven apart only by what they DO.

    ⚠️ NO `attackEffectRefused` CHECK, AND THAT IS `reduceDamage`'s VERDICT AND NOT
    AN OMISSION. The record lands on the ACTOR's own Active, so there is no
    opponent-side body a §11 "prevent all effects of attacks done to this Pokémon"
    could be protecting from it. The §11 classification table (preventBlock.test.ts)
    carries the verdict AND a board that drives it, which is D150's rule: a slice
    that teaches the deriver a new op owes both.

    ⚠️ IDEMPOTENT BY `Math.max`, WHICH IS `reduceDamage`'s RULE ON ITS OWN SEAT —
    *a second installation may never leave the holder with less than one of them
    printed*, so for a number that is MAX. A SUM would be the other reading and is
    refused for the same reason: this field holds ONE installation with ONE window,
    so summing would make the stored number depend on how many times the record was
    written rather than on what was printed. (Note the CONTRAST one file over: the
    §9 read site really does SUM this stamp with `passivesOf`'s catalog fold,
    because those are two different card effects from two different sources. One
    field, one installation, MAX; two sources, SUM.) Unreachable off any printing
    (one attack per turn, and no card prints two of these), so it is constructed
    and pinned. The row is suppressed when the merge says nothing new, exactly as
    the two above (D140/D142/D146). */
function installRecoil(
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
  const existing = active.installedRecoil;
  const stacking = existing !== null && existing.turn === turn;
  const merged = stacking ? Math.max(existing.amount, amount) : amount;
  if (stacking && merged === existing.amount) return state;
  events.push({ type: "RECOIL_ARMED", seat: ctx.seat, uid, amount: merged });
  return withActive(state, ctx.seat, { ...active, installedRecoil: { turn, amount: merged } });
}

/** §11 (D142) — is an ATTACK's effect aimed at `seat`'s Active refused by that
    Pokémon's own live block, and has the refusal been announced? The ONE gate
    every defender-relative effect op consults, so the reading is written once.

    BOTH HALVES ARE REQUIRED, and neither is redundant:
      • `ctx.invokedBy === "attack"` — the block covers "effects of ATTACKS", and
        the opponent may well play a Trainer or use an Ability during the very
        turn the window is open. Crushing Hammer discarding an Energy and Boss's
        Orders dragging a body up are not attacks and are not refused.
      • `attackBlockOf(...)?.effects` — the LIVE block, and the wider of the two
        printed spellings. The narrow one ("prevent all damage done to this
        Pokémon by attacks") stops damage and nothing else, so a Poison, a retreat
        lock or a placed damage COUNTER all land on a body carrying it. That is
        the printed difference and it is the slice's sharpest observable claim.

    A refusal is LOUD: one ATTACK_EFFECT_PREVENTED row per refused op, because the
    alternative is an attack clause that silently does nothing, which reads to a
    player exactly like a bug. */
/** §11/§8.5 (D142) — is ATTACK DAMAGE aimed at `pokemon` refused by its own live
    block? `attackEffectRefused`'s silent twin, and the difference between them is
    the whole of the two printed spellings: BOTH block damage, so this one does
    not read `effects`, and it announces nothing because `DAMAGE_DEALT` already
    carries `prevented: true` for it.

    It takes the POKÉMON rather than a seat because the three interpreter damage
    sites are per-target (a spread hits five bodies), and it is applied at all
    three plus `attack.ts`'s main hit for the reason Mimikyu "Safeguard" is: the
    sites must be TOTAL rather than case-covering. A block can in fact only ever
    be live on an ACTIVE — installing it needs an attack, and leaving the Active
    Spot ends it (turn.ts `clearOnLeavingActive`, interpreter `switchInto`) — so
    the Bench-target arms are unreachable by construction and are guarded anyway,
    which costs one read and removes a standing assumption.

    It takes the ATTACKING CARD too, since D146: a block may be narrowed to
    attacks "from Basic Pokémon", and `attackBlockOf` resolves that against the
    attacker rather than answering it here (continuous.ts). Every caller already
    had the card in hand for Mimikyu "Safeguard" on the very next line, which is
    why the two auras still sit on one `||` at all four sites. */
function attackDamageBlocked(
  state: GameState,
  pokemon: InPlayPokemon,
  attacker: Card | undefined,
  ctx: EffectContext,
): boolean {
  return ctx.invokedBy === "attack" && attackBlockOf(state, pokemon, attacker) !== null;
}

function attackEffectRefused(
  state: GameState,
  seat: Seat,
  ctx: EffectContext,
  events: GameEvent[],
): boolean {
  if (ctx.invokedBy !== "attack") return false;
  const target = state.players[seat].active;
  if (target === null) return false;
  // The ATTACKER is `ctx.seat`'s Active by construction — `invokedBy === "attack"`
  // is set by the one `runProgram` call `attack.ts` makes, and an attack comes
  // from the Active Spot (§8). Resolved HERE rather than passed in because the
  // six ops that consult this gate have no reason to know who is attacking; the
  // gate does, and it is the whole point of the gate being one function.
  //
  // ⚠️ UNREACHABLE FROM ANY PRINTING, GUARDED ANYWAY — the Bench-arm argument
  // above, applied to the other axis. The three `fromClass` printings are all the
  // NARROW spelling (no "from and effects of"), so a block that carries a filter
  // never has `effects: true` and this line can only ever see an unfiltered
  // block off a real card. Ignoring the filter here would make `fromClass` mean
  // one thing at four sites and another at the fifth, which is exactly the drift
  // the single-read contract exists to stop; a constructed program pins it.
  const attacker = activeTop(state, ctx.seat)?.card;
  if (attackBlockOf(state, target, attacker)?.effects !== true) return false;
  const uid = topUid(target);
  if (uid === undefined) return false;
  events.push({ type: "ATTACK_EFFECT_PREVENTED", seat, uid });
  return true;
}

/** Spread damage: place `amount` HP on EACH of the opponent's Benched Pokémon
    (§8.5 — Weakness/Resistance never apply on the Bench, so it is flat there).
    A benched Pokémon's own continuous damage REDUCTION still applies though
    (Bouffalant "Bouffer" / a defending Tool — the passive that is not
    Active-only), floored at 0; the attacker's pre-W/R bonus (Vitality Band) is
    Active-target-only and does NOT reach the Bench. One DAMAGE_DEALT per benched
    Pokémon (seat/uid name the DEFENDER, as everywhere). Only raises damage — the
    KO check runs in attack.ts's epilogue, so this never KOs or ends the game
    (interpreter header). */
function spreadDamage(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  const opponent = otherSeat(ctx.seat);
  const side = state.players[opponent];
  if (side.bench.length === 0) return state;
  // Mimikyu "Safeguard" prevents spread damage too (no "Active Spot" clause) when
  // the attacker is an ex/V — the same gate the main hit runs.
  const attackerTop = activeTop(state, ctx.seat);
  const attackerCard = attackerTop?.card;
  // D149 — the pre-W/R DEBUFF on the ATTACKER reaches the Bench, where the
  // attacker's pre-W/R BONUS deliberately does not, and the printed text is the
  // whole reason: every pre-W/R printing in the pool that ADDS damage scopes
  // itself "to your opponent's Active Pokémon" (Vitality Band, Defiance Band,
  // Choice Belt, Practice Studio, Binding Mochi, Kingambit, …) and NEITHER
  // sentence that SUBTRACTS carries an Active clause at all. So "the Defending
  // Pokémon's attacks do 20 less damage" comes off every damage the attack does.
  // Hoisted out of the loop: it is a fact about the ATTACKER, identical for every
  // benched target.
  //
  // D151 — the ALWAYS-ON half (Entei "Pressure") is summed in, and it reaches the
  // Bench for the SAME reason: its sentence scopes the attacker ("attacks used by
  // your opponent's Active Pokémon") and says nothing at all about the target. The
  // aura's own two Active clauses are about the two ACTIVE bodies, not about who
  // gets hit — so a spread that splashes the Bench is weakened whole.
  const attackerDebuff =
    attackerTop === null
      ? 0
      : installedAttackDebuffOf(state, attackerTop.active) +
        opposingAttackDebuff(state, attackerTop.active);
  const spread = Math.max(0, amount - attackerDebuff);
  const bench = side.bench.map((pokemon) => {
    const uid = topUid(pokemon);
    if (uid === undefined) return pokemon;
    const passives = passivesOf(state, pokemon);
    // D159 — five terms in two printed groups (attack.ts's main hit says why).
    // This is the site where the OFF-TARGET pair is most reachable: a spread hits
    // the Bench, which is exactly the zone Thundurus "Adverse Weather" shields and
    // exactly where a no-Rule-Box body sits under Neutralization Zone.
    const prevented =
      (passives.preventDamageFromExV && attackerCard !== undefined && isExOrV(attackerCard)) ||
      preventsAttackerType(passives.preventDamageFromTypes, attackerCard) ||
      attackDamageBlocked(state, pokemon, attackerCard, ctx) ||
      benchShieldedByActive(state, pokemon) ||
      stadiumPreventsDamage(state, pokemon, attackerCard);
    // Catalog half + installed half, summed (D147). A durated reduction can in
    // fact only ever be live on an ACTIVE — installing it needs an attack, and
    // leaving the Active Spot ends it — so on the Bench this term is 0 by
    // construction and is read anyway, for the reason `attackDamageBlocked` is
    // consulted here: these sites must be TOTAL rather than case-covering.
    //
    // D161 — …and the THIRD source is the one that makes this site REACHABLE at
    // last. "All of your Pokémon take 10 less damage…" (Hariyama sv02-113) carries
    // no zone clause, so a spread into a shielded bench is the first board on
    // which a post-W/R reduction bites off a printed card here rather than off a
    // constructed record. `"all"`: a spread has no `ignoreWR`.
    const reduction =
      passives.damageReductionAfterWR +
      installedReductionOf(state, pokemon) +
      seatDamageReduction(state, pokemon, "all");
    const dealt = prevented ? 0 : Math.max(0, spread - reduction);
    const damage = pokemon.damage + dealt;
    events.push({
      type: "DAMAGE_DEALT",
      seat: opponent,
      uid,
      base: amount,
      debuff: attackerDebuff > 0 ? attackerDebuff : undefined,
      weakness: null,
      resistance: null,
      reduction: reduction > 0 ? reduction : undefined,
      prevented: prevented ? true : undefined,
      dealt,
      damage,
    });
    return { ...pokemon, damage };
  });
  return withSide(state, opponent, { ...side, bench });
}

/** Snipe: put `amount` HP of damage counters on the opponent's Benched Pokémon
    named by `refs` (the forced set, or the ones the player chose — validated
    upstream, so only refs that are the opponent's own bench slots land). Flat —
    a counter placement, NOT attack damage, so no Weakness/Resistance and no
    reduction passive (Bouffer reduces "damage from attacks", which a placed
    counter is not — the damageActive rule). One COUNTERS_PLACED per Pokémon
    actually hit. Only raises damage; the KO check runs in the caller's mid-turn
    sweep (flow.ts), so this never KOs.

    `source` IS PASSED IN, since 0.89.0 (D140). It was the string literal
    `"ability"` here until then, which was true while all three producers were
    Abilities and became a LIE the moment an attack printed the same action
    (Ting-Lu ex sv02-127 "Land Scoop"): the emitted event's `seat` OWNS the
    DAMAGED Pokémon — the attacker's opponent — rows render after their seat's
    name, and the `"ability"` log arm prints the literal word Ability. This is
    D136's finding 1 and the third time it has been refused at the source (D138's
    "moved", D139's "attack").

    ⚠️ IT IS NOT DERIVED FROM `deals`, AND THAT IS THE POINT. `deals` picks the
    EVENT (DAMAGE_DEALT vs COUNTERS_PLACED), not the provenance: its false arm is
    taken by three Abilities AND by one attack, so there is nothing to read the
    answer off. Before 0.89.0 the label was kept honest only by the accident that
    every DERIVED snipe happened to set `deals: true` — a flag chosen for an
    unrelated reason, which nothing asserted. It is asserted now
    (counterBenchPut.test.ts sweeps the whole fixture pool through the deriver and
    refuses `"ability"` on every op it produces). */
function placeSnipe(
  state: GameState,
  refs: readonly PokemonRef[],
  amount: number,
  deals: boolean,
  ignoreWR: boolean,
  source: "ability" | "attack",
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  const opponent = otherSeat(ctx.seat);
  // The Active target — `opponentAny` only (Fezandipiti ex "Cruel Arrow",
  // Ninetales sv03-029 "Nine-Tailed Dance"). §8.5: Weakness/Resistance apply ONLY
  // to the Active/Defending Pokémon, so a chosen HIT that lands on the Active goes
  // THROUGH W/R, unlike every Bench target below; `ignoreWR` (Umbreon "Feint
  // Attack") short-circuits that math and the reduction passive — see snipeActive.
  //
  // ⚠️ THE `!deals` ARM IS D143's, AND UNTIL THEN IT DID NOT EXIST. Every
  // put-counter snipe in the pool was Bench-only, so this branch was reached with
  // `deals === true` and the code said so in a comment — a guard that was an
  // accident of the candidate sets, exactly the shape D139 → D140 caught twice.
  // Ninetales' "1 of your opponent's POKÉMON" is the first printing that offers
  // the Active to a PLACEMENT, and routing it through `snipeActive` would have run
  // the full §8.5 pipeline over a placed counter — doubling it on a Weakness and
  // cutting it on a Resistance, against this engine's standing ruling (D138/D139)
  // that a placed counter is not attack damage. So the placement arm is
  // `damageActive`, REUSED rather than re-implemented: that function is already
  // "flat counters onto the opponent's Active, D142-guarded, `source` off the op",
  // which is this arm to the byte, and the only difference is how the target was
  // named. One reading, one implementation (D131's rule, applied to a function
  // rather than to a field).
  let next = state;
  if (refs.some((r) => r.seat === opponent && r.spot.spot === "active")) {
    next = deals
      ? snipeActive(next, amount, ignoreWR, ctx, events)
      : damageActive(next, amount, source, ctx, events);
  }
  // Bench targets — flat (no W/R). Batched in one map so a count-N snipe (Hawlucha)
  // still lands as before.
  const targeted = new Set<number>();
  for (const ref of refs) {
    if (ref.seat === opponent && ref.spot.spot === "bench") targeted.add(ref.spot.index);
  }
  if (targeted.size === 0) return next;
  const side = next.players[opponent];
  // Mimikyu "Safeguard" — an ex/V attacker's Benched-target attack damage is
  // prevented too (the deals arm only; a placed counter below is not "damage").
  const attackerTop = activeTop(next, ctx.seat);
  const attackerCard = attackerTop?.card;
  // D149 — the attacker's pre-W/R debuff, on the `deals` arm below only: a PLACED
  // counter is not damage from an attack (D138/D139), so the sentence "…attacks do
  // {N} less damage" has nothing to take off it, exactly as no reduction passive
  // does. Hoisted for `spreadDamage`'s reason (a fact about the attacker).
  //
  // D151 — the ALWAYS-ON half is summed in, and `ignoreWR` does NOT null it here
  // even though it nulls the target's reduction below. Feint Attack's clause
  // scopes "that Pokémon" — the BENCHED pick — and the aura's source is the
  // opponent's ACTIVE, a different body entirely. (`snipeActive` is the one arm
  // where those two coincide, and it answers differently for exactly that reason.)
  const attackerDebuff =
    attackerTop === null
      ? 0
      : installedAttackDebuffOf(next, attackerTop.active) +
        opposingAttackDebuff(next, attackerTop.active);
  const bench = side.bench.map((pokemon, index) => {
    if (!targeted.has(index)) return pokemon;
    const uid = topUid(pokemon);
    if (uid === undefined) return pokemon;
    if (!deals) {
      // The default put-counter snipe (Hawlucha / Meowscarada / Radiant Blastoise,
      // and since 0.89.0 Ting-Lu ex's "Land Scoop"): flat, no W/R and no reduction
      // passive (a placed counter is not "damage from an attack"). `source` is the
      // producer's, never this function's — see the doc block.
      events.push({ type: "COUNTERS_PLACED", seat: opponent, uid, amount, source });
      return { ...pokemon, damage: pokemon.damage + amount };
    }
    // Wo-Chien "Covetous Ivy": ATTACK DAMAGE to a Benched Pokémon — no Weakness/
    // Resistance (§8.5, Benched), but a benched reduction passive still applies,
    // exactly like spreadDamage. Emitted as DAMAGE_DEALT, so the log reads "dealt"
    // rather than "counters placed". Umbreon "Feint Attack" (`ignoreWR`) skips even
    // that reduction — its "not affected by any effects on that Pokémon" reaches a
    // Benched pick too.
    const targetPassives = passivesOf(next, pokemon);
    // `ignoreWR` (Feint Attack — "not affected by any effects on that Pokémon")
    // bypasses the prevention just as it bypasses the reduction passive.
    //
    // D159 — …and this is the ONE site where the printed grouping is observable in
    // BOTH directions on one board. The three ON-TARGET preventions are effects on
    // the benched pick and `ignoreWR` nulls them; the two OFF-TARGET ones are not
    // — Thundurus's source is that pick's own side's ACTIVE, and a Stadium is an
    // effect on no Pokémon whatever — so they survive Feint Attack and the pick
    // takes 0 anyway. That is D151's `placeSnipe`/`snipeActive` reading (the aura
    // whose source and "that Pokémon" are different bodies is out of the clause's
    // scope) applied to a PREVENTION instead of to a subtraction.
    const prevented =
      (!ignoreWR &&
        ((targetPassives.preventDamageFromExV &&
          attackerCard !== undefined &&
          isExOrV(attackerCard)) ||
          preventsAttackerType(targetPassives.preventDamageFromTypes, attackerCard) ||
          attackDamageBlocked(next, pokemon, attackerCard, ctx))) ||
      benchShieldedByActive(next, pokemon) ||
      stadiumPreventsDamage(next, pokemon, attackerCard);
    // Catalog half + installed half (D147), and `ignoreWR` nulls BOTH: Feint
    // Attack's "not affected by any effects on that Pokémon" reaches an
    // attack-installed reduction exactly as it reaches a printed passive — the
    // installed one is if anything the more literal "effect on that Pokémon".
    //
    // D161 — …but the SEAT-WIDE aura is not nulled outright, and this is the site
    // where that becomes observable. Its source set CONTAINS its target set, so
    // "any effects on that Pokémon" reaches exactly the part of it the damaged
    // body is granting ITSELF: a sniped Hariyama loses its own 10, a sniped
    // TEAMMATE keeps it, off one declaration of one printed attack. The two
    // earlier answers in this family were constant per SITE (D151/D159) only
    // because no aura before this one could be its own target.
    const reduction = ignoreWR
      ? seatDamageReduction(next, pokemon, "othersOnly")
      : targetPassives.damageReductionAfterWR +
        installedReductionOf(next, pokemon) +
        seatDamageReduction(next, pokemon, "all");
    // D149 — and the DEBUFF is NOT nulled by `ignoreWR`, unlike the reduction one
    // line up: it is an effect on the ATTACKER, and Feint Attack's clause scopes
    // "that Pokémon" (the target). Same reading that keeps the attacker's pre-W/R
    // BONUS alive under `ignoreWR` in `snipeActive`.
    const dealt = prevented ? 0 : Math.max(0, Math.max(0, amount - attackerDebuff) - reduction);
    events.push({
      type: "DAMAGE_DEALT",
      seat: opponent,
      uid,
      base: amount,
      debuff: attackerDebuff > 0 ? attackerDebuff : undefined,
      weakness: null,
      resistance: null,
      reduction: reduction > 0 ? reduction : undefined,
      prevented: prevented ? true : undefined,
      dealt,
      damage: pokemon.damage + dealt,
    });
    return { ...pokemon, damage: pokemon.damage + dealt };
  });
  return withSide(next, opponent, { ...side, bench });
}

/** The Active-target arm of an `opponentAny` snipe (Fezandipiti ex "Cruel Arrow"
    when the pick lands on the Active). Unlike the Bench arm, this runs the FULL §8.5
    pipeline — base + the attacker's continuous pre-W/R bonus → ×Weakness →
    −Resistance → −reduction, floored at 0 — read off the attacker's and the target's
    printed cards, byte-for-byte attack.ts's main hit. The continuous bonus IS
    included here (unlike the Bench arm): Vitality Band's "+10 to your opponent's
    ACTIVE before Weakness/Resistance" applies precisely because the target is the
    Active — the same reason the Bench arm correctly omits it. Only the main attack's
    OWN printed base/scaling is absent (the snipe's `amount` is its whole base).
    `ignoreWR` (Umbreon "Feint Attack") nulls Weakness/Resistance AND the target's
    reduction passive — its "isn't affected by Weakness or Resistance, or by any
    effects on that Pokémon" — while KEEPING the attacker's own pre-W/R bonus, which
    is an effect on the ATTACKER, not on "that Pokémon". */
function snipeActive(
  state: GameState,
  amount: number,
  ignoreWR: boolean,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const opponent = otherSeat(ctx.seat);
  const target = activeTop(state, opponent);
  if (target === null) return state;
  const attacker = activeTop(state, ctx.seat);
  const bonus =
    attacker === null ? 0 : attackerPreWRBonus(state, attacker.active, ctx.seat, target.card);
  // D149 — the pre-W/R DEBUFF on the attacker, subtracted beside its bonus. NOT
  // bypassed by `ignoreWR`: Feint Attack's "not affected by … any effects on that
  // Pokémon" scopes the TARGET, and this is an effect on the ATTACKER — the same
  // reading that already KEEPS the bonus above, applied to the term beneath it.
  //
  // D151 — the ALWAYS-ON half is summed in, and this is the ONE site where
  // `ignoreWR` nulls it. The aura's source is the OPPONENT'S ACTIVE and this arm's
  // target IS the opponent's Active, so on every board where Pressure is live the
  // source and "that Pokémon" are the same body — and Feint Attack's "isn't
  // affected … by any effects on that Pokémon" is precisely a clause about that
  // body's own printed Ability. The stamped half is untouched by `ignoreWR` on
  // this same line, for the reason above it: that one lives on the ATTACKER's
  // record. The two halves of one number answering differently is not an
  // inconsistency — it is the aura/installation distinction becoming observable.
  const debuff =
    attacker === null
      ? 0
      : installedAttackDebuffOf(state, attacker.active) +
        (ignoreWR ? 0 : opposingAttackDebuff(state, attacker.active));
  // Weakness, unless nulled by `ignoreWR` (Feint Attack) OR by a "your Pokémon
  // have no Weakness" aura on the sniped seat (Florges "Blooming Garden");
  // Resistance still applies to a Blooming-Garden-protected Active.
  const noWeakness = ignoreWR || attacker === null || seatRemovesWeakness(state, opponent);
  const weakness = noWeakness ? null : weaknessOf(attacker.card, target.card);
  const resistance =
    ignoreWR || attacker === null ? null : resistanceOf(attacker.card, target.card);
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
  // Mimikyu "Safeguard" on the sniped Active — an ex/V attacker's snipe is
  // prevented, unless `ignoreWR` (Feint Attack) bypasses on-target effects.
  //
  // D159 — the OFF-TARGET pair sits outside the `ignoreWR` guard for the reason
  // `placeSnipe`'s bench arm gives, and here one of the two is FALSE by
  // construction (this arm's target is the opponent's ACTIVE, never a benched
  // body) while the other is fully live: Neutralization Zone protects an Active
  // without a Rule Box exactly as it protects a benched one, and Feint Attack's
  // "effects on that Pokémon" does not reach the shared Stadium zone. Read anyway,
  // for `attackDamageBlocked`'s totality reason.
  const prevented =
    (!ignoreWR &&
      ((targetPassives.preventDamageFromExV && attacker !== null && isExOrV(attacker.card)) ||
        preventsAttackerType(targetPassives.preventDamageFromTypes, attacker?.card) ||
        attackDamageBlocked(state, target.active, attacker?.card, ctx))) ||
    benchShieldedByActive(state, target.active) ||
    stadiumPreventsDamage(state, target.active, attacker?.card);
  // Catalog half + installed half (D147), `ignoreWR` nulling both — the Bench
  // arm's comment one function up applies verbatim, and this is the site where
  // the printed parenthetical is observable, since it is the only one of the four
  // interpreter-side reads that runs Weakness at all.
  //
  // D161 — the seat-wide aura's `ignoreWR` answer is the bench arm's verbatim and
  // is reached differently here: this arm's target is the opponent's ACTIVE, so a
  // Feint Attack into an ACTIVE Hariyama nulls its own 10 while a benched second
  // Hariyama keeps shielding it.
  const reduction = ignoreWR
    ? seatDamageReduction(state, target.active, "othersOnly")
    : targetPassives.damageReductionAfterWR +
      installedReductionOf(state, target.active) +
      seatDamageReduction(state, target.active, "all");
  const dealt = prevented ? 0 : Math.max(0, afterWR - reduction);
  events.push({
    type: "DAMAGE_DEALT",
    seat: opponent,
    uid: target.uid,
    base: amount,
    bonus: bonus > 0 ? bonus : undefined,
    debuff: debuff > 0 ? debuff : undefined,
    weakness,
    resistance,
    reduction: reduction > 0 ? reduction : undefined,
    prevented: prevented ? true : undefined,
    dealt,
    damage: target.active.damage + dealt,
  });
  return withActive(state, opponent, { ...target.active, damage: target.active.damage + dealt });
}

/** The effective snipe amount — `amount`, or `amount × the opponent's TAKEN
    Prizes` when the op scales by them (Wo-Chien "Covetous Ivy"). Read from state
    at the moment the op runs (and again at the pick, unchanged — no KO intervenes),
    the interpreter's counterpart to attack.ts's pre-W/R Prize fold. */
function snipeAmount(
  op: { amount: number; perTakenPrize?: true },
  state: GameState,
  ctx: EffectContext,
): number {
  return op.perTakenPrize === true
    ? op.amount * takenPrizes(state, otherSeat(ctx.seat))
    : op.amount;
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
  target: "opponentBench" | "opponentAny" = "opponentBench",
): string {
  const verb = optional ? "You may choose" : "Choose";
  const each = deals
    ? `${amount} damage`
    : `${Math.round(amount / 10)} damage counter${Math.round(amount / 10) === 1 ? "" : "s"}`;
  // `opponentAny` offers the Active too, so the heading drops "Benched".
  const zone = target === "opponentAny" ? "Pokémon" : "Benched Pokémon";
  return `${verb} ${count} of your opponent's ${zone} (${each} each).`;
}

/** The heading for healChosen's "up to N" park. Quotes the card (Saguaro:
    "Choose up to 2 of your Pokémon and heal 50 damage from each of them"),
    with `max` already §8.6-clamped to the board — one Pokémon in play asks
    "up to 1", because doing as much as you can is about the number, not the
    whether. `"all"` has no printed consumer with `upTo` yet; the phrase is
    ready so an author can never park a heading that lies about the amount, and
    `zoneWord` ("Benched " or "") is there for the same reason — no printing
    combines "up to N" with the Bench filter either, and the heading must still
    describe the candidates it was built from (D135). */
function healUpToNote(amount: number | "all", max: number, zoneWord: string): string {
  const what = amount === "all" ? "all damage" : `${amount} damage`;
  return `Choose up to ${max} of your ${zoneWord}Pokémon and heal ${what} from each of them.`;
}

/** Heal `amount` HP from EACH of the controller's own in-play Pokémon
    (Garganacl "Blessed Salt", between turns). Each heal is clamped to the
    Pokémon's damage and emits its own HEALED (an undamaged Pokémon heals 0 and
    emits nothing). Active then bench, in index order. Never parks. */
function healEach(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const healOne = (pokemon: InPlayPokemon): InPlayPokemon => {
    const uid = topUid(pokemon);
    const healed = Math.min(amount, pokemon.damage);
    if (uid === undefined || healed <= 0) return pokemon;
    events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
    return { ...pokemon, damage: pokemon.damage - healed };
  };
  const active = side.active === null ? null : healOne(side.active);
  const bench = side.bench.map(healOne);
  return withSide(state, ctx.seat, { ...side, active, bench });
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
      const healed = Math.min(amount, pokemon.damage);
      if (uid === undefined || healed <= 0) return pokemon;
      events.push({ type: "HEALED", seat, uid, amount: healed });
      return { ...pokemon, damage: pokemon.damage - healed };
    };
    const active = side.active === null ? null : healOne(side.active);
    const bench = side.bench.map(healOne);
    next = withSide(next, seat, { ...side, active, bench });
  }
  return next;
}

/** PUT `amount` HP of damage counters on the OPPONENT's Active Pokémon —
    Trevenant "Forest Miasma" (a between-turns Ability, 1 counter) and, since
    0.88.0, the bare attack sentence "Put {N} damage counters on your opponent's
    Active Pokémon." (Mimikyu "Ghost Eye", Polteageist "Pour Tea" — D139).

    "Put damage counters" is NOT attack damage: no Weakness/Resistance (§8.5) AND
    no damage-reduction passive — Bouffalant's "Bouffer" reduces "damage from
    attacks", which a PLACED counter is not, whether an Ability or an attack's own
    printed sentence placed it (the same reason the poison/burn Checkup ticks
    place their counters flat). So this is a flat placement, distinct from
    spreadDamage (an ATTACK's damage, which Bouffer does reduce) — and note that
    "printed on an attack" does NOT make it attack damage, which is the one thing
    the 0.88.0 producer could have got wrong.

    `amount` IS ALREADY HP. Both producers count COUNTERS in their printed text
    and both do the × 10 (§12) at the site that reads the number, so this helper
    never sees the printed unit and cannot convert twice.

    `source` RIDES THE OP because the row's provenance is not something this
    function can know: `seat` on the emitted event owns the DAMAGED Pokémon (the
    non-actor either way), and the "ability" log arm prints the literal word
    Ability — true of Trevenant, false of Ghost Eye. Hardcoding it here was the
    shape until 0.88.0 and it was exactly D136's finding 1 waiting for a second
    producer.

    Only raises damage; the KO check runs in the CALLER's sweep — the Checkup's
    for the triggered Ability, the attack epilogue's two-seat one for the attack
    (both flow.ts) — so this never KOs. */
function damageActive(
  state: GameState,
  amount: number,
  source: "ability" | "attack",
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  const opponent = otherSeat(ctx.seat);
  const active = state.players[opponent].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // §11 (D142) — A PLACED COUNTER IS NOT DAMAGE, so it is refused by the EFFECTS
  // half and by nothing else. That is this engine's own long-standing reading of
  // this very op (the placement skips Weakness, Resistance and every reduction
  // passive — D138/D139), and the catalog prints the rule that confirms it on
  // Bronzong sv03-145: "(Damage is not an effect.)". So a defender carrying the
  // NARROW block ("prevent all damage done to this Pokémon by attacks") still
  // takes these counters in full, which is the sharpest difference between the
  // family's two printed spellings.
  //
  // `source` — D139/D140's field, added for a LOG LABEL — is not what gates this:
  // the provenance the rule needs is the INVOCATION's, and an Ability that
  // reached this op inside an attack's program would still be an attack's effect.
  // The two agree by construction on every producer in the pool, which the suite
  // asserts rather than assumes.
  if (attackEffectRefused(state, opponent, ctx, events)) return state;
  events.push({ type: "COUNTERS_PLACED", seat: opponent, uid, amount, source });
  return withActive(state, opponent, { ...active, damage: active.damage + amount });
}

/** MOVE every damage counter off the controller's chosen BENCHED `ref` and onto
    the OPPONENT's Active — Dedenne ex sv02-093/-239 "Tail Swap" (D138). One
    printed action, two halves, and the SAME number in both: `HEALED` for what
    came off (so the bench body lands at exactly 0) and `COUNTERS_PLACED` source
    "moved" for what went on. That equality is the word "move"; two different
    numbers would be a heal and a snipe wearing one sentence.

    THE ORDER IS THE PRINTED ORDER — "from … to …" — and it is also the only
    order that reads correctly in a log, since the second row is the one that can
    Knock the defender Out.

    A PLACED COUNTER, NOT ATTACK DAMAGE (`damageActive`'s rule verbatim): no
    Weakness/Resistance (§8.5) and no `damageReductionAfterWR` passive, because
    Bouffalant's "Bouffer" reduces *damage from attacks* and a moved counter is
    not one. So the number on the defender is the number that came off the Bench,
    whatever the defender is weak to.

    THREE ENDINGS, all silent and all reachable:
      • the `ref` is not the controller's own Bench — the wire belt (`candidates`
        is the real legality rule, and it only ever holds own-bench refs);
      • the pick carries NO damage — a whiff, and the printed sentence offers
        undamaged bodies on purpose (the Potion doctrine), so this is the single-
        arm rule: nothing moved, so nothing is announced;
      • there is no Defending Pokémon — then NOTHING moves, not even the removal.
        A move needs both ends, and half of one would silently launder counters
        off the controller's board. Unreachable from a §8 attack (the attack gate
        guarantees a defender) and written down because a total helper must still
        answer it.

    Like every op it only RAISES damage and never KOs: the attack epilogue's
    two-seat sweep (flow.ts `finishAttack`) reads the post-effect board, prizes to
    the attacker and promotes — after a park just as much as inline, because
    `resumeTail` keeps `attackEpilogue` queued behind the question (D135). */
function moveCountersToDefender(
  state: GameState,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (ref.seat !== ctx.seat || ref.spot.spot !== "bench") return state;
  const index = ref.spot.index;
  const side = state.players[ctx.seat];
  const source = side.bench[index];
  if (source === undefined) return state;
  const sourceUid = topUid(source);
  if (sourceUid === undefined) return state;
  const moved = source.damage;
  if (moved <= 0) return state;
  const opponent = otherSeat(ctx.seat);
  const defender = state.players[opponent].active;
  if (defender === null) return state;
  const defenderUid = topUid(defender);
  if (defenderUid === undefined) return state;
  // §11 (D142) — the destination half is a counter PLACEMENT, an effect rather
  // than damage (see `damageActive`), so the wider block refuses it. And the
  // refusal takes the WHOLE printed action with it: the two rows carry ONE
  // number because the printed verb is "move" (D138), so healing the Bench body
  // while the counters never arrive would launder damage off the attacker's own
  // board — the one outcome this op's doc block says two different numbers must
  // never produce. Checked BEFORE the HEALED row for exactly that reason.
  if (attackEffectRefused(state, opponent, ctx, events)) return state;
  events.push({ type: "HEALED", seat: ctx.seat, uid: sourceUid, amount: moved });
  const bench = side.bench.map((pokemon, i) => (i === index ? { ...pokemon, damage: 0 } : pokemon));
  const cleared = withSide(state, ctx.seat, { ...side, bench });
  events.push({
    type: "COUNTERS_PLACED",
    seat: opponent,
    uid: defenderUid,
    amount: moved,
    source: "moved",
  });
  return withActive(cleared, opponent, { ...defender, damage: defender.damage + moved });
}

/** PLACE `amount` HP of SELF-damage on the controller's OWN Active — the attack
    recoil "This Pokémon also does N damage to itself" (Skeledirge sv01-038
    "Blazing Shout"). Self-damage sits OUTSIDE the §8.5 pipeline: no Weakness/
    Resistance (you have no Weakness to your own attack) and no reduction, so it
    is a flat placement emitted as COUNTERS_PLACED source "self", the confusion
    self-hit's own model (attack.ts). "itself" is the attacking Pokémon — for a
    §8 attack that is the Active, and no derived single-op program moves it before
    this runs. Only raises damage; the resulting self-KO is caught by the attack
    epilogue's TWO-seat sweep (flow.ts finishAttack) and prizes to the defender,
    so this — like every op — never KOs or touches the flow tail. */
function damageSelf(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  events.push({ type: "COUNTERS_PLACED", seat: ctx.seat, uid, amount, source: "self" });
  return withActive(state, ctx.seat, { ...active, damage: active.damage + amount });
}

/** Heal the controller's own Active (attack "heal from it" op). */
function healSelf(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const healed = Math.min(amount, active.damage);
  if (healed <= 0) return state;
  events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
  return withActive(state, ctx.seat, { ...active, damage: active.damage - healed });
}

function discardHand(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const side = state.players[ctx.seat];
  if (side.hand.length === 0) return state;
  events.push({ type: "HAND_DISCARDED", seat: ctx.seat, uids: [...side.hand] });
  return withSide(state, ctx.seat, { ...side, hand: [], discard: [...side.discard, ...side.hand] });
}

function shuffleDeck(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const side = state.players[ctx.seat];
  const [deck, rngState] = shuffle(side.deck, state.rngState);
  events.push({ type: "SHUFFLE", seat: ctx.seat });
  return { ...withSide(state, ctx.seat, { ...side, deck }), rngState };
}

/** Put the affected player(s)' whole hand back into their deck, then draw
    (Youngster / Judge / Brassius / Katy / Iono — the hand-refresh Supporter
    family). Two passes over the affected seats, each in a FIXED order (the
    controller first, then — for `who: "both"`: Judge, Iono — the opponent):

    1. MOVE. Capture the seat's pre-move hand size, then either shuffle the hand
       INTO the deck (default — append and shuffle the combined pile; the insert
       position is irrelevant since the shuffle randomizes it all) or, with
       `toBottom` (Iono), shuffle the HAND ALONE and append it UNDER the deck,
       leaving the deck's own order — and so the very next draws — untouched.
       One count-only event per seat.
    2. DRAW. Each affected seat draws a constant, its captured hand size + delta,
       or its own remaining Prize count. `onlyIfAnyMoved` (Iono's "if either player
       put any cards on the bottom of their deck in this way") skips the whole pass
       when no affected seat moved a card — an ALL-OR-NOTHING gate across the seats,
       which is why every move happens before any draw.

    A shuffled/bottomed or drawn card is hidden, so every event here is count-only
    (the drawn uids ride drawToHand's standard contract) — nothing leaks even when
    the op reaches the OPPONENT's hand. Never parks (no decision), never KOs. */
function handRefresh(
  state: GameState,
  op: Extract<EffectOp, { op: "handRefresh" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seats: Seat[] = op.who === "both" ? [ctx.seat, otherSeat(ctx.seat)] : [ctx.seat];
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
    const count = handRefreshDrawCount(next, seat, op.draw, handCount);
    next = drawToHand(next, seat, count, "effect", events);
  }
  return next;
}

/** How many cards `seat` draws in a handRefresh: a constant, its own pre-move
    hand size + delta (Brassius), or its own remaining Prize count (Iono). */
function handRefreshDrawCount(
  state: GameState,
  seat: Seat,
  draw: HandRefreshDraw,
  handCount: number,
): number {
  switch (draw.kind) {
    case "fixed":
      return draw.count;
    case "handPlus":
      return handCount + draw.delta;
    case "prizeCount":
      return state.players[seat].prizes.length;
  }
}

// (deck shuffling reuses rng.ts's vetted Fisher–Yates — the M1 review caught a
// biased hand-rolled variant; there is exactly one shuffle in the engine.)

/** Move the chosen searched cards deck → dest (bench Basics enter play stamped
    this turn; hand cards just append). Wire-safe: only uids actually in the
    deck move (resolveEffect already checked them against the candidate set). */
function searchMove(
  state: GameState,
  uids: readonly string[],
  dest: "bench" | "hand",
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  // Bench-bound cards clamp to the remaining bench space HERE, before anything
  // leaves the deck — so the set removed from the deck is EXACTLY the set that
  // lands (a slice-after-remove would strand the excess in neither zone, the
  // card-destruction shape the M1 review called out). Hand has no cap.
  const inDeck = uids.filter((uid) => side.deck.includes(uid));
  const moved = dest === "bench" ? inDeck.slice(0, benchSpace(state, ctx.seat)) : inDeck;
  if (moved.length === 0) return state;
  const picked = new Set(moved);
  const deck = side.deck.filter((uid) => !picked.has(uid));
  const updated: PlayerSide =
    dest === "bench"
      ? {
          ...side,
          deck,
          bench: [...side.bench, ...moved.map((uid) => makeInPlay(uid, state.turn))],
        }
      : { ...side, deck, hand: [...side.hand, ...moved] };
  events.push({ type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved] });
  return withSide(state, ctx.seat, updated);
}

/** Move the chosen retrieved cards discard → dest (§7.1 recovery Items): hand
    appends; deck appends to the end, where a trailing `shuffleDeck` op then
    scrambles them ("shuffle … into your deck"). Wire-safe like searchMove: only
    uids actually in the discard pile move (resolveEffect already checked them
    against the candidate set, and rejects a uid picked twice).

    Hands back the uids that ACTUALLY moved, for the §9.2 record (Miriam) — the
    same list the event names, so what a later clause reads is exactly what the
    game announced. */
function retrieveMove(
  state: GameState,
  uids: readonly string[],
  dest: "hand" | "deck",
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: string[] } {
  const side = state.players[ctx.seat];
  const moved = uids.filter((uid) => side.discard.includes(uid));
  if (moved.length === 0) return { state, moved };
  const picked = new Set(moved);
  const discard = side.discard.filter((uid) => !picked.has(uid));
  const updated: PlayerSide =
    dest === "hand"
      ? { ...side, discard, hand: [...side.hand, ...moved] }
      : { ...side, discard, deck: [...side.deck, ...moved] };
  events.push({ type: "DISCARD_RETRIEVED", seat: ctx.seat, dest, uids: [...moved] });
  return { state: withSide(state, ctx.seat, updated), moved };
}

/** Move the chosen looked-at cards deck → hand (lookAtTopN — Great Ball /
    Pokégear 3.0). Wire-safe like searchMove/retrieveMove: only uids actually in
    the deck move, and resolveEffect already checked them against the candidate
    set (the top-n matches), so a deeper card can never reach here. The cards are
    REVEALED (the printed "reveal … put it into your hand"), so DECK_TOP_REVEALED
    names them. The trailing shuffleDeck op then scrambles the deck (the top cards
    were looked at), whether or not anything was taken. */
function revealFromTop(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const moved = uids.filter((uid) => side.deck.includes(uid));
  if (moved.length === 0) return state;
  const picked = new Set(moved);
  const deck = side.deck.filter((uid) => !picked.has(uid));
  events.push({ type: "DECK_TOP_REVEALED", seat: ctx.seat, uids: [...moved] });
  return withSide(state, ctx.seat, { ...side, deck, hand: [...side.hand, ...moved] });
}

/** Pay a hand cost: move the chosen `uids` out of the controller's hand — into
    their own discard pile (§7/§9 — Ultra Ball, Tinkaton, Meowscarada ex) or
    UNDER their own deck (Dendra). Wire-safe in the same way searchMove /
    retrieveMove are: only uids actually in the hand move, and a uid repeated on
    the wire pays once, so a card is never duplicated into the destination nor
    left in neither zone. Emits ONE event naming the cards and where they went.

    The paid cards keep the order they were PICKED IN when they go under the deck
    — the printed sentence pays one card ("Put a card…"), so no card in the family
    can tell a chosen order from any other, and preserving the pick is the answer
    that needs no rng. Deck order is otherwise untouched: this is the placement
    Iono exists for (`handRefresh` `toBottom`), which shuffles because it moves a
    WHOLE hand and hiding its order is the point.

    Never damages, so it never KOs.

    Hands back the uids ACTUALLY paid, for the §9.2 record: Superior Energy
    Retrieval bars exactly these from the retrieval that follows, and Dendra
    gates its draw on there being any ("if you do"). */
function payFromHandApply(
  state: GameState,
  uids: readonly string[],
  op: Extract<EffectOp, { op: "payFromHand" }>,
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
  events.push({ type: "HAND_COST_PAID", seat: ctx.seat, uids: [...paid], to: op.to });
  const hand = side.hand.filter((uid) => !spent.has(uid));
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

/** The reveal-and-bottom offer (Ortega, Greavard "Underworld Stroll"): the
    opponent's hand filtered by the op, collapsed to ONE representative per
    interchangeable class in hand order — the pick is "a card", so no class can
    ever want a second copy (the payFromHand cap logic at count 1, keyed by
    `cardIdentity` like attachFromDeck because the catalog prints one Basic
    Energy under several ids, and two of those in a hand are one answer wearing
    two uids). Collapsing here leaks nothing: the whole hand just went out in
    HAND_REVEALED, so the offer's shape has no secret left to give away — the
    exact leak that keeps payFromHand's own-hidden-hand offer from doing this. */
function bottomFromOpponentHandOffer(
  state: GameState,
  ctx: EffectContext,
  op: Extract<EffectOp, { op: "bottomFromOpponentHand" }>,
): string[] {
  const hand = state.players[otherSeat(ctx.seat)].hand;
  const kept = new Set<string>();
  const candidates: string[] = [];
  for (const uid of hand) {
    if (op.filter !== undefined && !matchesFilter(cardOf(state, uid), op.filter)) continue;
    const key = cardIdentity(state, uid);
    if (kept.has(key)) continue;
    kept.add(key);
    candidates.push(uid);
  }
  return candidates;
}

/** Move the chosen card out of the OPPONENT's hand onto the bottom of the
    OPPONENT's own deck (appended — payFromHandApply's `deckBottom` placement,
    on the other seat's zones). Wire-safety like every mover in this file: the
    hand is re-read live and only uids actually sitting in it move, so a stale
    or repeated uid drops out rather than duplicating a card. Hands back what
    ACTUALLY moved for the §9.2 record (Ortega's "in this way").

    Emits CARD_TO_BOTTOM_OF_DECK naming the uid — public the whole way (the
    hand was just revealed, the pick made in the open), with `actor` = the
    controller who chose and `seat` = the owner whose zones both are. */
function bottomFromOpponentHandApply(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
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
  if (moved.length === 0) return { state, moved };
  for (const uid of moved) {
    events.push({ type: "CARD_TO_BOTTOM_OF_DECK", seat: owner, uid, actor: ctx.seat });
  }
  return {
    state: withSide(state, owner, {
      ...side,
      hand: side.hand.filter((uid) => !taken.has(uid)),
      deck: [...side.deck, ...moved],
    }),
    moved,
  };
}

/** The pick prompt's printed sentence — the whole clause, since the op IS the
    whole clause (the payFromHandNote rule). Grown one printed form per card
    (the retrieveNoun rule): bare = Ortega's, `supporter` = Greavard's. An
    unphrased future filter gets the bare form's structure with no guessed
    noun — "a card" is never a lie, merely less than the card prints. */
function bottomFromOpponentHandNote(
  op: Extract<EffectOp, { op: "bottomFromOpponentHand" }>,
): string {
  if (op.filter?.kind === "supporter") {
    return "Your opponent reveals their hand. Choose a Supporter card you find there and put it on the bottom of their deck.";
  }
  return "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.";
}

/** The mayDraw prompt speaks to its ANSWERER — the opponent of the seat that
    played the card — so the printed "your opponent may draw a card" turns
    around into the second person, the way it is said across a table. */
function mayDrawNote(op: Extract<EffectOp, { op: "opponentMayDraw" }>): string {
  return op.count === 1 ? "You may draw a card." : `You may draw ${op.count} cards.`;
}

/** The cards in `seat`'s hand that may pay a `payFromHand`, with
    INTERCHANGEABLE copies collapsed to at most `count` representatives each —
    the set the player is actually asked about, and the same set the play gate
    counts.

    `excludeUid` is the printed "**other**" (Ultra Ball's "2 other cards"): the
    Trainer paying the cost is still in hand while the GATE runs, and it may not
    pay for itself. The apply never needs it — playTrainer moves the played card
    to the discard before the program runs — so this is the one place the word
    has to be honoured, which is why it is a parameter here rather than a field
    on the op (see effects.ts).

    ONE collapsed set serves both readers, and that is sound because collapsing
    at cap `count` cannot cross the gate's threshold: if the hand really holds
    `count` matching cards then either one class alone has that many (and
    contributes `count`) or every class survives whole — so `kept >= count` iff
    `actual >= count`. A gate reading raw counts and a prompt reading collapsed
    ones could otherwise offer a pick the player cannot complete. */
function handCostCandidates(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "payFromHand" }>,
  excludeUid?: string,
): string[] {
  const kept = new Map<string, number>();
  const out: string[] = [];
  for (const uid of state.players[seat].hand) {
    if (uid === excludeUid) continue;
    const card = cardOf(state, uid);
    if (op.filter !== undefined && !matchesFilter(card, op.filter)) continue;
    if (op.filter === undefined && card === undefined) continue;
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= op.count) continue;
    kept.set(key, already + 1);
    out.push(uid);
  }
  return out;
}

/** The first top-level `payFromHand` in `program` whose cost the seat
    cannot pay, or null when every one of them can be. The printed "you can use
    this card only if …" / "you must discard … in order to use this Ability"
    gate, checked by BOTH action paths before anything is committed (cardplay.ts)
    — a card whose cost cannot be paid is not played, so the effect it buys never
    resolves for free.

    Deliberately NOT part of `programPlayable`: that function is the ENGINE's
    would-only-whiff heuristic, this is the CARD's own printed rule (the
    `trainerPlayableIf` distinction), and it needs the played uid, which
    `programPlayable` has no way to know. Like `programPlayable` it scans only
    TOP-LEVEL ops — no printed card puts a cost inside a coin or condition gate,
    and a cost that could be skipped by a branch would not be a cost.

    NOT COMPOSITIONAL, and the limit is exactly one cost per program. Each op is
    checked against the SAME starting hand, so a hypothetical program with two
    costs would pass the gate on a hand that can only pay one, and the second
    would then resolve free (the short-hand branch in `stepOp` pays what there
    is). Every printed card in the family charges once — the cost is the price of
    a play, and a play happens once — so this is a scope statement, not a bug;
    folding it would mean deciding which cards the FIRST cost spends before asking
    what the second can still afford, which is only answerable once a card exists
    to say what the right answer is. */
export function handCostUnmet(
  state: GameState,
  seat: Seat,
  program: readonly EffectOp[],
  excludeUid?: string,
): Extract<EffectOp, { op: "payFromHand" }> | null {
  for (const op of program) {
    if (op.op !== "payFromHand") continue;
    if (handCostCandidates(state, seat, op, excludeUid).length < op.count) return op;
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
export function handCostPhrase(
  op: Extract<EffectOp, { op: "payFromHand" }>,
  other: boolean,
): string {
  const { singular, plural } =
    op.filter === undefined ? { singular: "a card", plural: "cards" } : retrieveNoun(op.filter);
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
export function handCostAction(
  op: Extract<EffectOp, { op: "payFromHand" }>,
  other: boolean,
): string {
  const phrase = handCostPhrase(op, other);
  return op.to === "deckBottom"
    ? `put ${phrase} from your hand on the bottom of your deck`
    : `discard ${phrase} from your hand`;
}

/** The park's heading — the cost clause as an instruction ("Discard a card from
    your hand." / "Put a card from your hand on the bottom of your deck."). The
    played Trainer has already left the hand by the time this is asked, so every
    offered card IS another one and the printed "other" is not repeated here. */
function payFromHandNote(op: Extract<EffectOp, { op: "payFromHand" }>): string {
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
    retreater lands at the end) — the same compaction retreat uses. Exported for
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
  // Leaving the Active Spot ends the conditions AND the §11 retreat block —
  // the one path where that clear is observable (a forced switch can move a
  // Pokémon the block itself would never let retreat) — AND, since D142, the
  // attack-installed damage block, for which THIS is the reachable clear rather
  // than an unreachable one: the block is installed on the attacker's own body
  // and its window is the opponent's turn, so a Boss's Orders played inside that
  // window drags the shielded Pokémon off the Active Spot and the protection
  // goes with it. Both are effects of ATTACKS and both end here for that one
  // reason; nothing here is a §12 condition.
  //
  // …AND, since D143, the attack-installed SELF-LOCK, whose clear is reachable
  // from BOTH ends of this move: the controller may Switch their own locked
  // Pokémon out (and back in, on the same turn, with an Item — at which point it
  // may attack, because §10 shed the effect), and the OPPONENT may drag it out
  // with a Boss's Orders during the window, un-locking a body they were trying to
  // keep off the board. D142's block could only ever be cleared here by the
  // opponent; this one is also the holder's own line of play.
  // …AND, since D147, the attack-installed DAMAGE REDUCTION, whose reachability
  // is D142's rather than D143's: the window is the OPPONENT's turn, so the only
  // player who can move the body inside it is the opponent — a Boss's Orders
  // played on that very turn drags the shielded Pokémon off the spot and the
  // reduction goes with it, which is the sharpest available witness that the
  // clear is real (the very next hit lands at full price).
  // …AND, since D148, that same lock installed by the OPPONENT'S attack ("…the
  // Defending Pokémon can't attack."), which reaches this path from ONE end only
  // and it is the one D143's story called the holder's: the window is the victim's
  // own turn, so the victim Switches out of it and attacks with whatever comes up.
  // The installer cannot use this path at all — their turn ended when they
  // declared. FOUR durated effects, FOUR reachability stories, one clear, and the
  // set is swept rather than listed (attackLock.test.ts) precisely because this
  // literal is one of three that have to agree with nothing making them.
  const benched = {
    ...active,
    conditions: noConditions(),
    retreatBlocked: false,
    attackBlock: null,
    attackLockedTurn: null,
    damageReduction: null,
    // D149 — and this is the FORCED half of the debuff's story: a Boss's Orders
    // played by the DEBUFFED player on their own turn (the window) pulls the body
    // off the spot and the debuff with it, and so does the opponent dragging it up
    // from the Bench. FIVE durated effects, FIVE reachability stories, one clear.
    attackDamageDebuff: null,
    // D152 — and the armed RECOIL's story here is D147's rather than D149's: the
    // window is the OPPONENT's turn, so the only player who can move the body
    // inside it is the opponent — a Boss's Orders played on that very turn drags
    // the armed Pokémon off the spot and the trap goes with it, which is the
    // sharpest available witness that the clear is real (the very next hit draws
    // no counters). SIX durated effects, FIVE reachability stories, one clear.
    installedRecoil: null,
    // D154 — and the PER-ATTACK lock's story here is D143's `attackLockedTurn`
    // verbatim, because it is the same window on the same body: the holder may
    // Switch their own barred Pokémon out (and back in, on the same turn, with an
    // Item — at which point it may use the barred attack, because §10 shed the
    // effect), and the OPPONENT may drag it out with a Boss's Orders during the
    // window, un-barring an attack they were trying to avoid. SEVEN durated
    // effects, FIVE reachability stories, one clear, and the set is SWEPT rather
    // than listed (perAttackLock.test.ts) precisely because this literal is one of
    // three that have to agree with nothing making them. Since D165 it sheds a
    // LIST, and the whole list rather than an entry: §10 sheds the effects of
    // attacks, all of them, and per-entry expiry is the READER's turn comparison.
    lockedAttacks: [],
    // D155 — and the PER-ATTACK BUFF's story here is the line above it verbatim,
    // because it is the same window on the same body with the opposite verb: the
    // holder may Switch its own boosted Pokémon out and THROW THE BONUS AWAY, and
    // the opponent may drag it out with a Boss's Orders to do the same to them.
    // That inversion is worth a line of its own — every other field on this list is
    // shed to somebody's relief, and this is the first one a player loses. EIGHT
    // durated effects, FIVE reachability stories, one clear.
    boostedAttack: null,
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
  // Stamp the move (types.ts `promotedTurn`). This is the FORCED half of
  // bench→Active and it covers three provenances at once — Switch/Escape Rope
  // on your own board, Boss's Orders on the opponent's, and Jet Energy's
  // on-attach switch — because all three land here. A Pokémon dragged out by
  // the opponent really did move to the Active Spot on THAT turn; the stamp is
  // a turn number, so it simply fails to match the controller's next turn.
  return withSide(state, seat, {
    ...side,
    active: { ...incoming, promotedTurn: state.turn },
    bench,
  });
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
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (pokemon === undefined || pokemon === null) return state;
  const uid = topUid(pokemon);
  if (uid === undefined) return state;
  const healed = amount === "all" ? pokemon.damage : Math.min(amount, pokemon.damage);
  if (healed <= 0) return state;
  events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
  const updated = { ...pokemon, damage: pokemon.damage - healed };
  if (ref.spot.spot === "active") return withActive(state, ctx.seat, updated);
  const bench = side.bench.map((p, i) =>
    i === (ref.spot as { index: number }).index ? updated : p,
  );
  return withSide(state, ctx.seat, { ...side, bench });
}

/** The first `max` Basic Energy uids in `seat`'s `source` zone (hand or discard)
    matching `energyType` (any Basic Energy when undefined), in zone order — what
    `attachEnergyFrom` moves onto a Pokémon. Same-type Basic Energy cards are
    fungible, so WHICH ones is not a decision and the leading matches are as good
    as any (the whole reason the op's only park is on the TARGET).

    ⚠️ FEWER THAN `max` IS NORMAL, NOT A FAILURE (D205). The printed clause is
    "attach UP TO N", so a hand holding one {R} against a `count: 2` op attaches
    one and says nothing — the same silent shortfall the older N-ops-in-sequence
    model produced when a later op found the zone empty. Callers must read the
    LENGTH rather than assume `max`. */
function attachableEnergies(
  state: GameState,
  seat: Seat,
  source: "hand" | "discard",
  energyType: string | undefined,
  max: number,
): string[] {
  if (max <= 0) return [];
  const zone = source === "hand" ? state.players[seat].hand : state.players[seat].discard;
  const found: string[] = [];
  for (const uid of zone) {
    const card = cardOf(state, uid);
    if (
      card !== undefined &&
      isEnergyCard(card) &&
      card.energyType === "Normal" && // "Normal" = a BASIC energy (Special is a special energy)
      (energyType === undefined || energyProvidesOf(card) === energyType)
    ) {
      found.push(uid);
      if (found.length === max) break;
    }
  }
  return found;
}

/** The first matching Basic Energy uid, or undefined — `attachableEnergies` at
    max 1, and the shape both the park guard and `programPlayable` want.

    ⚠️ IT STAYS A ONE-CARD QUESTION EVEN UNDER `count` (D205), and that is a
    finding rather than an oversight. `programPlayable` (cardplay.ts) refuses an
    Ability whose attach could only whiff — the gust/snipe "no legal target"
    precedent — and "up to 2" with ONE Energy in hand is not a whiff: it attaches
    one, exactly as printed. Gating on `count` matches instead would refuse the
    card on a board where it works, which is the louder failure of the two. */
export function firstAttachableEnergy(
  state: GameState,
  seat: Seat,
  source: "hand" | "discard",
  energyType: string | undefined,
): string | undefined {
  return attachableEnergies(state, seat, source, energyType, 1)[0];
}

/** The controller's own in-play Pokémon an ATTACH may target, as refs (Active
    first, then bench in index order), filtered by the printed riders
    (AttachTargetRiders, effects.ts): `targetType` keeps only those whose TOP card
    is that type (Gardevoir's "your {P} Pokémon"), `basicOnly` only Basics
    (Koraidon's), `ownerPokemon` only the printed owner-prefixed subgroup (Iono's
    Bellibolt ex's "1 of your Iono's Pokémon"), `benchOnly` drops the Active
    outright (Electric Generator's "your Benched {L} Pokémon"), and `notIfKO`
    drops any whose `bonusCounters` would Knock it Out ("you can't use this on a
    Pokémon that would be Knocked Out"), so the placed counters are always
    non-lethal. No riders → every own in-play Pokémon (the base ops' targets).

    ⚠️ **THIS FUNCTION IS THE IN-PLAY TARGET FILTER, AND IT IS THE ONLY GATE THAT
    MATTERS.** Every downstream check reads the PROMPT it produced, never the op:
    `validateChoice` (cardplay.ts) matches a wire answer against
    `prompt.candidates` / `prompt.targets`, so a target this function excluded is
    unreachable from a crafted frame by construction rather than by a second copy
    of the rule. That is why a rider added here needs no validation arm of its
    own — and why a rider added ANYWHERE ELSE would need one.

    ONE rule, two op-shaped readers — `attachEnergyFrom` (hand / discard source)
    and `attachFromTop` (the deck top) — which is why the parameter is the riders
    interface rather than either op type: an eligibility rule that drifted between
    the two would make the same board legal for one attach and not the other.
    Exported for programPlayable too: an attach with no eligible target can't be
    played (the gust/snipe precedent). */
export function attachEnergyTargets(
  state: GameState,
  seat: Seat,
  riders: AttachTargetRiders,
): PokemonRef[] {
  const side = state.players[seat];
  const eligible = (pokemon: InPlayPokemon): boolean => {
    if (
      riders.targetType !== undefined ||
      riders.basicOnly === true ||
      riders.ownerPokemon !== undefined
    ) {
      const card = topCardOf(state, pokemon);
      if (riders.targetType !== undefined && !(card?.types ?? []).includes(riders.targetType)) {
        return false;
      }
      if (riders.basicOnly === true && (card === undefined || !isBasicPokemon(card))) return false;
      // The owner-prefixed subgroup, read through `matchesFilter`'s OWN
      // `ownerPokemon` arm rather than re-implemented here. What is shared is the
      // PREDICATE, not the type: three conjuncts D200 established against the
      // live catalog — `category === "Pokemon"` (`Team Rocket's Energy` sv10-182
      // carries the prefix and is not a Pokémon), the exact-case name prefix with
      // its load-bearing trailing space, and the stage word when one is printed.
      // A board TOP card is always a Pokémon, so the category conjunct is inert
      // here; sharing the call anyway is what keeps the deck half and the board
      // half from ever disagreeing about who is an "Iono's Pokémon", which is the
      // whole failure a second copy of this rule would invite.
      //
      // NO `stage` HERE, and that is the print rather than an omission: not one
      // of the eight legal printings this rider unlocks narrows an IN-PLAY target
      // by stage ("1 of your Iono's Pokémon", "1 of your Benched N's Pokémon",
      // "your Marnie's Pokémon"). `basicOnly` beside it already carries the Basic
      // half if a printing ever wants it.
      if (
        riders.ownerPokemon !== undefined &&
        !matchesFilter(card, { kind: "ownerPokemon", owner: riders.ownerPokemon })
      ) {
        return false;
      }
    }
    if (riders.notIfKO === true && riders.bonusCounters !== undefined) {
      const hp = effectiveMaxHp(state, pokemon);
      if (hp !== null && pokemon.damage + riders.bonusCounters >= hp) return false;
    }
    return true;
  };
  const refs: PokemonRef[] = [];
  if (riders.benchOnly !== true && side.active !== null && eligible(side.active)) {
    refs.push({ seat, spot: { spot: "active" } });
  }
  side.bench.forEach((pokemon, index) => {
    if (eligible(pokemon)) refs.push({ seat, spot: { spot: "bench", index } });
  });
  return refs;
}

/** The printed "this Pokémon" as a (zero- or one-element) target list: the
    controller's in-play Pokémon whose TOP card is `ctx.sourceUid`. A top-card
    uid sits in exactly one spot, so at most one ref comes back — and EMPTY is a
    live answer, not an error, in two honest ways: the context carries no source
    at all (a Trainer program authored with `toSelf` — the field means nothing
    there), or the Pokémon is no longer a board TOP (evolved over, bounced,
    Knocked Out mid-program). Both fall into the op's usual whiff path, where
    the trailing shuffle still runs.

    By TOP uid, not stack membership, deliberately: a card evolved over is no
    longer "this Pokémon" — the body the printed sentence pointed at has a new
    top card, and an attach aimed at it would be the evolution's, not ours. */
function sourceRef(state: GameState, ctx: EffectContext): PokemonRef[] {
  if (ctx.sourceUid === undefined) return [];
  const side = state.players[ctx.seat];
  if (side.active !== null && topUid(side.active) === ctx.sourceUid) {
    return [{ seat: ctx.seat, spot: { spot: "active" } }];
  }
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === ctx.sourceUid);
  return index === -1 ? [] : [{ seat: ctx.seat, spot: { spot: "bench", index } }];
}

/** What an `attachFromTop` op is offering: the cards among the looked-at top `n`
    its filter admits (deck order, top first), the eligible targets, and the
    resolved cap.

    The cap is `min(printed, candidates.length)` for BOTH forms, which is what
    makes `"any"` ("attach any number") just the degenerate case rather than a
    branch: a card cannot be attached twice, so the whole candidate set is the
    real ceiling either way. Clamping the printed number too is what keeps the
    prompt honest — "up to 2" with one Basic {L} in the window is a pick of one,
    and a prompt saying `max: 2` there would have the dialog count "0/2" over a
    single row and invite a pick that does not exist.

    NOTE — this reads the DECK, so it is only ever asked at the moment the op
    runs. It is deliberately NOT a `programPlayable` input; see the op's own
    doc (effects.ts) for why that gate does not exist. */
function attachFromTopOffer(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "attachFromTop" }>,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  const top = state.players[seat].deck.slice(0, Math.max(0, op.n));
  const candidates = top.filter((uid) => matchesFilter(cardOf(state, uid), op.filter));
  return {
    candidates,
    targets: attachEnergyTargets(state, seat, op),
    max: Math.min(op.max === "any" ? candidates.length : op.max, candidates.length),
  };
}

/** What an `attachFromDeck` op is offering: the deck-wide matches for its filter
    (deck order), the eligible targets, and the resolved cap.

    **The collapse is the difference from `attachFromTopOffer`.** That one reads a
    window of `n` cards, so its candidate list is small by construction; this one
    reads the WHOLE deck, where a real list holds a dozen Basic {R} Energy. Twelve
    rows for a pick of three is one question wearing twelve hats, so the offer
    keeps at most `max` representatives per interchangeable class — the D42 rule
    the mandatory discards run on (`interchangeableCandidates`), with the same cap
    logic and for the same reason: a pick can never want more than `max` copies of
    one class, and the copies that survive are still interchangeable with each
    other, so every DISTINGUISHABLE answer remains reachable. Keying is
    `cardIdentity`, which reads a Basic Energy by what it PROVIDES — the catalog
    prints the same Basic Fire Energy under four ids (sve-002/-010/-018 plus
    sv03-230 "Basic Fire Energy", which `energyProvidesOf` reads identically), and
    an id key would offer
    them as three separate answers.

    There is no host to key on here (these cards are in a pile, attached to
    nothing), which is exactly why the discard collapse's `refKeyOf(from)` prefix
    is absent: WHICH Pokémon loses an Energy is always a real choice, but which of
    three identical Energy comes out of the deck never is.

    **THE CAP IS THE BOARD'S AS WELL AS THE PRINT'S**, for `attachFromTop`'s
    reason — "a prompt reading `max: 3` over a single row invites a pick that does
    not exist" — and this op has a SECOND way to be short. Three ceilings, and the
    real one is their minimum:
      • the printed `max` ("up to 2");
      • how many cards are actually there (the clamp attachFromTop already takes);
      • **`targets.length × maxPerTarget`**, which is the one a per-target rule
        introduces. Janine on the ordinary board — one {D} Pokémon — prints "up to
        2" and can legally attach exactly ONE, so a prompt saying 2 would have the
        dialog count "0/2" over a board where 1 is the ceiling, and invite a
        second pick the validator then refuses. Without a per-target rule this
        ceiling does not exist (one Pokémon can take every card), which is why it
        reads as `op.max` when the rider is absent rather than as `targets.length`.

    The board ceiling is taken BEFORE the collapse and the collapse runs at that
    cap, so the offer holds no representative the pick could not use: a pick that
    can only want one card is shown one row. The candidate clamp is then taken
    after, so it counts offered rows.

    NOTE — this reads the DECK, so it is only ever asked at the moment the op
    runs, and is deliberately NOT a `programPlayable` input (see the op's doc). */
function attachFromDeckOffer(
  state: GameState,
  ctx: EffectContext,
  op: Extract<EffectOp, { op: "attachFromDeck" }>,
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
  for (const uid of matches) {
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= cap) continue;
    kept.set(key, already + 1);
    candidates.push(uid);
  }
  return { candidates, targets, max: Math.min(cap, candidates.length) };
}

/** Apply a deck-search attach (Charizard ex "Infernal Reign" / Janine's Secret
    Art): move each assigned card out of the deck onto the Pokémon it was assigned
    to, and hand back the uids that ACTUALLY moved (§9.2 — the record).

    **`validateChoice` is the ONE gate** on what may be attached — the cap, the
    per-target cap, that every uid was offered, that no uid appears twice, and
    that every destination is an offered target. This function re-derives none of
    it, for `attachFromTopApply`'s reason: two readers of one rule drift. What it
    does carry is the same wire-safety every mover in this file carries — the DECK
    is re-read live and only uids actually sitting in it move, so a stale uid, a
    repeated one, or a target that is not on the board is SKIPPED rather than
    conjured. Dropping the bench-index check would silently DESTROY a card: the
    `bench.map` no-ops, the event fires, and the uid still leaves the deck.

    Each attach emits its own ENERGY_ATTACHED — the card lands face up on the
    board, so nothing else has to announce it, and in particular there is no
    "searched" event: what a search *found* is the controller's private business
    (they saw their own deck), and what it *took* is public through this. The
    target rides the event REBUILT field by field, never spread off the client's
    ref (the §2 copy contract).

    The deck keeps its order minus the taken cards; the trailing `shuffleDeck` op
    is what scrambles it, so a search that takes nothing still leaves the printed
    shuffle to the op that prints it. Never damages, so it never KOs and never
    touches the flow tail.

    Takes no `op`, unlike its from-the-top twin: with the cap, the filter, the
    window and the leftovers all belonging to somebody else, the assignments and
    the live deck are the whole input. */
function attachFromDeckApply(
  state: GameState,
  assignments: readonly { uid: string; to: PokemonRef }[],
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; attached: string[] } {
  const side = state.players[ctx.seat];
  const inDeck = new Set(side.deck);
  let active = side.active;
  let bench = side.bench;
  const attached = new Set<string>();
  for (const { uid, to } of assignments) {
    if (!inDeck.has(uid) || attached.has(uid) || to.seat !== ctx.seat) continue;
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
  if (attached.size === 0) return { state, attached: [] };
  return {
    state: withSide(state, ctx.seat, {
      ...side,
      active,
      bench,
      deck: side.deck.filter((uid) => !attached.has(uid)),
    }),
    attached: [...attached],
  };
}

/** Attach the first matching Basic Energy cards from `op.source` (hand/discard)
    onto the chosen own Pokémon `ref` (§6 energy acceleration) — ONE by default,
    `op.count` of them onto that SAME body when the print pins a batch. Re-finds
    the energy at apply time — fungible, so the parked decision was only the
    TARGET. Moves the cards OUT of their source zone and onto the Pokémon's
    energy, emitting one ENERGY_ATTACHED each (each host resolves by its own
    energy uid, robust to any same-batch move). This is not the §6.3 one-per-turn
    manual attach — no allowance is touched; it is the Ability's own effect. The
    `bonusCounters` rider then puts that many HP of damage counters on the same
    Pokémon (Gardevoir's 2) — always non-lethal, because attachEnergyTargets
    already excluded would-be-KO'd targets (notIfKO), so this op never KOs and
    never touches the flow tail.

    ⚠️ `count` ATTACHES TO THE ONE `ref` AND NEVER RE-ASKS (D205). That is the
    entire difference from the older model of "N of these ops in a program",
    which parks N times and may land on N different bodies: Ethan's Ho-Oh ex
    "Golden Flame" prints *"attach up to 2 … to **1 of** your Benched Ethan's
    Pokémon"*, and a split across two bodies is a rule the card does not print.
    Fewer than `count` matching Energy attaches what there is, silently — the
    printed "up to", and the same shortfall the sequential model produced when a
    later op found nothing left.

    ⚠️ `bonusCounters` FIRES ONCE PER OP, NOT ONCE PER CARD, and the two riders
    do not co-occur on any printing in the catalog (asserted in the slice suite,
    not assumed here). Once-per-op is the reading that leaves every pre-D205
    program byte-identical, which is the only one this change is entitled to
    make; a printing that combines them would owe its own argument. */
function attachEnergyFrom(
  state: GameState,
  op: Extract<EffectOp, { op: "attachEnergyFrom" }>,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (ref.seat !== ctx.seat) return state;
  const energyUids = attachableEnergies(
    state,
    ctx.seat,
    op.source,
    op.energyType,
    op.count ?? 1, // absent = the single attach every pre-D205 program meant
  );
  if (energyUids.length === 0) return state;
  const side = state.players[ctx.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (pokemon === undefined || pokemon === null) return state;
  const targetUid = topUid(pokemon);
  if (targetUid === undefined) return state;
  let updated: InPlayPokemon = { ...pokemon, energy: [...pokemon.energy, ...energyUids] };
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
  if (ref.spot.spot === "active") return withSide(state, ctx.seat, { ...base, active: updated });
  const index = (ref.spot as { index: number }).index;
  return withSide(state, ctx.seat, {
    ...base,
    bench: side.bench.map((p, i) => (i === index ? updated : p)),
  });
}

/** Apply a from-the-top attach (Electric Generator / Hydreigon "Tri Howl"): move
    each assigned card off the deck TOP onto the Pokémon it was assigned to, then
    settle the leftovers clause.

    **`validateChoice` is the ONE gate** on what may be attached: it alone
    enforces the cap, that every uid was offered (so the filter and the window
    boundary hold), that no uid appears twice, and that every destination is an
    offered target. This function re-derives nothing — duplicating those rules
    here would be two readers that can drift, which is the shape this codebase
    keeps collapsing. What it does carry is wire-safety of the same kind
    searchMove / moveEnergyApply carry: the looked-at WINDOW is re-read off the
    live deck and only uids actually sitting in it move, so a stale uid, a
    repeated one, or a target that is not there is SKIPPED rather than conjured —
    a card is never duplicated, and never lands in neither zone (drop the
    bench-index check and an out-of-range target silently deletes a card: the
    `bench.map` no-ops, the event fires, and the uid still leaves the deck). Each
    attach emits its own ENERGY_ATTACHED, the same event the hand/discard attach
    uses: the card lands face up on the board, so nothing else has to announce it.
    The target rides the event REBUILT field by field, never spread off the
    client's ref (the §2 copy contract — see moveEnergyApply).

    The leftovers run LAST and on EVERY path, including the empty ones stepOp
    routes here: `discardRest` (Hydreigon's "Discard the other cards") is a cost
    the card charges whether or not the look found anything to attach, and one
    apply is what keeps a branch from skipping it. `discardRest` absent (Electric
    Generator) leaves the unattached cards exactly where they are — still on top
    of the deck, for the trailing `shuffleDeck` op to scramble.

    Never damages, so it never KOs and never touches the flow tail. */
function attachFromTopApply(
  state: GameState,
  assignments: readonly { uid: string; to: PokemonRef }[],
  op: Extract<EffectOp, { op: "attachFromTop" }>,
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
  const rest = op.discardRest === true ? window.filter((uid) => !attached.has(uid)) : [];
  if (attached.size === 0 && rest.length === 0) return state;
  const removed = new Set([...attached, ...rest]);
  // Own deck, own action: `actor` IS `seat` here and cannot be anything else — this
  // op only ever looks at `ctx.seat`'s own top. That equality is what makes the row
  // read in the ACTIVE voice (D153); it is written out rather than left implicit
  // because a future from-the-top op aimed at the opponent's deck would have to
  // change it, and a hardcoded `actor: ctx.seat` is a line such a slice must edit.
  if (rest.length > 0)
    events.push({ type: "DECK_TOP_DISCARDED", seat: ctx.seat, actor: ctx.seat, uids: [...rest] });
  return withSide(state, ctx.seat, {
    ...side,
    active,
    bench,
    deck: side.deck.filter((uid) => !removed.has(uid)),
    discard: rest.length === 0 ? side.discard : [...side.discard, ...rest],
  });
}

/** Move the chosen Energy `uids` off their source Pokémon onto the controller's
    own `destRef` (Energy Switch / Poppy). validateChoice already proved every uid
    is on ONE source Pokémon distinct from the destination; this re-finds each on
    the live board (wire-safety, like searchMove/retrieveMove) and moves only those
    actually attached to an own in-play Pokémon OTHER than the destination — a stale
    or self-targeting uid is skipped, never duplicated. The Pokémon stay put (no
    bench compaction), so the ENERGY_MOVED `from`/`to` targets are valid against
    the post-state. Atomic: strip then re-attach in one reduction, so an Energy is
    never left detached. */
function moveEnergyApply(
  state: GameState,
  uids: readonly string[],
  destRef: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (uids.length === 0 || destRef.seat !== ctx.seat) return state;
  const side = state.players[ctx.seat];
  const destSpot = destRef.spot;
  const picks = new Set(uids);
  // The one source target the moved Energy came from (validateChoice guarantees a
  // single source) — recorded as the first non-destination Pokémon a pick sits on.
  let from: PokemonTarget | undefined;
  // …and its TOP uid, for the event (D171 — the source may be Knocked Out later in
  // this same reduction, and a spot cannot name a Pokémon that has left play).
  let fromUid: string | undefined;
  const moved: string[] = [];
  const isDest = (target: PokemonTarget): boolean =>
    destSpot.spot === target.spot &&
    (destSpot.spot === "active" || destSpot.index === (target as { index: number }).index);
  const strip = (pokemon: InPlayPokemon, target: PokemonTarget): InPlayPokemon => {
    if (isDest(target)) return pokemon; // never strip the destination (no self-move)
    const kept = pokemon.energy.filter((uid) => {
      if (picks.has(uid)) {
        moved.push(uid);
        if (from === undefined) {
          from = target;
          fromUid = topUid(pokemon);
        }
        return false;
      }
      return true;
    });
    return kept.length === pokemon.energy.length ? pokemon : { ...pokemon, energy: kept };
  };
  const activeStripped = side.active === null ? null : strip(side.active, { spot: "active" });
  const benchStripped = side.bench.map((pokemon, index) =>
    strip(pokemon, { spot: "bench", index }),
  );
  if (moved.length === 0 || from === undefined) return state; // nothing actually moved
  // Re-attach onto the destination, read off the stripped board (the destination
  // was never stripped, so this can't drop a just-moved uid).
  const addTo = (pokemon: InPlayPokemon): InPlayPokemon => ({
    ...pokemon,
    energy: [...pokemon.energy, ...moved],
  });
  let active = activeStripped;
  let bench = benchStripped;
  if (destSpot.spot === "active") {
    if (active === null) return state;
    active = addTo(active);
  } else {
    if (benchStripped[destSpot.index] === undefined) return state;
    bench = benchStripped.map((pokemon, index) =>
      index === destSpot.index ? addTo(pokemon) : pokemon,
    );
  }
  // The destination is REBUILT field by field, never spread off `destSpot` — that
  // object came from the WIRE. `validateChoice` proves it `refEquals` an offered
  // ref, but refEquals compares only seat/spot/index, so any extra key a client
  // hangs on it (`{spot:"active", index:99, evil:"…"}`) rides the spread straight
  // into an event that is handed to the animator, the log and, in P4, broadcast to
  // both players. The state was always safe (the extra keys are inert); the EVENT
  // is the §2 copy contract, and a copy of attacker-controlled data is not a copy
  // of the engine's own value.
  const to: PokemonTarget =
    destSpot.spot === "active" ? { spot: "active" } : { spot: "bench", index: destSpot.index };
  events.push({
    type: "ENERGY_MOVED",
    seat: ctx.seat,
    uids: [...moved],
    from,
    ...(fromUid === undefined ? {} : { fromUid }),
    to,
  });
  return withSide(state, ctx.seat, { ...side, active, bench });
}

/** Discard the chosen Energy `uids` off the VICTIM's Pokémon into the VICTIM's
    discard pile — the cards are the host owner's, so they go to that owner's own
    pile (the §8.1 KO cleanup rule, applied to a single Energy). The victim is the
    opponent for the hammer arms and the CONTROLLER for `yourActive` (the §8
    self-discard cost), which is exactly why the pile is read off `op` rather than
    hardcoded to the opponent. validateChoice already proved every uid was offered
    and that no Pokémon gives up two; this re-finds each on the live board
    (wire-safety, like moveEnergyApply) and takes only those actually attached, so
    a stale uid is skipped rather than conjured. Emits ONE event per affected
    Pokémon (Giacomo hits several), in board order — the Pokémon stay put (no
    bench compaction), so each `from` target resolves against the post-state.
    Never damages, so it never KOs. */
function discardEnergyApply(
  state: GameState,
  uids: readonly string[],
  op: Extract<EffectOp, { op: "discardEnergy" }>,
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; discarded: string[] } {
  if (uids.length === 0) return { state, discarded: [] };
  const victim = discardVictimSeat(ctx.seat, op);
  const side = state.players[victim];
  const picks = new Set(uids);
  // Per affected Pokémon: the spot it sits on and what came off it. Collected in
  // one pass so the events read Active-then-bench, the board's own order.
  // `host` is captured HERE, off the pre-strip stack: an attack can take Energy
  // off a defender its own damage Knocked Out, and by the time the batch renders
  // that slot is empty — so the event names the Pokémon by uid, not by spot.
  const pulled: { target: PokemonTarget; host: string; uids: string[] }[] = [];
  const strip = (pokemon: InPlayPokemon, target: PokemonTarget): InPlayPokemon => {
    const taken: string[] = [];
    const kept = pokemon.energy.filter((uid) => {
      if (!picks.has(uid)) return true;
      taken.push(uid);
      return false;
    });
    if (taken.length === 0) return pokemon;
    pulled.push({ target, host: topUid(pokemon) ?? "", uids: taken });
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
    });
  }
  return {
    state: withSide(state, victim, {
      ...side,
      active,
      bench,
      discard: [...side.discard, ...discarded],
    }),
    discarded,
  };
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

/** The board a `discardEnergy` op takes Energy OFF: the controller's own for
    `yourActive` (the §8 self-discard attack cost), the opponent's for the three
    hammer arms. One helper so the candidate scan and the apply can never
    disagree about whose Pokémon is stripped and whose discard pile it lands in. */
function discardVictimSeat(seat: Seat, op: Extract<EffectOp, { op: "discardEnergy" }>): Seat {
  return op.from === "yourActive" || op.from === "yours" ? seat : otherSeat(seat);
}

/** The Energy a `discardEnergy` op may take, in board order — the two `…Active`
    arms see only that Active, the other two the whole victim board. Exported for
    programPlayable: a top-level discard with nothing to take can only whiff (the
    gust / moveEnergy precedent). */
export function discardableEnergies(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "discardEnergy" }>,
): { uid: string; from: PokemonRef }[] {
  const activeOnly = op.from === "opponentActive" || op.from === "yourActive";
  return attachedEnergies(
    state,
    discardVictimSeat(seat, op),
    op.filter,
    activeOnly ? "active" : "all",
  );
}

/** What a card IS, for the purpose of "would taking this one rather than that
    one make any difference?" — the interchangeability key behind both mandatory
    discards: `interchangeableCandidates` (Energy attached to the board, keyed
    together with its HOST) and `handCostCandidates` (cards in hand, where there
    is no host and this key is the whole story).

    A **Basic** Energy has no identity beyond the type it provides: the
    catalog prints the very same Basic Fire Energy under several ids (sve-002 /
    sve-010 / sve-018, identical in every field that matters), so keying on the id
    would treat three interchangeable Fire Energy in one real deck as three
    separate answers. This is exactly the fungibility `attachEnergyFrom` already
    asserts ("same-type Basic Energy is fungible, so the only decision is the
    TARGET"), read from the other end.

    Everything else keys on the catalog **id**: two Special Energy prints carry
    different rules text, so only two copies of the SAME print are interchangeable.
    The `basic:` / `card:` prefixes keep the two spaces apart, so a Basic Fire and
    a Special Energy that happens to provide {R} never collapse into each other.
    A uid with no catalog card gets a key of its own — park and ask rather than
    guess. (Unreachable today: `attachedEnergies` filters through
    `matchesAttached`, whose card-only arm rejects an unresolvable card and whose
    `providesEnergy` arm reads that card's provision, so no such uid can enter the
    candidate list. Kept because the fallback costs nothing and the alternative is
    a silent collapse of things this function cannot actually compare. The hand
    reader can reach it: an unresolvable uid there is filtered out before the key
    is taken, so this stays the belt to that braces.) */
function cardIdentity(state: GameState, uid: string): string {
  const card = cardOf(state, uid);
  if (card === undefined) return `?${uid}`;
  return isEnergyCard(card) && card.energyType === "Normal"
    ? `basic:${energyProvidesOf(card)}`
    : `card:${card.id}`;
}

/** The discardable Energy with INTERCHANGEABLE candidates collapsed to at most
    `cap` representatives each, board order preserved — the set the player is
    actually asked about.

    Two candidates are interchangeable when they are the same Energy (above) on
    the same Pokémon: discarding either leaves the identical board and puts an
    identical card in the identical owner's discard pile, so offering both is one
    question wearing two hats. WHICH POKÉMON loses the Energy is ALWAYS a real
    choice, so the key includes the host: two identical Basic Energy on two
    different Pokémon stay two candidates.

    `cap` is how many the pick could possibly want from one class — 1 for the
    single-Energy arms, N for an exact-N discard. Keeping N rather than 1 is what
    makes "Discard 3 Energy" off three identical {F} + one {W} answerable at all
    (collapsing to one {F} would leave two candidates for a three-card pick); the
    surviving copies within a class are still interchangeable with each other, so
    the DISTINGUISHABLE answers are the ways to split the count across classes.

    Collapsing here rather than at the park is what makes Houndoom's "Fire Blast"
    with three {R} attached resolve with no prompt at all: one representative
    remains, and the forced-pick rule below sees an offer no bigger than the
    count. */
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

/** The picks a discardEnergy makes with NO choice left in it (the M1 doctrine),
    or null when the player must decide. Runs over the COLLAPSED candidate set
    above, so "as many candidates as the count" already means "as many
    DISTINGUISHABLE ones".
    "total": the offer holds no more than the count — every candidate comes off,
    which covers both the exact fit (one candidate for "an Energy"; three for
    Koraidon's "Discard 3") and the SHORT board, where "do as much as you can"
    takes everything there is and asks nothing.
    "each": every affected Pokémon has exactly one — the common Giacomo board,
    where "one Special Energy off each" names itself. */
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

/** A stable key for grouping/comparing refs inside the interpreter (cardplay.ts
    has its own copy for wire validation — the two never share a value). */
function refKeyOf(ref: PokemonRef): string {
  return `${ref.seat}:${ref.spot.spot}:${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
}

/** A moveEnergy op does something iff the controller has ≥1 Energy the filter
    admits AND ≥2 of their own Pokémon in play (a source WITH a distinct
    destination). Exported for programPlayable: a play that could only whiff can't
    be made (the gust / attachEnergyFrom precedent). */
export function moveEnergyPlayable(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "moveEnergy" }>,
): boolean {
  const { movable, destinations, needed } = moveEndpoints(state, seat, op);
  return op.max > 0 && movable.length > 0 && destinations.length >= needed;
}

/** What a `moveEnergy` op can take, where it can put it, and how many
    destinations that route needs to be worth asking about — ONE rule with two
    readers (the op's own no-op test and the `programPlayable` gate above), for
    the same reason the filter reads provision through one helper: the play gate
    and the play itself disagreeing is how a card becomes playable and then does
    nothing, or is refused while a legal move existed.

    The free route (Energy Switch / Poppy) takes from anywhere and needs TWO
    Pokémon in play, because the source is also a candidate destination and a
    Pokémon may not move Energy onto itself. `benchToActive` (Armarouge) takes
    from the bench alone and its sole destination is the Active, so source and
    destination are disjoint by construction and ONE destination is enough — a
    bench source already had to exist for `movable` to be non-empty.

    A vacant Active makes `destinations` empty and the route a no-op. That state
    is not reachable through the action API today (the Active spot is only empty
    during a `ko:promote` park, where `turnGate` refuses `useAbility` and
    `playTrainer` outright), which is why it is asserted here rather than tested
    from a board — but it is asserted in exactly one place now, so it cannot rot
    in two of three copies.

    `koedActiveToToolHolder` (D171, Exp. Share sv01-174) is the MIRROR of
    `benchToActive` and the first route to pin its destination by UID: sources are
    the ACTIVE alone (the body being Knocked Out — "from that Pokémon"), and the
    sole destination is whichever in-play Pokémon carries `sourceUid`, which for a
    Tool-borne program is the TOOL's own uid ("the Pokémon this card is attached
    to"). ONE destination is enough for the same reason it is on `benchToActive` —
    source and destination are disjoint by construction, here because the holder is
    explicitly excluded from being the Active. `sourceUid` is threaded rather than
    read off `ctx` because `moveEnergyPlayable` (the programPlayable gate) has no
    context: it passes none, this route then offers no destination, and a top-level
    Trainer authored with it is refused as a would-only-whiff play — which is
    correct, since the route is only ever reachable from a Tool's on-KO trigger. */
function moveEndpoints(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "moveEnergy" }>,
  sourceUid?: string,
): { movable: { uid: string; from: PokemonRef }[]; destinations: PokemonRef[]; needed: number } {
  const benchToActive = op.route === "benchToActive";
  const toToolHolder = op.route === "koedActiveToToolHolder";
  const active = state.players[seat].active;
  if (toToolHolder) {
    const holder = sourceUid === undefined ? undefined : toolHolderRef(state, seat, sourceUid);
    return {
      movable: attachedEnergies(state, seat, op.filter, "active"),
      // ⚠️ NO "the holder must not BE the source" TEST HERE, and its absence is
      // deliberate: that rule already has two owners and a third would be code no
      // board can reach. `koToolTriggersOf` (triggers.ts) SKIPS the KO'd body, so
      // a self-attached Exp. Share never seeds the stage that reaches this line —
      // and `validateChoice`'s "cannot move a Pokémon's Energy onto itself" is the
      // wire belt underneath. A mutation pass confirmed a guard here to be
      // unkillable: removing it failed nothing, because nothing can arrive.
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

/** The in-play Pokémon on `seat`'s board carrying the POKÉMON TOOL `toolUid` —
    the printed "the Pokémon this card is attached to" (D171).

    ⚠️ DELIBERATELY NOT `sourceRef`. That helper answers "this Pokémon" and matches
    on the TOP CARD's uid, which is right for every program printed ON a Pokémon and
    wrong for every program printed on a Tool: a Tool is never a stack top, so
    `sourceRef` would return EMPTY for a Tool-borne program and the sentence's own
    subject would silently vanish. Two phrases, two readers. */
function toolHolderRef(state: GameState, seat: Seat, toolUid: string): PokemonRef | undefined {
  const side = state.players[seat];
  if (side.active?.tools.includes(toolUid) === true) {
    return { seat, spot: { spot: "active" } };
  }
  const index = side.bench.findIndex((pokemon) => pokemon.tools.includes(toolUid));
  return index === -1 ? undefined : { seat, spot: { spot: "bench", index } };
}

/** A discardEnergy op does something iff the victim's board (or, for the two
    `…Active` arms, that Active) holds ≥1 Energy the filter admits. Exported
    for programPlayable — a play that could only whiff can't be made, so Giacomo
    into a board with no Special Energy is rejected rather than burning the turn's
    one Supporter (§7.2). Crushing Hammer is covered too: programPlayable descends
    into a `coinFlipGate`'s heads branch, since a coin gate has no `otherwise` and
    the flip is procedure rather than effect (see cardplay.ts). */
export function discardEnergyPlayable(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "discardEnergy" }>,
): boolean {
  return discardableEnergies(state, seat, op).length > 0;
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
  return BENCH_MAX - state.players[seat].bench.length;
}

function cardOf(state: GameState, uid: string): Card | undefined {
  const id = state.cardIdByUid[uid];
  return id === undefined ? undefined : state.cardPool[id];
}

/** The chooseCards note for a deck search — the printed "Search your deck for
    [up to N] {noun} [onto your Bench | into your hand]".

    Reads its noun off the SHARED `retrieveNoun` table, like the retrieval and
    look-at-top notes beside it. It used to carry a second, hand-rolled table that
    spelled only the SINGULAR, so the plural branch prefixed a count onto an
    ARTICLE: "Search your deck for up to 2 **a Basic Water Energy** into your
    hand."

    That was a LIVE bug on a SHIPPED card, not a latent one this slice tripped:
    **Chien-Pao ex "Shivery Chill"** (four catalog prints) is a `basicEnergy`
    search at max 2 and has read that way since it was authored. It survived
    because no test asserted any search note at all — the plural branch's only
    other reader is `byName` (Flamigo's "up to 3 Flamigo"), which reads correctly
    because that noun carries no article. Both forms are pinned by tests now. */
function searchNote(filter: CardFilter, dest: "bench" | "hand", max: number): string {
  const { singular, plural } = retrieveNoun(filter);
  const where = dest === "bench" ? "onto your Bench" : "into your hand";
  return max > 1
    ? `Search your deck for up to ${max} ${plural} ${where}.`
    : `Search your deck for ${singular} ${where}.`;
}

/** The chooseCards note for a discard-pile retrieval — reproduces the printed
    verb ("Put" into hand / "Shuffle" into deck) and a noun that reads like the
    card text (Energy Retrieval / Pal Pad / Super Rod). Every retrieval Item in
    scope has max ≥ 2, so the plural is what ships; the singular fallback stays
    total. Nouns are spelled per kind rather than "+s" so "Pokémon" stays
    invariant.

    `excluded` reproduces Superior Energy Retrieval's printed parenthetical. The
    player WATCHES the two cards they paid land in the public discard pile (the
    playmat renders it) and is then handed an offer those two are missing from —
    so without this the dialog silently contradicts what the board shows. The
    card answers it in so many words, and the engine already knows the answer. */
function retrieveNote(
  filter: CardFilter,
  dest: "hand" | "deck",
  max: number,
  excluded: boolean,
): string {
  const { singular, plural } = retrieveNoun(filter);
  const verb = dest === "hand" ? "Put" : "Shuffle";
  const where = dest === "hand" ? "into your hand" : "into your deck";
  const note =
    max > 1
      ? `${verb} up to ${max} ${plural} from your discard pile ${where}.`
      : `${verb} ${singular} from your discard pile ${where}.`;
  return excluded
    ? `${note} (You can't choose a card you discarded with the effect of this card.)`
    : note;
}

/** The chooseCards note for a lookAtTopN (Great Ball / Pokégear 3.0) —
    reproduces the printed "Look at the top N cards … and put a {noun} into your
    hand." Both cards in scope take at most 1 (the singular), but the plural stays
    total for a future look-at-top that takes several. Reuses retrieveNoun for the
    filter's noun phrase (anyPokemon → "a Pokémon"; supporter → "a Supporter card"). */
function lookNote(filter: CardFilter, n: number, max: number): string {
  const { singular, plural } = retrieveNoun(filter);
  return max > 1
    ? `Look at the top ${n} cards of your deck and put up to ${max} ${plural} into your hand.`
    : `Look at the top ${n} cards of your deck and put ${singular} into your hand.`;
}

/** The attachCards prompt string (Electric Generator / Hydreigon "Tri Howl") —
    the printed "Look at the top N cards of your deck and attach [up to N | any
    number of] {noun} you find there to your [Benched] [{type}] Pokémon in any way
    you like." Built from the OP, not from any text: Hydreigon's is an Ability,
    whose printed sentence also carries the "Once during your turn, you may" and
    the leftovers clause, neither of which belongs in a prompt asking what to
    attach. The noun comes from retrieveNoun, so it reads as the PRINT the filter
    scans for ("Basic Lightning Energy cards", "Energy cards"), matching the card
    names in the rows below it; the target type spells out in full ("Lightning"),
    the same choice energyNoun makes for the same reason.

    The two clauses kept from the print earn their place: **"you find there"** is
    what tells the player the rows are the window and not the deck at large, and
    **"in any way you like"** is the only cue that both Energy may go on ONE
    Pokémon — the misconception the dialog's shape otherwise invites (§15.E). */
/** The printed noun phrase for an attach's eligible TARGETS — the words after
    "your" in "attach it to your **Benched {L} Pokémon**". Built from the same
    `AttachTargetRiders` the candidate set is built from, and spelled ONCE for the
    three prompts that need it (attachFromTop's, attachFromDeck's, and the plain
    attachEnergyFrom park), because a caption that named a wider set than the
    rows below it is the dialog contradicting its own validator — the rule
    `attachFromDeckNote` already states about "in any way you like".

    Word order is the print's: "Benched", then the type, then the owner —
    "your **Benched Ethan's** Pokémon", "your **Benched {L}** Pokémon". No legal
    printing spells a type AND an owner, so their relative order is a convention
    rather than a reading; the zone word leading is not (every card that prints
    "Benched" prints it first). `basicOnly` and `notIfKO` are deliberately NOT
    spelled: Koraidon's caption has never carried "Basic" and adding it here would
    be a silent change to an unrelated card's prompt, while "that wouldn't be
    Knocked Out" is a rule about the OFFER, which the offered rows already say. */
function attachTargetNoun(riders: AttachTargetRiders): string {
  return `${riders.benchOnly === true ? "Benched " : ""}${
    riders.targetType === undefined ? "" : `${riders.targetType} `
  }${ownerNoun(riders.ownerPokemon)}Pokémon`;
}

/** The printed possessive fragment of an owner-prefixed subgroup noun — `"Team
    Rocket"` → `"Team Rocket's "`, absent → `""` — so `${ownerNoun(o)}Pokémon`
    reads as the card does. ONE spelling for every prompt that names a subgroup
    (D205): the three attach captions through `attachTargetNoun`, and the counter
    move's own "off which of your Benched Team Rocket's Pokémon?".

    Small enough to inline and factored out anyway, for the reason the predicate
    itself is shared: the possessive is the load-bearing character. D204's one
    surviving mutant was `startsWith(owner)` WITHOUT it, and a caption that
    dropped it would say "your Benched Team Rocket Pokémon" — naming a subgroup
    no card prints, in a prompt whose whole job is to say which bodies are
    offered. Two copies of that string is two places for it to go missing. */
function ownerNoun(owner: string | undefined): string {
  return owner === undefined ? "" : `${owner}'s `;
}

/** Narrow a candidate ref list to the bodies whose TOP card is in the printed
    owner-prefixed subgroup, or return it unchanged when no owner is printed.

    ⚠️ THE PREDICATE IS SHARED, NOT RE-IMPLEMENTED — `matchesFilter`'s own
    `ownerPokemon` arm (D200), which `attachEnergyTargets` already calls on the
    attach side (D204). This is that call's THIRD read site and its first outside
    the attach family, and sharing it is the whole point: "a Team Rocket's
    Pokémon" must mean the same three conjuncts to a deck search, to an attach
    target and to a counter-move source, or a player learns one rule and the
    engine enforces two. */
function subgroupRefs(
  state: GameState,
  refs: PokemonRef[],
  owner: string | undefined,
): PokemonRef[] {
  if (owner === undefined) return refs;
  return refs.filter((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
    if (body === undefined || body === null) return false;
    return matchesFilter(topCardOf(state, body), { kind: "ownerPokemon", owner });
  });
}

function attachNote(op: Extract<EffectOp, { op: "attachFromTop" }>): string {
  const { plural } = retrieveNoun(op.filter);
  const how = op.max === "any" ? "any number of" : `up to ${op.max}`;
  const where = attachTargetNoun(op);
  return `Look at the top ${op.n} cards of your deck and attach ${how} ${plural} you find there to your ${where} in any way you like.`;
}

/** The attachCards prompt string for a deck SEARCH (Charizard ex "Infernal
    Reign" / Janine's Secret Art) — the printed "Search your deck for up to N
    {noun} and attach [them|it] to your [{type}] Pokémon [in any way you like]".

    Built from the OP, like `attachNote`: both consumers print more around this
    clause than belongs in a prompt asking what to attach (Charizard's is a
    triggered Ability whose sentence opens "When you play this Pokémon…", and both
    end in "Then, shuffle your deck", which is the NEXT op's business).

    The wordings this switches between are the printed ones. `toSelf` is the
    printed "attach it to **this Pokémon**" (Pawmot "Electrogenesis") — kept
    verbatim, because the offered target row alone cannot say that the CHOICE of
    destination is not one. Otherwise the difference is exactly `maxPerTarget`:
      • absent → "**in any way you like**", the only cue that several Energy may
        go on ONE Pokémon (§15.E — the misconception the dialog's shape invites);
      • present → the phrase is a lie, so it is dropped and replaced by what
        Janine actually prints — "for each of those Pokémon", one apiece. Saying
        "in any way you like" over a prompt that rejects two on one Pokémon would
        be the dialog contradicting the validator. */
function attachFromDeckNote(op: Extract<EffectOp, { op: "attachFromDeck" }>): string {
  const { singular, plural } = retrieveNoun(op.filter);
  if (op.toSelf === true) {
    return op.max > 1
      ? `Search your deck for up to ${op.max} ${plural} and attach them to this Pokémon.`
      : `Search your deck for ${singular} and attach it to this Pokémon.`;
  }
  const where = attachTargetNoun(op);
  if (op.maxPerTarget !== undefined) {
    // "attach 1 to each", not "attach a Basic Darkness Energy card to each" —
    // the noun is already in the first clause, and repeating it there produced a
    // sentence long enough that the per-target rule stopped being the thing the
    // reader noticed, which is the one thing this branch exists to say.
    const each = op.maxPerTarget === 1 ? "1" : `up to ${op.maxPerTarget}`;
    return `Search your deck for up to ${op.max} ${plural} and attach ${each} to each of up to ${op.max} of your ${where}.`;
  }
  return op.max > 1
    ? `Search your deck for up to ${op.max} ${plural} and attach them to your ${where} in any way you like.`
    : `Search your deck for ${singular} and attach it to your ${where}.`;
}

/** The moveEnergy prompt string (Energy Switch / Poppy) — the printed "Move [up
    to N] {noun} from 1 of your Pokémon to another of your Pokémon". Only the two
    filters those cards use are spelled (Basic Energy / Energy); a future filter
    falls back to the generic "Energy". */
function moveNote(op: Extract<EffectOp, { op: "moveEnergy" }>): string {
  const noun =
    op.filter.kind === "basicEnergy"
      ? `Basic ${op.filter.energyType === undefined ? "" : `${op.filter.energyType} `}Energy`
      : energyNoun(op.filter);
  const where =
    op.route === "benchToActive"
      ? "from 1 of your Benched Pokémon to your Active Pokémon"
      : op.route === "koedActiveToToolHolder"
        ? // D171 — Exp. Share's printed second half, verbatim. The prompt is the
          // ONLY thing that names this card to the player (a Tool emits no
          // ABILITY_TRIGGERED row), so it says what the card says.
          "from that Pokémon to the Pokémon this card is attached to"
        : "from 1 of your Pokémon to another of your Pokémon";
  // "an Energy", "a Basic Energy", "a Fire Energy" — the article follows the noun,
  // the same rule discardNote applies. Unreachable at max 1 today (the only
  // `anyEnergy` mover is Poppy at max 2, which takes the "up to" branch), which is
  // precisely why it read "Move a Energy" unnoticed.
  const article = noun === "Energy" ? "an" : "a";
  return op.max > 1
    ? `Move up to ${op.max} ${noun} ${where}.`
    : `Move ${article} ${noun} ${where}.`;
}

/** How a filter's Energy reads inside a prompt sentence. Only the filters the
    energy ops actually carry are spelled; anything else stays the generic
    "Energy".

    A TYPED one reads as its full type name ("a Fire Energy"), not the printed
    brace code ("a {R} Energy"), even though two of the five cards in the family
    print the code. The note is built from the OP, not from any text — Armarouge's
    is an authored Ability with no printed attack sentence at all — and the rows
    the player then clicks are card NAMES ("Fire Energy"), so the heading and the
    offer speak one vocabulary. */
function energyNoun(filter: CardFilter): string {
  if (filter.kind === "specialEnergy") return "Special Energy";
  if (filter.kind === "providesEnergy") return `${filter.energyType} Energy`;
  return "Energy";
}

/** The discardEnergy prompt string — reproduced from the printed sentence, so
    the dialog's heading IS the card's own instruction (Crushing Hammer "…from 1
    of your opponent's Pokémon", Giacomo "…from each of…", Mawile "…from your
    opponent's Active Pokémon", Corviknight "Discard 2 Energy from this Pokémon").
    Only the two filters those cards use are spelled; any other reads as the
    generic "an Energy". `count: "all"` never reaches here — that arm asks
    nothing, so it has no prompt to caption. */
function discardNote(op: Extract<EffectOp, { op: "discardEnergy" }>): string {
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
  switch (op.from) {
    case "opponentActive":
      return `Discard ${what} from your opponent's Active Pokémon.`;
    case "opponentChosen":
      return `Discard ${what} from 1 of your opponent's Pokémon.`;
    case "opponentEach":
      return `Discard ${what} from each of your opponent's Pokémon.`;
    case "yourActive":
      // The printed attack sentence verbatim — "this Pokémon" is the Active (§8).
      return `Discard ${what} from this Pokémon.`;
    case "yours":
      // The printed "from your Pokémon" — the whole own board (Hail Blade).
      return `Discard ${what} from your Pokémon.`;
  }
}

/** The noun phrase (singular / plural) each filter reads as in a retrieval note. */
function retrieveNoun(filter: CardFilter): { singular: string; plural: string } {
  switch (filter.kind) {
    case "anyPokemon":
      return { singular: "a Pokémon", plural: "Pokémon" };
    case "supporter":
      return { singular: "a Supporter card", plural: "Supporter cards" };
    case "pokemonOrBasicEnergy":
      return {
        singular: "a Pokémon or Basic Energy card",
        plural: "Pokémon or Basic Energy cards",
      };
    case "anyEnergy":
      return { singular: "an Energy card", plural: "Energy cards" };
    case "specialEnergy":
      return { singular: "a Special Energy card", plural: "Special Energy cards" };
    case "byName":
      return { singular: filter.name, plural: filter.name };
    case "basicPokemon":
      return filter.noRuleBox === true
        ? {
            singular: "a Basic Pokémon that doesn't have a Rule Box",
            plural: "Basic Pokémon that don't have a Rule Box",
          }
        : { singular: "a Basic Pokémon", plural: "Basic Pokémon" };
    case "evolutionPokemon":
      return { singular: "an Evolution Pokémon", plural: "Evolution Pokémon" };
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
    case "toolCard":
      return { singular: "a Pokémon Tool card", plural: "Pokémon Tool cards" };
    case "basicEnergy": {
      const kind = filter.energyType === undefined ? "Basic" : `Basic ${filter.energyType}`;
      return { singular: `a ${kind} Energy card`, plural: `${kind} Energy cards` };
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
