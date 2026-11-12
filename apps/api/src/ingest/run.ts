// The ingest CLI's run decisions (apps/api/scripts/ingest.ts), kept here so they are unit-tested:
// bounded fetching, counting the rows remote applies wrote, whether to stamp a new catalog epoch,
// the legality guard, and the exit status. Not re-exported from ./index.ts: the Worker never runs
// an ingest.

import type { TcgdexCard } from "@colorless/schema";
import { type CardRow, unresolvedEvolutions } from "./map";

/** Runs `task` over `items` with at most `limit` running at once; results keep input order. The
    first failure rejects the whole run and stops the other workers from claiming more items. */
export async function mapBounded<Item, Result>(
  items: readonly Item[],
  limit: number,
  task: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await task(items[index] as Item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The `rows_written` a `wrangler d1 execute --json` printed, or null when it printed none. */
export function rowsWrittenOf(stdout: string): number | null {
  try {
    const statements = JSON.parse(stdout) as { meta?: { rows_written?: unknown } }[];
    const counts = statements.map((statement) => statement.meta?.rows_written);
    return counts.every((n) => typeof n === "number")
      ? counts.reduce<number>((sum, n) => sum + (n as number), 0)
      : null;
  } catch {
    return null;
  }
}

export interface RowsTally {
  /** Rows written by every apply so far, or null once any count is unknown. */
  readonly total: number | null;
  /** Counts an apply that exited 0; returns the rows it reported, or null. */
  applied(stdout: string): number | null;
  /** An apply that exited non-zero. A remote import can commit and still fail on the way back
      (a lost connection, a killed wrangler), so its rows are unknown, not zero. */
  failed(): void;
}

/** Local wrangler prints no count, so a local run starts, and stays, unknown. */
export function createRowsTally(remote: boolean): RowsTally {
  let total: number | null = remote ? 0 : null;
  return {
    get total() {
      return total;
    },
    applied(stdout) {
      const written = rowsWrittenOf(stdout);
      total = total === null || written === null ? null : total + written;
      return written;
    },
    failed() {
      total = null;
    },
  };
}

/** A run known to have written nothing changed no response, so it keeps the cached pages and the
    KV writes refilling them would spend. An unknown count stamps; a dry run reports the stamp. */
export function shouldStampEpoch(rowsWritten: number | null, dryRun: boolean): boolean {
  return dryRun || rowsWritten !== 0;
}

/**
 * The cards tcgdex now sends without `legal` whose stored row is legal in some format. An absent
 * `legal` maps to legal nowhere, so upstream dropping the field would quietly rewrite legality for
 * the whole catalog. A card never stored passes, so a set published before its legality still
 * ingests. `storedLegal` is asked only about the cards that lack `legal`, which is normally none.
 */
export function legalityDrift(
  cards: readonly TcgdexCard[],
  storedLegal: (ids: readonly string[]) => ReadonlySet<string>,
): string[] {
  const unlegaled = cards.filter((card) => card.legal === undefined).map((card) => card.id);
  if (unlegaled.length === 0) return [];
  const legal = storedLegal(unlegaled);
  return unlegaled.filter((id) => legal.has(id));
}

export interface RunSummary {
  failedSets: readonly string[];
  weakless: readonly string[];
  evolutionless: readonly string[];
  evolvingBasics: readonly string[];
  unresolvedEvolutions: readonly string[];
  /** The catalog's names could not be read, so unresolvedEvolutions was not checked. */
  namesUnread: boolean;
  typelessEnergies: readonly string[];
  ruleBoxMismatches: readonly string[];
  epochStamped: boolean;
  postPassFailed: boolean;
}

/** Non-zero when anything in the run needs a person: a failed set, a Pokémon owed a supplement
    entry or with an evolution the engine cannot play, an Energy with no type, a Prize value or
    suffix its printed family disagrees with, a missing epoch stamp or a failed whole-table
    reprint pass. */
export function exitCode(summary: RunSummary): 0 | 1 {
  return summary.failedSets.length > 0 ||
    summary.weakless.length > 0 ||
    summary.evolutionless.length > 0 ||
    summary.evolvingBasics.length > 0 ||
    summary.unresolvedEvolutions.length > 0 ||
    summary.namesUnread ||
    summary.typelessEnergies.length > 0 ||
    summary.ruleBoxMismatches.length > 0 ||
    !summary.epochStamped ||
    summary.postPassFailed
    ? 1
    : 0;
}

/** The command that retries only `setIds`, with the same target and transport. */
export function rerunCommand(
  setIds: readonly string[],
  options: { remote: boolean; transport?: string },
): string {
  return [
    "bun scripts/ingest.ts",
    `--sets ${setIds.join(",")}`,
    ...(options.remote ? ["--remote"] : []),
    ...(options.transport === undefined ? [] : [`--transport ${options.transport}`]),
  ].join(" ");
}

/** The "evolution names" step, run once every set is written: each of `evolvers`' `evolveFrom`
    against this run's names and those `readNames` lists from the target, so an evolution may name
    a card of any set and a dry run still resolves its own. A failed read checks nothing and says
    so, which exits 1. */
export function evolutionNamesCheck(
  evolvers: readonly CardRow[],
  runNames: ReadonlySet<string>,
  readNames: () => readonly Record<string, unknown>[],
): { unresolved: string[]; names: number } | { unread: string } {
  let stored: readonly Record<string, unknown>[];
  try {
    stored = readNames();
  } catch (error) {
    return { unread: error instanceof Error ? error.message : String(error) };
  }
  const names = new Set(runNames);
  for (const row of stored) names.add(String(row.name));
  return { unresolved: unresolvedEvolutions(evolvers, names), names: names.size };
}
