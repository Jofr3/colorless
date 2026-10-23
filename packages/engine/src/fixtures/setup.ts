import type { Card } from "@colorless/schema";
import type { GameEvent, GameState, Seat } from "../index";
import { SEATS, applyAction, cardOfUid, createGame, isBasicPokemon } from "../index";
import { MIXED_DECK } from "./decks";
import { firstBasicInHand, handUid, must, mustApply } from "./game";
import { FIXTURE_POOL } from "./pool";

type Decks = { p1: string[]; p2: string[] };

export interface SetupOptions {
  /** The card pool the game is created with; defaults to `FIXTURE_POOL`. */
  pool?: Record<string, Card>;
  /** Who goes first (the winner's pick); defaults to the winner themselves. */
  first?: Seat;
  /** Card ids to bench per seat after the active is placed. */
  bench?: Partial<Record<Seat, string[]>>;
  /** Specific card id to use as the active (defaults to any Basic in hand). */
  active?: Partial<Record<Seat, string>>;
  /** Compensation cards to draw per seat when owed (defaults to all owed). */
  extraDraw?: Partial<Record<Seat, number>>;
}

export function mustCreate(
  seed: number,
  decks: Decks = { p1: MIXED_DECK, p2: MIXED_DECK },
  cardPool: Record<string, Card> = FIXTURE_POOL,
): { state: GameState; events: GameEvent[] } {
  const result = createGame({ seed, decks, cardPool });
  if (!result.ok) throw new Error(`createGame failed: ${result.error.code}`);
  return { state: result.state, events: result.events };
}

/** The first unready seat that can place (or already has) an Active. */
function placeableSeat(state: GameState, ready: Record<Seat, boolean>): Seat | undefined {
  return SEATS.find(
    (s) =>
      !ready[s] &&
      (state.players[s].active !== null ||
        state.players[s].hand.some((uid) => {
          const card = cardOfUid(state, uid);
          return card !== undefined && isBasicPokemon(card);
        })),
  );
}

/** Complete opening placement without taking any compensation cards yet. */
export function finishOpeningSetup(initial: GameState): { state: GameState; events: GameEvent[] } {
  let state = initial;
  const events: GameEvent[] = [];
  while (state.phase.kind === "setup:place" && state.phase.stage === "opening") {
    const seat = placeableSeat(state, state.phase.ready);
    if (seat === undefined) throw new Error("No player can complete opening setup");
    if (state.players[seat].active === null) {
      const placed = mustApply(state, {
        type: "setupPlaceActive",
        seat,
        uid: firstBasicInHand(state, seat),
      });
      state = placed.state;
      events.push(...placed.events);
    }
    const readied = mustApply(state, { type: "setupReady", seat });
    state = readied.state;
    events.push(...readied.events);
  }
  return { state, events };
}

/** Scripts opening placements, prizes, compensation and bonus Bench choices. */
export function driveSetup(
  seed: number,
  decks: Decks = { p1: MIXED_DECK, p2: MIXED_DECK },
  opts: SetupOptions = {},
): GameState {
  return completeSetup(mustCreate(seed, decks, opts.pool).state, opts);
}

/** Complete setup using the state's own card pool, including file-local test cards. */
export function completeSetup(initial: GameState, opts: SetupOptions = {}): GameState {
  let state = initial;
  if (state.phase.kind === "setup:chooseFirst") {
    const winner = state.phase.coinWinner;
    state = must(
      applyAction(state, {
        type: "chooseFirstPlayer",
        seat: winner,
        first: opts.first ?? winner,
      }),
    );
  }
  const pendingBench = { p1: [...(opts.bench?.p1 ?? [])], p2: [...(opts.bench?.p2 ?? [])] };
  while (state.turn === 0) {
    const phase = state.phase;
    if (phase.kind === "setup:drawExtra") {
      const seat = SEATS.find((s) => !phase.decided[s]);
      if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
      state = must(
        applyAction(state, {
          type: "setupDrawExtra",
          seat,
          count: opts.extraDraw?.[seat] ?? phase.owed[seat],
        }),
      );
      continue;
    }
    if (phase.kind !== "setup:place") throw new Error(`Unexpected setup phase: ${phase.kind}`);
    const seat = placeableSeat(state, phase.ready);
    if (seat === undefined) throw new Error("No player can complete setup");
    if (state.players[seat].active === null) {
      const activeId = opts.active?.[seat];
      const uid =
        activeId === undefined ? firstBasicInHand(state, seat) : handUid(state, seat, activeId);
      state = must(applyAction(state, { type: "setupPlaceActive", seat, uid }));
    }
    for (const benchId of [...pendingBench[seat]]) {
      const uid = state.players[seat].hand.find(
        (uid) =>
          state.cardIdByUid[uid] === benchId &&
          (phase.stage !== "bonus" || phase.bonusCards?.[seat].includes(uid)),
      );
      if (uid === undefined) continue;
      state = must(applyAction(state, { type: "setupPlaceBench", seat, uid }));
      pendingBench[seat].splice(pendingBench[seat].indexOf(benchId), 1);
    }
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  if (pendingBench.p1.length || pendingBench.p2.length)
    throw new Error("Requested setup Bench card unavailable");
  return state;
}
