import type {
  ApplyResult,
  AttackAction,
  GameAction,
  PromoteAction,
  TakePrizesAction,
} from "./actions";
import { err } from "./actions";
import {
  applyDamageModifier,
  attacksOf,
  cardOfUid,
  energyProvidesOf,
  hpOf,
  parseAttackDamage,
  prizeValueOf,
  resistanceOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
import type { GameEvent } from "./events";
import { advance, resolvePrizesAndResume, resolvePromotionAndResume, turnTail } from "./flow";
import { isBenchIndex, turnGate } from "./turn";
import type { GameState, PendingStage, Phase, Seat } from "./types";
import { discardFromStack, otherSeat, withSide } from "./types";

// The attack step (§8) and the two KO-resolution decisions it can park on
// (§8.1). Declaring an attack ends the turn (§5.3), so every path out of
// here funnels into flow.ts's staged tail — the KO stages simply go in
// front of it.

/** §6.4 cost matching. Typed symbols need exactly that type; Colorless
    slots take whatever is left over. Every attached energy provides exactly
    ONE unit of ONE type in M2 (a basic energy its named type, the
    special-energy fallback Colorless — cards.ts), so per-type counting is a
    complete matcher; a real assignment search only becomes necessary with
    M4's multi-unit / multi-type providers. */
export function costMet(cost: readonly string[], provided: readonly string[]): boolean {
  const needed = new Map<string, number>();
  let colorless = 0;
  for (const symbol of cost) {
    if (symbol === "Colorless") colorless++;
    else needed.set(symbol, (needed.get(symbol) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  for (const type of provided) counts.set(type, (counts.get(type) ?? 0) + 1);
  let spare = provided.length;
  for (const [type, count] of needed) {
    if ((counts.get(type) ?? 0) < count) return false;
    spare -= count;
  }
  return spare >= colorless;
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
  // §8.2 cost check against what the attached energy provides.
  const provided = active.energy.map((uid) => {
    const card = cardOfUid(state, uid);
    return card === undefined ? "Colorless" : energyProvidesOf(card);
  });
  const cost = declared.cost ?? [];
  if (!costMet(cost, provided)) {
    return err("ATTACK_COST_UNMET", `${declared.name} costs [${cost.join(", ")}]`);
  }

  const defenderSeat = otherSeat(action.seat);
  const defender = state.players[defenderSeat].active;
  const defenderUid = defender === null ? undefined : topUid(defender);
  const defenderCard = defender === null ? undefined : topCardOf(state, defender);
  if (defender === null || defenderUid === undefined || defenderCard === undefined) {
    // Unreachable — the KO'd side promotes (or loses) before play resumes.
    return err("NO_TARGET", "no Defending Pokémon");
  }

  const events: GameEvent[] = [
    { type: "ATTACK_DECLARED", seat: action.seat, uid: attackerUid, attack: declared.name, index },
  ];
  // Coverage strategy (simulator.md): the mechanical part of the attack
  // (numeric damage, weakness/resistance) is simulated; text effects and
  // damage markers ("60+", "20×") are M4's effect ops — apply the number,
  // flag the rest loudly instead of guessing.
  const { base, modifier } = parseAttackDamage(declared.damage);
  const effect = declared.effect ?? null;
  if (modifier !== null || (effect !== null && effect !== "")) {
    events.push({
      type: "ATTACK_EFFECT_SKIPPED",
      seat: action.seat,
      attack: declared.name,
      effect,
      damageModifier: modifier,
    });
  }

  let next = state;
  let defended = defender;
  if (base > 0) {
    // §8.5 damage pipeline, in printed order: base → Weakness (modern ×2,
    // the old-era +20 prints add) → Resistance (−30), floored at 0. Both
    // apply to the Defending Pokémon only.
    const weakness = weaknessOf(attacker, defenderCard);
    const resistance = resistanceOf(attacker, defenderCard);
    const dealt = Math.max(0, applyDamageModifier(applyDamageModifier(base, weakness), resistance));
    defended = { ...defender, damage: defender.damage + dealt };
    next = withSide(next, defenderSeat, { ...next.players[defenderSeat], active: defended });
    events.push({
      type: "DAMAGE_DEALT",
      seat: defenderSeat,
      uid: defenderUid,
      base,
      weakness,
      resistance,
      dealt,
      damage: defended.damage,
    });
  }

  // §8.1 Knock Out check: damage ≥ max HP. A KO puts the prize pick and the
  // promotion in front of the turn tail; both are decision stages that can
  // park the queue.
  const pending: PendingStage[] = [];
  const hp = hpOf(defenderCard);
  if (hp !== null && defended.damage >= hp) {
    const cleanup = discardFromStack(next.players[defenderSeat], defended, "all");
    next = withSide(next, defenderSeat, { ...cleanup.side, active: null });
    events.push({
      type: "KNOCKED_OUT",
      seat: defenderSeat,
      uid: defenderUid,
      discarded: cleanup.discarded,
    });
    pending.push(
      { kind: "takePrizes", seat: action.seat, count: prizeValueOf(defenderCard) },
      { kind: "promote", seat: defenderSeat },
    );
  }
  // §5.3 — attacking ends the turn, through the same staged tail as a pass.
  pending.push(...turnTail(action.seat));
  return advance({ ...next, pending }, events);
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
