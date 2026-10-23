// Seat log to the playmat's LogEntry for the current viewer: relabels p1/p2 as "you"/"opponent" for
// whoever is looking, leaving `system` untouched. The log is stored seat-keyed so it outlives a
// hot-seat flip and reaches both online clients.

import type { Seat } from "@colorless/engine";
import type { SeatLogEntry } from "@colorless/schema";
import type { LogEntry } from "./board";

export function viewLogEntries(entries: readonly SeatLogEntry[], viewerSeat: Seat): LogEntry[] {
  return entries.map((entry) => {
    if (entry.kind === "turn") return entry;
    return {
      ...entry,
      who: entry.who === "system" ? "system" : entry.who === viewerSeat ? "you" : "opponent",
    };
  });
}
