// A scripted LobbyChannel for the lobby client suites: records every post and
// pushes server frames to the subscribers. Not a test file itself.

import { type LobbyMessage, publicSeatId, seatSecretFrom, sha256 } from "@colorless/schema";
import type { LobbyChannel } from "../online/channel";

export function fakeLobbyChannel() {
  const posts: LobbyMessage[] = [];
  const handlers = new Set<(m: LobbyMessage) => void>();
  let closed = false;
  let closedWith: { deliver?: boolean } | null = null;
  /** Posts answer as the real channel's do while its socket is down: queued, not sent. */
  const link = { down: false };
  const channel: LobbyChannel = {
    post: (m) => {
      if (closed) return false;
      posts.push(m);
      return !link.down;
    },
    subscribe: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    close: (opts) => {
      closed = true;
      closedWith = opts ?? {};
      handlers.clear();
    },
  };
  return {
    channel,
    posts,
    push: (m: LobbyMessage) => {
      for (const h of [...handlers]) h(m);
    },
    kinds: () => posts.map((p) => p.kind),
    link,
    closed: () => closed,
    closedWith: () => closedWith,
  };
}

/** A fixed seat secret for a test player `label`, as a tab keeps in sessionStorage. */
export function testSeatSecret(label: string): string {
  return seatSecretFrom(sha256(Uint8Array.from(label, (char) => char.charCodeAt(0))));
}

/** The public id a lobby names `label`'s seat by. */
export function testSeatId(label: string): string {
  return publicSeatId(testSeatSecret(label));
}
