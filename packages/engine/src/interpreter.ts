import type { Attack, Card } from "@luminous/schema";
import {
  activeTop,
  applyDamageModifier,
  attacksOf,
  // 🆕 D374 — the FIRST uid→Card resolution in this file. Every other name read here
  // goes through `topCardOf` (a Pokémon's identity is its stack TOP, §1.2); an
  // ATTACHED Energy is a bare uid with no stack, so it resolves through the same
  // function continuous.ts uses for the provision reading.
  cardOfUid,
  energyProvidesOf,
  evolveFromOf,
  hasPrintedAbility,
  isBasicPokemon,
  isEnergyCard,
  isExOrV,
  isStage1Pokemon,
  isStage2Pokemon,
  matchesFilter,
  pokemonSuffixOf,
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
  // 🆕 D372 — the FIRST value this file takes from continuous.ts's per-BODY Energy
  // counters. `countEnergyInPlay` (the line below) is the SEAT-wide one and has been
  // here since D193; the printed clause D372 buys names two BODIES, so the narrow
  // counter has to arrive rather than the wide one be reused.
  countAttachedEnergy,
  countEnergyInPlay,
  effectiveMaxHp,
  // 🆕🆕 D433 — MOVED HERE FROM `flow.ts` (which now re-exports it) so `devolveEach`
  // can ask the ONE lethality question rather than re-spelling `damage >= maximum`
  // (D131/D222). ⚠️ NOT because a flow.ts import is impossible — this file already
  // closes a cycle with triggers.ts and the reason it is safe is written above that
  // import — but because the predicate reads `effectiveMaxHp` and NOTHING ELSE, so
  // continuous.ts is where it belonged; opening a THIRD module cycle for a two-line
  // comparator would have been the worse of the two.
  isLethallyDamaged,
  // 🆕 D388 — the SECOND value this file takes from the retreat-cost seam's single
  // derivation point (D108/D322). `opponentActiveRetreatCostAtLeast` reads the
  // printed noun phrase "the Retreat Cost of your opponent's Active Pokémon", and
  // attack.ts has resolved that same phrase through this fold since 0.61.0 — so the
  // import is what keeps one noun phrase meaning one thing (D159).
  effectiveRetreatCost,
  groupShieldedFromAttackEffects,
  hasAttachedEnergy,
  installedAttackDebuffOf,
  installedNoWeakness,
  installedRecoilOf,
  installedReductionOf,
  koSurvivalClamp,
  opposingAttackDebuff,
  passivesOf,
  preventedByDamageThreshold,
  preventsAttackerType,
  providesEnergyType,
  remainingHpWithin,
  seatDamageReduction,
  seatPreWRDamageBonus,
  seatRemovesWeakness,
  seatShieldedFromSupporterEffects,
  stadiumPreventsDamage,
} from "./continuous";
import { STATUS_WORD_OF, foldApostrophes } from "./effects";
// TYPE-ONLY — interpreter.ts must not gain a runtime edge to registry.ts (the
// registry imports effects.ts for its op vocabulary and this file evaluates it);
// `AttackTimingGate` is a shape, so the edge is erased wholesale.
import type { AttackTimingGate } from "./registry";
import type {
  AttachTargetRiders,
  BoardCondition,
  CardFilter,
  EffectOp,
  EffectSlot,
  StampedPlayLockKey,
  HandRefreshDraw,
  PokemonType,
} from "./effects";
import type { GameEvent, StatusName } from "./events";
// THE one exhaustive switch over `Phase` (phaseView.ts) — `conditionHolds` reads
// the turn OWNER from it rather than re-deriving one by turn parity, which that
// module's header forbids. phaseView.ts imports from here TYPE-ONLY
// (`import type { EffectPrompt }`), so this value import leaves no runtime cycle.
import { phaseViewOf } from "./phaseView";
import type { CoinFace } from "./rng";
import { flipCoin, randomIndex, shuffle } from "./rng";
// 🆕 D320 — `switchInto` runs the opponent-action trigger on an Active→Bench
// move, and this is the FIRST value import from triggers.ts into this file. It
// closes a cycle (triggers.ts imports `runProgram` from here), which is the
// shape flow.ts ↔ triggers.ts has carried since M4: both ends are hoisted
// function DECLARATIONS called only at run time, so neither module reads the
// other's binding while it is still initialising.
import { damagedByAttackAbility, runActiveBenchedTriggers } from "./triggers";
import type {
  AttackBlock,
  GameState,
  InPlayPokemon,
  LockedAttack,
  PendingStage,
  PlayerSide,
  PokemonTarget,
  ScheduledEffect,
  Seat,
} from "./types";
import {
  BENCH_MAX,
  DEFAULT_CONFUSION_DAMAGE,
  DEFAULT_POISON_DAMAGE,
  SEATS,
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
  withSide,
  without,
  koByEffectMarker,
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
  /** 🆕 D319 — THE PRINTED PRONOUN *"that Pokémon"*: the body the WATCHED action
      was just performed on. Set by triggers.ts `runWatchedTriggers` alone (the
      opponent-action scan) and ABSENT everywhere else, which is exactly the
      shape `sourceUid` already has for a Trainer — an op that reads it whiffs
      silently without one.

      ⚠️ IT IS A THIRD AXIS AND NOT A SPELLING OF `sourceUid`. That field names
      the body the sentence BELONGS to ("this Pokémon", the Ampharos); this one
      names the body the sentence ACTS ON, and on every card that carries it the
      two are on OPPOSITE SEATS. `seat` is the third: the controller of the
      effect, which for a watched trigger is the seat that did NOT act. A build
      that folded any two of the three together is green on a self-targeting card
      and wrong on every card in this family.

      Plain JSON and constant for the whole run, like `seat` and `sourceUid`, so
      it rides `EffectContinuation` across a park unchanged — no representative
      parks today (a fixed counter placement), but the field costs nothing to
      carry and an older continuation simply lacks it. */
  subjectUid?: string;
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
      question), this one names WHAT KIND OF THING is doing it (a rules question).

      🆕 D259 — AND IT IS NOW A THREE-MEMBER UNION, WHICH IS THE CHEAPEST OF THE
      TWO OUTCOMES THE HANDOFF PRICED. The TRAINER-borne shields (Fraxure /
      Cetitan ex / Rhyperior) ask the same question one rung wider — *"what kind of
      thing is doing this"* — and the answer for a Trainer has to distinguish an
      Item from a Supporter, because Rhyperior's sentence prints only the latter.
      So the field carries the trainer's printed TYPE rather than a bare
      `"trainer"`, and `effectRefused` reads it directly instead of re-deriving the
      played card's type from a uid that has already left the hand.

      ⚠️ WIDENING A STRING-LITERAL UNION IS BACKWARD-COMPATIBLE FOR AN OLD PARKED
      CONTINUATION, which is why `MATCH_RECORD_VERSION` does not move: a record
      written before this slice carries `invokedBy: "attack"` or nothing at all,
      and both still parse and still mean what they meant. Driven as a REPLAY in
      preventBlock.test.ts rather than asserted (D258's rule).

      It is set by `attack.ts` (as `"attack"`) and by cardplay.ts's ONE trainer
      `runProgram` call (as the played card's `trainerType`), and by nothing else —
      an Ability's program leaves it absent, which is why an Ability that discards
      an opposing Energy is refused by neither channel. */
  invokedBy?: "attack" | "item" | "supporter";
  /** 🆕🆕 **D427 — THE DAMAGE THIS ATTACK JUST DEALT TO THE DEFENDING ACTIVE**, the
      printed *"the same amount of damage you did to your opponent's Active
      Pokémon."* (6 legal printings on 1 sentence). Set by `attack.ts` at the ONE
      `runProgram` call that has an §8.5 pipeline behind it — the same call, the same
      argument, that sets `invokedBy: "attack"` — and ABSENT everywhere else (a
      Trainer, an Ability, a trigger, the Checkup), none of which has done any damage
      to read.

      🛑 **WHY `EffectContext` AND NOT `EffectRecord`, AND THE FIRST REASON IS THE
      VALUE TYPE RATHER THAN THE MEANING.** `EffectRecord` is
      `{ [K in EffectSlot]?: string[] }` and `EffectSlot` is
      `"paid" | "moved" | "discarded"` — **every §9.2 slot in this engine is a LIST
      OF CARD UIDS**, and this is an HP FIGURE. There is no slot to file it in and no
      widening that keeps the map's value type, so the record could only carry it by
      becoming a different kind of thing. D406 priced this sentence and named exactly
      that, one slice before declining it.

      ⚠️ **AND THE MEANING AGREES, WHICH IS THE SECOND REASON AND NOT THE FIRST.**
      `EffectRecord`'s own doc block says it is *"what the ops ALREADY RUN in this
      program left behind for the ops still to come"* — an accumulator that changes at
      nearly every op. This value is computed by §8.5 **before the program's first op
      runs**, is fixed for the whole run, and is read rather than written by every op
      in it. That is `seat`'s and `sourceUid`'s shape, not `record`'s. Filing it in
      the record would also have made it mutable mid-run by any recording op, which is
      a lie about a number the card fixes at the moment the damage lands.

      🛑 **BOTH CANDIDATES ARE PERSISTED, SO THE VERSION QUESTION IS NOT SETTLED BY
      PICKING THE OTHER ONE — IT IS SETTLED BY THE FIELD BEING OPTIONAL.** `ctx` rides
      `EffectContinuation` into `phase.cont`, exactly as `record` does, so a program
      that PARKS writes this key into a persisted `MatchRecord`. `MATCH_RECORD_VERSION`
      **STAYS 26** on D125's distinction: an OPTIONAL key is a WIDENING — a
      continuation written by an earlier deploy simply lacks it, which reads as
      `undefined` — where a REQUIRED key would be a missing field and would bump.
      `invokedBy` is the precedent verbatim (`apps/api/src/lobby/match.ts`: *"an
      OPTIONAL field and therefore a WIDENING… it would not have bumped anything on
      its own"*), and D412's 25 → 26 is the counter-case: a REQUIRED
      `InPlayPokemon.retreatLockedTurn`.

      ⚠️ **LOSING THE KEY WOULD DEGRADE INTO A SILENT WHIFF, WHICH IS THE SHAPE D421
      WARNS ABOUT — SO SAY WHY IT IS UNREACHABLE RATHER THAN CLAIM IT IS LOUD.** The
      only op that reads this is `{ op: "heal", target: "self", amount: "dealt" }`, and
      the only producer of THAT is `deriveAttackEffect`'s D427 arm. No deploy before
      this one could author the op, so no pre-D427 continuation can hold a reader for
      a key it also lacks: the absent-key path is uninhabited by construction rather
      than merely unlikely. What IS checkable is the pairing — `attack.ts` sets this
      field and `invokedBy: "attack"` in the same object literal, so
      `invokedBy === "attack"` ⟺ `dealt !== undefined` on every continuation this
      engine writes, and `selfHealDealt.test.ts` drives that across a real park.

      ⚠️ **ALWAYS A NUMBER FROM `attack.ts`, INCLUDING ZERO.** `attack.ts` declares it
      at function scope initialised to 0 and assigns the §8.5 `dealt` inside the damage
      block, so a prevented hit, a whiffed (damage-less) attack and an attack whose
      damage step never ran all arrive as an explicit `0` rather than as an absent key.
      The optionality is for the OTHER `runProgram` callers, which have no damage to
      report at all — it is not a "sometimes attack.ts forgets" hedge. */
  dealt?: number;
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
          hand/deck; the unridden lookAtTopN takes from the deck top). Taking none
          is a legal answer.
        • **`min === max`** — a MANDATORY exact pick, where the only decision is
          WHICH cards and never whether, so there is no decline. THREE producers:
          the printed hand COST (`payFromHand`, dest `"discard"` or `"deck"`), the
          unridden `bottomFromOpponentHand`'s exactly-one, and 🆕 **D334's
          `lookAtTopN.exact`** — Explorer's Guidance's *"put **2 of them** into your
          hand"*, which prints no *"up to"* and no *"you may"*.

      🆕 ⚠️ **D334 — THE FLOOR IS THE ONE FIELD HERE THAT A SHORT ZONE CAN MAKE
      UNANSWERABLE, AND ONLY ONE PRODUCER HAS TO CLAMP IT.** `payFromHand` and
      `bottomFromOpponentHand` are gated upstream on a hand that holds the cards, so
      their floors are true by construction; a top-6 window on a 1-card deck offers
      ONE candidate against a printed take of 2, so `lookAtTopN` clamps to
      `candidates.length` at the park. `max` never needed this — a ceiling above the
      candidate count simply never binds, which is exactly why `"any"` could be
      resolved anywhere and this cannot. */
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
          the other is the guess `min` exists to prevent.

          🆕 **D307 — `"evolve"` IS THE FIRST MEMBER THAT IS NOT A ZONE**, and it
          is a member rather than a reuse of `"bench"` for the reason the note
          above gives about `"deck"` vs `"deckBottom"`: the destination is the
          ENGINE's to state, and a client told `"bench"` about *"put it onto this
          Pokémon to evolve it"* would name the wrong place in its own words. The
          BODY is not carried — the prompt's `note` names it, and the only op that
          parks this dest resolves the target from `ctx.sourceUid` on the way back
          in, so a second copy on the wire could only ever disagree.
          🆕 ⚠️ **D308/D309 — "FROM `ctx.sourceUid`" IS NOW "FROM THE OP", AND THE
          CONCLUSION IS UNCHANGED.** That one op may carry an `onto` written by the
          iterated sentence's scheduler or by the body-choice sentence's first
          answer, so the subject is `op.onto ?? sourceRef` — still re-derived
          ENGINE-side on the way back in, still never read off the wire.

          🆕 **D342 — `"deckTop"` IS THE SEVENTH MEMBER**, and it is a member for
          exactly the reason the note above gives about `"deck"` vs
          `"deckBottom"`: *"put those cards on top of it"* and *"shuffle it into
          your deck"* are different promises, the destination is the ENGINE's to
          state, and a client told `"deck"` about Ciphermaniac's Codebreaking
          would render *"Shuffle"* over a heading that says *on top of your
          deck*. Every zone member of this union is now one of the three PLACES
          a card can re-enter a deck, spelled apart. */
      dest: "bench" | "hand" | "deck" | "deckBottom" | "deckTop" | "discard" | "evolve";
      /** 🆕 **D332 — PER-KIND CAPS OVER THE SAME CANDIDATE LIST**, the printed
          *"you may reveal **a Pokémon and a Trainer card**"* (Drayton, the sole
          consumer today through `lookAtTopN.also`). Each entry caps how many of
          the picks may come out of ITS `uids`; `max` above stays the TOTAL, so
          every existing reader — the wire validator's flat check, the dialog's
          running count — keeps working with no branch at all.

          🛑 **IT IS A PROMPT FIELD AND NOT AN OP FIELD, WHICH IS THE WHOLE COST OF
          THE DRAYTON ROW.** `validateChoice` (cardplay.ts) matches a wire answer
          against the PROMPT and nothing else — that is the architecture, and it is
          what a P4 client is checked by. A cap that lived only on the op would be
          invisible there, so a crafted frame could take two Pokémon out of a
          window whose printed sentence promised one of each. The op field and this
          one are two halves of one narrowing and neither is useful alone.

          **ABSENT ON ALL SIX OTHER PRODUCERS** (searchDeck, evolveFromDeck,
          discardPileRetrieval, payFromHand, bottomFromOpponentHand and the
          unridden `lookAtTopN`), where one filter and one cap are the whole story
          — so absent is not "no limit", it is "the total IS the only limit".
          🛑 **THIS RIDES A PERSISTED SHAPE AND STILL COSTS NO `MATCH_RECORD_VERSION`
          MOVE.** The prompt sits on the `effect:choose` phase, which is serialized
          into a `MatchRecord`; the test this repo applies is *"can the PREVIOUS
          deploy's RECORD hold the new TYPE"* (apps/api/src/lobby/match.ts). A
          version-19 phase carries no `caps`, this build reads that as `undefined`,
          and `undefined` means exactly what those parks meant when they were
          written — one flat cap, because no program that could park them had an
          `also`. The old bytes mean in this deploy what they meant in the last
          one, so the version does NOT move. `bottomFromOpponentHand.dest`'s
          argument (D294) and `gust.basicOnly`'s (D331), one prompt over. */
      caps?: readonly { uids: readonly string[]; max: number }[];
      note: string;
    }
  /** Pick exactly one in-play Pokémon (switchActive / gust / healChosen) — and,
      where `upTo` says the print allows it, say HOW MANY of the moved thing the
      pick takes, down to and including NONE.

      🆕🆕 **D359 — `upTo` IS THE PRINTED CEILING, AND IT REPLACES D358's
      `declinable` RATHER THAN SITTING BESIDE IT.** One slice ago this member
      carried `declinable?: true`, bought for *"attach **up to** N … in any way
      you like"* spread over N one-card ops. It was the right field for the wrong
      width: at this prompt `declinable` IS `upTo: 1` — take the one on offer, or
      take none — and the printed sentences that were still over-resolved differ
      from it by a NUMBER and nothing else. Keeping both would have put two keys
      on one axis, which is the exact refusal D358 made at the OP when it declined
      `upTo` beside `count`. **This file had already written the rule down one
      member below**: *"A prompt with `min: 0` is declinable by construction and
      does not set it."* A floor of zero subsumes a decline flag; so does a
      ceiling that admits zero.

      • **absent** — the MANDATORY exactly-one every park here meant before D358:
        switchActive, gust, returnBenched, healChosen's single arm, the two
        counter moves and both evolve-body continuations. Forced at one candidate
        (the M1 no-choice rule), and a ref-less answer is refused by the validator.
      • **`upTo: 1`** — D358's decline, respelled. `attachEnergyFrom.declinable`
        (Archaludon ex ×3, Magneton ×3) is its only producer.
      • **`upTo: N`, N ≥ 2** — 🆕 the printed *"attach up to N … to ONE named
        body"*, `attachEnergyFrom.count`'s six sentences and 13 legal printings.
        The answer names a body AND a quantity in `0..N`.

      🛑 **IT IS THE PRINTED CEILING AND IT IS NOT CLAMPED TO WHAT THE ZONE
      HOLDS.** `lookAtTopN` clamps its FLOOR to the candidate count because a
      short deck can make a floor unanswerable; a ceiling above what is available
      simply never binds, and the apply has resolved `min(count, available)` since
      D205. ⚠️ **THE FIRST REASON WRITTEN HERE WAS THAT A CLAMP WOULD LEAK THE
      HAND, AND THAT WAS MEASURED FALSE**: `redactPhase` sends an `effect:choose`
      prompt ONLY to the seat that must answer it, so no field on this prompt
      reaches the other side at all. The reason that survives is internal
      consistency — the park's `note` quotes the PRINTED count verbatim (D205,
      because the count is the one thing a player cannot read off the offered
      rows), so a ceiling cut to "what you actually hold" would offer one button
      under a caption promising two: **one prompt contradicting itself**.

      🛑 **AND IT CHANGES WHAT `parkOrForce` DOES AT **ONE** CANDIDATE**, which
      is the half a reader will not guess from the field alone — D358's finding,
      inherited verbatim and now reaching further. The M1 no-choice rule forces a
      lone candidate because a question with one answer is not a question. A pick
      with a ceiling has `upTo + 1` answers over one candidate, so it parks at
      every non-empty candidate set. **This is D47's call, verbatim**, made for
      `choosePokemonMulti` and reversed there in review: honouring the right only
      above the auto-resolve threshold honours it *"exactly where declining
      matters least"*. ⚠️ **THIS IS WHAT FINALLY REACHES THE `toSelf` FAMILIES.**
      Bloodmoon Ursaluna, Lycanroc, Regirock ex and Kilowattrel ex all print
      *"up to 2 … to **this Pokémon**"*: one candidate by construction, so before
      this slice the controller was never asked at all and always attached two.

      🛑 **`MATCH_RECORD_VERSION` MOVES 21 → 22 AND THAT IS THE COST OF THE
      RENAME**, asked rather than assumed. This prompt rides the persisted
      `effect:choose` phase. D358's `declinable` was a WIDENING — absent read as
      mandatory, which is what older records meant — and cost no bump. A RENAME is
      not a widening: a v21 record carries `declinable: true` over a park this
      build would read as `upTo === undefined`, i.e. MANDATORY, and a resumed
      match would refuse a decline the player was promised. D352 made exactly this
      call one op over (`attachFromTop.discardRest` → `restTo`). */
  | { kind: "choosePokemon"; candidates: PokemonRef[]; upTo?: number; note: string }
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
      on (`from`); `destinations` are the eligible destination Pokémon — the
      source-exclusion is per-pick, validated against the chosen source.
      Declinable (pick none).

      🆕🆕 **D443 — THE REFS CAN NOW BE THE OPPONENT'S, AND THIS PROMPT NEEDED NO
      FIELD TO SAY SO.** Every `PokemonRef` here carries its own ABSOLUTE `seat`
      (the wire twin says so in as many words: *"its `seat` is ABSOLUTE (p1/p2), NOT
      viewer-relative … the client resolves a ref to a board Pokémon by comparing
      `ref.seat` to that own seat"*), so the two opponent-board printings park on a
      prompt whose bytes differ from an own-board one only in the seats already
      inside the refs. That is why `side` rides the OP and NOT the prompt where
      `anySource` and `anyDest` ride both: those two are COUPLINGS, invisible in
      the candidate lists, and this one is spelled by every candidate.

      ⚠️ **NO `answerer`, AND THAT IS THE RULE RATHER THAN AN OMISSION.**
      `ptcg-rules.md` §9.4: *"Almost every printed effect is decided by the player
      resolving it, even when it reaches across the table … the target is theirs,
      the choice is yours. A small family inverts that, and the wording is the tell:
      'your opponent may …'."* Neither sentence prints a chooser, so the CONTROLLER
      answers — the same call `knockOutChosen` (D416) and `discardEnergy`'s
      `opponentChosen` arm already make about picks on the other seat's board.
      Nothing crosses that should not: attached Energy uids and in-play refs are
      PUBLIC on the redacted board for both seats (`redactedInPlayOf` emits
      `attached` unconditionally), which is what makes this the public-ref family.

      `anySource` (D226 — N's Plan's printed "from your Benched **Pokémon**")
      lifts the first clause of that sentence: the picks may come off SEVERAL of
      the offered sources. It is carried HERE and not only on the op because the
      wire validator, the wire schema and both HUD dialogs read the prompt and
      never the op — a coupling only the interpreter knows about is one no
      answerer can satisfy. OPTIONAL, so a park persisted by a build that predates
      it reads back as the single-source coupling it was written under
      (`MATCH_RECORD_VERSION` unmoved — a widening, not a missing field).

      🆕🆕 **D441 — `min` IS THE FLOOR, AND IT IS WHAT LETS THIS PROMPT SAY
      "MANDATORY".** Absent (or 0) is the decline this arm has carried since M4;
      `min === max` is Castform's printed *"Move **all** Energy"*, where the
      quantity is not a decision and only the destination is. It is carried HERE
      and not only on the op for `anySource`'s reason word for word — the wire
      validator, the wire schema and both HUD dialogs read the PROMPT and never
      the op — and it is a NUMBER rather than a boolean because that is this
      engine's shipped spelling for the same fact in three other places:
      `chooseCards`'s *"`min` is the DECLINABLE split (0 = the printed 'up to',
      `min === max === count` = a mandatory exact cost)"* (redacted.ts),
      `choosePokemonMulti`'s `{min, max, declinable}`, and the
      `const exact = prompt.min === prompt.max` both HUDs already caption from.

      🛑 **OPTIONAL, AND THE MISSING KEY IS NOT A LOST FACT — IT IS THE CORRECT
      READING OF THE OLD BYTES.** Every `moveEnergy` park an earlier deploy could
      author was declinable (this block's own third sentence), so `prompt.min ?? 0`
      resumes such a record meaning exactly what it meant. That is D334's optional
      `exact` verbatim, and it is the INVERSE of D359's `upTo`, which DID move
      `MATCH_RECORD_VERSION` precisely because absent came to mean MANDATORY where
      the old bytes meant declinable. **Direction is the whole of the difference**,
      and it is the discriminator that block states outright: *"does the old byte
      string still mean what it meant"*.

      🆕🆕 **D442 — `anyDest` IS THE DESTINATION-SIDE MIRROR, AND IT IS WHAT MAKES
      THIS PROMPT'S ANSWER A MAP.** Absent (every park before this deploy) the picks
      all land on ONE of the offered `destinations` and the answer's `picks` must
      agree about it — which is exactly what the old `{ uids, dest }` answer said in
      its shape. Present (the printed *"in any way you like"*) each pick names its
      OWN destination, and the only surviving rule is the per-pick one this prompt
      has enforced since D226: a pick's destination may not be the body it came off.

      It is carried HERE and not only on the op for `anySource`'s reason word for
      word, and it is OPTIONAL for `min`'s: absent means the coupling, which is what
      every older writer meant, so `MATCH_RECORD_VERSION` does not move (D334, not
      D359). ⚠️ **THE ANSWER'S RENAME COSTS NO BUMP EITHER, AND NOT BECAUSE IT IS
      ADDITIVE** — `EffectChoice` is never serialized at all: it rides one
      `resolveEffect` action and is discarded, where the PROMPT and the
      `EffectContinuation` are what `phase` persists. */
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

      🆕🆕 **D457 — `oneTarget` IS THAT FIELD'S DUAL AND BOUNDS THE OTHER END OF
      THE SAME MAP**: the printed *"attach them to **1 of** your Pokémon"*, where
      every card in the batch shares ONE destination. `maxPerTarget` caps the
      cards per target; this caps the TARGETS the answer may name, at the one
      number the catalog prints (see `attachFromDeck.oneTarget` for the census
      that makes it a flag rather than a count). Absent is "in any way you like"
      again — so the two absences say the same thing from opposite ends, and a
      prompt setting BOTH would be describing `max: 1`, which no printing spells.

      ⚠️ **IT IS ENFORCED IN `cardplay.ts` AND MIRRORED, NEVER RE-DERIVED.** The
      wire validator is the only place the rule lives (every other coupling on
      this prompt is), and `redact.ts` / `projection.ts` / both HUDs carry it so
      the dialog cannot offer a second body the validator will refuse.

      DECLINABLE: attaching none is a legal answer ("up to" / "any number"), and
      the op's leftovers clause still runs. */
  | {
      kind: "attachCards";
      candidates: string[];
      targets: PokemonRef[];
      max: number;
      maxPerTarget?: number;
      oneTarget?: true;
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
  | { kind: "confirm"; note: string }
  /** 🆕🆕 **D341 — THE FIRST PROMPT IN THIS ENGINE WHOSE ANSWER IS AN ORDER.**
      `candidates` are the looked-at cards in their CURRENT deck order, index 0 =
      the top; a legal answer is a PERMUTATION of exactly those uids, and the
      answer's array order IS the new order (index 0 becomes the new top).

      🛑 **EVERY OTHER PROMPT HERE ANSWERS WITH A SET, AND THE DIFFERENCE IS NOT
      THE SHAPE OF THE ANSWER — IT IS WHO READS THE INDICES.** `chooseCards`
      already answers with a `string[]`, and four sessions of backlog re-pricing
      (D336 a LIST of caps, D337 a flat cap over a union, D338 the same cap on an
      attack, D339 a flat cap over a union of two by-name members) each concluded
      that neither more caps nor fewer nor a different surface nor a narrower noun
      gets you an order. They were right, and the reason is one line long: every
      `chooseCards` consumer iterates the answer to MOVE cards, so two answers
      that name the same uids are the same board, and `validateChoice` is free to
      treat the array as a set. Here the array positions are the entire game
      effect. **A prompt kind is a claim about what the answer MEANS, not about
      what it is made of** — which is why this is a new kind and not a
      `chooseCards` with `min === max === candidates.length`, an answer that
      validator would have accepted while the engine ignored the order.

      **NO `min`/`max`.** The count is not a decision: the answer is a permutation
      of the whole window or it is invalid. A floor and a ceiling that are both
      pinned to `candidates.length` would be two fields that can only ever be one
      value, D135's rule.

      **NO `declinable`, and it is printed rather than assumed.** *"Put them back
      in any order"* has no *"you may"*: the player must state an order, and
      leaving the deck as it was is a legal ANSWER (the identity permutation)
      rather than a decline. The two are observably different — a decline emits no
      decision at all, where the identity permutation is a choice the player made.

      **NEVER PARKED WITH FEWER THAN 2 CANDIDATES** — one ordering, no decision,
      M1's doctrine, resolved inline by the op. Stated here because the dialogs
      may rely on it: a reorder control with one row is not a control.

      ⚠️ **THE CANDIDATES ARE HIDDEN INFORMATION AND ON THREE OF THE FOUR
      PRINTINGS THEY ARE THE *OTHER* SEAT's.** `redactPrompt` resolves candidate
      identities to the ANSWERER ALONE (`chooseCards`'s gate, transferred), and
      that is load-bearing in a way it has never been before: on the opponent-deck
      arm the seat whose deck it is must not learn its own top. What the other
      player is owed is the count-only `DECK_TOP_REORDERED` row and nothing more.

      🆕🆕 **D344 — `alt` IS A PRINTED SECOND ARM, AND IT IS THE ONLY THING THE
      `or` COST.** Deduction Kit `sv08-171`: *"Look at the top 3 cards of your
      deck and put them back in any order, **or** shuffle them and put them on the
      bottom of your deck."* Present = the ordering has an alternative and the
      caption is these words; absent = it does not, which is every park before
      this slice, byte-for-byte.

      🛑 **THE ALTERNATIVE IS ANSWERED BY THE EMPTY ORDERING**, which is a value
      this prompt could not previously hold rather than one taken away from
      something: `validateChoice` demands a permutation of a window that is never
      smaller than 2, so `[]` was always refused, and it is admitted here EXACTLY
      when `alt` is present. It also reads as the print does — *none of these
      cards is being put back on top.*

      🛑 **AND NO NEW PROMPT KIND WAS OWED, WHICH IS WHERE THIS ROW'S PRICE
      ACTUALLY WENT.** `confirm`'s own doc settles it: *"a confirm answer means run
      `then` … a fact about the program"*, so "a binary answer that picks between
      two printed arms" is a MEANING this engine already had. What no existing
      prompt could do is ask that question **with the cards visible** — a `confirm`
      park carries no candidates, and the print hands the look over BEFORE the
      `or`, so an `optional` wrapper would have made the choice BLIND. **The
      prompt that asks the `or` has to be the prompt that delivers the look**, and
      D341's rule (a prompt kind is a claim about what an answer MEANS) is what
      licenses widening this one instead of minting a third binary kind. */
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
  /** The `choosePokemon` answer: the picked ref — **or, since D358, NO ref at
      all, which is the decline** of a park whose prompt carries `declinable`.

      🛑 **A WIDENED MEMBER AND NOT A NEW `kind`, AND THE CHOICE IS DELIBERATE.**
      A `{ kind: "declinePokemon" }` member would be answered by NONE of the nine
      arms that read this shape (`applyChoice`'s switch, `continuationOps`'), so
      every one of them would fall through its existing `: state` / `: []` default
      **silently** — the right board by accident, and unreadable as an intention.
      Absent-`ref` makes each of those nine sites state, in code, that a decline
      moves nothing. It also keeps the union at ten members and the wire frame of
      a decline strictly SMALLER than any existing answer, so no client that
      predates this slice can produce one by accident: they all attach a ref.

      ⚠️ **THE VALIDATOR IS WHERE THE WIDENING EARNS ITS KEEP** (D341's rule for
      `orderCards`, one member over). An absent `ref` is accepted against a
      `upTo` prompt and REFUSED with `BAD_EFFECT_CHOICE` against every
      other one — so a crafted frame cannot decline Boss's Orders' gust, which
      prints no *"up to"* and no *"you may"* and must resolve.

      🆕🆕 **D359 — `take` IS THE ANSWERED QUANTITY, AND ITS ABSENCE IS THE WHOLE
      BATCH.** The printed *"attach **up to 2** … to 1 of your Benched Ethan's
      Pokémon"* asks ONE compound question — which body, and how many onto it —
      because `count` pins the batch to the one body the print NAMES. So the
      quantity rides the SAME answer as the body rather than a second prompt:
      a second prompt would contradict `count`'s own documented reading, and the
      map prompt (`attachCards`) that could ask both re-opens the distribution
      `count` exists to close.

      **ABSENT = the prompt's `upTo`**, which is why this widening breaks no
      client: every pre-D359 answer to this prompt was a bare ref, every bare ref
      still means "all of it", and the ONLY answers that are new are the middle
      ones §9.1 has always printed. Present, it must be an integer in `1..upTo`
      against a prompt that carries a ceiling.

      🛑 **`{ ref, take: 0 }` IS REFUSED, AND THAT IS A RULE RATHER THAN A
      TYPO-CATCHER.** A named body with nothing attached to it is the DECLINE,
      which this union already spells as the absent ref. Two spellings of one
      answer is how a log ends up with a row that names a Pokémon nothing
      happened to, and how a §9.2 `recordGate` reading "if you attached Energy in
      this way" ends up with a body and no uids. One answer, one spelling. */
  | { kind: "pokemon"; ref?: PokemonRef; take?: number }
  | { kind: "pokemonMulti"; refs: PokemonRef[] }
  /** The moveEnergy answer: up to `max` movable Energy, EACH PAIRED WITH THE
      POKÉMON IT MOVES ONTO — the compound decision validateChoice checks (every
      uid offered and taken once, every destination offered, no pick landing on the
      body it came off, and — unless the prompt carries `anySource` / `anyDest` —
      one source and one destination across the whole answer). An empty `picks` is
      a decline, refused when the prompt carries a `min`.

      🆕🆕 **D442 — A MAP WHERE THIS WAS `{ uids: string[]; dest: PokemonRef }`,
      AND IT IS A RENAME RATHER THAN AN ADDITIVE `picks?:` BESIDE THE PAIR.** The
      printed *"in any way you like"* (3 sentences / 3 legal printings) needs each
      pick to name its own destination, which is `attachCards`'s shipped
      `assignments` shape — the one this file's `attachCards` doc has cited as the
      difference since D335 (*"each attached card names its OWN destination — so the
      answer is a MAP (card → Pokémon), not a list … moveEnergy's picks share one
      destination"*).

      🛑 **THE OPTIONAL ROAD WAS AVAILABLE AND IS REFUSED ON D359's OWN RULE, ONE
      MEMBER UP.** `{ uids: [a, b], dest: X }` and `{ picks: [{a, X}, {b, X}] }` are
      the SAME ANSWER, so keeping both is *"two spellings of one answer"* — the
      shape `{ ref, take: 0 }` is refused for four lines above, and for the same
      consequence: two spellings mean two apply paths, and a log row can then name a
      Pokémon by one route that the other route never named. One answer, one
      spelling.

      ⚠️ **AND THE RENAME IS FREE OF `MATCH_RECORD_VERSION`, WHICH IS A FACT ABOUT
      THIS TYPE AND NOT A JUDGEMENT ABOUT THE CHANGE.** Nothing persists an
      `EffectChoice`: a `MatchRecord` holds `{version, seed, startedAt, state, log,
      names}`, `state.phase` holds the PROMPT and the `EffectContinuation`
      (`{pendingOp, rest, ctx, record?}`), and `log` is the rendered
      `SeatLogEntry[]`. A choice rides one action, is validated, is applied, and is
      gone. What a v29 record CAN hold is a parked `moveEnergy` prompt, and that
      prompt's new key is optional with the old reading as its absent arm.

      ⚠️ **THE DECLINE LOSES ITS INVENTED DESTINATION, WHICH IS THE OTHER HALF OF
      WHY THE RENAME IS THE HONEST SHAPE.** Under `{ uids, dest }` both HUDs had to
      pull an arbitrary ref off `prompt.destinations[0]` to spell "Move none" — a
      body named in a frame where nothing happens to it. `picks: []` names nobody. */
  | { kind: "moveEnergy"; picks: { uid: string; dest: PokemonRef }[] }
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
  | { kind: "confirm"; yes: boolean }
  /** 🆕 **D341 — the `orderCards` answer: the offered uids RE-SEQUENCED.** Index 0
      is the new top of the deck. A `string[]` exactly like the `cards` answer at
      the head of this union and read by a rule that is its opposite:
      `validateChoice` checks a PERMUTATION (same length, every uid offered, no
      uid twice), and the apply consumes the POSITIONS.

      🛑 **THE VALIDATOR IS WHERE THIS UNION MEMBER EARNS ITS KEEP.** A crafted
      frame that drops a uid would shorten a deck; one that repeats a uid would
      duplicate a physical card; one that names an unoffered uid would drag a card
      up from below the window the print let the player see. All three are refused
      by the same three-line check, and none of them is refused by the `cards`
      arm's membership-and-count test — which is the concrete reason this is a
      separate member rather than a reuse. */
  | { kind: "orderCards"; uids: string[] };

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
      /** The seat that must ANSWER, when it is not the program's controller.
          Absent everywhere else, so settleProgram files the phase's `answerer`
          only for the parks that need it and every pre-D52 park stays
          byte-identical.

          🆕🆕 **D426 CORRECTED THIS SENTENCE, WHICH READ "opponentMayDraw is the ONE
          producer" AND HAD BEEN FALSE SINCE D227.** There are THREE, and the
          difference between them is the whole of what the answerer gate protects:
            · `opponentMayDraw` (Ortega) — a `mayDraw` prompt, no candidates at all;
            · `opponentSwitchOut` (D227) — a `choosePokemon` prompt whose candidates
              are `PokemonRef`s ALREADY PUBLIC on the redacted board;
            · `opponentDiscardsFromHand` (D426) — a `chooseCards` prompt over card
              uids out of the answerer's own HIDDEN HAND, the first payload the gate
              has ever had to keep off the other seat's wire.
          ⚠️ **THE STALE COUNT WAS READ AS A MEASUREMENT AND PROPAGATED**: D426's own
          op doc was written saying "the SECOND park with a `decider`" off this line
          and the `opponentMayDraw` case comment below, and was corrected only because
          the ordinal was checked against `parkOrForce`'s call sites. */
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
      // D355 — `coins` IS THE PRINTED COUNT AND ABSENT IS ONE. The loop runs
      // `op.coins ?? 1` times, so a gate authored before this slice takes exactly
      // the one flip it always took, advances `rngState` exactly once and files
      // exactly one row: the widening is invisible to every existing program.
      //
      // 🛑 EVERY FLIP IS TAKEN AND EVERY FLIP IS ANNOUNCED, BEFORE ANY BRANCH IS
      // CONSULTED. "Flip 2 coins" is two coins of public information, so it is two
      // ATTACK_EFFECT_COIN_FLIP rows in printed order — not one row carrying a
      // verdict. That keeps D144's invariant at N: `rngState` advances the same
      // number of steps on every face, so no online match can desynchronise on
      // the outcome, and the log shows the player what the card told them to look
      // at. A gate that emitted one summary row would make "both heads" and
      // "heads then tails" indistinguishable in the history.
      let faces: readonly CoinFace[] = [];
      let rngState = next.rngState;
      for (let flip = 0; flip < (op.coins ?? 1); flip += 1) {
        const [drawn, advanced] = flipCoin(rngState);
        faces = [...faces, drawn];
        rngState = advanced;
      }
      next = { ...next, rngState };
      for (const drawn of faces) {
        events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat: ctx.seat, result: drawn });
      }
      // 🛑 THE UNANIMOUS FACE, OR `null` WHEN THE COINS DISAGREE — and that is the
      // whole of "**If both of them are heads**" as a value. `null` equals neither
      // literal below, so a mixed result takes `otherwise` exactly as an all-tails
      // result does, which is what the print says: the clause is satisfied only by
      // agreement ON the winning face. Written this way rather than as an
      // `every(f => f === winning)` so the comparison one line down is the SAME
      // comparison for one coin and for N, and the one-coin path reduces to
      // `faces[0]` with no branch of its own.
      // ⚠️ AND THE ANY-heads READING IS NOT AVAILABLE HERE BY CONSTRUCTION, which
      // is deliberate: the pool prints no Standard-legal any-tails/any-heads gate
      // in the columns this op serves (3 printings, 0 legal, all attack/Checkup
      // text), so there is nothing for a second predicate to buy.
      const face = faces.every((drawn) => drawn === faces[0]) ? (faces[0] ?? null) : null;
      // D144 — WHICH FACE WINS is the op's only variable, and everything either
      // side of this comparison is shared: the flip is taken before the branch is
      // consulted (so `rngState` advances on BOTH faces and an online match cannot
      // desynchronise), the row is emitted either way, and the branch is spliced
      // by the same `unshift` so an op inside it can still park. `onTails` is
      // absent on every heads-gated program in the engine, which is why the
      // comparison defaults to heads rather than testing for it.
      //
      // D269 — THE LOSING FACE NOW HAS A BRANCH TO SPLICE TOO, and this line is
      // the whole of it: `otherwise` is the printed second consequent ("Flip a
      // coin. If heads, draw 4 cards. **If tails, draw 2 cards.**" — Picnicker),
      // and it is spliced by the SAME `unshift` on the SAME queue, so an op
      // inside it parks exactly as one inside `then` does. Written as the
      // conditionGate line one branch down rather than as a second `if`: the two
      // arms are mutually exclusive by construction, `?? []` is what an ABSENT
      // otherwise means (splice nothing — the pre-D269 behaviour, byte for
      // byte), and the coin was already taken and already announced above, so
      // nothing about the EVENT depends on which arm this picks.
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
    // D216 — a synchronous step may schedule more ops (see `stepOp`'s doc). The
    // same `unshift` the three gates use, so an op the step scheduled can park
    // like any other, and `rest` on that park is the queue as it stands here.
    if (stepped.schedule !== undefined) queue.unshift(...stepped.schedule);
  }
  return { kind: "done", state: next };
}

/** The uids filed under `slot`, or none. */
function recorded(record: EffectRecord, slot: EffectSlot): readonly string[] {
  return record[slot] ?? [];
}

/** 🆕🆕 D488 — how many of the uids filed under `slot` SCORE, once the printed noun
    has narrowed them. An ABSENT `filter` is every uid, which is byte-for-byte the
    `.length` this replaced, so the 13 printings already reading a slot do not move.

    ⚠️ **A uid THE STATE CANNOT RESOLVE DOES NOT COUNT.** `cardOfUid` returns
    `undefined` for a uid with no catalog id, and `matchesFilter`'s own `undefined` arm
    answers FALSE — the direction `hpOf`'s null takes one file over: an unknown card is
    not a match, never a free one. The unfiltered branch is deliberately NOT routed
    through the same `filter` call with an "everything" predicate, because that would
    make an unresolvable uid stop counting for the 13 shipped printings too. */
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
    // D206 — `switchActive` is the SIXTH recorder and the first that is not a
    // card movement: Surfer / Team Rocket's Giovanni print "Switch … . If you do,
    // …", and the switch's park has to say what the answer buys exactly as
    // Miriam's does. Listed here rather than left out, because the omission is
    // silent — `withConsequence` would simply drop the clause and the dialog
    // would describe half the card.
    op.op === "switchActive" ||
    op.op === "gust" ||
    // 🆕🆕 D502 — `searchDeck` is the EIGHTH recorder and the first DECK search.
    // Jynx `sv06-046` prints "Search your deck … onto your Bench. … If you put any
    // Pokémon onto your Bench in this way, move an Energy …", so the search's park
    // has to say what the answer buys exactly as Miriam's and the switch's do.
    // Listed here rather than left out, because the omission is SILENT in precisely
    // the D206 way: `withConsequence` would drop the clause and the dialog would
    // describe a deck search while the answer quietly decides whether an Energy
    // moves. ⚠️ AND IT IS ALSO THE FIELD'S ONLY READER BESIDES THE ARM THAT WRITES
    // IT — an optional `recordAs` that nothing enrols here files a record and gets
    // no caption, which is the half of this slice no board can see.
    op.op === "searchDeck"
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
  // D294 — `op.dest === undefined` is the half that keeps this phrase HONEST now
  // that the op has a second destination: a `dest: "bench"` op puts nothing on
  // the bottom of anyone's deck, and a gate announced in these words over it
  // would promise a consequence on a move that did not happen. Unreachable today
  // (no printing pairs the bench arm with a §9.2 gate) and written anyway, for
  // this function's own stated reason one line up.
  if (gate.contains === undefined && op.op === "bottomFromOpponentHand" && op.dest === undefined) {
    return "If you put a card on the bottom of your opponent's deck in this way";
  }
  // 🆕🆕 D502 — Jynx `sv06-046` prints its gate LONG too, so it takes the same
  // treatment as Ortega's above for the same stated reason: the note is the printed
  // text, and *"If you put any Pokémon onto your Bench in this way"* is the text
  // printed. "If you do" would be a paraphrase of a clause the card spells out.
  //
  // ⚠️ THE `dest === "bench"` HALF IS THE HONESTY GUARD, AND IT IS THE NEIGHBOUR'S
  // `dest === undefined` HALF READ ON THIS OP'S OWN DESTINATION UNION. A
  // `dest: "hand"` or `dest: "deckTop"` search puts nothing onto anyone's Bench, and
  // a gate announced in these words over one would promise a consequence on a move
  // that did not happen. Unreachable today (no printing pairs the hand or deck-top
  // arms with a §9.2 gate) and written anyway, for this function's own stated
  // reason — silence beats a guess, and a wrong CONDITION is the quiet half.
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
        // 🆕 D487 — THE SOURCE IS SAID WHEN THE OP NAMES ONE (D478: a describer's
        // obligation follows the CALL PATH, not the arm that happened to author the
        // op). No shipped program spells a bottom draw inside a `recordGate.then`
        // today — D487's anchor is `^…$` and produces a top-level program — but
        // `drawCards` IS in this switch, so the day one is composed the caption
        // would otherwise say "draw 3 cards" over a sentence that says where from.
        // That is D473's finding exactly: a reader can be correct while its
        // describer quietly says less, and only the describer is user-visible.
        parts.push(
          `${op.count === 1 ? "draw a card" : `draw ${op.count} cards`}${
            op.from === "bottom" ? " from the bottom of your deck" : ""
          }`,
        );
        break;
      case "drawUntilHandSize":
        parts.push(`draw cards until you have ${op.size} cards in your hand`);
        break;
      case "switchActive":
        // D206 — Prime Catcher's consequent, in Switch `sv01-194`'s own printed
        // words. ⚠️ ONLY THE UNMARKED OP: a subgroup-narrowed switch inside a gate
        // branch would need the owner spelled, and saying it in the broad words is
        // exactly the lie this function's doc refuses. No printed card writes one,
        // so — like `describeCondition`'s `contains === undefined` half one
        // function up — this conjunct is an EQUIVALENT MUTANT today, recorded as
        // such rather than passed off as a tested line.
        //
        // D244 — `fromSource` joins it for the SAME reason and is likewise
        // unreachable today: that arm never parks (its candidate list is at most
        // one, so `parkOrForce` forces it), so no prompt can be waiting on it to
        // describe. Spelling "1 of your Benched Pokémon" for a printed PRONOUN
        // would be the lie this function refuses; refusing to describe is the
        // honest answer, and it was said here to be recorded as an equivalent
        // mutant rather than as a tested line.
        //
        // 🆕🆕 D455 CHECKED BOTH OF THOSE SENTENCES AND NEITHER IS TRUE: the
        // corpus holds ZERO rows whose `find` span touches this condition, and
        // twelve declared survivors on this file, none of them here. The
        // unreachability argument is unchanged and is still the reason the
        // conjuncts are written the way they are; the claim that a mutant records
        // it is withdrawn until somebody writes one. D453 found the identical
        // false claim on `moveCountersChosen` and D455 on the `optional` apply
        // arm — three of the four "recorded as an equivalent mutant" sentences in
        // shipped source were false, which is now a convention entry rather than
        // an anecdote.
        //
        // 🆕 D273 — `targetType` and `exceptNamed` join them, and this is the
        // grep the standing lesson asks for: THIS LINE'S CORRECTNESS RESTED ON
        // THOSE TWO FIELDS NOT EXISTING. Left as it was, a `{D}`-narrowed switch
        // inside a gate branch would be described as "1 of your Benched Pokémon"
        // — the broad words for a narrow set, which is precisely the lie the doc
        // above refuses. Also unreachable today (Pecharunt's switch is not inside
        // a §9.2 branch), and widened anyway rather than left to rot.
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
        // D206 — Team Rocket's Giovanni's consequent, in the words the OTHER
        // card that prints this op uses for it (Boss's Orders `sv02-172`), which
        // is also Giovanni's own second sentence verbatim minus its capital. The
        // one op in this switch whose branch is a DECISION rather than an
        // automatic step: the player is being told a second prompt is coming, so
        // "switch in 1 of your opponent's Benched Pokémon" is the whole promise —
        // WHICH one is the next park's business, not this clause's.
        parts.push("switch in 1 of your opponent's Benched Pokémon to the Active Spot");
        break;
      case "opponentSwitchOut":
        // D227 — Iron Bundle `sv06-062` "Interjet"'s consequent, in the card's own
        // printed words minus its capital, exactly as the two arms above take
        // theirs from Switch and Boss's Orders. The parenthetical is DROPPED: it
        // is reminder text about who answers the NEXT prompt, and this clause is
        // appended to a note the CONTROLLER is reading about their own pick — so
        // repeating "(Your opponent chooses…)" there would attach the reminder to
        // the wrong question. The opponent gets told by being asked.
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
      case "applyStatus":
        // Only the controller-relative arm: "self" is the controller's own Active
        // in a Trainer/Ability program (applyStatus reads ctx.seat), which is what
        // Janine's "it is now Poisoned" refers to. The "defender" arm belongs to
        // an ATTACK program, where no §9.2 gate exists to describe.
        //   ✅ COLLECTED AT D235, and the paragraph above is kept verbatim (D178:
        //   provenance is annotated, never overwritten) — its LAST SENTENCE is now
        //   half false. Backlog row 10's gated printing ("Search your deck for up
        //   to 2 Basic {D} Energy cards and attach them to this Pokémon. Then,
        //   shuffle your deck. If you attached Energy to a Pokémon in this way,
        //   this Pokémon is now Poisoned.", 3 legal) IS an attack program with a
        //   §9.2 gate. The arm it reaches is still the `self` one — an attack's
        //   "this Pokémon" is the attacker (§8) — so this case covered the first
        //   ATTACK-side consumer of `describeBranch` with no line changed, and the
        //   `defender` half remains the unreachable one. That is the read site
        //   pricing at zero for the right reason rather than by luck, and the
        //   fixture that proves it is driven in `derivedDeckSearchAttach.test.ts`.
        if (op.target !== "self") return null;
        parts.push(`it is now ${STATUS_WORD_OF[op.status]}`);
        break;
      case "attachEnergyFrom":
        // ⚠️⚠️ D246 — Kilowattrel ex `sv08-068` "Return Charge"'s consequent, and
        // the FIRST §9.2 branch in this engine whose antecedent parks a pick the
        // player is answering RIGHT NOW. The switch offers a Bench of two or more
        // and asks which body to swap in; without this case the dialog names the
        // switch and says nothing about the two Energy that answering it buys —
        // and the Energy is the entire reason to use the attack.
        //
        // ⚠️ ONLY THE `toSelf` SHAPE HAS WORDS HERE, and the refusal is the
        // `retrieveNoun` rule rather than a gap: a class-narrowed attach ("1 of
        // your Benched {L} Pokémon") is a SECOND question, so describing it in
        // this clause would promise the player a decision that the note's own
        // prompt is not offering. The printed "to this Pokémon" is the one
        // destination that is not a question at all, which is exactly why it can
        // be stated flat.
        //
        // ⚠️ AND THE COUNT IS THE PRINT'S HEDGE VERBATIM ("up to 2"), branching
        // on the field's PRESENCE and not its value — `attachEnergyFrom`'s own
        // park caption 900 lines down makes the identical call for the identical
        // reason (D205: `count: 1` is never spelled, so a comparison against 1 is
        // a live difference no card can produce). The two spellings say the same
        // words because they are describing the same op.
        if (op.toSelf !== true) return null;
        parts.push(
          `attach ${op.count === undefined ? "the Energy" : `up to ${op.count} Energy`} to this Pokémon`,
        );
        break;
      case "moveEnergy":
        // 🆕🆕 D502 — Jynx `sv06-046` "Inviting Kiss"'s consequent, in the card's
        // own printed words minus its capital, exactly as the five arms above take
        // theirs. Without this case `describeBranch` answers `null`,
        // `withConsequence` returns the prompt unchanged, and the deck-search dialog
        // names the search and says nothing about the Energy the answer buys —
        // D473's finding verbatim: the reader is right and the describer quietly
        // says less, and only the describer is user-visible.
        //
        // 🛑 ONLY THE RECORD-PINNED DESTINATION HAS WORDS HERE, and the refusal is
        // `attachEnergyFrom`'s above rather than a gap: every other `moveEnergy`
        // destination is a SECOND question (*"1 of your Benched Pokémon"*, *"your
        // Benched Pokémon in any way you like"*, *"another of your Pokémon"*), so
        // stating one in this clause would promise the player a decision the note's
        // own prompt is not offering. The pinned destination is the one that is not a
        // question, which is why it can be stated flat — and it is also the only
        // combination a printed §9.2 gate reaches today.
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

/** D216 — the chosen-destination counter move's FIRST answer, carried on the op
    itself so its SECOND question can be asked. Returns the ops to schedule, which
    is one rewritten copy of the same op with the source now known.

    ONE helper for both endings of that first question — the forced one (`stepOp`,
    via its `then`) and the parked one (`resumeProgram`, via the splice below) —
    because they must produce the identical continuation or a Bench of one and a
    Bench of two would resolve the same printed sentence differently.

    ⚠️ **IT TESTS THE ZONE AND NOT THE SEAT, AND THE SEAT TEST WAS REMOVED RATHER
    THAN TESTED AROUND.** `moveCountersToDefender` carries both as its wire belt;
    here the second one was worse than redundant — it was MASKING a mutant. With a
    seat test in place, `continuationOps`' own `fromBench === undefined` guard
    could be deleted and nothing failed, because the destination answer (an
    OPPONENT ref) fell out of this function anyway. Two guards each covering for
    the other's absence is two lines neither of which can be proved. The state
    test in `continuationOps` is the meaningful one — *only the FIRST answer buys
    a continuation* — so it stays and this one goes; the seat is guaranteed
    downstream regardless, since the mover reads `state.players[ctx.seat].bench`.
    The `spot` test survives because TypeScript needs the narrowing — a
    `PokemonRef`'s spot is a union — and because a non-bench ref degrades to NO
    continuation, the silent ending an empty Bench already takes. ⚠️ It is itself
    an EQUIVALENT MUTANT and recorded as one: `ownBenchRefs` yields bench refs
    only, and `validateChoice` matches a wire answer against the PROMPT, so no
    authored row reaches the other arm. It cannot be deleted (the narrowing is
    load-bearing), which is why it is recorded rather than removed. */
function counterSourceAnswered(
  op: Extract<EffectOp, { op: "moveCountersChosen" }>,
  ref: PokemonRef,
): EffectOp[] {
  if (ref.spot.spot !== "bench") return [];
  return [{ ...op, fromBench: ref.spot.index }];
}

/** 🆕 D309 — the body-choice evolve's FIRST answer, and the shape D216 predicted:
    ONE helper for both endings of the first question (the forced one via `stepOp`'s
    `schedule`, the parked one via `resumeProgram`'s splice), so a board with one
    eligible body and a board with three resolve the printed sentence identically.

    🛑 **WHAT IT RETURNS IS A *DIFFERENT* OP, WHICH IS WHERE IT PARTS FROM
    `counterSourceAnswered` ABOVE.** D216 rewrote its own op because the same op
    asks question two; here question two is `evolveFromDeck` — an op that already
    exists, already parks and already knows how to put a deck card onto a named body
    — so the answer is written onto ITS `onto` field and `evolveFromDeckChosen` is
    never seen again. **NO SEAT TEST AND NO SPOT TEST**, for D216's own measured
    reason: `validateChoice` (cardplay.ts) matches a wire answer against the PROMPT,
    the prompt was built from `ownInPlayRefs`, and a second copy of that rule here
    would be the mutant-masking pair D216 deleted rather than a belt.

    ⚠️ **`ref.spot` IS TAKEN AND `ref.seat` IS DROPPED, AND THE DROP IS THE POINT.**
    `evolveFromDeckOffer` reads `state.players[ctx.seat]`, so a target is
    seat-relative by construction — carrying the seat would create a second place
    for the two to disagree. */
function evolveBodyAnswered(ref: PokemonRef): EffectOp[] {
  return [{ op: "evolveFromDeck", onto: ref.spot }];
}

/** 🆕 D315 — the own-board bodies an evolve-from-deck CHOICE may be spent on:
    every in-play Pokémon of `seat`'s whose TOP card matches `pokemonType` (when
    the sentence prints one) AND for which the deck actually holds a card that
    evolves from it.

    🛑 **ONE BUILDER, TWO ASKERS, AND THE FACTORING IS D222's LESSON RATHER THAN
    TIDINESS.** `evolveFromDeckChosen` (D309) and `evolveFromDeckEachChosen` (D315)
    ask the same printed question at two widths — *"1 of your Pokémon"* and
    *"up to 2 of your {D} Pokémon"* — and a second hand-spelled copy of the
    deck-narrowing is exactly the shape that goes quiet when one of them is later
    widened. The narrowing is the expensive half (D309's own headline), so the two
    ops disagreeing about it would be invisible on every board where the deck
    happens to be rich.

    ⚠️ **THE TYPE IS ASKED THROUGH `matchesFilter`'s `typedPokemon` ARM AND NOT AS
    A FRESH COMPARISON**, for `switchBenchNarrowing`'s reason verbatim: the catalog
    column is an ARRAY, dual-type Pokémon are printed, and a `{D}` noun must admit
    a `["Darkness","Fire"]` body. That membership rule is stated once, in
    `cards.ts`.

    ⚠️ **THE ORDER IS TYPE-THEN-DECK, AND IT IS NOT AN OPTIMISATION** — the type
    test is a board read and the deck test builds a whole offer per body, so a
    typed sentence asks the deck only about bodies its own noun admits. Both are
    conjuncts and neither is ever skipped. */
function evolvableOwnRefs(
  state: GameState,
  ctx: EffectContext,
  pokemonType?: PokemonType,
): PokemonRef[] {
  return ownInPlayRefs(state, ctx.seat).filter((ref) => {
    if (pokemonType !== undefined) {
      const card = refTopCard(state, ref);
      if (card === undefined) return false;
      if (!matchesFilter(card, { kind: "typedPokemon", pokemonType })) return false;
    }
    return (evolveFromDeckOffer(state, ctx, ref.spot)?.candidates.length ?? 0) > 0;
  });
}

/** What a resolved park schedules AHEAD of the program's remaining ops — the
    seam D186 opened for `optional` and D216 widened by one member.

    `applyChoice` returns a `GameState` and so cannot reach the work queue;
    `resumeProgram` is the one place that holds BOTH the applied state and the ops
    still to run, which is why an answer that buys OPS rather than board changes is
    spliced here. The two members buy different things and neither is a gate: a
    `confirm` yes buys the printed "you may" branch, and a counter move's source
    pick buys the op that asks where the counters go.

    ⚠️ **THIS IS WHY "AN OP THAT HAS PARKED ONCE CANNOT PARK AGAIN" IS THE WRONG
    STATEMENT OF THE BLOCKER** (D206's phrasing, corrected at D216). A PROGRAM has
    parked twice since D186 and does so on a shipped card — Koraidon "Dino Cry"
    attaches across two parks — because `runProgram(rest)` parks again the moment
    an op in `rest` needs a decision. What is true is narrower and is about ONE
    op: a single op gets one park, so a two-question sentence needs a SECOND op,
    and the only thing missing was a channel from the first answer to it. */
function continuationOps(cont: EffectContinuation, choice: EffectChoice): EffectOp[] {
  const op = cont.pendingOp;
  // 🆕 D316 — THE DECLINE NOW BUYS OPS TOO, and this line is the whole of it.
  // `otherwise` is the arm `coinFlipGate`, `conditionGate` and `recordGate` have
  // always had; absent (every producer before D316) it is the empty list, so the
  // expression is byte-equivalent to the old one for them. A "no" that is not an
  // ANSWER is what this op could not say: *"You may do 120 more damage"* prints
  // its base on the decline, and the base is inside the gate because §8.5 runs
  // once per damage op (effects.ts).
  if (op.op === "optional") {
    return choice.kind === "confirm" && choice.yes ? [...op.then] : [...(op.otherwise ?? [])];
  }
  // 🆕🆕 D344 — **THE FIFTH MEMBER, AND THE FIRST WHOSE TWO ARMS ARE BOTH PRINTED
  // ON THE SAME SENTENCE AS ONE `or`.** Deduction Kit `sv08-171`: *"Look at the
  // top 3 cards of your deck and put them back in any order, **or** shuffle them
  // and put them on the bottom of your deck."*
  //
  // **THE EMPTY ORDERING IS THE ALTERNATIVE**, and it reads as the print does:
  // none of these cards is being put back on top. `validateChoice` admits `[]`
  // only when the prompt carries the `alt` caption, so this branch cannot be
  // reached by a program that printed no second arm — and `applyChoice`'s
  // `reorderTop` arm needs no change at all, because both of its splices reduce
  // to the identity on an empty answer (`[...[], ...deck.slice(0)]`). **THE WHOLE
  // OF ARM B IS THIS SPLICE**, which is exactly D316's shape: the yes/no
  // difference lives in `resumeProgram`, never in the apply.
  if (op.op === "reorderTop") {
    return choice.kind === "orderCards" && choice.uids.length === 0
      ? [...(op.otherwise ?? [])]
      : [];
  }
  if (op.op === "moveCountersChosen" && op.fromBench === undefined) {
    return pickedPokemon(choice) ? counterSourceAnswered(op, choice.ref) : [];
  }
  // 🆕 D309 — THE THIRD MEMBER, and the first whose answer buys an op of a
  // DIFFERENT KIND. `evolveFromDeckChosen` carries no field to be "still unknown",
  // so there is no `=== undefined` guard to write: the op exists only to ask, and
  // reaching this line at all means it has been answered.
  if (op.op === "evolveFromDeckChosen") {
    return pickedPokemon(choice) ? evolveBodyAnswered(choice.ref) : [];
  }
  // 🆕 D315 — THE FOURTH MEMBER, and the FIRST whose answer buys **N** ops rather
  // than one: *"Choose up to 2 … For each of those Pokémon, …"* is D308's
  // iteration over a CHOSEN list, so one `evolveFromDeck` is scheduled per picked
  // body, in the order the player named them. It is also the first member to
  // answer a `pokemonMulti` — every other `choosePokemonMulti` in this engine is
  // applied in `applyChoice` and buys BOARD CHANGES, which is why none of them
  // needed this seam. An EMPTY pick (the printed "up to" decline) buys the empty
  // list, which is the same "an answer that buys nothing splices nothing" the
  // `optional` decline takes.
  if (op.op === "evolveFromDeckEachChosen") {
    return choice.kind === "pokemonMulti" ? choice.refs.flatMap(evolveBodyAnswered) : [];
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
  // the decline. D216 gave that reasoning a second member and a name of its own
  // (`continuationOps`); an answer that buys nothing splices nothing, as before.
  const rest = [...continuationOps(cont, choice), ...cont.rest];
  return runProgram(applied, rest, cont.ctx, events, record);
}

/** One synchronous step, or a park request. Parking ops compute their
    candidates: an empty candidate set is a no-op (nothing to choose), a single
    forced candidate auto-resolves (except searchDeck, which is "up to" and
    always lets the player decline, so it parks whenever ≥1 candidate).

    ⚠️ **`schedule` — D216'S SEAM, AND IT IS THE FORCED-PATH TWIN OF D186's
    SPLICE** (named `schedule` rather than `then`, which biome bans on an object
    literal — a thenable-shaped result returned into an `await` is exactly the
    confusion the rule exists to stop, and the gates' own `op.then` is a field of
    a typed union rather than a returned bag).
    A synchronous step may also schedule further ops, which `runProgram` unshifts
    onto its queue exactly as the three gates unshift `op.then`. It exists because
    a two-question printed sentence has TWO endings on its first question — the
    parked one, where `resumeProgram` can splice (D186's `optional`), and the
    FORCED one (`parkOrForce` at a single candidate), where nothing could: the
    auto-resolve path calls a helper returning a bare `GameState`, so an answer it
    computed had nowhere to go. Both endings now hand the same rewritten op to the
    same queue, which is what makes the forced and parked resolutions of one
    sentence provably the same run. */
function stepOp(
  state: GameState,
  op: EffectOp,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): { done: GameState; schedule?: EffectOp[] } | { park: EffectPrompt; decider?: Seat } {
  switch (op.op) {
    case "applyStatus":
      return { done: applyStatus(state, op, ctx, events) };
    case "clearStatus":
      return { done: clearStatus(state, ctx, events) };
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
    case "preventAttackUse":
      return { done: preventAttackUse(state, op.attack, op.until, ctx, events) };
    case "boostAttack":
      return { done: boostAttack(state, op.attack, op.amount, ctx, events) };
    case "preventChosenAttack":
      return preventChosenAttack(state, ctx, events);
    case "reduceDamage":
      return { done: reduceDamage(state, op.amount, ctx, events) };
    // 🆕🆕 D432 — no `op.` read at all, which is the shape of a field-free op.
    case "installNoWeakness":
      return { done: installNoWeakness(state, ctx, events) };
    case "weakenDefenderAttacks":
      return { done: weakenDefenderAttacks(state, op.amount, ctx, events) };
    // 🆕🆕 D434 — the SCHEDULE half of the delayed placement. The other half is
    // flow.ts `runCheckup`; neither is a build on its own.
    case "scheduleCounters":
      return { done: scheduleCounters(state, op.amount, ctx, events) };
    // 🆕🆕 D435 — the delayed family's other two payloads. Payload-free ops, so the
    // two lines differ only in which member of `ScheduledEffect` they book.
    case "scheduleDiscard":
      return { done: scheduleDiscard(state, ctx, events) };
    case "scheduleKnockOut":
      return { done: scheduleKnockOut(state, ctx, events) };
    case "installRecoil":
      // 🆕🆕 D456 — `op.amount` IS `number | "damageTaken"` and it is passed STRAIGHT
      // THROUGH, which is the whole difference from the `case "heal"` arm five lines
      // down. That one resolves its own string against `ctx.dealt` HERE, because
      // `heal`'s "dealt" is the hit the attacker is landing right now. This op's
      // string is the hit the HOLDER will take on the OPPONENT's next turn, which no
      // context reachable from this line has ever heard of; resolving it here would
      // stamp the trap with the damage of the attack that ARMED it.
      return { done: installRecoil(state, op.amount, ctx, events) };
    case "heal":
      // 🆕🆕 D427 — `amount` IS `number | "dealt"`, and this line is the whole of the
      // resolution. `"dealt"` is the printed *"the same amount of damage you did to
      // your opponent's Active Pokémon."*, which §8.5 fixed before this program's
      // first op ran and `attack.ts` handed over on the context.
      //
      // 🛑 `?? 0` IS NOT A DEFENSIVE HEDGE, IT IS THE ONE HONEST ANSWER FOR A
      // RUNNER THAT DID NO DAMAGE. `attack.ts` always supplies a number (0 when the
      // §8.5 damage block never ran at all), so the nullish arm is reachable only
      // from a Trainer's, an Ability's or a trigger's `runProgram` — none of which
      // has dealt anything — and from a continuation written before D427 existed,
      // which cannot hold this op because no deploy could author it. Zero then flows
      // into `healSelf`'s `healed <= 0` early return and whiffs SILENTLY, which is
      // what `heal` has done for an unusable amount since 0.x.
      return {
        done: healSelf(state, op.amount === "dealt" ? (ctx.dealt ?? 0) : op.amount, ctx, events),
      };
    case "healEach":
      return { done: healEach(state, op, ctx, events) };
    case "healEachAll":
      return { done: healEachAll(state, op.amount, events) };
    case "counterEachAll":
      return { done: counterEachAll(state, op, ctx, events) };
    case "counterUntilRemainingHp":
      return { done: counterUntilRemainingHp(state, op, ctx, events) };
    case "damageActive":
      return { done: damageActive(state, op.amount, op.source, ctx, events) };
    case "damageSubject":
      return { done: damageSubject(state, op.amount, ctx, events) };
    case "healSubject":
      return { done: healSubject(state, op.amount, ctx, events) };
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
    case "moveCountersChosen": {
      // D216 — Cofagrigus "Extended Damagriiigus": D138's move with a CHOSEN
      // destination. ONE op, TWO questions, one park each, and `fromBench` is
      // which of the two this step is asking.
      const chosen = op.fromBench;
      if (chosen === undefined) {
        // QUESTION 1 — the SOURCE. `ownBenchRefs` is `moveCountersToDefender`'s
        // own candidate helper, unchanged, so the two sentences cannot come to
        // offer different Benches. It is NOT wrapped in `subgroupRefs`: that
        // narrowing is the one D205's printing bought, and no chosen-destination
        // printing carries a possessive (the anchor's census).
        const sources = ownBenchRefs(state, ctx.seat);
        if (sources.length === 0) return { done: state };
        // `parkOrForce`'s own ordering, deliberately — nothing / one / many, in
        // that order. ⚠️ It makes `=== 1` and `<= 1` EQUIVALENT here (the empty
        // set has already returned), which is a property this arm inherits from
        // that helper rather than one it invents; recorded as an equivalent
        // mutant rather than passed off as a tested comparison.
        const forced = sources.length === 1 ? sources[0] : undefined;
        // ⚠️ NOT `parkOrForce`, and this is the whole reason `then` exists. Its
        // forced arm applies a `(ref) => GameState`, which is precisely the shape
        // that cannot ask a second question; here the single candidate is
        // ANSWERED rather than applied, and the answer is handed on — through the
        // SAME helper the parked ending uses, so the two resolutions of this
        // sentence are one code path with two entrances. The M1 no-choice
        // doctrine is unchanged: one Benched body prompts for nothing.
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
    case "spreadDamage":
      // 🆕🆕 D425 — `op.target` IS READ HERE FOR THE FIRST TIME. It has been on the op
      // since the op existed and was a SINGLETON, so this arm passed `op.amount`
      // alone and the field was documentation. Widening the union is what makes the
      // omission a type error rather than a silent one.
      // 🆕🆕🆕 D505 — AND THE AMOUNT IS FOLDED HERE, NOT INSIDE `spreadDamage`. That is
      // `damageSelf`/`recoilAmount`'s line two cases down, verbatim and for its stated
      // reason: the helper stays *"place this many HP on each benched body of that
      // side"* and every scaling rider is visible at the dispatch. `snipeAmount` takes a
      // STRUCTURAL parameter, so it accepts this op unchanged — the fold gains a second
      // op, not a second implementation (D448's own words one rider earlier). A 0-taken
      // opponent folds to 0 and `spreadDamage`'s first line returns the state untouched.
      // 🆕🆕🆕 D507 — AND THE TARGETING RIDER IS PASSED WHOLE, where the SCALING one is
      // folded: `damagedOnly` decides WHICH benched bodies the fold walks, which only the
      // fold can know, so it crosses the boundary as a parameter rather than as a number.
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
      // 🆕🆕 D465 — the amount is FOLDED HERE rather than inside `damageSelf`, so
      // that the helper stays "place this many HP on my own Active" and every
      // scaling rider is visible at the dispatch. `recoilAmount` is
      // `snipeAmount`'s shape (`(op, state, ctx) => number`), which is the fold
      // this file has already chosen twice for a rider on an op's own amount.
      return { done: damageSelf(state, recoilAmount(op, state, ctx), ctx, events) };
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
      //
      // 🆕 D316 — AND THE FLAT ARM, which is the same hit with the count taken
      // off: *"You may do {N} more damage. If you do, …"* decides its number when
      // attack.ts builds the program (printed base, or base + the printed bonus),
      // so there is no §9.2 slot to read. The `<= 0` guard covers BOTH arms and is
      // reachable on neither for the flat one — every printing carries a base of
      // at least 50 — which is why it is not re-stated per arm.
      // 🆕🆕 D403 — AND THE ADDITIVE FOLD, WHICH IS THE THIRD READING OF THIS ONE
      // EXPRESSION RATHER THAN A THIRD BRANCH. *"This attack does P more damage for
      // each card you discarded in this way"* KEEPS its printed base where the
      // multiply family drops it, and the sum is dealt HERE so that Resistance, the
      // reduction passive and the §8.1 survival clamp are each paid ONCE — the
      // mechanism D402 refused the family's additive half on. An ABSENT `base` is
      // zero, which is byte-for-byte what every `per`/`count` op meant before this
      // slice, so no board that existed moves.
      //
      // 🆕🆕 D488 — AND THE SLOT CAN BE COUNTED THROUGH A FILTER. *"…for each
      // **Energy card** you discarded in this way"* / *"…for each **Misty's Pokémon**
      // that you discarded in this way"* score a SUBSET of what the earlier op filed;
      // an ABSENT `countFilter` is every uid, which is byte-for-byte what this line
      // did before, so none of the 13 printings that already reach here move.
      // ⚠️ **A uid THE STATE CANNOT RESOLVE DOES NOT COUNT** — `matchesFilter`'s own
      // `undefined` arm — which is the same direction `hpOf`'s null takes one file
      // over: an unknown card is not a match, never a free one.
      //
      // ⚠️ **THE COUNT IS A CALL AND NOT AN INLINE TERNARY, AND THAT IS TYPE-SYSTEM
      // MECHANICS RATHER THAN TASTE.** `op.amount ?? …` is what narrows `op` to the
      // `{per, count}` arm at all (the `amount?: never` discriminant), and a `const`
      // lifted ABOVE this line sits outside that narrowing — `op.count` reads back as
      // `EffectSlot | undefined` and `tsc` refuses it. Keeping the whole computation
      // inside the right operand preserves the narrowing; a named helper keeps it
      // readable.
      const amount =
        op.amount ?? (op.base ?? 0) + scoredSlot(record, state, op.count, op.countFilter) * op.per;
      if (amount <= 0) return { done: state };
      return { done: snipeActive(state, amount, false, ctx, events) };
    }
    case "damageNewActive":
      // D228 — "This attack does {N} damage to the new Active Pokémon." The
      // SECOND §8.5 hit of the sentence, on a body an earlier op in the SAME
      // program promoted, and it needs no addressing at all: `snipeActive` reads
      // `activeTop` off the state it is handed, so "the new Active Pokémon" and
      // "the opponent's Active" are the same question asked after the promotion.
      // Genuine attack damage — the full pipeline (attacker pre-W/R bonus →
      // Weakness → Resistance → the target's reduction → §11 → the §8.1 survival
      // clamp), NOT the flat put-counter model, because the printed words are
      // "this attack does N damage" (`damageDefender`'s reading verbatim, one
      // case up, where the only difference is where the number comes from).
      //
      // NO `amount <= 0` GUARD, unlike the case above it, and the asymmetry is the
      // point: that op MULTIPLIES a printed `per` by a §9.2 slot that is empty on
      // a whiffed board, so a zero is reachable and would otherwise emit a
      // "dealt 0" row about a discard that never happened. This amount is a
      // PRINTED number the anchor captured from `(\d+)` — the four printed values
      // are 20/30/40/70 plus Grimmsnarl's 160 — so a zero would need a card that
      // prints "does 0 damage", and inventing a branch for it is the unreachable
      // guard conventions.md says to leave out.
      //
      // Never parks; the KO it may cause is swept by the attack epilogue, like
      // every program-emitted damage op.
      return { done: snipeActive(state, op.amount, false, ctx, events) };
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
      // 🆕 D345 — through `snipeTargets`, the funnel `programPlayable` now shares,
      // so the grey-out and the offer cannot disagree (the `gust` precedent).
      // 🆕🆕🆕 D492 — `count: "all"` (the printed *"each of"*) means the CANDIDATE SET IS
      // THE CEILING, so §8.6's clamp below is the identity and the forced branch is taken
      // on every board: the op never parks. A CEILING and not an early return, so
      // `optional` keeps meaning what it means for a spelling nothing prints — see the
      // field's own block in `effects.ts` for why the lie in the op's NAME is cheaper
      // than renaming a persisted byte (D443).
      const candidates = snipeTargets(state, ctx.seat, op);
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
          note: snipeNote(
            amount,
            take,
            declinable,
            op.deals === true,
            op.target,
            op.damagedOnly === true,
            op.filter,
          ),
        },
      };
    }
    case "drawCards": {
      // 🆕 D311 — the printed "if you drew any cards IN THIS WAY" needs the cards
      // this op actually took, and a short draw is the only board on which that is
      // not the printed `count`: `drawToHand` slices the deck, so a 3-card draw off
      // a 1-card deck files ONE and an empty deck files NONE. Read off the deck
      // BEFORE the draw, by the same slice `drawToHand` performs, because the
      // returned state no longer says which cards moved.
      //
      // 🆕🆕 D487 — THE SLICE FOLLOWS THE END THE OP NAMES. `from: "bottom"` is the
      // printed *"Draw 3 cards from the bottom of your deck."*, and the record has to
      // read the SAME end the draw takes: a bottom draw whose record still slices the
      // top files three cards that never moved, on every deck deeper than the count.
      // Both slices share ONE cut (`deck.length − count`, floored at 0), which is why
      // a deck of `count` or fewer takes the whole deck at either end — the two arms
      // are extensionally identical there and the suite's boards are chosen for it.
      //
      // 🆕🆕 D491 — `who` DECIDES THE SEAT LIST, AND IT IS A `switch` RATHER THAN THE
      // TERNARY IT REPLACES. A second seat value would fall silently out of the wrong
      // side of an `op.who === "eachPlayer" ? … : …` with `tsc` saying nothing — D447's
      // `snipeTargets` defect, which D490 met at `discardDeckTop.whose` one slice ago.
      // The `undefined` arm is written out for the same reason: it is the twelve-
      // printing controller reading, not a default.
      //
      // 🛑 CONTROLLER-FIRST, AND THE TWO SHIPPED PRECEDENTS DISAGREE. `counterEachAll`
      // walks the ABSOLUTE `SEATS`; `handRefresh` walks `[ctx.seat, otherSeat(ctx.seat)]`.
      // The distinguishing fact (D490) is what the op emits per iteration: this one
      // emits one `CARDS_DRAWN` per SEAT, so the seat order IS the log's order and
      // `handRefresh` — the other per-seat-row draw — is the precedent that governs.
      const drawSeats: readonly Seat[] = ((): readonly Seat[] => {
        switch (op.who) {
          case "eachPlayer":
            return [ctx.seat, otherSeat(ctx.seat)];
          case undefined:
            return [ctx.seat];
        }
      })();
      // ⚠️ ONE `recordMoved` OVER BOTH SEATS' CARDS, never one per seat: `recordMoved`
      // ASSIGNS, so a per-seat filing would leave only the LAST seat's uids in the slot
      // (D458 measured the overwrite, D490 measured a damage number that turned on it).
      const drawn: string[] = [];
      let done = state;
      for (const drawSeat of drawSeats) {
        const deck = done.players[drawSeat].deck;
        const wanted = Math.max(op.count, 0);
        drawn.push(
          ...(op.from === "bottom"
            ? deck.slice(Math.max(0, deck.length - wanted))
            : deck.slice(0, wanted)),
        );
        done = drawToHand(done, drawSeat, op.count, "effect", events, op.from ?? "top");
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
    case "bottomDeckTop":
      // 🆕 D344 — "…or shuffle them and put them on the bottom of your deck."
      // Never parks: *"shuffle them"* is exactly the ABSENCE of a decision about
      // their order, which is the whole difference between this arm and the
      // `reorderTop` it is printed against.
      return { done: bottomDeckTop(state, op.n, ctx, events) };
    case "searchDeck": {
      // 🆕 D336 — `also` IS A LIST OF FURTHER filter/cap PAIRS OVER THE SAME DECK
      // (Larry's Skill's three nouns, Secret Box's four). Unlike `lookAtTopN`'s
      // `also` this is not forced by a shared WINDOW — the deck is the whole zone
      // and does not slide — it is forced by the PROMPT: a second `searchDeck` op
      // would park a second dialog, and the printed sentence is one decision over
      // one offer ("reveal them, and put them into your hand", plural, once).
      // Sequential ops would also let the player decline the first noun and still
      // be asked for the second in a way the print does not separate.
      //
      // The groups are spelled as ONE list here — the op's first group is
      // `filter`/`max` — so the union, the total and the caps are all derived from
      // the same array and cannot disagree about arity.
      const groups = [{ filter: op.filter, max: op.max }, ...(op.also ?? [])];
      const groupMatches = (filter: CardFilter) =>
        state.players[ctx.seat].deck.filter((uid) => matchesFilter(cardOf(state, uid), filter));
      // The union is taken in DECK ORDER off the deck itself, one pass, so a uid
      // matching two filters appears exactly once in the offer — the caps below
      // are what make it count against both (effects.ts states the rule).
      const candidates = state.players[ctx.seat].deck.filter((uid) =>
        groups.some((g) => matchesFilter(cardOf(state, uid), g.filter)),
      );
      // ⚠️ THE BENCH CLAMP IS THE TOTAL'S, NOT THE FIRST GROUP'S. `benchSpace` is
      // one number for the whole answer, so it has to bind the SUM; clamping
      // `op.max` alone would let a 4-noun search put four Pokémon onto a Bench
      // with room for two. No printed multi-noun sentence benches anything today
      // (both rows are `dest: "hand"`), which is exactly why the clamp is written
      // against the sum rather than left to be discovered by the first one that does.
      const total = groups.reduce((sum, g) => sum + g.max, 0);
      const max = op.dest === "bench" ? Math.min(total, benchSpace(state, ctx.seat)) : total;
      // 🆕🆕🆕 D513 — THE PRINTED *"of different types"*, AS A PARTITION OF THE
      // CANDIDATES WITH EVERY CELL CAPPED AT ONE. Sylveon ex `sv06.5-050`.
      //
      // 🛑 THIS IS WHY THE CONSTRAINT IS NOT A `CardFilter` AND NEVER COULD BE.
      // `matchesFilter` answers for ONE uid; *"of different types"* is a predicate
      // on the ANSWER SET. But D332's `caps` is already exactly that shape — a cap
      // on how many picks may come out of a named uid set — so the pairwise
      // relation factors into `k` independent per-cell caps with no new vocabulary
      // anywhere: an answer is pairwise type-distinct **iff** it takes at most one
      // from each cell. `validateChoice` enforces it, and its own comment says that
      // is the only place it can be enforced.
      //
      // ⚠️ THE CELLS ARE BUILT FROM THE CANDIDATES, NOT FROM THE NINE PRINTED
      // TYPES, which is what keeps the caps HONEST rather than merely correct: an
      // empty cell would cap nothing and a cell for a type the deck does not hold
      // would put a group in the persisted prompt that no answer can reach. The key
      // is `energyProvidesOf` — the SAME function `matchesFilter`'s `basicEnergy`
      // arm reads for `filter.energyType` (cards.ts), so the partition and the
      // filter cannot come to disagree about what a type is (D159, one noun one
      // answer).
      //
      // ⚠️ AND THE TOTAL IS UNTOUCHED, which is the whole reason this is a rider
      // and not nine `also` groups: `total` above is the SUM of the group maxes, so
      // spelling the partition as `also` would turn the printed ceiling of 3 into
      // 9. The printed "up to" survives as `min: 0` below — a player may legally
      // take two, one, or NONE, and only a pair sharing a type is refused.
      //
      // ⚠️ A uid whose card cannot be resolved is dropped from the partition rather
      // than pooled into a cell of its own. It is unreachable — every uid here came
      // off this seat's own deck and `matchesFilter` already answered TRUE for it,
      // which it cannot do for an absent card — and pooling would have been the
      // wrong answer if it ever were reachable: two unresolvable uids sharing one
      // cell would refuse a pick the print allows.
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
      // The two cap sources CONCATENATE rather than choose, so the field pair has no
      // hidden precedence: a uid in two groups counts against both, which is this
      // op's stated conservative rule for overlapping `also` groups and is the only
      // reading that can never admit an answer the print did not promise. No printed
      // sentence spells both riders today (`also` is a multi-noun search and this
      // rider is defined over one Energy noun), so the combination is unreachable
      // from the deriver — but it is spelled to be right rather than left to be
      // discovered by the first row that prints it.
      const caps = [
        ...(op.also === undefined
          ? []
          : groups.map((g) => ({ uids: groupMatches(g.filter), max: g.max }))),
        ...distinctCaps,
      ];
      if (candidates.length === 0 || max <= 0) {
        // A search that can find nothing (or has nowhere to put it) is a
        // no-op — the trailing shuffleDeck op still fires.
        //
        // 🆕🆕 D502 — AND IT FILES THE EMPTY RECORD, which is the whiff every
        // recording op in this file takes and is what makes the printed *"if you
        // put ANY Pokémon onto your Bench in this way"* answer NO with no guard
        // anywhere else in the program. `recordGateHolds` asks `filed.length === 0`
        // rather than whether the KEY is there, so a search with an absent
        // `recordAs` is untouched and a Jynx whose deck holds no Basic — or whose
        // Bench is full — reaches the gate and stops there.
        recordMoved(record, op.recordAs, []);
        return { done: state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          // 🆕 D342 — THE FLOOR, and this park is the SIXTH producer to have one
          // that is not zero. Absent `exact` this is the standing `min: 0`, the
          // printed "up to" every search before this row spells, byte-for-byte
          // what it always was. Present, the take is MANDATORY and the floor is
          // clamped to what the zone can actually offer — D334's rule on
          // `lookAtTopN`, transferred rather than re-decided: a ceiling above the
          // candidate count never binds, but a FLOOR above it makes the prompt
          // unanswerable, and a 1-card deck under Ciphermaniac's printed 2 is a
          // live board rather than a theoretical one. The clamp is against
          // `candidates.length` and NOT against `max`, because `max` is already
          // the bench-clamped total and a `"deckTop"` search is never benched.
          min: op.exact === true ? Math.min(max, candidates.length) : 0,
          max,
          dest: op.dest,
          // Spelled as two whole literals rather than a conditional spread, this
          // file's rule for an ABSENT key (D135): `caps: undefined` is not the
          // same wire value as no key at all, and these prompts are compared by
          // value. A single-group search with no distinctness rider reaches `null`
          // down exactly the path it always did, and the six older parks are
          // untouched. 🆕 D513 keys the spread on the CAP LIST being empty rather
          // than on `also` being absent, because there are now two producers of it.
          ...(caps.length === 0 ? {} : { caps }),
          note: searchNote(groups, op.dest, max, op.exact === true, op.distinctEnergyTypes === true),
        },
      };
    }
    case "evolveFromDeck": {
      // 🆕 D307 — "Search your deck for a card that evolves from this Pokémon and
      // put it onto this Pokémon to evolve it." The candidate set is a BOARD read
      // (`evolveFromOf(card) === <this body's top card name>`), which is exactly
      // why this is not a `searchDeck` `dest`: `matchesFilter` never sees the
      // board, so no `CardFilter` at any width can express it.
      //
      // "Up to" like every pile scan — `min: 0`, so a player holding a body they
      // would rather not evolve may decline, and the trailing `shuffleDeck`
      // fires anyway. An empty deck match is the same silent no-op `searchDeck`
      // takes; so is a source that is no longer on the board (a "this Pokémon"
      // op's standing answer, `switchActive.fromSource`'s precedent).
      //
      // 🆕 D308 — `op.onto` is the ONE thing that can redirect it, and it is
      // written only by the two ops below (`evolveFromDeckEachBenched`'s schedule
      // and `evolveFromDeckChosen`'s answer), never by a printed sentence. The
      // prompt note is built from the OFFER's name either way, so a redirected
      // copy asks about that body by name rather than about the attacker.
      // 🆕 D309 — it is a `PokemonTarget` and no longer a bench index, because the
      // body-choice sentence's answer may be the ACTIVE (the op's doc block in
      // `effects.ts` carries the whole argument for the widening).
      // 🆕 D310 — `op.names`, when the printed sentence names its targets instead
      // of describing them. Threaded into the offer, where it REPLACES the chain
      // predicate rather than narrowing it (the doc block in `effects.ts`).
      const offer = evolveFromDeckOffer(state, ctx, op.onto, op.names);
      if (offer === undefined || offer.candidates.length === 0) return { done: state };
      return {
        park: {
          kind: "chooseCards",
          candidates: offer.candidates,
          min: 0,
          max: 1,
          dest: "evolve",
          // 🆕 D310 — AND THE NOTE MOVES WITH THE PREDICATE. A named-set park told
          // "a card that evolves from Pidove" would describe its own candidates
          // FALSELY — Unfezant does not evolve from Pidove, which is the whole
          // reason the field exists — and a dialog that names the wrong thing in
          // its own words is the defect `dest`'s own split exists to prevent
          // (D307). The names are joined rather than articled: "an" belongs to the
          // card's printed sentence, not to a list this code builds.
          note:
            op.names === undefined
              ? `Search your deck for a card that evolves from ${offer.name} and put it onto ${offer.name} to evolve it.`
              : `Search your deck for ${op.names.join(" or ")} and put it onto ${offer.name} to evolve it.`,
        },
      };
    }
    case "evolveFromDeckEachBenched": {
      // 🆕 D308 — "For each of your Benched Pokémon, search your deck for a card
      // that evolves from that Pokémon and put it onto that Pokémon to evolve it."
      // Vivillon `sv08-007`/`-193`, Reuniclus `sv10.5b-039`/`svp-212`.
      //
      // 🛑 THIS OP ASKS NOTHING. *"For each"* is not a choice, so the whole of it
      // is D216's `schedule`: one `evolveFromDeck` per OCCUPIED bench slot, in
      // bench order, each of which parks on its own body when that body has a
      // candidate in the deck and silently does nothing when it does not. The
      // second park D307 priced is not owed, because no single op parks twice —
      // `runProgram` unshifts these onto the queue and `rest` carries the ones
      // not yet reached across each park, exactly as the three gates' branches
      // travel (§the `cont.rest` line in `runProgram`).
      //
      // ⚠️ EMPTY BENCH ⇒ an empty schedule, which is the printed sentence doing
      // nothing on a board with nothing to iterate. The trailing `shuffleDeck` is
      // NOT scheduled here: it is the deriver's second op and therefore already
      // BEHIND everything this unshifts, which is what makes the printed single
      // "Then, shuffle your deck." one shuffle rather than N.
      const bench = state.players[ctx.seat].bench;
      const schedule: EffectOp[] = [];
      for (const [index, body] of bench.entries()) {
        if (body === undefined || body === null) continue;
        schedule.push({ op: "evolveFromDeck", onto: { spot: "bench", index } });
      }
      return { done: state, schedule };
    }
    case "evolveFromDeckChosen": {
      // 🆕 D309 — "Search your deck for a card that evolves from 1 of your Pokémon
      // and put it onto that Pokémon to evolve it." Duosion `sv10.5b-038`/`-119`.
      //
      // 🛑 THIS OP ASKS THE BODY QUESTION AND NOTHING ELSE. The card question is
      // `evolveFromDeck`, which already exists and already parks; one op gets one
      // park, so the two questions are two ops and the answer travels between them
      // through `continuationOps` (the THIRD member of that seam).
      //
      // ⚠️ THE CANDIDATES ARE NARROWED TO BODIES THE DECK CAN ACTUALLY EVOLVE.
      // "1 of your Pokémon" is the whole own board, Active included — the printed
      // word is not "Benched" — but offering a body with no matching card in the
      // deck spends the only decision the sentence has on a guaranteed whiff. The
      // narrowing is HERE and not in `programPlayable`, which never reads the deck:
      // a board where nothing matches is a legal declaration that resolves to
      // nothing, the silent ending `searchDeck` and `evolveFromDeck` both take, and
      // the deriver's trailing `shuffleDeck` still fires.
      // 🆕 D315 — the narrowing now lives in `evolvableOwnRefs`, shared with the
      // MULTI-body op below. NO TYPE is passed: this sentence prints no noun, and
      // the builder's `pokemonType` is optional precisely so the untyped reading
      // stays byte-for-byte what it was.
      const eligible = evolvableOwnRefs(state, ctx);
      if (eligible.length === 0) return { done: state };
      // `parkOrForce`'s own ordering — nothing / one / many — but NOT that helper:
      // its forced arm applies a `(ref) => GameState`, the one shape that cannot
      // ask a second question. A single eligible body is ANSWERED and handed on
      // through the SAME helper the parked ending uses, so a board of one and a
      // board of two resolve this sentence down one code path (`moveCountersChosen`
      // §QUESTION 1's argument, verbatim, at its second site).
      const forced = eligible.length === 1 ? eligible[0] : undefined;
      if (forced !== undefined) return { done: state, schedule: evolveBodyAnswered(forced) };
      return {
        park: {
          kind: "choosePokemon",
          candidates: eligible,
          // THE PROMPT SAYS WHAT THE ANSWER BUYS (the §9.2 note doctrine, owed for
          // D216's reason at this site too): the answer buys a SECOND prompt, and a
          // player told only "which Pokémon?" would read this as the whole decision.
          note: "Search your deck for a card that evolves from which of your Pokémon? You will then choose the card.",
        },
      };
    }
    case "evolveFromDeckEachChosen": {
      // 🆕 D315 — "Choose up to 2 of your {D} Pokémon. For each of those Pokémon,
      // search your deck for a card that evolves from that Pokémon and put it onto
      // that Pokémon to evolve it." Team Rocket's Nidorina `sv10-115`.
      //
      // 🛑 ONE PARK, N OPS. This is D308's iteration over a list the player picks,
      // so the op asks the body question ONCE — as a `choosePokemonMulti` — and the
      // answer buys one `evolveFromDeck` per picked body through `continuationOps`
      // (its FOURTH member, and the first to answer a multi). One op still gets one
      // park; the per-body parks belong to the ops the answer buys.
      //
      // ⚠️ NO FORCED-SINGLE, WHICH IS WHERE THIS PARTS FROM `evolveFromDeckChosen`
      // ABOVE. That op forces a board of one because *"1 of your Pokémon"* is
      // MANDATORY — with one eligible body there is no decision left. *"Choose UP
      // TO 2"* keeps a decision on every board, because taking fewer (including
      // NONE) is a printed answer, so this parks whenever ≥1 candidate exists —
      // `searchDeck`'s and `healChosen.upTo`'s rule, and the same take-fewer right
      // over one candidate as over six (D47).
      //
      // §8.6: `max` is clamped to the board, so a printed "up to 2" over one
      // eligible body offers 1. `min` is 0 and `declinable` stays FALSE — a
      // `min: 0` prompt is declinable by construction and the flag is for the
      // separate printed "you may" (the prompt's own doc block).
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
      // The discard-pile twin of searchDeck (§7.1 recovery Items). Hand and deck
      // have no capacity cap, so `max` is used as printed; the BENCH does, and
      // D237's `dest: "bench"` therefore clamps exactly as searchDeck's own bench
      // arm clamps — `Math.min(op.max, benchSpace(...))` BEFORE anything leaves
      // the pile, so a full Bench is a silent no-op rather than a card stranded
      // in neither zone.
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
      // Look at the top n cards (index 0 = top); the candidates are those
      // matching the filter, in deck order. "Up to"/declinable like searchDeck →
      // parks whenever ≥1 candidate (the player may still take none); an empty
      // top-n match is a no-op. The candidate set is the top-n matches ALONE, so
      // resolveEffect's validateChoice (picks ⊆ candidates) already forbids a
      // deeper card. "Shuffle the other cards back" is the trailing shuffleDeck op.
      //
      // 🆕 D332 — `also` IS A SECOND filter/cap PAIR OVER **THIS SAME `top`**, and
      // that is the whole of why Drayton cannot be two ops: `top` is recomputed
      // from the live deck at every op, so a second look would see a card that
      // slid in behind the first take (and a second look narrowed to `n - 1`
      // would go blind to index `n - 1` on the DECLINE, which this sentence
      // permits). The union is taken in DECK ORDER off `top` — one pass, so a uid
      // matching both filters appears once — and the per-group caps ride the
      // prompt, where the wire validator can see them.
      const top = state.players[ctx.seat].deck.slice(0, Math.max(0, op.n));
      const matches = (uid: string, filter: CardFilter) =>
        matchesFilter(cardOf(state, uid), filter);
      const also = op.also;
      const candidates = top.filter(
        (uid) => matches(uid, op.filter) || (also !== undefined && matches(uid, also.filter)),
      );
      // 🆕 D333 — THE PRINTED "any number of", RESOLVED HERE AND NOWHERE ELSE.
      // `moveCap`'s stated reason one op over: the clamp is what keeps the
      // PROMPT's `max` a `number`, so no wire shape moves for the op's `"any"`.
      // It resolves against the GROUP's own matches rather than against `top` or
      // against the union, which is `attachFromTopOffer`'s rule — a card cannot
      // be taken twice, so the group's candidate set is the real ceiling — and is
      // what keeps a future `also` beside an `"any"` first filter honest.
      const groupMatches = (filter: CardFilter) => top.filter((uid) => matches(uid, filter));
      const firstMax = op.max === "any" ? groupMatches(op.filter).length : op.max;
      // The TOTAL is the sum of the printed caps ("a Pokémon and a Trainer card"
      // is two cards), and `caps` is what stops those two being the same kind.
      // Spelled as two whole literals rather than a conditional spread, this
      // file's rule for an ABSENT key (D135): `caps: undefined` is not the same
      // wire value as no key at all, and these prompts are compared by value.
      const totalMax = firstMax + (also === undefined ? 0 : also.max);
      if (candidates.length === 0 || totalMax <= 0) {
        // 🛑 D241 — THE WHIFF ANNOUNCES THE LOOK. This used to be a bare
        // `return { done: state }`, which is exactly the leak the backlog's
        // `DECK_TOP_REVEALED` fidelity row named: the controller learned the top
        // `n` of their deck and the opponent was told nothing at all. What was
        // looked at is a game fact even when nothing moved, so the empty row is
        // pushed here and `log.ts` renders it as "looked at the top … and took
        // nothing". Guarded on `top.length`, not on `op.n`: a deck with fewer
        // cards than the printed window (or an `n` of 0) means NOBODY LOOKED,
        // and announcing a look that did not happen is the mirror defect.
        //
        // 🆕 D334 — AND THE EMPTY PATH IS ROUTED THROUGH THE ONE APPLY, which is
        // `attachFromTopApply`'s rule transferred rather than re-invented: with
        // `restTo` the leftovers are a cost the card charges on EVERY path,
        // including the whiff, so a branch that returned `state` here would drop
        // them. `revealFromTop` with no picks pushes exactly the row this branch
        // used to push by hand and then discards the window, so the announcement
        // is still guarded on `top.length` and still spelled in ONE place.
        if (top.length === 0) return { done: state };
        return { done: revealFromTop(state, [], op, ctx, events) };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          // 🆕 D334 — `exact` IS THE PRINTED SENTENCE, AND THE CLAMP IS THE BOARD.
          // Explorer's Guidance prints "put 2 of them into your hand" — no "up to",
          // no "you may" — so the floor is the printed take; every other printing
          // on this op is an "up to" and keeps the M5 `min: 0`. The clamp is what
          // stops a 1-card deck under a top-6 window from parking a prompt with no
          // legal answer, and it is the ONLY floor on this prompt that needs one
          // (see the type's doc). `also` is not consulted: no printing pairs a
          // mandatory take with a second noun, so `firstMax` would be the wrong
          // ceiling and `totalMax` the wrong one too — the day one does, the floor
          // becomes per-group and it belongs beside `caps`, not here.
          min: op.exact === true ? Math.min(totalMax, candidates.length) : 0,
          max: totalMax,
          // The op's ABSENT `dest` is the HAND (D135); the prompt's is REQUIRED,
          // so the default is spelled once, here, at the one site that must say
          // it out loud.
          dest: op.dest ?? "hand",
          // ⚠️ THE CAPS ARE THE RAW MATCH SETS AND MAY OVERLAP — a uid answering
          // both filters counts against BOTH caps (effects.ts states the rule and
          // why the conservative reading is the safe one). Drayton's two are
          // disjoint, so no printed board can tell the readings apart.
          ...(also === undefined
            ? {}
            : {
                caps: [
                  { uids: groupMatches(op.filter), max: firstMax },
                  { uids: groupMatches(also.filter), max: also.max },
                ],
              }),
          note: lookNote(op.filter, op.n, op.max, op.dest, also, op.exact === true),
        },
      };
    }
    case "reorderTop": {
      // 🆕 D341 — "…and put them back IN ANY ORDER." Nothing moves zone; the whole
      // effect is the sequence the window is left in.
      //
      // 🛑 THE DECK IS `op.side`'s, NOT `ctx.seat`'s, AND THIS IS THE FIRST
      // DECK-TOP OP FOR WHICH THOSE DIFFER. Spelled once, here, and read by both
      // the park and the apply through the same helper so a park and its resolve
      // can never disagree about whose deck they are ordering.
      const owner = reorderTopOwner(ctx.seat, op);
      // 🆕 D343 — WHICH END. Absent `from` is the top (`slice(0, n)`, unchanged);
      // `"bottom"` takes the LAST `n` in deck order, so index 0 of the window is
      // still the card CLOSEST TO THE TOP of the two — the window reads the same
      // way at either end, which is what lets one dialog and one validator serve
      // both. `reorderWindow` is the single reader; the apply calls the SAME
      // helper's arithmetic rather than re-deriving it, for the reason the owner
      // is spelled once above: a park and its resolve must not be able to
      // disagree about which cards are in play.
      const top = reorderWindow(state.players[owner].deck, op);
      // 🛑 THE LOOK IS ANNOUNCED ON EVERY PATH, INCLUDING THE ONES THAT DO NOT
      // PARK — D241's rule, and the reason it is pushed BEFORE the degenerate
      // return rather than inside the apply: a 0- or 1-card window is exactly the
      // case where no decision is owed and the information transfer is the only
      // thing that happened. `count` is what was actually LOOKED AT (`top.length`),
      // never the printed `op.n`: a 2-card deck under a printed top-5 taught the
      // looker two cards and announcing five would be a claim about cards nobody
      // saw. This row is the whole of what the other seat is owed — see the
      // event's doc block for why it names no card.
      //
      // 🆕 D343 — THE ROW FIRES ON THE BOTTOM FORK TOO, AND THE TEMPTING
      // EXEMPTION IS REFUSED. On Kofu the controller placed those two cards there
      // themselves one op earlier, so nothing is learned and an argument for
      // emitting nothing is available. It is refused because it is true of the
      // CARD and false of the FORK: a future *"look at the bottom 3 cards of your
      // deck and put them back in any order"* is a real look, and gating a
      // CONFIDENTIALITY row on a WINDOW would key the rule to the wrong fact.
      // D241's rule stays unconditional; `end` is carried so the row can say
      // which end was read instead of asserting the wrong one.
      events.push({
        type: "DECK_TOP_REORDERED",
        seat: owner,
        actor: ctx.seat,
        count: top.length,
        ...(op.from === "bottom" ? { end: "bottom" as const } : {}),
      });
      // M1's no-choice doctrine, and here it is arithmetic: 0 or 1 card admits
      // exactly one ordering, so a park would offer a prompt with one legal
      // answer. Guarded on the LIVE window rather than on `op.n`, the same
      // distinction `lookAtTopN`'s whiff branch draws.
      //
      // 🆕 D344 — **AND `otherwise` NEEDS NO SECOND TEST HERE, WHICH IS
      // ARITHMETIC RATHER THAN LUCK.** With a printed alternative the question is
      // no longer "is there more than one ordering" but "do the two arms differ",
      // and those coincide: `top.length` is `min(op.n, deck.length)`, so for any
      // `op.n >= 2` a window under 2 means a DECK under 2, and shuffling a 0- or
      // 1-card window onto the bottom of what remains of it is the state it was
      // already in. The one board that separates the tests is `op.n === 1` over a
      // long deck, which no printed sentence spells — an alternative to ordering
      // ONE card is not a decision any card offers.
      if (top.length < 2) return { done: state };
      return {
        park: {
          kind: "orderCards",
          // In current deck order, index 0 = the top. The dialog needs the order
          // it is starting FROM, and the identity permutation has to be a
          // reachable answer.
          candidates: top,
          note: reorderNote(op),
          // 🆕 D344 — the printed `, or …` arm's own words, which the dialog
          // renders as a second button and `validateChoice` reads as the licence
          // for an EMPTY answer. Spelled as a conditional spread rather than as
          // `alt: op.otherwiseNote` for this file's ABSENT-KEY rule (D135): these
          // prompts are compared by value, and `alt: undefined` is not the same
          // wire value as no key at all — every park before this slice must keep
          // its exact shape.
          ...(op.otherwiseNote === undefined ? {} : { alt: op.otherwiseNote }),
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
      //
      // 🆕🆕 D488 — AND IT RECORDS NOW, WHICH IS THE ONE THING ABOVE THAT MOVED.
      // *"Discard the top 3 cards of your deck, and this attack does 80 damage for
      // each Energy card you discarded in this way."* files the milled uids under
      // `recordAs` so the trailing `damageDefender` can count a SUBSET of them.
      // ⚠️ **THE EMPTY ANSWER IS FILED BEFORE THE ZERO-CARD RETURN, NOT AFTER IT** —
      // `discardPileRetrieval`'s rule, repeated at `attachFromDeck`: an op that RAN
      // and moved nothing must OVERWRITE its slot, or a stale value from an earlier
      // writer survives and the count answers for the wrong op. A milled-out deck is
      // exactly that path, and it is the one the early `return` would have skipped.
      //
      // 🆕🆕 D490 — AND `whose` PICKS A **LIST** OF SEATS NOW, WHICH IS THE ONE THING
      // ABOVE THAT MOVED AGAIN. *"Discard the top card of each player's deck. This
      // attack does 140 more damage for each Energy card discarded in this way."* mills
      // BOTH decks and scores the Energy across both, so the slot has to hold what came
      // off each of them — and `recordMoved` ASSIGNS, so two sequential mills would
      // leave only the second deck's card in it.
      //
      // 🛑 **A `switch` AND NOT THE TERNARY IT REPLACES.** The old line was
      // `op.whose === "self" ? ctx.seat : otherSeat(ctx.seat)`, and a third member would
      // have fallen silently out of the wrong side of it — aiming the two-deck mill at
      // the opponent alone, with `tsc` reporting nothing (D222/D425/D447, the defect
      // D447 measured at `snipeTargets` one op over). A missing case is a compile error.
      //
      // ⚠️ **CONTROLLER-FIRST, and `handRefresh`'s `who: "both"` is the precedent rather
      // than `counterEachAll`'s `side: "both"`** — see the op's own doc block for the
      // distinction between the two (one row per SEAT against one row per BODY).
      //
      // ⚠️ **THE STATE IS THREADED THROUGH THE LOOP (`next`), NEVER `state`.** A second
      // `withSide(state, …)` would write the second deck's board on top of a snapshot
      // taken before the first mill and put the attacker's milled card back on top of
      // their deck — D429's stale write-back, which corrupts the board rather than
      // merely failing to see it, and which every count assertion in a one-deck suite
      // is blind to.
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
        // `seat` is the deck's OWNER and `actor` the player whose card did it, so the
        // two coincide on `whose: "self"` and diverge on `whose: "opponent"` — and
        // `"eachPlayer"` emits ONE ROW OF EACH, which is why no wording in log.ts moved.
        // The log's voice hangs off that comparison (D153): Wild Splash's own-deck cost
        // reads ACTIVE under the attacker's name, the mill reads PASSIVE under the
        // victim's.
        events.push({ type: "DECK_TOP_DISCARDED", seat: victim, actor: ctx.seat, uids: milled });
        milledState = withSide(milledState, victim, {
          ...side,
          deck: side.deck.slice(milled.length),
          discard: [...side.discard, ...milled],
        });
      }
      // ONE filing, after the walk, and it runs on the empty-deck path too — the rule
      // `discardPileRetrieval` states and `attachFromDeck` repeats: an op that RAN and
      // moved nothing must OVERWRITE its slot, or a stale value from an earlier writer
      // survives and the count answers for the wrong op.
      recordMoved(record, op.recordAs, filed);
      return { done: milledState };
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
          // 🆕 D457 — the printed "attach them to 1 of your Pokémon", carried to
          // the prompt the same way `maxPerTarget` is: spread rather than written
          // as `oneTarget: undefined`, so a park that does not constrain the map
          // serializes without the key at all (D104, and the reason the parked
          // continuations of every program authored before this slice are
          // byte-identical).
          ...(op.oneTarget === undefined ? {} : { oneTarget: op.oneTarget }),
          note: attachFromDeckNote(op),
        },
      };
    }
    case "attachFromHand": {
      // D247 — the THIRD producer of the compound `attachCards` park, over the
      // third candidate zone: the controller's own HAND (Alolan Exeggutor ex
      // "Tropical Frenzy"). Same two coupled decisions the deck-side pair asks —
      // which cards, and where each one goes — and the same atomic apply.
      //
      // A dead end returns `state` rather than routing through the apply, which
      // is `attachFromDeck`'s rule and NOT `attachFromTop`'s: this op has no
      // leftovers clause to charge on the empty paths (nothing was ever taken out
      // of a pile, so there is nothing to put back or discard), and no `recordAs`
      // to overwrite either — no printing in this family carries a §9.2 tail, so
      // there is no slot a stale value could survive in.
      const { candidates, targets, max } = attachFromHandOffer(state, ctx.seat, op);
      if (candidates.length === 0 || targets.length === 0 || max <= 0) return { done: state };
      return {
        park: { kind: "attachCards", candidates, targets, max, note: attachFromHandNote(op) },
      };
    }
    case "moveEnergy": {
      // Move up to `max` Energy from ONE own Pokémon to ANOTHER (Energy Switch /
      // Poppy). Two coupled decisions (which Energy + where), so it parks on the
      // compound moveEnergy prompt and applies atomically on resolve. A no-op
      // needs no movable Energy OR no distinct destination (fewer than two of the
      // controller's Pokémon in play) — the programPlayable gate blocks the play,
      // but stay a no-op here too (a mid-program board could reach it).
      // `ctx.sourceUid` is threaded for the `koedActiveToToolHolder` route (D171):
      // it names the TOOL whose sentence is running, and the route resolves "the
      // Pokémon this card is attached to" from it. D244 — and for `othersToSelf`,
      // where it resolves BOTH ends ("your other Pokémon" → "this Pokémon"). The
      // two free routes ignore it.
      // 🆕🆕 D443 — THE BOARD IS RESOLVED FIRST AND EVERYTHING BELOW READS IT.
      // `side: "opponent"` puts BOTH endpoints on the other seat, so the endpoints
      // funnel, the apply and the event all take this one answer rather than each
      // asking `op.side` again (D222 — one helper, one answer).
      const board = moveBoardSeat(op, ctx.seat);
      const offer = moveEndpoints(state, board, op, ctx.sourceUid);
      const needed = offer.needed;
      let movable = offer.movable;
      let destinations = offer.destinations;
      // 🆕🆕 D502 — THE PRINTED DESTINATION PIN, TAKEN HERE AND NOT IN
      // `moveEndpoints`. Jynx `sv06-046`'s *"to THE NEW Benched Pokémon"* is the
      // body its own `searchDeck` just filed, so the offer is narrowed to whichever
      // in-play bodies carry a filed uid in their `stack`.
      //
      // ⚠️ AT THE CALLER BECAUSE THE FUNNEL'S SECOND READER HAS NO RECORD.
      // `moveEndpoints` is shared with `moveEnergyPlayable` (the `programPlayable`
      // gate), which is handed no `EffectRecord` and could not be — so threading one
      // in would add a parameter at both call sites to answer a question one of them
      // cannot ask. D443's rule: check whether the CALLER already holds the fact.
      // This one does, and the funnel stays byte-identical.
      //
      // ⚠️ AND IT RUNS **BEFORE** THE §11 ASK BELOW, WHICH IS D433's ORDERING RULE
      // AND NOT AN ACCIDENT OF PLACEMENT: this is a PRINTED narrowing, so a body the
      // sentence never named must not file a prevention row. On this printing the
      // shield block is skipped anyway (`side` is absent, so `board === ctx.seat`),
      // which makes the order unobservable today — stated rather than relied on.
      //
      // ⚠️ `refPokemon` RATHER THAN A HAND-SPELLED SPOT TEST, so a ref whose body has
      // left play drops out here as `undefined` instead of reaching the park.
      if (op.destRecorded !== undefined) {
        const filed = new Set(recorded(record, op.destRecorded));
        destinations = destinations.filter((ref) =>
          (refPokemon(state, ref)?.stack ?? []).some((uid) => filed.has(uid)),
        );
      }
      // 🛑 §11 (D142/D259) — THE REFUSAL GATE, ASKED BY THIS OP FOR THE FIRST TIME,
      // BECAUSE UNTIL D443 IT COULD NOT NAME A BODY ITS CONTROLLER DOES NOT OWN.
      // Moving Energy off a Pokémon and moving Energy onto one are both effects of
      // an attack DONE TO that Pokémon, and the shields carry no valence — every
      // printing in the family says "prevent all … effects of attacks done to this
      // Pokémon", never "all harmful effects" — so the model answers both ends with
      // one question and a harm/benefit split would be a rule invented here (D424:
      // prefer the refusal the model re-derives over the one listed against it).
      //
      // A FILTER AND NOT A GUARD, which is D259's placement rule: this op CHOOSES
      // its endpoints from a set, so one shielded body must remove itself and leave
      // the rest pickable — refusing the whole op would make one Mist Energy on a
      // five-body Bench protect the Bench, a rule no printing states. And it is
      // asked AFTER the printed narrowing (D433): `moveEndpoints` has already run,
      // so a body this route never offered files no row.
      //
      // ⚠️ ONE ROW PER BODY, NOT ONE PER ENERGY AND NOT ONE PER ENDPOINT LIST. A
      // `movable` entry is an ENERGY, and on the free route the same body is both a
      // source and a destination, so the named set is deduped through a Map before
      // the funnel is asked — three Energy on one shielded Fraxure that is also an
      // offered destination is ONE refusal. The Map (rather than the sibling
      // discard arm's `bodies.some(...)` scan) is deliberate: writing that line a
      // second time would make `D259`'s row match twice, which is D437's converse
      // trap and what `precheck` exists to catch.
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
      // 🆕🆕 D441 — THE FORCED ARM, AND IT IS THIS OP'S FIRST. `parkOrForce`'s
      // doctrine is 0 candidates ⇒ silent no-op, 1 ⇒ forced, ≥2 ⇒ park; this op
      // hand-rolls the 0 and the ≥2 above and has never had the 1 — not by
      // oversight, but because a DECLINE is always a second answer, so no board this
      // op could reach ever offered only one. A mandatory quantity removes it: with
      // the picks fixed at the whole `movable` set and a SINGLE eligible
      // destination there is literally one legal answer, and asking for it is the
      // redundant click D171's sole-destination rule already refuses INSIDE the
      // dialog — taken here instead, where no dialog has to exist.
      //
      // ⚠️ GATED ON THE FLOOR AND NOT ON `destinations.length` ALONE, which is what
      // keeps every declinable printing parking exactly as it did: Armarouge and
      // Exp. Share both offer exactly one destination and both must still ask,
      // because the answer they would be forced into is one the player may refuse.
      //
      // 🆕 D442 — STILL GATED ON `destinations.length === 1` UNDER `anyDest`, AND
      // THAT IS THE SAME TEST RATHER THAN A LUCKY ONE: a spread over ONE
      // destination is not a spread. With the quantity fixed and a single body to
      // put it on, the map has exactly one inhabitant whatever the rider says.
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
          // D244 — "any amount" is CLAMPED here rather than carried, so the prompt
          // (and therefore the wire schema, the validator and both dialogs) keeps
          // the plain number it has always had. `attachFromTop`'s spelling.
          max: cap,
          // 🆕 D441 — and the FLOOR is clamped by the same rule at the same moment,
          // for the same reason. Spread rather than written as 0, so a declinable
          // park's shape is BYTE-IDENTICAL to the one it had before the floor
          // existed — `anySource`'s spelling one line down, and what keeps the wire
          // field optional and `MATCH_RECORD_VERSION` at 29.
          ...(floor === 0 ? {} : { min: floor }),
          // D226 — carried onto the prompt because every downstream reader (the
          // wire validator, the wire schema, both HUD dialogs) reads the PROMPT.
          // Spread rather than set to `undefined` so a single-source park's shape
          // is byte-identical to the one it had before the rider existed.
          ...(op.anySource === undefined ? {} : { anySource: op.anySource }),
          // 🆕 D442 — the destination-side rider, carried by the identical rule for
          // the identical reason: the wire validator, the wire schema and both HUD
          // dialogs read the PROMPT and never the op, and spreading rather than
          // assigning keeps a coupled park's persisted shape byte-identical.
          ...(op.anyDest === undefined ? {} : { anyDest: op.anyDest }),
          note: moveNote(op),
        },
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
      //
      // ⚠️ D222 — ASKS `discardVictimSeat`, WHERE IT USED TO SPELL THE OWN-BOARD
      // MEMBERS A SECOND TIME (`op.from !== "yourActive" && op.from !== "yours"`).
      // The two readings were equal by construction and stopped being so the
      // moment a third own-board member (`self`) existed: the old conjunction
      // would have sent an Ability's own printed cost through the OPPONENT's §11
      // block, so a self-discard could be refused by a rule about attacks done to
      // somebody else. One helper, one answer — the reason that helper exists.
      //
      // 🆕 D259 — AND IT IS NOW EXPLICITLY THE *ATTACK* CHANNEL'S GUARD, WHICH IS
      // A CORRECTION THE TRAINER CHANNEL FORCED RATHER THAN A NARROWING FOR ITS
      // OWN SAKE. `effectRefused` defaults its target to the victim seat's ACTIVE,
      // which is exactly right for an attack (§8 aims there and the op's opponent
      // arms name that one body) and exactly wrong for a Trainer: a shielded
      // Fraxure standing in the Active Spot would refuse a Crushing Hammer aimed
      // at the whole board, protecting four benched teammates with a sentence that
      // says "this Pokémon". The trainer channel is served by the FILTER below
      // instead, which subsumes this guard for it — when the op does name only the
      // Active, that Active is the only candidate and the filter empties the set.
      if (ctx.invokedBy === "attack" && discardVictimSeat(ctx.seat, op) !== ctx.seat) {
        if (effectRefused(state, discardVictimSeat(ctx.seat, op), ctx, events)) {
          recordMoved(record, op.recordAs, []);
          return { done: state };
        }
      }
      // 🆕 D259 — THE TRAINER CHANNEL FILTERS INSTEAD OF REFUSING, AND THE TWO
      // GUARDS SIT ONE ABOVE THE OTHER RATHER THAN MERGED, because they answer
      // different questions about a different number of bodies. The §11 ATTACK
      // block above refuses the op whole and correctly so: an attack's discard
      // aimed at the opponent names their ACTIVE, one body, and a refused Active
      // is a refused op. Crushing Hammer's `opponentChosen` names a SET, so one
      // shielded Cetitan ex on the Bench must remove itself from the prompt and
      // leave the rest pickable. Applied to EVERY arm and not just the opponent
      // ones for `discardVictimSeat`'s reason verbatim — a self-discard's refs are
      // on `ctx.seat`, whose bodies the trainer channel skips by construction (a
      // Supporter you play is not one "your opponent plays"), so no `from` branch
      // is needed here either.
      //
      // ⚠️ THE DISTINCT-BODY PASS IS WHAT KEEPS THE LOG HONEST. A candidate is an
      // ENERGY, so three {W} on one shielded Fraxure are three candidates and ONE
      // refusal; asking the funnel per candidate would print the same row three
      // times. Board order is preserved by building the body list in candidate
      // order rather than from a Set.
      const allDiscardable = discardableEnergies(state, ctx.seat, op, ctx.sourceUid);
      const bodies: PokemonRef[] = [];
      for (const entry of allDiscardable) {
        if (!bodies.some((ref) => refKeyOf(ref) === refKeyOf(entry.from))) bodies.push(entry.from);
      }
      const allowed = new Set(unshieldedRefs(state, bodies, ctx, events).map(refKeyOf));
      const discardable = allDiscardable.filter((entry) => allowed.has(refKeyOf(entry.from)));
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
      // 🆕🆕🆕 **D489 — THE DECLINABLE ARM, TAKEN AHEAD OF THE EXACT ONE BECAUSE ITS
      // ENDINGS ARE DIFFERENT ENDINGS AND NOT A WIDER `min`.** *"Discard up to 3 Energy
      // cards from your hand."* has a printed floor of ZERO, so:
      //   • an EMPTY offer (no hand, or nothing matching the printed noun) is the whiff
      //     every recording op takes — file `[]` so the damage clause reads an honest 0
      //     rather than a stale slot, and resolve inline;
      //   • ANY non-empty offer PARKS, including a single candidate. The M1 no-choice
      //     rule retires a prompt whose answers are the same state, and under an *"up
      //     to"* the answers are "this card is discarded" and "nothing is" — two
      //     different boards and two different damage numbers. `discardEnergy`'s
      //     `count: "any"` arm is the standing precedent and D297 is the rule.
      // ⚠️ THE CEILING IS `cap` CLAMPED TO THE OFFER, `discardEnergy`'s own line: a cap
      // above the number of matches would let a crafted frame answer with more uids
      // than exist, and `validateChoice` reads the PROMPT.
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
            max: Math.min(op.cap, candidates.length),
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
          // No decline: min === max. 🆕 D334 CORRECTED THIS COMMENT, which claimed
          // to be "the ONE mandatory chooseCards park (every other consumer is a
          // printed 'up to')" — false since `bottomFromOpponentHand` shipped its
          // unridden exactly-one `min: 1`, and false twice over now that
          // `lookAtTopN.exact` exists. The prompt doc above carries the real list.
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
      //
      // D232 — through `revealHand`, shared with the standalone
      // `revealOpponentHand` op below. Two producers of one printed fact, and
      // exactly one spelling of it.
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
      // 🆕 D297 — THE AUTO-RESOLVE IS NOW CONDITIONAL ON THE PICK BEING
      // MANDATORY, and that is the sharpest line in the row. The M1 no-choice
      // rule retires a prompt whose ANSWERS ARE THE SAME STATE; under a printed
      // "up to" the answers are "one card moves" and "nothing moves", which are
      // not the same state — so a lone candidate under `upTo` must still be
      // ASKED. Taking the shortcut there would put a Basic onto the opponent's
      // Bench without the controller ever being offered the decline the card
      // prints. (`discardEnergy`'s `count: "any"` arm is the standing precedent:
      // it parks on every non-empty board for exactly this reason.) The five
      // printings with no `upTo` keep the shortcut unchanged — their pick is
      // compulsory and one candidate really is no decision.
      if (op.upTo === undefined && candidates.length === 1) {
        const moved = bottomFromOpponentHandApply(state, candidates, ctx, events, op.dest);
        recordMoved(record, op.recordAs, moved.moved);
        return { done: moved.state };
      }
      // The BENCH clamp searchDeck and discardPileRetrieval both take at their
      // parks: never ask for more bodies than can land. The apply clamps AGAIN on
      // a live board (a wire answer arrives later), so this one is about the
      // QUESTION rather than about safety.
      // 🆕 D350 — A SENTENCE WITH NO NUMBER HAS NO CEILING OF ITS OWN, so the
      // printed *"any number of"* (Lillie's Ribombee "Inviting Wink") takes the
      // OFFER's size as its cap and everything below it is unchanged. Resolved
      // into a local BEFORE the clamp rather than inside it, so the two facts stay
      // apart: what the CARD allows, then what the BOARD allows. `candidates` is
      // already the filtered, class-collapsed offer, so this is the widest answer
      // the player could ever give — never wider.
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
          // D294 — the prompt's `dest` is the op's, and the two vocabularies
          // already agree: `chooseCards.dest` has carried `"bench"` since the
          // search family, so the WIRE schema (`redacted.ts`'s z.enum) takes ZERO.
          // ⚠️ It names the ZONE KIND and not the OWNER — a `"bench"` prompt here
          // is the OPPONENT's bench — which is why `note` carries the printed
          // sentence and the dialog reads that rather than deriving a caption.
          dest: op.dest ?? "deckBottom",
          note: bottomFromOpponentHandNote(op),
        },
      };
    }
    case "revealOpponentHand":
      // D232 — the case directly above's FIRST LINE, standing alone, and that is
      // the entire op. No filter, no offer, no park, no card moved: the sentence
      // ("Your opponent reveals their hand.") is one verb with no object beyond
      // the hand itself. An EMPTY hand still reveals — honestly, as zero uids —
      // because there is no decision here for the M1 no-choice rule to retire and
      // "they showed me nothing" is a real thing that happened at the table.
      revealHand(state, otherSeat(ctx.seat), events);
      return { done: state };
    case "randomFromOpponentHand":
      // D232 — the FIRST op whose outcome is drawn from `rngState`. Never parks:
      // "random" is precisely the absence of a chooser, so neither seat is asked.
      return { done: randomFromOpponentHand(state, op, ctx, events) };
    case "opponentDiscardsFromHand": {
      // 🆕🆕 D426 — the OPPONENT-CHOOSES half of the same family, and the ONE park
      // in this engine that shows a player their OWN hidden hand on the OTHER
      // player's turn. `owner` is the hand, the chooser, the discard pile AND the
      // answerer — four roles that every other cross-seat op in this file splits
      // between two seats, which is exactly why `decider` is set here.
      const owner = otherSeat(ctx.seat);
      const hand = state.players[owner].hand;
      // 🛑 §8.6 — DO AS MUCH AS YOU CAN, and that ONE rule answers both short
      // boards. `take` is the printed count clamped to the hand, so:
      //   · an EMPTY hand takes zero, and the two lines below make that a silent
      //     no-op — no event (there is nothing to announce; the ATTACK_DECLARED
      //     row above already said the attack happened) and no park (there is no
      //     decision here for the M1 no-choice rule to retire). This is
      //     `randomFromOpponentHand`'s empty-hand ending, and `payFromHandApply`'s
      //     `paid.length === 0` guard, arriving at one op from two directions.
      //   · a hand of `take` cards or fewer has exactly ONE answer to "which
      //     `take` of your `M`", so the M1 rule FORCES it and nothing is asked.
      //     ⚠️ A SHORT HAND AND AN EXACT HAND ARE TWO DECISIONS SHARING ONE LINE:
      //     at `M === count` the printed count is met and there is no choice; at
      //     `M < count` the printed count CANNOT be met and the card does what it
      //     can. Both are driven (`opponentHandDiscard.test.ts` §4), because a
      //     decision that is not pinned is indistinguishable from an oversight.
      const take = Math.min(op.count, hand.length);
      if (take === 0) return { done: state };
      if (hand.length <= take) {
        return { done: discardChosenFromHand(state, owner, hand, events) };
      }
      // 🛑 THE PARK, AND ITS FLOOR IS TRUE BY CONSTRUCTION. `min === max === take`
      // is a MANDATORY exact pick — the only decision is WHICH cards, never
      // whether — and every board that could make that floor unanswerable was
      // already swallowed by the forced arm above. So this op needs no
      // `lookAtTopN`-style clamp; it is `payFromHand`'s and
      // `bottomFromOpponentHand`'s "gated upstream on a zone that holds the cards"
      // reached by a different route, and `take === op.count` here always.
      //
      // 🛑 THE WHOLE HAND IS THE OFFER — NO INTERCHANGEABLE COLLAPSE. Both sibling
      // hand-picks collapse duplicate classes; both do it for an information
      // argument this park does not have (see the op's doc). The answerer owns
      // this hand and is looking at it.
      return {
        park: {
          kind: "chooseCards",
          candidates: [...hand],
          min: take,
          max: take,
          dest: "discard",
          note: opponentDiscardNote(op),
        },
        // 🛑 THE OPPONENT ANSWERS, AND THIS ONE FIELD IS THE WHOLE OF IT. The park's
        // `decider` becomes `phase.answerer` (flow.ts `settleProgram`), which
        // `resolveEffect` gates on (cardplay.ts), `phaseViewOf` reports as the
        // waiting seat, and `redactedPromptOf` uses to send this prompt — hand card
        // identities and all — to the OWNER alone. A build that dropped it would
        // hand the controller a list of the opponent's hidden cards AND let them
        // choose what their opponent discards; both halves are driven.
        decider: owner,
      };
    }
    case "discardFromOpponentHand": {
      // 🆕🆕 D485 — the MANDATORY sweep, and the whole arm is four lines because
      // every piece of it already shipped. `otherSeat(ctx.seat)` is the same
      // re-derivation `opponentDiscardsFromHand` does one case up (the context is
      // the PROGRAM's owner and never an answerer); `matchesFilter(cardOf(...))` is
      // `bottomFromOpponentHand`'s own candidate line; and `discardChosenFromHand`
      // is D426's helper, which files `FORCED_HAND_DISCARD` under the OWNER and
      // emits nothing at all when the set is empty.
      //
      // 🛑 **THERE IS NO PARK AND NO `decider`, AND THAT IS THE OP RATHER THAN AN
      // OMISSION.** The printed sentence names a PREDICATE — *"Discard **all** Item
      // cards and Pokémon Tool cards"* — so there is exactly one answer to "which
      // cards" on every board, and the M1 no-choice rule retires the question before
      // it can be asked. Parking here would hand a player a dialog whose only legal
      // answer is the whole offer. Contrast the case above, whose printed COUNT is
      // smaller than the hand it is taken from and therefore IS a decision.
      //
      // 🛑 **AND THE HAND IS READ LIVE AND FILTERED HERE, NEVER AT DERIVE TIME.**
      // The filter is a fact about CARDS; the hand is a fact about the BOARD. A build
      // that resolved the candidate set anywhere but at the moment the op runs would
      // be reading a zone the reveal one op earlier has only just made public.
      const swept = state.players[otherSeat(ctx.seat)].hand.filter((uid) =>
        matchesFilter(cardOf(state, uid), op.filter),
      );
      return { done: discardChosenFromHand(state, otherSeat(ctx.seat), swept, events) };
    }
    case "opponentMayDraw": {
      // The opponent's printed "may" — the FIRST park whose ANSWERER is the other
      // seat (the decider below; settleProgram files it as phase.answerer).
      // 🆕🆕 D426 — this read "the ONE park" and had been false since D227 added
      // `opponentSwitchOut`'s decider; D426's `opponentDiscardsFromHand` is the
      // third. `RunResult.decider`'s doc carries the enumeration. An
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
    case "switchActive": {
      // D206 — `ownerPokemon` narrows the candidates through the SHARED
      // predicate (`subgroupRefs`, D205's helper over D200's `matchesFilter`
      // arm), and the printed sentence's OTHER end is the emptying below: an
      // Active outside the subgroup means there is no "your Active <owner>'s
      // Pokémon" to switch, so nothing is offered and `parkOrForce`'s silent
      // zero-candidate ending resolves the op — the same ending an empty Bench
      // already took. Computed by `switchActiveTargets` so `programPlayable`
      // (cardplay.ts) asks the op's OWN question rather than a second copy of it.
      // D244 — `ctx.sourceUid` is threaded for the `fromSource` arm alone (the
      // printed pronoun); every other reading of this op ignores it, exactly as
      // `moveEnergy` threads it for two of its four routes.
      const candidates = switchActiveTargets(state, ctx.seat, op, ctx.sourceUid);
      // ⚠️ NO EXPLICIT EMPTY FILING ON THE ZERO-CANDIDATE PATH, and it was
      // written and then REMOVED rather than tested around (D205's precedent).
      // The other recording ops spell `recordMoved(record, op.recordAs, [])` on
      // their whiffs; here that line is (a) UNREACHABLE from either authored row
      // — `programPlayable` refuses a Trainer whose `switchActiveTargets` is
      // empty, and both rows are Trainers — and (b) BEHAVIOURALLY IDENTICAL to
      // omitting it even if it were reached, because `recorded()` answers `[]`
      // for a missing key and `recordGateHolds` asks the LENGTH. A line that
      // cannot run and could not matter is a line whose mutant no test can kill.
      return parkOrForce(
        state,
        candidates,
        (ref) => switchRecording(op, (into) => switchOwn(state, ref, ctx, into), events, record),
        // 🆕 D273 — through `switchTargetNoun`, so the caption carries the two new
        // riders. The unmarked and owner-narrowed prompts are byte-identical to
        // what they were: the helper's first branch is `ownerNoun` verbatim.
        `Switch to which ${switchTargetNoun(op)}?`,
      );
    }
    case "gust":
      // D206 — the MIRROR of the case above, and the catalog prints the seam both
      // ways round: Team Rocket's Giovanni switches and THEN gusts, Prime Catcher
      // `sv05-157`/`sv08.5-119` gusts and THEN switches. `gust` and `switchActive`
      // are one move on two seats, so a §9.2 seam on one and not the other would
      // be an asymmetry no printing asks for — the same `switchRecording`, with
      // `switchInto` pointed at the opponent's board.
      // 🆕 D259 — THE FIRST READ SITE OF THE TRAINER CHANNEL THAT IS NOT ALREADY ON
      // THE FUNNEL, and the one that pays for the filter shape. Boss's Orders
      // (Supporter) and Pokémon Catcher (Item) both reach here, and a forced switch
      // is an effect done to the body being dragged — so a shielded Fraxure is
      // simply not offered, and a Bench where every body is shielded whiffs.
      // 🆕 D331 — THE CANDIDATE SET NOW COMES FROM `gustTargets`, WHICH IS THE
      // SAME SET `programPlayable` REFUSES ON. The printed narrowing (Lisia's
      // Appeal's "Benched **Basic** Pokémon") lives in that one funnel and not
      // here, so the offer and the refusal cannot come to mean two different
      // things — `switchActiveTargets`' rule, reached by this op for the first
      // time. The shield stays OUTSIDE the funnel on purpose: `unshieldedRefs`
      // needs `ctx`/`events` to ANNOUNCE its refusals, which a playability
      // question has neither of and must not emit.
      return parkOrForce(
        state,
        unshieldedRefs(state, gustTargets(state, ctx.seat, op), ctx, events),
        (ref) => switchRecording(op, (into) => gust(state, ref, ctx, into), events, record),
        gustTargetNoun(op),
      );
    case "opponentSwitchOut":
      // D227 — the case DIRECTLY ABOVE with a `decider`, and that is the whole
      // diff. Same candidate set (the opponent's Bench), same move (`gust`, i.e.
      // `switchInto` on their seat), same prompt kind — the printed
      // "(Your opponent chooses the new Active Pokémon.)" moves WHO answers and
      // nothing else, so anything else differing here would be a difference no
      // sentence asked for.
      //
      // ⚠️ D228 — THE `switchRecording` WRAPPER, WHICH THIS CASE DELIBERATELY DID
      // NOT HAVE AT D227. The note that stood here read "no `recordAs` to file
      // into … no printing puts this op on the antecedent side of an 'If you
      // do'"; Grimmsnarl `sv07-096` does, so the op grew the field and this call
      // grew the helper `gust` and `switchActive` have used since D206. It is the
      // SAME helper reading the SAME `POKEMON_SWITCHED` row, so the three switch
      // ops now file identically and none of them owns a private spelling.
      //
      // THE NOTE SPEAKS TO THE ANSWERER, like `mayDrawNote` and unlike every
      // other note in this file: the opponent is picking from THEIR OWN Bench, so
      // "the opponent's Benched Pokémon" — the gust's wording one case up — would
      // be addressed to the wrong person about their own board.
      return parkOrForce(
        state,
        oppBenchRefs(state, ctx.seat),
        (ref) => switchRecording(op, (into) => gust(state, ref, ctx, into), events, record),
        "Choose your new Active Pokémon.",
        otherSeat(ctx.seat),
      );
    case "returnBenched":
      // 🆕 D299 — the third `parkOrForce` on a BENCH in this switch, and the
      // first whose candidate board is chosen by a printed possessive rather
      // than fixed by the op. `unshieldedRefs` wraps the OPPONENT arm only, on
      // `gust`'s precedent two cases up: shuffling someone's Pokémon away is an
      // effect done to that body, and doing it to your OWN board asks nobody.
      return parkOrForce(
        state,
        op.whose === "opponent"
          ? unshieldedRefs(state, oppBenchRefs(state, ctx.seat), ctx, events)
          : ownBenchRefs(state, ctx.seat),
        (ref) => returnBenched(state, ref, op, ctx, events),
        returnBenchedNote(op),
      );
    case "returnSelf":
      // 🆕 D311 — the same unmaking with NO pick in it: the printed subject is
      // "this Pokémon", so the ref comes from `sourceRef` and there is nothing to
      // park on. It is the FIRST op in this file that can leave the Active Spot
      // EMPTY without a Knock Out — the promotion that owes is queued by
      // `resolveMidTurnKnockOuts` (flow.ts) once the whole program settles, not
      // here, because an interpreter op returns a `GameState` and cannot reach
      // `pending`.
      return { done: returnSelf(state, op, ctx, events) };
    case "knockOutSelf":
      // 🆕 D345 — the printed *"If you use this Ability, this Pokémon is Knocked
      // Out."* It is the SECOND op in this file that can empty the Active Spot
      // (returnSelf above is the first) and the only one that does it by KILLING
      // the host, so it rides the SAME seam for the same reason: an interpreter op
      // returns a `GameState` and cannot reach `pending`, and
      // `resolveMidTurnKnockOuts` (flow.ts) already sweeps every settled program.
      // The Prize, the whole-stack discard, `KNOCKED_OUT` and the §8.1 promotion
      // are therefore §8.1's own and not this op's — no new stage, no new event.
      return { done: knockOutSelf(state, ctx) };
    case "knockOutDefender":
      // 🆕🆕 D414 — the same seam one seat over. It rides `knockOutSelf`'s
      // reasoning verbatim (mark lethal, let §8.1's sweep do the Prize, the
      // discard, the event and the promotion) and adds the one thing that is NOT
      // a mirror: the lethality is stamped as NOT DAMAGE, because two shipped
      // mechanisms read "lethal on the defender's board during an attack" as
      // "damaged by that attack" and this op is the first thing that can make
      // that false. See `koByEffectMarker` (flow.ts).
      return { done: knockOutDefender(state, ctx, events) };
    case "knockOutChosen":
      // 🆕🆕 D416 — THE SAME KNOCK OUT WITH A PICK IN IT, and the whole arm is
      // three shipped pieces with nothing between them:
      //   • `knockOutChosenTargets` — the ONE funnel, so the offer cannot come to
      //     mean something the card does not say (`gustTargets`' rule, D331);
      //   • `unshieldedRefs` — §11 as a FILTER rather than a guard (D259), because
      //     a shielded body must not be OFFERED. It stays OUTSIDE the funnel on
      //     purpose: it announces its refusals and needs `ctx`/`events`, which the
      //     playability question the funnel is shared with has neither of;
      //   • `parkOrForce` — the M1 doctrine for free: an empty opponent Bench is a
      //     SILENT no-op (the coin still flipped and its row was still emitted, one
      //     level up), a lone candidate is FORCED with no prompt, and two or more
      //     park on the existing `choosePokemon`.
      //
      // 🛑 NO `decider`. Only two ops in this switch file one and both print the
      // chooser explicitly ("(Your opponent chooses …)"); neither of these two
      // sentences does, so the pick is the ATTACKER's — which is also the only
      // reading under which "Knock Out 1 of your opponent's Pokémon" is a decision
      // its controller gets to make.
      //
      // The Prize, the whole-stack discard, `KNOCKED_OUT` and the §8.1 promotion
      // are §8.1's own, exactly as for the two ops above — and `flow.ts` needed
      // NOTHING for the benched case, because `lethalRefs`, `koRecoilOf` and
      // `byAttackFor` all already scan the Active AND the Bench.
      return parkOrForce(
        state,
        unshieldedRefs(state, knockOutChosenTargets(state, ctx.seat, op), ctx, events),
        (ref) => doomBodyAt(state, ref, koByEffectMarker(state.turn)),
        knockOutChosenNote(op),
      );
    case "takePrize":
      // 🆕🆕 D431 — §8.1's Prize, reached WITHOUT a Knock Out: the first producer
      // of a `takePrizes` stage in this engine that is not `knockOut`. The op queues
      // the decision and does nothing else — `advance` (flow.ts) owns the clamp, the
      // forced auto-resolve and the §14 win check. See `queueTakePrize` below for the
      // seat, the queue POSITION and the closed-world audit that position rests on.
      return { done: queueTakePrize(state, ctx) };
    case "discardStadium":
      // 🆕🆕 D380 — the printed *"Discard a Stadium in play."* It is the THIRD op in
      // this file that can change a body's MAXIMUM without touching its damage (a
      // vacated `hpDelta` Stadium), and it rides the SAME §8.1 seam the two above it
      // ride: an interpreter op returns a `GameState`, so the Knock Out a lowered
      // maximum owes is `finishAttack`'s `collectKnockOuts` / `settleProgram`'s
      // `resolveMidTurnKnockOuts`, never this line. No sweep here, no new event, no
      // new stage — `playStadium` already owns the identical transition (cardplay.ts).
      return { done: discardStadium(state, events) };
    // 🆕🆕 D433 — no `op.` read at all, which is the shape of a field-free op. It is
    // the FOURTH op in this file that can change a body's MAXIMUM without touching its
    // damage, and the FIRST that does so by shortening the evolution stack: the §8.1
    // Knock Out it owes is `finishAttack`'s `collectKnockOuts` / `settleProgram`'s
    // `resolveMidTurnKnockOuts`, never this line. What it DOES owe here is the CAUSE —
    // see `devolveEach` for D414's `koByEffect` stamp and the `wasLethal` conjunct.
    case "devolveEach":
      return { done: devolveEach(state, ctx, events) };
    case "healChosen": {
      // `zone: "bench"` is the printed word "Benched" and nothing else (D135):
      // it drops the Active from the candidate set and changes NOTHING else —
      // same park, same choice shape, same heal, same HEALED event. The zone is
      // applied to BOTH arms from one place on purpose: a field that silently
      // meant nothing on the `upTo` arm would be a trap for the first author who
      // combines them (no printing does today), and the heading has to agree
      // with the candidates or the prompt lies about what it is offering.
      // 🆕 D349 — THE CANDIDATE SET NOW COMES FROM `healChosenTargets`, WHICH IS
      // THE SET `programPlayable` ASKS ABOUT TOO. That is `gustTargets`' rule
      // (D331) and `snipeTargets`' (D345) on a third op, and this is the first
      // op in the family whose gate did not exist before its first rider: an
      // unnarrowed `healChosen` cannot have an empty candidate set at any legal
      // board, so nothing had to agree with anything until now.
      const candidates = healChosenTargets(state, ctx.seat, op);
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
        healTargetNoun(op),
      );
    }
    case "attachEnergyFrom": {
      // Same-type Basic Energy is fungible, so the ONLY decision is the target;
      // a source with no matching Energy is a no-op (nothing to attach). The
      // candidates are the eligible targets (targetType + notIfKO riders).
      if (
        firstAttachableEnergy(
          state,
          ctx.seat,
          op.source,
          op.energyType,
          op.anyEnergy,
          op.energyName, // D353 — the park guard asks the apply's question
        ) === undefined
      ) {
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
      // D221 — the printed "to THIS Pokémon" (Teal Mask Ogerpon ex "Teal Dance")
      // is a UID question, so it reads `sourceRef` rather than the class riders,
      // and it is the SAME reader `attachFromDeck.toSelf` uses (Pawmot
      // "Electrogenesis"): one spelling of "this Pokémon" for both attach routes.
      // At most one ref comes back. 🆕🆕 **D359 CORRECTED THE SENTENCE THAT USED
      // TO FOLLOW THIS ONE**: it read *"so this park never parks under `toSelf`
      // — the caption below is unreachable there"*, which was true only while
      // every park here was mandatory. A `toSelf` row that prints *"up to 2"*
      // has TWO answers over its one body, so it parks, and the caption is
      // reachable and worded.
      //
      // ⚠️⚠️ D248 — THE PRINTED "**each of**" IS HANDLED BEFORE THE PARK AND NOT
      // INSIDE IT, BECAUSE IT IS THE ABSENCE OF A QUESTION. Mudsdale
      // `sv05-092`/`sv05-175` "Mud Stock" spreads one Energy over EVERY Benched
      // body and asks nothing, so there is no caption to write and no answer to
      // validate — which is exactly why it costs no prompt, no wire-schema field
      // and no HUD line. It is a FOLD rather than a flag on `parkOrForce`:
      //
      //   • The refs are resolved ONCE, against the state as it stands when the
      //     op runs. "Each of your Benched Pokémon" is evaluated at effect time;
      //     re-deriving per iteration would be the same answer today (attaching
      //     Energy neither adds nor removes bodies) and would silently become a
      //     different card if a future rider ever read a body's energy.
      //   • The APPLY is re-entered per ref against the EVOLVING state, which is
      //     what makes each body get a DIFFERENT card: `attachEnergyFrom` resolves
      //     its Energy through `attachableEnergies(state, …)` at apply time, so
      //     the card the previous iteration moved is already gone from the pile.
      //     Nothing here tracks uids, and that is load-bearing rather than terse.
      //   • A pile that runs dry mid-spread stops attaching and the remaining
      //     bodies get nothing — the printed "do as much as you can", which is
      //     also what the whiff guard above already means one step earlier.
      //
      // Bench INDICES are stable across the fold (an attach reorders nothing), so
      // the refs captured up front still name the bodies they were resolved from.
      // ⚠️ AND IT READS THE CLASS RIDERS ALONE, WITH NO `toSelf` BRANCH — an
      // unreachable branch is removed, not worded (D205's `count <= 1` rule).
      // "This Pokémon" is ONE named body and "each of" is a SET; the destination
      // map spells them as disjoint rows, so no op can carry both, and a
      // `toSelf` arm here would be a comparison no authored row can reach.
      if (op.toEach === true) {
        return {
          done: attachEnergyTargets(state, ctx.seat, op).reduce(
            (soFar, ref) => attachEnergyFrom(soFar, op, ref, ctx, events, record),
            state,
          ),
        };
      }
      // 🆕🆕 D359 — THE PRINTED CEILING REACHES THE PARK. `count` is already the
      // printed *"up to N"* and nothing else: `attachFromZoneClause` (effects.ts)
      // admits a count above 1 through its literal `up to (\d+)` alternative
      // ALONE, so every `count > 1` op in this build — six sentences, 13 legal
      // printings — is a sentence that printed the word. D358's `declinable` is
      // the same right at width one, so the two fold into ONE argument here and
      // the prompt carries ONE key. They never co-occur on an op
      // (`attachDecline.test.ts` §1), so the `??` refereeing nothing is a
      // statement about the catalog rather than a precedence rule.
      const upTo = op.count ?? (op.declinable === true ? 1 : undefined);
      return parkOrForce(
        state,
        op.toSelf === true ? sourceRef(state, ctx) : attachEnergyTargets(state, ctx.seat, op),
        (ref) => attachEnergyFrom(state, op, ref, ctx, events, record),
        // ⚠️ BRANCHES ON THE FIELD'S PRESENCE, NOT ON ITS VALUE, and that is a
        // mutation result rather than a preference. Written as `count <= 1 ? …`
        // it carries a comparison NO AUTHORED ROW CAN REACH — `count: 1` is
        // never spelled, because D104's minimal-shape rule omits a field that
        // means what its absence means — so `<= 1` versus `< 1` is a live
        // difference no test can see and no card can produce. Removing the
        // comparison removes the unkillable mutant with it: the absent field is
        // the singular caption, and any count a card DOES spell is quoted.
        // 🆕 D359 — AND THE DESTINATION HALF IS NOW WORDED FOR `toSelf`, WHICH
        // D205 REMOVED AS UNREACHABLE AND THIS SLICE MADE REACHABLE. A ceiling
        // parks at one candidate, and *"attach up to 2 … to **this Pokémon**"*
        // offers exactly one — so the caption that "deliberately carries no
        // wording for it" is now the caption seven legal printings read.
        // `attachTargetNoun` is NOT consulted there: a `toSelf` row carries no
        // class rider (the field is authored alone), so the noun it would return
        // is the un-narrowed "Pokémon" and the sentence would say "which of your
        // Pokémon?" over a list of one.
        `Attach ${op.count === undefined ? "the Energy" : `up to ${op.count} Energy`} to ${
          op.toSelf === true ? "this Pokémon" : `which of your ${attachTargetNoun(op)}`
        }?`,
        // 🆕 D358 — no `decider`: the printed *"up to N"* moves WHETHER and now
        // HOW MANY, never WHO, so the fifth argument stays absent exactly as it
        // was and the sixth is spelled positionally rather than folded into it.
        // The ceiling rides the OP because only the print knows. Deriving it here
        // — from the program's op count, from anything the interpreter can see —
        // would make Eelektrik's *"attach a Basic {L} Energy card … to 1 of your
        // Benched Pokémon"* declinable too, and that sentence prints neither
        // *"up to"* nor a hidden zone to fail a search in (§9.1's one other
        // decline, which rides the ZONE and not the number).
        //
        // 🛑🛑 **D359 RE-DERIVED D358's POPULATION AND IT WAS SHORT BY FIVE, FOR
        // A STRUCTURAL REASON: D358 WALKED THE REGISTRY, AND THE REGISTRY IS NOT
        // THE BUILD.** `deriveAttackEffect` is this op's second producer, and it
        // emits `count: 2` for three more Standard-legal sentences no registry
        // walk can see — Oricorio "Energy Assist" `sv08-026`/`sv08-089`, Regirock
        // ex "Regi Charge" `sv10-101`/`sv10-214` and Kilowattrel ex "Return
        // Charge" `sv08-068`. With the registry's three (Ethan's Ho-Oh ex ×4,
        // Bloodmoon Ursaluna ×2, Lycanroc ×2) the quantity-axis population is
        // **6 sentences / 13 legal printings**, all printed {0, 1, 2}.
        // ⚠️ **AND THE TWO HALVES WERE BROKEN DIFFERENTLY.** The eight ABILITY
        // printings reach {0, 2} because an activated or triggered *"you may"*
        // buys the empty answer. The five ATTACK printings reach **{2} alone**:
        // an attack is declared and resolves, so there is no optional anywhere in
        // the program and even the zero was unreachable. A decline axis could
        // never have fixed either half; only the quantity axis reaches both.
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
    case "stadiumInPlay":
      // 🆕 D378 — "a Stadium is in play" (Probopass sv10-098 "Mountain Drop", +70)
      // and, through `ATTACK_REQUIREMENT_CLAUSES`, the printed NEGATION on Fan Rotom
      // sv07-118/sv08.5-085 "Assault Landing".
      //
      // 🛑 THE ARM IS THE ARM ABOVE WITH THE OWNER TEST DELETED, AND THAT IS THE
      // WHOLE DIFFERENCE. `seat` is unread here — deliberately: §7.3's zone is
      // shared and a single slot, so the two seats can never disagree about
      // PRESENCE, only about OWNERSHIP. Every other member in this switch is
      // seat-relative; this one is the first that is not, which is exactly why it
      // could not have been the other member wearing a wider name.
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
    case "opponentActiveIsStage1": {
      // 🆕 D387 — Paldean Tauros sv08-018 "Spirited Tackle"'s restricting adjective
      // ("your opponent's Active Pokémon is a Stage 1 Pokémon"). `isStage1Pokemon`
      // (cards.ts, D387) is reused rather than re-spelled as `card.stage ===
      // "Stage1"`, which is the arm below's rule applied to a third printed word:
      // one reading of "Stage 1", one implementation.
      //
      // 🛑 IT IS **NOT** `evolveFromOf(...) !== null` NARROWED BY A RIDER, and the
      // arm three above is the one it must not be confused with: that reading is
      // satisfied by a Stage 2, a VSTAR and a VMAX as well, so writing it here
      // would score Paldean Tauros's +90 against every evolved defender in the
      // game. The printed word is the datum.
      //
      // Read off the TOP card (§1.2) — a Basic that has EVOLVED is a Stage 1 now,
      // which is what makes the §10 evolve a real line of play here rather than a
      // rule written for symmetry — and FALSE with an empty Active Spot, exactly as
      // the three arms around it.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isStage1Pokemon(spot.card);
    }
    case "opponentActiveIsStage2": {
      // 🆕 D296 — Paldean Tauros sv08-039's restricting adjective ("your
      // opponent's Active Stage 2 Pokémon"). `isStage2Pokemon` (cards.ts, D262)
      // is reused VERBATIM rather than re-spelled as `card.stage === "Stage2"`,
      // which is the arm above's rule applied to a second printed word: one
      // reading of "Stage 2", one implementation, so this and Neo Upper Energy
      // can never drift. Read off the TOP card (§1.2) and FALSE with an empty
      // Active Spot, exactly as the two arms above.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isStage2Pokemon(spot.card);
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
    case "yourActiveUndamaged": {
      // 🆕 D368 — "this Pokémon has no damage counters on it" (Arven's Mabosstiff
      // ex). The COMPLEMENT of the arm directly above, and deliberately NOT written
      // as `!conditionHolds(state, seat, { kind: "yourActiveDamaged" })`: that
      // spelling would make an EMPTY Active Spot satisfy this member, because the
      // arm above is false there and its negation is true. An empty spot is not an
      // undamaged Pokémon — there is no Pokémon — so the null guard is POSITIVE on
      // both arms and the two are complements only where an Active exists.
      //
      // ⚠️ Read at DECLARATION, exactly as its complement is: `state` is the board
      // as of declaration and the attacker IS this Active, so the counters read are
      // the ones it walked in with, not any it takes later in the same attack.
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
      // 🆕 D373 — "all of your Benched Pokémon have at least 1 damage counter on
      // them" (Drampa sv05-138/-184, +120). The `.every` twin of the arm directly
      // above, over the same array on the same seat.
      //
      // 🛑 THE `length > 0` IS THE WHOLE SLICE, AND IT IS A CHOICE. `.every` alone
      // answers TRUE on an empty Bench — classical vacuous truth — and this member
      // answers FALSE, because the printed "all of your Benched Pokémon" presupposes
      // that you have some (JP: 「ベンチポケモン全員に」). No rule, glossary entry,
      // Compendium ruling or official Q&A settles it — all four were checked and all
      // four are silent — so the tie-break is that a wrong TRUE silently PAYS +120 on
      // a board that occurs every game while a wrong FALSE only withholds it. The
      // argument, its falsifier and the measurement that dissolved D369's supposed
      // precedent are in this member's doc block in effects.ts.
      //
      // ⚠️ NOT SPELLED AS `!bench.some((p) => p === null || p.damage === 0)`: that is
      // the same predicate with the guard silently the OTHER way round, and it is the
      // mistake this arm's mutant makes.
      const bench = state.players[seat].bench;
      return bench.length > 0 && bench.every((p) => p !== null && p.damage > 0);
    }
    case "yourBenchNamedDamaged":
      // 🆕🆕 D397 — the EXISTENTIAL two arms up with ONE MORE TEST ON THE SAME
      // BODY, which is the whole member: `.some` over the Bench asking for a damaged
      // Pokémon that is ALSO named `cond.name`. Composing the two shipped members
      // with `allOf` asks the two questions of DIFFERENT bodies and answers TRUE on a
      // Bench holding an undamaged Cubone beside a damaged Rattata; this arm cannot,
      // because there is one `p`.
      //
      // 🛑 THE NAME IS READ THROUGH `topCardOf` — the stack TOP is the Pokémon's
      // identity (§1.2), `yourBenchHasNamed`'s rule verbatim — and here that reading
      // is BEHAVIOUR rather than housekeeping: damage survives an evolution and the
      // name does not, so a damaged benched Cubone that evolves into Marowak keeps
      // every counter and stops satisfying this clause. `?.name` is undefined for a
      // uid the catalog cannot resolve, which fails the equality and pays nothing —
      // `yourBenchHasNamed`'s unresolvable-uid path, unchanged.
      //
      // Bench only (the printed word is "Benched"), own seat only ("your"), and an
      // EMPTY Bench is false for the existential arm's reason: `∃` over the empty set
      // is forced, not chosen. The damage test is written FIRST because it is a field
      // read and the name test is a catalog lookup.
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
    case "yourActivePoisoned": {
      // "this Pokémon is Poisoned" as printed on Okidogi ex — resolved to YOUR
      // ACTIVE by the clause table, not here (D116's rule, D117's second use).
      // Same `> 0` read as the cross-board twin above: Poison is the counter
      // AMOUNT, and the attacker walks into its own attack already carrying it
      // (the Checkup that Poisons it ran on an earlier turn).
      const active = state.players[seat].active;
      return active !== null && active.conditions.poisonDamage > 0;
    }
    case "opponentActiveBurned": {
      // 🆕 D377 — "your opponent's Active Pokémon is Burned" (Slugma sv05-028
      // "Roasting Heat", +40) and, through `ATTACK_REQUIREMENT_CLAUSES`, the printed
      // NEGATION on Centiskorch sv05-037 "Charring Breath".
      //
      // 🛑 `presentStatuses`, NOT `conditions.burned`, AND THE REASON IS THE MEMBER
      // TWO ARMS UP. `opponentActiveHasSpecialCondition` is
      // `presentStatuses(...).length > 0` over the SAME projection; spelling this one
      // off the raw field would give the §12 vocabulary two readers free to drift
      // apart, which is D222's defect exactly. Asking the projection makes
      // "Burned ⟹ affected by a Special Condition" true BY CONSTRUCTION rather than
      // by agreement, and `crossBoardStatus.test.ts` §5 sweeps that implication over
      // every board in the file.
      //
      // The projection is also what makes the three model shapes stop mattering:
      // Poison is a counter, Burn a boolean and Confusion an enum value, and
      // `presentStatuses` is the one place all three become `StatusName`.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && presentStatuses(active.conditions).includes("burned");
    }
    case "opponentActiveConfused": {
      // 🆕 D377 — "your opponent's Active Pokémon is Confused" (Tapu Lele sv08-092
      // "Mental Crush", +90). Same projection as the arm directly above, for the
      // same reason.
      //
      // 🛑 NOT `isImmobilized`, WHICH IS THE MISTAKE WITH THIS ARM'S NAME ON IT.
      // That helper is `rotation === "asleep" || rotation === "paralyzed"` and
      // deliberately EXCLUDES Confused (§12 lets a Confused Pokémon attack and
      // retreat), so a reader that reached for the nearest rotation predicate would
      // be false on every board this clause is about. Nor `rotation !== "none"`,
      // which is `opponentActiveHasSpecialCondition` minus its two flags and would
      // fire on an Asleep defender.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && presentStatuses(active.conditions).includes("confused");
    }
    case "opponentActiveIsExOrV": {
      // D107's `isExOrV` verbatim — ex or V, NOT VMAX/VSTAR/GX, which is exactly
      // what the sentence names. An empty Active Spot is FALSE, as with the
      // Evolution sibling.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && isExOrV(spot.card);
    }
    case "opponentActiveIsEx": {
      // 🆕 D362 — the NARROWER half of the pair directly above, and the ONE board
      // on which the two disagree is a Pokémon V: this member is false there and
      // `opponentActiveIsExOrV` is true. Read through `pokemonSuffixOf` — the same
      // function `isExOrV` is built out of — so the two can never drift, and a
      // VMAX/VSTAR/GX is false here exactly as it is one arm up ("Fixmon VMAX" is
      // read as VMAX, never as a space-then-V). An empty Active Spot is FALSE, as
      // with every sibling in this family.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && pokemonSuffixOf(spot.card) === "ex";
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
    case "opponentActiveHasEnergyAttached": {
      // 🆕🆕 D415 — the seat mirror of the arm directly above, and the ONE line that
      // differs is the seat. ⚠️ D116's pronoun rule does NOT fire here: the printed
      // sentence names "your opponent's Active Pokémon" in words, so there is no
      // pronoun for a clause table to resolve and the member is named for exactly
      // what it reads. The predicate is `continuous.ts`'s, so a type reads by
      // PROVISION and cannot drift from the §8.2 cost check — the twin's reason,
      // inherited rather than re-derived. False with an empty Active Spot.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && hasAttachedEnergy(state, active, cond.energy);
    }
    case "yourActiveHasNamedEnergyAttached": {
      // 🆕 D374 — "this Pokémon has any Team Rocket's Energy attached" (Team Rocket's
      // Zapdos sv10-070, +60). D116's pronoun rule again: the clause table resolved
      // the printed "this Pokémon" to your Active, not this arm.
      //
      // 🛑 THE ZONE IS THE CATEGORY TEST. `pokemon.energy` holds attached ENERGY uids
      // and `pokemon.tools` holds the Tools, so a name equality scanned over this
      // array cannot reach a Trainer the way `matchesFilter`'s `ownerPokemon` arm can
      // — which is why THAT one needs an explicit `category === "Pokemon"` conjunct
      // and this one does not.
      //
      // 🛑 BY PRINTED NAME AND NOT BY PROVISION, which is the whole difference from
      // the arm two cases up. `hasAttachedEnergy` lives in continuous.ts precisely so
      // a type reading cannot drift from what pays a cost; a NAME has no such twin —
      // it does not move when a second Special demotes a wildcard — so this reads the
      // card directly, here, beside `yourBenchHasNamed` and `yourNamedPokemonInPlay`,
      // which resolve a printed name the same way one screen up.
      //
      // ⚠️ THE CARD SIDE IS FOLDED (D154, and `attackIndexByName` 1,500 lines down in
      // this same file does it for the same reason). The member's `name` is stored
      // ASCII because that is what the catalog prints; a re-ingest that normalised
      // punctuation would curl `Card.name` and the printed sentence TOGETHER, and
      // `literalClauseRow` already folds the clause key on a miss. Folding one side
      // and not the other is the half-fix D137 warned about.
      //
      // `cardOfUid` returns undefined for a uid the catalog cannot resolve, and that
      // is FALSE rather than a throw — matchesFilter's conservative direction, and
      // here it means an unreadable attachment never PAYS the bonus.
      const active = state.players[seat].active;
      if (active === null) return false;
      return active.energy.some((uid) => {
        const card = cardOfUid(state, uid);
        return card !== undefined && foldApostrophes(card.name) === cond.name;
      });
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
      // The vocabulary's FIRST SEAT-SYMMETRIC member: equality commutes, so this
      // reads the same for p1 and p2 on any board. Sizes only, as above.
      // 🆕 D372 — and no longer its ONLY one; the arm below is the second, and its
      // own doc block in effects.ts records what that correction cost.
      return state.players[seat].hand.length === state.players[otherSeat(seat)].hand.length;
    case "yourHandExactly":
      // 🆕 D379 — "you don't have exactly 3 cards in your hand" read POSITIVE:
      // Alolan Dugtrio sv08-123/sv08-208 "Trio-Cheehoo". The seat is the ATTACKER's
      // own, which is the half `opponentHandAtMost` gets wrong; the comparator is
      // strict EQUALITY, which is the other half. `>=` and `<=` are each green on a
      // 3-card hand and wrong one card away — `exactHandSize.test.ts` drives 2, 3
      // and 4 rather than describing them. Sizes only, contents never.
      return state.players[seat].hand.length === cond.count;
    case "yourHandNotEmpty":
      // 🆕🆕 D385 — the payability of Veluza ex `sv09-043` "Purging Strike"'s printed
      // cost ("You may discard your hand"), resolved to the ATTACKER's own hand by
      // the reader's cost table exactly as the arm below resolves "this Pokémon"
      // (D116's rule, reached from a cost anchor rather than a clause table).
      //
      // 🛑 `> 0` AND NOT `>= 0`, WHICH IS THE ONLY MISTAKE THIS ONE LINE CAN MAKE —
      // and unlike every body-reading sibling's empty-Active board, the board that
      // catches it is ORDINARY: a player who has played their hand out and then
      // attacks. `>= 0` is TRUE on every hand there is, which would put the confirm
      // in front of a player with nothing to discard and pay the printed +120 for
      // discarding it. Sizes only, contents never — the union's public-state
      // invariant, unchanged.
      //
      // ⚠️ AND IT IS THE COST'S EXACT PAYABILITY, WHICH IS WHAT LICENSES THE SECOND
      // CONNECTIVE. `discardHand` (below, §9) returns the state untouched when the
      // hand is empty and moves every card when it is not, so this predicate and
      // "you discarded any cards in this way" have the same extension on every board.
      return state.players[seat].hand.length > 0;
    case "yourDeckAtMost":
      // 🆕🆕 D398 — the SIZE of your own deck, never its contents and never its
      // ORDER, which is the line the union's public-state invariant draws and the
      // line D398 had to correct before this member could be built: that block named
      // *"a deck"* flat where it names *"a hand's CONTENTS"*, and a cardinality is
      // not a content. `redact.ts` ships `deckCount: side.deck.length` for BOTH
      // sides, so this survives P4 redaction exactly as the four hand-size arms above
      // it do.
      //
      // 🛑 THE NEAREST WRONG ANSWER IS `opponentHandAtMost` FOUR ARMS UP AND IT IS
      // WRONG TWICE — `players[otherSeat(seat)]` for `players[seat]` and `.hand` for
      // `.deck` — while the comparator and the printed threshold are IDENTICAL (both
      // clauses say "3 or fewer"). One board separates them: a short deck beside a
      // full opponent hand. D379 refused the same widening one zone over for the same
      // two reasons.
      //
      // `<=`, so an EMPTY deck is TRUE. That is not an edge board: §14.3's deck-out
      // loss is checked at the DRAW step (flow.ts) and nowhere else, so a player who
      // has milled themselves to zero attacks legally this turn and loses at the
      // start of the next. 2 / 3 / 4 are driven rather than described — `<` is green
      // at 2 and wrong at 3, `===` is green at 3 and wrong at 2.
      return state.players[seat].deck.length <= cond.count;
    case "yourActiveEnergyAtLeast": {
      // 🆕🆕 D383 — the payability of Wellspring Mask Ogerpon ex's printed cost
      // ("You may shuffle 3 Energy attached to this Pokémon into your deck"),
      // resolved to YOUR Active by §8 rather than here: the reader's cost table is
      // what knows the sentence came off an attack (D116's rule, reached from a cost
      // anchor instead of a clause table).
      //
      // 🛑 THE SAME CALL THE ARM BELOW MAKES, AND THAT IS THE WHOLE OF "CARDS, NOT
      // UNITS". `countAttachedEnergy(state, pokemon, null)` is the UNFILTERED card
      // count, so a multi-unit Special counts ONE here exactly as it does there —
      // which is also what makes this gate bite: an attacker paying {W}{C}{C} with
      // two cards can declare the attack and still not hold three Energy.
      //
      // FALSE with an empty Active Spot, like every body-reading sibling: an absent
      // Pokémon is not a Pokémon holding zero.
      //
      // 🆕🆕 D391 — `cond.energy ?? null`, AND THE `?? null` IS THE WHOLE WIDENING.
      // Abomasnow `sv10-060` "Frozen Wood" prints the SAME threshold with a TYPE on
      // it ("2 or more {G} Energy attached"), and `countAttachedEnergy` has taken
      // that filter as its third parameter since D128 — so the typed reading is this
      // arm with the argument it was already passing made optional. ABSENT MEANS
      // UNNARROWED (D326): every shipped `{ kind, count }` object still reaches
      // `null` and still answers the unfiltered card count.
      //
      // 🛑 AND THE FILTER IS NOT DECORATION ON THE ONE PRINTING. Frozen Wood costs
      // {W}{W}{W}{C} while the clause counts {G}, so any board that can legally
      // declare it holds four Energy cards with single-unit attachments — the
      // UNFILTERED reading at 2 is TRUE on every one of them. Dropping the filter
      // makes the printed bonus unconditional rather than merely wrong somewhere.
      const own = state.players[seat].active;
      return own !== null && countAttachedEnergy(state, own, cond.energy ?? null) >= cond.count;
    }
    case "activeEnergyCountsEqual": {
      // 🆕 D372 — "this Pokémon and your opponent's Active Pokémon have the same
      // amount of Energy attached". D116's pronoun rule again: the printed "this
      // Pokémon" was resolved to YOUR Active by the clause table, not here.
      //
      // 🛑 CARDS AND NOT UNITS, AND THAT IS `countAttachedEnergy`'s DECISION RATHER
      // THAN THIS ARM'S. `energy: null` is its UNFILTERED reading — every attached
      // card, whatever it provides — so a multi-unit Special counts ONE here, the
      // same answer `countEnergyInPlay` gives the board-scoped noun. Delegated for
      // the reason those two sit together: the reading must not drift from what
      // pays a cost.
      //
      // 🛑 AND THE ZONE IS THE BODY, NOT THE SIDE. `countEnergyInPlay(state, seat,
      // null)` is one identifier away in this file's own import block and answers a
      // DIFFERENT question — Active plus Bench — while the printed subjects are two
      // Active Pokémon. Benched Energy is invisible to this clause.
      //
      // FALSE when EITHER Active Spot is empty: an absent Pokémon is not a Pokémon
      // with zero Energy, and reading a missing side as 0 would arm the clause for
      // an attacker holding nothing at all.
      const own = state.players[seat].active;
      const theirs = state.players[otherSeat(seat)].active;
      return (
        own !== null &&
        theirs !== null &&
        countAttachedEnergy(state, own, null) === countAttachedEnergy(state, theirs, null)
      );
    }
    case "moreActiveEnergyThanOpponent": {
      // 🆕🆕 D384 — "this Pokémon has more Energy attached than your opponent's
      // Active Pokémon" (Swalot `sv07-092`, +160). The arm directly above with `===`
      // replaced by `>`, on the SAME two bodies read through the SAME call — written
      // out in full rather than delegated to it, because the two are nullary members
      // of one union and a shared helper would be the operator-union generalisation
      // both doc blocks refuse.
      //
      // 🛑 STRICTLY MORE, AND `>=` IS THE MISTAKE THE PRINTED WORD FORBIDS. "More
      // than" is not "at least"; an EQUAL board is the defender's, and it is the only
      // board that separates this member from `>=`. That equal board is also exactly
      // where `activeEnergyCountsEqual` answers TRUE, so the two members are jointly
      // exhaustive over nothing and disjoint on every board — driven from both.
      //
      // 🛑 AND THE ORDER OF THE OPERANDS IS THE OTHER HALF. `>` does not commute, so
      // reading the far body on the left inverts the answer on every unequal board
      // and is invisible on every equal one — `morePrizesThanOpponent`'s polarity
      // warning, one field over.
      //
      // FALSE when EITHER Active Spot is empty. Reading a missing DEFENDER as zero
      // is the slip that looks like defensive code, and on THIS operator it arms the
      // clause for any attacker holding a single card (1 > 0) rather than only for
      // one holding none.
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
      return spot !== null && (spot.card.types ?? []).includes(cond.type);
    }
    case "opponentActiveHasResistance": {
      // 🆕 D371 — the BODY of the arm directly above and a different COLUMN of it:
      // the printed Resistance rather than the printed type.
      //
      // 🛑 IT DOES NOT GO THROUGH `resistanceOf`, AND THAT IS THE MEMBER. §8.5's
      // lookup (`cards.ts` `weakResModifier`) skips every entry whose `type` is not
      // one of the ATTACKER's types, because it answers "does this Resistance apply
      // to THIS attack". The printed clause asks whether the defender HAS `{F}`
      // Resistance at all, and those two questions disagree on the board this
      // member is for: a Metal attacker against a Fighting-resistant body makes the
      // clause TRUE and `resistanceOf` NULL. Routing this through the §8.5 helper
      // would silently narrow the clause to "…and it applies to me".
      // `opponentResistanceBonus.test.ts` §5 drives exactly that board.
      //
      // The match is on the entry's `type` alone: `WeakRes.value` is OPTIONAL in
      // the schema and `weakResModifier` itself honours an entry whose value it
      // cannot parse (it falls back to −30), so a card with a value-less or
      // garbled Resistance still HAS one. `.some` and never `resistances[0]` — the
      // field is an array. `resistances` is null on Trainers and Energy, hence the
      // `?? []`. Empty Active Spot is FALSE, as with every other card-reading
      // member, and the read is through the stack TOP so an evolved body answers
      // with the Resistance printed on the card that is actually in play.
      const spot = activeTop(state, otherSeat(seat));
      return spot !== null && (spot.card.resistances ?? []).some((r) => r.type === cond.type);
    }
    case "opponentActiveRetreatCostAtLeast": {
      // 🆕 D388 — Talonflame sv07-123 "Aero Chase" ({C}{C}, 110+): "If the Retreat
      // Cost of your opponent's Active Pokémon is {C}{C} or more, this attack does
      // 110 more damage."
      //
      // 🛑 `effectiveRetreatCost`, NOT `retreatCostOf`, AND THAT CHOICE *IS* THE
      // MEMBER. The arm directly above reads a PRINTED column on purpose; this one
      // must not, and the two are not the same call for two different reasons.
      // The engine has answered this exact printed noun phrase since 0.61.0:
      // attack.ts's `opponentActiveRetreatCost` count source resolves "for each {C}
      // in your opponent's Active Pokémon's Retreat Cost" (the family D110 landed:
      // Heracross sv01-002, Spidops ex sv01-019, Sharpedo sv03-047, Stoutland
      // sv03-172; TWO of those sentences are legal at this head) through this
      // very fold, so spelling `retreatCostOf(spot.card)` here would make ONE
      // printed phrase mean two things in one engine (D159). And the game agrees:
      // Retreat Cost is a value effects MODIFY — increases first, then reductions,
      // with a set-to-zero overriding every increase — which is the order of
      // operations `effectiveRetreatCost` already implements and a printed constant
      // would not need.
      //
      // ⚠️ THE TWO READINGS DISAGREE ON REAL BOARDS IN BOTH DIRECTIONS, and
      // `retreatCostBonus.test.ts` §3/§4 drive them rather than asserting them: a
      // printed-{C} defender under Calamitous Wasteland sv02-175 or a benched
      // Spidops ex sv01-019 folds to {C}{C} and is TRUE here while the printed
      // column says false; a printed-{C}{C} defender under Beach Court sv01-167
      // folds to {C} and is FALSE here while the printed column says true.
      //
      // `>=` because the printed word is "or more" — a FLOOR, `yourBenchAtLeast`'s
      // reading and NOT `opponentPrizesRemaining`'s set membership; a Retreat Cost
      // has no closed domain to enumerate.
      //
      // The IN-PLAY body, not the top card: the fold's aura scans key on the body's
      // uid to find whose side it is on. FALSE with an empty Active Spot, exactly as
      // every body-reading sibling — an absent Pokémon is not a Pokémon retreating
      // for free.
      const active = state.players[otherSeat(seat)].active;
      return active !== null && effectiveRetreatCost(state, active) >= cond.count;
    }
    case "yourBenchHasType":
      // 🆕 D370 — the FIELD of the arm directly above (`Card.types`, the same read
      // Weakness and Resistance make in §8.5) over the ZONE of the arm directly
      // below (your Bench, Active Spot excluded). `.includes` and never
      // `types[0] ===`: the field is an array and dual types are a real printing.
      // `types` is null on Trainers and Energy, hence the `?? []`.
      //
      // 🛑 THE ACTIVE SPOT IS EXCLUDED AND THAT IS THE MEMBER. Both printings of
      // this sentence are on Metal attackers, so a spread of `[side.active,
      // ...side.bench]` — which is what the arm two below legitimately uses for a
      // clause printed "in play" — would let the attacker satisfy its own clause
      // and make the +80 unconditional. D279 refused that widening for a NAME;
      // this is the same refusal on a TYPE, and it is driven on a board rather
      // than argued (`benchTypeBonus.test.ts` §5).
      //
      // Read through `topCardOf` for the arm below's §1.2 reason verbatim: the
      // stack TOP is the Pokémon's identity, so evolving a benched {M} Basic into
      // a body of another type stops satisfying the clause mid-turn.
      return state.players[seat].bench.some(
        (p) => p !== null && (topCardOf(state, p)?.types ?? []).includes(cond.type),
      );
    case "opponentInPlayHasType":
      // 🆕 D390 — Electivire sv05-054 "Short-Circuit Knuckle" ({C}{C}, 40+): "If
      // your opponent has any {W} Pokémon in play, this attack does 120 more
      // damage." The FIELD of the two arms above (`Card.types`, §8.5's read) over
      // the ZONE of the arm below (a whole side) on the OPPONENT'S seat.
      //
      // 🛑 THE SPREAD IS THE MEMBER, AND IT IS WRONG IN TWO OPPOSITE DIRECTIONS.
      // Narrowing to `activeTop(state, otherSeat(seat))` is D279's refutation on a
      // type: the printed words are "in play", so a {W} body on the opponent's
      // BENCH satisfies the clause and an Active-only reading silently UNDER-pays
      // on exactly the boards this card is for. Widening to BOTH seats — the arm
      // below's spread run twice — is the opposite defect and the worse one, since
      // it would let the ATTACKER'S OWN side arm the clause. `inPlayTypeBonus.test.ts`
      // §5 drives both readings red on one board rather than arguing them.
      //
      // `otherSeat(seat)` and never a hard-coded "p2": `conditionHolds` is
      // seat-RELATIVE, and a body copied down from a same-seat sibling is green on
      // every board where the two sides happen to match.
      //
      // `.includes` and never `types[0] ===` — the field is an array and dual types
      // are a real printing. `types` is null on Trainers and Energy, hence the
      // `?? []`. Read through `topCardOf` for the arm below's §1.2 reason verbatim:
      // the stack TOP is the Pokémon's identity, so evolving the opponent's {W}
      // Basic into another type DISARMS the clause mid-turn. An opponent with
      // nothing in play is FALSE, and that is forced by the printed "any" rather
      // than chosen (D369).
      return [
        state.players[otherSeat(seat)].active,
        ...state.players[otherSeat(seat)].bench,
      ].some((p) => p !== null && (topCardOf(state, p)?.types ?? []).includes(cond.type));
    case "inPlayTypesIntersect": {
      // 🆕 D375 — "any of your Pokémon in play are the same type as any of your
      // opponent's Pokémon in play" (Enamorus sv06-093 "Love Resonance", +120). The
      // union's THIRD seat-symmetric member and its FIRST predicate over two
      // variable-size sets: `∃x∈yours. ∃y∈theirs. types(x) ∩ types(y) ≠ ∅`.
      //
      // 🛑 THE ZONE IS "in play" ON BOTH SIDES, AND THAT IS TWO CLAIMS. The printed
      // words name each side's whole board, so this is `yourNamedPokemonInPlay`'s
      // `[side.active, ...side.bench]` spread run TWICE — once per seat. Narrowing
      // either half to the Active Spot is D279's refutation with a TYPE, and it is
      // the dangerous kind of wrong: the real printing is a PSYCHIC body, so an
      // Active-only reading still pays on most boards and only silently under-pays
      // on the ones where the shared type sits on a Bench. Both narrowings are
      // driven red in `typeShareBonus.test.ts` §4.
      //
      // 🛑 AND IT IS AN INTERSECTION, NEVER AN ARRAY COMPARISON. `Card.types` is an
      // ARRAY; "the same type" is satisfied by ANY shared member. Flattening both
      // sides and asking whether they MEET is the reading; comparing `types` arrays
      // — or comparing `types[0]` — agrees with it on every single-type board, which
      // is every board the catalog can build (no Standard-legal Pokémon is
      // dual-typed, measured at D238). `fix-dualbody` is the fixture that separates
      // them, and §5 drives both wrong readings red.
      //
      // AN EMPTY SIDE IS FALSE and that is FORCED, not chosen — a positive
      // existential over the empty set, §15b of ptcg-rules.md. `.some` over an empty
      // array gives it for free, which is exactly why the boundary needs a rung
      // rather than a comment. `types` is null on Trainers and Energy, hence `?? []`.
      //
      // Read through `topCardOf` for `yourBenchHasType`'s §1.2 reason verbatim: the
      // stack TOP is the Pokémon's identity, so evolving a body ARMS or DISARMS this
      // clause mid-turn.
      const typesInPlay = (s: Seat): string[] => {
        const side = state.players[s];
        return [side.active, ...side.bench].flatMap((p) =>
          p === null ? [] : (topCardOf(state, p)?.types ?? []),
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
      // 🆕 D392 — the arm directly above with ONE OPERATOR changed and everything
      // else held exactly still: the same seat, the same Bench-only zone, the same
      // `topCardOf` read of the stack TOP (§1.2), the same `!== null` slot guard.
      // `.includes` is case-sensitive and does no normalisation, which is
      // `yourBenchHasNamed`'s own rule — the catalog `name` IS the printed name.
      //
      // 🛑 AND IT IS DELIBERATELY NOT `startsWith`. Team Rocket's Nidoqueen
      // `sv10-116`'s clause names "Nidoking", and the Standard body that satisfies it
      // is Team Rocket's Nidoking ex — the fragment sits at a NON-ZERO offset behind
      // an owner possessive, so a prefix reading fails on the exact board the card is
      // printed for, and so does the equality reading one arm up. Both are refuted on
      // a board in `benchNameSubstring.test.ts` §3.
      //
      // The `?? false` is the empty-name/unresolvable-card path: `topCardOf` returns
      // undefined for a uid the catalog cannot resolve, and an unreadable card must
      // never pay a bonus.
      return state.players[seat].bench.some(
        (p) => p !== null && (topCardOf(state, p)?.name.includes(cond.fragment) ?? false),
      );
    case "yourNamedPokemonInPlay": {
      // D279 — the arm above's sentence with ONE printed word changed ("Bench" →
      // "in play"), and that one word is the whole difference: the Active Spot is
      // CONSULTED here. `[side.active, ...side.bench]` is the module's in-play
      // spread (`countOwnerPokemonInPlay`, six lines of file down) and both
      // channels are nullable, so the `!== null` guard covers an empty Spot and
      // an empty slot with one test.
      //
      // 🛑 THE TWO ARMS MUST STAY TWO. Falinks `sv02-119` reads the narrow one
      // about its OWN name while a Falinks is Active; answering it off the Active
      // Spot would make its +90 unconditional. See the union member's doc block
      // (effects.ts) — this is D131 priced and DECLINED, not D131 overlooked.
      //
      // Read through `topCardOf` for the arm above's §1.2 reason verbatim: a
      // stack's TOP is the Pokémon's identity, so a Shelmet that has evolved into
      // Accelgor stops satisfying its partner's clause — which is what the rules
      // say and what makes the licence end mid-turn.
      const side = state.players[seat];
      return [side.active, ...side.bench].some(
        (p) => p !== null && topCardOf(state, p)?.name === cond.name,
      );
    }
    case "yourEnergyInPlayAtLeast":
      // The board-wide fold of D118's per-Pokémon predicate, and it stays in
      // continuous.ts for that reason: "an Energy that can pay a {D} cost" and
      // "an Energy this clause counts" are one question, whichever board asks it.
      // Active + Bench, cards rather than units, `>=` because the printed word is
      // "at least" (a threshold, unlike the sibling above's "exactly").
      return countEnergyInPlay(state, seat, cond.energy) >= cond.count;
    case "yourBasicEnergyInDiscardAtLeast": {
      // 🆕 D376 — "you have 10 or more Basic {R} Energy cards in your discard pile"
      // (Chandelure sv10.5w-018 "Incendiary Pillar", +100). The arm directly above is
      // this one's NEAR MISS and not its template.
      //
      // 🛑 THE AMOUNT IS PRINTED CARDS, AND THE ZONE IS WHY. `countEnergyInPlay` reads
      // PROVISION, which is the right reading for an Energy in play because that is
      // what it pays with — a wildcard Luminous Energy counts as {D} while it is
      // alone. A card in a DISCARD PILE is attached to nothing and provides nothing,
      // so the printed "Basic {R} Energy card" is a card CLASS and a printed TYPE.
      // §6.5's rule for every pile-scanning consumer, stated in effects.ts twice
      // already: about the PRINT, never `providesEnergy`.
      //
      // 🛑 SO THE PREDICATE IS `matchesFilter`'s AND IS NOT RE-SPELLED HERE. The
      // `basicEnergy` arm is `energyType === "Normal"` (which excludes every Special,
      // wildcard or not) AND `energyProvidesOf(card) === filter.energyType` (which on
      // a Basic is a NAME parse and nothing else). Re-implementing it inline is D222's
      // defect in miniature — two readers of one printed noun, free to drift apart.
      //
      // `>=` because the printed words are "or more" — a FLOOR, the arm above's
      // reading of "at least". `cardOfUid` returns undefined for a uid the catalog
      // cannot resolve and `matchesFilter` answers false for it, so an unreadable card
      // in the pile never pays the bonus. An empty pile is 0.
      //
      // 🆕🆕 D440 — THE WALK MOVED OUT AND THIS ARM IS NOW A DELEGATION. The loop that
      // used to sit here is `countCardsInDiscardPile` (above), generalised in place
      // when `DamageCountSource.cardsInDiscardPile` needed the same scan over the same
      // zone with a different vocabulary. NOTHING ABOUT THIS ARM'S READING CHANGED —
      // same `CardFilter`, same `matchesFilter`, same `>=` on the printed "or more" —
      // and the filter stays a named local because two mutation rows quote that line.
      const filter: CardFilter = { kind: "basicEnergy", energyType: cond.energy };
      return countCardsInDiscardPile(state, seat, filter) >= cond.count;
    }
    case "yourBasicEnergyInHandAtLeast": {
      // 🆕🆕 D420 — the arm DIRECTLY ABOVE with ONE zone name changed, and that is the
      // whole of it: same `CardFilter`, same `matchesFilter`, same `>=`, `discard`
      // swapped for `hand`. Written as a zone mirror on purpose — the printed noun is
      // identical on both families ("Basic {X} Energy card"), so two spellings of it
      // would be D222's defect at a second address.
      //
      // 🛑 IT IS THE PRINT AND NOT THE PROVISION, for the sibling's reason at a zone
      // where the reason is even flatter: a card sitting IN HAND is attached to
      // nothing and pays for nothing, so `energyProvidesOf` has no board reading to
      // give. §6.5's standing rule for every zone-scanning consumer.
      //
      // 🛑 AND IT IS THE SAME PREDICATE `handCostCandidates` FILTERS THE PAYMENT
      // WITH, one function down this file. That is what makes the D420 cancel gate
      // and the `payFromHand` it guards agree BY CONSTRUCTION: this arm asks exactly
      // the question that op is about to answer, so a hand the gate admits is a hand
      // the payment can take `count` cards out of. A hand-rolled loop here could
      // drift from it silently, and the direction it would drift in is a FREE
      // Knock Out (see `ATTACK_CANCEL_HEADS`).
      //
      // `cardOfUid` returns undefined for a uid the catalog cannot resolve and
      // `matchesFilter` answers false for it, so an unreadable card in hand never
      // pays. An empty hand is 0.
      //
      // ⚠️ THE LOCALS ARE `handFilter`/`held` AND NOT THE ARM ABOVE'S `filter`/`matched`,
      // WHICH IS NOT A STYLE CHOICE. Five `D376-discard-threshold-*` mutation rows
      // carry SINGLE-LINE `find` strings taken off that arm; a byte-identical mirror
      // here makes every one of them match twice and `scripts/mutation/precheck.ts`
      // reports them BROKEN. **A MUTATION ROW'S `find` UNIQUENESS IS A PROPERTY THE
      // SOURCE OWES**, so the duplication is resolved where it was created rather than
      // by re-anchoring five rows onto longer context.
      // 🆕🆕 D445 — THE WALK MOVED OUT AND THIS ARM IS NOW A DELEGATION, which is the
      // move D440 made for the pile arm directly above and explicitly deferred for this
      // one (*"folding it in would mean a `zone` parameter and a rewrite of a shipped
      // arm for a family this slice does not print"*). D445 prints it:
      // `DamageCountSource.cardsInOpponentHand` needs the identical scan over the
      // identical zone with a different vocabulary. NOTHING ABOUT THIS ARM'S READING
      // CHANGED — same `CardFilter`, same `matchesFilter`, same `>=` on the printed "or
      // more" — and the filter stays a named local because a mutation row quotes that
      // line. ⚠️ **AND `countCardsInHand` KEEPS THE `held` COUNTER RATHER THAN THE PILE
      // WALK'S `matched`**, for the reason this block has carried since D420 and which
      // survives the move: five `D376-discard-threshold-*` rows quote single lines off
      // the pile walk, and a byte-identical mirror makes every one of them match twice.
      const handFilter: CardFilter = { kind: "basicEnergy", energyType: cond.energy };
      return countCardsInHand(state, seat, handFilter) >= cond.count;
    }
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
    case "opponentActiveHasToolAttached": {
      // 🆕 D369 — the CROSS-BOARD twin of the arm directly above, and the same
      // `tools.length > 0` read on `otherSeat(seat)`'s Active. NOT written as a
      // recursive call on the twin with the seat flipped: `conditionHolds` is
      // seat-RELATIVE, so "the other seat's own Active" is exactly what the twin
      // would answer for a caller that passed the other seat — and there is no
      // caller that does, because the sentence is printed on an ATTACK declared by
      // this seat. Two arms, two bodies, and the only board that separates them is
      // one with a Tool on exactly one side of the table.
      //
      // `> 0` rather than `=== 1` for the twin's reason (§7.4's cap is an attach
      // gate, Revavroom ex raises it to 4), and FALSE with an empty Active Spot,
      // as with every cross-board sibling: the attack gate guarantees a Defending
      // Pokémon at the live read site, so the null arm covers a directly-invoked
      // edge only.
      const active = state.players[otherSeat(seat)].active;
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
    case "yourActiveHealedThisTurn": {
      // 🆕🆕 D386 — the arm one line up, at a second stamp on the same body, and
      // it takes NO seat guard for the identical reason: `healedTurn` is written on
      // the Pokémon, `state.turn` is a global counter, so the comparison is total
      // over seats, consumers and phases.
      //
      // The cross-board case is the one worth naming, because this stamp has a
      // writer the promotion stamp does not: Picnic Basket heals EVERY in-play body
      // on BOTH boards, so the opponent's Active can be stamped with the
      // controller's turn number. It reads TRUE only while that turn is still in
      // progress — and the opponent cannot attack inside it — so by the time they
      // could ask, `state.turn` has advanced and the answer is FALSE. "During this
      // turn" means the turn now in progress, for whoever is asking.
      const active = state.players[seat].active;
      return active !== null && active.healedTurn === state.turn;
    }
    case "yourActiveEvolvedFromThisTurn": {
      // 🆕🆕 D393 — the arm above at a THIRD stamp on the same body, with the same
      // absence of a seat guard for the same reason (`evolvedTurn` is written on the
      // Pokémon, `state.turn` is global), plus one thing neither of the two above
      // needs: the printed clause NAMES the card evolved from, so the stamp alone is
      // not the whole answer.
      //
      // 🛑 THE NAME COMES OFF THE STACK, ONE BELOW THE TOP. `evolveOnto` (types.ts)
      // APPENDS the evolution card, so `stack[length - 2]` is the card this body
      // evolved from — §1.2's "the top is the identity" read one position down. The
      // `- 2` is guarded by `!== undefined` rather than by a length check, because a
      // stack of one gives `stack[-1]`, which is `undefined` and not a throw.
      //
      // ⚠️ THE TWO TESTS ARE BOTH LOAD-BEARING AND THEY FAIL ON DIFFERENT BOARDS.
      // Dropping the turn test pays Gholdengo's +90 forever after it evolves;
      // dropping the name test pays Misty's Starmie's +80 to a Gholdengo that evolved
      // this turn from something else. `evolvedFromBonus.test.ts` §3 drives both.
      //
      // The `?? false` — via the strict `===` against a possibly-undefined card — is
      // the unresolvable-uid path `yourBenchHasNamed` carries: `cardOfUid` returns
      // undefined for a uid the catalog cannot resolve, and an unreadable card must
      // never pay a bonus.
      const active = state.players[seat].active;
      if (active === null || active.evolvedTurn !== state.turn) return false;
      const beneath = active.stack[active.stack.length - 2];
      return beneath !== undefined && cardOfUid(state, beneath)?.name === cond.name;
    }
    case "yourActiveUsedAttackLastTurn": {
      // 🆕🆕 D394 — the FOURTH per-body stamp read by this switch, and the FIRST
      // whose window is not the turn in progress. The whole predicate is
      // `usedAttackOnYourLastTurn` (types.ts), a NAMED HELPER for the reason
      // `koedDuringOpponentsLastTurn` and `isFirstTurnOf` are: the `- 2` is a claim
      // about the TURN MACHINERY (turns strictly alternate, so two counter steps
      // back is the same seat's previous turn) rather than about this vocabulary,
      // and D131 gives one reading one implementation.
      //
      // ⚠️ SEAT-RELATIVE AND SAFE OFF-TURN BY PARITY RATHER THAN BY A GUARD, which
      // is a third way of arriving at `yourFirstTurn`'s property. `state.turn - 2`
      // shares the current turn's parity, and a body is only ever stamped on a turn
      // its own controller held (the §8 gate refuses an attack from the seat that
      // does not hold `turn:action`) — so a `conditionGate` evaluated for the
      // NON-turn seat under a koTrigger park compares against a turn number no body
      // of that seat can carry and gets an honest FALSE.
      //
      // ⚠️ THE TWO TESTS INSIDE THE HELPER ARE BOTH LOAD-BEARING AND FAIL ON
      // DIFFERENT BOARDS: dropping the NAME test pays Weezing's +120 for having used
      // "Crazy Blast" itself two turns ago, and dropping the TURN test pays it
      // forever after one "Pervasive Gas". `usedAttackBonus.test.ts` §3 drives both.
      const active = state.players[seat].active;
      return active !== null && usedAttackOnYourLastTurn(state, active, cond.attack);
    }
    case "yourPokemonUsedAttackLastTurn": {
      // 🆕🆕 D396 — the arm directly above with its SUBJECT widened from "this
      // Pokémon" to the printed *"1 of your Pokémon"*, and the widening is the whole
      // arm: the predicate, the window and the name test are `usedAttackOnYourLastTurn`
      // unchanged, called once per in-play body instead of once on the Active.
      //
      // 🛑 `[side.active, ...side.bench]` IS THIS FILE'S IN-PLAY SPREAD
      // (`yourNamedPokemonInPlay`, `countOwnerPokemonInPlay`), and the `!== null`
      // covers the empty Active Spot — `bench` is dense, so there are no holes in it.
      //
      // ⚠️ NO `topCardOf`, WHICH IS WHERE THIS PARTS FROM EVERY OTHER IN-PLAY WALK
      // HERE. Those read a fact about the CARD on top of the stack; this reads a
      // record written on the in-play BODY (`InPlayPokemon.usedAttack`, D394), so an
      // evolution placed on a stamped body keeps the history the printed clause asks
      // about. That is the right answer — the Pokémon that used Angelite is still the
      // Pokémon standing there — and it is also the only reading available, since the
      // stamp has no other home.
      //
      // ⚠️ SEAT-RELATIVE AND SAFE OFF-TURN BY PARITY, inherited from the helper
      // rather than re-argued: `state.turn - 2` shares the current turn's parity and a
      // body is only ever stamped on a turn its own controller held, so a gate
      // evaluated for the NON-turn seat compares against a turn number no body of that
      // seat can carry.
      //
      // ⚠️ THE BENCH TERM IS LOAD-BEARING AND `angeliteCancel.test.ts` §3 drives the
      // board that proves it: Sylveon ex A uses "Angelite" and retreats, Sylveon ex B
      // is promoted and declares "Angelite" — the printed clause bars it, and dropping
      // the spread back to the Active alone lets an illegal declaration through.
      const side = state.players[seat];
      return [side.active, ...side.bench].some(
        (p) => p !== null && usedAttackOnYourLastTurn(state, p, cond.attack),
      );
    }
    case "yourBenchAtLeast":
      // 🆕🆕 D366 — Victini "V-Force": the printed *"4 or fewer Benched Pokémon"*
      // under a cancel, so what is stored is the POSITIVE floor 5 and the test is
      // `>=`, `yourEnergyInPlayAtLeast`'s reading of "or more".
      //
      // 🛑 BENCH ONLY, and `bench` is a DENSE array (`InPlayPokemon[]`, types.ts),
      // so its `length` IS the number of Benched Pokémon — no `!== null` filter,
      // because there are no holes to skip. The Active Spot is deliberately not
      // spread in: the arm one family up (`yourNamedPokemonInPlay`) is what "in
      // play" looks like here, and the printed word on this card is "Benched".
      return state.players[seat].bench.length >= cond.count;
    case "opponentBenchAtLeast":
      // 🆕🆕 D389 — Iron Crown sv08-132 "Deleting Slash" ({M}{C}, 40+): "If your
      // opponent has 3 or more Benched Pokémon, this attack does 80 more damage."
      //
      // 🛑 THE SEAT TWIN OF THE ARM DIRECTLY ABOVE, AND A SECOND ARM RATHER THAN A
      // SEAT PARAMETER ON IT — the question this run deferred for sixteen slices,
      // settled the way this union has settled it three times already
      // (`opponentActiveDamaged`, `opponentActivePoisoned`,
      // `opponentActiveHasToolAttached`, the last of which says so in as many words
      // one screen up). NOT a recursive call on the twin with the seat flipped:
      // `conditionHolds` is seat-RELATIVE, so "the other seat's own Bench" is exactly
      // what the twin answers for a caller that passed the other seat, and no caller
      // does — the sentence is printed on an ATTACK this seat declares. Two arms, two
      // bodies, and the only board that separates them is one with different Bench
      // sizes on the two sides.
      //
      // 🛑 `otherSeat(seat)`, NEVER A HARD-CODED "p2". The whole defect this member
      // exists to avoid is `state.players[seat]` copied down from the arm above: it
      // is green on every board where the two Benches happen to match and wrong on
      // every board where they do not, which is the shape §4 drives.
      //
      // BENCH ONLY, and `bench` is a DENSE array (`InPlayPokemon[]`, types.ts), so its
      // `length` IS the number of Benched Pokémon — no `!== null` filter, because
      // there are no holes to skip. The opponent's Active Spot is deliberately not
      // spread in: the printed word is "Benched", and an opponent with an Active and
      // two Benched is three Pokémon in play and two Benched.
      //
      // `>=` because the printed word is "or more" — a FLOOR, the twin's reading.
      return state.players[otherSeat(seat)].bench.length >= cond.count;
    case "yourOwnerPokemonInPlayAtLeast":
      // D242 — "you have 4 or more Team Rocket's Pokémon in play". Active + Bench,
      // TOP cards only (an evolved stack is ONE Pokémon in play, §4), counted
      // through D200's `matchesFilter` `ownerPokemon` arm so the prefix rule lives
      // in exactly one place and this arm never learns a card name.
      //
      // `>=` because the printed word is "or more" — a FLOOR, `yourEnergyInPlayAtLeast`'s
      // reading and NOT `opponentPrizesRemaining`'s set membership.
      //
      // `topCardOf` can return undefined when a stack outruns the catalog (the
      // `yourBenchHasNamed` arm's own hazard, sixteen lines up), so the guard is
      // explicit rather than a non-null assertion.
      return countOwnerPokemonInPlay(state, seat, cond.owner) >= cond.count;
    case "yourPokemonKoedOnOpponentsLastTurn":
      // D271 — "any of your Pokémon were Knocked Out during your opponent's last
      // turn" (Unfair Stamp sv06-165, Hassel sv06-151/-205). The whole predicate
      // is `koedDuringOpponentsLastTurn` (types.ts), reading the `lastKoTurn`
      // stamp `knockOut` writes; it is not spelled out here because the same
      // arithmetic ("the previous turn IS the opponent's, because turns
      // alternate") is a claim about the turn machinery rather than about this
      // vocabulary, and one reading of it is the D131 rule.
      //
      // ⚠️ SEAT-RELATIVE AND SAFE OFF-TURN, unlike `youPlayedSupporterThisTurn`
      // fifteen arms up: that member reads `state.allowances`, a SINGLE bag
      // owned by whoever holds the turn, so it needs a `phaseViewOf` guard before
      // it may believe the flag is `seat`'s. `lastKoTurn` is a per-SEAT record
      // keyed by the side that LOST the Pokémon, so there is nothing to
      // disambiguate and no guard to forget — a `conditionGate` evaluated for the
      // non-turn seat under a koTrigger park still reads that seat's own history.
      //
      // 🆕 D326 — the two OPTIONAL narrowings. Absent means unnarrowed, and the
      // early return keeps D271's three printings on the byte-identical code
      // path they have always taken rather than routing them through a filter
      // that would answer the same thing more slowly and in a second place.
      if (cond.owner === undefined && cond.byAttack === undefined) {
        return koedDuringOpponentsLastTurn(state, seat);
      }
      // `koedMarksOnOpponentsLastTurn` asks the WINDOW question first and returns
      // an empty list when it is shut, so this `.some` cannot be true on a turn
      // where the bare gate is false — the narrowed gate is a strict subset by
      // construction and not by agreement between two readers.
      //
      // ⚠️ The owner test is `matchesFilter`'s `ownerPokemon` spelling and not a
      // second one: the mark carries the PRINTED CARD NAME, `owner` is the BARE
      // subgroup, and the possessive is built here exactly as that arm builds it.
      // Storing "Team Rocket's" on either side would put two spellings of one
      // subgroup in two files.
      return koedMarksOnOpponentsLastTurn(state, seat).some(
        (mark) =>
          (cond.owner === undefined || mark.name.startsWith(`${cond.owner}'s `)) &&
          (cond.byAttack === undefined || mark.byAttack),
      );
    case "youGoSecond":
      // D280 — a SEAT-ASSIGNMENT question, not a turn question: `firstPlayer` is
      // read against `seat` itself, so this answers the same on turn 2 and on
      // turn 40 and needs no `activeSeat` guard (`yourFirstTurn`'s reason one arm
      // down, and `youPlayedSupporterThisTurn`'s inverse). NOT `isFirstTurnOf`,
      // and not `state.turn === 2` either — that arithmetic coincides with this
      // on exactly ONE turn of the game and diverges on every other.
      //
      // `firstPlayer` is null through setup, and the `!== null` guard is what
      // stops that reading TRUE for BOTH seats (`null !== "p1"` and
      // `null !== "p2"` are both true). Before the flip, nobody goes second.
      return state.firstPlayer !== null && state.firstPlayer !== seat;
    case "allOf":
      // D280 — the vocabulary's one recursive arm, and its whole implementation.
      // `.every` and not `.some`: the printed conjunction is "and". The tuple
      // type has already refused the empty list, so this cannot be vacuously
      // TRUE off an authored value — the one way `.every` can lie.
      return cond.conditions.every((inner) => conditionHolds(state, seat, inner));
    case "yourFirstTurn":
      // D275 — "Once during your FIRST turn" (Fan Rotom sv07-118/sv08.5-085,
      // "Fan Call"). The whole predicate is `isFirstTurnOf` (types.ts): turns
      // alternate and the odd ones belong to `firstPlayer`, so the ordinal is
      // `turn === 1` for the going-first seat and `turn === 2` for the other. It
      // is not spelled out here for the reason the arm above is not — the
      // arithmetic is a claim about the TURN MACHINERY, and §4's evolve / Rare
      // Candy ban makes the identical claim three files over. One reading, one
      // implementation (D131).
      //
      // ⚠️ SEAT-RELATIVE AND SAFE OFF-TURN, like `lastKoTurn`'s arm and unlike
      // `youPlayedSupporterThisTurn`'s: the operands are `seat` and
      // `state.firstPlayer`, neither of which depends on whose turn it is, so a
      // `conditionGate` parked under the OPPONENT's turn gets an honest FALSE
      // rather than a borrowed TRUE. No `phaseViewOf` guard is owed, and adding
      // one would be a conjunct no board can make false.
      return isFirstTurnOf(state, seat);
  }
}

/** D242 — how many of `seat`'s in-play Pokémon carry the owner prefix `owner`
    ("Team Rocket's"). Active + Bench, stack TOPS only.

    A NAMED HELPER RATHER THAN AN INLINE FOLD, and MODULE-EXPORTED BUT DELIBERATELY
    NOT RE-EXPORTED FROM `index.ts`. The `conditionHolds` arm asks a THRESHOLD and
    throws the number away; a suite that can only see the boolean cannot tell "the
    count is 3" from "the count is 0", so every near miss in the prefix table would
    be provable only through the gate that consumes it. Exposing it on the package
    surface would be the opposite mistake — an API nobody calls (D135) — so it stops
    at the module boundary, which is where the tests are. */
export function countOwnerPokemonInPlay(state: GameState, seat: Seat, owner: string): number {
  return countPokemonInPlay(state, seat, { kind: "ownerPokemon", owner });
}

/** 🆕🆕 D439 — HOW MANY OF `seat`'s POKÉMON IN PLAY MATCH `filter`. This is
    `countOwnerPokemonInPlay`'s walk GENERALISED IN PLACE, not a copy of it: that
    function is now a two-line adapter over this one, so *"how many of your
    <noun> Pokémon are in play"* has exactly ONE answer no matter which vocabulary
    asks — `BoardCondition.yourOwnerPokemonInPlayAtLeast` (D242) or
    `DamageCountSource.yourPokemonInPlay` (D439).

    🛑 **GENERALISED RATHER THAN COPIED, AND THAT IS THE WHOLE POINT (D159, and
    D418's "remove the premise").** A second walk beside this one would have been
    four lines and would have made "in play" a question with two implementations
    that drift — and D416/D437's corpus hazard makes it worse than that: the line
    below is quoted verbatim by `D242-count-skips-the-active-spot`, so a
    byte-identical copy would have broken that row into a `2×` ERROR without
    anybody touching it.

    ⚠️ **"IN PLAY" IS ACTIVE + BENCH, TOP CARDS ONLY**, D242's reading unchanged
    and §4's: an evolved stack is ONE Pokémon in play, so this reads `topCardOf`
    and never the buried cards. The `body === null` guard is what makes a board
    with an EMPTY ACTIVE SPOT answer with its Bench rather than throwing —
    `continuous.ts`'s Energy walks spell the same fact the other way round
    (`side.active === null ? side.bench : [side.active, ...side.bench]`), and the
    two agree on every board; this shape is kept because it is the one the
    corpus quotes.

    ⚠️ `topCardOf` can return undefined when a stack outruns the catalog, so the
    guard is explicit rather than a non-null assertion — and `matchesFilter`'s own
    first line refuses `undefined` as well, which makes this belt-and-braces on
    the data gap rather than on the category. */
export function countPokemonInPlay(state: GameState, seat: Seat, filter: CardFilter): number {
  const side = state.players[seat];
  return [side.active, ...side.bench].filter((body) => {
    if (body === null) return false;
    const card = topCardOf(state, body);
    return card !== undefined && matchesFilter(card, filter);
  }).length;
}

/** 🆕🆕 D440 — HOW MANY CARDS IN `seat`'s DISCARD PILE MATCH `filter`. This is
    D376's `yourBasicEnergyInDiscardAtLeast` loop GENERALISED IN PLACE, not a copy of
    it: that arm is now a delegation, so *"how many cards in this pile match this
    printed noun"* has exactly ONE implementation no matter which vocabulary asks —
    `BoardCondition.yourBasicEnergyInDiscardAtLeast` (D376, a THRESHOLD) or
    `DamageCountSource.cardsInDiscardPile` (D440, the COUNT itself).

    🛑 **GENERALISED RATHER THAN COPIED, AND BOTH HALVES OF THAT ARE LOAD-BEARING**
    (D159, and D416/D437's corpus hazard). A second walk beside this one would have
    made a pile scan a question with two implementations free to drift (D222); and the
    lines below were quoted VERBATIM by `D376-discard-threshold-counts-the-whole-pile`,
    so a byte-identical copy would ALSO have broken a shipped mutation row into a `2×`
    ERROR without anybody touching it. The lines were MOVED here and four `D376-*` rows
    were re-transcribed onto their new addresses in the same edit — the indentation
    changed, so `precheck` would have caught it either way, which is exactly the point
    of the exactly-once rule.

    ⚠️ ~~**THE `hand` TWIN ONE ARM DOWN IS DELIBERATELY LEFT INLINE.**~~ D420's
    `yourBasicEnergyInHandAtLeast` runs the identical shape over `hand`, and its own
    doc block explains that its locals are named `handFilter`/`held` precisely to keep
    five `D376-*` `find` strings unique. Folding it in would mean a `zone` parameter and
    a rewrite of a shipped arm for a family this slice does not print — so it is not
    done, and it is recorded here rather than left as an inconsistency a successor has
    to rediscover. **The two zones are different zones**; this is not a second answer to
    one question.

    🆕🆕 **D445 — THE DEFERRAL ABOVE HAS EXPIRED, AND IT EXPIRED EXACTLY WHERE IT SAID IT
    WOULD.** Its condition was *"a family this slice does not print"*;
    `DamageCountSource.cardsInOpponentHand` prints it (2 sentences / 4 legal printings),
    so the hand loop moved out to `countCardsInHand` DIRECTLY BELOW and D420's arm is now
    a delegation. ⚠️ **AND THE `zone` PARAMETER THIS BLOCK PRICED WAS STILL REFUSED**: two
    sibling functions, not one with a discriminator, because the `find`-uniqueness the
    paragraph above is about is exactly what a shared body would destroy — the two walks
    differ in a zone name and a counter name, and both differences are load-bearing for
    six shipped mutation rows. **The refusal was right about its price and right about its
    trigger; only the date was open.** (D413's rule, at a source comment instead of a
    decision row.)

    🛑 **THE PREDICATE IS `matchesFilter`'s AND THE READING IS THE PRINT** (§6.5). A card
    in a discard pile is attached to nothing and provides nothing, so an Energy noun here
    is a printed card CLASS and never `providesEnergy` — which `matchesFilter` enforces
    on its own side by answering `false` for that filter unconditionally.

    ⚠️ `cardOfUid` returns `undefined` for a uid the catalog cannot resolve and
    `matchesFilter`'s first line answers false for it, so an unreadable card in the pile
    contributes 0 rather than throwing. An EMPTY pile is 0. */
export function countCardsInDiscardPile(
  state: GameState,
  seat: Seat,
  filter: CardFilter,
): number {
  let matched = 0;
  for (const uid of state.players[seat].discard) {
    if (matchesFilter(cardOfUid(state, uid), filter)) matched += 1;
  }
  return matched;
}

/** 🆕🆕 D445 — HOW MANY CARDS IN `seat`'s HAND MATCH `filter`. This is D420's
    `yourBasicEnergyInHandAtLeast` loop GENERALISED IN PLACE, not a copy of it: that arm
    is now a delegation, so *"how many cards in this hand match this printed noun"* has
    exactly ONE implementation no matter which vocabulary asks —
    `BoardCondition.yourBasicEnergyInHandAtLeast` (D420, a THRESHOLD) or
    `DamageCountSource.cardsInOpponentHand` (D445, the COUNT itself).

    🛑 **THE SIBLING ONE FUNCTION UP RECORDED THIS AS DEFERRED RATHER THAN AS AN
    INCONSISTENCY, AND THE CONDITION IT NAMED HAS ARRIVED.** `countCardsInDiscardPile`'s
    block says the hand twin is *"deliberately left inline"* because folding it in would
    cost *"a rewrite of a shipped arm for a family this slice does not print"*. D445
    prints that family (2 sentences / 4 legal printings), so the refusal expired exactly
    where it said it would — D413's rule, and the reason a refusal is written with its
    trigger rather than as a preference.

    🛑 **THE LOCALS ARE DELIBERATELY NOT THE PILE WALK'S, AND THAT IS NOT STYLE.**
    `held` where the sibling has `matched`, and `state.players[seat].hand` is the one
    other line that differs. Five `D376-discard-threshold-*` mutation rows plus
    `D440-shared-walk-reads-the-hand` carry single-line `find` strings taken off that
    function; a byte-identical mirror here would make each of them match TWICE and
    `scripts/mutation/precheck.ts` would report them BROKEN. **A MUTATION ROW'S `find`
    UNIQUENESS IS A PROPERTY THE SOURCE OWES** (D416/D437), so the duplication is
    resolved where it is created rather than by re-anchoring six rows onto longer
    context. D420 wrote that rule for the inline arm; it is carried here with the loop.

    🛑 **THE PREDICATE IS `matchesFilter`'s AND THE READING IS THE PRINT** (§6.5), and at
    this zone the reason is flatter than at the pile: a card sitting in hand is attached
    to nothing and pays for nothing, so `energyProvidesOf` has no board reading to give.
    `matchesFilter` enforces it on its own side by answering `false` for `providesEnergy`
    unconditionally.

    ⚠️ **A HAND IS HIDDEN, AND THIS FUNCTION DOES NOT CARE — WHICH IS THE POINT.** It is
    a pure count over the engine's full-information state; whether the ANSWER may be
    shown is decided by the printed sentence at the reader (see
    `DamageCountSource.cardsInOpponentHand`), never here. A walk that tried to enforce
    visibility would be a second place that has to know which sentences reveal.

    ⚠️ `cardOfUid` returns `undefined` for a uid the catalog cannot resolve and
    `matchesFilter`'s first line answers false for it, so an unreadable card in hand
    contributes 0 rather than throwing. An EMPTY hand is 0. */
export function countCardsInHand(state: GameState, seat: Seat, filter: CardFilter): number {
  let held = 0;
  for (const uid of state.players[seat].hand) {
    if (matchesFilter(cardOfUid(state, uid), filter)) held += 1;
  }
  return held;
}

/** §8/§9 (D242) — is `pokemon` barred from attacking by its OWN always-on printed
    Ability right now ("This Pokémon can't attack unless you have 4 or more Team
    Rocket's Pokémon in play")? Returns the unmet condition so the §8 gate can
    name it, and `undefined` when the body may attack.

    ⚠️ **A THIRD CHANNEL AND NOT A THIRD WRITER OF `attackLockedTurn`, WHICH IS
    D240's "PRICE THE CHANNEL, NOT THE TOKEN" APPLIED TO A GATE.** `attackLocked`
    (D143) and `lockedAttackIndexes` (D154/D165) both read a turn STAMP that an
    ATTACK installed on a body; this reads the CATALOG. The three differ on every
    axis that matters:

    | | `attackLocked` | `lockedAttackIndexes` | this |
    |---|---|---|---|
    | Source  | an attack's op   | an attack's op       | a printed Ability |
    | Scope   | the whole body   | ONE attack index     | the whole body |
    | Window  | one turn (stamp) | one turn (stamp)     | ALWAYS ON |
    | Clears  | by the clock     | by the clock         | by the BOARD changing |
    | §9 lock | immune           | immune               | **SUPPRESSED** |

    The last row is the one that could not have been faked by a fourth writer of
    the stamp field: Power Saver is a printed Ability, so Klefki `sv01-096`
    "Mischievous Lock" really must silence it and let the Mewtwo attack — which
    this reader gets for free by going through `passivesOf`, the §9-suppressed
    CATALOG scan, and which a stamp on `InPlayPokemon` would have got wrong
    silently and forever.

    ⚠️ **AND IT LIVES HERE RATHER THAN IN continuous.ts BESIDE ITS TWO SIBLINGS
    BECAUSE OF THE IMPORT GRAPH, NOT BECAUSE OF THE READING.** The condition is
    seat-relative, `passivesOf` has no seat (registry.ts `attackCostDiscountPerOpponentPrize`'s
    note), and `conditionHolds` is in THIS file while interpreter.ts already
    imports continuous.ts. So the passive is COLLECTED RAW by `passivesOf` and
    EVALUATED here — `attackerPreWRBonus`'s split for `damageBonusBeforeWRIf`,
    one function family over, verbatim.

    ⚠️ **IT RETURNS THE CONDITION RATHER THAN A BOOLEAN, WHICH IS WHERE IT PARTS
    FROM `attackLocked`.** That reader returns a plain boolean because there is
    one fact and no rider (D104's minimal shape); here the fact IS the unmet
    clause, and the §8 gate's whole job is to say which one — "you need 4 or more
    Team Rocket's Pokémon in play (you have 2)" rather than "you can't attack".
    Both payability projections still only want the boolean, and take
    `!== undefined`.

    ⚠️ **THE FIRST UNMET CONDITION WINS.** `passivesOf` COLLECTS (two sources can
    name one, registry.ts's rule), and a body under two gates is barred by both —
    but a message can only name one, and naming the first in source order is
    stable. No printing in the legal pool carries two. */
export function attackBarredByAbility(
  state: GameState,
  seat: Seat,
  pokemon: InPlayPokemon,
): BoardCondition | undefined {
  return passivesOf(state, pokemon).cantAttackUnless.find(
    (cond) => !conditionHolds(state, seat, cond),
  );
}

/** §4/§8 (D281) — is the attack at `index` blocked RIGHT NOW by the printed
    timing clause on the card itself, and if so by which clause? Returns the
    blocking gate (so the §8 reject can name the printed condition through
    `conditionNote`), or undefined when nothing on the card stops it.

      • `onlyIf`   — blocks while the condition does NOT hold (Illumise
                     `sv06-010`, Scream Tail ex `sv06-094`/`-197`).
      • `barredIf` — blocks while the condition DOES hold (Terapagos ex ×7).
      • `firstTurnExempt` — never blocks. It LIFTS §4's turn-1 ban, and it is
                     `firstTurnAttackBanned` (continuous.ts) that consumes it.

    🛑 **THE POLARITY IS RESOLVED HERE AND NOWHERE ELSE, WHICH IS THE POINT OF
    STORING IT AS A TOKEN.** Exactly one function in the repo knows that `onlyIf`
    and `barredIf` read the same condition in opposite directions; the three
    payability projections take a `!== undefined` and the §8 gate takes the note.
    That is `BoardCondition`'s standing refusal of `not` (D125) applied rather
    than re-litigated: polarity lives in the CONSEQUENT, where one reader carries
    it, instead of in the vocabulary, where every consumer would.

    ⚠️ **IT IS NOT A WIDENING OF `lockedAttackIndexes`, AND THAT WAS CHECKED
    BEFORE IT WAS WRITTEN.** That reader answers the same *shape* of question —
    "which of this body's attacks are unusable this turn" — and is the obvious
    place to put this. Three things stop it: it reads a per-turn STAMP written by
    an attack (§8/§11) where this is a CATALOG fact re-derived every read; it
    takes no SEAT and these conditions are seat-relative; and it returns a set of
    addresses with no reason, where the §8 reject must name the printed clause.
    A widened version would have had to grow a seat, a reason and a second
    lifetime — three changes to serve one call site, which is a parallel reader
    wearing the old one's name.

    ⚠️ **AND IT DOES NOT ANSWER THE §4 LICENCE**, deliberately, even though the
    licence is the same FIELD. A reader that returned "blocked / not blocked"
    for all three arms would have to know about §4's ban to say that
    `firstTurnExempt` unblocks — and §4's ban already has one reader, which every
    projection already calls. Two arms of one field, two readers, one for each
    rule they touch. */
/** The two arms of `AttackTimingGate` that can BLOCK a declaration — the union
    minus `firstTurnExempt`, which only ever unblocks and is §4's business.
    Derived with `Exclude` rather than re-listed, so a fourth member of the parent
    union lands in this one by default and must be excluded on purpose: the
    failure of a re-listed copy is SILENT (a new blocking clause the §8 gate never
    sees), and the failure of an over-wide one is a type error. */
export type BlockingAttackGate = Exclude<AttackTimingGate, { kind: "firstTurnExempt" }>;

export function attackTimingBlocked(
  state: GameState,
  seat: Seat,
  pokemon: InPlayPokemon,
  index: number,
): BlockingAttackGate | undefined {
  const gate = attackGateOf(state, pokemon, index);
  if (gate === undefined || gate.kind === "firstTurnExempt") return undefined;
  const holds = conditionHolds(state, seat, gate.condition);
  return (gate.kind === "onlyIf") === holds ? undefined : gate;
}

/** §4/§8 (D281) — the reject message for a blocked attack index, in the printed
    polarity. Beside the reader above rather than inside `attack.ts` so the ONE
    place that knows what the two polarities mean also owns the ONE sentence that
    says so — `attack.ts`'s §9 gate makes the identical argument about
    `conditionNote` (a second site switching on a discriminator is a second place
    that knows the vocabulary, D131). */
export function attackTimingNote(gate: BlockingAttackGate): string {
  return gate.kind === "onlyIf"
    ? `it can only be used if ${conditionNote(gate.condition)}`
    : `it cannot be used while ${conditionNote(gate.condition)}`;
}

/** §4/§10 (D278; MOVED HERE AND GIVEN A SEAT BY D279) — is `pokemon` LICENSED to
    evolve EARLY right now, i.e. are the two standing evolution-timing bans lifted
    on this body, for the player `seat`? True iff a live, unsuppressed printed
    licence is on the stack top and ITS OWN antecedent holds:

      • Eevee `sv08-143`/`sv08.5-074`/`svp-173` "Boosted Evolution" — while ACTIVE.
      • Karrablast `sv10.5b-009`/`-094`, Shelmet `sv10.5w-008`/`-093` "Stimulated
        Evolution" — while the NAMED PARTNER is anywhere in `seat`'s play,
        **Active Spot or Bench, and in EITHER zone for the holder itself**.

    🛑 **ONE PREDICATE FOR TWO BANS, AND THAT PAIRING IS THE WHOLE POINT.** The
    printed sentence is *"it can evolve during your first turn **or the turn you
    play it**"*, and those two disjuncts are two different `err` returns:

      • `isFirstTurnOf(state, seat)`   → `FIRST_TURN_EVOLVE`  (turn.ts `evolve`)
      • `target.turnPlayed >= state.turn` → `EVOLVE_TOO_SOON` (turn.ts `evolve`)

    ⚠️ **IT DOES NOT COLLAPSE THE TWO ERROR CODES, AND MUST NOT.** A single
    "may this body evolve" predicate returning a boolean would lose the
    distinction between *"not on your first turn"* and *"not the turn it came
    into play"*, which are different messages about different boards and are
    separately asserted. Each ban line keeps its own `err`; this predicate only
    says whether to SKIP it.

    ⚠️ **IT DOES NOT REACH RARE CANDY, AND D278 PROVED THAT BY READING THE OTHER
    CARD.** `rareCandy`/`rareCandyOptions` (cardplay.ts) carry a restriction that
    coincides with §4/§10 clause for clause — *"You can't use this card during
    your first turn or on a Basic Pokémon that was put into play this turn"* — but
    it is printed on **Rare Candy**, and an Ability on the TARGET cannot lift a
    restriction a different card prints about its own use. Two rules that agree on
    every board are not one rule.

    🛑 **IT LIVES HERE, NOT IN continuous.ts, AND IT TAKES A SEAT — BOTH BECAUSE
    OF THE PARTNER GATE.** *"If you have Shelmet in play"* is seat-relative and
    `passivesOf` has no seat, so the clause is collected RAW by the fold and
    evaluated here where `conditionHolds` lives. That is `cantAttackUnless` /
    `attackBarredByAbility` one function up, verbatim, and it is the reason this
    module (which imports continuous.ts) is the right home. `seat` is the
    EVOLVING player — `evolve` has already proved the target is theirs.

    ⚠️ **THE ZONE CLAUSE IS STILL RESOLVED IN THE FOLD, AND ONLY FOR THE PRINTING
    THAT PRINTS IT.** Do not re-add `!onBench` here: three of the seven printings
    say "Active Spot" and four say nothing, and a blanket zone gate REFUSES a
    benched Karrablast the card licenses. That failure is invisible to every
    assertion made on an Active body.

    ⚠️ **THE §4 CHECK HAD TO MOVE BELOW TARGET RESOLUTION IN `evolve`.** Before
    D278 it refused on `isFirstTurnOf` as its SECOND statement, before the target
    existed. The licence is a fact about the TARGET BODY, so the ban cannot be
    answered without it. The observable consequence is an error-PRECEDENCE change
    on a first turn with an otherwise-invalid action (a garbled target now reports
    `BAD_TARGET` rather than `FIRST_TURN_EVOLVE`) — recorded because it is the
    kind of reorder that is invisible to every test using a well-formed action.

    Through `passivesOf` rather than off the top card directly: the licence is a
    printed ABILITY, so a §9 Ability-lock (Klefki `sv01-096`) must silence it and
    hand both bans back. Reading the catalog row here would be shorter and would
    get that wrong silently. */
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

/** The condition as a printed-text fragment, for the reject message a failed
    play gate returns ("<card> can only be used if <this>"). */
export function conditionNote(cond: BoardCondition): string {
  switch (cond.kind) {
    case "morePrizesThanOpponent":
      return "you have more Prize cards remaining than your opponent";
    case "yourStadiumInPlay":
      return "you have a Stadium in play";
    case "stadiumInPlay":
      // 🆕 D378 — the printed clause verbatim, which is unusual in this switch: most
      // arms drop a pronoun or re-voice a noun phrase (D116, D296) because a
      // reject/tooltip fragment is read off the BOARD. This one needs neither — the
      // sentence never says "you", so there is nothing to re-seat.
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
      // The printed pronoun ("the Defending Pokémon") is dropped for
      // `yourActiveDamaged`'s reason (D116): a reject/tooltip fragment is read off
      // the BOARD, where no attack is resolving and nothing is "Defending".
      return "your opponent's Active Pokémon is a Basic Pokémon";
    case "opponentActiveIsStage1":
      // D387 — the printed clause verbatim; unlike its Stage 2 sibling one line
      // down, this card prints the adjective as a WHOLE CLAUSE already, so there is
      // no noun phrase to re-voice and the fragment is the sentence's own words.
      return "your opponent's Active Pokémon is a Stage 1 Pokémon";
    case "opponentActiveIsStage2":
      // D296 — the printed adjective as a standalone clause. The card prints it
      // INSIDE a noun phrase ("your opponent's Active Stage 2 Pokémon"), which a
      // reject/tooltip fragment cannot borrow, so the fragment says what the
      // member READS in the same voice its two siblings use.
      return "your opponent's Active Pokémon is a Stage 2 Pokémon";
    case "yourActiveDamaged":
      // The printed pronoun is dropped for the same reason "already" is above: a
      // reject/tooltip fragment is read off the BOARD, where "this Pokémon" has
      // no referent (D116).
      return "your Active Pokémon has damage counters on it";
    case "yourActiveUndamaged":
      // 🆕 D368 — the printed pronoun is dropped exactly as the arm above drops it
      // (D116), and the phrasing is POSITIVE English rather than a negation of the
      // note above. This is the readable phrasing D125 said a `not` combinator could
      // not supply generically: it exists here because the member is a NAMED board
      // fact, not an operator over an arbitrary one.
      return "your Active Pokémon has no damage counters on it";
    case "yourBenchDamaged":
      return "1 of your Benched Pokémon has damage counters on it";
    case "yourBenchAllDamaged":
      // 🆕 D373 — "all" is kept where the arm above turns the collective plural into
      // "1 of", because here the quantifier IS the content: a reject pill reading
      // "your Benched Pokémon have damage counters" would describe the sibling member
      // and mislead on exactly the boards the two disagree about. The empty-Bench
      // reading is NOT spelled into the note — a note is a fragment about the board a
      // player is looking at, and a player with no Bench is not reading it.
      return "all of your Benched Pokémon have at least 1 damage counter on them";
    case "yourBenchNamedDamaged":
      // 🆕🆕 D397 — the EXISTENTIAL's note two arms up with its noun replaced,
      // and the collective plural turned into "1 of" for that arm's reason exactly: a
      // reject pill names ONE body a player can point at. The printed clause says
      // *"any of your Benched Cubone HAVE"*; a pill that kept the plural would
      // describe a set nobody is looking at.
      //
      // ⚠️ THIS STRING IS THE PRICE OF CHOOSING A MEMBER OVER A FIELD AND IS SAID SO
      // RATHER THAN HIDDEN: an optional `name?` on the sibling would have made these
      // two arms one interpolation, and that measurement is recorded in the member's
      // doc block as the clause that dissented. It lost to the DELEGATE clause, not
      // to a tie.
      //
      // Like both bench notes above it this does NOT round-trip to its
      // `CONDITIONAL_DAMAGE_CLAUSES` key — the key is the printed plural — and
      // `benchNamedDamagedBonus.test.ts` §4 asserts the non-round-trip rather than
      // leaving a successor to "fix" one into the other.
      return `1 of your Benched ${cond.name} has damage counters on it`;
    case "opponentActivePoisoned":
      return "your opponent's Active Pokémon is Poisoned";
    case "opponentActiveHasSpecialCondition":
      return "your opponent's Active Pokémon is affected by a Special Condition";
    case "yourActivePoisoned":
      // The printed pronoun is dropped exactly as `yourActiveDamaged` drops it —
      // a reject/tooltip fragment is read off the BOARD (D116).
      return "your Active Pokémon is Poisoned";
    case "opponentActiveBurned":
      // 🆕 D377 — a full round-trip, like the two Poison notes and unlike D376's
      // neighbour: the clause names no pronoun, no timing word and no energy glyph,
      // so the note IS the `CONDITIONAL_DAMAGE_CLAUSES` key byte for byte. It is NOT
      // the `ATTACK_REQUIREMENT_CLAUSES` key, which spells the same fact negated —
      // the note describes the board, and the board is either Burned or it is not.
      return "your opponent's Active Pokémon is Burned";
    case "opponentActiveConfused":
      // 🆕 D377 — the same round-trip one status over.
      return "your opponent's Active Pokémon is Confused";
    case "opponentActiveIsExOrV":
      return "your opponent's Active Pokémon is a Pokémon ex or Pokémon V";
    case "opponentActiveIsEx":
      // 🆕 D362 — byte-identical to the clause table's KEY, which is what makes
      // the round trip exact: `If ${conditionNote(cond)}, this attack does N more
      // damage.` re-derives to the same member in one step. The sibling one line
      // up is this string plus " or Pokémon V", and that four-word tail is the
      // only thing between them — asserted in BOTH directions in
      // `exOnlyActive.test.ts` §3.
      return "your opponent's Active Pokémon is a Pokémon ex";
    case "yourActiveHasEnergyAttached":
      // The family's first note built from a PARAMETER rather than returned as a
      // literal. The pronoun is dropped exactly as its siblings drop it, and the
      // energy reads as the printed NAME rather than the brace code — a
      // reject/tooltip fragment is prose, and half the pool prints it that way
      // anyway.
      //
      // 🆕🆕 **D500 — A THIRD LIMB, AND `tsc` SAID NOTHING ABOUT ITS ABSENCE.** The
      // else branch is a TEMPLATE STRING, so a widened `cond.energy` type compiles and
      // the missing arm renders *"…has basic Energy attached"* — lowercase, and naming
      // a card CATEGORY as though it were a type. That is D473's defect exactly: the
      // reader would be correct, the census would step, every suite would pass, and
      // the only thing wrong would be the sentence a player reads off the pill. Found
      // by tracing this call site rather than by a red compile, which is why the arm
      // is spelled out instead of left to the fallback.
      //
      // ⚠️ The seat mirror directly below is deliberately NOT given the limb: its
      // member is not widened, because no producer can hand it the value (the clause
      // that sets it is a LITERAL row, not the token map).
      if (cond.energy === "basic") return "your Active Pokémon has a Basic Energy attached";
      return cond.energy === "special"
        ? "your Active Pokémon has a Special Energy attached"
        : `your Active Pokémon has ${cond.energy} Energy attached`;
    case "opponentActiveHasEnergyAttached":
      // 🆕🆕 D415 — the seat mirror of the note directly above, built from the same
      // parameter. ⚠️ NO PRONOUN IS DROPPED HERE, WHICH IS THE DIFFERENCE: the twin
      // drops a printed "this Pokémon" because the clause table resolved it; this
      // sentence names the opponent's Active in words, so the note is the printed
      // phrase itself and the round trip is exact rather than re-voiced.
      return cond.energy === "special"
        ? "your opponent's Active Pokémon has a Special Energy attached"
        : `your opponent's Active Pokémon has ${cond.energy} Energy attached`;
    case "yourActiveHasNamedEnergyAttached":
      // 🆕 D374 — built from the parameter, and the pronoun is dropped exactly as the
      // arm above drops it (D116), so the pill names the body a player can see rather
      // than the one the card's own text points at. The name is printed WHOLE — it
      // already ends in "Energy", so appending the word would read "Team Rocket's
      // Energy Energy". It therefore does NOT round-trip to the printed bytes, and it
      // round-trips to the same MEMBER through nothing at all: this clause is a
      // literal ROW keyed on the printed spelling. Two audiences, two strings —
      // D372's note says the same, and it is still not a defect to be "fixed".
      return `your Active Pokémon has a ${cond.name} attached`;
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
    case "yourHandExactly":
      // 🆕 D379 — built from the parameter. It does NOT round-trip to the printed
      // bytes and cannot: the catalog prints the NEGATIVE ("you don't have exactly
      // 3…") because the requirement skeleton owns the negation, while a reject pill
      // has to say what the board must look like. The plural is unconditional — the
      // pool prints this clause at ONE value, 3, so a singular branch would be a
      // shape no printing can reach (D205's rule about never-spelled counts).
      return `you have exactly ${cond.count} cards in your hand`;
    case "yourHandNotEmpty":
      // 🆕🆕 D385 — NULLARY, so there is no parameter to build from and the string is
      // a literal. It does NOT round-trip to any printed clause and cannot: the
      // catalog states this fact as a CONSEQUENT ("if you discarded any cards in this
      // way") and never as an antecedent, so a reject pill has to say what the board
      // must look like BEFORE the offer. "At least 1 card" rather than "not empty",
      // because a pill is read by a player and the sibling above spells its threshold
      // out too.
      return "you have at least 1 card in your hand";
    case "yourDeckAtMost":
      // 🆕🆕 D398 — built from the parameter, and the PRINTED CLAUSE IS NOT REUSED
      // even though it would type-check: the card says *"there are 3 or fewer cards
      // in your deck"* and a reject pill is read by a player looking at their own
      // board, so the expletive head becomes the second person the rest of this
      // function speaks in. It therefore does NOT round-trip to its
      // `CONDITIONAL_DAMAGE_CLAUSES` key, exactly like the three bench notes above,
      // and `deckSizeBonus.test.ts` §4 asserts the non-round-trip rather than leaving
      // a successor to "fix" one into the other.
      //
      // ⚠️ THE PLURAL IS UNCONDITIONAL, for `yourActiveEnergyAtLeast`'s reason: the
      // count is a parameter so 1 is representable, but no printing spells one and a
      // singular branch would be a shape nothing can reach (D205's unreachable-shape
      // rule). "or fewer" is the printed comparator spelled as printed.
      return `you have ${cond.count} or fewer cards in your deck`;
    case "yourActiveEnergyAtLeast":
      // 🆕🆕 D383 — built from the parameter, and the pronoun is dropped exactly as
      // every sibling drops it (D116). The plural is unconditional for
      // `yourHandExactly`'s reason inverted: the anchor captures the digit, so a
      // count of 1 is representable, but no printing spells one and a singular branch
      // would be a shape nothing can reach (D205).
      //
      // 🆕🆕 D391 — THE FILTER DROPS INTO ONE INTERPOLATION SLOT, AND THAT IS WHY THE
      // FIELD COST LESS THAN A SECOND MEMBER HERE. D383's arm said this note "does
      // NOT round-trip to any printed clause and CANNOT"; Abomasnow `sv10-060`
      // "Frozen Wood" prints the typed half, so the narrowed note DOES round-trip —
      // modulo the pronoun (D116) and the brace code, which reads as the spelled NAME
      // because a pill is read off the board by a person and "{G}" is a card-face
      // glyph (D118, `yourEnergyInPlayAtLeast`'s wording one member over). ⚠️ THE
      // UNNARROWED STRING IS BYTE-IDENTICAL TO THE ONE THIS ARM RETURNED BEFORE, so
      // no shipped pill moved: "Energy" is what the slot holds when the field is
      // absent. `Special` is the CARD CLASS and not a type, so it spells "Special
      // Energy" rather than "Special Energy Energy" — the same three-way this file
      // spells nowhere else because no other member is optional on its filter.
      return `your Active Pokémon has ${cond.count} or more ${
        cond.energy === undefined
          ? "Energy"
          : cond.energy === "special"
            ? "Special Energy"
            : `${cond.energy} Energy`
      } attached`;
    case "activeEnergyCountsEqual":
      // 🆕 D372 — the printed pronoun is dropped exactly as its siblings drop it
      // (D116), so the note names the body a reader can see on the board rather than
      // the one the card's own text points at. It therefore does NOT round-trip to
      // the printed bytes — and it round-trips to the same MEMBER through nothing at
      // all, because this clause is a literal ROW keyed on the printed spelling. The
      // note is a reject pill and a HUD tooltip; the row is the parser's key. Two
      // audiences, two strings, stated so a successor does not "fix" one into the
      // other.
      return "your Active Pokémon and your opponent's Active Pokémon have the same amount of Energy attached";
    case "moreActiveEnergyThanOpponent":
      // 🆕🆕 D384 — the printed pronoun is dropped exactly as the arm above drops it
      // (D116), so the note names a body a reader can SEE rather than the one the
      // card's text points at, and it therefore does NOT round-trip to the printed
      // bytes. It does not round-trip to the MEMBER either, and for the same reason
      // the arm above does not: this clause is a literal ROW keyed on the printed
      // spelling, so the parser's key and the reject pill are two different strings
      // with two different audiences. Stated so a successor does not "fix" one into
      // the other — and note that the two notes differ in their VERB, which is the
      // one place a copy-paste of the line above would go undetected.
      return "your Active Pokémon has more Energy attached than your opponent's Active Pokémon";
    case "opponentActiveHasType":
      // Built from the parameter, and it round-trips to the same MEMBER.
      //
      // ⚠️ 🆕 D370 — IT NO LONGER ROUND-TRIPS TO THE PRINTED BYTES, AND THIS
      // COMMENT SAID IT DID. The claim was true when it was written (the pool's
      // only printing spelled `Dragon` out) and D367 falsified it by teaching
      // `CLAUSE_POKEMON_TYPES` the brace notation: `{P}` and `{D}` are printed on
      // **3 legal printings** and this note answers "Psychic" / "Darkness". That
      // is the RIGHT answer — a card-face glyph is not a tooltip (D118) — and the
      // sentence rebuilt from it still re-derives to this member, through the
      // map's other half. **A WIDENING CAN FALSIFY A COMMENT IN A FILE IT DOES NOT
      // TOUCH**, which is why the surviving claim is the one about the member and
      // not the one about the bytes.
      return `your opponent's Active Pokémon is a ${cond.type} Pokémon`;
    case "opponentActiveHasResistance":
      // 🆕 D371 — built from the parameter, and the type reads as the printed NAME
      // rather than the brace code (D118, the rule the arm above now states in the
      // form that survives D367's widening): the card prints `{F}` and this note
      // answers "Fighting", because a reject pill and a HUD tooltip are read off
      // the board by a person and a brace code is a card-face glyph.
      //
      // ⚠️ So it does NOT round-trip to the printed bytes, and it DOES round-trip
      // to the same MEMBER — through `CLAUSE_POKEMON_TYPES`'s spelled-out half.
      // Asserted both directions in `opponentResistanceBonus.test.ts` §3.
      return `your opponent's Active Pokémon has ${cond.type} Resistance`;
    case "opponentActiveRetreatCostAtLeast":
      // 🆕 D388 — built from the parameter, and the `{C}{C}` glyph is resolved to its
      // ARITY for the reason the arm above resolves `{F}` to "Fighting" (D118): a
      // reject pill and a HUD tooltip are read off the board by a person, and a brace
      // code is a card-face glyph. So this note does NOT round-trip to the printed
      // bytes and DOES round-trip to the same member, which is the family's standing
      // trade.
      //
      // The printed sentence's own word order is kept — subject "the Retreat Cost",
      // not "your opponent's Active Pokémon" — because unlike the Stage 2 sibling
      // this card prints the fact as a WHOLE CLAUSE and there is no noun phrase to
      // re-voice. "or more" is the printed word and reads as the floor it is.
      return `the Retreat Cost of your opponent's Active Pokémon is ${String(cond.count)} or more`;
    case "yourBenchHasType":
      // 🆕 D370 — built from the parameter, and the type reads as the printed NAME
      // rather than the brace code — `yourEnergyInPlayAtLeast`'s rule (D118), for
      // the same reason: a reject message and a HUD tooltip are read off the board
      // by a person, and "{M}" is a card-face glyph. So this note does NOT
      // round-trip to the printed clause byte for byte…
      //
      // ⚠️ …and it DOES round-trip to the same MEMBER, which is a stronger property
      // and one this family only gained at D367: `CLAUSE_POKEMON_TYPES` carries
      // BOTH notations, so `If ${conditionNote(cond)}, this attack does N more
      // damage.` re-derives to `{ kind: "yourBenchHasType", type }` through the
      // map's spelled-out half. Asserted both directions in
      // `benchTypeBonus.test.ts` §3.
      return `you have any ${cond.type} Pokémon on your Bench`;
    case "opponentInPlayHasType":
      // 🆕 D390 — built from the parameter, and the type reads as the printed NAME
      // rather than the brace code, which is D118's rule and the arm directly above
      // applied one seat and one zone over: the card prints `{W}` and this note
      // answers "Water", because a reject pill and a HUD tooltip are read off the
      // board by a person and a brace code is a card-face glyph.
      //
      // ⚠️ So it does NOT round-trip to the printed bytes, and it DOES round-trip to
      // the same MEMBER — through `CLAUSE_POKEMON_TYPES`'s spelled-out half, which is
      // the stronger of the two properties and the one D367's widening bought for the
      // whole family. Asserted in both directions in `inPlayTypeBonus.test.ts` §3.
      //
      // The printed subject "your opponent" survives where D116 drops "this Pokémon":
      // it names a side the reader can see, not a pronoun pointing back at the card.
      return `your opponent has any ${cond.type} Pokémon in play`;
    case "inPlayTypesIntersect":
      // 🆕 D375 — VERBATIM, and this is the family's first CROSS-BOARD note that is.
      // The printed clause names no pronoun for D116 to resolve and no card-face
      // glyph for D118 to spell out: it is already written in the second person the
      // pill is read in. So it round-trips BOTH ways — to the printed bytes and to
      // this member through `CONDITIONAL_DAMAGE_CLAUSES` — which the two notes above
      // deliberately do not, and `typeShareBonus.test.ts` §3 asserts the difference
      // rather than leaving a successor to "fix" one into the other.
      return "any of your Pokémon in play are the same type as any of your opponent's Pokémon in play";
    case "yourBenchHasNamed":
      // Also verbatim — this clause names no pronoun and no timing word, so
      // nothing has to be dropped on the way out (D119's whole cluster).
      return `${cond.name} is on your Bench`;
    case "yourBenchHasNameContaining":
      // 🆕 D392 — also verbatim, and the QUOTATION MARKS are printed bytes rather
      // than punctuation this note chose: the clause quotes its fragment on the card
      // face (ASCII U+0022, checked against the committed corpus), so dropping them
      // would make the pill read as a whole card name and mean the arm one line up.
      // Like that arm it names no pronoun and no timing word, so nothing is dropped
      // on the way out, and it round-trips to its `CONDITIONAL_DAMAGE_CLAUSES` key
      // byte for byte.
      return `a Pokémon that has "${cond.fragment}" in its name is on your Bench`;
    case "yourNamedPokemonInPlay":
      // D279 — round-trips to the printed clause with only the leading "If" and
      // the trailing comma dropped, exactly as the arm above does: "If you have
      // Shelmet in play, …" → "you have Shelmet in play". The pronoun "you"
      // SURVIVES here where D116 drops "this Pokémon", because it is the reader's
      // own side and the note is read by the player it addresses.
      return `you have ${cond.name} in play`;
    case "yourEnergyInPlayAtLeast":
      // Built from BOTH parameters, and the energy reads as the printed NAME
      // rather than the brace code — D118's rule, so this is the family's first
      // note that does NOT round-trip to the printed clause byte for byte
      // ("{D}" → "Darkness"). Deliberate: a reject message and a HUD tooltip are
      // read off the board by a person, and "{D}" is a card-face glyph.
      //
      // 🆕🆕🆕 **D494 — THE UNTYPED BRANCH, AND A WRONG ONE HERE IS SILENT.**
      // `energy` gained `null` (every Energy card in play, no type asked), and
      // `${null} Energy` interpolates to *"null Energy"* with `tsc` saying nothing —
      // so the branch is OWED even though nothing can render it. ⚠️ **IT IS
      // UNRENDERABLE FROM ANY PRINTED SENTENCE TODAY (D446):** the only clause row
      // producing this value is *"you have 3 or more Energy in play"*, reached by
      // `CONDITIONAL_DAMAGE_BONUS` and by `CONDITIONAL_BONUS_SUPPRESSED`, and neither
      // builds a note — `conditionNote`'s five call sites are all attack/ability/play
      // GATES. Driven directly in `energyInPlaySuppressed.test.ts` §6, with the
      // unreachability asserted as a sweep over the derived attack column rather than
      // claimed. ⚠️ And unlike its two neighbours this one DOES round-trip to the
      // printed clause byte for byte, because the key carries no brace code.
      if (cond.energy === null) return `you have at least ${cond.count} Energy in play`;
      return cond.energy === "special"
        ? `you have at least ${cond.count} Special Energy in play`
        : `you have at least ${cond.count} ${cond.energy} Energy in play`;
    case "yourBasicEnergyInDiscardAtLeast":
      // 🆕 D376 — built from BOTH parameters, like the arm one line up, and it spells
      // the energy as the printed NAME rather than the brace code for D118's reason
      // verbatim: a reject message and a HUD tooltip are read off the board by a
      // person, and "{R}" is a card-face glyph.
      //
      // ⚠️ SO IT DOES NOT ROUND-TRIP TO THE PRINTED BYTES, AND IT DOES NOT ROUND-TRIP
      // TO THE MEMBER EITHER — TWO DIFFERENCES, NOT ONE. "10 or more" becomes "at
      // least 10" (the sibling's phrasing, kept so the two pills read alike) and "{R}"
      // becomes "Fire". `CONDITIONAL_DAMAGE_CLAUSES` is keyed on the printed sentence
      // whole, so unlike `yourBenchHasType` there is no spelled-out half of a token
      // map to land on. Asserted in the negative in `basicEnergyDiscard.test.ts` §2,
      // beside the two neighbours that DO round-trip, so a successor cannot "fix" one
      // into the other.
      //
      // The printed noun is plural on the card and stays plural here: the pool prints
      // 10 and a threshold of 1 is unprinted, so there is no singular to agree with.
      return `you have at least ${cond.count} Basic ${cond.energy} Energy cards in your discard pile`;
    case "yourBasicEnergyInHandAtLeast":
      // 🆕🆕 D420 — the arm one line up with the ZONE NOUN changed, and it inherits
      // both of that arm's departures from a round trip: "{G}" is spelled "Grass"
      // (D118 — a reject message is read off the board by a person, and a brace code
      // is a card-face glyph), and the phrasing is the family's "at least N" rather
      // than any printed words. There is nothing to round-TRIP to here in any case:
      // `ATTACK_CANCEL_HEADS` is keyed on the printed IMPERATIVE HEAD SENTENCE
      // ("Discard 6 Basic {G} Energy cards from your hand."), not on a condition
      // clause, so this note and that key are different sentences by construction.
      //
      // SINGULAR AGREEMENT IS LIVE HERE AND WAS NOT IN THE DISCARD ARM. That member's
      // pool prints only 10; this one prints 6, 2 AND 1, so the `count === 1` branch
      // is a printed case rather than a defensive one — Ogerpon's *"a Basic {G}
      // Energy card"* would otherwise read "at least 1 Basic Grass Energy cards".
      return cond.count === 1
        ? `you have a Basic ${cond.energy} Energy card in your hand`
        : `you have at least ${cond.count} Basic ${cond.energy} Energy cards in your hand`;
    case "yourActiveHasToolAttached":
      // Back to a round-trip: this clause names no timing word and no energy
      // glyph, so only the pronoun is dropped (D116) and the rest is the printed
      // sentence.
      return "your Active Pokémon has a Pokémon Tool attached";
    case "opponentActiveHasToolAttached":
      // 🆕 D369 — a FULL round trip, and the family's cleanest after
      // `youPlayedSupporterThisTurn`: this clause names no pronoun to resolve, no
      // timing word to drop and no card-face glyph to spell out, so the fragment is
      // the printed clause verbatim AND is byte-identical to the
      // `CONDITIONAL_DAMAGE_CLAUSES` key. The arm one line up cannot do that — its
      // printed subject is "this Pokémon", which D116 makes the table's job.
      return "your opponent's Active Pokémon has a Pokémon Tool attached";
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
    case "yourActiveHealedThisTurn":
      // The same resolved pronoun as the arm above (D116): the printed subject is
      // "this Pokémon", which a note read off the board by a person has to spell as
      // "your Active Pokémon". Everything after it is the printed clause verbatim,
      // the "during" included — the family's timing word is dropped by nobody here.
      return "your Active Pokémon was healed during this turn";
    case "yourActiveEvolvedFromThisTurn":
      // 🆕🆕 D393 — the same resolved pronoun as the two arms above (D116): the
      // printed subject is "this Pokémon" and a note read off the board by a person
      // has to spell it "your Active Pokémon". Everything after it is the printed
      // clause verbatim, the pre-evolution NAME and the "during" included — so the
      // note and the two `CONDITIONAL_DAMAGE_CLAUSES` keys differ by exactly that
      // one resolved pronoun and nothing else.
      return `your Active Pokémon evolved from ${cond.name} during this turn`;
    case "yourActiveUsedAttackLastTurn":
      // 🆕🆕 D394 — the same resolved pronoun as the three arms above (D116): the
      // printed subject is "this Pokémon" and a note read off the board by a person
      // has to spell it "your Active Pokémon". Everything after it is the printed
      // clause verbatim, the ATTACK NAME and the possessive "your last turn"
      // included — the possessive is KEPT for `yourPokemonKoedOnOpponentsLastTurn`'s
      // reason (a player knows whose turn it was; "two turns ago" is engine
      // vocabulary), so the note differs from its two `CONDITIONAL_DAMAGE_CLAUSES`
      // keys by exactly the one resolved pronoun.
      //
      // Built from the PARAMETER, so the second printing is legible without a second
      // string — D393's ONE-ARM-ONE-SLOT reading, and the slot is load-bearing for
      // its reason: one arm now renders two clauses, so an arm that dropped the token
      // would render the same pill for Falinks and for Weezing.
      return `your Active Pokémon used ${cond.attack} during your last turn`;
    case "yourPokemonUsedAttackLastTurn":
      // 🆕🆕 D396 — THE FAMILY'S FIRST NOTE THAT RESOLVES NO PRONOUN, because the
      // printed subject does not carry one: *"1 of your Pokémon"* is already
      // board-relative and already addressed to the player reading it, so this arm
      // round-trips to the printed clause with only the leading "If" and the trailing
      // comma dropped — `yourNamedPokemonInPlay`'s treatment, not D116's.
      //
      // ⚠️ THE SUBJECT IS THE WHOLE DIFFERENCE FROM THE ARM ABOVE, and it is why a
      // `zone?` field would have had to branch INSIDE this arm rather than fill a
      // second slot in it: the two notes share a skeleton but not a subject, and a
      // note that said "your Active Pokémon" on a board where a BENCHED body is what
      // bars the attack would name the wrong Pokémon in a §8 reject the player is
      // reading to find out why.
      //
      // Built from the PARAMETER for D394's reason unchanged — one arm, one slot, so
      // a second printing quoting a different attack name is legible without a second
      // string.
      return `1 of your Pokémon used ${cond.attack} during your last turn`;
    case "yourBenchAtLeast":
      // The POSITIVE fact, in the printed noun — a note is read off the board by a
      // person, so it says what the player must HAVE and never repeats the
      // sentence's "4 or fewer". Reads as a floor because it is one.
      return `you have ${String(cond.count)} or more Benched Pokémon`;
    case "opponentBenchAtLeast":
      // 🆕🆕 D389 — a FULL ROUND TRIP, and the thing that made the seat parameter a
      // false economy: this fragment is the printed clause VERBATIM and is
      // byte-identical to its `CONDITIONAL_DAMAGE_CLAUSES` key, while the twin one
      // line up says "you have …" and can never say this. A `seat` field would not
      // have removed the second body — it would have moved this string and that one
      // into a branch inside a single arm, and paid a rename for the privilege.
      //
      // Built from the PARAMETER, so a second printed threshold is legible without a
      // second string. No pronoun to resolve, no timing word to drop and no card-face
      // glyph to spell out, which is why the round trip is available here at all.
      return `your opponent has ${String(cond.count)} or more Benched Pokémon`;
    case "yourOwnerPokemonInPlayAtLeast":
      // The printed sentence verbatim, prefix and all — the family's second FULL
      // round-trip (`youPlayedSupporterThisTurn`'s), because the clause names no
      // pronoun, no timing word and no card-face glyph.
      //
      // ⚠️ THE POSSESSIVE IS ADDED HERE AND IS NOT IN THE DATA, which is
      // `matchesFilter`'s convention and not this renderer's choice: `owner` is
      // the BARE subgroup name ("Team Rocket"), and the `ownerPokemon` arm builds
      // `${owner}'s ` to test the card name. Storing "Team Rocket's" instead would
      // mean two spellings of one subgroup across two files.
      return `you have ${String(cond.count)} or more ${cond.owner}'s Pokémon in play`;
    case "yourPokemonKoedOnOpponentsLastTurn":
      // The printed clause verbatim — the family's THIRD full round-trip, and it
      // keeps the possessive "your opponent's last turn" that the predicate turns
      // into `turn - 1`. A reject/tooltip fragment is read by a PERSON looking at
      // the board, and "the previous turn" is engine vocabulary: the player knows
      // whose turn it was, and the printed phrasing is the one on the card in
      // their hand. This is the one place where NOT resolving the possessive is
      // the D116-correct move, because nothing here is a pronoun without a
      // referent.
      //
      // 🆕 D326 — and the two narrowings round-trip too, each into the exact
      // words its cards print: the owner prefix sits inside the possessive noun
      // phrase ("your Team Rocket's Pokémon") and the cause sits between the
      // verb and the window ("were Knocked Out by damage from an attack during
      // …"). Assembled in printed order rather than appended, so Ethan's Pinsir
      // — which prints BOTH — renders its own sentence and not a concatenation
      // of two fragments.
      return `any of your ${cond.owner === undefined ? "" : `${cond.owner}'s `}Pokémon were Knocked Out ${cond.byAttack === undefined ? "" : "by damage from an attack "}during your opponent's last turn`;
    case "youGoSecond":
      // A ROUND-TRIP, and the family's cleanest since `youPlayedSupporterThisTurn`:
      // the printed subject is already "you" (which is what a seat-relative
      // predicate means), there is no pronoun to resolve (D116), no timing word to
      // drop and no card-face glyph to spell out. The printed clause verbatim.
      return "you go second";
    case "allOf": {
      // 🛑 THE COMBINATOR'S HARD ARM, AND IT DOES *NOT* ROUND-TRIP — SAY SO HERE
      // RATHER THAN LET THE NEXT AUTHOR DISCOVER IT FROM A REJECT MESSAGE.
      // Every other member of this family renders a printed FRAGMENT; joining two
      // fragments needs a conjunction word, and the printed sentence does not
      // supply one in a reusable place. Call Bell `sv08-165` prints
      //
      //   "You can use this card only if you go second, and only during your
      //    first turn."
      //
      // — the conjunction is ", and only", where the second "only" belongs to the
      // SENTENCE'S scaffolding rather than to either conjunct, and the comma
      // belongs to the printed clause boundary. `cardplay.ts` wraps the result as
      // "<card> can only be used if <note>", which already owns one "only", so
      // this yields
      //
      //   "Call Bell can only be used if you go second and it is your first turn"
      //
      // — READABLE and TRUE, and NOT the printed bytes. That is the deliberate
      // trade: a reject message is read off the board by a person, the same call
      // `yourEnergyInPlayAtLeast` makes when it spells "{D}" as "Darkness".
      //
      // ⚠️ THE JOIN IS " and " AT EVERY ARITY, INCLUDING 3+, WHERE ENGLISH WOULD
      // WANT "A, B, and C" (`printedList`'s shape, three lines down, for the
      // count lists that do print at arity 3). No printed sentence in the pool is
      // a 3-way conjunction of CLAUSES — the Simisage triple is three NAMES in
      // one clause, and it is 0-legal and unbuilt — so the Oxford form would be
      // untested scaffolding for a sentence nobody prints. If arity 3 ever lands,
      // route this through `printedList`'s idiom rather than inventing a second.
      return cond.conditions.map(conditionNote).join(" and ");
    }
    case "yourFirstTurn":
      // The printed clause verbatim, minus the "Once during" that belongs to the
      // once-per-turn lock rather than to the gate. The possessive stays for the
      // arm above's reason: a person reading a reject looks at the card in their
      // hand, and "it is your first turn" is the phrase printed there. There is
      // no pronoun to resolve (D116) — "your" is the reader, and this note is
      // always shown to the seat the condition was evaluated for.
      return "it is your first turn";
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
    both of which only these sites know.

    ⚠️ D243 — AND A FOURTH TERM THAT IS NOT A `passivesOf` FOLD AT ALL. The three
    above all live on the ATTACKER's own body (its printed passive, its Tools, its
    Energy); the seat-wide aura ("Attacks used by your Pokémon do 20 more damage to
    your opponent's Active Pokémon") is printed on ONE body and paid to EVERY body
    the seat owns, so it is a board scan (`seatPreWRDamageBonus`) and not a fold.
    It is summed HERE rather than at the two call sites for this function's whole
    reason — one number, one §8.5 step, evaluated once — and it lands inside the
    returned total rather than beside it because it is `damageBonusBeforeWR`'s
    sentence with a different subject: same step, same sign, same §9-suppressible
    catalog channel, and the same `DAMAGE_DEALT.bonus` field is the right home for
    it (contrast `boostedAttackDamage`, which is a turn-stamped INSTALLATION and
    must be immune to a §9 lock, and so is summed at the site instead).

    ⚠️ THE ATTACKER'S CARD IS RESOLVED HERE AND NOT PASSED IN, which keeps both
    call sites at a ZERO signature diff — `pokemon` is already the attacking body
    and `topCardOf` is the same read `passivesOf` makes on the line above. */
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
  // D245 — the defender's card now crosses too, for the aura's `target` rider.
  // Both call sites still take a ZERO signature diff: `defenderCard` is already
  // this function's fourth parameter (Choice Belt's suffix read, two lines up).
  return bonus + seatPreWRDamageBonus(state, seat, topCardOf(state, pokemon), defenderCard);
}

/** 🆕 D358 — **DID THE ANSWER NAME A POKÉMON?** The `pokemon` choice carries an
    OPTIONAL ref since this slice, because an absent one is the printed decline of
    an *"up to N"* park (see `EffectChoice`), so every site that used to read
    `choice.kind === "pokemon"` now has a second question to ask. It is asked ONCE,
    here, rather than as nine copies of the same conjunction — and as a narrowing
    predicate rather than a bare boolean, so each call site keeps reading
    `choice.ref` with no non-null assertion and no re-check.

    ⚠️ **EIGHT OF THE NINE CALL SITES CANNOT SEE A DECLINE TODAY, AND THAT IS A
    VALIDATOR GUARANTEE RATHER THAN A TYPE ONE.** `attachEnergyFrom` is the only op
    that sets `declinable`, and `validateChoice` refuses a ref-less answer to every
    prompt without it — so switch / gust / returnBenched / healChosen / the two
    counter moves / both evolve-body continuations reach their `: state` ending on
    this predicate only through a path the wire cannot open. They are written
    anyway, and NOT as unreachable branches (D205's rule): this predicate is the
    same shape as the `choice.kind` test it replaces, which is itself a
    validator-unreachable belt at all nine sites. What is refused is a NEW arm
    saying something different per op — a decline moves nothing, everywhere, and
    the one ending they already share says exactly that. */
function pickedPokemon(
  choice: EffectChoice,
): choice is { kind: "pokemon"; ref: PokemonRef; take?: number } {
  return choice.kind === "pokemon" && choice.ref !== undefined;
}

/** A targeting op: no candidate = no-op, one = forced (auto-resolve), ≥2 = park
    on a choosePokemon prompt — **unless the print says the pick may be refused,
    in which case ONE candidate parks too.**

    🆕🆕 D358/D359 — the three arms below were, until D358, the whole reason
    the printed *"attach **up to** N"* was over-resolved: none of them is a
    decline. The zero arm is a silent no-op (there was nothing to ask), the one
    arm is the M1 no-choice rule, and the ≥2 arm parked a prompt whose only
    legal answer was a ref. `upTo` does not add a fourth arm — it moves
    the BOUNDARY between the second and the third, because that boundary is the
    only thing the M1 rule was ever about. */
function parkOrForce(
  state: GameState,
  candidates: PokemonRef[],
  apply: (ref: PokemonRef) => GameState,
  note: string,
  /** D227 — the seat that ANSWERS, when it is not the controller
      (`opponentSwitchOut`: the printed "(Your opponent chooses the new Active
      Pokémon.)"). Threaded through this helper rather than hand-built at the op,
      because the M1 no-choice rule has to apply to a cross-seat park exactly as
      it does to an own-seat one: a lone benched body is not a decision whoever
      would have made it, and forcing it here is what keeps a one-body board from
      handing the turn to the other player for a question with one answer.

      ⚠️ ABSENT-WHEN-UNDEFINED, so every one of the seven existing callers produces
      a byte-identical result to the pre-D227 one — the same rule
      `settleProgram` applies one level up when it decides whether to file
      `phase.answerer`. */
  decider?: Seat,
  /** 🆕🆕 D359 — the printed CEILING: this pick may take `0..upTo` of whatever the
      op moves. `1` is D358's decline (take the one, or take none); `N ≥ 2` is
      `attachEnergyFrom.count`'s *"attach up to N … to ONE named body"*.

      ⚠️ **IT MOVES THE FORCED ARM, AND THAT IS THE WHOLE OF WHAT IT DOES HERE.**
      The M1 no-choice rule auto-applies a lone candidate because a question with
      one answer is not a question — true of a MANDATORY pick and false of this
      one, where a single offered body still leaves `upTo + 1` answers.
      So a park with a ceiling asks at EVERY non-empty candidate set.
      **D47 decided this exact question for `choosePokemonMulti` and its review
      REVERSED the first draft on it**: honouring the right only above the
      auto-resolve threshold honours it *"exactly where declining matters
      least"*, since that is the board where the player has the most other
      outs. The zero arm is untouched — a decline and a whiff produce the same
      board, and asking a question with no candidates is not a decision either.

      🆕 **AND THIS IS THE ARM THAT REACHES THE `toSelf` PRINTINGS AT ALL.**
      *"attach up to 2 … to **this Pokémon**"* offers ONE candidate by
      construction, so before D359 seven legal printings resolved their printed
      ceiling without ever asking the controller anything.

      ⚠️ ABSENT-WHEN-UNDEFINED, like `decider` above it, so all eight mandatory
      callers produce a byte-identical result to the pre-D358 one: no argument,
      no key on the prompt, the same forced arm at one candidate. */
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
    case "searchDeck": {
      // 🆕🆕 D502 — THE §9.2 FILING, AND IT COMES OFF `searchMove`'s OWN `moved`
      // RATHER THAN OFF `choice.uids` — `retrieveMove`'s rule one op over, verbatim:
      // a wire-dropped uid (one no longer in the deck) never moved, and a
      // Bench-bound answer is additionally clamped to `benchSpace` inside that
      // function, so the answer and the movement are two different sets. A
      // non-`cards` answer files `[]` for the same reason the whiff path does.
      if (choice.kind !== "cards") {
        recordMoved(record, op.recordAs, []);
        return state;
      }
      const searched = searchMove(state, choice.uids, op.dest, op.reveal, ctx, events);
      recordMoved(record, op.recordAs, searched.moved);
      return searched.state;
    }
    case "evolveFromDeck":
      return choice.kind === "cards"
        ? evolveFromDeckMove(state, choice.uids, ctx, events, op.onto, op.names)
        : state;
    case "evolveFromDeckChosen":
      // 🆕 D309 — the BODY answer moves nothing at all: what it buys is the op that
      // asks for the card, and an op cannot reach the work queue from here
      // (`optional`'s arm below states the reason). `continuationOps` owns that
      // half. This arm exists so the switch stays exhaustive and so the answer has
      // one unambiguous effect on the board — none.
      return state;
    case "evolveFromDeckEachChosen":
      // 🆕 D315 — the MULTI answer moves nothing either, and for D309's reason
      // exactly: what it buys is N ops, and an op cannot reach the work queue from
      // here. `continuationOps` owns that half. The arm is spelled separately from
      // D309's rather than folded into it because the two ops answer DIFFERENT
      // choice kinds, and a shared arm would have to say so anyway.
      return state;
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
      return choice.kind === "cards" ? revealFromTop(state, choice.uids, op, ctx, events) : state;
    case "reorderTop": {
      // 🆕 D341 — THE ANSWER'S POSITIONS ARE THE EFFECT. `validateChoice` has
      // already established that `choice.uids` is a permutation of the offered
      // window, so the splice is unconditional: the first `uids.length` cards of
      // the owner's deck are REPLACED by the answer in the answer's own order,
      // and everything under the window is untouched.
      //
      // 🛑 NO EVENT HERE, AND THE ABSENCE IS THE EVENT's OWN RULE. The
      // `DECK_TOP_REORDERED` row was pushed when the op PARKED, because what it
      // reports is the LOOK — the information transfer — and that happened
      // whether or not this resolve is ever reached. A second row here would
      // claim the deck top was read twice.
      if (choice.kind !== "orderCards") return state;
      const owner = reorderTopOwner(ctx.seat, op);
      const deck = state.players[owner].deck;
      // Re-sliced off the LIVE deck rather than trusted from the answer's length:
      // nothing between the park and the resolve can move this deck (the phase is
      // an interrupt), and re-deriving costs one line and cannot go stale.
      //
      // 🆕 D343 — the bottom fork is the SAME splice with the two halves swapped:
      // everything ABOVE the window is untouched and the answer becomes the last
      // `uids.length` cards, in the answer's own order. Written off
      // `deck.length - choice.uids.length` rather than off `op.n`, for the reason
      // the top arm re-slices at all — the LIVE window is the one that was
      // offered, and a short deck made `top.length < op.n` at park time.
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
    case "payFromHand": {
      if (choice.kind !== "cards") return state;
      const paid = payFromHandApply(state, choice.uids, op, ctx, events);
      recordMoved(record, op.recordAs, paid.paid);
      return paid.state;
    }
    case "opponentDiscardsFromHand":
      // 🆕🆕 D426 — THE ANSWER COMES FROM THE *OPPONENT*, AND THE APPLY MOVES CARDS
      // ON THEIR SIDE OF THE TABLE. `ctx.seat` is still the controller (the context
      // is the program's owner and never the answerer — see `EffectContext`), so
      // the owner is re-derived here exactly as the park derived it. Reading the
      // seat off the answer instead is the thing this line exists to not do.
      //
      // ⚠️ `validateChoice` has already checked membership and count against the
      // PROMPT (cardplay.ts), and the phase's `answerer` gate has already refused
      // the controller's frame — so a uid reaching here is one of the offered
      // cards. The helper still re-reads the LIVE hand, which is the retrieval
      // rule this file applies everywhere: what MOVED is what the event names.
      return choice.kind === "cards"
        ? discardChosenFromHand(state, otherSeat(ctx.seat), choice.uids, events)
        : state;
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
      // D206 — the resumed half records exactly as the forced half does, and for
      // `attachFromDeck`'s stated reason: what MOVED, never what was offered or
      // picked. A wire answer that named a body `switchInto` then refused would
      // otherwise file a switch that did not happen.
      return pickedPokemon(choice)
        ? switchRecording(op, (into) => switchOwn(state, choice.ref, ctx, into), events, record)
        : state;
    case "gust":
      return pickedPokemon(choice)
        ? switchRecording(op, (into) => gust(state, choice.ref, ctx, into), events, record)
        : state;
    case "knockOutChosen":
      // 🆕🆕 D416 — the resumed half, and it is the SAME call the forced half makes
      // (`doomBodyAt` with D414's marker), which is the whole point of routing both
      // through one helper: a forced Knock Out and an answered one are byte-
      // identical boards. `doomBodyAt` re-reads the named spot and no-ops on a wire
      // answer whose body has since left play — `returnBenched`'s trust level one
      // arm down, and the reason no re-validation is spelled here.
      //
      // ⚠️ NO §11 ASK ON THIS PATH EITHER. The shield filtered the CANDIDATES
      // before the prompt was ever written, and `validateChoice` refuses any ref
      // that is not among them, so a shielded body cannot reach this line.
      return pickedPokemon(choice)
        ? doomBodyAt(state, choice.ref, koByEffectMarker(state.turn))
        : state;
    case "returnBenched":
      // 🆕 D299 — the resumed half. NO `recordAs`: this op is on neither side of
      // any printed "If you do", and the two cards that would need one (Poliwrath
      // `sv06-043`, Gholdengo `sv08-131`) name the ACTIVE and are refused for
      // that, not for the record. The ref is trusted exactly as far as the two
      // arms above trust theirs — `returnBenched` re-reads the bench slot and
      // no-ops on a wire answer whose body has since left play.
      return pickedPokemon(choice) ? returnBenched(state, choice.ref, op, ctx, events) : state;
    case "opponentSwitchOut":
      // D227 — the resumed half of the case above, and at D228 it is that case
      // VERBATIM: `ctx.seat` is still the CONTROLLER here (the program's owner;
      // `resolveEffect` hands `phase.seat` to `settleProgram`, not the answerer),
      // so `gust`'s own `otherSeat` lands the move on the seat that just answered
      // — which is the same board the park offered.
      //
      // ⚠️ THE RECORDING IS ON **BOTH** ARMS AND THAT IS NOT SYMMETRY FOR ITS OWN
      // SAKE. This is the arm a real Grimmsnarl board takes — the opponent has ≥2
      // benched bodies, so the op PARKS and the forced apply never runs — so an
      // omission here would file nothing on precisely the boards the printed
      // "If you do" is interesting on, and the 160 would silently vanish behind a
      // gate reading an empty slot. Driven on a two-body Bench.
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
      return pickedPokemon(choice)
        ? healChosen(state, choice.ref, op.amount, ctx, events)
        : state;
    case "moveCountersToDefender":
      // D138 — the parked half of the counter move. Same shape as `healChosen`'s
      // single-pick arm above and for the same reason: `validateChoice` matches
      // the answer against the PARKED prompt, so the wrong choice kind is the
      // wire belt rather than a case that can fire in a real match.
      return pickedPokemon(choice)
        ? moveCountersToDefender(state, choice.ref, ctx, events)
        : state;
    case "moveCountersChosen": {
      // D216 — the two parks of one sentence, told apart by the same field
      // `stepOp` branches on. The SOURCE answer moves nothing at all: what it
      // buys is the op that asks question two, and an op cannot reach the queue
      // from here (`optional`'s arm above states the reason) — `continuationOps`
      // owns that half. The DESTINATION answer is the whole move.
      const chosen = op.fromBench;
      if (!pickedPokemon(choice) || chosen === undefined) return state;
      return moveCountersFromBench(state, chosen, choice.ref, ctx, events);
    }
    case "damageChosen":
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
            // D140 — the provenance rides the PARKED op, so the row a resumed
            // pick emits says the same thing an inline one would.
            op.source,
            ctx,
            events,
          )
        : state;
    case "attachEnergyFrom":
      // 🆕 D358 — **THE DECLINE IS THE ABSENT REF, AND IT MOVES NOTHING.** This is
      // the one arm in this switch that can actually receive one: `validateChoice`
      // refuses a ref-less answer to every prompt that did not carry a ceiling,
      // and `op.count`/`op.declinable` are the only things that set one. The board
      // is returned untouched — same ending as the op's whiff, which is what
      // *"attach up to 2"* with a player answering "none" means. No event: nothing
      // moved, and a row saying so would claim an attach that did not happen.
      // 🆕🆕 D359 — **AND THE MIDDLE ANSWERS RIDE THE SAME REF**, as `choice.take`.
      // This is the ONLY arm in this switch that reads it: the other eight parks
      // move a Pokémon rather than a countable batch onto one, so a quantity on
      // their answers would have no referent. Absent = the whole batch, which is
      // why the pre-D359 wire frame still means what it always meant.
      return pickedPokemon(choice)
        ? attachEnergyFrom(state, op, choice.ref, ctx, events, record, choice.take)
        : state;
    case "attachFromTop":
      return choice.kind === "attachCards"
        ? attachFromTopApply(state, choice.assignments, op, ctx, events)
        : state;
    case "attachFromHand":
      // D247 — no `recordAs` on this op, so unlike its deck-searching twin below
      // there is nothing to file: the attached uids are the return value nobody
      // asks for. The zone is the ONLY argument that differs.
      return choice.kind === "attachCards"
        ? attachFromZoneApply(state, choice.assignments, "hand", ctx, events).state
        : state;
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
      // 🆕 D443 — the OP is threaded so the apply can ask `moveBoardSeat` rather
      // than re-deriving the side from the answer's refs. The refs came off the
      // WIRE; the op is the engine's own value, and which board this move happens
      // on is a fact about the card, not about the frame.
      return choice.kind === "moveEnergy"
        ? moveEnergyApply(state, choice.picks, op, ctx, events)
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

/** 🆕🆕 **D429 EXPORTED THIS, AND THE EXPORT IS SAFE FOR THE SAME REASON THE
    PRE-DAMAGE SEAM EXISTS: IT RETURNS A BOARD.** Row 74 of the attack corpus prints
    *"…If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is
    now Paralyzed."* — a §12 condition applied BEFORE the damage step, conditioned on
    what the pre-damage act just did. `attack.ts`'s `applyAttackPreDamage` calls this
    directly rather than re-deriving the rule, so the two §12 gates below (§11's
    `effectRefused` and the printed `statusImmunities`) are asked ONCE in the engine
    instead of twice.

    🛑 **AND IT IS NOT A HOLE IN THE "NO PARK BEFORE DAMAGE" PROPERTY.** This function
    is TOTAL and synchronous: `GameState` in, `GameState` out, no `RunResult`, no
    prompt, no continuation. Calling it from the pre-damage seam therefore cannot
    introduce the one thing that seam forbids. That is the check to re-run before
    exporting any other op implementation to it — the op's own SIGNATURE, not its
    behaviour today.

    ⚠️ The `op` argument is constructed by the caller rather than lifted out of a
    program, and it never reaches `phase.cont`: the pre-damage seam never parks, so
    no `EffectContinuation` is written and `MATCH_RECORD_VERSION` is untouched. */
export function applyStatus(
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
  // than on the "defender" arm, so it is total over both targets.
  //
  // 🛑 **D430 — THE SENTENCE THAT USED TO END THIS PARAGRAPH WAS TRUE WHEN IT WAS
  // WRITTEN AND FALSE FROM D260 ONWARD.** It read *"the `self` arm can never be
  // refused in practice (a block is live only during its holder's OPPONENT's turn,
  // and the self arm runs on the holder's own)"*. That reasons about the INSTALLED
  // block, which was the only channel this gate had at D142; D260 added the AURA
  // channels, which carry no clock, so a `target: "self"` status on an attacker
  // wearing Mist Energy `sv05-161` WAS refused — a self-inflicted Special Condition
  // the attacker's own card cancelled, which no printing says. `effectRefusedOn`
  // now answers `false` for `seat === ctx.seat` on the attack channel too, off the
  // printed source clause every one of those auras carries, so the arm is refused by
  // the FUNNEL rather than by a claim in this comment. Dated rather than silently
  // rewritten (D423): rotted, not wrong-when-written.
  if (effectRefused(state, seat, ctx, events)) return state;
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
  // 🆕🆕🆕 D501 — CONFUSION CARRIES AN AMOUNT, exactly as Poison does eleven lines
  // up, and this arm exists for the same two reasons: the `?? DEFAULT` resolves
  // the op's OPTIONAL rider into the board's REQUIRED field, and the write is
  // UNCONDITIONAL. ⚠️ THE UNCONDITIONAL WRITE IS THE LOAD-BEARING HALF. It is what
  // stops a raised amount outliving the Confusion that carried it: a body
  // Confused at 80, cured (retreat / evolve / bench / `clearStatus`, all of which
  // go through `noConditions()`) and Confused again by a bare sentence reads 30,
  // because THIS line put it back. A `if (op.confusionDamage !== undefined)` guard
  // would leave the 80 standing on a spread-clear path and the next bare
  // Confusion would silently inherit it — driven in `confusionDamage.test.ts` §4
  // rather than argued.
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
function preventRetreat(
  state: GameState,
  op: Extract<EffectOp, { op: "preventRetreat" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // 🛑 D412 — THE OPERAND ORDER IS NOT `preventAttack`'s, AND THE TWO ARE ONE
  // FUNCTION APART. That op spells its FAR side and this one spells its NEAR side,
  // because they shipped from opposite ends: `preventAttack` arrived self-first, so
  // bare means SELF there; this one arrived defender-first, so bare must still mean
  // the OPPONENT here. Copying the sibling's ternary across without swapping the
  // operands silently inverts every one of the 35 shipped bare printings.
  //
  // ⚠️ THE EXPRESSION IS DESCRIBED RATHER THAN QUOTED, WHICH IS D210's RULE AND IT
  // PAID HERE: a doc block reproducing the line at its own indentation is a second
  // occurrence, and the mutant anchored on it would edit PROSE and survive.
  const seat = op.target === "self" ? ctx.seat : otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  // §11 (D142) — the target's own block refuses this rider, which on the bare arm
  // is the sharpest instance of the mirror: one durated block installed on the
  // defender, another installed on the attacker, and the second one refuses the
  // first. Checked BEFORE the idempotence early-return so a refusal is announced
  // even on an already locked body.
  //
  // ⚠️ THE SELF ARM ASKS IT TOO, AND THAT IS `preventAttack`'s SHIPPED ANSWER
  // INHERITED RATHER THAN RE-DERIVED. D148's self arm resolves `effectRefused`
  // against its own seat for the identical shape, so diverging here would be a
  // silent rules call made by the newer of two twins. If that reading is wrong it
  // is wrong in both places, which is the honest way to be wrong.
  //
  // 🛑 **D430 SETTLED IT, AND THE READING WAS WRONG IN BOTH PLACES — WHICH IS
  // EXACTLY WHY IT WAS WRITTEN THAT WAY.** Every §11 printing names the attack's
  // source and every one of them names the holder's OPPONENT, so a self-imposed
  // retreat lock is refused by nothing. Both twins still ASK, byte-unchanged; the
  // answer is now `false` by construction because `effectRefusedOn` carries the
  // own-side rule on the attack channel. The refusal moved into the funnel instead
  // of into two call sites, which is the single-read contract (D222).
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

/** §7.1/§7.2 (D283) — bar the OPPONENT from playing `cards` from their hand for
    exactly their next turn ("Your opponent can't play any Supporter cards from
    their hand during their next turn." — Scream Tail ex; "During your opponent's
    next turn, they can't play any Item cards from their hand." — Galvantula ex,
    Budew, Frillish). The ONE writer of `GameState.handPlayLockedTurn`.

    🛑 **`state.turn + 1` AND NOT `+ 2`, AND THE NUMBER IS DECIDED BY WHOSE TURN
    IT IS.** `preventAttack` one function down stamps `+ 1` on the DEFENDER and
    `+ 2` on itself, because "their next turn" and "your next turn" are one round
    apart; every printing of THIS sentence says *their*, so the window is the
    seat that plays next (§5.3: an attack ends the turn and `turnTail` queues
    `startTurn(otherSeat)`), which is `state.turn + 1` by construction.

    🛑 **NO `effectRefused` GATE, AND THAT IS A RULES DECISION RATHER THAN AN
    OMISSION.** `preventRetreat` directly above, `preventAttack` and
    `weakenDefenderAttacks` all ask it, because each is an effect of an attack
    done TO THE DEFENDING POKÉMON and a §11 "prevent all effects of attacks done
    to this Pokémon" block refuses exactly those. This op touches no
    `InPlayPokemon` at all: its object is the opponent's HAND, which no block
    printed on a body shields. Asking would install a bug in the shape of a
    safety check — a Mew ex behind a block would silently keep its Supporters.

    NO ACTIVE-SPOT PRECONDITION either, and that is the same fact from the other
    side: every sibling above returns early on `active === null` because it has
    nowhere to write. This one writes to the seat, so a barred player with an
    empty Active Spot (mid-KO, awaiting a promotion) is barred all the same.

    IDEMPOTENT BY THE STAMP, not by an early return: two installs in one turn
    compute the same `state.turn + 1`, so the second write is the value the first
    one left. The row is emitted each time, which is honest — two attacks really
    did print the sentence — and no board in this catalog can reach it (an attack
    ends the turn), so an early return would be a line that cannot go red. */
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
    are one attack each.

    ⚠️ D239 MADE THAT COMPARISON STRUCTURAL, AND IT WAS A LIVE DEFECT THE MOMENT
    THE FIELD BECAME A RECORD. `existing.fromClass === fromClass` was exact while
    the field was a string literal; against two `AttackerClass` records it is
    REFERENCE equality, so two installs of the SAME printed class would have
    "disagreed" and collapsed to an unfiltered block — a silent WIDENING, which is
    the one direction this family's merge rule is written to forbid.

    ⚠️ D240's `maxDamage` MERGES ON `fromClass`'s RULE VERBATIM, because it narrows
    on the same side: two installs keep the cap only when they AGREE, and any
    disagreement (including one side having no cap at all) collapses to the
    UNCAPPED block. That is the family's one rule stated a third time — a second
    installation may never leave the holder with less protection than one of them
    printed — and it is why the merge is NOT `Math.max` of the two caps: a 40-cap
    and an uncapped install have no maximum to take, and the uncapped one is
    already the wider of the two. Unreachable in this pool for the reasons above
    (no card prints two of these attacks; the three capped printings are one
    attack each). */
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
  // D240 — the same rule on the cap axis. A plain `===` is exact here and does not
  // need `sameAttackerClass`'s field-by-field twin: `maxDamage` is a NUMBER (or
  // absent), so value equality and `undefined === undefined` both already say the
  // right thing. That is precisely the difference D239 found the hard way when
  // `fromClass` stopped being a primitive.
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

/** Do two `AttackerClass` records name the SAME printed class? The one place the
    §11 merge rule asks it, and a field-by-field read rather than a `JSON.stringify`
    compare: key ORDER is not part of the value, and one produced by the deriver
    and one read back off a persisted record need not agree on it.

    ⚠️ Both sides are ABSENT-able (`undefined` = "refuses every attacker"), and
    `undefined === undefined` is the right answer for exactly the reason the merge
    rule wants: two unfiltered installs agree, so the block stays unfiltered
    rather than being "narrowed" to nothing. */
function sameAttackerClass(a: AttackBlock["fromClass"], b: AttackBlock["fromClass"]): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.stage === b.stage && a.excludingType === b.excludingType;
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
  if (effectRefused(state, seat, ctx, events)) return state;
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

    🆕🆕 **D421 ADDS A FOURTH KIND OF ENTRY AND BOTH PREDICATES ABOVE HAD TO
    BRANCH — NEITHER WAS FREE, AND EITHER ONE ALONE IS THE DEFECT.** *"This
    Pokémon can't use Blaze Blitz again until it leaves the Active Spot."* (5
    legal printings, Gouging Fire ex) installs `until: "leavesActive"`, an entry
    with NO window: its `turn` is the install turn and is provenance only.
      • the PRUNE would collect it on the very next write, because that number is
        behind `now` from the following turn onwards — a live, unbounded bar
        deleted by the rule that exists to bound the list;
      • the IDEMPOTENCE KEY would miss it, because the pair (turn, index) calls a
        re-install on a later turn a NEW fact — appending a duplicate the two
        payability projections publish as a repeated index and the log as a second
        row about a bar the player already has.
    Both are driven (`untilLeavesActiveBar.test.ts` §6), and the pair is why the
    rider is checked in two places in one function rather than folded into one.

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
  until?: "leavesActive",
): LockedAttack[] | null {
  // 🆕🆕 D421 — THE IDEMPOTENCE KEY IS TWO KEYS, BECAUSE THE TWO KINDS OF ENTRY
  // ARE ADDRESSED DIFFERENTLY. A turn-stamped bar is identified by the PAIR
  // (turn, index) — that is D142's answer and every writer above relies on it. An
  // `until: "leavesActive"` bar has no window, so the same fact re-installed on a
  // later turn carries a DIFFERENT `turn` and the pair would call it new: the key
  // is the INDEX and the rider alone. Comparing the turn there would append a
  // second entry meaning exactly what the first one means, which the two
  // payability projections would then publish as a duplicated index and the log as
  // a second row telling a player about a bar they already have.
  const duplicate =
    until === undefined
      ? (lock: LockedAttack) =>
          lock.until === undefined && lock.turn === turn && lock.attackIndex === attackIndex
      : (lock: LockedAttack) => lock.until === until && lock.attackIndex === attackIndex;
  if (existing.some(duplicate)) return null;
  // 🆕🆕 D421 — …AND THE PRUNE EXEMPTS THE SAME ENTRIES, FOR THE OPPOSITE REASON.
  // The garbage rule below is sound only because a stamp names a turn that will
  // eventually be behind `now`; an unbounded bar's `turn` is the INSTALL turn and
  // is behind `now` from the very next write, so pruning by it would GARBAGE-
  // COLLECT A LIVE BAR — D165's own defect a third time, this time in the rule
  // that was written to bound the list. It stays bounded anyway: a body carries at
  // most one such entry per attack index, and §10 sheds the whole list the moment
  // it leaves the Active Spot, which is the only thing that ends this bar at all.
  const kept = existing.filter((lock) => lock.until === "leavesActive" || lock.turn >= now);
  return [...kept, until === undefined ? { turn, attackIndex } : { turn, attackIndex, until }];
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
  const attackIndex = printedAttackIndex(printed, attack);
  if (attackIndex < 0) return state;
  // The one rule, D143's: the window is the holder's own next turn, and declaring
  // an attack ENDS the turn (§5.3), so the turn after this one is the opponent's
  // and the one after THAT is the holder's.
  // 🆕🆕 D421 — …and when the printed duration is "until it leaves the Active
  // Spot" there is no window to stamp, so the number recorded is the INSTALLING
  // turn and it is PROVENANCE ONLY: the rider short-circuits the reader, the prune
  // and the idempotence key alike (types.ts `LockedAttack.turn`). `state.turn` and
  // not `state.turn + 2` deliberately — a build that lost the rider then writes a
  // bar stamped for a turn its holder has already spent, which never bites once,
  // where `+ 2` would have degraded quietly into D154's next-turn lock.
  const turn = until === undefined ? state.turn + 2 : state.turn;
  const locks = addLockedAttack(active.lockedAttacks, state.turn, turn, attackIndex, until);
  if (locks === null) return state;
  // The RESOLVED row's own name and not the op's token: the two differ only in
  // punctuation (the op's is folded, the card's is as printed), and a log row is
  // read by a player holding the card — so it prints the card's spelling.
  // 🆕🆕 D421 — and the RIDER rides the row too, because the row's wording is a
  // claim about WHEN: `log.ts`'s "can't use X next turn" is FALSE of an unbounded
  // bar in the direction that makes a player wait one turn and press a button the
  // server will still refuse. Same key, same value, third surface (events.ts).
  events.push({
    type: "ATTACK_LOCKED",
    seat: ctx.seat,
    uid,
    attack: printed[attackIndex]?.name ?? attack,
    ...(until === undefined ? {} : { until }),
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

/** 🆕🆕 §8.5/§11 (D432) — INSTALL the printed NO-WEAKNESS bar on the CONTROLLER's
    own Active ("During your opponent's next turn, this Pokémon has no Weakness.",
    3 legal printings, 1 sentence). `reduceDamage`'s SIBLING and written directly
    beneath it: same holder resolution ("this Pokémon" is `ctx.seat`'s Active),
    same absence of a `target` field, same no-park, same `state.turn + 1` stamp.

    THE STAMP IS `state.turn + 1` FOR `reduceDamage`'s REASON VERBATIM — the
    sentence prints "during your OPPONENT's next turn", declaring an attack ENDS
    the turn (§5.3), so the turn after the installing one is the opponent's by
    construction.

    ⚠️ IDEMPOTENT **BY THE STAMP**, WHICH IS `retreatLockedTurn`'s ANSWER AND NOT
    `reduceDamage`'s `Math.max`. That op merges because it holds a NUMBER and two
    installs can disagree about it; this record holds only a turn, so a second
    install in the same turn computes the same number and the write is the value
    the first one left. The early return is what suppresses the duplicate ROW —
    announcing a re-install that changed nothing would be announcing a non-event
    (D140/D146), the same rule `reduceDamage` states one function up. Unreachable
    off any printing (one attack per turn, and no card prints two of these), so it
    is constructed and pinned.

    ⚠️ NO `attackEffectRefused` CHECK, AND THAT IS `reduceDamage`'s AND
    `installRecoil`'s VERDICT AND NOT AN OMISSION. The record lands on the ACTOR's
    own Active, so there is no opponent-side body a §11 "prevent all effects of
    attacks done to this Pokémon" could be protecting from it. The §11
    classification table (preventBlock.test.ts) carries the verdict AND a board
    that drives it, which is D150's rule.

    ⚠️ AND THE READ IS SOMEWHERE ELSE ENTIRELY, which is the part a successor will
    want: this function only stamps. Both §8.5 sites that can apply Weakness —
    `attack.ts`'s main hit and `snipeActive` below — consult the stamp through
    `installedNoWeakness` (continuous.ts), and a build that widened one of the two
    passes every board that only swings the other. */
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
  if (effectRefused(state, seat, ctx, events)) return state;
  const turn = state.turn + 1;
  const existing = active.attackDamageDebuff;
  const stacking = existing !== null && existing.turn === turn;
  const merged = stacking ? Math.max(existing.amount, amount) : amount;
  if (stacking && merged === existing.amount) return state;
  events.push({ type: "ATTACK_DEBUFF_APPLIED", seat, uid, amount: merged });
  return withActive(state, seat, { ...active, attackDamageDebuff: { turn, amount: merged } });
}

/** 🆕🆕 §13 (D434) — SCHEDULE a counter placement onto the DEFENDING Pokémon for the
    END of the opponent's next turn (*"At the end of your opponent's next turn, put 9
    damage counters on the Defending Pokémon."* — 3 legal printings, corpus row 54).

    🛑 **THIS FUNCTION ONLY STAMPS, AND THAT SENTENCE IS THE WHOLE HAZARD OF THE
    SLICE.** Every other installer in this file writes a fact some existing read site
    was already going to consult; nothing in the engine reads this one. The
    placement, the event and the Knock Out all happen in flow.ts `runCheckup`, which
    goes looking for the stamp at the end of every turn. **A build that ships this
    half alone resolves, emits its row, persists its record and never places a
    counter** — D407's built-but-dead defect, and the reason both halves carry their
    own mutant row rather than one shared one.

    `weakenDefenderAttacks` DIRECTLY ABOVE IS THE TEMPLATE and the resemblance is
    deliberate: same `otherSeat(ctx.seat)` holder, same §11 gate ahead of the
    idempotence return, same `state.turn + 1` stamp, same `Math.max` merge. The one
    difference is what the record is FOR, and it is the difference between a fact and
    an appointment.

    THE STAMP IS `state.turn + 1` FOR `weakenDefenderAttacks`' REASON VERBATIM — the
    sentence prints *"your opponent's next turn"*, declaring an attack ENDS the turn
    (§5.3), so the turn after the installing one is the opponent's by construction.
    `runCheckup` compares it to `state.turn` as it stands, and the Checkup runs
    BEFORE `startTurn` increments (flow.ts `knockOut`'s note), so the stamped turn is
    live at exactly one Checkup and never again.

    🆕🆕 **D435 — THE BODY OF THIS FUNCTION MOVED TO `scheduleDelayed` BELOW, AND
    NOTHING ABOUT IT CHANGED.** The seat, the §11 ask, the `state.turn + 1` stamp,
    the `Math.max` merge and the suppressed-when-unchanged row are all still exactly
    what D434 wrote; they are shared with the two payloads D435 adds rather than
    copied into them, which is D416's rule (*"copying a function copies its mutants'
    anchors, and the corpus goes quiet rather than red"*). The paragraphs that used
    to sit here — the §11 derivation, the ask-at-the-install-not-at-the-Checkup
    reading and the `Math.max`-not-sum argument — live on `scheduleDelayed`, where
    the code they describe now is. */
function scheduleCounters(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  return scheduleDelayed(state, { kind: "counters", amount }, ctx, events);
}

/** 🆕🆕 §13 (D435) — SCHEDULE the printed DISCARD of the Defending Pokémon for the
    END of the opponent's next turn (*"At the end of your opponent's next turn,
    discard the Defending Pokémon and all attached cards."* — 1 legal printing,
    corpus row 53).

    🛑 **IT IS NOT THE KNOCK OUT ONE ROW DOWN, AND THE DIFFERENCE IS A PRIZE CARD.**
    §8.1 pays a Prize to *"the player who KO'd the Pokémon"*; this sentence prints
    *discard* and Knocks nothing Out, so it pays none. The two payloads look
    identical on the board — the body leaves play, the Active Spot empties, a
    promotion is owed — and differ on exactly the prize row. `scheduleDelayed` below
    is deliberately payload-BLIND about that: the difference lives in `runCheckup`,
    where one path calls `discardFromStack` and the other hands the body to §8.1.

    ⚠️ NO PAYLOAD BEYOND THE CLOCK, which is D432's question asked again rather than
    inherited: the printed sentence carries no amount, no filter and no narrowing, so
    the record member is `{ turn, kind: "discard" }` and there is nothing for a field
    to vary over (D104's minimal shape). */
function scheduleDiscard(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  return scheduleDelayed(state, { kind: "discard" }, ctx, events);
}

/** 🆕🆕 §13/§8.1 (D435) — SCHEDULE the printed KNOCK OUT of the Defending Pokémon
    for the END of the opponent's next turn (*"…At the end of your opponent's next
    turn, the Defending Pokémon will be Knocked Out."* — the TAIL of corpus row 113,
    2 legal printings, reached through `splitAttackTrailingClause`).

    🛑 **THIS ONE PAYS A PRIZE AND THE ROW ABOVE DOES NOT.** *"will be Knocked Out"*
    is §8.1's own words, so the Checkup hands the body to §8.1's sweep and every
    consequence — the Prize, the whole-stack discard, `KNOCKED_OUT`, the promotion —
    comes from the shipped seam rather than from here.

    ⚠️ **AND IT PLACES NO DAMAGE AT ALL, WHICH IS WHY THE CAUSE QUESTION IS RE-DERIVED
    AND NOT INHERITED FROM D434.** D434's payload puts damage counters on, so its
    Knock Out genuinely IS by damage and stamping D414's `koByEffect` marker would
    have denied a recoil that is owed. This payload is a Knock Out with NO damage —
    D414's marker's exact subject — so the firing site stamps it, under D433's
    `wasLethal` conjunct. The whole of that derivation lives at the firing site
    (`flow.ts runCheckup`), where the marker is written; this function only makes the
    appointment. */
function scheduleKnockOut(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  return scheduleDelayed(state, { kind: "knockOut" }, ctx, events);
}

/** 🆕🆕 §13 (D435) — the shared half of the THREE `schedule*` installers above: the
    seat, the §11 ask, the `state.turn + 1` stamp, the merge and the row. D434 wrote
    this body inline in `scheduleCounters` for one payload; three copies of it would
    be D416's hazard verbatim (*"copying a function copies its mutants' anchors, and
    the corpus goes quiet rather than red"*), so it is factored ONCE and the three
    callers are one line each.

    ⚠️ **THE §11 GATE AND THE `+ 1` STAMP ARE D434's, MOVED RATHER THAN RE-DECIDED**,
    and both are re-derived for the new payloads rather than inherited: a scheduled
    discard and a scheduled Knock Out are effects of an attack done TO the Defending
    Pokémon in the plainest possible sense, so a *"prevent all effects of attacks done
    to this Pokémon"* block refuses them exactly as it refuses the counters. The gate
    is asked HERE and not at the firing site, `koRecoilOf`'s never-hold-a-second-
    opinion rule: the doing is this line.

    🛑 **ONE APPOINTMENT PER BODY, AND THE MERGE IS KIND-AWARE.** Two counter
    schedules for one turn merge by `Math.max` — D434's answer, unchanged and for its
    reason (two schedules are two printed sentences, not one doubled one). A schedule
    of a DIFFERENT kind REPLACES what stood there, because the field holds one record
    and the alternative would be inventing a precedence order between three printed
    sentences that no rule states. Both cases need two attacks in one turn and are
    unreachable off any printing, so both are constructed and pinned rather than
    trusted (`delayedCounters.test.ts` §10).

    ⚠️ **THE ROW IS SUPPRESSED WHEN THE MERGE SAYS NOTHING NEW** (D142's idempotence
    answer, inherited from `scheduleCounters` and widened to the two payload-free
    members, for which "nothing new" is simply "the same kind for the same turn"). */
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

/** Do these two appointments say the same thing? The idempotence test
    `scheduleDelayed` suppresses its row on, spelled as a SWITCH over the payload
    rather than as a chain of `!==` (D222: a negated conjunction over union members
    is a closed-world assumption with no compiler behind it, while a member added to
    `ScheduledEffect` makes this stop compiling). */
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

/** §9/§11 (D152) — ARM the printed REACTIVE RECOIL on the CONTROLLER's own Active.

    🆕🆕 **D455 CORRECTED THIS PARAGRAPH IN PLACE. IT QUOTED A SENTENCE THE CATALOG
    DOES NOT PRINT** — *"…put **10** damage counters on the Attacking Pokémon."* at
    *"2 printings … Lycanroc ex sv02-117/-241"*. D454 found it; this is the
    correction, measured off `censusAttackCorpus.ts` rather than remembered.
    `\bAttacking Pokémon\b` over all 640 corpus sentences returns exactly THREE
    rows and none of them is a ten:

    | corpus line | printings | the number |
    |---|---|---|
    | 178 | **5** | *"…put **8** damage counters on the Attacking Pokémon."* |
    | 179 | 1 | *"…put **6** damage counters…"* (and "even if **this Pokémon** is") |
    | 180 | 2 | *"…put damage counters … **equal to the damage done to this Pokémon**"* |

    Line 178 is the family this op serves; lines 179 and 180 are a different amount
    and a scaled amount and are NOT claimed here. ⚠️ **THE CARD IDS ARE STATED AS
    UNRESOLVED, NOT REPAIRED** (D425): this checkout has no D1, so the sentence text
    and the printing counts are measurable off the committed corpus and the ids
    behind them are not. "Lycanroc ex sv02-117/-241" is left in the history rather
    than re-asserted — it was quoted against a sentence that does not exist, so it
    cannot be trusted to name the printings of the one that does.

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
  // 🆕🆕 D456 — the op's TWO inhabitants collapse into the record's TWO fields here,
  // and this is the only place that knows the mapping. The printed floor of the
  // unprinted member is 0: line 180 promises nothing but the hit.
  const floor = amount === "damageTaken" ? 0 : amount;
  const merged = stacking ? Math.max(existing.amount, floor) : floor;
  // 🛑 BOTH READS OF `existing` ARE GATED ON `stacking`, AND THE FLAG'S GATE IS THE
  // ONE THAT IS EASY TO DROP. A record whose window has PASSED is still sitting on the
  // body — D124's expiry is by arithmetic and nothing sweeps it — so an ungated
  // `existing.ofDamageTaken === true` would let a spent line-180 stamp turn a fresh FLAT
  // install into a scaled one two turns later. The `amount` read one line up has carried
  // that gate since D152; this one is new and needs it for the same reason.
  const wasTaken = stacking && existing.ofDamageTaken === true;
  const taken = amount === "damageTaken" || wasTaken;
  // ⚠️ THE SUPPRESSION NOW HAS TWO CONJUNCTS AND BOTH ARE LOAD-BEARING. D152's rule
  // is *say nothing when the merge says nothing new*; a flat 60 arriving on a body
  // already holding 100 moves no number and prints no row. But a `"damageTaken"`
  // install arriving on a body holding a flat 100 moves the FLAG while leaving the
  // floor alone, and that is emphatically news — the trap stops being capped.
  if (stacking && merged === existing.amount && taken === wasTaken) return state;
  events.push({
    type: "RECOIL_ARMED",
    seat: ctx.seat,
    uid,
    amount: merged,
    // ⚠️ THE SAME SPELLING AND THE SAME OMISSION RULE AS THE RECORD BELOW (D421's
    // "same fact, same spelling, every surface"), because the row would otherwise
    // announce a 0-damage counterattack on the one printing whose amount is unknown
    // until it fires. `log.ts` has the second arm.
    ...(taken ? { ofDamageTaken: true } : {}),
  });
  return withActive(state, ctx.seat, {
    ...active,
    // ⚠️ THE KEY IS OMITTED RATHER THAN WRITTEN `false` — `ofDamageTaken?: true` has
    // exactly two inhabitants and `undefined` is one of them, so a `false` would be a
    // second spelling of absent in a PERSISTED record (types.ts).
    installedRecoil: { turn, amount: merged, ...(taken ? { ofDamageTaken: true } : {}) },
  });
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
    why the two auras still sit on one `||` at all four sites.

    It takes the DAMAGE too, since D240: a block may be capped at "40 or less", and
    `attackBlockOf` resolves that against the number rather than answering it here
    (continuous.ts, where the choice of WHICH number is argued in full). ⚠️ Unlike
    the attacking card, the amount was NOT already in the callers' hands in the
    right form — every one of the three computed its reduction AFTER this call and
    folded the subtraction into `dealt`. So each site now hoists that arithmetic
    into a named `wouldDeal` above the `prevented` expression and spells it once
    instead of twice, which is the only structural edit D240 makes outside this
    file's own signature. */
function attackDamageBlocked(
  state: GameState,
  pokemon: InPlayPokemon,
  attacker: Card | undefined,
  damage: number,
  ctx: EffectContext,
): boolean {
  return ctx.invokedBy === "attack" && attackBlockOf(state, pokemon, attacker, damage) !== null;
}

/** 🆕 D259 — THE PURE HALF OF THE FUNNEL, SPLIT OUT SO A PER-CANDIDATE READER CAN
    ASK THE SAME QUESTION WITHOUT ANNOUNCING AN ANSWER IT IS ONLY CONSIDERING.
    `effectRefused` below is this predicate plus one event; the two per-candidate
    sites (`discardableEnergies`'s filter and the `gust` candidate list) call THIS,
    because a shielded body they drop from a list is not a refusal that happened —
    it is a target that was never offered. One predicate, two wrappers, so the
    single-read contract survives the second reader (D222's rule). */
function effectRefusedOn(
  state: GameState,
  target: InPlayPokemon,
  seat: Seat,
  ctx: EffectContext,
): boolean {
  // 🆕 D259 — THE TRAINER CHANNEL, AND IT IS CHECKED FIRST BECAUSE IT IS THE ONE
  // THAT CAN BE TRUE FOR A BENCHED BODY. Both of its sentences are about a card
  // the OPPONENT plays, so `ctx.seat` (the player resolving the Trainer) must not
  // be the shielded body's own side — a Supporter you play on your own Pokémon is
  // not refused by your own Wide Wall, and the printed word is "your opponent".
  if (ctx.invokedBy === "item" || ctx.invokedBy === "supporter") {
    // ⚠️ UNREACHABLE TODAY, GUARDED ANYWAY, AND THE MUTATION CORPUS IS WHAT
    // ESTABLISHED THAT RATHER THAN THIS COMMENT. `D259-trainer-channel-ignores-
    // owner` was authored as a drivable row, SURVIVED, and the grep that followed
    // is the measurement: every `trainer` program reaching this funnel aims at the
    // OPPONENT (`discardEnergy from: "opponentChosen"|"opponentEach"`, `gust`,
    // `applyStatus target: "defender"`), and the pool's one own-board Trainer op
    // (`healChosen`) is not on this funnel at all. So `seat` is always the
    // opponent's here. Kept because THIS SLICE is the argument for keeping such a
    // guard — D253's and D254's arms were "structurally dead" until an op aimed
    // where no op had aimed before, and then they were simply correct.
    if (seat === ctx.seat) return false;
    // Fraxure / Cetitan ex: the HOLDER rule, and the fold answers it whole — no
    // zone clause, no source clause, and BOTH trainer types refused.
    if (passivesOf(state, target).preventTrainerEffects) return true;
    // Rhyperior: the SEAT rule, Supporters only. `seat` and not `target` because
    // the printed target is "all of your Pokémon" — the scan is about the side.
    return ctx.invokedBy === "supporter" && seatShieldedFromSupporterEffects(state, seat);
  }
  if (ctx.invokedBy !== "attack") return false;
  // 🆕🆕🛑 **D430 — A SHIELD PRINTED AGAINST YOUR OPPONENT'S CARDS DOES NOT PROTECT
  // AGAINST YOUR OWN, AND THIS IS THE ATTACK CHANNEL'S HALF OF THE RULE THE TRAINER
  // CHANNEL HAS SPELLED SINCE D259.** Every printing that can make this function
  // return `true` names the ATTACK'S SOURCE, and the source it names is always the
  // holder's OPPONENT. Enumerated by `grep -rn "Prevent all" testFixtures.ts`
  // (18 hits, all read) plus `grep -n "effects of attacks" censusAttackCorpus.ts`
  // (2 rows, both read) — the loosest shape the family is spelled in, so the
  // enumeration's edges are visible (D424/D425):
  //   · Mist Energy `sv05-161` / Skeledirge `sv08-031` (`preventAttackEffects`) —
  //     *"attacks **used by your opponent's Pokémon** done to …"*;
  //   · Team Rocket's Articuno `sv10-051` (`preventAttackEffectsForGroup`) — same
  //     source clause, a group target;
  //   · Carracosta `sv10.5b-023` (`preventDamageAndEffectsFromSpecialEnergy`) —
  //     *"…done to this Pokémon **by your opponent's Pokémon** that have any
  //     Special Energy attached"*;
  //   · Poltchageist `sv06-020` (`preventDamageAndEffectsWhileBenched`) and Rabsca
  //     `sv05-024` (`benchShieldedFromEffects`) — *"attacks **from your opponent's
  //     Pokémon**"*;
  //   · the INSTALLED block (`attackBlockOf`, the two corpus rows) — *"**during your
  //     opponent's next turn**, prevent all damage from and effects of attacks done
  //     to this Pokémon"*, which is a clock rather than a source clause and reaches
  //     the same place: it is not live on its holder's own turn.
  // So an effect an attack aims at its OWN side is refused by nothing in the pool,
  // and asking the shields anyway is a wrong answer rather than a conservative one.
  //
  // 🛑 **IT IS A SECOND LINE AND NOT ONE HOISTED ABOVE THE CHANNEL SPLIT, ON D416's
  // RULE.** The trainer channel's identical guard (~30 lines up) is pinned by
  // `D259-trainer-channel-ignores-owner`, a DECLARED SURVIVOR whose whole claim is
  // about Trainers. Hoisting would make that row die for the ATTACK channel's
  // reason — a row that dies for the wrong reason is worth less than one that
  // survives — and would leave the next channel inheriting a rule instead of
  // deriving it from what its own cards print.
  //
  // ⚠️ **AND IT REMOVES A HAND-SPELLED COPY RATHER THAN ADDING A RULE.**
  // `discardEnergy` has carried `discardVictimSeat(ctx.seat, op) !== ctx.seat` at
  // its CALL SITE since D259 — one caller answering a question the funnel is for
  // (D222). That guard is now redundant and is kept only as the reader's own
  // narrowing; the two other own-side callers (`applyStatus`'s `"self"` arm,
  // `preventRetreat`/`preventAttack`'s `"self"` arms) asked and got the WRONG
  // answer on any board where the attacker's own body wears a Mist Energy. Their
  // doc blocks said the self arm "can never be refused in practice" and named the
  // INSTALLED block's clock as the reason; that was true of the one channel that
  // existed when it was written and false from D260 onward.
  if (seat === ctx.seat) return false;
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
  //
  // ⚠️ D240 — AND THE DAMAGE AMOUNT IS `undefined` HERE ON PURPOSE, WHICH IS THE
  // ONE SITE OF THE FIVE WHERE IT IS. This gate is about an EFFECT — a status, a
  // discard, a forced switch — and "if that damage is 40 or less" has no truth
  // value about one, because there is no damage for the cap to be about. So a
  // CAPPED block never refuses an effect, which is the conservative direction
  // (protects LESS) and the same one the unresolvable-attacker arm takes one file
  // over. Unreachable off any real printing for the Bench arm's reason doubled:
  // the three capped printings are all the NARROW spelling, so a block carrying
  // `maxDamage` never has `effects: true` either.
  //
  // 🆕 D252 — AND THIS GATE NOW HAS TWO CHANNELS, WHICH IS THE WHOLE PRICE OF THE
  // "AND EFFECTS OF ATTACKS" HALF. Until now the only way an effect could be
  // refused was an INSTALLED §11 block in its wide printed spelling; Carracosta
  // "Mighty Shell" (`sv10.5b-023`/`-107`) prints the same wide spelling as a
  // continuous ABILITY, so `passivesOf` joins `attackBlockOf` here. ⚠️ ONE gate and
  // not eight: the eight ops that consult this function needed no edit at all,
  // which is the measured reason the effects half was cheap. The two channels are
  // ORed rather than merged — an installed block is a stamp on the target's own
  // record with a turn's life, an aura is a catalog fold with none, and only the
  // aura consults the attacker's ATTACHMENTS.
  const attackerTop = activeTop(state, ctx.seat);
  const attacker = attackerTop?.card;
  // ⚠️ THE AURA IS READ THROUGH `passivesOf` AND NOT OFF THE TARGET'S TOP CARD, for
  // the reason every flag in that fold is there: both printings ARE Abilities, so a
  // §9 lock over the holder must switch the refusal off and let the Poison land.
  //
  // ⚠️ D253 ADDS A SECOND AURA AND IT IS PROVABLY DEAD HERE, WHICH IS RECORDED
  // RATHER THAN HIDDEN. `target` is `state.players[seat].active` two screens up —
  // every op that consults this funnel aims at an Active — so "Curious Tea
  // Party"'s "As long as this Pokémon is on your Bench" antecedent, which
  // `passivesOf` has already folded, is FALSE at this site on every board this
  // engine can reach. The printed sentence's EFFECTS half is therefore structurally
  // unreachable today. Guarded anyway, because the deadness is a fact about the
  // current op set and not a rule of the game: the day an op aims a status or a
  // forced switch at a BENCHED body, the refusal is already where it belongs. No
  // mutant is authored against this disjunct for exactly the same reason — one
  // could not be killed, and an unkillable mutant is a corpus defect, not coverage.
  //
  // 🛑 D254 ADDS A THIRD AURA CHANNEL AND IT IS DEAD FOR THE SECOND ONE'S REASON,
  // NOT ITS OWN. Rabsca `sv05-024` "Spherical Shield" refuses effects done to a
  // side's BENCHED Pokémon; `target` is `state.players[seat].active`, so the
  // refusal has no reachable board here either. ⚠️ THE DIFFERENCE FROM THE LINE
  // ABOVE IS WHERE THE ZONE CLAUSE LIVES: D253's is a HOLDER gate that `passivesOf`
  // folded, so it reads as a bare flag; this one is a TARGET clause about a body
  // the aura's holder is not, so it can only be answered by the scan — which is
  // the same fold-vs-scan split `preventBenchDamageWhileActive` has had since D159.
  // Written for TOTALITY, no mutant authored: one could not be killed.
  //
  // 🆕 D260 ADDS THE FOURTH AND FIFTH AURA CHANNELS, AND BOTH ARE LIVE ON EVERY
  // BOARD — the first arms this expression has gained that need no deadness note.
  // Backlog row 15-E is the ATTACK-BORNE EFFECTS-ONLY spelling (Skeledirge
  // `sv08-031` "Unaware", 1 printing; Team Rocket's Articuno `sv10-051`
  // "Repelling Veil", 1 printing), i.e. `preventDamageAndEffectsFromSpecialEnergy`
  // with the DAMAGE half and the ATTACKER predicate BOTH dropped. Neither prints a
  // zone clause, so neither is confined to the Bench the way the two arms above
  // are, and both are reachable at all eight of this funnel's pre-existing call
  // sites with the target at its default (the victim's Active).
  //
  // ⚠️ THEY ARE ON OPPOSITE SIDES OF THE FOLD/SCAN LINE AND THE PRINTED OBJECTS ARE
  // THE WHOLE REASON: "done to THIS Pokémon" is the body `passivesOf` is already
  // about, and "done to YOUR Basic Team Rocket's Pokémon" is a set the holder is
  // only one member of, which a per-body fold taking no seat cannot express.
  const auraRefuses =
    (passivesOf(state, target).preventDamageAndEffectsFromSpecialEnergy &&
      attackerHasSpecialEnergy(state, attackerTop?.active)) ||
    passivesOf(state, target).preventDamageAndEffectsWhileBenched ||
    passivesOf(state, target).preventAttackEffects ||
    benchShieldedFromEffects(state, target) ||
    groupShieldedFromAttackEffects(state, target);
  return auraRefuses || attackBlockOf(state, target, attacker, undefined)?.effects === true;
}

/** §11 — is an effect aimed at `seat`'s `target` refused, and if so SAY SO? The
    announcing wrapper around the predicate above, and the funnel every one of the
    interpreter's effect ops has consulted since D142.

    🆕 D259 RENAMED IT FROM `attackEffectRefused` AND GAVE IT A `target`, AND BOTH
    ARE THE TRAINER CHANNEL'S DOING. The old name stopped being true the moment a
    Supporter could be refused; the old body resolved `state.players[seat].active`
    itself, which was correct while EVERY caller was attack-borne (§8 aims at an
    Active) and is wrong the instant a Crushing Hammer names a benched body. So the
    parameter is OPTIONAL and defaults to exactly what the function used to compute
    — all eight pre-existing call sites are byte-unchanged, and only the sites that
    genuinely know a different body pass one.

    ⚠️ THE DEFAULT IS NOT A CONVENIENCE, IT IS THE PROOF THAT THE WIDENING IS A
    WIDENING. Had the parameter been required, eight call sites would each have
    re-spelled `state.players[seat].active` and the next benched-target op would
    have had eight places to get wrong instead of one.

    🆕🆕🛑 **D430 EXPORTED IT, AND THE EXPORT IS SAFE FOR THE PROPERTY D429 WROTE AT
    THE TYPE RATHER THAN FOR THE SHAPE OF ITS RETURN.** `attack.ts`'s pre-damage
    strip (`stripPreDamage`) is an EFFECT of an attack done to a Pokémon and had
    never consulted this gate at all, while its sibling consequent one arm over
    (row 74's Paralysis, through `applyStatus`) always had — so one printed sentence
    had one half gated and one half not, on a board Mist Energy `sv05-161` and Klefki
    `sv01-096` can reach today. The check to re-run before exporting anything else to
    that seam is the SIGNATURE: this returns a `boolean`. A park is `RunResult`'s
    `{ kind: "parked"; prompt; cont }`, drained by `settleProgram`; a boolean carries
    neither a prompt nor a continuation, so there is nothing a resolver could drain
    and the seam stays un-parkable. It is also TOTAL — every path returns — so it
    cannot leave the caller without an answer.

    ⚠️ **THE ANNOUNCING WRAPPER AND NOT `effectRefusedOn`, WHICH IS THE PLACEMENT
    QUESTION D430 HAD TO SETTLE.** The pure predicate exists for a per-CANDIDATE
    reader that is only CONSIDERING a body (D259). The strip is not considering
    anything: it has one target, it either performs the printed act on it or it does
    not, and a refusal the player cannot see is a Tool that silently stays attached
    with no row saying why. So the seam takes the wrapper and files the same
    `ATTACK_EFFECT_PREVENTED` every other refused attack effect files. */
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
      : { type: "ATTACK_EFFECT_PREVENTED", seat, uid },
  );
  return true;
}

/** 🆕 D259 — THE PER-CANDIDATE FORM OF THE FUNNEL: drop from `refs` every body
    that refuses this effect, announcing one row for each one dropped.

    ⚠️ IT IS A FILTER AND NOT A GUARD, AND THAT IS THE ONE PLACEMENT QUESTION THIS
    SLICE HAD TO SETTLE. The eight pre-existing call sites refuse the op WHOLE,
    which is right for an op with exactly one target (a status on the Active, a
    retreat lock). Crushing Hammer and Boss's Orders instead CHOOSE a target from a
    set, so refusing the op whole would mean one shielded Fraxure on a five-Pokémon
    Bench protecting the whole Bench — a rule no printing states. Filtering the
    candidate set is what "done to this Pokémon" actually says, and it falls out of
    `parkOrForce` for free: an emptied set is a whiff, a one-survivor set
    auto-resolves, anything else parks and asks.

    ⚠️ AND IT MAKES TWO PREVIOUSLY-DEAD ARMS LIVE, WHICH IS A CORRECTNESS RESULT
    AND NOT A SIDE EFFECT. D253's `preventDamageAndEffectsWhileBenched` and D254's
    `benchShieldedFromEffects` were both recorded as structurally unreachable at
    this funnel *because every op that consulted it aimed at an Active*. That
    sentence is no longer true: an ATTACK that gusts names a benched body, so a
    benched Curious Tea Party holder and a Rabsca-shielded Bench now refuse it
    through the very disjuncts written for totality two slices ago. Their doc
    blocks are corrected in place rather than left claiming a deadness that ended.

    A refusal is announced HERE rather than at the shield, so the player reads one
    row per shielded BODY and not one per Energy on it — `discardableEnergies`
    returns a candidate per uid, and three Energy on one Fraxure is one refusal. */
function unshieldedRefs(
  state: GameState,
  refs: readonly PokemonRef[],
  ctx: EffectContext,
  events: GameEvent[],
): PokemonRef[] {
  return refs.filter((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
    if (body === undefined || body === null) return true; // not our call — the op validates refs
    return !effectRefused(state, ref.seat, ctx, events, body);
  });
}

/** Spread damage: place `amount` HP on EACH Benched Pokémon of the side `target`
    names (§8.5 — Weakness/Resistance never apply on the Bench, so it is flat
    there). ⚠️ **D505 — `amount` ARRIVES ALREADY FOLDED.** `stepOp` passes
    `snipeAmount(op, …)` rather than `op.amount`, so the Prize-scaled printing
    (*"…for each Prize card your opponent has taken"*) reaches this function as a
    plain number and nothing below this line knows the rider exists — `damageSelf`'s
    division of labour, and the reason the early return one screen down covers the
    0-taken board for free. A benched Pokémon's own continuous damage REDUCTION still applies
    though (Bouffalant "Bouffer" / a defending Tool — the passive that is not
    Active-only), floored at 0; the attacker's pre-W/R bonus (Vitality Band) is
    Active-target-only and does NOT reach the Bench. One DAMAGE_DEALT per benched
    Pokémon (seat/uid name the DAMAGED body's owner, as everywhere). Only raises
    damage — the KO check runs in attack.ts's epilogue, so this never KOs or ends
    the game (interpreter header).

    🆕🆕 **D425 — THE VICTIM SEAT IS A PARAMETER NOW, AND EVERY LINE BELOW THAT
    NAMED "the opponent" WAS ALREADY ASKING THE RIGHT QUESTION OF THE WRONG NOUN.**
    `victim` replaces the hoisted `otherSeat(ctx.seat)`; nothing else in the body
    moved, because every prevention, reduction and shield in the fold is read off
    the DAMAGED BODY rather than off a seat. That is not a convenience — it is why
    the own-side arm needs no second copy of a 120-line pipeline:

      • the `preventDamageFrom…` family, the coin-flip shield, the §11 block, the
        Stadium and the bench shields all ask *"is THIS body protected from an
        attack by THAT card"*, and `attackerCard` is the attacker either way. A
        Mimikyu "Safeguard" standing on your OWN Bench while your own ex spreads
        into it is protected, because the printed sentence says "by attacks from
        Pokémon ex" and yours is one. The engine says so by construction.
      • `attackerDebuff` (D149/D151) is a fact about the ATTACKER — "the Defending
        Pokémon's attacks do 20 less damage" scopes the attacker and names no
        target — so it comes off the own-side splash too, unchanged.
      • `koSurvivalClamp` is asked of the damaged body, so a full-HP own benched
        holder survives its controller's own attack exactly as an opponent's does.

    🛑 **AND THE THING THIS FUNCTION STILL DOES NOT DO IS THE THING THAT MATTERS
    MOST.** It does not Knock Out, and it did not before. `finishAttack` sweeps
    `[defender, attacker]` and `collectKnockOutPass` owes each Knock Out's Prize to
    `otherSeat(entry.ref.seat)` — so an own-side spread that kills your own benched
    body hands your OPPONENT the Prize with no code written here or there.
    `ownBenchSpread.test.ts` drives that, the game end it can cause, and the fact
    that a benched Knock Out owes NO promotion; none of the three is asserted from
    this comment. */
function spreadDamage(
  state: GameState,
  target: "opponentBench" | "yourBench",
  amount: number,
  damagedOnly: boolean,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  // 🆕🆕 D425 — the ONE line the side decides. `ctx.seat` is the attacker's seat on
  // every attack program (attack.ts sets it), so `"yourBench"` is the attacker's own
  // board and `"opponentBench"` is the other one. A `switch` rather than a negated
  // test, on D222's rule: a third member added to the union stops compiling here
  // instead of falling silently out of the wrong side of a `!==`.
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
  // D258 — WAS A `.map`, AND IS A FOLD BECAUSE THE COIN-FLIP SHIELD CONSUMES RNG.
  // ⚠️ A SPREAD INTO THREE HOLDERS IS THREE FLIPS, NOT ONE: the printed antecedent is
  // "is damaged by an attack", which happens once per BODY, and each body's coin has
  // to advance the state the next body's coin is drawn from. A `.map` cannot express
  // that — it has no accumulator — so the loop carries `rng` and the return below
  // writes it back. Nothing else in the body changed; `state` is not re-bound inside
  // the loop, because the only part of it that moves is the `rngState` this fold owns
  // and no passive read consults that.
  const bench: InPlayPokemon[] = [];
  let rng = state.rngState;
  for (const pokemon of side.bench) {
    const uid = topUid(pokemon);
    if (uid === undefined) {
      bench.push(pokemon);
      continue;
    }
    // 🆕🆕🆕 D507 — THE PRINTED *"that has any damage counters on it"*, AND IT IS A
    // TARGETING TEST RATHER THAN AN AMOUNT ONE, which is why it lives here and not at
    // the dispatch where `perTakenPrize` folds. An undamaged body is not hit at all:
    // no shield coin is drawn for it, no prevention is asked about it and NO
    // `DAMAGE_DEALT` row is filed — the same ending `counterEachAll`'s identical
    // `op.damagedOnly === true && !hasAnyDamageCounters(pokemon)` line gives a body its
    // filter refuses. ⚠️ AHEAD OF THE FOLD'S RNG, deliberately: `coinFlipShieldPrevents`
    // advances `rng` for every body it is asked about (D258), so asking about a body
    // this clause excludes would re-draw every LATER body's coin off a board fact the
    // sentence says is none of its business.
    if (damagedOnly && !hasAnyDamageCounters(pokemon)) {
      bench.push(pokemon);
      continue;
    }
    const passives = passivesOf(state, pokemon);
    // D159 — five terms in two printed groups (attack.ts's main hit says why).
    // This is the site where the OFF-TARGET pair is most reachable: a spread hits
    // the Bench, which is exactly the zone Thundurus "Adverse Weather" shields and
    // exactly where a no-Rule-Box body sits under Neutralization Zone.
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
    //
    // ⚠️ D240 MOVED THIS ABOVE `prevented`, and the move is the whole point rather
    // than a tidy-up: the damage CAP is read against the number that would
    // actually be placed, so the reduction has to be known before the prevention
    // is asked (continuous.ts `attackBlockOf` argues which number and why).
    const reduction =
      passives.damageReductionAfterWR +
      installedReductionOf(state, pokemon) +
      seatDamageReduction(state, pokemon, "all");
    const wouldDeal = Math.max(0, spread - reduction);
    // D258 — RENAMED for attack.ts's reason verbatim: the seven pure preventions
    // settle first, and the coin-flip shield is asked afterwards on what is left.
    const preventedBeforeFlip =
      (passives.preventDamageFromExV && attackerCard !== undefined && isExOrV(attackerCard)) ||
      preventsAttackerType(passives.preventDamageFromTypes, attackerCard) ||
      // D251 — the third attacker-property prevent, at the SECOND of the gate's
      // four read sites. A spread reaches the BENCH and "Cornerstone Stance" has
      // no Active-Spot clause, so a benched holder is protected from a spread
      // exactly as the Active is — the reason this arm is not optional.
      (passives.preventDamageFromHasAbility && hasPrintedAbility(attackerCard)) ||
      // D255 — the SIXTH prevent, at the SECOND of its four read sites. A spread
      // reaches the BENCH and neither printed sentence carries an Active-Spot
      // clause, so a benched Sylveon or Farigiraf ex is protected from a spread
      // exactly as the Active is — `preventDamageFromHasAbility`'s reason one line
      // up. `preventsAttackerClass` takes the OPTIONAL card and answers FALSE for an
      // unresolvable attacker, which is why there is no `!== undefined` beside it.
      preventsAttackerClass(passives.preventDamageFromAttackerClasses, attackerCard) ||
      // D252 — the SECOND of the wide prevent's five read sites. A spread reaches
      // the BENCH and "Mighty Shell" has no Active-Spot clause, so a benched holder
      // is protected from a spread exactly as the Active is — `preventDamageFrom
      // HasAbility`'s reason one line up, and the DAMAGE half is the half that
      // reaches the Bench at all.
      (passives.preventDamageAndEffectsFromSpecialEnergy &&
        attackerHasSpecialEnergy(state, attackerTop?.active)) ||
      // D253 — the fifth prevent, at the SECOND of its five read sites and the
      // FIRST OF THE TWO THAT CAN EVER FIRE. `side.bench.map` is this arm's whole
      // domain, so every body it reaches satisfies "on your Bench" and this is
      // where "Curious Tea Party" actually bites. A bare flag with no predicate
      // beside it: `passivesOf` resolved the zone clause in the fold.
      passives.preventDamageAndEffectsWhileBenched ||
      // D257 — the SEVENTH prevent, at the SECOND of its four read sites. A spread
      // reaches the BENCH and "Impervious Shell" carries no zone clause at all, so
      // a benched Drednaw is protected from a spread exactly as an Active one is.
      // ⚠️ AND THIS IS THE SITE WHERE THE THRESHOLD IS HARDEST TO TRIP AND THEREFORE
      // THE ONE THAT PROVES IT IS READ AGAINST THE RIGHT NUMBER: a spread's per-body
      // amount is small, so a 200-threshold holder standing in a 20-damage splash is
      // NOT shielded. A build that compared the threshold against the attack's
      // PRINTED damage, or against the Active's number, would shield it — and would
      // pass every single-target board in the suite.
      preventedByDamageThreshold(passives.preventDamageAtOrAbove, wouldDeal) ||
      attackDamageBlocked(state, pokemon, attackerCard, wouldDeal, ctx) ||
      // D254 — "all", and the reason is that a SPREAD carries no `ignoreWR`: Feint
      // Attack is a single-target attack, and nothing in the pool spreads while
      // ignoring effects on the damaged body. So every source on this side counts,
      // including a Rabsca splashing beside the body it is shielding.
      benchShieldedFromDamage(state, pokemon, "all") ||
      stadiumPreventsDamage(state, pokemon, attackerCard);
    // D258 — the EIGHTH prevent, at the SECOND of its FOUR read sites, and the site
    // that makes the "once per DAMAGE INSTANCE" reading observable: a spread into
    // three Kecleons draws THREE coins, and each is drawn from the state the last one
    // left. `rng` is the loop's accumulator, so `{ ...state, rngState: rng }` hands
    // the funnel the advanced state rather than the state this op started from — a
    // build that passed `state` would draw the SAME face for every benched holder.
    // No `ignoreWR` term: a spread carries none (D254's line one disjunct up).
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
    // §8.1 (D208) — the KO-survival clamp, at the third of its four write sites.
    // A spread is "damage from an attack" (it emits DAMAGE_DEALT, not
    // COUNTERS_PLACED), and it reaches the BENCH — which is exactly where these
    // printings live in practice, since neither sentence carries an "Active Spot"
    // clause. `pokemon` is still the pre-hit body, which is the only reason the
    // "has full HP" antecedent is answerable at all.
    const clamped = koSurvivalClamp(state, pokemon, dealt);
    const damage = clamped ?? pokemon.damage + dealt;
    events.push({
      type: "DAMAGE_DEALT",
      seat: victim,
      // 🆕🆕 D425 — and THIS is the site where `by` stops equalling
      // `otherSeat(seat)`: on the `"yourBench"` arm the dealer and the damaged
      // body's owner are the SAME seat.
      by: ctx.seat,
      uid,
      base: amount,
      debuff: attackerDebuff > 0 ? attackerDebuff : undefined,
      weakness: null,
      resistance: null,
      reduction: reduction > 0 ? reduction : undefined,
      prevented: prevented ? true : undefined,
      survived: clamped === null ? undefined : true,
      dealt,
      damage,
    });
    bench.push({ ...pokemon, damage });
  }
  return withSide({ ...state, rngState: rng }, victim, { ...side, bench });
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
  //
  // 🆕🆕🆕 **D447 — THE BENCH VICTIM IS READ OFF THE REFS, NOT ASSUMED TO BE THE
  // OPPONENT, AND THAT IS THE WHOLE INTERPRETER HALF OF THIS SLICE.** Until this slice
  // the filter below was `ref.seat === opponent`, so an own-side ref was DROPPED and
  // `targeted` came back empty — `damageChosen {target:"yourBench"}` would have parked
  // a real prompt, taken a real answer and then dealt NOTHING, with `tsc` green and no
  // event to say so. **A silent no-op is the failure mode this function had, and it is
  // the one a union widening reaches without touching a line of arithmetic.**
  //
  // ⚠️ **ONE SEAT PER CALL, AND THAT IS A PROPERTY OF THE FUNNEL RATHER THAN A
  // SIMPLIFICATION.** `snipeTargets` returns `oppAnyRefs`, `oppBenchRefs` or
  // `ownBenchRefs`, and every one of the three is single-seated; `validateChoice`
  // matches the answer against the parked candidates, so a pick spanning both benches
  // cannot arrive here. The seat is therefore taken from the FIRST benched ref and the
  // rest are filtered against it, which is exactly as wide as the sets that exist.
  // ⚠️ The ACTIVE arm above stays `opponent`-only: no printing aims a chosen hit at
  // the attacker's own Active, and `oppAnyRefs` is the only producer of an Active ref.
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
  // D258 — a FOLD rather than a `.map`, for `spreadDamage`'s reason verbatim: the
  // coin-flip shield draws once per damaged body and each draw advances the state the
  // next one reads. ⚠️ THE PUT-COUNTER ARM BELOW DRAWS NOTHING, and that is a printed
  // ruling rather than an omission — a placed counter is not "damage done by attacks"
  // (the standing `damageActive` reading this whole function is built on), so a
  // Kecleon under Hawlucha's snipe never flips.
  const bench: InPlayPokemon[] = [];
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
      // The default put-counter snipe (Hawlucha / Meowscarada / Radiant Blastoise,
      // and since 0.89.0 Ting-Lu ex's "Land Scoop"): flat, no W/R and no reduction
      // passive (a placed counter is not "damage from an attack"). `source` is the
      // producer's, never this function's — see the doc block.
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
    //
    // ⚠️ D240 — `prevented` now reads this number, so it moved BELOW rather than
    // above: the damage CAP is a condition on the damage that would actually be
    // placed (continuous.ts `attackBlockOf`). The arithmetic is unchanged byte for
    // byte; only the binding order and the name are new.
    const wouldDeal = Math.max(0, Math.max(0, amount - attackerDebuff) - reduction);
    // D258 — RENAMED for attack.ts's reason verbatim.
    const preventedBeforeFlip =
      (!ignoreWR &&
        ((targetPassives.preventDamageFromExV &&
          attackerCard !== undefined &&
          isExOrV(attackerCard)) ||
          preventsAttackerType(targetPassives.preventDamageFromTypes, attackerCard) ||
          // D251 — the THIRD of the gate's four read sites, inside the `ignoreWR`
          // guard with its two siblings for their reason verbatim: all three are
          // catalog auras ON the damaged Pokémon, so Feint Attack nulls all three.
          (targetPassives.preventDamageFromHasAbility && hasPrintedAbility(attackerCard)) ||
          // D255 — the THIRD of the SIXTH prevent's four read sites, INSIDE the
          // `ignoreWR` guard with its siblings for their reason verbatim: it is a
          // catalog aura ON the damaged Pokémon, so Feint Attack nulls it and a
          // sniped Sylveon really does take the hit from a Pokémon ex.
          preventsAttackerClass(targetPassives.preventDamageFromAttackerClasses, attackerCard) ||
          // D252 — the THIRD of the wide prevent's five read sites, inside the
          // `ignoreWR` guard with its three siblings for their reason verbatim: all
          // four are catalog auras ON the damaged Pokémon, so Feint Attack nulls
          // all four.
          (targetPassives.preventDamageAndEffectsFromSpecialEnergy &&
            attackerHasSpecialEnergy(next, attackerTop?.active)) ||
          // D253 — the THIRD of the fifth prevent's read sites and the SECOND of
          // the two that can fire: `placeSnipe` maps `side.bench`, so the picked
          // body is benched by construction. INSIDE the `ignoreWR` guard with its
          // four siblings for their reason verbatim — it is a catalog aura ON the
          // damaged Pokémon (the holder's own Ability protecting itself), so Feint
          // Attack's "not affected by any effects on that Pokémon" nulls it, and a
          // sniped Poltchageist under Feint Attack really does take the hit.
          targetPassives.preventDamageAndEffectsWhileBenched ||
          // D257 — the THIRD of the seventh prevent's four read sites, INSIDE the
          // `ignoreWR` guard with its five siblings for their reason verbatim: it is
          // a catalog aura ON the damaged Pokémon, so Feint Attack nulls it and a
          // sniped Drednaw really does take a 200-damage hit.
          // 🛑 AND THIS ARM IS WHERE THE TWO HALVES OF `ignoreWR` PULL APART ON ONE
          // BOARD, WHICH NO OTHER MEMBER OF THIS FAMILY CAN SHOW: Feint Attack
          // nulls the PREVENTION but not the pipeline, so `wouldDeal` is computed
          // WITHOUT Weakness, Resistance or reduction here — the threshold is read
          // against a different number at this site than at the three others, off
          // the same printed sentence. That is D240's ruling being load-bearing
          // rather than decorative, and it is asserted rather than assumed.
          preventedByDamageThreshold(targetPassives.preventDamageAtOrAbove, wouldDeal) ||
          attackDamageBlocked(next, pokemon, attackerCard, wouldDeal, ctx))) ||
      // 🛑 D254 — THE ONE SITE OF THE FIVE WHERE `scope` IS OBSERVABLE, and the
      // reason the parameter exists at all. This scan stays OUTSIDE the `ignoreWR`
      // guard, because Thundurus's shield really is an effect on a DIFFERENT body
      // (D159's reading, unchanged) — but Rabsca's source set contains its target
      // set, so a sniped Rabsca is granting itself the very effect Feint Attack
      // nulls. `seatDamageReduction` one screen up takes the identical argument at
      // the identical site for the identical reason: the aura is nulled exactly to
      // the extent the damaged body is the one granting it.
      benchShieldedFromDamage(next, pokemon, ignoreWR ? "othersOnly" : "all") ||
      stadiumPreventsDamage(next, pokemon, attackerCard);
    // D258 — the EIGHTH prevent, at the THIRD of its FOUR read sites. `ignoreWR` is
    // folded into the ARGUMENT rather than spelled as a guard around it, which is the
    // one thing this funnel's signature buys over the seven disjuncts above: Feint
    // Attack nulls a catalog aura ON the damaged body, so a sniped Kecleon under
    // "Feint Attack" draws NO coin at all — it does not draw one and ignore it, which
    // would advance `rngState` and desynchronise the replay for a prevention that
    // never happened.
    const [flipPrevented, nextRng] = coinFlipShieldPrevents(
      { ...next, rngState: rng },
      pokemon,
      // 🆕 D447 — the SHIELDED body's seat, which is the sniped side and not
      // necessarily the opponent's. The flip belongs to the Pokémon being damaged.
      benchVictim,
      preventedBeforeFlip || ignoreWR ? 0 : wouldDeal,
      events,
    );
    rng = nextRng;
    const prevented = preventedBeforeFlip || flipPrevented;
    const dealt = prevented ? 0 : wouldDeal;
    // §8.1 (D208) — the KO-survival clamp. THIS ARM AND NOT THE ONE ABOVE IT, and
    // the branch these two share is the boundary itself: the `deals` arm is attack
    // DAMAGE (Wo-Chien "Covetous Ivy", Umbreon "Feint Attack") and the default arm
    // one screen up PLACES COUNTERS, which "is not damage from an attack" — this
    // engine's own long-standing reading (D138/D139/D142), the same line that
    // already denies that arm Weakness, Resistance and every reduction passive.
    // So the clamp goes exactly where the pipeline goes and no further.
    const clamped = koSurvivalClamp(next, pokemon, dealt);
    const damage = clamped ?? pokemon.damage + dealt;
    // 🆕🆕 D425 said of the row below: *"placeSnipe's `deals` arm aims across the
    // table."* 🆕🆕🆕 **D447 CORRECTS THAT SENTENCE IN PLACE (D442): IT NO LONGER
    // ALWAYS DOES.** `by` is the ATTACKER on every board — unchanged, and what makes the
    // row read "p1 dealt …" — but `seat` is the DAMAGED body's, and under
    // `target: "yourBench"` the two are the SAME seat. `ownBenchSpread.test.ts` §8 states
    // the general rule for the spread; the snipe inhabits it now too.
    //
    // ⚠️ **THE TRAILING COMMENT ON `by` IS LOAD-BEARING AND NOT DECORATION (D437's
    // converse trap, D446's rule).** Without it this object literal is BYTE-IDENTICAL to
    // `spreadDamage`'s from `by:` down, and `D425-damage-row-names-the-victim-as-the-dealer`
    // — whose `find` is that run of lines — starts occurring TWICE and the row breaks.
    // `precheck` said so before this comment was written.
    events.push({
      type: "DAMAGE_DEALT",
      seat: benchVictim,
      by: ctx.seat, // 🆕🆕🆕 D447 — the ATTACKER, which is `seat` too on the own-side arm.
      uid,
      base: amount,
      debuff: attackerDebuff > 0 ? attackerDebuff : undefined,
      weakness: null,
      resistance: null,
      reduction: reduction > 0 ? reduction : undefined,
      prevented: prevented ? true : undefined,
      survived: clamped === null ? undefined : true,
      dealt,
      damage,
    });
    bench.push({ ...pokemon, damage });
  }
  return withSide({ ...next, rngState: rng }, benchVictim, { ...side, bench });
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
  //
  // 🆕🆕 D432 — …OR by the target's own installed bar ("During your opponent's
  // next turn, this Pokémon has no Weakness."), the THIRD null path on this
  // question and the THIRD store behind it (continuous.ts `installedNoWeakness`
  // tabulates all three). THIS SITE IS DRIVEN ON ITS OWN BOARD rather than
  // inherited from attack.ts's: the two reads are separate expressions in separate
  // files, and a build that widened one and not the other is invisible to any
  // suite that only swings the main hit. `D432-snipe-bar-not-read` is exactly that
  // build.
  //
  // ⚠️ ORDER: `attacker === null` is LOAD-BEARING WHERE IT SITS, unlike the free
  // permutation at the main-hit site. TypeScript's aliased-condition narrowing is
  // what lets `weaknessOf(attacker.card, …)` on the next line compile at all, so
  // the null test must remain an operand of THIS `const`. The new disjunct is
  // appended rather than inserted for that reason, and it needs no guard of its
  // own: `target` is non-null from the early return above.
  const noWeakness =
    ignoreWR ||
    attacker === null ||
    seatRemovesWeakness(state, opponent) ||
    installedNoWeakness(state, target.active);
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
  // ⚠️ D240 — the damage CAP is read against the number that would actually be
  // placed, so `prevented` moved BELOW the reduction it now depends on. This is
  // the one interpreter site that runs Weakness, so it is also the one where the
  // difference between "post-W/R" and "post-reduction" is observable on a single
  // board; continuous.ts `attackBlockOf` argues which of the two D240 chose.
  const wouldDeal = Math.max(0, afterWR - reduction);
  // D258 — RENAMED for attack.ts's reason verbatim.
  const preventedBeforeFlip =
    (!ignoreWR &&
      ((targetPassives.preventDamageFromExV && attacker !== null && isExOrV(attacker.card)) ||
        preventsAttackerType(targetPassives.preventDamageFromTypes, attacker?.card) ||
        // D251 — the FOURTH and last of the gate's read sites. `attacker?.card`
        // and not `attacker.card`: `hasPrintedAbility` takes the optional and
        // answers FALSE for an unresolvable attacker, `preventsAttackerType`'s
        // conservative direction beside it.
        (targetPassives.preventDamageFromHasAbility && hasPrintedAbility(attacker?.card)) ||
        // D255 — the FOURTH and LAST of the SIXTH prevent's read sites, and the one
        // that makes the count four rather than five: `attackEffectRefused` is NOT
        // widened, because neither printed sentence carries the effects half.
        // `attacker?.card` and not `attacker.card`, its two neighbours' conservative
        // direction: an unresolvable attacker protects LESS rather than more.
        preventsAttackerClass(targetPassives.preventDamageFromAttackerClasses, attacker?.card) ||
        // D252 — the FOURTH of the wide prevent's five read sites, and the last of
        // its four DAMAGE ones. `attacker?.active` and not `attacker.active`:
        // `attackerHasSpecialEnergy` takes the optional and answers FALSE for an
        // unresolvable attacker, its two neighbours' conservative direction.
        (targetPassives.preventDamageAndEffectsFromSpecialEnergy &&
          attackerHasSpecialEnergy(state, attacker?.active)) ||
        // D253 — the FOURTH read site, and the second of the three DEAD ones:
        // `snipeActive` damages `target.active`, so the zone clause `passivesOf`
        // already folded is false here by construction. Total, not case-covering.
        targetPassives.preventDamageAndEffectsWhileBenched ||
        // D257 — the FOURTH and LAST of the seventh prevent's read sites, and the
        // count is FOUR rather than five for D240's reason and D255's together:
        // `attackEffectRefused` is NOT widened, because the printed sentence has no
        // effects half AND because an EFFECT has no damage for a threshold to be
        // about. ✅ AND THIS ARM IS LIVE, WHICH MAKES THIS THE FIRST PREVENT SINCE
        // D255 WITH FOUR LIVE SITES AND THE FIRST EVER WHOSE FOUR ARE LIVE FOR A
        // REASON READ OFF THE PRINT: "done to this Pokémon" names no zone, so
        // neither the Active arms nor the Bench arms can be dead by construction.
        preventedByDamageThreshold(targetPassives.preventDamageAtOrAbove, wouldDeal) ||
        attackDamageBlocked(state, target.active, attacker?.card, wouldDeal, ctx))) ||
    // D254 — "all", and DEAD for both sentences for `attack.ts`'s reason verbatim:
    // `snipeActive` damages `target.active` and the shared TARGET clause reads
    // "your BENCHED Pokémon". Total, not case-covering; no mutant, because none
    // could be killed.
    benchShieldedFromDamage(state, target.active, "all") ||
    stadiumPreventsDamage(state, target.active, attacker?.card);
  // D258 — the EIGHTH prevent, at the FOURTH and LAST of its read sites, and FOUR
  // rather than five for D255's reason: `attackEffectRefused` is NOT widened, because
  // "prevent that damage" has no effects half. ✅ ALL FOUR ARE LIVE, D257's answer for
  // D257's reason — neither printed sentence names a zone, so an Active Kecleon and a
  // benched one are protected alike. `ignoreWR` folds into the argument (the
  // `placeSnipe` arm one function up says why the difference matters for the RNG).
  const [flipPrevented, rngState] = coinFlipShieldPrevents(
    state,
    target.active,
    opponent,
    preventedBeforeFlip || ignoreWR ? 0 : wouldDeal,
    events,
  );
  const prevented = preventedBeforeFlip || flipPrevented;
  const dealt = prevented ? 0 : wouldDeal;
  // §8.1 (D208) — the KO-survival clamp, at the fourth and last of its write
  // sites. `target.active` is the pre-hit body; this arm runs the FULL §8.5
  // pipeline, so it is unambiguously "damage from an attack".
  const clamped = koSurvivalClamp(state, target.active, dealt);
  const damage = clamped ?? target.active.damage + dealt;
  events.push({
    type: "DAMAGE_DEALT",
    seat: opponent,
    by: ctx.seat, // 🆕🆕 D425 — snipeActive aims across the table.
    uid: target.uid,
    base: amount,
    bonus: bonus > 0 ? bonus : undefined,
    debuff: debuff > 0 ? debuff : undefined,
    weakness,
    resistance,
    reduction: reduction > 0 ? reduction : undefined,
    prevented: prevented ? true : undefined,
    survived: clamped === null ? undefined : true,
    dealt,
    damage,
  });
  const hit = withActive({ ...state, rngState }, opponent, { ...target.active, damage });
  // 🆕 §9 — THE TWO REACTIONS THE DAMAGED ACTIVE OWES, SEEDED AT THE DAMAGE AND
  // NOT AT ONE CODE PATH. `attack.ts` seeds the `damageAttacker` recoil (Rocky
  // Helmet, Counterattack Quills, Custom Trap + D152's installed half) and the
  // `onDamagedByAttack` stage (Armarouge "Scorching Armor", Klawf ex
  // "Counterattacking Pincer") from inside its `scaledBase + scaledTotal > 0`
  // block — which is exactly the block D316 and D317 stop entering, because their
  // readers force `scaledBase` to 0 and re-home the WHOLE main hit into a
  // `damageDefender` nested in the gate they build (Chien-Pao ex's `programDamage`
  // took the same ending years earlier). The printed antecedent is "is damaged by
  // an attack", and a re-homed hit is damage from an attack by every test this
  // engine already applies to it: the same §8.5 pipeline, the same `DAMAGE_DEALT`
  // row, the same §8.1 survival clamp, the same power to Knock the body Out.
  //
  // ⚠️ THIS FUNNEL AND NOT `placeSnipe`. Both printed sentences scope the ACTIVE
  // SPOT — Rocky Helmet spells it, and the `onDamagedByAttack` scan is `activeOnly`
  // — and `placeSnipe` damages the BENCH and only the Bench. So the interpreter's
  // one Active-target §8.5 site is also the complete one; a benched holder finished
  // off by a spread still gets nothing, which is the behaviour that was already
  // right and is left alone.
  //
  // ⚠️ GATED ON `invokedBy === "attack"` because the printed clause is, and because
  // the stage it queues only makes sense inside an attack's epilogue queue. An
  // Ability that ever derives one of these ops damages nobody "by an attack".
  return dealt > 0 && ctx.invokedBy === "attack"
    ? reactToAttackDamage(hit, opponent, target.uid, ctx.seat, target.active, dealt, events)
    : hit;
}

/** §9 — the two REACTIONS a damaged Active owes the Attacking Pokémon, applied at
    the interpreter's §8.5 funnel for a hit `attack.ts` no longer folds itself.
    Byte-for-byte the pair `attack.ts` runs after its own main hit, and deliberately
    so: the RECOIL is synchronous flat damage OUTSIDE the pipeline (no Weakness, no
    Resistance — the confusion-self-hit model, labelled `"counterattack"` by
    MECHANISM because the sum has lost every provenance, D141/D152), and the TRIGGER
    is a STAGE because its program can PARK (Klawf ex asks the DEFENDER which Energy
    to discard).

    ⚠️ THE STAGE IS SPLICED IN FRONT OF THE EPILOGUE, NOT APPENDED. `attack.ts` has
    already queued `[damagedTrigger?, koToolTrigger?, attackEpilogue]` before running
    the program, and `attackEpilogue` is the §8.1 sweep — so appending would run the
    reaction AFTER the Knock Out it is printed to survive ("even if this Pokémon is
    Knocked Out"), and after the `koToolTrigger` whose own doc block argues that
    "damaged" precedes "Knocked Out" in the same instant. Inserting at the first of
    those two stages puts it exactly where attack.ts would have put it. With no
    epilogue queued at all (an Ability route) there is nothing to sit in front of,
    and the append is unreachable rather than meaningful — `invokedBy` has already
    refused that caller.

    ⚠️ AND IT IS SEEDED AT MOST ONCE PER BODY. An attack whose main hit landed AND
    whose program then damages the same Active again would otherwise announce the
    Ability twice for one "is damaged"; the `pending` scan is the check, and it is a
    scan rather than a flag because `pending` is the only thing that outlives this
    call. */
function reactToAttackDamage(
  state: GameState,
  damagedSeat: Seat,
  damagedUid: string,
  attackerSeat: Seat,
  damagedBody: InPlayPokemon,
  // 🆕🆕 D456 — `dealt` from the caller, for `installedRecoilOf`'s unprinted amount
  // (corpus line 180). It is the SAME number the caller's own `dealt > 0` gate reads,
  // passed rather than recomputed so the gate and the amount can never disagree.
  damageTaken: number,
  events: GameEvent[],
): GameState {
  let next = state;
  const attacker = activeTop(next, attackerSeat);
  const recoil =
    passivesOf(next, damagedBody).damageAttacker +
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

/** The effective snipe amount — `amount`, or `amount × <a board count>` when the op
    scales by one. Read from state at the moment the op runs (and again at the pick,
    unchanged — no KO and no attachment intervenes), the interpreter's counterpart to
    attack.ts's pre-W/R fold over `AttackDamageBonus{per, count}`.

    🛑 **THIS IS THE SECOND, PARALLEL FOLD AND IT HAS BEEN SINCE WO-CHIEN.** The §8.5
    fold in `attack.ts` reaches the DEFENDING Active only and speaks
    `DamageCountSource`; this one reaches a CHOSEN body and speaks the op's own
    riders. `scaledAttackDamage` is not reachable from here in either sense —
    `attack.ts` imports this module, so the import would be a cycle, and its signature
    needs the attack's printed `cost` (for `extraEnergyUnitsBeyondCost`), which
    `EffectContext` does not carry. **Saying "the count reaches a new consumer" would
    be wrong: what this slice does is give the fold that already exists a second
    inhabitant.** See `damageChosen.perEnergyOnSelf` (effects.ts) for the price of
    collapsing the two riders into one `DamageCountSource` field, and for the trigger
    that overturns that refusal.

    🆕🆕🆕 **D448 — `perEnergyOnSelf`, THE SECOND RIDER.** *"…for each Energy attached
    to this Pokémon"* counts Energy CARDS on the ATTACKER (`countAttachedEnergy` with a
    null filter — the same reading `scaledAttackDamage`'s `energyOnSelf` arm gives, and
    the same helper), read off `activeTop(state, ctx.seat)` because only the Active
    attacks (§8). ⚠️ **A null Active yields 0 and therefore no pick and no damage**, the
    same ending a 0-taken-Prizes Covetous Ivy has: an attacker that has left the Active
    Spot before its own program runs is a board no printed sentence in this family can
    reach, and the alternative — treating "no attacker" as an unscaled hit — would be
    the plausible degradation D421 says to design against.

    ⚠️ **THE TWO RIDERS ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION AT EVERY WRITER**, and
    the `if` order below is therefore not a precedence: `deriveAttackEffect` refuses the
    string that spells both, and no other producer sets either alongside the other. */
function snipeAmount(
  op: { amount: number; perTakenPrize?: true; perEnergyOnSelf?: true; perRecorded?: EffectSlot },
  state: GameState,
  ctx: EffectContext,
  record: EffectRecord,
): number {
  if (op.perTakenPrize === true) return op.amount * takenPrizes(state, otherSeat(ctx.seat));
  // 🆕🆕🆕 **D489 — THE THIRD RIDER, AND THE ONLY ONE THAT NEEDS AN ARGUMENT THIS
  // FUNCTION DID NOT TAKE.** *"…for each Energy card you discarded in this way"*
  // counts a quantity the sentence's OWN HEAD produced, so the source is the run's
  // §9.2 record rather than the board — `recorded` is the same reader
  // `damageDefender`'s `scoredSlot` uses, one op over. Both call sites already had
  // `record` in scope (`stepOp` takes it; `applyChoice` takes it), which is what
  // makes this four lines instead of a channel: `resumeProgram` seeds its
  // accumulator from `cont.record`, so the number the caption quoted and the number
  // the hit deals are the same value on both sides of the park.
  // ⚠️ **`undefined` AND NOT A BOOLEAN**: an `EffectSlot` is an ADDRESS and there
  // are three of them, so the rider names the one it reads (see effects.ts).
  if (op.perRecorded !== undefined)
    return op.amount * recorded(record, op.perRecorded).length;
  if (op.perEnergyOnSelf !== true) return op.amount;
  // ⚠️ NAMED FOR THE PRINTED NOUN AND NOT `attacker`, WHICH IS D446's RULE AND WAS
  // EARNED HERE: `const attacker = activeTop(state, ctx.seat);` is `snipeActive`'s line
  // verbatim, three hundred lines up, and writing it here made a mutant `find` occur
  // TWICE the moment it was authored — D437's converse trap, caught by `precheck` in
  // seconds. The repair is the NAME rather than a wider anchor, so the two sites cannot
  // be tidied back into twins.
  const thisPokemon = activeTop(state, ctx.seat);
  return thisPokemon === null ? 0 : op.amount * countAttachedEnergy(state, thisPokemon.active, null);
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
  target: "opponentBench" | "opponentAny" | "yourBench" = "opponentBench",
  /** 🆕🆕 D437 — `op.damagedOnly`. The caption must name exactly the set the funnel
      offers or the dialog contradicts its own validator (`gustTargetNoun`'s and
      `knockOutChosenNote`'s stated rule), and here that matters more than usual:
      the narrowed prompt can offer TWO of a five-body Bench, and a heading that
      still said "your opponent's Benched Pokémon" would read as a mis-built offer
      rather than as the card doing what it prints. */
  damagedOnly = false,
  /** 🆕🆕🆕 **D483 — `op.filter`, the printed candidate CLASS, and it is owed for
      `damagedOnly`'s reason one parameter up (D478: a describer obligation follows the
      CALL PATH).** The narrowed prompt can offer ONE of a four-body Bench, and a heading
      that still said *"your opponent's Benched Pokémon"* would read as a mis-built offer
      rather than as the card doing what it prints — `gustTargetNoun`'s and
      `knockOutChosenNote`'s stated rule.

      🛑 **THE PHRASE IS `retrieveNoun`'s AND NOT A SECOND TABLE**, which is what makes
      this the FIRST PROMPT EVER TO REACH that function's `suffixPokemon` arm: D446 wrote
      it as an arm owed by an exhaustive switch and said in as many words that *"no op
      carries this filter today"*. This op does, and the `anyOf` join above it renders the
      pair.

      ⚠️ **THE CAPTION SAYS *"Benched Pokémon ex or Pokémon V"* WHERE THE CARD PRINTS
      *"Benched Pokémon ex or Benched Pokémon V"***, because the join is `retrieveNoun`'s
      and the zone word is written once. Deliberate and NOT a rounding — `typedPokemon`'s
      arm makes the same call one member over — and unambiguous inside a prompt whose
      candidates are all Benched. A second spelling here would be the second answer to one
      question (D159), and it is the answer `matchesFilter` does not have. */
  narrowing?: CardFilter,
): string {
  const verb = optional ? "You may choose" : "Choose";
  const each = deals
    ? `${amount} damage`
    : `${Math.round(amount / 10)} damage counter${Math.round(amount / 10) === 1 ? "" : "s"}`;
  // `opponentAny` offers the Active too, so the heading drops "Benched".
  const noun = narrowing === undefined ? "Pokémon" : retrieveNoun(narrowing).plural;
  const zone = target === "opponentAny" ? noun : `Benched ${noun}`;
  // 🆕🆕🆕 **D447 — THE HEADING NAMES WHOSE BENCH IT IS, BECAUSE THE CANDIDATE SET
  // NOW DEPENDS ON THAT.** `snipeTargets` offers the ATTACKER's own Bench under
  // `yourBench`, and a dialog that still read *"Choose 1 of your opponent's Benched
  // Pokémon"* over a list of the player's OWN bodies would contradict its own
  // validator — `gustTargetNoun`'s and `knockOutChosenNote`'s stated rule, and D437's
  // reason for the window below. The printed sentence is *"1 of YOUR Benched
  // Pokémon"*, so the caption quotes it.
  const owner = target === "yourBench" ? "your" : "your opponent's";
  // 🆕🆕 D437 — the window rides AFTER the noun because that is where the print puts
  // it, `knockOutChosenNote`'s line verbatim. ⚠️ **SINGULAR ONLY, AND THAT IS NOT AN
  // OVERSIGHT**: the clause is printed *"that has … on it"*, and `ALSO_BENCHED_SNIPE`
  // refuses it against any count but 1 on exactly that number agreement, so a plural
  // spelling here would be a branch no build can reach — the unreachable arm D205
  // says to remove rather than test around.
  const window = damagedOnly ? " that has any damage counters on it" : "";
  return `${verb} ${count} of ${owner} ${zone}${window} (${each} each).`;
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

/** 🆕🆕 **D386 — the one place a healed body is written, and therefore the one
    place `InPlayPokemon.healedTurn` is stamped.** Every caller below files a
    `HEALED` event on the line above its call, so the event and the stamp are
    written together and cannot drift apart — D222's rule (two readers of one fact
    become one helper) applied to a WRITER pair.

    `healed` is always the amount already clamped to `pokemon.damage` by the
    caller, so the subtraction here cannot go negative and the caller keeps its own
    zero-guard: a whiff never reaches this function, which is exactly why a stamp
    written here means *"damage was actually removed"* rather than *"a heal was
    attempted"*. That distinction is the printed one — Maractus asks whether this
    Pokémon **was healed**, not whether somebody aimed a Potion at it.

    ⚠️ **`turn` IS PASSED RATHER THAN READ OFF A `GameState`**, because two of the
    seven callers are inner `healOne` closures over a body and have no state in
    scope at the point of the write. Passing the number also keeps the helper
    total: there is no board it can be wrong about. */
function healedBody(pokemon: InPlayPokemon, healed: number, turn: number): InPlayPokemon {
  return { ...pokemon, damage: pokemon.damage - healed, healedTurn: turn };
}

/** Heal `amount` HP from EACH of the controller's own in-play Pokémon
    (Garganacl "Blessed Salt", between turns). Each heal is clamped to the
    Pokémon's damage and emits its own HEALED (an undamaged Pokémon heals 0 and
    emits nothing). Active then bench, in index order. Never parks.

    `pokemonType` is D266's optional TYPE GATE (Clemont's Quick Wit, *"…each of
    your {L} Pokémon"*). It is a FILTER INSIDE THE LOOP and not an early return,
    because the op names a SET rather than one body: an off-type Pokémon is
    SKIPPED — as silently as an undamaged one — while its neighbours still heal.

    ⚠️ **IT IS A BOARD READ, AND IT READS THE TOP CARD.** The printed type of an
    in-play Pokémon is the type of the card on TOP of the stack (an evolved body
    is its evolution's type, not its Basic's), which is why this goes through
    `topCardOf` rather than through the `InPlayPokemon`'s own fields — the same
    datum and the same `(card?.types ?? []).includes(...)` spelling that
    `attachEnergyTargets`' `targetType` rider reads one seam over, so a board's
    "{L} Pokémon" cannot mean two things in one engine. `types` is a LIST, so a
    dual-type body satisfies either half. A card the pool cannot resolve reads as
    an EMPTY list and is REFUSED: a data gap is never healed by default.

    🆕🆕 **D461 — TWO MORE NARROWINGS, AND THEY ARE READ AT TWO DIFFERENT PLACES IN
    THIS FUNCTION BECAUSE THEY ARE TWO DIFFERENT KINDS OF FACT.** `basicOnly`
    (*"each of your **Basic** Pokémon"*, 2 legal printings) is a CARD fact and so it
    is a conjunct INSIDE the walk, beside `pokemonType` and for the same reason: the
    op names a SET, so a non-Basic body is skipped as silently as an undamaged one
    while its neighbours still heal. `benchOnly` (*"each of your **Benched**
    Pokémon"*, 2) is a BOARD fact about ONE named spot, so it is not a conjunct at
    all — it decides whether the walk visits the Active, and the Active's body is
    carried through UNCHANGED when it does not.

    🛑 **THE ZERO QUESTION IS ANSWERED BY THE SHIPPED GUARD AND THIS SLICE ADDS NO
    FOURTH ONE** (D451's finding, applied). This project has three zero-shapes: a
    guard before a PARK, a whole-op `amount <= 0` refusal, and this function's
    PER-BODY `healed <= 0` skip. The right one is decided by whether the amount is
    a producer's constant or varies per body — a heal clamps to each body's OWN
    damage (`Math.min(amount, pokemon.damage)`), so it varies, and the per-body skip
    is the shipped answer. Both new riders SHRINK the set the skip runs over; they
    do not change what zero means. An EMPTY set (a `benchOnly` heal on an empty
    Bench, a `basicOnly` heal on an all-evolved side) is therefore the all-whiffed
    board with no bodies rather than a new case: zero HEALED rows, no park, no
    ATTACK_EFFECT_SKIPPED, and the attack still reports as SIMULATED. */
function healEach(
  state: GameState,
  op: Extract<EffectOp, { op: "healEach" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // 🆕🆕 D461 — the op arrives WHOLE rather than field by field, because the printed
  // set is now narrowed on two independent axes and a sixth positional parameter is
  // how a call site starts passing the wrong one. The two locals below are the two
  // fields that were already parameters, kept under their own names so the reads
  // inside the walk are byte-identical to the ones D266 pinned.
  const { amount, pokemonType } = op;
  const side = state.players[ctx.seat];
  const healOne = (pokemon: InPlayPokemon): InPlayPokemon => {
    // 🆕🆕 D461 — the printed *"Basic"*, and it is READ FIRST because that is the
    // printed order: a hypothetical *"each of your Basic {L} Pokémon"* prints the
    // stage word ahead of the type code. Asked through `matchesFilter`'s OWN
    // `basicPokemon` arm so board-side "Basic" stays ONE predicate — `gust`,
    // `knockOutChosen` and `attachEnergyTargets` all ask this question the same way.
    // ⚠️ AN UNRESOLVABLE TOP CARD IS SKIPPED, NEVER HEALED: `matchesFilter` answers
    // false for `undefined`, its conservative direction, which is the same direction
    // the `pokemonType` gate below takes for the same reason (a data gap is never
    // healed by default).
    if (op.basicOnly === true) {
      const card = topCardOf(state, pokemon);
      if (!matchesFilter(card, { kind: "basicPokemon" })) return pokemon;
    }
    if (pokemonType !== undefined) {
      const card = topCardOf(state, pokemon);
      if (!(card?.types ?? []).includes(pokemonType)) return pokemon;
    }
    const uid = topUid(pokemon);
    const healed = Math.min(amount, pokemon.damage);
    if (uid === undefined || healed <= 0) return pokemon;
    events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
    return healedBody(pokemon, healed, state.turn);
  };
  // 🆕🆕 D461 — the printed *"Benched"* removes the ACTIVE from the set entirely, and
  // the spot KEEPS ITS BODY: `side.active` is carried through unchanged rather than
  // nulled, which is the difference between "not in the set" and "not on the board".
  // Absent, this is D133's reading — the Active is one of your Pokémon (§1.1) — and
  // from an ATTACK the Active is the ATTACKER, which is the body a bench-scoped
  // sentence must leave damaged.
  const healsActive = op.benchOnly !== true;
  const active = side.active !== null && healsActive ? healOne(side.active) : side.active;
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
      return healedBody(pokemon, healed, state.turn);
    };
    const active = side.active === null ? null : healOne(side.active);
    const bench = side.bench.map(healOne);
    next = withSide(next, seat, { ...side, active, bench });
  }
  return next;
}

/** 🆕 D340 — PUT `amount` HP of damage counters on EVERY in-play body on BOTH
    boards matching `filter`, minus any named by `exceptNamed`. Froslass
    `sv06-053`/`sv06-174`/`svp-117` "Freezing Shroud": *"During Pokémon Checkup,
    put 1 damage counter on each Pokémon that has an Ability (both yours and your
    opponent's), except any Froslass."*

    `healEachAll`'s walk exactly — `SEATS` in order, Active then Bench per seat,
    one event per body that actually took counters, tagged with that Pokémon's OWN
    seat rather than the controller's. The two ops are deliberately the same shape
    because they are the same printed parenthetical (*"both yours and your
    opponent's"*), and a reader comparing them should see one walk twice.

    🛑 **THE TWO PREDICATES ARE READ IN THE PRINTED ORDER AND THE SECOND IS A
    SUBTRACTION**, not a conjunction: `filter` must HOLD and `exceptNamed` must NOT
    match. A Froslass HAS an Ability, so it satisfies the noun and is then removed
    by the exemption — an `&&` of the two would counter every Froslass on the
    table, and the suite drives that exact body rather than arguing it.
    `preventOpponentPokemonPlay`'s `only`/`except` pair (continuous.ts) is the same
    subtraction one file over, and `switchActive.exceptNamed` (D273) is the same
    rider on the same axis.

    ⚠️ **AN UNRESOLVABLE TOP CARD IS SKIPPED, NEVER COUNTERED** — `matchesFilter`
    is false for `undefined`, its conservative direction, so a body whose top card
    cannot be read falls out on the FILTER line and never reaches the exemption.
    That ordering matters: reading the exemption first would let such a body
    through on `card?.name !== exceptNamed`, which is true of `undefined`.

    ⚠️ **`amount` IS ALREADY HP** (§12); the registry does the printed
    counter → HP conversion, exactly as `TREVENANT`'s `amount: 10` does, so this
    helper never sees the printed unit and cannot convert twice. `amount <= 0` is
    refused whole — the guard every placement arm carries — so a malformed row is a
    loud no-op rather than a board's worth of silent ones.

    ONLY RAISES DAMAGE, NEVER KOs: the sweep that resolves any Knock Out a placed
    counter caused belongs to the CALLER — the Checkup's for the triggered Ability
    (`runCheckupTriggers`' stable-bench-length precondition still holds, because
    nothing is removed here) and, since D450, `finishAttack`'s for the attack.
    Never parks.

    🆕🆕🆕 **D450 — THE THREE SEAMS BETWEEN AN ABILITY CALLER AND AN ATTACK ONE,
    ALL THREE OF THEM IN THIS BODY.**

    · **`op.side`** picks the seat list. `"both"` is `SEATS`, byte-for-byte the walk
      this function has always done; `"opponent"` is `otherSeat(ctx.seat)` alone,
      which is the ONLY thing corpus lines 414 and 415 needed and did not have.
      A `switch` on `spreadDamage`'s own rule (D222): a third member stops compiling
      here rather than falling out of the wrong branch of a negated test.

    · **`op.source`** rides the op instead of being hardcoded `"ability"`, D136's
      finding 1 for the fourth time on this axis (D138, D139, D140 paid for the
      first three). `log.ts`'s `COUNTERS_PLACED` switch renders `"ability"` as
      *"Ability: N damage to X"* — a row naming a mechanism an attack never used.
      ⚠️ **AND THE `"attack"` ARM'S OWN STATED REASON NARROWS HERE (D433's
      second-producer rule).** That arm says the row is SYSTEM-voiced because
      *"`seat` owns the DAMAGED Pokémon, which for an attack is the attacker's
      OPPONENT"* — no longer universal, because `side: "both"` damages the
      ATTACKER's own bodies too. The row is still right, and for a WIDER reason
      than the one written: a system row names no actor at all, so it cannot credit
      the wrong one whichever seat owns the body.

    · **§11 IS ASKED PER BODY, NOT PER OP**, through `effectRefused`'s D259 `target`
      parameter — `unshieldedRefs`' judgement reached by a walk instead of by a
      candidate list. A spread placer that refused WHOLE would let one shielded
      Fraxure protect an entire board, a rule no printing states; asking per body
      means a shield on one silences exactly one and files exactly one
      ATTACK_EFFECT_PREVENTED row. It is asked AFTER the noun, the exemption and the
      window (D433: narrow, then ask), so a body the sentence never reached files no
      prevention row. ⚠️ **AND THE ABILITY CALLER IS BYTE-IDENTICAL ACROSS THIS
      CHANGE**: `effectRefusedOn` returns `false` at `ctx.invokedBy !== "attack"`,
      and a triggered Ability leaves `invokedBy` ABSENT — so Froslass asks the gate,
      is never refused, and pushes no event. ⚠️ **AND THE OWN-SIDE HALF OF
      `side: "both"` IS ANSWERED BY THE GATE RATHER THAN BY THIS FUNCTION**:
      D430's `seat === ctx.seat` line returns `false`, because every §11 shield in
      the pool names the ATTACK'S SOURCE and the source it names is the holder's
      opponent. A Mist Energy on the attacker's own Bench does not stop the
      attacker's own sentence, and that is measured at the gate, not assumed here.

    ⚠️ **THE LOCAL IS `board` AND NOT `side`** — the op now HAS a `side`, and two
    different things under one name three lines apart is how a reader mis-attributes
    a seat (D448's naming rule, arriving as a rename rather than as a collision). */
function counterEachAll(
  state: GameState,
  op: Extract<EffectOp, { op: "counterEachAll" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const { amount, filter, exceptNamed } = op;
  if (amount <= 0) return state;
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
      const card = topCardOf(next, pokemon);
      if (!matchesFilter(card, filter)) return pokemon;
      if (exceptNamed !== undefined && card?.name === exceptNamed) return pokemon;
      if (op.damagedOnly === true && !hasAnyDamageCounters(pokemon)) return pokemon;
      const uid = topUid(pokemon);
      if (uid === undefined) return pokemon;
      if (effectRefused(next, seat, ctx, events, pokemon)) return pokemon;
      events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: op.source });
      return { ...pokemon, damage: pokemon.damage + amount };
    };
    const active = board.active === null ? null : counterOne(board.active);
    const bench = board.bench.map(counterOne);
    next = withSide(next, seat, { ...board, active, bench });
  }
  return next;
}

/** 🆕🆕🆕 D451 — PUT damage counters on the opponent's bodies in `op.target` UNTIL
    each one's REMAINING HP is `op.remainingHp`. Alolan Raticate's and Palossand ex's
    sentences: *"Put damage counters on your opponent's Active Pokémon until its
    remaining HP is {10|50}."* and *"…on each of your opponent's Benched Pokémon until
    its remaining HP is 100."* (`censusAttackCorpus.ts` lines 426/427/425 — 3 sentences
    / 5 legal printings).

    🛑 **THE AMOUNT IS COMPUTED PER BODY AND THE OP CARRIES NONE.** `remaining` is
    `effectiveMaxHp − damage` — the engine's ONE definition of the printed phrase, the
    same one `remainingHpWithin` (continuous.ts) reads for the catalog's other three
    *"remaining HP"* printings — and the placement is `remaining − op.remainingHp`. So
    the maximum is the CONTINUOUS one: a Bravery Charm on a Benched body raises the
    destination it is filled to, and Gravity Mountain lowers it. The printed `hpOf`
    would get both wrong on the same board.

    🛑 **THE DISTRIBUTIVE *"its"*, WHICH IS THE WHOLE OF THE BENCH ARM.** The subtraction
    happens INSIDE the per-body closure, so each body is filled to `op.remainingHp`
    independently. There is no shared total and no `amount` to hoist — a build that
    computed one figure above the walk would place the first body's number on every
    body, and the board that shows it is a Bench whose two bodies carry different damage.

    ⚠️ **THE FLOOR IS PER BODY AND IT IS `healEachAll`'s, NOT `counterEachAll`'s.**
    Those two ops guard `amount <= 0` ONCE, above the walk, because their amount is a
    constant handed in by the producer. This one's varies per body, so the guard has to
    vary with it: a body already AT or BELOW the destination takes zero, files no
    `COUNTERS_PLACED` and leaves its neighbours alone — exactly the way an undamaged
    body heals 0 and emits nothing two ops up. Never negative.

    🛑 **IT CANNOT KNOCK ANYTHING OUT, AND `op.remainingHp <= 0` IS THE GUARD THAT MAKES
    THAT A PROPERTY OF THIS FUNCTION RATHER THAN OF TODAY'S CATALOG.** A body that takes
    counters ends at `damage = max − op.remainingHp`, which is `>= max` — i.e. lethal —
    exactly when `op.remainingHp <= 0`. Every printed destination is 10, 50 or 100, so
    the guard is unreachable from the deriver (arms 23g/23h refuse `< 1` first); it is
    written anyway for D324's reason verbatim, because the alternative is an invariant
    stated in three doc blocks and asserted by no line of code. **A future *"until its
    remaining HP is 0"* deletes this line and owes a Knock Out, a Prize and a
    `koByEffect` marker in the same slice** — this op emits none of the three, and
    `finishAttack`'s two-seat sweep (flow.ts) is the caller that would resolve one.

    ⚠️ **NO ROUNDING TO WHOLE COUNTERS.** §12 makes a counter 10 HP, but `damage` need
    not be a multiple of ten (a halved hit leaves 5) and neither need `effectiveMaxHp`
    once a Tool or a Stadium is on the board. The printed word is *"until"*, so the exact
    difference is placed and the destination is hit on the nose; `Math.ceil(x / 10) * 10`
    would overshoot past it and could reach `max`, which is the one thing this op must
    never do.

    ⚠️ **A `null` MAXIMUM PLACES NOTHING** — the catalog data gap `effectiveMaxHp` owns,
    refused in the same direction `remainingHpWithin` refuses it: an unknown maximum
    cannot be subtracted from, and a data gap is never damaged by default.

    ⚠️ **§11 IS ASKED PER BODY AND AFTER THE AMOUNT (D433: narrow, then ask).** A shield
    on one Benched body silences exactly that body and files exactly one
    ATTACK_EFFECT_PREVENTED; refusing the op whole would let one Rabsca protect a Bench,
    a rule no printing states. A body that was going to take ZERO is never asked, so a
    body the sentence did not reach files no prevention row — `counterEachAll`'s
    ordering, one op up, on a window that is arithmetic instead of a rider. */
function counterUntilRemainingHp(
  state: GameState,
  op: Extract<EffectOp, { op: "counterUntilRemainingHp" }>,
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
  if (effectRefused(state, opponent, ctx, events)) return state;
  events.push({ type: "COUNTERS_PLACED", seat: opponent, uid, amount, source });
  return withActive(state, opponent, { ...active, damage: active.damage + amount });
}

/** 🆕 D319 — "put `amount` damage counters on THAT POKÉMON" (Team Rocket's
    Ampharos "Darkest Impulse" 4, Gengar ex "Gnawing Curse" 2). The referent is
    `ctx.subjectUid`: the body the opponent's own watched action was performed
    on, which is on `otherSeat(ctx.seat)` by construction and may sit in EITHER
    spot — an evolve and an attach both reach the Bench, which is precisely why
    `damageActive` cannot serve this sentence.

    ⚠️ TWO SILENT ENDINGS, AND BOTH ARE REACHABLE RATHER THAN DEFENSIVE. No
    `subjectUid` at all (a program that got here outside a watched action) and a
    `subjectUid` that no longer names a body on that seat's board (it was Knocked
    Out, or returned to hand, by something between the action and this op) both
    resolve to nothing — the whiff `sourceUid`'s readers already take.

    🛑 NO `effectRefused` CALL, AND THE ABSENCE IS THE CLAIM. That channel answers
    "prevent all effects of ATTACKS / of that card done to this Pokémon" (§11,
    D142/D259) and reads `ctx.invokedBy`, which is ABSENT for every trigger — so a
    call here would be a line that cannot fire on any board this catalog builds,
    i.e. green and dead. `damageActive` calls it because that op IS reached from
    attack programs. The day a watched trigger becomes an attack's effect, this
    line is the one to add, and it will have a reader on the day it is written. */
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
    events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: "ability" });
    return withActive(state, seat, { ...active, damage: active.damage + amount });
  }
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === uid);
  if (index === -1) return state;
  events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: "ability" });
  return withSide(state, seat, {
    ...side,
    bench: side.bench.map((pokemon, i) =>
      i === index ? { ...pokemon, damage: pokemon.damage + amount } : pokemon,
    ),
  });
}

/** 🆕 D356 — heal `amount` from the body the watched action was performed on, on
    the CONTROLLER's own board (Magearna sv09-107 "Auto Heal"). The pronoun twin of
    `damageSubject` above; see `effects.ts` for why the seat is `ctx.seat` here and
    `otherSeat(ctx.seat)` there — the printed possessive, not the scan direction.

    Active first, then the Bench, because the subject can be either: Magearna's
    sentence says *"1 of your Pokémon"*, and a bench attach is its most common
    use (the Active is where Magearna itself has to stand). */
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
  // No "is there a defender" pre-check: the shared helper answers it (its
  // destination read is `null` on an empty Active Spot) and a second one here
  // would be a guard nothing can turn red.
  const dest: PokemonRef = { seat: otherSeat(ctx.seat), spot: { spot: "active" } };
  return moveCountersFromBench(state, ref.spot.index, dest, ctx, events);
}

/** D216 — the same printed action with the destination given as a REF rather
    than as the printed words "your opponent's Active Pokémon". The whole body of
    `moveCountersToDefender` lives here, and that function is now the fixed-
    destination caller: the two rows MUST carry one number and the §11 refusal
    MUST take both or neither, and one write site is the only way those two
    invariants can stay true of both sentences at once.

    THE §11 GATE IS CONDITIONAL HERE AND UNCONDITIONAL AT THE CALLER, WHICH IS
    NOT A SOFTENING. `attackEffectRefused` asks one question — *is a wide
    `{effects: true}` block live on this seat's **ACTIVE**?* — and a §11 block is
    an Active-Spot fact by construction (`clearOnLeavingActive`). So asking it
    about a BENCHED destination is asking about a body it does not describe, and
    answering "refused" there would refuse a move the printed block never
    touched, on the evidence of a completely different Pokémon. The gate is
    therefore consulted exactly when the destination IS an Active — which for
    `moveCountersToDefender` is always, so its behaviour is byte-identical.

    The seat handed to the gate is the DESTINATION's, not `otherSeat(ctx.seat)`.
    Both printings aim at the opponent, so the two are the same value today;
    reading it off the destination is what keeps the gate describing the body
    being written to rather than a seat the caller happened to know. */
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
  const target = dest.spot.spot === "active" ? destSide.active : destSide.bench[dest.spot.index];
  // A move needs both ends, and half of one would silently launder counters off
  // the controller's board — see the doc block above.
  if (target === undefined || target === null) return state;
  const targetUid = topUid(target);
  if (targetUid === undefined) return state;
  // §11 (D142) — the destination half is a counter PLACEMENT, an effect rather
  // than damage (see `damageActive`), so the wider block refuses it. And the
  // refusal takes the WHOLE printed action with it: the two rows carry ONE
  // number because the printed verb is "move" (D138), so healing the Bench body
  // while the counters never arrive would launder damage off the attacker's own
  // board — the one outcome this op's doc block says two different numbers must
  // never produce. Checked BEFORE the HEALED row for exactly that reason.
  if (dest.spot.spot === "active" && effectRefused(state, dest.seat, ctx, events)) {
    return state;
  }
  events.push({ type: "HEALED", seat: ctx.seat, uid: sourceUid, amount: moved });
  // `moved` IS `source.damage`, so `healedBody` writes the same 0 this line has
  // always written — and writes the D386 stamp with it, which is the whole point
  // of routing every HEALED-filing write through one helper rather than seven.
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
  // Re-read the destination side off `cleared` rather than reusing `destSide`.
  // ⚠️ EQUIVALENT TODAY and recorded as such: the two differ only when the
  // destination sits on the CONTROLLER's own side, which no printing and neither
  // candidate helper (`oppAnyRefs`, the opponent's Active) can produce — but a
  // stale side there would silently undo the clearing above, which is the one
  // failure this whole function is shaped to prevent.
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
/** 🆕🆕 D465 — THE RECOIL'S SCALING FOLD. `perDamageCounterOnSelf` multiplies the
    printed `amount` by the damage counters ALREADY on the attacker — §12's unit, so
    `Math.floor(damage / 10)`, the same arithmetic `scaledAttackDamage`'s
    `damageCountersOnSelf` arm does in `attack.ts` (the two are deliberately NOT
    shared: that one is module-private, takes a defender seat and an effective cost
    array, and neither is on `EffectContext`).

    ⚠️ **IT READS THE SAME BODY `damageSelf` IS ABOUT TO WRITE, AND IT READS IT
    FIRST.** The recoil therefore never counts the counters it places — one read,
    one write, no fixed point. A fold done AFTER the placement would double every
    printing of this card.

    ⚠️ **ZERO COUNTERS YIELDS ZERO, AND ZERO IS SILENT.** An undamaged attacker takes
    no recoil and emits NO `COUNTERS_PLACED` (`damageSelf` returns `state` on a
    non-positive amount). "For each" means EACH, not "at least one" — the plausible
    degradation D421 says to design against.

    ⚠️ **A NULL ACTIVE YIELDS ZERO**, `snipeAmount`'s ending verbatim: an attacker
    that has left the Active Spot before its own program runs is a board no printed
    sentence in this family can reach, and `damageSelf` whiffs on the same null one
    line later regardless. */
function recoilAmount(
  op: { amount: number; perDamageCounterOnSelf?: true },
  state: GameState,
  ctx: EffectContext,
): number {
  if (op.perDamageCounterOnSelf !== true) return op.amount;
  const recoilingPokemon = state.players[ctx.seat].active;
  return recoilingPokemon === null ? 0 : op.amount * Math.floor(recoilingPokemon.damage / 10);
}

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
  return withActive(state, ctx.seat, healedBody(active, healed, state.turn));
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

/** 🆕 D344 — the top `n` cards of the controller's own deck, SHUFFLED AMONG
    THEMSELVES and appended UNDER the rest of it. Deduction Kit `sv08-171`'s
    printed second arm.

    🛑 **THE SHUFFLE IS OVER THE WINDOW AND NOT OVER THE DECK, AND THAT IS THE
    WHOLE CARD.** `shuffleDeck` directly above randomizes everything and would
    destroy the order the player has just declined to disturb; this leaves the
    deck's own sequence — and so every draw below the window — exactly where it
    was. Iono's `handRefresh { toBottom }` is the same rule one zone over, and
    states it in the same words.

    ⚠️ **CLAMPED TO THE DECK, NOT TO `n`.** `slice` takes what is there, so a
    deck shorter than the printed window moves what it has. The 0-card case
    returns a state that is `===`-different but value-identical and emits a row
    saying nothing happened — unreachable from the shipped park (which refuses a
    deck of fewer than 2 cards) and left unguarded rather than branched, which is
    `HAND_TO_BOTTOM_OF_DECK`'s own convention for a count that may be 0. */
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

/** Put the affected player(s)' whole hand back into their deck, then draw
    (Youngster / Judge / Brassius / Katy / Iono — the hand-refresh Supporter
    family — and, since D268, Gothitelle "Distorted Future" on the ABILITY
    surface). Two passes over the affected seats, each in a FIXED order (the
    controller first, then — for `who: "both"`: Judge, Iono — the opponent; for
    `who: "opponent"` the list is the OTHER seat and nothing else):

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
  // D268 — the SOLE seat funnel, widened by one member rather than forked. Three
  // answers, and the middle one is the whole content of `who: "opponent"`: the
  // controller's hand must NOT be in this list (Gothitelle "Distorted Future"
  // disrupts without paying), which is exactly what a two-seat board tells apart
  // and a one-seat board cannot.
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
    const count = handRefreshDrawCount(next, seat, ctx.seat, op.draw, handCount);
    next = drawToHand(next, seat, count, "effect", events);
  }
  return next;
}

/** How many cards `seat` draws in a handRefresh: a constant, its own pre-move
    hand size + delta (Brassius), its own remaining Prize count (Iono), or — D270 —
    one of a printed PAIR chosen by whether `seat` is the CONTROLLER (Harlequin
    *"you draw 5 cards, and your opponent draws 3 cards"*).
    🛑 **TWO SEATS ARE IN SCOPE HERE AND THEY ARE NOT THE SAME ONE.** `seat` is the
    seat being DEALT TO — the loop variable, and the one `handPlus`/`prizeCount`
    read their board off — while `controller` is the seat that PLAYED the card, the
    one the printed word *"you"* names. Every other member ignores `controller`
    entirely, which is exactly why it had to be passed IN rather than inferred:
    `seat` alone cannot tell "you" from "your opponent", and reading `prizeCount`
    off the controller instead would silently give both players the controller's
    count. */
function handRefreshDrawCount(
  state: GameState,
  seat: Seat,
  controller: Seat,
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
    case "perSeat":
      return seat === controller ? draw.you : draw.opponent;
  }
}

// (deck shuffling reuses rng.ts's vetted Fisher–Yates — the M1 review caught a
// biased hand-rolled variant; there is exactly one shuffle in the engine.)

/** Move the chosen searched cards deck → dest (bench Basics enter play stamped
    this turn; hand cards just append). Wire-safe: only uids actually in the
    deck move (resolveEffect already checked them against the candidate set).

    `reveal` is the op's printed *"reveal it/them"* rider, forwarded onto the
    event so `log.ts` can name the cards (D225). It is passed through rather than
    consulted here: nothing about the MOVE changes, only what the log says about
    it.

    🆕🆕 **D502 — IT RETURNS WHAT ACTUALLY MOVED, WHICH IS `retrieveMove`'s SHAPE ONE
    ZONE OVER AND NOT A NEW IDEA.** `searchDeck` gained a `recordAs`, and the set the
    §9.2 gate has to be told about is neither the OFFER nor the ANSWER: a wire-dropped
    uid never left the deck, and a Bench-bound answer is clamped to `benchSpace`
    *inside this function*, so `moved` is the only place the truth exists. The state
    half is returned unchanged in every other respect; a caller with no `recordAs`
    reads `.state` and the board is byte-identical to what it was. */
function searchMove(
  state: GameState,
  uids: readonly string[],
  dest: "bench" | "hand" | "deckTop",
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
      : // 🆕 D342 — "…then put those cards on top of it". The cards never leave
        // the deck ZONE at all: they come out of `deck` and go straight back
        // onto its front, so this is the one destination for which the card
        // count in every public zone is invariant across the whole op.
        //
        // 🛑 THE PLACEMENT ORDER IS THE ANSWER'S ORDER AND IT IS DELIBERATELY
        // NOT THE FINAL WORD. `moved` is `uids` filtered by deck membership, so
        // the player's pick order lands as the initial top-of-deck order — and
        // then `reorderTop` parks over exactly this window and lets them say it
        // again, properly, with the sequence shown back to them. Seeding it from
        // the pick rather than from deck order is what makes the identity
        // permutation mean "leave it as I picked it" instead of "leave it as the
        // deck happened to be", which is the only reading in which declining to
        // re-drag anything is a sensible answer.
        //
        // ⚠️ AND THERE IS NO SHUFFLE HERE. The printed shuffle is its own op and
        // has already run (`searchTopOrderProgram`, effects.ts); doing it here
        // as well would scramble the deck a second time and — worse — would do
        // it AFTER the placement, burying the cards this sentence exists to put
        // on top.
        dest === "deckTop"
        ? { ...side, deck: [...moved, ...deck] }
        : { ...side, deck, hand: [...side.hand, ...moved] };
  // Spelled as two whole objects rather than a conditional spread: the flag is
  // ABSENT when the print carries no reveal (D135), and `reveal: undefined`
  // is not the same wire value as no key at all.
  events.push(
    reveal === true
      ? { type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved], reveal: true }
      : { type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved] },
  );
  // ⚠️ D502 — THE TRAILING COMMENT IS D447's REPAIR AND NOT DECORATION. Giving this
  // function a `{state, moved}` return made this line BYTE-IDENTICAL to
  // `retrieveMove`'s last line ~190 lines down, which is D437's converse trap
  // (writing a line that already exists elsewhere breaks a row you never touched).
  // The two must stay distinguishable to `precheck`, so do not "tidy" this away.
  return { state: withSide(state, ctx.seat, updated), moved }; // searchMove
}

/** 🆕 D307 — what an `evolveFromDeck` op is offering: the body the pronoun *"this
    Pokémon"* names, where it sits, and the cards in the controller's deck that
    would legally go on top of it.

    🛑 **THE PREDICATE IS `evolve`'s OWN §10 MATCH, ASKED OF THE DECK.** `turn.ts`
    rejects a hand play with `EVOLVE_MISMATCH` unless
    `evolveFromOf(card) === <target's top card>.name`; this filters the deck by
    exactly that equality, so the two routes onto a stack cannot come to disagree
    about what evolves from what. Nothing else is checked here and nothing else
    should be: the printed sentence carries no stage word, no name and no count —
    Team Rocket's Pupitar `sv10-095` is a **Stage 1** running it, which is the
    printing that proves the rule is the chain and not "a Basic evolving".

    ⚠️ **THE TWO §10 TIMING BANS DO NOT APPLY AND THAT IS THE PRINT, NOT AN
    OMISSION.** `turn.ts` refuses an evolve when the target `turnPlayed >=
    state.turn` (§10's "came into play this turn") and during the first turn (§4)
    — both are rules about **playing a Pokémon from your hand**, which this
    sentence is not doing. Exeggcute's own registry gate (`firstTurnExempt`,
    D281/D282) exists because the *attack* needed licensing on turn one, and it
    licenses the attack rather than the placement.

    `undefined` when the source has left the board — a "this Pokémon" op's
    standing answer, and the shape `switchActive.fromSource` already takes. */
function evolveFromDeckOffer(
  state: GameState,
  ctx: EffectContext,
  /** 🆕 D308 — the op's `onto`. Absent, the subject is `ctx.sourceUid` (every D307
      printing); present, it is that target and the source is not consulted at all
      — *"for each of your Benched Pokémon"* and *"1 of your Pokémon"* both name a
      body the program is not running on. A slot that has emptied since the op was
      scheduled (or since the body was chosen) falls out here as `undefined`, which
      is the same silent ending a departed source already takes.
      🆕 D309 — a `PokemonTarget` rather than a bench index, because the Active
      qualifies for the body-choice sentence. It is seat-relative: the seat is
      `ctx.seat` at every call, which is why the answer carries a spot and not a
      whole `PokemonRef`. */
  onto?: PokemonTarget,
  /** 🆕 D310 — the op's `names`. Absent, the candidate set is §10's chain match
      asked of the deck (every D307/D308/D309 printing). Present, it REPLACES that
      match with a name-set membership test, because the one printing that carries
      it names a card the chain excludes: see `evolveFromDeck`'s doc block in
      `effects.ts` for why the two are alternatives and never conjuncts. */
  names?: readonly string[],
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
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (body === undefined || body === null) return undefined;
  const bodyUid = topUid(body);
  const top = bodyUid === undefined ? undefined : cardOf(state, bodyUid);
  if (bodyUid === undefined || top === undefined) return undefined;
  return {
    target: ref.spot,
    benchIndex: ref.spot.spot === "bench" ? ref.spot.index : -1,
    body,
    bodyUid,
    name: top.name,
    candidates: side.deck.filter((uid) => {
      const card = cardOf(state, uid);
      // An unresolvable deck uid is not a candidate — `evolveFromOf` demands a
      // `Card`, and a missing catalog row must fall OUT of the offer rather than
      // be admitted by a loose comparison (the `hpOf` null rule, one file over).
      if (card === undefined) return false;
      // 🆕 D310 — the printed NAME SET, when the sentence prints one, INSTEAD of
      // §10's chain match and never alongside it. Pidove `sv05-133` names
      // `Unfezant`, which evolves from `Tranquill`, so a conjunction would be
      // empty on every board forever. `?? false` is not needed: `names` is
      // non-empty wherever it is authored, and an empty array would honestly
      // offer nothing.
      if (names !== undefined) return names.includes(card.name);
      return evolveFromOf(card) === top.name;
    }),
  };
}

/** 🆕 D307 — resolve an `evolveFromDeck` pick: the card leaves the deck and goes
    onto the body the op named, through `types.ts evolveOnto` — the §10 placement
    `evolve` and Rare Candy both run, minus the two tails that set a phase.

    🛑 **NEITHER TAIL IS OWED HERE, AND BOTH ANSWERS ARE MEASUREMENTS RATHER THAN
    CONVENIENCES** (the argument in full is on the op's doc block in `effects.ts`):
    the printed on-evolve trigger says *"when you play this Pokémon **from your
    hand** to evolve"* on every legal card that prints one, so a DECK-sourced
    placement satisfies no printed antecedent; and an evolution that drops
    effective max HP below the carried damage is Knocked Out by §8.1
    `finishAttack`, which sweeps the ATTACKER's own board after the program.

    Wire-safe like `searchMove`: only a uid still in the deck AND still a legal
    evolution for this body moves, re-derived here rather than trusted off the
    prompt — `resolveEffect` has already checked the pick against the candidate
    set, and this is the same belt `searchMove`'s `side.deck.includes` wears. Only
    the FIRST pick is taken: the prompt's `max` is 1 and a longer array is a
    crafted frame `validateChoice` would already have rejected. */
function evolveFromDeckMove(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
  /** 🆕 D308 — the op's `onto`, threaded so the RESOLUTION re-derives the same
      offer the PARK made. Read off `cont.pendingOp` on the resume path, so a
      redirected op that parked answers about its own body and not about the
      attacker. */
  onto?: PokemonTarget,
  /** 🆕 D310 — the op's `names`, threaded for the SAME reason `onto` is: the
      resolution re-derives the offer rather than trusting the prompt, so it must
      re-derive it under the same predicate the park was built from. Dropping it
      here would re-admit the chain set at resolve time and let a wire frame trade
      the printed Unfezant for a Tranquill the park never offered. */
  names?: readonly string[],
): GameState {
  const offer = evolveFromDeckOffer(state, ctx, onto, names);
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
  ).state;
}

/** Move the chosen retrieved cards discard → dest (§7.1 recovery Items): hand
    appends; deck appends to the end, where a trailing `shuffleDeck` op then
    scrambles them ("shuffle … into your deck"); **bench enters play stamped this
    turn** (D237's *"Put up to 3 Duskull from your discard pile onto your
    Bench."*), which is `searchMove`'s own bench arm one source zone over.
    Wire-safe like searchMove: only uids actually in the discard pile move
    (resolveEffect already checked them against the candidate set, and rejects a
    uid picked twice).

    ⚠️ THE BENCH ARM CLAMPS AGAIN HERE, and it is not belt-and-braces: the park's
    `max` was clamped against the bench space at PARK time, and a park is
    serialized into a `MatchRecord` and answered later — nothing stops the Bench
    having filled in between (a §9.2 gate that benched a body, a resumed record).
    Clamping at the MOVE is what keeps the set removed from the discard pile
    exactly equal to the set that lands, which is `searchMove`'s stated rule.

    Hands back the uids that ACTUALLY moved, for the §9.2 record (Miriam) — the
    same list the event names, so what a later clause reads is exactly what the
    game announced. */
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

/** Push the one `DECK_TOP_REVEALED` row, spelled in ONE place because it now has
    THREE producers inside this op — the whiff (nothing matched up there), the
    decline (looked and took none) and the move — and the whole point of D241 is
    that all three are the same announcement. Two whole object literals per
    branch rather than a conditional spread, for `searchMove`'s reason exactly:
    the flags are ABSENT when the print does not carry them (D135), and
    `reveal: undefined` is not the same wire value as no key at all. */
function pushDeckTopLook(
  op: Extract<EffectOp, { op: "lookAtTopN" }>,
  moved: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): void {
  const event: Extract<GameEvent, { type: "DECK_TOP_REVEALED" }> = {
    type: "DECK_TOP_REVEALED",
    seat: ctx.seat,
    uids: [...moved],
    // Spread-when-present, not `dest: op.dest` — an explicit `undefined` is not
    // the same wire value as no key at all, and these events are compared by
    // value in the suite (D135's rule, `searchMove`'s spelling one op over).
    ...(op.dest === undefined ? {} : { dest: op.dest }),
    ...(op.reveal === true ? { reveal: true as const } : {}),
  };
  events.push(event);
}

/** Move the chosen looked-at cards deck → `op.dest` (lookAtTopN — Great Ball /
    Pokégear 3.0 to the hand; D241's Tatsugiri ex / Reuniclus to the Bench and
    Rockruff / Litwick to the discard pile). Wire-safe like searchMove /
    retrieveMove: only uids actually in the deck move, and resolveEffect already
    checked them against the candidate set (the top-n matches), so a deeper card
    can never reach here. The trailing shuffleDeck op then scrambles the deck
    (the top cards were looked at), whether or not anything was taken.

    ⚠️ **THE BENCH ARM CLAMPS BEFORE ANYTHING LEAVES THE DECK**, which is
    `searchMove`'s stated rule and `retrieveMove`'s repetition of it: the set
    removed from the deck must be EXACTLY the set that lands, or the excess is
    stranded in neither zone (the card-destruction shape the M1 review called
    out). And it clamps HERE and not only at the park, because a park is
    serialized into a `MatchRecord` and answered later — nothing stops the Bench
    having filled in between.

    ⚠️ **THE EVENT FIRES EVEN WHEN NOTHING MOVED (D241).** This used to
    `return state` on an empty `moved`, which made the DECLINE silent — the
    player looked at the top `n`, learned it, put it all back, and the opponent
    was told nothing. The look is the announcement; the move is only its
    consequence.

    `reveal` is the op's printed *"you may reveal a … you find there"* rider
    (D225), forwarded onto the event for the log exactly as searchMove forwards
    its own. The FUNCTION's name is about the deck top being revealed to its
    owner — the same thing the event name means, and the ambiguity that let the
    old comment claim a reveal the row never printed.

    🆕 ⚠️ **D334 — `restTo` MOVES THE LEFTOVERS, AND IT RUNS ON EVERY PATH
    INCLUDING THE ONES THAT MOVE NOTHING** (Explorer's Guidance's printed *"Discard
    the other cards"*, then D335's two more destinations). `attachFromTopApply`'s
    rule, transferred verbatim rather than re-derived: the clause is a cost the card
    charges whether the look found anything or not, so `stepOp`'s empty branch is
    routed HERE with no picks instead of returning early, and one apply is what keeps
    a branch from forgetting it.

    🆕🆕 🛑 **D335 — THREE DESTINATIONS, ONE OF THEM AN EVENT AND TWO OF THEM NOT.**
    `"discard"` is the only value whose cards LEAVE the deck, so it is the only one
    that pushes `DECK_TOP_DISCARDED` — the event's own qualifying test, applied
    rather than counted. `"bottom"` (Drakloak's *"Put the other card on the bottom of
    your deck"*) and `"shuffledBottom"` (Rika's *"Shuffle the other cards and put
    them on the bottom of your deck"*) append the window's leftovers UNDER the deck
    and announce nothing: the cards never changed zone, and `DECK_TOP_REVEALED` above
    has already told both seats a look happened. See effects.ts for why
    `CARD_TO_BOTTOM_OF_DECK` (singular, hand-sourced, named because the hand was
    revealed) and `SHUFFLE` (a claim about the whole deck) are both refused here.

    ⚠️ **`"shuffledBottom"` IS THE ONLY VALUE THAT SPENDS `rngState`, AND IT SPENDS
    IT ONLY WHEN THERE IS SOMETHING TO RANDOMIZE** — `shuffle` runs its
    Fisher–Yates loop from `length - 1` down while `i > 0`, so a one-card or empty
    leftover consumes no draws and a replay of a v-19-era board is untouched by the
    branch existing. The order for `"bottom"` is the WINDOW's own (deck order, top
    first), which is the only order the print names and the only one that needs no
    randomness; Drakloak's leftover is a single card, so no printed board can tell
    that convention from any other — it is written down so the next author does not
    have to guess it.

    🛑 **THE LEFTOVERS ARE `window \ moved`, NOT `candidates \ moved`.** The
    printed "other cards" are every card the player LOOKED AT and did not take —
    including the ones no filter admitted, which were never candidates at all. The
    window is re-read off the LIVE deck here for `searchMove`'s wire-safety reason
    and because a park is answered later; deck order, top first, which is the order
    the pile gains them (§2).

    🛑 **AND THE BENCH CLAMP FEEDS THE LEFTOVERS RATHER THAN STRANDING CARDS.** A
    pick that could not land (a full Bench) is not moved, so it stays in the window
    and is discarded like any other card the player did not take — which is the only
    reading that keeps "the set removed from the deck is exactly the set that lands"
    true with two destinations in play. No printing pairs `dest: "bench"` with any
    `restTo` today; the arm is written this way so that it cannot destroy a card the
    day one does — and under `"bottom"`/`"shuffledBottom"` the unplaceable pick is
    put back under the deck rather than lost, which is the same guarantee one
    destination over. */
function revealFromTop(
  state: GameState,
  uids: readonly string[],
  op: Extract<EffectOp, { op: "lookAtTopN" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const inDeck = uids.filter((uid) => side.deck.includes(uid));
  const moved = op.dest === "bench" ? inDeck.slice(0, benchSpace(state, ctx.seat)) : inDeck;
  pushDeckTopLook(op, moved, ctx, events);
  const picked = new Set(moved);
  const rest =
    op.restTo === undefined
      ? []
      : side.deck.slice(0, Math.max(0, op.n)).filter((uid) => !picked.has(uid));
  if (moved.length === 0 && rest.length === 0) return state;
  const removed = new Set([...picked, ...rest]);
  const kept = side.deck.filter((uid) => !removed.has(uid));
  // 🆕 D335 — THE LEFTOVERS FORK, AND ONLY THE DISCARD ARM ANNOUNCES ANYTHING.
  // `toPile` is the cards that LEFT the deck; `underneath` is the cards that stayed
  // in it and merely moved. They are disjoint by construction (`op.restTo` is one
  // value), and the two names exist so that a future value cannot silently be both.
  const toPile = op.restTo === "discard" ? rest : [];
  // `"shuffledBottom"` is the only path that touches `rngState`, and `shuffle`
  // leaves it alone for a leftover of 0 or 1 (its loop starts at `length - 1`).
  const [underneath, rngState] =
    op.restTo === "shuffledBottom"
      ? shuffle(rest, state.rngState)
      : [op.restTo === "bottom" ? rest : [], state.rngState];
  // Own deck, own action: `actor` IS `seat` and cannot be anything else — this op
  // only ever looks at `ctx.seat`'s own top (the event's own doc says so). Written
  // out rather than left implicit for `attachFromTopApply`'s stated reason: a
  // future look aimed at the opponent's deck is a slice that must edit this line.
  if (toPile.length > 0)
    events.push({ type: "DECK_TOP_DISCARDED", seat: ctx.seat, actor: ctx.seat, uids: [...toPile] });
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
  return withSide({ ...state, rngState }, ctx.seat, updated);
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
    opponent's hand filtered by the op, collapsed to at most `op.upTo ?? 1`
    representatives per interchangeable class in hand order (the payFromHand cap
    logic, keyed by `cardIdentity` like attachFromDeck because the catalog prints
    one Basic Energy under several ids, and two of those in a hand are one answer
    wearing two uids). Collapsing here leaks nothing: the whole hand just went out
    in HAND_REVEALED, so the offer's shape has no secret left to give away — the
    exact leak that keeps payFromHand's own-hidden-hand offer from doing this.

    🆕 **D297 — THE CAP USED TO BE A HARD 1 AND THAT WAS LOAD-BEARING, MEASURED.**
    The old doc argued it away — *"the pick is 'a card', so no class can ever want
    a second copy"* — and the argument was true of the five printings that spell
    "a card". Lickitung's *"up to 2 Basic Pokémon"* is the sentence it is false of,
    and the cost is not cosmetic: an opponent hand holding TWO copies of one
    printed Basic collapsed to ONE candidate, so the second copy could never be
    benched. ⚠️ **TWO DIFFERENT Basics never collapsed at all** (`cardIdentity`
    keys a Pokémon on its catalog `id`), which is why this had to be driven off
    the same-copies board rather than reasoned about — the obvious fixture shows
    nothing. `interchangeableCandidates` has taken exactly this parameter since
    D186 and this is that rule, ported rather than re-invented. */
function bottomFromOpponentHandOffer(
  state: GameState,
  ctx: EffectContext,
  op: Extract<EffectOp, { op: "bottomFromOpponentHand" }>,
): string[] {
  // D294 — a `dest: "bench"` op into a FULL opponent Bench has nowhere to put
  // anything, so it offers nothing and whiffs. Checked HERE rather than in the
  // apply for `searchMove`'s stated reason one zone over: the set offered must be
  // the set that can land, or a park would ask a question whose every answer is
  // a no-op. (`programPlayable` greys the affordance on the same fact — bench
  // size is public — so this arm is the resolve-time half of one rule.)
  if (op.dest === "bench" && benchSpace(state, otherSeat(ctx.seat)) === 0) return [];
  const hand = state.players[otherSeat(ctx.seat)].hand;
  // 🆕 D350 — `"any"` (Lillie's Ribombee "Inviting Wink") keeps `BENCH_MAX`
  // representatives per interchangeable class rather than a printed count: the
  // sentence names no number, and `BENCH_MAX` is the true ceiling of what could
  // ever land — the full-Bench guard three lines up has already returned EMPTY
  // when nothing can. A wider cap would only lengthen a list nobody can spend.
  const cap = op.upTo === "any" ? BENCH_MAX : (op.upTo ?? 1);
  const kept = new Map<string, number>();
  const candidates: string[] = [];
  for (const uid of hand) {
    if (op.filter !== undefined && !matchesFilter(cardOf(state, uid), op.filter)) continue;
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= cap) continue;
    kept.set(key, already + 1);
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
  dest?: "bench" | "discard",
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
  // D294 — the bench arm CLAMPS AGAIN here, `retrieveMove`'s rule verbatim: the
  // offer already refused a full bench, but the answer arrives from the wire on a
  // board that may have moved, and a card removed from a hand with nowhere to
  // land is the card-destruction shape the M1 review named. One printing takes
  // exactly one card, so the clamp can only ever bite on a stale answer.
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
  // 🆕🆕 D445 — THE DISCARD ARM. The card leaves the OWNER's hand for the OWNER's own
  // §2 pile, appended in pile order like every other discard in this file, so its
  // identity becomes public by the BOARD and not only by the log.
  //
  // ⚠️ **NO CLAMP AND NO ROOM CHECK, UNLIKE THE BENCH ARM ABOVE** — a discard pile has
  // no capacity, so `retrieveMove`'s "the offer must be the set that can land" has
  // nothing to enforce here and inventing a guard would be a rule the model does not
  // have. The membership/duplicate filter above is still what keeps a stale wire answer
  // from moving a card twice.
  //
  // ⚠️ **A SEPARATE EVENT AND NOT `FORCED_HAND_DISCARD`**: the ACTOR chose this card out
  // of a hand that is not theirs, which is precisely the consumer D426's row said would
  // buy an `actor` — see events.ts for why widening that row would have given one event
  // two voices.
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

/** ⚠️⚠️ D232 — THE PRINTED REVEAL, IN ONE PLACE. `seat`'s whole hand goes public
    in a single `HAND_REVEALED` naming every uid — every one, because that is what
    the printed word means at a table and an event that named fewer would be
    hiding what the effect just showed (events.ts).

    TWO PRODUCERS SINCE D232 — `bottomFromOpponentHand`'s opening line and the
    standalone `revealOpponentHand` op — and they share this function rather than
    each pushing their own literal. The hazard is not the event's shape but its
    CONTENT: a second copy is free to drift on which seat's hand it reads
    (`ctx.seat` versus its opposite is one character), and a crossed reveal would
    show a player their OWN hand while telling the log it was the opponent's. The
    caller passes the OWNER, so the seat question is answered once per call site
    and never inside this function.

    THE ARRAY IS COPIED. `side.hand` lives in the state the caller is about to
    keep threading, and an event holding a live reference would retro-actively
    change what the log says was revealed the moment a later op moved a card out
    of that hand — the same freshness rule `recordMoved` states one screen up.

    ⚠️ EMITS FOR AN EMPTY HAND TOO (zero uids), and no caller may skip that: the
    log has a row for it ("revealed their hand — no cards"), and BOTH ops here can
    reach an empty opponent hand from an attack — the play gate that keeps the
    TRAINER path off it (cardplay.ts) has no jurisdiction over §8. */
function revealHand(state: GameState, seat: Seat, events: GameEvent[]): void {
  events.push({ type: "HAND_REVEALED", seat, uids: [...state.players[seat].hand] });
}

/** ⚠️⚠️ D232 — TAKE ONE CARD OUT OF THE OPPONENT'S HAND AT RANDOM and put it
    where the printed sentence says: their own discard pile ("Discard a random
    card from your opponent's hand.") or back into their deck, shuffled ("…Your
    opponent reveals that card and shuffles it into their deck.").

    **THE PICK IS `randomIndex` OVER THE LIVE HAND, WHICH IS THE WHOLE SEED
    ARGUMENT.** `state.rngState` is a field of `GameState`, `MatchRecord`
    persists the whole `GameState`, and every consumer of the RNG in this engine
    advances that one integer — so this pick replays exactly, an online match
    resumed from storage picks the card it already picked, and no
    `MATCH_RECORD_VERSION` move is owed (match.ts). Asked BEFORE the op was
    written, because `Math.random()` here would have been correct-looking and
    would have desynced replay silently.

    **AN EMPTY HAND TAKES NOTHING, EMITS NOTHING AND ADVANCES NOTHING** — three
    claims held by TWO guards doing DIFFERENT jobs, which is a correction a mutant
    made to this paragraph rather than a design stated up front. The draft said the
    length test here existed to stop the RNG burn and that `randomIndex`'s own
    `count <= 0` return was belt-and-braces; mutating this line to burn a step
    produced an EQUIVALENT mutant, because the other guard already answered. The
    true division:
      · `randomIndex(0, s) === [0, s]` is what stops the BURN — a whiff that took
        a step would make two replays that did the same thing diverge on the next
        coin flip, and nothing about the board would show it.
      · THIS line is what stops the bogus EVENT. Without it `side.hand[0]` is
        `undefined` and the op announces a take of a card that does not exist,
        which the log then tries to name.
    Both are pinned by their own mutant, and neither substitutes for the other.

    **THE `deck` ROUTE SHUFFLES, AND THE SHUFFLE IS AN EVENT.** The card is
    appended and the whole deck reordered — the `shuffleDeck` op's own contract,
    on the OWNER's seat — so the position is genuinely gone. Naming the card in
    `RANDOM_CARD_TAKEN` and then losing its position is exactly the printed pair
    of facts ("reveals that card" / "shuffles it into their deck"), and a build
    that skipped the shuffle would leave a known card sitting on top of a deck the
    owner is about to draw from.

    `actor` is the controller, `seat` the owner of the hand and the destination —
    the CARD_TO_BOTTOM_OF_DECK precedent, and the reason the log can phrase this
    from either side of the table without a possessive. */
function randomFromOpponentHand(
  state: GameState,
  op: Extract<EffectOp, { op: "randomFromOpponentHand" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const owner = otherSeat(ctx.seat);
  const side = state.players[owner];
  if (side.hand.length === 0) return state;
  const [index, rngState] = randomIndex(side.hand.length, state.rngState);
  const uid = side.hand[index] as string;
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

/** 🆕 D299 — Take `ref` (a BENCH ref, on either board) off the board with every
    card attached to it and put the whole pile into its OWNER's `dest`.

    🛑 **THE OWNER IS `ref.seat` AND NOT `ctx.seat`.** Every zone touched here —
    the bench it leaves, the deck or hand it lands in — belongs to the body, and
    that is what makes Illumise's cross-seat sentence the same op as Chimecho's
    own-board one. `ctx.seat` is the ACTOR and reaches only the event.

    ⚠️ **THE BENCH COMPACTS, exactly as `knockOut`'s benched branch does** — the
    same splice, and deliberately the same shape: §8.1's "no gap, no promotion"
    is a fact about the BENCH rather than about Knock Outs, and this is the
    second thing in the engine to learn it. The body is dropped whole, so its
    damage, its Special Conditions and every installed stamp go with it; nothing
    survives a return to a library zone, which is the printed difference between
    this and a switch.

    ⚠️ **THE DECK ARM SHUFFLES THE *OWNER'S* DECK AND EMITS ITS OWN SHUFFLE
    ROW** — `randomFromOpponentHand`'s deck arm verbatim, including that the
    SHUFFLE names the owner rather than the actor. The hand arm appends in §2's
    pile order and shuffles nothing, because a hand has no order to hide. */
function returnBenched(
  state: GameState,
  ref: PokemonRef,
  op: Extract<EffectOp, { op: "returnBenched" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // Not a bench ref — unreachable from either candidate set (both are built by
  // mapping over a `bench` array), and a silent no-op rather than a throw for
  // the reason every ref guard in this file is: the op validates refs.
  if (ref.spot.spot !== "bench") return state;
  const owner = ref.seat;
  const side = state.players[owner];
  const index = ref.spot.index;
  const body = side.bench[index];
  if (body === undefined) return state;
  const uid = topUid(body);
  if (uid === undefined) return state;
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

/** 🆕 D311 — Take the PROGRAM'S OWN body (`ctx.sourceUid`, the printed "this
    Pokémon") off the board with every card attached to it and shuffle the whole
    pile into its controller's deck.

    🛑 **THE ONE THING IT DOES THAT `returnBenched` CANNOT: IT REACHES THE ACTIVE
    SPOT.** The bench arm is that function's splice byte for byte (the same
    compaction, §8.1's "no gap, no promotion" being a fact about the BENCH); the
    active arm sets `active` to `null` and leaves a spot the board owes a
    promotion for. **That promotion is NOT queued here** — this returns a
    `GameState` and the stage queue is `flow.ts`'s — it is swept for by
    `resolveMidTurnKnockOuts` after the program settles, which is also what makes
    the §14.2 loss (last Pokémon shuffled away) fall out with no code.

    ⚠️ **THE OWNER IS `ctx.seat`, NOT the ref's seat, and here those are the same
    thing by construction** — `sourceRef` only ever looks at the controller's own
    board, because "this Pokémon" is the body running the program.

    ⚠️ **NO REF AND NO STACK IS A SILENT NO-OP**, `returnBenched`'s three guards
    verbatim: the body was evolved over, bounced or Knocked Out earlier in the same
    program, and the printed pronoun then points at nothing.

    Reuses `POKEMON_RETURNED` — the movement, the pile and (on the deck arm) the
    shuffle are identical, and a second event naming the same movement would make
    one fact two log rows (D299's own reason for one event across two boards).

    🆕 🛑 **D313 — THREE ZONES AND ONE SPLIT, AND THE WHOLE OF IT IS A PARTITION OF
    `stackUids`.** `op.dest` (absent = `"deck"`, the v18 wire reading) is where the
    BODY PILE goes; `op.attachmentsTo` is the one printed departure from it. The two
    piles are `body.stack` (the evolution cards — a bounced Crobat ex takes its
    Golbat and Zubat with it) and `body.energy` + `body.tools` (what the printed
    parenthetical calls *"all cards attached to this Pokémon"*), which is exactly
    the join `stackUids` concatenates, so the split costs no new extraction.

    ⚠️ **THE ZONES ARE GATHERED BEFORE THEY ARE APPLIED, AND THAT IS WHAT KEEPS THE
    DECK ARM HONEST.** Placing the two piles one at a time would shuffle twice (two
    RNG draws, two SHUFFLE rows) on the three printings where both piles go to the
    deck. Gathering first means the deck is touched AT MOST ONCE — one `shuffle`,
    one event — and a printing that sends nothing to the deck emits no SHUFFLE at
    all, which is the same "one event per thing that happened" rule the event's own
    block states.

    ⚠️ **`uids` ON THE EVENT STAYS THE WHOLE PILE** (the KNOCKED_OUT precedent), and
    `attachmentsTo` on the event carries BOTH the zone and the subset that went
    there. One field rather than two because a zone with no cards is unreadable and
    cards with no zone are unattributable: they are only ever true together, so a
    single field cannot let them disagree. */
function returnSelf(
  state: GameState,
  op: Extract<EffectOp, { op: "returnSelf" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const [ref] = sourceRef(state, ctx);
  if (ref === undefined) return state;
  const seat = ctx.seat;
  const side = state.players[seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (body === null || body === undefined) return state;
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
  const attached = [...body.energy, ...body.tools];
  const split = op.attachmentsTo !== undefined && op.attachmentsTo !== dest;
  const bodyPile = split ? [...body.stack] : uids;
  const zones: Record<"deck" | "hand" | "discard", string[]> = { deck: [], hand: [], discard: [] };
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
  const placed = {
    ...emptied,
    hand: [...emptied.hand, ...zones.hand],
    discard: [...emptied.discard, ...zones.discard],
  };
  if (zones.deck.length === 0) return withSide(state, seat, placed);
  const [deck, rngState] = shuffle([...placed.deck, ...zones.deck], state.rngState);
  events.push({ type: "SHUFFLE", seat });
  return { ...withSide(state, seat, { ...placed, deck }), rngState };
}

/** 🆕🆕 **D433 — §10, THE FIRST DEVOLUTION IN THIS ENGINE.** *"Devolve each of
    your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it
    into your opponent's deck."* — **1 sentence / 3 legal printings**, corpus row 88.

    🛑 **THE CANDIDATE SET IS `oppAnyRefs` AND NOT A NEW SCAN.** *"each of your
    opponent's evolved Pokémon"* is the Active AND the Bench, which is exactly the set
    `damageChosen`'s `opponentAny` snipe already funnels through — reused rather than
    re-spelled, on `snipeTargets`' own stated rule (a second enumeration of one noun
    phrase is how two readers come to disagree). The "evolved" filter is
    `stack.length >= 2` and NOT a printed-stage read: §1.2 makes the stack the identity,
    a Rare Candy places a Stage 2 straight onto a Basic (`stack` = 2, with no Stage 1
    card in it at all), and a catalog gap on the top card must not silently make a body
    un-devolvable.

    🛑 **§11 IS A FILTER AND NOT A GUARD, WHICH IS D259's RULE AND NOT A CHOICE.**
    The sentence names a SET, so a shielded body must merely not be devolved — refusing
    the op whole would let one Mist-Energy'd Fraxure protect the entire board, a rule no
    printing states. `unshieldedRefs` is the same funnel `gust`, `returnBenched` and
    `knockOutChosen` already apply, and it announces one `ATTACK_EFFECT_PREVENTED` per
    shielded BODY rather than one for the sweep.

    🛑 **THE CLEAR SET IS THE §10/§11 ELEVEN, AND THE THREE FIELDS `evolveOnto`
    ALSO WRITES ARE DECIDED SEPARATELY BECAUSE THEY SAY SOMETHING ELSE.** The eleven —
    `conditions` through `boostedAttack` below — are byte-for-byte the set `switchInto`
    (interpreter.ts) and `clearOnLeavingActive` (turn.ts) clear, and §12 names
    devolution in the same breath as evolution (*"retreats / moves to Bench, evolves,
    devolves, or by card effect"*, `docs/reference/ptcg-rules.md` §12). `evolveOnto`
    writes THREE more, and all three of those say *a new card arrived*:

      · `turnPlayed` — **KEPT**. Nothing came into play; the body has been here since it
        was played. A devolved Pokémon that could not be evolved again on its
        controller's next turn would be a rule no card prints.
      · `markers` — **KEPT**, and this is the one that would be a live defect if copied
        from `evolveOnto`. The only marker in the engine is D414's `koByEffect:<turn>`,
        which records that a body's LETHALITY is not damage's doing; clearing it here
        would silently restore the *"Knocked Out by damage from an attack"* reading for
        a body §8.1 is about to collect. `switchInto` and `clearOnLeavingActive` keep it
        too — the three shipped literals already DISAGREE about this field, and the
        disagreement is right: it is cleared only where a fresh card arrives.
      · `evolvedTurn` — **NULLED**, the one write here that is neither the eleven nor a
        keep. It is a fact ABOUT THE CARD THAT JUST LEFT, so it must not outlive it.
        `null` rather than a stale number because the field's only reader asks
        `=== state.turn` (Gholdengo `sv08-131`'s +90): under-claiming is invisible and
        over-claiming pays a bonus to a body that is no longer the Pokémon which earned
        it. No board in this catalog can currently witness the difference — devolution
        happens on the OPPONENT's turn, so `evolvedTurn === state.turn` is already false
        for every body this op can reach — so it is pinned by a surgery, exactly as
        `evolveOnto` pins its own unreachable clears.

    Damage, Energy and Tools carry over untouched: §10's carry-over read in the other
    direction, and the damage half is what makes the Knock Out below possible at all.

    🛑 **THE KNOCK OUT ARRIVES BY THE MAXIMUM MOVING, §8.1 NEEDS NO NEW MECHANISM
    — BUT THE *CAUSE* DOES.** `isLethallyDamaged` is a `damage >= effectiveMaxHp` STATE
    check and `effectiveMaxHp` resolves the stack TOP live, so a Stage 2 carrying 100
    damage that devolves to a 90 HP Stage 1 is lethal the instant the stack shortens —
    no damage dealt, no counter placed. `finishAttack`'s `collectKnockOuts` sweeps both
    boards after the program settles and collects it; the Prize and the promotion fall
    out with no code. What §8.1 does NOT get right by itself is *"Knocked Out **by
    damage** from an attack"* — read by four built sentences / six printings through
    `KnockOutMark.byAttack`, and by `koRecoilOf` for Vengeful Punch `sv03-197`.
    `collectKnockOuts`' own comment already states the rule this op needs: *"a cascade
    Knock Out is caused by the maximum MOVING, not by the attack's damage"*. So a body
    this op makes lethal is stamped with D414's `koByEffect:<turn>` marker — the SECOND
    producer of that stamp, and the first that writes it without writing damage.

    ⚠️ **THE STAMP IS CONDITIONED ON `wasLethal`, AND THAT CONJUNCT IS THE PRECISION OF
    IT.** §8.5's damage lands BEFORE the effect program runs (D125), so the Defending
    Pokémon can already be lethal when this op reaches it. That body WAS Knocked Out by
    damage from an attack, and stamping it would deny Vengeful Punch a recoil it is
    owed. Only a body that crosses the line BECAUSE the maximum moved is marked.

    ⚠️ **THE `wasLethal` READ AND THE RE-READ STRADDLE THE WRITE, DELIBERATELY.**
    `effectiveMaxHp` → `seatMaxHpBonus` locates the body by matching its TOP UID against
    the bodies IN PLAY, so asking about a devolved body that has not been written back
    yet answers 0 for every seat-wide HP aura — a silently wrong maximum on exactly the
    boards this op is interesting on. The devolved bodies are therefore committed to the
    board FIRST and the lethality question asked of the COMMITTED state (D428/D429's
    stale-local hazard, arriving through a helper's lookup rather than through a
    `const`).

    ⚠️ **AND THE SIBLING GAP IS NAMED RATHER THAN PINNED (D429).** This is not the only
    op that can drop a maximum below a body's existing damage: `discardStadium` (D380)
    can vacate Lively Stadium's `+30` to every Basic, and `discardTool` can take a
    Bravery Charm off. Neither stamps, so both currently report a max-moved Knock Out as
    *"by damage from an attack"*. That is a REAL inconsistency and it PREDATES this
    slice; it is recorded here so the next reader finds it, and deliberately NOT covered
    by a test, because a guard asserting today's answer would redden when someone fixes
    it.

    ⚠️ **ONE `SHUFFLE` FOR THE WHOLE SWEEP**, `returnSelf`'s stated rule: the cards are
    gathered and the deck is touched at most once, so three devolutions file three
    `POKEMON_DEVOLVED` rows and ONE `SHUFFLE`, and a board with nothing evolved on it
    files neither — a silent no-op, every sibling's contract. The RNG draw count is part
    of that contract: a per-body shuffle would advance `rngState` a different number of
    times and desynchronise every later flip.

    ⚠️ **THE DECK IS THE OWNER'S**, `returnBenched`'s and `randomFromOpponentHand`'s
    line: every zone touched belongs to the body, and `ctx.seat` reaches only the
    event's `actor`. */
function devolveEach(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const owner = otherSeat(ctx.seat);
  // The printed CANDIDATE SET: the opponent's Active first, then Bench in index
  // order (`oppAnyRefs`' order, which is also `lethalRefs`', so the log rows and the
  // KO sweep read the board the same way round), narrowed to the bodies the sentence
  // names — *"each of your opponent's EVOLVED Pokémon"*. §1.2's identity rule makes
  // that `stack.length >= 2`: a body with one card on it is what it was played as,
  // and only a stack of two or more has an evolution card to shed.
  //
  // 🛑 **NARROWED BEFORE §11 IS ASKED, AND THE ORDER IS THE WHOLE CORRECTNESS OF THE
  // REFUSAL ROW.** Every other caller of `unshieldedRefs` hands it an already-printed
  // candidate set — `gustTargets` (bench only), `knockOutChosenTargets` (the printed
  // stage filter), `discardableEnergies` (bodies that HOLD Energy). Asking the shield
  // over the whole board first would file an `ATTACK_EFFECT_PREVENTED` row for a
  // Mist-Energy'd BASIC this op was never going to touch: a refusal announcing an
  // effect that does not exist, which is a false log row rather than a conservative
  // one (D430 — a log row is a claim with the same standing as a predicate).
  const evolvedRefs = oppAnyRefs(state, ctx.seat).filter((ref) => {
    const side = state.players[ref.seat];
    const spot = ref.spot;
    const target = spot.spot === "active" ? side.active : side.bench[spot.index];
    return target !== null && target !== undefined && target.stack.length >= 2;
  });
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
    const body = spot.spot === "active" ? side.active : side.bench[spot.index];
    // Not in play — unreachable (`evolvedRefs` just read every one of these bodies),
    // and a silent skip rather than a throw for the reason every ref guard in this
    // file is: the op validates refs. The "evolved" filter is NOT repeated here; it
    // lives in `evolvedRefs` alone, so the printed candidate set has ONE spelling and
    // the refusal rows above cannot disagree with the bodies this loop collects.
    if (body === null || body === undefined) continue;
    const from = body.stack[body.stack.length - 1];
    if (from === undefined) continue;
    devolved.push({
      ref,
      from,
      cleared: presentStatuses(body.conditions),
      wasLethal: isLethallyDamaged(state, body),
      body: {
        ...body,
        // "the highest Stage Evolution card" — ONE card off the top, not the whole
        // stack: a Stage 2 devolves to its Stage 1 (or, after a Rare Candy, to its
        // Basic). `evolveOnto`'s APPEND read backwards.
        stack: body.stack.slice(0, -1),
        // §12 — devolving removes Special Conditions, named in the same clause as
        // evolving and retreating.
        conditions: noConditions(),
        // …and §10's effects of attacks, the same TWELVE `switchInto` and
        // `clearOnLeavingActive` shed (eleven until D434). Every one of them was
        // installed on a body whose top card is now in the deck.
        retreatBlocked: false,
        retreatLockedTurn: null,
        attackBlock: null,
        attackLockedTurn: null,
        damageReduction: null,
        noWeaknessTurn: null,
        // 🆕🆕 D434 — the SCHEDULED counter placement, and it is the ONE member of
        // this set that NO legal sequence can reach at this literal, which is said
        // rather than left to look like the others. Devolution arrives only as an
        // opponent's attack effect, and inside the schedule's window the opponent
        // is the seat that installed it — whose turn it is not. Written anyway,
        // because §10 sheds the effects of ATTACKS and this is one, and because
        // D433's own rule is that the four §10 literals AGREE about the durated set
        // and disagree only about `markers`. Following the set is the rule; a
        // reachability argument is not a licence to leave a hole in it.
        scheduledEffect: null,
        attackDamageDebuff: null,
        installedRecoil: null,
        lockedAttacks: [],
        boostedAttack: null,
        // …and the evolution stamp, which belongs to the card that left. See the block
        // above for why this is `null` and why `turnPlayed` and `markers` are NOT
        // touched.
        evolvedTurn: null,
      },
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

  // 🛑 ASKED OF THE COMMITTED BOARD, NOT OF THE LOCAL BODY — see the block above:
  // `seatMaxHpBonus` finds a body by scanning the bodies IN PLAY, so a maximum read
  // before the write-back silently drops every seat-wide HP aura.
  for (const entry of devolved) {
    if (entry.wasLethal) continue;
    const side = next.players[entry.ref.seat];
    const spot = entry.ref.spot;
    const body = spot.spot === "active" ? side.active : side.bench[spot.index];
    if (body === null || body === undefined) continue;
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

/** 🆕 D345 — *"If you use this Ability, this Pokémon is Knocked Out."* (Dusclops
    and Dusknoir "Cursed Blast", 6 legal printings on 2 sentences).
    🆕 **D346 — Magneton "Overvolt Discharge" ×3 joins them, so this op now reads
    ALL NINE legal printings of its clause on all THREE sentences.** This line said
    Magneton "owes a second mechanism"; it owed none, and the op licensed the third
    sentence on the day it shipped.

    🛑 **IT MARKS RATHER THAN KILLS, AND THAT IS THE WHOLE DESIGN.** §8.1's sweep
    is `lethalRefs` → `planPrizes` → `knockOut`, and it is reached by THREE callers
    (the attack epilogue, the Checkup, `resolveMidTurnKnockOuts`). Killing the body
    here would need a fourth copy of the Prize plan, the whole-stack discard, the
    `KNOCKED_OUT` emit and the §8.1 promotion — all four of which are already owed
    to this program by `settleProgram`. So the op writes the ONE thing the sweep
    reads (`damage >= effectiveMaxHp`) and stops. `returnSelf`'s doc makes the same
    argument for the empty-Active seam; this is the SECOND consumer of it and the
    first that pays a Prize.

    ⚠️ **`effectiveMaxHp` IS READ AT THE MOMENT THE OP RUNS**, which is the printed
    reading: an HP aura (Ludicolo `sv09-037`) that is on the board when Cursed
    Blast resolves raises the number this op must meet, and one that arrives
    afterwards cannot un-Knock-Out a body §8.1 has already collected. `null`
    (no printed HP) is a body no rule can Knock Out by a state check, and
    `isLethallyDamaged` answers false for it — so the op whiffs there rather than
    inventing a number, and the whiff is unreachable in the catalog (every carrier
    is a Pokémon with printed HP).

    ⚠️ **NO EVENT.** The marking is invisible by construction: the body is removed
    inside the same reduction, so no projection can ever observe the damage this
    writes, and `KNOCKED_OUT` (fired by `knockOut` a moment later) is the honest
    row. A `COUNTERS_PLACED` here would say the host took counters, which is
    exactly what the printed clause is not.

    ⚠️ **A SILENT NO-OP ON AN EMPTY `sourceRef`** — `returnSelf`'s contract, shared
    rather than restated. */
function knockOutSelf(state: GameState, ctx: EffectContext): GameState {
  const [ref] = sourceRef(state, ctx);
  if (ref === undefined) return state;
  // 🆕🆕 D416 — the body IS `doomBodyAt` now, with NO marker: the printed subject
  // is this op's own host, and neither of the two mechanisms D414's stamp exists
  // for has any claim over a body its own controller killed. Passing `undefined`
  // is therefore a statement rather than an omission (see `doomBodyAt`).
  return doomBodyAt(state, ref);
}

/** 🆕🆕 **D416 — MARK ONE IN-PLAY BODY LETHAL, WHEREVER IT STANDS.** The shared
    half of `knockOutSelf` (D345), `knockOutDefender` (D414) and `knockOutChosen`
    (D416), factored out because the third of them is the first that can name a
    body that is neither its own host nor an Active: *"Knock Out 1 of your
    opponent's **Benched** Basic Pokémon"*.

    🛑 **IT MARKS RATHER THAN KILLS, WHICH IS D345's ARGUMENT INHERITED WHOLE.**
    §8.1's sweep is `lethalRefs` → `planPrizes` → `knockOut` and it is reached by
    three callers; killing a body here would need a fourth copy of the Prize plan,
    the whole-stack discard, the `KNOCKED_OUT` emit and the §8.1 promotion, ALL of
    which `settleProgram` already owes this program. So this writes the ONE thing
    the sweep reads (`damage >= effectiveMaxHp`) and stops.

    ⚠️ **`marker` IS THE ONE POLICY DIFFERENCE THAT LIVES IN HERE, AND §11 IS
    DELIBERATELY NOT THE OTHER ONE.** D414's `koByEffect:<turn>` stamp says the
    lethality is NOT DAMAGE — read by `flow.ts`'s `byAttackFor` and by
    `koRecoilOf`. `knockOutSelf` omits it (its own host, no cross-table claim);
    the two opponent-side ops pass it. The §11 ask (`effectRefused`, D142) does
    NOT ride this parameter, because the two callers that owe it ask in two
    STRUCTURALLY different places and a flag cannot express both:
    `knockOutDefender` names ONE body and refuses the op WHOLE, while
    `knockOutChosen` picks from a SET and must merely not OFFER a shielded body —
    which is `unshieldedRefs`' FILTER (D259: *"a filter and not a guard"*), applied
    at the funnel where `gust` and `returnBenched` already apply it. An ask in here
    would be a second announcement on the guard path and an unreachable branch on
    the filter path.

    ⚠️ **A BODY WITH NO PRINTED HP IS A WHIFF, NOT A THROW** — `effectiveMaxHp`
    owns that catalog gap and `isLethallyDamaged` answers false for such a body, so
    marking it would produce a corpse §8.1 never collects. Unreachable in the
    catalog (every carrier is a Pokémon with printed HP) and written anyway,
    because inventing a maximum is the worse of the two failures.

    ⚠️ **THE STAMP IS IDEMPOTENT**: a program that dooms an already-doomed body in
    the same turn re-computes the same string and adds no duplicate.

    🆕🆕 **D435 — A FOURTH CALLER, AND THE FIRST FROM OUTSIDE AN EFFECT PROGRAM.**
    `runCheckup` (flow.ts) fires the delayed KNOCK-OUT payload of the D434/D435
    schedule through this function, which is why it is exported. It passes the
    `koByEffect` marker under D433's `wasLethal` conjunct — re-derived at that site
    rather than inherited from any of the three callers here, since its lethality is
    an appointment's doing and no damage is placed. */
export function doomBodyAt(state: GameState, ref: PokemonRef, marker?: string): GameState {
  const side = state.players[ref.seat];
  const spot = ref.spot;
  const body = spot.spot === "active" ? side.active : side.bench[spot.index];
  if (body === null || body === undefined) return state;
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

/** 🆕🆕 D414 — §8.1, the Knock Out that reaches the OTHER side of the table.
    `knockOutSelf`'s body one seat over, with one addition that is the whole reason
    this is not a `target` field on that op.

    🛑 **THE MARKER IS THE SLICE.** Marking the defender's Active lethal is three
    lines; saying that the lethality is NOT DAMAGE is the part two shipped
    mechanisms depend on. `collectKnockOuts`'s `byAttack` mark feeds four built
    sentences / six printings of *"Knocked Out **by damage** from an attack"*, and
    `koRecoilOf` discharges Vengeful Punch's printed *"by damage"* **by placement**
    — its comment reads *"a body can only be lethal on the defender's board here
    because this attack put it there"*. Both were true by construction until this
    op existed. Neither is now, so both read the marker.

    ⚠️ **IT ASKS §11 (D142), WHICH `knockOutSelf` DOES NOT — AND THE DIFFERENCE IS
    THE SEAT, NOT AN INCONSISTENCY.** `knockOutSelf` kills its own host, which no
    "prevent all effects of attacks done to this Pokémon" block on the OPPONENT's
    body has any claim over. This one is an effect of an attack done TO THE
    DEFENDING POKÉMON — the exact thing §11 blocks refuse — so it asks, exactly as
    `preventRetreat` and `preventAttack` do. Refusing to ask would be a silent
    rules call made by the newer of two siblings.

    ⚠️ **A SILENT NO-OP ON AN EMPTY ACTIVE SPOT**, every sibling's contract: the
    defender was Knocked Out earlier in the same program and there is nothing to
    doom. */
function knockOutDefender(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const seat = otherSeat(ctx.seat);
  if (state.players[seat].active === null) return state;
  if (effectRefused(state, seat, ctx, events)) return state;
  // 🆕🆕 D416 — the marking is `doomBodyAt`'s now; what stays here is the pair of
  // things that are this op's and not the shared body's: the TARGET (the
  // opponent's Active, named by the print rather than picked) and the §11 GUARD.
  // ⚠️ THE GUARD NOW PRECEDES THE `effectiveMaxHp` READ, which it did not before
  // the factoring. The only board that can tell the two orders apart is a
  // §11-shielded body with NO PRINTED HP, where the refusal is now announced
  // rather than swallowed by a whiff — unreachable in the catalog, and the
  // announced form is the honest one either way: the effect WAS refused, and that
  // it would also have whiffed is not the player's business.
  return doomBodyAt(state, { seat, spot: { spot: "active" } }, koByEffectMarker(state.turn));
}

/** 🆕🆕 D380 — §7.3's shared zone, emptied. The Stadium goes to **ITS OWNER's**
    discard pile and announces itself with the EXISTING `STADIUM_DISCARDED` event —
    both of which are `playStadium`'s replace path (cardplay.ts) read from the other
    direction, which is the whole reason this op is three lines rather than a slice.

    🛑 **`stadium.owner` AND NOT `ctx.seat`.** The actor is the player whose card did
    it; the pile is the player whose card it IS. They coincide on a self-discard and
    diverge on every board where the opponent played the Stadium — which is the
    board this family is actually printed for.

    ⚠️ **AN EMPTY ZONE RETURNS THE STATE UNTOUCHED AND EMITS NOTHING** (§8.6's "do as
    much as you can", `discardDeckTop`'s short-deck ending): a `STADIUM_DISCARDED`
    row on an empty zone would announce a card that does not exist. */
function discardStadium(state: GameState, events: GameEvent[]): GameState {
  const stadium = state.stadium;
  if (stadium === null) return state;
  const ownerSide = state.players[stadium.owner];
  const next = withSide(state, stadium.owner, {
    ...ownerSide,
    discard: [...ownerSide.discard, stadium.uid],
  });
  events.push({ type: "STADIUM_DISCARDED", seat: stadium.owner, uid: stadium.uid });
  // The zone is cleared LAST, off `next`, so the pile update and the vacancy are one
  // reduction — nothing can observe a Stadium that is in neither place.
  return { ...next, stadium: null };
}

/** 🆕🆕 **D431 — §8.1's PRIZE, QUEUED BY AN ATTACK'S EFFECT INSTEAD OF BY A KNOCK
    OUT.** *"…and take a Prize card."* This function moves no card: it inserts the
    SHIPPED `{ kind: "takePrizes" }` `PendingStage` and lets `advance` (flow.ts) do all
    of it — clamp to what is left, park on `ko:takePrizes` or auto-resolve a forced
    pick, emit `PRIZES_OWED` / `PRIZES_TAKEN`, and run the §14 check BEFORE the tail
    resumes. Nothing here re-implements any of that; D329 lifted the §14 evaluation to
    a single point on purpose, and a second one is how two answers start disagreeing.

    🛑 **THE SEAT IS `ctx.seat` — THE PLAYER WHOSE CARD PRINTED THE SENTENCE.** Every
    other producer of this stage is `knockOut`, which is handed `otherSeat(koedSeat)`,
    so the stage's `seat` has always meant "the player who did NOT lose the body".
    Reading that as an invariant and writing `otherSeat(ctx.seat)` here would hand the
    OPPONENT the prize on every board — a defect no census and no coverage figure can
    see, because the sentence would still be BUILT and the stage would still resolve.
    It is a mutant row (`D431-take-prize-wrong-seat`).

    🛑 **THE CLOSED-WORLD AUDIT, BECAUSE THIS IS THE FIRST PRIZE WITHOUT A KNOCK OUT
    (D425/D414).** Every consumer of the `takePrizes` stage was read for facts it
    DERIVES rather than READS, and the enumeration is `grep -rn '"takePrizes"'` over
    every `.ts`/`.tsx` outside `node_modules` — **15 hits, all read**, not the four the
    slice was priced with:
      · `flow.ts` `knockOut` ×2 — the two PRODUCERS, untouched;
      · `flow.ts` `advance` — reads `stage.seat` and `stage.count`, derives nothing;
      · `flow.ts` `collectKnockOutPass` and `tiedOverTheBatch` — both quantify over the
        stages of THEIR OWN batch, never over `state.pending`, so a stage this op
        queued is invisible to them by construction (and is already RESOLVED by the
        time `attackEpilogue` runs it, which is what the splice below guarantees);
      · `attack.ts` `takePrizes` — cross-checks the head stage against the phase and
        reads `seat`/`count` off it;
      · `types.ts`, `actions.ts`, `phaseView.ts` ×2, `redact.ts`, `projection.ts`,
        `GameHud.tsx` ×2, `OnlineHud.tsx` — counts and seats, carried through.
    **NOTHING infers "a KO happened", "a body left play" or "the other seat lost a
    Pokémon" from the presence of this stage.** The nearest thing to a derivation is
    `phaseView.ts`'s `koParkActiveSeat`, which reads `state.pending` to decide whether
    a ko:* park sits INSIDE a turn — and it already names `attackEpilogue`, the stage
    this park is spliced in front of, for the effect-program case. So it answers
    "inside the attacker's turn" here, which is the truth. Driven, not assumed, in
    `takePrizeAttack.test.ts` §7.

    🛑 **SPLICED AHEAD OF THE ATTACK'S QUEUED TAIL, NOT APPENDED.** `attack.ts` queues
    `[damagedTrigger?, koToolTrigger?, attackEpilogue]` BEFORE it runs the program, so
    an append would take this prize AFTER the §8.1 Knock Out sweep and after the turn
    had ended. The position is not a preference: **every other op in this file finishes
    its work synchronously — i.e. before ANY of those three stages runs — and this one
    is a stage only because WHICH face-down prize is a decision a player must make.**
    So it goes where the work would have happened had it needed no answer: in front of
    the whole tail. (`reactToAttackDamage` splices for a different reason — its stage
    must precede a Knock Out it is printed to survive — and in front of a two-member
    set; the shapes are deliberately not shared.)

    ⚠️ **WHICH MAKES THE ORDER AGAINST A KNOCK OUT FROM THE SAME ATTACK EXPLICIT, AND
    IT IS §8.1's OWN.** An attack that prints this clause AND Knocks the Defender out
    queues **two** `takePrizes` stages: this one, then the sweep's from inside
    `attackEpilogue`. They are not one batch and must not be merged — this prize is
    step 4 of the attack, which PRECEDES the Knock Out check, while the sweep's prize
    is the Knock Out's own. So printed order and §8.1 order agree, the attacker answers
    two prompts in that sequence, and if the FIRST one empties the row the game ends
    before the second is ever offered (`resolvePrizesAndResume`'s win check). Driven in
    `takePrizeAttack.test.ts` §5.

    ⚠️ **WITH NO TAIL QUEUED THE APPEND IS THE ANSWER, AND IT IS UNREACHABLE TODAY.**
    The op's only producer is `deriveAttackEffect`'s D431 arm, which runs only from
    `attack()`, so the `-1` branch needs an Ability or Trainer program carrying this op
    and none exists. It is written as the honest ending rather than a throw because
    `settleProgram`'s other routes drain `pending` too, so a future Ability route works
    unchanged — but the branch is declared as an `unreachable-population` survivor in
    the mutant corpus rather than tested around (D205).

    ⚠️ **NO CLAMP AND NO WIN CHECK HERE, DELIBERATELY.** A seat with an empty prize row
    has already won, and `advance`'s own arm pops a stage whose clamped count is 0
    rather than parking on a row it cannot fill — its comment says so and
    `takePrizeAttack.test.ts` §6 pins it. Asking either question here would be a second
    answer to a question that already has exactly one. */
function queueTakePrize(state: GameState, ctx: EffectContext): GameState {
  const prize: PendingStage = { kind: "takePrizes", seat: ctx.seat, count: 1 };
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
        ? [...state.pending, prize]
        : [...state.pending.slice(0, tail), prize, ...state.pending.slice(tail)],
  };
}

/** The `returnBenched` pick prompt, in the printed card's own words minus its
    anaphora — the `retrieveNoun` rule (one phrasing per printed shape, never a
    guessed one). The DESTINATION picks the verb because the printings do:
    nothing in this pool "shuffles" into a hand or "puts" into a deck. */
function returnBenchedNote(op: Extract<EffectOp, { op: "returnBenched" }>): string {
  if (op.whose === "opponent") {
    return "Shuffle which of your opponent's Benched Pokémon into their deck?";
  }
  return op.dest === "deck"
    ? "Shuffle which of your Benched Pokémon into your deck?"
    : "Put which of your Benched Pokémon into your hand?";
}

/** The pick prompt's printed sentence — the whole clause, since the op IS the
    whole clause (the payFromHandNote rule). Grown one printed form per card
    (the retrieveNoun rule): bare = Ortega's, `supporter` = Greavard's. An
    unphrased future filter gets the bare form's structure with no guessed
    noun — "a card" is never a lie, merely less than the card prints. */
function bottomFromOpponentHandNote(
  op: Extract<EffectOp, { op: "bottomFromOpponentHand" }>,
): string {
  // D294 — the DESTINATION is checked before the filter, because it is the
  // clause that changes the verb: "put it on the bottom of their deck" and "put
  // it onto their Bench" are different promises, and a note that named the wrong
  // one would describe a move the dialog is about to not make.
  if (op.dest === "bench") {
    // 🆕 D297 — the "up to" form is a SECOND printed sentence, not a rewording of
    // the first: Lickitung prints two sentences where Mandibuzz prints one joined
    // clause ("Your opponent reveals their hand. Put up to 2 …" against "…, and
    // you put a Basic Pokémon …"). Grown one printed form per card, the
    // `retrieveNoun` rule, and it round-trips to the catalog text character for
    // character — which is the check this file can run and effects.ts cannot.
    // 🆕 D350 — the THIRD printed form, and it is a third SENTENCE rather than a
    // third wording of the first two: Lillie's Ribombee prints the clause inside
    // its own trigger ("…you may have your opponent reveal their hand and you put
    // any number of Basic Pokémon you find there onto **their** Bench"), so the
    // possessive is the card's own word and the leading clause is restated as the
    // standalone sentence a dialog has to be. Grown one printed form per card, the
    // `retrieveNoun` rule, exactly as D294 and D297 grew theirs — a `BENCH_MAX`
    // spelling of this card would have captioned it "up to 5", a number the card
    // does not print, which is the whole reason `"any"` is a value here.
    if (op.upTo === "any") {
      return `Your opponent reveals their hand, and you put any number of ${retrieveNoun(op.filter ?? { kind: "anyCard" }).plural} you find there onto their Bench.`;
    }
    if (op.upTo !== undefined) {
      return `Your opponent reveals their hand. Put up to ${op.upTo} ${retrieveNoun(op.filter ?? { kind: "anyCard" }).plural} you find there onto your opponent's Bench.`;
    }
    return `Your opponent reveals their hand, and you put ${retrieveNoun(op.filter ?? { kind: "anyCard" }).singular} you find there onto your opponent's Bench.`;
  }
  // 🆕🆕 D445 — the DISCARD destination, checked before the filter for D294's reason
  // one line up: the destination is the clause that changes the verb, and a note naming
  // the bottom of a deck over a card going to a pile would describe a move the dialog
  // is about to not make. Grown one printed form per card (the `retrieveNoun` rule),
  // and it round-trips to the catalog text character for character — the check this
  // file can run and effects.ts cannot.
  if (op.dest === "discard") {
    return "Your opponent reveals their hand. Discard a card you find there.";
  }
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

/** 🆕🆕 D426 — the opponent-chooses hand discard's caption, **IN THE ANSWERER'S
    VOICE AND DELIBERATELY NOT THE PRINTED SENTENCE.**

    🛑 **THIS IS THE ONE PLACE THE FAMILY'S ROUND-TRIP RULE HAS TO BE BROKEN, AND
    IT IS BROKEN ON PURPOSE.** `bottomFromOpponentHandNote` is grown one printed
    form per card precisely so its caption round-trips to the catalog text
    character for character — and it can be, because the seat reading that prompt
    is the seat the printed sentence addresses. Here it is not: the card says
    *"**Your opponent** discards 2 cards from their hand."* and the player looking
    at this dialog **IS** that opponent. A verbatim caption would tell them to make
    someone else discard. `mayDrawNote` settled this at the engine's only other
    opponent-answered park — Ortega prints *"your opponent may draw a card"* and
    the note reads *"You may draw a card."* — and this is that rule's second use.

    ⚠️ **THE COUNT IS THE PRINTED ONE, NOT THE CLAMPED ONE, AND THAT COSTS NOTHING
    HERE.** The op only ever parks when the hand is strictly bigger than `count`
    (the forced arm swallows every short board), so caption and offer can never
    disagree — which is the contradiction `choosePokemon.upTo`'s doc block warns
    about when a ceiling is cut to what a zone actually holds.

    ⚠️ **THE SINGULAR IS THE PRINTED ARTICLE**, matching the anchor's alternation
    rather than writing "1 card": *"Discard a card from your hand."* is how the
    catalog spells the count of one everywhere in this column. */
function opponentDiscardNote(op: Extract<EffectOp, { op: "opponentDiscardsFromHand" }>): string {
  return op.count === 1
    ? "Discard a card from your hand."
    : `Discard ${op.count} cards from your hand.`;
}

/** 🆕🆕 D426 — move `uids` from `owner`'s HAND to `owner`'s DISCARD PILE, and
    announce what actually moved.

    🛑 **`owner` IS THE HAND, THE CHOOSER AND THE DESTINATION — ONE SEAT, THREE
    ROLES, AND `ctx` NEVER REACHES THIS FUNCTION.** That is the `returnBenched` /
    `randomFromOpponentHand` rule (the zone's owner is not the actor) taken one
    step further: those two still name an `actor` on their event because the ACTOR
    is who moved the card. Here the owner moved it themselves, so there is no
    second seat for the row to name, and the function does not take one.

    ⚠️ **WHAT MOVED, NOT WHAT WAS ASKED FOR** — `payFromHandApply`'s membership and
    duplicate filter, byte for byte. Both callers already hold a subset of the live
    hand (the forced arm passes the hand itself; the parked one passes a
    validator-checked answer), so the filter is a belt — and it is the belt that
    keeps the EVENT honest if either of those two facts ever stops being true.

    ⚠️ **AN EMPTY RESULT EMITS NOTHING.** `payFromHandApply`'s `paid.length === 0`
    ending, for its reason: a row announcing a discard of zero cards describes
    something that did not happen. The op's own empty-hand branch means this is
    unreachable from a printed board today, and it is written anyway because it is
    the same guard the sibling carries at the same address.

    **THE CARDS LAND FACE UP IN THE §2 PUBLIC PILE**, appended in pile order like
    every other discard in this file — so their identity becomes public by the
    board and not by the log, which is why the log row stays a COUNT (see
    `FORCED_HAND_DISCARD` in log.ts). */
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
  // 🆕🆕 **D489 — THE CEILING IS READ OFF WHICHEVER FIELD CARRIES IT.** The exact
  // arm's is `count`; the declinable arm's is `cap`, which is the same quantity
  // ("how many copies of one interchangeable class could a pick possibly want")
  // spelled by the field the printed *"up to N"* lands in. `discardEnergy`'s own
  // reason for keeping `count` copies rather than one, verbatim.
  const keepPer = op.count === "any" ? op.cap : op.count;
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
    // 🆕🆕 **D489 — A DECLINABLE PAYMENT CANNOT BE UNMET, SO IT CANNOT REFUSE A
    // PLAY.** The printed *"up to N"* floor is ZERO: paying nothing is a legal
    // answer rather than a failure, and there is no threshold for a short hand to
    // fall under. Unreachable from either play path today (no Trainer and no
    // Ability prints a declinable cost — the arm's only producer is an attack), and
    // written anyway, because the alternative is a gate that refuses every play of
    // a card whose printed floor is zero.
    if (op.count === "any") continue;
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
  // 🆕🆕 **D489 — THE DECLINABLE ARM PRINTS ITS CEILING AND ITS HEDGE**, so the note
  // this builds is *"Discard up to 3 Energy cards from your hand."* — the printed head
  // sentence, byte for byte. That is not a coincidence to be tidied away: the caption
  // is built from the very fields the op carries, so a park whose heading says "up to
  // 3" while the op lost its `cap` is a byte string this deploy cannot write (D457).
  // PLURAL unconditionally: the column prints no "up to 1", and inventing a singular
  // branch for it would be a rung nothing can reach (D205).
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

/** D206 — a switch (`switchActive`) or a gust plus the §9.2 filing the printed
    *"If you do"* reads. ONE helper for BOTH ops because it is one move:
    `switchInto` on two different seats, which is the whole of the difference.

    ⚠️ THE FILED UID IS THE ONE `switchInto` ANNOUNCED, AND THAT IS A DELIBERATE
    RESTRUCTURE RATHER THAN A STYLE. The first draft compared the returned state
    to the argument — `switchInto` has three guards that return it UNCHANGED (a
    non-bench ref, a missing incoming body, a missing top uid), each a board on
    which the printed switch DID NOT HAPPEN, and filing off the CHOSEN REF would
    read all three as successes and let Giovanni's gust fire off an antecedent
    that never occurred. That identity check was correct and **UNKILLABLE**: all
    three refusals are unreachable from an authored row (`validateChoice` matches
    the wire answer against the PROMPT, and a Trainer play always has an Active),
    so no test could distinguish it from its own inversion. D205's precedent is to
    REMOVE such a line rather than test around it, so the value now comes from the
    `POKEMON_SWITCHED` row, which `switchInto` emits exactly when the move
    happened. The filing IS the announcement: there is no branch of our own left
    on top of its three refusals, every piece here runs on every reachable board,
    and the record and the event log can never disagree about whether a switch
    occurred. */
function switchRecording(
  op: { recordAs?: EffectSlot },
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
  op: Extract<EffectOp, { op: "switchActive" }>,
  sourceUid?: string,
): PokemonRef[] {
  if (op.fromSource === true) {
    // D244 — the printed PRONOUN ("switch **it** with your Active Pokémon"): the
    // bench end is the body the sentence is printed on, so there is nothing to
    // pick. Kept to BENCH refs, which is both halves of one rule: a Pokémon may
    // not switch with itself, and Meowscarada's printed "if this Pokémon is on
    // your Bench" is that same test — so a source in the Active Spot empties the
    // set and `programPlayable` refuses the use, with no benched-only flag.
    return sourceRef(state, { seat, sourceUid }).filter((ref) => ref.spot.spot === "bench");
  }
  // 🆕 D273 — the BENCH end takes two more printed narrowings before the owner
  // question below, and they are applied HERE rather than in a second helper
  // because this function is the SOLE FUNNEL: `programPlayable` (cardplay.ts)
  // and the interpreter arm both ask it, so a rider honoured in one place and
  // not the other would offer a body the validator then refused.
  const bench = switchBenchNarrowing(
    state,
    subgroupRefs(state, ownBenchRefs(state, seat), op.ownerPokemon),
    op,
  );
  // ⚠️ THE OWNER QUESTION READS `op.ownerPokemon` AND NOT `bench.length`, so the
  // two new riders do NOT get the Active-end reading below. Pecharunt's sentence
  // qualifies only the destination ("switch 1 of your Benched {D} Pokémon … with
  // your Active Pokémon"); Giovanni's qualifies both ends with one word. Sharing
  // the early return would empty the set on every board whose Active is not {D}.
  if (op.ownerPokemon === undefined) return bench;
  // The printed sentence's FIRST noun — "Switch your Active <owner>'s Pokémon".
  // Asked through the SAME `subgroupRefs` call the Bench end uses, so the two
  // halves of one printed owner cannot come to mean two different things.
  const activeInSubgroup =
    subgroupRefs(state, [{ seat, spot: { spot: "active" } }], op.ownerPokemon).length > 0;
  return activeInSubgroup ? bench : [];
}

/** 🆕 D331 — the bodies a `gust` may drag up on the OPPONENT's board: their whole
    Bench, narrowed by the printed stage word when the card spells one.

    🛑 **EXPORTED FOR `programPlayable` (cardplay.ts), AND THAT EXPORT IS THE
    POINT OF THE FUNCTION RATHER THAN A CONVENIENCE.** Until this slice the gate
    over there read `state.players[otherSeat(seat)].bench.length === 0` — a raw
    bench LENGTH, which is `oppBenchRefs` only while no printing narrows the set.
    Lisia's Appeal `sv08-179`/`-234`/`-246` narrows it, so a rider honoured in the
    interpreter and not in the gate would have offered a prompt with no candidates
    on a Bench of pure Evolutions, after spending the turn's one Supporter (§7.2).
    That is exactly what D206 fixed for `switchActive` — *"the op's own candidate
    function answers instead … so the refusal and the offer can never disagree"* —
    and `switchActiveTargets`' doc states the same rule as a house invariant: one
    SOLE FUNNEL, asked by both readers.

    ⚠️ **IT IS BEHAVIOUR-PRESERVING FOR EVERY PRINTING THAT SHIPPED BEFORE IT.**
    With `basicOnly` absent this returns `oppBenchRefs` unfiltered, whose `.length`
    IS the bench length the old gate read, so Boss's Orders, Pokémon Catcher,
    Prime Catcher, Giovanni's consequent and Florges' coin-gated gust all keep
    their exact candidate sets and their exact playability.

    ⚠️ **THE SHIELD IS DELIBERATELY NOT IN HERE.** `unshieldedRefs` takes `ctx` and
    `events` because it ANNOUNCES each refusal it makes, and `programPlayable` is a
    pure question with neither — so the shield stays wrapped around the call site,
    exactly where `returnBenched` keeps it. This funnel answers "which bodies does
    the CARD name", not "which of them may be touched right now"; those are two
    questions and only the first one is printed. */
export function gustTargets(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "gust" }>,
): PokemonRef[] {
  const bench = oppBenchRefs(state, seat);
  // 🆕 D349 — THE SECOND RIDER, APPLIED FIRST AND SEPARATELY BECAUSE IT READS THE
  // BODY AND NOT THE CARD. `remainingHpWithin` (continuous.ts) is the one
  // spelling of *"N HP or less remaining"* in this engine; the `refPokemon`
  // lookup is the board read `refTopCard` below deliberately is not. A ref that
  // resolves to no body is dropped for `basicOnly`'s stated reason — a narrowed
  // sentence must not offer a body it cannot read.
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

/** 🆕🆕 **D416 — HOW MANY DAMAGE COUNTERS ARE ON THIS BODY?** The printed UNIT,
    which the engine does not store: `InPlayPokemon.damage` is HP, and a counter is
    ten of it.

    🛑 **`Math.floor(damage / 10)` AND NOT `damage === 60`, WHICH IS THE HOUSE
    SPELLING AND NOT A STYLE CHOICE.** Three sites in `attack.ts` already convert
    this way for the printed *"for each damage counter on …"* scalings (the
    attacker's own, the defender's, and the bench fold), and the floor is what makes
    the two readings agree on a board where damage is not a clean multiple of ten —
    a 65-damage body carries SIX counters, and an `=== 60` window would answer NO to
    a sentence the print answers YES to.

    ⚠️ **ITS HOME IS HERE, BESIDE ITS ONE READER, AND THAT IS A DECISION RATHER
    THAN A DEFAULT.** The obvious sibling is `remainingHpWithin` (continuous.ts),
    the *"N HP or less remaining"* window `gust.remainingHpAtMost` reads — but that
    predicate lives over there because it needs `state`: `effectiveMaxHp` folds HP
    auras and Tools, so the answer moves with the whole board. This one is a pure
    function of ONE body's own `damage` field, reads no passive, takes no seat and
    cannot disagree with anything continuous.ts aggregates. Putting a state-free
    read in the state-dependent module would say the two are the same kind of
    question, and they are not. */
function damageCountersOn(pokemon: InPlayPokemon): number {
  return Math.floor(pokemon.damage / 10);
}

/** 🆕🆕 **D437 — DOES THIS BODY HAVE *ANY* DAMAGE COUNTERS ON IT?** The printed
    predicate of *"…to 1 of your opponent's Benched Pokémon **that has any damage
    counters on it**."* (corpus row 528), asked per BODY as a candidate-set
    narrowing rather than per BOARD as a gate.

    🛑 **`damage > 0` AND NOT `damageCountersOn(pokemon) >= 1`, AND THE PRECEDENT IS
    UNANIMOUS RATHER THAN NEAREST.** Five shipped `conditionHolds` arms already read
    this exact printed phrase — `opponentActiveDamaged`, `yourActiveDamaged`,
    `yourBenchDamaged`, `yourBenchAllDamaged`, `yourBenchNamedDamaged` — and every
    one of the five spells it `p.damage > 0`, with the first saying so outright in
    its own comment (*"Damage is HP on the model, so 'any counters' is `> 0`"*).
    `damageCountersOn` directly above is not a disagreeing sibling: it exists for a
    phrase whose comparand is a NUMBER (*"exactly 6 damage counters"*), where the
    unit has to be counters or `65` damage answers a question the print answers the
    other way. D436's rule — **the comparand fixes the unit** — sends *"any"* to the
    presence test and *"exactly N"* to the count. Following the structurally nearest
    neighbour instead of the phrase's own five would have been D433's `markers`
    mistake at a predicate.

    ⚠️ **THE TWO SPELLINGS DIFFER ON EXACTLY ONE CLASS OF BOARD — 1 to 9 damage —
    AND THAT BOARD IS NOT REACHABLE IN PLAY**, which is measured rather than assumed:
    every writer of `InPlayPokemon.damage` in this file adds or subtracts a printed
    amount or a catalog HP figure (`koSurvivalClamp`'s `hp - 10`), all multiples of
    ten, and the engine has no halving, rounding or percentage damage anywhere. It is
    still constructible as a FIXTURE, and `filteredBenchSnipe.test.ts` drives it, so
    the choice is pinned by a rung rather than left to a comment: a 5-damage body IS
    a candidate here, and a `damageCountersOn(p) >= 1` build would drop it.

    ⚠️ Its home is beside `damageCountersOn` for that function's own stated reason:
    a pure read of ONE body's `damage` field, no `state`, no seat, no passive — the
    line that keeps it out of continuous.ts, where `remainingHpWithin` lives because
    it folds HP auras. And it is a NAMED READER rather than an inline predicate at
    `snipeTargets` for D222's: the day a second sentence prints this phrase over a
    candidate set, there is one place for it to ask. */
function hasAnyDamageCounters(pokemon: InPlayPokemon): boolean {
  return pokemon.damage > 0;
}

/** 🆕🆕 **D416 — THE ONE FUNNEL FOR A `knockOutChosen`'s CANDIDATE SET**, and the
    fourth op in this file to get one. `gustTargets` (D331) and `snipeTargets`
    (D345) each earned theirs by a `programPlayable` gate that had re-implemented
    the op's predicate and drifted; this one is written as a funnel FROM THE FIRST
    COMMIT, which is the same rule stated forwards instead of paid for backwards.

    🛑 **THE SCOPE LINE IS `snipeTargets`' VERBATIM.** `opponentBench` →
    `oppBenchRefs`, `opponentAny` → `oppAnyRefs` (Active first, then the Bench in
    index order), which is exactly why `target` reuses `damageChosen`'s two member
    names rather than coining new ones: two vocabularies over one pair of helpers
    is two chances to disagree about what "any" includes.

    ⚠️ **THE RIDERS COMPOSE AND NEITHER IS PRINTED WITH THE OTHER TODAY.** The
    counter window is applied FIRST and separately because it reads the BODY
    (`refPokemon`) while `basicOnly` reads the CARD (`refTopCard`) — `gustTargets`'
    own split, for its own stated reason. A ref that resolves to no body or no card
    is DROPPED rather than admitted: a narrowed sentence must not offer a body it
    cannot read.

    ⚠️ **THE SHIELD IS DELIBERATELY NOT IN HERE**, `gustTargets`' rule verbatim:
    `unshieldedRefs` takes `ctx` and `events` because it ANNOUNCES each refusal, and
    this function answers *"which bodies does the CARD name"* — not *"which of them
    may be touched right now"*. Two questions; only the first is printed.

    ⚠️ **EXPORTED, THOUGH `programPlayable` DOES NOT CALL IT — AND THE ABSENCE IS
    STATED RATHER THAN LEFT TO BE NOTICED.** Both producers are ATTACKS, and attacks
    never consult that gate (§8), so a line beside the `gust` / `damageChosen` /
    `healChosen` ones would be dead today. It is exported anyway so that the day a
    registry row prints this op, the gate has a funnel to ask instead of a bench
    length to re-implement — which is the precise mistake D345 recorded. */
export function knockOutChosenTargets(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "knockOutChosen" }>,
): PokemonRef[] {
  const scope = op.target === "opponentAny" ? oppAnyRefs(state, seat) : oppBenchRefs(state, seat);
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

/** 🆕🆕 D416 — the printed noun for a `knockOutChosen`'s candidates, in the card's
    own word order. `gustTargetNoun`'s twin and for its reason: the caption must
    name exactly the set the funnel offers, or the dialog contradicts its own
    validator. Both live printings are reproduced verbatim — *"Knock Out 1 of your
    opponent's Benched Basic Pokémon."* and *"Knock Out 1 of your opponent's Pokémon
    that has exactly 6 damage counters on it."* */
function knockOutChosenNote(op: Extract<EffectOp, { op: "knockOutChosen" }>): string {
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

/** 🆕 D331 — the printed noun for a `gust`'s candidates, in the card's own word
    order. `switchTargetNoun`'s twin one op over and for its reason: the caption
    must name exactly the set `gustTargets` offers, or the dialog contradicts its
    own validator. The unmarked op still reads "the opponent's Benched Pokémon"
    byte for byte, so every gust printing before this one keeps its prompt. */
function gustTargetNoun(op: Extract<EffectOp, { op: "gust" }>): string {
  const stage = op.basicOnly === true ? "Basic " : "";
  // 🆕 D349 — the remaining-HP window rides in the card's own word ORDER, after
  // the noun, because that is where the print puts it: *"…Benched Pokémon **that
  // has 90 HP or less remaining**"*. Absent, the caption is byte-identical to
  // every gust printing that shipped before this one — the two riders compose,
  // and no printed card spells both today.
  const window =
    op.remainingHpAtMost === undefined
      ? ""
      : ` that has ${op.remainingHpAtMost} HP or less remaining`;
  return `Gust up which of the opponent's Benched ${stage}Pokémon${window}?`;
}

/** 🆕🛑 **D349 — THE SOLE FUNNEL FOR `healChosen`'s CANDIDATES**, `gustTargets`'
    twin one family over and for the identical stated reason: `programPlayable`
    (cardplay.ts) must refuse a play that could only whiff, and a gate that
    recomputed the candidate set would be a second copy of the printed rule, free
    to drift (D206's finding, D331's repair, D345's second instance).

    🛑 **THIS OP HAD NO GATE AT ALL UNTIL THIS SLICE, AND THAT WAS CORRECT.**
    Unnarrowed, the candidates are every own in-play Pokémon — a set §1.1 makes
    non-empty at every legal board — so "could only whiff" was UNREACHABLE and a
    line refusing it would have been a branch no board can take. The first rider
    makes it reachable on its first printing, and that printing is a SUPPORTER
    (Bianca's Devotion), so the afford-then-reject would cost the turn's one
    Supporter under §7.2. **A missing gate is not a defect until a rider arrives;
    it becomes one in the same commit as the rider.**

    ⚠️ **IT IS BEHAVIOUR-PRESERVING FOR EVERY PRINTING THAT SHIPPED BEFORE IT.**
    With `remainingHpAtMost` absent this returns exactly what the `case` arm
    computed inline before — `ownBenchRefs` under the printed zone word,
    `ownInPlayRefs` without it — so Potion, Arboliva's "Enriching Oil" and
    Saguaro's "up to 2" all keep their exact candidate sets, their exact parks
    and their exact playability.

    ⚠️ **THE ZONE WORD IS APPLIED FIRST AND THE WINDOW SECOND, AND THE ORDER IS
    NOT OBSERVABLE** — both are conjuncts over the same set. It is written this
    way round because the zone chooses the POPULATION the card names and the
    window narrows it, which is the order the sentence reads in. */
export function healChosenTargets(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "healChosen" }>,
): PokemonRef[] {
  const zoned = op.zone === "bench" ? ownBenchRefs(state, seat) : ownInPlayRefs(state, seat);
  const atMost = op.remainingHpAtMost;
  if (atMost === undefined) return zoned;
  return zoned.filter((ref) => {
    const pokemon = refPokemon(state, ref);
    // A ref this function cannot resolve is dropped rather than offered, exactly
    // as `gustTargets` drops an unreadable body: a narrowed sentence must not put
    // a Pokémon in a prompt whose printed clause it cannot evaluate.
    return pokemon !== undefined && remainingHpWithin(state, pokemon, atMost);
  });
}

/** 🆕 D349 — the printed noun for a `healChosen`'s candidates, in the card's own
    word order, and `gustTargetNoun`'s twin for its reason: the caption must name
    exactly the set `healChosenTargets` offers or the dialog contradicts its own
    validator. The unmarked op still reads "Heal which of your Pokémon?" byte for
    byte, so every heal printing before this one keeps its prompt. */
function healTargetNoun(op: Extract<EffectOp, { op: "healChosen" }>): string {
  const zoneWord = op.zone === "bench" ? "Benched " : "";
  const window =
    op.remainingHpAtMost === undefined
      ? ""
      : ` that has ${op.remainingHpAtMost} HP or less remaining`;
  return `Heal which of your ${zoneWord}Pokémon${window}?`;
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
    // D412 — and unlike the retreat path's copy of this line, THIS one is live:
    // a Boss's Orders dragging the self-locked body off the Active Spot inside
    // its own window sheds the lock with the rest of the effects of the attack.
    retreatLockedTurn: null,
    attackBlock: null,
    attackLockedTurn: null,
    damageReduction: null,
    // 🆕🆕 D432 — and the NO-WEAKNESS bar's story here is the reduction's
    // above it verbatim: the window is the OPPONENT's turn, so the only player who
    // can move the body inside it is the opponent — a Boss's Orders played on that
    // very turn drags the unweakened body off the spot and the bar goes with it.
    // ⚠️ AND IT IS THE ONE MEMBER OF THIS SET WHOSE CLEAR CANNOT BE WITNESSED BY A
    // NUMBER, because §8.5 applies Weakness only to the ACTIVE: once the body is
    // benched there is no Weakness step left for the bar to have removed. Pinned
    // structurally off the field instead (`noWeaknessBar.test.ts`).
    noWeaknessTurn: null,
    // 🆕🆕 D434 — the SCHEDULED counter placement, and this literal is where the
    // field's VOLUNTARY half lives: the window is the HOLDER's own turn, so the
    // player who reaches this line is the victim playing their own Switch (or
    // Escape Rope) to walk the Defending Pokémon out from under the schedule
    // before it fires. §10 sheds the effects of attacks and the schedule goes with
    // the body — the printed answer to this family, and the sharpest available
    // witness that the clear is real (the Checkup that follows places nothing).
    scheduledEffect: null,
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
  const moved = withSide(state, seat, {
    ...side,
    active: { ...incoming, promotedTurn: state.turn },
    bench,
  });
  // 🆕 D320 — §9 THE OPPONENT-ACTION TRIGGER ON THIS MOVE (Magcargo `sv05-029`
  // "Lava Zone": *"Whenever your opponent's Active Pokémon moves to the Bench
  // during their turn, their new Active Pokémon is now Burned."*). ONE of the
  // engine's TWO Active→Bench moves; `retreat` (turn.ts) is the other and pays
  // its own cost inline rather than coming through here, which is why the gate
  // and the sweep live in triggers.ts `runActiveBenchedTriggers` and both
  // movers call it. The §8.1 promotion after a Knock Out is NOT one of the two:
  // the Knocked Out body went to the DISCARD, so nothing moved to the Bench.
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
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (pokemon === undefined || pokemon === null) return state;
  const uid = topUid(pokemon);
  if (uid === undefined) return state;
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
  /** ⚠️⚠️ D246 — THE PRINTED BARE NOUN (`attachEnergyFrom.anyEnergy`). The
      family's ordinary noun is *"a **Basic** Energy card"*, which is the
      `"Normal"` test below and the reason this op has never reached a Special
      Energy; two legal printings spell *"**an** Energy card"* instead (Snorlax
      `sv06-136` from the hand, Landorus `sv08-110` from the discard pile) and
      mean the whole category. THE NARROWING LIVES HERE AND NOWHERE ELSE: this is
      the single function every consumer of the op asks — the park guard, the
      apply, `firstAttachableEnergy` and through it `programPlayable` — so the
      widened noun cannot reach three of them and miss the fourth. */
  anyEnergy = false,
  /** ⚠️⚠️ D353 — THE PRINTED PROPER NAME (`attachEnergyFrom.energyName`), the
      *"attach up to 2 **Spiky Energy** cards"* of Lycanroc `sv09-085`/`sv09-166`.
      It rides in HERE for `anyEnergy`'s reason verbatim — this is the single
      function every consumer of the op asks, so a narrowing spelled anywhere
      else would reach three of the four and miss the fourth.

      🛑 **AND IT SUBSUMES THE BASIC TEST BELOW RATHER THAN CONJOINING WITH IT.**
      Every by-name printing in the catalog names a SPECIAL Energy (Spiky ×2
      legal, Therapeutic ×2 rotated), so a name that still had to pass
      `energyType === "Normal"` would match nothing on every card that prints
      one. A proper name decides the Basic/Special question by itself. */
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
      // "Normal" = a BASIC energy (Special is a special energy). ⚠️ D246 — the
      // printed bare noun lifts the test rather than replacing it: `anyEnergy`
      // admits BOTH kinds, which is what "an Energy card" says, and is not a
      // Special-only filter (`specialEnergy` is that, one vocabulary over).
      // ⚠️ D353 — a printed proper NAME lifts it too, and for a different
      // reason: `anyEnergy` widens the category, a name replaces the category
      // question outright.
      (anyEnergy || energyName !== undefined || card.energyType === "Normal") &&
      (energyType === undefined || energyProvidesOf(card) === energyType) &&
      // D353 — answered by the CardFilter predicate that already exists, so the
      // op adds a field and no predicate.
      (energyName === undefined || matchesFilter(card, { kind: "byName", name: energyName }))
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
  /** D246 — the printed bare noun, carried through so the play gate and the park
      guard ask the SAME question the apply will answer. A gate that still meant
      "Basic only" would refuse an Ability whose printed "an Energy card" is
      sitting in the hand as a Special. */
  anyEnergy = false,
  /** D353 — the printed proper NAME, carried through for `anyEnergy`'s reason
      verbatim: the play gate and the park guard must ask the SAME question the
      apply will answer, or an Ability whose printed *"Spiky Energy"* is not in
      the discard pile would still be offered on a pile full of Basic Energy. */
  energyName?: string,
): string | undefined {
  return attachableEnergies(state, seat, source, energyType, 1, anyEnergy, energyName)[0];
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
      // 🆕🆕 D354 — `targetType` may be a LIST (the printed union of types), so
      // the test is an INTERSECTION of two lists rather than a membership in
      // one: the body's TOP card carries several types of its own, and the rider
      // may name several. ANY-of-ANY, because both sides are disjunctions —
      // "your {P} Pokémon and {M} Pokémon" admits a body that is either, and a
      // dual-type body qualifies on either half. Normalised through
      // `targetTypeNames` so the caption below cannot drift from this gate.
      const wantedTypes = targetTypeNames(riders.targetType);
      if (wantedTypes.length > 0) {
        const cardTypes = card?.types ?? [];
        if (!wantedTypes.some((wanted) => cardTypes.includes(wanted))) return false;
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
    top card, and an attach aimed at it would be the evolution's, not ours.

    ⚠️ TAKES `Pick<EffectContext, …>` RATHER THAN THE WHOLE CONTEXT, AS OF D222,
    and the narrowing is what lets the THIRD reader share it. `discardEnergy`'s
    `self` arm is asked by `programPlayable` (cardplay.ts) BEFORE any program
    runs, so there is no `EffectContext` in existence at that moment — only a
    seat and the uid the action names. Widening the answer to a synthetic full
    context would have been a lie about what this function reads; narrowing the
    parameter to the two fields it actually reads is the same helper, honestly
    typed, and every existing call site still passes its `ctx` unchanged. */
function sourceRef(state: GameState, ctx: Pick<EffectContext, "seat" | "sourceUid">): PokemonRef[] {
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
      • 🆕 **`oneTarget` ADDS NO FOURTH CEILING, AND THAT IS THE ASYMMETRY WORTH
        STATING** (D457). Its sibling caps cards PER target, so a short target list
        shortens the pick; this one caps TARGETS, and one target may take every
        card in the batch — *"attach them to 1 of your Pokémon"* on a one-Pokémon
        board still attaches two. The board term is `targets.length >= 1`, which
        the empty-target dead end above already answers, so the arithmetic here is
        deliberately unmoved. A `Math.min(op.max, 1)` here would be the mistake
        this bullet exists to name: it would offer ONE card off a card that prints
        two.

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

/** ⚠️⚠️ D247 — What an `attachFromHand` op is offering: the controller's own HAND
    cards its filter admits (hand order), the eligible targets, and the cap.

    **THE CAP IS ALWAYS THE CANDIDATE SET, because every sentence this op reads
    prints "any number"** — there is no `max` on the op to clamp against (see its
    doc). That is also why this offer runs NO interchangeable collapse, unlike
    `attachFromDeckOffer` one function up, and the reason is arithmetic rather
    than taste: that collapse keeps at most `max` representatives per class, and
    with `max === candidates.length` the test `already >= cap` can never fire, so
    a collapse here would be an inert copy of a rule. It would also be wrong in
    spirit — the hand is a zone its owner already sees card by card, where the
    deck is not, so hiding a duplicate row would hide a card the player is
    looking at.

    ⚠️ THE RIDERS ARGUMENT IS THE EMPTY OBJECT, AND THAT IS THE PRINT SPEAKING
    RATHER THAN A SHORTCUT. Every sentence this op reads prints the bare *"to your
    Pokémon"*, so the op declares no target rider (D135 — a field with no printing
    behind it is a branch no test can witness) and the argument has nothing to
    carry. What is shared is still the RULE: the un-narrowed target set comes from
    `attachEnergyTargets` exactly as the other three attach ops' narrowed ones do,
    so the fourth op cannot come to disagree about who may receive an attach. The
    day a printing spells "your Benched {W} Pokémon", the op gains the field and
    this call site passes it — the same one-line change `attachFromDeck` made.

    NOTE — this reads the HAND, which is why it is the one offer in this family
    that could safely be a `programPlayable` input. It is not one, because no
    printing of this op is a Trainer or an Ability; see the op's doc. */
function attachFromHandOffer(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "attachFromHand" }>,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  const candidates = state.players[seat].hand.filter((uid) =>
    matchesFilter(cardOf(state, uid), op.filter),
  );
  return { candidates, targets: attachEnergyTargets(state, seat, {}), max: candidates.length };
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
    the live source zone are the whole input.

    ⚠️⚠️ D247 — **`zone` IS THE ONLY THING THAT SEPARATES THE DECK SEARCH FROM THE
    HAND ATTACH, SO IT IS A PARAMETER AND NOT A SECOND COPY OF THIS FUNCTION.**
    `attachFromHand` (Alolan Exeggutor ex "Tropical Frenzy") moves cards out of
    the controller's HAND onto the same targets under the same wire-safety rules;
    a duplicated mover is exactly the "two readers of one rule drift" defect this
    file refuses one paragraph up, and the two would have drifted first on the
    membership re-read — the one line that keeps a stale uid from being conjured
    onto the board. The zone names a `PlayerSide` key, so the re-read, the removal
    and the `to.seat` check are one implementation for both. */
function attachFromZoneApply(
  state: GameState,
  assignments: readonly { uid: string; to: PokemonRef }[],
  zone: "deck" | "hand",
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
      [zone]: side[zone].filter((uid) => !attached.has(uid)),
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
    make; a printing that combines them would owe its own argument.

    ⚠️ `healTarget` (D236) is `bonusCounters`' MIRROR and follows every one of its
    rules — same body, same once-per-op, same "the op that knows the ref does the
    work". It is applied LAST, after the attach is written, so what it heals is
    the board this call produced. */
function attachEnergyFrom(
  state: GameState,
  op: Extract<EffectOp, { op: "attachEnergyFrom" }>,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
  /** The running §9.2 record (D221). Every WHIFF below returns early and files
      NOTHING: `recorded()` answers `[]` for a missing key and `recordGateHolds`
      asks the length, so an explicit empty filing on each of those four paths
      would be four lines that cannot change an outcome — D205's precedent, and
      the same argument `switchActive`'s zero-candidate path already carries. */
  record: EffectRecord = {},
  /** 🆕🆕 D359 — HOW MANY the controller actually asked for, off the answer.
      Absent = the whole printed batch, which is what every call site meant before
      this slice and what the FORCED path still means: `parkOrForce` only forces
      when no ceiling was offered, so a forced attach is always the mandatory one.
      Clamped to the printed ceiling here rather than trusted, because this
      function is reachable from `applyChoice` with a wire-supplied number — the
      validator refuses an over-take first, and this is the belt behind it. */
  take?: number,
): GameState {
  if (ref.seat !== ctx.seat) return state;
  const printed = op.count ?? 1; // absent = the single attach every pre-D205 program meant
  const energyUids = attachableEnergies(
    state,
    ctx.seat,
    op.source,
    op.energyType,
    take === undefined ? printed : Math.min(take, printed),
    op.anyEnergy, // D246 — absent = the printed "a BASIC Energy card"
    op.energyName, // D353 — absent = the printed noun is a CATEGORY, not a NAME
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
  // What was ATTACHED, not what was offered (§9.2) — the ENERGY uids, the one
  // kind of thing this record's values ever hold, which is what lets the gate's
  // `contains: "yourActive"` ask the BOARD where they ended up. Filed once, here,
  // rather than at the two call sites: the forced path and the resumed pick both
  // land in this function, and two filings are two places to drift.
  recordMoved(record, op.recordAs, energyUids);
  const index = ref.spot.spot === "active" ? -1 : (ref.spot as { index: number }).index;
  const next =
    index < 0
      ? withSide(state, ctx.seat, { ...base, active: updated })
      : withSide(state, ctx.seat, {
          ...base,
          bench: side.bench.map((p, i) => (i === index ? updated : p)),
        });
  // ⚠️⚠️ D236 — "**If you do, heal all damage from that Pokémon.**" THE HEAL IS
  // THE LAST THING THIS FUNCTION DOES, AND IT IS UNREACHABLE FROM EVERY WHIFF:
  // no matching Energy, no such Pokémon, an empty body and a wrong-seat ref all
  // return above, so the printed "if you do" needs no gate of its own — the
  // early returns ARE it. Once past them the attach has happened, which is the
  // exact condition the clause names.
  //
  // `healChosen` is REUSED rather than re-implemented, and the name is the only
  // misleading thing about it: it takes a `ref` and heals it, and the CHOOSING
  // lives in the op that parks. Passing this op's already-chosen `ref` is what
  // makes "that Pokémon" mean the body just fed instead of a second question —
  // and it inherits the clamp ("all" = whatever damage is there, a number =
  // `min(amount, damage)`), the zero-heal silence and the `HEALED` row every
  // other heal in the engine emits, for free.
  //
  // ⚠️ ONCE PER OP, NOT ONCE PER CARD — `bonusCounters`' rule, on `bonusCounters`'
  // mirror, so a `count: 2` attach heals once rather than twice. The two riders
  // still do not co-occur on any printing.
  return op.healTarget === undefined ? next : healChosen(next, ref, op.healTarget, ctx, events);
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
    routes here: `restTo` (Hydreigon's "Discard the other cards"; Metang's "Shuffle
    the other cards and put them on the bottom of your deck") is a cost the card
    charges whether or not the look found anything to attach, and one apply is what
    keeps a branch from skipping it. `restTo` absent (Electric Generator) leaves the
    unattached cards exactly where they are — still on top of the deck, for the
    trailing `shuffleDeck` op to scramble.

    🆕🆕 **D352 — TWO DESTINATIONS, ONE OF THEM AN EVENT AND ONE OF THEM NOT**, and
    the fork is `revealFromTop`'s transferred verbatim rather than re-derived: that
    is precisely what `attachFromTop`'s own doc meant when it priced this widening
    at "the field and nothing else, because the apply below is shared in shape".
    ⚠️ **THE LEFTOVERS ARE `window \ attached`, NOT `candidates \ attached`** — the
    printed "other cards" are every card the player LOOKED AT and did not take,
    including the ones the filter never admitted. That was already true of the
    discard arm; it is stated here because under `"shuffledBottom"` a card the
    filter refused is put back UNDER the deck rather than into the pile, and the
    difference is visible to a player counting their deck.

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
  const rest = op.restTo === undefined ? [] : window.filter((uid) => !attached.has(uid));
  if (attached.size === 0 && rest.length === 0) return state;
  // 🆕🆕 D352 — THE LEFTOVERS FORK, `revealFromTop`'s TRANSFERRED RATHER THAN
  // RE-DERIVED (which is what D335 meant by "the apply below is shared in shape").
  // `toPile` is the cards that LEFT the deck; `underneath` is the cards that stayed
  // in it and merely moved. Disjoint by construction — `op.restTo` is ONE value —
  // and the two names exist so a future third value cannot silently be both.
  const toPile = op.restTo === "discard" ? rest : [];
  // `"shuffledBottom"` is the only path that touches `rngState`, and `shuffle`
  // leaves it alone for a leftover of 0 or 1 (its loop starts at `length - 1`), so
  // a replay of a pre-D352 board is untouched by the branch existing.
  const [underneath, rngState] =
    op.restTo === "shuffledBottom"
      ? shuffle(rest, state.rngState)
      : [[] as string[], state.rngState];
  const removed = new Set([...attached, ...rest]);
  // Own deck, own action: `actor` IS `seat` here and cannot be anything else — this
  // op only ever looks at `ctx.seat`'s own top. That equality is what makes the row
  // read in the ACTIVE voice (D153); it is written out rather than left implicit
  // because a future from-the-top op aimed at the opponent's deck would have to
  // change it, and a hardcoded `actor: ctx.seat` is a line such a slice must edit.
  // 🆕 D352 — ONLY THE DISCARD ARM ANNOUNCES ANYTHING, which is `DECK_TOP_DISCARDED`'s
  // own qualifying test applied rather than counted: a card put UNDER the deck never
  // left it, and `DECK_TOP_REVEALED` has already told both seats a look happened.
  // `SHUFFLE` is refused for `revealFromTop`'s reason — that row claims the whole
  // deck was shuffled, where this randomizes a two-to-four card tail.
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

/** Move each chosen Energy off the Pokémon it sits on and onto the destination
    THAT PICK NAMES, on the board the OP names (Energy Switch / Poppy / N's Plan /
    Kilowattrel — and, 🆕 D443, the two opponent-board printings).
    validateChoice already proved every uid was offered, appears once, and names a
    destination that is an offered ref other than its own host — on ONE source
    unless the prompt carried `anySource` (D226) and onto ONE destination unless it
    carried `anyDest` (D442). This re-finds each on the live board (wire-safety,
    like searchMove/retrieveMove) and moves only those actually attached to an own
    in-play Pokémon OTHER than the destination the pick names — a stale uid, a
    self-targeting one, or one aimed at a body that is no longer there is SKIPPED,
    never duplicated. The Pokémon stay put (no bench compaction), so the
    ENERGY_MOVED `from`/`to` targets are valid against the post-state. Atomic:
    strip then re-attach in one reduction, so an Energy is never left detached —
    including across a multi-source, multi-destination move, where the whole answer
    is still ONE reduction and the several events are its record, not its stages.

    🆕🆕 **D442 — THE PARAMETER IS THE MAP, AND THE `destRef` PARAMETER IS GONE
    RATHER THAN JOINED.** A shared destination is expressible as a map whose
    entries agree, so keeping both would be two ways to say one thing at the one
    site that writes the board (`EffectChoice`'s own note on the rename). Every
    pre-D442 board reduces byte-identically: with one destination the grouping
    below produces exactly one group per source, in the same order, so the
    `ENERGY_MOVED` rows are the ones this function has always emitted. */
function moveEnergyApply(
  state: GameState,
  picks: readonly { uid: string; dest: PokemonRef }[],
  op: Extract<EffectOp, { op: "moveEnergy" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // 🆕🆕 D443 — THE BOARD, ASKED OF THE OP AND NOT DERIVED FROM THE ANSWER. Every
  // `state.players[ctx.seat]` and every `ctx.seat` comparison below became a
  // `board` one in a single edit, because this function walks exactly ONE side and
  // that side is the op's, not the controller's.
  const board = moveBoardSeat(op, ctx.seat);
  const side = state.players[board];
  // ⚠️ THE DESTINATION IS REBUILT FIELD BY FIELD, NEVER SPREAD OFF THE PICK — that
  // object came from the WIRE. `validateChoice` proves it `refEquals` an offered
  // ref, but refEquals compares only seat/spot/index, so any extra key a client
  // hangs on it (`{spot:"active", index:99, evil:"…"}`) would ride the spread
  // straight into an event that is handed to the animator, the log and, in P4,
  // broadcast to both players. The state was always safe (the extra keys are
  // inert); the EVENT is the §2 copy contract, and a copy of attacker-controlled
  // data is not a copy of the engine's own value.
  const targetOf = (ref: PokemonRef): PokemonTarget =>
    ref.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: ref.spot.index };
  const keyOf = (target: PokemonTarget): string =>
    target.spot === "active" ? "active" : `bench:${target.index}`;
  const bodyAt = (target: PokemonTarget): InPlayPokemon | undefined =>
    target.spot === "active" ? (side.active ?? undefined) : side.bench[target.index];
  // uid → where it is going. Built first so the strip walk can ask one question per
  // Energy, and so a pick naming a body that is not in play drops out HERE rather
  // than after its uid has already left its host — which is the resurrection-shaped
  // failure D429 named, read forwards: a card that leaves one zone and enters none.
  const destOf = new Map<string, PokemonTarget>();
  for (const { uid, dest } of picks) {
    // 🆕 D443 — `dest.seat !== board` WHERE THIS READ `!== ctx.seat`, AND IT IS THE
    // ONE EXECUTABLE OWN-BOARD REFUSAL THE WHOLE PIPELINE HAD. It is still a
    // refusal, just of a different seat: a pick aimed at the side this op does NOT
    // act on is dropped silently, which keeps the wire belt (`validateChoice`
    // already proved the ref was OFFERED) underneath a cross-board frame.
    if (typeof uid !== "string" || dest.seat !== board || destOf.has(uid)) continue;
    const to = targetOf(dest);
    if (bodyAt(to) === undefined) continue;
    destOf.set(uid, to);
  }
  if (destOf.size === 0) return state;
  // ⚠️ D226 — GROUPED BY SOURCE, WHERE THIS USED TO HOLD ONE, and 🆕 D442 — BY
  // (SOURCE, DESTINATION) PAIR, WHERE IT USED TO HOLD ONE DESTINATION.
  // `ENERGY_MOVED`'s own doc PROMISES that all of an event's `uids` came off the
  // one `from` — a promise the log renders literally ("moved 2 energy from Bench 1
  // to Active") — and it says the same thing about `to`. So the answer is one event
  // per PAIR rather than a widened event: nothing about the event shape moves, no
  // consumer changes, `MATCH_RECORD_VERSION` stays put, and the single-source
  // single-destination case emits exactly the one row it always did. Each entry
  // keeps its source's TOP uid too (D171 — the source may be Knocked Out later in
  // this same reduction, and a spot cannot name a Pokémon that has left play).
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
      // Never strip a pick whose destination IS the body it sits on — the per-pick
      // self-move rule, which under `anyDest` is the SAME rule applied per entry
      // rather than once for the whole answer (D226's generalisation, one endpoint
      // over). `validateChoice` refuses such an answer; this keeps the apply honest
      // if one ever arrives.
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
    return inbound === undefined ? pokemon : { ...pokemon, energy: [...pokemon.energy, ...inbound] };
  };
  const active = activeStripped === null ? null : addTo(activeStripped, "active");
  const bench = benchStripped.map((pokemon, index) => addTo(pokemon, `bench:${index}`));
  // One row per (SOURCE, DESTINATION) pair, in the order the board was walked
  // (Active first, then the bench left to right) — a two-source N's Plan reads as
  // the two sentences it is, and a Kilowattrel spread reads as the several it is.
  for (const group of groups) {
    events.push({
      type: "ENERGY_MOVED",
      // 🆕🆕 D443 — `seat` IS THE BOARD AND `actor` IS THE CAUSE, which is
      // `ENERGY_DISCARDED`'s shipped pair one op over and this file's stated
      // convention for "a row whose seat is the target rather than the cause". The
      // two are EQUAL on every board this event could reach before D443, so no
      // existing row moves; they differ exactly on the two opponent-board
      // sentences, and `log.ts` forks on the comparison rather than on a flag
      // (`DECK_TOP_DISCARDED`'s rule, verbatim).
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
  // 🆕 D295 — the DESTINATION, read ONCE and named BEFORE the strip loop so the
  // event rows and the zone write cannot disagree about where the cards went.
  // Absent = the discard pile this op is named after; `"hand"` is Chill Teaser
  // Toy `sv08-166`. Both zones belong to `victim` — the seat resolved one line
  // above — so this is a ZONE branch and not a seat one.
  const toHand = op.to === "hand";
  // 🆕🆕 D383 — THE THIRD ZONE, READ AS ITS OWN LOCAL RATHER THAN BY WIDENING THE
  // ONE ABOVE. Wellspring Mask Ogerpon ex `sv06-064`'s printed *"shuffle 3 Energy
  // attached to this Pokémon into your deck"* — and it is the first destination on
  // this op whose VICTIM IS THE ACTOR, which the seat line above resolves without a
  // branch (`discardVictimSeat` returns the controller for `yourActive`). The
  // SHUFFLE is not here: it is the trailing `shuffleDeck` op the reader emits
  // beside this one, so the cards are appended and the deck is randomised in the
  // open (D342's split, one op over).
  const toDeck = op.to === "deck";
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
      // D295 — omitted entirely for the pile, so every row written before this
      // slice is byte-identical and no consumer has to learn a default.
      // 🆕🆕 D383 — and the same for the deck, spelled as a second ternary rather
      // than a lookup so the ABSENT case stays the literal `{}` D295's row asserts.
      ...(toHand ? { to: "hand" as const } : toDeck ? { to: "deck" as const } : {}),
    });
  }
  return {
    state: withSide(state, victim, {
      ...side,
      active,
      bench,
      // 🆕 D295 — ONE zone or the OTHER, never both, and the un-taken zone is
      // spread through UNCHANGED rather than rebuilt: a `hand` write that also
      // appended to `discard` would duplicate the uid across two zones, which no
      // later reader could untangle (a uid is the game's identity, types.ts).
      // 🆕🆕 D383 — THREE zones now, and the invariant is unchanged: exactly one
      // key is written, so a uid can still never sit in two zones at once. The deck
      // is APPENDED to, never prepended — the position is meaningless under the
      // trailing shuffle, and the append keeps this arm the same shape as the two
      // beside it.
      ...(toHand
        ? { hand: [...side.hand, ...discarded] }
        : toDeck
          ? { deck: [...side.deck, ...discarded] }
          : { discard: [...side.discard, ...discarded] }),
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
    `yourActive` / `yours` / `yourBench` / `self`, the opponent's for the three
    hammer arms. One helper so the candidate scan and the apply can never disagree
    about whose Pokémon is stripped and whose discard pile it lands in — and, since
    D222, so the §11 attack-block guard cannot disagree with either (it used to spell
    the own-board members a second time, in a negated conjunction that a new member
    silently fell out of).

    🆕🆕 D403 — AND `yourBench` IS THE MEMBER D222's WARNING WAS WRITTEN FOR, ARRIVING
    FOUR SLICE-HUNDREDS LATER. It is an OWN-board scope whose name does not begin
    "your…Active", so the conjunction that helper replaced would have sent an
    attacker's own Bench discard through the OPPONENT's §11 block — the exact failure
    mode recorded at D222, on the exact union. One helper, one answer, one line
    changed. */
function discardVictimSeat(seat: Seat, op: Extract<EffectOp, { op: "discardEnergy" }>): Seat {
  return op.from === "yourActive" ||
    op.from === "yours" ||
    op.from === "yourBench" ||
    op.from === "self"
    ? seat
    : otherSeat(seat);
}

/** The Energy a `discardEnergy` op may take, in board order — the two `…Active`
    arms see only that Active, `self` sees the ONE body the program is printed on
    (D222), and the rest the whole victim board. Exported for programPlayable: a
    top-level discard with nothing to take can only whiff (the gust / moveEnergy
    precedent).

    ⚠️ `sourceUid` IS A PARAMETER RATHER THAN A CONTEXT because both callers must
    answer the same question at DIFFERENT times: the interpreter has an
    `EffectContext` and hands over `ctx.sourceUid`; `programPlayable` is asked
    before any program exists and hands over the uid the action names. An absent
    uid is not an error — a Trainer program authored with `self` has no "this
    Pokémon", and it whiffs (and is refused by the gate) rather than silently
    stripping the Active. */
export function discardableEnergies(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "discardEnergy" }>,
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
    const host = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
    if (host === undefined || host === null) return [];
    return host.energy
      .filter((uid) => matchesAttached(state, host, uid, op.filter))
      .map((uid) => ({ uid, from: ref }));
  }
  // 🆕🆕 D403 — THREE SCOPES WHERE THERE WERE TWO, and the third costs nothing:
  // `attachedEnergies` has taken a `"bench"` argument since it was written and no
  // producer had ever asked for it. The printed *"from your Benched Pokémon"* is the
  // own side MINUS the Active — a COMPLEMENT rather than a spot or a side — and
  // reading it as `"all"` would offer the very Energy that paid for the attack.
  const activeOnly = op.from === "opponentActive" || op.from === "yourActive";
  const benchOnly = op.from === "yourBench";
  return attachedEnergies(
    state,
    discardVictimSeat(seat, op),
    op.filter,
    activeOnly ? "active" : benchOnly ? "bench" : "all",
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

/** How many Energy a `moveEnergy` op may actually move on THIS board — the
    printed number, or the whole movable set for the printed "any amount"
    (D244, Iron Leaves ex).

    ⚠️ ONE HELPER WITH TWO READERS, which is `moveEndpoints`' own reason: the
    `programPlayable` gate and the park must agree about `max`, or "any amount"
    with nothing movable becomes a card that is offered and then does nothing.
    `attachFromTop` already spells `max: "any"` as `Math.min(candidates.length, …)`
    inline; it is a FUNCTION here because two callers ask, and because the clamp is
    what keeps the PROMPT's `max` a number — no wire shape moves for this. */
function moveCap(op: Extract<EffectOp, { op: "moveEnergy" }>, movable: number): number {
  // 🆕 D441 — `"all"` clamps to the SAME number as `"any"`; the two differ only in
  // the FLOOR, which is `moveFloor`'s question and not this one. Spelled as a
  // membership test over the two literal words rather than as
  // `typeof op.max === "number"`, so a fourth quantifier cannot fall silently onto
  // the numeric side (D222's closed-world hazard, reaching a value union).
  return op.max === "any" || op.max === "all" ? movable : op.max;
}

/** How FEW Energy a `moveEnergy` answer may carry — 0 for every printing this
    family has had since M4, and the whole clamp for Castform's printed *"Move
    **all** Energy"* (D441). `cap` is `moveCap`'s answer, so "all" means "the
    ceiling is also the floor" and the two can never disagree about the number.

    ⚠️ A SECOND FUNCTION RATHER THAN A SECOND RETURN OUT OF `moveCap`, and for
    `moveCap`'s own stated reason read backwards: TWO callers ask the ceiling (the
    park and the `programPlayable` gate) and only ONE asks the floor. The gate
    deliberately does not — a play refused because its floor could not be met
    would be a rule no card prints, and "all" of nothing is already a no-op
    through `movable.length === 0` one line above the call. */
function moveFloor(op: Extract<EffectOp, { op: "moveEnergy" }>, cap: number): number {
  return op.max === "all" ? cap : 0;
}

/** 🆕🆕 **D443 — WHOSE BOARD A `moveEnergy` OP ACTS ON**: the controller's own for
    every printing this family had before this slice, the OTHER seat's for the two
    that name it (`side: "opponent"`).

    ⚠️ **THE SHAPE IS NOT INVENTED — `reorderTopOwner` (D341, ~490 lines down) IS
    THE SAME HELPER FOR THE SAME OPTIONAL `side?: "opponent"` RIDER**, and its doc
    states this one's reason before the fact: *"the park and the apply must not each
    decide it … a resolve that read `ctx.seat` while the park read the opponent
    would reorder the wrong deck with the right uids."* Read `moveEnergy` for
    `reorderTop` and it is this slice's defect exactly. `discardVictimSeat` is the
    third instance of the pattern, on a REQUIRED seat field.

    ⚠️ **ONE HELPER WITH THREE READERS, WHICH IS `discardVictimSeat`'s JOB ONE OP
    OVER AND `moveCap`'s ARGUMENT ON A DIFFERENT AXIS.** The park, the
    `programPlayable` gate and the APPLY all have to agree about which side of the
    table this is, and D222's rule is the whole reason it is a function: the moment
    a second member joins `side`, a hand-spelled `op.side === "opponent"` at one of
    the three read sites is a closed-world test with no compiler behind it. It is
    also what keeps `moveEndpoints` free of the question — that helper answers
    "endpoints on THIS board", and its `seat` parameter is now the BOARD rather than
    the controller, which is the only thing its body has ever actually used.

    ⚠️ **CONTROLLER-RELATIVE, LIKE EVERY OTHER SEAT FIELD IN THIS VOCABULARY**
    (`reorderTop.side`, `returnBenched.whose`, `handRefresh.who`,
    `discardEnergy.from`): a program is authored against "you"/"your opponent" and
    never against `p1`/`p2`, so the same object is correct for either seat. */
function moveBoardSeat(op: Extract<EffectOp, { op: "moveEnergy" }>, seat: Seat): Seat {
  // ⚠️ SPELLED OFF THE **ABSENT** KEY RATHER THAN OFF THE PRESENT ONE, AND FOR TWO
  // REASONS. (1) It is the sentence `MATCH_RECORD_VERSION` turns on: a v29 record
  // carries no `side` at all, and this line is where "absent means the controller's
  // own board" is asserted rather than assumed. (2) `reorderTopOwner`'s body, ~490
  // lines down, is `op.side === "opponent" ? otherSeat(seat) : seat;` — writing that
  // BYTE-IDENTICALLY here made `D341-reorder-owner-ignores-the-side-field` match 2×
  // (D437's converse trap, caught by `precheck` in seconds), so the copy is spelled
  // differently ON PURPOSE and this comment is why nobody should "tidy" it back.
  return op.side === undefined ? seat : otherSeat(seat);
}

/** A moveEnergy op does something iff the controller has ≥1 Energy the filter
    admits AND ≥2 of their own Pokémon in play (a source WITH a distinct
    destination). Exported for programPlayable: a play that could only whiff can't
    be made (the gust / attachEnergyFrom precedent).

    ⚠️ D244 — `sourceUid` IS THREADED FOR THE SAME REASON `discardEnergyPlayable`
    TAKES ONE (D222): two of the four routes resolve their endpoints from "this
    Pokémon" (`koedActiveToToolHolder`'s destination, `othersToSelf`'s BOTH ends),
    and a gate that could not see the uid would answer about a different board
    than the op then runs on. An absent uid is not an error — it leaves those two
    routes with no destination, so the gate refuses, which is the same safe
    default the discard gate takes. */
export function moveEnergyPlayable(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "moveEnergy" }>,
  sourceUid?: string,
): boolean {
  // 🆕 D443 — THE BOARD, NOT THE CONTROLLER. The gate must refuse on exactly the
  // set the park would offer, and for an opponent-board op that set is on the other
  // side of the table (`switchActiveTargets`' one-funnel rule, reached through the
  // seat instead of through the filter). ⚠️ IT DELIBERATELY DOES NOT ASK THE §11
  // SHIELD: `unshieldedRefs` needs `ctx`/`events` to ANNOUNCE its refusals and a
  // playability question has neither and must not emit — `gustTargets`' and
  // `knockOutChosenTargets`' stated reason, verbatim. So the gate can say "playable"
  // on a board where every candidate is shielded, exactly as the gust gate can.
  const board = moveBoardSeat(op, seat);
  const { movable, destinations, needed } = moveEndpoints(state, board, op, sourceUid);
  return moveCap(op, movable.length) > 0 && movable.length > 0 && destinations.length >= needed;
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
    correct, since the route is only ever reachable from a Tool's on-KO trigger.

    `selfToBench` (D229, 13 legal ATTACK printings) is `benchToActive` READ
    BACKWARDS: sources are the attacker, destinations are that seat's whole Bench.
    ONE destination is enough for `benchToActive`'s reason mirrored — source and
    destination are disjoint by construction, here because the Active is not on the
    Bench — and an EMPTY Bench makes `destinations` empty and the route a no-op,
    which is a reachable board (unlike the vacant Active two paragraphs up) and is
    driven rather than asserted.

    ⚠️ ITS SOURCE IS THE **ACTIVE** AND NOT `sourceRef`, WHICH IS A CLAIM ABOUT
    THE PRINTINGS. All 13 are attack text and §8 lets only the Active attack, so
    the two answers coincide on every board this route can reach; resolving the
    printed "this Pokémon" through `ctx.sourceUid` would add a distinction no test
    could ever kill. Stated in the op's own doc too, with the condition that would
    change it (a benched body's Ability printing the sentence).

    🆕🆕 **D443 — `seat` IS THE BOARD, NOT THE CONTROLLER, AND THAT IS A RENAME OF
    THE CONTRACT RATHER THAN A CHANGE TO ONE LINE OF THE BODY.** Every route below
    already reads its endpoints off whatever seat it is handed — `attachedEnergies`,
    `ownInPlayRefs` and the bench map are all pure functions of it — so the widening
    is entirely at the two CALL SITES, which now pass `moveBoardSeat(op, ctx.seat)`.
    Nothing here branches on `side`, and that is deliberate on two counts: the
    endpoint rules are identical on either board (a Pokémon still may not move Energy
    onto itself; the free route still needs two bodies; `selfToBench` still runs
    Active → Bench), and keeping the branch out of this function is what lets the
    `programPlayable` gate and the park share one answer about a question that now
    has two possible boards.

    ⚠️ **THE TWO UID-ANCHORED ROUTES THEREFORE WHIFF ON THE OTHER BOARD, AND THAT IS
    THE SAFE DIRECTION.** `koedActiveToToolHolder` looks for `sourceUid` among
    `seat`'s Tools and `othersToSelf` resolves `sourceRef` on `seat` — the card
    running the program is always on the CONTROLLER's board, so on the opponent's it
    is not found, `destinations` is empty and the op is a no-op. The alternative —
    anchoring those ends on the controller while the other end crosses — would build
    a move from one board onto the other, which no printing spells and which the
    apply's own `dest.seat !== board` guard would then have to admit. No printed card
    combines `side` with either route; the whiff is recorded rather than blocked,
    exactly as this op's other representable-but-unprinted combinations are.

    ⚠️ **AND THE §11 SHIELD IS NOT ASKED HERE.** It is a FILTER at the `stepOp` arm
    (D259's placement rule), outside this funnel, because `unshieldedRefs` announces
    its refusals and needs `ctx`/`events` — which the `programPlayable` reader has
    neither of and must not emit. `gustTargets` states the identical division. */
function moveEndpoints(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "moveEnergy" }>,
  sourceUid?: string,
): { movable: { uid: string; from: PokemonRef }[]; destinations: PokemonRef[]; needed: number } {
  const benchToActive = op.route === "benchToActive";
  const toToolHolder = op.route === "koedActiveToToolHolder";
  const selfToBench = op.route === "selfToBench";
  const active = state.players[seat].active;
  if (op.route === "othersToSelf") {
    // D244 — the printed "from your OTHER Pokémon to THIS Pokémon", resolved
    // through the uid off the CURRENT board.
    //
    // 🛑 A FLAGGED EQUIVALENCE, AND IT IS THE OP DOC'S, REPEATED HERE BECAUSE
    // THIS IS WHERE A READER WOULD DELETE IT: on all six PRINTED boards these
    // endpoints equal `benchToActive`'s, because the tail runs behind a
    // `recordGate` on the switch and the source is therefore always the Active by
    // the time it does. The separating board is CONSTRUCTED — a bare
    // `othersToSelf` used from the Bench (`fix-othersmove`) — and the other
    // reading is installed as a mutant, so this arm is pinned rather than assumed.
    // The condition that makes it matter for a real card is a printing of this
    // tail with no switch in front of it.
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
    `…Active` arms, that Active; or, for `self`, the one body the program is
    printed on) holds ≥1 Energy the filter admits. Exported for programPlayable —
    a play that could only whiff can't be made, so Giacomo into a board with no
    Special Energy is rejected rather than burning the turn's one Supporter
    (§7.2). Crushing Hammer is covered too: programPlayable descends into a
    `coinFlipGate`'s branches (both of them since D269's `otherwise`, and a
    two-armed gate is refused only when NEITHER arm can do anything), since the
    flip is procedure rather than effect (see cardplay.ts).

    ⚠️ D222 — `sourceUid` IS WHAT MAKES THIS GATE A COST GATE. For every other
    arm the question is about a ZONE and the answer is the same whoever asks;
    for `self` the honest question is "does THIS body hold a matching Energy",
    which this predicate could not ask before. Iono's Kilowattrel's printed
    "You must discard … in order to use this Ability" is refused HERE, exactly
    as Trade's hand cost is refused by `handCostUnmet` — an Ability whose cost
    cannot be paid must not run and then hand out the effect for free. Omitting
    the uid does NOT fall back to the Active: it answers `false`, which is the
    only safe default for a cost. */
export function discardEnergyPlayable(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "discardEnergy" }>,
  sourceUid?: string,
): boolean {
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

/** 🆕 D345 — THE ONE FUNNEL FOR A SNIPE'S CANDIDATE SET, exported for the same
    reason `gustTargets` is: `programPlayable` (cardplay.ts) must refuse on
    EXACTLY the set `stepOp` would offer, or the grey-out and the offer disagree.

    🛑 **AND THEY DID DISAGREE.** `programPlayable`'s arm read
    `players[opponent].bench.length === 0` for EVERY `damageChosen`, which is the
    `opponentBench` reading and only that one. It was accidentally right for four
    slices' worth of rows because every registry producer was a Bench snipe
    (Hawlucha, Meowscarada ex, Radiant Blastoise) and every `opponentAny` producer
    was an ATTACK — and attacks never consult `programPlayable` (§8). The first
    registry `opponentAny` row (D345's "Cursed Blast") is the board where an
    opponent with a bare Active greyed out an Ability whose own op offers that
    Active as a candidate. **A GATE THAT RE-IMPLEMENTS ITS OP'S PREDICATE IS RIGHT
    UNTIL THE OP GROWS AN ARM**, which is the argument the `gust` line beside it
    already makes in words.

    🆕🆕 **D437 — AND THE PRINTED PER-BODY NARROWING GOES HERE, WHICH IS THE WHOLE
    OF THAT SLICE'S PLACEMENT DECISION.** *"…to 1 of your opponent's Benched Pokémon
    **that has any damage counters on it**."* — `op.damagedOnly`. Three things follow
    from narrowing at the funnel rather than at the op, and each is a case a careless
    build gets wrong:

      • **A FILTERED SET CAN BE EMPTY WHERE THE UNFILTERED ONE WAS NOT.** An opponent
        with three UNDAMAGED benched bodies offers three candidates unfiltered and
        ZERO filtered, and the op's own `candidates.length === 0` arm turns that into
        the silent no-op every snipe already takes on an empty Bench — no prompt, no
        event, and NOT an `ATTACK_EFFECT_SKIPPED`, because the sentence was read.
      • **A FILTERED SET OF EXACTLY ONE IS FORCED**, where the unfiltered board would
        have parked. `stepOp`'s `!declinable && candidates.length <= op.count` arm is
        the M1 no-choice rule, and it must read the NARROWED count: one damaged body
        beside two undamaged ones is not a decision.
      • **THE SHIELD IS ASKED AFTER THE NARROWING, NOT BEFORE** (D433). Every §11-ish
        prevention this op consults — `benchShieldedFromDamage`, the six
        `targetPassives.prevent*` disjuncts, `attackDamageBlocked`,
        `coinFlipShieldPrevents` — lives INSIDE `placeSnipe`'s loop over the refs it
        is handed, so a body this narrowing removed is never asked about and cannot
        file a `DAMAGE_DEALT{prevented}` row for a hit that was never coming.
        Narrowing here is what makes that true; narrowing later would reproduce
        D433's false log row exactly.

    ⚠️ **AND IT IS APPLIED TO WHICHEVER SCOPE `target` NAMES**, not to the Bench by
    hand. No printing spells the narrowing against `opponentAny` today; spelling the
    Bench twice would be the second enumeration of one noun this funnel exists to
    prevent. */
export function snipeTargets(
  state: GameState,
  seat: Seat,
  op: Extract<EffectOp, { op: "damageChosen" }>,
): PokemonRef[] {
  // 🆕🆕🆕 **D447 — A `switch` RATHER THAN THE TERNARY THAT WAS HERE, AND THE SWAP IS
  // THE POINT.** The ternary read `=== "opponentAny" ? oppAny : oppBench`, so the third
  // member added to the union this slice would have fallen SILENTLY out of its `else`
  // and aimed the own-side snipe across the table — `tsc` reported nothing, and the
  // suite would have been green on a wrong board. That is D222's rule and D425's line
  // in `spreadDamage` verbatim: a total `switch` stops compiling instead.
  const scope = ((): PokemonRef[] => {
    switch (op.target) {
      case "opponentAny":
        return oppAnyRefs(state, seat);
      case "opponentBench":
        return oppBenchRefs(state, seat);
      // 🛑 THE ATTACKER'S OWN BENCH, and `seat` is the ATTACKER's on every attack
      // program (attack.ts sets `ctx.seat`), so this is the same board the pick is
      // offered to. `ownBenchRefs` is the helper `moveCountersToDefender` and the
      // switch-out family already share — one reading of "your Bench", not a fourth.
      case "yourBench":
        return ownBenchRefs(state, seat);
    }
  })();
  // 🆕🆕🆕 **D483 — THE PRINTED CANDIDATE CLASS, AT THE SAME SEAM AND FOR THE SAME THREE
  // REASONS THE BLOCK ABOVE GIVES FOR `damagedOnly`** (an empty filtered set is the
  // silent no-op, a filtered set of one is FORCED, and the §11 shield is asked AFTER the
  // narrowing because every prevention lives inside `placeSnipe`'s loop). It is a CARD
  // fact rather than a board fact — `matchesFilter` is handed the TOP CARD — which is
  // the one axis on which it differs from its neighbour, and the reason it is a
  // `CardFilter` rather than a rider.
  //
  // ⚠️ **THE TWO NARROWINGS ARE NEVER CO-PRINTED AND THE DERIVER REFUSES THE PAIR**, so
  // the composition below is a reading rather than a claim about the catalog. It is
  // written as a composition anyway, for `snipeTargets`' own stated rule: a funnel that
  // applied one narrowing and skipped the other on some `target` would be a second
  // opinion about which bodies a sentence names.
  const narrowing = op.filter;
  const classed =
    narrowing === undefined
      ? scope
      : scope.filter((ref) => {
          const pokemon = refPokemon(state, ref);
          // Same conservative direction as the window below and as `matchesFilter`'s own:
          // a ref that resolves to no body, or to a body whose top card cannot be read,
          // is DROPPED rather than admitted.
          return pokemon !== undefined && matchesFilter(topCardOf(state, pokemon), narrowing);
        });
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
function searchNote(
  groups: readonly { filter: CardFilter; max: number }[],
  dest: "bench" | "hand" | "deckTop",
  max: number,
  /** 🆕 D342 — the op's `exact`. The heading has to say WHICH pick it is, because
      the dialog's Confirm is disabled until the floor is met and a caption that
      still read "up to 2" over a button that refuses 1 is the dialog
      contradicting itself in its own words — `retrieveNote`'s recorded failure,
      one caption over. Absent on every producer before this row, where the note
      is the byte-identical "up to" it always was. */
  exact = false,
  /** 🆕🆕🆕 D513 — the op's `distinctEnergyTypes`. The caption has to carry the
      printed *"of different types"* for D342's recorded reason one parameter up: a
      heading reading *"up to 3 Basic Energy cards"* over a dialog that rejects a
      second Fire is the dialog contradicting itself in its own words, and the
      player has no other way to learn why the pick was refused. Absent on every
      producer before this row, where the caption is the byte-identical one it
      always was. */
  distinctEnergyTypes = false,
): string {
  const where =
    dest === "bench"
      ? "onto your Bench"
      : // 🆕 D342 — the print's own words: *"put those cards **on top of it**"*,
        // where "it" is the deck the search just came out of. Spelled "your
        // deck" rather than "it" because a heading has no antecedent to bind a
        // pronoun to (D116's rule about dropped pronouns, applied forwards).
        dest === "deckTop"
        ? "on top of your deck"
        : "into your hand";
  // 🆕 D336 — THE SINGLE-GROUP ARM IS THE OLD FUNCTION, BYTE FOR BYTE, and it
  // reads the CLAMPED `max` rather than the group's own: a bench search whose
  // printed 3 is cut to 2 by `benchSpace` must caption the 2 the dialog will
  // actually accept, which is the rule `attachFromDeckNote` states about a
  // caption naming a wider set than its own validator. That is why the clamp is
  // still a parameter and not re-derived here.
  const first = groups[0];
  if (first === undefined) return `Search your deck ${where}.`;
  if (groups.length === 1) {
    const { singular, plural } = retrieveNoun(first.filter);
    // 🆕🆕🆕 D513 — THE PRINTED PHRASE RIDES THE PLURAL NOUN AND ONLY THE PLURAL
    // NOUN. "a Basic Energy card of different types" is not English, and it is not
    // a caption this dialog could ever be honest about either: a pairwise relation
    // over a ONE-card answer is VACUOUSLY true, so a singular take is genuinely
    // unconstrained and must not claim otherwise. The `max > 1` branches below are
    // the only ones the rider can reach, which is asserted rather than assumed.
    const many = distinctEnergyTypes ? `${plural} of different types` : plural;
    // 🆕 D342 — an EXACT take drops the "up to" and keeps the number, which is
    // the printed sentence ("Search your deck for 2 cards") and also the only
    // caption the Confirm button below it can be true about.
    if (exact)
      return max > 1
        ? `Search your deck for ${max} ${many} ${where}.`
        : `Search your deck for ${singular} ${where}.`;
    return max > 1
      ? `Search your deck for up to ${max} ${many} ${where}.`
      : `Search your deck for ${singular} ${where}.`;
  }
  // 🆕 D336 — THE PRINTED CONJUNCTION, AND IT IS A SERIAL LIST RATHER THAN
  // `lookNote`'s PAIR. That function joins with a bare " and " because Drayton
  // spells exactly two nouns; Larry's Skill spells three and Secret Box four, and
  // "a Pokémon and a Supporter card and a Basic Energy card" is not the sentence
  // on either card. The Oxford comma is the PRINT's — both cards carry it ("a
  // Supporter card, **and** a Basic Energy card") — so it is reproduced rather
  // than chosen, and the two-noun fallback below is the same join with no commas,
  // which is what a legal Arven printing would want the day one exists.
  //
  // ⚠️ EACH GROUP KEEPS ITS OWN NUMBER, `lookNote`'s rule one op over: the caps
  // are independent, so a `max: 2` beside a `max: 1` would read "up to 2 Item
  // cards, a Supporter card, and a Stadium card" — which no printing spells today
  // and which this join gets right anyway. The flat `max` is deliberately NOT
  // used: it is the SUM, and captioning "up to 3 Pokémon" over three different
  // nouns is the mis-caption this arm exists to prevent.
  const phrase = (g: { filter: CardFilter; max: number }) => {
    const { singular, plural } = retrieveNoun(g.filter);
    return g.max > 1 ? `up to ${g.max} ${plural}` : singular;
  };
  const parts = groups.map(phrase);
  const last = parts[parts.length - 1] ?? "";
  const head = parts.slice(0, -1);
  const what = head.length === 1 ? `${head[0]} and ${last}` : `${head.join(", ")}, and ${last}`;
  return `Search your deck for ${what} ${where}.`;
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
  dest: "hand" | "deck" | "bench",
  max: number,
  excluded: boolean,
): string {
  const { singular, plural } = retrieveNoun(filter);
  // D237 — the BENCH destination reads with the same printed verb as the hand
  // ("Put …"), which is why the verb is decided by the deck destination alone:
  // "Shuffle" is the deck printing's own word (Pal Pad / Super Rod), and the
  // other two are both "Put".
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

/** The chooseCards note for a lookAtTopN (Great Ball / Pokégear 3.0) —
    reproduces the printed "Look at the top N cards … and put a {noun} into your
    hand." Both cards in scope take at most 1 (the singular), but the plural stays
    total for a future look-at-top that takes several. Reuses retrieveNoun for the
    filter's noun phrase (anyPokemon → "a Pokémon"; supporter → "a Supporter card").

    🆕 **D332 — `also` JOINS THE TWO NOUN PHRASES WITH THE PRINTED "and", AND THAT
    IS WHY IT IS NOT `anyOf`.** The `CardFilter` union already carries a
    combinator that would produce this candidate set for free, and its caption is
    the reason it cannot be used here: `retrieveNoun`'s `anyOf` arm joins with
    **" or "** — deliberately, it says so — because a union predicate asked about
    ONE card reads as a disjunction. Drayton is the case that arm's own note
    describes as the thing it is avoiding: two nouns, both taken, a real printed
    conjunction. `anyOf` is also documented there as unreachable from any prompt,
    so routing this through it would have made a green-and-dead member's first
    live caption say the opposite of the card (D330's finding, one arm over).
    Each half keeps its own number: the two caps are independent, so a `max: 1`
    beside a `max: 2` would read "a Pokémon and up to 2 Trainer cards", which no
    printing spells today and which this join gets right anyway.

    🆕 **D334 — `exact` DROPS THE "up to" AND NOTHING ELSE**, because the printed
    difference between *"put **up to 3** of them into your hand"* (Hassel) and
    *"put **2** of them into your hand"* (Explorer's Guidance) is exactly those two
    words. It is spelled here for the reason D333's `"any"` arm is spelled here:
    this function is the second consumer of the same number, and a field that feeds
    both a predicate and a string owes both arms — telling a player "up to 2 cards"
    over a sentence that gives them no choice about the 2 is the engine authoring
    text the card does not have. The SINGULAR is untouched: "put a card into your
    hand" already reads as exactly one either way, and what tells the dialog the
    pick is not declinable is `prompt.min`, never the caption (see the type's doc). */
/** 🆕 D341 — WHOSE DECK a `reorderTop` is ordering. One line, exported to nobody,
    and it exists because the park and the apply must not each decide it: they run
    in different reductions, and a resolve that read `ctx.seat` while the park read
    the opponent would reorder the wrong deck with the right uids. `attackEpilogue.
    uid`'s rule ("never hold a second opinion") applied to a derivation instead of
    to a stored value — the cheapest form of it, since the answer is a pure
    function of two things both reductions already hold. */
function reorderTopOwner(seat: Seat, op: Extract<EffectOp, { op: "reorderTop" }>): Seat {
  return op.side === "opponent" ? otherSeat(seat) : seat;
}

/** 🆕 D343 — WHICH CARDS a `reorderTop` is ordering, spelled once for
    `reorderTopOwner`'s reason exactly: the park offers this window and the apply
    must splice back over the same one, and two reductions each doing their own
    arithmetic is how they come to disagree.

    **BOTH ARMS RETURN THE WINDOW IN DECK ORDER**, so index 0 is always the card
    nearer the TOP — even on the bottom fork, where the last element is the very
    bottom of the deck. That is what lets ONE `orderCards` prompt, one validator
    and one dialog serve both ends: the answer means "this sequence, read from the
    top down", and only the splice knows where it lands.

    ⚠️ **THE OUTER CLAMP ON THE BOTTOM ARM IS DOCUMENTATION, NOT BEHAVIOUR, AND
    THAT WAS MEASURED RATHER THAN ASSUMED.** The obvious story — "a deck shorter
    than `op.n` makes `deck.length - n` negative, and a negative `slice` start
    counts from the END" — is the story D343 wrote first and then killed with a
    mutant (`D343-reorder-window-bottom-is-off-by-the-window`, a DECLARED
    EQUIVALENT). ECMA-262 clamps a `slice` start below `-length` to 0, so
    `deck.slice(-5)` and `deck.slice(Math.max(0, deck.length - 5))` are the same
    expression on a short deck and identical on a long one. **NO BOARD SEPARATES
    THEM**, so no suite can kill it and none should be written trying. It stays
    because it makes the two arms read as mirror images — both floored at 0 —
    which is worth one token; it is not a guard against anything. The top arm's
    `Math.max(0, op.n)` is the same kind of statement about a negative `n`. */
function reorderWindow(
  deck: readonly string[],
  op: Extract<EffectOp, { op: "reorderTop" }>,
): string[] {
  return op.from === "bottom"
    ? deck.slice(Math.max(0, deck.length - Math.max(0, op.n)))
    : deck.slice(0, Math.max(0, op.n));
}

/** 🆕 D341 — the `orderCards` caption. Speaks to the ANSWERER, like every note in
    this file, and names WHOSE deck because on three of the four printings it is
    not theirs — the one fact a player looking at four face-down backs cannot get
    from the dialog itself.

    ⚠️ THE PRINTED NUMBER IS **NOT** SPELLED, and that is `lookNote`'s own lesson
    (D333/D334) pointed the other way. `op.n` is the printed WINDOW, and the cards
    actually on offer are `min(n, deck.length)` — so a caption reading "the top 5"
    over a 2-card deck would print a number contradicted by the dialog beside it.
    Every other caption in this file names a number the player is choosing ABOUT;
    here the count is not a decision at all (see the prompt's doc: no `min`, no
    `max`), so there is nothing for a number to be a claim about.

    🆕 **D343 — THE BOTTOM FORK GETS ITS OWN SENTENCE, AND THE VERB CHANGES WITH
    IT.** The top arms say *"Put these cards **back**"* because the print does:
    the player looked at cards that were already there and is returning them. Kofu
    never looked at anything — the two cards came out of the controller's own hand
    a moment ago — so *"back"* would assert a return that did not happen, and the
    caption says *"on the bottom of your deck"* with the printed verb instead. The
    same distinction `exact` drew for `lookNote`: a caption is a claim, and the
    one word that is wrong is the whole cost.

    ⚠️ **THERE IS NO OPPONENT × BOTTOM ARM AND ITS ABSENCE IS DELIBERATE (D135).**
    No printed sentence orders the bottom of a deck its player does not own, so a
    fourth string would be a caption no board can reach. `side` is checked first,
    which means an author who paired the two forks would get the opponent's
    top-deck sentence over a bottom-deck window — wrong, and unreachable, and
    cheaper to leave stated here than to guard with a branch nothing takes. */
function reorderNote(op: Extract<EffectOp, { op: "reorderTop" }>): string {
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
): string {
  const { singular, plural } = retrieveNoun(filter);
  // D241 — the destination is the prompt's, not a fixed phrase. A dialog that
  // said "into your hand" over rows the answer BENCHES is the caption
  // contradicting its own validator, which is the rule `attachFromDeckNote`
  // already states one prompt over.
  const where =
    dest === "bench"
      ? "onto your Bench"
      : dest === "discard"
        ? "in the discard pile"
        : "into your hand";
  // 🆕 D333 — THE PRINTED WORDS, NOT THE RESOLVED CLAMP. `"any"` reads as the
  // card's own "any number of" (Roto-Stick `sv08.5-127`, and D241's two derived
  // bench sentences now that their arm is re-pointed), never as the number the
  // park happened to resolve it to: D244 made exactly this call for
  // `moveEnergy`'s "any amount of", and `attachNote` spells this very string one
  // function up. Telling a player "up to 4 Supporter cards" over a sentence that
  // prints no number is the engine authoring text the card does not have.
  // 🆕 D334 — the exactness is a PER-GROUP argument and not the closure's, because
  // `exact` is the FIRST group's printed sentence: `also.max` is its own printed
  // cap and no card pairs the two (the park says so where the floor is set), so a
  // shared flag would silently re-caption a second noun the day one does.
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
  return `Look at the top ${n} cards of your deck and put ${what} ${where}.`;
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
  const zone = riders.benchOnly === true ? "Benched " : "";
  const owner = ownerNoun(riders.ownerPokemon);
  const types = targetTypeNames(riders.targetType);
  // 🆕🆕 D354 — NO TYPE: the bare noun, byte-identical to the pre-D354 spelling.
  if (types.length === 0) return `${zone}${owner}Pokémon`;
  // 🆕🆕 D354 — the union REPEATS THE NOUN, because the card does: X-Boot prints
  // *"your {P} Pokémon **and** {M} Pokémon"*, not "your {P} {M} Pokémon". One
  // type is the one-element case of exactly that join and comes out byte-
  // identical to the pre-D354 caption for every printing that exists, which is
  // what makes this widening invisible to all eight of them.
  return types.map((type) => `${zone}${type} ${owner}Pokémon`).join(" and ");
}

/** 🆕🆕 D354 — the TYPES an attach's target rider names, always as a list: absent
    → none, a bare `string` → that one, a list → itself. The ONE place
    `AttachTargetRiders.targetType`'s two spellings become one shape, read by both
    consumers that care — the eligibility gate in `attachEnergyTargets` and the
    caption in `attachTargetNoun`.

    Factored out for the reason `attachEnergyTargets` itself was: those two must
    never disagree. A caption naming a WIDER set than the gate offers is a dialog
    contradicting its own validator; a caption naming a NARROWER one tells the
    player a legal body is illegal. Both are the drift a second copy of "which
    types does this rider mean" would invite, and there are exactly two readers,
    which is exactly how many it takes. */
function targetTypeNames(targetType: string | readonly string[] | undefined): readonly string[] {
  if (targetType === undefined) return [];
  return typeof targetType === "string" ? [targetType] : targetType;
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
  return refs.filter((ref) =>
    matchesFilter(refTopCard(state, ref), { kind: "ownerPokemon", owner }),
  );
}

/** D273 — the top card of the body a ref points at, or undefined when the spot is
    empty. Extracted from `subgroupRefs`, whose four lines of spot-walking are now
    asked by TWO narrowings rather than one; `matchesFilter` answers false for an
    undefined card, so an empty spot falls out of every predicate for free. */
function refTopCard(state: GameState, ref: PokemonRef): Card | undefined {
  const body = refPokemon(state, ref);
  return body === undefined ? undefined : topCardOf(state, body);
}

/** 🆕 D349 — `refTopCard`'s first half, split out because a candidate scan can
    now need the BODY rather than its top card: `gustTargets`' remaining-HP window
    reads `damage` and `effectiveMaxHp`, neither of which is on a `Card`. The
    `null` collapse is the one thing worth stating — an empty Active spot is
    `null` and an out-of-range bench index is `undefined`, and both mean the same
    thing to every caller, so they are folded into one absent value here rather
    than at each call site. */
function refPokemon(state: GameState, ref: PokemonRef): InPlayPokemon | undefined {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return body === undefined || body === null ? undefined : body;
}

/** 🆕 D273 — the two printed narrowings Pecharunt ex's *"1 of your Benched **{D}**
    Pokémon, **except any Pecharunt ex**"* adds to a `switchActive` candidate set.

    ⚠️ **THE TYPE HALF IS `matchesFilter`'s `typedPokemon` AND NOT A FRESH
    COMPARISON**, which is the whole reason the rider is a `PokemonType`: the
    catalog column is an ARRAY and dual-type Pokémon are printed, so a `{D}` noun
    must admit a `["Darkness","Fire"]` body. That membership rule is stated once,
    in `cards.ts`, and every brace-coded noun in the engine asks it there.

    ⚠️ **THE NAME HALF IS EXACT-CASE AND IS CHECKED AGAINST THE TOP CARD**, the
    same field and the same body `ownerPokemon`'s prefix test reads — so an
    evolved stack is judged by what it IS now, not by what it was played as.

    ⚠️ **BOTH ARE CONJUNCTS AND THE EXCLUSION IS APPLIED EVEN WITH NO TYPE**: the
    printed phrase is an INTERSECTION, and a reading that dropped the exclusion
    whenever the type matched would offer the one body the card names to keep off
    the list. */
function switchBenchNarrowing(
  state: GameState,
  refs: PokemonRef[],
  op: Extract<EffectOp, { op: "switchActive" }>,
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

/** 🆕 D273 — the printed noun for a `switchActive`'s eligible BENCH targets, in
    the card's own word order: *"Benched {D} Pokémon, except any Pecharunt ex"*.

    Spelled ONCE, beside `attachTargetNoun` and for its reason: the prompt caption
    must name exactly the set `switchActiveTargets` offers, or the dialog
    contradicts its own validator. The unmarked op still reads "Benched Pokémon"
    byte for byte, which is what keeps every switch printing before this one from
    quietly changing its prompt. */
function switchTargetNoun(op: Extract<EffectOp, { op: "switchActive" }>): string {
  const type = op.targetType === undefined ? "" : `${op.targetType} `;
  const except = op.exceptNamed === undefined ? "" : `, except any ${op.exceptNamed}`;
  return `Benched ${type}${ownerNoun(op.ownerPokemon)}Pokémon${except}`;
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
  // 🆕🆕 D457 — the printed "attach them to **1 of** your Pokémon", and the same
  // rule that governs the branch above governs this one: "in any way you like"
  // would be a LIE over a prompt whose validator refuses a second body, so the
  // phrase is dropped and replaced by the card's own words. ⚠️ NO `max === 1`
  // branch, because the op omits the rider there (a single card has a single
  // destination) — an unreachable caption is removed rather than worded, D205's
  // rule and this function's own.
  if (op.oneTarget === true) {
    return `Search your deck for up to ${op.max} ${plural} and attach them to 1 of your ${where}.`;
  }
  return op.max > 1
    ? `Search your deck for up to ${op.max} ${plural} and attach them to your ${where} in any way you like.`
    : `Search your deck for ${singular} and attach it to your ${where}.`;
}

/** ⚠️⚠️ D247 — the attachCards prompt string for a HAND attach (Alolan Exeggutor
    ex "Tropical Frenzy"): the printed *"You may attach any number of {noun} from
    your hand to your Pokémon in any way you like."*

    Built from the OP, like its two siblings, and it keeps the two clauses they
    keep for the same reasons: **"from your hand"** is what tells the player the
    rows below are their own hand rather than a window on the deck (the one thing
    that distinguishes this dialog from `attachFromTop`'s at a glance), and **"in
    any way you like"** is the only cue that every card may go on ONE Pokémon —
    the misconception the dialog's shape invites (§15.E).

    ⚠️ NO "up to N" BRANCH, and its absence is the op's absent `max` rather than a
    forgotten case: the caption cannot promise a number the op does not carry, and
    an unreachable branch is removed rather than worded (D205's `count <= 1`).
    The printed "You may" is dropped for the reason Hydreigon's "Once during your
    turn, you may" is dropped one prompt over — a prompt that has appeared IS the
    offer, so restating the option is the dialog talking about itself. */
function attachFromHandNote(op: Extract<EffectOp, { op: "attachFromHand" }>): string {
  return `Attach any number of ${retrieveNoun(op.filter).plural} from your hand to your ${attachTargetNoun({})} in any way you like.`;
}

/** The moveEnergy prompt string (Energy Switch / Poppy) — the printed "Move [up
    to N] {noun} from [1 of] your Pokémon to another of your Pokémon". Only the two
    filters those cards use are spelled (Basic Energy / Energy); a future filter
    falls back to the generic "Energy". The "1 of" is `anySource`'s doing (D226):
    N's Plan's note comes out as its printed bytes exactly — "Move up to 2 Energy
    from your Benched Pokémon to your Active Pokémon." */
function moveNote(op: Extract<EffectOp, { op: "moveEnergy" }>): string {
  // 🆕🆕 D402 — DELEGATED, where this line spelled the Basic phrase itself. The
  // duplicate was the reason `energyNoun` could return a noun WIDER than the card
  // prints to its other caller (`discardNote`) without this one noticing; the
  // bytes it produces are identical on every board this note has ever captioned.
  const noun = energyNoun(op.filter);
  // D226 — "1 of" IS the single-source coupling, spelled. Every printing that
  // couples says "from 1 of your …" and N's Plan, which does not, says "from your
  // Benched Pokémon" — so the rider and the article are the same fact, and one
  // substring serves both endpoint phrases rather than each gaining a twin arm
  // (three of four such arms would be unreachable, which is a line no mutant can
  // kill). `koedActiveToToolHolder` names its source with a demonstrative and so
  // takes no article at all.
  const one = op.anySource === true ? "" : "1 of ";
  // 🆕🆕 D443 — `let`, AND THE OPPONENT-BOARD CLAUSE IS AN OVERRIDE BELOW THE CHAIN
  // RATHER THAN A FIFTH ARM INSIDE IT. Wrapping the chain in an outer ternary would
  // re-indent every line of it, and three shipped mutant rows quote those lines
  // verbatim (`D226-note-hardcodes-article`, `D229-note-names-the-free-route`,
  // `D441-note-numbers-a-sentence-that-prints-none`) — D414's lesson, avoided rather
  // than paid. It is also the honest shape: the two opponent sentences share no
  // clause with the five own-board ones. *"another of THEIR Pokémon"* is not
  // *"another of YOUR Pokémon"* with a word swapped; the possessive changes at both
  // ends, which is precisely what the anchors refuse to fold into one alternation.
  let where =
    op.route === "benchToActive"
      ? `from ${one}your Benched Pokémon to your Active Pokémon`
      : op.route === "koedActiveToToolHolder"
        ? // D171 — Exp. Share's printed second half, verbatim. The prompt is the
          // ONLY thing that names this card to the player (a Tool emits no
          // ABILITY_TRIGGERED row), so it says what the card says.
          "from that Pokémon to the Pokémon this card is attached to"
        : op.route === "selfToBench"
          ? // D229 — the printed second half of all 13, verbatim. The "1 of" sits
            // on the DESTINATION here rather than on the source, so it is spelled
            // literally instead of riding `one`: this route has ONE source by
            // construction (the attacker), which is what makes `anySource`
            // meaningless on it and its article unspoken in print.
            //
            // 🆕 D442 — and `anyDest` replaces exactly the words the print
            // replaces. Kilowattrel's sentence differs from D229's in its
            // destination clause and in nothing else, so the caption differs
            // there and nowhere else; the "1 of" that is the coupling, spelled,
            // goes when the coupling does.
            op.anyDest === true
            ? "from this Pokémon to your Benched Pokémon in any way you like"
            : "from this Pokémon to 1 of your Benched Pokémon"
          : op.route === "othersToSelf"
            ? // D244 — Iron Leaves ex's printed second half, verbatim. The article
              // rides `one` like the two free-source routes: this route is
              // `anySource` on every printing that exists, so `one` is empty and
              // the phrase reads as the card does ("from your other Pokémon").
              `from ${one}your other Pokémon to this Pokémon`
            : // 🆕 D442 — the FREE route's destination clause, in the two forms the
              // pool prints. `anyDest` is *"to your other Pokémon in any way you
              // like"* (the two "any amount" spread printings) and its absence is
              // Energy Switch's *"to another of your Pokémon"*. The SOURCE half is
              // untouched and still rides `one`, which is what makes the two riders
              // readable as the two independent clauses they are in print.
              op.anyDest === true
              ? `from ${one}your Pokémon to your other Pokémon in any way you like`
              : `from ${one}your Pokémon to another of your Pokémon`;
  // 🆕🆕 D443 — THE OTHER BOARD, IN THE TWO FORMS THE POOL PRINTS. The chain above
  // is computed and discarded on these two sentences, which is a string ternary and
  // costs nothing; what it buys is that every own-board caption's BYTES are
  // untouched by this slice. The article still rides `one` on the free route, so
  // the source half reads as the card does ("from 1 of your opponent's Pokémon");
  // `selfToBench` names its source with the SPOT, exactly as the print does, so it
  // takes no article at all — the same reason `koedActiveToToolHolder` takes none.
  //
  // ⚠️ THE PRINTED "You may" IS DROPPED, WHICH IS THIS FUNCTION'S STANDING RULE
  // (`attachFromHandNote`'s: a prompt that has appeared IS the offer, so restating
  // the option is the dialog talking about itself) AND NOT A CLAIM THAT THE FLOOR
  // HONOURS IT. `moveFloor` answers 0 for both of these ops; the family's
  // declinability gap is recorded at the deriver arms.
  if (op.side === "opponent") {
    where =
      op.route === "selfToBench"
        ? "from your opponent's Active Pokémon to 1 of their Benched Pokémon"
        : `from ${one}your opponent's Pokémon to another of their Pokémon`;
  }
  // 🆕🆕 D502 — THE RECORD-PINNED DESTINATION, AS A SECOND OVERRIDE BELOW THE CHAIN
  // FOR D443's REASON EXACTLY: wrapping the chain would re-indent lines that three
  // shipped mutant rows quote verbatim, so this is D414's lesson avoided rather than
  // paid, and every own-board caption's BYTES are untouched.
  //
  // 🛑 IT IS OWED BECAUSE THE INHERITED CAPTION WOULD BE FALSE ABOUT THE BOARD, NOT
  // MERELY STILTED (D421/D456). Under `selfToBench` the chain answers *"from this
  // Pokémon to 1 of your Benched Pokémon"* — which, on an attacker whose Bench holds
  // three other bodies, promises a choice the dialog does not offer: the park carries
  // exactly ONE destination, the one the search just benched.
  //
  // ⚠️ AND IT WINS OVER THE `side` OVERRIDE ABOVE, WHICH IS UNREACHABLE RATHER THAN
  // CONTESTED: the record is filed by the controller's own ops, so under
  // `side: "opponent"` the narrowing empties `destinations`, the op is a silent no-op
  // and no park is ever built for this caption to head.
  if (op.destRecorded !== undefined) where = "from this Pokémon to the new Benched Pokémon";
  // "an Energy", "a Basic Energy", "a Fire Energy" — the article follows the noun,
  // the same rule discardNote applies. Unreachable at max 1 today (the only
  // `anyEnergy` mover is Poppy at max 2, which takes the "up to" branch), which is
  // precisely why it read "Move a Energy" unnoticed.
  const article = noun === "Energy" ? "an" : "a";
  // D244 — "any amount" is the PRINTED words and is spelled rather than resolved
  // to the clamp: the note is authored from the card, and telling the player
  // "Move up to 3 Energy" on a board that happens to hold three would put a
  // number in front of a sentence that prints none.
  if (op.max === "any") return `Move any amount of ${noun} ${where}.`;
  // 🆕 D441 — Castform's printed determiner, spelled rather than resolved, for the
  // paragraph above's reason exactly: "Move all Energy from this Pokémon to 1 of
  // your Benched Pokémon." is the card's own sentence, and a heading reading "Move
  // up to 3 Energy" over a pick the player may not shorten would be a caption
  // contradicting its own dialog (D295's defect — the board right and the one
  // screen telling the player what their pick does wrong).
  if (op.max === "all") return `Move all ${noun} ${where}.`;
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
  // 🆕🆕 D402 — THE BASIC NOUN MOVES *IN* HERE RATHER THAN BEING SPELLED A SECOND
  // TIME. `moveNote` has hand-spelled this exact phrase since D226 precisely
  // because this function did not know it, and `auraNarrowing.test.ts`'s read-site
  // census graded this function ZERO on the ground that it "spells two kinds and
  // returns 'Energy' for the rest, so a filter that is not an Energy filter was
  // already handled" — true of `basicPokemon`, and NOT true of `basicEnergy`,
  // which is an Energy filter that was falling through to a WIDER noun than the
  // card prints. D402's *"You may discard any amount of **Basic** Energy from your
  // Pokémon."* (6 legal printings) is the first sentence to reach `discardNote`
  // with it, and a caption reading "any amount of Energy" over a pick restricted to
  // Basic Energy is D295's caption defect exactly: the board right and the one
  // screen telling the player what their pick does wrong. Two readers, one answer —
  // `moveNote` now delegates and its bytes are unchanged for every board.
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
  // 🆕 D295 — THE CAPTION NAMES THE DESTINATION, because the player is being
  // asked to pick and the pick's CONSEQUENCE is the whole difference between the
  // two printings ("Discard an Energy…" versus "Put an Energy… into their
  // hand"). Only the two arms a printed `to` can reach say it; the own-board
  // arms below are unreachable with `to` set and are left exactly as they were
  // rather than growing a branch no card can take.
  const putBack = op.to === "hand";
  // 🆕🆕 D383 — the deck destination's own caption flag, added BESIDE the line above
  // rather than folded into it: `putBack` is read by the two OPPONENT-side arms and
  // this one is read by the own-board arm the sentence actually reaches, so a single
  // tri-state local would have made every arm ask a question only one of them has.
  // The paragraph above said the own-board arms "are unreachable with `to` set" —
  // kept verbatim, and now false for exactly one value (D178).
  // 🆕🆕 D405 — MAKE THAT TWO VALUES, AND THE SECOND ONE IS `putBack`'s OWN. The
  // `yourActive` arm below now reads BOTH flags: *"Put an Energy attached to this
  // Pokémon into your hand."* (5 legal printings, `deriveAttackEffect` arm 12c) is the
  // first own-board printing whose destination is a HAND. So `putBack` is no longer
  // "read by the two OPPONENT-side arms" either — the line two comments up is likewise
  // kept verbatim and likewise now false by exactly one arm.
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
    case "opponentEach":
      return `Discard ${what} from each of your opponent's Pokémon.`;
    case "yourActive":
      // The printed attack sentence verbatim — "this Pokémon" is the Active (§8).
      // 🆕🆕 D383 — and the DECK arm is the printed sentence verbatim too, down to
      // the verb: Wellspring Mask Ogerpon ex prints *"shuffle 3 Energy attached to
      // this Pokémon into your deck"*, not "discard". A caption that still said
      // "Discard" over a pick that shuffles is D295's own caption defect one
      // destination over — the board would be right and the one screen telling the
      // player what their pick does would be wrong.
      // 🆕🆕 D405 — AND THE HAND ARM, WHICH IS THIS SWITCH'S THIRD DESTINATION AND
      // THE SENTENCE VERBATIM: *"Put an Energy attached to this Pokémon into your
      // hand."* (5 legal printings). It is spelled FIRST because `putBack` and
      // `shuffleBack` read the same field for different values and the reading order
      // is arbitrary — but the ORDER of the printed alternatives is not, and "hand" is
      // the destination D295 named first. A caption still saying "Discard" over a pick
      // that hands the card BACK is D295's caption defect at its third destination:
      // the board right, and the one screen telling the player what their pick does
      // wrong — and here it would be wrong about who KEEPS the card, not merely where
      // it lands.
      return putBack
        ? `Put ${what} attached to this Pokémon into your hand.`
        : shuffleBack
          ? `Shuffle ${what} attached to this Pokémon into your deck.`
          : `Discard ${what} from this Pokémon.`;
    case "self":
      // The SAME printed words for the same printed subject — the two members
      // differ in how they RESOLVE it (a spot versus a uid), not in what the
      // card says, so a caption that distinguished them would be inventing text.
      // ⚠️ NOT REACHED BY ANY AUTHORED PROGRAM TODAY, said out loud: Flashing
      // Draw's filter is a Basic {L}, and same-type Basic Energy on one host all
      // carry the identity `basic:Lightning`, so `interchangeableCandidates`
      // collapses them to one and the pick is always forced. A future `self` row
      // with `count: "any"` or a wider filter parks here. The arm exists because
      // this switch is exhaustive over `from`, which is also what makes a new
      // member impossible to add without answering this question.
      return `Discard ${what} from this Pokémon.`;
    case "yours":
      // The printed "from your Pokémon" — the whole own board (Hail Blade).
      return `Discard ${what} from your Pokémon.`;
    case "yourBench":
      // 🆕🆕 D403 — the printed "from your Benched Pokémon", verbatim. The card's
      // leading "You may" is dropped for the reason every arm above drops it: a
      // prompt that has appeared IS the offer, so restating the option is the dialog
      // talking about itself. The `what` half already carries the printed ceiling
      // ("up to 2 Energy" / "up to 2 Basic Energy"), so this caption is the printed
      // sentence minus exactly those two words.
      return `Discard ${what} from your Benched Pokémon.`;
  }
}

/** The noun phrase (singular / plural) each filter reads as in a retrieval note. */
function retrieveNoun(filter: CardFilter): { singular: string; plural: string } {
  switch (filter.kind) {
    case "anyPokemon":
      // D264 — the printed "Pokémon that don't have a Rule Box" (Lana's Aid).
      // The plural is the printed one; the singular keeps the article and the
      // singular verb ("doesn't"), which is `basicPokemon`'s pair one arm down
      // written for the stage-free noun.
      return filter.noRuleBox === true
        ? {
            singular: "a Pokémon that doesn't have a Rule Box",
            plural: "Pokémon that don't have a Rule Box",
          }
        : { singular: "a Pokémon", plural: "Pokémon" };
    case "supporter":
      return { singular: "a Supporter card", plural: "Supporter cards" };
    case "supporterNameContaining":
      // 🆕🆕🆕 D510 — the printed *"Supporter card that has "Team Rocket" in its
      // name"*, and it is the arm one line up with the printed fragment interpolated:
      // the same head noun, the same "card"/"cards" pair, plus the printed narrowing
      // in the printed word order.
      //
      // ⚠️ **THE QUOTATION MARKS ARE PRINTED BYTES RATHER THAN PUNCTUATION THIS ARM
      // CHOSE** — `yourBenchHasNameContaining`'s note (§ the `describeCondition`
      // switch) makes the identical call for the identical reason: the card face
      // quotes its fragment (ASCII U+0022, checked against the committed corpus), and
      // dropping them would make the phrase read as a whole card name and mean
      // `byName` instead.
      //
      // ⚠️ **THE PLURAL MOVES THE POSSESSIVE AS WELL AS THE VERB** — "have" and
      // "their names" — which is one more moving part than `attackNamePokemon`'s pair
      // has, because that phrase's tail ("the Round attack") carries no pronoun.
      //
      // ⚠️ **NO PRINTED RETRIEVAL, PROMPT OR ATTACH NAMES THIS FILTER TODAY**, so it
      // is a reachability arm exactly like `attackNamePokemon`'s: the member's only
      // producer is `deriveAttackDamageMultiplier`, which builds a `DamageCountSource`
      // and never an op, and every caller of this function reads an `op.filter`. The
      // arm exists because this switch is exhaustive over `CardFilter` — which is what
      // makes a new member impossible to add without answering the noun question — and
      // because a REGISTRY author can hand-write the filter into an op tomorrow.
      return {
        singular: `a Supporter card that has "${filter.fragment}" in its name`,
        plural: `Supporter cards that have "${filter.fragment}" in their names`,
      };
    case "item":
      // D231 — the printed "an Item card" / "Item cards". The ARTICLE is "an",
      // which is why these phrases are spelled per kind here rather than built
      // from a noun plus a rule (`ownerPokemon` below computes one and is the
      // exception that needs to).
      return { singular: "an Item card", plural: "Item cards" };
    case "stadium":
      return { singular: "a Stadium card", plural: "Stadium cards" };
    case "trainerCard":
      // D237 — the printed "a Trainer card" (Wailord sv08-087), and this phrase
      // is ALSO the filter's row in effects.ts `HAND_SEARCH_NOUNS`: the shared
      // table's contract is that its two strings are this function's output, so
      // the dialog and the card text cannot spell the same filter differently.
      return { singular: "a Trainer card", plural: "Trainer cards" };
    case "anyCard":
      // D231 — the printed uncategorised noun. It is also the phrase
      // `handCostPhrase` already uses for a filterless cost, so the two agree.
      return { singular: "a card", plural: "cards" };
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
      // D264 — `cardNoun` is the printed "cards" a NON-Pokémon name carries
      // ("up to 2 Arven's Sandwich cards"); a Pokémon name prints bare and stays
      // invariant in both numbers ("up to 3 Flamigo"). The article is a literal
      // "a" for the same reason `typedPokemon`'s is: the singular branch is only
      // reachable for a `max: 1` retrieval, and every printed card name in this
      // seam is consonant-initial — an "an" branch would be a line no card can
      // reach, which this repo removes rather than words.
      return filter.cardNoun === true
        ? { singular: `a ${filter.name} card`, plural: `${filter.name} cards` }
        : { singular: filter.name, plural: filter.name };
    case "basicPokemon":
      // D265 — the printed HP threshold ("a Basic Pokémon with 70 HP or less").
      // The noun is INVARIANT in number, like the bare "Basic Pokémon" it extends,
      // so only the article moves; the number is interpolated because the printed
      // thresholds differ per card (70 on both of this row's sentences, 100 on Fan
      // Rotom's and 120 on Clavell's) and a hard-coded 70 would caption the next
      // one wrong while still filtering it right.
      //
      // ⚠️ THE TWO RIDERS ARE TESTED IN SEQUENCE RATHER THAN COMPOSED, AND THAT IS
      // A CENSUS RATHER THAN AN OVERSIGHT: no legal printing spells both ("a Basic
      // Pokémon that doesn't have a Rule Box with 70 HP or less" is not a sentence
      // in the pool), so a composed phrase would be a caption no card can reach.
      // `noRuleBox` is tried first because Artazon is the older printing; if a set
      // ever prints the pair, THIS is the line that owes the join.
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
    case "stagePokemon":
      // 🆕🆕 D466 — the printed STAGE ORDINAL, whole: "a Stage 1 Pokémon",
      // "Stage 2 Pokémon". INVARIANT IN NUMBER, exactly like the bare "Basic
      // Pokémon" two arms up and the "Evolution Pokémon" one arm up — the ordinal
      // is part of the printed noun and takes no "s" — so only the article moves,
      // and the article is a literal "a" for `suffixPokemon`'s reason: `stage` is
      // CLOSED at two values and BOTH spell "Stage", so no vowel branch is
      // reachable and `ownerPokemon`'s `/^[AEIOU]/` rule is deliberately not copied.
      //
      // ⚠️ **NO PRINTED RETRIEVAL, PROMPT OR ATTACH NAMES THIS FILTER TODAY**, which
      // makes it a reachability arm exactly like `attackNamePokemon`'s and
      // `suffixPokemon`'s below rather than a caption any board renders: the
      // member's only producer is `inPlayBodyFilter`, which feeds a
      // `DamageCountSource` and never an op, and every caller of this function reads
      // an `op.filter`. The arm exists because this switch is exhaustive over
      // `CardFilter` — which is what makes a new member impossible to add without
      // answering the noun question — and because a REGISTRY author can hand-write
      // the filter into an op tomorrow. The property that makes it unreachable is
      // pinned in `bodiesInPlayScaling.test.ts` §8 rather than a caption asserted
      // against a board that cannot emit one (D446's call, verbatim).
      {
        const ordinal = filter.stage === "Stage1" ? "Stage 1" : "Stage 2";
        return { singular: `a ${ordinal} Pokémon`, plural: `${ordinal} Pokémon` };
      }
    case "typedPokemon": {
      // D238 — and this is the ONE place in the vocabulary where the caption
      // DELIBERATELY does not reproduce the printed bytes. The card prints a
      // brace code ("up to 3 {D} Pokémon"); this writes the type out in full,
      // for `energyNoun`'s reason one function down: the rows the player then
      // clicks are card NAMES ("Darkness Energy", "Houndour"), and a dialog
      // heading that quoted `{D}` back at somebody reading it off the card would
      // be the engine speaking a second vocabulary. It is also why the derived
      // brace-coded nouns are NOT rows in effects.ts `HAND_SEARCH_NOUNS`: that
      // table's contract is that its two strings ARE this function's output, and
      // for this filter the printed phrase and the caption phrase differ.
      // ⚠️ D245 — the stage word is now the PRINTED one and not a bare "Basic ".
      // `ownerPokemon`'s ternary one arm down, re-read here for its own reason:
      // "Evolution {M} Pokémon" is printed (Genesect ex "Metallic Signal") and a
      // caption reading "Basic Metal Pokémon" for it would name the complement of
      // what the ability searches for.
      // ⚠️ D275 — the printed HP THRESHOLD rides at the END of the phrase ("up to
      // 3 {C} Pokémon **with 100 HP or less**", Fan Rotom "Fan Call"), where the
      // stage word rides at the FRONT. That is why it is a suffix here and not a
      // second prefix, and why the two compose in ONE template rather than in
      // `basicPokemon`'s if/else ladder: `typedPokemon` can print stage AND type
      // AND threshold at once, so a branch per combination would be four arms of
      // which the pool drives two. The number is interpolated for D265's reason —
      // the thresholds differ per card (70 on Buddy-Buddy Poffin, 100 here) and a
      // hard-coded one would caption the next printing wrong while filtering it
      // right.
      const noun = `${filter.stage === undefined ? "" : filter.stage === "basic" ? "Basic " : "Evolution "}${filter.pokemonType} Pokémon${filter.maxHp === undefined ? "" : ` with ${filter.maxHp} HP or less`}`;
      // 🛑 THE ARTICLE IS A LITERAL "a" AND `ownerPokemon`'s `/^[AEIOU]/` RULE IS
      // DELIBERATELY *NOT* COPIED HERE. That rule exists because the owner set is
      // OPEN (a new "Arven's" arrives with every set); `POKEMON_TYPES` is CLOSED
      // at eleven, and **not one of them begins with a vowel** — so an "an" branch
      // would be a line no board could reach and no mutant could kill, which this
      // repo removes rather than tests around. The claim is a census, so it is
      // pinned as one: `typedPokemonNounsTakeNoVowelArticle` goes red the day a
      // re-ingest adds a vowel-initial type, and *that* is when the branch is owed.
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
    // D285 — the printed "Pokémon that has an Ability" (Team Rocket's Arbok's
    // `preventOpponentPokemonPlay.only`). The arm exists because this switch is
    // exhaustive over `CardFilter`, which is what makes a new member impossible
    // to add without answering the noun question; NO printed retrieval, prompt or
    // attach names this filter today, so the phrase is a `discardNoun`-style
    // reachability arm rather than a caption any board can render — the bar it
    // serves refuses a play and never opens a chooser.
    case "abilityPokemon":
      return { singular: "a Pokémon that has an Ability", plural: "Pokémon that have an Ability" };
    case "attackNamePokemon":
      // 🆕🆕 D446 — the printed *"Pokémon … that has the Round attack"*, and it is
      // `abilityPokemon`'s pair one line up with the printed name interpolated: the
      // same HAS/HAVE swap between the numbers, and the same invariant "Pokémon".
      // The name is interpolated for `basicPokemon.maxHp`'s reason — the printed
      // attack differs per card and a hard-coded "Round" would caption the next
      // sentence wrong while filtering it right.
      //
      // ⚠️ **THE ARTICLE IS A LITERAL "a" AND `ownerPokemon`'s `/^[AEIOU]/` RULE IS
      // NOT COPIED**, `typedPokemon`'s call verbatim: the phrase always OPENS with
      // "Pokémon" whatever the attack is called, so the vowel branch is a line no
      // board could reach and no mutant could kill.
      //
      // ⚠️ **NO PRINTED RETRIEVAL, PROMPT OR ATTACH NAMES THIS FILTER TODAY**, which
      // makes it a reachability arm exactly like `abilityPokemon`'s above rather than
      // a caption any board renders — the member's only producer is
      // `deriveAttackDamageMultiplier`, which builds a `DamageCountSource` and never
      // an op, and every caller of this function reads an `op.filter`. The arm exists
      // because this switch is exhaustive over `CardFilter`, which is what makes a
      // new member impossible to add without answering the noun question — and
      // because a REGISTRY author can hand-write the filter into an op tomorrow.
      return {
        singular: `a Pokémon that has the ${filter.attack} attack`,
        plural: `Pokémon that have the ${filter.attack} attack`,
      };
    case "pokemonNameContaining":
      // 🆕🆕🆕 D512 — the printed *"Pokémon … that has "Koffing" in its name"*, and it
      // is the arm one case up with the printed FRAGMENT interpolated in place of the
      // printed attack: the same invariant "Pokémon" head, the same HAS/HAVE swap
      // between the numbers, the same literal article.
      //
      // ⚠️ **THE QUOTATION MARKS ARE PRINTED BYTES RATHER THAN PUNCTUATION THIS ARM
      // CHOSE** — `supporterNameContaining`'s call verbatim, for its reason: the card
      // face quotes its fragment (ASCII U+0022, checked against the committed corpus),
      // and dropping them would make the phrase read as a whole card NAME and mean
      // `byName` instead.
      //
      // ⚠️ **THE PLURAL MOVES THE POSSESSIVE AS WELL AS THE VERB** — "have" and "their
      // names" — the same extra moving part `supporterNameContaining`'s pair has and
      // `attackNamePokemon`'s does not, because that phrase's tail carries no pronoun.
      //
      // ⚠️ **THE PRINTED SENTENCE'S *"or"* IS NOT THIS ARM'S BUSINESS** — the pair
      // arrives as an `anyOf`, whose own arm JOINS the two phrases this one returns, so
      // the disjunction is captioned exactly once and in one place (D245).
      //
      // ⚠️ **NO PRINTED RETRIEVAL, PROMPT OR ATTACH NAMES THIS FILTER TODAY**, so it is
      // a reachability arm exactly like the two above: the member's only producer is
      // `deriveAttackDamageMultiplier`, which builds a `DamageCountSource` and never an
      // op, and every caller of this function reads an `op.filter`. The arm exists
      // because this switch is exhaustive over `CardFilter` — which is what makes a new
      // member impossible to add without answering the noun question — and because a
      // REGISTRY author can hand-write the filter into an op tomorrow.
      return {
        singular: `a Pokémon that has "${filter.fragment}" in its name`,
        plural: `Pokémon that have "${filter.fragment}" in their names`,
      };
    case "suffixPokemon":
      // 🆕🆕 D446 — the printed rule-box class, whole: "a Pokémon ex", "a Pokémon V".
      // INVARIANT IN NUMBER like the bare "Basic Pokémon" two arms down — the suffix
      // is part of the printed name and takes no "s" — so only the article moves, and
      // the article is a literal "a" for the arm above's reason: `PokemonSuffix` is
      // CLOSED at five values and the phrase opens with "Pokémon" under every one of
      // them, so no vowel branch is reachable.
      //
      // ⚠️ THE PAIR *"Pokémon ex and Pokémon V"* IS NOT SPELLED HERE and must not be:
      // it is an `anyOf` of two of these, and that arm joins its members' phrases —
      // with " or ", where the card prints "and", which is that arm's own documented
      // and deliberate disagreement (the predicate is a union). A second phrase here
      // would be the second answer to one question.
      //
      // Reachability is `attackNamePokemon`'s above, verbatim: no op carries this
      // filter today and the arm is owed by the exhaustive switch.
      return { singular: `a Pokémon ${filter.suffix}`, plural: `Pokémon ${filter.suffix}` };
    case "toolCard":
      return { singular: "a Pokémon Tool card", plural: "Pokémon Tool cards" };
    case "basicEnergy": {
      const kind = filter.energyType === undefined ? "Basic" : `Basic ${filter.energyType}`;
      return { singular: `a ${kind} Energy card`, plural: `${kind} Energy cards` };
    }
    case "anyOf": {
      // D245 — the combinator's caption, and it is a JOIN rather than a phrase.
      //
      // 🛑 **THIS COMMENT SAID "UNREACHABLE FROM A PROMPT TODAY" UNTIL D333, AND
      // IT STOPPED BEING TRUE AT D264 — SIXTY-NINE DECISIONS EARLIER.** Lana's
      // Aid's `discardPileRetrieval` parks a `chooseCards` whose note is this arm's
      // output, and `legalNonAttackPrograms.test.ts` has asserted the rendered
      // string byte for byte ever since, under a case named *"the `anyOf` arm's
      // first witness"*. D264 made the arm live and never moved the sentence.
      // **A STALE COMMENT PROPAGATES FURTHER THAN A STALE NUMBER, BECAUSE NOTHING
      // CAN GO RED ON IT**: D332 read this line, believed it, wrote it into
      // `draytonWindow.test.ts` and into the resume point as a reason Drayton could
      // not use `anyOf` — and D333 was then dispatched to build Bug Catching Set as
      // *"`anyOf`'s first live prompt consumer"*, which is its THIRD. D332's own
      // conclusion still stands on its own merits (Drayton prints a conjunction of
      // two SEPARATELY capped nouns, which no single filter expresses whatever its
      // caption says); only the reachability claim was false.
      //
      // TWO live consumers now: Lana's Aid `sv06-155`/`-207`/`-219` (D264) and Bug
      // Catching Set `sv06-143`/`sv08.5-102` (D333), which prints the same "in any
      // combination of X and Y" grammar one op over.
      //
      // ⚠️ THE JOINER IS " or " WHERE THE CARD PRINTS "and", and the disagreement
      // is deliberate: the predicate is a union (see `matchesFilter`), and an
      // English "and" between two noun phrases inside a single-card question reads
      // as a conjunction the filter does not mean. `pokemonOrBasicEnergy`'s
      // hand-rolled phrase makes the same call one member over.
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
