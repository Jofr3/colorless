import { CardImage } from "../../../components/CardImage";
import { DecksIcon } from "../../../components/icons";
import { FOCUS_RING_INSET } from "../../../lib/glass";
import { type BuilderCard, cardImageUrl } from "../cards";

export interface CardGridProps {
  cards: BuilderCard[];
  /** Copies of a card currently in the deck. */
  countOf: (card: BuilderCard) => number;
  /** Copies still addable (0 = at the per-name cap). */
  remainingOf: (card: BuilderCard) => number;
  onAdd: (card: BuilderCard) => void;
  onRemove: (card: BuilderCard) => void;
}

function CardTile({ card, countOf, remainingOf, onAdd, onRemove }: { card: BuilderCard } & Omit<CardGridProps, "cards">) {
  const count = countOf(card);
  const inDeck = count > 0;
  const maxed = remainingOf(card) <= 0;

  return (
    <li className="relative">
      {/* Full-cover add target. Click adds a copy; right-click removes one (the
          browser menu is suppressed) — the card itself carries no hover UI. */}
      <button
        type="button"
        aria-label={
          maxed
            ? `${card.name}, maximum copies reached`
            : inDeck
              ? `Add ${card.name}, ${count} in deck`
              : `Add ${card.name}`
        }
        onClick={() => onAdd(card)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (inDeck) onRemove(card);
        }}
        className={`relative block w-full cursor-pointer overflow-hidden rounded-xl ring-1 ring-inset ${FOCUS_RING_INSET} ${
          inDeck ? "ring-accent/70" : "ring-white/10"
        } ${maxed ? "cursor-not-allowed" : ""}`}
      >
        <div className={`aspect-[2.5/3.5] w-full ${maxed ? "opacity-45 saturate-[0.7]" : ""}`}>
          <CardImage
            fill
            imageUrl={cardImageUrl(card.cardId)}
            alt={card.name}
            className="h-full w-full object-cover"
          />
        </div>
      </button>

      {/* "Max" pill — a redundant cue alongside the dimmed art, so the cap reads
          without relying on colour/opacity alone. */}
      {maxed && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/90 ring-1 ring-inset ring-white/20"
        >
          Max
        </span>
      )}
    </li>
  );
}

/** The centre pane's card grid. Column counts mirror the decks library grid so
    a card here renders at the same size as a deck tile there (same width column,
    same aspect). Tiles are image-forward with a hover caption, a count badge,
    and a +/- stepper. */
export function CardGrid({ cards, ...handlers }: CardGridProps) {
  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 pb-16 pt-32 text-center">
        <DecksIcon className="h-6 w-6 text-white/20" />
        <p className="text-sm font-medium text-white/55">No cards match these filters</p>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <CardTile key={card.cardId} card={card} {...handlers} />
      ))}
    </ul>
  );
}
