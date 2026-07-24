// Seat log → the playmat's LogEntry, for the CURRENT viewer. The engine's
// `logFromEvents` records rows seat-keyed (SeatLogEntry, @luminous/schema) so the
// accumulated log outlives its viewer — the hot-seat device flip on /play, and
// online where the same array reaches both clients. This is the render-side
// relabel: p1/p2 → "you"/"opponent" for whoever is looking now, `system`
// untouched. It is the log's twin of `projectionFromRedacted` (projection.ts) —
// the wire→render mapping the redactor precedent (D60) keeps in the web, not the
// engine, so the playmat renders the neutral `LogEntry` with zero engine imports.

import type { Seat } from "@luminous/engine";
import type { SeatLogEntry } from "@luminous/schema";
import type { LogEntry } from "../playmat/types";

export function viewLogEntries(entries: readonly SeatLogEntry[], viewerSeat: Seat): LogEntry[] {
  return entries.map((entry) => {
    if (entry.kind === "turn") return entry;
    return {
      ...entry,
      who: entry.who === "system" ? "system" : entry.who === viewerSeat ? "you" : "opponent",
    };
  });
}
