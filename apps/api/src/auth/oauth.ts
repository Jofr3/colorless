// OAuth authorization-code flow, pure parts (§3.5): provider table, config
// resolution from env secrets, authorize-URL + token-request construction,
// state cookie packing, redirect sanitizing, and profile normalization.
// routes.ts owns the two fetches (token exchange, userinfo) and all D1 work.
//
// Providers activate by configuration alone: until `wrangler secret put`
// installs a client id + secret, oauthConfig() returns null and the routes
// answer 503 "provider not configured" — the code path is live either way.

import { OAUTH_PROVIDERS, type OAuthProvider } from "@colorless/schema";
import * as z from "zod";
import type { Env } from "../env";
import { fromBase64Url, randomBytes, toBase64Url } from "./encoding";

/** Narrow a path param to a known provider; null → route 404s. */
export function parseProvider(value: string): OAuthProvider | null {
  return OAUTH_PROVIDERS.find((provider) => provider === value) ?? null;
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
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email",
  },
};

/** Resolve a provider's config; null while its secrets are not installed. */
export function oauthConfig(env: Env, provider: OAuthProvider): OAuthConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret, ...PROVIDER_ENDPOINTS[provider] };
}

/** The provider authorize URL a start request 302s to, with the PKCE S256 challenge. */
export function buildAuthorizeUrl(
  config: OAuthConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** POST parameters for the code→token exchange (route does the fetch), with the PKCE verifier
    the start request kept in the state cookie. */
export function tokenRequest(
  config: OAuthConfig,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): { url: string; body: URLSearchParams } {
  return {
    url: config.tokenUrl,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    }),
  };
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636): the start request mints a secret verifier, sends only its
// SHA-256 to the provider, and keeps the verifier in the state cookie; the token exchange must
// present it. A code that leaks between the provider's redirect and the callback (a log, a
// Referer, a hostile extension) is useless without the browser's cookie.

const CODE_VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;

/** Mint a PKCE code verifier: 256 bits CSPRNG, base64url (43 chars). */
export function generateCodeVerifier(): string {
  return toBase64Url(randomBytes(32));
}

/** The S256 code challenge of a verifier: base64url(SHA-256(verifier)). */
export async function codeChallengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
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
// The cookie value also carries the PKCE verifier and the post-login redirect
// path, so both survive the provider round-trip without trusting anything in
// the callback URL.

export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 600; // one authorization round-trip

/** Mint a CSRF state value: 128 bits CSPRNG, base64url. */
export function generateState(): string {
  return toBase64Url(randomBytes(16));
}

/** Pack state, PKCE verifier and redirect path into one cookie value:
    `state.verifier.b64url(redirect)` (all three base64url, so "." cannot occur inside one). */
export function packStateCookieValue(
  state: string,
  codeVerifier: string,
  redirect: string,
): string {
  return `${state}.${codeVerifier}.${toBase64Url(new TextEncoder().encode(redirect))}`;
}

/** Unpack a state cookie value; null on any malformed input, including a cookie set before PKCE
    (two parts), whose sign-in then fails once as an expired one. */
export function unpackStateCookieValue(
  value: string | null,
): { state: string; codeVerifier: string; redirect: string } | null {
  if (value === null) {
    return null;
  }
  const [state, codeVerifier, redirectText, ...rest] = value.split(".");
  if (
    !state ||
    codeVerifier === undefined ||
    !CODE_VERIFIER.test(codeVerifier) ||
    redirectText === undefined ||
    rest.length > 0
  ) {
    return null;
  }
  const redirectBytes = fromBase64Url(redirectText);
  if (redirectBytes === null) {
    return null;
  }
  // Re-sanitize after decoding — the cookie is client-held, so its contents
  // are as untrusted as the original query parameter was.
  return {
    state,
    codeVerifier,
    redirect: sanitizeRedirect(new TextDecoder().decode(redirectBytes)),
  };
}

/**
 * Allowlist a post-login redirect to RELATIVE paths: must start with a
 * single "/" (no scheme, no "//host" protocol-relative escape, no
 * backslash trickery, no control chars that could split headers). Anything
 * else falls back to "/".
 */
export function sanitizeRedirect(raw: string | null | undefined): string {
  if (!raw?.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
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
};

// Google OIDC userinfo (openid email scopes). No profile claim is asked for or read: a new
// account gets a generated handle rather than the user's real name.
const googleUserinfoSchema = z.object({
  sub: z.string().min(1),
  // At most the length userSchema returns.
  email: z.string().max(254).nullish(),
  email_verified: z.boolean().nullish(),
});

/** Normalize a provider userinfo payload; null when the shape drifted. */
export function parseOAuthProfile(json: unknown): OAuthProfile | null {
  const parsed = googleUserinfoSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const { sub, email, email_verified } = parsed.data;
  return {
    providerId: sub,
    email: email ? email.toLowerCase() : null,
    emailVerified: email_verified === true,
  };
}
