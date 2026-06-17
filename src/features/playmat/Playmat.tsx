import { useCallback, useEffect, useRef, useState } from "react";
import "./playmat.css";
import { benchLimitFor, CENTER_LINE_TOP, PLAYMAT_WRAPPER_CLASS } from "./constants";
import { gameLog, initialBoard, initialTurn } from "./data/mockPlaymat";
import { AnimatedCardsLayer } from "./components/AnimatedCardsLayer";
import { BackToMenu } from "./components/BackToMenu";
import { GameLog } from "./components/GameLog";
import { Hand } from "./components/Hand";
import { PlayerSide } from "./components/PlayerSide";
import { StadiumSlot } from "./components/StadiumSlot";
import { TurnBanner, TurnControls } from "./components/TurnHud";
import type { CardMoveRequest } from "./types";
import { moveCardOnBoard } from "./utils/cardMovement";
import { opponentOf } from "./utils/players";

export function Playmat() {
  const [turn, setTurn] = useState(initialTurn);
  const [passAnimationKey, setPassAnimationKey] = useState(0);
  const [board, setBoard] = useState(initialBoard);
  const playmatRef = useRef<HTMLElement>(null);

  const bottomPlayer = turn.activePlayer;
  const topPlayer = opponentOf(bottomPlayer);
  // A bench-expanding stadium lifts the cap to 8 for both players.
  const benchLimit = benchLimitFor(board);

  // Mirror the active player onto <body> so the shared background glow
  // (index.css) flips blue/red top-to-bottom on the opponent's turn.
  useEffect(() => {
    document.body.dataset.perspective = bottomPlayer;
    return () => {
      delete document.body.dataset.perspective;
    };
  }, [bottomPlayer]);

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
    <section
      ref={playmatRef}
      className={`${PLAYMAT_WRAPPER_CLASS} has-pixi-cards`}
      aria-label="Trading card game playmat"
    >
      <PlayerSide
        owner={topPlayer}
        player={board[topPlayer]}
        side="top"
        activeTurn={turn.activePlayer === topPlayer}
        benchLimit={benchLimit}
      />
      <PlayerSide
        owner={bottomPlayer}
        player={board[bottomPlayer]}
        side="bottom"
        activeTurn={turn.activePlayer === bottomPlayer}
        benchLimit={benchLimit}
      />
      <Hand cards={board[bottomPlayer].hand} owner={bottomPlayer} />
      <div
        className="absolute z-10"
        style={{
          left: "50%",
          top: CENTER_LINE_TOP,
          transform: "translate(calc(-150% - var(--side-gap) - 24px), -50%)",
        }}
      >
        <StadiumSlot card={board.stadium} />
      </div>
      <TurnControls onPassTurn={passTurn} />
      <TurnBanner info={turn} passAnimationKey={passAnimationKey} />
      <BackToMenu />
      <GameLog entries={gameLog} turn={turn.turn} />
      <AnimatedCardsLayer
        board={board}
        perspectivePlayer={bottomPlayer}
        backDesign="twilight"
        playmatRef={playmatRef}
        onMoveCard={handleMoveCard}
      />
    </section>
  );
}
