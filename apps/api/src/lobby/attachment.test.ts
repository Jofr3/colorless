import { describe, expect, it } from "vitest";
import {
  type AttachmentCarrier,
  attachedPlayer,
  attachedUserId,
  attachPlayer,
  attachUserId,
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
    attachUserId(ws, "user-9");
    expect(attachedUserId(ws)).toBe("user-9");
    expect(attachedPlayer(ws)).toBeNull();
    // The later hello binds the playerId WITHOUT dropping the userId…
    attachPlayer(ws, "player-1");
    expect(attachedPlayer(ws)).toBe("player-1");
    expect(attachedUserId(ws)).toBe("user-9");
    // …and setting the userId again preserves the playerId.
    attachUserId(ws, "user-10");
    expect(attachedUserId(ws)).toBe("user-10");
    expect(attachedPlayer(ws)).toBe("player-1");
  });

  it("reads userId as null for an anonymous or foreign attachment", () => {
    expect(attachedUserId(fakeSocket())).toBeNull();
    expect(attachedUserId(fakeSocket({ playerId: "p1" }))).toBeNull(); // userId absent
    expect(attachedUserId(fakeSocket({ userId: 42 }))).toBeNull();
  });
});
