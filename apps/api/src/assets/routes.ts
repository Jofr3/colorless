// GET /assets/* — the lazy tcgdex→R2 asset mirror (D9, §3.4).
//
// Cache-aside per request: validate the id and the file name against strict allowlists
// (anything else 404s without touching the origin) → serve from R2 on hit →
// on miss, resolve the tcgdex origin base URL from D1 (first real Drizzle
// query in the app), fetch the original, respond, and store it in R2 after
// the response. A missing asset's 404 is cached by the browser for an hour. Rerunning
// ingest never touches R2 — objects are only ever written here, keyed
// `cards/{cardId}/{file}` / `sets/{setId}/{file}`, and immutable thereafter.

import { isTcgdexId } from "@colorless/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import { cards, sets } from "../db/schema";
import type { Env } from "../env";
import { afterResponse } from "../http/afterResponse";
import { deadline } from "../http/deadline";
import { logEventThrottled } from "../http/log";
import { CACHE_STATUS_HEADER } from "../httpCache";
import {
  cardAssetKey,
  cardOriginUrl,
  contentTypeFor,
  type ImageType,
  isAssetOriginUrl,
  isCardAssetFile,
  isSetAssetFile,
  MAX_ASSET_BYTES,
  setAssetKey,
  setAssetKind,
  setOriginUrl,
  sniffImageType,
} from "./files";

export const assetsRoutes = new Hono<{ Bindings: Env }>();

/** Mirrored assets never change for a given key — cache them forever. */
const CACHE_FOREVER = "public, max-age=31536000, immutable";

/** An unknown card or set, or one the origin has no image for: briefly, since ingest can add it. */
const MISSING_ASSET_CACHE = "public, max-age=3600";

/** How long a mirror miss waits on the asset origin, body included, before it answers 502. */
export const ORIGIN_TIMEOUT_MS = 10_000;

function assetResponse(
  body: ReadableStream | ArrayBuffer,
  contentType: string,
  cache: "hit" | "miss",
): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": CACHE_FOREVER,
      [CACHE_STATUS_HEADER]: cache,
    },
  });
}

/**
 * The shared R2-then-origin flow. `resolveOriginUrl` is only consulted on an R2 miss, and an R2
 * read that throws counts as one (logged), since the origin can still serve the image. An unknown
 * row, a missing asset URL or an origin 404 or 410 is `null` (the app's 404, cached an hour); any
 * other origin status but 200, a network error or no answer within ORIGIN_TIMEOUT_MS is an
 * uncached 502, so a rate limit or an outage upstream does not read as a missing image. Such a
 * status below 500 is logged, since nothing else shows it. The R2 write goes to `later`, which
 * runs it after the response and drops its failure.
 *
 * What is stored stays for good, so only an image of `contentType` from the asset origin is: the
 * URL and the final URL after redirects must be https on ASSET_ORIGIN's host, the response must
 * say `image/*`, its bytes must start with `contentType`'s magic number, and it must fit in
 * MAX_ASSET_BYTES. Anything else is refused as missing and logged.
 */
export async function serveMirroredAsset(
  env: Pick<Env, "ASSETS">,
  key: string,
  contentType: ImageType,
  resolveOriginUrl: () => Promise<string | null>,
  later: (work: () => Promise<unknown>) => Promise<void>,
): Promise<Response | null> {
  const cached = await env.ASSETS.get(key).catch((error: unknown) => {
    logEventThrottled("assets", "r2_get_failed", {
      error: error instanceof Error ? error.name : typeof error,
    });
    return null;
  });
  if (cached) {
    return assetResponse(cached.body, contentType, "hit");
  }
  const originUrl = await resolveOriginUrl();
  if (originUrl === null) {
    return null;
  }
  if (!isAssetOriginUrl(originUrl)) return refused("origin_url");
  const limit = deadline(ORIGIN_TIMEOUT_MS);
  let origin: Response;
  let bytes: ArrayBuffer | null;
  try {
    try {
      origin = await limit.within(fetch(originUrl, { signal: limit.signal }));
    } catch {
      return upstreamFailure();
    }
    if (origin.status >= 500) {
      return upstreamFailure();
    }
    if (origin.status === 404 || origin.status === 410) {
      return null;
    }
    if (origin.status !== 200) {
      logEventThrottled("assets", "origin_status", { status: origin.status });
      return upstreamFailure();
    }
    // A constructed Response (tests) has no url; a fetched one names where redirects ended.
    if (!isAssetOriginUrl(origin.url || originUrl)) return refused("redirect");
    if (!origin.headers.get("Content-Type")?.toLowerCase().startsWith("image/")) {
      return refused("content_type");
    }
    // Buffer the image (card scans are ~100KB) so one body feeds both the R2
    // put and the response without tee-ing the stream.
    try {
      bytes = await limit.within(readCapped(origin, MAX_ASSET_BYTES));
    } catch {
      return upstreamFailure();
    }
  } finally {
    limit.clear();
  }
  if (bytes === null) return refused("too_large");
  if (sniffImageType(bytes) !== contentType) return refused("magic");
  const stored = bytes.slice(0);
  await later(() => env.ASSETS.put(key, stored, { httpMetadata: { contentType } }));
  return assetResponse(bytes, contentType, "miss");
}

/** A response the mirror will not store, logged by why. */
function refused(reason: string): null {
  logEventThrottled("assets", "origin_refused", { reason });
  return null;
}

/** The body, or null once it passes `limit` bytes: a declared length over it is refused unread,
    and an undeclared one is read only up to it. */
async function readCapped(response: Response, limit: number): Promise<ArrayBuffer | null> {
  if (Number(response.headers.get("Content-Length") ?? 0) > limit) {
    await response.body?.cancel();
    return null;
  }
  if (response.body === null) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function upstreamFailure(): Response {
  return Response.json({ error: "asset origin unavailable" }, { status: 502 });
}

function missingAsset(c: Context): Response {
  return c.json({ error: "not found" }, 404, { "Cache-Control": MISSING_ASSET_CACHE });
}

assetsRoutes.get("/cards/:cardId/:file", async (c) => {
  const { cardId, file } = c.req.param();
  if (!isTcgdexId(cardId) || !isCardAssetFile(file)) {
    return c.notFound();
  }
  const response = await serveMirroredAsset(
    c.env,
    cardAssetKey(cardId, file),
    contentTypeFor(file),
    async () => {
      const row = await drizzle(c.env.DB)
        .select({ imageUrl: cards.imageUrl })
        .from(cards)
        .where(eq(cards.id, cardId))
        .get();
      return row?.imageUrl ? cardOriginUrl(row.imageUrl, file) : null;
    },
    (work) => afterResponse(c, work),
  );
  return response ?? missingAsset(c);
});

assetsRoutes.get("/sets/:setId/:file", async (c) => {
  const { setId, file } = c.req.param();
  if (!isTcgdexId(setId) || !isSetAssetFile(file)) {
    return c.notFound();
  }
  const response = await serveMirroredAsset(
    c.env,
    setAssetKey(setId, file),
    contentTypeFor(file),
    async () => {
      const row = await drizzle(c.env.DB)
        .select({ logoUrl: sets.logoUrl, symbolUrl: sets.symbolUrl })
        .from(sets)
        .where(eq(sets.id, setId))
        .get();
      const base = setAssetKind(file) === "logo" ? row?.logoUrl : row?.symbolUrl;
      return base ? setOriginUrl(base, file) : null;
    },
    (work) => afterResponse(c, work),
  );
  return response ?? missingAsset(c);
});
