import { useState } from "react";
import { LocalMatch } from "./LocalMatch";
import type { LocalGameSetup } from "./useLocalGame";
import { SandboxSetup } from "../playmat/SandboxSetup";
import { clearSimulatorSave, loadSimulatorSave, saveSimulator } from "../playmat/simulatorSave";

const LEAVE_CONFIRM = {
  title: "Leave the game?",
  message: "This will reset the current game and return to the main menu.",
};

/** Two selected decks playing a normal local, hot-seat game. */
export function GamePage() {
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
