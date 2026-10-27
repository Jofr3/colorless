import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import {
  buildAuthorizeUrl,
  codeChallengeOf,
  generateCodeVerifier,
  generateState,
  type OAuthConfig,
  oauthConfig,
  packStateCookieValue,
  parseOAuthProfile,
  parseProvider,
  parseTokenResponse,
  sanitizeRedirect,
  stateCookie,
  tokenRequest,
  unpackStateCookieValue,
} from "./oauth";

function envWith(vars: Partial<Env>): Env {
  return { DB: undefined, ASSETS: undefined, CACHE: undefined, ...vars } as unknown as Env;
}

describe("parseProvider", () => {
  it("accepts only google", () => {
    expect(parseProvider("discord")).toBeNull();
    expect(parseProvider("google")).toBe("google");
    expect(parseProvider("github")).toBeNull();
    expect(parseProvider("")).toBeNull();
    expect(parseProvider("Discord")).toBeNull();
  });
});

describe("oauthConfig", () => {
  it("is null until BOTH id and secret are installed", () => {
    expect(oauthConfig(envWith({}), "google")).toBeNull();
    expect(oauthConfig(envWith({ GOOGLE_CLIENT_ID: "id" }), "google")).toBeNull();
    expect(oauthConfig(envWith({ GOOGLE_CLIENT_SECRET: "s" }), "google")).toBeNull();
  });

  it("resolves per-provider endpoints and scopes once configured", () => {
    const google = oauthConfig(
      envWith({ GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret" }),
      "google",
    );
    expect(google).toMatchObject({
      clientId: "g-id",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
    });
  });
});

describe("buildAuthorizeUrl / tokenRequest", () => {
  const config: OAuthConfig = {
    clientId: "client-1",
    clientSecret: "secret-1",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
  };

  it("builds the authorize URL with all required, properly-encoded params", () => {
    const url = new URL(
      buildAuthorizeUrl(
        config,
        "http://localhost:8787/auth/oauth/google/callback",
        "st4te",
        "ch4llenge",
      ),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8787/auth/oauth/google/callback",
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("code_challenge")).toBe("ch4llenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // The redirect URI must arrive percent-encoded on the wire.
    expect(url.search).toContain("redirect_uri=http%3A%2F%2Flocalhost");
  });

  it("builds a form-encoded authorization_code exchange carrying the PKCE verifier", () => {
    const request = tokenRequest(config, "the-code", "https://api.example/cb", "the-verifier");
    expect(request.url).toBe(config.tokenUrl);
    expect(Object.fromEntries(request.body)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "https://api.example/cb",
      client_id: "client-1",
      client_secret: "secret-1",
      code_verifier: "the-verifier",
    });
  });

  it("parses the token response, rejecting drifted shapes", () => {
    expect(parseTokenResponse({ access_token: "tok", token_type: "Bearer" })).toBe("tok");
    expect(parseTokenResponse({ access_token: "" })).toBeNull();
    expect(parseTokenResponse({ error: "invalid_grant" })).toBeNull();
    expect(parseTokenResponse("nope")).toBeNull();
  });
});

describe("PKCE", () => {
  it("mints unique 256-bit verifiers in the RFC 7636 alphabet", () => {
    const verifiers = new Set(Array.from({ length: 20 }, generateCodeVerifier));
    expect(verifiers.size).toBe(20);
    for (const verifier of verifiers) {
      expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("derives the S256 challenge of RFC 7636 appendix B", async () => {
    expect(await codeChallengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

describe("state cookie", () => {
  it("mints unique base64url states", () => {
    const states = new Set(Array.from({ length: 20 }, generateState));
    expect(states.size).toBe(20);
    for (const state of states) {
      expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it("round-trips state, verifier and redirect through the packed value", () => {
    const packed = packStateCookieValue("myst4te", VERIFIER, "/decks?tab=all");
    expect(unpackStateCookieValue(packed)).toEqual({
      state: "myst4te",
      codeVerifier: VERIFIER,
      redirect: "/decks?tab=all",
    });
  });

  it("sanitizes the redirect on the way OUT of the cookie too", () => {
    const packed = packStateCookieValue("s", VERIFIER, "https://evil.example/phish");
    expect(unpackStateCookieValue(packed)).toEqual({
      state: "s",
      codeVerifier: VERIFIER,
      redirect: "/",
    });
  });

  it("rejects malformed cookie values with null", () => {
    expect(unpackStateCookieValue(null)).toBeNull();
    expect(unpackStateCookieValue("")).toBeNull();
    expect(unpackStateCookieValue("no-separator")).toBeNull();
    expect(unpackStateCookieValue(".leading")).toBeNull();
    expect(unpackStateCookieValue("state.not+base64url")).toBeNull();
    expect(unpackStateCookieValue(`state.${VERIFIER}.not+base64url`)).toBeNull();
    // A cookie from before PKCE (state.redirect) carries no verifier.
    expect(unpackStateCookieValue("state.Lw")).toBeNull();
    expect(unpackStateCookieValue("state.short.Lw")).toBeNull();
    expect(unpackStateCookieValue(`state.${VERIFIER}.Lw.extra`)).toBeNull();
    expect(unpackStateCookieValue(`.${VERIFIER}.Lw`)).toBeNull();
  });

  it("serializes scoped, short-lived, Lax cookies", () => {
    expect(stateCookie("v4lue")).toBe(
      "oauth_state=v4lue; Max-Age=600; Path=/auth/oauth; HttpOnly; Secure; SameSite=Lax",
    );
  });
});

describe("sanitizeRedirect", () => {
  it("keeps plain relative paths", () => {
    expect(sanitizeRedirect("/")).toBe("/");
    expect(sanitizeRedirect("/decks")).toBe("/decks");
    expect(sanitizeRedirect("/decks/42?tab=cards#top")).toBe("/decks/42?tab=cards#top");
  });

  it.each([
    ["absolute URL", "https://evil.example/"],
    ["protocol-relative", "//evil.example/"],
    ["scheme smuggling", "javascript:alert(1)"],
    ["backslash trickery", "/\\evil.example"],
    ["header splitting", "/ok\r\nSet-Cookie: x=1"],
    ["empty", ""],
    ["missing", undefined],
  ])("falls back to / for %s", (_label, raw) => {
    expect(sanitizeRedirect(raw)).toBe("/");
  });
});

describe("parseOAuthProfile", () => {
  it("normalizes a google userinfo payload and drops the real name", () => {
    const profile = parseOAuthProfile({
      sub: "10769150350006150715113082367",
      name: "Ash Ketchum",
      given_name: "Ash",
      picture: "https://lh3.googleusercontent.com/a/x",
      email: "Ash.K@Gmail.com",
      email_verified: true,
      locale: "en",
    });
    expect(profile).toEqual({
      providerId: "10769150350006150715113082367",
      email: "ash.k@gmail.com",
      emailVerified: true,
    });
  });

  it("treats an email without email_verified as unverified, and a missing one as null", () => {
    expect(parseOAuthProfile({ sub: "1", email: "misty@example.com" })).toEqual({
      providerId: "1",
      email: "misty@example.com",
      emailVerified: false,
    });
    expect(parseOAuthProfile({ sub: "1" })).toMatchObject({ email: null });
  });

  it("rejects drifted payloads with null", () => {
    expect(parseOAuthProfile({ email: "no-sub@example.com" })).toBeNull();
    expect(parseOAuthProfile("nope")).toBeNull();
  });
});
