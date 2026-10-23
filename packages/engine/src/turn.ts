import type {
  ApplyResult,
  AttachEnergyAction,
  DiscardFromPlayAction,
  EndTurnAction,
  EvolveAction,
  GameAction,
  PlayBasicToBenchAction,
  RetreatAction,
} from "./actions";
import { err, ok } from "./actions";
import { abilityUsedKey } from "./cardplay";
import {
  basicFromHandError,
  cardOfUid,
  evolveFromOf,
  isBasicPokemon,
  isEnergyCard,
  isFossilTop,
  topUid,
} from "./cards";
import {
  aceSpecPlayBarred,
  benchLimitOf,
  benchTrimStages,
  effectiveRetreatCost,
  energyMayBeAttachedTo,
  energyRulesApply,
  intoPlayOnlyViaOf,
  opposingRetreatBlocked,
  liveHandAttachMark,
  retreatCoinFlipSource,
  pokemonPlayBarred,
  retreatLocked,
  sideRetreatLocked,
  stadiumLicensesSameTurnEvolve,
  stageChangeConditions,
} from "./continuous";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import {
  advance,
  isLethallyDamaged,
  recoverStatuses,
  resolveMidTurnKnockOuts,
  settleProgram,
  turnTail,
} from "./flow";
import {
  benchArrivalCounters,
  conditionHolds,
  conditionNote,
  evolveAliasLicensed,
  evolveEarlyLicensed,
  runProgram,
  shockHandAttach,
  switchInto,
} from "./interpreter";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  runActiveBenchedTriggers,
  runBoardTrigger,
  runSelfWatchedTriggers,
  runWatchedTriggers,
} from "./triggers";
import type { GameState, InPlayPokemon, PlayerSide, PokemonTarget, Seat } from "./types";
import {
  bodyAt,
  inPlayOf,
  BENCH_CEILING,
  discardFromStack,
  drawToHand,
  evolveOnto,
  isFirstTurnOf,
  isImmobilized,
  clearedAttackEffects,
  makeInPlay,
  noConditions,
  otherSeat,
  presentStatuses,
  withSide,
  without,
} from "./types";

// In-turn actions (§5). Ending a turn seeds a staged tail that `advance` drains; attacks feed the
// same tail with KO stages in front, which is why it is a queue.

/**
 * Bench slots are dense array indices. The `Number` check guards the wire, since JSON may send a
 * string. Bounded by `BENCH_CEILING`, not `BENCH_MAX`; each call site still checks the live bench.
 */
export function isBenchIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < BENCH_CEILING;
}

/** The gate every in-turn action shares: right phase, right seat. Returns
    the rejection, or null when the action may proceed (the same contract as
    basicFromHandError) — no handler consumes the narrowed phase, they act on
    the seat and the allowances alone. */
export function turnGate(
  state: GameState,
  action: { type: GameAction["type"]; seat: Seat },
): ApplyResult | null {
  const phase = state.phase;
  if (phase.kind !== "turn:action") {
    return err("BAD_PHASE", `${action.type} is not legal during ${phase.kind}`);
  }
  if (phase.seat !== action.seat) {
    return err("WRONG_SEAT", `it is ${phase.seat}'s turn`);
  }
  // Festival Lead's attack-again window: between the two attacks only the second declaration or its
  // decline is allowed, since the card grants a second attack, not a second main phase.
  if (
    state.allowances.attackAgainUid !== null &&
    action.type !== "attack" &&
    action.type !== "endTurn"
  ) {
    return err(
      "BAD_PHASE",
      `${action.type} is not legal now: only a second attack or ending the turn is legal (Festival Lead)`,
    );
  }
  return null;
}

/**
 * The attach target off the wire: a non-null object naming a legal `spot`. A garbled shape must
 * reject, not throw. The bench index is checked at the use site.
 */
export function isPokemonTarget(value: unknown): value is PokemonTarget {
  if (typeof value !== "object" || value === null) return false;
  const spot = (value as { spot?: unknown }).spot;
  return spot === "active" || spot === "bench";
}

/** §6.2 — exactly one energy attachment per turn, from hand, onto any of
    the actor's Pokémon (Active or Bench). */
export function attachEnergy(state: GameState, action: AttachEnergyAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  if (state.allowances.energyAttached) {
    return err("ENERGY_ALREADY_ATTACHED", "only one energy attachment per turn (§6.2)");
  }
  const side = state.players[action.seat];
  if (!side.hand.includes(action.uid)) {
    return err("CARD_NOT_IN_HAND", `${action.uid} is not in ${action.seat}'s hand`);
  }
  const card = cardOfUid(state, action.uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${action.uid}`);
  }
  if (!isEnergyCard(card)) {
    return err("NOT_AN_ENERGY", `${card.name} is not an Energy card`);
  }
  // Genesect "ACE Nullifier" bars playing any ACE SPEC card, and attaching an ACE SPEC Energy from
  // hand is playing it. Uses `aceSpecPlayBarred` rather than `handPlayBarred`, which needs a
  // Trainer class an Energy does not have. Checked after the once-per-turn allowance and card
  // checks, before the target checks; a refusal does not spend the allowance.
  if (aceSpecPlayBarred(state, action.seat, card)) {
    return err(
      "HAND_PLAY_BLOCKED",
      "your opponent prevents you from playing ACE SPEC cards from your hand",
    );
  }
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "attach target must name the Active spot or a bench index");
  }
  // The target's hand-attach mark, read before the attach. Glimmora "Corrosive Shards" refuses the
  // attach without spending the allowance; Hypno "Daydream" ends the turn after the attach, below.
  const markedTarget =
    action.target.spot === "active"
      ? side.active
      : isBenchIndex(action.target.index)
        ? side.bench[action.target.index]
        : undefined;
  const mark = markedTarget == null ? null : liveHandAttachMark(state, markedTarget);
  if (mark?.barred === true) {
    return err(
      "ENERGY_ATTACH_BARRED",
      "an attack prevents Energy cards from being attached from your hand to that Pokémon this turn",
    );
  }
  const endsTurn = mark?.endsTurn === true;
  // Team Rocket's Energy can only be attached to a Team Rocket's Pokémon; refused without spending
  // the allowance.
  if (markedTarget != null && !energyMayBeAttachedTo(state, card, markedTarget)) {
    return err(
      "BAD_TARGET",
      `${card.name} can only be attached to a ${programFor(card.id)?.energy?.attachOnlyToOwner ?? ""}'s Pokémon`,
    );
  }

  const hand = without(side.hand, action.uid);
  let updated: PlayerSide;
  if (action.target.spot === "active") {
    if (side.active === null) {
      return err("NO_TARGET", "no Active Pokémon to attach to");
    }
    updated = {
      ...side,
      hand,
      active: { ...side.active, energy: [...side.active.energy, action.uid] },
    };
  } else {
    const index = action.target.index;
    // The integer check is not pedantry: a wire-decoded `"1"` indexes the
    // bench array fine (string key) but never matches the `i === index`
    // compare below, so the energy would leave the hand and attach to
    // nothing — a destroyed card and a burned attachment allowance.
    if (!isBenchIndex(index) || side.bench[index] === undefined) {
      return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(index)}`);
    }
    const bench = side.bench.map((pokemon, i) =>
      i === index ? { ...pokemon, energy: [...pokemon.energy, action.uid] } : pokemon,
    );
    updated = { ...side, hand, bench };
  }
  let next: GameState = {
    ...withSide(state, action.seat, updated),
    allowances: { ...state.allowances, energyAttached: true },
  };
  const events: GameEvent[] = [
    // The target is copied: the action object belongs to the caller, and an
    // emitted event must not alias it (see events.ts).
    { type: "ENERGY_ATTACHED", seat: action.seat, uid: action.uid, target: { ...action.target } },
  ];
  // The board at the instant of the attach, captured before any §6.1 rider runs: watched triggers
  // gated on the Active Spot read this, not the post-switch board.
  const atAttach = next;
  // §6.1 on-attach effects. Jet Energy attached from hand to a Benched Pokémon switches it into the
  // Active Spot. A typed Special Energy's rider fires only onto a holder of its printed type.
  const energyProgram = programFor(card.id)?.energy;
  const landedOn =
    action.target.spot === "active"
      ? next.players[action.seat].active
      : next.players[action.seat].bench[action.target.index];
  const onAttach =
    landedOn != null && energyRulesApply(next, landedOn, energyProgram)
      ? energyProgram?.onAttach
      : undefined;
  // Telepathic Psychic Energy's Bench search runs last because it can park.
  const benchSearch: EffectOp[] | undefined =
    onAttach?.kind === "benchSearch"
      ? [
          { op: "searchDeck", filter: onAttach.filter, dest: "bench", max: onAttach.max },
          { op: "shuffleDeck" },
        ]
      : undefined;
  // `switched` records that the rider moved a body; `switchInto` runs move triggers that can place
  // counters, and no `settleProgram` sweep follows, so the Knock Out check below runs when it is
  // set.
  let switched = false;
  if (onAttach?.kind === "switchIfBenched" && action.target.spot === "bench") {
    const moved = switchInto(
      next,
      action.seat,
      { seat: action.seat, spot: { spot: "bench", index: action.target.index } },
      events,
    );
    switched = moved !== next;
    next = moved;
  }
  // Enriching Energy: "When you attach this card from your hand to a Pokémon, draw 4 cards." No
  // spot condition, unlike Jet Energy.
  if (onAttach?.kind === "draw") {
    next = drawToHand(next, action.seat, onAttach.count, "effect", events);
  }
  // §12: the hand attach is the one route an Energy reaches a body outside an effect program, so
  // status recovery (Therapeutic Energy) runs here. It runs last, after the Jet switch, which
  // clears conditions itself.
  next = recoverStatuses(next, events);
  // Gengar ex "Gnawing Curse": counters on a Pokémon the opponent attaches an Energy to from hand.
  // The subject is read by uid after the riders, so it survives a Jet Energy switch.
  const attachedTo = bodyHoldingEnergy(next, action.seat, action.uid);
  if (attachedTo !== undefined) {
    // Magearna "Auto Heal": the same moment in the self direction. It runs first because the turn
    // player's own effects resolve first and the heal is clamped. The subject comes from the
    // post-rider board; the `activeOnly` gate reads `atAttach`.
    next = runSelfWatchedTriggers(
      next,
      action.seat,
      attachedTo,
      "onEnergyAttach",
      events,
      atAttach,
    );
    const watched = runWatchedTriggers(
      next,
      action.seat,
      attachedTo,
      "onEnergyAttach",
      events,
      atAttach,
    );
    // Pachirisu "Electrified Incisors": the marked body takes its counters after the watched
    // triggers; the sweep below handles the Knock Out.
    const shocked = shockAttachedBody(watched, action.seat, attachedTo, events);
    // A Jet Energy switch can make the moved body lethal even with no watched trigger.
    if (shocked !== next || switched) {
      next = shocked;
      // The search's settle runs the mid-turn sweep once it is done.
      if (benchSearch !== undefined)
        return searchAfterAttach(next, action.seat, benchSearch, endsTurn, events);
      // The counters can be lethal on the acting seat's own board mid-turn. With Hypno's mark, the
      // turn end runs behind the sweep's prize and promotion stages instead of `resumeTurn`.
      return resolveMidTurnKnockOuts(
        next,
        action.seat,
        [action.seat],
        events,
        endsTurn ? turnTail(action.seat) : undefined,
      );
    }
  }
  // Hypno "Daydream": the attach onto the marked Pokémon ends the turn, after the riders, the §12
  // recovery and the watched triggers.
  if (benchSearch !== undefined)
    return searchAfterAttach(next, action.seat, benchSearch, endsTurn, events);
  if (endsTurn) return advance({ ...next, pending: turnTail(action.seat) }, events);
  return ok(next, events);
}

/**
 * Applies Electrified Incisors' counters to the body topped by `uid` after one Energy card from
 * hand landed on it; returns `state` unchanged when nothing is placed.
 */
function shockAttachedBody(
  state: GameState,
  seat: Seat,
  uid: string,
  events: GameEvent[],
): GameState {
  const side = state.players[seat];
  if (side.active !== null && topUid(side.active) === uid) {
    const shocked = shockHandAttach(state, seat, side.active, 1, events);
    return shocked === side.active ? state : withSide(state, seat, { ...side, active: shocked });
  }
  const index = side.bench.findIndex((p) => topUid(p) === uid);
  const benched = side.bench[index];
  if (benched === undefined) return state;
  const shocked = shockHandAttach(state, seat, benched, 1, events);
  if (shocked === benched) return state;
  return withSide(state, seat, {
    ...side,
    bench: side.bench.map((p, i) => (i === index ? shocked : p)),
  });
}

/**
 * Telepathic Psychic Energy's Bench search, the hand attach's last step. Folded through
 * `settleProgram`, which parks the pick and then runs the mid-turn KO sweep or, after a Hypno
 * "Daydream" attach, ends the turn.
 */
function searchAfterAttach(
  state: GameState,
  seat: Seat,
  program: EffectOp[],
  endsTurn: boolean,
  events: GameEvent[],
): ApplyResult {
  return settleProgram(
    runProgram(state, program, { seat }, events),
    seat,
    events,
    endsTurn ? { endsTurn: true } : {},
  );
}

/**
 * The top-card uid of the body on `seat`'s board carrying `energyUid`. Keyed on the Energy rather
 * than the action target because Jet Energy's switch can change which Pokémon the target index
 * names.
 */
function bodyHoldingEnergy(state: GameState, seat: Seat, energyUid: string): string | undefined {
  const side = state.players[seat];
  const bodies = inPlayOf(side);
  for (const body of bodies) {
    if (body.energy.includes(energyUid)) return topUid(body);
  }
  return undefined;
}

/**
 * Whether `uid` is a non-Basic in hand with an in-hand bench Ability (Klinklang "Emergency
 * Rotation"). `null` when not; otherwise either the reject the Ability's limits owe (once per turn
 * first, then its board condition) or the allowance key and Ability name. An in-play Ability lock
 * does not reach a card in hand.
 */
function benchFromHandRotation(
  state: GameState,
  seat: Seat,
  uid: string,
): { reject: ApplyResult } | { usedKey: string; name: string } | null {
  if (!state.players[seat].hand.includes(uid)) return null;
  const card = cardOfUid(state, uid);
  const rotation =
    card === undefined || isBasicPokemon(card) ? undefined : programFor(card.id)?.benchFromHand;
  if (rotation === undefined) return null;
  const usedKey = abilityUsedKey(uid, rotation);
  if (state.allowances.abilitiesUsed.includes(usedKey)) {
    return {
      reject: err("ABILITY_ALREADY_USED", `${rotation.name} was already used this turn (§9)`),
    };
  }
  if (!conditionHolds(state, seat, rotation.playableIf)) {
    return {
      reject: err(
        "ABILITY_CONDITION_NOT_MET",
        `${rotation.name} can only be used if ${conditionNote(rotation.playableIf)} (§9)`,
      ),
    };
  }
  return { usedKey, name: rotation.name };
}

/** §5.2: Basics to the Bench, any number per turn, up to the live `benchLimitOf`. */
export function playBasicToBench(state: GameState, action: PlayBasicToBenchAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  const side = state.players[action.seat];
  const benchLimit = benchLimitOf(state, action.seat);
  if (side.bench.length >= benchLimit) {
    return err("BENCH_FULL", `the bench holds at most ${benchLimit} Pokémon`);
  }
  // Klinklang "Emergency Rotation" puts a non-Basic onto the Bench, so it is checked before
  // `basicFromHandError`. `pokemonPlayBarred` still applies.
  const rotation = benchFromHandRotation(state, action.seat, action.uid);
  if (rotation !== null && "reject" in rotation) return rotation.reject;
  if (rotation === null) {
    const invalid = basicFromHandError(state, action.seat, action.uid);
    if (invalid !== null) return invalid;
  }
  // §7.5: a continuous play bar (Team Rocket's Arbok "Potent Glare") covers a bench placement.
  // Checked after the not-a-Basic and bench-full errors so the player's own limits are reported
  // first.
  if (pokemonPlayBarred(state, action.seat, "bench", cardOfUid(state, action.uid))) {
    return err(
      "HAND_PLAY_BLOCKED",
      "your opponent prevents you from playing this Pokémon from your hand",
    );
  }

  // makeInPlay records turnPlayed — M4's evolution timing ("not the turn it
  // came into play", §10) reads it.
  const benched = withSide(state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
    bench: [...side.bench, makeInPlay(action.uid, state.turn)],
  });
  // Spends the Ability's once-per-turn allowance; `ABILITY_USED` precedes the bench event, matching
  // `useAbility`.
  const next =
    rotation === null
      ? benched
      : {
          ...benched,
          allowances: {
            ...benched.allowances,
            abilitiesUsed: [...benched.allowances.abilitiesUsed, rotation.usedKey],
          },
        };
  const events: GameEvent[] = [
    ...(rotation === null
      ? []
      : [
          {
            type: "ABILITY_USED" as const,
            seat: action.seat,
            uid: action.uid,
            ability: rotation.name,
          },
        ]),
    { type: "POKEMON_BENCHED", seat: action.seat, uid: action.uid },
  ];
  // Risky Ruins: the counters land with the body, before its own on-bench trigger.
  const landed = benchArrivalCounters(next, action.seat, [action.uid], events);
  // §9 — a "when you play this Pokémon onto your Bench during your turn"
  // triggered Ability (Flamigo's Insta-Flock) fires now, on the freshly
  // benched Pokémon (the last, dense slot). It may park on effect:choose.
  const benchIndex = landed.players[action.seat].bench.length - 1;
  return runBoardTrigger(
    landed,
    action.seat,
    { spot: "bench", index: benchIndex },
    "onPlayToBench",
    events,
  );
}

/**
 * §10: place an Evolution card from hand on one of your in-play Pokémon whose top card it evolves
 * from, or whose Ability aliases the name (Eevee ex). Never a card with `intoPlayOnlyVia`. Each
 * Pokémon may evolve once per turn; uses none of the energy or retreat allowances.
 */
export function evolve(state: GameState, action: EvolveAction): ApplyResult {
  const placement = checkEvolution(state, action);
  if ("ok" in placement) return placement;
  const { side, target, benchIndex, targetTopUid } = placement;
  // §10 — the evolution card leaves hand; the shared placement (below) puts it
  // on the stack, carries over damage/energy/tools, clears conditions/markers,
  // resets turnPlayed, and runs the evolve-below-HP KO check + the on-evolve
  // trigger. Rare Candy (§7.1, cardplay.ts) reuses the SAME placement to skip
  // the Stage 1 — the two card plays differ only in what they validate first.
  const stateAfterHand = withSide(state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
  });
  return placeEvolution(
    stateAfterHand,
    action.seat,
    action.target,
    benchIndex,
    target,
    targetTopUid,
    action.uid,
    [],
  );
}

/** Legal hand-evolution hosts, using the action's checks without running its
    placement, triggers or effects. Only the acting player's hand is queried. */
export function evolutionTargetUids(state: GameState, seat: Seat, uid: string): string[] {
  if (state.phase.kind !== "turn:action" || state.phase.seat !== seat) return [];
  const card = cardOfUid(state, uid);
  if (card === undefined || evolveFromOf(card) === null) return [];
  const side = state.players[seat];
  const targets: PokemonTarget[] = [
    ...(side.active === null ? [] : [{ spot: "active" } as const]),
    ...side.bench.map((_, index) => ({ spot: "bench" as const, index })),
  ];
  return targets.flatMap((target) => {
    const checked = checkEvolution(state, { type: "evolve", seat, uid, target });
    return "ok" in checked ? [] : [checked.targetTopUid];
  });
}

function checkEvolution(
  state: GameState,
  action: EvolveAction,
):
  | ApplyResult
  | {
      side: PlayerSide;
      target: InPlayPokemon;
      benchIndex: number;
      targetTopUid: string;
    } {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;

  const side = state.players[action.seat];
  if (!side.hand.includes(action.uid)) {
    return err("CARD_NOT_IN_HAND", `${action.uid} is not in ${action.seat}'s hand`);
  }
  const card = cardOfUid(state, action.uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${action.uid}`);
  }
  const evolvesFrom = evolveFromOf(card);
  if (evolvesFrom === null) {
    return err("NOT_AN_EVOLUTION", `${card.name} is not an Evolution Pokémon`);
  }
  // Wire shape check, same as attachEnergy: a null/garbled target must reject,
  // not throw on `.spot`; the bench index is checked at the use site below.
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "evolve target must name the Active spot or a bench index");
  }

  // Resolve the in-play Pokémon being evolved.
  let target: InPlayPokemon;
  let benchIndex = -1;
  if (action.target.spot === "active") {
    if (side.active === null) {
      return err("NO_TARGET", "no Active Pokémon to evolve");
    }
    target = side.active;
  } else {
    // Same wire-decode trap as attachEnergy/retreat: a string index would
    // index the bench fine yet corrupt the write-back below.
    benchIndex = action.target.index;
    const benched = isBenchIndex(benchIndex) ? side.bench[benchIndex] : undefined;
    if (benched === undefined) {
      return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(benchIndex)}`);
    }
    target = benched;
  }

  const targetTopUid = topUid(target);
  const targetTopCard = targetTopUid === undefined ? undefined : cardOfUid(state, targetTopUid);
  if (targetTopUid === undefined || targetTopCard === undefined) {
    return err("UNKNOWN_CARD", "the target Pokémon has no resolvable top card");
  }
  // §10: `evolveFrom` must name the target's top card, or an Ability on the target must license the
  // name (Eevee ex "Rainbow DNA"). Read through `passivesOf`, so a §9 lock removes the licence.
  if (targetTopCard.name !== evolvesFrom && !evolveAliasLicensed(state, target, card)) {
    return err("EVOLVE_MISMATCH", `${card.name} does not evolve from ${targetTopCard.name}`);
  }
  // Palafin ex can only be put into play by Zero to Hero. Read off the card's program, not
  // `passivesOf`, because the card is in hand and a §9 lock must not lift it.
  const onlyVia = intoPlayOnlyViaOf(card);
  if (onlyVia !== undefined) {
    return err(
      "EVOLVE_ONLY_VIA_ABILITY",
      `${card.name} can be put into play only with the effect of the ${onlyVia} Ability`,
    );
  }
  // §4/§10: both timing bans are lifted by one licence (`evolveEarlyLicensed`, e.g. Eevee "Boosted
  // Evolution"), asked once above both. It uses `action.seat`, the evolving player. The licence
  // depends on the target, so the §4 ban is checked after the target is resolved.
  const licensed = evolveEarlyLicensed(state, action.seat, target);
  // §4/§10: neither player may evolve on their own first turn. `turnPlayed` cannot express this
  // because setup Pokémon carry 0.
  if (!licensed && isFirstTurnOf(state, action.seat)) {
    return err("FIRST_TURN_EVOLVE", "cannot evolve on your first turn (§4/§10)");
  }
  // §10: a Pokémon cannot evolve the turn it came into play or twice in one turn. Setup Pokémon
  // carry 0. The licence lifts both halves, so a licence holder that is itself an evolution (Luxio
  // "Fighting Roar") can chain evolutions in one turn.
  if (!licensed && target.turnPlayed >= state.turn) {
    // Forest of Vitality lifts this ban (not the §4 one) for a {G} body evolving into a {G} card,
    // including one that evolved this turn.
    if (!stadiumLicensesSameTurnEvolve(state, target, card)) {
      return err(
        "EVOLVE_TOO_SOON",
        `${targetTopCard.name} came into play this turn — it cannot evolve yet (§10)`,
      );
    }
  }
  // §10: the Pokémon play bar from either source (Bronzong "Evolution Jammer", Team Rocket's
  // Arbok). The bar is checked against the evolution card being played, not the body it lands on.
  // Checked after the timing bans and before the placement, so a barred evolve costs nothing.
  if (pokemonPlayBarred(state, action.seat, "evolve", card)) {
    return err(
      "HAND_PLAY_BLOCKED",
      "your opponent prevents you from playing Pokémon from your hand to evolve",
    );
  }

  return { side, target, benchIndex, targetTopUid };
}

/**
 * §10/§7.1: the evolution placement shared by `evolve` and `rareCandy`, plus its tails. The caller
 * has removed the card(s) from hand and validated legality. After placing, §8.1: evolving can lower
 * max HP, so a KO check runs first; otherwise the on-evolve trigger fires and may park. The
 * deck-sourced route calls `evolveOnto` directly and owes neither tail.
 */
export function placeEvolution(
  state: GameState,
  seat: Seat,
  target: PokemonTarget,
  benchIndex: number,
  from: InPlayPokemon,
  fromUid: string,
  evolutionUid: string,
  events: GameEvent[],
): ApplyResult {
  const { state: next, evolved } = evolveOnto(
    state,
    seat,
    target,
    benchIndex,
    from,
    fromUid,
    evolutionUid,
    events,
    stageChangeConditions(state, from.conditions),
  );
  if (isLethallyDamaged(next, evolved)) {
    return resolveMidTurnKnockOuts(next, seat, [seat], events);
  }
  // The opponent's watched evolve triggers (Team Rocket's Ampharos "Darkest Impulse", "from their
  // hand"). Only hand routes reach this function, so deck-sourced evolves do not fire it. Runs
  // after the §8.1 check and before the controller's own on-evolve trigger, which may park.
  const watched = runWatchedTriggers(next, seat, evolutionUid, "onEvolve", events, next);
  const subject =
    target.spot === "active"
      ? watched.players[seat].active
      : watched.players[seat].bench[benchIndex];
  if (subject !== null && subject !== undefined && isLethallyDamaged(watched, subject)) {
    return resolveMidTurnKnockOuts(watched, seat, [seat], events);
  }
  const triggered = runBoardTrigger(watched, seat, target, "onEvolve", events);
  // §7.3: an evolution that removed `seat`'s last Tera Pokémon under Area Zero Underdepths owes the
  // Bench trim now, if no trigger sweep already handled it.
  if (
    !triggered.ok ||
    triggered.state.phase.kind !== "turn:action" ||
    benchTrimStages(triggered.state, seat).length === 0
  ) {
    return triggered;
  }
  return resolveMidTurnKnockOuts(triggered.state, seat, [seat], triggered.events);
}

/**
 * Leaving the Active Spot removes Special Conditions (§11/§12) and every other effect of an attack
 * still on the Pokémon, along with active-only markers.
 */
function clearOnLeavingActive(pokemon: InPlayPokemon): InPlayPokemon {
  return {
    ...pokemon,
    conditions: noConditions(),
    // Retreating the Defending Pokémon during its own turn is the printed counterplay to a
    // scheduled effect. The retreat has already paid any taxed cost.
    ...clearedAttackEffects(),
  };
}

/** §11 — once per turn: the player names WHICH attached energies pay the
    cost (count must equal the top card's retreat cost exactly) and which
    benched Pokémon takes the Active spot. */
export function retreat(state: GameState, action: RetreatAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  if (state.allowances.retreated) {
    return err("ALREADY_RETREATED", "only one retreat per turn (§11)");
  }
  const side = state.players[action.seat];
  const active = side.active;
  if (active === null) {
    // Unreachable — KO promotion is forced before the next action, so the
    // Active spot is never empty during turn:action.
    return err("NO_TARGET", "no Active Pokémon to retreat");
  }
  // §11/§12 — an Asleep or Paralyzed Active cannot retreat. (Confusion does
  // not restrict retreating.)
  const rotation = active.conditions.rotation;
  if (isImmobilized(active.conditions)) {
    return err(
      "STATUS_PREVENTS_RETREAT",
      `${rotation === "asleep" ? "an Asleep" : "a Paralyzed"} Pokémon cannot retreat (§11)`,
    );
  }
  // §11: an attack effect holds it in place. Its own code, not STATUS_PREVENTS_RETREAT, since it is
  // not a Special Condition.
  if (retreatLocked(state, active)) {
    // Antique Fossil's "can't retreat" and Roxie's Performance's side lock are not attack effects,
    // so they get their own messages, unless an attack lock also holds the body. Same error code.
    const attackHeld = active.retreatBlocked || active.retreatLockedTurn === state.turn;
    return err(
      "RETREAT_PREVENTED",
      isFossilTop(state, active)
        ? "this card can't retreat (its own printed rule)"
        : !attackHeld && sideRetreatLocked(state, active)
          ? "a Trainer effect prevents Poisoned Pokémon from retreating this turn (§11)"
          : "an attack effect prevents this Pokémon from retreating (§11)",
    );
  }
  // §11: an opposing continuous Ability (Snorlax "Block"). Same error code as the attack lock,
  // different message.
  if (opposingRetreatBlocked(state, active)) {
    return err(
      "RETREAT_PREVENTED",
      "an opposing Ability prevents this Pokémon from retreating (§11)",
    );
  }
  if (side.bench.length === 0) {
    return err("BENCH_EMPTY", "cannot retreat with an empty bench (§11)");
  }
  // Same wire-decode trap as attachEnergy, but worse: a string index would
  // reach `slice(index + 1)` as a CONCATENATION ("1" + 1 = "11"), silently
  // deleting every benched Pokémon past the promoted slot.
  const promoteBenchIndex = action.promoteBenchIndex;
  const promoted = isBenchIndex(promoteBenchIndex) ? side.bench[promoteBenchIndex] : undefined;
  if (promoted === undefined) {
    return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(promoteBenchIndex)}`);
  }
  const activeTopUid = topUid(active);
  const promotedTopUid = topUid(promoted);
  if (activeTopUid === undefined || promotedTopUid === undefined) {
    return err("UNKNOWN_CARD", "in-play stack is empty"); // structurally impossible
  }
  const topCard = cardOfUid(state, activeTopUid);
  if (topCard === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${activeTopUid}`);
  }

  // The array-ness and the cheap bound check come FIRST: discardEnergy is
  // caller-supplied (a P4 client controls it), so a non-array must never
  // reach `new Set` below — a length-faking object throws there — and the
  // O(n) membership scans must never run on an unbounded list. The cost is
  // the CONTINUOUS one (§7.3 — Beach Court discounts Basics).
  const cost = effectiveRetreatCost(state, active);
  const chosen = action.discardEnergy;
  if (!Array.isArray(chosen) || chosen.length !== cost) {
    return err("RETREAT_COST_MISMATCH", `retreat costs exactly ${cost} energy`);
  }
  const chosenSet = new Set(chosen);
  if (chosenSet.size !== chosen.length) {
    return err("ENERGY_NOT_ATTACHED", "duplicate energy uids in discardEnergy");
  }
  for (const uid of chosen) {
    if (!active.energy.includes(uid)) {
      return err("ENERGY_NOT_ATTACHED", `${uid} is not attached to the Active Pokémon`);
    }
  }

  // Goodra "Slimy Sliding": after every check passes, flip one coin. Tails: nothing is discarded or
  // switched, but the retreat is still spent.
  const slimy = retreatCoinFlipSource(state, action.seat);
  const flips: GameEvent[] = [];
  let rngState = state.rngState;
  if (slimy !== undefined) {
    const holderSeat = otherSeat(action.seat);
    const [face, advanced] = flipCoin(rngState);
    rngState = advanced;
    flips.push(
      { type: "ABILITY_TRIGGERED", seat: holderSeat, uid: slimy.uid, ability: slimy.ability },
      {
        type: "ABILITY_COIN_FLIP",
        seat: holderSeat,
        uid: slimy.uid,
        ability: slimy.ability,
        result: face,
      },
    );
    if (face === "tails") {
      return ok(
        { ...state, rngState, allowances: { ...state.allowances, retreated: true } },
        flips,
      );
    }
  }

  // The cost payment is the shared "cards leave play for the discard" move
  // (types.ts) — the same primitive KO cleanup uses.
  const paid = discardFromStack(side, active, chosenSet);
  const benched = { ...clearOnLeavingActive(paid.pokemon), benchedTurn: state.turn };
  // Swap into the promoted Pokémon's bench slot, preserving the other slots.
  const bench = [
    ...side.bench.slice(0, promoteBenchIndex),
    benched,
    ...side.bench.slice(promoteBenchIndex + 1),
  ];
  const next: GameState = {
    ...withSide(state, action.seat, {
      ...paid.side,
      // The Pokémon remembers WHEN it came in from the Bench (types.ts
      // `promotedTurn`) — a retreat is the deliberate half of that move.
      active: { ...promoted, promotedTurn: state.turn },
      bench,
    }),
    rngState,
    allowances: { ...state.allowances, retreated: true },
  };
  const events: GameEvent[] = [
    ...flips,
    {
      type: "RETREATED",
      seat: action.seat,
      retreated: activeTopUid,
      promoted: promotedTopUid,
      promotedFrom: promoteBenchIndex,
      benchedTo: promoteBenchIndex,
      // In PILE order (discardFromStack appends stack → energy → tools, so a
      // cost payment lands in attachment order), NOT the caller's chosen
      // order — the event reports what the public, ordered pile gained (§2),
      // exactly like KNOCKED_OUT's `discarded`.
      discardedEnergy: paid.discarded,
    },
  ];
  // §11/§12 — benching removed the retreater's Special Conditions
  // (clearOnLeavingActive above). Announced only when there was anything to
  // remove; `statuses` lists exactly what was present.
  const cleared = presentStatuses(active.conditions);
  if (cleared.length > 0) {
    events.push({
      type: "STATUS_CLEARED",
      seat: action.seat,
      uid: activeTopUid,
      statuses: cleared,
      reason: "benched",
    });
  }
  // §9: the Active-to-Bench move trigger (Magcargo "Lava Zone"). Retreat never calls `switchInto`,
  // so it calls the shared `runActiveBenchedTriggers` itself.
  const moved = runActiveBenchedTriggers(next, action.seat, activeTopUid, events);
  // §8.1: the retreat cost can be lethal, since discarding Energy can shrink an Energy-counted HP
  // bonus (Conkeldurr "Craftsmanship"); move triggers can also place counters. Only the actor's
  // board can change. The sweep runs after the move triggers so an Ability answering the move fires
  // before the Knock Out.
  return resolveMidTurnKnockOuts(moved, action.seat, [action.seat], events);
}

/** Pass: seed the staged tail (flow.ts turnTail) and drain it. */
export function endTurn(state: GameState, action: EndTurnAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  return advance({ ...state, pending: turnTail(action.seat) }, []);
}

/**
 * The actor's in-play spots topped by an Antique Fossil, Active first, during the actor's main
 * phase (outside Festival Lead's window); empty otherwise. The single source for the offer and for
 * `discardFromPlay`.
 */
export function discardableTargets(state: GameState, seat: Seat): PokemonTarget[] {
  if (turnGate(state, { type: "discardFromPlay", seat }) !== null) return [];
  const side = state.players[seat];
  const out: PokemonTarget[] = [];
  if (side.active !== null && isFossilTop(state, side.active)) out.push({ spot: "active" });
  side.bench.forEach((body, index) => {
    if (isFossilTop(state, body)) out.push({ spot: "bench", index });
  });
  return out;
}

/**
 * §7.1: Antique Fossil's "At any time during your turn, you may discard this card from play." Only
 * in the actor's main phase. The whole stack, Energy and Tools go to the discard pile; it is not a
 * Knock Out, so no Prize or on-KO trigger. A discarded Active is owed a promotion, and an empty
 * board loses (§14.2).
 */
export function discardFromPlay(state: GameState, action: DiscardFromPlayAction): ApplyResult {
  const rejected = turnGate(state, action);
  if (rejected !== null) return rejected;
  if (!isPokemonTarget(action.target)) {
    return err("BAD_TARGET", "discardFromPlay needs an Active or Bench target");
  }
  const side = state.players[action.seat];
  const target = action.target;
  if (target.spot === "bench" && !isBenchIndex(target.index)) {
    return err("BAD_BENCH_INDEX", `no benched Pokémon at index ${String(target.index)}`);
  }
  const body = bodyAt(side, target);
  if (body === undefined) {
    return err("NO_TARGET", "there is no Pokémon in that spot");
  }
  const uid = topUid(body);
  if (uid === undefined || !isFossilTop(state, body)) {
    return err(
      "NOT_DISCARDABLE",
      'only a card that prints "discard this card from play" can be discarded from play',
    );
  }
  const cleanup = discardFromStack(side, body, "all");
  const events: GameEvent[] = [
    {
      type: "POKEMON_RETURNED",
      seat: action.seat,
      uid,
      actor: action.seat,
      dest: "discard",
      uids: cleanup.discarded,
    },
  ];
  const next = withSide(
    state,
    action.seat,
    target.spot === "active"
      ? { ...cleanup.side, active: null }
      : { ...cleanup.side, bench: cleanup.side.bench.filter((_, index) => index !== target.index) },
  );
  return resolveMidTurnKnockOuts(next, action.seat, [action.seat], events);
}
