import type { BasicEnergyType } from "@colorless/schema";
import { attackerPreWRBonus, countCardsInDiscardPile, countPokemonInPlay } from "../boardCondition";
import {
  activeTop,
  afterWeaknessResistance,
  cardOfUid,
  matchesFilter,
  resistanceOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "../cards";
import {
  coinRedoToolOf,
  countAttachedEnergy,
  deluxeBombOf,
  effectiveMaxHp,
  everyAttackBoostOf,
  healLocked,
  inPlayCardOf,
  installedAttackDebuffOf,
  installedNoWeakness,
  installedRecoilOf,
  installedWeaknessRetypeOf,
  installedWeaknessRewriteOf,
  opposingAttackDebuff,
  opposingToolAttackDebuff,
  passivesOf,
  remainingHpWithin,
  seatRemovesWeakness,
  seatWeaknessRewrite,
  sideAttackBonusThisTurn,
  weaknessAmountOverride,
  withWatchedRecoil,
  withWeaknessAmount,
} from "../continuous";
import { consumeTools, landAttackHit } from "../damageCalc";
import type { EffectContext, EffectPrompt, EffectRecord, PokemonRef } from "../effectPrompt";
import type { CardFilter, EffectOp, EffectSlot, OpOf } from "../effectTypes";
import {
  activeInPlay,
  benchCountersCaged,
  effectRefused,
  filteredRefs,
  hasAnyDamageCounters,
  matchesAttached,
  oppAnyRefs,
  oppBenchRefs,
  ownBenchRefs,
  ownInPlayRefs,
  recorded,
  refKeyOf,
  refPokemon,
  sourceRef,
  subgroupRefs,
  unrefusedActive,
  unshieldedRefs,
  withBodyAt,
} from "../effectTargets";
import type { GameEvent } from "../events";
import type { CoinFace } from "../rng";
import { flipCoin } from "../rng";
import { programFor } from "../registry";
import { damagedByAttackAbility, damagedToolTriggersOf } from "../triggerLookup";
import type { GameState, InPlayPokemon, PendingStage, PokemonTarget, Seat } from "../types";
import {
  coinRedoKey,
  spendAbilityUse,
  bodyAt,
  damageCountersOn,
  HP_PER_COUNTER,
  otherSeat,
  SEATS,
  stackUids,
  takenPrizes,
  withActive,
  withSide,
} from "../types";

// Op implementations that damage, heal or move damage counters, with the snipe placement and
// the coin flips their riders read.

/**
 * Spread damage: `amount` to each Benched Pokémon of the named side, flat since §8.5 W/R never
 * apply on the Bench. `amount` arrives already scaled. A benched body's own reductions and
 * preventions still apply; the attacker's pre-W/R bonus is Active-only and does not. Never Knocks
 * Out: the KO sweep runs later, and an own-side Knock Out gives the opponent the Prize.
 */
export function spreadDamage(
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
    const landed = landAttackHit(
      { ...state, rngState: rng },
      {
        body: pokemon,
        seat: victim,
        uid,
        passives: passivesOf(state, pokemon),
        attacker: attackerCard,
        attackerBody: attackerTop?.active,
        // On the `"yourBench"` arm the dealer and the damaged body's owner are the same seat.
        attackerSeat: ctx.seat,
        // A spread never ignores effects on the damaged body.
        ignoreTargetEffects: false,
        invokedByAttack: ctx.invokedBy === "attack",
        preWR: spread,
        afterWR: spread,
        row: {
          base: amount,
          debuff: attackerDebuff > 0 ? attackerDebuff : undefined,
          weakness: null,
          resistance: null,
        },
      },
      events,
    );
    rng = landed.rngState;
    consumed.push(...landed.spent);
    bench.push(landed.body);
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
 * Flips `count` coins and asks whether a live Backtrack Badge offers a redo, or reuses the faces a
 * declined redo kept, with no new flip, no row and no second offer.
 */
export function flipOrKeep(
  state: GameState,
  kept: CoinFace[] | undefined,
  count: number,
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; faces: CoinFace[]; redo: string | null } {
  if (kept !== undefined) return { state, faces: kept, redo: null };
  const [flipped, faces] = flipCoinsFor(state, count, ctx, events);
  return { state: flipped, faces, redo: coinRedoOffer(flipped, ctx, faces) };
}

/**
 * Target Together: one coin per own body in play matching `filter`, then `amount × heads` to the
 * chosen `refs`.
 */
export function perHeadsHit(
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
  const {
    state: flipped,
    faces,
    redo,
  } = flipOrKeep(state, op.faces, countPokemonInPlay(state, ctx.seat, filter), ctx, events);
  if (redo !== null) {
    return {
      done: flipped,
      schedule: [{ op: "reflipCoins", toolUid: redo, faces, retry: { ...op, hitRefs: [...refs] } }],
    };
  }
  const heads = faces.filter((face) => face === "heads").length;
  return { done: placeSnipe(flipped, refs, amount * heads, op, ctx, events) };
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
 * A Backtrack Badge offer answered yes: `COINS_REFLIPPED` and the Badge's once-per-turn key. A uid
 * without `reflipAttackCoins` spends nothing.
 */
export function spendCoinRedo(
  state: GameState,
  seat: Seat,
  toolUid: string,
  count: number,
  events: GameEvent[],
): GameState {
  const id = state.cardIdByUid[toolUid];
  const redo = id === undefined ? undefined : programFor(id)?.passive?.reflipAttackCoins;
  if (redo === undefined) return state;
  events.push({ type: "COINS_REFLIPPED", seat, uid: toolUid, count });
  return spendAbilityUse(state, coinRedoKey(toolUid, redo.name));
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
  const name = cardOfUid(state, toolUid)?.name ?? "Backtrack Badge";
  const these = faces.length === 1 ? "this coin flip" : `these ${String(faces.length)} coin flips`;
  return {
    kind: "confirm",
    note: `${name}: ignore ${these} (${faces.join(", ")}) and flip ${faces.length === 1 ? "that coin" : "those coins"} again?`,
    labels: { yes: "Flip again", no: "Keep the results" },
  };
}

/** The `damageChosen` riders that shape one placement; `source` is Venture Bomb's Item placement. */
type SnipeRider = Pick<OpOf<"damageChosen">, "deals" | "ignoreWR" | "wrOnly" | "source">;

/**
 * Per-target scaling: each pick reads its own counters, so placement walks the refs one at a time.
 * Shared by the forced branch and the resumed pick.
 */
export function snipeEachByCounters(
  state: GameState,
  refs: readonly PokemonRef[],
  op: OpOf<"damageChosen">,
  ctx: EffectContext,
  record: EffectRecord,
  events: GameEvent[],
): GameState {
  let next = state;
  for (const ref of refs) {
    next = placeSnipe(next, [ref], snipeAmount(op, next, ctx, record, ref), op, ctx, events);
  }
  return next;
}

export function placeSnipe(
  state: GameState,
  refs: readonly PokemonRef[],
  amount: number,
  rider: SnipeRider,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  const deals = rider.deals === true;
  const source = rider.source;
  // The bare W/R tail: ignore Weakness and Resistance only.
  const wrOnly = rider.wrOnly === true;
  const opponent = otherSeat(ctx.seat);
  // `ignoreWR` is only the form that also ignores effects on the target. The bare tail (`wrOnly`)
  // skips only Weakness and Resistance, so it takes the plain hit's path and passes `wrOnly` to
  // `snipeActive` for an Active pick.
  const ignoreWR = rider.ignoreWR === true && !wrOnly;
  // The Active target (`opponentAny` only). Weakness and Resistance apply only to the Active, so a
  // hit that lands there goes through W/R unlike a Bench target; `ignoreWR` (Feint Attack) skips
  // W/R and the reduction passive. A placement (`!deals`) uses `damageActive` instead, since a
  // placed counter is not attack damage and must not be doubled by Weakness or cut by Resistance.
  let next = state;
  if (refs.some((r) => r.seat === opponent && r.spot.spot === "active")) {
    next = deals
      ? snipeActive(next, amount, ignoreWR, ctx, wrOnly, events)
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
      if (effectRefused(next, benchVictim, ctx, pokemon, events)) {
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
    // Plus Gloomy Garbage; under `ignoreWR` a pick that is itself a holder drops its own term.
    const attackerDebuff =
      sharedDebuff +
      (attackerTop === null
        ? 0
        : opposingToolAttackDebuff(next, attackerTop.active, ignoreWR ? pokemon : undefined));
    const preWR = Math.max(0, amount - attackerDebuff);
    const landed = landAttackHit(
      { ...next, rngState: rng },
      {
        body: pokemon,
        // The sniped side, not necessarily the opponent's.
        seat: benchVictim,
        uid,
        passives: passivesOf(next, pokemon),
        attacker: attackerCard,
        attackerBody: attackerTop?.active,
        attackerSeat: ctx.seat,
        ignoreTargetEffects: ignoreWR,
        invokedByAttack: ctx.invokedBy === "attack",
        preWR,
        afterWR: preWR,
        row: {
          base: amount,
          debuff: attackerDebuff > 0 ? attackerDebuff : undefined,
          weakness: null,
          resistance: null,
        },
      },
      events,
    );
    rng = landed.rngState;
    consumed.push(...landed.spent);
    bench.push(landed.body);
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
export function snipeActive(
  state: GameState,
  amount: number,
  ignoreWR: boolean,
  ctx: EffectContext,
  // `wrOnly` skips only Weakness and Resistance; every effect on the target still applies.
  wrOnly: boolean,
  events: GameEvent[],
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
  const preWR = Math.max(0, amount + bonus - debuff);
  const afterWR = afterWeaknessResistance(preWR, weakness, resistance);
  const landed = landAttackHit(
    state,
    {
      body: target.active,
      seat: opponent,
      uid: target.uid,
      passives: passivesOf(state, target.active),
      attacker: attacker?.card,
      attackerBody: attacker?.active,
      attackerSeat: ctx.seat,
      ignoreTargetEffects: ignoreWR,
      invokedByAttack: ctx.invokedBy === "attack",
      preWR,
      afterWR,
      row: {
        base: amount,
        bonus: bonus > 0 ? bonus : undefined,
        debuff: debuff > 0 ? debuff : undefined,
        weakness,
        resistance,
      },
    },
    events,
  );
  const { dealt } = landed;
  const hit = discardToPile(
    withActive({ ...state, rngState: landed.rngState }, opponent, landed.body),
    opponent,
    landed.spent,
  );
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
export function snipeAmount(
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
export function healEach(
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

/** Heal `amount` HP from EVERY in-play Pokémon on BOTH boards (Picnic Basket).
    Seat-blind twin of `healEach`: each heal is clamped to that Pokémon's damage
    and emits its own HEALED tagged with that Pokémon's own seat (an undamaged
    Pokémon heals 0 and emits nothing). Active then bench per seat, p1 then p2.
    Never parks. */
export function healEachAll(state: GameState, amount: number, events: GameEvent[]): GameState {
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
export function counterEachAll(
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
      if (effectRefused(next, seat, ctx, pokemon, events)) return pokemon;
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
export function counterUntilRemainingHp(
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
    if (effectRefused(state, victim, ctx, pokemon, events)) return pokemon;
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
export function damageActive(
  state: GameState,
  amount: number,
  source: "ability" | "attack" | "trainer", // Venture Bomb's Item placement.
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (amount <= 0) return state;
  const opponent = otherSeat(ctx.seat);
  // §11: a placed counter is not damage, so only the effects half of a block refuses it ("Damage is
  // not an effect."). The refusal is gated on the invocation, not on `source`.
  const live = unrefusedActive(state, opponent, ctx, events);
  if (live === null) return state;
  const { active, uid } = live;
  events.push({ type: "COUNTERS_PLACED", seat: opponent, uid, amount, source });
  return withActive(state, opponent, { ...active, damage: active.damage + amount });
}

/**
 * Place `amount` damage counters on "that Pokémon": the controller's body holding the first card
 * filed under `op.slot`, so it survives an evolution. Nothing filed, or the card gone, is a silent
 * whiff.
 */
export function countersOnRecordedBody(
  state: GameState,
  op: OpOf<"countersOnRecordedBody">,
  ctx: EffectContext,
  record: EffectRecord,
  events: GameEvent[],
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
export function damageSubject(
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
    if (effectRefused(state, seat, ctx, active, events)) return state;
    events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: "ability" });
    return withActive(state, seat, { ...active, damage: active.damage + amount });
  }
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === uid);
  if (index === -1) return state;
  const benched = side.bench[index];
  if (benched !== undefined && effectRefused(state, seat, ctx, benched, events)) return state;
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
export function healSubject(
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
export function moveCountersToDefender(
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
export function moveCountersFromBench(
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
  if (effectRefused(state, dest.seat, ctx, target, events)) {
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
export function moveOneOwnCounter(
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
export function moveCountersToOpponent(
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
export function anyWayBudget(state: GameState, seat: Seat, from: "bench" | "any"): number {
  return anyWayZone(state, seat, from).reduce(
    (sum, ref) => sum + Math.floor((refPokemon(state, ref)?.damage ?? 0) / HP_PER_COUNTER),
    0,
  );
}

/**
 * A round's destinations for source `from`: the opponent's Active for `"bench"`, every other
 * opponent body for `"any"`; §11-shielded bodies are dropped silently.
 */
export function anyWayDestinations(
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
    destination to move to (a source with nowhere to go is not offered — the no-choice rule). */
export function anyWaySources(
  state: GameState,
  ctx: EffectContext,
  zone: "bench" | "any",
): PokemonRef[] {
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
export function anyWaySourceAnswered(
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
export function nextAnyWayRound(op: OpOf<"moveCountersOpponentAnyWay">): EffectOp {
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
export function moveCountersBetweenOpponents(
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
 * Place `amount` HP of self-damage on the controller's own Active ("This Pokémon also does N damage
 * to itself"). Outside the §8.5 pipeline: no W/R and no reduction; emitted as COUNTERS_PLACED
 * source "self". Never KOs; the attack epilogue sweeps and the defender takes the prize.
 * `perDamageCounterOnSelf` multiplies by counters already on the attacker, read before placing;
 * zero counters or no Active yields no recoil.
 */
export function recoilAmount(
  op: { amount: number; perDamageCounterOnSelf?: true },
  state: GameState,
  ctx: EffectContext,
): number {
  if (op.perDamageCounterOnSelf !== true) return op.amount;
  const recoilingPokemon = state.players[ctx.seat].active;
  return recoilingPokemon === null ? 0 : op.amount * damageCountersOn(recoilingPokemon);
}

export function damageSelf(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  // Optional provenance; absent means the `"self"` recoil.
  source: "trainer" | "ability" | undefined,
  events: GameEvent[],
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
export function placeCountersOnSelf(
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
export function damageSourceBody(
  state: GameState,
  amount: number,
  ctx: EffectContext,
  source: "trainer" | "ability" | undefined,
  events: GameEvent[],
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
export function healSelf(
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

/** Heal from the controller's own in-play `ref`: `amount` HP, or all of its
    damage when `amount` is "all" (Potion 30 / Arboliva's Enriching Oil). */
export function healChosen(
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
