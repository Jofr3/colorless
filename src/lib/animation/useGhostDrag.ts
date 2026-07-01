// The mechanical core shared by the two pointer drags (useDeckDrag, useCardDrag):
// press-threshold detection, the body-level ghost's rAF spring loop (see
// stepGhostPhysics), the window pointer listeners, the timer-backed release, and
// unmount cleanup. A consumer supplies the feel constants, the ghost element and
// a handful of lifecycle callbacks; everything drag-specific — drop resolution,
// live preview, the accepted/reorder commit — lives in those callbacks, so the
// error-prone lifecycle exists exactly once. See ghostDrag.ts for the physics.

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from "react";
import { type GhostFeel, type GhostState, stepGhostPhysics } from "./ghostDrag";
import { startJuice } from "./juice";

/** The live drag, handed to every consumer callback. `item` is what's being
    dragged; `data` is the consumer's own per-drag scratch (drop target, sibling
    rects, pending commit…), typed by the consumer. */
export interface GhostDrag<TItem, TData> extends GhostState {
  item: TItem;
  data: TData;
  sourceEl: HTMLElement;
  wrapper: HTMLElement | null;
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  halfW: number;
  halfH: number;
  raf: number | null;
  releaseStart: number;
}

/** What a pointerup/cancel resolves to: where the ghost flies and how it pops. */
export interface ReleaseOutcome {
  /** Accepted drops shrink + fade into the target; rejected ones spring home. */
  accepted: boolean;
  /** Centre (viewport px) the ghost springs to during the release. */
  releaseCenter: { x: number; y: number };
  /** Release pop; omitted — or under reduced motion — means no pop. */
  juice?: { amount: number; rotation: number };
}

export interface GhostDragHandlers<TItem, TData> {
  /** Feel constants for the spring/emphasis/release (see {@link GhostFeel}). */
  feel: GhostFeel;
  /** Fresh per-drag scratch state, built at pointerdown. */
  createData: () => TData;
  /** Build the floating ghost element (inline-styled vs. a CSS class differ per
      drag). Only called once the press crosses the drag threshold. */
  createGhost: (source: HTMLElement, rect: DOMRect) => HTMLElement;
  /** Veto starting a drag — e.g. the press landed on an action button or an
      inline editor. Defaults to always allowed. */
  canStart?: (event: ReactPointerEvent<HTMLElement>) => boolean;
  /** Threshold crossed, ghost mounted, physics primed: snapshot layout, set the
      consumer's React state, apply body cursor/class. Runs before the source is
      hidden, so sibling measurements see the resting layout. */
  onBegin?: (drag: GhostDrag<TItem, TData>) => void;
  /** Every move after begin: live drop-target / reorder-preview tracking. */
  onMove?: (x: number, y: number, drag: GhostDrag<TItem, TData>) => void;
  /** Decide the drop on pointerup/cancel. May commit immediately (a card add /
      remove) or stash intent in `drag.data` for {@link finalize}. Returns the
      release target + pop. `event.type === "pointercancel"` is an aborted
      gesture — never a completed drop. */
  resolveRelease: (event: PointerEvent, drag: GhostDrag<TItem, TData>) => ReleaseOutcome;
  /** Fires the instant the release begins (e.g. clear a hover-target state). */
  onReleaseStart?: (drag: GhostDrag<TItem, TData>) => void;
  /** End of the drag: commit deferred intent, clear React state, body cleanup.
      rAF is already cancelled and the ref cleared; call `removeGhost()` at the
      right moment (deck un-hides its source first, avoiding a one-frame flash). */
  finalize: (drag: GhostDrag<TItem, TData>, removeGhost: () => void) => void;
  /** A press that never crossed the threshold — a plain click; the ref is
      already cleared. */
  onClick?: (drag: GhostDrag<TItem, TData>) => void;
  /** Reset any body-level styles the drag applied (cursor, user-select, a
      dragging class) when the component unmounts mid-gesture. Unlike
      {@link finalize} this must NOT commit the drop or touch React state — the
      gesture was abandoned and the component is gone. */
  onUnmount?: () => void;
}

/** Drive a body-level ghost drag. Returns `startDrag(item, event)` to wire onto a
    tile's onPointerDown; the consumer owns its own React state and updates it
    from the lifecycle callbacks. */
export function useGhostDrag<TItem, TData>(handlers: GhostDragHandlers<TItem, TData>) {
  const dragRef = useRef<GhostDrag<TItem, TData> | null>(null);
  // Keep the latest callbacks reachable from the stable, once-bound handlers.
  const hRef = useRef(handlers);
  hRef.current = handlers;

  const finalize = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.raf !== null) cancelAnimationFrame(drag.raf);
    dragRef.current = null;
    hRef.current.finalize(drag, () => drag.wrapper?.remove());
  }, []);

  const tick = useCallback(() => {
    const drag = dragRef.current;
    if (!drag || !drag.wrapper) return;
    const feel = hRef.current.feel;
    const now = performance.now();
    const frame = stepGhostPhysics(drag, feel, now);
    drag.wrapper.style.transform = `translate(${frame.cx - drag.halfW}px, ${frame.cy - drag.halfH}px) rotate(${frame.rotDeg}deg) scale(${frame.scale})`;
    drag.wrapper.style.opacity = `${frame.opacity}`;
    if (drag.releasing && now - drag.releaseStart >= (drag.reduced ? 0 : feel.releaseMs)) {
      finalize();
      return;
    }
    drag.raf = requestAnimationFrame(tick);
  }, [finalize]);

  const beginDrag = useCallback(
    (drag: GhostDrag<TItem, TData>) => {
      const h = hRef.current;
      const rect = drag.sourceEl.getBoundingClientRect();
      drag.wrapper = h.createGhost(drag.sourceEl, rect);
      drag.halfW = rect.width / 2;
      drag.halfH = rect.height / 2;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      drag.cur = { x: cx, y: cy, rot: 0 };
      drag.vel = { x: 0, y: 0, rot: 0 };
      // Lock the grab point so the spot the user grabbed stays under the cursor.
      drag.grab = { x: drag.startX - cx, y: drag.startY - cy };
      drag.emph = 1;
      drag.lift = 0;
      drag.opacity = 1;
      drag.lastFrame = performance.now();
      if (!drag.reduced) {
        drag.juice = startJuice(
          h.feel.pickupJuice.amount,
          h.feel.pickupJuice.rotation,
          performance.now() / 1000,
        );
      }
      h.onBegin?.(drag);
      drag.raf = requestAnimationFrame(tick);
    },
    [tick],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.started) {
        const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (moved <= hRef.current.feel.dragThresholdPx) return;
        drag.started = true;
        beginDrag(drag);
      }
      event.preventDefault();
      drag.pointer = { x: event.clientX, y: event.clientY };
      hRef.current.onMove?.(event.clientX, event.clientY, drag);
    },
    [beginDrag],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      if (!drag.started) {
        // Never crossed the threshold — a plain click; let onClick handle it.
        dragRef.current = null;
        hRef.current.onClick?.(drag);
        return;
      }

      const outcome = hRef.current.resolveRelease(event, drag);
      drag.accepted = outcome.accepted;
      drag.releasing = true;
      drag.releaseStart = performance.now();
      drag.releaseCenter = outcome.releaseCenter;
      if (!drag.reduced && outcome.juice) {
        drag.juice = startJuice(
          outcome.juice.amount,
          outcome.juice.rotation,
          performance.now() / 1000,
        );
      }
      hRef.current.onReleaseStart?.(drag);
      // The release fly-out + commit normally finishes inside the rAF tick, but
      // rAF is paused while the tab is hidden — back it with a timer so the drag
      // never hangs. The identity guard stops a stale timer finalizing a later
      // drag; finalize is idempotent.
      const releasing = drag;
      window.setTimeout(
        () => {
          if (dragRef.current === releasing) finalize();
        },
        (drag.reduced ? 0 : hRef.current.feel.releaseMs) + hRef.current.feel.releaseSlackMs,
      );
    },
    [onPointerMove, finalize],
  );

  const startDrag = useCallback(
    (item: TItem, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || dragRef.current) return;
      if (hRef.current.canStart && !hRef.current.canStart(event)) return;
      dragRef.current = {
        item,
        data: hRef.current.createData(),
        sourceEl: event.currentTarget,
        wrapper: null,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        pointer: { x: event.clientX, y: event.clientY },
        grab: { x: 0, y: 0 },
        cur: { x: 0, y: 0, rot: 0 },
        vel: { x: 0, y: 0, rot: 0 },
        halfW: 0,
        halfH: 0,
        emph: 1,
        lift: 0,
        opacity: 1,
        juice: null,
        releasing: false,
        releaseStart: 0,
        releaseCenter: { x: 0, y: 0 },
        accepted: false,
        raf: null,
        lastFrame: 0,
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  // Tear down a drag still in flight if the component unmounts mid-gesture —
  // otherwise the window listeners, the body-level ghost node and the rAF loop
  // all leak past unmount. This is mechanical only: the gesture is abandoned, so
  // (unlike a real release) it must NOT commit the drop or set React state —
  // just drop the ghost and reset body styles via onUnmount.
  useEffect(() => {
    return () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.raf !== null) cancelAnimationFrame(drag.raf);
      drag.wrapper?.remove();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      dragRef.current = null;
      hRef.current.onUnmount?.();
    };
  }, [onPointerMove, onPointerUp]);

  return { startDrag };
}
