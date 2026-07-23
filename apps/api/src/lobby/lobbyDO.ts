// LobbyDO — one Durable Object per lobby code (§3.6), the server-side
// replacement for the BroadcastChannel model's authoritative "host peer". It
// owns the one true LobbySnapshot in DO storage, applies every validated
// client intent through the SHARED, unchanged lobbyReducer, and broadcasts
// the resulting snapshot to every connected socket.
//
// Hibernation: sockets are accepted with `state.acceptWebSocket`, so an idle
// lobby is evicted from memory without dropping connections and burns no
// duration. Everything needed to wake up mid-conversation survives eviction:
// the snapshot in storage, each socket's player id in its attachment
// (attachment.ts), and the keepalive is answered by `setWebSocketAutoResponse`
// without waking the instance at all.
//
// One alarm, three duties (earliest deadline wins; alarm() re-derives all):
//   1. disconnect graces — a dropped socket only marks its seat disconnected
//      after DISCONNECT_GRACE_MS without a reconnect (logic.ts);
//   2. the countdown — countdown → in-game after COUNTDOWN_MS, unless a seat's
//      player vanished, who is demoted instead (the old host did the same);
//   3. empty-lobby expiry — EMPTY_LOBBY_TTL_MS after the last socket goes,
//      storage is wiped, freeing the code.
//
// This class deliberately does NOT extend cloudflare:workers' DurableObject:
// it's addressed purely over fetch (no RPC), and staying a plain class keeps
// the module importable outside the workers runtime (vitest imports the app
// via index.ts, which must export this class for wrangler).

import {
  applyIntent,
  bothReady,
  createSnapshot,
  isValidLobbyCode,
  LOBBY_WS_PING,
  LOBBY_WS_PONG,
  type LobbyServerMessage,
  type LobbySnapshot,
  makePlayer,
  removeGuest,
  seatGuest,
} from "@luminous/schema";
import { redactGame } from "@luminous/engine";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../env";
import { attachedPlayer, attachPlayer } from "./attachment";
import { loadCardPool } from "./cardPool";
import {
  abandonsMatch,
  countdownEndsAt,
  DISCONNECT_GRACE_MS,
  EMPTY_LOBBY_TTL_MS,
  helloDecision,
  parseClientMessage,
  type PendingDisconnect,
  reseatHost,
  setSeatConnected,
  slotOf,
  splitDuePending,
  stampCountdown,
  withoutPendingDisconnect,
  withPendingDisconnect,
} from "./logic";
import {
  applyMatchAction,
  FIXED_MATCH_CARD_IDS,
  FIXED_MATCH_DECKS,
  matchSeatOf,
  type MatchRecord,
  startMatch,
} from "./match";

// Storage keys. `created` marks that POST /lobby claimed this code — a socket
// upgrade for a code that was never created (or has expired) is refused, so
// guessing codes yields silence, which the client reads as "not found".
const CREATED_KEY = "created";
const CODE_KEY = "code";
const SNAPSHOT_KEY = "snapshot";
const CLEANUP_AT_KEY = "cleanupAt";
const PENDING_KEY = "pendingDisconnects";
// The authoritative match (P4) — the engine GameState + seed, written once when
// the countdown flips the lobby to in-game (online.md increment 1b).
const MATCH_KEY = "match";

export class LobbyDO {
  private readonly state: DurableObjectState;
  /** Worker bindings — needed for D1 (the match card pool) at handoff (P4). */
  private readonly env: Env;
  /** In-memory mirror of SNAPSHOT_KEY; undefined = not read since last wake. */
  private snapshot: LobbySnapshot | null | undefined;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // Keepalive pings are answered in the proxy layer — a hibernated lobby
    // stays hibernated while clients ping to check their link.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LOBBY_WS_PING, LOBBY_WS_PONG));
  }

  // The Worker (lobby/routes.ts) addresses the DO over two internal paths:
  // POST /create claims the code (409 if already claimed — the mint retries a
  // new one), GET /ws upgrades a client socket into the lobby.
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (request.method === "POST" && path === "/create") {
      const code = request.headers.get("x-lobby-code");
      if (code === null || !isValidLobbyCode(code)) {
        return Response.json({ error: "invalid lobby code" }, { status: 400 });
      }
      if ((await this.state.storage.get(CREATED_KEY)) !== undefined) {
        return Response.json({ error: "code in use" }, { status: 409 });
      }
      await this.state.storage.put({ [CREATED_KEY]: Date.now(), [CODE_KEY]: code });
      // Arm the expiry now, so a minted-but-never-entered lobby still evaporates.
      await this.scheduleMaintenance();
      return Response.json({ code }, { status: 201 });
    }

    if (request.method === "GET" && path === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return Response.json({ error: "expected a websocket upgrade" }, { status: 426 });
      }
      if ((await this.state.storage.get(CREATED_KEY)) === undefined) {
        return Response.json({ error: "no such lobby" }, { status: 404 });
      }
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      // A live socket parks any pending empty-lobby expiry.
      await this.scheduleMaintenance();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    const frame = parseClientMessage(message);
    if (frame === null) return; // §3.6: anything that doesn't validate is dropped
    const snapshot = await this.loadSnapshot();

    switch (frame.kind) {
      case "hello": {
        switch (helloDecision(snapshot, frame.from)) {
          case "reject-full":
            this.send(ws, { kind: "reject", to: frame.from, reason: "full" });
            return;
          case "claim-host": {
            const code = await this.state.storage.get<string>(CODE_KEY);
            if (code === undefined) return; // unreachable: /ws 404s before create
            attachPlayer(ws, frame.from);
            await this.clearPendingDisconnect(frame.from);
            await this.commit(createSnapshot(code, makePlayer(frame.from, frame.name)));
            await this.sendMatchIfInGame(ws);
            return;
          }
          case "reseat-host": {
            if (snapshot === null) return; // narrowing; decision implies non-null
            attachPlayer(ws, frame.from);
            await this.clearPendingDisconnect(frame.from);
            await this.commit(reseatHost(snapshot, frame.name));
            await this.sendMatchIfInGame(ws);
            return;
          }
          case "seat-guest": {
            if (snapshot === null) return;
            attachPlayer(ws, frame.from);
            await this.clearPendingDisconnect(frame.from);
            await this.commit(seatGuest(snapshot, frame.from, frame.name));
            await this.sendMatchIfInGame(ws);
            return;
          }
        }
        return;
      }

      case "intent": {
        // The socket must be bound to the id it claims — a guest can't steer
        // the host's seat by forging `from`.
        if (snapshot === null || attachedPlayer(ws) !== frame.from) return;
        const slot = slotOf(snapshot, frame.from);
        if (slot === null) return;
        const next = applyIntent(snapshot, slot, frame.intent);
        if (next !== snapshot) await this.commit(next);
        return;
      }

      case "action": {
        // A game action for the running match (P4). Authority is the socket's
        // OWN bound seat — never the client-claimed action.seat — so a client
        // can never act for its opponent. Only a seated player in an in-game
        // lobby with a persisted match may act.
        if (snapshot === null || snapshot.phase !== "in-game") return;
        const playerId = attachedPlayer(ws);
        if (playerId === null) return;
        const seat = matchSeatOf(snapshot, playerId);
        if (seat === null) return;
        const record = await this.state.storage.get<MatchRecord>(MATCH_KEY);
        if (record === undefined) return;
        // Bind the action to the socket's seat (a client can't act for the
        // opponent) and run the engine's total applyAction. A rejected action
        // changes nothing — the client's optimistic gesture already sprang back;
        // increment 2b adds the rejection pill. On accept, persist BEFORE
        // broadcasting (crash-safe, mirroring the handoff) and fan each socket
        // its own redacted view.
        const next = applyMatchAction(record, seat, frame.action);
        if (next === null) return;
        await this.state.storage.put(MATCH_KEY, next);
        this.broadcastMatch(next, snapshot);
        return;
      }

      case "reject": {
        // The host's kick — the exact frame the BroadcastChannel host posted
        // at its guest. Valid only from the host's socket, aimed at the seated
        // guest. Relay it first (the sticky "you were removed"), then free the
        // seat and broadcast the now-waiting lobby.
        if (snapshot === null || snapshot.guest === null) return;
        if (attachedPlayer(ws) !== snapshot.host.id || frame.to !== snapshot.guest.id) return;
        this.sendToPlayer(frame.to, frame);
        await this.commit(removeGuest(snapshot));
        return;
      }

      case "bye": {
        if (snapshot === null || attachedPlayer(ws) !== frame.from) return;
        const slot = slotOf(snapshot, frame.from);
        // A guest's graceful leave frees the seat at once (old semantics); the
        // host's marks the seat disconnected but keeps the lobby alive — the
        // host id is pinned, so only they can return to it, and the empty-lobby
        // expiry reclaims the code if nobody does.
        if (slot === "guest") await this.commit(removeGuest(snapshot));
        else if (slot === "host") await this.commit(setSeatConnected(snapshot, "host", false));
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const sockets = this.liveSockets();
    const hasSocket = (playerId: string) =>
      sockets.some((socket) => attachedPlayer(socket) === playerId);

    // 1) Disconnect graces that ran out → seats whose player never returned
    //    drop to disconnected (unreadying them; the phase re-derives).
    const { due, waiting } = splitDuePending(await this.pendingDisconnects(), now);
    if (due.length > 0) await this.state.storage.put(PENDING_KEY, waiting);

    const snapshot = await this.loadSnapshot();
    if (snapshot !== null) {
      let next = snapshot;
      for (const entry of due) {
        const slot = slotOf(next, entry.playerId);
        if (slot !== null && !hasSocket(entry.playerId)) {
          next = setSeatConnected(next, slot, false);
        }
      }

      // 2) A countdown that ran its course starts the match — unless a seat's
      //    player is gone mid-countdown (possible without a close event, e.g.
      //    a half-open connection), who is demoted instead, exactly like the
      //    old host's liveness check before flipping to in-game.
      const endsAt = countdownEndsAt(next);
      if (endsAt !== null && now >= endsAt && bothReady(next)) {
        const hostLive = hasSocket(next.host.id);
        const guestLive = next.guest !== null && hasSocket(next.guest.id);
        if (hostLive && guestLive) {
          next = { ...next, phase: "in-game" };
          // P4: instantiate the authoritative engine game before the in-game
          // snapshot is broadcast, so a client that sees "in-game" can rely on
          // the match already existing (increment 1c reads + redacts it).
          await this.handoffToMatch();
        } else {
          if (!guestLive) next = setSeatConnected(next, "guest", false);
          if (!hostLive) next = setSeatConnected(next, "host", false);
        }
      }

      if (next !== snapshot) await this.commit(next);

      // On the countdown → in-game FLIP, fan each socket its own redacted match
      // view (the `state` broadcast above only says "in-game"; without this the
      // client sits on the placeholder). Gated on the transition so a later
      // alarm mid-match doesn't re-broadcast. Skipped if the handoff failed to
      // write a record (the load-failure wedge, online.md).
      if (snapshot.phase !== "in-game" && next.phase === "in-game") {
        const record = await this.state.storage.get<MatchRecord>(MATCH_KEY);
        if (record !== undefined) this.broadcastMatch(record, next);
      }
    }

    // 3) An empty lobby past its expiry evaporates entirely, freeing the code
    //    for a future POST /lobby to mint again.
    const cleanupAt = await this.state.storage.get<number>(CLEANUP_AT_KEY);
    if (sockets.length === 0 && cleanupAt !== undefined && now >= cleanupAt) {
      this.snapshot = null;
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm(); // deleteAll leaves alarms in place
      return;
    }
    await this.scheduleMaintenance(sockets);
  }

  // --- Internals -------------------------------------------------------------

  /** A socket dropped without a bye: give its player the reconnect grace
      before the seat shows as disconnected (the old presence timeout). */
  private async socketGone(closing: WebSocket): Promise<void> {
    const playerId = attachedPlayer(closing);
    const remaining = this.liveSockets(closing);
    if (playerId !== null && !remaining.some((socket) => attachedPlayer(socket) === playerId)) {
      const snapshot = await this.loadSnapshot();
      if (snapshot !== null && slotOf(snapshot, playerId) !== null) {
        const pending = await this.pendingDisconnects();
        await this.state.storage.put(
          PENDING_KEY,
          withPendingDisconnect(pending, playerId, Date.now() + DISCONNECT_GRACE_MS),
        );
      }
    }
    await this.scheduleMaintenance(remaining);
  }

  /** P4 handoff (online.md): the countdown just flipped this lobby to in-game,
      so mint the authoritative engine game once and persist it. The DO owns the
      RNG seed + all hidden info here on out. Idempotent — a re-fired alarm never
      restarts a live match. Fixed placeholder decks + a D1-resolved pool for now
      (real deck selection is increment 3). */
  private async handoffToMatch(): Promise<void> {
    if ((await this.state.storage.get(MATCH_KEY)) !== undefined) return;
    const cardPool = await loadCardPool(drizzle(this.env.DB), FIXED_MATCH_CARD_IDS);
    const seedBytes = new Uint32Array(1);
    crypto.getRandomValues(seedBytes);
    const seed = seedBytes[0] ?? 0;
    const result = startMatch({
      seed,
      hostDeck: FIXED_MATCH_DECKS.host,
      guestDeck: FIXED_MATCH_DECKS.guest,
      cardPool,
    });
    if (!result.ok) {
      // The fixed decks are known-valid, so a failure means the pool was
      // incomplete (those ids aren't in this D1). Don't wedge the lobby — it
      // still shows in-game and the client renders a placeholder until 1c —
      // but log it loudly; increment 2 surfaces match errors to players.
      console.error(`lobby match handoff failed: ${result.error.code} — ${result.error.message}`);
      return;
    }
    const record: MatchRecord = { seed, state: result.state };
    await this.state.storage.put(MATCH_KEY, record);
  }

  /** Persist → broadcast → re-arm the alarm: the ONE path every snapshot
      change takes, so nothing is ever announced that didn't hit storage. */
  private async commit(next: LobbySnapshot): Promise<void> {
    const stamped = stampCountdown(next, Date.now());
    // A persisted match outlives EXACTLY the match it describes: when this commit
    // takes the lobby out of in-game (removeGuest — a guest's bye or the host's
    // kick), drop the stale GameState so a rematch in this same lobby mints a
    // fresh one instead of handoffToMatch's guard reusing the old (P4, online.md).
    const abandoned = abandonsMatch(this.snapshot ?? null, stamped);
    this.snapshot = stamped;
    await this.state.storage.put(SNAPSHOT_KEY, stamped);
    if (abandoned) await this.state.storage.delete(MATCH_KEY);
    this.broadcast({ kind: "state", snapshot: stamped });
    await this.scheduleMaintenance();
  }

  /** One alarm, three duties — earliest deadline wins; alarm() re-derives. */
  private async scheduleMaintenance(sockets: WebSocket[] = this.liveSockets()): Promise<void> {
    const deadlines: number[] = [];

    const snapshot = await this.loadSnapshot();
    const countdownEnd = snapshot === null ? null : countdownEndsAt(snapshot);
    if (countdownEnd !== null) deadlines.push(countdownEnd);

    for (const entry of await this.pendingDisconnects()) deadlines.push(entry.deadline);

    if (sockets.length === 0) {
      let cleanupAt = await this.state.storage.get<number>(CLEANUP_AT_KEY);
      if (cleanupAt === undefined) {
        cleanupAt = Date.now() + EMPTY_LOBBY_TTL_MS;
        await this.state.storage.put(CLEANUP_AT_KEY, cleanupAt);
      }
      deadlines.push(cleanupAt);
    } else if ((await this.state.storage.get(CLEANUP_AT_KEY)) !== undefined) {
      await this.state.storage.delete(CLEANUP_AT_KEY);
    }

    if (deadlines.length === 0) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(Math.min(...deadlines));
  }

  private async loadSnapshot(): Promise<LobbySnapshot | null> {
    if (this.snapshot === undefined) {
      this.snapshot = (await this.state.storage.get<LobbySnapshot>(SNAPSHOT_KEY)) ?? null;
    }
    return this.snapshot;
  }

  private async pendingDisconnects(): Promise<PendingDisconnect[]> {
    return (await this.state.storage.get<PendingDisconnect[]>(PENDING_KEY)) ?? [];
  }

  private async clearPendingDisconnect(playerId: string): Promise<void> {
    const pending = await this.pendingDisconnects();
    const next = withoutPendingDisconnect(pending, playerId);
    if (next.length !== pending.length) await this.state.storage.put(PENDING_KEY, next);
  }

  private liveSockets(excluding?: WebSocket): WebSocket[] {
    const sockets = this.state.getWebSockets();
    return excluding === undefined ? sockets : sockets.filter((socket) => socket !== excluding);
  }

  private send(ws: WebSocket, message: LobbyServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket already gone; its close event will tidy up.
    }
  }

  private sendToPlayer(playerId: string, message: LobbyServerMessage): void {
    for (const ws of this.liveSockets()) {
      if (attachedPlayer(ws) === playerId) this.send(ws, message);
    }
  }

  private broadcast(message: LobbyServerMessage): void {
    const encoded = JSON.stringify(message);
    for (const ws of this.liveSockets()) {
      try {
        ws.send(encoded);
      } catch {
        // Socket already gone; its close event will tidy up.
      }
    }
  }

  /** Send each targeted socket its OWN redacted view of the match (P4). Unlike
      `broadcast`, the payload differs PER SOCKET — the one authoritative
      GameState redacted for that socket's seat (host→p1, guest→p2) — so no full
      state ever crosses the wire. `only` targets one socket (a reconnect);
      omitted, it fans out to every live socket (the in-game flip). A socket with
      no seat (a refused/observer connection) is skipped. */
  private broadcastMatch(record: MatchRecord, snapshot: LobbySnapshot, only?: WebSocket): void {
    for (const ws of only === undefined ? this.liveSockets() : [only]) {
      const playerId = attachedPlayer(ws);
      if (playerId === null) continue;
      const seat = matchSeatOf(snapshot, playerId);
      if (seat === null) continue;
      this.send(ws, { kind: "match", game: redactGame(record.state, seat) });
    }
  }

  /** A (re)connecting socket that lands in an already-in-game lobby gets the
      current match view at once — the `state` broadcast alone would leave it on
      the placeholder. No-op outside in-game or before the handoff wrote a
      record (the load-failure wedge, online.md). */
  private async sendMatchIfInGame(ws: WebSocket): Promise<void> {
    const snapshot = await this.loadSnapshot();
    if (snapshot === null || snapshot.phase !== "in-game") return;
    const record = await this.state.storage.get<MatchRecord>(MATCH_KEY);
    if (record !== undefined) this.broadcastMatch(record, snapshot, ws);
  }
}
