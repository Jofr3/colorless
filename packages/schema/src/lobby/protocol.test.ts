import { describe, expect, it } from "vitest";
import {
  LOBBY_PING_MS,
  LOBBY_SILENCE_MS,
  LOBBY_WS_NUDGE,
  LOBBY_WS_PING,
  LOBBY_WS_PONG,
} from "./protocol";

describe("the lobby keepalive (APP7)", () => {
  it("gives a socket at least four missed pings before either end gives it up", () => {
    expect(LOBBY_SILENCE_MS).toBeGreaterThanOrEqual(4 * LOBBY_PING_MS);
  });

  it("keeps its three raw strings apart", () => {
    expect(new Set([LOBBY_WS_PING, LOBBY_WS_PONG, LOBBY_WS_NUDGE]).size).toBe(3);
  });
});
