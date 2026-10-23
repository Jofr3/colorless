// Cheap pre-check: every mutant `find` must occur exactly once in its target file. Zero means the
// code moved; two means the patch site is ambiguous.
//
//   bun scripts/mutation/precheck.ts
//
// Run it before `bun run mutants` and after any formatter pass over a file in `MUTANTS`.

import { readFileSync } from "node:fs";
import { bindingReport } from "./binding-gate";
import { MUTANTS } from "./mutants";
import { partitionReport } from "./partition-gate";
import { spliceReport } from "./splice-gate";

const sources = new Map<string, string>();
function sourceOf(file: string): string {
  const cached = sources.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(file, "utf8");
  sources.set(file, text);
  return text;
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

const broken: string[] = [];
for (const mutant of MUTANTS) {
  const n = occurrences(sourceOf(mutant.file), mutant.find);
  if (n !== 1) broken.push(`${mutant.id}: find occurs ${String(n)}× in ${mutant.file}`);
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
