import { PROGRAM_ALIAS } from "./registryAliases.generated";

/**
 * The canonical printing of `id`'s print_key group: `id` itself when it is canonical or has no
 * reprint. Reprints share a print_key when their name and rules text match, so they play alike.
 */
export function canonicalPrinting(id: string): string {
  return CANONICAL_OF.get(id) ?? id;
}

const CANONICAL_OF: ReadonlyMap<string, string> = new Map(Object.entries(PROGRAM_ALIAS));

/** `ids` plus every printing that shares a print_key group with one of them. */
export function withReprints(ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const canonicals = new Set([...out].map(canonicalPrinting));
  for (const canonical of canonicals) out.add(canonical);
  for (const [member, canonical] of Object.entries(PROGRAM_ALIAS)) {
    if (canonicals.has(canonical)) out.add(member);
  }
  return out;
}
