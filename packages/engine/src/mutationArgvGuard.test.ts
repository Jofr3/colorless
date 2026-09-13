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

/** `run.ts` as text. A GLOB rather than `node:fs` for `progressLog.test.ts`'s
    reason, restated: this package has no `"types": ["node"]` in its tsconfig (it
    runs in a Worker and in the browser), and widening that to read one file would
    put Node globals in scope for the whole engine. And RAW BYTES rather than an
    import for D504's reason: `run.ts` has a top-level `await main()`. */
const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("../../../scripts/mutation/*.ts", { query: "?raw", import: "default", eager: true });

function fileAt(key: string): string {
  const text = RAW[`../../../scripts/mutation/${key}`];
  if (text === undefined) {
    throw new Error(
      `scripts/mutation/${key} is not readable from the glob — keys: ${Object.keys(RAW).join(", ")}`,
    );
  }
  return text;
}

const RUN_TS = fileAt("run.ts");
const MUTANTS_TS = fileAt("mutants.ts");

/** `run.ts` with its comment lines removed. ⚠️ LOAD-BEARING, NOT TIDINESS: this
    file's whole subject is an ORDER, and `run.ts` is a heavily commented file whose
    comments DISCUSS the very call sites being ordered — the D511 block above the
    validator names `recoverFromJournal()` in prose. An `indexOf` over the raw text
    finds the sentence about the call before the call. Dropping whole comment lines
    is deliberately the crudest possible filter: it cannot accidentally delete code,
    because no statement in this file begins with `//` or `*`. */
const CODE_ONLY = RUN_TS.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");

/** The body of `main()` — everything from its declaration to the end of the file.
    The ordering assertions below are offsets INSIDE this slice, because
    `recoverFromJournal` is also DEFINED several hundred lines earlier and an
    `indexOf` over the whole file would find the definition, not the call. */
const MAIN_AT = CODE_ONLY.indexOf("async function main()");
const MAIN = MAIN_AT === -1 ? "" : CODE_ONLY.slice(MAIN_AT);

/** Every flag `run.ts` actually READS OUT OF ARGV, derived from its own source.
    ⚠️ DELIBERATELY NOT "every `--…` string in the file": `run.ts` also contains
    `"--porcelain"`, which is an argument it passes to `git status`, not one it
    accepts. Keying on the two argv accessors is what tells those apart. The
    patterns are looser than the call sites they match (whitespace, any quoted
    body) so a reformat cannot make this silently find nothing — D506. */
function flagsReadFromArgv(source: string): Set<string> {
  const found = new Set<string>();
  for (const m of source.matchAll(/argv\s*\.\s*includes\(\s*"([^"]+)"\s*\)/g)) {
    found.add(m[1] ?? "");
  }
  for (const m of source.matchAll(/flagValue\(\s*argv\s*,\s*"([^"]+)"\s*\)/g)) {
    found.add(m[1] ?? "");
  }
  return found;
}

const READ_BY_HARNESS = flagsReadFromArgv(MAIN);

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

describe("the mutation harness rejects a command line it does not understand (D511)", () => {
  it("(0) anti-vacuity — the validator and the harness source are both really here", () => {
    // Every case below is satisfied by an empty flag list and an empty source.
    expect(RUN_TS.length, "scripts/mutation/run.ts read as an empty string").toBeGreaterThan(
      10_000,
    );
    expect(MAIN_AT, "no `async function main()` in scripts/mutation/run.ts").toBeGreaterThan(0);
    expect(KNOWN_FLAGS.length).toBeGreaterThan(0);
    expect(sorted(KNOWN_FLAGS)).toEqual(sorted([...BOOLEAN_FLAGS, ...VALUE_FLAGS]));
    expect(
      BOOLEAN_FLAGS.filter((f) => VALUE_FLAGS.includes(f)),
      "a flag is declared both boolean and value-taking",
    ).toEqual([]);
    for (const flag of KNOWN_FLAGS) expect(flag).toMatch(/^--[a-z][a-z-]*$/);
    for (const flag of VALUE_FLAGS) expect(knownFlagsUsage()).toContain(`${flag} <value>`);
  });

  it("(4) the known set is exactly the set of flags run.ts reads out of argv — derived, not transcribed", () => {
    // 🛑 NO SECOND COPY. If this list were hard-coded, adding `--dry-run` to the
    // harness and forgetting to register it would leave the harness rejecting its
    // own new flag, with every test here green — the guard inheriting the defect
    // it exists to catch (D503/D504's rule).
    expect(
      sorted(READ_BY_HARNESS),
      `scripts/mutation/run.ts reads ${JSON.stringify(sorted(READ_BY_HARNESS))} out of argv, but argv.ts declares ${JSON.stringify(sorted(KNOWN_FLAGS))}. A flag in one list and not the other is either a flag the harness silently ignores or a flag the validator rejects even though the harness honours it.`,
    ).toEqual(sorted(KNOWN_FLAGS));

    // The `--porcelain` control: it IS in run.ts, it is NOT an argv flag, and
    // nothing above should have dragged it in. Named because the brief for this
    // slice asked the question out loud.
    expect(RUN_TS).toContain('"--porcelain"');
    expect(READ_BY_HARNESS.has("--porcelain")).toBe(false);
    expect(KNOWN_FLAGS).not.toContain("--porcelain");
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

  it("(3)+(5) WIRING — run.ts calls the validator FIRST, ahead of BOTH writes, and exits non-zero", () => {
    const call = MAIN.indexOf("argvProblems(argv)");
    const list = MAIN.indexOf('argv.includes("--list")');
    const recover = MAIN.indexOf("recoverFromJournal()");
    const exit = MAIN.indexOf("process.exit(4)");

    expect(RUN_TS, "run.ts no longer imports the validator at all").toContain('from "./argv.ts"');
    expect(call, "scripts/mutation/run.ts's main() never calls argvProblems(argv)").toBeGreaterThan(
      -1,
    );
    expect(list, "the --list branch moved out of main()").toBeGreaterThan(-1);
    expect(recover, "recoverFromJournal() is no longer called from main()").toBeGreaterThan(-1);

    // 🛑 THE ORDER. D369: "the recovery path is a WRITE, so the only command that
    // may precede it is one that never writes." Validation never writes, so it
    // belongs ahead of BOTH — a bad flag must not be able to trigger journal
    // recovery, and it must not be able to succeed at printing the corpus either.
    expect(
      call,
      "argvProblems(argv) is called AFTER the --list branch — `--list --ohno` would print the corpus and report success on a line it never understood",
    ).toBeLessThan(list);
    expect(
      call,
      "argvProblems(argv) is called AFTER recoverFromJournal() — a mistyped flag can still restore a live run's file out from under it and exit 2, which is D369's defect reached through a typo",
    ).toBeLessThan(recover);
    expect(
      list,
      "the --list branch no longer precedes recoverFromJournal() — D369's ordering was undone",
    ).toBeLessThan(recover);

    // A rejection a caller reads as success is not a rejection. ⚠️ AND THE SHAPE
    // IS PINNED, NOT JUST THE ORDER: `if (problems.length > 0 && false)` leaves
    // every offset above exactly where it was while disabling the guard entirely,
    // so an order-only assertion would be green on it. This is the narrowest of the
    // checks here and the one most likely to need updating after a reformat — if it
    // fails on a cosmetic change, widen the pattern, do not delete the case.
    expect(exit, "the rejection path does not `process.exit(4)`").toBeGreaterThan(call);
    expect(exit).toBeLessThan(list);
    expect(
      MAIN,
      "the rejection is no longer `if (problems.length > 0)` guarding an exit — the call can sit in the right place and do nothing",
    ).toMatch(
      /const problems = argvProblems\(\s*argv\s*\);\s*if \(\s*problems\.length > 0\s*\)\s*\{/,
    );
    expect(RUN_TS, "run.ts no longer documents its rejection exit code").toContain(
      "4 when the COMMAND LINE",
    );
  });

  it("(6) SUBSTRING — `--decision` still matches by substring, and the corpus is why", () => {
    // 🛑 EVALUATED AND DELIBERATELY NOT FIXED. `--decision D51` matching both D510
    // and D511 is a real hazard. Tightening it to an exact match is a WORSE one,
    // and that is measured rather than argued: the corpus holds `decision` strings
    // that are not bare ids, so an exact match would make `--decision D192` stop
    // finding two of its own rows and `--decision D205` stop finding `D204/D205` —
    // a filter that silently returns FEWER rows than asked for, which is this
    // slice's own defect pointing the other way.
    expect(
      MAIN,
      "scripts/mutation/run.ts stopped selecting by substring. If that was deliberate, first check what happens to the compound `decision` strings listed in this test — an exact match orphans them SILENTLY.",
    ).toContain("m.decision.includes(decision)");

    const declared = new Set<string>();
    for (const m of MUTANTS_TS.matchAll(/decision:\s*"([^"]*)"/g)) declared.add(m[1] ?? "");
    expect(declared.size, "no `decision:` fields parsed out of mutants.ts").toBeGreaterThan(100);

    const compound = [...declared].filter((d) => !/^D\d+$/.test(d)).sort();
    expect(
      compound,
      "the compound `decision` strings changed. They are the whole reason `includes` is load-bearing; if the corpus no longer holds any, the substring match has become a pure hazard and is worth revisiting.",
    ).toEqual([
      "D192 (inheriting D159)",
      "D192 (inheriting D161)",
      "D204 (vs D200 predicate)",
      "D204/D205",
      "D209 (as flipped by D210)",
    ]);

    // And each of those really is unreachable by an exact match on its own id.
    // ⚠️ Typed as plain `string`, deliberately: under `as const` TypeScript knows
    // the two sides are different literals and rejects the `===` comparison as
    // unintentional — which is the compiler agreeing with the point being made,
    // but it is not the same as the RUNTIME agreeing with it.
    const orphaned: readonly { readonly flag: string; readonly row: string }[] = [
      { flag: "D192", row: "D192 (inheriting D161)" },
      { flag: "D205", row: "D204/D205" },
      { flag: "D210", row: "D209 (as flipped by D210)" },
    ];
    for (const { flag, row } of orphaned) {
      expect(declared.has(row), `mutants.ts no longer holds the row \`${row}\``).toBe(true);
      expect(row.includes(flag), `\`--decision ${flag}\` should still reach \`${row}\``).toBe(true);
      expect(row === flag, `\`${row}\` is unreachable by an EXACT match on \`${flag}\``).toBe(
        false,
      );
    }
  });
});
