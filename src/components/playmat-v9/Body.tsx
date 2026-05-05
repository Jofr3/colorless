import { useState, type ReactNode } from "react";
import CardImage from "../tcg/CardImage";
import type { EnergyType } from "../tcg/EnergyIcon";

export const CARD_W = 140;
export const WRAPPER_CLASSES =
  "playmat-wrapper w-full h-screen flex flex-col text-white relative overflow-hidden";

const CENTER_LINE_TOP = "calc((100vh - var(--hand-h)) / 2)";

const SLOT_BASE =
  "relative rounded-xl bg-white/[0.045] backdrop-blur-[3px] ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]";

function CardBackAtSize() {
  return (
    <div
      className="rounded-md shadow-[0_4px_14px_rgba(0,0,0,0.55)] bg-cover bg-center ring-1 ring-black/40"
      style={{
        width: "var(--card-w)",
        height: "var(--card-h)",
        backgroundColor: "#2a3a8a",
        backgroundImage: "url(/cards/back.jpg)",
      }}
    />
  );
}

function PileFrame({
  children,
  active = false,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <div
      data-slot
      className={`${SLOT_BASE} ${active ? "ring-amber-300/60 shadow-[0_0_0_1px_rgba(252,211,77,0.45),0_0_28px_rgba(252,211,77,0.30),inset_0_1px_0_rgba(255,255,255,0.15)]" : ""}`}
      style={{
        width: "calc(var(--card-w) + 12px)",
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      {children}
    </div>
  );
}

function DeckPileSized({ count }: { count: number }) {
  const layers = Math.min(4, Math.max(0, Math.floor(count / 15)));
  return (
    <div className="relative inline-block">
      <PileFrame>
        <div className="relative" style={{ width: "var(--card-w)", height: "var(--card-h)" }}>
          {Array.from({ length: layers }).map((_, i) => (
            <div
              key={i}
              className="absolute inset-0"
              style={{ transform: `translate(${i * -1.5}px, ${i * -1.5}px)` }}
            >
              <CardBackAtSize />
            </div>
          ))}
          <div className="relative">
            <CardBackAtSize />
          </div>
        </div>
      </PileFrame>
    </div>
  );
}

function DiscardPileSized() {
  return (
    <div className="relative inline-block">
      <PileFrame>
        <div style={{ width: "var(--card-w)", height: "var(--card-h)" }} />
      </PileFrame>
    </div>
  );
}

function PrizeGridCompact({
  remaining,
  flip = false,
}: {
  remaining: number;
  flip?: boolean;
}) {
  const total = 6;
  const COLS = 2;
  const ROWS = 3;
  const taken = Math.max(0, Math.min(total, total - remaining));
  const slots = Array.from({ length: total }, (_, i) =>
    flip ? i >= taken : i < total - taken,
  );
  const rows = Array.from({ length: ROWS }, (_, r) =>
    slots.slice(r * COLS, r * COLS + COLS),
  );
  return (
    <div
      data-slot
      className={SLOT_BASE}
      style={{
        width: "calc(var(--prize-w) + var(--prize-w) + var(--prize-gap-x) + 12px)",
        height:
          "calc(var(--prize-h) + var(--prize-h) + var(--prize-h) + var(--prize-gap-y) + var(--prize-gap-y) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      <div className="flex flex-col">
        {rows.map((row, r) => (
          <div
            key={r}
            className="flex"
            style={{ marginTop: r === 0 ? 0 : "var(--prize-gap-y)" }}
          >
            {row.map((present, c) => (
              <div
                key={c}
                style={{
                  marginLeft: c === 0 ? 0 : "var(--prize-gap-x)",
                  zIndex: r * COLS + c,
                  width: "var(--prize-w)",
                  height: "var(--prize-h)",
                }}
              >
                {present && (
                  <div
                    className="rounded-md shadow-[0_3px_10px_rgba(0,0,0,0.55)] bg-cover bg-center ring-1 ring-black/40"
                    style={{
                      width: "var(--prize-w)",
                      height: "var(--prize-h)",
                      backgroundColor: "#2a3a8a",
                      backgroundImage: "url(/cards/back.jpg)",
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface PokeState {
  name: string;
  hp: number;
  type: EnergyType;
  attachedEnergy: EnergyType[];
  damage?: number;
  cardId?: string;
}

type PlayerId = "you" | "opponent";
type SidePosition = "top" | "bottom";

function otherPlayer(player: PlayerId): PlayerId {
  return player === "you" ? "opponent" : "you";
}

const opponentActive: PokeState = {
  name: "Mega Zygarde ex",
  hp: 340,
  type: "fighting",
  attachedEnergy: ["fighting", "fighting"],
  damage: 40,
  cardId: "me3-47",
};

const opponentBench: (PokeState | null)[] = [
  { name: "Yveltal ex", hp: 270, type: "darkness", attachedEnergy: [], cardId: "me3-53" },
  { name: "Meowth ex", hp: 200, type: "colorless", attachedEnergy: ["colorless"], cardId: "me3-62" },
  null,
  null,
  null,
];

const playerActive: PokeState = {
  name: "Mega Starmie ex",
  hp: 300,
  type: "water",
  attachedEnergy: ["water", "water", "water"],
  damage: 20,
  cardId: "me3-21",
};

const playerBench: (PokeState | null)[] = [
  { name: "Decidueye ex", hp: 280, type: "grass", attachedEnergy: ["grass"], cardId: "sv3-15" },
  { name: "Yveltal ex", hp: 270, type: "darkness", attachedEnergy: ["darkness", "darkness"], cardId: "me3-53" },
  { name: "Meowth ex", hp: 200, type: "colorless", attachedEnergy: [], cardId: "me3-62" },
  null,
  null,
];

const playerHand: { cardId: string; alt: string }[] = [
  { cardId: "sv3-15", alt: "Decidueye ex" },
  { cardId: "me3-62", alt: "Meowth ex" },
  { cardId: "me3-123", alt: "Rosa's Encouragement" },
  { cardId: "me3-70", alt: "Core Memory" },
  { cardId: "me3-53", alt: "Yveltal ex" },
  { cardId: "me3-123", alt: "Rosa's Encouragement" },
];

function CardBox({
  cardId,
  alt,
  priority,
}: {
  cardId: string;
  alt: string;
  priority?: boolean;
}) {
  return (
    <div
      className="rounded-md shadow-[0_6px_16px_rgba(0,0,0,0.55)] overflow-hidden ring-1 ring-black/30"
      style={{ width: "var(--card-w)" }}
    >
      <CardImage
        cardId={cardId}
        renderedWidth={CARD_W}
        alt={alt}
        priority={priority}
        className="w-full h-auto block"
      />
    </div>
  );
}

function Bench({ slots }: { slots: (PokeState | null)[] }) {
  const total = slots.length;
  return (
    <div
      data-slot
      className={SLOT_BASE}
      style={{
        width: `calc(var(--card-w) * ${total} + var(--slot-gap) * ${total - 1} + 12px)`,
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      <div className="flex items-start" style={{ gap: "var(--slot-gap)" }}>
        {slots.map((p, i) => (
          <div
            key={i}
            className="relative rounded-md"
            style={{ width: "var(--card-w)", height: "var(--card-h)" }}
          >
            {p && p.cardId ? <CardBox cardId={p.cardId} alt={p.name} /> : null}
            <div className="absolute inset-0 rounded-md border border-dashed border-white/9 pointer-events-none" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Hand({ cards }: { cards: { cardId: string; alt: string }[] }) {
  const count = cards.length;
  return (
    <div
      className="flex justify-center items-end px-6 relative z-10"
      style={{ height: "var(--hand-h)", paddingBottom: 8 }}
    >
      {cards.map((c, i) => (
        <div
          key={i}
          className="transition-transform hover:-translate-y-3"
          style={{
            marginLeft: i === 0 ? 0 : "calc(var(--card-w) * -0.3714285714)",
            zIndex: count - i,
          }}
        >
          <CardBox cardId={c.cardId} alt={c.alt} priority />
        </div>
      ))}
    </div>
  );
}

function IconButton({
  children,
  ariaLabel,
  size = "md",
  onClick,
}: {
  children: ReactNode;
  ariaLabel: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}) {
  const base =
    "relative flex cursor-pointer items-center justify-center rounded-full backdrop-blur-md ring-1 ring-inset transition-all active:scale-95";
  const variant =
    "bg-white/[0.045] hover:bg-white/[0.06] text-white/70 hover:text-white/85 ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]";
  const sizeCls = size === "lg" ? "w-20 h-20" : size === "sm" ? "w-9 h-9" : "w-10 h-10";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`${base} ${variant} ${sizeCls}`}
    >
      {children}
    </button>
  );
}

function TurnControls({ onPassTurn }: { onPassTurn: () => void }) {
  return (
    <div
      className="absolute z-20 flex flex-col items-center gap-1"
      style={{ right: 24, top: "50%", transform: "translateY(-50%)" }}
    >
      <IconButton size="lg" ariaLabel="Pass turn" onClick={onPassTurn}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h13" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      </IconButton>
      <div className="flex gap-2">
        <IconButton size="sm" ariaLabel="Previous">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </IconButton>
        <IconButton size="sm" ariaLabel="Forward">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

function SettingsButton() {
  return (
    <div className="absolute z-20" style={{ right: 16, bottom: 16 }}>
      <IconButton ariaLabel="Settings">
        <svg className="opacity-75" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </IconButton>
    </div>
  );
}

interface TurnInfo {
  turn: number;
  activePlayer: PlayerId;
  youName: string;
  opponentName: string;
}

const turnInfo: TurnInfo = {
  turn: 7,
  activePlayer: "you",
  youName: "Jofre",
  opponentName: "Lillie",
};

function PlayerChip({
  name,
  color,
  active,
  align,
  passAnimationKey,
}: {
  name: string;
  color: "rose" | "sky";
  active: boolean;
  align: "left" | "right";
  passAnimationKey: number;
}) {
  const circleRing =
    color === "rose"
      ? active
        ? "ring-2 ring-rose-300/80 shadow-[0_0_18px_rgba(244,114,182,0.55)]"
        : "ring-2 ring-white/9"
      : active
        ? "ring-2 ring-sky-300/80 shadow-[0_0_18px_rgba(56,189,248,0.55)]"
        : "ring-2 ring-white/9";
  const dot = color === "sky" ? "bg-sky-500" : "bg-rose-500";
  const animateIndicator = active && passAnimationKey > 0;
  return (
    <div
      className={`relative flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""} ${active ? "" : "opacity-55"}`}
    >
      <div
        key={animateIndicator ? passAnimationKey : "idle"}
        className={`w-7 h-7 rounded-full ${dot} ${circleRing} ${animateIndicator ? "turn-chip-pass" : ""} flex items-center justify-center text-[12px] font-bold transition-all`}
      >
        {name[0]}
      </div>
      <span className="text-xs font-medium tracking-wide">{name}</span>
    </div>
  );
}

function TurnBanner({
  info,
  passAnimationKey,
}: {
  info: TurnInfo;
  passAnimationKey: number;
}) {
  const yours = info.activePlayer === "you";
  return (
    <div
      className="absolute z-20 flex items-center gap-3 pl-2 pr-2 py-1.5 rounded-full bg-white/[0.07] backdrop-blur-md ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_28px_rgba(0,0,0,0.45)]"
      style={{ top: 16, left: 16 }}
    >
      <PlayerChip
        name={info.opponentName}
        color="rose"
        active={!yours}
        align="left"
        passAnimationKey={passAnimationKey}
      />
      <div className="flex flex-col items-center px-3 border-x border-white/9">
        <span className="text-[9px] uppercase tracking-[0.25em] text-white/45">Turn</span>
        <span className="text-sm font-bold text-white/85 tabular-nums leading-tight">
          {String(info.turn).padStart(2, "0")}
        </span>
      </div>
      <PlayerChip
        name={info.youName}
        color="sky"
        active={yours}
        align="right"
        passAnimationKey={passAnimationKey}
      />
    </div>
  );
}

type LogSource = "you" | "opponent" | "system";

type LogSegmentTone = "default" | "strong" | "energy" | "damage";

interface LogSegment {
  text: string;
  tone?: LogSegmentTone;
}

interface LogActionEntry {
  kind: "action";
  who: LogSource;
  elapsed: string;
  segments: LogSegment[];
}

interface LogTurnDivider {
  kind: "turn";
  turn: number;
}

type LogEntry = LogActionEntry | LogTurnDivider;

const gameLog: LogEntry[] = [
  {
    kind: "action",
    who: "you",
    elapsed: "+02:14",
    segments: [
      { text: "attached " },
      { text: "Water", tone: "energy" },
      { text: " → " },
      { text: "Mega Starmie ex", tone: "strong" },
    ],
  },
  {
    kind: "action",
    who: "you",
    elapsed: "+02:08",
    segments: [
      { text: "played " },
      { text: "Rosa's Encouragement", tone: "strong" },
    ],
  },
  { kind: "turn", turn: 7 },
  {
    kind: "action",
    who: "opponent",
    elapsed: "+01:42",
    segments: [
      { text: "Mega Zygarde ex", tone: "strong" },
      { text: " used Land Crush · " },
      { text: "-60", tone: "damage" },
    ],
  },
  {
    kind: "action",
    who: "opponent",
    elapsed: "+01:30",
    segments: [
      { text: "retreated " },
      { text: "Yveltal ex", tone: "strong" },
    ],
  },
  {
    kind: "action",
    who: "system",
    elapsed: "+01:24",
    segments: [
      { text: "Lillie", tone: "strong" },
      { text: " drew a prize card" },
    ],
  },
];

function SourceBadge({ who }: { who: LogSource }) {
  const label = who === "you" ? "YOU" : who === "opponent" ? "OPP" : "SYS";
  const style =
    who === "you"
      ? "bg-sky-400/95 text-white"
      : who === "opponent"
        ? "bg-rose-500/95 text-white"
        : "border border-dashed border-white/20 bg-white/[0.035] text-white/45";

  return (
    <span
      className={`inline-flex h-[18px] min-w-[24px] items-center justify-center self-center rounded-[5px] px-1 text-[9px] font-extrabold leading-none tracking-[0.04em] ${style}`}
    >
      {label}
    </span>
  );
}

function LogMessage({ segments }: { segments: LogSegment[] }) {
  const toneClass: Record<LogSegmentTone, string> = {
    default: "text-white/72",
    strong: "font-semibold text-white/92",
    energy: "font-semibold text-sky-200",
    damage: "font-extrabold text-rose-200",
  };

  return (
    <span className="min-w-0 flex-1 self-center text-[11.5px] leading-[1.35]">
      {segments.map((segment, index) => (
        <span key={index} className={toneClass[segment.tone ?? "default"]}>
          {segment.text}
        </span>
      ))}
    </span>
  );
}

function GameLog({
  entries,
  turn,
}: {
  entries: LogEntry[];
  turn: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="absolute z-30" style={{ left: 12, bottom: 12 }}>
      {open && (
        <section
          aria-label="Game log"
          className="absolute flex flex-col overflow-hidden rounded-[22px] bg-white/[0.045] backdrop-blur-md ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]"
          style={{ left: 0, bottom: 52, width: 360, height: "min(420px, calc(100vh - 112px))" }}
        >
          <div className="relative flex items-center justify-between px-4 pb-2.5 pt-3.5 border-b border-white/[0.07]">
            <span className="text-[10px] font-black uppercase tracking-[0.26em] text-white/72">
              Game log
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
              T{turn}
            </span>
          </div>
          <div className="relative flex-1 overflow-y-auto px-3 py-2">
            {entries.map((entry, index) => {
              if (entry.kind === "turn") {
                return (
                  <div
                    key={`turn-${entry.turn}-${index}`}
                    className="-mx-3 flex items-center gap-2 border-y border-white/[0.055] bg-black/18 px-3 py-2"
                  >
                    <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/12 to-white/4" />
                    <span className="text-[10px] font-black uppercase tracking-[0.26em] text-white/62">
                      Turn {entry.turn}
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-white/4 via-white/12 to-transparent" />
                  </div>
                );
              }

              const nextEntry = entries[index + 1];
              const hideBottomBorder = nextEntry?.kind === "turn";

              return (
                <div
                  key={`${entry.who}-${entry.elapsed}-${index}`}
                  className={`flex items-center gap-2.5 px-0.5 py-2.5 ${hideBottomBorder ? "" : "border-b border-white/[0.055] last:border-b-0"}`}
                >
                  <SourceBadge who={entry.who} />
                  <LogMessage segments={entry.segments} />
                  <span className="shrink-0 self-center font-mono text-[10px] leading-none text-white/36">
                    {entry.elapsed}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <button
        type="button"
        aria-label={open ? "Hide game log" : "Show game log"}
        onClick={() => setOpen(!open)}
        className="relative w-10 h-10 flex cursor-pointer items-center justify-center rounded-full backdrop-blur-md ring-1 ring-inset ring-white/9 transition-all active:scale-95 bg-white/[0.045] hover:bg-white/[0.06] text-white/70 hover:text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </button>
    </div>
  );
}

function StadiumCard() {
  return (
    <div className="relative">
      <PileFrame>
        <CardBox cardId="me3-111" alt="Lumiose City" priority />
      </PileFrame>
    </div>
  );
}

function PlayerSide({
  owner,
  position,
  isActive = false,
}: {
  owner: PlayerId;
  position: SidePosition;
  isActive?: boolean;
}) {
  const isTop = position === "top";
  const active = owner === "opponent" ? opponentActive : playerActive;
  const bench = owner === "opponent" ? opponentBench : playerBench;
  const deckCount = owner === "opponent" ? 42 : 38;
  const prizesRemaining = owner === "opponent" ? 5 : 4;
  const benchRow = (
    <div className="relative">
      <Bench slots={bench} />
      <div
        className="absolute top-1/2"
        style={{
          transform: "translateY(calc(-50% + 2px))",
          ...(isTop
            ? { right: "100%", marginRight: "var(--side-gap)" }
            : { left: "100%", marginLeft: "var(--side-gap)" }),
        }}
      >
        <div className="relative">
          <DiscardPileSized />
          <div
            className="absolute left-0"
            style={isTop ? { top: "100%", marginTop: 8 } : { bottom: "100%", marginBottom: 8 }}
          >
            <DeckPileSized count={deckCount} />
          </div>
        </div>
      </div>
      <div
        className="absolute"
        style={
          isTop
            ? { top: 0, left: "100%", marginLeft: "var(--side-gap)" }
            : { bottom: 0, right: "100%", marginRight: "var(--side-gap)" }
        }
      >
        <PrizeGridCompact remaining={prizesRemaining} flip={isTop} />
      </div>
    </div>
  );
  const activeNode = (
    <PileFrame active={isActive}>
      {active.cardId ? (
        <CardBox cardId={active.cardId} alt={active.name} priority />
      ) : null}
    </PileFrame>
  );

  return (
    <div
      data-player-owner={owner}
      data-side-position={position}
      className={`flex-1 min-h-0 px-6 flex flex-col items-center gap-2 relative ${isTop ? "justify-start" : "justify-end"}`}
      style={{ paddingTop: isTop ? 16 : 4, paddingBottom: 4 }}
    >
      {isTop ? (
        <>
          {benchRow}
          {activeNode}
        </>
      ) : (
        <>
          {activeNode}
          {benchRow}
        </>
      )}
    </div>
  );
}

export function PlaymatBody() {
  const [info, setInfo] = useState(turnInfo);
  const [passAnimationKey, setPassAnimationKey] = useState(0);
  const bottomOwner = info.activePlayer;
  const topOwner = otherPlayer(bottomOwner);

  function passTurn() {
    setPassAnimationKey((key) => key + 1);
    setInfo((current) => ({
      ...current,
      turn: current.turn + 1,
      activePlayer: otherPlayer(current.activePlayer),
    }));
  }

  return (
    <>
      <span className="sr-only" data-perspective-player={bottomOwner} aria-hidden="true" />
      <PlayerSide
        owner={topOwner}
        position="top"
        isActive={info.activePlayer === topOwner}
      />
      <PlayerSide
        owner={bottomOwner}
        position="bottom"
        isActive={info.activePlayer === bottomOwner}
      />
      <Hand cards={playerHand} />
      <div
        className="absolute z-10 pointer-events-none"
        style={{
          left: "50%",
          top: CENTER_LINE_TOP,
          transform: "translate(calc(-150% - var(--side-gap) - 24px), -50%)",
        }}
      >
        <StadiumCard />
      </div>
      <TurnControls onPassTurn={passTurn} />
      <SettingsButton />
      <TurnBanner info={info} passAnimationKey={passAnimationKey} />
      <GameLog entries={gameLog} turn={info.turn} />
    </>
  );
}
