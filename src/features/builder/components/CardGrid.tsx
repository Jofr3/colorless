import { CardImage } from "../../../components/CardImage";
import { DecksIcon, MinusIcon, PlusIcon } from "../../../components/icons";
import { FOCUS_RING_INSET } from "../../../lib/glass";
import { type BuilderCard, cardImageUrl, ENERGY_TYPE_META } from "../cards";
import { cardSetLabel } from "../decklistText";

export interface CardGridProps {
  cards: BuilderCard[];
  /** Copies of a card currently in the deck. */
  countOf: (card: BuilderCard) => number;
  /** Copies still addable (0 = at the per-name cap). */
  remainingOf: (card: BuilderCard) => number;
  onAdd: (card: BuilderCard) => void;
  onRemove: (card: BuilderCard) => void;
}

/** A single energy-type dot, for the type strip on a Pokémon tile. */
function TypeDot({ type }: { type: keyof typeof ENERGY_TYPE_META }) {
  const meta = ENERGY_TYPE_META[type];
  return (
    <span
      title={meta.type}
      className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/30"
      style={{ backgroundColor: meta.color }}
    />
  );
}

function CardTile({ card, countOf, remainingOf, onAdd, onRemove }: { card: BuilderCard } & Omit<CardGridProps, "cards">) {
  const count = countOf(card);
  const inDeck = count > 0;
  const maxed = remainingOf(card) <= 0;

  return (
    <li className="group relative">
      {/* Add target: a full-cover button behind the overlays. Right-click removes
          one (with the browser menu suppressed) so the mouse alone can add and
          subtract without travelling to the stepper. */}
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
        className={`relative block w-full cursor-pointer overflow-hidden rounded-xl ring-1 ring-inset transition duration-150 ${FOCUS_RING_INSET} ${
          inDeck ? "ring-accent/70" : "ring-white/10 hover:ring-white/25"
        } ${maxed ? "cursor-not-allowed" : ""}`}
      >
        <div className={`aspect-[2.5/3.5] w-full transition ${maxed ? "opacity-45 saturate-[0.7]" : ""}`}>
          <CardImage
            fill
            imageUrl={cardImageUrl(card.cardId)}
            alt={card.name}
            className="h-full w-full object-cover"
          />
        </div>

        {/* Caption on hover/focus: name + set + type dots, on a bottom scrim. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pb-1.5 pt-6 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <span className="flex items-center gap-1">
            {card.types?.map((t) => (
              <TypeDot key={t} type={t} />
            ))}
            {card.hp ? <span className="ml-auto text-[10px] font-semibold text-white/70">{card.hp} HP</span> : null}
          </span>
          <span className="truncate text-[11px] font-semibold leading-tight text-white drop-shadow">
            {card.name}
          </span>
          <span className="truncate text-[10px] leading-tight text-white/55">{cardSetLabel(card)}</span>
        </span>
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

      {/* Count badge — copies in the deck. Sits above the add button. */}
      {inDeck && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1.5 top-1.5 z-10 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-zinc-950 shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-2 ring-[#0e0e14]"
        >
          {count}
        </span>
      )}

      {/* Hover stepper, top-right — explicit +/- for touch and discoverability. */}
      <div className="absolute right-1.5 top-1.5 z-10 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        {inDeck && (
          <button
            type="button"
            aria-label={`Remove one ${card.name}`}
            onClick={() => onRemove(card)}
            className={`flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/85 ring-1 ring-inset ring-white/15 backdrop-blur-md transition-colors hover:bg-black/80 hover:text-white ${FOCUS_RING_INSET}`}
          >
            <MinusIcon className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label={`Add one ${card.name}`}
          disabled={maxed}
          onClick={() => onAdd(card)}
          className={`flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/85 ring-1 ring-inset ring-white/15 backdrop-blur-md transition-colors hover:bg-black/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING_INSET}`}
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </div>
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
