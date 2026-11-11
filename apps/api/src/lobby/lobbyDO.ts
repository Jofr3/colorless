// One Durable Object per lobby code. It owns the snapshot, applies intents through the snapshot
// transitions and broadcasts the result. Sockets use hibernation; the keepalive is answered by the
// auto-response without waking the instance.
// One alarm covers all deadlines: liveness sweeps, disconnect graces, countdown, match forfeits,
// and empty-lobby expiry.
// Other events can run only while the DO awaits D1: the upgrade's session read, the handoff's deck
// reads and the rematch's session check. A storage await keeps the input gate closed.
// Not a `DurableObject` subclass, so the module imports outside the workers runtime.

import {
  type Card,
  clipText,
  isSeatSecret,
  isValidLobbyCode,
  LOBBY_NAME_MAX,
  LOBBY_WS_CLOSED,
  LOBBY_WS_NOT_FOUND,
  LOBBY_WS_PING,
  LOBBY_WS_PONG,
  type LobbyClientMessage,
  type LobbyServerMessage,
  publicSeatId,
} from "@colorless/schema";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import type { Env } from "../env";
import { avatarSeedFrom } from "../auth/avatar";
import { resolveAccountFromCookie, type SessionAccount } from "../auth/resolveSession";
import { describeError } from "../http/errors";
import {
  type LogFields,
  logError,
  logErrorThrottledBy,
  logEvent,
  logEventThrottled,
  logEventThrottledBy,
  logInfo,
} from "../http/log";
import {
  attachAccount,
  attachConnectedAt,
  attachedConnectedAt,
  attachedDisplayName,
  attachedPlayer,
  attachedSession,
  attachedUserId,
  attachLogDeltas,
  attachOverflow,
  attachPlayer,
  attachSpectator,
  isOverflow,
  isSpectating,
  takesLogDeltas,
} from "./attachment";
import { loadCardPool } from "./cardPool";
import { type DeckOwner, type LoadDeckResult, loadPlayerDeck } from "./deckLoad";
import { lobbyDisplayName } from "./displayName";
import { DO_CREATE_PATH, DO_WS_PATH, isWebSocketUpgrade, LOBBY_CODE_HEADER } from "./doProtocol";
import {
  ABANDON_GRACE_MS,
  ACTIVITY_STAMP_MS,
  abandonsMatch,
  applyBye,
  countdownEndsAt,
  endMatch,
  DISCONNECT_GRACE_MS,
  EMPTY_LOBBY_TTL_MS,
  FRAME_MAX_CHARS,
  type FrameBudget,
  forfeitDeadlines,
  type HelloDecision,
  helloDecision,
  INACTIVE_LOBBY_MS,
  isLegacySnapshot,
  livenessSweepMs,
  LOBBY_SOCKET_CAP,
  LOBBY_SOCKET_HARD_CAP,
  OVERFLOW_HELLO_MS,
  OVERFLOW_SOCKETS_MAX,
  parseClientMessage,
  type PendingDisconnect,
  readSnapshot,
  readStored,
  rematch,
  reseatHost,
  resetAfterFailedStart,
  sameSnapshot,
  seatClaimAllowed,
  seatedUsers,
  setSeatConnected,
  slotOf,
  socketIsSilent,
  spendFrame,
  splitDuePending,
  stampCountdown,
  storedChooserSchema,
  storedCleanupAtSchema,
  storedCodeSchema,
  storedPendingSchema,
  storedSeatUsersSchema,
  storedTimeSchema,
  withForfeitAt,
  withoutPendingDisconnect,
  withPendingDisconnect,
} from "./logic";
import {
  applyMatchAction,
  type BeginMatchResult,
  beginMatch,
  freshMatchRng,
  loadMatchRecord,
  type MatchLoad,
  type MatchRecord,
  type MatchRng,
  type MatchSlot,
  type MatchViewer,
  matchFrameFor,
  matchSeatOf,
  playerIdOfSeat,
  SEAT_OF_SLOT,
  type Seat,
  rematchChooser,
} from "./match";
import { MatchStore } from "./matchStore";
import { liveSessionIds } from "./sessionCheck";
import { cryptoShuffle } from "./shuffle";
import {
  applyIntent,
  bothReady,
  createLobbyState,
  type LobbySeat,
  type LobbyState,
  makeSeat,
  removeGuest,
  seatGuest,
  wireSnapshot,
} from "./snapshot";

// Storage keys. `created` marks that POST /lobby claimed this code — a socket
// for a code that was never created (or has expired) is accepted and closed at
// once with LOBBY_WS_NOT_FOUND, which the client shows as "not found".
const CREATED_KEY = "created";
const CODE_KEY = "code";
const SNAPSHOT_KEY = "snapshot";
// When the empty lobby is wiped, written when its last socket leaves. A lobby no socket has said
// hello in has none: its expiry is derived from `created`, so a create writes two keys.
const CLEANUP_AT_KEY = "cleanupAt";
// The last commit or accepted action, epoch ms, written at most every ACTIVITY_STAMP_MS; absent
// reads as `created`. The inactivity ceiling (INACTIVE_LOBBY_MS) is judged from it.
const ACTIVE_AT_KEY = "activeAt";
const PENDING_KEY = "pendingDisconnects";
// The public seat id of who lost the last game in this lobby: they choose the rematch's
// play order (`settleFirstPlayer`). Consumed by the next successful handoff.
const CHOOSER_KEY = "nextChooser";
// Public seat id → the account it's bound to. Written the first time an
// authenticated socket claims a seat; a later hello for that seat must present the SAME account
// (seatClaimAllowed) as well as the seat's secret, or it's refused. DO-only, never broadcast.
// Cleared with the rest of storage when the lobby empties.
// Every id the DO keeps (here, the snapshot, the pending disconnects, the chooser and each
// socket's attachment) is a PUBLIC seat id. The secret a hello presents is hashed to one at once
// and never stored.
const SEAT_USERS_KEY = "seatUsers";

/** One validated client frame of the given kind. */
type ClientFrame<Kind extends LobbyClientMessage["kind"]> = Extract<
  LobbyClientMessage,
  { kind: Kind }
>;

/**
 * The answer to a socket for a code that names no lobby: the upgrade is accepted and the socket
 * closed at once with `LOBBY_WS_NOT_FOUND`, the client's one definite "not found". A refused upgrade
 * looks to a browser like any failed connection. The socket is accepted outside hibernation, so the
 * lobby never counts or sweeps it, and nothing is stored: a guessed code still costs one wake.
 */
function noSuchLobby(): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].close(LOBBY_WS_NOT_FOUND, "no such lobby");
  return new Response(null, { status: 101, webSocket: pair[0] });
}

/** Whether the match handoff started a real game, or why it couldn't — a
    failed deck resolution surfaces `reason` to the players
    instead of wedging the lobby in-game with no match. `superseded`: the lobby
    changed while the handoff awaited D1, so it wrote nothing and the alarm
    starts its pass over. */
type HandoffResult =
  | { kind: "started" }
  | { kind: "failed"; reason: string }
  | { kind: "superseded" };

/** What the handoff reads for one seat: the chosen deck, and the account and session to read it as. */
type DeckRequest = { deckId: string | null; owner: DeckOwner | null };

/** Both seats' decks as D1 returned them, and the catalog cards they name. */
type HandoffDecks = { host: LoadDeckResult; guest: LoadDeckResult; pool: Record<string, Card> };

/** The handoff's D1 reads for a pair of requests. One alarm pass memoizes the last pair, so a
    retry with the same decks and accounts awaits nothing. */
type ReadDecks = (host: DeckRequest, guest: DeckRequest) => Promise<HandoffDecks>;

/** How many times one alarm pass tries the handoff when the lobby keeps changing under it. Past
    this, the pass commits nothing and the rescheduled alarm, already due, tries again at once. */
const HANDOFF_ATTEMPTS = 3;

/** How long the alarm waits after a pass that threw. A deadline already past would otherwise
    re-arm it to fire at once, and a throw that repeats would run back to back. */
export const ALARM_RETRY_MS = 5_000;

/** What both players are told when the handoff could not reach D1. */
const DECK_LOAD_FAILED_REASON = "Couldn't load the decks. Ready up to try again.";

/** What both players are told when starting the match threw. */
const MATCH_START_FAILED_REASON = "This match couldn't start. Ready up to try again.";

/** What a rematch's requester is told when their own session has ended. */
const REMATCH_SIGNED_OUT_REASON = "You're signed out. Sign in again to play another game.";

/** What a rematch's requester is told when their opponent's session has ended. */
const REMATCH_OPPONENT_SIGNED_OUT_REASON = "Your opponent is signed out, so there's no rematch.";

/** What both players are told when a match is retired because this deploy can't
    read its persisted record (a server update landed mid-match). Phrased as the
    recoverable, no-fault event it is — the lobby is already back at `selecting`
    with both seats un-readied, so the next step really is just to ready up. */
const STALE_MATCH_REASON =
  "This match ended because the server was updated. Pick your decks and ready up to play again.";

/** Everything the lobby reads from outside its own storage and sockets: the clock, the match
    seed and deck pre-shuffle, and the D1 lookups. */
export interface LobbyDeps {
  now(): number;
  /** A new match's RNG: a ChaCha20 state, never a numeric seed. */
  randomSeed(): MatchRng;
  /** A deck list in an order that says nothing about the list, before the engine mints a uid per
      position in it (`cryptoShuffle`). */
  shuffleDeck(ids: readonly string[]): string[];
  /** The account a forwarded `Cookie` header's session belongs to, or null. */
  resolveAccount(cookie: string | null): Promise<SessionAccount | null>;
  /** A player's chosen deck as flat card ids, owner-scoped to `owner`, whose session must still
      live. */
  loadDeck(deckId: string | null, owner: DeckOwner | null): Promise<LoadDeckResult>;
  /** The catalog cards for `ids`, keyed by id; missing ids are absent. */
  loadPool(ids: readonly string[]): Promise<Record<string, Card>>;
  /** The ids of the `owners`' sessions that still live for their account (`liveSessionIds`). */
  liveSessions(owners: readonly DeckOwner[]): Promise<Set<string>>;
}

/** The production wiring: the system clock, a CSPRNG-keyed match RNG and shuffle, and the
    Worker's D1 binding. */
export function lobbyDepsFromEnv(env: Env): LobbyDeps {
  const db = () => drizzle(env.DB);
  return {
    now: () => Date.now(),
    randomSeed: () => freshMatchRng(),
    shuffleDeck: (ids) => cryptoShuffle(ids),
    resolveAccount: (cookie) => resolveAccountFromCookie(db(), cookie),
    loadDeck: (deckId, owner) => loadPlayerDeck(db(), deckId, owner),
    loadPool: (ids) => loadCardPool(db(), ids),
    liveSessions: (owners) => liveSessionIds(db(), owners),
  };
}

export class LobbyDO {
  private readonly state: DurableObjectState;
  private readonly deps: LobbyDeps;
  /** In-memory mirror of SNAPSHOT_KEY; undefined = not read since last wake. */
  private snapshot: LobbyState | null | undefined;
  /** In-memory mirror of SEAT_USERS_KEY, read on every frame; undefined = not read since last wake. */
  private seatUsersMirror: Record<string, string> | undefined;
  /** The authoritative match: the engine GameState, seed and log, written when the countdown
      flips the lobby to in-game and on every accepted action. */
  private readonly match: MatchStore;
  /** The alarm this instance last set (null: none, or the one that fired), so an unchanged
      reschedule writes nothing; undefined = not known since the last wake. */
  private alarmAt: number | null | undefined;
  /** In-memory mirror of the activity stamp (ACTIVE_AT_KEY, else CREATED_KEY); undefined = not
      read since the last wake. */
  private activeAt: number | undefined;
  /** Each socket's frame budget. In memory only: a socket sending enough to matter keeps the
      instance awake, and a hibernation that resets it costs nothing. */
  private readonly frameBudgets = new WeakMap<WebSocket, FrameBudget>();
  /** How many frames each socket has sent since this instance woke, for the abuse close's log
      line. In memory only, like the budget. */
  private readonly frameCounts = new WeakMap<WebSocket, number>();
  /** Sockets this instance closed, whose frames still in flight are dropped unread. */
  private readonly closing = new WeakSet<WebSocket>();
  /** The earliest the alarm may fire after a pass that threw, until a pass succeeds. In memory
      only: a fresh instance has no failure to wait out. */
  private retryNotBefore: number | null = null;

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
      // Arm the expiry now, so a minted-but-never-entered lobby still evaporates. It is derived
      // from `created`, so this writes only the alarm.
      await this.scheduleMaintenance();
      return Response.json({ code }, { status: 201 });
    }

    if (request.method === "GET" && path === DO_WS_PATH) {
      if (!isWebSocketUpgrade(request.headers.get("Upgrade"))) {
        return Response.json({ error: "expected a websocket upgrade" }, { status: 426 });
      }
      // A lobby stored before the seat secret split is wiped and answered like an expired one.
      if (
        (await this.retireLegacyLobby()) ||
        (await this.state.storage.get(CREATED_KEY)) === undefined
      ) {
        return noSuchLobby();
      }
      // The flood guard, before the D1 session read: past it even a seated player is refused.
      // Only a seat-holding account's sockets get past LOBBY_SOCKET_CAP to reach it.
      if (this.members().length >= LOBBY_SOCKET_HARD_CAP) return await this.refuseUpgrade();
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      attachConnectedAt(pair[1], this.deps.now());
      // Authenticate the connection from the forwarded `session` cookie: the
      // resolved account rides on the socket so the match
      // handoff can owner-scope this player's deck read. Anonymous (no/expired
      // cookie) leaves it null — the lobby still works, but that socket can't
      // start a match with a saved deck. Only the DO ever reads it. The account's name is read in
      // the same query, so a rename shows from the next connection on.
      let account: SessionAccount | null;
      try {
        account = await this.deps.resolveAccount(request.headers.get("Cookie"));
      } catch (error) {
        // D1 is unreachable. Refused rather than admitted as anonymous, which would quietly cost a
        // signed-in player their decks; the client retries. The server half is already accepted
        // (see above), so it is closed here or it would hold an empty lobby open, unanswered.
        try {
          pair[1].close(1011, "session lookup failed");
        } catch {
          // Already closed.
        }
        await this.log(
          "ws_refused",
          { cause: "session_lookup", error: describeError(error) },
          true,
        );
        return Response.json({ error: "lobby unavailable, try again" }, { status: 503 });
      }
      if (account !== null) {
        attachAccount(pair[1], {
          userId: account.userId,
          sessionId: account.sessionId,
          displayName: lobbyDisplayName(account.displayName),
        });
      }
      if (!(await this.admit(pair[1], account))) return await this.refuseUpgrade(pair[1]);
      // A live socket parks any pending empty-lobby expiry.
      await this.scheduleMaintenance();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Every frame, valid or not, spends from the socket's budget before it is parsed.
    if (!(await this.withinBudget(ws, message))) return;
    if (typeof message !== "string") return;
    const frame = parseClientMessage(message);
    if (frame === null) return; // §3.6: anything that doesn't validate is dropped
    // A throw here (a storage write refused: the day's quota spent, a value too large) escapes to
    // the runtime, whose exception event names no lobby. One line under the lobby's code first,
    // then the same error, so the invocation still fails as it would have.
    try {
      if (isOverflow(ws)) return await this.turnAway(ws, frame);
      await this.dispatch(ws, frame, await this.loadSnapshot());
    } catch (error) {
      await this.frameFailed(frame.kind, error);
      throw error;
    }
  }

  private async dispatch(
    ws: WebSocket,
    frame: LobbyClientMessage,
    snapshot: LobbyState | null,
  ): Promise<void> {
    switch (frame.kind) {
      case "hello":
        return await this.onHello(ws, frame, snapshot);
      case "intent":
        return await this.onIntent(ws, frame, snapshot);
      case "action":
        return await this.onAction(ws, frame, snapshot);
      case "reject":
        return await this.onReject(ws, frame, snapshot);
      case "bye":
        return await this.onBye(ws, frame, snapshot);
      case "rematch":
        return await this.onRematch(ws, frame, snapshot);
    }
  }

  /** The `frame_failed` line for a frame whose handling threw, at error level and throttled per
      frame kind (a client re-sends its hello while the failure lasts). It never throws itself, so
      the caller rethrows the original error. */
  private async frameFailed(frame: LobbyClientMessage["kind"], error: unknown): Promise<void> {
    try {
      const line = await this.failureFields({ frame, error: describeError(error) });
      logErrorThrottledBy(frame, "lobby", "frame_failed", line);
    } catch {
      // Nothing may replace the error being rethrown.
    }
  }

  private async onHello(
    ws: WebSocket,
    frame: ClientFrame<"hello">,
    snapshot: LobbyState | null,
  ): Promise<void> {
    attachLogDeltas(ws, frame.logDeltas === true);
    // The hello's secret names the seat through its hash: a public id read off a snapshot is
    // not a secret, and the secret of the seat it names is known only to that seat's client. A
    // `from` that is no secret at all comes from a client older than the split, which is told the
    // lobby is full: it cannot hold a seat here, and a reload brings the current client.
    if (!isSeatSecret(frame.from)) {
      await this.log(
        "hello_refused",
        { cause: "credential", signedIn: attachedUserId(ws) !== null, spectating: false },
        true,
      );
      this.send(ws, { kind: "reject", to: frame.from, reason: "full" });
      return;
    }
    const seatId = publicSeatId(frame.from);
    const decision = helloDecision(snapshot, seatId);
    if (decision === "reject-full") return await this.refuseSeat(ws, seatId, "full");
    // Seat authentication: once a seat is claimed by an account, only that account may
    // re-adopt it, even with the seat's secret. An unbound (anonymous) seat is unaffected.
    const seatUsers = await this.seatUsers();
    const boundUserId = seatUsers[seatId] ?? null;
    const userId = attachedUserId(ws);
    if (!seatClaimAllowed(boundUserId, userId)) return await this.refuseSeat(ws, seatId, "bound");
    // The seat's name comes from the account, not the frame. Anonymous sockets keep their
    // announced name. Both are cleaned as the wire cleans names, as every stored name is: an
    // opponent's client prints it.
    const name = clipText(attachedDisplayName(ws) ?? frame.name, LOBBY_NAME_MAX);
    // …and the face, from the same account. Derived, not stored and
    // not read: it costs nothing beyond the userId the socket already holds.
    const avatarSeed = avatarSeedFrom(userId);
    const next = await this.seatedSnapshot(decision, snapshot, seatId, name, avatarSeed);
    if (next === null) return;
    // Bind the seat to the account on its FIRST authenticated claim, keeping only the bindings of
    // the ids still seated once this hello lands.
    const binds = boundUserId === null && userId !== null;
    if (binds) {
      const bound = seatedUsers({ ...seatUsers, [seatId]: userId }, next);
      await this.state.storage.put(SEAT_USERS_KEY, bound);
      this.seatUsersMirror = bound;
    }
    attachPlayer(ws, seatId);
    // Any other socket on the now-bound seat attached while it was unbound, with the seat's secret
    // but not its account. It is closed rather than left acting for the seat; a reload of the
    // account's own reconnects and is let back in.
    if (binds) await this.evictFromSeat(seatId, userId, ws);
    const graceCleared = await this.clearDisconnectGrace(seatId);
    // A player arriving or coming back counts as activity, so the reconnects after a deploy do not
    // leave a lobby older than the ceiling, with no stamp yet, to be closed by the next sweep.
    await this.touchActivity();
    if (snapshot !== null && sameSnapshot(snapshot, next)) {
      // A repeated hello changes nothing the other sockets see. Only this one needs the lobby,
      // since the client counts itself seated on a `state` frame.
      this.send(ws, { kind: "state", snapshot: wireSnapshot(snapshot) });
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
    snapshot: LobbyState | null,
    playerId: string,
    name: string,
    avatarSeed: string | null,
  ): Promise<LobbyState | null> {
    switch (decision) {
      case "claim-host": {
        const code = await this.read(CODE_KEY, storedCodeSchema);
        return code === undefined
          ? null
          : createLobbyState(code, makeSeat(playerId, name, avatarSeed));
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
    snapshot: LobbyState | null,
  ): Promise<void> {
    // The socket must own the id it claims — a guest can't steer
    // the host's seat by forging `from`.
    if (snapshot === null || !(await this.ownsSeat(ws, frame.from))) return;
    const slot = slotOf(snapshot, frame.from);
    if (slot === null) return;
    // A repeated intent changes nothing, and `commit` then writes and sends nothing.
    await this.commit(applyIntent(snapshot, slot, frame.intent));
  }

  private async onAction(
    ws: WebSocket,
    frame: ClientFrame<"action">,
    snapshot: LobbyState | null,
  ): Promise<void> {
    // A game action for the running match. Authority is the socket's
    // OWN bound seat — never the client-claimed action.seat — so a client
    // can never act for its opponent. Only a seated player in an in-game
    // lobby with a persisted match may act.
    const playerId = attachedPlayer(ws);
    if (playerId === null || this.seatInMatch(snapshot, playerId) === null) return;
    if (!(await this.ownsSeat(ws, playerId))) return;
    const load = await this.loadOrMigrateMatch();
    // A record this deploy can't read is retired here rather than silently
    // swallowing every action for the rest of the lobby's life.
    if (load.kind === "stale") return await this.retireStaleMatch();
    if (load.kind === "none") return;
    // The match read awaits only storage, so no other event ran meanwhile. The seat is checked
    // again anyway, as a cheap guard.
    const current = await this.loadSnapshot();
    const seat = this.seatInMatch(current, playerId);
    if (current === null || seat === null || !(await this.ownsSeat(ws, playerId))) return;
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
      // A throw is refused like any move, and logged at error level, since the engine is meant
      // to be total (throttled: a client can repeat the frame). `type` passed the allowlist to
      // reach the engine, so it is one of a fixed set of names, and each has its own throttle: a
      // second engine bug is not hidden behind the first.
      if ("thrown" in outcome) {
        const error = describeError(outcome.thrown);
        const type = frame.action.type;
        logErrorThrottledBy(type, "lobby", "action_threw", await this.fields({ type, error }));
      }
      this.send(ws, { kind: "reject-action", reason: outcome.reason });
      return;
    }
    // An accepted action that changed nothing (a Pokémon dropped back where it was) leaves every
    // view as it is, so it is neither written nor sent.
    const { state, log } = outcome.record;
    if (state === record.state && log.length === record.log.length) return;
    await this.match.put(outcome.record);
    await this.matchEnded(record, outcome.record);
    await this.touchActivity();
    // A trimmed log no longer continues the one every socket holds, so it goes out whole.
    const logFrom = outcome.logTrimmed ? undefined : record.log.length;
    await this.broadcastMatch(outcome.record, current, { logFrom });
  }

  /** The match seat `playerId` acts from, or null when the lobby is not in-game or does not seat
      them. */
  private seatInMatch(snapshot: LobbyState | null, playerId: string): Seat | null {
    return snapshot === null || snapshot.phase !== "in-game"
      ? null
      : matchSeatOf(snapshot, playerId);
  }

  private async onReject(
    ws: WebSocket,
    frame: ClientFrame<"reject">,
    snapshot: LobbyState | null,
  ): Promise<void> {
    // The host's kick — the exact frame the BroadcastChannel host posted
    // at its guest. Valid only from the host's socket, aimed at the seated
    // guest. Relay it first (the sticky "you were removed"), then free the
    // seat and broadcast the now-waiting lobby.
    if (snapshot === null || snapshot.guest === null) return;
    if (frame.to !== snapshot.guest.id || !(await this.ownsSeat(ws, snapshot.host.id))) return;
    this.sendToPlayer(frame.to, frame);
    await this.commit(removeGuest(snapshot));
  }

  private async onBye(
    ws: WebSocket,
    frame: ClientFrame<"bye">,
    snapshot: LobbyState | null,
  ): Promise<void> {
    if (snapshot === null || !(await this.ownsSeat(ws, frame.from))) return;
    const slot = slotOf(snapshot, frame.from);
    if (slot === null) return;
    // Walking out of a RUNNING match FORFEITS it instead of
    // voiding it: the opponent gets a real result — the same one the Concede
    // button and the 90s abandonment timer produce — down the same
    // applyMatchAction → persist → broadcastMatch path. A no-op once the game
    // is over (the engine refuses a concede then), which is what makes a
    // double `bye` — an explicit leave() plus the unmount's — harmless.
    const seat = this.seatInMatch(snapshot, frame.from);
    if (seat !== null) await this.concedeSeat(snapshot, seat, this.deps.now(), "left");
    // …and only THEN the lobby change, which in-game keeps the seat (so the
    // result the concede just broadcast stays on the winner's screen) and
    // otherwise frees a guest's / parks the host's (applyBye). The concede awaits only storage,
    // but the change still applies to the lobby as it is now, as a cheap guard.
    const current = await this.loadSnapshot();
    const currentSlot = current === null ? null : slotOf(current, frame.from);
    if (current === null || currentSlot === null) return;
    await this.commit(applyBye(current, currentSlot));
  }

  private async onRematch(
    ws: WebSocket,
    frame: ClientFrame<"rematch">,
    snapshot: LobbyState | null,
  ): Promise<void> {
    // Play again in this same lobby — since a `bye` mid-match forfeits but keeps
    // the seat, an in-game lobby otherwise has no route back except the host's
    // kick. Legality is the SERVER's to judge, which is why this is a
    // frame and not a seat `intent`: only the DO can see whether the match it
    // holds has finished, and a rematch mid-game must be refused (conceding is
    // how you leave a live one).
    if (snapshot?.phase === "selecting") return await this.onLateRematch(ws, frame, snapshot);
    if (snapshot === null || snapshot.phase !== "in-game") return;
    if (!(await this.ownsSeat(ws, frame.from))) return;
    const slot = slotOf(snapshot, frame.from);
    if (slot === null) return;
    const load = await this.loadOrMigrateMatch();
    if (load.kind === "stale") return await this.retireStaleMatch();
    // No record, or a game still in progress: nothing to replay yet. Silent —
    // the client only offers the control on a finished board, so reaching this
    // means a crafted frame, and it changes nothing.
    if (load.kind !== "ok" || load.record.state.phase.kind !== "gameOver") return;
    if (!(await this.seatSessionsLive(ws, snapshot))) return;
    // The session check may have awaited D1: the rematch starts from the lobby as it is now, not
    // as it was before, or it would undo whatever happened meanwhile. The other seat's rematch may
    // have landed then, which makes this one its acceptance.
    const current = await this.loadSnapshot();
    if (current?.phase === "selecting") return await this.acceptRematch(ws, frame.from, current);
    if (current === null || current.phase !== "in-game") return;
    const currentSlot = slotOf(current, frame.from);
    if (currentSlot === null || !(await this.ownsSeat(ws, frame.from))) return;
    // The loser picks who goes first next time; a tie goes back to the coin.
    const loser = rematchChooser(load.record.state);
    const loserId = loser === null ? null : playerIdOfSeat(current, loser);
    if (loserId === null) await this.state.storage.delete(CHOOSER_KEY);
    else await this.state.storage.put(CHOOSER_KEY, loserId);
    // `commit` sees the lobby leave in-game (`abandonsMatch`) and drops
    // the match with it — which is precisely what makes the next handoff mint
    // a FRESH game rather than hitting its idempotency guard on this one.
    await this.commit(rematch(current, currentSlot));
  }

  /** A rematch that finds the lobby already out of the game: the other seat's rematch got there
      first (both pressed within a round trip), so this one is the acceptance and readies its
      sender, after the same session check a rematch makes. An already ready seat costs no read. */
  private async onLateRematch(
    ws: WebSocket,
    frame: ClientFrame<"rematch">,
    snapshot: LobbyState,
  ): Promise<void> {
    if (!(await this.ownsSeat(ws, frame.from))) return;
    const slot = slotOf(snapshot, frame.from);
    if (slot === null || snapshot[slot]?.ready) return;
    if (!(await this.seatSessionsLive(ws, snapshot))) return;
    // The session check may have awaited D1: ready the seat in the lobby as it is now.
    const current = await this.loadSnapshot();
    if (current?.phase === "selecting") await this.acceptRematch(ws, frame.from, current);
  }

  /** Ready `playerId`'s seat, as its readying intent would, in a lobby another seat's rematch
      took out of the game. */
  private async acceptRematch(ws: WebSocket, playerId: string, current: LobbyState): Promise<void> {
    const slot = slotOf(current, playerId);
    if (slot === null || !(await this.ownsSeat(ws, playerId))) return;
    await this.commit(applyIntent(current, slot, { type: "set-ready", ready: true }));
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  async alarm(): Promise<void> {
    // The alarm that woke us is spent, so the next schedule has to set one whatever it was.
    this.alarmAt = null;
    const now = this.deps.now();
    let wiped = false;
    try {
      wiped = (await this.retireLegacyLobby()) || (await this.maintain(now));
      this.retryNotBefore = null;
    } catch (error) {
      // Logged and not rethrown: the `finally` re-arms the alarm, and that is the retry. The
      // runtime's own retry on top would run the same pass twice.
      this.retryNotBefore = this.deps.now() + ALARM_RETRY_MS;
      logError("lobby", "alarm_failed", await this.failureFields({ error: describeError(error) }));
    } finally {
      // Always, so one failed pass cannot leave the liveness sweep, the countdown and the
      // forfeit clocks with nothing to wake them.
      if (!wiped) await this.scheduleMaintenance();
    }
  }

  /** One alarm pass; true when it wiped the lobby, which leaves nothing to schedule. */
  private async maintain(now: number): Promise<boolean> {
    // 0) Sockets that stopped answering keepalives. FIRST, so a
    //    connection dropped here is judged by everything below on this same pass
    //    rather than waiting another sweep.
    await this.sweepSilentSockets(now);
    await this.graceOrphanedSeats(now);

    // A lobby nobody has changed for INACTIVE_LOBBY_MS is closed for good: every socket is
    // told so, and the lobby is wiped, since a client would otherwise reconnect into it at once.
    const sockets = this.liveSockets();
    if (sockets.length > 0 && now - (await this.lastActivity()) >= INACTIVE_LOBBY_MS) {
      for (const ws of sockets) {
        try {
          ws.close(LOBBY_WS_CLOSED, "lobby closed after an hour without play");
        } catch {
          // Already gone.
        }
      }
      await this.wipe(now, "inactive", sockets.length);
      return true;
    }

    // 1) and 2), retried while the handoff finds the lobby changed under it. A retry with the
    //    same decks and accounts reuses the D1 reads, so it awaits nothing and a cosmetic change
    //    (a rename) cannot overtake it again; the bound covers changes that do re-read.
    let reads: { key: string; decks: Promise<HandoffDecks> } | null = null;
    const readDecks: ReadDecks = (host, guest) => {
      const key = JSON.stringify([host, guest]);
      if (reads?.key !== key) reads = { key, decks: this.readHandoffDecks(host, guest) };
      return reads.decks;
    };
    for (let attempt = 1; !(await this.advanceLobby(now, readDecks)); attempt++) {
      if (attempt === HANDOFF_ATTEMPTS) {
        await this.log("handoff_deferred", { attempts: attempt });
        break;
      }
    }

    // 3) An empty lobby past its expiry evaporates entirely, freeing the code
    //    for a future POST /lobby to mint again.
    if (this.liveSockets().length > 0) return false;
    const cleanupAt = await this.emptyLobbyExpiry();
    if (cleanupAt === undefined || now < cleanupAt) return false;
    await this.wipe(now, "empty");
    return true;
  }

  /** Delete every key of the lobby, freeing its code, and any alarm set since this one fired.
      `sockets` is how many open sockets the wipe closed (4000). */
  private async wipe(
    now: number,
    cause: "empty" | "inactive" | "legacy",
    sockets = 0,
  ): Promise<void> {
    const created = await this.state.storage.get(CREATED_KEY);
    await this.info("lobby_wiped", {
      cause,
      sockets,
      ageMs: typeof created === "number" ? now - created : null,
      inGame: (await this.loadSnapshot())?.phase === "in-game",
    });
    this.snapshot = null;
    this.seatUsersMirror = undefined;
    this.activeAt = undefined;
    this.match.forget();
    await this.state.storage.deleteAll();
    // deleteAll leaves alarms in place. The one that woke us is spent, so only an alarm a commit
    // set during this pass is left to clear.
    if (this.alarmAt !== null) await this.state.storage.deleteAlarm();
    this.alarmAt = null;
  }

  /**
   * Wipe a lobby stored before the seat secret split, true when it did. Its seats are named
   * by ids every snapshot broadcast, and no client holds a secret that hashes to them, so nobody
   * could reclaim them: it is closed like an inactive lobby, and the clients, reloaded onto this
   * deploy's web build, start a new one. Checked once per wake, before the snapshot is first read;
   * a lobby this deploy wrote is never legacy.
   */
  private async retireLegacyLobby(): Promise<boolean> {
    if (this.snapshot !== undefined) return false;
    const raw = await this.state.storage.get(SNAPSHOT_KEY);
    if (!isLegacySnapshot(raw)) {
      this.snapshot = readSnapshot(raw);
      return false;
    }
    const sockets = this.liveSockets();
    for (const ws of sockets) {
      try {
        ws.close(LOBBY_WS_CLOSED, "lobby closed by a server update");
      } catch {
        // Already gone.
      }
    }
    await this.wipe(this.deps.now(), "legacy", sockets.length);
    return true;
  }

  /**
   * When an empty lobby is wiped: the stored expiry, set when its last socket left, or for a lobby
   * nobody has said hello in, `created` plus the TTL, derived so a create writes no expiry key.
   * Undefined for a lobby already wiped.
   */
  private async emptyLobbyExpiry(): Promise<number | undefined> {
    const stored = await this.read(CLEANUP_AT_KEY, storedCleanupAtSchema);
    if (stored !== undefined) return stored;
    if ((await this.loadSnapshot()) !== null) return undefined;
    const created = await this.read(CREATED_KEY, storedTimeSchema);
    return created === undefined ? undefined : created + EMPTY_LOBBY_TTL_MS;
  }

  /** When the lobby last saw a commit, an accepted action or a seated hello, to within
      ACTIVITY_STAMP_MS. */
  private async lastActivity(): Promise<number> {
    this.activeAt ??=
      (await this.read(ACTIVE_AT_KEY, storedTimeSchema)) ??
      (await this.read(CREATED_KEY, storedTimeSchema)) ??
      this.deps.now();
    return this.activeAt;
  }

  /** Record a commit, an accepted action or a seated hello, writing the stamp only once it is
      ACTIVITY_STAMP_MS stale, so a busy lobby pays one row every few minutes for it. */
  private async touchActivity(): Promise<void> {
    const now = this.deps.now();
    if (now - (await this.lastActivity()) < ACTIVITY_STAMP_MS) return;
    await this.state.storage.put(ACTIVE_AT_KEY, now);
    this.activeAt = now;
  }

  /**
   * Steps 1 and 2 of the alarm on the lobby as it is now: lapsed disconnect graces, the countdown's
   * handoff, and due forfeits, committed together. False when the handoff was superseded: nothing
   * was written, and the caller runs the step again on the changed lobby.
   */
  private async advanceLobby(now: number, readDecks: ReadDecks): Promise<boolean> {
    const sockets = this.liveSockets();
    const hasSocket = (playerId: string) =>
      sockets.some((socket) => attachedPlayer(socket) === playerId);

    // 1) Disconnect graces that ran out → seats whose player never returned
    //    drop to disconnected (unreadying them; the phase re-derives).
    const { due } = splitDuePending(await this.pendingDisconnects(), now);

    const snapshot = await this.loadSnapshot();
    if (snapshot === null) {
      await this.consumeDuePending(due, now);
      return true;
    }
    let next = snapshot;
    // A seat whose grace ran out drops to disconnected — and, if a MATCH is
    // running, starts its much longer forfeit clock, on the snapshot, in the SAME
    // write. Arming it here rather than at socket-close is deliberate: this is
    // the first moment we know they did not
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
        // Instantiate the authoritative engine game BEFORE flipping to
        // in-game, so a client that sees "in-game" can rely on the match
        // existing (the match frame reads + redacts it) — and only flip if it
        // actually started. A chosen deck that won't resolve (not signed in /
        // not the player's / malformed) must NOT wedge the lobby
        // in-game with no match: drop both back to selecting and surface why.
        const inGame: LobbyState = { ...next, phase: "in-game" };
        const handoff = await this.handoffToMatch(inGame, snapshot, readDecks);
        if (handoff.kind === "superseded") return false;
        if (handoff.kind === "started") {
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

    // The graces judged above are consumed in the same breath as the snapshot they changed, and
    // before it, since the commit schedules the next alarm from what is still pending.
    await this.consumeDuePending(due, now);
    await this.commit(next);

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
      if (load.kind === "ok") await this.broadcastMatch(load.record, next);
    }

    for (const seat of forfeiting) await this.concedeSeat(next, seat, now, "abandoned");
    return true;
  }

  /** Drop the disconnect graces judged due at `now`. Read again rather than written from the
      list read at the start of the pass, so an entry another event added meanwhile survives. */
  private async consumeDuePending(due: readonly PendingDisconnect[], now: number): Promise<void> {
    if (due.length === 0) return;
    const { waiting } = splitDuePending(await this.pendingDisconnects(), now);
    await this.state.storage.put(PENDING_KEY, waiting);
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
    const connectedAt = (ws: WebSocket): number => {
      const at = attachedConnectedAt(ws);
      if (at !== null) return at;
      // An attachment from before the upgrade recorded its time: start its window now, so a
      // socket that never answers is still let go one window later.
      attachConnectedAt(ws, now);
      return now;
    };
    let unanswered = 0;
    for (const ws of this.liveSockets()) {
      const since = connectedAt(ws);
      // A turned-away socket that never sent the hello it would be answered "full" on.
      if (isOverflow(ws) && now - since > OVERFLOW_HELLO_MS) {
        await this.closeSocket(ws, 1013, "lobby full");
        unanswered++;
      } else if (socketIsSilent(this.state.getWebSocketAutoResponseTimestamp(ws), since, now)) {
        await this.closeSocket(ws, 1001, "keepalive lost");
      }
    }
    // One line per sweep, however many it let go.
    if (unanswered > 0) {
      await this.log(
        "overflow_closed",
        { cause: "no_hello", code: 1013, sockets: unanswered },
        true,
      );
    }
  }

  /**
   * Give the reconnect grace to a seat shown connected that no socket holds and no grace covers. Its
   * socket went without a close the DO heard, as every socket does in a deploy, so without this the
   * seat would show connected and never forfeit. A grace rather than a disconnect, because a socket
   * that reconnected but has not said hello yet holds no seat either.
   */
  private async graceOrphanedSeats(now: number): Promise<void> {
    const snapshot = await this.loadSnapshot();
    if (snapshot === null) return;
    const sockets = this.liveSockets();
    const orphaned = [snapshot.host, snapshot.guest].flatMap((seat) =>
      seat?.connected && !sockets.some((ws) => attachedPlayer(ws) === seat.id) ? [seat.id] : [],
    );
    if (orphaned.length === 0) return;
    const pending = await this.pendingDisconnects();
    const ungraced = orphaned.filter((id) => !pending.some((entry) => entry.playerId === id));
    if (ungraced.length === 0) return;
    let next = pending;
    for (const id of ungraced) next = withPendingDisconnect(next, id, now + DISCONNECT_GRACE_MS);
    await this.state.storage.put(PENDING_KEY, next);
    await this.log("seat_orphaned", { seats: ungraced.length });
  }

  /**
   * Close a socket from this side and do the bookkeeping its close would have: our own `close()`
   * does not fire `webSocketClose`, so without `socketGone` a seat would stay connected with no
   * grace or forfeit clock. Frames still in flight from it are dropped.
   */
  private async closeSocket(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.closing.add(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already gone; the bookkeeping below still applies.
    }
    await this.socketGone(ws);
  }

  /**
   * Spend one frame from the socket's budget and check its size. False when the frame
   * is to be dropped: the socket is already closing, or it is closed here for sending too much
   * (1008) or too large a frame (1009). A closed client reconnects through the per-IP upgrade
   * limit.
   */
  private async withinBudget(ws: WebSocket, message: string | ArrayBuffer): Promise<boolean> {
    if (this.closing.has(ws)) return false;
    const now = this.deps.now();
    const budget = spendFrame(this.frameBudgets.get(ws), now);
    const size = typeof message === "string" ? message.length : message.byteLength;
    const frames = (this.frameCounts.get(ws) ?? 0) + 1;
    this.frameCounts.set(ws, frames);
    if (budget !== null && size <= FRAME_MAX_CHARS) {
      this.frameBudgets.set(ws, budget);
      return true;
    }
    // One line per closed socket, never one per frame: throttled, since the client
    // reconnects and a script can repeat the close.
    const rate = budget === null;
    const connectedAt = attachedConnectedAt(ws);
    await this.log(
      "socket_closed",
      {
        cause: rate ? "frame_rate" : "frame_size",
        code: rate ? 1008 : 1009,
        frames,
        chars: size,
        seated: attachedPlayer(ws) !== null,
        ageMs: connectedAt === null ? null : now - connectedAt,
      },
      true,
    );
    if (rate) await this.closeSocket(ws, 1008, "too many messages");
    else await this.closeSocket(ws, 1009, "message too big");
    return false;
  }

  /**
   * Answer a socket admitted past the socket cap: its hello is refused as full, which the client
   * shows as a full lobby, and it is closed whatever it sent. Like any refused client it re-sends
   * its hello only once the link goes quiet.
   */
  private async turnAway(ws: WebSocket, frame: LobbyClientMessage): Promise<void> {
    if (frame.kind === "hello") {
      const to = isSeatSecret(frame.from) ? publicSeatId(frame.from) : frame.from;
      this.send(ws, { kind: "reject", to, reason: "full" });
    }
    await this.closeSocket(ws, 1013, "lobby full");
    await this.log("overflow_closed", { cause: "turned_away", code: 1013, sockets: 1 }, true);
  }

  /** The sockets that count toward the lobby's cap: every live one but those being turned away. */
  private members(excluding?: WebSocket): WebSocket[] {
    return this.liveSockets(excluding).filter((ws) => !isOverflow(ws));
  }

  /**
   * Whether a just-accepted socket may stay. Under LOBBY_SOCKET_CAP it joins; past it, a
   * socket whose account holds a seat here still joins (the hard cap, checked before the session
   * read, bounds those), and any other is marked to be turned away, while fewer than
   * OVERFLOW_SOCKETS_MAX are. False refuses the upgrade.
   */
  private async admit(ws: WebSocket, account: SessionAccount | null): Promise<boolean> {
    const members = this.members(ws).length;
    if (members < LOBBY_SOCKET_CAP) return true;
    if (account !== null && members < LOBBY_SOCKET_HARD_CAP) {
      const seatUsers = await this.seatUsers();
      if (Object.values(seatUsers).includes(account.userId)) return true;
    }
    const overflow = this.liveSockets(ws).filter((socket) => isOverflow(socket)).length;
    if (overflow >= OVERFLOW_SOCKETS_MAX) return false;
    attachOverflow(ws);
    return true;
  }

  /** Refuse a socket upgrade because the lobby holds all the sockets it takes, closing the
      server half if it was already accepted. The client retries it like a dropped link. */
  private async refuseUpgrade(accepted?: WebSocket): Promise<Response> {
    if (accepted !== undefined) {
      this.closing.add(accepted);
      try {
        accepted.close(1013, "lobby full");
      } catch {
        // Already closed.
      }
    }
    await this.log("ws_refused", { cause: "lobby_full" }, true);
    return Response.json({ error: "lobby full" }, { status: 503 });
  }

  /** The match handoff (online.md): the countdown just flipped this lobby to in-game,
      so mint the authoritative engine game once and persist it. The DO owns the
      RNG seed + all hidden info here on out. Idempotent — a re-fired alarm never
      restarts a live match. `snapshot` is the in-game lobby to start, derived from
      `startedFrom`, the snapshot the alarm pass read. */
  private async handoffToMatch(
    snapshot: LobbyState,
    startedFrom: LobbyState,
    readDecks: ReadDecks,
  ): Promise<HandoffResult> {
    const guest = snapshot.guest;
    if (guest === null) return { kind: "failed", reason: "The lobby needs two players." };
    let live = false;
    let decks: HandoffDecks | null = null;
    let failure: string | null = null;
    try {
      // Idempotency: a LIVE match is never restarted. A record this deploy can't
      // read doesn't count as live — the lobby is starting a match right now, so
      // the fresh write below simply replaces it (no retirement needed, and no
      // reset: the players are about to be in-game either way).
      live = (await this.loadOrMigrateMatch()).kind === "ok";
      if (!live) {
        const seatUsers = await this.seatUsers();
        decks = await readDecks(
          this.deckRequest(snapshot.host, seatUsers),
          this.deckRequest(guest, seatUsers),
        );
      }
    } catch (error) {
      failure = describeError(error);
    }
    // Those reads went to D1, which opens the input gate: another event may have changed the
    // lobby, or a seat's socket gone away, meanwhile. Writing now would commit a lobby derived
    // from before that (a guest who left re-seated, an un-ready overridden), so nothing is
    // written and the pass runs again on the lobby as it is. `commit` assigns a new object on
    // every change, so identity says whether one landed.
    if (this.snapshot !== startedFrom || !this.seatsHaveSockets(snapshot)) {
      return { kind: "superseded" };
    }
    if (failure !== null)
      return await this.failedStart("d1_error", DECK_LOAD_FAILED_REASON, failure);
    if (live || decks === null) return { kind: "started" };
    const { host: hostDeck, guest: guestDeck, pool: cardPool } = decks;
    // The host's failure is reported first either way.
    if (!hostDeck.ok) {
      return await this.failedStart(
        "deck_unresolved",
        `${snapshot.host.name}: ${hostDeck.reason}.`,
      );
    }
    if (!guestDeck.ok) {
      return await this.failedStart("deck_unresolved", `${guest.name}: ${guestDeck.reason}.`);
    }
    // A player no longer seated (a new guest since the rematch) falls back to the coin.
    const chooserId = await this.read(CHOOSER_KEY, storedChooserSchema);
    const chooser = chooserId === undefined ? null : matchSeatOf(snapshot, chooserId);
    // Storage enforces no construction rules, so `beginMatch` is the validator.
    // D1 lists a deck by card id and the engine mints uids in list order, so each list is shuffled
    // first or a uid would place its card in the sorted decklist.
    let begun: BeginMatchResult;
    try {
      begun = beginMatch({
        seed: this.deps.randomSeed(),
        hostDeck: this.deps.shuffleDeck(hostDeck.ids),
        guestDeck: this.deps.shuffleDeck(guestDeck.ids),
        cardPool,
        names: { host: snapshot.host.name, guest: guest.name },
        formats: { host: hostDeck.format, guest: guestDeck.format },
        chooser,
        now: this.deps.now(),
      });
    } catch (error) {
      // The engine is meant to be total, as in `applyMatchAction`. A throw would repeat on
      // every pass with the countdown frozen, so the players are told and un-readied instead.
      return await this.failedStart(
        "match_refused",
        MATCH_START_FAILED_REASON,
        describeError(error),
        true,
      );
    }
    if (!begun.ok) return await this.failedStart("match_refused", begun.reason);
    await this.match.put(begun.record);
    await this.state.storage.delete(CHOOSER_KEY);
    // One line per match begun. A rematch is another under the same lobby code.
    await this.info("match_started");
    return { kind: "started" };
  }

  /** A handoff that could not start the match, logged by `cause` (the reason the players see
      carries their names, so it stays out of the log). `threw` marks the engine throwing, a code
      defect, which logs at error level; a D1 failure or a refused deck is a warning. */
  private async failedStart(
    cause: "d1_error" | "deck_unresolved" | "match_refused",
    reason: string,
    error?: string,
    threw = false,
  ): Promise<HandoffResult> {
    if (threw) logError("lobby", "handoff_failed", await this.fields({ cause, error }));
    else await this.log("handoff_failed", { cause, error });
    return { kind: "failed", reason };
  }

  /** Both seats' decks and the catalog cards they name, from D1. Each deck is owner-scoped by the
      account and session its socket authenticated at /ws, so a crafted `select-deck` naming
      someone else's deck, or a socket whose session has ended, resolves to nothing. The two decks
      are read at once. Rejects when D1 does. */
  private async readHandoffDecks(host: DeckRequest, guest: DeckRequest): Promise<HandoffDecks> {
    const [hostDeck, guestDeck] = await Promise.all([
      this.deps.loadDeck(host.deckId, host.owner),
      this.deps.loadDeck(guest.deckId, guest.owner),
    ]);
    const pool =
      hostDeck.ok && guestDeck.ok
        ? await this.deps.loadPool([...hostDeck.ids, ...guestDeck.ids])
        : {};
    return { host: hostDeck, guest: guestDeck, pool };
  }

  /** What the handoff reads for a seat: its chosen deck, as the account its live socket holds. */
  private deckRequest(player: LobbySeat, seatUsers: Record<string, string>): DeckRequest {
    return { deckId: player.deckId, owner: this.ownerOf(player.id, seatUsers) };
  }

  /** The account and session a seated player's live socket authenticated at /ws, or null
      (an anonymous socket, or none live). At handoff both seats have a live
      socket (the alarm gates on it); used to owner-scope their deck read. Only a socket that
      owns the seat counts, so a bound seat reads as its own account. */
  private ownerOf(playerId: string, seatUsers: Record<string, string>): DeckOwner | null {
    const socket = this.liveSockets().find((ws) => ownsSeat(ws, playerId, seatUsers));
    return socket === undefined ? null : attachedSession(socket);
  }

  /**
   * Before a rematch, re-check the session each seat's sockets authenticated with at the upgrade:
   * true when every one still lives. A socket keeps its
   * account for as long as it stays open, so a logout, a revoked session or a deleted account
   * would otherwise go on to another game. A socket whose session has ended is closed (1008); its
   * reconnect, with no live cookie, is refused the account-bound seat and watches instead. The
   * requester is told why. One D1 read per rematch request, and none for anonymous seats.
   *
   * A failed read lets the rematch through: the handoff's deck read re-checks each session anyway,
   * and refusing would strand the client, which asks only once per finished match.
   */
  private async seatSessionsLive(requester: WebSocket, snapshot: LobbyState): Promise<boolean> {
    const seatUsers = await this.seatUsers();
    const seated = [snapshot.host.id, snapshot.guest?.id];
    const held = this.liveSockets().flatMap((ws) => {
      const playerId = attachedPlayer(ws);
      const session = attachedSession(ws);
      return playerId !== null &&
        session !== null &&
        seated.includes(playerId) &&
        ownsSeat(ws, playerId, seatUsers)
        ? [{ ws, session }]
        : [];
    });
    if (held.length === 0) return true;
    let live: Set<string>;
    try {
      live = await this.deps.liveSessions(held.map(({ session }) => session));
    } catch (error) {
      await this.log(
        "rematch_unchecked",
        { cause: "session_lookup", error: describeError(error) },
        true,
      );
      return true;
    }
    const ended = held.filter(({ session }) => !live.has(session.sessionId));
    if (ended.length === 0) return true;
    const own = ended.some(({ ws }) => ws === requester);
    this.send(requester, {
      kind: "reject-action",
      reason: own ? REMATCH_SIGNED_OUT_REASON : REMATCH_OPPONENT_SIGNED_OUT_REASON,
    });
    for (const { ws } of ended) await this.closeSocket(ws, 1008, "session ended");
    await this.log("rematch_refused", {
      cause: "session_ended",
      sockets: ended.length,
      requester: own,
    });
    return false;
  }

  /** Whether both of the lobby's seated players still have a live socket. */
  private seatsHaveSockets(snapshot: LobbyState): boolean {
    const sockets = this.liveSockets();
    const seated = [snapshot.host.id, snapshot.guest?.id];
    return seated.every((id) => sockets.some((socket) => attachedPlayer(socket) === id));
  }

  /** playerId → the account bound to it. Empty until an authenticated
      socket claims a seat. */
  private async seatUsers(): Promise<Record<string, string>> {
    this.seatUsersMirror ??= (await this.read(SEAT_USERS_KEY, storedSeatUsersSchema)) ?? {};
    return this.seatUsersMirror;
  }

  /** Whether `ws` may act for, and see the hand of, `playerId` (`ownsSeat`). */
  private async ownsSeat(ws: WebSocket, playerId: string): Promise<boolean> {
    return ownsSeat(ws, playerId, await this.seatUsers());
  }

  /** Close every socket on `playerId`'s seat but `keep` that is not `userId`'s. */
  private async evictFromSeat(playerId: string, userId: string, keep: WebSocket): Promise<void> {
    const strays = this.liveSockets(keep).filter(
      (ws) => attachedPlayer(ws) === playerId && attachedUserId(ws) !== userId,
    );
    for (const ws of strays) await this.closeSocket(ws, 1008, "seat claimed by an account");
    if (strays.length > 0) await this.log("seat_evicted", { sockets: strays.length });
  }

  /** Persist → broadcast → re-arm the alarm: the ONE path every snapshot
      change takes, so nothing is ever announced that didn't hit storage. A
      snapshot equal to the current one is no change: nothing is written or sent. */
  private async commit(next: LobbyState): Promise<void> {
    const previous = this.snapshot ?? null;
    const stamped = stampCountdown(next, this.deps.now());
    if (previous !== null && sameSnapshot(previous, stamped)) return;
    // A persisted match outlives EXACTLY the match it describes: when this commit
    // takes the lobby out of in-game (the host's kick, or `endMatch` retiring an
    // unreadable record; a mid-match `bye` keeps the seat), drop the stale
    // GameState so a rematch in this same lobby mints a fresh one instead of
    // handoffToMatch's guard reusing the old (online.md).
    const abandoned = abandonsMatch(previous, stamped);
    // Stored before it is mirrored, so a failed put leaves memory agreeing with storage.
    await this.state.storage.put(SNAPSHOT_KEY, stamped);
    this.snapshot = stamped;
    if (abandoned) await this.match.delete();
    this.broadcast({ kind: "state", snapshot: wireSnapshot(stamped) });
    await this.touchActivity();
    await this.scheduleMaintenance();
  }

  /** One alarm, FOUR duties — earliest deadline wins; alarm() re-derives. */
  private async scheduleMaintenance(sockets: WebSocket[] = this.liveSockets()): Promise<void> {
    const deadlines: number[] = [];

    const snapshot = await this.loadSnapshot();
    const countdownEnd = snapshot === null ? null : countdownEndsAt(snapshot);
    if (countdownEnd !== null) deadlines.push(countdownEnd);

    for (const entry of await this.pendingDisconnects()) deadlines.push(entry.deadline);
    // The match forfeit clock, read off the snapshot's seats.
    // Load-bearing, not bookkeeping: the alarm that ARMS a forfeit is the
    // disconnect grace, and it consumes its own pending entry — so if this
    // deadline were not scheduled here, nothing would wake the DO again and the
    // forfeit would simply never fire (a lobby with one live socket never reaches
    // the empty-lobby TTL either). It sits beside `countdownEndsAt` on purpose:
    // one place that turns snapshot state into the next wake-up.
    if (snapshot !== null) {
      for (const { deadline } of forfeitDeadlines(snapshot)) deadlines.push(deadline);
    }

    // While anyone is connected, keep a poll running: it is the ONLY thing that can notice a
    // socket whose keepalives stopped, because the auto-response deliberately never
    // wakes us. It runs faster while both seats are held (`livenessSweepMs`). With nobody
    // connected there is nothing to check — the empty-lobby expiry below owns that case.
    if (sockets.length > 0) deadlines.push(this.deps.now() + livenessSweepMs(snapshot));

    if (sockets.length === 0) {
      // A lobby somebody said hello in expires a TTL after its last socket left, which is stored;
      // one nobody did has its expiry derived from `created` (`emptyLobbyExpiry`).
      let cleanupAt = await this.emptyLobbyExpiry();
      if (cleanupAt === undefined && snapshot !== null) {
        cleanupAt = this.deps.now() + EMPTY_LOBBY_TTL_MS;
        await this.state.storage.put(CLEANUP_AT_KEY, cleanupAt);
      }
      if (cleanupAt !== undefined) deadlines.push(cleanupAt);
    } else if ((await this.state.storage.get(CLEANUP_AT_KEY)) !== undefined) {
      await this.state.storage.delete(CLEANUP_AT_KEY);
    }

    // Setting the alarm counts as a storage write. An alarm already due at or before the earliest
    // deadline is kept, since `alarm()` re-derives every deadline when it fires and schedules the
    // rest: so the liveness deadline each commit pushes 30s on writes nothing.
    const now = this.deps.now();
    let at = deadlines.length === 0 ? null : Math.min(...deadlines);
    // After a pass that threw, a deadline already past waits out the retry delay.
    if (at !== null && this.retryNotBefore !== null) at = Math.max(at, this.retryNotBefore);
    // After a wake the alarm is read back (a read, not a write) rather than set blind.
    const armed = this.alarmAt === undefined ? await this.state.storage.getAlarm() : this.alarmAt;
    this.alarmAt = armed;
    if (at === armed) return;
    if (at !== null && armed !== null && armed > now && armed <= at) return;
    if (at === null) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(at);
    this.alarmAt = at;
  }

  /** The stored snapshot, read through `readSnapshot` so a lobby persisted by an
      OLDER deploy comes back complete (e.g. without `PlayerState.forfeitAt`). The
      alternative — a version gate like `MatchRecord`'s — would evict live lobbies
      on every deploy that adds a field, and unlike a match record there is no
      embedded engine state a default could quietly get wrong. */
  private async loadSnapshot(): Promise<LobbyState | null> {
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
    this.sendEncoded(ws, JSON.stringify(message));
  }

  private sendEncoded(ws: WebSocket, encoded: string): void {
    try {
      ws.send(encoded);
    } catch {
      // Socket already gone; its close event will tidy up.
    }
  }

  private sendToPlayer(playerId: string, message: LobbyServerMessage): void {
    for (const ws of this.liveSockets()) {
      if (attachedPlayer(ws) === playerId) this.send(ws, message);
    }
  }

  /** Send `message` to every member socket; a turned-away one gets nothing but its refusal. */
  private broadcast(message: LobbyServerMessage): void {
    const encoded = JSON.stringify(message);
    for (const ws of this.members()) this.sendEncoded(ws, encoded);
  }

  /**
   * Send each socket its own redacted view of the match, plus the shared seat-keyed log. `only`
   * targets one socket; otherwise all live sockets. Unseated non-spectators are skipped.
   * `logFrom` is the log length every socket already holds: a socket that takes log deltas gets
   * only the entries after it, and every other socket the whole log.
   */
  private async broadcastMatch(
    record: MatchRecord,
    snapshot: LobbyState,
    { only, logFrom }: { only?: WebSocket; logFrom?: number } = {},
  ): Promise<void> {
    const seatUsers = await this.seatUsers();
    // Every spectator, and every socket of one seat, gets the same frame: each distinct one is
    // redacted and encoded once per broadcast.
    const frames = new Map<string, string>();
    for (const ws of only === undefined ? this.liveSockets() : [only]) {
      const viewer = viewerOf(ws, snapshot, seatUsers);
      if (viewer === null) continue;
      const from = takesLogDeltas(ws) ? logFrom : undefined;
      const key = `${viewer}:${from ?? "all"}`;
      let encoded = frames.get(key);
      if (encoded === undefined) {
        encoded = JSON.stringify(matchFrameFor(record, viewer, from));
        frames.set(key, encoded);
      }
      this.sendEncoded(ws, encoded);
    }
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
    if (load.kind === "ok") await this.broadcastMatch(load.record, snapshot, { only: ws });
    else if (load.kind === "stale") await this.retireStaleMatch();
  }

  /**
   * No seat for this socket. It is always rejected as full, and if a match is running it becomes a
   * spectator with the seatless board. Spectators have no playerId, so they cannot act, and anyone
   * with the lobby code can watch.
   *
   * `cause` says why: both seats are held by others (`full`), or the seat is bound to an
   * account this socket is not signed in as (`bound`). A `full` that only makes a spectator is how
   * watching works, so it is not logged.
   */
  private async refuseSeat(ws: WebSocket, to: string, cause: "full" | "bound"): Promise<void> {
    this.send(ws, { kind: "reject", to, reason: "full" });
    const spectating = await this.watchMatch(ws);
    if (cause === "bound" || !spectating) {
      await this.log(
        "hello_refused",
        { cause, signedIn: attachedUserId(ws) !== null, spectating },
        true,
      );
    }
  }

  /** Make a seatless socket a spectator of the running match, true when there is one to watch. */
  private async watchMatch(ws: WebSocket): Promise<boolean> {
    const snapshot = await this.loadSnapshot();
    if (snapshot === null || snapshot.phase !== "in-game") return false;
    const load = await this.loadOrMigrateMatch();
    if (load.kind !== "ok") return false;
    attachSpectator(ws);
    // The snapshot as well as the board. `state` frames only go out on a lobby
    // COMMIT, and a match in progress may not produce one for many minutes — so a
    // spectator who joined mid-match would otherwise have no idea who is playing
    // (a browser run caught exactly this: their board read "Host vs Guest"). It
    // carries nothing private; it is the same frame both players already hold.
    this.send(ws, { kind: "state", snapshot: wireSnapshot(snapshot) });
    await this.broadcastMatch(load.record, snapshot, { only: ws });
    return true;
  }

  /**
   * Concede the running match for `seat`, used by the abandonment forfeit and by leaving mid-match.
   * It goes through the same path as a player's own concede, so the result is identical. Does
   * nothing if there is no readable record or the game is already over.
   */
  private async concedeSeat(
    snapshot: LobbyState,
    seat: Seat,
    now: number,
    cause: "abandoned" | "left",
  ): Promise<void> {
    const load = await this.loadOrMigrateMatch();
    if (load.kind !== "ok") return;
    const outcome = applyMatchAction(load.record, seat, { type: "concede" }, now);
    if (!outcome.ok) return;
    await this.match.put(outcome.record);
    await this.touchActivity();
    await this.info("forfeit", { seat, cause });
    await this.matchEnded(load.record, outcome.record, cause);
    const logFrom = outcome.logTrimmed ? undefined : load.record.log.length;
    await this.broadcastMatch(outcome.record, snapshot, { logFrom });
  }

  /**
   * Read the persisted match: absent, usable, or unreadable by this build. Every match read
   * goes through here. An older migratable record is migrated and WRITTEN BACK before it is
   * returned, so this is not a pure read.
   */
  private async loadOrMigrateMatch(): Promise<MatchLoad> {
    // Its only write is the migration's, which this slot logs with the version it migrated from.
    let read: unknown;
    const slot: MatchSlot = {
      get: async () => {
        read = await this.match.get();
        return read;
      },
      put: async (record) => {
        await this.match.put(record);
        const from =
          typeof read === "object" && read !== null ? Reflect.get(read, "version") : null;
        await this.log("match_migrated", {
          from: typeof from === "number" ? from : null,
          to: record.version,
        });
      },
    };
    return loadMatchRecord(slot);
  }

  /**
   * Retire a match this deploy can't read: delete it, end the match so the lobby leaves in-game
   * with both seats un-readied, and tell both players. Uses `endMatch`, not
   * `resetAfterFailedStart`, because the latter leaves an in-game lobby in-game.
   */
  private async retireStaleMatch(): Promise<void> {
    await this.match.delete();
    await this.log("match_retired", { cause: "unreadable_record" });
    const snapshot = await this.loadSnapshot();
    if (snapshot === null || snapshot.phase !== "in-game") return;
    await this.commit(endMatch(snapshot));
    this.broadcast({ kind: "match-error", reason: STALE_MATCH_REASON });
  }

  /**
   * The `match_ended` line when `after` finished the game `before` was still playing, with
   * how it ended: the engine's reason for a win (`prizesTaken`, `noPokemon`, `deckOut`,
   * `cardEffect`, `conceded`), `tie`, or the forfeit's `left` or `abandoned`; the turn it ended on,
   * and how long the match ran. No name, seat or account.
   */
  private async matchEnded(
    before: MatchRecord,
    after: MatchRecord,
    forfeit?: "abandoned" | "left",
  ): Promise<void> {
    const { phase } = after.state;
    if (before.state.phase.kind === "gameOver" || phase.kind !== "gameOver") return;
    const { outcome } = phase;
    await this.info("match_ended", {
      cause: forfeit ?? (outcome.result === "win" ? outcome.reason : "tie"),
      turns: after.state.turn,
      durationMs: this.deps.now() - after.startedAt,
    });
  }

  /**
   * One `lobby` log line at warn level, tagged with this lobby's code (log.ts says what fields may
   * carry: never a player-typed string). `throttled` caps a line that repeats for as long as an
   * outage lasts; a string throttles each such value on its own, so one cause cannot hide another.
   * A code defect logs at error level through log.ts directly, with `fields`.
   */
  private async log(
    kind: string,
    fields: LogFields = {},
    throttled: boolean | string = false,
  ): Promise<void> {
    const line = await this.fields(fields);
    if (typeof throttled === "string") logEventThrottledBy(throttled, "lobby", kind, line);
    else if (throttled) logEventThrottled("lobby", kind, line);
    else logEvent("lobby", kind, line);
  }

  /** A `lobby` line at info level, for the lobby's normal course (a match, a forfeit, its expiry). */
  private async info(kind: string, fields: LogFields = {}): Promise<void> {
    logInfo("lobby", kind, await this.fields(fields));
  }

  /** `fields` tagged with this lobby's code, as every `lobby` line is. */
  private async fields(fields: LogFields): Promise<LogFields> {
    return { lobby: await this.logCode(), ...fields };
  }

  /** `fields` for a line about a failure that may be storage's own: the code is read from memory
      first, and a storage read that fails as well leaves it null rather than throwing over the
      failure being logged. */
  private async failureFields(fields: LogFields): Promise<LogFields> {
    let lobby: string | null = null;
    try {
      lobby = await this.logCode();
    } catch {
      // Storage is failing too; the line goes out without the code.
    }
    return { lobby, ...fields };
  }

  private async logCode(): Promise<string | null> {
    return this.snapshot?.code ?? (await this.read(CODE_KEY, storedCodeSchema)) ?? null;
  }
}

/** Whether `ws` acts for `playerId`: it is attached to that seat, and the seat is unbound or bound
    to the socket's account. A socket that attached while the seat was unbound fails the second
    test once an account binds it. */
function ownsSeat(ws: WebSocket, playerId: string, seatUsers: Record<string, string>): boolean {
  return (
    attachedPlayer(ws) === playerId &&
    seatClaimAllowed(seatUsers[playerId] ?? null, attachedUserId(ws))
  );
}

/** Whose view a socket gets: the seat it owns, a spectator's, or null for any other socket. */
function viewerOf(
  ws: WebSocket,
  snapshot: LobbyState,
  seatUsers: Record<string, string>,
): MatchViewer | null {
  const playerId = attachedPlayer(ws);
  if (playerId === null) return isSpectating(ws) ? "spectator" : null;
  return ownsSeat(ws, playerId, seatUsers) ? matchSeatOf(snapshot, playerId) : null;
}
