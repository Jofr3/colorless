// Password hashing (§3.5): PBKDF2-SHA256 via WebCrypto — zero dependencies,
// Workers-native. Stored encoding is self-describing:
//
//   pbkdf2$<iterations>$<salt-b64url>$<hash-b64url>
//
// verify() reads the iteration count from the STORED string, so raising
// DEFAULT_ITERATIONS never invalidates old hashes; login checks
// passwordNeedsRehash() after a successful verify and re-hashes in place
// (the upgrade path). Comparison is constant-time.
//
// NOTE — free-plan Workers CPU limits: 100k PBKDF2-SHA256 iterations burn
// tens of ms of raw CPU per call, near the free plan's 10ms-average budget.
// If /auth/login or /auth/register start dying with CPU-limit 500s in
// production, either lower DEFAULT_ITERATIONS (old hashes keep verifying,
// new ones pick up the change) or swap in a WASM Argon2 — revisit §3.5.

import { constantTimeEqual, fromBase64Url, randomBytes, toBase64Url } from "./encoding";

export const DEFAULT_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
/** Upper bound when parsing stored iteration counts — a tampered row must not
    be able to pin a request's CPU with a 2^31-iteration "hash". */
const MAX_ITERATIONS = 10_000_000;

export type ParsedPasswordHash = {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
};

/** Parse the stored encoding; null for anything malformed or out of range. */
export function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  const [scheme, iterationsText, saltText, hashText, ...rest] = encoded.split("$");
  if (scheme !== "pbkdf2" || rest.length > 0) {
    return null;
  }
  if (iterationsText === undefined || !/^[1-9][0-9]*$/.test(iterationsText)) {
    return null;
  }
  const iterations = Number(iterationsText);
  if (iterations > MAX_ITERATIONS) {
    return null;
  }
  const salt = saltText === undefined ? null : fromBase64Url(saltText);
  const hash = hashText === undefined ? null : fromBase64Url(hashText);
  if (salt === null || hash === null || salt.length === 0 || hash.length === 0) {
    return null;
  }
  return { iterations, salt, hash };
}

async function deriveHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
  bits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    bits,
  );
  return new Uint8Array(derived);
}

/** Hash a password with a fresh random salt. */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveHash(password, salt, iterations, HASH_BITS);
  return `pbkdf2$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

/** Verify a password against a stored encoding (constant-time comparison).
    Malformed encodings verify as false, never throw. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (parsed === null) {
    return false;
  }
  const hash = await deriveHash(password, parsed.salt, parsed.iterations, parsed.hash.length * 8);
  return constantTimeEqual(hash, parsed.hash);
}

/** True when a stored hash should be re-hashed on next successful login. */
export function passwordNeedsRehash(encoded: string): boolean {
  const parsed = parsePasswordHash(encoded);
  return parsed === null || parsed.iterations < DEFAULT_ITERATIONS;
}

/** A throwaway hash (random unknown password) verified when login hits a
    missing or password-less account, so both failure paths cost one PBKDF2
    run — no timing oracle for "does this email exist". */
export const DUMMY_PASSWORD_HASH =
  "pbkdf2$100000$ta8pJuzZGOUza_uHotnJgg$qO2sML23CvBp9DkPNTUXyQIjbvLXSL5s1iQcPVd922E";
