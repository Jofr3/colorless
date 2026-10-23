/**
 * A mutant's patch: the one occurrence of `find` replaced by `replace`, byte for byte. A function
 * replacement, because a string one would interpret `$&`, `` $` ``, `$'` and `$1` in `replace`.
 */
export function applyMutant(text: string, find: string, replace: string): string {
  return text.replace(find, () => replace);
}
