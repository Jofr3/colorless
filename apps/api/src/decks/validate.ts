// Pure validation helpers for the /decks + /folders routes (§6) — no Worker
// types, no queries, so every branch unit-tests as a plain function.
// routes.ts owns the D1 access and feeds these the fetched rows.

/** Parent pointers for ONE user's folders: id → parentId (null at the root). */
export type ParentById = ReadonlyMap<string, string | null>;

/**
 * Would re-parenting `folderId` under `newParentId` create a cycle? Walks the
 * ancestor chain of the TARGET parent: hitting `folderId` means the folder
 * would become its own ancestor (`newParentId === folderId` is the zero-step
 * self-parent case). The `visited` set is corruption armor — parent data with
 * a pre-existing loop terminates instead of spinning.
 */
export function createsCycle(parents: ParentById, folderId: string, newParentId: string): boolean {
  const visited = new Set<string>();
  let current: string | null = newParentId;
  while (current !== null && !visited.has(current)) {
    if (current === folderId) {
      return true;
    }
    visited.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

/** The requested ids missing from `known` — the 400 payload's offenders
    (unknown cards on create/patch, unknown decks/folders on reorder).
    Preserves request order and reports each missing id once. */
export function unknownIds(requested: string[], known: Iterable<string>): string[] {
  const knownSet = new Set(known);
  const missing: string[] = [];
  for (const id of requested) {
    if (!knownSet.has(id) && !missing.includes(id)) {
      missing.push(id);
    }
  }
  return missing;
}
