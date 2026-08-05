import type { GameAction } from "@luminous/engine";
import {
  COUNTDOWN_MS,
  createSnapshot,
  type LobbyIntent,
  type LobbySlot,
  type LobbySnapshot,
  makePlayer,
  type RedactedGame,
  type SeatLogEntry,
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
    terminal state — the host removed us. "full" means both seats are held; if a
    MATCH is running the server also starts feeding us the seatless board, and we
    become "spectating" (P4 3c-vii-b) — the same connection, no seat. */
export type LobbyStatus =
  | "connecting"
  | "connected"
  | "not-found"
  | "full"
  | "kicked"
  | "spectating";

export type DeckChoice = { id: string; name: string };

/** A rejected game action, surfaced as a transient pill (P4). `nonce` bumps per
    rejection so an identical repeat re-announces (the local GameError pattern). */
export type ActionError = { reason: string; nonce: number };

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
  /** The running match's accumulated game log (seat-keyed; the DO builds it and
      sends it on every `match` frame). Empty until the first frame / after
      abandon. Rides alongside `match` because it can't be rebuilt from the
      redacted snapshot alone (it accumulates across the whole game). */
  matchLog: SeatLogEntry[];
  /** The last game action the server refused (P4), for a transient pill; null
      until one is rejected, cleared by the next accepted action (a `match`). */
  actionError: ActionError | null;
  /** Why the last match failed to START (P4 increment 3) — a deck that wouldn't
      resolve dropped the lobby back to selecting; shown on the versus screen.
      Null until a `match-error`, cleared by the next lobby state change. */
  matchError: string | null;
  role: LobbySlot;
  status: LobbyStatus;
  selectDeck: (deck: DeckChoice) => void;
  setReady: (ready: boolean) => void;
  /** Announce a graceful departure. Unmounting does this too. */
  leave: () => void;
  /** Host only: remove the guest from the lobby. No-op for a guest. */
  kick: () => void;
  /** Play again in this same lobby (P4 3c-vi). The server refuses it unless the
      match it holds has FINISHED; on success the lobby returns to `selecting`
      with this seat already readied, so the opponent accepts by readying too. */
  requestRematch: () => void;
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
  // The running match's game log, seat-keyed, replaced whole on every `match`
  // frame (the DO sends the full accumulated log — cheap, and a reconnect gets
  // the backlog for free). Cleared with `match` when the lobby leaves in-game.
  const [matchLog, setMatchLog] = useState<SeatLogEntry[]>([]);
  // The last refused game action, for a transient pill. Bumped on each
  // `reject-action`, cleared by the next accepted action (a `match` frame) — the
  // local useLocalGame clears its lastError on every ok apply for the same reason.
  const [actionError, setActionError] = useState<ActionError | null>(null);
  // Why a match failed to START (P4 increment 3) — a deck that wouldn't resolve.
  // Set on `match-error` (which arrives right AFTER the reset-to-selecting state
  // frame, so it survives that frame's clear), cleared by the next state change.
  const [matchError, setMatchError] = useState<string | null>(null);

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
    // Why we hold no seat, if we don't. "kicked" is terminal — stop everything.
    // "full" is NOT: the server may still hand us the match to watch, so the
    // connection stays up and we keep the snapshot for the players' names.
    let refusal: "full" | "kicked" | null = null;
    const now = () => Date.now();
    const mountedAt = now();

    // Both roles join (and re-announce after a reconnect) the same way; the
    // server tells host from guest by the player id the lobby was created with.
    const sendHello = () => channel.post({ kind: "hello", from: playerId, name: nameRef.current });

    const unsubscribe = channel.subscribe((message) => {
      if (disposed) return;
      switch (message.kind) {
        case "state": {
          // A SPECTATOR keeps the snapshot but claims nothing from it: it is all
          // public lobby data (names, deck names, phase) and their board needs the
          // two players' names. They never become "connected" and never render as
          // a seated player — status stays "spectating" below.
          if (refusal === "full") {
            lastServerSeenRef.current = now();
            snapshotRef.current = message.snapshot;
            setSnapshot(message.snapshot);
            // The match is over for watching purposes the moment the lobby leaves
            // in-game (a rematch re-opens it, and the server re-sends the board).
            if (message.snapshot.phase !== "in-game") {
              setMatch(null);
              setMatchLog([]);
            }
            break;
          }
          // Only adopt a snapshot that actually seats US — a refused client
          // (or one watching a full lobby) also receives broadcasts, and must
          // not render the lobby impersonating the real player — and never
          // override a sticky refusal.
          const seatedId = isHost ? message.snapshot.host.id : message.snapshot.guest?.id;
          if (refusal !== null || seatedId !== playerId) break;
          lastServerSeenRef.current = now();
          connectedOnce = true;
          snapshotRef.current = message.snapshot;
          setSnapshot(message.snapshot);
          setStatus("connected");
          // Any lobby progress clears a stale match-start error. The failing
          // handoff broadcasts its `state` (back to selecting) BEFORE the
          // `match-error`, so this clear runs first and the error still lands.
          setMatchError(null);
          // A lobby that isn't in-game holds no match — drop any stale board (and
          // any stale rejection pill) so a rematch in this same lobby starts clean
          // (the server drops the record on abandon and re-mints on the next flip).
          if (message.snapshot.phase !== "in-game") {
            setMatch(null);
            setMatchLog([]);
            setActionError(null);
          }
          break;
        }
        case "match": {
          // Our per-viewer redacted snapshot of the running game — or, for a
          // client refused a seat while a match is running, the SEATLESS
          // spectator board the server chose to send (3c-vii-b). A KICKED client
          // is never fed one, and refuses it here too.
          if (refusal === "kicked") break;
          lastServerSeenRef.current = now();
          if (refusal === "full") setStatus("spectating");
          setMatch(message.game);
          setMatchLog(message.log);
          // An accepted action supersedes any pending rejection pill (the
          // useLocalGame lastError-clears-on-ok rule, over the wire).
          setActionError(null);
          break;
        }
        case "reject-action": {
          // The server refused our last game action (illegal / unsupported). A
          // transient pill, not terminal — bump the nonce so a repeat re-announces.
          if (refusal !== null) break;
          lastServerSeenRef.current = now();
          setActionError((prev) => ({ reason: message.reason, nonce: (prev?.nonce ?? 0) + 1 }));
          break;
        }
        case "match-error": {
          // The countdown ended but the match couldn't start (a deck wouldn't
          // resolve, P4 increment 3). The server has already dropped us back to
          // selecting; surface the reason on the versus screen.
          if (refusal !== null) break;
          lastServerSeenRef.current = now();
          setMatchError(message.reason);
          break;
        }
        case "reject": {
          // No seat for us: either both are held, or the host removed us. A KICK
          // is terminal. "full" is not — the server may follow it with the match
          // to watch (3c-vii-b), and a seat can free up — but we stop CLAIMING
          // one, so the hello retries below fall back to the idle-driven cadence.
          if (message.to === playerId) {
            refusal = message.reason === "kicked" ? "kicked" : "full";
            lastServerSeenRef.current = now();
            setStatus(refusal === "kicked" ? "kicked" : "full");
          }
          break;
        }
        case "heartbeat": {
          // Transport liveness — the channel translates server pongs into
          // these (see channel.ts).
          lastServerSeenRef.current = now();
          break;
        }
        // hello/intent/bye/rematch are client → server frames; the server never
        // sends them, so there's nothing to handle here.
      }
    });

    sendHello();
    const tick = setInterval(() => {
      if (disposed || refusal === "kicked") return;
      const idle = now() - lastServerSeenRef.current;
      if (refusal === "full") {
        // Refused a seat, possibly watching. Re-announce ONLY when the link has
        // gone quiet: the server marks a spectator on the hello it refuses, so
        // after a dropped socket this is what re-establishes the feed — and
        // gating on idle (heartbeats keep it fresh) is what stops it becoming a
        // retry storm against a lobby that is simply full.
        if (idle > PRESENCE_TIMEOUT_MS) sendHello();
        return;
      }
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

  const requestRematch = useCallback(() => {
    // A lifecycle frame, not a seat intent: only the server can see whether the
    // match is over, so it — not this client — decides whether this lands.
    channelRef.current?.post({ kind: "rematch", from: playerId });
  }, [playerId]);

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
    matchLog,
    actionError,
    matchError,
    role,
    status,
    selectDeck,
    setReady,
    leave,
    kick,
    requestRematch,
    sendAction,
  };
}

export { COUNTDOWN_MS };
