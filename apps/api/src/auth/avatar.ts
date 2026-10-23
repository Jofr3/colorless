// The avatar seed is a hash of the account id rather than the id itself, because the lobby snapshot
// is broadcast to opponents and spectators and should not publish an internal primary key.

/** FNV-1a, 32-bit, as 8 lowercase hex — a display token, not a security
    boundary, so the cheapest stable hash that spreads well is the right one; the
    client's only use is to pick colours from it. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // The FNV prime, via shifts — `* 16777619` overflows a JS number's integer
    // range and would stop being the same function on long inputs.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The avatar token of an account. Every account has one — it's derived, not
    stored, so there is no "not set yet" case to represent. */
export function avatarSeedOf(userId: string): string {
  return fnv1a(userId);
}

/** The same token for a caller that may have no account: null for an anonymous
    socket, which renders the generic figure — honestly saying "we don't know who
    this is" rather than inventing a face from a throwaway id that would change
    on every visit. */
export function avatarSeedFrom(userId: string | null): string | null {
  return userId === null ? null : avatarSeedOf(userId);
}
