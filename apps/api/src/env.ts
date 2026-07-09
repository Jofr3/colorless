// Worker bindings (wrangler.jsonc). `D1Database`/`R2Bucket` come from
// @cloudflare/workers-types, wired in via tsconfig `types`. Extend as the
// other §3.3 bindings land (KV cache, lobby Durable Object).

export type Env = {
  DB: D1Database;
  /** R2 bucket `luminous-assets` — the lazy tcgdex asset mirror (D9). */
  ASSETS: R2Bucket;
};
