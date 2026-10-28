import { LOBBY_WS_CLOSED, type LobbyMessage } from "@colorless/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_TIMEOUT_MS,
  createLobbyChannel,
  reconnectDelayMs,
  SOCKET_SILENCE_MS,
  STABLE_OPEN_MS,
} from "./channel";

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
  onclose: ((event: { code: number }) => void) | null = null;
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
    this.onclose?.({ code: this.closedWith });
  }

  // Test drivers.
  open(): void {
    this.onopen?.();
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
  drop(code = 1006): void {
    this.onclose?.({ code });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // Reconnect delays at the middle of their jitter, so a test can wait out exactly one.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const HELLO: LobbyMessage = { kind: "hello", from: "p1", name: "Ana" };

describe("reconnectDelayMs", () => {
  it("doubles from 400ms and caps at 8s", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelayMs(attempt, 0.5))).toEqual([
      400, 800, 1600, 3200, 6400, 8000, 8000,
    ]);
  });

  it("spreads each delay by a fifth either way", () => {
    expect([0, 1].map((jitter) => reconnectDelayMs(0, jitter))).toEqual([320, 480]);
    expect([0, 1].map((jitter) => reconnectDelayMs(9, jitter))).toEqual([6400, 9600]);
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

  it("leads every reopened socket with the newest hello, though none was posted while down", () => {
    const channel = createLobbyChannel("ABCD");
    const first = FakeWebSocket.last();
    first.open();
    channel.post(HELLO);
    channel.post({ ...HELLO, name: "Ana B" });
    first.drop();
    const intent: LobbyMessage = {
      kind: "intent",
      from: "p1",
      intent: { type: "set-ready", ready: true },
    };
    channel.post(intent);
    vi.advanceTimersByTime(reconnectDelayMs(0));
    const second = FakeWebSocket.last();
    second.open();
    expect(second.sent.map((raw) => JSON.parse(raw) as LobbyMessage)).toEqual([
      { ...HELLO, name: "Ana B" },
      intent,
    ]);
    channel.close();
  });

  it("frames posted while down before the client's re-hello still follow a hello", () => {
    const channel = createLobbyChannel("ABCD");
    const first = FakeWebSocket.last();
    first.open();
    channel.post(HELLO);
    first.drop();
    const action: LobbyMessage = { kind: "action", action: { type: "endTurn", seat: "p1" } };
    channel.post(action);
    channel.post({ ...HELLO, name: "Ana B" });
    vi.advanceTimersByTime(reconnectDelayMs(0));
    const second = FakeWebSocket.last();
    second.open();
    expect(second.sent.map((raw) => JSON.parse(raw) as LobbyMessage)).toEqual([
      { ...HELLO, name: "Ana B" },
      action,
    ]);
    channel.close();
  });

  it("holds one hello while down, the newest, ahead of the frames posted after the first", () => {
    const channel = createLobbyChannel("ABCD");
    const ws = FakeWebSocket.last();
    const intent: LobbyMessage = {
      kind: "intent",
      from: "p1",
      intent: { type: "set-ready", ready: true },
    };
    channel.post(HELLO);
    channel.post(intent);
    for (let i = 0; i < 40; i++) channel.post({ ...HELLO, name: `Ana ${i}` });
    channel.post({ kind: "bye", from: "p1", slot: "guest" });
    ws.open();
    expect(ws.sent.map((raw) => JSON.parse(raw) as LobbyMessage)).toEqual([
      { ...HELLO, name: "Ana 39" },
      intent,
      { kind: "bye", from: "p1", slot: "guest" },
    ]);
    channel.post(HELLO);
    channel.post(HELLO);
    expect(ws.sent).toHaveLength(5);
    channel.close();
  });

  it("gives up on an open socket that hears nothing back for a while, and leads the next with the hello", () => {
    const channel = createLobbyChannel("ABCD");
    const first = FakeWebSocket.last();
    first.open();
    channel.post(HELLO);
    vi.advanceTimersByTime(SOCKET_SILENCE_MS);
    expect(FakeWebSocket.instances).toHaveLength(1);
    // Counted from the first unanswered ping, and checked on the ping ticks.
    vi.advanceTimersByTime(3000 + reconnectDelayMs(0));
    expect(first.closedWith).not.toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.last();
    second.open();
    expect(second.sent[0]).toBe(JSON.stringify(HELLO));
    // The given-up socket's late frames and close reach nothing.
    const seen: LobbyMessage[] = [];
    channel.subscribe((message) => seen.push(message));
    first.receive(JSON.stringify({ kind: "reject", to: "p1", reason: "full" }));
    first.drop();
    vi.advanceTimersByTime(reconnectDelayMs(0));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(seen).toEqual([]);
    channel.close();
  });

  it("keeps a socket whose pings are answered, though its ticks come late", () => {
    const channel = createLobbyChannel("ABCD");
    const ws = FakeWebSocket.last();
    ws.open();
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(1500);
      ws.receive("pong");
    }
    // A throttled background tab: the clock moves a minute with no tick in between.
    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(1500);
    ws.receive("pong");
    vi.advanceTimersByTime(1500);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.closedWith).toBeNull();
    channel.close();
  });

  it("gives up on a socket still connecting after a while and tries another", () => {
    const channel = createLobbyChannel("ABCD");
    const first = FakeWebSocket.last();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1 + reconnectDelayMs(0));
    expect(first.closedWith).not.toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(2);
    // An open in time keeps the socket.
    FakeWebSocket.last().open();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(FakeWebSocket.instances).toHaveLength(2);
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

  it("keeps backing off while each socket is closed soon after it opens, and starts over after one that held", () => {
    createLobbyChannel("ABCD");
    // A full lobby turns the tab away right after each open.
    for (let attempt = 0; attempt < 4; attempt++) {
      FakeWebSocket.last().open();
      FakeWebSocket.last().drop(1013);
      vi.advanceTimersByTime(reconnectDelayMs(attempt) - 1);
      expect(FakeWebSocket.instances).toHaveLength(attempt + 1);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(attempt + 2);
    }
    FakeWebSocket.last().open();
    vi.advanceTimersByTime(STABLE_OPEN_MS);
    FakeWebSocket.last().receive("pong");
    FakeWebSocket.last().drop();
    vi.advanceTimersByTime(reconnectDelayMs(0));
    expect(FakeWebSocket.instances).toHaveLength(6);
  });

  it("stops reconnecting and says so when the server closes the lobby for good", () => {
    const onLobbyClosed = vi.fn();
    const channel = createLobbyChannel("ABCD", { onLobbyClosed });
    const ws = FakeWebSocket.last();
    ws.open();
    ws.drop(LOBBY_WS_CLOSED);
    channel.post(HELLO);
    vi.advanceTimersByTime(60_000);
    expect(onLobbyClosed).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.sent.filter((frame) => frame !== "ping")).toEqual([]);
  });

  it("reconnects after any other server close, a refused or rate-limited one included", () => {
    const onLobbyClosed = vi.fn();
    createLobbyChannel("ABCD", { onLobbyClosed });
    for (const [attempt, code] of [1008, 1009, 1013].entries()) {
      FakeWebSocket.last().open();
      FakeWebSocket.last().drop(code);
      vi.advanceTimersByTime(reconnectDelayMs(attempt));
    }
    expect(FakeWebSocket.instances).toHaveLength(4);
    expect(onLobbyClosed).not.toHaveBeenCalled();
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
