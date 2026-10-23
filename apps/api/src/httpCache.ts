// Browser HTTP caching in front of the KV and R2 caches. Public catalog bodies are briefly fresh
// then stale-while-revalidate; per-user reads are `private, no-cache` with an ETag. workers.dev has
// no edge Cache API, so the browser cache is the only HTTP cache.

import type { MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { etag, RETAINED_304_HEADERS } from "hono/etag";

/** Public catalog freshness: 5 minutes fresh, then up to an hour more served
    stale while one background revalidation refreshes it. The KV entry behind
    it lives an hour too, so a re-ingest or a CACHE_VERSION bump reaches a
    browser within about two hours at worst, usually far sooner. */
export const PUBLIC_CATALOG_CACHE = "public, max-age=300, stale-while-revalidate=3600";

/** Per-user data: stored, but always revalidated before use. */
export const PRIVATE_REVALIDATE_CACHE = "private, no-cache";

/** A 304 to a cross-origin credentialed fetch still needs its CORS headers
    (the cors middleware set them before the handler ran, and hono/etag strips
    every header it isn't told to keep). */
const RETAINED_HEADERS = [
  ...RETAINED_304_HEADERS,
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "x-colorless-cache",
];

/** ETag every response from the body's digest and answer a matching
    If-None-Match with a bodiless 304. */
export const conditionalGet = etag({ retainedHeaders: RETAINED_HEADERS });

/** Stamp `Cache-Control` on 200s only — errors stay uncached. */
export function cacheControl(value: string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (c.res.status === 200) {
      c.res.headers.set("Cache-Control", value);
    }
  };
}

/** The per-user GET policy: ETag + `private, no-cache`. */
export const privateRevalidate = every(conditionalGet, cacheControl(PRIVATE_REVALIDATE_CACHE));
