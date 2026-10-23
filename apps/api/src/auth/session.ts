// The browser holds a random token and the sessions row id is sha256(token), so a leaked database
// contains nothing that authenticates. The cookie is SameSite=None (which requires Secure) because
// the web app is on a different origin and sends credentialed fetches.

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
