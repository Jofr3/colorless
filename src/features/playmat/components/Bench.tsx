import { BENCH_LIMIT, FRAME_CLASS } from "../constants";
import type { CardModel } from "../types";
import { PlaymatCard } from "./Card";

export function Bench({ cards }: { cards: CardModel[] }) {
  return (
    <div
      className={FRAME_CLASS}
      style={{
        width: `calc(var(--card-w) * ${BENCH_LIMIT} + var(--slot-gap) * ${BENCH_LIMIT - 1} + 12px)`,
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
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
          >
            <PlaymatCard card={card} />
          </div>
        ))}
      </div>
    </div>
  );
}
