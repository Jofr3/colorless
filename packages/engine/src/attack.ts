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
  parseAttackDamage,
  resistanceOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
import { effectiveAttackCost, passivesOf, providedEnergy } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
} from "./effects";
import type { AttackDamageBonus } from "./effects";
import type { GameEvent } from "./events";
import {
  finishAttack,
  resolvePrizesAndResume,
  resolvePromotionAndResume,
  settleProgram,
} from "./flow";
import { attackerPreWRBonus, runProgram } from "./interpreter";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
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
    Pecharunt ex "Irritated Outburst"). */
function scaledAttackDamage(
  attacker: InPlayPokemon,
  bonus: AttackDamageBonus,
  state: GameState,
  defenderSeat: Seat,
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
  }
}

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
  // text deriver; else null (unsimulated). None of the representative attacks
  // are registry-authored, so this reads through to the deriver today — the
  // seam is here for when they are.
  const authored = programFor(attacker.id)?.attack ?? null;
  const derived = effect === null || effect === "" ? null : deriveAttackEffect(effect);
  const program = authored ?? derived;
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
  const scaled = scaling === null ? 0 : scaledAttackDamage(active, scaling, next, defenderSeat);
  // A program that DEALS the main damage itself owns the printed number the same
  // way the multiply family does — Chien-Pao ex "Hail Blade" is "60×" (base 60,
  // modifier "×"), but its 60-per-discarded-card is dealt from INSIDE the program
  // (damageDefender, after the mid-attack discard the number depends on), so the
  // base must not ALSO land pre-program. The scaling readers can't carry it: the
  // count is a mid-attack choice, not a board fact at declaration.
  const programDamage = program !== null && program.some((step) => step.op === "damageDefender");
  // The multiply family's printed "N×" base IS the per-unit (already counted in
  // `scaled`), so it is dropped from the pipeline — the additive family keeps its
  // printed base. count 0 → scaled 0 → no damage (the base does not leak through).
  // A program that owns the damage drops the base for the same reason.
  const scaledBase = damageMultiplier !== null || programDamage ? 0 : base;
  // The "+"/"×" modifier is SIMULATED iff a scaling reader consumed it OR the
  // program deals the damage; the effect text is simulated iff a program ran it
  // OR a scaling reader did. Only the genuinely-unsimulated remainder is flagged
  // loudly (simulator.md coverage).
  const effectSimulated = program !== null || scaling !== null;
  const modifierSimulated = scaling !== null || programDamage;
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

  let defended = defender;
  if (scaledBase + scaled > 0) {
    // §8.5 damage pipeline, in printed order: base + the attack's own printed
    // scaling clause (`scaled` — Paldean Tauros "Raging Horns", counted at
    // declaration) + the attacker's continuous pre-W/R bonus (Vitality Band) →
    // Weakness (modern ×2, the old-era +20 prints add) → Resistance (−30) → the
    // defender's continuous damage reduction (Bouffalant "Bouffer" / a defending
    // Tool, §15.B), floored at 0. Weakness/Resistance apply to the Defending
    // Pokémon only, and both continuous reads aggregate printed passives WITH
    // attached Tools (continuous.ts). `scaled` is the attack's own damage (added
    // alongside the continuous bonus at the same pre-W/R step), so this branch
    // fires whenever the (multiply-adjusted) base OR the scaling clause does
    // damage. `scaledBase` is `base` except for a multiply clause, whose printed
    // "N×" base is the per-unit already inside `scaled` — so it is 0 here.
    const bonus = attackerPreWRBonus(next, active, action.seat, defenderCard);
    const weakness = weaknessOf(attacker, defenderCard);
    const resistance = resistanceOf(attacker, defenderCard);
    const afterWR = Math.max(
      0,
      applyDamageModifier(applyDamageModifier(scaledBase + scaled + bonus, weakness), resistance),
    );
    const reduction = passivesOf(next, defender).damageReductionAfterWR;
    const dealt = Math.max(0, afterWR - reduction);
    defended = { ...defender, damage: defender.damage + dealt };
    next = withSide(next, defenderSeat, { ...next.players[defenderSeat], active: defended });
    events.push({
      type: "DAMAGE_DEALT",
      seat: defenderSeat,
      uid: defenderUid,
      base: scaledBase,
      // Present only when the printed scaling clause actually added HP.
      scaled: scaled > 0 ? scaled : undefined,
      // Present only when a continuous effect actually moved the total.
      bonus: bonus > 0 ? bonus : undefined,
      weakness,
      resistance,
      reduction: reduction > 0 ? reduction : undefined,
      dealt,
      damage: defended.damage,
    });
  }

  // §8 step 4 — the effect program runs AFTER the damage, in printed order: a
  // defender-targeted status lands even when the damage above is lethal (the
  // condition vanishes with the stack at the KO below).
  //
  // The program may PARK on a decision ("Discard an Energy from this Pokémon"
  // with two different Energy attached), and an attack that parks must still
  // finish afterwards — so the epilogue is QUEUED as a stage before the program
  // runs, and the fold goes through settleProgram with `resumeTail`. A DONE
  // program drains straight into it (identical to the pre-slice inline call, one
  // hop later); a parked one leaves it sitting in `pending` until resolveEffect
  // finishes the program and drains it then. APPENDED rather than assigned: the
  // queue is empty here (turn:action never carries a tail — the three writers of
  // that phase all leave it empty), so this is the same thing, but a stage that
  // somehow WAS queued would run after the attack instead of vanishing.
  if (program !== null) {
    const epilogue: PendingStage = {
      kind: "attackEpilogue",
      seat: action.seat,
    };
    return settleProgram(
      runProgram(
        { ...next, pending: [...next.pending, epilogue] },
        program,
        // The attacker is "this Pokémon" (§8) — by uid rather than "the Active",
        // which stays truthful if the program itself moves it off the spot.
        { seat: action.seat, sourceUid: attackerUid },
        events,
      ),
      action.seat,
      events,
      { resumeTail: true },
    );
  }

  // §8.1 Knock Out sweep on both boards, then the §5.3 turn end — the shared
  // epilogue with the confusion-tails exit above. With no effect program there is
  // no recoil, so only the defender's board can be lethal, but the sweep stays
  // total (finishAttack owns the order + the §14 tie).
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
