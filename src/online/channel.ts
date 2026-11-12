import {
  LOBBY_PING_MS,
  LOBBY_SILENCE_MS,
  LOBBY_WS_CLOSED,
  LOBBY_WS_NOT_FOUND,
  LOBBY_WS_NUDGE,
  LOBBY_WS_OUTDATED,
  LOBBY_WS_PING,
  LOBBY_WS_PONG,
  type LobbyMessage,
} from "@colorless/schema";
import { apiWebSocketUrl } from "../lib/apiOrigin";

// The transport the lobby talks over. The rest of the online feature depends
// only on this interface, never on WebSocket directly.

export interface LobbyChannel {
  /** Send a message toward the lobby server. It is never echoed back to the
      sender: the server broadcasts snapshots, not the sender's own frames. True when it went out on
      an open socket; false when it waits for the next one, behind that socket's hello, or the
      channel is closed. */
  post(message: LobbyMessage): boolean;
  /** Register a listener; returns an unsubscribe function. */
  subscribe(handler: (message: LobbyMessage) => void): () => void;
  /** Tear the channel down and drop all listeners. With `deliver`, frames still waiting for a
      socket go out on the next one (after its hello) before it closes, if one opens within
      `DELIVER_MS`. */
  close(opts?: { deliver?: boolean }): void;
}

// One WebSocket per lobby code, against GET /lobby/:code/ws. The Durable Object is the authority
// and broadcasts `state` snapshots; this channel is a dumb pipe that knows only its transport-level
// jobs.

/** An open socket with no frame back for `LOBBY_SILENCE_MS` since a ping it sent is given up for a
    new one: a half-open link (NAT rebinding, a middlebox drop) never closes on its own. It is
    counted from the oldest unanswered ping, so a hidden tab whose timers fire once a minute does
    not trip it. Those timers also hold its pings back, which the server would take for a dead
    link; the server's `LOBBY_WS_NUDGE` is answered with a ping from the message handler, which
    runs at once (protocol.ts). */
export const SOCKET_SILENCE_MS = LOBBY_SILENCE_MS;
/** A socket still connecting after this long is given up and retried. */
export const CONNECT_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 400;
const RECONNECT_MAX_MS = 8000;
/** A socket open this long counts as a working link, so the next reconnect starts the backoff
    over. One the server closes sooner (a full lobby turning a tab away) keeps backing off. */
export const STABLE_OPEN_MS = 5000;
// Posts buffered while disconnected; beyond this the oldest are dropped (the
// client's periodic hello retries make individual frames safe to lose).
const MAX_QUEUED_MESSAGES = 32;
/** How long a closed channel keeps reconnecting to deliver the frames it still holds (a bye). */
export const DELIVER_MS = 10_000;

/** A clock for durations: unlike `Date.now`, a step of the device clock does not move it. */
const monotonicNow = () => performance.now();

/** The delay before reconnect attempt `attempt` (0-based): 400ms doubling to a cap of 8s, spread
    ±20% by `jitter` (0 to 1) so tabs a server restart dropped together do not return together. */
export function reconnectDelayMs(attempt: number, jitter = Math.random()): number {
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(attempt, 8), RECONNECT_MAX_MS);
  return Math.round(delay * (0.8 + 0.4 * jitter));
}

/** The transport-liveness frame synthesized from each server pong. `from` is
    the server, which holds the old host-peer role — the authoritative state —
    so the client's "have I heard from the authority lately?" math keeps working. */
const SERVER_HEARTBEAT: LobbyMessage = { kind: "heartbeat", from: "server", slot: "host" };

/** A no-op channel used when WebSocket isn't available (non-DOM environments,
    e.g. the node test runner). Online play won't work, but nothing crashes —
    the lobby just never finds a server. */
function createNoopChannel(): LobbyChannel {
  return {
    post: () => false,
    subscribe: () => () => {},
    close: () => {},
  };
}

/** Open the transport for a given lobby code. `onLobbyClosed` runs once if the server says the
    code names no lobby: it closed the lobby for good (`LOBBY_WS_CLOSED`), or there is none
    (`LOBBY_WS_NOT_FOUND`, at once on the upgrade); or, with "outdated", that this page is too old
    for the lobby (`LOBBY_WS_OUTDATED`). The channel then stops reconnecting. `openSocket`
    opens each socket (the browser's WebSocket by default; the seam suites pass one wired to the
    lobby DO, as one tab's cookie would upgrade it). */
export function createLobbyChannel(
  code: string,
  {
    onLobbyClosed,
    openSocket,
  }: {
    onLobbyClosed?: (reason: "closed" | "outdated") => void;
    openSocket?: (url: string) => WebSocket;
  } = {},
): LobbyChannel {
  if (openSocket === undefined && typeof WebSocket === "undefined") return createNoopChannel();
  const socketFor = openSocket ?? ((url: string) => new WebSocket(url));

  const url = apiWebSocketUrl(`/lobby/${code}/ws`);
  const handlers = new Set<(message: LobbyMessage) => void>();
  const queue: string[] = [];
  let socket: WebSocket | null = null;
  let open = false;
  let closed = false;
  let attempt = 0;
  let openedAt: number | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  // Closed, but still reconnecting to deliver the queue: ends at the next open or `DELIVER_MS`.
  let deliverTimer: ReturnType<typeof setTimeout> | null = null;
  // The newest hello posted. A reopened socket is attached to no seat until it says hello, and the
  // client only re-announces after PRESENCE_TIMEOUT_MS of silence, which the server's pongs to the
  // new socket never let happen: so every socket leads with it, ahead of every frame queued while
  // it was down, and a hello posted then is held only here.
  let lastHello: string | null = null;

  const dispatch = (message: LobbyMessage) => {
    // Snapshot the set so a handler that unsubscribes mid-dispatch can't mutate
    // the collection we're iterating.
    for (const handler of [...handlers]) handler(message);
  };

  const stopSocketTimers = () => {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (connectTimer !== null) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  };

  const stopTimers = () => {
    stopSocketTimers();
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (deliverTimer !== null) {
      clearTimeout(deliverTimer);
      deliverTimer = null;
    }
  };

  const shut = () => {
    closed = true;
    handlers.clear();
    stopTimers();
    queue.length = 0;
    socket?.close(1000, "channel closed");
    socket = null;
    open = false;
  };

  /** The socket is gone: give up on the lobby if the server closed it for good, else reconnect. */
  const lost = (code: number | undefined) => {
    if (openedAt !== null && monotonicNow() - openedAt >= STABLE_OPEN_MS) attempt = 0;
    openedAt = null;
    open = false;
    socket = null;
    stopSocketTimers();
    if (closed) return;
    // The lobby is gone (wiped after an hour without play), there never was one, or this page is
    // too old for it: a reconnect could only fail.
    if (code === LOBBY_WS_CLOSED || code === LOBBY_WS_NOT_FOUND || code === LOBBY_WS_OUTDATED) {
      closed = true;
      queue.length = 0;
      stopTimers();
      onLobbyClosed?.(code === LOBBY_WS_OUTDATED ? "outdated" : "closed");
      return;
    }
    // Unexpected close (server restart, network blip, a refused upgrade): retry with capped
    // backoff. A server that never answers is the silence the client's unreachable window ends.
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs(attempt++));
  };

  /** Give up on `ws` without waiting for its close, which a dead path may hold back for a minute:
      it is detached first, so nothing it says later reaches the channel. */
  const abandon = (ws: WebSocket) => {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    lost(undefined);
  };

  const connect = () => {
    const ws = socketFor(url);
    socket = ws;
    // The oldest ping since the last frame heard, or null when every ping has been answered.
    let unansweredSince: number | null = null;
    connectTimer = setTimeout(() => abandon(ws), CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (closed) {
        ws.close();
        return;
      }
      if (connectTimer !== null) clearTimeout(connectTimer);
      connectTimer = null;
      open = true;
      openedAt = monotonicNow();
      if (lastHello !== null) ws.send(lastHello);
      for (const pending of queue.splice(0)) ws.send(pending);
      // A socket buffers what it was sent ahead of its close, so the delivery is done.
      if (deliverTimer !== null) {
        shut();
        return;
      }
      pingTimer = setInterval(() => {
        const now = monotonicNow();
        if (unansweredSince !== null && now - unansweredSince >= SOCKET_SILENCE_MS) {
          abandon(ws);
          return;
        }
        unansweredSince ??= now;
        ws.send(LOBBY_WS_PING);
      }, LOBBY_PING_MS);
    };

    ws.onmessage = (event: MessageEvent) => {
      unansweredSince = null;
      if (typeof event.data !== "string") return;
      if (event.data === LOBBY_WS_PONG) {
        dispatch(SERVER_HEARTBEAT);
        return;
      }
      if (event.data === LOBBY_WS_NUDGE) {
        unansweredSince = monotonicNow();
        ws.send(LOBBY_WS_PING);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      // Light structural gate only: the server is trusted, and full Zod
      // validation lives server-side.
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as { kind?: unknown }).kind !== "string"
      ) {
        return;
      }
      dispatch(parsed as LobbyMessage);
    };

    ws.onclose = (event: CloseEvent) => lost(event.code);

    // Errors are always followed by close, which owns the retry.
    ws.onerror = () => {};
  };

  connect();

  return {
    post: (message) => {
      if (closed || deliverTimer !== null) return false;
      const encoded = JSON.stringify(message);
      if (message.kind === "hello") lastHello = encoded;
      if (open && socket !== null) {
        socket.send(encoded);
        return true;
      }
      if (message.kind !== "hello") {
        queue.push(encoded);
        if (queue.length > MAX_QUEUED_MESSAGES) queue.shift();
      }
      return false;
    },
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close: ({ deliver = false } = {}) => {
      if (closed || deliverTimer !== null) return;
      if (!deliver || open || queue.length === 0) {
        shut();
        return;
      }
      handlers.clear();
      deliverTimer = setTimeout(shut, DELIVER_MS);
    },
  };
}
