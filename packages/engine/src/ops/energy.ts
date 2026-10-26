import {
  cardOfUid,
  energyProvidesOf,
  isEnergyCard,
  isStage2Pokemon,
  matchesFilter,
  topCardOf,
  topUid,
} from "../cards";
import { isBasicEnergy, isBasicPokemon } from "../cardClasses";
import {
  countEnergyInPlay,
  effectiveMaxHp,
  inPlayCardOf,
  inPlayToHandBlocked,
  liveHandAttachMark,
  returnsAfterAttackDiscard,
} from "../continuous";
import type { EffectContext, EffectRecord, PokemonRef } from "../effectPrompt";
import type { AttachTargetRiders, CardFilter, OpOf, PokemonType } from "../effectTypes";
import { POKEMON_TYPES } from "../effectTypes";
import {
  cardIdentity,
  discardVictimSeat,
  moveBoardSeat,
  recordMoved,
  refKeyOf,
  refPokemon,
  sourceRef,
  targetTypeNames,
} from "../effectTargets";
import type { GameEvent } from "../events";
import { shuffle } from "../rng";
// Import cycle with triggers.ts; safe because both ends are hoisted function declarations called
// only at run time.
import { runSelfWatchedTriggers, runWatchedTriggers } from "../triggers";
import type {
  GameState,
  InPlayPokemon,
  PendingStage,
  PlayerSide,
  PokemonTarget,
  Seat,
} from "../types";
import {
  bodyAt,
  HP_PER_COUNTER,
  inPlayOf,
  otherSeat,
  relativeSeat,
  without,
  withSide,
} from "../types";
import { healChosen } from "./damage";

// Op implementations that attach, move or discard Energy and Pokémon Tools.

/**
 * Dachsbun ex: "If you healed any damage in this way, discard all Energy from those Pokémon." Runs
 * after the heal walk; "those Pokémon" are the bodies whose damage fell, so a body that healed 0
 * keeps its Energy. One `ENERGY_DISCARDED` per body, after every `HEALED`, in board order.
 */
export function discardEnergyFromHealed(
  before: GameState,
  after: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const was = before.players[ctx.seat];
  const now = after.players[ctx.seat];
  const pairs: [InPlayPokemon | null | undefined, InPlayPokemon | null | undefined][] = [
    [was.active, now.active],
    ...was.bench.map((body, i): [InPlayPokemon, InPlayPokemon | undefined] => [body, now.bench[i]]),
  ];
  const energy = pairs.flatMap(([b, a]) =>
    b !== null && b !== undefined && a !== null && a !== undefined && a.damage < b.damage
      ? a.energy
      : [],
  );
  if (energy.length === 0) return after;
  return discardEnergyApply(
    after,
    energy,
    { op: "discardEnergy", from: "yours", filter: { kind: "anyEnergy" }, count: "all" },
    ctx,
    events,
  ).state;
}

/**
 * The first `max` Basic Energy uids in `seat`'s `source` zone matching `energyType` (any Basic
 * Energy when undefined), in zone order. Fewer than `max` is normal ("attach up to N"), so callers
 * must read the length.
 */
export function attachableEnergies(
  state: GameState,
  seat: Seat,
  source: "hand" | "discard",
  energyType: string | undefined,
  max: number,
  /**
   * Widens the printed noun from "a Basic Energy card" to "an Energy card". Every consumer of the
   * op asks this one function, so the widening cannot reach some and miss others.
   */
  anyEnergy = false,
  /**
   * The printed proper name ("Spiky Energy"). It replaces the Basic test rather than conjoining
   * with it, since every by-name printing names a Special Energy.
   */
  energyName: string | undefined = undefined,
): string[] {
  if (max <= 0) return [];
  const zone = source === "hand" ? state.players[seat].hand : state.players[seat].discard;
  const found: string[] = [];
  for (const uid of zone) {
    const card = cardOfUid(state, uid);
    if (
      card !== undefined &&
      isEnergyCard(card) &&
      // Basic Energy by default; `anyEnergy` admits both kinds and a printed name replaces the
      // category question outright.
      (anyEnergy || energyName !== undefined || isBasicEnergy(card)) &&
      (energyType === undefined || energyProvidesOf(card) === energyType) &&
      (energyName === undefined || matchesFilter(card, { kind: "byName", name: energyName }))
    ) {
      found.push(uid);
      if (found.length === max) break;
    }
  }
  return found;
}

/**
 * How many cards an attach moves once its target is answered: the answered `take` clamped to the
 * printed count, or the whole printed batch when no take was sent.
 */
export function attachTake(op: OpOf<"attachEnergyFrom">, take: number | undefined): number {
  const printed = op.count ?? 1;
  return take === undefined ? printed : Math.min(take, printed);
}

/**
 * The card question an attach owes once its target is known, or undefined. The pick is a decision
 * only when the pile holds more attachable cards than the take and more than one `cardIdentity`
 * among them. Candidates are every attachable card in pile order; `seat` is the actor.
 */
export function energyPickOffer(
  state: GameState,
  op: OpOf<"attachEnergyFrom">,
  seat: Seat,
  take: number,
): { candidates: string[]; take: number } | undefined {
  const owner = attachSeat(op, seat);
  const candidates = attachableEnergies(
    state,
    owner,
    op.source,
    op.energyType,
    state.players[owner][op.source].length,
    op.anyEnergy,
    op.energyName,
  );
  const n = Math.min(take, candidates.length);
  if (n <= 0 || n >= candidates.length) return undefined;
  // `cardIdentity` — the interchangeability key the mandatory discards already ask (a Basic by its
  // type, anything else by its print), so "would picking this one rather than that one differ?" has
  // ONE answer across the attach and the discard families.
  return new Set(candidates.map((uid) => cardIdentity(state, uid))).size > 1
    ? { candidates, take: n }
    : undefined;
}

/**
 * The first matching Basic Energy uid, or undefined. It stays a one-card question even under
 * `count`: "up to 2" with one Energy in hand still attaches one, so it is not a whiff.
 */
export function firstAttachableEnergy(
  state: GameState,
  seat: Seat,
  source: "hand" | "discard",
  energyType: string | undefined,
  /** Carried through so the play gate and park guard ask the same question the apply answers. */
  anyEnergy = false,
  /** Carried through so the play gate and park guard ask the same question the apply answers. */
  energyName?: string,
): string | undefined {
  return attachableEnergies(state, seat, source, energyType, 1, anyEnergy, energyName)[0];
}

/**
 * The in-play Pokémon an attach may target (Active first, then bench), filtered by the printed
 * riders. This is the only target gate: `validateChoice` matches answers against the prompt this
 * produced, so a new rider needs no separate validation. Shared by every attach op and by
 * `programPlayable`.
 */
export function attachEnergyTargets(
  state: GameState,
  seat: Seat,
  riders: AttachTargetRiders,
): PokemonRef[] {
  // `seat` is the actor; targets are on the owner's board resolved from the riders' `whose`, and
  // every ref carries the owner's seat.
  const owner = attachSeat(riders, seat);
  const side = state.players[owner];
  const eligible = (pokemon: InPlayPokemon): boolean => {
    if (
      riders.targetType !== undefined ||
      riders.basicOnly === true ||
      riders.stage2Only === true ||
      riders.ownerPokemon !== undefined ||
      riders.targetBanner !== undefined
    ) {
      // Read the in-play card so `targetType` sees the types the body has.
      const card = inPlayCardOf(state, pokemon);
      // `targetType` may be a list, so the test is any-of-any against the body's types.
      const wantedTypes = targetTypeNames(riders.targetType);
      if (wantedTypes.length > 0) {
        const cardTypes = card?.types ?? [];
        if (!wantedTypes.some((wanted) => cardTypes.includes(wanted))) return false;
      }
      if (riders.basicOnly === true && (card === undefined || !isBasicPokemon(card))) return false;
      // Rosa's Encouragement's printed "Stage 2".
      if (riders.stage2Only === true && (card === undefined || !isStage2Pokemon(card)))
        return false;
      // The owner-prefixed subgroup, read through `matchesFilter`'s `ownerPokemon` arm so the deck
      // and board halves agree on who is an "Iono's Pokémon". No printing narrows an in-play target
      // by stage.
      if (
        riders.ownerPokemon !== undefined &&
        !matchesFilter(card, { kind: "ownerPokemon", owner: riders.ownerPokemon })
      ) {
        return false;
      }
      // The printed banner target ("your Tera Pokémon").
      if (
        riders.targetBanner !== undefined &&
        !matchesFilter(card, { kind: "bannerPokemon", banner: riders.targetBanner })
      ) {
        return false;
      }
    }
    if (riders.notIfKO === true && riders.bonusCounters !== undefined) {
      const hp = effectiveMaxHp(state, pokemon);
      if (hp !== null && pokemon.damage + riders.bonusCounters >= hp) return false;
    }
    // Glimmora's bar: a hand attach skips a barred body.
    if (riders.source === "hand" && liveHandAttachMark(state, pokemon)?.barred === true)
      return false;
    return true;
  };
  const refs: PokemonRef[] = [];
  if (riders.benchOnly !== true && side.active !== null && eligible(side.active)) {
    refs.push({ seat: owner, spot: { spot: "active" } });
  }
  // `activeOnly` (Lethargic Charge): the Bench is not offered.
  if (riders.activeOnly === true) return refs;
  side.bench.forEach((pokemon, index) => {
    if (eligible(pokemon)) refs.push({ seat: owner, spot: { spot: "bench", index } });
  });
  return refs;
}

/**
 * The seat whose discard pile is read and whose board is targeted for a cross-seat attach (`whose:
 * "opponent"`, Grafaiai); no printing separates the two. Events keep the actor's seat. Absent means
 * the actor's own seat.
 */
export function attachSeat(op: { readonly whose?: "opponent" }, seat: Seat): Seat {
  return relativeSeat(seat, op.whose === "opponent");
}

/**
 * The filter for "Pokémon that are the same type as any Basic Energy attached to this Pokémon",
 * resolved at the park: `anyOf(typedPokemon × T)` for the types provided by Basic Energy attached
 * to the source body. Special Energy never counts, and the category filter runs before
 * `energyProvidesOf` so a Special's Colorless fallback cannot admit every Colorless Pokémon. Zero
 * types gives `anyOf([])`, which matches nothing, never an unconstrained search. Resolved here
 * because `matchesFilter` sees no board.
 */
export function attachedBasicEnergyTypedFilter(state: GameState, ctx: EffectContext): CardFilter {
  const [host] = sourceRef(state, ctx);
  const body = host === undefined ? undefined : refPokemon(state, host);
  const types: PokemonType[] = [];
  for (const uid of body?.energy ?? []) {
    const card = cardOfUid(state, uid);
    if (card === undefined || !matchesFilter(card, { kind: "basicEnergy" })) continue;
    const provided = energyProvidesOf(card);
    if (!(POKEMON_TYPES as readonly string[]).includes(provided)) continue;
    const pokemonType = provided as PokemonType;
    if (!types.includes(pokemonType)) types.push(pokemonType);
  }
  return {
    kind: "anyOf",
    filters: types.map((pokemonType) => ({ kind: "typedPokemon", pokemonType })),
  };
}

/**
 * Love Ball's "a Pokémon with the same name as 1 of your opponent's Pokémon in play", resolved at
 * step time to an exact-name `anyOf` over the opponent's top cards. An empty opposing board matches
 * nothing.
 */
export function opponentInPlayNameFilter(state: GameState, ctx: EffectContext): CardFilter {
  const side = state.players[otherSeat(ctx.seat)];
  const bodies = inPlayOf(side);
  const names: string[] = [];
  for (const body of bodies) {
    const name = topCardOf(state, body)?.name;
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return { kind: "anyOf", filters: names.map((name) => ({ kind: "byName", name })) };
}

/**
 * What an `attachFromTop` op offers: the cards in the top `n` its filter admits (top first), the
 * eligible targets, and the cap `min(printed, candidates.length)`, so `"any"` is the degenerate
 * case. Reads the deck, so it is only asked when the op runs and is not a `programPlayable` input.
 */
export function attachFromTopOffer(
  state: GameState,
  seat: Seat,
  op: OpOf<"attachFromTop">,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  const top = state.players[seat].deck.slice(0, Math.max(0, op.n));
  const candidates = top.filter((uid) => matchesFilter(cardOfUid(state, uid), op.filter));
  return {
    candidates,
    targets: attachEnergyTargets(state, seat, op),
    max: Math.min(op.max === "any" ? candidates.length : op.max, candidates.length),
  };
}

/**
 * What an `attachFromDeck` op offers: deck-wide matches, eligible targets, and the cap.
 * Interchangeable cards (by `cardIdentity`) collapse to at most `max` representatives each, so
 * every distinguishable answer stays reachable without a dozen identical rows. The cap is the
 * minimum of the printed `max`, the candidates available, and `targets.length × maxPerTarget` when
 * a per-target rule applies. `oneTarget` adds no ceiling: one target may take every card. The board
 * ceiling is taken before the collapse. Only asked when the op runs; not a `programPlayable` input.
 */
export function attachFromDeckOffer(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"attachFromDeck">,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  const seat = ctx.seat;
  const targets = op.toSelf === true ? sourceRef(state, ctx) : attachEnergyTargets(state, seat, op);
  const cap =
    op.maxPerTarget === undefined ? op.max : Math.min(op.max, targets.length * op.maxPerTarget);
  const matches = state.players[seat].deck.filter((uid) =>
    matchesFilter(cardOfUid(state, uid), op.filter),
  );
  const kept = new Map<string, number>();
  const candidates: string[] = [];
  // "Of different types" (Prism Charge): the collapse keys by provided type and keeps one uid per
  // type, so every legal answer is pairwise type-distinct.
  const distinct = op.distinctEnergyTypes === true;
  for (const uid of matches) {
    const card = distinct ? cardOfUid(state, uid) : undefined;
    const key = distinct
      ? `type:${card === undefined ? uid : energyProvidesOf(card)}`
      : cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= (distinct ? 1 : cap)) continue;
    kept.set(key, already + 1);
    candidates.push(uid);
  }
  return { candidates, targets, max: Math.min(cap, candidates.length) };
}

/**
 * `attachFromDeck.each` (Overflowing Wishes): `max` per offered body, so the total is `max` ×
 * bodies and the per-target cap is `max`. Other ops are returned unchanged.
 */
export function perBodyDeckOp(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"attachFromDeck">,
): OpOf<"attachFromDeck"> {
  if (op.each !== true) return op;
  const bodies = attachEnergyTargets(state, ctx.seat, op).length;
  return { ...op, max: op.max * bodies, maxPerTarget: op.max };
}

/**
 * What an `attachFromDiscard` op offers (Glass Trumpet): admitted discard cards collapsed by
 * identity to the reachable total, the bodies `attachEnergyTargets` admits, and the ceiling.
 * Exported for `programPlayable`: an offer with no card or no body can only whiff.
 */
export function attachFromDiscardOffer(
  state: GameState,
  seat: Seat,
  op: OpOf<"attachFromDiscard">,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  const targets = attachEnergyTargets(state, seat, op);
  const ceiling = discardAttachCeiling(state, seat, op);
  // The reachable total: up to `max`, and never more than one per offered body; under `each`, `max`
  // per body.
  const reach =
    op.each === true
      ? ceiling * targets.length
      : op.maxPerTarget === undefined
        ? ceiling
        : Math.min(ceiling, targets.length * op.maxPerTarget);
  const kept = new Map<string, number>();
  const candidates: string[] = [];
  const pile = state.players[seat].discard;
  for (const uid of pile) {
    if (!matchesFilter(cardOfUid(state, uid), op.filter)) continue;
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= reach) continue;
    kept.set(key, already + 1);
    candidates.push(uid);
  }
  return { candidates, targets, max: Math.min(reach, candidates.length) };
}

/**
 * An `attachFromDiscard`'s printed ceiling as a number: the printed count, or Tail Generator's
 * energy count over the opponent's board, read when the op runs.
 */
export function discardAttachCeiling(
  state: GameState,
  seat: Seat,
  op: OpOf<"attachFromDiscard">,
): number {
  return op.max === "opponentEnergyInPlay"
    ? countEnergyInPlay(state, otherSeat(seat), null)
    : op.max;
}

/**
 * Reboot Pod's mandatory "to each of your Future Pokémon": apply the player's assignments, then
 * give every offered body still short of `op.max` the next matching discard card in pile order
 * while the pile lasts, so an empty or short answer cannot decline the effect.
 */
export function eachAttachTopUp(
  state: GameState,
  op: OpOf<"attachFromDiscard">,
  assignments: readonly { uid: string; to: PokemonRef }[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const given = attachFromZoneApply(state, assignments, "discard", ctx, events);
  const landed = new Map<string, number>();
  for (const { uid, to } of assignments) {
    if (given.attached.includes(uid)) landed.set(refKeyOf(to), (landed.get(refKeyOf(to)) ?? 0) + 1);
  }
  const pile = given.state.players[ctx.seat].discard.filter((uid) =>
    matchesFilter(cardOfUid(given.state, uid), op.filter),
  );
  const fill: { uid: string; to: PokemonRef }[] = [];
  const perBody = discardAttachCeiling(state, ctx.seat, op);
  for (const to of attachEnergyTargets(given.state, ctx.seat, op)) {
    for (let n = landed.get(refKeyOf(to)) ?? 0; n < perBody; n += 1) {
      const uid = pile.shift();
      if (uid === undefined) break;
      fill.push({ uid, to });
    }
  }
  return attachFromZoneApply(given.state, fill, "discard", ctx, events).state;
}

/**
 * What an `attachFromHand` op offers: admitted hand cards (hand order), the eligible targets, and
 * the cap. Every printing reads "any number", so the cap is the candidate set and no
 * interchangeable collapse runs; the hand is already visible to its owner. The singular printing
 * (`one`, Lethargic Charge) caps at 1 and feeds the play gate through `attachFromHandPlayable`.
 */
export function attachFromHandOffer(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"attachFromHand">,
): { candidates: string[]; targets: PokemonRef[]; max: number } {
  // Takes the context because "to this Pokémon" needs `ctx.sourceUid`.
  const seat = ctx.seat;
  const candidates = state.players[seat].hand.filter((uid) =>
    matchesFilter(cardOfUid(state, uid), op.filter),
  );
  // `toSelf` prints "to this Pokémon", so the sole target is `sourceRef`, filtered through
  // Glimmora's bar.
  if (op.toSelf === true) {
    return {
      candidates,
      targets: handOpenRefs(state, sourceRef(state, ctx)),
      max: candidates.length,
    };
  }
  // The printed singular "Attach an Energy card … to your Active Larry's Pokémon" (Lethargic
  // Charge): riders reach `attachEnergyTargets` and the cap is one card.
  if (op.one === true) {
    const riders: AttachTargetRiders = {
      source: "hand",
      ...(op.activeOnly === true ? { activeOnly: true as const } : {}),
      ...(op.ownerPokemon === undefined ? {} : { ownerPokemon: op.ownerPokemon }),
    };
    return {
      candidates,
      targets: attachEnergyTargets(state, seat, riders),
      max: Math.min(1, candidates.length),
    };
  }
  // The printed "up to N" (Pleasing Present). `ctx.seat` is the hand's owner here, so the board
  // read is theirs too.
  if (op.max !== undefined) {
    return {
      candidates,
      targets: attachEnergyTargets(state, seat, { source: "hand" }),
      max: Math.min(op.max, candidates.length),
    };
  }
  return {
    candidates,
    targets: attachEnergyTargets(state, seat, { source: "hand" }),
    max: candidates.length,
  };
}

/** The forced top-up: the first offered hand card onto the first offered target, or nothing. */
export function handTopUp(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"attachFromHand">,
): { uid: string; to: PokemonRef }[] {
  const offer = attachFromHandOffer(state, ctx, op);
  const [uid] = offer.candidates;
  const [to] = offer.targets;
  return uid === undefined || to === undefined ? [] : [{ uid, to }];
}

/**
 * `attachFromHandOffer` for the play gate, which has a seat and the acting body's uid but no
 * `EffectContext`.
 */
export function attachFromHandPlayable(
  state: GameState,
  seat: Seat,
  op: OpOf<"attachFromHand">,
  sourceUid?: string,
): boolean {
  const offer = attachFromHandOffer(
    state,
    sourceUid === undefined ? { seat } : { seat, sourceUid },
    op,
  );
  return offer.candidates.length > 0 && offer.targets.length > 0;
}

/**
 * `refs` minus every body carrying a live Glimmora bar, for the `toSelf` hand attaches that do not
 * go through `attachEnergyTargets`.
 */
function handOpenRefs(state: GameState, refs: PokemonRef[]): PokemonRef[] {
  return refs.filter((ref) => {
    const side = state.players[ref.seat];
    const body = bodyAt(side, ref.spot);
    return body === undefined || liveHandAttachMark(state, body)?.barred !== true;
  });
}

/**
 * Hypno "Daydream" on the effect path: if `body` just took an Energy from hand and carries a live
 * `endsTurn` mark, trip it; `settleProgram` then ends the controller's turn.
 */
function tripHandAttachMark(state: GameState, body: InPlayPokemon): InPlayPokemon {
  const mark = liveHandAttachMark(state, body);
  return mark?.endsTurn ? { ...body, handAttachMark: { ...mark, tripped: true } } : body;
}

/**
 * Pachirisu "Electrified Incisors": `cards` Energy just went from hand onto `body`, so a live mark
 * places its counters for each card, filed as an attack placement. No Knock Out check here; the
 * caller's sweep owns it.
 */
export function shockHandAttach(
  state: GameState,
  seat: Seat,
  body: InPlayPokemon,
  cards: number,
  events: GameEvent[],
): InPlayPokemon {
  const counters = liveHandAttachMark(state, body)?.counters ?? 0;
  const uid = topUid(body);
  if (counters <= 0 || cards <= 0 || uid === undefined) return body;
  const amount = counters * HP_PER_COUNTER * cards;
  events.push({ type: "COUNTERS_PLACED", seat, uid, amount, source: "attack" });
  return { ...body, damage: body.damage + amount };
}

/**
 * The effect path of a watched hand attach (Magearna "Auto Heal", Gengar ex "Gnawing Curse"): these
 * name the source zone, so an Ability or attack attaching from hand counts. One moment per card,
 * actor's sweep first then the opponent's; Electrified Incisors counters are placed last for each
 * card. Knock Outs are the caller's settle.
 */
function handAttachWatched(
  state: GameState,
  actor: Seat,
  energyUids: readonly string[],
  events: GameEvent[],
): GameState {
  const atMoment = state;
  let next = state;
  for (const energyUid of energyUids) {
    const side = next.players[actor];
    const host = [side.active, ...side.bench].find(
      (body) => body?.energy.includes(energyUid) === true,
    );
    const subject = host == null ? undefined : topUid(host);
    if (subject === undefined) continue;
    next = runSelfWatchedTriggers(next, actor, subject, "onEnergyAttach", atMoment, events);
    next = runWatchedTriggers(next, actor, subject, "onEnergyAttach", atMoment, events);
    next = shockHandAttachHost(next, actor, subject, events);
  }
  return next;
}

/**
 * `shockHandAttach` for one Energy card on `actor`'s body whose top is `subject`, re-found on the
 * live board.
 */
function shockHandAttachHost(
  state: GameState,
  actor: Seat,
  subject: string,
  events: GameEvent[],
): GameState {
  const side = state.players[actor];
  if (side.active !== null && topUid(side.active) === subject) {
    const shocked = shockHandAttach(state, actor, side.active, 1, events);
    return shocked === side.active ? state : withSide(state, actor, { ...side, active: shocked });
  }
  const index = side.bench.findIndex((body) => topUid(body) === subject);
  const benched = side.bench[index];
  if (benched === undefined) return state;
  const shocked = shockHandAttach(state, actor, benched, 1, events);
  return shocked === benched
    ? state
    : withSide(state, actor, {
        ...side,
        bench: side.bench.map((body, i) => (i === index ? shocked : body)),
      });
}

/**
 * Apply a deck-search attach (Infernal Reign, Janine's Secret Art): move each assigned card onto
 * its assigned Pokémon and return the uids that actually moved (§9.2). `validateChoice` is the only
 * gate on what may attach; this only re-reads the source zone and skips stale uids or missing
 * targets so a card is never conjured or lost. Each attach emits ENERGY_ATTACHED with the target
 * rebuilt field by field (§2). The trailing `shuffleDeck` op does the shuffle. `zone` lets the hand
 * and discard attaches share this mover.
 */
export function attachFromZoneApply(
  state: GameState,
  assignments: readonly { uid: string; to: PokemonRef }[],
  zone: "deck" | "hand" | "discard",
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
    // A hand attach trips Hypno's turn-end mark.
    const trip = (body: InPlayPokemon): InPlayPokemon =>
      zone === "hand" ? tripHandAttachMark(state, body) : body;
    if (to.spot.spot === "active") {
      if (active === null) continue;
      active = trip({ ...active, energy: [...active.energy, uid] });
    } else {
      const index = to.spot.index;
      if (bench[index] === undefined) continue;
      bench = bench.map((p, i) => (i === index ? trip({ ...p, energy: [...p.energy, uid] }) : p));
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
  const moved = withSide(state, ctx.seat, {
    ...side,
    active,
    bench,
    [zone]: side[zone].filter((uid) => !attached.has(uid)),
  });
  // A hand attach is the moment `onEnergyAttach` watches (Auto Heal, Gnawing Curse).
  return {
    state: zone === "hand" ? handAttachWatched(moved, ctx.seat, [...attached], events) : moved,
    attached: [...attached],
  };
}

/**
 * Attach the first matching Basic Energy from `op.source` onto the chosen Pokémon `ref` (one by
 * default, `op.count` when the print pins a batch), unless an unlike pile was picked via
 * `chosenUids`. Not the §6.3 manual attach; no allowance is used. `count` attaches to the one `ref`
 * and never re-asks. `bonusCounters` and `healTarget` fire once per op, not per card; the heal runs
 * last.
 */
export function attachEnergyFrom(
  state: GameState,
  op: OpOf<"attachEnergyFrom">,
  ref: PokemonRef,
  ctx: EffectContext,
  /**
   * The running §9.2 record. Whiffs return early and file nothing, since a missing key already
   * reads as empty.
   */
  record: EffectRecord,
  /**
   * How many the controller asked for. Absent means the whole printed batch (the forced path).
   * Clamped to the printed ceiling because a wire-supplied number can reach here.
   */
  take: number | undefined,
  /**
   * The Energy cards the controller picked. Absent means the leading matches in pile order, used
   * only when they are interchangeable. A picked uid no longer attachable is skipped.
   */
  chosenUids: readonly string[] | undefined,
  events: GameEvent[],
): GameState {
  // The owner's seat, resolved once: the pile, the validated board and the rewritten side are all
  // the owner's. `ctx.seat` is used only on events (the actor).
  const seat = attachSeat(op, ctx.seat);
  if (ref.seat !== seat) return state;
  const printed = op.count ?? 1; // absent = a single attach
  const energyUids = attachableEnergies(
    state,
    seat, // the printed pile's owner
    op.source,
    op.energyType,
    chosenUids === undefined
      ? take === undefined
        ? printed
        : Math.min(take, printed)
      : state.players[seat][op.source].length,
    op.anyEnergy, // absent = the printed "a Basic Energy card"
    op.energyName,
  )
    .filter((uid) => chosenUids === undefined || chosenUids.includes(uid))
    // A picked list is capped at the printed count.
    .slice(0, chosenUids === undefined ? undefined : printed);
  if (energyUids.length === 0) return state;
  const side = state.players[seat];
  const pokemon = bodyAt(side, ref.spot);
  if (pokemon === undefined) return state;
  // Glimmora's bar at the apply: the `toSelf` hand attaches never pass through
  // `attachEnergyTargets`'s filter. A barred body takes nothing and nothing is filed.
  if (op.source === "hand" && liveHandAttachMark(state, pokemon)?.barred === true) return state;
  const targetUid = topUid(pokemon);
  if (targetUid === undefined) return state;
  let updated: InPlayPokemon = { ...pokemon, energy: [...pokemon.energy, ...energyUids] };
  // A hand attach trips Hypno's turn-end mark.
  if (op.source === "hand") updated = tripHandAttachMark(state, updated);
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
      ? withSide(state, seat, { ...base, active: updated })
      : withSide(state, seat, {
          ...base,
          bench: side.bench.map((p, i) => (i === index ? updated : p)),
        });
  // "If you do, heal all damage from that Pokémon." Every whiff returns above, so the early returns
  // are the "if you do" gate. Once per op, not per card.
  const fed =
    op.healTarget === undefined ? next : healChosen(next, ref, op.healTarget, ctx, events);
  // The watched attach moment runs after the op's own riders, matching turn.ts. Only an attach from
  // the attaching player's own hand counts.
  return op.source === "hand" && seat === ctx.seat
    ? handAttachWatched(fed, seat, energyUids, events)
    : fed;
}

/**
 * Apply a from-the-top attach (Electric Generator, Hydreigon "Tri Howl"): move each assigned card
 * off the deck top onto its target, then settle the leftovers. `validateChoice` is the only gate;
 * this re-reads the window and skips stale uids or missing targets so cards are never duplicated or
 * lost. The leftovers run on every path, including empty ones. They are the whole window minus what
 * was attached, not just unattached candidates; `restTo` absent leaves them on top for the trailing
 * shuffle.
 */
export function attachFromTopApply(
  state: GameState,
  assignments: readonly { uid: string; to: PokemonRef }[],
  op: OpOf<"attachFromTop">,
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
  // `toPile` is the cards that left the deck; `underneath` the cards that stayed and moved.
  const toPile = op.restTo === "discard" ? rest : [];
  // Only `"shuffledBottom"` touches `rngState`, and `shuffle` leaves it alone for 0 or 1 leftovers.
  const [underneath, rngState] =
    op.restTo === "shuffledBottom"
      ? shuffle(rest, state.rngState)
      : [[] as string[], state.rngState];
  const removed = new Set([...attached, ...rest]);
  // This op only looks at the controller's own top, so `actor` is `seat`. Only the discard arm
  // emits an event: a card put under the deck never left it. `SHUFFLE` is not emitted because only
  // a small tail is randomized, not the whole deck.
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

/**
 * Move each chosen Energy off its host onto the destination that pick names, on the board the op
 * names. `validateChoice` already proved the answer; this re-finds each uid on the live board and
 * skips stale, self-targeting or missing-destination picks. Pokémon stay put, so event refs are
 * valid against the post-state. Strip and re-attach happen in one reduction, so an Energy is never
 * left detached.
 */
export function moveEnergyApply(
  state: GameState,
  picks: readonly { uid: string; dest: PokemonRef }[],
  op: OpOf<"moveEnergy">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // The board is the op's, not the controller's.
  const board = moveBoardSeat(op, ctx.seat);
  const side = state.players[board];
  // The destination is rebuilt field by field, never spread off the pick: it came from the wire and
  // `refEquals` checks only seat/spot/index, so extra keys would leak into events.
  const targetOf = (ref: PokemonRef): PokemonTarget =>
    ref.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: ref.spot.index };
  const keyOf = (target: PokemonTarget): string =>
    target.spot === "active" ? "active" : `bench:${target.index}`;
  // uid to destination, built first so a pick naming a body not in play drops out before its uid
  // leaves its host.
  const destOf = new Map<string, PokemonTarget>();
  for (const { uid, dest } of picks) {
    // A pick aimed at the side this op does not act on is dropped silently.
    if (typeof uid !== "string" || dest.seat !== board || destOf.has(uid)) continue;
    const to = targetOf(dest);
    if (bodyAt(side, to) === undefined) continue;
    destOf.set(uid, to);
  }
  if (destOf.size === 0) return state;
  // Grouped by (source, destination) pair, one event per pair, because `ENERGY_MOVED` promises all
  // its uids share one `from` and one `to`. Each entry keeps its source's top uid since the source
  // may be Knocked Out later in this reduction.
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
      // Never strip a pick whose destination is the body it sits on; `validateChoice` refuses it,
      // this keeps the apply honest.
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
    return inbound === undefined
      ? pokemon
      : { ...pokemon, energy: [...pokemon.energy, ...inbound] };
  };
  const active = activeStripped === null ? null : addTo(activeStripped, "active");
  const bench = benchStripped.map((pokemon, index) => addTo(pokemon, `bench:${index}`));
  // One row per (SOURCE, DESTINATION) pair, in the order the board was walked
  // (Active first, then the bench left to right) — a two-source N's Plan reads as
  // the two sentences it is, and a Kilowattrel spread reads as the several it is.
  for (const group of groups) {
    events.push({
      type: "ENERGY_MOVED",
      // `seat` is the board and `actor` the cause; they differ only on the opponent-board
      // printings, and `log.ts` forks on the comparison.
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

/**
 * Discard the chosen Energy off the victim's Pokémon into the victim's discard pile (cards go to
 * their owner's pile, §8.1). The victim is the opponent for hammer arms and the controller for
 * `yourActive`. Re-finds each uid on the live board and skips stale ones. One event per affected
 * Pokémon, in board order. Never damages.
 */
export function discardEnergyApply(
  state: GameState,
  uids: readonly string[],
  op: OpOf<"discardEnergy">,
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; discarded: string[] } {
  if (uids.length === 0) return { state, discarded: [] };
  const victim = discardVictimSeat(ctx.seat, op);
  // Milotic "Mentally Calm" opposite the victim: a `to: "hand"` move whiffs and the Energy stays
  // attached.
  if (op.to === "hand" && inPlayToHandBlocked(state, victim)) return { state, discarded: [] };
  const side = state.players[victim];
  const picks = new Set(uids);
  // Collected in one pass so events read Active-then-bench. `host` is captured off the pre-strip
  // stack because the attack may have Knocked Out the defender, so events name the Pokémon by uid.
  // The destination is read once so the events and the zone write agree; absent means the discard
  // pile, and both zones belong to `victim`.
  const toHand = op.to === "hand";
  // Deck destination (Wellspring Mask Ogerpon ex: "shuffle 3 Energy attached to this Pokémon into
  // your deck"). The shuffle is the trailing `shuffleDeck` op.
  const toDeck = op.to === "deck";
  const pulled: { target: PokemonTarget; host: string; uids: string[]; body: InPlayPokemon }[] = [];
  const strip = (pokemon: InPlayPokemon, target: PokemonTarget): InPlayPokemon => {
    const taken: string[] = [];
    const kept = pokemon.energy.filter((uid) => {
      if (!picks.has(uid)) return true;
      taken.push(uid);
      return false;
    });
    if (taken.length === 0) return pokemon;
    pulled.push({ target, host: topUid(pokemon) ?? "", uids: taken, body: pokemon });
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
      // Omitted for the discard pile so the absent case stays `{}`.
      ...(toHand ? { to: "hand" as const } : toDeck ? { to: "deck" as const } : {}),
    });
  }
  const result = {
    state: withSide(state, victim, {
      ...side,
      active,
      bench,
      // Exactly one zone key is written, so a uid never sits in two zones. The deck is appended to;
      // position is irrelevant under the trailing shuffle.
      ...(toHand
        ? { hand: [...side.hand, ...discarded] }
        : toDeck
          ? { deck: [...side.deck, ...discarded] }
          : { discard: [...side.discard, ...discarded] }),
    }),
    discarded,
  };
  // Boomerang Energy (§6.1): a flagged card this attack's program discards off the attacker itself
  // is recorded on the queued `attackEpilogue`, which re-attaches it after the attack. Discards to
  // hand or deck, non-attack discards, and discards from other bodies do not count.
  const boomerang =
    toHand || toDeck || ctx.invokedBy !== "attack" || ctx.sourceUid === undefined
      ? []
      : pulled
          .filter((entry) => entry.host === ctx.sourceUid)
          // The pre-strip attacker answers Nitro Fire's {R} gate.
          .flatMap((entry) =>
            entry.uids.filter((uid) => returnsAfterAttackDiscard(state, uid, entry.body)),
          );
  return { ...result, state: recordBoomerang(result.state, ctx.sourceUid, boomerang) };
}

/**
 * Append `uids` to the attacker's queued `attackEpilogue` (Boomerang Energy). That stage is queued
 * before the attack's program runs; with none queued, nothing returns.
 */
function recordBoomerang(
  state: GameState,
  attackerUid: string | undefined,
  uids: readonly string[],
): GameState {
  if (uids.length === 0) return state;
  const at = state.pending.findIndex(
    (stage) => stage.kind === "attackEpilogue" && stage.uid === attackerUid,
  );
  const stage = state.pending[at];
  if (stage === undefined || stage.kind !== "attackEpilogue") return state;
  const carried: PendingStage = { ...stage, boomerang: [...(stage.boomerang ?? []), ...uids] };
  return {
    ...state,
    pending: state.pending.map((queued, index) => (index === at ? carried : queued)),
  };
}

/**
 * Strip the picked Pokémon Tools and put each in its owner's discard pile (§7.4). `host` is
 * captured off the pre-strip stack since the body may be Knocked Out in the same batch. One event
 * row per host, never emitted for an empty `uids`.
 */
export function toolDiscardApply(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; discarded: string[] } {
  if (uids.length === 0) return { state, discarded: [] };
  // Tool Scrapper ("yours or your opponent's") can pick Tools off both boards, so each seat is
  // stripped in turn (controller's first) and each Tool lands in its owner's pile.
  const picks = new Set(uids);
  let next = state;
  const discarded: string[] = [];
  for (const victim of [ctx.seat, otherSeat(ctx.seat)] as const) {
    const side = next.players[victim];
    const pulled: { host: string; uids: string[] }[] = [];
    const strip = (pokemon: InPlayPokemon): InPlayPokemon => {
      const taken: string[] = [];
      const kept = pokemon.tools.filter((uid) => {
        if (!picks.has(uid)) return true;
        taken.push(uid);
        return false;
      });
      if (taken.length === 0) return pokemon;
      pulled.push({ host: topUid(pokemon) ?? "", uids: taken });
      return { ...pokemon, tools: kept };
    };
    const active = side.active === null ? null : strip(side.active);
    const bench = side.bench.map(strip);
    if (pulled.length === 0) continue;
    const fromThisSide: string[] = [];
    for (const entry of pulled) {
      fromThisSide.push(...entry.uids);
      events.push({
        type: "TOOLS_DISCARDED",
        // Each row names its victim's seat (the host's owner).
        seat: victim,
        actor: ctx.seat,
        uids: [...entry.uids],
        host: entry.host,
        // This runs at the program tail after damage, so the log must not say "before doing
        // damage".
        when: "effect",
      });
    }
    discarded.push(...fromThisSide);
    next = withSide(next, victim, {
      ...side,
      active,
      bench,
      discard: [...side.discard, ...fromThisSide],
    });
  }
  return { state: discarded.length === 0 ? state : next, discarded };
}
