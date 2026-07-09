// Server sessions (§3.5): the pure half — token minting, token→row-id
// hashing, and cookie (de)serialization. routes.ts owns the D1 queries.
//
// The browser holds a 256-bit random TOKEN; the sessions row id is
// sha256(token), so a leaked DB dump contains nothing that authenticates —
// defense in depth. Lookup is hash-then-select; there is no way back from
// row id to cookie value.
//
// Cookie: `session`, HttpOnly + Secure + SameSite=None + Path=/, 30-day
// Max-Age. SameSite=None (not Lax) because the web app lives on a DIFFERENT
// origin (§3.5) and sends `credentials: "include"` fetches — None is the only
// mode that rides along cross-site, and it requires Secure. CORS on the app
// (src/index.ts) is the matching half of that handshake.

import { randomBytes, toBase64Url } from "./encoding";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days (§3.5)
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

/** Mint a session token: 256 bits of CSPRNG, base64url (43 chars). */
export function generateSessionToken(): string {
  return toBase64Url(randomBytes(32));
}

/** sha256(token) as base64url — the sessions.id stored in D1. */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

const SESSION_COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=None";

/** Set-Cookie value that installs a session token for 30 days. */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_TTL_SECONDS}; ${SESSION_COOKIE_ATTRIBUTES}`;
}

/** Set-Cookie value that clears the session cookie (logout / dead session). */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; ${SESSION_COOKIE_ATTRIBUTES}`;
}

/**
 * Read one cookie out of a Cookie request header. Minimal on purpose: our
 * values are base64url (no quoting/encoding cases), so split-and-trim is the
 * whole grammar. First match wins, like browsers send most-specific first.
 */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value === "" ? null : value;
    }
  }
  return null;
}
