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
  hasPrintedAbility,
  isExOrV,
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
  countEnergyInPlay,
  countToolsInPlay,
  effectiveAttackCost,
  effectiveRetreatCost,
  firstTurnAttackBanned,
  installedAttackDebuffOf,
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
  deriveAttackRequirement,
  optionalBoostProgram,
  discardScaledBoostProgram,
  optionalCostBoostProgram,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackTrailingClause,
  splitAttackRequirementClause,
} from "./effects";
import type { AttackDamageBonus, AttackFlipCount, EffectOp } from "./effects";
import type { GameEvent } from "./events";
import {
  advance,
  finishAttack,
  resolvePrizesAndResume,
  resolvePromotionAndResume,
  settleProgram,
} from "./flow";
import {
  attackBarredByAbility,
  attackTimingBlocked,
  attackTimingNote,
  attackerPreWRBonus,
  conditionHolds,
  conditionNote,
  runProgram,
} from "./interpreter";
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
    signature nothing for exactly that reason. */
function scaledAttackDamage(
  attacker: InPlayPokemon,
  bonus: AttackDamageBonus,
  state: GameState,
  defenderSeat: Seat,
  attackerSeat: Seat,
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
      const bench = state.players[attackerSeat].bench;
      return (
        bench.reduce((total, p) => total + (p !== null ? Math.floor(p.damage / 10) : 0), 0) *
        bonus.per
      );
    }
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
      return benchBodies(state, attackerSeat) * bonus.per;
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
function benchBodies(state: GameState, seat: Seat): number {
  return state.players[seat].bench.reduce((total, p) => total + (p !== null ? 1 : 0), 0);
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
  const flips =
    count.kind === "printed"
      ? count.count
      : countAttachedEnergy(state, state.players[attackerSeat].active ?? attacker, count.energy);
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
  const { active: defender, uid: defenderUid, card: defenderCard } = defenderSpot;

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
      const hurt = { ...active, damage: active.damage + 30 };
      next = withActive(next, action.seat, hurt);
      events.push({
        type: "COUNTERS_PLACED",
        seat: action.seat,
        uid: attackerUid,
        amount: 30,
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
  // `programPerHeads` coin member is expanded into `heads` copies of its ops and
  // APPENDED here, so the attack's existing tail runs them with no new channel.
  // Nothing else in this function writes it.
  let program = authored ?? derived;
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
  // The absence is measured, asserted in damageSuppression.test.ts, and is also
  // the reason `weakness` below is its OWN boolean: two of those five print
  // "…isn't affected by Weakness." with no Resistance beside it.
  const damageSuppression =
    effect === null || effect === "" ? null : deriveAttackDamageSuppression(effect);
  const scaling = damageBonus ?? damageMultiplier;
  const scaled =
    scaling === null ? 0 : scaledAttackDamage(active, scaling, next, defenderSeat, action.seat);
  // `per × count` off the SAME evaluator the two adding readers use (D159's rule —
  // no second answer to a question the engine already answers), counted at
  // DECLARATION like every other member of the family, so this attack's own damage
  // cannot bootstrap the counters it reads.
  const selfPenalty =
    damagePenalty === null
      ? 0
      : scaledAttackDamage(active, damagePenalty, next, defenderSeat, action.seat);
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
    coinFlip?.kind === "perHeads"
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
  const effectSimulated =
    program !== null ||
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
  const coinExplainsModifier =
    coinFlip !== null && coinFlip.kind !== "cancelOnTails" && coinFlip.kind !== "programPerHeads";
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
    const [faces, rngState] =
      coinFlip.kind === "cancelOnTails"
        ? takeFlips(next, action.seat, active, ONE_FLIP)
        : takeFlips(next, action.seat, active, coinFlip.flips);
    next = { ...next, rngState };
    let heads = 0;
    for (const face of faces) {
      events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat: action.seat, result: face });
      if (face === "heads") heads += 1;
    }
    if (coinFlip.kind === "cancelOnTails") {
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
    } else if (coinFlip.kind === "programPerHeads") {
      // D130 — THE EXPANSION. One copy of the member's ops per heads, in flip
      // order, appended to whatever program the attack already had. A `flat` over
      // `heads` references to the SAME array is safe because `EffectOp`s are plain
      // frozen-by-convention data the interpreter never mutates — every op reads
      // its own fields and writes only the state it returns — so the copies share
      // structure rather than needing one.
      const repeated: EffectOp[] = [];
      for (let i = 0; i < heads; i += 1) repeated.push(...coinFlip.ops);
      const expanded = [...(program ?? []), ...repeated];
      // Back to NULL when nothing came out of it (zero heads and no prior program),
      // because null is what the tail below tests for: an empty `EffectOp[]` would
      // route the attack through `settleProgram` to say nothing at all, which is a
      // different ending with the same result, and "different ending" is how a
      // no-op grows a KO sweep it did not have.
      program = expanded.length > 0 ? expanded : null;
    } else {
      coinBonus = heads * coinFlip.per;
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

  let defended = defender;
  // §9 — the damaged Active's reactive onDamagedByAttack Ability, recorded at
  // damage time but run as a staged epilogue below (so a PARKING discard survives).
  let damagedTriggerStage: PendingStage | null = null;
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
      damageSuppression?.targetEffects === true || attackerSuppressesTargetEffects(next, active);
    const bonus =
      attackerPreWRBonus(next, active, action.seat, defenderCard) +
      boostedAttackDamage(next, active, index);
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
    // record and `selfPenalty` is this attack's own printed clause, and neither is
    // an effect on the defender at all. That is `snipeActive`'s D151 reading
    // verbatim — the one site where `ignoreWR` splits this same sum the same way,
    // for the same reason and with the same two halves surviving.
    const debuff =
      installedAttackDebuffOf(next, active) +
      (suppressTargetEffects ? 0 : opposingAttackDebuff(next, active)) +
      selfPenalty;
    // §8.5 Weakness, unless the defender's controller has a "your Pokémon have no
    // Weakness" aura in play (Florges "Blooming Garden"); Resistance still applies.
    //
    // D192 — …or unless the attack itself prints "This attack's damage isn't
    // affected by Weakness or Resistance{, or by …}." (10 legal printings).
    // A SECOND null path on a ternary that already had one, which is why this half
    // costs a `||` and no structure: Blooming Garden nulls the DEFENDER's Weakness
    // from its own side of the table, this nulls it from the ATTACKER's, and both
    // arrive at the same "there is no modifier at this step" answer.
    const weakness =
      damageSuppression?.weakness === true || seatRemovesWeakness(next, defenderSeat)
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
          // family's first WIDE spelling wide). `active` and not `attacker`: this
          // gate is a fact about the attacking BODY's attachments, not about its
          // printed row, and `active` is the InPlayPokemon this site has held since
          // §8.5 step 1. Inside the suppression guard with its three siblings, for
          // their reason verbatim.
          (defenderPassives.preventDamageAndEffectsFromSpecialEnergy &&
            attackerHasSpecialEnergy(next, active)) ||
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
    const recoil = defenderPassives.damageAttacker + installedRecoilOf(next, defender);
    if (dealt > 0 && recoil > 0) {
      const retaliated = { ...active, damage: active.damage + recoil };
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
        { seat: action.seat, sourceUid: attackerUid, invokedBy: "attack" },
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
