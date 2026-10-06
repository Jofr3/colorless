import type { BoardState, CardMoveRequest } from "../types";
import { PlaymatCard } from "./Card";

export function EnergyChoiceArea({
  board,
  onMoveCard,
}: {
  board: BoardState;
  onMoveCard: (request: CardMoveRequest) => void;
}) {
  const choice = board.energyChoice;
  if (choice === undefined) return null;
  return (
    <div
      className="energy-choice-area absolute flex flex-col items-center gap-3"
      aria-label="Energy attachment choices"
    >
      <output className="pointer-events-none relative z-[61] max-w-52 text-center text-sm font-semibold text-white">
        Which Energy do you want to attach?
        <span className="mt-1 block text-xs font-normal text-white/60">
          Drag an Energy onto your Pokémon.
        </span>
      </output>
      <div className="energy-choice-area__cards flex gap-4">
        {choice.cards.map((card) => (
          <PlaymatCard key={card.id} card={card} priority />
        ))}
      </div>
      {choice.cards.map((card, index) =>
        choice.targets.map((target) => {
          const host =
            target.zone === "active"
              ? board.you.active
              : target.zone === "bench"
                ? board.you.bench[target.index ?? -1]
                : null;
          return (
            <button
              key={`${card.id}-${target.zone}-${"index" in target ? target.index : ""}`}
              type="button"
              className="sr-only focus:not-sr-only focus:relative z-[61]"
              onClick={() =>
                onMoveCard({
                  cardId: card.id,
                  from: { owner: "you", zone: "choice", index },
                  to: target,
                })
              }
            >
              Attach {card.name} to {host?.name ?? "Pokémon"}
            </button>
          );
        }),
      )}
      {choice.cards.length === 1 && (
        <button
          type="button"
          className="relative z-[61] text-xs text-white/70 underline"
          onClick={() => {
            const card = choice.cards[0];
            if (card)
              onMoveCard({
                cardId: card.id,
                from: { owner: "you", zone: "choice", index: 0 },
                to: { owner: "you", zone: "hand" },
              });
          }}
        >
          Keep it in your hand
        </button>
      )}
    </div>
  );
}
