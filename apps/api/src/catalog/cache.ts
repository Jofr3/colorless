// KV cache-aside for the public catalog GETs. Only 200 responses are stored, and only the body;
// headers are rebuilt on a hit, which is safe because every catalog response is JSON.
// KV is best effort: a failed read is a miss, and the write runs after the response with its
// failure dropped, so a KV outage or a spent write quota costs the cache and never the request.

import type { Context, MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import type { Env } from "../env";
import {
  CACHE_STATUS_HEADER,
  cacheControl,
  conditionalGet,
  PUBLIC_CATALOG_CACHE,
} from "../httpCache";
import { CATALOG_EPOCH_KEY } from "./epoch";

/** A day. The catalog only changes on ingest, which retires entries through the epoch below. */
const CACHE_TTL_SECONDS = 86_400;

/**
 * Bump on any deploy that changes a cached response's shape or the values the code derives from
 * existing rows, so stale KV entries are not served for up to a TTL. A data re-ingest does not
 * need a bump: it writes a new catalog epoch.
 */
const CACHE_VERSION = "v12";

/** How long an isolate reuses the epoch it read, and how long KV's edge cache may hold it. */
const EPOCH_MEMO_MS = 60_000;
const EPOCH_EDGE_TTL_SECONDS = 300;

/**
 * KV key for a request URL: version, catalog epoch, path and query, with the query keys (then
 * values) sorted so `?a=1&b=2` and `?b=2&a=1` share an entry. Keys are normalized at the
 * *request* level, not the resolved-filter level — `/cards` and `/cards?page=1` cache separately
 * even though they answer alike; duplicate entries are harmless. A null epoch (none stamped yet)
 * leaves its segment out.
 */
export function catalogCacheKey(url: URL, epoch: string | null = null): string {
  const entries = [...url.searchParams.entries()].sort(([keyA, valueA], [keyB, valueB]) =>
    keyA === keyB ? valueA.localeCompare(valueB) : keyA.localeCompare(keyB),
  );
  const query = new URLSearchParams(entries).toString();
  const scope = epoch === null ? CACHE_VERSION : `${CACHE_VERSION}:${epoch}`;
  return `catalog:${scope}:${url.pathname}${query ? `?${query}` : ""}`;
}

/** KV rejects keys over 512 bytes. A normalized key that long BYPASSES the cache instead of
    erroring the GET. URL paths and queries are percent-encoded (ASCII), so length == bytes. */
const KV_MAX_KEY_BYTES = 512;

/**
 * Query params whose values are typed by a person or derived from one deck: id hydration and the
 * free-text searches. Such keys almost never recur, so caching one spends a KV write that is
 * never read back.
 */
const UNCACHED_PARAMS = ["id", "name", "nameExact", "text"];

export function bypassesCatalogCache(url: URL): boolean {
  return UNCACHED_PARAMS.some((param) => url.searchParams.has(param));
}

type EpochRead = { epoch: string | null; readAt: number } | { failedAt: number };

const epochReads = new WeakMap<KVNamespace, EpochRead>();

/** The stamped catalog epoch, reread at most once a minute per isolate; undefined when KV
    cannot be read, which skips the cache. */
async function catalogEpoch(kv: KVNamespace): Promise<string | null | undefined> {
  const now = Date.now();
  const memo = epochReads.get(kv);
  if (memo !== undefined) {
    if ("epoch" in memo && now - memo.readAt < EPOCH_MEMO_MS) return memo.epoch;
    if ("failedAt" in memo && now - memo.failedAt < EPOCH_MEMO_MS) return undefined;
  }
  try {
    const epoch = await kv.get(CATALOG_EPOCH_KEY, { cacheTtl: EPOCH_EDGE_TTL_SECONDS });
    epochReads.set(kv, { epoch, readAt: now });
    return epoch;
  } catch {
    epochReads.set(kv, { failedAt: now });
    return undefined;
  }
}

/** Runs `work` after the response through the ExecutionContext. Outside the Workers runtime
    there is none, so it is awaited instead. Its failure is dropped either way. */
async function afterResponse(c: Context, work: () => Promise<unknown>): Promise<void> {
  const settled = work().catch(() => {});
  let ctx: Context["executionCtx"] | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  if (ctx === undefined) {
    await settled;
  } else {
    ctx.waitUntil(settled);
  }
}

const kvCache: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const url = new URL(c.req.url);
  const kv = c.env.CACHE;
  const epoch = bypassesCatalogCache(url) ? undefined : await catalogEpoch(kv);
  const key = epoch === undefined ? undefined : catalogCacheKey(url, epoch);
  if (key === undefined || key.length > KV_MAX_KEY_BYTES) {
    await next();
    if (c.res.status === 200) {
      c.res.headers.set(CACHE_STATUS_HEADER, "bypass");
    }
    return;
  }
  const cached = await kv.get(key).catch(() => null);
  if (cached !== null) {
    return c.body(cached, 200, {
      "Content-Type": "application/json",
      [CACHE_STATUS_HEADER]: "hit",
    });
  }
  await next();
  if (c.res.status === 200) {
    c.res.headers.set(CACHE_STATUS_HEADER, "miss");
    const body = c.res.clone();
    await afterResponse(c, async () =>
      kv.put(key, await body.text(), { expirationTtl: CACHE_TTL_SECONDS }),
    );
  }
};

/** The middleware every catalog route mounts: browser revalidation and
    freshness outside, the KV cache-aside inside. */
export const catalogCache = every(conditionalGet, cacheControl(PUBLIC_CATALOG_CACHE), kvCache);
