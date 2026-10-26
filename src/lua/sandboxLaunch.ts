import { initHost, type LocalGameSetup } from "../game/localHost";
import { saveSimulator } from "../game/simulatorSave";
import { SandboxSetupError } from "../game/prepareSandbox";

/** Hand off through the existing simulator save format, including its initial
 * event log. Navigate only once the save is stored. */
export function launchSandbox(setup: LocalGameSetup, navigate: () => void) {
  const host = initHost(setup);
  if (!saveSimulator({ ...setup, resume: { log: host.log, viewerSeat: host.viewerSeat } })) {
    throw new SandboxSetupError(
      "Could not save the game in this browser. Free some browser storage and try again.",
    );
  }
  navigate();
}
