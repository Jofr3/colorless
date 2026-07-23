import type { GameAction } from "@luminous/engine";
import { otherSeat } from "@luminous/engine";
import type { RedactedGame } from "@luminous/schema";
import { useState } from "react";
import { GLASS_ACCENT_BUTTON, GLASS_NEUTRAL_BUTTON, GLASS_PANEL } from "../../../lib/glass";
import type { PlayerId } from "../../playmat/types";

// The interactive SETUP overlay for an online match (P4 increment 2a). The
// online client holds only a redacted view (a `RedactedGame`), not the full
// engine state, so this HUD is deliberately limited to the phases whose actions
// are buttons/prompts derivable from the redaction — chooseFirst, the mulligan
// compensation draw, and the place → ready gate. Turn-action attacks / abilities
// / trainers / retreat and the ko:* + effect dialogs read the full GameState and
// land in increment 2b; the pass control lives in PlaymatView's TurnControls.
//
// Every panel is gated on `waitingOn === "you"` (the D17 rule the local HUD uses)
// so a prompt never appears on the wrong screen, and the actions carry the
// client's own seat (the DO rebinds it regardless).

const TOP_PANEL_CLASS = "left-1/2 top-16 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2";
const PANEL_CLASS = `pointer-events-auto absolute z-[75] rounded-2xl p-4 ${GLASS_PANEL} ${TOP_PANEL_CLASS}`;
const ACCENT_BUTTON = `cursor-pointer rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-40 ${GLASS_ACCENT_BUTTON}`;
const NEUTRAL_BUTTON = `cursor-pointer rounded-full px-4 py-2 text-sm font-medium ${GLASS_NEUTRAL_BUTTON}`;

export function OnlineHud({
  game,
  waitingOn,
  activePlaced,
  onAction,
}: {
  game: RedactedGame;
  waitingOn: PlayerId | null;
  /** Whether the viewer has placed an Active — gates the Ready button. */
  activePlaced: boolean;
  onAction: (action: GameAction) => void;
}) {
  const seat = game.seat;
  const acting = waitingOn === "you";

  switch (game.phase.kind) {
    case "setup:chooseFirst":
      return acting ? (
        <Panel label="Coin flip" title="You won the flip — who goes first?">
          <div className="flex gap-2">
            <button
              type="button"
              className={ACCENT_BUTTON}
              onClick={() => onAction({ type: "chooseFirstPlayer", seat, first: seat })}
            >
              Go first
            </button>
            <button
              type="button"
              className={NEUTRAL_BUTTON}
              onClick={() =>
                onAction({ type: "chooseFirstPlayer", seat, first: otherSeat(seat) })
              }
            >
              Go second
            </button>
          </div>
        </Panel>
      ) : null;

    case "setup:drawExtra":
      return acting ? (
        <DrawExtraPanel owed={game.phase.owed} seat={seat} onAction={onAction} />
      ) : null;

    case "setup:place":
      return acting ? (
        <Panel
          label="Setup"
          title={
            activePlaced
              ? "Drag more Basic Pokémon to your Bench, then Ready."
              : "Drag a Basic Pokémon from your hand to the Active spot."
          }
        >
          <button
            type="button"
            className={ACCENT_BUTTON}
            disabled={!activePlaced}
            onClick={() => onAction({ type: "setupReady", seat })}
          >
            Ready
          </button>
        </Panel>
      ) : null;

    default:
      // turn:action (pass is in TurnControls), the ko:*/effect:choose dialogs
      // (2b) and gameOver (OnlineMatch's overlay) render no setup panel.
      return null;
  }
}

/** The mulligan-compensation draw (§3.5): draw 0..owed cards. */
function DrawExtraPanel({
  owed,
  seat,
  onAction,
}: {
  owed: number;
  seat: RedactedGame["seat"];
  onAction: (action: GameAction) => void;
}) {
  const [count, setCount] = useState(owed);
  const clamped = Math.max(0, Math.min(owed, count));
  return (
    <Panel label="Compensation" title={`Your opponent mulliganed — draw up to ${owed}.`}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={NEUTRAL_BUTTON}
            onClick={() => setCount((c) => Math.max(0, c - 1))}
          >
            −
          </button>
          <span className="w-6 text-center text-sm font-semibold tabular-nums">{clamped}</span>
          <button
            type="button"
            className={NEUTRAL_BUTTON}
            onClick={() => setCount((c) => Math.min(owed, c + 1))}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className={ACCENT_BUTTON}
          onClick={() => onAction({ type: "setupDrawExtra", seat, count: clamped })}
        >
          {clamped === 0 ? "Skip the draw" : `Draw ${clamped}`}
        </button>
      </div>
    </Panel>
  );
}

function Panel({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className={PANEL_CLASS}>
      <p className="mb-3 text-sm text-white/85">{title}</p>
      {children}
    </section>
  );
}
