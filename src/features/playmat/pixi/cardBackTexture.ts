import { ImageSource, Texture } from "pixi.js";
import type { CardBackTone } from "../types";
import {
  type BackGeom,
  type BackPalette,
  type CardBackDesign,
  isCardBackDesign,
  PATTERNS,
} from "./cardBackDesigns";

const TEX_W = 280;
const TEX_H = Math.round(TEX_W * 1.4);

const PALETTE: Record<CardBackTone, BackPalette> = {
  blue: {
    high: "#1f3d73",
    mid: "#172b55",
    low: "#101a35",
    rim: "#254578",
    inner: "rgba(48, 78, 133, 0.88)",
    ink: "rgba(150, 184, 236, 0.45)",
    glow: "rgba(130, 178, 255, 0.95)",
  },
  red: {
    high: "#6b1e34",
    mid: "#481627",
    low: "#2a0d18",
    rim: "#7d1f31",
    inner: "rgba(130, 40, 57, 0.88)",
    ink: "rgba(240, 174, 188, 0.45)",
    glow: "rgba(255, 158, 178, 0.95)",
  },
};

// Frame geometry is constant across designs/tones — compute it once and share
// it with every pattern builder so the patterns line up with the inner border.
const GEOM: BackGeom = (() => {
  const w = TEX_W;
  const h = TEX_H;
  const rim = Math.round(w * 0.022);
  const innerInset = Math.round(w * 0.075);
  const innerBorder = Math.round(w * 0.018);
  const radius = Math.round(w * 0.06);
  const innerRadius = Math.round(radius * 0.5);
  return {
    w,
    h,
    cx: w / 2,
    cy: h / 2,
    innerInset,
    innerW: w - innerInset * 2,
    innerH: h - innerInset * 2,
    innerRadius,
    rim,
    innerBorder,
    radius,
  };
})();

function buildSvg(design: CardBackDesign, tone: CardBackTone): string {
  const p = PALETTE[tone];
  const g = GEOM;
  const { w, h, rim, innerInset, innerBorder, radius, innerRadius, innerW, innerH } = g;

  // The decorative pattern is composited between the background and the inner
  // border, clipped to the inner rounded rect so it never spills onto the rim.
  const pattern = PATTERNS[design](p, g);

  // The inner framing line is drawn thinner + translucent so it reads as a
  // soft seam rather than a hard border.
  const innerLineWidth = Math.max(1.5, innerBorder * 0.5);
  const edge = `x="${rim / 2}" y="${rim / 2}" width="${w - rim}" height="${h - rim}" rx="${radius}"`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    "<defs>",
    // Base field — diagonal high → mid → low.
    '<linearGradient id="bg" x1="10%" y1="0%" x2="90%" y2="100%">',
    `<stop offset="0" stop-color="${p.high}"/>`,
    `<stop offset="0.44" stop-color="${p.mid}"/>`,
    `<stop offset="1" stop-color="${p.low}"/>`,
    "</linearGradient>",
    // Soft upper bloom so even the bare back reads as richly graded.
    '<radialGradient id="bg-glow" cx="50%" cy="28%" r="75%">',
    `<stop offset="0" stop-color="${p.high}" stop-opacity="0.55"/>`,
    `<stop offset="0.6" stop-color="${p.high}" stop-opacity="0"/>`,
    "</radialGradient>",
    // Gentle bottom shade for depth.
    '<linearGradient id="bottom" x1="0" y1="0.5" x2="0" y2="1">',
    '<stop offset="0" stop-color="black" stop-opacity="0"/>',
    '<stop offset="1" stop-color="black" stop-opacity="0.22"/>',
    "</linearGradient>",
    // Edge vignette — darkens toward the rim so the borders dissolve into the
    // field instead of reading as hard frames.
    '<radialGradient id="edge-fade" cx="50%" cy="47%" r="70%">',
    `<stop offset="0.6" stop-color="${p.low}" stop-opacity="0"/>`,
    `<stop offset="1" stop-color="${p.low}" stop-opacity="0.55"/>`,
    "</radialGradient>",
    // Soft rim bevel (top highlight → bottom shadow) replacing the old hard
    // saturated ring, so the card edge melts into the background.
    '<linearGradient id="rim-grad" x1="0" y1="0" x2="0" y2="1">',
    `<stop offset="0" stop-color="${p.high}" stop-opacity="0.55"/>`,
    `<stop offset="0.5" stop-color="${p.rim}" stop-opacity="0.32"/>`,
    `<stop offset="1" stop-color="${p.low}" stop-opacity="0.6"/>`,
    "</linearGradient>",
    `<clipPath id="back-inner-clip"><rect x="${innerInset}" y="${innerInset}" width="${innerW}" height="${innerH}" rx="${innerRadius}"/></clipPath>`,
    "</defs>",
    `<rect ${edge} fill="url(#bg)"/>`,
    `<rect ${edge} fill="url(#bg-glow)"/>`,
    `<rect ${edge} fill="url(#bottom)"/>`,
    pattern ? `<g clip-path="url(#back-inner-clip)">${pattern}</g>` : "",
    `<rect ${edge} fill="url(#edge-fade)"/>`,
    `<rect x="${innerInset}" y="${innerInset}" width="${w - innerInset * 2}" height="${h - innerInset * 2}" rx="${innerRadius}" fill="none" stroke="${p.inner}" stroke-opacity="0.5" stroke-width="${innerLineWidth}"/>`,
    `<rect ${edge} fill="none" stroke="url(#rim-grad)" stroke-width="${rim}"/>`,
    "</svg>",
  ].join("");
}

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
  const svg = buildSvg(design, tone);
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
