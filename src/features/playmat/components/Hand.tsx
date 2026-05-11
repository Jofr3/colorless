import type { CardModel } from "../types";
import { PlaymatCard } from "./Card";

const HAND_CARD_OVERLAP = "calc(var(--card-w) * -0.2)";

export function Hand({ cards }: { cards: CardModel[] }) {
  return (
    <div
      className="relative z-10 flex items-end justify-center px-6"
      style={{ height: "var(--hand-h)", paddingBottom: 8 }}
    >
      <div className="relative flex h-full items-end justify-center">
        {cards.map((card, index) => (
          <div
            key={card.id}
            style={{
              marginLeft: index === 0 ? 0 : HAND_CARD_OVERLAP,
              width: "var(--card-w)",
              zIndex: cards.length - index,
            }}
          >
            <PlaymatCard card={card} priority />
          </div>
        ))}
      </div>
    </div>
  );
}
