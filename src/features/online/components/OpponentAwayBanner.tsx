import { useEffect, useState } from "react";

// The online match's "your opponent is gone" notice (P4 3c-v), with the forfeit
// countdown the server armed. Before it, a player whose opponent crashed or
// killed their tab watched a completely silent board for 90 seconds and then —
// with no warning that anything was being decided — was handed a win. This says
// what is happening and when it resolves.
//
// The deadline is the SERVER's epoch-ms `PlayerState.forfeitAt`, the very number
// the DO's alarm fires on, so the countdown can't promise something the server
// won't do. Comparing it against the client clock is the same (accepted) skew the
// start countdown has always lived with — a few seconds' drift on a 90s timer.
//
// A graceful LEAVE never reaches this banner: since 3c-iv that concedes outright
// and the board goes straight to its result. This is the ungraceful path only.

/** Seconds left, or 0 once the deadline has passed. */
function remainingSeconds(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/** `M:SS` — a duration, not a clock time, so no leading zero on the minutes. */
function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function OpponentAwayBanner({
  name,
  forfeitAt,
}: {
  name: string;
  /** When they forfeit, or null while no clock is running — the first seconds
      after a socket drops (the server's 5s grace hasn't expired yet), or a lobby
      that isn't in a match. The notice still shows; only the countdown waits. */
  forfeitAt: number | null;
}) {
  const [seconds, setSeconds] = useState(() =>
    forfeitAt === null ? null : remainingSeconds(forfeitAt),
  );

  useEffect(() => {
    if (forfeitAt === null) {
      setSeconds(null);
      return;
    }
    setSeconds(remainingSeconds(forfeitAt));
    const id = setInterval(() => setSeconds(remainingSeconds(forfeitAt)), 1000);
    return () => clearInterval(id);
  }, [forfeitAt]);

  // Past the deadline the server has the ball: its alarm is what ends the match,
  // and it may be a moment behind us. Saying "forfeiting…" rather than freezing
  // at 0:00 keeps the notice honest about who decides.
  const detail =
    seconds === null
      ? "waiting for them to reconnect…"
      : seconds > 0
        ? `forfeits in ${formatCountdown(seconds)}`
        : "forfeiting…";

  return (
    <output
      aria-live="polite"
      className="absolute z-[80] flex items-center gap-2 rounded-full bg-[#16161f]/85 px-4 py-1.5 text-[13px] text-white/70 shadow-[0_8px_28px_rgba(0,0,0,0.45)] ring-1 ring-inset ring-white/10 backdrop-blur-md"
      style={{ top: 16, left: "50%", transform: "translateX(-50%)" }}
    >
      <span
        className="h-2 w-2 rounded-full bg-amber-400/80 motion-safe:animate-pulse"
        aria-hidden
      />
      <span>
        {name} disconnected — {detail}
      </span>
    </output>
  );
}
