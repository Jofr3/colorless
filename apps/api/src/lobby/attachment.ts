// What a lobby socket remembers across hibernation. `playerId` is set by the first valid hello: the
// PUBLIC id of the seat whose secret the hello presented (seatId.ts), never the secret.
// `userId`, `sessionId` and `displayName` are the account from the session cookie at upgrade, set
// independently of the seat; none is ever broadcast. The session id lets the match handoff check
// that the session still lives when it reads the account's decks. `connectedAt` is when the upgrade
// was accepted, which the liveness sweep judges a never-answered socket by. `logDeltas` records
// that the socket's hello announced it takes log deltas in match frames.
//
// Attachments written before `sessionId` and `connectedAt` existed read them as null. A deploy
// disconnects every socket, so such attachments do not outlive one in practice; the readers below
// say what a null means.

/** The slice of the WebSocket API the codec touches — lets tests use a plain
    fake instead of a runtime socket. */
export type AttachmentCarrier = Pick<WebSocket, "serializeAttachment" | "deserializeAttachment">;

type LobbyAttachment = {
  playerId: string | null;
  userId: string | null;
  sessionId: string | null;
  displayName: string | null;
  connectedAt: number | null;
  logDeltas: boolean;
  overflow: boolean;
};

/** The runtime caps an attachment at 2 KB, so an account name is clipped well below it. */
const ATTACHED_NAME_MAX = 256;

function read(ws: AttachmentCarrier): LobbyAttachment {
  const raw: unknown = ws.deserializeAttachment();
  if (typeof raw !== "object" || raw === null) {
    return {
      playerId: null,
      userId: null,
      sessionId: null,
      displayName: null,
      connectedAt: null,
      logDeltas: false,
      overflow: false,
    };
  }
  const partial = raw as Partial<LobbyAttachment>;
  return {
    playerId: typeof partial.playerId === "string" ? partial.playerId : null,
    userId: typeof partial.userId === "string" ? partial.userId : null,
    sessionId: typeof partial.sessionId === "string" ? partial.sessionId : null,
    displayName: typeof partial.displayName === "string" ? partial.displayName : null,
    connectedAt: Number.isFinite(partial.connectedAt) ? (partial.connectedAt as number) : null,
    logDeltas: partial.logDeltas === true,
    overflow: partial.overflow === true,
  };
}

function update(ws: AttachmentCarrier, patch: Partial<LobbyAttachment>): void {
  ws.serializeAttachment({ ...read(ws), ...patch } satisfies LobbyAttachment);
}

/** Bind a socket to the public id of the seat its hello claimed, preserving any account
    already resolved at the /ws upgrade. */
export function attachPlayer(ws: AttachmentCarrier, playerId: string): void {
  update(ws, { playerId });
}

/** Record the authenticated account, the session that authenticated it and its lobby name (null
    to keep the announced one) for a socket, set at the /ws upgrade before any hello, preserving
    any playerId already bound. */
export function attachAccount(
  ws: AttachmentCarrier,
  account: { userId: string; sessionId: string; displayName: string | null },
): void {
  update(ws, {
    userId: account.userId,
    sessionId: account.sessionId,
    displayName: account.displayName?.slice(0, ATTACHED_NAME_MAX) ?? null,
  });
}

/** Record when the /ws upgrade accepted this socket. */
export function attachConnectedAt(ws: AttachmentCarrier, connectedAt: number): void {
  update(ws, { connectedAt });
}

/** Record whether the socket's latest hello announced that it takes log deltas. */
export function attachLogDeltas(ws: AttachmentCarrier, logDeltas: boolean): void {
  update(ws, { logDeltas });
}

/** Mark a socket admitted past the lobby's socket cap: its hello is answered "full" and it is
    closed, and it never takes a seat or receives a broadcast. */
export function attachOverflow(ws: AttachmentCarrier): void {
  update(ws, { overflow: true });
}

/** Whether this socket was admitted past the socket cap only to be turned away. */
export function isOverflow(ws: AttachmentCarrier): boolean {
  return read(ws).overflow;
}

/** Whether this socket's match frames may carry only the log's new entries. */
export function takesLogDeltas(ws: AttachmentCarrier): boolean {
  return read(ws).logDeltas;
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

/** The account and the session that authenticated it, as the handoff's deck read needs them, or
    null for an anonymous socket. An attachment from before `sessionId` existed reads as null too:
    its session can't be re-checked, so it plays like an anonymous one. */
export function attachedSession(
  ws: AttachmentCarrier,
): { userId: string; sessionId: string } | null {
  const { userId, sessionId } = read(ws);
  return userId === null || sessionId === null ? null : { userId, sessionId };
}

/** When the upgrade accepted this socket, or null for an attachment from before it was recorded. */
export function attachedConnectedAt(ws: AttachmentCarrier): number | null {
  return read(ws).connectedAt;
}

/** The lobby name of the socket's account as read at the upgrade, or null for an anonymous socket
    or a blank account name. */
export function attachedDisplayName(ws: AttachmentCarrier): string | null {
  return read(ws).displayName;
}
