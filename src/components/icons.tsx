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

/** Four-way move arrows — the keyboard "reposition / move" affordance on a
    decks-grid tile. */
export function MoveIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3v18M3 12h18" />
      <path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </IconBase>
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

/** Magnifying glass — the deck library search field. */
export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </IconBase>
  );
}

/** Sliders — open the deck library's filter & sort menu. Two tracks, each with
    a filled knob at a different position. */
export function FilterIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="3" y1="7.5" x2="21" y2="7.5" />
      <line x1="3" y1="16.5" x2="21" y2="16.5" />
      <circle cx="15" cy="7.5" r="2.6" fill="currentColor" />
      <circle cx="9" cy="16.5" r="2.6" fill="currentColor" />
    </IconBase>
  );
}

/** Check — marks the selected option in the filter menu. */
export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 6 9 17l-5-5" />
    </IconBase>
  );
}

/** Plus — "new deck" / create affordances. */
export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

/** Folder with a tab — groups that hold decks. */
export function FolderIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Z" />
    </IconBase>
  );
}

/** Pencil — rename a deck or folder in place. */
export function PencilIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3Z" />
      <path d="M13.5 6.5l3 3" />
    </IconBase>
  );
}

/** Trash can — delete a deck or folder. */
export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </IconBase>
  );
}

/** House — return to the home dashboard. Filled to match the gear in
    {@link SettingsIcon}, with the doorway punched out by a mask so the
    background shows through (same treatment as the gear's centre hole). Sized
    to pair with the corner settings button (see SettingsButton / HomeButton). */
export function HomeIcon(props: IconProps) {
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
      <mask id="home-door" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        {/* Doorway knockout */}
        <path
          d="M9.5 20.6V15.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4.8Z"
          fill="black"
          stroke="black"
          strokeWidth={1}
        />
      </mask>

      {/* Roof + walls as one solid silhouette */}
      <path mask="url(#home-door)" d="M12 3.4 21 11v8.6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V11Z" />
    </svg>
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

/** Minus — decrement a card's count in the deck. */
export function MinusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
    </IconBase>
  );
}

/** X — close a dialog / remove a line. */
export function XIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </IconBase>
  );
}

/** Clipboard — copy the exported decklist. */
export function ClipboardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M9 5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3" />
    </IconBase>
  );
}

/** Arrows in/out of a tray — import & export a decklist. */
export function ImportExportIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 14v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
      <path d="M8 8 12 4l4 4" />
      <path d="M12 4v11" />
    </IconBase>
  );
}

/** A framed picture — choosing which card fronts a deck (P5-6). */
export function ImageIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 4.5-4.5a1.5 1.5 0 0 1 2 0L15 17" />
      <path d="m13.5 15.5 2-2a1.5 1.5 0 0 1 2 0L20 16" />
    </IconBase>
  );
}

/** Triangle with a bang — a deck-legality warning/error. */
export function AlertTriangleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10.3 4.3 2.6 17.5a1.5 1.5 0 0 0 1.3 2.3h16.2a1.5 1.5 0 0 0 1.3-2.3L13.7 4.3a1.5 1.5 0 0 0-2.6 0Z" />
      <path d="M12 9v4" />
      <path d="M12 16.5h.01" />
    </IconBase>
  );
}

/** Circle with a tick — a legal, complete deck. */
export function CheckCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 5-5" />
    </IconBase>
  );
}

/** Head + shoulders — a player slot in the online lobby. */
export function UserIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </IconBase>
  );
}

/** Circled "i" — inspect / view a card's full details. */
export function InfoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5h.01" />
    </IconBase>
  );
}

/** Three-quarter ring — a "connecting"/loading spinner. Pair with
    `animate-spin` (Tailwind) so it rotates. */
export function SpinnerIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </IconBase>
  );
}
