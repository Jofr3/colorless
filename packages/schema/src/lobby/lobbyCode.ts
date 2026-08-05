// The short human-friendly code that identifies a private lobby. It's what one
// player reads out (or pastes) and the other types in to join, so it's built
// from an unambiguous alphabet — no characters that look alike when read aloud
// or in a terminal font.
//
// Shared vocabulary (P1 milestone 8): the api Worker mints codes with
// `generateLobbyCode` (each one names a lobby Durable Object) while the web
// app validates and normalizes typed input with the same alphabet.

// `crypto` is ambient in every runtime this package targets (browsers,
// Workers, Bun, Node ≥ 19) but absent from this package's platform-neutral
// ES2022 lib — declare the one method we use rather than dragging DOM types in.
declare const crypto: { getRandomValues(array: Uint32Array): Uint32Array };

// 31 symbols: A–Z minus the look-alikes I/L/O (23 letters) plus 2–9 (8 digits).
// Four of them give 31^4 ≈ 923k combinations — far more than enough for
// concurrent lobbies, while staying easy to say and type.
export const LOBBY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LOBBY_CODE_LENGTH = 4;

/** A uniform random float in [0, 1). Cryptographically-seeded so codes aren't
    predictable; injectable so the generator is deterministic under test. */
function defaultRandom(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) / 2 ** 32;
}

/** Generate a fresh lobby code. Pass a custom `random` (returning [0, 1)) to
    make the output deterministic in tests. */
export function generateLobbyCode(random: () => number = defaultRandom): string {
  let code = "";
  for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
    const index = Math.floor(random() * LOBBY_CODE_ALPHABET.length);
    // The fallback guards a `random` that returns exactly 1 (index out of range).
    code += LOBBY_CODE_ALPHABET[index] ?? LOBBY_CODE_ALPHABET[0];
  }
  return code;
}

/** Coerce user-typed input toward a canonical code: upper-case it and drop
    anything outside the alphabet (spaces, dashes, look-alikes), capping the
    length. Forgiving so "abcd", "AB CD" and "abcd " all normalise the same. */
export function normalizeLobbyCode(raw: string): string {
  const set = new Set(LOBBY_CODE_ALPHABET);
  let out = "";
  for (const ch of raw.toUpperCase()) {
    if (set.has(ch)) out += ch;
    if (out.length === LOBBY_CODE_LENGTH) break;
  }
  return out;
}

/** Whether `code` is a complete, well-formed lobby code (already normalized). */
export function isValidLobbyCode(code: string): boolean {
  return code.length === LOBBY_CODE_LENGTH && normalizeLobbyCode(code) === code;
}
