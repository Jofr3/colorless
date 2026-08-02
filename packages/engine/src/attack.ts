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
  isExOrV,
  parseAttackDamage,
  resistanceOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
import {
  attackBlockOf,
  attackLocked,
  countAttachedEnergy,
  effectiveAttackCost,
  effectiveRetreatCost,
  installedAttackDebuffOf,
  installedReductionOf,
  opposingAttackDebuff,
  passivesOf,
  providedEnergy,
  seatRemovesWeakness,
} from "./continuous";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
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
import { attackerPreWRBonus, conditionHolds, runProgram } from "./interpreter";
import { programFor } from "./registry";
import { flipCoin, flipUntilTails, MAX_UNTIL_TAILS_FLIPS } from "./rng";
import type { CoinFace } from "./rng";
import { damagedByAttackAbility } from "./triggers";
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
    Pecharunt ex "Irritated Outburst") and for the retreat-cost source (Heracross
    "Superpowered Throw" and siblings). `attackerSeat` is the OTHER end of the
    table and exists only for the `boardCondition` indicator (D115): a
    `BoardCondition` is relative to whose board it reads — "you have a Stadium in
    play" is about the ATTACKER's ownership, "your opponent's Active …" reaches
    across from there — so it cannot be derived from `defenderSeat` alone without
    quietly hard-coding a two-player table into this fold. */
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
      // lands in tens.
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
  // §4 — the going-first player may not attack on their first turn. Turn 1
  // is by construction the first player's turn (and the gate already proved
  // the actor owns the current turn), so the turn counter IS the check; the
  // second player's first turn is turn 2 and is unrestricted.
  if (state.turn === 1) {
    return err("FIRST_TURN_ATTACK", "the going-first player cannot attack on turn 1 (§4)");
  }
  const side = state.players[action.seat];
  const active = side.active;
  if (active === null) {
    // Unreachable — promotion is forced before the next action.
    return err("NO_TARGET", "no Active Pokémon to attack with");
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
    return err(
      "ATTACK_PREVENTED",
      "an attack effect stops this Pokémon attacking this turn (§11)",
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
      return finishAttack(next, events, action.seat);
    }
  }

  // Coverage strategy (simulator.md): the mechanical part of the attack
  // (numeric damage, weakness/resistance) is simulated, and effect text
  // derives into executable steps for exactly the sentence shapes effects.ts
  // recognizes — anything else (and every damage marker like "60+", M4's
  // effect ops) is flagged loudly instead of guessed.
  const { base, modifier } = parseAttackDamage(declared.damage);
  const effect = declared.effect ?? null;
  // Registry ABOVE the deriver (D8): an authored attack program wins; else the
  // text deriver; else null (unsimulated). Authored programs are keyed by ATTACK
  // INDEX — a card authors only the attacks whose sentence the deriver refuses,
  // the rest fall through. Chien-Pao ex "Hail Blade" (sv02-061 idx 0, D96) was
  // the first; Mewtwo VSTAR "Psy Purge" (swsh10.5-031 idx 0, D97) the second, and
  // the first on a MULTI-attack card — its idx-1 "Star Raid" must NOT inherit Psy
  // Purge's program, which is WHY the seam is index-keyed.
  const authored = programFor(attacker.id)?.attack?.[index] ?? null;
  const derived = effect === null || effect === "" ? null : deriveAttackEffect(effect);
  // REASSIGNABLE since D130, and only from the flip block below: a
  // `programPerHeads` coin member is expanded into `heads` copies of its ops and
  // APPENDED here, so the attack's existing tail runs them with no new channel.
  // Nothing else in this function writes it.
  let program = authored ?? derived;
  // The count-scaling clause reads the SAME effect text but folds into the damage
  // BEFORE the §8.5 pipeline, unlike a post-damage program. Two sibling families,
  // told apart by the word "more": ADDITIVE ("+") folds `per × count` onto the
  // printed base; MULTIPLY ("×", no "more") makes `per × count` the WHOLE damage,
  // the printed base dropped. Their regexes are mutually exclusive, so at most one
  // fires — read multiply only when additive did not, making that explicit. A card
  // carries at most one scaling clause OR a program: the whole-sentence anchor
  // means a scaling sentence never also derives an op.
  const damageBonus = effect === null || effect === "" ? null : deriveAttackDamageBonus(effect);
  const damageMultiplier =
    damageBonus !== null || effect === null || effect === ""
      ? null
      : deriveAttackDamageMultiplier(effect);
  const scaling = damageBonus ?? damageMultiplier;
  const scaled =
    scaling === null ? 0 : scaledAttackDamage(active, scaling, next, defenderSeat, action.seat);
  // D125 — the printed "If <clause>, this attack does nothing." REQUIREMENT: the
  // board fact the attack needs, or null when the text is not that sentence. It
  // is a third reader of the same effect string, disjoint from the two scaling
  // ones by CONSEQUENT ("nothing" versus "N more damage" / "for each"), so at
  // most one of the three ever fires on a given attack.
  const requirement = effect === null || effect === "" ? null : deriveAttackRequirement(effect);
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
  // A program that DEALS the main damage itself owns the printed number the same
  // way the multiply family does — Chien-Pao ex "Hail Blade" is "60×" (base 60,
  // modifier "×"), but its 60-per-discarded-card is dealt from INSIDE the program
  // (damageDefender, after the mid-attack discard the number depends on), so the
  // base must not ALSO land pre-program. The scaling readers can't carry it: the
  // count is a mid-attack choice, not a board fact at declaration.
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
  const scaledBase =
    damageMultiplier !== null || programDamage || coinFlip?.kind === "perHeads" ? 0 : base;
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
  const effectSimulated =
    program !== null || scaling !== null || requirement !== null || coinFlip !== null;
  // The exception LIST, named rather than inlined: two of the coin union's four
  // members explain a printed damage marker and two do not, and a bare
  // `coinFlip !== null` here would claim the modifier for all four.
  const coinExplainsModifier =
    coinFlip !== null && coinFlip.kind !== "cancelOnTails" && coinFlip.kind !== "programPerHeads";
  const modifierSimulated = scaling !== null || programDamage || coinExplainsModifier;
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
    return finishAttack(next, events, action.seat);
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
        return finishAttack(next, events, action.seat);
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
    const bonus = attackerPreWRBonus(next, active, action.seat, defenderCard);
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
    const debuff = installedAttackDebuffOf(next, active) + opposingAttackDebuff(next, active);
    // §8.5 Weakness, unless the defender's controller has a "your Pokémon have no
    // Weakness" aura in play (Florges "Blooming Garden"); Resistance still applies.
    const weakness = seatRemovesWeakness(next, defenderSeat)
      ? null
      : weaknessOf(attacker, defenderCard);
    const resistance = resistanceOf(attacker, defenderCard);
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
    // Copperajah ex "Bronze Body", Rock Chestplate) and, since D147, the DURATED
    // half installed onto the board by an attack ("During your opponent's next
    // turn, …"). Same sentence, same step, one number — which is the whole reason
    // this site's diff is a `+` (continuous.ts `installedReductionOf`).
    const reduction = defenderPassives.damageReductionAfterWR + installedReductionOf(next, defender);
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
    const prevented =
      (defenderPassives.preventDamageFromExV && isExOrV(attacker)) ||
      attackBlockOf(next, defender, attacker) !== null;
    const dealt = prevented ? 0 : Math.max(0, afterWR - reduction);
    defended = { ...defender, damage: defender.damage + dealt };
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
    const recoil = defenderPassives.damageAttacker;
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
  const epilogue: PendingStage[] =
    damagedTriggerStage !== null
      ? [damagedTriggerStage, { kind: "attackEpilogue", seat: action.seat }]
      : [{ kind: "attackEpilogue", seat: action.seat }];
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

  // No effect program. When the defender reacts, drain [damagedTrigger, epilogue]
  // through advance (the trigger may park; the epilogue behind it resumes on
  // resolve). Otherwise the epilogue alone is exactly finishAttack — its advance
  // case pops itself and calls it — so keep the direct call for the common
  // no-reaction path (byte-identical to the pre-slice tail).
  if (damagedTriggerStage !== null) {
    return advance({ ...next, pending: [...next.pending, ...epilogue] }, events);
  }

  // §8.1 Knock Out sweep on both boards, then the §5.3 turn end. With no effect
  // program there is no recoil, so only the defender's board can be lethal, but the
  // sweep stays total (finishAttack owns the order + the §14 tie).
  return finishAttack(next, events, action.seat);
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
