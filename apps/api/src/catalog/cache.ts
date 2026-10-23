// KV cache-aside for the public catalog GETs. Only 200 responses are stored, and only the body;
// headers are rebuilt on a hit, which is safe because every catalog response is JSON.

import type { MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import type { Env } from "../env";
import { cacheControl, conditionalGet, PUBLIC_CATALOG_CACHE } from "../httpCache";

/** 1 hour — long enough to absorb hot traffic, short enough that a re-ingest
    shows up without a manual purge. */
const CACHE_TTL_SECONDS = 3600;

/**
 * Bump on any deploy that changes a cached response's shape or the values the code derives from
 * existing rows, so stale KV entries are not served for up to a TTL. A pure data re-ingest does not
 * need a bump.
 */
const CACHE_VERSION = "v12";

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

const kvCache: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
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
      c.res.headers.set("x-colorless-cache", "bypass");
    }
    return;
  }
  const cached = await c.env.CACHE.get(key);
  if (cached !== null) {
    return c.body(cached, 200, {
      "Content-Type": "application/json",
      "x-colorless-cache": "hit",
    });
  }
  await next();
  if (c.res.status === 200) {
    c.res.headers.set("x-colorless-cache", "miss");
    await c.env.CACHE.put(key, await c.res.clone().text(), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  }
};

/** The middleware every catalog route mounts: browser revalidation and
    freshness outside, the KV cache-aside inside. */
export const catalogCache = every(conditionalGet, cacheControl(PUBLIC_CATALOG_CACHE), kvCache);
