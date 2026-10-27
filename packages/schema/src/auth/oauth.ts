/** The providers GET /auth/oauth/:provider can start a flow for. */
export const OAUTH_PROVIDERS = ["google"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** The codes the OAuth callback hands back to the app as `?authError=`. `email-unverified`: the
    provider has not verified the email, so no account is made from it. */
export const OAUTH_FAILURES = [
  "state",
  "exchange",
  "profile",
  "no-email",
  "email-in-use",
  "email-unverified",
] as const;
export type OAuthFailure = (typeof OAUTH_FAILURES)[number];
