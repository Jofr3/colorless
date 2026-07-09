// Worker bindings (wrangler.jsonc). `D1Database`/`R2Bucket`/`KVNamespace`
// come from @cloudflare/workers-types, wired in via tsconfig `types`. Extend
// as the other §3.3 bindings land (lobby Durable Object).

export type Env = {
  DB: D1Database;
  /** R2 bucket `luminous-assets` — the lazy tcgdex asset mirror (D9). */
  ASSETS: R2Bucket;
  /** KV namespace — the catalog response cache (1h TTL, src/catalog/cache.ts). */
  CACHE: KVNamespace;
};
