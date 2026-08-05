import type { ReactNode } from "react";
import { GLASS_HUD_BUTTON } from "../../../lib/glass";
import type { TurnInfo } from "../types";

// The dead state rides on :disabled variants, NOT appended same-property
// overrides: `.x:disabled(:hover)` outranks `.cursor-pointer`/`.x:hover` by
// specificity, so the result cannot flip with Tailwind's emission order.
// Values pin the GLASS_HUD_BUTTON rest paint (bg-white/[0.045], text-white/70)
// so a disabled button neither brightens on hover nor invites a click.
const CIRCLE_BUTTON_BASE_CLASS = `relative flex cursor-pointer items-center justify-center rounded-full disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white/[0.045] disabled:hover:text-white/70 ${GLASS_HUD_BUTTON}`;

const CIRCLE_BUTTON_SIZE_CLASS = {
  lg: "h-20 w-20",
  sm: "h-9 w-9",
} as const;

const PLAYER_DOT_CLASSES = {
  sky: "bg-sky-500",
  rose: "bg-rose-500",
} as const;

const ACTIVE_CHIP_RING_CLASSES = {
  sky: "ring-2 ring-sky-300/80 shadow-[0_0_18px_rgba(56,189,248,0.55)]",
  rose: "ring-2 ring-rose-300/80 shadow-[0_0_18px_rgba(244,114,182,0.55)]",
} as const;

function CircleIconButton({
  children,
  ariaLabel,
  size,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  ariaLabel: string;
  size: keyof typeof CIRCLE_BUTTON_SIZE_CLASS;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`${CIRCLE_BUTTON_BASE_CLASS} ${CIRCLE_BUTTON_SIZE_CLASS[size]}`}
    >
      {children}
    </button>
  );
}

function PassTurnButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <CircleIconButton ariaLabel="Pass turn" size="lg" onClick={onClick} disabled={disabled}>
      <svg
        width="34"
        height="34"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12h13" />
        <path d="M13 6l6 6-6 6" />
      </svg>
    </CircleIconButton>
  );
}

/** The playmat's own ⟶ pass control, rendered only for a driver that asks for
    one (`PlaymatView`'s optional `onPassTurn`) — in practice the /simulator
    sandbox, where nothing covers it.

    It used to sit here for every driver, above a Previous/Forward pair. Both are
    gone (P5-4): the arrows were never wired to anything on any surface — no
    handler, no history to navigate — so they announced navigation that did not
    exist; and on /play and online this button is ENABLED exactly when the turn
    panel renders over it, which is to say it was never clickable there. Those
    panels have carried their own `Pass` since 2026-07-26. */
export function TurnControls({
  onPassTurn,
  passDisabled = false,
}: {
  onPassTurn: () => void;
  passDisabled?: boolean;
}) {
  return (
    <div
      className="absolute z-20 flex flex-col items-center gap-1"
      style={{ right: 24, top: "50%", transform: "translateY(-50%)" }}
    >
      <PassTurnButton onClick={onPassTurn} disabled={passDisabled} />
    </div>
  );
}

function playerChipRing(tone: keyof typeof PLAYER_DOT_CLASSES, active: boolean) {
  return active ? ACTIVE_CHIP_RING_CLASSES[tone] : "ring-2 ring-white/9";
}

function PlayerChip({
  name,
  tone,
  active,
  align,
  passAnimationKey,
}: {
  name: string;
  tone: keyof typeof PLAYER_DOT_CLASSES;
  active: boolean;
  align: "left" | "right";
  passAnimationKey: number;
}) {
  const animateIndicator = active && passAnimationKey > 0;

  return (
    <div
      className={`relative flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""} ${active ? "" : "opacity-55"}`}
    >
      <div
        key={animateIndicator ? passAnimationKey : "idle"}
        className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold transition-all motion-reduce:transition-none ${PLAYER_DOT_CLASSES[tone]} ${playerChipRing(tone, active)} ${animateIndicator ? "turn-chip-pass" : ""}`}
      >
        {name[0]}
      </div>
      <span className="text-xs font-medium tracking-wide">{name}</span>
    </div>
  );
}

export function TurnBanner({
  info,
  passAnimationKey,
}: {
  info: TurnInfo;
  passAnimationKey: number;
}) {
  const isYourTurn = info.activePlayer === "you";

  return (
    <div
      className="absolute z-20 flex items-center gap-3 rounded-full bg-white/[0.07] py-1.5 pl-2 pr-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_28px_rgba(0,0,0,0.45)] ring-1 ring-inset ring-white/9 backdrop-blur-md"
      style={{ top: 16, left: 16 }}
    >
      <output className="sr-only">
        {`Turn ${info.turn}. ${
          isYourTurn ? `${info.youName}'s turn` : `${info.opponentName}'s turn`
        }`}
      </output>
      <PlayerChip
        name={info.opponentName}
        tone="rose"
        active={!isYourTurn}
        align="left"
        passAnimationKey={passAnimationKey}
      />
      <div className="flex flex-col items-center border-x border-white/9 px-3">
        <span className="text-[9px] uppercase tracking-[0.25em] text-white/45">Turn</span>
        <span className="text-sm font-bold leading-tight text-white/85 tabular-nums">
          {String(info.turn).padStart(2, "0")}
        </span>
      </div>
      <PlayerChip
        name={info.youName}
        tone="sky"
        active={isYourTurn}
        align="right"
        passAnimationKey={passAnimationKey}
      />
    </div>
  );
}
