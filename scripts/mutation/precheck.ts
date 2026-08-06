// D242 — THE CHEAP PRE-CHECK D241's FORMATTER INCIDENT BOUGHT.
//
// A `find` string is a dependency on SOURCE FORMATTING, and nothing else in this
// repo can see it: `bun run check` is green with a broken corpus, `git diff` shows
// the change in the SOURCE file rather than in `mutants.ts`, and a `--decision`
// run only exercises the rows it was asked for. D241 ran `biome format --write`
// over three target files and silently broke SIX pre-existing rows; the full
// corpus caught it AFTER the commit.
//
// This asserts the one property that makes a row runnable, over the WHOLE corpus,
// in about a second and with no mutant executed: **every `find` must occur
// EXACTLY ONCE in its target file.** Zero is a row whose code moved; two is a row
// whose patch site is ambiguous.
//
//   bun scripts/mutation/precheck.ts
//
// Run it before `bun run mutants`, and ALWAYS after any formatter pass over a
// file that appears in `MUTANTS`.

import { readFileSync } from "node:fs";
import { MUTANTS } from "./mutants";

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

console.log(`checked ${String(MUTANTS.length)} mutants`);
if (broken.length > 0) {
  console.error(`\n${String(broken.length)} BROKEN ROW(S):`);
  for (const row of broken) console.error(`  ${row}`);
  process.exit(1);
}
console.log("every `find` occurs exactly once in its target — corpus is runnable");
