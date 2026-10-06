import { engineVersion } from "@luminous/engine";
import { readPersisted, writePersisted } from "../../lib/persistedState";
import { projectGameState } from "../game/projection";
import type { LocalGameSetup } from "../game/useLocalGame";

export const SIMULATOR_SAVE_KEY = "luminous:simulator:game";
const SAVE_VERSION = 1;

/** Full engine state includes the card pool, shuffled piles, RNG and effect
    continuations. Restoring never refetches decks or re-deals their cards. */
export function saveSimulator(snapshot: LocalGameSetup): void {
  writePersisted(
    SIMULATOR_SAVE_KEY,
    JSON.stringify({ version: SAVE_VERSION, engineVersion, snapshot }),
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
  if (
    !state ||
    !Number.isInteger(state.turn) ||
    !Number.isInteger(state.rngState) ||
    !state.phase ||
    !state.cardPool ||
    !state.cardIdByUid ||
    !Array.isArray(state.pending)
  )
    return;
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players?.[seat];
    if (
      !side ||
      ![side.hand, side.deck, side.discard, side.prizes, side.bench].every(Array.isArray)
    )
      return;
    // These are the same reads the board will make after restore. Malformed
    // snapshots throw here and readPersisted falls back to the deck picker.
    projectGameState(state, seat);
  }
  return snapshot;
}
