// The shared vocabulary for the online lobby: the authoritative state the host
// owns, and the messages the two peers exchange over the transport channel.
//
// The model is deliberately client-server even though there's no server: the
// HOST is authoritative. It holds the one true `LobbySnapshot`, applies every
// change (its own and the guest's), and broadcasts the result; the guest only
// sends intents and renders whatever snapshot it's handed. Swapping the
// BroadcastChannel transport (net/channel.ts) for a real WebSocket — and moving
// this reducer server-side — turns this into true online play with no changes
// to the UI.

/** The two seats in a lobby. The creator is always the host. */
export type LobbySlot = "host" | "guest";

/** One player's state within a lobby, as tracked by the host. */
export type PlayerState = {
  /** Stable id for this player's browser session. Lets the host tell a
      reconnect (same id) from a brand-new joiner (different id). */
  id: string;
  name: string;
  /** Chosen deck, or null until they pick one. */
  deckId: string | null;
  /** Denormalised deck name so the opponent can label the pick without needing
      the deck library (the guest may not share the host's decks). */
  deckName: string | null;
  /** Locked in and waiting to start. Only ever true with a deck chosen. */
  ready: boolean;
  /** Whether the host currently sees this player as connected (heartbeat-based;
      the host is connected by definition). */
  connected: boolean;
};

/** The lobby's stage in the create → join → ready → start flow.
    - `waiting`   only the host is present, showing the join code.
    - `selecting` both present, each choosing a deck and readying up.
    - `countdown` both ready; a short "battle starting" countdown is running.
    - `in-game`   the (placeholder) match has begun. */
export type LobbyPhase = "waiting" | "selecting" | "countdown" | "in-game";

/** The full authoritative lobby state the host owns and broadcasts. */
export type LobbySnapshot = {
  code: string;
  phase: LobbyPhase;
  host: PlayerState;
  /** The joiner, or null while the lobby is still waiting for one. */
  guest: PlayerState | null;
  /** Epoch ms the countdown began (phase === "countdown"), else null. Stamped
      by the host so both peers count down from the same instant. */
  countdownStartedAt: number | null;
};

/** A change a player asks to make to their own seat. The host validates and
    applies it (see net/lobbyReducer.ts); the guest sends it over the wire. */
export type LobbyIntent =
  | { type: "select-deck"; deckId: string; deckName: string }
  | { type: "set-ready"; ready: boolean }
  | { type: "set-name"; name: string };

/** Everything that can travel over a lobby channel. `from` is the sender's
    player id so the host can bind messages to the right seat. */
export type LobbyMessage =
  /** guest → host: request to join, or re-announce after a reconnect. */
  | { kind: "hello"; from: string; name: string }
  /** host → all: the authoritative snapshot after any change. */
  | { kind: "state"; snapshot: LobbySnapshot }
  /** guest → host: apply this change to my seat. */
  | { kind: "intent"; from: string; intent: LobbyIntent }
  /** host → guest: your join was refused (the second seat is taken). */
  | { kind: "reject"; to: string; reason: "full" }
  /** either direction: a periodic keep-alive so the other side knows we're here. */
  | { kind: "heartbeat"; from: string; slot: LobbySlot }
  /** either direction: a graceful "I'm leaving" so the other side reacts at once
      instead of waiting for the heartbeat to lapse. */
  | { kind: "bye"; from: string; slot: LobbySlot };
