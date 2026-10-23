// Game-log rows the match server broadcasts. Rows are seat-keyed (`who` is absolute p1/p2) because
// the log is leak-safe for any viewer, so the same array goes to both clients and each maps `who`
// to you/opponent. Types are inferred from the Zod schema.

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
    /** Public identity of a Trainer played/attached on this row. Older logs omit it. */
    playedTrainer: z.object({ id: z.string(), cardId: z.string(), name: z.string() }).optional(),
  }),
  z.object({ kind: z.literal("turn"), turn: z.number() }),
]);
export type SeatLogEntry = z.infer<typeof seatLogEntrySchema>;
