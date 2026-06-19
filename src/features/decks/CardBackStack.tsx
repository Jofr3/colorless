import type { CSSProperties, ReactNode } from "react";
import { cardBackSvgDataUrl } from "../playmat/pixi/cardBackSvg";

// The deck preview's centrepiece: a faux-3D pile of cards whose top card is the
// exact blue "twilight" back the simulator renders. We reuse the simulator's
// SVG builder (pixi-free, see cardBackSvg.ts) so the two stay in lockstep, and
// paint it straight into the DOM as a data URL — built once at module load.
const BLUE_BACK = cardBackSvgDataUrl("twilight", "blue");

// One card in the pile, ordered back-to-front (later layers paint on top).
// Offsets are PERCENTAGES of the card's own size (CSS translate %), so the pile
// scales with the card. `dim` darkens the cards behind so the stack recedes.
type Layer = {
  tx: number;
  ty: number;
  rot: number;
  scale: number;
  dim: number;
};

const LAYERS: Layer[] = [
  // Squared-up stack: no rotation, no left/right stagger — the cards sit flush
  // and simply peek straight down behind the top one.
  { tx: 0, ty: 5, rot: 0, scale: 1, dim: 0.42 }, // back
  { tx: 0, ty: 2.5, rot: 0, scale: 1, dim: 0.2 }, // mid
  { tx: 0, ty: 0, rot: 0, scale: 1, dim: 0 }, // top
];

function layerStyle(l: Layer): CSSProperties {
  return {
    backgroundImage: `url("${BLUE_BACK}")`,
    // Cards behind are darkened (brightness < 1) so the stack recedes — folded
    // into the element itself so each card stays a single node.
    filter: l.dim > 0 ? `brightness(${1 - l.dim})` : undefined,
    transform: `translate(${l.tx}%, ${l.ty}%) rotate(${l.rot}deg) scale(${l.scale})`,
  };
}

/** Layered card-back pile that fills its container. The top card carries the
    `label` (deck name + count), printed into its lower edge. An empty deck shows
    a single back; a stocked deck shows the full three-card stack. The cards are
    absolutely layered (inset-0) so they overlap, so this one sized container is
    the minimum the pile needs. */
export function CardBackStack({ count, label }: { count: number; label?: ReactNode }) {
  const empty = count === 0;
  const layers = empty ? LAYERS.slice(-1) : LAYERS;
  return (
    <div className="pointer-events-none relative aspect-[5/7] w-full">
      {layers.map((l, i) => {
        const isTop = i === layers.length - 1;
        return (
          <div
            key={i}
            style={layerStyle(l)}
            className="absolute inset-0 overflow-hidden rounded-[7px] bg-cover bg-center shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
          >
            {isTop && label && (
              <div className="absolute inset-x-0 bottom-0 px-6 pb-6">{label}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
