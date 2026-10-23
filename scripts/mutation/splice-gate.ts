/**
 * Splice gate: fails when `applyMutant` would not patch a corpus row literally, which happens if it
 * ever becomes a string replacement and a row's `replace` holds a `$` sequence. The count of rows
 * that depend on literal patching is reported even when green.
 *
 *   bun scripts/mutation/splice-gate.ts
 */

import { runReport, wiringProblems } from "../lib/cli";
import { sourceCache } from "../lib/repo";
import { applyMutant } from "./apply";
import { MUTANTS } from "./mutants";

/** The runner, which must patch through `applyMutant`. */
const APPLY_SITE = "scripts/mutation/run.ts";
const APPLY_CALL = "applyMutant(";

export type SpliceReport = {
  /** True when every row is patched literally. */
  ok: boolean;
  /** Human-readable lines; `lines[0]` is the one-line summary on the green path. */
  lines: string[];
  /** How many rows a string replacement would corrupt. Reported, never asserted. */
  spliceable: number;
};

export function spliceReport(): SpliceReport {
  const sourceOf = sourceCache();
  const spliceable: string[] = [];
  const corrupted: string[] = [];
  for (const mutant of MUTANTS) {
    let text: string;
    try {
      text = sourceOf(mutant.file);
    } catch {
      continue; // a missing target is `precheck`'s business, not this gate's
    }
    if (!text.includes(mutant.find)) continue;
    const literal = text.split(mutant.find).join(mutant.replace);
    const viaString = text.replace(mutant.find, mutant.replace);
    if (viaString !== literal) {
      spliceable.push(
        `      ${mutant.id}: ${String(viaString.length - literal.length)} unintended byte(s) in ${mutant.file}`,
      );
    }
    if (applyMutant(text, mutant.find, mutant.replace) !== literal) {
      corrupted.push(`      ${mutant.id} in ${mutant.file}`);
    }
  }

  const wiring = wiringProblems("splice-gate", APPLY_SITE, APPLY_CALL);
  if (wiring.length > 0) return { ok: false, lines: wiring, spliceable: spliceable.length };
  if (corrupted.length === 0) {
    return {
      ok: true,
      lines: [`${APPLY_SITE} patches LITERALLY (${String(spliceable.length)} row(s) depend on it)`],
      spliceable: spliceable.length,
    };
  }
  return {
    ok: false,
    lines: [
      "\n🛑 splice-gate: applyMutant NO LONGER PATCHES LITERALLY.",
      `   ${String(corrupted.length)} row(s) would be SILENTLY CORRUPTED, each reporting KILLED for a`,
      "   file that does not parse rather than for the defect it declares:",
      ...corrupted,
      "",
    ],
    spliceable: spliceable.length,
  };
}

if (import.meta.main) runReport("splice-gate", spliceReport);
