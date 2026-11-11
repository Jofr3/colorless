// The lobby frames only the server sends, and the union of every frame. Nothing on the server
// parses them, so they live apart from wire.ts and the Worker never builds them; the tests check
// frames against them.

import * as z from "zod";
import { redactedGameSchema } from "../match/redacted";
import { seatLogEntrySchema } from "../match/log";
import type { Equals } from "./equals";
import type { LobbyMessage } from "./types";
import {
  actionMessageSchema,
  byeMessageSchema,
  helloMessageSchema,
  intentMessageSchema,
  lobbySlotSchema,
  lobbySnapshotSchema,
  rematchMessageSchema,
} from "./wire";

const stateMessageSchema = z.object({
  kind: z.literal("state"),
  snapshot: lobbySnapshotSchema,
});
const matchMessageSchema = z.object({
  kind: z.literal("match"),
  game: redactedGameSchema,
  log: z.array(seatLogEntrySchema),
  logFrom: z.number().int().nonnegative().optional(),
});
const rejectMessageSchema = z.object({
  kind: z.literal("reject"),
  to: z.string(),
  reason: z.enum(["full", "kicked"]),
});
const rejectActionMessageSchema = z.object({
  kind: z.literal("reject-action"),
  reason: z.string(),
});
const matchErrorMessageSchema = z.object({
  kind: z.literal("match-error"),
  reason: z.string(),
});
const heartbeatMessageSchema = z.object({
  kind: z.literal("heartbeat"),
  from: z.string(),
  slot: lobbySlotSchema,
});

/** Everything that can travel over a lobby channel — the full types.ts union. */
export const lobbyMessageSchema = z.discriminatedUnion("kind", [
  helloMessageSchema,
  stateMessageSchema,
  matchMessageSchema,
  intentMessageSchema,
  actionMessageSchema,
  rejectMessageSchema,
  rejectActionMessageSchema,
  matchErrorMessageSchema,
  heartbeatMessageSchema,
  byeMessageSchema,
  rematchMessageSchema,
]);
export const lobbyMessageSchemaMatchesType: Equals<
  z.infer<typeof lobbyMessageSchema>,
  LobbyMessage
> = true;

/** What the lobby server sends a client: authoritative snapshots after every
    change, rejections ("full" to a refused hello, "kicked" to a removed guest),
    each socket's redacted in-game match view, a transient `reject-action`
    to the actor when a game action is refused, and a `match-error` to both when
    a match couldn't start (a deck wouldn't resolve). Keepalive pongs
    are raw strings, not frames — see LOBBY_WS_PONG. */
export const lobbyServerMessageSchema = z.discriminatedUnion("kind", [
  stateMessageSchema,
  matchMessageSchema,
  rejectMessageSchema,
  rejectActionMessageSchema,
  matchErrorMessageSchema,
]);
export type LobbyServerMessage = Extract<
  LobbyMessage,
  { kind: "state" | "match" | "reject" | "reject-action" | "match-error" }
>;
export const lobbyServerMessageSchemaMatchesType: Equals<
  z.infer<typeof lobbyServerMessageSchema>,
  LobbyServerMessage
> = true;
