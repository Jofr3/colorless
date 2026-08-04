import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { CardImage } from "../../../components/CardImage";
import { AlertTriangleIcon, DecksIcon, InfoIcon } from "../../../components/icons";
import { useTiltJuice } from "../../../components/useTiltJuice";
import { cardImageUrl } from "../../../lib/api";
import { FOCUS_RING, FOCUS_RING_INSET, GLASS_GHOST_BUTTON } from "../../../lib/glass";
import type { BuilderCard } from "../cards";

// The pile cards peek out only their bottom edge, so — like the decks page's
// deck stacks — they're a flat "card-edge" blue matching the card back's inner
// border rather than the (darker-at-the-bottom) full back image.
const CARD_EDGE = "#28345a";

export interface CardGridProps {
  /** The tiles to show — every card the loaded pages hold. Nothing thins
      them client-side any more (D198 deleted the derived-kind filter), so
      `cards.length` IS the loaded count the caption pairs with `total`; the
      grid and the server's total answer the same query. */
  cards: BuilderCard[];
  /** Server-side match count, or null until the first page lands. */
  total: number | null;
  /** The first page is in flight (previous results keep showing meanwhile). */
  loading: boolean;
  /** A later page is in flight. */
  loadingMore: boolean;
  /** "initial" = nothing to show; "more" = the loaded pages still stand. */
  error: "initial" | "more" | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  /** Copies of a card currently in the deck. */
  countOf: (card: BuilderCard) => number;
  /** Copies still addable (0 = at the per-name cap). */
  remainingOf: (card: BuilderCard) => number;
  onAdd: (card: BuilderCard) => void;
  onRemove: (card: BuilderCard) => void;
  /** Open the rich single-card detail view for this card. */
  onInspect: (card: BuilderCard) => void;
  /** Suppress the pointer tilt while any drag is in flight. */
  dragActive?: boolean;
  /** Begin a drag of this card (to drop on the deck). */
  onDragStart?: (card: BuilderCard, event: ReactPointerEvent<HTMLElement>) => void;
  /** When this points at a card id with a new nonce, that tile shakes. */
  pulse?: { cardId: string; n: number } | null;
}

type TileHandlers = Pick<
  CardGridProps,
  | "countOf"
  | "remainingOf"
  | "onAdd"
  | "onRemove"
  | "onInspect"
  | "dragActive"
  | "onDragStart"
  | "pulse"
>;

function CardTile({
  card,
  countOf,
  remainingOf,
  onAdd,
  onRemove,
  onInspect,
  dragActive,
  onDragStart,
  pulse,
}: { card: BuilderCard } & TileHandlers) {
  const count = countOf(card);
  const inDeck = count > 0;
  const remaining = remainingOf(card);
  const maxed = remaining <= 0;
  // The gallery shows each card's remaining supply: a full pile of four behind
  // the top card by default, thinning as copies are drafted into the deck.
  const pile = Math.min(remaining, 4);
  // Balatro tilt + press juice on the top card, like the decks-page tiles.
  // Suppressed while a drag is in flight, and on maxed cards (which can't take
  // another copy, so they're not interactive).
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } =
    useTiltJuice<HTMLButtonElement>({
      disabled: dragActive || maxed,
      pulse: pulse && pulse.cardId === card.cardId ? pulse.n : null,
    });

  return (
    <li className="group relative transition-[z-index] motion-reduce:transition-none hover:z-10">
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
      {/* Outer layer carries the squash/wobble juice; the button beneath it
          carries the pointer tilt and is the full-cover add target. Click adds a
          copy; right-click removes one (the browser menu is suppressed). */}
      <div ref={juiceLayerRef} style={juiceStyle}>
        <button
          ref={tiltRef}
          type="button"
          {...handlers}
          // No press juice here: the copy-count `pulse` already shakes this tile
          // when the click adds a copy, so firing on pointerDown too would
          // double-shake (a press bounce on mouse-down, then the pulse on mouse-up).
          onPointerDown={(e) => {
            if (!maxed) onDragStart?.(card, e);
          }}
          style={tiltStyle}
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
            {/* Grid tiles are thumbnails — the "low" scan; no URL at all when
                the catalog has no scan, so the fallback tile shows instead of
                a request that would 404. */}
            <CardImage
              fill
              imageUrl={card.hasImage ? cardImageUrl(card.cardId, "low") : undefined}
              alt={card.name}
              className="h-full w-full object-cover"
            />
          </div>
        </button>
      </div>
      {/* Inspect affordance — a SIBLING of the add button (never nested; a
          button inside a button is invalid), floated in the corner above it so
          its click opens the detail view instead of adding a copy. Subtle by
          default, revealed on tile hover and on its own keyboard focus; the
          reveal fade is dropped under prefers-reduced-motion. */}
      <button
        type="button"
        aria-label={`View ${card.name} details`}
        onClick={() => onInspect(card)}
        className={`absolute right-1.5 top-1.5 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/80 opacity-0 ring-1 ring-inset ring-white/15 backdrop-blur-md transition-opacity hover:bg-black/65 hover:text-white focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none ${FOCUS_RING}`}
      >
        <InfoIcon className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Centred placeholder for the grid's empty-ish states — the same visual
    language as the decks page's empty library. */
function GridNotice({
  icon,
  children,
  action,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 pb-16 pt-32 text-center">
      {icon}
      <p className="text-sm font-medium text-white/55">{children}</p>
      {action}
    </div>
  );
}

/** The centre pane's card grid over the paginated catalog search. Column
    counts mirror the decks library grid so a card here renders at the same
    size as a deck tile there (same width column, same aspect). Each tile is a
    static card face; available copies stack up as a pile behind it (the wider
    row gap leaves room for that pile to peek out). Below the tiles: the
    "load more" footer for the next server page. */
export function CardGrid({
  cards,
  total,
  loading,
  loadingMore,
  error,
  hasMore,
  onLoadMore,
  onRetry,
  ...handlers
}: CardGridProps) {
  if (error === "initial") {
    return (
      <GridNotice
        icon={<AlertTriangleIcon className="h-6 w-6 text-white/20" />}
        action={
          <button
            type="button"
            onClick={onRetry}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${GLASS_GHOST_BUTTON}`}
          >
            Retry
          </button>
        }
      >
        Couldn't load the card catalog
      </GridNotice>
    );
  }

  if (cards.length === 0 && loading) {
    return (
      <GridNotice icon={<DecksIcon className="h-6 w-6 animate-pulse text-white/20" />}>
        Loading cards…
      </GridNotice>
    );
  }

  if (cards.length === 0 && !hasMore && error === null) {
    return (
      <GridNotice icon={<DecksIcon className="h-6 w-6 text-white/20" />}>
        No cards match these filters
      </GridNotice>
    );
  }

  return (
    <>
      {cards.length > 0 ? (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-6 pt-4 md:grid-cols-3 lg:grid-cols-5">
          {cards.map((card) => (
            <CardTile key={card.cardId} card={card} {...handlers} />
          ))}
        </ul>
      ) : (
        // The client-side kind filter hid everything the loaded pages held,
        // but the server has more — offer the next page, not a dead end.
        <GridNotice icon={<DecksIcon className="h-6 w-6 text-white/20" />}>
          No matching cards loaded yet
        </GridNotice>
      )}
      {(hasMore || error === "more") && (
        <div className="flex flex-col items-center gap-2 pb-6 pt-6">
          {error === "more" && (
            <p className="text-xs font-medium text-amber-200/80">Couldn't load more cards</p>
          )}
          <button
            type="button"
            onClick={error === "more" ? onRetry : onLoadMore}
            disabled={loadingMore}
            className={`rounded-full px-4 py-2 text-sm font-medium disabled:cursor-default disabled:opacity-60 ${GLASS_GHOST_BUTTON}`}
          >
            {loadingMore ? "Loading…" : error === "more" ? "Retry" : "Load more"}
          </button>
          {total !== null && (
            <p className="text-xs tabular-nums text-white/40">
              {cards.length} of {total} loaded
            </p>
          )}
        </div>
      )}
    </>
  );
}
