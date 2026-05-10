// Card-shaped building blocks shared by Hand, Bench, PlayerSide, and the
// Stadium slot:
//   - CardBox: a fixed-width wrapper around BalatroHoverCard.
//   - DropTargetPileFrame: a single-card slot frame registered with
//     dnd-kit as a useDroppable.
//   - DraggableCard: a useDraggable card-host with press-state tracking.
//   - ReleasedCard: a passthrough that wires the release tween via
//     useBalatroReleaseAnimation.

import {
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import BalatroHoverCard from "../../tcg/BalatroHoverCard";
import {
  CARD_W,
  SLOT_BASE,
  type CardLocation,
  type DragCardData,
  type DropTarget,
  type DropTargetData,
  type PokeState,
  type ReleaseRectsRef,
} from "../types";
import { dropTargetId } from "../state/board";
import { useBalatroReleaseAnimation } from "../physics/releaseAnimation";

export function CardBox({
  cardId,
  instanceId,
  alt,
  priority,
  bendCenterBoost,
  pressed = false,
  dragging = false,
}: {
  cardId: string;
  instanceId?: string;
  alt: string;
  priority?: boolean;
  bendCenterBoost?: number;
  pressed?: boolean;
  dragging?: boolean;
}) {
  return (
    <div style={{ width: "var(--card-w)" }}>
      <BalatroHoverCard
        cardId={cardId}
        instanceId={instanceId}
        renderedWidth={CARD_W}
        alt={alt}
        priority={priority}
        bendCenterBoost={bendCenterBoost}
        pressed={pressed}
        dragging={dragging}
        className="w-full"
      />
    </div>
  );
}

export function DropTargetPileFrame({
  target,
  children,
  active = false,
  disabled = false,
}: {
  target: DropTarget;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dropTargetId(target),
    data: { target } satisfies DropTargetData,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      data-slot
      data-drop-target={target.kind}
      data-drop-owner={"owner" in target ? target.owner : undefined}
      data-drop-disabled={disabled || undefined}
      className={`${SLOT_BASE} transition-all ${active ? "ring-amber-300/60 shadow-[0_0_0_1px_rgba(252,211,77,0.45),0_0_28px_rgba(252,211,77,0.30),inset_0_1px_0_rgba(255,255,255,0.15)]" : ""} ${isOver ? "ring-2 ring-emerald-300/90 shadow-[0_0_0_1px_rgba(110,231,183,0.55),0_0_34px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]" : ""}`}
      style={{
        width: "calc(var(--card-w) + 12px)",
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      {children}
    </div>
  );
}

export function DraggableCard({
  card,
  location,
  priority,
  bendCenterBoost,
  disabled = false,
  sourceClone = false,
}: {
  card: PokeState;
  location: CardLocation;
  priority?: boolean;
  bendCenterBoost?: number;
  disabled?: boolean;
  sourceClone?: boolean;
}) {
  const [pressing, setPressing] = useState(false);
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: card.id,
    data: { card, location } satisfies DragCardData,
    disabled,
  });

  useEffect(() => {
    if (!disabled) return;
    setPressing(false);
  }, [disabled]);

  useEffect(() => {
    if (!pressing) return;

    const stopPressing = () => setPressing(false);
    window.addEventListener("pointerup", stopPressing);
    window.addEventListener("pointercancel", stopPressing);
    window.addEventListener("blur", stopPressing);
    return () => {
      window.removeEventListener("pointerup", stopPressing);
      window.removeEventListener("pointercancel", stopPressing);
      window.removeEventListener("blur", stopPressing);
    };
  }, [pressing]);

  const handlePointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    setPressing(true);
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(!disabled ? listeners : {})}
      aria-label={`Drag ${card.name}`}
      aria-disabled={disabled || undefined}
      data-draggable-card-id={card.id}
      // Hidden in-place clone (rendered alongside the visible card while it
      // is in flight via DragOverlay). Marked so dragRectFromEvent's
      // querySelector fallback can exclude it and never measure a
      // visibility:hidden zero-area node.
      data-drag-source-clone={sourceClone || undefined}
      className="relative touch-none select-none"
      style={{ touchAction: "none" }}
      onPointerDownCapture={handlePointerDownCapture}
    >
      <CardBox
        cardId={card.cardId}
        instanceId={card.id}
        alt={card.name}
        priority={priority}
        bendCenterBoost={bendCenterBoost}
        pressed={pressing}
      />
    </div>
  );
}

export function ReleasedCard({
  cardId,
  releaseRectsRef,
  releaseAnimationKey,
  children,
}: {
  cardId?: string;
  releaseRectsRef?: ReleaseRectsRef;
  releaseAnimationKey?: number;
  children: ReactNode;
}) {
  const ref = useBalatroReleaseAnimation(cardId, releaseRectsRef, releaseAnimationKey);

  return (
    <div ref={ref} data-release-card-id={cardId}>
      {children}
    </div>
  );
}
