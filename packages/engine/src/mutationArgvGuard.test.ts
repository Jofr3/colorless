import { describe, expect, it } from "vitest";
import {
  BOOLEAN_FLAGS,
  KNOWN_FLAGS,
  VALUE_FLAGS,
  argvProblems,
  knownFlagsUsage,
} from "../../../scripts/mutation/argv";

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
      ["--decision", "D204/D205"],
      ["--decision", "D192 (inheriting D161)"],
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
