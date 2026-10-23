import type { Attack } from "@colorless/schema";
import { attacksOf, topCardOf, topUid } from "../cards";
import { isLethallyDamaged, passivesOf, stadiumShieldsStatus } from "../continuous";
import type { EffectContext, EffectPrompt, PokemonRef } from "../effectPrompt";
import type { AttackerClass, OpOf, StampedPlayLockKey } from "../effectTypes";
import { foldApostrophes } from "../effects";
import { effectRefused, refPokemon, sourceRef, unrefusedActive } from "../effectTargets";
import type { GameEvent, StatusName } from "../events";
import type {
  AttackBlock,
  BoostedAttack,
  GameState,
  InPlayPokemon,
  LockedAttack,
  ScheduledEffect,
  SideDamageReduction,
} from "../types";
import {
  DEFAULT_CONFUSION_DAMAGE,
  DEFAULT_POISON_DAMAGE,
  koByEffectMarker,
  noConditions,
  otherSeat,
  presentStatuses,
  relativeSeat,
  withActive,
  withSide,
} from "../types";

// Op implementations that install on a body or side: Special Conditions, attack and Retreat
// locks, boosts, reductions, debuffs, recoil and delayed effects.

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
  const seat = relativeSeat(ctx.seat, op.target !== "self");
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
  if (effectRefused(state, seat, ctx, undefined, events)) return state;
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
export function clearStatus(
  state: GameState,
  ctx: EffectContext,
  // One named condition to clear; absent means all.
  only: StatusName | undefined,
  events: GameEvent[],
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
export function preventRetreat(
  state: GameState,
  op: OpOf<"preventRetreat">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // A bare target means the opponent here, unlike `preventAttack` where bare means self.
  const seat = relativeSeat(ctx.seat, op.target !== "self");
  const live = unrefusedActive(state, seat, ctx, events);
  if (live === null) return state;
  const { active, uid } = live;
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
export function preventHandPlay(
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
export function preventDamage(
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
 * Keep-the-max merge of a turn-stamped amount: `amount` for a new window, the larger of the two for
 * a same-window record, or null when the re-install says nothing new.
 */
function maxMerged(
  existing: { readonly turn: number; readonly amount: number } | null,
  turn: number,
  amount: number,
): number | null {
  if (existing === null || existing.turn !== turn) return amount;
  return amount > existing.amount ? amount : null;
}

/**
 * Installs an attack lock on the controller's own Active (`+ 2`, its next turn) or on the defender
 * (`+ 1`, the opponent's next turn). The defender arm is an effect of an attack, so a §11 block can
 * refuse it. A re-install that says nothing new is silent.
 */
export function preventAttack(
  state: GameState,
  op: OpOf<"preventAttack">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = relativeSeat(ctx.seat, op.target === "defender");
  const live = unrefusedActive(state, seat, ctx, events);
  if (live === null) return state;
  const { active, uid } = live;
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
export function flipLockAttack(
  state: GameState,
  ctx: EffectContext,
  coins: 2 | undefined,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  const live = unrefusedActive(state, seat, ctx, events);
  if (live === null) return state;
  const { active, uid } = live;
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
export function flipLockTrainerPlay(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  events.push({ type: "TRAINER_FLIP_LOCKED", seat });
  return withSide(state, seat, { ...state.players[seat], trainerFlipLockTurn: state.turn + 1 });
}

/**
 * Installs a side-wide attack lock (`PlayerSide.sideAttackLock`) for the locked side's controller's
 * next turn. No `effectRefused` gate since the object is a side, not a Pokémon. Same-window
 * installs merge to the wider lock: unconditional dominates, else the larger `maxEnergy`.
 */
export function lockSideAttacks(
  state: GameState,
  op: OpOf<"lockSideAttacks">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const lockedSeat = relativeSeat(ctx.seat, op.whose !== "self");
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
export function boostSideAttacksThisTurn(
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
export function installSideDamageReductionNextTurn(
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
export function installChosenAttackShield(
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

/**
 * Roxie's Performance: retreat lock on the opponent's side for their next turn, checked against
 * each body's live conditions. No `effectRefused` gate since the object is a side.
 */
export function lockSideRetreat(
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
export function installSideAttackBlock(
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
export function markHandAttach(
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
  if (effectRefused(state, victimSeat, ctx, undefined, events)) return state;
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
 * Amarys: schedules the end-of-turn hand discard. Only the turn's owner can play a Supporter, so
 * `ctx.seat` is that owner.
 */
export function scheduleEndOfTurnHandDiscard(
  state: GameState,
  op: OpOf<"scheduleEndOfTurnHandDiscard">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  events.push({ type: "HAND_DISCARD_SCHEDULED", seat: ctx.seat, atLeast: op.atLeast });
  return { ...state, allowances: { ...state.allowances, endOfTurnHandDiscard: op.atLeast } };
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
export function preventAttackUse(
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
export function boostAttack(
  state: GameState,
  attack: string | null,
  amount: number,
  base: true | undefined,
  ctx: EffectContext,
  // Write the record on the program's source body (Bench or Active) instead of the seat's Active.
  holder: "source" | undefined,
  // Stamp `state.turn` for a printed "during this turn" instead of `+ 2`.
  thisTurn: true | undefined,
  events: GameEvent[],
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
export function preventChosenAttack(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): { done: GameState } | { park: EffectPrompt } {
  const victim = otherSeat(ctx.seat);
  // Refused before the candidate scan so a shielded defender is never prompted.
  if (effectRefused(state, victim, ctx, undefined, events)) return { done: state };
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
export function lockDefenderAttack(
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
export function reduceDamage(
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
export function installNoWeakness(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
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
export function weakenDefenderAttacks(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  const live = unrefusedActive(state, seat, ctx, events);
  if (live === null) return state;
  const { active, uid } = live;
  const turn = state.turn + 1;
  const merged = maxMerged(active.attackDamageDebuff, turn, amount);
  if (merged === null) return state;
  events.push({ type: "ATTACK_DEBUFF_APPLIED", seat, uid, amount: merged });
  return withActive(state, seat, { ...active, attackDamageDebuff: { turn, amount: merged } });
}

/**
 * Installs "the Defending Pokémon takes N more damage" during the installer's next turn, hence `+
 * 2`. Same-window re-installs merge by max.
 */
export function exposeDefender(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  const live = unrefusedActive(state, seat, ctx, events);
  if (live === null) return state;
  const { active, uid } = live;
  const turn = state.turn + 2;
  const worst = maxMerged(active.damageVulnerability, turn, amount);
  if (worst === null) return state;
  events.push({ type: "DAMAGE_VULNERABILITY_APPLIED", seat, uid, amount: worst });
  return withActive(state, seat, { ...active, damageVulnerability: { turn, amount: worst } });
}

/**
 * Mabosstiff — Plunging Headbutt: self vulnerability for the opponent's next turn. Summed onto a
 * same-window record, since the opponent's `exposeDefender` can stamp the same turn and both
 * effects apply. No §11 check.
 */
export function exposeSelf(
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
export function retypeDefenderWeakness(
  state: GameState,
  type: string,
  ctx: EffectContext,
  // Overwriting Bolt's "(Apply Weakness as ×2.)".
  asTimesTwo: boolean,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  const live = unrefusedActive(state, seat, ctx, events);
  if (live === null) return state;
  const { active, uid } = live;
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
export function taxDefender(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const taxedSeat = otherSeat(ctx.seat);
  const live = unrefusedActive(state, taxedSeat, ctx, events);
  if (live === null) return state;
  const { active: taxed, uid: taxedUid } = live;
  const taxTurn = state.turn + 1;
  if (taxed.costTaxTurn === taxTurn) return state;
  events.push({ type: "COST_TAX_APPLIED", seat: taxedSeat, uid: taxedUid });
  return withActive(state, taxedSeat, { ...taxed, costTaxTurn: taxTurn });
}

/**
 * Knock Out bounty on the defender during the installer's next turn (`+ 2`): take 2 more Prize
 * cards if it is Knocked Out. Read only in flow.ts `koPrizeBonus`.
 */
export function bountyDefender(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const markedSeat = otherSeat(ctx.seat);
  const live = unrefusedActive(state, markedSeat, ctx, events);
  if (live === null) return state;
  const { active: marked, uid: markedUid } = live;
  const bountyTurn = state.turn + 2;
  const prior = marked.koBounty;
  // A live record from this turn is kept when the marked body will be Knocked Out at this attack's
  // sweep, since it still pays there and the new window could never open. Otherwise the live record
  // can no longer pay and is replaced.
  const leavesAtSweep =
    isLethallyDamaged(state, marked) || marked.markers.includes(koByEffectMarker(state.turn));
  if (prior !== null && prior.turn === state.turn && leavesAtSweep) return state;
  const payout = maxMerged(prior, bountyTurn, amount);
  if (payout === null) return state;
  events.push({ type: "KO_BOUNTY_APPLIED", seat: markedSeat, uid: markedUid, amount: payout });
  return withActive(state, markedSeat, {
    ...marked,
    koBounty: { turn: bountyTurn, amount: payout },
  });
}

/**
 * Unown — Mysterious Signal: puts a this-turn `koBounty` on the opponent's Active, paid at the
 * sweep. Added to a live record of this turn, otherwise replaces. No §11 check and no event.
 */
export function bountyThisAttack(state: GameState, amount: number, ctx: EffectContext): GameState {
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
 * Schedules damage counters on the defender for the end of the opponent's next turn. Only stamps:
 * placement happens in flow.ts `runCheckup`.
 */
export function scheduleCounters(
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
export function scheduleDiscard(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  return scheduleDelayed(state, { kind: "discard" }, ctx, events);
}

/**
 * Schedules the defender's Knock Out at the end of the opponent's next turn; the Checkup hands it
 * to §8.1, so a Prize is taken.
 */
export function scheduleKnockOut(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
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
  const live = unrefusedActive(state, seat, ctx, events);
  if (live === null) return state;
  const { active, uid } = live;
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
export function installRecoil(
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
