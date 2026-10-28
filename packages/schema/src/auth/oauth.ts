/** The providers GET /auth/oauth/:provider can start a flow for. */
export const OAUTH_PROVIDERS = ["google"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** The codes the OAuth callback hands back to the app as `?authError=`. `email-unverified`: the
    provider has not verified the email, so no account is made from it. `unavailable`: the account
    database failed, so the sign-in was not recorded. A client reads a code it does not know as a
    plain failure, so a new one can ship with the API before the client learns it. */
export const OAUTH_FAILURES = [
  "state",
  "exchange",
  "profile",
  "no-email",
  "email-in-use",
  "email-unverified",
  "unavailable",
] as const;
export type OAuthFailure = (typeof OAUTH_FAILURES)[number];
