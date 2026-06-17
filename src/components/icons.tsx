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

/** Two chess pieces — a taller king in front and a shorter rook behind — for
    the battle/playmat simulator. Drawn in a faceted, filled style with a halo
    overlap to match {@link SwordsIcon}. */
export function SimulatorIcon(props: IconProps) {
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
      <mask id="simulator-king-halo" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        {/* King halo (knockout from the rook behind it) */}
        <path
          d="M6.5 5 9.5 5 10.3 7.8 9.3 9.4 11.4 18 4.6 18 6.7 9.4 5.7 7.8Z"
          fill="black"
          stroke="black"
          strokeWidth={4}
        />
        <rect
          x="4"
          y="18"
          width="8"
          height="2.5"
          rx="0.6"
          fill="black"
          stroke="black"
          strokeWidth={4}
        />
      </mask>

      {/* Rook (back piece, masked by the king's halo) */}
      <g mask="url(#simulator-king-halo)">
        {/* Crenellated tower — wide, deep notches over an overhanging lip */}
        <path d="M11 6.9 12 6.9 12 9.8 13.5 9.8 13.5 6.9 14.5 6.9 14.5 9.8 16 9.8 16 6.9 17 6.9 17 10.6 16.2 10.6 16 11.7 16.6 18 11.4 18 12 11.7 11.8 10.6 11 10.6Z" />
        {/* Base */}
        <rect x="11" y="18" width="6" height="2.5" rx="0.6" />
      </g>

      {/* King (front piece) */}
      {/* Cross finial — sits on a short neck rising from the head */}
      <path d="M8 1.6v3.6M6.5 3h3" fill="none" />
      {/* Faceted body — defined head, pinched neck, flared base */}
      <path d="M6.5 5 9.5 5 10.3 7.8 9.3 9.4 11.4 18 4.6 18 6.7 9.4 5.7 7.8Z" />
      {/* Base */}
      <rect x="4" y="18" width="8" height="2.5" rx="0.6" />
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

/** Stacked layers (Lucide-style) — your decks. Redrawn as geometric isometric
    rectangles with halo overlaps to match {@link SwordsIcon}. */
export function DecksIcon(props: IconProps) {
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
      <mask id="decks-halo-1" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        {/* Top card halo */}
        <path d="M12 2 2 7l10 5 10-5-10-5Z" fill="black" stroke="black" strokeWidth={4} />
      </mask>
      <mask id="decks-halo-2" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        {/* Middle card halo */}
        <path d="m2 12 10 5 10-5-10-5-10 5Z" fill="black" stroke="black" strokeWidth={4} />
      </mask>

      {/* Bottom card */}
      <path d="m2 17 10 5 10-5-10-5-10 5Z" mask="url(#decks-halo-2)" />
      {/* Middle card */}
      <path d="m2 12 10 5 10-5-10-5-10 5Z" mask="url(#decks-halo-1)" />
      {/* Top card */}
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
    </svg>
  );
}

// Build a crisp cog outline: `teeth` sharp, tapered teeth around a hub. Each
// tooth is a trapezoid that narrows from a wide root to a thin tip, and the
// valleys between teeth sit at the root radius — giving an angular, pointed
// look rather than soft rounded nubs.
function gearPath(teeth: number, rTip: number, rRoot: number) {
  const cx = 12;
  const cy = 12;
  const slot = 360 / teeth;
  const flank = slot * 0.18; // angular width of each sloped tooth side
  const tip = slot * 0.2; // angular width of the (narrow) flat tip
  const at = (r: number, deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  };
  const pts: string[] = [];
  for (let k = 0; k < teeth; k++) {
    const start = k * slot - (flank + tip / 2); // centre one tooth at the top
    pts.push(at(rRoot, start));
    pts.push(at(rTip, start + flank));
    pts.push(at(rTip, start + flank + tip));
    pts.push(at(rRoot, start + flank * 2 + tip));
  }
  return `M${pts.join("L")}Z`;
}

/** Gear — user settings. An eight-tooth cog (geometry in {@link gearPath}) with
    a hollow centre punched out by a mask so the background shows through. */
export function SettingsIcon(props: IconProps) {
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
      <mask id="settings-hole" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        {/* Center hole */}
        <circle cx="12" cy="12" r="5" fill="black" />
      </mask>

      <path mask="url(#settings-hole)" d={gearPath(8, 10.4, 8.4)} />
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
