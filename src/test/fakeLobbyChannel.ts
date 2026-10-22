// A scripted LobbyChannel for the lobby client suites: records every post and
// pushes server frames to the subscribers. Not a test file itself.

import type { LobbyMessage } from "@luminous/schema";
import type { LobbyChannel } from "../features/online/net/channel";

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
