// Pure validation helpers for the /decks routes, with no Worker types and no queries, so every
// branch unit-tests as a plain function. routes.ts owns the D1 access and feeds these the rows.

/** The requested ids missing from `known`, the 400 payload's offenders (unknown cards on create
    and patch). Preserves request order and reports each missing id once. */
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
