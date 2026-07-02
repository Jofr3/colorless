import { useCallback, useEffect, useRef, useState } from "react";
import { createLobbyChannel, type LobbyChannel } from "./channel";
import {
  applyIntent,
  bothReady,
  createSnapshot,
  makePlayer,
  removeGuest,
  seatGuest,
  setGuestConnected,
} from "./lobbyReducer";
import { savePlayerName } from "./session";
import type { LobbyIntent, LobbySlot, LobbySnapshot } from "./types";

// The React binding for the lobby: it wires the transport channel to the pure
// reducer, runs the heartbeats and countdown that need real time, and hands the
// component a snapshot plus a handful of intent-sending actions. The host runs
// the authoritative reducer here; the guest just relays intents and renders
// whatever snapshots arrive.

/** How the guest's link to the host is faring. The host is always "connected"
    (it owns the state); "connecting" also covers a guest that lost the host and
    is trying to reconnect. */
export type LobbyStatus = "connecting" | "connected" | "not-found" | "full";

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
  role: LobbySlot;
  status: LobbyStatus;
  selectDeck: (deck: DeckChoice) => void;
  setReady: (ready: boolean) => void;
  setName: (name: string) => void;
  /** Announce a graceful departure. Unmounting does this too. */
  leave: () => void;
};

type PlayerStateOrNull = LobbySnapshot["host"] | null;

const HEARTBEAT_MS = 1500;
const HELLO_RETRY_MS = 700;
// No word from the peer for this long ⇒ treat them as gone.
const PRESENCE_TIMEOUT_MS = 5000;
const PRESENCE_CHECK_MS = 1000;
// A guest that never hears back from a host within this window decides the code
// is wrong / the lobby doesn't exist.
const NOT_FOUND_MS = 4000;
const COUNTDOWN_MS = 3000;

export function useLobby({ code, role, playerId, name }: UseLobbyOptions): Lobby {
  const isHost = role === "host";
  // Seed the host's own snapshot on first render so it lands straight on the
  // waiting screen (no "joining…" flash); the effect republishes an equal one and
  // broadcasts it. The RootLayout keys the route by pathname, so switching lobby
  // codes remounts this hook and re-seeds correctly.
  const [snapshot, setSnapshot] = useState<LobbySnapshot | null>(() =>
    isHost ? createSnapshot(code, makePlayer(playerId, name)) : null,
  );
  const [status, setStatus] = useState<LobbyStatus>(isHost ? "connected" : "connecting");

  // Refs the effect's timers and handlers share. Kept out of React state so
  // reading them in intervals/listeners never sees a stale render closure.
  const channelRef = useRef<LobbyChannel | null>(null);
  const snapshotRef = useRef<LobbySnapshot | null>(null);
  const nameRef = useRef(name);
  const lastPeerSeenRef = useRef(0);
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The host installs its "apply a reducer step" bridge here so the memoised
  // actions below can drive the authoritative state that lives in the effect.
  const hostApplyRef = useRef<((step: (s: LobbySnapshot) => LobbySnapshot) => void) | null>(null);

  useEffect(() => {
    const channel = createLobbyChannel(code);
    channelRef.current = channel;
    let disposed = false;
    const now = () => Date.now();

    if (isHost) {
      const publish = (next: LobbySnapshot) => {
        snapshotRef.current = next;
        setSnapshot(next);
        channel.post({ kind: "state", snapshot: next });
      };

      // When both players are ready the reducer flips us to "countdown"; the host
      // stamps the start time so both peers count from the same instant, then
      // schedules the hand-off to the placeholder match. Leaving the countdown
      // (someone unreadies / disconnects) cancels the pending start.
      const syncCountdown = () => {
        const current = snapshotRef.current;
        if (!current) return;
        if (current.phase === "countdown") {
          if (current.countdownStartedAt === null) {
            publish({ ...current, countdownStartedAt: now() });
          }
          if (!countdownTimerRef.current) {
            countdownTimerRef.current = setTimeout(() => {
              countdownTimerRef.current = null;
              const latest = snapshotRef.current;
              if (!latest || latest.phase !== "countdown" || !bothReady(latest)) return;
              // Don't start a match with a peer who went silent during the short
              // countdown: presence detection (PRESENCE_TIMEOUT_MS) is slower than
              // the countdown itself, so check liveness directly and demote them
              // (which drops ready and falls back to selecting) instead of starting.
              if (now() - lastPeerSeenRef.current > HEARTBEAT_MS * 2) {
                apply((s) => setGuestConnected(s, false));
                return;
              }
              publish({ ...latest, phase: "in-game" });
            }, COUNTDOWN_MS);
          }
        } else if (countdownTimerRef.current) {
          clearTimeout(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
      };

      const apply = (step: (s: LobbySnapshot) => LobbySnapshot) => {
        const current = snapshotRef.current;
        if (!current) return;
        const next = step(current);
        if (next !== current) publish(next);
        syncCountdown();
      };
      hostApplyRef.current = apply;

      const unsubscribe = channel.subscribe((message) => {
        if (disposed) return;
        switch (message.kind) {
          case "hello": {
            const current = snapshotRef.current;
            if (!current) break;
            // Refuse a *different* player when the seat is actively held: the
            // incumbent is still connected, or a match is already underway. Only
            // the same id may reconnect into a countdown/game — so a takeover of a
            // dropped seat is allowed only in the pre-match phases, never landing
            // an in-game match with a fresh deckless, un-ready guest.
            const seatTaken = current.guest !== null && current.guest.id !== message.from;
            if (
              seatTaken &&
              (current.guest?.connected ||
                current.phase === "countdown" ||
                current.phase === "in-game")
            ) {
              channel.post({ kind: "reject", to: message.from, reason: "full" });
              break;
            }
            lastPeerSeenRef.current = now();
            apply((s) => seatGuest(s, message.from, message.name));
            break;
          }
          case "intent": {
            const current = snapshotRef.current;
            if (!current?.guest || current.guest.id !== message.from) break;
            lastPeerSeenRef.current = now();
            apply((s) => applyIntent(s, "guest", message.intent));
            break;
          }
          case "heartbeat": {
            const current = snapshotRef.current;
            if (current?.guest && current.guest.id === message.from) {
              lastPeerSeenRef.current = now();
              if (!current.guest.connected) apply((s) => setGuestConnected(s, true));
            }
            break;
          }
          case "bye": {
            const current = snapshotRef.current;
            if (current?.guest && current.guest.id === message.from) {
              apply((s) => removeGuest(s));
            }
            break;
          }
          // The host is the source of truth for state/reject — ignore its own kind.
        }
      });

      publish(createSnapshot(code, makePlayer(playerId, nameRef.current)));

      const heartbeat = setInterval(
        () => channel.post({ kind: "heartbeat", from: playerId, slot: "host" }),
        HEARTBEAT_MS,
      );
      const presence = setInterval(() => {
        const current = snapshotRef.current;
        if (current?.guest?.connected && now() - lastPeerSeenRef.current > PRESENCE_TIMEOUT_MS) {
          apply((s) => setGuestConnected(s, false));
        }
      }, PRESENCE_CHECK_MS);

      return () => {
        disposed = true;
        clearInterval(heartbeat);
        clearInterval(presence);
        if (countdownTimerRef.current) {
          clearTimeout(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        hostApplyRef.current = null;
        channel.post({ kind: "bye", from: playerId, slot: "host" });
        unsubscribe();
        channel.close();
        channelRef.current = null;
      };
    }

    // --- Guest ---------------------------------------------------------------
    const mountedAt = now();
    let connectedOnce = false;
    let rejected = false;

    const sendHello = () => channel.post({ kind: "hello", from: playerId, name: nameRef.current });

    const unsubscribe = channel.subscribe((message) => {
      if (disposed) return;
      switch (message.kind) {
        case "state": {
          // The host broadcasts to every peer on the channel, so a refused tab
          // (or one watching a full lobby) also receives these. Only adopt a
          // snapshot that actually seats *us* — otherwise we'd render the lobby
          // impersonating the real guest — and never override a sticky refusal.
          if (rejected || message.snapshot.guest?.id !== playerId) break;
          lastPeerSeenRef.current = now();
          connectedOnce = true;
          snapshotRef.current = message.snapshot;
          setSnapshot(message.snapshot);
          setStatus("connected");
          break;
        }
        case "reject": {
          if (message.to === playerId && message.reason === "full") {
            rejected = true;
            setStatus("full");
          }
          break;
        }
        case "heartbeat": {
          if (message.slot === "host") lastPeerSeenRef.current = now();
          break;
        }
        case "bye": {
          if (message.slot === "host") {
            // Host stepped away (a real leave, or a StrictMode remount in dev).
            // Fall back to reconnecting rather than a dead end.
            setStatus("connecting");
            lastPeerSeenRef.current = 0;
            sendHello();
          }
          break;
        }
        // Guests never act on hello/intent — those are addressed to the host.
      }
    });

    sendHello();
    const heartbeat = setInterval(
      () => channel.post({ kind: "heartbeat", from: playerId, slot: "guest" }),
      HEARTBEAT_MS,
    );
    const tick = setInterval(() => {
      if (disposed || rejected) return;
      const idle = now() - lastPeerSeenRef.current;
      if (!connectedOnce) {
        if (now() - mountedAt > NOT_FOUND_MS) {
          setStatus("not-found");
          clearInterval(tick);
          return;
        }
        sendHello();
      } else if (idle > PRESENCE_TIMEOUT_MS) {
        setStatus("connecting");
        sendHello();
      }
    }, HELLO_RETRY_MS);

    return () => {
      disposed = true;
      clearInterval(heartbeat);
      clearInterval(tick);
      channel.post({ kind: "bye", from: playerId, slot: "guest" });
      unsubscribe();
      channel.close();
      channelRef.current = null;
    };
    // `isHost` is derived from `role`, so it stands in for `role` here.
  }, [code, playerId, isHost]);

  // --- Actions ---------------------------------------------------------------
  // The host applies to its own seat through the in-effect bridge; the guest
  // posts an intent for the host to apply. Refs aren't reactive deps.
  const sendIntent = useCallback(
    (intent: LobbyIntent, slot: LobbySlot) => {
      if (isHost) hostApplyRef.current?.((s) => applyIntent(s, slot, intent));
      else channelRef.current?.post({ kind: "intent", from: playerId, intent });
    },
    [isHost, playerId],
  );

  const selectDeck = useCallback(
    (deck: DeckChoice) =>
      sendIntent({ type: "select-deck", deckId: deck.id, deckName: deck.name }, role),
    [sendIntent, role],
  );

  const setReady = useCallback(
    (ready: boolean) => sendIntent({ type: "set-ready", ready }, role),
    [sendIntent, role],
  );

  const setName = useCallback(
    (next: string) => {
      nameRef.current = next;
      savePlayerName(next);
      sendIntent({ type: "set-name", name: next }, role);
    },
    [sendIntent, role],
  );

  const leave = useCallback(() => {
    channelRef.current?.post({ kind: "bye", from: playerId, slot: role });
  }, [playerId, role]);

  const self: PlayerStateOrNull = snapshot ? (isHost ? snapshot.host : snapshot.guest) : null;
  const opponent: PlayerStateOrNull = snapshot ? (isHost ? snapshot.guest : snapshot.host) : null;

  return {
    snapshot,
    self,
    opponent,
    role,
    status,
    selectDeck,
    setReady,
    setName,
    leave,
  };
}

export { COUNTDOWN_MS };
