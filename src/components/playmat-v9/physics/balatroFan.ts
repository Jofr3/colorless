// Balatro-style fan/arc layout per row index. Mirrors cardarea.lua's
// hand-alignment ('hand' branch) and joker-alignment ('joker' branch)
// formulas: a small per-index rotation plus a shallow Y arc that lifts
// the middle of the hand. Applied as a CSS-transitioned transform on a
// wrapper inside [data-layout-card] so neighbours visibly rotate when a
// drag-preview gap shifts the fan slot count.

const RAD_TO_DEG = 180 / Math.PI;

// Approximates Balatro's tile size relative to its 1-tile-wide cards.
// Our cards are 140px wide; 60px keeps the dip close to 0.2 tiles.
const TILE_PX = 60;

export interface FanLayout {
  rotationDeg: number;
  liftPx: number;
}

function normalizedT(visualIndex: number, total: number) {
  return (visualIndex + 0.5) / total - 0.5;
}

export function balatroHandFan(visualIndex: number, total: number): FanLayout {
  if (total <= 1) return { rotationDeg: 0, liftPx: 0 };
  const t = normalizedT(visualIndex, total);
  return {
    // Balatro: card.T.r = 0.2 * (-N/2 - 0.5 + k)/N
    rotationDeg: 0.2 * t * RAD_TO_DEG,
    // Balatro: card.T.y += abs(0.5 * (-N/2 + k - 0.5)/N) - 0.2
    // Negative => lifts the middle of the hand toward the screen top.
    liftPx: (0.5 * Math.abs(t) - 0.2) * TILE_PX,
  };
}

export function balatroBenchFan(visualIndex: number, total: number): FanLayout {
  if (total <= 1) return { rotationDeg: 0, liftPx: 0 };
  const t = normalizedT(visualIndex, total);
  // Balatro joker area uses half the hand fan and no Y arc.
  return { rotationDeg: 0.1 * t * RAD_TO_DEG, liftPx: 0 };
}
