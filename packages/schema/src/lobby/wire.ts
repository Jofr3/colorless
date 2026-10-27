// Zod schemas for the lobby WebSocket frames, mirroring types.ts; the `…MatchesType` proofs make
// any drift a compile error. Clients send `LobbyClientMessage`, the server sends
// `LobbyServerMessage`, both subsets of `LobbyMessage`. Zod-free constants live in protocol.ts so
// the client need not bundle zod. This file holds what the server parses; the frames only the
// server sends are in serverWire.ts, so the Worker never builds the redacted-game schema.

import * as z from "zod";
import { wireActionSchema } from "../match/action";
import type { Equals } from "./equals";
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

// The message shapes a client sends, composed here and, with the server's, in serverWire.ts.
export const helloMessageSchema = z.object({
  kind: z.literal("hello"),
  from: z.string(),
  name: z.string(),
  logDeltas: z.boolean().optional(),
});
export const intentMessageSchema = z.object({
  kind: z.literal("intent"),
  from: z.string(),
  intent: lobbyIntentSchema,
});
export const actionMessageSchema = z.object({
  kind: z.literal("action"),
  action: wireActionSchema,
});
export const byeMessageSchema = z.object({
  kind: z.literal("bye"),
  from: z.string(),
  slot: lobbySlotSchema,
});
export const rematchMessageSchema = z.object({
  kind: z.literal("rematch"),
  from: z.string(),
});

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
