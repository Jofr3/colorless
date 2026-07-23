import type { GameAction } from "@luminous/engine";
import { otherSeat } from "@luminous/engine";
import type { RedactedAttack, RedactedGame, RedactedInPlay, MatchSeat } from "@luminous/schema";
import { useEffect, useRef, useState } from "react";
import { EnergyDots } from "../../game/EnergyDots";
import {
  GLASS_ACCENT_BUTTON,
  GLASS_DIALOG_PANEL,
  GLASS_NEUTRAL_BUTTON,
  GLASS_PANEL,
} from "../../../lib/glass";
import type { PlayerId } from "../../playmat/types";

// The interactive HUD for an online match (P4). The online client holds only a
// redacted view (a `RedactedGame`), not the full engine state, so each panel is
// driven purely by what the server put on the wire — chooseFirst / the mulligan
// draw / the place → ready gate (2a), and — from increment 2b-i — the turn:action
// attack list (payability computed server-side) plus the ko:takePrizes /
// ko:promote decisions. Retreat, abilities, non-Stadium trainers and the
// effect:choose dialogs read state the wire still withholds and land in later 2b
// slices; the pass control lives in PlaymatView's TurnControls.
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
  /** Whether the viewer has placed an Active — gates the setup Ready button. */
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

    case "turn:action":
      return acting ? (
        <AttackPanel
          active={game.board.you.active}
          attacks={game.phase.attacks}
          firstTurn={game.turn === 1}
          seat={seat}
          onAction={onAction}
        />
      ) : null;

    case "ko:takePrizes":
      return acting ? (
        <TakePrizesDialog
          count={game.phase.count}
          prizesRemaining={game.board.you.prizesRemaining}
          seat={seat}
          onAction={onAction}
        />
      ) : null;

    case "ko:promote":
      return acting ? (
        <PromoteDialog bench={game.board.you.bench} seat={seat} onAction={onAction} />
      ) : null;

    default:
      // effect:choose (a later 2b slice) and gameOver (OnlineMatch's overlay)
      // render no panel here.
      return null;
  }
}

/** The turn:action panel: the viewer's Active and a button per printed attack,
    disabled off the server-computed `playable` flag (§8.2 payability + the §4
    ban + §12 immobilize, all folded server-side — the client adds no rule
    logic). Bottom-right, clear of the pass control, mirroring the local
    TurnPanel. Retreat / abilities / trainers land in later 2b slices. */
function AttackPanel({
  active,
  attacks,
  firstTurn,
  seat,
  onAction,
}: {
  active: RedactedInPlay | null;
  attacks: readonly RedactedAttack[];
  firstTurn: boolean;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  // No Active means nothing to attack with (defensive — a turn:action always
  // has one); render nothing rather than an empty panel.
  if (active === null) return null;
  const battle = active.battle;
  return (
    <section
      aria-label="Turn actions"
      className={`pointer-events-auto absolute bottom-[calc(var(--hand-h)+16px)] right-4 z-[75] w-72 rounded-2xl p-4 ${GLASS_PANEL}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="truncate text-sm font-semibold text-white">{active.name}</span>
        {battle !== undefined && battle.hp !== null && (
          <span className="ml-2 shrink-0 text-xs tabular-nums text-white/55">
            {Math.max(0, battle.hp - battle.damage)}/{battle.hp} HP
          </span>
        )}
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {attacks.length === 0 && (
          <li className="text-xs text-white/45">This Pokémon has no attacks.</li>
        )}
        {attacks.map((attack) => (
          <li key={attack.index}>
            <button
              type="button"
              disabled={!attack.playable}
              onClick={() => onAction({ type: "attack", seat, index: attack.index })}
              className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-all ${
                attack.playable
                  ? "cursor-pointer bg-white/[0.06] text-white/90 ring-white/15 hover:bg-white/[0.1] active:scale-[0.98]"
                  : "cursor-default bg-white/[0.03] text-white/40 ring-white/8"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{attack.name}</span>
                <EnergyDots cost={attack.cost} />
              </span>
              {attack.damage !== null && (
                <span className="shrink-0 text-sm font-bold tabular-nums">{attack.damage}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {firstTurn && (
        <p className="mt-2 text-[11px] text-white/45">No attacking on the first turn (§4).</p>
      )}
    </section>
  );
}

/** ko:takePrizes — the KOing player picks `count` of their face-down prizes.
    The wire carries only the counts (prizes are face-down for both players, §3.8),
    so the picker is `prizesRemaining` anonymous backs, exactly like the local
    PrizeDialog. */
function TakePrizesDialog({
  count,
  prizesRemaining,
  seat,
  onAction,
}: {
  count: number;
  prizesRemaining: number;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (index: number) => {
    setPicked((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : prev.length < count
          ? [...prev, index]
          : prev,
    );
  };
  return (
    <Dialog label="Take prizes">
      <h2 className="text-lg font-semibold text-white">
        Take {count} prize card{count === 1 ? "" : "s"}
      </h2>
      <p className="mt-1.5 text-sm text-white/55">
        Pick {count} of your face-down prize card{count === 1 ? "" : "s"} to add to your hand.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {Array.from({ length: prizesRemaining }, (_, index) => {
          const selected = picked.includes(index);
          return (
            <button
              key={index}
              type="button"
              aria-pressed={selected}
              aria-label={`Prize ${index + 1}`}
              onClick={() => toggle(index)}
              className={`h-16 w-11 cursor-pointer rounded-md bg-gradient-to-br from-sky-800 to-indigo-950 ring-2 transition-all ${
                selected
                  ? "ring-white/80 shadow-[0_0_14px_rgba(255,255,255,0.35)]"
                  : "ring-white/15 hover:ring-white/40"
              }`}
            />
          );
        })}
      </div>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className={ACCENT_BUTTON}
          disabled={picked.length !== count}
          onClick={() => onAction({ type: "takePrizes", seat, prizeIndices: picked })}
        >
          Take {picked.length}/{count}
        </button>
      </div>
    </Dialog>
  );
}

/** ko:promote — the KO'd player chooses their next Active from the Bench. Their
    own Bench is public on the wire, so each row dispatches the pick directly
    (choosing is the whole decision), like the local PromoteDialog. */
function PromoteDialog({
  bench,
  seat,
  onAction,
}: {
  bench: readonly RedactedInPlay[];
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  return (
    <Dialog label="Promote a Pokémon">
      <h2 className="text-lg font-semibold text-white">Choose your next Active</h2>
      <p className="mt-1.5 text-sm text-white/55">
        Your Active Pokémon was Knocked Out. Promote one from your Bench.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {bench.map((pokemon, index) => (
          <li key={pokemon.id}>
            <button
              type="button"
              onClick={() => onAction({ type: "promote", seat, benchIndex: index })}
              className="flex w-full cursor-pointer items-center justify-between rounded-xl bg-white/[0.06] px-3 py-2 text-left text-sm text-white/90 ring-1 ring-inset ring-white/15 transition-all hover:bg-white/[0.1] active:scale-[0.98]"
            >
              <span className="truncate">{pokemon.name}</span>
              {pokemon.battle !== undefined && pokemon.battle.damage > 0 && (
                <span className="ml-2 shrink-0 text-xs font-bold text-rose-300">
                  {pokemon.battle.damage} dmg
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** The mulligan-compensation draw (§3.5): draw 0..owed cards. */
function DrawExtraPanel({
  owed,
  seat,
  onAction,
}: {
  owed: number;
  seat: MatchSeat;
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

/** A top-center in-flow prompt panel (the setup phases). */
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

/** A native-<dialog> modal for the ko:* decisions — the same top-layer +
    focus-trap treatment as the local HUD's HudDialog. Mounted = open (the
    caller renders it conditionally, the mount effect calls showModal). The
    decision is MANDATORY, so Escape is swallowed (onCancel preventDefault) —
    there is no dismiss affordance. */
function Dialog({ label, children }: { label: string; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onCancel={(event) => event.preventDefault()}
      className="m-auto border-0 bg-transparent p-0 text-white"
    >
      <div className={`w-[min(24rem,calc(100vw-2.5rem))] ${GLASS_DIALOG_PANEL}`}>{children}</div>
    </dialog>
  );
}
