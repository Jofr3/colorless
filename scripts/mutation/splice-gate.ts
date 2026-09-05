/**
 * 🆕🆕 D470 — THE GUARD FOR THE HARNESS'S OWN PATCHER, AND IT IS A CONJUNCTION ON
 * PURPOSE.
 *
 * `run.ts` applies a row by `text.replace(mutant.find, …)`. With a STRING second
 * argument, `String.prototype.replace` reads `$&`, `` $` ``, `$'`, `$$` and `$1` in
 * the REPLACEMENT as splice directives rather than as bytes. Every anchor row in this
 * corpus quotes its own regex in a doc comment, and a regex that ends `…$` immediately
 * followed by a backtick spells `` $` `` — *the entire portion of the file before the
 * match*. So the mutant written to disk is the declared one plus a megabyte of the
 * preceding file.
 *
 * 🛑 **AND THE CORRUPTION READS AS SUCCESS, WHICH IS WHY IT STOOD FOR 236 DECISIONS.**
 * The spliced file does not parse, vitest exits non-zero, and the row reports KILLED —
 * D416's *a row that dies for the wrong reason is worth less than one that survives,
 * because it reports success*. A DECLARED SURVIVOR gets the mirror image: a spurious
 * `STALE-SURVIVOR` that fails the whole run and sends its author to re-derive a reason
 * that was correct all along. **Measured when this file was written: 11 of 2,113 rows,
 * TEN of them standing since D234, each 0.6–1.7 MB larger than declared.** All ten were
 * re-measured by applying their replacement LITERALLY and running their own
 * `expectKilledBy`: all ten are genuinely KILLED, so D470's one-line fix changed no
 * verdict — it changed what the verdicts MEAN.
 *
 * ─── WHY A SCRIPT AND NOT A VITEST SUITE ─────────────────────────────────────────
 * `scripts/**` is deliberately outside `tsc -b`'s references and vitest's globs
 * (conventions.md, "Where dev scripts sit"), so a guard over the harness is named from
 * a mutant row's `killedByCommand`. D212's lint-coverage guard set the precedent and
 * D411's recovery gate is the second; this is the third.
 *
 * ─── WHY NOT INSIDE `precheck.ts`, WHERE IT WAS FIRST WRITTEN ────────────────────
 * 🛑 **BECAUSE THE MUTANT THAT TESTS IT MUTATES `run.ts`, AND `precheck.ts` ALREADY
 * EXITS 1 WHENEVER A ROW'S `find` MOVES.** Mutating `run.ts` makes that row's own
 * `find` occur zero times, so `precheck` would have gone red either way and the guard
 * would have been UNTESTABLE WHILE LOOKING GUARDED — D205/D208's vacuous guard,
 * reached through the checker rather than through the code. Verified by hand before
 * this file existed: with the guard deleted and `run.ts` reverted, `precheck` still
 * exited 1. This file has no `find` check in it, so a red here is attributable.
 * `precheck.ts` imports `spliceReport()` so the command everyone runs still reports it.
 *
 * ─── WHY A CONJUNCTION AND NOT A CHECK ON THE ROWS ───────────────────────────────
 * ⚠️ A `$` in a `replace` is only a defect IF THE PATCHER INTERPRETS IT. With the
 * function replacement in place all 11 rows are correct exactly as written, and
 * "repairing" them by doubling the `$` would write a literal `$$` into the mutant —
 * the repair would BE the defect (D438's polarity rule, at an instrument). So the
 * failure condition is: rows a string patcher would corrupt AND a patcher that is one.
 * The count is REPORTED on the green path too, because a guard whose subject can drift
 * to zero without saying so is one refactor away from vacuous.
 *
 *   bun scripts/mutation/splice-gate.ts
 */

import { readFileSync } from "node:fs";
import { MUTANTS } from "./mutants";

/** The file whose patching behaviour this gate is about. */
const APPLY_SITE = "scripts/mutation/run.ts";
/** The exact form that makes `run.ts` patch LITERALLY. A function replacement receives
    the match and returns bytes; no `$` in its return value is ever interpreted. */
const FUNCTION_REPLACEMENT = "text.replace(mutant.find, () => mutant.replace)";

export type SpliceReport = {
  /** True when no row can be corrupted, or when the patcher cannot corrupt one. */
  ok: boolean;
  /** Human-readable lines; `lines[0]` is the one-line summary on the green path. */
  lines: string[];
  /** How many rows depend on the patcher being literal. Reported, never asserted —
      it is a population and it moves whenever a row is written. */
  spliceable: number;
};

export function spliceReport(): SpliceReport {
  const sources = new Map<string, string>();
  const sourceOf = (file: string): string => {
    const cached = sources.get(file);
    if (cached !== undefined) return cached;
    const text = readFileSync(file, "utf8");
    sources.set(file, text);
    return text;
  };

  const patchesLiterally = sourceOf(APPLY_SITE).includes(FUNCTION_REPLACEMENT);

  const spliceable: string[] = [];
  for (const mutant of MUTANTS) {
    let text: string;
    try {
      text = sourceOf(mutant.file);
    } catch {
      continue; // a missing target is `precheck`'s business, not this gate's
    }
    if (!text.includes(mutant.find)) continue;
    const applied = text.replace(mutant.find, mutant.replace);
    const literal = text.split(mutant.find).join(mutant.replace);
    if (applied !== literal) {
      spliceable.push(
        `      ${mutant.id}: ${String(applied.length - literal.length)} unintended byte(s) in ${mutant.file}`,
      );
    }
  }

  if (patchesLiterally) {
    return {
      ok: true,
      lines: [
        `${APPLY_SITE} patches LITERALLY (${String(spliceable.length)} row(s) depend on it)`,
      ],
      spliceable: spliceable.length,
    };
  }
  return {
    ok: spliceable.length === 0,
    lines: [
      `\n🛑 splice-gate: ${APPLY_SITE} NO LONGER PATCHES LITERALLY — expected \`${FUNCTION_REPLACEMENT}\`.`,
      `   ${String(spliceable.length)} row(s) would be SILENTLY CORRUPTED, each reporting KILLED for a`,
      "   file that does not parse rather than for the defect it declares (D416):",
      ...spliceable,
      "",
    ],
    spliceable: spliceable.length,
  };
}

function main(): void {
  const report = spliceReport();
  if (!report.ok) {
    for (const line of report.lines) console.error(line);
    process.exit(1);
  }
  console.log(`splice-gate: OK — ${report.lines[0] ?? ""}.`);
}

// Only when RUN, never when IMPORTED — `precheck.ts` calls `spliceReport()` and must
// not inherit this file's console output or its exit.
if (import.meta.main) main();
