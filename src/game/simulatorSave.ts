import { engineVersion, type GameState } from "@colorless/engine";
import { readPersisted, writePersisted } from "../lib/persistedState";
import { projectGameState } from "./projection";
import type { LocalGameSetup, LocalTurnSnapshot } from "./localHost";

const SIMULATOR_SAVE_KEY = "colorless:simulator:game";
const SAVE_VERSION = 1;

/** Full engine state includes the card pool, shuffled piles, RNG and effect
    continuations. Restoring never refetches decks or re-deals their cards. */
export function saveSimulator(snapshot: LocalGameSetup): void {
  // Every turn uses the same catalog and UID mapping. Store those once in the
  // current state to avoid duplicating them throughout the saved history.
  const compactTurn = (turn: LocalTurnSnapshot) => ({
    ...turn,
    game: { ...turn.game, cardPool: undefined, cardIdByUid: undefined },
  });
  const savedSnapshot = snapshot.resume
    ? {
        ...snapshot,
        resume: {
          ...snapshot.resume,
          turns: snapshot.resume.turns?.map(compactTurn),
          latestTurn: snapshot.resume.latestTurn
            ? compactTurn(snapshot.resume.latestTurn)
            : undefined,
          steps: snapshot.resume.steps?.map((step) => ({ ...step, ...compactTurn(step) })),
        },
      }
    : snapshot;
  writePersisted(
    SIMULATOR_SAVE_KEY,
    JSON.stringify({ version: SAVE_VERSION, engineVersion, snapshot: savedSnapshot }),
  );
}

export function clearSimulatorSave(): void {
  try {
    localStorage.removeItem(SIMULATOR_SAVE_KEY);
  } catch {
    // Storage may be unavailable; starting a new game must still work.
  }
}

export function loadSimulatorSave(): LocalGameSetup | null {
  return readPersisted(SIMULATOR_SAVE_KEY, parseSave, null);
}

function parseSave(raw: string): LocalGameSetup | undefined {
  const record = JSON.parse(raw) as {
    version?: number;
    engineVersion?: string;
    snapshot?: LocalGameSetup;
  } | null;
  // Engine changes can alter parked operations as well as board fields. Never
  // feed an older engine's continuation into a newer rules implementation.
  if (record?.version !== SAVE_VERSION || record.engineVersion !== engineVersion) return;
  const snapshot = record.snapshot;
  if (!snapshot || !Number.isFinite(snapshot.startedAt)) return;
  if (typeof snapshot.names?.p1 !== "string" || typeof snapshot.names?.p2 !== "string") return;
  if (!Array.isArray(snapshot.events) || !Array.isArray(snapshot.resume?.log)) return;
  const viewer = snapshot.resume?.viewerSeat;
  if (viewer !== "p1" && viewer !== "p2") return;
  const state = snapshot.state;
  if (!validState(state)) return;
  const resume = snapshot.resume;
  if (resume?.turns !== undefined) {
    if (
      !Array.isArray(resume.turns) ||
      resume.turns.length === 0 ||
      !Number.isInteger(resume.turnIndex) ||
      resume.turnIndex === undefined ||
      resume.turnIndex < 0 ||
      resume.turnIndex >= resume.turns.length ||
      !resume.latestTurn
    )
      return;
    const restoreTurn = (turn: LocalTurnSnapshot): LocalTurnSnapshot => {
      if (
        !turn ||
        !Array.isArray(turn.log) ||
        (turn.viewerSeat !== "p1" && turn.viewerSeat !== "p2")
      ) {
        throw new Error("Invalid saved turn");
      }
      const game = { ...turn.game, cardPool: state.cardPool, cardIdByUid: state.cardIdByUid };
      if (!validState(game)) throw new Error("Invalid saved turn state");
      return { ...turn, game };
    };
    resume.turns = resume.turns.map(restoreTurn);
    resume.latestTurn = restoreTurn(resume.latestTurn);
    // Action history is optional; a malformed one is dropped, not fatal.
    if (
      Array.isArray(resume.steps) &&
      resume.steps.length > 0 &&
      Number.isInteger(resume.stepIndex) &&
      (resume.stepIndex ?? -1) >= 0 &&
      (resume.stepIndex ?? 0) < resume.steps.length &&
      resume.steps.every(
        (step) => typeof step?.checkpoint === "boolean" && Number.isInteger(step.turnIndex),
      )
    ) {
      try {
        resume.steps = resume.steps.map((step) => ({ ...step, ...restoreTurn(step) }));
      } catch {
        resume.steps = undefined;
        resume.stepIndex = undefined;
      }
    } else {
      resume.steps = undefined;
      resume.stepIndex = undefined;
    }
    if (
      resume.turns[resume.turnIndex]?.game.turn !== state.turn ||
      resume.turns.at(-1)?.game.turn !== resume.latestTurn.game.turn ||
      resume.turns.some(
        (turn, index) =>
          index > 0 &&
          (turn.game.turn < (resume.turns?.[index - 1]?.game.turn ?? 0) ||
            (turn.game.turn > 0 && turn.game.turn === resume.turns?.[index - 1]?.game.turn)),
      )
    )
      return;
  }
  return snapshot;
}

function validState(state: GameState): boolean {
  if (
    !state ||
    !Number.isInteger(state.turn) ||
    !Number.isInteger(state.rngState) ||
    !state.phase ||
    !state.cardPool ||
    !state.cardIdByUid ||
    !Array.isArray(state.pending)
  )
    return false;
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players?.[seat];
    if (
      !side ||
      ![side.hand, side.deck, side.discard, side.prizes, side.bench].every(Array.isArray)
    )
      return false;
    // These are the same reads the board will make after restore. Malformed
    // snapshots throw here and readPersisted falls back to the deck picker.
    projectGameState(state, seat);
  }
  return true;
}
