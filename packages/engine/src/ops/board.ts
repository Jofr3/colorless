import { cardOfUid, matchesFilter, topUid } from "../cards";
import {
  benchTrimStages,
  effectiveMaxHp,
  inPlayCardOf,
  inPlayToHandBlocked,
  intoPlayOnlyViaOf,
  isLethallyDamaged,
  owesToolTrim,
  remainingHpWithin,
  stageChangeConditions,
} from "../continuous";
import type { EffectContext, EffectPrompt, EffectRecord, PokemonRef } from "../effectPrompt";
import type { CardFilter, EffectOp, EffectSlot, OpOf, PokemonType } from "../effects";
import {
  discardableEnergies,
  discardableTools,
  effectRefused,
  oppAnyRefs,
  oppBenchRefs,
  ownBenchRefs,
  ownInPlayRefs,
  recorded,
  recordMoved,
  refPokemon,
  refTopCard,
  sourceRef,
  subgroupRefs,
  switchBenchNarrowing,
  unshieldedRefs,
  withBodyAt,
} from "../effectTargets";
import type { GameEvent, StatusName } from "../events";
// Import cycle with flow.ts; safe because both ends are hoisted function declarations called only
// at run time.
import { finishGame } from "../flow";
import { shuffle } from "../rng";
// Import cycle with triggers.ts; safe because both ends are hoisted function declarations called
// only at run time.
import { runActiveBenchedTriggers } from "../triggers";
import type {
  GameState,
  InPlayPokemon,
  PendingStage,
  PlayerSide,
  Seat,
  SpecialConditions,
} from "../types";
import {
  bodyAt,
  clearedAttackEffects,
  damageCountersOn,
  discardFromStack,
  koByEffectMarker,
  noConditions,
  otherSeat,
  presentStatuses,
  relativeSeat,
  stackUids,
  withSide,
} from "../types";

// Op implementations that change which bodies are where: switches and swaps, returns to hand or
// deck, devolves, Knock Outs, Stadium discards and Prize-card handling.

/**
 * Team Rocket's Blipbug — Searching Eyes: without `index`, picks a face-down Prize (parking when
 * there are two or more); with `index`, shows that card only to the looker through an `orderCards`
 * prompt, since log rows are broadcast to both seats.
 */
export function lookAtPrize(
  state: GameState,
  op: OpOf<"lookAtPrize">,
  ctx: EffectContext,
  events: GameEvent[],
): { done: GameState } | { park: EffectPrompt } {
  const owner = otherSeat(ctx.seat);
  const slots = faceDownPrizeIndices(state, owner);
  const index = op.index ?? (slots.length === 1 ? slots[0] : undefined);
  if (index === undefined) {
    if (slots.length === 0) return { done: state };
    return {
      park: {
        kind: "choosePrize",
        indices: slots,
        note: "Choose 1 of your opponent's face-down Prize cards to look at.",
      },
    };
  }
  const uid = state.players[owner].prizes[index];
  if (uid === undefined || !slots.includes(index)) return { done: state };
  events.push({ type: "PRIZE_LOOKED_AT", seat: owner, actor: ctx.seat, index });
  return {
    park: {
      kind: "orderCards",
      candidates: [uid],
      note: "You looked at this face-down Prize card. Put it back face down.",
    },
  };
}

/**
 * N's Sigilyph — Victory Symbol: the controller wins via `finishGame`, so the rest of the attack
 * never resolves.
 */
export function winGame(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const result = finishGame(
    state,
    { result: "win", winner: ctx.seat, reason: "cardEffect" },
    events,
  );
  return result.ok ? result.state : state;
}

/**
 * Yveltal ex — Soul Destroyer: dooms every opponent body with at most `atMost` HP remaining (read
 * before any doom), skipping §11-shielded ones.
 */
export function knockOutEach(
  state: GameState,
  atMost: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const inWindow = oppAnyRefs(state, ctx.seat).filter((ref) => {
    const pokemon = refPokemon(state, ref);
    return pokemon !== undefined && remainingHpWithin(state, pokemon, atMost);
  });
  return unshieldedRefs(state, inWindow, ctx, events).reduce(
    (next, ref) => doomBodyAt(next, ref, koByEffectMarker(state.turn)),
    state,
  );
}

/**
 * Palafin "Zero to Hero": search the deck for a card named `name` and switch it with the program's
 * own body in place; the old top card goes into the deck and every other field carries over. The
 * first match in deck order is taken. The deck is always shuffled, even on a failed search. Not an
 * evolution (no `onEvolve`, no `EVOLVED` row), and it is the licensed route for `intoPlayOnlyVia`.
 * No body swaps nothing and still shuffles.
 */
export function switchWithDeckNamed(
  state: GameState,
  name: string,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = ctx.seat;
  const side = state.players[seat];
  const [ref] = sourceRef(state, ctx);
  const body = ref === undefined ? undefined : refPokemon(state, ref);
  const oldTop = body === undefined ? undefined : topUid(body);
  const found = side.deck.find((uid) => cardOfUid(state, uid)?.name === name);
  if (ref === undefined || body === undefined || oldTop === undefined || found === undefined) {
    const [deck, rngState] = shuffle([...side.deck], state.rngState);
    events.push({ type: "SHUFFLE", seat });
    const searched = withSide(state, seat, { ...side, deck });
    return { ...searched, rngState };
  }
  const swapped: InPlayPokemon = { ...body, stack: [...body.stack.slice(0, -1), found] };
  const [deck, rngState] = shuffle(
    [...side.deck.filter((uid) => uid !== found), oldTop],
    state.rngState,
  );
  events.push({ type: "POKEMON_SWAPPED_FROM_DECK", seat, fromUid: oldTop, toUid: found });
  events.push({ type: "SHUFFLE", seat });
  const spot = ref.spot;
  const placed: PlayerSide =
    spot.spot === "active"
      ? { ...side, deck, active: swapped }
      : { ...side, deck, bench: side.bench.map((p, i) => (i === spot.index ? swapped : p)) };
  return { ...withSide(state, seat, placed), rngState };
}

/**
 * The uid a body carries after any in-place swap in `emitted` (Zero to Hero), or `uid` itself. Used
 * to re-key a `switchActive.recordDemoted` filing whose body was swapped into the deck; a filing
 * with `demotedAsMoved` skips the re-key.
 */
function swappedUid(uid: string, emitted: readonly GameEvent[]): string {
  let current = uid;
  for (const event of emitted) {
    if (event.type === "POKEMON_SWAPPED_FROM_DECK" && event.fromUid === current) {
      current = event.toUid;
    }
  }
  return current;
}

/**
 * Ditto "Surprisingly Transform"'s offer: deck cards passing `filter`, in deck order, one per
 * catalog card. Cards with `intoPlayOnlyVia` are never offered.
 */
export function deckSwapCandidates(state: GameState, seat: Seat, filter: CardFilter): string[] {
  const seen = new Set<string>();
  return state.players[seat].deck.filter((uid) => {
    const card = cardOfUid(state, uid);
    if (card === undefined || !matchesFilter(card, filter) || seen.has(card.id)) return false;
    if (intoPlayOnlyViaOf(card) !== undefined) return false;
    seen.add(card.id);
    return true;
  });
}

/**
 * Ditto "Surprisingly Transform": switch `found` in for the program's own body in place, the old
 * top card into the deck, and shuffle on every ending. A card no longer in the deck, or a body that
 * left play, swaps nothing and still shuffles.
 */
export function switchWithDeckCard(
  state: GameState,
  found: string | undefined,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = ctx.seat;
  const side = state.players[seat];
  const [ref] = sourceRef(state, ctx);
  const body = ref === undefined ? undefined : refPokemon(state, ref);
  const oldTop = body === undefined ? undefined : topUid(body);
  if (
    ref === undefined ||
    body === undefined ||
    oldTop === undefined ||
    found === undefined ||
    !side.deck.includes(found)
  ) {
    const [deck, rngState] = shuffle([...side.deck], state.rngState);
    events.push({ type: "SHUFFLE", seat });
    const unswapped = withSide(state, seat, { ...side, deck });
    return { ...unswapped, rngState };
  }
  const switched: InPlayPokemon = { ...body, stack: [...body.stack.slice(0, -1), found] };
  const [deck, rngState] = shuffle(
    [...side.deck.filter((uid) => uid !== found), oldTop],
    state.rngState,
  );
  events.push({ type: "POKEMON_SWAPPED_FROM_DECK", seat, toUid: found, fromUid: oldTop });
  events.push({ type: "SHUFFLE", seat });
  return { ...withBodyAt(withSide(state, seat, { ...side, deck }), ref, switched), rngState };
}

/**
 * Ogre's Mask's first offer: the controller's in-play bodies (Active first) whose top card passes
 * `filter`. Exported for `programPlayable`, which refuses the card on an empty offer.
 */
export function swapBodies(state: GameState, seat: Seat, filter: CardFilter): PokemonRef[] {
  return ownInPlayRefs(state, seat).filter((ref) => {
    const body = refPokemon(state, ref);
    // The in-play card, for a typed filter.
    const top = body === undefined ? undefined : inPlayCardOf(state, body);
    return top !== undefined && matchesFilter(top, filter);
  });
}

/** Ogre's Mask's second offer: discard-pile cards passing `filter`, in pile order. */
export function swapDiscardCards(state: GameState, seat: Seat, filter: CardFilter): string[] {
  return state.players[seat].discard.filter((uid) => {
    const card = cardOfUid(state, uid);
    return card !== undefined && matchesFilter(card, filter);
  });
}

/**
 * Ogre's Mask's body answer (forced or parked): asks question two narrowed to that body by its top
 * uid. No body at the ref does nothing.
 */
export function swapBodyAnswered(
  state: GameState,
  op: OpOf<"switchWithDiscardNamed">,
  ref: PokemonRef,
): EffectOp[] {
  const body = refPokemon(state, ref);
  const uid = body === undefined ? undefined : topUid(body);
  return uid === undefined ? [] : [{ ...op, bodyUid: uid }];
}

/**
 * Ogre's Mask swap: the body whose top uid is `bodyUid` gets `cardUid` from the discard pile on top
 * in place; every other field carries over and the old top card goes to the discard pile. No
 * shuffle, and not an evolution. A lower HP can leave the body KO'd; `settleProgram`'s mid-turn
 * sweep handles it. The new card's once-per-turn Abilities are fresh. A departed body or missing
 * card swaps nothing.
 */
export function switchWithDiscard(
  state: GameState,
  bodyUid: string,
  cardUid: string,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = ctx.seat;
  const side = state.players[seat];
  const ref = ownInPlayRefs(state, seat).find((candidate) => {
    const body = refPokemon(state, candidate);
    return body !== undefined && topUid(body) === bodyUid;
  });
  const body = ref === undefined ? undefined : refPokemon(state, ref);
  if (ref === undefined || body === undefined || !side.discard.includes(cardUid)) return state;
  const swapped: InPlayPokemon = { ...body, stack: [...body.stack.slice(0, -1), cardUid] };
  const discard = [...side.discard.filter((uid) => uid !== cardUid), bodyUid];
  events.push({ type: "POKEMON_SWAPPED_FROM_DISCARD", seat, fromUid: bodyUid, toUid: cardUid });
  const spot = ref.spot;
  const placed: PlayerSide =
    spot.spot === "active"
      ? { ...side, discard, active: swapped }
      : { ...side, discard, bench: side.bench.map((p, i) => (i === spot.index ? swapped : p)) };
  return withSide(state, seat, placed);
}

/**
 * Take a benched `ref` (either board) with all attached cards into its owner's `dest`. The owner is
 * `ref.seat`, not `ctx.seat`. The Bench compacts. The deck arm shuffles the owner's deck and emits
 * its own shuffle.
 */
export function returnBenched(
  state: GameState,
  ref: PokemonRef,
  op: OpOf<"returnBenched">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  // The Active is reachable only under `includeActive`. The spot is left empty; promotion or loss
  // is handled by the mid-turn sweep. On the opponent side the Active is the opponent's.
  const activeOwner = relativeSeat(ctx.seat, op.whose !== "self");
  if (ref.spot.spot === "active" && op.includeActive === true && ref.seat === activeOwner) {
    return returnOwnActive(state, ref.seat, op, ctx, events);
  }
  // Not a bench ref: a silent no-op, since the op validates refs.
  if (ref.spot.spot !== "bench") return state;
  const owner = ref.seat;
  const side = state.players[owner];
  const index = ref.spot.index;
  const body = side.bench[index];
  if (body === undefined) return state;
  const uid = topUid(body);
  if (uid === undefined) return state;
  // Milotic "Mentally Calm" on the owner's opposing side: a hand return fails and the body stays.
  if (op.dest === "hand" && inPlayToHandBlocked(state, owner)) return state;
  const uids = stackUids(body);
  const bench = [...side.bench.slice(0, index), ...side.bench.slice(index + 1)];
  events.push({ type: "POKEMON_RETURNED", seat: owner, uid, actor: ctx.seat, dest: op.dest, uids });
  if (op.dest === "hand") {
    return withSide(state, owner, { ...side, bench, hand: [...side.hand, ...uids] });
  }
  const [deck, rngState] = shuffle([...side.deck, ...uids], state.rngState);
  events.push({ type: "SHUFFLE", seat: owner });
  return { ...withSide(state, owner, { ...side, bench, deck }), rngState };
}

/**
 * `returnBenched`'s Active arm: move `owner`'s Active with attachments to `op.dest` and leave the
 * spot empty for promotion.
 */
function returnOwnActive(
  state: GameState,
  owner: Seat,
  op: OpOf<"returnBenched">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[owner];
  const body = side.active;
  if (body === null) return state;
  const uid = topUid(body);
  if (uid === undefined) return state;
  // Milotic guard: the body stays Active.
  if (op.dest === "hand" && inPlayToHandBlocked(state, owner)) return state;
  const pile = stackUids(body);
  events.push({
    type: "POKEMON_RETURNED",
    seat: owner,
    uid,
    actor: ctx.seat,
    dest: op.dest,
    uids: pile,
  });
  if (op.dest === "hand") {
    return withSide(state, owner, { ...side, active: null, hand: [...side.hand, ...pile] });
  }
  const [deck, shuffled] = shuffle([...side.deck, ...pile], state.rngState);
  events.push({ type: "SHUFFLE", seat: owner });
  return { ...withSide(state, owner, { ...side, active: null, deck }), rngState: shuffled };
}

/**
 * Shuffle every ref in `refs` (with attachments) from one seat's Bench into that seat's deck as a
 * single shuffle. Not a loop over `returnBenched`, which removes by index and would hit wrong
 * bodies after compaction. All refs are gathered before splicing, and splices go in descending
 * index order, which is only correct because all refs are on one seat. Emits one `POKEMON_RETURNED`
 * per body in board order and exactly one `SHUFFLE`.
 */
export function shuffleBenchedRefsIntoDeck(
  state: GameState,
  refs: readonly PokemonRef[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const first = refs[0];
  // An EMPTY complement is a silent no-op and not an empty shuffle: the printed
  // sentence moved nothing, so the deck must not be re-ordered and no row filed.
  if (first === undefined) return state;
  // THE SINGLE-SEAT PRECONDITION, enforced rather than assumed (see the block above).
  const owner = first.seat;
  const side = state.players[owner];
  // ── GATHER (no mutation past this point until every read is done) ────────────
  const gathered: { index: number; uid: string; uids: string[] }[] = [];
  for (const ref of refs) {
    if (ref.seat !== owner || ref.spot.spot !== "bench") continue;
    const body = side.bench[ref.spot.index];
    if (body === undefined) continue; // the wire answer's body has since left play
    const uid = topUid(body);
    if (uid === undefined) continue;
    gathered.push({ index: ref.spot.index, uid, uids: stackUids(body) });
  }
  if (gathered.length === 0) return state;
  // ── APPLY: strictly DESCENDING, so no surviving index shifts under a removal ──
  let bench = side.bench;
  for (const { index } of [...gathered].sort((a, b) => b.index - a.index)) {
    bench = [...bench.slice(0, index), ...bench.slice(index + 1)];
  }
  // Sort into board order so click order does not affect the log, the deck or `rngState`.
  gathered.sort((a, b) => a.index - b.index);
  const moved: string[] = [];
  for (const body of gathered) {
    events.push({
      type: "POKEMON_RETURNED",
      seat: owner,
      uid: body.uid,
      actor: ctx.seat,
      dest: "deck",
      uids: body.uids,
    });
    moved.push(...body.uids);
  }
  const [deck, rngState] = shuffle([...side.deck, ...moved], state.rngState);
  events.push({ type: "SHUFFLE", seat: owner });
  return { ...withSide(state, owner, { ...side, bench, deck }), rngState };
}

/** The controller's first body (Active, then Bench) that `owesToolTrim`, with its ref. */
export function overCapToolBody(
  state: GameState,
  seat: Seat,
): { body: InPlayPokemon; ref: PokemonRef } | undefined {
  const side = state.players[seat];
  const refs: { body: InPlayPokemon; ref: PokemonRef }[] = [
    ...(side.active === null
      ? []
      : [{ body: side.active, ref: { seat, spot: { spot: "active" as const } } }]),
    ...side.bench.map((body, index) => ({
      body,
      ref: { seat, spot: { spot: "bench" as const, index } },
    })),
  ];
  return refs.find(({ body }) => owesToolTrim(state, seat, body));
}

/**
 * Multi Adapter's discard: the named own Tools go to the controller's discard, one
 * `TOOLS_DISCARDED` per host. Unknown uids are ignored.
 */
export function trimToolsApply(
  state: GameState,
  uids: readonly string[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const picks = new Set(uids);
  const side = state.players[ctx.seat];
  const discarded: string[] = [];
  const strip = (pokemon: InPlayPokemon): InPlayPokemon => {
    const taken = pokemon.tools.filter((uid) => picks.has(uid));
    if (taken.length === 0) return pokemon;
    discarded.push(...taken);
    events.push({
      type: "TOOLS_DISCARDED",
      seat: ctx.seat,
      actor: ctx.seat,
      uids: taken,
      host: topUid(pokemon) ?? "",
      when: "trimmed",
    });
    return { ...pokemon, tools: pokemon.tools.filter((uid) => !picks.has(uid)) };
  };
  const active = side.active === null ? null : strip(side.active);
  const bench = side.bench.map(strip);
  if (discarded.length === 0) return state;
  return withSide(state, ctx.seat, {
    ...side,
    active,
    bench,
    discard: [...side.discard, ...discarded],
  });
}

/**
 * Discard the named benched bodies with their whole stacks (not a Knock Out, no Prize), gathering
 * before splicing, with one `BENCH_TRIMMED` row.
 */
export function discardBenchedRefs(
  state: GameState,
  refs: readonly PokemonRef[],
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  let side = state.players[ctx.seat];
  const picked = new Set(
    refs
      .filter((ref) => ref.seat === ctx.seat && ref.spot.spot === "bench")
      .map((ref) => (ref.spot.spot === "bench" ? ref.spot.index : -1)),
  );
  const tops: string[] = [];
  const discarded: string[] = [];
  const kept: InPlayPokemon[] = [];
  side.bench.forEach((body, index) => {
    if (!picked.has(index)) {
      kept.push(body);
      return;
    }
    const cleanup = discardFromStack(side, body, "all");
    side = cleanup.side;
    tops.push(topUid(body) ?? "");
    discarded.push(...cleanup.discarded);
  });
  if (tops.length === 0) return state;
  events.push({ type: "BENCH_TRIMMED", seat: ctx.seat, uids: tops, discarded });
  return withSide(state, ctx.seat, { ...side, bench: kept });
}

/**
 * Take the program's own body with all attachments off the board. Unlike `returnBenched` it can
 * reach the Active; the resulting empty spot is promoted by `resolveMidTurnKnockOuts`. A missing
 * body is a silent no-op. `op.dest` is where the body pile goes and `op.attachmentsTo` optionally
 * redirects attachments; piles are gathered first so the deck is shuffled at most once.
 */
export function returnSelf(
  state: GameState,
  op: OpOf<"returnSelf">,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const [ref] = sourceRef(state, ctx);
  if (ref === undefined) return state;
  const seat = ctx.seat;
  const side = state.players[seat];
  const body = bodyAt(side, ref.spot);
  if (body === undefined) return state;
  const uid = topUid(body);
  if (uid === undefined) return state;
  const uids = stackUids(body);
  const emptied =
    ref.spot.spot === "active"
      ? { ...side, active: null }
      : {
          ...side,
          bench: [...side.bench.slice(0, ref.spot.index), ...side.bench.slice(ref.spot.index + 1)],
        };
  const dest = op.dest ?? "deck";
  // Milotic "Mentally Calm" opposite: returning to hand fails and everything stays in play.
  if (dest === "hand" && inPlayToHandBlocked(state, seat)) return state;
  const attached = [...body.energy, ...body.tools];
  const split = op.attachmentsTo !== undefined && op.attachmentsTo !== dest;
  const bodyPile = split ? [...body.stack] : uids;
  const zones: Record<"deck" | "deckTop" | "hand" | "discard", string[]> = {
    deck: [],
    deckTop: [],
    hand: [],
    discard: [],
  };
  zones[dest].push(...bodyPile);
  if (split) zones[op.attachmentsTo as "discard"].push(...attached);
  events.push(
    split
      ? {
          type: "POKEMON_RETURNED",
          seat,
          uid,
          actor: seat,
          dest,
          uids,
          attachmentsTo: { dest: op.attachmentsTo as "discard", uids: attached },
        }
      : { type: "POKEMON_RETURNED", seat, uid, actor: seat, dest, uids },
  );
  // `"deckTop"` prepends without shuffling.
  const placed = {
    ...emptied,
    deck: [...zones.deckTop, ...emptied.deck],
    hand: [...emptied.hand, ...zones.hand],
    discard: [...emptied.discard, ...zones.discard],
  };
  if (zones.deck.length === 0) return withSide(state, seat, placed);
  const [deck, rngState] = shuffle([...placed.deck, ...zones.deck], state.rngState);
  events.push({ type: "SHUFFLE", seat });
  return { ...withSide(state, seat, { ...placed, deck }), rngState };
}

/**
 * The opponent's evolved bodies (`stack.length >= 2`), Active first then Bench, shared by
 * `devolveEach` and `devolveChosen`. The §11 shield is applied by callers to this set, never the
 * whole board.
 */
export function devolveTargets(state: GameState, seat: Seat): PokemonRef[] {
  return oppAnyRefs(state, seat).filter((ref) => {
    const side = state.players[ref.seat];
    const spot = ref.spot;
    const target = bodyAt(side, spot);
    return target !== undefined && target.stack.length >= 2;
  });
}

/**
 * The body after shedding its top card, shared by both devolve ops so their §10/§12 clears cannot
 * drift.
 */
function devolvedBodyOf(body: InPlayPokemon, kept: SpecialConditions): InPlayPokemon {
  return {
    ...body,
    // "the highest Stage Evolution card" — ONE card off the top, not the whole
    // stack: a Stage 2 devolves to its Stage 1 (or, after a Rare Candy, to its
    // Basic). `evolveOnto`'s APPEND read backwards.
    stack: body.stack.slice(0, -1),
    // §12: devolving removes Special Conditions, except those in `kept` (Confused under Dizzying
    // Valley).
    conditions: kept,
    // §10: also shed the effects of attacks.
    ...clearedAttackEffects(),
    // …and the evolution stamp, which belongs to the card that left. See
    // `devolveEach`'s block for why this is `null` and why `turnPlayed` and `markers`
    // are NOT touched (clearing `markers` would erase the `koByEffect` stamp for a
    // body §8.1 is about to collect — the one copy that would be a live defect).
    evolvedTurn: null,
  };
}

/**
 * §10: devolve each of the opponent's evolved Pokémon, shuffling the top card into the opponent's
 * deck. Shielded bodies are filtered out, not refusing the whole op. `turnPlayed` and `markers` are
 * kept; `evolvedTurn` is nulled. A body made lethal by its maximum dropping is stamped
 * `koByEffect`, but only if it was not already lethal; lethality is read on the committed board so
 * seat-wide HP auras apply. One `SHUFFLE` for the sweep, into the owner's deck.
 */
export function devolveEach(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const owner = otherSeat(ctx.seat);
  // Narrow to evolved bodies before asking §11, so no refusal is logged for a body this op would
  // never touch.
  const evolvedRefs = devolveTargets(state, ctx.seat);
  const refs = unshieldedRefs(state, evolvedRefs, ctx, events);
  const devolved: {
    ref: PokemonRef;
    body: InPlayPokemon;
    from: string;
    cleared: StatusName[];
    wasLethal: boolean;
  }[] = [];
  const returned: string[] = [];
  for (const ref of refs) {
    const side = state.players[ref.seat];
    const spot = ref.spot;
    const body = bodyAt(side, spot);
    // Not in play — unreachable (`evolvedRefs` just read every one of these bodies),
    // and a silent skip rather than a throw for the reason every ref guard in this
    // file is: the op validates refs. The "evolved" filter is NOT repeated here; it
    // lives in `evolvedRefs` alone, so the printed candidate set has ONE spelling and
    // the refusal rows above cannot disagree with the bodies this loop collects.
    if (body === undefined) continue;
    const from = body.stack[body.stack.length - 1];
    if (from === undefined) continue;
    devolved.push({
      ref,
      from,
      // Less the Confusion Dizzying Valley keeps.
      cleared: presentStatuses(body.conditions).filter(
        (status) =>
          !presentStatuses(stageChangeConditions(state, body.conditions)).includes(status),
      ),
      wasLethal: isLethallyDamaged(state, body),
      body: devolvedBodyOf(body, stageChangeConditions(state, body.conditions)),
    });
    returned.push(from);
  }
  if (devolved.length === 0) return state;

  let next = state;
  for (const entry of devolved) {
    const side = next.players[entry.ref.seat];
    const spot = entry.ref.spot;
    next = withSide(
      next,
      entry.ref.seat,
      spot.spot === "active"
        ? { ...side, active: entry.body }
        : {
            ...side,
            bench: side.bench.map((pokemon, i) => (i === spot.index ? entry.body : pokemon)),
          },
    );
    // The new stack top. `undefined` is unreachable — the slice left at least one card
    // behind — and an empty string would be a uid no client can render, so the `??` is
    // a total-function tail rather than a case.
    const to = entry.body.stack[entry.body.stack.length - 1] ?? entry.from;
    events.push({
      type: "POKEMON_DEVOLVED",
      seat: entry.ref.seat,
      actor: ctx.seat,
      from: entry.from,
      to,
    });
    // §10/§12 — announced only when there was something to remove, `evolveOnto`'s rule
    // verbatim; `uid` is the NEW top (events.ts).
    if (entry.cleared.length > 0) {
      events.push({
        type: "STATUS_CLEARED",
        seat: entry.ref.seat,
        uid: to,
        statuses: entry.cleared,
        reason: "devolved",
      });
    }
  }
  // The whole pile in ONE move, so the deck is touched at most once.
  const ownerSide = next.players[owner];
  const [deck, rngState] = shuffle([...ownerSide.deck, ...returned], next.rngState);
  next = { ...withSide(next, owner, { ...ownerSide, deck }), rngState };
  events.push({ type: "SHUFFLE", seat: owner });

  // Read from the committed board: `seatMaxHpBonus` finds the body among those in play.
  for (const entry of devolved) {
    if (entry.wasLethal) continue;
    const side = next.players[entry.ref.seat];
    const spot = entry.ref.spot;
    const body = bodyAt(side, spot);
    if (body === undefined) continue;
    if (!isLethallyDamaged(next, body)) continue;
    const marker = koByEffectMarker(next.turn);
    // Idempotent, `doomBodyAt`'s contract: a body already carrying this turn's stamp
    // is left alone rather than given a duplicate.
    if (body.markers.includes(marker)) continue;
    const marked: InPlayPokemon = { ...body, markers: [...body.markers, marker] };
    next = withSide(
      next,
      entry.ref.seat,
      spot.spot === "active"
        ? { ...side, active: marked }
        : { ...side, bench: side.bench.map((p, i) => (i === spot.index ? marked : p)) },
    );
  }
  return next;
}

/**
 * Devolve one chosen body, putting its top card into its owner's hand. No shuffle and no rng. The
 * hand is read from `ref.seat`. Lethality uses `devolveEach`'s committed-board read and `wasLethal`
 * check.
 */
export function devolveBodyToHand(
  state: GameState,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ref.seat];
  const spot = ref.spot;
  const body = bodyAt(side, spot);
  // Not in play, or nothing to shed — a silent no-op rather than a throw, for the
  // reason every ref guard in this file is: the op validates refs, and a wire answer
  // whose body has since left play moves nothing (`returnBenched`'s trust level).
  if (body === undefined) return state;
  // Milotic "Mentally Calm" opposite the owner: the devolution fails whole and nothing is shed.
  if (inPlayToHandBlocked(state, ref.seat)) return state;
  const from = body.stack[body.stack.length - 1];
  if (from === undefined) return state;
  // Keep what the devolved top retains (Dizzying Valley's Confused) and clear the rest.
  const kept = stageChangeConditions(state, body.conditions);
  const cleared = presentStatuses(body.conditions).filter(
    (status) => !presentStatuses(kept).includes(status),
  );
  const wasLethal = isLethallyDamaged(state, body);
  const devolved = devolvedBodyOf(body, kept);
  let next = withSide(
    state,
    ref.seat,
    spot.spot === "active"
      ? { ...side, active: devolved }
      : {
          ...side,
          bench: side.bench.map((pokemon, i) => (i === spot.index ? devolved : pokemon)),
        },
  );
  // …and the card into the OWNER's hand. Re-read off `next`, because the line above
  // just replaced that whole side.
  const ownerSide = next.players[ref.seat];
  next = withSide(next, ref.seat, { ...ownerSide, hand: [...ownerSide.hand, from] });
  // The new stack top. `undefined` is unreachable — the slice left at least one card
  // behind — and an empty string would be a uid no client can render, so the `??` is
  // a total-function tail rather than a case (`devolveEach`'s line verbatim).
  const to = devolved.stack[devolved.stack.length - 1] ?? from;
  events.push({
    type: "POKEMON_DEVOLVED",
    seat: ref.seat,
    actor: ctx.seat,
    from,
    to,
    // The destination rider: otherwise nothing would announce that the card went to hand.
    zone: "hand",
  });
  // §10/§12 — announced only when there was something to remove, `evolveOnto`'s rule
  // verbatim; `uid` is the NEW top (events.ts).
  if (cleared.length > 0) {
    events.push({
      type: "STATUS_CLEARED",
      seat: ref.seat,
      uid: to,
      statuses: cleared,
      reason: "devolved",
    });
  }
  // Read from the committed board.
  if (wasLethal) return next;
  const committed = next.players[ref.seat];
  const live = bodyAt(committed, spot);
  if (live === undefined) return next;
  if (!isLethallyDamaged(next, live)) return next;
  const marker = koByEffectMarker(next.turn);
  // Idempotent, `doomBodyAt`'s contract: a body already carrying this turn's stamp is
  // left alone rather than given a duplicate.
  if (live.markers.includes(marker)) return next;
  const marked: InPlayPokemon = { ...live, markers: [...live.markers, marker] };
  return withSide(
    next,
    ref.seat,
    spot.spot === "active"
      ? { ...committed, active: marked }
      : { ...committed, bench: committed.bench.map((p, i) => (i === spot.index ? marked : p)) },
  );
}

/**
 * `devolveEach.toHand` (Espeon "Miraculous Shine"): devolve each unshielded evolved body to hand in
 * board order, no shuffle. `wasLethal` is read on the starting board and the stamp on the committed
 * board after the whole sweep, so stamping does not depend on board order.
 */
export function devolveEachToHand(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const refs = unshieldedRefs(state, devolveTargets(state, ctx.seat), ctx, events);
  const lethalBefore = refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = bodyAt(side, ref.spot);
    return body === undefined || isLethallyDamaged(state, body);
  });
  let next = state;
  for (const ref of refs) next = devolveBodyToHand(next, ref, ctx, events);
  // Stamp on the committed board after the whole sweep.
  refs.forEach((ref, i) => {
    if (lethalBefore[i] === true) return;
    const side = next.players[ref.seat];
    const spot = ref.spot;
    const body = bodyAt(side, spot);
    if (body === undefined) return;
    if (!isLethallyDamaged(next, body)) return;
    const marker = koByEffectMarker(next.turn);
    if (body.markers.includes(marker)) return;
    const marked: InPlayPokemon = { ...body, markers: [...body.markers, marker] };
    next = withSide(
      next,
      ref.seat,
      spot.spot === "active"
        ? { ...side, active: marked }
        : { ...side, bench: side.bench.map((p, j) => (j === spot.index ? marked : p)) },
    );
  });
  return next;
}

/**
 * Strange Timepiece's offer: the controller's own evolved bodies whose top card has `pokemonType`,
 * Active first then Bench. No §11 pass: a shield does not stop the controller's own Item.
 */
export function ownDevolveTargets(
  state: GameState,
  seat: Seat,
  pokemonType?: PokemonType,
): PokemonRef[] {
  return ownInPlayRefs(state, seat).filter((ref) => {
    const body = refPokemon(state, ref);
    if (body === undefined || body.stack.length < 2) return false;
    if (pokemonType === undefined) return true;
    const uid = topUid(body);
    const card =
      inPlayCardOf(state, body) ?? (uid === undefined ? undefined : cardOfUid(state, uid));
    return (card?.types ?? []).includes(pokemonType);
  });
}

/**
 * Whether Strange Timepiece can act: some own body is on offer and an opposing Milotic "Mentally
 * Calm" does not block the hand return.
 */
export function ownDevolveAvailable(
  state: GameState,
  seat: Seat,
  pokemonType?: PokemonType,
): boolean {
  return (
    ownDevolveTargets(state, seat, pokemonType).length > 0 && !inPlayToHandBlocked(state, seat)
  );
}

/**
 * Strange Timepiece's own-side pick, answered. `n` is the Evolution cards on the body. With one
 * card or no `depth`, shed 1; otherwise with `depth: "any"`, ask how many (at least 1).
 */
export function ownDevolveAnswered(
  state: GameState,
  ref: PokemonRef,
  op: OpOf<"devolveChosen">,
): EffectOp[] {
  const body = refPokemon(state, ref);
  const uid = body === undefined ? undefined : topUid(body);
  if (body === undefined || uid === undefined || body.stack.length < 2) return [];
  const shedOp = (shed: number): EffectOp => ({
    op: "devolveChosen",
    whose: "self",
    bodyUid: uid,
    shed,
  });
  const n = op.depth === "any" ? body.stack.length - 1 : 1;
  const cards = (k: number) => (k === 1 ? "1 Evolution card" : `${k} Evolution cards`);
  const chain = (k: number): EffectOp =>
    k === n
      ? shedOp(k)
      : {
          op: "optional",
          note: "Put how many Evolution cards on it into your hand?",
          labels: {
            yes: cards(k),
            no: k + 1 === n ? cards(n) : `${k + 1} to ${n} Evolution cards`,
          },
          then: [shedOp(k)],
          otherwise: [chain(k + 1)],
        };
  return [chain(1)];
}

/**
 * Shed the top `shed` cards of the body whose top uid is `bodyUid` to its owner's hand, never below
 * its Basic. A body that shed anything gets `turnPlayed = state.turn` so it can't evolve this turn.
 */
export function shedOwnBody(
  state: GameState,
  ctx: EffectContext,
  bodyUid: string,
  shed: number,
  events: GameEvent[],
): GameState {
  const ref = ownInPlayRefs(state, ctx.seat).find((r) => {
    const own = refPokemon(state, r);
    return own !== undefined && topUid(own) === bodyUid;
  });
  if (ref === undefined) return state;
  let next = state;
  for (let i = 0; i < shed; i++) {
    const body = refPokemon(next, ref);
    if (body === undefined || body.stack.length < 2) break;
    const after = devolveBodyToHand(next, ref, ctx, events);
    if (after === next) break;
    next = after;
  }
  if (next === state) return state;
  const body = refPokemon(next, ref);
  if (body === undefined) return next;
  const stamped: InPlayPokemon = { ...body, turnPlayed: next.turn };
  const side = next.players[ref.seat];
  const spot = ref.spot;
  return withSide(
    next,
    ref.seat,
    spot.spot === "active"
      ? { ...side, active: stamped }
      : { ...side, bench: side.bench.map((p, i) => (i === spot.index ? stamped : p)) },
  );
}

/**
 * Blowtorch's offered branches: a branch is offered when its op has a target. The §11 shield is not
 * asked here.
 */
export function offeredBranches(
  state: GameState,
  seat: Seat,
  op: OpOf<"chooseOneOffered">,
): { label: string; op: EffectOp }[] {
  const acts = (branch: EffectOp): boolean => {
    if (branch.op === "discardTools")
      return discardableTools(state, seat, branch.sides, branch.bodyUid).length > 0;
    if (branch.op === "discardEnergy") return discardableEnergies(state, seat, branch).length > 0;
    if (branch.op === "discardStadium") return state.stadium !== null;
    return true;
  };
  return op.branches.flatMap((branch, i) =>
    acts(branch) ? [{ label: op.labels[i] ?? "", op: branch }] : [],
  );
}

/**
 * The offered branches as a labelled binary chain: `yes` is the first, `no` the rest, recursively.
 */
export function chooseOneChain(
  note: string,
  offered: readonly { label: string; op: EffectOp }[],
): EffectOp[] {
  const [first, ...rest] = offered;
  if (first === undefined) return [];
  if (rest.length === 0) return [first.op];
  return [
    {
      op: "optional",
      note,
      labels: { yes: first.label, no: rest.map((b) => b.label).join(" or ") },
      then: [first.op],
      otherwise: chooseOneChain(note, rest),
    },
  ];
}

/**
 * "If you use this Ability, this Pokémon is Knocked Out." Marks the body lethal rather than
 * removing it, so the §8.1 sweep handles Prizes, discard and promotion. `effectiveMaxHp` is read
 * when the op runs. No event; `KNOCKED_OUT` follows. A missing body is a no-op.
 */
export function knockOutSelf(state: GameState, ctx: EffectContext): GameState {
  const [ref] = sourceRef(state, ctx);
  if (ref === undefined) return state;
  // No marker: the body is this op's own host.
  return doomBodyAt(state, ref);
}

/**
 * Mark one in-play body lethal by setting damage to its effective max HP; the §8.1 sweep does the
 * rest. `marker` records that lethality was not caused by damage. §11 is checked by callers. A body
 * with no printed HP is left alone. The stamp is idempotent.
 */
export function doomBodyAt(state: GameState, ref: PokemonRef, marker?: string): GameState {
  const side = state.players[ref.seat];
  const spot = ref.spot;
  const body = bodyAt(side, spot);
  if (body === undefined) return state;
  const hp = effectiveMaxHp(state, body);
  if (hp === null) return state;
  const doomed: InPlayPokemon = {
    ...body,
    damage: Math.max(body.damage, hp),
    ...(marker === undefined || body.markers.includes(marker)
      ? {}
      : { markers: [...body.markers, marker] }),
  };
  return withSide(
    state,
    ref.seat,
    spot.spot === "active"
      ? { ...side, active: doomed }
      : { ...side, bench: side.bench.map((pokemon, i) => (i === spot.index ? doomed : pokemon)) },
  );
}

/**
 * Knock Out the defender's Active by marking it lethal with the `koByEffect` marker, so "Knocked
 * Out by damage" readers don't treat it as damage. Asks §11, since it is an attack effect on the
 * Defending Pokémon. An empty Active spot is a no-op.
 */
export function knockOutDefender(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  if (state.players[seat].active === null) return state;
  if (effectRefused(state, seat, ctx, events)) return state;
  // The §11 guard runs before the max-HP read.
  return doomBodyAt(state, { seat, spot: { spot: "active" } }, koByEffectMarker(state.turn));
}

/**
 * Discard the opponent's Active and all attached cards without a Knock Out (Moltres ex): no Prize,
 * no `KNOCKED_OUT`. §11 refuses the whole op. Cards go to the defender's discard. Promotion is
 * handled by `finishAttack`'s `orphanedPromotions`. An empty Active spot is a no-op.
 */
export function discardDefender(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = otherSeat(ctx.seat);
  const side = state.players[seat];
  const active = side.active;
  if (active === null) return state;
  if (effectRefused(state, seat, ctx, events)) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const cleanup = discardFromStack(side, active, "all");
  events.push({
    type: "POKEMON_RETURNED",
    seat,
    uid,
    actor: ctx.seat,
    dest: "discard",
    uids: cleanup.discarded,
  });
  return withSide(state, seat, { ...cleanup.side, active: null });
}

/**
 * Discard the Stadium to its owner's discard pile (not `ctx.seat`'s). An empty zone emits nothing.
 */
export function discardStadium(state: GameState, events: GameEvent[]): GameState {
  const stadium = state.stadium;
  if (stadium === null) return state;
  const ownerSide = state.players[stadium.owner];
  const next = withSide(state, stadium.owner, {
    ...ownerSide,
    discard: [...ownerSide.discard, stadium.uid],
  });
  // Card revision B22 — `cause: "effect"`: nothing replaced it, the zone is now empty.
  events.push({
    type: "STADIUM_DISCARDED",
    seat: stadium.owner,
    uid: stadium.uid,
    cause: "effect",
  });
  // The zone is cleared LAST, off `next`, so the pile update and the vacancy are one
  // reduction — nothing can observe a Stadium that is in neither place.
  return { ...next, stadium: null };
}

/**
 * Area Zero Underdepths leaving play: both players trim their Bench to 5, the owner first. The
 * owner is read from `before`, and the trims go at the front of `pending`.
 */
export function queueStadiumLeaveTrims(before: GameState, after: GameState): GameState {
  if (before.stadium === null) return after;
  const trims = benchTrimStages(after, before.stadium.owner, after.pending);
  return trims.length === 0 ? after : { ...after, pending: [...trims, ...after.pending] };
}

/**
 * Queue a `takePrizes` stage for an attack's "take a Prize card"; `advance` does the work. The seat
 * is `ctx.seat`. The stage is spliced ahead of the attack's queued tail so it resolves before the
 * Knock Out sweep; with no tail it is appended. No clamp or win check here; `advance` handles both.
 */
export function queueTakePrize(
  state: GameState,
  ctx: EffectContext,
  count: number,
  thenShuffleHand: boolean,
): GameState {
  const taken: PendingStage = { kind: "takePrizes", seat: ctx.seat, count };
  // Celebration: the hand-shuffle stage goes directly behind the Prize stage, so it runs once the
  // Prizes are in hand.
  const prize: PendingStage[] = thenShuffleHand
    ? [taken, { kind: "shuffleHandIntoDeck", seat: ctx.seat }]
    : [taken];
  const tail = state.pending.findIndex(
    (queued) =>
      queued.kind === "damagedTrigger" ||
      queued.kind === "koToolTrigger" ||
      queued.kind === "attackEpilogue",
  );
  return {
    ...state,
    pending:
      tail === -1
        ? [...state.pending, ...prize]
        : [...state.pending.slice(0, tail), ...prize, ...state.pending.slice(tail)],
  };
}

/**
 * Turn one face-down Prize face up, of the controller's row or the opponent's (`side: "opponent"`).
 * The player picks rather than the engine. Zero face-down prizes is a silent no-op, one is forced,
 * more parks a choice inside the confirm's `then`.
 */
export function turnPrizeFaceUp(
  state: GameState,
  op: OpOf<"turnPrizeFaceUp">,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): { done: GameState } | { park: EffectPrompt } {
  const owner = relativeSeat(ctx.seat, op.side === "opponent");
  const indices = faceDownPrizeIndices(state, owner);
  if (indices.length === 0) return { done: state };
  if (indices.length === 1)
    return { done: turnPrizeFaceUpAt(state, indices[0] ?? -1, op, ctx, events, record) };
  return {
    park: {
      kind: "choosePrize",
      indices,
      // The note names whose row is being chosen.
      note:
        owner === ctx.seat
          ? "Choose 1 of your face-down Prize cards to turn face up."
          : "Choose 1 of your opponent's face-down Prize cards to turn face up.",
    },
  };
}

/** The face-down slots of `seat`'s prize row, in row order. */
function faceDownPrizeIndices(state: GameState, seat: Seat): number[] {
  const side = state.players[seat];
  const indices: number[] = [];
  side.prizes.forEach((uid, index) => {
    if (!side.faceUpPrizes.includes(uid)) indices.push(index);
  });
  return indices;
}

/**
 * Apply the chosen slot: append its uid to `faceUpPrizes` and emit `PRIZE_TURNED_FACE_UP`. An
 * out-of-range or already face-up index does nothing.
 */
export function turnPrizeFaceUpAt(
  state: GameState,
  index: number,
  op: OpOf<"turnPrizeFaceUp">,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const owner = relativeSeat(ctx.seat, op.side === "opponent");
  const side = state.players[owner];
  const uid = side.prizes[index];
  if (uid === undefined || side.faceUpPrizes.includes(uid)) return state;
  // `actor` is set only when the row is not the controller's; the turned uid is recorded for
  // Bother-Bot's switch.
  events.push({
    type: "PRIZE_TURNED_FACE_UP",
    seat: owner,
    index,
    uid,
    ...(owner === ctx.seat ? {} : { actor: ctx.seat }),
  });
  recordMoved(record, op.recordAs, [uid]);
  return {
    ...state,
    players: {
      ...state.players,
      [owner]: { ...side, faceUpPrizes: [...side.faceUpPrizes, uid] },
    },
  };
}

/**
 * Redeemable Ticket: shuffle the whole prize row under the controller's deck and take the top `n`
 * as a new face-down row, clearing `faceUpPrizes`. `n = 0` is a no-op that spends no rng.
 */
export function cycleOwnPrizes(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  const count = side.prizes.length;
  if (count === 0) return state;
  const [shuffled, rngState] = shuffle([...side.prizes], state.rngState);
  const pile = [...side.deck, ...shuffled];
  events.push({ type: "PRIZES_CYCLED", seat: ctx.seat, count });
  return withSide({ ...state, rngState }, ctx.seat, {
    ...side,
    prizes: pile.slice(0, count),
    deck: pile.slice(count),
    faceUpPrizes: [],
  });
}

/**
 * Bother-Bot's switch: swap the recorded turned prize with the recorded revealed hand card. The
 * hand card takes the prize's slot and stays face up. Stale records are a no-op. The row and hand
 * are the opponent's.
 */
export function swapTurnedPrizeWithRevealed(
  state: GameState,
  ctx: EffectContext,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const owner = otherSeat(ctx.seat);
  const side = state.players[owner];
  const [prizeUid] = recorded(record, "turnedPrize");
  const [handUid] = recorded(record, "revealed");
  if (prizeUid === undefined || handUid === undefined) return state;
  const index = side.prizes.indexOf(prizeUid);
  if (index < 0 || !side.hand.includes(handUid)) return state;
  events.push({
    type: "PRIZE_SWITCHED_WITH_HAND",
    seat: owner,
    actor: ctx.seat,
    index,
    prizeUid,
    handUid,
  });
  return withSide(state, owner, {
    ...side,
    prizes: side.prizes.map((uid) => (uid === prizeUid ? handUid : uid)),
    faceUpPrizes: side.faceUpPrizes.map((uid) => (uid === prizeUid ? handUid : uid)),
    hand: [...side.hand.filter((uid) => uid !== handUid), prizeUid],
  });
}

/** Switch the controller's Active with their benched `ref` (§G). The outgoing
    Active loses its Special Conditions (§12 — it left the Active spot). */
export function switchOwn(
  state: GameState,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  return switchInto(state, ctx.seat, ref, events);
}

/**
 * A switch or gust plus the §9.2 filing for "If you do". The filed uid comes from the
 * `POKEMON_SWITCHED` event, so the record only reflects switches that actually happened.
 */
export function switchRecording(
  op: { recordAs?: EffectSlot; recordDemoted?: true; demotedAsMoved?: true },
  move: (into: GameEvent[]) => GameState,
  events: GameEvent[],
  record: EffectRecord,
): GameState {
  const emitted: GameEvent[] = [];
  const next = move(emitted);
  events.push(...emitted);
  recordMoved(
    record,
    op.recordAs,
    emitted.flatMap((event) => (event.type === "POKEMON_SWITCHED" ? [event.nowActive] : [])),
  );
  // Scramble Switch records the demoted body instead; `recordMoved` assigns, replacing the earlier
  // filing.
  if (op.recordDemoted === true) {
    recordMoved(
      record,
      op.recordAs,
      // Re-keyed through `swappedUid`, since Zero to Hero may have swapped the demoted body's top
      // card; with `demotedAsMoved`, records the card the switch moved.
      emitted.flatMap((event) =>
        event.type === "POKEMON_SWITCHED"
          ? [op.demotedAsMoved === true ? event.wasActive : swappedUid(event.wasActive, emitted)]
          : [],
      ),
    );
  }
  return next;
}

/** The bodies a `switchActive` may switch TO on `seat`'s board — every Benched
    Pokémon, narrowed to the printed owner-prefixed subgroup, and EMPTY when the
    printing names a subgroup the controller's own Active is not in.

    Exported for `programPlayable` (cardplay.ts), which must refuse a Trainer
    whose only effect can whiff — `attachEnergyTargets`' precedent and its
    reason: a gate that recomputed the candidate set would be a second copy of
    the printed rule, free to drift from the op it is meant to be about. */
export function switchActiveTargets(
  state: GameState,
  seat: Seat,
  op: OpOf<"switchActive">,
  sourceUid?: string,
): PokemonRef[] {
  if (op.fromSource === true) {
    // "Switch it with your Active": the bench end is the source body itself. Limited to bench refs,
    // so a source in the Active Spot yields no candidates.
    return sourceRef(state, { seat, sourceUid }).filter((ref) => ref.spot.spot === "bench");
  }
  // Bench-end narrowings applied here because both `programPlayable` and the interpreter use this
  // function.
  const bench = switchBenchNarrowing(
    state,
    subgroupRefs(state, ownBenchRefs(state, seat), op.ownerPokemon),
    op,
  );
  // The owner check reads `op.ownerPokemon`: Pecharunt narrows only the destination, Giovanni
  // narrows both ends.
  if (op.ownerPokemon === undefined) return bench;
  // The printed sentence's FIRST noun — "Switch your Active <owner>'s Pokémon".
  // Asked through the SAME `subgroupRefs` call the Bench end uses, so the two
  // halves of one printed owner cannot come to mean two different things.
  const activeInSubgroup =
    subgroupRefs(state, [{ seat, spot: { spot: "active" } }], op.ownerPokemon).length > 0;
  return activeInSubgroup ? bench : [];
}

/**
 * The opponent's benched bodies a `gust` may target, narrowed by any printed rider. Exported so
 * `programPlayable` checks the same set. The §11 shield is applied at the call site, since
 * `unshieldedRefs` announces refusals.
 */
export function gustTargets(state: GameState, seat: Seat, op: OpOf<"gust">): PokemonRef[] {
  const bench = oppBenchRefs(state, seat);
  // Remaining-HP rider, read from the body; refs with no body are dropped.
  const inWindow =
    op.remainingHpAtMost === undefined
      ? bench
      : bench.filter((ref) => {
          const pokemon = refPokemon(state, ref);
          return (
            pokemon !== undefined && remainingHpWithin(state, pokemon, op.remainingHpAtMost ?? 0)
          );
        });
  if (op.basicOnly !== true) return inWindow;
  return inWindow.filter((ref) => {
    const card = refTopCard(state, ref);
    // A missing top card is not this function's call to make (the op validates
    // refs), but an absent card cannot be shown to be Basic either — and the
    // narrowed sentence must not offer a body it cannot read. `isBasicPokemon`
    // (cards.ts) is asked through `matchesFilter`'s own `basicPokemon` arm so the
    // board half and every deck half of "Basic" stay one predicate.
    return card !== undefined && matchesFilter(card, { kind: "basicPokemon" });
  });
}

/**
 * Candidate set for `knockOutChosen`, by `target` scope, narrowed by the damage-counter window
 * (body) then `basicOnly` (card). Unreadable refs are dropped. The §11 shield is applied at the
 * call site.
 */
export function knockOutChosenTargets(
  state: GameState,
  seat: Seat,
  op: OpOf<"knockOutChosen">,
  /** The attacker's top-card uid, excluded by `anyExceptSelf`. */
  sourceUid?: string,
): PokemonRef[] {
  let scope: PokemonRef[];
  switch (op.target) {
    case "opponentAny":
      scope = oppAnyRefs(state, seat);
      break;
    case "opponentBench":
      scope = oppBenchRefs(state, seat);
      break;
    case "anyExceptSelf":
      // Both sides, Active first on each, the attacker dropped by uid.
      scope = [...ownInPlayRefs(state, seat), ...oppAnyRefs(state, seat)].filter((ref) => {
        const pokemon = refPokemon(state, ref);
        return pokemon !== undefined && (sourceUid === undefined || topUid(pokemon) !== sourceUid);
      });
      break;
  }
  if (op.leastHpRemaining === true) return leastHpRemainingRefs(state, scope);
  const inWindow =
    op.damageCountersExactly === undefined
      ? scope
      : scope.filter((ref) => {
          const pokemon = refPokemon(state, ref);
          return pokemon !== undefined && damageCountersOn(pokemon) === op.damageCountersExactly;
        });
  if (op.basicOnly !== true) return inWindow;
  return inWindow.filter((ref) => {
    const card = refTopCard(state, ref);
    // `isBasicPokemon` asked through `matchesFilter`'s own `basicPokemon` arm, so
    // the board half and every deck half of "Basic" stay ONE predicate —
    // `gustTargets`' line one op over, deliberately identical.
    return card !== undefined && matchesFilter(card, { kind: "basicPokemon" });
  });
}

/**
 * Refs in `scope` with the minimum remaining HP (Inteleon "Bring Down"). Bodies with no readable
 * max HP are skipped.
 */
function leastHpRemainingRefs(state: GameState, scope: readonly PokemonRef[]): PokemonRef[] {
  const remaining = scope.flatMap((ref): [PokemonRef, number][] => {
    const pokemon = refPokemon(state, ref);
    const max = pokemon === undefined ? null : effectiveMaxHp(state, pokemon);
    return pokemon === undefined || max === null ? [] : [[ref, max - pokemon.damage]];
  });
  const least = Math.min(...remaining.map(([, hp]) => hp));
  return remaining.filter(([, hp]) => hp === least).map(([ref]) => ref);
}

/** Gust: switch the OPPONENT's Active with their benched `ref` (Boss's Orders). */
export function gust(
  state: GameState,
  ref: PokemonRef,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  return switchInto(state, otherSeat(ctx.seat), ref, events);
}

/** The shared switch move for `seat`'s board: `ref` (a bench index on that
    board) becomes Active; the old Active goes to the bench with its Special
    Conditions cleared. The bench stays dense (the promoted slot closes up, the
    outgoing Active lands at the end). Exported for
    Jet Energy's on-attach switch (turn.ts attachEnergy). */
export function switchInto(
  state: GameState,
  seat: Seat,
  ref: PokemonRef,
  events: GameEvent[],
): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (ref.spot.spot !== "bench" || active === null) return state;
  const index = ref.spot.index;
  const incoming = side.bench[index];
  if (incoming === undefined) return state;
  const wasActive = topUid(active);
  const nowActive = topUid(incoming);
  if (wasActive === undefined || nowActive === undefined) return state;
  const cleared = presentStatuses(active.conditions);
  // Leaving the Active Spot ends Special Conditions and the effects of attacks installed on the
  // body (retreat block, damage block, self-lock, damage reduction, attack lock, and so on). A
  // forced switch can reach these even when retreat could not.
  const benched = {
    ...active,
    // Record when the body went to the Bench (`benchedTurn`).
    benchedTurn: state.turn,
    conditions: noConditions(),
    // A Pokémon switched out and back in on the same turn may use an attack that was barred, and
    // loses any per-attack buff.
    ...clearedAttackEffects(),
  };
  const bench = [...side.bench.slice(0, index), ...side.bench.slice(index + 1), benched];
  events.push({
    type: "POKEMON_SWITCHED",
    seat,
    wasActive,
    nowActive,
    fromBench: index,
    toBench: bench.length - 1,
  });
  if (cleared.length > 0) {
    events.push({
      type: "STATUS_CLEARED",
      seat,
      uid: wasActive,
      statuses: cleared,
      reason: "benched",
    });
  }
  // Stamp the move. This covers every forced bench-to-Active move (Switch, Boss's Orders, Jet
  // Energy); the stamp is a turn number, so a dragged-out Pokémon simply fails to match its
  // controller's next turn. Miraidon "C.O.D.E.: Protect" ends when its source leaves the Active, so
  // the side-wide block is cleared here and stays cleared if the source is re-promoted. The row is
  // emitted only for a live window.
  const sideBlock = side.sideAttackBlock;
  const blockEnds = sideBlock !== null && sideBlock.sourceUid === wasActive;
  if (blockEnds && sideBlock.turn === state.turn) {
    events.push({ type: "SIDE_ATTACK_BLOCK_ENDED", seat, uid: wasActive });
  }
  const moved = withSide(state, seat, {
    ...side,
    active: { ...incoming, promotedTurn: state.turn },
    bench,
    ...(blockEnds ? { sideAttackBlock: null } : {}),
  });
  // §9 opponent-action trigger (Magcargo "Lava Zone"). This is one of the two Active-to-Bench
  // moves; `retreat` is the other, so both call `runActiveBenchedTriggers`. Promotion after a Knock
  // Out is not one: the Knocked Out body went to the discard pile.
  return runActiveBenchedTriggers(moved, seat, wasActive, events);
}
