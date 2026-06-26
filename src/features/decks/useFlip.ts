import { useLayoutEffect, useRef } from "react";

// FLIP (First-Last-Invert-Play) for a grid whose children reorder. On every
// render it records each child's layout position and, when a child has moved
// since the last render, plays it from its old spot to the new one — so the
// deck/folder tiles slide aside as a dragged tile's insertion slot moves,
// mirroring the simulator bench's make-room motion (which springs its siblings
// to new slots). The decks grid is plain CSS grid, where a reorder reflows
// instantly with no transition, so we animate the delta ourselves.
//
// Positions are read from offsetLeft/offsetTop, which reflect the laid-out grid
// position and ignore CSS transforms — so an in-flight FLIP animation never
// feeds back into the next measurement, and scrolling the list mid-drag doesn't
// register as movement. Honors prefers-reduced-motion by skipping the animation
// (the reorder still applies instantly).

const FLIP_MS = 220;
// Matches the tilt's ease (useTiltJuice TILT_STYLE) so the page's motion reads
// of a piece — a quick, slightly overshooting settle.
const FLIP_EASING = "cubic-bezier(0.22,0.61,0.36,1)";

interface Pos {
  x: number;
  y: number;
}

/** Attach the returned ref to a grid container; its direct children carrying a
    `data-flip-id` animate between layout positions whenever they reorder and
    `active` is true. `active` gates the animation (not the measurement), so the
    baseline stays fresh while idle and the first reorder of a drag animates from
    the resting layout rather than snapping. */
export function useFlip<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  const prev = useRef<Map<string, Pos>>(new Map());
  const anims = useRef<Map<string, Animation>>(new Map());

  // No deps: runs after every render so it catches both live reorder previews
  // and the final committed order. Layout effect so it measures before paint.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      prev.current.clear();
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, Pos>();
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const id = child.dataset.flipId;
      if (!id) continue;
      const pos = { x: child.offsetLeft, y: child.offsetTop };
      next.set(id, pos);
      if (!active || reduced) continue;
      const old = prev.current.get(id);
      if (!old) continue;
      const dx = old.x - pos.x;
      const dy = old.y - pos.y;
      if (dx === 0 && dy === 0) continue;
      // Restart cleanly if this tile is still mid-slide from a quick prior move.
      anims.current.get(id)?.cancel();
      const anim = child.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }],
        { duration: FLIP_MS, easing: FLIP_EASING },
      );
      anims.current.set(id, anim);
      anim.addEventListener("finish", () => {
        if (anims.current.get(id) === anim) anims.current.delete(id);
      });
    }
    prev.current = next;
  });

  return ref;
}
