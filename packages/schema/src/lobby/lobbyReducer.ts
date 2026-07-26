import type { LobbyIntent, LobbySlot, LobbySnapshot, PlayerState } from "./types";

// The host's authoritative state machine, kept pure so the create → join →
// ready → start rules are unit-testable without a channel, timers or React.
// Every function returns a new snapshot (or the same one unchanged); the host
// hook (net/useLobby.ts) is what broadcasts the result and drives the one piece
// of real time — the countdown — that can't live in a pure function.

/** A blank seat: no deck, not ready, present — and with no forfeit armed
    (`connected` ⇒ `forfeitAt === null`, PlayerState's invariant).

    `avatarSeed` defaults to null (an anonymous seat). Like the name, it is the
    lobby SERVER's to resolve from the account (P5-2) — the parameter exists so
    the DO can pass what it resolved, not so a client can choose a face. */
export function makePlayer(
  id: string,
  name: string,
  avatarSeed: string | null = null,
): PlayerState {
  return {
    id,
    name,
    deckId: null,
    deckName: null,
    ready: false,
    connected: true,
    avatarSeed,
    forfeitAt: null,
  };
}

/** The initial lobby a host creates: itself in seat one, waiting for a joiner. */
export function createSnapshot(code: string, host: PlayerState): LobbySnapshot {
  return { code, phase: "waiting", host, guest: null, countdownStartedAt: null };
}

/** Both seats filled and both locked in — the only state a match may start from. */
export function bothReady(snapshot: LobbySnapshot): boolean {
  return snapshot.guest !== null && snapshot.host.ready && snapshot.guest.ready;
}

function playerAt(snapshot: LobbySnapshot, slot: LobbySlot): PlayerState | null {
  return slot === "host" ? snapshot.host : snapshot.guest;
}

function withPlayer(snapshot: LobbySnapshot, slot: LobbySlot, player: PlayerState): LobbySnapshot {
  return slot === "host" ? { ...snapshot, host: player } : { ...snapshot, guest: player };
}

/** Re-derive the phase after a presence/readiness change. It only moves between
    the pre-match phases (waiting ↔ selecting ↔ countdown); it never leaves
    `in-game` (only a player leaving resets that, via `removeGuest`), and the
    host's timer is what advances countdown → in-game. `countdownStartedAt` is
    cleared whenever we fall out of the countdown and left untouched (for the
    host hook to stamp) when we enter it. */
export function recomputePhase(snapshot: LobbySnapshot): LobbySnapshot {
  if (snapshot.phase === "in-game") return snapshot;
  if (!snapshot.guest) {
    return snapshot.phase === "waiting" && snapshot.countdownStartedAt === null
      ? snapshot
      : { ...snapshot, phase: "waiting", countdownStartedAt: null };
  }
  if (bothReady(snapshot)) {
    return snapshot.phase === "countdown" ? snapshot : { ...snapshot, phase: "countdown" };
  }
  return snapshot.phase === "selecting" && snapshot.countdownStartedAt === null
    ? snapshot
    : { ...snapshot, phase: "selecting", countdownStartedAt: null };
}

/** Seat (or re-seat) a guest. A hello from the *same* id is a reconnect, so we
    keep their prior deck/ready and just mark them present again; any other id is
    a fresh joiner taking the seat. Either way the seat comes back with NO forfeit
    armed: this is one of the paths a player returns by, and leaving a deadline on
    a present player is exactly how you lose a game you came back from (P4 3c-v). */
export function seatGuest(
  snapshot: LobbySnapshot,
  id: string,
  name: string,
  avatarSeed: string | null = null,
): LobbySnapshot {
  const reconnecting = snapshot.guest?.id === id ? snapshot.guest : null;
  const guest: PlayerState = reconnecting
    ? { ...reconnecting, name, avatarSeed, connected: true, forfeitAt: null }
    : makePlayer(id, name, avatarSeed);
  return recomputePhase({ ...snapshot, guest });
}

/** Drop the guest and reset the lobby to waiting. The lone host can't stay
    ready (there's no one to start against), and any running countdown/match is
    abandoned. */
export function removeGuest(snapshot: LobbySnapshot): LobbySnapshot {
  return {
    ...snapshot,
    guest: null,
    host: { ...snapshot.host, ready: false },
    phase: "waiting",
    countdownStartedAt: null,
  };
}

/** Update the guest's connectivity. Losing the connection also drops their
    ready state, so a countdown can't proceed with an absent player. Reconnecting
    also clears any armed forfeit (PlayerState's invariant); ARMING one is the
    lobby server's call, not the reducer's — see `setSeatConnected` (api logic.ts). */
export function setGuestConnected(snapshot: LobbySnapshot, connected: boolean): LobbySnapshot {
  if (!snapshot.guest) return snapshot;
  const guest: PlayerState = connected
    ? { ...snapshot.guest, connected: true, forfeitAt: null }
    : { ...snapshot.guest, connected: false, ready: false };
  return recomputePhase({ ...snapshot, guest });
}

/** Apply a player's intent to their own seat, then re-derive the phase.
    Readiness is gated on having a deck, so a `set-ready` with no deck is a no-op. */
export function applyIntent(
  snapshot: LobbySnapshot,
  slot: LobbySlot,
  intent: LobbyIntent,
): LobbySnapshot {
  const player = playerAt(snapshot, slot);
  if (!player) return snapshot;

  if (intent.type === "select-deck") {
    const next = { ...player, deckId: intent.deckId, deckName: intent.deckName };
    return recomputePhase(withPlayer(snapshot, slot, next));
  }
  if (intent.type === "set-ready") {
    const next = { ...player, ready: intent.ready && player.deckId !== null };
    return recomputePhase(withPlayer(snapshot, slot, next));
  }
  // set-name — cosmetic, never affects the phase.
  return withPlayer(snapshot, slot, { ...player, name: intent.name });
}
