import type { LobbySlot } from "@luminous/schema";
import { readPersisted, writePersisted } from "../../../lib/persistedState";

// Who you are, per lobby. Split across two stores on purpose:
//   • the display name lives in localStorage, so it's remembered across visits;
//   • your identity in a *specific* lobby (id + role) lives in sessionStorage,
//     so a page refresh keeps you in your seat, but a brand-new tab that pastes
//     the same code joins as a fresh guest rather than impersonating the host.

export type LobbyIdentity = { playerId: string; role: LobbySlot; name: string };

const NAME_KEY = "online.playerName";

/** A friendly default handle for someone who hasn't set a name yet. */
function generateName(): string {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return `Player ${((buffer[0] ?? 0) % 9000) + 1000}`;
}

export function loadPlayerName(): string {
  return readPersisted(NAME_KEY, (raw) => (raw.trim() ? raw : undefined), generateName());
}

export function savePlayerName(name: string): void {
  const trimmed = name.trim();
  if (trimmed) writePersisted(NAME_KEY, trimmed);
}

const identityKey = (code: string) => `online.identity.${code}`;

function isIdentity(value: unknown): value is LobbyIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.playerId === "string" &&
    (candidate.role === "host" || candidate.role === "guest") &&
    typeof candidate.name === "string"
  );
}

function loadIdentity(code: string): LobbyIdentity | null {
  try {
    const raw = sessionStorage.getItem(identityKey(code));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveIdentity(code: string, identity: LobbyIdentity): void {
  try {
    sessionStorage.setItem(identityKey(code), JSON.stringify(identity));
  } catch {
    // Best-effort: the identity still holds for this mount, it just won't
    // survive a refresh.
  }
}

export function clearIdentity(code: string): void {
  try {
    sessionStorage.removeItem(identityKey(code));
  } catch {
    // ignore
  }
}

/** Persist a freshly-created identity for a lobby you're about to enter. Called
    by the hub the instant you create or join, so the room finds it on arrival. */
export function stakeIdentity(code: string, role: LobbySlot): LobbyIdentity {
  const identity: LobbyIdentity = { playerId: crypto.randomUUID(), role, name: loadPlayerName() };
  saveIdentity(code, identity);
  return identity;
}

/** The identity to use in a lobby room: whatever was staked (or restored from a
    refresh), else a fresh guest — landing on a code with no prior context means
    you're trying to join someone else's lobby. */
export function resolveIdentity(code: string, hintedRole: LobbySlot | null): LobbyIdentity {
  const existing = loadIdentity(code);
  if (existing) return existing;
  return stakeIdentity(code, hintedRole ?? "guest");
}
