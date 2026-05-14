import { ImageSource, Texture } from "pixi.js";
import type { CardBackTone } from "../types";

const TEX_W = 280;
const TEX_H = Math.round(TEX_W * 1.4);

const PALETTE: Record<
  CardBackTone,
  {
    high: string;
    mid: string;
    low: string;
    rim: string;
    inner: string;
  }
> = {
  blue: {
    high: "#1f3d73",
    mid: "#172b55",
    low: "#101a35",
    rim: "#254578",
    inner: "rgba(48, 78, 133, 0.88)",
  },
  red: {
    high: "#6b1e34",
    mid: "#481627",
    low: "#2a0d18",
    rim: "#7d1f31",
    inner: "rgba(130, 40, 57, 0.88)",
  },
};

function buildSvg(tone: CardBackTone): string {
  const p = PALETTE[tone];
  const w = TEX_W;
  const h = TEX_H;
  const rim = Math.round(w * 0.022);
  const innerInset = Math.round(w * 0.075);
  const innerBorder = Math.round(w * 0.018);
  const radius = Math.round(w * 0.06);
  const innerRadius = Math.round(radius * 0.5);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    "<defs>",
    '<linearGradient id="bg" x1="10%" y1="0%" x2="90%" y2="100%">',
    `<stop offset="0" stop-color="${p.high}"/>`,
    `<stop offset="0.44" stop-color="${p.mid}"/>`,
    `<stop offset="1" stop-color="${p.low}"/>`,
    "</linearGradient>",
    '<linearGradient id="bottom" x1="0" y1="0.55" x2="0" y2="1">',
    '<stop offset="0" stop-color="black" stop-opacity="0"/>',
    '<stop offset="1" stop-color="black" stop-opacity="0.18"/>',
    "</linearGradient>",
    "</defs>",
    `<rect x="${rim / 2}" y="${rim / 2}" width="${w - rim}" height="${h - rim}" rx="${radius}" fill="url(#bg)" stroke="${p.rim}" stroke-width="${rim}"/>`,
    `<rect x="${rim / 2}" y="${rim / 2}" width="${w - rim}" height="${h - rim}" rx="${radius}" fill="url(#bottom)"/>`,
    `<rect x="${innerInset}" y="${innerInset}" width="${w - innerInset * 2}" height="${h - innerInset * 2}" rx="${innerRadius}" fill="none" stroke="${p.inner}" stroke-width="${innerBorder}"/>`,
    "</svg>",
  ].join("");
}

const URL_PREFIX = "back://";

export function cardBackImageUrl(tone: CardBackTone): string {
  return `${URL_PREFIX}${tone}`;
}

export function parseBackUrl(url: string): CardBackTone | null {
  if (!url.startsWith(URL_PREFIX)) return null;
  const tone = url.slice(URL_PREFIX.length);
  return tone === "blue" || tone === "red" ? tone : null;
}

const TEXTURE_CACHE = new Map<CardBackTone, Promise<Texture>>();

// Decode the SVG via <img> + createImageBitmap rather than the
// fetch → blob → createImageBitmap path CardView uses for raster art —
// createImageBitmap on SVG Blobs is flaky across browsers, but an Image
// element rasterizes SVG reliably (and we can hand the decoded element
// straight to createImageBitmap).
async function buildTexture(tone: CardBackTone): Promise<Texture> {
  const svg = buildSvg(tone);
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

export function cardBackTexture(tone: CardBackTone): Promise<Texture> {
  const cached = TEXTURE_CACHE.get(tone);
  if (cached) return cached;
  const promise = buildTexture(tone).catch((err) => {
    TEXTURE_CACHE.delete(tone);
    throw err;
  });
  TEXTURE_CACHE.set(tone, promise);
  return promise;
}
