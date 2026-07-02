import { useEffect, useRef, useState } from "react";
import type { Deck, Folder } from "./data";
import type { DragItem, ReorderPreview } from "./useDeckDrag";

/** A destination the move banner offers: a folder to nest into, or the up-a-level
    target (null folderId = the library root). */
export interface NestTarget {
  folderId: string | null;
  label: string;
}

export interface KeyboardMoveOptions {
  visibleFolders: Folder[];
  visibleDecks: Deck[];
  /** Reorder needs a stable list, so move mode is disabled while searching. */
  searching: boolean;
  /** The folder currently open (null = library root), for the up-a-level target. */
  openFolder: Folder | null;
  folderNameOf: (id: string | null) => string | null;
  itemName: (item: DragItem) => string;
  canDrop: (item: DragItem, targetFolderId: string | null) => boolean;
  reorderItems: (item: DragItem, index: number) => void;
  handleDrop: (item: DragItem, targetFolderId: string | null) => void;
}

/** Keyboard/AT path to the two things the pointer drag does — reorder a tile
    among its siblings (arrow keys) and nest it into / out of a folder (the
    MoveBanner buttons). It exposes a synthetic dragItem/reorder so the caller can
    drive the same live-preview machinery the pointer drag uses; commits reuse the
    caller's reorderItems / handleDrop. See MoveBanner for the UI and useDeckDrag
    for the pointer path. */
export function useKeyboardMove({
  visibleFolders,
  visibleDecks,
  searching,
  openFolder,
  folderNameOf,
  itemName,
  canDrop,
  reorderItems,
  handleDrop,
}: KeyboardMoveOptions) {
  const [moving, setMoving] = useState<{
    id: string;
    type: "deck" | "folder";
    index: number;
  } | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const dropButtonRef = useRef<HTMLButtonElement>(null);
  const newDeckButtonRef = useRef<HTMLButtonElement>(null);
  // What to focus once move mode ends: the tile's grip (reorder/cancel keeps it
  // in view) or the New-deck button (a nest sends the item out of view).
  const refocusRef = useRef<string | null>(null);

  const movingItem: DragItem | null = moving ? { type: moving.type, id: moving.id } : null;

  const startMove = (item: DragItem) => {
    if (searching) return;
    const group = item.type === "folder" ? visibleFolders : visibleDecks;
    const index = group.findIndex((entry) => entry.id === item.id);
    if (index < 0) return;
    setMoving({ id: item.id, type: item.type, index });
    setLiveMessage(
      `Moving ${itemName(item)}, position ${index + 1} of ${group.length}. Arrow keys reorder; Enter drops; Escape cancels.`,
    );
  };

  const commitMove = () => {
    if (!moving) return;
    const item: DragItem = { type: moving.type, id: moving.id };
    reorderItems(item, moving.index);
    refocusRef.current = `handle:${moving.id}`;
    setLiveMessage(`Dropped ${itemName(item)} at position ${moving.index + 1}.`);
    setMoving(null);
  };

  const cancelMove = () => {
    if (!moving) return;
    refocusRef.current = `handle:${moving.id}`;
    setLiveMessage(`Cancelled moving ${itemName({ type: moving.type, id: moving.id })}.`);
    setMoving(null);
  };

  const nestMove = (targetFolderId: string | null, label: string) => {
    if (!moving) return;
    const item: DragItem = { type: moving.type, id: moving.id };
    handleDrop(item, targetFolderId);
    refocusRef.current = "newdeck";
    setLiveMessage(`Moved ${itemName(item)} to ${label}.`);
    setMoving(null);
  };

  // Arrow keys reorder the moving tile among its siblings; Escape cancels. The
  // Drop button (focused below) handles Enter/Space. Inlined so the effect's
  // dependencies stay exhaustive.
  useEffect(() => {
    if (!moving) return;
    const group = moving.type === "folder" ? visibleFolders : visibleDecks;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        refocusRef.current = `handle:${moving.id}`;
        setLiveMessage("Cancelled.");
        setMoving(null);
        return;
      }
      const delta =
        event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? 1
            : 0;
      if (delta === 0) return;
      event.preventDefault();
      const next = Math.max(0, Math.min(moving.index + delta, group.length - 1));
      if (next === moving.index) return;
      setMoving({ ...moving, index: next });
      setLiveMessage(`Position ${next + 1} of ${group.length}.`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moving, visibleFolders, visibleDecks]);

  // Focus the Drop button when move mode opens; restore focus to the tile's grip
  // (reorder/cancel) or the New-deck button (a nest sent the item away) when it
  // closes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on enter/exit (moving?.id) — refocusing on every index change would fight arrow-key reordering.
  useEffect(() => {
    if (moving) {
      dropButtonRef.current?.focus();
      return;
    }
    const target = refocusRef.current;
    if (!target) return;
    refocusRef.current = null;
    if (target === "newdeck") newDeckButtonRef.current?.focus();
    else if (target.startsWith("handle:")) {
      document.querySelector<HTMLElement>(`[data-move-handle="${target.slice(7)}"]`)?.focus();
    }
  }, [moving?.id]);

  // Folders in the current view this item can nest into (canDrop rejects no-ops
  // and folder-into-itself/own-descendant cycles), plus the up-a-level target.
  const nestFolders = movingItem ? visibleFolders.filter((f) => canDrop(movingItem, f.id)) : [];
  const upTarget: NestTarget | null =
    movingItem && openFolder && canDrop(movingItem, openFolder.parentId)
      ? {
          folderId: openFolder.parentId,
          label: openFolder.parentId
            ? (folderNameOf(openFolder.parentId) ?? "parent")
            : "All decks",
        }
      : null;

  const moveReorder: ReorderPreview | null = moving
    ? { group: moving.type, index: moving.index }
    : null;

  return {
    moving,
    liveMessage,
    /** Synthetic drag item / reorder for the caller's live preview — combine with
        the pointer drag's own state (pointer takes precedence). */
    moveDragItem: movingItem,
    moveReorder,
    movingName: movingItem ? itemName(movingItem) : "",
    nestFolders,
    upTarget,
    startMove,
    commitMove,
    cancelMove,
    nestMove,
    dropButtonRef,
    newDeckButtonRef,
  };
}
