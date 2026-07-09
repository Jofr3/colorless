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
