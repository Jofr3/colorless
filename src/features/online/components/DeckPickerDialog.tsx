import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, FolderIcon, SearchIcon } from "../../../components/icons";
import { ScrollArea } from "../../../components/ScrollArea";
import {
  FOCUS_RING_INSET,
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
} from "../../../lib/glass";
import { CardBackStack } from "../../decks/CardBackStack";
import { type Deck, SEED_DECKS, SEED_FOLDERS } from "../../decks/data";
import { folderPath } from "../../decks/tree";
import type { DeckChoice } from "../net/useLobby";
import "../online.css";

// The lobby's deck picker: a read-only, selection-focused mirror of the /decks
// library — the same seed decks and folders, browsable by folder (with a
// breadcrumb) and searchable — so choosing a lobby deck feels like the decks
// page. Picking a deck hands it back and closes; opening a folder drills in.
// (The full Decks page also creates/renames/reorders, which a picker doesn't
// need, so this recreates just the browse+select surface from the shared data.)

const folderNameById = new Map(SEED_FOLDERS.map((folder) => [folder.id, folder.name]));

const pluralize = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A folder's one-line subtitle: its direct subfolders and decks, or "Empty". */
function folderSummary(id: string): string {
  const subfolders = SEED_FOLDERS.filter((folder) => folder.parentId === id).length;
  const decks = SEED_DECKS.filter((deck) => deck.folderId === id).length;
  const parts: string[] = [];
  if (subfolders) parts.push(pluralize(subfolders, "folder"));
  if (decks) parts.push(pluralize(decks, "deck"));
  return parts.length > 0 ? parts.join(" · ") : "Empty";
}

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
      className={`group flex items-center gap-3 rounded-2xl bg-white/[0.045] p-4 text-left ring-1 ring-inset ring-white/10 backdrop-blur-md transition-colors hover:bg-white/[0.07] hover:ring-white/20 ${FOCUS_RING_INSET}`}
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
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`group relative flex flex-col rounded-2xl p-1.5 text-left transition-colors ${FOCUS_RING_INSET} ${
        selected ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
      }`}
    >
      <div className="relative">
        <CardBackStack
          label={
            <span className="block truncate text-left text-xs font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
              {deck.name}
            </span>
          }
        />
        {selected && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[7px] ring-2 ring-inset ring-accent"
          />
        )}
      </div>
      <div className="mt-2 min-w-0 px-1">
        <p className="truncate text-sm font-medium text-white/85">{deck.name}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-white/45">
          {folderLabel && (
            <>
              <FolderIcon className="h-3 w-3 shrink-0" fill="currentColor" />
              <span className="truncate">{folderLabel}</span>
              <span aria-hidden>·</span>
            </>
          )}
          {deck.cardCount === 0 ? "Empty" : pluralize(deck.cardCount, "card")}
        </p>
      </div>
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
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);

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

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const searching = q.length > 0;
  const openFolder = openFolderId
    ? (SEED_FOLDERS.find((folder) => folder.id === openFolderId) ?? null)
    : null;

  // Search spans the whole library; otherwise show the current folder's direct
  // subfolders and decks (the root when no folder is open).
  const { visibleFolders, visibleDecks } = useMemo(() => {
    if (searching) {
      return {
        visibleFolders: SEED_FOLDERS.filter((folder) => folder.name.toLowerCase().includes(q)),
        visibleDecks: SEED_DECKS.filter((deck) => deck.name.toLowerCase().includes(q)),
      };
    }
    const parentId = openFolder?.id ?? null;
    return {
      visibleFolders: SEED_FOLDERS.filter((folder) => folder.parentId === parentId),
      visibleDecks: SEED_DECKS.filter((deck) => deck.folderId === parentId),
    };
  }, [q, searching, openFolder]);

  const openFolderById = (id: string) => {
    setOpenFolderId(id);
    setQuery("");
  };

  const isEmpty = visibleFolders.length === 0 && visibleDecks.length === 0;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the native <dialog> handles Escape; this onClick only adds backdrop click-to-cancel for pointer users.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === dialogRef.current) onCancel();
      }}
      className="online-dialog m-auto border-0 bg-transparent p-0 text-white"
    >
      <div
        className={`flex max-h-[80vh] w-[min(44rem,calc(100vw-2.5rem))] flex-col ${GLASS_DIALOG_PANEL}`}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-white">
            Choose your deck
          </h2>
          <button type="button" onClick={onCancel} className={GLASS_DIALOG_GHOST_BUTTON}>
            Cancel
          </button>
        </div>

        <div className="relative mt-4">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search decks and folders"
            aria-label="Search decks and folders"
            className="w-full rounded-full bg-white/[0.06] py-2.5 pl-10 pr-4 text-sm text-white/90 ring-1 ring-inset ring-white/10 outline-none transition-colors placeholder:text-white/35 focus-visible:ring-2 focus-visible:ring-white/50"
          />
        </div>

        {openFolder && !searching && (
          <nav aria-label="Breadcrumb" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setOpenFolderId(openFolder.parentId)}
              aria-label="Up one level"
              className={`group inline-flex cursor-pointer items-center rounded-full bg-white/[0.04] p-1.5 text-white/70 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.07] hover:text-white/90 ${FOCUS_RING_INSET}`}
            >
              <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
            </button>
            <button
              type="button"
              onClick={() => setOpenFolderId(null)}
              className="cursor-pointer rounded px-1 text-white/55 transition-colors hover:text-white/85"
            >
              All decks
            </button>
            {folderPath(SEED_FOLDERS, openFolder.id).map((folder, i, path) => {
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
                      className="max-w-[12rem] cursor-pointer truncate rounded px-1 text-white/55 transition-colors hover:text-white/85"
                    >
                      {folder.name}
                    </button>
                  )}
                </Fragment>
              );
            })}
          </nav>
        )}

        <ScrollArea className="-mx-2 mt-4 px-2" trackTop={8} trackBottom={8}>
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <SearchIcon className="h-6 w-6 text-white/20" />
              <p className="text-sm font-medium text-white/40">
                {searching ? `No results for "${trimmed}"` : "This folder is empty"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pb-1">
              {visibleFolders.length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {visibleFolders.map((folder) => (
                    <FolderTile
                      key={folder.id}
                      name={folder.name}
                      summary={folderSummary(folder.id)}
                      onOpen={() => openFolderById(folder.id)}
                    />
                  ))}
                </div>
              )}
              {visibleDecks.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
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
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </dialog>
  );
}
