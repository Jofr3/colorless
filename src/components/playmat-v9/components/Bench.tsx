// Bench row: a horizontal slot with up to BENCH_LIMIT cards. Wraps the
// cards in a useBalatroRowAnimation row so add/remove/reorder transitions
// (including the drop-preview gap) spring with Balatro Moveable-style motion.

import { Fragment } from "react";
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
import { useBalatroRowAnimation } from "../physics/rowAnimation";
import {
  cardAttachmentExtraWidthFactor,
  cardAttachmentFootprintWidth,
  cardAttachmentLeftOffset,
  DraggableCard,
  PokemonCardDropTarget,
} from "./Card";

export function Bench({
  cards,
  owner,
  disabled = false,
  attachmentDisabled = false,
  draggingCardId,
  draggingCard,
  draggingRect,
  dropPreview,
  releaseRectsRef,
}: {
  cards: PokeState[];
  owner: PlayerId;
  disabled?: boolean;
  attachmentDisabled?: boolean;
  draggingCardId?: string;
  draggingCard?: PokeState | null;
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
  const attachmentLayoutKey = visibleCards
    .map(
      (card) =>
        `${card.id}:${card.attachedTool?.id ?? "none"}:${card.attachedEnergy?.map((energy) => energy.id).join(",") ?? "none"}`,
    )
    .join("|");
  const rowRef = useBalatroRowAnimation(
    `bench-${owner}:${attachmentLayoutKey}:gap-${previewIndex ?? "none"}`,
    releaseRectsRef,
  );
  const draggedCard = cards.find((card) => card.id === draggingCardId);
  const previewGapWidth = cardAttachmentFootprintWidth(draggingCard);
  const benchExtraWidth =
    visibleCards.reduce((extraWidth, card) => extraWidth + cardAttachmentExtraWidthFactor(card), 0) +
    (previewIndex !== null ? cardAttachmentExtraWidthFactor(draggingCard) : 0);

  return (
    <div
      ref={setNodeRef}
      data-slot
      data-drop-target="bench"
      data-drop-owner={owner}
      data-drop-disabled={disabled || undefined}
      className={`${SLOT_BASE} transition-all ${isOver ? "ring-2 ring-emerald-300/90 shadow-[0_0_0_1px_rgba(110,231,183,0.55),0_0_34px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]" : ""}`}
      style={{
        width: `calc(var(--card-w) * ${BENCH_LIMIT + benchExtraWidth} + var(--slot-gap) * ${BENCH_LIMIT - 1} + 12px)`,
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
          const cardIndex = cards.findIndex((candidate) => candidate.id === card.id);
          const footprintWidth = cardAttachmentFootprintWidth(card);

          return (
            <Fragment key={`bench-entry-${card.id}`}>
              {previewIndex === visibleIndex ? (
                <div
                  key={`bench-gap-${owner}-${visibleIndex}`}
                  aria-hidden="true"
                  style={{ flex: `0 0 ${previewGapWidth}`, width: previewGapWidth, height: "var(--card-h)" }}
                />
              ) : null}
              <div
                key={card.id}
                data-layout-card={card.id}
                style={{ width: footprintWidth, zIndex: visibleCards.length - visibleIndex }}
              >
                <div
                  className="balatro-row-card-face"
                  data-balatro-release-target
                  style={{ marginLeft: cardAttachmentLeftOffset(card), width: "var(--card-w)" }}
                >
                  <PokemonCardDropTarget
                    target={{ kind: "pokemon", owner, slot: "bench", index: cardIndex }}
                    pokemon={card}
                    draggingCard={draggingCard}
                    disabled={attachmentDisabled}
                  >
                    <DraggableCard
                      card={card}
                      location={{ kind: "bench", owner, index: cardIndex }}
                      disabled={disabled}
                    />
                  </PokemonCardDropTarget>
                </div>
              </div>
            </Fragment>
          );
        })}
        {previewIndex === visibleCards.length ? (
          <div
            aria-hidden="true"
            style={{ flex: `0 0 ${previewGapWidth}`, width: previewGapWidth, height: "var(--card-h)" }}
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
