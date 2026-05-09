// Collapsible bottom-left game log. Renders an interleaved list of
// per-action entries and turn dividers, each with a tone-stylized message
// span and a small SOURCE/TURN badge.

import { useState } from "react";
import type { LogEntry, LogSegment, LogSegmentTone, LogSource } from "../types";

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

export function GameLog({
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
        className="relative w-10 h-10 flex cursor-pointer items-center justify-center rounded-full backdrop-blur-md ring-1 ring-inset ring-white/9 transition-all active:scale-95 bg-white/[0.045] hover:bg-white/[0.06] text-white/70 hover:text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </button>
    </div>
  );
}
