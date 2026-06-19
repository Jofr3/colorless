import type { CSSProperties, ReactNode } from "react";
import { useTiltJuice } from "../../components/useTiltJuice";
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
  // and simply peek straight down behind the top one, darkening toward the back
  // so the deeper cards read as a receding pile.
  { tx: 0, ty: 8, rot: 0, scale: 1, dim: 0.3 }, // back
  { tx: 0, ty: 6, rot: 0, scale: 1, dim: 0.22 },
  { tx: 0, ty: 4, rot: 0, scale: 1, dim: 0.14 },
  { tx: 0, ty: 2, rot: 0, scale: 1, dim: 0.07 }, // mid
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

// Shared card styling for every layer in the pile, including a small drop shadow
// so each card lifts a touch off the one behind it.
const CARD_CLASS =
  "absolute inset-0 overflow-hidden rounded-[7px] bg-cover bg-center shadow-[0_2px_6px_rgba(0,0,0,0.35)]";

/** Layered card-back pile that fills its container. The top card carries the
    `label` (deck name + count), printed into its lower edge; the cards beneath
    peek out below it to form the pile. Every deck — even a brand-new empty one —
    shows the full pile so each tile reads as a deck; the label is what tells
    empty from stocked. The cards are absolutely layered (inset-0) so they
    overlap, so this one sized container is the minimum the pile needs.

    The top card carries the shared Balatro tilt + juice (the same hook the home
    menu and folder tiles use): it leans toward the pointer and pops on press
    while the pile beneath stays put, like lifting the top card off the deck. */
export function CardBackStack({
  label,
  juiceOnMount,
}: {
  label?: ReactNode;
  /** Pop the top card with a juice bounce when it first appears (new decks). */
  juiceOnMount?: boolean;
}) {
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } =
    useTiltJuice<HTMLDivElement>({ juiceOnMount });
  return (
    <div className="pointer-events-none relative aspect-[5/7] w-full">
      {LAYERS.map((l, i) => {
        // The back cards are static; only the top card is interactive.
        if (i !== LAYERS.length - 1) {
          return <div key={i} style={layerStyle(l)} className={CARD_CLASS} />;
        }
        return (
          // Outer layer carries the transient juice (squash + wobble); the inner
          // card carries the pointer tilt and is the lone interactive surface.
          <div key={i} ref={juiceLayerRef} style={juiceStyle} className="absolute inset-0">
            <div
              ref={tiltRef}
              {...handlers}
              style={{ ...layerStyle(l), ...tiltStyle }}
              className={`pointer-events-auto cursor-pointer select-none ${CARD_CLASS}`}
            >
              {label && <div className="absolute inset-x-0 bottom-0 px-6 pb-6">{label}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
