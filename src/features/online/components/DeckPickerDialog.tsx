import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowLeftIcon,
  CheckIcon,
  DecksIcon,
  FolderIcon,
  SearchIcon,
} from "../../../components/icons";
import { ScrollArea } from "../../../components/ScrollArea";
import { StatusPanel, StatusSpinner } from "../../../components/StatusPanel";
import {
  BACK_ARROW_ICON,
  FOCUS_RING_INSET,
  GLASS_ACCENT_BUTTON,
  GLASS_DIALOG_PANEL,
} from "../../../lib/glass";
import { useAuth } from "../../auth/AuthProvider";
import { CardBackStack } from "../../decks/CardBackStack";
import type { Deck } from "../../decks/data";
import { folderPath } from "../../decks/tree";
import { useDeckLibrary } from "../../decks/useDeckLibrary";
import type { DeckChoice } from "../net/useLobby";
import "../online.css";

// The lobby's deck picker: a read-only, selection-focused mirror of the /decks
// library — the same account decks and folders (fetched fresh from the api
// each time it opens), browsable by folder (with a breadcrumb) and searchable
// — so choosing a lobby deck feels like the decks page. Picking a deck hands
// back its {id, name} and closes; opening a folder drills in. The lobby
// itself is account-less, so an anonymous player gets a sign-in prompt here
// rather than an empty grid.

const pluralize = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function FolderTile({
  name,
  summary,
  onOpen,
}: {
  name: string;
  summary: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex items-center gap-3 rounded-2xl bg-white/[0.045] p-4 text-left ring-1 ring-inset ring-white/10 backdrop-blur-md transition-colors motion-reduce:transition-none hover:bg-white/[0.07] hover:ring-white/20 ${FOCUS_RING_INSET}`}
    >
      <FolderIcon className="h-9 w-9 shrink-0 text-accent" fill="currentColor" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white/90">{name}</p>
        <p className="mt-0.5 text-xs text-white/45">{summary}</p>
      </div>
    </button>
  );
}

function DeckOption({
  deck,
  folderLabel,
  selected,
  onSelect,
}: {
  deck: Deck;
  folderLabel: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    // No tile shell — just the floating card stack, exactly like the /decks
    // page: the deck name and card count are printed into the card back, not
    // repeated below it. The button is the selection target; a corner "Selected"
    // badge (not a ring) marks the current pick. rounded-[7px] matches the card
    // corner so the focus ring hugs it.
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`group relative rounded-[7px] text-left ${FOCUS_RING_INSET}`}
    >
      <CardBackStack
        label={
          <>
            {folderLabel && (
              <span className="mb-1 inline-flex max-w-full items-center gap-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white/85 backdrop-blur-sm">
                <FolderIcon className="h-2.5 w-2.5 shrink-0" fill="currentColor" />
                <span className="truncate">{folderLabel}</span>
              </span>
            )}
            <span className="block truncate text-sm font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
              {deck.name}
            </span>
            <p className="mt-0.5 text-xs text-white/65">
              {deck.cardCount === 0 ? "Empty" : pluralize(deck.cardCount, "card")}
            </p>
          </>
        }
      />
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-950 shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
        >
          <CheckIcon className="h-3 w-3" />
          Selected
        </span>
      )}
    </button>
  );
}

export function DeckPickerDialog({
  open,
  selectedDeckId,
  onSelect,
  onCancel,
}: {
  open: boolean;
  selectedDeckId: string | null;
  onSelect: (deck: DeckChoice) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { status } = useAuth();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  // The library, fetched fresh each time the dialog opens (decks may have
  // changed since; useDeckLibrary refetches on each enabled false→true edge)
  // — the lobby's read-only slice of /decks.
  const { decks, folders, phase, retry } = useDeckLibrary(open && status === "authenticated");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // Fresh browse each time it opens (root, no search).
      setQuery("");
      setOpenFolderId(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  );

  /** A folder's one-line subtitle: its direct subfolders and decks, or "Empty". */
  const folderSummary = (id: string): string => {
    const subfolders = folders.filter((folder) => folder.parentId === id).length;
    const childDecks = decks.filter((deck) => deck.folderId === id).length;
    const parts: string[] = [];
    if (subfolders) parts.push(pluralize(subfolders, "folder"));
    if (childDecks) parts.push(pluralize(childDecks, "deck"));
    return parts.length > 0 ? parts.join(" · ") : "Empty";
  };

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const searching = q.length > 0;
  const openFolder = openFolderId
    ? (folders.find((folder) => folder.id === openFolderId) ?? null)
    : null;

  // Search spans the whole library; otherwise show the current folder's direct
  // subfolders and decks (the root when no folder is open).
  const { visibleFolders, visibleDecks } = useMemo(() => {
    if (searching) {
      return {
        visibleFolders: folders.filter((folder) => folder.name.toLowerCase().includes(q)),
        visibleDecks: decks.filter((deck) => deck.name.toLowerCase().includes(q)),
      };
    }
    const parentId = openFolder?.id ?? null;
    return {
      visibleFolders: folders.filter((folder) => folder.parentId === parentId),
      visibleDecks: decks.filter((deck) => deck.folderId === parentId),
    };
  }, [folders, decks, q, searching, openFolder]);

  const openFolderById = (id: string) => {
    setOpenFolderId(id);
    setQuery("");
  };

  const isEmpty = visibleFolders.length === 0 && visibleDecks.length === 0;
  const browsing = status === "authenticated" && phase === "ready";

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the native <dialog> handles Escape; this onClick only adds backdrop click-to-cancel for pointer users.
    <dialog
      ref={dialogRef}
      aria-label="Choose your deck"
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === dialogRef.current) onCancel();
      }}
      className="online-dialog m-auto border-0 bg-transparent p-0 text-white"
    >
      <div
        className={`flex max-h-[80vh] w-[min(44rem,calc(100vw-2.5rem))] flex-col ${GLASS_DIALOG_PANEL}`}
      >
        {browsing && (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search decks and folders"
              aria-label="Search decks and folders"
              className="w-full rounded-full bg-white/[0.06] py-2.5 pl-10 pr-4 text-sm text-white/90 ring-1 ring-inset ring-white/10 outline-none transition-colors motion-reduce:transition-none placeholder:text-white/35 focus-visible:ring-2 focus-visible:ring-white/50"
            />
          </div>
        )}

        {status === "anonymous" ? (
          // The lobby works without an account; the deck library doesn't.
          <StatusPanel
            variant="dialog"
            icon={<DecksIcon className="h-6 w-6 text-white/20" />}
            title="Sign in to use your decks."
            action={
              <Link
                to="/login"
                state={{ from: location.pathname }}
                className={`mt-1 inline-flex cursor-pointer items-center rounded-full px-4 py-2.5 text-sm font-semibold ${GLASS_ACCENT_BUTTON}`}
              >
                Sign in
              </Link>
            }
          />
        ) : status === "loading" || phase === "loading" ? (
          <StatusSpinner
            label="Loading decks"
            className="flex flex-col items-center justify-center px-6 py-16"
          />
        ) : phase === "error" ? (
          <StatusPanel
            variant="dialog"
            icon={<DecksIcon className="h-6 w-6 text-white/20" />}
            title="Couldn't load your decks."
            action={
              <button
                type="button"
                onClick={retry}
                className={`mt-1 inline-flex cursor-pointer items-center rounded-full px-4 py-2.5 text-sm font-semibold ${GLASS_ACCENT_BUTTON}`}
              >
                Retry
              </button>
            }
          />
        ) : (
          <>
            {openFolder && !searching && (
              <nav
                aria-label="Breadcrumb"
                className="mt-3 flex flex-wrap items-center gap-2 text-sm"
              >
                <button
                  type="button"
                  onClick={() => setOpenFolderId(openFolder.parentId)}
                  aria-label="Up one level"
                  className={`group inline-flex cursor-pointer items-center rounded-full bg-white/[0.04] p-1.5 text-white/70 ring-1 ring-inset ring-white/10 transition-colors motion-reduce:transition-none hover:bg-white/[0.07] hover:text-white/90 ${FOCUS_RING_INSET}`}
                >
                  <ArrowLeftIcon className={BACK_ARROW_ICON} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpenFolderId(null)}
                  className="cursor-pointer rounded px-1 text-white/55 transition-colors motion-reduce:transition-none hover:text-white/85"
                >
                  All decks
                </button>
                {folderPath(folders, openFolder.id).map((folder, i, path) => {
                  const isCurrent = i === path.length - 1;
                  return (
                    <Fragment key={folder.id}>
                      <span aria-hidden className="text-white/30">
                        /
                      </span>
                      {isCurrent ? (
                        <span
                          aria-current="page"
                          className="max-w-[12rem] truncate font-medium text-white/80"
                        >
                          {folder.name}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setOpenFolderId(folder.id)}
                          className="max-w-[12rem] cursor-pointer truncate rounded px-1 text-white/55 transition-colors motion-reduce:transition-none hover:text-white/85"
                        >
                          {folder.name}
                        </button>
                      )}
                    </Fragment>
                  );
                })}
              </nav>
            )}

            {/* No top margin: the search bar → folders gap then equals the
                folders → decks gap (both from each section's h-1 + gap-3), matching
                the /decks page rhythm. */}
            <ScrollArea className="-mx-2 px-2" trackTop={8} trackBottom={8}>
              {isEmpty ? (
                <StatusPanel
                  variant="dialog"
                  icon={<SearchIcon className="h-6 w-6 text-white/20" />}
                  title={
                    searching
                      ? `No results for "${trimmed}"`
                      : openFolder
                        ? "This folder is empty"
                        : "No decks yet"
                  }
                />
              ) : (
                // Mirrors the /decks grid spacing: folder tiles at gap-3, and the
                // deck cards at gap-x-3 gap-y-8 — the tall row gap leaves room for the
                // pile peeking below each card. A thin spacer tops each section (as on
                // /decks) so the first row's tilt/juice clears the scroll box edge.
                <div className="flex flex-col pb-6">
                  {visibleFolders.length > 0 && (
                    <section className="flex flex-col gap-3">
                      <div aria-hidden className="h-1" />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {visibleFolders.map((folder) => (
                          <FolderTile
                            key={folder.id}
                            name={folder.name}
                            summary={folderSummary(folder.id)}
                            onOpen={() => openFolderById(folder.id)}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                  {visibleDecks.length > 0 && (
                    <section className="flex flex-col gap-3">
                      <div aria-hidden className="h-1" />
                      <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 md:grid-cols-4">
                        {visibleDecks.map((deck) => (
                          <DeckOption
                            key={deck.id}
                            deck={deck}
                            folderLabel={
                              searching && deck.folderId
                                ? (folderNameById.get(deck.folderId) ?? null)
                                : null
                            }
                            selected={deck.id === selectedDeckId}
                            onSelect={() => onSelect({ id: deck.id, name: deck.name })}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </div>
    </dialog>
  );
}
