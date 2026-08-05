// P5-2 — the token an account's generated avatar is drawn from (polish.md
// "Lobby identity", the half P5-1 left). Pure, and deliberately tiny: there is no
// image here and nothing stored. The client draws a deterministic face from this
// string, so the same person looks the same to you in every lobby, and an
// account that later uploads a real picture just wins over it.
//
// It is a HASH of the account id rather than the id itself. Not because a uuid
// is guessable — it isn't — but because the lobby snapshot is BROADCAST (to the
// opponent, and since 3c-vii to spectators), and an internal primary key is the
// wrong thing to publish: it invites joining this seat to any other surface that
// happens to expose the same id. A hash keeps the one property the avatar needs
// (the same account always maps to the same face) and gives up the one it
// doesn't (being the account id).
//
// It lives under auth/ (not lobby/) since P5-5: the seed is a property of the
// ACCOUNT, not of a seat. /auth/me carries it so the profile shows a player the
// same face the lobby shows everyone else, and one hash serves both.

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
