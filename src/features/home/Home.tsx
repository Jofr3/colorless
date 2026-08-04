import type { ComponentType, SVGProps } from "react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { AppBackdrop } from "../../components/AppBackdrop";
import { DecksIcon, MoveIcon, SimulatorIcon, SwordsIcon } from "../../components/icons";
import { useTiltJuice } from "../../components/useTiltJuice";
import { CardSheen } from "./CardSheen";

type MenuItem = {
  to: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const MENU_ITEMS: MenuItem[] = [
  // "Play" is the real engine-driven local game; "Sandbox" is the free-form
  // mock board the simulator route has always been.
  { to: "/play", label: "Play", Icon: SimulatorIcon },
  { to: "/simulator", label: "Sandbox", Icon: MoveIcon },
  { to: "/lobby", label: "Online", Icon: SwordsIcon },
  { to: "/decks", label: "Decks", Icon: DecksIcon },
];

// The DOM menu cards share the Balatro tilt + juice with the deck/folder tiles
// via useTiltJuice; here we also feed the pointer to a Pixi sheen shader layered
// inside the (CSS-tilted) card. The simulator cards do the same lean in a Pixi
// vertex shader (see CardView.ts).
function MenuCard({ item }: { item: MenuItem }) {
  const { to, label, Icon } = item;
  const sheenMountRef = useRef<HTMLSpanElement>(null);
  const sheenRef = useRef<CardSheen | null>(null);
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } =
    useTiltJuice<HTMLAnchorElement>({
      // The sheen shader mirrors the pointer through the centre so the glint
      // sits on the edge opposite the cursor — the face the card tilts toward.
      onPointerMove: (px, py) => sheenRef.current?.setPointer(px, py),
      onHoverChange: (hovering) => sheenRef.current?.setHover(hovering),
    });

  // Mount the Pixi sheen shader into its own layer inside the (CSS-tilted) card.
  useEffect(() => {
    const mount = sheenMountRef.current;
    if (!mount) return;
    const sheen = new CardSheen();
    sheenRef.current = sheen;
    sheen.mount(mount);
    return () => {
      sheenRef.current = null;
      sheen.destroy();
    };
  }, []);

  return (
    // Outer layer carries the transient juice (whole-card squash + wobble).
    <div ref={juiceLayerRef} style={juiceStyle}>
      {/* Inner card carries the pointer tilt; its own perspective() makes the
          3D transform self-contained, so it composes with the juice above. */}
      <Link
        ref={tiltRef}
        to={to}
        {...handlers}
        style={tiltStyle}
        className="group relative flex aspect-square w-full select-none flex-col items-center justify-center gap-3 rounded-2xl p-5 text-center shadow-[0_8px_30px_rgba(0,0,0,0.40)] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
      >
        {/* Frosted surface on its own clipped layer. backdrop-filter leaves a
            faint bright rim where its blur kernel clamps at the element edge,
            and on fractional device-pixel grids (display scaling / browser zoom)
            a recompositing neighbour can flash a hairline along it. Oversizing
            the blur by 1px and clipping it to the exact rounded rect pushes that
            fringe outside the visible area, so it's trimmed away. The card's
            drop shadow and focus ring stay on the Link, where clipping can't
            reach them. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -z-10 inset-0 overflow-hidden rounded-2xl"
        >
          <span className="absolute -inset-px bg-white/[0.045] backdrop-blur-md" />
        </span>
        {/* Pixi.js sheen shader, mounted on its own layer above the frost but
            below the icon so it glazes through the glass without washing the
            label. The canvas inherits the card's CSS 3D tilt, so the shader's
            pointer-tracked glint leans with the surface. */}
        <span
          ref={sheenMountRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
        />
        {/* Icon + label brighten and pick up a soft glow on hover. The base
            state carries a zero-radius shadow so the blur grows in smoothly
            rather than snapping on. */}
        <Icon className="h-8 w-8 opacity-80 drop-shadow-[0_0_0_rgba(255,255,255,0)] transition motion-reduce:transition-none duration-100 group-hover:opacity-100 group-hover:drop-shadow-[0_0_4px_rgba(255,255,255,0.30)]" />
        <span className="text-base font-semibold text-white/60 [text-shadow:0_0_0_rgba(255,255,255,0)] transition-all motion-reduce:transition-none duration-100 group-hover:text-white/90 group-hover:[text-shadow:0_0_6px_rgba(255,255,255,0.22)]">
          {label}
        </span>
        {/* Edge highlight + inner ring, painted above the frost so the blur
            can't wash them out. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
        />
      </Link>
    </div>
  );
}

export function Home() {
  return (
    <AppBackdrop>
      <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col items-center justify-center px-6 py-12">
        <h1 className="sr-only">Luminous — main menu</h1>
        {/* 2×2 with four tiles (was 3 across with three). */}
        <nav aria-label="Main menu" className="grid w-full grid-cols-2 gap-4">
          {MENU_ITEMS.map((item) => (
            <MenuCard key={item.to} item={item} />
          ))}
        </nav>
      </main>
    </AppBackdrop>
  );
}
