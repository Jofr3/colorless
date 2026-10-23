// What a lobby socket remembers across hibernation. `playerId` is set by the first valid hello.
// `userId` is the account from the session cookie at upgrade, set independently and never
// broadcast. `spectating` marks a refused socket watching the match; spectators have no seat.

/** The slice of the WebSocket API the codec touches — lets tests use a plain
    fake instead of a runtime socket. */
export type AttachmentCarrier = Pick<WebSocket, "serializeAttachment" | "deserializeAttachment">;

type LobbyAttachment = {
  playerId: string | null;
  userId: string | null;
  spectating: boolean;
};

function read(ws: AttachmentCarrier): LobbyAttachment {
  const raw: unknown = ws.deserializeAttachment();
  if (typeof raw !== "object" || raw === null) {
    return { playerId: null, userId: null, spectating: false };
  }
  const partial = raw as Partial<LobbyAttachment>;
  return {
    playerId: typeof partial.playerId === "string" ? partial.playerId : null,
    userId: typeof partial.userId === "string" ? partial.userId : null,
    spectating: partial.spectating === true,
  };
}

/** Bind a socket to the player id its hello announced, preserving any userId
    already resolved at the /ws upgrade. */
export function attachPlayer(ws: AttachmentCarrier, playerId: string): void {
  // Taking a seat ends any spectating: the same browser can be refused a seat,
  // watch for a while, and then be seated when one frees up.
  const { userId } = read(ws);
  ws.serializeAttachment({ playerId, userId, spectating: false } satisfies LobbyAttachment);
}

/** Record the authenticated account for a socket (set at the /ws upgrade, before
    any hello), preserving any playerId already bound. */
export function attachUserId(ws: AttachmentCarrier, userId: string): void {
  const { playerId, spectating } = read(ws);
  ws.serializeAttachment({ playerId, userId, spectating } satisfies LobbyAttachment);
}

/** Mark a socket a SPECTATOR of the running match (P4 3c-vii-b) — refused a seat
    while both are held, and watching instead. Keeps any resolved account (they
    may still be signed in) and never grants a playerId, which is what stops a
    spectator's frames from acting on a seat: every handler that matters gates on
    `attachedPlayer`, and theirs stays null. */
export function attachSpectator(ws: AttachmentCarrier): void {
  const { userId } = read(ws);
  ws.serializeAttachment({ playerId: null, userId, spectating: true } satisfies LobbyAttachment);
}

/** Whether this socket is watching the match without a seat. */
export function isSpectating(ws: AttachmentCarrier): boolean {
  return read(ws).spectating;
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
