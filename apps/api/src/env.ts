// Worker bindings (wrangler.jsonc). `D1Database` comes from
// @cloudflare/workers-types, wired in via tsconfig `types`. Extend as the
// other §3.3 bindings land (R2 images, KV cache, lobby Durable Object).

export type Env = {
  DB: D1Database;
};
