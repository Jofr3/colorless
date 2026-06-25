import type { Deck, Folder } from "./data";
import type { DragItem } from "./useDeckDrag";

// Pure folder-graph helpers, extracted from the Decks component so the
// cycle-prevention logic (the one piece here with real correctness stakes — a
// wrong answer detaches a branch into a cycle) is unit-testable without
// rendering the whole component. Each takes the current folders/decks as args.

export interface MoveDestination {
  /** Target folder id, or null for the library root. */
  id: string | null;
  /** Full path label for disambiguation, e.g. "Standard / Aggro". */
  label: string;
}

/** Ancestor chain (root-most first) for a folder. The visited guard keeps a
    stray parent-cycle in the data from looping forever. */
export function folderPath(folders: Folder[], id: string): Folder[] {
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
}

/** True when `candidateId` sits anywhere inside `ancestorId`'s subtree. Used to
    stop a folder being dropped into one of its own descendants (a cycle). */
export function isDescendantOf(folders: Folder[], candidateId: string, ancestorId: string): boolean {
  const seen = new Set<string>();
  let current = folders.find((f) => f.id === candidateId);
  while (current && !seen.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    seen.add(current.id);
    current = current.parentId ? folders.find((f) => f.id === current?.parentId) : undefined;
  }
  return false;
}

/** Whether `item` may land in `targetFolderId` (null = root). Blocks no-op moves
    (already there) and folder-into-itself/own-descendant cycles. */
export function canDrop(
  folders: Folder[],
  decks: Deck[],
  item: DragItem,
  targetFolderId: string | null,
): boolean {
  if (item.type === "folder") {
    if (item.id === targetFolderId) return false;
    if (targetFolderId && isDescendantOf(folders, targetFolderId, item.id)) return false;
    return (folders.find((f) => f.id === item.id)?.parentId ?? null) !== targetFolderId;
  }
  return (decks.find((d) => d.id === item.id)?.folderId ?? null) !== targetFolderId;
}

/** Valid move destinations for `item`: the library root (when allowed) plus
    every folder it may drop into, each labelled with its full path. */
export function moveDestinations(folders: Folder[], decks: Deck[], item: DragItem): MoveDestination[] {
  const destinations: MoveDestination[] = [];
  if (canDrop(folders, decks, item, null)) {
    destinations.push({ id: null, label: "Library root" });
  }
  for (const folder of folders) {
    if (canDrop(folders, decks, item, folder.id)) {
      destinations.push({
        id: folder.id,
        label: folderPath(folders, folder.id)
          .map((f) => f.name)
          .join(" / "),
      });
    }
  }
  return destinations;
}
