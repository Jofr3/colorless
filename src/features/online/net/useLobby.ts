import type { GameAction } from "@luminous/engine";
import {
  COUNTDOWN_MS,
  type LobbySlot,
  type LobbySnapshot,
  type RedactedGame,
  type SeatLogEntry,
} from "@luminous/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ActionError,
  type DeckChoice,
  initialLobbyState,
  LobbyClient,
  type LobbyClientState,
  type LobbyStatus,
} from "./lobbyClient";

// The React binding for the lobby: a thin wrapper over the framework-free
// LobbyClient (./lobbyClient), which owns the socket, the hello/presence state
// machine and the commands. This hook only mirrors the client's state into
// React and derives `self`/`opponent`. The host's seeded snapshot comes from
// initialLobbyState, so a fresh lobby still lands on the waiting screen.

export type { ActionError, DeckChoice, LobbyStatus };

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

export function useLobby({ code, role, playerId, name }: UseLobbyOptions): Lobby {
  const isHost = role === "host";
  // The RootLayout keys the route by pathname, so switching lobby codes
  // remounts this hook and re-seeds correctly.
  const [state, setState] = useState<LobbyClientState>(() =>
    initialLobbyState(code, role, playerId, name),
  );
  const clientRef = useRef<LobbyClient | null>(null);
  const nameRef = useRef(name);

  useEffect(() => {
    const client = new LobbyClient({
      code,
      role: isHost ? "host" : "guest",
      playerId,
      name: nameRef.current,
    });
    clientRef.current = client;
    setState(client.state);
    const unsubscribe = client.subscribe(setState);
    return () => {
      unsubscribe();
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
    // `isHost` is derived from `role`, so it stands in for `role` here.
  }, [code, playerId, isHost]);

  const selectDeck = useCallback((deck: DeckChoice) => clientRef.current?.selectDeck(deck), []);
  const setReady = useCallback((ready: boolean) => clientRef.current?.setReady(ready), []);
  const leave = useCallback(() => clientRef.current?.leave(), []);
  const kick = useCallback(() => clientRef.current?.kick(), []);
  const requestRematch = useCallback(() => clientRef.current?.requestRematch(), []);
  const sendAction = useCallback((action: GameAction) => clientRef.current?.sendAction(action), []);

  const { snapshot } = state;
  const self: PlayerStateOrNull = snapshot ? (isHost ? snapshot.host : snapshot.guest) : null;
  const opponent: PlayerStateOrNull = snapshot ? (isHost ? snapshot.guest : snapshot.host) : null;

  return {
    snapshot,
    self,
    opponent,
    match: state.match,
    matchLog: state.matchLog,
    actionError: state.actionError,
    matchError: state.matchError,
    role,
    status: state.status,
    selectDeck,
    setReady,
    leave,
    kick,
    requestRematch,
    sendAction,
  };
}

export { COUNTDOWN_MS };
