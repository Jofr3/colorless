// The lobby Durable Object's decision logic (§3.6), kept pure (no storage, no sockets, no clock
// reads) so its policies unit-test like the snapshot transitions they drive. The DO (lobbyDO.ts)
// is a thin shell around these.

import {
  clipText,
  COUNTDOWN_MS,
  isPublicSeatId,
  LOBBY_DECK_NAME_MAX,
  LOBBY_NAME_MAX,
  LOBBY_PING_MS,
  LOBBY_SILENCE_MS,
  type LobbyClientMessage,
  lobbyClientMessageSchema,
  lobbyPhaseSchema,
  type LobbySlot,
} from "@colorless/schema";
import * as z from "zod";
import {
  applyIntent,
  type LobbyState,
  recomputePhase,
  removeGuest,
  setGuestConnected,
} from "./snapshot";

/** The old model's reconnect grace (its PRESENCE_TIMEOUT_MS): a lost socket
    only shows as a disconnected seat if the player hasn't come back within
    this window — so a refresh, or the probe→room socket handoff on join,
    never flickers the opponent to "disconnected". */
export const DISCONNECT_GRACE_MS = 5000;

/**
 * How long a player may be gone from a running match before forfeiting. Much longer than
 * `DISCONNECT_GRACE_MS` so a brief reload or network change does not lose the game.
 */
export const ABANDON_GRACE_MS = 90_000;

/** How long a socket may go without answering a keepalive before the lobby gives up on it:
    `LOBBY_SILENCE_MS`, the client's own limit, so a client whose path died has already given the
    socket up for a new one by the time the lobby does. The DO's `setWebSocketAutoResponse` answers
    each ping WITHOUT waking it. A hidden tab's pings can stop for most of a minute (Chromium holds
    its timers back), which a `LOBBY_WS_NUDGE` after `NUDGE_AFTER_MS` covers. A tab frozen for
    longer, or a phone that switched networks, loses this TCP connection whatever the limit, and
    reconnects. */
export const SOCKET_SILENCE_MS = LOBBY_SILENCE_MS;

/** How long a socket's pings may lapse before the liveness sweep nudges it: two ping intervals. A
    visible tab never reaches it; a hidden one is nudged on every sweep it reaches it on, and a
    seated lobby's sweep comes before `SOCKET_SILENCE_MS` runs out. */
export const NUDGE_AFTER_MS = 2 * LOBBY_PING_MS;

/** How often the alarm checks for silent sockets while any are connected and nobody holds the
    other seat. It is a POLL, and it has to be: the whole point of the auto-response is
    that a ping does not wake the DO, so nothing else will ever notice pings that STOPPED. With one
    seat held there is nobody to tell, so a lone host's lobby wakes twice a minute instead of the
    ~40 times a minute it would if we answered keepalives in the handler and gave up hibernation. */
export const LIVENESS_SWEEP_MS = 30_000;

/**
 * The liveness sweep while both seats are held, a match or the versus screen. A half-open player
 * is shown to their opponent as away, and their forfeit clock starts, at most this plus
 * `SOCKET_SILENCE_MS` plus `DISCONNECT_GRACE_MS` after their keepalives stop: 20s, where the idle
 * sweep's 45s let a 30s outage end before the opponent saw anything.
 *
 * The cost is wakes: 12 a minute (720 an hour) per two-seat lobby instead of 2, each an alarm
 * run and an alarm write. Five seconds is also under the runtime's ~10s hibernation idle, so a
 * seated lobby stays in memory, billed for duration, rather than hibernating between moves. Both
 * are bounded per lobby by `INACTIVE_LOBBY_MS`, and a lobby with one seat held keeps the 30s.
 */
export const SEATED_LIVENESS_SWEEP_MS = 5_000;

/** The liveness sweep a lobby needs: `SEATED_LIVENESS_SWEEP_MS` while both seats are held, so an
    opponent who could be told is told soon, else `LIVENESS_SWEEP_MS`. */
export function livenessSweepMs(snapshot: LobbyState | null): number {
  return snapshot?.guest != null ? SEATED_LIVENESS_SWEEP_MS : LIVENESS_SWEEP_MS;
}

/** The oldest lobby protocol (`LOBBY_PROTOCOL`, protocol.ts) the DO seats; a hello below it is
    closed with `LOBBY_WS_OUTDATED`. 0 admits the pages from before the protocol had a number. */
export const MIN_LOBBY_PROTOCOL = 0;

/** Whether a hello's protocol (absent is 0) is older than `min`. */
export function helloIsOutdated(protocol: number | undefined, min: number): boolean {
  return (protocol ?? 0) < min;
}

/** The extra time a socket that has never been answered gets on top of `SOCKET_SILENCE_MS`,
    counted from the upgrade: the client's first ping goes out `LOBBY_PING_MS` after its socket
    opens, and the 101 has to reach it first. */
export const FIRST_KEEPALIVE_MARGIN_MS = 5_000;

/**
 * Whether a socket has gone quiet: its last auto-answered keepalive is older than
 * `SOCKET_SILENCE_MS`, or, never answered, it connected longer ago than that plus
 * `FIRST_KEEPALIVE_MARGIN_MS`. Without the second arm a connection that died before its first
 * ping, or a client that never pings, would count as alive forever.
 */
export function socketIsSilent(
  lastAutoResponse: Date | null,
  connectedAt: number,
  now: number,
): boolean {
  if (lastAutoResponse !== null) return now - lastAutoResponse.getTime() > SOCKET_SILENCE_MS;
  return now - connectedAt > SOCKET_SILENCE_MS + FIRST_KEEPALIVE_MARGIN_MS;
}

/** Whether a socket that is not silent should be nudged: no ping answered for `NUDGE_AFTER_MS`,
    counted from the upgrade for a socket never answered. */
export function socketNeedsNudge(
  lastAutoResponse: Date | null,
  connectedAt: number,
  now: number,
): boolean {
  return now - (lastAutoResponse?.getTime() ?? connectedAt) > NUDGE_AFTER_MS;
}

/** How long an empty lobby (zero sockets — also a freshly-minted, never-joined
    one) survives before its storage is wiped and the code freed. Generous next
    to the old model, where a lobby died with the host's tab: it lets a lone
    host close the laptop lid briefly, or both players drop on flaky wifi,
    without losing the room. */
export const EMPTY_LOBBY_TTL_MS = 10 * 60_000;

/**
 * How long a lobby with sockets may go without a commit, an accepted action or a seated hello
 * before the alarm closes every socket and wipes it. A socket that only pings otherwise holds
 * a lobby, and its 30s liveness alarm, forever. The activity stamp is written at most every
 * `ACTIVITY_STAMP_MS`, so the ceiling lands up to that much early.
 */
export const INACTIVE_LOBBY_MS = 60 * 60_000;

/** How stale the stored activity stamp may get before a commit or action rewrites it. A lobby
    that lives less than this after its creation never writes one. */
export const ACTIVITY_STAMP_MS = 5 * 60_000;

/**
 * Sockets one lobby admits: two seats, eight more tabs (answered "full", holding no seat), and two
 * for a player whose old socket has not closed yet when the reload's new one opens. Past it, a
 * socket is turned away and closed, unless its account holds a seat in this lobby, so a crowd
 * cannot keep a player out of their own match.
 */
export const LOBBY_SOCKET_CAP = 2 + 8 + 2;

/** The most sockets past which even a seat-holding account is refused, checked before the D1
    session read so a flood costs no D1 reads. */
export const LOBBY_SOCKET_HARD_CAP = LOBBY_SOCKET_CAP + 4;

/** Turned-away sockets held at once while their hello is answered "full"; past it the upgrade is
    refused outright. */
export const OVERFLOW_SOCKETS_MAX = 4;

/** How long a turned-away socket may stay open without sending its hello. The client sends it on
    open, so the next liveness sweep closes one older than this. */
export const OVERFLOW_HELLO_MS = 5_000;

/**
 * Frames one socket may send at once. A reconnect flushes the client's queue of up to
 * 32 frames (channel.ts) plus its hello and the hello's 700ms retries, which this covers.
 */
export const FRAME_BURST = 40;

/** Frames per second a socket's budget refills at: well above a player's clicks and the
    client's automatic steps, far below a script's loop. */
export const FRAME_REFILL_PER_SECOND = 5;

/**
 * The longest frame a socket may send, in UTF-16 code units. The largest legitimate frame
 * is an action answering a prompt over a whole deck, a few kilobytes; a hello or intent is under
 * half a kilobyte.
 */
export const FRAME_MAX_CHARS = 16 * 1024;

/** A socket's frame budget: tokens left as of `at` (epoch ms). */
export type FrameBudget = { tokens: number; at: number };

/**
 * The budget after one more frame at `now`, or null when the socket has none left. A socket
 * starts with `FRAME_BURST` tokens and regains `FRAME_REFILL_PER_SECOND` a second up to it.
 */
export function spendFrame(budget: FrameBudget | undefined, now: number): FrameBudget | null {
  const start = budget ?? { tokens: FRAME_BURST, at: now };
  const refill = (Math.max(0, now - start.at) * FRAME_REFILL_PER_SECOND) / 1000;
  const tokens = Math.min(FRAME_BURST, start.tokens + refill);
  return tokens < 1 ? null : { tokens: tokens - 1, at: now };
}

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
export function slotOf(snapshot: LobbyState, playerId: string): LobbySlot | null {
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
export function helloDecision(snapshot: LobbyState | null, from: string): HelloDecision {
  // `from` is the public id of the seat the hello's secret claims (seatId.ts).
  if (snapshot === null) return "claim-host";
  if (snapshot.host.id === from) return "reseat-host";
  if (snapshot.guest === null || snapshot.guest.id === from) return "seat-guest";
  if (snapshot.guest.connected || snapshot.phase === "countdown" || snapshot.phase === "in-game") {
    return "reject-full";
  }
  return "seat-guest";
}

/**
 * Whether a socket with `userId` may claim a seat bound to `boundUserId`. Once an account claims a
 * seat, only that account can reclaim it, even with the seat's secret (a tab signed out of it, or a
 * secret copied elsewhere). An unbound seat is claimed by its secret alone, which only its client
 * holds.
 */
export function seatClaimAllowed(boundUserId: string | null, userId: string | null): boolean {
  return boundUserId === null || boundUserId === userId;
}

/**
 * Update a seat's connectivity. Disconnecting drops the seat's ready, and the phase is re-derived.
 * `forfeitAt` defaults to null, so marking a seat present always clears its forfeit deadline; pass
 * one only when disconnecting from a running match.
 */
export function setSeatConnected(
  snapshot: LobbyState,
  slot: LobbySlot,
  connected: boolean,
  forfeitAt: number | null = null,
): LobbyState {
  const next =
    slot === "guest" ? setGuestConnected(snapshot, connected) : hostConnected(snapshot, connected);
  // The single writer, so neither arm above has to remember the invariant.
  return withForfeitAt(next, slot, forfeitAt);
}

function hostConnected(snapshot: LobbyState, connected: boolean): LobbyState {
  const host = connected
    ? { ...snapshot.host, connected: true }
    : { ...snapshot.host, connected: false, ready: false };
  return recomputePhase({ ...snapshot, host });
}

/** Write one seat's forfeit deadline (null = none). Pure; no policy of its own. */
export function withForfeitAt(
  snapshot: LobbyState,
  slot: LobbySlot,
  forfeitAt: number | null,
): LobbyState {
  if (slot === "host") return { ...snapshot, host: { ...snapshot.host, forfeitAt } };
  return snapshot.guest === null
    ? snapshot
    : { ...snapshot, guest: { ...snapshot.guest, forfeitAt } };
}

/** Every seat with a forfeit deadline, as (slot, deadline) pairs — what the DO
    schedules its alarm from and judges due forfeits against. Reading them off
    the SNAPSHOT rather than a second storage list is the point: the
    deadline the opponent's countdown renders is the same number the alarm fires
    on, so the two can never disagree. */
export function forfeitDeadlines(snapshot: LobbyState): { slot: LobbySlot; deadline: number }[] {
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
    on every other return path, cancel any armed forfeit. */
export function reseatHost(
  snapshot: LobbyState,
  name: string,
  avatarSeed: string | null = null,
): LobbyState {
  return {
    ...snapshot,
    host: { ...snapshot.host, name, avatarSeed, connected: true, forfeitAt: null },
  };
}

/**
 * Read a snapshot from storage, filling in fields added since it was written. Unlike matches there
 * is no version gate: a missing field has one sensible default, and retiring snapshots would evict
 * live lobbies on every such deploy. A lobby stored before seats had public ids (`isLegacySnapshot`)
 * reads as null; the DO wipes such a lobby before reading it.
 */
export function readSnapshot(raw: unknown): LobbyState | null {
  // Never throws: the DO is the only writer, so a malformed blob is impossible in practice and
  // must not take the lobby down if it happens anyway.
  const parsed = storedSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether `raw` is a lobby stored before the seat secret split: its seats are named by the
 * ids clients sent, which every snapshot broadcast, so they cannot be carried over as public ids,
 * and no client can present a secret for them. Absent and unreadable values are not legacy.
 */
export function isLegacySnapshot(raw: unknown): boolean {
  const parsed = legacySnapshotSchema.safeParse(raw);
  if (!parsed.success) return false;
  const { host, guest } = parsed.data;
  return !isPublicSeatId(host.id) || (guest !== null && !isPublicSeatId(guest.id));
}

/** A seat as stored by any deploy. `avatarSeed` and `forfeitAt` were added after the first lobbies
    were written, so a missing or malformed value reads as null; `forfeitAt` feeds `Math.min` in the
    alarm scheduler, where an undefined would set NaN. Names stored before frames were bounded and
    stripped of control characters are cleaned as the frames now are rather than refused, so such
    a lobby keeps working. The id must be a public seat id. */
const storedSeatSchema = z.object({
  id: z.string().refine(isPublicSeatId),
  name: z.string().transform((name) => clipText(name, LOBBY_NAME_MAX)),
  deckId: z.string().nullable(),
  deckName: z
    .string()
    .nullable()
    .transform((name) => (name === null ? null : clipText(name, LOBBY_DECK_NAME_MAX))),
  ready: z.boolean(),
  connected: z.boolean(),
  avatarSeed: z.string().nullable().catch(null),
  forfeitAt: z.number().nullable().catch(null),
});

const storedSnapshotSchema = z.object({
  code: z.string(),
  phase: lobbyPhaseSchema,
  host: storedSeatSchema,
  guest: storedSeatSchema.nullable(),
  countdownStartedAt: z.number().nullable(),
});

/** Just enough of a stored lobby to read its seat ids. */
const legacySnapshotSchema = z.object({
  host: z.object({ id: z.string() }),
  guest: z.object({ id: z.string() }).nullable(),
});

/** The countdown ended but the match couldn't START (a chosen deck wouldn't
    resolve): un-ready both seats and re-derive the phase, so the
    lobby falls back to `selecting` for a retry instead of wedging in-game with no
    match. Un-readying is what breaks the loop — leaving it in `countdown` past
    its deadline would just re-fire the failing handoff on the next alarm. */
export function resetAfterFailedStart(snapshot: LobbyState): LobbyState {
  return recomputePhase({
    ...snapshot,
    host: { ...snapshot.host, ready: false },
    guest: snapshot.guest ? { ...snapshot.guest, ready: false } : null,
  });
}

/**
 * End a running match and return the lobby for a rematch, with both seats un-readied.
 * `recomputePhase` never leaves in-game on its own, so the phase is cleared explicitly first.
 * `abandonsMatch` is true for this transition, so `commit` drops the match record.
 */
export function endMatch(snapshot: LobbyState): LobbyState {
  return recomputePhase({
    ...snapshot,
    phase: "selecting",
    countdownStartedAt: null,
    host: { ...snapshot.host, ready: false },
    guest: snapshot.guest ? { ...snapshot.guest, ready: false } : null,
  });
}

/**
 * End the finished match and ready the asker. The opponent accepts by readying. Goes through
 * `applyIntent` so the rule that you can't be ready without a deck is enforced in one place.
 */
export function rematch(snapshot: LobbyState, slot: LobbySlot): LobbyState {
  return applyIntent(endMatch(snapshot), slot, { type: "set-ready", ready: true });
}

/**
 * The lobby change a graceful `bye` makes. In-game, the seat is only marked away so the remaining
 * player keeps the board and result; a leave may send two byes. Otherwise the host's seat is marked
 * gone because the host id is fixed, and the guest's seat is freed.
 */
export function applyBye(snapshot: LobbyState, slot: LobbySlot): LobbyState {
  return snapshot.phase === "in-game" || slot === "host"
    ? setSeatConnected(snapshot, slot, false)
    : removeGuest(snapshot);
}

/** Whether two snapshots hold the same values, whatever their key order. */
export function sameSnapshot(a: LobbyState, b: LobbyState): boolean {
  return sameValue(a, b);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}

/** Stamp the countdown's start the moment `recomputePhase` enters the phase, which leaves
    `countdownStartedAt` null for this to fill, so every client counts from one instant. */
export function stampCountdown(snapshot: LobbyState, now: number): LobbyState {
  return snapshot.phase === "countdown" && snapshot.countdownStartedAt === null
    ? { ...snapshot, countdownStartedAt: now }
    : snapshot;
}

/** When the running countdown flips to in-game, or null if none is running. */
export function countdownEndsAt(snapshot: LobbyState): number | null {
  return snapshot.phase === "countdown" && snapshot.countdownStartedAt !== null
    ? snapshot.countdownStartedAt + COUNTDOWN_MS
    : null;
}

/** Whether a committed transition ABANDONS a running match — i.e. takes the
    lobby out of in-game, which only `endMatch` does (a mid-match `bye` keeps the seat, and
    `recomputePhase` never leaves in-game on its own). The DO drops its persisted match record on exactly these,
    so a rematch in the same lobby mints a fresh game instead of `handoffToMatch`
    reusing the stale one. `prev` null = a brand-new lobby, never in-game. */
export function abandonsMatch(prev: LobbyState | null, next: LobbyState): boolean {
  return prev !== null && prev.phase === "in-game" && next.phase !== "in-game";
}

// --- Pending-disconnect bookkeeping ----------------------------------------
// One entry per player whose last socket dropped, carrying the deadline after
// which the seat is marked disconnected (unless they returned first). At most
// two entries ever exist; stored as a plain array in DO storage.

const pendingDisconnectSchema = z.object({ playerId: z.string(), deadline: z.number() });

export type PendingDisconnect = z.infer<typeof pendingDisconnectSchema>;

// --- Stored values -----------------------------------------------------------
// The schemas the DO reads its smaller storage keys back through. The snapshot and the match
// record have their own readers (`readSnapshot`, `readMatchRecord`).

export const storedPendingSchema = z.array(pendingDisconnectSchema);

/** Public seat id → the account bound to that seat. */
export const storedSeatUsersSchema = z.record(z.string(), z.string());

/**
 * The seat bindings worth keeping: those of the ids `snapshot` still seats. A departed player's
 * binding guards nothing, since an id that holds no seat holds no hand, and keeping every one would
 * grow the map with each guest a lobby ever had.
 */
export function seatedUsers(
  seatUsers: Record<string, string>,
  snapshot: LobbyState,
): Record<string, string> {
  const seated = [snapshot.host.id, snapshot.guest?.id];
  return Object.fromEntries(Object.entries(seatUsers).filter(([id]) => seated.includes(id)));
}

export const storedCodeSchema = z.string();

/** The empty-lobby expiry, epoch ms. It feeds `Math.min` in the alarm scheduler. */
export const storedCleanupAtSchema = z.number();

/** An epoch-ms stamp: when the lobby was created, or last saw a commit, an action or a hello. */
export const storedTimeSchema = z.number();

/** The public seat id of the player who picks the next game's play order. */
export const storedChooserSchema = z.string();

/**
 * A stored value read through `schema`, or undefined when it is absent or unreadable. An
 * unreadable value is treated as never written, so the next write replaces it.
 */
export function readStored<T>(schema: z.ZodType<T>, raw: unknown): T | undefined {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

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
