// Card-back DESIGN registry. A "design" is the decorative gradient wash painted
// into the central inner area of a card back; it is orthogonal to the player
// TONE (blue/red — see PALETTE in cardBackTexture.ts). The shared frame
// (gradient field, soft rim bevel, edge vignette, faint inner line) is drawn by
// cardBackTexture.ts; each design here contributes ONLY the inner wash, which is
// composited inside `<g clip-path="url(#back-inner-clip)">` so it can never
// bleed past the inner border.
//
// `twilight` is the live card back; `classic` is the bare softened frame kept as
// a plain alternate. Both render through the same CardView pipeline as a normal
// card and now carry the full animation set (idle float, ambient mesh tilt,
// hover lift/scale/tilt, juice pops) — see cardPresentationOptions.

// Resolved colours handed to a pattern builder. Mirrors a PALETTE entry.
export interface BackPalette {
  high: string;
  mid: string;
  low: string;
  rim: string;
  inner: string;
  // Light, translucent line colour for detail/line work on the dark ground.
  ink: string;
  // Bright accent for glows / highlights.
  glow: string;
}

// Geometry of the back texture, in SVG user units. Builders fill the inner area
// (centred on cx,cy, spanning innerW × innerH).
export interface BackGeom {
  w: number;
  h: number;
  cx: number;
  cy: number;
  innerInset: number;
  innerW: number;
  innerH: number;
  innerRadius: number;
  rim: number;
  innerBorder: number;
  radius: number;
}

export type PatternBuilder = (p: BackPalette, g: BackGeom) => string;

export const CARD_BACK_DESIGNS = ["twilight", "classic"] as const;

export type CardBackDesign = (typeof CARD_BACK_DESIGNS)[number];

export function isCardBackDesign(value: string): value is CardBackDesign {
  return (CARD_BACK_DESIGNS as readonly string[]).includes(value);
}

// Paint one rect over the inner area filled with the given gradient. The
// compositor clips it to the inner rounded rect, so a plain rect is enough.
function washRect(id: string, g: BackGeom): string {
  return `<rect x="${g.innerInset}" y="${g.innerInset}" width="${g.innerW}" height="${g.innerH}" fill="url(#${id})"/>`;
}

export const PATTERNS: Record<CardBackDesign, PatternBuilder> = {
  // Vertical dusk gradient — bright crown fading to a deep base.
  twilight: (p, g) =>
    `<defs><linearGradient id="twilight-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.high}" stop-opacity="0.42"/><stop offset="0.5" stop-color="${p.mid}" stop-opacity="0.12"/><stop offset="1" stop-color="${p.low}" stop-opacity="0.4"/></linearGradient></defs>${washRect("twilight-g", g)}`,

  // Bare softened frame — the plain baseline back.
  classic: () => "",
};
