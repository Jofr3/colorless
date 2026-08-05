// OAuth authorization-code flow, pure parts (§3.5): provider table, config
// resolution from env secrets, authorize-URL + token-request construction,
// state cookie packing, redirect sanitizing, and profile normalization.
// routes.ts owns the two fetches (token exchange, userinfo) and all D1 work.
//
// Providers activate by configuration alone: until `wrangler secret put`
// installs a client id + secret, oauthConfig() returns null and the routes
// answer 503 "provider not configured" — the code path is live either way.

import { z } from "zod";
import type { Env } from "../env";
import { fromBase64Url, randomBytes, toBase64Url } from "./encoding";

export type OAuthProvider = "discord" | "google";

/** Narrow a path param to a known provider; null → route 404s. */
export function parseProvider(value: string): OAuthProvider | null {
  return value === "discord" || value === "google" ? value : null;
}

export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
};

/** Per-provider constants (§3.5): endpoints + the minimal profile scopes. */
const PROVIDER_ENDPOINTS: Record<
  OAuthProvider,
  Pick<OAuthConfig, "authorizeUrl" | "tokenUrl" | "userinfoUrl" | "scope">
> = {
  discord: {
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userinfoUrl: "https://discord.com/api/users/@me",
    scope: "identify email",
  },
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
  },
};

/** Resolve a provider's config; null while its secrets are not installed. */
export function oauthConfig(env: Env, provider: OAuthProvider): OAuthConfig | null {
  const clientId = provider === "discord" ? env.DISCORD_CLIENT_ID : env.GOOGLE_CLIENT_ID;
  const clientSecret =
    provider === "discord" ? env.DISCORD_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret, ...PROVIDER_ENDPOINTS[provider] };
}

/** The provider authorize URL a start request 302s to. */
export function buildAuthorizeUrl(config: OAuthConfig, redirectUri: string, state: string): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  return url.toString();
}

/** POST parameters for the code→token exchange (route does the fetch). */
export function tokenRequest(
  config: OAuthConfig,
  code: string,
  redirectUri: string,
): { url: string; body: URLSearchParams } {
  return {
    url: config.tokenUrl,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  };
}

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });

/** Pull the access token out of a token-endpoint response; null on drift. */
export function parseTokenResponse(json: unknown): string | null {
  const parsed = tokenResponseSchema.safeParse(json);
  return parsed.success ? parsed.data.access_token : null;
}

// ---------------------------------------------------------------------------
// CSRF state — random value round-tripped provider-side via ?state= and
// browser-side via a short-lived cookie; the callback requires both to match.
// The cookie value also carries the post-login redirect path so it survives
// the provider round-trip without trusting anything in the callback URL.

export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 600; // one authorization round-trip

/** Mint a CSRF state value: 128 bits CSPRNG, base64url. */
export function generateState(): string {
  return toBase64Url(randomBytes(16));
}

/** Pack state + redirect path into one cookie value: `state.b64url(redirect)`. */
export function packStateCookieValue(state: string, redirect: string): string {
  return `${state}.${toBase64Url(new TextEncoder().encode(redirect))}`;
}

/** Unpack a state cookie value; null on any malformed input. */
export function unpackStateCookieValue(
  value: string | null,
): { state: string; redirect: string } | null {
  if (value === null) {
    return null;
  }
  const separator = value.indexOf(".");
  if (separator <= 0) {
    return null;
  }
  const state = value.slice(0, separator);
  const redirectBytes = fromBase64Url(value.slice(separator + 1));
  if (redirectBytes === null) {
    return null;
  }
  // Re-sanitize after decoding — the cookie is client-held, so its contents
  // are as untrusted as the original query parameter was.
  return { state, redirect: sanitizeRedirect(new TextDecoder().decode(redirectBytes)) };
}

/**
 * Allowlist a post-login redirect to RELATIVE paths: must start with a
 * single "/" (no scheme, no "//host" protocol-relative escape, no
 * backslash trickery, no control chars that could split headers). Anything
 * else falls back to "/".
 */
export function sanitizeRedirect(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return "/";
  }
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return "/";
    }
  }
  return raw;
}

/** State cookie: HttpOnly + Secure, scoped to the oauth routes. SameSite=Lax
    (not None): the callback arrives as a top-level GET navigation from the
    provider, which Lax permits — no reason to loosen further. */
export function stateCookie(value: string): string {
  return `${OAUTH_STATE_COOKIE}=${value}; Max-Age=${OAUTH_STATE_TTL_SECONDS}; Path=/auth/oauth; HttpOnly; Secure; SameSite=Lax`;
}

/** Clear the state cookie — it is single-use, dropped on every callback. */
export function clearedStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Max-Age=0; Path=/auth/oauth; HttpOnly; Secure; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// Profile normalization — each provider's userinfo payload parsed at the
// boundary and reduced to the one shape find-or-create needs.

export type OAuthProfile = {
  providerId: string;
  /** Lowercased, or null when the provider withheld it (routes 400 then). */
  email: string | null;
  /** Only ever true when the provider itself asserts verification. */
  emailVerified: boolean;
  displayName: string;
};

// Discord GET /api/users/@me with identify+email scopes. `verified` is the
// account's email-verification flag; `email` can still be null for
// pathological accounts, handled upstream.
const discordUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  global_name: z.string().nullish(),
  email: z.string().nullish(),
  verified: z.boolean().nullish(),
});

// Google OIDC userinfo (openid email profile scopes).
const googleUserinfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().nullish(),
  email_verified: z.boolean().nullish(),
  name: z.string().nullish(),
});

/** Normalize a provider userinfo payload; null when the shape drifted. */
export function parseOAuthProfile(provider: OAuthProvider, json: unknown): OAuthProfile | null {
  if (provider === "discord") {
    const parsed = discordUserSchema.safeParse(json);
    if (!parsed.success) {
      return null;
    }
    const { id, username, global_name, email, verified } = parsed.data;
    return {
      providerId: id,
      email: email ? email.toLowerCase() : null,
      emailVerified: verified === true,
      displayName: global_name || username,
    };
  }
  const parsed = googleUserinfoSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const { sub, email, email_verified, name } = parsed.data;
  const lowered = email ? email.toLowerCase() : null;
  return {
    providerId: sub,
    email: lowered,
    emailVerified: email_verified === true,
    displayName: name || (lowered ? (lowered.split("@")[0] ?? lowered) : "player"),
  };
}
