// One Durable Object per lobby code. It owns the snapshot, applies intents through the snapshot
// transitions and broadcasts the result. Sockets use hibernation; the keepalive is answered by the
// auto-response without waking the instance.
// One alarm covers all deadlines: liveness sweeps, disconnect graces, countdown, match forfeits,
// and empty-lobby expiry.
// Not a `DurableObject` subclass, so the module imports outside the workers runtime.

import {
  type Card,
  createSnapshot,
  isValidLobbyCode,
  LOBBY_WS_PING,
  LOBBY_WS_PONG,
  type LobbyClientMessage,
  type LobbyServerMessage,
  type LobbySnapshot,
  makePlayer,
} from "@colorless/schema";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import type { Env } from "../env";
import { avatarSeedFrom } from "../auth/avatar";
import { resolveAccountFromCookie, type SessionAccount } from "../auth/resolveSession";
import {
  attachAccount,
  attachedDisplayName,
  attachedPlayer,
  attachedUserId,
  attachLogDeltas,
  attachPlayer,
  attachSpectator,
  isSpectating,
  takesLogDeltas,
} from "./attachment";
import { loadCardPool } from "./cardPool";
import { type LoadDeckResult, loadPlayerDeck } from "./deckLoad";
import { lobbyDisplayName } from "./displayName";
import { DO_CREATE_PATH, DO_WS_PATH, isWebSocketUpgrade, LOBBY_CODE_HEADER } from "./doProtocol";
import {
  ABANDON_GRACE_MS,
  abandonsMatch,
  applyBye,
  countdownEndsAt,
  endMatch,
  DISCONNECT_GRACE_MS,
  EMPTY_LOBBY_TTL_MS,
  forfeitDeadlines,
  type HelloDecision,
  helloDecision,
  LIVENESS_SWEEP_MS,
  parseClientMessage,
  type PendingDisconnect,
  readSnapshot,
  readStored,
  rematch,
  reseatHost,
  resetAfterFailedStart,
  sameSnapshot,
  seatClaimAllowed,
  setSeatConnected,
  slotOf,
  socketIsSilent,
  splitDuePending,
  stampCountdown,
  storedChooserSchema,
  storedCleanupAtSchema,
  storedCodeSchema,
  storedPendingSchema,
  storedSeatUsersSchema,
  withForfeitAt,
  withoutPendingDisconnect,
  withPendingDisconnect,
} from "./logic";
import {
  applyMatchAction,
  beginMatch,
  loadMatchRecord,
  type MatchLoad,
  type MatchRecord,
  type MatchViewer,
  matchFrameFor,
  matchSeatOf,
  playerIdOfSeat,
  SEAT_OF_SLOT,
  type Seat,
  rematchChooser,
} from "./match";
import { MatchStore } from "./matchStore";
import { applyIntent, bothReady, removeGuest, seatGuest } from "./snapshot";

// Storage keys. `created` marks that POST /lobby claimed this code — a socket
// upgrade for a code that was never created (or has expired) is refused, so
// guessing codes yields silence, which the client reads as "not found".
const CREATED_KEY = "created";
const CODE_KEY = "code";
const SNAPSHOT_KEY = "snapshot";
const CLEANUP_AT_KEY = "cleanupAt";
const PENDING_KEY = "pendingDisconnects";
// The playerId who lost the last game in this lobby: they choose the rematch's
// play order (`settleFirstPlayer`). Consumed by the next successful handoff.
const CHOOSER_KEY = "nextChooser";
// playerId → the account it's bound to (P4 3a-sec). Written the first time an
// authenticated socket claims a seat; a later hello replaying that playerId must
// present the SAME account (seatClaimAllowed) or it's refused — so a socket can't
// steal a seat (and its redacted hand) by echoing the public playerId. DO-only,
// never broadcast. Cleared with the rest of storage when the lobby empties.
const SEAT_USERS_KEY = "seatUsers";

/** One validated client frame of the given kind. */
type ClientFrame<Kind extends LobbyClientMessage["kind"]> = Extract<
  LobbyClientMessage,
  { kind: Kind }
>;

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

/** Everything the lobby reads from outside its own storage and sockets: the clock, the match
    seed, and the D1 lookups. */
export interface LobbyDeps {
  now(): number;
  randomSeed(): number;
  /** The account a forwarded `Cookie` header's session belongs to, or null. */
  resolveAccount(cookie: string | null): Promise<SessionAccount | null>;
  /** A player's chosen deck as flat card ids, owner-scoped to `userId`. */
  loadDeck(deckId: string | null, userId: string | null): Promise<LoadDeckResult>;
  /** The catalog cards for `ids`, keyed by id; missing ids are absent. */
  loadPool(ids: readonly string[]): Promise<Record<string, Card>>;
}

/** The production wiring: the system clock, a CSPRNG seed and the Worker's D1 binding. */
export function lobbyDepsFromEnv(env: Env): LobbyDeps {
  const db = () => drizzle(env.DB);
  return {
    now: () => Date.now(),
    randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
    resolveAccount: (cookie) => resolveAccountFromCookie(db(), cookie),
    loadDeck: (deckId, userId) => loadPlayerDeck(db(), deckId, userId),
    loadPool: (ids) => loadCardPool(db(), ids),
  };
}

export class LobbyDO {
  private readonly state: DurableObjectState;
  private readonly deps: LobbyDeps;
  /** In-memory mirror of SNAPSHOT_KEY; undefined = not read since last wake. */
  private snapshot: LobbySnapshot | null | undefined;
  /** The authoritative match: the engine GameState, seed and log, written when the countdown
      flips the lobby to in-game and on every accepted action. */
  private readonly match: MatchStore;

  constructor(state: DurableObjectState, env: Env, deps: LobbyDeps = lobbyDepsFromEnv(env)) {
    this.state = state;
    this.deps = deps;
    this.match = new MatchStore(state.storage);
    // Keepalive pings are answered in the proxy layer — a hibernated lobby
    // stays hibernated while clients ping to check their link.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LOBBY_WS_PING, LOBBY_WS_PONG));
  }

  // The Worker (lobby/routes.ts) addresses the DO over two internal paths:
  // POST /create claims the code (409 if already claimed — the mint retries a
  // new one), GET /ws upgrades a client socket into the lobby.
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (request.method === "POST" && path === DO_CREATE_PATH) {
      const code = request.headers.get(LOBBY_CODE_HEADER);
      if (code === null || !isValidLobbyCode(code)) {
        return Response.json({ error: "invalid lobby code" }, { status: 400 });
      }
      if ((await this.state.storage.get(CREATED_KEY)) !== undefined) {
        return Response.json({ error: "code in use" }, { status: 409 });
      }
      await this.state.storage.put({ [CREATED_KEY]: this.deps.now(), [CODE_KEY]: code });
      // Arm the expiry now, so a minted-but-never-entered lobby still evaporates.
      await this.scheduleMaintenance();
      return Response.json({ code }, { status: 201 });
    }

    if (request.method === "GET" && path === DO_WS_PATH) {
      if (!isWebSocketUpgrade(request.headers.get("Upgrade"))) {
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
      // start a match with a saved deck. Only the DO ever reads it. The account's name is read in
      // the same query, so a rename shows from the next connection on.
      const account = await this.deps.resolveAccount(request.headers.get("Cookie"));
      if (account !== null) {
        attachAccount(pair[1], account.userId, lobbyDisplayName(account.displayName));
      }
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
      case "hello":
        return this.onHello(ws, frame, snapshot);
      case "intent":
        return this.onIntent(ws, frame, snapshot);
      case "action":
        return this.onAction(ws, frame, snapshot);
      case "reject":
        return this.onReject(ws, frame, snapshot);
      case "bye":
        return this.onBye(ws, frame, snapshot);
      case "rematch":
        return this.onRematch(ws, frame, snapshot);
    }
  }

  private async onHello(
    ws: WebSocket,
    frame: ClientFrame<"hello">,
    snapshot: LobbySnapshot | null,
  ): Promise<void> {
    attachLogDeltas(ws, frame.logDeltas === true);
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
    // The seat's name comes from the account, not the frame. Anonymous sockets keep their
    // announced name.
    const name = attachedDisplayName(ws) ?? frame.name;
    // …and the face, from the same account (P5-2). Derived, not stored and
    // not read: it costs nothing beyond the userId the socket already holds.
    const avatarSeed = avatarSeedFrom(userId);
    const next = await this.seatedSnapshot(decision, snapshot, frame.from, name, avatarSeed);
    if (next === null) return;
    attachPlayer(ws, frame.from);
    const graceCleared = await this.clearDisconnectGrace(frame.from);
    if (snapshot !== null && sameSnapshot(snapshot, next)) {
      // A repeated hello changes nothing the other sockets see. Only this one needs the lobby,
      // since the client counts itself seated on a `state` frame.
      this.send(ws, { kind: "state", snapshot });
      if (graceCleared) await this.scheduleMaintenance();
    } else {
      await this.commit(next);
    }
    await this.sendMatchOrRetireStale(ws);
  }

  /** The snapshot with `playerId` seated as `decision` says, or null when there is nothing to
      seat into (unreachable: /ws 404s before create, and the decision implies a snapshot). */
  private async seatedSnapshot(
    decision: Exclude<HelloDecision, "reject-full">,
    snapshot: LobbySnapshot | null,
    playerId: string,
    name: string,
    avatarSeed: string | null,
  ): Promise<LobbySnapshot | null> {
    switch (decision) {
      case "claim-host": {
        const code = await this.read(CODE_KEY, storedCodeSchema);
        return code === undefined
          ? null
          : createSnapshot(code, makePlayer(playerId, name, avatarSeed));
      }
      case "reseat-host":
        return snapshot === null ? null : reseatHost(snapshot, name, avatarSeed);
      case "seat-guest":
        return snapshot === null ? null : seatGuest(snapshot, playerId, name, avatarSeed);
    }
  }

  private async onIntent(
    ws: WebSocket,
    frame: ClientFrame<"intent">,
    snapshot: LobbySnapshot | null,
  ): Promise<void> {
    // The socket must be bound to the id it claims — a guest can't steer
    // the host's seat by forging `from`.
    if (snapshot === null || attachedPlayer(ws) !== frame.from) return;
    const slot = slotOf(snapshot, frame.from);
    if (slot === null) return;
    const next = applyIntent(snapshot, slot, frame.intent);
    if (next !== snapshot) await this.commit(next);
  }

  private async onAction(
    ws: WebSocket,
    frame: ClientFrame<"action">,
    snapshot: LobbySnapshot | null,
  ): Promise<void> {
    // A game action for the running match (P4). Authority is the socket's
    // OWN bound seat — never the client-claimed action.seat — so a client
    // can never act for its opponent. Only a seated player in an in-game
    // lobby with a persisted match may act.
    if (snapshot === null || snapshot.phase !== "in-game") return;
    const playerId = attachedPlayer(ws);
    if (playerId === null) return;
    const seat = matchSeatOf(snapshot, playerId);
    if (seat === null) return;
    const load = await this.loadOrMigrateMatch();
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
    // The clock stamps the appended log rows' elapsed time.
    const outcome = applyMatchAction(record, seat, frame.action, this.deps.now());
    if (!outcome.ok) {
      this.send(ws, { kind: "reject-action", reason: outcome.reason });
      return;
    }
    await this.match.put(outcome.record);
    this.broadcastMatch(outcome.record, snapshot, { logFrom: record.log.length });
  }

  private async onReject(
    ws: WebSocket,
    frame: ClientFrame<"reject">,
    snapshot: LobbySnapshot | null,
  ): Promise<void> {
    // The host's kick — the exact frame the BroadcastChannel host posted
    // at its guest. Valid only from the host's socket, aimed at the seated
    // guest. Relay it first (the sticky "you were removed"), then free the
    // seat and broadcast the now-waiting lobby.
    if (snapshot === null || snapshot.guest === null) return;
    if (attachedPlayer(ws) !== snapshot.host.id || frame.to !== snapshot.guest.id) return;
    this.sendToPlayer(frame.to, frame);
    await this.commit(removeGuest(snapshot));
  }

  private async onBye(
    ws: WebSocket,
    frame: ClientFrame<"bye">,
    snapshot: LobbySnapshot | null,
  ): Promise<void> {
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
    if (seat !== null) await this.concedeSeat(snapshot, seat, this.deps.now());
    // …and only THEN the lobby change, which in-game keeps the seat (so the
    // result the concede just broadcast stays on the winner's screen) and
    // otherwise frees a guest's / parks the host's (applyBye).
    await this.commit(applyBye(snapshot, slot));
  }

  private async onRematch(
    ws: WebSocket,
    frame: ClientFrame<"rematch">,
    snapshot: LobbySnapshot | null,
  ): Promise<void> {
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
    const load = await this.loadOrMigrateMatch();
    if (load.kind === "stale") return await this.retireStaleMatch();
    // No record, or a game still in progress: nothing to replay yet. Silent —
    // the client only offers the control on a finished board, so reaching this
    // means a crafted frame, and it changes nothing.
    if (load.kind !== "ok" || load.record.state.phase.kind !== "gameOver") return;
    // The loser picks who goes first next time; a tie goes back to the coin.
    const loser = rematchChooser(load.record.state);
    const loserId = loser === null ? null : playerIdOfSeat(snapshot, loser);
    if (loserId === null) await this.state.storage.delete(CHOOSER_KEY);
    else await this.state.storage.put(CHOOSER_KEY, loserId);
    // `commit` sees the lobby leave in-game (`abandonsMatch`) and drops
    // the match with it — which is precisely what makes the next handoff mint
    // a FRESH game rather than hitting its idempotency guard on this one.
    await this.commit(rematch(snapshot, slot));
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  async alarm(): Promise<void> {
    const now = this.deps.now();
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

      // A player who never came back forfeits. Judged on the final `next` so a match started on
      // this alarm is not judged by a previous deadline. The deadline is consumed whether or not
      // the forfeit lands, and the concede runs after the commit.
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
        // (one door onto the match), and skip rather than retire: retiring inside
        // the alarm would commit a second snapshot mid-flip.
        const load = await this.loadOrMigrateMatch();
        if (load.kind === "ok") this.broadcastMatch(load.record, next);
      }

      for (const seat of forfeiting) await this.concedeSeat(next, seat, now);
    }

    // 3) An empty lobby past its expiry evaporates entirely, freeing the code
    //    for a future POST /lobby to mint again.
    const cleanupAt = await this.read(CLEANUP_AT_KEY, storedCleanupAtSchema);
    if (sockets.length === 0 && cleanupAt !== undefined && now >= cleanupAt) {
      this.snapshot = null;
      this.match.forget();
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
          withPendingDisconnect(pending, playerId, this.deps.now() + DISCONNECT_GRACE_MS),
        );
      }
    }
    await this.scheduleMaintenance(remaining);
  }

  /**
   * Close sockets that stopped answering keepalives, which catches half-open connections that never
   * send a close. The auto-response timestamp is used because pings never wake the DO. Our own
   * `close()` does not fire `webSocketClose`, so `socketGone` is called explicitly.
   */
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
    if ((await this.loadOrMigrateMatch()).kind === "ok") return { ok: true };
    if (snapshot.guest === null) return { ok: false, reason: "The lobby needs two players." };
    // Each player's chosen deck, owner-scoped by the account their socket authenticated at /ws,
    // so a crafted `select-deck` naming someone else's deck resolves to nothing. Both are read at
    // once; the host's failure is reported first either way.
    const [hostDeck, guestDeck] = await Promise.all([
      this.deps.loadDeck(snapshot.host.deckId, this.userIdOf(snapshot.host.id)),
      this.deps.loadDeck(snapshot.guest.deckId, this.userIdOf(snapshot.guest.id)),
    ]);
    if (!hostDeck.ok) return { ok: false, reason: `${snapshot.host.name}: ${hostDeck.reason}.` };
    if (!guestDeck.ok) return { ok: false, reason: `${snapshot.guest.name}: ${guestDeck.reason}.` };
    // Storage enforces no construction rules, so `beginMatch` is the validator.
    const cardPool = await this.deps.loadPool([...hostDeck.ids, ...guestDeck.ids]);
    const seed = this.deps.randomSeed();
    // A player no longer seated (a new guest since the rematch) falls back to the coin.
    const chooserId = await this.read(CHOOSER_KEY, storedChooserSchema);
    const chooser = chooserId === undefined ? null : matchSeatOf(snapshot, chooserId);
    const begun = beginMatch({
      seed,
      hostDeck: hostDeck.ids,
      guestDeck: guestDeck.ids,
      cardPool,
      names: { host: snapshot.host.name, guest: snapshot.guest.name },
      formats: { host: hostDeck.format, guest: guestDeck.format },
      chooser,
      now: this.deps.now(),
    });
    if (!begun.ok) return begun;
    await this.match.put(begun.record);
    await this.state.storage.delete(CHOOSER_KEY);
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
    return (await this.read(SEAT_USERS_KEY, storedSeatUsersSchema)) ?? {};
  }

  /** Persist → broadcast → re-arm the alarm: the ONE path every snapshot
      change takes, so nothing is ever announced that didn't hit storage. */
  private async commit(next: LobbySnapshot): Promise<void> {
    const stamped = stampCountdown(next, this.deps.now());
    // A persisted match outlives EXACTLY the match it describes: when this commit
    // takes the lobby out of in-game (the host's kick, or `endMatch` retiring an
    // unreadable record — a mid-match `bye` no longer does, 3c-iv), drop the stale
    // GameState so a rematch in this same lobby mints a fresh one instead of
    // handoffToMatch's guard reusing the old (P4, online.md).
    const abandoned = abandonsMatch(this.snapshot ?? null, stamped);
    this.snapshot = stamped;
    await this.state.storage.put(SNAPSHOT_KEY, stamped);
    if (abandoned) await this.match.delete();
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
    if (sockets.length > 0) deadlines.push(this.deps.now() + LIVENESS_SWEEP_MS);

    if (sockets.length === 0) {
      let cleanupAt = await this.read(CLEANUP_AT_KEY, storedCleanupAtSchema);
      if (cleanupAt === undefined) {
        cleanupAt = this.deps.now() + EMPTY_LOBBY_TTL_MS;
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

  /** The value stored under `key`, or undefined when it is absent or does not parse. */
  private async read<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    return readStored(schema, await this.state.storage.get(key));
  }

  private async pendingDisconnects(): Promise<PendingDisconnect[]> {
    return (await this.read(PENDING_KEY, storedPendingSchema)) ?? [];
  }

  /**
   * Cancel the disconnect grace when a player returns, reporting whether one was pending. The
   * forfeit deadline is cleared by the reseat itself.
   */
  private async clearDisconnectGrace(playerId: string): Promise<boolean> {
    const pending = await this.pendingDisconnects();
    const next = withoutPendingDisconnect(pending, playerId);
    if (next.length === pending.length) return false;
    await this.state.storage.put(PENDING_KEY, next);
    return true;
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

  /**
   * Send each socket its own redacted view of the match, plus the shared seat-keyed log. `only`
   * targets one socket; otherwise all live sockets. Unseated non-spectators are skipped.
   * `logFrom` is the log length every socket already holds: a socket that takes log deltas gets
   * only the entries after it, and every other socket the whole log.
   */
  private broadcastMatch(
    record: MatchRecord,
    snapshot: LobbySnapshot,
    { only, logFrom }: { only?: WebSocket; logFrom?: number } = {},
  ): void {
    for (const ws of only === undefined ? this.liveSockets() : [only]) {
      const viewer = this.viewerOf(ws, snapshot);
      if (viewer === null) continue;
      this.send(ws, matchFrameFor(record, viewer, takesLogDeltas(ws) ? logFrom : undefined));
    }
  }

  /** Whose view a socket gets: its seat, a spectator's, or null for an unseated non-spectator. */
  private viewerOf(ws: WebSocket, snapshot: LobbySnapshot): MatchViewer | null {
    const playerId = attachedPlayer(ws);
    if (playerId === null) return isSpectating(ws) ? "spectator" : null;
    return matchSeatOf(snapshot, playerId);
  }

  /** A (re)connecting socket that lands in an already-in-game lobby gets the
      current match view at once — the `state` broadcast alone would leave it on
      the placeholder. No-op outside in-game or before the handoff wrote a
      record (the load-failure wedge, online.md). A record this deploy can't
      read is retired instead, which ends the match and resets the lobby. */
  private async sendMatchOrRetireStale(ws: WebSocket): Promise<void> {
    const snapshot = await this.loadSnapshot();
    if (snapshot === null || snapshot.phase !== "in-game") return;
    const load = await this.loadOrMigrateMatch();
    if (load.kind === "ok") this.broadcastMatch(load.record, snapshot, { only: ws });
    else if (load.kind === "stale") await this.retireStaleMatch();
  }

  /**
   * No seat for this socket. It is always rejected as full, and if a match is running it becomes a
   * spectator with the seatless board. Spectators have no playerId, so they cannot act, and anyone
   * with the lobby code can watch.
   */
  private async refuseSeat(ws: WebSocket, to: string): Promise<void> {
    this.send(ws, { kind: "reject", to, reason: "full" });
    const snapshot = await this.loadSnapshot();
    if (snapshot === null || snapshot.phase !== "in-game") return;
    const load = await this.loadOrMigrateMatch();
    if (load.kind !== "ok") return;
    attachSpectator(ws);
    // The snapshot as well as the board. `state` frames only go out on a lobby
    // COMMIT, and a match in progress may not produce one for many minutes — so a
    // spectator who joined mid-match would otherwise have no idea who is playing
    // (a browser run caught exactly this: their board read "Host vs Guest"). It
    // carries nothing private; it is the same frame both players already hold.
    this.send(ws, { kind: "state", snapshot });
    this.broadcastMatch(load.record, snapshot, { only: ws });
  }

  /**
   * Concede the running match for `seat`, used by the abandonment forfeit and by leaving mid-match.
   * It goes through the same path as a player's own concede, so the result is identical. Does
   * nothing if there is no readable record or the game is already over.
   */
  private async concedeSeat(snapshot: LobbySnapshot, seat: Seat, now: number): Promise<void> {
    const load = await this.loadOrMigrateMatch();
    if (load.kind !== "ok") return;
    const outcome = applyMatchAction(load.record, seat, { type: "concede" }, now);
    if (!outcome.ok) return;
    await this.match.put(outcome.record);
    this.broadcastMatch(outcome.record, snapshot, { logFrom: load.record.log.length });
  }

  /**
   * Read the persisted match: absent, usable, or unreadable by this build. Every match read
   * goes through here. An older migratable record is migrated and WRITTEN BACK before it is
   * returned, so this is not a pure read.
   */
  private async loadOrMigrateMatch(): Promise<MatchLoad> {
    // The D1 read opens the DO's input gate, which is why `loadMatchRecord` re-reads before
    // writing; the store's mirror makes that re-read see any write made meanwhile.
    return loadMatchRecord(this.match, (ids) => this.deps.loadPool(ids));
  }

  /**
   * Retire a match this deploy can't read: delete it, end the match so the lobby leaves in-game
   * with both seats un-readied, and tell both players. Uses `endMatch`, not
   * `resetAfterFailedStart`, because the latter leaves an in-game lobby in-game.
   */
  private async retireStaleMatch(): Promise<void> {
    await this.match.delete();
    const snapshot = await this.loadSnapshot();
    if (snapshot === null || snapshot.phase !== "in-game") return;
    await this.commit(endMatch(snapshot));
    this.broadcast({ kind: "match-error", reason: STALE_MATCH_REASON });
  }
}
