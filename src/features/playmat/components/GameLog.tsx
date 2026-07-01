import { useState } from "react";
import { GLASS_HUD_BUTTON } from "../../../lib/glass";
import type { LogEntry, LogSegment, LogSegmentTone, LogSource } from "../types";

const SOURCE_LABELS: Record<LogSource, string> = {
  you: "YOU",
  opponent: "OPP",
  system: "SYS",
};

// Readable source words for the screen-reader announcement (vs. the terse badge).
const SOURCE_ANNOUNCE: Record<LogSource, string> = {
  you: "You",
  opponent: "Opponent",
  system: "",
};

/** A one-line spoken form of a log entry for the live region. */
function announceEntry(entry: LogEntry): string {
  if (entry.kind === "turn") return `Turn ${entry.turn}`;
  const text = entry.segments.map((segment) => segment.text).join("");
  const who = SOURCE_ANNOUNCE[entry.who];
  return who ? `${who}: ${text}` : text;
}

const SOURCE_BADGE_CLASSES: Record<LogSource, string> = {
  you: "bg-sky-400/95 text-white",
  opponent: "bg-rose-500/95 text-white",
  system: "border border-dashed border-white/20 bg-white/[0.035] text-white/45",
};

const SEGMENT_TONE_CLASSES: Record<LogSegmentTone, string> = {
  default: "text-white/72",
  strong: "font-semibold text-white/92",
  energy: "font-semibold text-sky-200",
  damage: "font-extrabold text-rose-200",
};

function SourceBadge({ source }: { source: LogSource }) {
  return (
    <span
      className={`inline-flex h-[18px] min-w-[24px] items-center justify-center self-center rounded-[5px] px-1 text-[9px] font-extrabold leading-none tracking-[0.04em] ${SOURCE_BADGE_CLASSES[source]}`}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

function LogMessage({ segments }: { segments: LogSegment[] }) {
  return (
    <span className="min-w-0 flex-1 self-center text-[11.5px] leading-[1.35]">
      {segments.map((segment, index) => (
        <span key={index} className={SEGMENT_TONE_CLASSES[segment.tone ?? "default"]}>
          {segment.text}
        </span>
      ))}
    </span>
  );
}

function TurnDivider({ turn }: { turn: number }) {
  return (
    <div className="-mx-3 flex items-center gap-2 border-y border-white/[0.055] bg-black/18 px-3 py-2">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/12 to-white/4" />
      <span className="text-[10px] font-black uppercase tracking-[0.26em] text-white/62">
        Turn {turn}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-white/4 via-white/12 to-transparent" />
    </div>
  );
}

function ActionLogRow({
  entry,
  hideBottomBorder,
}: {
  entry: Extract<LogEntry, { kind: "action" }>;
  hideBottomBorder: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 px-0.5 py-2.5 ${hideBottomBorder ? "" : "border-b border-white/[0.055] last:border-b-0"}`}
    >
      <SourceBadge source={entry.who} />
      <LogMessage segments={entry.segments} />
      <span className="shrink-0 self-center font-mono text-[10px] leading-none text-white/36">
        {entry.elapsed}
      </span>
    </div>
  );
}

function GameLogEntry({
  entry,
  nextEntry,
}: {
  entry: LogEntry;
  nextEntry?: LogEntry;
}) {
  if (entry.kind === "turn") {
    return <TurnDivider turn={entry.turn} />;
  }

  return <ActionLogRow entry={entry} hideBottomBorder={nextEntry?.kind === "turn"} />;
}

export function GameLog({
  entries,
  turn,
}: {
  entries: LogEntry[];
  turn: number;
}) {
  const [open, setOpen] = useState(false);
  const latest = entries[entries.length - 1];

  return (
    <div className="absolute z-[70]" style={{ left: 12, bottom: 12 }}>
      {/* Always-mounted live region so a new entry is announced even while the
          panel is collapsed (the panel itself unmounts when closed). */}
      <div aria-live="polite" className="sr-only">
        {latest ? announceEntry(latest) : ""}
      </div>
      {open && (
        <section
          aria-label="Game log"
          className="absolute flex flex-col overflow-hidden rounded-[22px] bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)] ring-1 ring-inset ring-white/9 backdrop-blur-md"
          style={{
            left: 0,
            bottom: 52,
            // Clamp to the viewport so the panel doesn't overflow narrow screens.
            width: "min(360px, calc(100vw - 24px))",
            height: "min(420px, calc(100dvh - 112px))",
          }}
        >
          <div className="relative flex items-center justify-between border-b border-white/[0.07] px-4 pb-2.5 pt-3.5">
            <span className="text-[10px] font-black uppercase tracking-[0.26em] text-white/72">
              Game log
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
              T{turn}
            </span>
          </div>
          <div className="relative flex-1 overflow-y-auto px-3 py-2">
            {entries.map((entry, index) => (
              <GameLogEntry
                key={`${entry.kind}-${index}`}
                entry={entry}
                nextEntry={entries[index + 1]}
              />
            ))}
          </div>
        </section>
      )}
      <button
        type="button"
        aria-label={open ? "Hide game log" : "Show game log"}
        onClick={() => setOpen((current) => !current)}
        className={`relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full ${GLASS_HUD_BUTTON}`}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </button>
    </div>
  );
}
