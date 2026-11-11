// The lobby's seat and phase transitions: pure functions from a snapshot to the next one, so the
// create → join → ready → start rules unit-test without sockets, storage or a clock. The DO
// commits and broadcasts the result and drives the countdown, the one piece of real time.
// The DO holds a `LobbyState`, the snapshot plus what only it may know (each seat's chosen deck
// id); what it broadcasts is `wireSnapshot` of it.

import type { LobbyIntent, LobbySlot, LobbySnapshot, PlayerState } from "@colorless/schema";

/** One seat as the DO stores it: the broadcast seat, with the chosen deck's id in place of
    `hasDeck`. The id names a private library deck, so it never leaves the DO; the handoff
    reads the deck with it. `id` is the seat's public id (seatId.ts). */
export type LobbySeat = Omit<PlayerState, "hasDeck"> & {
  /** Chosen deck, or null until they pick one. */
  deckId: string | null;
};

/** The lobby as the DO stores it. */
export type LobbyState = Omit<LobbySnapshot, "host" | "guest"> & {
  host: LobbySeat;
  guest: LobbySeat | null;
};

/** A blank seat, as the schema's `makePlayer` (no deck, not ready, present, no forfeit armed). */
export function makeSeat(id: string, name: string, avatarSeed: string | null = null): LobbySeat {
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
export function createLobbyState(code: string, host: LobbySeat): LobbyState {
  return { code, phase: "waiting", host, guest: null, countdownStartedAt: null };
}

/** A seat as everyone sees it: whether a deck is chosen, never which. */
export function wireSeat({ deckId, ...seat }: LobbySeat): PlayerState {
  return { ...seat, hasDeck: deckId !== null };
}

/** The snapshot the DO broadcasts for `state`. */
export function wireSnapshot(state: LobbyState): LobbySnapshot {
  return {
    ...state,
    host: wireSeat(state.host),
    guest: state.guest === null ? null : wireSeat(state.guest),
  };
}

/** Both seats filled and both locked in, the only state a match may start from. */
export function bothReady(snapshot: LobbyState): boolean {
  return snapshot.guest !== null && snapshot.host.ready && snapshot.guest.ready;
}

function playerAt(snapshot: LobbyState, slot: LobbySlot): LobbySeat | null {
  return slot === "host" ? snapshot.host : snapshot.guest;
}

function withPlayer(snapshot: LobbyState, slot: LobbySlot, player: LobbySeat): LobbyState {
  return slot === "host" ? { ...snapshot, host: player } : { ...snapshot, guest: player };
}

/** Re-derive the phase after a presence or readiness change. It only moves between the pre-match
    phases (waiting ↔ selecting ↔ countdown) and never leaves `in-game`; the DO's alarm advances
    countdown → in-game. `countdownStartedAt` is cleared whenever the lobby falls out of the
    countdown and left null on entry, for `stampCountdown` to fill. */
export function recomputePhase(snapshot: LobbyState): LobbyState {
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
  snapshot: LobbyState,
  id: string,
  name: string,
  avatarSeed: string | null = null,
): LobbyState {
  const reconnecting = snapshot.guest?.id === id ? snapshot.guest : null;
  const guest: LobbySeat = reconnecting
    ? { ...reconnecting, name, avatarSeed, connected: true, forfeitAt: null }
    : makeSeat(id, name, avatarSeed);
  return recomputePhase({ ...snapshot, guest });
}

/** Drop the guest and reset the lobby to waiting. The lone host can't stay ready, and any
    running countdown or match is abandoned. */
export function removeGuest(snapshot: LobbyState): LobbyState {
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
export function setGuestConnected(snapshot: LobbyState, connected: boolean): LobbyState {
  if (!snapshot.guest) return snapshot;
  const guest: LobbySeat = connected
    ? { ...snapshot.guest, connected: true, forfeitAt: null }
    : { ...snapshot.guest, connected: false, ready: false };
  return recomputePhase({ ...snapshot, guest });
}

/** Apply a player's intent to their own seat, then re-derive the phase. Readiness is gated on
    having a deck, so a `set-ready` with no deck is a no-op. */
export function applyIntent(
  snapshot: LobbyState,
  slot: LobbySlot,
  intent: LobbyIntent,
): LobbyState {
  const player = playerAt(snapshot, slot);
  if (!player) return snapshot;

  if (intent.type === "select-deck") {
    const next = { ...player, deckId: intent.deckId, deckName: intent.deckName };
    return recomputePhase(withPlayer(snapshot, slot, next));
  }
  const next = { ...player, ready: intent.ready && player.deckId !== null };
  return recomputePhase(withPlayer(snapshot, slot, next));
}
