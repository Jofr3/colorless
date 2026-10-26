// The lobby's seat and phase transitions: pure functions from a snapshot to the next one, so the
// create → join → ready → start rules unit-test without sockets, storage or a clock. The DO
// commits and broadcasts the result and drives the countdown, the one piece of real time.

import {
  type LobbyIntent,
  type LobbySlot,
  type LobbySnapshot,
  makePlayer,
  type PlayerState,
} from "@colorless/schema";

/** Both seats filled and both locked in, the only state a match may start from. */
export function bothReady(snapshot: LobbySnapshot): boolean {
  return snapshot.guest !== null && snapshot.host.ready && snapshot.guest.ready;
}

function playerAt(snapshot: LobbySnapshot, slot: LobbySlot): PlayerState | null {
  return slot === "host" ? snapshot.host : snapshot.guest;
}

function withPlayer(snapshot: LobbySnapshot, slot: LobbySlot, player: PlayerState): LobbySnapshot {
  return slot === "host" ? { ...snapshot, host: player } : { ...snapshot, guest: player };
}

/** Re-derive the phase after a presence or readiness change. It only moves between the pre-match
    phases (waiting ↔ selecting ↔ countdown) and never leaves `in-game`; the DO's alarm advances
    countdown → in-game. `countdownStartedAt` is cleared whenever the lobby falls out of the
    countdown and left null on entry, for `stampCountdown` to fill. */
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

/** Seat (or re-seat) a guest. A hello from the same id is a reconnect, which keeps the prior deck
    and ready; any other id is a fresh joiner taking the seat. Either way the seat comes back with
    no forfeit armed, since a deadline left on a present player would forfeit a game they came
    back to. */
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

/** Drop the guest and reset the lobby to waiting. The lone host can't stay ready, and any
    running countdown or match is abandoned. */
export function removeGuest(snapshot: LobbySnapshot): LobbySnapshot {
  return {
    ...snapshot,
    guest: null,
    host: { ...snapshot.host, ready: false },
    phase: "waiting",
    countdownStartedAt: null,
  };
}

/** Update the guest's connectivity. Losing the connection also drops their ready, so a countdown
    can't proceed with an absent player; reconnecting clears any armed forfeit. Arming one is
    `setSeatConnected`'s call. */
export function setGuestConnected(snapshot: LobbySnapshot, connected: boolean): LobbySnapshot {
  if (!snapshot.guest) return snapshot;
  const guest: PlayerState = connected
    ? { ...snapshot.guest, connected: true, forfeitAt: null }
    : { ...snapshot.guest, connected: false, ready: false };
  return recomputePhase({ ...snapshot, guest });
}

/** Apply a player's intent to their own seat, then re-derive the phase. Readiness is gated on
    having a deck, so a `set-ready` with no deck is a no-op. */
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
  // set-name is cosmetic and never affects the phase.
  return withPlayer(snapshot, slot, { ...player, name: intent.name });
}
