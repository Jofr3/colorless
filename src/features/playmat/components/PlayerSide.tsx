import { CARD_SIZE_STYLE } from "../constants";
import type { CardModel, PlayerBoard, PlayerId, SidePosition } from "../types";
import { cardBackToneFor } from "../utils/players";
import { Bench } from "./Bench";
import { CardSlot, PlaymatCard } from "./Card";
import { DeckPile, DiscardPile, PrizeGrid } from "./Piles";

function ActiveCardSlot({
  card,
  active,
  owner,
}: {
  card: CardModel | null;
  active: boolean;
  owner: PlayerId;
}) {
  return (
    <div data-card-drop-zone="true" data-card-owner={owner} data-card-zone="active">
      <CardSlot highlighted={active}>
        {card ? <PlaymatCard card={card} priority /> : <div style={CARD_SIZE_STYLE} />}
      </CardSlot>
    </div>
  );
}

function SidePiles({
  owner,
  prizesRemaining,
  side,
}: {
  owner: PlayerId;
  prizesRemaining: number;
  side: SidePosition;
}) {
  const isTop = side === "top";
  const cardBackTone = cardBackToneFor(owner);

  return (
    <>
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
          <DiscardPile />
          <div
            className="absolute left-0"
            style={isTop ? { top: "100%", marginTop: 8 } : { bottom: "100%", marginBottom: 8 }}
          >
            <DeckPile owner={owner} tone={cardBackTone} />
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
        <PrizeGrid
          owner={owner}
          remaining={prizesRemaining}
          tone={cardBackTone}
          flipped={isTop}
        />
      </div>
    </>
  );
}

function BenchArea({
  owner,
  player,
  side,
}: {
  owner: PlayerId;
  player: PlayerBoard;
  side: SidePosition;
}) {
  return (
    <div className="relative">
      <Bench cards={player.bench} owner={owner} />
      <SidePiles owner={owner} prizesRemaining={player.prizesRemaining} side={side} />
    </div>
  );
}

export function PlayerSide({
  owner,
  side,
  player,
  activeTurn = false,
}: {
  owner: PlayerId;
  side: SidePosition;
  player: PlayerBoard;
  activeTurn?: boolean;
}) {
  const isTop = side === "top";
  const activeSlot = <ActiveCardSlot card={player.active} active={activeTurn} owner={owner} />;
  const bench = <BenchArea owner={owner} player={player} side={side} />;

  return (
    <div
      className={`relative flex min-h-0 flex-1 flex-col items-center gap-2 px-6 ${isTop ? "justify-start" : "justify-end"}`}
      style={{ paddingTop: isTop ? 16 : 4, paddingBottom: 4 }}
    >
      {isTop ? (
        <>
          {bench}
          {activeSlot}
        </>
      ) : (
        <>
          {activeSlot}
          {bench}
        </>
      )}
    </div>
  );
}
