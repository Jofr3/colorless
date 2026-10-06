import { useState } from "react";
import { LocalMatch } from "../game/GamePage";
import type { LocalGameSetup } from "../game/useLocalGame";
import { SandboxSetup } from "./SandboxSetup";

/** Two selected decks playing a normal local, hot-seat game. */
export function Playmat() {
  const [setup, setSetup] = useState<LocalGameSetup | null>(null);

  return setup === null ? (
    <SandboxSetup onStart={setSetup} />
  ) : (
    <LocalMatch key={setup.startedAt} setup={setup} onPlayAgain={() => setSetup(null)} />
  );
}
