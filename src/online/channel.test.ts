import type { LobbyMessage } from "@luminous/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLobbyChannel, reconnectDelayMs } from "./channel";

// The WebSocket transport's pure/mechanical parts, driven through a scripted
// fake socket: URL building, the post-queue-flush ordering, message dispatch,
// pong→heartbeat translation, keepalive pings, and reconnect-with-backoff.

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no FakeWebSocket constructed yet");
    return ws;
  }

  url: string;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closedWith = code ?? 1005;
    this.onclose?.();
  }

  // Test drivers.
  open(): void {
    this.onopen?.();
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
  drop(): void {
    this.onclose?.();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const HELLO: LobbyMessage = { kind: "hello", from: "p1", name: "Ana" };

describe("reconnectDelayMs", () => {
  it("doubles from 400ms and caps at 8s", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(reconnectDelayMs)).toEqual([
      400, 800, 1600, 3200, 6400, 8000, 8000,
    ]);
  });
});

describe("createLobbyChannel", () => {
  it("connects to the lobby's ws route on the api origin", () => {
    const channel = createLobbyChannel("ABCD");
    expect(FakeWebSocket.last().url).toBe("ws://localhost:8787/lobby/ABCD/ws");
    channel.close();
  });

  it("queues posts until the socket opens, then flushes in order", () => {
    const channel = createLobbyChannel("ABCD");
    const ws = FakeWebSocket.last();
    channel.post(HELLO);
    channel.post({ kind: "bye", from: "p1", slot: "guest" });
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(ws.sent.map((raw) => (JSON.parse(raw) as LobbyMessage).kind)).toEqual(["hello", "bye"]);
    channel.post(HELLO);
    expect(ws.sent).toHaveLength(3);
    channel.close();
  });

  it("dispatches parsed frames to subscribers and ignores junk", () => {
    const channel = createLobbyChannel("ABCD");
    const ws = FakeWebSocket.last();
    ws.open();
    const seen: LobbyMessage[] = [];
    channel.subscribe((message) => seen.push(message));
    ws.receive(JSON.stringify({ kind: "reject", to: "p1", reason: "full" }));
    ws.receive("not json");
    ws.receive(JSON.stringify({ nokind: true }));
    expect(seen).toEqual([{ kind: "reject", to: "p1", reason: "full" }]);
    channel.close();
  });

  it("translates server pongs into heartbeat frames", () => {
    const channel = createLobbyChannel("ABCD");
    const ws = FakeWebSocket.last();
    ws.open();
    const seen: LobbyMessage[] = [];
    channel.subscribe((message) => seen.push(message));
    ws.receive("pong");
    expect(seen).toEqual([{ kind: "heartbeat", from: "server", slot: "host" }]);
    channel.close();
  });

  it("pings on an interval while open", () => {
    const channel = createLobbyChannel("ABCD");
    const ws = FakeWebSocket.last();
    ws.open();
    vi.advanceTimersByTime(3100);
    expect(ws.sent.filter((frame) => frame === "ping")).toHaveLength(2);
    channel.close();
  });

  it("reconnects after an unexpected close and flushes messages posted while down", () => {
    const channel = createLobbyChannel("ABCD");
    const first = FakeWebSocket.last();
    first.open();
    first.drop();
    channel.post(HELLO);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(reconnectDelayMs(0));
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.last();
    second.open();
    expect(second.sent.map((raw) => (JSON.parse(raw) as LobbyMessage).kind)).toEqual(["hello"]);
    channel.close();
  });

  it("backs off between failed reconnect attempts", () => {
    createLobbyChannel("ABCD").subscribe(() => {});
    FakeWebSocket.last().drop(); // attempt 0 scheduled at 400ms
    vi.advanceTimersByTime(reconnectDelayMs(0));
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last().drop(); // attempt 1 scheduled at 800ms
    vi.advanceTimersByTime(reconnectDelayMs(0));
    expect(FakeWebSocket.instances).toHaveLength(2); // too early
    vi.advanceTimersByTime(reconnectDelayMs(1) - reconnectDelayMs(0));
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("close() shuts the socket and stops reconnecting", () => {
    const channel = createLobbyChannel("ABCD");
    const ws = FakeWebSocket.last();
    ws.open();
    channel.close();
    expect(ws.closedWith).toBe(1000);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
