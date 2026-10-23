/**
 * Argument validator for the mutation harness: an unknown flag or a missing value would otherwise
 * be silently ignored and run the whole corpus. Kept out of `run.ts` because that file awaits
 * `main()` at top level. `--decision` keeps substring matching on purpose, since some decision
 * strings are not bare ids.
 */

/** Flags that stand alone. */
export const BOOLEAN_FLAGS: readonly string[] = ["--list", "--full", "--verbose", "--allow-dirty"];

/**
 * Flags that consume the next argv entry. Neither is repeatable; a second occurrence is reported.
 */
export const VALUE_FLAGS: readonly string[] = ["--only", "--decision"];

/** The known flags; must match the flags `run.ts` reads. */
export const KNOWN_FLAGS: readonly string[] = [...BOOLEAN_FLAGS, ...VALUE_FLAGS];

/** The usage line, DERIVED so there is no second copy of the flag list to rot. */
export function knownFlagsUsage(): string {
  return KNOWN_FLAGS.map((f) => (VALUE_FLAGS.includes(f) ? `${f} <value>` : f)).join("  ");
}

/**
 * Every reason this command line must not run, in argument order; empty means well formed, not that
 * it selects anything. Positionals are rejected because `run.ts` reads none and one usually means a
 * mistyped flag.
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
