import { useState } from "react";
import { LocalMatch } from "../game/GamePage";
import type { LocalGameSetup } from "../game/useLocalGame";
import { SandboxSetup } from "./SandboxSetup";
import { clearSimulatorSave, loadSimulatorSave, saveSimulator } from "./simulatorSave";

const LEAVE_CONFIRM = {
  title: "Leave the sandbox?",
  message: "This will reset the current game and return to the main menu.",
};

/** Two selected decks playing a normal local, hot-seat game. */
export function Playmat() {
  const [setup, setSetup] = useState<LocalGameSetup | null>(loadSimulatorSave);

  function resetGame() {
    clearSimulatorSave();
    setSetup(null);
  }

  return setup === null ? (
    <SandboxSetup onStart={setSetup} />
  ) : (
    <LocalMatch
      key={setup.startedAt}
      setup={setup}
      chooseStartOrder
      onSave={saveSimulator}
      leaveConfirm={LEAVE_CONFIRM}
      onLeave={resetGame}
      onPlayAgain={resetGame}
    />
  );
}
