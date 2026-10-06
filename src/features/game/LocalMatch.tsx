// Engine-driven local match shared by the Play setup and regression fixtures.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { otherSeat, type GameAction } from "@luminous/engine";
import { TransientErrorPill } from "../../components/TransientErrorPill";
import { PlaymatView } from "../playmat/PlaymatView";
import type { LeaveConfirmCopy } from "../playmat/components/BackToMenu";
import type { CardMoveRequest, TurnInfo } from "../playmat/types";
import { GameHud } from "./GameHud";
import { TabletopDice } from "./TabletopDice";
import { moveToAction } from "./moveToAction";
import { gamePlacementPredicate } from "./placement";
import { usableTrainerIdsForGame } from "./trainerUse";
import { useLocalGame, type LocalGameSetup } from "./useLocalGame";

const ERROR_TTL_MS = 4000;
const FLIP_BANNER_TTL_MS = 1800;

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
  const usableTrainerIds = useMemo(
    () => usableTrainerIdsForGame(game, viewerSeat),
    [game, viewerSeat],
  );
  const handleMoveCard = useCallback(
    (request: CardMoveRequest) => {
      const action = moveToAction(request, {
        phaseKind: phase.kind,
        isViewerTurn: phase.kind === "turn:action" && phase.seat === viewerSeat,
        viewerSeat,
        board,
      });
      if (request.to.zone === "playmat" && !usableTrainerIds.has(request.cardId)) return;
      if (action !== null) dispatch(action);
    },
    [phase, viewerSeat, board, dispatch, usableTrainerIds],
  );

  // Drop affordances follow the same phase the translator routes by, so the
  // layer never previews a gesture-class moveToAction would null. The factory
  // reads only phase + seat (occupancy comes from the board at call time);
  // the layer snapshots the prop via ref, so this memo is tidiness, not
  // correctness.
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

  // Hot-seat flip banner: announce whose decision the board now shows. Only
  // a nonce is state — the name renders from the live viewerSeat, so it can
  // never lag a flip by a frame. The ref guard keeps the initial mount (and
  // StrictMode's double-run of it) silent; a re-flip restarts the clock via
  // the effect cleanup.
  const [flipNonce, setFlipNonce] = useState<number | null>(null);
  const previousSeatRef = useRef(viewerSeat);
  useEffect(() => {
    if (previousSeatRef.current === viewerSeat) return;
    previousSeatRef.current = viewerSeat;
    setFlipNonce((prev) => (prev ?? 0) + 1);
    const timer = setTimeout(() => setFlipNonce(null), FLIP_BANNER_TTL_MS);
    return () => clearTimeout(timer);
  }, [viewerSeat]);

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
      // flips per seat, exactly like the mock's per-turn flip.
      glowPerspective={viewerSeat === "p1" ? "you" : "opponent"}
      onMoveCard={handleMoveCard}
      placementPredicate={placementPredicate}
      usableTrainerIds={usableTrainerIds}
      passDisabled={passDisabled}
      passAnimationKey={projection.turn}
      logEntries={logEntries}
      piles={projection.piles}
      leaveConfirm={leaveConfirm}
      onLeave={onLeave}
    >
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
      {!tossing && flipNonce !== null && (
        <div
          key={flipNonce}
          className="pointer-events-none absolute left-1/2 top-1/3 z-[82] -translate-x-1/2 rounded-full bg-[#16161f]/90 px-6 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/15 backdrop-blur-xl"
        >
          <output className="text-base font-semibold text-white">
            {names[viewerSeat]} — you're up
          </output>
        </div>
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
