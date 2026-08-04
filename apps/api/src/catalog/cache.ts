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
    v2→v3: CardBrief grew `legal` for the P2 deck builder.
    v3→v4: the read path started normalising "None" sentinels to null
    (../sentinel.ts, D194). Same shape, different bytes: without a bump the
    already-cached /facets body would keep serving the dead "None" chip for
    up to an hour after deploy, which is the exact symptom being fixed. */
const CACHE_VERSION = "v4";

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
