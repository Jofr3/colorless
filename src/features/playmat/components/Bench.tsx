import { BENCH_LIMIT, FRAME_CLASS } from "../constants";
import type { CardModel, PlayerId } from "../types";
import { PlaymatCard } from "./Card";

export function Bench({ cards, owner }: { cards: CardModel[]; owner: PlayerId }) {
  return (
    <div
      className={FRAME_CLASS}
      style={{
        width: `calc(var(--card-w) * ${BENCH_LIMIT} + var(--slot-gap) * ${BENCH_LIMIT - 1} + 12px)`,
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
      data-card-drop-zone="true"
      data-card-owner={owner}
      data-card-zone="bench"
    >
      <div
        className="relative flex h-full w-full items-center justify-center"
        style={{ gap: "var(--slot-gap)" }}
      >
        {cards.map((card, index) => (
          <div
            key={card.id}
            style={{
              position: "relative",
              width: "var(--card-w)",
              zIndex: cards.length - index,
            }}
            data-card-drop-zone="true"
            data-card-owner={owner}
            data-card-zone="bench"
            data-card-index={index}
          >
            <PlaymatCard card={card} />
          </div>
        ))}
      </div>
    </div>
  );
}
