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
  type CardKind,
  type CardLocation,
  type DragCardData,
  type DropTarget,
  type DropTargetData,
  type PokeState,
  type ReleaseRectsRef,
} from "../types";
import { canAttachCardToPokemon, dropTargetId } from "../state/board";
import { useBalatroReleaseAnimation } from "../physics/releaseAnimation";

type HoverPoint = { clientX: number; clientY: number };

export function CardBox({
  cardId,
  cardType,
  imageUrl,
  instanceId,
  alt,
  priority,
  bendCenterBoost,
  pressed = false,
  dragging = false,
  interactive = true,
  hoverPoint = null,
  disableTilt = false,
}: {
  cardId: string;
  cardType?: CardKind;
  imageUrl?: string;
  instanceId?: string;
  alt: string;
  priority?: boolean;
  bendCenterBoost?: number;
  pressed?: boolean;
  dragging?: boolean;
  interactive?: boolean;
  hoverPoint?: HoverPoint | null;
  disableTilt?: boolean;
}) {
  return (
    <div data-card-type={cardType} style={{ width: "var(--card-w)" }}>
      <BalatroHoverCard
        cardId={cardId}
        imageUrl={imageUrl}
        instanceId={instanceId}
        renderedWidth={CARD_W}
        alt={alt}
        priority={priority}
        bendCenterBoost={bendCenterBoost}
        pressed={pressed}
        dragging={dragging}
        interactive={interactive}
        hoverPoint={hoverPoint}
        disableTilt={disableTilt}
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
  width,
}: {
  target: DropTarget;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  width?: string;
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
        width: width ?? "calc(var(--card-w) + 12px)",
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      {children}
    </div>
  );
}

export function PokemonCardDropTarget({
  target,
  pokemon,
  draggingCard,
  disabled: forceDisabled = false,
  children,
}: {
  target: Extract<DropTarget, { kind: "pokemon" }>;
  pokemon: PokeState;
  draggingCard?: PokeState | null;
  disabled?: boolean;
  children: ReactNode;
}) {
  const disabled = forceDisabled || !canAttachCardToPokemon(draggingCard, pokemon);
  const { setNodeRef } = useDroppable({
    id: dropTargetId(target),
    data: { target } satisfies DropTargetData,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      data-drop-target="pokemon"
      data-drop-owner={target.owner}
      data-drop-slot={target.slot}
      data-drop-index={target.slot === "bench" ? target.index : undefined}
      data-drop-disabled={disabled || undefined}
      className="relative rounded-[max(3px,calc(var(--card-w)*0.06))]"
    >
      {children}
    </div>
  );
}

const ATTACHED_CARD_SCALE = 0.90;
const ROTATED_ATTACHED_CARD_WIDTH_FACTOR = 1.4 * ATTACHED_CARD_SCALE;
const ATTACHED_TOOL_PEEK = 0.30;
const ATTACHED_ENERGY_PEEK = 0.30;
const ATTACHED_ENERGY_VERTICAL_STEP = 0.15;

function attachmentMetrics(card?: PokeState | null) {
  if (!card || card.cardType !== "pokemon") return { left: 0, right: 0 };

  const energyCount = card.attachedEnergy?.length ?? 0;
  return {
    left: card.attachedTool ? ATTACHED_TOOL_PEEK : 0,
    right: energyCount > 0 ? ATTACHED_ENERGY_PEEK : 0,
  };
}

function factorToCardWidth(factor: number) {
  return factor === 0 ? "0px" : `calc(var(--card-w) * ${factor.toFixed(2)})`;
}

function scaledAttachedCardWidth() {
  return `calc(var(--card-h) * ${ATTACHED_CARD_SCALE.toFixed(2)})`;
}

function scaledAttachedCardHeight() {
  return `calc(var(--card-w) * ${ATTACHED_CARD_SCALE.toFixed(2)})`;
}

function energyAttachmentTop(index: number) {
  return `calc(var(--card-h) - var(--card-w) * ${ATTACHED_CARD_SCALE.toFixed(2)} - var(--card-w) * ${(index * ATTACHED_ENERGY_VERTICAL_STEP).toFixed(2)})`;
}

export function cardAttachmentLeftOffset(card?: PokeState | null) {
  return factorToCardWidth(attachmentMetrics(card).left);
}

export function cardAttachmentFootprintWidth(card?: PokeState | null) {
  const { left, right } = attachmentMetrics(card);
  return `calc(var(--card-w) * ${(1 + left + right).toFixed(2)})`;
}

export function cardAttachmentExtraWidthFactor(card?: PokeState | null) {
  const { left, right } = attachmentMetrics(card);
  return left + right;
}

function AttachedCardLayer({
  card,
  instanceId,
  hoverPoint,
}: {
  card: PokeState;
  instanceId?: string;
  hoverPoint?: HoverPoint | null;
}) {
  if (card.cardType !== "pokemon") return null;

  const energyCards = card.attachedEnergy ?? [];
  const toolCard = card.attachedTool;
  if (!toolCard && energyCards.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-visible" aria-hidden="true">
      {toolCard ? (
        <div
          className="attached-card attached-card--tool absolute opacity-95 drop-shadow-[0_5px_10px_rgba(0,0,0,0.45)]"
          style={{
            left: factorToCardWidth(-ATTACHED_TOOL_PEEK),
            top: 0,
            width: scaledAttachedCardWidth(),
            height: scaledAttachedCardHeight(),
          }}
        >
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width: "var(--card-w)",
              transform: `translate(-50%, -50%) rotate(-90deg) scale(${ATTACHED_CARD_SCALE})`,
              transformOrigin: "center center",
            }}
          >
            <CardBox
              cardId={toolCard.cardId}
              cardType={toolCard.cardType}
              imageUrl={toolCard.imageUrl}
              instanceId={`${instanceId ?? card.id}-attached-tool-${toolCard.id}`}
              alt={toolCard.name}
              interactive={false}
              hoverPoint={hoverPoint}
              disableTilt
            />
          </div>
        </div>
      ) : null}
      {energyCards.map((energyCard, index) => {
        const left = 1 + ATTACHED_ENERGY_PEEK - ROTATED_ATTACHED_CARD_WIDTH_FACTOR;

        return (
          <div
            key={energyCard.id}
            className="attached-card attached-card--energy absolute opacity-95 drop-shadow-[0_5px_10px_rgba(0,0,0,0.45)]"
            style={{
              left: factorToCardWidth(left),
              top: energyAttachmentTop(index),
              width: scaledAttachedCardWidth(),
              height: scaledAttachedCardHeight(),
              zIndex: index,
            }}
          >
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                width: "var(--card-w)",
                transform: `translate(-50%, -50%) rotate(90deg) scale(${ATTACHED_CARD_SCALE})`,
                transformOrigin: "center center",
              }}
            >
              <CardBox
                cardId={energyCard.cardId}
                cardType={energyCard.cardType}
                imageUrl={energyCard.imageUrl}
                instanceId={`${instanceId ?? card.id}-attached-energy-${energyCard.id}`}
                alt={energyCard.name}
                interactive={false}
                hoverPoint={hoverPoint}
                disableTilt
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CardWithAttachments({
  card,
  instanceId,
  priority,
  bendCenterBoost,
  pressed = false,
  dragging = false,
}: {
  card: PokeState;
  instanceId?: string;
  priority?: boolean;
  bendCenterBoost?: number;
  pressed?: boolean;
  dragging?: boolean;
}) {
  const hasAttachments = card.cardType === "pokemon" && Boolean(card.attachedTool || card.attachedEnergy?.length);
  const [attachmentHoverPoint, setAttachmentHoverPoint] = useState<HoverPoint | null>(null);

  function updateAttachmentHoverPoint(event: ReactPointerEvent<HTMLDivElement>) {
    if (!hasAttachments) return;
    setAttachmentHoverPoint({ clientX: event.clientX, clientY: event.clientY });
  }

  return (
    <div
      className="pokemon-card-with-attachments relative overflow-visible"
      data-has-attachments={hasAttachments || undefined}
      style={{ width: "var(--card-w)" }}
      onPointerEnter={updateAttachmentHoverPoint}
      onPointerMove={updateAttachmentHoverPoint}
      onPointerLeave={() => setAttachmentHoverPoint(null)}
    >
      <AttachedCardLayer card={card} instanceId={instanceId} hoverPoint={attachmentHoverPoint} />
      <div className="relative z-10">
        <CardBox
          cardId={card.cardId}
          cardType={card.cardType}
          imageUrl={card.imageUrl}
          instanceId={instanceId}
          alt={card.name}
          priority={priority}
          bendCenterBoost={bendCenterBoost}
          pressed={pressed}
          dragging={dragging}
        />
      </div>
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
      <CardWithAttachments
        card={card}
        instanceId={card.id}
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
