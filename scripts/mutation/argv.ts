/**
 * 🆕🆕 D511 — THE MUTATION HARNESS'S ARGUMENT VALIDATOR.
 *
 * WHY THIS FILE EXISTS, AND IT IS NOT A STYLE PREFERENCE. `run.ts` read its argv
 * with `argv.includes("--full")` and `argv.indexOf("--only") + 1`, which means an
 * argument it does not recognise is not an error — it is INVISIBLE. Two paths, one
 * consequence, both measured at D510:
 *
 *   PATH 1 — AN UNKNOWN FLAG IS SILENTLY IGNORED. `--id <row>` sets neither `only`
 *   nor `decision`; both stay `undefined`; and `undefined` is spelled "no filter"
 *   in the selector, so every one of the 2,541 rows passes it. The "probe" is a
 *   ~3-hour WHOLE-CORPUS SWEEP wearing a one-row probe's first ten seconds of
 *   output. D510 typed it three times. Two of those ran CONCURRENTLY, were killed
 *   on a timeout, and left FOURTEEN mutant patches across five source files —
 *   three of them files the slice was editing at that moment.
 *
 *   🛑 AND `bun run check` WAS GREEN ON ONE OF THOSE TREES, which is the part that
 *   makes this worth a file. A mutant is by construction a plausible edit: it
 *   compiles, it lints, and the suite that would have killed it has already been
 *   restored out from under it. So a mistyped flag reaches a state that looks
 *   healthy to the repo's own gate and silently corrupts the next commit.
 *
 *   PATH 2 — A FLAG WHOSE VALUE IS MISSING IS THE SAME DEFECT, SPELLED DIFFERENTLY.
 *   `flagValue` returns `argv[index + 1]`, so a TRAILING `--only` yields `undefined`
 *   — which reads as "no filter" and runs the whole corpus exactly as Path 1 does.
 *   ⚠️ And a value-shaped-like-a-flag is a THIRD wrong answer, not the same one:
 *   `--only --full` takes the literal string `"--full"` as the row id, selects
 *   nothing, and exits 2 — loud, but about the wrong thing.
 *
 * ─── WHY A SEPARATE MODULE AND NOT A FUNCTION INSIDE `run.ts` ────────────────────
 * 🛑 BECAUSE `run.ts` HAS A TOP-LEVEL `await main()`. Importing it from a suite runs
 * the mutation harness inside vitest — which is why D504's guard reads `run.ts` as
 * RAW TEXT rather than importing it. A validator that lived there could therefore be
 * checked only by pattern-matching its source, and a guard that reads a function's
 * BYTES instead of calling it is the vacuous-guard shape this repo has paid for
 * three times (D200 → D204 → D205). This module has no top-level effect of any kind,
 * so `mutationArgvGuard.test.ts` can DRIVE it. The wiring — that `run.ts` actually
 * calls it, and calls it FIRST — is the one part that still has to be read as text,
 * and that suite reads it as text and says so.
 *
 * ─── WHAT THIS FILE DELIBERATELY DOES NOT DO ────────────────────────────────────
 *   • It does not interpret the values. `--only nonsense` is a well-formed command
 *     line; the harness answers it with "No mutants selected." and exit 2, which is
 *     already loud. This guard is about arguments that are silently DROPPED.
 *   • 🛑 IT DOES NOT TOUCH `--decision`'s SUBSTRING MATCH, and that is a decision
 *     rather than an omission. `run.ts` selects with `m.decision.includes(decision)`,
 *     so `--decision D51` matches `D510` AND `D511`. Tempting to tighten — and
 *     tightening it would BREAK THE CORPUS, measured rather than guessed: of 302
 *     distinct `decision` strings, five are not bare ids — `D192 (inheriting D161)`,
 *     `D192 (inheriting D159)`, `D204 (vs D200 predicate)`, `D204/D205`, and
 *     `D209 (as flipped by D210)`. Under an exact match `--decision D192` would stop
 *     finding two of its own rows and `--decision D205` would stop finding the
 *     `D204/D205` pair — a filter that silently returns FEWER rows than asked for,
 *     which is this file's own defect pointing the other way. The substring match is
 *     load-bearing. It stays.
 */

/** Flags that stand alone. */
export const BOOLEAN_FLAGS: readonly string[] = ["--list", "--full", "--verbose", "--allow-dirty"];

/** Flags that consume the NEXT argv entry as their value.
    ⚠️ Neither accumulates and neither is repeatable — `--only` takes ONE
    comma-separated list and `--decision` ONE value. That is `run.ts`'s documented
    behaviour and this file does not change it; it makes the second occurrence,
    which `indexOf` has always thrown away, say so out loud. */
export const VALUE_FLAGS: readonly string[] = ["--only", "--decision"];

/** 🛑 THE KNOWN SET, AND THE ONLY DEFINITION OF IT. `mutationArgvGuard.test.ts`
    derives the flags `run.ts` actually READS out of `run.ts`'s own text and requires
    the two to agree, so a flag added to the harness without being registered here —
    or registered here and never read — goes red rather than drifting. */
export const KNOWN_FLAGS: readonly string[] = [...BOOLEAN_FLAGS, ...VALUE_FLAGS];

/** The usage line, DERIVED so there is no second copy of the flag list to rot. */
export function knownFlagsUsage(): string {
  return KNOWN_FLAGS.map((f) => (VALUE_FLAGS.includes(f) ? `${f} <value>` : f)).join("  ");
}

/**
 * Every reason this command line must not be run, in the order the arguments appear.
 * An empty array means the line is well formed — it does NOT mean it selects anything.
 *
 * ⚠️ A BARE POSITIONAL IS REJECTED, which is a judgement and not a technicality.
 * `run.ts` reads no positional argument anywhere, so one can only ever be a mistake —
 * and the mistake it is USUALLY made by is the one this file exists for: a typo'd or
 * unknown value-flag leaves its row id stranded (`--id D470-harness-splices-…`
 * strands the id). Ignoring it is the same silent drop, one token to the right.
 */
export function argvProblems(argv: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";

    if (!KNOWN_FLAGS.includes(arg)) {
      problems.push(
        arg.startsWith("-")
          ? `unknown flag \`${arg}\` — it would have been IGNORED, and an ignored selector runs the WHOLE corpus`
          : `unexpected argument \`${arg}\` — this harness takes no positional arguments, so it was about to be dropped (did you mean \`--only ${arg}\`?)`,
      );
      continue;
    }

    if (seen.has(arg)) {
      problems.push(
        `\`${arg}\` given more than once — it does not accumulate, so every occurrence but the first is discarded`,
      );
    }
    seen.add(arg);

    if (!VALUE_FLAGS.includes(arg)) continue;

    const value = argv[i + 1];
    if (value === undefined) {
      problems.push(
        `\`${arg}\` needs a value and is the last argument — an absent value reads as NO FILTER, which runs the WHOLE corpus`,
      );
      continue;
    }
    if (value.startsWith("-")) {
      problems.push(
        `\`${arg}\` needs a value but the next argument is \`${value}\` — it would have been taken as the value itself`,
      );
      continue; // do NOT consume it: it is validated on its own terms next pass
    }
    i += 1; // consumed as this flag's value
  }

  return problems;
}
