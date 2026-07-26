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
import {
  type CreateErrorCode,
  formatElapsed,
  logFromEvents,
  redactGame,
  type Seat,
} from "@luminous/engine";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../env";
import { resolveUserIdFromCookie } from "../auth/resolveSession";
import { attachedPlayer, attachedUserId, attachPlayer, attachUserId } from "./attachment";
import { loadCardPool } from "./cardPool";
import { loadPlayerDeck } from "./deckLoad";
import {
  ABANDON_GRACE_MS,
  abandonsMatch,
  countdownEndsAt,
  endMatch,
  DISCONNECT_GRACE_MS,
  EMPTY_LOBBY_TTL_MS,
  helloDecision,
  parseClientMessage,
  type PendingDisconnect,
  reseatHost,
  resetAfterFailedStart,
  seatClaimAllowed,
  setSeatConnected,
  slotOf,
  splitDuePending,
  stampCountdown,
  withoutPendingDisconnect,
  withPendingDisconnect,
} from "./logic";
import {
  applyMatchAction,
  MATCH_RECORD_VERSION,
  type MatchLoad,
  type MatchRecord,
  matchSeatOf,
  readMatchRecord,
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
// playerId → the account it's bound to (P4 3a-sec). Written the first time an
// authenticated socket claims a seat; a later hello replaying that playerId must
// present the SAME account (seatClaimAllowed) or it's refused — so a socket can't
// steal a seat (and its redacted hand) by echoing the public playerId. DO-only,
// never broadcast. Cleared with the rest of storage when the lobby empties.
const SEAT_USERS_KEY = "seatUsers";
// Forfeit deadlines for players who vanished mid-MATCH (P4 3c-ii). Same
// {playerId, deadline} shape as PENDING_KEY and driven by the same pure helpers,
// but a different clock and a different consequence: PENDING_KEY's 5s decides
// whether a seat shows as disconnected, this one's 90s decides whether they lose
// the game. Armed only while the lobby is in-game, cleared the moment they
// reconnect.
const ABANDON_KEY = "abandonDeadlines";

/** Whether the match handoff started a real game, or why it couldn't (P4
    increment 3) — a failed deck resolution surfaces `reason` to the players
    instead of wedging the lobby in-game with no match. */
type HandoffResult = { ok: true } | { ok: false; reason: string };

/** What both players are told when a match is retired because this deploy can't
    read its persisted record (a server update landed mid-match). Phrased as the
    recoverable, no-fault event it is — the lobby is already back at `selecting`
    with both seats un-readied, so the next step really is just to ready up. */
const STALE_MATCH_REASON =
  "This match ended because the server was updated. Pick your decks and ready up to play again.";

/** A player-facing reason for an engine `createGame` reject — the contents came
    from D1 (never the client), so this only fires on a genuinely malformed saved
    deck. Exhaustive over `CreateErrorCode`. */
function matchStartReason(code: CreateErrorCode): string {
  switch (code) {
    case "BAD_DECK_SIZE":
      return "A deck must have exactly 60 cards.";
    case "NO_BASIC_POKEMON":
      return "A deck must include at least one Basic Pokémon.";
    case "UNKNOWN_CARD_ID":
      return "A deck references a card that's no longer in the catalog.";
  }
}

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
      // Authenticate the connection from the forwarded `session` cookie (P4
      // increment 3): the resolved account rides on the socket so the match
      // handoff can owner-scope this player's deck read. Anonymous (no/expired
      // cookie) leaves it null — the lobby still works, but that socket can't
      // start a match with a saved deck. Only the DO ever reads it.
      const userId = await resolveUserIdFromCookie(drizzle(this.env.DB), request.headers.get("Cookie"));
      if (userId !== null) attachUserId(pair[1], userId);
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
        const decision = helloDecision(snapshot, frame.from);
        if (decision === "reject-full") {
          this.send(ws, { kind: "reject", to: frame.from, reason: "full" });
          return;
        }
        // Seat authentication (3a-sec): once a playerId is claimed by an account,
        // only that account may re-adopt it — so a socket replaying the seat's
        // PUBLIC playerId without its session can't take the seat (nor be handed
        // its redacted in-game hand). An unbound (anonymous) seat is unaffected.
        const seatUsers = await this.seatUsers();
        const boundUserId = seatUsers[frame.from] ?? null;
        const userId = attachedUserId(ws);
        if (!seatClaimAllowed(boundUserId, userId)) {
          this.send(ws, { kind: "reject", to: frame.from, reason: "full" });
          return;
        }
        // Bind the seat to the account on its FIRST authenticated claim.
        if (boundUserId === null && userId !== null) {
          await this.state.storage.put(SEAT_USERS_KEY, { ...seatUsers, [frame.from]: userId });
        }
        switch (decision) {
          case "claim-host": {
            const code = await this.state.storage.get<string>(CODE_KEY);
            if (code === undefined) return; // unreachable: /ws 404s before create
            attachPlayer(ws, frame.from);
            await this.clearDisconnectTimers(frame.from);
            await this.commit(createSnapshot(code, makePlayer(frame.from, frame.name)));
            await this.sendMatchIfInGame(ws);
            return;
          }
          case "reseat-host": {
            if (snapshot === null) return; // narrowing; decision implies non-null
            attachPlayer(ws, frame.from);
            await this.clearDisconnectTimers(frame.from);
            await this.commit(reseatHost(snapshot, frame.name));
            await this.sendMatchIfInGame(ws);
            return;
          }
          case "seat-guest": {
            if (snapshot === null) return;
            attachPlayer(ws, frame.from);
            await this.clearDisconnectTimers(frame.from);
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
        const load = await this.peekMatch();
        // A record this deploy can't read is retired here rather than silently
        // swallowing every action for the rest of the lobby's life.
        if (load.kind === "stale") return await this.retireStaleMatch();
        if (load.kind === "none") return;
        const record = load.record;
        // Bind the action to the socket's seat (a client can't act for the
        // opponent) and run the engine's total applyAction. A rejected action
        // changes nothing (the client's optimistic gesture already sprang back);
        // the actor's socket gets a transient `reject-action` pill with the
        // engine's own reason (2b-iii-d). On accept, persist BEFORE broadcasting
        // (crash-safe, mirroring the handoff) and fan each socket its redacted view.
        // Date.now() stamps the appended log rows' elapsed time (2b-iii-d-ii).
        const outcome = applyMatchAction(record, seat, frame.action, Date.now());
        if (!outcome.ok) {
          this.send(ws, { kind: "reject-action", reason: outcome.reason });
          return;
        }
        await this.state.storage.put(MATCH_KEY, outcome.record);
        this.broadcastMatch(outcome.record, snapshot);
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
      // A seat whose grace ran out drops to disconnected — and, if a MATCH is
      // running, starts its much longer forfeit clock (P4 3c-ii). Arming it here
      // rather than at socket-close is deliberate: this is the first moment we
      // know they did not come straight back, and the 5s grace has already
      // absorbed the blips.
      let armed = await this.abandonDeadlines();
      let armedChanged = false;
      for (const entry of due) {
        const slot = slotOf(next, entry.playerId);
        if (slot !== null && !hasSocket(entry.playerId)) {
          next = setSeatConnected(next, slot, false);
          if (next.phase === "in-game") {
            armed = withPendingDisconnect(armed, entry.playerId, now + ABANDON_GRACE_MS);
            armedChanged = true;
          }
        }
      }
      if (armedChanged) await this.state.storage.put(ABANDON_KEY, armed);

      // 2) A countdown that ran its course starts the match — unless a seat's
      //    player is gone mid-countdown (possible without a close event, e.g.
      //    a half-open connection), who is demoted instead, exactly like the
      //    old host's liveness check before flipping to in-game.
      const endsAt = countdownEndsAt(next);
      let matchError: string | null = null;
      if (endsAt !== null && now >= endsAt && bothReady(next)) {
        const hostLive = hasSocket(next.host.id);
        const guestLive = next.guest !== null && hasSocket(next.guest.id);
        if (hostLive && guestLive) {
          // P4: instantiate the authoritative engine game BEFORE flipping to
          // in-game, so a client that sees "in-game" can rely on the match
          // existing (increment 1c reads + redacts it) — and only flip if it
          // actually started. A chosen deck that won't resolve (not signed in /
          // not the player's / malformed, increment 3) must NOT wedge the lobby
          // in-game with no match: drop both back to selecting and surface why.
          const inGame: LobbySnapshot = { ...next, phase: "in-game" };
          const handoff = await this.handoffToMatch(inGame);
          if (handoff.ok) {
            next = inGame;
          } else {
            next = resetAfterFailedStart(next);
            matchError = handoff.reason;
          }
        } else {
          if (!guestLive) next = setSeatConnected(next, "guest", false);
          if (!hostLive) next = setSeatConnected(next, "host", false);
        }
      }

      if (next !== snapshot) await this.commit(next);

      // A match that couldn't start: tell both players why (the commit above has
      // already dropped them back to selecting, un-readied).
      if (matchError !== null) this.broadcast({ kind: "match-error", reason: matchError });

      // On the countdown → in-game FLIP, fan each socket its own redacted match
      // view (the `state` broadcast above only says "in-game"; without this the
      // client sits on the placeholder). Gated on the transition so a later
      // alarm mid-match doesn't re-broadcast. Skipped if the handoff failed to
      // write a record (the load-failure wedge, online.md).
      if (snapshot.phase !== "in-game" && next.phase === "in-game") {
        // `handoffToMatch` just wrote this record with the CURRENT version, so
        // the stale arm is unreachable here — read through the same guard anyway
        // (one door onto MATCH_KEY), and skip rather than retire: retiring inside
        // the alarm would commit a second snapshot mid-flip.
        const load = await this.peekMatch();
        if (load.kind === "ok") this.broadcastMatch(load.record, next);
      }

      // 2b) A player who never came back forfeits the running match (P4 3c-ii).
      //     Read AFTER the commit above so `next` is the snapshot we judge, and
      //     after the flip so a match that started this same alarm isn't judged
      //     by a deadline armed for the previous one.
      await this.forfeitAbandoned(next, now, hasSocket);
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
  private async handoffToMatch(snapshot: LobbySnapshot): Promise<HandoffResult> {
    // Idempotency: a LIVE match is never restarted. A record this deploy can't
    // read doesn't count as live — the lobby is starting a match right now, so
    // the fresh write below simply replaces it (no retirement needed, and no
    // reset: the players are about to be in-game either way).
    if ((await this.peekMatch()).kind === "ok") return { ok: true };
    if (snapshot.guest === null) return { ok: false, reason: "The lobby needs two players." };
    const db = drizzle(this.env.DB);
    // Resolve each player's CHOSEN deck (P4 increment 3), owner-scoped by the
    // account the socket authenticated at /ws — a crafted `select-deck` naming
    // someone else's deck id resolves to nothing. host → p1, guest → p2.
    const hostDeck = await loadPlayerDeck(db, snapshot.host.deckId, this.userIdOf(snapshot.host.id));
    if (!hostDeck.ok) return { ok: false, reason: `${snapshot.host.name}: ${hostDeck.reason}.` };
    const guestDeck = await loadPlayerDeck(
      db,
      snapshot.guest.deckId,
      this.userIdOf(snapshot.guest.id),
    );
    if (!guestDeck.ok) return { ok: false, reason: `${snapshot.guest.name}: ${guestDeck.reason}.` };
    // Contents come from D1, never the client, so a legal card list is the only
    // thing the engine ever sees — but the persistence layer doesn't enforce
    // 60 + a Basic, so `startMatch` (createGame) is the authoritative validator.
    const cardPool = await loadCardPool(db, [...hostDeck.ids, ...guestDeck.ids]);
    const seedBytes = new Uint32Array(1);
    crypto.getRandomValues(seedBytes);
    const seed = seedBytes[0] ?? 0;
    const result = startMatch({
      seed,
      hostDeck: hostDeck.ids,
      guestDeck: guestDeck.ids,
      cardPool,
    });
    if (!result.ok) return { ok: false, reason: matchStartReason(result.error.code) };
    // Seat display names for the game log's system rows (host → p1, guest → p2,
    // the SEAT_OF_SLOT mapping startMatch itself uses).
    const names: Record<Seat, string> = { p1: snapshot.host.name, p2: snapshot.guest.name };
    const startedAt = Date.now();
    // Seed the log from createGame's own events (shuffles + the coin flip), at
    // elapsed +00:00 — the same origin the local /play page uses (useLocalGame).
    const log = logFromEvents(result.events, {
      names,
      state: result.state,
      elapsed: formatElapsed(0),
    });
    const record: MatchRecord = {
      version: MATCH_RECORD_VERSION,
      seed,
      startedAt,
      names,
      state: result.state,
      log,
    };
    await this.state.storage.put(MATCH_KEY, record);
    return { ok: true };
  }

  /** The account a seated player's live socket authenticated at /ws, or null
      (an anonymous socket, or none live). At handoff both seats have a live
      socket (the alarm gates on it); used to owner-scope their deck read. */
  private userIdOf(playerId: string): string | null {
    const socket = this.liveSockets().find((ws) => attachedPlayer(ws) === playerId);
    return socket === undefined ? null : attachedUserId(socket);
  }

  /** playerId → the account bound to it (3a-sec). Empty until an authenticated
      socket claims a seat. */
  private async seatUsers(): Promise<Record<string, string>> {
    return (await this.state.storage.get<Record<string, string>>(SEAT_USERS_KEY)) ?? {};
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

  /** One alarm, FOUR duties — earliest deadline wins; alarm() re-derives. */
  private async scheduleMaintenance(sockets: WebSocket[] = this.liveSockets()): Promise<void> {
    const deadlines: number[] = [];

    const snapshot = await this.loadSnapshot();
    const countdownEnd = snapshot === null ? null : countdownEndsAt(snapshot);
    if (countdownEnd !== null) deadlines.push(countdownEnd);

    for (const entry of await this.pendingDisconnects()) deadlines.push(entry.deadline);
    // The match forfeit clock (3c-ii). Load-bearing, not bookkeeping: the alarm
    // that ARMS a forfeit is the disconnect grace, and it consumes its own pending
    // entry — so if this deadline were not scheduled here, nothing would wake the
    // DO again and the forfeit would simply never fire (a lobby with one live
    // socket never reaches the empty-lobby TTL either).
    for (const entry of await this.abandonDeadlines()) deadlines.push(entry.deadline);

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

  /** A player is back: cancel BOTH of their timers — the 5s "show them
      disconnected" grace and, crucially, the 90s match forfeit (P4 3c-ii). Called
      from every hello branch, which is exactly the set of moments a player
      returns; folding both in here is what stops a future branch from cancelling
      one and silently leaving the other armed, which would forfeit a player who
      HAD come back. */
  private async clearDisconnectTimers(playerId: string): Promise<void> {
    const pending = await this.pendingDisconnects();
    const next = withoutPendingDisconnect(pending, playerId);
    if (next.length !== pending.length) await this.state.storage.put(PENDING_KEY, next);
    const abandons = await this.abandonDeadlines();
    const remaining = withoutPendingDisconnect(abandons, playerId);
    if (remaining.length !== abandons.length) {
      await this.state.storage.put(ABANDON_KEY, remaining);
    }
  }

  private async abandonDeadlines(): Promise<PendingDisconnect[]> {
    return (await this.state.storage.get<PendingDisconnect[]>(ABANDON_KEY)) ?? [];
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
      `broadcast`, the BOARD differs PER SOCKET — the one authoritative GameState
      redacted for that socket's seat (host→p1, guest→p2) — so no full state ever
      crosses the wire. The game LOG rides along too (2b-iii-d-ii): seat-keyed and
      leak-safe, so the same array goes to both sockets (each relabels it for its
      own seat), and a reconnecting socket gets the whole backlog. `only` targets
      one socket (a reconnect); omitted, it fans out to every live socket (the
      in-game flip). A socket with no seat (a refused/observer connection) is
      skipped. */
  private broadcastMatch(record: MatchRecord, snapshot: LobbySnapshot, only?: WebSocket): void {
    for (const ws of only === undefined ? this.liveSockets() : [only]) {
      const playerId = attachedPlayer(ws);
      if (playerId === null) continue;
      const seat = matchSeatOf(snapshot, playerId);
      if (seat === null) continue;
      // The board is redacted PER seat; the log is seat-keyed + leak-safe, so the
      // SAME array goes to both sockets (the client relabels it for its own seat).
      this.send(ws, { kind: "match", game: redactGame(record.state, seat), log: record.log });
    }
  }

  /** A (re)connecting socket that lands in an already-in-game lobby gets the
      current match view at once — the `state` broadcast alone would leave it on
      the placeholder. No-op outside in-game or before the handoff wrote a
      record (the load-failure wedge, online.md). */
  private async sendMatchIfInGame(ws: WebSocket): Promise<void> {
    const snapshot = await this.loadSnapshot();
    if (snapshot === null || snapshot.phase !== "in-game") return;
    const load = await this.peekMatch();
    if (load.kind === "ok") this.broadcastMatch(load.record, snapshot, ws);
    else if (load.kind === "stale") await this.retireStaleMatch();
  }

  /** Forfeit the running match for any player whose 90s abandonment deadline has
      passed while they are still gone (P4 3c-ii) — the fix for the lobby that
      could never resolve: before this, one player closing their tab left the
      other staring at a board forever (the empty-lobby TTL only fires when NOBODY
      is connected, and the waiting player is).

      It applies the engine's own `concede` for the vanished seat rather than
      inventing a server-side "abandoned" state, so the match ends the way every
      other match ends: a real `GameOutcome`, the winner's overlay, and a log row,
      all through the same `applyMatchAction` → persist → `broadcastMatch` path a
      player's own move takes. The lobby stays in-game with a finished game, again
      exactly as it does after a normal win.

      Every guard here is a real case: `in-game` (a lobby that already left the
      match has nothing to forfeit), `hasSocket` (they reconnected between the
      alarm being set and it firing — the deadline is cleared on hello, but this
      re-checks the live truth), and the outcome of `applyMatchAction` (the engine
      refuses a concede once the game is over, so a forfeit racing a real win
      changes nothing). Deadlines are consumed whether or not the forfeit lands,
      so a stale entry can't re-fire every alarm. */
  private async forfeitAbandoned(
    snapshot: LobbySnapshot,
    now: number,
    hasSocket: (playerId: string) => boolean,
  ): Promise<void> {
    const { due, waiting } = splitDuePending(await this.abandonDeadlines(), now);
    if (due.length === 0) return;
    await this.state.storage.put(ABANDON_KEY, waiting);
    if (snapshot.phase !== "in-game") return;
    for (const entry of due) {
      if (hasSocket(entry.playerId)) continue;
      const seat = matchSeatOf(snapshot, entry.playerId);
      if (seat === null) continue;
      const load = await this.peekMatch();
      if (load.kind !== "ok") return;
      const outcome = applyMatchAction(load.record, seat, { type: "concede" }, now);
      if (!outcome.ok) continue;
      await this.state.storage.put(MATCH_KEY, outcome.record);
      this.broadcastMatch(outcome.record, snapshot);
    }
  }

  /** Read the persisted match WITHOUT side effects: absent, usable, or written by
      a deploy this build can't trust (`readMatchRecord`, match.ts). Every read of
      `MATCH_KEY` goes through here so no call site ever touches a record whose
      `log`/`names`/`state` it can't rely on. */
  private async peekMatch(): Promise<MatchLoad> {
    const raw = await this.state.storage.get(MATCH_KEY);
    if (raw === undefined) return { kind: "none" };
    const record = readMatchRecord(raw);
    return record === null ? { kind: "stale" } : { kind: "ok", record };
  }

  /** Retire a match this deploy can't read (the no-storage-migration gap,
      online.md): drop it, take the lobby OUT of in-game the way a failed start
      does — un-readying both seats, so the countdown can't immediately re-fire —
      and tell both players why. Without this the lobby would wedge in-game around
      an unreadable record: reconnects would sit on the placeholder forever and
      every action would be silently dropped.

      Reuses 3a's `match-error` surface rather than inventing a second recovery
      path: to a player the two are the same event — the match can't
      start/continue, re-pick and ready up. The phase change goes through
      `endMatch`, NOT `resetAfterFailedStart`: that one is for a lobby still in
      `countdown` and would leave an already-in-game lobby exactly where it is
      (`recomputePhase` never leaves in-game on its own) — i.e. wedged in-game
      around the record we just deleted, which is the very failure this closes.
      `commit` drops MATCH_KEY on that transition too; the explicit delete first
      keeps this correct even if the lobby is somehow no longer in-game. */
  private async retireStaleMatch(): Promise<void> {
    await this.state.storage.delete(MATCH_KEY);
    const snapshot = await this.loadSnapshot();
    if (snapshot === null || snapshot.phase !== "in-game") return;
    await this.commit(endMatch(snapshot));
    this.broadcast({ kind: "match-error", reason: STALE_MATCH_REASON });
  }
}
