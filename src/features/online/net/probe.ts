import type { LobbyMessage } from "@luminous/schema";
import { createLobbyChannel } from "./channel";

// A one-shot "can I join?" probe used by the hub before it navigates into a room.
// It runs the guest side of the handshake — hello (with retries) and wait for the
// host to either seat us, refuse us, or never answer — so the loading and
// not-found/full states can be shown inline on the hub instead of on a separate
// room page. On success the seat is already held for our playerId, so the room's
// own guest handshake (same id) resumes it seamlessly.

export type JoinOutcome = "joined" | "full" | "not-found";

const HELLO_RETRY_MS = 700;
const NOT_FOUND_MS = 4000;

export function probeLobby(
  code: string,
  playerId: string,
  name: string,
): { promise: Promise<JoinOutcome>; cancel: () => void } {
  const channel = createLobbyChannel(code);
  let settled = false;
  let retry: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe = () => {};

  const cleanup = () => {
    if (retry !== null) clearInterval(retry);
    if (timeout !== null) clearTimeout(timeout);
    unsubscribe();
    // Don't say goodbye — on "joined" the seat must stay held for the room to
    // resume; on failure there's no seat to release.
    channel.close();
  };

  const promise = new Promise<JoinOutcome>((resolve) => {
    const finish = (outcome: JoinOutcome) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome);
    };

    unsubscribe = channel.subscribe((message: LobbyMessage) => {
      if (message.kind === "state" && message.snapshot.guest?.id === playerId) finish("joined");
      else if (message.kind === "reject" && message.to === playerId && message.reason === "full") {
        finish("full");
      }
    });

    const sendHello = () => channel.post({ kind: "hello", from: playerId, name });
    sendHello();
    retry = setInterval(sendHello, HELLO_RETRY_MS);
    timeout = setTimeout(() => finish("not-found"), NOT_FOUND_MS);
  });

  // Abandon the probe (component unmounted): tear everything down and leave the
  // promise pending — the caller guards its own post-await work.
  const cancel = () => {
    if (settled) return;
    settled = true;
    cleanup();
  };

  return { promise, cancel };
}
