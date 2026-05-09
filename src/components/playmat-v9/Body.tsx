import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import BalatroHoverCard from "../tcg/BalatroHoverCard";
import {
  BALATRO_HOVER_TUNING_DEFAULTS,
  getBalatroHoverTuning,
  resetBalatroHoverTuning,
  setBalatroHoverTuning,
  subscribeBalatroHoverTuning,
  type BalatroHoverTuning,
} from "../tcg/balatroTuning";
import {
  BENCH_LIMIT,
  CARD_W,
  CENTER_LINE_TOP,
  DRAG_OVERLAY_Z_INDEX,
  SLOT_BASE,
  WRAPPER_CLASSES,
  type BoardState,
  type CardBackSize,
  type CardBackTone,
  type CardLocation,
  type DragCardData,
  type DragMotionSample,
  type DragRect,
  type DragState,
  type DropTarget,
  type DropTargetData,
  type LogEntry,
  type LogSegment,
  type LogSegmentTone,
  type LogSource,
  type PlayerBoardState,
  type PlayerId,
  type PokeState,
  type ReleaseMotion,
  type ReleaseRectsRef,
  type RowDropPreview,
  type SidePosition,
  type TurnInfo,
} from "./types";
import { gameLog, initialBoard, turnInfo } from "./fixtures";
import {
  canActivePlayerMove,
  canPreviewRowDrop,
  cardRowKey,
  clampInsertIndex,
  cloneBoard,
  dropTargetId,
  isDragCardData,
  isDropTargetData,
  moveCard,
  otherPlayer,
  playerBackTone,
  sourceBelongsToPlayer,
} from "./state/board";
import {
  dragRectAtRelease,
  dragRectFromEvent,
  hiddenDraggedCardStyle,
  overlayCardStyle,
  releaseMotionFromDragSample,
  resolveDropTargetIndex,
  sampleDragMotion,
  setCardDragInteractionLock,
} from "./physics/dragGeometry";
import { useBalatroReleaseAnimation } from "./physics/releaseAnimation";
import { useBalatroRowAnimation } from "./physics/rowAnimation";

export { CARD_W, WRAPPER_CLASSES };

function CardBackAtSize({
  tone,
  size = "card",
}: {
  tone: CardBackTone;
  size?: CardBackSize;
}) {
  return (
    <div
      className={`card-back card-back--${size}`}
      data-card-back-tone={tone}
      aria-hidden="true"
      style={{
        width: size === "prize" ? "var(--prize-w)" : "var(--card-w)",
        height: size === "prize" ? "var(--prize-h)" : "var(--card-h)",
      }}
    />
  );
}

function PileFrame({
  children,
  active = false,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <div
      data-slot
      className={`${SLOT_BASE} ${active ? "ring-amber-300/60 shadow-[0_0_0_1px_rgba(252,211,77,0.45),0_0_28px_rgba(252,211,77,0.30),inset_0_1px_0_rgba(255,255,255,0.15)]" : ""}`}
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

function DeckPileSized({ backTone }: { backTone: CardBackTone }) {
  return (
    <div className="relative inline-block">
      <PileFrame>
        <BalatroHoverCard back={backTone}>
          <CardBackAtSize tone={backTone} />
        </BalatroHoverCard>
      </PileFrame>
    </div>
  );
}

function DiscardPileSized() {
  return (
    <div className="relative inline-block">
      <PileFrame>
        <div style={{ width: "var(--card-w)", height: "var(--card-h)" }} />
      </PileFrame>
    </div>
  );
}

function PrizeGridCompact({
  remaining,
  backTone,
  flip = false,
}: {
  remaining: number;
  backTone: CardBackTone;
  flip?: boolean;
}) {
  const total = 6;
  const COLS = 2;
  const ROWS = 3;
  const taken = Math.max(0, Math.min(total, total - remaining));
  const slots = Array.from({ length: total }, (_, i) =>
    flip ? i >= taken : i < total - taken,
  );
  const rows = Array.from({ length: ROWS }, (_, r) =>
    slots.slice(r * COLS, r * COLS + COLS),
  );
  return (
    <div
      data-slot
      className={SLOT_BASE}
      style={{
        width: "calc(var(--prize-w) + var(--prize-w) + var(--prize-gap-x) + 12px)",
        height:
          "calc(var(--prize-h) + var(--prize-h) + var(--prize-h) + var(--prize-gap-y) + var(--prize-gap-y) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      <div className="flex flex-col">
        {rows.map((row, r) => (
          <div
            key={r}
            className="flex"
            style={{ marginTop: r === 0 ? 0 : "var(--prize-gap-y)" }}
          >
            {row.map((present, c) => (
              <div
                key={c}
                style={{
                  marginLeft: c === 0 ? 0 : "var(--prize-gap-x)",
                  zIndex: r * COLS + c,
                  width: "var(--prize-w)",
                  height: "var(--prize-h)",
                }}
              >
                {present && (
                  <BalatroHoverCard back={backTone} className="balatro-hover-card--prize">
                    <CardBackAtSize tone={backTone} size="prize" />
                  </BalatroHoverCard>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CardBox({
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

function DropTargetPileFrame({
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

function DraggableCard({
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

function ReleasedCard({
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

  return <div ref={ref}>{children}</div>;
}

function Bench({
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
        {visibleCards.map((card, visibleIndex) => (
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
              <DraggableCard
                card={card}
                location={{ kind: "bench", owner, index: cards.findIndex((candidate) => candidate.id === card.id) }}
                disabled={disabled}
              />
            </div>
          </Fragment>
        ))}
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

function Hand({
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
  );
  const draggedCard = cards.find((card) => card.id === draggingCardId);
  let renderedIndex = 0;

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
          const cardRenderIndex = renderedIndex++;
          const gapBefore = previewIndex === visibleIndex;

          return (
            <Fragment key={`hand-entry-${card.id}`}>
              {gapBefore ? (
                <div
                  key={`hand-gap-${owner}-${visibleIndex}`}
                  aria-hidden="true"
                  style={{
                    flex: "0 0 var(--card-w)",
                    height: "var(--card-h)",
                    marginLeft: cardRenderIndex === 0 ? 0 : "calc(var(--card-w) * -0.2)",
                    width: "var(--card-w)",
                  }}
                />
              ) : null}
              <div
                key={card.id}
                data-layout-card={card.id}
                style={{
                  marginLeft: (gapBefore ? cardRenderIndex + 1 : cardRenderIndex) === 0 ? 0 : "calc(var(--card-w) * -0.2)",
                  width: "var(--card-w)",
                  zIndex: visibleCards.length - visibleIndex,
                }}
              >
                <DraggableCard
                  card={card}
                  location={{ kind: "hand", owner, index: cards.findIndex((candidate) => candidate.id === card.id) }}
                  priority
                  bendCenterBoost={0}
                />
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

function IconButton({
  children,
  ariaLabel,
  size = "md",
  onClick,
}: {
  children: ReactNode;
  ariaLabel: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}) {
  const base =
    "relative flex cursor-pointer items-center justify-center rounded-full backdrop-blur-md ring-1 ring-inset transition-all active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300";
  const variant =
    "bg-white/[0.045] hover:bg-white/[0.06] text-white/70 hover:text-white/85 ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]";
  const sizeCls = size === "lg" ? "w-20 h-20" : size === "sm" ? "w-9 h-9" : "w-10 h-10";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`${base} ${variant} ${sizeCls}`}
    >
      {children}
    </button>
  );
}

function TurnControls({ onPassTurn }: { onPassTurn: () => void }) {
  return (
    <div
      className="absolute z-20 flex flex-col items-center gap-1"
      style={{ right: 24, top: "50%", transform: "translateY(-50%)" }}
    >
      <IconButton size="lg" ariaLabel="Pass turn" onClick={onPassTurn}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h13" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      </IconButton>
      <div className="flex gap-2">
        <IconButton size="sm" ariaLabel="Previous">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </IconButton>
        <IconButton size="sm" ariaLabel="Forward">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

function SettingsButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div className="absolute" style={{ right: 16, bottom: 16, zIndex: 1001 }}>
      <IconButton ariaLabel={active ? "Close animation tuning" : "Open animation tuning"} onClick={onClick}>
        <svg className="opacity-75" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </IconButton>
    </div>
  );
}

type TuningSliderKey = keyof BalatroHoverTuning;

interface TuningSliderConfig {
  key: TuningSliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

const TUNING_SLIDERS: TuningSliderConfig[] = [
  { key: "hoverZoom", label: "Hover zoom", min: 0, max: 0.14, step: 0.005 },
  { key: "juiceDuration", label: "Juice duration", min: 0.08, max: 1.2, step: 0.01 },
  { key: "juiceScaleAmount", label: "Juice scale", min: 0, max: 0.08, step: 0.001 },
  { key: "juiceRotationAmount", label: "Juice rotation", min: 0, max: 0.05, step: 0.001 },
  { key: "scaleEase", label: "Scale spring ease", min: 5, max: 160, step: 1 },
  { key: "rotationEase", label: "Rotation spring ease", min: 20, max: 360, step: 1 },
  { key: "bendBase", label: "Perspective bend", min: 0, max: 0.1, step: 0.001 },
  { key: "bendCenterBoost", label: "Center bend boost", min: 0, max: 1, step: 0.01 },
  { key: "bendCenterRadius", label: "Center boost radius", min: 0, max: 0.8, step: 0.01 },
  { key: "minPerspectiveW", label: "Perspective clamp", min: 0.05, max: 0.8, step: 0.01 },
  { key: "pressZoom", label: "Press/drag zoom", min: 0, max: 0.3, step: 0.005 },
  { key: "dragScaleEase", label: "Drag scale ease", min: 5, max: 160, step: 1 },
  { key: "dragXyEase", label: "Drag XY ease", min: 5, max: 160, step: 1 },
  { key: "dragSway", label: "Drag sway", min: 0, max: 0.06, step: 0.001 },
  { key: "releaseXyEase", label: "Release XY ease", min: 5, max: 160, step: 1 },
  { key: "releaseScaleEase", label: "Release scale ease", min: 5, max: 160, step: 1 },
  { key: "releaseRotationEase", label: "Release rotation ease", min: 20, max: 360, step: 1 },
  { key: "releaseXyAccel", label: "Release XY accel", min: 5, max: 120, step: 1 },
  { key: "releaseRotationFromXVelocity", label: "Release sway", min: 0, max: 0.06, step: 0.001 },
];

function formatSliderValue(value: number, step: number) {
  if (step >= 1) return value.toFixed(0);
  if (step >= 0.01) return value.toFixed(2);
  return value.toFixed(3);
}

function AnimationTuningPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tuning, setTuningState] = useState(getBalatroHoverTuning);

  useEffect(() => {
    return subscribeBalatroHoverTuning(() => setTuningState(getBalatroHoverTuning()));
  }, []);

  if (!open) return null;

  function updateSlider(key: TuningSliderKey, value: number) {
    setBalatroHoverTuning({ [key]: value } as Partial<BalatroHoverTuning>);
  }

  return (
    <div
      className="absolute w-[340px] max-h-[calc(100vh-110px)] overflow-y-auto rounded-2xl border border-white/10 bg-[#10121b]/90 p-4 text-white shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      style={{ right: 16, bottom: 64, zIndex: 1000 }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/65">Animation tuning</div>
          <p className="mt-1 text-xs leading-4 text-white/45">Hover a card while dragging sliders. Values are saved locally.</p>
        </div>
        <button
          type="button"
          aria-label="Close animation tuning"
          onClick={onClose}
          className="rounded-full px-2 py-1 text-sm text-white/55 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          ×
        </button>
      </div>

      <div className="space-y-3">
        {TUNING_SLIDERS.map((slider) => {
          const value = tuning[slider.key];
          const defaultValue = BALATRO_HOVER_TUNING_DEFAULTS[slider.key];
          return (
            <label key={slider.key} className="block rounded-xl bg-white/[0.035] p-3 ring-1 ring-inset ring-white/7">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-white/75">{slider.label}</span>
                <span className="font-mono text-white/55">{formatSliderValue(value, slider.step)}</span>
              </div>
              <input
                type="range"
                aria-label={slider.label}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={value}
                onChange={(event) => updateSlider(slider.key, Number(event.currentTarget.value))}
                className="w-full accent-sky-300"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-white/35">
                <span>{formatSliderValue(slider.min, slider.step)}</span>
                <span>default {formatSliderValue(defaultValue, slider.step)}</span>
                <span>{formatSliderValue(slider.max, slider.step)}</span>
              </div>
            </label>
          );
        })}
      </div>

      <button
        type="button"
        onClick={resetBalatroHoverTuning}
        className="mt-4 w-full rounded-xl bg-white/[0.06] px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white/70 ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.10] hover:text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        Reset to tuned defaults
      </button>
    </div>
  );
}

function PlayerChip({
  name,
  color,
  active,
  align,
  passAnimationKey,
}: {
  name: string;
  color: "rose" | "sky";
  active: boolean;
  align: "left" | "right";
  passAnimationKey: number;
}) {
  const circleRing =
    color === "rose"
      ? active
        ? "ring-2 ring-rose-300/80 shadow-[0_0_18px_rgba(244,114,182,0.55)]"
        : "ring-2 ring-white/9"
      : active
        ? "ring-2 ring-sky-300/80 shadow-[0_0_18px_rgba(56,189,248,0.55)]"
        : "ring-2 ring-white/9";
  const dot = color === "sky" ? "bg-sky-500" : "bg-rose-500";
  const animateIndicator = active && passAnimationKey > 0;
  return (
    <div
      className={`relative flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""} ${active ? "" : "opacity-55"}`}
    >
      <div
        key={animateIndicator ? passAnimationKey : "idle"}
        className={`w-7 h-7 rounded-full ${dot} ${circleRing} ${animateIndicator ? "turn-chip-pass" : ""} flex items-center justify-center text-[12px] font-bold transition-all`}
      >
        {name[0]}
      </div>
      <span className="text-xs font-medium tracking-wide">{name}</span>
    </div>
  );
}

function TurnBanner({
  info,
  passAnimationKey,
}: {
  info: TurnInfo;
  passAnimationKey: number;
}) {
  const yours = info.activePlayer === "you";
  return (
    <div
      className="absolute z-20 flex items-center gap-3 pl-2 pr-2 py-1.5 rounded-full bg-white/[0.07] backdrop-blur-md ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_28px_rgba(0,0,0,0.45)]"
      style={{ top: 16, left: 16 }}
    >
      <PlayerChip
        name={info.opponentName}
        color="rose"
        active={!yours}
        align="left"
        passAnimationKey={passAnimationKey}
      />
      <div className="flex flex-col items-center px-3 border-x border-white/9">
        <span className="text-[9px] uppercase tracking-[0.25em] text-white/45">Turn</span>
        <span className="text-sm font-bold text-white/85 tabular-nums leading-tight">
          {String(info.turn).padStart(2, "0")}
        </span>
      </div>
      <PlayerChip
        name={info.youName}
        color="sky"
        active={yours}
        align="right"
        passAnimationKey={passAnimationKey}
      />
    </div>
  );
}

function SourceBadge({ who }: { who: LogSource }) {
  const label = who === "you" ? "YOU" : who === "opponent" ? "OPP" : "SYS";
  const style =
    who === "you"
      ? "bg-sky-400/95 text-white"
      : who === "opponent"
        ? "bg-rose-500/95 text-white"
        : "border border-dashed border-white/20 bg-white/[0.035] text-white/45";

  return (
    <span
      className={`inline-flex h-[18px] min-w-[24px] items-center justify-center self-center rounded-[5px] px-1 text-[9px] font-extrabold leading-none tracking-[0.04em] ${style}`}
    >
      {label}
    </span>
  );
}

function LogMessage({ segments }: { segments: LogSegment[] }) {
  const toneClass: Record<LogSegmentTone, string> = {
    default: "text-white/72",
    strong: "font-semibold text-white/92",
    energy: "font-semibold text-sky-200",
    damage: "font-extrabold text-rose-200",
  };

  return (
    <span className="min-w-0 flex-1 self-center text-[11.5px] leading-[1.35]">
      {segments.map((segment, index) => (
        <span key={index} className={toneClass[segment.tone ?? "default"]}>
          {segment.text}
        </span>
      ))}
    </span>
  );
}

function GameLog({
  entries,
  turn,
}: {
  entries: LogEntry[];
  turn: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="absolute z-30" style={{ left: 12, bottom: 12 }}>
      {open && (
        <section
          aria-label="Game log"
          className="absolute flex flex-col overflow-hidden rounded-[22px] bg-white/[0.045] backdrop-blur-md ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]"
          style={{ left: 0, bottom: 52, width: 360, height: "min(420px, calc(100vh - 112px))" }}
        >
          <div className="relative flex items-center justify-between px-4 pb-2.5 pt-3.5 border-b border-white/[0.07]">
            <span className="text-[10px] font-black uppercase tracking-[0.26em] text-white/72">
              Game log
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
              T{turn}
            </span>
          </div>
          <div className="relative flex-1 overflow-y-auto px-3 py-2">
            {entries.map((entry, index) => {
              if (entry.kind === "turn") {
                return (
                  <div
                    key={`turn-${entry.turn}-${index}`}
                    className="-mx-3 flex items-center gap-2 border-y border-white/[0.055] bg-black/18 px-3 py-2"
                  >
                    <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/12 to-white/4" />
                    <span className="text-[10px] font-black uppercase tracking-[0.26em] text-white/62">
                      Turn {entry.turn}
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-white/4 via-white/12 to-transparent" />
                  </div>
                );
              }

              const nextEntry = entries[index + 1];
              const hideBottomBorder = nextEntry?.kind === "turn";

              return (
                <div
                  key={`${entry.who}-${entry.elapsed}-${index}`}
                  className={`flex items-center gap-2.5 px-0.5 py-2.5 ${hideBottomBorder ? "" : "border-b border-white/[0.055] last:border-b-0"}`}
                >
                  <SourceBadge who={entry.who} />
                  <LogMessage segments={entry.segments} />
                  <span className="shrink-0 self-center font-mono text-[10px] leading-none text-white/36">
                    {entry.elapsed}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <button
        type="button"
        aria-label={open ? "Hide game log" : "Show game log"}
        onClick={() => setOpen(!open)}
        className="relative w-10 h-10 flex cursor-pointer items-center justify-center rounded-full backdrop-blur-md ring-1 ring-inset ring-white/9 transition-all active:scale-95 bg-white/[0.045] hover:bg-white/[0.06] text-white/70 hover:text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </button>
    </div>
  );
}

function StadiumCard({
  card,
  releaseRectsRef,
  releaseAnimationKey,
}: {
  card: PokeState | null;
  releaseRectsRef?: ReleaseRectsRef;
  releaseAnimationKey?: number;
}) {
  return (
    <div className="relative">
      <DropTargetPileFrame target={{ kind: "stadium" }}>
        {card ? (
          <ReleasedCard
            cardId={card.id}
            releaseRectsRef={releaseRectsRef}
            releaseAnimationKey={releaseAnimationKey}
          >
            <CardBox cardId={card.cardId} instanceId={card.id} alt={card.name} priority />
          </ReleasedCard>
        ) : (
          <div style={{ width: "var(--card-w)", height: "var(--card-h)" }} />
        )}
      </DropTargetPileFrame>
    </div>
  );
}

function PlayerSide({
  owner,
  position,
  player,
  draggingCardId,
  draggingRect,
  dropPreview,
  releaseRectsRef,
  releaseAnimationKey,
  isActive = false,
}: {
  owner: PlayerId;
  position: SidePosition;
  player: PlayerBoardState;
  draggingCardId?: string;
  draggingRect?: DragRect;
  dropPreview?: RowDropPreview | null;
  releaseRectsRef?: ReleaseRectsRef;
  releaseAnimationKey?: number;
  isActive?: boolean;
}) {
  const isTop = position === "top";
  const active = player.active;
  const bench = player.bench;
  const prizesRemaining = player.prizesRemaining;
  const canInteract = isActive;
  const backTone = playerBackTone(owner);
  const benchRow = (
    <div className="relative">
      <Bench
        cards={bench}
        owner={owner}
        disabled={!canInteract}
        draggingCardId={draggingCardId}
        draggingRect={draggingRect}
        dropPreview={dropPreview}
        releaseRectsRef={releaseRectsRef}
      />
      <div
        className="absolute top-1/2"
        style={{
          transform: "translateY(calc(-50% + 2px))",
          ...(isTop
            ? { right: "100%", marginRight: "var(--side-gap)" }
            : { left: "100%", marginLeft: "var(--side-gap)" }),
        }}
      >
        <div className="relative">
          <DiscardPileSized />
          <div
            className="absolute left-0"
            style={isTop ? { top: "100%", marginTop: 8 } : { bottom: "100%", marginBottom: 8 }}
          >
            <DeckPileSized backTone={backTone} />
          </div>
        </div>
      </div>
      <div
        className="absolute"
        style={
          isTop
            ? { top: 0, left: "100%", marginLeft: "var(--side-gap)" }
            : { bottom: 0, right: "100%", marginRight: "var(--side-gap)" }
        }
      >
        <PrizeGridCompact remaining={prizesRemaining} backTone={backTone} flip={isTop} />
      </div>
    </div>
  );
  const activeNode = (
    <DropTargetPileFrame target={{ kind: "active", owner }} active={isActive} disabled={!canInteract}>
      {active ? (
        <div
          style={active.id === draggingCardId ? hiddenDraggedCardStyle(draggingRect) : undefined}
        >
          <ReleasedCard
            cardId={active.id}
            releaseRectsRef={releaseRectsRef}
            releaseAnimationKey={releaseAnimationKey}
          >
            <DraggableCard
              card={active}
              location={{ kind: "active", owner }}
              priority
              disabled={!canInteract}
            />
          </ReleasedCard>
        </div>
      ) : null}
    </DropTargetPileFrame>
  );

  return (
    <div
      data-player-owner={owner}
      data-side-position={position}
      className={`flex-1 min-h-0 px-6 flex flex-col items-center gap-2 relative ${isTop ? "justify-start" : "justify-end"}`}
      style={{ paddingTop: isTop ? 16 : 4, paddingBottom: 4 }}
    >
      {isTop ? (
        <>
          {benchRow}
          {activeNode}
        </>
      ) : (
        <>
          {activeNode}
          {benchRow}
        </>
      )}
    </div>
  );
}

export function PlaymatBody() {
  const [info, setInfo] = useState(turnInfo);
  const [board, setBoard] = useState<BoardState>(() => cloneBoard(initialBoard));
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropPreview, setDropPreview] = useState<RowDropPreview | null>(null);
  const [releaseAnimationKey, setReleaseAnimationKey] = useState(0);
  const [passAnimationKey, setPassAnimationKey] = useState(0);
  const [tuningOpen, setTuningOpen] = useState(false);
  const releaseRectsRef = useRef(new Map<string, ReleaseMotion>());
  const dragMotionRef = useRef(new Map<string, DragMotionSample>());
  const activeDragIdRef = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 6px is dnd-kit's common default for touch and sits comfortably above
      // the touch-noise floor on most devices. distance: 1 was below that
      // floor and could trigger drags from sub-pixel finger drift.
      activationConstraint: { distance: 6 },
    }),
  );
  const bottomOwner = info.activePlayer;
  const topOwner = otherPlayer(bottomOwner);
  const draggingCard = dragState?.card ?? null;

  useEffect(() => {
    return () => setCardDragInteractionLock(false);
  }, []);

  function passTurn() {
    setPassAnimationKey((key) => key + 1);
    setInfo((current) => ({
      ...current,
      turn: current.turn + 1,
      activePlayer: otherPlayer(current.activePlayer),
    }));
  }

  function indexedRowTarget(
    target: Extract<DropTarget, { kind: "hand" | "bench" }>,
    event: DragMoveEvent | DragEndEvent,
  ): RowDropPreview | null {
    const resolvedTarget = resolveDropTargetIndex(target, event);
    if (resolvedTarget.kind !== "hand" && resolvedTarget.kind !== "bench") return null;

    return {
      ...resolvedTarget,
      index: resolvedTarget.index ?? 0,
    };
  }

  function getRowDropPreview(event: DragMoveEvent | DragEndEvent) {
    const dragData = event.active.data.current;
    const dropData = event.over?.data.current;

    if (!isDragCardData(dragData)) return null;

    if (isDropTargetData(dropData) && (dropData.target.kind === "hand" || dropData.target.kind === "bench")) {
      const hoveredPreview = indexedRowTarget(dropData.target, event);
      if (hoveredPreview && canPreviewRowDrop(board, dragData.location, hoveredPreview, info.activePlayer)) {
        return hoveredPreview;
      }
    }

    // Balatro keeps the dragged card in its source card area while it is far
    // from valid release targets, so the source row keeps a live space and
    // continues sorting by X. It only transfers areas if released over a target.
    if (dragData.location.kind === "hand" || dragData.location.kind === "bench") {
      const sourcePreview = {
        kind: dragData.location.kind,
        owner: dragData.location.owner,
      } satisfies Extract<DropTarget, { kind: "hand" | "bench" }>;

      if (canPreviewRowDrop(board, dragData.location, sourcePreview, info.activePlayer)) {
        return indexedRowTarget(sourcePreview, event) ?? {
          ...sourcePreview,
          index: dragData.location.index,
        };
      }
    }

    return null;
  }

  function clearDragState() {
    if (activeDragIdRef.current) dragMotionRef.current.delete(activeDragIdRef.current);
    activeDragIdRef.current = null;
    setCardDragInteractionLock(false);
    setDragState(null);
    setDropPreview(null);
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current;

    if (!isDragCardData(data) || !sourceBelongsToPlayer(data.location, info.activePlayer)) {
      clearDragState();
      return;
    }

    const sourceRowPreview =
      data.location.kind === "hand" || data.location.kind === "bench"
        ? {
            kind: data.location.kind,
            owner: data.location.owner,
            index: data.location.index,
          }
        : null;

    const dragRect = dragRectFromEvent(event);
    activeDragIdRef.current = data.card.id;
    sampleDragMotion(dragMotionRef.current, data.card.id, dragRect);
    setCardDragInteractionLock(true);
    setDragState({ card: data.card, rect: dragRect });
    setDropPreview(
      sourceRowPreview && canPreviewRowDrop(board, data.location, sourceRowPreview, info.activePlayer)
        ? sourceRowPreview
        : null,
    );
  }

  function handleDragMove(event: DragMoveEvent) {
    if (activeDragIdRef.current !== String(event.active.id)) return;

    const dragData = event.active.data.current;
    if (isDragCardData(dragData)) {
      sampleDragMotion(dragMotionRef.current, dragData.card.id, dragRectAtRelease(event, dragState?.rect));
    }

    setDropPreview((currentPreview) => {
      const nextPreview = getRowDropPreview(event);
      const samePreview =
        currentPreview?.kind === nextPreview?.kind &&
        currentPreview?.owner === nextPreview?.owner &&
        currentPreview?.index === nextPreview?.index;
      return samePreview ? currentPreview : nextPreview;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const dragData = event.active.data.current;
    const dropData = event.over?.data.current;
    const hoveredTarget = isDropTargetData(dropData)
      ? resolveDropTargetIndex(dropData.target, event)
      : null;
    const sourceAreaPreview =
      isDragCardData(dragData) &&
      dropPreview &&
      (dragData.location.kind === "hand" || dragData.location.kind === "bench") &&
      dropPreview.kind === dragData.location.kind &&
      dropPreview.owner === dragData.location.owner
        ? dropPreview
        : null;
    const resolvedTarget = hoveredTarget ?? sourceAreaPreview;

    if (isDragCardData(dragData)) {
      const releaseRect = dragRectAtRelease(event, dragState?.rect);
      releaseRectsRef.current.set(
        dragData.card.id,
        releaseMotionFromDragSample(dragMotionRef.current, dragData.card.id, releaseRect),
      );
      setReleaseAnimationKey((key) => key + 1);
    }

    clearDragState();

    if (!isDragCardData(dragData) || !resolvedTarget) return;

    setBoard((current) =>
      canActivePlayerMove(dragData.location, resolvedTarget, info.activePlayer)
        ? moveCard(current, dragData.location, resolvedTarget)
        : current,
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={clearDragState}
    >
      <span className="sr-only" data-perspective-player={bottomOwner} aria-hidden="true" />
      <PlayerSide
        owner={topOwner}
        player={board[topOwner]}
        position="top"
        draggingCardId={draggingCard?.id}
        draggingRect={dragState?.rect}
        dropPreview={dropPreview}
        releaseRectsRef={releaseRectsRef}
        releaseAnimationKey={releaseAnimationKey}
        isActive={info.activePlayer === topOwner}
      />
      <PlayerSide
        owner={bottomOwner}
        player={board[bottomOwner]}
        position="bottom"
        draggingCardId={draggingCard?.id}
        draggingRect={dragState?.rect}
        dropPreview={dropPreview}
        releaseRectsRef={releaseRectsRef}
        releaseAnimationKey={releaseAnimationKey}
        isActive={info.activePlayer === bottomOwner}
      />
      <Hand
        cards={board.hand}
        owner={bottomOwner}
        draggingCardId={draggingCard?.id}
        draggingRect={dragState?.rect}
        dropPreview={dropPreview}
        releaseRectsRef={releaseRectsRef}
      />
      <div
        className="absolute z-10"
        style={{
          left: "50%",
          top: CENTER_LINE_TOP,
          transform: "translate(calc(-150% - var(--side-gap) - 24px), -50%)",
        }}
      >
        <StadiumCard
          card={board.stadium}
          releaseRectsRef={releaseRectsRef}
          releaseAnimationKey={releaseAnimationKey}
        />
      </div>
      <TurnControls onPassTurn={passTurn} />
      <AnimationTuningPanel open={tuningOpen} onClose={() => setTuningOpen(false)} />
      <SettingsButton active={tuningOpen} onClick={() => setTuningOpen((open) => !open)} />
      <TurnBanner info={info} passAnimationKey={passAnimationKey} />
      <GameLog entries={gameLog} turn={info.turn} />
      <DragOverlay dropAnimation={null} zIndex={DRAG_OVERLAY_Z_INDEX}>
        {draggingCard ? (
          <div className="pointer-events-none" style={overlayCardStyle(dragState?.rect)}>
            {/*
              Use a distinct instanceId for the overlay copy so it does not
              collide with the still-mounted (but hidden) source DraggableCard
              inside its row. Both register with the module-level
              BalatroDomCardAnimator, which keys visual state by instanceId
              and would otherwise have them stomp each other every frame.
            */}
            <CardBox
              cardId={draggingCard.cardId}
              instanceId={`${draggingCard.id}-overlay`}
              alt={draggingCard.name}
              priority
              bendCenterBoost={0}
              dragging
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
