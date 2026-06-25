// Shared "glass" Tailwind class fragments. Each exported constant holds ONLY
// the classes common to every site that uses it; per-site layout (size, shape,
// position, padding) stays at the call site, composed via a template literal.
//
// Constants are deliberately split where the originals genuinely differ — e.g.
// the HUD glass buttons use ring-white/9 while the page ghost buttons use
// ring-white/10, and the dialog ghost buttons use ring-white/12. Those are NOT
// standardised; merging them would be a visual change.

/** Standard focus-visible ring used by nearly every interactive control. */
export const FOCUS_RING =
  "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

/** Inset focus-visible ring (negative offset) for controls whose ring must sit
    inside their bounds (overlay/inset buttons). */
export const FOCUS_RING_INSET =
  "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/50";

/** Glass paint for the playmat HUD buttons (ring-white/9, inset+drop shadow,
    blur, hover lift). Layout — flex/size/shape/position/padding — stays at the
    call site. The trailing focus ring is the standard FOCUS_RING. */
export const GLASS_HUD_BUTTON = `bg-white/[0.045] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)] ring-1 ring-inset ring-white/9 backdrop-blur-md transition-all hover:bg-white/[0.06] hover:text-white/85 active:scale-95 ${FOCUS_RING}`;

/** Page "ghost" pill button paint (ring-white/10, no shadow, hover to /90). */
export const GLASS_GHOST_BUTTON = `bg-white/[0.05] text-white/75 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.08] hover:text-white/90 active:scale-95 ${FOCUS_RING}`;

/** Dialog "cancel/ghost" button paint (ring-white/12, no shadow/blur, hover to
    full white). Includes shape + padding + type since all members share them. */
export const GLASS_DIALOG_GHOST_BUTTON = `cursor-pointer rounded-full bg-white/[0.05] px-4 py-2 text-sm font-medium text-white/75 ring-1 ring-inset ring-white/12 transition-all hover:bg-white/[0.09] hover:text-white active:scale-95 ${FOCUS_RING}`;

/** Dialog inner panel surface (no width — the width class stays at the call
    site since it differs: 22rem vs 24rem). */
export const GLASS_DIALOG_PANEL =
  "rounded-3xl bg-[#16161f]/85 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.55)] ring-1 ring-inset ring-white/10 backdrop-blur-xl";

/** Accent icon tile (the rounded square that holds a feature icon on the
    Settings header and placeholder pages). Size (h-/w-) stays at the call site. */
export const GLASS_ICON_TILE =
  "flex items-center justify-center rounded-2xl bg-white/[0.05] text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_30px_rgba(0,0,0,0.40)] ring-1 ring-inset ring-white/10";
