import type { CSSProperties } from "react";
import { cardBackSvgDataUrl } from "../playmat/pixi/cardBackSvg";

// The deck preview's centrepiece: a faux-3D pile of cards whose top card is the
// exact blue "twilight" back the simulator renders. We reuse the simulator's
// SVG builder (pixi-free, see cardBackSvg.ts) so the two stay in lockstep, and
// paint it straight into the DOM as a data URL — built once at module load.
const BLUE_BACK = cardBackSvgDataUrl("twilight", "blue");

// One card in the pile, ordered back-to-front (later layers paint on top).
// `dim` darkens the cards behind so the stack recedes into shadow; the spread
// deltas (sx/sy/srot) are added — scaled by --spread — when the tile is hovered,
// so the pile fans open with a little life.
type Layer = {
  tx: number;
  ty: number;
  rot: number;
  scale: number;
  dim: number;
  sx: number;
  sy: number;
  srot: number;
};

const LAYERS: Layer[] = [
  { tx: -9, ty: 11, rot: -8, scale: 0.955, dim: 0.42, sx: -14, sy: 3, srot: -6 }, // back-left
  { tx: 8, ty: 6, rot: 5.5, scale: 0.978, dim: 0.2, sx: 14, sy: 3, srot: 6 }, // mid-right
  { tx: 0, ty: 0, rot: -1.5, scale: 1, dim: 0, sx: 0, sy: -8, srot: -2 }, // top
];

function layerStyle(l: Layer): CSSProperties {
  return {
    backgroundImage: `url("${BLUE_BACK}")`,
    // Cards behind are darkened (brightness < 1) so the stack recedes — folded
    // into the element itself so each card stays a single, childless node.
    filter: l.dim > 0 ? `brightness(${1 - l.dim})` : undefined,
    transform:
      `translate(calc(${l.tx}px + var(--spread) * ${l.sx}px), calc(${l.ty}px + var(--spread) * ${l.sy}px)) ` +
      `rotate(calc(${l.rot}deg + var(--spread) * ${l.srot}deg)) scale(${l.scale})`,
  };
}

/** Layered card-back pile shown as a deck's cover art. An empty deck shows a
    single faded back; a stocked deck shows the full three-card stack.

    A single container is the minimum the pile needs: the cards are absolutely
    layered (inset-0) so they overlap, so they need one sized, positioned parent.
    It sizes itself to one card, centres in the tile (mx-auto), and tips back in
    perspective so the stack reads as 3D rather than a flat sticker. --spread
    (0→1 on hover) fans the cards out; each card transitions its own transform. */
export function CardBackStack({ count }: { count: number }) {
  const empty = count === 0;
  const layers = empty ? LAYERS.slice(-1) : LAYERS;
  return (
    <div
      className={`pointer-events-none relative mx-auto my-5 aspect-[5/7] w-[5.25rem] [--spread:0] [transform:perspective(900px)_rotateX(8deg)] group-hover:[--spread:1]${empty ? " opacity-50" : ""}`}
    >
      {layers.map((l, i) => (
        <div
          key={i}
          style={layerStyle(l)}
          className="absolute inset-0 overflow-hidden rounded-[6px] bg-cover bg-center shadow-[0_5px_14px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/10 transition-transform duration-300 ease-out"
        />
      ))}
    </div>
  );
}
