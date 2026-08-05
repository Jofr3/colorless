// The game-log rows the authoritative match server (the lobby Durable Object,
// P4) accumulates and broadcasts alongside the redacted board. The engine's
// `logFromEvents(events, ctx)` (packages/engine/src/log.ts) turns a GameEvent
// batch into these, run server-side with the full state — exactly as the web
// app's hot-seat /play page already does client-side.
//
// A row is SEAT-KEYED (`who` is the ABSOLUTE p1/p2, not viewer-relative like the
// rest of RedactedGame) and deliberately: the log is LEAK-SAFE regardless of
// viewer — draws and prize takes are counts only, face-down setup placements are
// never named, and every name it does carry is resolved off PUBLIC state — so
// the same array is broadcast to BOTH clients unchanged, and each maps `who` to
// "you"/"opponent" for its own seat at render time (`viewLogEntries`, web). That
// mapping can't happen server-side without redacting the log per viewer for no
// security gain; keeping the wire seat-keyed makes the log's viewer-independence
// explicit (it mirrors `RedactedPokemonRef`'s absolute seat, not the board's
// you/opponent relabeling).
//
// This module is the SINGLE SOURCE OF TRUTH for the wire shape (the RedactedGame
// pattern): the Zod schema defines it and the types are inferred from it. The
// engine imports these types and builds objects matching them; the web client
// maps them into the playmat's own `LogEntry`/`LogSegment` render vocabulary
// (src/features/playmat/types.ts — structurally identical, restated there so the
// playmat keeps zero cross-package imports, the RedactedConditions/BattleState
// precedent).

import { z } from "zod";

/** How a log segment is emphasised when rendered — mirrors the playmat's
    `LogSegmentTone`. `default` is the un-toned fallback; the log builder only
    ever sets strong/energy/damage or omits `tone`. */
export const logSegmentToneSchema = z.enum(["default", "strong", "energy", "damage"]);
export type LogSegmentTone = z.infer<typeof logSegmentToneSchema>;

/** One run of text within a log row, optionally toned. Structurally the
    playmat's `LogSegment`. */
export const logSegmentSchema = z.object({
  text: z.string(),
  tone: logSegmentToneSchema.optional(),
});
export type LogSegment = z.infer<typeof logSegmentSchema>;

/** Who a log row is filed under — an ABSOLUTE seat, or the game itself
    (`system`: the coin toss, Checkup ticks, the win). The web maps p1/p2 into
    the viewer's you/opponent (`viewLogEntries`); `system` stays as-is. */
export const seatLogSourceSchema = z.enum(["p1", "p2", "system"]);
export type SeatLogSource = z.infer<typeof seatLogSourceSchema>;

/** One accumulated game-log row, seat-keyed. An `action` row is a formatted
    line (its segments + the actor + the "+MM:SS" elapsed stamp); a `turn` row is
    the between-turns divider. Mirrors the engine's own emit shape field-for-
    field; the DO stores a growing `SeatLogEntry[]` in the match record and sends
    it on every `{kind:"match"}` frame. */
export const seatLogEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("action"),
    who: seatLogSourceSchema,
    elapsed: z.string(),
    segments: z.array(logSegmentSchema),
  }),
  z.object({ kind: z.literal("turn"), turn: z.number() }),
]);
export type SeatLogEntry = z.infer<typeof seatLogEntrySchema>;
