import type { HTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode, Ref } from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { AppBackdrop } from "../../components/AppBackdrop";
import { HomeButton } from "../../components/HomeButton";
import { useTiltJuice } from "../../components/useTiltJuice";
import { readPersisted, writePersisted } from "../../lib/persistedState";
import {
  ArrowLeftIcon,
  CheckIcon,
  DecksIcon,
  FilterIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "../../components/icons";
import { CardBackStack } from "./CardBackStack";
import { ScrollArea } from "./ScrollArea";
import { type Deck, type Folder, SEED_DECKS, SEED_FOLDERS } from "./data";
import { type DragItem, useDeckDrag } from "./useDeckDrag";
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

// Filter toggle, sized to match the search field's height (p-2.5 + a 20px glyph
// ≈ the input's py-2.5 + text-sm line). Shares the search bar's glass surface.
const FILTER_BUTTON_CLASS =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-2.5 ring-1 ring-inset backdrop-blur-md transition-all active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

/** Which kinds of library entries the grid shows. */
type ShowFilter = "all" | "decks" | "folders";
/** Order the grid is sorted in; "default" keeps the natural (newest-first) order. */
type SortKey = "default" | "name-asc" | "name-desc" | "cards-desc";

const SHOW_OPTIONS: { value: ShowFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "decks", label: "Decks only" },
  { value: "folders", label: "Folders only" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "cards-desc", label: "Most cards" },
];

// The filter rail's state persists across refreshes via localStorage. Each
// reader validates what it finds and falls back to the default, so a missing or
// stale value (e.g. an option that no longer exists) can't leave the grid in a
// broken state.
const FILTER_OPEN_STORAGE_KEY = "decks.filterOpen";
const SHOW_FILTER_STORAGE_KEY = "decks.showFilter";
const SORT_KEY_STORAGE_KEY = "decks.sortKey";

const readStoredFilterOpen = () =>
  readPersisted(FILTER_OPEN_STORAGE_KEY, (raw) => raw === "1", false);

const readStoredShowFilter = (): ShowFilter =>
  readPersisted(
    SHOW_FILTER_STORAGE_KEY,
    (raw) => (SHOW_OPTIONS.some((option) => option.value === raw) ? (raw as ShowFilter) : undefined),
    "all",
  );

const readStoredSortKey = (): SortKey =>
  readPersisted(
    SORT_KEY_STORAGE_KEY,
    (raw) => (SORT_OPTIONS.some((option) => option.value === raw) ? (raw as SortKey) : undefined),
    "default",
  );

const pluralize = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Drop-target highlight key for the library root (the breadcrumb "All decks"). */
const ROOT_DROP = "@root";

/** Data attributes that mark an element as a drop target for the pointer drag
    (useDeckDrag hit-tests these via elementFromPoint). `key` drives the live
    highlight; `folderId` is where a dropped entry lands (null = library root,
    encoded as an empty string). */
const dropAttrs = (key: string, folderId: string | null) => ({
  "data-drop-key": key,
  "data-drop-folder": folderId ?? "",
});

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

/** A single checkable row in the filter section. */
function FilterRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.07] focus:outline-none focus-visible:bg-white/[0.07] ${selected ? "text-white" : "text-white/70 hover:text-white/90"}`}
    >
      {label}
      {selected && <CheckIcon className="h-4 w-4 shrink-0" />}
    </button>
  );
}

/** Glass side panel that filters the grid by entry type and sets its sort order.
    Rendered inline as a rail beside the grid rather than as a floating popover. */
function FilterSection({
  show,
  sort,
  onShowChange,
  onSortChange,
  onReset,
  canReset,
}: {
  show: ShowFilter;
  sort: SortKey;
  onShowChange: (value: ShowFilter) => void;
  onSortChange: (value: SortKey) => void;
  onReset: () => void;
  canReset: boolean;
}) {
  return (
    <div className="w-full rounded-2xl bg-white/[0.045] p-3 ring-1 ring-inset ring-white/10 backdrop-blur-md">
      <div>
        <p className="px-2.5 pb-1 pt-1 text-[0.7rem] font-semibold uppercase tracking-wider text-white/35">
          Show
        </p>
        {SHOW_OPTIONS.map((option) => (
          <FilterRow
            key={option.value}
            label={option.label}
            selected={show === option.value}
            onSelect={() => onShowChange(option.value)}
          />
        ))}
      </div>
      <div className="my-2 h-px bg-white/10" />
      <div>
        <p className="px-2.5 pb-1 pt-1 text-[0.7rem] font-semibold uppercase tracking-wider text-white/35">
          Sort by
        </p>
        {SORT_OPTIONS.map((option) => (
          <FilterRow
            key={option.value}
            label={option.label}
            selected={sort === option.value}
            onSelect={() => onSortChange(option.value)}
          />
        ))}
      </div>
      {canReset && (
        <>
          <div className="my-2 h-px bg-white/10" />
          <button
            type="button"
            onClick={onReset}
            className="w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-sm text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white/85 focus:outline-none focus-visible:bg-white/[0.07]"
          >
            Reset filters
          </button>
        </>
      )}
    </div>
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
    <div
      data-card-actions
      className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100"
    >
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
  dragging,
  onCommit,
  onRename,
  onDelete,
  onPointerDown,
}: {
  deck: Deck;
  editing: boolean;
  folderLabel?: string | null;
  juiceOnMount?: boolean;
  dragging: boolean;
  onCommit: (name: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  return (
    // No tile shell — the deck is just the floating card stack, filling its
    // column. `group` drives the hover reveal of the rename/delete actions.
    // A pointer-press drags it into a folder (useDeckDrag); while it's the entry
    // being dragged the original is hidden, so only the floating clone shows.
    <div
      onPointerDown={editing ? undefined : onPointerDown}
      className={`group relative${editing ? "" : " cursor-grab touch-none select-none active:cursor-grabbing"}${dragging ? " pointer-events-none opacity-0" : ""}`}
    >
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
  dragging,
  isDropTarget,
  onOpen,
  onCommit,
  onRename,
  onDelete,
  onPointerDown,
}: {
  folder: Folder;
  summary: string;
  editing: boolean;
  dragging: boolean;
  isDropTarget: boolean;
  onOpen: () => void;
  onCommit: (name: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  // Folder tiles get the home menu cards' Balatro tilt + juice (no glow/sheen).
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } =
    useTiltJuice<HTMLDivElement>();
  return (
    // `group relative` wrapper holds the actions still while the card tilts.
    // The actions sit outside the juice + tilt layers so they don't move with
    // the card (matching DeckCard). It doubles as the drag source and a drop
    // zone (the data-drop-* attrs): drop a deck or folder here to move it
    // inside this folder. While it's the entry being dragged the original is
    // hidden so only the floating clone shows.
    <div
      onPointerDown={editing ? undefined : onPointerDown}
      {...dropAttrs(folder.id, folder.id)}
      className={`group relative${editing ? "" : " cursor-grab touch-none select-none active:cursor-grabbing"}${dragging ? " pointer-events-none opacity-0" : ""}`}
    >
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
      {/* Accent ring + wash shown while this folder is a live drop target. Fades
          via opacity so it never nudges the card's layout. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-20 rounded-2xl bg-accent/10 ring-2 ring-inset ring-accent transition-opacity duration-150 ${
          isDropTarget ? "opacity-100" : "opacity-0"
        }`}
      />
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
  // Filter & sort, shown as a side rail toggled by the button left of the search.
  const [showFilter, setShowFilter] = useState<ShowFilter>(readStoredShowFilter);
  const [sortKey, setSortKey] = useState<SortKey>(readStoredSortKey);
  const [filterOpen, setFilterOpen] = useState(readStoredFilterOpen);
  const idCounter = useRef(0);

  // Persist the rail's open/closed state and the chosen filters so a refresh
  // restores them. Writes can fail (private mode, quota) — the controls still
  // work for the session, they just won't be remembered.
  useEffect(() => {
    writePersisted(FILTER_OPEN_STORAGE_KEY, filterOpen ? "1" : "0");
    writePersisted(SHOW_FILTER_STORAGE_KEY, showFilter);
    writePersisted(SORT_KEY_STORAGE_KEY, sortKey);
  }, [filterOpen, showFilter, sortKey]);

  const filterActive = showFilter !== "all" || sortKey !== "default";

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

  // Apply the filter menu's "Show" choice on top of the current view.
  if (showFilter === "decks") visibleFolders = [];
  else if (showFilter === "folders") visibleDecks = [];

  // …and its sort order. "Most cards" only meaningfully orders decks, so
  // folders fall back to name there. Each branch sorts copies, never the state.
  if (sortKey !== "default") {
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    if (sortKey === "name-desc") {
      visibleFolders = [...visibleFolders].sort((a, b) => byName(b, a));
      visibleDecks = [...visibleDecks].sort((a, b) => byName(b, a));
    } else if (sortKey === "cards-desc") {
      visibleFolders = [...visibleFolders].sort(byName);
      visibleDecks = [...visibleDecks].sort((a, b) => b.cardCount - a.cardCount || byName(a, b));
    } else {
      visibleFolders = [...visibleFolders].sort(byName);
      visibleDecks = [...visibleDecks].sort(byName);
    }
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
      prev.filter((f) => f.id !== id).map((f) => (f.parentId === id ? { ...f, parentId } : f)),
    );
    if (openFolderId === id) setOpenFolderId(parentId);
    if (editingId === id) setEditingId(null);
  };

  const openFolderById = (id: string) => {
    setOpenFolderId(id);
    setQuery("");
  };

  // --- Drag-and-drop: move decks/folders between folders. --------------------

  const moveDeck = (deckId: string, folderId: string | null) =>
    setDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, folderId } : d)));

  const moveFolder = (folderId: string, parentId: string | null) =>
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, parentId } : f)));

  // True when `candidateId` sits anywhere inside `ancestorId`'s subtree. Used to
  // stop a folder being dropped into one of its own descendants, which would cut
  // that branch loose into a cycle. The visited guard is belt-and-suspenders.
  const isDescendantOf = (candidateId: string, ancestorId: string): boolean => {
    const seen = new Set<string>();
    let current = folders.find((f) => f.id === candidateId);
    while (current && !seen.has(current.id)) {
      if (current.parentId === ancestorId) return true;
      seen.add(current.id);
      current = current.parentId ? folders.find((f) => f.id === current?.parentId) : undefined;
    }
    return false;
  };

  // Whether `item` may land in `targetFolderId` (null = root). Blocks no-op
  // moves (already there) and folder-into-itself/own-descendant cycles.
  const canDrop = (item: DragItem, targetFolderId: string | null): boolean => {
    if (item.type === "folder") {
      if (item.id === targetFolderId) return false;
      if (targetFolderId && isDescendantOf(targetFolderId, item.id)) return false;
      return (folders.find((f) => f.id === item.id)?.parentId ?? null) !== targetFolderId;
    }
    return (decks.find((d) => d.id === item.id)?.folderId ?? null) !== targetFolderId;
  };

  const handleDrop = (item: DragItem, targetFolderId: string | null) => {
    if (!canDrop(item, targetFolderId)) return;
    if (item.type === "folder") moveFolder(item.id, targetFolderId);
    else moveDeck(item.id, targetFolderId);
  };

  // Pointer-driven drag (useDeckDrag) — lifts a live clone of the tile and runs
  // the simulator's spring + juice on it, so a folder/deck picks up, follows
  // the cursor, and pops into its target. `dragItem` hides the source while
  // it's lifted; `dropTarget` is the highlight key under the cursor.
  const { dragItem, dropTarget, startDrag } = useDeckDrag({ canDrop, onDrop: handleDrop });

  const isEmpty = visibleFolders.length === 0 && visibleDecks.length === 0;

  return (
    <AppBackdrop>
      <HomeButton />
      {/* pt-16 keeps the toolbar clear of the floating top-right home button.
          Fixed to the viewport height (h-svh + overflow-hidden) so only the card
          grid below scrolls — the toolbar and breadcrumb stay put. */}
      <div className="relative mx-auto flex h-svh w-full max-w-4xl flex-col gap-6 px-6 pt-16">
        {/* Filter rail — the toggle button and, when open, the options panel
            beneath it. From min-[1380px] up (where the centred column leaves a
            wide enough margin) it's lifted out of flow — absolute, pinned just
            left of the column via right-full — so it never shifts the toolbar or
            grid. Below that it falls back to stacking above them. */}
        <aside
          aria-label="Filter and sort"
          className="flex w-full shrink-0 flex-col items-end gap-3 sm:w-56 min-[1380px]:absolute min-[1380px]:right-full min-[1380px]:top-16 min-[1380px]:-mr-2 min-[1380px]:gap-4"
        >
          <button
            type="button"
            aria-label="Filter and sort"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
            className={`${FILTER_BUTTON_CLASS} ${
              filterOpen || filterActive
                ? "bg-white/[0.09] text-white ring-white/25"
                : "bg-white/[0.045] text-white/70 ring-white/10 hover:bg-white/[0.08] hover:text-white/90"
            }`}
          >
            <FilterIcon className="h-5 w-5" />
            {filterActive && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-[#0e0e14]"
              />
            )}
          </button>
          {filterOpen && (
            <FilterSection
              show={showFilter}
              sort={sortKey}
              onShowChange={setShowFilter}
              onSortChange={setSortKey}
              canReset={filterActive}
              onReset={() => {
                setShowFilter("all");
                setSortKey("default");
              }}
            />
          )}
        </aside>
        {/* No overflow clip here: the ScrollArea below clips/scrolls itself, and
            its -mx-3 gutter gives the cards horizontal room for their tilt/juice.
            Clipping x here would cut that off right at the card edge. */}
        <main className="flex min-w-0 flex-1 flex-col">
          <h1 className="sr-only">Decks</h1>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full min-w-0 sm:flex-1">
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
              className="mt-3 flex shrink-0 flex-wrap items-center gap-2 text-sm"
            >
              {/* Steps up one level — to the parent folder, or back to the root. */}
              <button
                type="button"
                onClick={() => setOpenFolderId(openFolder.parentId)}
                aria-label="Up one level"
                {...dropAttrs("@up", openFolder.parentId)}
                className={`group inline-flex cursor-pointer items-center rounded-full p-1.5 ring-1 ring-inset transition-all active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50 ${
                  dropTarget === "@up"
                    ? "bg-accent/20 text-white ring-accent"
                    : "bg-white/[0.04] text-white/70 ring-white/10 hover:bg-white/[0.07] hover:text-white/90"
                }`}
              >
                <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => setOpenFolderId(null)}
                {...dropAttrs(ROOT_DROP, null)}
                className={`cursor-pointer rounded px-1 transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50 ${
                  dropTarget === ROOT_DROP
                    ? "bg-accent/20 text-white ring-1 ring-inset ring-accent"
                    : "text-white/55 hover:text-white/85"
                }`}
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
                        {...dropAttrs(`bc:${folder.id}`, folder.id)}
                        className={`max-w-[12rem] cursor-pointer truncate rounded px-1 transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50 ${
                          dropTarget === `bc:${folder.id}`
                            ? "bg-accent/20 text-white ring-1 ring-inset ring-accent"
                            : "text-white/55 hover:text-white/85"
                        }`}
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
              <div className="flex flex-col">
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
                          dragging={dragItem?.type === "folder" && dragItem.id === folder.id}
                          isDropTarget={dropTarget === folder.id}
                          onOpen={() => openFolderById(folder.id)}
                          onCommit={(name) => commitFolder(folder.id, name)}
                          onRename={() => setEditingId(folder.id)}
                          onDelete={() => deleteFolder(folder.id)}
                          onPointerDown={(e) => startDrag({ type: "folder", id: folder.id }, e)}
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
                          dragging={dragItem?.type === "deck" && dragItem.id === deck.id}
                          onCommit={(name) => commitDeck(deck.id, name)}
                          onRename={() => setEditingId(deck.id)}
                          onDelete={() => deleteDeck(deck.id)}
                          onPointerDown={(e) => startDrag({ type: "deck", id: deck.id }, e)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </ScrollArea>
        </main>
      </div>
    </AppBackdrop>
  );
}
