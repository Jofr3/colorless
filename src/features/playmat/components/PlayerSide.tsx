import { CARD_SIZE_STYLE } from "../constants";
import type {
  CardModel,
  FaceUpPrize,
  PileState,
  PlayerBoard,
  PlayerId,
  SidePosition,
} from "../types";
import { cardBackToneFor } from "../utils/players";
import { Bench } from "./Bench";
import { CardSlot, DamageDice, PlaymatCard, StatusChips } from "./Card";
import { DeckPile, DiscardPile, PrizeGrid } from "./Piles";
import { UsedTrainers } from "./UsedTrainers";

const SIDE_PILE_STACK_GAP = "calc(var(--slot-gap) + 4px)";
// Side piles sit at the bench frame's edges (left/right: 100%), so they track
// the bench width automatically as the bench-limit grows — no per-limit gap.
const SIDE_PILES_BENCH_GAP = SIDE_PILE_STACK_GAP;

function ActiveCardSlot({
  card,
  active,
  owner,
  blueBackPlayer,
  usedTrainers,
}: {
  card: CardModel | null;
  active: boolean;
  owner: PlayerId;
  blueBackPlayer?: PlayerId;
  usedTrainers?: { turn: number; cards: CardModel[] };
}) {
  return (
    <div
      className="relative"
      data-card-drop-zone="true"
      data-card-owner={owner}
      data-card-zone="active"
    >
      <CardSlot highlighted={active}>
        {card ? <PlaymatCard card={card} priority /> : <div style={CARD_SIZE_STYLE} />}
      </CardSlot>
      {usedTrainers && (
        <UsedTrainers key={usedTrainers.turn} cards={usedTrainers.cards} owner={owner} />
      )}
      {/* The dice and status markers sit above the Pixi canvas and follow
          their Pokémon through the shared card-badge anchor. */}
      {card?.battle !== undefined && (
        <DamageDice
          battle={card.battle}
          cardId={card.id}
          tone={cardBackToneFor(owner, blueBackPlayer)}
        />
      )}
      {card?.battle?.conditions !== undefined && (
        <StatusChips
          conditions={card.battle.conditions}
          cardId={card.id}
          className="left-0 top-0"
        />
      )}
    </div>
  );
}

function SidePiles({
  owner,
  blueBackPlayer,
  prizesRemaining,
  faceUpPrizes,
  side,
  pile,
}: {
  owner: PlayerId;
  blueBackPlayer?: PlayerId;
  prizesRemaining: number;
  /** 🆕🆕🆕 D551 — the side's face-up prizes, straight through to PrizeGrid. */
  faceUpPrizes: readonly FaceUpPrize[];
  side: SidePosition;
  pile?: PileState;
}) {
  const isTop = side === "top";
  const cardBackTone = cardBackToneFor(owner, blueBackPlayer);

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
          <DiscardPile owner={owner} discard={pile?.discard} />
          <div
            className="absolute left-0"
            style={
              isTop
                ? { top: "100%", marginTop: SIDE_PILE_STACK_GAP }
                : { bottom: "100%", marginBottom: SIDE_PILE_STACK_GAP }
            }
          >
            <DeckPile
              owner={owner}
              tone={cardBackTone}
              count={pile?.deckCount}
              mulliganCount={pile?.mulliganCount}
            />
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
          faceUp={faceUpPrizes}
        />
      </div>
    </>
  );
}

function BenchArea({
  owner,
  blueBackPlayer,
  player,
  side,
  benchLimit,
  pile,
}: {
  owner: PlayerId;
  blueBackPlayer?: PlayerId;
  player: PlayerBoard;
  side: SidePosition;
  benchLimit: number;
  pile?: PileState;
}) {
  return (
    <div className="relative">
      <Bench
        cards={player.bench}
        owner={owner}
        side={side}
        benchLimit={benchLimit}
        tone={cardBackToneFor(owner, blueBackPlayer)}
      />
      <SidePiles
        owner={owner}
        blueBackPlayer={blueBackPlayer}
        prizesRemaining={player.prizesRemaining}
        faceUpPrizes={player.faceUpPrizes}
        side={side}
        pile={pile}
      />
    </div>
  );
}

export function PlayerSide({
  owner,
  blueBackPlayer,
  side,
  player,
  activeTurn = false,
  benchLimit,
  pile,
  usedTrainers,
}: {
  owner: PlayerId;
  blueBackPlayer?: PlayerId;
  side: SidePosition;
  player: PlayerBoard;
  activeTurn?: boolean;
  benchLimit: number;
  /** Deck count + public discard (game page); absent on the mock. */
  pile?: PileState;
  usedTrainers?: { turn: number; cards: CardModel[] };
}) {
  const isTop = side === "top";
  const activeSlot = (
    <ActiveCardSlot
      card={player.active}
      active={activeTurn}
      owner={owner}
      blueBackPlayer={blueBackPlayer}
      usedTrainers={usedTrainers}
    />
  );
  const bench = (
    <BenchArea
      owner={owner}
      blueBackPlayer={blueBackPlayer}
      player={player}
      side={side}
      benchLimit={benchLimit}
      pile={pile}
    />
  );

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
