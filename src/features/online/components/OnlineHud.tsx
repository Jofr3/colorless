import type { GameAction } from "@luminous/engine";
import { otherSeat } from "@luminous/engine";
import type {
  RedactedAttack,
  RedactedGame,
  RedactedInPlay,
  RedactedRetreat,
  MatchSeat,
} from "@luminous/schema";
import { useEffect, useRef, useState } from "react";
import { EnergyDots } from "../../game/EnergyDots";
import {
  GLASS_ACCENT_BUTTON,
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
  GLASS_NEUTRAL_BUTTON,
  GLASS_PANEL,
} from "../../../lib/glass";
import type { PlayerId } from "../../playmat/types";

// The interactive HUD for an online match (P4). The online client holds only a
// redacted view (a `RedactedGame`), not the full engine state, so each panel is
// driven purely by what the server put on the wire — chooseFirst / the mulligan
// draw / the place → ready gate (2a), the turn:action attack list (payability
// computed server-side) plus the ko:takePrizes / ko:promote decisions (2b-i),
// and — from increment 2b-ii — the retreat button + dialog (cost + a `can` gate
// computed server-side; the energies to discard and the Bench to promote to ride
// the already-public board). Abilities, non-Stadium trainers and the
// effect:choose dialogs read state the wire still withholds (and the fixed decks
// can't exercise them) — they land with real decks / a later 2b slice; the pass
// control lives in PlaymatView's TurnControls.
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
          bench={game.board.you.bench}
          attacks={game.phase.attacks}
          retreat={game.phase.retreat}
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

/** The turn:action panel: the viewer's Active, a button per printed attack
    (disabled off the server-computed `playable` flag — §8.2 payability + the §4
    ban + §12 immobilize, all folded server-side, so the client adds no rule
    logic), and the retreat entry point (disabled off the server-computed
    `retreat.can`, opening the RetreatDialog). Bottom-right, clear of the pass
    control, mirroring the local TurnPanel. Abilities / non-Stadium trainers land
    with real decks (they need cards the fixed decks don't have). */
function AttackPanel({
  active,
  bench,
  attacks,
  retreat,
  firstTurn,
  seat,
  onAction,
}: {
  active: RedactedInPlay | null;
  bench: readonly RedactedInPlay[];
  attacks: readonly RedactedAttack[];
  retreat: RedactedRetreat | null;
  firstTurn: boolean;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
}) {
  const [retreatOpen, setRetreatOpen] = useState(false);
  // No Active means nothing to attack with (defensive — a turn:action always
  // has one); render nothing rather than an empty panel.
  if (active === null) return null;
  const battle = active.battle;
  return (
    <>
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
        {retreat !== null && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={!retreat.can}
              onClick={() => setRetreatOpen(true)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium disabled:cursor-default disabled:opacity-40 ${GLASS_NEUTRAL_BUTTON}`}
            >
              Retreat ({retreat.cost})
            </button>
          </div>
        )}
      </section>
      {retreatOpen && retreat !== null && (
        <RetreatDialog
          active={active}
          bench={bench}
          cost={retreat.cost}
          seat={seat}
          onAction={onAction}
          onClose={() => setRetreatOpen(false)}
        />
      )}
    </>
  );
}

/** The retreat decision modal (§11) — mirrors the local HUD's RetreatDialog.
    Pick exactly `cost` of the Active's attached energies to discard and a Bench
    Pokémon to promote, then dispatch `retreat`. Both the energies (the viewer's
    own attachments) and the Bench are already public on the wire; only the cost
    was server-computed (RedactedRetreat). Native <dialog>, dismissable — retreat
    is optional, so Escape / Cancel close it. Mounted only while open, so the
    useState initializers are the fresh-picks-per-open reset. */
function RetreatDialog({
  active,
  bench,
  cost,
  seat,
  onAction,
  onClose,
}: {
  active: RedactedInPlay;
  bench: readonly RedactedInPlay[];
  /** The retreat cost — RedactedRetreat's, not recomputed here. */
  cost: number;
  seat: MatchSeat;
  onAction: (action: GameAction) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [benchIndex, setBenchIndex] = useState<number | null>(null);
  // The Active's attached energy uids — the discard-pick pool (public own zone).
  const energies = active.attached?.energies ?? [];

  const toggleEnergy = (uid: string) =>
    setChosen((prev) =>
      prev.includes(uid)
        ? prev.filter((u) => u !== uid)
        : prev.length < cost
          ? [...prev, uid]
          : prev,
    );

  const ready = chosen.length === cost && benchIndex !== null;

  return (
    <Dialog label="Retreat" onDismiss={onClose}>
      <h2 className="text-lg font-semibold text-white">Retreat {active.name}</h2>
      {cost > 0 && (
        <>
          <p className="mt-1.5 text-sm text-white/55">
            Discard exactly {cost} attached energ{cost === 1 ? "y" : "ies"} ({chosen.length}/{cost}):
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {energies.map((energy) => {
              const selected = chosen.includes(energy.id);
              return (
                <li key={energy.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleEnergy(energy.id)}
                    className={`w-full cursor-pointer rounded-xl px-3 py-2 text-left text-sm ring-1 ring-inset transition-all ${
                      selected
                        ? "bg-white/[0.12] text-white ring-white/40"
                        : "bg-white/[0.04] text-white/70 ring-white/10 hover:bg-white/[0.08]"
                    }`}
                  >
                    {energy.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="mt-3 text-sm text-white/55">Promote to Active:</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {bench.map((pokemon, index) => {
          const selected = benchIndex === index;
          return (
            <li key={pokemon.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => setBenchIndex(index)}
                className={`flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm ring-1 ring-inset transition-all ${
                  selected
                    ? "bg-white/[0.12] text-white ring-white/40"
                    : "bg-white/[0.04] text-white/70 ring-white/10 hover:bg-white/[0.08]"
                }`}
              >
                <span className="truncate">{pokemon.name}</span>
                {pokemon.battle !== undefined && pokemon.battle.damage > 0 && (
                  <span className="ml-2 shrink-0 text-xs font-bold text-rose-300">
                    {pokemon.battle.damage} dmg
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className={GLASS_DIALOG_GHOST_BUTTON}>
          Cancel
        </button>
        <button
          type="button"
          className={ACCENT_BUTTON}
          disabled={!ready}
          onClick={() => {
            if (benchIndex === null) return;
            onAction({
              type: "retreat",
              seat,
              discardEnergy: chosen,
              promoteBenchIndex: benchIndex,
            });
            onClose();
          }}
        >
          Retreat
        </button>
      </div>
    </Dialog>
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

/** A native-<dialog> modal (the same top-layer + focus-trap treatment as the
    local HUD's HudDialog). Mounted = open (the caller renders it conditionally,
    the mount effect calls showModal). Without `onDismiss` the decision is
    MANDATORY — Escape is swallowed and there is no dismiss affordance (the ko:*
    dialogs); with it, Escape / an on-screen Cancel close the modal (the optional
    retreat). */
function Dialog({
  label,
  onDismiss,
  children,
}: {
  label: string;
  onDismiss?: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onCancel={(event) => {
        if (onDismiss === undefined) event.preventDefault();
      }}
      onClose={() => onDismiss?.()}
      className="m-auto border-0 bg-transparent p-0 text-white"
    >
      <div className={`w-[min(24rem,calc(100vw-2.5rem))] ${GLASS_DIALOG_PANEL}`}>{children}</div>
    </dialog>
  );
}
