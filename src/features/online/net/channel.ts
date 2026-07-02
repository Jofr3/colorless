import type { LobbyMessage } from "./types";

// The transport the two peers talk over. The rest of the online feature depends
// only on this interface — never on BroadcastChannel directly — so a real
// WebSocket-backed channel can be dropped in to go from same-machine cross-tab
// play to true online play without touching the hook, reducer or UI.

export interface LobbyChannel {
  /** Send a message to every other channel on this lobby (never echoes to the
      sender — BroadcastChannel's own semantics, which the reducer relies on). */
  post(message: LobbyMessage): void;
  /** Register a listener; returns an unsubscribe function. */
  subscribe(handler: (message: LobbyMessage) => void): () => void;
  /** Tear the channel down and drop all listeners. */
  close(): void;
}

// One BroadcastChannel per lobby code. Same-origin tabs/windows on this machine
// that open the same-named channel are wired together automatically — that's
// what makes join-by-code work with no server. A BroadcastChannel never
// delivers a message back to the instance that posted it, so the host and guest
// each ignore their own broadcasts for free.
const CHANNEL_PREFIX = "luminous:lobby:";

/** A no-op channel used when BroadcastChannel isn't available (old browsers,
    non-DOM environments). Cross-tab play won't work, but nothing crashes — the
    lobby just never finds a peer. */
function createNoopChannel(): LobbyChannel {
  return {
    post: () => {},
    subscribe: () => () => {},
    close: () => {},
  };
}

/** Open the transport for a given lobby code. */
export function createLobbyChannel(code: string): LobbyChannel {
  if (typeof BroadcastChannel === "undefined") return createNoopChannel();

  const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${code}`);
  const handlers = new Set<(message: LobbyMessage) => void>();

  channel.onmessage = (event: MessageEvent<LobbyMessage>) => {
    // Snapshot the set so a handler that unsubscribes mid-dispatch can't mutate
    // the collection we're iterating.
    for (const handler of [...handlers]) handler(event.data);
  };

  return {
    post: (message) => channel.postMessage(message),
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close: () => {
      handlers.clear();
      channel.onmessage = null;
      channel.close();
    },
  };
}
