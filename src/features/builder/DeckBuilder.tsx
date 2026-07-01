import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { AppBackdrop } from "../../components/AppBackdrop";
import { HomeButton } from "../../components/HomeButton";
import { ArrowLeftIcon, DecksIcon, FilterIcon, SearchIcon, XIcon } from "../../components/icons";
import { ScrollArea } from "../../components/ScrollArea";
import { FOCUS_RING, FOCUS_RING_INSET, GLASS_GHOST_BUTTON } from "../../lib/glass";
import { readPersisted, writePersisted } from "../../lib/persistedState";
import { type BuilderCard, DEFAULT_FORMAT, formatById } from "./cards";
import { CARD_POOL } from "./cardPool";
import { CardGrid } from "./components/CardGrid";
import { FilterRail } from "./components/FilterRail";
import { DeckPanel } from "./components/DeckPanel";
import { ImportExportDialog } from "./components/ImportExportDialog";
import { type Deck, remainingAllowedFor, totalCount, validateDeck } from "./deckMath";
import { formatDecklist, parseDecklist } from "./decklistText";
import { DEFAULT_FILTERS, type Filters, filterPool, filtersActive } from "./poolFilter";
import { useCardDrag } from "./useCardDrag";

const POOL_BY_ID = new Map(CARD_POOL.map((c) => [c.cardId, c] as const));

/** Round icon button for the floating filter rail — mirrors the decks page. */
const FILTER_BUTTON_CLASS =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-2.5 ring-1 ring-inset backdrop-blur-md transition-all active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

/** Whether the floating filter panel starts expanded — persisted like /decks. */
const FILTER_OPEN_STORAGE_KEY = "builder.filterOpen";
const readStoredFilterOpen = () =>
  readPersisted(FILTER_OPEN_STORAGE_KEY, (raw) => raw === "1", false);

// --- Persistence -----------------------------------------------------------
// Each deck's contents live under its own key so the builder is a real editor
// across refreshes. Stored as the name, the chosen format, and ordered
// [cardId, quantity] pairs (order = the deck-list order).

interface StoredDeck {
  name: string;
  formatId: string;
  cards: [string, number][];
}

const storageKey = (deckId: string) => `builder.deck.${deckId}`;

function loadStored(deckId: string): StoredDeck | null {
  return readPersisted<StoredDeck | null>(
    storageKey(deckId),
    (raw) => {
      const data = JSON.parse(raw) as Partial<StoredDeck>;
      if (!data || !Array.isArray(data.cards)) return undefined;
      const cards = data.cards.filter(
        (pair): pair is [string, number] =>
          Array.isArray(pair) &&
          typeof pair[0] === "string" &&
          Number.isInteger(pair[1]) &&
          pair[1] > 0 &&
          POOL_BY_ID.has(pair[0]),
      );
      return {
        name: typeof data.name === "string" ? data.name : "Untitled Deck",
        formatId: typeof data.formatId === "string" ? data.formatId : DEFAULT_FORMAT.id,
        cards,
      };
    },
    null,
  );
}

/** Route entry: keys the editor on the deck id so navigating between two decks'
    editors (a future in-place link) fully remounts — fresh state, no chance of
    showing deck A while overwriting deck B's storage. */
export function DeckBuilder() {
  const { deckId = "draft" } = useParams();
  return <DeckBuilderInner key={deckId} deckId={deckId} />;
}

function DeckBuilderInner({ deckId }: { deckId: string }) {
  const location = useLocation();
  // A name handed over from the decks page (navigation state) seeds a brand-new
  // deck that has nothing stored yet.
  const seededName = (location.state as { name?: string } | null)?.name;

  // Initial state is read once, lazily, from storage (falling back to the seed).
  const [stored] = useState(() => loadStored(deckId));
  const [deckName, setDeckName] = useState(stored?.name ?? seededName ?? "Untitled Deck");
  const [formatId, setFormatId] = useState(stored?.formatId ?? DEFAULT_FORMAT.id);
  const [entries, setEntries] = useState<Map<string, number>>(
    () => new Map(stored?.cards ?? []),
  );
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Mobile drawers for the rail / deck panel (always-on columns at lg/xl).
  const [railOpen, setRailOpen] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  // The floating filter panel (≥1380px) collapses behind its button like
  // /decks; the open/closed choice persists across visits.
  const [filterOpen, setFilterOpen] = useState(readStoredFilterOpen);

  const format = formatById(formatId);

  // Persist on change, debounced so a burst of edits (e.g. typing the deck name)
  // coalesces into a single write instead of re-serialising the whole deck on
  // every keystroke. Best-effort — writePersisted swallows failures.
  useEffect(() => {
    const id = window.setTimeout(() => {
      writePersisted(
        storageKey(deckId),
        JSON.stringify({ name: deckName, formatId, cards: [...entries] } satisfies StoredDeck),
      );
    }, 300);
    return () => window.clearTimeout(id);
  }, [deckId, deckName, formatId, entries]);

  // Flush the pending write on unmount so navigating away inside the debounce
  // window doesn't drop the last edit. The ref tracks the current values so the
  // once-bound cleanup writes what's on screen at unmount, not stale state.
  const latestDeck = useRef({ deckId, deckName, formatId, entries });
  latestDeck.current = { deckId, deckName, formatId, entries };
  useEffect(
    () => () => {
      const deck = latestDeck.current;
      writePersisted(
        storageKey(deck.deckId),
        JSON.stringify({
          name: deck.deckName,
          formatId: deck.formatId,
          cards: [...deck.entries],
        } satisfies StoredDeck),
      );
    },
    [],
  );

  // Tab title reflects the deck being edited.
  useEffect(() => {
    document.title = `${deckName || "Untitled Deck"} · Luminous`;
  }, [deckName]);

  useEffect(() => {
    writePersisted(FILTER_OPEN_STORAGE_KEY, filterOpen ? "1" : "0");
  }, [filterOpen]);

  // Derived deck (ordered DeckEntry[]), built from the entry map + pool lookup.
  const deck: Deck = useMemo(() => {
    const list: Deck = [];
    for (const [cardId, quantity] of entries) {
      const card = POOL_BY_ID.get(cardId);
      if (card) list.push({ card, quantity });
    }
    return list;
  }, [entries]);

  const validation = useMemo(() => validateDeck(deck, format), [deck, format]);
  const total = totalCount(deck);

  // One pass over the deck builds the add-cap function for every pool card
  // (per-name limit, ACE SPEC ≤ 1 total, basic Energy unlimited).
  const remainingOf = useMemo(() => remainingAllowedFor(deck, format), [deck, format]);
  const countOf = (card: BuilderCard) => entries.get(card.cardId) ?? 0;

  const filtered = useMemo(
    () => filterPool(CARD_POOL, filters, format.legalRegulationMarks),
    [filters, format],
  );

  // Screen-reader feedback for add/remove (the visual count badge isn't read).
  const [announcement, setAnnouncement] = useState("");
  const announce = (verb: string, card: BuilderCard, nextTotal: number) =>
    setAnnouncement(`${verb} ${card.name}. Deck ${nextTotal} of ${format.deckSize}.`);

  // Shake both the gallery and deck tiles for a card whenever its copy count
  // changes. Keyed by id with an incrementing nonce so repeated add/removes of
  // the same card retrigger the juice.
  const [pulse, setPulse] = useState<{ cardId: string; n: number } | null>(null);
  const pulseCard = (card: BuilderCard) =>
    setPulse((p) => ({ cardId: card.cardId, n: (p?.n ?? 0) + 1 }));

  // --- Mutations -----------------------------------------------------------
  const addCard = (card: BuilderCard) => {
    if (remainingOf(card) <= 0) return;
    announce("Added", card, total + 1);
    setEntries((prev) => {
      const next = new Map(prev);
      next.set(card.cardId, (next.get(card.cardId) ?? 0) + 1);
      return next;
    });
    pulseCard(card);
  };

  const removeCard = (card: BuilderCard) => {
    if ((entries.get(card.cardId) ?? 0) <= 0) return;
    announce("Removed", card, total - 1);
    setEntries((prev) => {
      const next = new Map(prev);
      const q = (next.get(card.cardId) ?? 0) - 1;
      if (q <= 0) next.delete(card.cardId);
      else next.set(card.cardId, q);
      return next;
    });
    pulseCard(card);
  };

  const clearDeck = () => {
    setEntries(new Map());
    setAnnouncement("Deck cleared.");
  };

  const importText = (text: string) => {
    const { entries: parsed, unmatched } = parseDecklist(text, CARD_POOL);
    setEntries(new Map(parsed.map((e) => [e.card.cardId, e.quantity])));
    const imported = parsed.reduce((sum, e) => sum + e.quantity, 0);
    setAnnouncement(`Imported deck — ${imported} ${imported === 1 ? "card" : "cards"}.`);
    return unmatched;
  };

  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  // Accent dot on the filter button when the panel holds non-default choices.
  // The search query lives in the header, not the panel, so it doesn't count.
  const filterActive = filtersActive({ ...filters, query: "" });

  // Drag a card between the gallery and the deck: drop a gallery card on the
  // deck to add a copy, drag a deck card off the deck to remove one.
  const { dragging, startDrag } = useCardDrag({
    onAddToDeck: addCard,
    onRemoveFromDeck: removeCard,
  });

  const railProps = {
    filters,
    onChange: setFilters,
    format,
    onFormatChange: setFormatId,
    onReset: resetFilters,
  };

  const deckPanelProps = {
    deckName,
    onRename: setDeckName,
    deck,
    validation,
    format,
    remainingOf,
    onAdd: addCard,
    onRemove: removeCard,
    onClear: clearDeck,
    onImportExport: () => setDialogOpen(true),
    dragActive: dragging,
    onDragStart: (card: BuilderCard, e: ReactPointerEvent<HTMLElement>) =>
      startDrag({ card, source: "deck" }, e),
    pulse,
  };

  return (
    <AppBackdrop>
      <HomeButton />
      {/* Back-to-decks pill, mirroring the fixed home button in the opposite
          corner. pt-16 below clears both. */}
      <Link
        to="/decks"
        className={`group fixed left-3 top-3 z-50 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium ${GLASS_GHOST_BUTTON}`}
      >
        <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        Decks
      </Link>

      {/* The card gallery is the centred max-w-4xl column — same width as the
          decks page. The filter rail and deck panel are lifted out of flow,
          pinned just left and right of it, so the gallery itself stays the
          clean centred column. They fall back to slide-over drawers once the
          side margins get too tight to hold them. */}
      <div className="relative mx-auto flex h-svh w-full max-w-4xl flex-col gap-3 px-6 pt-16">
        <h1 className="sr-only">Deck builder — {deckName}</h1>

        {/* Filter rail — a toggle button and, when open, the panel beneath it,
            mirroring /decks. Pinned just left of the column from 1380px up
            (right-full + -mr-2 — the same spacing as the decks page); a drawer
            below. */}
        <aside
          aria-label="Filters"
          className="absolute right-full top-16 -mr-2 hidden w-56 flex-col gap-4 min-[1380px]:flex"
        >
          <button
            type="button"
            aria-label="Filters"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
            className={`self-end ${FILTER_BUTTON_CLASS} ${
              filterOpen || filterActive
                ? "bg-white/[0.09] text-white ring-white/25"
                : "bg-white/[0.045] text-white/70 ring-white/10 hover:bg-white/[0.08] hover:text-white/90"
            }`}
          >
            <FilterIcon className="h-5 w-5" />
            {filterActive && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-bg"
              />
            )}
          </button>
          {filterOpen && <FilterRail {...railProps} />}
        </aside>

        {/* Deck panel — pinned just right of the column from 1600px up; the
            wider panel needs more margin than the filter rail, so it drops to a
            drawer earlier. */}
        <aside
          aria-label="Your deck"
          className="absolute bottom-4 left-full top-16 ml-2 hidden w-80 flex-col min-[1600px]:flex"
        >
          <DeckPanel {...deckPanelProps} />
        </aside>

        {/* Centre: search header + the card grid. Also the "gallery" drop zone —
            dragging a deck card here removes a copy. No flex gap: the scroll area
            starts right under the search bar (like /decks) and the gap lives
            inside it as the grid's top padding, so it doubles as tilt clip room. */}
        <main data-drop-zone="gallery" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type="search"
                value={filters.query}
                onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                placeholder="Search cards"
                aria-label="Search cards"
                className="w-full rounded-full bg-white/[0.045] py-2.5 pl-10 pr-4 text-sm text-white/90 placeholder:text-white/50 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              />
            </div>
            {/* Filters toggle — only below xl, where the rail is a drawer. */}
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              aria-label="Filters"
              className={`inline-flex shrink-0 items-center justify-center rounded-full p-2.5 ring-1 ring-inset bg-white/[0.045] text-white/70 ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.08] hover:text-white/90 active:scale-95 min-[1380px]:hidden ${FOCUS_RING}`}
            >
              <FilterIcon className="h-5 w-5" />
            </button>
            {/* Deck toggle — only below lg, where the deck panel is a drawer. */}
            <button
              type="button"
              onClick={() => setDeckOpen(true)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2.5 text-sm font-semibold ring-1 ring-inset bg-white/[0.045] text-white/80 ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.08] hover:text-white active:scale-95 min-[1600px]:hidden ${FOCUS_RING}`}
            >
              <DecksIcon className="h-4 w-4" />
              <span className="tabular-nums">{total}</span>
            </button>
          </div>

          {/* -mx-3/px-3 keep the cells aligned to the column edge while giving
              the hover tilt/scale horizontal clip room. The edge mask is a
              fragment shader (see scrollFadeMask): it feathers the top edge so
              rows dissolve to transparent under the search bar instead of
              hard-cutting, and rounds the corners so the scroll box never clips on
              a sharp 90°. No bottom feather — the gallery should read as full to
              the bottom, not fading into empty space. */}
          <ScrollArea className="-mx-3 px-3" fadeTop={36} maskRadius={16} trackTop={16}>
            <CardGrid
              cards={filtered}
              countOf={countOf}
              remainingOf={remainingOf}
              onAdd={addCard}
              onRemove={removeCard}
              dragActive={dragging}
              onDragStart={(card, e) => startDrag({ card, source: "gallery" }, e)}
              pulse={pulse}
            />
          </ScrollArea>
        </main>
      </div>

      {/* Mobile drawers — native <dialog>s, rendered always and toggled by
          `open` so the browser handles focus + Escape. */}
      <Drawer open={railOpen} side="left" title="Filters" onClose={() => setRailOpen(false)}>
        <FilterRail {...railProps} />
      </Drawer>
      <Drawer open={deckOpen} side="right" title="Your deck" onClose={() => setDeckOpen(false)} fill>
        <DeckPanel {...deckPanelProps} />
      </Drawer>

      <ImportExportDialog
        open={dialogOpen}
        deckText={formatDecklist(deck)}
        onImport={importText}
        onClose={() => setDialogOpen(false)}
      />

      {/* Polite live region so screen readers hear each add/remove. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </AppBackdrop>
  );
}

/** Slide-over used for the rail / deck on narrow screens. A native `<dialog>`
    driven by `open` (like {@link ImportExportDialog}) so it gets focus move-in,
    focus trapping, Escape and focus restoration for free. `fill` lets the child
    (the deck panel) stretch to the drawer's full height. */
function Drawer({
  open,
  side,
  title,
  onClose,
  children,
  fill = false,
}: {
  open: boolean;
  side: "left" | "right";
  title: string;
  onClose: () => void;
  children: ReactNode;
  fill?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the native <dialog> handles Escape; this onClick only adds backdrop click-to-dismiss for pointer users.
    <dialog
      ref={dialogRef}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className={`m-0 h-dvh max-h-dvh w-[19rem] max-w-[85vw] border-0 bg-transparent p-0 text-white [&::backdrop]:bg-black/60 [&::backdrop]:backdrop-blur-sm ${
        side === "left" ? "mr-auto" : "ml-auto"
      }`}
    >
      <div className="flex h-full w-full flex-col gap-3 overflow-hidden bg-[#14141c]/95 p-4 pt-5 shadow-[0_24px_70px_rgba(0,0,0,0.55)] ring-1 ring-inset ring-white/10 backdrop-blur-xl">
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white ${FOCUS_RING_INSET}`}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        {fill ? (
          <div className="min-h-0 flex-1">{children}</div>
        ) : (
          <ScrollArea className="pr-1">{children}</ScrollArea>
        )}
      </div>
    </dialog>
  );
}
