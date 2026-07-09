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

/**
 * KV key for a request URL: path + query, with the query keys (then values)
 * sorted so `?a=1&b=2` and `?b=2&a=1` share an entry. Keys are normalized at
 * the *request* level, not the resolved-filter level — `/cards` and
 * `/cards?page=1` cache separately even though they answer alike; duplicate
 * entries are harmless at this TTL.
 */
export function catalogCacheKey(url: URL): string {
  const entries = [...url.searchParams.entries()].sort(([keyA, valueA], [keyB, valueB]) =>
    keyA === keyB ? valueA.localeCompare(valueB) : keyA.localeCompare(keyB),
  );
  const query = new URLSearchParams(entries).toString();
  return `catalog:${url.pathname}${query ? `?${query}` : ""}`;
}

export const catalogCache: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const key = catalogCacheKey(new URL(c.req.url));
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
