// GET /assets/* — the lazy tcgdex→R2 asset mirror (D9, §3.4).
//
// Cache-aside per request: validate the file name against a strict allowlist
// (anything else 404s without touching the origin) → serve from R2 on hit →
// on miss, resolve the tcgdex origin base URL from D1 (first real Drizzle
// query in the app), fetch the original, respond, and store it in R2 after
// the response. A missing asset's 404 is cached by the browser for an hour. Rerunning
// ingest never touches R2 — objects are only ever written here, keyed
// `cards/{cardId}/{file}` / `sets/{setId}/{file}`, and immutable thereafter.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { type Context, Hono } from "hono";
import { cards, sets } from "../db/schema";
import type { Env } from "../env";
import { afterResponse } from "../http/afterResponse";
import { CACHE_STATUS_HEADER } from "../httpCache";
import {
  cardAssetKey,
  cardOriginUrl,
  contentTypeFor,
  isCardAssetFile,
  isSetAssetFile,
  setAssetKey,
  setAssetKind,
  setOriginUrl,
} from "./files";

export const assetsRoutes = new Hono<{ Bindings: Env }>();

/** Mirrored assets never change for a given key — cache them forever. */
const CACHE_FOREVER = "public, max-age=31536000, immutable";

/** An unknown card or set, or one the origin has no image for: briefly, since ingest can add it. */
const MISSING_ASSET_CACHE = "public, max-age=3600";

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
 * The shared R2-then-origin flow. `resolveOriginUrl` is only consulted on an R2 miss. An unknown
 * row, a missing asset URL or an origin 404 is `null` (the app's 404); an origin 5xx or a network
 * error is a 502, so an upstream outage does not read as a missing image. The R2 write goes to
 * `later`, which runs it after the response and drops its failure.
 */
export async function serveMirroredAsset(
  env: Pick<Env, "ASSETS">,
  key: string,
  contentType: string,
  resolveOriginUrl: () => Promise<string | null>,
  later: (work: () => Promise<unknown>) => Promise<void>,
): Promise<Response | null> {
  const cached = await env.ASSETS.get(key);
  if (cached) {
    return assetResponse(cached.body, contentType, "hit");
  }
  const originUrl = await resolveOriginUrl();
  if (originUrl === null) {
    return null;
  }
  let origin: Response;
  try {
    origin = await fetch(originUrl);
  } catch {
    return upstreamFailure();
  }
  if (origin.status >= 500) {
    return upstreamFailure();
  }
  if (origin.status !== 200) {
    return null;
  }
  // Buffer the image (card scans are ~100KB) so one body feeds both the R2
  // put and the response without tee-ing the stream.
  const bytes = await origin.arrayBuffer();
  const stored = bytes.slice(0);
  await later(() => env.ASSETS.put(key, stored, { httpMetadata: { contentType } }));
  return assetResponse(bytes, contentType, "miss");
}

function upstreamFailure(): Response {
  return Response.json({ error: "asset origin unavailable" }, { status: 502 });
}

function missingAsset(c: Context): Response {
  return c.json({ error: "not found" }, 404, { "Cache-Control": MISSING_ASSET_CACHE });
}

assetsRoutes.get("/cards/:cardId/:file", async (c) => {
  const { cardId, file } = c.req.param();
  if (!isCardAssetFile(file)) {
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
  if (!isSetAssetFile(file)) {
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
