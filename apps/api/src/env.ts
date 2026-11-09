// Worker bindings + vars (wrangler.jsonc). Each binding's type is read from `GeneratedEnv`, which
// `wrangler types` writes to worker-configuration.d.ts from wrangler.jsonc, with the runtime types
// for its compatibility_date (`bun run --cwd apps/api types`; check:static fails a stale file).
// `D1Database`/`R2Bucket`/`KVNamespace`/`RateLimit` are globals of that file, wired in via
// tsconfig `types`. `Env` relaxes it where the code tolerates absence: the rate limits and the
// vars are optional, and the secrets, which wrangler.jsonc does not list, are added here.

type Generated = GeneratedEnv;

export type Env = {
  DB: Generated["DB"];
  /** R2 bucket `colorless-assets` — the lazy tcgdex asset mirror (D9). */
  ASSETS: Generated["ASSETS"];
  /** KV namespace — catalog response cache (src/catalog/cache.ts). */
  CACHE: Generated["CACHE"];
  /** The lobby Durable Objects (§3.6) — one instance per lobby code,
      addressed with `idFromName(code)` (src/lobby/). */
  LOBBY: Generated["LOBBY"];
  /** Per-IP Workers rate limits on POST /lobby and the /lobby/:code/ws upgrade
      (src/lobby/routes.ts). Absent in unit tests, where nothing is limited. */
  LOBBY_CREATE_LIMIT?: Generated["LOBBY_CREATE_LIMIT"];
  LOBBY_SOCKET_LIMIT?: Generated["LOBBY_SOCKET_LIMIT"];
  /** Per-(scope, IP) Workers rate limit ahead of the D1 sign-in limiter on register, login and
      account deletion (src/auth/routes.ts). Absent in unit tests. */
  AUTH_LIMIT?: Generated["AUTH_LIMIT"];
  /** Deck writes (POST/PATCH/DELETE /decks), per account and per IP (src/decks/routes.ts).
      Absent in unit tests. */
  DECK_WRITE_LIMIT?: Generated["DECK_WRITE_LIMIT"];
  DECK_WRITE_IP_LIMIT?: Generated["DECK_WRITE_IP_LIMIT"];
  /** Per-IP Workers rate limit on GET /cards queries that scan the catalog
      (src/catalog/searchLimit.ts). Absent in unit tests. */
  CATALOG_SEARCH_LIMIT?: Generated["CATALOG_SEARCH_LIMIT"];
  /** The web app's origin — CORS allow-origin + OAuth post-login redirect
      target (§3.5). wrangler.jsonc `vars` sets the dev default; production
      overrides it when the web app's real origin exists. */
  APP_ORIGIN?: string;
  /** Public API origin for OAuth callbacks behind a local HTTPS proxy. */
  API_ORIGIN?: string;
  // OAuth app credentials (§3.5) — ABSENT until the user registers the apps;
  // the /auth/oauth routes answer 503 meanwhile. Install per provider with:
  //   wrangler secret put GOOGLE_CLIENT_ID (and GOOGLE_CLIENT_SECRET)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Password pepper (src/auth/password.ts, security audit AU9): new password hashes are
      HMAC-peppered with it. Losing it locks every peppered password account out (Google still
      works), so it is kept in a password manager too. Without it, hashes are made unpeppered and
      `evt = "auth", kind = "pepper_missing"` is logged. `PASSWORD_PEPPER_PREVIOUS` is set only
      while rotating: hashes under it still verify and are re-peppered on login.
        wrangler secret put PASSWORD_PEPPER */
  PASSWORD_PEPPER?: string;
  PASSWORD_PEPPER_PREVIOUS?: string;
  /** Key of the account and network tags in auth log lines (src/http/logTag.ts, AU10). Without
      it every tag reads "untagged".
        wrangler secret put LOG_TAG_KEY */
  LOG_TAG_KEY?: string;
};

/** Fails to compile, naming the binding, when wrangler.jsonc gains one that `Env` does not list
    (a removed or renamed one already fails at its `Generated[...]` above). */
type Covered<Missing extends never> = Missing;
export type EnvCoversBindings = Covered<Exclude<keyof Generated, keyof Env>>;

export const DEFAULT_APP_ORIGIN = "http://localhost:5175";

/** The web app origin, defaulted for dev. Tolerates an entirely absent env
    (unit tests call app.request() without one). */
export function appOrigin(env: Pick<Env, "APP_ORIGIN"> | undefined): string {
  return env?.APP_ORIGIN ?? DEFAULT_APP_ORIGIN;
}

/** Permit both loopback names for an HTTP dev frontend on the configured
    port. Deployed frontend origins retain their exact CORS allowlist. */
export function appCorsOrigins(env: Pick<Env, "APP_ORIGIN"> | undefined): string[] {
  const configured = appOrigin(env);
  const url = new URL(configured);
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
    return [configured, url.origin];
  }
  return [configured];
}
