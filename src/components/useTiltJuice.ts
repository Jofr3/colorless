import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef } from "react";
import { evaluateJuice, initialSquish, type JuiceState, startJuice } from "../lib/animation/juice";

// Balatro hover/tilt port for DOM cards. On hover the card leans *away* from the
// cursor — the corner farthest from the pointer is displaced most — plus a steady
// scale pop (+0.05) and a transient "juice" bounce. The tilt is a perspective CSS
// transform driven by the pointer; the juice is the part that can't be a CSS
// transition, so it runs per-frame on a separate wrapper layer.
const MAX_TILT_DEG = 12; // peak lean at the card edges
const HOVER_SCALE = 1.045; // Balatro's steady +0.05 hover scale (moveable.lua:424)

// The juice envelope lives in lib/animation/juice (shared with CardView and the
// decks drag). fireJuice(amount, rotation) seeds it; the per-frame loop applies
// the raw oscillation to the --js/--jr CSS vars (scale → 1 + value, rotation ×2).
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
  /** Suppress the pointer tilt/juice while true, and reset the card to rest.
      Used during a decks drag: the floating ghost is pointer-events:none so it
      can hit-test drop targets, which means hover events fall *through* it to the
      tile underneath — without this that tile would lean as the ghost passes. */
  disabled?: boolean;
  /** Fire the juice pop whenever this value changes to a non-null value. Lets a
      card shake in response to an external event — e.g. the deck builder pulses
      both the gallery and deck tiles for a card when its copy count changes. */
  pulse?: number | null;
};

/** Wires the Balatro tilt + juice onto a card: attach `tiltRef`/`tiltStyle` and
    the returned pointer `handlers` to the leaning surface, and wrap it in a
    `juiceLayerRef`/`juiceStyle` element that carries the squash-and-wobble. */
export function useTiltJuice<T extends HTMLElement>(options: TiltJuiceOptions = {}) {
  const tiltRef = useRef<T>(null);
  const juiceLayerRef = useRef<HTMLDivElement>(null);
  const tiltFrame = useRef<number | null>(null);
  const juiceFrame = useRef<number | null>(null);
  const juiceState = useRef<JuiceState | null>(null);
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
      const value = evaluateJuice(juiceState.current, performance.now() / 1000);
      if (!layer || !value) {
        // No layer, or the envelope has elapsed — settle to rest and stop.
        juiceState.current = null;
        layer?.style.setProperty("--js", "1");
        layer?.style.setProperty("--jr", "0deg");
        juiceFrame.current = null;
        return;
      }
      // scale → 1 + value; rotation ×2 matches move_r's juice multiplier
      // (juice.r*2, moveable.lua:448), then to degrees for the CSS var.
      layer.style.setProperty("--js", `${1 + value.scale}`);
      layer.style.setProperty("--jr", `${(value.rotation * 2 * RAD_TO_DEG).toFixed(3)}deg`);
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
      juiceState.current = startJuice(amount, rotation, performance.now() / 1000);
      // Apply the initial squish synchronously so frame one already looks pressed.
      layer.style.setProperty("--js", `${initialSquish(amount)}`);
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
  const { juiceOnMount, disabled, pulse } = options;
  useEffect(() => {
    if (juiceOnMount) juiceRunner.current(SPAWN_JUICE.amount, SPAWN_JUICE.rotation);
  }, [juiceOnMount]);

  // External pulse: shake whenever `pulse` changes to a non-null value. A null
  // pulse (this card isn't the one that changed) is a no-op, including on mount,
  // so the initial deck load doesn't shake every tile.
  useEffect(() => {
    if (pulse == null) return;
    juiceRunner.current(PRESS_JUICE.amount, PRESS_JUICE.rotation);
  }, [pulse]);

  // When tilt is disabled (a drag is in flight), snap the card flat in case it
  // was mid-lean when the drag began, and below the handlers no-op so it stays
  // put while the ghost floats over it.
  useEffect(() => {
    const el = tiltRef.current;
    if (!disabled || !el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--s", "1");
  }, [disabled]);

  const handlePointerEnter = () => {
    if (disabled) return;
    tiltRef.current?.style.setProperty("--s", `${HOVER_SCALE}`);
    options.onHoverChange?.(true);
    juiceRunner.current(HOVER_JUICE.amount, HOVER_JUICE.rotation);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const el = tiltRef.current;
    if (!el || disabled) return;
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

  const handlePointerDown = () => {
    if (disabled) return;
    juiceRunner.current(PRESS_JUICE.amount, PRESS_JUICE.rotation);
  };

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
