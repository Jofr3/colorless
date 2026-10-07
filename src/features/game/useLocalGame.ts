// The /play page's state owner: one useReducer over a pure host reducer that
// wraps the engine's applyAction (D14 — total, never throws, never mutates).
// StrictMode double-invokes reducers, so everything the reducer produces
// (game, log, error) lives in the reducer's returned state — nothing is
// pushed from effects — and the only impurity (the wall clock for log
// timestamps) rides IN on the dispatched host event, stamped once per user
// gesture by the dispatch wrapper.

import { useCallback, useLayoutEffect, useMemo, useReducer } from "react";
import type { ErrorCode, GameAction, GameEvent, GameState, Seat } from "@luminous/engine";
import { applyAction, formatElapsed, logFromEvents, phaseViewOf } from "@luminous/engine";
import type { SeatLogEntry } from "@luminous/schema";
import { projectGameState, type GameProjection } from "./projection";
import { viewLogEntries } from "./viewLog";
import { coinFlipsFromEvents, coinFlipTitle, type CoinFlipBatch } from "./coinFlips";

/** Everything a fresh match starts from — the createGame result plus the
    display names. Produced by the pregame flow. */
export interface LocalGameSetup {
  state: GameState;
  /** createGame's own events (shuffles, the coin flip). */
  events: GameEvent[];
  /** Display names per seat (deck names). */
  names: Record<Seat, string>;
  /** Wall-clock start, the log's elapsed-time origin. */
  startedAt: number;
  /** A saved match resumes its accumulated log and the current hot-seat viewer. */
  resume?: {
    log: SeatLogEntry[];
    viewerSeat: Seat;
    turns?: LocalTurnSnapshot[];
    turnIndex?: number;
    latestTurn?: LocalTurnSnapshot;
  };
}

export interface LocalTurnSnapshot {
  game: GameState;
  log: SeatLogEntry[];
  viewerSeat: Seat;
}

export interface GameError {
  code: ErrorCode;
  message: string;
  /** Bumps on every rejection so an identical repeat re-announces. */
  nonce: number;
}

interface HostState {
  /** Transient presentation only — never persisted or replayed on refresh. */
  coinFlipBatch: CoinFlipBatch | null;
  /** Hold the visible board, log and viewer until the dice finish. Saves use `game`. */
  coinFlipPresentation: LocalTurnSnapshot | null;
  game: GameState;
  names: Record<Seat, string>;
  startedAt: number;
  log: SeatLogEntry[];
  lastError: GameError | null;
  /** The hot-seat viewer — follows whoever must act (see waitingSeatOf). */
  viewerSeat: Seat;
  turns: LocalTurnSnapshot[];
  turnIndex: number;
  latestTurn: LocalTurnSnapshot;
}

interface HostActionEvent {
  action: GameAction;
  /** Date.now() at dispatch — stamped by the wrapper, not the reducer. */
  at: number;
}

type HostEvent =
  | HostActionEvent
  | { type: "previousTurn" | "nextTurn" }
  | { type: "finishCoinFlip"; id: number };

/** The seat the hot-seat screen should hand the device to: the projection's
    own phase→seat mapping (phaseViewOf — THE one exhaustive switch over the
    Phase union, which already prefers `current` when either seat could act),
    made sticky — phases where nobody is waited on (gameOver) keep `current`.
    Rule one of the wire-up (D17): NEVER derive this from turn ownership —
    during ko:promote the actor is the KO'd NON-turn player. */
export function waitingSeatOf(state: GameState, current: Seat): Seat {
  return phaseViewOf(state, current).waitingSeat ?? current;
}

/** Pure host reducer (exported for tests). ok → replace game, append the
    formatted log, clear any stale rejection, re-derive the viewer; rejected
    → keep the game, surface the error (nonce-bumped so repeats
    re-announce). */
export function hostReducer(prev: HostState, event: HostEvent): HostState {
  if ("type" in event && event.type === "finishCoinFlip") {
    return prev.coinFlipPresentation !== null && prev.coinFlipBatch?.id === event.id
      ? { ...prev, coinFlipPresentation: null }
      : prev;
  }
  if (prev.coinFlipPresentation !== null) return prev;
  if ("type" in event) {
    const turnIndex = prev.turnIndex + (event.type === "previousTurn" ? -1 : 1);
    const turn = turnIndex === prev.turns.length - 1 ? prev.latestTurn : prev.turns[turnIndex];
    if (!turn) return prev;
    return { ...prev, ...turn, turnIndex, lastError: null };
  }
  const result = applyAction(prev.game, event.action);
  if (!result.ok) {
    return {
      ...prev,
      lastError: {
        code: result.error.code,
        message: result.error.message,
        nonce: (prev.lastError?.nonce ?? 0) + 1,
      },
    };
  }
  const entries = logFromEvents(result.events, {
    names: prev.names,
    state: result.state,
    elapsed: formatElapsed(event.at - prev.startedAt),
  });
  const flips = coinFlipsFromEvents(result.events, prev.names);
  const log = [...prev.log, ...entries];
  const viewerSeat = waitingSeatOf(result.state, prev.viewerSeat);
  const turn = { game: result.state, log, viewerSeat };
  // Preserve setup decisions and player handoffs as well as turn starts.
  // Automatic bonus draws resolve between checkpoints, so navigating history
  // never re-dispatches a draw and replaces the recorded future.
  const turns = prev.turns.slice(0, prev.turnIndex + 1);
  const setupHandoff =
    prev.game.turn === 0 &&
    (prev.game.phase.kind !== result.state.phase.kind ||
      prev.viewerSeat !== viewerSeat ||
      (prev.game.phase.kind === "setup:place" &&
        result.state.phase.kind === "setup:place" &&
        prev.game.phase.stage !== result.state.phase.stage));
  if (
    result.state.phase.kind !== "setup:drawExtra" &&
    (result.state.turn !== prev.game.turn || setupHandoff)
  ) {
    if (turns[prev.turnIndex]?.game.phase.kind === "setup:drawExtra") turns[prev.turnIndex] = turn;
    else turns.push(turn);
  }
  return {
    ...prev,
    coinFlipPresentation:
      flips.length > 0 ? { game: prev.game, log: prev.log, viewerSeat: prev.viewerSeat } : null,
    coinFlipBatch:
      flips.length > 0
        ? {
            id: (prev.coinFlipBatch?.id ?? 0) + 1,
            title: coinFlipTitle(prev.game, event.action),
            flips,
          }
        : prev.coinFlipBatch,
    game: result.state,
    log,
    // An accepted action makes any earlier rejection stale — and since the
    // viewer flip below also rides on accepted actions, clearing here is
    // what keeps a pill from leaking across the hot-seat handoff.
    lastError: null,
    viewerSeat,
    turns,
    turnIndex: turns.length - 1,
    latestTurn: turn,
  };
}

/** Initial host state from a fresh createGame (exported for tests). */
export function initHost(setup: LocalGameSetup): HostState {
  const log =
    setup.resume?.log ??
    logFromEvents(setup.events, {
      names: setup.names,
      state: setup.state,
      elapsed: formatElapsed(0),
    });
  const viewerSeat = waitingSeatOf(setup.state, setup.resume?.viewerSeat ?? "p1");
  const turns = setup.resume?.turns?.length
    ? setup.resume.turns
    : [{ game: setup.state, log, viewerSeat }];
  const turnIndex = Math.max(
    0,
    Math.min(setup.resume?.turnIndex ?? turns.length - 1, turns.length - 1),
  );
  return {
    coinFlipBatch: null,
    coinFlipPresentation: null,
    game: setup.state,
    names: setup.names,
    startedAt: setup.startedAt,
    log,
    lastError: null,
    viewerSeat,
    turns,
    turnIndex,
    latestTurn: setup.resume?.latestTurn ?? { game: setup.state, log, viewerSeat },
  };
}

export interface LocalGame {
  coinFlipBatch: CoinFlipBatch | null;
  finishCoinFlip: (id: number) => void;
  /** Full engine state — legitimate for a local hot-seat host (the HUD reads
      attacks/allowances from it); rendering still goes through `projection`. */
  game: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  /** The board and phase view for the CURRENT viewer — the only thing the
      playmat renders, and the only gate for input (waitingOn, D17). */
  projection: GameProjection;
  logEntries: ReturnType<typeof viewLogEntries>;
  lastError: GameError | null;
  dispatch: (action: GameAction) => void;
  previousTurn: () => void;
  nextTurn: () => void;
  previousTurnDisabled: boolean;
  nextTurnDisabled: boolean;
}

export function useLocalGame(
  setup: LocalGameSetup,
  onSave?: (snapshot: LocalGameSetup) => void,
): LocalGame {
  const [host, dispatchHost] = useReducer(hostReducer, setup, initHost);

  // Save the committed state before paint, so a refresh cannot roll back a
  // move already visible on the board. The reducer stays free of side effects.
  useLayoutEffect(() => {
    onSave?.({
      state: host.game,
      events: [],
      names: host.names,
      startedAt: host.startedAt,
      resume: {
        log: host.log,
        viewerSeat: host.viewerSeat,
        turns: host.turns,
        turnIndex: host.turnIndex,
        latestTurn: host.latestTurn,
      },
    });
  }, [
    host.game,
    host.log,
    host.names,
    host.startedAt,
    host.viewerSeat,
    host.turns,
    host.turnIndex,
    host.latestTurn,
    onSave,
  ]);

  const dispatch = useCallback((action: GameAction) => {
    dispatchHost({ action, at: Date.now() });
  }, []);
  const previousTurn = useCallback(() => dispatchHost({ type: "previousTurn" }), []);
  const nextTurn = useCallback(() => dispatchHost({ type: "nextTurn" }), []);
  const finishCoinFlip = useCallback((id: number) => dispatchHost({ type: "finishCoinFlip", id }), []);

  const presentation = host.coinFlipPresentation ?? host;
  const projection = useMemo(
    () => projectGameState(presentation.game, presentation.viewerSeat),
    [presentation.game, presentation.viewerSeat],
  );
  const logEntries = useMemo(
    () => viewLogEntries(presentation.log, presentation.viewerSeat),
    [presentation.log, presentation.viewerSeat],
  );

  return {
    coinFlipBatch: host.coinFlipPresentation === null ? null : host.coinFlipBatch,
    finishCoinFlip,
    game: presentation.game,
    viewerSeat: presentation.viewerSeat,
    names: host.names,
    projection,
    logEntries,
    lastError: host.lastError,
    dispatch,
    previousTurn,
    nextTurn,
    previousTurnDisabled: host.turnIndex === 0,
    nextTurnDisabled: host.turnIndex === host.turns.length - 1,
  };
}
