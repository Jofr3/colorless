// The lobby WIRE protocol (P1 milestone 8 — backend-data.md §3.6): Zod schemas
// for the frames that cross the WebSocket between the web client and the lobby
// Durable Object, hand-written to mirror types.ts. types.ts stays the single
// source of truth for the SHAPES — these schemas only add runtime validation at
// the server boundary — and the exported `…MatchesType` proofs below make any
// drift between a schema and its type a compile error: each one only
// typechecks while the schema's inferred type is EXACTLY the shared type.
//
// Direction matters. The full `LobbyMessage` union is the transport-channel
// vocabulary the client code was written against; over the socket only a
// subset travels each way:
//   - client → server: `LobbyClientMessage` — hello / intent / kick / bye /
//     rematch.
//     The kick IS the `reject … "kicked"` frame the BroadcastChannel host used
//     to post at its guest, narrowed so a client can never fabricate a "full".
//   - server → client: `LobbyServerMessage` — state broadcasts + rejections.
// Both envelopes are strict subsets of `LobbyMessage`, so the existing
// channel interface (`post(message: LobbyMessage)`) carries them unchanged.
//
// The zod-free protocol constants (countdown length, keepalive strings) live
// in protocol.ts so the web client can import them without bundling zod.

import { z } from "zod";
import { redactedGameSchema, seatLogEntrySchema, wireActionSchema } from "../match";
import type {
  LobbyIntent,
  LobbyMessage,
  LobbyPhase,
  LobbySlot,
  LobbySnapshot,
  PlayerState,
} from "./types";

/** Compile-time exact-equality check: mutual assignability, not just extends. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

export const lobbySlotSchema = z.enum(["host", "guest"]);
export const lobbySlotSchemaMatchesType: Equals<z.infer<typeof lobbySlotSchema>, LobbySlot> = true;

export const lobbyPhaseSchema = z.enum(["waiting", "selecting", "countdown", "in-game"]);
export const lobbyPhaseSchemaMatchesType: Equals<
  z.infer<typeof lobbyPhaseSchema>,
  LobbyPhase
> = true;

export const playerStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  deckId: z.string().nullable(),
  deckName: z.string().nullable(),
  ready: z.boolean(),
  connected: z.boolean(),
  avatarSeed: z.string().nullable(),
  forfeitAt: z.number().nullable(),
});
export const playerStateSchemaMatchesType: Equals<
  z.infer<typeof playerStateSchema>,
  PlayerState
> = true;

export const lobbySnapshotSchema = z.object({
  code: z.string(),
  phase: lobbyPhaseSchema,
  host: playerStateSchema,
  guest: playerStateSchema.nullable(),
  countdownStartedAt: z.number().nullable(),
});
export const lobbySnapshotSchemaMatchesType: Equals<
  z.infer<typeof lobbySnapshotSchema>,
  LobbySnapshot
> = true;

export const lobbyIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("select-deck"), deckId: z.string(), deckName: z.string() }),
  z.object({ type: z.literal("set-ready"), ready: z.boolean() }),
  z.object({ type: z.literal("set-name"), name: z.string() }),
]);
export const lobbyIntentSchemaMatchesType: Equals<
  z.infer<typeof lobbyIntentSchema>,
  LobbyIntent
> = true;

// The individual message shapes, composed into the three unions below.
const helloMessageSchema = z.object({
  kind: z.literal("hello"),
  from: z.string(),
  name: z.string(),
});
const stateMessageSchema = z.object({
  kind: z.literal("state"),
  snapshot: lobbySnapshotSchema,
});
const matchMessageSchema = z.object({
  kind: z.literal("match"),
  game: redactedGameSchema,
  log: z.array(seatLogEntrySchema),
});
const intentMessageSchema = z.object({
  kind: z.literal("intent"),
  from: z.string(),
  intent: lobbyIntentSchema,
});
const actionMessageSchema = z.object({
  kind: z.literal("action"),
  action: wireActionSchema,
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
const byeMessageSchema = z.object({
  kind: z.literal("bye"),
  from: z.string(),
  slot: lobbySlotSchema,
});
const rematchMessageSchema = z.object({
  kind: z.literal("rematch"),
  from: z.string(),
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

/** What a client may send the lobby server. The DO validates EVERY inbound
    frame against this and silently drops anything else (§3.6). */
export const lobbyClientMessageSchema = z.discriminatedUnion("kind", [
  helloMessageSchema,
  intentMessageSchema,
  actionMessageSchema,
  z.object({ kind: z.literal("reject"), to: z.string(), reason: z.literal("kicked") }),
  byeMessageSchema,
  rematchMessageSchema,
]);
export type LobbyClientMessage =
  | Extract<LobbyMessage, { kind: "hello" | "intent" | "action" | "bye" | "rematch" }>
  | { kind: "reject"; to: string; reason: "kicked" };
export const lobbyClientMessageSchemaMatchesType: Equals<
  z.infer<typeof lobbyClientMessageSchema>,
  LobbyClientMessage
> = true;
/** Every client frame is a legal `LobbyMessage`, so `channel.post` carries it. */
export const lobbyClientMessagesAreLobbyMessages: LobbyClientMessage extends LobbyMessage
  ? true
  : false = true;

/** What the lobby server sends a client: authoritative snapshots after every
    change, rejections ("full" to a refused hello, "kicked" to a removed guest),
    each socket's redacted in-game match view (P4), a transient `reject-action`
    to the actor when a game action is refused, and a `match-error` to both when
    a match couldn't start (a deck wouldn't resolve, increment 3). Keepalive pongs
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
