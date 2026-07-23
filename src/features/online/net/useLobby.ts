import type { GameAction } from "@luminous/engine";
import {
  COUNTDOWN_MS,
  createSnapshot,
  type LobbyIntent,
  type LobbySlot,
  type LobbySnapshot,
  makePlayer,
  type RedactedGame,
  type WireAction,
} from "@luminous/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { createLobbyChannel, type LobbyChannel } from "./channel";

// The React binding for the lobby. The authoritative reducer now runs
// server-side in the lobby Durable Object (it took over the old "host peer"
// role), so BOTH roles are plain clients here: announce yourself with a hello,
// send intents for your own seat, render whatever snapshot the server
// broadcasts. What's left of the old host machinery is only presentation —
// the host still seeds a local snapshot so creating a lobby lands straight on
// the waiting screen with no "joining…" flash; the server's authoritative
// snapshot replaces it on the first broadcast.

/** How our link to the lobby server is faring. "connecting" also covers a
    client that lost the server and is trying to reconnect. "kicked" is a
    terminal state — the host removed us. */
export type LobbyStatus = "connecting" | "connected" | "not-found" | "full" | "kicked";

export type DeckChoice = { id: string; name: string };

export type UseLobbyOptions = {
  code: string;
  role: LobbySlot;
  playerId: string;
  name: string;
};

export type Lobby = {
  snapshot: LobbySnapshot | null;
  /** Your own seat, once you're in it. */
  self: PlayerStateOrNull;
  /** The other seat, or null while it's empty. */
  opponent: PlayerStateOrNull;
  /** This client's REDACTED view of the running match (P4), or null until the
      server broadcasts one (i.e. before the in-game handoff, or after abandon). */
  match: RedactedGame | null;
  role: LobbySlot;
  status: LobbyStatus;
  selectDeck: (deck: DeckChoice) => void;
  setReady: (ready: boolean) => void;
  /** Announce a graceful departure. Unmounting does this too. */
  leave: () => void;
  /** Host only: remove the guest from the lobby. No-op for a guest. */
  kick: () => void;
  /** Send a game action for the running match (P4). The server binds it to this
      client's seat and applies it; the authoritative result comes back as a
      `match` broadcast. */
  sendAction: (action: GameAction) => void;
};

type PlayerStateOrNull = LobbySnapshot["host"] | null;

const HELLO_RETRY_MS = 700;
// No word from the server for this long ⇒ treat the link as down. The channel
// surfaces every server pong as a heartbeat frame, so a healthy-but-quiet
// lobby never trips this.
const PRESENCE_TIMEOUT_MS = 5000;
// A client that never hears back from the server within this window decides
// the code is wrong / the lobby doesn't exist (or has expired).
const NOT_FOUND_MS = 4000;

export function useLobby({ code, role, playerId, name }: UseLobbyOptions): Lobby {
  const isHost = role === "host";
  // Seed the host's own snapshot on first render so a freshly-created lobby
  // lands straight on the waiting screen; the server broadcasts the real one
  // (an equal snapshot, or the restored lobby after a refresh) moments later.
  // The RootLayout keys the route by pathname, so switching lobby codes
  // remounts this hook and re-seeds correctly.
  const [snapshot, setSnapshot] = useState<LobbySnapshot | null>(() =>
    isHost ? createSnapshot(code, makePlayer(playerId, name)) : null,
  );
  const [status, setStatus] = useState<LobbyStatus>(isHost ? "connected" : "connecting");
  // This client's redacted match view. Server-pushed on the in-game flip and on
  // reconnect; cleared whenever the lobby leaves in-game (abandon/rematch) so a
  // stale board never lingers behind a new match.
  const [match, setMatch] = useState<RedactedGame | null>(null);

  // Refs the effect's timers and handlers share. Kept out of React state so
  // reading them in intervals/listeners never sees a stale render closure.
  const channelRef = useRef<LobbyChannel | null>(null);
  const snapshotRef = useRef<LobbySnapshot | null>(null);
  const nameRef = useRef(name);
  const lastServerSeenRef = useRef(0);

  useEffect(() => {
    const channel = createLobbyChannel(code);
    channelRef.current = channel;
    let disposed = false;
    let connectedOnce = false;
    let rejected = false;
    const now = () => Date.now();
    const mountedAt = now();

    // Both roles join (and re-announce after a reconnect) the same way; the
    // server tells host from guest by the player id the lobby was created with.
    const sendHello = () => channel.post({ kind: "hello", from: playerId, name: nameRef.current });

    const unsubscribe = channel.subscribe((message) => {
      if (disposed) return;
      switch (message.kind) {
        case "state": {
          // Only adopt a snapshot that actually seats US — a refused client
          // (or one watching a full lobby) also receives broadcasts, and must
          // not render the lobby impersonating the real player — and never
          // override a sticky refusal.
          const seatedId = isHost ? message.snapshot.host.id : message.snapshot.guest?.id;
          if (rejected || seatedId !== playerId) break;
          lastServerSeenRef.current = now();
          connectedOnce = true;
          snapshotRef.current = message.snapshot;
          setSnapshot(message.snapshot);
          setStatus("connected");
          // A lobby that isn't in-game holds no match — drop any stale board so a
          // rematch in this same lobby starts clean (the server drops the record
          // on abandon and re-mints on the next flip).
          if (message.snapshot.phase !== "in-game") setMatch(null);
          break;
        }
        case "match": {
          // Our per-viewer redacted snapshot of the running game. A refused
          // client never receives one, but stay defensive and never render a
          // board while rejected.
          if (rejected) break;
          lastServerSeenRef.current = now();
          setMatch(message.game);
          break;
        }
        case "reject": {
          // Terminal for us: either the seat was already taken, or the host
          // removed us. Stop the hello retries so we don't try to rejoin.
          if (message.to === playerId) {
            rejected = true;
            setStatus(message.reason === "kicked" ? "kicked" : "full");
          }
          break;
        }
        case "heartbeat": {
          // Transport liveness — the channel translates server pongs into
          // these (see channel.ts).
          lastServerSeenRef.current = now();
          break;
        }
        // hello/intent/bye are client → server frames; the server never sends
        // them, so there's nothing to handle here.
      }
    });

    sendHello();
    const tick = setInterval(() => {
      if (disposed || rejected) return;
      const idle = now() - lastServerSeenRef.current;
      if (!connectedOnce) {
        if (now() - mountedAt > NOT_FOUND_MS) {
          setStatus("not-found");
          clearInterval(tick);
          return;
        }
        sendHello();
      } else if (idle > PRESENCE_TIMEOUT_MS) {
        // Lost the server: the channel is already reconnecting with backoff;
        // keep re-announcing so the seat is re-established the moment it's up.
        setStatus("connecting");
        sendHello();
      }
    }, HELLO_RETRY_MS);

    return () => {
      disposed = true;
      clearInterval(tick);
      channel.post({ kind: "bye", from: playerId, slot: isHost ? "host" : "guest" });
      unsubscribe();
      channel.close();
      channelRef.current = null;
    };
    // `isHost` is derived from `role`, so it stands in for `role` here.
  }, [code, playerId, isHost]);

  // --- Actions ---------------------------------------------------------------
  // Every change to your own seat is an intent for the server to validate,
  // apply through the shared reducer, and broadcast back — the host included.
  const sendIntent = useCallback(
    (intent: LobbyIntent) => channelRef.current?.post({ kind: "intent", from: playerId, intent }),
    [playerId],
  );

  const selectDeck = useCallback(
    (deck: DeckChoice) => sendIntent({ type: "select-deck", deckId: deck.id, deckName: deck.name }),
    [sendIntent],
  );

  const setReady = useCallback(
    (ready: boolean) => sendIntent({ type: "set-ready", ready }),
    [sendIntent],
  );

  const leave = useCallback(() => {
    channelRef.current?.post({ kind: "bye", from: playerId, slot: role });
  }, [playerId, role]);

  const kick = useCallback(() => {
    if (!isHost) return;
    const guestId = snapshotRef.current?.guest?.id;
    if (!guestId) return;
    // The same frame the BroadcastChannel host posted at its guest; the server
    // validates it came from the host seat, relays it to the guest (so it
    // stops trying to rejoin), frees the seat and rebroadcasts.
    channelRef.current?.post({ kind: "reject", to: guestId, reason: "kicked" });
  }, [isHost]);

  const sendAction = useCallback((action: GameAction) => {
    // The DO binds the action to this socket's seat (a client can't forge it),
    // so we send the engine action as-is; the accepted result returns as a
    // `match` broadcast — the board only ever reflects authoritative state.
    // GameAction structurally satisfies the loose wire action; the missing
    // index signature is a TS artifact of the loose Zod object, hence the cast
    // at this one boundary.
    channelRef.current?.post({ kind: "action", action: action as unknown as WireAction });
  }, []);

  const self: PlayerStateOrNull = snapshot ? (isHost ? snapshot.host : snapshot.guest) : null;
  const opponent: PlayerStateOrNull = snapshot ? (isHost ? snapshot.guest : snapshot.host) : null;

  return {
    snapshot,
    self,
    opponent,
    match,
    role,
    status,
    selectDeck,
    setReady,
    leave,
    kick,
    sendAction,
  };
}

export { COUNTDOWN_MS };
