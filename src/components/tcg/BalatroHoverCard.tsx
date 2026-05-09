import { useLayoutEffect, useRef, type ReactNode } from "react";
import CardImage from "./CardImage";
import {
  CARD_DRAG_INTERACTION_EVENT,
  getBalatroDomCardAnimator,
  isCardHoverSuppressed,
} from "./balatroAnimator";

type CardBackTone = "blue" | "red";

interface BalatroHoverCardProps {
  cardId?: string;
  back?: CardBackTone;
  instanceId?: string;
  renderedWidth?: number;
  alt?: string;
  priority?: boolean;
  className?: string;
  bendCenterBoost?: number;
  pressed?: boolean;
  dragging?: boolean;
  children?: ReactNode;
}

export default function BalatroHoverCard({
  cardId,
  instanceId,
  renderedWidth,
  alt,
  priority = false,
  className,
  bendCenterBoost,
  pressed = false,
  dragging = false,
  children,
}: BalatroHoverCardProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(dragging);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!host || !surface) return;

    const animator = getBalatroDomCardAnimator();
    animator.register(host, surface, bendCenterBoost, instanceId);
    animator.setPressed(host, pressed);
    animator.setDragging(host, dragging);

    const handlePointerEnter = (event: PointerEvent) => {
      if (isCardHoverSuppressed(event)) {
        animator.unhover(host);
        return;
      }

      animator.hover(host, event);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (isCardHoverSuppressed(event)) {
        animator.unhover(host);
        return;
      }

      animator.move(host, event);
    };
    const handlePointerLeave = () => {
      animator.unhover(host);
    };
    const handleCardDragStart = () => {
      animator.unhover(host);
    };

    host.addEventListener("pointerenter", handlePointerEnter);
    host.addEventListener("pointermove", handlePointerMove);
    host.addEventListener("pointerleave", handlePointerLeave);
    document.addEventListener(CARD_DRAG_INTERACTION_EVENT, handleCardDragStart);

    return () => {
      host.removeEventListener("pointerenter", handlePointerEnter);
      host.removeEventListener("pointermove", handlePointerMove);
      host.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener(CARD_DRAG_INTERACTION_EVENT, handleCardDragStart);
      animator.unregister(host);
    };
  }, [bendCenterBoost, instanceId]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    getBalatroDomCardAnimator().setPressed(host, pressed);
  }, [pressed]);

  useLayoutEffect(() => {
    draggingRef.current = dragging;
    const host = hostRef.current;
    if (!host) return;

    getBalatroDomCardAnimator().setDragging(host, dragging);
  }, [dragging]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const animator = getBalatroDomCardAnimator();

    // Register once at mount and gate behavior on draggingRef inside the
    // handler. Re-binding the listener on every dragging re-render dropped
    // the first delta after each re-render (lastClientX reset to null),
    // producing a one-frame velocity gap that showed up as a sway hitch.
    //
    // Scope pointer tracking per-pointerId so a second touch on the screen
    // (e.g. a second card being dragged or any unrelated touch) cannot
    // corrupt this card's drag delta. We lock onto the first pointer that
    // emits a move while this card is dragging and ignore moves from any
    // other pointerId until the drag ends.
    let trackedPointerId: number | null = null;
    let lastClientX: number | null = null;
    let wasDragging = false;

    const handleDragPointerMove = (event: PointerEvent) => {
      const isDragging = draggingRef.current;
      if (!isDragging) {
        if (wasDragging) {
          trackedPointerId = null;
          lastClientX = null;
          wasDragging = false;
        }
        return;
      }

      wasDragging = true;
      if (trackedPointerId === null) {
        trackedPointerId = event.pointerId;
        lastClientX = event.clientX;
        return;
      }

      if (event.pointerId !== trackedPointerId) return;
      if (lastClientX === null) {
        lastClientX = event.clientX;
        return;
      }

      const deltaX = event.clientX - lastClientX;
      lastClientX = event.clientX;
      animator.dragMove(host, deltaX);
    };

    // dragTargetOffsetPx is accumulated in client pixels and divided by
    // screenScale (which depends on the current layout) at frame time. If
    // the window resizes, the virtual keyboard opens, or the layout
    // otherwise shifts mid-drag, that ratio becomes stale and the sway
    // snaps. Recompute by resetting the accumulator and forcing the
    // pointer tracker to re-seed from the next move.
    const handleResize = () => {
      if (!draggingRef.current) return;
      animator.resetDragOffset(host);
      lastClientX = null;
    };

    window.addEventListener("pointermove", handleDragPointerMove, { passive: true });
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("pointermove", handleDragPointerMove);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const placeholder =
    children ??
    (cardId && renderedWidth && alt ? (
      <CardImage
        cardId={cardId}
        renderedWidth={renderedWidth}
        alt={alt}
        priority={priority}
        className="balatro-hover-card__image"
      />
    ) : null);

  return (
    <div ref={hostRef} className={`balatro-hover-card ${className ?? ""}`.trim()}>
      <div ref={surfaceRef} className="balatro-hover-card__surface">
        {placeholder}
      </div>
    </div>
  );
}
