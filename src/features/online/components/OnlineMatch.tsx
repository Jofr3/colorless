import type { RedactedGame } from "@luminous/schema";
import { useMemo } from "react";
import { projectionFromRedacted } from "../../game/projection";
import { PlaymatView } from "../../playmat/PlaymatView";
import type { CardMoveRequest, TurnInfo } from "../../playmat/types";

// The online match board (P4 increment 1c): renders THIS client's server-redacted
// snapshot as a READ-ONLY board, reusing the same PlaymatView the local /play
// page drives. The snapshot arrives already redacted and viewer-relative
// ("you"/"opponent") from the authoritative Durable Object, so there is nothing
// to hide here and nothing to dispatch — turns become interactive in increment 2.
// Until then, drops spring back silently (no-op onMoveCard, a deny-all placement
// predicate) and there is no pass control.

const NOOP_MOVE = (_request: CardMoveRequest): void => {};
const NOOP_PASS = (): void => {};
const DENY_PLACEMENT = () => false;
const NO_LOG: never[] = [];

export function OnlineMatch({
  game,
  youName,
  opponentName,
}: {
  game: RedactedGame;
  youName: string;
  opponentName: string;
}) {
  const projection = useMemo(() => projectionFromRedacted(game), [game]);

  const turnInfo: TurnInfo = {
    turn: projection.turn,
    // During setup and the between-turns checkup-KO parks nobody owns a turn —
    // light up whoever must act instead (mirrors LocalMatch).
    activePlayer: projection.activePlayer ?? projection.waitingOn ?? "you",
    youName,
    opponentName,
  };

  return (
    <PlaymatView
      board={projection.board}
      turn={turnInfo}
      perspective="you"
      // The board is viewer-relative already, so "you" is always the bottom
      // side; the glow follows whose turn it is.
      glowPerspective={projection.activePlayer ?? "you"}
      onMoveCard={NOOP_MOVE}
      onPassTurn={NOOP_PASS}
      passDisabled
      placementPredicate={DENY_PLACEMENT}
      logEntries={NO_LOG}
      piles={projection.piles}
    >
      {projection.outcome !== null && (
        <div className="pointer-events-none absolute inset-0 z-[82] flex items-center justify-center">
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
