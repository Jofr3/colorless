import type { GameAction } from "@luminous/engine";
import type { RedactedGame, SeatLogEntry } from "@luminous/schema";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TransientErrorPill } from "../../../components/TransientErrorPill";
import { GLASS_HUD_BUTTON, SOLID_PRIMARY_BUTTON } from "../../../lib/glass";
import { moveToAction } from "../../game/moveToAction";
import { placementPredicateFor } from "../../game/placement";
import { GAME_OVER_DETAIL, projectionFromRedacted } from "../../game/projection";
import { viewLogEntries } from "../../game/viewLog";
import type { LeaveConfirmCopy } from "../../playmat/components/BackToMenu";
import { PlaymatView } from "../../playmat/PlaymatView";
import type { CardMoveRequest, TurnInfo } from "../../playmat/types";
import type { ActionError } from "../net/useLobby";
import { ConfirmDialog } from "./ConfirmDialog";
import { OnlineHud } from "./OnlineHud";
import { OpponentAwayBanner } from "./OpponentAwayBanner";

// The online match board (P4). Renders THIS client's server-redacted snapshot
// through the same PlaymatView the local /play page drives, and sends the
// drags/buttons that translate to legal actions back to the authoritative
// Durable Object (`onAction`). The board only ever reflects state the server
// accepted and re-broadcast, so there is no optimism to reconcile: a rejected
// drag simply never produces a new snapshot.
//
// SCOPE (through 3b-ii): setup (chooseFirst / drawExtra / place → ready, via
// OnlineHud + setup drags), the basic turn drags moveToAction routes (attach
// energy, bench a Basic, evolve, attach a Tool, play a Stadium), pass, the
// attack + KO loop (attack off the redacted attack list, then ko:takePrizes /
// ko:promote), retreat (the OnlineHud RetreatDialog), the effect:choose dialogs
// (2b-iii), and — from 3b — the activated Abilities + non-Stadium Trainers (the
// OnlineHud turn panel, server-folded playability), including — from 3b-ii —
// Rare Candy through its own two-step dialog + the `rareCandy` action. Every
// turn affordance the local HUD offers now has an online counterpart. The match
// LIFECYCLE is landing on top of that: 3c-ii forfeits a player who abandons the
// match (server-side), 3c-iii adds the Concede control below, 3c-iv makes
// walking out (the Back control) forfeit too — hence its own confirmation copy —
// 3c-v shows the opponent's side of that clock (`opponentAway`), and 3c-vi puts
// Rematch on the result panel. From 3c-vii-b the same component also renders for
// a SPECTATOR (`spectating`): the identical board, with every control removed —
// they hold no seat, so there is nothing here they could legally send.

// The rejection pill lingers this long before auto-dismissing (GamePage's TTL).
const ERROR_TTL_MS = 4000;

// Matches the playmat's own "Back" control (BackToMenu) so the two read as one
// row of HUD chrome; positioned to its LEFT (right: 96 vs 16).
const CONCEDE_BUTTON_CLASS = `absolute z-20 flex h-9 cursor-pointer items-center rounded-full px-3.5 text-[13px] font-medium tracking-wide ${GLASS_HUD_BUTTON}`;

// What "Back" asks in an online match. Leaving is NOT free here: the DO concedes
// for a player who walks out of a running match (3c-iv), so the confirmation says
// so in the same words the Concede dialog uses — the two now do the same thing to
// the game, and the only surprise worth avoiding is a silent one. Once the game
// is over there is nothing left to lose, so it drops back to a plain goodbye.
const LEAVE_CONFIRM_LIVE: LeaveConfirmCopy = {
  title: "Leave the match?",
  message: "Leaving forfeits the match — your opponent wins immediately.",
};
const LEAVE_CONFIRM_OVER: LeaveConfirmCopy = {
  title: "Leave the match?",
  message: "The match is over. You'll return to the main menu.",
};
// A spectator forfeits nothing by leaving — theirs is the only one of the three
// that costs the player nothing, so it must not borrow the others' warning.
const LEAVE_CONFIRM_WATCHING: LeaveConfirmCopy = {
  title: "Stop watching?",
  message: "You'll return to the main menu. The match carries on without you.",
};

// The one primary action on the board — the result panel's Rematch. Solid white
// (the leave dialog's confirm styling) rather than the HUD's glass, because it is
// the thing to do next rather than another piece of chrome.
const REMATCH_BUTTON_CLASS = `px-5 py-2 ${SOLID_PRIMARY_BUTTON}`;

export function OnlineMatch({
  game,
  log,
  youName,
  opponentName,
  opponentAway,
  actionError,
  onAction,
  onRematch,
  spectating = false,
}: {
  game: RedactedGame;
  /** The accumulated game log (seat-keyed, from the DO); relabeled for this
      viewer's seat below and rendered in PlaymatView's GameLog (2b-iii-d-ii). */
  log: SeatLogEntry[];
  youName: string;
  opponentName: string;
  /** The opponent's LOBBY presence — null while they are connected, set while
      their seat shows disconnected, carrying the server's forfeit deadline when
      one is armed (P4 3c-v). It is lobby state, not game state, so it arrives on
      the snapshot rather than the redacted board. */
  opponentAway: { forfeitAt: number | null } | null;
  /** The server's last action rejection (P4), surfaced as a transient pill. */
  actionError: ActionError | null;
  onAction: (action: GameAction) => void;
  /** Ask to play again once the game is over (P4 3c-vi). */
  onRematch: () => void;
  /** Watching without a seat (P4 3c-vii-b): render the board and the log, and
      NOTHING that acts on the game. The server would refuse such a frame anyway
      (a spectator socket has no bound player), so this is about not offering a
      control that cannot work — and the seatless snapshot it renders carries no
      affordances to drive one with (3c-vii-a). */
  spectating?: boolean;
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
      if (spectating) return;
      const action = moveToAction(request, { phaseKind, isViewerTurn, viewerSeat: seat, board });
      if (action !== null) onAction(action);
    },
    [phaseKind, isViewerTurn, seat, board, onAction, spectating],
  );

  // The same drop-legality gate the local page uses, from the redacted phase —
  // so affordances stay in lockstep with moveToAction (no highlight for a drop
  // that would spring back).
  const placementPredicate = useMemo(
    () =>
      spectating
        ? () => false
        : placementPredicateFor({
            phaseKind,
            isViewerTurn,
            isReady: game.phase.kind === "setup:place" && game.phase.ready.you,
          }),
    [phaseKind, isViewerTurn, game.phase, spectating],
  );

  const turnInfo: TurnInfo = {
    turn: projection.turn,
    activePlayer: projection.activePlayer ?? projection.waitingOn ?? "you",
    youName,
    opponentName,
  };

  // Whether the concede confirmation is open (3c-iii).
  const [conceding, setConceding] = useState(false);

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
      passAnimationKey={projection.turn}
      placementPredicate={placementPredicate}
      leaveConfirm={
        spectating
          ? LEAVE_CONFIRM_WATCHING
          : projection.outcome === null
            ? LEAVE_CONFIRM_LIVE
            : LEAVE_CONFIRM_OVER
      }
      logEntries={logEntries}
      piles={projection.piles}
    >
      {/* Every control below is for a SEATED player. A spectator gets the board,
          the log and the result — nothing that acts on the game. */}
      {!spectating && (
        <OnlineHud
          game={game}
          waitingOn={projection.waitingOn}
          activePlaced={board.you.active !== null}
          onAction={onAction}
        />
      )}
      {spectating && (
        <output
          className="absolute z-[80] rounded-full bg-[#16161f]/85 px-4 py-1.5 text-[13px] text-white/60 shadow-[0_8px_28px_rgba(0,0,0,0.45)] ring-1 ring-inset ring-white/10 backdrop-blur-md"
          style={{ top: 16, left: "50%", transform: "translateX(-50%)" }}
        >
          Watching — {youName} vs {opponentName}
        </output>
      )}
      {/* The opponent walked away and the server is timing them out (3c-v).
          Hidden once the game is over: by then the clock has either fired or
          become irrelevant, and the result overlay is the only thing to read. */}
      {!spectating && opponentAway !== null && projection.outcome === null && (
        <OpponentAwayBanner name={opponentName} forfeitAt={opponentAway.forfeitAt} />
      )}
      {/* Concede (3c-iii). Placed beside the playmat's own "Back" control (top
          right, z-20, `right: 16`) rather than in the turn panel, because the
          turn panel only renders on YOUR turn and the engine deliberately allows
          conceding in any phase — including the one that matters most, an
          opponent's turn you are waiting out. Hidden once the game is over: there
          is nothing left to concede, and the engine would reject it anyway. */}
      {!spectating && projection.outcome === null && (
        <>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setConceding(true)}
            className={CONCEDE_BUTTON_CLASS}
            style={{ top: 16, right: 96 }}
          >
            Concede
          </button>
          <ConfirmDialog
            open={conceding}
            title="Concede the match?"
            message="Your opponent wins immediately. This can't be undone."
            confirmLabel="Concede"
            danger
            onConfirm={() => {
              setConceding(false);
              onAction({ type: "concede", seat });
            }}
            onCancel={() => setConceding(false)}
          />
        </>
      )}
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
            {/* WHY it ended. Not cosmetic since 3c-ii: a win can now arrive
                because the opponent forfeited — pressed concede, or abandoned the
                match until their timer ran out — and a bare "You win!" would leave
                that unexplained. Same copy as the local overlay (one map). */}
            <p className="mt-1 text-sm text-white/60">
              {projection.outcome.result === "tie"
                ? "Both players met a win condition at the same time."
                : GAME_OVER_DETAIL[projection.outcome.reason]}
            </p>
            {/* Play again in this same lobby (3c-vi). It lives INSIDE the result
                panel because this is the one moment it's offered, and because
                3c-iv left an in-game lobby with no other way out than leaving:
                without it, two players who just finished have to mint a new code.
                The panel is `pointer-events-none` so the board underneath stays
                inspectable; the button opts back in. Pressing it readies THIS seat
                and returns both to the versus screen — the opponent accepts by
                readying too, which is the same agreement the first game needed. */}
            {/* Playing again is the players' call, not a watcher's. */}
            {!spectating && (
              <button
                type="button"
                onClick={onRematch}
                className={`pointer-events-auto mt-4 ${REMATCH_BUTTON_CLASS}`}
              >
                Rematch
              </button>
            )}
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
