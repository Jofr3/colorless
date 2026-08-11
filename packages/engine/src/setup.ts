import type { Card } from "@luminous/schema";
import type {
  ApplyResult,
  ChooseFirstPlayerAction,
  ErrorCode,
  SetupDrawExtraAction,
  SetupPlaceActiveAction,
  SetupPlaceBenchAction,
  SetupReadyAction,
} from "./actions";
import { err, ok } from "./actions";
import { basicFromHandError, cardOfUid, isBasicPokemon } from "./cards";
import type { GameEvent } from "./events";
import { startTurn } from "./flow";
import { flipCoin, shuffle } from "./rng";
import type { GameState, PlayerSide, Seat } from "./types";
import {
  BENCH_MAX,
  DECK_SIZE,
  HAND_SIZE,
  PRIZE_COUNT,
  SEATS,
  drawToHand,
  freshAllowances,
  freshHandPlayLocks,
  makeInPlay,
  otherSeat,
  withSide,
  without,
} from "./types";

// The setup sequence (rules §3), split across createGame and the setup:*
// actions. createGame stops at the first decision point (the coin winner's
// chooseFirstPlayer); everything decision-free in between auto-resolves.

/** createGame's rejections — a subset of the one ErrorCode union (actions.ts). */
export type CreateErrorCode = Extract<
  ErrorCode,
  "BAD_DECK_SIZE" | "UNKNOWN_CARD_ID" | "NO_BASIC_POKEMON"
>;

export interface CreateGameOptions {
  seed: number;
  /** Exactly 60 catalog card ids per seat, in any order. */
  decks: Record<Seat, string[]>;
  /** id → Card for (at least) every id the decks reference. */
  cardPool: Record<string, Card>;
}

export type CreateGameResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: { code: CreateErrorCode; message: string } };

function createErr(code: CreateErrorCode, message: string): CreateGameResult {
  return { ok: false, error: { code, message } };
}

/** §3.1–§3.3: validate decks, mint uids, shuffle, flip the coin. The state
    comes back waiting on the winner's chooseFirstPlayer. */
export function createGame(options: CreateGameOptions): CreateGameResult {
  // Deck legality (§3.1): exactly 60 known ids with at least one Basic
  // Pokémon. The 4-copy limit is a deck-build constraint, not a runtime one;
  // ≥1 Basic is what guarantees the mulligan loop terminates.
  const pool: Record<string, Card> = {};
  for (const seat of SEATS) {
    const deck = options.decks[seat];
    if (deck.length !== DECK_SIZE) {
      return createErr(
        "BAD_DECK_SIZE",
        `${seat} deck has ${deck.length} cards, expected ${DECK_SIZE}`,
      );
    }
    let basics = 0;
    for (const id of deck) {
      const card = options.cardPool[id];
      if (card === undefined) {
        return createErr("UNKNOWN_CARD_ID", `${seat} deck references unknown card id "${id}"`);
      }
      pool[id] = card;
      if (isBasicPokemon(card)) basics++;
    }
    if (basics === 0) {
      return createErr("NO_BASIC_POKEMON", `${seat} deck has no Basic Pokémon`);
    }
  }

  // Every physical card gets a stable uid ("p1#0"…"p1#59") so zones hold
  // plain strings and later effects can reference exact copies.
  const cardIdByUid: Record<string, string> = {};
  const decks: Record<Seat, string[]> = { p1: [], p2: [] };
  for (const seat of SEATS) {
    let i = 0;
    for (const id of options.decks[seat]) {
      const uid = `${seat}#${i}`;
      cardIdByUid[uid] = id;
      decks[seat].push(uid);
      i++;
    }
  }

  const events: GameEvent[] = [];
  let rngState = options.seed | 0; // stored state stays a signed int32

  // §3.2 — each player shuffles their deck.
  for (const seat of SEATS) {
    const [shuffled, next] = shuffle(decks[seat], rngState);
    decks[seat] = shuffled;
    rngState = next;
    events.push({ type: "SHUFFLE", seat });
  }

  // §3.3 — turn order: one coin flip. Convention: heads means p1 won the
  // toss (seats are labels, not turn order) — the winner then CHOOSES who
  // goes first via the chooseFirstPlayer action.
  const [face, next] = flipCoin(rngState);
  rngState = next;
  const coinWinner: Seat = face === "heads" ? "p1" : "p2";
  events.push({ type: "COIN_FLIP", result: face, winner: coinWinner });

  const state: GameState = {
    rngState,
    turn: 0,
    firstPlayer: null,
    phase: { kind: "setup:chooseFirst", coinWinner },
    allowances: freshAllowances(),
    pending: [],
    stadium: null,
    players: { p1: emptySide(decks.p1), p2: emptySide(decks.p2) },
    // No Pokémon has ever been Knocked Out on a board that has not been dealt
    // yet. `null` and not `0` — see the field's own note in types.ts.
    lastKoTurn: { p1: null, p2: null },
    // …and nothing to say about WHICH body, for the same reason. Empty and not
    // null: the reader returns a list, and a closed window is an empty one.
    lastKoMarks: { p1: [], p2: [] },
    // No attack has resolved on a board that has not been dealt yet, so no seat
    // is barred from playing anything — see the field's own note in types.ts.
    handPlayLockedTurn: freshHandPlayLocks(),
    // 🆕 D298 — no printed once-per-game effect has been applied on a board that
    // has not been dealt yet. It only ever grows; see the field's note in types.ts.
    oncePerGameSpent: { p1: [], p2: [] },
    cardIdByUid,
    cardPool: pool,
  };
  return { ok: true, state, events };
}

function emptySide(deck: string[]): PlayerSide {
  return { deck, hand: [], discard: [], prizes: [], active: null, bench: [], mulligans: 0 };
}

function handHasBasic(state: GameState, seat: Seat): boolean {
  return state.players[seat].hand.some((uid) => {
    const card = cardOfUid(state, uid);
    return card !== undefined && isBasicPokemon(card);
  });
}

/** §3.5 mulligan loop, auto-resolved (no player choice): reveal, shuffle the
    hand back, redraw 7, repeat until the hand has a Basic. Termination is
    guaranteed in practice by createGame's ≥1-Basic validation. */
function resolveMulligans(state: GameState, seat: Seat, events: GameEvent[]): GameState {
  let next = state;
  while (!handHasBasic(next, seat)) {
    const side = next.players[seat];
    // Copied, not aliased: this array is the retained previous state's hand.
    events.push({ type: "MULLIGAN_REVEALED", seat, hand: [...side.hand] });
    const [deck, rngState] = shuffle([...side.deck, ...side.hand], next.rngState);
    events.push({ type: "SHUFFLE", seat });
    next = withSide({ ...next, rngState }, seat, {
      ...side,
      deck,
      hand: [],
      mulligans: side.mulligans + 1,
    });
    next = drawToHand(next, seat, HAND_SIZE, "mulligan", events);
  }
  return next;
}

/** The coin winner picks who goes first, then the decision-free §3.4–§3.5
    stretch (opening hands, mulligans) auto-resolves in the same reduction. */
export function chooseFirstPlayer(state: GameState, action: ChooseFirstPlayerAction): ApplyResult {
  const phase = state.phase;
  if (phase.kind !== "setup:chooseFirst") {
    return err("BAD_PHASE", `chooseFirstPlayer is not legal during ${phase.kind}`);
  }
  if (action.seat !== phase.coinWinner) {
    return err("WRONG_SEAT", `only the coin winner (${phase.coinWinner}) chooses first player`);
  }
  // `first` is a seat the caller NAMES, not the acting seat applyAction
  // already guarded — an unvalidated one lands in state.firstPlayer and only
  // explodes later, inside startTurn, several actions past the offender.
  if (action.first !== "p1" && action.first !== "p2") {
    return err("UNKNOWN_SEAT", `"${String(action.first)}" is not a seat`);
  }

  const events: GameEvent[] = [
    { type: "FIRST_PLAYER_CHOSEN", first: action.first, chosenBy: action.seat },
  ];
  let next: GameState = { ...state, firstPlayer: action.first };

  // §3.4 — opening hands of 7. ORDERING (doc leaves it open): hands are
  // drawn after the first-player choice, matching the §3 step order
  // (turn order = step 3, hands = step 4) and keeping createGame free of
  // decision points.
  for (const seat of SEATS) {
    next = drawToHand(next, seat, HAND_SIZE, "opening", events);
  }

  // §3.5 — mulligans, resolved for p1 fully and then p2. ORDERING: the doc
  // leaves simultaneity open; sequential seat order is deterministic and,
  // with full-information events, observationally equivalent.
  for (const seat of SEATS) {
    next = resolveMulligans(next, seat, events);
  }

  // Mulligan compensation (§3.5): you may draw 1 card for EACH mulligan your
  // OPPONENT took. Mulliganing yourself does not forfeit it — so when both
  // players mulligan, both are owed (each off the other's count), which is
  // why the phase holds a per-seat map rather than one owed seat.
  //
  // The draw is clamped so a player can never draw themselves below the 6
  // cards they must still set aside as prizes (§3.8): with an extreme
  // mulligan run the compensation would otherwise silently short-draw and
  // leave a player with fewer than 6 prizes, breaking the invariant every
  // M2 prize-out check rests on.
  const owed: Record<Seat, number> = { p1: 0, p2: 0 };
  for (const seat of SEATS) {
    const spare = Math.max(0, next.players[seat].deck.length - PRIZE_COUNT);
    owed[seat] = Math.min(next.players[otherSeat(seat)].mulligans, spare);
  }
  // Owed 0 is pre-decided: never block the game on a no-op choice, and skip
  // the phase entirely when neither player is owed anything.
  const decided: Record<Seat, boolean> = { p1: owed.p1 === 0, p2: owed.p2 === 0 };
  next = {
    ...next,
    phase:
      decided.p1 && decided.p2
        ? { kind: "setup:place", ready: { p1: false, p2: false } }
        : { kind: "setup:drawExtra", owed, decided },
  };
  return ok(next, events);
}

/** The compensation decision: draw 0…owed extra cards. Placement begins once
    every owed seat has answered (both may owe a decision — see Phase). */
export function setupDrawExtra(state: GameState, action: SetupDrawExtraAction): ApplyResult {
  const phase = state.phase;
  if (phase.kind !== "setup:drawExtra") {
    return err("BAD_PHASE", `setupDrawExtra is not legal during ${phase.kind}`);
  }
  const owed = phase.owed[action.seat];
  if (phase.decided[action.seat]) {
    return err("WRONG_SEAT", `${action.seat} is not owed a compensation decision`);
  }
  if (!Number.isInteger(action.count) || action.count < 0 || action.count > owed) {
    return err("BAD_EXTRA_COUNT", `may draw 0–${owed} extra cards, got ${action.count}`);
  }
  const events: GameEvent[] = [];
  let next = drawToHand(state, action.seat, action.count, "compensation", events);
  events.push({ type: "COMPENSATION_DECIDED", seat: action.seat, drawn: action.count, owed });

  const decided: Record<Seat, boolean> = { ...phase.decided, [action.seat]: true };
  next = {
    ...next,
    phase:
      decided.p1 && decided.p2
        ? { kind: "setup:place", ready: { p1: false, p2: false } }
        : { ...phase, decided },
  };
  return ok(next, events);
}

/** §3.6 — the mandatory face-down Active. "Face-down" only shapes the event
    stream: M1 events are full-information (hidden-info filtering is P4). */
export function setupPlaceActive(state: GameState, action: SetupPlaceActiveAction): ApplyResult {
  const phase = state.phase;
  if (phase.kind !== "setup:place") {
    return err("BAD_PHASE", `setupPlaceActive is not legal during ${phase.kind}`);
  }
  if (phase.ready[action.seat]) {
    return err("ALREADY_READY", `${action.seat} already declared ready`);
  }
  const side = state.players[action.seat];
  if (side.active !== null) {
    return err("ACTIVE_ALREADY_PLACED", `${action.seat} already has an Active Pokémon`);
  }
  const invalid = basicFromHandError(state, action.seat, action.uid);
  if (invalid !== null) return invalid;

  const next = withSide(state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
    active: makeInPlay(action.uid, state.turn), // turnPlayed 0 = setup
  });
  return ok(next, [{ type: "POKEMON_PLACED", seat: action.seat, uid: action.uid, spot: "active" }]);
}

/** §3.7 — optional Bench placements, up to 5. ORDERING (doc step order
    6 → 7): the Active must be placed before any Bench Pokémon. */
export function setupPlaceBench(state: GameState, action: SetupPlaceBenchAction): ApplyResult {
  const phase = state.phase;
  if (phase.kind !== "setup:place") {
    return err("BAD_PHASE", `setupPlaceBench is not legal during ${phase.kind}`);
  }
  if (phase.ready[action.seat]) {
    return err("ALREADY_READY", `${action.seat} already declared ready`);
  }
  const side = state.players[action.seat];
  if (side.active === null) {
    return err("ACTIVE_NOT_PLACED", "place the Active Pokémon before benching (§3 order)");
  }
  if (side.bench.length >= BENCH_MAX) {
    return err("BENCH_FULL", `the bench holds at most ${BENCH_MAX} Pokémon`);
  }
  const invalid = basicFromHandError(state, action.seat, action.uid);
  if (invalid !== null) return invalid;

  const next = withSide(state, action.seat, {
    ...side,
    hand: without(side.hand, action.uid),
    bench: [...side.bench, makeInPlay(action.uid, state.turn)],
  });
  return ok(next, [{ type: "POKEMON_PLACED", seat: action.seat, uid: action.uid, spot: "bench" }]);
}

/** Locks the seat's placements. When the second seat readies, the rest of
    setup (§3.8–§3.9: prizes, reveal, turn 1) auto-resolves. */
export function setupReady(state: GameState, action: SetupReadyAction): ApplyResult {
  const phase = state.phase;
  if (phase.kind !== "setup:place") {
    return err("BAD_PHASE", `setupReady is not legal during ${phase.kind}`);
  }
  if (phase.ready[action.seat]) {
    return err("ALREADY_READY", `${action.seat} already declared ready`);
  }
  if (state.players[action.seat].active === null) {
    return err("ACTIVE_NOT_PLACED", "an Active Pokémon is mandatory before readying (§3.6)");
  }
  const ready = { ...phase.ready, [action.seat]: true };
  const events: GameEvent[] = [{ type: "SETUP_READY", seat: action.seat }];
  const next: GameState = { ...state, phase: { ...phase, ready } };
  if (!(ready.p1 && ready.p2)) return ok(next, events);
  return finishSetup(next, events);
}

/** §3.8–§3.9: prizes down, board face-up, first player's turn begins. */
function finishSetup(state: GameState, events: GameEvent[]): ApplyResult {
  let next = state;
  // §3.8 — the top 6 cards become face-down prizes. The compensation clamp
  // guarantees the deck can always spare them.
  for (const seat of SEATS) {
    const side = next.players[seat];
    const prizes = side.deck.slice(0, PRIZE_COUNT);
    next = withSide(next, seat, { ...side, deck: side.deck.slice(PRIZE_COUNT), prizes });
    // Copied, not aliased: `prizes` is the array the state now holds.
    events.push({ type: "PRIZES_SET", seat, uids: [...prizes] });
  }
  // §3.9 — everything flips face-up. The board is already in the state, so
  // the event carries no payload.
  events.push({ type: "SETUP_REVEALED" });
  const first = next.firstPlayer;
  if (first === null) {
    // Unreachable: firstPlayer is set before setup:place can be entered.
    return err("BAD_PHASE", "first player was never chosen");
  }
  return startTurn(next, first, events);
}
