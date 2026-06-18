import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
import { useRef, useState } from "react";
import { AppBackdrop } from "../../components/AppBackdrop";
import { HomeButton } from "../../components/HomeButton";
import { useTiltJuice } from "../../components/useTiltJuice";
import {
  ArrowLeftIcon,
  BrandGlyph,
  DecksIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "../../components/icons";
import { type Deck, type Folder, SEED_DECKS, SEED_FOLDERS } from "./data";

// The accent button is the inverse of the app's glass buttons: a light accent
// fill with dark text, instead of translucent-white-on-dark with light text.
// The fill is slightly translucent (frosted via backdrop-blur) under a pure
// white border. Accent colour lives in --color-accent (index.css).
const PRIMARY_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-accent/80 px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-[0_4px_18px_rgba(0,0,0,0.32)] ring-1 ring-inset ring-white backdrop-blur-md transition-all hover:bg-accent/90 active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

const GHOST_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-white/75 ring-1 ring-inset ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.08] hover:text-white/90 active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

const NAME_INPUT_CLASS =
  "pointer-events-auto block w-full min-w-0 truncate rounded-md bg-white/10 px-1.5 py-0.5 text-sm font-semibold text-white outline-none ring-1 ring-inset ring-white/50";

const pluralize = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Cover gradient for a deck tile, derived from its hue so the grid reads
// colourful without bundling any art. A bright hot-spot in the top-left over a
// diagonal hue shift gives each tile a little depth.
function coverStyle(tint: number): CSSProperties {
  return {
    background:
      `radial-gradient(120% 140% at 22% 12%, hsl(${tint} 85% 62% / 0.45), transparent 60%),` +
      `linear-gradient(135deg, hsl(${tint} 70% 50% / 0.30), hsl(${(tint + 50) % 360} 70% 45% / 0.12))`,
  };
}

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
  onCommit,
  onRename,
  onDelete,
}: {
  deck: Deck;
  editing: boolean;
  folderLabel?: string | null;
  onCommit: (name: string) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <CardShell className="transition-transform duration-200 will-change-transform hover:-translate-y-0.5">
      <CardActions label={deck.name} onRename={onRename} onDelete={onDelete} />
      <div className="relative h-20 overflow-hidden" style={coverStyle(deck.tint)}>
        <BrandGlyph className="absolute -bottom-3 -right-2 h-20 w-20 -rotate-12 text-white/10 transition-colors group-hover:text-white/20" />
      </div>
      <div className="p-3.5">
        <NameField
          editing={editing}
          value={deck.name}
          onCommit={onCommit}
          className="block truncate text-sm font-semibold text-white/90"
        />
        <p className="mt-1 text-xs text-white/45">
          {deck.cardCount === 0 ? "Empty" : pluralize(deck.cardCount, "card")}
        </p>
        {folderLabel && (
          <span className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/50">
            <FolderIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{folderLabel}</span>
          </span>
        )}
      </div>
    </CardShell>
  );
}

function FolderCard({
  folder,
  deckCount,
  editing,
  onOpen,
  onCommit,
  onRename,
  onDelete,
}: {
  folder: Folder;
  deckCount: number;
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
    // Outer layer carries the transient juice (whole-card squash + wobble).
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
        <CardActions label={folder.name} onRename={onRename} onDelete={onDelete} />
        <div className="pointer-events-none relative flex items-center gap-3 p-4">
          <FolderIcon className="h-9 w-9 shrink-0 text-accent" fill="currentColor" />
          <div className="min-w-0">
            <NameField
              editing={editing}
              value={folder.name}
              onCommit={onCommit}
              className="block truncate text-sm font-semibold text-white/90"
            />
            <p className="mt-0.5 text-xs text-white/45">{pluralize(deckCount, "deck")}</p>
          </div>
        </div>
      </CardShell>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-wider text-white/40">{children}</h2>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-white/40 ring-1 ring-inset ring-white/10">
        <DecksIcon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-medium text-white/80">{title}</p>
        <p className="mt-1 text-sm text-muted">{hint}</p>
      </div>
    </div>
  );
}

export function Decks() {
  const [folders, setFolders] = useState<Folder[]>(SEED_FOLDERS);
  const [decks, setDecks] = useState<Deck[]>(SEED_DECKS);
  const [query, setQuery] = useState("");
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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
  const deckCountOf = (id: string) => decks.filter((d) => d.folderId === id).length;

  // What the current view shows: search spans the whole library; otherwise it's
  // the open folder's decks, or the root (folders + loose decks).
  let visibleFolders: Folder[] = [];
  let visibleDecks: Deck[] = [];
  if (searching) {
    visibleFolders = folders.filter((f) => f.name.toLowerCase().includes(q));
    visibleDecks = decks.filter((d) => d.name.toLowerCase().includes(q));
  } else if (openFolder) {
    visibleDecks = decks.filter((d) => d.folderId === openFolder.id);
  } else {
    visibleFolders = folders;
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
  };

  const handleNewFolder = () => {
    const id = genId("folder");
    setFolders((prev) => [{ id, name: "New Folder" }, ...prev]);
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
    // Don't strand the decks inside — return them to the library root.
    setDecks((prev) => prev.map((d) => (d.folderId === id ? { ...d, folderId: null } : d)));
    setFolders((prev) => prev.filter((f) => f.id !== id));
    if (openFolderId === id) setOpenFolderId(null);
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
      {/* pt-16 keeps the toolbar clear of the floating top-right home button. */}
      <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-6 px-6 pb-12 pt-16">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
            {!openFolder && (
              <button type="button" onClick={handleNewFolder} className={GHOST_BUTTON_CLASS}>
                <FolderIcon className="h-4 w-4" fill="currentColor" />
                New folder
              </button>
            )}
            <button type="button" onClick={handleNewDeck} className={PRIMARY_BUTTON_CLASS}>
              <PlusIcon className="h-4 w-4" />
              New deck
            </button>
          </div>
        </div>

        {openFolder && !searching && (
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setOpenFolderId(null)}
              className="group inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 text-white/70 ring-1 ring-inset ring-white/10 transition-all hover:bg-white/[0.07] hover:text-white/90 active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
            >
              <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              All decks
            </button>
            <span className="text-white/30">/</span>
            <span className="font-medium text-white/80">{openFolder.name}</span>
          </div>
        )}

        {isEmpty ? (
          <EmptyState
            title={
              searching
                ? `No results for "${trimmed}"`
                : openFolder
                  ? "This folder is empty"
                  : "No decks yet"
            }
            hint={
              searching
                ? "Try a different name."
                : openFolder
                  ? "Create a deck to fill it up."
                  : "Create your first deck or folder to get started."
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            {visibleFolders.length > 0 && (
              <section className="flex flex-col gap-3">
                <SectionLabel>Folders</SectionLabel>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleFolders.map((folder) => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      deckCount={deckCountOf(folder.id)}
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
                {visibleFolders.length > 0 && <SectionLabel>Decks</SectionLabel>}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                  {visibleDecks.map((deck) => (
                    <DeckCard
                      key={deck.id}
                      deck={deck}
                      editing={editingId === deck.id}
                      folderLabel={searching ? folderNameOf(deck.folderId) : undefined}
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
      </main>
    </AppBackdrop>
  );
}
