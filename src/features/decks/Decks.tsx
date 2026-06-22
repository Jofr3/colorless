import type { HTMLAttributes, ReactNode, Ref } from "react";
import { Fragment, useRef, useState } from "react";
import { AppBackdrop } from "../../components/AppBackdrop";
import { HomeButton } from "../../components/HomeButton";
import { useTiltJuice } from "../../components/useTiltJuice";
import {
  ArrowLeftIcon,
  DecksIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "../../components/icons";
import { CardBackStack } from "./CardBackStack";
import { ScrollArea } from "./ScrollArea";
import { type Deck, type Folder, SEED_DECKS, SEED_FOLDERS } from "./data";
import "./decks.css";

// The accent button is the inverse of the app's glass buttons: a light accent
// fill with dark text, instead of translucent-white-on-dark with light text.
// The fill is slightly translucent (frosted via backdrop-blur) under a pure
// white border. Accent colour lives in --color-accent (index.css).
const PRIMARY_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-accent/80 px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-[0_4px_18px_rgba(0,0,0,0.32)] ring-1 ring-inset ring-white backdrop-blur-md transition-all hover:bg-accent/90 active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

const GHOST_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-white/75 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.08] hover:text-white/90 active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

const NAME_INPUT_CLASS =
  "pointer-events-auto block w-full min-w-0 select-text truncate rounded-md bg-white/10 px-1.5 py-0.5 text-sm font-semibold text-white outline-none ring-1 ring-inset ring-white/50";

const pluralize = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Name that swaps to an inline text field while it's being edited. Enter or
    blur commits, Escape reverts; an empty value falls back to the old name. */
function NameField({
  editing,
  value,
  onCommit,
  className,
}: {
  editing: boolean;
  value: string;
  onCommit: (name: string) => void;
  className: string;
}) {
  if (!editing) return <span className={className}>{value}</span>;
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: only mounts on an explicit create/rename action, so focusing it is the expected flow.
      autoFocus
      defaultValue={value}
      aria-label="Name"
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value.trim() || value)}
      className={NAME_INPUT_CLASS}
    />
  );
}

/** Frosted-glass card surface shared by deck and folder tiles. The blurred
    layer is oversized by 1px and clipped by the shell's overflow-hidden, the
    same trick the home menu cards use to trim backdrop-filter's edge fringe.
    Motion (the deck tiles' hover lift, the folder tiles' tilt) is left to the
    caller via `className`/`style`, so the shell itself stays presentational. */
function CardShell({
  children,
  className,
  innerRef,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  innerRef?: Ref<HTMLDivElement>;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  return (
    <div
      ref={innerRef}
      className={`group relative overflow-hidden rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.40)]${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-px bg-white/[0.045] backdrop-blur-md"
      />
      <div className="relative">{children}</div>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition group-hover:ring-white/20"
      />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/30 text-white/70 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-colors hover:bg-black/45 hover:text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/50"
    >
      {children}
    </button>
  );
}

/** Rename + delete controls, revealed on hover/focus in a tile's top-right. */
function CardActions({
  label,
  onRename,
  onDelete,
}: {
  label: string;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
      <IconButton label={`Rename ${label}`} onClick={onRename}>
        <PencilIcon className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton label={`Delete ${label}`} onClick={onDelete}>
        <TrashIcon className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

function DeckCard({
  deck,
  editing,
  folderLabel,
  juiceOnMount,
  onCommit,
  onRename,
  onDelete,
}: {
  deck: Deck;
  editing: boolean;
  folderLabel?: string | null;
  juiceOnMount?: boolean;
  onCommit: (name: string) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    // No tile shell — the deck is just the floating card stack, filling its
    // column. `group` drives the hover reveal of the rename/delete actions.
    <div className="group relative">
      <CardActions label={deck.name} onRename={onRename} onDelete={onDelete} />
      <CardBackStack
        juiceOnMount={juiceOnMount}
        label={
          <>
            {folderLabel && (
              <span className="mb-1 inline-flex max-w-full items-center gap-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white/85 backdrop-blur-sm">
                <FolderIcon className="h-2.5 w-2.5 shrink-0" fill="currentColor" />
                <span className="truncate">{folderLabel}</span>
              </span>
            )}
            <NameField
              editing={editing}
              value={deck.name}
              onCommit={onCommit}
              className="block truncate text-sm font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]"
            />
            <p className="mt-0.5 text-xs text-white/65">
              {deck.cardCount === 0 ? "Empty" : pluralize(deck.cardCount, "card")}
            </p>
          </>
        }
      />
    </div>
  );
}

function FolderCard({
  folder,
  summary,
  editing,
  onOpen,
  onCommit,
  onRename,
  onDelete,
}: {
  folder: Folder;
  summary: string;
  editing: boolean;
  onOpen: () => void;
  onCommit: (name: string) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  // Folder tiles get the home menu cards' Balatro tilt + juice (no glow/sheen).
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } =
    useTiltJuice<HTMLDivElement>();
  return (
    // `group relative` wrapper holds the actions still while the card tilts.
    // The actions sit outside the juice + tilt layers so they don't move with
    // the card (matching DeckCard).
    <div className="group relative">
      <CardActions label={folder.name} onRename={onRename} onDelete={onDelete} />
      {/* Outer layer carries the transient juice (whole-card squash + wobble). */}
      <div ref={juiceLayerRef} style={juiceStyle}>
        <CardShell innerRef={tiltRef} style={tiltStyle} {...handlers}>
          {/* Full-card click target sits behind the content and actions. Hidden
              while renaming so the input below stays usable. */}
          {!editing && (
            <button
              type="button"
              aria-label={`Open ${folder.name}`}
              onClick={onOpen}
              className="absolute inset-0 z-0 cursor-pointer focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/50"
            />
          )}
          <div className="pointer-events-none relative flex items-center gap-3 p-4">
            <FolderIcon className="h-9 w-9 shrink-0 text-accent" fill="currentColor" />
            <div className="min-w-0">
              <NameField
                editing={editing}
                value={folder.name}
                onCommit={onCommit}
                className="block truncate text-sm font-semibold text-white/90"
              />
              <p className="mt-0.5 text-xs text-white/45">{summary}</p>
            </div>
          </div>
        </CardShell>
      </div>
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 pb-16 pt-36 text-center">
      <DecksIcon className="h-6 w-6 text-white/20" />
      <p className="text-sm font-medium text-white/40">{title}</p>
    </div>
  );
}

export function Decks() {
  const [folders, setFolders] = useState<Folder[]>(SEED_FOLDERS);
  const [decks, setDecks] = useState<Deck[]>(SEED_DECKS);
  const [query, setQuery] = useState("");
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The most recently created deck — its tile pops with a juice bounce on mount.
  const [justCreatedDeckId, setJustCreatedDeckId] = useState<string | null>(null);
  const idCounter = useRef(0);

  const genId = (prefix: string) => {
    idCounter.current += 1;
    return `${prefix}-new-${idCounter.current}`;
  };

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const searching = q.length > 0;
  const openFolder = openFolderId ? (folders.find((f) => f.id === openFolderId) ?? null) : null;

  const folderNameOf = (id: string | null) =>
    id ? (folders.find((f) => f.id === id)?.name ?? null) : null;

  // A folder's one-line subtitle: its direct subfolders and decks, or "Empty".
  const folderSummaryOf = (id: string) => {
    const subfolders = folders.filter((f) => f.parentId === id).length;
    const childDecks = decks.filter((d) => d.folderId === id).length;
    const parts: string[] = [];
    if (subfolders) parts.push(pluralize(subfolders, "folder"));
    if (childDecks) parts.push(pluralize(childDecks, "deck"));
    return parts.length > 0 ? parts.join(" · ") : "Empty";
  };

  // Ancestor chain (root-most first) for the open folder, used by the
  // breadcrumb. The visited guard keeps a stray cycle from looping forever.
  const folderPath = (id: string): Folder[] => {
    const path: Folder[] = [];
    const seen = new Set<string>();
    let current = folders.find((f) => f.id === id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current);
      const parentId = current.parentId;
      current = parentId ? folders.find((f) => f.id === parentId) : undefined;
    }
    return path;
  };

  // What the current view shows: search spans the whole library; otherwise it's
  // the open folder's subfolders + decks, or the root (top-level folders + loose
  // decks).
  let visibleFolders: Folder[] = [];
  let visibleDecks: Deck[] = [];
  if (searching) {
    visibleFolders = folders.filter((f) => f.name.toLowerCase().includes(q));
    visibleDecks = decks.filter((d) => d.name.toLowerCase().includes(q));
  } else if (openFolder) {
    visibleFolders = folders.filter((f) => f.parentId === openFolder.id);
    visibleDecks = decks.filter((d) => d.folderId === openFolder.id);
  } else {
    visibleFolders = folders.filter((f) => f.parentId === null);
    visibleDecks = decks.filter((d) => d.folderId === null);
  }

  const handleNewDeck = () => {
    const id = genId("deck");
    const tint = (idCounter.current * 47) % 360;
    setDecks((prev) => [
      { id, name: "Untitled Deck", folderId: openFolder?.id ?? null, cardCount: 0, tint },
      ...prev,
    ]);
    setQuery("");
    setEditingId(id);
    setJustCreatedDeckId(id);
  };

  const handleNewFolder = () => {
    const id = genId("folder");
    setFolders((prev) => [{ id, name: "New Folder", parentId: openFolder?.id ?? null }, ...prev]);
    setQuery("");
    setEditingId(id);
  };

  const commitDeck = (id: string, name: string) => {
    setDecks((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
    setEditingId(null);
  };

  const commitFolder = (id: string, name: string) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    setEditingId(null);
  };

  const deleteDeck = (id: string) => {
    setDecks((prev) => prev.filter((d) => d.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const deleteFolder = (id: string) => {
    // Don't strand what's inside — lift the folder's direct decks and subfolders
    // up one level (to its own parent) instead of orphaning them.
    const parentId = folders.find((f) => f.id === id)?.parentId ?? null;
    setDecks((prev) => prev.map((d) => (d.folderId === id ? { ...d, folderId: parentId } : d)));
    setFolders((prev) =>
      prev
        .filter((f) => f.id !== id)
        .map((f) => (f.parentId === id ? { ...f, parentId } : f)),
    );
    if (openFolderId === id) setOpenFolderId(parentId);
    if (editingId === id) setEditingId(null);
  };

  const openFolderById = (id: string) => {
    setOpenFolderId(id);
    setQuery("");
  };

  const isEmpty = visibleFolders.length === 0 && visibleDecks.length === 0;

  return (
    <AppBackdrop>
      <HomeButton />
      {/* pt-16 keeps the toolbar clear of the floating top-right home button.
          Fixed to the viewport height (h-svh + overflow-hidden) so only the card
          grid below scrolls — the toolbar and breadcrumb stay put. */}
      <main className="mx-auto flex h-svh w-full max-w-4xl flex-col gap-6 overflow-hidden px-6 pt-16">
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search decks and folders"
              aria-label="Search decks and folders"
              className="w-full rounded-full bg-white/[0.045] py-2.5 pl-10 pr-4 text-sm text-white/90 placeholder:text-white/35 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleNewFolder} className={GHOST_BUTTON_CLASS}>
              <FolderIcon className="h-4 w-4" fill="currentColor" />
              New folder
            </button>
            <button type="button" onClick={handleNewDeck} className={PRIMARY_BUTTON_CLASS}>
              <PlusIcon className="h-4 w-4" />
              New deck
            </button>
          </div>
        </div>

        {openFolder && !searching && (
          <nav
            aria-label="Breadcrumb"
            className="flex shrink-0 flex-wrap items-center gap-2 text-sm"
          >
            {/* Steps up one level — to the parent folder, or back to the root. */}
            <button
              type="button"
              onClick={() => setOpenFolderId(openFolder.parentId)}
              aria-label="Up one level"
              className="group inline-flex cursor-pointer items-center rounded-full bg-white/[0.04] p-1.5 text-white/70 ring-1 ring-inset ring-white/10 transition-all hover:bg-white/[0.07] hover:text-white/90 active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
            >
              <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
            </button>
            <button
              type="button"
              onClick={() => setOpenFolderId(null)}
              className="cursor-pointer rounded text-white/55 transition-colors hover:text-white/85 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
            >
              All decks
            </button>
            {folderPath(openFolder.id).map((folder, i, path) => {
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
                      className="max-w-[12rem] cursor-pointer truncate rounded text-white/55 transition-colors hover:text-white/85 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
                    >
                      {folder.name}
                    </button>
                  )}
                </Fragment>
              );
            })}
          </nav>
        )}

        {/* Internal scroll area: the folders + decks scroll here while the
            toolbar above stays fixed. ScrollArea hides the native bar and draws a
            custom thumb in the right gutter, so the grid keeps its full width and
            never reflows for the bar. -mx-3/px-3 keeps the cells aligned to the
            column edge while giving card edges clip room. */}
        <ScrollArea className="-mx-3 px-3 pb-12" trackTop={16} trackBottom={16}>
          {isEmpty ? (
            <EmptyState
              title={
                searching
                  ? `No results for "${trimmed}"`
                  : openFolder
                    ? "This folder is empty"
                    : "No decks yet"
              }
            />
          ) : (
            <div className="flex flex-col gap-6">
              {visibleFolders.length > 0 && (
                <section className="flex flex-col gap-3">
                  {/* Small breathing room where the "Folders" label used to sit. */}
                  <div aria-hidden className="h-1" />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {visibleFolders.map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        summary={folderSummaryOf(folder.id)}
                        editing={editingId === folder.id}
                        onOpen={() => openFolderById(folder.id)}
                        onCommit={(name) => commitFolder(folder.id, name)}
                        onRename={() => setEditingId(folder.id)}
                        onDelete={() => deleteFolder(folder.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {visibleDecks.length > 0 && (
                <section className="flex flex-col gap-3">
                  {/* Breathing room where the "Decks" label used to sit — also the
                      first row's clip room, so the top card's tilt/juice doesn't
                      get cut off by the scroll box when no folders sit above it. */}
                  <div aria-hidden className="h-1" />
                  <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 lg:grid-cols-5">
                    {visibleDecks.map((deck) => (
                      <DeckCard
                        key={deck.id}
                        deck={deck}
                        editing={editingId === deck.id}
                        folderLabel={searching ? folderNameOf(deck.folderId) : undefined}
                        juiceOnMount={deck.id === justCreatedDeckId}
                        onCommit={(name) => commitDeck(deck.id, name)}
                        onRename={() => setEditingId(deck.id)}
                        onDelete={() => deleteDeck(deck.id)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </ScrollArea>
      </main>
    </AppBackdrop>
  );
}
