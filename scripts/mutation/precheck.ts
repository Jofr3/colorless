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

// 🆕🆕 **D470 — THE SECOND PROPERTY THAT MAKES A ROW RUNNABLE: THE MUTATION APPLIED
// MUST EQUAL THE MUTATION DECLARED.** `run.ts` patches with `String.replace`, and a
// STRING second argument makes `$&`, `` $` ``, `$'` and `$1` SPLICE DIRECTIVES rather
// than literal bytes. Every anchor row in this corpus quotes its own pattern in a doc
// comment, so a `replace` carrying a regex `…$` immediately followed by a backtick
// writes the WHOLE PRECEDING FILE into the mutant. **Measured when this check was
// written: 11 of 2,111 rows, ten of them standing since D234, each 0.6–1.7 MB larger
// than declared.**
//
// 🛑 **AND THE CORRUPTION READS AS SUCCESS, WHICH IS WHY IT SURVIVED 236 DECISIONS**:
// the spliced file does not parse, vitest exits non-zero, and the row reports KILLED —
// D416's *a row that dies for the wrong reason is worth less than one that survives,
// because it reports success*. A DECLARED SURVIVOR gets the mirror image, a spurious
// `STALE-SURVIVOR` that fails the whole run. D470 fixed `run.ts` to a function
// replacement, which makes the harness immune; this check is what stops the class
// coming back through the DATA if that line is ever reverted, and it costs a string
// compare per row.
//
// 🛑 **AND THE SECOND PROPERTY IS DELEGATED RATHER THAN SPELLED HERE (D159), FOR A
// REASON THAT IS ABOUT ATTRIBUTION AND NOT ABOUT TIDINESS.** `spliceReport()` answers
// *does the harness apply the mutation it declares* — see `splice-gate.ts`. It cannot
// be this file's own `killedByCommand` killer, because the mutant that would test it
// mutates `run.ts`, and mutating `run.ts` ALSO makes that row's own `find` occur zero
// times, which the loop above already exits 1 for. The kill would be over-determined
// and the guard would be untestable while looking guarded — D205/D208's vacuous guard,
// arrived at through the checker rather than through the code. So the property lives in
// a script with no `find` check in it, and this one calls it so that the command
// everyone actually runs still reports it.
const splice = spliceReport();

// 🆕🆕 **D484 — THE THIRD PROPERTY, AND IT IS THE ONE THE CHECK ABOVE DOES NOT IMPLY:
// NO TWO ROWS MAY BE THE SAME EXPERIMENT.** `find` occurring exactly once is a
// PER-ROW property. D483 found two rows whose `find` strings both resolved to the
// SAME LINE — each occurring once, both patching it — for **46 decisions**, with both
// reporting KILLED every sweep while the arm one of them names had NO ROW AT ALL. The
// loop above was true throughout and could never have said so.
//
// 🛑 **AND THE PREDICATE IS NOT "no line carries two rows", WHICH D484 MEASURED AND
// REFUTED**: 383 lines carry more than one row, over 943 rows, and that is the corpus's
// central idiom rather than a defect. What is never legitimate is two rows the RUNNER
// CANNOT TELL APART — same file, find, replace, killers, survives — because that is one
// experiment reported as two. See `partition-gate.ts`, which also carries the wiring
// rung that asserts THIS call is here.
const partition = partitionReport();

console.log(`checked ${String(MUTANTS.length)} mutants`);
if (broken.length > 0) {
  console.error(`\n${String(broken.length)} BROKEN ROW(S):`);
  for (const row of broken) console.error(`  ${row}`);
}
if (!splice.ok) for (const line of splice.lines) console.error(line);
if (!partition.ok) for (const line of partition.lines) console.error(line);
if (broken.length > 0 || !splice.ok || !partition.ok) process.exit(1);
console.log(
  `every \`find\` occurs exactly once in its target, ${partition.lines[0] ?? ""}, and ${splice.lines[0] ?? ""} — corpus is runnable`,
);
