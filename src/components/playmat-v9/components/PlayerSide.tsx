// One half of the playmat: a player's bench row, active card, and the
// discard / deck / prize-grid satellites attached to either side.
// StadiumCard sits between the two PlayerSides; it shares enough wiring
// with the active-slot release path that it lives here too.

import type { ReactNode } from "react";
import type {
  DragRect,
  PlayerBoardState,
  PlayerId,
  PokeState,
  ReleaseRectsRef,
  RowDropPreview,
  SidePosition,
} from "../types";
import { canDropCardOnTarget, playerBackTone } from "../state/board";
import { hiddenDraggedCardStyle } from "../physics/dragGeometry";
import {
  CardBox,
  DraggableCard,
  DropTargetPileFrame,
  PokemonCardDropTarget,
  ReleasedCard,
} from "./Card";
import { Bench } from "./Bench";
import { DeckPileSized, DiscardPileSized, PrizeGridCompact } from "./Piles";

export function StadiumCard({
  card,
  draggingCard,
  releaseRectsRef,
  releaseAnimationKey,
}: {
  card: PokeState | null;
  draggingCard?: PokeState | null;
  releaseRectsRef?: ReleaseRectsRef;
  releaseAnimationKey?: number;
}) {
  return (
    <div className="relative">
      <DropTargetPileFrame
        target={{ kind: "stadium" }}
        disabled={!canDropCardOnTarget(draggingCard, { kind: "stadium" })}
      >
        {card ? (
          <ReleasedCard
            cardId={card.id}
            releaseRectsRef={releaseRectsRef}
            releaseAnimationKey={releaseAnimationKey}
          >
            <CardBox
              cardId={card.cardId}
              cardType={card.cardType}
              imageUrl={card.imageUrl}
              instanceId={card.id}
              alt={card.name}
              priority
            />
          </ReleasedCard>
        ) : (
          <div style={{ width: "var(--card-w)", height: "var(--card-h)" }} />
        )}
      </DropTargetPileFrame>
    </div>
  );
}

export function PlayerSide({
  owner,
  position,
  player,
  draggingCardId,
  draggingCard,
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
  draggingCard?: PokeState | null;
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
  const benchDropDisabled = !canInteract || !canDropCardOnTarget(draggingCard, { kind: "bench", owner });
  const activeDropDisabled = !canInteract || !canDropCardOnTarget(draggingCard, { kind: "active", owner });
  const benchRow: ReactNode = (
    <div className="relative">
      <Bench
        cards={bench}
        owner={owner}
        disabled={benchDropDisabled}
        attachmentDisabled={!canInteract}
        draggingCardId={draggingCardId}
        draggingCard={draggingCard}
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
  const activeNode: ReactNode = (
    <DropTargetPileFrame target={{ kind: "active", owner }} active={isActive} disabled={activeDropDisabled}>
      {active ? (
        <div style={active.id === draggingCardId ? hiddenDraggedCardStyle(draggingRect) : undefined}>
          <ReleasedCard
            cardId={active.id}
            releaseRectsRef={releaseRectsRef}
            releaseAnimationKey={releaseAnimationKey}
          >
            <PokemonCardDropTarget
              target={{ kind: "pokemon", owner, slot: "active" }}
              pokemon={active}
              draggingCard={draggingCard}
              disabled={!canInteract}
            >
              <DraggableCard
                card={active}
                location={{ kind: "active", owner }}
                priority
                disabled={!canInteract}
              />
            </PokemonCardDropTarget>
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
