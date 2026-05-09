// Geometry + motion-sampling helpers shared between the orchestrator and
// the row/release physics. Lives in physics/ because it carries the
// velocity-smoothing constants that the release tween consumes.

import type { CSSProperties } from "react";
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import {
  CARD_DRAG_HOVER_SUPPRESSION_MS,
  CARD_DRAG_INTERACTION_EVENT,
  CARD_W,
  type DragMotionSample,
  type DragRect,
  type DropTarget,
  type ReleaseMotion,
} from "../types";
import { cardRowKey } from "../state/board";

const DRAG_MOTION_VELOCITY_SMOOTHING = 0.65;
const DRAG_MOTION_STALE_MS = 120;

export function setCardDragInteractionLock(active: boolean) {
  if (typeof document === "undefined") return;

  if (active) {
    delete document.body.dataset.cardHoverSuppressedUntil;
    document.body.dataset.cardDragging = "true";
    document.dispatchEvent(new CustomEvent(CARD_DRAG_INTERACTION_EVENT));
  } else {
    delete document.body.dataset.cardDragging;
    document.body.dataset.cardHoverSuppressedUntil = String(
      performance.now() + CARD_DRAG_HOVER_SUPPRESSION_MS,
    );
  }
}

function getDragCenterX(event: DragMoveEvent | DragEndEvent) {
  const rect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  return rect ? rect.left + rect.width / 2 : null;
}

function getInsertIndexFromRow(row: HTMLElement, centerX: number | null) {
  const cards = Array.from(row.querySelectorAll<HTMLElement>("[data-layout-card]"));
  if (centerX === null) return cards.length;

  const rowRect = row.getBoundingClientRect();
  const index = cards.findIndex((element) => {
    // Use layout centers rather than getBoundingClientRect() on each card.
    // The row animator applies spring transforms while the empty drag slot
    // moves; transformed visual rects make the insert threshold chase the
    // animation and can cause a small retarget/twitch under the held card.
    // offsetLeft/offsetWidth stay pinned to the target flex layout, matching
    // Balatro's sort against card.T.x instead of the in-flight VT.x.
    const layoutCenterX = rowRect.left + element.offsetLeft + element.offsetWidth / 2;
    return centerX < layoutCenterX;
  });

  return index === -1 ? cards.length : index;
}

export function resolveDropTargetIndex(target: DropTarget, event: DragMoveEvent | DragEndEvent): DropTarget {
  if (target.kind !== "hand" && target.kind !== "bench") return target;
  if (typeof document === "undefined") return target;

  const row = document.querySelector<HTMLElement>(`[data-card-row="${cardRowKey(target.kind, target.owner)}"]`);
  if (!row) return target;

  return {
    ...target,
    index: getInsertIndexFromRow(row, getDragCenterX(event)),
  };
}

function toDragRect(rect: { left: number; top: number; width: number; height: number }): DragRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function fallbackDragRect() {
  return { left: 0, top: 0, width: CARD_W, height: CARD_W * 1.4 };
}

export function dragRectFromEvent(event: DragStartEvent): DragRect {
  const rect = event.active.rect.current.initial;
  if (rect) return toDragRect(rect);

  // Both the visible source and the hidden in-place clone (used by Hand/Bench
  // to keep dnd-kit's measurement node in the layout while it animates the
  // dragged card via DragOverlay) carry data-draggable-card-id. The hidden
  // clone is marked with data-drag-source-clone="true" — exclude it so we
  // never measure a visibility:hidden, position:absolute, zero-laid-out node.
  const element = document.querySelector<HTMLElement>(
    `[data-draggable-card-id="${event.active.id}"]:not([data-drag-source-clone="true"])`,
  );
  const elementRect = element?.getBoundingClientRect();
  return elementRect ? toDragRect(elementRect) : fallbackDragRect();
}

export function dragRectAtRelease(event: DragMoveEvent | DragEndEvent, fallback?: DragRect): DragRect {
  const translatedRect = event.active.rect.current.translated;
  if (translatedRect) return toDragRect(translatedRect);

  const initialRect = event.active.rect.current.initial;
  if (initialRect) {
    return {
      left: initialRect.left + event.delta.x,
      top: initialRect.top + event.delta.y,
      width: initialRect.width,
      height: initialRect.height,
    };
  }

  return fallback ?? fallbackDragRect();
}

export function sampleDragMotion(samples: Map<string, DragMotionSample>, cardId: string, rect: DragRect) {
  const now = performance.now();
  const previous = samples.get(cardId);
  if (!previous) {
    samples.set(cardId, { rect, time: now, velocityX: 0, velocityY: 0 });
    return;
  }

  const dt = Math.max((now - previous.time) / 1000, 1 / 1000);
  const instantVelocityX = (rect.left - previous.rect.left) / dt;
  const instantVelocityY = (rect.top - previous.rect.top) / dt;

  samples.set(cardId, {
    rect,
    time: now,
    velocityX:
      previous.velocityX * DRAG_MOTION_VELOCITY_SMOOTHING +
      instantVelocityX * (1 - DRAG_MOTION_VELOCITY_SMOOTHING),
    velocityY:
      previous.velocityY * DRAG_MOTION_VELOCITY_SMOOTHING +
      instantVelocityY * (1 - DRAG_MOTION_VELOCITY_SMOOTHING),
  });
}

export function releaseMotionFromDragSample(
  samples: Map<string, DragMotionSample>,
  cardId: string,
  rect: DragRect,
): ReleaseMotion {
  const sample = samples.get(cardId);
  if (!sample) return { rect, velocityX: 0, velocityY: 0 };

  const ageMs = performance.now() - sample.time;
  let velocityX = sample.velocityX;
  let velocityY = sample.velocityY;

  if (ageMs > 8 && ageMs <= DRAG_MOTION_STALE_MS) {
    const dt = Math.max(ageMs / 1000, 1 / 1000);
    velocityX = 0.5 * velocityX + 0.5 * ((rect.left - sample.rect.left) / dt);
    velocityY = 0.5 * velocityY + 0.5 * ((rect.top - sample.rect.top) / dt);
  } else if (ageMs > DRAG_MOTION_STALE_MS) {
    const fade = Math.max(0, 1 - (ageMs - DRAG_MOTION_STALE_MS) / DRAG_MOTION_STALE_MS);
    velocityX *= fade;
    velocityY *= fade;
  }

  return { rect, velocityX, velocityY };
}

export function overlayCardStyle(rect: DragRect | undefined): CSSProperties | undefined {
  if (!rect) return undefined;

  return {
    "--card-w": `${rect.width}px`,
    "--card-h": `${rect.height}px`,
  } as CSSProperties;
}

export function hiddenDraggedCardStyle(rect: DragRect | undefined): CSSProperties {
  if (!rect) {
    return {
      position: "absolute",
      width: "var(--card-w)",
      visibility: "hidden",
      pointerEvents: "none",
    };
  }

  return {
    // Avoid position: fixed here. Slot frames use backdrop-filter, which creates
    // a containing block for fixed descendants and can double-offset the hidden
    // source node. Keep the node mounted/in-place for dnd-kit measurement, but
    // remove it from layout and visibility.
    position: "absolute",
    width: rect.width,
    height: rect.height,
    visibility: "hidden",
    pointerEvents: "none",
    zIndex: -1,
  };
}
