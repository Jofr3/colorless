import { initHost, type LocalGameSetup } from "../game/useLocalGame";
import { loadSimulatorSave, saveSimulator } from "../playmat/simulatorSave";
import { SandboxSetupError } from "../playmat/prepareSandbox";

/** Hand off through the existing simulator save format, including its initial
 * event log. Navigate only after the full game can be restored successfully. */
export function launchSandbox(setup: LocalGameSetup, navigate: () => void) {
  const host = initHost(setup);
  saveSimulator({ ...setup, resume: { log: host.log, viewerSeat: host.viewerSeat } });
  if (loadSimulatorSave()?.startedAt !== setup.startedAt) {
    throw new SandboxSetupError(
      "Could not save the game in this browser. Free some browser storage and try again.",
    );
  }
  navigate();
}
