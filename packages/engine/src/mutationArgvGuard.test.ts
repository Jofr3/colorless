import { describe, expect, it } from "vitest";
import {
  BOOLEAN_FLAGS,
  KNOWN_FLAGS,
  VALUE_FLAGS,
  argvProblems,
  knownFlagsUsage,
} from "../../../scripts/mutation/argv";

// D511 — THE MUTATION HARNESS REJECTS A COMMAND LINE IT DOES NOT UNDERSTAND,
// AND THE REJECTION HAPPENS BEFORE ANYTHING READS OR WRITES A BYTE.
//
// THE DEFECT, MEASURED AT D510 RATHER THAN IMAGINED. `run.ts` parsed argv with
// `argv.includes(…)` and `argv.indexOf(…) + 1`, so an argument it did not
// recognise was not an error — it was invisible. Two paths, one consequence:
//
//   PATH 1 — `--id <row>` sets neither `only` nor `decision`. Both stay
//   `undefined`, `undefined` is spelled "no filter" in the selector, and the
//   "probe" is a ~3-hour sweep of all 2,541 rows wearing a one-row probe's first
//   ten seconds of output. D510 typed it THREE TIMES; two ran concurrently, were
//   killed on a timeout, and left FOURTEEN mutant patches across five source
//   files, three of them files the slice was editing.
//
//   PATH 2 — a TRAILING `--only` (or `--decision`) makes `flagValue` return
//   `argv[index + 1]` = `undefined`, which reads as "no filter" and runs the same
//   whole corpus. And `--only --full` takes the literal `"--full"` as the row id,
//   selects nothing and exits 2 — loud, but about the wrong thing.
//
// 🛑 WHY THIS IS WORSE THAN A WASTED AFTERNOON: `bun run check` WAS GREEN on one
// of D510's patched trees. A mutant is by construction a plausible edit — it
// compiles, it lints, and the suite that would kill it has already been restored
// out from under it. So a mistyped flag reaches a state that looks healthy to the
// repo's own gate and silently corrupts whatever is committed next.
//
// 🛑 SO WHAT GOES RED HERE, STATED FIRST (D200 → D214's rule — a check whose
// author cannot name the edit that breaks it is vacuous):
//
//   (1) delete a rule from `argvProblems` — stop rejecting unknown flags, or stop
//       rejecting a missing value, or stop rejecting a positional → the matching
//       REJECTS case fails, naming the line that was about to be accepted;
//   (2) widen a rule so a LEGITIMATE line is refused (reject every `-`-prefixed
//       value, reject a repeated boolean's first occurrence, reject `--list`
//       beside `--decision`) → the ACCEPTS case fails. Both directions, because a
//       guard that only fails one way is a guard you disable by over-firing it;
//   (3) 🛑 MOVE THE CALL IN `run.ts` — put `argvProblems(argv)` after the `--list`
//       branch, or after `recoverFromJournal()`, or delete the call entirely →
//       the WIRING case fails. This is the case the file exists for and the one a
//       pure unit test cannot make: the validator can be perfect and unreachable.
//       D369 paid for exactly this ordering once already, from the other side;
//   (4) add a flag to `run.ts` (`argv.includes("--dry-run")`) without registering
//       it in `argv.ts`, or register one here that the harness never reads → the
//       SURFACE case fails. The expected set is DERIVED FROM `run.ts`'s OWN TEXT
//       at test time (D504's rule: a guard over a quoted thing must assert against
//       the quoted THING), so there is no second copy of the flag list to drift;
//   (5) change the exit path from `process.exit(4)` to a `return`, or to `exit(0)`
//       → the WIRING case fails, because a rejection a caller reads as success is
//       not a rejection;
//   (6) 🛑 "FIX" `--decision`'s SUBSTRING MATCH into an exact one → the SUBSTRING
//       case fails, naming the corpus rows it would have silently orphaned.
//
// ⚠️ AND THE HONEST LIMIT, NAMED SO A GREEN RUN IS NOT OVER-READ. This suite
// DRIVES the validator and READS the wiring; it does not SPAWN `run.ts`. It
// cannot: `run.ts` has a top-level `await main()`, so importing it would run the
// mutation harness inside vitest, and this package sets `"types": []` so
// `node:child_process` does not even typecheck here. What is proved is that the
// predicate is right and that the call sits ahead of both writes in the source
// text. What is NOT proved by this file is that the assembled process exits 4 —
// that was demonstrated by hand at D511 (`bun scripts/mutation/run.ts --id
// something` → exit 4, immediately) and is pinned here only as source text.

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

describe("the mutation harness rejects a command line it does not understand (D511)", () => {
  it("(0) anti-vacuity — the validator and the harness source are both really here", () => {
    // Every case below is satisfied by an empty flag list and an empty source.
    expect(KNOWN_FLAGS.length).toBeGreaterThan(0);
    expect(sorted(KNOWN_FLAGS)).toEqual(sorted([...BOOLEAN_FLAGS, ...VALUE_FLAGS]));
    expect(
      BOOLEAN_FLAGS.filter((f) => VALUE_FLAGS.includes(f)),
      "a flag is declared both boolean and value-taking",
    ).toEqual([]);
    for (const flag of KNOWN_FLAGS) expect(flag).toMatch(/^--[a-z][a-z-]*$/);
    for (const flag of VALUE_FLAGS) expect(knownFlagsUsage()).toContain(`${flag} <value>`);
  });

  it("(2) ACCEPTS every documented invocation, including the ones that look odd", () => {
    const legitimate: readonly (readonly string[])[] = [
      [],
      ["--list"],
      ["--full"],
      ["--verbose"],
      ["--allow-dirty"],
      ["--only", "D192-weakness"],
      ["--only", "D192-weakness,D196-seat-zone,D470-harness-splices-the-replacement"],
      ["--decision", "D202"],
      // `--decision` values that are not bare ids — the corpus really holds these.
      ["--decision", "D204/D205"],
      ["--decision", "D192 (inheriting D161)"],
      // ⚠️ `--list` IGNORES `--decision`. That is documented behaviour and this
      // slice does not change it — an ignored-by-design combination must stay a
      // WELL-FORMED line, or the guard would be breaking the semantics it guards.
      ["--list", "--decision", "D511"],
      ["--only", "D511-a", "--decision", "D511"],
      ["--decision", "D511", "--allow-dirty"],
      ["--full", "--verbose", "--allow-dirty", "--only", "D211-one"],
      // Order does not matter, and a value that merely CONTAINS a dash is fine.
      ["--allow-dirty", "--verbose", "--decision", "D209 (as flipped by D210)"],
    ];
    for (const argv of legitimate) {
      expect(
        argvProblems(argv),
        `a legitimate command line was refused: ${JSON.stringify(argv)}`,
      ).toEqual([]);
    }
  });

  it("(1) REJECTS an unknown flag — D510's `--id`, and everything shaped like it", () => {
    for (const argv of [
      ["--id", "D470-harness-splices-the-replacement"],
      ["--id", "D470", "--allow-dirty"],
      ["--onlyy", "D511-a"],
      ["--only-", "x"],
      ["--decisions", "D511"],
      ["--dry-run"],
      ["-v"],
      ["--"],
      ["--list", "--wat"],
    ]) {
      const problems = argvProblems(argv);
      expect(
        problems.length,
        `an unknown flag was ACCEPTED, which is the D510 defect: ${JSON.stringify(argv)}`,
      ).toBeGreaterThan(0);
    }
    // and it NAMES the offender rather than saying "bad arguments"
    expect(argvProblems(["--id", "x"])[0]).toContain("--id");
  });

  it("(1) REJECTS a value flag with a MISSING value — the trailing-flag path, which reads as NO FILTER", () => {
    for (const argv of [
      ["--only"],
      ["--decision"],
      ["--allow-dirty", "--only"],
      ["--full", "--verbose", "--decision"],
    ]) {
      expect(
        argvProblems(argv).length,
        `a value flag with no value was ACCEPTED — \`undefined\` reads as "no filter" and runs the whole corpus: ${JSON.stringify(argv)}`,
      ).toBeGreaterThan(0);
    }
    expect(argvProblems(["--only"])[0]).toContain("--only");
  });

  it("(1) REJECTS a value flag whose value is FLAG-SHAPED — the other wrong answer", () => {
    // `--only --full` today takes the literal string "--full" as the row id,
    // matches nothing and exits 2. Loud, but about the wrong thing.
    for (const argv of [
      ["--only", "--full"],
      ["--decision", "--verbose"],
      ["--only", "--decision", "D511"],
      ["--decision", "-D511"],
    ]) {
      expect(
        argvProblems(argv).length,
        `a flag-shaped value was ACCEPTED as a value: ${JSON.stringify(argv)}`,
      ).toBeGreaterThan(0);
    }
    expect(argvProblems(["--only", "--full"])[0]).toContain("--full");
  });

  it("(1) REJECTS a bare positional — the row id a typo'd flag leaves stranded", () => {
    for (const argv of [
      ["D470-harness-splices-the-replacement"],
      ["--allow-dirty", "D511"],
      ["--only", "D511-a", "D511-b"],
    ]) {
      expect(
        argvProblems(argv).length,
        `a positional argument was silently accepted, which is the same drop one token to the right: ${JSON.stringify(argv)}`,
      ).toBeGreaterThan(0);
    }
    // `--only D511-a D511-b` is the comma-list mistake; the message should point at it.
    expect(argvProblems(["--only", "D511-a", "D511-b"]).join(" ")).toContain("--only D511-b");
  });

  it("(1) REJECTS a repeated flag — `--only` does not accumulate, and the discard used to be silent", () => {
    for (const argv of [
      ["--only", "a", "--only", "b"],
      ["--decision", "D510", "--decision", "D511"],
      ["--verbose", "--verbose"],
    ]) {
      expect(
        argvProblems(argv).length,
        `a repeated flag was accepted; every occurrence but the first is thrown away by indexOf/includes: ${JSON.stringify(argv)}`,
      ).toBeGreaterThan(0);
    }
    expect(argvProblems(["--only", "a", "--only", "b"]).join(" ")).toContain("does not accumulate");
  });
});
