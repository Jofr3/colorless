import { initHost, type LocalGameSetup } from "../game/localHost";
import { saveSimulator } from "../game/simulatorSave";
import { SandboxSetupError } from "../game/sandboxSetupError";

/** Hand off through the simulator save, including the initial event log.
 * Navigate only once the save is stored. */
export function launchSandbox(setup: LocalGameSetup, navigate: () => void) {
  if (!saveSimulator(initHost(setup))) {
    throw new SandboxSetupError(
      "Could not save the game in this browser. Free some browser storage and try again.",
    );
  }
  navigate();
}
