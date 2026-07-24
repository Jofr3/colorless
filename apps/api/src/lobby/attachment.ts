// What a lobby socket remembers about itself across Durable Object
// hibernation. The runtime serializes the attachment with the socket, so when
// the DO is evicted and later woken by a frame, `attachedPlayer` still knows
// which player the socket belongs to — no in-memory socket→player map to lose.
//
// Two facts ride here. `playerId` is the lobby-scoped id the socket's first
// valid `hello` announced — a socket has none until then, so frames from an
// unattached socket can't act on anyone's seat. `userId` is the ACCOUNT the
// session cookie authenticated at the /ws upgrade (P4 increment 3), or null for
// an anonymous socket; it is set BEFORE the hello (no playerId yet), so the two
// are written independently and each preserves the other. userId never leaves
// the DO — it authorizes the owner-scoped deck read at the match handoff and is
// never put on the broadcast snapshot.

/** The slice of the WebSocket API the codec touches — lets tests use a plain
    fake instead of a runtime socket. */
export type AttachmentCarrier = Pick<WebSocket, "serializeAttachment" | "deserializeAttachment">;

type LobbyAttachment = { playerId: string | null; userId: string | null };

function read(ws: AttachmentCarrier): LobbyAttachment {
  const raw: unknown = ws.deserializeAttachment();
  if (typeof raw !== "object" || raw === null) return { playerId: null, userId: null };
  const partial = raw as Partial<LobbyAttachment>;
  return {
    playerId: typeof partial.playerId === "string" ? partial.playerId : null,
    userId: typeof partial.userId === "string" ? partial.userId : null,
  };
}

/** Bind a socket to the player id its hello announced, preserving any userId
    already resolved at the /ws upgrade. */
export function attachPlayer(ws: AttachmentCarrier, playerId: string): void {
  ws.serializeAttachment({ playerId, userId: read(ws).userId } satisfies LobbyAttachment);
}

/** Record the authenticated account for a socket (set at the /ws upgrade, before
    any hello), preserving any playerId already bound. */
export function attachUserId(ws: AttachmentCarrier, userId: string): void {
  ws.serializeAttachment({ playerId: read(ws).playerId, userId } satisfies LobbyAttachment);
}

/** The player id a socket is bound to, or null for a never-seated socket (or an
    attachment shape this code didn't write). */
export function attachedPlayer(ws: AttachmentCarrier): string | null {
  return read(ws).playerId;
}

/** The account id the socket's session authenticated, or null for an anonymous
    socket. Used only inside the DO (the deck-ownership check at handoff). */
export function attachedUserId(ws: AttachmentCarrier): string | null {
  return read(ws).userId;
}
