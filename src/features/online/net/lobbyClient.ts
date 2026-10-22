import type { GameAction } from "@luminous/engine";
import {
  COUNTDOWN_MS,
  createSnapshot,
  type LobbyIntent,
  type LobbyMessage,
  type LobbySlot,
  type LobbySnapshot,
  makePlayer,
  type PlayerState,
  type RedactedGame,
  type SeatLogEntry,
  type WireAction,
} from "@luminous/schema";
import { createLobbyChannel, type LobbyChannel } from "./channel";

// The framework-free lobby client: one WebSocket per code, the hello/presence
// state machine, and the six commands. The authoritative reducer runs
// server-side in the lobby Durable Object, so BOTH roles are plain clients:
// announce yourself with a hello, send intents for your own seat, adopt
// whatever snapshot the server broadcasts. The host still seeds a local
// snapshot so creating a lobby lands straight on the waiting screen with no
// "joining…" flash. React's useLobby and the Lua adapter (features/lua/online)
// are both thin views over this class.

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

export type LobbyClientOptions = {
  code: string;
  role: LobbySlot;
  playerId: string;
  name: string;
  /** A seat carried over from the socket this one replaces (a reopen after
      signing in), so the view holds its step until the server reseats us. */
  resume?: Pick<LobbyClientState, "snapshot" | "status">;
};

export type LobbyClientState = {
  snapshot: LobbySnapshot | null;
  status: LobbyStatus;
  /** This client's REDACTED view of the running match, or null until the server
      broadcasts one; cleared whenever the lobby leaves in-game. */
  match: RedactedGame | null;
  /** The match's whole seat-keyed log, replaced (never appended) per frame. */
  matchLog: SeatLogEntry[];
  /** The last refused game action; cleared by the next accepted one. */
  actionError: ActionError | null;
  /** Why the last match failed to START; cleared by the next lobby state. */
  matchError: string | null;
};

export const HELLO_RETRY_MS = 700;
// No word from the server for this long ⇒ treat the link as down. The channel
// surfaces every server pong as a heartbeat frame, so a healthy-but-quiet
// lobby never trips this.
export const PRESENCE_TIMEOUT_MS = 5000;
// A client that never hears back from the server within this window decides
// the code is wrong / the lobby doesn't exist (or has expired).
export const NOT_FOUND_MS = 4000;

/** The state before any frame: the host lands on its own seeded snapshot. */
export function initialLobbyState(
  code: string,
  role: LobbySlot,
  playerId: string,
  name: string,
): LobbyClientState {
  const host = role === "host";
  return {
    snapshot: host ? createSnapshot(code, makePlayer(playerId, name)) : null,
    status: host ? "connected" : "connecting",
    match: null,
    matchLog: [],
    actionError: null,
    matchError: null,
  };
}

/** Whole seconds left on the start countdown (3, 2, 1, then 0 = "Go!"). */
export function countdownSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.ceil((COUNTDOWN_MS - (now - startedAt)) / 1000));
}

/** "M:SS" for a forfeit clock. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The versus status line (LobbyRoom's four cases, in the Lua font's ASCII). */
export function versusStatus(self: PlayerState | null, opponent: PlayerState | null): string {
  if (!opponent?.connected) return "Opponent disconnected - waiting to reconnect...";
  if (!self?.ready) return "";
  return opponent.ready ? "Both ready - starting..." : "Waiting for your opponent to ready up...";
}

export class LobbyClient {
  readonly code: string;
  readonly role: LobbySlot;
  readonly playerId: string;
  private name: string;
  private channel: LobbyChannel;
  private now: () => number;
  private current: LobbyClientState;
  private listeners = new Set<(s: LobbyClientState) => void>();
  private unsubscribe: () => void;
  private tick: ReturnType<typeof setInterval> | null;
  private disposed = false;
  // Why we hold no seat, if we don't. "kicked" is terminal — stop everything.
  // "full" is NOT: the server may still hand us the match to watch.
  private refusal: "full" | "kicked" | null = null;
  private connectedOnce = false;
  private lastServerSeen = 0;
  private mountedAt: number;

  constructor(opts: LobbyClientOptions, deps: { channel?: LobbyChannel; now?: () => number } = {}) {
    this.code = opts.code;
    this.role = opts.role;
    this.playerId = opts.playerId;
    this.name = opts.name;
    this.now = deps.now ?? Date.now;
    this.channel = deps.channel ?? createLobbyChannel(opts.code);
    this.current = {
      ...initialLobbyState(opts.code, opts.role, opts.playerId, opts.name),
      ...opts.resume,
    };
    this.mountedAt = this.now();
    this.unsubscribe = this.channel.subscribe((m) => this.receive(m));
    this.hello();
    this.tick = setInterval(() => this.poll(), HELLO_RETRY_MS);
  }

  get state(): LobbyClientState {
    return this.current;
  }

  get self(): PlayerState | null {
    const s = this.current.snapshot;
    return s ? (this.role === "host" ? s.host : s.guest) : null;
  }

  get opponent(): PlayerState | null {
    const s = this.current.snapshot;
    return s ? (this.role === "host" ? s.guest : s.host) : null;
  }

  subscribe(fn: (s: LobbyClientState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  selectDeck(deck: DeckChoice) {
    this.intent({ type: "select-deck", deckId: deck.id, deckName: deck.name });
  }

  setReady(ready: boolean) {
    this.intent({ type: "set-ready", ready });
  }

  /** Announce a graceful departure (dispose does this too). */
  leave() {
    this.channel.post({ kind: "bye", from: this.playerId, slot: this.role });
  }

  /** Host only: remove the guest. The server relays the reject to them. */
  kick() {
    const guest = this.current.snapshot?.guest?.id;
    if (this.role !== "host" || !guest) return;
    this.channel.post({ kind: "reject", to: guest, reason: "kicked" });
  }

  /** Only the server knows whether the match is over, so it decides. */
  requestRematch() {
    this.channel.post({ kind: "rematch", from: this.playerId });
  }

  /** The DO binds the action to this socket's seat. GameAction structurally
      satisfies the loose wire action; the cast is a Zod index-signature artifact. */
  sendAction(action: GameAction) {
    this.channel.post({ kind: "action", action: action as unknown as WireAction });
  }

  /** Stop, optionally say bye, and close. `{bye:false}` keeps the seat held so a
      new socket with the same identity resumes it (e.g. after signing in). */
  dispose(opts: { bye?: boolean } = {}) {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    if (opts.bye !== false) this.leave();
    this.unsubscribe();
    this.listeners.clear();
    this.channel.close();
  }

  private set(patch: Partial<LobbyClientState>) {
    this.current = { ...this.current, ...patch };
    for (const fn of [...this.listeners]) fn(this.current);
  }

  private stop() {
    if (this.tick !== null) clearInterval(this.tick);
    this.tick = null;
  }

  private hello() {
    this.channel.post({ kind: "hello", from: this.playerId, name: this.name });
  }

  private intent(intent: LobbyIntent) {
    this.channel.post({ kind: "intent", from: this.playerId, intent });
  }

  private receive(message: LobbyMessage) {
    if (this.disposed) return;
    switch (message.kind) {
      case "state": {
        const snapshot = message.snapshot;
        // A spectator keeps the public snapshot (for names) but claims nothing.
        if (this.refusal === "full") {
          this.lastServerSeen = this.now();
          this.set(
            snapshot.phase === "in-game" ? { snapshot } : { snapshot, match: null, matchLog: [] },
          );
          break;
        }
        // Only adopt a snapshot that seats US: refused sockets get broadcasts too.
        const seated = this.role === "host" ? snapshot.host.id : snapshot.guest?.id;
        if (this.refusal !== null || seated !== this.playerId) break;
        this.lastServerSeen = this.now();
        this.connectedOnce = true;
        // The failing handoff broadcasts its state BEFORE the match-error, so
        // this clear runs first and the error still lands.
        this.set({
          snapshot,
          status: "connected",
          matchError: null,
          ...(snapshot.phase !== "in-game" && { match: null, matchLog: [], actionError: null }),
        });
        break;
      }
      case "match": {
        if (this.refusal === "kicked") break;
        this.lastServerSeen = this.now();
        this.set({
          ...(this.refusal === "full" && { status: "spectating" as const }),
          match: message.game,
          matchLog: message.log,
          actionError: null,
        });
        break;
      }
      case "reject-action": {
        if (this.refusal !== null) break;
        this.lastServerSeen = this.now();
        const nonce = (this.current.actionError?.nonce ?? 0) + 1;
        this.set({ actionError: { reason: message.reason, nonce } });
        break;
      }
      case "match-error": {
        if (this.refusal !== null) break;
        this.lastServerSeen = this.now();
        this.set({ matchError: message.reason });
        break;
      }
      case "reject": {
        if (message.to !== this.playerId) break;
        this.refusal = message.reason === "kicked" ? "kicked" : "full";
        this.lastServerSeen = this.now();
        this.set({ status: this.refusal });
        break;
      }
      case "heartbeat":
        this.lastServerSeen = this.now();
        break;
    }
  }

  private poll() {
    if (this.disposed || this.refusal === "kicked") return;
    const idle = this.now() - this.lastServerSeen;
    if (this.refusal === "full") {
      // Re-announce only once the link went quiet, so a full lobby is no storm.
      if (idle > PRESENCE_TIMEOUT_MS) this.hello();
      return;
    }
    if (!this.connectedOnce) {
      if (this.now() - this.mountedAt > NOT_FOUND_MS) {
        this.stop();
        this.set({ status: "not-found" });
        return;
      }
      this.hello();
    } else if (idle > PRESENCE_TIMEOUT_MS) {
      // The channel is already reconnecting; keep re-announcing to reseat.
      if (this.current.status !== "connecting") this.set({ status: "connecting" });
      this.hello();
    }
  }
}
