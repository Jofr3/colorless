// A scripted LobbyChannel for the lobby client suites: records every post and
// pushes server frames to the subscribers. Not a test file itself.

import { type LobbyMessage, publicSeatId, seatSecretFrom, sha256 } from "@colorless/schema";
import type { LobbyChannel } from "../online/channel";

export function fakeLobbyChannel() {
  const posts: LobbyMessage[] = [];
  const handlers = new Set<(m: LobbyMessage) => void>();
  let closed = false;
  const channel: LobbyChannel = {
    post: (m) => {
      if (!closed) posts.push(m);
    },
    subscribe: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    close: () => {
      closed = true;
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
    closed: () => closed,
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
