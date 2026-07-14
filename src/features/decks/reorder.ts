// Pure helpers for manual drag-to-reorder of the decks/folders grids. Kept out
// of the component and the pointer hook so the insertion math and the array
// surgery are unit-testable without a DOM — see useDeckDrag (live drag) for the
// pointer plumbing and Decks (commit) for where these are applied to state.

/** The bits of a tile's getBoundingClientRect the insertion hit-test needs. */
export interface ReorderRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Insertion slot for a tile dropped at (x, y) into a grid laid out in reading
    order (row-major). Walks the siblings — the group minus the dragged tile, in
    visible order — and returns the index of the first one the pointer sits
    *before*: in a row above it, or within its row and left of its centre. Past
    everything → append (siblings.length). Reads real rects, so it works for any
    column count, including a single column (where it reduces to top/bottom). */
export function insertionIndex(siblings: ReorderRect[], x: number, y: number): number {
  for (let i = 0; i < siblings.length; i += 1) {
    const s = siblings[i];
    if (!s) continue;
    if (y < s.top) return i;
    if (y <= s.bottom && x < (s.left + s.right) / 2) return i;
  }
  return siblings.length;
}

/** The visible id order after lifting `draggedId` out and re-inserting it at
    `index` among the others. `index` is clamped, so an out-of-range value is
    safe; dropping it back at its own slot round-trips to the original order. */
export function previewOrder(visibleIds: string[], draggedId: string, index: number): string[] {
  const without = visibleIds.filter((id) => id !== draggedId);
  const at = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, at), draggedId, ...without.slice(at)];
}

/** Rewrite a flat library array so the items matching `inView` take the order in
    `orderedIds`, while every out-of-view item keeps its exact slot. Only the
    in-view items' relative order changes — they refill the same slots they
    occupied, and each slot's occupant inherits the slot's server `position`
    (the array is position-sorted, so array surgery and position rewrite are
    the same permutation). `changes` lists exactly the rows whose position
    changed — the reorder endpoint's payload. Ids in `orderedIds` with no
    matching item are skipped; in-view slots left without an id keep their
    original item (defensive, shouldn't happen when `orderedIds` is a
    permutation of the in-view ids). */
export function applyReorder<T extends { id: string; position: number }>(
  all: T[],
  inView: (item: T) => boolean,
  orderedIds: string[],
): { items: T[]; changes: { id: string; position: number }[] } {
  const byId = new Map(all.map((item) => [item.id, item] as const));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((item): item is T => item !== undefined);
  const changes: { id: string; position: number }[] = [];
  let cursor = 0;
  const items = all.map((item) => {
    if (!inView(item)) return item;
    const incoming = ordered[cursor++] ?? item;
    if (incoming.id === item.id) return item;
    changes.push({ id: incoming.id, position: item.position });
    return { ...incoming, position: item.position };
  });
  return { items, changes };
}

/** Whether two id sequences are identical (same length, same order). Used to
    skip a no-op reorder so a pick-up-and-drop-in-place doesn't flip the sort. */
export function sameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}
