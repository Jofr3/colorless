import { describe, expect, it } from "vitest";
import { type AttachmentCarrier, attachedPlayer, attachPlayer } from "./attachment";

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
});
