import { useEffect, useRef, type ReactNode } from "react";
import "./playmat.css";
import { benchLimitFor, CENTER_LINE_TOP, PLAYMAT_WRAPPER_CLASS } from "./constants";
import { AnimatedCardsLayer } from "./components/AnimatedCardsLayer";
import { BackToMenu, type LeaveConfirmCopy } from "./components/BackToMenu";
import { BoardSummary } from "./components/BoardSummary";
import { GameLog } from "./components/GameLog";
import { Hand } from "./components/Hand";
import { EnergyChoiceArea } from "./components/EnergyChoiceArea";
import { PlayerSide } from "./components/PlayerSide";
import { StadiumSlot } from "./components/StadiumSlot";
import { TurnBanner, TurnControls } from "./components/TurnHud";
import type { BoardState, CardMoveRequest, LogEntry, PileState, PlayerId, TurnInfo } from "./types";
import type { PlacementPredicate } from "./utils/cardMovement";
import { opponentOf } from "./utils/players";

export interface PlaymatViewProps {
  board: BoardState;
  /** Suspend board input while a tabletop effect resolves. */
  interactionDisabled?: boolean;
  turn: TurnInfo;
  /** Which board side renders at the bottom (hand shown, cards draggable).
      The mock passes the active player; the game page always passes "you"
      (its projection is re-based per viewer). */
  perspective: PlayerId;
  /** What <body data-perspective> gets (drives the shared background glow).
      Defaults to `perspective`; the game page overrides it per seat so the
      glow still flips in hot-seat play, where `perspective` is fixed. */
  glowPerspective?: PlayerId;
  onMoveCard: (request: CardMoveRequest) => void;
  /** Give the board its own ⟶ pass control by giving it something to call
      (P5-4). Absent — the /play and online drivers — no control is rendered: on
      those surfaces the turn panel covers that corner exactly when passing is
      legal, so the panel carries its own `Pass` instead. */
  onPassTurn?: () => void;
  passDisabled?: boolean;
  passAnimationKey?: number;
  logEntries: LogEntry[];
  /** Deck counts + public discards — the game projection's `piles`. */
  piles?: Record<PlayerId, PileState>;
  /** Optional drag-legality gate, forwarded untouched to AnimatedCardsLayer;
      absent (the mock) every placement stays allowed. */
  placementPredicate?: PlacementPredicate;
  /** Optional override for the Back control's confirmation copy; absent, it asks
      the local /play question. The online match replaces it because leaving there
      forfeits the game (P4 3c-iv). */
  leaveConfirm?: LeaveConfirmCopy;
  /** Called only after the player confirms leaving, before returning home. */
  onLeave?: () => void;
  /** Page-level HUD overlay (phase panels, dialogs, banners). Rendered last,
      above the card canvas. */
  children?: ReactNode;
}

/** The presentational playmat shell: renders whatever board/turn/log it is
    handed and reports interactions upward — it owns no game state. Local
    Play and online matches provide their respective engine projections. */
export function PlaymatView({
  board,
  interactionDisabled = false,
  turn,
  perspective,
  glowPerspective,
  onMoveCard,
  onPassTurn,
  passDisabled = false,
  passAnimationKey = 0,
  logEntries,
  piles,
  placementPredicate,
  leaveConfirm,
  onLeave,
  children,
}: PlaymatViewProps) {
  const playmatRef = useRef<HTMLElement>(null);

  const bottomPlayer = perspective;
  const topPlayer = opponentOf(bottomPlayer);
  // A bench-expanding stadium lifts the cap to 8 for both players.
  // 🆕🆕🆕 D577 — PER SEAT: Area Zero Underdepths widens only a side with a Tera Pokémon.
  const topBenchLimit = benchLimitFor(board, topPlayer);
  const bottomBenchLimit = benchLimitFor(board, bottomPlayer);

  // Mirror the perspective onto <body> so the shared background glow
  // (index.css) flips blue/red top-to-bottom on the opponent's turn.
  const bodyPerspective = glowPerspective ?? perspective;
  useEffect(() => {
    document.body.dataset.perspective = bodyPerspective;
    return () => {
      delete document.body.dataset.perspective;
    };
  }, [bodyPerspective]);

  return (
    <section
      ref={playmatRef}
      className={`${PLAYMAT_WRAPPER_CLASS} has-pixi-cards`}
      aria-label="Trading card game playmat"
    >
      <div className="contents" inert={interactionDisabled || undefined}>
        {/* A drop-only surface for Items and Supporters, outside the hand. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{ bottom: "var(--hand-h)" }}
          aria-hidden="true"
          data-card-drop-zone="true"
          data-card-owner={bottomPlayer}
          data-card-zone="playmat"
        />
        {/* Screen-reader-only mirror of the board (the canvas is aria-hidden). */}
        <BoardSummary board={board} perspectivePlayer={bottomPlayer} piles={piles} />
        <PlayerSide
          owner={topPlayer}
          player={board[topPlayer]}
          side="top"
          activeTurn={turn.activePlayer === topPlayer}
          benchLimit={topBenchLimit}
          pile={piles?.[topPlayer]}
        />
        <PlayerSide
          owner={bottomPlayer}
          player={board[bottomPlayer]}
          side="bottom"
          activeTurn={turn.activePlayer === bottomPlayer}
          benchLimit={bottomBenchLimit}
          pile={piles?.[bottomPlayer]}
        />
        <Hand cards={board[bottomPlayer].hand} owner={bottomPlayer} />
        <EnergyChoiceArea board={board} onMoveCard={onMoveCard} />
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
        {onPassTurn && <TurnControls onPassTurn={onPassTurn} passDisabled={passDisabled} />}
        <TurnBanner info={turn} passAnimationKey={passAnimationKey} />
        <BackToMenu confirm={leaveConfirm} onLeave={onLeave} />
        <GameLog entries={logEntries} turn={turn.turn} />
        <AnimatedCardsLayer
          board={board}
          perspectivePlayer={bottomPlayer}
          backDesign="twilight"
          playmatRef={playmatRef}
          onMoveCard={onMoveCard}
          placementPredicate={placementPredicate}
        />
      </div>
      {children}
    </section>
  );
}
