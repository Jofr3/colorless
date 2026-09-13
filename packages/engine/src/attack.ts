import type {
  ApplyResult,
  AttackAction,
  GameAction,
  PromoteAction,
  TakePrizesAction,
} from "./actions";
import { err } from "./actions";
import {
  ANY_ENERGY,
  activeTop,
  applyDamageModifier,
  attacksOf,
  cardOfUid,
  hasPrintedAbility,
  isExOrV,
  isSpecialEnergy,
  matchesFilter,
  parseAttackDamage,
  preventsAttackerClass,
  resistanceOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
import {
  attackBlockOf,
  attackGateOf,
  attackLocked,
  attackerHasSpecialEnergy,
  attackerSuppressesTargetEffects,
  benchShieldedFromDamage,
  boostedAttackDamage,
  coinFlipShieldPrevents,
  countAttachedEnergy,
  countDamageCountersInPlay,
  countEnergyInPlay,
  countToolsInPlay,
  effectiveAttackCost,
  effectiveRetreatCost,
  firstTurnAttackBanned,
  installedAttackDebuffOf,
  installedNoWeakness,
  installedRecoilOf,
  installedReductionOf,
  koSurvivalClamp,
  lockedAttackIndexes,
  opposingAttackDebuff,
  passivesOf,
  preventedByDamageThreshold,
  preventsAttackerType,
  providedEnergy,
  seatDamageReduction,
  seatRemovesWeakness,
  stadiumPreventsDamage,
} from "./continuous";
import {
  bonusConsequentProgram,
  deriveAttackBonusConsequent,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  optionalBoostProgram,
  discardScaledBoostProgram,
  optionalCostBoostProgram,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackTrailingClause,
  splitAttackRequirementClause,
} from "./effects";
import type {
  AttackCoinFlip,
  AttackDamageBonus,
  AttackFlipCount,
  AttackPreDamage,
  CardFilter,
  EffectOp,
} from "./effects";
import type { GameEvent } from "./events";
import {
  advance,
  finishAttack,
  resolvePrizesAndResume,
  resolvePromotionAndResume,
  settleProgram,
} from "./flow";
import {
  applyStatus,
  attackBarredByAbility,
  attackTimingBlocked,
  attackTimingNote,
  attackerPreWRBonus,
  conditionHolds,
  conditionNote,
  countCardsInDiscardPile,
  countCardsInHand,
  countPokemonInPlay,
  effectRefused,
  runProgram,
} from "./interpreter";
import type { EffectContext } from "./interpreter";
import { programFor } from "./registry";
import { flipCoin, flipUntilTails, MAX_UNTIL_TAILS_FLIPS } from "./rng";
import type { CoinFace } from "./rng";
import { damagedByAttackAbility, koToolTriggersOf } from "./triggers";
import { isBenchIndex, turnGate } from "./turn";
import type { GameState, InPlayPokemon, PendingStage, Phase, Seat } from "./types";
import { isImmobilized, otherSeat, takenPrizes, withActive, withSide } from "./types";

// The attack step (§8) and the two KO-resolution decisions it can park on
// (§8.1). Declaring an attack ends the turn (§5.3), so every path out of
// here funnels into flow.ts's staged tail — the KO stages simply go in
// front of it.

/** §6.4 cost matching. Typed symbols need exactly that type; Colorless slots
    take whatever is left over. `provided` is the flat list of UNITS the
    attached energies give (continuous.ts providedEnergy) — a basic energy one
    unit of its type, a special energy its authored units, possibly several
    (Double Turbo-likes) and possibly a WILDCARD (`ANY_ENERGY` — Luminous, "any
    1 type"). A wildcard fills a typed shortfall or a Colorless slot; concrete
    types are counted per type, wildcards allocated to the (pickier) typed needs
    first, then everything left pays the Colorless slots. */
export function costMet(cost: readonly string[], provided: readonly string[]): boolean {
  const needed = new Map<string, number>();
  let colorless = 0;
  for (const symbol of cost) {
    if (symbol === "Colorless") colorless++;
    else needed.set(symbol, (needed.get(symbol) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  let wild = 0;
  for (const unit of provided) {
    if (unit === ANY_ENERGY) wild++;
    else counts.set(unit, (counts.get(unit) ?? 0) + 1);
  }
  let typedNeeds = 0;
  for (const [type, count] of needed) {
    typedNeeds += count;
    const shortfall = count - (counts.get(type) ?? 0);
    if (shortfall > 0) {
      // Cover the typed shortfall with wildcards; run out and the cost is unmet.
      if (shortfall > wild) return false;
      wild -= shortfall;
    }
  }
  // Each typed need consumed exactly one unit; everything else (surplus typed
  // units, leftover wildcards, Colorless-provided units) pays the Colorless.
  return provided.length - typedNeeds >= colorless;
}

/** `per × count` — the scaled HP a count-scaling clause contributes, tallying its
    resource off the board as of attack declaration (§8.5 — counted when damage is
    calculated). Fold-agnostic: the caller adds this onto the printed base (the
    additive "+" family) or uses it as the whole damage (the "×"/multiply family).
    `attacker` is the attacking Active; `state` + `defenderSeat` reach the
    opponent's board for the Prize-count source (Charizard ex "Burning Darkness",
    Pecharunt ex "Irritated Outburst"), for the retreat-cost source (Heracross
    "Superpowered Throw" and siblings) and — since D168 — for the opponent's
    Active's own DAMAGE COUNTERS (Dedenne "Second Bite", Espeon "Psychic Assault",
    Bloodmoon Ursaluna "Mad Bite"), which is why that member cost this signature
    NOTHING: the pair that reaches the defending body was already here.
    `attackerSeat` is the OTHER end of the
    table and existed only for the `boardCondition` indicator (D115) until D170
    gave it a second reader: a
    `BoardCondition` is relative to whose board it reads — "you have a Stadium in
    play" is about the ATTACKER's ownership, "your opponent's Active …" reaches
    across from there — so it cannot be derived from `defenderSeat` alone without
    quietly hard-coding a two-player table into this fold. D170's bench-wide count
    ("… for each damage counter on all of YOUR Benched Pokémon", Tyranitar
    swsh10.5-043) is the second thing that argument buys, and it cost this
    signature nothing for exactly that reason.

    🆕🆕 **D436 — `cost`, THE SIXTH PARAMETER, AND THE FIRST FACT IN THIS FOLD THAT
    IS NOT ON THE BOARD.** Every source above answers from `(state, seat, attacker)`;
    `extraEnergyUnitsBeyondCost` answers *"how much Energy is attached beyond what
    THIS attack charged"*, and the charge is a property of the DECLARATION. It is the
    EFFECTIVE cost (`effectiveAttackCost`, D169) and it is PASSED rather than
    recomputed — `attack()` already holds the identical array for the §8.2 check, and
    a second call would be a second answer to a question the engine answers once
    (D159). ⚠️ A caller that hands the PRINTED cost here is a live defect on every
    board with a cost modifier in play and moves no other number; the mutant
    `D436-printed-cost-not-effective` is exactly that build. */
function scaledAttackDamage(
  attacker: InPlayPokemon,
  bonus: AttackDamageBonus,
  state: GameState,
  defenderSeat: Seat,
  attackerSeat: Seat,
  cost: readonly string[],
): number {
  switch (bonus.count.kind) {
    case "damageCountersOnSelf":
      // One damage counter = 10 HP (§12); floor for safety though all damage
      // lands in tens. The ONLY source all three folds read (D167): "more" adds it,
      // "less" subtracts it, and no adjective at all makes it the whole damage —
      // which is why this arm answers "how many counters, times per" and nothing
      // about direction. `attacker` is the Active as of DECLARATION, so an attack
      // can never bootstrap the counters it scales off.
      return Math.floor(attacker.damage / 10) * bonus.per;
    case "opponentPrizesTaken":
      // Prizes the opponent has TAKEN (6 − their remaining pile, §8.1), read at
      // declaration before this attack's own KOs award any Prize.
      return takenPrizes(state, defenderSeat) * bonus.per;
    case "opponentActiveRetreatCost": {
      // The {C} in the DEFENDING Pokémon's Retreat Cost — the EFFECTIVE one, not
      // the printed number: `effectiveRetreatCost` already folds every modifier in
      // play (Beach Court's discount, Calamitous Wasteland's surcharge, Clefable
      // ex's set-to-zero aura), so a Stadium that changes what it costs to retreat
      // changes what these attacks hit for. The only derived count source; the
      // rest read a raw field. A missing Active can't happen here (the attack gate
      // requires a Defending Pokémon) — 0 keeps the arm total.
      const defenderActive = state.players[defenderSeat].active;
      return defenderActive === null ? 0 : effectiveRetreatCost(state, defenderActive) * bonus.per;
    }
    case "damageCountersOnOpponentActive": {
      // D168 — the MIRROR of the first arm, off the DEFENDING body: one damage
      // counter = 10 HP (§12), floored for the same safety reason though all
      // damage lands in tens. Read at DECLARATION like every other member, so this
      // attack's own hit cannot bootstrap the counters it is priced on — and a
      // pristine defender contributes 0, which is what makes the printed "30+" /
      // "100+" base the whole damage on a fresh Active.
      //
      // A missing Active can't happen here (the attack gate requires a Defending
      // Pokémon) — 0 keeps the arm total, the same shape the retreat-cost arm
      // above uses for the same reason.
      const defenderActive = state.players[defenderSeat].active;
      return defenderActive === null ? 0 : Math.floor(defenderActive.damage / 10) * bonus.per;
    }
    case "damageCountersOnYourBench": {
      // D170 — the first member that tallies over a ZONE rather than off a single
      // body: every damage counter on the ATTACKER's OWN Bench, summed (Tyranitar
      // swsh10.5-043 "Raging Crash"). One counter = 10 HP (§12), floored per body
      // for the same safety reason the two Active arms floor, and summed AFTER the
      // floor so a stray non-multiple cannot round its way into a neighbour's
      // slot. Neither Active is consulted — not the attacker's, not the
      // defender's — which is the whole difference from the two arms above.
      //
      // `attackerSeat`, not `defenderSeat`: the printed word is "YOUR Benched
      // Pokémon", and the attack that reads it damages the opponent, so the two
      // seats are on opposite ends of the same swing. Bench slots are typed
      // non-nullable, and the `p !== null` guard mirrors `interpreter.ts`'s
      // `yourBenchDamaged` walk over the identical list rather than asserting a
      // second opinion about it. An EMPTY Bench sums to 0 — the same 0 a pristine
      // one gives, and with the printed "10×" base dropped that means no
      // DAMAGE_DEALT at all, which is rules-correct.
      //
      // 🆕🆕 D467 — AND THE OPTIONAL PRINTED NOUN ("for each damage counter on all of
      // your Benched {F} Pokémon", corpus file line 544). ⚠️ **THE FILTER IS OPTIONAL
      // AND `undefined` IS EVERY BODY, SO THE ARGUMENT IS THE WHOLE WIDENING** —
      // D407's `energyOnSelf.zone` shape, D466's `yourBenchCount` one, third address.
      //
      // 🛑 **THE PREDICATE IS `benchBodies`' AND THE FOLD IS NOT, WHICH IS WHY THIS IS
      // AN INLINE GUARD AND NOT A CALL.** *"Which bodies on this Bench does the printed
      // noun name"* is ONE question (D159) and it is answered here by the SAME
      // expression `benchBodies` uses — `matchesFilter(topCardOf(state, p), filter)`,
      // the TOP card (§1.2) so a body that has evolved twice IS a Stage 2 now. What
      // differs is what is summed: that walk counts 1 per body, this one sums
      // `damage ÷ 10`. Sharing the walk would mean a `benchBodies` that returns a LIST,
      // which changes a function three shipped members call and whose exact bytes
      // `D466-bench-walk-loses-the-unfiltered-path` quotes — D359's discriminator (a
      // widening is free, a rename is not) says the cheaper honest thing is two folds
      // over one predicate, stated here.
      const bench = state.players[attackerSeat].bench;
      const filter = bonus.count.filter;
      return (
        bench.reduce(
          (total, p) =>
            total +
            (p !== null && (filter === undefined || matchesFilter(topCardOf(state, p), filter))
              ? Math.floor(p.damage / 10)
              : 0),
          0,
        ) * bonus.per
      );
    }
    case "damageCountersOnOpponentBoard":
      // 🆕🆕 D469 — THE SAME TALLY AS THE ARM DIRECTLY ABOVE, AT THE OTHER SEAT AND
      // OVER THE WHOLE BOARD ("This attack does 10 more damage for each damage counter
      // on all of your opponent's Pokémon.", corpus file line 534). Delegated to
      // `countDamageCountersInPlay`, which sits beside `countEnergyInPlay` and
      // `countToolsInPlay` in continuous.ts: *"all of your opponent's Pokémon"* is the
      // SAME printed scope those two already read, and D159's rule is that one question
      // gets one answer. The per-body floor lives in the helper, so this member and
      // `damageCountersOnYourBench` cannot come apart on a board carrying a
      // non-multiple.
      //
      // `defenderSeat`, because the printed word is "your OPPONENT's Pokémon" and the
      // seat that declared the attack is the other end of the swing — the same end as
      // `damageCountersOnOpponentActive` five cases up and the exact OPPOSITE of
      // `damageCountersOnYourBench` directly above, which is the substitution the
      // suite's own-board control exists to catch.
      //
      // 🛑 **THIS IS THE ONLY DAMAGE-COUNTER ARM THAT NAMES NEITHER ACTIVE EXPLICITLY**
      // — the Active is INSIDE the walk rather than beside it, which is what the printed
      // "all of" means and what separates this from a Bench-only misread. A board whose
      // counters are all on the Active and one whose counters are all on the Bench give
      // the same number here and different numbers under either shipped neighbour, so the
      // suite drives those two boards separately rather than one board that has both.
      // Read at DECLARATION like every other member, so this attack's own hit cannot
      // bootstrap the counters it is priced on; a pristine board is 0, and with the
      // printed "10+" base kept that is the base alone.
      return countDamageCountersInPlay(state, defenderSeat) * bonus.per;
    case "opponentBenchCount":
      // D193 — the DEFENDER's Bench counted as BODIES. The mirror-image question
      // to `damageCountersOnYourBench` above: the same zone walk with `damage`
      // never consulted, so an untouched Bench and a nearly-dead one give the
      // same number and only the population moves it. `defenderSeat`, because the
      // printed word is "your OPPONENT's Benched Pokémon" and the seat that
      // declared the attack is the other end of the swing.
      return benchBodies(state, defenderSeat) * bonus.per;
    case "yourBenchCount":
      // D282 — the ATTACKER's Bench counted as BODIES, the third face of the noun
      // the two arms around it read at the other two seats. `attackerSeat`,
      // because the printed word is "YOUR Benched Pokémon" and the seat that
      // declared the attack owns it — the exact opposite end of the swing from
      // `opponentBenchCount` one case up, and the SAME end as
      // `damageCountersOnYourBench`, whose zone walk this shares and whose
      // `damage` read it deliberately does not. An empty Bench is 0, and on the
      // `×` fold (with the printed base dropped) that means no DAMAGE_DEALT at
      // all — rules-correct, and the board the suite drives first.
      //
      // 🆕🆕 D466 — AND THE OPTIONAL PRINTED NOUN ("for each Stage 2 Pokémon on your
      // Bench", corpus file line 589). ⚠️ **THE FILTER IS OPTIONAL AND `undefined`
      // IS EVERY BODY, SO THE ARGUMENT IS THE WHOLE WIDENING**: every sentence that
      // reached this arm before D466 passes `undefined` and `benchBodies` walks the
      // zone exactly as it did — D407's `energyOnSelf.zone` shape, three arms down,
      // for its stated reason. The filtered walk is `benchBodies`' own, not a second
      // one (D159): the two readings of "how many Benched Pokémon" cannot drift
      // because there is only one of them, and `bodiesInPlayScaling.test.ts` §8
      // drives BOTH on ONE board to pin that.
      //
      // 🛑 **AND IT IS THE BENCH AND ONLY THE BENCH** — the Active is not consulted,
      // which is the printed word ("on your Bench") and is the axis §8's stage board
      // is built to expose: its Active IS a Stage 2, so an "in play" walk reads one
      // more than this arm does and lands a different number.
      return benchBodies(state, attackerSeat, bonus.count.filter) * bonus.per;
    case "bothSidesBenchCount":
      // D193 — BOTH Benches, the first member whose answer spans the table and so
      // the first that could not be expressed as a `side` on another member. Read
      // at DECLARATION like every other member; neither Active is consulted, which
      // is what makes "Benched Pokémon" the whole of the printed noun.
      return (benchBodies(state, attackerSeat) + benchBodies(state, defenderSeat)) * bonus.per;
    case "energyOnOpponent": {
      // D193 — the Energy attached to the opponent, over the zone the sentence
      // named. NEITHER reading is computed here: both delegate to continuous.ts,
      // which already answers "how much Energy is attached" for the conditional
      // clauses and the coin family (D118/D128), so a wildcard Luminous counts
      // toward `{R}` here for exactly as long as it does everywhere else and a
      // Special that pays for two units is still one CARD. D159's rule — no
      // second answer to a question the engine already answers.
      //
      // "board" is Active + Bench (§6.3 "in play"), so it is a strict SUPERSET of
      // "active" rather than the Bench alone. A missing Active can't happen here
      // (the attack gate requires a Defending Pokémon) — 0 keeps the arm total,
      // the same shape the retreat-cost arm above uses for the same reason, and
      // `countEnergyInPlay` handles the absent Active on the board path itself.
      const { zone, energyType } = bonus.count;
      if (zone === "board") return countEnergyInPlay(state, defenderSeat, energyType) * bonus.per;
      const defenderActive = state.players[defenderSeat].active;
      return defenderActive === null
        ? 0
        : countAttachedEnergy(state, defenderActive, energyType) * bonus.per;
    }
    case "energyOnSelf": {
      // D196 — the MIRROR of the arm directly above, off the ATTACKING body. Same
      // delegation to continuous.ts for the same D159 reason: `countAttachedEnergy`
      // already answers "how much Energy is attached to this Pokémon" for the
      // conditional clauses and the coin family (D118/D128), so a wildcard Luminous
      // counts toward `{R}` here for exactly as long as it does everywhere else and
      // a Special that pays for two units is still one CARD.
      //
      // `attacker`, not `state.players[attackerSeat].active` — the Active AS OF
      // DECLARATION, the same body `damageCountersOnSelf` reads, so an attack can
      // never bootstrap the Energy it scales off. No missing-body case exists: the
      // attacker is the thing declaring.
      //
      // 🆕 D407 — AND THE BOARD ZONE, WHICH IS THE SAME SHAPE THE `energyOnOpponent`
      // ARM ABOVE HAS CARRIED SINCE D193, AT THE OTHER END OF THE TABLE. "all of
      // your Pokémon" is §6.3's "in play" — Active + Bench — so it delegates to
      // `countEnergyInPlay`, the counter the opponent-side `zone: "board"` arm
      // already calls; the two readings of one printed scope cannot drift because
      // there is only one of them. `attackerSeat`, because the printed word is
      // "YOUR Pokémon" and the seat that declared the attack owns them — the same
      // end of the swing as `yourBenchCount` and `toolsOnYourBoard`, and the
      // opposite end from the `energyOnOpponent` call five lines up.
      //
      // ⚠️ The zone is OPTIONAL and `undefined` is the ATTACKING BODY, so this
      // `if` is the whole widening: every sentence that reached this arm before
      // D407 falls through it unchanged. A missing Active cannot matter on either
      // path — `attacker` is the declaring body and `countEnergyInPlay` handles an
      // absent Active inside its own walk.
      const { zone, energyType } = bonus.count;
      // 🆕🆕 D470 — THE BOARD ZONE, NARROWED BY THE PRINTED NOUN ("all of your Iono's
      // Pokémon", corpus file line 558). It is its own `if` rather than a fourth
      // argument spliced into the line below, and that is deliberate on two counts.
      // ⑴ **The unfiltered line stays byte-identical**, so the four mutation-corpus
      // rows anchored on it keep their `find` and every declared survivor in this file
      // is preserved by D469's pure-addition argument rather than by re-reading seven
      // reasons. ⑵ **The polarity is spelled at the consumer**: `filter === undefined`
      // takes the line below unchanged, which is what makes the field's absence mean
      // "every body in the zone" here as well as at the producer.
      //
      // `attackerSeat` on BOTH lines, because the printed word is "all of YOUR …
      // Pokémon" — the subgroup narrows WHICH of your bodies count, never WHOSE.
      if (zone === "board" && bonus.count.filter !== undefined) {
        return countEnergyInPlay(state, attackerSeat, energyType, bonus.count.filter) * bonus.per;
      }
      if (zone === "board") return countEnergyInPlay(state, attackerSeat, energyType) * bonus.per;
      return countAttachedEnergy(state, attacker, energyType) * bonus.per;
    }
    case "bothActivesEnergyCount": {
      // D196 — the first member BOTH SEATS contribute to: the Energy on the
      // attacker's Active PLUS the Energy on the defender's, added and then scaled
      // once. UNTYPED on both ends (`null`) because the printed sentence carries no
      // filter, and the two halves must be the same reading of the same noun — the
      // plausible mistake here is counting one end and calling it "both", which is
      // exactly `energyOnSelf`'s answer and is driven apart on a board where the
      // two sides hold different amounts.
      //
      // A missing defending Active can't happen here (the attack gate requires a
      // Defending Pokémon) — 0 keeps the arm total, the shape every cross-board arm
      // above uses for the same reason.
      const defenderActive = state.players[defenderSeat].active;
      return (
        (countAttachedEnergy(state, attacker, null) +
          (defenderActive === null ? 0 : countAttachedEnergy(state, defenderActive, null))) *
        bonus.per
      );
    }
    case "toolsOnYourBoard":
      // 🆕 D406 — the POKÉMON TOOLS attached to everything the ATTACKER has in
      // play ("This attack does 30 damage for each Pokémon Tool attached to all of
      // your Pokémon."). Delegated to `countToolsInPlay`, which sits beside
      // `countEnergyInPlay` in continuous.ts: "all of your Pokémon" is the SAME
      // printed scope `energyOnOpponent`'s `zone: "board"` reads at the other end
      // of the table, and D159's rule is that one question gets one answer.
      //
      // `attackerSeat`, because the printed word is "YOUR Pokémon" and the seat
      // that declared the attack owns them — the same end of the swing as
      // `yourBenchCount` two cases up, and the same reason. This is the only arm
      // in this switch that names NEITHER Active: the Active is inside the walk
      // rather than beside it, so a board whose Tools are all on the Bench and one
      // whose Tools are all on the Active give the same number, which is what the
      // printed "all of" means. Read at DECLARATION like every other member; an
      // empty board is 0 and, with the printed "30×" base dropped, that is no
      // DAMAGE_DEALT row at all.
      return countToolsInPlay(state, attackerSeat) * bonus.per;
    case "pokemonInPlay": {
      // 🆕🆕 D439 — the ATTACKER's BODIES IN PLAY matching the printed noun
      // ("This attack does 30 damage for each of your {G} Pokémon in play.").
      //
      // 🛑 **`countPokemonInPlay` AND NOT `benchBodies`, AND THE TWO ARE NOT THE
      // SAME NUMBER.** `benchBodies` — three cases up, serving `yourBenchCount`,
      // `opponentBenchCount` and `bothSidesBenchCount` — reads the printed word
      // "Benched" and deliberately skips the Active Spot. This member's printed
      // words are "in play", which §4 defines as the Active PLUS the Bench, so on
      // a board with an Active and two Benched bodies the two nouns answer 3 and
      // 2. Reaching for the structurally nearest neighbour here would have shipped
      // a card one body short on every board it is ever played on — and every
      // damage figure would still have looked plausible, which is why the suite
      // drives an Active-contributes board and a Bench-contributes board
      // separately rather than one board that happens to have both.
      //
      // The walk is `countOwnerPokemonInPlay`'s, GENERALISED at its own site
      // rather than copied here, so D242's `BoardCondition` reading of "in play"
      // and this one cannot drift — D159's rule, and the reason this arm is one
      // line. It also owns the NULL-ACTIVE case: a seat whose Active Spot is empty
      // answers with its Bench and never throws.
      //
      // `attackerSeat`, because the printed word is "YOUR Pokémon in play" and the
      // seat that declared the attack owns them — the same end of the swing as
      // `yourBenchCount` and `toolsOnYourBoard`, and the opposite end from
      // `opponentBenchCount`. Read at DECLARATION like every other member; a board
      // matching nothing is 0, and on the `×` fold (printed base dropped) that is
      // no DAMAGE_DEALT row at all, which is the printed floor.
      // 🆕🆕 D446 — THE SEAT IS READ OFF THE MEMBER AND IS NEVER DERIVED FROM THE
      // FOLD. The expression is `cardsInDiscardPile`'s one case down, BYTE FOR BYTE
      // apart from the local's name, because it is the same question about a
      // different zone (D159) — and it is spelled differently ONLY because two
      // identical lines in one file break a mutant `find` into a `2×` (D437's
      // converse trap, D442's rule). Do not "tidy" the two into one helper: they
      // read different members and `precheck` is what would catch the collapse.
      //
      // 🛑 **UNLIKE THE PILE, THE CONFOUND HERE IS NOT EVEN AVAILABLE.** D440 had to
      // argue that a fold-derived seat would read all eight printed printings
      // correctly; this member's two seats sit on the SAME fold (`×`), so a build
      // that hard-coded `attackerSeat` scores the opponent's three printings off the
      // attacker's board on every board that differs — which is what §4's rungs
      // drive, one seat per board rather than one mirrored pair.
      const bodySeat = bonus.count.seat === "you" ? attackerSeat : defenderSeat;
      return countPokemonInPlay(state, bodySeat, bonus.count.filter) * bonus.per;
    }
    case "bothSidesPokemonInPlay": {
      // 🆕🆕🆕 D512 — the bodies in play matching the printed noun, on BOTH sides of the
      // table ("This attack does 40 damage for each Pokémon in play that has "Koffing"
      // or "Weezing" in its name (both yours and your opponent's).", 1 sentence / 2
      // legal printings). The SEAT-SPANNING twin of the arm directly above, placed
      // against it so the two readings of one zone are read together.
      //
      // 🛑 **A MEMBER AND NOT A THIRD `CountSeat` VALUE, AND THIS FILE IS EXACTLY WHERE
      // THAT WOULD HAVE GONE WRONG.** The arm above resolves its seat with
      // `seat === "you" ? attackerSeat : defenderSeat` — a BINARY ternary — so a
      // `seat: "both"` would have fallen into the `defenderSeat` branch and scored the
      // whole sentence off ONE board, silently. Measured rather than argued: `CountSeat`
      // was widened to three values at D512's head and `tsc -b` exited 0 with the engine
      // suite green. A new member cannot do that — this `switch` is total over the union
      // and a missing arm is a compile error (D447).
      //
      // 🛑 **TWO CALLS TO `countPokemonInPlay`, AT THE SAME FILTER, AND NOT A SECOND
      // WALK.** `bothActivesEnergyCount` makes the identical move one noun over, and
      // D159's rule is that "how many bodies does this seat have in play matching this
      // filter" has ONE answer whichever vocabulary asks. The plausible mistake here is
      // counting one end and calling it "both" — which is precisely the arm above — and
      // it is driven apart on a board where the two sides hold different numbers.
      //
      // ⚠️ **`benchBodies` IS THE WRONG NEIGHBOUR AND ANSWERS ONE LOWER PER SEAT.**
      // §4 defines "in play" as the Active PLUS the Bench; the printed words here are
      // "in play", so both Actives contribute and the suite drives an Active-contributes
      // board separately from a Bench-contributes one.
      //
      // The sum is taken BEFORE the multiply — the printed "40×" scales the TOTAL body
      // count and not each side — and a board matching nothing on either seat is 0,
      // which on this fold (printed base dropped) is no DAMAGE_DEALT row at all.
      return (
        (countPokemonInPlay(state, attackerSeat, bonus.count.filter) +
          countPokemonInPlay(state, defenderSeat, bonus.count.filter)) *
        bonus.per
      );
    }
    case "cardsInDiscardPile": {
      // 🆕🆕 D440 — the cards in a DISCARD PILE matching the printed noun, on the seat
      // the sentence NAMED ("…for each Item card in your opponent's discard pile.").
      //
      // 🛑 **THE SEAT IS READ OFF THE MEMBER AND IS NEVER DERIVED FROM THE FOLD, AND
      // THIS ARM IS WHERE THAT WOULD BE INVISIBLE.** `bonus` carries no adjective by
      // the time it reaches here — the fold is decided by WHICH reader answered, in
      // attack.ts's caller — so a build that hard-coded `attackerSeat` here would be
      // right on the two printed "more" sentences and silently wrong on the two printed
      // `×` ones (and vice versa). The printed noun phrase is the discriminator, and it
      // was captured where it is printed.
      //
      // `attackerSeat` / `defenderSeat` and not `state.players[...]` derived from one
      // of them: `scaledAttackDamage` has taken BOTH ends of the table since 0.66.0,
      // and deriving one from the other would quietly hard-code a two-player table into
      // this fold — the argument `boardCondition` and `damageCountersOnYourBench` make
      // for the same pair of parameters.
      //
      // The walk is `countCardsInDiscardPile` (interpreter.ts) — D376's own scan,
      // GENERALISED at its site rather than copied here, so the `BoardCondition`
      // threshold and this count cannot disagree about what a printed noun admits in a
      // pile (D159). It owns the EMPTY pile (0) and the unresolvable uid (0) too.
      //
      // A pile that matches nothing is 0, and on the `×` fold (printed base dropped)
      // that is no DAMAGE_DEALT row at all, which is the printed floor; on the `+` fold
      // it is the printed base alone.
      const pileSeat = bonus.count.seat === "you" ? attackerSeat : defenderSeat;
      return countCardsInDiscardPile(state, pileSeat, bonus.count.filter) * bonus.per;
    }
    case "cardsInOpponentHand":
      // 🆕🆕 D445 — the cards in the DEFENDER's HAND matching the printed noun
      // ("This attack does 30 damage for each card in your opponent's hand.";
      // "Your opponent reveals their hand. This attack does 50 damage for each
      // Trainer card you find there.").
      //
      // 🛑 **`defenderSeat` IS THE MEMBER'S NAME AND NOT A DERIVATION, WHICH IS WHY
      // THERE IS NO `seat` LOCAL HERE LIKE THE ARM ABOVE HAS.** `cardsInDiscardPile`
      // needs one because the column prints both piles; this column prints the
      // OPPONENT's hand on both rows and your own on none, so the side lives in the
      // member's name (D168) and the day a "your hand" printing arrives it gains a
      // sibling member rather than this arm gaining a branch — the falsifier
      // `opponentHandScaling.test.ts` §6 pins on the population.
      //
      // ⚠️ **THIS IS THE ONE ARM IN THE SWITCH WHOSE ZONE THE OTHER PLAYER CANNOT
      // SEE**, and the damage it produces IS public — so the fold is an information
      // channel in a way none of its sixteen siblings is. What keeps it honest is the
      // PRINT: the bare row counts hand SIZE (already public — the count shows), and
      // the filtered row is preceded by a printed reveal that this engine actually
      // performs (`deriveAttackEffect` claims the same string). The argument is in
      // `DamageCountSource.cardsInOpponentHand`'s own block; this line is where it
      // would be silently untrue if a successor widened the vocabulary onto an
      // unrevealed sentence.
      //
      // The walk is `countCardsInHand` (interpreter.ts) — D420's own loop, GENERALISED
      // at its site rather than copied here, so the `BoardCondition` threshold over a
      // hand and this count cannot disagree about what a printed noun admits (D159).
      // It owns the EMPTY hand (0) and the unresolvable uid (0) too.
      //
      // Read at DECLARATION like every other member. A hand that matches nothing is 0,
      // and on this fold (printed base dropped) that is no DAMAGE_DEALT row at all,
      // which is the printed floor.
      return countCardsInHand(state, defenderSeat, bonus.count.filter) * bonus.per;
    case "extraEnergyUnitsBeyondCost":
      // 🆕🆕 D436 — the 0-or-1 INDICATOR again, but read against the DECLARATION.
      // "…at least N extra Energy attached (in addition to this attack's cost)".
      //
      // 🛑 **UNITS ON BOTH SIDES.** `providedEnergy` is the flat list of provision
      // UNITS — the operand `costMet` consumes — and `cost` is the effective symbol
      // list, so the subtraction is symbols-minus-symbols. `countAttachedEnergy`
      // (CARDS, D121) is the WRONG delegate here and the difference is visible on
      // any board holding a multi-unit Special: one card providing two units is two
      // Energy toward this cost and would be one Energy to that counter. The full
      // argument is at `EXTRA_ENERGY_BONUS` (effects.ts); the discriminating board
      // is driven in `extraEnergyBonus.test.ts` §2.
      //
      // `attacker` is the DECLARATION snapshot, like every other arm here — the
      // pre-damage seam discards Tools and never Energy, and §8.2 is a CHECK and not
      // a payment (the rules reference says so out loud), so nothing between the
      // gate and this line can move either operand.
      //
      // `>=`, a FLOOR, like every `at least` reading in this engine. The difference
      // cannot be negative on a board that passed the §8.2 check, which is the
      // arithmetic that makes the UNITS reading the only coherent one.
      return providedEnergy(state, attacker).length - cost.length >= bonus.count.extra
        ? bonus.per
        : 0;
    case "boardCondition":
      // The 0-or-1 INDICATOR (D115) — "If <clause>, this attack does N more
      // damage." The printed bonus lands whole when the clause holds for the
      // ATTACKER and nothing lands when it does not, which is the entire fold:
      // no base is dropped, no branch is added, and the `+` modifier is simulated
      // either way. Evaluated HERE, at declaration, so Gyarados ex's "already has
      // any damage counters on it" cannot be bootstrapped by this very attack.
      return conditionHolds(state, attackerSeat, bonus.count.cond) ? bonus.per : 0;
  }
}

/** How many Pokémon are on `seat`'s Bench (D193) — BODIES, never the counters on
    them. Bench slots are typed non-nullable and the `!== null` guard mirrors the
    `damageCountersOnYourBench` walk directly above rather than asserting a second
    opinion about the same list; an empty Bench is 0, which for the `×` fold means
    no damage and no `DAMAGE_DEALT` at all. Shared by the two body-count members
    so that "how many Benched Pokémon" has ONE answer no matter which side asks —
    the mirror pair's only real hazard is drifting into two. */
function benchBodies(state: GameState, seat: Seat, filter?: CardFilter): number {
  // 🆕🆕 D466 — the OPTIONAL printed noun. `undefined` counts every body, which is
  // the shape D282 and D193 shipped and is what keeps this function's three shipped
  // callers (`opponentBenchCount`, `yourBenchCount`, `bothSidesBenchCount`) byte-
  // identical in behaviour. The read is the **TOP card** (§1.2) through `topCardOf`,
  // not the bottom of the stack: a Basic that has evolved twice IS a Stage 2 now,
  // which is what makes the §10 evolve a real line of play here rather than a rule
  // written for symmetry — `opponentActiveIsStage2`'s own reading (interpreter.ts),
  // reached from the Bench. `matchesFilter` takes `Card | undefined` and answers
  // false for a missing card, so an unresolvable uid is counted OUT rather than
  // throwing; the `p !== null` guard is still needed and still D193's.
  return state.players[seat].bench.reduce(
    (total, p) =>
      total +
      (p !== null && (filter === undefined || matchesFilter(topCardOf(state, p), filter)) ? 1 : 0),
    0,
  );
}

/** One flip-count member's worth of faces, IN ORDER, plus the advanced rngState
    (D128, reshaped by D129). Deliberately not a `DamageCountSource` arm —
    `scaledAttackDamage` answers "how much damage per unit of a board resource"
    and folds into `scaled`, where this answers "which faces came up" and folds
    into nothing at all. Sharing a fold between the two would mean the flips could
    reach `scaled`.

    D129 — THIS RETURNS FACES, NOT A COUNT, and that is the whole shape change.
    D128's `flipCount` computed a number and handed it to a `for` loop, which is
    the only reading `printed` and `attachedEnergy` admit; `untilTails` has NO
    such number — its count is a property of the faces and is known only once they
    are drawn, so asking "how many times?" first would mean flipping to find out
    how many times to flip. Returning the sequence answers all three members with
    one signature and leaves the caller's job (announce each face, count the heads)
    identical for every one of them.

    `attacker` is the Active as of declaration and exists only as the unreachable
    branch's answer: the count is read off `state` at the flip site, and the Active
    can't be missing there (the attack gate required it and every path that removes
    one returns first), so the fallback keeps the arm total rather than covering a
    case. Same shape `scaledAttackDamage`'s `opponentActiveRetreatCost` arm uses. */
function takeFlips(
  state: GameState,
  attackerSeat: Seat,
  attacker: InPlayPokemon,
  count: AttackFlipCount,
): [faces: CoinFace[], nextState: number] {
  // The unbounded arm's bound lives with the RNG that produces the faces, not
  // here — see MAX_UNTIL_TAILS_FLIPS. It cannot fire with the current flipCoin.
  //
  // BUT THE CAP IS CHECKED HERE, and this is the engine's ONLY throw. `rng.ts`
  // returns the faces rather than a count "precisely so a caller can detect the
  // truncation", and until now no caller did: every consumer just tallies heads,
  // so a truncated all-heads sequence would quietly score 64 heads — of damage on
  // one printing, of mill iterations on the other. That is the exact lie the
  // constant's docblock says the bound exists to prevent, and it is silent.
  //
  // Total functions everywhere else in this engine, and deliberately so; the
  // exception is earned by there being no honest value to return. "Flip until
  // tails" that has not yet seen tails has NO heads count — the sequence isn't
  // over. Refusing the attack would invent game semantics for a case the rules
  // don't describe; scoring the truncation would corrupt the match record. The
  // condition is unreachable by construction (mulberry32's longest heads run over
  // the whole 2³² cycle is 31, half the cap), so this cannot fire today — it fires
  // only if someone replaces `nextU32` with something degenerate, and a crash at
  // the flip site is how they should find out rather than through a match that
  // paid 64 heads. Re-derive the run length before changing the RNG; rng.ts says
  // how.
  if (count.kind === "untilTails") {
    const [faces, rngState] = flipUntilTails(state.rngState, MAX_UNTIL_TAILS_FLIPS);
    if (faces.at(-1) !== "tails") {
      throw new Error(
        `flipUntilTails truncated at the ${MAX_UNTIL_TAILS_FLIPS}-flip cap (${faces.length} consecutive heads), so the sequence has no heads count to score — see MAX_UNTIL_TAILS_FLIPS in rng.ts, which the shipped flipCoin cannot reach`,
      );
    }
    return [faces, rngState];
  }
  // 🆕🆕🛑 **D474 — A `switch` AND NOT A TERNARY, AND THE MEASUREMENT THAT DECIDED
  // IT IS WORTH KEEPING.** This was `count.kind === "printed" ? count.count :
  // countAttachedEnergy(…, count.energy)` — a two-way test standing in for a
  // three-way union, which is D222's closed-world hazard and D447's *"a total
  // `switch` is the only thing that sees a new union member"*.
  //
  // ⚠️ **THE TERNARY WAS NOT SILENT, AND THAT IS THE INTERESTING PART.** Measured on
  // THIS file before the conversion — the fourth member added to `AttackFlipCount`
  // and nothing else changed — `bunx tsc -b` answered **TS2339 at `count.energy`**:
  // *"Property 'energy' does not exist on type … | { kind: "pokemonInPlay"; filter:
  // CardFilter }"*. So the `:` branch really did go LOUD rather than swallowing the
  // new member.
  //
  // 🛑 **IT WAS LOUD FOR A REASON THAT DOES NOT GENERALISE, WHICH IS EXACTLY WHY
  // THE `switch` IS OWED ANYWAY.** The narrowing that saved it is the FIELD ACCESS,
  // not the discriminator: `count.energy` fails only because the new member has no
  // `energy` key. A member carrying an `energy` field of a compatible type would
  // satisfy `count.energy` and fall SILENTLY into the self-attached reading,
  // computing a different number on every board with no compile error anywhere. The
  // ternary's exhaustiveness rested on a payload coincidence; the `switch` rests on
  // the discriminator, so the next member is a compile error whatever it carries.
  //
  // 🆕🆕🛑 **D475 — THE RULE ABOVE HOLDS AND ITS PREDICTION DID NOT. THE PARAGRAPH
  // NAMED THE WRONG ROW, AND THE CORRECTION IS THE MEASUREMENT.** D474 wrote that the
  // hazardous member was *"a per-Energy count scoped to BOTH Actives, which is corpus
  // file line 231 and is exactly the next thing anyone will add here"*. D475 built
  // file line 231, and its member is `bothActivesEnergy` — **NULLARY**, because the
  // printed sentence carries no type filter (measured over all 640 rows: the
  // optional-filter loosening of the anchor claims the identical 1 sentence /
  // 1 printing) and D440's rule therefore gives a second member rather than a field.
  // **So the old ternary would have been LOUD for this member too.** Measured on THIS
  // file rather than reasoned: with the ternary restored and `pokemonInPlay` peeled
  // off the `:` branch — D473's three-member world plus D475's member, which is the
  // exact world the prediction was about — `bunx tsc -b` answers
  // *"TS2339: Property 'energy' does not exist on type '{ kind: "attachedEnergy"; … }
  // | { kind: "bothActivesEnergy"; }'"*, naming the new member by hand. Restored in a
  // `finally` and verified byte-identical.
  //
  // ⚠️ **WHAT THE `switch` DID BUY IS STILL MEASURED, AND IT IS A DIFFERENT FACT.**
  // With the member added and this `case` withheld, `tsc` answers **TS2454 —
  // *"Variable 'flips' is used before being assigned"*** at the loop below. That
  // refusal is on the DISCRIMINATOR and holds for every member shape, where the
  // ternary's held only for members whose payload happens to lack `energy`. **The
  // conversion remains right (D222/D447) and the row that was supposed to demonstrate
  // it does not.** ⚠️ The general lesson is D427's: *a price is a forecast; a rule is
  // a criterion.* D474's criterion was sound and its forecast about which row would
  // exercise it was a guess written in the same paragraph, in the same voice.
  let flips: number;
  switch (count.kind) {
    case "printed":
      flips = count.count;
      break;
    case "attachedEnergy":
      flips = countAttachedEnergy(
        state,
        state.players[attackerSeat].active ?? attacker,
        count.energy,
      );
      break;
    // 🆕🆕 D474 — the BODY count. `countPokemonInPlay` (interpreter.ts) and NOT
    // `benchBodies` above: the printed noun is *"you have in play"*, which is §4's
    // Active + Bench, and the Bench-only walk would answer one lower on every board
    // with a matching Active. It is the same walk the `DamageCountSource.pokemonInPlay`
    // fold uses, so *"how many of my {D} Pokémon are in play"* has ONE answer no
    // matter which vocabulary asks (D159).
    //
    // ⚠️ **`attackerSeat` AND NOT `attacker`.** Every other arm here reads a BODY;
    // this one reads a SIDE, so the seat is the whole of what it needs and the
    // `attacker` parameter is untouched. Crossing it to `otherSeat(attackerSeat)`
    // would count the defender's board — the seat crossing D447/D454 name as this
    // engine's two worst uncaught defects — and is pinned by its own row.
    case "pokemonInPlay":
      flips = countPokemonInPlay(state, attackerSeat, count.filter);
      break;
    // 🆕🆕 D475 — the count BOTH SEATS contribute to: the Energy attached to the
    // attacker's Active PLUS the Energy attached to the defender's, added and then
    // flipped once per card. TWO calls to the SAME `countAttachedEnergy` the arm above
    // uses, at the SAME `null` filter, because the printed sentence carries no type
    // word — D159, and the identical delegation
    // `scaledAttackDamage`'s `bothActivesEnergyCount` arm makes for the DAMAGE
    // spelling of this noun (`attack.ts` ~line 419). One printed noun, one counter.
    //
    // ⚠️ **THE LOCALS ARE NAMED `ownActive`/`foeActive` AND NOT
    // `defenderActive`, ON PURPOSE** (D446/D448): the damage arm four hundred lines up
    // spells `const defenderActive = state.players[defenderSeat].active;` and a
    // byte-twin here would make a mutant row match twice, in a function that row does
    // not describe. Do not "tidy" the two into one helper.
    //
    // ⚠️ **THE ATTACKER SIDE IS THE LIVE ACTIVE, NOT THE DECLARING BODY, AND THAT
    // IS THIS SITE'S CONVENTION RATHER THAN THE FOLD'S.** `takeFlips` reads its count
    // off `state` AT THE FLIP SITE — the `attachedEnergy` arm above says so and spells
    // it the same way — while `scaledAttackDamage` reads `attacker`, the Active as of
    // DECLARATION. The two cannot disagree on any reachable board (`D196-live-active`
    // is a declared equivalent for exactly that reason: the only pre-fold mutation of
    // the attacker is the confusion self-damage, which carries `energy` across
    // untouched), so the choice is unobservable and is made by matching the SITE.
    //
    // A missing defending Active cannot happen here — the attack gate required a
    // Defending Pokémon and every path that removes one returns first — so the `0`
    // keeps the arm TOTAL rather than covering a case, the same shape every
    // cross-board arm in this file uses and the same one the damage twin states.
    case "bothActivesEnergy": {
      const ownActive = state.players[attackerSeat].active ?? attacker;
      const foeActive = state.players[otherSeat(attackerSeat)].active;
      flips =
        countAttachedEnergy(state, ownActive, null) +
        (foeActive === null ? 0 : countAttachedEnergy(state, foeActive, null));
      break;
    }
  }
  const faces: CoinFace[] = [];
  let rng = state.rngState;
  for (let flip = 0; flip < flips; flip += 1) {
    const [face, next] = flipCoin(rng);
    faces.push(face);
    rng = next;
  }
  return [faces, rng];
}

/** `cancelOnTails` takes exactly one flip and carries no `flips` field to say so
    — the member IS "flip once, then take the printed branch". Spelling that one
    flip as a value rather than a `? 1 :` branch keeps every coin printing on the
    single `takeFlips` path, so the event rows and the rngState accounting are
    written once for the whole family. */
const ONE_FLIP: AttackFlipCount = { kind: "printed", count: 1 };

/** How many coins a printed flip DECISION spends — the ONE place the whole family's
    count is resolved, so the event rows and the `rngState` accounting stay written
    once (see `ONE_FLIP` above).

    🆕🆕 **D499 — A `switch` ON THE DISCRIMINATOR WHERE A TERNARY STOOD, WHICH IS
    D474's RULE ARRIVING AT THE FUNCTION IT WAS WRITTEN ABOUT.** The shipped line was
    `coinFlip.kind === "cancelOnTails" ? ONE_FLIP : coinFlip.flips`, and it was safe
    only by a PAYLOAD COINCIDENCE: the field access on the `else` side refused any
    member without a `flips` key, so the compiler happened to be loud. D499 adds the
    SECOND count-free member and a third would still compile under the ternary the
    moment it carried a compatibly-typed `flips` it did not mean — the exact
    silent-wrong-reading D474 named at `takeFlips`. A total `switch` makes a new
    member a MISSING CASE instead, which is loud for every member shape rather than
    only for the ones whose payload happens to differ. */
function printedFlips(coinFlip: AttackCoinFlip): AttackFlipCount {
  switch (coinFlip.kind) {
    // The two CANCEL members are "flip once, then take the printed branch" — the
    // count is the member, not a field on it.
    case "cancelOnTails":
    case "cancelOnTailsElseProgram":
      return ONE_FLIP;
    case "bonusOnHeads":
    case "perHeads":
    case "programPerHeads":
    case "perHeadsThenThreshold":
      return coinFlip.flips;
  }
}

/** 🆕🆕🛑 **D429 — THE PRE-DAMAGE SEAM'S RESULT CHANNEL, AND KEEPING IT UNPARKABLE
    WAS THE DESIGN.**

    D428 returned a bare `GameState` and wrote that the SIGNATURE forbade a park.
    Two of the four printed sentences in this family condition on **what the act
    just did** — row 72's *"If you can't discard any, this attack does nothing."*
    and row 74's *"If you discarded a Pokémon Tool in this way, …is now
    Paralyzed."* — so a board alone cannot carry the answer and the return had to
    widen.

    🛑 **THE PROPERTY IS PRESERVED, AND THE REASON IS NOT "IT IS STILL ALMOST A
    `GameState`".** A park is `RunResult`'s `{ kind: "parked"; prompt; cont }`, and
    turning one into a playable board is `settleProgram`'s job — it is the PROMPT
    and the CONTINUATION that a parking member would have to hand back, not a
    modified board. This record holds a `GameState`, a `number` and a `boolean`:
    plain data the caller reads and throws away. There is no field a resolver could
    drain, no shape `settleProgram` accepts, and `AttackPreDamageResult` is not
    assignable to `ApplyResult` or `RunResult` in either direction — so a member
    that needed a player's decision remains **unwritable**, exactly as it was at
    D428, and for a reason that survives the next widening as long as the next
    widening obeys the same rule: **fields may be added when the CALLER consumes and
    discards them; never when a RESOLVER would have to drain them.**

    ⚠️ `cancelled` AND NOT A RAW COUNT FOR THE CALLER TO INTERPRET. `attack.ts`'s
    §8.5 site must not know that row 72 is the member with a cancel branch — that is
    the union's business, and a `kind` test at the call site would be D222's
    hand-spelled reader of a closed union, one arm out of date the day a fifth
    sentence prints a cancel too. So the APPLIER decides and the caller obeys.

    ⚠️ `tools` IS A COUNT AND NOT A `string[]`, AND IT COUNTS **TOOLS ONLY**. Row 74's
    printed condition is *"if you discarded a **Pokémon Tool** in this way"*, and row
    71 discards a second card class in the same act — so a single "cards moved" total
    would make a hypothetical Special-Energy-only strip satisfy a Tool consequent.
    Nothing consumes the uids (the events already carry them, and every consumer of
    those is downstream), so a list would be a field kept for nobody. */
type AttackPreDamageResult = {
  /** The board after the act — `===` the input when the act moved nothing. */
  state: GameState;
  /** How many POKÉMON TOOLS came off, which is the only quantity a printed
      consequent in this family conditions on. */
  tools: number;
  /** The member's own printed *"this attack does nothing"* branch fired. The caller
      ends the attack through `finishAttack` (§8.1 still sweeps, the turn still
      ends); `false` for every member that prints no such branch. */
  cancelled: boolean;
};

/** The act itself, shared by all four members because all four print the same verb
    over the same two zones and differ only in WHOSE body, WHICH zones, and what
    happens afterwards.

    ⚠️ **THE VICTIM'S SEAT OWNS THE DISCARD PILE**, which is `ENERGY_DISCARDED`'s
    settled convention: `seat` is whose board lost the cards and `actor` is whose card
    caused it. They are OPPOSITE for rows 71/73/74 and the SAME for row 72's
    self-strip — which is why the two are separate parameters here rather than one
    seat and an `otherSeat` call, and why row 72 is the first producer in the engine
    to file a `TOOLS_DISCARDED` whose `seat === actor`.

    ⚠️ **A BODY WITH NOTHING TO TAKE IS A SILENT NO-OP** — the state is returned
    IDENTICAL (`===`, not a rebuilt copy) and no event is pushed, because the
    `ATTACK_DECLARED` row already said the attack happened and a row saying nothing
    was discarded is a row that has to be read to learn nothing. That is
    `randomFromOpponentHand`'s empty-hand ending and `HEALED`'s never-0 rule. The
    CANCEL is reported on that same path and is the one thing a caller can still see.

    ⚠️ **TWO ZONES, TWO EVENTS, NEVER ONE.** Row 71's Tools and Special Energy leave
    together but they are different attachment kinds with different existing rows, and
    `TOOLS_DISCARDED` cannot name an Energy without lying about what a consumer may
    do with the uid. `ENERGY_DISCARDED` already carries the identical
    seat/actor/uids/host quartet plus the `from` spot, so the second zone cost a
    second push and no new event type.

    🆕🆕🛑 **D430 — THE ACTOR ARRIVES AS THE `EffectContext` AND NOT AS A BARE SEAT,
    BECAUSE THE §11 GATE NEEDS THE WHOLE CONTEXT AND TWO SPELLINGS OF "WHO IS
    ATTACKING" COULD DRIFT.** `ctx.seat` IS the actor, `ctx.invokedBy` is what arms
    the gate, and both come from the ONE record `applyAttackPreDamage` builds — so
    the seat the events name and the seat the refusal is judged against cannot
    disagree. */
function stripPreDamage(
  state: GameState,
  seat: Seat,
  ctx: EffectContext,
  events: GameEvent[],
  what: { specialEnergy: boolean; cancelIfNone: boolean },
): AttackPreDamageResult {
  const actor = ctx.seat;
  const side = state.players[seat];
  const victim = side.active;
  const nothing = { state, tools: 0, cancelled: what.cancelIfNone };
  if (victim === null) return nothing;
  const host = topUid(victim);
  if (host === undefined) return nothing;
  // 🆕🆕🛑 **D430 — §11, AND THIS SLICE EXISTS BECAUSE THIS LINE DID NOT.** A strip
  // is an EFFECT of an attack done to a Pokémon, which is precisely what a *"Prevent
  // all effects of attacks used by your opponent's Pokémon done to the Pokémon this
  // card is attached to"* shield refuses (Mist Energy `sv05-161`). Until D430 this
  // function consulted the gate NOWHERE, while row 74's Paralysis one arm over went
  // through `applyStatus` and WAS refused — two effects of ONE printed sentence, one
  // gated and one not, on a board Klefki `sv01-096`'s "Joust" reaches today. **This
  // slice buys ZERO new printings; it makes an already-built sentence obey a rule the
  // engine already had.**
  //
  // 🛑 **THE ORDERING IS `applyStatus`'s, LINE FOR LINE**: body, uid, then the gate.
  // In FRONT of every read of `tools`/`energy` and in front of both pushes, so a
  // refused strip files ONE `ATTACK_EFFECT_PREVENTED` and no `TOOLS_DISCARDED` — it
  // must not claim to have discarded anything, and it must not silently do nothing.
  //
  // 🛑 **AND THE CANCEL FALLS OUT OF `nothing` RATHER THAN BEING DECIDED HERE.** Row
  // 72's printed *"If you can't discard any, this attack does nothing."* is
  // conditioned on the ACT's result, and a refused act discarded none — so a refused
  // self-strip WOULD cancel. ⚠️ **THAT BRANCH IS UNREACHABLE, AND THE REASON IS THE
  // PRINTED SOURCE CLAUSE RATHER THAN AN ACCIDENT OF THIS FILE**: row 72's victim IS
  // the actor, and `effectRefusedOn` answers `false` whenever `seat === ctx.seat`,
  // because every §11 printing in the pool refuses only attacks *"used by your
  // opponent's Pokémon"*. No `if (seat !== actor)` is spelled here, on D222's rule —
  // a caller re-deciding what the funnel owns is the second reader that goes quiet —
  // and `preDamageRefusal.test.ts` §3 drives the own-side board both ways (the
  // attacker's OWN Mist Energy does not save its own Tool, and neither does the
  // opponent's) so the claim is executable rather than argued.
  if (effectRefused(state, seat, ctx, events)) return nothing;
  const tools = victim.tools;
  // "Special" is the CARD CLASS and not an energy TYPE (`isSpecialEnergy`, cards.ts),
  // so a Basic Energy on the same body is untouched by row 71 — the one distinction
  // an "all Energy" mis-build erases, and the reason this reads the class rather than
  // filtering on what the card provides.
  const special = what.specialEnergy
    ? victim.energy.filter((uid) => {
        const card = cardOfUid(state, uid);
        return card !== undefined && isSpecialEnergy(card);
      })
    : [];
  if (tools.length === 0 && special.length === 0) return nothing;
  // `host` is the stripped body's TOP-CARD uid and it is what a consumer must name it
  // by — `ENERGY_DISCARDED`'s reason verbatim: this attack's own damage can Knock the
  // body Out in the same batch, so re-reading "the Active spot" afterwards finds an
  // empty slot, while a uid resolves through `cardIdByUid` forever.
  if (tools.length > 0) events.push({ type: "TOOLS_DISCARDED", seat, actor, uids: tools, host });
  if (special.length > 0) {
    events.push({
      type: "ENERGY_DISCARDED",
      seat,
      actor,
      uids: special,
      from: { spot: "active" },
      host,
    });
  }
  const kept = new Set(special);
  return {
    state: withSide(state, seat, {
      ...side,
      active: {
        ...victim,
        tools: tools.length > 0 ? [] : victim.tools,
        energy: special.length > 0 ? victim.energy.filter((uid) => !kept.has(uid)) : victim.energy,
      },
      // The printed order of the noun phrase — Tools, then Special Energy — so the
      // pile reads the way the sentence does.
      discard: [...side.discard, ...tools, ...special],
    }),
    tools: tools.length,
    cancelled: false,
  };
}

/** 🆕🆕🛑 **D428/D429 — THE PRE-DAMAGE ACT: ONE FUNCTION THAT KNOWS WHAT EVERY
    MEMBER MEANS, AND A RETURN TYPE NO DECISION CAN TRAVEL DOWN.**

    It takes a board and returns `AttackPreDamageResult` — not an `ApplyResult`, not
    a `RunResult`, not anything `settleProgram` could drain. A union member that
    needed a player's decision could not be implemented against this return type, so
    *"can the pre-damage seam park?"* is answered by the compiler rather than by a
    convention or a hand-kept list of safe ops. **That is the whole reason this is
    not an `EffectOp[]` run through `runProgram` at a second call site** (effects.ts's
    `AttackPreDamage` block carries the long form): `runProgram` can hand back a
    parked state, and `attack.ts` has no continuation for *"…and then do §8.5, the
    §8.1 sweep and the epilogue"* — everything after this point is straight-line code
    and only the TAIL is expressible as `PendingStage[]`. `AttackPreDamageResult`'s
    own block states the rule that keeps this true across future widenings.

    A `switch` over the union rather than an `if` on `kind`, on D222's rule: a fifth
    member goes RED at compile time here, where a conjunction would go quiet. **All
    four arms are here and nowhere else** — the §8.5 call site tests `cancelled`,
    never `kind`, so exactly one place in the engine reads this union.

    🆕🆕 **D429 — `actorUid` IS CARRIED FOR ROW 74's CONSEQUENT AND FOR NOTHING ELSE.**
    It fills `EffectContext.sourceUid` on the one `applyStatus` call below; the strip
    itself never needs it. Passed rather than re-derived off `state.players[actor]`
    because the caller already holds the attacker's uid as of DECLARATION (`attackerUid`),
    and that is the body the sentence belongs to even if the strip empties its Tools. */
function applyAttackPreDamage(
  state: GameState,
  pre: AttackPreDamage,
  actor: Seat,
  actorUid: string,
  events: GameEvent[],
): AttackPreDamageResult {
  // 🆕🆕🛑 **D430 — ONE CONTEXT FOR THE WHOLE SEAM, BUILT HERE AND PASSED DOWN.** It
  // was constructed inline on row 74's `applyStatus` call until this slice; now the
  // §11 gate inside `stripPreDamage` needs the same record, and TWO literals spelling
  // the same four fields is the drift D427's pairing invariant exists to stop.
  //
  // ⚠️ `invokedBy: "attack"` IS LOAD-BEARING AND `dealt: 0` IS TRUE RATHER THAN
  // DECORATIVE. `effectRefusedOn` returns `false` outright unless the context says an
  // attack is doing this, so dropping the field silently disarms the gate at BOTH
  // sites at once; and D427's pairing invariant (`invokedBy === "attack"` ⇔
  // `dealt !== undefined`) is kept literally, with the honest value — no damage has
  // been dealt yet, because this is the pre-damage seam.
  const ctx: EffectContext = { seat: actor, sourceUid: actorUid, invokedBy: "attack", dealt: 0 };
  switch (pre.kind) {
    case "discardOpponentActiveTools":
      return stripPreDamage(state, otherSeat(actor), ctx, events, {
        specialEnergy: false,
        cancelIfNone: false,
      });
    case "discardOpponentActiveToolsAndSpecialEnergy":
      // Row 71. The SECOND ZONE and nothing else changes — same victim, same seat
      // convention, same silent no-op. `specialEnergy` is a CARD CLASS
      // (`isSpecialEnergy`), not an energy type, so a Basic on the same body stays
      // attached; that is the one thing an "all Energy" mis-build would get wrong
      // and it is driven as a control rather than described.
      return stripPreDamage(state, otherSeat(actor), ctx, events, {
        specialEnergy: true,
        cancelIfNone: false,
      });
    case "discardOwnToolsElseCancel":
      // Row 72. The victim is the ATTACKER's own body — `actor` on both sides of the
      // event, which is exactly the self-discard case `TOOLS_DISCARDED`'s own doc
      // block already anticipated ("the two are opposite here and the same for a
      // self-discard"). The printed *"If you can't discard any, this attack does
      // nothing."* is reported through the RESULT and executed by the caller, which
      // is the only place that can return.
      return stripPreDamage(state, actor, ctx, events, {
        specialEnergy: false,
        cancelIfNone: true,
      });
    case "discardOpponentActiveToolsThenParalyze": {
      // Row 74. The act is row 73's, byte for byte; the consequent is conditioned on
      // its RESULT — *"If you discarded a Pokémon Tool in this way"* — which is the
      // whole reason `stripPreDamage` reports what it moved instead of only a board.
      const stripped = stripPreDamage(state, otherSeat(actor), ctx, events, {
        specialEnergy: false,
        cancelIfNone: false,
      });
      if (stripped.tools === 0) return stripped;
      // 🛑 THROUGH THE INTERPRETER'S OWN `applyStatus`, NOT A SECOND
      // IMPLEMENTATION. That function owns §11's `effectRefused` (a "prevent all
      // effects of attacks done to this Pokémon" block refuses the Paralysis and
      // files ATTACK_EFFECT_PREVENTED) and §12's printed `statusImmunities`
      // (Therapeutic Energy `sv02-193` files STATUS_PREVENTED instead). Re-deriving
      // either here would be D222's second reader of one rule. It is TOTAL and
      // returns a board, so it cannot smuggle a park into a seam that forbids one.
      //
      // 🆕🆕🛑 **D430 — AND SINCE THE STRIP NOW ASKS THE SAME GATE, THE §11 REFUSAL
      // CANNOT DOUBLE, WHICH IS A PROPERTY OF THE LINE ABOVE RATHER THAN OF A CHECK.**
      // A shielded body refuses the STRIP, so `stripPreDamage` returns `tools: 0` and
      // `stripped.tools === 0` returns one line up — `applyStatus` is never reached
      // and exactly ONE `ATTACK_EFFECT_PREVENTED` is filed. Before this slice the
      // same board filed exactly one too, for the opposite and wrong reason: the Tool
      // came off unrefused and only the Paralysis was blocked. **The event count is
      // identical either way, which is precisely why nothing went red and why the
      // rung that catches it has to read the BOARD (the Tool stays attached), not the
      // event log.**
      return {
        ...stripped,
        state: applyStatus(
          stripped.state,
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          ctx,
          events,
        ),
      };
    }
  }
}

/** §8 — declare one attack with the Active Pokémon; resolving it ends the
    turn through the staged tail. The cost is a CHECK, not a payment (§8.2):
    energy stays attached unless attack text discards it (M4). */
export function attack(state: GameState, action: AttackAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  const side = state.players[action.seat];
  const active = side.active;
  if (active === null) {
    // Unreachable — promotion is forced before the next action.
    return err("NO_TARGET", "no Active Pokémon to attack with");
  }
  // §4 — the going-first player may not attack on their first turn. Turn 1
  // is by construction the first player's turn (and the gate already proved
  // the actor owns the current turn), so the turn counter IS the check; the
  // second player's first turn is turn 2 and is unrestricted.
  //
  // …unless the ACTIVE's own printed Ability licenses it: "If you go first, this
  // Pokémon can use attacks during your first turn." (Meloetta ex "Debut
  // Performance", D277). The licence is a property of the BODY, which is why this
  // check now sits BELOW the Active lookup rather than above it, and why it is
  // asked through `firstTurnAttackBanned` (continuous.ts) — the same reader
  // `redactedAttacksOf` and GameHud call, so the three payability projections of
  // one rule cannot drift.
  //
  // …and, since D281, that licence can also be printed on ONE ATTACK rather than
  // on the body ("If you go first, you can use THIS ATTACK during your first
  // turn." — Volbeat `sv06-009`, Exeggcute `sv08-001`/`-192`), so the reader now
  // takes the declared index.
  //
  // ⚠️ **IT READS `action.index` BEFORE THE INDEX HAS BEEN VALIDATED, AND THAT IS
  // WHAT KEEPS THIS GATE WHERE IT WAS.** Moving the §4 check below the
  // `BAD_ATTACK_INDEX` line would have been the tidy option and would have
  // re-ordered three earlier rejections (§4 currently outranks §12's status gate
  // and §11's lock), changing the message a player gets on boards that have
  // nothing to do with this slice. An unvalidated index is safe HERE because it is
  // only ever a record lookup: a bogus or non-integer address finds no gate, the
  // body stays banned exactly as it is today, and the complaint about the address
  // is still raised by its own check below.
  if (firstTurnAttackBanned(state, active, action.index)) {
    return err("FIRST_TURN_ATTACK", "the going-first player cannot attack on turn 1 (§4)");
  }
  // §8 step 1 / §12 — an Asleep or Paralyzed Active cannot attack at all.
  // (Confusion does NOT block declaring — it flips at resolution, below.)
  const rotation = active.conditions.rotation;
  if (isImmobilized(active.conditions)) {
    return err(
      "STATUS_PREVENTS_ATTACK",
      `${rotation === "asleep" ? "an Asleep" : "a Paralyzed"} Pokémon cannot attack (§12)`,
    );
  }
  // §8/§11 (D143) — an attack locked this Pokémon out of attacking on THIS turn.
  // Read through `attackLocked`, so the turn comparison lives in one place and
  // this site cannot drift from the HUD's projection of the same fact
  // (`redactedAttacksOf`, redact.ts).
  //
  // ⚠️ THE ATTACK THAT WROTE THE LOCK MAY HAVE BEEN THE OPPONENT'S (D148), AND
  // THIS SITE IS DELIBERATELY BLIND TO WHICH. Four printed sentences reach this
  // stamp — the holder's own drawback ("During your next turn, this Pokémon can't
  // attack.", 22 printings) and the opponent's imposition ("…the Defending Pokémon
  // can't attack.", 4) — and the gate asks the same question of the same field
  // either way. That is what makes `preventAttack.target` a fact about the OP
  // rather than about the state: the direction is spent at the install and never
  // read again, here or in either projection.
  //
  // A REJECTION, NOT AN `ATTACK_FAILED`, and the distinction is §12's: an Asleep
  // Active above cannot declare at all, while a Confused one declares and then
  // flips. This lock says "can't attack", so it belongs with the first group — the
  // action is illegal, nothing is spent and the turn does NOT end. That is also
  // the only reading a player can act on: an `ATTACK_FAILED` here would burn their
  // whole turn on a button the server had already decided to refuse.
  //
  // Placed AFTER the §12 gate and BEFORE the index/cost checks so the message a
  // player gets names the reason nearest the top of the rulebook, and so a locked
  // Pokémon reports the lock rather than "that attack costs …".
  if (attackLocked(state, active)) {
    return err("ATTACK_PREVENTED", "an attack effect stops this Pokémon attacking this turn (§11)");
  }
  // §8/§9 (D242) — …and the ALWAYS-ON gate the body's OWN printed Ability
  // imposes ("This Pokémon can't attack unless you have 4 or more Team Rocket's
  // Pokémon in play"). Read through `attackBarredByAbility` so the two payability
  // projections of the same fact (`redactedAttacksOf`, GameHud's `banned`) cannot
  // drift from it — `attackLocked`'s own rule, one line up.
  //
  // ⚠️ IMMEDIATELY AFTER THE D143 LOCK AND STILL BEFORE THE INDEX CHECK, WHICH IS
  // THE PLACEMENT ARGUMENT THAT LINE ALREADY MADE: this is a fact about the BODY,
  // not about the DECLARATION, so it can be asked before `index` has been proved
  // to name a real attack — and a player whose Pokémon may not attack at all
  // should be told that rather than "bad attack index". D154's per-attack bar sits
  // on the far side of that check for the mirror-image reason.
  //
  // AFTER rather than before the D143 lock only because a turn-scoped lock is the
  // more urgent fact: it clears by itself next turn, while this one clears only
  // when the player changes their board.
  //
  // A REJECTION, `ATTACK_PREVENTED`, NO NEW ERROR CODE — the printed words are
  // "can't attack", the action is illegal, nothing is spent and the turn does NOT
  // end, which is what that code already means twice over on this seam. What
  // differs is the MESSAGE, and it is the whole value of the reader returning the
  // condition rather than a boolean: it names the printed CLAUSE, because "you
  // can't attack" alone is unactionable on a board the player may be one Bench
  // drop away from fixing.
  //
  // ⚠️ IT NAMES THE CLAUSE AND NOT THE CURRENT COUNT, DELIBERATELY. A "(you have
  // 2)" suffix would be more useful and is not expressible here without this site
  // switching on `cond.kind` — i.e. without a second place in the codebase that
  // knows what a `BoardCondition` means. `conditionNote` is that place, it is
  // shared with the play-gate reject and the HUD tooltip, and one renderer for one
  // vocabulary is worth more than one better sentence (D131).
  const abilityGate = attackBarredByAbility(state, action.seat, active);
  if (abilityGate !== undefined) {
    return err(
      "ATTACK_PREVENTED",
      `this Pokémon's Ability stops it attacking unless ${conditionNote(abilityGate)} (§9)`,
    );
  }
  const attackerUid = topUid(active);
  const attacker = topCardOf(state, active);
  if (attackerUid === undefined || attacker === undefined) {
    return err("UNKNOWN_CARD", "no catalog card for the Active Pokémon");
  }
  const attacks = attacksOf(attacker);
  const index = action.index;
  // Wire check (types are not validation): the integer gate matters because
  // a string "0" WOULD resolve `attacks["0"]` while corrupting everything
  // downstream that does arithmetic with it; the indexed access then covers
  // range (and noUncheckedIndexedAccess types it `| undefined` anyway).
  const declared = Number.isInteger(index) ? attacks[index] : undefined;
  if (declared === undefined) {
    return err("BAD_ATTACK_INDEX", `${attacker.name} has no attack at index ${String(index)}`);
  }
  // §8/§11 (D154) — an attack barred THIS ONE attack on THIS turn ("During your
  // next turn, this Pokémon can't use {AttackName}."). Read through
  // `lockedAttackIndexes`, so the turn comparison lives in one place and this site
  // cannot drift from the two payability projections of the same fact
  // (`redactedAttacksOf` in redact.ts, and GameHud's `disabled`).
  //
  // ⚠️ IT SITS AFTER THE INDEX CHECK AND THE WHOLE-POKÉMON LOCK SITS BEFORE IT,
  // AND THAT ORDER IS THE WHOLE DIFFERENCE BETWEEN THE TWO GATES. D143's lock is a
  // fact about the BODY, so it can be asked before anything about the declaration
  // is known and reports the reason nearest the top of the rulebook. This one is a
  // fact about the DECLARATION, so it cannot be asked until `index` has been
  // proved to name a real attack — otherwise a bogus index on a barred Pokémon
  // would report the bar instead of the index, which is the wrong complaint. It is
  // still placed BEFORE the cost check, for D143's reason verbatim: a player whose
  // attack is barred should be told that, not "that attack costs …".
  //
  // A REJECTION, NOT AN `ATTACK_FAILED`, and NO NEW ERROR CODE: the printed words
  // are "can't use", the action is illegal, nothing is spent and the turn does NOT
  // end — which is exactly what `ATTACK_PREVENTED` already means one gate up. What
  // differs is the message, because what differs is what the player must do next:
  // the whole-Pokémon lock leaves them nothing to declare, while this one leaves
  // the card's OTHER attack legal and the message says so by naming the barred one.
  // ⚠️ AND SINCE D165 IT ASKS MEMBERSHIP OF A SET RATHER THAN EQUALITY WITH ONE
  // INDEX: the field has two writers (D154's self-side bar and D157's imposed
  // one) whose stamps collide from adjacent turns, so a body can carry TWO live
  // bars and this gate must refuse BOTH. As one index it refused whichever was
  // written last, and let the player use the other.
  if (lockedAttackIndexes(state, active).includes(index)) {
    return err(
      "ATTACK_PREVENTED",
      `an attack effect stops this Pokémon using ${declared.name} this turn (§11)`,
    );
  }
  // §4/§8 (D281) — …and the PRINTED TIMING CLAUSE on this one attack ("You can use
  // this attack only if you go second, and only during your first turn." —
  // Illumise/Scream Tail ex; "If you go second, you can't use this attack during
  // your first turn." — Terapagos ex ×7). Read through `attackTimingBlocked`
  // (interpreter.ts), so the two payability projections of the same fact cannot
  // drift from it — `lockedAttackIndexes`'s own rule, one gate up.
  //
  // ⚠️ **AFTER the §11 bar and not before it**, which is the placement argument
  // that gate already made, applied one step further: an installed lock is the
  // more urgent fact because it clears by itself next turn, while this one is a
  // property of the printing and never clears at all except by the clock the card
  // names. Still BEFORE the cost check, for D143's reason verbatim.
  //
  // A REJECTION, `ATTACK_PREVENTED`, NO NEW ERROR CODE — the printed words are
  // "can/can't use this attack", the action is illegal, nothing is spent and the
  // turn does NOT end, which is exactly what that code means at the three gates
  // above. The MESSAGE names the printed clause, which is the whole value of the
  // reader returning the GATE rather than a boolean: "you can't use Scream" is
  // unactionable, and "it can only be used if you go second and it is your first
  // turn" tells the player the window has closed.
  const timingGate = attackTimingBlocked(state, action.seat, active, index);
  if (timingGate !== undefined) {
    return err(
      "ATTACK_PREVENTED",
      `${declared.name} is printed with a timing clause — ${attackTimingNote(timingGate)} (§4)`,
    );
  }
  // §8.2 cost check against what the attached energies provide (basic types,
  // special-energy units incl. wildcards — continuous.ts providedEnergy),
  // under the in-play Stadium's continuous cost effects (League HQ's Basic
  // surcharge).
  const provided = providedEnergy(state, active);
  const cost = effectiveAttackCost(state, active, declared.cost ?? []);
  if (!costMet(cost, provided)) {
    return err("ATTACK_COST_UNMET", `${declared.name} costs [${cost.join(", ")}]`);
  }

  const defenderSeat = otherSeat(action.seat);
  const defenderSpot = activeTop(state, defenderSeat);
  if (defenderSpot === null) {
    // Unreachable — the KO'd side promotes (or loses) before play resumes.
    return err("NO_TARGET", "no Defending Pokémon");
  }
  const { active: declaredDefender, uid: defenderUid, card: defenderCard } = defenderSpot;
  // 🆕🆕 **D428 — REBINDABLE, AND THE REBIND IS THE WHOLE OBSERVABILITY OF THE
  // PRE-DAMAGE SEAM.** `defenderSpot` is read here, ~1,150 lines before §8.5, and
  // the object it hands back is a SNAPSHOT: `passivesOf(next, defender)`,
  // `installedReductionOf`, `seatDamageReduction`, `koSurvivalClamp` and the
  // §8.1 reads all take that OBJECT, not the seat. So a pre-damage act that strips
  // the defender's Tools into `next` and leaves this binding alone would fire its
  // event, file its log row, empty the board's `tools` array — and change NO NUMBER,
  // because every §8.5 read is still folding the pre-discard snapshot. That is
  // D407's built-but-dead defect exactly, and it is invisible to any assertion that
  // only checks the discard happened.
  //
  // ⚠️ THE `const` DESTRUCTURE IS KEPT AND A `let` ALIASES IT, rather than making
  // all three bindings `let`: `defenderUid` and `defenderCard` must NOT move (the
  // uid names the same body and the CARD is unchanged by a Tool leaving it), and
  // spelling that structurally is cheaper than a comment saying so. `defended`
  // (~950 lines down) is the same shape for the same reason, one damage step later.
  let defender = declaredDefender;
  // 🆕🆕🛑 **D429 — AND THE ATTACKER'S OWN BODY IS A SNAPSHOT TOO. IT WAS CHECKED
  // RATHER THAN ASSUMED, AND IT HAS THE DEFECT.** D428 found `defender` stale and
  // fixed it; the brief for this slice asked whether the ATTACKER object has the same
  // problem before row 72 (*"discard all Pokémon Tools from **this Pokémon**"*) starts
  // writing to it. It does, in TWO flavours, and the second is worse than D428's:
  //   · a NUMBER THAT DOES NOT MOVE — `attackerPreWRBonus(next, active, …)` folds the
  //     attacker's attached Tools through `passivesOf`, so a Vitality Band `sv01-197`
  //     discarded by row 72 still adds its +10 if §8.5 reads the pre-strip snapshot;
  //   · a STATE RESURRECTION — the §9 counterattack site spells
  //     `{ ...active, damage: active.damage + recoil }` and writes it back with
  //     `withActive`, so a stale binding **puts the discarded Tools back on the board**
  //     several hundred lines after they were filed into the discard pile. D428's
  //     defect was invisible-but-inert; this one is a duplicated physical card.
  //
  // ⚠️ A SECOND NAME RATHER THAN D428's ALIAS-THE-CONST SHAPE, AND THE REASON IS
  // ARITHMETIC. `declaredDefender` had three readers; `active` has ~17 above this line,
  // every one of them a DECLARATION-TIME gate (§4, §12, §11, the cost check, the
  // damage-scaling reads) that must keep reading the board as of declaration. Renaming
  // those to make the plain name the live one would have been a 17-site rename of code
  // this slice has no business touching. So `active` stays the declaration snapshot and
  // `attackerBody` is the post-seam binding — and the hazard that trade buys is named
  // here: **a §8.5-or-later read spelled `active` is silently stale.** The mutant
  // `D429-own-strip-not-rebound` is exactly that build.
  let attackerBody = active;

  const events: GameEvent[] = [
    { type: "ATTACK_DECLARED", seat: action.seat, uid: attackerUid, attack: declared.name, index },
  ];
  let next = state;

  // §8 step 3 — the confusion flip, AFTER every gate and the cost check
  // passed (§12): tails and the declared attack does not resolve at all —
  // no damage, no effects — the attacker takes 30 itself (possibly a
  // self-KO, prized to the defender) and the turn still ends.
  if (rotation === "confused") {
    const [face, rngState] = flipCoin(next.rngState);
    next = { ...next, rngState };
    events.push({ type: "CONFUSION_CHECK", seat: action.seat, uid: attackerUid, result: face });
    if (face === "tails") {
      events.push({
        type: "ATTACK_FAILED",
        seat: action.seat,
        uid: attackerUid,
        reason: "confusion",
      });
      // 🆕🆕🆕 **D501 — THE AMOUNT IS READ OFF THE BODY, NOT HARD-CODED.** This was a
      // literal `30` in two places from P3-M3 (2026-07-17) until D501, and the two
      // places are the whole of the observable behaviour: the DAMAGE and the ROW.
      // `SpecialConditions.confusionDamage` carries the rulebook's 3 counters for
      // every body that has never met a raising effect, so every pre-D501 board
      // answers the identical number.
      //
      // ⚠️ **THE ATTACKER'S OWN CONDITIONS, AND `active` IS THE RIGHT BINDING HERE
      // EVEN THOUGH IT IS THE DECLARATION SNAPSHOT (D429).** This block runs BEFORE
      // §8.5 and before any pre-damage act — it is §8 step 3 — so nothing has
      // rebound the body yet and `attackerBody` is still `active`. `rotation` on the
      // line above is read off the same snapshot, so a read that reached elsewhere
      // would be asking two questions of two boards.
      const confusionDamage = active.conditions.confusionDamage;
      const hurt = { ...active, damage: active.damage + confusionDamage };
      next = withActive(next, action.seat, hurt);
      events.push({
        type: "COUNTERS_PLACED",
        seat: action.seat,
        uid: attackerUid,
        amount: confusionDamage,
        source: "confusion",
      });
      // The self-hit can KO the attacker itself — prized to the DEFENDER
      // (collectKnockOuts owes each KO's prize to the KO'd side's opponent). The
      // epilogue sweeps both boards; the defender took no damage on this failed
      // attack, so only the attacker's own board can be lethal here.
      return finishAttack(next, events, action.seat, attackerUid, declared.name);
    }
  }

  // Coverage strategy (simulator.md): the mechanical part of the attack
  // (numeric damage, weakness/resistance) is simulated, and effect text
  // derives into executable steps for exactly the sentence shapes effects.ts
  // recognizes — anything else (and every damage marker like "60+", M4's
  // effect ops) is flagged loudly instead of guessed.
  const { base, modifier } = parseAttackDamage(declared.damage);
  // 🛑 D282 — THE SPLIT ANCHOR, AND IT IS ONE REBIND RATHER THAN SEVEN WIDENINGS.
  // D281 built `CardProgram.attackGate` and enforced it at the §4/§8 declaration
  // seam above; from here down the gate clause is SPENT — it has already decided
  // whether this attack may be declared at all, and every reader below is
  // whole-sentence anchored, so leaving it on the front of the string is what kept
  // 13 printings (Terapagos ex ×7 among them) on the loud ATTACK_EFFECT_SKIPPED
  // path with half their sentence resolved and the other half invisible.
  //
  // ⚠️ THE GATE IS THE PRECONDITION, NOT THE TEXT. `splitAttackGateClause` will
  // recognise the printed clause on ANY string; this line only lets it fire when
  // `attackGateOf` says the attacking body's program actually CARRIES a gate at
  // THIS index. A printing whose clause is not represented keeps its whole
  // printed string and stays loud — the pre-D282 behaviour, byte for byte, and
  // the direction a "too loose" build fails in (D278/D279's standing lesson).
  //
  // 🆕🆕 **D444 — AND THAT PRECONDITION IS NOW A TAUTOLOGY, WHICH IS DECLARED RATHER
  // THAN DISCOVERED.** `attackGateOf` became `registry ?? timingGateFromAttackText`
  // and the clause→gate map is TOTAL over `ATTACK_GATE_CLAUSES`, so
  // `splitAttackGateClause(printedEffect) !== null` now IMPLIES
  // `attackGateOf(…) !== undefined`: no printed string can reach this line, split,
  // and find no gate behind it. **THE CHECK IS KEPT ANYWAY, AS DEFENCE IN DEPTH**,
  // because it is the only thing that keeps the split honest if the derivation is
  // ever narrowed — a `Partial` map, a clause deliberately left unclassified, a
  // second caller that splits without asking. `D282-split-fires-without-a-gate` is
  // therefore re-declared `survives: equivalent` with exactly that argument, and a
  // declared survivor that gets KILLED reports `STALE-SURVIVOR` and fails the run —
  // so narrowing the derivation is loud rather than quiet (D427).
  //
  // ⚠️ Through `attackGateOf` rather than `programFor(attacker.id)?.attackGate`:
  // that function is the ONE answer to "what gate is on this body at this index"
  // (D159), it reads the TOP card the same way `authored` below does, and it is
  // §9-blind on purpose — so a Klefki that suppresses nothing here cannot make
  // this seam disagree with the gate that already ran.
  //
  // The rebind is deliberately BEFORE every reader AND before the
  // ATTACK_EFFECT_SKIPPED report, so an unresolved remainder is reported as the
  // BODY sentence alone (Illumise, Scream Tail ex, Exeggcute) — naming the half
  // this engine still cannot read instead of the whole compound it half can.
  const printedEffect = declared.effect ?? null;
  const gateSplit =
    printedEffect === null || attackGateOf(state, active, index) === undefined
      ? null
      : splitAttackGateClause(printedEffect);
  // 🆕🆕 D395 — `gateSplit.body` IS `""` FOR A CLAUSE-ONLY PRINTING (Miltank
  // `sv08.5-081` idx 1, whose whole printed effect text is the gate clause), and
  // that flows through unchanged because every site below already spells "no text"
  // as `=== null || === ""` — the requirement split, all four damage readers and
  // the ATTACK_EFFECT_SKIPPED block itself. So the report the split exists to make
  // honest is not made at all here, which is the right answer: the engine enforced
  // the whole sentence at the §8 seam and has nothing left to skip.
  const gated = gateSplit === null ? printedEffect : gateSplit.body;
  // 🆕🆕 D363 — THE SECOND SPLIT, AND IT IS READ BEFORE IT IS SPENT rather than
  // after. D282's gate clause was already discharged at the declaration seam when
  // the rebind happened; this one is discharged HERE, by the very next line — so
  // the requirement is read off the UNSPLIT string and only the readers BELOW see
  // the body. Getting that order backwards would read the requirement off the
  // companion sentence and cancel nothing.
  //
  // ⚠️ `splitAttackRequirementClause` fires only when the leading clause resolves
  // to an `ATTACK_REQUIREMENT_CLAUSES` row, so what it removes is always
  // something `requirement` below has just answered. An unmapped does-nothing
  // sentence keeps its whole string and stays loud, exactly as before D363.
  //
  // ONE printing family reaches this today — Sawk `sv10.5w-049`/`-130`, whose
  // trailing "This attack's damage isn't affected by Weakness or Resistance."
  // `deriveAttackDamageSuppression` has read since D192 and could never be given.
  // Measured pool-wide: 2 rows in 978 cards / 6 sets carry a leading does-nothing sentence
  // with any trailing text at all, and both are that card.
  //
  // 🆕🆕 D364 — **THE ORDER OF THESE TWO SPLITS IS A COMMITMENT, AND NOTHING
  // PRINTED CAN CURRENTLY REVEAL IT.** Re-measured over all 1,732 legal attack
  // units: `splitAttackGateClause` claims 14 (13 until D395 added the clause-only
  // Miltank `sv08.5-081` row), `splitAttackRequirementClause`
  // claims 2, and **0 units are claimed by both** — the two strippers are DISJOINT
  // on the catalog, so running them in either order answers every printed string
  // identically. That is exactly why a `splitHead` that loops over a sentence list
  // stays refused: it would be scaffolding for a population of zero (D282's
  // refusal, re-derived rather than inherited).
  //
  // ⚠️ The order below is still the RIGHT one and is asserted rather than assumed.
  // On a compound carrying both clauses the two orders DISAGREE: gate-then-
  // requirement resolves it completely, requirement-then-gate resolves neither,
  // because the requirement split's LAZY clause group runs past the gate sentence
  // and its accounting guard then refuses the unmapped result. Both orders fail
  // in the SAFE direction — the residue is a superstring either way, so no
  // printed sentence can be silently deleted by getting this wrong.
  // `splitOrder.test.ts` §2/§3 drive all of it, including the disjointness as a
  // TRIPWIRE that reddens by name the day a printing carries both.
  const requirementSplit =
    gated === null || gated === "" ? null : splitAttackRequirementClause(gated);
  // D125 — the printed "If <clause>, this attack does nothing." REQUIREMENT: the
  // board fact the attack needs, or null when the text is not that sentence. It
  // is a third reader of the same effect string, disjoint from the two scaling
  // ones by CONSEQUENT ("nothing" versus "N more damage" / "for each"), so at
  // most one of the three ever fires on a given attack. 🆕 D363 — read off
  // `gated`, NOT off `effect`: the reader's own anchor tolerates a trailing
  // companion now, and `effect` is that companion once a split has fired.
  const leadingRequirement =
    gated === null || gated === "" ? null : deriveAttackRequirement(gated);
  const composed = requirementSplit === null ? gated : requirementSplit.body;
  // 🆕🆕 D417 — THE FOURTH SPLIT, AND THE SECOND POINTED AT THE *TRAILING* END OF
  // THE SENTENCE — but unlike D409's it strips a clause that is SPENT rather than
  // composing one that still has to be read. `splitAttackCancelClause` takes the
  // printed *"If you can't, this attack does nothing."* off the BACK; the clause is
  // discharged by `deriveAttackCancelRequirement` on the very next line, off the
  // UNSPLIT string, exactly as D363 reads its leading clause before spending it.
  //
  // 🛑 THE READING LANDS ON D125's GATE AND NOWHERE ELSE, WHICH IS WHY THIS IS A
  // `requirement` AND NOT AN `EffectOp`. The printed words are "this attack does
  // nothing", so nothing is what may happen — no damage, no W/R, no effect ops, no
  // triggers — and an effect PROGRAM runs at this function's TAIL, strictly after
  // the §8.5 pipeline, where no op can retract damage already dealt. D125's rule:
  // a derived shape is classified by WHERE IN RESOLUTION IT LANDS, not by how its
  // sentence reads. The gate below is byte-unchanged; only the value it reads grew
  // a second source.
  //
  // ⚠️ `splitAttackCancelClause` fires only when the HEAD sentence resolves to an
  // `ATTACK_CANCEL_HEADS` row, so what it removes is always something
  // `cancelRequirement` has just answered. An unmapped trailing cancel keeps its
  // whole string, every reader refuses the compound, and ATTACK_EFFECT_SKIPPED
  // names it — the pre-D417 behaviour byte for byte, and the direction a wrong
  // build fails in.
  //
  // ⚠️ AND THE ORDER AMONG THE FOUR STRIPPERS IS UNOBSERVABLE ON THE CATALOG.
  // Measured over all 1,732 legal attack units, all six pairs are DISJOINT — 0
  // units are claimed by any two — so this could sit anywhere in the chain and
  // answer every printed string identically. It sits HERE, between the leading
  // strip and D409's composition, because that is printed order: front clause off
  // first, back clause off next, and what is left is the compound D409 composes.
  // `splitOrder.test.ts` §6 pins the whole matrix as a tripwire that reddens by
  // name the day a printing carries two.
  const cancelSplit =
    composed === null || composed === "" ? null : splitAttackCancelClause(composed);
  const cancelRequirement =
    composed === null || composed === "" ? null : deriveAttackCancelRequirement(composed);
  // 🆕🆕 D417 — ONE `requirement`, TWO READERS, and the gate below is untouched.
  // The two are mutually exclusive by their own anchors (`^If …` versus `… If you
  // can't,$`), so the `??` is a JOIN and never a precedence: no printed string can
  // make both non-null, which `cancelClause.test.ts` §2 drives over the whole
  // legal column rather than asserting here in prose.
  const requirement = leadingRequirement ?? cancelRequirement;
  const uncancelled = cancelSplit === null ? composed : cancelSplit.head;
  // 🆕🆕 D409 — THE THIRD SPLIT, AND THE FIRST ONE POINTED AT THE *TRAILING* END OF
  // THE SENTENCE. D282's gate clause and D363's requirement clause both come off
  // the FRONT and are SPENT by the time the readers below run; this one comes off
  // the BACK and is not spent at all — it is a second half that must still be
  // READ, which is why this is a composition rather than a strip.
  //
  // `splitAttackTrailingClause` fires only when NO reader claims the whole printed
  // string, the trailing clause is one `deriveAttackEffect` claims, and the head is
  // claimed by some reader. So `effect` below is the head, every reader keeps
  // reading exactly the string it read before on all 629 other sentences of the
  // legal column, and the tail is appended to the program by the ONE line at
  // `derivedTail`. Measured over that column: the predicate admits 5 sentences /
  // 11 printings and nothing else.
  //
  // ⚠️ THE REBIND IS DELIBERATELY ABOVE ALL FIVE DAMAGE READERS AND NOT JUST ABOVE
  // `derived`. Two of the five printed compounds put a `deriveAttackDamageBonus`
  // clause in FRONT of the effect clause (8 of the 11 printings), so the head is
  // what the bonus reader has to see; leaving `effect` on the whole compound would
  // resolve the discard and silently drop the "+50 for each Prize card" fold — the
  // COST without the payoff, in the direction that loses damage rather than the
  // direction that flags it.
  //
  // ⚠️ AND NOTHING IN THE THREE DISJUNCTION CHAINS BELOW MOVES. When this split
  // fires the tail is a claimed effect, so `derived` is non-null, so `program` is
  // non-null and `effectSimulated`'s FIRST term already carries it; the two Prize
  // compounds additionally carry `scaling`, which is `modifierSimulated`'s first
  // term. The skip report is therefore not reached at all on any of the eleven
  // printings, which is why it may keep reporting `effect` (the head) unchanged.
  const compoundSplit =
    uncancelled === null || uncancelled === "" ? null : splitAttackTrailingClause(uncancelled);
  const effect = compoundSplit === null ? uncancelled : compoundSplit.head;
  // Registry ABOVE the deriver (D8): an authored attack program wins; else the
  // text deriver; else null (unsimulated). Authored programs are keyed by ATTACK
  // INDEX — a card authors only the attacks the deriver does not read, the rest
  // fall through. Chien-Pao ex "Hail Blade" (sv02-061 idx 0, D96) was the first;
  // Mewtwo VSTAR "Psy Purge" (swsh10.5-031 idx 0, D97) the second, and the first
  // on a MULTI-attack card — its idx-1 "Star Raid" must NOT inherit Psy Purge's
  // program, which is WHY the seam is index-keyed.
  //
  // 🆕🆕 D402 — THE WORD "REFUSES" CAME OUT OF THE SENTENCE ABOVE, AND THE
  // PRECEDENCE IS WHY THIS LINE STILL NEEDS NO BRANCH. Both of the two examples
  // it names are now read by `deriveAttackEffect` as well, into the IDENTICAL
  // program (`ENERGY_DISCARD_SCALED_DAMAGE`, effects.ts) — so "authored" and
  // "derivable" have stopped being exclusive, and the `??` below is what makes
  // that a non-event rather than a conflict: the row wins, the deriver is never
  // asked, and the two suites assert the agreement instead of a null.
  const authored = programFor(attacker.id)?.attack?.[index] ?? null;
  const derivedHead = effect === null || effect === "" ? null : deriveAttackEffect(effect);
  // 🆕🆕 D409 — THE COMPOSITION SITE, AND IT IS ONE CONCATENATION IN PRINTED ORDER.
  // `derivedHead` is null on the two Prize compounds (their head is a damage-bonus
  // clause `deriveAttackEffect` refuses) and non-null on the other three, and the
  // `??  []` is what makes those two cases one line rather than a branch. The order
  // is the PRINTED order — head first — because that is the order the card reads in
  // and the only order §8.5's fold and the post-damage ops agree on.
  const derivedTail = compoundSplit === null ? null : deriveAttackEffect(compoundSplit.tail);
  const derived =
    derivedTail === null ? derivedHead : [...(derivedHead ?? []), ...derivedTail];
  // REASSIGNABLE since D130, and only from the flip block below: a
  // `programPerHeads` coin member is expanded into one copy of its ops per flip that
  // came up on the member's printed `face` (D476) and APPENDED here, so the attack's
  // existing tail runs them with no new channel.
  // Nothing else in this function writes it.
  let program = authored ?? derived;
  // 🆕🆕 **D428 — THE PRE-DAMAGE READER, AND IT IS DELIBERATELY NOT `program`.**
  // *"Before doing damage, discard all Pokémon Tools from your opponent's Active
  // Pokémon."* (5 legal printings). Read off `effect` — the fully-split head, the
  // same string `derivedHead` above is read off — and kept in its OWN binding
  // because it lands in a different place in resolution: `program` runs at this
  // function's TAIL, this runs in FRONT of §8.5. D125's rule, and effects.ts's
  // `AttackPreDamage` block has the argument for why an `EffectOp[]` could not
  // carry it (a pre-damage program may PARK, and there is no continuation for the
  // rest of the damage step).
  //
  // ⚠️ ONE `preDamage` AND ONE `program` CAN NEVER BOTH BE NON-NULL ON A PRINTED
  // STRING TODAY — the readers are whole-sentence anchored and disjoint by
  // construction — so nothing here has to decide an order between them. That is a
  // fact about the anchors, not a property worth depending on, which is why the
  // hook below is placed by the RULE (before §8.5) rather than by what the pool
  // happens to print.
  const preDamage = effect === null || effect === "" ? null : deriveAttackPreDamage(effect);
  // The count-scaling clause reads the SAME effect text but folds into the damage
  // BEFORE the §8.5 pipeline, unlike a post-damage program. THREE sibling families,
  // told apart by ONE adjective: ADDITIVE ("more") folds `per × count` onto the
  // printed base; MULTIPLY (no adjective) makes `per × count` the WHOLE damage, the
  // printed base dropped; SUBTRACTIVE ("less", D163) keeps the printed base and
  // takes `per × count` OFF it. Their regexes are mutually exclusive, so at most
  // one fires — each is read only when its predecessors did not, making that
  // explicit. A card carries at most one scaling clause OR a program: the
  // whole-sentence anchor means a scaling sentence never also derives an op.
  //
  // D167 — the adjective really is the WHOLE discriminator, and the case that
  // proves it is the one where all three families read the SAME count source:
  // "This attack does {N} {more|less|} damage for each damage counter on this
  // Pokémon." is three real printed sentences (Paldean Tauros sv02-028 / Cetitan
  // sv01-060 / Drifloon sv01-089) differing in one word, and they take three
  // different folds out of this block. Nothing here moved to admit the third — the
  // multiply reader gained an arm, and `scaling`, `scaledBase` and both
  // simulated-flags below were already written against the READER rather than
  // against its `count` member.
  const damageBonus = effect === null || effect === "" ? null : deriveAttackDamageBonus(effect);
  const damageMultiplier =
    damageBonus !== null || effect === null || effect === ""
      ? null
      : deriveAttackDamageMultiplier(effect);
  // D163 — "This attack does {10|20} less damage for each damage counter on this
  // Pokémon." (Skeledirge ex sv02-037/-233/-258/-272 "Burning Voice" idx 1,
  // Cetitan sv01-060 "Sweeping Tackle" idx 1). Deliberately NOT folded into
  // `scaling` below: that variable feeds `scaled`, which is the ADDING half of the
  // pre-W/R step and is reported through `DAMAGE_DEALT.scaled`. This number is the
  // SUBTRACTING half of the same step and is reported through `debuff` beside
  // D149's installed weakener — see the `debuff` term in the pipeline below, where
  // the choice is argued.
  //
  // 🆕🆕 D438 — …AND THE SAME READER NOW ALSO ANSWERS "This attack does {30|50}
  // less damage for each {C} in your opponent's Active Pokémon's Retreat Cost."
  // (corpus rows 573/603, 2 sentences / 3 legal printings; the card ids are
  // UNRESOLVED in this checkout, which has no D1, and are not guessed). NOTHING
  // HERE MOVED TO ADMIT IT: `scaling`, the guard ladder, the fold below and the
  // reported field were all written against the READER rather than against its
  // `count` member — D167's finding, holding for the fourth time.
  //
  // ⚠️ **THE COUNT IS NO LONGER ALWAYS THE ATTACKER'S OWN BODY, WHICH IS WHY THE
  // LOCAL BELOW IS `printedPenalty` AND NOT `selfPenalty` ANY MORE.** The name it
  // carried from D163 to D437 described the COUNT SOURCE by accident and the
  // printed clause by intent; with `opponentActiveRetreatCost` on the same reader
  // the first reading became false, and a successor reading `selfPenalty` would
  // have assumed the number is priced off the attacker (D429's rule — write the
  // property, not the shape that happens to have it).
  const damagePenalty =
    damageBonus !== null || damageMultiplier !== null || effect === null || effect === ""
      ? null
      : deriveAttackDamagePenalty(effect);
  // D192 — the FOURTH reader of the same effect text, and the first that parses
  // WHICH §8.5 STEPS ARE SKIPPED rather than `per × count` arithmetic: "This
  // attack's damage isn't affected by {Weakness or Resistance{, or by any effects
  // on your opponent's Active Pokémon}|Resistance|any effects on your opponent's
  // Active Pokémon}." — 34 Standard-legal printings over the four fully anchored
  // sentences (15 + 9 + 8 + 2), measured against the remote D1 on 2026-08-04.
  //
  // NOT chained onto the `damageBonus !== null || …` ladder above it, and that is
  // the one placement decision here. The three scaling readers exclude each other
  // because their sentences are three spellings of ONE printed clause and a card
  // can only carry one; this sentence is a DIFFERENT clause at a different step,
  // and the pool prints it as a trailing rider on a compound whose leading half is
  // a scaling clause (see the deferred riders below). Reading it unconditionally
  // keeps the door open for that; short-circuiting it would have to be undone.
  //
  // ⚠️ 🆕 D363 — FOUR OF THE FIVE RIDER-ON-COMPOUND PRINTINGS ARE STILL DEFERRED
  // AND PINNED; THE FIFTH IS BUILT, AND NOT BY LOOSENING THIS READER. Sawk's "If
  // your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.
  // This attack's damage isn't affected by Weakness or Resistance." (2 legal) now
  // reaches this line because `requirementSplit` above hands it the SECOND
  // sentence alone — `DAMAGE_SUPPRESSION` is byte-unchanged and still refuses the
  // compound whole, which `damageSuppression.test.ts` asserts on all five. The
  // block below is the standing list with that one struck through:
  // "…this attack does 70 more damage. …isn't affected by Weakness." (1), "…for
  // each damage counter on all of your Benched Cynthia's Pokémon. …isn't affected
  // by Weakness." (1) and "…80 damage … for each tails. …Weakness or Resistance."
  // (1). Every deriver in this engine is anchored on the string it is GIVEN —
  // leading and trailing text falls to the loud ATTACK_EFFECT_SKIPPED path — so
  // admitting them means a COMPOSITION seam, not a looser regex. 🆕 D363 built
  // the narrowest possible one: a SPLIT that produces a different string for a
  // clause the requirement table already answers, which is the shape D282 proved
  // and NOT a sentence-list parser. The remaining 4 are each blocked on their own
  // LEADING half, which no split of this family removes, so they stay deferred.
  // A search-style pattern would still silently claim the whole compound.
  //
  // 🛑🛑 D479 — *"blocked on their own LEADING half"* IS NOW FALSE FOR ONE OF THE FOUR,
  // AND IT ROTTED RATHER THAN BEING WRONG WHEN WRITTEN. Measured at this head by
  // driving the derivers on each half: the Cynthia row's leading half — "This attack
  // does 10 damage for each damage counter on all of your Benched Cynthia's Pokémon."
  // — BUILDS, `deriveAttackDamageMultiplier` → `{per:10,count:{kind:
  // "damageCountersOnYourBench",filter:{kind:"ownerPokemon",owner:"Cynthia"}}}`, and
  // the census reports it as a `COMPOUND-head` whose KEPT segment resolves. Its
  // blocker is entirely on the TAIL and is `deriveAttackDamageSuppression`'s own
  // (`DAMAGE_SUPPRESSION` has no bare-`Weakness` arm, and `splitAttackTrailingClause`
  // demands a `deriveAttackEffect` tail) — which is what `effects.ts`'s block on that
  // reader says, correctly, and this line contradicted it for a whole family.
  //
  // 🆕🆕🆕 D493 — THE CYNTHIA ROW IS BUILT, AND NOT BY A COMPOSITION SEAM. The paragraph
  // above says admitting these means *"a COMPOSITION seam, not a looser regex"*. That
  // is a claim about the FAMILY and it was false for this member, which is D463's rule
  // again — a refusal that groups N rows under ONE reason is N refusals. Measured at
  // D493's head: teaching `splitAttackTrailingClause` to take a suppression tail frees
  // **0 sentences / 0 printings** on its own (this row's tail is refused by all
  // thirteen readers, so there is nothing to compose), and freeing it needs the
  // VOCABULARY as well — at which point the pair frees exactly **1 sentence / 1
  // printing**, the same row a whole-sentence anchor frees for less. So the seam was
  // priced against the anchor and the anchor won: `BENCH_COUNTER_FILTERED_SUPPRESSED`
  // in effects.ts is read by `deriveAttackDamageMultiplier` for the fold and by
  // `deriveAttackDamageSuppression` for the §8.5 step, both off THIS line's `effect`
  // string, and this file is BYTE-UNCHANGED apart from these comments.
  // ⚠️ AND THE OTHER THREE STAY DEFERRED, each for a reason measured separately rather
  // than shared: Sawk's is BUILT (through `requirementSplit` above, since D363), and
  // the remaining two are blocked on their own LEADING halves, which is the clause
  // below and is still true of exactly those two.
  //
  // 🆕🆕🆕 **D494 — "EXACTLY THOSE TWO" IS NOW EXACTLY ONE, AND THE SENTENCE ABOVE IS
  // KEPT AS THE RECORD OF A PRICE THAT CAME TRUE RATHER THAN DELETED (D442/D466).**
  // The paragraph above was a MEASUREMENT and it was correct at D493's head: *"If you
  // have 3 or more Energy in play, this attack does 70 more damage."* derived to `null`
  // under all thirteen readers, so no split and no compound anchor could reach the row.
  // D494 removed that blocker rather than working around it — one clause row
  // (*"you have 3 or more Energy in play"* → `yourEnergyInPlayAtLeast` with the member's
  // `energy` field widened to admit `null`, which is `countEnergyInPlay`'s own untyped
  // arm) plus one SECOND whole-sentence anchor, `CONDITIONAL_BONUS_SUPPRESSED`, read by
  // `deriveAttackDamageBonus` for the fold and by `deriveAttackDamageSuppression` for
  // the §8.5 step, both off THIS line's `effect` string. **THIS FILE IS AGAIN
  // BYTE-UNCHANGED apart from these comments**, for the same reason D493 was: the
  // suppression is not chained onto the `damageBonus !== null` ladder, so a sentence
  // both readers claim simply reaches both bindings.
  //
  // ⚠️ **THE ONE STILL DEFERRED IS THE COIN ROW, AND ITS LEADING HALF REALLY DOES
  // REFUSE** — measured at D494's head, not carried:
  // "Your opponent flips a coin for each of their Benched Pokémon. This attack
  // does 80 damage to your opponent's Active Pokémon for each tails." → null.
  // The Energy-in-play row's head now derives (`deriveAttackDamageBonus`), and
  // `energyInPlaySuppressed.test.ts` §3 is where that is asserted.
  // ⚠️ D463's rule, paying out: A REFUSAL THAT GROUPS N ROWS UNDER ONE REASON IS N
  // REFUSALS UNTIL EACH IS PRICED. Three of these four were priced by that sentence
  // and one was not, and nothing went red when the un-priced one changed sides.
  // The absence is measured, asserted in damageSuppression.test.ts, and is also
  // the reason `weakness` below is its OWN boolean: two of those five print
  // "…isn't affected by Weakness." with no Resistance beside it.
  const damageSuppression =
    effect === null || effect === "" ? null : deriveAttackDamageSuppression(effect);
  const scaling = damageBonus ?? damageMultiplier;
  const scaled =
    scaling === null
      ? 0
      : scaledAttackDamage(active, scaling, next, defenderSeat, action.seat, cost);
  // `per × count` off the SAME evaluator the two adding readers use (D159's rule —
  // no second answer to a question the engine already answers), counted at
  // DECLARATION like every other member of the family, so this attack's own damage
  // cannot bootstrap the counters it reads.
  const printedPenalty =
    damagePenalty === null
      ? 0
      : scaledAttackDamage(active, damagePenalty, next, defenderSeat, action.seat, cost);
  // D125's REQUIREMENT is read at the split above, not here — see `requirement`.
  // D126/D127 — the printed coin flip the attack itself calls for: a `bonusOnHeads`
  // that adds its printed N to this attack's own damage, a `cancelOnTails` that
  // cancels the attack outright, a `perHeads` that folds N flips into `per × heads`,
  // or null when the text is none of those sentences. A FOURTH reader of the same
  // effect string, disjoint from the other three by its leading flip sentence (which
  // denies them their `^If` anchor) and from `deriveAttackEffect`'s `coinFlipGate`
  // programs by its CONSEQUENT — "this attack does N more damage" / "does nothing" /
  // "does D damage for each heads" is neither a status nor a search, so the 16 "If
  // heads, … is now Paralyzed." printings stay on the program path and are never
  // read twice. The union's members are mutually exclusive by construction, which
  // is what makes "at most one flip DECISION per attack" structural rather than a
  // rule this function has to keep.
  const coinFlip = effect === null || effect === "" ? null : deriveAttackCoinFlip(effect);
  // 🆕 D316 — the printed "You may do {N} more damage. If you do, …": the FIFTH
  // reader of the same effect string and the first whose reading needs a number
  // this function owns. Disjoint from the other four by its leading words (the
  // whole sentence begins "You may do", which denies every one of them their own
  // `^` anchor), so at most one of the five ever fires on a given attack — the
  // property that makes the terms below sums rather than choices. The PROGRAM is
  // assembled at the coin block's site further down, where `base` is in scope.
  const optionalBoost = effect === null || effect === "" ? null : deriveAttackOptionalBoost(effect);
  // 🆕 D317 — the printed "…this attack does {N} more damage, and {consequent}":
  // the SIXTH reader read at this site and the NINTH overall, and it is the reader
  // directly above with the PLAYER TAKEN OUT OF THE DECISION — a board fact
  // (Hearthflame Mask Ogerpon ex ×5) or a coin (Floragato ×1) decides it instead
  // of a confirm. Disjoint from all eight: the two damage-scaling readers and the
  // coin family are denied by the trailing ", and …" their own `\.$` anchors
  // refuse, `deriveAttackEffect` by the leading damage clause, and the confirm
  // reader by its "You may do". So at most one of the six read here ever fires,
  // which is what keeps the terms below SUMS rather than choices. The PROGRAM is
  // assembled at the coin block's site further down, where `base` is in scope.
  const bonusConsequent =
    effect === null || effect === "" ? null : deriveAttackBonusConsequent(effect);
  // 🆕🆕 D381 — the printed "You may {cost}. If you do, {payoff}": the SEVENTH
  // reader read at this site and the TENTH overall, and it is the reader two above
  // with its two halves SWAPPED — the antecedent is the COST and the consequent is
  // the extra damage it buys. Disjoint from all nine, and the ONE it does not
  // separate from by its leading words is `deriveAttackOptionalBoost`, which shares
  // "You may " with it: `OPTIONAL_DAMAGE_BOOST` reads "You may do {N} more damage."
  // and no printed cost in this family spells that, so at most one of the seven
  // read here ever fires — the property that keeps the terms below SUMS rather than
  // choices. The PROGRAM is assembled at the coin block's site further down, where
  // `base` is in scope.
  const optionalCostBoost =
    effect === null || effect === "" ? null : deriveAttackOptionalCostBoost(effect);
  // 🆕🆕 D403 — the printed "You may discard up to {N} [Basic] Energy from your
  // Benched Pokémon. This attack does {P} more damage for each card you discarded in
  // this way.": the EIGHTH reader read at this site and the ELEVENTH overall, and it
  // is D402's arm with the FOLD changed — the §9.2 `discarded` record read as an
  // ADDEND on the printed base rather than as the whole hit. Disjoint from all ten,
  // and the ONE it does not separate from by its leading words is the pair above,
  // which share "You may " with it: `OPTIONAL_DAMAGE_BOOST` reads "You may do {N}
  // more damage." and `OPTIONAL_COST_BOOST` requires a printed "If you do,", neither
  // of which this sentence spells. So at most one of the eight read here ever fires —
  // the property that keeps the terms below SUMS rather than choices. The PROGRAM is
  // assembled at the coin block's site further down, where `base` is in scope.
  const discardScaledBoost =
    effect === null || effect === "" ? null : deriveAttackDiscardScaledBoost(effect);
  // A program that DEALS the main damage itself owns the printed number the same
  // way the multiply family does — Chien-Pao ex "Hail Blade" is "60×" (base 60,
  // modifier "×"), but its 60-per-discarded-card is dealt from INSIDE the program
  // (damageDefender, after the mid-attack discard the number depends on), so the
  // base must not ALSO land pre-program. The scaling readers can't carry it: the
  // count is a mid-attack choice, not a board fact at declaration.
  //
  // ⚠️ D228 — AND `damageNewActive` DELIBERATELY DOES **NOT** JOIN THIS TEST,
  // WHICH IS THE WHOLE REASON IT IS A SECOND OP RATHER THAN A WIDENED
  // `damageDefender`. The rule above is "drop the base when the program already
  // owns the printed number"; that op's number IS the printed base read back
  // (Hail Blade's "60×"), while this one is an ADDITIONAL printed number aimed at
  // a body the main hit never touched — "…This attack does 30 damage to the NEW
  // Active Pokémon." A printing carrying both would owe both hits, so claiming
  // the base here would silently delete one of them.
  //
  // NO BOARD IN THE POOL CAN TELL THE TWO ANSWERS APART: all 8 legal printings of
  // that sentence print no `damage` field at all (measured over the remote D1,
  // 2026-08-05), so `base` is 0 on every one of them and both readings agree.
  // Written from the rule rather than from what a test would notice — D130's
  // precedent on `programPerHeads`, verbatim and for the same reason.
  const programDamage = program?.some((step) => step.op === "damageDefender") ?? false;
  // The multiply family's printed "N×" base IS the per-unit (already counted in
  // `scaled`), so it is dropped from the pipeline — the additive family keeps its
  // printed base. count 0 → scaled 0 → no damage (the base does not leak through).
  // A program that owns the damage drops the base for the same reason.
  //
  // D127 — `perHeads` is a THIRD claimant on the same rule, and it is the coin
  // family's first: all 22 printings carry a "D×" marker whose D is the per-heads
  // amount, so Tandemaus's "30×" on two heads is 60, not 30 + 60. Its sibling
  // `bonusOnHeads` is printed "10+" and keeps its base — the marker is exactly what
  // separates them, which is why they are two union members and not one.
  //
  // D130 — `programPerHeads` is NOT a fourth claimant and the test names
  // `perHeads` rather than "any folding member" for exactly that reason. The rule
  // is "drop the base when something else already owns the printed number", and
  // this member owns nothing: it folds no damage at all, so there is no per-unit
  // for the base to be a duplicate of. It therefore KEEPS the base, like
  // `bonusOnHeads` and like a plain attack. Both of its printings have no `damage`
  // field whatsoever (base 0), so no swept board can tell the two answers apart —
  // which is precisely why the branch is written from the rule rather than from
  // what a test would notice.
  //
  // 🆕 D316 — A FOURTH CLAIMANT, AND IT IS `programDamage`'s RULE REACHED THROUGH
  // A READER RATHER THAN THROUGH A TOP-LEVEL OP. The optional boost's whole hit is
  // dealt by a `damageDefender` NESTED inside the `optional` this function builds
  // below, and `programDamage`'s `some` walks the top level only — deliberately,
  // since a gate's arms are not all going to run. So the drop is claimed HERE, off
  // the reading, which is also the honest place: the reader is what knows the
  // printed number has been re-homed. Leaving it out would deal the base pre-
  // program AND again inside it, which is the double hit effects.ts refuses.
  //
  // 🆕 D317 — A FIFTH CLAIMANT, AND IT IS THE FOURTH ONE'S ARGUMENT VERBATIM.
  // The bonus-plus-consequent sentence's whole hit is dealt by `damageDefender`s
  // NESTED inside the `conditionGate` / `coinFlipGate` this function builds below,
  // and `programDamage`'s `some` walks the top level only — so the drop is claimed
  // HERE, off the reading, which is again the honest place: the reader is what
  // knows the printed number has been re-homed. Leaving it out would deal the base
  // pre-program AND again inside the gate, on BOTH arms.
  // 🆕🆕 D383 — THE EXCEPTION NAMED RATHER THAN INLINED, `coinExplainsModifier`'s
  // idiom two blocks down and for its reason: the reversed reading's TWO payoffs
  // answer this question DIFFERENTLY, so a bare `optionalCostBoost !== null` would
  // claim the base for both.
  //
  // 🛑 THE DISCRIMINATOR IS WHETHER THE PAYOFF RE-HOMES THE PRINTED NUMBER, WHICH IS
  // D228's ASYMMETRY WITH A READER IN FRONT OF IT. `moreDamage` (Cetitan ex, `140+`)
  // is the SAME §8.5 hit at two amounts and is dealt from inside the gate, so the
  // base must be dropped here or one printed number becomes two `DAMAGE_DEALT` rows.
  // `benchSnipe` (Wellspring Mask Ogerpon ex, a flat `100`) is an ADDITIONAL hit on a
  // benched body the main hit never touches — the printed 100 lands in this pipeline
  // whatever the player answers — so dropping the base would silently delete a
  // 100-damage attack on every board, including the ones where the offer is declined.
  const costBoostOwnsTheBase = optionalCostBoost?.payoff.kind === "moreDamage";
  //
  // 🆕🆕 D403 — A SIXTH CLAIMANT, AND IT IS THE FIRST ONE WHOSE OP IS *TOP-LEVEL*
  // YET STILL NEEDS A TERM HERE. D316/D317/D381 all nest their `damageDefender`
  // inside a gate, which `programDamage`'s top-level `some` deliberately does not
  // walk; this reading's hit is a bare top-level op exactly like Hail Blade's, and
  // the reason the term is still owed is ORDERING rather than depth — `programDamage`
  // is computed from the registry/derived program HERE, and every reading-borne
  // program is APPENDED four hundred lines below. So the drop is claimed off the
  // reading, like its three siblings, and the honest place is the same: the reader is
  // what knows the printed number has been re-homed. Leaving it out would deal the
  // base pre-program AND again inside the op that folds it, which is precisely the
  // double hit `damageDefender.base` exists to avoid.
  const scaledBase =
    damageMultiplier !== null ||
    programDamage ||
    optionalBoost !== null ||
    bonusConsequent !== null ||
    costBoostOwnsTheBase ||
    discardScaledBoost !== null ||
    coinFlip?.kind === "perHeads" ||
    coinFlip?.kind === "perHeadsThenThreshold"
      ? 0
      : base;
  // The "+"/"×" modifier is SIMULATED iff a scaling reader consumed it OR the
  // program deals the damage; the effect text is simulated iff a program ran it
  // OR a scaling reader did. Only the genuinely-unsimulated remainder is flagged
  // loudly (simulator.md coverage).
  //
  // D126 adds a term to BOTH, and the second one is easy to miss: the 20
  // `bonusOnHeads` printings carry a printed "10+"-style damage marker
  // (`parseAttackDamage` splits "10+" into base 10 + modifier "+"), and that
  // modifier is exactly what the coin reader now consumes — the flip's N IS the
  // "+". Leaving `modifierSimulated` alone would keep all 20 loudly flagged even
  // though the engine now resolves them completely. The `cancelOnTails` printings
  // carry a FLAT number and never touch that term, which is why the term is
  // narrowed rather than written `coinFlip !== null`.
  //
  // D127 turned that narrowing inside out, and it is the more honest statement:
  // `perHeads`'s 22 printings carry a "D×" marker the reader also consumes, so TWO
  // of the three members own a modifier and only `cancelOnTails` — the one member
  // that reads a FLAT printed number — does not. Naming the exception keeps the
  // next member from silently defaulting to "unsimulated".
  //
  // D130 ADDS THE SECOND EXCEPTION, and it is the case that exception list was
  // written for. `programPerHeads` explains no `+`/`×` at all — it folds no damage,
  // so a printed damage marker on such a card would be a number NOTHING in the
  // derived shape accounts for, and claiming it would suppress a loud row the
  // engine has not earned. Both of this member's printings carry no `damage` field
  // whatsoever, so no board can currently reach the difference: this is
  // correctness in principle, not a live bug, and it is written down now because
  // the default (ride the `!== "cancelOnTails"` test) would have been silently
  // wrong the first time a "For each heads" printing arrived with a marker.
  //
  // `effectSimulated`, by contrast, needs NO new term: `coinFlip !== null` already
  // covers the new member, and it is right to — the sentence IS read, whole, by
  // one reader. Verified rather than duplicated.
  //
  // D163 adds a term to BOTH, for the reason D126's note gives: the subtractive
  // scaling reader consumes a printed "270-"/"200-" damage marker AND the whole
  // effect sentence, so leaving either term alone would keep five printings loudly
  // flagged for text the engine now resolves completely. It is a separate term
  // from `scaling` only because it is a separate variable, not because it is a
  // separate rule — the three scaling readers are one family here.
  //
  // D192 adds a term to `effectSimulated` ONLY, and the asymmetry is the point.
  // The suppression sentence is the WHOLE printed effect of its 34 legal printings,
  // so leaving this term out would flag every one of them loudly for text the
  // engine now resolves completely. It explains NO `+`/`×` MODIFIER, though: all
  // four printed sentences sit on a FLAT printed `damage` (Koraidon "Shred" 130,
  // Excadrill ex "Rock Tumble" 200, Medicham ex "Yoga Kick" 190 — checked across
  // all 34), so a card that ever paired this clause with a "+" marker would carry
  // a number nothing in the derived shape accounts for, and claiming it would
  // suppress a loud row the engine has not earned. That is D130's rule applied to
  // a new reader rather than the default inherited.
  //
  // 🆕 D316 adds a term to BOTH, and neither is optional in the D130 sense. The
  // sentence is the WHOLE printed effect of its five printings, so without the
  // first term every one of them stays loudly flagged for text the engine now
  // resolves completely; and all five carry a printed "+" marker (`120+`, `50+`,
  // `130+`) which is EXACTLY the bonus this reader consumes, so without the second
  // the engine would flag a modifier it has just spent. `bonusOnHeads`'s pair of
  // terms, one reader over — the coin flip and the confirm are the same shape with
  // a different decider.
  //
  // 🆕 D317 adds a term to BOTH, on D316's reasoning one reader over. The sentence
  // is the WHOLE printed effect of its six printings, so without the first term
  // every one of them stays loudly flagged for text the engine now resolves; and
  // both printed sentences carry a "+" marker (`140+` on all five Ogerpon ids,
  // `30+` on Floragato) which is EXACTLY the bonus this reader consumes, so
  // without the second the engine would flag a modifier it has just spent.
  // 🆕🆕 **D428 ADDS ONE TERM HERE AND NONE TO `modifierSimulated`, AND BOTH HALVES
  // ARE D130's RULE APPLIED RATHER THAN COPIED.** The pre-damage sentence is the
  // WHOLE printed effect of all five of its printings, so without the term here
  // every one of them would stay loudly `ATTACK_EFFECT_SKIPPED` for text this
  // engine now resolves completely — the built-but-dead report, which is a lie in
  // the direction that wastes a successor's slice. And it explains NO `+`/`×`
  // marker at all: nothing about discarding a Tool accounts for a printed damage
  // modifier, so claiming one there would suppress a loud row the engine has not
  // earned (D383's narrowing, read from the other side). Written from the rule; the
  // ids that print this sentence are unresolvable in this checkout (no D1 — D425),
  // so whether any of the five ALSO prints a marker is not knowable here, and the
  // rule is what makes the answer right either way.
  const effectSimulated =
    program !== null ||
    preDamage !== null ||
    scaling !== null ||
    damagePenalty !== null ||
    // 🆕🆕 D363 — GATED ON `requirementSplit === null`, AND THE GATE IS THE WHOLE
    // SAFETY OF THE WIDENING. When no split fired, `effect` IS the requirement
    // sentence and a non-null requirement simulates it, exactly as since D125.
    // When a split DID fire, `effect` is the COMPANION sentence and the
    // requirement says nothing about it — leaving the bare term here would let a
    // printed requirement SILENCE a trailing sentence no reader resolved, which
    // is precisely the D278/D279 "too loose" failure this family keeps refusing.
    // 🆕🆕 D417 NARROWS THIS TERM A SECOND TIME AND ADDS NONE, WHICH IS D130's RULE
    // APPLIED TO A WIDENED READING RATHER THAN TO A NEW READER — and it is the same
    // safety D363 bought one conjunct to the left. When the CANCEL split fires,
    // `effect` is the HEAD sentence and the requirement was read off the TRAILING
    // clause, so the requirement says nothing whatever about what `effect` now
    // holds. Leaving the term bare would let a printed cancel SILENCE a head no
    // reader resolved — the D278/D279 "too loose" failure, one clause round the
    // other way.
    //
    // ⚠️ AND NO TERM IS OWED ON THE OTHER SIDE, WHICH WAS CHECKED RATHER THAN
    // ASSUMED. The one printing this slice claims (Eternatus `sv08-141`) has its
    // head claimed by `deriveAttackEffect` (D380's `discardStadium`), so `program`
    // is non-null and `effectSimulated`'s FIRST term already carries it: the
    // sentence is not reported as skipped, and it is not reported because the head
    // is genuinely resolved rather than because a requirement vouched for it. A
    // future `ATTACK_CANCEL_HEADS` row whose head NO reader claims is exactly the
    // case this narrowing keeps loud, so the two halves are one decision.
    // `modifierSimulated` below needs neither change: this reading explains no
    // `+`/`×` marker at all, and Eternatus prints a FLAT 230.
    //
    // ⚠️ **AND THE CONJUNCT IS NOT DRIVEN, WHICH IS SAID RATHER THAN SKIPPED**
    // (D130/D205). With ONE row in `ATTACK_CANCEL_HEADS` and that row's head
    // claimed by `deriveAttackEffect`, `cancelSplit !== null` IMPLIES
    // `program !== null` today, so removing this conjunct moves no assertion in the
    // repo — verified by removing it and running the whole engine suite, which
    // stayed green. It is written from the RULE rather than from what a test would
    // notice; the second table row is what makes it live, and that row is one
    // printing away.
    //
    // 🆕🆕 **D420 ADDED THREE MORE ROWS AND THE CONJUNCT IS STILL NOT DRIVEN — THE
    // LAST SENTENCE ABOVE WAS THE WRONG FORECAST AND IS CORRECTED IN PLACE (D178).**
    // A row whose head no reader claims would drive it, and D420's correction to
    // `ATTACK_CANCEL_HEADS`' doc block is precisely that such a row must never be
    // added ALONE: a row plus an unclaimed head steps `BUILT.attack` while the attack
    // still falls to the loud path (D407's "built but dead"). So all FOUR rows have
    // claimed heads, `cancelSplit !== null` still implies `program !== null`, and the
    // term that would exercise this conjunct is the one the corrected rule forbids.
    // It stays, unexercised and correct, which is what writing from the rule means.
    (requirement !== null && requirementSplit === null && cancelSplit === null) ||
    coinFlip !== null ||
    optionalBoost !== null ||
    bonusConsequent !== null ||
    optionalCostBoost !== null ||
    discardScaledBoost !== null ||
    damageSuppression !== null;
  // The exception LIST, named rather than inlined: two of the coin union's four
  // members explain a printed damage marker and two do not, and a bare
  // `coinFlip !== null` here would claim the modifier for all four.
  // 🆕🆕 **D499 ADDS THE THIRD EXCEPTION, AND IT IS WRITTEN FROM THE RULE RATHER THAN
  // FROM THE DATA.** `cancelOnTailsElseProgram` folds no damage — its heads branch is
  // a durated `preventDamage` install and its tails branch is the cancel — so it
  // explains no printed `+`/`×` whatever. Claiming the modifier for it would SUPPRESS
  // a loud row the engine has not earned, which is `programPerHeads`'s argument one
  // member over. ⚠️ This checkout has no D1, so the printed damage MARKER on the two
  // printings is UNRESOLVED (D425) and deliberately not the reason: the default —
  // riding the `!== "cancelOnTails"` test — would have been silently wrong the first
  // time such a printing arrived with a marker, exactly as D130's note predicted.
  const coinExplainsModifier =
    coinFlip !== null &&
    coinFlip.kind !== "cancelOnTails" &&
    coinFlip.kind !== "cancelOnTailsElseProgram" &&
    coinFlip.kind !== "programPerHeads";
  // 🆕🆕 D383 adds NO term and NARROWS one, which is D130's rule applied to a
  // widened reading rather than to a new reader. The `moreDamage` payoff consumes a
  // printed "+" marker (`140+`) and is exactly what explains it; the `benchSnipe`
  // payoff explains NO `+`/`×` at all — its printing is a FLAT `100` and its extra
  // damage is a second hit rather than a bigger one — so a card that ever paired
  // that clause with a marker would carry a number nothing in the derived shape
  // accounts for, and claiming it would suppress a loud row the engine has not
  // earned. No printing in the pool reaches the difference (all 5 are flat), so this
  // is correctness in principle and NOT a live bug — written from the rule rather
  // than from what a test would notice, exactly as D130 and D192 were.
  // ⚠️ `effectSimulated` above needs no such narrowing and gets none: the sentence
  // is the WHOLE printed effect under BOTH payoffs, so the bare term is right for
  // both. Verified rather than copied.
  // 🆕🆕 D403 adds ONE term to each of the three chains and NARROWS none. The additive
  // reading consumes a printed "+" marker exactly as its three `more damage` siblings
  // do (the printed clause IS the "+", and the base it is added to is the number
  // beside it), so the bare term is right here for the same reason `optionalBoost`'s
  // is. No narrowing is owed: this reading has ONE payoff, unlike D383's two.
  //
  // 🛑 AND THE COMMENT SITS ABOVE THE `const` RATHER THAN INSIDE THE CHAIN, WHICH IS
  // NOT A STYLE CHOICE. Seven mutation rows (D316 ×3, D317 ×3, D381) carry multi-line
  // `find` strings spanning adjacent lines of these three disjunctions; a comment
  // spliced between two of those lines breaks every row that spans the gap without a
  // character of the code moving. The rows were re-transcribed for the new TERM in the
  // same commit — they had to be — but a comment INSIDE the chain would have made them
  // fragile forever rather than once.
  const modifierSimulated =
    scaling !== null ||
    damagePenalty !== null ||
    programDamage ||
    optionalBoost !== null ||
    bonusConsequent !== null ||
    costBoostOwnsTheBase ||
    discardScaledBoost !== null ||
    coinExplainsModifier;
  if (
    (modifier !== null && !modifierSimulated) ||
    (effect !== null && effect !== "" && !effectSimulated)
  ) {
    events.push({
      type: "ATTACK_EFFECT_SKIPPED",
      seat: action.seat,
      attack: declared.name,
      // Authored/derived/scaled text IS simulated — only an unsimulated one is skipped.
      effect: effectSimulated ? null : effect,
      damageModifier: modifierSimulated ? null : modifier,
    });
  }

  // D125 — the requirement gate, IN FRONT of the §8.5 pipeline and of the
  // program: the printed words are "this attack does nothing", so nothing is
  // exactly what may happen — no damage, no W/R, no effect ops, no triggers.
  // Structurally the confusion-tails path (§8 step 3) minus the self-damage, and
  // it reuses that path's ending on purpose: `finishAttack` still sweeps §8.1 and
  // still ends the turn, because a cancelled attack is an attack that was USED.
  //
  // The clause is read against `next`, the board as of declaration — which is
  // what discharges Lycanroc's printed "before this attack does damage" for
  // free, and what makes Palafin's promotion read the CURRENT turn's stamp.
  // Placed AFTER the ATTACK_EFFECT_SKIPPED bookkeeping above so that block stays
  // the single place any unsimulated remainder is reported; a requirement makes
  // the sentence SIMULATED, so nothing is flagged on either outcome.
  if (requirement !== null && !conditionHolds(next, action.seat, requirement)) {
    events.push({
      type: "ATTACK_FAILED",
      seat: action.seat,
      uid: attackerUid,
      reason: "requirement",
    });
    return finishAttack(next, events, action.seat, attackerUid, declared.name);
  }

  // D126 — the attack's OWN printed coin flip, taken here and nowhere else.
  //
  // WHY NOT AN `EffectOp`? D125's rule: a derived shape is classified by WHERE IN
  // RESOLUTION IT LANDS, not by how its sentence reads. An effect program runs at
  // this function's TAIL, strictly after the §8.5 pipeline — so a `coinFlipGate`
  // could neither add to a number already computed nor retract damage already
  // dealt. A flip that GATES damage has to run in front of the pipeline, which is
  // precisely why §8 step 3's confusion flip sits where it does. This is the same
  // site, one gate later.
  //
  // WHY `ATTACK_EFFECT_COIN_FLIP` IS REUSED rather than joined by a sibling event.
  // The event names a FACT — "a coin was flipped resolving this" — and that fact
  // is identical here and inside a `coinFlipGate`; its log copy was already
  // neutralised ("flipped <face> for the effect") back when Trainers started
  // sharing it, so it reads correctly with no change. A second type would owe a
  // new log arm and a new wire union member to carry exactly the information the
  // existing one already carries. (CONFUSION_CHECK stays separate for the opposite
  // reason: it is a §12 STATUS check, not part of the attack's printed text, and
  // its row names the condition.)
  //
  // WHY THIS SITS AFTER THE D125 REQUIREMENT GATE. An attack already cancelled
  // must not burn an rngState step: the flip is part of RESOLVING the attack, and
  // a cancelled attack never gets that far. Honestly: no printing in the pool
  // carries both a board requirement and a printed flip (the two sentences are
  // whole-string anchored, so a card could only have one), so nothing in the
  // suite pins this order — it is here because it is the order the rules read in,
  // not because a case would fail the other way round.
  //
  // WHY HEADS AND TAILS ARE ONE SLICE. They are ONE MECHANISM — a single
  // pre-damage flip — read from two ends, and the union makes that structural.
  // Built separately, the flip, its event and its placement would have been
  // designed twice, and the second design would have had to justify not being the
  // first.
  //
  // D127 — N FLIPS, ANNOUNCED AS N ROWS. "Flip N coins. This attack does D damage
  // for each heads." (22 printings, N ∈ {2, 3, 4}) is this same site with a bounded
  // LOOP where D126 took a single draw. `ATTACK_EFFECT_COIN_FLIP` carries exactly
  // ONE `CoinFace`, so a sequence of them — one per flip, in flip order — is the
  // only reading that does not invent an aggregate the event, the wire and the log
  // cannot express. The alternative (one row carrying a heads COUNT) would owe a
  // new event, a new wire member and a new log arm to say something the reader can
  // already count off the rows, and it would throw away the ORDER, which is the one
  // thing a player watching a three-flip attack actually wants to see.
  //
  // THE FOLD IS THE SAME ARITHMETIC FOR BOTH DAMAGE MEMBERS. `heads × per` is
  // right for `bonusOnHeads` too (its `heads` is 0 or 1), so the branch below is
  // over CANCELLATION, not over the members — `bonusOnHeads` really is the
  // one-flip case of the same fold. What is NOT shared is the printed base, and
  // that lives at `scaledBase` above where the marker is read.
  //
  // D128 — THE FLIP COUNT ITSELF CAN BE A BOARD FACT. "Flip a coin for each [{X}]
  // Energy attached to this Pokémon." (3 printings) folds exactly as D127's printed
  // N does; the only thing that moved is where the bound comes from. It is read
  // HERE, at the site the flips are taken, and not at declaration beside `scaled` —
  // the count and the flips it bounds are one act, and splitting them would let a
  // future gate between the two silently invalidate the number. (Nothing between
  // declaration and this line can change an attachment today; that is a fact about
  // the current gates, not a property worth depending on.)
  //
  // It is NOT a `DamageCountSource` and `scaledAttackDamage` is untouched: the
  // DAMAGE count still comes from the flips (D126's rule), and what the board
  // answers is how many times to flip — the one number the coin cannot answer. So
  // this is a widened `flips`, not a fourth union member and not a second fold.
  //
  // A ZERO COUNT MEANS ZERO FLIPS, which is not the same as zero heads: no
  // `ATTACK_EFFECT_COIN_FLIP` rows at all and no rngState step consumed, where
  // D127's zero-HEADS outcome spends its flips and announces every one of them.
  // Both then land on the same ending — `coinBonus` 0, `scaledBase` 0, so the
  // §8.5 gate below deals no damage and `finishAttack` still ends the turn. No
  // printing in the pool can reach it (all three carry a cost floor of at least
  // one Energy, and Torkoal's `{R}` cost is itself the `{R}` its filter counts),
  // so the branch is defensive and its test is a constructed fixture.
  //
  // D129 — AND IT CAN BE UNBOUNDED. "Flip a coin until you get tails." (5 damaging
  // printings) is the same site again, and the ONLY thing it changes about this
  // block is that the faces are drawn before they are counted rather than after.
  // `takeFlips` now returns the SEQUENCE for every member, so this loop announces
  // rows and tallies heads identically whether the count came from the text, the
  // board, or the faces themselves — there is no `untilTails` branch here at all,
  // which is the point.
  //
  // BOTH DAMAGE MEMBERS ARE REACHED BY IT, and that is the shape's one surprise:
  // 4 of the 5 printings are "D×" multiply (`perHeads`, base dropped) and
  // Bouffalant sv03-174 is "50+" additive (`bonusOnHeads`, base kept). The flip
  // COUNT and the printed BASE are independent, so widening `bonusOnHeads` with
  // the same `flips` field costs one field and no new arithmetic — the fold below
  // was already shared.
  //
  // THE TERMINATION ARGUMENT IS NOT A CEILING and does not live here: nothing in
  // the text or the board bounds this count, so a refusal (D127's answer for a
  // malformed printed N) would refuse a LEGAL sentence, and a truncating cap
  // chosen by feel would silently lie about the game. It is answered where the
  // faces come from — `MAX_UNTIL_TAILS_FLIPS` in rng.ts is set above the longest
  // heads run that EXISTS anywhere in mulberry32's full 2³² cycle (measured: 31),
  // so it cannot fire from any seed and the sequence always ends in tails.
  //
  // D130 — AND THE CONSEQUENT CAN BE A PROGRAM RATHER THAN A NUMBER. "For each
  // heads, discard the top N cards of your opponent's deck." (2 printings —
  // Wugtrio sv01-057 on a PRINTED count of 3, Gyarados swsh10.5-022 on an
  // UNBOUNDED one) runs an EffectOp per heads instead of folding `per × heads`.
  // Nothing about the flip half moves: the same `takeFlips`, the same one row per
  // face, the same tally.
  //
  // THE CARRY IS PROGRAM EXPANSION, AT THIS SITE, AND NOT A NEW CHANNEL. The flips
  // are taken HERE, in front of §8.5; EffectOps run at this function's TAIL,
  // strictly after it; and until now nothing carried a value between the two. The
  // obvious repair — thread a heads count through to `runProgram` and teach the
  // interpreter a "repeat" op — buys a second way to say "N times" and a new
  // vocabulary member to say it with. But "For each heads, X" literally IS X
  // repeated `heads` times, and the tail already runs an `EffectOp[]`: so the
  // faces are spent HERE into a longer PROGRAM, and the value that crosses the gap
  // is the program itself. `heads === 0` expands to nothing at all, which is why
  // the zero-heads outcome needs no branch and takes the existing no-program
  // ending below.
  //
  // APPENDED, NEVER ASSIGNED. `program` is the registry row or the derived one,
  // and overwriting it would let an authored program be silently dropped by a coin
  // sentence on the same attack. For these two printings it is always null — the
  // derivers are whole-sentence anchored, so a sentence this coin reader claims is
  // a sentence `deriveAttackEffect` refused, and neither card carries a registry
  // row — which makes the append behaviour-identical today and honest tomorrow.
  // The same call `finishAttack` makes about its own queue.
  //
  // `coinBonus` STAYS 0 for this member: it folds no damage, so there is nothing
  // to add at the pre-W/R step and the printed base (if a future printing had one)
  // is KEPT — see `scaledBase` above, where the rule is stated.
  let coinBonus = 0;
  if (coinFlip !== null) {
    const [faces, rngState] = takeFlips(next, action.seat, active, printedFlips(coinFlip));
    next = { ...next, rngState };
    let heads = 0;
    for (const face of faces) {
      events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat: action.seat, result: face });
      if (face === "heads") heads += 1;
    }
    if (coinFlip.kind === "cancelOnTails" || coinFlip.kind === "cancelOnTailsElseProgram") {
      if (heads === 0) {
        // D125's ending, third caller: no damage, no W/R, no effect ops, no
        // triggers — and `finishAttack` still sweeps §8.1 and still ends the turn,
        // because an attack that did nothing is an attack that was USED.
        events.push({
          type: "ATTACK_FAILED",
          seat: action.seat,
          uid: attackerUid,
          reason: "coinFlip",
        });
        return finishAttack(next, events, action.seat, attackerUid, declared.name);
      }
      // 🆕🆕 D499 — the HEADS branch of the same flip, and it is reached only on the
      // fall-through above, so the two consequences can never both happen and can
      // never disagree about the face. APPENDED, NEVER ASSIGNED — D130's rule at its
      // fourth payment in this block: overwriting `program` would let a registry row
      // be silently dropped by a coin sentence on the same attack. For these two
      // printings `program` is always null (the derivers are whole-sentence anchored,
      // so a sentence this coin reader claims is one `deriveAttackEffect` refused,
      // and `programFor` is undefined for the ids — asserted over the whole registry
      // in `cancelThenPrevent.test.ts` §4 rather than assumed), which makes the
      // append behaviour-identical today and honest tomorrow.
      if (coinFlip.kind === "cancelOnTailsElseProgram") {
        program = [...(program ?? []), ...coinFlip.ops];
      }
    } else if (coinFlip.kind === "programPerHeads") {
      // D130 — THE EXPANSION. One copy of the member's ops per matching face, in
      // flip order, appended to whatever program the attack already had. A `flat` over
      // repeated references to the SAME array is safe because `EffectOp`s are plain
      // frozen-by-convention data the interpreter never mutates — every op reads
      // its own fields and writes only the state it returns — so the copies share
      // structure rather than needing one.
      //
      // 🆕🆕 **D476 — THE COUNT IS OVER THE MEMBER'S PRINTED FACE, NOT OVER
      // `heads`.** This is the FACE axis, the last of the three the family prints
      // (count × consequent × face), and it is read the same way `perHeadsThenThreshold`
      // reads its threshold forty lines down: a second spend of the `faces` array this
      // block already holds, never a second channel. `faces.length - heads` would give
      // the identical number for `face: "tails"` on every board and is refused for
      // `AttackFlipThreshold`'s stated reason — it would make `face` a flag on a
      // heads-shaped count instead of the field it is.
      //
      // ⚠️ **THE TALLY IS ITS OWN LOCAL AND NOT THE `heads` ABOVE**, because `heads`
      // still means heads for the two members that reach the `else` below and for
      // `cancelOnTails` above — D438's rule that a name describing one axis by accident
      // becomes false the moment a second inhabitant arrives, applied to the tally
      // rather than to the member.
      let onPrintedFace = 0;
      for (const drawn of faces) if (drawn === coinFlip.face) onPrintedFace += 1;
      const repeated: EffectOp[] = [];
      for (let i = 0; i < onPrintedFace; i += 1) repeated.push(...coinFlip.ops);
      const expanded = [...(program ?? []), ...repeated];
      // Back to NULL when nothing came out of it (zero of the printed face and no
      // prior program), because null is what the tail below tests for: an empty
      // `EffectOp[]` would
      // route the attack through `settleProgram` to say nothing at all, which is a
      // different ending with the same result, and "different ending" is how a
      // no-op grows a KO sweep it did not have.
      program = expanded.length > 0 ? expanded : null;
    } else {
      coinBonus = heads * coinFlip.per;
    }
    // 🆕🆕 D460 — THE THRESHOLD, AND IT IS A SECOND READ OF FACES THIS BLOCK
    // ALREADY HOLDS RATHER THAN A SECOND CHANNEL. `takeFlips` returns the SEQUENCE for
    // every member (D129's widening, restated by D452), so the faces are already in
    // scope here; the damage fold above spends them into a NUMBER and this spends the
    // same array into a PREDICATE. Nothing new crosses the gap between the flip site
    // and the program tail — the value that crosses is the PROGRAM, which is D130's
    // carry paid a second time and the reason no `EffectOp` had to learn to read a
    // coin it did not take.
    //
    // 🛑 IT IS ITS OWN `if` RATHER THAN A BRANCH OF THE CHAIN ABOVE, AND THAT IS
    // NOT TIDINESS. This member folds `per × heads` EXACTLY as `perHeads` does, and the
    // union's doc block says that arithmetic is computed with one expression on
    // purpose; a fourth `else if` would have had to copy `coinBonus = heads *
    // coinFlip.per` and the two copies could then disagree. So the fold rides the
    // existing `else` (all three members that reach it carry a `per`) and only the
    // half that is genuinely new is written here.
    //
    // THE COUNT IS OVER THE PRINTED FACE AND NOT OVER `heads`. `faces.length - heads`
    // would be the same number for `face: "tails"` today, and it is the normalisation
    // `AttackFlipThreshold`'s doc block refuses at DERIVE time — reaching for it here
    // would put the arithmetic back one layer down and make `face` a flag on a
    // heads-shaped count instead of the field it is.
    //
    // APPENDED, NEVER ASSIGNED — D130's rule, verbatim and for its reason: `program` is
    // the registry row or the derived one, and overwriting it would let an authored
    // program be silently dropped by a coin sentence on the same attack. For these
    // three printings it is always null (`deriveAttackCoinFlip` claims the sentence
    // WHOLE, so it is a sentence `deriveAttackEffect` refused), which makes the append
    // behaviour-identical today and honest tomorrow.
    //
    // A FAILED THRESHOLD APPENDS NOTHING AT ALL, which is the same ending zero of the
    // printed face takes on `programPerHeads`: `program` stays null, the tail's
    // `program !== null` test is false, and the attack finishes through the no-program path. There is no
    // "empty program" board and so no second ending with the same result.
    if (coinFlip.kind === "perHeadsThenThreshold") {
      let matching = 0;
      for (const face of faces) if (face === coinFlip.threshold.face) matching += 1;
      if (matching >= coinFlip.threshold.atLeast) {
        program = [...(program ?? []), ...coinFlip.ops];
      }
    }
  }
  // 🆕 D316 — THE OPTIONAL BOOST, ASSEMBLED HERE FOR D130's REASON AND NOWHERE
  // ELSE. `deriveAttackOptionalBoost` read the bonus and the consequent out of the
  // text; the printed BASE is a field on the attack and lives only in this
  // function, so the value that crosses the gap is again the PROGRAM. Both arms
  // deal ONE `damageDefender` through the full §8.5 pipeline — the yes arm at
  // `base + bonus` with the consequent behind it, the no arm at the bare printed
  // base — which is the whole point of moving the hit inside the gate: §8.5 is
  // applied once, to the number the answer decided, so a Resistance is paid once
  // and one `DAMAGE_DEALT` row is emitted (effects.ts states the arithmetic).
  //
  // `scaledBase` is already 0 above, so the pre-program pipeline deals nothing and
  // the `scaledBase + scaledTotal > 0` branch below is simply not taken — the same
  // ending Hail Blade takes, reached by the same suppression.
  //
  // APPENDED, NEVER ASSIGNED — D130's rule, verbatim and for its reason: `program`
  // is the registry row or the derived one, and overwriting it would let an
  // authored program be silently dropped by a sentence on the same attack. For
  // these five printings it is always null (the derivers are whole-sentence
  // anchored, so a sentence this reader claims is one `deriveAttackEffect`
  // refused, and no registry row names any of the four cards), which makes the
  // append behaviour-identical today and honest tomorrow.
  // 🆕 D318 — THE ASSEMBLY MOVED TO effects.ts AND THE CALL SITE IS ONE LINE.
  // The program is unchanged byte for byte; what changed is that
  // `optionalBoostProgram` can now be called by something that is not this
  // function. `programWalk.test.ts` could not build this shape for two slices and
  // reported `["optional", ["then"]]` on an op that has carried an `otherwise`
  // since D316 — see that assembler's doc block for why an exported one is the
  // only repair and why exporting it alone would still have been green and dead.
  if (optionalBoost !== null) {
    program = [...(program ?? []), ...optionalBoostProgram(optionalBoost, base, effect ?? "")];
  }
  // 🆕 D317 — THE SAME ASSEMBLY WITH THE DECIDER CHANGED, AND THE ASSEMBLY ITSELF
  // LIVES IN effects.ts RATHER THAN HERE. `deriveAttackBonusConsequent` read the
  // decider, the bonus and the consequent out of the text; the printed BASE is a
  // field on the attack and lives only in this function, so the value that crosses
  // the gap is again the PROGRAM (D130's rule, third payment).
  //
  // 🛑 WHY `bonusConsequentProgram` IS EXPORTED INSTEAD OF INLINED THE WAY THE
  // BLOCK ABOVE IS. A program assembled HERE is invisible to every structural
  // auditor in the suite: `programWalk.test.ts` builds its corpus from
  // `deriveAttackEffect` over `FIXTURE_POOL` plus the registry, and it can only
  // see a reading-borne program if that program can be BUILT outside this file.
  // D316's `optional` cannot, which is why its `otherwise` has been live for a
  // slice while that suite's carrier pin still reads `["optional", ["then"]]`.
  // Exporting the assembler is the same repair `programPerHeads.ops` got at D150,
  // and it is what lets the pin below actually move when the shape does.
  //
  // ONE FLIP, AND THAT IS THE WHOLE ARGUMENT FOR THE COIN HALF LIVING HERE RATHER
  // THAN AT THE `coinFlip` BLOCK ABOVE. The gate takes its own coin inside
  // `runProgram`, announces it with the same `ATTACK_EFFECT_COIN_FLIP` row, and
  // branches BOTH arms off that one face — so the bonus and the heal can never
  // disagree. Reading Floragato with `deriveAttackCoinFlip` AND a gate program
  // would draw twice.
  //
  // APPENDED, NEVER ASSIGNED — D130's rule, verbatim and for its reason. For these
  // six printings `program` is always null (the derivers are whole-sentence
  // anchored, so a sentence this reader claims is one `deriveAttackEffect`
  // refused, and `programFor` is undefined for all six ids — checked, not assumed),
  // which makes the append behaviour-identical today and honest tomorrow.
  if (bonusConsequent !== null) {
    program = [...(program ?? []), ...bonusConsequentProgram(bonusConsequent, base)];
  }
  // 🆕🆕 D381 — THE SAME ASSEMBLY WITH THE SENTENCE'S TWO HALVES SWAPPED, and the
  // assembler lives in effects.ts from its first line rather than after two slices
  // of a green, dead carrier pin (D318's finding, inherited rather than repeated).
  // `deriveAttackOptionalCostBoost` read the precondition, the cost's ops and the
  // bonus out of the text; the printed BASE is a field on the attack and lives only
  // in this function, so the value that crosses the gap is again the PROGRAM
  // (D130's rule, fourth payment).
  //
  // TWO NESTED GATES, AND BOTH CARRY A DECLINE ARM — the empty §7.3 zone and the
  // answered "no" each still deal the printed base, because Crushing Press is
  // `140+` and not `+140`. That is the difference from D380's bare "You may", whose
  // whole content was the discard and whose `otherwise` is rightly ABSENT.
  //
  // APPENDED, NEVER ASSIGNED — D130's rule, verbatim and for its reason. For these
  // two printings `program` is always null (the derivers are whole-sentence
  // anchored, so a sentence this reader claims is one `deriveAttackEffect` refused,
  // and `programFor` is undefined for both ids — checked, not assumed), which makes
  // the append behaviour-identical today and honest tomorrow.
  if (optionalCostBoost !== null) {
    program = [
      ...(program ?? []),
      ...optionalCostBoostProgram(optionalCostBoost, base, effect ?? ""),
    ];
  }
  // 🆕🆕 D403 — THE SAME ASSEMBLY FOR THE ADDITIVE HALF OF D402's FAMILY, and the
  // assembler lives in effects.ts from its first line (D318's finding, inherited
  // rather than repeated). `deriveAttackDiscardScaledBoost` read the ceiling, the
  // filter and the per-card damage out of the text; the printed BASE is a field on
  // the attack and lives only in this function, so the value that crosses the gap is
  // again the PROGRAM (D130's rule, fifth payment).
  //
  // 🛑 NO GATE AND NO DECLINE ARM, WHICH IS THE DIFFERENCE FROM ALL FOUR SIBLINGS
  // ABOVE. Their "no" routes around the only op that deals damage, so each owes an
  // `otherwise` carrying the printed base. Here the decline is a §9.2 count of ZERO
  // and the one `damageDefender` deals `base + P × 0` — the printed base, by the same
  // expression, on the same §8.5 pass. The arithmetic IS the decline arm.
  //
  // APPENDED, NEVER ASSIGNED — D130's rule, verbatim and for its reason. For these
  // eight printings `program` is always null (the derivers are whole-sentence
  // anchored, so a sentence this reader claims is one `deriveAttackEffect` refused,
  // and no registry row names any id that prints either sentence — the ids are
  // unknown to this container at all, D369), which makes the append
  // behaviour-identical today and honest tomorrow.
  if (discardScaledBoost !== null) {
    program = [...(program ?? []), ...discardScaledBoostProgram(discardScaledBoost, base)];
  }
  // The flip's heads bonus is the attack's OWN printed extra damage, exactly like
  // a count-scaling clause's `scaled` — so it folds at the same step, PRE-Weakness
  // and pre-Resistance ((10 + 10) × 2 = 40 for Litwick into a Fire-weak body, not
  // 10 × 2 + 10). `scaled` itself is left alone: it is what `scaledAttackDamage`
  // returned from the BOARD, and that function stays pure and state-only —
  // a coin face is not a board fact and has no business in `DamageCountSource`.
  // The two can never both be non-zero on a real printing (the anchors are
  // disjoint), but summing rather than choosing keeps the arithmetic total.
  const scaledTotal = scaled + coinBonus;

  // 🆕🆕🛑 **D428 — THE PRE-DAMAGE HOOK, AND ITS PLACEMENT IS THE SLICE.** The
  // printed words are *"Before doing damage"*, and this is the last line before the
  // §8.5 pipeline opens. Everything that can still CANCEL the attack has run — the
  // D125 requirement gate, D126's flip gate, §8 step 3's confusion check — so an
  // attack that never resolves never strips a Tool; and nothing between here and
  // the pipeline reads the defender's attachments.
  //
  // 🛑 **A HOOK PLACED AFTER §8.5 WOULD RESOLVE, EMIT ITS EVENT, PRINT ITS LOG ROW
  // AND CHANGE NO NUMBER** — D407's built-but-dead defect, and the reason this
  // slice is defined by an ORDER rather than by an effect. The §8.5 reads that make
  // the discard observable, all of them off the defending body:
  //   · `passivesOf(next, defender)` → `damageReductionAfterWR` (Rock Chestplate
  //     `sv01-192`, a TOOL: 30 less after W/R on an {F} holder) — the damage MOVES;
  //   · `effectiveMaxHp` at the §8.1 sweep → `basicHpBonus` (Bravery Charm
  //     `sv02-173`, a TOOL: +50 HP on a Basic holder) — the KNOCK OUT moves.
  // Both are driven with the Tool present and the Tool discarded on ONE board in
  // `preDamageToolDiscard.test.ts` §3/§4, so "the number is unchanged" is a RED
  // assertion and not a missing one.
  //
  // ⚠️ **`scaled` IS COMPUTED ~700 LINES ABOVE AND IS NOT RE-READ**, which is a
  // commitment and is said out loud. `deriveAttackDamageBonus` claims *"If your
  // opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more
  // damage."* (2 printings) off the DECLARATION board, so on a hypothetical card
  // printing both sentences the bonus would count a Tool this line then discards.
  // No printing carries both — the readers are whole-sentence anchored, so one
  // attack's effect text cannot be two sentences unless a splitter composes it, and
  // no splitter composes these — so the order is UNOBSERVABLE on today's column and
  // is chosen because it is the order the rules read in.
  if (preDamage !== null) {
    const stripped = applyAttackPreDamage(next, preDamage, action.seat, attackerUid, events);
    next = stripped.state;
    // 🛑 THE REBIND. See `declaredDefender` at the top of this function: without
    // this line the whole §8.5 pipeline keeps folding the pre-discard snapshot and
    // the slice is built-but-dead. `?? defender` rather than a throw because the
    // Active cannot vanish here (nothing above removes it) and a silent keep is the
    // no-op that a vanished body would deserve anyway.
    defender = next.players[defenderSeat].active ?? defender;
    // 🆕🆕 D429 — THE SECOND REBIND, for row 72's own-body strip. See `attackerBody`'s
    // block at the top of this function for the two §8.5-and-later reads it feeds and
    // for why a missing rebind here resurrects a discarded card rather than merely
    // mis-counting. Unconditional (not gated on `preDamage.kind`) for the same reason
    // the cancel below is: this site does not know what a member means, and a member
    // that starts touching the attacker's board later must not need an edit here.
    attackerBody = next.players[action.seat].active ?? attackerBody;
    // 🆕🆕🛑 D429 — ROW 72's PRINTED CANCEL, AND IT REUSES D125's ENDING RATHER THAN
    // RE-SPELLING IT. *"If you can't discard any, this attack does nothing."* is the
    // same consequent D125's requirement gate and D126's coin flip already have —
    // no damage, no W/R, no effect ops, no triggers — but conditioned on what the
    // PRE-DAMAGE SEAM JUST DID rather than on a board fact read before anything
    // happened. `finishAttack` is the shared ending: §8.1 still sweeps BOTH boards and
    // the §5.3 turn still ends, because a cancelled attack is an attack that was USED.
    //
    // ⚠️ THE TEST IS `stripped.cancelled` AND NOT `preDamage.kind`. Which members print
    // a cancel branch is the union's business (`applyAttackPreDamage`), and a `kind`
    // test here would be a second reader of a closed union — D222's exact shape, quiet
    // the day a fifth sentence prints the same branch.
    //
    // ⚠️ IT SITS AFTER THE REBINDS AND THAT IS FREE TODAY, SAID RATHER THAN LEFT AS A
    // COINCIDENCE: a cancelling member discarded nothing by construction, so both
    // rebinds are no-ops on this path. Ordering it this way keeps "apply, rebind,
    // then decide" as one sequence a successor cannot half-copy.
    if (stripped.cancelled) {
      events.push({
        type: "ATTACK_FAILED",
        seat: action.seat,
        uid: attackerUid,
        reason: "preDamage",
      });
      return finishAttack(next, events, action.seat, attackerUid, declared.name);
    }
  }

  let defended = defender;
  // §9 — the damaged Active's reactive onDamagedByAttack Ability, recorded at
  // damage time but run as a staged epilogue below (so a PARKING discard survives).
  let damagedTriggerStage: PendingStage | null = null;
  // 🆕🆕 **D427 — WHAT § 8.5 ACTUALLY DEALT TO THE DEFENDING ACTIVE, HOISTED TO
  // FUNCTION SCOPE SO THE EFFECT PROGRAM CAN READ IT.** The printed *"Heal from this
  // Pokémon the same amount of damage you did to your opponent's Active Pokémon."*
  // (6 legal printings) needs a number this function computes and, until this slice,
  // handed to nothing.
  //
  // 🛑 **IT IS A `let` HERE AND NOT A READ OF `dealt` BELOW, BECAUSE `dealt` IS NOT IN
  // SCOPE AT THE `runProgram` CALL AND THAT IS EASY TO GET WRONG.** `const dealt` is
  // declared INSIDE the `if` block that opens on the next line and closes ~100 lines
  // before the program runs; the handoff that priced this slice asserted the opposite
  // from reading the enclosing FUNCTION rather than the enclosing BLOCK. `defended` and
  // `damagedTriggerStage` directly above are the same shape and the same reason.
  //
  // 🛑 **INITIALISED TO 0, AND THAT INITIALISER IS THE WHOLE OF TWO PRINTED CASES.** An
  // attack whose damage step never runs at all — no printed base and no scaled bonus,
  // i.e. an effect-only attack — leaves this at 0 and heals nothing, which is exactly
  // *"the same amount of damage you did"* when the answer is none. A PREVENTED hit
  // reaches the assignment and stores `dealt`'s own 0. Both arrive as an explicit
  // number rather than as an absent key, so `EffectContext.dealt` is optional only for
  // the runners that are not attacks.
  //
  // ⚠️ **`dealt` AND NOT `clamped`, AND NOT `wouldDeal`, AND NOT THE BASE.** `dealt` is
  // the post-Weakness / post-Resistance / post-reduction / post-prevention figure and
  // is the SAME number `DAMAGE_DEALT.dealt` publishes one push down — so the heal and
  // the log row can never disagree, and the identity is pinned rather than described.
  // `clamped` is the §8.1 KO-SURVIVAL total (a damage TOTAL, not this hit's delta) and
  // its own block says `dealt` is deliberately left unclamped because *"the attack
  // really did deal it"*; a Knocked Out defender likewise does not change what was
  // dealt. `wouldDeal` ignores prevention. `scaledBase` ignores the whole pipeline.
  let dealtToDefender = 0;
  if (scaledBase + scaledTotal > 0) {
    // §8.5 damage pipeline, in printed order: base + the attack's own printed
    // scaling clause (`scaled` — Paldean Tauros "Raging Horns", counted at
    // declaration) + the attacker's continuous pre-W/R bonus (Vitality Band) →
    // Weakness (modern ×2, the old-era +20 prints add) → Resistance (−30) → the
    // defender's continuous damage reduction (Bouffalant "Bouffer" / a defending
    // Tool, §15.B), floored at 0. Weakness/Resistance apply to the Defending
    // Pokémon only, and both continuous reads aggregate printed passives WITH
    // attached Tools (continuous.ts). `scaledTotal` is the attack's own printed
    // extra — the scaling clause's `scaled` plus D126's heads `coinBonus` — added
    // alongside the continuous bonus at the same pre-W/R step, so this branch
    // fires whenever the (multiply-adjusted) base OR the attack's own extra does
    // damage. `scaledBase` is `base` except for a multiply clause, whose printed
    // "N×" base is the per-unit already inside `scaled` — so it is 0 here.
    // §8.5 step 5 (D155) — the printed "During your next turn, this Pokémon's
    // {AttackName} attack does {N} more damage (before applying Weakness and
    // Resistance)", installed onto THIS attacker's own body by its OWN previous
    // attack and addressed to ONE index. Summed with the catalog fold rather than
    // folded into it, for D149's structural reason read from the other direction:
    // `attackerPreWRBonus` scans `passivesOf`, which a §9 Ability-lock aura
    // SUPPRESSES, and an attack INSTALLATION must be immune to that. The other two
    // of D149's three grounds do not apply to a number that only ever ADDS, which
    // is why this half is reported in the same `bonus` field below where the
    // debuff needed one of its own (continuous.ts `boostedAttackDamage`).
    //
    // ⚠️ THIS IS THE ONLY SITE THAT READS IT, and the boundary is the ADDRESS: the
    // record names an attack INDEX, and `index` is in scope here and nowhere else
    // (`EffectContext` carries no attack index, so the interpreter's three damage
    // sites structurally cannot ask). Unreachable rather than merely unbuilt —
    // the one printing's boosted attack does its whole damage through the printed
    // `damage` field and derives no damage-dealing op at all.
    // ⚠️ D192 — THE ONE READ SITE THE ATTACK HALF AND THE ABILITY HALF SHARE, and
    // the ONLY place in this block where either is asked. "Any effects on your
    // opponent's Active Pokémon" is printed BOTH on attacks (15 legal printings,
    // parsed per declaration into `damageSuppression.targetEffects`) and on ONE
    // Ability (Walking Wake ex "Azure Seas", 6 legal printings, a catalog fact read
    // off the ATTACKER through `passivesOf`) — one rule, two printed homes, and
    // this `||` is where they become one answer.
    //
    // THE UNIT OF SHARING IS DECIDED BY THE READ SITE, THE UNIT OF STORAGE BY THE
    // WRITE SITES — this repo's standing rule, and here both halves of it bite.
    // Sharing the read: three steps below consult this local and none of them can
    // tell which half answered, which is the correctness claim. NOT sharing the
    // storage: the attack half is a parse alive for one declaration and immune to
    // §9 (an Ability-lock has nothing to say about attack text), the ability half
    // is a §9-suppressible catalog aura alive while the body is in play. A single
    // field would have to be written by a board scan on every declaration and
    // would get the lock answer wrong on the half that has no Ability.
    //
    // ⚠️ THIS IS ALSO THE FIRST ATTACKER-SIDE `passivesOf` READ THIS FILE MAKES.
    // §8.5 folded `passivesOf(next, defender)` only; the two attacker-side reads it
    // already had (`boostedAttackDamage`, `installedAttackDebuffOf`) are stamps on
    // the attacker's RECORD, not catalog folds. `attackerSuppressesTargetEffects`
    // is the third, reached the same way and named for the same reason.
    const suppressTargetEffects =
      damageSuppression?.targetEffects === true || attackerSuppressesTargetEffects(next, attackerBody);
    const bonus =
      attackerPreWRBonus(next, attackerBody, action.seat, defenderCard) +
      boostedAttackDamage(next, attackerBody, index);
    // §8.5 step 5, the OTHER pre-W/R term (D149) — the printed "attacks used by
    // the Defending Pokémon do {N} less damage (before applying Weakness and
    // Resistance)", installed onto THIS attacker's body by the opponent's
    // previous attack. Subtracted here, one line below the bonus, because the
    // printed parenthetical puts it at the same step; kept a SEPARATE TERM rather
    // than folded into `attackerPreWRBonus` because that number is REPORTED as an
    // addition, is `passivesOf`'s §9-suppressible catalog fold, and never needed
    // the clamp this one does (continuous.ts `installedAttackDebuffOf`).
    //
    // D151 — and the SAME sentence is printed with no duration on an Ability
    // (Entei sv03-030 "Pressure"), so the number has two sources and they are
    // SUMMED here, exactly as the reduction two screens down sums its catalog and
    // installed halves. The aura half is a cross-board scan gated on BOTH Active
    // Spots and §9-suppressible; the installed half is a stamp on this body that
    // no Ability-lock can reach (continuous.ts `opposingAttackDebuff`).
    //
    // D163 — and a THIRD source on the same `−`, which is the FIRST one printed on
    // the attack being used rather than installed onto or aimed at its body:
    // "This attack does {10|20} less damage for each damage counter on this
    // Pokémon." (Skeledirge ex, Cetitan). Summed here for D147's reason, inherited
    // by arriving at the same step in the same direction:
    //
    //   • WHY `debuff` AND NOT `scaled`. `DAMAGE_DEALT` reports one number per STEP
    //     AND DIRECTION, never one per card (D155's invariant, which `bonus`,
    //     `reduction` and `debuff` itself already carry two sources each). This
    //     number is at `scaled`'s step in `debuff`'s direction, and `scaled` is
    //     direction-committed at both of its consumers — the field is emitted only
    //     when `scaledTotal > 0` and log.ts renders it as ` · scaled +N`. So a
    //     negative `scaled` would be silently dropped from the row and, when it did
    //     survive, rendered with two signs.
    //   • WHAT THAT COSTS, stated rather than hidden: a Cetitan swinging under a
    //     Growl reports ONE `debuff`, and no reader can attribute the HP to a card.
    //     That is D141's judgement, unchanged, and it is the same trade `bonus`
    //     made for Vitality Band + D155's installed boost.
    //   • §9 CANNOT REACH IT. The clause is printed on the ATTACK, not on an
    //     Ability, so an Ability-lock (Ting-Lu ex "Cursed Land") silences the
    //     holder's Abilities and leaves this number standing — the same escape
    //     D155's installed boost has, reached from the other end (that one is a
    //     stamp no lock addresses; this one is text no lock is about).
    //   • THE CLAMP IS INHERITED, NOT ADDED. `preWR` floors the WHOLE sum at 0, so
    //     a Cetitan at fifteen counters subtracts its 300 from a base 200 PLUS a
    //     Vitality Band's 10 and reads 0 — not the 10 a per-term clamp would leave.
    //
    // D192 — ⚠️ AND THE AURA HALF IS THE ONE TERM OF THIS SUM THE SUPPRESSION
    // CLAUSE REACHES. `opposingAttackDebuff`'s SOURCE is the opponent's Active
    // Spot ("As long as this Pokémon is in the Active Spot, attacks used by your
    // opponent's Active Pokémon do 20 less damage", Entei sv03-030 "Pressure"), and
    // the printed clause names exactly that body — "any effects on your opponent's
    // ACTIVE Pokémon". So it is nulled below, while the OTHER TWO terms of the same
    // number stand: `installedAttackDebuffOf` is a stamp on the ATTACKER's own
    // record and `printedPenalty` is this attack's own printed clause, and neither
    // is an effect on the defender at all. That is `snipeActive`'s D151 reading
    // verbatim — the one site where `ignoreWR` splits this same sum the same way,
    // for the same reason and with the same two halves surviving.
    //
    // 🆕🆕 ⚠️ **D438 — AND THE SENTENCE ABOVE IS EXACTLY THE KIND D430 SAYS TO
    // RE-CHECK WHEN A CHANNEL IS ADDED, SO IT WAS RE-CHECKED RATHER THAN
    // INHERITED.** `printedPenalty` can now be priced off the DEFENDER: the D438
    // arm's count source is `opponentActiveRetreatCost`, which
    // `scaledAttackDamage` resolves through `effectiveRetreatCost` on the
    // defending body — a fold that itself absorbs Stadiums and retreat auras. So
    // "neither is an effect on the defender at all" is now a claim about the TERM
    // and no longer about the whole computation.
    //   • **THE TERM STILL STANDS UNSUPPRESSED, and the engine had already
    //     answered this for the identical printed noun phrase.** The `more` and
    //     no-adjective twins of D438's sentence read the SAME
    //     `effectiveRetreatCost` through the SAME arm and land in `scaled`, which
    //     `suppressTargetEffects` has never touched — shipped that way since D110
    //     and unchanged through D192. Nulling this one would make three adjectives
    //     of one sentence disagree about whether a §11 board quantity is "an
    //     effect on your opponent's Active Pokémon" (D159 — do not invent a second
    //     answer to a question the engine already answers).
    //   • 🛑 **AND THE INTERACTION IS NOT DRIVEN BY THIS SLICE — SAID PLAINLY
    //     RATHER THAN LEFT TO BE ASSUMED (D433).** `suppressTargetEffects` has two
    //     channels: the D192 SENTENCE, which a whole-sentence anchor means can
    //     never co-occur with D438's on one attack, and
    //     `attackerSuppressesTargetEffects`, an ABILITY passive
    //     (`suppressTargetEffectsOnAttack`, Walking Wake ex "Azure Seas"). Only
    //     the second can reach a D438 attacker, and it is CATALOG-shaped: it is
    //     read through `programFor(id)?.passive`, so driving it needs a REGISTRY
    //     ROW on a fixture that also prints D438's sentence — and a registry row
    //     moves `registryCardIds()`, `REGISTRY_ATTACK_UNITS` and the census's
    //     four-way partition, which is a blast radius this question does not
    //     justify. ⚠️ **AND THE POPULATION THAT COULD REACH IT IS SEVEN ROWS
    //     WIDE**: `registry.ts` carries `suppressTargetEffectsOnAttack` on
    //     `sv05-050`/`-189`/`-205`/`-215`, `sv08.5-178`, `svp-127` (Walking Wake
    //     ex and its five reprints, ONE printed card) and the `fix-azureseas`
    //     demonstrator, whose own attack carries no effect text at all. The six
    //     `sv05`/`sv08.5`/`svp` rows are in NEITHER `catalogManifest.ts` NOR
    //     `FIXTURE_POOL`, so whether Walking Wake ex's own attacks print a scaling
    //     sentence is **not checkable in this checkout** and is left UNRESOLVED
    //     rather than assumed (D425). What is checkable: nothing in the fixture
    //     pool can reach the combination, so no board here drives it. The day a
    //     card carries both, this paragraph is the note that says the answer was
    //     CHOSEN and not stumbled into.
    const debuff =
      installedAttackDebuffOf(next, attackerBody) +
      (suppressTargetEffects ? 0 : opposingAttackDebuff(next, attackerBody)) +
      printedPenalty;
    // §8.5 Weakness, unless the defender's controller has a "your Pokémon have no
    // Weakness" aura in play (Florges "Blooming Garden"); Resistance still applies.
    //
    // D192 — …or unless the attack itself prints "This attack's damage isn't
    // affected by Weakness or Resistance{, or by …}." (10 legal printings).
    // A SECOND null path on a ternary that already had one, which is why this half
    // costs a `||` and no structure: Blooming Garden nulls the DEFENDER's Weakness
    // from its own side of the table, this nulls it from the ATTACKER's, and both
    // arrive at the same "there is no modifier at this step" answer.
    //
    // 🆕🆕 **D432 — …or unless the DEFENDER's own previous attack installed the
    // bar** ("During your opponent's next turn, this Pokémon has no Weakness.",
    // 3 legal printings). A THIRD null path on the same ternary, and the THIRD
    // distinct STORE behind it: D192's is a parse of the attacker's sentence,
    // Blooming Garden's is a seat-wide catalog aura, and this one is a turn stamp
    // on the single body (continuous.ts `installedNoWeakness`, which tabulates the
    // three). Resistance is untouched by all three of the defender-side ones.
    //
    // ⚠️ **THE ORDER OF THE THREE DISJUNCTS IS FREE AND IS SAID SO RATHER THAN
    // LEFT TO BE RE-DERIVED.** All three operands are pure, total and
    // side-effect-free, none narrows a value another dereferences, and `||` is
    // commutative over booleans — so any permutation computes the same `weakness`.
    // (That is NOT true at the twin site: `snipeActive`'s chain carries an
    // `attacker === null` operand that TypeScript's aliased-condition narrowing
    // uses to admit `attacker.card` on the next line, so that one operand is
    // load-bearing wherever it sits. The mutant `D432-snipe-bar-not-read` is the
    // build that drops this line's twin and keeps this one.) They are written
    // cheapest-first only as a courtesy: this one is a field read and an integer
    // compare, the aura scans a seat's bodies.
    //
    // 🛑 **`defender` AND NOT `declaredDefender`** — the D428/D429 rebind. The bar
    // is stamped on a PREVIOUS turn so nothing in the pre-damage seam can move it
    // today, which makes the two spellings equal RIGHT NOW; the live binding is
    // used anyway, because "equal today" is how the stale-local defect gets
    // written, and the seam is one op away from being able to move a body.
    const weakness =
      damageSuppression?.weakness === true ||
      seatRemovesWeakness(next, defenderSeat) ||
      installedNoWeakness(next, defender)
        ? null
        : weaknessOf(attacker, defenderCard);
    // D192 — Resistance has no defender-side null path (nothing in the pool prints
    // "your Pokémon have no Resistance"), so this is its FIRST, and it is its own
    // boolean because 9 legal printings suppress Resistance ALONE ("This attack's
    // damage isn't affected by Resistance." — Landorus sv08-110, Excadrill ex
    // sv10.5b-046 and six siblings).
    const resistance =
      damageSuppression?.resistance === true ? null : resistanceOf(attacker, defenderCard);
    // THE CLAMP IS AT THIS STEP AND NOT ONLY AT THE END, because "this attack does
    // {N} less damage" is a statement about the attack's OUTPUT and an attack does
    // not do negative damage (§8.5's "damage cannot go below 0", read at the step
    // the printed parenthetical names). On every board the pool can print the two
    // placements agree — every catalog Weakness is ×2 and every Resistance −30, so
    // a negative subtotal is still 0 after them — but the engine's own
    // `DamageModifier` admits the old-era ADDITIVE weakness, under which
    // `max(0, −50) + 20 = 20` and `−50 + 20 = −30 → 0` differ. Written at the step
    // it belongs to rather than left to the final floor (damageReduction.test.ts's
    // oracle pins the equivalence as arithmetic).
    const preWR = Math.max(0, scaledBase + scaledTotal + bonus - debuff);
    const afterWR = Math.max(
      0,
      applyDamageModifier(applyDamageModifier(preWR, weakness), resistance),
    );
    const defenderPassives = passivesOf(next, defender);
    // §8.5 step 5, the reduction — the printed "takes {N} less damage from attacks
    // (after applying Weakness and Resistance)", read from BOTH of the places that
    // sentence is printed and SUMMED because each source is its own card effect:
    // the always-on Ability/Tool half off the catalog (Bouffalant "Bouffer",
    // Copperajah ex "Bronze Body", and — since D161 and NOT before it, though this
    // comment claimed otherwise from 0.96.0 — Rock Chestplate sv01-192) and, since
    // D147, the DURATED half installed onto the board by an attack ("During your
    // opponent's next turn, …"). Same sentence, same step, one number — which is
    // the whole reason this site's diff is a `+` (continuous.ts
    // `installedReductionOf`).
    //
    // D161 — and a THIRD source on the same `+`: the OWN-SIDE seat-wide aura
    // ("All of your Pokémon take 10 less damage…", Hariyama sv02-113), which rides
    // neither of the first two because it is not a fact about the holder's own
    // card and is not stamped on the board. `"all"` here: this site has no
    // `ignoreWR`, so every source counts (continuous.ts `seatDamageReduction`).
    //
    // ⚠️ D192 — AND THAT LAST SENTENCE IS NO LONGER TRUE, WHICH IS THIS SLICE'S
    // ONE CORRECTION TO AN EXISTING COMMENT. This site now HAS a suppression, so
    // the three-term sum splits exactly as the two snipe arms' does and the arm
    // is the same arm: the catalog half and the installed half are both "effects
    // on your opponent's Active Pokémon" and both go, while the SEAT-WIDE aura
    // drops to `"othersOnly"` rather than to zero. D161's reading, inherited
    // whole: the aura's source set CONTAINS its target set, so the clause reaches
    // exactly the part of it the defending body is granting ITSELF. A Hariyama
    // standing in the Active Spot loses its own 10 to a Koraidon "Shred"; a
    // Hariyama on the Bench keeps shielding its Active teammate through it.
    const reduction = suppressTargetEffects
      ? seatDamageReduction(next, defender, "othersOnly")
      : defenderPassives.damageReductionAfterWR +
        installedReductionOf(next, defender) +
        seatDamageReduction(next, defender, "all");
    // §8.5 Mimikyu "Safeguard": prevent ALL damage from an opponent's Pokémon
    // ex/V. A full null (not a flat reduction), gated on the ATTACKER's rule-box
    // class, so it supersedes any Bouffer-style reduction.
    //
    // D142 — its DURATED twin sits beside it on the same `||`, and the pairing is
    // the point: one is an always-on printed ABILITY read out of the CATALOG and
    // gated on the attacker's rule box, the other an INSTALLATION written onto
    // the board by an attack and gated on the TURN ("During your opponent's next
    // turn, prevent all damage … done to this Pokémon."). Both null the damage
    // outright rather than reducing it, so both land here, after Weakness,
    // Resistance and the reduction passive have been computed and before any of
    // them can matter — which is what makes them supersede rather than stack.
    // No `invokedBy` check on this arm: this IS the attack.
    //
    // D146 — the durated twin may also be narrowed to attacks FROM a class of
    // attacker ("…by attacks from Basic Pokémon"), which is why `attacker` is
    // handed to `attackBlockOf` rather than only to `isExOrV` beside it. The two
    // now read the SAME card for the same kind of question — one off the printed
    // rule box, one off the printed stage — and the pairing is tighter than it was
    // at D142: an installed block gated on the attacker is the catalog aura's
    // shape with the source of the gate moved from the card to the board.
    //
    // D159 — and the ALWAYS-ON half of the attacker-filter family widens the same
    // `||` from two terms to five, in two groups the printed text draws apart:
    //   • ON-TARGET — an effect on the damaged Pokémon itself. `preventDamageFromExV`
    //     and the type filter beside it are catalog auras on the HOLDER (so both
    //     are §9-suppressible through `passivesOf`); the block is an installation
    //     on the holder's own record. At the two snipe arms `ignoreWR` nulls all
    //     three, which is where the grouping becomes observable.
    //   • OFF-TARGET — a rule whose SOURCE is some other body or no body at all:
    //     the shielding Active on the target's own side, and the shared Stadium.
    //     `ignoreWR` reaches neither.
    // Both off-target reads are FALSE by construction here — the main hit's
    // defender is an Active, which is neither benched nor able to hold a §9 lock's
    // answer — and are made anyway, for the reason `attackDamageBlocked`'s Bench
    // arms are guarded: these sites must be TOTAL rather than case-covering.
    //
    // ⚠️ D192 — AND THE GROUPING D159 DREW HERE FOR LEGIBILITY IS NOW LOAD-BEARING
    // AT THIS SITE TOO. The ON-TARGET trio goes inside the suppression guard (they
    // are effects on the damaged Active — two catalog auras on the holder and one
    // installation on its own record); the OFF-TARGET pair stays OUTSIDE it,
    // VERBATIM, because neither is an effect on that Pokémon: the shielding Active
    // belongs to the target's own side and a Stadium is an effect on no Pokémon at
    // all. That is `placeSnipe`'s and `snipeActive`'s split, arriving here
    // unchanged — and the parenthesisation below is copied from them rather than
    // re-derived. Both off-target reads remain FALSE by construction on this path
    // (the main hit's defender is an Active) and are still made, for
    // `attackDamageBlocked`'s totality reason.
    //
    // ⚠️ D240 — AND THE NUMBER THE CAP IS ABOUT IS COMPUTED FIRST, WHICH IS WHY
    // `wouldDeal` exists. `AttackBlock.maxDamage` ("if that damage is 40 or less")
    // is read against the damage that would ACTUALLY be placed — post-Weakness,
    // post-Resistance, post-reduction, floored at 0 — so the subtraction that used
    // to be inline in `dealt` is hoisted ABOVE `prevented` and named. `dealt` is
    // then the same expression it always was, spelled once instead of twice, and
    // the whole reading is argued at continuous.ts `attackBlockOf`.
    const wouldDeal = Math.max(0, afterWR - reduction);
    // D258 — RENAMED, and the rename is the whole diff at this site. Everything the
    // seven pure preventions decide is `preventedBeforeFlip`; the coin-flip shield
    // is asked AFTER it, on the number that would still land, because a coin drawn
    // for damage a Stadium already stopped is a coin the printed rules never draw.
    const preventedBeforeFlip =
      (!suppressTargetEffects &&
        ((defenderPassives.preventDamageFromExV && isExOrV(attacker)) ||
          preventsAttackerType(defenderPassives.preventDamageFromTypes, attacker) ||
          // D251 — the THIRD attacker-property prevent, at the FIRST of this
          // gate's FOUR read sites (the other three are interpreter.ts's spread,
          // `deals` and snipe arms). Inside the suppression guard with its two
          // siblings, because it is an effect ON the damaged Pokémon: a catalog
          // aura on the holder, so `ignoreWR` nulls it exactly as it nulls them.
          (defenderPassives.preventDamageFromHasAbility && hasPrintedAbility(attacker)) ||
          // D255 — the SIXTH prevent, at the FIRST of its FOUR read sites (the other
          // three are interpreter.ts's spread, `deals` and `snipeActive`). FOUR and
          // not five: the two printed sentences say "prevent all damage", not "from
          // and effects of", so `attackEffectRefused` is deliberately not widened.
          // Inside the suppression guard with its siblings, because it is an effect
          // ON the damaged Pokémon: a catalog aura on the holder, so `ignoreWR` nulls
          // it exactly as it nulls them. `attacker` and not `active`: this gate is a
          // fact about the attacking body's printed ROW (name suffix + stage), which
          // is `hasPrintedAbility`'s subject one line up and not D252's board read.
          preventsAttackerClass(defenderPassives.preventDamageFromAttackerClasses, attacker) ||
          // D252 — the FOURTH attacker-property prevent, at the FIRST of its FIVE
          // read sites (the other four are interpreter.ts's spread, `deals` and
          // snipe arms, plus `attackEffectRefused` — the fifth is what makes this
          // family's first WIDE spelling wide). `attackerBody` and not `attacker`: this
          // gate is a fact about the attacking BODY's attachments, not about its
          // printed row. 🆕 D429 RE-POINTED IT FROM `active` TO THE POST-SEAM BINDING —
          // the sentence said "the InPlayPokemon this site has held since §8.5 step 1",
          // and since D429 that object can be one row 72 stripped. It reads ENERGY and
          // row 72 takes TOOLS, so no printing moves the answer today; re-pointed anyway,
          // because leaving one §8.5 read on the snapshot is how the next one gets
          // written that way. Inside the suppression guard with its three siblings, for
          // their reason verbatim.
          (defenderPassives.preventDamageAndEffectsFromSpecialEnergy &&
            attackerHasSpecialEnergy(next, attackerBody)) ||
          // D253 — the fifth prevent, at the FIRST of its five read sites, and the
          // first of the three that are DEAD BY CONSTRUCTION: this arm damages the
          // defending ACTIVE (§8), and the flag is false for any body that is not
          // on a bench because `passivesOf` already resolved the zone clause. No
          // predicate call beside it for that same reason — a HOLDER gate folds.
          // Read anyway so the arm stays TOTAL rather than case-covering, which is
          // this family's standing shape (`attackDamageBlocked`'s Bench arms).
          defenderPassives.preventDamageAndEffectsWhileBenched ||
          // D257 — the SEVENTH prevent, at the FIRST of its FOUR read sites (the
          // other three are interpreter.ts's spread, `deals` and `snipeActive`),
          // and the FIRST MEMBER OF THIS FAMILY WHOSE GATE IS THE NUMBER RATHER
          // THAN A BODY. Inside the suppression guard with its six siblings,
          // because it is an effect ON the damaged Pokémon: a catalog aura on the
          // holder, so `ignoreWR` nulls it exactly as it nulls them.
          //
          // ⚠️ THIS IS THE ONE SITE OF THE FOUR WHERE THE PRINTED SENTENCE IS MOST
          // AT HOME, WHICH INVERTS THIS RUN'S USUAL LIVE/DEAD SPLIT. "Prevent all
          // damage done to THIS Pokémon" carries no zone clause at all, so unlike
          // D253/D254/D256 nothing here is dead by construction — an Impervious
          // Shell holder is protected in the Active Spot and on the Bench alike,
          // and all four arms fire on real boards for the first time since D255.
          //
          // ⚠️ AND IT SITS BELOW `attackBlockOf`'s SIBLING RATHER THAN INSIDE IT.
          // The installed §11 cap (`AttackBlock.maxDamage`, D240) reads the SAME
          // `wouldDeal` and answers the OPPOSITE polarity; the two are different
          // CHANNELS — a stamp on the target's own record with a turn's life
          // versus a catalog fold with none — so they are ORed, never merged.
          // `attackBlockOf` is deliberately not taught "or more": the attack
          // column prints ZERO such printings (re-measured at D257), so a merged
          // comparator would be a field with no writer on one side and no reader
          // on the other.
          preventedByDamageThreshold(defenderPassives.preventDamageAtOrAbove, wouldDeal) ||
          attackBlockOf(next, defender, attacker, wouldDeal) !== null)) ||
      // D254 — the scan's signature gains `scope` and this site passes "all",
      // which costs nothing because the site is DEAD for both of the scan's
      // sentences and always has been: `defender` is the defending ACTIVE (§8) and
      // the TARGET clause both printings share reads "your BENCHED Pokémon". The
      // deadness is INHERITED here rather than introduced by Rabsca — worth the
      // line, because D253's identically-shaped note is about a field that could
      // in principle have been live at its site and this one never could.
      benchShieldedFromDamage(next, defender, "all") ||
      stadiumPreventsDamage(next, defender, attacker);
    // D258 — the EIGHTH prevent, at the FIRST of its FOUR read sites (the other three
    // are interpreter.ts's spread, `deals` and `snipeActive`), and the family's FIRST
    // ONE THAT IS NOT AN EXPRESSION. It cannot be a disjunct above: it draws from
    // `rngState` and emits a row, so it needs a statement, the advanced state written
    // back, and a guaranteed position — LAST.
    //
    // ⚠️ THE ARGUMENT IS THE DAMAGE THAT WOULD STILL LAND, WHICH FOLDS THREE "DON'T
    // FLIP" REASONS INTO ONE NUMBER: already prevented above, `suppressTargetEffects`
    // (Feint Attack's clause nulls a catalog aura on the damaged body, exactly as it
    // nulls this gate's seven siblings), and a reduction that floored `wouldDeal` at
    // 0. All three mean the printed antecedent — "is damaged by an attack" — is
    // FALSE, and the funnel's doc block argues why that is a rule and not a
    // shortcut.
    //
    // ⚠️ AND THE ROW LANDS BEFORE `DAMAGE_DEALT`, which is the order the sentence
    // prints: the flip happens, then the damage does or does not. `next` is
    // re-bound with the advanced `rngState` immediately, so the `withSide` below —
    // and every later draw in the game — reads the state this coin left behind.
    const [flipPrevented, rngState] = coinFlipShieldPrevents(
      next,
      defender,
      defenderSeat,
      preventedBeforeFlip || suppressTargetEffects ? 0 : wouldDeal,
      events,
    );
    next = { ...next, rngState };
    const prevented = preventedBeforeFlip || flipPrevented;
    const dealt = prevented ? 0 : wouldDeal;
    // 🆕🆕 D427 — published to the effect program on `EffectContext.dealt`. Assigned
    // HERE, beside the declaration, rather than recomputed at the call site: there is
    // one §8.5 answer and one place that knows it.
    dealtToDefender = dealt;
    // §8.1 (D208) — THE KO-SURVIVAL CLAMP, read HERE and not at the KO sweep. The
    // printed antecedent is "has full HP", a fact about the PRE-damage board, and
    // `defender` is the last binding in the whole §8 sequence that still holds it:
    // one line down the pre-hit total is gone and no downstream site can recover
    // it. `dealt` is deliberately NOT clamped — the attack really did deal it, and
    // the `dealt > 0` gates below (Rocky Helmet's `damageAttacker`, the
    // `onDamagedByAttack` trigger) must still see the damage that happened.
    const clamped = koSurvivalClamp(next, defender, dealt);
    defended = { ...defender, damage: clamped ?? defender.damage + dealt };
    next = withSide(next, defenderSeat, { ...next.players[defenderSeat], active: defended });
    events.push({
      type: "DAMAGE_DEALT",
      seat: defenderSeat,
      // 🆕🆕 D425 — the §8.5 main hit's dealer is the declaring seat, always.
      by: action.seat,
      uid: defenderUid,
      base: scaledBase,
      // Present only when the attack's own printed extra actually added HP — the
      // count-scaling clause's `scaled` or D126's heads bonus, which land at the
      // same pre-W/R step and are reported through the same field.
      scaled: scaledTotal > 0 ? scaledTotal : undefined,
      // Present only when a continuous effect actually moved the total.
      bonus: bonus > 0 ? bonus : undefined,
      // …and, since D149, the pre-W/R SUBTRACTION beside it — reported in its own
      // field rather than as a negative `bonus`, so the row still reconstructs the
      // pipeline in printed order (events.ts).
      debuff: debuff > 0 ? debuff : undefined,
      weakness,
      resistance,
      reduction: reduction > 0 ? reduction : undefined,
      prevented: prevented ? true : undefined,
      survived: clamped === null ? undefined : true,
      dealt,
      damage: defended.damage,
    });

    // §9 reactive recoil — a defender with Counterattack Quills / Custom Trap
    // (the `damageAttacker` passive) puts damage counters on the Attacking
    // Pokémon when it is DAMAGED (`dealt > 0`), even if it was Knocked Out: this
    // runs BEFORE finishAttack's both-board §8.1 sweep (below, or in the
    // attackEpilogue after the program), so a lethal retaliation KOs the attacker
    // and is prized to the defender's side. Flat counters OUTSIDE the §8.5
    // pipeline (no Weakness/Resistance) — the confusion-self-hit / damageSelf
    // model. The attacker is this seat's Active (attacks come from the Active,
    // and its own effect program has not run yet); `active` is unchanged in
    // `next`, which only updated the rngState + the defender's side.
    //
    // D141 — the row is labelled `"counterattack"` (the MECHANISM), never
    // `"ability"` (a provenance) and never a `"tool"` beside it. `recoil` here is
    // the SUM `passivesOf` folded out of the holder's own passive AND every
    // attached Tool, with no provenance surviving the addition, so this site
    // CANNOT know which card granted it — and on the one board Stunfisk sv03-112
    // is designed for (its Ability is gated on having a Tool at all) the number is
    // an Ability's 50 plus Rocky Helmet sv01-193's 20 in ONE event. Two
    // provenances, one label: no provenance label can be true of that row, so the
    // label names what happened instead. `seat` is the ATTACKER's — it owns the
    // DAMAGED Pokémon, per this event's contract — while the CAUSER is the
    // defender, which is why the log row is SYSTEM-voiced (D136's finding 1); and
    // unlike the `"ability"` placements there is no ABILITY_TRIGGERED row above to
    // name a source, so this label is the whole of what a reader is told.
    //
    // D152 — and the sentence is ALSO printed with a DURATION on an attack
    // (Lycanroc ex sv02-117/-241 "Scary Fangs", 10 counters), so the number has
    // two sources and they are SUMMED here, exactly as the reduction two screens
    // up sums its catalog and installed halves. The installed half is a stamp on
    // this body that no Ability-lock can reach; the catalog half is the
    // §9-suppressible fold (continuous.ts `installedRecoilOf`). D141's judgement
    // survives it unchanged and is in fact strengthened: the row can now be an
    // Ability's, a Tool's AND an attack's HP in one number, so a provenance label
    // is wrong on a THIRD axis and the mechanism label needs no new member.
    // 🆕🆕 D456 — `dealt` reaches `installedRecoilOf` for corpus line 180's unprinted
    // amount (*"…equal to the damage done to this Pokémon."*). It is the SAME local
    // the `if` on the next line gates on and the SAME number `DAMAGE_DEALT.dealt`
    // published one push up, so the row, the gate and the retaliation cannot disagree.
    // ⚠️ `dealt` AND NOT `clamped`: a KO-survival clamp is a damage TOTAL, and this
    // sentence asks what the attack DID (D427's identical choice one field over).
    const recoil = defenderPassives.damageAttacker + installedRecoilOf(next, defender, dealt);
    if (dealt > 0 && recoil > 0) {
      const retaliated = { ...attackerBody, damage: attackerBody.damage + recoil };
      next = withActive(next, action.seat, retaliated);
      events.push({
        type: "COUNTERS_PLACED",
        seat: action.seat,
        uid: attackerUid,
        amount: recoil,
        source: "counterattack",
      });
    }

    // §9 reactive trigger — a defender with an `onDamagedByAttack` Ability
    // (Armarouge "Scorching Armor" Burns the attacker; Klawf ex "Counterattacking
    // Pincer" discards an Energy from it) reacts when it is DAMAGED (`dealt > 0`),
    // even if Knocked Out. Recorded here for the main-hit Active defender — a
    // benched holder hit by spread does not react, matching the "in the Active
    // Spot" clause (the read site enforces it) — and run as a staged epilogue
    // (below) AFTER the attack's own effect program but BEFORE finishAttack's §8.1
    // sweep, so "even if Knocked Out" stays free AND Klawf's opponent-side discard
    // decision can PARK (the stage carries a resumeTail into the epilogue). Seeded
    // only when such an Ability is actually present (and not §9-locked), so every
    // other damaging attack keeps its exact pre-slice queue.
    if (dealt > 0 && damagedByAttackAbility(next, defenderSeat, defenderUid) !== undefined) {
      damagedTriggerStage = { kind: "damagedTrigger", seat: defenderSeat, uid: defenderUid };
    }
  }

  // §8 step 4 — the attack's own effect program runs AFTER the damage, in printed
  // order (a defender-targeted status lands even on a lethal hit — the condition
  // vanishes with the stack at the KO below), and the §9 reactive damagedTrigger
  // of the damaged Active runs after THAT; both precede finishAttack's §8.1 sweep.
  //
  // Either can PARK ("Discard an Energy from this Pokémon" with two different
  // Energy attached; Klawf ex's opponent-side discard), so the tail is STAGED: the
  // attackEpilogue (finishAttack) sits at the end, the damagedTrigger in front of
  // it when the defender reacts, and the attacker's effect program — when present —
  // runs first through settleProgram with `resumeTail`, draining into that queue. A
  // DONE program drains straight through; a parked one leaves the queue in
  // `pending` until resolveEffect finishes it. APPENDED not assigned: turn:action
  // never carries a tail (its three writers all leave it empty), so this equals a
  // fresh queue but stays honest if a stage somehow WERE queued.
  // §8.1 (D171) — a POKÉMON TOOL on the defender's board whose printed sentence
  // fires on their ACTIVE being Knocked Out by this attack (Exp. Share sv01-174
  // rescues a Basic Energy off the dying body onto its own holder). Seeded on
  // PRESENCE alone — "does this board carry such a Tool at all" — and NOT on
  // `dealt > 0` like the reactive trigger above it, because the printed condition
  // is the KO rather than the damage: an attack that deals no main-hit damage and
  // then snipes its own defender lethally through its effect program is still a
  // Knock Out "by damage from an attack". The whole antecedent is re-derived at run
  // time (flow.ts runKoToolTrigger re-checks "still the Active" AND "still lethal"),
  // so this gate is only about keeping the pending queue byte-identical for every
  // board with no such Tool on it.
  //
  // ⚠️ IT MUST SIT AHEAD OF `attackEpilogue`, and that is the only window in the
  // whole §8.1 sequence: `finishAttack`'s own `koRecoilOf` is earlier but cannot
  // PARK, and the KO sweep's `koTrigger` stages are all queued AFTER `knockOut` has
  // discarded the dying stack — Energy included. It sits BEHIND the damagedTrigger
  // because "damaged" precedes "Knocked Out" in the same instant, and because a
  // reaction that heals or switches the defender should be able to unmake the KO
  // this stage is conditioned on.
  //
  // The stage carries the SEAT alone: both the dying body and the Tool's bearer are
  // re-read off the live board when it runs, so nothing measured here can go stale.
  const koToolStage: PendingStage | null =
    koToolTriggersOf(next, defenderSeat, defenderUid).length > 0
      ? { kind: "koToolTrigger", seat: defenderSeat }
      : null;
  const epilogue: PendingStage[] = [
    ...(damagedTriggerStage === null ? [] : [damagedTriggerStage]),
    ...(koToolStage === null ? [] : [koToolStage]),
    // ⚠️ `uid` IS THE ATTACKER AS OF DECLARATION (D189), and this is the only
    // place in the engine that knows it for certain. `attackerUid` was captured
    // at the top of this function, BEFORE the §8.5 pipeline and before the effect
    // program below — which is the whole point, since that program may now derive
    // a self-switch and put the attacker on its own Bench. Every other stage in
    // this queue either re-reads its subject off the live board or names a body
    // that cannot move; this one names a body that CAN, and remembers it.
    // 🆕🆕 D394 — `attack` rides beside `uid` for the SAME reason and is captured at
    // the SAME instant: `finishAttack` stamps `usedAttack` with the printed name,
    // and this is the one route into it where `declared` is out of scope by then.
    { kind: "attackEpilogue", seat: action.seat, uid: attackerUid, attack: declared.name },
  ];
  if (program !== null) {
    return settleProgram(
      runProgram(
        { ...next, pending: [...next.pending, ...epilogue] },
        program,
        // The attacker is "this Pokémon" (§8) — by uid rather than "the Active",
        // which stays truthful if the program itself moves it off the spot.
        // `invokedBy: "attack"` is set HERE and in no other runProgram call in
        // the engine: it is what lets a defender's §11 block tell an ATTACK's
        // effect from a Trainer's or an Ability's (D142, interpreter.ts
        // EffectContext), and it rides the continuation so an attack effect that
        // PARKS is still an attack's effect when it resolves.
        //
        // 🆕🆕 D427 — `dealt` rides in the SAME object literal as `invokedBy`, on
        // purpose: both are facts only this call site knows, both are optional keys on
        // a context that rides `EffectContinuation` into the persisted `phase.cont`,
        // and keeping them together is what makes
        // `invokedBy === "attack"` ⟺ `dealt !== undefined` true of every continuation
        // this engine writes. A widening either way, so `MATCH_RECORD_VERSION` stays 26.
        { seat: action.seat, sourceUid: attackerUid, invokedBy: "attack", dealt: dealtToDefender },
        events,
      ),
      action.seat,
      events,
      { resumeTail: true },
    );
  }

  // No effect program. When the defender reacts — a §9 onDamagedByAttack Ability or
  // a D171 on-KO Tool — drain [trigger…, epilogue] through advance (either may park;
  // the epilogue behind them resumes on resolve). Otherwise the epilogue alone is
  // exactly finishAttack — its advance case pops itself and calls it — so keep the
  // direct call for the common no-reaction path (byte-identical to the pre-slice
  // tail).
  if (damagedTriggerStage !== null || koToolStage !== null) {
    return advance({ ...next, pending: [...next.pending, ...epilogue] }, events);
  }

  // §8.1 Knock Out sweep on both boards, then the §5.3 turn end. With no effect
  // program there is no recoil, so only the defender's board can be lethal, but the
  // sweep stays total (finishAttack owns the order + the §14 tie).
  return finishAttack(next, events, action.seat, attackerUid, declared.name);
}

/** The interrupt phases that park the tail on a ko:* decision (§8.1). */
type KoPhase = Extract<Phase, { kind: "ko:takePrizes" | "ko:promote" }>;

/** The gate the two ko:* decision handlers share — the interrupt twin of
    turnGate: right interrupt phase, right seat. Hands back the narrowed
    phase (via the intersection TS cannot derive from a generic discriminant
    check itself) so takePrizes keeps `phase.count`. */
function interruptGate<K extends KoPhase["kind"]>(
  state: GameState,
  action: { type: GameAction["type"]; seat: Seat },
  kind: K,
):
  | { phase: KoPhase & { kind: K }; reject?: undefined }
  | { phase?: undefined; reject: ApplyResult } {
  const phase = state.phase;
  if (phase.kind !== kind) {
    return { reject: err("BAD_PHASE", `${action.type} is not legal during ${phase.kind}`) };
  }
  const narrowed = phase as KoPhase & { kind: K };
  if (narrowed.seat !== action.seat) {
    return { reject: err("WRONG_SEAT", `only ${narrowed.seat} resolves this Knock Out (§8.1)`) };
  }
  return { phase: narrowed };
}

// Parking DUAL-ENCODES a decision — the ko:* phase carries a copy of the
// head pending stage's fields — and resolving trusts the QUEUE, so both
// handlers cross-check that the head still agrees with the phase before
// popping it. A mismatch is unreachable through the engine's own transitions
// (advance always writes both together): it means a crafted or corrupted
// snapshot, and resolving it would act out the WRONG stage (e.g. take
// phase.count prizes while popping a different-count stage). M3 may collapse
// the two encodings into one.

/** The ko:takePrizes decision (§8.1): the KOing player names which of their
    own face-down prize slots to reveal into hand. */
export function takePrizes(state: GameState, action: TakePrizesAction): ApplyResult {
  const gate = interruptGate(state, action, "ko:takePrizes");
  if (gate.reject) return gate.reject;
  const phase = gate.phase;
  const head = state.pending[0];
  if (head?.kind !== "takePrizes" || head.seat !== phase.seat || head.count !== phase.count) {
    return err("PHASE_DESYNC", "the ko:takePrizes phase disagrees with the pending queue head");
  }
  const indices = action.prizeIndices;
  // Wire checks: the array itself, its length (bounding the scans below),
  // then each element — integer, in range, no repeats.
  if (!Array.isArray(indices) || indices.length !== phase.count) {
    return err("BAD_PRIZE_COUNT", `must pick exactly ${phase.count} prize(s)`);
  }
  const prizes = state.players[action.seat].prizes;
  const seen = new Set<number>();
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= prizes.length) {
      return err("BAD_PRIZE_INDEX", `no prize at index ${String(index)}`);
    }
    if (seen.has(index)) {
      return err("BAD_PRIZE_INDEX", `prize index ${index} picked twice`);
    }
    seen.add(index);
  }
  // Resolve through the shared flow.ts helper: its win check runs before the
  // tail resumes — taking the last prize ends the game before any promotion
  // is prompted (§14.1).
  return resolvePrizesAndResume(state, action.seat, indices, []);
}

/** The ko:promote decision (§8.1): the KO'd player picks the benched
    Pokémon that takes the empty Active spot. */
export function promote(state: GameState, action: PromoteAction): ApplyResult {
  const gate = interruptGate(state, action, "ko:promote");
  if (gate.reject) return gate.reject;
  const head = state.pending[0];
  if (head?.kind !== "promote" || head.seat !== action.seat) {
    return err("PHASE_DESYNC", "the ko:promote phase disagrees with the pending queue head");
  }
  // An occupied Active spot means no promotion is owed — the guard mirrors
  // `advance`'s (flow.ts), which SKIPS the stage on its auto-resolve path;
  // here the action names a decision that does not exist, so it is rejected
  // (resolving anyway would overwrite the occupant's whole stack, with no
  // event). Unreachable in M2: nothing refills the spot while parked.
  if (state.players[action.seat].active !== null) {
    return err("ACTIVE_ALREADY_PLACED", "the Active spot is already occupied");
  }
  const index = action.benchIndex;
  // Same wire trap as retreat's promote index (see turn.ts).
  if (!isBenchIndex(index) || state.players[action.seat].bench[index] === undefined) {
    return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(index)}`);
  }
  return resolvePromotionAndResume(state, action.seat, index, []);
}
