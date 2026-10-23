/**
 * Partition gate: no two mutant rows may be the same experiment (same file, find, replace,
 * nameFilter, killers and survives), since such a pair reports one run as two. Rows sharing a line
 * are normal. There is no exemption list.
 *
 *   bun scripts/mutation/partition-gate.ts
 */

import { readFileSync } from "node:fs";
import type { Mutant } from "./mutants";
import { MUTANTS } from "./mutants";

/** The script that must call this gate, so the pre-sweep command reports it. */
const WIRING_SITE = "scripts/mutation/precheck.ts";
/** The exact call the wiring rung looks for in `WIRING_SITE`. */
const WIRING_CALL = "partitionReport()";

/** Cap the naming so a wholly-duplicated corpus prints a page, not a book. */
const MAX_NAMED = 20;

/**
 * The runner-visible identity of a row. `expectKilledBy` is sorted because order does not change
 * which suites run; `id`, `decision` and `what` are labels and excluded.
 */
export function experimentKey(m: Mutant): string {
  return JSON.stringify([
    m.file,
    m.find,
    m.replace,
    m.nameFilter ?? null,
    [...m.expectKilledBy].sort(),
    m.killedByCommand ?? null,
    m.survives ?? null,
  ]);
}

/** Every set of two-or-more rows the runner cannot tell apart. The verdict. */
export function indistinguishableGroups(rows: readonly Mutant[]): Mutant[][] {
  const byKey = new Map<string, Mutant[]>();
  for (const m of rows) {
    const key = experimentKey(m);
    const seen = byKey.get(key);
    if (seen === undefined) byKey.set(key, [m]);
    else seen.push(m);
  }
  return [...byKey.values()].filter((group) => group.length > 1);
}

/** The verdict as a boolean, so the comparison is drivable on its own. */
export function isPartitioned(rows: readonly Mutant[]): boolean {
  return indistinguishableGroups(rows).length === 0;
}

/**
 * The NEAR-MISS population: rows that apply a byte-identical patch to the same
 * file and are distinguished ONLY by their killers. Reported on the green path,
 * asserted nowhere — splice-gate's rule, for splice-gate's reason: a guard
 * whose subject can drift to zero without saying so is one refactor away from
 * vacuous, and this number moving is the cheapest signal that the shared-arm
 * idiom above is being used somewhere new.
 */
export function sharedPatchGroups(rows: readonly Mutant[]): Mutant[][] {
  const byPatch = new Map<string, Mutant[]>();
  for (const m of rows) {
    const key = JSON.stringify([m.file, m.find, m.replace]);
    const seen = byPatch.get(key);
    if (seen === undefined) byPatch.set(key, [m]);
    else seen.push(m);
  }
  return [...byPatch.values()].filter((group) => group.length > 1);
}

export type PartitionReport = {
  /** True when no two rows are the same experiment. */
  ok: boolean;
  /** Human-readable lines; `lines[0]` is the one-line summary on the green path. */
  lines: string[];
  /** Rows applying the same patch, separated only by their killers. Reported. */
  sharedPatchRows: number;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** One synthetic row, so a self-check case is a single named difference. */
function row(over: Partial<Mutant>): Mutant {
  return {
    id: "synthetic",
    decision: "D000",
    what: "synthetic",
    file: "a.ts",
    find: "const x = 1;",
    replace: "const x = 2;",
    expectKilledBy: ["a.test.ts"],
    ...over,
  };
}

/**
 * Self-check on synthetic pairs that differ in exactly one field, so a key that stops reading a
 * field fails here.
 */
export function selfCheck(): void {
  const bad = (why: string): never =>
    fail(
      [
        `partition-gate: SELF-CHECK FAILED — ${why}\n`,
        "The guard cannot be trusted about the real corpus, so its verdict means nothing.",
      ].join(""),
    );

  // 1. The positive case: two rows identical in every runner-visible field.
  //    Different LABELS must not save them — that is the whole point of the key.
  const twins = [row({ id: "one" }), row({ id: "two", decision: "D999", what: "different prose" })];
  const found = indistinguishableGroups(twins);
  if (found.length !== 1 || found[0]?.length !== 2) {
    bad(
      `two rows identical in every runner-visible field were not grouped (got ${String(found.length)} group(s)).`,
    );
  }
  if (isPartitioned(twins))
    bad("a corpus containing D483's exact defect was reported PARTITIONED.");

  // 2. The negative cases: one field apart is two experiments, not one. Each of
  //    these is a rung that goes red if that field leaves `experimentKey`.
  const apart: [string, Mutant[]][] = [
    ["file", [row({ id: "one" }), row({ id: "two", file: "b.ts" })]],
    ["find", [row({ id: "one" }), row({ id: "two", find: "const y = 1;" })]],
    ["replace", [row({ id: "one" }), row({ id: "two", replace: "const x = 3;" })]],
    ["nameFilter", [row({ id: "one" }), row({ id: "two", nameFilter: "some test" })]],
    ["expectKilledBy", [row({ id: "one" }), row({ id: "two", expectKilledBy: ["b.test.ts"] })]],
    // Both sides carry a command so the pair differs only in `killedByCommand`.
    [
      "killedByCommand",
      [
        row({ id: "one", expectKilledBy: [], killedByCommand: ["bun", "x.ts"] }),
        row({ id: "two", expectKilledBy: [], killedByCommand: ["bun", "y.ts"] }),
      ],
    ],
    [
      "survives",
      [
        row({ id: "one" }),
        row({ id: "two", survives: { kind: "equivalent", reason: "synthetic" } }),
      ],
    ],
  ];
  for (const [field, pair] of apart) {
    if (!isPartitioned(pair)) {
      bad(`two rows differing only in \`${field}\` were called the same experiment.`);
    }
  }

  // 3. `expectKilledBy` is a SET. Same suites, different order, one experiment.
  const reordered = [
    row({ id: "one", expectKilledBy: ["a.test.ts", "b.test.ts"] }),
    row({ id: "two", expectKilledBy: ["b.test.ts", "a.test.ts"] }),
  ];
  if (isPartitioned(reordered)) {
    bad("two rows naming the same suites in a different order were called two experiments.");
  }

  // 4. The near-miss population must SEE the shared-arm idiom, or the number it
  //    reports on the green path is a zero that means nothing.
  const sharedArm = [
    row({ id: "one", expectKilledBy: ["a.test.ts"] }),
    row({ id: "two", expectKilledBy: ["b.test.ts"] }),
  ];
  const near = sharedPatchGroups(sharedArm);
  if (near.length !== 1 || near[0]?.length !== 2) {
    bad(
      `the shared-patch population did not see two rows applying one patch (got ${String(near.length)} group(s)).`,
    );
  }
  if (
    sharedPatchGroups([row({ id: "one" }), row({ id: "two", find: "const y = 1;" })]).length > 0
  ) {
    bad("the shared-patch population counted two rows that patch different text.");
  }
}

/**
 * Asserts precheck.ts calls this gate; an uncalled gate is indistinguishable from a passing one.
 */
export function checkWiring(): void {
  const text = readFileSync(WIRING_SITE, "utf8");
  if (!text.includes(WIRING_CALL)) {
    fail(
      [
        `partition-gate: FAIL — \`${WIRING_SITE}\` does not call \`${WIRING_CALL}\`.\n`,
        "This gate would then run only when someone runs it by hand, which is never.\n",
        "Re-add the call (NOT by deleting this rung).",
      ].join(""),
    );
  }
}

export function partitionReport(): PartitionReport {
  selfCheck();
  checkWiring();

  const groups = indistinguishableGroups(MUTANTS);
  const sharedPatchRows = sharedPatchGroups(MUTANTS).reduce((n, g) => n + g.length, 0);

  if (isPartitioned(MUTANTS)) {
    return {
      ok: true,
      lines: [
        `no two of ${String(MUTANTS.length)} rows are the same experiment (${String(sharedPatchRows)} row(s) share a patch, separated by their killers)`,
      ],
      sharedPatchRows,
    };
  }

  const named: string[] = [];
  for (const group of groups.slice(0, MAX_NAMED)) {
    const first = group[0];
    if (first === undefined) continue;
    named.push(`   ${first.file}`);
    named.push(`     find:    ${JSON.stringify(first.find)}`);
    named.push(`     replace: ${JSON.stringify(first.replace)}`);
    for (const m of group) named.push(`       - ${m.id}  (${m.decision})`);
  }
  const more =
    groups.length > MAX_NAMED
      ? [`   … and ${String(groups.length - MAX_NAMED)} more group(s).`]
      : [];

  return {
    ok: false,
    lines: [
      `\n🛑 partition-gate: ${String(groups.length)} GROUP(S) OF ROWS ARE THE SAME EXPERIMENT.`,
      "   Each group applies ONE patch and is reported as several rows, so at least",
      "   one of them is not testing what its `what` names — and the verdict column",
      "   cannot say so, because every row in the group dies for the same reason.",
      "   This is D483: two rows shared a `find` for 46 decisions, both reported",
      "   KILLED, and the arm one of them named had no row at all.",
      "",
      ...named,
      ...more,
      "",
      "   Fix by re-pointing the row whose `what` no longer matches its `find`",
      "   (read all three fields), NOT by deleting one of the rows.",
      "",
    ],
    sharedPatchRows,
  };
}

function main(): void {
  const report = partitionReport();
  if (!report.ok) {
    for (const line of report.lines) console.error(line);
    process.exit(1);
  }
  console.log(`partition-gate: OK — ${report.lines[0] ?? ""}.`);
}

// Only when RUN, never when IMPORTED — `precheck.ts` calls `partitionReport()`
// and must not inherit this file's console output or its exit.
if (import.meta.main) main();
