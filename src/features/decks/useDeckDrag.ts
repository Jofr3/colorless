import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { evaluateJuice, type JuiceState, startJuice } from "../../lib/animation/juice";
import {
  clampVelocity,
  dragTiltFromVelocity,
  SPRING_C_ROT_DRAG,
  SPRING_MAX_DT,
  stepSpringScalar,
  stepSpringXY,
} from "../../lib/animation/spring";
import { insertionIndex, type ReorderRect } from "./reorder";

// Pointer-driven drag for the decks library, ported from the simulator's card
// drag (features/playmat/pixi/CardView.ts). Native HTML5 drag-and-drop can only
// dim the source and let the browser drag a frozen ghost image; here we lift a
// live clone of the tile into a body-level overlay and run the simulator's exact
// spring + juice on it, so a folder/deck "picks up", spring-follows the cursor
// with a velocity-driven tilt, and pops into its target (or wobbles back home).
//
// Two drop outcomes share this gesture:
//   • nest    — drop a deck/folder onto a folder (or the breadcrumb/root) to
//               move it inside; the ghost shrinks and fades into the target.
//   • reorder — drop among same-kind siblings to rearrange them (decks among
//               decks, folders among folders), like the simulator bench. The
//               ghost springs to its new slot and the siblings slide aside
//               (the FLIP in useFlip). Folders are both nestable and orderable,
//               so a folder dragged over another folder nests only when over its
//               centre and reorders past its edges (see updateTarget).
//
// Spring + juice constants below are copied verbatim from CardView so the two
// drags feel identical; see that file for the Balatro source references.

/** A library entry mid-drag. */
export type DragItem = { type: "deck" | "folder"; id: string };

/** Live reorder preview: where the dragged item currently sits among its
    same-kind siblings, so the grid can render that order and slide tiles aside. */
export interface ReorderPreview {
  group: "deck" | "folder";
  /** Insertion index among the siblings (the visible group minus the dragged). */
  index: number;
}

interface UseDeckDragOptions {
  /** Whether `item` may land in `targetFolderId` (null = library root). */
  canDrop: (item: DragItem, targetFolderId: string | null) => boolean;
  /** Commit an accepted nest (move into a folder / the root). */
  onDrop: (item: DragItem, targetFolderId: string | null) => void;
  /** Whether `item` may be drag-reordered right now (false e.g. while searching,
      where the list isn't a stable orderable view). */
  canReorder: (item: DragItem) => boolean;
  /** Commit a reorder: place `item` at insertion `index` among its siblings. */
  onReorder: (item: DragItem, index: number) => void;
}

// Spring + juice physics are shared with the simulator card layer — see
// lib/animation/{spring,juice}. The constants below are decks-drag specific.

// Emphasis while picked up: +0.10 scale and a small upward lift, matching
// CardView.applyEmphasisTween (drag scale 1.1) + computeDragLiftOffset (14px).
const PICKUP_SCALE = 1.1;
const PICKUP_LIFT_PX = 14;
const ACCEPTED_LAND_SCALE = 0.55;

// Pickup / land / reject pops (CardView.startDrag / applyReleaseMotion).
const PICKUP_JUICE = { amount: 0.04, rotation: 0.02 };
const LAND_JUICE = { amount: 0.07, rotation: 0 };
const REJECT_JUICE = { amount: 0.025, rotation: 0.18 };

// How far the pointer must travel before a press becomes a drag (vs. a click).
const DRAG_THRESHOLD_PX = 5;
// Release fly-out / spring-home duration before the ghost is removed.
const RELEASE_MS = 300;

const RAD_TO_DEG = 180 / Math.PI;

interface Vel {
  x: number;
  y: number;
  rot: number;
}

interface Drag {
  item: DragItem;
  sourceEl: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  // Set once the pointer crosses the drag threshold; until then it's a click.
  started: boolean;
  pointer: { x: number; y: number };
  // Offset from the ghost centre to the grab point, so that point stays under
  // the cursor.
  grab: { x: number; y: number };
  cur: { x: number; y: number; rot: number };
  vel: Vel;
  emph: number;
  lift: number;
  opacity: number;
  juice: JuiceState | null;
  reduced: boolean;
  halfW: number;
  halfH: number;
  wrapper: HTMLElement | null;
  raf: number | null;
  lastFrame: number;
  // Live nest target under the cursor (only set when canDrop allows it).
  dropFolderId: string | null;
  dropTargetEl: HTMLElement | null;
  dropOk: boolean;
  lastDropKey: string | null;
  // Reorder: the same-kind siblings' frozen start rects (visible order, minus
  // the dragged tile), and the live insertion index computed against them. Rects
  // are snapshotted once at pickup so the make-room shift never feeds back into
  // the index math. Null when this item can't be reordered (e.g. searching).
  baseSiblings: ReorderRect[] | null;
  reorderIndex: number | null;
  lastReorder: ReorderPreview | null;
  // Release phase.
  releasing: boolean;
  releaseStart: number;
  releaseCenter: { x: number; y: number };
  // accepted === a committed nest (ghost shrinks into the folder). A reorder is
  // not "accepted" — it springs back to its slot like a return-home but commits
  // the new index via reorderCommitIndex.
  accepted: boolean;
  pendingFolderId: string | null;
  reorderCommitIndex: number | null;
}

function centerOf(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// Build the floating clone. Tilt/juice CSS vars are stripped so the lifted card
// reads as a clean, upright tile rather than freezing whatever hover lean it
// had at grab time.
function makeGhost(source: HTMLElement, rect: DOMRect) {
  const clone = source.cloneNode(true) as HTMLElement;
  const resetVars = (el: HTMLElement) => {
    for (const prop of ["--rx", "--ry", "--s", "--js", "--jr"]) {
      el.style.removeProperty(prop);
    }
  };
  resetVars(clone);
  for (const el of clone.querySelectorAll<HTMLElement>("[style]")) resetVars(el);
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = "0";

  const wrapper = document.createElement("div");
  wrapper.className = "deck-drag-ghost";
  wrapper.style.width = `${rect.width}px`;
  wrapper.style.height = `${rect.height}px`;
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  return wrapper;
}

export function useDeckDrag({ canDrop, onDrop, canReorder, onReorder }: UseDeckDragOptions) {
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [reorder, setReorder] = useState<ReorderPreview | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // Keep the latest callbacks reachable from the stable handlers below.
  const optsRef = useRef({ canDrop, onDrop, canReorder, onReorder });
  optsRef.current = { canDrop, onDrop, canReorder, onReorder };

  const finalize = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.raf !== null) cancelAnimationFrame(drag.raf);
    document.body.style.cursor = "";
    document.body.classList.remove("decks-dragging");
    const { item, accepted, pendingFolderId, reorderCommitIndex, wrapper } = drag;
    dragRef.current = null;
    // Un-hide the source (and commit the nest/reorder) *before* removing the
    // ghost. finalize runs from a timer/rAF, where React's concurrent scheduler
    // would defer this state commit to a later frame — so a plain
    // `setDragItem(null)` paints the source un-hidden one frame *after* the ghost
    // is gone, leaving a one-frame gap where neither shows: the "flash" on
    // release. flushSync forces the un-hide to land in this same task, so the
    // restored source and the removed ghost paint together. Committing here also
    // re-renders the tile into its new spot in one pass — no flash of the entry
    // back in its old slot. The committed order matches the live preview, so the
    // tile stays put as the preview state clears.
    flushSync(() => {
      if (accepted) optsRef.current.onDrop(item, pendingFolderId);
      else if (reorderCommitIndex !== null) optsRef.current.onReorder(item, reorderCommitIndex);
      setDragItem(null);
      setDropTarget(null);
      setReorder(null);
    });
    wrapper?.remove();
  }, []);

  const tick = useCallback(() => {
    const drag = dragRef.current;
    if (!drag || !drag.wrapper) return;

    const now = performance.now();
    const dt = Math.min((now - drag.lastFrame) / 1000, SPRING_MAX_DT);
    drag.lastFrame = now;

    const desired = drag.releasing
      ? drag.releaseCenter
      : { x: drag.pointer.x - drag.grab.x, y: drag.pointer.y - drag.grab.y };

    drag.cur.x = stepSpringXY(drag.cur.x, desired.x, dt, drag.vel, "x");
    drag.cur.y = stepSpringXY(drag.cur.y, desired.y, dt, drag.vel, "y");

    // Drag tilt comes from the position spring's own velocity (CardView does
    // the same) — quiet at low speed, ramping to the cap on a fast throw.
    const velTilt = !drag.reduced && !drag.releasing ? dragTiltFromVelocity(drag.vel.x, dt) : 0;
    clampVelocity(drag.vel, dt);
    drag.cur.rot = stepSpringScalar(drag.cur.rot, velTilt, dt, SPRING_C_ROT_DRAG, drag.vel, "rot");

    // Emphasis scale, lift and opacity ease toward their phase targets.
    const emphTarget = drag.releasing ? (drag.accepted ? ACCEPTED_LAND_SCALE : 1) : PICKUP_SCALE;
    const liftTarget = drag.releasing ? 0 : PICKUP_LIFT_PX;
    const opacityTarget = drag.releasing && drag.accepted ? 0 : 1;
    const ease = drag.reduced ? 1 : 1 - Math.exp(-14 * dt);
    drag.emph += (emphTarget - drag.emph) * ease;
    drag.lift += (liftTarget - drag.lift) * ease;
    drag.opacity += (opacityTarget - drag.opacity) * (drag.reduced ? 1 : 1 - Math.exp(-12 * dt));

    const juice = drag.reduced ? null : evaluateJuice(drag.juice, now / 1000);
    if (!juice) drag.juice = null;
    const juiceScale = juice ? juice.scale : 0;
    // *2 matches move_r's juice multiplier (CardView.applyJuiceTransform).
    const juiceRot = juice ? juice.rotation * 2 : 0;

    const scale = Math.max(0.01, drag.emph * (1 + juiceScale));
    const rotDeg = (drag.cur.rot + juiceRot) * RAD_TO_DEG;
    const cx = drag.cur.x;
    const cy = drag.cur.y - drag.lift;
    drag.wrapper.style.transform = `translate(${cx - drag.halfW}px, ${cy - drag.halfH}px) rotate(${rotDeg}deg) scale(${scale})`;
    drag.wrapper.style.opacity = `${drag.opacity}`;

    if (drag.releasing && now - drag.releaseStart >= (drag.reduced ? 0 : RELEASE_MS)) {
      finalize();
      return;
    }
    drag.raf = requestAnimationFrame(tick);
  }, [finalize]);

  // A click fires right after a real drag (pointerup → click). Swallow that one
  // click so dragging a folder onto a target doesn't also "open" it.
  const suppressNextClick = useCallback(() => {
    const handler = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
      window.removeEventListener("click", handler, true);
    };
    window.addEventListener("click", handler, true);
    window.setTimeout(() => window.removeEventListener("click", handler, true), 350);
  }, []);

  // The central fraction of a folder tile that nests rather than reorders, on
  // each axis. Outside this box (the tile's border region) a dragged folder
  // reorders past it instead — "centre = nest, edges = reorder".
  const NEST_BAND = 0.25;

  const updateTarget = useCallback((x: number, y: number) => {
    const drag = dragRef.current;
    if (!drag) return;

    // 1. Nest target under the cursor (folder tile, breadcrumb, root, or up).
    const hit = document.elementFromPoint(x, y);
    const targetEl = hit?.closest<HTMLElement>("[data-drop-key]") ?? null;
    let nestKey: string | null = null;
    let nestFolderId: string | null = null;
    let nestEl: HTMLElement | null = null;
    if (targetEl) {
      const raw = targetEl.dataset.dropFolder ?? "";
      const folderId = raw === "" ? null : raw;
      if (optsRef.current.canDrop(drag.item, folderId)) {
        // Folder grid tiles carry data-reorder-id (they're reorder siblings too);
        // the breadcrumb/root/up targets don't and always nest. A *folder*
        // dropped onto another folder tile only nests over the tile's centre, so
        // its edges stay free to reorder past. A deck always nests onto a folder
        // (decks don't reorder among folders).
        const isTile = targetEl.dataset.reorderId !== undefined;
        let nest = true;
        if (isTile && drag.item.type === "folder") {
          const r = targetEl.getBoundingClientRect();
          const fx = (x - r.left) / r.width;
          const fy = (y - r.top) / r.height;
          nest = fx > NEST_BAND && fx < 1 - NEST_BAND && fy > NEST_BAND && fy < 1 - NEST_BAND;
        }
        if (nest) {
          nestKey = targetEl.dataset.dropKey ?? null;
          nestFolderId = folderId;
          nestEl = targetEl;
        }
      }
    }
    drag.dropOk = nestEl !== null;
    drag.dropFolderId = nestEl ? nestFolderId : null;
    drag.dropTargetEl = nestEl;
    if (drag.lastDropKey !== nestKey) {
      drag.lastDropKey = nestKey;
      setDropTarget(nestKey);
    }

    // 2. Otherwise, a reorder insertion among the same-kind siblings.
    const nextIndex = !nestEl && drag.baseSiblings ? insertionIndex(drag.baseSiblings, x, y) : null;
    drag.reorderIndex = nextIndex;
    const nextReorder = nextIndex === null ? null : { group: drag.item.type, index: nextIndex };
    if (drag.lastReorder?.index !== nextReorder?.index) {
      drag.lastReorder = nextReorder;
      setReorder(nextReorder);
    }
  }, []);

  const beginDrag = useCallback(
    (drag: Drag) => {
      const rect = drag.sourceEl.getBoundingClientRect();
      // Snapshot the same-kind siblings' start positions for reorder hit-testing
      // (frozen, so the make-room shift can't feed back). Taken before the source
      // is hidden below, while the grid is still in its resting layout.
      if (optsRef.current.canReorder(drag.item)) {
        const tiles = document.querySelectorAll<HTMLElement>(
          `[data-reorder-group="${drag.item.type}"]`,
        );
        drag.baseSiblings = Array.from(tiles)
          .filter((el) => el.dataset.reorderId !== drag.item.id)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          });
      }
      drag.wrapper = makeGhost(drag.sourceEl, rect);
      drag.halfW = rect.width / 2;
      drag.halfH = rect.height / 2;
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      drag.cur = { x: center.x, y: center.y, rot: 0 };
      drag.vel = { x: 0, y: 0, rot: 0 };
      // Lock the grab point so the spot the user grabbed stays under the cursor.
      drag.grab = { x: drag.startX - center.x, y: drag.startY - center.y };
      drag.emph = 1;
      drag.lift = 0;
      drag.opacity = 1;
      drag.started = true;
      drag.lastFrame = performance.now();
      if (!drag.reduced) {
        drag.juice = startJuice(PICKUP_JUICE.amount, PICKUP_JUICE.rotation, performance.now() / 1000);
      }
      suppressNextClick();
      document.body.style.cursor = "grabbing";
      document.body.classList.add("decks-dragging");
      setDragItem(drag.item);
      drag.raf = requestAnimationFrame(tick);
    },
    [suppressNextClick, tick],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.started) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= DRAG_THRESHOLD_PX) {
          return;
        }
        beginDrag(drag);
      }
      event.preventDefault();
      drag.pointer = { x: event.clientX, y: event.clientY };
      updateTarget(event.clientX, event.clientY);
    },
    [beginDrag, updateTarget],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (!drag.started) {
        // Never crossed the threshold — a plain click; let it through.
        dragRef.current = null;
        return;
      }
      // A pointercancel (OS/scroll/palm-rejection takeover) is an interrupted
      // gesture, not a completed drop — never commit on cancel; fly the ghost
      // back to the source instead. Otherwise the outcome is a nest (a live
      // folder target), else a reorder (an insertion index among siblings), else
      // a plain return-home.
      const cancelled = event.type === "pointercancel";
      const nesting = !cancelled && drag.dropOk && !!drag.dropTargetEl;
      const reordering = !cancelled && !nesting && drag.reorderIndex !== null;
      drag.accepted = nesting;
      drag.pendingFolderId = nesting ? drag.dropFolderId : null;
      drag.reorderCommitIndex = reordering ? drag.reorderIndex : null;
      drag.releasing = true;
      drag.releaseStart = performance.now();
      // Nest: shrink into the folder. Reorder / return-home: spring to the source
      // tile, which the live preview has already parked at the insertion slot.
      drag.releaseCenter = centerOf(nesting ? (drag.dropTargetEl as HTMLElement) : drag.sourceEl);
      if (!drag.reduced) {
        // A settle pop on a landing (nest or reorder); a sideways wobble on a
        // return-home so it reads as "bounced back".
        const landing = nesting || reordering;
        const pop = landing ? LAND_JUICE : REJECT_JUICE;
        const sign = drag.startX % 2 < 1 ? 1 : -1;
        drag.juice = startJuice(pop.amount, pop.rotation * (landing ? 1 : sign), performance.now() / 1000);
      }
      // The release fly-out + commit normally finishes inside the rAF tick. rAF
      // is paused while the tab is hidden, so back the commit with a timer too:
      // whichever fires first wins (finalize is idempotent), and the move never
      // hangs if the user tabs away mid-drag. The identity guard stops a stale
      // timer from finalizing a later drag.
      const releasing = drag;
      window.setTimeout(
        () => {
          if (dragRef.current === releasing) finalize();
        },
        (drag.reduced ? 0 : RELEASE_MS) + 80,
      );
    },
    [finalize, onPointerMove],
  );

  const startDrag = useCallback(
    (item: DragItem, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || dragRef.current) return;
      // Don't start a drag from the rename/delete actions or an inline editor.
      if ((event.target as HTMLElement).closest("[data-card-actions], input")) return;
      const sourceEl = event.currentTarget;
      dragRef.current = {
        item,
        sourceEl,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
        pointer: { x: event.clientX, y: event.clientY },
        grab: { x: 0, y: 0 },
        cur: { x: 0, y: 0, rot: 0 },
        vel: { x: 0, y: 0, rot: 0 },
        emph: 1,
        lift: 0,
        opacity: 1,
        juice: null,
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        halfW: 0,
        halfH: 0,
        wrapper: null,
        raf: null,
        lastFrame: 0,
        dropFolderId: null,
        dropTargetEl: null,
        dropOk: false,
        lastDropKey: null,
        baseSiblings: null,
        reorderIndex: null,
        lastReorder: null,
        releasing: false,
        releaseStart: 0,
        releaseCenter: { x: 0, y: 0 },
        accepted: false,
        pendingFolderId: null,
        reorderCommitIndex: null,
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  // Tear down a drag still in flight if the component unmounts mid-gesture.
  useEffect(() => {
    return () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.raf !== null) cancelAnimationFrame(drag.raf);
      drag.wrapper?.remove();
      document.body.style.cursor = "";
      document.body.classList.remove("decks-dragging");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      dragRef.current = null;
    };
  }, [onPointerMove, onPointerUp]);

  return { dragItem, dropTarget, reorder, startDrag };
}
