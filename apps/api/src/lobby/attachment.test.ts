import { describe, expect, it } from "vitest";
import {
  type AttachmentCarrier,
  attachConnectedAt,
  attachedConnectedAt,
  attachedDisplayName,
  attachedPlayer,
  attachedSession,
  attachedUserId,
  attachLogDeltas,
  attachOverflow,
  attachPlayer,
  attachAccount,
  isOverflow,
  takesLogDeltas,
} from "./attachment";

/** The runtime contract in miniature: whatever was serialized comes back. */
function fakeSocket(initial: unknown = null): AttachmentCarrier {
  let attachment: unknown = initial;
  return {
    serializeAttachment: (value: unknown) => {
      attachment = value;
    },
    deserializeAttachment: () => attachment,
  } as AttachmentCarrier;
}

/** An account as the /ws upgrade resolves it. */
function account(userId: string, displayName: string | null) {
  return { userId, sessionId: `session-of-${userId}`, displayName };
}

describe("attachment codec", () => {
  it("marks a turned-away socket, keeping the rest, and reads an older attachment as a member", () => {
    const ws = fakeSocket({ playerId: null, userId: "u", connectedAt: 5 });
    expect(isOverflow(ws)).toBe(false);
    attachOverflow(ws);
    expect(isOverflow(ws)).toBe(true);
    expect(attachedUserId(ws)).toBe("u");
    expect(attachedConnectedAt(ws)).toBe(5);
  });

  it("round-trips a player id", () => {
    const ws = fakeSocket();
    attachPlayer(ws, "player-1");
    expect(attachedPlayer(ws)).toBe("player-1");
  });

  it("reads a never-attached socket as null", () => {
    expect(attachedPlayer(fakeSocket())).toBeNull();
  });

  it("reads foreign attachment shapes as null", () => {
    expect(attachedPlayer(fakeSocket("player-1"))).toBeNull();
    expect(attachedPlayer(fakeSocket({ playerId: 42 }))).toBeNull();
    expect(attachedPlayer(fakeSocket({}))).toBeNull();
  });

  it("re-attaching overwrites the previous binding", () => {
    const ws = fakeSocket();
    attachPlayer(ws, "player-1");
    attachPlayer(ws, "player-2");
    expect(attachedPlayer(ws)).toBe("player-2");
  });

  it("carries the userId independently, set before the playerId (the /ws → hello order)", () => {
    const ws = fakeSocket();
    // /ws upgrade authenticates the account first — no playerId yet.
    attachAccount(ws, account("user-9", null));
    expect(attachedUserId(ws)).toBe("user-9");
    expect(attachedPlayer(ws)).toBeNull();
    // The later hello binds the playerId WITHOUT dropping the userId…
    attachPlayer(ws, "player-1");
    expect(attachedPlayer(ws)).toBe("player-1");
    expect(attachedUserId(ws)).toBe("user-9");
    // …and setting the userId again preserves the playerId.
    attachAccount(ws, account("user-10", null));
    expect(attachedUserId(ws)).toBe("user-10");
    expect(attachedPlayer(ws)).toBe("player-1");
  });

  it("carries the account's lobby name beside its id, clipped, through every other write", () => {
    const ws = fakeSocket();
    expect(attachedDisplayName(ws)).toBeNull();
    attachAccount(ws, account("user-9", "Ana"));
    attachPlayer(ws, "player-1");
    attachLogDeltas(ws, true);
    attachConnectedAt(ws, 1);
    expect(attachedDisplayName(ws)).toBe("Ana");
    attachAccount(ws, account("user-9", null));
    expect(attachedDisplayName(ws)).toBeNull();
    attachAccount(ws, account("user-9", "x".repeat(5000)));
    expect(attachedDisplayName(ws)).toBe("x".repeat(256));
    expect(attachedDisplayName(fakeSocket({ displayName: 7 }))).toBeNull();
  });

  it("reads userId as null for an anonymous or foreign attachment", () => {
    expect(attachedUserId(fakeSocket())).toBeNull();
    expect(attachedUserId(fakeSocket({ playerId: "p1" }))).toBeNull(); // userId absent
    expect(attachedUserId(fakeSocket({ userId: 42 }))).toBeNull();
  });
});

describe("the session and the connection time", () => {
  it("carry the account's session and the upgrade's instant through every other write", () => {
    const ws = fakeSocket();
    attachConnectedAt(ws, 1234);
    attachAccount(ws, account("user-9", "Ana"));
    attachPlayer(ws, "player-1");
    attachLogDeltas(ws, true);
    expect(attachedSession(ws)).toEqual({ userId: "user-9", sessionId: "session-of-user-9" });
    expect(attachedConnectedAt(ws)).toBe(1234);
  });

  it("read an anonymous socket, or an attachment from before they existed, as null", () => {
    expect(attachedSession(fakeSocket())).toBeNull();
    expect(attachedConnectedAt(fakeSocket())).toBeNull();
    const old = fakeSocket({ playerId: "p", userId: "user-9", displayName: null });
    expect(attachedUserId(old)).toBe("user-9");
    expect(attachedSession(old)).toBeNull();
    expect(attachedConnectedAt(fakeSocket({ connectedAt: "soon" }))).toBeNull();
  });
});

describe("the log-delta flag", () => {
  it("reads false until a hello announces it, and survives every other write", () => {
    const ws = fakeSocket();
    expect(takesLogDeltas(ws)).toBe(false);
    attachAccount(ws, account("user-9", null));
    attachLogDeltas(ws, true);
    attachConnectedAt(ws, 1);
    expect(takesLogDeltas(ws)).toBe(true);
    attachPlayer(ws, "player-1");
    attachAccount(ws, account("user-10", null));
    expect(takesLogDeltas(ws)).toBe(true);
    expect(attachedPlayer(ws)).toBe("player-1");
    attachLogDeltas(ws, false);
    expect(takesLogDeltas(ws)).toBe(false);
    expect(attachedUserId(ws)).toBe("user-10");
  });

  it("reads false for an attachment written without it", () => {
    expect(takesLogDeltas(fakeSocket({ playerId: "p", userId: null, spectating: false }))).toBe(
      false,
    );
    expect(takesLogDeltas(fakeSocket({ logDeltas: "yes" }))).toBe(false);
  });
});
