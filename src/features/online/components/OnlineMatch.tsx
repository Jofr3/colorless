import type { GameAction } from "@luminous/engine";
import type { RedactedGame } from "@luminous/schema";
import { useCallback, useMemo } from "react";
import { moveToAction } from "../../game/moveToAction";
import { placementPredicateFor } from "../../game/placement";
import { projectionFromRedacted } from "../../game/projection";
import { PlaymatView } from "../../playmat/PlaymatView";
import type { CardMoveRequest, TurnInfo } from "../../playmat/types";
import { OnlineHud } from "./OnlineHud";

// The online match board (P4). Renders THIS client's server-redacted snapshot
// through the same PlaymatView the local /play page drives, and sends the
// drags/buttons that translate to legal actions back to the authoritative
// Durable Object (`onAction`). The board only ever reflects state the server
// accepted and re-broadcast, so there is no optimism to reconcile: a rejected
// drag simply never produces a new snapshot.
//
// SCOPE (through 2b-i): setup (chooseFirst / drawExtra / place → ready, via
// OnlineHud + setup drags), the basic turn drags moveToAction routes (attach
// energy, bench a Basic, evolve, attach a Tool, play a Stadium), pass, and the
// attack + KO loop (attack off the redacted attack list, then ko:takePrizes /
// ko:promote). Retreat, abilities, non-Stadium trainers and the effect:choose
// dialogs read state the wire still withholds and land in later 2b slices.

const NO_LOG: never[] = [];

export function OnlineMatch({
  game,
  youName,
  opponentName,
  onAction,
}: {
  game: RedactedGame;
  youName: string;
  opponentName: string;
  onAction: (action: GameAction) => void;
}) {
  const projection = useMemo(() => projectionFromRedacted(game), [game]);
  const seat = game.seat;
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
      logEntries={NO_LOG}
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
    </PlaymatView>
  );
}
