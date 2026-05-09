// Bench row: a horizontal slot with up to BENCH_LIMIT cards. Wraps the
// cards in a useBalatroRowAnimation row so add/remove/reorder transitions
// (including the drop-preview gap) spring with Balatro Moveable-style motion.

import { Fragment, type CSSProperties } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  BENCH_LIMIT,
  SLOT_BASE,
  type DragRect,
  type DropTarget,
  type DropTargetData,
  type PlayerId,
  type PokeState,
  type ReleaseRectsRef,
  type RowDropPreview,
} from "../types";
import { cardRowKey, clampInsertIndex, dropTargetId } from "../state/board";
import { hiddenDraggedCardStyle } from "../physics/dragGeometry";
import { balatroBenchFan } from "../physics/balatroFan";
import { useBalatroRowAnimation } from "../physics/rowAnimation";
import { DraggableCard } from "./Card";

export function Bench({
  cards,
  owner,
  disabled = false,
  draggingCardId,
  draggingRect,
  dropPreview,
  releaseRectsRef,
}: {
  cards: PokeState[];
  owner: PlayerId;
  disabled?: boolean;
  draggingCardId?: string;
  draggingRect?: DragRect;
  dropPreview?: RowDropPreview | null;
  releaseRectsRef?: ReleaseRectsRef;
}) {
  const target: DropTarget = { kind: "bench", owner };
  const { setNodeRef, isOver } = useDroppable({
    id: dropTargetId(target),
    data: { target } satisfies DropTargetData,
    disabled,
  });
  const visibleCards = cards.filter((card) => card.id !== draggingCardId);
  const previewIndex = draggingCardId && dropPreview?.kind === "bench" && dropPreview.owner === owner
    ? clampInsertIndex(dropPreview.index, visibleCards.length)
    : null;
  const rowRef = useBalatroRowAnimation(
    `bench-${owner}:${visibleCards.map((card) => card.id).join("|")}:gap-${previewIndex ?? "none"}`,
    releaseRectsRef,
  );
  const draggedCard = cards.find((card) => card.id === draggingCardId);
  const totalSlots = visibleCards.length + (previewIndex !== null ? 1 : 0);

  function fanStyle(visualIndex: number): CSSProperties {
    const fan = balatroBenchFan(visualIndex, totalSlots);
    return {
      "--balatro-row-lift": `${fan.liftPx}px`,
      "--balatro-row-rotation": `${fan.rotationDeg}deg`,
    } as CSSProperties;
  }

  return (
    <div
      ref={setNodeRef}
      data-slot
      data-drop-target="bench"
      data-drop-owner={owner}
      data-drop-disabled={disabled || undefined}
      className={`${SLOT_BASE} transition-all ${isOver ? "ring-2 ring-emerald-300/90 shadow-[0_0_0_1px_rgba(110,231,183,0.55),0_0_34px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]" : ""}`}
      style={{
        width: `calc(var(--card-w) * ${BENCH_LIMIT} + var(--slot-gap) * ${BENCH_LIMIT - 1} + 12px)`,
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      <div
        ref={rowRef}
        data-card-row={cardRowKey("bench", owner)}
        className="relative flex h-full w-full items-center justify-center"
        style={{ gap: "var(--slot-gap)" }}
      >
        {visibleCards.map((card, visibleIndex) => {
          const visualIndex = visibleIndex + (previewIndex !== null && visibleIndex >= previewIndex ? 1 : 0);

          return (
            <Fragment key={`bench-entry-${card.id}`}>
              {previewIndex === visibleIndex ? (
                <div
                  key={`bench-gap-${owner}-${visibleIndex}`}
                  aria-hidden="true"
                  style={{ flex: "0 0 var(--card-w)", width: "var(--card-w)", height: "var(--card-h)" }}
                />
              ) : null}
              <div
                key={card.id}
                data-layout-card={card.id}
                style={{ width: "var(--card-w)", zIndex: visibleCards.length - visibleIndex }}
              >
                <div
                  className="balatro-row-card-face"
                  data-balatro-release-target
                  style={fanStyle(visualIndex)}
                >
                  <DraggableCard
                    card={card}
                    location={{ kind: "bench", owner, index: cards.findIndex((candidate) => candidate.id === card.id) }}
                    disabled={disabled}
                  />
                </div>
              </div>
            </Fragment>
          );
        })}
        {previewIndex === visibleCards.length ? (
          <div
            aria-hidden="true"
            style={{ flex: "0 0 var(--card-w)", width: "var(--card-w)", height: "var(--card-h)" }}
          />
        ) : null}
        {draggedCard ? (
          <div style={hiddenDraggedCardStyle(draggingRect)}>
            <DraggableCard
              card={draggedCard}
              location={{ kind: "bench", owner, index: cards.findIndex((card) => card.id === draggedCard.id) }}
              disabled={disabled}
              sourceClone
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
