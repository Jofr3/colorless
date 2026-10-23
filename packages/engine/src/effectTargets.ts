import type { BasicEnergyType, Card } from "@colorless/schema";
import {
  activeTop,
  cardOfUid,
  energyProvidesOf,
  isBasicEnergy,
  matchesFilter,
  preventsAttackerBanner,
  topUid,
} from "./cards";
import {
  attackBlockOf,
  attackerHasSpecialEnergy,
  benchLimitOf,
  benchShieldedFromEffects,
  groupShieldedFromAttackEffects,
  hasAttachedEnergy,
  inPlayCardOf,
  inPlayToHandBlocked,
  isLethallyDamaged,
  passivesOf,
  providesEnergyType,
  seatShieldedFromSupporterEffects,
  stadiumEffectsOf,
} from "./continuous";
import type { DiscardScope, EffectContext, EffectRecord, PokemonRef } from "./effectPrompt";
import type { CardFilter, EffectSlot, OpOf } from "./effectTypes";
import type { GameEvent } from "./events";
import type { GameState, InPlayPokemon, Seat } from "./types";
import { bodyAt, koByEffectMarker, otherSeat, pokemonAt, relativeSeat, withSide } from "./types";

// Candidate builders and small shared helpers for the op implementations: body lookups, the §11
// refusal checks, the §9.2 record and the discard and move offers.

/** The uids filed under `slot`, or none. */
export function recorded(record: EffectRecord, slot: EffectSlot): readonly string[] {
  return record[slot] ?? [];
}

/** File `uids` under `slot`, if the op asked for it. Always a FRESH array: the
    record a park stored lives inside `GameState` (the phase's continuation), and
    a resumed run seeds its accumulator from it — so writes must replace entries,
    never mutate the arrays behind them. */
export function recordMoved(
  record: EffectRecord,
  slot: EffectSlot | undefined,
  uids: readonly string[],
): void {
  if (slot !== undefined) record[slot] = [...uids];
}

/**
 * The Active of `seat` with its top uid, or null when the spot is empty or the body refuses this
 * effect (§11, announced). The refusal is asked before any idempotence early return, so it is
 * announced even on a body that already carries the stamp.
 */
export function unrefusedActive(
  state: GameState,
  seat: Seat,
  ctx: EffectContext,
  events: GameEvent[],
): { active: InPlayPokemon; uid: string } | null {
  const active = state.players[seat].active;
  if (active === null) return null;
  const uid = topUid(active);
  if (uid === undefined) return null;
  if (effectRefused(state, seat, ctx, events)) return null;
  return { active, uid };
}

/**
 * Is a body of `seat`'s opponent lethally damaged, and not doomed by an effect this turn? Inside an
 * attack program this means "Knocked Out by damage from this attack".
 */
export function opponentKnockedOutByDamage(state: GameState, seat: Seat): boolean {
  const side = state.players[otherSeat(seat)];
  return [side.active, ...side.bench].some(
    (body) =>
      body !== null &&
      isLethallyDamaged(state, body) &&
      !body.markers.includes(koByEffectMarker(state.turn)),
  );
}

/**
 * The pure predicate behind `effectRefused`, for per-candidate readers that drop shielded bodies
 * from a list without announcing a refusal.
 */
function effectRefusedOn(
  state: GameState,
  target: InPlayPokemon,
  seat: Seat,
  ctx: EffectContext,
): boolean {
  // Trainer channel: both sentences are about cards the opponent plays, so a Trainer you play on
  // your own Pokémon is not refused by your own shield.
  if (ctx.invokedBy === "item" || ctx.invokedBy === "supporter") {
    if (seat === ctx.seat) return false;
    // Fraxure / Cetitan ex: the HOLDER rule, and the fold answers it whole — no
    // zone clause, no source clause, and BOTH trainer types refused.
    if (passivesOf(state, target).preventTrainerEffects) return true;
    // Antique Sail Fossil — Protective Sail: the holder rule, Supporters only.
    if (ctx.invokedBy === "supporter" && passivesOf(state, target).preventSupporterEffects)
      return true;
    // Rhyperior: the SEAT rule, Supporters only. `seat` and not `target` because
    // the printed target is "all of your Pokémon" — the scan is about the side.
    return ctx.invokedBy === "supporter" && seatShieldedFromSupporterEffects(state, seat);
  }
  // Ability channel: Mega Clefable ex — Luminous Wing, "Prevent all effects of your opponent's
  // Pokémon's Abilities done to this Pokémon." An Ability from the shielded body's own side is not
  // refused.
  if (ctx.invokedBy === "ability") {
    return seat !== ctx.seat && passivesOf(state, target).preventAbilityEffects;
  }
  if (ctx.invokedBy !== "attack") return false;
  // Every attack-effect shield names the holder's opponent as the source, so an effect an attack
  // aims at its own side is refused by nothing.
  if (seat === ctx.seat) return false;
  // The attacker is `ctx.seat`'s Active by construction, so it is resolved here rather than passed
  // in. The damage amount is undefined because this gate is about effects, so a damage-capped block
  // never refuses an effect. Installed blocks and Ability auras are ORed.
  const attackerTop = activeTop(state, ctx.seat);
  // The in-play card, so blocks read the attacker's current types.
  const attacker = attackerTop === null ? undefined : inPlayCardOf(state, attackerTop.active);
  // Auras are read through `passivesOf`, so a §9 lock over the holder switches the refusal off.
  // "Done to this Pokémon" auras fold per body; "done to your … Pokémon" auras cover a set and need
  // a scan.
  const auraRefuses =
    (passivesOf(state, target).preventDamageAndEffectsFromSpecialEnergy &&
      attackerHasSpecialEnergy(state, attackerTop?.active)) ||
    // Sparkling Scales' effects half: "from and effects of attacks from your opponent's Tera
    // Pokémon".
    preventsAttackerBanner(
      passivesOf(state, target).preventDamageAndEffectsFromBanners,
      attacker,
    ) ||
    passivesOf(state, target).preventDamageAndEffectsWhileBenched ||
    passivesOf(state, target).preventAttackEffects ||
    benchShieldedFromEffects(state, target) ||
    groupShieldedFromAttackEffects(state, target);
  return auraRefuses || attackBlockOf(state, target, attacker, undefined)?.effects === true;
}

/**
 * §11 — is an effect aimed at `seat`'s `target` (default: its Active) refused, and if so announce
 * it with `ATTACK_EFFECT_PREVENTED`. Exported for attack.ts's pre-damage strip; it returns a
 * boolean and never parks.
 */
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
      : ctx.invokedBy === "ability"
        ? { type: "ABILITY_EFFECT_PREVENTED", seat, uid }
        : { type: "ATTACK_EFFECT_PREVENTED", seat, uid },
  );
  return true;
}

/**
 * Battle Cage: "Prevent all damage counters from being placed on Benched Pokémon (both yours and
 * your opponent's) by effects of attacks and Abilities from the opponent's Pokémon." Callers ask
 * only for a Benched body; the target stays offered and no row is filed. Trainers, Tools, Checkup
 * counters and a player's own effects are not stopped.
 */
export function benchCountersCaged(state: GameState, seat: Seat, ctx: EffectContext): boolean {
  return (
    stadiumEffectsOf(state)?.benchCounterShield === true &&
    (ctx.invokedBy === "attack" || ctx.invokedBy === "ability") &&
    seat !== ctx.seat
  );
}

/**
 * Drops from `refs` every body that refuses this effect, announcing one row per dropped body. A
 * filter rather than a whole-op guard, so one shielded body doesn't protect the whole Bench from a
 * chosen-target effect.
 */
export function unshieldedRefs(
  state: GameState,
  refs: readonly PokemonRef[],
  ctx: EffectContext,
  events: GameEvent[],
): PokemonRef[] {
  return refs.filter((ref) => {
    const side = state.players[ref.seat];
    const body = bodyAt(side, ref.spot);
    if (body === undefined) return true; // not our call — the op validates refs
    return !effectRefused(state, ref.seat, ctx, events, body);
  });
}

/**
 * `unshieldedRefs` over the bodies a discard offer draws from: drops every entry whose host refuses
 * this effect, announcing one row per distinct refusing body in first-seen order.
 */
export function unshieldedEntries<T extends { from: PokemonRef }>(
  state: GameState,
  entries: readonly T[],
  ctx: EffectContext,
  events: GameEvent[],
): T[] {
  const bodies = new Map<string, PokemonRef>();
  for (const entry of entries) {
    const key = refKeyOf(entry.from);
    if (!bodies.has(key)) bodies.set(key, entry.from);
  }
  const allowed = new Set(unshieldedRefs(state, [...bodies.values()], ctx, events).map(refKeyOf));
  return entries.filter((entry) => allowed.has(refKeyOf(entry.from)));
}

/** Write `body` back at `ref`. */
export function withBodyAt(state: GameState, ref: PokemonRef, body: InPlayPokemon): GameState {
  const side = state.players[ref.seat];
  const spot = ref.spot;
  return withSide(
    state,
    ref.seat,
    spot.spot === "active"
      ? { ...side, active: body }
      : { ...side, bench: side.bench.map((pokemon, i) => (i === spot.index ? body : pokemon)) },
  );
}

/** Whether a body has any damage counters: `damage > 0`, matching the `conditionHolds` arms. */
export function hasAnyDamageCounters(pokemon: InPlayPokemon): boolean {
  return pokemon.damage > 0;
}

/**
 * Narrow refs to bodies whose top card matches `filter`, or return them unchanged when none is
 * given.
 */
export function filteredRefs(
  state: GameState,
  refs: PokemonRef[],
  filter: CardFilter | undefined,
): PokemonRef[] {
  if (filter === undefined) return refs;
  return refs.filter((ref) => matchesFilter(refTopCard(state, ref), filter));
}

/**
 * The printed "this Pokémon" as a zero- or one-element target list: the in-play Pokémon whose top
 * card is `ctx.sourceUid`. Empty is a live answer (no source, or the card is no longer a top).
 * Matched by top uid because a card evolved over is no longer "this Pokémon". Takes only the fields
 * it reads so `programPlayable` can call it without an `EffectContext`.
 */
export function sourceRef(
  state: GameState,
  ctx: Pick<EffectContext, "seat" | "sourceUid">,
): PokemonRef[] {
  if (ctx.sourceUid === undefined) return [];
  const side = state.players[ctx.seat];
  if (side.active !== null && topUid(side.active) === ctx.sourceUid) {
    return [{ seat: ctx.seat, spot: { spot: "active" } }];
  }
  const index = side.bench.findIndex((pokemon) => topUid(pokemon) === ctx.sourceUid);
  return index === -1 ? [] : [{ seat: ctx.seat, spot: { spot: "bench", index } }];
}

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
export function matchesAttached(
  state: GameState,
  pokemon: InPlayPokemon,
  uid: string,
  filter: CardFilter,
): boolean {
  if (filter.kind === "providesEnergy") {
    return providesEnergyType(state, pokemon, uid, filter.energyType);
  }
  return matchesFilter(cardOfUid(state, uid), filter);
}

/**
 * The board a `discardEnergy` op takes Energy off: the controller's for the own-board scopes, the
 * opponent's for the hammer arms. One helper so the candidate scan, the apply and the §11
 * attack-block guard agree.
 */
export function discardVictimSeat(seat: Seat, op: OpOf<"discardEnergy">): Seat {
  return op.from === "yourActive" ||
    op.from === "yours" ||
    op.from === "yourBench" ||
    op.from === "self"
    ? seat
    : otherSeat(seat);
}

/**
 * The Energy a `discardEnergy` op may take, in board order: the `…Active` arms see only that
 * Active, `self` sees the one body the program is printed on, the rest the whole victim board.
 * `sourceUid` is a parameter because `programPlayable` has no context; an absent uid makes `self`
 * whiff rather than strip the Active.
 */
export function discardableEnergies(
  state: GameState,
  seat: Seat,
  op: OpOf<"discardEnergy">,
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
    const host = bodyAt(side, ref.spot);
    if (host === undefined) return [];
    return host.energy
      .filter((uid) => matchesAttached(state, host, uid, op.filter))
      .map((uid) => ({ uid, from: ref }));
  }
  // `"attacker"`: the one opponent body `sourceUid` names, wherever it sits. Empty when no uid was
  // given or it left the board.
  if (op.from === "attacker") {
    if (sourceUid === undefined) return [];
    return attachedEnergies(state, discardVictimSeat(seat, op), op.filter).filter((entry) => {
      const host = refPokemon(state, entry.from);
      return host !== undefined && topUid(host) === sourceUid;
    });
  }
  // "From your Benched Pokémon" is the own side minus the Active; reading it as `"all"` would offer
  // the Energy that paid for the attack.
  const activeOnly = op.from === "opponentActive" || op.from === "yourActive";
  const benchOnly = op.from === "yourBench";
  const offered = attachedEnergies(
    state,
    discardVictimSeat(seat, op),
    op.filter,
    activeOnly ? "active" : benchOnly ? "bench" : "all",
  );
  // Ruffian's picked body: `bodyUid` keeps only the Energy on the body whose top uid it names.
  const narrowTo = op.from === "opponentChosen" ? op.bodyUid : undefined;
  if (narrowTo === undefined) return offered;
  return offered.filter((entry) => {
    const host = refPokemon(state, entry.from);
    return host !== undefined && topUid(host) === narrowTo;
  });
}

/**
 * `discardEnergy.reserve` (Lugia "Elemental Blast"): of the typed picks, keep those whose removal
 * leaves the most of `reserve` matchable (one Energy per type) by the rest of the scope's Energy.
 * With no full matching, keep the picks that lose the least.
 */
export function reservedDiscards(
  state: GameState,
  seat: Seat,
  from: Exclude<OpOf<"discardEnergy">["from"], "opponentEach">,
  offered: readonly { uid: string; from: PokemonRef }[],
  reserve: readonly BasicEnergyType[],
): { uid: string; from: PokemonRef }[] {
  const pool = discardableEnergies(state, seat, {
    op: "discardEnergy",
    from,
    filter: { kind: "anyEnergy" },
  });
  const provides = (
    entry: { uid: string; from: PokemonRef },
    energyType: BasicEnergyType,
  ): boolean => {
    const host = refPokemon(state, entry.from);
    return (
      host !== undefined &&
      matchesAttached(state, host, entry.uid, { kind: "providesEnergy", energyType })
    );
  };
  // The largest number of `types` one-to-one matchable by `rest` (a tiny exhaustive search: <= 2 types).
  const matched = (
    types: readonly BasicEnergyType[],
    rest: readonly { uid: string; from: PokemonRef }[],
  ): number => {
    const [head, ...tail] = types;
    if (head === undefined) return 0;
    let best = matched(tail, rest);
    rest.forEach((entry, index) => {
      if (!provides(entry, head)) return;
      best = Math.max(
        best,
        1 +
          matched(
            tail,
            rest.filter((_, other) => other !== index),
          ),
      );
    });
    return best;
  };
  const scored = offered.map((entry) => ({
    entry,
    score: matched(
      reserve,
      pool.filter((other) => other.uid !== entry.uid),
    ),
  }));
  const top = Math.max(...scored.map((s) => s.score));
  return scored.filter((s) => s.score === top).map((s) => s.entry);
}

/**
 * The interchangeability key for mandatory discards. A Basic Energy is keyed by the type it
 * provides, since the catalog prints identical Basic Energy under several ids. Everything else keys
 * on catalog id; the `basic:`/`card:` prefixes keep the two spaces apart. A uid with no catalog
 * card gets its own key, so the engine asks rather than guesses.
 */
export function cardIdentity(state: GameState, uid: string): string {
  const card = cardOfUid(state, uid);
  if (card === undefined) return `?${uid}`;
  return isBasicEnergy(card) ? `basic:${energyProvidesOf(card)}` : `card:${card.id}`;
}

/**
 * Discardable Energy with interchangeable candidates (same Energy on the same Pokémon) collapsed to
 * at most `cap` representatives each, board order preserved. The host is part of the key because
 * which Pokémon loses the Energy is always a real choice. Keeping `cap` copies lets an exact-N
 * discard still be answered; collapsing here lets a single-class board resolve without a prompt.
 */
export function interchangeableCandidates(
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

/**
 * Every Pokémon Tool on the opponent's board in board order, paired with its host. Separate from
 * `discardableEnergies` because Tools live in `tools`, not `energy`. No `CardFilter` parameter: the
 * printed sentence names Tools without narrowing.
 */
export function discardableTools(
  state: GameState,
  seat: Seat,
  // Tool Scrapper's "yours or your opponent's" also reads the controller's side; absent means the
  // opponent's side alone.
  sides?: "both",
  /**
   * Ruffian's picked body: only the Tools on the body whose top uid this is. Absent means every
   * body on the named sides.
   */
  bodyUid?: string,
): { uid: string; from: PokemonRef }[] {
  const out: { uid: string; from: PokemonRef }[] = [];
  const victims: readonly Seat[] = sides === "both" ? [seat, otherSeat(seat)] : [otherSeat(seat)];
  for (const victim of victims) {
    const side = state.players[victim];
    const collect = (pokemon: InPlayPokemon, from: PokemonRef) => {
      if (bodyUid !== undefined && topUid(pokemon) !== bodyUid) return;
      for (const uid of pokemon.tools) out.push({ uid, from });
    };
    if (side.active !== null) collect(side.active, { seat: victim, spot: { spot: "active" } });
    side.bench.forEach((pokemon, index) =>
      collect(pokemon, { seat: victim, spot: { spot: "bench", index } }),
    );
  }
  return out;
}

/**
 * The picks a discardEnergy makes with no choice left, or null when the player must decide. Runs
 * over the collapsed candidates. "total": the offer holds no more than the count, so everything
 * comes off. "each": every affected Pokémon has exactly one.
 */
export function forcedDiscards(
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

/** A stable key for grouping and de-duping refs. */
export function refKeyOf(ref: PokemonRef): string {
  return `${ref.seat}:${ref.spot.spot}:${ref.spot.spot === "bench" ? ref.spot.index : "active"}`;
}

/**
 * How many Energy a `moveEnergy` op may move on this board: the printed number, or the whole
 * movable set for "any amount". Shared by the play gate and the park so they agree on `max`, and
 * keeps the prompt's `max` a number.
 */
export function moveCap(op: OpOf<"moveEnergy">, movable: number): number {
  // `"all"` clamps like `"any"`; they differ only in the floor. Tested by membership over the
  // literal words so a new quantifier cannot fall onto the numeric side.
  return op.max === "any" || op.max === "all" ? movable : op.max;
}

/**
 * How few Energy a `moveEnergy` answer may carry: 0, or the whole cap for Castform's "Move all
 * Energy". Only the park asks the floor; the play gate deliberately does not.
 */
export function moveFloor(op: OpOf<"moveEnergy">, cap: number): number {
  return op.max === "all" ? cap : 0;
}

/**
 * Whose board a `moveEnergy` op acts on: the controller's, or the other seat's for `side:
 * "opponent"`. Shared by the park, the play gate and the apply so they agree. Controller-relative
 * like every seat field in this vocabulary.
 */
export function moveBoardSeat(op: OpOf<"moveEnergy">, seat: Seat): Seat {
  // Spelled off the absent key on purpose: a record with no `side` means the controller's own
  // board.
  return relativeSeat(seat, op.side !== undefined);
}

/**
 * A moveEnergy op does something iff the board has at least one admitted Energy and a valid
 * distinct destination. Exported for `programPlayable`. `sourceUid` is threaded because two routes
 * resolve endpoints from "this Pokémon"; without it the gate refuses.
 */
export function moveEnergyPlayable(
  state: GameState,
  seat: Seat,
  op: OpOf<"moveEnergy">,
  sourceUid?: string,
): boolean {
  // Asks about the op's board, not the controller's. It deliberately does not consult the §11
  // shield, since `unshieldedRefs` emits events and a playability check must not, so this can
  // report playable when every candidate is shielded.
  const board = moveBoardSeat(op, seat);
  const { movable, destinations, needed } = moveEndpoints(state, board, op, sourceUid);
  return moveCap(op, movable.length) > 0 && movable.length > 0 && destinations.length >= needed;
}

/**
 * What a `moveEnergy` op can take, where it can put it, and how many destinations the route needs;
 * shared by the op's no-op test and the play gate. The free route needs two Pokémon since a Pokémon
 * cannot move Energy onto itself; `benchToActive`, `koedActiveToToolHolder` (Exp. Share) and
 * `selfToBench` have disjoint endpoints so one destination is enough. `selfToBench`'s source is the
 * Active, since only the Active attacks. `seat` is the board the op acts on; the uid-anchored
 * routes whiff on the opponent's board. The §11 shield is filtered in `stepOp`, not here.
 */
export function moveEndpoints(
  state: GameState,
  seat: Seat,
  op: OpOf<"moveEnergy">,
  sourceUid?: string,
): { movable: { uid: string; from: PokemonRef }[]; destinations: PokemonRef[]; needed: number } {
  const benchToActive = op.route === "benchToActive";
  const toToolHolder = op.route === "koedActiveToToolHolder";
  const selfToBench = op.route === "selfToBench";
  const active = state.players[seat].active;
  if (op.route === "othersToSelf") {
    // "From your other Pokémon to this Pokémon", resolved by uid on the current board. On printed
    // boards this equals `benchToActive` because a switch gate runs first; it differs only when
    // used from the Bench.
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
      // No "holder must not be the source" check: `koToolTriggersOf` skips the Knocked Out body and
      // `validateChoice` refuses self-moves.
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

/**
 * The in-play Pokémon on `seat`'s board carrying the Tool `toolUid` ("the Pokémon this card is
 * attached to"). Not `sourceRef`, which matches top-card uids and would never find a Tool.
 */
function toolHolderRef(state: GameState, seat: Seat, toolUid: string): PokemonRef | undefined {
  const side = state.players[seat];
  if (side.active?.tools.includes(toolUid) === true) {
    return { seat, spot: { spot: "active" } };
  }
  const index = side.bench.findIndex((pokemon) => pokemon.tools.includes(toolUid));
  return index === -1 ? undefined : { seat, spot: { spot: "bench", index } };
}

/**
 * A discardEnergy op does something iff its scope holds at least one admitted Energy. Exported for
 * `programPlayable` so a play that could only whiff is refused (§7.2); coin-flip gates are refused
 * only when neither arm can act. For `self` this is a cost gate: an Ability whose discard cost
 * cannot be paid must not run, and an absent uid answers `false`.
 */
export function discardEnergyPlayable(
  state: GameState,
  seat: Seat,
  op: OpOf<"discardEnergy">,
  sourceUid?: string,
): boolean {
  // A `to: "hand"` move wholly blocked by the Milotic lock can only whiff, so the play is refused.
  // The seat is the victim's.
  if (op.to === "hand" && inPlayToHandBlocked(state, discardVictimSeat(seat, op))) return false;
  return discardableEnergies(state, seat, op, sourceUid).length > 0;
}

export function ownBenchRefs(state: GameState, seat: Seat): PokemonRef[] {
  return state.players[seat].bench.map((_, index) => ({ seat, spot: { spot: "bench", index } }));
}

export function oppBenchRefs(state: GameState, seat: Seat): PokemonRef[] {
  const opp = otherSeat(seat);
  return state.players[opp].bench.map((_, index) => ({
    seat: opp,
    spot: { spot: "bench", index },
  }));
}

/** The opponent's Active (if any) PLUS their whole Bench — the candidate set for an
    `opponentAny` snipe (Fezandipiti ex "Cruel Arrow", 1 of ALL the opponent's
    Pokémon). The Active leads so a forced single-candidate board reads naturally. */
export function oppAnyRefs(state: GameState, seat: Seat): PokemonRef[] {
  const opp = otherSeat(seat);
  const refs: PokemonRef[] = [];
  if (state.players[opp].active !== null) refs.push({ seat: opp, spot: { spot: "active" } });
  refs.push(...oppBenchRefs(state, seat));
  return refs;
}

/**
 * The one funnel for a snipe's candidate set, exported so `programPlayable` refuses on exactly the
 * set `stepOp` offers. The printed `damagedOnly` narrowing is applied here: a filtered set can be
 * empty (silent no-op), a set of one is forced, and the §11 shield is asked only of bodies that
 * survive the narrowing. It applies to whichever scope `target` names.
 */
export function snipeTargets(state: GameState, seat: Seat, op: OpOf<"damageChosen">): PokemonRef[] {
  // A total `switch` so a new target member fails to compile instead of falling into an else
  // branch.
  const scope = ((): PokemonRef[] => {
    switch (op.target) {
      case "opponentAny":
        return oppAnyRefs(state, seat);
      case "opponentBench":
        return oppBenchRefs(state, seat);
      // The attacker's own Bench; `seat` is the attacker's on every attack program.
      case "yourBench":
        return ownBenchRefs(state, seat);
      // The attacker's whole own side, Active first; the order matters because `placeSnipe` hits
      // refs in order.
      case "yourAny":
        return ownInPlayRefs(state, seat);
    }
  })();
  // The printed candidate class, applied at the same seam as `damagedOnly` for the same reasons; it
  // reads the top card. The two narrowings are never co-printed but compose anyway.
  const narrowing = op.filter;
  const classed =
    narrowing === undefined
      ? scope
      : scope.filter((ref) => {
          const pokemon = refPokemon(state, ref);
          // A ref with no body or unreadable in-play card is dropped rather than admitted.
          return pokemon !== undefined && matchesFilter(inPlayCardOf(state, pokemon), narrowing);
        });
  // Bone Sniper: a candidate must hold a Special Energy. A ref with no body is dropped.
  if (op.specialEnergyOnly === true) {
    return classed.filter((ref) => {
      const pokemon = refPokemon(state, ref);
      return pokemon !== undefined && hasAttachedEnergy(state, pokemon, "special");
    });
  }
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
export function ownInPlayRefs(state: GameState, seat: Seat): PokemonRef[] {
  const refs: PokemonRef[] = [];
  if (state.players[seat].active !== null) refs.push({ seat, spot: { spot: "active" } });
  for (let index = 0; index < state.players[seat].bench.length; index++) {
    refs.push({ seat, spot: { spot: "bench", index } });
  }
  return refs;
}

export function benchSpace(state: GameState, seat: Seat): number {
  // The live Bench limit (e.g. Area Zero Underdepths with a Tera Pokémon in play), never below
  // zero.
  return Math.max(0, benchLimitOf(state, seat) - state.players[seat].bench.length);
}

/** `searchDeck.max`'s union, named once off the op. */
export type SearchDeckMax = OpOf<"searchDeck">["max"];

/**
 * Which cards a `reorderTop` is ordering, shared by the park and the apply. Both arms return the
 * window in deck order, so index 0 is nearest the top and one prompt serves both ends. The bottom
 * arm's `Math.max(0, …)` is for symmetry only; `slice` already clamps a negative start.
 */
export function reorderWindow(deck: readonly string[], op: OpOf<"reorderTop">): string[] {
  return op.from === "bottom"
    ? deck.slice(Math.max(0, deck.length - Math.max(0, op.n)))
    : deck.slice(0, Math.max(0, op.n));
}

/**
 * The types an attach's target rider names, always as a list. Shared by `attachEnergyTargets` and
 * `attachTargetNoun` so the gate and the caption never disagree.
 */
export function targetTypeNames(
  targetType: string | readonly string[] | undefined,
): readonly string[] {
  if (targetType === undefined) return [];
  return typeof targetType === "string" ? [targetType] : targetType;
}

/**
 * Narrow a candidate ref list to bodies whose top card is in the printed owner-prefixed subgroup,
 * or return it unchanged when no owner is printed. Uses `matchesFilter`'s `ownerPokemon` arm so
 * deck searches, attach targets and counter moves share one definition.
 */
export function subgroupRefs(
  state: GameState,
  refs: PokemonRef[],
  owner: string | undefined,
): PokemonRef[] {
  if (owner === undefined) return refs;
  return refs.filter((ref) =>
    matchesFilter(refTopCard(state, ref), { kind: "ownerPokemon", owner }),
  );
}

/**
 * `activeTop` with its card as the in-play view (`inPlayCardOf`), for the §8.5 sites whose
 * Weakness, Resistance and type-keyed reads take the spot's card.
 */
export function activeInPlay(
  state: GameState,
  seat: Seat,
): { active: InPlayPokemon; uid: string; card: Card } | null {
  const spot = activeTop(state, seat);
  if (spot === null) return null;
  return { ...spot, card: inPlayCardOf(state, spot.active) ?? spot.card };
}

/**
 * The in-play view of the top card of the body a ref points at, or undefined when the spot is
 * empty; `matchesFilter` answers false for an undefined card, so an empty spot fails every
 * predicate.
 */
export function refTopCard(state: GameState, ref: PokemonRef): Card | undefined {
  const body = refPokemon(state, ref);
  // Every caller asks about a body in play, so a typed filter ("your {G} Pokémon") sees Scovillain
  // ex as both {G} and {R}.
  return body === undefined ? undefined : inPlayCardOf(state, body);
}

export function refPokemon(state: GameState, ref: PokemonRef): InPlayPokemon | undefined {
  return pokemonAt(state, ref.seat, ref.spot);
}

/**
 * The two printed narrowings on a `switchActive` candidate set (Pecharunt ex: "1 of your Benched
 * {D} Pokémon, except any Pecharunt ex"). The type check goes through `matchesFilter`'s
 * `typedPokemon` so dual-type bodies match; the name check is exact-case against the top card. Both
 * are conjuncts: the exclusion applies even with no type.
 */
export function switchBenchNarrowing(
  state: GameState,
  refs: PokemonRef[],
  op: OpOf<"switchActive">,
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
