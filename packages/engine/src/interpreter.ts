import type { Card } from "@luminous/schema";
import { energyProvidesOf, isBasicPokemon, isEnergyCard, topUid } from "./cards";
import type { CardFilter, EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { flipCoin, shuffle } from "./rng";
import type { GameState, PlayerSide, PokemonTarget, Seat } from "./types";
import {
  BENCH_MAX,
  DEFAULT_POISON_DAMAGE,
  drawToHand,
  makeInPlay,
  noConditions,
  otherSeat,
  presentStatuses,
  withActive,
  withSide,
} from "./types";

// The shared effect interpreter (D8) — the one place a GameState changes under
// an op program, whether the program came from an attack (effects.ts deriver),
// a Trainer, or an Ability (registry.ts). M3's interpreter was attack-private
// and synchronous; M4 needs mid-effect PARKING (search a deck → pick a card;
// gust → pick which benched Pokémon) so this returns a resumable result and
// the whole continuation (`pendingOp` + the rest of the program + context) is
// JSON so it stores in the `effect:choose` phase and replays identically.
//
// Effects in scope never deal damage, KO, or end the game, so the interpreter
// does NOT touch the KO/win tail (flow.ts) — a future spread/snipe op will
// route its KO check through the shared knockOut there.

/** The controller of an effect (the seat playing the card). "self" ops target
    this seat's Active, "defender"/gust the opponent's. */
export interface EffectContext {
  seat: Seat;
}

/** A specific in-play Pokémon, addressed by the board it sits on and the spot.
    The one shape a targeting decision resolves to (own bench, opponent bench,
    own Active — the interpreter validates the ref against the live board). */
export interface PokemonRef {
  seat: Seat;
  spot: PokemonTarget;
}

/** What a parked op is asking the controller to decide. `note` is a short
    human string for the prompt UI / log; the arrays are the legal options
    (a client that offers anything else is rejected by resolveEffect). */
export type EffectPrompt =
  /** Pick 0..max deck-card uids to move to `dest` (searchDeck is "up to"). */
  | { kind: "chooseCards"; candidates: string[]; max: number; dest: "bench" | "hand"; note: string }
  /** Pick exactly one in-play Pokémon (switchActive / gust / healChosen). */
  | { kind: "choosePokemon"; candidates: PokemonRef[]; note: string };

/** The controller's answer, off the resolveEffect action (wire-checked there). */
export type EffectChoice =
  | { kind: "cards"; uids: string[] }
  | { kind: "pokemon"; ref: PokemonRef };

/** The JSON continuation stored in the effect:choose phase: the op awaiting a
    choice, the ops after it, and the context. Replaying `applyChoice(pendingOp)
    → runProgram(rest)` resumes exactly where it parked. */
export interface EffectContinuation {
  pendingOp: EffectOp;
  rest: EffectOp[];
  ctx: EffectContext;
}

export type RunResult =
  | { kind: "done"; state: GameState }
  | { kind: "parked"; state: GameState; prompt: EffectPrompt; cont: EffectContinuation };

/** Run an op program from the top. Synchronous ops apply in order; the first
    op that needs a decision PARKS (returns the prompt + a continuation), and
    an empty/forced decision auto-resolves without a prompt (the M1 doctrine:
    a choice with no choice in it is not a choice). A coin-flip gate splices
    its heads-branch into the work queue so parking works uniformly through
    a gate too (no representative program parks inside one — but the shape is
    correct if one ever does). */
export function runProgram(
  state: GameState,
  program: readonly EffectOp[],
  ctx: EffectContext,
  events: GameEvent[],
): RunResult {
  let next = state;
  const queue: EffectOp[] = [...program];
  while (queue.length > 0) {
    const op = queue.shift() as EffectOp;
    if (op.op === "coinFlipGate") {
      const [face, rngState] = flipCoin(next.rngState);
      next = { ...next, rngState };
      events.push({ type: "ATTACK_EFFECT_COIN_FLIP", seat: ctx.seat, result: face });
      if (face === "heads") queue.unshift(...op.then);
      continue;
    }
    const stepped = stepOp(next, op, ctx, events);
    if ("park" in stepped) {
      // rest = the queue as it stands after shifting `op` — a plain EffectOp[].
      return { kind: "parked", state: next, prompt: stepped.park, cont: { pendingOp: op, rest: [...queue], ctx } };
    }
    next = stepped.done;
  }
  return { kind: "done", state: next };
}

/** Resume a parked effect: apply the awaited op with the (already validated)
    choice, then run the rest of the program. */
export function resumeProgram(
  state: GameState,
  cont: EffectContinuation,
  choice: EffectChoice,
  events: GameEvent[],
): RunResult {
  const applied = applyChoice(state, cont.pendingOp, choice, cont.ctx, events);
  return runProgram(applied, cont.rest, cont.ctx, events);
}

/** One synchronous step, or a park request. Parking ops compute their
    candidates: an empty candidate set is a no-op (nothing to choose), a single
    forced candidate auto-resolves (except searchDeck, which is "up to" and
    always lets the player decline, so it parks whenever ≥1 candidate). */
function stepOp(
  state: GameState,
  op: EffectOp,
  ctx: EffectContext,
  events: GameEvent[],
): { done: GameState } | { park: EffectPrompt } {
  switch (op.op) {
    case "applyStatus":
      return { done: applyStatus(state, op, ctx, events) };
    case "heal":
      return { done: healSelf(state, op.amount, ctx, events) };
    case "drawCards":
      return { done: drawToHand(state, ctx.seat, op.count, "effect", events) };
    case "discardHand":
      return { done: discardHand(state, ctx, events) };
    case "shuffleDeck":
      return { done: shuffleDeck(state, ctx, events) };
    case "searchDeck": {
      const candidates = state.players[ctx.seat].deck.filter((uid) =>
        matchesFilter(cardOf(state, uid), op.filter),
      );
      const max = op.dest === "bench" ? Math.min(op.max, benchSpace(state, ctx.seat)) : op.max;
      if (candidates.length === 0 || max <= 0) {
        // A search that can find nothing (or has nowhere to put it) is a
        // no-op — the trailing shuffleDeck op still fires.
        return { done: state };
      }
      return {
        park: {
          kind: "chooseCards",
          candidates,
          max,
          dest: op.dest,
          note: searchNote(op.filter, op.dest, max),
        },
      };
    }
    case "switchActive":
      return parkOrForce(state, ownBenchRefs(state, ctx.seat), (ref) => switchOwn(state, ref, ctx, events), "Switch to which Benched Pokémon?");
    case "gust":
      return parkOrForce(state, oppBenchRefs(state, ctx.seat), (ref) => gust(state, ref, ctx, events), "Gust up which of the opponent's Benched Pokémon?");
    case "healChosen":
      return parkOrForce(state, ownInPlayRefs(state, ctx.seat), (ref) => healChosen(state, ref, op.amount, ctx, events), "Heal which of your Pokémon?");
    // coinFlipGate is handled in runProgram's queue loop (never reaches here).
    case "coinFlipGate":
      return { done: state };
  }
}

/** A mandatory targeting op: no candidate = no-op, one = forced (auto-resolve),
    ≥2 = park on a choosePokemon prompt. */
function parkOrForce(
  state: GameState,
  candidates: PokemonRef[],
  apply: (ref: PokemonRef) => GameState,
  note: string,
): { done: GameState } | { park: EffectPrompt } {
  if (candidates.length === 0) return { done: state };
  if (candidates.length === 1) return { done: apply(candidates[0] as PokemonRef) };
  return { park: { kind: "choosePokemon", candidates, note } };
}

// ── Choice application (shared by the forced auto-resolve and resolveEffect) ──

/** Apply a parked op given its validated choice. The auto-resolve path calls
    the per-op helpers directly (single forced ref); this is the resolveEffect
    entry, matching the choice shape to the op. */
export function applyChoice(
  state: GameState,
  op: EffectOp,
  choice: EffectChoice,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  switch (op.op) {
    case "searchDeck":
      return choice.kind === "cards"
        ? searchMove(state, choice.uids, op.dest, ctx, events)
        : state;
    case "switchActive":
      return choice.kind === "pokemon" ? switchOwn(state, choice.ref, ctx, events) : state;
    case "gust":
      return choice.kind === "pokemon" ? gust(state, choice.ref, ctx, events) : state;
    case "healChosen":
      return choice.kind === "pokemon"
        ? healChosen(state, choice.ref, op.amount, ctx, events)
        : state;
    default:
      // Synchronous ops never park, so never reach the choice path.
      return state;
  }
}

// ── Op implementations ──

function applyStatus(
  state: GameState,
  op: Extract<EffectOp, { op: "applyStatus" }>,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const seat = op.target === "self" ? ctx.seat : otherSeat(ctx.seat);
  const active = state.players[seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  if (op.status === "poisoned") {
    const poisonDamage = op.poisonDamage ?? DEFAULT_POISON_DAMAGE;
    events.push({ type: "STATUS_APPLIED", seat, uid, status: "poisoned", poisonDamage });
    return withActive(state, seat, { ...active, conditions: { ...active.conditions, poisonDamage } });
  }
  if (op.status === "burned") {
    events.push({ type: "STATUS_APPLIED", seat, uid, status: "burned" });
    return withActive(state, seat, { ...active, conditions: { ...active.conditions, burned: true } });
  }
  events.push({ type: "STATUS_APPLIED", seat, uid, status: op.status });
  return withActive(state, seat, {
    ...active,
    conditions: { ...active.conditions, rotation: op.status },
  });
}

/** Heal the controller's own Active (attack "heal from it" op). */
function healSelf(state: GameState, amount: number, ctx: EffectContext, events: GameEvent[]): GameState {
  const active = state.players[ctx.seat].active;
  if (active === null) return state;
  const uid = topUid(active);
  if (uid === undefined) return state;
  const healed = Math.min(amount, active.damage);
  if (healed <= 0) return state;
  events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
  return withActive(state, ctx.seat, { ...active, damage: active.damage - healed });
}

function discardHand(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const side = state.players[ctx.seat];
  if (side.hand.length === 0) return state;
  events.push({ type: "HAND_DISCARDED", seat: ctx.seat, uids: [...side.hand] });
  return withSide(state, ctx.seat, { ...side, hand: [], discard: [...side.discard, ...side.hand] });
}

function shuffleDeck(state: GameState, ctx: EffectContext, events: GameEvent[]): GameState {
  const side = state.players[ctx.seat];
  const [deck, rngState] = shuffle(side.deck, state.rngState);
  events.push({ type: "SHUFFLE", seat: ctx.seat });
  return { ...withSide(state, ctx.seat, { ...side, deck }), rngState };
}

// (deck shuffling reuses rng.ts's vetted Fisher–Yates — the M1 review caught a
// biased hand-rolled variant; there is exactly one shuffle in the engine.)

/** Move the chosen searched cards deck → dest (bench Basics enter play stamped
    this turn; hand cards just append). Wire-safe: only uids actually in the
    deck move (resolveEffect already checked them against the candidate set). */
function searchMove(
  state: GameState,
  uids: readonly string[],
  dest: "bench" | "hand",
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  const side = state.players[ctx.seat];
  // Bench-bound cards clamp to the remaining bench space HERE, before anything
  // leaves the deck — so the set removed from the deck is EXACTLY the set that
  // lands (a slice-after-remove would strand the excess in neither zone, the
  // card-destruction shape the M1 review called out). Hand has no cap.
  const inDeck = uids.filter((uid) => side.deck.includes(uid));
  const moved = dest === "bench" ? inDeck.slice(0, benchSpace(state, ctx.seat)) : inDeck;
  if (moved.length === 0) return state;
  const picked = new Set(moved);
  const deck = side.deck.filter((uid) => !picked.has(uid));
  const updated: PlayerSide =
    dest === "bench"
      ? { ...side, deck, bench: [...side.bench, ...moved.map((uid) => makeInPlay(uid, state.turn))] }
      : { ...side, deck, hand: [...side.hand, ...moved] };
  events.push({ type: "DECK_SEARCHED", seat: ctx.seat, dest, uids: [...moved] });
  return withSide(state, ctx.seat, updated);
}

/** Switch the controller's Active with their benched `ref` (§G). The outgoing
    Active loses its Special Conditions (§12 — it left the Active spot). */
function switchOwn(state: GameState, ref: PokemonRef, ctx: EffectContext, events: GameEvent[]): GameState {
  return switchInto(state, ctx.seat, ref, events);
}

/** Gust: switch the OPPONENT's Active with their benched `ref` (Boss's Orders). */
function gust(state: GameState, ref: PokemonRef, ctx: EffectContext, events: GameEvent[]): GameState {
  return switchInto(state, otherSeat(ctx.seat), ref, events);
}

/** The shared switch move for `seat`'s board: `ref` (a bench index on that
    board) becomes Active; the old Active goes to the bench with its Special
    Conditions cleared. The bench stays dense (the promoted slot closes up, the
    retreater lands at the end) — the same compaction retreat uses. */
function switchInto(state: GameState, seat: Seat, ref: PokemonRef, events: GameEvent[]): GameState {
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
  const benched = { ...active, conditions: noConditions() };
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
    events.push({ type: "STATUS_CLEARED", seat, uid: wasActive, statuses: cleared, reason: "benched" });
  }
  return withSide(state, seat, { ...side, active: incoming, bench });
}

/** Heal `amount` from the controller's own in-play `ref` (Potion). */
function healChosen(
  state: GameState,
  ref: PokemonRef,
  amount: number,
  ctx: EffectContext,
  events: GameEvent[],
): GameState {
  if (ref.seat !== ctx.seat) return state;
  const side = state.players[ctx.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (pokemon === undefined || pokemon === null) return state;
  const uid = topUid(pokemon);
  if (uid === undefined) return state;
  const healed = Math.min(amount, pokemon.damage);
  if (healed <= 0) return state;
  events.push({ type: "HEALED", seat: ctx.seat, uid, amount: healed });
  const updated = { ...pokemon, damage: pokemon.damage - healed };
  if (ref.spot.spot === "active") return withActive(state, ctx.seat, updated);
  const bench = side.bench.map((p, i) => (i === (ref.spot as { index: number }).index ? updated : p));
  return withSide(state, ctx.seat, { ...side, bench });
}

// ── Candidate builders + small shared helpers ──

function ownBenchRefs(state: GameState, seat: Seat): PokemonRef[] {
  return state.players[seat].bench.map((_, index) => ({ seat, spot: { spot: "bench", index } }));
}

function oppBenchRefs(state: GameState, seat: Seat): PokemonRef[] {
  const opp = otherSeat(seat);
  return state.players[opp].bench.map((_, index) => ({ seat: opp, spot: { spot: "bench", index } }));
}

/** Every in-play Pokémon the controller could heal — Active first, then bench. */
function ownInPlayRefs(state: GameState, seat: Seat): PokemonRef[] {
  const refs: PokemonRef[] = [];
  if (state.players[seat].active !== null) refs.push({ seat, spot: { spot: "active" } });
  for (let index = 0; index < state.players[seat].bench.length; index++) {
    refs.push({ seat, spot: { spot: "bench", index } });
  }
  return refs;
}

function benchSpace(state: GameState, seat: Seat): number {
  return BENCH_MAX - state.players[seat].bench.length;
}

function cardOf(state: GameState, uid: string): Card | undefined {
  const id = state.cardIdByUid[uid];
  return id === undefined ? undefined : state.cardPool[id];
}

function matchesFilter(card: Card | undefined, filter: CardFilter): boolean {
  if (card === undefined) return false;
  switch (filter.kind) {
    case "basicPokemon":
      return isBasicPokemon(card);
    case "anyPokemon":
      return card.category === "Pokemon";
    case "basicEnergy":
      return (
        isEnergyCard(card) &&
        card.energyType === "Normal" &&
        (filter.energyType === undefined || energyProvidesOf(card) === filter.energyType)
      );
  }
}

function searchNote(filter: CardFilter, dest: "bench" | "hand", max: number): string {
  const what =
    filter.kind === "basicPokemon"
      ? "a Basic Pokémon"
      : filter.kind === "anyPokemon"
        ? "a Pokémon"
        : filter.energyType === undefined
          ? "a Basic Energy"
          : `a Basic ${filter.energyType} Energy`;
  const where = dest === "bench" ? "onto your Bench" : "into your hand";
  return max > 1
    ? `Search your deck for up to ${max} ${what} ${where}.`
    : `Search your deck for ${what} ${where}.`;
}
