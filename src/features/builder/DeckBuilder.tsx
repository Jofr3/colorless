import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  type Deck as ApiDeck,
  MAX_DECK_CARD_ENTRIES,
  type PatchDeckRequest,
} from "@luminous/schema";
import { AppBackdrop } from "../../components/AppBackdrop";
import { HomeButton } from "../../components/HomeButton";
import { ArrowLeftIcon, DecksIcon, FilterIcon, SearchIcon, XIcon } from "../../components/icons";
import { ScrollArea } from "../../components/ScrollArea";
import { StatusPanel, StatusSpinner } from "../../components/StatusPanel";
import { ApiError, getDeck, patchDeck, unknownCardIdsOf } from "../../lib/api";
import {
  BACK_ARROW_ICON,
  FOCUS_RING,
  GHOST_ICON_BUTTON,
  GLASS_ACCENT_BUTTON,
  GLASS_FILTER_TOGGLE,
  GLASS_GHOST_BUTTON,
  GLASS_INPUT,
} from "../../lib/glass";
import { readPersisted, writePersisted } from "../../lib/persistedState";
import { useAuth } from "../auth/AuthProvider";
import { type BuilderCard, DEFAULT_FORMAT, formatById } from "./cards";
import { useCardHydration, useCardStore } from "./cardStore";
import { importDecklist } from "./catalog";
import { useCatalogOptions } from "./catalogOptions";
import type { SaveStatus } from "./deckSaver";
import { type DeckSnapshot, toSnapshot } from "./deckSnapshot";
import { useDeckSaver } from "./useDeckSaver";
import { CardDetailDialog } from "./components/CardDetailDialog";
import { CardGrid } from "./components/CardGrid";
import { CoverDialog } from "./components/CoverDialog";
import { FilterRail } from "./components/FilterRail";
import { DeckPanel } from "./components/DeckPanel";
import { ImportExportDialog } from "./components/ImportExportDialog";
import { type Deck, MAX_COPIES_PER_ENTRY, remainingAllowedFor, validateDeck } from "./deckMath";
import { formatDecklist, type UnmatchedLine } from "./decklistText";
import { DEFAULT_FILTERS, type Filters, filtersActive } from "./poolFilter";
import { useCardDrag } from "./useCardDrag";
import { useCardSearch } from "./useCardSearch";

/** Whether the floating filter panel starts expanded — persisted like /decks. */
const FILTER_OPEN_STORAGE_KEY = "builder.filterOpen";
const readStoredFilterOpen = () =>
  readPersisted(FILTER_OPEN_STORAGE_KEY, (raw) => raw === "1", false);

// --- Persistence -----------------------------------------------------------
// The deck lives on the server (M9): the route entry below loads it with
// GET /decks/:id, and every edit schedules a debounced PATCH through the
// deckSaver (see ./deckSaver.ts for the timing/ordering rules). The old
// per-deck localStorage store (`builder.deck.<id>`) is gone; only the
// filter-panel preference below still uses localStorage.

/** The server card list as the editor's entries Map. The wire list is
    UNORDERED, so it's sorted by cardId first — a deterministic panel order
    across loads (the panel groups by supertype at render time anyway). */
function initialEntries(deck: ApiDeck): Map<string, number> {
  return new Map(
    [...deck.cards]
      .sort((a, b) => a.cardId.localeCompare(b.cardId))
      .map((card) => [card.cardId, card.count] as const),
  );
}

// Back-to-decks pill, mirroring the fixed home button in the opposite corner.
const BACK_PILL_CLASS = `group fixed left-3 top-3 z-50 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium ${GLASS_GHOST_BUTTON}`;

const STATUS_BUTTON_CLASS = `inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold ${GLASS_ACCENT_BUTTON}`;

/** Chrome for the builder's non-editor states (loading, signed out, missing
    deck, load failure): backdrop, home + back pills, and a centred column. */
function BuilderScreen({ children }: { children: ReactNode }) {
  return (
    <AppBackdrop>
      <HomeButton />
      <Link to="/decks" className={BACK_PILL_CLASS}>
        <ArrowLeftIcon className={BACK_ARROW_ICON} />
        Decks
      </Link>
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-16">
        {children}
      </main>
    </AppBackdrop>
  );
}

/** Route entry: resolves the session and loads the deck from the api, then
    keys the editor on the deck id so navigating between two decks' editors
    fully remounts — fresh state, no chance of showing deck A while PATCHing
    deck B. */
export function DeckBuilder() {
  const { deckId = "" } = useParams();
  const { status } = useAuth();
  const location = useLocation();
  const [load, setLoad] = useState<
    | { phase: "loading" }
    | { phase: "notfound" }
    | { phase: "error" }
    | { phase: "ready"; deck: ApiDeck }
  >({ phase: "loading" });
  // Bumped by the error panel's Retry to re-run the load effect.
  const [loadNonce, setLoadNonce] = useState(0);

  useEffect(() => {
    // loadNonce has no value of its own — reading it here is what lets the
    // error panel's Retry re-run this effect.
    void loadNonce;
    if (status !== "authenticated") return;
    let cancelled = false;
    setLoad({ phase: "loading" });
    getDeck(deckId).then(
      (deck) => {
        if (!cancelled) setLoad({ phase: "ready", deck });
      },
      (error: unknown) => {
        if (cancelled) return;
        // 404 = not mine / doesn't exist. Session expiry needs no branch:
        // the api client re-probes on an unexpected 401 (retrying once when
        // it was a one-off), and a really-dead session flips the whole app —
        // and this page — to signed-out via AuthProvider.
        if (error instanceof ApiError && error.status === 404) {
          setLoad({ phase: "notfound" });
          return;
        }
        setLoad({ phase: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deckId, status, loadNonce]);

  if (status === "anonymous") {
    return (
      <BuilderScreen>
        <h1 className="sr-only">Deck builder</h1>
        <StatusPanel
          icon={<DecksIcon className="h-7 w-7 text-white/25" />}
          title="Sign in to edit this deck"
          description="Your decks live with your account."
          action={
            <Link to="/login" state={{ from: location.pathname }} className={STATUS_BUTTON_CLASS}>
              Sign in
            </Link>
          }
        />
      </BuilderScreen>
    );
  }

  if (status === "loading" || load.phase === "loading") {
    return (
      <BuilderScreen>
        <h1 className="sr-only">Deck builder</h1>
        <StatusSpinner label="Loading deck" />
      </BuilderScreen>
    );
  }

  if (load.phase === "notfound") {
    return (
      <BuilderScreen>
        <h1 className="sr-only">Deck builder</h1>
        <StatusPanel
          icon={<DecksIcon className="h-7 w-7 text-white/25" />}
          title="Deck not found"
          description="It may have been deleted, or the link isn't yours."
          action={
            <Link to="/decks" className={STATUS_BUTTON_CLASS}>
              Back to decks
            </Link>
          }
        />
      </BuilderScreen>
    );
  }

  if (load.phase === "error") {
    return (
      <BuilderScreen>
        <h1 className="sr-only">Deck builder</h1>
        <StatusPanel
          icon={<DecksIcon className="h-7 w-7 text-white/25" />}
          title="Couldn't load this deck"
          description="Check your connection and try again."
          action={
            <button
              type="button"
              onClick={() => setLoadNonce((nonce) => nonce + 1)}
              className={STATUS_BUTTON_CLASS}
            >
              Retry
            </button>
          }
        />
      </BuilderScreen>
    );
  }

  return <DeckBuilderInner key={deckId} deckId={deckId} initial={load.deck} />;
}

function DeckBuilderInner({ deckId, initial }: { deckId: string; initial: ApiDeck }) {
  const [deckName, setDeckName] = useState(initial.name);
  const [formatId, setFormatId] = useState(initial.format ?? DEFAULT_FORMAT.id);
  const [entries, setEntries] = useState<Map<string, number>>(() => initialEntries(initial));
  // The owner's cover pick (P5-6), null for the derived default. Local state
  // like the rest of the editor — the debounced saver carries it to the server.
  const [chosenCover, setChosenCover] = useState<string | null>(initial.chosenCoverCardId);
  // The saver's no-op seed: the state this editor mounted with, computed once
  // (a lazy initializer, reusing the just-built entries Map) instead of
  // re-sorted on every render. `initial` never changes for a mounted editor —
  // the route entry keys this component on the deck id.
  const [initialSnapshot] = useState(() =>
    toSnapshot(
      initial.name,
      initial.format ?? DEFAULT_FORMAT.id,
      entries,
      initial.chosenCoverCardId,
    ),
  );
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  // The card whose detail view is open. Kept set through the close (only the
  // `detailOpen` toggle drives visibility) so the modal's content doesn't blank
  // out on the way out.
  const [inspecting, setInspecting] = useState<BuilderCard | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // Mobile drawers for the rail / deck panel (always-on columns at lg/xl).
  const [railOpen, setRailOpen] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  // The floating filter panel (≥1380px) collapses behind its button like
  // /decks; the open/closed choice persists across visits.
  const [filterOpen, setFilterOpen] = useState(readStoredFilterOpen);

  const format = formatById(formatId);

  // Screen-reader feedback for add/remove and save failures (declared before
  // the saver below so its first-render closure can capture the setter).
  const [announcement, setAnnouncement] = useState("");
  const announce = (verb: string, card: BuilderCard, nextTotal: number) =>
    setAnnouncement(`${verb} ${card.name}. Deck ${nextTotal} of ${format.deckSize}.`);

  // The quiet save indicator next to the deck name ("idle" until the first
  // edit; failures are ALSO announced through the aria-live region above —
  // the visual indicator is aria-hidden since DeckPanel mounts twice).
  const [saveStatus, setSaveStatus] = useState<"idle" | SaveStatus>("idle");

  const handleSaveStatus = (status: SaveStatus, error?: unknown) => {
    setSaveStatus(status);
    if (status !== "failed") return;
    // Session expiry needs no branch here: the api client re-probes on an
    // unexpected 401 (retrying the PATCH once when it was a one-off), and a
    // really-dead session flips this page to signed-out via AuthProvider.
    const cardIds =
      error instanceof ApiError && error.status === 400 ? unknownCardIdsOf(error.body) : null;
    setAnnouncement(
      cardIds
        ? "Couldn't save — the catalog doesn't recognise some cards in this deck."
        : "Couldn't save your deck — changes stay here and retry on your next edit.",
    );
  };

  // One saver per editor mount (the route entry keys this component on the
  // deck id; useDeckSaver keeps it alive across StrictMode's dev
  // double-mount). Seeded with the loaded state so the mount-time run of the
  // schedule effect below is a recognised no-op, not a save.
  const scheduleSave = useDeckSaver<DeckSnapshot>({
    initial: initialSnapshot,
    save: (snapshot) => {
      // format + cards are always present, so the PATCH is never empty; an
      // all-whitespace name is omitted rather than sent (the server rejects
      // empty names) — it stays a local draft nicety until something is typed.
      const body: PatchDeckRequest = {
        format: snapshot.format,
        cards: snapshot.cards,
        chosenCoverCardId: snapshot.chosenCoverCardId,
        ...(snapshot.name === "" ? {} : { name: snapshot.name }),
      };
      return patchDeck(deckId, body);
    },
    onStatus: handleSaveStatus,
  });

  // Every edit (name, format, cards, cover) reschedules the debounced PATCH;
  // the saver coalesces bursts, serializes flights, and skips no-ops. The hook
  // flushes the pending save on unmount.
  useEffect(() => {
    scheduleSave(toSnapshot(deckName, formatId, entries, chosenCover));
  }, [scheduleSave, deckName, formatId, entries, chosenCover]);

  // Tab title reflects the deck being edited.
  useEffect(() => {
    document.title = `${deckName || "Untitled Deck"} · Luminous`;
  }, [deckName]);

  useEffect(() => {
    writePersisted(FILTER_OPEN_STORAGE_KEY, filterOpen ? "1" : "0");
  }, [filterOpen]);

  // The by-id card store every fetched card lands in (grid pages, decklist
  // imports, batched hydrations) — the deck's entries resolve against it, so
  // the deck no longer depends on which page the grid happens to show.
  const store = useCardStore();
  // Entry ids the store doesn't know yet hydrate via one batched GET /cards.
  useCardHydration(entries, store);
  // The rail's option vocabularies (facets + sets + series), session-cached.
  const catalogOptions = useCatalogOptions();

  // Derived deck (ordered DeckEntry[]) of the HYDRATED entries; the rest
  // render as pending tiles in the panel instead of being dropped.
  const deck: Deck = useMemo(() => {
    const list: Deck = [];
    for (const [cardId, quantity] of entries) {
      const card = store.byId.get(cardId);
      if (card) list.push({ card, quantity });
    }
    return list;
  }, [entries, store.byId]);

  // Entries the store can't render yet: still hydrating (`unknown: false`) or
  // disowned by the catalog (`unknown: true` — the panel shows an unavailable
  // tile with a remove control so the entry isn't a dead end).
  const pendingEntries = useMemo(
    () =>
      [...entries]
        .filter(([cardId]) => !store.byId.has(cardId))
        .map(([cardId, quantity]) => ({ cardId, quantity, unknown: store.unknown.has(cardId) })),
    [entries, store.byId, store.unknown],
  );

  // Validation runs over the hydrated cards; the header count spans ALL
  // entries so it doesn't jump while cards hydrate.
  const validation = useMemo(() => validateDeck(deck, format), [deck, format]);
  const total = useMemo(
    () => [...entries.values()].reduce((sum, quantity) => sum + quantity, 0),
    [entries],
  );

  // One pass over the deck builds the add-cap function for every grid card
  // (per-name limit, ACE SPEC ≤ 1 total, basic Energy unlimited).
  const remainingOf = useMemo(() => remainingAllowedFor(deck, format), [deck, format]);
  const countOf = (card: BuilderCard) => entries.get(card.cardId) ?? 0;

  // Server-side card search over the catalog (name/category/type/kind/rule
  // box/rarity/set/serie/illustrator/mark/HP/text/legality/sort + pagination).
  // EVERY dimension is on the wire since D198 — the grid renders the pages as
  // they arrive, with no client-side pass left to thin them behind the
  // server's total.
  const search = useCardSearch(filters, format, { onCards: store.register });

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

  // Remove a whole entry by id — the escape hatch for entries whose card the
  // catalog disowned (no BuilderCard exists, so removeCard can't apply).
  const removeEntry = (cardId: string) => {
    setEntries((prev) => {
      const next = new Map(prev);
      next.delete(cardId);
      return next;
    });
    setAnnouncement("Removed unavailable card from the deck.");
  };

  const importText = async (text: string): Promise<UnmatchedLine[]> => {
    // Resolves names against the catalog; rejects (dialog reports it) on an
    // api failure, so a network blip can't half-replace the deck.
    const { entries: parsed, unmatched } = await importDecklist(text);
    // Clamp to what the server accepts (decks/requests.ts): ≤99 copies per
    // entry, ≤200 distinct entries — an oversized paste must not assemble a
    // deck whose every PATCH 400s.
    const applied = parsed
      .slice(0, MAX_DECK_CARD_ENTRIES)
      .map((e) => ({ ...e, quantity: Math.min(e.quantity, MAX_COPIES_PER_ENTRY) }));
    store.register(applied.map((e) => e.card));
    setEntries(new Map(applied.map((e) => [e.card.cardId, e.quantity])));
    const imported = applied.reduce((sum, e) => sum + e.quantity, 0);
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
    options: catalogOptions,
  };

  const deckPanelProps = {
    deckName,
    onRename: setDeckName,
    saveStatus,
    deck,
    pending: pendingEntries,
    total,
    validation,
    format,
    remainingOf,
    onAdd: addCard,
    onRemove: removeCard,
    onRemoveEntry: removeEntry,
    onClear: clearDeck,
    onImportExport: () => setDialogOpen(true),
    onChooseCover: () => setCoverOpen(true),
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
      <Link to="/decks" className={BACK_PILL_CLASS}>
        <ArrowLeftIcon className={BACK_ARROW_ICON} />
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
            className={`self-end ${GLASS_FILTER_TOGGLE} ${
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
                className={`${GLASS_INPUT} py-2.5 pl-10 pr-4 placeholder:text-white/50`}
              />
            </div>
            {/* Filters toggle — only below xl, where the rail is a drawer. */}
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              aria-label="Filters"
              className={`inline-flex shrink-0 items-center justify-center rounded-full p-2.5 ring-1 ring-inset bg-white/[0.045] text-white/70 ring-white/10 backdrop-blur-md transition-all motion-reduce:transition-none hover:bg-white/[0.08] hover:text-white/90 active:scale-95 min-[1380px]:hidden ${FOCUS_RING}`}
            >
              <FilterIcon className="h-5 w-5" />
            </button>
            {/* Deck toggle — only below lg, where the deck panel is a drawer. */}
            <button
              type="button"
              onClick={() => setDeckOpen(true)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2.5 text-sm font-semibold ring-1 ring-inset bg-white/[0.045] text-white/80 ring-white/10 backdrop-blur-md transition-all motion-reduce:transition-none hover:bg-white/[0.08] hover:text-white active:scale-95 min-[1600px]:hidden ${FOCUS_RING}`}
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
              cards={search.cards}
              total={search.total}
              loading={search.loading}
              loadingMore={search.loadingMore}
              error={search.error}
              hasMore={search.hasMore}
              onLoadMore={search.loadMore}
              onRetry={search.retry}
              countOf={countOf}
              remainingOf={remainingOf}
              onAdd={addCard}
              onRemove={removeCard}
              onInspect={(card) => {
                setInspecting(card);
                setDetailOpen(true);
              }}
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
      <Drawer
        open={deckOpen}
        side="right"
        title="Your deck"
        onClose={() => setDeckOpen(false)}
        fill
      >
        <DeckPanel {...deckPanelProps} />
      </Drawer>

      <ImportExportDialog
        open={dialogOpen}
        deckText={formatDecklist(deck)}
        onImport={importText}
        onClose={() => setDialogOpen(false)}
      />

      <CoverDialog
        open={coverOpen}
        deck={deck}
        chosenCoverCardId={chosenCover}
        onChoose={setChosenCover}
        onClose={() => setCoverOpen(false)}
      />

      <CardDetailDialog open={detailOpen} card={inspecting} onClose={() => setDetailOpen(false)} />

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
            className={`flex h-8 w-8 ${GHOST_ICON_BUTTON}`}
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
