import { useState } from "react";
import { flushSync } from "react-dom";
import type { GhostFeel } from "../../lib/animation/ghostDrag";
import {
  type GhostDrag,
  type ReleaseOutcome,
  useGhostDrag,
} from "../../lib/animation/useGhostDrag";
import { insertionIndex, type ReorderRect } from "./reorder";

// Pointer-driven drag for the decks library, ported from the simulator's card
// drag (features/playmat/pixi/CardView.ts). Native HTML5 drag-and-drop can only
// dim the source and let the browser drag a frozen ghost image; here we lift a
// live clone of the tile into a body-level overlay and run the simulator's exact
// spring + juice on it (via the shared useGhostDrag primitive), so a folder/deck
// "picks up", spring-follows the cursor with a velocity-driven tilt, and pops
// into its target (or wobbles back home).
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
// The spring/juice mechanics live in lib/animation/{ghostDrag,useGhostDrag}; only
// the drop resolution, the ghost element and the feel constants are decks-drag
// specific here.

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

// Emphasis while picked up: +0.10 scale and a small upward lift, matching
// CardView.applyEmphasisTween (drag scale 1.1) + computeDragLiftOffset (14px).
// Land shrink and the pickup/land/reject pops are CardView.startDrag /
// applyReleaseMotion. Constants mirror the simulator so the two drags feel one.
const DECK_FEEL: GhostFeel = {
  pickupScale: 1.1,
  pickupLiftPx: 14,
  acceptedScale: 0.55,
  releaseMs: 300,
  releaseSlackMs: 80,
  pickupJuice: { amount: 0.04, rotation: 0.02 },
  dragThresholdPx: 5,
};
const LAND_JUICE = { amount: 0.07, rotation: 0 };
const REJECT_JUICE = { amount: 0.025, rotation: 0.18 };

// The central fraction of a folder tile that nests rather than reorders, on each
// axis. Outside this box (the tile's border region) a dragged folder reorders
// past it instead — "centre = nest, edges = reorder".
const NEST_BAND = 0.25;

/** Per-drag scratch: the live nest target + the frozen reorder siblings and the
    insertion index computed against them, plus the pending commit chosen on
    release. */
interface DeckDragData {
  // Live nest target under the cursor (only set when canDrop allows it).
  dropFolderId: string | null;
  dropTargetEl: HTMLElement | null;
  dropOk: boolean;
  lastDropKey: string | null;
  // Reorder: the same-kind siblings' frozen start rects (visible order, minus the
  // dragged tile), snapshotted once at pickup so the make-room shift never feeds
  // back into the index math. Null when this item can't be reordered.
  baseSiblings: ReorderRect[] | null;
  // Top of the group's first row (min sibling top). Reorder is only previewed at
  // or below this — once the pointer rises above the section, reordering is
  // suppressed so the group doesn't reshuffle and snap back.
  baseTop: number;
  reorderIndex: number | null;
  lastReorder: ReorderPreview | null;
  // accepted === a committed nest; a reorder springs back to its slot but commits
  // the new index via reorderCommitIndex.
  pendingFolderId: string | null;
  reorderCommitIndex: number | null;
}

function centerOf(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// Build the floating clone. Tilt/juice CSS vars are stripped so the lifted card
// reads as a clean, upright tile rather than freezing whatever hover lean it had
// at grab time.
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

// A click fires right after a real drag (pointerup → click). Swallow that one
// click so dragging a folder onto a target doesn't also "open" it.
function suppressNextClick() {
  const handler = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    window.removeEventListener("click", handler, true);
  };
  window.addEventListener("click", handler, true);
  window.setTimeout(() => window.removeEventListener("click", handler, true), 350);
}

export function useDeckDrag({ canDrop, onDrop, canReorder, onReorder }: UseDeckDragOptions) {
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [reorder, setReorder] = useState<ReorderPreview | null>(null);

  // Live nest / reorder tracking on every move. Reads the frozen siblings and
  // writes the current target into the drag's scratch, driving the preview state.
  const updateTarget = (x: number, y: number, drag: GhostDrag<DragItem, DeckDragData>) => {
    const d = drag.data;

    // 1. Nest target under the cursor (folder tile, breadcrumb, root, or up).
    const hit = document.elementFromPoint(x, y);
    const targetEl = hit?.closest<HTMLElement>("[data-drop-key]") ?? null;
    let nestKey: string | null = null;
    let nestFolderId: string | null = null;
    let nestEl: HTMLElement | null = null;
    if (targetEl) {
      const raw = targetEl.dataset.dropFolder ?? "";
      const folderId = raw === "" ? null : raw;
      if (canDrop(drag.item, folderId)) {
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
    d.dropOk = nestEl !== null;
    d.dropFolderId = nestEl ? nestFolderId : null;
    d.dropTargetEl = nestEl;
    if (d.lastDropKey !== nestKey) {
      d.lastDropKey = nestKey;
      setDropTarget(nestKey);
    }

    // 2. Otherwise, a reorder insertion among the same-kind siblings — but only
    // while the pointer is within the group's own section. Above its first row
    // (y < baseTop) the dragged tile is leaving for the other section (e.g. a
    // deck heading up to a folder), so reordering is suppressed: otherwise it
    // would reshuffle to the front and then snap back once a folder is hovered.
    const nextIndex =
      !nestEl && d.baseSiblings && y >= d.baseTop ? insertionIndex(d.baseSiblings, x, y) : null;
    d.reorderIndex = nextIndex;
    const nextReorder = nextIndex === null ? null : { group: drag.item.type, index: nextIndex };
    if (d.lastReorder?.index !== nextReorder?.index) {
      d.lastReorder = nextReorder;
      setReorder(nextReorder);
    }
  };

  const { startDrag } = useGhostDrag<DragItem, DeckDragData>({
    feel: DECK_FEEL,
    createData: () => ({
      dropFolderId: null,
      dropTargetEl: null,
      dropOk: false,
      lastDropKey: null,
      baseSiblings: null,
      baseTop: Number.POSITIVE_INFINITY,
      reorderIndex: null,
      lastReorder: null,
      pendingFolderId: null,
      reorderCommitIndex: null,
    }),
    createGhost: makeGhost,
    // Don't start a drag from the rename/delete actions or an inline editor.
    canStart: (event) => !(event.target as HTMLElement).closest("[data-card-actions], input"),
    onBegin: (drag) => {
      // Snapshot the same-kind siblings' start positions for reorder hit-testing
      // (frozen, so the make-room shift can't feed back). Taken before the source
      // is hidden (setDragItem below), while the grid is still at rest.
      if (canReorder(drag.item)) {
        const tiles = document.querySelectorAll<HTMLElement>(
          `[data-reorder-group="${drag.item.type}"]`,
        );
        const siblings = Array.from(tiles)
          .filter((el) => el.dataset.reorderId !== drag.item.id)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          });
        drag.data.baseSiblings = siblings;
        for (const s of siblings) drag.data.baseTop = Math.min(drag.data.baseTop, s.top);
      }
      suppressNextClick();
      document.body.style.cursor = "grabbing";
      document.body.classList.add("decks-dragging");
      setDragItem(drag.item);
    },
    onMove: (x, y, drag) => updateTarget(x, y, drag),
    resolveRelease: (event, drag): ReleaseOutcome => {
      const d = drag.data;
      // A pointercancel (OS/scroll/palm-rejection takeover) is an interrupted
      // gesture, not a completed drop — never commit on cancel; fly the ghost
      // back to the source instead. Otherwise the outcome is a nest (a live
      // folder target), else a reorder (an insertion index among siblings), else
      // a plain return-home.
      const cancelled = event.type === "pointercancel";
      const nesting = !cancelled && d.dropOk && !!d.dropTargetEl;
      const reordering = !cancelled && !nesting && d.reorderIndex !== null;
      d.pendingFolderId = nesting ? d.dropFolderId : null;
      d.reorderCommitIndex = reordering ? d.reorderIndex : null;
      // Nest: shrink into the folder. Reorder / return-home: spring to the source
      // tile, which the live preview has already parked at the insertion slot.
      const releaseCenter = centerOf(nesting ? (d.dropTargetEl as HTMLElement) : drag.sourceEl);
      // A settle pop on a landing (nest or reorder); a sideways wobble on a
      // return-home so it reads as "bounced back".
      const landing = nesting || reordering;
      const sign = drag.startX % 2 < 1 ? 1 : -1;
      const juice = landing
        ? { amount: LAND_JUICE.amount, rotation: LAND_JUICE.rotation }
        : { amount: REJECT_JUICE.amount, rotation: REJECT_JUICE.rotation * sign };
      return { accepted: nesting, releaseCenter, juice };
    },
    finalize: (drag, removeGhost) => {
      document.body.style.cursor = "";
      document.body.classList.remove("decks-dragging");
      const { item, accepted, data } = drag;
      // Un-hide the source (and commit the nest/reorder) *before* removing the
      // ghost. finalize runs from a timer/rAF, where React's concurrent scheduler
      // would defer this state commit — so a plain setDragItem(null) paints the
      // source un-hidden one frame *after* the ghost is gone, leaving a one-frame
      // gap where neither shows: the "flash" on release. flushSync forces the
      // un-hide to land in this same task, so the restored source and the removed
      // ghost paint together. Committing here also re-renders the tile into its
      // new spot in one pass — no flash of the entry back in its old slot.
      flushSync(() => {
        if (accepted) onDrop(item, data.pendingFolderId);
        else if (data.reorderCommitIndex !== null) onReorder(item, data.reorderCommitIndex);
        setDragItem(null);
        setDropTarget(null);
        setReorder(null);
      });
      removeGhost();
    },
    onUnmount: () => {
      document.body.style.cursor = "";
      document.body.classList.remove("decks-dragging");
    },
  });

  return { dragItem, dropTarget, reorder, startDrag };
}
