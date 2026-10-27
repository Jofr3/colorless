// The lobby Durable Object's decision logic (§3.6), kept pure (no storage, no sockets, no clock
// reads) so its policies unit-test like the snapshot transitions they drive. The DO (lobbyDO.ts)
// is a thin shell around these.

import {
  COUNTDOWN_MS,
  LOBBY_DECK_NAME_MAX,
  LOBBY_NAME_MAX,
  type LobbyClientMessage,
  lobbyClientMessageSchema,
  type LobbySlot,
  type LobbySnapshot,
  lobbySnapshotSchema,
  playerStateSchema,
  stripControlChars,
} from "@colorless/schema";
import * as z from "zod";
import { applyIntent, recomputePhase, removeGuest, setGuestConnected } from "./snapshot";

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

/** The extra time a socket that has never been answered gets on top of `SOCKET_SILENCE_MS`,
    counted from the upgrade: the client's first ping goes out 1.5s after its socket opens, and
    the 101 has to reach it first. */
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

/** How long an empty lobby (zero sockets — also a freshly-minted, never-joined
    one) survives before its storage is wiped and the code freed. Generous next
    to the old model, where a lobby died with the host's tab: it lets a lone
    host close the laptop lid briefly, or both players drop on flaky wifi,
    without losing the room. */
export const EMPTY_LOBBY_TTL_MS = 10 * 60_000;

/**
 * How long a lobby with sockets may go without a commit, an accepted action or a seated hello
 * before the alarm closes every socket and wipes it (LB2). A socket that only pings otherwise holds
 * a lobby, and its 30s liveness alarm, forever. The activity stamp is written at most every
 * `ACTIVITY_STAMP_MS`, so the ceiling lands up to that much early.
 */
export const INACTIVE_LOBBY_MS = 60 * 60_000;

/** How stale the stored activity stamp may get before a commit or action rewrites it. A lobby
    that lives less than this after its creation never writes one. */
export const ACTIVITY_STAMP_MS = 5 * 60_000;

/**
 * Sockets one lobby admits (LB2, decision 7): two seats, eight spectators, and two for a player
 * whose old socket has not closed yet when the reload's new one opens. Past it, a socket is turned
 * away (it is answered "full"), unless its account holds a seat in this lobby, so a crowd cannot
 * keep a player out of their own match.
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
 * Frames one socket may send at once (LB1, MI2). A reconnect flushes the client's queue of up to
 * 32 frames (channel.ts) plus its hello and the hello's 700ms retries, which this covers.
 */
export const FRAME_BURST = 40;

/** Frames per second a socket's budget refills at: well above a player's clicks and the
    client's automatic steps, far below a script's loop. */
export const FRAME_REFILL_PER_SECOND = 5;

/**
 * The longest frame a socket may send, in UTF-16 code units (LB1). The largest legitimate frame
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

/**
 * Whether a socket with `userId` may claim a seat bound to `boundUserId`. Once an account claims a
 * seat, only that account can reclaim it, since the playerId is public. An unbound seat stays
 * bearer-only, which is safe because an anonymous seat cannot load a deck.
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

/**
 * Read a snapshot from storage, filling in fields added since it was written. Unlike matches there
 * is no version gate: a missing field has one sensible default, and retiring snapshots would evict
 * live lobbies on every such deploy.
 */
export function readSnapshot(raw: unknown): LobbySnapshot | null {
  // Never throws: the DO is the only writer, so a malformed blob is impossible in practice and
  // must not take the lobby down if it happens anyway.
  const parsed = storedSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A seat as stored by any deploy. `avatarSeed` and `forfeitAt` were added after the first lobbies
    were written, so a missing or malformed value reads as null; `forfeitAt` feeds `Math.min` in the
    alarm scheduler, where an undefined would set NaN. Names stored before frames were bounded and
    stripped of control characters are cleaned as the frames now are rather than refused, so such
    a lobby keeps working. */
const storedSeatSchema = playerStateSchema.extend({
  name: z.string().transform((name) => stripControlChars(name).slice(0, LOBBY_NAME_MAX)),
  deckName: z
    .string()
    .nullable()
    .transform((name) =>
      name === null ? null : stripControlChars(name).slice(0, LOBBY_DECK_NAME_MAX),
    ),
  avatarSeed: z.string().nullable().catch(null),
  forfeitAt: z.number().nullable().catch(null),
});

const storedSnapshotSchema = lobbySnapshotSchema.extend({
  host: storedSeatSchema,
  guest: storedSeatSchema.nullable(),
});

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

/**
 * End a running match and return the lobby for a rematch, with both seats un-readied.
 * `recomputePhase` never leaves in-game on its own, so the phase is cleared explicitly first.
 * `abandonsMatch` is true for this transition, so `commit` drops the match record.
 */
export function endMatch(snapshot: LobbySnapshot): LobbySnapshot {
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
export function rematch(snapshot: LobbySnapshot, slot: LobbySlot): LobbySnapshot {
  return applyIntent(endMatch(snapshot), slot, { type: "set-ready", ready: true });
}

/**
 * The lobby change a graceful `bye` makes. In-game, the seat is only marked away so the remaining
 * player keeps the board and result; a leave may send two byes. Otherwise the host's seat is marked
 * gone because the host id is fixed, and the guest's seat is freed.
 */
export function applyBye(snapshot: LobbySnapshot, slot: LobbySlot): LobbySnapshot {
  return snapshot.phase === "in-game" || slot === "host"
    ? setSeatConnected(snapshot, slot, false)
    : removeGuest(snapshot);
}

/** Whether two snapshots hold the same values, whatever their key order. */
export function sameSnapshot(a: LobbySnapshot, b: LobbySnapshot): boolean {
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

const pendingDisconnectSchema = z.object({ playerId: z.string(), deadline: z.number() });

export type PendingDisconnect = z.infer<typeof pendingDisconnectSchema>;

// --- Stored values -----------------------------------------------------------
// The schemas the DO reads its smaller storage keys back through. The snapshot and the match
// record have their own readers (`readSnapshot`, `readMatchRecord`).

export const storedPendingSchema = z.array(pendingDisconnectSchema);

/** playerId → the account bound to that seat. */
export const storedSeatUsersSchema = z.record(z.string(), z.string());

/**
 * The seat bindings worth keeping: those of the ids `snapshot` still seats. A departed player's
 * binding guards nothing, since an id that holds no seat holds no hand, and keeping every one would
 * grow the map with each guest a lobby ever had.
 */
export function seatedUsers(
  seatUsers: Record<string, string>,
  snapshot: LobbySnapshot,
): Record<string, string> {
  const seated = [snapshot.host.id, snapshot.guest?.id];
  return Object.fromEntries(Object.entries(seatUsers).filter(([id]) => seated.includes(id)));
}

export const storedCodeSchema = z.string();

/** The empty-lobby expiry, epoch ms. It feeds `Math.min` in the alarm scheduler. */
export const storedCleanupAtSchema = z.number();

/** An epoch-ms stamp: when the lobby was created, or last saw a commit, an action or a hello. */
export const storedTimeSchema = z.number();

/** The playerId who picks the next game's play order. */
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
