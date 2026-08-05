// The seat→viewer relabel (viewLog.ts). The engine's log.test.ts pins the row
// CONTENT + that rows are filed under the actor's absolute seat; this pins the
// tiny render-side mapping into the playmat's you/opponent/system vocabulary.

import type { SeatLogEntry } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { viewLogEntries } from "./viewLog";

const SEAT_LOG: SeatLogEntry[] = [
  { kind: "action", who: "p1", elapsed: "+00:01", segments: [{ text: "a" }] },
  { kind: "action", who: "p2", elapsed: "+00:02", segments: [{ text: "b" }] },
  { kind: "action", who: "system", elapsed: "+00:03", segments: [{ text: "c" }] },
  { kind: "turn", turn: 3 },
];

describe("viewLogEntries", () => {
  it("maps seats into the current viewer's vocabulary", () => {
    expect(viewLogEntries(SEAT_LOG, "p1").map((e) => (e.kind === "action" ? e.who : e.turn))).toEqual(
      ["you", "opponent", "system", 3],
    );
    // The SAME seat log read from the other seat flips you/opponent — the
    // property the online broadcast relies on (one array, two viewers).
    expect(viewLogEntries(SEAT_LOG, "p2").map((e) => (e.kind === "action" ? e.who : e.turn))).toEqual(
      ["opponent", "you", "system", 3],
    );
  });

  it("carries elapsed + segments through untouched", () => {
    const [row] = viewLogEntries(SEAT_LOG, "p1");
    expect(row).toEqual({ kind: "action", who: "you", elapsed: "+00:01", segments: [{ text: "a" }] });
  });
});
