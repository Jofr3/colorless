import { useCallback, useState } from "react";
import { gameLog, initialBoard, initialTurn } from "./data/mockPlaymat";
import { PlaymatView } from "./PlaymatView";
import type { CardMoveRequest } from "./types";
import { moveCardOnBoard } from "./utils/cardMovement";
import { opponentOf } from "./utils/players";

/** The /simulator sandbox: the mock board, freely mutated by drag-and-drop —
    exactly the pre-engine behavior, now expressed as a driver of the shared
    PlaymatView shell (the /play game page is the other driver). */
export function Playmat() {
  const [turn, setTurn] = useState(initialTurn);
  const [passAnimationKey, setPassAnimationKey] = useState(0);
  const [board, setBoard] = useState(initialBoard);

  function passTurn() {
    setPassAnimationKey((key) => key + 1);
    setTurn((current) => ({
      ...current,
      turn: current.turn + 1,
      activePlayer: opponentOf(current.activePlayer),
    }));
  }

  const handleMoveCard = useCallback((req: CardMoveRequest) => {
    setBoard((b) => moveCardOnBoard(b, req));
  }, []);

  return (
    <PlaymatView
      board={board}
      turn={turn}
      perspective={turn.activePlayer}
      onMoveCard={handleMoveCard}
      onPassTurn={passTurn}
      passAnimationKey={passAnimationKey}
      logEntries={gameLog}
    />
  );
}
