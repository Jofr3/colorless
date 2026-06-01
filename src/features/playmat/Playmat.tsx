import { useCallback, useRef, useState, type PointerEvent } from "react";
import "./playmat.css";
import {
  benchLimitFor,
  CENTER_LINE_TOP,
  HIDDEN_CURSOR_POSITION,
  PLAYMAT_WRAPPER_CLASS,
} from "./constants";
import { gameLog, initialBoard, initialTurn } from "./data/mockPlaymat";
import { AnimatedCardsLayer } from "./components/AnimatedCardsLayer";
import { GameLog } from "./components/GameLog";
import { Hand } from "./components/Hand";
import { PlayerSide } from "./components/PlayerSide";
import { StadiumSlot } from "./components/StadiumSlot";
import { TurnBanner, TurnControls } from "./components/TurnHud";
import type { CardMoveRequest } from "./types";
import { moveCardOnBoard } from "./utils/cardMovement";
import { opponentOf } from "./utils/players";

function setCursorPosition(element: HTMLElement, x: number, y: number) {
  element.style.setProperty("--cursor-x", `${x}px`);
  element.style.setProperty("--cursor-y", `${y}px`);
}

function updateCursorPosition(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  setCursorPosition(event.currentTarget, event.clientX - rect.left, event.clientY - rect.top);
}

function hideCursorDots(event: PointerEvent<HTMLElement>) {
  setCursorPosition(event.currentTarget, HIDDEN_CURSOR_POSITION, HIDDEN_CURSOR_POSITION);
}

export function Playmat() {
  const [turn, setTurn] = useState(initialTurn);
  const [passAnimationKey, setPassAnimationKey] = useState(0);
  const [board, setBoard] = useState(initialBoard);
  const playmatRef = useRef<HTMLElement>(null);

  const bottomPlayer = turn.activePlayer;
  const topPlayer = opponentOf(bottomPlayer);
  // A bench-expanding stadium lifts the cap to 8 for both players.
  const benchLimit = benchLimitFor(board);

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
      onPointerMove={updateCursorPosition}
      onPointerLeave={hideCursorDots}
    >
      <span className="sr-only" data-perspective-player={bottomPlayer} aria-hidden="true" />
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
