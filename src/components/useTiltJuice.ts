import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef } from "react";

// Balatro hover/tilt port for DOM cards. On hover the card leans *away* from the
// cursor — the corner farthest from the pointer is displaced most — plus a steady
// scale pop (+0.05) and a transient "juice" bounce. The tilt is a perspective CSS
// transform driven by the pointer; the juice is the part that can't be a CSS
// transition, so it runs per-frame on a separate wrapper layer.
const MAX_TILT_DEG = 12; // peak lean at the card edges
const HOVER_SCALE = 1.045; // Balatro's steady +0.05 hover scale (moveable.lua:424)

// Juice envelope, ported verbatim from CardView.evaluateJuice (Balatro
// moveable.lua:250-276): an initial squish, then a decaying oscillation —
// sin(50.8·t) on scale under a cubic envelope, sin(40.8·t) on rotation under a
// squared envelope, over 0.4s. fireJuice(amount, rotation) seeds it.
const JUICE_DURATION = 0.4;
const JUICE_SCALE_FREQ = 50.8;
const JUICE_ROT_FREQ = 40.8;
const JUICE_INITIAL_SQUISH = 0.6; // VT.scale = 1 - 0.6*amount
const RAD_TO_DEG = 180 / Math.PI;
// Hover fires Balatro's card hover juice (card.lua:4307 → 0.02/0.012, nudged up
// a touch so it reads on a large button); a press gives a stronger pop.
const HOVER_JUICE = { amount: 0.03, rotation: 0.018 };
const PRESS_JUICE = { amount: 0.05, rotation: 0.025 };
// A stronger pop fired when a card first appears (e.g. a freshly created deck).
const SPAWN_JUICE = { amount: 0.08, rotation: 0.035 };

// Outer layer carries the transient juice (whole-card squash + wobble), driven
// per-frame with no transition so the fast oscillation stays crisp.
const JUICE_STYLE: CSSProperties = {
  transform: "scale(var(--js,1)) rotate(var(--jr,0deg))",
  willChange: "transform",
};

// Inner layer carries the pointer tilt; its own perspective() makes the 3D
// transform self-contained, so it composes with the juice on the layer above.
const TILT_STYLE: CSSProperties = {
  transform: "perspective(700px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) scale(var(--s,1))",
  transition: "transform 140ms cubic-bezier(0.22,0.61,0.36,1)",
  willChange: "transform",
};

export type TiltJuiceOptions = {
  /** Normalised pointer position (0..1 across the card) on every move. Lets the
      caller drive an extra pointer-tracked effect, e.g. the home sheen shader. */
  onPointerMove?: (px: number, py: number) => void;
  /** Fires on pointer enter (true) and leave (false). */
  onHoverChange?: (hovering: boolean) => void;
  /** Fire the juice once the moment the card first mounts — e.g. a freshly
      created card popping into place. */
  juiceOnMount?: boolean;
};

/** Wires the Balatro tilt + juice onto a card: attach `tiltRef`/`tiltStyle` and
    the returned pointer `handlers` to the leaning surface, and wrap it in a
    `juiceLayerRef`/`juiceStyle` element that carries the squash-and-wobble. */
export function useTiltJuice<T extends HTMLElement>(options: TiltJuiceOptions = {}) {
  const tiltRef = useRef<T>(null);
  const juiceLayerRef = useRef<HTMLDivElement>(null);
  const tiltFrame = useRef<number | null>(null);
  const juiceFrame = useRef<number | null>(null);
  const juiceState = useRef<{ amount: number; rotation: number; start: number } | null>(null);
  const juiceRunner = useRef<(amount: number, rotation: number) => void>(() => {});
  const reducedMotionRef = useRef(false);

  // Honor prefers-reduced-motion: when set, the oscillating juice and the 3D
  // pointer tilt are skipped (only the static hover scale remains). Kept live
  // via the matchMedia 'change' subscription so an OS toggle applies without a
  // reload, matching CardView/glowRenderer/CardSheen.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = query.matches;
    const handleChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  // Per-frame juice loop. Writes --js (scale) / --jr (rotation) on the juice
  // layer with no CSS transition, so the fast oscillation isn't smeared by the
  // tilt's 140ms transition on the inner surface.
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
      if (reducedMotionRef.current) {
        // Reduced motion: no squash/wobble. Pin the layer to its resting values.
        layer.style.setProperty("--js", "1");
        layer.style.setProperty("--jr", "0deg");
        return;
      }
      juiceState.current = { amount, rotation, start: performance.now() / 1000 };
      // Apply the initial squish synchronously so frame one already looks pressed.
      layer.style.setProperty("--js", `${1 - JUICE_INITIAL_SQUISH * amount}`);
      if (juiceFrame.current === null) juiceFrame.current = requestAnimationFrame(tickJuice);
    };
    juiceRunner.current = fireJuice;

    return () => {
      // Null the handles after cancelling, not just cancel them: a juice fired
      // during mount (juiceOnMount) starts a frame that StrictMode's mount →
      // cleanup → remount cancels here; if the handle stayed non-null, fireJuice
      // would think a loop was still running and never restart it on remount.
      if (juiceFrame.current !== null) {
        cancelAnimationFrame(juiceFrame.current);
        juiceFrame.current = null;
      }
      if (tiltFrame.current !== null) {
        cancelAnimationFrame(tiltFrame.current);
        tiltFrame.current = null;
      }
    };
  }, []);

  // Pop the card with a juice bounce the moment it first appears, if asked. The
  // juice runner is wired by the effect above, which runs first on mount.
  const { juiceOnMount } = options;
  useEffect(() => {
    if (juiceOnMount) juiceRunner.current(SPAWN_JUICE.amount, SPAWN_JUICE.rotation);
  }, [juiceOnMount]);

  const handlePointerEnter = () => {
    tiltRef.current?.style.setProperty("--s", `${HOVER_SCALE}`);
    options.onHoverChange?.(true);
    juiceRunner.current(HOVER_JUICE.amount, HOVER_JUICE.rotation);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const el = tiltRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // off*: -0.5..0.5 from the card centre.
    const offX = (event.clientX - rect.left) / rect.width - 0.5;
    const offY = (event.clientY - rect.top) / rect.height - 0.5;
    options.onPointerMove?.(offX + 0.5, offY + 0.5);
    // Reduced motion: track the pointer for callers (e.g. the sheen) but skip
    // the 3D perspective tilt entirely, leaving --rx/--ry at rest.
    if (reducedMotionRef.current) return;
    if (tiltFrame.current !== null) cancelAnimationFrame(tiltFrame.current);
    tiltFrame.current = requestAnimationFrame(() => {
      // Lean away from the cursor: pointer on the right tips the right edge back
      // (+rotateY), pointer near the top tips the top edge back (+rotateX).
      el.style.setProperty("--rx", `${-offY * 2 * MAX_TILT_DEG}deg`);
      el.style.setProperty("--ry", `${offX * 2 * MAX_TILT_DEG}deg`);
    });
  };

  const handlePointerLeave = () => {
    const el = tiltRef.current;
    if (!el) return;
    if (tiltFrame.current !== null) cancelAnimationFrame(tiltFrame.current);
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--s", "1");
    options.onHoverChange?.(false);
  };

  const handlePointerDown = () => juiceRunner.current(PRESS_JUICE.amount, PRESS_JUICE.rotation);

  return {
    tiltRef,
    juiceLayerRef,
    juiceStyle: JUICE_STYLE,
    tiltStyle: TILT_STYLE,
    handlers: {
      onPointerEnter: handlePointerEnter,
      onPointerMove: handlePointerMove,
      onPointerLeave: handlePointerLeave,
      onPointerDown: handlePointerDown,
    },
  };
}
