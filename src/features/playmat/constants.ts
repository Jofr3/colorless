import type { CSSProperties } from "react";

export const CARD_RENDER_WIDTH = 140;
export const BENCH_LIMIT = 5;
export const HIDDEN_CURSOR_POSITION = -9999;

export const PLAYMAT_WRAPPER_CLASS =
  "playmat-wrapper w-full h-screen flex flex-col text-white relative overflow-hidden";

export const CENTER_LINE_TOP = "calc((100vh - var(--hand-h)) / 2)";

export const FRAME_CLASS =
  "relative rounded-xl bg-white/[0.045] backdrop-blur-[3px] ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]";

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
