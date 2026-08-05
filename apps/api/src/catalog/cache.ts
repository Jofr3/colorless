// The KV response cache for the public catalog GETs — cache-aside, like the
// /assets R2 mirror but for JSON bodies with a TTL (catalog rows change on
// re-ingest, so entries expire instead of living forever).
//
// One middleware shared by every catalog route: KV hit → serve the stored
// body with `x-luminous-cache: hit`; miss → run the handler and, only for a
// 200, store the body and tag the response `miss`. Non-200s (400 bad params,
// 404 unknown id) are never cached. Values are response BODIES — headers are
// rebuilt on a hit, which is safe because every catalog response is JSON.

import type { MiddlewareHandler } from "hono";
import type { Env } from "../env";

/** 1 hour — long enough to absorb hot traffic, short enough that a re-ingest
    shows up without a manual purge. */
const CACHE_TTL_SECONDS = 3600;

/** Bump when a cached response SHAPE — or its VALUES for already-ingested
    rows — changes, so stale KV entries from the previous deploy can't serve
    the old answer for up to a TTL; old-version keys just expire.

    THE TRIGGER IS A DEPLOY, NOT THE DATA. A pure data change — a re-ingest
    rewriting rows, the pending `cards.suffix` backfill — does NOT bump this:
    the code that reads the rows is unchanged, so the only cost is the TTL,
    which is what `CACHE_TTL_SECONDS` above exists to bound. The bumps that are
    easy to MISS are the two below that changed no shape at all — v3→v4 and
    v4→v5, where the same rows kept serving under the same key while the code
    reading them changed meaning underneath. A TTL cannot help there, because
    both deploys agree the key is correct. The prefix is also mirrored in
    docs/workstreams/backend-data.md §6 — move both.
    v2→v3: CardBrief grew `legal` for the P2 deck builder.
    v3→v4: the read path started normalising "None" sentinels to null
    (../sentinel.ts, D194). Same shape, different bytes: without a bump the
    already-cached /facets body would keep serving the dead "None" chip for
    up to an hour after deploy, which is the exact symptom being fixed.
    v4→v5: `text` widened from the abilities/attacks JSON to the `effect`
    column too (../catalog/query.ts, D197). Same shape again, but a cached
    `/cards?text=…` body is now WRONG rather than merely stale — it holds the
    pre-widening result set, missing every Trainer and Special Energy the
    query was widened to find. Only `?text=` bodies actually change; the
    prefix is catalog-wide, so this costs one cold hour on every catalog key,
    which is the cheaper side of the trade against serving a hot search term's
    old, narrow answer past the deploy.
    v5→v6: /facets grew `suffixes` (D198). This is the first bump for a real
    SHAPE change since v3, and the shape is what makes a stale body WRONG in
    the strongest sense available here: the web client is types-only (no
    runtime validation — src/lib/api.ts says so on purpose), so a v5 body
    reaches the rail as a `CatalogFacets` whose required `suffixes` is
    `undefined` at runtime while TypeScript swears it is a `string[]`. That is
    a crash in the filter rail, not a stale chip list. The second, independent
    reason: `?suffix=` was an UNKNOWN param before this deploy and zod strips
    unknowns, so any `catalog:v5:/cards?suffix=…` entry holds the UNFILTERED
    page under a key that now means something narrower. Nothing in the app
    could have written one (no client sent the param — D197 refused to ship
    it), but the key space genuinely changed meaning, and a cache that can
    serve the wrong answer for an hour is not worth being clever about. */
const CACHE_VERSION = "v6";

/**
 * KV key for a request URL: version + path + query, with the query keys
 * (then values) sorted so `?a=1&b=2` and `?b=2&a=1` share an entry. Keys are
 * normalized at the *request* level, not the resolved-filter level —
 * `/cards` and `/cards?page=1` cache separately even though they answer
 * alike; duplicate entries are harmless at this TTL.
 */
export function catalogCacheKey(url: URL): string {
  const entries = [...url.searchParams.entries()].sort(([keyA, valueA], [keyB, valueB]) =>
    keyA === keyB ? valueA.localeCompare(valueB) : keyA.localeCompare(keyB),
  );
  const query = new URLSearchParams(entries).toString();
  return `catalog:${CACHE_VERSION}:${url.pathname}${query ? `?${query}` : ""}`;
}

/** KV rejects keys over 512 bytes. A normalized key that long (e.g. a
    60-id hydration query) BYPASSES the cache instead of erroring the GET —
    per-deck id lists barely repeat, so they'd be cache misses anyway. */
const KV_MAX_KEY_BYTES = 512;

export const catalogCache: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const url = new URL(c.req.url);
  const key = catalogCacheKey(url);
  // Guaranteed-miss shapes skip KV entirely (no read, no write): keys past
  // the 512-byte cap (see above), and id-hydration requests — per-deck id
  // sets that essentially never recur, so caching one is a wasted read plus
  // a never-re-read write. URL paths and queries are percent-encoded
  // (ASCII), so length == bytes.
  if (key.length > KV_MAX_KEY_BYTES || url.searchParams.has("id")) {
    await next();
    if (c.res.status === 200) {
      c.res.headers.set("x-luminous-cache", "bypass");
    }
    return;
  }
  const cached = await c.env.CACHE.get(key);
  if (cached !== null) {
    return c.body(cached, 200, {
      "Content-Type": "application/json",
      "x-luminous-cache": "hit",
    });
  }
  await next();
  if (c.res.status === 200) {
    c.res.headers.set("x-luminous-cache", "miss");
    await c.env.CACHE.put(key, await c.res.clone().text(), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  }
};
