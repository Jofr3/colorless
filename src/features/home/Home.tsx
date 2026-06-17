import type { ComponentType, PointerEvent as ReactPointerEvent, SVGProps } from "react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { AppBackdrop } from "../../components/AppBackdrop";
import { DecksIcon, SimulatorIcon, SwordsIcon } from "../../components/icons";

type MenuItem = {
  to: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const MENU_ITEMS: MenuItem[] = [
  { to: "/simulator", label: "Simulator", Icon: SimulatorIcon },
  { to: "/lobby/create", label: "Online", Icon: SwordsIcon },
  { to: "/decks", label: "Decks", Icon: DecksIcon },
];

// Balatro hover/tilt port for the DOM menu cards. The simulator cards do this
// in a Pixi vertex shader (see CardView.ts): on hover the quad leans *away*
// from the cursor — the corner farthest from the pointer is displaced most —
// plus a steady scale pop (+0.05) and a transient "juice" bounce. The tilt is
// a perspective CSS transform driven by the pointer; the juice is the part
// that can't be a CSS transition, so it runs per-frame (see below).
const MAX_TILT_DEG = 12; // peak lean at the card edges
const HOVER_SCALE = 1.045; // Balatro's steady +0.05 hover scale (moveable.lua:424)

// Juice envelope, ported verbatim from CardView.evaluateJuice (Balatro
// moveable.lua:250-276): an initial squish, then a decaying oscillation —
// sin(50.8·t) on scale under a cubic envelope, sin(40.8·t) on rotation under a
// squared envelope, over 0.4s. juiceUp(amount, rotation) seeds it.
const JUICE_DURATION = 0.4;
const JUICE_SCALE_FREQ = 50.8;
const JUICE_ROT_FREQ = 40.8;
const JUICE_INITIAL_SQUISH = 0.6; // VT.scale = 1 - 0.6*amount
const RAD_TO_DEG = 180 / Math.PI;
// Hover fires Balatro's card hover juice (card.lua:4307 → 0.02/0.012, nudged up
// a touch so it reads on a large button); a press gives a stronger pop.
const HOVER_JUICE = { amount: 0.03, rotation: 0.018 };
const PRESS_JUICE = { amount: 0.05, rotation: 0.025 };

function MenuCard({ item }: { item: MenuItem }) {
  const { to, label, Icon } = item;
  const cardRef = useRef<HTMLAnchorElement>(null);
  const juiceLayerRef = useRef<HTMLDivElement>(null);
  const tiltFrame = useRef<number | null>(null);
  const juiceFrame = useRef<number | null>(null);
  const juiceState = useRef<{ amount: number; rotation: number; start: number } | null>(null);
  const juiceRunner = useRef<(amount: number, rotation: number) => void>(() => {});

  // Per-frame juice loop. Writes --js (scale) / --jr (rotation) on the inner
  // layer with no CSS transition, so the fast oscillation isn't smeared by the
  // tilt's 140ms transition on the outer card.
  useEffect(() => {
    const tickJuice = () => {
      const layer = juiceLayerRef.current;
      const state = juiceState.current;
      if (!layer || !state) {
        juiceFrame.current = null;
        return;
      }
      const elapsed = performance.now() / 1000 - state.start;
      const remaining = (JUICE_DURATION - elapsed) / JUICE_DURATION;
      if (remaining <= 0) {
        juiceState.current = null;
        layer.style.setProperty("--js", "1");
        layer.style.setProperty("--jr", "0deg");
        juiceFrame.current = null;
        return;
      }
      const scale = 1 + state.amount * Math.sin(JUICE_SCALE_FREQ * elapsed) * remaining ** 3;
      // *2 matches move_r's juice multiplier (juice.r*2, moveable.lua:448).
      const rotation = state.rotation * Math.sin(JUICE_ROT_FREQ * elapsed) * remaining ** 2 * 2;
      layer.style.setProperty("--js", `${scale}`);
      layer.style.setProperty("--jr", `${(rotation * RAD_TO_DEG).toFixed(3)}deg`);
      juiceFrame.current = requestAnimationFrame(tickJuice);
    };

    const fireJuice = (amount: number, rotation: number) => {
      const layer = juiceLayerRef.current;
      if (!layer) return;
      juiceState.current = { amount, rotation, start: performance.now() / 1000 };
      // Apply the initial squish synchronously so frame one already looks pressed.
      layer.style.setProperty("--js", `${1 - JUICE_INITIAL_SQUISH * amount}`);
      if (juiceFrame.current === null) juiceFrame.current = requestAnimationFrame(tickJuice);
    };
    juiceRunner.current = fireJuice;

    return () => {
      if (juiceFrame.current !== null) cancelAnimationFrame(juiceFrame.current);
      if (tiltFrame.current !== null) cancelAnimationFrame(tiltFrame.current);
    };
  }, []);

  const handleEnter = () => {
    cardRef.current?.style.setProperty("--s", `${HOVER_SCALE}`);
    juiceRunner.current(HOVER_JUICE.amount, HOVER_JUICE.rotation);
  };

  const handleMove = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // px/py: 0..1 across the card; off*: -0.5..0.5 from centre.
    const offX = (event.clientX - rect.left) / rect.width - 0.5;
    const offY = (event.clientY - rect.top) / rect.height - 0.5;
    if (tiltFrame.current !== null) cancelAnimationFrame(tiltFrame.current);
    tiltFrame.current = requestAnimationFrame(() => {
      // Lean away from the cursor: pointer on the right tips the right edge
      // back (+rotateY), pointer near the top tips the top edge back (+rotateX).
      el.style.setProperty("--rx", `${-offY * 2 * MAX_TILT_DEG}deg`);
      el.style.setProperty("--ry", `${offX * 2 * MAX_TILT_DEG}deg`);
    });
  };

  const handleLeave = () => {
    const el = cardRef.current;
    if (!el) return;
    if (tiltFrame.current !== null) cancelAnimationFrame(tiltFrame.current);
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--s", "1");
  };

  const handleDown = () => juiceRunner.current(PRESS_JUICE.amount, PRESS_JUICE.rotation);

  return (
    // Outer layer carries the transient juice (whole-card squash + wobble),
    // driven per-frame with no transition so the fast oscillation stays crisp.
    <div
      ref={juiceLayerRef}
      style={{
        transform: "scale(var(--js,1)) rotate(var(--jr,0deg))",
        willChange: "transform",
      }}
    >
      {/* Inner card carries the pointer tilt; its own perspective() makes the
          3D transform self-contained, so it composes with the juice above. */}
      <Link
        ref={cardRef}
        to={to}
        onPointerEnter={handleEnter}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onPointerDown={handleDown}
        style={{
          transform:
            "perspective(700px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) scale(var(--s,1))",
          transition: "transform 140ms cubic-bezier(0.22,0.61,0.36,1)",
          willChange: "transform",
        }}
        className="relative flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-2xl p-5 text-center shadow-[0_8px_30px_rgba(0,0,0,0.40)] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
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
        <Icon className="h-8 w-8 opacity-80" />
        <span className="text-base font-semibold text-white/60">{label}</span>
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
        <nav aria-label="Main menu" className="grid w-full grid-cols-3 gap-4">
          {MENU_ITEMS.map((item) => (
            <MenuCard key={item.to} item={item} />
          ))}
        </nav>
      </main>
    </AppBackdrop>
  );
}
