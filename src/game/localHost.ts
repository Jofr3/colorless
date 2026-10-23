// The local match's host state: a pure reducer around the engine's `applyAction`. The only
// impurity, the wall clock for log timestamps, comes in on the host event, stamped once per user
// gesture by the caller.

import type { ErrorCode, GameAction, GameEvent, GameState, Seat } from "@colorless/engine";
import { applyAction, formatElapsed, logFromEvents, phaseViewOf } from "@colorless/engine";
import type { SeatLogEntry } from "@colorless/schema";
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
    steps?: LocalStep[];
    stepIndex?: number;
  };
}

export interface LocalTurnSnapshot {
  game: GameState;
  log: SeatLogEntry[];
  viewerSeat: Seat;
}

/** One accepted action's outcome, for action-level undo/redo. `checkpoint`
    marks the steps that also began a turn (or a setup handoff) — the
    "undo turn" / "redo turn" stops — and `turnIndex` the turn-history index
    that was current after it. */
export interface LocalStep extends LocalTurnSnapshot {
  checkpoint: boolean;
  turnIndex: number;
}

/** How many accepted actions stay undoable (and get saved). */
const MAX_STEPS = 40;

export interface GameError {
  code: ErrorCode;
  message: string;
  /** Bumps on every rejection so an identical repeat re-announces. */
  nonce: number;
}

interface HostState {
  /** Public KO identities from the last action, for transient table effects. */
  knockedOut: readonly string[];
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
  /** Every accepted action's outcome (newest last), the current one at `stepIndex`. */
  steps: LocalStep[];
  stepIndex: number;
}

interface HostActionEvent {
  action: GameAction;
  /** Date.now() at dispatch — stamped by the wrapper, not the reducer. */
  at: number;
}

type HostEvent =
  | HostActionEvent
  | { type: "previousTurn" | "nextTurn" }
  | { type: "undoAction" | "redoAction" | "undoTurn" | "redoTurn" }
  | { type: "finishCoinFlip"; id: number };

/** Where an undo/redo lands in `steps`, or null when there is nowhere to go.
    Actions step one at a time; turns jump to the nearest checkpoint (the
    start of the current turn when mid-turn, else the previous turn), and
    "redo turn" to the next checkpoint or the newest step. */
export function stepTarget(
  host: HostState,
  type: "undoAction" | "redoAction" | "undoTurn" | "redoTurn",
): number | null {
  const { steps, stepIndex } = host;
  // A step whose state is still inside a card's prompt (Brock's Scouting
  // waiting for its pick) is not a place to land: undoing a resolved Trainer
  // puts the card back in hand rather than reopening its prompt, and redo
  // replays it through to the pick.
  const settled = (i: number) => steps[i]?.game.phase.kind !== "effect:choose";
  if (type === "undoAction") {
    if (stepIndex === 0) return null;
    for (let i = stepIndex - 1; i > 0; i--) if (settled(i)) return i;
    return 0;
  }
  if (type === "redoAction") {
    if (stepIndex >= steps.length - 1) return null;
    for (let i = stepIndex + 1; i < steps.length - 1; i++) if (settled(i)) return i;
    return steps.length - 1;
  }
  if (type === "undoTurn") {
    if (stepIndex === 0) return null;
    for (let i = stepIndex - 1; i > 0; i--) if (steps[i]?.checkpoint) return i;
    return 0;
  }
  if (stepIndex >= steps.length - 1) return null;
  for (let i = stepIndex + 1; i < steps.length; i++) if (steps[i]?.checkpoint) return i;
  return steps.length - 1;
}

/**
 * The seat the hot-seat screen hands the device to, from `phaseViewOf`, made sticky when nobody is
 * waited on (gameOver). Never derive it from turn ownership: during ko:promote the actor is the
 * non-turn player.
 */
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
  if ("type" in event && event.type !== "previousTurn" && event.type !== "nextTurn") {
    const index = stepTarget(prev, event.type);
    const step = index === null ? undefined : prev.steps[index];
    if (!step) return prev;
    return {
      ...prev,
      game: step.game,
      knockedOut: [],
      log: step.log,
      viewerSeat: step.viewerSeat,
      turnIndex: Math.max(0, Math.min(step.turnIndex, prev.turns.length - 1)),
      stepIndex: index as number,
      lastError: null,
    };
  }
  if ("type" in event) {
    const turnIndex = prev.turnIndex + (event.type === "previousTurn" ? -1 : 1);
    const turn = turnIndex === prev.turns.length - 1 ? prev.latestTurn : prev.turns[turnIndex];
    if (!turn) return prev;
    // Land on the step that began this turn; without one (an older save),
    // the action history restarts here.
    let stepIndex = prev.steps.findIndex((s) => s.checkpoint && s.turnIndex === turnIndex);
    if (turnIndex === prev.turns.length - 1) stepIndex = prev.steps.length - 1;
    const steps = stepIndex >= 0 ? prev.steps : [{ ...turn, checkpoint: true, turnIndex }];
    return {
      ...prev,
      ...turn,
      knockedOut: [],
      turnIndex,
      steps,
      stepIndex: Math.max(0, stepIndex),
      lastError: null,
    };
  }
  const result = applyAction(prev.game, event.action);
  if (!result.ok) {
    return {
      ...prev,
      knockedOut: [],
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
  let checkpoint = false;
  if (
    result.state.phase.kind !== "setup:drawExtra" &&
    (result.state.turn !== prev.game.turn || setupHandoff)
  ) {
    if (turns[prev.turnIndex]?.game.phase.kind === "setup:drawExtra") turns[prev.turnIndex] = turn;
    else turns.push(turn);
    checkpoint = true;
  }
  const steps = [
    ...prev.steps.slice(0, prev.stepIndex + 1),
    { ...turn, checkpoint, turnIndex: turns.length - 1 },
  ].slice(-MAX_STEPS);
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
    knockedOut: result.events.flatMap((e) => (e.type === "KNOCKED_OUT" ? [e.uid] : [])),
    log,
    // An accepted action makes any earlier rejection stale — and since the
    // viewer flip below also rides on accepted actions, clearing here is
    // what keeps a pill from leaking across the hot-seat handoff.
    lastError: null,
    viewerSeat,
    turns,
    turnIndex: turns.length - 1,
    latestTurn: turn,
    steps,
    stepIndex: steps.length - 1,
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
  const current = { game: setup.state, log, viewerSeat };
  const savedSteps = setup.resume?.steps;
  const steps = savedSteps?.length ? savedSteps : [{ ...current, checkpoint: true, turnIndex }];
  const stepIndex = Math.max(
    0,
    Math.min(setup.resume?.stepIndex ?? steps.length - 1, steps.length - 1),
  );
  return {
    coinFlipBatch: null,
    knockedOut: [],
    coinFlipPresentation: null,
    game: setup.state,
    names: setup.names,
    startedAt: setup.startedAt,
    log,
    lastError: null,
    viewerSeat,
    turns,
    turnIndex,
    latestTurn: setup.resume?.latestTurn ?? current,
    steps,
    stepIndex,
  };
}
