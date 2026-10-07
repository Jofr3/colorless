import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SetupAnimationStage } from "./utils/setupDeals";
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
import type {
  BoardState,
  CardBackTone,
  CardMoveRequest,
  LogEntry,
  PileState,
  PlayerId,
  TurnInfo,
} from "./types";
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
      glow still rotates in hot-seat play, where `perspective` is fixed. */
  glowPerspective?: PlayerId;
  onMoveCard: (request: CardMoveRequest) => void;
  /** Right-edge pass control, with optional local turn-history navigation. */
  onPassTurn?: () => void;
  passDisabled?: boolean;
  onPreviousTurn?: () => void;
  onNextTurn?: () => void;
  previousTurnDisabled?: boolean;
  nextTurnDisabled?: boolean;
  passAnimationKey?: number;
  logEntries: LogEntry[];
  /** Deck counts + public discards — the game projection's `piles`. */
  piles?: Record<PlayerId, PileState>;
  /** Optional drag-legality gate, forwarded untouched to AnimatedCardsLayer;
      absent (the mock) every placement stays allowed. */
  placementPredicate?: PlacementPredicate;
  /** Hand Trainer ids that can currently be used; drives the drag label and release. */
  usableTrainerIds?: ReadonlySet<string>;
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
  onPreviousTurn,
  onNextTurn,
  previousTurnDisabled = true,
  nextTurnDisabled = true,
  passAnimationKey = 0,
  logEntries,
  piles,
  placementPredicate,
  usableTrainerIds,
  leaveConfirm,
  onLeave,
  children,
}: PlaymatViewProps) {
  const playmatRef = useRef<HTMLElement>(null);
  const [setupAnimation, setSetupAnimation] = useState<SetupAnimationStage | null>(null);
  const [pendingMulliganDraws, setPendingMulliganDraws] = useState<Record<CardBackTone, number>>({
    blue: 0,
    red: 0,
  });
  const cardsAnimating = setupAnimation !== null;
  const setupAnimating = cardsAnimating && setupAnimation !== "turn-draw";
  const displayedTurn = setupAnimating && turn.turn > 0 ? { ...turn, turn: 0 } : turn;

  const bottomPlayer = perspective;
  const topPlayer = opponentOf(bottomPlayer);
  // A bench-expanding stadium lifts the cap to 8 for both players.
  // 🆕🆕🆕 D577 — PER SEAT: Area Zero Underdepths widens only a side with a Tera Pokémon.
  const topBenchLimit = benchLimitFor(board, topPlayer);
  const bottomBenchLimit = benchLimitFor(board, bottomPlayer);

  // Mirror the perspective onto <body> so the shared background glow
  // (index.css) rotates blue/red around the board on the opponent's turn.
  const bodyPerspective = glowPerspective ?? perspective;
  // Keep card backs tied to the physical seats when the hot-seat projection re-bases.
  const blueBackPlayer = bodyPerspective === "you" ? bottomPlayer : topPlayer;
  function displayedPile(owner: PlayerId): PileState | undefined {
    const pile = piles?.[owner];
    if (!pile) return undefined;
    const tone = owner === blueBackPlayer ? "blue" : "red";
    return {
      ...pile,
      mulliganCount: Math.max(pile.mulliganCount ?? 0, pendingMulliganDraws[tone]),
    };
  }
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
      data-setup-animation={setupAnimation ?? undefined}
    >
      <div className="contents" inert={interactionDisabled || cardsAnimating || undefined}>
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
          blueBackPlayer={blueBackPlayer}
          player={board[topPlayer]}
          side="top"
          activeTurn={turn.activePlayer === topPlayer}
          benchLimit={topBenchLimit}
          pile={displayedPile(topPlayer)}
        />
        <PlayerSide
          owner={bottomPlayer}
          blueBackPlayer={blueBackPlayer}
          player={board[bottomPlayer]}
          side="bottom"
          activeTurn={turn.activePlayer === bottomPlayer}
          benchLimit={bottomBenchLimit}
          pile={displayedPile(bottomPlayer)}
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
        {onPassTurn && (
          <TurnControls
            onPassTurn={onPassTurn}
            passDisabled={passDisabled}
            onPreviousTurn={onPreviousTurn}
            onNextTurn={onNextTurn}
            previousTurnDisabled={previousTurnDisabled}
            nextTurnDisabled={nextTurnDisabled}
          />
        )}
        <TurnBanner info={displayedTurn} passAnimationKey={passAnimationKey} />
        <BackToMenu confirm={leaveConfirm} onLeave={onLeave} />
        <GameLog entries={logEntries} turn={turn.turn} />
        <AnimatedCardsLayer
          board={board}
          perspectivePlayer={bottomPlayer}
          backDesign="twilight"
          blueBackPlayer={blueBackPlayer}
          turnNumber={turn.turn}
          activePlayer={turn.activePlayer}
          deckCounts={piles && { you: piles.you.deckCount, opponent: piles.opponent.deckCount }}
          piles={piles}
          holdSetupReveal={setupAnimating && turn.turn > 0}
          onSetupAnimationChange={setSetupAnimation}
          onPendingMulliganDrawsChange={setPendingMulliganDraws}
          playmatRef={playmatRef}
          onMoveCard={onMoveCard}
          placementPredicate={placementPredicate}
          usableTrainerIds={usableTrainerIds}
        />
      </div>
      <div className="contents" inert={cardsAnimating || undefined}>
        {(!cardsAnimating || turn.turn === 0) && children}
      </div>
      {cardsAnimating && (
        <output className="sr-only" aria-live="polite">
          {setupAnimation === "prizes"
            ? "Setting Prize cards."
            : setupAnimation === "draw"
              ? "Drawing mulligan bonus cards."
              : "Drawing a card for the turn."}
        </output>
      )}
    </section>
  );
}
