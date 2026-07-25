import type { GameAction } from "@luminous/engine";
import type { RedactedGame, SeatLogEntry } from "@luminous/schema";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TransientErrorPill } from "../../../components/TransientErrorPill";
import { moveToAction } from "../../game/moveToAction";
import { placementPredicateFor } from "../../game/placement";
import { projectionFromRedacted } from "../../game/projection";
import { viewLogEntries } from "../../game/viewLog";
import { PlaymatView } from "../../playmat/PlaymatView";
import type { CardMoveRequest, TurnInfo } from "../../playmat/types";
import type { ActionError } from "../net/useLobby";
import { OnlineHud } from "./OnlineHud";

// The online match board (P4). Renders THIS client's server-redacted snapshot
// through the same PlaymatView the local /play page drives, and sends the
// drags/buttons that translate to legal actions back to the authoritative
// Durable Object (`onAction`). The board only ever reflects state the server
// accepted and re-broadcast, so there is no optimism to reconcile: a rejected
// drag simply never produces a new snapshot.
//
// SCOPE (through 3b): setup (chooseFirst / drawExtra / place → ready, via
// OnlineHud + setup drags), the basic turn drags moveToAction routes (attach
// energy, bench a Basic, evolve, attach a Tool, play a Stadium), pass, the
// attack + KO loop (attack off the redacted attack list, then ko:takePrizes /
// ko:promote), retreat (the OnlineHud RetreatDialog), the effect:choose dialogs
// (2b-iii), and — from 3b — the activated Abilities + non-Stadium Trainers (the
// OnlineHud turn panel, server-folded playability). Rare Candy (its own dialog +
// the rareCandy action) is the remaining deferred turn affordance.

// The rejection pill lingers this long before auto-dismissing (GamePage's TTL).
const ERROR_TTL_MS = 4000;

export function OnlineMatch({
  game,
  log,
  youName,
  opponentName,
  actionError,
  onAction,
}: {
  game: RedactedGame;
  /** The accumulated game log (seat-keyed, from the DO); relabeled for this
      viewer's seat below and rendered in PlaymatView's GameLog (2b-iii-d-ii). */
  log: SeatLogEntry[];
  youName: string;
  opponentName: string;
  /** The server's last action rejection (P4), surfaced as a transient pill. */
  actionError: ActionError | null;
  onAction: (action: GameAction) => void;
}) {
  const projection = useMemo(() => projectionFromRedacted(game), [game]);
  const seat = game.seat;
  // Relabel the seat-keyed log into this viewer's you/opponent vocabulary — the
  // log's twin of projectionFromRedacted above (the same array reaches both
  // clients; only the labels differ per seat).
  const logEntries = useMemo(() => viewLogEntries(log, seat), [log, seat]);
  const board = projection.board;
  const phaseKind = game.phase.kind;
  const isViewerTurn = phaseKind === "turn:action" && projection.activePlayer === "you";

  const handleMove = useCallback(
    (request: CardMoveRequest) => {
      const action = moveToAction(request, { phaseKind, isViewerTurn, viewerSeat: seat, board });
      if (action !== null) onAction(action);
    },
    [phaseKind, isViewerTurn, seat, board, onAction],
  );

  const passTurn = useCallback(() => {
    onAction({ type: "endTurn", seat });
  }, [onAction, seat]);
  // Pass only during your own turn:action (mirrors LocalMatch's gate).
  const passDisabled = !(phaseKind === "turn:action" && projection.waitingOn === "you");

  // The same drop-legality gate the local page uses, from the redacted phase —
  // so affordances stay in lockstep with moveToAction (no highlight for a drop
  // that would spring back).
  const placementPredicate = useMemo(
    () =>
      placementPredicateFor({
        phaseKind,
        isViewerTurn,
        isReady: game.phase.kind === "setup:place" && game.phase.ready.you,
      }),
    [phaseKind, isViewerTurn, game.phase],
  );

  const turnInfo: TurnInfo = {
    turn: projection.turn,
    activePlayer: projection.activePlayer ?? projection.waitingOn ?? "you",
    youName,
    opponentName,
  };

  // Transient pill for a server-rejected action — the GamePage pattern over the
  // wire: derived from `actionError` (not mirrored into state), it hides once its
  // nonce is dismissed (button or TTL) and vanishes when the next accepted action
  // clears `actionError` in useLobby. The nonce keying remounts the pill so an
  // identical consecutive rejection re-announces.
  const [dismissedNonce, setDismissedNonce] = useState<number | null>(null);
  const shownError =
    actionError !== null && actionError.nonce !== dismissedNonce ? actionError : null;
  useEffect(() => {
    if (actionError === null) {
      // An accepted action cleared the rejection: reset the dismissal too, so the
      // NEXT rejection shows even when its nonce REPEATS an earlier one — useLobby's
      // per-error nonce restarts after it clears `actionError` on an accepted move,
      // and a stale `dismissedNonce` would otherwise swallow the repeat (the exact
      // silent-drop this pill exists to prevent).
      setDismissedNonce(null);
      return;
    }
    const timer = setTimeout(() => setDismissedNonce(actionError.nonce), ERROR_TTL_MS);
    return () => clearTimeout(timer);
  }, [actionError]);

  return (
    <PlaymatView
      board={board}
      turn={turnInfo}
      perspective="you"
      glowPerspective={projection.activePlayer ?? "you"}
      onMoveCard={handleMove}
      onPassTurn={passTurn}
      passDisabled={passDisabled}
      passAnimationKey={projection.turn}
      placementPredicate={placementPredicate}
      logEntries={logEntries}
      piles={projection.piles}
    >
      <OnlineHud
        game={game}
        waitingOn={projection.waitingOn}
        activePlaced={board.you.active !== null}
        onAction={onAction}
      />
      {projection.outcome !== null && (
        <div className="pointer-events-none absolute inset-0 z-[85] flex items-center justify-center">
          <output className="rounded-2xl bg-[#16161f]/90 px-8 py-5 text-center shadow-[0_12px_40px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/15 backdrop-blur-xl">
            <p className="text-xl font-semibold text-white">
              {projection.outcome.result === "tie"
                ? "It's a tie"
                : projection.outcome.winner === "you"
                  ? "You win!"
                  : `${opponentName} wins`}
            </p>
          </output>
        </div>
      )}
      {shownError !== null && (
        <TransientErrorPill
          message={shownError.reason}
          nonce={shownError.nonce}
          onDismiss={() => setDismissedNonce(shownError.nonce)}
          className="absolute bottom-[calc(var(--hand-h)+12px)] left-1/2 z-[90] -translate-x-1/2"
        />
      )}
    </PlaymatView>
  );
}
