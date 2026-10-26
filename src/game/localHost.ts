// The local match's host state: a pure reducer around the engine's `applyAction`. The only
// impurity, the wall clock for log timestamps, comes in on the host event, stamped once per user
// gesture by the caller.

import type { ErrorCode, GameAction, GameEvent, GameState, Seat } from "@colorless/engine";
import { applyAction, formatElapsed, logFromEvents, phaseViewOf } from "@colorless/engine";
import type { SeatLogEntry } from "@colorless/schema";

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
  /** A table opened mid-game starts from this log and hot-seat viewer. */
  resume?: { log: SeatLogEntry[]; viewerSeat: Seat };
}

/** A place in the current line of play: the board after its first `actions`
    accepted actions, how much of the log was written by then, and who held
    the device. */
export interface LocalSnapshot {
  game: GameState;
  logLength: number;
  viewerSeat: Seat;
  actions: number;
}

/** One accepted action's outcome, for action-level undo/redo. `checkpoint`
    marks the steps that also began a turn (or a setup handoff) — the
    "undo turn" / "redo turn" stops — and `turnIndex` the turn-history index
    that was current after it. */
export interface LocalStep extends LocalSnapshot {
  checkpoint: boolean;
  turnIndex: number;
}

/** The phases whose decision the hot seat takes for the player. */
export type AutoPhase = "setup:drawExtra" | "ko:takePrizes";

/** An accepted action; `auto` names the phase in which the table took it for the player. */
export interface LocalAction {
  action: GameAction;
  /** Date.now() at dispatch — stamped by the wrapper, not the reducer. */
  at: number;
  auto?: AutoPhase;
}

/** Where a host stands in its line of play. */
export interface HostPosition {
  cursor: number;
  stepIndex: number;
  turnIndex: number;
}

export interface GameError {
  code: ErrorCode;
  message: string;
  /** Bumps on every rejection so an identical repeat re-announces. */
  nonce: number;
}

export interface HostState {
  game: GameState;
  names: Record<Seat, string>;
  startedAt: number;
  log: SeatLogEntry[];
  lastError: GameError | null;
  /** The hot-seat viewer — follows whoever must act (see waitingSeatOf). */
  viewerSeat: Seat;
  /** Where the match began; every snapshot is it plus a prefix of `actions`. */
  origin: { game: GameState; log: SeatLogEntry[]; viewerSeat: Seat };
  /** The current line of play, oldest first. Undo keeps its tail for redo; a
      new action replaces the tail. */
  actions: LocalAction[];
  /** How many of `actions` lead to `game`. */
  cursor: number;
  /** The log at the end of `actions`; every snapshot's log is a prefix of it. */
  lineLog: SeatLogEntry[];
  turns: LocalSnapshot[];
  turnIndex: number;
  latestTurn: LocalSnapshot;
  /** Every accepted action's outcome (newest last), the current one at `stepIndex`. */
  steps: LocalStep[];
  stepIndex: number;
}

type HostEvent =
  | LocalAction
  | { type: "previousTurn" | "nextTurn" }
  | { type: "undoAction" | "redoAction" | "undoTurn" | "redoTurn" };

/** Where an undo/redo lands in `steps`, or null when there is nowhere to go.
    Actions step one at a time; turns jump to the nearest checkpoint (the
    start of the current turn when mid-turn, else the previous turn), and
    "redo turn" to the next checkpoint or the newest step. */
export function stepTarget(
  host: Pick<HostState, "steps" | "stepIndex">,
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

function land(prev: HostState, at: LocalSnapshot): HostState {
  return {
    ...prev,
    game: at.game,
    log: at.logLength === prev.lineLog.length ? prev.lineLog : prev.lineLog.slice(0, at.logLength),
    viewerSeat: at.viewerSeat,
    cursor: at.actions,
    lastError: null,
  };
}

/** Pure host reducer (exported for tests). ok → replace game, append the
    formatted log, clear any stale rejection, re-derive the viewer; rejected
    → keep the game, surface the error (nonce-bumped so repeats
    re-announce). */
export function hostReducer(prev: HostState, event: HostEvent): HostState {
  if ("type" in event && event.type !== "previousTurn" && event.type !== "nextTurn") {
    const index = stepTarget(prev, event.type);
    const step = index === null ? undefined : prev.steps[index];
    if (index === null || !step) return prev;
    return {
      ...land(prev, step),
      turnIndex: Math.max(0, Math.min(step.turnIndex, prev.turns.length - 1)),
      stepIndex: index,
    };
  }
  if ("type" in event) {
    const turnIndex = prev.turnIndex + (event.type === "previousTurn" ? -1 : 1);
    const latest = turnIndex === prev.turns.length - 1;
    const turn = latest ? prev.latestTurn : prev.turns[turnIndex];
    if (!turn) return prev;
    // Land on the step that began this turn. A turn whose step was dropped
    // (it waited on an automatic decision) gets one back in its place.
    let steps = prev.steps;
    let stepIndex = latest ? steps.length - 1 : steps.findIndex((s) => s.actions === turn.actions);
    if (stepIndex < 0) {
      const after = steps.findIndex((s) => s.actions > turn.actions);
      stepIndex = after < 0 ? steps.length : after;
      steps = [
        ...steps.slice(0, stepIndex),
        { ...turn, checkpoint: true, turnIndex },
        ...steps.slice(stepIndex),
      ];
    }
    return { ...land(prev, turn), turnIndex, steps, stepIndex };
  }
  const next = accept(prev, prev.turns[prev.turnIndex], event);
  if (!next.ok) {
    return {
      ...prev,
      lastError: {
        code: next.error.code,
        message: next.error.message,
        nonce: (prev.lastError?.nonce ?? 0) + 1,
      },
    };
  }
  const log = [...prev.log, ...next.entries];
  const actions = [...prev.actions.slice(0, prev.cursor), event];
  const turn: LocalSnapshot = {
    game: next.state,
    logLength: log.length,
    viewerSeat: next.viewerSeat,
    actions: actions.length,
  };
  const turns = prev.turns.slice(0, prev.turnIndex + 1);
  if (next.replacesTurn) turns[prev.turnIndex] = turn;
  else if (next.checkpoint) turns.push(turn);
  const steps = [
    ...prev.steps.slice(0, prev.stepIndex + 1),
    { ...turn, checkpoint: next.checkpoint, turnIndex: turns.length - 1 },
  ];
  return {
    ...prev,

    game: next.state,
    log,
    // An accepted action makes any earlier rejection stale — and since the
    // viewer flip below also rides on accepted actions, clearing here is
    // what keeps a pill from leaking across the hot-seat handoff.
    lastError: null,
    viewerSeat: next.viewerSeat,
    actions,
    cursor: actions.length,
    lineLog: log,
    turns,
    turnIndex: turns.length - 1,
    latestTurn: turn,
    steps,
    stepIndex: steps.length - 1,
  };
}

/** The engine's answer to `event` at `prev`, with its log rows, the next
    viewer, and whether it begins a turn (replacing `turn`, the current turn
    snapshot, when that one still waits on bonus draws). */
function accept(
  prev: Pick<HostState, "game" | "names" | "startedAt" | "viewerSeat">,
  turn: LocalSnapshot | undefined,
  event: LocalAction,
) {
  const result = applyAction(prev.game, event.action);
  if (!result.ok) return result;
  const entries = logFromEvents(result.events, {
    names: prev.names,
    state: result.state,
    elapsed: formatElapsed(event.at - prev.startedAt),
  });
  const viewerSeat = waitingSeatOf(result.state, prev.viewerSeat);
  // Preserve setup decisions and player handoffs as well as turn starts.
  // Automatic bonus draws resolve between checkpoints, so navigating history
  // never re-dispatches a draw and replaces the recorded future.
  const setupHandoff =
    prev.game.turn === 0 &&
    (prev.game.phase.kind !== result.state.phase.kind ||
      prev.viewerSeat !== viewerSeat ||
      (prev.game.phase.kind === "setup:place" &&
        result.state.phase.kind === "setup:place" &&
        prev.game.phase.stage !== result.state.phase.stage));
  const checkpoint =
    result.state.phase.kind !== "setup:drawExtra" &&
    (result.state.turn !== prev.game.turn || setupHandoff);
  return {
    ok: true as const,
    state: result.state,
    entries,
    viewerSeat,
    checkpoint,
    replacesTurn: checkpoint && turn?.game.phase.kind === "setup:drawExtra",
  };
}

/** Drops the steps still waiting on an automatic decision. An automatic step
    belongs to the decision that caused it: history must not land on a pending
    one, which would take it again and drop the redo branch. */
export function dropAutoSteps(host: HostState, phase: AutoPhase): HostState {
  const steps = withoutPending(host.steps, phase);
  return { ...host, steps, stepIndex: steps.length - 1 };
}

const withoutPending = (steps: LocalStep[], phase: AutoPhase) =>
  steps.filter((step) => step.game.phase.kind !== phase);

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
  const start: LocalSnapshot = { game: setup.state, logLength: log.length, viewerSeat, actions: 0 };
  return {
    game: setup.state,
    names: setup.names,
    startedAt: setup.startedAt,
    log,
    lastError: null,
    viewerSeat,
    origin: { game: setup.state, log, viewerSeat },
    actions: [],
    cursor: 0,
    lineLog: log,
    turns: [start],
    turnIndex: 0,
    latestTurn: start,
    steps: [{ ...start, checkpoint: true, turnIndex: 0 }],
    stepIndex: 0,
  };
}

/** Rebuilds a match from its setup by playing its line through to the end,
    as `hostReducer` would one action at a time, dropping the automatic steps
    where the table dropped them. Null when the engine refuses an action. */
export function replayHost(
  setup: LocalGameSetup,
  actions: readonly LocalAction[],
): HostState | null {
  const start = initHost(setup);
  // The line only grows here, so it is built in place rather than copied per action.
  const log = [...start.log];
  const line: LocalAction[] = [];
  const turns = [...start.turns];
  let steps = [...start.steps];
  let at = start;
  for (const [i, entry] of actions.entries()) {
    const next = accept(at, turns.at(-1), entry);
    if (!next.ok) return null;
    log.push(...next.entries);
    line.push(entry);
    const turn: LocalSnapshot = {
      game: next.state,
      logLength: log.length,
      viewerSeat: next.viewerSeat,
      actions: line.length,
    };
    if (next.replacesTurn) turns[turns.length - 1] = turn;
    else if (next.checkpoint) turns.push(turn);
    steps.push({ ...turn, checkpoint: next.checkpoint, turnIndex: turns.length - 1 });
    if (entry.auto && actions[i + 1]?.auto !== entry.auto)
      steps = withoutPending(steps, entry.auto);
    at = { ...at, game: next.state, viewerSeat: next.viewerSeat, latestTurn: turn };
  }
  return {
    ...at,
    log,
    actions: line,
    cursor: line.length,
    lineLog: log,
    turns,
    turnIndex: turns.length - 1,
    steps,
    stepIndex: steps.length - 1,
  };
}

export function positionOf(host: HostState): HostPosition {
  return { cursor: host.cursor, stepIndex: host.stepIndex, turnIndex: host.turnIndex };
}

/** Moves a host at the end of its line back to `at`; null when no snapshot
    there is `at.cursor` actions in. */
export function restorePosition(host: HostState, at: HostPosition): HostState | null {
  if (
    at.cursor === host.cursor &&
    at.stepIndex === host.stepIndex &&
    at.turnIndex === host.turnIndex
  )
    return host;
  const step = host.steps[at.stepIndex];
  const turn = at.turnIndex === host.turns.length - 1 ? host.latestTurn : host.turns[at.turnIndex];
  if (!step || !turn) return null;
  const snapshot = [step, turn].find((s) => s.actions === at.cursor);
  if (!snapshot) return null;
  return { ...land(host, snapshot), stepIndex: at.stepIndex, turnIndex: at.turnIndex };
}
