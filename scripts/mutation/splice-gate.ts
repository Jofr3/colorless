/**
 * Splice gate: fails when corpus rows contain `$` sequences a string `replace` would interpret and
 * `run.ts` patches with a string replacement. Both conditions are required; with a function
 * replacement those rows are correct as written. The count is reported even when green.
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
      lines: [`${APPLY_SITE} patches LITERALLY (${String(spliceable.length)} row(s) depend on it)`],
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
