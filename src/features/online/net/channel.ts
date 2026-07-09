import { LOBBY_WS_PING, LOBBY_WS_PONG, type LobbyMessage } from "@luminous/schema";
import { apiWebSocketUrl } from "../../../lib/apiOrigin";

// The transport the lobby talks over. The rest of the online feature depends
// only on this interface — never on WebSocket directly — which is what let it
// swap from the original same-machine BroadcastChannel to this real socket
// against the api's lobby Durable Object without touching the hook or UI.

export interface LobbyChannel {
  /** Send a message toward the lobby server (never echoed back to the sender —
      the server broadcasts snapshots, not the sender's own frames, preserving
      the BroadcastChannel semantics the hook was written against). */
  post(message: LobbyMessage): void;
  /** Register a listener; returns an unsubscribe function. */
  subscribe(handler: (message: LobbyMessage) => void): () => void;
  /** Tear the channel down and drop all listeners. */
  close(): void;
}

// One WebSocket per lobby code, against GET /lobby/:code/ws on the api origin
// (src/lib/apiOrigin.ts). The Durable Object behind it is the authority: it
// runs the shared lobbyReducer and broadcasts `state` snapshots, so unlike the
// BroadcastChannel days there is no host peer on the other end — just the
// server. The channel stays a dumb pipe: it doesn't know the protocol beyond
// two transport-level jobs:
//   - RECONNECT: an unexpected close reconnects with capped exponential
//     backoff; messages posted while down are queued and flushed on reopen
//     (the hook's own hello retries then re-establish the seat).
//   - LIVENESS: it pings the server every PING_INTERVAL_MS (answered by the
//     DO's auto-responder without waking it) and surfaces each pong to
//     subscribers as a server `heartbeat` frame — the same signal the hook's
//     presence timers were built on when a host peer sent real heartbeats.

const PING_INTERVAL_MS = 1500;
const RECONNECT_BASE_MS = 400;
const RECONNECT_MAX_MS = 8000;
// Posts buffered while disconnected; beyond this the oldest are dropped (the
// hook's periodic hello retries make individual frames safe to lose).
const MAX_QUEUED_MESSAGES = 32;

/** The delay before reconnect attempt `attempt` (0-based): 400ms doubling to a
    cap of 8s. Exported for tests. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** Math.min(attempt, 8), RECONNECT_MAX_MS);
}

/** The transport-liveness frame synthesized from each server pong. `from` is
    the server, which holds the old host-peer role — the authoritative state —
    so the hook's "have I heard from the authority lately?" math keeps working. */
const SERVER_HEARTBEAT: LobbyMessage = { kind: "heartbeat", from: "server", slot: "host" };

/** A no-op channel used when WebSocket isn't available (non-DOM environments,
    e.g. the node test runner). Online play won't work, but nothing crashes —
    the lobby just never finds a server. */
function createNoopChannel(): LobbyChannel {
  return {
    post: () => {},
    subscribe: () => () => {},
    close: () => {},
  };
}

/** Open the transport for a given lobby code. */
export function createLobbyChannel(code: string): LobbyChannel {
  if (typeof WebSocket === "undefined") return createNoopChannel();

  const url = apiWebSocketUrl(`/lobby/${code}/ws`);
  const handlers = new Set<(message: LobbyMessage) => void>();
  const queue: string[] = [];
  let socket: WebSocket | null = null;
  let open = false;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const dispatch = (message: LobbyMessage) => {
    // Snapshot the set so a handler that unsubscribes mid-dispatch can't mutate
    // the collection we're iterating.
    for (const handler of [...handlers]) handler(message);
  };

  const stopTimers = () => {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const connect = () => {
    const ws = new WebSocket(url);
    socket = ws;

    ws.onopen = () => {
      if (closed) {
        ws.close();
        return;
      }
      open = true;
      attempt = 0;
      while (queue.length > 0) {
        const pending = queue.shift();
        if (pending !== undefined) ws.send(pending);
      }
      pingTimer = setInterval(() => ws.send(LOBBY_WS_PING), PING_INTERVAL_MS);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      if (event.data === LOBBY_WS_PONG) {
        dispatch(SERVER_HEARTBEAT);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      // Light structural gate only — the server is trusted the way the
      // BroadcastChannel peers were; full Zod validation lives server-side.
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as { kind?: unknown }).kind !== "string"
      ) {
        return;
      }
      dispatch(parsed as LobbyMessage);
    };

    ws.onclose = () => {
      open = false;
      socket = null;
      if (pingTimer !== null) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (closed) return;
      // Unexpected close (server restart, network blip, nonexistent lobby):
      // retry with capped backoff. A dead code keeps failing quietly, which is
      // exactly the silence the hook's not-found timeout interprets.
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelayMs(attempt++));
    };

    // Errors are always followed by close, which owns the retry.
    ws.onerror = () => {};
  };

  connect();

  return {
    post: (message) => {
      if (closed) return;
      const encoded = JSON.stringify(message);
      if (open && socket !== null) {
        socket.send(encoded);
      } else {
        queue.push(encoded);
        if (queue.length > MAX_QUEUED_MESSAGES) queue.shift();
      }
    },
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close: () => {
      closed = true;
      handlers.clear();
      stopTimers();
      queue.length = 0;
      socket?.close(1000, "channel closed");
      socket = null;
      open = false;
    },
  };
}
