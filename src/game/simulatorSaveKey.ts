import { readPersisted } from "../lib/persistedState";

/** Where the sandbox keeps its match (see simulatorSave.ts, which reads and writes it). This
 * module stays a leaf: the page's eager bundle asks it whether a save exists, and anything that
 * imports the engine would pull the engine chunk into that bundle. */
export const SIMULATOR_SAVE_KEY = "colorless:simulator:game";
export const SAVE_VERSION = 2;

/** Whether a save of this format is stored, read without parsing or replaying it: a save opens
 * with its version, as saveSimulator writes it. A save this check passes may still fail to
 * restore (another engine, a broken record), and opening it then falls back to the deck picker. */
export function hasSimulatorSave(): boolean {
  return readPersisted(
    SIMULATOR_SAVE_KEY,
    (raw) => raw.startsWith(`{"version":${SAVE_VERSION},`),
    false,
  );
}
