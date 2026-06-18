import { ImageSource, Texture } from "pixi.js";
import type { CardBackTone } from "../types";
import { type CardBackDesign, isCardBackDesign } from "./cardBackDesigns";
import { buildCardBackSvg } from "./cardBackSvg";

const URL_PREFIX = "back://";

export interface ParsedBackUrl {
  design: CardBackDesign;
  tone: CardBackTone;
}

// Synthetic texture URL encoding both the pattern design and the player tone,
// e.g. `back://rays/blue`. CardView routes any URL with this scheme through
// cardBackTexture instead of the remote-image fetch path.
export function cardBackImageUrl(design: CardBackDesign, tone: CardBackTone): string {
  return `${URL_PREFIX}${design}/${tone}`;
}

export function parseBackUrl(url: string): ParsedBackUrl | null {
  if (!url.startsWith(URL_PREFIX)) return null;
  const [design, tone] = url.slice(URL_PREFIX.length).split("/");
  if (!design || !isCardBackDesign(design)) return null;
  if (tone !== "blue" && tone !== "red") return null;
  return { design, tone };
}

const TEXTURE_CACHE = new Map<string, Promise<Texture>>();

// Decode the SVG via <img> + createImageBitmap rather than the
// fetch → blob → createImageBitmap path CardView uses for raster art —
// createImageBitmap on SVG Blobs is flaky across browsers, but an Image
// element rasterizes SVG reliably (and we can hand the decoded element
// straight to createImageBitmap).
async function buildTexture(design: CardBackDesign, tone: CardBackTone): Promise<Texture> {
  const svg = buildCardBackSvg(design, tone);
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

  const img = new Image();
  img.src = url;
  await img.decode();

  const bitmap = await createImageBitmap(img);

  const mipLevelCount = Math.floor(Math.log2(Math.max(bitmap.width, bitmap.height))) + 1;
  const source = new ImageSource({
    resource: bitmap,
    autoGenerateMipmaps: true,
    scaleMode: "linear",
    mipLevelCount,
  });
  return new Texture({ source });
}

export function cardBackTexture(design: CardBackDesign, tone: CardBackTone): Promise<Texture> {
  const key = `${design}/${tone}`;
  const cached = TEXTURE_CACHE.get(key);
  if (cached) return cached;
  const promise = buildTexture(design, tone).catch((err) => {
    TEXTURE_CACHE.delete(key);
    throw err;
  });
  TEXTURE_CACHE.set(key, promise);
  return promise;
}
