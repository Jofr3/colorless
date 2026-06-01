import { CARD_SIZE_STYLE } from "../constants";
import type { CardModel, PlayerBoard, PlayerId, SidePosition } from "../types";
import { cardBackToneFor } from "../utils/players";
import { Bench } from "./Bench";
import { CardSlot, PlaymatCard } from "./Card";
import { DeckPile, DiscardPile, PrizeGrid } from "./Piles";

const SIDE_PILE_STACK_GAP = "calc(var(--slot-gap) + 4px)";
// Side piles sit at the bench frame's edges (left/right: 100%), so they track
// the bench width automatically as the bench-limit grows — no per-limit gap.
const SIDE_PILES_BENCH_GAP = SIDE_PILE_STACK_GAP;

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
        className="absolute"
        style={
          isTop
            ? { top: 0, right: "100%", marginRight: SIDE_PILES_BENCH_GAP }
            : { bottom: 0, left: "100%", marginLeft: SIDE_PILES_BENCH_GAP }
        }
      >
        <div className="relative" style={{ lineHeight: 0 }}>
          <DiscardPile />
          <div
            className="absolute left-0"
            style={
              isTop
                ? { top: "100%", marginTop: SIDE_PILE_STACK_GAP }
                : { bottom: "100%", marginBottom: SIDE_PILE_STACK_GAP }
            }
          >
            <DeckPile owner={owner} tone={cardBackTone} />
          </div>
        </div>
      </div>
      <div
        className="absolute"
        style={
          isTop
            ? { top: 0, left: "100%", marginLeft: SIDE_PILES_BENCH_GAP }
            : { bottom: 0, right: "100%", marginRight: SIDE_PILES_BENCH_GAP }
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
  benchLimit,
}: {
  owner: PlayerId;
  player: PlayerBoard;
  side: SidePosition;
  benchLimit: number;
}) {
  return (
    <div className="relative">
      <Bench cards={player.bench} owner={owner} side={side} benchLimit={benchLimit} />
      <SidePiles owner={owner} prizesRemaining={player.prizesRemaining} side={side} />
    </div>
  );
}

export function PlayerSide({
  owner,
  side,
  player,
  activeTurn = false,
  benchLimit,
}: {
  owner: PlayerId;
  side: SidePosition;
  player: PlayerBoard;
  activeTurn?: boolean;
  benchLimit: number;
}) {
  const isTop = side === "top";
  const activeSlot = <ActiveCardSlot card={player.active} active={activeTurn} owner={owner} />;
  const bench = <BenchArea owner={owner} player={player} side={side} benchLimit={benchLimit} />;

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
