import { describe, expect, it } from "vitest";
import {
  type AttachmentCarrier,
  attachedDisplayName,
  attachedPlayer,
  attachedUserId,
  attachLogDeltas,
  attachPlayer,
  attachSpectator,
  attachAccount,
  isSpectating,
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

describe("attachment codec", () => {
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
    attachAccount(ws, "user-9", null);
    expect(attachedUserId(ws)).toBe("user-9");
    expect(attachedPlayer(ws)).toBeNull();
    // The later hello binds the playerId WITHOUT dropping the userId…
    attachPlayer(ws, "player-1");
    expect(attachedPlayer(ws)).toBe("player-1");
    expect(attachedUserId(ws)).toBe("user-9");
    // …and setting the userId again preserves the playerId.
    attachAccount(ws, "user-10", null);
    expect(attachedUserId(ws)).toBe("user-10");
    expect(attachedPlayer(ws)).toBe("player-1");
  });

  it("carries the account's lobby name beside its id, clipped, through every other write", () => {
    const ws = fakeSocket();
    expect(attachedDisplayName(ws)).toBeNull();
    attachAccount(ws, "user-9", "Ana");
    attachPlayer(ws, "player-1");
    attachLogDeltas(ws, true);
    attachSpectator(ws);
    expect(attachedDisplayName(ws)).toBe("Ana");
    attachAccount(ws, "user-9", null);
    expect(attachedDisplayName(ws)).toBeNull();
    attachAccount(ws, "user-9", "x".repeat(5000));
    expect(attachedDisplayName(ws)).toBe("x".repeat(256));
    expect(attachedDisplayName(fakeSocket({ displayName: 7 }))).toBeNull();
  });

  it("reads userId as null for an anonymous or foreign attachment", () => {
    expect(attachedUserId(fakeSocket())).toBeNull();
    expect(attachedUserId(fakeSocket({ playerId: "p1" }))).toBeNull(); // userId absent
    expect(attachedUserId(fakeSocket({ userId: 42 }))).toBeNull();
  });
});

describe("the log-delta flag", () => {
  it("reads false until a hello announces it, and survives every other write", () => {
    const ws = fakeSocket();
    expect(takesLogDeltas(ws)).toBe(false);
    attachAccount(ws, "user-9", null);
    attachLogDeltas(ws, true);
    attachSpectator(ws);
    expect(takesLogDeltas(ws)).toBe(true);
    attachPlayer(ws, "player-1");
    attachAccount(ws, "user-10", null);
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

describe("the spectator marker (3c-vii-b)", () => {
  it("marks a socket watching, WITHOUT giving it a seat", () => {
    // The safety property: every handler that can touch the game gates on
    // `attachedPlayer`, so a spectator must never acquire one.
    const ws = fakeSocket();
    attachSpectator(ws);
    expect(isSpectating(ws)).toBe(true);
    expect(attachedPlayer(ws)).toBeNull();
  });

  it("keeps the authenticated account (a watcher may still be signed in)", () => {
    const ws = fakeSocket();
    attachAccount(ws, "user-9", null);
    attachSpectator(ws);
    expect(attachedUserId(ws)).toBe("user-9");
    // …and the account survives while watching, so a later seat claim still
    // presents it to `seatClaimAllowed`.
    expect(isSpectating(ws)).toBe(true);
  });

  it("stops spectating the moment the socket takes a seat", () => {
    // A refused client can watch and then be seated when one frees up; leaving
    // the flag set would hand a seated player the seatless board.
    const ws = fakeSocket();
    attachSpectator(ws);
    attachPlayer(ws, "player-1");
    expect(isSpectating(ws)).toBe(false);
    expect(attachedPlayer(ws)).toBe("player-1");
  });

  it("reads a never-attached socket as not spectating", () => {
    expect(isSpectating(fakeSocket())).toBe(false);
    expect(isSpectating(fakeSocket({ playerId: "p" }))).toBe(false);
  });
});
