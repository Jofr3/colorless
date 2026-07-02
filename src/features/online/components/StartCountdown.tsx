import { useEffect, useState } from "react";
import { SwordsIcon } from "../../../components/icons";

// The "battle starting" overlay shown once both players are ready. It counts
// down from the host-stamped start time so both peers show the same number, then
// the host flips the phase to the placeholder match.

function remainingSeconds(startedAt: number, durationMs: number): number {
  return Math.max(0, Math.ceil((durationMs - (Date.now() - startedAt)) / 1000));
}

export function StartCountdown({
  startedAt,
  durationMs,
}: {
  startedAt: number;
  durationMs: number;
}) {
  const [seconds, setSeconds] = useState(() => remainingSeconds(startedAt, durationMs));

  useEffect(() => {
    setSeconds(remainingSeconds(startedAt, durationMs));
    const id = setInterval(() => setSeconds(remainingSeconds(startedAt, durationMs)), 200);
    return () => clearInterval(id);
  }, [startedAt, durationMs]);

  const label = seconds > 0 ? String(seconds) : "Go!";
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black/50 backdrop-blur-sm">
      <SwordsIcon className="h-12 w-12 animate-pulse text-white/80" aria-hidden />
      <p className="text-sm font-semibold uppercase tracking-[0.25em] text-white/60">
        Battle starting
      </p>
      {/* The visible number re-mounts each tick (key) to replay its pop
          animation. The live region is a separate, STABLE node whose text just
          mutates, so screen readers reliably announce each count. */}
      <span
        key={seconds}
        aria-hidden
        className="font-mono text-7xl font-bold text-white [text-shadow:0_4px_24px_rgba(0,0,0,0.6)] motion-safe:animate-[route-view-in_300ms_ease-out]"
      >
        {label}
      </span>
      <output aria-live="assertive" className="sr-only">
        {label}
      </output>
    </div>
  );
}
