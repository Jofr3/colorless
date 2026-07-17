import type { CSSProperties } from "react";
import type { BoardState } from "./types";

export const CARD_RENDER_WIDTH = 140;

// Bench capacity is normally 5, but a bench-expanding stadium (e.g. Lumiose
// City) raises it to 8 for both players while it is in play. `benchLimitFor`
// is the single source of truth: the move logic (cardMovement) and the layout
// (Bench/PlayerSide/benchLayout) all derive the active limit from the board.
export const DEFAULT_BENCH_LIMIT = 5;
export const EXPANDED_BENCH_LIMIT = 8;
export const BENCH_EXPANDING_STADIUM_CARD_IDS: ReadonlySet<string> = new Set(["me3-111"]);

export function benchLimitFor(board: BoardState): number {
  const stadiumCardId = board.stadium?.cardId;
  return stadiumCardId && BENCH_EXPANDING_STADIUM_CARD_IDS.has(stadiumCardId)
    ? EXPANDED_BENCH_LIMIT
    : DEFAULT_BENCH_LIMIT;
}

// Slack (in card widths) the bench frame reserves beyond its `benchLimit`
// slots. Kept at 0 so a full bench hugs its cards with no empty gap at the
// start/end — when attachments need side room, `shouldCollapseBenchAttachments`
// tucks tools behind and overlaps energy strips instead of widening the frame.
export const BENCH_EXTRA_CARD_WIDTH = 0;
export const ATTACHED_CARD_SCALE = 0.92;
export const DEFAULT_ATTACHED_VISIBLE_STICK = 0.22;
export const CROWDED_BENCH_ATTACHED_ENERGY_STICK = 0.14;

// h-dvh (dynamic viewport height), not h-screen (100vh): on mobile browsers
// 100vh sits behind the address bar, clipping the hand off the bottom edge.
export const PLAYMAT_WRAPPER_CLASS =
  "playmat-wrapper w-full h-dvh flex flex-col text-white relative overflow-hidden";

export const CENTER_LINE_TOP = "calc((100dvh - var(--hand-h)) / 2)";

// The backdrop blur lives on a ::before overlay, NOT on the frame element:
// element-level backdrop-filter creates a stacking context, which would trap
// z-indexed descendants (damage chips, the discard's top-card image) below
// the Pixi canvas (z-60, playmat.css). The pseudo paints in the playmat
// section's negative-z phase, under the frame's translucent tint — the same
// composite as element-level blur, minus the stacking context.
export const FRAME_CLASS =
  "relative rounded-xl bg-white/[0.045] before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:backdrop-blur-[3px] ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]";

export const ACTIVE_SLOT_CLASS =
  "ring-amber-300/60 shadow-[0_0_0_1px_rgba(252,211,77,0.45),0_0_28px_rgba(252,211,77,0.30),inset_0_1px_0_rgba(255,255,255,0.15)]";

export const CARD_SIZE_STYLE = {
  width: "var(--card-w)",
  height: "var(--card-h)",
} satisfies CSSProperties;

export const CARD_SLOT_STYLE = {
  width: "calc(var(--card-w) + 12px)",
  height: "calc(var(--card-h) + 12px)",
  padding: "var(--pile-pad)",
} satisfies CSSProperties;

export const PRIZE_GRID_STYLE = {
  width: "calc(var(--prize-w) + var(--prize-w) + var(--prize-gap-x) + 12px)",
  height:
    "calc(var(--prize-h) + var(--prize-h) + var(--prize-h) + var(--prize-gap-y) + var(--prize-gap-y) + 12px)",
  padding: "var(--pile-pad)",
} satisfies CSSProperties;
