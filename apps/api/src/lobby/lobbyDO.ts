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
// One alarm, five duties (earliest deadline wins; alarm() re-derives all). The
// labels below are the ones `alarm()` carries in its own body, so a reader can
// jump between the two — 2 and 2b are numbered as a pair because the forfeit
// check lives inside the same in-game branch as the countdown:
//   0) liveness — every LIVENESS_SWEEP_MS while sockets are connected, a socket
//      that stopped answering keepalives is closed (3c-viii); the auto-response
//      below is precisely why nothing else could notice;
//   1) disconnect graces — a dropped socket only marks its seat disconnected
//      after DISCONNECT_GRACE_MS without a reconnect (logic.ts);
//   2) the countdown — countdown → in-game after COUNTDOWN_MS, unless a seat's
//      player vanished, who is demoted instead (the old host did the same);
//   2b) match forfeits — a seat's ABANDON_GRACE_MS deadline (3c-ii/3c-v, on the
//      snapshot) ends the running match for a player who never came back;
//   3) empty-lobby expiry — EMPTY_LOBBY_TTL_MS after the last socket goes,
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
import { avatarSeedFrom } from "../auth/avatar";
import { resolveUserIdFromCookie } from "../auth/resolveSession";
import {
  attachedPlayer,
  attachedUserId,
  attachPlayer,
  attachSpectator,
  attachUserId,
  isSpectating,
} from "./attachment";
import { loadCardPool } from "./cardPool";
import { loadPlayerDeck } from "./deckLoad";
import { loadDisplayName } from "./displayName";
import {
  ABANDON_GRACE_MS,
  abandonsMatch,
  applyBye,
  countdownEndsAt,
  endMatch,
  DISCONNECT_GRACE_MS,
  EMPTY_LOBBY_TTL_MS,
  forfeitDeadlines,
  helloDecision,
  LIVENESS_SWEEP_MS,
  parseClientMessage,
  type PendingDisconnect,
  readSnapshot,
  rematch,
  reseatHost,
  resetAfterFailedStart,
  seatClaimAllowed,
  setSeatConnected,
  slotOf,
  socketIsSilent,
  splitDuePending,
  stampCountdown,
  withForfeitAt,
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
  SEAT_OF_SLOT,
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

/** Which side of the table a SPECTATOR's board renders from (P4 3c-vii-b). The
    host, so every spectator of a given match sees the same orientation and reads
    the lobby's own host/guest order. It carries no privilege: the seatless
    redaction withholds both sides' hands either way. */
const SPECTATOR_SIDE = "p1" as const;

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
      const userId = await resolveUserIdFromCookie(
        drizzle(this.env.DB),
        request.headers.get("Cookie"),
      );
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
        if (decision === "reject-full") return await this.refuseSeat(ws, frame.from);
        // Seat authentication (3a-sec): once a playerId is claimed by an account,
        // only that account may re-adopt it — so a socket replaying the seat's
        // PUBLIC playerId without its session can't take the seat (nor be handed
        // its redacted in-game hand). An unbound (anonymous) seat is unaffected.
        const seatUsers = await this.seatUsers();
        const boundUserId = seatUsers[frame.from] ?? null;
        const userId = attachedUserId(ws);
        if (!seatClaimAllowed(boundUserId, userId)) return await this.refuseSeat(ws, frame.from);
        // Bind the seat to the account on its FIRST authenticated claim.
        if (boundUserId === null && userId !== null) {
          await this.state.storage.put(SEAT_USERS_KEY, { ...seatUsers, [frame.from]: userId });
        }
        // The seat's NAME is the account's, not the one the frame announced (P5).
        // Resolved here rather than trusted, so a player cannot present themselves
        // as someone else — which starts to matter the moment names stop being
        // random. An anonymous socket (or an account with a blank name) keeps its
        // announced handle; a signed-out player can sit in a lobby, they just
        // can't start a match with a saved deck. The read is deliberately AFTER
        // the refusal branches above, so a socket that gets no seat costs no D1
        // query however often it retries.
        const name = (await loadDisplayName(drizzle(this.env.DB), userId)) ?? frame.name;
        // …and the face, from the same account (P5-2). Derived, not stored and
        // not read: it costs nothing beyond the userId the socket already holds.
        const avatarSeed = avatarSeedFrom(userId);
        switch (decision) {
          case "claim-host": {
            const code = await this.state.storage.get<string>(CODE_KEY);
            if (code === undefined) return; // unreachable: /ws 404s before create
            attachPlayer(ws, frame.from);
            await this.clearDisconnectGrace(frame.from);
            await this.commit(createSnapshot(code, makePlayer(frame.from, name, avatarSeed)));
            await this.sendMatchIfInGame(ws);
            return;
          }
          case "reseat-host": {
            if (snapshot === null) return; // narrowing; decision implies non-null
            attachPlayer(ws, frame.from);
            await this.clearDisconnectGrace(frame.from);
            await this.commit(reseatHost(snapshot, name, avatarSeed));
            await this.sendMatchIfInGame(ws);
            return;
          }
          case "seat-guest": {
            if (snapshot === null) return;
            attachPlayer(ws, frame.from);
            await this.clearDisconnectGrace(frame.from);
            await this.commit(seatGuest(snapshot, frame.from, name, avatarSeed));
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
        if (slot === null) return;
        // Walking out of a RUNNING match FORFEITS it (P4 3c-iv) instead of
        // voiding it: the opponent gets a real result — the same one the Concede
        // button and the 90s abandonment timer produce — down the same
        // applyMatchAction → persist → broadcastMatch path. A no-op once the game
        // is over (the engine refuses a concede then), which is what makes a
        // double `bye` — an explicit leave() plus the unmount's — harmless.
        const seat = snapshot.phase === "in-game" ? matchSeatOf(snapshot, frame.from) : null;
        if (seat !== null) await this.concedeSeat(snapshot, seat, Date.now());
        // …and only THEN the lobby change, which in-game keeps the seat (so the
        // result the concede just broadcast stays on the winner's screen) and
        // otherwise frees a guest's / parks the host's (applyBye).
        await this.commit(applyBye(snapshot, slot));
        return;
      }

      case "rematch": {
        // Play again in this same lobby (P4 3c-vi) — the exit 3c-iv deliberately
        // left out, since an in-game lobby otherwise has no route back except the
        // host's kick. Legality is the SERVER's to judge, which is why this is a
        // frame and not a seat `intent`: only the DO can see whether the match it
        // holds has finished, and a rematch mid-game must be refused (conceding is
        // how you leave a live one).
        if (snapshot === null || attachedPlayer(ws) !== frame.from) return;
        if (snapshot.phase !== "in-game") return;
        const slot = slotOf(snapshot, frame.from);
        if (slot === null) return;
        const load = await this.peekMatch();
        if (load.kind === "stale") return await this.retireStaleMatch();
        // No record, or a game still in progress: nothing to replay yet. Silent —
        // the client only offers the control on a finished board, so reaching this
        // means a crafted frame, and it changes nothing.
        if (load.kind !== "ok" || load.record.state.phase.kind !== "gameOver") return;
        // `commit` sees the lobby leave in-game (`abandonsMatch`) and drops
        // MATCH_KEY with it — which is precisely what makes the next handoff mint
        // a FRESH game rather than hitting its idempotency guard on this one.
        await this.commit(rematch(snapshot, slot));
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
    // 0) Sockets that stopped answering keepalives (P4 3c-viii). FIRST, so a
    //    connection dropped here is judged by everything below on this same pass
    //    rather than waiting another sweep.
    await this.sweepSilentSockets(now);
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
      // running, starts its much longer forfeit clock in the SAME write (P4
      // 3c-ii, on the snapshot since 3c-v). Arming it here rather than at
      // socket-close is deliberate: this is the first moment we know they did not
      // come straight back, and the 5s grace has already absorbed the blips.
      // `recomputePhase` never leaves in-game, so the phase read before the call
      // is the phase after it.
      for (const entry of due) {
        const slot = slotOf(next, entry.playerId);
        if (slot !== null && !hasSocket(entry.playerId)) {
          const forfeitAt = next.phase === "in-game" ? now + ABANDON_GRACE_MS : null;
          next = setSeatConnected(next, slot, false, forfeitAt);
        }
      }

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

      // 2b) A player who never came back forfeits the running match (P4 3c-ii).
      //     Judged on the FINAL `next` — after the flip, so a match that started
      //     on this same alarm is never judged by a deadline armed for the
      //     previous one — and CONSUMED in it, so clearing the deadline rides the
      //     commit below instead of needing a second one. Consumed whether or not
      //     the forfeit lands, so a stale deadline can't re-fire every alarm.
      //     The concede itself waits until after the commit, so the board it
      //     broadcasts is the snapshot the players have.
      const forfeiting: Seat[] = [];
      for (const { slot, deadline } of forfeitDeadlines(next)) {
        if (deadline > now) continue;
        const player = slot === "host" ? next.host : next.guest;
        next = withForfeitAt(next, slot, null);
        // `hasSocket` re-checks the live truth: a deadline is cleared the moment
        // its player says hello, but this also covers one set before they came
        // back. A lobby that already left in-game has nothing to forfeit.
        if (next.phase === "in-game" && player !== null && !hasSocket(player.id)) {
          forfeiting.push(SEAT_OF_SLOT[slot]);
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

      for (const seat of forfeiting) await this.concedeSeat(next, seat, now);
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

  /** Close sockets that have stopped answering keepalives (P4 3c-viii) — the
      half-open connection: a network that dies without a TCP close, leaving a
      socket that looks perfectly live to the DO forever. Before this, such a
      player was never marked disconnected, never started a forfeit clock, and
      their opponent waited indefinitely; every ORDINARY exit (tab close, browser
      kill, navigation, reload, crash) produces a close event, which is why it took
      a deliberate `set offline` in a browser run to surface it.

      The signal is the runtime's own: `setWebSocketAutoResponse` answers the
      client's 1.5s ping WITHOUT waking the DO — which is exactly why the DO can
      never notice pings that stop — but it records WHEN it last answered, and
      `getWebSocketAutoResponseTimestamp` hands that back for free. So liveness
      costs one alarm every `LIVENESS_SWEEP_MS` instead of the hibernation-killing
      alternative of answering keepalives in `webSocketMessage`.

      Closing is all this does. Everything after — the 5s grace, the seat going
      disconnected, the 90s forfeit — is the machinery a real close already drives,
      reached here through the same `socketGone`. The server's own `close()` does
      not deliver a `webSocketClose` event to us, so that call is explicit rather
      than incidental. */
  private async sweepSilentSockets(now: number): Promise<void> {
    const silent = this.liveSockets().filter((ws) =>
      socketIsSilent(this.state.getWebSocketAutoResponseTimestamp(ws), now),
    );
    for (const ws of silent) {
      try {
        ws.close(1001, "keepalive lost");
      } catch {
        // Already gone; the bookkeeping below still applies.
      }
      await this.socketGone(ws);
    }
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
    const hostDeck = await loadPlayerDeck(
      db,
      snapshot.host.deckId,
      this.userIdOf(snapshot.host.id),
    );
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
    // takes the lobby out of in-game (the host's kick, or `endMatch` retiring an
    // unreadable record — a mid-match `bye` no longer does, 3c-iv), drop the stale
    // GameState so a rematch in this same lobby mints a fresh one instead of
    // handoffToMatch's guard reusing the old (P4, online.md).
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
    // The match forfeit clock (3c-ii; read off the snapshot's seats since 3c-v).
    // Load-bearing, not bookkeeping: the alarm that ARMS a forfeit is the
    // disconnect grace, and it consumes its own pending entry — so if this
    // deadline were not scheduled here, nothing would wake the DO again and the
    // forfeit would simply never fire (a lobby with one live socket never reaches
    // the empty-lobby TTL either). It sits beside `countdownEndsAt` on purpose:
    // one place that turns snapshot state into the next wake-up.
    if (snapshot !== null) {
      for (const { deadline } of forfeitDeadlines(snapshot)) deadlines.push(deadline);
    }

    // While anyone is connected, keep a slow poll running: it is the ONLY thing
    // that can notice a socket whose keepalives stopped (3c-viii), because the
    // auto-response deliberately never wakes us. With nobody connected there is
    // nothing to check — the empty-lobby expiry below owns that case.
    if (sockets.length > 0) deadlines.push(Date.now() + LIVENESS_SWEEP_MS);

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

  /** The stored snapshot, read through `readSnapshot` so a lobby persisted by an
      OLDER deploy comes back complete (3c-v added `PlayerState.forfeitAt`). The
      alternative — a version gate like `MatchRecord`'s — would evict live lobbies
      on every deploy that adds a field, and unlike a match record there is no
      embedded engine state a default could quietly get wrong. */
  private async loadSnapshot(): Promise<LobbySnapshot | null> {
    if (this.snapshot === undefined) {
      this.snapshot = readSnapshot(await this.state.storage.get(SNAPSHOT_KEY));
    }
    return this.snapshot;
  }

  private async pendingDisconnects(): Promise<PendingDisconnect[]> {
    return (await this.state.storage.get<PendingDisconnect[]>(PENDING_KEY)) ?? [];
  }

  /** A player is back: cancel the 5s "show them disconnected" grace. Called from
      every hello branch, which is exactly the set of moments a player returns.

      Their 90s match FORFEIT is cancelled by the same branch's reseat —
      `seatGuest` / `reseatHost` / `createSnapshot` each mark the seat present and
      clear `forfeitAt` in one write, PlayerState's invariant (3c-v). That is why
      this only has one timer left to clear: the deadline moved onto the seat it
      belongs to, so "mark them present" and "don't forfeit them" became a single
      indivisible act rather than two calls a future branch could do one of. */
  private async clearDisconnectGrace(playerId: string): Promise<void> {
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
      // A SPECTATOR (3c-vii-b) has no seat: they get the seatless redaction, which
      // withholds BOTH hands and every actor affordance (3c-vii-a). `SPECTATOR_SIDE`
      // only decides which side renders at the bottom of their board.
      if (playerId === null) {
        if (!isSpectating(ws)) continue;
        this.send(ws, {
          kind: "match",
          game: redactGame(record.state, SPECTATOR_SIDE, true),
          log: record.log,
        });
        continue;
      }
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

  /** No seat for this socket — both are held, or the one it named belongs to a
      different account (3a-sec). It always learns that (`reject: full`, the frame
      the client has always keyed its "Lobby is full" screen on), and IF a match is
      running it also becomes a SPECTATOR and is handed the seatless board
      (P4 3c-vii-b).

      Reusing the refusal as the entry point is the whole design: no new client
      frame, no second URL, no invite flow — **the lobby link IS the spectate
      link**, and the rule falls out as "you can watch a MATCH, you cannot watch a
      lobby". Outside in-game this stays exactly the dead end it has always been,
      which matters because a pre-match lobby has nothing to show a third party
      and a seat may yet free up for them.

      A spectator is NOT seated: no playerId, no `PlayerState`, nothing in the
      snapshot. Every handler that can change the game gates on `attachedPlayer`,
      which stays null for them, so watching grants no power over the match — and
      by `redactGame(..., true)` (3c-vii-a) it grants no hidden information either.
      Deliberate consequence, worth naming: anyone who has (or guesses) the lobby
      code can watch a game in progress. What they see is a public table — both
      boards, no hands, no deck order, no prizes. */
  private async refuseSeat(ws: WebSocket, to: string): Promise<void> {
    this.send(ws, { kind: "reject", to, reason: "full" });
    const snapshot = await this.loadSnapshot();
    if (snapshot === null || snapshot.phase !== "in-game") return;
    const load = await this.peekMatch();
    if (load.kind !== "ok") return;
    attachSpectator(ws);
    // The snapshot as well as the board. `state` frames only go out on a lobby
    // COMMIT, and a match in progress may not produce one for many minutes — so a
    // spectator who joined mid-match would otherwise have no idea who is playing
    // (a browser run caught exactly this: their board read "Host vs Guest"). It
    // carries nothing private; it is the same frame both players already hold.
    this.send(ws, { kind: "state", snapshot });
    this.broadcastMatch(load.record, snapshot, ws);
  }

  /** Concede the running match FOR `seat` and fan the finished game out — the
      one path by which the SERVER ends a match on a player's behalf, shared by
      its two triggers: the 90s abandonment forfeit (3c-ii, fired from the alarm)
      and a graceful leave mid-match (3c-iv). Both exist to close the same hole —
      a lobby that could never resolve, because the empty-lobby TTL only fires
      when NOBODY is connected and the player left staring at the board IS.

      It applies the engine's own `concede` rather than inventing a server-side
      "abandoned" state, and does so through the same `applyMatchAction` → persist
      → `broadcastMatch` sequence a player's own `concede` action takes, so a
      server-ended match is indistinguishable from a pressed one: same
      `GameOutcome`, same log row, same overlay, and the lobby stays in-game with a
      finished game exactly as it does after a normal win.

      It does NOTHING when there is nothing to concede — no readable record, or a
      game the engine says is already over (a forfeit racing a real win, or the
      second of the two `bye` frames a leave sends). Neither caller needs to know
      which: in every case the answer is to carry on, never to retry. */
  private async concedeSeat(snapshot: LobbySnapshot, seat: Seat, now: number): Promise<void> {
    const load = await this.peekMatch();
    if (load.kind !== "ok") return;
    const outcome = applyMatchAction(load.record, seat, { type: "concede" }, now);
    if (!outcome.ok) return;
    await this.state.storage.put(MATCH_KEY, outcome.record);
    this.broadcastMatch(outcome.record, snapshot);
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
