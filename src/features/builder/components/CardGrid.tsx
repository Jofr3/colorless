import { CardImage } from "../../../components/CardImage";
import { DecksIcon } from "../../../components/icons";
import { FOCUS_RING_INSET } from "../../../lib/glass";
import { type BuilderCard, cardImageUrl } from "../cards";

// The pile cards peek out only their bottom edge, so — like the decks page's
// deck stacks — they're a flat "card-edge" blue matching the card back's inner
// border rather than the (darker-at-the-bottom) full back image.
const CARD_EDGE = "#28345a";

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
  const remaining = remainingOf(card);
  const maxed = remaining <= 0;
  // The gallery shows each card's remaining supply: a full pile of four behind
  // the top card by default, thinning as copies are drafted into the deck.
  const pile = Math.min(remaining, 4);

  return (
    <li className="relative">
      {/* Pile — the copies still available to add, peeking out the bottom as
          card-back edges. */}
      {Array.from({ length: pile }, (_, i) => (
        <div
          key={i}
          aria-hidden
          style={{ transform: `translateY(${(pile - i) * 4}px)`, backgroundColor: CARD_EDGE }}
          className="absolute inset-0 rounded-xl shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
        />
      ))}
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
        className={`relative block w-full cursor-pointer overflow-hidden rounded-xl ring-inset ${FOCUS_RING_INSET} ${
          maxed ? "cursor-not-allowed" : inDeck ? "ring-1 ring-accent/70" : "ring-1 ring-white/10"
        }`}
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
    </li>
  );
}

/** The centre pane's card grid. Column counts mirror the decks library grid so
    a card here renders at the same size as a deck tile there (same width column,
    same aspect). Each tile is a static card face; in-deck copies stack up as a
    pile behind it (the wider row gap leaves room for that pile to peek out). */
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
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 pb-4 md:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <CardTile key={card.cardId} card={card} {...handlers} />
      ))}
    </ul>
  );
}
