// GET /assets/* — the lazy tcgdex→R2 asset mirror (D9, §3.4).
//
// Cache-aside per request: validate the file name against a strict allowlist
// (anything else 404s without touching the origin) → serve from R2 on hit →
// on miss, resolve the tcgdex origin base URL from D1 (first real Drizzle
// query in the app), fetch the original, store it in R2, respond. Rerunning
// ingest never touches R2 — objects are only ever written here, keyed
// `cards/{cardId}/{file}` / `sets/{setId}/{file}`, and immutable thereafter.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { cards, sets } from "../db/schema";
import type { Env } from "../env";
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

function assetResponse(
  body: ReadableStream | ArrayBuffer,
  contentType: string,
  cache: "hit" | "miss",
): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": CACHE_FOREVER,
      "x-luminous-cache": cache,
    },
  });
}

/**
 * The shared R2-then-origin flow. `resolveOriginUrl` is only consulted on an
 * R2 miss; returning null (unknown row / no asset URL) yields a 404 upstream,
 * as does a non-200 origin response. Returns null instead of a Response for
 * "not found" so the route keeps Hono's own 404 shape.
 */
async function serveMirroredAsset(
  env: Env,
  key: string,
  contentType: string,
  resolveOriginUrl: () => Promise<string | null>,
): Promise<Response | null> {
  const cached = await env.ASSETS.get(key);
  if (cached) {
    return assetResponse(cached.body, contentType, "hit");
  }
  const originUrl = await resolveOriginUrl();
  if (originUrl === null) {
    return null;
  }
  const origin = await fetch(originUrl);
  if (origin.status !== 200) {
    return null;
  }
  // Buffer the image (card scans are ~100KB) so one body feeds both the R2
  // put and the response without tee-ing the stream.
  const bytes = await origin.arrayBuffer();
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType } });
  return assetResponse(bytes, contentType, "miss");
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
  );
  return response ?? c.notFound();
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
  );
  return response ?? c.notFound();
});
