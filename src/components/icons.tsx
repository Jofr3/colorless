import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

// Shared base for the app's line icons. Mirrors the inline-SVG convention
// already used on the playmat (see features/playmat/components/TurnHud.tsx):
// 24×24 viewBox, currentColor stroke, rounded caps. Size via a `className`
// (e.g. `h-7 w-7`); callers can override any attribute through `...props`.
function IconBase({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Chess pieces (Font Awesome fa-chess, solid) — the battle/playmat simulator. */
export function SimulatorIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M144 16c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 16L96 32c-8.8 0-16 7.2-16 16s7.2 16 16 16l16 0 0 32L60.2 96C49.1 96 40 105.1 40 116.2c0 2.5 .5 4.9 1.3 7.3L73.8 208 72 208c-13.3 0-24 10.7-24 24s10.7 24 24 24l4 0L60 384l136 0L180 256l4 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-1.8 0 32.5-84.5c.9-2.3 1.3-4.8 1.3-7.3c0-11.2-9.1-20.2-20.2-20.2L144 96l0-32 16 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-16 0 0-16zM48 416L4.8 473.6C1.7 477.8 0 482.8 0 488c0 13.3 10.7 24 24 24l208 0c13.3 0 24-10.7 24-24c0-5.2-1.7-10.2-4.8-14.4L208 416 48 416zm288 0l-43.2 57.6c-3.1 4.2-4.8 9.2-4.8 14.4c0 13.3 10.7 24 24 24l176 0c13.3 0 24-10.7 24-24c0-5.2-1.7-10.2-4.8-14.4L464 416l-128 0zM304 208l0 51.9c0 7.8 2.8 15.3 8 21.1L339.2 312 337 384l125.5 0-3.3-72 28.3-30.8c5.4-5.9 8.5-13.6 8.5-21.7l0-51.5c0-8.8-7.2-16-16-16l-16 0c-8.8 0-16 7.2-16 16l0 16-24 0 0-16c0-8.8-7.2-16-16-16l-16 0c-8.8 0-16 7.2-16 16l0 16-24 0 0-16c0-8.8-7.2-16-16-16l-16 0c-8.8 0-16 7.2-16 16zm80 96c0-8.8 7.2-16 16-16s16 7.2 16 16l0 32-32 0 0-32z" />
    </svg>
  );
}

/** Two crossed swords (Lucide swords shape, filled) — versus / online battle.
    Both blades are complete, but the front (top-left) sword is knocked out of
    the back sword by a thin halo so it reads as overlapping instead of merging
    into one solid mass. */
export function SwordsIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <mask id="swords-front-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        {/* Front blade halo — thin gap at the crossing. */}
        <polyline
          points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"
          fill="black"
          stroke="black"
          strokeWidth={4}
          strokeLinejoin="round"
        />
        {/* Front handle halo — thicker so it reaches and overlaps the back
            sword a bit, extending the outline onto the hilt. */}
        <g stroke="black" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <line x1="13" x2="19" y1="19" y2="13" />
          <line x1="16" x2="20" y1="16" y2="20" />
          <line x1="19" x2="21" y1="21" y2="19" />
        </g>
      </mask>
      {/* Back sword (top-right), cut where the front sword crosses it. */}
      <g mask="url(#swords-front-cut)">
        <polyline points="9.5 17.5 21 6 21 3 18 3 6.5 14.5" />
        <line x1="11" x2="5" y1="19" y2="13" />
        <line x1="8" x2="4" y1="16" y2="20" />
        <line x1="5" x2="3" y1="21" y2="19" />
      </g>
      {/* Front sword (top-left), drawn on top. */}
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" x2="19" y1="19" y2="13" />
      <line x1="16" x2="20" y1="16" y2="20" />
      <line x1="19" x2="21" y1="21" y2="19" />
    </svg>
  );
}

/** Stacked layers (Font Awesome fa-layer-group, solid) — your decks. */
export function DecksIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 576 512" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M264.5 5.2c14.9-6.9 32.1-6.9 47 0l218.6 101c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 149.8C37.4 145.8 32 137.3 32 128s5.4-17.9 13.9-21.8L264.5 5.2zM476.9 209.6l53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 277.8C37.4 273.8 32 265.3 32 256s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0l152-70.2zm-152 198.2l152-70.2 53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 405.8C37.4 401.8 32 393.3 32 384s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0z" />
    </svg>
  );
}

/** Gear (Font Awesome fa-gear, solid) — user settings. */
export function SettingsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z" />
    </svg>
  );
}

/** Chevron pointing right — a "go" affordance on nav cards. */
export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 6l6 6-6 6" />
    </IconBase>
  );
}

/** Left arrow — "back" navigation. */
export function ArrowLeftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </IconBase>
  );
}

/** Brand mark — a card with a centre pip, echoing the favicon. */
export function BrandGlyph(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="5" y="3" width="14" height="18" rx="3" />
      <circle cx="12" cy="12" r="2.4" />
    </IconBase>
  );
}
