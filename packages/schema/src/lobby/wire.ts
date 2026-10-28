// Zod schemas for the lobby WebSocket frames, mirroring types.ts; the `…MatchesType` proofs make
// any drift a compile error. Clients send `LobbyClientMessage`, the server sends
// `LobbyServerMessage`, both subsets of `LobbyMessage`. Zod-free constants live in protocol.ts so
// the client need not bundle zod. This file holds what the server parses; the frames only the
// server sends are in serverWire.ts, so the Worker never builds the redacted-game schema.

import * as z from "zod";
import { cleanDisplayName } from "../displayName";
import { wireActionSchema } from "../match/action";
import { clipText } from "../text";
import type { Equals } from "./equals";
import { LOBBY_DECK_NAME_MAX, LOBBY_ID_MAX } from "./protocol";
import type {
  LobbyIntent,
  LobbyMessage,
  LobbyPhase,
  LobbySlot,
  LobbySnapshot,
  PlayerState,
} from "./types";

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
  hasDeck: z.boolean(),
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

// The bounds on what a client sends (protocol.ts says which are refused and which clipped). The
// snapshot schemas above stay unbounded: they also describe what the server sends.
// Names also lose control and format characters (text.ts) before the clip. A hello's is stripped
// rather than refused: a refused hello is dropped unanswered, which would shut an account whose
// stored name predates the rule out of every lobby.
const clientId = z.string().max(LOBBY_ID_MAX);
const clippedString = (max: number) => z.string().transform((value) => clipText(value, max));

export const lobbyIntentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("select-deck"),
    deckId: clientId,
    deckName: clippedString(LOBBY_DECK_NAME_MAX),
  }),
  z.object({ type: z.literal("set-ready"), ready: z.boolean() }),
]);
export const lobbyIntentSchemaMatchesType: Equals<
  z.infer<typeof lobbyIntentSchema>,
  LobbyIntent
> = true;

// The message shapes a client sends, composed here and, with the server's, in serverWire.ts.
// A hello's `from` is the seat secret (seatId.ts). Its shape is the DO's to check rather than this
// schema's: a frame that fails here is dropped unanswered, and a client from before the secret
// should be told the lobby is full instead of waiting on silence.
export const helloMessageSchema = z.object({
  kind: z.literal("hello"),
  from: clientId,
  // The account display name's rule (displayName.ts), stripped rather than refused.
  name: z.string().transform(cleanDisplayName),
  logDeltas: z.boolean().optional(),
});
export const intentMessageSchema = z.object({
  kind: z.literal("intent"),
  from: clientId,
  intent: lobbyIntentSchema,
});
export const actionMessageSchema = z.object({
  kind: z.literal("action"),
  action: wireActionSchema,
});
export const byeMessageSchema = z.object({
  kind: z.literal("bye"),
  from: clientId,
  slot: lobbySlotSchema,
});
export const rematchMessageSchema = z.object({
  kind: z.literal("rematch"),
  from: clientId,
});

/** What a client may send the lobby server. The DO validates EVERY inbound
    frame against this and silently drops anything else (§3.6). */
export const lobbyClientMessageSchema = z.discriminatedUnion("kind", [
  helloMessageSchema,
  intentMessageSchema,
  actionMessageSchema,
  z.object({ kind: z.literal("reject"), to: clientId, reason: z.literal("kicked") }),
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
