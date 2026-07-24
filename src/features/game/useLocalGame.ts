// The /play page's state owner: one useReducer over a pure host reducer that
// wraps the engine's applyAction (D14 — total, never throws, never mutates).
// StrictMode double-invokes reducers, so everything the reducer produces
// (game, log, error) lives in the reducer's returned state — nothing is
// pushed from effects — and the only impurity (the wall clock for log
// timestamps) rides IN on the dispatched host event, stamped once per user
// gesture by the dispatch wrapper.

import { useCallback, useMemo, useReducer } from "react";
import type { ErrorCode, GameAction, GameEvent, GameState, Seat } from "@luminous/engine";
import { applyAction, formatElapsed, logFromEvents, phaseViewOf } from "@luminous/engine";
import type { SeatLogEntry } from "@luminous/schema";
import { projectGameState, type GameProjection } from "./projection";
import { viewLogEntries } from "./viewLog";

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
}

export interface GameError {
  code: ErrorCode;
  message: string;
  /** Bumps on every rejection so an identical repeat re-announces. */
  nonce: number;
}

interface HostState {
  game: GameState;
  names: Record<Seat, string>;
  startedAt: number;
  log: SeatLogEntry[];
  lastError: GameError | null;
  /** The hot-seat viewer — follows whoever must act (see waitingSeatOf). */
  viewerSeat: Seat;
}

interface HostEvent {
  action: GameAction;
  /** Date.now() at dispatch — stamped by the wrapper, not the reducer. */
  at: number;
}

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
  return {
    ...prev,
    game: result.state,
    log: [...prev.log, ...entries],
    // An accepted action makes any earlier rejection stale — and since the
    // viewer flip below also rides on accepted actions, clearing here is
    // what keeps a pill from leaking across the hot-seat handoff.
    lastError: null,
    viewerSeat: waitingSeatOf(result.state, prev.viewerSeat),
  };
}

/** Initial host state from a fresh createGame (exported for tests). */
export function initHost(setup: LocalGameSetup): HostState {
  return {
    game: setup.state,
    names: setup.names,
    startedAt: setup.startedAt,
    log: logFromEvents(setup.events, {
      names: setup.names,
      state: setup.state,
      elapsed: formatElapsed(0),
    }),
    lastError: null,
    viewerSeat: waitingSeatOf(setup.state, "p1"),
  };
}

export interface LocalGame {
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
}

export function useLocalGame(setup: LocalGameSetup): LocalGame {
  const [host, dispatchHost] = useReducer(hostReducer, setup, initHost);

  const dispatch = useCallback((action: GameAction) => {
    dispatchHost({ action, at: Date.now() });
  }, []);

  const projection = useMemo(
    () => projectGameState(host.game, host.viewerSeat),
    [host.game, host.viewerSeat],
  );
  const logEntries = useMemo(
    () => viewLogEntries(host.log, host.viewerSeat),
    [host.log, host.viewerSeat],
  );

  return {
    game: host.game,
    viewerSeat: host.viewerSeat,
    names: host.names,
    projection,
    logEntries,
    lastError: host.lastError,
    dispatch,
  };
}
