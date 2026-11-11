// PBKDF2-SHA256 via WebCrypto, in one of two stored encodings:
//
//   pbkdf2$<iterations>$<salt>$<hash>             PBKDF2 of the password itself (older hashes)
//   pbkdf2p$<pepper id>$<iterations>$<salt>$<hash> PBKDF2 of HMAC-SHA256(pepper, password)
//
// The pepper is the `PASSWORD_PEPPER` Worker secret, which lives outside D1:
// a database export alone does not let anyone test guesses offline. Its id is a short MAC of a
// fixed string under the pepper, so a stored hash names the pepper it needs without revealing it,
// and a rotation can keep the old one as `PASSWORD_PEPPER_PREVIOUS` until its accounts sign in.
//
// Verification reads the scheme, pepper id and iteration count from the stored string, so neither
// changing DEFAULT_ITERATIONS nor adding the pepper invalidates old hashes: a successful login
// re-hashes whatever passwordNeedsRehash flags. 100k iterations is close to the free-plan Workers
// CPU budget; the HMAC adds microseconds.

import { constantTimeEqual, fromBase64Url, randomBytes, toBase64Url } from "./encoding";

export const DEFAULT_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
/** Upper bound when parsing stored iteration counts — a tampered row must not
    be able to pin a request's CPU with a 2^31-iteration "hash". */
const MAX_ITERATIONS = 10_000_000;
const PEPPER_ID = /^[A-Za-z0-9_-]{8}$/;

/** A pepper ready to use: its HMAC key and the id stored hashes name it by. */
export type Pepper = { id: string; key: CryptoKey };

/** The peppers this Worker holds: `current` hashes new passwords, and every one verifies. */
export type Peppers = { current: Pepper | null; all: Pepper[] };

export const NO_PEPPERS: Peppers = { current: null, all: [] };

/** The imported pepper per secret value, per isolate. */
const pepperCache = new Map<string, Promise<Pepper>>();

/** The Pepper for a secret value. */
export function pepperOf(secret: string): Promise<Pepper> {
  let pepper = pepperCache.get(secret);
  if (pepper === undefined) {
    pepper = (async () => {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const mac = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode("colorless password pepper id"),
      );
      return { id: toBase64Url(new Uint8Array(mac)).slice(0, 8), key };
    })();
    pepperCache.set(secret, pepper);
  }
  return pepper;
}

/** The peppers named by the Worker's secrets; none when PASSWORD_PEPPER is unset. */
export async function peppersOf(
  env: { PASSWORD_PEPPER?: string; PASSWORD_PEPPER_PREVIOUS?: string } | undefined,
): Promise<Peppers> {
  if (!env?.PASSWORD_PEPPER) return NO_PEPPERS;
  const current = await pepperOf(env.PASSWORD_PEPPER);
  const previous = env.PASSWORD_PEPPER_PREVIOUS
    ? await pepperOf(env.PASSWORD_PEPPER_PREVIOUS)
    : null;
  return { current, all: previous === null ? [current] : [current, previous] };
}

export type ParsedPasswordHash = {
  /** The pepper this hash was made with, or null for an unpeppered `pbkdf2$` hash. */
  pepperId: string | null;
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
};

/** Parse the stored encoding; null for anything malformed or out of range. */
export function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  const parts = encoded.split("$");
  let pepperId: string | null = null;
  if (parts[0] === "pbkdf2p") {
    pepperId = parts[1] ?? "";
    if (!PEPPER_ID.test(pepperId)) return null;
    parts.splice(1, 1);
  } else if (parts[0] !== "pbkdf2") {
    return null;
  }
  const [, iterationsText, saltText, hashText, ...rest] = parts;
  if (rest.length > 0) {
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
  return { pepperId, iterations, salt, hash };
}

/** What PBKDF2 stretches: the password's bytes, or their HMAC under the pepper. */
async function pbkdf2Input(password: string, pepper: Pepper | null): Promise<BufferSource> {
  const bytes = new TextEncoder().encode(password);
  return pepper === null ? bytes : crypto.subtle.sign("HMAC", pepper.key, bytes);
}

async function deriveHash(
  input: BufferSource,
  salt: Uint8Array,
  iterations: number,
  bits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", input, "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    bits,
  );
  return new Uint8Array(derived);
}

/** Hash a password with a fresh random salt, peppered when a pepper is given. */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
  pepper: Pepper | null = null,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveHash(await pbkdf2Input(password, pepper), salt, iterations, HASH_BITS);
  const scheme = pepper === null ? "pbkdf2" : `pbkdf2p$${pepper.id}`;
  return `${scheme}$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

/** True when `encoded` is peppered with a pepper none of `peppers` is: it cannot be verified
    here at all, which is a missing or wrong secret, not a wrong password. */
export function pepperUnavailable(encoded: string, peppers: Peppers): boolean {
  const pepperId = parsePasswordHash(encoded)?.pepperId ?? null;
  return pepperId !== null && !peppers.all.some((pepper) => pepper.id === pepperId);
}

/** Verify a password against a stored encoding (constant-time comparison). Malformed encodings,
    and peppered ones whose pepper is not in `peppers`, verify as false, never throw. */
export async function verifyPassword(
  password: string,
  encoded: string,
  peppers: Peppers = NO_PEPPERS,
): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (parsed === null) {
    return false;
  }
  let pepper: Pepper | null = null;
  if (parsed.pepperId !== null) {
    pepper = peppers.all.find((candidate) => candidate.id === parsed.pepperId) ?? null;
    if (pepper === null) return false;
  }
  const input = await pbkdf2Input(password, pepper);
  const hash = await deriveHash(input, parsed.salt, parsed.iterations, parsed.hash.length * 8);
  return constantTimeEqual(hash, parsed.hash);
}

/** True when a stored hash should be re-hashed on next successful login: malformed, below the
    default iterations, or not under the current pepper while there is one. */
export function passwordNeedsRehash(encoded: string, current: Pepper | null = null): boolean {
  const parsed = parsePasswordHash(encoded);
  return (
    parsed === null ||
    parsed.iterations < DEFAULT_ITERATIONS ||
    (current !== null && parsed.pepperId !== current.id)
  );
}

/** A throwaway hash (random unknown password) verified when login hits a
    missing or password-less account, so both failure paths cost one PBKDF2
    run — no timing oracle for "does this email exist". */
export const DUMMY_PASSWORD_HASH =
  "pbkdf2$100000$ta8pJuzZGOUza_uHotnJgg$qO2sML23CvBp9DkPNTUXyQIjbvLXSL5s1iQcPVd922E";

/** The throwaway hash under the current pepper, so a missing account's verify runs the same
    HMAC-then-PBKDF2 steps a real peppered one does. */
export function dummyPasswordHash(current: Pepper | null): string {
  return current === null
    ? DUMMY_PASSWORD_HASH
    : DUMMY_PASSWORD_HASH.replace(/^pbkdf2\$/, `pbkdf2p$${current.id}$`);
}
