// The shared vocabulary for the online lobby: the snapshot the lobby server owns, and the messages
// it exchanges with both players. Players only send intents and render the snapshot they are sent.

import type { RedactedGame, SeatLogEntry, WireAction } from "../match";

/** The two seats in a lobby. The creator is always the host. */
export type LobbySlot = "host" | "guest";

/** One player's state within a lobby, as tracked by the host. */
export type PlayerState = {
  /** The seat's PUBLIC id (seatId.ts): a hash of the secret only this player's client holds, so
      the lobby can name the seat to everyone without handing out what claims it (LB6). Stable
      across reconnects of the same tab. */
  id: string;
  name: string;
  /** Whether they have picked a deck. The deck's id stays on the server, which reads the deck
      with it at match start: it is a private library id, never broadcast (LB5). */
  hasDeck: boolean;
  /** The picked deck's name, or null until they pick one. Sent so a player's own client can
      label its pick after a reload, when it no longer remembers which deck it chose. */
  deckName: string | null;
  /** Locked in and waiting to start. Only ever true with a deck chosen. */
  ready: boolean;
  /** Whether the host currently sees this player as connected (heartbeat-based;
      the host is connected by definition). */
  connected: boolean;
  /** A stable, opaque token for the ACCOUNT behind this seat, from which a
      deterministic avatar is drawn (P5-2). Null for an anonymous seat, which
      renders the generic figure instead. It is a HASH of the account id, never
      the id itself: the point is that the same person looks the same to you
      across lobbies, not that anyone can join this token to another surface. */
  avatarSeed: string | null;
  /**
   * Epoch ms at which this seat forfeits the running match unless its player returns; null when
   * nothing is pending. Invariant: `connected` implies `forfeitAt === null`.
   */
  forfeitAt: number | null;
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

/** A change a player asks to make to their own seat. The lobby server validates and applies it.
    A seat's name comes only from its hello: the account's name for a signed-in socket, else the
    announced one (the `set-name` intent was removed, security audit AU8). */
export type LobbyIntent =
  | { type: "select-deck"; deckId: string; deckName: string }
  | { type: "set-ready"; ready: boolean };

/** Everything that can travel over a lobby channel. In a `hello`, `from` is the sender's seat
    SECRET, which claims the seat; in every other frame `from` and `to` are public seat ids. The
    server judges a frame by the seat its socket's hello claimed, never by `from`. */
export type LobbyMessage =
  /** client → server: request to join, or re-announce after a reconnect. `from` is the client's
      seat secret (seatId.ts), sent in no other frame. `logDeltas` says the client takes `match`
      frames that carry only the log's new entries. */
  | { kind: "hello"; from: string; name: string; logDeltas?: boolean }
  /** host → all: the authoritative snapshot after any change. */
  | { kind: "state"; snapshot: LobbySnapshot }
  /** server → one client: that client's REDACTED view of the in-game match
      (P4). Per-viewer — the DO redacts `GameState` for each socket's seat — so
      it never rides the same-string `broadcast`; it is sent on the in-game flip
      and on reconnect. `log` is the accumulated game log (seat-keyed, leak-safe,
      so IDENTICAL for both viewers — the client relabels `who` for its own seat);
      it rides here because the log outlives any single snapshot and can't be
      rebuilt from `game`'s current state alone. With `logFrom`, `log` holds only the entries from
      that index on; only a socket whose hello set `logDeltas` gets one. Without it, `log` is the
      whole log. */
  | { kind: "match"; game: RedactedGame; log: SeatLogEntry[]; logFrom?: number }
  /** guest → host: apply this change to my seat. */
  | { kind: "intent"; from: string; intent: LobbyIntent }
  /** client → server: a game action for the running match (P4). The DO binds it
      to the socket's own seat (a client can't act for the opponent) and runs it
      through the engine's total `applyAction`. */
  | { kind: "action"; action: WireAction }
  /** host → guest: you're not welcome — the seat is taken ("full"), or the host
      removed you ("kicked"). */
  | { kind: "reject"; to: string; reason: "full" | "kicked" }
  /** server → the acting client: their last game action was refused — an illegal
      move, or an unsupported type (P4). TRANSIENT, unlike `reject`: it aims at
      the socket that sent the action (no `to`), carries the engine's own reason
      for a pill, and is not terminal — the board already reflects only accepted
      state, so a rejected action changed nothing. */
  | { kind: "reject-action"; reason: string }
  /** server → both players: the countdown ended but the match could NOT start —
      a player's chosen deck wouldn't resolve (not signed in / not theirs /
      malformed) (P4 increment 3). The lobby has dropped back to `selecting` (both
      un-readied); `reason` says why, so they can fix a deck and retry instead of
      wedging in-game with no match. */
  | { kind: "match-error"; reason: string }
  /** either direction: a periodic keep-alive so the other side knows we're here. */
  | { kind: "heartbeat"; from: string; slot: LobbySlot }
  /** either direction: a graceful "I'm leaving" so the other side reacts at once
      instead of waiting for the heartbeat to lapse. */
  | { kind: "bye"; from: string; slot: LobbySlot }
  /** client → server: play again in this same lobby (P4 3c-vi). A lifecycle
      command rather than a seat `intent`, because its legality is not a property
      of the snapshot the reducer sees — only the server knows whether the match
      it holds has actually FINISHED. It takes the lobby back to `selecting` and
      readies the asker, so the existing ready-up flow is what starts the next
      game; the server drops the finished match with the phase change. */
  | { kind: "rematch"; from: string };
