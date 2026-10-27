import type { LobbySnapshot, PlayerState } from "./types";

/** A blank seat: no deck, not ready, present, and with no forfeit armed (`connected` ⇒
    `forfeitAt === null`, PlayerState's invariant). The name and `avatarSeed` are the lobby
    server's to resolve from the account; the parameter lets the DO pass what it resolved. */
export function makePlayer(
  id: string,
  name: string,
  avatarSeed: string | null = null,
): PlayerState {
  return {
    id,
    name,
    hasDeck: false,
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
