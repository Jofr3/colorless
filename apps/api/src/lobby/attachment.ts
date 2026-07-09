// What a lobby socket remembers about itself across Durable Object
// hibernation. The runtime serializes the attachment with the socket, so when
// the DO is evicted and later woken by a frame, `attachedPlayer` still knows
// which player the socket belongs to — no in-memory socket→player map to lose.
//
// A socket has NO attachment until its first valid `hello` seats it; frames
// from an unattached socket can't act on anyone's seat.

/** The slice of the WebSocket API the codec touches — lets tests use a plain
    fake instead of a runtime socket. */
export type AttachmentCarrier = Pick<WebSocket, "serializeAttachment" | "deserializeAttachment">;

type LobbyAttachment = { playerId: string };

/** Bind a socket to the player id its hello announced. */
export function attachPlayer(ws: AttachmentCarrier, playerId: string): void {
  ws.serializeAttachment({ playerId } satisfies LobbyAttachment);
}

/** The player id a socket is bound to, or null for a never-seated socket (or
    an attachment shape this code didn't write). */
export function attachedPlayer(ws: AttachmentCarrier): string | null {
  const raw: unknown = ws.deserializeAttachment();
  if (typeof raw !== "object" || raw === null) return null;
  const playerId = (raw as Partial<LobbyAttachment>).playerId;
  return typeof playerId === "string" ? playerId : null;
}
