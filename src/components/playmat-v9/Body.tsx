import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  CARD_W,
  CENTER_LINE_TOP,
  DRAG_OVERLAY_Z_INDEX,
  WRAPPER_CLASSES,
  type BoardState,
  type DragMotionSample,
  type DragState,
  type DropTarget,
  type ReleaseMotion,
  type RowDropPreview,
} from "./types";
import { gameLog, initialBoard, turnInfo } from "./fixtures";
import {
  canActivePlayerMove,
  canPreviewRowDrop,
  cloneBoard,
  isDragCardData,
  isDropTargetData,
  moveCard,
  otherPlayer,
  sourceBelongsToPlayer,
} from "./state/board";
import {
  dragRectAtRelease,
  dragRectFromEvent,
  overlayCardStyle,
  releaseMotionFromDragSample,
  resolveDropTargetIndex,
  sampleDragMotion,
  setCardDragInteractionLock,
} from "./physics/dragGeometry";
import { CardBox } from "./components/Card";
import { Hand } from "./components/Hand";
import { PlayerSide, StadiumCard } from "./components/PlayerSide";
import { SettingsButton, TurnBanner, TurnControls } from "./components/Hud";
import { AnimationTuningPanel } from "./components/AnimationTuningPanel";
import { GameLog } from "./components/GameLog";

export { CARD_W, WRAPPER_CLASSES };


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
