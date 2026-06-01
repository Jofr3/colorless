import type { CardModel, PlayerId } from "../types";
import { PlaymatCard } from "./Card";

const BASE_HAND_CARD_OVERLAP = 0.2;
const HAND_CARD_OVERLAP_GROWTH = 0.035;
const MAX_HAND_CARD_OVERLAP = 0.72;

function overlapForHandSize(cardCount: number) {
  const overlap = Math.min(
    MAX_HAND_CARD_OVERLAP,
    BASE_HAND_CARD_OVERLAP + Math.max(0, cardCount - 6) * HAND_CARD_OVERLAP_GROWTH,
  );
  return `calc(var(--card-w) * -${overlap.toFixed(3)})`;
}

export function Hand({ cards, owner }: { cards: CardModel[]; owner: PlayerId }) {
  const handCardOverlap = overlapForHandSize(cards.length);

  return (
    <div
      className="relative z-10 flex items-end justify-center px-6"
      style={{ height: "var(--hand-h)", paddingBottom: 8 }}
      data-card-drop-zone="true"
      data-card-owner={owner}
      data-card-zone="hand"
    >
      <div className="relative flex h-full items-end justify-center">
        {cards.map((card, index) => (
          <div
            key={card.id}
            style={{
              marginLeft: index === 0 ? 0 : handCardOverlap,
              width: "var(--card-w)",
              zIndex: cards.length - index,
            }}
            data-card-drop-zone="true"
            data-card-owner={owner}
            data-card-zone="hand"
            data-card-index={index}
          >
            <PlaymatCard card={card} priority />
          </div>
        ))}
      </div>
    </div>
  );
}
