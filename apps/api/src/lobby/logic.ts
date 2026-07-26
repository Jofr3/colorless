// The lobby Durable Object's decision logic (§3.6), kept pure — no storage,
// no sockets, no clock reads — so the policies transplanted from the
// BroadcastChannel-era host (net/useLobby.ts) stay unit-testable exactly like
// the reducer they drive. The DO (lobbyDO.ts) is a thin shell around these.

import {
  COUNTDOWN_MS,
  type LobbyClientMessage,
  lobbyClientMessageSchema,
  type LobbySlot,
  type LobbySnapshot,
  recomputePhase,
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
    phase is re-derived either way. */
export function setSeatConnected(
  snapshot: LobbySnapshot,
  slot: LobbySlot,
  connected: boolean,
): LobbySnapshot {
  if (slot === "guest") return setGuestConnected(snapshot, connected);
  const host = connected
    ? { ...snapshot.host, connected: true }
    : { ...snapshot.host, connected: false, ready: false };
  return recomputePhase({ ...snapshot, host });
}

/** Re-seat a reconnecting host: same semantics as `seatGuest` for a known id —
    keep their deck/ready, adopt the announced name, mark them present. */
export function reseatHost(snapshot: LobbySnapshot, name: string): LobbySnapshot {
  return { ...snapshot, host: { ...snapshot.host, name, connected: true } };
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
    lobby out of in-game (only `removeGuest` does: a guest's `bye` or the host's
    kick; `recomputePhase` never leaves in-game on its own). The DO drops its
    persisted match record on exactly these, so a rematch in the same lobby mints
    a fresh game instead of `handoffToMatch` reusing the stale one (P4). `prev`
    null = a brand-new lobby, which was never in-game. */
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
