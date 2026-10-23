import { conditionHolds } from "../boardCondition";
import {
  benchMatches,
  cardOfUid,
  evolveFromOf,
  isBasicPokemon,
  matchesFilter,
  topUid,
} from "../cards";
import {
  inPlayCardOf,
  intoPlayOnlyViaOf,
  stadiumEffectsOf,
  stageChangeConditions,
  supporterEffectOf,
  toolCapOf,
  toolCardSimulated,
} from "../continuous";
import type { EffectContext, EffectPrompt, EffectRecord } from "../effectPrompt";
import type { BoardCondition, CardFilter, EffectOp, HandRefreshDraw, OpOf } from "../effectTypes";
import { benchSpace, cardIdentity, recordMoved, refPokemon, sourceRef } from "../effectTargets";
import type { GameEvent } from "../events";
import { opponentDiscardNote, searchOrElseNote } from "../promptText";
import { flipCoin, randomIndex, shuffle } from "../rng";
import type { GameState, InPlayPokemon, PlayerSide, PokemonTarget, Seat } from "../types";
import {
  BENCH_CEILING,
  bodyAt,
  drawToHand,
  evolveOnto,
  makeInPlay,
  otherSeat,
  relativeSeat,
  turnOwnerOf,
  without,
  withSide,
} from "../types";

// Op implementations over the deck and hand: searches, retrievals, looks and reveals, hand
// discards and costs, shuffles and evolving from deck or hand.

/**
 * Caretaker: the card is already in the discard pile when the program runs, so "instead of
 * discarding it" moves it to the deck and shuffles. Named by `ctx.playedUid`, not `sourceUid`; a
 * silent no-op if it is gone.
 */
export function shufflePlayedCardIntoDeck(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const uid = ctx.playedUid;
  const side = state.players[ctx.seat];
  if (uid === undefined || !side.discard.includes(uid)) return state;
  const [deck, rngState] = shuffle([...side.deck, uid], state.rngState);
  // `played: true` so the log shows the played card going into the deck rather than a discard-pile
  // retrieval.
  events.push({
    type: "DISCARD_RETRIEVED",
    seat: ctx.seat,
    dest: "deck",
    uids: [uid],
    played: true,
  });
  events.push({ type: "SHUFFLE", seat: ctx.seat });
  return {
    ...withSide(state, ctx.seat, { ...side, discard: without(side.discard, uid), deck }),
    rngState,
  };
}

/**
 * Discard `ctx.seat`'s whole hand, filing `HAND_DISCARDED` (nothing on an empty hand). Exported for
 * flow.ts's end-of-turn discard (Amarys).
 */
export function discardHand(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const side = state.players[ctx.seat];
  if (side.hand.length === 0) return state;
  events.push({ type: "HAND_DISCARDED", seat: ctx.seat, uids: [...side.hand] });
  return withSide(state, ctx.seat, { ...side, hand: [], discard: [...side.discard, ...side.hand] });
}

/**
 * `whose: "opponent"` shuffles the other seat's deck; the seat is computed once so the read, the
 * `SHUFFLE` row and the write agree. Absent means the controller's deck.
 */
export function shuffleDeck(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"shuffleDeck">,
  events: GameEvent[],
): GameState {
  const seat = relativeSeat(ctx.seat, op.whose === "opponent");
  const side = state.players[seat];
  const [deck, rngState] = shuffle(side.deck, state.rngState);
  events.push({ type: "SHUFFLE", seat });
  return { ...withSide(state, seat, { ...side, deck }), rngState };
}

/**
 * Shuffle the top `n` cards of the controller's deck among themselves and put them under the rest
 * (Deduction Kit). Only the window is shuffled, so the rest of the deck keeps its order. Clamped to
 * the deck size.
 */
export function bottomDeckTop(
  state: GameState,
  n: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const window = side.deck.slice(0, Math.max(0, n));
  const [shuffled, rngState] = shuffle(window, state.rngState);
  events.push({ type: "DECK_TOP_TO_BOTTOM", seat: ctx.seat, count: window.length });
  return {
    ...withSide(state, ctx.seat, {
      ...side,
      deck: [...side.deck.slice(window.length), ...shuffled],
    }),
    rngState,
  };
}

/**
 * Put the affected players' hands back into their decks, then draw (hand-refresh Supporters,
 * Gothitelle "Distorted Future"). Seats in fixed order, controller first. Pass 1 moves each hand
 * (shuffled in, or with `toBottom` shuffled alone and placed under the deck); pass 2 draws.
 * `onlyIfAnyMoved` skips all draws if no seat moved a card, which is why all moves precede any
 * draw. Events are count-only. Never parks or KOs.
 */
export function handRefresh(
  state: GameState,
  op: OpOf<"handRefresh">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // With `who: "opponent"` the controller's hand is not refreshed (Distorted Future disrupts
  // without paying).
  const seats: Seat[] =
    op.who === "both"
      ? [ctx.seat, otherSeat(ctx.seat)]
      : op.who === "opponent"
        ? [otherSeat(ctx.seat)]
        : [ctx.seat];
  let next = state;
  // One entry per affected seat, in the same order — pass 2 zips over it, so the
  // captured pre-move hand size can never go missing (no lookup, no default).
  const moved: { seat: Seat; handCount: number }[] = [];
  for (const seat of seats) {
    const side = next.players[seat];
    const handCount = side.hand.length;
    moved.push({ seat, handCount });
    if (op.toBottom) {
      // Only the hand is randomized; the deck keeps its order above it.
      const [bottom, rngState] = shuffle(side.hand, next.rngState);
      const deck = [...side.deck, ...bottom];
      events.push({ type: "HAND_TO_BOTTOM_OF_DECK", seat, count: handCount });
      next = { ...withSide(next, seat, { ...side, hand: [], deck }), rngState };
    } else {
      // The deck is reordered even from an empty hand (count 0), so the following
      // draw is off a freshly shuffled deck either way.
      const [deck, rngState] = shuffle([...side.deck, ...side.hand], next.rngState);
      events.push({ type: "HAND_SHUFFLED_INTO_DECK", seat, count: handCount });
      next = { ...withSide(next, seat, { ...side, hand: [], deck }), rngState };
    }
  }
  if (op.onlyIfAnyMoved && !moved.some((m) => m.handCount > 0)) return next;
  for (const { seat, handCount } of moved) {
    // Returns the state as well as the count because Lucian's coin flip spends `rngState` (one flip
    // per seat, controller first).
    const dealt = handRefreshDrawCount(next, seat, ctx.seat, op.draw, handCount, events);
    next = drawToHand(dealt.state, seat, dealt.count, "effect", events);
  }
  return next;
}

/**
 * How many cards `seat` draws in a handRefresh. `seat` is the seat being dealt to; `controller` is
 * the one who played the card ("you"), needed for printed pairs like Harlequin's "you draw 5, your
 * opponent draws 3".
 */
function handRefreshDrawCount(
  state: GameState,
  seat: Seat,
  controller: Seat,
  draw: HandRefreshDraw,
  handCount: number,
  events: GameEvent[],
): { count: number; state: GameState } {
  switch (draw.kind) {
    case "fixed":
      return { count: draw.count, state };
    case "handPlus":
      return { count: handCount + draw.delta, state };
    case "prizeCount":
      return { count: state.players[seat].prizes.length, state };
    case "perSeat":
      return { count: seat === controller ? draw.you : draw.opponent, state };
    // Lucian: each seat flips its own coin (heads draws 6, tails 3); each flip advances `rngState`
    // and files a row under the flipping seat.
    case "coinFlip": {
      const [face, rngState] = flipCoin(state.rngState);
      events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat, result: face });
      return { count: face === "heads" ? draw.heads : draw.tails, state: { ...state, rngState } };
    }
    // The controller's opponent, never `otherSeat(seat)`, so the word names the same seat for every
    // affected seat.
    case "opponentHandSize":
      return { count: state.players[otherSeat(controller)].hand.length, state };
  }
}

/**
 * §7.3 Risky Ruins: place counters on each of `uids` that `seat` just put onto its own Bench during
 * its own turn, when the body is a Basic Pokémon (including Antique Fossil) whose in-play types do
 * not include `excludesType`. One `COUNTERS_PLACED { source: "trainer" }` row per body. Every
 * own-Bench arrival route calls this; placement onto the opponent's Bench does not. No sweep: no
 * Standard-legal Basic has 20 HP or less.
 */
export function benchArrivalCounters(
  state: GameState,
  seat: Seat,
  uids: readonly string[],
  events: GameEvent[],
): GameState {
  const rule = stadiumEffectsOf(state)?.benchArrivalCounters;
  if (rule === undefined) return state;
  // "During their turn".
  if (turnOwnerOf(state) !== seat) return state;
  const landed = new Set(uids);
  const side = state.players[seat];
  const bench = side.bench.map((body) => {
    const uid = topUid(body);
    if (uid === undefined || !landed.has(uid)) return body;
    const card = inPlayCardOf(state, body);
    if (
      card === undefined ||
      !isBasicPokemon(card) ||
      (card.types ?? []).includes(rule.excludesType)
    )
      return body;
    events.push({ type: "COUNTERS_PLACED", seat, uid, amount: rule.amount, source: "trainer" });
    return { ...body, damage: body.damage + rule.amount };
  });
  return withSide(state, seat, { ...side, bench });
}

/**
 * Move the chosen searched cards deck to dest (Bench Basics enter play stamped this turn; hand
 * cards append). Only uids actually in the deck move. `reveal` is forwarded to the event for the
 * log. Returns what actually moved, since Bench-bound answers are clamped to `benchSpace` here.
 */
export function searchMove(
  state: GameState,
  uids: readonly string[],
  dest: "bench" | "hand" | "deckTop" | "discard",
  reveal: true | undefined,
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: readonly string[] } {
  const side = state.players[ctx.seat];
  // Bench-bound cards clamp to the remaining bench space HERE, before anything
  // leaves the deck — so the set removed from the deck is EXACTLY the set that
  // lands (a slice-after-remove would strand the excess in neither zone, the
  // card-destruction shape the M1 review called out). Hand has no cap.
  const inDeck = uids.filter((uid) => side.deck.includes(uid));
  const moved = dest === "bench" ? inDeck.slice(0, benchSpace(state, ctx.seat)) : inDeck;
  if (moved.length === 0) return { state, moved };
  const picked = new Set(moved);
  const deck = side.deck.filter((uid) => !picked.has(uid));
  const updated: PlayerSide =
    dest === "bench"
      ? {
          ...side,
          deck,
          bench: [...side.bench, ...moved.map((uid) => makeInPlay(uid, state.turn))],
        }
      : // "Then put those cards on top of it": the cards go straight back onto the deck's front in pick order, seeding `reorderTop`'s park so declining to reorder keeps the picked order. No shuffle here; it already ran as its own op, and shuffling now would bury these cards.
        dest === "deckTop"
        ? { ...side, deck: [...moved, ...deck] }
        : // Brilliant Blender's "and discard them": the controller's own pile, in pick order.
          dest === "discard"
          ? { ...side, deck, discard: [...side.discard, ...moved] }
          : { ...side, deck, hand: [...side.hand, ...moved] };
  // Two whole objects rather than a conditional spread: `reveal: undefined` is not the same wire
  // value as no key.
  events.push(
    reveal === true
      ? { type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved], reveal: true }
      : { type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved] },
  );
  return { state: withSide(state, ctx.seat, updated), moved }; // searchMove
}

/**
 * Is deck card `uid` a Tool the engine simulates? Uses `toolCardSimulated`, the same predicate
 * `attachTool` asks, so the deck attach never offers a Tool the hand attach would refuse.
 */
export function attachableToolCard(state: GameState, uid: string): boolean {
  const card = cardOfUid(state, uid);
  return card !== undefined && toolCardSimulated(card);
}

/**
 * §7.4 free Tool slots on the program's own body: `toolCapOf` minus Tools attached, 0 if it left
 * play. Gates the `attachToSelf` search offer.
 */
export function freeToolSlotsOfSource(state: GameState, ctx: EffectContext): number {
  const [ref] = sourceRef(state, ctx);
  if (ref === undefined) return 0;
  const body = refPokemon(state, ref);
  // Slot count comes from `toolCapOf` (Multi Adapter), still at most one card per attach.
  return body !== undefined && body.tools.length < toolCapOf(state, ctx.seat, body) ? 1 : 0;
}

/**
 * Farfetch'd "Impromptu Carrier": attach the picked Tool from the deck to the program's own body.
 * §7.4 is re-checked: at most one card, only with a free slot, only a card still in the deck and
 * still a simulated Tool. Emits `TOOL_ATTACHED` as `attachTool` does. Returns what moved.
 */
export function searchAttachToSelf(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: readonly string[] } {
  const side = state.players[ctx.seat];
  const [ref] = sourceRef(state, ctx);
  const uid = uids.find((u) => side.deck.includes(u) && attachableToolCard(state, u));
  if (ref === undefined || uid === undefined) return { state, moved: [] };
  const body = refPokemon(state, ref);
  if (body === undefined || body.tools.length >= toolCapOf(state, ctx.seat, body))
    return { state, moved: [] };
  const withTool: InPlayPokemon = { ...body, tools: [...body.tools, uid] };
  const deck = side.deck.filter((u) => u !== uid);
  const updated: PlayerSide =
    ref.spot.spot === "active"
      ? { ...side, deck, active: withTool }
      : {
          ...side,
          deck,
          bench: side.bench.map((pokemon, i) =>
            ref.spot.spot === "bench" && i === ref.spot.index ? withTool : pokemon,
          ),
        };
  const target: PokemonTarget =
    ref.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: ref.spot.index };
  events.push({ type: "TOOL_ATTACHED", seat: ctx.seat, uid, target });
  return { state: withSide(state, ctx.seat, updated), moved: [uid] };
}

/**
 * What an `evolveFromDeck` op offers: the body "this Pokémon" names, where it sits, and the deck
 * cards that would legally evolve it. The predicate is the §10 evolves-from match used for hand
 * evolves (without Eevee ex's hand-only alias), and cards with `intoPlayOnlyVia` are excluded. The
 * §10 timing bans do not apply: they govern playing from hand. `undefined` when the source has left
 * the board.
 */
export function evolveFromDeckOffer(
  state: GameState,
  ctx: EffectContext,
  /**
   * The op's `onto`. Absent, the subject is `ctx.sourceUid`; present, it is that target. A slot
   * that emptied falls out as `undefined`. Seat-relative to `ctx.seat`.
   */
  onto?: PokemonTarget,
  /**
   * The op's `names`. Absent, candidates are the §10 chain match; present, a name-set test replaces
   * it (they are alternatives, never conjuncts).
   */
  names?: readonly string[],
  /**
   * The op's `noAbilities` (Salvatore): a conjunct keeping only cards with no Abilities. Absent
   * means unfiltered.
   */
  noAbilities?: true,
  /**
   * When set, candidates are read from the controller's hand instead of the deck (Spiteful
   * Evolution).
   */
  fromHand?: true,
):
  | {
      target: PokemonTarget;
      benchIndex: number;
      body: InPlayPokemon;
      bodyUid: string;
      name: string;
      candidates: string[];
    }
  | undefined {
  const [ref] = onto === undefined ? sourceRef(state, ctx) : [{ seat: ctx.seat, spot: onto }];
  if (ref === undefined) return undefined;
  const side = state.players[ctx.seat];
  const body = bodyAt(side, ref.spot);
  if (body === undefined) return undefined;
  const bodyUid = topUid(body);
  const top = bodyUid === undefined ? undefined : cardOfUid(state, bodyUid);
  if (bodyUid === undefined || top === undefined) return undefined;
  return {
    target: ref.spot,
    benchIndex: ref.spot.spot === "bench" ? ref.spot.index : -1,
    body,
    bodyUid,
    name: top.name,
    candidates: (fromHand === true ? side.hand : side.deck).filter((uid) => {
      const card = cardOfUid(state, uid);
      // An unresolvable deck uid is not a candidate — `evolveFromOf` demands a
      // `Card`, and a missing catalog row must fall OUT of the offer rather than
      // be admitted by a loose comparison (the `hpOf` null rule, one file over).
      if (card === undefined) return false;
      // Palafin ex's "Hero's Spirit" card is never a deck-evolve candidate. Read off the card's
      // program, not `passivesOf`, since a card in the deck has no fold and a §9 lock must not lift
      // it.
      if (intoPlayOnlyViaOf(card) !== undefined) return false;
      // A printed name set replaces the §10 chain match rather than combining with it: Pidove names
      // Unfezant, which evolves from Tranquill, so a conjunction would always be empty.
      // `noAbilities` is ANDed ahead of either predicate; `abilities` may be `null` or `[]` and
      // both mean no Abilities.
      if (noAbilities === true && (card.abilities ?? []).length > 0) return false;
      if (names !== undefined) return names.includes(card.name);
      return evolveFromOf(card) === top.name;
    }),
  };
}

/**
 * Resolve an `evolveFromDeck` pick: the card leaves the deck and goes onto the named body through
 * `evolveOnto`, without the phase-setting tails. No on-evolve trigger fires, since printed triggers
 * require playing from hand. Only a uid still in the deck and still a legal evolution moves, and
 * only the first pick is taken.
 */
export function evolveFromDeckMove(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
  /** The op's `onto`, so resolution re-derives the same offer the park made. */
  onto?: PokemonTarget,
  /** The op's `names`, so resolution re-derives the offer under the same predicate as the park. */
  names?: readonly string[],
  /**
   * The op's `noAbilities`, so resolution re-derives the offer under the same predicate as the
   * park.
   */
  noAbilities?: true,
): GameState {
  const offer = evolveFromDeckOffer(state, ctx, onto, names, noAbilities);
  if (offer === undefined) return state;
  const uid = uids[0];
  if (uid === undefined || !offer.candidates.includes(uid)) return state;
  const side = state.players[ctx.seat];
  const pulled = withSide(state, ctx.seat, {
    ...side,
    deck: side.deck.filter((inDeck) => inDeck !== uid),
  });
  return evolveOnto(
    pulled,
    ctx.seat,
    offer.target,
    offer.benchIndex,
    offer.body,
    offer.bodyUid,
    uid,
    events,
    stageChangeConditions(pulled, offer.body.conditions),
  ).state;
}

/**
 * Resolve an `evolveFromDeck { fromHand }` pick (Spiteful Evolution): the card leaves the hand and
 * evolves the program's own body, re-derived against the offer. Returns the uid placed, for
 * `recordAs`.
 */
export function evolveFromHandMove(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: string[] } {
  const offer = evolveFromDeckOffer(state, ctx, undefined, undefined, undefined, true);
  const uid = uids[0];
  if (offer === undefined || uid === undefined || !offer.candidates.includes(uid))
    return { state, moved: [] };
  const side = state.players[ctx.seat];
  const pulled = withSide(state, ctx.seat, {
    ...side,
    hand: side.hand.filter((inHand) => inHand !== uid),
  });
  const kept = stageChangeConditions(pulled, offer.body.conditions);
  const evolved = evolveOnto(
    pulled,
    ctx.seat,
    offer.target,
    offer.benchIndex,
    offer.body,
    offer.bodyUid,
    uid,
    events,
    kept,
  );
  return { state: evolved.state, moved: [uid] };
}

/**
 * Whether `seat`'s hand holds a card that evolves from the body `sourceUid` names, so Spiteful
 * Evolution is refused rather than spent on a whiff.
 */
export function evolveFromHandAvailable(
  state: GameState,
  seat: Seat,
  sourceUid: string | undefined,
): boolean {
  return (
    (evolveFromDeckOffer(state, { seat, sourceUid }, undefined, undefined, undefined, true)
      ?.candidates.length ?? 0) > 0
  );
}

/**
 * Move the chosen retrieved cards from discard to dest: hand appends, deck appends (a following
 * `shuffleDeck` scrambles), bench enters play stamped this turn. Only uids still in the discard
 * move. The bench arm clamps again because the Bench may have filled since the park; returns the
 * uids that actually moved.
 */
export function retrieveMove(
  state: GameState,
  uids: readonly string[],
  dest: "hand" | "deck" | "bench",
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; moved: string[] } {
  const side = state.players[ctx.seat];
  const inDiscard = uids.filter((uid) => side.discard.includes(uid));
  const moved = dest === "bench" ? inDiscard.slice(0, benchSpace(state, ctx.seat)) : inDiscard;
  if (moved.length === 0) return { state, moved };
  const picked = new Set(moved);
  const discard = side.discard.filter((uid) => !picked.has(uid));
  const updated: PlayerSide =
    dest === "hand"
      ? { ...side, discard, hand: [...side.hand, ...moved] }
      : dest === "bench"
        ? {
            ...side,
            discard,
            bench: [...side.bench, ...moved.map((uid) => makeInPlay(uid, state.turn))],
          }
        : { ...side, discard, deck: [...side.deck, ...moved] };
  events.push({ type: "DISCARD_RETRIEVED", seat: ctx.seat, dest, uids: [...moved] });
  return { state: withSide(state, ctx.seat, updated), moved };
}

/**
 * Push the single `DECK_TOP_REVEALED` row shared by the whiff, decline and move paths. Absent flags
 * must be absent keys, not `undefined`.
 */
function pushDeckTopLook(
  op: OpOf<"lookAtTopN">,
  moved: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): void {
  const owner = relativeSeat(ctx.seat, op.whose === "opponent");
  const event: Extract<GameEvent, { type: "DECK_TOP_REVEALED" }> = {
    type: "DECK_TOP_REVEALED",
    seat: owner,
    uids: [...moved],
    // Spread when present: an explicit `undefined` is a different wire value from a missing key.
    ...(op.dest === undefined ? {} : { dest: op.dest }),
    ...(op.reveal === true ? { reveal: true as const } : {}),
    ...(op.from === undefined ? {} : { from: op.from }),
    // Accompanying Flute: the looker is not the deck's owner.
    ...(owner === ctx.seat ? {} : { actor: ctx.seat }),
  };
  events.push(event);
}

/**
 * The looked-at window: the top `n` by default, or the last `n` for `"bottom"`. A short deck yields
 * the whole deck.
 */
export function lookWindow(deck: readonly string[], op: OpOf<"lookAtTopN">): string[] {
  const n = Math.max(0, op.n);
  return op.from === "bottom" ? deck.slice(Math.max(0, deck.length - n)) : deck.slice(0, n);
}

/**
 * Move the chosen looked-at cards from the deck to `op.dest`. Only uids still in the deck move. The
 * bench arm clamps before anything leaves the deck, since the Bench may have filled since the park.
 * The event fires even when nothing moved. `restTo` handles the leftovers (`window \ moved`,
 * including unfiltered cards) on every path: `"discard"` leaves the deck and emits
 * `DECK_TOP_DISCARDED`; `"bottom"` and `"shuffledBottom"` append under the deck silently, and only
 * `"shuffledBottom"` spends rng.
 */
export function revealFromTop(
  state: GameState,
  uids: readonly string[],
  op: OpOf<"lookAtTopN">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // The deck, Bench clamp and landing side belong to `lookOwner` (Accompanying Flute).
  const owner = relativeSeat(ctx.seat, op.whose === "opponent");
  const side = state.players[owner];
  const inDeck = uids.filter((uid) => side.deck.includes(uid));
  const moved = op.dest === "bench" ? inDeck.slice(0, benchSpace(state, owner)) : inDeck;
  pushDeckTopLook(op, moved, ctx, events);
  const picked = new Set(moved);
  const rest =
    op.restTo === undefined ? [] : lookWindow(side.deck, op).filter((uid) => !picked.has(uid));
  if (moved.length === 0 && rest.length === 0) return state;
  const removed = new Set([...picked, ...rest]);
  const kept = side.deck.filter((uid) => !removed.has(uid));
  // `toPile` are cards that left the deck; `underneath` stayed in it. Only the discard arm
  // announces anything.
  const toPile = op.restTo === "discard" ? rest : [];
  // `"shuffledBottom"` is the only path that touches `rngState`, and `shuffle`
  // leaves it alone for a leftover of 0 or 1 (its loop starts at `length - 1`).
  const [underneath, rngState] =
    op.restTo === "shuffledBottom"
      ? shuffle(rest, state.rngState)
      : [op.restTo === "bottom" ? rest : [], state.rngState];
  // `seat` is the deck's owner and `actor` the controller; they differ only under Accompanying
  // Flute.
  if (toPile.length > 0)
    events.push({ type: "DECK_TOP_DISCARDED", seat: owner, actor: ctx.seat, uids: [...toPile] });
  // The leftovers land in the pile BEFORE the taken cards reach a `dest` of
  // `"discard"` would — but no printing carries both, and the two never share a
  // card, so the pile's order is the window's either way.
  const discard = toPile.length === 0 ? side.discard : [...side.discard, ...toPile];
  // The bottomed leftovers go UNDER everything the deck still holds — appended after
  // the removal, so a window deeper than the rest of the deck cannot reorder it.
  const deck = underneath.length === 0 ? kept : [...kept, ...underneath];
  const updated: PlayerSide =
    op.dest === "bench"
      ? {
          ...side,
          deck,
          discard,
          bench: [...side.bench, ...moved.map((uid) => makeInPlay(uid, state.turn))],
        }
      : op.dest === "discard"
        ? { ...side, deck, discard: [...discard, ...moved] }
        : { ...side, deck, discard, hand: [...side.hand, ...moved] };
  // `rngState` is threaded rather than assumed unchanged: it is a field of
  // `GameState` and not of the side, so a shuffled leftover has to be written back
  // here or the randomness is spent and then thrown away.
  return withSide({ ...state, rngState }, owner, updated);
}

/**
 * Pay a hand cost: move the chosen uids from the controller's hand to their discard or under their
 * deck (in pick order). Only uids in hand move and duplicates pay once. Returns the uids actually
 * paid, for the §9.2 record.
 */
export function payFromHandApply(
  state: GameState,
  uids: readonly string[],
  op: OpOf<"payFromHand">,
  ctx: EffectContext,
  events: GameEvent[],
): { state: GameState; paid: string[] } {
  const side = state.players[ctx.seat];
  const inHand = new Set(side.hand);
  const paid: string[] = [];
  const spent = new Set<string>();
  for (const uid of uids) {
    if (!inHand.has(uid) || spent.has(uid)) continue;
    spent.add(uid);
    paid.push(uid);
  }
  if (paid.length === 0) return { state, paid };
  const hand = side.hand.filter((uid) => !spent.has(uid));
  // An attack's hand discard is its effect, not a cost.
  const asEffect = ctx.invokedBy === "attack" ? { effect: true as const } : {};
  // Evidence Gathering: the old top card goes into the hand first, then the paid card goes on top.
  // An empty deck is refused before use.
  if (op.swapWithTop === true) {
    const took = side.deck.slice(0, 1);
    events.push({
      type: "HAND_COST_PAID",
      seat: ctx.seat,
      uids: [...paid],
      to: op.to,
      took,
      ...asEffect,
    });
    return {
      state: withSide(state, ctx.seat, {
        ...side,
        hand: [...hand, ...took],
        deck: [...paid, ...side.deck.slice(took.length)],
      }),
      paid,
    };
  }
  events.push({ type: "HAND_COST_PAID", seat: ctx.seat, uids: [...paid], to: op.to, ...asEffect });
  // Academy at Night: the paid cards go on top of the deck in pick order.
  if (op.to === "deckTop") {
    return {
      state: withSide(state, ctx.seat, { ...side, hand, deck: [...paid, ...side.deck] }),
      paid,
    };
  }
  return {
    state: withSide(
      state,
      ctx.seat,
      op.to === "deckBottom"
        ? { ...side, hand, deck: [...side.deck, ...paid] }
        : { ...side, hand, discard: [...side.discard, ...paid] },
    ),
    paid,
  };
}

/**
 * The reveal-and-bottom offer (Ortega, Greavard): the opponent's hand filtered by the op, collapsed
 * to at most `op.upTo ?? 1` copies per interchangeable class. Collapsing leaks nothing because the
 * hand was just revealed. The cap must follow `upTo` so two copies of one Basic can both be picked.
 */
export function bottomFromOpponentHandOffer(
  state: GameState,
  ctx: EffectContext,
  op: OpOf<"bottomFromOpponentHand">,
): string[] {
  // A bench destination into a full opponent Bench offers nothing, so the offer matches what can
  // land.
  if (op.dest === "bench" && benchSpace(state, otherSeat(ctx.seat)) === 0) return [];
  const hand = state.players[otherSeat(ctx.seat)].hand;
  // `"any"` keeps `BENCH_CEILING` copies per class; the full-Bench guard above reads the live
  // limit.
  const cap = op.upTo === "any" ? BENCH_CEILING : (op.upTo ?? 1);
  const kept = new Map<string, number>();
  const candidates: string[] = [];
  for (const uid of hand) {
    if (op.filter !== undefined && !matchesFilter(cardOfUid(state, uid), op.filter)) continue;
    // Onto their Bench, Basic only.
    if (
      op.dest === "bench" &&
      !benchMatches(cardOfUid(state, uid), op.filter ?? { kind: "anyCard" })
    )
      continue;
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= cap) continue;
    kept.set(key, already + 1);
    candidates.push(uid);
  }
  return candidates;
}

/**
 * A copied Supporter's play condition, read as if played from the attacker's hand. Since the copied
 * card is not in that hand, `yourHandExactly n` is checked as `n - 1` (Cassiopeia is offered on an
 * empty attacker hand). Other kinds pass through unchanged.
 */
function copiedPlayableIf(cond: BoardCondition): BoardCondition {
  if (cond.kind === "yourHandExactly") return { kind: "yourHandExactly", count: cond.count - 1 };
  return cond;
}

/**
 * The Look-Alike Show offer: opponent hand Supporters with a `trainer` program (empty programs
 * included), one per card id, in hand order, filtered by their printed play conditions and hand
 * cost for the attacker. `programPlayable` is deliberately not applied.
 */
export function opponentSupporterOffer(state: GameState, ctx: EffectContext): string[] {
  const candidates: string[] = [];
  const kept = new Set<string>();
  for (const uid of state.players[otherSeat(ctx.seat)].hand) {
    const card = cardOfUid(state, uid);
    if (card === undefined || card.category !== "Trainer" || card.trainerType !== "Supporter")
      continue;
    if (kept.has(card.id)) continue;
    const effect = supporterEffectOf(card.id);
    if (effect === undefined) continue;
    if (
      effect.playableIf !== undefined &&
      !conditionHolds(state, ctx.seat, copiedPlayableIf(effect.playableIf))
    )
      continue;
    if (handCostUnmet(state, ctx.seat, effect.ops) !== null) continue;
    kept.add(card.id);
    candidates.push(uid);
  }
  return candidates;
}

/**
 * The program of Supporter `uid` as an attack may use it (Supernatural Shapeshifter), using
 * Look-Alike Show's filter; `undefined` when not eligible.
 */
export function copiedSupporterOps(
  state: GameState,
  ctx: EffectContext,
  uid: string,
): readonly EffectOp[] | undefined {
  const card = cardOfUid(state, uid);
  if (card === undefined || card.category !== "Trainer" || card.trainerType !== "Supporter")
    return undefined;
  const effect = supporterEffectOf(card.id);
  if (effect === undefined) return undefined;
  if (
    effect.playableIf !== undefined &&
    !conditionHolds(state, ctx.seat, copiedPlayableIf(effect.playableIf))
  )
    return undefined;
  if (handCostUnmet(state, ctx.seat, effect.ops) !== null) return undefined;
  return effect.ops;
}

/**
 * Move the chosen card from the opponent's hand to the bottom of their deck. Only uids still in the
 * hand move. Returns what actually moved, for the §9.2 record.
 */
export function bottomFromOpponentHandApply(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
  dest?: "bench" | "discard" | "deck",
): { state: GameState; moved: string[] } {
  const owner = otherSeat(ctx.seat);
  const side = state.players[owner];
  const inHand = new Set(side.hand);
  const moved: string[] = [];
  const taken = new Set<string>();
  for (const uid of uids) {
    if (!inHand.has(uid) || taken.has(uid)) continue;
    taken.add(uid);
    moved.push(uid);
  }
  // Clamp again: the Bench may have filled since the offer was made.
  const landing = dest === "bench" ? moved.slice(0, benchSpace(state, owner)) : moved;
  if (landing.length === 0) return { state, moved: landing };
  const kept = new Set(landing);
  if (dest === "bench") {
    for (const uid of landing) {
      // The ENERGY_DISCARDED / CARD_TO_BOTTOM_OF_DECK convention: `seat` is the
      // OWNER whose Bench grew, `actor` the controller who chose. Without the
      // actor the row is indistinguishable from that seat benching a Basic of
      // their own, which is a materially different thing to have happened.
      events.push({ type: "POKEMON_BENCHED", seat: owner, uid, actor: ctx.seat });
    }
    return {
      state: withSide(state, owner, {
        ...side,
        hand: side.hand.filter((uid) => !kept.has(uid)),
        bench: [...side.bench, ...landing.map((uid) => makeInPlay(uid, state.turn))],
      }),
      moved: landing,
    };
  }
  // Discard arm: the card goes to its owner's discard pile, which has no capacity, so no clamp.
  // Uses its own event because the actor chose from someone else's hand.
  if (dest === "discard") {
    for (const uid of landing) {
      events.push({ type: "CARD_DISCARDED_FROM_HAND", seat: owner, uid, actor: ctx.seat });
    }
    return {
      state: withSide(state, owner, {
        ...side,
        hand: side.hand.filter((uid) => !kept.has(uid)),
        discard: [...side.discard, ...landing],
      }),
      moved: landing,
    };
  }
  // Snap Inspection: the picked card is shuffled into its owner's deck.
  if (dest === "deck") {
    for (const uid of landing) {
      events.push({ type: "HAND_CARD_SHUFFLED_INTO_DECK", seat: owner, uid, actor: ctx.seat });
    }
    const [shuffledDeck, rngState] = shuffle([...side.deck, ...landing], state.rngState);
    events.push({ type: "SHUFFLE", seat: owner });
    return {
      state: {
        ...withSide(state, owner, {
          ...side,
          hand: side.hand.filter((uid) => !kept.has(uid)),
          deck: shuffledDeck,
        }),
        rngState,
      },
      moved: landing,
    };
  }
  for (const uid of landing) {
    events.push({ type: "CARD_TO_BOTTOM_OF_DECK", seat: owner, uid, actor: ctx.seat });
  }
  return {
    state: withSide(state, owner, {
      ...side,
      hand: side.hand.filter((uid) => !kept.has(uid)),
      deck: [...side.deck, ...landing],
    }),
    moved: landing,
  };
}

/**
 * Reveal `seat`'s whole hand in one `HAND_REVEALED`. The caller passes the owner. The uid array is
 * copied so later moves don't change the logged reveal. Emits even for an empty hand.
 */
export function revealHand(state: GameState, seat: Seat, events: GameEvent[]): void {
  events.push({ type: "HAND_REVEALED", seat, uids: [...state.players[seat].hand] });
}

/**
 * Take a random card from the opponent's hand to their discard or shuffle it into their deck. The
 * pick uses `randomIndex` over `rngState` so it replays deterministically. An empty hand takes
 * nothing, emits nothing and spends no rng. The deck route shuffles and emits a `SHUFFLE`.
 */
export function randomFromOpponentHand(
  state: GameState,
  op: OpOf<"randomFromOpponentHand">,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const owner = otherSeat(ctx.seat);
  const side = state.players[owner];
  if (side.hand.length === 0) return state;
  const [index, rngState] = randomIndex(side.hand.length, state.rngState);
  const uid = side.hand[index] as string;
  // Bother-Bot: the card stays in hand, only it is revealed, and its uid is recorded for the later
  // switch.
  if (op.to === "reveal") {
    events.push({ type: "RANDOM_CARD_REVEALED", seat: owner, uid, actor: ctx.seat });
    recordMoved(record, op.recordAs, [uid]);
    return { ...state, rngState };
  }
  events.push({ type: "RANDOM_CARD_TAKEN", seat: owner, uid, actor: ctx.seat, to: op.to });
  const hand = side.hand.filter((held) => held !== uid);
  if (op.to === "discard") {
    return {
      ...withSide(state, owner, { ...side, hand, discard: [...side.discard, uid] }),
      rngState,
    };
  }
  const [deck, shuffled] = shuffle([...side.deck, uid], rngState);
  events.push({ type: "SHUFFLE", seat: owner });
  return { ...withSide(state, owner, { ...side, hand, deck }), rngState: shuffled };
}

/**
 * Furfrou "Hand Trim": `max(0, hand - size)` independent random takes, counted once before the
 * first. A hand at or under `size` spends no rng.
 */
export function randomDiscardDownTo(
  state: GameState,
  op: OpOf<"randomFromOpponentHand">,
  size: number,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const single: OpOf<"randomFromOpponentHand"> = {
    op: "randomFromOpponentHand",
    to: op.to,
  };
  const take = Math.max(0, state.players[otherSeat(ctx.seat)].hand.length - size);
  let next = state;
  for (let n = 0; n < take; n += 1)
    next = randomFromOpponentHand(next, single, ctx, events, record);
  return next;
}

/** Pokémon cards in `seat`'s hand (Tyme's candidates), read through the zone-aware `cardOfUid`. */
export function handPokemonUids(state: GameState, seat: Seat): string[] {
  return state.players[seat].hand.filter((uid) => cardOfUid(state, uid)?.category === "Pokemon");
}

/**
 * Tyme's reveal: an exact match against the named card's printed HP (no HP matches nothing). Right,
 * the opponent draws `op.draw`; wrong, the controller does.
 */
export function hpGuessApply(
  state: GameState,
  op: OpOf<"opponentGuessesHp">,
  uid: string,
  guess: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const hp = cardOfUid(state, uid)?.hp ?? null;
  const right = hp !== null && guess === hp;
  const drawer = relativeSeat(ctx.seat, right);
  events.push({ type: "HP_GUESSED", seat: ctx.seat, uid, guess, hp, right, drawer });
  return drawToHand(state, drawer, op.draw, "effect", events);
}

/**
 * Hand Trimmer's controller arm: `seat` discards down to `untilHandSize`, choosing which, with no
 * separate decider.
 */
export function selfDiscardDownTo(
  state: GameState,
  op: OpOf<"opponentDiscardsFromHand">,
  seat: Seat,
  events: GameEvent[],
): { done: GameState } | { park: EffectPrompt } {
  const own = state.players[seat].hand;
  const excess = Math.max(0, own.length - (op.untilHandSize ?? own.length));
  if (excess === 0) return { done: state };
  if (own.length <= excess) return { done: discardChosenFromHand(state, seat, own, events) };
  return {
    park: {
      kind: "chooseCards",
      candidates: [...own],
      min: excess,
      max: excess,
      dest: "discard",
      note: opponentDiscardNote(op),
    },
  };
}

/**
 * Move `uids` from `owner`'s hand to their discard and announce what actually moved. `owner` is
 * hand, chooser and destination. Only uids in hand move, duplicates once; an empty result emits
 * nothing.
 */
export function discardChosenFromHand(
  state: GameState,
  owner: Seat,
  uids: readonly string[],
  events: GameEvent[],
): GameState {
  const side = state.players[owner];
  const inHand = new Set(side.hand);
  const discarded: string[] = [];
  const gone = new Set<string>();
  for (const uid of uids) {
    if (!inHand.has(uid) || gone.has(uid)) continue;
    gone.add(uid);
    discarded.push(uid);
  }
  if (discarded.length === 0) return state;
  events.push({ type: "FORCED_HAND_DISCARD", seat: owner, uids: [...discarded] });
  return withSide(state, owner, {
    ...side,
    hand: side.hand.filter((uid) => !gone.has(uid)),
    discard: [...side.discard, ...discarded],
  });
}

/**
 * Move `uids` from `owner`'s hand to the end of their deck and announce what moved. It does not
 * shuffle; the separate `shuffleDeck` op does. Kept separate from `discardChosenFromHand` so the
 * destination is decided at the call site.
 */
export function deckChosenFromHand(
  state: GameState,
  owner: Seat,
  uids: readonly string[],
  events: GameEvent[],
): GameState {
  const side = state.players[owner];
  const inHand = new Set(side.hand);
  const moved: string[] = [];
  const gone = new Set<string>();
  for (const uid of uids) {
    if (!inHand.has(uid) || gone.has(uid)) continue;
    gone.add(uid);
    moved.push(uid);
  }
  if (moved.length === 0) return state;
  events.push({ type: "FORCED_HAND_DISCARD", seat: owner, uids: [...moved], to: "deck" });
  return withSide(state, owner, {
    ...side,
    hand: side.hand.filter((uid) => !gone.has(uid)),
    deck: [...side.deck, ...moved],
  });
}

/**
 * Hand cards that can pay a `payFromHand`, with interchangeable copies collapsed to at most `count`
 * each. `excludeUid` is the printed "other": the Trainer paying is still in hand during the gate.
 * Collapsing at cap `count` preserves whether `count` cards are available, so gate and prompt
 * agree.
 */
export function handCostCandidates(
  state: GameState,
  seat: Seat,
  op: OpOf<"payFromHand">,
  excludeUid?: string,
): string[] {
  const kept = new Map<string, number>();
  const out: string[] = [];
  // The ceiling is `count` for the exact arm and `cap` for the declinable arm; `cap: "any"` keeps
  // every copy.
  const keepPer =
    op.count !== "any" ? op.count : op.cap === "any" ? Number.POSITIVE_INFINITY : op.cap;
  for (const uid of state.players[seat].hand) {
    if (uid === excludeUid) continue;
    const card = cardOfUid(state, uid);
    if (op.filter !== undefined && !matchesFilter(card, op.filter)) continue;
    if (op.filter === undefined && card === undefined) continue;
    const key = cardIdentity(state, uid);
    const already = kept.get(key) ?? 0;
    if (already >= keepPer) continue;
    kept.set(key, already + 1);
    out.push(uid);
  }
  return out;
}

/**
 * The first top-level `payFromHand` whose cost the seat cannot pay, or null. Checked before
 * committing a play so an unpayable card is not played. Separate from `programPlayable` because it
 * is printed text and needs the played uid. Each cost is checked against the same starting hand, so
 * it handles only one cost per program.
 */
export function handCostUnmet(
  state: GameState,
  seat: Seat,
  program: readonly EffectOp[],
  excludeUid?: string,
): OpOf<"payFromHand"> | null {
  for (const op of program) {
    if (op.op !== "payFromHand") continue;
    // A declinable "up to N" payment can always be met (paying nothing is legal), so it never
    // refuses a play.
    if (op.count === "any") continue;
    if (handCostCandidates(state, seat, op, excludeUid).length < op.count) return op;
    // The swap needs a top card to switch with.
    if (op.swapWithTop === true && state.players[seat].deck.length === 0) return op;
  }
  return null;
}

/**
 * The disjunctive search (Brock's Scouting: "up to 2 Basic Pokémon or 1 Evolution Pokémon"): one
 * park over the union whose `max` is the larger alternative, never the sum, and whose `capsAnyOf`
 * lets `validateChoice` admit an answer only when one alternative takes all of it. No candidates or
 * no room files the empty record and parks nothing.
 */
export function searchDeckOrElse(
  state: GameState,
  op: OpOf<"searchDeck">,
  alternative: { filter: CardFilter; max: number },
  ctx: EffectContext,
  record: EffectRecord,
): { done: GameState } | { park: EffectPrompt } {
  const deck = state.players[ctx.seat].deck;
  const matching = (filter: CardFilter) =>
    deck.filter((uid) => {
      const card = cardOfUid(state, uid);
      // A Bench destination asks `benchMatches`.
      return (
        card !== undefined &&
        (op.dest === "bench" ? benchMatches(card, filter) : matchesFilter(card, filter))
      );
    });
  const firstMatches = matching(op.filter);
  const firstMax =
    typeof op.max === "number"
      ? op.max
      : op.max === "any"
        ? firstMatches.length
        : state.players[ctx.seat].bench.length;
  const entries = [
    { uids: firstMatches, max: firstMax },
    { uids: matching(alternative.filter), max: alternative.max },
  ];
  const offered = new Set(entries.flatMap((entry) => entry.uids));
  const candidates = deck.filter((uid) => offered.has(uid));
  const ceiling = Math.max(firstMax, alternative.max);
  const max = op.dest === "bench" ? Math.min(ceiling, benchSpace(state, ctx.seat)) : ceiling;
  if (candidates.length === 0 || max <= 0) {
    recordMoved(record, op.recordAs, []);
    return { done: state };
  }
  return {
    park: {
      kind: "chooseCards",
      candidates,
      min: 0,
      max,
      dest: op.dest === "attachToSelf" ? "attach" : op.dest,
      capsAnyOf: entries,
      note: searchOrElseNote(op.filter, firstMax, alternative, op.dest),
    },
  };
}
