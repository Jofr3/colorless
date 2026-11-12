import type { GameAction } from "@colorless/engine";
import {
  COUNTDOWN_MS,
  createSnapshot,
  LOBBY_PROTOCOL,
  type LobbyIntent,
  type LobbyMessage,
  type LobbySlot,
  type LobbySnapshot,
  makePlayer,
  type PlayerState,
  publicSeatId,
  type RedactedGame,
  type SeatLogEntry,
  type WireAction,
} from "@colorless/schema";
import { createLobbyChannel, type LobbyChannel } from "./channel";

// The framework-free lobby client: one WebSocket per code, the hello/presence
// state machine, and the six commands. The authoritative reducer runs
// server-side in the lobby Durable Object, so BOTH roles are plain clients:
// announce yourself with a hello, send intents for your own seat, adopt
// whatever snapshot the server broadcasts. The host still seeds a local
// snapshot so creating a lobby lands straight on the waiting screen with no
// "joining…" flash. The Lua adapter (src/lua/online.ts) is a thin view over
// this class.

/** How our link to the lobby server is faring. "connecting" also covers a
    client that lost the server and is trying to reconnect. "not-found" is the server's definite
    word that the code names no lobby; "unreachable" is a first connection that
    never got an answer (a later one still takes the client back). "full" means
    both seats are held by others. "outdated" is the server's word that this page is too old for
    the lobby, and a reload fixes it. */
export type LobbyStatus =
  | "connecting"
  | "connected"
  | "not-found"
  | "unreachable"
  | "full"
  | "outdated";

export type DeckChoice = { id: string; name: string };

/** A rejected game action, surfaced as a transient pill. `nonce` bumps per
    rejection so an identical repeat re-announces (the local GameError pattern). */
export type ActionError = { reason: string; nonce: number };

export type LobbyClientOptions = {
  code: string;
  role: LobbySlot;
  /** This tab's seat secret (session.ts): sent only in the hello, which it claims the seat with. */
  secret: string;
  name: string;
  /** A seat carried over from the socket this one replaces (a reopen after
      signing in), so the view holds its step until the server reseats us. */
  resume?: Pick<LobbyClientState, "snapshot" | "status" | "deckId">;
};

export type LobbyClientState = {
  snapshot: LobbySnapshot | null;
  status: LobbyStatus;
  /** This client's REDACTED view of the running match, or null until the server
      broadcasts one; cleared whenever the lobby leaves in-game. */
  match: RedactedGame | null;
  /** The match's whole seat-keyed log, rebuilt from each frame (`receivedLog`). */
  matchLog: SeatLogEntry[];
  /** How many full match frames (each a hello's answer) this client took: the server may never
      have seen what this seat sent before one. */
  fullFrames: number;
  /** The last refused game action; cleared by the next accepted one. */
  actionError: ActionError | null;
  /** Why the last match failed to START; cleared by the next lobby state. */
  matchError: string | null;
  /** The saved deck this client picked. The server keeps every seat's deck id to itself and
      says only whether one is picked, so this is the client's own memory of its pick: null once
      the server says none is, and unknown (null) after a reload, which keeps the deck's name. */
  deckId: string | null;
};

const HELLO_RETRY_MS = 700;
// No word from the server for this long ⇒ treat the link as down. The channel
// surfaces every server pong as a heartbeat frame, so a healthy-but-quiet
// lobby never trips this.
export const PRESENCE_TIMEOUT_MS = 5000;
/** A client that never hears back from the server within this window says it could not connect.
    Silence is not "not found": a dead code is answered at once with LOBBY_WS_NOT_FOUND, so this
    only ends a server that is down or a path that never connects. It covers a first socket's
    CONNECT_TIMEOUT_MS (channel.ts) and a retry, so a slow cold start still lands as "connecting".
    It was a 4 s not-found window, which a slow first socket overran. */
export const UNREACHABLE_MS = 20_000;

/** The state before any frame: the host lands on its own seeded snapshot. */
function initialLobbyState(
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
    fullFrames: 0,
    actionError: null,
    matchError: null,
    deckId: null,
  };
}

/**
 * The whole log after a `match` frame: the frame's log when it is full, the held log plus the
 * frame's entries when it continues the held log, or null when it does not.
 */
export function receivedLog(
  held: SeatLogEntry[],
  frame: Extract<LobbyMessage, { kind: "match" }>,
): SeatLogEntry[] | null {
  if (frame.logFrom === undefined) return frame.log;
  if (frame.logFrom !== held.length) return null;
  return [...held, ...frame.log];
}

/** Whole seconds left on the start countdown (3, 2, 1, then 0 = "Go!"). `startedAt` is the
    server's clock and `now` this device's, so a device clock behind the server's would count from
    more than the countdown has: it is held to the countdown's length. */
export function countdownSeconds(startedAt: number, now: number): number {
  const seconds = Math.ceil((COUNTDOWN_MS - (now - startedAt)) / 1000);
  return Math.min(Math.ceil(COUNTDOWN_MS / 1000), Math.max(0, seconds));
}

/** The versus status line (four cases, in the Lua font's ASCII). */
export function versusStatus(self: PlayerState | null, opponent: PlayerState | null): string {
  if (!opponent?.connected) return "Opponent disconnected - waiting to reconnect...";
  if (!self?.ready) return "";
  return opponent.ready ? "Both ready - starting..." : "Waiting for your opponent to ready up...";
}

export class LobbyClient {
  readonly code: string;
  /** This seat's PUBLIC id, as the lobby's snapshots name it: the hash of `secret`. */
  readonly playerId: string;
  private readonly secret: string;
  /** The seat this client holds: the role it joined as, until a snapshot seats its id in the
      other one (a guest whose hello reached a fresh lobby before its creator's). */
  private slot: LobbySlot;
  private name: string;
  private channel: LobbyChannel;
  private now: () => number;
  private current: LobbyClientState;
  private listeners = new Set<(s: LobbyClientState) => void>();
  private unsubscribe: () => void;
  private tick: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  /** The server answered our hello "full": we hold no seat, and adopt no frame until a snapshot
      seats us. */
  private refused = false;
  private connectedOnce = false;
  private lastServerSeen = 0;
  private mountedAt: number;
  /** The server closed the lobby for good: nothing will arrive to start the poll again. */
  private closedForGood = false;

  constructor(opts: LobbyClientOptions, deps: { channel?: LobbyChannel; now?: () => number } = {}) {
    this.code = opts.code;
    this.slot = opts.role;
    this.secret = opts.secret;
    this.playerId = publicSeatId(opts.secret);
    this.name = opts.name;
    this.now = deps.now ?? (() => performance.now());
    this.channel =
      deps.channel ??
      createLobbyChannel(opts.code, { onLobbyClosed: (reason) => this.lobbyClosed(reason) });
    this.current = {
      ...initialLobbyState(opts.code, opts.role, this.playerId, opts.name),
      ...opts.resume,
    };
    this.mountedAt = this.now();
    this.unsubscribe = this.channel.subscribe((m) => this.receive(m));
    this.hello();
    this.startPoll();
  }

  get state(): LobbyClientState {
    return this.current;
  }

  get role(): LobbySlot {
    return this.slot;
  }

  get self(): PlayerState | null {
    const s = this.current.snapshot;
    return s ? (this.slot === "host" ? s.host : s.guest) : null;
  }

  get opponent(): PlayerState | null {
    const s = this.current.snapshot;
    return s ? (this.slot === "host" ? s.guest : s.host) : null;
  }

  subscribe(fn: (s: LobbyClientState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  selectDeck(deck: DeckChoice) {
    this.set({ deckId: deck.id });
    this.intent({ type: "select-deck", deckId: deck.id, deckName: deck.name });
  }

  setReady(ready: boolean) {
    this.intent({ type: "set-ready", ready });
  }

  /** Announce a graceful departure (dispose does this too). */
  leave() {
    this.channel.post({ kind: "bye", from: this.playerId, slot: this.slot });
  }

  /** Only the server knows whether the match is over, so it decides. */
  requestRematch() {
    this.channel.post({ kind: "rematch", from: this.playerId });
  }

  /** The DO binds the action to this socket's seat. GameAction structurally
      satisfies the loose wire action; the cast is a Zod index-signature artifact. True when the
      action went out on an open socket, false when it waits behind the next socket's hello. */
  sendAction(action: GameAction): boolean {
    return this.channel.post({ kind: "action", action: action as unknown as WireAction });
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
    // A bye queued while the link is down still goes out on the next socket, or a Leave mid-match
    // would forfeit only once the away clock ran out.
    this.channel.close({ deliver: opts.bye !== false });
  }

  private set(patch: Partial<LobbyClientState>) {
    this.current = { ...this.current, ...patch };
    for (const fn of [...this.listeners]) fn(this.current);
  }

  private stop() {
    if (this.tick !== null) clearInterval(this.tick);
    this.tick = null;
  }

  /** Run the presence poll, unless it already runs. A server that answers after the unreachable
      window stopped it starts it again, so a later silence still reads as the link down. */
  private startPoll() {
    if (this.tick !== null || this.disposed || this.closedForGood) return;
    this.tick = setInterval(() => this.poll(), HELLO_RETRY_MS);
  }

  /** The server says the code names no lobby (closed for good, or never there), or that this page
      is too old for it. */
  lobbyClosed(reason: "closed" | "outdated" = "closed") {
    if (this.disposed) return;
    this.closedForGood = true;
    this.stop();
    this.set({ status: reason === "outdated" ? "outdated" : "not-found" });
  }

  private hello() {
    this.channel.post({
      kind: "hello",
      from: this.secret,
      name: this.name,
      protocol: LOBBY_PROTOCOL,
    });
  }

  private intent(intent: LobbyIntent) {
    this.channel.post({ kind: "intent", from: this.playerId, intent });
  }

  private receive(message: LobbyMessage) {
    if (this.disposed) return;
    switch (message.kind) {
      case "state": {
        const snapshot = message.snapshot;
        // The seat holding this client's id, whichever: a guest's hello that reached a fresh lobby
        // first was seated as its host, and the creator's then as its guest.
        const slot =
          snapshot.host.id === this.playerId
            ? "host"
            : snapshot.guest?.id === this.playerId
              ? "guest"
              : null;
        const seat = slot === null ? null : snapshot[slot];
        // Refused sockets get broadcasts too. A refused tab's re-sent hello may later take the
        // freed seat, which the server marks connected: adopt it rather than hold it as "full".
        if (this.refused) {
          this.lastServerSeen = this.now();
          if (!seat?.connected) break;
          this.refused = false;
        }
        if (slot === null || seat === null) break;
        this.slot = slot;
        this.lastServerSeen = this.now();
        this.connectedOnce = true;
        this.startPoll();
        // The failing handoff broadcasts its state BEFORE the match-error, so
        // this clear runs first and the error still lands.
        this.set({
          snapshot,
          status: "connected",
          matchError: null,
          ...(!seat.hasDeck && { deckId: null }),
          ...(snapshot.phase !== "in-game" && { match: null, matchLog: [], actionError: null }),
        });
        break;
      }
      case "match": {
        if (this.refused) break;
        this.lastServerSeen = this.now();
        const matchLog = receivedLog(this.current.matchLog, message);
        // A delta that does not continue the held log: the hello path answers with a full frame.
        if (matchLog === null) {
          this.hello();
          break;
        }
        this.set({
          match: message.game,
          matchLog,
          actionError: null,
          ...(message.logFrom === undefined && { fullFrames: this.current.fullFrames + 1 }),
        });
        break;
      }
      case "reject-action": {
        if (this.refused) break;
        this.lastServerSeen = this.now();
        const nonce = (this.current.actionError?.nonce ?? 0) + 1;
        this.set({ actionError: { reason: message.reason, nonce } });
        break;
      }
      case "match-error": {
        if (this.refused) break;
        this.lastServerSeen = this.now();
        this.set({ matchError: message.reason });
        break;
      }
      case "reject": {
        if (message.to !== this.playerId) break;
        this.refused = true;
        this.lastServerSeen = this.now();
        this.startPoll();
        this.set({ status: "full" });
        break;
      }
      case "heartbeat":
        this.lastServerSeen = this.now();
        break;
    }
  }

  private poll() {
    if (this.disposed) return;
    const idle = this.now() - this.lastServerSeen;
    if (this.refused) {
      // Re-announce only once the link went quiet, so a full lobby is no storm.
      if (idle > PRESENCE_TIMEOUT_MS) this.hello();
      return;
    }
    if (!this.connectedOnce) {
      if (this.now() - this.mountedAt > UNREACHABLE_MS) {
        this.stop();
        this.set({ status: "unreachable" });
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
