// Worker bindings + vars (wrangler.jsonc). `D1Database`/`R2Bucket`/
// `KVNamespace`/`DurableObjectNamespace` come from @cloudflare/workers-types,
// wired in via tsconfig `types`.

export type Env = {
  DB: D1Database;
  /** R2 bucket `luminous-assets` — the lazy tcgdex asset mirror (D9). */
  ASSETS: R2Bucket;
  /** KV namespace — catalog response cache (src/catalog/cache.ts) + auth
      rate-limit counters (src/auth/rateLimit.ts). */
  CACHE: KVNamespace;
  /** The lobby Durable Objects (§3.6) — one instance per lobby code,
      addressed with `idFromName(code)` (src/lobby/). */
  LOBBY: DurableObjectNamespace;
  /** The web app's origin — CORS allow-origin + OAuth post-login redirect
      target (§3.5). wrangler.jsonc `vars` sets the dev default; production
      overrides it when the web app's real origin exists. */
  APP_ORIGIN?: string;
  // OAuth app credentials (§3.5) — ABSENT until the user registers the apps;
  // the /auth/oauth routes answer 503 meanwhile. Install per provider with:
  //   wrangler secret put DISCORD_CLIENT_ID     (etc.)
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export const DEFAULT_APP_ORIGIN = "http://localhost:5173";

/** The web app origin, defaulted for dev. Tolerates an entirely absent env
    (unit tests call app.request() without one). */
export function appOrigin(env: Pick<Env, "APP_ORIGIN"> | undefined): string {
  return env?.APP_ORIGIN ?? DEFAULT_APP_ORIGIN;
}
