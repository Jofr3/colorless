import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
import { DEFAULT_FILTERS, type Filters, filterPool } from "./poolFilter";

const POOL_BY_ID = new Map(CARD_POOL.map((c) => [c.cardId, c] as const));

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
          typeof pair[1] === "number" &&
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

  const format = formatById(formatId);

  // Persist on every change. Best-effort (writePersisted swallows failures).
  useEffect(() => {
    writePersisted(
      storageKey(deckId),
      JSON.stringify({ name: deckName, formatId, cards: [...entries] } satisfies StoredDeck),
    );
  }, [deckId, deckName, formatId, entries]);

  // Tab title reflects the deck being edited.
  useEffect(() => {
    document.title = `${deckName || "Untitled Deck"} · Luminous`;
  }, [deckName]);

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

  // --- Mutations -----------------------------------------------------------
  const addCard = (card: BuilderCard) => {
    if (remainingOf(card) <= 0) return;
    announce("Added", card, total + 1);
    setEntries((prev) => {
      const next = new Map(prev);
      next.set(card.cardId, (next.get(card.cardId) ?? 0) + 1);
      return next;
    });
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

      <div className="mx-auto flex h-svh w-full max-w-[1700px] gap-4 px-4 pb-4 pt-16">
        <h1 className="sr-only">Deck builder — {deckName}</h1>

        {/* Left rail — static column at xl, a drawer below. */}
        <aside className="hidden w-56 shrink-0 xl:block">
          <ScrollArea className="pr-1">
            <FilterRail {...railProps} />
          </ScrollArea>
        </aside>

        {/* Centre: search header + the card grid. */}
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type="search"
                value={filters.query}
                onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                placeholder="Search cards"
                aria-label="Search cards"
                className="w-full rounded-full bg-white/[0.045] py-2.5 pl-10 pr-4 text-sm text-white/90 placeholder:text-white/35 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              />
            </div>
            {/* Filters toggle — only below xl, where the rail is a drawer. */}
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              aria-label="Filters"
              className={`inline-flex shrink-0 items-center justify-center rounded-full p-2.5 ring-1 ring-inset bg-white/[0.045] text-white/70 ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.08] hover:text-white/90 active:scale-95 xl:hidden ${FOCUS_RING}`}
            >
              <FilterIcon className="h-5 w-5" />
            </button>
            {/* Deck toggle — only below lg, where the deck panel is a drawer. */}
            <button
              type="button"
              onClick={() => setDeckOpen(true)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2.5 text-sm font-semibold ring-1 ring-inset bg-white/[0.045] text-white/80 ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.08] hover:text-white active:scale-95 lg:hidden ${FOCUS_RING}`}
            >
              <DecksIcon className="h-4 w-4" />
              <span className="tabular-nums">{total}</span>
            </button>
          </div>

          <div className="flex items-center justify-between px-0.5 text-xs text-white/55">
            <span>{filtered.length} cards</span>
            <span className="hidden sm:inline">Click to add · right-click to remove</span>
          </div>

          <ScrollArea className="-mr-1 pr-1">
            <CardGrid
              cards={filtered}
              countOf={countOf}
              remainingOf={remainingOf}
              onAdd={addCard}
              onRemove={removeCard}
            />
          </ScrollArea>
        </main>

        {/* Right deck panel — static column at lg, a drawer below. */}
        <aside className="hidden w-80 shrink-0 lg:flex lg:flex-col 2xl:w-96">
          <DeckPanel {...deckPanelProps} />
        </aside>
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
