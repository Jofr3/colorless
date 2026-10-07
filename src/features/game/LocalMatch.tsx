// Engine-driven local match shared by the Play setup and regression fixtures.
import { useCallback, useEffect, useMemo, useState } from "react";
import { otherSeat, type GameAction } from "@luminous/engine";
import { TransientErrorPill } from "../../components/TransientErrorPill";
import { PlaymatView } from "../playmat/PlaymatView";
import type { LeaveConfirmCopy } from "../playmat/components/BackToMenu";
import type { CardMoveRequest, TurnInfo } from "../playmat/types";
import { GameHud } from "./GameHud";
import { TabletopDice } from "./TabletopDice";
import { moveToAction } from "./moveToAction";
import { gamePlacementPredicate } from "./placement";
import { retreatOptionForGame } from "./retreat";
import { useRetreatDrag } from "./useRetreatDrag";
import { usableTrainerIdsForGame } from "./trainerUse";
import { useLocalGame, type LocalGameSetup } from "./useLocalGame";

const ERROR_TTL_MS = 4000;

/** Exported for the dom regression suite (LocalMatch.dom.test.tsx), which
    injects an engine-driven setup instead of walking the pregame flow. */
export function LocalMatch({
  setup,
  onPlayAgain,
  onSave,
  leaveConfirm,
  onLeave,
  chooseStartOrder,
}: {
  setup: LocalGameSetup;
  onPlayAgain: () => void;
  onSave?: (snapshot: LocalGameSetup) => void;
  leaveConfirm?: LeaveConfirmCopy;
  onLeave?: () => void;
  chooseStartOrder?: boolean;
}) {
  const {
    game,
    projection,
    viewerSeat,
    names,
    dispatch: dispatchAction,
    logEntries,
    lastError,
    coinFlipBatch,
    previousTurn,
    nextTurn,
    previousTurnDisabled,
    nextTurnDisabled,
  } = useLocalGame(setup, onSave);
  const [shownCoinBatch, setShownCoinBatch] = useState<number | null>(null);
  const tossing = coinFlipBatch !== null && coinFlipBatch.id !== shownCoinBatch;
  const finishCoinFlip = useCallback(() => {
    if (coinFlipBatch !== null) setShownCoinBatch(coinFlipBatch.id);
  }, [coinFlipBatch]);
  const dispatch = useCallback(
    (action: GameAction) => {
      if (!tossing) dispatchAction(action);
    },
    [tossing, dispatchAction],
  );

  // Trainer drags use precomputed engine acceptance to spring back silently.
  // Other translated actions retain their usual rejection feedback.
  const phase = game.phase;
  const board = projection.board;
  const { handleRetreatDrag, retreatDialog } = useRetreatDrag({
    board,
    retreat: tossing ? null : retreatOptionForGame(game, viewerSeat),
    seat: viewerSeat,
    dispatch,
  });
  const usableTrainerIds = useMemo(
    () => usableTrainerIdsForGame(game, viewerSeat),
    [game, viewerSeat],
  );
  const handleMoveCard = useCallback(
    (request: CardMoveRequest) => {
      if (handleRetreatDrag(request)) return;
      const action = moveToAction(request, {
        phaseKind: phase.kind,
        isViewerTurn: phase.kind === "turn:action" && phase.seat === viewerSeat,
        viewerSeat,
        board,
      });
      if (request.to.zone === "playmat" && !usableTrainerIds.has(request.cardId)) return;
      if (action !== null) dispatch(action);
    },
    [phase, viewerSeat, board, dispatch, usableTrainerIds, handleRetreatDrag],
  );

  // Drop affordances follow the phase and the current retreat legality.
  const placementPredicate = useMemo(
    () => gamePlacementPredicate(game, viewerSeat),
    [game, viewerSeat],
  );

  const passDisabled = !(projection.waitingOn === "you" && phase.kind === "turn:action");

  const turnInfo: TurnInfo = {
    turn: projection.turn,
    // During setup and the between-turns checkup-KO parks nobody owns a
    // turn — light up whoever must act instead (the prize picker/promoter).
    activePlayer: projection.activePlayer ?? projection.waitingOn ?? "you",
    youName: names[viewerSeat],
    opponentName: names[otherSeat(viewerSeat)],
  };

  // Transient pill for engine-rejected actions, DERIVED from the reducer's
  // lastError instead of mirrored into state: it hides once its nonce is
  // dismissed (button or TTL) and vanishes the moment an accepted action
  // clears lastError — which is also what flips the hot-seat viewer, so a
  // rejection can never ride across the handoff. The nonce keying remounts
  // the pill so an identical consecutive rejection re-announces (the /decks
  // precedent).
  const [dismissedNonce, setDismissedNonce] = useState<number | null>(null);
  const shownError = lastError !== null && lastError.nonce !== dismissedNonce ? lastError : null;
  useEffect(() => {
    if (lastError === null) return;
    const timer = setTimeout(() => setDismissedNonce(lastError.nonce), ERROR_TTL_MS);
    return () => clearTimeout(timer);
  }, [lastError]);

  return (
    <PlaymatView
      interactionDisabled={tossing}
      board={board}
      turn={turnInfo}
      perspective="you"
      // The projection re-bases so the viewer is always "you"; the glow still
      // rotates per seat, exactly like the mock's per-turn change.
      glowPerspective={viewerSeat === "p1" ? "you" : "opponent"}
      onMoveCard={handleMoveCard}
      placementPredicate={placementPredicate}
      usableTrainerIds={usableTrainerIds}
      onPassTurn={() => {
        if (!passDisabled) dispatch({ type: "endTurn", seat: viewerSeat });
      }}
      passDisabled={passDisabled}
      onPreviousTurn={previousTurn}
      onNextTurn={nextTurn}
      previousTurnDisabled={previousTurnDisabled}
      nextTurnDisabled={nextTurnDisabled}
      passAnimationKey={projection.turn}
      logEntries={logEntries}
      piles={projection.piles}
      leaveConfirm={leaveConfirm}
      onLeave={onLeave}
    >
      {retreatDialog}
      {!tossing && (
        <GameHud
          game={game}
          projection={projection}
          viewerSeat={viewerSeat}
          names={names}
          dispatch={dispatch}
          onPlayAgain={onPlayAgain}
          chooseStartOrder={chooseStartOrder}
        />
      )}
      {shownError !== null && (
        <TransientErrorPill
          message={shownError.message}
          nonce={shownError.nonce}
          onDismiss={() => setDismissedNonce(shownError.nonce)}
          className="absolute bottom-[calc(var(--hand-h)+12px)] left-1/2 z-[90] -translate-x-1/2"
        />
      )}
      {tossing && coinFlipBatch !== null && (
        <TabletopDice key={coinFlipBatch.id} batch={coinFlipBatch} onComplete={finishCoinFlip} />
      )}
    </PlaymatView>
  );
}
