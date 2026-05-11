// Hand row: an overlap-margin row of cards anchored to the bottom of the
// playmat. Each card uses bendCenterBoost={0} (so the perspective bend tracks
// the cursor without an extra center-of-screen pull).

import { Fragment } from "react";
import { useDroppable } from "@dnd-kit/core";
import type {
  DragRect,
  DropTarget,
  DropTargetData,
  PlayerId,
  PokeState,
  ReleaseRectsRef,
  RowDropPreview,
} from "../types";
import { cardRowKey, clampInsertIndex, dropTargetId } from "../state/board";
import { hiddenDraggedCardStyle } from "../physics/dragGeometry";
import { useBalatroRowAnimation } from "../physics/rowAnimation";
import { DraggableCard } from "./Card";

const HAND_RESHUFFLE_STAGGER_MS = 30;
const HAND_RESHUFFLE_MAX_STAGGER_MS = 210;

export function Hand({
  cards,
  owner,
  draggingCardId,
  draggingRect,
  dropPreview,
  releaseRectsRef,
}: {
  cards: PokeState[];
  owner: PlayerId;
  draggingCardId?: string;
  draggingRect?: DragRect;
  dropPreview?: RowDropPreview | null;
  releaseRectsRef?: ReleaseRectsRef;
}) {
  const target: DropTarget = { kind: "hand", owner };
  const { setNodeRef } = useDroppable({
    id: dropTargetId(target),
    data: { target } satisfies DropTargetData,
  });
  const visibleCards = cards.filter((card) => card.id !== draggingCardId);
  const previewIndex = draggingCardId && dropPreview?.kind === "hand" && dropPreview.owner === owner
    ? clampInsertIndex(dropPreview.index, visibleCards.length)
    : null;
  const rowRef = useBalatroRowAnimation(
    `hand-${owner}:${visibleCards.map((card) => card.id).join("|")}:gap-${previewIndex ?? "none"}`,
    releaseRectsRef,
    {
      layoutStaggerMs: HAND_RESHUFFLE_STAGGER_MS,
      layoutStaggerMaxMs: HAND_RESHUFFLE_MAX_STAGGER_MS,
      layoutStaggerOriginIndex: previewIndex,
    },
  );
  const draggedCard = cards.find((card) => card.id === draggingCardId);

  return (
    <div
      ref={setNodeRef}
      data-drop-target="hand"
      data-drop-owner={owner}
      className="flex justify-center items-end px-6 relative z-10"
      style={{ height: "var(--hand-h)", paddingBottom: 8 }}
    >
      <div
        ref={rowRef}
        data-card-row={cardRowKey("hand", owner)}
        className="relative flex h-full items-end justify-center"
      >
        {visibleCards.map((card, visibleIndex) => {
          const gapBefore = previewIndex === visibleIndex;
          const visualIndex = visibleIndex + (previewIndex !== null && visibleIndex >= previewIndex ? 1 : 0);

          return (
            <Fragment key={`hand-entry-${card.id}`}>
              {gapBefore ? (
                <div
                  key={`hand-gap-${owner}-${visibleIndex}`}
                  aria-hidden="true"
                  style={{
                    flex: "0 0 var(--card-w)",
                    height: "var(--card-h)",
                    marginLeft: visibleIndex === 0 ? 0 : "calc(var(--card-w) * -0.2)",
                    width: "var(--card-w)",
                  }}
                />
              ) : null}
              <div
                key={card.id}
                data-layout-card={card.id}
                style={{
                  marginLeft: visualIndex === 0 ? 0 : "calc(var(--card-w) * -0.2)",
                  width: "var(--card-w)",
                  zIndex: visibleCards.length - visibleIndex,
                }}
              >
                <div className="balatro-row-card-face" data-balatro-release-target>
                  <DraggableCard
                    card={card}
                    location={{ kind: "hand", owner, index: cards.findIndex((candidate) => candidate.id === card.id) }}
                    priority
                    bendCenterBoost={0}
                  />
                </div>
              </div>
            </Fragment>
          );
        })}
        {previewIndex === visibleCards.length ? (
          <div
            aria-hidden="true"
            style={{
              flex: "0 0 var(--card-w)",
              height: "var(--card-h)",
              marginLeft: visibleCards.length === 0 ? 0 : "calc(var(--card-w) * -0.2)",
              width: "var(--card-w)",
            }}
          />
        ) : null}
        {draggedCard ? (
          <div style={hiddenDraggedCardStyle(draggingRect)}>
            <DraggableCard
              card={draggedCard}
              location={{ kind: "hand", owner, index: cards.findIndex((card) => card.id === draggedCard.id) }}
              priority
              bendCenterBoost={0}
              sourceClone
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
