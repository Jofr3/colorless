import { CardImage } from "../../../components/CardImage";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ImageIcon,
  ImportExportIcon,
  TrashIcon,
  XIcon,
} from "../../../components/icons";
import { type PointerEvent as ReactPointerEvent, useMemo } from "react";
import { ScrollArea } from "../../../components/ScrollArea";
import { useTiltJuice } from "../../../components/useTiltJuice";
import { cardImageUrl } from "../../../lib/api";
import { ERROR_TEXT, FOCUS_RING, FOCUS_RING_INSET, GLASS_GHOST_BUTTON } from "../../../lib/glass";
import { useFlip } from "../../decks/useFlip";
import { type BuilderCard, ENERGY_TYPE_META, type Format, SUPERTYPES } from "../cards";
import {
  countsBySupertype,
  type Deck,
  type DeckValidation,
  pokemonTypeDistribution,
} from "../deckMath";
import type { SaveStatus } from "../deckSaver";

// The pile cards peek out only their bottom edge, so — like the decks page's
// deck stacks — they're a flat "card-edge" blue matching the card back's inner
// border rather than the (darker-at-the-bottom) full back image.
const CARD_EDGE = "#28345a";

export interface DeckPanelProps {
  deckName: string;
  onRename: (name: string) => void;
  /** Server-save lifecycle for the quiet indicator under the name ("idle"
      until the first edit). Visual only (aria-hidden) — the panel mounts
      twice (aside + drawer), so failures are announced once by the builder's
      own live region instead. */
  saveStatus?: "idle" | SaveStatus;
  /** The hydrated entries — cards the store already knows. */
  deck: Deck;
  /** Entries whose card is still being fetched (`unknown: false`, a pending
      shimmer) or that the catalog disowned (`unknown: true`, an unavailable
      tile with a remove control) — never silently DROPPED. */
  pending: { cardId: string; quantity: number; unknown: boolean }[];
  /** Copies across ALL entries, hydrated + pending — what the header shows
      (validation.total only counts hydrated cards). */
  total: number;
  validation: DeckValidation;
  format: Format;
  /** Copies still addable for a card (0 = at the cap). */
  remainingOf: (card: BuilderCard) => number;
  onAdd: (card: BuilderCard) => void;
  onRemove: (card: BuilderCard) => void;
  /** Remove a whole entry by id — the only affordance an entry whose card
      the catalog doesn't know can offer (no BuilderCard to route through
      onRemove). */
  onRemoveEntry: (cardId: string) => void;
  onClear: () => void;
  onImportExport: () => void;
  /** Open the cover picker (P5-6). Disabled while the deck holds no drawable
      card — there would be nothing to choose between. */
  onChooseCover: () => void;
  /** Suppress the pointer tilt while any drag is in flight. */
  dragActive?: boolean;
  /** Begin a drag of a deck card (to drop off the deck = remove a copy). */
  onDragStart?: (card: BuilderCard, event: ReactPointerEvent<HTMLElement>) => void;
  /** When this points at a card id with a new nonce, that tile shakes. */
  pulse?: { cardId: string; n: number } | null;
}

type Status = "legal" | "error" | "building";

const STATUS_COLOR: Record<Status, string> = {
  legal: "#5fcf80",
  error: "#ff5d73",
  building: "#cfcfda",
};

function deckStatus(validation: DeckValidation): Status {
  if (validation.legal) return "legal";
  if (validation.issues.some((i) => i.level === "error")) return "error";
  return "building";
}

/** A deck-view card tile rendered as a little pile, like the deck tiles on the
    decks page: the card face on top with a stack of cards peeking out the bottom
    — one per extra copy, capped at three (so four+ copies read the same). No
    hover UI: click adds a copy, right-click removes one. */
function DeckCardTile({
  card,
  quantity,
  canAdd,
  onAdd,
  onRemove,
  dragActive,
  onDragStart,
  pulse,
}: {
  card: BuilderCard;
  quantity: number;
  canAdd: boolean;
  onAdd: () => void;
  onRemove: () => void;
  /** Suppress the pointer tilt while any drag is in flight. */
  dragActive?: boolean;
  /** Begin a drag of this card (to drop off the deck = remove a copy). */
  onDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Shake when this changes to a non-null value (the copy count changed). */
  pulse?: number | null;
}) {
  const pile = Math.min(quantity - 1, 3);
  // Balatro tilt + press juice on the top card, like the decks-page tiles.
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } =
    useTiltJuice<HTMLButtonElement>({
      disabled: dragActive,
      pulse,
    });
  return (
    <li
      data-flip-id={card.cardId}
      className="relative transition-[z-index] motion-reduce:transition-none hover:z-10"
    >
      {/* Pile — one card-back edge per extra copy, peeking out the bottom; the
          back-most sits lowest. */}
      {Array.from({ length: pile }, (_, i) => (
        <div
          key={i}
          aria-hidden
          style={{ transform: `translateY(${(pile - i) * 4}px)`, backgroundColor: CARD_EDGE }}
          className="absolute inset-0 rounded-lg shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
        />
      ))}
      {/* Outer layer carries the juice; the button beneath carries the tilt.
          Click adds a copy; right-click removes one. Not disabled when maxed so
          you can still remove/drag (the add is guarded upstream). */}
      <div ref={juiceLayerRef} style={juiceStyle}>
        <button
          ref={tiltRef}
          type="button"
          {...handlers}
          // No press juice here: the copy-count `pulse` already shakes this tile
          // when the click adds a copy, so firing on pointerDown too would
          // double-shake (a press bounce on mouse-down, then the pulse on mouse-up).
          onPointerDown={(e) => onDragStart?.(e)}
          style={tiltStyle}
          aria-label={`Add one ${card.name}, ${quantity} in deck`}
          onClick={onAdd}
          onContextMenu={(e) => {
            e.preventDefault();
            onRemove();
          }}
          className={`relative block w-full overflow-hidden rounded-lg ring-1 ring-inset ring-accent/70 ${FOCUS_RING_INSET} ${
            canAdd ? "cursor-pointer" : "cursor-not-allowed"
          }`}
        >
          <div className="aspect-[2.5/3.5] w-full">
            {/* Same thumbnail quality as the gallery tiles — the panel's cells
                are even smaller; no URL when the catalog has no scan. */}
            <CardImage
              fill
              imageUrl={card.hasImage ? cardImageUrl(card.cardId, "low") : undefined}
              alt={card.name}
              className="h-full w-full object-cover"
            />
          </div>
        </button>
      </div>

      {/* Copy count — a dark glass pill nudged past the top-right corner so it
          overflows the card a little. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-black/70 px-1.5 text-xs font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-inset ring-white/20 backdrop-blur-md"
      >
        {quantity}
      </span>
    </li>
  );
}

/** The count pill both non-card tiles share (the hydrated tile keeps its own
    inline copy — it sits inside a different stacking context). */
function CountPill({ quantity }: { quantity: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-black/70 px-1.5 text-xs font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-inset ring-white/20 backdrop-blur-md"
    >
      {quantity}
    </span>
  );
}

/** A deck entry whose card is still hydrating from the catalog: a neutral
    card-shaped shimmer with the copy count. Deliberately inert — add/remove
    and drag need the card's identity rules, which arrive with the card. The
    entry itself is safe in storage meanwhile. */
function PendingCardTile({ cardId, quantity }: { cardId: string; quantity: number }) {
  return (
    <li data-flip-id={cardId} className="relative">
      <div
        role="img"
        aria-label="Loading card"
        className="aspect-[2.5/3.5] w-full animate-pulse rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/10"
      />
      <CountPill quantity={quantity} />
    </li>
  );
}

/** A deck entry the catalog doesn't know: not a hiccup, a verdict — no card
    will arrive, so instead of a shimmer it states the problem and offers the
    one action that makes sense, removing the entry. */
function UnknownCardTile({
  cardId,
  quantity,
  onRemove,
}: {
  cardId: string;
  quantity: number;
  onRemove: () => void;
}) {
  return (
    <li data-flip-id={cardId} className="relative">
      <div className="flex aspect-[2.5/3.5] w-full flex-col items-center justify-center gap-1.5 rounded-lg bg-white/[0.04] px-1.5 text-center ring-1 ring-inset ring-white/10">
        <AlertTriangleIcon className={`h-4 w-4 shrink-0 ${ERROR_TEXT}`} />
        <p className="text-[10px] font-medium leading-tight text-white/55">Not available</p>
        <button
          type="button"
          aria-label={`Remove unavailable card ${cardId}`}
          onClick={onRemove}
          className={`inline-flex cursor-pointer items-center gap-1 rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-medium text-white/70 ring-1 ring-inset ring-white/10 transition-colors motion-reduce:transition-none hover:bg-white/[0.1] hover:text-white ${FOCUS_RING}`}
        >
          <XIcon className="h-2.5 w-2.5" />
          Remove
        </button>
      </div>
      <CountPill quantity={quantity} />
    </li>
  );
}

/** Legality glyph shown next to the deck name: a green check when legal,
    otherwise an alert icon whose hover / keyboard-focus popup lists the
    outstanding issues. */
function DeckStatusBadge({ validation, format }: { validation: DeckValidation; format: Format }) {
  const color = STATUS_COLOR[deckStatus(validation)];
  const Icon = validation.legal ? CheckCircleIcon : AlertTriangleIcon;

  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={
          validation.legal
            ? `Legal ${format.name} deck`
            : `Deck issues: ${validation.issues.map((i) => i.message).join("; ")}`
        }
        className={`flex h-6 w-6 shrink-0 cursor-help items-center justify-center rounded-full transition-colors motion-reduce:transition-none hover:bg-white/10 ${FOCUS_RING}`}
        style={{ color }}
      >
        <Icon className="h-4 w-4" />
      </button>

      {/* Hover / keyboard-focus popup. Left-aligned so it opens rightward into
          the panel from the name-side badge instead of spilling past the edge. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 w-max max-w-[15rem] origin-top-left scale-95 rounded-lg bg-[#14141c]/95 p-2.5 text-xs opacity-0 shadow-[0_12px_40px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/10 backdrop-blur-xl transition motion-reduce:transition-none duration-150 group-hover:scale-100 group-hover:opacity-100 group-focus-within:scale-100 group-focus-within:opacity-100"
      >
        {validation.legal ? (
          <p className="flex items-center gap-1.5 font-medium text-[#7fe39c]">
            <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" />
            Legal {format.name} deck
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {validation.issues.map((issue) => (
              <li
                key={issue.message}
                className={`flex items-start gap-1.5 ${
                  issue.level === "error" ? ERROR_TEXT : "text-amber-300/80"
                }`}
              >
                <AlertTriangleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </span>
  );
}

/** Compact composition strip under the header: per-supertype copy counts and,
    when the deck holds typed Pokémon, a slim segmented bar of their energy
    types in the palette's colours (the same accents as the rail's pips).
    Only HYDRATED entries count in BOTH figures — a pending/unavailable entry
    has no card, so its supertype and types are unknown (the header's total
    still includes it). */
function DeckStats({ deck }: { deck: Deck }) {
  // Memoised on the deck: the panel re-renders for plenty of deck-neutral
  // reasons (name keystrokes, save status, drag state).
  const counts = useMemo(() => countsBySupertype(deck), [deck]);
  const distribution = useMemo(() => pokemonTypeDistribution(deck), [deck]);
  const typedTotal = distribution.reduce((sum, d) => sum + d.count, 0);
  return (
    <div className="flex flex-col gap-2 px-0.5">
      <dl className="flex items-center gap-3.5 text-xs text-white/50">
        {SUPERTYPES.map((supertype) => (
          <div key={supertype} className="flex items-baseline gap-1.5">
            <dt>{supertype}</dt>
            <dd className="font-semibold tabular-nums text-white/85">{counts[supertype]}</dd>
          </div>
        ))}
      </dl>
      {distribution.length > 0 && (
        <>
          {/* One segment per energy type, width ∝ copies. Purely visual —
              the sr-only line below is its text alternative. */}
          <div aria-hidden className="flex h-1.5 w-full gap-px overflow-hidden rounded-full">
            {distribution.map(({ type, count }) => (
              <span
                key={type}
                title={`${type} ${count}`}
                style={{
                  width: `${(count / typedTotal) * 100}%`,
                  backgroundColor: ENERGY_TYPE_META[type].color,
                }}
              />
            ))}
          </div>
          <p className="sr-only">
            Pokémon types: {distribution.map((d) => `${d.type} ${d.count}`).join(", ")}
          </p>
        </>
      )}
    </div>
  );
}

// Footer pill: the shared ghost paint (focus ring included) under panel-local
// layout.
const PANEL_BUTTON = `inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium ${GLASS_GHOST_BUTTON}`;
/** The footer's square icon actions (cover, clear) — same glass as PANEL_BUTTON
    without the label, and dimmed rather than hidden when they'd do nothing. */
const ICON_BUTTON = `inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/[0.05] text-white/65 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-all motion-reduce:transition-none hover:bg-white/[0.09] hover:text-white/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 ${FOCUS_RING}`;

/** The right pane: deck title, completeness, stats, validation, the grouped
    decklist, and the import/export + clear actions. */
export function DeckPanel({
  deckName,
  onRename,
  saveStatus = "idle",
  deck,
  pending,
  total,
  validation,
  format,
  remainingOf,
  onAdd,
  onRemove,
  onRemoveEntry,
  onClear,
  onImportExport,
  onChooseCover,
  dragActive,
  onDragStart,
  pulse,
}: DeckPanelProps) {
  const status = deckStatus(validation);
  const empty = deck.length === 0 && pending.length === 0;
  // Animate the grid reflow when cards are added/removed (decks-page FLIP).
  const deckFlipRef = useFlip<HTMLUListElement>(true);
  // Display order: grouped by card type (Pokémon → Trainer → Energy),
  // insertion order within a group. Memoised on the deck, like DeckStats.
  const grouped = useMemo(
    () => SUPERTYPES.flatMap((supertype) => deck.filter((e) => e.card.supertype === supertype)),
    [deck],
  );

  return (
    <div data-drop-zone="deck" className="flex h-full flex-col gap-3">
      {/* Header: a legality glyph leads the editable name; the card count sits on
          the right. No progress bar. */}
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* field-sizing:content shrink-wraps the input to the name text so the
              badge hugs its right edge; max-w-full lets long names truncate.
              maxLength mirrors the server's name cap (decks/requests.ts
              nameField: max 100) so typing can't outgrow what a PATCH accepts. */}
          <input
            value={deckName}
            onChange={(e) => onRename(e.target.value)}
            aria-label="Deck name"
            placeholder="Untitled Deck"
            maxLength={100}
            className={`min-w-0 max-w-full truncate rounded-md bg-transparent text-lg font-semibold text-white outline-none transition-colors motion-reduce:transition-none [field-sizing:content] placeholder:text-white/30 hover:bg-white/[0.04] focus:bg-white/[0.06] focus:ring-1 focus:ring-inset focus:ring-white/30 ${FOCUS_RING}`}
          />
          <DeckStatusBadge validation={validation} format={format} />
        </div>
        <span className="shrink-0 text-base font-bold leading-none tabular-nums">
          <span style={{ color: STATUS_COLOR[status] }}>{total}</span>
          <span className="text-white/40"> / {validation.deckSize}</span>
        </span>
      </div>

      {/* Quiet save word under the name — appears with the first edit and then
          just tracks the saver. Failures get their detail from the builder's
          live region; here it stays one calm line. */}
      {saveStatus !== "idle" && (
        <p aria-hidden className="-mt-2 px-0.5 text-[11px] leading-none text-white/35">
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "failed" && (
            <span className={ERROR_TEXT}>Couldn't save — retrying on your next change</span>
          )}
        </p>
      )}

      {/* Composition stats — hidden while nothing has hydrated (all-zero
          counts under the empty state would just be noise). */}
      {deck.length > 0 && <DeckStats deck={deck} />}

      {/* The decklist lives in a soft glass box, kept whether empty or full — a
          dashed border while empty, solid once it holds cards. */}
      <div
        className={`mb-2 flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/5 px-3 ${
          empty ? "border-dashed" : "border-solid"
        }`}
      >
        {empty ? (
          // Empty state: centred in the box's open space between header and footer.
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
            <p className="text-sm text-white/55">
              Click or drag cards
              <br />
              to add them to your deck
            </p>
          </div>
        ) : (
          // The grouped decklist scrolls inside the box. -mx-3 lets the mask reach
          // the box's rounded border (both 16px, so the corners line up) while px-3
          // keeps the cards inset. fadeTopOnScroll keeps the top row crisp and flush
          // at rest (no gap) and only feathers it in as it scrolls up under the top
          // edge; the bottom always feathers as the pile peeks out.
          <ScrollArea
            className="-mx-3 px-3 pb-2"
            fadeTop={36}
            fadeBottom={36}
            maskRadius={16}
            trackTop={20}
            fadeTopOnScroll
          >
            {/* One flat gallery, ordered by card type (Pokémon → Trainer → Energy)
                but without the per-type section headers. pt-3 matches the box's
                px-3 side inset (and clears the count pills poking above the top
                row); the roomy row gap and pb-3 leave space for those pills
                mid-list and the pile peeking out the bottom. */}
            <ul ref={deckFlipRef} className="grid grid-cols-3 gap-x-2 gap-y-5 pb-3 pt-3">
              {grouped.map(({ card, quantity }) => (
                <DeckCardTile
                  key={card.cardId}
                  card={card}
                  quantity={quantity}
                  canAdd={remainingOf(card) > 0}
                  onAdd={() => onAdd(card)}
                  onRemove={() => onRemove(card)}
                  dragActive={dragActive}
                  onDragStart={(e) => onDragStart?.(card, e)}
                  pulse={pulse && pulse.cardId === card.cardId ? pulse.n : null}
                />
              ))}
              {/* Entries still hydrating (or 404-known) trail the grouped
                  list — they can't be grouped by supertype without a card. */}
              {pending.map(({ cardId, quantity, unknown }) =>
                unknown ? (
                  <UnknownCardTile
                    key={cardId}
                    cardId={cardId}
                    quantity={quantity}
                    onRemove={() => onRemoveEntry(cardId)}
                  />
                ) : (
                  <PendingCardTile key={cardId} cardId={cardId} quantity={quantity} />
                ),
              )}
            </ul>
          </ScrollArea>
        )}
      </div>

      {/* Footer actions. */}
      <div className="flex shrink-0 items-center gap-2 pt-1">
        <button type="button" onClick={onImportExport} className={PANEL_BUTTON}>
          <ImportExportIcon className="h-4 w-4" />
          Import / Export
        </button>
        {/* The cover picker (P5-6) — only offered once a hydrated card could
            actually be picked; until then the derived default stands. */}
        <button
          type="button"
          onClick={onChooseCover}
          disabled={deck.length === 0}
          aria-label="Deck cover"
          className={ICON_BUTTON}
        >
          <ImageIcon className="h-4 w-4" />
        </button>
        {/* Enabled while ANY entry exists — pending/unavailable included, so
            a deck of only unavailable entries can still be cleared. */}
        <button
          type="button"
          onClick={onClear}
          disabled={empty}
          aria-label="Clear deck"
          className={ICON_BUTTON}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
