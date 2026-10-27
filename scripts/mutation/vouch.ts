/**
 * Which baselines one shared vitest run vouches for. Kept out of `run.ts` because that file awaits
 * `main()` at top level.
 */

/**
 * The keys of `keyed` (baseline key → the file filters it passes to `vitest run`) that a run
 * vouches for. A red run vouches for none, since an error outside any test fails a run without
 * failing a file. A green one vouches for a key only when one of its filters matched a file that
 * ran (`ran`, repo-relative), matched as `vitest run` does: a case-insensitive substring of the
 * path. A key whose filters matched nothing would be red on its own run.
 */
export function vouchedKeys(
  keyed: ReadonlyMap<string, readonly string[]>,
  green: boolean,
  ran: readonly string[],
): string[] {
  if (!green) return [];
  const files = ran.map((file) => file.toLowerCase());
  return [...keyed]
    .filter(([, filters]) =>
      filters.some((filter) => files.some((file) => file.includes(filter.toLowerCase()))),
    )
    .map(([key]) => key);
}
