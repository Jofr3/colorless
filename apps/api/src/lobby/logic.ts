// The lobby Durable Object's decision logic (§3.6), kept pure — no storage,
// no sockets, no clock reads — so the policies transplanted from the
// BroadcastChannel-era host (net/useLobby.ts) stay unit-testable exactly like
// the reducer they drive. The DO (lobbyDO.ts) is a thin shell around these.

import {
  applyIntent,
  COUNTDOWN_MS,
  type LobbyClientMessage,
  lobbyClientMessageSchema,
  type LobbySlot,
  type LobbySnapshot,
  recomputePhase,
  removeGuest,
  setGuestConnected,
} from "@luminous/schema";

/** The old model's reconnect grace (its PRESENCE_TIMEOUT_MS): a lost socket
    only shows as a disconnected seat if the player hasn't come back within
    this window — so a refresh, or the probe→room socket handoff on join,
    never flickers the opponent to "disconnected". */
export const DISCONNECT_GRACE_MS = 5000;

/** How long a player may be gone from a RUNNING match before they forfeit it
    (P4 3c-ii). Deliberately far longer than `DISCONNECT_GRACE_MS`, which is a
    5-second "did the socket blip?" window whose only consequence is a greyed-out
    connection dot: losing a game to a 5-second blip would be indefensible, while
    a lobby that can never resolve is the actual bug this closes — before it, one
    player closing their tab left the other staring at a board forever (the
    empty-lobby TTL can't help: it only fires when NOBODY is connected, and the
    waiting player is). 90s is long enough to survive a tab reload, a phone
    changing networks, or a brief ISP drop, and short enough that the abandoned
    player isn't held hostage. */
export const ABANDON_GRACE_MS = 90_000;

/** How long a socket may go without answering a keepalive before the lobby gives
    up on it (P4 3c-viii). The client pings every 1.5s (channel.ts) and the DO's
    `setWebSocketAutoResponse` answers WITHOUT waking it, so 15s is ten missed
    pings — long enough that a phone switching networks or a paused tab is not
    mistaken for a dead one, short enough to land well inside the 90s forfeit. */
export const SOCKET_SILENCE_MS = 15_000;

/** How often the alarm checks for silent sockets while any are connected
    (3c-viii). It is a POLL, and it has to be: the whole point of the auto-response
    is that a ping does not wake the DO, so nothing else will ever notice pings
    that STOPPED. 30s is the compromise — a half-open socket costs its opponent at
    most this plus the usual 5s grace before the forfeit clock starts, while an
    occupied lobby wakes twice a minute instead of the ~40 times a minute it would
    if we answered keepalives in the handler and gave up hibernation entirely. */
export const LIVENESS_SWEEP_MS = 30_000;

/** Whether a socket has gone silent — its last auto-answered keepalive is older
    than `SOCKET_SILENCE_MS` (P4 3c-viii). Pure; the DO reads the timestamp from
    the runtime (`getWebSocketAutoResponseTimestamp`) and closes what this rejects.

    A `null` timestamp counts as ALIVE, deliberately: it means the runtime has
    never auto-answered this socket, which is the state of every connection for
    its first ping — and, since we cannot tell "just connected" from "connected
    long ago and never pinged", the only safe reading is to leave it alone. The
    cost of being wrong that way is a socket we never sweep; the cost of the other
    way is closing a healthy connection a second after it opened. */
export function socketIsSilent(lastAutoResponse: Date | null, now: number): boolean {
  return lastAutoResponse !== null && now - lastAutoResponse.getTime() > SOCKET_SILENCE_MS;
}

/** How long an empty lobby (zero sockets — also a freshly-minted, never-joined
    one) survives before its storage is wiped and the code freed. Generous next
    to the old model, where a lobby died with the host's tab: it lets a lone
    host close the laptop lid briefly, or both players drop on flaky wifi,
    without losing the room. */
export const EMPTY_LOBBY_TTL_MS = 10 * 60_000;

/** Parse + validate one inbound WebSocket frame (§3.6: EVERY frame is
    validated). Anything malformed — bad JSON, unknown kind, server-only
    frames, a fabricated "full" rejection — is null, and the DO drops it. */
export function parseClientMessage(raw: string): LobbyClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = lobbyClientMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Which seat a player id holds in the snapshot, if any. */
export function slotOf(snapshot: LobbySnapshot, playerId: string): LobbySlot | null {
  if (snapshot.host.id === playerId) return "host";
  if (snapshot.guest?.id === playerId) return "guest";
  return null;
}

export type HelloDecision = "claim-host" | "reseat-host" | "seat-guest" | "reject-full";

/** Where a `hello` lands. The guest-seat rule is verbatim from the old host:
    refuse a *different* player while the seat is actively held — incumbent
    connected, or a countdown/match underway — and otherwise let them take
    over the abandoned seat; the same id always re-seats (a reconnect). New
    here is the host side: the first hello into a freshly-created lobby claims
    the host seat, and the host id (pinned in the snapshot for the lobby's
    lifetime) always re-seats as host. */
export function helloDecision(snapshot: LobbySnapshot | null, from: string): HelloDecision {
  if (snapshot === null) return "claim-host";
  if (snapshot.host.id === from) return "reseat-host";
  if (snapshot.guest === null || snapshot.guest.id === from) return "seat-guest";
  if (snapshot.guest.connected || snapshot.phase === "countdown" || snapshot.phase === "in-game") {
    return "reject-full";
  }
  return "seat-guest";
}

/** Whether a socket presenting `userId` (null = anonymous) may (re)claim the
    seat whose playerId is bound to `boundUserId` (null = never yet claimed by an
    account). A playerId becomes account-BOUND the first time an authenticated
    socket claims it; from then on ONLY that account may re-adopt it — so a socket
    that replays the seat's PUBLIC playerId (broadcast in every `state` frame)
    WITHOUT its session (a different account, or anonymous) is refused, and so can
    never be handed that seat's redacted in-game HAND (P4 3a-sec, closing the D60
    L2 bearer-only-seat leak). An unbound seat stays bearer-only, which is safe:
    an anonymous seat can't load a real deck (`loadPlayerDeck` refuses a null
    userId), so it never reaches an in-game match with a hand to protect. Pure. */
export function seatClaimAllowed(boundUserId: string | null, userId: string | null): boolean {
  return boundUserId === null || boundUserId === userId;
}

/** Update a seat's connectivity — `setGuestConnected` plus the host twin the
    reducer never needed when the host was the authority. Disconnecting drops
    the seat's ready (a countdown can't proceed with an absent player), and the
    phase is re-derived either way.

    `forfeitAt` rides along because the two ALWAYS move together (P4 3c-v): this
    is the only place that arms a forfeit deadline, and it defaults to null, so
    marking a seat present clears it in the same call — you cannot write one
    without deciding the other. Pass a deadline only when disconnecting a seat
    whose match is running; `connected: true` must always leave it null
    (PlayerState's invariant, and the thing that stops a returning player losing
    a game they came back to). */
export function setSeatConnected(
  snapshot: LobbySnapshot,
  slot: LobbySlot,
  connected: boolean,
  forfeitAt: number | null = null,
): LobbySnapshot {
  const next =
    slot === "guest" ? setGuestConnected(snapshot, connected) : hostConnected(snapshot, connected);
  // The single writer, so neither arm above has to remember the invariant.
  return withForfeitAt(next, slot, forfeitAt);
}

function hostConnected(snapshot: LobbySnapshot, connected: boolean): LobbySnapshot {
  const host = connected
    ? { ...snapshot.host, connected: true }
    : { ...snapshot.host, connected: false, ready: false };
  return recomputePhase({ ...snapshot, host });
}

/** Write one seat's forfeit deadline (null = none). Pure; no policy of its own. */
export function withForfeitAt(
  snapshot: LobbySnapshot,
  slot: LobbySlot,
  forfeitAt: number | null,
): LobbySnapshot {
  if (slot === "host") return { ...snapshot, host: { ...snapshot.host, forfeitAt } };
  return snapshot.guest === null
    ? snapshot
    : { ...snapshot, guest: { ...snapshot.guest, forfeitAt } };
}

/** Every seat with a forfeit deadline, as (slot, deadline) pairs — what the DO
    schedules its alarm from and judges due forfeits against. Reading them off
    the SNAPSHOT rather than a second storage list is the point of 3c-v: the
    deadline the opponent's countdown renders is the same number the alarm fires
    on, so the two can never disagree. */
export function forfeitDeadlines(snapshot: LobbySnapshot): { slot: LobbySlot; deadline: number }[] {
  const seats: { slot: LobbySlot; forfeitAt: number | null }[] = [
    { slot: "host", forfeitAt: snapshot.host.forfeitAt },
    ...(snapshot.guest === null
      ? []
      : [{ slot: "guest" as const, forfeitAt: snapshot.guest.forfeitAt }]),
  ];
  return seats.flatMap(({ slot, forfeitAt }) =>
    forfeitAt === null ? [] : [{ slot, deadline: forfeitAt }],
  );
}

/** Re-seat a reconnecting host: same semantics as `seatGuest` for a known id —
    keep their deck/ready, adopt the announced name, mark them present — and, as
    on every other return path, cancel any armed forfeit (3c-v). */
export function reseatHost(
  snapshot: LobbySnapshot,
  name: string,
  avatarSeed: string | null = null,
): LobbySnapshot {
  return {
    ...snapshot,
    host: { ...snapshot.host, name, avatarSeed, connected: true, forfeitAt: null },
  };
}

/** Read a snapshot back out of DO storage, filling in fields added since it was
    written. Unlike `MATCH_KEY`, `SNAPSHOT_KEY` has no version gate and MUST not
    have one: a lobby snapshot is a handful of scalars with no engine state
    embedded, so a missing field has exactly one sensible value, and the cost of
    being wrong is cosmetic — whereas retiring the snapshot (the `MatchRecord`
    answer, D72) would evict live lobbies on every deploy that adds a field. Note
    the DO is the only writer, so this runs once per wake, and every later commit
    persists the completed shape. */
export function readSnapshot(raw: unknown): LobbySnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const snapshot = raw as LobbySnapshot;
  // A shallow shape check for the same reason `readMatchRecord` has one: the DO
  // is the only writer, so this can't fire in practice, and that is exactly why
  // it must not throw if it somehow does.
  if (typeof snapshot.host !== "object" || snapshot.host === null) return null;
  return {
    ...snapshot,
    host: withSeatDefaults(snapshot.host),
    guest: snapshot.guest ? withSeatDefaults(snapshot.guest) : null,
  };
}

/** Fields added to a seat since the stored snapshot was written: `forfeitAt`
    (3c-v) and `avatarSeed` (P5-2). `forfeitAt` is guarded on the TYPE rather than
    `?? null` because it feeds `Math.min` in the alarm scheduler, where an
    `undefined` that slipped through would set NaN. */
function withSeatDefaults(seat: LobbySnapshot["host"]): LobbySnapshot["host"] {
  return {
    ...seat,
    avatarSeed: typeof seat.avatarSeed === "string" ? seat.avatarSeed : null,
    forfeitAt: typeof seat.forfeitAt === "number" ? seat.forfeitAt : null,
  };
}

/** The countdown ended but the match couldn't START (a chosen deck wouldn't
    resolve, P4 increment 3): un-ready both seats and re-derive the phase, so the
    lobby falls back to `selecting` for a retry instead of wedging in-game with no
    match. Un-readying is what breaks the loop — leaving it in `countdown` past
    its deadline would just re-fire the failing handoff on the next alarm. */
export function resetAfterFailedStart(snapshot: LobbySnapshot): LobbySnapshot {
  return recomputePhase({
    ...snapshot,
    host: { ...snapshot.host, ready: false },
    guest: snapshot.guest ? { ...snapshot.guest, ready: false } : null,
  });
}

/** End a match that is ALREADY RUNNING and hand the lobby back for a rematch:
    both seats un-readied, phase re-derived from there (`selecting` with a guest,
    `waiting` without).

    This exists because `resetAfterFailedStart` CANNOT do it: `recomputePhase`
    returns an `in-game` snapshot untouched (it never leaves in-game on its own —
    the invariant that stops a mid-match ready-toggle from tearing the game down),
    so un-readying an in-game lobby leaves the phase exactly where it was. Clearing
    the phase FIRST is what lets the recompute run, and it must be done explicitly
    — which is the point: leaving in-game is a decision a caller makes, never a
    side effect. Its callers are the ways a match can stop before the engine says
    `gameOver`: a record this deploy can't read (retired), and — when they land —
    concede / rematch / a timed-out player. `abandonsMatch` reports true for the
    transition, so `commit` drops the persisted match with it. */
export function endMatch(snapshot: LobbySnapshot): LobbySnapshot {
  return recomputePhase({
    ...snapshot,
    phase: "selecting",
    countdownStartedAt: null,
    host: { ...snapshot.host, ready: false },
    guest: snapshot.guest ? { ...snapshot.guest, ready: false } : null,
  });
}

/** A player asked to play again (P4 3c-vi): end the finished match and READY the
    asker, in one commit.

    Auto-readying is what makes this a whole feature rather than half of one. The
    alternative shapes were a mutual offer/accept handshake (a second piece of
    lobby state to persist, expire and reconcile — and a "waiting for them to
    accept" screen that can wedge) or a plain `endMatch` that drops both players
    on the versus screen to re-ready (correct, but it makes the asker press twice
    and says nothing about who asked). This shape reuses the ready-up flow VERBATIM
    as the agreement mechanism: the countdown still starts only when BOTH seats are
    ready, so pressing Rematch is an offer the opponent accepts by readying — and
    the asker can withdraw it by un-readying, which the versus screen already does.

    `applyIntent(set-ready)` rather than writing `ready: true` directly, so the
    "you can't be ready without a deck" rule stays in ONE place: a player whose
    saved deck vanished between games lands back on the versus screen un-readied,
    exactly as if they'd pressed Ready themselves. */
export function rematch(snapshot: LobbySnapshot, slot: LobbySlot): LobbySnapshot {
  return applyIntent(endMatch(snapshot), slot, { type: "set-ready", ready: true });
}

/** The lobby change a seated player's graceful `bye` makes. Three cases, kept
    together because the difference between them is the whole point:

    - **in-game (either seat) — the seat only goes AWAY** (P4 3c-iv). The lobby
      stays in-game around the match, so the player who is still there keeps their
      board and, above all, the RESULT: the DO concedes for the leaver first
      (`concedeSeat`), and freeing the seat here would immediately take the lobby
      out of in-game, drop the match record (`abandonsMatch` → `commit`) and blank
      the winner's screen a frame after they were told they won — the "a leave
      VOIDS the match" bug this closes. It covers a FINISHED game too (leaving
      after a win/loss), for the same reason and because a leave is often two
      `bye` frames (an explicit `leave()` plus the unmount's): the second must not
      undo what the first just decided. Leaving in-game deliberately has no path
      left except the ones a player asks for — the host's kick today, rematch next.
    - **the host, otherwise** — the host id is pinned for the lobby's lifetime, so
      their seat can only be marked gone; the empty-lobby TTL reclaims the code if
      they never come back.
    - **the guest, otherwise** — the seat is freed at once (the pre-P4 semantics),
      so the host drops back to the waiting screen and can take another opponent. */
export function applyBye(snapshot: LobbySnapshot, slot: LobbySlot): LobbySnapshot {
  return snapshot.phase === "in-game" || slot === "host"
    ? setSeatConnected(snapshot, slot, false)
    : removeGuest(snapshot);
}

/** Stamp the countdown's start the moment the reducer enters the phase — the
    reducer leaves `countdownStartedAt` for its driver to fill (the old host
    hook stamped it the same way), so every client counts from one instant. */
export function stampCountdown(snapshot: LobbySnapshot, now: number): LobbySnapshot {
  return snapshot.phase === "countdown" && snapshot.countdownStartedAt === null
    ? { ...snapshot, countdownStartedAt: now }
    : snapshot;
}

/** When the running countdown flips to in-game, or null if none is running. */
export function countdownEndsAt(snapshot: LobbySnapshot): number | null {
  return snapshot.phase === "countdown" && snapshot.countdownStartedAt !== null
    ? snapshot.countdownStartedAt + COUNTDOWN_MS
    : null;
}

/** Whether a committed transition ABANDONS a running match — i.e. takes the
    lobby out of in-game: `removeGuest` (now only the host's KICK — a mid-match
    `bye` keeps the seat since 3c-iv) and `endMatch`; `recomputePhase` never leaves
    in-game on its own. The DO drops its persisted match record on exactly these,
    so a rematch in the same lobby mints a fresh game instead of `handoffToMatch`
    reusing the stale one (P4). `prev` null = a brand-new lobby, never in-game. */
export function abandonsMatch(prev: LobbySnapshot | null, next: LobbySnapshot): boolean {
  return prev !== null && prev.phase === "in-game" && next.phase !== "in-game";
}

// --- Pending-disconnect bookkeeping ----------------------------------------
// One entry per player whose last socket dropped, carrying the deadline after
// which the seat is marked disconnected (unless they returned first). At most
// two entries ever exist; stored as a plain array in DO storage.

export type PendingDisconnect = { playerId: string; deadline: number };

/** Add (or refresh) a player's pending disconnect. */
export function withPendingDisconnect(
  pending: PendingDisconnect[],
  playerId: string,
  deadline: number,
): PendingDisconnect[] {
  return [...pending.filter((entry) => entry.playerId !== playerId), { playerId, deadline }];
}

/** Drop a player's pending disconnect (they reconnected in time). */
export function withoutPendingDisconnect(
  pending: PendingDisconnect[],
  playerId: string,
): PendingDisconnect[] {
  return pending.filter((entry) => entry.playerId !== playerId);
}

/** Split the entries whose grace has run out from those still waiting. */
export function splitDuePending(
  pending: PendingDisconnect[],
  now: number,
): { due: PendingDisconnect[]; waiting: PendingDisconnect[] } {
  return {
    due: pending.filter((entry) => entry.deadline <= now),
    waiting: pending.filter((entry) => entry.deadline > now),
  };
}
