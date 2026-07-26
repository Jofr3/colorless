import type { CSSProperties, ReactNode } from "react";
import { useTiltJuice } from "../../components/useTiltJuice";
import { cardBackSvgDataUrl } from "../playmat/pixi/cardBackSvg";

// The deck preview's centrepiece: a faux-3D pile of cards whose top card is the
// exact blue "twilight" back the simulator renders. We reuse the simulator's
// SVG builder (pixi-free, see cardBackSvg.ts) so the two stay in lockstep, and
// paint it straight into the DOM as a data URL — built once at module load.
// Squared corners: the card div clips to rounded-[7px], so the SVG fills all the
// way to its corners and lets that clip do the rounding — otherwise the SVG's own
// rounded corners leave a crescent at each corner that shows the div's background.
const BLUE_BACK = cardBackSvgDataUrl("twilight", "blue", true);

// One card in the pile, ordered back-to-front (later layers paint on top).
// Offsets are PERCENTAGES of the card's own size (CSS translate %), so the pile
// scales with the card.
type Layer = {
  tx: number;
  ty: number;
  rot: number;
  scale: number;
};

const LAYERS: Layer[] = [
  // Squared-up stack: no rotation, no left/right stagger — the cards sit flush
  // and simply peek straight down behind the top one.
  { tx: 0, ty: 8, rot: 0, scale: 1 }, // back
  { tx: 0, ty: 6, rot: 0, scale: 1 },
  { tx: 0, ty: 4, rot: 0, scale: 1 },
  { tx: 0, ty: 2, rot: 0, scale: 1 }, // mid
  { tx: 0, ty: 0, rot: 0, scale: 1 }, // top
];

// The cards under the top one show only their bottom edge peeking out, so they
// don't carry the blue back at all — they're a flat light blue matching the
// card back's inner border, so the slivers read as the cards' framed edges.
// Only the top card paints the real back over this.
const EDGE_COLOR = "#28345a";

function layerStyle(l: Layer): CSSProperties {
  return {
    backgroundColor: EDGE_COLOR,
    transform: `translate(${l.tx}%, ${l.ty}%) rotate(${l.rot}deg) scale(${l.scale})`,
  };
}

// Shared card styling for every layer in the pile, including a small drop shadow
// so each card lifts a touch off the one behind it.
const CARD_CLASS =
  "absolute inset-0 overflow-hidden rounded-[7px] bg-cover bg-center shadow-[0_2px_6px_rgba(0,0,0,0.35)]";

// The top card sits a hair larger than the pile beneath it.
const TOP_CARD_SCALE = 1.01;

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
  coverUrl,
  juiceOnMount,
  dragActive,
}: {
  label?: ReactNode;
  /** Art for the TOP card (P5-3) — a deck's own headline card, chosen by the
      server. Absent, the stack stays the blue back it has always been, which is
      what a new or Pokémon-less deck should look like. Only the top card takes
      it: the ones behind are the deck's bulk, and printing the same scan three
      times would read as three copies rather than a stack. */
  coverUrl?: string;
  /** Pop the top card with a juice bounce when it first appears (new decks). */
  juiceOnMount?: boolean;
  /** Suppress the hover tilt while a drag is in flight (see useTiltJuice). */
  dragActive?: boolean;
}) {
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } = useTiltJuice<HTMLDivElement>({
    juiceOnMount,
    disabled: dragActive,
  });
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
          <div
            key={i}
            ref={juiceLayerRef}
            style={{ ...juiceStyle, transform: `scale(${TOP_CARD_SCALE}) ${juiceStyle.transform}` }}
            className="absolute inset-0"
          >
            <div
              ref={tiltRef}
              {...handlers}
              style={{ backgroundImage: `url("${coverUrl ?? BLUE_BACK}")`, ...tiltStyle }}
              className={`pointer-events-auto cursor-pointer select-none ${CARD_CLASS}`}
            >
              {label && (
                <>
                  {/* A scrim, only under real art (P5-3). The name used to sit on
                      a flat blue back where white read cleanly; over a card scan
                      — flames, holo foil, a 190 in bold — it was barely legible.
                      Beneath the label, above the art, and absent for a coverless
                      deck so the original look is untouched. */}
                  {coverUrl !== undefined && (
                    <div
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-1/2 rounded-b-[7px] bg-gradient-to-t from-black/90 via-black/55 to-transparent"
                    />
                  )}
                  <div className="absolute inset-x-0 bottom-0 px-6 pb-6">{label}</div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
