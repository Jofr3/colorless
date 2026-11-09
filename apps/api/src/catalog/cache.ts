// KV cache-aside for the public catalog GETs. Only 200 responses are stored, and only the body;
// headers are rebuilt on a hit, which is safe because every catalog response is JSON.
// KV is best effort: a failed read is a miss, and the write runs after the response, so a KV
// outage or a spent write quota costs the cache and never the request. Each failure is logged
// (throttled) as `evt = "kv"`, because a spent quota (1,000 writes/day on the Free plan, the
// whole account's) is otherwise invisible.
//
// Every miss spends one of those writes, so only shapes that recur are cached, and the key is
// built from the validated query rather than the raw URL: a param the schema does not know, a
// default spelled out, or a reordered repeat cannot mint a new entry. An empty result is never
// stored, so values that match nothing cannot spend writes either.
//
// A cached route's ETag comes from its KV key, not its body: what one key serves changes only
// with a new epoch or CACHE_VERSION, which is a new key, and hashing a body as large as the
// 1.9 MB card index on every hit and 304 costs several ms of CPU.

import { UNCACHED_CATALOG_PARAMS } from "@colorless/schema";
import type { Context, MiddlewareHandler, Next } from "hono";
import { every } from "hono/combine";
import { routePath } from "hono/route";
import type * as z from "zod";
import type { Env } from "../env";
import { afterResponse } from "../http/afterResponse";
import { logEventThrottled } from "../http/log";
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
 * need a bump: it writes a new catalog epoch. cacheShape.test.ts fails on a shape change until
 * this is bumped; a change to derived values it cannot see.
 */
export const CACHE_VERSION = "v12";

/** How long an isolate reuses the epoch it read, and how long KV's edge cache may hold it. */
const EPOCH_MEMO_MS = 60_000;
const EPOCH_EDGE_TTL_SECONDS = 300;

/**
 * KV key: version, catalog epoch, path, then the canonical query (`cacheQuery`). A null epoch
 * (none stamped yet) leaves its segment out.
 */
export function catalogCacheKey(path: string, query = "", epoch: string | null = null): string {
  const scope = epoch === null ? CACHE_VERSION : `${CACHE_VERSION}:${epoch}`;
  return `catalog:${scope}:${path}${query ? `?${query}` : ""}`;
}

/**
 * The query part of a key, from a validated query: only the fields the schema output carries (zod
 * strips unknown params), a value equal to the schema's default left out, repeated values deduped
 * and sorted, and keys sorted. `?bust=1`, `?page=1`, `?page=01` and the bare path share one entry.
 */
export function cacheQuery(
  query: Record<string, unknown>,
  defaults: Record<string, unknown> = {},
): string {
  const params = new URLSearchParams();
  for (const name of Object.keys(query).sort()) {
    const value = query[name];
    if (value === undefined || JSON.stringify(value) === JSON.stringify(defaults[name])) continue;
    const values = Array.isArray(value) ? [...new Set(value.map(String))].sort() : [String(value)];
    for (const each of values) params.append(name, each);
  }
  return params.toString();
}

/** KV rejects keys over 512 bytes. A key that long BYPASSES the cache instead of erroring the
    GET. Keys are percent-encoded (ASCII), so length == bytes. */
const KV_MAX_KEY_BYTES = 512;

type EpochRead = { epoch: string | null; readAt: number } | { failedAt: number };

// Keyed by the binding, which workerd hands every request of an isolate as one object; a test
// that swaps namespaces starts a fresh memo.
const epochReads = new WeakMap<KVNamespace, EpochRead>();

/** The stamped catalog epoch, reread at most once a minute per isolate; undefined when KV
    cannot be read, which skips the cache. */
async function catalogEpoch(kv: KVNamespace, route: string): Promise<string | null | undefined> {
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
    logEventThrottled("kv", "epoch_failed", { route });
    return undefined;
  }
}

/** The request path rebuilt from the route pattern and its decoded params, so a percent-encoded
    spelling of `/sets/sv01` cannot mint a second entry for the same set. */
function canonicalPath(c: Context, route: string): string {
  return route.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(c.req.param(name) ?? ""));
}

/** The weak ETag of whatever `key` serves, hit or miss, which hono/etag uses instead of a digest
    of the body. */
export async function catalogETag(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return `W/"${hex.join("")}"`;
}

/** Cache-aside under the route's path plus `query`; a null query goes straight to the handler. */
async function cacheAside(
  c: Context<{ Bindings: Env }>,
  next: Next,
  query: string | null,
): Promise<Response | undefined> {
  const kv = c.env.CACHE;
  const route = routePath(c);
  const epoch = query === null ? undefined : await catalogEpoch(kv, route);
  const key =
    epoch === undefined ? undefined : catalogCacheKey(canonicalPath(c, route), query ?? "", epoch);
  if (key === undefined || key.length > KV_MAX_KEY_BYTES) {
    await next();
    if (c.res.status === 200) {
      c.res.headers.set(CACHE_STATUS_HEADER, "bypass");
    }
    return;
  }
  const tag = await catalogETag(key);
  const cached = await kv.get(key).catch(() => {
    logEventThrottled("kv", "get_failed", { route });
    return null;
  });
  if (cached !== null) {
    return c.body(cached, 200, {
      "Content-Type": "application/json",
      ETag: tag,
      [CACHE_STATUS_HEADER]: "hit",
    });
  }
  await next();
  if (c.res.status === 200) {
    c.res.headers.set(CACHE_STATUS_HEADER, "miss");
    c.res.headers.set("ETag", tag);
    const body = c.res.clone();
    await afterResponse(
      c,
      async () => {
        const text = await body.text();
        if (!emptyResult(text)) await kv.put(key, text, { expirationTtl: CACHE_TTL_SECONDS });
      },
      () => logEventThrottled("kv", "put_failed", { route }),
    );
  }
}

/** An empty list or an empty page: a filter value nothing matches, so a typo, a page past the end
    or a caller minting keys. It is not stored, which keeps such values from spending KV writes. */
function emptyResult(body: string): boolean {
  try {
    const value: unknown = JSON.parse(body);
    if (Array.isArray(value)) return value.length === 0;
    const items = (value as { items?: unknown } | null)?.items;
    return Array.isArray(items) && items.length === 0;
  } catch {
    return false;
  }
}

/** Browser revalidation and freshness, which every catalog route gets whether or not KV holds
    it. */
export const catalogHttpCache = every(conditionalGet, cacheControl(PUBLIC_CATALOG_CACHE));

/** For a route whose response depends on its path alone (/facets, /series, /sets/:id): the query
    is ignored, so `/facets?bust=1` is the `/facets` entry. */
export const catalogPathCache = every(
  catalogHttpCache,
  (c: Context<{ Bindings: Env }>, next: Next) => cacheAside(c, next, ""),
);

/** For a route that does not use KV at all: one-row lookups and id batches, where a KV write
    would cost more than the D1 read it saves. */
export const catalogUncached = every(catalogHttpCache, async (c: Context, next: Next) => {
  await next();
  if (c.res.status === 200) {
    c.res.headers.set(CACHE_STATUS_HEADER, "bypass");
  }
});

/**
 * KV cache-aside keyed by a validated query, for a route that mounts `catalogHttpCache`, then
 * `validate("query", schema)`, then this. A query carrying a free-text or id param
 * (UNCACHED_CATALOG_PARAMS) or failing `cacheable` goes straight to D1.
 */
export function catalogQueryCache<Schema extends z.ZodType<Record<string, unknown>>>(
  schema: Schema,
  cacheable: (query: z.output<Schema>) => boolean = () => true,
): MiddlewareHandler<{ Bindings: Env }, string, { out: { query: z.output<Schema> } }> {
  const parsedDefaults = schema.safeParse({});
  const defaults: Record<string, unknown> = parsedDefaults.success ? parsedDefaults.data : {};
  return (c, next) => {
    const query = c.req.valid("query");
    return cacheAside(
      c,
      next,
      bypassesCache(query, cacheable) ? null : cacheQuery(query, defaults),
    );
  };
}

/** Whether `catalogQueryCache` sends a validated query straight to D1: it carries a typed or id
    param (UNCACHED_CATALOG_PARAMS) or fails the route's `cacheable`. */
export function bypassesCache<Query extends Record<string, unknown>>(
  query: Query,
  cacheable: (query: Query) => boolean = () => true,
): boolean {
  return UNCACHED_CATALOG_PARAMS.some((param) => query[param] !== undefined) || !cacheable(query);
}
