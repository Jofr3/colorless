import type { CardModel } from "../types";
import { PlaymatCard } from "./Card";

const HAND_CARD_OVERLAP = "calc(var(--card-w) * -0.2)";

export function Hand({ cards }: { cards: CardModel[] }) {
  return (
    <div
      className="relative z-10 flex items-end justify-center px-6"
      style={{ height: "var(--hand-h)", paddingBottom: 8 }}
      data-card-drop-zone="true"
      data-card-owner="you"
      data-card-zone="hand"
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
            data-card-drop-zone="true"
            data-card-owner="you"
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
