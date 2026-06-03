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

/** Two chess pieces — a taller king and a shorter pawn — for the battle/playmat
    simulator. Drawn in the same 24×24, 1.5-stroke, rounded-cap style as
    {@link SwordsIcon}: a thin line outline over solid fills. */
export function SimulatorIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* King (left). Cross finial. */}
      <path
        fill="currentColor"
        d="M6.65 2.5h1.6v1.1h1v1.4h-1v1.1h-1.6V5h-1V3.6h1Z"
      />
      {/* King crowned head, neck and flared body. */}
      <path
        fill="currentColor"
        d="M4.95 8.3c0-1.4 1.1-2.2 2.5-2.2s2.5.8 2.5 2.2c0 1.1-.6 1.8-1.3 2.3l2.55 7.9H3.7l2.55-7.9C5.55 10.1 4.95 9.4 4.95 8.3Z"
      />
      {/* King base. */}
      <rect x="3.7" y="18.5" width="7.5" height="2.6" rx="1" fill="currentColor" />
      {/* Pawn (right). Round head. */}
      <circle cx="16.75" cy="10" r="2.2" fill="currentColor" />
      {/* Pawn neck and flared body. */}
      <path
        fill="currentColor"
        d="M15.15 11.9c-.6.7-.45 1.3.1 1.8l-1.35 4.8h5.7l-1.35-4.8c.55-.5.7-1.1.1-1.8Z"
      />
      {/* Pawn base. */}
      <rect x="13.5" y="18.5" width="6.5" height="2.6" rx="1" fill="currentColor" />
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

/** Stacked layers (Lucide-style) — your decks. Same 24×24, 1.5-stroke, rounded
    look as {@link SwordsIcon}: a solid top card over thin stacking lines. */
export function DecksIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Solid top card. */}
      <path fill="currentColor" d="M12 2 2 7l10 5 10-5-10-5Z" />
      {/* Cards stacked underneath. */}
      <path d="m2 12 10 5 10-5" />
      <path d="m2 17 10 5 10-5" />
    </svg>
  );
}

/** Gear (Lucide-style) — user settings. Same 24×24, 1.5-stroke, rounded look as
    {@link SwordsIcon}: a thin line cog rather than a heavy solid silhouette. */
export function SettingsIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
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
