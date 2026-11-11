// Cheap pre-check: every mutant `find` must occur exactly once in its target file. Zero means the
// code moved; two means the patch site is ambiguous. No two rows may carry one id.
//
//   bun scripts/mutation/precheck.ts
//
// Run it before `bun run mutants` and after any formatter pass over a file in `MUTANTS`.

import { existsSync } from "node:fs";
import { repoPath, sourceCache } from "../lib/repo";
import { bindingReport } from "./binding-gate";
import { MUTANTS, type Mutant } from "./mutants";
import { partitionReport } from "./partition-gate";
import { spliceReport } from "./splice-gate";
import { currentSymbol } from "./symbol";

const sourceOf = sourceCache();

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

const CORPUS = "scripts/mutation/mutants.ts";

/** A row on the corpus file whose only match is its own `find` or `replace` literal mutates a
    string nothing reads, so it can never be killed. */
function matchesItself(file: string, text: string, find: string): boolean {
  if (file !== CORPUS) return false;
  const at = text.indexOf(find);
  const line = text.slice(text.lastIndexOf("\n", at) + 1, at);
  return /^\s*(find|replace): ['"`]$/.test(line);
}

/** Ids more than one row carries: `--only <id>` would run them all, and reanchor would give one
    row the other's fix. */
export function duplicateIds(rows: readonly Pick<Mutant, "id">[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const { id } of rows) (seen.has(id) ? twice : seen).add(id);
  return [...twice];
}

function main(): void {
  const broken: string[] = duplicateIds(MUTANTS).map(
    (id) => `${id}: more than one row carries this id`,
  );
  for (const mutant of MUTANTS) {
    if (!existsSync(repoPath(mutant.file))) {
      broken.push(`${mutant.id}: ${mutant.file} does not exist`);
      continue;
    }
    const n = occurrences(sourceOf(mutant.file), mutant.find);
    if (n !== 1) broken.push(`${mutant.id}: find occurs ${String(n)}× in ${mutant.file}`);
    else if (matchesItself(mutant.file, sourceOf(mutant.file), mutant.find))
      broken.push(`${mutant.id}: find matches only the row's own literal; its target is gone`);
    else if (currentSymbol(mutant, sourceOf(mutant.file)) !== mutant.symbol)
      broken.push(
        `${mutant.id}: find no longer sits in symbol ${JSON.stringify(mutant.symbol)}; re-point it if it landed on a twin, or run \`bun scripts/mutation/reanchor.ts --write --accept-symbols\` after a rename`,
      );
  }

  // Splice check, delegated to `splice-gate.ts`: a string replacement would interpret `$` sequences
  // in a row's `replace`. It lives in a separate script so a mutant of `run.ts` is attributable.
  const splice = spliceReport();

  // Partition check (`partition-gate.ts`): no two rows may be indistinguishable to the runner.
  const partition = partitionReport();

  // Binding check (`binding-gate.ts`): a row must not die on an identifier its patch never bound.
  const binding = bindingReport();

  console.log(`checked ${String(MUTANTS.length)} mutants`);
  if (broken.length > 0) {
    console.error(`\n${String(broken.length)} BROKEN ROW(S):`);
    for (const row of broken) console.error(`  ${row}`);
  }
  if (!splice.ok) for (const line of splice.lines) console.error(line);
  if (!partition.ok) for (const line of partition.lines) console.error(line);
  if (!binding.ok) for (const line of binding.lines) console.error(line);
  if (broken.length > 0 || !splice.ok || !partition.ok || !binding.ok) process.exit(1);
  console.log(
    `every \`find\` occurs exactly once in its target, ${partition.lines[0] ?? ""}, ${binding.lines[0] ?? ""}, and ${splice.lines[0] ?? ""} — corpus is runnable`,
  );
}

if (import.meta.main) main();
